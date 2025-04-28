// Copyright 2024 Colorful Notion, Inc.
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

// Indexes Substrate Chains with WSS and JSON RPC using
//  BigTable chain${chainID}
//   row.id is the HEX of the blockNumber
//   columns: (all cells with timestamp of the block)
//      blockraw:raw/blockHash -- block object holding extrinsics + events
//      finalized:blockHash
//  Mysql    block${chainID})
//      blockNumber (primary key)
//      blockDT   -- updated on finalized head
//      blockHash -- updated on finalized head
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const ethTool = require("./ethTool");
const Endpoints = require("./summary/endpoints");
const fs = require('fs');
const path = require("path");
const {
    bnToHex,
    hexToBn,
    hexToU8a,
    isHex,
    stringToU8a,
    u8aToHex,
    hexToString
} = require("@polkadot/util");
const {
    xxhashAsHex,
    blake2AsHex,
    blake2AsU8a
} = require('@polkadot/util-crypto');
const {
    XXHash32,
    XXHash64,
    XXHash3,
    XXHash128
} = require('xxhash-addon');
const {
    Keyring,
    decodeAddress,
    encodeAddress
} = require("@polkadot/keyring");
const {
    StorageKey
} = require('@polkadot/types');


const mysql = require("mysql2");
const Indexer = require("./indexer");
const paraTool = require("./paraTool");

module.exports = class Crawler extends Indexer {
    latestBlockNumber = 0;
    finalizedHashes = {};
    lastmarkedTS = 0;
    lastmarkedlogDT = '2019-01-01';
    coveredtx = {};

    constructor() {
        super("crawler")
    }

    checkAPIStatus(self, chainID, maxDisconnectedCnt) {
        let connected = self.getConnected()
        let disconnectedCnt = self.getDisconnectedCnt()
        // If the condition below is true the timer finishes
        let apiInitStatus = 'pending'
        if (disconnectedCnt >= maxDisconnectedCnt) {
            console.log(`${chainID} checkAPIStatus MaxDisconnectedCnt(${maxDisconnectedCnt}) reached`)
            apiInitStatus = 'terminate'
        }
        if (connected) {
            console.log(`${chainID} checkAPIStatus connected!`)
            apiInitStatus = 'done'
        }
        return apiInitStatus
    }

    waitMaxAPIRetry(callback, self, chainID, maxDisconnectedCnt) {
        let checkIntervalMS = 500
        let maxInteration = 30
        return new Promise((_, reject) => {
            let iteration = 0;
            const interval = setInterval(async () => {
                let apiInitStatus = await callback(self, chainID, maxDisconnectedCnt, interval)
                if (apiInitStatus == 'terminate') {
                    //console.log(`waitInterval`, callback)
                    clearInterval(interval);
                    //setTimeout(() => reject(new Error(`TERMINATING ${chainID} checkAPIStatus maxDisconnectedCnt reached!!!`)), 10);
                    return reject(new Error(`TERMINATING ${chainID} checkAPIStatus maxDisconnectedCnt reached!!!`))
                } else if (apiInitStatus == "done") {
                    clearInterval(interval);
                }
                if (iteration >= maxInteration) {
                    clearInterval(interval);
                }
                iteration++;
            }, checkIntervalMS);
        });
    }

    wait(maxTimeMS) {
        return new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`TIMEOUT in ${maxTimeMS/1000}s`)), maxTimeMS);
        });
    }

    async validateApi() {
        //TODO
        if (this.debugLevel > paraTool.debugVerbose) console.log(`[chainID=${this.chainID}], connected=${this.getConnected()}, exitOnDisconnect=${this.getExitOnDisconnect()}`)
    }

    async setupParaCrawlerChainAndAPI(chainID, withSpecVersions = true, backfill = false) {
        let maxTimeMS = 30000
        let maxDisconnectedCnt = 3

        let chain = await this.getChain(chainID, withSpecVersions);
        let resolve = this.setupAPI(chain, backfill);
        this.isRelayChain = paraTool.isRelayChain(chainID)
        this.relayChain = chain.relayChain;

        //race: {maxTimeMS reached, maxDisconnectedCnt reached, successfully initiated} whichever comes first
        try {
            await Promise.race([this.wait(maxTimeMS), resolve, this.waitMaxAPIRetry(this.checkAPIStatus, this, chainID, maxDisconnectedCnt)]);
        } catch (err) {
            if (this.debugLevel > paraTool.debugInfo) console.log(`race error cauth`, err);
        }

        let resolve2 = this.validateApi();
        await new Promise((resolve2, reject) => {
            setTimeout(() => {
                if (this.getConnected()) {
                    resolve2();
                } else {
                    return reject(new Error(`${chainID} setupChainAndAPI Errored`));
                }
            }, 10);
        });
        return (chain);
    }

    async setupChainAndAPI(chainID, withSpecVersions = true, backfill = false) {
        let chain = await this.getChain(chainID, withSpecVersions);
        await this.setupAPI(chain, backfill);
        this.isRelayChain = paraTool.isRelayChain(chainID)
        this.relayChain = chain.relayChain;
        return (chain);
    }



    // crawl_block (used by crawlBackfill) fetches a block using { blockNumber, attempted } saves in BT with save_block [which updates block${chainID} table]  It does NOT index the block
    async crawl_block(chain, t) {
        try {
            let bn = parseInt(t.blockNumber, 10)
            let header = await this.api.rpc.chain.getBlockHash(bn);
            let blockHash = header.toHex();

            // 1. get the block, ALWAYS
            let [signedBlock, events] = await this.crawlBlock(this.api, blockHash);

            let blockTS = signedBlock.blockTS;
            // to avoid 'hash' error, we create the a new block copy without decoration and add hash in
            let block = JSON.parse(JSON.stringify(signedBlock));
            block.number = paraTool.dechexToInt(block.header.number);
            if (typeof blockTS === "undefined") {
                blockTS = this.synthetic_blockTS(chain.chainID, block.number);
            }
            block.hash = blockHash;
            block.blockTS = blockTS;

            let success = await this.save_block(chain.chainID, block, blockHash, events, false, true, false, null, null, null);
            if (success) {
                return {
                    t,
                    block,
                    events,
                    blockHash,
                    blockTS
                };
            }
        } catch (err) {
            console.log(err);
            this.logger.warn({
                "op": "crawl_block",
                "chainID": chain.chainID,
                "blockNumber": parseInt(t.blockNumber, 10),
                "err": err
            })
        }
        return {
            t,
            block: false,
            events: false,
            blockHash: false
        };
    }

    // save_block stores block+events, and is called
    //  (a) called by crawlBackfill/crawl_block (finalized = true)
    //  (b) subscribeStorage for CANDIDATE blocks (finalized = false)
    // it is NOT called by subscribeFinalizedHeads
    async save_block(chainID, block, blockHash, events, trace = false, finalized = false) {
        let blockTS = block.blockTS;
        let bn = parseInt(block.header.number, 10);
        let parentHash = block.header.parentHash;
        if (bn == 0) {
            blockTS = 0
        }
        let cres = {
            key: paraTool.blockNumberToHex(bn),
            data: {
                blockraw: {},
                events: {},
                finalized: {},
                n: {}
            }
        };
        // block object lacks "hash+blockTS" attribute, so we EXPLICITLY add them here
        block = JSON.parse(JSON.stringify(block));
        block.number = bn; // decoration
        block.blockTS = blockTS; // decoration
        block.hash = blockHash; // decoration
        cres['data']['blockraw'][blockHash] = {
            value: JSON.stringify(block),
            timestamp: blockTS * 1000000
        };
        cres['data']['events'][blockHash] = {
            value: JSON.stringify(events),
            timestamp: blockTS * 1000000
        };
        if (finalized) {
            cres['data']['finalized'][blockHash] = {
                value: "1",
                timestamp: blockTS * 1000000
            };
        }

        // flush out the mysql + BT updates
        try {
            const tableChain = this.getTableChain(chainID);
            await tableChain.insert([cres]);
            var sql = false;
            let eflds = "";
            let evals = "";
            let eupds = "";
            if (finalized) {
                //check here
                sql = `insert into block${chainID} (blockNumber, blockHash, parentHash, crawlBlock, blockDT ${eflds} ) values (${bn}, '${blockHash}', '${parentHash}', 0, FROM_UNIXTIME(${blockTS})  ${evals} ) on duplicate key update blockHash = values(blockHash), parentHash = values(parentHash), crawlBlock = values(crawlBlock), blockDT = values(blockDT) ${eupds};`;
            }
            if (sql) {
                this.batchedSQL.push(sql);
                await this.update_batchedSQL();
            }
            return (true);
        } catch (err) {
            console.log(err);
            this.logger.warn({
                "op": "save_block",
                chainID,
                bn,
                err
            })
            return (false);
        }
    }


    //audit_blockraw - check { header, extrinsics, number, blockTS, hash }
    async audit_blockraw(blockraw) {
        let bn = 0
        let headerBn = 0
        let blockTS = 0;
        let header = false
        let blockHash = '';
        let parentHash = '';
        if (blockraw.header != undefined) {
            header = blockraw.header
            if (header.parentHash != undefined) parentHash = header.parentHash
            if (header.number != undefined) headerBn = header.number
        }
        if (blockraw.extrinsics == undefined || !Array.isArray(blockraw.extrinsics)) {
            return false
        }
        if (blockraw.number != undefined) bn = blockraw.number
        if (blockraw.blockTS != undefined) blockTS = blockraw.blockTS
        if (blockraw.hash != undefined) blockHash = blockraw.hash
        if (header && blockTS > 1451635200 && bn > 0 && headerBn == bn && parentHash.length == 66 && blockHash.length == 66) {
            //console.log("audit_blockraw ok", bn, blockHash)
            return true
        }
        console.log("audit_blockraw not ok")
        console.log('blockHash', blockHash, 'parentHash', parentHash, 'blockTS', blockTS, 'headerBn', headerBn, 'bn', bn)
        return false
    }

    //audit extrinsic within feed {fromAddress, extrinsicHash, extrinsicID, method, args, events, signature}
    audit_decorated_extrinsic(ex) {
        let fromAddress = ''
        let extrinsicHash = ''
        let extrinsicID = false
        let method = false
        let args = false
        let events = false
        let signature = false
        if (ex.fromAddress != undefined) fromAddress = ex.fromAddress
        if (ex.extrinsicHash != undefined) extrinsicHash = ex.extrinsicHash
        if (ex.extrinsicID != undefined) extrinsicID = ex.extrinsicID
        if (ex.method != undefined) method = ex.method
        if (ex.args != undefined) args = ex.args
        if (ex.events != undefined) events = ex.events
        if (ex.signature != undefined) signature = ex.signature

        if (fromAddress != "NONE" && fromAddress.length != 66 && extrinsicHash.length != 66 && extrinsicID) {
            console.log("ex not ok", "extrinsicHash", extrinsicHash, "extrinsicID", extrinsicID, "fromAddress", fromAddress, )
            return false
        }
        if (method && method.pallet != undefined && method.method != undefined) {} else {
            console.log("ex not ok method not found", "extrinsicHash", extrinsicHash, "extrinsicID", extrinsicID, "method", method)
            return false
        }
        if (args) {
            //TODO: check deep calls?
        } else {
            console.log("ex not ok args", "extrinsicHash", extrinsicHash, "extrinsicID", extrinsicID, "args", args)
            return false
        }
        if (!Array.isArray(events)) {
            console.log("ex not ok - events", "extrinsicHash", extrinsicHash, "extrinsicID", extrinsicID, "events", events)
            return false
        }
        if (signature) {
            //todo
        } else {
            console.log("ex not ok sig", "extrinsicHash", extrinsicHash, "extrinsicID", extrinsicID, "signature", signature)
            return false
        }

        return true
    }
    //audit_blockfeed - check decorated blocks { header, extrinsics, number, blockTS, hash, isFinalized? }
    async audit_indexed_block(feed) {
        let bn = 0
        let headerBn = 0
        let blockTS = 0;
        let header = false
        let blockHash = '';
        let parentHash = '';
        let stateRoot = ''
        let extrinsicsRoot = ''
        let isfinalized = false

        if (feed.hash != undefined) blockHash = feed.hash
        if (feed.number != undefined) bn = feed.number
        if (feed.blockTS != undefined) blockTS = feed.blockTS
        if (feed.finalized != undefined) isfinalized = feed.finalized

        if (feed.header != undefined) {
            header = feed.header
            if (header.parentHash != undefined) parentHash = header.parentHash
            if (header.stateRoot != undefined) stateRoot = header.stateRoot
            if (feed.header.parentHash != undefined) {
                parentHash = feed.header.parentHash
            } else if (feed.parentHash != undefined) {
                parentHash = feed.header.parentHash
            }
            if (header.extrinsicsRoot != undefined) extrinsicsRoot = header.extrinsicsRoot
            if (header.number != undefined) headerBn = header.number
        }

        if (blockTS <= 1451635200 || bn == 0 || headerBn == 0 || headerBn != bn) {
            console.log("audit_indexed_block number not ok", bn, 'blockHash', blockHash, 'headerBn', headerBn, 'blockTS', blockTS)
            return false
        }

        if (parentHash.length != 66 || blockHash.length != 66 || stateRoot.length != 66 || extrinsicsRoot.length != 66) {
            console.log("audit_indexed_block hash not ok", bn, 'blockHash', blockHash, 'parentHash', parentHash, 'stateRoot', stateRoot, 'extrinsicsRoot', extrinsicsRoot)
            return false
        }

        if (feed.extrinsics == undefined || !Array.isArray(feed.extrinsics)) {
            console.log("audit_indexed_block extrinsics not ok - not array", bn, 'blockHash', blockHash)
            return false
        }

        if (!isfinalized) {
            console.log("audit_indexed_block not finalized", bn, 'blockHash', blockHash)
            return false
        }

        for (const ex of feed.extrinsics) {
            //verify ex here
            let isVerifiedEx = this.audit_decorated_extrinsic(ex)
            if (!isVerifiedEx) {
                console.log('audit_indexed_block not ok - ex', JSON.stringify(ex))
                return false
            }
        }

        //console.log(`audit_indexed_block verified. bn=${bn}, blockHash=${blockHash}`)
        //console.log('blockHash', blockHash, 'parentHash', parentHash, 'blockTS', blockTS, 'headerBn', headerBn, 'bn', bn)
        return true
    }

    async audit_chain(chain, startBN, endBN) {
        let chainID = chain.chainID;
        let sql = `select blockNumber, blockDT from block${chainID} where blockNumber >= ${startBN} and blockNumber < ${endBN}`;
        let blocksDone = await this.poolREADONLY.query(sql)

        let blocks = {};
        blocksDone.forEach(async (b) => {
            if (b.blockDT) blocks[b.blockNumber] = 1;
        });

        let out = [];
        let missedBlock = 0;
        let covered = 0;
        for (let i = startBN; i < endBN; i++) {
            if (!blocks[i]) {
                out.push(`( ${i}, '1')`)
                missedBlock++;
            } else {
                out.push(`( ${i}, '0')`)
                covered++;
            }
        }
        if (out.length > 0) {
            this.batchedSQL.push(`insert into block${chainID} (blockNumber, crawlBlock) values ` + out.join(",") + ` on duplicate key update crawlBlock = values(crawlBlock)`);
            await this.update_batchedSQL();
        }
        console.log("audit_chain: chainID=", chainID, "startBN=", startBN, "endBN=", endBN, "missed blocks=", missedBlock, " covered=", covered);
        let blockHashes = {}
        let parentHashes = {}
        let finalized = {}
        let blockTSes = {}
        let auditRows = []
        const tableChain = this.instance.table("chain" + chainID);
        let writeFinalized = {};
        let parents = {};
        let start = paraTool.blockNumberToHex(startBN);
        let end = paraTool.blockNumberToHex(endBN);
        let families = ["blockraw", "events", "finalized"]
        let res = tableChain.createReadStream({
            start,
            end,
            family: families
        });
        res.on("error", (err) => {
            console.log(err);
        });
        res.on("end", async () => {});
        res.on("data", async (row) => {
            try {
                let bn = parseInt(row.id.substr(2), 16);
                let rowData = row.data;
                let blockData = rowData["blockraw"];
                let eventsData = rowData["events"];
                let finalizedData = rowData["finalized"];
                let cellBlock = false;
                let cellEvents = false;
                let crawlBlock = 1;
                let block = false;
                let events = false;
                let blockStats = false;
                let blockTS = 0;
                let blockHash = '';
                let parentHash = '';
                let write = false;
                if (finalizedData) {
                    for (const h of Object.keys(finalizedData)) {
                        if (blockData && (blockData[h]) && eventsData && eventsData[h]) {
                            cellBlock = blockData[h][0];
                            cellEvents = eventsData[h][0];
                            finalized[bn] = true;
                            blockHash = h;
                        }
                    }
                }

                if (cellBlock && cellEvents) {
                    block = JSON.parse(cellBlock.value);
                    events = JSON.parse(cellEvents.value);
                    blockTS = block.blockTS ? block.blockTS : 0;
                    blockHash = block.hash ? block.hash : "";
                    parentHash = block.header.parentHash;
                    blockHashes[bn] = blockHash;
                    parentHashes[bn] = parentHash;
                    blockTSes[bn] = blockTS;

                    //audit_blockraw - check { number, hash, header, blockTS, extrinsics }
                    let isBlockRawVerified = await this.audit_blockraw(block)
                    if ((events.length > 0) && isBlockRawVerified) {
                        crawlBlock = 0;
                    }
                }

                let sql = `('${bn}', '${blockHash}', '${parentHash}', FROM_UNIXTIME('${blockTS}'), '${crawlBlock}')`
                auditRows.push(sql);
            } catch (err) {
                this.logger.warn({
                    "op": "audit_chain",
                    chainID,
                    err
                })
            }
        });
        await this.finished(res);
        await this.dump_update_block(chain, auditRows);

        // go backwards
        let cnt = 0;
        for (var n = endBN; n > startBN; n--) {
            let parentn = n - 1;
            if (finalized[n] && (!finalized[parentn]) && (blockHashes[parentn]) && (parentHashes[n] == blockHashes[parentn])) {
                console.log("** NEW writefinalized", n, parentn, finalized[n], finalized[parentn]);
                finalized[parentn] = true;
                writeFinalized[parentn] = blockHashes[parentn];
            } else {
                cnt++;
            }
        }
        let newRows = [];
        for (let n of Object.keys(writeFinalized)) {
            let n0 = parseInt(n, 10)
            let h = writeFinalized[n];
            let blockTS = parseInt(blockTSes[n], 10);
            let cres = {
                key: paraTool.blockNumberToHex(n0),
                data: {
                    finalized: {},
                }
            };
            cres['data']['finalized'][h] = {
                value: "1",
                timestamp: blockTS * 1000000
            };
            newRows.push(cres);
        }

        try {
            if (newRows.length > 0) {
                await tableChain.insert(newRows);
                console.log("  WROTE finalized:", newRows.length);
            }
        } catch (err) {
            this.logger.warn({
                "op": "audit_chain",
                chainID,
                err
            })
        }

        return (missedBlock);
    }

    async dump_update_block(chain, auditRows) {
        let chainID = chain.chainID;
        if (auditRows.length == 0) return;

        let i = 0;
        for (i = 0; i < auditRows.length; i += 10000) {
            let j = i + 10000;
            if (j > auditRows.length) j = auditRows.length;
            let sql = `insert into block${chainID} (blockNumber, blockHash, parentHash, blockDT, crawlBlock) values ` + auditRows.slice(i, j).join(",") + ` on duplicate key update crawlBlock = values(crawlBlock), blockHash = values(blockHash), parentHash = values(parentHash), blockDT = values(blockDT)`;
            this.batchedSQL.push(sql)
        }
        auditRows = [];
        await this.update_batchedSQL()
    }

    async auditChain(chain) {
        let chainID = chain.chainID;
        let jmp = 2000;
        console.log(chain);
        for (let i = chain.backfillLookback; i < chain.blocksCovered; i += jmp) {
            let startBN = i;
            let endBN = i + jmp;
            if (endBN > chain.blocksCovered) endBN = chain.blocksCovered;

            let missedBlock = await this.audit_chain(chain, startBN, endBN)
            var sql = `update chain set backfillLookback = ${endBN} where chainID = ${chainID}`;
            this.batchedSQL.push(sql)
            await this.update_batchedSQL();

        }

        await this.update_batchedSQL();
        console.log("auditChain DONE chainID=", chainID);
    }

    async get_chain_period_from_indexTS(chainID, indexTS) {
        var sql = `select sum(numEvents)/count(*) as eventsperblock, sum(numExtrinsics)/count(*) as extrinsicsperblock, min(blockNumber) startBN, max(blockNumber) endBN, sum(numEvents) numEvents from block${chainID} where blockDT >= FROM_UNIXTIME('${indexTS}') and blockDT < FROM_UNIXTIME('${indexTS+3600}');`
        var periods = await this.poolREADONLY.query(sql);

        if (periods.length == 1) {
            let p = periods[0];
            let period = {
                indexTS,
                eventsperblock: p.eventsperblock,
                extrinsicsperblock: p.extrinsicsperblock,
                startBN: p.startBN,
                endBN: p.endBN,
                numEvents: p.numEvents
            }
            return (period);
        }
        return (false);
    }

    async indexChain(chain, lookbackBackfillDays = 60, audit = false, backfill = false, write_bq_log = true, techniqueParams = ["mod", 0, 1]) {
        this.chainID = chain.chainID;
        // (1) audit_chain the period, which marks crawlBlock=1 for the period
        if (audit) {
            console.log("auditChain");
            await this.auditChain(chain);
        }

        // (2) get the missed blocks for the last {lookback} days (assumes 360 blocks per hour)
        if (backfill) {
            console.log("backfill");
            await this.crawlBackfill(chain, ["range", chain.blocksFinalized - lookbackBackfillDays * 360 * 24, chain.blocksFinalized])
        }
        chain = await this.setupChainAndAPI(this.chainID);
        await this.assetManagerInit()
        this.resetTimeUsage()

        var w = "";
        if (techniqueParams[0] == "mod") {
            let n = techniqueParams[1];
            let nmax = techniqueParams[2];
            if (nmax > 1) {
                w = ` and round(indexTS/3600) % ${nmax} = ${n}`;
            }
        }
        let w2 = (Math.random() < .1) ? " logDT, rand()" : "rand()";
        var sql = `select chainID, indexTS from indexlog where indexed = 0 and readyForIndexing = 1 and chainID = '${chain.chainID}' and indexTS < UNIX_TIMESTAMP(Now()) - 3600
 and ( lastAttemptStartDT is null or lastAttemptStartDT < date_sub(Now(), interval POW(5, attempted) MINUTE) ) and duneStatus not in ('AuditRequired','Audited') ${w} order by ${w2} limit 20`;
        var indexlogs = await this.pool.query(sql);
        if (indexlogs.length == 0) {
            console.log(`indexChain ${chain.chainID}: no work to do`, sql)
            return (false);
        }
        let indexPeriodProcessedCnt = 0
        for (let i = 0; i < indexlogs.length; i++) {
            let period = await this.get_chain_period_from_indexTS(chain.chainID, indexlogs[i].indexTS);
            if (period) {
                let eventsperblock = parseFloat(period.eventsperblock);
                let jmp = eventsperblock > 0 ? Math.round(7200 / eventsperblock) : 50;
                if (jmp < 10) jmp = 10;
                // increment attempted, which generally will mean some other indexer won't attempt the same thing until its the last unprocessed hour
                let sql0 = `update indexlog set attempted = attempted + 1, lastAttemptStartDT = Now(), lastAttemptHostname = '${this.hostname}' where chainID = '${chain.chainID}' and indexTS = ${indexlogs[i].indexTS}`
                this.batchedSQL.push(sql0);
                await this.update_batchedSQL();
                try {
                    let elapsedTS = await this.index_blocks_period(chain, period, jmp, write_bq_log);
                    if (elapsedTS > 600) {
                        indexPeriodProcessedCnt++
                        console.log(`indexChain unhealthy after ${indexPeriodProcessedCnt}`)
                        process.exit(1)
                    }
                } catch (err) {
                    console.log(err);
                }
            }
        }
    }

    async indexPeriod(chainID, logDT, hr, write_bq_log = false) {
        let indexTSPeriod = paraTool.logDT_hr_to_ts(logDT, hr);
        var sql = `select floor(UNIX_TIMESTAMP(blockDT)/3600)*3600 as indexTS, min(blockNumber) startBN, max(blockNumber) endBN from block${chainID} where blockDT >= FROM_UNIXTIME(${indexTSPeriod}) and blockDT < FROM_UNIXTIME(${indexTSPeriod+3600}) group by indexTS order by indexTS;`
        if (this.debugLevel >= paraTool.debugInfo) console.log(`indexPeriod sql=`, sql) //why debugLevel doesn't work???
        var periods = await this.poolREADONLY.query(sql);
        let chain = await this.setupChainAndAPI(chainID);
        console.log(periods);

        let indexPeriodProcessedCnt = 0
        for (let i = 0; i < periods.length; i++) {
            let period = await this.get_chain_period_from_indexTS(this.chainID, periods[i].indexTS);
            if (period) {
                console.log(period);
                let eventsperblock = parseFloat(period.eventsperblock);
                let jmp = eventsperblock > 0 ? Math.round(7200 / eventsperblock) : 50;
                if (jmp < 10) jmp = 10;
                let elapsedTS = await this.index_blocks_period(chain, period, jmp, write_bq_log);
                if (elapsedTS > 210) {
                    indexPeriodProcessedCnt++
                    console.log(`indexReindex unhealthy after ${indexPeriodProcessedCnt}`)
                    process.exit(1)
                }
            }
        }
    }

    async get_fixes(chainID = 0) {
        let sql = `select blockNumber from block${chainID} where crawlBlock = 1 order by blockNumber desc limit 10000`
        let recs = await this.poolREADONLY.query(sql)
        let bns = [];
        for (const r of recs) {
            bns.push(r.blockNumber);
        }
        return bns;
    }

    async maintainIndexer(chainID) {
        const bigquery = this.get_big_query();
        let query = `SELECT  SUBSTR(CAST(TIMESTAMP_TRUNC(block_time, DAY) AS STRING), 1, 10) as logDT, count(*) cnt FROM  \`substrate-etl.polkadot_analytics.fixes${chainID}\` group by logDT`;
        let recs = await this.execute_bqJob(query);
        for (const r of recs) {
            let sql = `update blocklog set loaded = 0 where logDT = "${r.logDT}" and chainID = ${chainID};`;
            console.log(sql);
        }

        process.exit(0);
        let sql = `select chainID, CONVERT(auditFailures using utf8) auditFailures from blocklogstats where audited = 'Failure' and monthDT = LAST_DAY(Now()) limit 100`;
        console.log(sql);
        var failures = await this.poolREADONLY.query(sql);
        for (const failure of failures) {
            try {
                let auditFailures = JSON.parse(failure.auditFailures);
                let chainID = parseInt(failure.chainID, 10);
                let total = 0;
                for (const g of auditFailures.gaps) {
                    let blocks = g[1] - g[0];
                    total += blocks;
                }
                console.log(chainID, "TOTAL:", total, auditFailures.gaps);
                if (total < 10000) {
                    let chain = await this.getChain(chainID);
                    await this.crawlBackfill(chain);
                    // indexer => substrateetl => reaudit
                }
            } catch (err) {
                console.log(err);
            }
        }
        //process.exit(0);
    }

    async indexChainRandom(lookbackBackfillDays = 60, audit = true, backfill = true, write_bq_log = true, update_chain_assets = true) {
        // pick a chainID that the node is also crawling
        let hostname = this.hostname;
        var w = Math.random() < .5 ? "count(*) > 10 and " : ""
        var sql = `select chainID, min(from_unixtime(indexTS)) as indexDTLast, count(*) from indexlog where indexed=0 and readyForIndexing = 1
and ( lastAttemptStartDT is null or lastAttemptStartDT < date_sub(Now(), interval POW(5, attempted) MINUTE) ) and attempted < 15
group by chainID having ${w} count(*) < 100 order by rand() desc`;
        console.log(sql);
        var chains = await this.poolREADONLY.query(sql);

        if (chains.length < 1) {
            console.log("indexChainRandom: No chains to index", sql);
            // update asset, chain tables with new info from the hour
            return (false);
        }
        let chainID = chains[0].chainID;
        let chain = await this.getChain(chainID);
        await this.indexChain(chain, lookbackBackfillDays, audit, backfill, write_bq_log);
        await this.update_batchedSQL();


        return (true);
    }

    async updateChainAssets(chainID, daysago = 2) {
        let chain = await this.getChain(chainID);
        let updateChainAssetStartTS = new Date().getTime();
        await this.update_chain_assets(chain, daysago)
    }

    async getChainLookbackBlocks(chainID, defaultLookbackBlocks = 14000) {
        var sql = `select chain.chainID, chain.blocksCovered, min(startBN) startBN, blocksCovered - min(startBN) as lookbackBlocks from blocklogstats join chain on blocklogstats.chainID = chain.chainID where monthDT >= LAST_DAY(date_sub(Now(), interval 90 day)) and audited in ('Failure', 'Unknown') and chain.chainID = ${chainID} limit 1`;
        var stats = await this.poolREADONLY.query(sql);
        if (stats.length > 0 && (stats[0].lookbackBlocks > 0)) {
            return parseInt(stats[0].lookbackBlocks, 10);
        }
        if (defaultLookbackBlocks > 0) {
            return defaultLookbackBlocks;
        }
        return 14000;
    }

    // for any missing blocks, this refetches the dataset
    async crawlBackfill(chain, techniqueParams = ["mod", 0, 1], lookbackBlocks = null, wsBackfill = false) {
        let chainID = chain.chainID;
        let sql = false;
        if (lookbackBlocks == null) {
            lookbackBlocks = await this.getChainLookbackBlocks(chainID);
        }

        if (techniqueParams[0] == "mod") {
            let n = techniqueParams[1];
            let nmax = techniqueParams[2];
            let w = (nmax > 1) ? `and blockNumber % ${nmax} = ${n}` : "";
            let w2 = ` and blockNumber > ${chain.blocksCovered} - ${lookbackBlocks}`
            sql = `select blockNumber, crawlBlock, attempted from block${chainID} where ( crawlBlock = 1 ) ${w} ${w2} and blockNumber <= ${chain.blocksFinalized} and ( attemptedDT is null or attemptedDT < Date_sub(Now(), interval POW(3, attempted) MINUTE) ) and attempted < 15 order by blockNumber desc limit 50000`
            console.log("lookback", sql);
        } else if (techniqueParams[0] == "range") {
            let startBN = techniqueParams[1];
            let endBN = techniqueParams[2];
            sql = `select blockNumber, crawlBlock, attempted from block${chainID} where ( crawlBlock = 1 ) and blockNumber >= ${startBN} and blockNumber <= ${endBN} and ( attemptedDT is null  or attemptedDT < date_sub(Now(), interval POW(3, attempted) MINUTE) ) and attempted < 15 order by blockNumber desc limit 50000`
            console.log("lookback", sql);
        }
        let tasks = await this.poolREADONLY.query(sql);
        if (tasks.length == 0) return (false);

        await this.setupAPI(chain);
        if (wsBackfill && chain.WSBackfill && (chain.WSBackfill.length > 0)) {
            chain.WSEndpoint = chain.WSBackfill;
        }
        var jmp = 10; // do 10 at a time
        for (var i = 0; i < tasks.length; i += jmp) {
            let j = i + jmp;
            if (j > tasks.length) j = tasks.length;
            let pieces = tasks.slice(i, j);
            console.log("crawlBackfill", "chainID", chainID, i, "/", tasks.length);
            let res = pieces.map((t) => {
                return this.crawl_block(chain, t);
            })
            let res2 = await Promise.all(res);
            res2.forEach(async (t_block) => {
                let {
                    t,
                    block,
                    events
                } = t_block;
                if (t.attempted > 100) t.attempted = 100;

                let flds = [];
                if (block && events && (t.crawlBlock > 0)) {
                    t.crawlBlock = 0;
                    flds.push(`crawlBlock = '${t.crawlBlock}'`);
                } else {
                    flds.push(`attempted = ${t.attempted + 1}`);
                    flds.push(`attemptedDT = Now()`);
                }
                let sql = `update block${chainID} set ${flds.join(", ")} where blockNumber = '${t.blockNumber}'`;
                this.batchedSQL.push(sql)
                await this.mark_indexlog_dirty(chainID, block.blockTS);
                await this.update_batchedSQL();
                return
            });
        }
        await this.update_batchedSQL();
    }

    async getNumRecentCrawlBlocks(chain, lookbackBlocks = 14000) {
        var sql = `select count(*) as numRecentCrawlBlocks from block${chain.chainID} b, chain c where crawlBlock = 1 and blockNumber >= c.blocksFinalized - ${lookbackBlocks} and c.chainID = ${chain.chainID} and attemptedDT < date_sub(Now(), INTERVAL POW(5, attempted) MINUTE) and attempted < 15 order by attempted limit 1000`;
        let result = await this.poolREADONLY.query(sql);

        if (result.length > 0) {
            return result[0].numRecentCrawlBlocks;
        }
        return (-1);
    }


    async mark_indexlog_dirty(chainID, ts) {

        if (!(ts > 0)) {
            return (false);
        }
        let indexTS = Math.floor(ts / 3600) * 3600;
        if (indexTS == this.lastmarkedTS) {
            return (false);
        }
        let [logDT, hr] = paraTool.ts_to_logDT_hr(indexTS);
        this.upsertSQL({
            "table": "indexlog",
            "keys": ["chainID", "indexTS"],
            "vals": ["logDT", "hr", "indexed"],
            "data": [`('${chainID}', '${indexTS}', '${logDT}', '${hr}', 0)`],
            "replace": ["indexed"]
        }, true);
        this.lastmarkedTS = indexTS;
    }

    async markFinalizedReadyForIndexing(chain, blockTS) {
        let chainID = chain.chainID;
        let indexTS = (Math.floor(blockTS / 3600)) * 3600;
        let prevTS = (Math.floor(blockTS / 3600) - 1) * 3600;
        if (!this.readyForIndexing[prevTS]) {
            this.readyForIndexing[prevTS] = 1;
            let [logDT, hr] = paraTool.ts_to_logDT_hr(prevTS);
            var sql = `insert into indexlog (chainID, indexTS, logDT, hr, readyForIndexing) values ('${chainID}', '${prevTS}', '${logDT}', '${hr}', 1) on duplicate key update readyForIndexing = values(readyForIndexing);`;
            this.batchedSQL.push(sql);

            if (hr == 23) { // since we finalized the last hour, we can kick off fetching end of day balances
                let updateAddressBalanceStatus = "Ready"; // Don't need to ignore if WSEndpointArchive = 1, since we have 128 blocks history?
                await this.upsertSQL({
                    "table": "blocklog",
                    "keys": ["chainID", "logDT"],
                    "vals": ["loaded", "audited", "updateAddressBalanceStatus"],
                    "data": [`('${chainID}', '${logDT}', '0', 'Unknown', '${updateAddressBalanceStatus}')`],
                    "replace": ["loaded", "audited"]
                });
            }
            await this.update_indexlog_hourly(chain)
            await this.updateSpecVersions(chain);
            return (true);
        }
        return (false);
    }

    async crawlBlock(api, blockHash) {
        let signedBlock;
        let eventsRaw = [];
        try {
            signedBlock = await api.rpc.chain.getBlock(blockHash);
            eventsRaw = await api.query.system.events.at(blockHash);
        } catch (err) {
            console.log(err);
            this.logger.error({
                "op": "crawlBlock: signedBlock/eventsRaw",
                "chainID": this.chainID,
                "blockHash": blockHash,
                err
            })
        }
        let events = eventsRaw.map((e) => {
            let eh = e.event.toHuman();
            let ej = e.event.toJSON();

            let out = JSON.parse(JSON.stringify(e));
            let data = out.event.data;
            out.event = {};
            out.event.data = data;
            out.event.method = {};
            out.event.method['pallet'] = eh.section;
            out.event.method['method'] = eh.method;
            return out
        });

        let block = signedBlock.block;
        let header = block.header;
        let blockNumber = header.number;
        let isSet = false;
        for (let i = 0; i < block.extrinsics.length; i++) {
            let ex = block.extrinsics[i];
            let exj = ex.method.toJSON();
            let exh = ex.method.toHuman()
            if (exh.method == "set" && exh.section == 'timestamp' && (!isSet)) {
                block.blockTS = Math.round((exj.args.now) / 1000);
                isSet = true;
            }
        }
        // hacks
        if (blockNumber == 1000465 && this.chainID == 2) {
            block.blockTS = 1581422538;
        }
        if (this.chainID == 22007 && blockNumber < 195653) {
            block.blockTS = Math.round(blockNumber * 19.2191 + 1625570874)
        }
        if (this.chainID == 1000 && blockNumber < 305204) {
            block.blockTS = Math.round(blockNumber * 12.17112 + 1636071000)
        }
        if (this.chainID == 21000 && blockNumber < 66687) {
            block.blockTS = Math.round(blockNumber * 12 + 1621934316)
        }
        // NOTE: does not have block.{number, hash} set
        return [block, events];
    }

    async crawlPendingExtrinsics(chain, crawler) {
        if (crawler.latestBlockNumber > 0) {
            let pendingTXs = await crawler.api.rpc.author.pendingExtrinsics()
            await crawler.processPendingTransactions(pendingTXs, crawler.latestBlockNumber)
        }
    }

    async crawlTxpoolContent(chain, crawler) {
        if (crawler.latestBlockNumber > 0) {
            let cmd = `curl ${chain.RPCBackfill}  -X POST -H "Content-Type: application/json" --data '{"method":"txpool_content","params":[],"id":1,"jsonrpc":"2.0"}'`
            const {
                stdout,
                stderr
            } = await exec(cmd, {
                maxBuffer: 1024 * 64000
            });
            let txs = [];
            let content = JSON.parse(stdout);
            if (content && content.result && content.result.pending) {
                let pending = content.result.pending;
                let ts = crawler.getCurrentTS();
                for (const addr of Object.keys(pending)) {
                    for (const nonce of Object.keys(pending[addr])) {
                        let tx = pending[addr][nonce];
                        // make sure we don't repeat this
                        let transactionHash = tx.hash
                        if (transactionHash && (crawler.coveredtx[transactionHash] == undefined)) {
                            txs.push(tx);
                            crawler.coveredtx[tx.hash] = ts;
                        }
                    }
                }
                if (txs.length) {
                    txs = await crawler.processTransactions(txs);
                    for (let i = 0; i < txs.length; i++) {
                        let tx = txs[i];
                        tx.blockHash = ""; // if ( tx.blockHash != undefined) delete tx.blockHash;
                        tx.blockNumber = 0; // if ( tx.blockNumber != undefined ) delete tx.blockNumber;
                        tx.transactionIndex = -1; // if ( tx.transactionIndex != undefined) delete tx.transactionIndex;
                        tx.chainID = chain.chainID;
                        tx.timestamp = ts;
                    }
                } else if (ts % 60 == 0) {

                    for (const txhash of Object.keys(crawler.coveredtx)) {
                        if (crawler.coveredtx[txhash] < ts - 60) {
                            delete crawler.coveredtx[txhash];
                        }
                    }
                }
            }
        }
    }

    async nukeBlock(chainID, bn) {
        let rowId = paraTool.blockNumberToHex(bn);
        let cmd = `cbt deleterow chain${chainID} ${rowId}`
        console.log(cmd);
        await exec(cmd, {
            maxBuffer: 1024 * 64000
        });
    }

    async get_archiver_chain() {
        let sql = `select chainID, blocksArchived from chain where crawling = 1 and updateBalancesLookbackDays > 100 and blocksCovered - blocksArchived > 7200 order by lastArchiveDT limit 1`;
        let recs = await this.poolREADONLY.query(sql);
        if (recs.length == 1) {
            let r = recs[0];
            let chainID = parseInt(r.chainID, 10);
            await this.update_chain_blocksArchived(chainID, r.blocksArchived);
            return chainID;
        }
        return null;
    }

    async deleteBlocks(chainID, lookback = 2000000) {
        let chain = await this.getChain(chainID);
        let start = (chain.blocksArchived > lookback) ? (chain.blocksArchived - lookback) : 1;
        let end = (chain.blocksCovered - 65536 * 2);
        let bnStart = start;
        let bnEnd = Math.floor((end - 65536) / 65536) * 65536;
        if (bnEnd < bnStart) bnEnd = bnStart;
        try {
            const tableChain = this.getTableChain(chainID);
            console.log("deleteBlocks ---", bnStart, bnEnd);
            for (let bn = bnStart; bn < bnEnd; bn += 65536) {
                let id = paraTool.blockNumberToHex(bn);
                let prefix = id.substring(0, 6); // 0x001c+fde0
                await tableChain.deleteRows(prefix);
                console.log("deleteBlocks prefix", chainID, bn, prefix);
            }
        } catch (err) {
            console.log(err);
        }
        console.log("DONE");
        process.exit(0);
    }

    async extract_blocks(chainID = null) {
        if (chainID == null) {
            chainID = await this.get_archiver_chain();
            if (chainID == null) {
                process.exit(0);
                return (null);
            }
        }

        let chain = await this.getChain(chainID);
        let bnStart = chain.blocksArchived;
        let bnEnd = chain.blocksCovered;
        if (bnEnd - bnStart > 100000) bnEnd = bnStart + 100000;

        let relayChain = paraTool.getRelayChainByChainID(chainID)
        let paraID = paraTool.getParaIDfromChainID(chainID)
        const tableChain = this.getTableChain(chainID);
        const {
            Storage
        } = require('@google-cloud/storage');
        const storage = this.get_google_storage();
        let bucketName = "crypto_substrate";
        const bucket = storage.bucket(bucketName);
        let jmp = 50;

        await this.assetManagerInit();
        await this.setupChainAndAPI(chainID);

        for (let bn0 = bnStart; bn0 <= bnEnd; bn0 += jmp) {
            console.log(bn0);
            let bn1 = bn0 + jmp - 1;
            if (bn1 > bnEnd) bn1 = bnEnd;
            // check if we have archived
            let covered = {}
            let sql = `select blockNumber from block${chainID} where blockNumber >= ${bn0} and blockNumber <= ${bn1} and archived = 1`;
            console.log(sql);
            let recs = await this.poolREADONLY.query(sql);
            if (recs.length > 0) {
                for (const r of recs) {
                    covered[r.blockNumber] = true;
                }
            }

            let start = paraTool.blockNumberToHex(bn0);
            let end = paraTool.blockNumberToHex(bn1);
            let [rows] = await tableChain.getRows({
                start: start,
                end: end
            });
            let out = [];
            for (const row of rows) {
                let blockNumber = parseInt(row.id.substr(2), 16);
                if (covered[blockNumber]) {
                    //console.log("COVERED", blockNumber, bnStart, bnEnd);
                    continue;
                }
                let r = null
                try {
                    r = this.build_block_from_row(row);
                    let finalizedHash = null;
                    if (r["feed"] != undefined && r["feed"].hash) {
                        finalizedHash = r["feed"].hash
                    }
                    if (r["block"] == false || r["feed"] == false) {
                        console.log("fetch blockNumber", blockNumber);
                        await this.nukeBlock(chainID, blockNumber);
                        let t2 = {
                            chainID,
                            blockNumber
                        };
                        let x = await this.crawl_block(chain, t2)
                        finalizedHash = x.blockHash
                        await this.index_block(chain, blockNumber, x.blockHash);
                        out.push(`(${blockNumber}, 1)`)
                        r = null;
                    }

                } catch (err) {
                    console.log(err, "build_block");
                }
                let result = {}
                if (r) {
                    result["blockraw"] = r["block"]; //raw encoded extrinsic + header
                    result["events"] = r["events"]; // decoded events
                    result["feed"] = r["feed"]; // decoded extrinsics
                    if (result["blockraw"] && result["events"] && result["feed"]) {
                        const compressedData = JSON.stringify(result);
                        const fileName = this.gs_substrate_file_name(relayChain, paraID, blockNumber);
                        const file = bucket.file(fileName);
                        const writeStream = file.createWriteStream({
                            contentType: 'application/json',
                            gzip: true
                        });
                        writeStream.write(compressedData);
                        writeStream.end();

                        // Wait for the write stream to finish writing
                        await new Promise((resolve, reject) => {
                            writeStream.on('finish', resolve);
                            writeStream.on('error', reject);
                        });
                        console.log(`gs://${bucketName}/${fileName}`, out.length);
                        out.push(`(${blockNumber}, 1)`)

                        await this.upsertSQL({
                            "table": `block${chainID}`,
                            "keys": ["blockNumber"],
                            "vals": ["archived"],
                            "data": out,
                            "replace": ["archived"]
                        });
                        out = [];
                        await this.update_chain_blocksArchived(chainID, blockNumber);
                    }
                }
            }
            if (out.length > 0) {
                console.log("FIN", out);
                await this.upsertSQL({
                    "table": `block${chainID}`,
                    "keys": ["blockNumber"],
                    "vals": ["archived"],
                    "data": out,
                    "replace": ["archived"]
                });
            }
            await this.update_chain_blocksArchived(chainID, bn0);
        }
        await this.deleteBlocks(chainID);
    }

    async update_chain_blocksArchived(chainID, blockNumber) {
        try {
            let sql1 = `update chain set blocksArchived = ${blockNumber}, lastArchiveDT = Now()  where chainID = ${chainID}`
            console.log(sql1);
            this.batchedSQL.push(sql1);
            await this.update_batchedSQL()
        } catch (e) {
            console.log(e);
        }
    }

    async crawl_parachains(chainID = 2) {
        let allEndPoints = Endpoints.getAllEndpoints();
        //console.log(`allEndPoints len=${Object.keys(allEndPoints).length}`, allEndPoints)

        let knownParachains = await this.getKnownParachains()
        //console.log(`knownParachains len=${Object.keys(knownParachains).length}`, knownParachains)

        let chain = await this.setupChainAndAPI(chainID);
        let relaychain = (chainID == paraTool.chainIDPolkadot) ? 'polkadot' : 'kusama'
        var allParaIds = (await this.api.query.paras.paraLifecycles.entries()).map(([key, _]) => key.args[0].toJSON());
        var allParaTypes = (await this.api.query.paras.paraLifecycles.entries()).map(([_, v]) => v.toString()); //Parathread/Parachain

        let newParas = []
        let paraIDs = [];
        this.paraIDs = [];

        for (let x = 0; x < allParaIds.length; x++) {
            let paraID = allParaIds[x]
            let paraType = allParaTypes[x]
            let fullparaID = `${relaychain}-${paraID}`
            let targetEndpoint = allEndPoints[fullparaID]
            let para_name = `${relaychain}-${paraType.toLowerCase()}-${paraID}`

            // update chainparachain table
            paraIDs.push(`('${chainID}', '${paraID}', Now(), Now(), '${relaychain}', '${paraType}') `)
            this.paraIDs.push(paraID);

            if (targetEndpoint == undefined) {
                //console.log(`*** ${fullparaID} NOT FOUND!!!`)
            } else {
                para_name = targetEndpoint.id
                //console.log(`${fullparaID} [${para_name}] found`)
            }
            if (knownParachains[fullparaID] == undefined) {
                console.log(`** NEW para ${fullparaID} [${para_name}]`)
                // insert unknown para into chain table
                // convention: for polkadot parachain: use 4-digits paraID as chainID. for kusama parachain: add 20000 to the paraID. such that paraID is 5-degits number like 2xxxx
                // we will tentatively fill id using endpoint's ID. If it's not available, fill it with "relaychain-paraType-paraID". (we will use talisman convention to update the id in future)
                //"vals": ["id", "relaychain", "paraID", "website",  "WSEndpoint", "WSEndpoint2", "WSEndpoint3"]
                if (targetEndpoint == undefined) {
                    // targetEndpoint not found in endpoints.js. example: kusama-2021
                    let parachainID = (relaychain == 'polkadot') ? paraID : 20000 + paraID
                    newParas.push(`('${parachainID}', '${para_name}', '${relaychain}', '${paraID}', Null, Null, Null, Null) `)
                } else {
                    let parachainID = (relaychain == 'polkadot') ? paraID : 20000 + paraID
                    let website = (targetEndpoint.website != undefined) ? `'${targetEndpoint.website}'` : 'Null'
                    //console.log(`${fullparaID} len=${targetEndpoint.WSEndpoints.length}`, targetEndpoint.WSEndpoints)
                    let WSEndpoint = (targetEndpoint.WSEndpoints.length >= 1) ? `'${targetEndpoint.WSEndpoints[0]}'` : 'Null'
                    let WSEndpoint2 = (targetEndpoint.WSEndpoints.length >= 2) ? `'${targetEndpoint.WSEndpoints[1]}'` : 'Null'
                    let WSEndpoint3 = (targetEndpoint.WSEndpoints.length >= 3) ? `'${targetEndpoint.WSEndpoints[2]}'` : 'Null'
                    newParas.push(`('${parachainID}', '${para_name}', '${relaychain}', '${paraID}', ${website}, ${WSEndpoint}, ${WSEndpoint2}, ${WSEndpoint3}) `)
                }
            } else {
                //console.log(`** KNOWN para ${fullparaID} ${para_name} -- skip`)
            }
        }
        await this.upsertSQL({
            "table": "chainparachain",
            "keys": ["chainID", "paraID"],
            "vals": ["firstSeenDT", "lastUpdateDT", "relaychain", "paratype"],
            "data": paraIDs,
            "replace": ["relaychain", "paratype"],
            "replaceIfNull": ["lastUpdateDT"],
        });
        //console.log(`crawl_parachains relayChain=${relaychain} len=${paraIDs.length}`)

        //console.log(`newParas`, newParas)
        await this.upsertSQL({
            "table": "chain",
            "keys": ["chainID"],
            "vals": ["id", "relaychain", "paraID", "website", "WSEndpoint", "WSEndpoint2", "WSEndpoint3"],
            "data": newParas,
            "replace": ["paraID", "website"],
            "replaceIfNull": ["relaychain", "WSEndpoint", "WSEndpoint2", "WSEndpoint3"],
        });
        this.readyToCrawlParachains = false;
    }


    async processFinalizedHead(chain, chainID, bn, finalizedHash, parentHash, isTip = false) {
        const tableChain = this.getTableChain(chainID);
        await this.initApiAtStorageKeys(chain, finalizedHash, bn);

        let blockStats = false;
        let blockTS = 0;
        let crawlBlock = 1;
        if (bn > this.latestBlockNumber) this.latestBlockNumber = bn;
        // read the row and DELETE all the blockraw:XXX cells that do NOT match the finalized hash
        const filter = {
            column: {
                cellLimit: 30
            }
        };
        let row = null;
        try {
            [row] = await tableChain.row(paraTool.blockNumberToHex(bn)).get({
                filter
            });
        } catch (err) {
            if (err.code == 404) {
                row = null;
            } else {
                console.log(err);
            }
        }
        if (row == null) {
            await this.crawl_block(chain, {
                blockNumber: bn
            });
            [row] = await tableChain.row(paraTool.blockNumberToHex(bn)).get({
                filter
            });
            if (row == null) {
                console.log("no row", bn);
                return (false);
            }
        }
        try {

            let cols = [];
            let rowData = row.data;
            const blockData = rowData["blockraw"];
            const eventsData = rowData["events"];
            let block = false;
            let events = false;
            if (blockData && eventsData) {
                for (const blockHash of Object.keys(blockData)) {
                    if (blockHash != finalizedHash) {
                        cols.push("blockraw:" + blockHash);
                        cols.push("events:" + blockHash);
                    } else {
                        crawlBlock = 0;
                        let cell = blockData[blockHash][0];
                        if (cell) {
                            block = JSON.parse(cell.value);
                            blockTS = this.get_block_timestamp(block);
                        }
                        let cellEvent = eventsData[blockHash][0];
                        if (cellEvent) {
                            events = JSON.parse(cellEvent.value);
                        }
                    }
                }
            }

            if (cols.length > 0) {
                await row.deleteCells(cols);
            }
            if (block && events) {
                let rRow = {
                    block,
                    events,
                    blockHash: finalizedHash,
                }
                //todo: missing rRow.blockHash
                let isSignedBlock = false

                let refreshAPI = false
                let isTip = true
                let finalized = true
                //index_chain_block_row(r, signedBlock = false, write_bq_log = false, refreshAPI = false, isTip = false, isFinalized = true)
                let r = await this.index_chain_block_row(rRow, isSignedBlock, false, refreshAPI, isTip, finalized);
                blockStats = r.blockStats;
                // IMMEDIATELY flush all address feed + hashes (txs + blockhashes)
                await this.flush(block.blockTS, bn, false, isTip); //ts, bn, isFullPeriod, isTip
            }
        } catch (err) {
            console.log(`err`, err)
            this.logger.error({
                "op": "subscribeFinalizedHeads",
                chainID,
                bn,
                err
            })
        }

        // write to BigTable
        try {
            let cres = {
                key: paraTool.blockNumberToHex(bn),
                data: {
                    finalized: {}
                }
            };
            cres['data']['finalized'][finalizedHash] = {
                value: "1",
                timestamp: new Date()
            }
            await tableChain.insert([cres]);
            let indexUpdateInterval = Math.floor(Math.random() * 5000);
            // write to MySQL
            if (blockTS > 0) {
                let numExtrinsics = blockStats && blockStats.numExtrinsics ? blockStats.numExtrinsics : 0
                let numSignedExtrinsics = blockStats && blockStats.numSignedExtrinsics ? blockStats.numSignedExtrinsics : 0
                let numTransfers = blockStats && blockStats.numTransfers ? blockStats.numTransfers : 0
                let numEvents = blockStats && blockStats.numEvents ? blockStats.numEvents : 0
                let valueTransfersUSD = blockStats && blockStats.valueTransfersUSD ? blockStats.valueTransfersUSD : 0
                let fees = blockStats && blockStats.fees ? blockStats.fees : 0;
                let eflds = "";
                let evals = "";
                let eupds = "";
                let sql = `insert into block${chainID} (blockNumber, blockHash, parentHash, numExtrinsics, numSignedExtrinsics, numTransfers, numEvents, valueTransfersUSD, fees, blockDT, crawlBlock ${eflds}) values ('${bn}', '${finalizedHash}', '${parentHash}', '${numExtrinsics}', '${numSignedExtrinsics}', '${numTransfers}', '${numEvents}', '${valueTransfersUSD}', '${fees}', FROM_UNIXTIME('${blockTS}'), '${crawlBlock}' ${evals}) on duplicate key update blockHash=values(blockHash), parentHash = values(parentHash), blockDT=values(blockDT), numExtrinsics = values(numExtrinsics), numSignedExtrinsics = values(numSignedExtrinsics), numTransfers = values(numTransfers), numEvents = values(numEvents), valueTransfersUSD = values(valueTransfersUSD), fees = values(fees), crawlBlock = values(crawlBlock) ${eupds}`;
                this.batchedSQL.push(sql);
                // mark that the PREVIOUS hour is ready for indexing, since this block is FINALIZED, so that continuously running "indexChain" job can index the newly finalized hour
                await this.markFinalizedReadyForIndexing(chain, blockTS);
                let sql2 = `insert into chain ( chainID, blocksCovered, blocksFinalized, lastFinalizedDT ) values ( '${chainID}', '${bn}', '${bn}', Now() ) on duplicate key update blocksFinalized = values(blocksFinalized), lastFinalizedDT = values(lastFinalizedDT), blocksCovered = IF( blocksCovered < values(blocksFinalized), values(blocksFinalized), blocksCovered )`
                this.batchedSQL.push(sql2);
                if (bn % 5000 == indexUpdateInterval) {
                    // every 5000 blocks, push 24 hours of onto indexlog from blocklog
                    let sqltmp = `select floor(unix_timestamp(blockDT)/3600)*3600 as f from block${chainID} where blockDT >= date(date_sub(Now(), interval 24 hour)) group by f`
                    let blocklog = await this.poolREADONLY.query(sqltmp)
                    let out = [];
                    for (const s of blocklog) {
                        let [logDT0, hr0] = paraTool.ts_to_logDT_hr(s.f);
                        out.push(`('${chainID}', '${s.f}', '${logDT0}', '${hr0}', 1)`)
                    }
                    let valstmp = ["indexTS", "logDT", "hr", "readyForIndexing"]
                    await this.upsertSQL({
                        "table": "indexlog",
                        "keys": ["chainID"],
                        "vals": valstmp,
                        "data": out,
                        "replace": valstmp
                    });
                    await this.update_batchedSQL();
                }

                var runtimeVersion = await this.api.rpc.state.getRuntimeVersion(finalizedHash)
                let specVersion = runtimeVersion.toJSON().specVersion;
                if (this.metadata[specVersion] == undefined) {
                    await this.getSpecVersionMetadata(chain, specVersion, finalizedHash, bn);
                }

                console.log("subscribeFinalizedHeads", chain.chainName, bn, `CHECK: cbt read chain${chainID} prefix=` + paraTool.blockNumberToHex(bn), "|  ", sql2);
                await this.update_batchedSQL();

                if (this.readyToCrawlParachains && (chainID == paraTool.chainIDPolkadot || chainID == paraTool.chainIDKusama)) {
                    await this.crawl_parachains(chainID);
                }
                if (bn % 7200 == 0) { // 1-2x/day
                    try {
                        await this.setup_chainParser(chain, paraTool.debugNoLog, true);
                    } catch (e1) {}

                }
            } else {
                if (this.debugLevel > paraTool.debugVerbose) console.log(`!!!! processFinalizedHead bn=${bn}, finalizedHash=${finalizedHash}, parentHash=${parentHash}, isTip=${isTip}, blockTS missing`)
            }
        } catch (err) {
            if (err.toString().includes("disconnected")) {
                console.log(err);
            } else {
                this.logger.error({
                    "op": "subscribeFinalizedHeads",
                    chainID,
                    err
                })
            }
        }
    }

    async check_chain_endpoint_correctness(chain) {
        try {
            let bn = chain.blocksFinalized - 100;
            let sql = `select blockNumber, blockHash, parentHash from block${chain.chainID} where blockNumber >= ${bn} and length(blockHash) > 40 and length(parentHash) > 40 limit 20`
            let blocks = await this.poolREADONLY.query(sql);
            if (blocks.length > 0) {
                let bHash = blocks[0].blockHash;
                let header = await this.api.rpc.chain.getHeader(bHash);
                let parentHash = header.parentHash.toString();
                let success = (blocks[0].parentHash == parentHash);
                if (success == false) {
                    console.log(`FATAL: FAILED to match chain @ blockNumber: ${blocks[0].blockNumber} expected ${blocks[0].parentHash} got ${parentHash}`);
                    process.exit(1);
                } else {
                    console.log(`PASSED check`)
                }
            }
        } catch (e) {
            console.log(e);
        }
    }

    async process_indexer_message(chain, message) {
        // if the incoming xcmtransfer is a chainIDDest matching our indexer's chainID, then record a starting balance in xcmtransfers_beneficiary
        try {
            let msg = message.data;
            if (msg.beneficiary != undefined && (msg.chainIDDest == this.chainID)) {
                await this.process_indexer_xcmtransfer(chain, msg);
            }
        } catch (err) {
            this.logger.error({
                "op": "process_indexer_message ERROR",
                err
            });
        }
    }

    async process_indexer_crawlBlock(chain, crawlBlock) {
        try {
            let blockNumber = crawlBlock.blockNumber;
            await this.crawl_block(chain, crawlBlock)
            let blockHash = await this.getBlockHashFinalized(chain.chainID, blockNumber);
            this.logger.error({
                "op": "process_indexer_crawlBlock READY",
                crawlBlock,
                blockHash,
                chain
            });
            let res = await this.index_block(chain, blockNumber, blockHash);
            this.logger.error({
                "op": "process_indexer_crawlBlock SUCC",
                blockNumber,
                blockHash,
                res
            });
        } catch (err) {
            this.logger.error({
                "op": "process_indexer_crawlBlock ERROR",
                crawlBlock,
                chain
            });
        }
    }

    isWSEndpointSelfHosted() {
        if (this.APIWSEndpoint && ((this.APIWSEndpoint.includes("polkaholic") || this.APIWSEndpoint.includes("dotswap")))) {
            return (true)
        }
        return (false);
    }

    async crawlBlocks(chainID) {
        if (chainID == paraTool.chainIDPolkadot || chainID == paraTool.chainIDKusama) {
            this.readyToCrawlParachains = true;
        }
        console.log("loading substrate");
        await this.load_calls_events("substrate");

        // Subscribe to chain updates and log the current block number on update.
        let chain = await this.setupChainAndAPI(chainID);
        await this.check_chain_endpoint_correctness(chain);

        await this.setup_chainParser(chain, paraTool.debugNoLog, true);
        if (chain.WSEndpointSelfHosted == 1) {
            setInterval(this.crawlPendingExtrinsics, 1000, chain, this);
        }

        // refresh assets + contractABI every 5-10m
        setInterval(this.autoRefreshAssetManager, Math.round(300000 + Math.random() * 300000), this);

        // health check every min, if stalled for 5min, terminate crawler accordingly
        setInterval(this.selfTerminate, Math.round(60000), this);

        if (chain.blocksFinalized) this.finalizedHashes[chain.blocksFinalized] = "known";
        const unsubscribeFinalizedHeads = await this.api.rpc.chain.subscribeFinalizedHeads(async (header) => {
            this.lastEventReceivedTS = this.getCurrentTS(); // if no event received in 5mins, restart
            let bn = parseInt(header.number.toString(), 10);
            let finalizedHash = header.hash.toString();
            await fs.writeFileSync("/tmp/lastblock", finalizedHash);
            if (chainID == paraTool.chainIDMangataX) {
                let trueFinalizedHash = await this.api.rpc.chain.getBlockHash(header.number);
                if (finalizedHash != trueFinalizedHash) {
                    //if (this.debugLevel > paraTool.debugInfo) console.log(`subscribeFinalizedHeads updateFinalizedHash=${trueFinalizedHash}(was:${finalizedHash})`)
                    finalizedHash = trueFinalizedHash.toHex()
                }
            }
            let parentHash = header.parentHash.toString();
            let subscribeFinalizedHeadsMsg = {
                "bn": bn,
                "chainID": chainID
            }

            await this.processFinalizedHead(chain, chainID, bn, finalizedHash, parentHash, true);
            this.finalizedHashes[bn] = finalizedHash;
            // because we do not always get the finalized hash signal, we brute force use the parentHash => grandparentHash => greatgrandparentHash => greatgreatgrandparentHash  (3 up)
            let b = bn - 1;
            let bHash = parentHash;
            let bMin = (bn > 10) ? bn - 10 : 1;

            let queue = [];
            while (this.finalizedHashes[b] == undefined && (b > bMin)) {
                let bHeader = await this.api.rpc.chain.getHeader(bHash);
                let bparentHash = bHeader.parentHash.toString();
                this.finalizedHashes[b] = bHash;
                queue.push({
                    b,
                    bHash,
                    bparentHash
                });
                b--;
                bHash = bparentHash;
            }
            if (this.debugLevel > paraTool.debugVerbose) console.log(`finalized queue`, queue)
            for (let i = 0; i < queue.length; i++) {
                let q = queue[i];
                await this.processFinalizedHead(chain, chainID, q.b, q.bHash, q.bparentHash, true); // it's safe to pass true here. lastCrawlBN will prevent update using older state
            }
            // clean up old entries to avoid memory explosion
            if (this.finalizedHashes[bn - 11] !== undefined) {
                delete this.finalizedHashes[bn - 11];
            }
        });

        let unsubscribeRuntimeVersion = await this.api.rpc.state.subscribeRuntimeVersion(async (results) => {
            var runtimeVersion = await this.api.rpc.state.getRuntimeVersion()
            let specVersion = runtimeVersion.toJSON().specVersion;
            //this.logger.warn({"op": "subscribeRuntimeVersion", chainID, "specVersion": specVersion})
            // this will refresh the metadata and get new storage keys for the most recent spec
            await this.getSpecVersionMetadata(chain, specVersion, false, 0);

        });

        // subscribeStorage returns changes from ALL blockHashes, including the ones that eventually got dropped
        let unsubscribeStorage = null
        this.blocksCovered = chain.blocksCovered;

        try {
            if (this.isWSEndpointSelfHosted()) {
                unsubscribeStorage = await this.api.rpc.state.subscribeStorage(async (results) => {
                    try {
                        this.lastEventReceivedTS = this.getCurrentTS(); // if not received in 5mins, reset
                        // build block similar to sidecar
                        let blockHash = results.block.toHex();
                        let [signedBlock, events] = await this.crawlBlock(this.api, results.block.toHex());
                        let blockTS = signedBlock.blockTS;

                        // to avoid 'hash' error, we create the a new block copy without decoration and add hash in
                        let block = JSON.parse(JSON.stringify(signedBlock));
                        block.number = paraTool.dechexToInt(block.header.number);
                        block.hash = blockHash;
                        block.blockTS = blockTS;
                        let blockNumber = block.number;
                        let subscribeStorageMsg = {
                            "bn": blockNumber,
                            "chainID": chainID
                        }


                        if (blockNumber > this.latestBlockNumber) this.latestBlockNumber = blockNumber;
                        // write { blockraw:blockHash => block, events:blockHash => events } to bigtable
                        let success = await this.save_block(chainID, block, blockHash, events, false, false);
                        if (success) {
                            // write to mysql
                            let blockTS = block.blockTS;
                            if (blockTS > 0) {
                                this.apiAt = this.api //set here for opaqueCall  // TODO: what if metadata changes?
                                let signedExtrinsicBlock = block
                                signedExtrinsicBlock.extrinsics = signedBlock.extrinsics //add signed extrinsics

                                let isFinalized = false
                                let isTip = true
                                let [blockStats, xcmMeta] = await this.processBlockEvents(chainID, signedExtrinsicBlock, events, null, null, this.api, false, isFinalized, false, isTip, false);

                                await this.immediateFlushBlockAndAddressExtrinsics(true) //this is tip
                                if (blockNumber > this.blocksCovered) {
                                    // only update blocksCovered in the DB if its HIGHER than what we have seen before
                                    var sql = `update chain set blocksCovered = '${blockNumber}', lastCrawlDT = Now() where chainID = '${chainID}' and blocksCovered < ${blockNumber}`
                                    this.batchedSQL.push(sql);
                                    this.blocksCovered = blockNumber;
                                }
                                let numExtrinsics = blockStats && blockStats.numExtrinsics ? blockStats.numExtrinsics : 0
                                let numSignedExtrinsics = blockStats && blockStats.numSignedExtrinsics ? blockStats.numSignedExtrinsics : 0
                                let numTransfers = blockStats && blockStats.numTransfers ? blockStats.numTransfers : 0
                                let numEvents = blockStats && blockStats.numEvents ? blockStats.numEvents : 0
                                let valueTransfersUSD = blockStats && blockStats.valueTransfersUSD ? blockStats.valueTransfersUSD : 0
                                let fees = blockStats && blockStats.fees ? blockStats.fees : 0
                                let vals = ["numExtrinsics", "numSignedExtrinsics", "numTransfers", "numEvents", "valueTransfersUSD", "fees"]
                                let evals = "";

                                let out = `('${blockNumber}', '${numExtrinsics}', '${numSignedExtrinsics}', '${numTransfers}', '${numEvents}', '${valueTransfersUSD}', '${fees}' ${evals} )`;
                                await this.upsertSQL({
                                    "table": `block${chainID}`,
                                    "keys": ["blockNumber"],
                                    "vals": vals,
                                    "data": [out],
                                    "replace": vals
                                });
                                //sourabh
                            } else {
                                if (this.debugLevel > paraTool.debugErrorOnly) console.log(`BN#${block.number} ${blockHash} blockTS missing!!!`)
                            }
                        } else {
                            this.logger.warn({
                                "op": "subscribeStorage",
                                chainID,
                                blockNumber
                            })
                        }
                    } catch (err) {
                        if (err.toString().includes("disconnected")) {
                            console.log(err);
                        } else {
                            console.log(err);
                            this.logger.error({
                                "op": "subscribeStorage",
                                chainID,
                                err
                            })
                        }
                    }
                });
            } else {
                // subscribeNewHeads -- most of this code is similar to the above...
                const unsubscribeStorage = await this.api.rpc.chain.subscribeNewHeads(async (header) => {
                    try {
                        this.lastEventReceivedTS = this.getCurrentTS(); // if not received in 5mins, reset
                        // build block similar to sidecar
                        let blockHash = header.hash.toString();
                        let [signedBlock, events] = await this.crawlBlock(this.api, blockHash);
                        let blockTS = signedBlock.blockTS;

                        // to avoid 'hash' error, we create the a new block copy without decoration and add hash in
                        let block = JSON.parse(JSON.stringify(signedBlock));
                        block.number = paraTool.dechexToInt(block.header.number);
                        block.hash = blockHash;
                        block.blockTS = blockTS;
                        let blockNumber = block.number;
                        let subscribeStorageMsg = {
                            "bn": blockNumber,
                            "chainID": chainID
                        }
                        if (blockNumber > this.latestBlockNumber) this.latestBlockNumber = blockNumber;
                        // write { blockraw:blockHash => block, events:blockHash => events } to bigtable
                        let success = await this.save_block(chainID, block, blockHash, events, [], false);
                        if (success) {
                            // write to mysql
                            let blockTS = block.blockTS;
                            if (blockTS > 0) {
                                this.apiAt = this.api //set here for opaqueCall  // TODO: what if metadata changes?
                                let signedExtrinsicBlock = block
                                signedExtrinsicBlock.extrinsics = signedBlock.extrinsics //add signed extrinsics
                                let isFinalized = false
                                let isTip = true
                                // this.processBlockEvents(this.chainID, r.block, r.events, null, null, null, api, isFinalized, false, isTip);
                                let [blockStats, xcmMeta] = await this.processBlockEvents(chainID, signedExtrinsicBlock, events, null, null, null, this.api, isFinalized, false, isTip);

                                await this.immediateFlushBlockAndAddressExtrinsics(true) //this is tip
                                if (blockNumber > this.blocksCovered) {
                                    // only update blocksCovered in the DB if its HIGHER than what we have seen before
                                    var sql = `update chain set blocksCovered = '${blockNumber}', lastCrawlDT = Now() where chainID = '${chainID}' and blocksCovered < ${blockNumber}`
                                    this.batchedSQL.push(sql);
                                    this.blocksCovered = blockNumber;
                                }
                                let numExtrinsics = blockStats && blockStats.numExtrinsics ? blockStats.numExtrinsics : 0
                                let numSignedExtrinsics = blockStats && blockStats.numSignedExtrinsics ? blockStats.numSignedExtrinsics : 0
                                let numTransfers = blockStats && blockStats.numTransfers ? blockStats.numTransfers : 0
                                let numEvents = blockStats && blockStats.numEvents ? blockStats.numEvents : 0
                                let valueTransfersUSD = blockStats && blockStats.valueTransfersUSD ? blockStats.valueTransfersUSD : 0
                                let fees = blockStats && blockStats.fees ? blockStats.fees : 0
                                let vals = ["numExtrinsics", "numSignedExtrinsics", "numTransfers", "numEvents", "valueTransfersUSD", "fees"]
                                let evals = "";
                                let out = `('${blockNumber}', '${numExtrinsics}', '${numSignedExtrinsics}', '${numTransfers}', '${numEvents}', '${valueTransfersUSD}', '${fees}' ${evals} )`;
                                await this.upsertSQL({
                                    "table": `block${chainID}`,
                                    "keys": ["blockNumber"],
                                    "vals": vals,
                                    "data": [out],
                                    "replace": vals
                                });
                                await this.update_batchedSQL();
                            } else {
                                if (this.debugLevel > paraTool.debugErrorOnly) console.log(`BN#${block.number} ${blockHash} blockTS missing!!!`)
                            }
                        } else {
                            this.logger.warn({
                                "op": "subscribeNewHeads",
                                chainID,
                                blockNumber
                            })
                        }

                    } catch (err) {
                        if (err.toString().includes("disconnected")) {
                            console.log(err);
                        } else {
                            console.log(err);
                            this.logger.error({
                                "op": "subscribeStorage",
                                chainID,
                                err
                            })
                        }
                    }
                });
            }
        } catch (errus) {
            console.log(errus);
            unsubscribeStorage = false
        }

        return [unsubscribeFinalizedHeads, unsubscribeStorage, unsubscribeRuntimeVersion];
    }

}