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
const AssetManager = require("./assetManager");
const mysql = require("mysql2");
const paraTool = require("./paraTool");
const btTool = require("./btTool");

module.exports = class XCMManager extends Query {
    constructor() {
        super("manager")
    }

    xcmErrorMap = {}
    lastupdateTS = 0
    irregularFeeUSDThreshold = 5 //consider feeUSD above this threshold "Irregular" -  historically feeUSD should be lower than the ED


    setDebugLevel(debugLevel = paraTool.debugInfo) {
        this.debugLevel = debugLevel
    }

    async setupChainAndAPI(chainID, withSpecVersions = true, backfill = false) {
        let chain = await this.getChainWithVersion(chainID, withSpecVersions);
        await this.setupAPI(chain, backfill);
        this.relayChain = chain.relayChain;
        return (chain);
    }

    async auditMsgHash(limit = 1000) {
        let sql = `select msgHash, msgHex from xcmmessages where msgHashAudited = -1 order by blockTS desc limit ${limit}`;
        let msgs = await this.poolREADONLY.query(sql)
        let hashMap = {}
        let validHashes = []
        let invalidHashes = []
        let unknownErrHashes = []
        for (const m of msgs) {
            try {
                let rawMsgHash = `${m.msgHash}`
                if (hashMap[rawMsgHash] != undefined) continue
                hashMap[rawMsgHash] = 1
                let rawHex = `${m.msgHex}`
                let instructions = this.api.registry.createType('XcmVersionedXcm', rawHex);
                let derivedInstructionHex = instructions.toHex()
                if (derivedInstructionHex != rawHex) {
                    let remaining = '0x' + rawHex.replace(derivedInstructionHex, '')
                    console.log(`mismatch!! [msgHash=${rawMsgHash}] rawHexLen=${rawHex.length-2}, derivedHexLen${derivedInstructionHex.length-2}), remainingLen=${remaining.length-2}`)
                    invalidHashes.push(rawMsgHash)
                } else {
                    //console.log(`valid [msgHash=${rawMsgHash}] rawHex=${rawHex}, derivedHex=${derivedInstructionHex}`)
                    validHashes.push(rawMsgHash)
                }
            } catch (e) {
                console.log(`auditMsgHash error`, e, m)
                if (m.msgHash != undefined) unknownErrHashes.push(m.msgHash)
            }
        }
        if (validHashes.length > 0) {
            let validHashList = "'" + validHashes.join("','") + "'"
            let validSQL = `update xcmmessages set msgHashAudited = 1 where msgHash in (${validHashList})`
            console.log(`mark valid sz=${validHashes.length}`)
            this.batchedSQL.push(validSQL);
        }
        if (invalidHashes.length > 0) {
            let invalidHashList = "'" + invalidHashes.join("','") + "'"
            let invalidSQL = `update xcmmessages set msgHashAudited = 0 where msgHash in (${invalidHashList})`
            console.log(`mark invalid sz=${invalidHashes.length}`, invalidSQL)
            this.batchedSQL.push(invalidSQL);
        }
        if (unknownErrHashes.length > 0) {
            let unknownErrHashesList = "'" + unknownErrHashes.join("','") + "'"
            let unknownSQL = `update xcmmessages set msgHashAudited = -2 where msgHash in (${unknownErrHashesList})`
            console.log(`mark unknown sz=${unknownErrHashes.length}`, unknownSQL)
            this.batchedSQL.push(unknownSQL);
        }
        await this.update_batchedSQL();
        if (msgs.length == 0) {
            //DONE
            return false
        }
        return true
    }

    // generates xcmmessagelog, xcmassetlog, and tallies activity in last 24h/7d/30 in channel, xcmasset
    async update_xcmlogs(lookbackDays = 1) {
        // tally all the symbols
        let sql = `select chainID, chainIDDest, symbol, relayChain, sum(numXCMTransfersOutgoingUSD) numXCMTransfersOutgoingUSD, sum(valXCMTransferOutgoingUSD) valXCMTransferOutgoingUSD from xcmassetlog where logDT >= date_sub(Now(), interval 90 day) group by chainID, chainIDDest, symbol, relayChain order by numXCMTransfersOutgoingUSD desc, valXCMTransferOutgoingUSD desc`;
        let channel_symbols = await this.poolREADONLY.query(sql)
        let channel = {}
        for (const c of channel_symbols) {
            let k = `${c.chainID}:${c.chainIDDest}`
            let symbolChain = paraTool.makeAssetChain(c.symbol, c.relayChain);
            if (channel[k] == undefined) {
                channel[k] = {};
            }
            channel[k][symbolChain] = {
                numXCMTransfersOutgoingUSD: c.numXCMTransfersOutgoingUSD,
                valXCMTransferOutgoingUSD: c.valXCMTransferOutgoingUSD
            };
        }
        let out = [];
        for (const k of Object.keys(channel)) {
            let symbols = JSON.stringify(Object.keys(channel[k]))
            let [chainID, chainIDDest] = k.split(":");
            out.push(`('${chainID}', '${chainIDDest}', ${mysql.escape(symbols)})`)
        }
        await this.upsertSQL({
            "table": `channel`,
            "keys": ["chainID", "chainIDDest"],
            "vals": ["symbols"],
            "data": out,
            "replace": ["symbols"],
        });

        // tally recent xcmmessages into xcmmessagelog (up to lookbackDays)  -- which has a daily log of chainID/chainIDDest/logDT
        let sql_xcmmessagelog = `insert into xcmmessagelog
      (select chainID, chainIDDest,
        date(from_unixtime(destTS)) as logDT,
        count(*) as numXCMMessagesOutgoingUSD,
        sum(amountReceivedUSD) as valXCMMessagesOutgoingUSD
      from xcmmessages where matched = 1 and incoming = 1 and sourceTS >= unix_timestamp(date(date_sub(Now(), interval ${lookbackDays} day)))
      group by chainID, chainIDdest, logDT)
      on duplicate key update numXCMMessagesOutgoingUSD = values(numXCMMessagesOutgoingUSD), valXCMMessagesOutgoingUSD = values(valXCMMessagesOutgoingUSD);`
        this.batchedSQL.push(sql_xcmmessagelog);
        await this.update_batchedSQL();

        // tally recent xcmtransfer into xcmassetlog (up to lookbackDays) -- which has a daily log of symbol/relayChain/logDT
        let sql_xcmassetlog = `insert into xcmassetlog
      (select xcmasset.symbol, xcmasset.relayChain,
        date(from_unixtime(destTS)) as logDT,
        xcmtransfer.chainID,
        xcmtransfer.chainIDDest,
        count(*) as numXCMTransfersOutgoingUSD,
        sum(amountReceivedUSD) as valXCMTransferOutgoingUSD
      from asset, xcmtransfer join xcmasset on xcmtransfer.xcmInteriorKey = xcmasset.xcmInteriorKey
        where incomplete = 0 and
        sourceTS >= unix_timestamp(date(date_sub(Now(), interval ${lookbackDays} day))) and
        destTS is not null and
        asset.xcmInteriorKey = xcmasset.xcmInteriorKey and
        asset.chainID = xcmtransfer.chainID
      group by xcmasset.symbol, xcmasset.relayChain, logDT, chainID, chainIDdest)
      on duplicate key update numXCMTransfersOutgoingUSD = values(numXCMTransfersOutgoingUSD), valXCMTransferOutgoingUSD = values(valXCMTransferOutgoingUSD);`
        this.batchedSQL.push(sql_xcmassetlog);
        await this.update_batchedSQL();

        let daysAgoIntervals = [1, 7, 30]
        for (const daysAgo of daysAgoIntervals) {
            // tally recent xcmmessages into channel (1/7/30d)
            let sql_channel = `update channel, (select chainID, chainIDDest, count(*) as numXCMMessagesOutgoing, sum(amountReceivedUSD) as valXCMMessagesOutgoingUSD from xcmmessages where blockTS >= unix_timestamp(date_sub(Now(), interval ${daysAgo} day)) and matched = 1 and incoming = 1
             group by chainID, chainIDdest)  as t
              set channel.numXCMMessagesOutgoing${daysAgo}d = t.numXCMMessagesOutgoing,
              channel.valXCMMessagesOutgoingUSD${daysAgo}d = t.valXCMMessagesOutgoingUSD
             where  channel.chainID = t.chainID and
                    channel.chainIDDest = t.chainIDDest`;
            //console.log(daysAgo, sql_channel);
            this.batchedSQL.push(sql_channel);
            await this.update_batchedSQL();
            // tally recent xcmtransfer into xcmasset (1/7/30d)
            let sql_xcmasset = `update xcmasset, (    select xcmasset.symbol, xcmasset.relayChain, count(*) as numXCMTransfer,  sum(amountReceivedUSD) as valXCMTransferUSD
                  from asset, xcmtransfer join xcmasset on xcmtransfer.xcmInteriorKey = xcmasset.xcmInteriorKey
                    where incomplete = 0 and
                    sourceTS >= unix_timestamp(date(date_sub(Now(), interval 1 day))) and
                    destTS is not null and
                    asset.xcmInteriorKey = xcmasset.xcmInteriorKey and
                    asset.chainID = xcmtransfer.chainID
                  group by xcmasset.symbol, xcmasset.relayChain )  as t
                set xcmasset.numXCMTransfer${daysAgo}d = t.numXCMTransfer,
                xcmasset.valXCMTransferUSD${daysAgo}d = t.valXCMTransferUSD
               where  xcmasset.symbol = t.symbol and
                      xcmasset.symbol = t.symbol`;
            //console.log(daysAgo, sql_xcmasset);
            this.batchedSQL.push(sql_xcmasset);
            await this.update_batchedSQL();
        }
    }

    async patchXcmAsset() {
        let alphaAssets = await this.poolREADONLY.query(`select assetType, asset.assetName, asset.numHolders, asset.totalSupply, asset.asset, asset.symbol, asset.xcmInteriorKey, xcmasset.symbol as xcmasset_symbol, xcmasset.relayChain as xcmasset_relayChain, asset.decimals, asset.token0, asset.token0Symbol, asset.token0Decimals, asset.token1, asset.token1Symbol, asset.token1Decimals, asset.chainID, chain.id, chain.chainName, asset.isUSD, asset.priceUSD, asset.priceUSDPercentChange,  asset.nativeAssetChain, currencyID, xcContractAddress, from_unixtime(createDT) as createTS from asset left join xcmasset on asset.xcmInteriorKey = xcmasset.xcmInteriorKey, chain where asset.chainID = chain.chainID and assetType in ('Token') and asset.chainID = ${paraTool.chainIDMoonbaseAlpha}`);
        let alphaMap = {}
        for (const a of alphaAssets) {
            //console.log(a)
            let alphaSymbol = a.symbol.replace('xc', '')
            let relayChain = paraTool.getRelayChainByChainID(a.chainID)
            let alphaSymbolRelayChain = paraTool.makeAssetChain(alphaSymbol, relayChain)
            alphaMap[alphaSymbolRelayChain] = a
        }
        //console.log(`alphaMap`, alphaMap)
        let relayChain = paraTool.getRelayChainByChainID(paraTool.chainIDMoonbaseAlpha)
        let xcmAssets = await this.poolREADONLY.query(`select * from xcmasset where relayChain = '${relayChain}'`);
        let xcmAssetsOut = []
        let assetsOut = []
        for (const x of xcmAssets) {
            //console.log(x)
            let symbol = x.symbol
            let relayChain = x.relayChain
            let symbolRelayChain = paraTool.makeAssetChain(symbol, relayChain)
            let alphaAsset = alphaMap[symbolRelayChain]
            if (alphaAsset != undefined) {
                //console.log(`${symbolRelayChain} found, decimals`, alphaAsset.decimals)
                let t = "(" + [`'${x.xcmInteriorKey}'`, `'${symbol}'`, `'${relayChain}'`, `'${x.parent}'`, `'${x.nativeAssetChain}'`, `'${alphaAsset.decimals}'`, `Now()`].join(",") + ")";
                xcmAssetsOut.push(t)
                let xcContractAddress = paraTool.xcAssetIDToContractAddr(alphaAsset.currencyID).toLowerCase()
                let t1 = "(" + [`'${alphaAsset.asset}'`, `'${alphaAsset.chainID}'`, `'${x.xcmInteriorKey}'`, `'${xcContractAddress}'`].join(",") + ")";
                assetsOut.push(t1)
            } else {
                console.log(`${symbolRelayChain} not found`)
            }
        }
        //symbol, relayChain, xcmInteriorKey, xcmChainID, parent, nativeAssetChain, decimals
        let sqlDebug = true
        let xcmAssetsVals = ["parent", "nativeAssetChain", "decimals", "addDT"]
        await this.upsertSQL({
            "table": `xcmasset`,
            "keys": ["xcmInteriorKey", "symbol", "relayChain"],
            "vals": xcmAssetsVals,
            "data": xcmAssetsOut,
            "replace": xcmAssetsVals
        }, sqlDebug);

        let assetsVals = ["xcmInteriorKey", "xcContractAddress"]
        await this.upsertSQL({
            "table": `asset`,
            "keys": ["asset", "chainID"],
            "vals": ["xcmInteriorKey", "xcContractAddress"],
            "data": assetsOut,
            "replace": assetsVals
        }, sqlDebug);
    }

    async updateHrmpChannelEvents() {
        let msgs = await this.poolREADONLY.query("select msgHash, sentAt, sourceTS, from_unixtime(sourceTS) as messageDT, chainID, chainIDDest, msgStr from xcmmessages where ((incoming = 0 and matched = 0) or ( incoming = 1 and matched = 1 )) and msgStr like '%hrmp%' limit 200000;");
        let openRequests = [];
        let accepts = [];
        let closings = [];
        for (const m of msgs) {
            let msg = JSON.parse(m.msgStr)
            let chainID = m.chainID;
            let relayChain = paraTool.getRelayChainByChainID(m.chainID);
            let chainIDDest = m.chainIDDest;
            for (const ver of Object.keys(msg)) {
                let instructions = msg[ver];
                for (const inst of instructions) {
                    if (inst.hrmpNewChannelOpenRequest) { // Ex: { hrmpNewChannelOpenRequest: { sender: 2035, maxMessageSize: 102400, maxCapacity: 1000 }}
                        let i = inst.hrmpNewChannelOpenRequest;
                        let fromChainID = paraTool.getChainIDFromParaIDAndRelayChain(i.sender, relayChain);
                        openRequests.push(`('${fromChainID}', '${chainIDDest}', '${relayChain}', '${m.msgHash}', '${m.sentAt}', ${mysql.escape(m.sourceTS)}, '${i.maxMessageSize}', '${i.maxCapacity}', Now(), '${m.sentAt}', 'Requested')`);
                        console.log("hrmpMsg OPEN REQUEST", m.messageDT, relayChain, fromChainID, chainIDDest, i.maxMessageSize, i.maxCapacity);
                    } else if (inst.hrmpChannelAccepted) { // Ex: { hrmpChannelAccepted: { recipient: 2035 } }
                        let i = inst.hrmpChannelAccepted;
                        let toChainID = paraTool.getChainIDFromParaIDAndRelayChain(i.recipient, relayChain);
                        accepts.push(`( '${chainIDDest}', '${toChainID}', '${relayChain}', '${m.msgHash}', '${m.sentAt}', ${mysql.escape(m.sourceTS)}, Now(), '${m.sentAt}', 'Accepted')`);
                        console.log("hrmpMsg CHANNEL ACCEPTED", m.messageDT, relayChain, chainIDDest, toChainID);
                    } else if (inst.hrmpChannelClosing) { // Ex: hrmpChannelClosing: { initiator: 2001, sender: 2000, recipient: 2001 }
                        let i = inst.hrmpChannelClosing;
                        let closingInitiatorChainID = paraTool.getChainIDFromParaIDAndRelayChain(i.initiator, relayChain);
                        let senderChainID = paraTool.getChainIDFromParaIDAndRelayChain(i.sender, relayChain);
                        let recipientChainID = paraTool.getChainIDFromParaIDAndRelayChain(i.recipient, relayChain);
                        let sql2 = `select chainID, chainIDDest, lastUpdateBN from hrmpchannel where ( chainID = '${senderChainID}' and chainIDDest = '${recipientChainID}' ) or ( chainIDDest = '${recipientChainID}' and chainID = '${senderChainID}' )`
                        let hrmpchannels = await this.poolREADONLY.query(sql2);
                        for (const n of hrmpchannels) {
                            closings.push(`('${n.chainID}', '${n.chainIDDest}', '${relayChain}', '${m.msgHash}', '${m.sentAt}', '${m.sourceTS}', '${closingInitiatorChainID}', Now(),  '${m.sentAt}', 'Closed')`)
                            console.log("hrmpMsg CHANNEL CLOSED", m.messageDT, relayChain, n.chainID, n.chainIDDest);
                        }
                    } else {
                        console.log("TODO", inst);
                    }
                }
            }
        }
        let valsOpenRequests = ["msgHashOpenRequest", "sentAtOpenRequest", "openRequestTS", "maxMessageSize", "maxCapacity", "addDT", "lastUpdateBN", "status"]
        let valsAccepts = ["msgHashAccepted", "sentAtAccepted", "acceptTS", "addDT", "lastUpdateBN", "status"]
        let valsClosing = ["msgHashClosing", "sentAtClosing", "closingTS", "closingInitiatorChainID", "addDT", "lastUpdateBN", "status"]
        await this.upsertSQL({
            "table": `channel`,
            "keys": ["chainID", "chainIDDest", "relayChain"],
            "vals": valsOpenRequests,
            "data": openRequests,
            "replace": ["msgHashOpenRequest", "sentAtOpenRequest", "openRequestTS", "maxMessageSize", "maxCapacity"],
            "lastUpdateBN": ["lastUpdateBN", "status", "addDT"]
        });
        await this.upsertSQL({
            "table": `channel`,
            "keys": ["chainID", "chainIDDest", "relayChain"],
            "vals": valsAccepts,
            "data": accepts,
            "replace": ["msgHashAccepted", "sentAtAccepted", "acceptTS"],
            "lastUpdateBN": ["lastUpdateBN", "status", "addDT"]
        });
        await this.upsertSQL({
            "table": `channel`,
            "keys": ["chainID", "chainIDDest", "relayChain"],
            "vals": valsClosing,
            "data": closings,
            "replace": ["msgHashAccepted", "sentAtAccepted", "closingTS"],
            "lastUpdateBN": ["lastUpdateBN", "status", "addDT"]
        });
    }

    async updateXcmTransferRoute() {
        // add new xcmasset records that have recently appeared in the asset table
        let sql = `select chainID, xcmInteriorKey, nativeAssetChain, symbol, numholders from asset where xcminteriorkey is not null and xcminteriorkey not in (select xcminteriorkey from xcmasset) and chainID < 50000 and xcminteriorkey != 'null'`;
        let xcAssetRecs = await this.poolREADONLY.query(sql);
        let vals = ["xcmInteriorKey", "nativeAssetChain", "addDT"];
        let out = [];
        let covered = {};
        for (const xc of xcAssetRecs) {
            try {
                let relayChain = paraTool.getRelayChainByChainID(xc.chainID)
                let k = paraTool.makeAssetChain(xc.symbol, relayChain);
                if (covered[k] == undefined) {
                    out.push(`('${xc.symbol}', '${relayChain}', ${mysql.escape(xc.xcmInteriorKey)}, ${mysql.escape(xc.nativeAssetChain)}, Now())`)
                    covered[k] = true;
                }
            } catch (err) {
                console.log(`updateXcAssetContractAddr error:${err.toString()}`)
            }
        }
        await this.upsertSQL({
            "table": `xcmasset`,
            "keys": ["symbol", "relayChain"],
            "vals": vals,
            "data": out,
            "replace": vals
        });
        let sqlroute = `insert into xcmtransferroute ( asset, assetDest, symbol, chainID, chainIDDest, cnt) (select asset.asset, assetDest.asset, xcmasset.symbol, xcmtransfer.chainID, xcmtransfer.chainIDDest, count(*) as cnt from xcmtransfer, xcmasset, asset, asset as assetDest where xcmtransfer.xcmInteriorKey = xcmasset.xcmInteriorKey and xcmasset.xcmInteriorKey = asset.xcmInteriorKey and asset.chainID = xcmtransfer.chainID and xcmasset.xcmInteriorKey = assetDest.xcmInteriorKey and assetDest.chainID = xcmtransfer.chainIDDest and sourceTS > UNIX_TIMESTAMP(date_sub(Now(), interval 30 day)) and assetDest.assetType = "Token" and asset.assetType = "Token" group by asset.asset, assetDest.asset, xcmasset.symbol, xcmtransfer.chainID, xcmtransfer.chainIDDest) on duplicate key update asset = values(asset), assetDest = values(assetDest), cnt = values(cnt);`
        this.batchedSQL.push(sqlroute);
        await this.update_batchedSQL();
    }

    async updateXcAssetContractAddr() {
        let xcAssetRecs = await this.poolREADONLY.query(`select chainID, asset, assetname, symbol, decimals, xcmInteriorKey from asset where assetType = "Token" and chainID in (${paraTool.chainIDMoonbeam},${paraTool.chainIDMoonriver},${paraTool.chainIDAstar},${paraTool.chainIDShiden},${paraTool.chainIDShibuya},${paraTool.chainIDMoonbaseAlpha},${paraTool.chainIDMoonbaseBeta}) order by chainID`);
        let xcAssetList = [];
        let xcContractAddrUpdates = []
        let xcInteriorKeyUpdates = []

        for (const xc of xcAssetRecs) {
            try {
                let asset = JSON.parse(xc.asset)
                if (asset.Token == xc.symbol) continue //GLMR/MOVR/DEV/SDN/ASTR/SBY etc..
                let xcAssetID = asset.Token
                let xcContractAddress = paraTool.xcAssetIDToContractAddr(xcAssetID).toLowerCase()
                let xcAsset = {
                    chainID: xc.chainID,
                    asset: xc.asset,
                    xcContractAddress: xcContractAddress,
                    xcmInteriorKey: xc.xcmInteriorKey,
                }
                xcAssetList.push(xcAsset)
            } catch (err) {
                console.log(`updateXcAssetContractAddr error:${err.toString()}`)
            }
        }
        for (const xcAsset of xcAssetList) {
            //["asset", "chainID"] + ["xcContractAddress"]
            let xcmInteriorKey = (xcAsset.xcmInteriorKey != undefined && xcAsset.xcmInteriorKey != 'null' && xcAsset.xcmInteriorKey != 'NULL') ? `'${xcAsset.xcmInteriorKey}'` : 'NULL'
            let c = `('${xcAsset.asset}', '${xcAsset.chainID}', '${xcAsset.xcContractAddress}', ${xcmInteriorKey})`
            xcContractAddrUpdates.push(c)

            //["asset", "chainID"] + ["xcContractAddress", "xcmInteriorKey"]
            //let xcmInteriorKey = (xcAsset.xcmInteriorKey != undefined) ? `'${xcAsset.xcmInteriorKey}'` : `NULL`
            //let x = `('${xcAsset.xcContractAddress}', '${xcAsset.chainID}', '${xcAsset.xcContractAddress}', ${xcmInteriorKey})`
            //xcInteriorKeyUpdates.push(x)
        }

        //console.log(xcContractAddrUpdates)
        //console.log(xcInteriorKeyUpdates)

        let sqlDebug = true
        let xcContractAddressVal = ["xcContractAddress", "xcmInteriorKey"]
        await this.upsertSQL({
            "table": `asset`,
            "keys": ["asset", "chainID"],
            "vals": xcContractAddressVal,
            "data": xcContractAddrUpdates,
            "replace": xcContractAddressVal,
        }, sqlDebug);

        /*let xcInteriorKeyVal = ["xcContractAddress", "xcmInteriorKey"]
        await this.upsertSQL({
            "table": `asset`,
            "keys": ["asset", "chainID"],
            "vals": xcInteriorKeyVal,
            "data": xcInteriorKeyUpdates,
            "replace": xcInteriorKeyVal,
        }, sqlDebug); */
    }


    // This is the key workhorse that matches xcmmessages with
    // match xcmmessages incoming = 0 (s) with incoming = 1 (d)
    //   (a) msgHash + chainID + chainIDDest matching between s and d
    //   (b) time difference between sentAt to be less than 4
    //   (c) with s and d blockTS being within lookbackSeconds (default 120) of each other
    // In case of ties, the FIRST one ( "order by diffTS" ) covers this
    async xcmmessages_match(startTS, endTS = null, lookbackSeconds = 120, targetChainID = 'all', forceRematch = false) {
        let rematchClause = forceRematch ? `` : `s.matched = 0 and d.matched = 0 `
        let endWhere = endTS ? `and s.blockTS < ${endTS} and d.blockTS < ${endTS+lookbackSeconds}` : " "
        let targetChainClause = (targetChainID == 'all') ? ` ` : `(s.chainID = ${targetChainID} or s.chainIDDest = ${targetChainID}) and `
        let sqlA = `select
          s.msgHash, s.msgType, s.relayChain, s.blockNumber as s_blockNumber, d.blockNumber as d_blockNumber, s.sentAt as s_sentAt, d.sentAt as d_sentAt, s.chainID, s.chainIDDest, d.blockTS as destTS, s.blockTS as sourceTS, abs(d.blockTS - s.blockTS) as diffTS, (d.sentAt - s.sentAt) as diffSentAt, d.errorDesc as d_errorDesc, d.destStatus as d_destStatus, d.executedEventID as d_executedEventID, d.connectedTxHash
        from xcmmessages as s, xcmmessages as d
 where  d.msgHash = s.msgHash and
        d.chainID = s.chainID and
        d.chainIDDest = s.chainIDDest and ${targetChainClause}
        s.incoming = 0 and
        d.incoming = 1 and
        s.blockTS >= ${startTS} and
        d.blockTS >= ${startTS} and
        ${rematchClause}
        ${endWhere}
 having (diffSentAt >= 0 and diffSentAt <= 4)
 order by msgHash, diffSentAt, diffTS`
        sqlA = paraTool.removeNewLine(sqlA).replaceAll("and and", "and ")
        //console.log(`xcmmessages_match (A)`, sqlA)
        try {
            let xcmmatches = await this.pool.query(sqlA);
            let matched = {}
            let numRecs = 0;
            if (xcmmatches.length > 0) {
                //console.log(`[Found] xcmmessages_match ${xcmmatches.length}`)
                //console.log(paraTool.removeNewLine(sqlA))
            } else {
                //enable this for debugging
                //console.log("[Empty] xcmmessages_match")
                //console.log(paraTool.removeNewLine(sqlA))
            }
            let vals = ["chainID", "chainIDDest", "sourceTS", "destTS", "matched", "sourceSentAt", "destSentAt", "sourceBlocknumber", "destBlocknumber", "matchDT", "errorDesc", "destStatus", "executedEventID"];
            let out = [];
            let rows = [];
            for (let i = 0; i < xcmmatches.length; i++) {
                let s = xcmmatches[i];
                // to protect against the same dest message matched more than once we keep in the "matched" map a set of msgHash-sentAt (for xcmmessages dest candidates)
                // Note in case of multiple matches, the "order by diffTS" in the SQL statment picks the FIRST one in time closest with the smallest diffTS
                let k = `${s.msgHash}:${s.d_sentAt}`
                if (matched[k] == undefined) {
                    out.push(`( '${s.msgHash}', ${s.s_blockNumber}, 0, '${s.chainID}', '${s.chainIDDest}', ${s.sourceTS}, ${s.destTS}, 1, '${s.s_sentAt}', '${s.d_sentAt}', '${s.s_blockNumber}', '${s.d_blockNumber}', Now(), ${mysql.escape(s.d_errorDesc)}, ${mysql.escape(s.d_destStatus)}, ${mysql.escape(s.d_executedEventID)} )`)
                    out.push(`( '${s.msgHash}', ${s.d_blockNumber}, 1, '${s.chainID}', '${s.chainIDDest}', ${s.sourceTS}, ${s.destTS}, 1, '${s.s_sentAt}', '${s.d_sentAt}', '${s.s_blockNumber}', '${s.d_blockNumber}', Now(), ${mysql.escape(s.d_errorDesc)}, ${mysql.escape(s.d_destStatus)}, ${mysql.escape(s.d_executedEventID)} )`)
                    // write { msgHash, sentAt, chainID, chainIDDest, msgType, blockTS, blockNumber, relayChain } to hashes xcmmessage:${sentAt}
                    this.push_rows_related_keys("xcmmessage", s.s_sentAt.toString(), rows, s.msgHash, {
                        msgHash: s.msgHash,
                        sentAt: s.s_sentAt,
                        chainID: s.chainID,
                        chainIDDest: s.chainIDDest,
                        msgType: s.msgType,
                        blockTS: s.sourceTS,
                        blockNumber: s.s_blockNumber,
                        relayChain: s.relayChain,
                    })
                    matched[k] = true;
                } else {
                    numRecs++;
                }
            }
            let logDT = new Date(startTS * 1000)
            //console.log(`xcmmessages_match ${startTS} covered ${logDT} MATCHES: `, out.length);
            await this.upsertSQL({
                "table": "xcmmessages",
                "keys": ["msgHash", "blockNumber", "incoming"],
                "vals": vals,
                "data": out,
                "replace": vals
            });
            await this.btHashes.insert(rows);
            //console.log("xcmmessages_match wrote btHashes rows=", rows.length);
            return (numRecs);
        } catch (err) {
            console.log("xcmmessages_match", err)
        }
    }

    // update lpasset.{token0xcmchainID, token1xcmchainID} with the chainID of the asset using the xcmasset table
    async xcmLiquidityPairsUpdate() {
        for (let i = 0; i < 2; i++) {
            let sql_lp = `update asset as lpasset, asset, xcmasset set lpasset.token0xcmchainID = xcmasset.xcmchainID where lpasset.token0 = asset.asset and lpasset.chainID = asset.chainID and xcmasset.xcmInteriorKey = asset.xcmInteriorKey and lpasset.assetType = 'LiquidityPair'`;
            this.batchedSQL.push(sql_lp);
            // on evm chains they have precompiles in xcContractAddress
            let sql_evm = `update asset as lpasset, asset, xcmasset set lpasset.token0xcmchainID = xcmasset.xcmchainID where lpasset.token0 = asset.xcContractAddress and lpasset.chainID = asset.chainID and xcmasset.xcmInteriorKey = asset.xcmInteriorKey and lpasset.assetType = 'ERC20LP';`;
            this.batchedSQL.push(sql_evm);
        }
        await this.update_batchedSQL()
    }

    async xcm_init() {
        await this.init_chain_asset_and_nativeAsset() // this will init assetInfo and assetLog
        //console.log(`this.xcmAssetInfo`, this.xcmAssetInfo)
    }

    async decodeXCM(hex) {
        var obj = this.api.registry.createType('XcmVersionedXcm', hex);
        return obj.toJSON();
    }

    async match_parentInclusionFingerprints(parentInclusionFingerprints, rec) {
        if (parentInclusionFingerprints == "[]") return (false);
        let sqlchild = `select incoming, msgHash, blockNumber, sentAt, instructionFingerprints, blockTS, msgHex, chainID, chainIDDest from xcmmessages where blockTS >= ${rec.blockTS} and blockTS <= ${rec.blockTS+60} and instructionFingerprints is not null and incoming = 0 order by blockTS limit 20`
        let childRecs = await this.pool.query(sqlchild);
        for (let c = 0; c < childRecs.length; c++) {
            let childRec = childRecs[c];
            if (this.compute_fingerprints_inclusion(parentInclusionFingerprints, childRec.instructionFingerprints)) {
                let updsql = `update xcmmessages set parentMsgHash = '${rec.msgHash}', parentBlocknumber='${rec.blockNumber}', parentSentAt='${rec.sentAt}' where msgHash = '${childRec.msgHash}' and blockNumber = '${childRec.blockNumber}' and incoming = '${childRec.incoming}'`;
                this.batchedSQL.push(updsql);
                // assume chain of messages, not doing tree yet
                let updsql2 = `update xcmmessages set childMsgHash = '${childRec.msgHash}', childBlockNumber='${childRec.blockNumber}', childSentAt='${childRec.sentAt}' where msgHash = '${rec.msgHash}' and blockNumber = '${rec.blockNumber}' and incoming = '${rec.incoming}'`;
                this.batchedSQL.push(updsql2);
                await this.update_batchedSQL();
                return (true);
            }
        }
        return (false);
    }

    // for any xcmmessages in a period:
    //  (a) update instructionFingerprints + parentInclusionFingerprints using getXCMParentFingerprintsOfChild + getXCMChildFingerprints
    //  (b) if there are parentfingerprints detected, look for childfingerprints in the next step
    //  (c) compute assetChains and beneficiaries
    async computeXCMFingerprints(startTS, endTS = null, targetChainID = 'all') {
        let lastTS = endTS;
        let targetChainClause = (targetChainID == 'all') ? ` ` : `and (chainID = ${targetChainID} or chainIDDest = ${targetChainID}) `
        let endWhere = (endTS) ? ` and blockTS <= ${endTS} ` : "";
        let sql = `select msgHash, msgHex, blockNumber, sentAt, incoming, chainID, chainIDDest, msgStr, blockTS, assetChains, instructionFingerprints from xcmmessages where blockTS >= ${startTS} ${targetChainClause} ${endWhere}  order by blockTS desc`;
        //console.log(`computeXCMFingerprints`)
        //console.log(paraTool.removeNewLine(sql))
        let xcmRecs = await this.pool.query(sql);
        let out = [];
        let vals = ["chainID", "chainIDDest", "parentInclusionFingerprints", "instructionFingerprints", "assetChains", "xcmInteriorKeys"];
        let parentIncFingerprints = [];
        //console.log("computeXCMFingerprints:", xcmRecs.length, sql)
        for (let r = 0; r < xcmRecs.length; r++) {
            let rec = xcmRecs[r];
            let msg = JSON.parse(rec.msgStr);
            try {
                if (r == 0) lastTS = rec.blockTS;
                let analysis = this.performAnalysisInstructions(msg, rec.chainID, rec.chainIDDest)
                let assetChains = Object.keys(analysis.assetChains);
                let xcmInteriorKeysRaw = Object.keys(analysis.xcmInteriorKeys);

                let xcmInteriorKeys = (xcmInteriorKeysRaw.length > 0) ? `'${xcmInteriorKeysRaw.join('|')}'` : `'Null'`
                var xcmObj = this.api.registry.createType('XcmVersionedXcm', rec.msgHex.toString());
                let parentInclusionFingerprints = [];
                let instructionFingerprints = []
                if (xcmObj.isV2) {
                    parentInclusionFingerprints = this.getXCMParentFingerprintsOfChild(xcmObj);
                    instructionFingerprints = this.getXCMChildFingerprints(xcmObj);
                    if (parentInclusionFingerprints.length > 0) {
                        parentIncFingerprints.push({
                            parentInclusionFingerprints,
                            rec
                        });
                    }
                }
                let res = `('${rec.msgHash}', '${rec.blockNumber}', '${rec.incoming}', '${rec.chainID}', '${rec.chainIDDest}', '${JSON.stringify(parentInclusionFingerprints)}', '${JSON.stringify(instructionFingerprints)}', ${mysql.escape(JSON.stringify(assetChains))}, ${xcmInteriorKeys})`
                //console.log(`computeXCMFingerprint`, res)
                out.push(res);
            } catch (err) {
                console.log(err);
            }
        }

        for (let i = 0; i < parentIncFingerprints.length; i++) {
            let p = parentIncFingerprints[i];
            await this.match_parentInclusionFingerprints(p.parentInclusionFingerprints, p.rec);
        }

        if (out.length > 0) {
            //console.log(`computeXCMFingerprints len=${out.length}`);
            let sqlDebug = false
            await this.upsertSQL({
                "table": "xcmmessages",
                "keys": ["msgHash", "blockNumber", "incoming"],
                "vals": vals,
                "data": out,
                "replace": vals
            }, sqlDebug);
            out = [];
        }
        return lastTS;
    }


    /* because the indexer may insert multiple xcmmessages record when a partcular xcmmessage sits in the chains message queue for 1 or more blocks, this xcmmessages_dedup process cleans out any records that exist after the above matching process */
    async xcmmessages_dedup(startTS, endTS = null, lookbackSeconds = 120, targetChainID = 'all') {
        let endWhere = endTS ? `and s.blockTS < ${endTS} and d.blockTS < ${endTS+lookbackSeconds}` : "";
        let targetChainClause = (targetChainID == 'all') ? ` ` : `(s.chainID = ${targetChainID} or s.chainIDDest = ${targetChainID}) and `
        let sql = `select
          s.msgHash, s.blockNumber as s_blockNumber, s.incoming, (d.sentAt - s.sentAt) as diffSentAt
        from xcmmessages as s, xcmmessages as d
 where  d.msgHash = s.msgHash and
        d.chainID = s.chainID and
        d.chainIDDest = s.chainIDDest and ${targetChainClause}
        ( ( s.incoming = 0 and  d.incoming = 1 ) or ( s.incoming = 1 and d.incoming = 0 ) ) and
        s.blockTS >= ${startTS} and
        d.blockTS >= ${startTS} and
        s.matched = 0 and
        d.matched = 1 ${endWhere}
having (diffSentAt >= 0 and diffSentAt <= 4)
order by msgHash`
        //console.log("xcmmessages_dedup", paraTool.removeNewLine(sql))
        try {
            let xcmsingles = await this.pool.query(sql);
            let vals = ["matched"];
            let out = [];
            for (let i = 0; i < xcmsingles.length; i++) {
                let s = xcmsingles[i];
                out.push(`('${s.msgHash}', ${s.s_blockNumber}, ${s.incoming}, '-1')`)
            }
            //console.log(`xcmmessages_singles_dedup`, out);
            await this.upsertSQL({
                "table": "xcmmessages",
                "keys": ["msgHash", "blockNumber", "incoming"],
                "vals": vals,
                "data": out,
                "replace": vals
            });
        } catch (err) {
            console.log("xcmmessages_match", err)
        }
    }

    async waitForNewXCMMessage(minTS, waitMS = 2000, maxIterations = 10) {
        let iterations = 0;
        do {
            let sql = `select msgHash, blockTS from xcmmessages where blockTS > ${minTS} order by blockTS`
            //console.log(sql);
            let x = await this.poolREADONLY.query(sql);
            if (x.length > 0) {
                return x[0].blockTS;
            } else {
                await this.sleep(waitMS);
            }
            iterations++;
        } while (iterations < maxIterations);
    }

    async xcmanalytics_period(chain, t0, t1 = null, forceRematch = false, targetChainID = 'all') {
        let rat = 0.97
        let transferLookbackwindow = 7200
        let msgLookbackwindow = 120

        if (forceRematch) {
            let numRecs_ = await this.xcmmessages_match(t0, t1, msgLookbackwindow, targetChainID, forceRematch);
            return [0, 0];
        } else {
            //console.log(`[NONFORCED] match ${t0} ${t1} (chain:${targetChainID}, msgLookbackwindow:${msgLookbackwindow})`);
            // xcmmessages_match matches incoming=0 and incoming=1 records
            let numRecs = await this.xcmmessages_match(t0, t1, msgLookbackwindow, targetChainID, forceRematch);
            // computeXCMFingerprints updates any xcmmessages which have not been fingerprinted, fill in xcmmessages.{parentInclusionFingerprints, instructionFingerprints}
            let lastTS = await this.computeXCMFingerprints(t0, t1, targetChainID);
            // marks duplicates in xcmmessages
            await this.xcmmessages_dedup(t0, t1, msgLookbackwindow, targetChainID);
            await this.writeBTHashes_feedxcmmessages(t0, t1);
            return [numRecs, lastTS];
        }
    }

    async xcmanalytics(chain, lookbackDays, forceRematch = false) {
        let endTS = this.currentTS();
        let startTS = endTS - lookbackDays * 86400;
        for (let ts = startTS; ts < endTS; ts += 86400) {
            let t0 = ts;
            let t1 = ts + 86400;
            await this.xcmanalytics_period(chain, t0, t1, forceRematch);
        }
    }

    async writeBTHashes_feedxcmmessages(startTS, endTS = null) {
        // write to hashes bigtable
        let sql = `select msgHash, chainID, chainIDDest, msgType, msgStr, relayChain, version, path, executedEventID, destStatus, errorDesc, extrinsicHash, extrinsicID, sectionMethod, assetChains,
      parentMsgHash, parentSentAt, parentBlockNumber, childMsgHash, childSentAt, childBlocknumber, sourceTS, destTS, sourceSentAt, destSentAt, sourceBlocknumber, destBlocknumber, beneficiaries, assetsReceived, amountReceivedUSD
      from xcmmessages where blockTS >= ${startTS} and blockTS <= ${endTS} and matched = 1 limit 1`
        let hashesRowsToInsert = [];
        let messages = await this.poolREADONLY.query(sql)
        for (let i = 0; i < messages.length; i++) {
            let s = messages[i]
            let hashrec = {};
            let col = `${s.chainID}:${s.chainIDDest}:${s.sourceBlocknumber}:${s.destBlocknumber}`
            hashrec[col] = {
                value: JSON.stringify(s),
                timestamp: s.sourceTS * 1000
            };
            let msgHashRec = {
                key: s.msgHash,
                data: {},
            }
            msgHashRec.data["feedxcmmessages"] = hashrec
            hashesRowsToInsert.push(msgHashRec)
        }
        if (hashesRowsToInsert.length > 0) {
            await this.insertBTRows(this.btHashes, hashesRowsToInsert, "hashes");
        }
    }

    async matchPeriod(forceRematch = true, chainID, logDT, hr) {
        let targetChainID = chainID
        if (chainID == 'all') chainID = '0'
        let indexTSPeriod = paraTool.logDT_hr_to_ts(logDT, hr);
        var sql = `select floor(UNIX_TIMESTAMP(blockDT)/3600)*3600 as indexTS, min(blockNumber) startBN, max(blockNumber) endBN from block${chainID} where blockDT >= FROM_UNIXTIME(${indexTSPeriod}) and blockDT < FROM_UNIXTIME(${indexTSPeriod+3600}) group by indexTS order by indexTS;`
        var periods = await this.poolREADONLY.query(sql);
        //console.log(sql)
        //console.log(`periods`, periods)
        console.log(`matchPeriod chain=${targetChainID} [${logDT} ${hr}]`)

        let chain = await this.setupChainAndAPI(chainID);
        //console.log(chain);

        let indexPeriodProcessedCnt = 0
        for (let i = 0; i < periods.length; i++) {
            let period = periods[i]
            let t0 = period.indexTS - 1
            let t1 = period.indexTS + 3599
            //let forceRematch = true //MK why is forceRematch being added here??
            await this.xcmanalytics_period(chain, t0, t1, forceRematch, targetChainID);
        }
    }

    async xcm_reanalytics() {
        // sourceTS >= UNIX_TIMESTAMP("2021-01-01") and destStatus = 1 and
        let sql = `select chainID, chainIDDest, symbol, relayChain, extrinsicHash, extrinsicID, xcmIndex, isFeeItem, transferIndex, destStatus, sourceTS, xcmInteriorKey, convert(xcmInfo using utf8) as xcmInfo from xcmtransfer where xcmInfo is not null and 
         xcmInfoAudited < 2 order by extrinsicHash, xcmIndex, transferIndex limit 5000`
        //check the (teleportFee = 0 or amountReceived = 0) condition..
        try {
            console.log(sql);
            let batchN = 0
            let hashesRowsToInsert = []
            let xcmmatches = await this.pool.query(sql);
            for (let i = 0; i < xcmmatches.length; i++) {
                let r = xcmmatches[i];
                let x = JSON.parse(r.xcmInfo);
                let teleportFee = 0;
                let teleportFeeUSD = 0;
                /*
                "symbol": "DOT",
                "xcmInteriorKey": "[{\"network\":\"polkadot\"},\"here\"]",
                "xcmInteriorKeyUnregistered": 0,
                "priceUSD": x,
                "relayChain": {
                    "relayChain": "polkadot",
                    "relayAt": _
                },
                "origination": {...},
                "destination": {...},
                "version": "V4"
                */
                if (x.origination && x.destination) {
                    let xcmInteriorKey = null
                    let xcmInteriorKeyV2 = null
                    let xcmInteriorKeyUnregistered = `NULL`
                    if (r.xcmInteriorKey != undefined) {
                        xcmInteriorKey = r.xcmInteriorKey
                        xcmInteriorKeyV2 = paraTool.convertXcmInteriorKeyV1toV2(xcmInteriorKey)
                        xcmInteriorKeyUnregistered = (this.isXcmInteriorKeyRegistered(xcmInteriorKey)) ? 0 : 1
                    }
                    let updatedXcmInfo = {
                        symbol: (x.symbol != undefined) ? x.symbol : null,
                        xcmInteriorKey: xcmInteriorKeyV2,
                        xcmInteriorKeyUnregistered: xcmInteriorKeyUnregistered,
                        priceUSD: (x.priceUSD != undefined) ? x.priceUSD : null,
                        relayChain: x.relayChain,
                        origination: x.origination,
                        destination: x.destination,
                        version: x.version
                    }
                    updatedXcmInfo.origination.xcmIndex = r.xcmIndex
                    updatedXcmInfo.origination.transferIndex = r.transferIndex
                    console.log(`updatedXcmInfo`, updatedXcmInfo)
                    let inp = {
                        symbol: r.symbol,
                        relayChain: r.relayChain,
                        ts: r.sourceTS
                    };
                    let sql0 = `update xcmtransfer set xcmInfoAudited = 2, xcmInfo = ${mysql.escape(JSON.stringify(updatedXcmInfo))}, xcmInteriorKeyUnregistered = ${xcmInteriorKeyUnregistered} where extrinsicHash = '${r.extrinsicHash}' and xcmIndex = '${r.xcmIndex}' and transferIndex = '${r.transferIndex}'`
                    console.log(`sql0`, sql0)
                    this.batchedSQL.push(sql0);
                    // write hashes xcminfofinalized
                    let hres = btTool.encode_xcminfofinalized(r.extrinsicHash, r.chainID, r.extrinsicID, updatedXcmInfo, r.sourceTS)
                    if (hres) hashesRowsToInsert.push(hres);
                    if (hashesRowsToInsert.length >= 500) {
                        await this.insertBTRows(this.btHashes, hashesRowsToInsert, "hashes");
                        console.log(`Batch#${batchN} flush hashesRowsToInsert ${hashesRowsToInsert.length}`)
                        hashesRowsToInsert = []
                        batchN++
                    }

                }
            }
            if (hashesRowsToInsert.length > 0) {
                await this.insertBTRows(this.btHashes, hashesRowsToInsert, "hashes");
                console.log(`Last Batch#${batchN} flush hashesRowsToInsert ${hashesRowsToInsert.length} DONE`)
                hashesRowsToInsert = []
            }
        } catch (err) {
            console.log("xcmtransfer_reanalytics", err)
        }
        await this.update_batchedSQL();
        return 0
    }


    // when we need to do some reanalytics on demand, xcmReanalytics writes hashes table with "xcminfofinalized" column records with "v4" column
    //  either an array or object based on the number of xcmInfo objects -- to cover xcmIndex > 0 and transferIndex > 0 situations
    async xcm_reanalytics_old() {
        let sql = `select chainID, chainIDDest, symbol, relayChain, extrinsicHash, extrinsicID, xcmIndex, isFeeItem, transferIndex, destStatus, sourceTS, convert(xcmInfo using utf8) as xcmInfo from xcmtransfer where xcmInfo is not null and sourceTS >= UNIX_TIMESTAMP("2023-01-01") and destStatus = 1 and (teleportFee = 0 or amountReceived = 0) and xcmInfoAudited < 2 order by extrinsicHash, xcmIndex, transferIndex limit 5000`
        try {
            console.log(sql);
            let xcmmatches = await this.pool.query(sql);
            for (let i = 0; i < xcmmatches.length; i++) {
                let r = xcmmatches[i];
                let x = JSON.parse(r.xcmInfo);
                let teleportFee = 0;
                let teleportFeeUSD = 0;
                if (x.origination && x.destination) {
                    let inp = {
                        symbol: r.symbol,
                        relayChain: r.relayChain,
                        ts: r.sourceTS
                    };
                    let q = await this.computePriceUSD(inp)
                    let priceUSD = q && q.priceUSD ? q.priceUSD : 0;
                    teleportFee = x.destination.teleportFee;
                    teleportFeeUSD = x.destination.teleportFeeUSD;
                    let errorDesc = "";
                    if (x.destination.error && x.destination.error.errorType) {
                        errorDesc = x.destination.error.errorType;
                    }
                    let teleportFee2 = x.origination.amountSent - x.destination.amountReceived;
                    let teleportFeeUSD2 = teleportFee2 * priceUSD;
                    let expectedXCMTeleportFees = this.getXCMTeleportFees(r.chainIDDest, r.symbol);
                    let destStatus = -1;
                    let xcmInfoAudited = 0;
                    if (x.destination.executionStatus == "success") {
                        destStatus = 1;
                    } else if (x.destination.executionStatus == "failed") {
                        destStatus = 0;
                    }
                    if (teleportFeeUSD2 > 5) {
                        destStatus = -1;
                        teleportFee2 = 0;
                        teleportFeeUSD2 = 0;
                        xcmInfoAudited = -1;
                        x.destination.executionStatus = "unknown";
                    } else {
                        xcmInfoAudited = 2;
                    }

                    if (r.isFeeItem && (teleportFeeUSD2 > 0) && (destStatus == 1)) {
                        x.destination.teleportFee = teleportFee2;
                        x.destination.teleportFeeUSD = teleportFeeUSD2;
                        x.destination.teleportFeeChainSymbol = r.symbol;
                    } else {
                        teleportFee2 = 0;
                        teleportFeeUSD2 = 0;
                        x.destination.teleportFee = null;
                        x.destination.teleportFeeUSD = null;
                        x.destination.teleportFeeChainSymbol = null;
                    }
                    let sql0 = `update xcmtransfer set destStatus = ${destStatus}, xcmInfoAudited = ${xcmInfoAudited}, teleportFee = '${teleportFee2}', teleportFeeUSD = '${teleportFeeUSD2}', amountReceived = ${mysql.escape(x.destination.amountReceived)}, amountReceivedUSD = ${mysql.escape(x.destination.amountReceivedUSD)}, xcmInfo = ${mysql.escape(JSON.stringify(x))} where extrinsicHash = '${r.extrinsicHash}' and xcmIndex = '${r.xcmIndex}' and transferIndex = '${r.transferIndex}'`
                    if (teleportFeeUSD2 > 5 || (destStatus == 1)) {
                        console.log(sql0);
                    }
                    this.batchedSQL.push(sql0);
                }
            }
        } catch (err) {
            console.log("xcmtransfer_reanalytics", err)
        }
        await this.update_batchedSQL();
        return 0
    }

    async xcmReanalytics() {
        while (true) {
            let x = await this.xcm_reanalytics();
            if (x == 0) {
                return (true);
            } else {
                await this.sleep(10000);
            }

        }
    }
    async fetch_indexToAccount(chainID = 61000, relayChain = 'moonbase-relay', index = null) {
        // TODO: when "index" is supplied (if this map gets too big, or to cover on demand situation)
        let derivedAccounts = (index) ? [] : await this.api.query.xcmTransactor.indexToAccount.entries()

        // take result of xcmTransactor.indexToAccount (all of them if index is null, or a specific one) and store in Mysql
        let out = [];
        let vals = ["relayChain", "address", "addDT"];
        for (const t of derivedAccounts) {
            let k = t[0].toHuman();
            let address = t[1].toJSON();
            let index = paraTool.toNumWithoutComma(k[0]);
            //console.log(index, k[0], address);
            out.push(`( '${chainID}', '${index}', '${relayChain}', '${address}', Now() )`);
            // TODO: store in BigTable addressrealtime new column family "derivedAccounts" ?
        }
        await this.upsertSQL({
            "table": `xcmtransactor_indexToAccount`,
            "keys": ["chainID", "indexToAccount"],
            "vals": vals,
            "data": out,
            "replace": ["address", "relayChain"]
        }, true);

    }

    computeSovereignAccount(paraID) {
        return paraTool.compute_sovereign_account(paraID)
    }
    // { "parents": 1, "interior": { "X1": [{ "Parachain": 1000 }]}}
    make_multilocation(paraID = null, address = null, namedNetwork = 'Any') {
        const ethAddress = address.length === 42;
        const named = (namedNetwork != 'Any') ? {
            Named: namedNetwork
        } : namedNetwork;
        const account = ethAddress ? {
            AccountKey20: {
                network: named,
                key: address
            }
        } : {
            AccountId32: {
                network: named,
                id: u8aToHex(decodeAddress(address))
            }
        };
        // make a multilocation object
        let interior = {
            here: null
        }
        if (paraID && account) {
            interior = {
                X2: [{
                    Parachain: paraID
                }, account]
            }
        } else if (paraID) {
            interior = {
                X1: {
                    Parachain: paraID
                }
            }
        } else if (account) {
            interior = {
                X1: account
            }
        }
        return {
            parents: 1,
            interior: interior
        }
    }

    // Converts a given MultiLocation into a 20/32 byte accountID by hashing with blake2_256 and taking the first 20/32 bytes
    //  https://github.com/albertov19/xcmTools/blob/main/calculateMultilocationDerivative.ts
    //  https://github.com/PureStake/moonbeam/blob/master/primitives/xcm/src/location_conversion.rs#L31-L37
    // Test case: Alice (origin parachain) 0x44236223aB4291b93EEd10E4B511B37a398DEE55 => is 0x5c27c4bb7047083420eddff9cddac4a0a120b45c on paraID 1000

    calculateMultilocationDerivative(paraID = null, address = null, namedNetwork = 'Any') {
        let multilocationStruct = this.make_multilocation(paraID, address, namedNetwork)
        const multilocation = this.api.createType('XcmV1MultiLocation', multilocationStruct)
        const toHash = new Uint8Array([
            ...new Uint8Array([32]),
            ...new TextEncoder().encode('multiloc'),
            ...multilocation.toU8a(),
        ]);

        const DescendOriginAddress20 = u8aToHex(this.api.registry.hash(toHash).slice(0, 20));
        const DescendOriginAddress32 = u8aToHex(this.api.registry.hash(toHash).slice(0, 32));
        let multiLocationHex = u8aToHex(multilocation.toU8a())
        console.log(`calculateMultilocationDerivative multiLocationHex=${multiLocationHex}`, multilocation.toString(), DescendOriginAddress20, DescendOriginAddress32);
        // multilocation {"parents":1,"interior":{"x2":[{"parachain":1000},{"accountKey20":{"network":{"any":null},"key":"0x44236223ab4291b93eed10e4b511b37a398dee55"}}]}}
        // 20 byte: 0x5c27c4bb7047083420eddff9cddac4a0a120b45c
        // 32 byte: 0x5c27c4bb7047083420eddff9cddac4a0a120b45cdfa7831175e442b8f14391aa
        return [DescendOriginAddress20, DescendOriginAddress32]
    }
}