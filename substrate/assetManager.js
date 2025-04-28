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

const PolkaholicDB = require("./polkaholicDB");
const paraTool = require("./paraTool");
const uiTool = require("./uiTool");
const mysql = require("mysql2");
const ParallelParser = require("./chains/parallel");
const AcalaParser = require("./chains/acala");
const BifrostParser = require("./chains/bifrost");
const AstarParser = require("./chains/astar");
const MoonbeamParser = require("./chains/moonbeam");
const InterlayParser = require("./chains/interlay");
const ChainParser = require("./chains/chainparser");
const {
    ApiPromise
} = require('@polkadot/api');
const MAX_PRICEUSD = 100000.00;
const EvmManager = require("./evmManager");

module.exports = class AssetManager extends EvmManager {
    assetInfo = {};
    alternativeAssetInfo = {};
    xcmAssetInfo = {}; // xcmInteriorKey   ->
    xcmSymbolInfo = {}; // symbolRelayChain ->
    symbolRelayChainAsset = {}; // symbolRelayChain -> { ${chainID}: assetInfo }
    xcmTeleportFees = {}; // chainIDDest-symbol
    xcContractAddress = {};
    assetlog = {};
    ratelog = {};
    routers = {};
    assetlogTTL = 0;
    ercTokenList = {};
    currencyIDInfo = {};
    storageKeys = {};
    metadata = {};

    skipStorageKeys = {};
    skipPalletStorageKeys = {};
    accounts = {};
    chainParser = null; // initiated by setup_chainParser (=> chainParserInit)
    chainParserChainID = null;
    apiParser = null;


    lastEventReceivedTS = 0;
    constructor(debugLevel = false) {
        super()
    }

    getChainPrefix(chainID) {
        if (this.chainInfos[chainID] != undefined) {
            let ss58Format = this.chainInfos[chainID].ss58Format;
            return ss58Format
        }
        return 42 //default substrate
    }

    CDPStringUnify(assetString) {
        let s = assetString.replace('CDP_Borrow', 'CDP');
        return s.replace('CDP_Supply', 'CDP');
    }

    convertChainID(chainID_or_chainName) {
        let chainID = false
        let id = false
        let evm_chainID = {
            1: "ethereum",
            1284: "moonbeam",
            1285: "moonriver",
            592: "astar"
        };
        try {
            chainID = parseInt(chainID_or_chainName, 10);
            if (isNaN(chainID)) {
                [chainID, id] = this.getChainIDByName(chainID_or_chainName)
            } else if (evm_chainID[chainID] !== undefined) {
                return [chainID, evm_chainID[chainID]]
            } else {
                [chainID, id] = this.getNameByChainID(chainID_or_chainName)
            }
        } catch (e) {
            [chainID, id] = this.getChainIDByName(chainID_or_chainName)
        }
        //console.log(`chainID=${chainID}, id=${id}, chainID_or_chainName=${chainID_or_chainName}`)
        return [chainID, id]
    }

    async getBlockHashFinalized(chainID, blockNumber) {
        let sql = `select blockHash, if(blockDT is Null, 0, 1) as finalized from block${chainID} where blockNumber = '${blockNumber}' and blockDT is not Null`
        let blocks = await this.poolREADONLY.query(sql);
        if (blocks.length == 1) {
            return blocks[0].blockHash;
        }
    }

    async autoRefreshAssetManager(crawler) {
        await crawler.assetManagerInit();
        if (crawler.web3Api) {
            console.log("autoRefresh contractABI...")
            crawler.contractABIs = await crawler.getContractABI();
        }
    }

    async selfTerminate(crawler) {
        if (crawler.getCurrentTS() - crawler.lastEventReceivedTS > 300) {
            console.log("No event received in 5mins, terminating")
            process.exit(1);
        }
    }

    async chainParserInit(chainID, debugLevel = 0) {

        if (this.chainParser && (this.chainParserChainID == chainID)) {
            return;
        }
        if ([paraTool.chainIDKarura, paraTool.chainIDAcala].includes(chainID)) {
            this.chainParser = new AcalaParser();
        } else if ([paraTool.chainIDBifrostDOT, paraTool.chainIDBifrostKSM].includes(chainID)) {
            this.chainParser = new BifrostParser();
        } else if ([paraTool.chainIDAstar, paraTool.chainIDShiden, paraTool.chainIDShibuya].includes(chainID)) {
            this.chainParser = new AstarParser();
        } else if (chainID == paraTool.chainIDParallel || chainID == paraTool.chainIDHeiko) {
            this.chainParser = new ParallelParser();
            //await this.chainParser.addCustomAsset(this); // This line add psuedo asset HKO/PARA used by dex volume / LP pair / etc ..
        } else if ([paraTool.chainIDMoonbeam, paraTool.chainIDMoonriver, paraTool.chainIDMoonbaseAlpha, paraTool.chainIDMoonbaseBeta].includes(chainID)) {
            this.chainParser = new MoonbeamParser();
        } else if ([paraTool.chainIDInterlay, paraTool.chainIDKintsugi].includes(chainID)) {
            this.chainParser = new InterlayParser();
        } else {
            this.chainParser = new ChainParser();
        }
        if (this.chainParser) {
            this.chainParserChainID = chainID;
            //if (debugLevel >= paraTool.debugVerbose) console.log(`this.chainParserChainID chainID=${chainID}, chainParserName=${this.chainParser.chainParserName}`)
        }
        if (debugLevel > 0) {
            this.chainParser.setDebugLevel(debugLevel)
        }
    }

    async get_chainSymbols() {
        let chainSQL = `select chainID, symbol from chain where symbol is not null`
        var chains = await this.poolREADONLY.query(chainSQL);
        let nativeSymbolMap = {}
        for (const chain of chains) {
            nativeSymbolMap[chain.chainID] = chain.symbol
        }
        return nativeSymbolMap
    }

    // reads all the decimals from the chain table and then the asset mysql table
    async init_chainInfos() {
        //TODO: adjust getSystemProperties to handle case where chain that does not have a "asset" specified (or use left join here) will get one
        let chainSQL = `select id, chain.chainID, chain.chainName, chain.relayChain, chain.paraID, ss58Format, isEVM, chain.iconUrl,
 xcmasset.symbol, xcmasset.decimals, xcmasset.priceUSD, xcmasset.priceUSDPercentChange,
 githubURL, subscanURL, parachainsURL, dappURL, WSEndpoint
 from chain left join xcmasset on chain.symbolXcmInteriorKey = xcmasset.xcmInteriorKey where ( (crawling = 1 or chain.paraID > 0) and id is not null )`
        //console.log(`init_chainInfos chainSQL`, paraTool.removeNewLine(chainSQL))
        var chains = await this.poolREADONLY.query(chainSQL);
        var specVersions = await this.poolREADONLY.query(`select chainID, blockNumber, specVersion from specVersions order by chainID, blockNumber`);
        var assets = await this.poolREADONLY.query(`select asset, chainID, symbol, decimals from asset where decimals is not Null and asset not like '0x%' `);
        // +---------+-----------------------+---------------+-----------------------+----------+-------+----------+-----------------------+
        // | chainID | chainName             | symbol        | symbols               | decimals | isEVM | priceUSD | priceUSDPercentChange |
        // +---------+-----------------------+---------------+-----------------------+----------+-------+----------+-----------------------+
        // |      10 | acala                 | aca           | ["ACA"]               | [12]     |     0 |   1.8012 |                  0.07 |

        let chainInfoMap = {}
        let chainNameMap = {}
        for (const chain of chains) {
            let decimals = parseInt(chain.decimals, 10)
            let paraID = parseInt(chain.paraID, 10)
            let chainName = (chain.chainName != undefined) ? this.capitalizeFirstLetter(chain.chainName) : null
            let info = {
                id: chain.id,
                iconUrl: chain.iconUrl,
                chainID: chain.chainID,
                name: chainName,
                decimal: decimals,
                asset: chain.asset,
                symbol: chain.symbol,
                ss58Format: chain.ss58Format,
                priceUSD: (chain.priceUSD != undefined) ? chain.priceUSD : 0,
                priceUSDPercentChange: (chain.priceUSDPercentChange != undefined) ? chain.priceUSDPercentChange : 0,
                relayChain: chain.relayChain,
                paraID: paraID,
                isEVM: (chain.isEVM == 1) ? true : false,
                githubURL: chain.githubURL,
                //subscanURL: chain.subscanURL,
                subscanURL: null,
                parachainsURL: chain.parachainsURL,
                dappURL: chain.dappURL,
                WSEndpoint: chain.WSEndpoint
            } //use the first decimal until we see an "exception"
            chainInfoMap[chain.chainID] = info
            chainNameMap[chain.id] = info
        }

        // build specVersionsMap
        let specVersionsMap = {};
        for (const specVersion of specVersions) {
            let chainID = parseInt(specVersion.chainID, 10)
            if (!specVersionsMap[chainID]) {
                specVersionsMap[chainID] = [];
            }
            specVersionsMap[chainID].push(specVersion);
        }
        // console.log(`this.chainInfos`, chainInfoMap)
        this.chainInfos = chainInfoMap
        this.chainNames = chainNameMap
        this.specVersions = specVersionsMap
    }


    async assetManagerInit() {

        //init_chainInfos: {chainInfos, chainNames, specVersions}
        await this.init_chainInfos()

        //init_asset_info: {assetInfo, alternativeAssetInfo, symbolRelayChainAsset, xcContractAddress, currencyIDInfo}
        //init_xcm_asset:  {routers, xcmAssetInfo, xcmSymbolInfo}
        //init_paras: {paras}
        await this.init_chain_asset_and_nativeAsset()

        //init_storage_keys: {storageKeys}
        await this.init_storage_keys();

        //init_accounts: {accounts}
        await this.init_accounts();
        return (true);
    }

    async init_storage_keys() {
        let keys = await this.poolREADONLY.query(`select storageKey, palletName, storageName, docs from chainPalletStorage;`);
        let storageKeysMap = {}
        for (const p of keys) {
            storageKeysMap[p.storageKey] = {
                palletName: p.palletName,
                storageName: p.storageName
            };
        }
        //customSK
        //0x3a65787472696e7369635f696e646578 Substrate:ExtrinsicIndex
        storageKeysMap["3a65787472696e7369635f696e646578"] = {
            palletName: "Substrate",
            storageName: "ExtrinsicIndex"
        }
        this.storageKeys = storageKeysMap
    }

    async init_accounts() {
        let accounts = await this.poolREADONLY.query(`select address, nickname, judgements, info, judgementsKSM, infoKSM, verified, verifyDT, numFollowers, numFollowing from account;`);
        let subaccountsKSM = await this.poolREADONLY.query(`select address, parentKSM, subNameKSM from subaccount where parentKSM is not null;`);
        let subaccountsDOT = await this.poolREADONLY.query(`select address, parent, subName from subaccount where parent is not null;`);

        this.accounts = {}
        let accountsMap = {}
        // fetch chain idendity
        for (const p of accounts) {
            if (p.info != null) p.info = JSON.parse(p.info.toString('utf8'));
            if (p.judgements != null) p.judgements = JSON.parse(p.judgements.toString('utf8'));
            p.child = []
            if (p.infoKSM != null) p.infoKSM = JSON.parse(p.infoKSM.toString('utf8'));
            if (p.judgementsKSM != null) p.judgementsKSM = JSON.parse(p.judgementsKSM.toString('utf8'));

            try {
                //try to get display name if possible
                if (p.info != null) {
                    let parsedInfo = p.info
                    p.display = parsedInfo.display
                }
                if (p.infoKSM != null) {
                    let parsedInfoKSM = p.infoKSM
                    p.displayKSM = parsedInfoKSM.display
                }
            } catch (e) {
                //
            }

            p.childKSM = []
            accountsMap[p.address] = p
        }

        for (const sd of subaccountsKSM) {
            let parentKSMAddress = sd.parentKSM
            let subAddress = sd.address
            let p = accountsMap[subAddress]
            if (p == undefined) {
                // init p here
                p = {}
            }

            p.parentKSM = sd.parentKSM
            p.subNameKSM = (sd.subNameKSM != undefined) ? sd.subNameKSM.toString('utf8') : null
            let parentIdentity = accountsMap[parentKSMAddress]
            if (parentIdentity != undefined) {
                if (parentIdentity.infoKSM != undefined) {
                    p.infoKSM = parentIdentity.infoKSM
                }
                if (parentIdentity.judgementsKSM != undefined) {
                    p.judgementsKSM = parentIdentity.judgementsKSM
                }
                if (parentIdentity.displayKSM != undefined) {
                    p.parentDisplayKSM = parentIdentity.displayKSM
                }
                /*
                if (parentIdentity.nickname != undefined){
                    p.parentNickname = parentIdentity.nickname
                }
                */
                parentIdentity.childKSM.push({
                    subAddress: subAddress,
                    subName: p.subNameKSM
                })
            }
            accountsMap[subAddress] = p
            accountsMap[parentKSMAddress] = parentIdentity
        }

        for (const sd of subaccountsDOT) {
            let parentAddress = sd.parent
            let subAddress = sd.address
            let p = this.accounts[subAddress]
            if (p == undefined) {
                // init p here
                p = {}
            }
            p.parent = sd.parent
            p.subName = (sd.subName != undefined) ? sd.subName.toString('utf8') : null
            let parentIdentity = accountsMap[parentAddress]
            if (parentIdentity != undefined) {
                if (parentIdentity.info != undefined) {
                    p.info = parentIdentity.info
                }
                if (parentIdentity.judgements != undefined) {
                    p.judgements = parentIdentity.judgements
                }

                if (parentIdentity.display != undefined) {
                    p.parentDisplay = parentIdentity.display
                }
                /*
                if (parentIdentity.nickname != undefined){
                    p.parentNickname = parentIdentity.nickname
                }
                */
                if (parentIdentity.child != undefined) {
                    parentIdentity.child.push({
                        subAddress: subAddress,
                        subName: p.subName
                    })
                }
            }
            accountsMap[subAddress] = p
            accountsMap[parentAddress] = parentIdentity
        }


        let multisigaccounts = await this.poolREADONLY.query(`select address, threshold, signatories, signatorycnt from multisigaccount`);
        let related = []
        for (const a of multisigaccounts) {
            a.signatories = a.signatories.split("|")
            related.push({
                accountType: "multisig",
                address: a.address,
                threshold: a.threshold,
                signatories: a.signatories,
                signatorycnt: a.signatorycnt
            })
            for (const s of a.signatories) {
                related.push({
                    accountType: "multisigMember",
                    address: s,
                    multisigAddress: a.address,
                    threshold: a.threshold,
                    other_signatories: a.signatories.filter(function(value, index, arr) {
                        return value != s;
                    }),
                    signatorycnt: a.signatorycnt
                });
            }
        }
        let proxyaccounts = await this.poolREADONLY.query(`select chainID, address, delegate, proxyType, delay from proxyaccount where removed = 0`);
        for (const a of proxyaccounts) {
            related.push({
                accountType: "proxyDelegate",
                address: a.address,
                chainID: a.chainID,
                delegate: a.delegate,
                proxyType: a.proxyType,
                delay: a.delay
            })
            related.push({
                accountType: "proxyDelegateOf",
                address: a.delegate,
                chainID: a.chainID,
                delegateOf: a.address,
                proxyType: a.proxyType,
                delay: a.delay
            })
        }

        for (let i = 0; i < related.length; i++) {
            let r = related[i];
            if (accountsMap[r.address] == undefined) {
                accountsMap[r.address] = {}
            }
            if (accountsMap[r.address].related == undefined) {
                accountsMap[r.address].related = [];
            }

            accountsMap[r.address].related.push(r);
        }

        this.accounts = accountsMap
        //console.log(`init_accounts`, this.accounts)
    }

    lookup_account(address) {
        if (this.accounts[address] != undefined) {
            return (this.accounts[address]);
        }
        let asciiName = paraTool.pubKeyHex2ASCII(address);
        if (asciiName != null) {
            return ({
                nickname: asciiName,
                verified: true
            });
        }
        return (null)
    }

    lookup_trace_sectionStorage(inpk, inpv) {
        let o = {}
        if (!inpk) return ([null, null]);
        let key = inpk.slice()
        if (key.substr(0, 2) == "0x") key = key.substr(2)
        let k = key.slice();
        if (k.length > 64) k = k.substr(0, 64);
        let sk = this.storageKeys[k];
        if (sk != undefined) {
            return [sk.palletName, sk.storageName];
        }
        return ([null, null]);

    }

    async get_skipStorageKeys() {
        if (Object.keys(this.skipStorageKeys).length > 0) return;
        this.skipStorageKeys = {};
        this.skipPalletStorageKeys = {};
        var storageKeysList = await this.poolREADONLY.query(`select palletName, storageName, storageKey from chainPalletStorage where skip = 1`);
        if (storageKeysList.length > 0) {
            for (const sk of storageKeysList) {
                this.skipStorageKeys[`${sk.storageKey}`] = sk;
                this.skipPalletStorageKeys[`${sk.palletName}${sk.storageName}`] = sk;
            }
        }
    }

    async init_paras() {
        let paras = await this.poolREADONLY.query(`select id, chainID, chainName, relayChain, paraID, concat(relayChain,'-',paraID) as fullparaID, symbol from chain order by relayChain desc, chainID;`);
        let paraMap = {}
        for (const p of paras) {
            paraMap[p.fullparaID] = p
            //this.paras[p.fullparaID] = p
        }
        this.paras = paraMap
    }

    async init_chain_asset_and_nativeAsset() {
        // return cached version
        let currTS = this.getCurrentTS();

        // reload assetInfo
        await this.init_asset_info()

        // reload xcmAsset
        await this.init_xcm_asset();

        // reload paras
        await this.init_paras();

        return true
    }
    async init_xcm_asset() {
        let xcmAssetInfo = {};
        let xcmSymbolInfo = {};

        try {

            let xcmAssets = await this.poolREADONLY.query("select xcmchainID, xcmInteriorKey, symbol, relayChain, nativeAssetChain, isUSD, decimals, priceUSD, parent as parents, isXCMAsset from xcmasset where xcmInteriorKey is not null and isXCMAsset=1");
            let xcmPriceInfo = {}
            for (let i = 0; i < xcmAssets.length; i++) {
                let v = xcmAssets[i];
                let xcmInteriorKey = v.xcmInteriorKey;
                let priceUSD = v.priceUSD
                if (xcmInteriorKey != undefined && priceUSD) {
                    xcmPriceInfo[xcmInteriorKey] = priceUSD
                }
            }

            for (let i = 0; i < xcmAssets.length; i++) {
                let v = xcmAssets[i];
                let paraID = null
                let chainID = v.xcmchainID
                if (chainID != undefined) {
                    paraID = paraTool.getParaIDfromChainID(chainID)
                }
                let xcmInteriorKey = v.xcmInteriorKey;
                if (xcmAssetInfo[xcmInteriorKey] == undefined) {
                    xcmAssetInfo[xcmInteriorKey] = v;
                }
                let symbolRelaychain = paraTool.makeAssetChain(v.symbol, v.relayChain);
                if (xcmSymbolInfo[symbolRelaychain] == undefined) {
                    let xcmV1MultiLocation = paraTool.convertXcmInteriorKeyToXcmV1MultiLocation(xcmInteriorKey)
                    //let evmMultiLocation = paraTool.convertXcmV1MultiLocationToMoonbeamEvmMultiLocation(xcmV1MultiLocation)
                    let s = {
                        assetType: "Token",
                        decimals: v.decimals,
                        symbol: v.symbol,
                        paraID: paraID,
                        chainID: chainID,
                        relayChain: v.relayChain,
                        isUSD: v.isUSD,
                        parents: v.parents,
                        xcmInteriorKey: xcmInteriorKey,
                        symbolRelaychain: paraTool.makeAssetChain(v.symbol, v.relayChain),
                        //xcmV1MultiLocationHex: xcmV1MultiLocationHex,
                        xcmV1MultiLocation: JSON.stringify(xcmV1MultiLocation),
                        //evmMultiLocation: JSON.stringify(evmMultiLocation),
                        assets: {},
                        xcContractAddress: {},
                        xcCurrencyID: {},
                        nativeAssetChain: null,
                        priceUSD: (v.priceUSD > 0) ? v.priceUSD : null
                    }
                    xcmSymbolInfo[symbolRelaychain] = s;
                }
            }

            let assetRecs = await this.poolREADONLY.query("select asset.chainID, asset.asset, asset.currencyID, asset.xcContractAddress, asset.xcmInteriorKey, xcmasset.symbol, xcmasset.relayChain from asset join xcmasset on asset.xcmInteriorKey = xcmasset.xcmInteriorKey and (xcContractAddress is not null or currencyID is not null) order by xcmasset.xcmInteriorKey");
            for (const assetRec of assetRecs) {
                let symbol = assetRec.symbol;
                let relaychain = assetRec.relayChain;
                let xcmInteriorKey = assetRec.xcmInteriorKey;
                let symbolRelaychain = paraTool.makeAssetChain(symbol, relaychain);
                let paraID = paraTool.getParaIDfromChainID(assetRec.chainID)
                if (xcmSymbolInfo[symbolRelaychain] != undefined) {
                    if (assetRec.asset != null) {
                        if (xcmSymbolInfo[symbolRelaychain]["assets"] == undefined) {
                            xcmSymbolInfo[symbolRelaychain]["assets"] = {};
                        }
                        xcmSymbolInfo[symbolRelaychain]["assets"][paraID] = assetRec.asset;
                    }
                    if (assetRec.xcContractAddress != null) {
                        if (xcmSymbolInfo[symbolRelaychain]["xcContractAddress"] == undefined) {
                            xcmSymbolInfo[symbolRelaychain]["assets"] = {};
                        }
                        xcmSymbolInfo[symbolRelaychain]["xcContractAddress"][paraID] = assetRec.xcContractAddress;
                    }
                    if (assetRec.currencyID != null && !isNaN(assetRec.currencyID)) {
                        if (xcmSymbolInfo[symbolRelaychain]["xcCurrencyID"] == undefined) {
                            xcmSymbolInfo[symbolRelaychain]["assets"] = {};
                        }
                        xcmSymbolInfo[symbolRelaychain]["xcCurrencyID"][paraID] = assetRec.currencyID
                    }
                }
            }


            let routerRecs = await this.poolREADONLY.query("select routerAssetChain, routerName from router");
            let routers = {};
            for (let i = 0; i < routerRecs.length; i++) {
                let v = routerRecs[i];
                if (routers[v.routerAssetChain] == undefined) {
                    routers[v.routerAssetChain] = v;
                }
            }
            this.routers = routers;
            this.xcmAssetInfo = xcmAssetInfo; // key: xcmInteriorKey => a (1, ignore asset/chain)
            this.xcmSymbolInfo = xcmSymbolInfo; // key: symbol~relayChain => a (1, ignore asset/chain)
        } catch (e) {
            console.log(`init_xcm_asset err`, e)
        }

    }

    getXcmAssetInfoDecimals(xcmInteriorKey) {
        let xcmAssetInfo = this.xcmAssetInfo[xcmInteriorKey]
        if (xcmAssetInfo != undefined) {
            return xcmAssetInfo.decimals
        }
        return null
    }
    getXcmAssetInfoSymbol(xcmInteriorKey) {
        let xcmAssetInfo = this.xcmAssetInfo[xcmInteriorKey]
        if (xcmAssetInfo != undefined) {
            return xcmAssetInfo.symbol
        }
        return false
    }

    isXcmInteriorKeyRegistered(xcmInteriorKey) {
        let xcmAssetInfo = this.xcmAssetInfo[xcmInteriorKey]
        if (xcmAssetInfo != undefined) {
            return true
        } else {
            return false
        }
    }

    getXcmAssetInfoByInteriorkey(xcmInteriorKey) {
        let xcmAssetInfo = this.xcmAssetInfo[xcmInteriorKey]
        //console.log(`getXcmAssetInfoByInteriorkey k=${xcmInteriorKey}`, xcmAssetInfo)
        if (xcmAssetInfo != undefined) {
            return xcmAssetInfo
        }
        return false
    }

    getXcmAssetInfoBySymbolKey(symbolRelayChain) {
        let pieces = symbolRelayChain.split('~')
        pieces[0] = pieces[0].toUpperCase()
        let symbolRelayChainUpper = pieces.join('~')
        let xcmAssetInfo = this.xcmSymbolInfo[symbolRelayChainUpper]
        if (xcmAssetInfo != undefined) {
            return xcmAssetInfo
        }
        let xcmAssetInfo2 = this.xcmSymbolInfo[symbolRelayChain]
        if (xcmAssetInfo2 != undefined) {
            return xcmAssetInfo2
        }
        return false
    }

    getXCMAsset(interiorStr, relayChain) {
        let xcmInteriorKey = paraTool.makeXcmInteriorKey(interiorStr, relayChain);
        let xcmAsset = this.getXcmAssetInfoByInteriorkey(xcmInteriorKey)
        if (xcmAsset && xcmAsset.nativeAssetChain != undefined) {
            //console.log(`Found ${xcmInteriorKey} -> ${xcmAsset.nativeAssetChain}`)
            return xcmAsset.nativeAssetChain
        } else {
            console.log(`getXCMAsset NOT Found/Missing ${xcmInteriorKey}`)
            return false
        }
    }

    getNativeChainAsset(chainID) {
        // TODO check
        let asset = this.getChainAsset(chainID)
        if (asset == null) return null
        let nativeAssetChain = paraTool.makeAssetChain(asset, chainID);
        //console.log(`Convert to nativeAssetChain ${chainID} -> ${nativeAssetChain}`)
        return nativeAssetChain
    }

    getXCMTeleportFees(chainIDDest, symbol) {
        let k = `${chainIDDest}-${symbol}`;
        if (this.xcmTeleportFees[k]) {
            return this.xcmTeleportFees[k];
        }
        return null;
    }

    async init_asset_info() {
        let nassets = 0;
        let assetInfo = {};
        let alternativeAssetInfo = {};
        let currencyIDInfo = {};
        let xcContractAddress = {};
        let symbolRelayChainAsset = {};

        let assetRecs = await this.poolREADONLY.query("select assetType, asset.assetName, asset.numHolders, asset.totalSupply, asset.asset, asset.symbol, asset.alternativeAsset, asset.xcmInteriorKey, xcmasset.symbol as xcmasset_symbol, xcmasset.relayChain as xcmasset_relayChain, asset.decimals, asset.token0, asset.token0Symbol, asset.token0Decimals, asset.token1, asset.token1Symbol, asset.token1Decimals, asset.chainID, chain.id, chain.chainName, asset.isUSD, asset.priceUSD, asset.priceUSDPercentChange,  asset.nativeAssetChain, currencyID, xcContractAddress, from_unixtime(createDT) as createTS, xcmasset.priceUSD as xcmpriceUSD from asset left join xcmasset on asset.xcmInteriorKey = xcmasset.xcmInteriorKey, chain where asset.chainID = chain.chainID and assetType in ('ERC20','ERC20LP','ERC721','ERC1155','Token','LiquidityPair','NFT','Loan','Special', 'CDP_Supply', 'CDP_Borrow')");

        for (let i = 0; i < assetRecs.length; i++) {
            let v = assetRecs[i];
            let a = {}
            // add assetChain (string) + parseUSDpaths (JSON array)

            let assetChain = paraTool.makeAssetChain(v.asset, v.chainID);
            let assetKey = paraTool.twox_128(assetChain)
            let priceUSDpaths = (v.priceUSDpaths) ? JSON.parse(v.priceUSDpaths.toString()) : false;
            if (v.asset == '{"StableAssetPoolToken":"0"}') {
                v.assetType = 'LiquidityPair';
            }
            let priceUSD = v.priceUSD
            let alternativeAssetChain = (v.alternativeAsset != undefined) ? paraTool.makeAssetChain(v.alternativeAsset, v.chainID) : false

            if (v.assetType == 'LiquidityPair' || v.assetType == 'ERC20LP') { //'ERC20','ERC20LP','ERC721','ERC1155','Token','LiquidityPair','NFT','Loan','Special'
                a = {
                    assetType: v.assetType,
                    assetName: v.assetName,
                    numHolders: v.numHolders,
                    totalSupply: v.totalSupply,
                    asset: v.asset,
                    symbol: v.symbol,
                    decimals: v.decimals,
                    token0: v.token0,
                    token0Symbol: v.token0Symbol,
                    token0Decimals: v.token0Decimals,
                    token1: v.token1,
                    token1Symbol: v.token1Symbol,
                    token1Decimals: v.token1Decimals,
                    createTS: v.createTS,
                    chainID: v.chainID,
                    id: v.id,
                    chainName: v.chainName,
                    assetChain: assetChain,
                    key: assetKey,
                    isUSD: v.isUSD,
                    priceUSD: priceUSD,
                    priceUSDPercentChange: v.priceUSDPercentChange,
                    //priceUSDpaths: priceUSDpaths,
                    nativeAssetChain: v.nativeAssetChain // removable?
                }
            } else {
                //does not have assetPair, token0, token1, token0Symbol, token1Symbol, token0Decimals, token1Decimals
                a = {
                    assetType: v.assetType,
                    assetName: v.assetName,
                    numHolders: v.numHolders,
                    totalSupply: v.totalSupply,
                    asset: v.asset,
                    symbol: v.symbol,
                    decimals: v.decimals,
                    chainID: v.chainID,
                    createTS: v.createTS,
                    id: v.id,
                    chainName: v.chainName,
                    assetChain: assetChain,
                    key: assetKey,
                    isUSD: v.isUSD,
                    priceUSD: priceUSD,
                    priceUSDPercentChange: v.priceUSDPercentChange,
                    priceUSDpaths: priceUSDpaths,
                    nativeAssetChain: v.nativeAssetChain, // removable
                    isXCAsset: false
                }
                if (v.xcmInteriorKey && v.xcmInteriorKey.length > 0) {
                    a.isXCAsset = true;
                    a.xcmInteriorKey = v.xcmInteriorKey;
                    a.xcContractAddress = v.xcContractAddress;
                    if (v.xcmasset_symbol && a.symbol != v.xcmasset_symbol) {
                        a.localSymbol = a.symbol; // when present, this could override the symbol in a UI (e.g. xcDOT)
                        a.symbol = v.xcmasset_symbol;
                    }
                    //a.symbol = v.xcmasset_symbol; //TODO: xcmasset symbol is potentially not there
                    a.priceUSD = v.xcmpriceUSD;
                    a.relayChain = v.xcmasset_relayChain
                    let symbolRelayChain = paraTool.makeAssetChain(a.symbol, a.relayChain)
                    if (symbolRelayChainAsset[symbolRelayChain] == undefined) {
                        symbolRelayChainAsset[symbolRelayChain] = {};
                    }
                    symbolRelayChainAsset[symbolRelayChain][v.chainID] = a
                } else {
                    a.relayChain = paraTool.getRelayChainByChainID(a.chainID)
                }
            }
            assetInfo[assetChain] = a;
            if (alternativeAssetChain) {
                //if (this.debugLevel >= paraTool.debugVerbose) console.log(`adding alternative assetInfo[${alternativeAssetChain}]`, a)
                alternativeAssetInfo[alternativeAssetChain] = a;
            }
            if (v.currencyID != null && v.currencyID.length > 0) {
                let currencyChain = paraTool.makeAssetChain(v.currencyID, v.chainID)
                currencyIDInfo[currencyChain] = a;
            }
            if (v.xcContractAddress) {
                let xcassetChain = paraTool.makeAssetChain(v.xcContractAddress, v.chainID);
                xcContractAddress[v.xcContractAddress] = a;
            }
            nassets++;
        }

        // load a model of expectedTeleportFee by chainID-chainIDDest-symbol in assetManager, use teleportFeeChainSymbol
        let xcmTeleportFeeRecs = await this.poolREADONLY.query("select chainIDDest, symbol, ROUND(teleportFeeDecimals_avg_imperfect) as teleportFeeDecimals_avg, ROUND(teleportFeeDecimals_std_imperfect) as teleportFeeDecimals_std from teleportfees");
        for (let i = 0; i < xcmTeleportFeeRecs.length; i++) {
            let r = xcmTeleportFeeRecs[i];
            let k = `${r.chainIDDest}-${r.symbol}`;
            this.xcmTeleportFees[k] = {
                teleportFeeDecimals_avg: r.teleportFeeDecimals_avg,
                teleportFeeDecimals_std: r.teleportFeeDecimals_std
            };
        }

        //console.log(this.expectedTeleportFee)
        this.assetInfo = assetInfo;
        this.alternativeAssetInfo = alternativeAssetInfo;
        this.symbolRelayChainAsset = symbolRelayChainAsset;
        this.xcContractAddress = xcContractAddress;
        this.currencyIDInfo = currencyIDInfo;
    }

    async checkChainSymbolXcmInteriorKey(chainID) {
        let symbolXcmInteriorKey = false
        let chainRecs = await this.poolREADONLY.query(`select symbolXcmInteriorKey, symbol from chain where chainID = '${chainID}'`);
        if (chainRecs.length > 0) {
            let chainRec = chainRecs[0]
            if (chainRec.symbolXcmInteriorKey != undefined && chainRec.symbol != undefined) {
                symbolXcmInteriorKey = chainRec.symbolXcmInteriorKey
            }
        }
        return symbolXcmInteriorKey
    }

    validXCMSymbol(symbol, chainID, ctx, o) {
        let relayChain = paraTool.getRelayChainByChainID(chainID);
        let symbolRelayChain = paraTool.makeAssetChain(symbol, relayChain);
        if (this.symbolRelayChainAsset[symbolRelayChain]) {
            return true;
        }
        if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`validXCMSymbol: symbolRelayChain=${symbolRelayChain} not found!`)
        return false;
    }

    getChainXCMAssetBySymbol(symbol, relayChain, chainID) {
        let symbolRelayChain = paraTool.makeAssetChain(symbol, relayChain);
        if (this.symbolRelayChainAsset[symbolRelayChain] == undefined || this.symbolRelayChainAsset[symbolRelayChain][chainID] == undefined) {
            return (null);
        }
        return this.symbolRelayChainAsset[symbolRelayChain][chainID]
    }

    // getSpecVersionMetadata returns a cached metadata object OR fetches from SQL table OR does a RPC call
    // and updates this.storageKeys using the "pallets"
    async getSpecVersionMetadata(chain, specVersion, blockHash = false, bn = 0) {
        let chainID = chain.chainID;
        let updateChainPalletStorage = (this.getCurrentTS() - chain.lastUpdateStorageKeysTS > 86400 * 3);
        if (this.metadata[specVersion]) return (this.metadata[specVersion]);
        let sql = `select metadata, specVersion from specVersions where chainID = '${chainID}' and specVersion = ${specVersion} limit 1`;
        var metadataRecs = await this.poolREADONLY.query(sql)
        let metadata = false;
        if (metadataRecs.length == 0 || !(metadataRecs[0].metadata.length > 0)) {
            let chainID = chain.chainID;
            let metadataRaw = blockHash ? await this.api.rpc.state.getMetadata(blockHash) : await this.api.rpc.state.getMetadata();
            metadata = metadataRaw.asV14.toJSON();
            let metadataString = JSON.stringify(metadata);
            console.log("getSpecVersionMetadata: fetch metadata from rpc", "chainID", chainID, "specVersion", specVersion, "len(metadataString)", metadataString.length);
            if (await this.update_spec_version(chainID, specVersion)) {}
            await this.upsertSQL({
                "table": "specVersions",
                "keys": ["chainID", "specVersion"],
                "vals": ["metadata"],
                "data": [`('${chainID}', '${specVersion}', ${mysql.escape(metadataString)} )`],
                "replace": ["metadata"]
            });
            this.metadata[specVersion] = metadata;
        } else {
            console.log("getSpecVersionMetadata: fetch metadata from db", sql);
            metadata = JSON.parse(metadataRecs[0].metadata);
            this.metadata[specVersion] = metadata;
        }

        var pallets = metadata.pallets;
        /*  Example: {
          name: 'Balances',
          storage: { prefix: 'Balances', items: [Array] },
          calls: { type: '210' },
          events: { type: '41' },
          constants: [ [Object], [Object], [Object] ],
          errors: { type: '343' },
          index: '10'
        }, */
        this.storageKeys = {};
        let sks = [];
        for (const pallet of pallets) {
            var palletName = pallet.name; // Tokens
            var calls = pallet.calls;
            var events = pallet.events;
            var constants = pallet.constants;
            var errors = pallet.errors;
            var storage = pallet.storage;
            var prefix = pallet.prefix;
            if (storage && storage.items) {
                for (const item of storage.items) {
                    /* Example: {
                      name: 'TotalIssuance',
                      modifier: 'Default',
                      type: { map: { hashers: [Array], key: '44', value: '6' } },
                      fallback: '0x00000000000000000000000000000000',
                      docs: [ ' The total issuance of a token type.' ]
                      }		*/
                    let type0 = JSON.stringify(item.type);
                    let modifier = item.modifier;
                    let fallback = item.fallback;
                    let storageName = item.name;
                    let docs = item.docs.join(" ").trim();
                    let storageKey = paraTool.twox_128(palletName) + paraTool.twox_128(storageName);
                    this.storageKeys[storageKey] = {
                        palletName,
                        storageName
                    };
                    if (updateChainPalletStorage) {
                        sks.push(`('${palletName}', '${storageName}', '${chainID}', '${storageKey}', ${mysql.escape(modifier)}, ${mysql.escape(type0)}, ${mysql.escape(fallback)}, ${mysql.escape(docs)}, Now())`)
                    }
                }
            }
            //customSK
            //0x3a65787472696e7369635f696e646578 Substrate:ExtrinsicIndex
            this.storageKeys["3a65787472696e7369635f696e646578"] = {
                palletName: "Substrate",
                storageName: "ExtrinsicIndex"
            }
            this.storageKeys["3a7472616e73616374696f6e5f6c6576656c3a"] = {
                palletName: "Substrate",
                storageName: "TransactionLevel"
            }
            this.storageKeys["3a696e747261626c6f636b5f656e74726f7079"] = {
                palletName: "Substrate",
                storageName: ":intrablock_entropy"
            }
        }
        if (sks.length > 0) {
            // add potentially new chainPalletStorage records and record that we have done so
            await this.upsertSQL({
                "table": `chainPalletStorage`,
                "keys": ["palletName", "storageName"],
                "vals": ["chainID", "storageKey", "modifier", "type", "fallback", "docs", "lastUpdateDT"],
                "data": sks,
                "replace": ["chainID", "storageKey", "modifier", "type", "fallback", "docs", "lastUpdateDT"]
            });
            let sql = `update chain set lastUpdateStorageKeysTS = UNIX_TIMESTAMP(Now()) where chainID = '${chainID}'`
            this.batchedSQL.push(sql);
            await this.update_batchedSQL()
        }
        return (this.metadata[specVersion]);

    }

    async getChainERCAssets(chainID) {
        var sql = `select * from asset where chainID = '${chainID}' and asset like '0x%'`
        var assets = await this.poolREADONLY.query(sql);
        let loadedCnt = 0
        let loadErrCnt = 0
        for (let i = 0; i < assets.length; i++) {
            let a = assets[i];
            //load `state` from JSON string
            if (a.lastState != undefined) {
                try {
                    let lastState = `${a.lastState}`
                    let parsedState = JSON.parse(lastState)
                    a.lastState = parsedState
                    //console.log(`getChainERCAssets loaded`, parsedState)
                    this.ercTokenList[a.asset] = parsedState
                    loadedCnt++
                } catch (e) {
                    loadErrCnt++
                    a.lastState = false
                    console.log(`error`, e.toString())
                }
            }
            //this.ercTokenList[a.asset] = a;
        }
        //console.log(`getChainERCAssets loaded: ${loadedCnt}, loadErrCnt: ${loadErrCnt}, state null: ${assets.length-loadedCnt-loadedCnt}, total: ${assets.length}`);
    }

    async addAssetInfo(asset, chainID, assetInfo, caller = false) {
        let assetChain = paraTool.makeAssetChain(asset, chainID);
        let isNativeChain = (assetInfo.isNativeChain != undefined) ? assetInfo.isNativeChain : 0 // DISCUSS
        let currencyID = (assetInfo.currencyID != undefined) ? `${assetInfo.currencyID}` : 'NULL'
        let decimals = (assetInfo.decimals != undefined) ? `${assetInfo.decimals}` : 'NULL'
        let isLocalAsset = (assetInfo.isLocalAsset != undefined) ? assetInfo.isLocalAsset : 'NULL'
        let sqlDebug = true
	let symbol = assetInfo.symbol || "";
	if (symbol.length > 32) {
	    symbol = symbol.substr(0, 32);
	}
        await this.upsertSQL({
            "table": "asset",
            "keys": ["asset", "chainID"],
            "vals": ["assetName", "symbol", "decimals", "assetType", "isNativeChain", "currencyID", "isLocalAsset"],
            "data": [`( '${asset}', '${chainID}', ${mysql.escape(assetInfo.name)}, ${mysql.escape(symbol)}, ${decimals}, '${assetInfo.assetType}', '${isNativeChain}', ${currencyID}, ${isLocalAsset} )`],
            "replaceIfNull": ["assetName", "symbol", "decimals", "assetType", "isNativeChain", "currencyID", "isLocalAsset"],
        }, sqlDebug);
        assetInfo.assetName = assetInfo.name //TODO: cached assetInfo from mysql has assetName but not "name"
        this.assetInfo[assetChain] = assetInfo;
        if (caller) {
            console.log(`[${caller}] adding this.assetInfo[${assetChain}]`, this.assetInfo[assetChain])
        } else {
            console.log(`adding this.assetInfo[${assetChain}]`, this.assetInfo[assetChain])
        }
        this.reloadChainInfo = true;
    }

    /*
    2000	'[{"parachain":2000},{"generalKey":"0x0001"}]'	      {"Token":"AUSD"}[2000] |	[aUSD]	[x2]
    2012	'[{"parachain":2012},{"generalKey":"0x50415241"}]'	  {"Token":"PARA"}[2012] |	[PARA]	[x2]
    */

    async addXcmAssetInfo(xcmAssetInfo, caller = false) {
        let out = [`('${xcmAssetInfo.chainID}', '${xcmAssetInfo.xcmConcept}', '${xcmAssetInfo.asset}', '${xcmAssetInfo.paraID}', '${xcmAssetInfo.relayChain}', '${xcmAssetInfo.nativeAssetChain}', '${xcmAssetInfo.source}', Now())`]
        let vals = [`paraID`, `relayChain`, `nativeAssetChain`, `source`, `lastUpdateDT`]
        let sqlDebug = true
        await this.upsertSQL({
            "table": "xcmConcept",
            "keys": ["chainID", "xcmConcept", "asset"],
            "vals": vals,
            "data": out,
            "replace": vals
        }, sqlDebug);
        let xcmInteriorKey = xcmAssetInfo.xcmInteriorKey
        this.xcmAssetInfo[xcmInteriorKey] = xcmAssetInfo;
        if (caller) {
            console.log(`[${caller}] adding this.xcmAssetInfo[${xcmInteriorKey}]`, this.xcmAssetInfo[xcmInteriorKey])
        } else {
            console.log(`adding this.xcmAssetInfo[${xcmInteriorKey}]`, this.xcmAssetInfo[xcmInteriorKey])
        }
        this.reloadChainInfo = true;
    }

    async addLpAssetInfo(lpAsset, chainID, lpAssetInfo, caller = false) {
        let lpAssetChain = paraTool.makeAssetChain(lpAsset, chainID);
        let sqlDebug = true
        await this.upsertSQL({
            "table": "asset",
            "keys": ["asset", "chainID"],
            "vals": ["assetName", "symbol", "decimals", "assetType", 'token0', 'token0symbol', 'token0decimals', 'token1', 'token1symbol', 'token1decimals'],
            "data": [`( '${lpAsset}', '${chainID}', '${lpAssetInfo.name}', '${lpAssetInfo.symbol}', '${lpAssetInfo.decimals}', '${lpAssetInfo.assetType}', '${lpAssetInfo.token0}', '${lpAssetInfo.token0symbol}', '${lpAssetInfo.token0decimals}', '${lpAssetInfo.token1}', '${lpAssetInfo.token1symbol}', '${lpAssetInfo.token1decimals}')`],
            "replace": ["assetType"],
            "replaceIfNull": ["assetName", "symbol", "decimals", 'token0', 'token0symbol', 'token0decimals', 'token1', 'token1symbol', 'token1decimals']
        }, sqlDebug);


        lpAssetInfo.assetName = lpAssetInfo.name //TODO: cached assetInfo from mysql has assetName but not "name"
        this.assetInfo[lpAssetChain] = lpAssetInfo;
        if (caller) {
            console.log(`[${caller}] adding this.addLpAssetInfo[${lpAssetChain}]`, this.assetInfo[lpAssetChain])
        } else {
            console.log(`adding LP this.assetInfo[${lpAssetChain}]`, this.assetInfo[lpAssetChain])
        }
        this.reloadChainInfo = true;
    }


    getNativeAsset(chainID) {
        let symbol = this.getChainSymbol(chainID);
        if (symbol) {
            return JSON.stringify({
                Token: symbol
            })
        } else {
            return (false);
        }
    }

    getNativeSymbol(chainID) {
        let symbol = this.getChainSymbol(chainID);
        if (symbol) {
            return symbol
        } else {
            return (false);
        }
    }

    getRelayChainSymbol(chainID) {
        let relayChain = paraTool.getRelayChainByChainID(chainID)
        let relayChainID = paraTool.getRelayChainID(relayChain)
        let symbol = this.getChainSymbol(relayChainID);
        if (symbol) {
            return symbol
        } else {
            return (false);
        }
    }


    //todo: should this function be async. If so, how to handle it in txparams.ejs?
    getAssetDecimal(asset, chainID, ctx = "false") {
        let assetChain = paraTool.makeAssetChain(asset, chainID);
        if (this.assetInfo[assetChain] != undefined) {
            return this.assetInfo[assetChain].decimals
        } else {
            //console.log("getAssetDecimal MISS", "CONTEXT", ctx, "assetString", assetString);
            return (false);
        }
    }

    getAssetSymbol(asset, chainID, ctx = "false") {
        let assetChain = paraTool.makeAssetChain(asset, chainID);
        if (this.assetInfo[assetChain] != undefined) {
            return this.assetInfo[assetChain].symbol
        } else {
            //console.log("getAssetDecimal MISS", "CONTEXT", ctx, "assetString", assetString);
            return (false);
        }
    }

    getAssetByCurrencyID(currencyID, chainID) {
        let currencyChain = paraTool.makeAssetChain(currencyID, chainID);
        if (this.currencyIDInfo[currencyChain] !== undefined) {
            let assetInfo = this.currencyIDInfo[currencyChain];
            return assetInfo
        }
        return false
    }

    getCurrencyIDDecimal(currencyID, chainID) {
        let currencyChain = paraTool.makeAssetChain(currencyID, chainID);
        if (this.currencyIDInfo[currencyChain] !== undefined) {
            let assetInfo = this.currencyIDInfo[currencyChain];
            if (assetInfo.decimals != undefined) {
                return assetInfo.decimals
            }
        }
        return (false);
    }

    getCurrencyIDSymbol(currencyID, chainID) {
        let currencyChain = paraTool.makeAssetChain(currencyID, chainID);
        if (this.currencyIDInfo[currencyChain] !== undefined) {
            let assetInfo = this.currencyIDInfo[currencyChain];
            if (assetInfo.symbol != undefined && assetInfo.symbol) {
                return assetInfo.symbol
            }
        }
        return (false);
    }

    async get_assetlog(asset, chainID, q = null, lookbackDays = 3650) {
        let assetChain = paraTool.makeAssetChain(asset, chainID);
        let currentTS = this.getCurrentTS();
        if (this.assetlog[assetChain] !== undefined) {
            if (this.assetlog[assetChain].expireTS > currentTS)
                return (this.assetlog[assetChain])
        }

        // expire the assetlog record in 4-5mins, where randomness is included so we don't have many assetchain recs expire at the same time, creating db load all at once
        let assetlog = {
            expireTS: currentTS + 240 + Math.round(60 * Math.random()),
            assetType: null
        };
        if (q && q.isXCAsset) {
            assetlog.assetType = "Token";
            assetlog.symbol = q.symbol;
            assetlog.isXCAsset = q.isXCAsset;
        } else if (this.assetInfo[assetChain]) {
            let a = this.assetInfo[assetChain];
            assetlog.assetType = a.assetType;
            assetlog.symbol = a.symbol;
            assetlog.isXCAsset = (a.xcmInteriorKey && a.xcmInteriorKey.length > 0)
        }


        let liquidMax = 0.5 // e^.5 = 1.65
        if (assetlog.assetType == paraTool.assetTypeToken || assetlog.assetType == paraTool.assetTypeERC20 ||
            ((chainID == paraTool.chainIDParallel || chainID == paraTool.chainIDHeiko) && (assetlog.assetType == paraTool.assetTypeToken || assetlog.assetType == paraTool.assetTypeToken))) {
            let sql = assetlog.isXCAsset ? `select indexTS, routerAssetChain, priceUSD, priceUSD10, priceUSD100, priceUSD1000, liquid, CONVERT(verificationPath using utf8) as path from xcmassetpricelog where symbol = '${q.symbol}' and relayChain = '${q.relayChain}' and liquid < '${liquidMax}' order by indexTS;` : `select indexTS, routerAssetChain, priceUSD, priceUSD10, priceUSD100, priceUSD1000, liquid, CONVERT(verificationPath using utf8) as path from assetpricelog where asset = '${asset}' and chainID = '${chainID}' and liquid < '${liquidMax}' order by indexTS;`
            if (chainID == paraTool.chainIDParallel || chainID == paraTool.chainIDHeiko) {
                // using parallel+heiko oracles while https://github.com/parallel-finance/parallel-js/issues/63
                sql = `select indexTS, priceUSD, 0 as liquid, 'parachain~${chainID}' as routerAssetChain, '[]' as path from assetlog where asset = '${asset}' and chainID = '${chainID}' and indexTS > unix_timestamp(date_sub(Now(), interval ${lookbackDays} day)) and source = 'oracle' order by indexTS`;
                console.log(`!!! ${sql}`)
            }
            let recs = await this.poolREADONLY.query(sql);
            assetlog.prices = [];

            // organize them by indexTS =>
            let indexTS = {};
            for (let i = 0; i < recs.length; i++) {
                let a = recs[i];
                if (indexTS[a.indexTS] == undefined) {
                    indexTS[a.indexTS] = []
                }
                let liquid = (a.priceUSD1000 && a.priceUSD1000 > a.priceUSD) ? Math.log(a.priceUSD1000) - Math.log(a.priceUSD) : 0
                // p10: parseFloat(a.priceUSD10), p100: parseFloat(a.priceUSD100), p1000: parseFloat(a.price1000),
                indexTS[a.indexTS].push({
                    p: parseFloat(a.priceUSD),
                    s: a.routerAssetChain,
                    path: a.path,
                    liquid
                })
            }
            for (const t of Object.keys(indexTS)) {
                assetlog.prices.push({
                    ts: t,
                    r: indexTS[t]
                });
            }
            assetlog.prices.sort(function(a, b) {
                return a.ts - b.ts;
            })
        }

        // Loans [Acala/Karura] and CDPSupply/CDPBorrw [Parallel/Heiko]
        if (assetlog.assetType == "Loan") {
            let ratelogRecs = await this.poolREADONLY.query(`select assetlog.indexTS, asset.decimals, assetlog.debitexchangerate from assetlog, asset
               where assetlog.asset = asset.asset and assetlog.chainID = asset.chainID and
                indexTS > UNIX_TIMESTAMP(DATE_SUB(Now(), interval ${lookbackDays} DAY))
                and asset.asset = '${asset}' and asset.chainID = '${chainID}'
                and asset.assetType = 'Loan' and assetlog.debitexchangerate > 0
                order by indexTS`);
            if (ratelogRecs.length > 0) {
                assetlog.rates = []
            }
            for (let i = 0; i < ratelogRecs.length; i++) {
                let a = ratelogRecs[i];
                assetlog.rates.push({
                    ts: a.indexTS,
                    r: parseFloat(a.debitexchangerate),
                });
            }
        } else if (assetlog.assetType == paraTool.assetTypeCDPBorrow) {
            let assetKey = this.CDPStringUnify(asset);
            let ratelogRecs = await this.poolREADONLY.query(`select indexTS, borrowExchangeRate, supplyExchangeRate from assetlog
               where asset = '${assetKey}' and indexTS > UNIX_TIMESTAMP(DATE_SUB(Now(), interval ${lookbackDays} DAY))
                and chainID = '${chainID}' and ( assetlog.supplyExchangeRate > 0 or assetlog.borrowExchangeRate > 0 )
                order by indexTS`);
            if (ratelogRecs.length > 0) {
                assetlog.rates = []
            }
            for (let i = 0; i < ratelogRecs.length; i++) {
                let a = ratelogRecs[i];
                assetlog.rates.push({
                    ts: a.indexTS,
                    b: parseFloat(a.borrowExchangeRate)
                });
            }
        } else if (assetlog.assetType == paraTool.assetTypeCDPSupply) {
            let assetKey = this.CDPStringUnify(asset);
            let ratelogRecs = await this.poolREADONLY.query(`select indexTS, borrowExchangeRate, supplyExchangeRate from assetlog
               where asset = '${assetKey}' and indexTS > UNIX_TIMESTAMP(DATE_SUB(Now(), interval ${lookbackDays} DAY))
                and chainID = '${chainID}' and ( assetlog.supplyExchangeRate > 0 or assetlog.borrowExchangeRate > 0 )
                order by indexTS`);
            if (ratelogRecs.length > 0) {
                assetlog.rates = []
            }
            for (let i = 0; i < ratelogRecs.length; i++) {
                let a = ratelogRecs[i];
                assetlog.rates.push({
                    ts: a.indexTS,
                    r: parseFloat(a.supplyExchangeRate)
                });
            }
        }

        if (assetlog.assetType == "LiquidityPair" || assetlog.assetType == "ERC20LP") {
            let sql = `select assetlog.indexTS, assetlog.issuance, assetlog.lp0, assetlog.lp1, assetlog.close
          from assetlog
          where indexTS > UNIX_TIMESTAMP(DATE_SUB(Now(), interval ${lookbackDays} DAY)) and assetlog.asset = '${asset}' and assetlog.chainID = '${chainID}'
          order by indexTS`;

            if (chainID == paraTool.chainIDParallel || chainID == paraTool.chainIDHeiko) {
                // using parallel+heiko oracles while https://github.com/parallel-finance/parallel-js/issues/63
                sql = `select indexTS, issuance, lp0, lp1, close from assetlog where asset = '${asset}' and chainID = '${chainID}' and indexTS > unix_timestamp(date_sub(Now(), interval ${lookbackDays} day)) and source = 'oracle' and lp0 is not null and lp1 is not null order by indexTS`;
            }

            let dexRecs = await this.poolREADONLY.query(sql);
            let prevIssuance = 0;
            if (dexRecs.length > 0) {
                assetlog.dexRecs = [];
            }
            for (let i = 0; i < dexRecs.length; i++) {
                let a = dexRecs[i];
                a.issuance = parseFloat(a.issuance);
                let issuance = a.issuance > 0 ? a.issuance : prevIssuance;
                if (issuance > 0) {
                    assetlog.dexRecs.push({
                        ts: a.indexTS,
                        dexRec: {
                            issuance: issuance,
                            lp0: a.lp0,
                            lp1: a.lp1,
                            close: a.close
                        }
                    });
                    prevIssuance = issuance;
                }
            }
        }

        this.assetlog[assetChain] = assetlog;

        for (const ac of Object.keys(this.assetlog)) {
            if (this.assetlog[ac].expireTS < currentTS) {
                delete this.assetlog[ac]
            }
        }
        return (this.assetlog[assetChain]);
    }



    binarySearch(ar, el, compare_fn) {
        var m = 0;
        var n = ar.length - 1;
        if (m > n) return (false);

        while (m <= n) {
            var k = (n + m) >> 1;
            var cmp = compare_fn(el, ar[k]);

            if (cmp > 0) {
                m = k + 1;
            } else if (cmp < 0) {
                n = k - 1;
            } else {
                return ar[k];
            }
        }
        let r = m - 1;

        if (r < 0) return ar[0];
        if (r > ar.length - 1) {
            return ar[ar.length - 1];
        }
        return ar[r];
    }

    async decorateUSD(c, fld = 'value', asset, chainID, ts, decorate = true) {
        console.log(`decorateUSD fld=${fld}, decorate=${decorateUSD}`, c)
        if (c[fld] == undefined) {
            return c
        }
        let val = c[fld]
        if (decorate) {
            let p = await this.computePriceUSD({
                val,
                asset: chainAsset,
                chainID,
                ts: cTimestamp
            });
            if (p) {
                c[`${fld}USD`] = p.valUSD;
                c.priceUSD = p.priceUSD;
                c.priceUSDCurrent = p.priceUSDCurrent;
            }
        }
        return c
    }

    async getTokenPriceUSD(asset, chainID, ts = null, liquidMax = 2.0) {
        return await this.computePriceUSD({
            asset,
            chainID,
            ts,
            liquidMax
        })
    }
    // given multiple source, choose that with the highest liquidity
    map_result_priceusd_path(result) {
        if (result.length == 0) return null;
        if (result.length == 1) return result[0];
        result.sort(function(a, b) {
            return a.liquid - b.liquid
        })
        return result[0];
    }

    /*
    computePriceUSD (refactor in progress) is a key workhorse used in the indexer / query classes to support historical analysis
    (with binary search from routers/dexs/oracles/coingecko) but also fast look up of the latest prices using assetInfo loaded up

    Input: `query` can be a string but will generally be an object
    * asset, chainID OR symbol, relayChain OR assetChain OR xcmInteriorKey
    * val [optional, default : 1.0]
    * ts [optional, default : current unix timestamp] -- can also take an array (e.g. 90 days), which will support much faster price charting in the future
    * raw -- if true, the val should be divided by the known decimals (returned)

    Output: null if the asset is not , or an object with:
    * valUSD, if val is supplied
    * priceUSD as single value or array, if ts supplied
    * assetInfo from this.assetInfo OR this.xcm{...} which will have
      - priceUSDCurrent, priceUSDPercentChange ALWAYS kept up to date
        - if the chainID context is known, always pick the DEX router with the highest liquidity from that specific chain IF it is liquid and one exists, then pick the coingecko data if available
        - if the chainID context is not known, pick the CEX if available
      - the chainID context will be : (a) the chainID if in the actual input, otherwise (b) specified in query  as requestingChainID -- so astarscan.io would have 2006, moonbeam.polkaholic.io 2004 etc.
      - priceUSDCurrentRouterAssetChain, priceUSDCurrentPath -- to support verifiability, whatever data is provided in priceUSDCurrent will always have these fields
      - NEW: priceRouters array showing the precise verifiable path for EVM and non-EVM chains ( parachain~2000, 0x700. ~ 2004 , website~coingecko )
         routerAssetChain, priceUSD1, priceUSD10, ... priceUSD1000, path and some liquidity measure (is there a standard for this?)
      - LATER: priceOracles array showing the precise verifiable call for EVM and non-EVM chains
      - isXCAsset
      - isUSD
      - xcContractAddress
      - assetType
      - asset, chainID, if xcAsset=false OR symbol, relayChain, xcmInteriorKey, if xcAsset=true
      ... token0, token1, isRouter etc.
      - decimals
    */
    async computePriceUSD(queryRaw) {
        let val = queryRaw.val ? queryRaw.val : 1.0;
        let ts = (queryRaw.ts && this.getCurrentTS() - queryRaw.ts > 120) ? queryRaw.ts : null;
        //let ts0 = (queryRaw.ts && this.getCurrentTS() - queryRaw.ts > 120) ? queryRaw.ts : null;
        //console.log(`currentTS=${this.getCurrentTS()}, queryRawTS:${queryRaw.ts}, ts0=${ts0}, ts=${ts}`)
        let tsInt = parseInt(ts, 10);
        var compare = function(a, b) {
            return (a - b.ts);
        }
        let q = queryRaw;

        let assetInfo = null;
        if (typeof queryRaw == "string") {
            if (q.substring(0, 2) == "0x") q = q.toLowerCase();
            let [asset, chainID] = paraTool.parseAssetChain(q)
            q = {
                assetChain: queryRaw,
                asset,
                chainID
            }
            assetInfo = this.assetInfo[queryRaw];
        } else if (q.assetChain != undefined) {
            let [asset, chainID] = paraTool.parseAssetChain(q.assetChain);
            q.asset = asset;
            q.chainID = chainID;
            if (q.asset.substring(0, 2) == "0x") q.asset = q.asset.toLowerCase();
            assetInfo = this.assetInfo[q.assetChain];
        } else if (q.asset != undefined && q.chainID != undefined) {
            if (q.asset.substring(0, 2) == "0x") q.asset = q.asset.toLowerCase();
            q.assetChain = paraTool.makeAssetChain(q.asset, q.chainID);
            assetInfo = this.assetInfo[q.assetChain];
        } else if (q.xcmInteriorKey != undefined) {
            assetInfo = this.xcmAssetInfo[q.xcmInteriorKey]
            if (assetInfo) q.isXCAsset = true;
        } else if (q.symbol != undefined && q.relayChain != undefined) {
            let symbolRelayChain = paraTool.makeAssetChain(q.symbol, q.relayChain);
            assetInfo = this.xcmSymbolInfo[symbolRelayChain];
            if (assetInfo) q.isXCAsset = true;
        }

        let res = {}
        if (assetInfo) {
            q.symbol = assetInfo.symbol
            if (assetInfo.relayChain) {
                q.relayChain = assetInfo.relayChain
            }
            q.decimals = assetInfo.decimals
            q.currentPriceUSD = assetInfo.priceUSD
            if (assetInfo.xcmInteriorKey) {
                q.xcmInteriorKey = assetInfo.xcmInteriorKey
            }
            if (assetInfo.isXCAsset) q.isXCAsset = true;
            res.assetInfo = assetInfo
            res.priceUSDCurrent = assetInfo.priceUSD;
        } else {
            return null;
        }
        // see if we can find price via direct lookup
        if (assetInfo.isUSD > 0) {
            res.priceUSD = 1;
            res.priceUSDCurrent = 1;
            if (q.val) res.valUSD = q.val;
            return res;
        }

        // console.log("computePriceUSD", q, "assetInfo", assetInfo);
        let priceUSDCurrent = assetInfo.priceUSD;
        let currentTS = this.getCurrentTS();
        let assetType = assetInfo.assetType ? assetInfo.assetType : "Token"; // NEED CORRECT SOLUTION here...
        if (q.chainID == paraTool.chainIDParallel || q.chainID == paraTool.chainIDHeiko) {
            // use oracle for parallel lp
            //if (assetInfo.assetType == paraTool.assetTypeLiquidityPair) assetType = paraTool.assetTypeToken
        }
        switch (assetType) {
            case paraTool.assetTypeERC20:
            case paraTool.assetTypeToken:
                if (ts == null) {
                    // short circuit any load of assetlog
                    res.priceUSD = assetInfo.priceUSD;
                    if (q.val) res.valUSD = q.val * res.priceUSD;
                    return res;
                } else {
                    if (ts == null) {
                        console.log(`short circuit failed! q.asset=${q.asset} assetType=${assetType}, ts=${ts}`)
                    }
                    let assetlog = q.isXCAsset ? await this.get_assetlog(q.symbol, q.relayChain, q) : await this.get_assetlog(q.asset, q.chainID, q);
                    if ((assetlog !== undefined) && (assetlog.prices !== undefined)) {
                        let result = this.binarySearch(assetlog.prices, ts, compare);
                        if (result) {
                            res.r = result.r; // too much info ... only set if requested?
                            let bestRouterAssetChainResult = this.map_result_priceusd_path(result.r);
                            //console.log("RESULT", result, "best", bestRouterAssetChainResult);
                            res.priceUSD = bestRouterAssetChainResult.p;
                            if (q.val) res.valUSD = q.val * res.priceUSD;
                            if (q.liquidMax && bestRouterAssetChainResult.liquid > q.liquidMax) {
                                return null;
                            } else if (bestRouterAssetChainResult.liquid > 3) {
                                return null;
                            }
                            return res;
                        }
                    } else {
                        console.log("FAILURE ASSETTYPE TOKEN", q);
                    }
                }
                return null;
                break;
            case paraTool.assetTypeERC20LiquidityPair:
            case paraTool.assetTypeLiquidityPair: {
                /*
                	    if WGLMR is $2.13 and GLINT is $0.003049, how much is 1 WGLMR/GLINT
                total lp0(WGLMR): 267712
                total lp1(GLINT): 128949000
                total LP issuance WGLMR/GLINT: 5770310

                1 share of WGLMR/GLINT is 267712/5770310 ~ 0.04639473442 WGLMR + 128949000/5770310  ~ 22.346979625 GLINT
                ~= 2.13*0.04639473442 + 22.346979625*0.003049
                ~= 0.09882078431 + 0.06813594087
                	    ~= 0.16695672518
                */
                let dexRec = await this.getDexRec(q.asset, q.chainID, ts);
                if (!dexRec) {
                    if (this.debugLevel >= paraTool.debugInfo) console.log(`${assetInfo.assetType} no assetpair info returned`, q);
                    return null
                }
                let p0 = await this.getTokenPriceUSD(assetInfo.token0, q.chainID, ts);
                let p1 = await this.getTokenPriceUSD(assetInfo.token1, q.chainID, ts);
                if (p0 && p1) {
                    let priceUSD1 = (p0.priceUSD == 1 && (p1.priceUSD == 0)) ? dexRec.lp0 / dexRec.lp1 : p1.priceUSD;
                    let priceUSD0 = (p0.priceUSD == 0 && (p1.priceUSD == 1)) ? dexRec.lp1 / dexRec.lp0 : p0.priceUSD;
                    let priceUSD1Current = (p0.priceUSDCurrent == 1 && (p1.priceUSDCurrent == 0)) ? dexRec.lp0 / dexRec.lp1 : p1.priceUSDCurrent;
                    let priceUSD0Current = (p0.priceUSDCurrent == 0 && (p1.priceUSDCurrent == 1)) ? dexRec.lp1 / dexRec.lp0 : p0.priceUSDCurrent;
                    let issuance = dexRec.issuance;
                    let x0 = dexRec.lp0 / issuance;
                    let x1 = dexRec.lp1 / issuance;
                    res.priceUSD = x0 * priceUSD0 + x1 * priceUSD1;
                    res.priceUSDCurrent = x0 * priceUSD0Current + x1 * priceUSD1Current;
                    if (q.val) res.valUSD = q.val * res.priceUSD
                    if (q.chainID == paraTool.chainIDParallel || q.chainID == paraTool.chainIDHeiko) {
                        //console.log(`MK!!! p0`, p0);
                        //console.log(`MK!!! p1`, p1);
                        //console.log(`MK!!! ts=${ts}, x0=${x0}, x1=${x1}, priceUSD0=${priceUSD0}, priceUSD1=${priceUSD1}, RES.priceUSD=${res.priceUSD}`, "dexRec=", dexRec, `res=`, res);
                    }
                    return res
                } else {
                    return null;
                }
            }
            break;
            case paraTool.assetTypeLoan: {
                let parsedAsset = JSON.parse(q.asset);
                if (parsedAsset.Loan !== undefined) {
                    let loanedAsset = JSON.stringify(parsedAsset.Loan);
                    res.priceUSD = await this.getTokenPriceUSD(loanedAsset, q.chainID, ts); //this is actually collateral..
                    res.priceUSDCurrent = await this.getTokenPriceUSD(loanedAsset, q.chainID); //this is actually collateral..
                    if (q.val) res.valUSD = q.val * res.priceUSD
                    return res
                }
            }
            break;
            case paraTool.assetTypeCDPSupply: {
                let parsedAsset = JSON.parse(q.asset);
                if (parsedAsset.CDP_Supply !== undefined) {
                    let suppliedAsset = JSON.stringify(parsedAsset.CDP_Supply);
                    return await this.computePriceUSD({
                        val,
                        asset: suppliedAsset,
                        chainID: q.chainID,
                        ts
                    });
                }
            }
            break;
            case paraTool.assetTypeCDPBorrow: {
                let parsedAsset = JSON.parse(q.asset);
                if (parsedAsset.CDP_Borrow !== undefined) {
                    let borrowedAsset = JSON.stringify(parsedAsset.CDP_Borrow);
                    return await this.computePriceUSD({
                        val,
                        asset: borrowedAsset,
                        chainID: q.chainID,
                        ts
                    });
                }
            }
            break;
            default: {
                if (this.debugLevel >= paraTool.debugInfo) console.log("not implemented:", assetInfo.assetType);
            }
            break;
        }
        return null;
    }

    async getDexRec(asset, chainID, ts) {
        if (ts == null) {
            let assetlog = await this.get_assetlog(asset, chainID, null, 1);
            if (assetlog, assetlog.dexRecs && Array.isArray(assetlog.dexRecs) && assetlog.dexRecs.length > 0) {
                let lastDexRec = assetlog.dexRecs[assetlog.dexRecs.length - 1]
                if (lastDexRec.dexRec != undefined) {
                    return lastDexRec.dexRec
                }
            }
            return (false);
        }
        let assetlog = await this.get_assetlog(asset, chainID);
        if (assetlog.dexRecs == undefined) {
            //console.log("FAIL2", asset);
            return (false);
        }

        let res = this.binarySearch(assetlog.dexRecs, ts, function(a, b) {
            return (a - b.ts);
        });
        //console.log("getDexRec", asset, assetlog.dexRecs, ts, res);
        if (res && res.dexRec) {
            return (res.dexRec);
        }
        return (false);
    }

    getStandardizedXCMAssetInfo(chainID, asset, rawAsset) {
        let relayChain = paraTool.getRelayChainByChainID(chainID)
        let targetChainID = chainID // the chainIDDest to use for price lookup
        let targetAsset = rawAsset // the asset to use for price lookup
        let defaultAsset = asset // the "default" asset (human readable?)
        let standardizedXCMInfo = false
        let isXcmAssetFound = false
        let decimals = false
        let symbol = null
        let xcmInteriorKey = false

        let rawassetChain = paraTool.makeAssetChain(targetAsset, targetChainID);
        //console.log(`getStandardizedXCMAssetInfo targetChainID=${targetChainID}, asset=${asset}, rawAsset=${rawAsset} rawassetChain=${rawassetChain} start`)
        if (this.assetInfo[rawassetChain] && this.assetInfo[rawassetChain].decimals != undefined && this.assetInfo[rawassetChain].symbol != undefined) {
            //console.log(`rawassetChain=${rawassetChain} here 1`)
            decimals = this.assetInfo[rawassetChain].decimals;
            symbol = this.assetInfo[rawassetChain].symbol;
            if (symbol) {
                let symbolRelayChain = paraTool.makeAssetChain(symbol, relayChain);
                let xcmAssetInfo = this.getXcmAssetInfoBySymbolKey(symbolRelayChain);
                if (xcmAssetInfo) {
                    return [true, xcmAssetInfo];
                } else {
                    console.log(`xcmSymbolKey ${symbolRelayChain} not found`)
                }
            } else {
                console.log(`symbol not found targetChainID=${targetChainID}, asset=${asset}, rawAsset=${rawAsset}`)
            }
        }
        return [false, null];
    }


    async getCDPExchangeRates(cdpBSAsset, chainID, ts) {
        let tsInt = parseInt(ts, 10);
        var compare = function(a, b) {
            return (a - b.ts);
        }
        let assetlog = await this.get_assetlog(cdpBSAsset, chainID)
        if ((assetlog !== undefined) && (assetlog.rates !== undefined)) {
            let res = this.binarySearch(assetlog.rates, tsInt, compare);
            if (res) {
                return res;
            }
        } else {
            console.log(`loanedAsset ${loanedAsset} rate not found`, assetlog)
            return [0, 0]
        }
    }

    async compute_holdings_USD(holdings, ts = false) {
        if (!ts) {
            ts = this.getCurrentTS();
        }
        let totalUSDVal = 0;
        for (const assetType of Object.keys(holdings)) {
            let assets = holdings[assetType];
            if (assets == undefined) {
                //console.log("holdings assetType:", assetType, holdings[assetType]);
                continue;
            }
            let flds = this.get_assetType_flds(assetType);
            for (let i = 0; i < assets.length; i++) {
                let holding = holdings[assetType][i];
                let usdVal = await this.decorate_assetState(holding.assetInfo, holding.state, flds, ts);
                totalUSDVal += usdVal;
            }
        }
        return totalUSDVal;
    }


    get_assetType_flds(assetType) {
        // Note: "transferable" and "balance" are synthetized from free, reserved, miscFrozen
        let assetTypesFields = {
            "Token": ["free", "reserved", "miscFrozen", "feeFrozen", "frozen", "transferable", "balance"],
            "Loan": ["collateral", "debit"],
            "CDP_Supply": ["adjustedVoucher"],
            "CDP_Borrow": ["adjustedPrincipal"],
            "LiquidityPair": ['free', "balance"],
            'ERC20LP': ['free', "balance"],
            'ERC20': ['free', "balance"],
            // TODO:
            'ERC721': [],
            'ERC1155': []
        };
        let res = assetTypesFields[assetType];
        if (res !== undefined) {
            return (res);
        }
        console.log("get_assetType_flds empty", assetType);
        return ([]);
    }


    // return debitExchangeRate for the loan
    async computeLoanedAmount(debitAmount, loanedAsset, chainID, ts) {
        let tsInt = parseInt(ts, 10);
        var compare = function(a, b) {
            return (a - b.ts);
        }
        let assetlog = await this.get_assetlog(loanedAsset, chainID)
        if ((assetlog !== undefined) && (assetlog.rates !== undefined)) {
            let res = this.binarySearch(assetlog.rates, tsInt, compare);
            if (res) {
                //console.log("Loan model: ", res.r);
                let readable_rate = res.r // already adjusted at the time we record it
                let readable_rateCurrent = (assetlog.rates.length > 0) ? assetlog.rates[assetlog.rates.length - 1].r : 0;
                let out = debitAmount * readable_rate
                return [out, readable_rate, readable_rateCurrent];
            }
        } else {
            console.log(`loanedAsset ${loanedAsset} rate not found`, assetlog)
            return [0, 0, 0]
        }
    }

    getDecorateOption(decorateExtra) {
        if (Array.isArray(decorateExtra)) {
            let decorateData = decorateExtra.includes("data")
            let decorateAddr = decorateExtra.includes("address")
            let decorateUSD = decorateExtra.includes("usd")
            let decorateRelated = decorateExtra.includes("related")
            // TODO: deep events/logs let decorateDeep = decorateExtra.includes("deep")
            return [decorateData, decorateAddr, decorateUSD, decorateRelated]
        } else if (decorateExtra == true) {
            // remove this once ready
            return [true, true, true, true]
        } else if (decorateExtra == false) {
            return [true, true, true, false]
        } else {
            //return nothing if user purposefully pass in non-matched filter
            return [false, false, false, false]
        }
    }

    mergeEventDataAndDataType(data, dataType, decorate = true, decorateExtra = ["data", "address", "usd", "related"]) {
        let [decorateData, decorateAddr, decorateUSD, decorateRelated] = this.getDecorateOption(decorateExtra)
        let dd = []
        let addrList = []
        if (!data || !data.length) return dd;
        for (var i = 0; i < data.length; i++) {
            let d = data[i]
            let x = {
                data: d,
            }
            let dt = dataType[i]
            if (dt) {
                x.typeDef = dt.typeDef
                x.name = dt.name
                if (x.typeDef == "AccountId32" || x.typeDef == "AccountId20") {
                    x.address = paraTool.getPubKey(d)
                    addrList.push(d)
                }
            }
            dd.push(x)
        }
        return [dd, addrList]
    }

    async computeExtrinsicFeeUSD(ext) {
        let feeUSD = null
        try {
            let fee = ext.fee // adjusted with decimals
            let ts = ext.ts
            if (fee == 0) {
                return 0
            }
            let chainID = ext.chainID
            let chainSymbol = this.getChainSymbol(chainID)
            let chainDecimals = this.getChainDecimal(chainID)
            let targetAsset = `{"Token":"${chainSymbol}"}`
            let p = await this.computePriceUSD({
                val: fee,
                asset: targetAsset,
                chainID: chainID,
                ts: ts
            })
            if (p) {
                feeUSD = p.priceUSD * fee
            }
        } catch (e) {
            return null
        }
        return feeUSD
    }

    generateTransferSummary(pallet_method, addressList, decodedData) {
        let isTransferType = false
        var incrementList = [
            "balances:Deposit", "balances:Endowed",
            "assets:Issued",
            "currencies:Deposited", "tokens:Deposited", "tokens:Endowed"
        ]
        var decrementList = [
            "balances:DustLost", "balances:Withdraw", "balances:Slashed",
            "assets:Burned",
            "currencies:Withdrawn", "tokens:Deposited", "tokens:DustLost"
        ]
        var transferList = [
            "balances:Transfer",
            "assets:Transferred",
            "currencies:Transferred", "tokens:Transfer"
        ]

        var revokeList = [
            "assets:ApprovalCancelled"
        ]

        var approvalList = [
            "assets:ApprovedTransfer"
        ]

        //write from, to for transfer events
        let transferSummary = {
            from_ss58: null,
            from_pubkey: null,
            to_ss58: null,
            to_pubkey: null,
            type: "nontransfer"
        }
        let eventLen = decodedData.length
        switch (addressList.length) {
            case 2:
                transferSummary.from_ss58 = addressList[0]
                transferSummary.from_pubkey = paraTool.getPubKey(addressList[0])
                transferSummary.to_ss58 = addressList[1]
                transferSummary.to_pubkey = paraTool.getPubKey(addressList[1])
                if (transferList.includes(pallet_method)) {
                    transferSummary.type = "transfer"
                } else if (approvalList.includes(pallet_method)) {
                    transferSummary.type = "approval"
                } else if (revokeList.includes(pallet_method)) {
                    transferSummary.type = "revoke"
                }
                break;
            case 1:
                if (incrementList.includes(pallet_method)) {
                    transferSummary.to_ss58 = addressList[0]
                    transferSummary.to_pubkey = paraTool.getPubKey(addressList[0])
                    transferSummary.type = "incoming"
                } else if (decrementList.includes(pallet_method)) {
                    transferSummary.from_ss58 = addressList[0]
                    transferSummary.from_pubkey = paraTool.getPubKey(addressList[0])
                    transferSummary.type = "outgoing"
                }
            default:
        }
        if (addressList.length > 0) {
            decodedData.push(transferSummary)
            isTransferType = true
        }
        return [decodedData, isTransferType]
    }

    extractTransferInfo(decodedData) {
        //console.log(`extractTransferInfo`, decodedData)
        let dData = decodedData
        let t = {
            from_ss58: null,
            from_pub_key: null,
            to_ss58: null,
            to_pub_key: null,
            amount: null,
            raw_amount: null,
            asset: null,
            price_usd: null,
            amount_usd: null,
            symbol: null,
            decimals: null,
            transferType: "nontransfer"
        }
        if (Array.isArray(dData) && dData.length >= 2) {
            let assetSummary = dData.shift() // always the first element
            let transferSummary = dData.pop() // always the last element
            let transferTypeList = ['transfer', 'approval', 'revoke', 'incoming', 'outgoing']
            // extra transferType, from, to
            if (transferSummary.type != undefined && transferTypeList.includes(transferSummary.type)) {
                t.transferType = transferSummary.type
                t.from_ss58 = (transferSummary.from_ss58 != undefined) ? transferSummary.from_ss58 : '0x0',
                    t.to_ss58 = (transferSummary.to_ss58 != undefined) ? transferSummary.to_ss58 : '0x0',
                    t.from_pub_key = (transferSummary.from_pubkey != undefined) ? transferSummary.from_pubkey : '0x0',
                    t.to_pub_key = (transferSummary.to_pubkey != undefined) ? transferSummary.to_pubkey : '0x0'
            }

            // extract decimals, symbol, asset
            if (assetSummary.decimals != undefined) t.decimals = assetSummary.decimals
            if (assetSummary.symbol != undefined) t.symbol = assetSummary.symbol
            if (assetSummary.assetChain != undefined) {
                let [assetUnparsed, _] = paraTool.parseAssetChain(assetSummary.assetChain)
                if (assetUnparsed) {
                    t.asset = assetUnparsed
                }
            }
            // extract amount, raw_amount, price_usd, amount_usd for remaining dData, ideally one element only
            for (const dData_i of dData) {
                // TODO: check eq case later
                if (dData_i.data != undefined && dData_i.typeDef != undefined && dData_i.typeDef == 'u128') {
                    if (dData_i.data != undefined && typeof dData_i.data === 'string') t.raw_amount = dData_i.data
                    if (dData_i.dataRaw != undefined) t.amount = dData_i.dataRaw
                    if (dData_i.dataUSD != undefined) t.amount_usd = dData_i.dataUSD
                    if (dData_i.priceUSD != undefined) t.price_usd = dData_i.priceUSD
                }
            }
        }
        //console.log(`extractTransferInfo`, t)
        return t
    }

    async paramToCalls(extrinsicID, section, method, callIndex, args, argsDef, chainID, ts, depth = '0', decorate = true, decorateExtra = ["data", "address", "usd"]) {
        let flatCalls = []
        await this.paramToCallsInternal(extrinsicID, section, method, callIndex, args, argsDef, chainID, ts, depth, flatCalls, decorate, decorateExtra)
        return flatCalls
    }

    async paramToCallsInternal(extrinsicID, section, method, callIndex, args, argsDef, chainID, ts, depth = '0', flatCalls = [], decorate = true, decorateExtra = ["data", "address", "usd"]) {
        //this.chainParserInit(chainID, this.debugLevel);
        //console.log(`paramToCallsInternal ${extrinsicID}, ${section}:${method}, callIndex=${callIndex}, depth=${depth}, arg`, args, `argsDef=${JSON.stringify(argsDef)}`)
        let [decorateData, decorateAddr, decorateUSD, decorateRelated] = this.getDecorateOption(decorateExtra)
        let sectionMethod = `${section}:${method}`
        let args_def = (argsDef != undefined) ? argsDef : null
        let call_index = (callIndex != undefined) ? callIndex : null
        //let callsArr = []
        try {
            if (args.calls != undefined) { // this is an array
                //console.log(`${depth}:${sectionMethod} descend into calls len[${args.calls.length}]`)
                let f = {
                    id: `${depth}`,
                    index: call_index,
                    section: section,
                    method: method,
                    args: args,
                    argsDef: args_def,
                    leaf: false,
                    root: (depth == '0') ? true : false
                }

                flatCalls.push(f)
                //let i = 0;
                //for (const c of args.calls) {
                for (let i = 0; i < args.calls.length; i++) {
                    let c = args.calls[i]
                    let call_section = c.section;
                    let call_method = c.method;
                    let call_lookup_index = c.callIndex;
                    let call_args = c.args
                    let call_argsDef = c.argsDef
                    let call_address = ""
                    if (c.call != undefined) {
                        let c_call = c.call
                        if (c_call.section != undefined && c_call.method != undefined && c_call.callIndex != undefined) {
                            call_lookup_index = c_call.callIndex;
                            call_section = c_call.section;
                            call_method = c_call.method;
                            call_args = c_call.args
                            call_argsDef = c_call.argsDef
                            if (chainID == paraTool.chainIDMythos) {
                                if (c.address != undefined) call_address = `@${c.address.toLowerCase()}`
                                if (c.from != undefined) call_address = `@${c.from.toLowerCase()}`
                            }
                            //console.log("MYTHOS NORMAL CASE ...", c, c_call);
                        } else {
                            console.log(`*paramToCallsInternal ${extrinsicID}, ${section}:${method}, callIndex=${callIndex}, depth=${depth}, arg`, args, `argsDef=${JSON.stringify(argsDef)}`)
                            console.log("MYTHOS MUTANT CASE !!!", c, c_call);
                            //process.exit(0);
                        }
                        //go one level deep into struct by removing call
                    }
                    let nextDepth = `${depth}-${i}${call_address}`
                    //console.log(depth, "call ", i , call_section, call_method, c);
                    //console.log(`+++ calls[${i}] nextDepth=${nextDepth} call_section=${call_section}, call_method=${call_method} call_address=${call_address}`, c)
                    //i++;
                    await this.paramToCallsInternal(extrinsicID, call_section, call_method, call_lookup_index, call_args, call_argsDef, chainID, ts, nextDepth, flatCalls, decorate, decorateExtra)
                }
            } else if (args.call != undefined) { // this is an object
                let call = args.call
                let call_section = call.section;
                let call_method = call.method;
                let call_lookup_index = call.callIndex;
                let call_address = ""
                //console.log(`AAA ${depth}:${sectionMethod} descend into call`, call)
                if (chainID == paraTool.chainIDMythos) {
                    if (args.address != undefined) call_address = `@${args.address.toLowerCase()}`
                    if (args.from != undefined) call_address = `@${args.from.toLowerCase()}`
                }
                let f = {
                    id: `${depth}`,
                    index: call_index,
                    section: section,
                    method: method,
                    args: args,
                    argsDef: args_def,
                    leaf: false,
                    root: (depth == '0') ? true : false
                }
                flatCalls.push(f)
                let nextDepth = `${depth}-0${call_address}`
                //console.log(`BBB call nextDepth=${nextDepth} call_section=${call_section}, call_method=${call_method}`, call)
                await this.paramToCallsInternal(extrinsicID, call_section, call_method, call_lookup_index, call.args, call.argsDef, chainID, ts, nextDepth, flatCalls, decorate, decorateExtra)
            } else {
                //collect leaf node here
                let f = {
                    id: `${depth}`,
                    index: call_index,
                    section: section,
                    method: method,
                    args: args,
                    argsDef: args_def,
                    leaf: true,
                    root: (depth == '0') ? true : false
                }
                flatCalls.push(f)
                let pallet_method = `${section}:${method}`
                //console.log(`${depth}:${sectionMethod} DONE, ${pallet_method}`, args)
                //await this.chainParser.decorate_query_params(this, pallet_method, args, chainID, ts, 0, decorate, decorateExtra)
            }
        } catch (err) {
            console.log(err);
            //process.exit(1)
            this.logger.error({
                "op": "query.paramToCallsInternal",
                "extrinsicID": extrinsicID,
                section,
                method,
                args,
                chainID,
                err
            });
        }
    }

    async decorateEvent(event, chainID, ts, decorate = true, decorateExtra = ["data", "address", "usd", "related"], isUI = true) {
        let [decorateData, decorateAddr, decorateUSD, decorateRelated] = this.getDecorateOption(decorateExtra)
        if (!decorate || !decorateData) return event

        let dEvent = event
        let [decodedData, addressList] = this.mergeEventDataAndDataType(event.data, event.dataType, decorate, decorateExtra)

        let [pallet, method] = paraTool.parseSectionMethod(event)
        let pallet_method = `${pallet}:${method}`
        let isTransferType = false

        switch (pallet_method) {

            /*
            balances, tokens, assets, curriencies
            Principal:
            symbol, decimals should be queriable at data[0]
            balance should be queriable at data[length(originDataLen-1)]
            transferSummer should be queriable at appendex extra

            */
            case "treasury:Awarded": //balance, accountID
            case "treasury:Burnt": //bal
            case "treasury:Deposit": //bal
            case "treasury:Proposed": //ProposalIndex
            case "treasury:Rejected": //ProposalIndex, bal
            case "treasury:Rollover": //bal
            case "treasury:Spending": //bal

            case "balances:BalanceSet": //
            case "balances:Deposit":
            case "balances:DustLost":
            case "balances:Endowed":
            case "balances:ReserveRepatriated":
            case "balances:Reserved":
            case "balances:Slashed":
            case "balances:Transfer":
            case "balances:Unreserved":
            case "balances:Withdraw":

                //a list where balance is not at last index
                let exceptionList = ["balances:BalanceSet", "balances:ReserveRepatriated", "treasury:Awarded", "treasury:Proposed", "treasury:Rejected"]
                let idxs = []
                let primaryIdx = false
                //some balance events have different inputs (i.e. BalanceSet, ReserveRepatriated, Awarded, Proposed, Rejected)
                if (exceptionList.includes(pallet_method)) {
                    if (pallet_method == "balances:BalanceSet") {
                        idxs.push(event.data.length - 1)
                        idxs.push(event.data.length - 2)
                    }
                    if (pallet_method == "balances:ReserveRepatriated") {
                        //status is the last input
                        idxs.push(event.data.length - 2)
                    }
                    if (pallet_method == "treasury:Awarded") {
                        idxs.push(event.data.length - 2)
                    }
                    if (pallet_method == "treasury:Proposed") {
                        //TODO: how to process ProposalIndex?
                    }
                    if (pallet_method == "treasury:Rejected") {
                        //TODO: how to process ProposalIndex?
                        idxs.push(event.data.length - 1)
                    }

                } else {
                    // bal is ususally the last input
                    idxs.push(event.data.length - 1)
                }

                let commonBalanceDataIdx = 0
                var chainSymbol = this.getChainSymbol(chainID)
                var chainDecimals = this.getChainDecimal(chainID)
                var targetAsset = `{"Token":"${chainSymbol}"}`

                //NOTE: we will dual represent asset info in both bal and assetID fields
                if (chainSymbol && chainDecimals !== false) {
                    decodedData[commonBalanceDataIdx].symbol = chainSymbol
                    decodedData[commonBalanceDataIdx].decimals = chainDecimals
                    decodedData[commonBalanceDataIdx].assetChain = paraTool.makeAssetChain(targetAsset, chainID)
                    decodedData[commonBalanceDataIdx].knownAsset = 1
                } else {
                    decodedData[commonBalanceDataIdx].knownAsset = 0
                }

                //console.log("targetAsset", targetAsset)
                for (const idx of idxs) {
                    let dataVal = event.data[idx]
                    try {
                        let bal = paraTool.toBn(dataVal)
                        decodedData[idx].data = bal.toString() // convert dec, '0x...' to 'intStr'
                        bal = bal / 10 ** chainDecimals // always get here
                        if (decorateUSD) {
                            let p = await this.computePriceUSD({
                                val: bal,
                                asset: targetAsset,
                                chainID,
                                ts
                            })
                            decodedData[idx].symbol = chainSymbol
                            decodedData[idx].dataRaw = bal
                            if (p) {
                                decodedData[idx].dataUSD = p.valUSD
                                decodedData[idx].priceUSD = p.priceUSD
                                if (isUI) decodedData[idx].priceUSDCurrent = p.priceUSDCurrent
                            }
                        } else {
                            decodedData[idx].symbol = chainSymbol
                            decodedData[idx].dataRaw = bal
                        }
                    } catch (err) {
                        // console.log
                    }
                }
                [decodedData, isTransferType] = this.generateTransferSummary(pallet_method, addressList, decodedData)
                //console.log(`decodedEvent: ${pallet_method}, extra`, decodedData)
                break;

            case "crowdloan:Contributed": //accountID, paraID, balance
            {
                let paraInfo = this.getParaInfo(event.data[1], chainID)
                decodedData[1].projectName = paraInfo.name
                decodedData[1].relayChain = paraInfo.relayChain
                var chainSymbol = this.getChainSymbol(chainID)
                var chainDecimals = this.getChainDecimal(chainID)
                var targetAsset = `{"Token":"${chainSymbol}"}`

                let dataVal = event.data[2]
                var bal = paraTool.toBn(dataVal)
                //var bal = paraTool.dechexToInt(event.data[2])
                decodedData[2].data = bal.toString() // convert dec, '0x...' to 'intStr'
                bal = bal / 10 ** chainDecimals // always get here
                if (decorateUSD) {
                    var p = await this.computePriceUSD({
                        val: bal,
                        asset: targetAsset,
                        chainID,
                        ts
                    })
                    decodedData[2].symbol = chainSymbol
                    decodedData[2].dataRaw = bal
                    if (p) {
                        decodedData[2].dataUSD = p.valUSD
                        decodedData[2].priceUSD = p.priceUSD
                        if (isUI) decodedData[2].priceUSDCurrent = p.priceUSDCurrent
                    }
                } else {
                    decodedData[2].symbol = chainSymbol
                    decodedData[2].dataRaw = bal
                }
            }
            break;

            case "assets:Transferred": //assetID, from, to, balance
            case "assets:Burned": // assetID, owner, balance
            case "assets:Issued": // assetID, owner, balance

            case "assets:ApprovalCancelled": //assetID, source, delegate (NO Balance)
            case "assets:ApprovedTransfer": //assetID, source, delegate, balance
            case "assets:Created": //assetID, creator, owner
                //case "assets:ForceCreated":??
            case "assets:MetadataSet": //assetID, name, symbol, decimals, isFrozen
            case "assets:TeamChanged": //assetID, issuer, admin, freezer

                //a list where balance is not at last index
                let aExceptionList = ["assets:ApprovalCancelled", "assets:Created", "assets:MetadataSet", "assets:TeamChanged"]
                let aIdxs = []
                //some balance events have different inputs (i.e. BalanceSet, ReserveRepatriated, Awarded, Proposed, Rejected)
                if (aExceptionList.includes(pallet_method)) {
                    //These events has no balances
                } else {
                    // bal is ususally the last input
                    aIdxs.push(event.data.length - 1)
                }

                let assetIDDataIdx = 0
                let assetID = event.data[assetIDDataIdx]
                let assetIDBNStr;
                let assetIDChain;
                try {
                    let assetIDBN = paraTool.toBn(assetID)
                    assetIDBNStr = assetIDBN.toString()
                    assetIDChain = paraTool.makeAssetChain(`{"Token":"${assetIDBNStr}"}`, chainID)
                } catch (e) {
                    console.log(`decodedEvent: ${pallet_method} e`, e)
                }

                let assetTarget = false;
                let [assetIDSymbol, assetIDDecimals, assetIDString] = this.chainParser.getGenericSymbolAndDecimal(this, assetID, chainID)
                if (assetIDSymbol && assetIDDecimals !== false) {
                    assetTarget = `{"Token":"${assetIDSymbol}"}`
                }

                //NOTE: we will dual represent asset info in both bal and assetID fields
                if (assetIDSymbol && assetIDDecimals !== false) {
                    decodedData[assetIDDataIdx].symbol = assetIDSymbol
                    decodedData[assetIDDataIdx].decimals = assetIDDecimals
                    decodedData[assetIDDataIdx].dataRaw = assetIDBNStr
                    decodedData[assetIDDataIdx].assetChain = assetIDChain
                    decodedData[assetIDDataIdx].knownAsset = 1
                } else {
                    decodedData[assetIDDataIdx].knownAsset = 0
                }

                for (const idx of aIdxs) {
                    let dataVal = event.data[idx]
                    let bal = paraTool.toBn(dataVal)
                    decodedData[idx].data = bal.toString() // convert dec, '0x...' to 'intStr'
                    //var bal = paraTool.dechexToInt(dataVal) //
                    if (assetIDSymbol && assetIDDecimals !== false) {
                        bal = bal / 10 ** assetIDDecimals
                        decodedData[idx].symbol = assetIDSymbol
                        decodedData[idx].decimals = assetIDDecimals
                        decodedData[idx].dataRaw = bal
                        decodedData[idx].knownAsset = 1
                    } else {
                        decodedData[idx].knownAsset = 0
                    }
                    if (decorateUSD && assetTarget) {
                        let p = await this.computePriceUSD({
                            val: bal,
                            asset: assetTarget,
                            chainID,
                            ts
                        })
                        if (p) {
                            decodedData[idx].dataUSD = p.valUSD
                            decodedData[idx].priceUSD = p.priceUSD
                            if (isUI) decodedData[idx].priceUSDCurrent = p.priceUSDCurrent
                        }
                    }
                }
                [decodedData, isTransferType] = this.generateTransferSummary(pallet_method, addressList, decodedData)
                //console.log(`decodedEvent: ${pallet_method}, extra`, decodedData)
                break;



            case "currencies:Deposited": //currencyID, who, balance
            case "currencies:Transferred": //currencyID, from, to, balance
            case "currencies:Withdrawn": //currencyID, who, balance

            case "tokens:Transfer": //currencyID, from, to, balance
            case "tokens:Withdrawn": //currencyID, who, balance
            case "tokens:Deposited": //currencyID, who, balance
            case "tokens:Endowed": //currencyID, who, balance
            case "tokens:DustLost": //currencyID, who, balance

                /*
                            case "tokens:BalanceSet":
                            case "tokens:LockRemoved":
                            case "tokens:LockSet": //LockIdentifier, currencyID, AccountId, balance
                            case "tokens:Reserved":
                            case "tokens:Slashed":
                            case "tokens:Unreserved":
                */
                //a list where balance is not at last index
                let tExceptionList = []
                let tIdxs = []
                //some balance events have different inputs (i.e. BalanceSet, ReserveRepatriated, Awarded, Proposed, Rejected)
                if (tExceptionList.includes(pallet_method)) {
                    //These events has no balances
                } else {
                    // bal is ususally the last input
                    tIdxs.push(event.data.length - 1)
                }

                let tokenIDDataIdx = 0
                let rAsset = event.data[tokenIDDataIdx]
                if (rAsset.dexShare != undefined) rAsset = rAsset.dexShare
                if (rAsset.dEXShare != undefined) rAsset = rAsset.dEXShare

                let tokenTarget = false;
                let tokenIDChain = null,
                    rawAssetSymbol = null,
                    rawAssetDecimals = null,
                    rawAssetString = null;
                try {
                    [rawAssetSymbol, rawAssetDecimals, rawAssetString] = this.chainParser.getGenericSymbolAndDecimal(this, rAsset, chainID)
                    //console.log(`rawAssetSymbol=${rawAssetSymbol}, rawAssetDecimals=${rawAssetDecimals}, rawAssetString=${rawAssetString}, rAsset`, rAsset)
                    tokenIDChain = paraTool.makeAssetChain(`${JSON.stringify(rAsset)}`, chainID)
                } catch (merr) {
                    console.log("this.chainParser.getGenericSymbolAndDecimal", rAsset, merr)
                }
                if (rAsset.token != undefined || rAsset.Token != undefined) {
                    let symbol = rawAssetSymbol
                    tokenTarget = `{"Token":"${symbol}"}`
                    tokenIDChain = paraTool.makeAssetChain(tokenTarget, chainID)
                } else if (rawAssetSymbol && rawAssetDecimals !== false) {
                    tokenTarget = rawAssetString
                } else {
                    // NOT COVERED (dexShare)
                    console.log(`not covered`, pallet_method, rAsset)
                }
                //NOTE: we will dual represent asset info in both bal and assetID fields
                if (rawAssetSymbol && rawAssetDecimals !== false) {
                    decodedData[tokenIDDataIdx].symbol = rawAssetSymbol
                    decodedData[tokenIDDataIdx].decimals = rawAssetDecimals
                    decodedData[tokenIDDataIdx].assetChain = tokenIDChain
                    decodedData[tokenIDDataIdx].knownAsset = 1
                } else {
                    decodedData[tokenIDDataIdx].knownAsset = 0
                }

                for (const idx of tIdxs) {
                    let dataVal = event.data[idx]
                    let bal = paraTool.toBn(dataVal)
                    decodedData[idx].data = bal.toString() // convert dec, '0x...' to 'intStr'
                    //var bal = paraTool.dechexToInt(dataVal) //
                    if (rawAssetSymbol && rawAssetDecimals !== false) {
                        bal = bal / 10 ** rawAssetDecimals
                        decodedData[idx].symbol = rawAssetSymbol
                        decodedData[idx].decimals = rawAssetDecimals
                        decodedData[idx].dataRaw = bal
                        decodedData[idx].knownAsset = 1
                    } else {
                        decodedData[idx].knownAsset = 0
                    }
                    if (decorateUSD && tokenTarget) {
                        let p = await this.computePriceUSD({
                            val: bal,
                            asset: tokenTarget,
                            chainID,
                            ts
                        })
                        if (p) {
                            decodedData[idx].dataUSD = p.valUSD
                            decodedData[idx].priceUSD = p.priceUSD
                            if (isUI) decodedData[idx].priceUSDCurrent = p.priceUSDCurrent
                        }
                    }
                }
                [decodedData, isTransferType] = this.generateTransferSummary(pallet_method, addressList, decodedData)
                //console.log(`decodedEvent: ${pallet_method}, extra`, decodedData)
                break;
        }
        if (decorateData && dEvent) dEvent.decodedData = decodedData
        return [dEvent, isTransferType]
    }

    async decorate_assetState(assetInfo, state, flds, ts) {
        if (state.balanceUSD) {
            return state.balanceUSD;
        }

        let targetAsset = assetInfo.asset;
        let totalUSDVal = 0;
        for (const fld of flds) {
            if (fld == "balance") {
                // balance = free + reserved
                let free = state["free"] ? state["free"] : 0;
                let reserved = state["reserved"] ? state["reserved"] : 0;
                state["balance"] = free + reserved;
            } else if (fld == "transferable") {
                // transferable = free - miscFrozen
                let free = state["free"] ? state["free"] : 0;
                let miscFrozen = state["miscFrozen"] ? state["miscFrozen"] : 0;
                state["transferable"] = free - miscFrozen;
            }
            if (state[fld] || (fld == "debit")) {
                let val = state[fld];
                let assetType = assetInfo.assetType;
                let chainID = assetInfo.chainID;
                if (assetType == paraTool.assetTypeCDPSupply && fld == "adjustedVoucher") {
                    let adjustedVoucher = state["adjustedVoucher"];
                    let rates = await this.getCDPExchangeRates(targetAsset, chainID, ts);
                    val = adjustedVoucher * rates.r;
                    state["supplied"] = val
                } else if (assetType == paraTool.assetTypeCDPBorrow && fld == "adjustedPrincipal") {
                    let adjustedPrincipal = state["adjustedPrincipal"]
                    let rates = await this.getCDPExchangeRates(targetAsset, chainID, ts);
                    val = adjustedPrincipal * rates.b;
                    state["borrowed"] = val
                } else if (assetType == "Loan" && fld == "debit") {
                    let loanedAsset = assetInfo.asset;
                    let debitAmount = state["debit"]

                    let [borrowedAmount, exchangeRate, exchangeRateCurrent] = await this.computeLoanedAmount(debitAmount, loanedAsset, chainID, ts)
                    state["exchangeRate"] = exchangeRate
                    state["exchangeRateCurrent"] = exchangeRateCurrent
                    //let suppliedAsset = state["suppliedAsset"]
                    //let borrowedAsset = state["borrowedAsset"]
                    targetAsset = (chainID == paraTool.chainIDKarura) ? '{"Token":"KUSD"}' : '{"Token":"AUSD"}' // hard-coded ausd for now..
                    state['borrowedAsset'] = JSON.parse(targetAsset) //fix it here until we fixed the bt

                    if (debitAmount > 0) {
                        val = borrowedAmount
                        state["borrowed"] = val
                    } else {
                        //skip further decoration when debit is 0
                        continue
                    }
                } else if (assetType == "Loan" && fld == "collateral") {
                    //can't compute  {"Loan":{"Token":"ACA"}}. using suppliedAsset instead{"Token":"ACA"}
                    targetAsset = JSON.stringify(state['suppliedAsset'])
                }

                let p = await this.computePriceUSD({
                    val,
                    asset: targetAsset,
                    chainID: chainID,
                    ts
                });
                //console.log("COMPUTEPRICEUSD",targetAsset, chainID, p);
                if (p) {
                    let rate = p.priceUSD;
                    state[fld + "USD"] = p.valUSD;
                    if (assetType == "Loan" && fld == "collateral") {
                        state["collateralAssetRate"] = rate;
                        state["rate"] = rate; // remove this after UI is updated
                    } else if (assetType == "Loan" && fld == "debit") {
                        state["borrowedAssetRate"] = rate;
                    } else {
                        state["rate"] = rate;
                    }
                    if (state["adjustedVoucherUSD"] !== undefined) {
                        state["balanceUSD"] = state["adjustedVoucherUSD"];
                        totalUSDVal += state["balanceUSD"];
                    } else if (state["adjustedPrincipalUSD"] !== undefined) {
                        state["adjustedPrincipalUSD"] = -state["adjustedPrincipalUSD"];
                        state["balanceUSD"] = state["adjustedPrincipalUSD"];
                        totalUSDVal += state["balanceUSD"];
                    } else if (state["borrowedUSD"] !== undefined && state["collateralUSD"] !== undefined) {
                        state["balanceUSD"] = state["collateralUSD"] - state["borrowedUSD"];
                        state["collateralRatio"] = state["collateralUSD"] / state["borrowedUSD"];
                        totalUSDVal += state["balanceUSD"];
                    } else if (assetType == "Loan") {
                        // covered by the above
                    } else if (assetType == "Token") {
                        if (fld == "balance") {
                            totalUSDVal += p.valUSD
                        }
                    } else {
                        totalUSDVal += p.valUSD
                    }
                } else {
                    // console.log(`MISSING ${fld}`, targetAsset);
                }
            }
        }
        return totalUSDVal;
    }

    filterRelated(related) {
        return related.filter((r) => {
            if (r.accountType == undefined) return false;
            if (r.accountType == "proxyDelegateOf") return true;
            if (r.accountType == "multisig") return true;
            return false;
        })
    }

    decorateAddresses(c, fld, decorateAddr = true, decorateRelated = true) {
        let res = [];
        let nhits = 0;
        try {
            if (!decorateAddr && !decorateRelated) return (false)
            if (c[fld] == undefined) return (false);
            if (!Array.isArray(c[fld])) return (false);

            for (const id of c[fld]) {
                // nickname, judgements, info, judgementsKSM, infoKSM, verified, verifyDT, numFollowers, numFollowing
                let address = paraTool.getPubKey(id);
                let hit = false;
                let o = {};
                if (address) {
                    let a = this.lookup_account(address);
                    if (a == null) {

                    } else {
                        if (decorateAddr) {
                            if (a.nickname != null && a.verified > 0) {
                                o['nickname'] = a.nickname;
                                hit = true;
                            }
                            if (a.info != null) {
                                o['info'] = a.info;
                                o['judgements'] = a.judgements;
                                hit = true;
                            } else if (a.infoKSM != null) {
                                o['info'] = a.infoKSM;
                                o['judgements'] = a.judgementsKSM;
                                hit = true;
                            }
                        }
                        if (a.related != undefined && decorateRelated) {
                            o['related'] = this.filterRelated(a.related);
                        }
                    }
                }
                res.push(o);
                if (hit) {
                    nhits++;
                }
            }
        } catch (e) {
            console.log(`decorateAddress err`, e.toString())
            return
        }
        if (nhits > 0) {
            c[fld + "_decorated"] = res;
        }
    }

    decorateAddress(c, fld, decorateAddr = true, decorateRelated = true) {
        let hit = false;
        try {
            if (!decorateAddr && !decorateRelated) return (false)
            if (c[fld] == undefined) return (false)
            let a = this.lookup_account(c[fld]);
            if (a == null) return (false);
            // nickname, judgements, info, judgementsKSM, infoKSM, verified, verifyDT, numFollowers, numFollowing
            if (a.related != undefined && decorateRelated) {
                c[fld + '_related'] = this.filterRelated(a.related);
            }
            if (decorateAddr) {
                if (a.nickname != null && a.verified > 0) {
                    c[fld + '_nickname'] = a.nickname;
                    hit = true;
                }
                if (a.parentDisplay != null && a.subName) {
                    c[fld + '_subIdentityName'] = `${a.parentDisplay}/${a.subName}`;
                    c[fld + '_parent'] = a.parent;
                    hit = true;
                } else if (a.parentDisplayKSM != null && a.subNameKSM) {
                    c[fld + '_subIdentityName'] = `${a.parentDisplayKSM}/${a.subNameKSM}`;
                    c[fld + '_parent'] = a.parentKSM;
                    hit = true;
                }
                if (a.info != null) {
                    if (a.display != null) c[fld + '_display'] = a.display;
                    c[fld + '_info'] = a.info;
                    c[fld + '_judgements'] = a.judgements;
                    hit = true;
                } else if (a.infoKSM != null) {
                    if (a.displayKSM != null) c[fld + '_display'] = a.displayKSM;
                    c[fld + '_info'] = a.infoKSM;
                    c[fld + '_judgements'] = a.judgementsKSM;
                    hit = true;
                }
            }
        } catch (e) {
            console.log(`decorateAddress err`, e.toString())
        }
        return (hit);
    }

    async decorateArgsAsset(args, fld, fldasset, chainID, ts, decorateUSD = true) {
        if (args[fldasset] == undefined) return;
        if (args[fld] == undefined) return;
        try {
            let val = args[fld];
            let rawAsset = args[fldasset]
            if (rawAsset.token == undefined) return;
            let symbol = rawAsset.token
            let targetAsset = JSON.stringify({
                "Token": symbol
            })
            let decimals = this.getAssetDecimal(targetAsset, chainID)
            args[fld + "_symbol"] = symbol
            if (decorateUSD) {
                let p = await this.computePriceUSD({
                    val,
                    asset: targetAsset,
                    chainID: chainID,
                    ts
                });
                if (p) {
                    args[fld + "_USD"] = p.valUSD
                    args[fld + "_priceUSD"] = p.priceUSD
                    args[fld + "_priceUSDCurrent"] = p.priceUSDCurrent
                }
            }
        } catch (err) {
            console.log(err)
        }
    }

    async decorateArgsChainAsset(args, fld, chainID, ts, decorateUSD = true) {
        var decimals = this.getChainDecimal(chainID)
        if (args[fld] == undefined) return;
        let val = args[fld] / 10 ** decimals;
        let targetAsset = this.getChainAsset(chainID)
        if (targetAsset == null) return;
        let symbol = this.getChainSymbol(chainID)

        args[fld + "_symbol"] = symbol
        if (decorateUSD) {
            let p = await this.computePriceUSD({
                val,
                asset: targetAsset,
                chainID,
                ts
            });
            if (p) {
                args[fld + "_USD"] = p.valUSD
                args[fld + "_priceUSD"] = p.priceUSD
                args[fld + "_priceUSDCurrent"] = p.priceUSDCurrent
            }
        }
    }

    /* async decorateArgsPubKey(args, fld) {
        if (args[fld] == undefined) return;
        if (Array.isArray(args[fld])) {
            let ids = uiTool.presentDests(args[fld])
            let pubkeys = ids.map((id) => {
                return paraTool.getPubKey(id);
            })
            args[fld + "_pubkey"] = pubkeys;
        } else {
            let id = uiTool.presentDest(args[fld])
            if (!id) return;
            let pubkey = paraTool.getPubKey(id);
            if (pubkey) {
                args[fld + "_pubkey"] = pubkey;
            }
        }
    } */

    async decorateArgsCurrency(args, fld) {
        if (args[fld] == undefined) return;
        args[fld + "_symbol"] = uiTool.presentCurrency(args[fld])
    }

    async decorateArgsPath(args, fld) {
        if (args[fld] == undefined) return;
        args[fld + "_decorated"] = uiTool.presentPath(args[fld]);
    }

    async decorateArgsAssets(args, fld) {
        if (args[fld] == undefined) return;
        args[fld + "_symbol"] = uiTool.presentAssets(args[fld]);
    }

    async decorateArgsAssets(args, fld) {
        if (args[fld] == undefined) return;
        args[fld + "_decorated"] = uiTool.presentInfo(args[fld])
    }

    async decorateArgsTS(args, fld) {
        if (args[fld] == undefined) return;
        args[fld + "_decorated"] = uiTool.presentMS(args[fld])
    }

    async decorateArgsRemark(args, fld) {
        if (args[fld] == undefined) return;
        args[fld + "_decorated"] = uiTool.presentRemark(args[fld])
    }

    async decorateArgsParainfo(args, fld, chainID) {
        if (args[fld] == undefined) return;
        args[fld + "_parainfo"] = this.getParaInfo(args[fld], chainID)
    }
    async decorateArgsInfo(args, fld) {
        if (args[fld] == undefined) return;
        args[fld + "_info"] = uiTool.presentInfo(args[fld])
    }

    async decorateParams(pallet, method, args, chainID, ts) {
        let pallet_method = `${pallet}:${method}`
        this.chainParser.decorate_query_params(this, pallet_method, args, chainID, ts)

        return args
    }

    // Msg parsing
    get_concrete_assetChain(analysis, c, chainID, chainIDDest) {
        let paraID = paraTool.getParaIDfromChainID(chainID)
        let paraIDDest = paraTool.getParaIDfromChainID(chainIDDest)
        let relayChain = paraTool.getRelayChainByChainID(chainID)
        let relayChainID = paraTool.getRelayChainID(relayChain)

        if (c.parents !== undefined && c.interior !== undefined) {
            let parents = c.parents;
            let interior = c.interior;
            let interiorType = Object.keys(interior)[0]

            if (interiorType == 'here') {
                /*
                  parents: 0 -> referring to itself
                  parents: 1 -> referring to parents (relaychain)
                */
                try {
                    let targetAssetChain = (parents == 0) ? this.getNativeChainAsset(chainIDDest) : this.getNativeChainAsset(relayChainID)
                    if (targetAssetChain == undefined) {
                        //console.log(`get_concrete_assetChain missing!!! parents=${parents}, chainID=${chainID}, chainIDDest=${chainIDDest}, relayChain=${relayChain}, relayChainID=${relayChainID}, targetAssetChain=${targetAssetChain}`)
                        return [false, false]
                    }
                    let [targetAsset, targetChainID] = paraTool.parseAssetChain(targetAssetChain)
                    let targetSymbol = this.getAssetSymbol(targetAsset, targetChainID)
                    let symbolRelayChain = paraTool.makeAssetChain(targetSymbol, relayChain);
                    let xcmAssetInfo = this.getXcmAssetInfoBySymbolKey(symbolRelayChain)
                    let xcmInteriorKey = (xcmAssetInfo == false || xcmAssetInfo == undefined || xcmAssetInfo.xcmInteriorKey == undefined) ? false : xcmAssetInfo.xcmInteriorKey
                    //console.log(`[paranets=${parents}] ${chainID} ${chainIDDest} ${JSON.stringify(interior)} -> ${targetAssetChain}, symbolRelayChain=${symbolRelayChain}, xcmInteriorKey=${xcmInteriorKey}, xcmAssetInfo`, xcmAssetInfo)
                    return [targetAssetChain, xcmInteriorKey]
                } catch (err) {
                    //console.log(`get_concrete_assetChain parents=${parents}, chainID=${chainID}, chainIDDest=${chainIDDest}, relayChain=${relayChain}, relayChainID=${relayChainID}, error`, err)
                    return [false, false]
                }

            } else {
                let interiorVal = interior[interiorType]
                if (parents == 1 || (chainIDDest == relayChainID)) {
                    // easy case: no expansion if it's from relaychain's perspective
                } else {
                    // expand the key
                    let new_interiorVal = []
                    let expandedParachainPiece = {
                        parachain: paraIDDest
                    }
                    new_interiorVal.push(expandedParachainPiece)
                    if (interiorType == 'x1') {
                        new_interiorVal.push(interiorVal)

                    } else if (Array.isArray(interiorVal)) {
                        //x2/x3/x4/..
                        for (const v of interiorVal) {
                            new_interiorVal.push(v)
                        }
                        //new_interiorVal.concat(interiorVal)
                    } else {
                        //console.log(`expansion error. expecting array`, JSON.stringify(interior))
                        return [false, false]
                    }
                    //console.log(`${chainID}, ${chainIDDest} [parents=${parents}] expandedkey ${JSON.stringify(interiorVal)} ->  ${JSON.stringify(new_interiorVal)}`)
                    interiorVal = new_interiorVal
                }
                let interiorVStr = JSON.stringify(interiorVal)
                let res = this.getXCMAsset(interiorVStr, relayChain)
                let xcmInteriorKey = paraTool.makeXcmInteriorKey(interiorVStr, relayChain);
                if (res) {
                    //console.log(`get_concrete_assetChain FOUND ${chainID}, ${chainIDDest} [parents=${parents}] [${interiorType}] ${JSON.stringify(interior)} -> ${res}, ${xcmInteriorKey}`)
                    return [res, xcmInteriorKey];
                } else {
                    //console.log(`get_concrete_assetChain error ${chainID}, ${chainIDDest} [parents=${parents}] [${interiorType}] ${JSON.stringify(interior)}`)
                    //return xcmInteriorKey whenever possible
                    return [false, xcmInteriorKey]
                }
            }
        } else {
            //console.log("get_concrete_assetChain FAILED2 - parents/interior not set", c);
            return [null, false];
        }
    }

    // All instructions with "MultiAsset" type should be decorated with assetChain / symbols / decimals + USD value at the time of message
    analyzeXCM_MultiAsset(analysis, c, chainID, chainIDDest, ctx) {
        //console.log(`analyzeXCM_MultiAsset, c`, c)
        if (c.id != undefined) {
            if (c.id.concrete != undefined) {
                if (ctx == "buyExecution" && false) {
                    //Not sure why skipping buyExecution here - bypass instead
                } else {
                    let [assetChain, xcmInteriorKey] = this.get_concrete_assetChain(analysis, c.id.concrete, chainID, chainIDDest);
                    if (assetChain && (analysis.assetChains[assetChain] == undefined)) {
                        analysis.assetChains[assetChain] = 1;
                        analysis.xcmInteriorKeys[xcmInteriorKey] = 1;
                        //console.log("PUSHING", assetChain, xcmInteriorKey,  c.id.concrete);
                        return [assetChain, xcmInteriorKey];
                    } else {
                        //console.log("analyzeXCM_MultiAsset MISS PROBLEM", ctx, chainID, chainIDDest, JSON.stringify(c.id.concrete));
                    }
                }
            } else {
                //console.log("analyzeXCM_MultiAsset NOT CONCRETE PROBLEM", chainID, chainIDDest, JSON.stringify(c))
            }
        } else if (c.concreteFungible != undefined) {
            let [assetChain, xcmInteriorKey] = this.get_concrete_assetChain(analysis, c.concreteFungible.id, chainID, chainIDDest);
            if (assetChain && (analysis.assetChains[assetChain] == undefined)) {
                analysis.assetChains[assetChain] = 1;
                analysis.xcmInteriorKeys[xcmInteriorKey] = 1;
                //console.log("PUSHING", assetChain, xcmInteriorKey, c.id.concrete);
                return [assetChain, xcmInteriorKey];
            } else {
                //console.log("analyzeXCM_MultiAsset V0 MISS PROBLEM", ctx, chainID, chainIDDest, JSON.stringify(c.concreteFungible.id));
            }
        } else {
            //console.log("analyzeXCM_MultiAsset NO ID PROBLEM", chainID, chainIDDest, JSON.stringify(c))
        }
        return [false, false];
    }

    //TODO: currently does not parse reserveAssetDeposited
    analyzeXCM_MultiAssetFilter(analysis, c, fld, chainID, chainIDDest, ctx) {
        //console.log(`** analyzeXCM_MultiAssetFilter, c[${fld}]`, c[fld], `c`, c)
        if (c[fld] == undefined) return;
        if (c[fld].wild) {} else if (c[fld].definite) {
            //console.log("analyzeXCM_MultiAssetFilter", chainID, chainIDDest, JSON.stringify(c[fld].definite));
        } else {
            // analyzeXCM_MultiAssetFilter 22085 2 {"definite":[{"id":{"concrete":{"parents":0,"interior":{"here":null}}},"fun":{"fungible":10000000000}}]}
            if (Array.isArray(c[fld])) {
                for (let i = 0; i < c[fld].length; i++) {
                    let [ac, xcmKey] = this.analyzeXCM_MultiAsset(analysis, c[fld][i], chainID, chainIDDest, "multiassetfilter")
                    if (ac) {
                        //console.log("analyzeXCM_MultiAssetFilter", ctx, chainID, chainIDDest, JSON.stringify(c[fld][i]), ac, xcmKey);
                    }
                }
            }
        }
    }

    // All instructions with "MultiLocation" (parachain, accountID32/ accountID20, here) should be decorated with chain.id, chain.chainName or the "identity" using lookup_account
    analyzeXCM_MultiLocation(analysis, c, fld, chainID, chainIDDest, ctx) {
        if (c[fld] == undefined) return;
        let relayChain = paraTool.getRelayChainByChainID(chainID)
        let destAddress = this.chainParser.processBeneficiary(false, c[fld], relayChain);
        if (destAddress) {
            analysis.xcmAddresses.push(destAddress)
            //console.log(`${msg.msgHash} analyzeXCM_MultiLocation destFound:${destAddress}`)
        }
    }

    analyzeXCM_Call(analysis, c, fld, chainID, chainIDDest, ctx) {
        if (c[fld] == undefined) return;
        if (c[fld].encoded != undefined) {
            // analyzeXCM_Call 22000 2 0x1801010006010f23ada31bd3bb06
            //console.log("analyzeXCM_Call", ctx, chainID, chainIDDest, c[fld].encoded)
            // extrinsicCall = apiAt.registry.createType('Call', opaqueCall);
            // ISSUE: How do we get the right api since the indexer needs the "receiving chain" api? -- can we do a mini-API call for this?
        }
    }

    getInstructionSet() {
        let instructionSet = {
            'withdrawAsset': { // Remove the on-chain asset(s) (assets) and accrue them into Holding
                MultiAssets: ['assets'],
                MultiAssetFilter: ['assets'], //v0
                Effects: ['effects'] //v0
            },
            'reserveAssetDeposited': { // Accrue into Holding derivative assets to represent the asset(s) (assets) on Origin.
                MultiAssets: ['assets']
            },
            'receiveTeleportedAsset': {
                MultiAssets: ['assets']
            },
            'queryResponse': {},
            'transferAsset': {
                MultiAssetFilter: ['assets'],
                MultiLocation: ['beneficiary'],
            },
            'transferReserveAsset': {
                MultiAsset: ['assets'],
                MultiLocation: ['destination'],
                XCM: ['xcm']
            },
            'transact': {
                Call: ['call']
            },
            'hrmpNewChannelOpenRequest': {},
            'hrmpChannelAccepted': {},
            'hrmpChannelClosing': {},
            'clearOrigin': {},
            'descendOrigin': {},
            'reportError': {},
            'depositAsset': { // Subtract the asset(s) (assets) from Holding and deposit on-chain equivalent assets under the ownership of beneficiary.
                MultiAssetFilter: ['assets'],
                MultiLocation: ['beneficiary']
            },
            'depositReserveAsset': {
                MultiAssetFilter: ['assets'],
                MultiLocation: ['beneficiary'],
                XCM: ['xcm']
            },
            'exchangeAsset': {
                MultiAssetFilter: ['give'],
                MultiAssets: ['receive']
            },
            'initiateReserveWithdraw': {
                MultiAssetFilter: ['assets'],
                XCM: ['xcm']
            },
            'initiateTeleport': {
                MultiAssetFilter: ['assets'],
                MultiLocation: ['destination'],
                XCM: ['xcm']
            },
            'queryHolding': {
                MultiLocation: ['destination'],
                MultiAssetFilter: ['assets']
            },
            'buyExecution': { //Pay for the execution of the current message from Holding.
                MultiAsset: ['fees']
            },
            'refundSurplus': {},
            'setErrorHandler': {},
            'setAppendix': {},
            'clearError': {},
            'claimAsset': {
                MultiAsset: ['assets'],
                MultiLocation: ['ticket']
            },
            'trap': {},
            'subscribeVersion': {},
            'unsubscribeVersion': {},
            'burnAsset': {
                MultiAsset: ['assets']
            },
            'expectAsset': {
                MultiAsset: ['assets']
            },
            'expectOrigin': {
                MultiLocation: ['origin']
            },
            'expectError': {},
            //V1
            'reserveAssetDeposited': {
                MultiAssetFilter: ['assets'],
                Effects: ['effects'],
            },
            //V0
            'teleportAsset': {
                MultiAsset: ['assets'],
                Effects: ['effects'],
            },
            'reserveAssetDeposit': {
                MultiAsset: ['assets'],
                Effects: ['effects'],
            }

        }
        return instructionSet
    }

    getXCMParentFingerprintsOfChild(o) {
        let fps = [];
        let xcmInstructions = [
            ["isTransferReserveAsset", "asTransferReserveAsset"],
            ["isDepositReserveAsset", "asDepositReserveAsset"],
            ["isInitiateReserveWithdraw", "asInitiateReserveWithdraw"],
            ["isInitiateTeleport", "asInitiateTeleport"],
            ["isExchangeAsset", "asExchangeAsset"]
        ];

        for (let i = 0; i < o.asV2.length; i++) {
            let instruction = o.asV2[i];
            for (let j = 0; j < xcmInstructions.length; j++) {
                let is = xcmInstructions[j][0];
                let as = xcmInstructions[j][1];
                if (instruction[is]) {
                    let o2 = instruction[as];
                    if (o2.xcm != undefined) {
                        for (let k = 0; k < o2.xcm.length; k++) {
                            let fp = o2.xcm[k].toHex();
                            //console.log("CHILD", as, k, o2.xcm[k].toHex(), JSON.stringify(o2.xcm[k].toJSON()));
                            fps.push(fp);
                        }
                    }
                }
            }
        }

        return fps;
    }

    getXCMChildFingerprints(o) {
        let fps = [];
        for (let i = 0; i < o.asV2.length; i++) {
            let instruction = o.asV2[i];
            let fp = instruction.toHex();
            //console.log(instruction.toJSON(), instruction.toHex());
            fps.push(fp);
        }
        return fps;
    }

    compute_fingerprints_inclusion(fp0, fp1) {
        // cnt0 = # of elements of fp0 in fp1
        let cnt0 = 0;
        for (let i = 0; i < fp0.length; i++) {
            if (fp1.includes(fp0[i])) {
                cnt0++;
            }
        }
        // cnt1 = # of elements of fp1 in fp0
        let cnt1 = 0;
        for (let i = 0; i < fp1.length; i++) {
            if (fp0.includes(fp0[i])) {
                cnt1++;
            }
        }
        if (cnt0 == fp0.length) return (true);
        if (cnt1 == fp1.length) return (true);
        return (false);
    }

    //Driver function
    performAnalysisInstructions(msg, chainID, chainIDDest) {
        let analysis = {
            xcmAddresses: [],
            assetChains: {},
            xcmInteriorKeys: {}, //consider removing this
            xcmInteriorKeysAll: [],
            xcmInteriorKeysRegistered: [],
            xcmInteriorKeysUnregistered: [],
        }
        if (!this.chainParser) {
            this.chainParserInit(chainID, this.debugLevel);
        }
        let version = Object.keys(msg)[0]
        switch (version) {
            case 'v3':
                this.analyzeXCMInstructionsV3(analysis, msg.v3, chainID, chainIDDest, "computeAssetChains")
                break;
            case 'v2':
                this.analyzeXCMInstructionsV2(analysis, msg.v2, chainID, chainIDDest, "computeAssetChains")
                break;
            case 'v1':
                this.analyzeXCMInstructionsV1(analysis, msg.v1, chainID, chainIDDest, "computeAssetChains")
                break;
            case 'v0':
                this.analyzeXCMInstructionsV0(analysis, msg.v0, chainID, chainIDDest, "computeAssetChains")
                break;
            default:
                //console.log("unknown version", version);
        }
        for (const xcmInteriorKey of Object.keys(analysis.xcmInteriorKeys)) {
            let xcmInteriorKeyV2 = paraTool.convertXcmInteriorKeyV1toV2(xcmInteriorKey)
            analysis.xcmInteriorKeysAll.push(xcmInteriorKeyV2)
            if (this.isXcmInteriorKeyRegistered(xcmInteriorKey)) {
                analysis.xcmInteriorKeysRegistered.push(xcmInteriorKeyV2)
            } else {
                analysis.xcmInteriorKeysUnregistered.push(xcmInteriorKeyV2)
            }
        }
        return analysis;
    }

    analyzeXCMInstruction(analysis, instruction, chainID, chainIDDest, ctx = "", version = 'default') {
        let instructionSet = this.getInstructionSet();

        for (const i of Object.keys(instructionSet)) {
            if (instruction[i] != undefined) {
                let features = instructionSet[i];
                if (features.MultiAssets != undefined) {
                    //if (this.debugLevel >= paraTool.debugVerbose) console.log(`Instruction=${i} MultiAssets found!`)
                    for (let j = 0; j < instruction[i].length; j++) {
                        this.analyzeXCM_MultiAsset(analysis, instruction[i][j], chainID, chainIDDest, i);
                    }
                }
                if (features.MultiAsset != undefined) {
                    //if (this.debugLevel >= paraTool.debugVerbose) console.log(`Instruction=${i} MultiAssets found!`)
                    for (const fld of features.MultiAsset) {
                        if (instruction[i][fld] != undefined) {
                            this.analyzeXCM_MultiAsset(analysis, instruction[i][fld], chainID, chainIDDest, i);
                        }
                    }
                }
                if (features.MultiAssetFilter != undefined) {
                    //if (this.debugLevel >= paraTool.debugVerbose) console.log(`Instruction=${i} MultiAssetFilter found!`)
                    for (const fld of features.MultiAssetFilter) {
                        this.analyzeXCM_MultiAssetFilter(analysis, instruction[i], fld, chainID, chainIDDest, i);
                    }
                }
                if (features.MultiLocation != undefined) {
                    for (const fld of features.MultiLocation) {
                        this.analyzeXCM_MultiLocation(analysis, instruction[i], fld, chainID, chainIDDest, i);
                    }
                }

                if (features.XCM != undefined) {
                    for (const fld of features.XCM) {
                        if (instruction[i][fld] != undefined) {
                            //console.log("analyzing instruction containing XCM ", instruction);
                            // recursive call
                            let xcmChild = instruction[i][fld];
                            // console.log( "  ... xcmChild:", xcmChild);
                            switch (version) {
                                case 'v2':
                                    this.analyzeXCMInstructionsV2(analysis, instruction[i][fld], chainID, chainIDDest, i);
                                    break;
                                case 'v3':
                                    this.analyzeXCMInstructionsV3(analysis, instruction[i][fld], chainID, chainIDDest, i);
                                    break;
                                default:
                                    this.analyzeXCMInstructions(analysis, instruction[i][fld], chainID, chainIDDest, i);
                                    break;
                            }
                            //this.analyzeXCMInstructions(analysis, instruction[i][fld], chainID, chainIDDest, i);
                        }
                    }
                }

                if (features.Effects != undefined) {
                    for (const fld of features.Effects) {
                        if (instruction[i][fld] != undefined) {
                            //console.log("analyzing instruction containing effects ", instruction);
                            // recursive call
                            let xcmChild = instruction[i][fld];
                            switch (version) {
                                case 'v2':
                                    this.analyzeXCMInstructionsV2(analysis, instruction[i][fld], chainID, chainIDDest, i);
                                    break;
                                case 'v3':
                                    this.analyzeXCMInstructionsV3(analysis, instruction[i][fld], chainID, chainIDDest, i);
                                    break;
                                default:
                                    this.analyzeXCMInstructions(analysis, instruction[i][fld], chainID, chainIDDest, i);
                                    break;
                            }
                            //this.analyzeXCMInstructions(analysis, instruction[i][fld], chainID, chainIDDest, i);
                        }
                    }
                }

                if (features.Call != undefined) {
                    for (const fld of features.Call) {
                        this.analyzeXCM_Call(analysis, instruction[i], fld, chainID, chainIDDest, i);
                    }
                }
            }
        }
    }

    analyzeXCMInstructionsV0(analysis, xcmMsgV0, chainID, chainIDDest, ctx) {
        this.analyzeXCMInstruction(analysis, xcmMsgV0, chainID, chainIDDest, ctx)
    }

    analyzeXCMInstructionsV1(analysis, xcmMsgV1, chainID, chainIDDest, ctx) {
        this.analyzeXCMInstruction(analysis, xcmMsgV1, chainID, chainIDDest, ctx)
    }

    analyzeXCMInstructionsV2(analysis, instructions, chainID, chainIDDest, ctx) {
        for (const instruction of instructions) {
            //console.log(`instruction`, instruction)
            this.analyzeXCMInstruction(analysis, instruction, chainID, chainIDDest, ctx, 'v2')
        }
    }

    analyzeXCMInstructionsV3(analysis, instructions, chainID, chainIDDest, ctx) {
        for (const instruction of instructions) {
            //console.log(`instruction`, instruction)
            this.analyzeXCMInstruction(analysis, instruction, chainID, chainIDDest, ctx, 'v3')
        }
    }

    // not sure if this works for both v2 and v3
    analyzeXCMInstructions(analysis, instructions, chainID, chainIDDest, ctx) {
        for (const instruction of instructions) {
            //console.log(`instruction`, instruction)
            this.analyzeXCMInstruction(analysis, instruction, chainID, chainIDDest, ctx, 'default')
        }
    }

    supress_skipped_trace(id, section, storage) {
        if (this.skipPalletStorageKeys[`${section}${storage}`] != undefined) {
            return (true);
        }
        return (false);
    }

    suppress_trace(id, section, storage) {
        switch (section) {
            case "Dmp":
            case "Hrmp":
            case "ParachainSystem":
            case "ParaInclusion":
            case "ParaInherent":
            case "Paras":
                return (true);
        }
        switch (storage) {
            case ":intrablock_entropy":
            case "transactionLevel":
            case "ExtrinsicIndex":
                return (true);
        }
        return (false);
    }

    suppress_call(id, section, method) {
        //console.log(`id=${id}, section=${section} method=${method}`)
        if (id == "nodle" && section == "allocations") {
            return (true);
        }
        if (id == "khala") {
            if (method == "forceBatch" || section == "phalaMq" || section == "utility" || section == "proxy") {
                return (true);
            }
        }
        switch (section) {
            case "Dmp":
            case "Hrmp":
            case "ParachainSystem":
                return (true);
        }

        return (false);
    }


}
