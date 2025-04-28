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

const ini = require('node-ini');

const {
    keccakAsU8a
} = require('@polkadot/util-crypto');

const {
    Bigtable
} = require("@google-cloud/bigtable");
const {
    BigQuery
} = require('@google-cloud/bigquery');
const {
    Storage
} = require('@google-cloud/storage');
const stream = require("stream");
const paraTool = require("./paraTool.js");
const mysql = require("mysql2");
const bunyan = require('bunyan');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const path = require('path');
const fs = require('fs');
const os = require("os");
const {
    BloomFilter
} = require('bloom-filters');

// Imports the Google Cloud client library for Bunyan
const {
    LoggingBunyan
} = require('@google-cloud/logging-bunyan');

module.exports = class PolkaholicDB {
    finished = util.promisify(stream.finished);
    exitOnDisconnect = true;
    isDisconneted = false;
    isConneted = false;
    disconnectedCnt = 0;
    isErrored = false;
    // general purpose sql batches
    // Creates a Bunyan Cloud Logging client
    logger = false;
    hostname = false;
    batchedSQL = [];
    initChainInfos = false;
    commitHash = 'NA';
    specVersions = {};
    chainInfos = {};
    chainNames = {};
    paraIDs = [];
    paras = {};
    pool = false;
    defaultBQLocation = "US";

    numIndexingErrors = 0;
    reloadChainInfo = false; // if set to true after system properties brings in a new asset, we get one chance to do so.
    lastBatchTS = 0;
    connection = false;
    APIWSEndpoint = null;

    GC_PROJECT = "";
    GC_BIGTABLE_INSTANCE = "";
    GC_BIGTABLE_CLUSTER = "";

    GC_STORAGE_BUCKET = "";

    POLKAHOLIC_EMAIL_USER = "";
    POLKAHOLIC_EMAIL_PASSWORD = "";

    EXTERNAL_WS_PROVIDER_URL = null;
    EXTERNAL_WS_PROVIDER_KEY = null;
    WSProviderQueue = {};

    BQ_SUBSTRATEETL_KEY = null;
    bigQuery = null;
    googleStorage = null;
    bqTablesCallsEvents = null;
    replica = 0;

    constructor(serviceName = "polkaholic") {

        // Creates a Bunyan Cloud Logging client
        const loggingBunyan = new LoggingBunyan();
        this.logger = bunyan.createLogger({
            // The JSON payload of the log as it appears in Cloud Logging
            // will contain "name": "my-service"
            name: serviceName,
            streams: [
                // Log to the console at 'debug' and above
                {
                    stream: process.stdout,
                    level: 'debug'
                },
                // And log to Cloud Logging, logging at 'info' and above
                loggingBunyan.stream('debug'),
            ],
        });

        this.hostname = os.hostname();
        this.commitHash = paraTool.commitHash()
        this.version = `1.0.0` // we will update this manually
        this.indexerInfo = `${this.version}-${this.commitHash.slice(0,7)}`
        console.log(`****  Initiating Polkaholic ${this.indexerInfo} ****`)

        // 1. ready db config for WRITABLE mysql pool [always in US presently] using env variable POLKAHOLIC_DB
        let dbconfigFilename = (process.env.POLKAHOLIC_DB != undefined) ? process.env.POLKAHOLIC_DB : '/root/.mysql/.db00.cnf';
        try {
            let dbconfig = ini.parseSync(dbconfigFilename);
            if (dbconfig.email != undefined) {
                this.POLKAHOLIC_EMAIL_USER = dbconfig.email.email;
                this.POLKAHOLIC_EMAIL_PASSWORD = dbconfig.email.password;
            }
            if (dbconfig.gc != undefined) {
                this.GC_PROJECT = dbconfig.gc.projectName;
                this.GC_BIGTABLE_INSTANCE = dbconfig.gc.bigtableInstance;
                this.GC_BIGTABLE_CLUSTER = dbconfig.gc.bigtableCluster;
                this.GC_STORAGE_BUCKET = dbconfig.gc.storageBucket;
            }

            if (dbconfig.ws != undefined) {
                this.EXTERNAL_WS_PROVIDER_KEY = dbconfig.ws.key;
                this.EXTERNAL_WS_PROVIDER_URL = dbconfig.ws.url;
            }

            if (dbconfig.bq != undefined) {
                if (dbconfig.bq.substrateetlKey) {
                    this.BQ_SUBSTRATEETL_KEY = dbconfig.bq.substrateetlKey;
                }
            }

            if (dbconfig.externalapis != undefined) {
                if (dbconfig.externalapis) {
                    this.EXTERNAL_APIKEYS = dbconfig.externalapis;
                }
            }

            this.pool = mysql.createPool(this.convert_dbconfig(dbconfig.client));
            // Ping WRITABLE database to check for common exception errors.
            this.pool.getConnection((err, connection) => {
                if (err) {
                    if (err.code === 'PROTOCOL_CONNECTION_LOST') {
                        console.error('Database connection was closed.')
                    }
                    if (err.code === 'ER_CON_COUNT_ERROR') {
                        console.error('Database has too many connections.')
                    }
                    if (err.code === 'ECONNREFUSED') {
                        console.error('Database connection was refused.')
                    }
                }

                if (connection) {
                    this.connection = connection;
                    connection.release()
                }
                return
            })
            // Promisify for Node.js async/await.
            this.pool.query = util.promisify(this.pool.query).bind(this.pool)
            this.pool.end = util.promisify(this.pool.end).bind(this.pool)
        } catch (err) {
            console.log(err);
            this.logger.fatal({
                "op": "dbconfig",
                err
            });
        }

        // 2. ready db config for READONLY mysql pool [default US replica but could be EU/AS replica] using env variable POLKAHOLIC_DB_REPLICA
        let dbconfigReplicaFilename = (process.env.POLKAHOLIC_DB_REPLICA != undefined) ? process.env.POLKAHOLIC_DB_REPLICA : '/root/.mysql/.db00-us-indexer.cnf';
        try {
            let dbconfigREADONLY = ini.parseSync(dbconfigReplicaFilename);
            this.poolREADONLY = mysql.createPool(this.convert_dbconfig(dbconfigREADONLY.client));
            // Ping READONLY database to check for common exception errors.
            this.poolREADONLY.getConnection((err, connection) => {
                if (err) {
                    if (err.code === 'PROTOCOL_CONNECTION_LOST') {
                        console.error('Database connection was closed.')
                    }
                    if (err.code === 'ER_CON_COUNT_ERROR') {
                        console.error('Database has too many connections.')
                    }
                    if (err.code === 'ECONNREFUSED') {
                        console.error('Database connection was refused.')
                    }
                }

                if (connection) {
                    this.connectionREADONLY = connection;
                    connection.release()
                }
                return
            })
            // Promisify for Node.js async/await.
            this.poolREADONLY.query = util.promisify(this.poolREADONLY.query).bind(this.poolREADONLY)
            this.poolREADONLY.end = util.promisify(this.poolREADONLY.end).bind(this.poolREADONLY)
        } catch (err) {
            console.log(err);
            this.logger.fatal({
                "op": "dbconfigReplica",
                err
            });
        }
        const bigtable = new Bigtable({
            projectId: this.GC_PROJECT
        });
        const instanceName = this.GC_BIGTABLE_INSTANCE;
        const tableAddressExtrinsic = "addressextrinsic";
        const tableAccountRealtime = "accountrealtime";

        const tableEVMTx = "evmtx";
        const tableHashes = "hashes";
        const tableAddress = "address";
        const tableAPIKeys = "apikeys";
        this.instance = bigtable.instance(instanceName);
        this.btAddressExtrinsic = this.instance.table(tableAddressExtrinsic);
        this.btHashes = this.instance.table(tableHashes);
        this.btEVMTx = this.instance.table(tableEVMTx);
        this.btAccountRealtime = this.instance.table(tableAccountRealtime);

        this.btAPIKeys = this.instance.table(tableAPIKeys);
    }

    convert_dbconfig(c) {
        return {
            host: c.host,
            user: c.user,
            password: c.password,
            database: c.database,
            charset: c['default-character-set']
        };
    }

    get_btTableRealtime() {

        return ["accountrealtime", this.btAccountRealtime];
    }

    async release(msDelay = 1000) {
        await this.pool.end();
        if (this.connection) {
            await this.connection.destroy();
            this.connection = false;
        }
        await this.sleep(msDelay);
    }

    cacheInit() {
        const Memcached = require("memcached-promise");
        this.memcached = new Memcached("127.0.0.1:11211", {
            maxExpiration: 2592000,
            namespace: "polkaholic",
            debug: false
        });
    }

    async cacheWrite(key, val) {
        if (!this.memcached) this.cacheInit();
        await this.memcached.set(key, val);
    }

    async cacheRead(key) {
        if (!this.memcached) this.cacheInit();
        return this.memcached.get(key)
    }

    async sleep(ms) {
        return new Promise((resolve) => {
            setTimeout(resolve, ms);
        });
    }

    async getBlockRangebyTS(chainID, startTS, endTS) {
        let sql = `select UNIX_TIMESTAMP(min(blockDT)) startTS, UNIX_TIMESTAMP(max(blockDT)) endTS, min(blockNumber) startBN, max(blockNumber) endBN from block${chainID} where blockDT >= from_unixtime(${startTS}) and blockDT < from_unixtime(${endTS});`
        //if (this.debugLevel >= paraTool.debugTracing) console.log(`getBlockRangebyTS`, sql)
        var res = await this.poolREADONLY.query(sql);
        if (res.length > 0) {
            let r = res[0]
            r.rangeLen = 1 + r.endBN - r.startBN
            r.chainID = chainID
            return r
        } else {
            return false
        }
    }

    async getKnownParachains() {
        let knownParaChainsMap = {}
        var knownParaChains = await this.poolREADONLY.query(`select chainID, id, chainName, relayChain, paraID from chain`);
        if (knownParaChains.length > 0) {
            for (const kp of knownParaChains) {
                let fullParaID = `${kp.relayChain}-${kp.paraID}`
                knownParaChainsMap[fullParaID] = kp
            }
        }
        return knownParaChainsMap
    }

    async getChainLiquidityPair(chainID) {
        var sql = `select asset, chainID from asset where chainID = ${chainID} and assetType = 'LiquidityPair'`
        var assets = await this.poolREADONLY.query(sql);
        return assets
    }

    getSpecVersionForBlockNumber(chainID, blockNumber) {
        if (!this.specVersions) return (0);
        if (!this.specVersions[chainID.toString()]) return (0);
        let sv = this.specVersions[chainID.toString()];
        for (let i = sv.length - 1; i >= 0; i--) {
            if (blockNumber >= sv[i].blockNumber) {
                return (sv[i].specVersion);
            }
        }
        return (0);
    }

    getChainDecimal(chainID) {
        if (chainID == undefined || chainID === null || chainID === false) {
            console.log("FAILED getChainDecimal", chainID);
            return false;
        }

        chainID = chainID.toString()
        if (this.chainInfos[chainID] != undefined) {
            return this.chainInfos[chainID].decimal
        } else {
            console.log("getChainDecimal FATAL ERROR: must call init", chainID)
        }
    }

    getChainSymbol(chainID) {
        if (typeof chainID !== "string") chainID = chainID.toString()
        if (chainID == undefined || chainID === null || chainID === false) {
            console.log("FAILED getChainSymbol", chainID);
            return false;
        }

        if (this.chainInfos[chainID] != undefined) {
            return this.chainInfos[chainID].symbol
        } else {
            console.log("getChainSymbol FATAL ERROR: must call init", chainID)
        }
    }

    getChainAsset(chainID) {
        chainID = chainID.toString()
        let assetChain = null
        if (this.chainInfos[chainID] != undefined && this.chainInfos[chainID].symbol != undefined) {
            let asset = JSON.stringify({
                "Token": this.chainInfos[chainID].symbol
            })
            assetChain = paraTool.makeAssetChain(asset, chainID);
            if (this.assetInfo[assetChain] != undefined) {
                return (asset);
            }
        }
        console.log(`[${chainID}] getChainAsset FATAL ERROR: must call init for ${assetChain}`, this.chainInfos[chainID])
        return null
    }

    getChainName(chainID) {
        chainID = chainID.toString()
        if (this.chainInfos[chainID] != undefined) {
            return this.chainInfos[chainID].name
        } else {
            console.log("getChainName FATAL ERROR: must call init", chainID)
            let relay = paraTool.getRelayChainByChainID(chainID)
            let paraID = paraTool.getParaIDfromChainID(chainID)
            let name = `${relay}[paraID:${paraID}]`
            return name
        }
    }

    getChainEVMStatus(chainID) {
        if (chainID) {
            chainID = chainID.toString()
            if (this.chainInfos[chainID] != undefined) {
                return this.chainInfos[chainID].isEVM
            } else {
                console.log("getChainEVMStatus FATAL ERROR: must call init", chainID)
            }
        }
        return null;
    }

    getChainFullInfo(chainID) {
        chainID = chainID.toString()
        let chainInfo = this.chainInfos[chainID]
        if (chainInfo != undefined) {
            let r = {
                chainID: paraTool.dechexToInt(chainID),
                chainName: chainInfo.name,
                asset: chainInfo.asset,
                symbol: chainInfo.symbol,
                ss58Format: chainInfo.ss58Format,
                evmChainID: chainInfo.evmChainID,
                decimals: chainInfo.decimal,
                priceUSD: chainInfo.priceUSD,
                priceUSDPercentChange: paraTool.round(chainInfo.priceUSDPercentChange, 2),
                relayChain: chainInfo.relayChain,
            }
            //console.log("getChainFullInfo", chainInfo, r)
            return r
        } else {
            return {
                chainID: paraTool.dechexToInt(chainID),
                chainName: `chain${chainID}`,
                symbol: "NA",
                decimals: 12,
                priceUSD: 0,
                priceUSDPercentChange: 0,
                relayChain: "NA",
            }
        }
    }

    getRelayChainID(chainID) {
        if (chainID == paraTool.chainIDPolkadot || chainID == paraTool.chainIDKusama) {
            return (chainID);
        }
        if (this.chainInfos[chainID] == undefined) {
            console.log("1: could not determine relaychainID", chainID);
            return (false);
        }
        let relayChain = this.chainInfos[chainID].relayChain;
        if (relayChain == "kusama") return (paraTool.chainIDKusama);
        if (relayChain == "polkadot") return (paraTool.chainIDPolkadot);
        console.log("2: could not determine relaychainID", chainID);
        return (false);
    }

    async getParas() {
        let paras = await this.poolREADONLY.query(`select id, chainID, chainName, relayChain, paraID, concat(relayChain,'-',paraID) as fullparaID, symbol from chain order by relayChain desc, chainID;`);
        return (paras);
    }

    getParaInfo(paraID, sourceChainID) {
        sourceChainID = parseInt(sourceChainID, 10)
        let relayChainType = sourceChainID == paraTool.chainIDPolkadot ? "Polkadot" : "Kusama"
        let relayChainSymbol = sourceChainID == paraTool.chainIDPolkadot ? "DOT" : "KSM"
        let fullParaID = sourceChainID == paraTool.chainIDPolkadot ? `polkadot-${paraID}` : `kusama-${paraID}`

        let paraInfo = this.paras[fullParaID]
        if (paraInfo != undefined) {
            return {
                paraId: parseInt(paraID, 10),
                name: (paraInfo.chainName != undefined) ? paraInfo.chainName : paraInfo.id,
                relayChain: relayChainType,
                relayChainSymbol: relayChainSymbol
            }
        } else {
            return {
                paraId: parseInt(paraID, 10),
                name: null,
                relayChain: relayChainType,
                relayChainSymbol: relayChainSymbol
            }
        }
    }

    getNameByChainID(chainID) {
        if (this.chainInfos[chainID] != undefined) {
            // [chainID, id]
            let cID = parseInt(chainID, 10)
            return [cID, this.chainInfos[chainID].id]
        }
        return [false, false]
    }

    getIDByChainID(chainID) {
        if (this.chainInfos[chainID] != undefined) {
            // [chainID, id]
            let cID = parseInt(chainID, 10)
            return this.chainInfos[chainID].id
        }
        return false
    }

    getChainIDByName(id) {
        if (this.chainNames[id] != undefined) {
            // [chainID, id]
            return [this.chainNames[id].chainID, id]
        }
        return [false, false]
    }

    getTableChain(chainID) {
        return this.instance.table("chain" + chainID);
    }

    getEvmTableChain(chainID) {
        return this.instance.table("evmchain" + chainID);
    }

    currentTS() {
        return Math.floor(new Date().getTime() / 1000);
    }

    async numConnections() {
        var sql = 'SELECT COUNT(*) nconn FROM information_schema.PROCESSLIST';
        var q = await this.pool.query(sql);
        if (q.length > 0) {
            let numConn = q[0].nconn;
            if (numConn > 1000) console.log("WARNING: numConnections: ", numConn, "SIZE", this.batchedSQL.length);
            if (numConn > 3000) {
                console.log("TERMINATING Too many connections", numConn);
                process.exit(1);
            }
            return (numConn);
        }
    }

    async update_batchedSQL(sqlMax = 1.50) {
        if (this.batchedSQL.length == 0) return;
        var currentTS = this.currentTS();

        this.lastBatchTS = currentTS;
        let retrySQL = [];
        for (var i = 0; i < this.batchedSQL.length; i++) {
            let sql = this.batchedSQL[i];
            try {
                let sqlStartTS = new Date().getTime();
                await this.pool.query(sql);
                let sqlTS = (new Date().getTime() - sqlStartTS) / 1000;
                if (sqlTS > sqlMax) {
                    this.logger.info({
                        "op": "SLOWSQL",
                        "sql": (sql.length > 4096) ? sql.substring(0, 4096) : sql,
                        "len": sql.length,
                        "sqlTS": sqlTS
                    });
                }
            } catch (err) {
                if (err.toString().includes("Deadlock found")) {
                    retrySQL.push(sql);
                } else {
                    this.logger.error({
                        "op": "update_batchedSQL",
                        "sql": (sql.length > 4096) ? sql.substring(0, 4096) : sql,
                        "len": sql.length,
                        "try": 1,
                        err
                    });
                    this.numIndexingErrors++;
                    console.log("polkaholicDB numIndexingErrors ERROR", err);
                    let tsm = new Date().getTime();
                    let fn = "/var/log/" + tsm + "-" + i + ".sql";
                    await fs.writeFileSync(fn, sql);
                }
            }
        }
        this.batchedSQL = [];
        if (retrySQL.length > 0) {
            for (var i = 0; i < retrySQL.length; i++) {
                let sql = retrySQL[i];
                try {
                    await this.pool.query(sql);
                } catch (err) {
                    if (err.toString().includes("Deadlock found")) {
                        this.batchedSQL.push(sql);
                    } else {
                        this.logger.error({
                            "op": "update_batchedSQL RETRY",
                            "sql": (sql.length > 4096) ? sql.substring(0, 4096) : sql,
                            "len": sql.length,
                            "try": 2,
                            err
                        });
                        this.numIndexingErrors++;
                        console.log("*polkaholicDB numIndexingErrors ERROR", err);
                        let tsm = new Date().getTime()
                        let fn = "/var/log/" + tsm + "-" + i + ".sql";
                        await fs.writeFileSync(fn, sql);
                    }
                }
            }
        }
    }


    async upsertSQL(flds, debug = false, sqlMax = 1.50) {
        let tbl = flds.table;
        let keys = flds.keys;
        let vals = flds.vals;
        let data = flds.data;

        if (tbl == undefined || typeof tbl !== "string") return (false);
        if (keys == undefined || !Array.isArray(keys)) return (false);
        if (vals == undefined || !Array.isArray(vals)) return (false);
        if (data == undefined || !Array.isArray(data)) return (false);
        if (data.length == 0) return (false);

        let out = [];
        if (flds.replace !== undefined) {
            let farr = flds.replace;
            for (let i = 0; i < farr.length; i++) {
                let f = farr[i];
                out.push(`${f}=VALUES(${f})`);
            }
        }
        if (flds.replaceIfNull !== undefined) {
            let farr = flds.replaceIfNull;
            for (let i = 0; i < farr.length; i++) {
                let f = farr[i];
                out.push(`${f}=IF(${f} is null, VALUES(${f}), ${f})`);
            }
        }
        if (flds.lastUpdateBN !== undefined) {
            let farr = flds.lastUpdateBN;
            for (let i = 0; i < farr.length; i++) {
                let f = farr[i];
                out.push(`${f}=IF( lastUpdateBN <= values(lastUpdateBN), VALUES(${f}), ${f})`)
            }
        }
        let keysvals = keys.concat(vals);
        let fldstr = keysvals.join(",")
        let sql = `insert into ${tbl} (${fldstr}) VALUES ` + data.join(",");
        if (out.length > 0) {
            sql = sql + " on duplicate key update " + out.join(",")
        }
        this.batchedSQL.push(sql);
        if (debug) {
            console.log(sql);
        }
        await this.update_batchedSQL(sqlMax);
        return sql;
    }

    /*
    chainID: 0
    chainIDDest: 1000
    violationType: symbol
     parser: processV1ConcreteFungible
     caller: processOutgoingXcmPallet xcmPallet:limitedTeleportAssets
    errorcase: NULL
    instruction: {"id":{"concrete":{"parents":0,"interior":{"here":null}}},"fun":{"fungible":11000000000}}
    instructionHash: caad52bdc0938215c32c6778f2e1a1701e35ce397e72d1534cda9b09caa02c07
    sourceBlocknumber: 12224070
    sourceTS: 1664234238
    indexDT: 2022-09-27 21:50:39
    */
    async getXcmViolation(violationType = 'symbol') {
        let xcmViolations = await this.poolREADONLY.query(`select chainID, chainIDDest, violationType, parser, caller, errorcase, instruction, sourceBlocknumber, sourceTS, indexDT from xcmViolation where violationType='${violationType}' order by chainID`)
        let res = {}
        for (const v of xcmViolations) {
            let chainID = v.chainID
            if (res[chainID] == undefined) res[chainID] = []
            v.instruction = JSON.parse(`${v.instruction}`)
            res[chainID].push(v)
        }
        return res
    }

    async getEraBlocks(chainID = paraTool.chainIDPolkadot) {
        //let eraBlocks = await this.poolREADONLY.query(`SELECT era, block_number, DATE_FORMAT(blockDT, '%Y-%m-%d') AS blockDT, blockTS, blockhash from era${chainID} order by era`)
        let eraBlocks = await this.poolREADONLY.query(`SELECT e1.era, e1.block_number, DATE_FORMAT(e1.blockDT, '%Y-%m-%d') AS blockDT, e1.blockTS, e1.blockhash AS blockhash, e2.blockhash AS era1Hash, e3.blockhash AS era2Hash FROM era${chainID} e1 LEFT JOIN era${chainID} e2 ON e1.era + 1 = e2.era LEFT JOIN era${chainID} e3 ON e1.era + 2 = e3.era ORDER BY e1.era;`)
        let eraDTMap = {}
        for (const v of eraBlocks) {
            if (eraDTMap[v.blockDT] == undefined) eraDTMap[v.blockDT] = []
            eraDTMap[v.blockDT].push(v)
        }
        return eraDTMap
    }

    async getChains(crawling = 1, orderBy = "valueTransfersUSD7d DESC") {
        let chains = await this.poolREADONLY.query(`select id, ss58Format as prefix, chain.chainID, chain.chainName, blocksCovered, blocksFinalized, blocksArchived, chain.symbol, lastCrawlDT, lastFinalizedDT, unix_timestamp(lastCrawlDT) as lastCrawlTS,
unix_timestamp(lastFinalizedDT) as lastFinalizedTS,  iconUrl, numExtrinsics7d, numExtrinsics30d, numExtrinsics, numSignedExtrinsics7d, numSignedExtrinsics30d, numSignedExtrinsics, numTransfers7d, numTransfers30d, numTransfers, numEvents7d, numEvents30d, numEvents,
valueTransfersUSD7d, valueTransfersUSD30d, valueTransfersUSD, numTransactionsEVM, numTransactionsEVM7d, numTransactionsEVM30d, numAccountsActive, numAccountsActive7d, numAccountsActive30d, chain.relayChain, chain.paraID, totalIssuance, lastUpdateChainAssetsTS,
onfinalityID, onfinalityStatus, onfinalityConfig, isEVM, chain.asset, WSEndpoint, WSEndpoint2, WSEndpoint3, active, crawlingStatus, githubURL, substrateURL, parachainsURL, dappURL, xcmasset.priceUSD, xcmasset.priceUSDPercentChange, 0 as numHolders
from chain left join xcmasset on chain.symbolXcmInteriorKey = xcmasset.xcmInteriorKey where crawling = ${crawling} order by ${orderBy}`);
        return (chains);
    }

    async getChainsForAdmin(crawling = 1) {
        let chains = await this.poolREADONLY.query(`select id, ss58Format as prefix, chainID, chain.chainName, symbol, iconUrl, relayChain, onfinalityID, onfinalityStatus, onfinalityConfig, isEVM, asset, WSEndpoint, WSEndpoint2, WSEndpoint3, paraID from chain where crawling = ${crawling} order by chainID`);
        return (chains);
    }

    async getChainForAdmin(chainID = 0) {
        let chains = await this.poolREADONLY.query(`select id, ss58Format as prefix, chainID, chain.chainName, symbol, iconUrl, relayChain, onfinalityID, onfinalityStatus, onfinalityConfig, isEVM, asset, WSEndpoint, WSEndpoint2, WSEndpoint3, paraID from chain where chainID = ${chainID} order by chainID`);
        if (chains.length == 0) return (false);
        return (chains[0]);
    }

    async get_chains_external(crawling = 1) {
        let chains = await this.poolREADONLY.query(`select id, ss58Format as prefix, chain.chainID, CONCAT(UPPER(SUBSTRING(chain.chainName,1,1)),LOWER(SUBSTRING(chain.chainName,2))) AS chainName, chain.symbol, unix_timestamp(lastFinalizedDT) as lastFinalizedTS, iconUrl,
numExtrinsics7d, numExtrinsics30d, numExtrinsics, numSignedExtrinsics7d, numSignedExtrinsics30d, numSignedExtrinsics, numTransfers7d, numTransfers30d, numTransfers, numEvents7d, numEvents30d, numEvents, valueTransfersUSD7d, valueTransfersUSD30d, valueTransfersUSD,
numXCMTransferIncoming, numXCMTransferIncoming7d, numXCMTransferIncoming30d, numXCMTransferOutgoing, numXCMTransferOutgoing7d, numXCMTransferOutgoing30d, valXCMTransferIncomingUSD, valXCMTransferIncomingUSD7d, valXCMTransferIncomingUSD30d, valXCMTransferOutgoingUSD,
valXCMTransferOutgoingUSD7d, valXCMTransferOutgoingUSD30d, numTransactionsEVM, numTransactionsEVM7d, numTransactionsEVM30d, 0 as numHolders, numAccountsActive, numAccountsActive7d, numAccountsActive30d, chain.relayChain, chain.paraID, totalIssuance, isEVM, blocksCovered, blocksFinalized,
crawlingStatus, githubURL, substrateURL, parachainsURL, dappURL, chain.asset, xcmasset.decimals, xcmasset.priceUSD, xcmasset.priceUSDPercentChange
from chain left join xcmasset on chain.symbolXcmInteriorKey = xcmasset.xcmInteriorKey where crawling = ${crawling} order by relayChain, id, chainID;`);
        return (chains);
    }

    async getChain(chainID, withSpecVersions = false) {
        var chains = await this.poolREADONLY.query(`select id, ss58Format as prefix, chainID, chainName, WSEndpoint, WSEndpointSelfHosted, WSEndpointArchive, WSEndpoint2, WSEndpoint3, WSBackfill, RPCBackfill, evmRPC, evmRPCInternal, evmRPCBlockReceipts, evmChainID, blocksCovered, blocksFinalized, blocksArchived, isEVM, backfillLookback, lastUpdateChainAssetsTS, onfinalityID, onfinalityStatus, onfinalityConfig, numHolders, asset, relayChain, lastUpdateStorageKeysTS, crawlingStatus, etherscanAPIURL,
numExtrinsics, numExtrinsics7d, numExtrinsics30d,
numSignedExtrinsics, numSignedExtrinsics7d, numSignedExtrinsics30d,
numTransfers, numTransfers7d, numTransfers30d,
numEvents, numEvents7d, numEvents30d,
numTransactionsEVM, numTransactionsEVM7d, numTransactionsEVM30d,
numReceiptsEVM, numReceiptsEVM7d, numReceiptsEVM30d,
floor(gasUsed / (numEVMBlocks+1)) as gasUsed,
floor(gasUsed7d / (numEVMBlocks7d+1)) as gasUsed7d,
floor(gasUsed30d / (numEVMBlocks30d+1)) as gasUsed30d,
floor(gasLimit / (numEVMBlocks+1)) as gasLimit,
floor(gasLimit7d / (numEVMBlocks7d+1)) as gasLimit7d,
floor(gasLimit30d / (numEVMBlocks30d+1)) as gasLimit30d,
numXCMTransferIncoming, numXCMTransferIncoming7d, numXCMTransferIncoming30d,
numXCMTransferOutgoing, numXCMTransferOutgoing7d, numXCMTransferOutgoing30d,
valXCMTransferIncomingUSD, valXCMTransferIncomingUSD7d, valXCMTransferIncomingUSD30d,
valXCMTransferOutgoingUSD, valXCMTransferOutgoingUSD7d, valXCMTransferOutgoingUSD30d
from chain where chainID = '${chainID}' limit 1`);
        if (chains.length == 0) return (false);
        let chain = chains[0];
        if (withSpecVersions) {
            let specVersions = await this.poolREADONLY.query(`select specVersion, blockNumber, blockHash from specVersions where chainID = '${chainID}' and blockNumber > 0 order by specVersion`);
            chain.specVersions = specVersions;
        }
        // because some chains don't have subscribeStorage support (and subscribeStorage updates blocksCovered...)
        if (chain.blocksCovered == null || chain.blocksCovered < chain.blocksFinalized) {
            chain.blocksCovered = chain.blocksFinalized
        }
        if (chainID == paraTool.chainIDPolkadot || chainID == paraTool.chainIDKusama) {
            let paraIDs = await this.poolREADONLY.query(`select paraID from chainparachain where chainID = '${chainID}'`);
            for (let i = 0; i < paraIDs.length; i++) {
                let paraID = paraIDs[i].paraID;
                this.paraIDs.push(paraID);

            }
        }
        return chain;
    }
    async getChainWithVersion(chainID, withSpecVersions = false) {
        var chains = await this.poolREADONLY.query(`select id, ss58Format as prefix, chainID, chainName, WSEndpoint, WSEndpointSelfHosted, WSEndpoint2, WSEndpoint3, WSBackfill, RPCBackfill, evmChainID, evmRPC, evmRPCInternal, blocksCovered, blocksFinalized, isEVM, backfillLookback, lastUpdateChainAssetsTS, onfinalityID, onfinalityStatus, onfinalityConfig, numHolders, asset, relayChain, lastUpdateStorageKeysTS, crawlingStatus,
numExtrinsics, numExtrinsics7d, numExtrinsics30d,
numSignedExtrinsics, numSignedExtrinsics7d, numSignedExtrinsics30d,
numTransfers, numTransfers7d, numTransfers30d,
numEvents, numEvents7d, numEvents30d,
numTransactionsEVM, numTransactionsEVM7d, numTransactionsEVM30d,
numReceiptsEVM, numReceiptsEVM7d, numReceiptsEVM30d,
floor(gasUsed / (numEVMBlocks+1)) as gasUsed,
floor(gasUsed7d / (numEVMBlocks7d+1)) as gasUsed7d,
floor(gasUsed30d / (numEVMBlocks30d+1)) as gasUsed30d,
floor(gasLimit / (numEVMBlocks+1)) as gasLimit,
floor(gasLimit7d / (numEVMBlocks7d+1)) as gasLimit7d,
floor(gasLimit30d / (numEVMBlocks30d+1)) as gasLimit30d,
numXCMTransferIncoming, numXCMTransferIncoming7d, numXCMTransferIncoming30d,
numXCMTransferOutgoing, numXCMTransferOutgoing7d, numXCMTransferOutgoing30d,
valXCMTransferIncomingUSD, valXCMTransferIncomingUSD7d, valXCMTransferIncomingUSD30d,
valXCMTransferOutgoingUSD, valXCMTransferOutgoingUSD7d, valXCMTransferOutgoingUSD30d
from chain where chainID = '${chainID}' limit 1`);
        if (chains.length == 0) return (false);
        let chain = chains[0];
        if (withSpecVersions) {
            let specVersions = await this.poolREADONLY.query(`select specVersion, blockNumber, blockHash from specVersions where chainID = '${chainID}' and blockNumber > 0 order by specVersion`);
            chain.specVersions = specVersions;
        }
        // because some chains don't have subscribeStorage support (and subscribeStorage updates blocksCovered...)
        if (chain.blocksCovered == null || chain.blocksCovered < chain.blocksFinalized) {
            chain.blocksCovered = chain.blocksFinalized
        }
        if (chainID == paraTool.chainIDPolkadot || chainID == paraTool.chainIDKusama) {
            let paraIDs = await this.poolREADONLY.query(`select paraID from chainparachain where chainID = '${chainID}'`);
            for (let i = 0; i < paraIDs.length; i++) {
                let paraID = paraIDs[i].paraID;
                this.paraIDs.push(paraID);

            }
        }
        return chain;
    }

    async getWeb3Api(chain, backfill = false) {
        if (this.web3Api) return (this.web3Api);

        const Web3 = require('web3')
        var rpcURL = false;
        if (chain.isEVM > 0) {
            if (chain.evmRPC) {
                rpcURL = chain.evmRPC;
                if (backfill && chain.evmRPCInternal && chain.evmRPCInternal.length > 0) {
                    rpcURL = chain.evmRPCInternal;
                    console.log("**** USING evmRPCInternal", rpcURL);
                }
            } else if (chain.RPCBackfill) {
                rpcURL = chain.RPCBackfill;
            }
            if (rpcURL) {
                var web3Api = new Web3(rpcURL)
                var bn = await web3Api.eth.getBlockNumber()
                console.log(`web3Api ${rpcURL} is ready currentBN=${bn}`)
                return web3Api
            }
        }
        return false
    }

    async getTestParseTraces(testGroup = 1) {
        let tests = await this.poolREADONLY.query(`select * from testParseTraces where testGroup = '${testGroup}' order by chainID`);
        return (tests);
    }
    countTopicLen(text_signature_full) {
        // The split method splits the string into an array of substrings around each instance of '*'
        // So the length of the array will be one more than the number of '*' characters in the string
        // We subtract 1 to get the count of '*' characters
        return text_signature_full.split('*').length;
    }
    async getContractABI() {
        let abis = {}
        return abis;
    }

    async setupAPI(chain, backfill = false) {
        this.chainID = chain.chainID;
        this.chainName = chain.chainName;
        if (backfill && chain.WSBackfill) {
            chain.WSEndpoint = chain.WSBackfill
            console.log("API using backfill endpoint", chain.WSEndpoint);
        }
        let isSubstrate = chain.chainID != chain.evmChainID
        if (isSubstrate) {
            //for substrate, initiat with polkadotjs
            if (!this.api) {
                this.api = await this.get_api(chain);
            }
        }
    }

    async get_chain_hostname_endpoint(chain) {
        let replica = this.replica;
        if (replica == 1 && (chain.WSEndpoint2 != null) && chain.WSEndpoint2.length > 0) {
            console.log("get_chain_hostname_endpoint - REPLICA 1", chain.WSEndpoint2);
            return (chain.WSEndpoint2)
        }
        if (replica == 2 && (chain.WSEndpoint3 != null) && chain.WSEndpoint3.length > 0) {
            return (chain.WSEndpoint3)
        }
        return (chain.WSEndpoint);
    }

    setReplica(r) {
        this.replica = parseInt(r, 10);
    }

    getExitOnDisconnect() {
        let exitOnDisconnect = this.exitOnDisconnect
        return exitOnDisconnect
    }

    setExitOnDisconnect(exitOnDisconnect) {
        this.exitOnDisconnect = exitOnDisconnect
        //console.log(`*** setting ExitOnDisconnect=${this.exitOnDisconnect}`)
    }

    getDisconnectedCnt() {
        let disconnectedCnt = this.disconnectedCnt
        return disconnectedCnt
    }

    getDisconnected() {
        let disconnected = this.isDisconneted
        return disconnected
    }

    getConnected() {
        let connected = this.isConneted
        return connected
    }

    setConnected() {
        //successful connection will overwrite its previous error state
        this.isConneted = true
        this.isDisconneted = false
        this.isErrored = false
        this.disconnectedCnt = 0
    }

    setDisconnected() {
        this.isConneted = false
        this.isDisconneted = true
        this.disconnectedCnt += 1
    }

    getErrored() {
        let errored = this.isErrored
        return errored
    }

    setErrored() {
        this.isConneted = false
        this.isErrored = true
        this.disconnectedCnt += 1
    }

    get_google_storage() {
        if (this.googleStorage) return this.googleStorage;
        this.googleStorage = new Storage({
            projectId: 'substrate-etl',
            keyFilename: this.BQ_SUBSTRATEETL_KEY
        })
        return this.googleStorage;
    }

    get_big_query() {
        if (this.bigQuery) return this.bigQuery;
        this.bigQuery = new BigQuery({
            projectId: 'substrate-etl',
            keyFilename: this.BQ_SUBSTRATEETL_KEY
        })
        return this.bigQuery;
    }

    async execute_bqLoad(cmd) {
        try {
            //console.log(cmd);
            let res = await exec(cmd);
            //console.log(res)
            return true
        } catch (err) {
            console.log(err);
            return false
        }
    }

    async execute_bqJob(sqlQuery, targetBQLocation = null) {
        // run bigquery job with suitable credentials
        const bigqueryClient = this.get_big_query();
        const options = {
            query: sqlQuery,
            location: (targetBQLocation) ? targetBQLocation : this.defaultBQLocation,
        };

        try {
            const response = await bigqueryClient.createQueryJob(options);
            const job = response[0];
            const [rows] = await job.getQueryResults();
            return rows;
        } catch (err) {
            console.log(err);
            throw new Error(`An error has occurred.`, sqlQuery);
        }
        return [];
    }

    async load_calls_events(datasetId = "substrate") {
        return;
        const bigquery = this.get_big_query()
        let sql = `select table_name, column_name, data_type, ordinal_position, is_nullable from substrate-etl.${datasetId}.INFORMATION_SCHEMA.COLUMNS where ( table_name like 'call_%' or table_name like 'evt_%' ) and column_name not in ("block_time", "relay_chain", "para_id", "extrinsic_id", "extrinsic_hash", "call_id", "signer_ss58", "signer_pub_key") limit 1000000`;
        let columns = await this.execute_bqJob(sql);
        this.bqTablesCallsEvents = {}
        for (const c of columns) {
            let sa = c.table_name.split("_");
            if (this.bqTablesCallsEvents[c.table_name] == undefined) {
                this.bqTablesCallsEvents[c.table_name] = {
                    columns: {},
                    description: null
                };
            }
            if (c.column_name == "chain_id") {} else {
                this.bqTablesCallsEvents[c.table_name].columns[c.column_name] = c;
            }
        }
    }

    async get_api(chain, useWSBackfill = false) {
        const chainID = chain.chainID;
        const {
            ApiPromise,
            WsProvider
        } = require("@polkadot/api");
        const {
            Metadata,
            TypeRegistry,
            StorageKey,
            decorateStorage
        } = require('@polkadot/types');
        let endpoint = await this.get_chain_hostname_endpoint(chain, useWSBackfill);
        this.APIWSEndpoint = endpoint;
        const provider = new WsProvider(endpoint);
        //let crawls2 = this
        provider.on('disconnected', () => {
            this.setDisconnected()
            let isDisconneted = this.getDisconnected()
            let exitOnDisconnect = this.getExitOnDisconnect()
            let disconnectedCnt = this.getDisconnectedCnt()
            console.log(`*CHAIN API DISCONNECTED [exitOnDisconnect=${exitOnDisconnect}]  [disconnected=${isDisconneted}]`, chain.chainID);
            if (exitOnDisconnect) process.exit(1);
            if (disconnectedCnt >= 10) {
                console.log(`*CHAIN API DISCONNECTED max fail reached!`, chain.chainID);
                return false
            }

        });
        provider.on('connected', () => {
            this.setConnected()
            let exitOnDisconnect = this.getExitOnDisconnect()
            console.log(`*CHAIN API connected [exitOnDisconnect=${exitOnDisconnect}]`, chain.chainID)
        });
        provider.on('error', (error) => {
            this.setErrored()
            let isErrored = this.getErrored()
            let exitOnDisconnect = this.getExitOnDisconnect()
            console.log(`CHAIN API error [exitOnDisconnect=${exitOnDisconnect}] [errored=${isErrored}]`, chain.chainID)
        });

        var api = false;
        // https://polkadot.js.org/docs/api/start/types.extend/
        // https://github.com/polkadot-js/apps/tree/master/packages/apps-config
        if (chainID == paraTool.chainIDSubsocial) {
            const typesDef = require("@subsocial/types");
            api = await ApiPromise.create({
                provider: provider,
                types: typesDef.typesBundle.spec.subsocial.types
            });
        } else if (chainID == paraTool.chainIDSora) {
            const typesDef = require("@sora-substrate/type-definitions");
            api = await ApiPromise.create({
                provider: provider,
                types: typesDef.types
            });
        } else if (chainID == paraTool.chainIDZeitgeist) {
            const typesDef = require("@zeitgeistpm/type-defs");
            api = await ApiPromise.create({
                provider: provider,
                types: typesDef.index.types,
                rpc: typesDef.index.rpc
            });
        } else if (chainID == paraTool.chainIDCrustShadow || chainID == 2008) {
            const typesDef = require("@crustio/type-definitions");
            console.log(typesDef.types);
            api = await ApiPromise.create({
                provider: provider,
                types: typesDef.types
                ///rpc: typesDef.typesBundleForPolkadot.spec.crust.rpc
            });
        } else if (chainID == paraTool.chainIDDarwiniaCrab) {
            const typesDef = require("@darwinia/types");
            api = await ApiPromise.create({
                provider: provider,
                types: typesDef
            });
        } else if (chainID == paraTool.chainIDKhala || chainID == paraTool.chainIDPhala) {
            const typesDef = require("@phala/typedefs");
            api = await ApiPromise.create({
                provider: provider,
                types: typesDef.typesChain.Khala
            });
        } else if (chainID == paraTool.chainIDLaminar) {
            const typesDef = require("@laminar/type-definitions");
            api = await ApiPromise.create({
                provider: provider,
                types: typesDef.index.types,
                rpc: typesDef.index.rpc
            });
        } else if (chainID == paraTool.chainIDPontem) {
            const typesDef = require("pontem-types-bundle");
            api = await ApiPromise.create({
                provider: provider,
                types: typesDef.pontemDefinitions.types,
                rpc: typesDef.pontemDefinitions.rpc
            });
        } else if (chainID == paraTool.chainIDUnique && false) {
            // https://github.com/UniqueNetwork/unique-types-js/tree/fe923e4112ec03f8c8c680cc043da69ef33efa27
            const typesDef = require("@unique-nft/unique-mainnet-types"); // problematic dependency
            api = await ApiPromise.create({
                provider: provider,
                types: typesDef
            });
        } else if (chainID == paraTool.chainIDKintsugi) {
            const typesDef = require("@interlay/interbtc-types");
            api = await ApiPromise.create({
                provider: provider,
                types: typesDef.default.types,
                rpc: typesDef.default.rpc
            });
            console.log(`You are connected to KINTSUGI chain ${chainID} endpoint=${endpoint} with types + rpc`);
        } else if (chainID == paraTool.chainIDKilt) {
            const typesDef = require("@kiltprotocol/type-definitions");
            api = await ApiPromise.create({
                provider: provider,
                //types: typesDef.typeBundleForPolkadot.types
            });
            console.log(`You are connected to KILT chain ${chainID} endpoint=${endpoint} with types but not rpc`);
        } else if (chainID == 3367) {
            const OverrideBundleDefinition = {
                "spec": {
                    "nexus": {
                        "hasher": keccakAsU8a
                    }
                }
            }
            api = await ApiPromise.create({
                provider,
                typesBundle: OverrideBundleDefinition,
            });
            console.log(`You are connected to HYPERBRIDGE chain ${chainID} endpoint=${endpoint} with types`);
        } else if ((chainID == paraTool.chainIDEncointer)) {
            const OverrideBundleDefinition = {
                "spec": {
                    "encointer-parachain": {
                        "types": [{
                                "minmax": [
                                    3,
                                    null
                                ],
                                "types": {
                                    "CommunityIdentifier": {
                                        "geohash": "GeoHash",
                                        "digest": "CidDigest"
                                    },
                                    "GeoHash": "[u8; 5]",
                                    "CidDigest": "[u8; 4]"
                                }
                            },
                            {
                                "minmax": [
                                    0,
                                    2
                                ],
                                "types": {
                                    "ShardIdentifier": "Hash",
                                    "GetterArgs": "(AccountId, CommunityIdentifier)",
                                    "Enclave": {
                                        "pubkey": "AccountId",
                                        "mrenclave": "Hash",
                                        "timestamp": "u64",
                                        "url": "Text"
                                    },
                                    "PublicGetter": {
                                        "_enum": {
                                            "total_issuance": "CommunityIdentifier",
                                            "participant_count": "CommunityIdentifier",
                                            "meetup_count": "CommunityIdentifier",
                                            "ceremony_reward": "CommunityIdentifier",
                                            "location_tolerance": "CommunityIdentifier",
                                            "time_tolerance": "CommunityIdentifier",
                                            "scheduler_state": "CommunityIdentifier"
                                        }
                                    },
                                    "TrustedGetter": {
                                        "_enum": {
                                            "balance": "(AccountId, CommunityIdentifier)",
                                            "participant_index": "(AccountId, CommunityIdentifier)",
                                            "meetup_index": "(AccountId, CommunityIdentifier)",
                                            "attestations": "(AccountId, CommunityIdentifier)",
                                            "meetup_registry": "(AccountId, CommunityIdentifier)"
                                        }
                                    },
                                    "TrustedGetterSigned": {
                                        "getter": "TrustedGetter",
                                        "signature": "Signature"
                                    },
                                    "Getter": {
                                        "_enum": {
                                            "public": "PublicGetter",
                                            "trusted": "TrustedGetterSigned"
                                        }
                                    },
                                    "ClientRequest": {
                                        "_enum": {
                                            "PubKeyWorker": null,
                                            "MuRaPortWorker": null,
                                            "StfState": "(Getter, ShardIdentifier)"
                                        }
                                    },
                                    "WorkerEncoded": "Vec<u8>",
                                    "Request": {
                                        "shard": "ShardIdentifier",
                                        "cyphertext": "WorkerEncoded"
                                    },
                                    "TrustedCallSigned": {
                                        "call": "TrustedCall",
                                        "nonce": "u32",
                                        "signature": "Signature"
                                    },
                                    "TrustedCall": {
                                        "_enum": {
                                            "balance_transfer": "BalanceTransferArgs",
                                            "ceremonies_register_participant": "RegisterParticipantArgs",
                                            "ceremonies_register_attestations": "RegisterAttestationsArgs",
                                            "ceremonies_grant_reputation": "GrantReputationArgs"
                                        }
                                    },
                                    "BalanceTransferArgs": "(AccountId, AccountId, CommunityIdentifier, BalanceType)",
                                    "RegisterParticipantArgs": "(AccountId, CommunityIdentifier, Option<ProofOfAttendance<MultiSignature, AccountId>>)",
                                    "RegisterAttestationsArgs": "(AccountId, Vec<Attestation<MultiSignature, AccountId, u64>>)",
                                    "GrantReputationArgs": "(AccountId, CommunityIdentifier, AccountId)",
                                    "BalanceType": "i128",
                                    "BalanceEntry": {
                                        "principal": "BalanceType",
                                        "lastUpdate": "BlockNumber"
                                    },
                                    "Demurrage": "BalanceType",
                                    "BusinessIdentifier": {
                                        "communityIdentifier": "CommunityIdentifier",
                                        "controller": "AccountId"
                                    },
                                    "OfferingIdentifier": "u32",
                                    "BusinessData": {
                                        "url": "PalletString",
                                        "last_oid": "u32"
                                    },
                                    "OfferingData": {
                                        "url": "PalletString"
                                    },
                                    "PalletString": "Text",
                                    "IpfsCid": "Text",
                                    "FixedI64F64": {
                                        "bits": "i128"
                                    },
                                    "CeremonyIndexType": "u32",
                                    "CeremonyPhaseType": {
                                        "_enum": [
                                            "Registering",
                                            "Assigning",
                                            "Attesting"
                                        ]
                                    },
                                    "ParticipantIndexType": "u64",
                                    "MeetupIndexType": "u64",
                                    "AttestationIndexType": "u64",
                                    "MeetupAssignment": "(MeetupIndexType, Option<Location>)",
                                    "MeetupTimeOffsetType": "i32",
                                    "Reputation": {
                                        "_enum": [
                                            "Unverified",
                                            "UnverifiedReputable",
                                            "VerifiedUnlinked",
                                            "VerifiedLinked"
                                        ]
                                    },
                                    "CommunityReputation": {
                                        "communityIdentifier": "CommunityIdentifier",
                                        "reputation": "Reputation"
                                    },
                                    "ClaimOfAttendance": {
                                        "claimantPublic": "AccountId",
                                        "ceremonyIndex": "CeremonyIndexType",
                                        "communityIdentifier": "CommunityIdentifier",
                                        "meetupIndex": "MeetupIndexType",
                                        "location": "Location",
                                        "timestamp": "Moment",
                                        "numberOfParticipantsConfirmed": "u32",
                                        "claimantSignature": "Option<MultiSignature>"
                                    },
                                    "ClaimOfAttendanceSigningPayload": {
                                        "claimantPublic": "AccountId",
                                        "ceremonyIndex": "CeremonyIndexType",
                                        "communityIdentifier": "CommunityIdentifier",
                                        "meetupIndex": "MeetupIndexType",
                                        "location": "Location",
                                        "timestamp": "Moment",
                                        "numberOfParticipantsConfirmed": "u32"
                                    },
                                    "AssignmentCount": {
                                        "bootstrappers": "ParticipantIndexType",
                                        "reputables": "ParticipantIndexType",
                                        "endorsees": "ParticipantIndexType",
                                        "newbies": "ParticipantIndexType"
                                    },
                                    "Assignment": {
                                        "bootstrappersReputables": "AssignmentParams",
                                        "endorsees": "AssignmentParams",
                                        "newbies": "AssignmentParams",
                                        "locations": "AssignmentParams"
                                    },
                                    "AssignmentParams": {
                                        "m": "u64",
                                        "s1": "u64",
                                        "s2": "u64"
                                    },
                                    "CommunityCeremonyStats": {
                                        "communityCeremony": "(CommunityIdentifier, CeremonyIndexType)",
                                        "assignment": "Assignment",
                                        "assignmentCount": "AssignmentCount",
                                        "meetupCount": "MeetupIndexType",
                                        "meetups": "Vec<Meetup>"
                                    },
                                    "Meetup": {
                                        "index": "MeetupIndexType",
                                        "location": "LocationRpc",
                                        "time": "Moment",
                                        "registrations": "Vec<(AccountId, ParticipantRegistration)>"
                                    },
                                    "ParticipantRegistration": {
                                        "index": "ParticipantIndexType",
                                        "registrationType": "RegistrationType"
                                    },
                                    "RegistrationType": {
                                        "_enum": [
                                            "Bootstrapper",
                                            "Reputable",
                                            "Endorsee",
                                            "Newbie"
                                        ]
                                    },
                                    "Attestation": {
                                        "claim": "ClaimOfAttendance",
                                        "signature": "MultiSignature",
                                        "public": "AccountId"
                                    },
                                    "ProofOfAttendance": {
                                        "proverPublic": "AccountId",
                                        "ceremonyIndex": "CeremonyIndexType",
                                        "communityIdentifier": "CommunityIdentifier",
                                        "attendeePublic": "AccountId",
                                        "attendeeSignature": "MultiSignature"
                                    },
                                    "CommunityIdentifier": {
                                        "geohash": "GeoHash",
                                        "digest": "CidDigest"
                                    },
                                    "GeoHash": "[u8; 5]",
                                    "CidDigest": "[u8; 4]",
                                    "CommunityCeremony": "(CommunityIdentifier,CeremonyIndexType)",
                                    "NominalIncomeType": "BalanceType",
                                    "DegreeRpc": "Text",
                                    "DegreeFixed": "i128",
                                    "Location": {
                                        "lat": "DegreeFixed",
                                        "lon": "DegreeFixed"
                                    },
                                    "LocationRpc": {
                                        "lat": "DegreeRpc",
                                        "lon": "DegreeRpc"
                                    },
                                    "CidName": {
                                        "cid": "CommunityIdentifier",
                                        "name": "Text"
                                    },
                                    "CommunityMetadataType": {
                                        "name": "Text",
                                        "symbol": "Text",
                                        "assets": "Text",
                                        "theme": "Option<Text>",
                                        "url": "Option<Text>"
                                    },
                                    "SystemNumber": "u32",
                                    "SchedulerState": "(CeremonyIndexType, CeremonyPhaseType, SystemNumber)"
                                }
                            }
                        ],
                        "signedExtensions": {
                            "ChargeAssetTxPayment": {
                                "extrinsic": {
                                    "tip": "Compact<Balance>",
                                    "assetId": "Option<CommunityIdentifier>"
                                },
                                "payload": {}
                            }
                        }
                    }
                }
            }
            api = await ApiPromise.create({
                provider,
                typesBundle: OverrideBundleDefinition,
            });
            console.log(`You are connected to ENCOINTER chain ${chainID} endpoint=${endpoint} with types but not rpc`);

        } else if ((chainID == paraTool.chainIDAstar || chainID == paraTool.chainIDShiden || chainID == paraTool.chainIDShibuya)) {
            // const options = require("@astar-network/astar-api");
            const typesBundle = {
                spec: {
                    shiden: {
                        types: [{
                            // on all versions
                            minmax: [0, undefined],
                            types: {
                                Keys: 'AccountId',
                                Address: 'MultiAddress',
                                LookupSource: 'MultiAddress',
                                AmountOf: 'Amount',
                                Amount: 'i128',
                                SmartContract: {
                                    _enum: {
                                        Evm: 'H160',
                                        Wasm: 'AccountId'
                                    }
                                },
                                EraStakingPoints: {
                                    total: 'Balance',
                                    stakers: 'BTreeMap<AccountId, Balance>',
                                    formerStakedEra: 'EraIndex',
                                    claimedRewards: 'Balance'
                                },
                                PalletDappsStakingEraStakingPoints: {
                                    total: 'Balance',
                                    stakers: 'BTreeMap<AccountId, Balance>',
                                    formerStakedEra: 'EraIndex',
                                    claimedRewards: 'Balance'
                                },
                                EraRewardAndStake: {
                                    rewards: 'Balance',
                                    staked: 'Balance'
                                },
                                PalletDappsStakingEraRewardAndStake: {
                                    rewards: 'Balance',
                                    staked: 'Balance'
                                },
                                EraIndex: 'u32'
                            }
                        }]
                    }
                }
            };
            api = await ApiPromise.create({
                provider,
                typesBundle
            });
            console.log(`You are connected to ASTAR/SHIDEN chain ${chainID} endpoint=${endpoint} with options`);
        } else if (chainID == paraTool.chainIDMoonbeam) {
            const typesBundlePre900 = require("moonbeam-types-bundle");
            api = await ApiPromise.create({
                provider: provider,
                typesBundle: typesBundlePre900.typesBundlePre900,
                rpc: typesBundlePre900.typesBundlePre900.spec.moonbeam.rpc
            });
            console.log(`You are connected to MOONBEAM chain ${chainID} endpoint=${endpoint} with types + rpc`);
        } else if (chainID == paraTool.chainIDMoonriver) {
            const typesBundlePre900 = require("moonbeam-types-bundle");
            api = await ApiPromise.create({
                provider: provider,
                typesBundle: typesBundlePre900.typesBundlePre900,
                rpc: typesBundlePre900.typesBundlePre900.spec.moonriver.rpc
            });
            console.log(`You are connected to MOONRIVER chain ${chainID} endpoint=${endpoint} with types + rpc`);
        } else if (chainID == paraTool.chainIDMoonbaseAlpha || chainID == paraTool.chainIDMoonbaseBeta) {
            const typesBundlePre900 = require("moonbeam-types-bundle");
            api = await ApiPromise.create({
                provider: provider,
                typesBundle: typesBundlePre900.typesBundlePre900,
                rpc: typesBundlePre900.typesBundlePre900.spec.moonbase.rpc
            });
            console.log(`You are connected to MoonBase chain ${chainID} endpoint=${endpoint} with types + rpc`);
        } else if (chainID == paraTool.chainIDBifrostKSM || chainID == paraTool.chainIDBifrostDOT) {
            //const typeDefs = require("@bifrost-finance/type-definitions");
            api = await ApiPromise.create({
                provider: provider
                //typesBundle: typeDefs.typesBundleForPolkadot,
                //rpc: typeDefs.typesBundleForPolkadot.spec.bifrost.rpc
            });
            console.log(`You are connected to BIFROST chain ${chainID} endpoint=${endpoint} with types + rpc`);
        } else if ((chainID == paraTool.chainIDParallel) || (chainID == paraTool.chainIDHeiko)) {
            const typeDefs = require("@parallel-finance/type-definitions");
            api = await ApiPromise.create({
                provider: provider,
                typesBundle: typeDefs.typesBundleForPolkadot,
                rpc: typeDefs.typesBundleForPolkadot.spec.parallel.rpc
            });
            console.log(`You are connected to PARALLEL chain ${chainID} endpoint=${endpoint} with types + rpc`);
        } else if ((chain.chainID == paraTool.chainIDAcala) || (chain.chainID == paraTool.chainIDKarura)) {
            //const typeDefs = require("@acala-network/type-definitions");
            api = await ApiPromise.create({
                provider: provider,
                //typesBundle: typeDefs.typesBundleForPolkadot,
                //rpc: typeDefs.typesBundleForPolkadot.spec.acala.rpc,
                //signedExtensions: typeDefs.signedExtensions
            });
            console.log(`You are connected to ACALA chain ${chainID} endpoint=${endpoint} with types + rpc + signedExt`);
        } else {
            api = await ApiPromise.create({
                provider: provider
            });
            console.log(`You are connected to chain ${chainID} endpoint=${endpoint}`);
        }

        api.on('disconnected', () => {
            this.setDisconnected()
            console.log('CHAIN API DISCONNECTED', chain.chainID);
            if (this.exitOnDisconnect) process.exit(1);
        });
        api.on('connected', () => {
            this.setConnected()
            console.log('CHAIN API connected', chain.chainID)

        });
        api.on('error', (error) => {
            this.setErrored()
            console.log('CHAIN API error', chain.chainID, error)
        });
        return api;
    }

    async insertBTRows(tbl, rows, tableName = "") {
        if (rows.length == 0) return (true);
        try {
            await tbl.insert(rows);
            return (true);
        } catch (err) {
            let succ = true;
            console.log(err);
            for (let a = 0; a < rows.length; a++) {
                try {
                    let r = rows[a];
                    if (r.key !== undefined && r.key) {
                        await tbl.insert([r]);
                    }
                } catch (err) {
                    let tries = 0;
                    while (tries < 10) {
                        try {
                            tries++;
                            await tbl.insert([rows[a]]);
                            await this.sleep(100);
                        } catch (err) {
                            //console.log(err);
                        }
                    }
                    if (tries >= 10) {
                        succ = false;
                    }
                }
            }
            return (succ);
        }
    }

    sortArrayByField(array, field, order = 'asc') {
        return array.sort((a, b) => {
            if (order === 'asc') {
                return a[field] - b[field];
            } else if (order === 'desc') {
                return b[field] - a[field];
            } else {
                throw new Error("Invalid sorting order. Use 'asc' or 'desc'.");
            }
        });
    }

    // [blocks, contracts, logs, token_transfers, traces, transactions]
    build_evm_block_from_row(row) {
        let rowData = row.data;
        let r = {
            prefix: false,
            chain_id: false,
            block: false,
            blockHash: false,
            blockNumber: false,
            blockTS: false,
            contracts: false,
            logs: false,
            token_transfers: false,
            traces: false,
            transactions: false,
        }
        let evmColF = Object.keys(rowData)
        //console.log(`evmColF`, evmColF)
        r.blockNumber = parseInt(row.id.substr(2), 16);
        r.prefix = row.id
        //console.log(`${row.id} rowData`, rowData)
        if (rowData["blocks"]) {
            let columnFamily = rowData["blocks"];
            let blkhashes = Object.keys(columnFamily)
            //console.log(`blkhashes`, blkhashes)
            //TODO: remove the incorret finalizedhash here
            if (blkhashes.length == 1) {
                r.blockHash = blkhashes[0];
            } else {
                //use the correct finalized hash by checking and see if we can find the proper blockrow
                console.log(`ERROR: multiple evm blkhashes found ${blkhashes} @ blockNumber:`, r.blockNumber, `cbt read chain prefix=${row.id}`)
                this.logger.error({
                    "op": "build_evm_block_from_row",
                    "err": `multiple evm blkhashes found ${blkhashes}`
                });
                return false
            }
            //console.log(`rowData["blocks"]`, rowData["blocks"])
            let cell = (rowData["blocks"][r.blockHash]) ? rowData["blocks"][r.blockHash][0] : false;
            if (cell) {
                let blk = JSON.parse(cell.value)
                r.block = blk;
                r.blockTS = blk.timestamp
                r.chain_id = blk.chain_id
            }
        }
        if (rowData["logs"]) {
            let cell = (r.blockHash && rowData["logs"][r.blockHash]) ? rowData["logs"][r.blockHash][0] : false;
            if (cell) {
                r.logs = JSON.parse(cell.value);
            }
        }
        if (rowData["traces"]) {
            let cell = (r.blockHash && rowData["traces"][r.blockHash]) ? rowData["traces"][r.blockHash][0] : false;
            if (cell) {
                r.traces = JSON.parse(cell.value);
            }
        }
        if (rowData["transactions"]) {
            let cell = (r.blockHash && rowData["transactions"][r.blockHash]) ? rowData["transactions"][r.blockHash][0] : false;
            if (cell) {
                r.transactions = JSON.parse(cell.value);
            }
        }
        if (rowData["token_transfers"]) {
            let cell = (r.blockHash && rowData["token_transfers"][r.blockHash]) ? rowData["token_transfers"][r.blockHash][0] : false;
            if (cell) {
                r.token_transfers = JSON.parse(cell.value);
            }
        }
        if (rowData["contracts"]) {
            let cell = (r.blockHash && rowData["contracts"][r.blockHash]) ? rowData["contracts"][r.blockHash][0] : false;
            if (cell) {
                r.contracts = JSON.parse(cell.value);
            }
        }
        // want RPC style of blockWithTransaction, ReceiptsWithLogs and trace
        let btBlkCols = ["timestamp", "number", "hash", "parent_hash", "nonce", "sha3_uncles", "logs_bloom", "transactions_root", "state_root", "receipts_root", "miner", "difficulty", "total_difficulty", "size", 'gas_limit', "gas_used"]
        let rpcBlkCols = ["timestamp", "number", "hash", "parentHash", "nonce", "sha3Uncles", "logsBloom", "transactionsRoot", "stateRoot", "receipts_root", "miner", "difficulty", "totalDifficulty", "size", "gas_limit", "gas_used"]
        let rpcBlk = {}
        // convert header
        for (let i = 0; i < btBlkCols.length; i++) {
            let btBlkCol = btBlkCols[i]
            let rpcBlkCol = rpcBlkCols[i]
            let btBlk = r.block
            rpcBlk[rpcBlkCol] = btBlk[btBlkCol]
        }

        let btTxCols = ["block_hash", "block_number", "from_address", "gas", "gas_price", "max_fee_per_gas", "max_priority_fee_per_gas", "hash", "input", "nonce", "to_address", "transaction_index", "value", "transaction_type", "chain_id"]
        let rpcTxCols = ["blockHash", "blockNumber", "from", "gas", "gasPrice", "maxFeePerGas", "maxPriorityFeePerGas", "hash", "input", "nonce", "to", "transactionIndex", "value", "type", "chainId"] //no accessList, v, r, s

        // include transaction
        let rpcTxns = []
        let rpcReceipts = [] //receipt is a combinations of txn result + logs.. need to extract from both obj

        let btReceiptCols = ["block_hash", "block_number", "receipt_contract_address", "receipt_cumulative_gas_used", "receipt_effective_gas_price", "from_address", "receipt_gas_used", "logs", "logsBloom", "receipt_status", "to_address", "hash", "transaction_index", "transaction_type"] //no bloom
        let rpcReceiptCols = ["blockHash", "blockNumber", "contractAddress", "cumulativeGasUsed", "effectiveGasPrice", "from", "gasUsed", "logs", "logsBloom", "status", "to", "transactionHash", "transactionIndex", "type"]

        let btLogCols = ["address", "topics", "data", "block_number", "transaction_hash", "transaction_index", "block_hash", "log_index", "removed"] //no removed
        let rpcLogCols = ["address", "topics", "data", "blockNumber", "transactionHash", "transactionIndex", "blockHash", "logIndex", "removed"]

        this.sortArrayByField(r.transactions, 'transaction_index', 'asc');
        this.sortArrayByField(r.logs, 'log_index', 'asc');

        let logMap = {} //hash -> []
        for (let i = 0; i < r.logs.length; i++) {
            let rpcLog = {}
            let btLog = r.logs[i]
            let transactionHash = btLog.transaction_hash
            if (logMap[transactionHash] == undefined) logMap[transactionHash] = []
            //console.log(`btLog`, btLog)
            // convert receipt header
            for (let i = 0; i < btLogCols.length; i++) {
                let btLogCol = btLogCols[i]
                let rpcLogCol = rpcLogCols[i]
                if (rpcLogCol == "removed") {
                    rpcLog["removed"] = false
                    //It is true when the log was removed due to a chain reorganization, and false if it's a valid log. since we don't have this. will use false for all
                } else {
                    rpcLog[rpcLogCol] = (btLog[btLogCol] != undefined) ? btLog[btLogCol] : null
                }
            }
            logMap[transactionHash].push(rpcLog)
        }
        //console.log(`logMap`, logMap)

        for (let i = 0; i < r.transactions.length; i++) {
            let btTxn = r.transactions[i]
            let transactionHash = btTxn.hash
            //console.log(`btTxn`, btTxn)
            let rpcTxn = {}
            let rpcReceipt = {}
            // convert transaction
            for (let i = 0; i < btTxCols.length; i++) {
                let btTxCol = btTxCols[i]
                let rpcTxCol = rpcTxCols[i]
                rpcTxn[rpcTxCol] = (btTxn[btTxCol] != undefined) ? btTxn[btTxCol] : null
            }
            //btTxn is missing accessList, r, s, v
            rpcTxns.push(rpcTxn)

            // convert receipt header
            for (let i = 0; i < btReceiptCols.length; i++) {
                let btReceiptCol = btReceiptCols[i]
                let rpcReceiptCol = rpcReceiptCols[i]
                if (rpcReceiptCol == "logsBloom") {
                    rpcReceipt["logsBloom"] = null
                } else if (rpcReceiptCol == "logs") {
                    if (logMap[transactionHash] == undefined) {
                        rpcReceipt["logs"] = [] // TODO build logs using logs
                    } else {
                        //console.log(`${transactionHash} logs`, logMap[transactionHash])
                        rpcReceipt["logs"] = logMap[transactionHash]
                    }
                } else {
                    rpcReceipt[rpcReceiptCol] = (btTxn[btReceiptCol] != undefined) ? btTxn[btReceiptCol] : null
                }
            }
            // rpcReceipts is missing logsbloom + removed
            rpcReceipts.push(rpcReceipt)
        }
        //will have to sort for messy ordering
        //rpcBlk.transactions = this.sortArrayByField(rpcTxns, 'transactionIndex', 'asc');
        rpcBlk.transactions = rpcTxns
        //console.log(`rpcBlk`, rpcBlk)
        //console.log(`rpcReceipts`, rpcReceipts)
        //TODO: traces...
        let f = {
            prefix: r.prefix,
            chain_id: r.chain_id,
            blockHash: r.blockHash,
            blockNumber: r.blockNumber,
            blockTS: paraTool.dechexToInt(r.blockTS),
            block: rpcBlk,
            transactions: rpcTxns,
            evmReceipts: rpcReceipts,
            traces: false
        }
        //process.exit(0)
        return f
    }

    validate_evm_row(row) {
        let rRow = this.build_evm_block_from_row(row)
        if (!rRow.block) {
            return [false, false]
        }
        let knownTxType = [0, 2]
        let rpcTxns = rRow.transactions
        for (const rpcTxn of rpcTxns) {
            if (!knownTxType.includes(rpcTxn["type"])) {
                console.log(`Missing txType`)
                return [false, false]
            }
        }
        if (Array.isArray(rpcTxns) && rpcTxns.length > 0) {
            if (!rRow.evmReceipts) {
                console.log(`Missing evmReceipts`)
                return [false, false]
            }
        }
        //TODO: check trace
        return [true, rRow]
    }

    build_block_from_row(row) {
        let rowData = row.data;
        let r = {
            block: false,
            blockHash: false,
            blockNumber: false,
            events: false,
            trace: false,
            autotrace: false,
            evmBlock: false,
            finalized: false,
            traceType: false,
            blockStats: false,
            feed: false
        }
        r.blockNumber = parseInt(row.id.substr(2), 16);
        // 0. get the finalized blockHash; however, any "raw" column is also finalized
        //console.log(`returned families`, Object.keys(rowData))
        if (rowData["finalized"]) {
            let columnFamily = rowData["finalized"];
            let blkhashes = Object.keys(columnFamily)

            //TODO: remove the incorret finalizedhash here
            if (blkhashes.length == 1) {
                r.blockHash = blkhashes[0];
                r.finalized = true;
            } else {
                r.fork = r.blockNumber;
                //use the correct finalized hash by checking and see if we can find the proper blockrow
                console.log(`ERROR: multiple finalized blkhashes found ${blkhashes} @ blockNumber:`, r.blockNumber, `cbt read chain prefix=${row.id}`)
                this.logger.error({
                    "op": "build_block_from_row",
                    "err": `multiple finalized blkhashes found ${blkhashes}`
                });
            }
        }

        // 1. store extrinsics of the block in the address in feed
        if (rowData["blockraw"]) {
            let cell = (r.blockHash && rowData["blockraw"][r.blockHash]) ? rowData["blockraw"][r.blockHash][0] : false;
            let cellEvents = (r.blockHash && rowData["events"] && rowData["events"][r.blockHash]) ? rowData["events"][r.blockHash][0] : false;
            if (cell) {
                r.block = JSON.parse(cell.value);
                if (cellEvents) r.events = JSON.parse(cellEvents.value);
                r.blockHash = r.block.hash;
            } else {
                console.log("no finalized block", r.blockNumber);
            }
        }

        // 2. process deduped traceBlock
        if (rowData["trace"]) {
            let cell = (rowData["trace"]["raw"]) ? rowData["trace"]["raw"][0] : (r.blockHash && rowData["trace"][r.blockHash]) ? rowData["trace"][r.blockHash][0] : false;
            if (cell) {
                r.trace = JSON.parse(cell.value);
                let cellTS = cell.timestamp / 1000000;
                if (rowData["n"] && rowData["n"]["traceType"]) {
                    let traceTypeCell = rowData["n"]["traceType"][0];
                    switch (traceTypeCell.value) {
                        case "subscribeStorage":
                        case "state_traceBlock":
                            r.traceType = traceTypeCell.value;
                    }
                }
            }
        }
        if (rowData["autotrace"]) {
            let cell = (r.blockHash && rowData["autotrace"][r.blockHash]) ? rowData["autotrace"][r.blockHash][0] : false;
            if (cell) {
                r.autotrace = JSON.parse(cell.value);
            }
        }

        // 3. return feed
        if (rowData["feed"]) {
            let cell = (r.blockHash && rowData["feed"][r.blockHash]) ? rowData["feed"][r.blockHash][0] : false;
            if (cell) {
                r.feed = JSON.parse(cell.value);
            }
        }

        // 4. return blockrawevm
        if (rowData["blockrawevm"]) {
            let cell = (r.blockHash && rowData["blockrawevm"][r.blockHash]) ? rowData["blockrawevm"][r.blockHash][0] : false;
            if (cell) {
                r.evmBlock = JSON.parse(cell.value);
            }
        }

        // 5. return receiptsevm
        if (rowData["receiptsevm"]) {
            let cell = (r.blockHash && rowData["receiptsevm"][r.blockHash]) ? rowData["receiptsevm"][r.blockHash][0] : false;
            if (cell) {
                r.evmReceipts = JSON.parse(cell.value);
            }
        }

        // 5b. return traceevm
        if (rowData["traceevm"]) {
            let cell = (r.blockHash && rowData["traceevm"][r.blockHash]) ? rowData["traceevm"][r.blockHash][0] : false;
            if (cell) {
                r.evmTrace = JSON.parse(cell.value);
            }
        }

        // 6. return feedevm (evmFullBlock)
        if (rowData["feedevm"]) {
            let cell = (r.blockHash && rowData["feedevm"][r.blockHash]) ? rowData["feedevm"][r.blockHash][0] : false;
            if (cell) {
                r.evmFullBlock = JSON.parse(cell.value);
            }
        }

        return r;
    }

    build_feed_from_row(row, requestedBlockHash = false) {
        let rowData = row.data;
        let r = {
            blockHash: false,
            blockNumber: false,
            evmFullBlock: false,
            finalized: false,
            feed: false
        }
        r.blockNumber = parseInt(row.id.substr(2), 16);
        // 0. get the finalized blockHash; however, any "raw" column is also finalized
        //console.log(`returned families`, Object.keys(rowData))
        if (rowData["finalized"]) {
            let columnFamily = rowData["finalized"];
            for (const h of Object.keys(columnFamily)) {
                r.blockHash = h;
                r.finalized = true;
                // TODO: check that its unique
            }
        } else {
            let blockHashes = Object.keys(rowData["feed"])
            //console.log(`${r.blockNumber} hashes`, blockHashes)
            if (requestedBlockHash && rowData["feed"][requestedBlockHash]) {
                r.blockHash = requestedBlockHash;
            } else if (blockHashes.length > 0) {
                r.blockHash = blockHashes[0];
            }
        }

        // 1. return feed
        if (rowData["feed"]) {
            let cell = (r.blockHash && rowData["feed"][r.blockHash]) ? rowData["feed"][r.blockHash][0] : false;
            if (cell) {
                r.feed = JSON.parse(cell.value);
            }
        }

        // 2. return feedevm (evmFullBlock)
        if (rowData["feedevm"]) {
            let cell = (r.blockHash && rowData["feedevm"][r.blockHash]) ? rowData["feedevm"][r.blockHash][0] : false;
            if (cell) {
                r.evmFullBlock = JSON.parse(cell.value);
            }
        }
        return r;
    }

    gs_evm_file_name(chainID, logDT, blockNumber) {
        return `${chainID}/${logDT.replaceAll("-","/")}/${blockNumber}.json.gz`
    }

    gs_substrate_file_name(relayChain, paraID, blockNumber) {
        let folder = Math.floor(blockNumber / 10000).toString().padStart(8, "0");
        return `${relayChain}/${paraID}/${folder}/${blockNumber}.json.gz`
    }

    async store_stateTraceBlock_gs(chainID, blockNumber, blockTrace) {
        //MK: enable storing!
        //return;
        const bucketName = 'crypto_substrate_traces';
        const storage = this.get_google_storage()
        const bucket = storage.bucket(bucketName);
        let relayChain = paraTool.getRelayChainByChainID(chainID)
        let paraID = paraTool.getParaIDfromChainID(chainID)
        let fileName = this.gs_substrate_file_name(relayChain, paraID, blockNumber)
        const file = bucket.file(fileName);
        const writeStream = file.createWriteStream({
            contentType: 'application/json',
            gzip: true
        });
        writeStream.write(JSON.stringify(blockTrace));
        writeStream.end();

        // Wait for the write stream to finish writing
        await new Promise((resolve, reject) => {
            writeStream.on('finish', resolve);
            writeStream.on('error', reject);
        });
        console.log(`gs://${bucketName}/${fileName}`);
    }

    async fetch_stateTraceBlock_gs(chainID, blockNumber) {
        const bucketName = 'crypto_substrate_traces';
        const storage = this.get_google_storage()
        const bucket = storage.bucket(bucketName);
        let relayChain = paraTool.getRelayChainByChainID(chainID)
        let paraID = paraTool.getParaIDfromChainID(chainID)
        let fileName = this.gs_substrate_file_name(relayChain, paraID, blockNumber)
        const file = bucket.file(fileName);
        const buffer = await file.download();
        const r = JSON.parse(buffer[0]);
        return r
    }

    async fetch_evm_block_gs(chainID, blockNumber) {
        // TODO: shift back to substrate model
        let sql = `select UNIX_TIMESTAMP(blockDT) blockTS from block${chainID} where blockNumber = '${blockNumber}' limit 1`
        let blocks = await this.poolREADONLY.query(sql);
        if (blocks.length == 1) {
            let b = blocks[0];
            let [logDT0, hr] = paraTool.ts_to_logDT_hr(b.blockTS);
            const storage = this.get_google_storage();
            const bucketName = 'crypto_evm';
            const bucket = storage.bucket(bucketName);
            const fileName = this.gs_evm_file_name(chainID, logDT0, blockNumber);
            const file = bucket.file(fileName);
            const buffer = await file.download();
            const r = JSON.parse(buffer[0]); // block, receipts, evm
            return r
        }
        return null;
    }



    async fetch_substrate_block_gs(chainID, blockNumber) {
        const storage = this.get_google_storage();
        const bucketName = 'crypto_substrate';
        const bucket = storage.bucket(bucketName);
        let relayChain = paraTool.getRelayChainByChainID(chainID)
        let paraID = paraTool.getParaIDfromChainID(chainID)
        const fileName = this.gs_substrate_file_name(relayChain, paraID, blockNumber);
        const file = bucket.file(fileName);
        const buffer = await file.download();
        const r = JSON.parse(buffer[0]);
        return r;
    }

    async fetch_block_gs(chain, blockNumber) {
        try {
            let chainID = chain.chainID;
            if (blockNumber < chain.blocksArchived) { // fetch { blockraw, events, feed } from GS storage
                return this.fetch_substrate_block_gs(chainID, blockNumber);
            }
        } catch (e) {
            console.log(e)
            return null;
        }
    }

    async getSnapshotBN(chainID, logDT, hrStart = 0, hrEnd = 23) {
        let indexTSPeriodStart = paraTool.logDT_hr_to_ts(logDT, hrStart);
        let indexTSPeriodEnd = paraTool.logDT_hr_to_ts(logDT, hrEnd);
        var sql = `
            SELECT
                DATE_FORMAT(FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(b0.blockDT)/3600)*3600), '%Y-%m-%d') AS snapshotDT,
                HOUR(b0.blockDT) AS hr,
                FLOOR(UNIX_TIMESTAMP(b0.blockDT)/3600)*3600 AS indexTS,
                MIN(b0.blockNumber) AS startBN,
                MAX(b0.blockNumber) AS endBN,
                MIN(UNIX_TIMESTAMP(b0.blockDT)) AS startTS,
                MAX(UNIX_TIMESTAMP(b0.blockDT)) AS endTS,
                (SELECT blockHash FROM block${chainID} WHERE blockNumber = MIN(b0.blockNumber)) AS start_blockhash,
                (SELECT blockHash FROM block${chainID} WHERE blockNumber = MAX(b0.blockNumber)) AS end_blockhash
            FROM
                block${chainID} b0
            WHERE
                b0.blockDT >= FROM_UNIXTIME(${indexTSPeriodStart})
                AND b0.blockDT < FROM_UNIXTIME(${indexTSPeriodEnd} + 3600)
                AND UNIX_TIMESTAMP() - (FLOOR(UNIX_TIMESTAMP(b0.blockDT)/3600)*3600) >= 3600
            GROUP BY
                indexTS, snapshotDT, hr
            ORDER BY
                indexTS;
        `;
        //sql = paraTool.formatSQL(sql)
        //console.log(`indexPeriod sql=`, sql);
        var periods = await this.poolREADONLY.query(sql);
        if (periods.length > 0) {
            return periods;
        }
        return false;
    }

    async fetch_block(chain, blockNumber, families = ["feed", "finalized"], feedOnly = false, blockHash = false) {
        let chainID = chain.chainID;
        if (blockNumber < chain.blocksArchived) {
            try {
                let r = await this.fetch_block_gs(chain, blockNumber);
                //console.log("fetch_block", r);
                return r;
            } catch (e) {
                console.log("ERR", e);
            }
        }

        const filter = {
            filter: [{
                family: families,
                cellLimit: 100
            }]
        };
        const tableChain = this.getTableChain(chainID);
        let row = null
        try {
            [row] = await tableChain.row(paraTool.blockNumberToHex(blockNumber)).get(filter);
            let x = this.build_feed_from_row(row, blockHash)
            return x;
        } catch (e) {

        }
        return null
    }

    async fetch_block_row(chain, blockNumber, families = ["blockraw", "trace", "events", "feed", "n", "finalized", "feed", "autotrace"], feedOnly = false, blockHash = false) {
        let chainID = chain.chainID;
        if (!feedOnly && chain.isEVM > 0) {
            // OPTIMIZATION: its wasteful to bring in all these columns if the user hasn't asked for them ... however finalized is generally required
            families.push("blockrawevm");
            families.push("receiptsevm");
            families.push("traceevm");
            families.push("feedevm");
            families.push("traceevm");
        }
        const filter = {
            filter: [{
                family: families,
                cellLimit: 100
            }]
        };


        const tableChain = this.getTableChain(chainID);
        const [row] = await tableChain.row(paraTool.blockNumberToHex(blockNumber)).get(filter);

        return this.build_block_from_row(row)
    }

    push_rows_related_keys(family, column, rows, key, c) {
        let ts = this.getCurrentTS();
        let colData = {}
        colData[`${column}`] = {
            value: JSON.stringify(c),
            timestamp: ts * 1000000
        }
        let data = {}
        data[`${family}`] = colData
        if (key) {
            let row = {
                key: key.toLowerCase(),
                data
            }
            //console.log("PUSH", row);
            rows.push(row);
        }
    }

    getCurrentTS() {
        return Math.round(new Date().getTime() / 1000);
    }

    getTraceParseTS(maxDaysAgo = 31) {
        let [logDT, _] = paraTool.ts_to_logDT_hr(this.getCurrentTS() - 86400 * maxDaysAgo);
        return (paraTool.logDT_hr_to_ts(logDT, 0));
    }

    add_index_metadata(c) {
        c.source = this.hostname;
        c.genTS = this.getCurrentTS();
        c.commit = this.indexerInfo;
    }

    capitalizeFirstLetter(string) {
        return string.charAt(0).toUpperCase() + string.slice(1);
    }

    sendExternalWSProvider(name, msg) {
        if (this.EXTERNAL_WS_PROVIDER_KEY && this.EXTERNAL_WS_PROVIDER_URL) {
            let names = ["xcminfo"];
            let extrinsicHash = "";
            let ofinalized = false;
            let dfinalized = false;
            if (msg.origination) {
                if (msg.origination.transactionHash) {
                    names.push(msg.origination.transactionHash);
                }
                if (msg.origination.extrinsicHash) {
                    names.push(msg.origination.extrinsicHash);
                    extrinsicHash = msg.origination.extrinsicHash;
                }
                if (msg.origination.id) {
                    names.push(msg.origination.id);
                }
                ofinalized = msg.origination.finalized;
            }
            if (msg.destination) {
                dfinalized = msg.destination.finalized;
                if (msg.destination.id && !names.includes(msg.destination.id)) {
                    names.push(msg.destination.id);
                }
            }
            for (const name of names) {
                let str = `${name}|${extrinsicHash}|${ofinalized}|${dfinalized}`;
                if (this.WSProviderQueue[str] == undefined) {
                    let xcminfoHash = paraTool.twox_128(str)
                    let x = {
                        "name": name,
                        "data": msg
                    }
                    let EXTERNAL_WS_PROVIDER_URL = this.EXTERNAL_WS_PROVIDER_URL.replace("xcminfo", name)
                    let cmd = `curl -X POST ${EXTERNAL_WS_PROVIDER_URL} -u "${this.EXTERNAL_WS_PROVIDER_KEY}" --max-time 5 -H "Content-Type: application/json" --data '${JSON.stringify(x)}'`
                    this.WSProviderQueue[str] = cmd; // TEMP: xcminfoHash
                }
            }
        } else {
            console.log(`${name} EXTERNAL_WS_PROVIDER_KEY/EXTERNAL_WS_PROVIDER_URL not set! EXTERNAL_WS_PROVIDER_KEY=${this.EXTERNAL_WS_PROVIDER_KEY}, EXTERNAL_WS_PROVIDER_URL=${this.EXTERNAL_WS_PROVIDER_URL}`)
        }
    }

    getWSProviderQueueLen() {
        return Object.keys(this.WSProviderQueue).length;
    }

    async flushWSProviderQueue(debug = false) {
        if (this.EXTERNAL_WS_PROVIDER_KEY && this.EXTERNAL_WS_PROVIDER_URL) {
            let completed = [];
            for (const [xcmInfoHash, cmd] of Object.entries(this.WSProviderQueue)) {
                // only send one topic, using sql table xcminfoqueue to ensure only one msg sent to EXTERNAL_WS_PROVIDER_URL; not perfect but good enough for now
                try {
                    if (cmd && typeof cmd == "string" && (cmd.includes("curl"))) {
                        completed.push(xcmInfoHash);
                        //console.log("*** flushWSProviderQueue", xcmInfoHash, cmd);
                        const {
                            stdout,
                            stderr
                        } = await exec(cmd, {
                            maxBuffer: 1024 * 64000
                        });
                        if (debug) {
                            this.logger.info({
                                "op": "flushWSProviderQueue",
                                cmd
                            })
                        }
                    } else {
                        let ts = parseInt(cmd, 10);
                        if (this.getCurrentTS() - ts > 120) {
                            // cleanup
                            delete this.WSProviderQueue[xcmInfoHash];
                        }
                    }
                } catch (err) {
                    console.log(err);
                    this.logger.error({
                        "op": "flushWSProviderQueue",
                        err
                    });
                }
            }

            // flush out old
            for (const xcmInfoHash of completed) {
                this.WSProviderQueue[xcmInfoHash] = this.getCurrentTS();
            }
        }
    }

    async loadEventBloomFilter() {
        let dir = `./schema/bloom/`
        let fn = path.join(dir, `event_topic.json`)
        var exported = JSON.parse(fs.readFileSync(fn));
        const importedFilter = BloomFilter.fromJSON(exported)
        console.log(`setup event_topic bloom?`, importedFilter.has('0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'))
        return importedFilter
    }
}