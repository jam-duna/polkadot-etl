const paraTool = require("../paraTool");
const ethTool = require("../ethTool");
const fs = require("fs");
const {
    decodeAddress,
} = require("@polkadot/keyring");
const {
    u8aToHex,
} = require("@polkadot/util");

const {
    ApiPromise,
    WsProvider
} = require("@polkadot/api");

const NL = "\r\n";

module.exports = class SnapShotter {
    debugLevel = paraTool.debugNoLog;
    chainName = "generic"
    chainDecimals = 10;
    source = "unknown";
    wsEndpoint = false
    parserTS = false;
    parserBlockNumber = false;
    parserBlockHash = false;
    parserWatermark = 0;
    relayParentStateRoot = false;
    author = false;
    paraStates = {}
    numParserErrors = 0;
    mpReceived = false;
    mpReceivedHashes = {};
    api = false;
    filePath = false;
    fn;
    snapshotInfo = {};
    currentEra = false;
    constructor() {}

    setSnapshotFilePath(fn) {
        this.filePath = fn
        console.log(`snotshot fn set:${fn}`)
    }

    getSnapshotFilePath() {
        return this.filePath
    }

    enable_snapshot_writing() {
        this.fn = fs.openSync(this.filePath, 'w', 0o666);
        console.log(`enable_snapshot_writing. fn=${this.filePath}`)
    }

    write_snapshot_rec(rec) {
        fs.writeSync(this.fn, JSON.stringify(rec) + NL);
    }

    close_snapshot_writing() {
        fs.closeSync(this.fn);
        console.log(`close_snapshot_writing. fn=${this.filePath}`)
    }

    // setting snapshot publisher enable us to aggrgate multiple sources into one and support different data types
    setSnapshotSource(publisher = "unknown") {
        this.source = publisher
    }

    setSnapshotInfo(block_hash, block_number, ts) {
        this.snapshotInfo = {
            block_hash: block_hash,
            block_number: block_number,
            ts: ts,
        }
    }

    getSnapshotInfo() {
        return this.snapshotInfo
    }

    setCurrentEra(era) {
        console.log(`setCurrentEra=${era}!`)
        this.currentEra = era
    }

    /*
    Generate a standardized rec that can be loaded into snapshots/traces tables
    */
    setRecSnapShotInfo(section_storage = "section.storage") {
        let pieces = section_storage.split('.')
        if (pieces.length != 2) {
            console.log(`Invalid section_storage=${section_storage}`)
            return false
        }
        let snapshotInfo = this.snapshotInfo
        let rec = {
            chain_name: this.chainName,
            block_hash: snapshotInfo.block_hash,
            block_number: snapshotInfo.block_number,
            ts: snapshotInfo.ts,
            section: pieces[0],
            storage: pieces[1],
            source: this.source
            //track: null,
            //track_val: null,
            //kv: null,
            //pv: null,
        }
        if (this.currentEra) {
            rec = this.setRecSnapShotEra(rec)
        }
        return rec
    }

    //Set track_val to contain era number
    setRecSnapShotEra(res) {
        if (this.currentEra) {
            res.track = `era`
            res.track_val = `${this.currentEra}`
        }
        return res
    }

    async getAPI() {
        return this.api
    }

    async setAPIAt(blockHash) {
        try {
            //let api = this.getAPI()
            let apiAt = await this.api.at(blockHash)
            return apiAt
        } catch (e) {
            console.log(`setAPIAt err`, e)
        }
    }

    async setAPIAtWithBN(blockNumber, blockTS) {
        try {
            let blockHash = await this.api.rpc.chain.getBlockHash(blockNumber);
            let apiAt = await this.api.at(blockHash)
            this.setSnapshotInfo(blockHash.toHex(), blockNumber, blockTS)
            return apiAt
        } catch (e) {
            console.log(`setAPIAt err`, e)
        }
    }

    async apiInit() {
        if (!this.wsEndpoint) {
            console.log(`wsEndpoint missing!`)
            return
        }
        let wsEndpoint = this.wsEndpoint
        console.log(`apiInit wsEndpoint=${wsEndpoint}`)
        var provider = new WsProvider(wsEndpoint);
        var api = await ApiPromise.create({
            provider
        });
        this.api = api
        return
    }

    // get the full state of section:storage where key is not iterable. (v) decoding responsibility is pushed to next stage
    async state_fetch_val(apiAt, section_storage = "convictionVoting.votingFor") {
        let pieces = section_storage.split('.')
        if (pieces.length != 2) {
            console.log(`Invalid section_storage=${section_storage}`)
            return false
        }
        let section = pieces[0]
        let storage = pieces[1]
        if (apiAt.query[section] != undefined && apiAt.query[section][storage] != undefined) {} else {
            console.log(`${section}:${storage} not found!`)
            return false
        }
        let results = await apiAt.query[section][storage]()
        return results
    }

    // get the full state of section:storage. (k,v) decoding responsibility is pushed to next stage
    async state_fetch(apiAt, section_storage = "convictionVoting.votingFor", args = []) {
        let pieces = section_storage.split('.')
        if (pieces.length != 2) {
            console.log(`Invalid section_storage=${section_storage}`)
            return false
        }
        let section = pieces[0]
        let storage = pieces[1]
        if (apiAt.query[section] != undefined && apiAt.query[section][storage] != undefined) {} else {
            console.log(`${section}:${storage} not found!`)
            return false
        }
        let results = await apiAt.query[section][storage].entries({
            args: args
        })
        return results
    }

    // get the full state of section:storage, thousand keys at a time. (k,v) decoding responsibility is pushed to next stage
    async paginated_fetch(apiAt, section_storage = "convictionVoting.votingFor", args = []) {
        let pieces = section_storage.split('.')
        if (pieces.length != 2) {
            console.log(`Invalid section_storage=${section_storage}`)
            return false
        }
        let section = pieces[0]
        let storage = pieces[1]
        if (apiAt.query[section] != undefined && apiAt.query[section][storage] != undefined) {} else {
            console.log(`${section}:${storage} not found!`)
            return false
        }
        let perPagelimit = 1000
        var section_storage_num_last_key = '';
        var section_storage_num_page = 0;
        var section_storage_done = false
        var section_storage_num = 0
        var results = []
        while (!section_storage_done) {
            let query = null
            console.log(`section_storage_num_page=${section_storage_num_page}. pageSize=${perPagelimit}, startKey=${section_storage_num_last_key}`)
            query = await apiAt.query[section][storage].entriesPaged({
                args: args,
                pageSize: perPagelimit,
                startKey: section_storage_num_last_key
            })
            if (query.length == 0) {
                console.log(`Query ${section}:${storage} Completed: Cnt=${section_storage_num}`)
                break
            } else {
                console.log(`${section}:${storage} page: `, section_storage_num_page++);
                section_storage_num_last_key = query[query.length - 1][0];
            }
            for (const res of query) {
                results.push(res)
                section_storage_num++
            }
            if (query.length > 0) {} else {
                section_storage_done = true;
            }
        }
        return results
    }

    validate_storage_state(apiAt, section_storage = "convictionVoting.votingFor") {
        let pieces = section_storage.split('.')
        if (pieces.length != 2) {
            console.log(`Invalid section_storage=${section_storage}`)
            return false
        }
        let section = pieces[0]
        let storage = pieces[1]
        if (apiAt.query[section] != undefined && apiAt.query[section][storage] != undefined) {} else {
            console.log(`${section}:${storage} not found!`)
            return false
        }
        return true
    }

    //every chain should implement and call the snapshot logic here
    async processSnapshot() {
        let isSuccessful = false
        return isSuccessful
    }
}