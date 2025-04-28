const util = require('util');
const exec = util.promisify(require('child_process').exec);
const fs = require('fs');
const path = require("path");
const fetch = require("node-fetch");
const AssetManager = require("./assetManager");
const ethTool = require("./ethTool");
const paraTool = require("./paraTool");
const xcmgarTool = require("./../gar/xcmgarTool");

const Endpoints = require("./summary/endpoints");
const mysql = require("mysql2");
const {
    WebSocket
} = require('ws');
const {
    hexToU8a,
    compactStripLength,
    hexToBn
} = require("@polkadot/util");
const {
    StorageKey
} = require('@polkadot/types');


const xcmgarSourceURL = 'https://cdn.jsdelivr.net/gh/colorfulnotion/xcm-global-registry/metadata/xcmgar.json'
const xcmgarSourceLocal = '/root/go/src/github.com/colorfulnotion/xcm-global-registry-internal/metadata/xcmgar.json'

module.exports = class XCMGARLoadManager extends AssetManager {

    knownEvmChains = [paraTool.chainIDMoonbeam, paraTool.chainIDMoonriver, paraTool.chainIDMoonbaseBeta, paraTool.chainIDMoonbaseAlpha, paraTool.chainIDAstar, paraTool.chainIDShiden, paraTool.chainIDShibuya]

    async fetchXcmGarRegistryURL() {
        // Storing response
        const response = await fetch(xcmgarSourceURL);

        // Storing data in form of JSON
        var data = await response.json();
        console.log(`xcmgarSourceURL res`, data);
        return data
    }

    async fetchXcmGarRegistryLocal() {
        try {
            const rawData = await fs.promises.readFile(xcmgarSourceLocal, 'utf8');
            const data = JSON.parse(rawData);
            console.error('xcmgarSourceLocal Res', data);
            return data
        } catch (error) {
            console.error('Error reading local file:', error);
            throw error; // Rethrow the error for the caller to handle
        }
    }

    async getLatestXcmGarRegistry(relayChain) {
        await this.init_chainInfos()
        let registryJSON = await this.fetchXcmGarRegistryLocal()
        //console.log(`registryJSON***`, registryJSON)
        let xcRegistryRaw = false
        if (registryJSON['xcmRegistry'] != undefined) {
            let xcmRegistries = registryJSON['xcmRegistry']
            for (const xcmRegistry of xcmRegistries) {
                if (xcmRegistry.relayChain == relayChain) {
                    xcRegistryRaw = xcmRegistry.data
                }
            }
        }
        if (!xcRegistryRaw) {
            console.log(`Unable to find xcmRegistry for relayChain=${relayChain}`)
            process.exit(0)
        }
        let xcRegistryNew = this.transformXcGarRegistry(xcRegistryRaw)
        return xcRegistryNew
    }

    async getLatestLocalAssets(targetedRelaychain, targetedParaID) {
        let rawGlobalAsetMap = {}
        await this.init_chainInfos()
        let registryJSON = await this.fetchXcmGarRegistryLocal()
        let chainAssets = false
        try {
            chainAssets = registryJSON['assets'][targetedRelaychain]
        } catch (err) {
            console.log(`registry.json load error`, err)
            process.exit(0)
        }
        for (const chainAsset of chainAssets) {
            let relayChain = chainAsset.relayChain
            let paraID = chainAsset.paraID
            let r = {
                chainkey: `${relayChain}-${paraID}`,
                chainID: paraTool.getChainIDFromParaIDAndRelayChain(paraID, relayChain),
                paraID: paraID,
                assets: chainAsset.data
            }
            if (targetedParaID == 'all' || targetedParaID == `${r.paraID}`) {
                let assetMap = this.transformParachainAssets(r)
                for (const assetChain of Object.keys(assetMap)) {
                    rawGlobalAsetMap[assetChain] = assetMap[assetChain]
                }
            }
        }
        return rawGlobalAsetMap
    }

    categorizeAssetType(assetName, assetSymbol, chainID) {
        let assetType = paraTool.assetTypeToken
        if (chainID = paraTool.chainIDParallel || chainID == paraTool.chainIDParallel) {
            if (assetName.substr(0, 3) == 'LP-') {
                assetType = paraTool.assetTypeLiquidityPair
            }
        }
        return assetType
    }

    //(vsBOND-DOT-2000-6-13) 02000613 -> {"VSBond2":["0","2,000","6","13"]}
    standardizedVBBond2(assetName = 'vsBOND-DOT-2000-6-13') {
        let pieces = assetName.split('-')
        let convertedVSBond2 = ["", "", "", ""]
        let d = (pieces[1] == "DOT") ? '0' : '1' // DOT/KSM?
        let paraID = paraTool.toNumWithComma(pieces[2])
        let leaseStart = paraTool.toNumWithComma(pieces[3])
        let leaseEnd = paraTool.toNumWithComma(pieces[4])
        convertedVSBond2 = [d, paraID, leaseStart, leaseEnd]
        console.log(`assetName=${assetName}, convertedVSBond2`, convertedVSBond2)
        return convertedVSBond2
    }

    validateLocalAssetSymbol(globalAsetMap, xcRegistryNew) {
        for (const assetChain of Object.keys(globalAsetMap)) {
            let localAsset = globalAsetMap[assetChain]
            let localAssetSymbol = localAsset.symbol
            let xcmInteriorKeyV1 = localAsset.xcmInteriorKeyV1
            // check symbol consistency
            if (xcmInteriorKeyV1 != undefined) {
                let xcmRegistry = xcRegistryNew[xcmInteriorKeyV1]
                if (xcmRegistry != undefined) {
                    let xcmRegistrySymbol = xcmRegistry.symbol
                    if (localAssetSymbol != xcmRegistrySymbol) {
                        console.log(`UPDATE localAsset symbol ${assetChain}: ${localAssetSymbol} -> ${xcmRegistrySymbol}`)
                        globalAsetMap[assetChain].xcmSymbol = xcmRegistrySymbol
                        globalAsetMap[assetChain].symbol = localAssetSymbol
                    }
                }
            }
        }
        return globalAsetMap
    }

    transformParachainAssets(r) {
        let assetMap = {}
        let chainID = r.chainID
        let paraID = r.paraID
        for (const a of r.assets) {
            //console.log(`asset`, a)
            let xcmInteriorKey = a.xcmInteriorKey
            let assetName = a.name
            let assetSymbol = a.symbol
            let decimals = a.decimals
            let rawAsset = a.asset
            let assetString = JSON.stringify(rawAsset)
            let currencyID = null
            let xcContractAddress = null
            let assetType = this.categorizeAssetType(assetName, assetSymbol, chainID)
            try {
                let prefixType = Object.keys(rawAsset)[0]
                let rawAssetVal = rawAsset[prefixType]
                if (prefixType == "Token" && xcmgarTool.isNumeric(rawAssetVal)) {
                    currencyID = rawAssetVal
                    if (this.knownEvmChains.includes(chainID)) {
                        xcContractAddress = paraTool.xcAssetIDToContractAddr(currencyID).toLowerCase()
                    }
                } else if (prefixType == "VSBond2") {
                    let converedAsset = {}
                    converedAsset[prefixType] = this.standardizedVBBond2(assetName)
                    assetString = JSON.stringify(converedAsset)
                } else if (prefixType != "Token") {
                    currencyID = assetString
                }
            } catch (e) {
                console.log(`no prefixType type rawAsset`, rawAsset, `err`, e)
            }
            let assetChain = paraTool.makeAssetChain(assetString, chainID)
            let assetInfo = {
                assetChain: assetChain,
                assetString: assetString,
                chainID: chainID,
                paraID: paraID,
                assetName: assetName,
                decimals: decimals,
                symbol: assetSymbol,
                assetType: assetType,
                xcmInteriorKeyV1: (xcmInteriorKey != undefined) ? paraTool.convertXcmInteriorKeyV2toV1(xcmInteriorKey) : null,
                xcmInteriorKeyV2: (xcmInteriorKey != undefined) ? a.xcmInteriorKey : null,
                currencyID: currencyID,
                xcContractAddress: (xcmInteriorKey != undefined) ? xcContractAddress : null,
            }
            assetMap[assetChain] = assetInfo
            //let xcmInteriorKey = a.xcmInteriorKey
            //let xcmInteriorKey = JSON.stringify(r.xcmV1Standardized)
            //["asset", "chainID",]
            //[ "assetType", "xcmInteriorKey", "decimals", "symbol"]
        }
        return assetMap
    }


    /*
    '[{"parachain":2000},{"generalKey":"0x0003"}]~polkadot': {
      xcmchainID: 2000,
      xcmInteriorKey: '[{"parachain":2000},{"generalKey":"0x0003"}]~polkadot',
      symbol: 'LDOT',
      relayChain: 'polkadot',
      nativeAssetChain: '{"Token":"LDOT"}~2000',
      isUSD: 0,
      decimals: 10,
      priceUSD: 0.8819562464913995,
      parents: 1
    },

    '[{"parachain":2000},{"generalKey":"0x0003"}]~polkadot': {
      paraID: 2000,
      relayChain: 'polkadot',
      symbol: 'LDOT',
      decimals: 10,
      interiorType: 'x2',
      xcmV1Standardized: [ [Object], [Object], [Object] ],
      xcmV1MultiLocationByte: '0x010200411f06080003',
      xcmV1MultiLocation: { v1: [Object] },
      xcContractAddress: { '2006': '0xffffffff00000000000000010000000000000002' },
      xcCurrencyID: {
        '2006': '18446744073709551618',
        '2012': '110',
        '2032': '1',
        '2035': '4'
      },
      confidence: 4,
      source: [ 2006, 2012, 2032, 2035 ]
    */

    isObject(val) {
        return (typeof val === 'object');
    }

    transformXcGarRegistry(xcGarMap) {
        let polkaholicXcGar = {}
        let assetGar = []
        let xcGarMapKey = Object.keys(xcGarMap)
        xcGarMapKey.sort()
        for (const xcmInteriorKeyV2 of xcGarMapKey) {
            let xcmAsset = xcGarMap[xcmInteriorKeyV2]
            let xcmInteriorKeyV1 = paraTool.convertXcmInteriorKeyV2toV1(xcmInteriorKeyV2)
            let xcmV1Standardized = JSON.parse(xcmInteriorKeyV2)

            //console.log(`xcmInteriorKeyV1=${xcmInteriorKeyV1}, xcmInteriorKeyV2=${xcmInteriorKeyV2}`)
            let confidence = xcmAsset.confidence
            let decimals = xcmAsset.decimals
            let symbol = xcmAsset.symbol
            let relayChain = xcmAsset.relayChain
            let paraID = xcmAsset.paraID
            let chainID = paraTool.getChainIDFromParaIDAndRelayChain(paraID, relayChain)
            //nativeAssetChain are different for statemine asset (i.e USDt)
            let parsedAsset = {
                Token: symbol
            }
            if (chainID == paraTool.chainIDKusamaAssetHub || chainID == paraTool.chainIDPolkadotAssetHub) {
                try {
                    console.log(`xcmV1Standardized`, xcmV1Standardized)
                    let assetID = xcmV1Standardized[3]['generalIndex']
                    if (assetID == undefined) continue // invalid registry
                    parsedAsset = {
                        Token: `${assetID}`
                    }
                } catch (e) {
                    console.log(`statemine/t e`, e)
                }
            }
            var assetString = JSON.stringify(parsedAsset);
            let nativeAssetChain = paraTool.makeAssetChain(assetString, chainID)
            let xcCurrencyIDMap = {}
            for (const paraIDSource of Object.keys(xcmAsset.xcCurrencyID)) {
                let chainIDsource = paraTool.getChainIDFromParaIDAndRelayChain(xcmgarTool.dechexToInt(paraIDSource), xcmAsset.relayChain)
                let currencyID = xcmAsset.xcCurrencyID[paraIDSource]
                let assetString = '';
                if (this.isObject(currencyID)) {
                    assetString = JSON.stringify(currencyID)
                } else {
                    let parsedAsset = {
                        Token: currencyID
                    }
                    assetString = JSON.stringify(parsedAsset)
                }
                xcCurrencyIDMap[chainIDsource] = assetString
                console.log(`*** ${xcmInteriorKeyV1} [${chainIDsource}] asset=${assetString}, paraIDSource=${paraIDSource}, relayChain=${xcmAsset.relayChain}`)
            }

            let transformedXcmAsset = {
                xcmchainID: chainID,
                parachainID: paraID,
                xcmInteriorKey: xcmInteriorKeyV1,
                xcmInteriorKeyV2: xcmInteriorKeyV2,
                symbol: symbol,
                relayChain: relayChain,
                nativeAssetChain: nativeAssetChain,
                isUSD: 0,
                decimals: decimals,
                priceUSD: null,
                parents: 1,
                xcCurrencyID: xcCurrencyIDMap,
                confidence: confidence,
            }
            polkaholicXcGar[xcmInteriorKeyV1] = transformedXcmAsset
            console.log(`xcmInteriorKeyV1=${xcmInteriorKeyV1}`, transformedXcmAsset)
            //polkaholicXcGar[xcmInteriorKeyV1] = xcmAsset
        }
        let cleanPolkaholicXcGar = this.checkSymbolCollision(polkaholicXcGar)
        return cleanPolkaholicXcGar
    }

    computeFallbackSymbol(xcmAsset) {
        let symbol = xcmAsset.symbol
        let paraID = xcmAsset.parachainID
        let chainID = xcmAsset.xcmchainID
        let xcmInteriorKeyV1 = xcmAsset.xcmInteriorKey
        if (paraID == 0 || paraID == 1000) {
            //no padding for relaychain / statemine(t)
            return symbol
        }
        let nativeSymbol = this.getChainSymbol(chainID)
        //let nativeSymbol = this.nativeSymbolMap[chainID]
        // no padding for native
        if (symbol == nativeSymbol) {
            return symbol
        } else {
            symbol = `${symbol}.${nativeSymbol}`
        }
        // known exceptions
        if (xcmInteriorKeyV1 == '[{"parachain":2085},{"generalKey":"0x734b534d"}]~kusama') {
            symbol = 'SKSM.OLD'
        }
        if (xcmInteriorKeyV1 == '[{"network":"kusama"},{"parachain":2090},{"generalKey":"0x00000000"}]') {
            symbol = 'BSX.OLD'
        }
        if (xcmInteriorKeyV1 == '[{"parachain":2001},{"generalKey":"0x0001"}]~polkadot') {
            symbol = 'BNC.para2001'
        }
        return symbol
    }

    checkSymbolCollision(polkaholicXcGar) {
        //TODO: check symbol collision here
        let symbolChainMap = {}
        let fallbackSymbolMap = {}
        let collisions = []
        for (const xcmAsset of Object.values(polkaholicXcGar)) {
            let uppercaseSymbol = xcmAsset.symbol.toUpperCase()
            let xcmInteriorKeyV1 = xcmAsset.xcmInteriorKey
            let symbolChain = paraTool.makeAssetChain(uppercaseSymbol, xcmAsset.relayChain)
            fallbackSymbolMap[xcmInteriorKeyV1] = this.computeFallbackSymbol(xcmAsset)
            if (symbolChainMap[symbolChain] == undefined) {
                symbolChainMap[symbolChain] = {}
                symbolChainMap[symbolChain].xcmInteriorKeys = []
            } else {
                collisions.push(symbolChain)
            }
            symbolChainMap[symbolChain].xcmInteriorKeys.push(xcmInteriorKeyV1)
        }
        console.log(`fallbackSymbolMap`, fallbackSymbolMap)
        console.log(`collision!!`, collisions)
        for (const symbolChain of collisions) {
            for (const xcmInteriorKeyV1 of symbolChainMap[symbolChain].xcmInteriorKeys) {
                let originalSymbol = polkaholicXcGar[xcmInteriorKeyV1].symbol
                let fallbackSymbol = fallbackSymbolMap[xcmInteriorKeyV1]
                console.log(`update collision. xcmInteriorKeyV1=${xcmInteriorKeyV1}, ${originalSymbol}->${fallbackSymbol}`)
                polkaholicXcGar[xcmInteriorKeyV1].symbol = fallbackSymbol
            }
        }
        return polkaholicXcGar
    }

    compareXcRegistry(newXcRegistry, oldXcRegistry) {
        let xcRegistryNewOnly = {}
        let xcRegistryOldOnly = {}
        let identicalXcRegsitry = {}
        let diffXcRefistry = {}

        let xcmInteriorNewKeys = Object.keys(newXcRegistry)
        let xcmInteriorOldKeys = Object.keys(oldXcRegistry)
        //console.log( a2.filter(x => !a1.includes(x)) );
        console.log(`xcmInteriorNewKeys`, xcmInteriorNewKeys)
        console.log(`xcmInteriorOldKeys`, xcmInteriorOldKeys)
        let xcmInteriorKeyCommon = xcmInteriorNewKeys.filter(value => xcmInteriorOldKeys.includes(value));
        console.log(`xcmInteriorKeyCommon`, xcmInteriorKeyCommon)
        let xcmInteriorKeyNewOnly = xcmInteriorNewKeys.filter(x => !xcmInteriorOldKeys.includes(x))
        console.log(`xcmInteriorKeyNewOnly`, xcmInteriorKeyNewOnly)
        let xcmInteriorKeyOldOnly = xcmInteriorOldKeys.filter(x => !xcmInteriorNewKeys.includes(x))
        console.log(`xcmInteriorKeyOldOnly`, xcmInteriorKeyOldOnly)

        for (const xcmInteriorKey of xcmInteriorKeyCommon) {
            let xcmAssetOld = oldXcRegistry[xcmInteriorKey]
            let xcmAssetNew = newXcRegistry[xcmInteriorKey]
            // check if xcmchainID, xcmInteriorKey, symbol, relayChain, nativeAssetChain, decimals, parents are all the same
            let checkList = ['xcmchainID', 'xcmInteriorKey', 'symbol', 'relayChain', 'nativeAssetChain', 'decimals', 'parents']
            let mismatchedFlds = []
            let matchedFlds = []
            let isMismatch = false
            for (const k of checkList) {
                if (xcmAssetOld[k] == xcmAssetNew[k]) {
                    matchedFlds.push(k)
                } else {
                    isMismatch = true
                    mismatchedFlds.push(k)
                }
                if (isMismatch) {
                    for (const mismatchedFld of mismatchedFlds) {
                        let mistMatched = {}
                        mistMatched[mismatchedFld] = {
                            new: xcmAssetNew[mismatchedFld],
                            old: xcmAssetOld[mismatchedFld]
                        }
                        diffXcRefistry[xcmInteriorKey] = mistMatched
                    }
                } else {
                    identicalXcRegsitry[xcmInteriorKey] = xcmAssetNew
                }
            }
        }

        for (const xcmInteriorKey of xcmInteriorKeyNewOnly) {
            xcRegistryNewOnly[xcmInteriorKey] = newXcRegistry[xcmInteriorKey]
        }

        for (const xcmInteriorKey of xcmInteriorKeyOldOnly) {
            let xcmAssetNew = oldXcRegistry[xcmInteriorKey]
            xcRegistryOldOnly[xcmInteriorKey] = oldXcRegistry[xcmInteriorKey]
        }
        console.log(`New Only [${Object.keys(xcRegistryNewOnly).length}]`, xcRegistryNewOnly)
        console.log(`Old Only [${Object.keys(xcRegistryOldOnly).length}]`, xcRegistryOldOnly)
        //console.log(`Identical [${Object.keys(identicalXcRegsitry).length}]`, Object.keys(identicalXcRegsitry))
        console.log(`Diff [${Object.keys(diffXcRefistry).length}]`, diffXcRefistry)
        console.log(`New=[${Object.keys(xcRegistryNewOnly).length}], Old=${Object.keys(xcRegistryOldOnly).length}, Identical=${Object.keys(identicalXcRegsitry).length}, Diff=${Object.keys(diffXcRefistry).length}`)
        return [xcRegistryNewOnly, xcRegistryOldOnly, identicalXcRegsitry, diffXcRefistry]
    }

    compareParachainAssets(newParaAssets, oldParaAssets) {
        let newParaAssetOnly = {}
        let oldParaAssetOnly = {}
        let identicalParaAssets = {}
        let diffParaAssets = {}

        let newParaAssetsKeys = Object.keys(newParaAssets)
        let oldParaAssetsKeys = Object.keys(oldParaAssets)
        //console.log( a2.filter(x => !a1.includes(x)) );
        console.log(`newParaAssetsKeys`, newParaAssetsKeys)
        console.log(`oldParaAssetsKeys`, oldParaAssetsKeys)
        let paraAssetKeysCommon = newParaAssetsKeys.filter(value => oldParaAssetsKeys.includes(value));
        console.log(`paraAssetKeysCommon`, paraAssetKeysCommon)
        let paraAssetKeysNew = newParaAssetsKeys.filter(x => !oldParaAssetsKeys.includes(x))
        console.log(`paraAssetKeysNew`, paraAssetKeysNew)
        let paraAssetKeysOld = oldParaAssetsKeys.filter(x => !newParaAssetsKeys.includes(x))
        console.log(`paraAssetKeysOld`, paraAssetKeysOld)

        for (const assetChain of paraAssetKeysCommon) {
            let paraAssetOld = oldParaAssets[assetChain]
            let paraAssetNew = newParaAssets[assetChain]
            // check if'xcmInteriorKey', 'symbol', 'nativeAssetChain', 'decimals', 'xcContractAddress', 'currencyID' are all the same
            let checkList = ['xcmInteriorKey', 'symbol', 'nativeAssetChain', 'decimals', 'xcContractAddress', 'currencyID']
            let mismatchedFlds = []
            let matchedFlds = []
            let isMismatch = false
            for (const k of checkList) {
                if (paraAssetOld[k] == paraAssetNew[k]) {
                    matchedFlds.push(k)
                } else {
                    isMismatch = true
                    mismatchedFlds.push(k)
                }
                if (isMismatch) {
                    for (const mismatchedFld of mismatchedFlds) {
                        let mistMatched = {}
                        mistMatched[mismatchedFld] = {
                            new: paraAssetNew[mismatchedFld],
                            old: paraAssetOld[mismatchedFld]
                        }
                        diffParaAssets[assetChain] = mistMatched
                    }
                } else {
                    identicalParaAssets[assetChain] = paraAssetNew
                }
            }
        }

        for (const assetChain of paraAssetKeysNew) {
            newParaAssetOnly[assetChain] = newParaAssets[assetChain]
        }

        for (const assetChain of paraAssetKeysOld) {
            oldParaAssetOnly[assetChain] = oldParaAssets[assetChain]
        }
        console.log(`New Only [${Object.keys(newParaAssetOnly).length}]`, newParaAssetOnly)
        console.log(`Old Only [${Object.keys(oldParaAssetOnly).length}]`, oldParaAssetOnly)
        //console.log(`Identical [${Object.keys(identicalParaAssets).length}]`, Object.keys(identicalParaAssets))
        console.log(`Diff [${Object.keys(diffParaAssets).length}]`, diffParaAssets)
        console.log(`New=[${Object.keys(newParaAssetOnly).length}], Old=${Object.keys(oldParaAssetOnly).length}, Identical=${Object.keys(identicalParaAssets).length}, Diff=${Object.keys(diffParaAssets).length}`)
        return [newParaAssetOnly, oldParaAssetOnly, identicalParaAssets, diffParaAssets]
    }

    async init_parachain_asset_old(targetedRelaychain = 'polkadot', targetedParaID = 'all') {
        let parachainAssets = await this.poolREADONLY.query(`select asset, assetName, symbol, decimals, currencyID, xcContractAddress, xcmInteriorkey, chainID from asset where assetType in ('${paraTool.assetTypeLiquidityPair}', '${paraTool.assetTypeToken}')`);
        let parachainAssetsMap = {}
        for (let i = 0; i < parachainAssets.length; i++) {
            let parachainAsset = parachainAssets[i]
            let chainID = parachainAsset.chainID
            let relayChain = paraTool.getRelayChainByChainID(chainID)
            let paraID = paraTool.getParaIDfromChainID(chainID)
            if (targetedRelaychain == relayChain) {
                if (targetedParaID == 'all' || targetedParaID == paraID) {
                    let assetChain = paraTool.makeAssetChain(parachainAsset.asset, chainID)
                    parachainAsset.assetChain = assetChain
                    parachainAssetsMap[assetChain] = parachainAsset
                }
            }
        }
        return parachainAssetsMap
    }

    async init_xcm_asset_old(relayChain = 'polkadot') {
        let xcmAssets = await this.poolREADONLY.query(`select xcmchainID, xcmInteriorKey, symbol, relayChain, nativeAssetChain, isUSD, decimals, priceUSD, parent as parents from xcmasset where xcmInteriorKey is not null and relaychain in ('${relayChain}')`);
        let xcmAssetMap = {}
        for (let i = 0; i < xcmAssets.length; i++) {
            let xcmAsset = xcmAssets[i]
            let xcmInteriorKey = xcmAsset.xcmInteriorKey
            xcmAssetMap[xcmInteriorKey] = xcmAsset
        }
        return xcmAssetMap
    }

    /*
    mysql> desc xcmasset;
    +-----------------------+--------------+------+-----+---------+-------+
    | Field                 | Type         | Null | Key | Default | Extra |
    +-----------------------+--------------+------+-----+---------+-------+
    | xcmInteriorKey        | varchar(128) | YES  | MUL | NULL    |       |
    | nativeAssetChain      | varchar(64)  | YES  |     | NULL    |       |
    | symbol                | varchar(34)  | NO   | PRI | NULL    |       |
    | relayChain            | varchar(32)  | NO   | PRI | NULL    |       |
    | xcmchainID            | int(11)      | YES  |     | NULL    |       |
    | addDT                 | datetime     | YES  |     | NULL    |       |
    | audited               | tinyint(4)   | YES  |     | 0       |       |
    | decimals              | int(11)      | YES  |     | NULL    |       |
    | isUSD                 | tinyint(4)   | YES  |     | 0       |       |
    | numXCMTransfer1d      | int(11)      | YES  |     | 0       |       |
    | numXCMTransfer7d      | int(11)      | YES  |     | 0       |       |
    | numXCMTransfer30d     | int(11)      | YES  |     | 0       |       |
    | valXCMTransferUSD1d   | double       | YES  |     | 0       |       |
    | valXCMTransferUSD7d   | double       | YES  |     | 0       |       |
    | valXCMTransferUSD30d  | double       | YES  |     | 0       |       |
    | coingeckoID           | varchar(40)  | YES  |     | NULL    |       |
    | coingeckoLastUpdateDT | datetime     | YES  |     | NULL    |       |
    | priceUSD              | double       | YES  |     | 0       |       |
    | priceUSDPercentChange | double       | YES  |     | 0       |       |
    | verificationPath      | blob         | YES  |     | NULL    |       |
    | liquid                | float        | YES  |     | NULL    |       |
    | lastPriceUpdateDT     | datetime     | YES  |     | NULL    |       |
    | parent                | tinyint(4)   | YES  |     | 1       |       |
    +-----------------------+--------------+------+-----+---------+-------+
    */

    async flushXcmAssetGar(xcRegistryNew, filterList = false, isDry = true, targetTable = 'xcmassetgar') {
        // flush new xc Registry into
        if (targetTable != 'xcmassetgar' && targetTable != 'xcmasset') {
            console.log(`Invalid targetTable=${targetTable}`)
            return
        }
        let xcmtransferKeys = Object.keys(xcRegistryNew)
        console.log(`xcmtransferKeys[${xcmtransferKeys.length}]`, xcmtransferKeys)
        if (xcmtransferKeys.length > 0) {
            let xcmAssets = [];
            for (let i = 0; i < xcmtransferKeys.length; i++) {
                let xcmtransferKey = xcmtransferKeys[i]
                let r = xcRegistryNew[xcmtransferKeys[i]];
                //["xcmInteriorKey", "symbol", "relayChain"]
                // ["xcmchainID", "nativeAssetChain", "isUSD", "decimals", "parents"]
                let t = "(" + [`'${r.xcmInteriorKey}'`,
                    `'${r.symbol}'`, `'${r.relayChain}'`, `'${r.xcmchainID}'`, `'${r.nativeAssetChain}'`, `'${r.isUSD}'`, `'${r.decimals}'`, `'${r.parents}'`, `'${r.xcmInteriorKeyV2}'`, `'${r.parachainID}'`, `'${r.confidence}'`
                ].join(",") + ")";
                console.log(`xcmInteriorKey=${r.xcmInteriorKey} >>>`, t)
                console.log(`xcmInteriorKey=${r.xcmInteriorKey} res`, r)
                if (filterList) {
                    if (filterList.includes(xcmtransferKey)) {
                        xcmAssets.push(t);
                    }
                } else {
                    xcmAssets.push(t);
                }
            }
            if (xcmAssets.length > 0 && isDry) {
                console.log('new xcm registry detected', xcmAssets)
                process.exit(1, 'new xcm registry detected')
            }
            if (xcmAssets.length > 0) {
                let sqlDebug = true
                await this.upsertSQL({
                    "table": targetTable,
                    "keys": ["xcmInteriorKey"],
                    "vals": ["symbol", "relayChain", "xcmchainID", "nativeAssetChain", "isUSD", "decimals", "parent", "xcmInteriorKeyV2", "parachainID", "confidence"],
                    "data": xcmAssets,
                    "replace": ["xcmchainID", "nativeAssetChain", "isUSD", "decimals", "parent", "xcmInteriorKeyV2", "parachainID", "confidence"],
                    "replaceIfNull": ["symbol"]
                }, sqlDebug);
            } else {
                console.log(`No new registry detected`)
            }
        }
    }

    async flushParachainAssets(assetMap, filterList = false, isDry = true, targetTable = 'assetgar') {
        // flush new xc Registry into
        if (targetTable != 'assetgar' && targetTable != 'asset') {
            console.log(`Invalid targetTable=${targetTable}`)
            return
        }
        let assetMapKey = Object.keys(assetMap)
        console.log(`flushParachainAssets, filterList[${filterList.length}]`, filterList)
        if (assetMapKey.length > 0) {
            let assets = []
            for (let i = 0; i < assetMapKey.length; i++) {
                let assetChain = assetMapKey[i]
                let r = assetMap[assetChain]
                //["asset", "chainID",]
                //[ "assetType", "xcmInteriorKey", "decimals", "symbol"]
                let xcmInteriorKey = (r.xcmInteriorKeyV1 && r.xcmInteriorKeyV1 !== false) ? `${mysql.escape(r.xcmInteriorKeyV1)}` : `NULL`
                let assetName = (r.assetName != undefined) ? `${mysql.escape(r.assetName)}` : `NULL`
                let currencyID = (r.currencyID != undefined && r.currencyID !== false) ? `${mysql.escape(r.currencyID)}` : `NULL`
                let xcContractAddress = (r.xcContractAddress != undefined && r.xcContractAddress !== false) ? `${mysql.escape(r.xcContractAddress)}` : `NULL`
                let a = "(" + [`'${r.assetString}'`, `'${r.chainID}'`,
                    `'${paraTool.assetTypeToken}'`, xcmInteriorKey, `'${r.decimals}'`, `'${r.symbol}'`, assetName, currencyID, xcContractAddress
                ].join(",") + ")";
                if (filterList) {
                    if (filterList.includes(assetChain)) {
                        assets.push(a)
                    }
                } else {
                    assets.push(a)
                }
            }
            if (assets.length > 0 && isDry) {
                console.log('new asset detected', assets)
                process.exit(1, 'new asset detected')
            }
            if (assets.length > 0) {
                let sqlDebug = true
                await this.upsertSQL({
                    "table": targetTable,
                    "keys": ["asset", "chainID"],
                    "vals": ["assetType", "xcmInteriorKey", "decimals", "symbol", "assetName", "currencyID", "xcContractAddress"],
                    "data": assets,
                    "replaceIfNull": ["assetType", "xcmInteriorKey", "decimals", "symbol", "assetName", "currencyID", "xcContractAddress"]
                }, sqlDebug);
                await this.update_batchedSQL()
            } else {
                console.log(`No new asset detected`)
            }
        }
    }
}