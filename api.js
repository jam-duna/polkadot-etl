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

const dotenv = require('dotenv').config();
const express = require('express')
const app = express()
const paraTool = require('./substrate/paraTool');
const uiTool = require('./substrate/uiTool');
const port = 3001
const Query = require("./substrate/query");
const cookieParser = require("cookie-parser");
const multer = require('multer');

var debugLevel = paraTool.debugTracing
var query = new Query(debugLevel);

app.locals.paraTool = paraTool;
app.locals.uiTool = uiTool;
app.use(express.static('public'))
app.use(cookieParser());
app.use(express.json());

app.set('view engine', 'ejs');
app.use(express.urlencoded({
    extended: true
}))

let isDevelopment = (process.env.NODE_ENV == "development") ? true : false

const disableAuthorizationCheck = false;

function setCrossOrigin(res) {
    res.set({
        'Content-Type': 'application/json',
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS,POST,PUT",
        'Access-Control-Allow-Origin': '*',
        "Access-Control-Allow-Headers": "Access-Control-Allow-Headers, Origin,Accept, X-Requested-With, Content-Type, Access-Control-Request-Method, Access-Control-Request-Headers"
    })
}

function getapikey(req) {
    let apikey = req.header('Authorization')
    if (!apikey) {
        let ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        try {
            ip = ip.substring(7)
            let ipPrefix = ip.split('.').slice(0, -1).join('.')
            //::ffff:103.163.220.17 -> use sha1(103.163.220) = c88cbdf6f85088bb9df9529d7823c5a3c736bfc5 as key
            apikey = paraTool.sha1(ipPrefix)
            if (apikey.length > 32) {
                apikey = apikey.substring(0, 32);
            }
        } catch (err) {
            query.logger.error({
                "op": "getapikey",
                err,
                ip
            });

        }
    }
    return (apikey);
}

function chainFilterOpt(req) {
    // default: return all chains
    let chainList = []
    try {
        if (req.query.chainfilters != undefined) {
            let chainIdentifierList = []
            let chainIdentifiers = req.query.chainfilters
            if (!Array.isArray(chainIdentifiers)) {
                chainIdentifiers = chainIdentifiers.split(',')
            }
            for (const chainIdentifier of chainIdentifiers) {
                if (chainIdentifier == 'all') return []
                //handle both chainID, id
                let [chainID, _] = query.convertChainID(chainIdentifier.toLowerCase())
                if (chainID !== false) {
                    chainIdentifierList.push(chainID)
                }
            }
            chainList = paraTool.unique(chainIdentifierList)
        } else {
            chainList = []
        }
    } catch (e) {
        console.log(`chainFilterOpt`, e.toString())
    }
    //console.log(`chainFilterOpt chainList=${chainList}`)
    return chainList
}

function decorateOpt(req, section = null) {
    // default decorate is true
    let decorate = (req.query.decorate != undefined) ? paraTool.parseBool(req.query.decorate) : true
    let decorateExtra = []
    if (!decorate) {
        return [decorate, decorateExtra]
    }

    /*
      data: show docs/decodedData/dataType in event
      usd: xxxUSD/priceUSD/priceUSDCurrent/ decoration
      address: identity decoration
      related: proxy/related decoration
    */
    let predefinedExtra = ["data", "usd", "address", "related", "events"]

    try {
        if (req.query.extra != undefined) {
            let extraList = []
            let extra = req.query.extra
            if (!Array.isArray(extra)) {
                extra = extra.split(',')
            }
            for (const ex of extra) {
                let extFld = ex.toLowerCase()
                if (predefinedExtra.includes(extFld)) extraList.push(extFld)
            }
            decorateExtra = extraList
        } else {
            if (section == "account") {
                decorateExtra = ["data", "usd", "address"]
            } else {
                //default option: [true] usd, addr [false] related
                decorateExtra = ["data", "usd", "address", "events"]
            }
        }
    } catch (e) {
        console.log(`decorateOpt`, e.toString())
    }
    return [decorate, decorateExtra]
}

const downtime = false;
app.use(async (req, res, next) => {
    setCrossOrigin(res)
    let apikey = getapikey(req);
    let result = await query.checkAPIKey(apikey);
    if (downtime) {
        var err = new Error("API is down for maintainance");
        err.http_code = 503;
        next(err);
        return;
    } else if (result.success) {
        next();
        return;
    } else if (result.error) {
        var err = new Error(result.error);
        err.http_code = result.code;
        next(err);
        return;
    } else {
        next(Error("Unknown Error"));
        return;
    }
})

app.get('/', async (req, res) => {
    try {
        let chains = await query.get_chains_external();
        if (chains) {
            res.write(JSON.stringify(chains));
            await query.tallyAPIKey(getapikey(req));
            return res.end();
        } else {
            return res.sendStatus(404);
        }
    } catch (err) {
        return res.status(400).json({
            error: err.toString()
        });
    }
})

app.get('/chains', async (req, res) => {
    try {
        let chains = await query.get_chains_external();
        if (chains) {
            res.write(JSON.stringify(chains));
            await query.tallyAPIKey(getapikey(req));
            return res.end();
        } else {
            return res.sendStatus(404);
        }
    } catch (err) {
        return res.status(400).json({
            error: err.toString()
        });
    }
})

app.get('/snapshot/:chainID?', async (req, res) => {
    try {
        let chainID = req.params["chainID"]
        if (chainID == undefined) {
            return res.status(400).json({
                error: `chainID not set`
            });
        }
        let [_currDT, currHR] = paraTool.ts_to_logDT_hr(paraTool.getCurrentDayTS() - 3600)
        let [logTS, logYYYYMMDD, currDT, prevDT] = paraTool.getTimeFormat(_currDT)
        let opt = {
            chainID: chainID,
            logDT: currDT,
            startHR: 0,
            finalHR: 23,
        };
        if (req.query.logDT != undefined) {
            opt.logDT = req.query.logDT;
        }
        if (req.query.startHR != undefined) {
            opt.startHR = req.query.startHR;
        }
        if (req.query.finalHR != undefined) {
            opt.finalHR = req.query.finalHR;
        }
        let periods = await query.getSnapshotBlocks(chainID, opt);
        if (periods) {
            res.write(JSON.stringify(periods));
            res.end();
        } else {
            return res.status(400).json({
                error: `Snapshot blocks not ready for ${chainID}`
            });
        }
    } catch (err) {
        return res.status(400).json({
            error: err.toString()
        });
    }
})

app.get('/assethubpools', async (req, res) => {
    try {
        let assets = [];
        let pools = await query.getAssethubPools(assets);
        if (pools) {
            res.write(JSON.stringify(pools));
            res.end();
        } else {
            res.sendStatus(404);
        }
    } catch (err) {
        return res.status(400).json({
            error: err.toString()
        });
    }
})

app.get('/assethublog/:asset/:against?/:timeframe?', async (req, res) => {
    try {
        let asset = (req.params.asset != undefined) ? req.params.asset : "DOT"; // DED, PINK, USDC, USDT
        let against = (req.params.against != undefined) ? req.params.against : "USD"; // DOT, USD
        let timeframe = (req.params.timeframe != undefined) ? req.params.timeframe : "week"; // month, all
        if (!["day", "week", "month"].includes(timeframe)) {
            res.sendStatus(400, "Invalid timeframe");
        } else if (!["USD", "DOT"].includes(against)) {
            res.sendStatus(400, "Invalid tokenB");
        } else if (!["DED", "PINK", "DOT", "WETH.e", "MYTH"].includes(asset)) {
            res.sendStatus(400, "Invalid tokenA");
        } else {
            let assethublog = await query.getAssethubLog(asset, against, timeframe);
            if (assethublog) {
                res.write(JSON.stringify(assethublog));
                res.end();
            } else {
                res.sendStatus(404);
            }
        }
    } catch (err) {
        return res.status(400).json({
            error: err.toString()
        });
    }
})

app.get('/contract/:asset/:chainID_or_chainName?', async (req, res) => {
    try {
        let asset = req.params["asset"]
        let chainID_or_chainName = req.params["chainID_or_chainName"] ? req.params["chainID_or_chainName"] : null;
        let contract = await query.getEVMContract(asset, chainID_or_chainName);
        if (contract) {
            res.write(JSON.stringify(contract));
            await query.tallyAPIKey(getapikey(req));
            res.end();
        } else {
            res.sendStatus(404);
        }
    } catch (err) {
        return res.status(400).json({
            error: err.toString()
        });
    }
})

app.get('/wasmcode/:chainID_or_chainName', async (req, res) => {
    try {
        let chainID_or_chainName = req.params["chainID_or_chainName"]
        let code = await query.getChainWASMCode(chainID_or_chainName);
        if (code) {
            res.write(JSON.stringify(code));
            await query.tallyAPIKey(getapikey(req));
            res.end();
        } else {
            res.sendStatus(404);
        }
    } catch (err) {
        return res.status(400).json({
            error: err.toString()
        });
    }
})

app.get('/wasmcontracts/:chainID_or_chainName', async (req, res) => {
    try {
        let chainID_or_chainName = req.params["chainID_or_chainName"]
        let contracts = await query.getChainWASMContracts(chainID_or_chainName);
        if (contracts) {
            res.write(JSON.stringify(contracts));
            await query.tallyAPIKey(getapikey(req));
            res.end();
        } else {
            res.sendStatus(404);
        }
    } catch (err) {
        return res.status(400).json({
            error: err.toString()
        });
    }
})

app.get('/wasmcontract/:chainID_or_chainName/:contractAddress', async (req, res) => {
    try {
        let contractAddress = req.params["contractAddress"] ? req.params["contractAddress"] : null;
        let chainID_or_chainName = req.params["chainID_or_chainName"] ? req.params["chainID_or_chainName"] : null;
        console.log("contractAddress", contractAddress, "chainID", chainID_or_chainName);
        let contract = await query.getWASMContract(contractAddress, chainID_or_chainName);
        if (contract) {
            res.write(JSON.stringify(contract));
            await query.tallyAPIKey(getapikey(req));
            res.end();
        } else {
            res.sendStatus(404);
        }
    } catch (err) {
        return res.status(400).json({
            error: err.toString()
        });
    }
})

// Get information on verification status of any codeHash, whether uploaded or not
app.get('/info/:network/:codeHash?', async (req, res) => {
    try {
        let network = req.params["network"]
        let codeHash = req.params["codeHash"] ? req.params["codeHash"] : null;
        let info = await query.getChainWASMCodeInfo(network, codeHash);
        if (info) {
            res.write(JSON.stringify(info));
            await query.tallyAPIKey(getapikey(req));
            res.end();
        } else {
            res.sendStatus(404);
        }
    } catch (err) {
        return res.status(400).json({
            error: err.toString()
        });
    }
})

app.get('/amlcheck/:address/:appkey?', async (req, res) => {
    try {
        let address = req.params["address"]
        let appkey = req.params["appkey"] ? req.params["appkey"] : ""
        let ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        console.log(ip, "headers", req.headers, "remoteAddress", req.connection.remoteAddress);
        let result = await query.storeAMLCheck(address, appkey, ip)
        if (result.ok) {
            res.write(JSON.stringify({
                ok: true
            }));
            await query.tallyAPIKey(getapikey(req));
            res.end();
        } else {
            return res.status(400).json({
                ok: false
            });
        }
    } catch (err) {
        return res.status(400).json({
            error: err.toString()
        });
    }
})


const upload = multer({
    dest: '/tmp/'
});

// Receives VERIFIED source code package with authentication mechanism from IDE -- see WASM-verifier.md
app.post('/verify/:network/:codeHash', upload.single('package'), async (req, res) => {
    try {
        let packageFile = req.file; // File object
        let signature = req.body.signature; // Signature value
        let network = req.params["network"]
        let codeHash = req.params["codeHash"];
        let publishSource = req.query.publishSource ? parseInt(req.query.publishSource, 10) : 1;

        let result = await query.postChainWASMContractVerification(network, codeHash, packageFile, signature, publishSource);
        if (result) {
            res.write(JSON.stringify(result));
            await query.tallyAPIKey(getapikey(req));
            res.end();
        } else {
            res.sendStatus(400);
        }

    } catch (err) {
        return res.status(400).json({
            error: err.toString()
        });
    }
})

app.get('/specversions/:chainID_or_chainName', async (req, res) => {
    return (false);
    try {

        let chainID_or_chainName = req.params["chainID_or_chainName"]
        let specVersions = await query.getSpecVersions(chainID_or_chainName);
        if (specVersions) {
            res.write(JSON.stringify(specVersions));
            await query.tallyAPIKey(getapikey(req));
            res.end();
        } else {
            res.sendStatus(404);
        }
    } catch (err) {
        return res.status(400).json({
            error: err.toString()
        });
    }
})

app.get('/chainlog/:chainID_or_chainName', async (req, res) => {
    return (false);
    try {
        let hardLimit = 1000;
        let queryLimit = (req.query.limit != undefined) ? parseInt(req.query.limit, 10) : 100;
        if (queryLimit > hardLimit) {
            return res.status(400).json({
                error: `Search: 'limit' parameter must be less or equal to than ${hardLimit}`
            });
        }
        let chainID_or_chainName = req.params["chainID_or_chainName"]
        let chainlog = await query.getChainLog(chainID_or_chainName, queryLimit);
        if (chainlog) {
            res.write(JSON.stringify(chainlog));
            await query.tallyAPIKey(getapikey(req));
            res.end();
        } else {
            res.sendStatus(404);
        }
    } catch (err) {
        return res.status(400).json({
            error: err.toString()
        });
    }
})

app.get('/specversion/:chainID_or_chainName/:specVersion', async (req, res) => {
    return (false);
    try {
        let chainID_or_chainName = req.params["chainID_or_chainName"]
        let specVersion = req.params["specVersion"]
        let specVersionMetadata = await query.getSpecVersionMetadata(chainID_or_chainName, specVersion);
        if (specVersionMetadata) {
            res.write(JSON.stringify(specVersionMetadata));
            await query.tallyAPIKey(getapikey(req));
            res.end();
        } else {
            res.sendStatus(404);
        }
    } catch (err) {
        return res.status(400).json({
            error: err.toString()
        });
    }
})

app.get('/chain/:chainID_or_chainName', async (req, res) => {
    return (false);
    try {
        //let chainID = parseInt(req.params["chainID"], 10);
        let chainID_or_chainName = req.params["chainID_or_chainName"]
        //let [chainID, id] = query.convertChainID(chainID_or_chainName)
        let isExternal = true
        let chain = await query.getChain(chainID_or_chainName, isExternal);
        if (chain) {
            let blocks = await query.getChainRecentBlocks(chainID_or_chainName);
            let r = {
                chain: chain,
                blocks: blocks
            };
            res.write(JSON.stringify(r));
            await query.tallyAPIKey(getapikey(req));
            return res.end();
        } else {
            return res.sendStatus(404);
        }
    } catch (err) {
        return res.status(400).json({
            error: err.toString()
        });
    }
})

app.get('/chain/:assetType/:chainID_or_chainName?', async (req, res) => {
    return (false);
    try {
        let chainID_or_chainName = req.params["chainID_or_chainName"] ? req.params["chainID_or_chainName"] : null
        let assetType = req.params["assetType"];
        let assets = null;
        if (assetType == "pools") {
            assets = await query.getPools({
                chainfilters: [chainID_or_chainName]
            });
        } else if (assetType == "routers") {
            assets = await query.getRouters({
                chainfilters: [chainID_or_chainName]
            });
        } else if (assetType == "channels") {
            assets = await query.getChainChannels(chainID_or_chainName);
        } else if (assetType == "System" || assetType == "ERC20" || assetType == "ERC721" || assetType == "ERC1155" || assetType == "PSP22" || assetType == "PSP34") {
            assets = await query.getChainAssets(chainID_or_chainName, assetType);
        } else {
            assets = await query.getChainAssets(chainID_or_chainName, "Token");
        }

        if (assets) {
            res.write(JSON.stringify(assets));
            await query.tallyAPIKey(getapikey(req));
            res.end();
        } else {
            res.sendStatus(404);
        }
    } catch (err) {
        return res.status(400).json({
            error: err.toString()
        });
    }
})

app.get('/q/:q', async (req, res) => {
    return (false);
    try {
        let search = req.params["q"].trim();
        let results = await query.getSearchResults(search);
        res.write(JSON.stringify(results));
        res.end();
    } catch (err) {
        return res.status(400).json({
            error: err.toString()
        });
    }
})

app.get('/block/:chainID_or_chainName/:blockNumber', async (req, res) => {
    return (false);
    try {
        //let chain = await query.getChain(chainID);
        let chainID_or_chainName = req.params["chainID_or_chainName"]
        let blockNumber = parseInt(req.params["blockNumber"], 10);
        let blockHash = (req.query.blockhash != undefined) ? req.query.blockhash : false
        let [decorate, decorateExtra] = decorateOpt(req)
        console.log(`getBlock (${chainID_or_chainName}, ${blockNumber}, ${blockHash}, decorate=${decorate}, decorateExtra=${decorateExtra})`)
        var blk = await query.getBlock(chainID_or_chainName, blockNumber, blockHash, decorate, decorateExtra);
        if (blk) {
            res.write(JSON.stringify(blk));
            await query.tallyAPIKey(getapikey(req));
            return res.end();
        } else {
            return res.sendStatus(404).json();
        }
    } catch (err) {
        console.log(`error:`, err.toString())
        return res.status(400).json({
            error: err.toString()
        });
    }
})

app.get('/hash/blockhash/:blockHash', async (req, res) => {
    return false;
    try {
        let blockHash = req.params["blockHash"];
        let [decorate, decorateExtra] = decorateOpt(req)
        var blk = await query.getBlockByHash(blockHash, decorate, decorateExtra);
        if (blk) {
            res.write(JSON.stringify(blk));
            await query.tallyAPIKey(getapikey(req));
            return res.end();
        } else {
            return res.sendStatus(404).json();
        }
    } catch (err) {
        console.log(`error:`, err.toString())
        return res.status(400).json({
            error: err.toString()
        });
    }
})

app.get('/account/:address', async (req, res) => {
    return false;
    try {
        let address = paraTool.getPubKey(req.params["address"]);
        let targetGroup = (req.query["group"] != undefined) ? req.query["group"].toLowerCase() : "realtime"
        let lookback = (req.query["lookback"] != undefined) ? req.query["lookback"] : 180
        let predefinedGroups = ["extrinsics", "transfers", "crowdloans", "rewards", "realtime", "history", "related", "xcmtransfers", "nfts", "balances", "feed", "unfinalized", "offers", "ss58h160", "evmtxs"]
        if (!predefinedGroups.includes(targetGroup)) {
            return res.status(400).json({
                error: `group=${req.query["group"]} is not supprted`
            });
        }
        let ts = (req.query["ts"] != undefined) ? req.query["ts"] : null;
        let pageIndex = (req.query["p"] != undefined) ? req.query["p"] : 0;
        //console.log(`${targetGroup} requested`)
        let [decorate, decorateExtra] = decorateOpt(req, "account")
        let chainList = chainFilterOpt(req)
        let maxLimit = 1000;
        let hardLimit = 10000;
        let maxRows = (req.query.limit != undefined) ? req.query.limit : maxLimit;
        if (maxRows > hardLimit) {
            return res.status(400).json({
                error: `Search: 'limit' parameter must be less or equal to than ${hardLimit}`
            });
        }

        //console.log(`/account/ chainList`, chainList)
        let account = await query.getAccount(address, targetGroup, chainList, maxRows, ts, lookback, decorate, decorateExtra, pageIndex);
        if (account) {
            res.write(JSON.stringify(account));
            await query.tallyAPIKey(getapikey(req));
            return res.end();
        } else {
            return res.sendStatus(404);
        }
    } catch (err) {
        return res.status(400).json({
            error: err.toString()
        });
    }
})

app.get('/account/:accountGroup/:address', async (req, res) => {
    return false;
    try {
        let address = req.params["address"];
        let accountGroup = req.params["accountGroup"];
        let lookback = (req.query["lookback"] != undefined) ? req.query["lookback"] : 180
        let [decorate, decorateExtra] = decorateOpt(req)
        let chainList = chainFilterOpt(req)
        //console.log(`/account/ chainList`, chainList)

        let maxLimit = 1000;
        let hardLimit = 10000;
        let maxRows = (req.query.limit != undefined) ? req.query.limit : maxLimit;
        if (maxRows > hardLimit) {
            return res.status(400).json({
                error: `Search: 'limit' parameter must be less or equal to than ${hardLimit}`
            });
        }

        let ts = (req.query["ts"] != undefined) ? req.query["ts"] : null;
        let pageIndex = (req.query["p"] != undefined) ? req.query["p"] : 0;
        if (accountGroup == "feed") {
            account = await query.getAccountFeed(address, chainList, maxRows, decorate, decorateExtra, pageIndex);
        } else {
            account = await query.getAccount(address, accountGroup, chainList, maxRows, ts, lookback, decorate, decorateExtra, pageIndex);
        }
        if (account) {
            res.write(JSON.stringify(account));
            await query.tallyAPIKey(getapikey(req));
            return res.end();
        } else {
            return res.sendStatus(404);
        }
    } catch (err) {
        return res.status(400).json({
            error: err.toString()
        });
    }
})

async function txAPIRedirect(req, res) {
    return false;
    try {
        let txHash = req.params['txhash'];
        let [decorate, decorateExtra] = decorateOpt(req)
        console.log(`api query.getTransaction (${txHash}, decorate=${decorate}, extra=${decorateExtra}`)
        let tx = await query.getTransaction(txHash, decorate, decorateExtra);
        if (tx) {
            res.write(JSON.stringify(tx));
            await query.tallyAPIKey(getapikey(req));
            res.end();
        } else {
            res.sendStatus(404);
        }
    } catch (err) {
        return res.status(400).json({
            error: err.toString()
        });
    }
}

app.get('/extrinsic/:txhash', async (req, res) => txAPIRedirect(req, res))
app.get('/tx/:txhash', async (req, res) => txAPIRedirect(req, res))

app.get('/event/:eventID', async (req, res) => {
    return (false);
    try {
        let eventID = req.params['eventID'];
        let ev = await query.getEvent(eventID);
        if (ev) {
            res.write(JSON.stringify(ev));
            await query.tallyAPIKey(getapikey(req));
            res.end();
        } else {
            res.sendStatus(404);
        }
    } catch (err) {
        return res.status(400).json({
            error: err.toString()
        });
    }
})

app.get('/gar/:chainID_or_chainName', async (req, res) => {
    try {
        let chainID_or_chainName = req.params["chainID_or_chainName"]
        let version = req.query['v'] ? req.query['v'] : 'v2';
        let mRes = await query.getMultilocation(chainID_or_chainName, version);
        if (mRes) {
            res.write(JSON.stringify(mRes));
            await query.tallyAPIKey(getapikey(req));
            res.end();
        } else {
            res.sendStatus(404);
        }
    } catch (err) {
        return res.status(400).json({
            error: err.toString()
        });
    }
})

app.get('/garendpoints/', async (req, res) => {
    try {
        let ev = await query.getGARSupportedList();
        if (ev) {
            res.write(JSON.stringify(ev));
            await query.tallyAPIKey(getapikey(req));
            res.end();
        } else {
            res.sendStatus(404);
        }
    } catch (err) {
        return res.status(400).json({
            error: err.toString()
        });
    }
})

app.use(function(err, req, res, next) {
    var http_code = err.http_code ? err.http_code : 500;
    var errString = err.toString();
    if (!errString) errString = "Bad Request";
    var e = {
        code: http_code
    };
    if (isDevelopment) {
        e.error = errString
    }
    res.status(http_code);
    query.logger.error({
        "op": "API",
        err,
        url: req.originalUrl
    });
    res.send(JSON.stringify(e));
});


const hostname = "::";
if (isDevelopment) {
    app.listen(port, hostname, () => {
        console.log(`Listening on port ${hostname}:${port} preemptively`)
    })
}
let x = query.init();
console.log(`[${new Date().toLocaleString()}] Initiating query`)
Promise.all([x]).then(() => {
    // delayed listening of your app
    console.log(`[${new Date().toLocaleString()}] query ready`)
    if (!isDevelopment) {
        app.listen(port, hostname, () => {
            console.log(`Listening on port ${hostname}:${port}`)
        })
    }
    // reload chains/assets/specVersions regularly
    query.autoUpdate()
}).catch(err => {
    // handle error here
});
