// Copyright 2022-2025 Colorful Notion, Inc.
// This file is part of polkadot-etl.

// polkadot-etl is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// polkadot-etl is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with polkadot-etl.  If not, see <http://www.gnu.org/licenses/>.
const {
    ApiPromise,
    WsProvider
} = require('@polkadot/api');
const {
    u8aToHex,
    hexToU8a
} = require('@polkadot/util');
const {
    decodeAddress
} = require('@polkadot/util-crypto');
const {
    MultiLocation
} = require('@polkadot/types/interfaces');


const Query = require('./query');
const mysql = require("mysql2");
const paraTool = require("./paraTool");
const btTool = require("./btTool");
/*
Setup xcmcleaner to do all writes to the new column family currently done by  xcmmatch work except failure
Compute teleport fee and teleport usd fee in xcmcleaner correctly
Cover failure cases in xcmcleaner
Cover xcmmessages in xcmcleaner if possible
*/
module.exports = class XCMCleaner extends Query {
    // hold xcmtransferdestcandidate recs
    cachedMessages = null;
    // hold substrate-etl recs
    cachedRows = null;

    constructor() {
        super("manager")
    }

    async publish_xcminfo(msg) {}

    async setupChainAndAPI(chainID, withSpecVersions = true, backfill = false) {
        let chain = await this.getChainWithVersion(chainID, withSpecVersions);
        await this.setupAPI(chain, backfill);

        this.relayChain = chain.relayChain;
        return (chain);
    }

    async getAssetChainFromSymbol(chainID, symbol) {
        // resolve symbol into asset/currencyID correctly -- note that this does not depend on xcmInteriorKey...
        let sql = `select asset, currencyID, asset.xcmInteriorKey from asset, xcmasset  where xcmasset.xcmInteriorKey = asset.xcmInteriorKey and chainID = '${chainID}' and xcmasset.symbol = '${symbol}' limit 1;`
        let recs = await this.poolREADONLY.query(sql)
        if (recs.length == 1) {
            return recs[0]
        }
        console.log("NO RECORD FOUND", sql)
        return null;
    }

    async searchDestinationChainBalances(chainID, sourceTS, destAddress, symbol, amountSent, N = 3) {
        let chain = await this.setupChainAndAPI(chainID)
        if (this.api == null) {
            return [null, null];
        }
        if (!destAddress) {
            console.log("NO DestAddress");
            return [null, null];
        }

        let destAddressPubkey = paraTool.getPubKey(destAddress);
        console.log("destAddress", destAddress, "destAddressPubkey", destAddressPubkey);
        let sqlD = `select blockNumber, blockHash, UNIX_TIMESTAMP(blockDT) blockTS from block${chainID} where blockDT >= FROM_UNIXTIME(${sourceTS}-30) and blockDT <= FROM_UNIXTIME(${sourceTS + N*60}) and blockHash is not null order by blockNumber limit 1000`
        console.log(sqlD);
        let blocks = await this.poolREADONLY.query(sqlD)
        if (blocks.length == 0) {
            return ([null, null]);
        }
        let asset = await this.getAssetChainFromSymbol(chainID, symbol);
        console.log("found ", blocks.length, " blocks", sqlD, "ASSET", asset);

        let balances = {}
        let guess = null;
        let currencies = [];
        let currenciesStrings = [];
        if (asset == null) {
            // look for candidate "tokens" events that match the destAddress
            for (const b of blocks) {
                let bn = b.blockNumber;
                let blockHash = b.blockHash
                let apiAt = await this.api.at(blockHash)
                let query = null
                let eventsRaw = await apiAt.query.system.events();
                let events = [];
                eventsRaw.forEach((e) => {
                    let eh = e.event.toHuman();
                    let ej = e.event.toJSON();

                    if (eh.section == "tokens") {
                        let out = JSON.parse(JSON.stringify(e));
                        let data = out.event.data;
                        let who = paraTool.getPubKey(data[1]);
                        if (who == destAddressPubkey) {
                            let currencyString = (typeof data[0] == "string") ? data[0] : JSON.stringify(data[0]);
                            if (!currenciesStrings.includes(currencyString)) {
                                console.log(`CURRENCY ${currencyString} FOUND:`, data[0]);
                                currencies.push(data[0]);
                                currenciesStrings.push(currencyString);
                            }
                        }
                    }
                });
            }
        } else {
            if (chainID == 2030 || chainID == 22001) {
                // these chains have JSON objects in currencyID
                currencies.push(JSON.parse(asset.currencyID));
            } else if (chainID == 22000 || chainID == 2000 || (chainID == 2032 || chainID == 22092)) {
                // TODO: import GAR such that the above will cover these chains instead
                let asset0 = JSON.parse(asset.asset)
                let currencyID = null;
                let flds = ["Token", "ForeignAsset", "Erc20", "LiquidCrowdloan", "StableAsset"];

                for (const fld of flds) {
                    if (asset0[fld]) {
                        currencyID = {}
                        currencyID[fld.toLowerCase()] = asset0[fld];
                        currencies.push(currencyID);
                    }
                }
                if (currencyID) {
                    currencies.push(currencyID);
                }
            } else {
                currencies.push(asset.currencyID);
            }
        }
        let isNative = (this.chainInfos[chainID] != undefined && this.chainInfos[chainID].symbol != undefined) ? symbol == this.chainInfos[chainID].symbol : false;
        // exception so far: Kintsugi and Interlay represent native token in tokens.accounts pallet storage instead of system.account storage
        if (chainID == 22092 && symbol == "KINT" || chainID == 2032 && symbol == "INTR") isNative = false;
        if (chainID == 21000 && symbol == "KSM") isNative = true;
        if ((chainID == 1000 || chainID == 1001) && symbol == "DOT") isNative = true;

        for (const b of blocks) {
            let bn = b.blockNumber;
            let blockHash = b.blockHash
            try {
                console.log("checking apiAt ", chainID, "blockHash", blockHash, "bn", bn, "symbol", symbol, "destAddress", destAddress, "isNative", isNative);
                let apiAt = await this.api.at(blockHash)

                if (isNative) {
                    let query = await apiAt.query.system.account(destAddress);
                    let qR = query.toJSON();
                    if (balances[asset.currencyID] == undefined) {
                        balances[asset.currencyID] = {}
                    }
                    balances[asset.currencyID][bn] = qR.data.free
                } else if (apiAt.query.tokens != undefined && apiAt.query.tokens.accounts != undefined) {

                    for (const currencyID of currencies) {
                        let currencyIDString = (typeof currencyID == "string") ? currencyID : JSON.stringify(currencyID);
                        console.log("TRYING tokens with currencyID=", currencyID);
                        let query = await apiAt.query.tokens.accounts(destAddress, currencyID);
                        let qR = query.toJSON();
                        if (balances[currencyIDString] == undefined) {
                            balances[currencyIDString] = {}
                        }
                        if (qR && qR.free != undefined) {
                            let free = paraTool.dechexToInt(qR.free.toString());
                            balances[currencyIDString][bn] = free
                            console.log("tokens CHECK", destAddress, currencyID, "freeraw", qR.free, "free", free)
                        }
                    }
                } else if (apiAt.query.assets != undefined && apiAt.query.assets.account != undefined) {
                    for (const currencyID of currencies) {
                        console.log("asset CHECK", destAddress, "currencyID:", currencyID)
                        let query = await apiAt.query.assets.account(currencyID, destAddress);
                        let qR = query.toJSON();
                        let currencyIDString = (typeof currencyID == "string") ? currencyID : JSON.stringify(currencyID);
                        if (balances[currencyIDString] == undefined) {
                            balances[currencyIDString] = {}
                        }
                        if (qR && qR.balance != undefined) {
                            let bl = paraTool.dechexToInt(qR.balance.toString());
                            console.log("assets SUCC", symbol, currencyID, destAddress, bl);
                            balances[currencyIDString][bn] = bl;
                        } else {
                            console.log("assets FAIL", symbol, currencyID, destAddress, qR);
                        }
                    }
                } else {
                    return [null, blocks];
                }
            } catch (e) {
                console.log("block ERROR", e);
            }
        }

        return [balances, blocks];
    }

    compute_confidence(xcmTeleportFees, amountReceived, amountSent) {
        try {

            if (xcmTeleportFees) {
                let avg = parseInt(xcmTeleportFees.teleportFeeDecimals_avg, 10);
                let std = parseInt(xcmTeleportFees.teleportFeeDecimals_std, 10);
                if (std == 0) std = avg * .2;
                let diff = amountSent - (amountReceived + avg);
                if (amountReceived > amountSent) return (0);
                // ===> compute_confidence snt 1045038690560.000000000000000000 rcv 1015819382911 sum 1015819382911 83662580 diff -101581937246144970000 avg 83662580 std 19932769 x= -509622806226.8828
                let x = Math.abs(diff / (std + 1));
                // ===> compute_confidence snt 1045038690560.000000000000000000 rcv 1015819382911 avg 83662580 std 19932769 x= -509622806226.8828
                console.log("===> compute_confidence", "snt", amountSent, "rcv", amountReceived, "diff", diff, "avg", avg, "std", std, "x=", x);
                // TODO: fill this in with analytic model based on x

                if (x < 0.1) {
                    return .95
                } else if (x < 0.5) {
                    return .9
                } else if (x < 1.0) {
                    return .8
                } else if (x < 1.5) {
                    return .7
                } else if (x < 2.0) {
                    return .6
                } else if (x < 3.0) {
                    return .5
                }
            }
            // give up
            let rat = amountReceived / amountSent
            if (amountSent >= amountReceived && (amountReceived / amountSent > 0)) {
                return rat;
            }

        } catch (e) {
            console.log(e);
        }
        return 0
    }

    match_balance_adjustment(balances_currencies, amountSent, blocks, xcmTeleportFees, sourceTS) {
        let prevFree = null;
        let prevBN = 1;
        let changes = [];
        if (!balances_currencies) return null;
        for (const currencyID of Object.keys(balances_currencies)) {
            let balances = balances_currencies[currencyID];
            for (const bn of Object.keys(balances)) {
                let free = balances[bn];
                let diff = (prevFree != null) ? free - prevFree : null
                if (diff > 0 && (diff <= amountSent)) {
                    let amountReceived = diff;
                    let confidence = this.compute_confidence(xcmTeleportFees, amountReceived, amountSent);
                    if (confidence > .20) {
                        let ts = null;
                        for (const b of blocks) {
                            if (bn == b.blockNumber) {
                                ts = b.blockTS;
                            }
                        }
                        changes.push({
                            currencyID,
                            blockNumber: bn,
                            eventID: null,
                            extrinsicID: null,
                            prevFree,
                            free,
                            amountReceivedDecimals: diff,
                            teleportFeeDecimals: null,
                            feeReceivingAddress: null,
                            feeEventID: null,
                            secondsFromSource: ts - sourceTS,
                            ts,
                            confidence,
                            amountSent
                        });
                    }
                }
                prevBN = bn;
                prevFree = free;
            }
        }
        // find the change in balance that matches amountSent best, along with a "confidence" level
        if (changes.length > 0) {
            changes.sort(function compareFn(a, b) {
                return 100000 * (a.secondsFromSourceTS - b.secondsFromSourceTS) + (b.confidence - a.confidence)
            });
            let best = changes[0];
            let bn = best.bn;
            //best.ts = this.getCurrentTS();
            return best;
        }
        return null;
    }

    async get_tx_fees(extrinsicHash) {
        try {
            let txFee = 0;
            let txFeeUSD = 0;
            let txFeeChainSymbol = null;
            let d = await this.getTransaction(extrinsicHash);
            txFee = d.fee
            txFeeUSD = d.feeUSD
            txFeeChainSymbol = d.chainSymbol
            if (d.evm != undefined && d.evm.transactionHash != undefined) {
                let evmTransactionHash = d.evm.transactionHash
                let evmtx = await this.getTransaction(evmTransactionHash);
                if (!evmtx) return [false, false]
                txFee = evmtx.fee
                txFeeUSD = evmtx.feeUSD
                txFeeChainSymbol = evmtx.symbol
            }
            return {
                txFee,
                txFeeUSD,
                txFeeChainSymbol
            }
        } catch (err) {
            console.log(err);
        }
        return null;
    }

    // different than polkaholicDB.execute_bqJob
    async execute_bqJobFn(sqlQuery, fn = false) {
        // run bigquery job with suitable credentials
        const bigqueryClient = this.get_big_query();
        const options = {
            query: sqlQuery,
            location: "US"
        };

        try {
            let f = fn ? await fs.openSync(fn, "w", 0o666) : false;
            const response = await bigqueryClient.createQueryJob(options);
            const job = response[0];
            const [rows] = await job.getQueryResults();
            return rows;
        } catch (err) {
            console.log(err);
            throw new Error(`An error has occurred.`);
        }
        return [];
    }

    async searchSubstrateETLEvents(perfect_match, chainIDDest, sourceTS, destAddress, symbol, amountSentDecimals, xcmTeleportFees = null, decimals = null) {
        let relayChain = paraTool.getRelayChainByChainID(chainIDDest)
        let paraID = paraTool.getParaIDfromChainID(chainIDDest);

        let [logDT, hr] = paraTool.ts_to_logDT_hr(sourceTS);
        let q = ""
        if (hr == 0) {
            let [logDT2, hr2] = paraTool.ts_to_logDT_hr(sourceTS - 86400);
            q = `  or DATE(block_time) = \"${logDT2}\"`;
        } else if (hr == 23) {
            let [logDT2, hr2] = paraTool.ts_to_logDT_hr(sourceTS + 86400);
            q = `  or DATE(block_time) = \"${logDT2}\"`;
        }
        let sqlQuery = `SELECT event_id, extrinsic_id, block_number, section, method, UNIX_SECONDS(block_time) as ts, data FROM \`substrate-etl.crypto_${relayChain}.events${paraID}\` WHERE ( DATE(block_time) = \"${logDT}\" ${q} ) and block_time >= TIMESTAMP_SECONDS(${sourceTS}) and block_time < TIMESTAMP_SECONDS(${sourceTS+180}) and section in ("tokens", "balances", "currencies", "assets", "eqBalances")`;
        console.log("substrate-etl search....", sqlQuery);
        // run query, get events matching destAddress
        let rows = this.cachedRows ? this.cachedRows : await this.execute_bqJobFn(sqlQuery);
        this.cachedRows = rows;
        console.log("***** searchSubstrateETLEvents", perfect_match, rows);
        let amounts = {};
        let events = {};
        let feeEvents = {};
        let destAddress_pubkey = paraTool.getPubKey(destAddress);
        let beneficiary_matches = 0;
        for (const r of rows) {
            let eventID = r.event_id;
            let ts = r.ts;
            let extrinsicID = r.extrinsic_id
            let section = r.section;
            let method = r.method;
            let bn = r.block_number;
            let data = JSON.parse(r.data);
            if (Array.isArray(data)) {
                if ((section == "tokens" && method == "Deposited") || (section == "balances" && method == "Deposit") || (section == "currencies" && method == "Deposited") || (section == "assets" && method == "Issued") || (section == "eqBalances")) {
                    let asset = null;
                    let addr_ss58 = null;
                    let amountReceivedDecimals = null;
                    let func = null;
                    // TODO: bring in symbol
                    if (((section == "eqBalances")) && data.length == 4) {
                        func = data[3];
                        if (func == "XcmTransfer" || func == "XcmPayment") {
                            addr_ss58 = data[0];
                            asset = data[1]; // currencyID
                            amountReceivedDecimals = paraTool.dechexToInt(data[2]);
                            if (decimals > 9) {
                                let factor = decimals - 9;
                                amountReceivedDecimals *= 10 ** (factor);
                            } else if (decimals < 9) {
                                let factor = 9 - decimals;
                                amountReceivedDecimals /= 10 ** (factor);
                            }
                        }
                    } else if (((section == "tokens" && method == "Deposited") || (section == "currencies" && method == "Deposited") || (section == "assets" && method == "Issued")) && data.length == 3) {
                        asset = data[0];
                        addr_ss58 = data[1];
                        amountReceivedDecimals = paraTool.dechexToInt(data[2]);
                    } else if (section == "balances" && method == "Deposit" && (data.length == 2)) {
                        addr_ss58 = data[0]
                        amountReceivedDecimals = paraTool.dechexToInt(data[1]);
                    }
                    if (addr_ss58) {
                        let addr_pubkey = paraTool.getPubKey(addr_ss58);
                        let e = {
                            eventID,
                            extrinsicID,
                            section,
                            method,
                            asset,
                            addr_pubkey,
                            amountReceivedDecimals,
                            ts,
                            blockNumber: bn
                        };
                        if (destAddress_pubkey == addr_pubkey) {
                            if (events[bn] == undefined) {
                                events[bn] = []
                            }
                            console.log("FOUND beneficiary event", bn, e);
                            events[bn].push(e);
                            beneficiary_matches++;
                        } else {
                            if (feeEvents[bn] == undefined) {
                                feeEvents[bn] = []
                            }
                            feeEvents[bn].push(e);
                        }
                    }
                }
            }
        }
        console.log("***** searchSubstrateETLEvents DONE found matches", beneficiary_matches);
        if (beneficiary_matches == 0) return (null);
        // if we have some beneficiary matches in events, then load up from xcmtransferdestevent to make sure we don't match to old events in the process below
        let matchedEventID = {}
        let sql = `select eventID from xcmtransferdestevent where destTS >= ${sourceTS} and destTS <= ${sourceTS+180}`;
        let recs = await this.poolREADONLY.query(sql)
        for (const r of recs) {
            matchedEventID[r.eventID] = true;
        }
        // now, match beneficary events in "events" to fee events in "feeEvents" with the same blockNumber -- where the sum has to be EXACT
        let matches = [];
        if (perfect_match == true) {
            for (const bn of Object.keys(events)) {
                for (const beneficiaryEvent of events[bn]) {
                    let eventID = beneficiaryEvent.eventID;
                    let extrinsicID = beneficiaryEvent.extrinsicID;
                    let ts = beneficiaryEvent.ts;
                    if (matchedEventID[eventID] == undefined) {
                        // NOTE: there may not be a fee event because 100% is received, and some other part of the xcmtransfer covers the fee
                        if (beneficiaryEvent.amountReceivedDecimals == amountSentDecimals) {
                            matches.push({
                                blockNumber: beneficiaryEvent.blockNumber,
                                eventID,
                                extrinsicID,
                                amountReceivedDecimals: beneficiaryEvent.amountReceivedDecimals,
                                teleportFeeDecimals: 0,
                                feeReceivingAddress: null,
                                feeEventID: null,
                                distance: 0,
                                confidence: 1,
                                secondsFromSourceTS: ts - sourceTS,
                                ts
                            })
                        } else if (feeEvents[bn] != undefined) {
                            for (const feeEvent of feeEvents[bn]) {
                                let feeEventID = feeEvent.eventID;
                                console.log("feeEvent", feeEvent, "beneficaryEvent", beneficiaryEvent, "asd", amountSentDecimals);
                                if (matchedEventID[eventID] == undefined) {
                                    let sum = feeEvent.amountReceivedDecimals + beneficiaryEvent.amountReceivedDecimals;
                                    let diff = Math.abs(sum - amountSentDecimals);
                                    let tolerance = decimals > 9 ? 2 * 10 ** (decimals - 9) : 20;
                                    if (sum == amountSentDecimals || (chainIDDest == 2011 && diff <= tolerance)) {
                                        let eventID_idx = this.get_eventIndex(eventID);
                                        let feeEventID_idx = this.get_eventIndex(feeEventID);
                                        if (eventID_idx != null && feeEventID_idx != null) {
                                            let distance = Math.abs(feeEventID_idx - eventID_idx);
                                            matches.push({
                                                blockNumber: beneficiaryEvent.blockNumber,
                                                eventID,
                                                extrinsicID,
                                                amountReceivedDecimals: beneficiaryEvent.amountReceivedDecimals,
                                                teleportFeeDecimals: feeEvent.amountReceivedDecimals,
                                                feeReceivingAddress: feeEvent.addr_pubkey,
                                                feeEventID,
                                                distance,
                                                confidence: 1,
                                                secondsFromSourceTS: ts - sourceTS,
                                                ts
                                            })
                                        }
                                        console.log(beneficiaryEvent.amountReceivedDecimals, "FEE", feeEventID, feeEvent.amountReceivedDecimals, "failed")
                                    }
                                } else {
                                    console.log("ALREADY MATCHED", eventID);
                                }
                            }
                        }
                    } else {
                        console.log("ALREADY MATCHED", eventID);
                    }
                }
            }
        } else {
            for (const bn of Object.keys(events)) {
                for (const beneficiaryEvent of events[bn]) {
                    let eventID = beneficiaryEvent.eventID;
                    let extrinsicID = beneficiaryEvent.extrinsicID;
                    let ts = beneficiaryEvent.ts;
                    if (matchedEventID[eventID] == undefined) {
                        // NOTE: there may not be a fee event because 100% is received, and some other part of the xcmtransfer covers the fee
                        let match = {
                            blockNumber: beneficiaryEvent.blockNumber,
                            eventID,
                            extrinsicID,
                            amountReceivedDecimals: beneficiaryEvent.amountReceivedDecimals,
                            teleportFeeDecimals: null,
                            feeReceivingAddress: null,
                            feeEventID: null,
                            distance: 0,
                            confidence: this.compute_confidence(xcmTeleportFees, beneficiaryEvent.amountReceivedDecimals, amountSentDecimals),
                            secondsFromSourceTS: ts - sourceTS,
                            ts
                        }
                        matches.push(match)
                        console.log("IMPERFECT MATCH", match);
                    }
                }
            }
        }
        // sort by (a) secondsFromSourceTS then (b) distances (distance 1 is best)
        matches.sort(function(a, b) {
            return 10000000 * (b.confidence - a.confidence) + 100000 * (a.secondsFromSourceTS - b.secondsFromSourceTS) + (a.distance - b.distance);
        })
        if (matches.length > 0 && (matches[0].confidence > 0)) {
            return (matches[0]);
        }
        return null;
    }

    get_eventIndex(eventID) {
        let sa = eventID.split("-");
        if (sa.length > 1) {
            let last = parseInt(sa[sa.length - 1], 10);
            return (last);
        }
        return null;
    }

    async searchXCMTransferDestCandidate(perfect_match, msgHash, sourceTS, amountSent, fromAddress, chainID, chainIDDest, sentAt = null, xcmTeleportFees = null) {
        let startTS = sourceTS - 10;
        let endTS = sourceTS + 60 * 2;
        let q = "";
        if (msgHash && msgHash.length > 4) {
            if (sentAt > 0) {
                // search within "sentAt + 4+2(#(hops-1)" window
                let numHops = 1; // TODO should be possible to get this...
                let sentAtWindow = 4 + 2 * (numHops - 1);
                let sentAt2 = sentAt + sentAtWindow;
                q = ` ( sentAt >= ${sentAt} and sentAt <= ${sentAt2} and msgHash = '${msgHash}' ) `
            } else {
                q = `( destTS >= ${startTS} and destTS <= ${endTS} and msgHash = '${msgHash}' )`;
            }
        } else {
            q = `( destTS >= ${startTS} and destTS <= ${endTS} )`;
        }
        let sql = `select blockNumberDest, destTS, amountReceived, xcmTeleportFees, feeReceivingAddress, feeEventID, reaped, isFeeItem, eventID, extrinsicID, fromAddress from xcmtransferdestcandidate where chainIDDest = ${chainIDDest} and ${q} `
        if (fromAddress) {
            sql += ` and ( fromAddress = '${fromAddress}' or reaped > 0 )`;
        }
        let messages = this.cachedMessages ? this.cachedMessages : await this.poolREADONLY.query(sql)
        this.cachedMessages = messages;
        let changes = [];
        for (const m of messages) {
            let amountReceived = parseInt(m.amountReceived, 10);
            let xcmTeleportFees = m.xcmTeleportFees ? parseInt(m.xcmTeleportFees, 10) : 0;
            if (m.reaped && msgHash && msgHash.length > 4) {
                return {
                    blockNumber: m.blockNumberDest,
                    amountReceived: 0,
                    errorDesc: "fail:AccountReaped",
                    confidence: 1,
                    amountSent,
                    eventID: m.eventID,
                    amountReaped: m.amountReaped,
                    extrinsicID: m.extrinsicID,
                    ts: m.destTS
                };
            } else if (amountReceived > 0 && (amountReceived <= amountSent)) {
                let sum = amountReceived + xcmTeleportFees;
                let sent = parseInt(amountSent, 10);
                if (sum == sent) {
                    return {
                        blockNumber: m.blockNumberDest,
                        amountReceivedDecimals: m.amountReceived,
                        teleportFeeDecimals: m.xcmTeleportFees,
                        feeReceivingAddress: m.feeReceivingAddress,
                        feeEventID: m.feeEventID,
                        confidence: 1,
                        amountSent,
                        eventID: m.eventID,
                        extrinsicID: m.extrinsicID,
                        ts: m.destTS
                    };
                } else if (perfect_match == false && xcmTeleportFees) {
                    changes.push({
                        blockNumber: m.blockNumberDest,
                        amountReceivedDecimals: m.amountReceived,
                        teleportFeeDecimals: m.xcmTeleportFees,
                        feeReceivingAddress: m.feeReceivingAddress,
                        feeEventID: m.feeEventID,
                        confidence: this.compute_confidence(xcmTeleportFees, amountReceived, amountSent),
                        amountSent,
                        eventID: m.eventID,
                        extrinsicID: m.extrinsicID,
                        ts: m.destTS
                    });
                    console.log("INEXACT MATCH @ ", m.blockNumberDest, "amountReceived", amountReceived, "xcmTeleportFees", xcmTeleportFees, "sum", sum, "amountSent", amountSent, sent);
                }
            }
        }

        if (changes.length > 0) {
            changes.sort(function compareFn(a, b) {
                return b.confidence - a.confidence
            });
            if (changes[0].confidence > 0.5) {
                return changes[0];
            }
        }
        // new
        if (msgHash && msgHash.length > 4) {
            let sql2 = `select blockNumber, executedEventID, errorDesc, blockTS from xcmmessages where msgHash = '${msgHash}' and chainIDDest = '${chainIDDest}' and incoming = 1 and blockTS >= ${sourceTS} and destTS <= ${endTS} order by blockTS limit 1`;
            let xcmmessages = await this.poolREADONLY.query(sql2)
            for (const m of xcmmessages) {
                if (m.errorDesc) {
                    return {
                        bn: m.blockNumber,
                        eventID: m.executedEventID,
                        errorDesc: m.errorDesc,
                        ts: m.blockTS
                    }
                }
            }
        }
        return null;
    }

    nottoday(sourceTS) {
        let currentTS = this.getCurrentTS();
        let [logDT, hr] = paraTool.ts_to_logDT_hr(currentTS);
        let cutoffTS = paraTool.logDT_hr_to_ts(logDT, 1);
        return (currentTS >= cutoffTS);
    }

    async generate_extrinsic_XCMInfo_targetSQL(targetSQL) {
        let res = await this.poolREADONLY.query(targetSQL)
        for (const r of res) {
            let transferIndex = (r.transferIndex != undefined) ? r.transferIndex : 0
            let xcmIndex = (r.transferIndex != undefined) ? r.xcmIndex : 0
            let extrinsicHash = (r.extrinsicHash != undefined) ? r.extrinsicHash : null
            if (extrinsicHash != undefined) {
                await this.generate_extrinsic_XCMInfo(extrinsicHash, transferIndex, xcmIndex)
            }
        }
    }
    /*
    for any extrinsicHash / extrinsicID in xcmtransfer, pull out the assetChain/xcmInteriorKey, sourceTS, beneficiary and construct the "origination" structure
read a short window of  N minutes from block${chainIDDest} and open up an API connection for ${chainIDDest}.  Query beneficiary for all N minutes for { accounts, tokens } for the asset
if a jump in balance is found in those N minutes, mark the blockNumber in ${chainIDDest}, and see if we can find an event of any kind with 99.x% of the numeric value of the jump.  If one can be found, use that for the executed eventID
*/
    async generate_extrinsic_XCMInfo(extrinsicHash, transferIndex = 0, xcmIndex = 0) {
        let sqlA = `select
                chainID, extrinsicHash, chainIDDest, fromAddress, symbol, relayChain, sectionMethod,
                isFeeItem,
                extrinsicID,
                amountSentDecimals,
                amountSent,
                transferIndex,
                sourceTS,
                destTS,
                fromAddress as senderAddress,
                destAddress,
                msgHash,
                sentAt,
                blockNumber,
                sectionMethod,
                executedEventID,
                destStatus,
                errorDesc,
                incomplete,
                blockNumberDest,
                xcmInteriorKey,
                xcmInteriorKeyUnregistered
              from xcmtransfer
       where  extrinsicHash = '${extrinsicHash}' and transferIndex = '${transferIndex}' and xcmIndex = '${xcmIndex}' limit 1`
        //console.log(paraTool.removeNewLine(sqlA))
        let xcmRecs = await this.poolREADONLY.query(sqlA)
        let xcm = null
        if (xcmRecs.length == 1) {
            xcm = xcmRecs[0]
            console.log(xcm);
        } else {
            return (false);
        }
        let xcmSection = "",
            xcmMethod = "";
        let sectionMethodPieces = xcm.sectionMethod.split(':')
        if (sectionMethodPieces.length == 2) {
            xcmSection = sectionMethodPieces[0]
            xcmMethod = sectionMethodPieces[1]
        }
        xcm.chainName = this.getChainName(xcm.chainID);
        xcm.chainDestName = this.getChainName(xcm.chainIDDest);
        xcm.id = this.getIDByChainID(xcm.chainID)
        xcm.idDest = this.getIDByChainID(xcm.chainIDDest)
        xcm.paraID = paraTool.getParaIDfromChainID(xcm.chainID)
        xcm.paraIDDest = paraTool.getParaIDfromChainID(xcm.chainIDDest)
        let chainIDDestInfo = this.chainInfos[xcm.chainIDDest]
        if (xcm.chainIDDest != undefined && chainIDDestInfo != undefined && chainIDDestInfo.ss58Format != undefined) {
            if (xcm.destAddress != undefined) {
                if (xcm.destAddress.length == 42) xcm.destAddress = xcm.destAddress
                if (xcm.destAddress.length == 66) xcm.destAddress = paraTool.getAddress(xcm.destAddress, chainIDDestInfo.ss58Format)
            } else if (xcm.fromAddress != undefined) {
                if (xcm.fromAddress.length == 42) xcm.destAddress = xcm.fromAddress
                if (xcm.fromAddress.length == 66) xcm.destAddress = paraTool.getAddress(xcm.fromAddress, chainIDDestInfo.ss58Format)
            }
        }
        let isMsgSent = (xcm.incomplete == 0) ? true : false;
        // note that we assign 100% of the tx fees to the FIRST xcmIndex (message) and FIRST asset
        let fees = (transferIndex == 0 && xcmIndex == 0) ? await this.get_tx_fees(extrinsicHash) : null;
        let inp = {
            symbol: xcm.symbol,
            relayChain: xcm.relayChain,
        };
        let q = await this.computePriceUSD(inp)
        if (!inp.decimals) {
            console.log("NO DECIMALS", inp);
            let sql_final = `update xcmtransfer set  matchAttempts = matchAttempts + 1, matchAttemptDT = Now() where extrinsicHash = '${extrinsicHash}' and xcmIndex = '${xcmIndex}' and transferIndex = '${transferIndex}'`
            this.batchedSQL.push(sql_final);
            await this.update_batchedSQL();
            return (false);
        }
        let decimals = inp.decimals;
        let xcmInteriorKey = xcm.xcmInteriorKey
        let xcmInteriorKeyV2 = null
        let xcmInteriorKeyUnregistered = null
        try {
            if (xcmInteriorKey != undefined) {
                xcmInteriorKeyV2 = paraTool.convertXcmInteriorKeyV1toV2(xcmInteriorKey)
                if (this.isXcmInteriorKeyRegistered(xcmInteriorKey)) {
                    xcmInteriorKeyUnregistered = 0
                } else {
                    xcmInteriorKeyUnregistered = 1
                }
            }
        } catch (e) {
            console.log(`${xcm.extrinsicHash} [${xcm.transferIndex}-${xcm.xcmIndex}] v1Key=${xcmInteriorKey}. Error:`, e)
        }

        let xcmInfo = {
            symbol: xcm.symbol,
            xcmInteriorKey: xcmInteriorKeyV2,
            xcmInteriorKeyUnregistered: xcmInteriorKeyUnregistered,
            priceUSD: xcm.priceUSD,
            relayChain: {
                relayChain: xcm.relayChain,
                relayAt: isMsgSent ? xcm.sentAt : null,
            },
            origination: {
                chainName: xcm.chainName,
                id: xcm.id,
                chainID: xcm.chainID,
                paraID: xcm.paraID,
                sender: xcm.fromAddress,
                amountSent: isMsgSent ? xcm.amountSentDecimals / 10 ** inp.decimals : 0,
                amountSentUSD: isMsgSent ? xcm.amountSentUSD : 0,
                blockNumber: xcm.blockNumber,
                extrinsicID: xcm.extrinsicID,
                extrinsicHash: xcm.extrinsicHash,
                txFee: fees ? fees.txFee : 0,
                txFeeUSD: fees ? fees.txFeeUSD : 0,
                txFeeChainSymbol: fees ? fees.txFeeChainSymbol : "",
                msgHash: xcm.msgHash,
                sentAt: xcm.sentAt,
                ts: xcm.sourceTS,
                isMsgSent: isMsgSent,
                finalized: true,
                xcmIndex: xcmIndex,
                transferIndex: transferIndex,
            },
            destination: {
                chainName: xcm.chainDestName,
                id: xcm.idDest,
                chainID: xcm.chainIDDest,
                paraID: xcm.paraIDDest,
                beneficiary: xcm.destAddress,
                amountReceived: 0,
                amountReceivedUSD: 0,
                teleportFee: 0,
                teleportFeeUSD: 0,
                teleportFeeChainSymbol: xcm.symbol,
                blockNumber: xcm.blockNumberDest,
                //extrinsicID: null,
                //eventID: xcm.executedEventID,
                ts: xcm.destTS,
                finalized: true,
                executionStatus: "failed",
                error: {},
            },
            version: 'V4'
        }
        let invalid_dest_address = false;
        if (!xcm.destAddress) invalid_dest_address = true;
        xcmInfo.origination.section = xcmSection;
        xcmInfo.origination.method = xcmMethod;
        try {
            console.log("xcm.amountSent", xcm.amountSent, "Dest", xcm.destAddress, invalid_dest_address);
            if ((xcmInfo.destination.chainID == -1 || invalid_dest_address || xcmInfo.symbol == null)) {
                xcmInfo.destination.executionStatus = "unknown";
                let sql_final = `update xcmtransfer set xcmInfoAudited = 1, matchAttempts = 5, destStatus = -1, xcmInfolastUpdateDT = Now(), xcmInfo = ${mysql.escape(JSON.stringify(xcmInfo))} where extrinsicHash = '${extrinsicHash}' and xcmIndex = '${xcmIndex}' and transferIndex = '${transferIndex}'`
                console.log("ABANDON", sql_final);
                this.batchedSQL.push(sql_final);
                await this.update_batchedSQL();
                return xcmInfo;
            }
            // WATERFALL match criteria: search db, substrateetl, then rpc endpoint
            this.cachedMessages = null;
            this.cachedRows = null;
            let best = null;
            let destAddress = paraTool.getPubKey(xcm.destAddress);
            let sentAt = xcmInfo.relayChain && xcmInfo.relayChain.sentAt ? xcmInfo.relayChain.sentAt : null;

            // perfect matching: first with xcmtransferdestcandidate, then with substrateetl
            best = await this.searchXCMTransferDestCandidate(true, xcm.msgHash, xcm.sourceTS, xcm.amountSent, destAddress, xcm.chainID, xcm.chainIDDest, xcm.sentAt);
            if (best == null && this.nottoday(xcm.sourceTS)) {
                best = await this.searchSubstrateETLEvents(true, xcm.chainIDDest, xcm.sourceTS, xcm.destAddress, xcm.symbol, xcm.amountSent, null, decimals);
            }
            // imperfect matching: first with xcmtransferdestcandidate, then with substrateetl, but only if we have an existing xcmTeleportFees model
            if (best == null) {
                let xcmTeleportFees = this.getXCMTeleportFees(xcm.chainIDDest, xcm.symbol);
                if (this.cachedMessages && this.cachedMessages.length > 0) {
                    best = await this.searchXCMTransferDestCandidate(false, xcm.msgHash, xcm.sourceTS, xcm.amountSent, destAddress, xcm.chainID, xcm.chainIDDest, xcm.sentAt, xcmTeleportFees);
                }
                if (best == null && this.cachedRows && this.cachedRows.length > 0) {
                    best = await this.searchSubstrateETLEvents(false, xcm.chainIDDest, xcm.sourceTS, xcm.destAddress, xcm.symbol, xcm.amountSent, xcmTeleportFees, decimals);
                }
                // if still no good match, then use API endpoint to search for balance changes
                if (best == null) {
                    // this only opens API if needed
                    let [balances, blocks] = await this.searchDestinationChainBalances(xcm.chainIDDest, xcm.sourceTS, xcm.destAddress, xcm.symbol);
                    best = this.match_balance_adjustment(balances, xcm.amountSent, blocks, xcmTeleportFees, xcm.sourceTS);
                }
            }

            if (best) {
                inp.ts = best.ts;
                q = await this.computePriceUSD(inp)
                if (inp.decimals) {
                    // if symbol is known we can compute this
                    xcmInfo.destination.blockNumber = parseInt(best.bn, 10);
                    let destStatus = 1;
                    let amountReceivedDecimals = 0;
                    let teleportFeeDecimals = 0;
                    let matchedEventID = '';
                    let matchedExtrinsicID = '';
                    let feeEventID = '';
                    let feeReceivingAddress = '';
                    let confidence = null;
                    if (best.errorDesc) {
                        xcmInfo.destination.error = paraTool.getXCMErrorDescription(best.errorDesc);
                        xcmInfo.destination.executionStatus = "failed";
                        xcmInfo.destination.amountReceivedUSD = 0;
                        destStatus = 0;
                    } else {
                        amountReceivedDecimals = best.amountReceivedDecimals;
                        teleportFeeDecimals = best.teleportFeeDecimals;
                        feeReceivingAddress = best.feeReceivingAddress;
                        feeEventID = best.feeEventID;
                        xcmInfo.destination.amountReceived = best.amountReceivedDecimals / 10 ** inp.decimals;
                        if (teleportFeeDecimals) {
                            xcmInfo.destination.teleportFee = best.teleportFeeDecimals / 10 ** inp.decimals;
                        } else {
                            xcmInfo.destination.teleportFee = (xcm.amountSentDecimals - best.amountReceivedDecimals) / 10 ** inp.decimals;
                        }
                        if (q && q.priceUSD) {
                            xcmInfo.origination.amountSentUSD = q.priceUSD * xcmInfo.origination.amountSent;
                            xcmInfo.destination.amountReceivedUSD = q.priceUSD * xcmInfo.destination.amountReceived;
                            xcmInfo.destination.teleportFeeUSD = q.priceUSD * xcmInfo.destination.teleportFee;
                            if (xcmInfo.destination.teleportFeeUSD > 10) {
                                // could be multi hop, don't pollute the result
                                xcmInfo.destination.teleportFee = null;
                                xcmInfo.destination.teleportFeeUSD = null;
                            }
                            xcmInfo.priceUSD = q.priceUSD;
                        } else {
                            xcmInfo.priceUSD = 0;
                        }
                        console.log("BEST is...", best, inp);
                        xcmInfo.destination.confidence = best.confidence;
                        if (destStatus == 1) {
                            xcmInfo.destination.executionStatus = "success";
                            if (best.extrinsicID) {
                                matchedExtrinsicID = best.extrinsicID;
                                xcmInfo.destination.extrinsicID = matchedExtrinsicID;
                            }
                            if (best.feeEventID) {
                                feeEventID = best.feeEventID;
                                feeReceivingAddress = best.feeReceivingAddress;
                                xcmInfo.destination.feeEventID = best.feeEventID;
                                xcmInfo.destination.feeReceivingAddress = best.feeReceivingAddress;
                            }
                            xcmInfo.destination.blockNumber = best.blockNumber;
                            xcmInfo.destination.ts = best.ts;
                            xcmInfo.destination.confidence = best.confidence;
                            confidence = best.confidence;
                        } else {
                            xcmInfo.destination.amountReceived = 0;
                            xcmInfo.destination.amountReceivedUSD = 0;
                            xcmInfo.destination.executionStatus = "unknown";
                            xcmInfo.destination.blockNumber = null;
                            xcmInfo.destination.teleportFee = null;
                            xcmInfo.destination.teleportFeeUSD = null;
                        }
                        console.log(xcmInfo);
                    }
                    if (best.eventID) {
                        matchedEventID = best.eventID;
                        xcmInfo.destination.eventID = matchedEventID;
                    }
                    let sql_final = `update xcmtransfer set xcmInfoAudited = 1, matched = 99, destStatus = ${destStatus}, amountSentDecimals = amountSent, amountReceived = '${xcmInfo.destination.amountReceived}', amountReceivedDecimals = ${mysql.escape(amountReceivedDecimals)}, amountReceivedUSD = '${xcmInfo.destination.amountReceivedUSD}', teleportFee = ${mysql.escape(xcmInfo.destination.teleportFee)}, teleportFeeDecimals = ${mysql.escape(teleportFeeDecimals)}, teleportFeeUSD = ${mysql.escape(xcmInfo.destination.teleportFeeUSD)}, matchedExtrinsicID = '${matchedExtrinsicID}', matchedEventID = '${matchedEventID}', feeEventID = ${mysql.escape(feeEventID)}, feeReceivingAddress = ${mysql.escape(feeReceivingAddress)}, confidence = ${mysql.escape(confidence)}, xcmInfolastUpdateDT = Now(), xcmInfo = ${mysql.escape(JSON.stringify(xcmInfo))} where extrinsicHash = '${extrinsicHash}' and xcmIndex = '${xcmIndex}' and transferIndex = '${transferIndex}'`
                    console.log(sql_final);
                    this.batchedSQL.push(sql_final);
                    await this.update_batchedSQL();

                    // if its a recent match (within 5m), send to xcminfo channel and record in xcmtransferslog
                    let currTS = this.getCurrentTS();
                    if (currTS - xcm.sourceTS < 300) {
                        await this.publish_xcminfo(xcmInfo);
                        // record in xcmtransferslog
                        let stage = 'DestinationFinalized';
                        let vals = ["extrinsicHash", "transferIndex", "xcmIndex", "msgHash", "transactionHash", "symbol", "sourceTS", "chainID", "chainIDDest", "xcmInfo", "isSigned", "section", "method", "addTS", "lastUpdateTS"];
                        let transactionHash = xcmInfo.origination.transactionHash ? xcmInfo.origination.transactionHash : null;
                        let txHash = transactionHash ? transactionHash : extrinsicHash;
                        let xcmtransferkey = `${txHash}${xcmIndex}${transferIndex}`
                        let xcmtransferHash = paraTool.twox_128(xcmtransferkey);
                        let out = `('${xcmtransferHash}', '${stage}', '${extrinsicHash}', '${transferIndex}', '${xcmIndex}', ${mysql.escape(xcm.msgHash)}, ${mysql.escape(transactionHash)}, '${xcm.symbol}', '${xcm.sourceTS}', '${xcm.chainID}', '${xcm.chainIDDest}', ${mysql.escape(JSON.stringify(xcmInfo))}, '2', ${mysql.escape(xcmSection)}, ${mysql.escape(xcmMethod)}, '${currTS}', '${currTS}')`;
                        await this.upsertSQL({
                            "table": "xcmtransferslog",
                            "keys": ["xcmtransferhash", "stage"],
                            "vals": vals,
                            "data": [out],
                            "replace": ["lastUpdateTS", "isSigned"]
                        });
                    }
                    if (destStatus == 1 && teleportFeeDecimals) { // only store "perfect" data
                        // store the match in xcmtransferdestevent, so that we don't match the same event twice
                        let valsevent = ["extrinsicID", "chainIDDest", "beneficiary", "blockNumber", "symbol", "relayChain", "destTS", "amountReceivedDecimals", "teleportFeesDecimals", "feeReceivingAddress", "feeEventID", "addDT"]
                        let outevent = `('${matchedEventID}', '${matchedExtrinsicID}', '${xcm.chainIDDest}', '${destAddress}', ${mysql.escape(xcmInfo.destination.blockNumber)}, '${xcm.symbol}', '${xcm.relayChain}', ${mysql.escape(xcmInfo.destination.ts)}, ${mysql.escape(amountReceivedDecimals)}, ${mysql.escape(teleportFeeDecimals)}, ${mysql.escape(feeReceivingAddress)}, ${mysql.escape(feeEventID)}, Now() )`;
                        await this.upsertSQL({
                            "table": "xcmtransferdestevent",
                            "keys": ["eventID"],
                            "vals": valsevent,
                            "data": [outevent],
                            "replace": valsevent
                        });
                        console.log("xcmInfo", JSON.stringify(xcmInfo, null, 4));
                    }

                    let hashesRowsToInsert = [];
                    let hres = btTool.encode_xcminfofinalized(xcm.extrinsicHash, xcm.chainID, xcm.extrinsicID, xcmInfo, xcm.sourceTS)
                    if (hres) {
                        hashesRowsToInsert.push(hres);
                    }
                    if (hashesRowsToInsert.length > 0) {
                        await this.insertBTRows(this.btHashes, hashesRowsToInsert, "hashes");
                    }

                    return xcmInfo;
                }
            }
        } catch (e) {
            console.log(e);
        }
        let sql_final = `update xcmtransfer set xcmInfoAudited = -5, matchAttempts = matchAttempts + 1, matchAttemptDT = Now() where extrinsicHash = '${extrinsicHash}' and xcmIndex = '${xcmIndex}' and transferIndex = '${transferIndex}'`
        console.log(sql_final);
        this.batchedSQL.push(sql_final);
        await this.update_batchedSQL();
        return (false);
    }

    get_confidence(xcmInfo) {
        if (xcmInfo.destination && xcmInfo.destination.confidence) {
            return xcmInfo.destination.confidence
        }
        return 0;
    }

    async bulk_generate_XCMInfo(chainIDDest = null, lookbackDays = 16, limit = 100) {
        let w = chainIDDest ? `and chainIDDest = ${chainIDDest} ` : "";
        let sql = `select extrinsicHash, xcmIndex, transferIndex, sourceTS, extrinsicID, chainID from xcmtransfer where chainIDDest >=0 and chainIDDest < 40000 and destStatus = -1 and sourceTS > UNIX_TIMESTAMP("2023-02-28") and  sourceTS < UNIX_TIMESTAMP(Date_sub(Now(), interval 2 MINUTE)) and ( matchAttemptDT is null or matchAttemptDT < date_sub(Now(), INTERVAL POW(3, matchAttempts) MINUTE) ) and symbol is not null ${w}  order by matchAttempts asc, sourceTS desc limit ${limit}`;
        console.log(sql);
        let extrinsics = await this.pool.query(sql);
        let extrinsic = {};
        let extrinsicconfidence = {};
        let results = {};
        if (extrinsics.length == 0) {
            return (false);
        }
        for (const e of extrinsics) {
            try {
                let xcmInfo = await this.generate_extrinsic_XCMInfo(e.extrinsicHash, e.transferIndex, e.xcmIndex);
            } catch (err) {
                console.log(err);
            }
        }
        return (true);
    }


}