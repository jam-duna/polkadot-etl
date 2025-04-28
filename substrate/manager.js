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

const AssetManager = require("./assetManager");
const PolkaholicDB = require("./polkaholicDB");
const {
    ApiPromise,
    WsProvider
} = require("@polkadot/api");
const {
    encodeAddress
} = require("@polkadot/keyring");
const {
    u8aToHex
} = require("@polkadot/util");
const mysql = require("mysql2");
const fs = require("fs");
const axios = require("axios");
const paraTool = require("./paraTool");
const util = require('util');
const exec = util.promisify(require("child_process").exec);
const path = require('path');

const bqDir = "/disk1/"
module.exports = class Manager extends AssetManager {
    constructor() {
        super("manager")
    }

    chainMap = {}
    lastupdateTS = 0

    // xcmanalytics
    xcmAddress = null;
    parachainID = null;

    async mapChains(f) {
        let chains = await this.getChains();
        for (var i = 0; i < chains.length; i++) {
            let c = chains[i];
            f(c)
        }
    }

    async update_coingecko_list() {
        try {
            // {"id":"11653-nottingham","symbol":"realtoken-s-11653-nottingham-rd-detroit-mi","name":"RealT Token - 11653 Nottingham Rd, Detroit, MI 48224"}
            const resp = await axios.get(`https://api.coingecko.com/api/v3/coins/list`);
            var a = [];
            for (const t of resp.data) {
                console.log(t);
                a.push(`(` + mysql.escape(t.id) + `, ` + mysql.escape(t.symbol) + `, ` + mysql.escape(t.name) + `)`);
            }
            this.batchedSQL.push(`insert into coingecko (id, symbol, name) values ` + a.join(",") + ` on duplicate key update symbol = values(symbol), name = values(name)`);
            await this.update_batchedSQL();
        } catch (err) {
            this.logger.error({
                op: "update_coingecko_list",
                err
            });
        }
        return false;
    }

    canonicalize_string(inp) {
        return inp.toLowerCase().replaceAll("_", "").trim()
    }

    async deleteBlocks(chainID) {
        let chain = await this.getChain(chainID);
        let start = 1;
        let end = chain.blocksArchived;
        let bnStart = start; //Math.floor((start+65536)/65536)*65536;
        let bnEnd = Math.floor((end - 65536) / 65536) * 65536;
        if (bnEnd < bnStart) bnEnd = bnStart;
        try {
            const tableChain = this.getTableChain(chainID);
            console.log("deleteBlocks ---", bnStart, bnEnd);
            /*
	    for (let bn =start; bn < bnStart; bn++) {
		let id = paraTool.blockNumberToHex(bn);
		await tableChain.row(id).delete();
		console.log("deleteBlocks start", bn, id);
	    }
*/
            for (let bn = bnStart; bn < bnEnd; bn += 65536) {
                let id = paraTool.blockNumberToHex(bn);
                let prefix = id.substring(0, 6); // 0x001c fde0
                await tableChain.deleteRows(prefix);
                console.log("deleteBlocks prefix", chainID, bn, prefix);
            }
            /*
	    for (let bn = bnEnd; bn <= end; bn++) {
		let id = paraTool.blockNumberToHex(bn);
		await tableChain.row(id).delete();
		if ( bn % 100 == 0 ) console.log("deleteBlocks end", bn, " target", end, id, chainID);
	    }
*/
        } catch (err) {
            console.log(err);
        }
        console.log("DONE");
        process.exit(0);
    }

    lookup_specversion_type(lookup, id) {
        try {
            for (let i = 0; i < lookup.length; i++) {
                if (lookup[i].id == id) {
                    return (lookup[i].type.def.variant.variants);
                }
            }
        } catch (err) {

        }
        return (false);
    }

    async updateDocs() {
        let sql = `select chainID, specVersion, metadata from specVersions order by chainID, specVersion desc`
        var specVersions = await this.poolREADONLY.query(sql)
        let extrinsicdocs = {};
        let eventdocs = {};

        for (let s = 0; s < specVersions.length; s++) {
            let chainID = specVersions[s].chainID;
            let runtime = JSON.parse(specVersions[s].metadata);
            if (runtime && (runtime.lookup !== undefined) && runtime.lookup && (runtime.lookup.types !== undefined)) {
                var lookup = runtime.lookup.types;
                var pallets = runtime.pallets;
                for (let i = 0; i < pallets.length; i++) {
                    let p = pallets[i];
                    let section = p.name;
                    if (p.calls && (p.calls.type != undefined)) {
                        let t = this.lookup_specversion_type(lookup, p.calls.type);
                        if (t) {
                            for (let k = 0; k < t.length; k++) {
                                let name = t[k].name;
                                let docs = t[k].docs.join(" ")
                                let key = `${chainID}:${section}:${name}`
                                if (extrinsicdocs[key] == undefined) {
                                    extrinsicdocs[key] = docs;
                                    console.log(key, docs);
                                }
                            }
                        }
                    }
                    if (p.events) {
                        let t = this.lookup_specversion_type(lookup, p.events.type);
                        if (t) {
                            for (let k = 0; k < t.length; k++) {
                                let docs = t[k].docs.join(" ")
                                let name = t[k].name;
                                let key = `${chainID}:${section}:${name}`
                                if (eventdocs[key] == undefined) {
                                    eventdocs[key] = docs;
                                }
                            }
                        }
                    }
                }
            }
        }
        for (const k of Object.keys(extrinsicdocs)) {
            let [chainID, section, method] = k.split(":");
            let docs = extrinsicdocs[k];
            let p = this.canonicalize_string(section);
            let m = this.canonicalize_string(method);
            let sql = `insert into extrinsicdocs (chainID, section, method, docs) values ('${chainID}', '${p}', '${m}', ${mysql.escape(docs)}) on duplicate key update docs = values(docs)`;
            this.batchedSQL.push(sql);
        }
        await this.update_batchedSQL();
    }


    async write_btRealtime_rows(rows, min, ctx = "") {
        if (rows.length > min) {
            let [tblName, tblRealtime] = this.get_btTableRealtime()
            try {
                await tblRealtime.insert(rows);
                console.log(ctx, "rows=", rows.length);
                return [];
            } catch (err) {
                console.log(err);
            }
        }
        return rows;
    }

    async indexBlocks(chainIDs, tSQL = null) {
        var Crawler = require("./crawler");
        const ethTool = require("./ethTool");
        const paraTool = require("./paraTool");
        let crawler = new Crawler();
        crawler.setDebugLevel(paraTool.debugTracing)

        let chainID = 2000;
        let chain = await crawler.getChain(chainID);
        await crawler.setupAPI(chain);
        await crawler.assetManagerInit();
        await crawler.setupChainAndAPI(chainID);
        let w = chainIDs ? ` and chainID in (${chainIDs})` : "";

        let targetSQL = `select blockNumber, xcmIndex, extrinsicHash, chainID, chainIDDest, amountSentUSD, amountReceived, amountReceivedUSD, symbol, from_unixtime(sourceTS), destStatus from xcmtransfer where symbol is null and chainID in ( select chainID from chain where crawling = 1 )  limit 5000`;
        if (tSQL != undefined) {
            targetSQL = tSQL
        }
        console.log(`targetSQL`, targetSQL)
        let recs = await crawler.poolREADONLY.query(targetSQL);
        let targetMap = {}
        for (let i = 0; i < recs.length; i++) {
            let m = recs[i]
            let chainID = m.chainID
            let extrinsicID = m.extrinsicID
            let extrinsicHash = m.extrinsicHash
            let blockNumber = m.blockNumber
            let blockHash = await crawler.getBlockHashFinalized(chainID, blockNumber)
            let r = {
                blockNumber: blockNumber,
                blockHash: blockHash,
                extrinsicHash: extrinsicHash,
                extrinsicID: extrinsicID,
            }
            if (targetMap[chainID] == undefined) targetMap[chainID] = []
            targetMap[chainID].push(r)
            //console.log(`[${i+1}/${recs.length}] indexBlocks [${extrinsicID}] [${extrinsicHash}] blkHash=${blockHash}`)
            //await crawler.index_block(chain, blockNumber, blockHash);
        }
        for (const chainID of Object.keys(targetMap)) {
            let blocks = targetMap[chainID]
            console.log(`[chainID:${chainID}] len=${blocks.length}`)
            let ccrawler = new Crawler();
            ccrawler.setDebugLevel(paraTool.debugTracing)
            let chain = await crawler.getChain(chainID);
            await ccrawler.setupAPI(chain);
            await ccrawler.assetManagerInit();
            await ccrawler.setupChainAndAPI(chainID);
            for (let i = 0; i < blocks.length; i++) {
                let b = blocks[i]
                console.log(`[chainID:${chainID}] [${i+1}/${blocks.length}] indexBlocks [${b.extrinsicID}] [${b.extrinsicHash}] blkHash=${b.blockHash}`)
                await ccrawler.index_block(chain, b.blockNumber, b.blockHash);
                let sql = `update xcmtransfer set xcmInfoAudited = -2 where extrinsicHash = '${b.extrinsicHash}' and blockNumber = '${b.blockNumber}'`
                ccrawler.batchedSQL.push(sql);
                await ccrawler.update_batchedSQL();
            }
        }
    }

    async write_btHashes_rows(rows, min, ctx = "") {
        if (rows.length > min) {
            try {
                await this.btHashes.insert(rows);
                console.log(ctx, "rows=", rows.length);
                return [];
            } catch (err) {
                console.log(err);
            }
        }
        return rows;
    }

    // write wasmCode.codeHash to btHashes wasmcode:${chainID}
    async write_btHashes_wasmcode(lookbackDays = 1) {
        let sql = `select codeHash, chainID, storer, codeStoredTS from wasmCode where codeStoredTS > UNIX_TIMESTAMP(DATE_SUB(Now(), interval ${lookbackDays} DAY)) order by codeStoredTS desc`
        let recs = await this.poolREADONLY.query(sql);
        let rows = [];
        for (let i = 0; i < recs.length; i++) {
            let c = recs[i];
            this.add_index_metadata(c);
            this.push_rows_related_keys("wasmcode", c.chainID.toString(), rows, c.codeHash, c)
            rows = await this.write_btHashes_rows(rows, 500, "write_hashes_wasmcode");
        }
        rows = await this.write_btHashes_rows(rows, 0, "write_hashes_wasmcode");
    }

    // write xcmmessages.msgHash to hashes xcmmessage:${sentAt}
    async write_btHashes_xcmmessage(lookbackDays = 1) {
        let ctx = "write_btHashes_xcmmessage";
        let sql = `select msgHash, sentAt, chainID, chainIDDest, msgType, blockTS, blockNumber, relayChain from xcmmessages where incoming = 1 and matched = 1 and blockTS > UNIX_TIMESTAMP(DATE_SUB(Now(), interval ${lookbackDays} DAY)) order by blockTS desc`
        let recs = await this.poolREADONLY.query(sql);
        let rows = [];
        for (let i = 0; i < recs.length; i++) {
            let c = recs[i];
            this.add_index_metadata(c);
            this.push_rows_related_keys("xcmmessage", c.sentAt.toString(), rows, c.msgHash, c)
            rows = await this.write_btHashes_rows(rows, 500, ctx);
        }
        await this.write_btHashes_rows(rows, 0, ctx);
    }

    // write xcmasset.symbol to hashes symbol:${relayChain}
    async write_btHashes_symbol(limit = 1) {
        let ctx = "write_btHashes_symbol";
        let sql = `select xcmasset.symbol, xcmasset.relayChain, xcmasset.nativeAssetChain, sum(numHolders) as numHolders from xcmasset join asset on xcmasset.xcmInteriorKey = asset.xcmInteriorKey group by symbol, relayChain, nativeAssetChain order by numHolders desc limit ${limit}`
        let recs = await this.poolREADONLY.query(sql);
        let rows = [];
        for (let i = 0; i < recs.length; i++) {
            let c = recs[i];
            this.add_index_metadata(c);
            this.push_rows_related_keys("symbol", c.relayChain, rows, c.symbol, c)
            rows = await this.write_btHashes_rows(rows, 500, ctx);
        }
        rows = await this.write_btHashes_rows(rows, 0, ctx);
    }

    // write asset.currencyID to hashes symbol:{chainID}
    async write_btHashes_currencyID(limit = 1) {
        let ctx = "write_btHashes_currencyID"
        let sql = `select asset.currencyID, asset.chainID, xcmasset.symbol, xcmasset.relayChain, asset.numHolders from asset join xcmasset on asset.xcmInteriorKey = xcmasset.xcmInteriorKey and asset.currencyID != xcmasset.symbol order by numHolders desc limit ${limit}`
        let recs = await this.poolREADONLY.query(sql);
        let rows = [];
        for (let i = 0; i < recs.length; i++) {
            let c = recs[i];
            this.add_index_metadata(c);
            this.push_rows_related_keys("symbol", c.relayChain, rows, c.currencyID, c)
            rows = await this.write_btHashes_rows(rows, 500, ctx);
        }
        rows = await this.write_btHashes_rows(rows, 0, ctx);

        let sql2 = `select asset.currencyID, asset.chainID, xcmasset.symbol, asset.symbol as localSymbol, xcmasset.relayChain, asset.numHolders from xcmasset, asset where xcmasset.xcmInteriorKey = asset.xcmInteriorKey and asset.symbol != xcmasset.symbol and assetType = 'Token' and asset.symbol like 'xc%' order by numHolders desc;`
        recs = await this.poolREADONLY.query(sql2);
        for (let i = 0; i < recs.length; i++) {
            let c = recs[i];
            this.add_index_metadata(c);
            this.push_rows_related_keys("symbol", c.relayChain, rows, c.localSymbol, c)
            rows = await this.write_btHashes_rows(rows, 500, ctx);
        }
        rows = await this.write_btHashes_rows(rows, 0, ctx);
    }

    // write chain.{chainID, paraID, id} to hashes chain:${relayChain}
    async write_btHashes_chain(limit = 1000) {
        let ctx = "write_btHashes_chain";
        let sql = `select chainID, id, chainName, paraID, relayChain, numHolders from chain where crawling = 1 order by numHolders desc limit ${limit}`
        let recs = await this.poolREADONLY.query(sql);
        let rows = [];
        for (let i = 0; i < recs.length; i++) {
            let c = recs[i];
            this.add_index_metadata(c);
            this.push_rows_related_keys("chain", c.relayChain, rows, c.chainID.toString(), c)
            if (c.paraID != c.chainID) {
                this.push_rows_related_keys("chain", c.relayChain, rows, c.paraID.toString(), c)
            }
            this.push_rows_related_keys("chain", c.relayChain, rows, c.id, c)
            rows = await this.write_btHashes_rows(rows, 500, ctx);
        }
        rows = await this.write_btHashes_rows(rows, 0, ctx);
    }

    // write contract.address to btRealtime wasmcontract:${chainID}    TODO: contractType (PSP22, PSP37, ...)
    async write_btRealtime_wasmcontract(lookbackDays = 1) {
        let ctx = "write_btRealtime_wasmcontract";
        let sql = `select address, chainID, codeHash, blockTS, deployer from contract where blockTS > UNIX_TIMESTAMP(date_sub(Now(), interval ${lookbackDays} DAY)) order by blockTS desc`
        let recs = await this.poolREADONLY.query(sql);
        let rows = [];
        for (let i = 0; i < recs.length; i++) {
            let c = recs[i];
            this.push_rows_related_keys("wasmcontract", c.chainID.toString(), rows, c.address, c)
            rows = await this.write_btRealtime_rows(rows, 500, ctx);
        }
        await this.write_btRealtime_rows(rows, 0, ctx);
    }

    // write asset.asset to accountrealtime evmcontract:{chainID} for assetType = 'ERC20', 'ERC20LP' (TODO: 'ERC721', 'ERC1155')
    async write_btRealtime_evmcontract(lookbackDays = 1) {
        let ctx = "write_btRealtime_evmcontract";
        let sql = `select asset, assetType, chainID, token0, token0Symbol, token1, token1Symbol, symbol, creator, createdAtTx, token0Decimals, token1Decimals from asset where assetType in ('Contract', 'ERC20', 'ERC20LP') and lastUpdateDT > date_sub(Now(), interval ${lookbackDays} DAY) order by lastUpdateDT desc`
        let recs = await this.poolREADONLY.query(sql);
        let rows = [];
        for (let i = 0; i < recs.length; i++) {
            let c = recs[i];
            this.push_rows_related_keys("evmcontract", c.chainID.toString(), rows, c.asset, c)
            rows = await this.write_btRealtime_rows(rows, 500, ctx);
        }
        await this.write_btRealtime_rows(rows, 0, ctx);
    }

    // writeBTHashesRealtime: writes all hashes/strings from { asset, xcmAsset, contract, chain } (other than extrinsicHashes, blockHashes)
    // to the { btHashes, btRealtime } BigTables
    async writeBTHashesRealtime(lookbackDays = 30, limit = 100) {
        /*        await this.write_btHashes_xcmmessage(lookbackDays);
                await this.write_btHashes_symbol(limit);
                await this.write_btHashes_chain(limit);
                await this.write_btHashes_currencyID(limit); */
        await this.write_btHashes_wasmcode(lookbackDays);
        await this.write_btRealtime_wasmcontract(lookbackDays);
        await this.write_btRealtime_evmcontract(lookbackDays);
    }

    async updateEVMPrecompiles(network) {
        let network_precompiles = {
            // https://docs.moonbeam.network/builders/pallets-precompiles/precompiles/
            moonbeam: {
                chainIDs: {
                    2004: '{"Token":"GLMR"}',
                    22023: '{"Token":"MOVR"}',
                    61000: '{"Token":"AlphaDev"}',
                    60888: '{"Token":"BetaDev"}'
                },
                precompiles: {
                    "0x0000000000000000000000000000000000000809": "Randomness",
                    "0x0000000000000000000000000000000000000800": "StakingInterface",
                    "0x000000000000000000000000000000000000080d": "XCMTransactorV2",
                    "0x0000000000000000000000000000000000000804": "XTokens",
                    "0x0000000000000000000000000000000000000808": "Batch",
                    "0x000000000000000000000000000000000000080a": "CallPermit",
                    "0x000000000000000000000000000000000000080e": ["Collective", "Council"],
                    "0x000000000000000000000000000000000000080f": ["Collective", "Technical commitee"],
                    "0x000000000000000000000000000000000000080f": ["Collective", "Treasury council"],
                    "0x0000000000000000000000000000000000000803": "Democracy",
                    "0x0000000000000000000000000000000000000802": "ERC20",
                    "0x000000000000000000000000000000000000080b": "Proxy"
                },

            },
            // https://docs.astar.network/docs/EVM/precompiles/
            astar: {
                chainIDs: {
                    2006: '{"Token":"ASTR"}',
                    22007: '{"Token":"SDN"}'
                },
                precompiles: {
                    "0x0000000000000000000000000000000000005001": "DappsStaking",
                    "0x0000000000000000000000000000000000005002": "SR25519",
                    //"" => "ERC20",  // https://github.com/AstarNetwork/astar-frame/blob/polkadot-v0.9.29/precompiles/assets-erc20/ERC20.sol
                    //"" => "SubstrateECDSA", // https://github.com/AstarNetwork/astar-frame/blob/polkadot-v0.9.29/precompiles/substrate-ecdsa/SubstrateEcdsa.sol
                    "0x0000000000000000000000000000000000005004": "XCM", // assets_withdraw https://github.com/AstarNetwork/astar-frame/blob/polkadot-v0.9.29/precompiles/xcm/XCM.sol

                }
            },
            // common to above networks, probably all
            generic: {
                networks: ["moonbeam", "astar"],
                precompiles: {
                    "0x0000000000000000000000000000000000000001": "ECRecover",
                    "0x0000000000000000000000000000000000000002": "Sha256",
                    "0x0000000000000000000000000000000000000003": "Ripemd160",
                    "0x0000000000000000000000000000000000000004": "Identity",
                    "0x0000000000000000000000000000000000000005": "Modexp",
                    "0x0000000000000000000000000000000000000006": "Bn128Add",
                    "0x0000000000000000000000000000000000000007": "Bn128Mul",
                    "0x0000000000000000000000000000000000000008": "Bn128Pairing"
                }
            }
        }

        let chainIDs = network_precompiles[network].chainIDs;
        let precompiles = network_precompiles[network].precompiles;
        // TODO: add generic precompiles
        let out = [];
        for (const [chainID, nativeAsset] of Object.entries(chainIDs)) {
            for (const [asset, name] of Object.entries(precompiles)) {
                let fn = null;
                let assetName = null;
                if (typeof name == "string") {
                    assetName = `${name} System Contract`;
                    fn = name;
                } else if (Array.isArray(name)) {
                    fn = name[0];
                    assetName = `${name[1]} System Contract`;
                }
                if (fn && assetName) {
                    let fullfn = path.join("precompiles", network, `${fn}.json`)
                    if (fs.existsSync(fullfn)) {
                        let abi = await fs.readFileSync(fullfn, "utf8");
                        if (name == "ERC20") {
                            let nsql = `update asset set abiRaw = ${mysql.escape(abi)} where asset = '${nativeAsset}' and chainID = '${chainID}'`
                            this.batchedSQL.push(nsql);
                        }
                        out.push(`('${asset}', '${chainID}', 'Contract', ${mysql.escape(assetName)}, ${mysql.escape(abi)})`)
                    } else {
                        console.log("not found", fullfn)
                    }
                }
            }
        }
        await this.update_batchedSQL();
        let vals = ["assetType", "assetName", "abiRaw"];
        await this.upsertSQL({
            "table": `asset`,
            "keys": ["asset", "chainID"],
            "vals": vals,
            "data": out,
            "replace": vals,
        });
    }

}