const paraTool = require("../paraTool");
const ethTool = require("../ethTool");
const {
    decodeAddress,
} = require("@polkadot/keyring");
const {
    u8aToHex,
} = require("@polkadot/util");

module.exports = class ChainParser {
    debugLevel = paraTool.debugNoLog;
    chainParserName = "generic"
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
    constructor() {

    }

    setDebugLevel(debugLevel = paraTool.debugNoLog) {
        this.debugLevel = debugLevel
    }

    // set author
    setAuthor(author = false) {
        this.author = author
    }

    // set parser unix timestamp to record "realtime" cells in btAddress, btAsset properly
    setParserContext(ts, blockNumber, blockHash, chainID) {
        this.parserTS = ts;
        this.parserBlockNumber = blockNumber;
        if (chainID == paraTool.chainIDPolkadot || chainID == paraTool.chainIDKusama) {
            //for relaychain, blockNumber is the watermark
            this.parserWatermark = blockNumber
        } else {
            // remove watermark
            if (this.parserWatermark != blockNumber) this.parserWatermark = 0
        }
        this.parserBlockHash = blockHash;
        this.mpReceived = false;
    }

    setRelayParentStateRoot(stateRoot) {
        this.relayParentStateRoot = stateRoot
    }

    getChainParserStat() {
        let r = {
            parserTS: this.parserTS,
            parserBlockNumber: this.parserBlockNumber,
            parserBlockHash: this.parserBlockHash,
            relayParentStateRoot: this.relayParentStateRoot,
            chainParserName: this.chainParserName
        }
        return r
    }

    tokens_to_string(tokens) {
        let outArr = []
        for (const i of tokens) {
            let o = {};
            if (i.token !== undefined) o['Token'] = i.token
            if (i.Token !== undefined) o['Token'] = i.Token

            if (i.foreignAsset !== undefined) o.ForeignAsset = i.foreignAsset.toString();
            if (i.ForeignAsset !== undefined) o.ForeignAsset = i.ForeignAsset.toString();

            if (i.stableAssetPoolToken !== undefined) o.StableAssetPoolToken = i.stableAssetPoolToken.toString();
            if (i.StableAssetPoolToken !== undefined) o.StableAssetPoolToken = i.StableAssetPoolToken.toString();

            if (i.liquidCrowdloan !== undefined) o.LiquidCrowdloan = i.liquidCrowdloan.toString();
            if (i.LiquidCrowdloan !== undefined) o.LiquidCrowdloan = i.LiquidCrowdloan.toString();

            if (i.dexShare !== undefined) {
                o = i.dexShare
            }
            if (i.dEXShare !== undefined) {
                o = i.dEXShare
            }

            // bifrost
            if (paraTool.chainIDBifrostKSM) {
                if (i.native != undefined) {
                    // BNC
                    o['Token'] = i.native
                } else if (i.stable != undefined) {
                    // KUSD
                    o['Token'] = i.stable
                } else if (i.vsToken != undefined) {
                    // vsToken:KSM -> Token: VSKSM
                    o['Token'] = `VS${i.vsToken}`
                } else if (i.vSToken != undefined) {
                    // vsToken:KSM -> Token: VSKSM
                    o['Token'] = `VS${i.vSToken}`
                }
                if (JSON.stringify(o) == '{}') {
                    //debug: explore bifrost assetType here
                    //console.log(`new BIFROST currency type`, i)
                    o = i
                }
            }
            outArr.push(o)
        }
        if (this.debugLevel >= paraTool.debugVerbose) console.log(outArr)
        let out = JSON.stringify(outArr);
        return (out);
    }

    // Because we need to canonizalie token + foreignAsset and further 0 => strings "0", this helper function is needed
    token_to_string(i) {
        if (Array.isArray(i)) {
            return this.tokens_to_string(i);
        }
        let o = {};
        if (i.token !== undefined) o['Token'] = i.token
        if (i.Token !== undefined) o['Token'] = i.Token
        if (i.erc20 !== undefined) o['Erc20'] = i.erc20
        if (i.Erc20 !== undefined) o['Erc20'] = i.Erc20
        if (i.Token2 !== undefined) o['Token2'] = i.Token2
        if (i.token2 !== undefined) o['Token2'] = i.token2
        if (o['Token2'] != undefined && paraTool.isInt(o['Token2'])) {
            o['Token2'] = `${o['Token2']}`
        }

        if (i.foreignAsset !== undefined) o.ForeignAsset = i.foreignAsset.toString();
        if (i.ForeignAsset !== undefined) o.ForeignAsset = i.ForeignAsset.toString();

        if (i.stableAssetPoolToken !== undefined) o.StableAssetPoolToken = i.stableAssetPoolToken.toString();
        if (i.StableAssetPoolToken !== undefined) o.StableAssetPoolToken = i.StableAssetPoolToken.toString();

        if (i.liquidCrowdloan !== undefined) o.LiquidCrowdloan = i.liquidCrowdloan.toString();
        if (i.LiquidCrowdloan !== undefined) o.LiquidCrowdloan = i.LiquidCrowdloan.toString();

        if (i.dexShare !== undefined) {
            o = i.dexShare
        }

        // bifrost
        if (paraTool.chainIDBifrostKSM) {
            if (i.native != undefined) {
                // BNC
                o['Token'] = i.native
            } else if (i.stable != undefined) {
                // KUSD
                o['Token'] = i.stable
            } else if (i.vsToken != undefined) {
                // vsToken:KSM -> Token: VSKSM
                o['Token'] = `VS${i.vsToken}`
            } else if (i.vSToken != undefined) {
                // vsToken:KSM -> Token: VSKSM
                o['Token'] = `VS${i.vSToken}`
            }

            if (JSON.stringify(o) == '{}') {
                //debug: explore bifrost assetType here
                //if (this.debugLevel >= paraTool.debugInfo) console.log(`new BIFROST currency type`, i)
                o = i
            }
        }

        let out = JSON.stringify(o);
        return (out);
    }

    elevatedAssetKey(elevation, rAssetkey) {
        let o = {};
        o[elevation] = JSON.parse(rAssetkey);
        let ak = JSON.stringify(o);
        return ak
    }

    elevatedAssetKeyWithQuote(elevation, rAssetkey) {
        let o = {};
        let v = JSON.parse(rAssetkey);
        o[elevation] = `${v}`
        let ak = JSON.stringify(o);
        return ak
    }

    async getSystemProperties(indexer, chain) {
        let chainID = chain.chainID;
        let relayChain = paraTool.getRelayChainByChainID(chainID);
        let paraID = paraTool.getParaIDfromChainID(chainID)
        if (chainID == paraTool.chainIDMoonbaseAlpha || chainID == paraTool.chainIDMoonbaseBeta || chainID == paraTool.chainIDMoonbaseRelay) {
            //suppress DEV
            return
        }
        let propsNative = await indexer.api.rpc.system.properties();
        let props = JSON.parse(propsNative.toString());
        // {"ss58Format":10,"tokenDecimals":[12,12,10,10],"tokenSymbol":["ACA","AUSD","DOT","LDOT"]}
        // NOT MAINTAINED let ss58Format = props.ss58Format;
        // checking if chainSymbolXcmInteriorKey is set
        let chainSymbolXcmInteriorKey = await indexer.checkChainSymbolXcmInteriorKey(chainID)
        //let chainSymbolXcmInteriorKey = indexer.getChainSymbolXcmInteriorKey(chainID)
        console.log(`[${chainID}] chainSymbolXcmInteriorKey=${chainSymbolXcmInteriorKey}, properties`, props)
        if (props.tokenSymbol) {
            for (let i = 0; i < props.tokenSymbol.length; i++) {
                let symbol = props.tokenSymbol[i];
                let decimals = props.tokenDecimals[i];
                let asset = JSON.stringify({
                    Token: symbol
                })
                let assetInfo = {
                    assetType: "Token",
                    name: symbol,
                    symbol: symbol,
                    decimals: decimals,
                    isNativeChain: 0
                };
                // TODO: skip this if we already know about this!
                let assetChain = paraTool.makeAssetChain(asset, chainID);
                if (i == 0 && !chainSymbolXcmInteriorKey) {
                    let pseudoXCMAssets = []
                    let pseudoXCMInteriorkey = paraTool.makeAssetChain(symbol, relayChain)
                    if (symbol == 'KSM' || symbol == 'DOT') {
                        pseudoXCMInteriorkey = `here~${relayChain}`
                    }
                    let chainSymbolXcmInteriorSql = `update chain set symbolXcmInteriorKey = '${pseudoXCMInteriorkey}', symbol = '${symbol}' where chainID = '${chainID}'`
                    console.log(`updating chain SymbolXcmInteriorKey`, chainSymbolXcmInteriorSql)
                    indexer.batchedSQL.push(chainSymbolXcmInteriorSql);
                    let t = "(" + [`'${pseudoXCMInteriorkey}'`,
                        `'${assetInfo.symbol}'`, `'${relayChain}'`, `'${chainID}'`, `'${assetChain}'`, `'${assetInfo.decimals}'`, `'${paraID}'`, '0'
                    ].join(",") + ")";
                    if (pseudoXCMInteriorkey != `here~${relayChain}`) {
                        console.log(`adding pseudo native asset!`, t)
                        pseudoXCMAssets.push(t)
                        let sqlDebug = true
                        await indexer.upsertSQL({
                            "table": "xcmasset",
                            "keys": ["xcmInteriorKey"],
                            "vals": ["symbol", "relayChain", "xcmchainID", "nativeAssetChain", "decimals", "parachainID", "isXCMAsset"],
                            "data": pseudoXCMAssets,
                            "replace": ["xcmchainID", "nativeAssetChain", "decimals", "parachainID"],
                            "replaceIfNull": ["symbol"]
                        }, sqlDebug);
                    }
                }
                let cachedAssetInfo = indexer.assetInfo[assetChain]
                //console.log(`getAssetInfo cachedAssetInfo`, cachedAssetInfo)
                if (cachedAssetInfo !== undefined && cachedAssetInfo.assetName != undefined && cachedAssetInfo.decimals != undefined && cachedAssetInfo.assetType != undefined && cachedAssetInfo.symbol != undefined) {
                    //cached assetInfo
                    //console.log(`[Cached Asset] asset=${asset}, chainID=${chainID}, assetInfo`, assetInfo)
                } else {
                    console.log(`[Fresh Asset] asset=${asset}, chainID=${chainID}, assetInfo`, assetInfo)
                    await indexer.addAssetInfo(asset, chainID, assetInfo, 'getSystemProperties');
                    // if chain does not have a "asset" specified, it will get one from the FIRST one
                    if (i == 0) {
                        if (!chain.asset) {
                            let newAsset = JSON.stringify({
                                Token: symbol
                            })
                            //console.log("adding NEW asset to chain", newAsset)
                            indexer.batchedSQL.push(`update chain set asset = '${newAsset}' where chainID = '${chainID}'`);
                        }
                        if (!chain.symbol) {
                            // TODO: add this after checking chain.symbol and symbol
                            indexer.batchedSQL.push(`update chain set symbol = '${symbol}' where chainID = '${chainID}'`);
                        }
                    }
                }
            }
            await indexer.update_batchedSQL(true);
        }
        // this is important for new assets that show up
        if (indexer.reloadChainInfo) {
            await indexer.assetManagerInit();
        }
    }

    getHrmpWatermarkVal(indexer, decoratedVal) {
        try {
            let hrmpWatermark = paraTool.dechexToInt(decoratedVal)
            this.parserWatermark = hrmpWatermark
            if (this.debugLevel >= paraTool.debugVerbose) console.log(`[${this.parserBlockNumber}] Update hrmpWatermark: ${hrmpWatermark}`)
        } catch (e) {
            console.log(`[${this.parserBlockNumber}] getHrmpWatermarkVal error`, e.toString())
        }
    }

    getIdentityKey(indexer, decoratedKey) {
        //["pJhw2zYqTnW9m2ddvJCE3B2493ibxbRwJ7ksDTLzf5raEpv"]
        let chainID = indexer.chainID
        let k = JSON.parse(decoratedKey)
        var out = {};
        out.accountID = k[0]; //accountID
        out.asset = indexer.getNativeAsset(chainID) // "key holder"
        return out
    }


    /*
    {
      "judgements": [
        [
          0,
          {
            "knownGood": null
          }
        ]
      ],
      "deposit": 156300000000,
      "info": {
        "additional": [],
        "display": {
          "raw": "0x573346"
        },
        "legal": {
          "raw": "0x576562203320546563686e6f6c6f6769657320466f756e646174696f6e"
        },
        "web": {
          "raw": "0x68747470733a2f2f776562332e666f756e646174696f6e"
        },
        "riot": {
          "none": null
        },
        "email": {
          "raw": "0x696e666f40776562332e666f756e646174696f6e"
        },
        "pgpFingerprint": null,
        "image": {
          "none": null
        },
        "twitter": {
          "raw": "0x4077656233666f756e646174696f6e"
        }
      }
    }
    */
    getIdentityVal(indexer, decoratedVal) {
        let v = JSON.parse(decoratedVal)
        //let v = ledec(val)
        //console.log(`getIdentityVal`, v)
        let res = {}
        let identityRec = {
            judgements: [],
            info: {},
        }

        for (const j of v.judgements) {
            let registar = {
                registrarIndex: j[0],
                status: Object.keys(j[1])[0]
            }
            identityRec.judgements.push(registar)
        }

        let vInfo = v.info
        for (const fld of Object.keys(vInfo)) {
            if (fld == 'additional') {
                identityRec['info'].additional = vInfo.additional
            } else {
                let vObj = vInfo[fld]
                if (vObj === null) {
                    identityRec['info'][fld] = 'Null'
                } else if (vObj.raw != undefined) {
                    identityRec['info'][fld] = paraTool.hexToString(vObj.raw)
                } else if (vObj.none === null) {
                    identityRec['info'][fld] = 'None'
                } else {
                    let vObjKey = Object.keys(vObj)[0]
                    let vObjVal = vObj[vObjKey]
                    identityRec['info'][fld] = {
                        type: vObjKey,
                        val: vObjVal,
                    }
                }
            }
        }

        let extraField = []
        extraField['info'] = JSON.stringify(identityRec.info)
        extraField['judgements'] = JSON.stringify(identityRec.judgements)
        res["extra"] = extraField
        //console.log(`getIdentityVal res`, res)
        return res
    }

    getDownwardMessageQueuesKey(indexer, decoratedKey, mpType = 'dmp') {
        //Dmp:DownwardMessageQueues get paraID here
        let k = JSON.parse(decoratedKey)
        var out = {};
        try {
            let paraIDDest = paraTool.dechexToInt(k[0].replace(',', ''))
            let relayChain = indexer.relayChain
            let relayChainID = paraTool.getRelayChainID(relayChain)
            let paraIDExtra = paraTool.getParaIDExtra(relayChain)
            let chainIDDest = paraIDDest + paraIDExtra
            out.paraIDDest = paraIDDest; //paraID
            out.chainIDDest = chainIDDest;
            out.mpType = mpType
            //console.log(`[${mpType}] DownwardMessageQueuesKey`, out)
            return out
        } catch (e) {
            console.log(`[${mpType}] DownwardMessageQueuesKey error`, e)
        }
    }

    getDownwardMessageQueuesVal(indexer, decoratedVal, mpType = 'dmp', o) {
        //Dmp:DownwardMessageQueuesVal
        /*
        {
          sentAt: 11038272,
          msg: '0x021001040001000002180d8f0a130001000002180d8f010300286bee0d0100040001010094ac3dfcff6cc5c6917b2412b26a37a5ee910ff9a3179247eba8fda08831ef12'
        }
        {
          pubSentAt: 9440729,
          pubMsg: '0x0001040a01000b00f01449e90408070a01000b00f01449e9040000000000000000005ed0b200000000000001040101020082ba55bbd6e798cc015723fae77abe3fb54a2cdbbfe873b85d08a57b5aab6a6a'
        }
        */
        //console.log(`decoratedVal=${decoratedVal}, o`, o)
        let chainID = indexer.chainID
        let res = {}
        let extraField = []
        try {
            let dmps = []
            let dmpRaws = []
            let prevData = false
            let chainIDDest = (o.chainIDDest != undefined) ? o.chainIDDest : false
            let relayChain = indexer.relayChain
            let v = JSON.parse(decoratedVal)
            if (v != undefined && v.length == 0 && chainIDDest) return extraField['mpIsEmpty'] = 1
            for (const dmp of v) {
                let data = (dmp.msg != undefined) ? dmp.msg : dmp.pubMsg
                let sentAt = (dmp.sentAt != undefined) ? paraTool.dechexToInt(dmp.sentAt) : paraTool.dechexToInt(dmp.pubSentAt)
                //console.log(`[${this.parserBlockNumber}] [sentAt=${sentAt}][data=${data}]`)
                if (data != prevData) {
                    var xcmFragments = this.decodeXcmVersionedXcms(indexer, data, `DownwardMessageQueuesVal`)
                    if (xcmFragments) {
                        for (const xcm of xcmFragments) {
                            var msgHash = xcm.msgHash
                            var dmpMsg = xcm.msg
                            var msg0 = xcm.msg
                            var msgHex = xcm.hex
                            let beneficiaries = this.getBeneficiary(msg0)
                            //console.log(`[Trace] Outgoing DownwardMessageQueuesVal [${msgHash}] beneficiaries=${beneficiaries}`)
                            let p = this.getInstructionPath(dmpMsg)
                            let dmpDecoded = {
                                msg: JSON.stringify(dmpMsg),
                            }
                            let dmpRaw = {
                                mpType: mpType,
                                msgHash: msgHash,
                                msgHex: msgHex,
                                msgStr: JSON.stringify(dmpMsg),
                                sentAt: sentAt, //dmp is guranteed to be correct
                                chainID: chainID,
                                chainIDDest: chainIDDest,
                                relayChain: relayChain,
                                beneficiaries: beneficiaries,
                            }
                            if (p) {
                                dmpRaw.version = p.version
                                dmpRaw.path = p.path
                            }
                            dmps.push(dmpDecoded)
                            dmpRaws.push(dmpRaw)
                        }
                    }
                }
                prevData = data
            }
            extraField['mpIsSet'] = 1
            //res["pv"] = dmps
            res["pv2"] = dmpRaws
            res["extra"] = extraField
            //if (this.debugLevel >= paraTool.debugVerbose) console.log(`[${mpType}] DownwardMessageQueuesVal`, res)
            return res
        } catch (e) {
            //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`[${mpType}] DownwardMessageQueuesVal decoratedVal=${decoratedVal}, error`, e)
        }
    }

    getUpwardMessageseVal(indexer, decoratedVal, mpType = false) {
        //ParachainSystem:UpwardMessages
        //console.log(`[${mpType}] UpwardMessageseVal len=${decoratedVal.length}`, decoratedVal)
        /* not sure why it's missing quote + having random spaces
        '[0x02100004000000000717b0f512810a13000000000717b0f51281010700f2052a010d01000400010100365f84a8fd30b25561248e23190cb0c1e042eb08ef0e01deabdddffa1bb05614]'
        */
        let chainID = indexer.chainID
        let res = {}
        let extraField = []
        if (decoratedVal == '[]') {
            extraField['mpIsEmpty'] = 1
            res["pv"] = decoratedVal
            res["extra"] = extraField
            return res
        }
        try {
            //let v = JSON.parse(decoratedVal)
            //if (v != undefined && v.length == 0) return extraField['mpIsEmpty'] = 1
            let v = decoratedVal.replace('[', '').replace(']', '').replaceAll(' ', '').split(',')
            let umps = []
            let umpRaws = []
            let prevData = false
            for (const ump of v) {
                let data = ump.replace(' ', '')
                let relayChain = indexer.relayChain
                if (data != prevData) {
                    var xcmFragments = this.decodeXcmVersionedXcms(indexer, data, `UpwardMessagesVal`)
                    if (xcmFragments) {
                        for (const xcm of xcmFragments) {
                            var msgHash = xcm.msgHash
                            var umpMsg = xcm.msg
                            var msg0 = xcm.msg
                            var msgHex = xcm.hex
                            let beneficiaries = this.getBeneficiary(msg0)
                            //console.log(`[Trace] Outgoing UpwardMessagesVal [${msgHash}] beneficiaries=${beneficiaries}`)
                            let p = this.getInstructionPath(umpMsg)
                            let umpDecoded = {
                                msg: JSON.stringify(umpMsg),
                            }
                            let umpRaw = {
                                mpType: mpType,
                                msgHash: msgHash,
                                msgHex: msgHex,
                                msgStr: JSON.stringify(umpMsg),
                                //sentAt: this.parserWatermark, //this is potentially off by 2-4 blocks
                                sentAt: 0,
                                chainID: chainID,
                                chainIDDest: paraTool.getRelayChainID(relayChain),
                                relayChain: relayChain,
                                beneficiaries: beneficiaries,
                            }
                            if (p) {
                                umpRaw.version = p.version
                                umpRaw.path = p.path
                            }
                            umps.push(umpDecoded)
                            umpRaws.push(umpRaw)
                        }
                    }
                    prevData = data
                }
            }
            extraField['mpIsSet'] = 1
            //res["pv"] = umps
            res["pv2"] = umpRaws
            res["extra"] = extraField
            //if (this.debugLevel >= paraTool.debugVerbose) console.log(`[${mpType}] UpwardMessageseVal`, res)
            return res
        } catch (e) {
            if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`[${mpType}] UpwardMessageseVal decoratedVal=${decoratedVal}, error`, e)
        }
    }


    getHrmpOutboundMessagesVal(indexer, decoratedVal, mpType = false) {
        //ParachainSystem:HrmpOutboundMessages
        let chainID = indexer.chainID
        let res = {}
        let extraField = []
        /*
        2000-2055685-28
        {
            "dmqMqcHead": "0x04d40700003101000210010400010200411f06080000000b4730a152e40d0a13",
            "relayDispatchQueueSize": [
                131328,
                134618945
            ],
            "ingressChannels": [],
            "egressChannels": []
        }
        {
          recipient: 2004,
          data: '0x000210010400010200411f06080001000b00901ec4bc160a1300010200411f06080001000b00901ec4bc16010300286bee0d010004000103005745b1538d345fe51c4e8c2859c9c09a5e544f99'
        }
        */
        try {
            let hrmpOutboundMsgs = JSON.parse(decoratedVal)
            if (hrmpOutboundMsgs != undefined && hrmpOutboundMsgs.length == 0) return extraField['mpIsEmpty'] = 1
            extraField['mpIsSet'] = 1
            let hrmps = []
            let hrmpRaws = []
            if (Array.isArray(hrmpOutboundMsgs)) {
                for (const hrmp of hrmpOutboundMsgs) {
                    if (hrmp.data != undefined) {
                        let relayChain = indexer.relayChain
                        let relayChainID = paraTool.getRelayChainID(relayChain)
                        let paraIDExtra = paraTool.getParaIDExtra(relayChain)
                        let data = '0x' + hrmp.data.slice(4)
                        var xcmFragments = this.decodeXcmVersionedXcms(indexer, data, `HrmpOutboundMessagesVal`)
                        if (xcmFragments) {
                            for (const xcm of xcmFragments) {
                                var msgHash = xcm.msgHash
                                var hrmpMsg = xcm.msg
                                var msg0 = xcm.msg
                                var msgHex = xcm.hex
                                let beneficiaries = this.getBeneficiary(msg0)
                                //console.log(`[Trace] Outgoing HrmpOutboundMessagesVal [${msgHash}] beneficiaries=${beneficiaries}`)
                                let p = this.getInstructionPath(hrmpMsg)
                                let hrmpDecoded = {
                                    msg: JSON.stringify(hrmpMsg),
                                }
                                let hrmpRaw = {
                                    mpType: mpType,
                                    msgHash: msgHash,
                                    msgHex: msgHex,
                                    msgStr: JSON.stringify(hrmpMsg),
                                    //sentAt: this.parserWatermark, //this is potentially off by 2-4 blocks
                                    sentAt: 0,
                                    chainID: chainID,
                                    chainIDDest: hrmp.recipient + paraIDExtra,
                                    relayChain: relayChain,
                                    beneficiaries: beneficiaries,
                                }
                                if (p) {
                                    hrmpRaw.version = p.version
                                    hrmpRaw.path = p.path
                                }
                                hrmps.push(hrmpDecoded)
                                hrmpRaws.push(hrmpRaw)
                            }
                        }
                    }
                }
            }
            //res["pv"] = hrmps
            res["pv2"] = hrmpRaws
            res["extra"] = extraField
            if (this.debugLevel >= paraTool.debugVerbose) console.log(`[${mpType}] HrmpOutboundMessagesVal`, res)
            return res
        } catch (e) {
            if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`[${mpType}] HrmpOutboundMessagesVal decoratedVal=${decoratedVal}, error`, e)
        }
    }


    processInternalXCMInstructionBeneficiary(dXcmMsg, internalXCM, instructionK, instructionV) {
        let dInstructionV = {}
        switch (instructionK) {
            case "depositAsset":
                //TODO: need to decorate addr
                if (instructionV.beneficiary != undefined) {
                    let destAddress = this.processBeneficiary(false, instructionV.beneficiary)
                    if (destAddress) {
                        internalXCM.destAddress = destAddress
                        dXcmMsg.destAddress.push(destAddress)
                    }
                }
                if (instructionV.dest != undefined) {
                    let destAddress = this.processBeneficiary(false, instructionV.dest)
                    if (destAddress) {
                        internalXCM.destAddress = destAddress
                        dXcmMsg.destAddress.push(destAddress)
                    }
                }
                dInstructionV[instructionK] = instructionV
                internalXCM = dInstructionV
                break;
            default:
                break;
        }
    }

    processXCMV2Beneficiary(dXcmMsg, instructionK, instructionV) {
        let version = dXcmMsg.version
        let dInstructionV = {}
        switch (instructionK) {
            case "depositAsset":
                //TODO: need to decorate addr
                if (instructionV.beneficiary != undefined) {
                    let destAddress = this.processBeneficiary(false, instructionV.beneficiary)
                    if (destAddress) {
                        dXcmMsg.destAddress.push(destAddress)
                    }
                }
                dInstructionV[instructionK] = instructionV
                dXcmMsg[version].push(dInstructionV)
                break;
            case "depositReserveAsset":
                if (Array.isArray(instructionV.xcm)) {
                    for (let i = 0; i < instructionV.xcm.length; i++) {
                        let instructionXCMK = Object.keys(instructionV.xcm[i])[0]
                        let instructionXCMV = instructionV.xcm[i][instructionXCMK]
                        //console.log(`instructionXCMK=${instructionXCMK}, instructionXCMV`, instructionXCMV)
                        this.processInternalXCMInstructionBeneficiary(dXcmMsg, instructionV.xcm[i], instructionXCMK, instructionXCMV)
                    }
                }
                //console.log(`depositReserveAsset final`, JSON.stringify(instructionV,null,4))
                dInstructionV[instructionK] = instructionV
                dXcmMsg[version].push(dInstructionV)
                break;
            default:
                break;
        }
    }

    processXCMV0Beneficiary(dXcmMsg, instructionK, instructionV) {
        let version = dXcmMsg.version
        let dInstructionV = {}
        switch (instructionK) {
            case "teleportAsset":
                if (instructionV.effects != undefined) {
                    //console.log(`instructionV.effects`, instructionV.effects)
                    for (let i = 0; i < instructionV.effects.length; i++) {
                        let instructionXCMK = Object.keys(instructionV.effects[i])[0]
                        let instructionXCMV = instructionV.effects[i][instructionXCMK]
                        //console.log(`instructionXCMK=${instructionXCMK}, instructionXCMV`, instructionXCMV)
                        this.processInternalXCMInstructionBeneficiary(dXcmMsg, instructionV.effects[i], instructionXCMK, instructionXCMV)
                    }
                }
            default:
                dInstructionV[instructionK] = instructionV
                dXcmMsg[version] = dInstructionV
                break
                break;
        }
    }

    processXCMV1Beneficiary(dXcmMsg, instructionK, instructionV) {
        let version = dXcmMsg.version
        let dInstructionV = {}
        switch (instructionK) {
            case "withdrawAsset":
            case "reserveAssetDeposited":
                if (instructionV.effects != undefined) {
                    //console.log(`instructionV.effects`, instructionV.effects)
                    for (let i = 0; i < instructionV.effects.length; i++) {
                        let instructionXCMK = Object.keys(instructionV.effects[i])[0]
                        let instructionXCMV = instructionV.effects[i][instructionXCMK]
                        //console.log(`instructionXCMK=${instructionXCMK}, instructionXCMV`, instructionXCMV)
                        this.processInternalXCMInstructionBeneficiary(dXcmMsg, instructionV.effects[i], instructionXCMK, instructionXCMV)
                    }
                }
            default:
                dInstructionV[instructionK] = instructionV
                dXcmMsg[version] = dInstructionV
                break
                break;
        }
    }


    getBeneficiary(xcmMsg) {
        let dXcmMsg = {}
        let version = Object.keys(xcmMsg)[0]
        let xcmMsgV = xcmMsg[version]

        dXcmMsg.version = version
        dXcmMsg[version] = []
        dXcmMsg.destAddress = []

        let xcmPath = []

        //"withdrawAsset", "clearOrigin","buyExecution", "depositAsset"
        if (version == 'v1' || version == 'v0') {
            let instructionK = Object.keys(xcmMsgV)[0]
            let instructionV = xcmMsgV[instructionK]
            //console.log(`instructionK=${instructionK}, instructionV`, instructionV)
            dXcmMsg[version] = {}
            if (version == 'v1') this.processXCMV1Beneficiary(dXcmMsg, instructionK, instructionV)
            if (version == 'v0') this.processXCMV0Beneficiary(dXcmMsg, instructionK, instructionV)
        } else if (version == 'v2') {
            dXcmMsg[version] = []
            for (let i = 0; i < xcmMsgV.length; i++) {
                let instructionK = Object.keys(xcmMsgV[i])[0]
                xcmPath.push(instructionK)
            }
            for (let i = 0; i < xcmPath.length; i++) {
                let instructionK = xcmPath[i]
                let instructionV = xcmMsgV[i][instructionK]
                //console.log(`getBeneficiary instructionK=${instructionK}, instructionV`, instructionV)
                this.processXCMV2Beneficiary(dXcmMsg, instructionK, instructionV)
            }
        }
        return dXcmMsg.destAddress.join('|')
    }

    //TODO: make this meaningful
    getHrmpUmpKey(indexer, decoratedKey, mpType = false) {
        let chainID = indexer.chainID
        let k = JSON.parse(decoratedKey)
        var out = {};
        out.mpType = mpType
        out.relayChain = indexer.relayChain
        if (mpType == 'ump') {
            //para -> relay
            out.chainID = chainID
            out.chainIDDest = paraTool.getRelayChainID(indexer.relayChain)
        } else if (mpType == 'hrmp') {
            //para -> para
            out.chainID = chainID
        }
        return out
    }

    getSystemAccountKey(indexer, decoratedKey) {
        //System:Account
        //["pJhw2zYqTnW9m2ddvJCE3B2493ibxbRwJ7ksDTLzf5raEpv"]
        let chainID = indexer.chainID
        let k = JSON.parse(decoratedKey)
        var out = {};
        out.accountID = k[0]; //accountID
        let tokenSymbol = indexer.getChainSymbol(chainID)
        if (tokenSymbol != "unknown") {
            //only process known chains
            out.asset = {
                Token: tokenSymbol
            }; // native token
            out.symbol = tokenSymbol
        }
        return out
    }

    getSystemAccountVal(indexer, decoratedVal) {
        let v = JSON.parse(decoratedVal)
        let res = {}
        let extraField = []
        if (v.data != undefined) {
            let data = v.data
            for (const f of Object.keys(data)) {
                extraField[f] = paraTool.dechexToIntStr(data[f])
            }
            delete v.data
        }
        // generate frozen with miscFrozen
        //If the funds are to be used for transfers, then the usable amount is the free amount minus any misc_frozen funds.
        //If the funds are to be used to pay transaction fees, the usable amount would be the free funds minus fee_frozen
        extraField["frozen"] = extraField["miscFrozen"]
        res["pv"] = v
        res["extra"] = extraField
        return res
    }

    // decoratedKey: ["100","hJHfe3mtq3Rx4gcUGtSjXwL4Wmq3Krtt3uumUhXG1rTq9WwZg"]
    getAssetsAccountKey(indexer, decoratedKey) {
        let k = JSON.parse(decoratedKey)
        var out = {};
        let assetID = this.cleanedAssetID(k[0]); //currencyID
        this.setAssetSymbolAndDecimals(indexer, assetID, out)
        out.accountID = k[1]; //account
        //console.log(`getAssetsAccountKey`, out)
        return out
    }

    /*
    {
      balance: 5,000,000,000,000,000,000
      isFrozen: false
      reason: Consumer
      extra: null
    }
    */

    //TODO
    getAssetsAccountVal(indexer, decoratedVal) {
        let v = JSON.parse(decoratedVal)
        //let data = v.data
        let res = {}
        let extraField = []
        // TODO: REENABLE this using NEW paraTool.dechexToIntStr abstraction
        if (v != undefined && v.balance != undefined) {
            extraField["free"] = paraTool.dechexToIntStr(v.balance)
        }

        res["pv"] = v
        res["extra"] = extraField
        return res
    }

    //TODO:
    getTokensAccountsKey(indexer, decoratedKey) {
        //Tokens:Accounts
        // {"map":{"hashers":["Blake2_128Concat","Twox64Concat"],"key":"344","value":"348"}} (344 = (accountID, currencyID)
        /* https://github.com/open-web3-stack/open-runtime-module-library/blob/master/tokens/src/lib.rs#L282
        pub type Accounts<T: Config> = StorageDoubleMap<_, Blake2_128Concat, T::AccountId, Twox64Concat, T::CurrencyId, AccountData<T::Balance>, ValueQuery, >; */
        // ["pJhw2zYqTnW9m2ddvJCE3B2493ibxbRwJ7ksDTLzf5raEpv",{"DexShare":[{"Token":"KAR"},{"Token":"KSM"}]}]
        let k = JSON.parse(decoratedKey)
        var out = {};
        out.accountID = k[0]; //accountID
        out.asset = k[1]; //currencyID
        return out
    }

    //TODO
    getTokensAccountsVal(indexer, decoratedVal, val, p, s) {
        let res = {}
        let extraField = []
        let decoratedValBlackList = ["VestingBalance", "AveragePriceAlreadyEnabled"]
        let shouldSkip = decoratedValBlackList.includes(decoratedVal)
        try {
            if (!shouldSkip) { //0x00?
                let v = JSON.parse(decoratedVal)
                for (let f in v) {
                    extraField[f] = paraTool.dechexToIntStr(v[f])
                }
            }
        } catch (e) {
            if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`p:s=${p}:${s}, [${val}, ${decoratedVal}] getBalanceVal error`, e)
        }
        res["pv"] = ''
        res["extra"] = extraField
        return res
    }

    // check for multisig mapping
    processMultisig(indexer, extrinsic, feed, fromAddress) {
        let section = extrinsic.section;
        if (section == 'multiSig') section = 'multisig'
        let method = extrinsic.method;
        let section_method = `${section}:${method}`
        let params = feed.params
        switch (section_method) {
            //case 'multisig:cancelAsMulti': redundant
            case 'multisig:approveAsMulti': //0xc3d03cc76fbea58e1d5582dc787afa6e5625bf7931143813d2b94da59e19c644
            case 'multisig:asMulti':
                if (fromAddress != undefined && Array.isArray(params.other_signatories) && params.threshold != undefined) {
                    let m = paraTool.computeMultisig(fromAddress, params.other_signatories, params.threshold)
                    //if (this.debugLevel >= paraTool.debugTracing) console.log(`processMultisig [${section_method}]`, m)
                    return m
                }
                break;
            case 'multisig:asMultiThreshold1': //0xaf11adbfcacf713b2298e2ee946c5be8c6c7921b29643319d9bb766614f1b759
                //caller, addresses, threshold
                if (fromAddress != undefined && Array.isArray(params.other_signatories)) {
                    let m = paraTool.computeMultisig(fromAddress, params.other_signatories, 1)
                    //if (this.debugLevel >= paraTool.debugTracing) console.log(`processMultisig [${section_method}]`, m)
                    return m
                }
                break;

            default:
                //console.log(`unknown`)
                break;
        }
        return false;
    }

    //TODO: fix this
    getInstructionPath(instruction) {
        let v = Object.keys(instruction)
        let version = false
        let res = false
        let instructionPath = []
        if (v.length == 1) {
            version = v[0]
            let instructions = instruction[version]
            for (let i = 0; i < instructions.length; i++) {
                let instruction = instructions[i]
                let instructionSet = Object.keys(instruction)
                if (instructionSet.length == 1) {
                    instructionPath.push(instructionSet[0])
                }
            }
            res = {
                version: version,
                path: JSON.stringify(instructionPath),
            }
        }
        return res
    }


    // cross-chain transfers initiated by users are stored in (a) xcmtransfer table (b) xcmtransferdestcandidate
    // (a) processOutgoingXCM - initiated by user: processOutgoingXTokens/processOutgoingXcmPallet
    // (b) processIncomingXCM - completed by dest: processIncomingXCMSignal / processIncomingAssetSignal
    // The above are flushed in flushXCM (in two different indexing processes)
    // (c) matched in matchXCM by xcmtransfer.destAddress = xcmtransferdestcandidate.fromAddress
    processOutgoingXCM(indexer, extrinsic, feed, fromAddress, section = false, method = false, args = false) {
        let module_section = section;
        let module_method = method
        if (section == false && section == false) {
            module_section = extrinsic.section;
            module_method = extrinsic.method;
            args = extrinsic.params
        }
        let section_method = `${module_section}:${module_method}`
        //let outgoingXcmList = [];
        if (args.calls != undefined) { // this is an array
            //console.log(`[${extrinsic.extrinsicID}] descend into calls callLen=${args.calls.length}`)
            let i = 0;
            for (const c of args.calls) {
                let call_section = c.section;
                let call_method = c.method;
                let c_args = c.args
                if (c.call != undefined) {
                    //go one level deep into struct by removing call
                    call_section = c.call.section
                    call_method = c.call.method
                    c_args = c.call.args
                }
                //console.log(`[${extrinsic.extrinsicID}] call=${i}, call_section_method=(${call_section}:${call_method}) c=`, c);
                i++;
                this.processOutgoingXCM(indexer, extrinsic, feed, fromAddress, call_section, call_method, c_args)
            }
        } else if (args.call != undefined) {
            let call = args.call
            let call_args = call.args
            let call_section = call.section;
            let call_method = call.method;
            let isHexEncoded = (typeof call === 'object') ? false : true
            //console.log(`[${extrinsic.extrinsicID}] descend into call`, call)
            if (!isHexEncoded && call_args != undefined) {
                //if (this.debugLevel >= paraTool.debugTracing) console.log(`[${extrinsic.extrinsicID}] descend into call=${call}, call_section=${call_section}, call_method=${call_method}, call_args`, call_args)
                this.processOutgoingXCM(indexer, extrinsic, feed, fromAddress, call_section, call_method, call_args)
            } else {
                //if (this.debugLevel >= paraTool.debugTracing) console.log(`[${extrinsic.extrinsicID}] skip call=${call}, call_section=${call_section}, call_method=${call_method}, call.args`, call_args)
            }
        }
        switch (module_section) {
            case 'xTransfer':
                let outgoingXcmList0 = this.processOutgoingXTransfer(indexer, extrinsic, feed, fromAddress, section_method, args)
                //if (this.debugLevel >= paraTool.debugInfo) console.log(`generic processOutgoingXCM xTransfer`, outgoingXcmList0)
                //return outgoingXcmList
                break;
            case 'xTokens':
                let outgoingXcmList1 = this.processOutgoingXTokens(indexer, extrinsic, feed, fromAddress, section_method, args)
                //if (this.debugLevel >= paraTool.debugInfo) console.log(`generic processOutgoingXCM xTokens`, outgoingXcmList1)
                //return outgoingXcmList
                break;
            case 'xcmPallet':
                let outgoingXcmList2 = this.processOutgoingXcmPallet(indexer, extrinsic, feed, fromAddress, section_method, args)
                //if (this.debugLevel >= paraTool.debugInfo) console.log(`generic processOutgoingXcmPallet xcmPallet`, outgoingXcmList2)
                //return outgoingXcmList
                break;
            case 'polkadotXcm':
                let outgoingXcmList3 = this.processOutgoingPolkadotXcm(indexer, extrinsic, feed, fromAddress, section_method, args)
                //if (this.debugLevel >= paraTool.debugInfo) console.log(`generic processOutgoingXCM polkadotXcm`, outgoingXcmList3)
                //return outgoingXcmList
                break;
            default:
                //console.log(`unknown`)
                //return outgoingXcmList
                break;
        }
    }

    processIncomingXCMMessages(indexer, extrinsic, extrinsicID, events, isTip = false, finalized = false) {
        let module_section = extrinsic.section;
        let module_method = extrinsic.method;
        let section_method = `${module_section}:${module_method}`
        if (section_method == 'parachainSystem:setValidationData') {
            //console.log(`[${extrinsic.extrinsicID}] ${section_method} found`)
            this.processValidationData(indexer, extrinsic, extrinsicID, events, finalized)
        } else if (section_method == 'paraInherent:enter') {
            //console.log(`[${extrinsic.extrinsicID}] ${section_method} found`)
            this.processParainherentEnter(indexer, extrinsic, extrinsicID, events, isTip, finalized)
        }
    }

    dedupeRawCandidates(rawCandidates) {
        //remove dup token/currency events (22090 2686996)
        let dedupedCandidates = []
        let covered = {}
        for (const rawCandidate of rawCandidates) {
            let f = rawCandidate.candidate
            let k = `${f.fromAddress}-${f.amountReceived}-${f.xcmSymbol}`
            if (covered[k] == undefined) {
                covered[k] = 1
                dedupedCandidates.push(rawCandidate)
            }
        }
        return dedupedCandidates
    }

    processRawDestCandidates(indexer, rawCandidates, rawWithdrawCandidates) {
        let candidates = []
        let dedupedCandidates = this.dedupeRawCandidates(rawCandidates)
        let rawCandidateCnt = dedupedCandidates.length
        if (rawCandidateCnt == 0) return candidates

        let c1 = dedupedCandidates[rawCandidateCnt - 1].candidate
        let c1_caller = dedupedCandidates[rawCandidateCnt - 1].caller
        let xcmTeleportFees = c1.amountReceived
        let feeRecipient = c1.fromAddress
        let feeEventID = c1.eventID
        let feepayingSymbol = c1.xcmSymbol
        let beneficiary = indexer.getBeneficiaryFromMsgHash(c1.msgHash)
        let authorPubkey = (this.author) ? paraTool.getPubKey(this.author) : false
        console.log(`[MsgHash ${c1.msgHash}], beneficiary=${beneficiary}`)
        if (rawCandidateCnt == 1) {
            // Reap 0x890a6807bd375ffbda017016002cfefb9f85aa4df19d5b27cf101119aca69cd2 (0 13209424)
            // Not reaped 0x5ff106dc2fd9cc6fca65a0c4675c2fe504d8c1e82a53e61bfe247f3966dc50fc (2006 2865334)
            let reaped = false
            /*
            definition of reap:
             - if authorPubkey is known, check authorPubkey is equal to feeRecipient
             - check feeRecipient not equal to modlpy/trsry
            */
            let knownTreasury = ['0x6d6f646c70792f74727372790000000000000000000000000000000000000000', '0x6d6f646c70792f74727372790000000000000000']
            if (beneficiary && beneficiary != feeRecipient) reaped = false
            if (authorPubkey && authorPubkey == feeRecipient) reaped = true
            if (knownTreasury.includes(feeRecipient)) reaped = true
            if (reaped) {
                // marking as null
                c1.fromAddress = '0x'
                c1.amountReceived = 0
                // add new field
                c1.feeEventID = feeEventID
                c1.xcmTeleportFees = xcmTeleportFees
                c1.feeReceivingAddress = feeRecipient
                c1.isFeeItem = 1
                c1.reaped = 1
                c1.amountReaped = 0
                if (rawWithdrawCandidates.length > 0) {
                    // assume the first rec is the deposit amount
                    let w0 = rawWithdrawCandidates[0].candidate
                    let amountReaped = w0.amountReceived - xcmTeleportFees
                    if (amountReaped > 0) c1.amountReaped = amountReaped
                }
            } else {
                //no fee transfer 2006 2865334
                let c0 = dedupedCandidates[rawCandidateCnt - 1].candidate
                let c0_caller = dedupedCandidates[rawCandidateCnt - 1].caller
                c0.feeEventID = feeEventID
                c0.xcmTeleportFees = 0
                c0.feeReceivingAddress = feeRecipient
                c0.isFeeItem = 1
                c0.reaped = 0
                c0.amountReaped = 0
            }

            candidates.push({
                candidate: c1,
                caller: c1_caller
            })
        } else if (rawCandidateCnt == 2) {
            // Normal case - single asset 0x5e59a12ab1cc9229a14fc67d1f7f8303643ac2d1f6e0df611b6d71e9864f4b87 (2 16463036)
            let c0 = dedupedCandidates[0].candidate
            let c0_caller = dedupedCandidates[0].caller
            if (c0.xcmSymbol == c1.xcmSymbol) {
                c0.feeEventID = feeEventID
                c0.xcmTeleportFees = xcmTeleportFees
                c0.feeReceivingAddress = feeRecipient
                c0.isFeeItem = 1
                c0.reaped = 0
                c0.amountReaped = 0
            }
            candidates.push({
                candidate: c0,
                caller: c0_caller
            })
        } else {
            // MultiAssets case 0x92bec041b54422d08e436be1a8db247d5f4466e20c299647405fed2261bc5ba1 (2004 2858049)
            //console.log(`[${feeEventID}] ${feepayingSymbol} feeRecipient=${feeRecipient}, xcmTeleportFees=${xcmTeleportFees}`)
            for (let i = 0; i < rawCandidateCnt - 1; i++) {
                let c0 = dedupedCandidates[i].candidate
                let c0_caller = dedupedCandidates[i].caller
                if (c0.xcmSymbol == feepayingSymbol) {
                    // fee paying.
                    c0.feeEventID = feeEventID
                    c0.xcmTeleportFees = xcmTeleportFees
                    c0.feeReceivingAddress = feeRecipient
                    c0.isFeeItem = 1
                    c0.reaped = 0
                    c0.amountReaped = 0
                } else {
                    // not fee paying but still mark it with feeEventID?
                    c0.feeEventID = feeEventID
                    c0.xcmTeleportFees = 0
                    c0.feeReceivingAddress = feeRecipient
                    c0.isFeeItem = 0
                    c0.reaped = 0
                    c0.amountReaped = 0
                }
                candidates.push({
                    candidate: c0,
                    caller: c0_caller
                })
            }
        }
        return candidates
    }

    processIncomingXCM(indexer, extrinsic, extrinsicID, events, isTip = false, finalized = false) {

        let xcmCandidates = [];
        //IMPORTANT: reset mpReceived at the start of every unsigned extrinsic
        this.mpReceived = false;
        this.mpReceivedHashes = {};
        //console.log(`[${extrinsicID}] processIncomingXCM start`, `mpReceived=${this.mpReceived}`)

        //step0. parse incoming messages (raw)
        this.processIncomingXCMMessages(indexer, extrinsic, extrinsicID, events, isTip, finalized)

        //step1. parse incoming transfer heuristically
        for (let i = 0; i < events.length; i++) {
            let e = events[i]
            this.processIncomingXCMSignal(indexer, extrinsicID, e, i, finalized)
        }
        if (this.mpReceived) {
            let idxKeys = Object.keys(this.mpReceivedHashes)
            let prevIdx = 0;
            //console.log(`[${extrinsicID}] idxKeys`, idxKeys)
            //TODO: blacklist: author, 0x6d6f646c70792f74727372790000000000000000 (modlpy/trsry)
            //conjecture: the last event prior to msgHash is typically the "fee" event either going to blockproducer or trsry
            for (const idxKey of idxKeys) {
                //let initialStartIdx = parseInt(prevIdx)
                //let idealStartIdx = this.computeIncomingXCMStart(events, initialStartIdx, endIdx)
                this.mpReceivedHashes[idxKey].startIdx = parseInt(prevIdx) //MK want better startIdx here
                this.mpReceivedHashes[idxKey].endIdx = parseInt(idxKey)

                let mpState = this.mpReceivedHashes[idxKey]
                let eventRange = events.slice(mpState.startIdx, mpState.endIdx)
                let eventRangeLengthWithFee = eventRange.length
                //let lastEvent = eventRange[-1]
                for (let i = 0; i < eventRange.length; i++) {
                    let ev = eventRange[i]
                    //filter on xcmpallet(AssetsTrapped) - need to mark mpState as fail
                    if (this.xcmAssetTrapFilter(`${ev.section}(${ev.method})`)) {
                        //not sure what does the hash mean ...
                        mpState.success = false
                        mpState.errorDesc = `complete`
                        mpState.description = `${ev.method}`
                        mpState.defaultEventID = `${mpState.eventID}` // original eventID
                        //mpState.description = `Executed ${mpState.eventID}`
                        mpState.eventID = ev.eventID // update eventID with AssetsTrapped
                        this.mpReceivedHashes[idxKey] = mpState
                        if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`[${this.parserBlockNumber}] [${this.parserBlockHash}] [${mpState.msgHash}] [${ev.eventID}] asset trapped!`)
                    }
                    if (this.xcmStartFilter(`${ev.section}(${ev.method})`)) {
                        mpState.startIdx += i
                        if (this.debugLevel >= paraTool.debugInfo) console.log(`detected idealStart eventID=${ev.eventID}, adjustedIdx=${i}, updateEventRange[${mpState.startIdx}, ${mpState.endIdx}]`)
                        eventRange = events.slice(mpState.startIdx, mpState.endIdx)
                        eventRangeLengthWithFee = eventRange.length
                    }
                }
                //console.log(`mpReceived [${this.parserBlockNumber}] [${this.parserBlockHash}] [${mpState.msgHash}] range=[${mpState.startIdx},${mpState.endIdx})`, mpState)
                //console.log(`mpReceived [${this.parserBlockNumber}] [${this.parserBlockHash}] [${mpState.msgHash}] eventRange`,eventRange)
                //update xcmMessages
                indexer.updateMPState(mpState)
                //only compute candidate mpState is successful
                if (mpState.success === true) {
                    let candidateCnt = 0
                    let rawCandidates = []
                    let rawWithdrawCandidates = []
                    let candidates = []
                    for (let i = 0; i < eventRangeLengthWithFee; i++) {
                        let e = eventRange[i]
                        let [candidate, caller] = this.processIncomingAssetDepositSignal(indexer, extrinsicID, e, mpState, finalized)
                        //console.log(`processIncomingAssetDepositSignal candidate`, candidate)
                        if (candidate) {
                            candidateCnt++
                            rawCandidates.push({
                                candidate: candidate,
                                caller: caller
                            })
                        }
                        let [withdrawCandidate, withdrawCaller] = this.processIncomingAssetWithdralSignal(indexer, extrinsicID, e, mpState, finalized)
                        if (withdrawCandidate) {
                            candidateCnt++
                            rawWithdrawCandidates.push({
                                candidate: withdrawCandidate,
                                caller: withdrawCaller
                            })
                        }
                    }
                    if (rawCandidates.length >= 0) {
                        xcmCandidates = this.processRawDestCandidates(indexer, rawCandidates, rawWithdrawCandidates)
                    }
                    for (const c of candidates) {
                        //indexer.updateXCMTransferDestCandidate(c.candidate, c.caller, isTip, finalized)
                    }
                    //console.log(`[Exclusive] mpReceived [${this.parserBlockNumber}] [${this.parserBlockHash}] [${mpState.msgHash}] range=[${mpState.startIdx},${mpState.endIdx}] Found Candidate=${candidateCnt}`)
                } else {
                    //console.log(`[${this.parserBlockNumber}] [${this.parserBlockHash}] [${mpState.msgHash}] skipped. (${mpState.errorDesc})`)
                }
                prevIdx = parseInt(idxKey) + 1
            }
        }
        return xcmCandidates
    }

    //channelMsgIndex: extrinsicID-mpType-receiverChainID-senderChainID-msgIdx
    //mpType: ump(para->relay)
    processParainherentEnter(indexer, extrinsic, extrinsicID, events, isTip = false, finalized = false) {
        /*
        "params": {
          "data": {
            "bitfields": [...],
            "backedCandidates": [
            {
              "candidate": {
                "descriptor": {
                  "paraId": 2000,
                  "relayParent": "0xc0492a68d30b3029e111af2614ada613a7461972990d6cbd210452914679d9af",
                  "collator": "0x662445d3ca185a908a7a7ac7606c39b870278f22869806c02437aeefb9b81b12",
                  "persistedValidationDataHash": "0x7d01a175d1f36d353953b74600400cf509ef02cbc1a058eec9f8fb295b80d709",
                  "povHash": "0x5fd74702f76f571eb850ccef972e451453db44a3631e7762a37d750eb88ed1ba",
                  "erasureRoot": "0xdab91ae1101d628c9729b2713bc3d50bf173ce8389fc015abcf77b5ca9022a5d",
                  "signature": "0xc846090a97d19c78fd06fb1af64f43d921d256f17805ce0d68c7e6078a495069a962cd924f0f67972eecd0c2e840b73243f92156d92a98fe7cd7e819760e9e89",
                  "paraHead": "0xa395e9d16ef7e681326cc3784e34a818331f76bb7db9e9a50a720d5aa54c1bd8",
                  "validationCodeHash": "0x794594aa9f112906b44176c02e9d0d41af7487ef3580a9ce8a5b9477bb0c8aeb"
                },
                "commitments": {
                  "upwardMessages": [
                      "0x021000040000000007dc83b012120a130000000007dc83b01212010700f2052a010d01000400010100c656dff3da37a23aa2600edeeb0cd141bf8170eea28ae3265bc310196f48464b"
                    ],
                  "horizontalMessages": [],
                  "newValidationCode": null,
                  "headData": "0xcf3f3aff045930e1642a5b2a3999f48aca848a9276e6ca7820b61f4c6b185f594a264000c3230cca0e320a7602031c65ed4010fe7483152b94d506fe2d59dfb7aece621baf7e5308ded36d677b13f9adaf8d1390f202e31d1f3dc0aa96396ef6a776a3ac08066175726120fae33508000000000561757261010176e77fd321fe9fe318072acecc141f5daf086c17ae1c55dd83729f8c4c0f3a05ce347dfdc08b90efb37fe7176b15c597fb68eb21f24441f5ca9c962280be298d",
                  "processedDownwardMessages": 0,
                  "hrmpWatermark": 10377454
                },
              "validityVotes": [],
              "validatorIndices": "0x1f"
            },
            ...
          ]
          {
            "eventID": "0-12484234-1-1",
            "section": "paraInclusion",
            "method": "CandidateIncluded",
            "data": [
              {
                "descriptor": {
                  "paraId": 1000,
                  "relayParent": "0x40be74436db126b9e81d5a1f0fe385335d9174d98cfe86e8f5ea2ab22c1c204c",
                  "collator": "0xc43af01cb2265b0fb18681bd6e223a9c920cff12a453f614b40df42597bf4e05",
                  "persistedValidationDataHash": "0xb5c4bbe34b9c2798ea35de0a285d42d7cdb64265db316579edd4aebaa73ab940",
                  "povHash": "0xbddda78d1f3c04e01da57c35f24bcae330f16f7d4fe444d6cba5bfdd9223f73e",
                  "erasureRoot": "0xe005c22f322ecf96863a50c16870163eb14ce5704d798cb17ec6d99df677c68f",
                  "signature": "0x0e1fb3171c4906033ca627d1cd08ea61d587c7033d4ad38d61ce2eb42080d60b9d4911733433097576c02a68b74d4bcff7c503e3d25ff3aa38fd87a8aced9f8c",
                  "paraHead": "0xd309360cb8921d83aad00ad7ca66e5d8eccc65a33e4b01ef5110a03c4d1f1a20",
                  "validationCodeHash": "0x4c2a8f587d02cb03f8e1c7cead6a8afd64da21700010a3863cac9750bf2614cb"
                },
                "commitmentsHash": "0x216ef3d97d8ddb1dcb613ec78e7ca2fd79060cf22911f991eada61b5b6c547c0"
              },
              "0xdc5844a8700d0588f2a71784fd1f11ed7fdf3e33e069fb7dae79388017be2e0346dd8e00ba3e09edf026ff6b1038c133c44c7b1f170ad27fc19cd0959c6822c11b630095a509fca749fff50e5f20919a34f225bd404599cc72dced9c59797aa35cfcae0c08066175726120792b46080000000005617572610101a89dadec63ef5d9ec03f76edc121e43d4c7425b341e3f64834bfc69a83f1fac39fe92fe285b78209193e9bc7c1c003877056b469f2007db4478ecc2aae89310c",
              0,
              19
            ]
          }
          {
            "eventID": "0-12484233-1-10",
            "section": "paraInclusion",
            "method": "CandidateBacked",
            "data": [
              {
                "descriptor": {
                  "paraId": 1000,
                  "relayParent": "0x40be74436db126b9e81d5a1f0fe385335d9174d98cfe86e8f5ea2ab22c1c204c",
                  "collator": "0xc43af01cb2265b0fb18681bd6e223a9c920cff12a453f614b40df42597bf4e05",
                  "persistedValidationDataHash": "0xb5c4bbe34b9c2798ea35de0a285d42d7cdb64265db316579edd4aebaa73ab940",
                  "povHash": "0xbddda78d1f3c04e01da57c35f24bcae330f16f7d4fe444d6cba5bfdd9223f73e",
                  "erasureRoot": "0xe005c22f322ecf96863a50c16870163eb14ce5704d798cb17ec6d99df677c68f",
                  "signature": "0x0e1fb3171c4906033ca627d1cd08ea61d587c7033d4ad38d61ce2eb42080d60b9d4911733433097576c02a68b74d4bcff7c503e3d25ff3aa38fd87a8aced9f8c",
                  "paraHead": "0xd309360cb8921d83aad00ad7ca66e5d8eccc65a33e4b01ef5110a03c4d1f1a20",
                  "validationCodeHash": "0x4c2a8f587d02cb03f8e1c7cead6a8afd64da21700010a3863cac9750bf2614cb"
                },
                "commitmentsHash": "0x216ef3d97d8ddb1dcb613ec78e7ca2fd79060cf22911f991eada61b5b6c547c0"
              },
              "0xdc5844a8700d0588f2a71784fd1f11ed7fdf3e33e069fb7dae79388017be2e0346dd8e00ba3e09edf026ff6b1038c133c44c7b1f170ad27fc19cd0959c6822c11b630095a509fca749fff50e5f20919a34f225bd404599cc72dced9c59797aa35cfcae0c08066175726120792b46080000000005617572610101a89dadec63ef5d9ec03f76edc121e43d4c7425b341e3f64834bfc69a83f1fac39fe92fe285b78209193e9bc7c1c003877056b469f2007db4478ecc2aae89310c",
              0,
              19
            ]
          }
        */
        // claim: parainclusion(CandidateBacked) -> parainclusion(CandidateIncluded)
        // a block must be "backed" before it can be included
        // destSentAt correspond to parainclusion(CandidateIncluded) at sent
        // backedCandidate.relayParent is same as source 'sentAt'!
        let chainID = indexer.chainID
        try {
            let blockNumber = this.parserBlockNumber
            let activeChains = []
            let parainclusionCandidateBackedList = events.filter((ev) => {
                return this.paraInclusionCandidateBackedFilter(`${ev.section}(${ev.method})`);
            })
            let parainclusionCandidateIncludedList = events.filter((ev) => {
                return this.paraInclusionCandidateIncludedFilter(`${ev.section}(${ev.method})`);
            })
            for (const parainclusionCandidateBacked of parainclusionCandidateBackedList) {
                let backedCandidate = parainclusionCandidateBacked.data[0].descriptor
                let chainID = paraTool.getChainIDFromParaIDAndRelayChain(backedCandidate.paraId, indexer.relayChain)
                let relayParent = backedCandidate.relayParent
                /*
                if (indexer.trailingBlockHashs[relayParent] != undefined){
                    backedCandidate.sentAt2 = indexer.trailingBlockHashs[relayParent]
                }
                */
                activeChains.push(chainID)
                //console.log(`[${this.parserBlockNumber}] [${this.parserBlockHash}] [${chainID}] backedCandidate`, backedCandidate)
            }
            for (const parainclusionCandidateIncluded of parainclusionCandidateIncludedList) {
                let includedCandidate = parainclusionCandidateIncluded.data[0].descriptor
                let chainID = paraTool.getChainIDFromParaIDAndRelayChain(includedCandidate.paraId, indexer.relayChain)
                let relayParent = includedCandidate.relayParent
                /*
                if (indexer.trailingBlockHashs[relayParent] != undefined){
                    includedCandidate.sentAt2 = indexer.trailingBlockHashs[relayParent]
                }
                */
                activeChains.push(chainID)
                //console.log(`[${this.parserBlockNumber}] [${this.parserBlockHash}] [${chainID}] includedCandidate`, includedCandidate)
            }
            indexer.updateActiveParachains(activeChains, isTip, finalized)
        } catch (err) {
            if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`processParainherentEnter event error`, err)
        }
        try {
            if (extrinsic.params != undefined && extrinsic.params.data != undefined) {
                let data = extrinsic.params.data
                let backedCandidates = data.backedCandidates
                //console.log(`[${extrinsic.extrinsicID}] backedCandidates`, backedCandidates)
                let relayChain = indexer.relayChain
                let relayChainID = paraTool.getRelayChainID(relayChain)
                let paraIDExtra = paraTool.getParaIDExtra(relayChain)
                for (let k = 0; k < backedCandidates.length; k++) {
                    let candidate = backedCandidates[k].candidate
                    let candidateDescriptor = candidate.descriptor
                    let candidateCommitments = candidate.commitments
                    /*
                    let validityVotes = backedCandidates[k].validityVotes
                    let validatorIndices = backedCandidates[k].validatorIndices
                    */
                    //console.log(`[${extrinsic.extrinsicID}] backedCandidates[${k}] candidateDescriptor`, candidateDescriptor)
                    //console.log(`[${extrinsic.extrinsicID}] backedCandidates[${k}] candidateCommitments`, candidateCommitments)
                    let paraID = paraTool.dechexToInt(candidateDescriptor.paraId)
                    let paraChainID = paraID + paraIDExtra
                    let hrmpWatermark = paraTool.dechexToInt(candidateCommitments.hrmpWatermark) // this is equivalent to sentAt?
                    for (let j = 0; j < candidateCommitments.upwardMessages.length; j++) {
                        let upwardMsg = candidateCommitments.upwardMessages[j]
                        let channelMsgIndex = `${extrinsic.extrinsicID}-ump-${chainID}-${paraChainID}-${j}`
                        //if (this.debugLevel >= paraTool.debugTracing) console.log(`[${channelMsgIndex}] upwardMessages[${j}]`, upwardMsg)
                        let uMsgs = this.decodeUpwardMsg(indexer, upwardMsg, hrmpWatermark, channelMsgIndex)
                        if (uMsgs) {
                            for (const uMsg of uMsgs) {
                                indexer.updateXCMChannelMsg(uMsg, this.parserBlockNumber, this.parserTS)
                                indexer.updateXCMMsg(uMsg, finalized)
                            }
                        }
                    }
                }
            }
        } catch (e) {
            if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`processParainherentEnter error`, e)
        }
    }

    //channelMsgIndex: extrinsicID-mpType-receiverChainID-senderChainID-msgIdx
    //mpType: xcmp(para <-> para), dmp(relay->para)
    processValidationData(indexer, extrinsic, extrinsicID, events, finalized = false) {
        //0x91a66642563ab6c1273f7456260af0f45068d4d360dc805e209678cc27475f51 (horizontalMessages)
        //0x38459bfc92df3ec16510f9ccf964e0985db89f131c5c4d2e5d0fe9b82b5ec839 (horizontalMessages)
        //0xf17e8c4998b9bf9e88ec31eb3bd081a57813b0d695710fc0d27f35aac8396a45 (downwardMessages)
        //https://github.com/PureStake/xcm-tools/blob/girazoki-decode-xcm/scripts/decode-xcm-relay.ts
        //sent at is the block number of source chain
        /*
      "validationData": {
        "parentHead": "0xc120179968d58325ba7bd127d005e144673b41eec5ef2007fe763fe4a3ca86d6066633009b86aa139d7bedb6b4e8e16c08fa0d0db372a368319f05ebc1f2e6ffe84ec1559370e0ca6eea07d2970471f7fa8fd6eddb80f9d94202dd0246114cbed296df5a0806617572612058926b10000000000561757261010188d98291318cc77d83907c1bf517cfb2f86dad1619989910e7c7d715969dc62cf28b3e2690f96fb7cd4f784fea268f0760b116a64a2272f5149aa413b7657785",
        "relayParentNumber": 12743570,
        "relayParentStorageRoot": "0xc8ce2c27cb87b2bf8e94d93f2207a5fecbcbb491819d6333e1c4dba1a2188dbf",
        "maxPovSize": 5242880
      },
      "relayChainState": {
        "trieNodes": [..]
      },
      "downwardMessages": [
        {
         "sentAt": 12738903,
         "msg": "0x010104000100000f0078458dca5c010807000100000f0078458dca5c01000000000000000000286bee000000000100010100010000000001010042c37a8f52d17c05bd1f5f4d7b751daae60841b6554bdbc043dd5319fbc5c21b"
        }
      ]
      "horizontalMessages": {
        "2000": [
          {
            "sentAt": 12743570,
            "data": "0x00021000040000010608000c000b00204aa9d1010a130000010608000c000b00204aa9d101010700f2052a010d01000400010100b2d6460991d870119c2b5f820f977bb0c5a0a410eca38db44bc7817dc5507749"
          }
          ],
        "2023": []
        }
      }
    }
    */
        let chainID = indexer.chainID
        try {
            if (extrinsic.params != undefined && extrinsic.params.data != undefined) {
                let data = extrinsic.params.data
                try {
                    let hrmpWatermark = data.validationData.relayParentNumber
                    let relayParentStateRoot = data.validationData.relayParentStorageRoot
                    this.parserWatermark = hrmpWatermark
                    this.setRelayParentStateRoot(relayParentStateRoot)
                    //if (this.debugLevel >= paraTool.debugVerbose) console.log(`[${this.parserBlockNumber}] Update hrmpWatermark from extrinsic: ${hrmpWatermark} (${relayParentStateRoot})`)
                    //update all outgoing trace msg with this hrmp
                    indexer.fixOutgoingUnknownSentAt(hrmpWatermark, finalized);
                } catch (err1) {
                    console.log(`unable to find watermarkBN`, err1.toString())
                }

                let downwardMessages = data.downwardMessages // this is from relaychain
                let relayChain = indexer.relayChain
                let relayChainID = paraTool.getRelayChainID(relayChain)
                let paraIDExtra = paraTool.getParaIDExtra(relayChain)
                for (let j = 0; j < downwardMessages.length; j++) {
                    let downwardMsg = downwardMessages[j]
                    let channelMsgIndex = `${extrinsic.extrinsicID}-dmp-${chainID}-${relayChainID}-${j}`
                    //console.log(`[${channelMsgIndex}] downwardMessages[${j}]`, downwardMsg)
                    //console.log(`[${extrinsic.extrinsicID}] downwardMessages[${j}]`, downwardMsg)
                    let dMsgs = this.decodeDownwardMsg(indexer, downwardMsg, channelMsgIndex)
                    //console.log(`decodeDownwardMsg downwardMessages[${j}]`, dMsgs)
                    if (dMsgs) {
                        for (const dMsg of dMsgs) {
                            indexer.updateXCMChannelMsg(dMsg, this.parserBlockNumber, this.parserTS)
                            indexer.updateXCMMsg(dMsg, finalized)
                        }
                    }
                }
                let horizontalMessages = data.horizontalMessages // this is from para siblings
                for (const paraSibling of Object.keys(horizontalMessages)) {
                    let paraSiblingMsgs = horizontalMessages[paraSibling]
                    //let channelMsgPrefix = `${extrinsic.extrinsicID}-xcmp-${paraIDExtra+paraSibling}`
                    for (let k = 0; k < paraSiblingMsgs.length; k++) {
                        let horizontalMsg = paraSiblingMsgs[k]
                        let siblingChainID = paraTool.dechexToInt(paraSibling) + paraIDExtra
                        let channelMsgIndex = `${extrinsic.extrinsicID}-xcmp-${chainID}-${siblingChainID}-${k}`
                        //if (this.debugLevel >= paraTool.debugTracing) console.log(`[${channelMsgIndex}] sibling[${paraSibling}] msg[${k}]`, horizontalMsg)
                        let xcMsgs = this.decodeHorizontalMsg(indexer, horizontalMsg, channelMsgIndex)
                        if (xcMsgs) {
                            for (const xcMsg of xcMsgs) {
                                indexer.updateXCMChannelMsg(xcMsg, this.parserBlockNumber, this.parserTS)
                                indexer.updateXCMMsg(xcMsg, finalized)
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.log(`processValidationData error`, e)
        }
    }

    decodeXcmVersionedXcms(indexer, data, caller = false, useApiAt = true) {
        let api = (useApiAt) ? indexer.apiAt : indexer.api
        let msgHash = '0x' + paraTool.blake2_256_from_hex(data)
        try {
            let fragments = [];
            let msgHashes = [];
            let remainingMessage = data;
            while (remainingMessage.length >= 0 && remainingMessage != '0x') {
                //console.log(`remainingMessage(len=${remainingMessage.length})=${remainingMessage}`)
                let instructions = api.registry.createType('XcmVersionedXcm', remainingMessage);
                if (this.debugLevel >= paraTool.debugInfo && !useApiAt) console.log(`[${caller}] decodeXcmVersionedXcms [${msgHash}] Fallback decode success!`)
                //if (this.debugLevel >= paraTool.debugErrorOnly && !useApiAt) console.log(`decodeXcmVersionedXcms [${msgHash}](${data}) instructions`, instructions.toJSON())
                //fragments.push(instructions.toJSON());
                let instructionsJSON = instructions.toJSON()
                let instructionHex = instructions.toHex()
                let instructionLen = instructionHex.length
                let mhash = '0x' + paraTool.blake2_256_from_hex(instructionHex)
                //console.log(`instructionHex=${instructionHex} -> msgHash=${mhash}`)
                msgHashes.push(mhash)
                //console.log(`instruction(len=${instructionLen})`, instructionsJSON)
                remainingMessage = '0x' + remainingMessage.slice(instructionLen)
                let f = {
                    msg: instructionsJSON,
                    hex: instructionHex,
                    msgHash: mhash,
                    len: instructionHex.length - 2,
                }
                fragments.push(f)
            }
            return fragments;
        } catch (e) {
            if (useApiAt) {
                //if (this.debugLevel >= paraTool.debugVerbose) console.log(`[${caller}] decodeXcmVersionedXcms [${msgHash}] apiAt decode failed. trying fallback`)
                return this.decodeXcmVersionedXcms(indexer, data, caller, false)
            } else {
                //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`[${caller}] decodeXcmVersionedXcms [${msgHash}](${data}) decode failed. error`, e.toString())
                return false
            }
        }
    }

    decodeXcmVersionedXcm(indexer, data, caller = false, useApiAt = true) {
        let chainID = indexer.chainID
        let api = (useApiAt) ? indexer.apiAt : indexer.api
        let msgHash = '0x' + paraTool.blake2_256_from_hex(data)
        let remainingFound = false
        try {
            let instructions = api.registry.createType('XcmVersionedXcm', data);
            //if (this.debugLevel >= paraTool.debugInfo && !useApiAt) console.log(`[${caller}] decodeXcmVersionedXcm [${msgHash}] Fallback decode success!`)
            //if (this.debugLevel >= paraTool.debugErrorOnly && !useApiAt) console.log(`decodeXcmVersionedXcm [${msgHash}](${data}) instructions`, instructions.toJSON())
            let instructionLen = instructions.toHex().length
            let dataLength = data.length
            if (instructionLen != dataLength) {
                let remainingMessage = '0x' + data.slice(instructionLen)
                let remainingFound = true
                indexer.logger.error({
                    "op": "decodeXcmVersionedXcm",
                    "msg": "decodeXcmVersionedXcm found extra",
                    "chainID": chainID,
                    "parserBlockNumber": this.parserBlockNumber,
                    "parserBlockHash": this.parserBlockHash,
                    "obj": JSON.stringify(instructions.toJSON()),
                    "parsed": data.slice(0, instructionLen),
                    "remainingMessage": remainingMessage,
                    "err": 'decodeXcmVersionedXcm found extra'
                });
                //console.log(`!! instruction unparsed!!  remainingMessage=${remainingMessage}(len=${remainingMessage.length})`)
            }
            return [instructions, remainingFound]
        } catch (err) {
            if (useApiAt) {
                //if (this.debugLevel >= paraTool.debugVerbose) console.log(`[${caller}] decodeXcmVersionedXcm [${msgHash}] apiAt decode failed. trying fallback`)
                return this.decodeXcmVersionedXcm(indexer, data, caller, false)
            } else {
                //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`[${caller}] decodeXcmVersionedXcm [${msgHash}](${data}) decode failed. error`, err.toString())
                indexer.logger.error({
                    "op": "decodeXcmVersionedXcm",
                    "msg": "parsed failed",
                    "chainID": chainID,
                    "parserBlockNumber": this.parserBlockNumber,
                    "parserBlockHash": this.parserBlockHash,
                    "obj": data,
                    "err": err
                });
                return [false, false]
            }
        }
    }

    decodeUpwardMsg(indexer, upwardMsg, hrmpWatermark, channelMsgIndex) {
        /*
        0x021000040000000007dc83b012120a130000000007dc83b01212010700f2052a010d01000400010100c656dff3da37a23aa2600edeeb0cd141bf8170eea28ae3265bc310196f48464b
        */
        try {
            //channelMsgIndex: extrinsicID[0-1]-mpType[2]-receiverChainID[3]-senderChainID[4]-msgIdx[5]-msgsubIdx[6 - optional]
            let pieces = channelMsgIndex.split('-')
            let mpType = pieces[2]
            let chainIDDest = pieces[3]
            let chainID = pieces[4]
            let data = upwardMsg
            let sentAt = paraTool.dechexToInt(hrmpWatermark)
            var xcmFragments = this.decodeXcmVersionedXcms(indexer, data, `decodeUpwardMsg-${channelMsgIndex}`)
            if (!xcmFragments) {
                //console.log(`xcmFragments decode failed`)
                return false
            }
            let umpXcms = []
            for (let i = 0; i < xcmFragments.length; i++) {
                let xcm = xcmFragments[i]
                //console.log(`xcmFragment`, xcm)
                var umpMsg = xcm.msg
                var msg0 = xcm.msg
                var msgHex = xcm.hex
                var mHash = xcm.msgHash
                let beneficiaries = this.getBeneficiary(msg0)
                //console.log(`[Extrinsic] Incoming upwardMsg [${mHash}] beneficiaries=${beneficiaries}`)
                let p = this.getInstructionPath(umpMsg)
                //if (this.debugLevel >= paraTool.debugInfo) console.log(`upwardMsg`, JSON.stringify(umpMsg, null, 2))
                let r = {
                    msgIndex: (xcmFragments.length > 1) ? `${channelMsgIndex}-${i}` : channelMsgIndex,
                    chainID: chainID,
                    chainIDDest: chainIDDest,
                    isIncoming: 1,
                    msgHash: mHash,
                    msgType: 'ump',
                    msgHex: msgHex,
                    msgStr: JSON.stringify(umpMsg),
                    blockTS: this.parserTS,
                    blockNumber: this.parserBlockNumber,
                    relayChain: indexer.relayChain,
                    sentAt: sentAt,
                    beneficiaries: beneficiaries,
                }
                if (p) {
                    r.version = p.version
                    r.path = p.path
                }
                //if (this.debugLevel >= paraTool.debugVerbose) console.log(`upwardMsg [${mHash}] [${channelMsgIndex}-${i}]`, r)
                umpXcms.push(r)
            }
            return umpXcms
            //return r
        } catch (e) {
            //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`decodeUpwardMsg decode failed. error`, e.toString())
            return false
        }
    }

    decodeDownwardMsg(indexer, downwardMsg, channelMsgIndex) {
        /*
        {
         "sentAt": 12738903,
         "msg": "0x010104000100000f0078458dca5c010807000100000f0078458dca5c01000000000000000000286bee000000000100010100010000000001010042c37a8f52d17c05bd1f5f4d7b751daae60841b6554bdbc043dd5319fbc5c21b"
        }
        {
          pubSentAt: 9440729,
          pubMsg: '0x0001040a01000b00f01449e90408070a01000b00f01449e9040000000000000000005ed0b200000000000001040101020082ba55bbd6e798cc015723fae77abe3fb54a2cdbbfe873b85d08a57b5aab6a6a'
        }
        */
        try {
            //channelMsgIndex: extrinsicID[0-1]-mpType[2]-receiverChainID[3]-senderChainID[4]-msgIdx[5]
            let pieces = channelMsgIndex.split('-')
            let mpType = pieces[2]
            let chainIDDest = pieces[3]
            let chainID = pieces[4]
            let data = (downwardMsg.msg != undefined) ? downwardMsg.msg : downwardMsg.pubMsg
            let sentAt = (downwardMsg.sentAt != undefined) ? paraTool.dechexToInt(downwardMsg.sentAt) : paraTool.dechexToInt(downwardMsg.pubSentAt)
            //console.log(`decodeDownwardMsg`, downwardMsg)
            var xcmFragments = this.decodeXcmVersionedXcms(indexer, data, `decodeDownwardMsg-${channelMsgIndex}`)
            if (!xcmFragments) {
                //console.log(`xcmFragments decode failed`)
                return false
            }
            let dmpXcms = []
            for (let i = 0; i < xcmFragments.length; i++) {
                let xcm = xcmFragments[i]
                //console.log(`xcmFragment`, xcm)
                var dmpMsg = xcm.msg
                var msg0 = xcm.msg
                var msgHex = xcm.hex
                var mHash = xcm.msgHash
                let beneficiaries = this.getBeneficiary(msg0)
                //console.log(`[Extrinsic] Incoming downwardMsg [${mHash}] beneficiaries=${beneficiaries}`)
                let p = this.getInstructionPath(dmpMsg)
                //if (this.debugLevel >= paraTool.debugInfo) console.log(`downwardMsg`, JSON.stringify(dmpMsg, null, 2))
                let r = {
                    msgIndex: (xcmFragments.length > 1) ? `${channelMsgIndex}-${i}` : channelMsgIndex,
                    chainID: chainID,
                    chainIDDest: chainIDDest,
                    isIncoming: 1,
                    msgHash: mHash,
                    msgType: 'dmp',
                    msgHex: msgHex,
                    msgStr: JSON.stringify(dmpMsg),
                    blockTS: this.parserTS,
                    blockNumber: this.parserBlockNumber,
                    relayChain: indexer.relayChain,
                    sentAt: sentAt,
                    beneficiaries: beneficiaries,
                }
                if (p) {
                    r.version = p.version
                    r.path = p.path
                }
                //if (this.debugLevel >= paraTool.debugVerbose) console.log(`downwardMsg [${mHash}] [${channelMsgIndex}-${i}]`, r)
                dmpXcms.push(r)
            }
            return dmpXcms
            //return r
        } catch (e) {
            //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`decodeDownwardMsg decode failed. error`, e.toString())
            return false
        }
    }

    decodeHorizontalMsg(indexer, horizontalMsg, channelMsgIndex) {
        /*
        {
          "sentAt": 12743570,
          "data": "0x00021000040000010608000c000b00204aa9d1010a130000010608000c000b00204aa9d101010700f2052a010d01000400010100b2d6460991d870119c2b5f820f977bb0c5a0a410eca38db44bc7817dc5507749"
        }
        //want: 0x021000040000010608000c000b00204aa9d1010a130000010608000c000b00204aa9d101010700f2052a010d01000400010100b2d6460991d870119c2b5f820f977bb0c5a0a410eca38db44bc7817dc5507749
        */
        try {
            //channelMsgIndex: extrinsicID[0-1]-mpType[2]-receiverChainID[3]-senderChainID[4]-msgIdx[5]
            let pieces = channelMsgIndex.split('-')
            let mpType = pieces[2]
            let chainIDDest = pieces[3]
            let chainID = pieces[4]
            let data = '0x' + horizontalMsg.data.slice(4)
            if (horizontalMsg.data == undefined) {
                //console.log(`horizontalMsg data fatal case!!`, JSON.stringify(horizontalMsg, null, 2))
            }
            if (horizontalMsg.sentAt == undefined && horizontalMsg.pubSentAt == undefined) {
                //console.log(`horizontalMsg sentAt fatal case!!`, JSON.stringify(hrmpMsg, null, 2))
            }
            let sentAt = (horizontalMsg.sentAt != undefined) ? paraTool.dechexToInt(horizontalMsg.sentAt) : paraTool.dechexToInt(horizontalMsg.pubSentAt)
            var xcmFragments = this.decodeXcmVersionedXcms(indexer, data, `decodeHorizontalMsg-${channelMsgIndex}`)
            if (!xcmFragments) {
                //console.log(`xcmFragments decode failed`)
                return false
            }
            let hrmpXcms = []
            for (let i = 0; i < xcmFragments.length; i++) {
                let xcm = xcmFragments[i]
                //console.log(`xcmFragment`, xcm)
                var hrmpMsg = xcm.msg
                var msg0 = xcm.msg
                var msgHex = xcm.hex
                var mHash = xcm.msgHash
                let beneficiaries = this.getBeneficiary(msg0)
                //console.log(`[Extrinsic] Incoming horizontalMsg [${mHash}] beneficiaries=${beneficiaries}`)
                let p = this.getInstructionPath(hrmpMsg)
                if (this.debugLevel >= paraTool.debugInfo) console.log(`horizontalMsg`, JSON.stringify(hrmpMsg, null, 2))
                let r = {
                    msgIndex: (xcmFragments.length > 1) ? `${channelMsgIndex}-${i}` : channelMsgIndex,
                    chainID: chainID,
                    chainIDDest: chainIDDest,
                    isIncoming: 1,
                    msgHash: mHash,
                    msgType: 'hrmp',
                    msgHex: msgHex, // this is the modified msgHex without the first byte
                    msgStr: JSON.stringify(hrmpMsg),
                    blockTS: this.parserTS,
                    blockNumber: this.parserBlockNumber,
                    relayChain: indexer.relayChain,
                    sentAt: sentAt,
                    beneficiaries: beneficiaries,
                }
                if (p) {
                    r.version = p.version
                    r.path = p.path
                }
                //if (this.debugLevel >= paraTool.debugVerbose) console.log(`horizontalMsg [${mHash}] [${channelMsgIndex}-${i}]`, r)
                hrmpXcms.push(r)
            }
            return hrmpXcms
            //return r
        } catch (e) {
            //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`decodeHorizontalMsg decode failed. error`, e.toString())
            return false
        }
    }

    processIncomingXCMSignalStatus(e) {
        let sectionMethod = `${e.section}(${e.method})`
        let msgHash = e.data[0];
        let signalStatus = {
            sectionMethod: sectionMethod,
            eventID: e.eventID,
            sentAt: this.parserWatermark,
            bn: this.parserBlockNumber,
            msgHash: msgHash,
            weight: 0,
            success: false,
        }
        let statusK
        let statusV;
        if (e.data.length == 1) {
            if (sectionMethod == 'xcmpQueue(Success)') {
                signalStatus.success = true
            }
            return signalStatus
        } else if (e.data.length >= 2) {
            let state = e.data[1]
            try {
                let statusK = Object.keys(state)[0]
                let statusV = state[statusK]
                if (statusK == 'complete' || statusK == 'weight') {
                    signalStatus.weight = paraTool.dechexToInt(statusV)
                    signalStatus.success = true
                } else if (sectionMethod == 'xcmpQueue(Success)') {
                    signalStatus.success = true
                    signalStatus.weight = paraTool.dechexToInt(state)
                } else if (sectionMethod == 'xcmpQueue(Fail)') {
                    signalStatus.success = false
                    state = e.data
                    signalStatus.errorDesc = 'fail'
                    if (Array.isArray(state) && state.length >= 2) {
                        let failedReson = Object.keys(state[1])[0]
                        signalStatus.description = failedReson
                        if (state.length == 3) {
                            signalStatus.weight = paraTool.dechexToInt(state[2])
                        }
                    } else {
                        signalStatus.description = statusV
                    }
                } else {
                    signalStatus.errorDesc = statusK
                    if (Array.isArray(statusV) && statusV.length == 2) {
                        signalStatus.weight = paraTool.dechexToInt(statusV[0])
                        let failedReson = Object.keys(statusV[1])[0]
                        signalStatus.description = failedReson
                    } else if (typeof statusV === 'object') {
                        let failedReson = Object.keys(statusV)[0]
                        signalStatus.description = failedReson
                    } else {
                        signalStatus.description = statusV
                    }
                }
                return signalStatus
            } catch (err) {
                console.log(`processIncomingXCMSignalStatus failed ${err.toString()}`, err)
                return signalStatus
            }
        }
        return signalStatus
    }

    processIncomingXCMSignal(indexer, extrinsicID, e, idx, finalized = false) {
        // here we look for events of note
        let [pallet, method] = indexer.parseEventSectionMethod(e)
        // enable this line to explore section:method
        // console.log(`${pallet}:${method}`)
        if (pallet == "ump" && method == "ExecutedUpward") {
            // parachain -> relaychain
            //console.log("processBlockEvent", pallet, method, e);
            // test case: indexPeriods 2  2022-03-30 21
            let signalStatus = this.processIncomingXCMSignalStatus(e)
            let msgHash = signalStatus.msgHash;
            this.mpReceived = true;
            this.mpReceivedHashes[idx] = signalStatus
            if (this.debugLevel >= paraTool.debugInfo) console.log(`[${extrinsicID}] ump:ExecutedUpward signal [msgHash=${msgHash}, idx=${idx}]`, signalStatus)
        } else if (pallet == "xcmpQueue" && method == "Success") {
            // this is the para <=> para case
            //console.log("processBlockEvent", pallet, method);
            // test case: indexPeriods 6 2022-03-30 21
            let signalStatus = this.processIncomingXCMSignalStatus(e)
            let msgHash = signalStatus.msgHash;
            this.mpReceived = true;
            this.mpReceivedHashes[idx] = signalStatus
            if (this.debugLevel >= paraTool.debugInfo) console.log(`[${extrinsicID}] xcmpQueue:Success signal [msgHash=${msgHash}, idx=${idx}]`, signalStatus)
        } else if (pallet == "xcmpQueue" && method == "Fail") {
            // this is the para <=> para case
            //console.log("processBlockEvent", pallet, method);
            // test case: indexPeriods 6 2022-03-30 21
            let signalStatus = this.processIncomingXCMSignalStatus(e)
            let msgHash = signalStatus.msgHash;
            this.mpReceived = true;
            this.mpReceivedHashes[idx] = signalStatus
            if (this.debugLevel >= paraTool.debugInfo) console.log(`[${extrinsicID}] xcmpQueue:Fail signal !!! [msgHash=${msgHash}, idx=${idx}]`, signalStatus)
        } else if (pallet == "dmpQueue" && method == "ExecutedDownward") {
            // relaychain -> parachain (xcmPallet:reserveTransferAssets)
            //0x1983c30b091b39363a07c4a90be79b7ce4650742666f25e8378beff6f54a30f4
            let signalStatus = this.processIncomingXCMSignalStatus(e)
            let msgHash = signalStatus.msgHash;
            this.mpReceived = true;
            this.mpReceivedHashes[idx] = signalStatus
            if (this.debugLevel >= paraTool.debugInfo) console.log(`[${extrinsicID}] dmpqueue:ExecutedDownward signal [msgHash=${msgHash}, idx=${idx}]`, signalStatus)
        }
    }

    processIncomingAssetWithdralSignal(indexer, extrinsicID, e, mpState = false, finalized = false) {
        //TODO need withdraw signal somehow
        let [pallet, method] = indexer.parseEventSectionMethod(e)
        let palletMethod = `${pallet}(${method})` //event
        let candidate = false;
        let caller = false;
        //console.log(`processIncomingAssetSignal ${e.eventID} ${palletMethod}`)
        switch (palletMethod) {
            case 'balances(Withdraw)':
                //kusama/polkadot format
                if (this.mpReceived) {
                    [candidate, caller] = this.processBalancesDepositSignal(indexer, extrinsicID, e, mpState, finalized)
                }
                break;
            case 'currencies(Withdrawn)':
                // acala/bifrost format
                if (this.mpReceived) {
                    [candidate, caller] = this.processCurrenciesDepositedSignal(indexer, extrinsicID, e, mpState, finalized)
                }
                break;
            case 'tokens(Withdrawn)':
                // acala format?
                if (this.mpReceived) {
                    [candidate, caller] = this.processTokensDepositedSignal(indexer, extrinsicID, e, mpState, finalized)
                }
                break;
            case 'assets(Burned)':
                // not sure if this is ever emmited
                if (this.mpReceived) {
                    [candidate, caller] = this.processAssetsIssuedSignal(indexer, extrinsicID, e, mpState, finalized)
                }
                break;
            default:
                break;
        }
        return [candidate, caller]
    }

    processIncomingAssetDepositSignal(indexer, extrinsicID, e, mpState = false, finalized = false) {
        let [pallet, method] = indexer.parseEventSectionMethod(e)
        let palletMethod = `${pallet}(${method})` //event
        let candidate = false;
        let caller = false;
        //console.log(`processIncomingAssetSignal ${e.eventID} ${palletMethod}`)
        switch (palletMethod) {
            case 'balances(Deposit)':
                //kusama/polkadot format
                if (this.mpReceived) {
                    [candidate, caller] = this.processBalancesDepositSignal(indexer, extrinsicID, e, mpState, finalized)
                }
                break;
            case 'currencies(Deposited)':
                // acala/bifrost format
                if (this.mpReceived) {
                    [candidate, caller] = this.processCurrenciesDepositedSignal(indexer, extrinsicID, e, mpState, finalized)
                }
                break;
            case 'tokens(Deposited)':
                // acala format?
                if (this.mpReceived) {
                    [candidate, caller] = this.processTokensDepositedSignal(indexer, extrinsicID, e, mpState, finalized)
                }
                break;
            case 'assets(Issued)':
                // parallel/moonbeam/astar format
                if (this.mpReceived) {
                    [candidate, caller] = this.processAssetsIssuedSignal(indexer, extrinsicID, e, mpState, finalized)
                }
                break;
            case 'eqBalances(Deposit)':
                // parallel/moonbeam/astar format
                if (this.mpReceived) {
                    [candidate, caller] = this.processEqBalancesSignal(indexer, extrinsicID, e, mpState, finalized)
                }
                break;
            default:
                break;
        }
        return [candidate, caller]
    }

    //return paraIDDest, chainIDDest
    processDestV0X1(v0x1, relayChain) {
        //same as dest.v0.x1, dest.v1.interior.x1
        let paraIDDest = 0
        let chainIDDest = -1
        if (v0x1.parachain !== undefined) {
            //{ parachain: 2001 }
            paraIDDest = v0x1.parachain
            let relayChainID = paraTool.getRelayChainID(relayChain)
            let paraIDExtra = paraTool.getParaIDExtra(relayChain)
            chainIDDest = paraIDDest + paraIDExtra
        } else if (v0x1.parent !== undefined) {
            // { parent: null }
            paraIDDest = 0
            if (relayChain == "polkadot") {
                chainIDDest = paraTool.chainIDPolkadot;
            } else if (relayChain == "kusama") {
                chainIDDest = paraTool.chainIDKusama;
            }
        } else {
            //console.log(`processX2 unknown v0x1`, x2)
        }
        return [paraIDDest, chainIDDest]
    }

    //return paraIDDest, chainIDDest
    processDestV0X2(v0x2, relayChain) {
        //0x98324306c4ae1a6ecb9ab3798ba3a300e5a7cdef377fccb9ee716209d4c16891
        let paraIDDest = -1
        let chainIDDest = -1
        let relayChainID = paraTool.getRelayChainID(relayChain)
        let paraIDExtra = paraTool.getParaIDExtra(relayChain)
        if (Array.isArray(v0x2)) {
            //same as dest X1
            let x2_0 = v0x2[0];
            if (x2_0.parachain !== undefined) {
                //{ parachain: 2001 }
                paraIDDest = x2_0.parachain
                chainIDDest = paraIDDest + paraIDExtra
            } else if (x2_0.parent !== undefined) {
                // { parent: null }
                paraIDDest = 0
                chainIDDest = relayChainID
            }
            if (Array.isArray(v0x2) && v0x2.length == 2) {
                let x2_1 = v0x2[1];
                if (x2_1.parachain !== undefined) {
                    //{ parachain: 2001 }
                    paraIDDest = x2_1.parachain
                    chainIDDest = paraIDDest + paraIDExtra
                }
            }
        }
        return [paraIDDest, chainIDDest]
    }

    //{"parachain": 2000}
    processX1(x1, relayChain, decorate = false, indexer = false) {
        //same as beneficiary.v0.x1, dest.v1.interior.x1
        let paraIDDest = 0
        let chainIDDest = -1
        let destAddress = false
        let relayChainID = paraTool.getRelayChainID(relayChain)
        let paraIDExtra = paraTool.getParaIDExtra(relayChain)
        chainIDDest = relayChainID
        let targetdestAddress = this.processAccountKey(x1, decorate, indexer)
        if (targetdestAddress) destAddress = targetdestAddress
        if (x1 != undefined && x1.parachain != undefined) {
            paraIDDest = x1.parachain
            chainIDDest = paraIDDest + paraIDExtra
        }
        if (paraIDDest == 0) chainIDDest = relayChainID
        let destObj = {
            paraIDDest: 0,
            chainIDDest: -1,
            destAddress: false,
        }
        destObj.paraIDDest = paraIDDest
        destObj.chainIDDest = chainIDDest
        destObj.destAddress = destAddress
        return [paraIDDest, chainIDDest, destAddress, destObj]
    }

    processX2(x2, relayChain, decorate = false, indexer = false) {
        //dest.v1.interior.x2
        let paraIDDest = -1
        let chainIDDest = -1
        let destAddress = false
        let relayChainID = paraTool.getRelayChainID(relayChain)
        let paraIDExtra = paraTool.getParaIDExtra(relayChain)
        if (Array.isArray(x2)) {
            //same as dest X1
            let x2_1 = x2[0];
            if (x2_1.parachain !== undefined) {
                //{ parachain: 2001 }
                paraIDDest = x2_1.parachain
                chainIDDest = paraIDDest + paraIDExtra
            } else if (x2_1.parent !== undefined) {
                // { parent: null }
                paraIDDest = 0
                chainIDDest = relayChainID
            } else {
                //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`processX2 unknown x2_1`, x2)
            }
            if (paraIDDest == 0) chainIDDest = relayChainID
            //let accKey = x2[1]
            destAddress = this.processAccountKey(x2[1], decorate, indexer)
        }
        return [paraIDDest, chainIDDest, destAddress]
    }

    processX3(x3, relayChain, decorate = false, indexer = false) {
        //dest.v1.interior.x3
        /*
      "x3": [
        {
          "parent": null
        },
        {
          "parachain": 2001
        },
        {
          "accountId32": {
            "network": {
              "any": null
            },
            "id": "qLpr9ztSDVYFxAhbEcWJyMorjZJv7LoZLGHS2RfLL2y7bvu"
          }
        }
      ]
    */
        let paraIDDest = -1
        let chainIDDest = -1
        let destAddress = false
        let relayChainID = paraTool.getRelayChainID(relayChain)
        let paraIDExtra = paraTool.getParaIDExtra(relayChain)

        if (Array.isArray(x3)) {
            //same as dest X1
            let x3_0 = x3[0]; //not used?
            let x3_1 = x3[1];
            if (x3_1.parachain !== undefined) {
                //{ parachain: 2001 }
                paraIDDest = x3_1.parachain
                chainIDDest = paraIDDest + paraIDExtra
            } else if (x3_1.parent !== undefined) {
                // { parent: null }
                paraIDDest = 0
                chainIDDest = relayChainID
            } else {
                //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`processX2 unknown x3_1`, x3_1)
            }
            //let accKey = x3[2]
            destAddress = this.processAccountKey(x3[2], decorate, indexer)
        }
        return [paraIDDest, chainIDDest, destAddress]
    }

    processAccountKey(accKey, decorate = false, indexer = false) {
        let destAddress = false
        if (accKey.accountId32 != undefined && accKey.accountId32.id != undefined) {
            destAddress = paraTool.getPubKey(accKey.accountId32.id);
            if (decorate && indexer) {
                indexer.decorateAddress(accKey.accountId32, "id", true, true)
            }
        } else if (accKey.accountKey20 != undefined && accKey.accountKey20.key != undefined) {
            destAddress = paraTool.getPubKey(accKey.accountKey20.key);
        } else {
            //if (this.debugLevel >= paraTool.debugErrorOnly) console.log('accKey unknown', accKey)
        }
        return destAddress
    }

    processOutgoingXCMFromXTokensEvent(indexer, extrinsic, feed, fromAddress, section_method, args) {
        let xTokensEvents = extrinsic.events.filter((ev) => {
            return this.xTokensFilter(`${ev.section}(${ev.method})`);
        })
        let xcmMsgHashEvents = extrinsic.events.filter((ev) => {
            return this.xcmMsgFilter(`${ev.section}(${ev.method})`);
        })
        if (xTokensEvents.length == 0) return
        //if (this.debugLevel >= paraTool.debugTracing) console.log(`processOutgoingXCMFromXTokensEvent found len=${xTokensEvents.length}`, xTokensEvents)
        //if (this.debugLevel >= paraTool.debugTracing) console.log(`processOutgoingXCMFromXTokensEvent msgHash len=${xcmMsgHashEvents.length}`, xcmMsgHashEvents)
        extrinsic.xcms = []
        for (let i = 0; i < xTokensEvents.length; i++) {
            let xTokensEvent = xTokensEvents[i]
            let xcmMsgHashCandidate = (xTokensEvents.length == xcmMsgHashEvents.length) ? xcmMsgHashEvents[i].data[0] : false
            this.processOutgoingXTokensEvent(indexer, extrinsic, feed, xTokensEvent, xcmMsgHashCandidate)
        }
    }



    processOutgoingXTokensEvent(indexer, extrinsic, feed, event, msgHashCandidate = false) {
        if (extrinsic.xcmIndex == undefined) {
            extrinsic.xcmIndex = 0
        } else {
            extrinsic.xcmIndex += 1
        }
        let section_method = `${extrinsic.section}:${extrinsic.method}`
        let evetnData = event.data
        let transferIndex = 0;
        //let xcmIndex = extrinsic.xcmIndex

        let fromAddress = paraTool.getPubKey(evetnData[0])
        let incomplete = this.extract_xcm_incomplete(extrinsic.events, extrinsic.extrinsicID);
        let assetAndAmountSents = [];

        // dest for parachain   {"v1":{"parents":1,"interior":{"x2":[{"parachain":2001},{"accountId32":{"network":{"any":null},"id":"0xbc7668c63c9f8869ed84996865a32d400bbee0a86ae8d204b4f990e617ed6a1c"}}]}}}
        // dest for relaychain  {"v1":{"parents":1,"interior":{"x1":{"accountId32":{"network":{"any":null},"id":"0x42f433b9325d91779a6e226931d20e31ec3f6017111b842ef4f7a3c13364bf63"}}}}}
        let relayChain = indexer.relayChain
        let chainID = indexer.chainID
        let paraID = paraTool.getParaIDfromChainID(chainID)
        let dest = evetnData[3] //XcmV1MultilocationJunctions
        let [paraIDDest, chainIDDest, destAddress] = this.processDest(dest, relayChain)
        //if (this.debugLevel >= paraTool.debugInfo) console.log(`[${extrinsic.extrinsicHash}] section_method=${section_method} paraIDDest=${paraIDDest}, chainIDDest=${chainIDDest}, destAddress=${destAddress}`)
        if (chainIDDest == -1 || paraIDDest == -1) {
            //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`[${extrinsic.extrinsicHash}] section_method=${section_method} parsing failed`)
            return
        }

        let feePayingXcmInteriorkey = false
        let feeAsset = evetnData[2]
        if (feeAsset.fun !== undefined && feeAsset.fun.fungible !== undefined) {
            let [targetedSymbol, targetedRelayChain, targetedXcmInteriorKey1] = this.processV1ConcreteFungible(indexer, feeAsset)
            //console.log(`processOutgoingXTokensEvent asset targetedSymbol=${targetedSymbol}, targetedRelayChain=${targetedRelayChain}`, feeAsset)
            feePayingXcmInteriorkey = indexer.check_refintegrity_xcm_symbol(targetedSymbol, targetedRelayChain, chainID, chainIDDest, "processV1ConcreteFungible", `processOutgoingXTokensEvent ${section_method}`, feeAsset)
            if (feePayingXcmInteriorkey == false) feePayingXcmInteriorkey = targetedXcmInteriorKey1
            console.log(`feePayingXcmInteriorkey=${feePayingXcmInteriorkey}`)
        }

        let aAsset = evetnData[1] //Vec<XcmV1MultiAsset>
        if (aAsset != undefined && Array.isArray(aAsset)) {
            // todo: extract this
            //if (this.debugLevel >= paraTool.debugInfo) console.log(`[${extrinsic.extrinsicHash}] processOutgoingXTokensEvent xTokens:transferMultiasset`)
            let assetArr = []
            //let aAssetv1 = aAsset.v1
            //assetArr.push(aAsset)
            let transferIndex = 0
            assetArr = aAsset
            //no fee items
            for (const asset of assetArr) {
                // 0xc003ebdaaa4ef4d8ed2d89ca419cf79cefc883859ab9d74349d882dacf6bb811
                // {"id":{"concrete":{"parents":0,"interior":{"here":null}}},"fun":{"fungible":10324356190528}}
                if (asset.fun !== undefined && asset.fun.fungible !== undefined) {
                    //let [targetedAsset, rawTargetedAsset, targetedXcmInteriorKey] = this.processV1ConcreteFungible(indexer, asset)
                    //rawTargetedAsset = indexer.check_refintegrity_asset(rawTargetedAsset, "processOutgoingXTokensEvent - processV1ConcreteFungible", asset)
                    let [targetedSymbol, targetedRelayChain, targetedXcmInteriorKey0] = this.processV1ConcreteFungible(indexer, asset)
                    //console.log(`processOutgoingXTokensEvent asset targetedSymbol=${targetedSymbol}, targetedRelayChain=${targetedRelayChain}, targetedXcmInteriorKey0=${targetedXcmInteriorKey0}`, asset)
                    let targetedXcmInteriorKey = indexer.check_refintegrity_xcm_symbol(targetedSymbol, targetedRelayChain, chainID, chainIDDest, "processV1ConcreteFungible", `processOutgoingXTokensEvent ${section_method}`, asset)
                    //console.log(`targetedXcmInteriorKey=${targetedXcmInteriorKey}`)
                    if (targetedXcmInteriorKey == false) targetedXcmInteriorKey = targetedXcmInteriorKey0
                    let aa = {
                        //asset: targetedAsset,
                        //rawAsset: rawTargetedAsset,
                        xcmInteriorKey: targetedXcmInteriorKey,
                        xcmSymbol: targetedSymbol,
                        amountSent: paraTool.dechexToInt(asset.fun.fungible),
                        transferIndex: transferIndex,
                        isFeeItem: (targetedXcmInteriorKey == feePayingXcmInteriorkey && targetedXcmInteriorKey !== false) ? 1 : 0,
                    }
                    assetAndAmountSents.push(aa)
                } else {
                    if (this.debugLevel >= paraTool.debugErrorOnly) console.log("asset v1 unknown", asset);
                    asset = false;
                }
                transferIndex++
            }
        } else {
            //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`[${extrinsic.extrinsicHash}] processOutgoingXTokens xTokens:transferMultiasset asset unknown`)
        }

        for (const assetAndAmountSent of assetAndAmountSents) {
            let targetedSymbol = assetAndAmountSent.xcmSymbol
            let targetedXcmInteriorKey = assetAndAmountSent.xcmInteriorKey
            let amountSent = assetAndAmountSent.amountSent
            let transferIndex = assetAndAmountSent.transferIndex
            let isFeeItem = assetAndAmountSent.isFeeItem
            if (assetAndAmountSent != undefined && paraTool.validAmount(amountSent)) {
                if (extrinsic.xcms == undefined) extrinsic.xcms = []
                let xcmIndex = extrinsic.xcmIndex
                let r = {
                    sectionMethod: section_method,
                    extrinsicHash: feed.extrinsicHash,
                    extrinsicID: feed.extrinsicID,
                    transferIndex: transferIndex,
                    xcmIndex: xcmIndex,
                    relayChain: relayChain,
                    chainID: chainID,
                    chainIDDest: chainIDDest,
                    paraID: paraID,
                    paraIDDest: paraIDDest,
                    blockNumber: this.parserBlockNumber,
                    fromAddress: fromAddress,
                    destAddress: destAddress,
                    sourceTS: feed.ts,
                    amountSent: amountSent,
                    incomplete: incomplete,
                    isFeeItem: isFeeItem,
                    msgHash: '0x',
                    sentAt: this.parserWatermark,
                    xcmSymbol: targetedSymbol,
                    xcmInteriorKey: targetedXcmInteriorKey,
                    xcmType: "xcmtransfer",
                }
                if (msgHashCandidate) r.msgHash = msgHashCandidate //try adding msgHashCandidate if available (may have mismatch)
                if (!targetedSymbol || !targetedXcmInteriorKey) {
                    if (this.debugLevel >= paraTool.debugTracing) console.log(`processOutgoingXTokensEvent missing`, r)
                }
                //outgoingXTokens.push(r)
                extrinsic.xcms.push(r)
                //outgoingXcmList.push(r)
            } else {
                //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`[${extrinsic.extrinsicHash}] processOutgoingXTokens xTokens unknown asset/amountSent`);
            }
        }
    }

    processDest(dest, relayChain) {
        let paraIDDest = -1;
        let chainIDDest = -1;
        let destAddress = false;
        //if (this.debugLevel >= paraTool.debugTracing) console.log(`processDest`, JSON.stringify(dest, null, 4))
        if (dest.v1 !== undefined && dest.v1.interior !== undefined) {
            //if (this.debugLevel >= paraTool.debugTracing) console.log(`processDest v1 interior`)
            let destV1Interior = dest.v1.interior;
            // dest for relaychain
            if (destV1Interior.x1 !== undefined) {
                //if (this.debugLevel >= paraTool.debugTracing) console.log(`processDest v1 interior x1`)
                // {"accountId32":{"network":{"any":null},"id":"0x42f433b9325d91779a6e226931d20e31ec3f6017111b842ef4f7a3c13364bf63"}}
                let [targetParaIDDest, targetChainIDDest, targetDestAddress] = this.processX1(destV1Interior.x1, relayChain)
                return [targetParaIDDest, targetChainIDDest, targetDestAddress]
            } else if (destV1Interior.x2 !== undefined) {
                //if (this.debugLevel >= paraTool.debugTracing) console.log(`processDest v1 interior x2`)
                // dest for parachain, add 20000 for kusama-relay
                // [{"parachain":2001},{"accountId32":{"network":{"any":null},"id":"0xbc7668c63c9f8869ed84996865a32d400bbee0a86ae8d204b4f990e617ed6a1c"}}]
                let [targetParaIDDest, targetChainIDDest, targetDestAddress] = this.processX2(destV1Interior.x2, relayChain)
                return [targetParaIDDest, targetChainIDDest, targetDestAddress]
            }
        } else if (dest.x2 != undefined) {
            //if (this.debugLevel >= paraTool.debugTracing) console.log(`processDest dest x2`)
            //0x0f51db2f3f23091aa1c0108358160c958db46f62e08fcdda13d0d864841821ad
            let [targetParaIDDest, targetChainIDDest, targetDestAddress] = this.processX2(dest.x2, relayChain)
            return [targetParaIDDest, targetChainIDDest, targetDestAddress]
        } else if (dest.x3 != undefined) {
            //if (this.debugLevel >= paraTool.debugTracing) console.log(`processDest dest x3`)
            //0xbe57dd955bc7aca3bf91626e38ee2349df871240e2695c5115e3ffb27e92e925
            let [targetParaIDDest, targetChainIDDest, targetDestAddress] = this.processX3(dest.x3, relayChain)
            return [targetParaIDDest, targetChainIDDest, targetDestAddress]
        } else if (dest.interior !== undefined) {
            //if (this.debugLevel >= paraTool.debugTracing) console.log(`processDest destInterior`)
            let destInterior = dest.interior;
            // 0x9576445f90c98fe89e752d20020b9825543e9076d93cae52a59299a1625bd1c6
            if (destInterior.x1 !== undefined) {
                //if (this.debugLevel >= paraTool.debugTracing) console.log(`processDest destInterior x1`, JSON.stringify(destInterior.x1, null, 4))
                let [targetParaIDDest, targetChainIDDest, targetDestAddress] = this.processX1(destInterior.x1, relayChain)
                return [targetParaIDDest, targetChainIDDest, targetDestAddress]
            } else if (destInterior.x2 !== undefined) {
                //if (this.debugLevel >= paraTool.debugTracing) console.log(`processDest destInterior x2`)
                let [targetParaIDDest, targetChainIDDest, targetDestAddress] = this.processX2(destInterior.x2, relayChain)
                return [targetParaIDDest, targetChainIDDest, targetDestAddress]
            } else if (destInterior.x3 !== undefined) {
                //if (this.debugLevel >= paraTool.debugTracing) console.log(`processDest destInterior x3`)
                // [{"parachain":2001},{"accountId32":{"network":{"any":null},"id":"0xbc7668c63c9f8869ed84996865a32d400bbee0a86ae8d204b4f990e617ed6a1c"}}]
                let [targetParaIDDest, targetChainIDDest, targetDestAddress] = this.processX3(destInterior.x3, relayChain)
                return [targetParaIDDest, targetChainIDDest, targetDestAddress]
            } else {
                //if (this.debugLevel >= paraTool.debugInfo) console.log(`Unknown dest.interior`, JSON.stringify(dest, null, 2))
            }
        } else {
            //if (this.debugLevel >= paraTool.debugInfo) console.log(`Unknown dest`, JSON.stringify(dest, null, 2))
        }
        //console.log(`processDest paraIDDest=${paraIDDest}, chainIDDest=${chainIDDest}, destAddress=${destAddress}`)
        return [paraIDDest, chainIDDest, destAddress]
    }


    processOutgoingXTransfer(indexer, extrinsic, feed, fromAddress, section_method, args) {
        //return
        let chainID = indexer.chainID
        if (extrinsic.xcmIndex == undefined) {
            extrinsic.xcmIndex = 0
        } else {
            extrinsic.xcmIndex += 1
        }
        let outgoingXTransfer = []
        try {
            if (section_method == "xTransfer:transfer") {
                let a = args
                let assetAndAmountSents = [];
                let dest = a.dest;
                let relayChain = indexer.relayChain;
                let paraID = paraTool.getParaIDfromChainID(chainID)
                let [paraIDDest, chainIDDest, destAddress] = this.processDest(dest, relayChain)
                //if (this.debugLevel >= paraTool.debugInfo) console.log(`[${extrinsic.extrinsicHash}] section_method=${section_method} paraIDDest=${paraIDDest}, chainIDDest=${chainIDDest}, destAddress=${destAddress}`)
                if (chainIDDest == -1 || paraIDDest == -1) {
                    //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`[${extrinsic.extrinsicHash}] section_method=${section_method} parsing failed`)
                    return
                }

                if (section_method == 'xTransfer:transfer') {
                    //asset processing
                    let asset = a.asset
                    if (asset != undefined && asset.fun !== undefined && asset.fun.fungible !== undefined) {
                        let [targetedSymbol, targetedRelayChain, targetedXcmInteriorKey0] = this.processV1ConcreteFungible(indexer, asset)
                        let targetedXcmInteriorKey = indexer.check_refintegrity_xcm_symbol(targetedSymbol, targetedRelayChain, chainID, chainIDDest, "processV1ConcreteFungible", `processOutgoingXTransfer ${section_method}`, asset)
                        if (targetedXcmInteriorKey == false) targetedXcmInteriorKey = targetedXcmInteriorKey0
                        let aa = {
                            xcmInteriorKey: targetedXcmInteriorKey,
                            xcmSymbol: targetedSymbol,
                            amountSent: paraTool.dechexToInt(asset.fun.fungible),
                            transferIndex: 0,
                            isFeeItem: 1,
                        }
                        assetAndAmountSents.push(aa)
                    } else {
                        //if (this.debugLevel >= paraTool.debugErrorOnly) console.log("xTransfer:transfer asset unknown", a);
                        asset = false;
                    }
                } else {
                    //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`[${extrinsic.extrinsicHash}] processOutgoingXTokens xTokens:transferMultiasset unknown case`, section_method)
                }

                for (const assetAndAmountSent of assetAndAmountSents) {
                    let targetedSymbol = assetAndAmountSent.xcmSymbol
                    let targetedXcmInteriorKey = assetAndAmountSent.xcmInteriorKey
                    let amountSent = assetAndAmountSent.amountSent
                    let transferIndex = assetAndAmountSent.transferIndex
                    let isFeeItem = assetAndAmountSent.isFeeItem
                    if (assetAndAmountSent != undefined && paraTool.validAmount(amountSent)) {
                        let incomplete = this.extract_xcm_incomplete(extrinsic.events, extrinsic.extrinsicID);
                        if (extrinsic.xcms == undefined) extrinsic.xcms = []
                        let xcmIndex = extrinsic.xcmIndex
                        let r = {
                            sectionMethod: section_method,
                            extrinsicHash: feed.extrinsicHash,
                            extrinsicID: feed.extrinsicID,
                            transferIndex: transferIndex,
                            xcmIndex: xcmIndex,
                            relayChain: relayChain,
                            chainID: chainID,
                            chainIDDest: chainIDDest,
                            paraID: paraID,
                            paraIDDest: paraIDDest,
                            blockNumber: this.parserBlockNumber,
                            fromAddress: fromAddress,
                            destAddress: destAddress,
                            sourceTS: feed.ts,
                            amountSent: amountSent,
                            incomplete: incomplete,
                            isFeeItem: isFeeItem,
                            msgHash: '0x',
                            sentAt: this.parserWatermark,
                            xcmSymbol: targetedSymbol,
                            xcmInteriorKey: targetedXcmInteriorKey,
                            xcmType: "xcmtransfer",
                        }
                        if (targetedXcmInteriorKey) {
                            r.xcmInteriorKey = targetedXcmInteriorKey
                        }
                        //console.log("processOutgoingXTransfer xTransfer", r);
                        outgoingXTransfer.push(r)
                        extrinsic.xcms.push(r)
                    } else {
                        if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`[${extrinsic.extrinsicHash}] processOutgoingXTransfer xTokens unknown asset/amountSent`);
                    }
                }

            } else {
                // TODO: tally errors in logger
                if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`[${extrinsic.extrinsicHash}] chainparser-processOutgoingXTransfer Unknown`, `module:${section_method}`);
            }
        } catch (e) {
            if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`processOutgoingXTransfer error`, e)
        }
        return outgoingXTransfer;
    }

    processOutgoingXTokens(indexer, extrinsic, feed, fromAddress, section_method, args) {
        //return
        let chainID = indexer.chainID
        if (extrinsic.xcmIndex == undefined) {
            extrinsic.xcmIndex = 0
        } else {
            extrinsic.xcmIndex += 1
        }
        let outgoingXTokens = []
        try {
            //let module_section = extrinsic.section;
            //let module_method = extrinsic.method;
            //let section_method = `${module_section}:${module_method}`
            //we are only looking at transfer/transferMulticurrencies/transferMultiasset
            let known_section_methods = [
                "xTokens:transfer",
                "xTokens:transferMultiasset",
                "xTokens:transferMultiassetWithFee",
                "xTokens:transferMultiassets",
                "xTokens:transferMulticurrencies",
                "xTokens:transferWithFee"
            ]
            if (known_section_methods.includes(section_method)) {
                // see https://github.com/open-web3-stack/open-runtime-module-library/tree/master/xtokens
                // test case: indexPeriods 8 2022-03-30 21
                // 0x11fbddaf7d2f0b4451bb85fab337d1d61c94234c4b9e5562d481a268236c5a7f | xTokens:transfer
                // 0x5f68eb1f1640447764d11ddda660c02989197b474a6e991adc203bb80fa510b4 | xTokens:transferMulticurrencies  (TODO)

                //let a = feed.params;
                let a = args
                let assetAndAmountSents = [];

                let dest = a.dest;
                let paraID = paraTool.getParaIDfromChainID(chainID)
                let relayChain = indexer.relayChain;

                // dest for parachain   {"v1":{"parents":1,"interior":{"x2":[{"parachain":2001},{"accountId32":{"network":{"any":null},"id":"0xbc7668c63c9f8869ed84996865a32d400bbee0a86ae8d204b4f990e617ed6a1c"}}]}}}
                // dest for relaychain  {"v1":{"parents":1,"interior":{"x1":{"accountId32":{"network":{"any":null},"id":"0x42f433b9325d91779a6e226931d20e31ec3f6017111b842ef4f7a3c13364bf63"}}}}}

                let [paraIDDest, chainIDDest, destAddress] = this.processDest(dest, relayChain)
                if (this.debugLevel >= paraTool.debugInfo) console.log(`[${extrinsic.extrinsicHash}] section_method=${section_method} paraIDDest=${paraIDDest}, chainIDDest=${chainIDDest}, destAddress=${destAddress}`)
                if (chainIDDest == -1 || paraIDDest == -1) {
                    //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`[${extrinsic.extrinsicHash}] section_method=${section_method} parsing failed`)
                    return
                }

                if (section_method == "xTokens:transfer") {
                    //single transfer
                    /* xTokens:transfer
                    "params": {
                      "currency_id": {
                        "token": "KAR"
                      },
                      "amount": 42000000000000,
                    */
                    let targetedSymbol = this.processXcmGenericCurrencyID(indexer, a.currency_id, chainID) //inferred approach
                    let targetedXcmInteriorKey = indexer.check_refintegrity_xcm_symbol(targetedSymbol, relayChain, chainID, chainIDDest, "processXcmGenericCurrencyID", `processOutgoingXTokensTransfer ${section_method}`, a.currency_id)
                    //let rawAssetString = this.processRawGenericCurrencyID(indexer, a.currency_id, chainID)
                    //MK REVIEW
                    let aa = {
                        //asset: assetString,
                        //rawAsset: rawAssetString,
                        xcmInteriorKey: targetedXcmInteriorKey,
                        xcmSymbol: targetedSymbol,
                        amountSent: paraTool.dechexToInt(a.amount),
                        transferIndex: 0,
                        isFeeItem: 1
                    }
                    assetAndAmountSents.push(aa)
                } else if (section_method == "xTokens:transferMulticurrencies" && a.currencies != undefined) {
                    /* xTokens:transferMulticurrencies (fee_item: currency index for fee-paying token)
                     */
                    let currencies = a.currencies
                    let feeIndex = a.fee_item
                    let transferIndex = 0
                    for (const c of currencies) {
                        let targetedSymbol = this.processXcmGenericCurrencyID(indexer, c[0], chainID) //inferred approach
                        let targetedXcmInteriorKey = indexer.check_refintegrity_xcm_symbol(targetedSymbol, relayChain, chainID, chainIDDest, "processXcmGenericCurrencyID", `processOutgoingXTokensTransfer ${section_method}`, c[0])
                        let aa = {
                            //asset: this.processGenericCurrencyID(indexer, c[0], chainID), //inferred approach
                            //rawAsset: this.processRawGenericCurrencyID(indexer, c[0], chainID),
                            xcmInteriorKey: targetedXcmInteriorKey,
                            xcmSymbol: targetedSymbol,
                            amountSent: paraTool.dechexToInt(c[1]),
                            transferIndex: transferIndex,
                            isFeeItem: (transferIndex == feeIndex) ? 1 : 0,
                        }
                        assetAndAmountSents.push(aa)
                        transferIndex++
                    }
                } else if (section_method == "xTokens:transferMultiasset" && a.asset != undefined) {
                    //if (this.debugLevel >= paraTool.debugInfo) console.log(`[${extrinsic.extrinsicHash}] processOutgoingXTokens new case`, section_method)
                    /*
                    "asset": {
                    {
                        "v1": {
                            "id": {
                                "concrete": {
                                    "parents": 1,
                                    "interior": {
                                        "x2": [
                                            {
                                                "parachain": 2023
                                            },
                                            {
                                                "palletInstance": 10
                                            }
                                        ]
                                    }
                                }
                            },
                            "fun": {
                                "fungible": "0x0000000000000000016f8d66cca4d44e"
                            }
                        }
                    }
                    */
                    let aAsset = a.asset
                    if (aAsset.v1 !== undefined) {
                        // todo: extract this
                        //if (this.debugLevel >= paraTool.debugInfo) console.log(`[${extrinsic.extrinsicHash}] processOutgoingXTokens xTokens:transferMultiasset`)
                        let aAssetv1 = aAsset.v1
                        let transferIndex = 0
                        let assetArr = []
                        assetArr.push(aAssetv1)
                        //no fee items
                        for (const asset of assetArr) {
                            // 0xc003ebdaaa4ef4d8ed2d89ca419cf79cefc883859ab9d74349d882dacf6bb811
                            // {"id":{"concrete":{"parents":0,"interior":{"here":null}}},"fun":{"fungible":10324356190528}}
                            if (asset.fun !== undefined && asset.fun.fungible !== undefined) {
                                let [targetedSymbol, targetedRelayChain, targetedXcmInteriorKey0] = this.processV1ConcreteFungible(indexer, asset)
                                let targetedXcmInteriorKey = indexer.check_refintegrity_xcm_symbol(targetedSymbol, targetedRelayChain, chainID, chainIDDest, "processV1ConcreteFungible", `processOutgoingXTokensTransfer ${section_method}`, asset)
                                if (targetedXcmInteriorKey == false) targetedXcmInteriorKey = targetedXcmInteriorKey0
                                let aa = {
                                    xcmInteriorKey: targetedXcmInteriorKey,
                                    xcmSymbol: targetedSymbol,
                                    amountSent: paraTool.dechexToInt(asset.fun.fungible),
                                    transferIndex: transferIndex,
                                    isFeeItem: 1,
                                }
                                assetAndAmountSents.push(aa)
                            } else {
                                //if (this.debugLevel >= paraTool.debugErrorOnly) console.log("asset v1 unknown", asset);
                                asset = false;
                            }
                            transferIndex++
                        }
                    } else {
                        //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`[${extrinsic.extrinsicHash}] processOutgoingXTokens xTokens:transferMultiasset asset unknown`)
                    }
                } else {
                    //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`[${extrinsic.extrinsicHash}] processOutgoingXTokens xTokens:transferMultiasset unknown case`, section_method)
                }

                for (const assetAndAmountSent of assetAndAmountSents) {
                    let targetedSymbol = assetAndAmountSent.xcmSymbol
                    let targetedXcmInteriorKey = assetAndAmountSent.xcmInteriorKey
                    let amountSent = assetAndAmountSent.amountSent
                    let transferIndex = assetAndAmountSent.transferIndex
                    let isFeeItem = assetAndAmountSent.isFeeItem
                    if (assetAndAmountSent != undefined && paraTool.validAmount(amountSent)) {
                        let incomplete = this.extract_xcm_incomplete(extrinsic.events, extrinsic.extrinsicID);
                        if (extrinsic.xcms == undefined) extrinsic.xcms = []
                        let xcmIndex = extrinsic.xcmIndex
                        let r = {
                            sectionMethod: section_method,
                            extrinsicHash: feed.extrinsicHash,
                            extrinsicID: feed.extrinsicID,
                            transferIndex: transferIndex,
                            xcmIndex: xcmIndex,
                            relayChain: relayChain,
                            chainID: chainID,
                            chainIDDest: chainIDDest,
                            paraID: paraID,
                            paraIDDest: paraIDDest,
                            blockNumber: this.parserBlockNumber,
                            fromAddress: fromAddress,
                            destAddress: destAddress,
                            sourceTS: feed.ts,
                            amountSent: amountSent,
                            incomplete: incomplete,
                            isFeeItem: isFeeItem,
                            msgHash: '0x',
                            sentAt: this.parserWatermark,
                            xcmSymbol: targetedSymbol,
                            xcmInteriorKey: targetedXcmInteriorKey,
                            xcmType: "xcmtransfer",
                        }
                        //console.log("processOutgoingXTokens xTokens ***", r);
                        outgoingXTokens.push(r)
                        extrinsic.xcms.push(r)
                        //outgoingXcmList.push(r)
                    } else {
                        //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`[${extrinsic.extrinsicHash}] processOutgoingXTokens xTokens unknown asset/amountSent`);
                    }
                }

            } else {
                // TODO: tally errors in logger
                if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`[${extrinsic.extrinsicHash}] chainparser-processOutgoingXTokens Unknown`, `module:${section_method}`);
            }
        } catch (e) {
            //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`processOutgoingXTokens error`, e)
        }
        return outgoingXTokens;
    }

    //TODO: go one level deep
    extract_xcm_incomplete(events, extrinsicID = false) {
        let incomplete = 0;
        for (let i = 0; i < events.length; i++) {
            let e = events[i];
            let sectionMethod = `${e.section}(${e.method})`
            if (sectionMethod == 'system(ExtrinsicFailed)') {
                //if (this.debugLevel >= paraTool.debugTracing) console.log(`[${extrinsicID}] ${sectionMethod} Failed`)
                incomplete = 1
                return incomplete;
            } else if (sectionMethod == 'xTokens(TransferFailed)') {
                //if (this.debugLevel >= paraTool.debugTracing) console.log(`[${extrinsicID}] ${sectionMethod} Failed`)
                incomplete = 1
                return incomplete;
            } else if (sectionMethod == 'utility(BatchInterrupted)') {
                incomplete = 1
                return incomplete;
            } else if ((e.section == "xcmPallet" || e.section == "polkadotXcm") && e.method == "Attempted") {
                let data = e.data;
                //console.log(`sectionMethod=${sectionMethod}`, data)
                if (Array.isArray(data)) {
                    //[{"incomplete":[1000000000,{"failedToTransactAsset":null}]}]
                    for (let j = 0; j < data.length; j++) {
                        let d = data[j];
                        if (d.incomplete !== undefined) {
                            let info = d.incomplete; // [1000000000,{"failedToTransactAsset":null}]
                            incomplete = 1;
                            //if (this.debugLevel >= paraTool.debugTracing) console.log("extract_xcm_incomplete INCOMPLETE");
                            return (incomplete);
                        } else if (d.error !== undefined) {
                            let info = d.error; // [{"error":{"weightLimitReached":"0xffffffffffffffff"}] see: 0x8d3b83fdefde0cfd1b3eae343644d9ebfb77ba724bc6b841383392b4fc6da07c
                            incomplete = 1;
                        }
                    }
                }
            }
        }
        return incomplete;
    }

    //This is the V1 format
    // TODO: want [symbol, relayChain] (ex. ["DOT", "polkadot"])
    processV1ConcreteFungible(indexer, fungibleAsset) {
        //v1
        // only parse the currency_id here
        /*
        "assets": {
            "v1": [
            {
              "id": {
                "concrete": {
                  "parents": 0,
                  "interior": {
                  "here": null
                }
              }
            },
            "fun": {
                "fungible": 102000000000
              }
            }
          ]
        },
        "fee_asset_item": 0
        */
        /*
        "assets": {
          "v1": [
            {
              "id": {
                "concrete": {
                  "parents": 0,
                  "interior": {
                    "x2": [
                      {
                        "palletInstance": 50
                      },
                      {
                        "generalIndex": 8
                      }
                    ]
                  }
                }
              },
              "fun": {
                "fungible": 300000000000
              }
            }
          ]
        }
        "asset": {
          "v1": {
            "id": {
              "concrete": {
                "parents": 1,
                "interior": {
                  "here": null
                }
              }
            },
            "fun": {
              "fungible": 20469417452
            }
          }
        },
        */
        let relayChain = indexer.relayChain
        let chainID = indexer.chainID
        let paraIDExtra = paraTool.getParaIDExtra(relayChain)
        let targetedAsset = false;
        let rawTargetedAsset = false;
        let targetSymbol = false;
        let targetXcmInteriorKey = false;
        //if (this.debugLevel >= paraTool.debugVerbose) console.log(`processV1ConcreteFungible asset`, fungibleAsset)
        if (fungibleAsset.id != undefined && fungibleAsset.id.null !== undefined) {
            targetSymbol = indexer.getNativeSymbol(chainID)
        } else if (fungibleAsset.id != undefined && fungibleAsset.id.concrete !== undefined) {
            //v1_id_concrete
            let v1_id_concrete = fungibleAsset.id.concrete
            if (v1_id_concrete.interior != undefined) {

                let v1_id_concrete_interior = v1_id_concrete.interior
                let v1_id_concrete_parents = v1_id_concrete.parents
                if (v1_id_concrete_interior != undefined && v1_id_concrete_interior.here !== undefined) {
                    if (v1_id_concrete_parents != undefined && v1_id_concrete_parents == 0) {
                        //normal case?
                        targetSymbol = indexer.getNativeSymbol(chainID)
                        //if (this.debugLevel >= paraTool.debugInfo) console.log(`processV1ConcreteFungible targetedAsset parents:0, here`, targetSymbol)
                    } else if (v1_id_concrete_parents != undefined && v1_id_concrete_parents == 1) {
                        //ump
                        targetSymbol = indexer.getRelayChainSymbol(chainID)
                        //if (this.debugLevel >= paraTool.debugInfo) console.log(`processV1ConcreteFungible targetedAsset parents:1, here`, targetSymbol)
                    }
                    //} else if (v1_id_concrete_interior != undefined && v1_id_concrete_interior.x2 !== undefined && Array.isArray(v1_id_concrete_interior.x2)) {
                } else {
                    //v1_id_concrete_interior case [x1/x2/x3]
                    //TODO: this is outcoming - relaychain's perspective
                    let xType = Object.keys(v1_id_concrete_interior)[0]
                    let v1_id_concrete_interiorVal = v1_id_concrete_interior[xType]
                    if (v1_id_concrete_parents == 1) {
                        // easy case: no expansion
                    } else {
                        // expand the key
                        let new_v1_id_concrete_interiorVal = []
                        let paraChainID = chainID - paraIDExtra
                        let expandedParachainPiece = {
                            parachain: paraChainID
                        }
                        new_v1_id_concrete_interiorVal.push(expandedParachainPiece)
                        if (xType == 'x1') {
                            new_v1_id_concrete_interiorVal.push(v1_id_concrete_interiorVal)

                        } else if (Array.isArray(v1_id_concrete_interiorVal)) {
                            //x2/x3...
                            for (const v of v1_id_concrete_interiorVal) {
                                new_v1_id_concrete_interiorVal.push(v)
                                //if (this.debugLevel >= paraTool.debugInfo) console.log(`${chainID}, [parents=${v1_id_concrete_parents}] expandedkey ${JSON.stringify(v1_id_concrete_interiorVal)} ->  ${JSON.stringify(new_v1_id_concrete_interiorVal)}`)
                            }
                            //new_v1_id_concrete_interiorVal.concat(v1_id_concrete_interiorVal)
                        } else {
                            //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`processV1ConcreteFungible error. expecting array`, JSON.stringify(v1_id_concrete_interiorVal))
                        }
                        v1_id_concrete_interiorVal = new_v1_id_concrete_interiorVal
                        let interiorVStr0 = JSON.stringify(v1_id_concrete_interiorVal)
                        if ([paraTool.chainIDKusamaAssetHub, paraTool.chainIDPolkadotAssetHub].includes(chainID)) {
                            if (interiorVStr0.includes("generalIndex") && !interiorVStr0.includes("palletInstance")) {
                                //Pad palletInstance for RMRK/USDT
                                let padded_interiorV0 = [expandedParachainPiece, {
                                    palletInstance: 50
                                }, v1_id_concrete_interiorVal[1]]
                                console.log(`pad!! original`, v1_id_concrete_interiorVal)
                                v1_id_concrete_interiorVal = padded_interiorV0
                            }
                        }
                    }

                    let interiorVStr = JSON.stringify(v1_id_concrete_interiorVal)
                    let xcmInteriorKey = paraTool.makeXcmInteriorKey(interiorVStr, relayChain)
                    if (xcmInteriorKey == '[{"parachain":1000},{"parent":null}]~kusama') xcmInteriorKey = 'here~kusama'
                    //console.log(`!!!IM here xcmInteriorKey=${xcmInteriorKey}`)
                    let cachedXcmAssetInfo = indexer.getXcmAssetInfoByInteriorkey(xcmInteriorKey)
                    if (cachedXcmAssetInfo != undefined && cachedXcmAssetInfo.nativeAssetChain != undefined) {
                        targetSymbol = cachedXcmAssetInfo.symbol
                        targetedAsset = cachedXcmAssetInfo.asset
                        targetXcmInteriorKey = cachedXcmAssetInfo.xcmInteriorKey
                        //rawTargetedAsset = cachedXcmAssetInfo.asset
                    } else {
                        if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`processV1ConcreteFungible cachedXcmAssetInfo lookup failed! parents=[${v1_id_concrete_parents}] [${xType}]`, xcmInteriorKey)
                        //lookup failed... should store the interiorVStr some where else for further debugging
                        //targetedAsset = interiorVStr
                        //rawTargetedAsset = interiorVStr
                        targetXcmInteriorKey = xcmInteriorKey
                    }
                }

            } else {
                //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`processV1ConcreteFungible unknown v1.id.concrete unknown!`, JSON.stringify(v1_id_concrete, null, 2))
            }
        } else {
            //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`processV1ConcreteFungible fungibleAsset unknown id not found?`, fungibleAsset)
        }
        return [targetSymbol, relayChain, targetXcmInteriorKey]
        //return [targetedAsset, rawTargetedAsset]
    }

    //This is the V0 format
    processV0ConcreteFungible(indexer, fungibleAsset) {
        let relayChain = indexer.relayChain
        let paraIDExtra = paraTool.getParaIDExtra(relayChain)
        let chainID = indexer.chainID
        let selfParaID = (chainID == paraTool.chainIDKusama || chainID == paraTool.chainIDPolkadot) ? 0 : chainID - paraIDExtra
        let targetedAsset = false;
        let rawTargetedAsset = false;
        let targetSymbol = false;
        let amountSent = 0
        /*
        "id": {
          "x2": [
          {
            "palletInstance": 50
          },
          {
            "generalIndex": 8
          }
        ]
        }
        "id": {
          "x3": [
          {
            "parent": null
          },
          {
            "parachain": 2000
          },
          {
            "generalKey": "0x0081"
          }
          ]
        },
        "id": {
          "x1": {
            "generalKey": "0x000000000000000000"
          }
        },
        */
        //if (this.debugLevel >= paraTool.debugVerbose) console.log(`fungibleAsset`, fungibleAsset)
        if (fungibleAsset.id != undefined) {
            let fungibleAsset_id = fungibleAsset.id
            let xType = Object.keys(fungibleAsset_id)[0]
            let interiorV0 = fungibleAsset_id[xType]
            if (fungibleAsset_id.null !== undefined || xType == 'null') {
                targetSymbol = indexer.getNativeSymbol(chainID)
            } else {
                //x1/x2/x3....
                let interiorVStr = false;
                let new_interiorV0 = []
                switch (xType) {
                    case 'x1':
                        if (interiorV0.parachain != undefined) {
                            //this is the interior key
                            interiorVStr = JSON.stringify(interiorV0)
                        } else {
                            // either genrealkey or generalIndex case -- expand to x2 by adding parachain
                            let expandedParachainPiece = {
                                parachain: selfParaID
                            }
                            new_interiorV0.push(expandedParachainPiece)
                            new_interiorV0.push(interiorV0)
                            interiorVStr = JSON.stringify(new_interiorV0)
                            if ((chainID == paraTool.chainIDKusamaAssetHub || chainID == paraTool.chainIDPolkadotAssetHub)) {
                                // pad palletInstance
                                if (interiorVStr.includes("generalIndex") && !interiorVStr.includes("palletInstance")) {
                                    console.log(`pad!! original`, new_interiorV0)
                                    interiorVStr = JSON.stringify([expandedParachainPiece, {
                                        palletInstance: 50
                                    }, interiorV0])
                                }
                            }
                        }
                        break;
                    default:
                        //x2/x3/...
                        if (Array.isArray(interiorV0)) {
                            // check the first key: parent/parachain/generalKey/palletInstance/generalIndex...
                            let firstPiece = interiorV0.shift()
                            let firstPieceKey = Object.keys(firstPiece)[0]
                            if (firstPieceKey == 'parent') {
                                //remove parent (no push)
                            } else if (firstPieceKey == 'parachain') {
                                //no change (push only)
                                new_interiorV0.push(firstPiece)
                            } else {
                                //pad (add expandedParachainPiece before push)
                                let expandedParachainPiece = {
                                    parachain: selfParaID
                                }
                                new_interiorV0.push(expandedParachainPiece)
                                new_interiorV0.push(firstPiece)
                            }
                            for (const interiorV0Piece of interiorV0) {
                                new_interiorV0.push(interiorV0Piece)
                            }
                            interiorVStr = JSON.stringify(new_interiorV0)
                            if ((chainID == paraTool.chainIDKusamaAssetHub || chainID == paraTool.chainIDPolkadotAssetHub)) {
                                // pad palletInstance
                                if (interiorVStr.includes("generalIndex") && !interiorVStr.includes("palletInstance")) {
                                    //console.log(`pad!! original`, new_interiorV0)
                                    let padded_interiorV0 = [expandedParachainPiece, {
                                        palletInstance: 50
                                    }, new_interiorV0[1]]
                                    //console.log(`pad!! padded_interiorV0`, padded_interiorV0)
                                    interiorVStr = JSON.stringify(padded_interiorV0)
                                }
                            }
                        } else {
                            //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`processV0ConcreteFungible unknown fungibleAsset type [${xType}]`, JSON.stringify(interiorV0, null, 2))
                        }
                        break;
                }
                //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`processV0ConcreteFungible derived interiorVStr [${xType}] ${JSON.stringify(interiorV0)} -> ${interiorVStr}`)
                let xcmInteriorKey = paraTool.makeXcmInteriorKey(interiorVStr, relayChain)
                if (xcmInteriorKey == '[{"parachain":1000},{"parent":null}]~kusama') xcmInteriorKey = 'here~kusama'
                let cachedXcmAssetInfo = indexer.getXcmAssetInfoByInteriorkey(xcmInteriorKey)
                //console.log(`[${xcmInteriorKey}] cachedXcmAssetInfo`, cachedXcmAssetInfo)
                if (cachedXcmAssetInfo != undefined && cachedXcmAssetInfo.nativeAssetChain != undefined) {
                    targetedAsset = cachedXcmAssetInfo.asset
                    if (!targetedAsset && cachedXcmAssetInfo.symbol != undefined) {
                        targetSymbol = cachedXcmAssetInfo.symbol
                    }
                    //rawTargetedAsset = cachedXcmAssetInfo.asset
                    if (cachedXcmAssetInfo.xcmchainID == 1000 || cachedXcmAssetInfo.xcmchainID == 21000) {
                        targetSymbol = cachedXcmAssetInfo.symbol
                    }
                    //if (this.debugLevel >= paraTool.debugVerbose) console.log(`xcmInteriorKey ${xcmInteriorKey} Found -> targetSymbol=${targetSymbol} (${relayChain})`)
                } else {
                    //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`processV0ConcreteFungible cachedXcmAssetInfo lookup failed! [${xType}]`, xcmInteriorKey)
                    //targetedAsset = interiorVStr
                    //rawTargetedAsset = interiorVStr
                }
            }
        }

        if (fungibleAsset.amount !== undefined) {
            amountSent = paraTool.dechexToInt(fungibleAsset.amount);
            //if (this.debugLevel >= paraTool.debugVerbose) console.log(`fungibleAsset amountSent`, amountSent)
        } else {
            //if (this.debugLevel >= paraTool.debugErrorOnly) console.log("processV0ConcreteFungible fungibleAsset unknown", fungibleAsset);
            //targetedAsset = false;
            //rawTargetedAsset = false;
        }
        return [targetSymbol, relayChain, amountSent]
        //return [targetedAsset, rawTargetedAsset, amountSent]
    }

    processBeneficiary(indexer, beneficiary, relayChain = 'polkadot', decorate = false) {
        //console.log(`processBeneficiary called`, beneficiary)
        let paraIDDest, chainIDDest, destAddress;
        let isInterior = (beneficiary.interior != undefined) ? 1 : 0
        let beneficiaryType = (beneficiary.interior != undefined) ? Object.keys(beneficiary.interior)[0] : Object.keys(beneficiary)[0] //handle dest.beneficiary
        let beneficiaryV = (beneficiary.interior != undefined) ? beneficiary['interior'][beneficiaryType] : beneficiary[beneficiaryType] //move up dest.beneficiary
        // console.log(`beneficiaryType=${beneficiaryType}, beneficiaryV`, beneficiaryV)
        switch (beneficiaryType) {
            case 'x1':
                //I think it's possible?
                [paraIDDest, chainIDDest, destAddress] = this.processX1(beneficiaryV, relayChain, true, indexer)
                if (isInterior) {
                    beneficiary['interior'][beneficiaryType] = beneficiaryV
                } else {
                    beneficiary[beneficiaryType] = beneficiaryV
                }
                break;
            case 'x2':
                [paraIDDest, chainIDDest, destAddress] = this.processX2(beneficiaryV, relayChain, true, indexer)
                if (isInterior) {
                    beneficiary['interior'][beneficiaryType] = beneficiaryV
                } else {
                    beneficiary[beneficiaryType] = beneficiaryV
                }
                break;
            case 'x3':
                [paraIDDest, chainIDDest, destAddress] = this.processX3(beneficiaryV, relayChain, true, indexer)
                //console.log(`x3!!!! paraIDDest=${paraIDDest}, chainIDDest=${chainIDDest}, destAddress=${destAddress}`, JSON.stringify(beneficiaryV, null, 4))
                if (isInterior) {
                    beneficiary['interior'][beneficiaryType] = beneficiaryV
                } else {
                    beneficiary[beneficiaryType] = beneficiaryV
                }
                break;
            case 'v0':
                let beneficiaryV0XType = Object.keys(beneficiaryV)[0]
                let beneficiaryV0V = Object.keys(beneficiaryV0XType)[0]
                if (beneficiaryV0XType == 'x1') {
                    //0x0db891b6d6af60401a21f72761ed04a6024bf37b6cdeaab62d0bc3963c5c9357
                    [paraIDDest, chainIDDest, destAddress] = this.processX1(beneficiaryV0V, relayChain, true, indexer)
                } else if (beneficiaryV0XType == 'x2') {
                    // I think this this can happen when xcmPallet to para?
                    [paraIDDest, chainIDDest, destAddress] = this.processX2(beneficiaryV0V, relayChain, true, indexer)
                } else {
                    //console.log(`unknown beneficiaryV0XType=${beneficiaryV0XType}`)
                    break;
                }
                if (isInterior) {
                    beneficiary['interior'][beneficiaryType][beneficiaryV0XType] = beneficiaryV0V
                } else {
                    beneficiary[beneficiaryType][beneficiaryV0XType] = beneficiaryV0V
                }
                break;
            case 'v1':
                let beneficiaryV1XType = Object.keys(beneficiaryV)[0]
                let beneficiaryV1V = Object.keys(beneficiaryV1XType)[0]
                if (beneficiaryV1V.interior != undefined) {
                    let beneficiaryV1VInteriorXType = Object.keys(beneficiaryV1V.interior)[0]
                    let beneficiaryV1VInteriorV = beneficiaryV1V['interior'][beneficiaryV1VInteriorXType]
                    if (beneficiaryV1VInteriorXType == 'x1') {
                        //0x0db891b6d6af60401a21f72761ed04a6024bf37b6cdeaab62d0bc3963c5c9357
                        [paraIDDest, chainIDDest, destAddress] = this.processX1(beneficiaryV1VInteriorV, relayChain, true, indexer)
                    } else if (beneficiaryV1VInteriorXType == 'x2') {
                        // I think this this can happen when xcmPallet to para?
                        [paraIDDest, chainIDDest, destAddress] = this.processX2(beneficiaryV1VInteriorV, relayChain, true, indexer)
                    } else {
                        //console.log(`unknown beneficiaryV1VInteriorXType=${beneficiaryV1VInteriorXType}`)
                        break;
                    }
                    if (isInterior) {
                        beneficiary['interior'][beneficiaryType][beneficiaryV1XType]['interior'][beneficiaryV1VInteriorXType] = beneficiaryV1VInteriorV
                    } else {
                        beneficiary[beneficiaryType][beneficiaryV1XType]['interior'][beneficiaryV1VInteriorXType] = beneficiaryV1VInteriorV
                    }
                } else {
                    //console.log(`unknown beneficiaryV1V interior not exist`)
                }
                break;
            case 'v2':
                //console.log(`unknown beneficiaryV2Type=${beneficiaryV}`)
                break;
            default:
                console.log(`unknown beneficiaryType ${beneficiaryType}`)
        }
        return destAddress
    }

    processPolkadotXcmV3MsgCandidates(extrinsic) {
        let xcmMsgHashEvents = extrinsic.events.filter((ev) => {
            return this.xcmMsgFilter(`${ev.section}(${ev.method})`);
        })
        let xcmMsgHashCandidates = []
        for (const msgEvent of xcmMsgHashEvents) {
            xcmMsgHashCandidates.push(msgEvent.data[0])
        }
        return xcmMsgHashCandidates
    }

    processOutgoingPolkadotXcm(indexer, extrinsic, feed, fromAddress, section_method, args) {
        let chainID = indexer.chainID
        if (extrinsic.xcmIndex == undefined) {
            extrinsic.xcmIndex = 0
        } else {
            extrinsic.xcmIndex += 1
        }
        let outgoingXcmPallet = []
        let xcmMsgHashCandidates = this.processPolkadotXcmV3MsgCandidates(extrinsic)
        try {
            //let module_section = extrinsic.section;
            //let module_method = extrinsic.method;
            //let section_method = `${module_section}:${module_method}`
            let known_section_methods = [
                "polkadotXcm:limitedReserveTransferAssets",
                "polkadotXcm:limitedReserveWithdrawAssets",
                "polkadotXcm:limitedTeleportAssets",
                "polkadotXcm:reserveTransferAssets",
                "polkadotXcm:reserveWithdrawAssets",
                "polkadotXcm:send",
                "polkadotXcm:teleportAssets"
            ]
            if (known_section_methods.includes(section_method)) {
                let paraID = paraTool.getParaIDfromChainID(chainID)
                let paraIDDest = -1;
                let chainIDDest = -1;
                //let amountSent = 0;
                let destAddress = null;
                let relayChain = indexer.relayChain;
                //let a = extrinsic.params;
                let a = args
                let assetAndAmountSents = [];
                console.log(`${extrinsic.extrinsicHash} args`, a)
                // !!!! beneficiary processing + dest processing MUST happen before asset
                // beneficiary processing -- TODO: check that fromAddress is in beneficiary
                if (a.beneficiary !== undefined) {
                    let beneficiary = a.beneficiary
                    if (beneficiary.v0 !== undefined) {
                        let beneficiary_v0 = beneficiary.v0
                        //console.log("beneficiary v0=", JSON.stringify(a.beneficiary.v0));
                        if (beneficiary_v0.x1 != undefined) {
                            //0x0db891b6d6af60401a21f72761ed04a6024bf37b6cdeaab62d0bc3963c5c9357
                            [paraIDDest, chainIDDest, destAddress] = this.processX1(beneficiary_v0.x1, relayChain)
                        } else if (beneficiary_v0.x2 !== undefined) {
                            // I think this this can happen when xcmPallet to para?
                            [paraIDDest, chainIDDest, destAddress] = this.processX2(beneficiary_v0.x2, relayChain)
                        }

                    } else if (beneficiary.v1 !== undefined) {
                        //console.log(`beneficiary.v1 case`, JSON.stringify(beneficiary.v1, null, 2))
                        //console.log("beneficiary v1=", JSON.stringify(a.beneficiary.v1));
                        if (beneficiary.v1.interior !== undefined) {
                            let beneficiaryV1Interior = beneficiary.v1.interior;
                            // dest for relaychain
                            if (beneficiaryV1Interior.x1 !== undefined) {
                                [paraIDDest, chainIDDest, destAddress] = this.processX1(beneficiaryV1Interior.x1, relayChain)
                            } else if (beneficiaryV1Interior.x2 !== undefined) {
                                [paraIDDest, chainIDDest, destAddress] = this.processX2(beneficiaryV1Interior.x2, relayChain)
                            } else {
                                //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`beneficiary.v1.interior unknown case`, beneficiaryV1Interior)
                            }
                        } else {
                            if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`beneficiary.v1 unknown case`, beneficiary.v1)
                        }
                    } else if (beneficiary.v2 !== undefined) {
                        // xcmV3 here
                        console.log(`xcmV3 beneficiary.v2 case`, JSON.stringify(beneficiary.v2, null, 2))
                        console.log("beneficiary v2=", JSON.stringify(a.beneficiary.v2));
                        if (beneficiary.v2.interior !== undefined) {
                            let beneficiaryV2Interior = beneficiary.v2.interior;
                            // dest for relaychain
                            if (beneficiaryV2Interior.x1 !== undefined) {
                                [paraIDDest, chainIDDest, destAddress] = this.processX1(beneficiaryV2Interior.x1, relayChain)
                            } else if (beneficiaryV2Interior.x2 !== undefined) {
                                [paraIDDest, chainIDDest, destAddress] = this.processX2(beneficiaryV2Interior.x2, relayChain)
                            } else {
                                if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`beneficiary.v2.interior unknown case`, beneficiaryV2Interior)
                            }
                        } else {
                            if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`beneficiary.v2 unknown case`, beneficiary.v2)
                        }
                    } else if (beneficiary.v3 !== undefined) {
                        console.log(`xcmV3 beneficiary.v3 case`, JSON.stringify(beneficiary.v3, null, 2))
                        console.log("beneficiary v3=", JSON.stringify(a.beneficiary.v3));
                        if (beneficiary.v3.interior !== undefined) {
                            let beneficiaryV3Interior = beneficiary.v3.interior;
                            // dest for relaychain
                            if (beneficiaryV3Interior.x1 !== undefined) {
                                [paraIDDest, chainIDDest, destAddress] = this.processX1(beneficiaryV3Interior.x1, relayChain)
                                console.log(`beneficiary.v3 paraIDDest=${paraIDDest}, chainIDDest=${chainIDDest}, destAddress=${destAddress}`)
                            } else if (beneficiaryV3Interior.x2 !== undefined) {
                                [paraIDDest, chainIDDest, destAddress] = this.processX2(beneficiaryV3Interior.x2, relayChain)
                            } else {
                                if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`beneficiary.v3.interior unknown case`, beneficiaryV2Interior)
                            }
                        } else {
                            if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`beneficiary.v3 unknown case`, beneficiary.v3)
                        }
                    } else if (beneficiary.x1 !== undefined) {
                        [paraIDDest, chainIDDest, destAddress] = this.processX1(beneficiary.x1, relayChain)
                    } else if (beneficiary.x2 !== undefined) {
                        [paraIDDest, chainIDDest, destAddress] = this.processX2(beneficiary.x2, relayChain)
                    } else {
                        if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`[${extrinsic.extrinsicHash}] section_method=${section_method} Unknown beneficiary`, beneficiary)
                    }
                }
                // dest processing
                let dest = a.dest;
                let destAddress2 = false // unused
                if (dest.v0 !== undefined) {
                    //todo: extract
                    let dest_v0 = dest.v0
                    if (dest_v0.x1 !== undefined) {
                        [paraIDDest, chainIDDest] = this.processDestV0X1(dest_v0.x1, relayChain)
                    } else if (dest_v0.x2 !== undefined) {
                        /*
                          {"x2":[
                            {"parent":null},
                            {"parachain":2000}
                            ]
                          }
                        */
                        //MK check
                        //0x98324306c4ae1a6ecb9ab3798ba3a300e5a7cdef377fccb9ee716209d4c16891
                        [paraIDDest, chainIDDest] = this.processDestV0X2(dest_v0.x2, relayChain)
                        //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`[${extrinsic.extrinsicHash}] paraIDDest=${paraIDDest}, chainIDDest=${chainIDDest}`)
                    } else {
                        //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`[${extrinsic.extrinsicHash}] dest v0 unk = `, JSON.stringify(dest.v0));
                        chainIDDest = false
                    }
                } else if ((dest.v1 !== undefined) && (dest.v1.interior !== undefined)) {
                    // xcmPallet dest.v1.interior does not have id?
                    let destV1Interior = dest.v1.interior
                    if (destV1Interior.x1 !== undefined) {
                        // {"v1":{"parents":0,"interior":{"x1":{"parachain":2012}}}}
                        //[paraIDDest, chainIDDest, destAddress] = this.processX1(destV1Interior.x1, relayChain)
                        [paraIDDest, chainIDDest] = this.processDestV0X1(destV1Interior.x1, relayChain)
                    } else if (destV1Interior.x2 !== undefined) {
                        //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`potental error case destV1Interior.x2`, destV1Interior.x2)
                        // dest for parachain, add 20000 for kusama-relay
                        [paraIDDest, chainIDDest, _d] = this.processX2(destV1Interior.x2, relayChain)
                    } else if (dest.v1.parents !== undefined && dest.v1.parents == 1 && destV1Interior != undefined && destV1Interior.here !== undefined) {
                        paraIDDest = 0
                        chainIDDest = paraTool.getChainIDFromParaIDAndRelayChain(0, relayChain)
                    } else {
                        //if (this.debugLevel >= paraTool.debugErrorOnly) console.log("dest v1 int unk = ", JSON.stringify(dest.v1.interior));
                        chainIDDest = false
                    }
                } else if ((dest.v2 !== undefined) && (dest.v2.interior !== undefined)) {
                    // xcmV3 here
                    let destV2Interior = dest.v2.interior
                    if (destV2Interior.x1 !== undefined) {
                        [paraIDDest, chainIDDest] = this.processDestV0X1(destV2Interior.x1, relayChain)
                    } else if (destV2Interior.x2 !== undefined) {
                        //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`potental error case destV2Interior.x2`, destV2Interior.x2)
                        // dest for parachain, add 20000 for kusama-relay
                        [paraIDDest, chainIDDest, _d] = this.processX2(destV2Interior.x2, relayChain)
                    } else if (dest.v2.parents !== undefined && dest.v2.parents == 1 && destV2Interior != undefined && destV2Interior.here !== undefined) {
                        paraIDDest = 0
                        chainIDDest = paraTool.getChainIDFromParaIDAndRelayChain(0, relayChain)
                    } else {
                        if (this.debugLevel >= paraTool.debugInfo) console.log("xcmV3 dest v2 int unk = ", JSON.stringify(dest.v2.interior));
                        chainIDDest = false
                    }
                } else if ((dest.v3 !== undefined) && (dest.v3.interior !== undefined)) {
                    // xcmV3 here
                    console.log(`dest.v3.interior case`, JSON.stringify(dest.v3, null, 2))
                    console.log("destV3Interior v3=", JSON.stringify(a.dest.v3.interior));
                    let destV3Interior = dest.v3.interior
                    if (destV3Interior.x1 !== undefined) {
                        [paraIDDest, chainIDDest] = this.processDestV0X1(destV3Interior.x1, relayChain)
                    } else if (destV3Interior.x2 !== undefined) {
                        //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`potental error case destV3Interior.x2`, destV3Interior.x2)
                        // dest for parachain, add 20000 for kusama-relay
                        [paraIDDest, chainIDDest, _d] = this.processX2(destV3Interior.x2, relayChain)
                    } else if (dest.v3.parents !== undefined && dest.v3.parents == 1 && destV3Interior != undefined && destV3Interior.here !== undefined) {
                        paraIDDest = 0
                        chainIDDest = paraTool.getChainIDFromParaIDAndRelayChain(0, relayChain)
                    } else {
                        if (this.debugLevel >= paraTool.debugInfo) console.log("xcmV3 dest v3 int unk = ", JSON.stringify(dest.v3.interior));
                        chainIDDest = false
                    }
                    console.log(`dest.v3 paraIDDest=${paraIDDest}, chainIDDest=${chainIDDest}`)
                }


                // asset processing
                //console.log(`[${extrinsic.extrinsicHash}] section_method=${section_method}`, JSON.stringify(a, null, 2))
                if (a !== undefined && a.assets !== undefined) {
                    let assets = a.assets;
                    let feeAssetIndex = a.fee_asset_item
                    if (assets.v0 !== undefined && Array.isArray(assets.v0) && assets.v0.length > 0) {
                        let assetsv0 = assets.v0
                        let transferIndex = 0
                        for (const asset of assetsv0) {
                            if (asset.concreteFungible !== undefined) {
                                // extract this
                                /*
                                {
                                  "concreteFungible": {
                                    "id": {
                                      "null": null
                                    },
                                    "amount": 6800000000000
                                  }
                                }
                                */
                                let fungibleAsset = asset.concreteFungible;
                                //if (this.debugLevel >= paraTool.debugVerbose) console.log(`[${extrinsic.extrinsicHash}] processV0ConcreteFungible`)
                                //let [targetedAsset, rawTargetedAsset, amountSent] = this.processV0ConcreteFungible(indexer, fungibleAsset)
                                //rawTargetedAsset = indexer.check_refintegrity_asset(rawTargetedAsset, "processOutgoingPolkadotXcm - processV0ConcreteFungible", fungibleAsset)
                                let [targetedSymbol, targetedRelayChain, amountSent] = this.processV0ConcreteFungible(indexer, fungibleAsset)
                                let targetedXcmInteriorKey = indexer.check_refintegrity_xcm_symbol(targetedSymbol, targetedRelayChain, chainID, chainIDDest, "processV0ConcreteFungible", `processOutgoingPolkadotXcm ${section_method}`, fungibleAsset)
                                //if (this.debugLevel >= paraTool.debugVerbose) console.log(`targetedSymbol=${targetedSymbol}, amountSent=${amountSent}`)
                                console.log(`[${extrinsic.extrinsicHash}] ++ processV0ConcreteFungible targetedSymbol=${targetedSymbol}, targetedRelayChain=${targetedRelayChain}, targetedXcmInteriorKey=${targetedXcmInteriorKey}`)
                                let aa = {
                                    //asset: targetedAsset,
                                    //rawAsset: rawTargetedAsset,
                                    xcmInteriorKey: targetedXcmInteriorKey,
                                    xcmSymbol: targetedSymbol,
                                    amountSent: amountSent,
                                    transferIndex: transferIndex,
                                    isFeeItem: (transferIndex == feeAssetIndex) ? 1 : 0,
                                }
                                //if (this.debugLevel >= paraTool.debugInfo) console.log(`assetAndAmountSents`, aa)
                                assetAndAmountSents.push(aa)
                            }
                            transferIndex++
                        }
                    } else if (assets.v1 !== undefined && Array.isArray(assets.v1) && assets.v1.length > 0) {
                        // todo: extract this
                        //if (this.debugLevel >= paraTool.debugVerbose) console.log(`[${extrinsic.extrinsicHash}] polkadotXcm assets.v1 case`)
                        let assetsv1 = assets.v1
                        let transferIndex = 0
                        for (const asset of assetsv1) {
                            // 0x2374aae493ae96e44954bcb4f242a049f2578d490bc382eae113fd5893dfd297
                            // {"id":{"concrete":{"parents":0,"interior":{"here":null}}},"fun":{"fungible":10324356190528}}
                            if (asset.fun !== undefined && asset.fun.fungible !== undefined) {
                                let [targetedSymbol, targetedRelayChain, targetedXcmInteriorKey0] = this.processV1ConcreteFungible(indexer, asset)
                                let targetedXcmInteriorKey = indexer.check_refintegrity_xcm_symbol(targetedSymbol, targetedRelayChain, chainID, chainIDDest, "processV1ConcreteFungible", `processOutgoingPolkadotXcm ${section_method}`, asset)
                                console.log(`[${extrinsic.extrinsicHash}] ++ processV1ConcreteFungible targetedSymbol=${targetedSymbol}, targetedRelayChain=${targetedRelayChain}, targetedXcmInteriorKey=${targetedXcmInteriorKey}, targetedXcmInteriorKey0=${targetedXcmInteriorKey0}`)
                                if (targetedXcmInteriorKey == false) targetedXcmInteriorKey = targetedXcmInteriorKey0
                                let aa = {
                                    xcmInteriorKey: targetedXcmInteriorKey,
                                    xcmSymbol: targetedSymbol,
                                    amountSent: paraTool.dechexToInt(asset.fun.fungible),
                                    transferIndex: transferIndex,
                                    isFeeItem: (transferIndex == feeAssetIndex) ? 1 : 0,
                                }
                                assetAndAmountSents.push(aa)
                            } else {
                                //if (this.debugLevel >= paraTool.debugErrorOnly) console.log("polkadotXcm asset v1 unknown", asset);
                                asset = false;
                            }
                            transferIndex++
                        }
                    } else if (assets.v2 !== undefined && Array.isArray(assets.v2) && assets.v2.length > 0) {
                        // xcmV3 here
                        if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`[${extrinsic.extrinsicHash}] xcmV3 polkadotXcm assets.v2 case`)
                        let assetsv2 = assets.v2
                        let transferIndex = 0
                        for (const asset of assetsv2) {
                            // 0x2374aae493ae96e44954bcb4f242a049f2578d490bc382eae113fd5893dfd297
                            // {"id":{"concrete":{"parents":0,"interior":{"here":null}}},"fun":{"fungible":10324356190528}}
                            if (asset.fun !== undefined && asset.fun.fungible !== undefined) {
                                let [targetedSymbol, targetedRelayChain, targetedXcmInteriorKey0] = this.processV1ConcreteFungible(indexer, asset)
                                let targetedXcmInteriorKey = indexer.check_refintegrity_xcm_symbol(targetedSymbol, targetedRelayChain, chainID, chainIDDest, "processV1ConcreteFungible", `processOutgoingPolkadotXcm ${section_method}`, asset)
                                console.log(`[${extrinsic.extrinsicHash}] ++ processV1ConcreteFungible targetedSymbol=${targetedSymbol}, targetedRelayChain=${targetedRelayChain}, targetedXcmInteriorKey=${targetedXcmInteriorKey}, targetedXcmInteriorKey0=${targetedXcmInteriorKey0}`)
                                if (targetedXcmInteriorKey == false) targetedXcmInteriorKey = targetedXcmInteriorKey0
                                let aa = {
                                    xcmInteriorKey: targetedXcmInteriorKey,
                                    xcmSymbol: targetedSymbol,
                                    amountSent: paraTool.dechexToInt(asset.fun.fungible),
                                    transferIndex: transferIndex,
                                    isFeeItem: (transferIndex == feeAssetIndex) ? 1 : 0,
                                }
                                assetAndAmountSents.push(aa)
                            } else {
                                if (this.debugLevel >= paraTool.debugErrorOnly) console.log("polkadotXcm asset v2 unknown", asset);
                                asset = false;
                            }
                            transferIndex++
                        }
                    } else if (assets.v3 !== undefined && Array.isArray(assets.v3) && assets.v3.length > 0) {
                        // xcmV3 here
                        if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`[${extrinsic.extrinsicHash}] xcmV3 polkadotXcm assets.v3 case`)
                        let assetsv3 = assets.v3
                        let transferIndex = 0
                        for (const asset of assetsv3) {
                            // 0x2374aae493ae96e44954bcb4f242a049f2578d490bc382eae113fd5893dfd297
                            // {"id":{"concrete":{"parents":0,"interior":{"here":null}}},"fun":{"fungible":10324356190528}}
                            if (asset.fun !== undefined && asset.fun.fungible !== undefined) {
                                let [targetedSymbol, targetedRelayChain, targetedXcmInteriorKey0] = this.processV1ConcreteFungible(indexer, asset)
                                let targetedXcmInteriorKey = indexer.check_refintegrity_xcm_symbol(targetedSymbol, targetedRelayChain, chainID, chainIDDest, "processV1ConcreteFungible", `processOutgoingPolkadotXcm ${section_method}`, asset)
                                console.log(`[${extrinsic.extrinsicHash}] ++ processV1ConcreteFungible targetedSymbol=${targetedSymbol}, targetedRelayChain=${targetedRelayChain}, targetedXcmInteriorKey=${targetedXcmInteriorKey}, targetedXcmInteriorKey0=${targetedXcmInteriorKey0}`)
                                if (targetedXcmInteriorKey == false) targetedXcmInteriorKey = targetedXcmInteriorKey0
                                let aa = {
                                    xcmInteriorKey: targetedXcmInteriorKey,
                                    xcmSymbol: targetedSymbol,
                                    amountSent: paraTool.dechexToInt(asset.fun.fungible),
                                    transferIndex: transferIndex,
                                    isFeeItem: (transferIndex == feeAssetIndex) ? 1 : 0,
                                }
                                assetAndAmountSents.push(aa)
                            } else {
                                if (this.debugLevel >= paraTool.debugErrorOnly) console.log("polkadotXcm asset v2 unknown", asset);
                                asset = false;
                            }
                            transferIndex++
                        }
                    }
                    for (const assetAndAmountSent of assetAndAmountSents) {
                        let targetedSymbol = assetAndAmountSent.xcmSymbol
                        let targetedXcmInteriorKey = assetAndAmountSent.xcmInteriorKey
                        let amountSent = assetAndAmountSent.amountSent
                        let transferIndex = assetAndAmountSent.transferIndex
                        let isFeeItem = assetAndAmountSent.isFeeItem
                        let incomplete = this.extract_xcm_incomplete(extrinsic.events, extrinsic.extrinsicID);
                        if (assetAndAmountSent != undefined && paraTool.validAmount(amountSent) && (chainIDDest || chainIDDest == paraTool.chainIDPolkadot)) {
                            let msgHash = '0x'
                            let xcmIndex = extrinsic.xcmIndex
                            if (xcmMsgHashCandidates.length > 0) {
                                if ((xcmMsgHashCandidates.length - 1 >= xcmIndex) && xcmMsgHashCandidates[xcmIndex] != undefined) {
                                    msgHash = xcmMsgHashCandidates[xcmIndex]
                                    if (this.debugLevel >= paraTool.debugInfo) console.log(`Found xcmV3 ${feed.extrinsicHash} via event: ${msgHash}`)
                                }
                            }
                            if (extrinsic.xcms == undefined) extrinsic.xcms = []
                            let r = {
                                sectionMethod: section_method,
                                extrinsicHash: feed.extrinsicHash,
                                extrinsicID: feed.extrinsicID,
                                transferIndex: transferIndex,
                                xcmIndex: xcmIndex,
                                relayChain: indexer.relayChain,
                                chainID: chainID,
                                chainIDDest: chainIDDest,
                                paraID: paraID,
                                paraIDDest: paraIDDest,
                                blockNumber: this.parserBlockNumber,
                                fromAddress: fromAddress,
                                destAddress: destAddress,
                                sourceTS: feed.ts,
                                amountSent: amountSent,
                                incomplete: incomplete,
                                isFeeItem: isFeeItem,
                                msgHash: '0x',
                                sentAt: this.parserWatermark,
                                xcmSymbol: targetedSymbol,
                                xcmInteriorKey: targetedXcmInteriorKey,
                                xcmType: "xcmtransfer",
                            }
                            //if (this.debugLevel >= paraTool.debugTracing) console.log("processOutgoingPolkadotXcm xcmPallet", r);
                            outgoingXcmPallet.push(r)
                            extrinsic.xcms.push(r)
                            //outgoingXcmList.push(r)
                        } else if (incomplete) {
                            if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`[${extrinsic.extrinsicHash}] chainparser-processXCMTransfer incomplete `, `module:${section_method}`, a);
                            // TODO: tally error
                            if (extrinsic.xcms == undefined) extrinsic.xcms = []
                            let xcmIndex = extrinsic.xcmIndex
                            let r = {
                                sectionMethod: section_method,
                                extrinsicHash: feed.extrinsicHash,
                                extrinsicID: feed.extrinsicID,
                                transferIndex: transferIndex,
                                xcmIndex: xcmIndex,
                                relayChain: indexer.relayChain,
                                chainID: chainID,
                                chainIDDest: chainIDDest,
                                paraID: paraID,
                                paraIDDest: paraIDDest,
                                blockNumber: this.parserBlockNumber,
                                fromAddress: fromAddress,
                                destAddress: destAddress,
                                sourceTS: feed.ts,
                                amountSent: amountSent,
                                incomplete: incomplete,
                                isFeeItem: isFeeItem,
                                msgHash: '0x',
                                sentAt: this.parserWatermark,
                                xcmSymbol: targetedSymbol,
                                xcmInteriorKey: targetedXcmInteriorKey,
                                xcmType: "xcmtransfer",
                            }
                            //console.log("processOutgoingPolkadotXcm xcmPallet incomplete", r);
                            //outgoingXcmPallet.push(r)
                            //extrinsic.xcms.push(r)
                        } else {
                            //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`[${extrinsic.extrinsicHash}] chainparser-processXCMTransfer unknown `, `module:${section_method}`, a);
                            // TODO: tally error
                        }
                    }
                }
            }
        } catch (e) {
            //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`processOutgoingPolkadotXcm error`, e)
            return outgoingXcmPallet
        }
        return outgoingXcmPallet
    }

    processOutgoingXcmPallet(indexer, extrinsic, feed, fromAddress, section_method, args) {
        let chainID = indexer.chainID
        if (extrinsic.xcmIndex == undefined) {
            extrinsic.xcmIndex = 0
        } else {
            extrinsic.xcmIndex += 1
        }
        let outgoingXcmPallet = []
        try {
            //let module_section = extrinsic.section;
            //let module_method = extrinsic.method;
            //let section_method = `${module_section}:${module_method}`
            let xcmMsgHashCandidates = this.processPolkadotXcmV3MsgCandidates(extrinsic)

            //0x22729316af52c146e6a0773bd6e119efa51f5dda1f678b2891b53a8f2e5a2521 xcmPallet:reserveTransferAssets
            let known_section_methods = [
                "xcmPallet:limitedReserveTransferAssets",
                "xcmPallet:limitedReserveWithdrawAssets",
                "xcmPallet:limitedTeleportAssets",
                "xcmPallet:reserveTransferAssets",
                "xcmPallet:reserveWithdrawAssets",
                "xcmPallet:send",
                "xcmPallet:teleportAssets"
            ]
            if (known_section_methods.includes(section_method)) {
                let paraID = paraTool.getParaIDfromChainID(chainID)
                let paraIDDest = -1;
                let chainIDDest = -1;
                //let amountSent = 0;
                let destAddress = null;
                let relayChain = indexer.relayChain;
                //let a = extrinsic.params;
                let a = args;
                let assetAndAmountSents = [];

                // !!!! beneficiary processing + dest processing MUST happen before asset
                // beneficiary processing -- TODO: check that fromAddress is in beneficiary
                if (a.beneficiary !== undefined) {
                    let beneficiary = a.beneficiary
                    if (beneficiary.v0 !== undefined) {
                        let beneficiary_v0 = beneficiary.v0
                        //console.log("beneficiary v0=", JSON.stringify(a.beneficiary.v0));
                        if (beneficiary_v0.x1 != undefined) {
                            //0x0db891b6d6af60401a21f72761ed04a6024bf37b6cdeaab62d0bc3963c5c9357
                            [paraIDDest, chainIDDest, destAddress] = this.processX1(beneficiary_v0.x1, relayChain)
                        } else if (beneficiary_v0.x2 !== undefined) {
                            // I think this this can happen when xcmPallet to para?
                            [paraIDDest, chainIDDest, destAddress] = this.processX2(beneficiary_v0.x2, relayChain)
                        }

                    } else if (beneficiary.v1 !== undefined) {
                        //console.log(`beneficiary.v1 case`, JSON.stringify(beneficiary.v1, null, 2))
                        //console.log("beneficiary v1=", JSON.stringify(a.beneficiary.v1));
                        //0xfda47f26aa64e7824f6791162bfa87de83bfaa67c57f614299b5e1b687eb13b2
                        //0x3a47436114ee38a5d93cb3f248127464dd1be797cdf174f8759bfcbf6503952c
                        if (beneficiary.v1.interior !== undefined) {
                            let beneficiaryV1Interior = beneficiary.v1.interior;
                            // dest for relaychain
                            if (beneficiaryV1Interior.x1 !== undefined) {
                                [paraIDDest, chainIDDest, destAddress] = this.processX1(beneficiaryV1Interior.x1, relayChain)
                            } else if (beneficiaryV1Interior.x2 !== undefined) {
                                [paraIDDest, chainIDDest, destAddress] = this.processX2(beneficiaryV1Interior.x2, relayChain)
                            } else {
                                //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`beneficiary.v1.interior unknown case`, beneficiaryV1Interior)
                            }
                        } else {
                            //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`beneficiary.v1 unknown case`, beneficiary.v1)
                        }
                    } else if (beneficiary.v2 !== undefined) {
                        //console.log(`beneficiary.v1 case`, JSON.stringify(beneficiary.v1, null, 2))
                        //console.log("beneficiary v1=", JSON.stringify(a.beneficiary.v1));
                        //0xfda47f26aa64e7824f6791162bfa87de83bfaa67c57f614299b5e1b687eb13b2
                        //0x3a47436114ee38a5d93cb3f248127464dd1be797cdf174f8759bfcbf6503952c
                        if (beneficiary.v2.interior !== undefined) {
                            let beneficiaryV2Interior = beneficiary.v2.interior;
                            // dest for relaychain
                            if (beneficiaryV2Interior.x1 !== undefined) {
                                [paraIDDest, chainIDDest, destAddress] = this.processX1(beneficiaryV2Interior.x1, relayChain)
                            } else if (beneficiaryV2Interior.x2 !== undefined) {
                                [paraIDDest, chainIDDest, destAddress] = this.processX2(beneficiaryV2Interior.x2, relayChain)
                            } else {
                                if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`beneficiary.v2.interior unknown case`, beneficiaryV2Interior)
                            }
                        } else {
                            if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`beneficiary.v2 unknown case`, beneficiary.v2)
                        }
                    } else if (beneficiary.v3 !== undefined) {
                        //console.log(`beneficiary.v3 case`, JSON.stringify(beneficiary.v3, null, 2))
                        //console.log("beneficiary v3=", JSON.stringify(a.beneficiary.v3));
                        //0xfda47f26aa64e7824f6791162bfa87de83bfaa67c57f614299b5e1b687eb13b2
                        //0x3a47436114ee38a5d93cb3f248127464dd1be797cdf174f8759bfcbf6503952c
                        if (beneficiary.v3.interior !== undefined) {
                            let beneficiaryV3Interior = beneficiary.v3.interior;
                            // dest for relaychain
                            if (beneficiaryV3Interior.x1 !== undefined) {
                                [paraIDDest, chainIDDest, destAddress] = this.processX1(beneficiaryV3Interior.x1, relayChain)
                            } else if (beneficiaryV3Interior.x2 !== undefined) {
                                [paraIDDest, chainIDDest, destAddress] = this.processX2(beneficiaryV3Interior.x2, relayChain)
                            } else {
                                if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`beneficiary.v3.interior unknown case`, beneficiaryV3Interior)
                            }
                        } else {
                            if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`beneficiary.v3 unknown case`, beneficiary.v3)
                        }
                    } else if (beneficiary.x1 !== undefined) {
                        //0x2cfbeb75fe9a1e13a3a6cf700c27d1afd53c7f164c127e60763c2e27b959e195
                        [paraIDDest, chainIDDest, destAddress] = this.processX1(beneficiary.x1, relayChain)
                    } else if (beneficiary.x2 !== undefined) {
                        //0x0f51db2f3f23091aa1c0108358160c958db46f62e08fcdda13d0d864841821ad
                        [paraIDDest, chainIDDest, destAddress] = this.processX2(beneficiary.x2, relayChain)
                    } else {
                        //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`[${extrinsic.extrinsicHash}] section_method=${section_method} Unknown beneficiary`, beneficiary)
                    }
                }
                // dest processing
                let dest = a.dest;
                let destAddress2 = false; // not used
                if (dest.v0 !== undefined) {
                    //todo: extract
                    let dest_v0 = dest.v0
                    if (dest_v0.x1 !== undefined) {
                        [paraIDDest, chainIDDest] = this.processDestV0X1(dest_v0.x1, relayChain)
                    } else if (dest_v0.x2 !== undefined) {
                        /*
                        {"x2":[{"parent":null},{"parachain":2000}]}
                        */
                        [paraIDDest, chainIDDest] = this.processDestV0X2(dest_v0.x2, relayChain)

                    } else {
                        //if (this.debugLevel >= paraTool.debugErrorOnly) console.log("dest v0 unk = ", JSON.stringify(dest.v0));
                        chainIDDest = false
                    }
                } else if ((dest.v1 !== undefined) && (dest.v1.interior !== undefined)) {
                    // xcmPallet dest.v1.interior does not have id?
                    let destV1Interior = dest.v1.interior
                    if (destV1Interior.x1 !== undefined) {
                        // {"v1":{"parents":0,"interior":{"x1":{"parachain":2012}}}}
                        //[paraIDDest, chainIDDest, destAddress] = this.processX1(destV1Interior.x1, relayChain)
                        [paraIDDest, chainIDDest] = this.processDestV0X1(destV1Interior.x1, relayChain)
                    } else if (destV1Interior.x2 !== undefined) {
                        //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`potental error case destV1Interior.x2`, destV1Interior.x2)
                        // dest for parachain, add 20000 for kusama-relay
                        [paraIDDest, chainIDDest, _d] = this.processX2(destV1Interior.x2, relayChain)
                    } else {
                        //if (this.debugLevel >= paraTool.debugErrorOnly) console.log("dest v1 int unk = ", JSON.stringify(dest.v1.interior));
                        chainIDDest = false
                    }
                } else if ((dest.v2 !== undefined) && (dest.v2.interior !== undefined)) {
                    // xcmPallet dest.v1.interior does not have id?
                    let destV2Interior = dest.v2.interior
                    if (destV2Interior.x1 !== undefined) {
                        //[paraIDDest, chainIDDest, destAddress] = this.processX1(destV2Interior.x1, relayChain)
                        [paraIDDest, chainIDDest] = this.processDestV0X1(destV2Interior.x1, relayChain)
                    } else if (destV2Interior.x2 !== undefined) {
                        //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`potental error case destV2Interior.x2`, destV2Interior.x2)
                        // dest for parachain, add 20000 for kusama-relay
                        [paraIDDest, chainIDDest, _d] = this.processX2(destV2Interior.x2, relayChain)
                    } else {
                        //if (this.debugLevel >= paraTool.debugErrorOnly) console.log("dest v2 int unk = ", JSON.stringify(dest.v2.interior));
                        chainIDDest = false
                    }
                } else if ((dest.v3 !== undefined) && (dest.v3.interior !== undefined)) {
                    // xcmPallet dest.v1.interior does not have id?
                    let destV3Interior = dest.v3.interior
                    if (destV3Interior.x1 !== undefined) {
                        //[paraIDDest, chainIDDest, destAddress] = this.processX1(destV3Interior.x1, relayChain)
                        [paraIDDest, chainIDDest] = this.processDestV0X1(destV3Interior.x1, relayChain)
                    } else if (destV3Interior.x2 !== undefined) {
                        //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`potental error case destV3Interior.x2`, destV3Interior.x2)
                        // dest for parachain, add 20000 for kusama-relay
                        [paraIDDest, chainIDDest, _d] = this.processX2(destV3Interior.x2, relayChain)
                    } else {
                        //if (this.debugLevel >= paraTool.debugErrorOnly) console.log("dest v3 int unk = ", JSON.stringify(dest.v3.interior));
                        chainIDDest = false
                    }
                }

                // asset processing
                //console.log(`[${extrinsic.extrinsicHash}] section_method=${section_method}`, JSON.stringify(a, null, 2))
                if (a !== undefined && a.assets !== undefined) {
                    let assets = a.assets;
                    let feeAssetIndex = a.fee_asset_item
                    if (assets.v0 !== undefined && Array.isArray(assets.v0) && assets.v0.length > 0) {
                        //if (this.debugLevel >= paraTool.debugVerbose) console.log(`[${extrinsic.extrinsicHash}] section_method=${section_method} v0 case`, JSON.stringify(a, null, 2))
                        let assetsv0 = assets.v0
                        let transferIndex = 0
                        for (const asset of assetsv0) {
                            if (asset.concreteFungible !== undefined) {
                                // extract this
                                /*
                                {
                                  "concreteFungible": {
                                    "id": {
                                      "null": null
                                    },
                                    "amount": 6800000000000
                                  }
                                }
                                */
                                let fungibleAsset = asset.concreteFungible;
                                let [targetedSymbol, targetedRelayChain, amountSent] = this.processV0ConcreteFungible(indexer, fungibleAsset)
                                let targetedXcmInteriorKey = indexer.check_refintegrity_xcm_symbol(targetedSymbol, targetedRelayChain, chainID, chainIDDest, "processV0ConcreteFungible", `processOutgoingXcmPallet ${section_method}`, fungibleAsset)
                                let aa = {
                                    xcmInteriorKey: targetedXcmInteriorKey,
                                    xcmSymbol: targetedSymbol,
                                    amountSent: amountSent,
                                    transferIndex: transferIndex,
                                    isFeeItem: (transferIndex == feeAssetIndex) ? 1 : 0,
                                }
                                assetAndAmountSents.push(aa)
                            }
                            transferIndex++
                        }
                    } else if (assets.v1 !== undefined && Array.isArray(assets.v1) && assets.v1.length > 0) {
                        // todo: extract this
                        //if (this.debugLevel >= paraTool.debugVerbose) console.log(`[${extrinsic.extrinsicHash}] xcmPallet assets.v1 case`)
                        let assetsv1 = assets.v1
                        let transferIndex = 0
                        for (const asset of assetsv1) {
                            if (asset.fun !== undefined && asset.fun.fungible !== undefined) {
                                let [targetedSymbol, targetedRelayChain, targetedXcmInteriorKey0] = this.processV1ConcreteFungible(indexer, asset)
                                let targetedXcmInteriorKey = indexer.check_refintegrity_xcm_symbol(targetedSymbol, targetedRelayChain, chainID, chainIDDest, "processV1ConcreteFungible", `processOutgoingXcmPallet ${section_method}`, asset)
                                if (targetedXcmInteriorKey == false) targetedXcmInteriorKey = targetedXcmInteriorKey0
                                let aa = {
                                    xcmInteriorKey: targetedXcmInteriorKey,
                                    xcmSymbol: targetedSymbol,
                                    amountSent: paraTool.dechexToInt(asset.fun.fungible),
                                    transferIndex: transferIndex,
                                    isFeeItem: (transferIndex == feeAssetIndex) ? 1 : 0,
                                }
                                assetAndAmountSents.push(aa)
                            } else {
                                //if (this.debugLevel >= paraTool.debugErrorOnly) console.log("asset v1 unknown", asset);
                                asset = false;
                            }
                            transferIndex++
                        }
                    } else if (assets.v2 !== undefined && Array.isArray(assets.v2) && assets.v2.length > 0) {
                        // todo: extract this
                        if (this.debugLevel >= paraTool.debugVerbose) console.log(`[${extrinsic.extrinsicHash}] xcmPallet assets.v2 case`)
                        let assetsv2 = assets.v2
                        let transferIndex = 0
                        for (const asset of assetsv2) {
                            if (asset.fun !== undefined && asset.fun.fungible !== undefined) {
                                let [targetedSymbol, targetedRelayChain, targetedXcmInteriorKey0] = this.processV1ConcreteFungible(indexer, asset)
                                let targetedXcmInteriorKey = indexer.check_refintegrity_xcm_symbol(targetedSymbol, targetedRelayChain, chainID, chainIDDest, "processV1ConcreteFungible", `processOutgoingXcmPallet ${section_method}`, asset)
                                if (targetedXcmInteriorKey == false) targetedXcmInteriorKey = targetedXcmInteriorKey0
                                let aa = {
                                    xcmInteriorKey: targetedXcmInteriorKey,
                                    xcmSymbol: targetedSymbol,
                                    amountSent: paraTool.dechexToInt(asset.fun.fungible),
                                    transferIndex: transferIndex,
                                    isFeeItem: (transferIndex == feeAssetIndex) ? 1 : 0,
                                }
                                assetAndAmountSents.push(aa)
                            } else {
                                if (this.debugLevel >= paraTool.debugErrorOnly) console.log("asset v2 unknown", asset);
                                asset = false;
                            }
                            transferIndex++
                        }
                    } else if (assets.v3 !== undefined && Array.isArray(assets.v3) && assets.v3.length > 0) {
                        // todo: extract this
                        if (this.debugLevel >= paraTool.debugVerbose) console.log(`[${extrinsic.extrinsicHash}] xcmPallet assets.v3 case`)
                        let assetsv3 = assets.v3
                        let transferIndex = 0
                        for (const asset of assetsv3) {
                            if (asset.fun !== undefined && asset.fun.fungible !== undefined) {
                                let [targetedSymbol, targetedRelayChain, targetedXcmInteriorKey0] = this.processV1ConcreteFungible(indexer, asset)
                                let targetedXcmInteriorKey = indexer.check_refintegrity_xcm_symbol(targetedSymbol, targetedRelayChain, chainID, chainIDDest, "processV1ConcreteFungible", `processOutgoingXcmPallet ${section_method}`, asset)
                                if (targetedXcmInteriorKey == false) targetedXcmInteriorKey = targetedXcmInteriorKey0
                                let aa = {
                                    xcmInteriorKey: targetedXcmInteriorKey,
                                    xcmSymbol: targetedSymbol,
                                    amountSent: paraTool.dechexToInt(asset.fun.fungible),
                                    transferIndex: transferIndex,
                                    isFeeItem: (transferIndex == feeAssetIndex) ? 1 : 0,
                                }
                                assetAndAmountSents.push(aa)
                            } else {
                                if (this.debugLevel >= paraTool.debugErrorOnly) console.log("asset v3 unknown", asset);
                                asset = false;
                            }
                            transferIndex++
                        }
                    }

                    for (const assetAndAmountSent of assetAndAmountSents) {
                        let targetedSymbol = assetAndAmountSent.xcmSymbol
                        let targetedXcmInteriorKey = assetAndAmountSent.xcmInteriorKey
                        let amountSent = assetAndAmountSent.amountSent
                        let transferIndex = assetAndAmountSent.transferIndex
                        let isFeeItem = assetAndAmountSent.isFeeItem
                        if (assetAndAmountSent != undefined && paraTool.validAmount(amountSent) && (chainIDDest || chainIDDest == paraTool.chainIDPolkadot)) {
                            let incomplete = this.extract_xcm_incomplete(extrinsic.events, extrinsic.extrinsicID);
                            if (extrinsic.xcms == undefined) extrinsic.xcms = []
                            let msgHash = '0x'
                            let xcmIndex = extrinsic.xcmIndex
                            if (xcmMsgHashCandidates.length > 0) {
                                if ((xcmMsgHashCandidates.length - 1 >= xcmIndex) && xcmMsgHashCandidates[xcmIndex] != undefined) {
                                    msgHash = xcmMsgHashCandidates[xcmIndex]
                                    if (this.debugLevel >= paraTool.debugInfo) console.log(`Found xcmV3 ${feed.extrinsicHash} via event: ${msgHash}`)
                                }
                            }
                            let r = {
                                sectionMethod: section_method,
                                extrinsicHash: feed.extrinsicHash,
                                extrinsicID: feed.extrinsicID,
                                transferIndex: transferIndex,
                                xcmIndex: xcmIndex,
                                relayChain: indexer.relayChain,
                                chainID: chainID,
                                chainIDDest: chainIDDest,
                                paraID: paraID,
                                paraIDDest: paraIDDest,
                                blockNumber: this.parserBlockNumber,
                                fromAddress: fromAddress,
                                destAddress: destAddress,
                                sourceTS: feed.ts,
                                amountSent: amountSent,
                                incomplete: incomplete,
                                isFeeItem: isFeeItem,
                                msgHash: msgHash,
                                sentAt: this.parserWatermark,
                                xcmSymbol: targetedSymbol,
                                xcmInteriorKey: targetedXcmInteriorKey,
                                xcmType: "xcmtransfer",
                            }
                            //if (this.debugLevel >= paraTool.debugVerbose) console.log("processOutgoingXcmPallet xcmPallet", r);
                            extrinsic.xcms.push(r)
                            outgoingXcmPallet.push(r)
                            //outgoingXcmList.push(r)
                        } else {
                            if (this.debugLevel >= paraTool.debugErrorOnly) console.log("chainparser-processXCMTransfer unknown", `module:${section_method}`, a);
                            // TODO: tally error
                        }
                    }
                }
            }
        } catch (e) {
            //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`processOutgoingXcmPallet error`, e)
            return outgoingXcmPallet
        }
        return outgoingXcmPallet
    }

    processExtrinsicEvents(indexer, module_section, module_method, events) {
        // nothing to do here right now
        return (false);
    }

    rewardFilter(palletMethod) {
        //let palletMethod = `${rewardEvent.section}(${rewardEvent.method})`
        if (palletMethod == "staking(Rewarded)" || palletMethod == "staking(Slashed)") {
            return true
        } else if (palletMethod == "staking(PayoutStarted)") {
            //this is not really a pay out event. but has the "era"
            return true
        } else {
            return false;
        }
    }

    xTokensFilter(palletMethod) {
        //let palletMethod = `${rewardEvent.section}(${rewardEvent.method})`
        if (palletMethod == "xTokens(TransferredMultiAssets)") {
            return true
        } else {
            return false;
        }
    }


    paraInclusionCandidateIncludedFilter(palletMethod) {
        //let palletMethod = `${rewardEvent.section}(${rewardEvent.method})`
        if (palletMethod == "paraInclusion(CandidateIncluded)") {
            return true
        } else {
            return false;
        }
    }

    paraInclusionCandidateBackedFilter(palletMethod) {
        //let palletMethod = `${rewardEvent.section}(${rewardEvent.method})`
        if (palletMethod == "paraInclusion(CandidateBacked)") {
            return true
        } else {
            return false;
        }
    }

    xcmAssetTrapFilter(palletMethod) {
        //let palletMethod = `${rewardEvent.section}(${rewardEvent.method})`
        if (palletMethod == "xcmPallet(AssetsTrapped)") {
            return true
        } else {
            return false;
        }
    }

    xcmStartFilter(palletMethod) {
        if (palletMethod == "parachainSystem(DownwardMessagesReceived)") {
            return true
        } else if (palletMethod == "ump(UpwardMessagesReceived)") {
            return true
        } else {
            return false;
        }
    }

    xcmMsgFilter(palletMethod) {
        //let palletMethod = `${rewardEvent.section}(${rewardEvent.method})`
        if (palletMethod == "xcmpQueue(XcmpMessageSent)" || palletMethod == "parachainSystem(UpwardMessageSent)") {
            return true
        } else {
            return false;
        }
    }

    crowdloanFilter(palletMethod) {
        //let palletMethod = `${rewardEvent.section}(${rewardEvent.method})`
        if (palletMethod == "crowdloan(Contributed)" || palletMethod == "crowdloan(MemoUpdated)") {
            return true
        } else {
            return false;
        }
    }


    reapingFilter(palletMethod) {
        //let palletMethod = `${rewardEvent.section}(${rewardEvent.method})`
        if (palletMethod == "balances(DustLost)" || palletMethod == "system(KilledAccount)") {
            return true
        } else {
            return false;
        }
    }

    proxyFilter(palletMethod) {
        //let palletMethod = `${rewardEvent.section}(${rewardEvent.method})`
        if (palletMethod == "proxy(ProxyAdded)" || palletMethod == "proxy(ProxyRemoved)" || palletMethod == "proxy(AnonymousCreated)") {
            return true;
        } else {
            return false;
        }
    }

    prepareFeedProxy(indexer, section, method, data, eventID) {
        let chainID = indexer.chainID
        let palletMethod = `${section}(${method})`
        //let data = rewardEvent.data
        /*
        [
            "EPg8EgdKi8aT5n8P9CM2kdDdaWJzaUiR9jdYfKxqwP7cYvg", //address  (delegator)
            "HnqWUoGaDH8NFFEoVBfbFwSjtXn4fVSXR8WJBfUnF6cr18G", //delegate (delegatee)
            "Any",                                             //proxyType
            0                                                  //delay
        ]
        */
        let proxyRec = {
            chainID: chainID,
            address: paraTool.getPubKey(data[0]),
            delegate: paraTool.getPubKey(data[1]),
            proxyType: data[2],
            delay: paraTool.dechexToInt(data[3]),
            status: 'NA',
            blockNumber: this.parserBlockNumber,
        }
        switch (palletMethod) {
            case "proxy(ProxyAdded)":
                proxyRec.status = 'added'
                break;
            case "proxy(AnonymousCreated)":
                proxyRec.status = 'anonymousCreated'
                break;
            case "proxy(ProxyRemoved)":
                proxyRec.status = 'removed'
                break;
            default:
                return false
        }
        return proxyRec
    }

    getExtrinsicsRemark(indexer, extrinsics) {
        //parse the remark.. (hard)
    }

    prepareFeedcrowdloan(indexer, section, method, data, eventID) {
        let chainID = indexer.chainID
        let palletMethod = `${section}(${method})`
        //let data = rewardEvent.data
        switch (palletMethod) {
            case "crowdloan(Contributed)":
                //todo: parse reward record here
                /*
                "data": [
                  "ADDR",
                  "2004",
                  "500000000000"
                ]
                */
                var accountID = data[0]
                var paraID = paraTool.dechexToInt(data[1])
                var bal = paraTool.dechexToInt(data[2]) / (10 ** indexer.getChainDecimal(chainID))
                let contributionRecord = {
                    eventID: eventID,
                    section: section,
                    method: method,
                    account: accountID,
                    paraID: paraID,
                    value: bal
                }
                return contributionRecord
            case "crowdloan(MemoUpdated)":
                //todo: parse reward record here
                /*
                "data": [
                  "16DWzViTodXg48SJzRRcqTQbSvFBxJEQ9Y2F4pNsrXueH4Nz",
                  "2004",
                  "0xb554b9856dfdbf52b98e0e4d2b981c34e20e1dab"
                ]
                */
                var accountID = data[0]
                var paraID = paraTool.dechexToInt(data[1])
                var memo = data[2]
                let memoRecord = {
                    eventID: eventID,
                    section: section,
                    method: method,
                    account: accountID,
                    paraID: paraID,
                    memo: memo
                }
                return memoRecord
            default:
                return false

        }
    }

    prepareFeedReward(indexer, section, method, data, eventID) {
        let palletMethod = `${section}(${method})`
        //let data = rewardEvent.data
        switch (palletMethod) {
            case "staking(Rewarded)":
            case "staking(Slashed)":
                let accountID = data[0]
                let bal = paraTool.dechexToInt(data[1]);
                if (palletMethod == "staking(Slashed)") bal = -bal
                let rewardRec = {
                    eventID: eventID,
                    section: section,
                    method: method,
                    account: accountID,
                    value: bal
                }
                return rewardRec
            case "staking(PayoutStarted)":
                let payoutEra = paraTool.dechexToInt(data[0])
                let validatorStash = data[1]
                let rewardStartRec = {
                    eventID: eventID,
                    section: section,
                    method: method,
                    validatorStash: validatorStash,
                    era: payoutEra
                }
                return rewardStartRec
            default:
                return false
        }
    }

    decorateAutoTraceHrmp(indexer, o = false, useApiAt = true) {
        let msgHashes = []
        let xcmMessages = []
        let decoratedVal = o.pv
        try {
            let hrmpOutboundMsgs = JSON.parse(decoratedVal)
            for (const hrmp of hrmpOutboundMsgs) {
                if (hrmp.data != undefined) {
                    let data = '0x' + hrmp.data.slice(4)
                    var xcmFragments = this.decodeXcmVersionedXcms(indexer, data, `decorateAutoTraceHrmp-${o.traceID}`)
                    if (xcmFragments) {
                        for (const xcm of xcmFragments) {
                            let hrmpMsg = xcm.msg
                            let msgHash = xcm.msgHash
                            xcmMessages.push(JSON.stringify(hrmpMsg))
                            msgHashes.push(msgHash)
                        }
                    }
                }
            }
        } catch (err) {
            //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`[${o.traceID}] decorateAutoTraceHrmp decode failed`, err.toString())
        }
        o.msgHashes = msgHashes
        o.xcmMessages = xcmMessages
    }

    decorateAutoTraceUmp(indexer, o = false) {
        //NOTE: duplicate ump is NOT removed here
        let msgHashes = []
        let xcmMessages = []
        let decoratedVal = o.pv
        try {
            let v = decoratedVal.replace('[', '').replace(']', '').replaceAll(' ', '').split(',')
            for (const ump of v) {
                let data = ump.replace(' ', '')
                /*
                let msgHash = '0x' + paraTool.blake2_256_from_hex(data) //same as xcmpqueue (Success) ?
                var [instructions, remainingFound] = this.decodeXcmVersionedXcm(indexer, data, `decorateAutoTraceUmp-${o.traceID}`)
                var umpMsg = instructions.toJSON()
                xcmMessages.push(JSON.stringify(umpMsg))
                msgHashes.push(msgHash)
                */
                var xcmFragments = this.decodeXcmVersionedXcms(indexer, data, `decorateAutoTraceUmp-${o.traceID}`)
                if (xcmFragments) {
                    for (const xcm of xcmFragments) {
                        let umpMsg = xcm.msg
                        let msgHash = xcm.msgHash
                        xcmMessages.push(JSON.stringify(umpMsg))
                        msgHashes.push(msgHash)
                    }
                }
            }
        } catch (err) {
            //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`[${o.traceID}] decorateAutoTraceUmp decode failed`, err.toString())
        }
        o.msgHashes = msgHashes
        o.xcmMessages = xcmMessages
    }

    decorateAutoTraceDmp(indexer, o = false, useApiAt = true) {
        //NOTE: duplicate dmp is NOT removed here
        let msgHashes = []
        let xcmMessages = []
        let decoratedVal = o.pv
        try {
            let v = JSON.parse(decoratedVal)
            for (const dmp of v) {
                let data = (dmp.msg != undefined) ? dmp.msg : dmp.pubMsg
                let sentAt = (dmp.sentAt != undefined) ? paraTool.dechexToInt(dmp.sentAt) : paraTool.dechexToInt(dmp.pubSentAt)
                var xcmFragments = this.decodeXcmVersionedXcms(indexer, data, `decorateAutoTraceDmp-${o.traceID}`)
                if (xcmFragments) {
                    for (const xcm of xcmFragments) {
                        let dmpMsg = xcm.msg
                        let msgHash = xcm.msgHash
                        xcmMessages.push(JSON.stringify(dmpMsg))
                        msgHashes.push(msgHash)
                    }
                }
            }
        } catch (err) {
            //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`[${o.traceID}] decorateAutoTraceDmp decode failed`, err.toString())
        }
        o.msgHashes = msgHashes
        o.xcmMessages = xcmMessages
    }

    decorateAutoTraceValidationData(indexer, o = false) {
        //NOTE: duplicate dmp is NOT removed here
        let decoratedVal = o.pv
        //console.log(`decorateAutoTraceValidationData`, o)
        try {
            let v = JSON.parse(decoratedVal)
            //if (this.debugLevel >= paraTool.debugTracing) console.log(`decorateAutoTraceValidationData`, v) //TODO: we can find  the parent's state root here at relayParentStorageRoot
            let hrmpWatermark = paraTool.dechexToInt(v.relayParentNumber)
            this.parserWatermark = hrmpWatermark
            //if (this.debugLevel >= paraTool.debugVerbose) console.log(`[${this.parserBlockNumber}] Update hrmpWatermark: ${hrmpWatermark}`)
        } catch (err) {
            //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`[${o.traceID}] decorateAutoTraceValidationData error`, err.toString())
        }
    }

    //ParachainSystem:HrmpOutboundMessages, Dmp:DownwardMessageQueues, ParachainSystem:UpwardMessages
    decorateAutoTraceXCM(indexer, o = false) {
        //TODO: pentially update parserWatermark here
        if (!o) return
        let pallet_section = `${o.p}:${o.s}`
        let pv = o.pv
        if (pallet_section == 'ParachainSystem:HrmpOutboundMessages' || pallet_section == 'Dmp:DownwardMessageQueues' || pallet_section == 'ParachainSystem:UpwardMessages' || pallet_section == 'ParachainSystem:ValidationData') {
            if (pv != '[]' && pv != undefined) {
                //console.log(`decorateAutoTraceXCM found`, `${pallet_section}`, o)
                //do something
                switch (pallet_section) {
                    case 'ParachainSystem:HrmpOutboundMessages':
                        this.decorateAutoTraceHrmp(indexer, o);
                        break;
                    case 'ParachainSystem:UpwardMessages':
                        this.decorateAutoTraceUmp(indexer, o);
                        break;
                    case 'Dmp:DownwardMessageQueues':
                        this.decorateAutoTraceDmp(indexer, o);
                        break;
                    case 'ParachainSystem:ValidationData':
                        if (o.v != undefined && o.v != '0x00') this.decorateAutoTraceValidationData(indexer, o);
                        break;
                    default:
                        break;
                }
                if (this.debugLevel >= paraTool.debugVerbose) console.log(`decorateAutoTraceXCM Processed`, `${pallet_section}`, o)
                return
            }
        }
        //console.log(`decorateAutoTraceXCM skip`, `${pallet_section}`, o)
        return
    }

    parseStorageVal(indexer, p, s, val, decoratedVal, o = false) {
        let chainID = indexer.chainID
        let pallet_section = `${p}:${s}`
        //console.log(`generic parseStorageVal ${pallet_section}`)
        // parsing that works on every chain
        if (pallet_section == "system:account") {
            return this.getSystemAccountVal(indexer, decoratedVal)
        } else if (pallet_section == "assets:account") {
            return this.getAssetsAccountVal(indexer, decoratedVal)
        } else if (pallet_section == "tokens:accounts") {
            return this.getTokensAccountsVal(indexer, decoratedVal, val, p, s)
        } else if (pallet_section == "balances:totalIssuance") {
            return this.getBalancesTotalIssuanceVal(indexer, decoratedVal)
        } else if (pallet_section == "identity:identityOf" && chainID == paraTool.chainIDPolkadot) {
            return this.getIdentityVal(indexer, decoratedVal);
        } else if (pallet_section == "dmp:downwardMessageQueues") {
            //TODO
            return this.getDownwardMessageQueuesVal(indexer, decoratedVal, 'dmp', o);
        } else if (pallet_section == "parachainSystem:hrmpOutboundMessages") {
            //TODO
            return this.getHrmpOutboundMessagesVal(indexer, decoratedVal, 'hrmp');
        } else if (pallet_section == "parachainSystem:upwardMessages") {
            //TODO
            return this.getUpwardMessageseVal(indexer, decoratedVal, 'ump');
        } else if (pallet_section == "parachainSystem:hrmpWatermark") {
            //return this.getHrmpWatermarkVal(indexer, decoratedVal); // moved this to decorateAutoTraceValidationData
        }
        return (false);
    }

    parseStorageKey(indexer, p, s, key, decoratedKey) {
        // include accountID, asset
        let chainID = indexer.chainID
        let pallet_section = `${p}:${s}`
        //console.log(`generic parseStorageKey ${pallet_section}`)
        if (pallet_section == "system:account") {
            return this.getSystemAccountKey(indexer, decoratedKey);
        } else if (pallet_section == "assets:account") {
            return this.getAssetsAccountKey(indexer, decoratedKey);
        } else if (pallet_section == "tokens:accounts") {
            return this.getTokensAccountsKey(indexer, decoratedKey);
        } else if (pallet_section == "identity:identityOf" && chainID == paraTool.chainIDPolkadot) {
            return this.getIdentityKey(indexer, decoratedKey);
        } else if (pallet_section == "dmp:downwardMessageQueues") {
            //TODO
            return this.getDownwardMessageQueuesKey(indexer, decoratedKey, 'dmp');
        } else if (pallet_section == "parachainSystem:hrmpOutboundMessages") {
            //TODO
            return this.getHrmpUmpKey(indexer, decoratedKey, 'hrmp');
        } else if (pallet_section == "parachainSystem:upwardMessages") {
            //TODO
            return this.getHrmpUmpKey(indexer, decoratedKey, 'ump');
        }
        return (false);
    }

    getBalancesTotalIssuanceVal(indexer, decoratedVal) {
        let chainID = indexer.chainID
        let v = JSON.parse(decoratedVal)
        let decodeStatus = true
        //let v = ledec(val)
        let res = {}
        let extraField = []
        if (decodeStatus) {
            v = decoratedVal
        }
        extraField['totalIssuance'] = paraTool.dechexToIntStr(v)
        let asset = indexer.getNativeAsset(chainID)
        extraField['asset'] = asset
        res["pv"] = v //keep the high precision val in pv for now
        res["extra"] = extraField
        return res
    }

    // decoratedKey: ["100"]
    getAssetsAssetKey(indexer, decoratedKey) {
        let k = JSON.parse(decoratedKey)
        var out = {};
        let assetID = this.cleanedAssetID(k[0]); //currencyID
        this.setAssetSymbolAndDecimals(indexer, assetID, out)
        out.assetID = assetID
        return out
    }

    async processAccountIdentity(indexer, p, s, e2, rAssetkey, fromAddress) {
        //if (this.debugLevel >= paraTool.debugVerbose) console.log(`processAccountIdentity  ${fromAddress}`, e2);
        try {
            // stub
        } catch (err) {
            if (this.debugLevel >= paraTool.debugErrorOnly) console.log("processAccountIdentity ERR", e2, rAssetkey, fromAddress, err);
            this.parserErrors++;
        }
    }

    async processSystemAccount(indexer, e2, rAssetkey, fromAddress) {
        //console.log(`processSystemAccount ${fromAddress} e2`, e2);
        /* sample e2
        {
          bn: 4233221,
          blockHash: '0x57f892cfa1063bb92deabe0a4a68accae7a8460cd4e02aca04d65a06da03f8b5',
          p: 'System',
          s: 'Account',
          accountID: 'F3opxRUwkBj1LqjZ7DyiHCRh9Z4zVPLaVjoxfD5ddbip8mt',
          asset: '{"Token":"KSM"}',
          free: '99455724',
          reserved: '0',
          miscFrozen: '0',
          feeFrozen: '0',
          frozen: '0',
          k: '26aa394eea5630e07c48ae0c9558cef7b99d880ec681799c0cf30e8886371da95a3fb8de4321e12fad081eaeece61bc56d6f646c506f745374616b650000000000000000000000000000000000000000',
          v: '0100000000000000000100000000000000ec92ed05000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
          pv: '{"nonce":0,"consumers":0,"providers":1,"sufficients":0}',
          pv2: undefined
        }
        */
        let chainID = indexer.chainID
        let chainDecimal = indexer.getChainDecimal(chainID)
        let aa = {
            symbol: indexer.getChainSymbol(chainID),
            decimal: chainDecimal
        }
        let flds = ["free", "miscFrozen", "feeFrozen", "reserved", "frozen"];
        flds.forEach((fld) => {
            if (e2[fld] != undefined) {
                let fld2 = fld;
                if (fld == "miscFrozen") {
                    fld2 = "misc_frozen";
                }
                if (fld == "feeFrozen") {
                    fld2 = "frozen";
                }
                let raw = paraTool.dechexToIntStr(e2[fld].toString())
                aa[`${fld2}_raw`] = raw;
                aa[fld2] = raw / 10 ** chainDecimal;
                // TODO: move _usd valuation here
            }
        });
        let assetChain = paraTool.makeAssetChain(rAssetkey, chainID);
        //if (this.debugLevel >= paraTool.debugVerbose) console.log(`processSystemAccount addr=${fromAddress} assetChain=${assetChain}\nGenerated:`, aa)
        /* Sample system:account record
        {
          symbol: 'KSM',
          decimal: 12,
          free_raw: '99455724',
          free: 0.000099455724,
          misc_frozen_raw: '0',
          misc_frozen: 0,
          frozen_raw: '0',
          frozen: 0,
          reserved_raw: '0',
          reserved: 0
        }
        */
        indexer.updateAddressStorage(fromAddress, assetChain, "processSystemAccount", aa, this.parserTS, this.parserBlockNumber, paraTool.assetTypeToken);
    }



    async processAssetsAccount(indexer, p, s, e2, rAssetkey, fromAddress) {
        //console.log(`processAssetsAccount ${fromAddress} e2`, e2);
        /*
        {
          bn: 4233221,
          blockHash: '0x57f892cfa1063bb92deabe0a4a68accae7a8460cd4e02aca04d65a06da03f8b5',
          p: 'Assets',
          s: 'Account',
          decoratedAsset: { Token: 'USDT' },
          decimals: 6,
          symbol: 'USDT',
          accountID: 'FBeL7DaPE7W3CiFKJaYpMiDP8MRsChS7GVCooruT644zXSx',
          asset: '"1984"',
          free: '38743432633',
          k: '682a59d51ab9e48a8c8cc418ff9708d2b99d880ec681799c0cf30e8886371da9a319d0e87221ca1ee751c1529f201522c00700003e9617916bf7214f55e782c9abd186737369626c25080000000000000000000000000000000000000000000000000000',
          v: '01b9dd49050900000000000000000000000001',
          pv: '{"balance":38743432633,"isFrozen":false,"reason":{"sufficient":null},"extra":null}',
          pv2: undefined
        }
        */
        let chainID = indexer.chainID
        try {
            let success = false;
            let rAssetkey = this.elevatedAssetKey(paraTool.assetTypeToken, e2.asset);
            //let decimals = await this.getAssetDecimal(indexer, rAssetkey);
            let decimals = e2.decimals
            let symbol = (e2.symbol != undefined) ? e2.symbol : null //try to get symbol here; not it's not guarantee to work
            if (decimals !== false) {
                //console.log("processAssetsAccount FOUND decimals", rAssetkey, decimals);
                if (e2.pv !== undefined) {
                    //let v = JSON.parse(e2.pv);
                    let aa = {
                        symbol: symbol,
                        decimal: decimals
                    }
                    let flds = ["free"]; //free only
                    flds.forEach((fld) => {
                        if (e2[fld] != undefined) {
                            let fld2 = fld;
                            let raw = paraTool.dechexToIntStr(e2[fld].toString())
                            aa[`${fld2}_raw`] = raw;
                            aa[fld2] = raw / 10 ** decimals;
                            // TODO: move _usd valuation here
                        }
                    });
                    let assetType = paraTool.assetTypeToken;
                    let assetChain = paraTool.makeAssetChain(rAssetkey, chainID)
                    //if (this.debugLevel >= paraTool.debugVerbose) console.log(`processAssetsAccount addr=${fromAddress} assetChain=${assetChain}\nGenerated:`, aa);
                    /* Sample assets:accounts record
                    {
                      symbol: 'USDT',
                      decimal: 6,
                      free_raw: '38743432633',
                      free: 38743.432633
                    }
                    */
                    //console.log(`${rAssetkey} ++++ processAssetsAccount Generated`, aa)
                    indexer.updateAddressStorage(fromAddress, assetChain, "processAssetsAccount", aa, this.parserTS, this.parserBlockNumber, paraTool.assetTypeToken);
                } else {
                    if (this.debugLevel >= paraTool.debugErrorOnly) console.log("processAssetsAccount MISSING pv", e2);
                }
            } else {
                if (this.debugLevel >= paraTool.debugErrorOnly) console.log("processAssetsAccount MISSING decimals", rAssetkey);
            }
        } catch (err) {
            if (this.debugLevel >= paraTool.debugErrorOnly) console.log("processAssetsAccount ERR", e2, rAssetkey, fromAddress, err);
            this.parserErrors++;
        }
    }

    async processTokensAccounts(indexer, e2, rAssetkey, fromAddress) {
        //console.log(`++++ processTokensAccounts ${fromAddress} e2`, e2);
        /*
        {
          bn: 3258814,
          blockHash: '0x12a95d68dbd8759b836492e57508b59cb74a0127d189f6aac541a7fb29cec360',
          p: 'Tokens',
          s: 'Accounts',
          accountID: '21eNMFk9XBUDeANA3RA2jRVA8zgmwbtu7M7dbDKPuJXVtmLV',
          asset: '{"ForeignAsset":"0"}',
          free: '600500000000000000',
          reserved: '0',
          frozen: '0',
          k: '99971b5749ac43e0235e41b0d37869188ee7418a6531173d60d1f6a82d8f4d51523cbc31d1691d98e4ff3d22cfca04bc22257cf3002d7c3b5ad89af72b7c80aacdb12e1d490871664e81541d674a7e1be864249bdfc20767050000',
          v: '0100409f839167550800000000000000000000000000000000000000000000000000000000000000000000000000000000',
          pv2: undefined
        }
        */
        let chainID = indexer.chainID
        //chains that use token pallet by index
        let tokenCurrencyIDList = [paraTool.chainIDMangataX,
            paraTool.chainIDHydraDX, paraTool.chainIDBasilisk,
            paraTool.chainIDComposable, paraTool.chainIDPicasso,
            paraTool.chainIDTuring, paraTool.chainIDOak,
            paraTool.chainIDDoraFactory,
            paraTool.chainIDOrigintrail,
        ]
        let asset = false
        if (tokenCurrencyIDList.includes(chainID)) {
            let currencyID = paraTool.toNumWithoutComma(JSON.parse(rAssetkey));
            rAssetkey = JSON.stringify({
                Token: currencyID
            })
            asset = rAssetkey
        } {
            let [targetAsset, _] = paraTool.parseAssetChain(rAssetkey)
            asset = targetAsset
        }
        let decimals = await indexer.getAssetDecimal(asset, chainID, "processTokensAccounts");
        let targetSymbol = await indexer.getAssetSymbol(asset, chainID, "processTokensAccounts");
        let symbol = (targetSymbol) ? targetSymbol : null
        let aa = {
            symbol: symbol,
            decimal: decimals
        }
        // for ALL the evaluatable attributes in e2, copy them in
        if (decimals) {
            let flds = ["free", "reserved", "miscFrozen", "feeFrozen", "frozen"];
            flds.forEach((fld) => {
                if (e2[fld] != undefined) {
                    let fld2 = fld;
                    if (fld == "miscFrozen") {
                        fld2 = "misc_frozen";
                    }
                    if (fld == "feeFrozen") {
                        fld2 = "frozen";
                    }
                    let raw = paraTool.dechexToIntStr(e2[fld].toString())
                    aa[`${fld2}_raw`] = raw;
                    aa[fld2] = raw / 10 ** decimals;
                    // TODO: move _usd valuation here
                }
            });
            let parsedAsset = JSON.parse(asset);
            let assetType = (Array.isArray(parsedAsset)) ? paraTool.assetTypeLiquidityPair : paraTool.assetTypeToken;
            let assetChain = paraTool.makeAssetChain(rAssetkey, indexer.chainID);
            //if (this.debugLevel >= paraTool.debugVerbose) console.log(`processTokensAccounts assetChain=${assetChain}, addr=${fromAddress}\nGenerated:`, assetChain, aa);
            /*  Sample assets:accounts record {"ForeignAsset":"0"}
            {
              symbol: 'GLMR',
              decimal: 18,
              free_raw: '600500000000000000',
              free: 0.6005,
              reserved_raw: '0',
              reserved: 0,
              frozen_raw: '0',
              frozen: 0
            }
            */
            indexer.updateAddressStorage(fromAddress, assetChain, "processTokensAccounts", aa, this.parserTS, this.parserBlockNumber, assetType);
        } else {
            indexer.logger.debug({
                "op": "processTokensAccounts",
                "msg": "getAssetDecimal",
                "asset": asset
            });
        }
    }

    processxcmMsgRaw(indexer, msg) {
        let xcmRec = false;
        try {
            xcmRec = {
                chainID: msg.chainID,
                chainIDDest: msg.chainIDDest,
                isIncoming: 0, //vs outgoing
                msgHash: msg.msgHash,
                msgType: msg.mpType,
                msgHex: msg.msgHex,
                msgStr: msg.msgStr,
                blockTS: this.parserTS,
                blockNumber: this.parserBlockNumber,
                relayChain: indexer.relayChain,
                sentAt: (msg.sentAt) ? msg.sentAt : 0, //TODO: only dmp has known sentAt. need to parse hrmpWatermark somehow
                version: msg.version,
                path: msg.path,
                beneficiaries: (msg.beneficiaries != undefined && msg.beneficiaries != '') ? msg.beneficiaries : null
            }
            if (xcmRec.msgType == 'dmp' && xcmRec.blockNumber != xcmRec.sentAt) {
                //if (this.debugLevel >= paraTool.debugInfo) console.log(`duplicates ${msg.msgHash}`)
                return false
            }
        } catch (e) {
            //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`processxcmMsgRaw error`, e.toString())
            return false
        }
        //if (this.debugLevel >= paraTool.debugTracing) console.log(`processxcmMsgRaw xcmRec`, xcmRec)
        return xcmRec
    }

    //mk: review this
    async processMPTrace(indexer, p, s, e2, mpType = false, finalized = false) {
        let sectionMethod = `${p}:${s}`
        //if (this.debugLevel >= paraTool.debugTracing) console.log(`processMPTrace ${sectionMethod}`, e2);
        try {
            let msgs = JSON.parse(e2.pv2)
            for (const msg of msgs) {
                let xcmRec = this.processxcmMsgRaw(indexer, msg)
                if (xcmRec) {
                    indexer.updateXCMMsg(xcmRec, finalized)
                }
            }
        } catch (e) {
            //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`processMPTrace err`, e.toString());
        }
        /*
         */
        //TODO: stub here
    }

    async processAssetsAsset(indexer, p, s, e2) {
        //console.log(`processAssetsAsset ${p}:${s}`, e2)
        /*
        processAssetsAsset Assets Asset {
          bn: 440631,
          ts: undefined,
          p: 'Assets',
          s: 'Asset',
          asset: '"200,070,014"',
          k: '682a59d51ab9e48a8c8cc418ff9708d2d34371a193a751eea5883e9553457b2e1db0ff2973712395c44f807f8cb67df07ed3ec0b',
          v: 'f902e41129af43f361e60002b5db848673111c11563ee8fa2a2082fb936d73b8605ae41129af43f361e60002b5db848673111c11563ee8fa2a2082fb936d73b8605ae41129af43f361e60002b5db848673111c11563ee8fa2a2082fb936d73b8605ae41129af43f361e60002b5db848673111c11563ee8fa2a2082fb936d73b8605aa4b8b72d27956d00000000000000000000000000000000000000000000000000010000000000000000000000000000000117150000171500000000000000',
          pv: '{"owner":"p8G6bRNFdE9xNQnoK7BkPTrbzb3DDVsi2k7fvY8pYCvwUPPUS","issuer":"p8G6bRNFdE9xNQnoK7BkPTrbzb3DDVsi2k7fvY8pYCvwUPPUS","admin":"p8G6bRNFdE9xNQnoK7BkPTrbzb3DDVsi2k7fvY8pYCvwUPPUS","freezer":"p8G6bRNFdE9xNQnoK7BkPTrbzb3DDVsi2k7fvY8pYCvwUPPUS","supply":"0x0000000000000000006d95272db7b8a4","deposit":0,"minBalance":1,"isSufficient":true,"accounts":5399,"sufficients":5399,"approvals":0,"isFrozen":false}',
          debug: 2
        }
        */
        if (e2.pv == undefined)
            return (false);
        let v = JSON.parse(e2.pv);
        let asset = e2.asset;
        let rAssetkey = this.elevatedAssetKey(paraTool.assetTypeToken, asset);
        //console.log(`processAssetsAsset rAssetkey=${rAssetkey}`, v)
        indexer.updateAssetMetadata(rAssetkey, v, paraTool.assetTypeToken, paraTool.assetSourceOnChain); // add currencyID
    }

    async processAccountAsset(indexer, p, s, e2, rAssetkey, fromAddress) {
        let chainID = indexer.chainID
        let pallet_section = `${p}:${s}`
        //console.log(`generic processAccountAsset ${pallet_section}`)
        if (pallet_section == "System:Account") {
            await this.processSystemAccount(indexer, e2, rAssetkey, fromAddress);
        } else if (pallet_section == "Tokens:Accounts") {
            // TODO: check how acala and others handle this
            await this.processTokensAccounts(indexer, e2, rAssetkey, fromAddress);
        } else if (pallet_section == "Assets:Account") { // TODO: check covers
            await this.processAssetsAccount(indexer, p, s, e2, rAssetkey, fromAddress);
        } else if (pallet_section == "Identity:IdentityOf" && chainID == paraTool.chainIDPolkadot) {
            await this.processAccountIdentity(indexer, p, s, e2, rAssetkey, fromAddress);
        } else {
            //console.log("UNK", p, s, e2);
        }
        return;
    }

    async processAsset(indexer, p, s, e2) {
        let pallet_section = `${p}:${s}`
        //console.log(`generic processAsset ${pallet_section}`)
        if (pallet_section == 'Balances:TotalIssuance') {
            //tudo: process polkadot/kusama's TotalIssuance here
            await this.processBalancesTotalIssuance(indexer, e2);
            //console.log(`TODO:${pallet_section}`, JSON.stringify(e2))
        } else if (pallet_section == 'Assets:Asset') {
            await this.processAssetsAsset(indexer, p, s, e2);
        } else {
            //if (this.debugLevel >= paraTool.debugInfo) console.log(`process Asset: (unknown) ${pallet_section}`, JSON.stringify(e2));
        }
        return;
    }

    async processMP(indexer, p, s, e2, finalized = false) {
        let pallet_section = `${p}:${s}`
        if (pallet_section == "Dmp:DownwardMessageQueues") {
            //TODO
            await this.processMPTrace(indexer, p, s, e2, 'dmp', finalized);
        } else if (pallet_section == "ParachainSystem:HrmpOutboundMessages") {
            //TODO
            await this.processMPTrace(indexer, p, s, e2, 'hrmp', finalized);
        } else if (pallet_section == "ParachainSystem:UpwardMessages") {
            //TODO
            await this.processMPTrace(indexer, p, s, e2, 'ump', finalized);
        } else {
            //if (this.debugLevel >= paraTool.debugInfo) console.log(`pallet_section ${pallet_section} not handled`)
        }
    }

    async processBalancesTotalIssuance(indexer, e2) {
        //get issuance here (if changed?)
        let chainID = indexer.chainID
        let asset = e2.asset
        if (!asset) {
            // native asset not set yet
            return
        }
        let assetChain = paraTool.makeAssetChain(asset, chainID);
        let cachedAssetInfo = indexer.assetInfo[assetChain]
        if (cachedAssetInfo != undefined && cachedAssetInfo.decimals != undefined) {
            let issuance = e2.totalIssuance / 10 ** cachedAssetInfo.decimals
            //if (this.debugLevel >= paraTool.debugTracing) console.log(`processBalancesTotalIssuance ${asset}, issuance=${issuance}, decimals=${cachedAssetInfo.decimals}`)
            indexer.updateAssetIssuance(e2.asset, issuance, paraTool.assetTypeToken);
        } else {
            //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`processBalancesTotalIssuance not found ${asset}`)
            indexer.logger.debug({
                "op": "acala-processBalancesTotalIssuance",
                "msg": "getAssetDecimal"
            });
        }
    }


    //acala/karura/bifrost
    //assetRegistry:foreignAssetLocations
    //assetRegistry:currencyIdToLocations
    async fetchXCMAssetRegistryLocations(indexer) {
        let chainID = indexer.chainID
        let isAcala = true;
        if (!indexer.api) {
            //console.log(`[fetchXCMAssetRegistryLocations] Fatal indexer.api not initiated`)
            return
        }
        let relayChain = indexer.relayChain
        let relayChainID = paraTool.getRelayChainID(relayChain)
        let paraIDExtra = paraTool.getParaIDExtra(relayChain)

        var a;
        if ([paraTool.chainIDAcala, paraTool.chainIDKarura].includes(chainID)) {
            a = await indexer.api.query.assetRegistry.foreignAssetLocations.entries()
        } else if ([paraTool.chainIDBifrostKSM, paraTool.chainIDBifrostDOT].includes(chainID)) {
            a = await indexer.api.query.assetRegistry.currencyIdToLocations.entries()
            isAcala = false
        }
        if (!a) return
        let assetList = {}
        for (let i = 0; i < a.length; i++) {
            let key = a[i][0];
            let val = a[i][1];
            let assetID = this.cleanedAssetID(key.args.map((k) => k.toHuman())[0]) //input: assetIDWithComma
            let parsedAsset = {};
            if (isAcala) {
                parsedAsset.ForeignAsset = assetID
            } else {
                parsedAsset = assetID
            }
            let paraID = 0
            let chainID = -1

            var asset = JSON.stringify(parsedAsset);
            let assetChain = paraTool.makeAssetChain(asset, chainID);
            let cachedAssetInfo = indexer.assetInfo[assetChain]
            if (cachedAssetInfo != undefined && cachedAssetInfo.symbol != undefined) {
                //cached found
                //console.log(`cached AssetInfo found`, cachedAssetInfo)
                let symbol = (cachedAssetInfo.symbol) ? cachedAssetInfo.symbol : ''
                let nativeSymbol = symbol

                let xcmAsset = val.toJSON()
                let parents = xcmAsset.parents
                let interior = xcmAsset.interior
                //x1/x2/x3 refers to the number to params

                let interiorK = Object.keys(interior)[0]
                let interiork = paraTool.firstCharLowerCase(interiorK)
                let interiorVRaw = interior[interiorK]

                //console.log(`${interiork} interiorVRaw`, interiorVRaw)
                let interiorVStr0 = JSON.stringify(interiorVRaw)
                interiorVStr0.replace('Parachain', 'parachain').replace('Parachain', 'parachain').replace('PalletInstance', 'palletInstance').replace('GeneralIndex', 'generalIndex').replace('GeneralKey', 'generalKey')
                //hack: lower first char
                let interiorV = JSON.parse(interiorVStr0)

                if (interiork == 'here') {
                    //relaychain case
                    chainID = relayChainID
                } else if (interiork == 'x1') {
                    paraID = interiorV['parachain']
                    chainID = paraID + paraIDExtra
                } else {
                    let generalIndex = -1
                    for (let i = 0; i < interiorV.length; i++) {
                        let v = interiorV[i]
                        if (v.parachain != undefined) {
                            paraID = v.parachain
                            chainID = paraID + paraIDExtra
                        } else if (v.generalIndex != undefined) {
                            generalIndex = v.generalIndex
                        } else if (v.generalKey != undefined) {
                            let generalKey = v.generalKey
                            if (generalKey.substr(0, 2) != '0x') {
                                generalKey = paraTool.stringToHex(generalKey)
                                v.generalKey = generalKey
                            }
                        }
                    }
                    //over-write statemine asset with assetID
                    if (paraID == 1000) {
                        nativeSymbol = `${generalIndex}`
                    }
                }
                if (symbol == 'AUSD') {
                    nativeSymbol = 'KUSD'
                } else if (symbol == 'aUSD') {
                    nativeSymbol = 'AUSD'
                }
                let nativeParsedAsset = {
                    Token: nativeSymbol
                }
                var nativeAsset = JSON.stringify(nativeParsedAsset);
                let interiorVStr = JSON.stringify(interiorV)

                if ((interiorK == 'here') && interior[interiorK] == null) {
                    interiorVStr = 'here'
                }

                let xcmInteriorKey = paraTool.makeXcmInteriorKey(interiorVStr, relayChain)
                let cachedXcmAssetInfo = indexer.getXcmAssetInfoByInteriorkey(xcmInteriorKey)
                let updateXcmConcept = true
                if (cachedXcmAssetInfo != undefined && cachedXcmAssetInfo.nativeAssetChain != undefined) {
                    //if (this.debugLevel >= paraTool.debugVerbose) console.log(`known asset ${xcmInteriorKey} (assetChain) - skip update`, cachedXcmAssetInfo)
                    updateXcmConcept = false
                    //already cached
                }
                //console.log(`${chainID} '${interiorVStr}' ${nativeAsset} [${paraID}] | [${symbol}] [${interiorK}]`)
                //if (this.debugLevel >= paraTool.debugInfo) console.log(`addXcmAssetInfo [${asset}]`, assetInfo)
                let nativeAssetChain = paraTool.makeAssetChain(nativeAsset, chainID);
                let xcmAssetInfo = {
                    chainID: chainID,
                    xcmConcept: interiorVStr, //interior
                    asset: nativeAsset,
                    paraID: paraID,
                    relayChain: relayChain,
                    parents: parents,
                    interiorType: interiorK,
                    xcmInteriorKey: xcmInteriorKey,
                    nativeAssetChain: nativeAssetChain,
                    source: chainID,
                }
                //console.log(`xcmAssetInfo`, xcmAssetInfo)
                if (updateXcmConcept) await indexer.addXcmAssetInfo(xcmAssetInfo, 'fetchXCMAssetRegistryLocations');
            } else {
                //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`AssetInfo unknown -- skip`, assetChain)
            }
        }
    }


    //moonbeam/heiko/basilisk
    //assetManager:assetIdType
    //assetRegistry:assetIdType
    //assetRegistry.assetLocations
    async fetchXCMAssetIdType(indexer) {
        if (!indexer.api) {
            //console.log(`[fetchXCMAssetIdType] Fatal indexer.api not initiated`)
            return
        }
        let chainID = indexer.chainID
        let relayChain = indexer.relayChain
        let relayChainID = paraTool.getRelayChainID(relayChain)
        let paraIDExtra = paraTool.getParaIDExtra(relayChain)

        var a;
        if ([paraTool.chainIDMoonbeam, paraTool.chainIDMoonriver, paraTool.chainIDMoonbaseAlpha, paraTool.chainIDMoonbaseBeta, paraTool.chainIDCrustShadow].includes(chainID)) {
            var a = await indexer.api.query.assetManager.assetIdType.entries()
        } else if ([paraTool.chainIDParallel, paraTool.chainIDHeiko].includes(chainID)) {
            var a = await indexer.api.query.assetRegistry.assetIdType.entries()
        } else if ([paraTool.chainIDBasilisk].includes(chainID)) {
            var a = await indexer.api.query.assetRegistry.assetLocations.entries()
        }
        if (!a) return
        let assetList = {}
        for (let i = 0; i < a.length; i++) {
            let key = a[i][0];
            let val = a[i][1];
            let assetID = this.cleanedAssetID(key.args.map((k) => k.toHuman())[0]) //input: assetIDWithComma
            let parsedAsset = {
                Token: assetID
            }
            let paraID = 0
            let chainID = -1
            var asset = JSON.stringify(parsedAsset);
            let assetChain = paraTool.makeAssetChain(asset, chainID);
            let cachedAssetInfo = indexer.assetInfo[assetChain]
            if (cachedAssetInfo != undefined && cachedAssetInfo.symbol != undefined) {
                //cached found
                //console.log(`cached AssetInfo found`, cachedAssetInfo)
                let symbol = (cachedAssetInfo.symbol) ? cachedAssetInfo.symbol.replace('xc', '') : ''
                let nativeSymbol = symbol
                let xcmAssetJSON = val.toJSON()
                let xcmAsset = (xcmAssetJSON.xcm != undefined) ? xcmAssetJSON.xcm : xcmAssetJSON
                let parents = xcmAsset.parents
                let interior = xcmAsset.interior
                //x1/x2/x3 refers to the number to params
                let interiorK = Object.keys(interior)[0]
                let interiork = paraTool.firstCharLowerCase(interiorK)
                let interiorV = interior[interiorK]
                let interiorVStr = JSON.stringify(interiorV)
                if (((interiorK == 'here') || (interiork == "here")) && interior[interiorK] == null) {
                    interiorVStr = 'here'
                    chainID = relayChainID
                }
                let xcmInteriorKey = paraTool.makeXcmInteriorKey(interiorVStr, relayChain)
                let cachedXcmAssetInfo = indexer.getXcmAssetInfoByInteriorkey(xcmInteriorKey)
                let updateXcmConcept = true
                if (cachedXcmAssetInfo != undefined && cachedXcmAssetInfo.nativeAssetChain != undefined) {
                    //if (this.debugLevel >= paraTool.debugVerbose) console.log(`known asset ${xcmInteriorKey} (assetChain) - skip update`, cachedXcmAssetInfo)
                    updateXcmConcept = false
                    //already cached
                }

                if ((typeof interiorK == "string") && (interiorK.toLowerCase() == 'here')) {
                    //relaychain case
                    chainID = relayChainID
                } else if (interiorK == 'x1') {
                    paraID = interiorV['parachain']
                    chainID = paraID + paraIDExtra
                } else {
                    let generalIndex = -1
                    for (const v of interiorV) {
                        if (v.parachain != undefined) {
                            paraID = v.parachain
                            chainID = paraID + paraIDExtra
                        } else if (v.generalIndex != undefined) {
                            generalIndex = v.generalIndex
                        }
                    }
                    //over-write statemine asset with assetID

                    if (paraID == 1000) {
                        nativeSymbol = `${generalIndex}`
                    }
                }
                if (symbol == 'AUSD') {
                    nativeSymbol = 'KUSD'
                } else if (symbol == 'aUSD') {
                    nativeSymbol = 'AUSD'
                }
                let nativeParsedAsset = {
                    Token: nativeSymbol
                }
                var nativeAsset = JSON.stringify(nativeParsedAsset);

                //console.log(`${chainID} '${interiorVStr}' ${nativeAsset} [${paraID}] | [${symbol}] [${interiorK}]`)
                //if (this.debugLevel >= paraTool.debugInfo) console.log(`addXcmAssetInfo [${asset}]`, assetInfo)

                let nativeAssetChain = paraTool.makeAssetChain(nativeAsset, chainID);
                let xcmAssetInfo = {
                    chainID: chainID,
                    xcmConcept: interiorVStr, //interior
                    asset: nativeAsset,
                    paraID: paraID,
                    relayChain: relayChain,
                    parents: parents,
                    interiorType: interiorK,
                    xcmInteriorKey: xcmInteriorKey,
                    nativeAssetChain: nativeAssetChain,
                    source: chainID,
                }
                console.log(`xcmAssetInfo`, xcmAssetInfo)
                if (updateXcmConcept) await indexer.addXcmAssetInfo(xcmAssetInfo, 'fetchXCMAssetIdType');
            } else {
                if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`AssetInfo unknown -- skip`, assetChain)
            }
        }
    }


    //shiden/astar//calamari//
    //xcAssetConfig.assetIdToLocation
    //assetManager.assetIdToLocation
    async fetchXCMAssetIdToLocation(indexer) {
        let isAcala = true;
        if (!indexer.api) {
            //console.log(`[fetchXCMAssetIdToLocation] Fatal indexer.api not initiated`)
            return
        }
        let chainID = indexer.chainID
        let relayChain = indexer.relayChain
        let relayChainID = paraTool.getRelayChainID(relayChain)
        let paraIDExtra = paraTool.getParaIDExtra(relayChain)

        var a;
        if ([paraTool.chainIDAstar, paraTool.chainIDShiden, paraTool.chainIDShibuya].includes(chainID)) {
            a = await indexer.api.query.xcAssetConfig.assetIdToLocation.entries()
        } else if ([paraTool.chainIDCalamari].includes(chainID)) {
            a = await indexer.api.query.assetManager.assetIdLocation.entries()
        }
        if (!a) return
        let assetList = {}
        let xcmInteriorUpdates = []
        for (let i = 0; i < a.length; i++) {
            let key = a[i][0];
            let val = a[i][1];
            let assetID = this.cleanedAssetID(key.args.map((k) => k.toHuman())[0]) //input: assetIDWithComma
            let parsedAsset = {
                Token: assetID
            }
            let paraID = 0
            let chainID = -1

            var asset = JSON.stringify(parsedAsset);
            let assetChain = paraTool.makeAssetChain(asset, chainID);
            let xcContractAddress = paraTool.xcAssetIDToContractAddr(assetID).toLowerCase()

            let cachedAssetInfo = indexer.assetInfo[assetChain]
            if (cachedAssetInfo != undefined && cachedAssetInfo.symbol != undefined) {
                //cached found
                //console.log(`cached AssetInfo found`, cachedAssetInfo)
                let symbol = (cachedAssetInfo.symbol) ? cachedAssetInfo.symbol : ''
                let nativeSymbol = symbol

                let xcmAssetType = val.toJSON()
                // type V0/V1/...
                let xcmAssetTypeV = Object.keys(xcmAssetType)[0]
                let xcmAsset = xcmAssetType[xcmAssetTypeV]
                let parents = xcmAsset.parents
                let interior = xcmAsset.interior
                //x1/x2/x3 refers to the number to params

                let interiorK = Object.keys(interior)[0]
                let interiork = paraTool.firstCharLowerCase(interiorK)
                let interiorVRaw = interior[interiorK]

                //console.log(`${interiork} interiorVRawV`, interiorVRawV)
                let interiorVStr0 = JSON.stringify(interiorVRaw)
                interiorVStr0.replace('Parachain', 'parachain').replace('PalletInstance', 'palletInstance').replace('GeneralIndex', 'generalIndex').replace('GeneralKey', 'generalKey')
                //hack: lower first char
                let interiorV = JSON.parse(interiorVStr0)

                if (interiork == 'here' || interiork == 'Here') {
                    //relaychain case
                    chainID = relayChainID
                } else if (interiork == 'x1') {
                    paraID = interiorV['parachain']
                    chainID = paraID + paraIDExtra
                } else {
                    let generalIndex = -1
                    for (let i = 0; i < interiorV.length; i++) {
                        let v = interiorV[i]
                        if (v.parachain != undefined) {
                            paraID = v.parachain
                            chainID = paraID + paraIDExtra
                        } else if (v.generalIndex != undefined) {
                            generalIndex = v.generalIndex
                        } else if (v.generalKey != undefined) {
                            let generalKey = v.generalKey
                            if (generalKey.substr(0, 2) != '0x') {
                                generalKey = paraTool.stringToHex(generalKey)
                                v.generalKey = generalKey
                            }
                        }
                    }
                    //over-write statemine asset with assetID
                    if (paraID == 1000) {
                        nativeSymbol = `${generalIndex}`
                    }
                }
                if (symbol == 'AUSD') {
                    nativeSymbol = 'KUSD'
                } else if (symbol == 'aUSD') {
                    nativeSymbol = 'AUSD'
                }
                let nativeParsedAsset = {
                    Token: nativeSymbol
                }
                var nativeAsset = JSON.stringify(nativeParsedAsset);
                let interiorVStr = JSON.stringify(interiorV)

                if ((interiork == 'here' || interiork == 'Here') && interior[interiorK] == null) {
                    interiorVStr = 'here'
                }

                let xcmInteriorKey = paraTool.makeXcmInteriorKey(interiorVStr, relayChain)
                let cachedXcmAssetInfo = indexer.getXcmAssetInfoByInteriorkey(xcmInteriorKey)
                let updateXcmConcept = true
                if (cachedXcmAssetInfo != undefined && cachedXcmAssetInfo.nativeAssetChain != undefined) {
                    updateXcmConcept = false
                    //if (this.debugLevel >= paraTool.debugVerbose) console.log(`known asset ${xcmInteriorKey} (assetChain) - skip update`, cachedXcmAssetInfo)
                }

                //if (this.debugLevel >= paraTool.debugInfo) console.log(`addXcmAssetInfo [${asset}]`, assetInfo)

                let nativeAssetChain = paraTool.makeAssetChain(nativeAsset, chainID);
                let xcmAssetInfo = {
                    chainID: chainID,
                    xcmConcept: interiorVStr, //interior
                    asset: nativeAsset,
                    paraID: paraID,
                    relayChain: relayChain,
                    parents: parents,
                    interiorType: interiorK,
                    xcmInteriorKey: xcmInteriorKey,
                    nativeAssetChain: nativeAssetChain,
                    source: chainID,
                }
                console.log(`xcmAssetInfo`, xcmAssetInfo)
                if (updateXcmConcept) await indexer.addXcmAssetInfo(xcmAssetInfo, 'fetchXCMAssetIdToLocation');

                //["asset", "chainID"] + ["xcmInteriorKey"]
                //let [assetUnparsed, chainID] = paraTool.parseAssetChain(xcmRec.originalKey)
                if ([paraTool.chainIDAstar, paraTool.chainIDShiden, paraTool.chainIDShibuya].includes(chainID)) {
                    if (updateXcmConcept) {
                        let c = `('${asset}', '${chainID}', '${xcmAssetInfo.xcmInteriorKey}', '${xcContractAddress}')`
                        xcmInteriorUpdates.push(c)
                        //console.log(`xcmInteriorUpdates`, c)
                    }
                }
            } else {
                //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`AssetInfo unknown -- skip`, assetChain)
            }
        };

        if (xcmInteriorUpdates.length > 0) {
            let sqlDebug = true
            let xcmInteriorKeyVal = ["xcmInteriorKey", "xcContractAddress"]
            await indexer.upsertSQL({
                "table": `asset`,
                "keys": ["asset", "chainID"],
                "vals": xcmInteriorKeyVal,
                "data": xcmInteriorUpdates,
                "replace": xcmInteriorKeyVal,
            }, sqlDebug);
        }
    }

    //moonbeam/parallel/astar
    //asset:metadata
    //assetRegistry:assetMetadataMap
    //assetsInfo:assetsInfo
    async fetchAsset(indexer) {
        let chainID = indexer.chainID
        if (!indexer.api) {
            console.log(`[fetchAsset] Fatal indexer.api not initiated`)
            return
        }
        var a;
        switch (chainID) {
            case paraTool.chainIDListen:
                //console.log(`fetch currencies:listenAssetsInfo`)
                a = await indexer.api.query.currencies.listenAssetsInfo.entries()
                break;
            case paraTool.chainIDMangataX:
                //console.log(`fetch assetsInfo:assetsInfo`, indexer.api.query)
                //   a = await indexer.api.query.assetsInfo.assetsInfo.entries()
                break;
            case paraTool.chainIDBasilisk:
            case paraTool.chainIDHydraDX:
                //console.log(`fetch assetRegistry:assetMetadataMap`)
                try {
                    a = await indexer.api.query.assetRegistry.assets.entries()
                } catch (err) {}
                break;
            default:
                //console.log(`fetch asset:metadata`)
                a = await indexer.api.query.assets.metadata.entries()
                break;
        }
        if (!a) {
            //console.log(`returned`)
            return
        }
        let assetList = {}
        for (let i = 0; i < a.length; i++) {
            let key = a[i][0];
            let val = a[i][1];
            let assetID = this.cleanedAssetID(key.args.map((k) => k.toHuman())[0]) //input: assetIDWithComma
            let assetMetadata = val.toHuman()
            let parsedAsset = {
                Token: assetID
            }

            // blacklist
            if ([paraTool.chainIDBasilisk, paraTool.chainIDListen].includes(chainID)) {
                //skipping BSX / LT
                if (assetID == '0') continue
            }
            if ([paraTool.chainIDAstar].includes(chainID)) {
                //skipping ???
                if (assetID == '1333') continue
            }
            if ([paraTool.chainIDParallel].includes(chainID)) {
                //skipping PARA
                if (assetID == '0') continue
            }
            if ([paraTool.chainIDHeiko].includes(chainID)) {
                //skipping HKO
                if (assetID == '1') continue
            }
            var asset = JSON.stringify(parsedAsset);
            let assetChain = paraTool.makeAssetChain(asset, chainID);
            let cachedAssetInfo = indexer.assetInfo[assetChain]
            if (cachedAssetInfo != undefined && cachedAssetInfo.assetName != undefined && cachedAssetInfo.decimals != undefined && cachedAssetInfo.assetType != undefined && cachedAssetInfo.symbol != undefined) {
                //cached found
                //if (this.debugLevel >= paraTool.debugVerbose) console.log(`cached AssetInfo found`, cachedAssetInfo)
                assetList[asset] = cachedAssetInfo
            } else {
                if (assetMetadata.decimals !== false && assetMetadata.symbol) {
                    let name = (assetMetadata.name != undefined) ? assetMetadata.name : `${assetMetadata.symbol}` //Basilisk doens't have assetName, use symbol in this case
                    let assetInfo = {
                        name: name,
                        symbol: assetMetadata.symbol,
                        decimals: assetMetadata.decimals,
                        assetType: paraTool.assetTypeToken,
                        currencyID: assetID
                    };
                    if ([paraTool.chainIDParallel, paraTool.chainIDHeiko].includes(chainID)) {
                        if (assetInfo.symbol.includes('LP-')) assetInfo.assetType = paraTool.assetTypeLiquidityPair
                        //console.log('im here fetchAsset assetInfo', assetInfo)
                    }
                    assetList[asset] = assetInfo
                    //if (this.debugLevel >= paraTool.debugInfo) console.log(`addAssetInfo [${asset}]`, assetInfo)
                    await indexer.addAssetInfo(asset, chainID, assetInfo, 'fetchAsset');
                } else {
                    //if (this.debugLevel >= paraTool.debugErrorOnly) console.log("COULD NOT ADD asset -- no assetType", decimals, assetType, parsedAsset, asset);
                }
            }
        }
        if (this.debugLevel >= paraTool.debugVerbose) console.log(assetList);
    }

    //localAssets.metadata
    async fetchLocalAsset(indexer) {
        let chainID = indexer.chainID
        if (!indexer.api) {
            //console.log(`[fetchLocalAsset] Fatal indexer.api not initiated`)
            return
        }
        var a;
        switch (chainID) {
            default:
                //console.log(`fetch localAssets:metadata`)
                try {
                    a = await indexer.api.query.localAssets.metadata.entries()
                } catch (e) {

                }
                break;
        }
        if (!a) {
            //console.log(`returned`)
            return
        }
        let assetList = {}
        for (let i = 0; i < a.length; i++) {
            let key = a[i][0];
            let val = a[i][1];
            let assetID = this.cleanedAssetID(key.args.map((k) => k.toHuman())[0]) //input: assetIDWithComma
            let assetMetadata = val.toHuman()
            let parsedAsset = {
                Token: assetID
            }
            var asset = JSON.stringify(parsedAsset);
            let assetChain = paraTool.makeAssetChain(asset, chainID);
            let cachedAssetInfo = indexer.assetInfo[assetChain]
            if (cachedAssetInfo != undefined && cachedAssetInfo.assetName != undefined && cachedAssetInfo.decimals != undefined && cachedAssetInfo.assetType != undefined && cachedAssetInfo.symbol != undefined) {
                //cached found
                //if (this.debugLevel >= paraTool.debugVerbose) console.log(`cached AssetInfo found`, cachedAssetInfo)
                assetList[asset] = cachedAssetInfo
            } else {
                if (assetMetadata.decimals !== false && assetMetadata.symbol) {
                    let name = (assetMetadata.name != undefined) ? assetMetadata.name : `${assetMetadata.symbol}`
                    let assetInfo = {
                        name: name,
                        symbol: assetMetadata.symbol,
                        decimals: assetMetadata.decimals,
                        assetType: paraTool.assetTypeToken,
                        currencyID: assetID,
                        isLocalAsset: 1,
                    };
                    assetList[asset] = assetInfo
                    //if (this.debugLevel >= paraTool.debugInfo) console.log(`addAssetInfo [${asset}]`, assetInfo)
                    await indexer.addAssetInfo(asset, chainID, assetInfo, 'localAssets');
                } else {
                    //if (this.debugLevel >= paraTool.debugErrorOnly) console.log("COULD NOT ADD asset -- no assetType", decimals, assetType, parsedAsset, asset);
                }
            }
        }
        //if (this.debugLevel >= paraTool.debugVerbose) console.log(assetList);
    }

    //acala/karura/bifrost/basilisk
    //assetRegistry.assetMetadatas
    //assetRegistry.currencyMetadatas
    async fetchAssetRegistry(indexer) {
        let chainID = indexer.chainID
        if (!indexer.api) {
            console.log(`[fetchAssetRegistry] Fatal indexer.api not initiated`)
            return
        }
        var a;
        let isAcala = true
        switch (chainID) {
            case paraTool.chainIDBifrostDOT:
            case paraTool.chainIDBifrostKSM:
                //console.log(`fetch assetRegistry:currencyMetadatas`)
                a = await indexer.api.query.assetRegistry.currencyMetadatas.entries()
                isAcala = false
                break;
            case paraTool.chainIDAcala:
            case paraTool.chainIDKarura:
            default:
                //console.log(`fetch assetRegistry:assetMetadatas`)
                a = await indexer.api.query.assetRegistry.assetMetadatas.entries()
                break;
        }
        if (!a) return
        let assetList = {}
        //ForeignAssetId/{"NativeAssetId":{"Token":"XXX"}}/{"Erc20":"0x1f3a10587a20114ea25ba1b388ee2dd4a337ce27"}/{"StableAssetId":"0"}
        // remove the Id prefix here
        for (let i = 0; i < a.length; i++) {
            let key = a[i][0];
            let val = a[i][1];
            let assetMetadata = val.toHuman()
            let parsedAsset = {}
            let assetKeyWithID = key.args.map((k) => k.toHuman())[0] //{"ForeignAssetId":"0"}
            let assetKey = Object.keys(assetKeyWithID)[0] // ForeignAssetId
            let assetKeyVal = this.cleanedAssetID(assetKeyWithID[assetKey]) // "123,456" or {"Token":"XXX"}
            if (assetKey == 'NativeAssetId') {
                //this is the bifrost case
                parsedAsset = assetKeyVal
            } else {
                // this is the acala/karura case
                let assetKeyWithoutID = assetKey.replace('Id', '') //ForeignAsset
                parsedAsset[assetKeyWithoutID] = assetKeyVal
            }
            var asset = JSON.stringify(parsedAsset);
            let assetChain = paraTool.makeAssetChain(asset, chainID);
            let cachedAssetInfo = indexer.assetInfo[assetChain]
            if (cachedAssetInfo != undefined && cachedAssetInfo.assetName != undefined && cachedAssetInfo.decimals != undefined && cachedAssetInfo.assetType != undefined && cachedAssetInfo.symbol != undefined && cachedAssetInfo.symbol != 'false') {
                //cached found
                //if (this.debugLevel >= paraTool.debugVerbose) console.log(`cached AssetInfo found`, cachedAssetInfo)
                assetList[assetChain] = cachedAssetInfo
            } else {
                if (assetMetadata.decimals !== false && assetMetadata.symbol) {
                    let symbol = assetMetadata.symbol
                    let name = assetMetadata.name
                    if ([paraTool.chainIDBifrostKSM, paraTool.chainIDBifrostDOT].includes(chainID)) {
                        //biforst VSToken has erroneous/ambiguous symbol representation
                        if (parsedAsset.VSToken != undefined) {
                            symbol = 'VS' + symbol
                            name = `Bifrost Voucher Slot ` + name
                        }
                    }
                    let assetInfo = {
                        name: name,
                        symbol: symbol,
                        decimals: assetMetadata.decimals,
                        assetType: paraTool.assetTypeToken
                    };
                    assetList[assetChain] = assetInfo
                    //if (this.debugLevel >= paraTool.debugInfo) console.log(`addAssetInfo [${asset}]`, assetInfo)
                    await indexer.addAssetInfo(asset, chainID, assetInfo, 'fetchAssetRegistry');
                } else {
                    //if (this.debugLevel >= paraTool.debugErrorOnly) console.log("COULD NOT ADD asset -- no assetType", decimals, assetType, parsedAsset, asset);
                }
            }
        }
        //if (this.debugLevel >= paraTool.debugVerbose) console.log(assetList);
    }

    //moonbeam/parallel/astar/statemine
    processDecHexCurrencyID(indexer, currency_id, chainID) {
        let assetString = false
        let rawAssetID = false
        if (currency_id != undefined) {
            if (this.isObject(currency_id)) {
                if (currency_id.foreignAsset != undefined) {
                    rawAssetID = currency_id.foreignAsset
                } else if (currency_id.localAssetReserve != undefined) {
                    rawAssetID = currency_id.localAssetReserve
                } else if (currency_id.selfReserve === null) {
                    // return native asset
                    let nativeAssetString = indexer.getNativeAsset(chainID)
                    return nativeAssetString
                } else {
                    //if (this.debugLevel >= paraTool.debugInfo) console.log(`processDecHexCurrencyID chainID=${chainID} currency_id unknown struct`, currency_id)
                }
            } else {
                // numbers
                rawAssetID = currency_id
            }
        }

        if (rawAssetID) {
            let assetIDWithComma = paraTool.toNumWithComma(paraTool.dechexAssetID(rawAssetID))
            let assetID = this.cleanedAssetID(assetIDWithComma)
            let parsedAsset = {
                Token: assetID
            }
            let assetInfo = this.getSynchronizedAssetInfo(indexer, parsedAsset, chainID)
            if (assetInfo != undefined && assetInfo.symbol != undefined) {
                let rAasset = {
                    Token: assetInfo.symbol
                }
                assetString = this.token_to_string(rAasset);
                //if (this.debugLevel >= paraTool.debugVerbose) console.log(`convert currency_id [${JSON.stringify(currency_id)}] -> ${assetString}`)
            }
        }
        return assetString
    }

    // convert asset_id 123456 to {Token:'123,456'}
    processRawDecHexCurrencyID(indexer, currency_id, chainID) {
        let assetString = false
        let rawAssetID = false
        if (currency_id != undefined) {
            if (this.isObject(currency_id)) {
                if (currency_id.foreignAsset != undefined) {
                    rawAssetID = currency_id.foreignAsset
                } else if (currency_id.localAssetReserve != undefined) {
                    rawAssetID = currency_id.localAssetReserve
                } else if (currency_id.selfReserve === null) {
                    // return native asset
                    let nativeAssetString = indexer.getNativeAsset(chainID)
                    return nativeAssetString
                } else {
                    //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`processRawDecHexCurrencyID currency_id unknown struct`, currency_id)
                }
            } else {
                // numbers
                rawAssetID = currency_id
            }
        }

        if (rawAssetID) {
            let assetIDWithComma = paraTool.toNumWithComma(paraTool.dechexAssetID(rawAssetID))
            let assetID = this.cleanedAssetID(assetIDWithComma)
            let parsedAsset = {
                Token: assetID
            }
            assetString = this.token_to_string(parsedAsset);
        }
        return assetString
    }

    //acala/karura/bifrost?
    processAssetRegistryCurrencyID(indexer, currency_id, chainID) {
        let assetString = this.token_to_string(currency_id)
        let newAssetString = assetString
        let parsedAsset = JSON.parse(assetString)
        if (parsedAsset.Token != undefined) {
            return assetString
        } else {
            let assetInfo = this.getSynchronizedAssetInfo(indexer, parsedAsset, chainID)
            if (assetInfo != undefined && assetInfo.symbol != undefined) {
                let rAasset = {
                    Token: assetInfo.symbol
                }
                newAssetString = this.token_to_string(rAasset);
                //if (this.debugLevel >= paraTool.debugTracing) console.log(`convert assetString [${assetString}] -> ${newAssetString}`)
                return newAssetString
            }
        }
    }

    processXcmGenericCurrencyID(indexer, currency_id, chainID) {
        if ([paraTool.chainIDKarura, paraTool.chainIDAcala].includes(chainID)) {
            //assetregistry
            return this.processXcmAssetRegistryCurrencyID(indexer, currency_id, chainID)
        } else if ([paraTool.chainIDBifrostKSM, paraTool.chainIDBifrostDOT].includes(chainID)) {
            //original format
            let assetString = this.processXcmDecHexCurrencyID(indexer, currency_id, chainID)
            //console.log(`BIFROST Token ${assetString}`)
            if (!assetString) {
                // token2 format
                assetString = this.processXcmAssetRegistryCurrencyID(indexer, currency_id, chainID)
                //console.log(`BIFROST Token2 ${assetString}`)
            }
            return assetString
        } else if ([paraTool.chainIDInterlay, paraTool.chainIDKintsugi].includes(chainID)) {
            return this.processXcmAssetRegistryCurrencyID(indexer, currency_id, chainID)
        } else if ([paraTool.chainIDMoonbeam, paraTool.chainIDMoonriver, paraTool.chainIDMoonbaseAlpha, paraTool.chainIDMoonbaseBeta].includes(chainID)) {
            //assets (default case)
            return this.processXcmDecHexCurrencyID(indexer, currency_id, chainID)
        } else {
            //assets (default case)
            return this.processXcmDecHexCurrencyID(indexer, currency_id, chainID)
        }
    }

    //moonbeam/parallel/astar/statemine
    processXcmDecHexCurrencyID(indexer, currency_id, chainID) {
        let assetString = false
        let rawAssetID = null
        if (currency_id != undefined) {
            if (this.isObject(currency_id)) {
                if (currency_id.foreignAsset != undefined) {
                    rawAssetID = currency_id.foreignAsset
                } else if (currency_id.localAssetReserve != undefined) {
                    rawAssetID = currency_id.localAssetReserve
                } else if (currency_id.token2 != undefined) {
                    rawAssetID = currency_id.token2
                } else if (currency_id.selfReserve === null) {
                    // return native asset
                    let nativeSymbol = indexer.getNativeSymbol(chainID)
                    return nativeSymbol
                } else {
                    //if (this.debugLevel >= paraTool.debugInfo) console.log(`processDecHexCurrencyID chainID=${chainID} currency_id unknown struct`, currency_id)
                    //TODO..
                }
            } else {
                // numbers
                rawAssetID = currency_id
            }
        }
        //if (this.debugLevel >= paraTool.debugTracing) console.log(`processXcmDecHexCurrencyID chainID=${chainID} rawAssetID=${rawAssetID}, currency_id`, currency_id)
        if (rawAssetID != undefined) {
            let assetIDWithComma = paraTool.toNumWithComma(paraTool.dechexAssetID(rawAssetID))
            let assetID = this.cleanedAssetID(assetIDWithComma)
            let parsedAsset = {
                Token: assetID
            }
            let assetInfo = this.getSynchronizedAssetInfo(indexer, parsedAsset, chainID)
            //if (this.debugLevel >= paraTool.debugInfo) console.log(`rawAssetID=${rawAssetID}, assetInfo`, assetInfo)
            if (assetInfo != undefined && assetInfo.symbol != undefined && assetInfo.isXCAsset) {
                let xcmAssetSymbol = assetInfo.symbol
                //if (this.debugLevel >= paraTool.debugVerbose) console.log(`convert currency_id [${JSON.stringify(currency_id)}] -> xcmAssetSymbol ${xcmAssetSymbol}`)
                return xcmAssetSymbol
            } else {
                //TODO: not found case
                //console.log(`processXcmDecHexCurrencyID chainID=${chainID} assetID=${assetID}, rawAssetID=${rawAssetID}, parsedAsset=${parsedAsset}, assetInfo`, assetInfo)
            }
        }
        return assetString
    }

    processXcmAssetRegistryCurrencyID(indexer, currency_id, chainID) {
        let assetString = this.token_to_string(currency_id)
        let newAssetString = assetString
        let parsedAsset = JSON.parse(assetString)
        if (parsedAsset.Token != undefined) {
            return parsedAsset.Token
        } else {
            let assetInfo = this.getSynchronizedAssetInfo(indexer, parsedAsset, chainID)
            //if (this.debugLevel >= paraTool.debugInfo) console.log(`processXcmAssetRegistryCurrencyID convert currency_id [${JSON.stringify(currency_id)}] -> ${assetString}, assetInfo`, assetInfo)
            if (assetInfo != undefined && assetInfo.symbol != undefined && assetInfo.isXCAsset) {
                let xcmAssetSymbol = assetInfo.symbol
                //if (this.debugLevel >= paraTool.debugTracing) console.log(`convert currency_id [${JSON.stringify(currency_id)}] ->  xcmAssetSymbol ${xcmAssetSymbol}`)
                return xcmAssetSymbol
            } else {
                //TODO
            }
        }
    }

    getAssetRegistrySymbolAndDecimals(indexer, currency_id, chainID) {
        let convertedAssetString = false
        let assetString = this.token_to_string(currency_id)
        let newAssetString = assetString
        let parsedAsset = JSON.parse(assetString)
        let decimals = false
        let symbol = false
        if (assetString != '{}') {
            convertedAssetString = assetString
        }
        let assetInfo = this.getSynchronizedAssetInfo(indexer, parsedAsset, chainID)
        if (assetInfo != undefined && assetInfo.symbol != undefined && assetInfo.decimals != undefined) {
            decimals = assetInfo.decimals
            symbol = assetInfo.symbol
            return [symbol, decimals, assetString]
        }
        return [false, false, false]
    }

    getDecHexCurrencyIDSymbolAndDecimals(indexer, currency_id, chainID) {
        let assetString = false
        let decimals = false
        let symbol = false
        let rawAssetID = false
        if (currency_id != undefined) {
            if (this.isObject(currency_id)) {
                if (currency_id.foreignAsset != undefined) {
                    rawAssetID = currency_id.foreignAsset
                } else if (currency_id.localAssetReserve != undefined) {
                    rawAssetID = currency_id.localAssetReserve
                } else if (currency_id.selfReserve === null) {
                    // return native asset
                    let nativeAssetString = indexer.getNativeAsset(chainID)
                    symbol = indexer.getChainSymbol(chainID);
                    decimals = indexer.getChainDecimal(chainID)
                    return [symbol, decimals, nativeAssetString]
                } else {
                    //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`processDecHexCurrencyID chainID=${chainID} currency_id unknown struct`, currency_id)
                }
            } else {
                // numbers
                rawAssetID = currency_id
            }
        }

        if (rawAssetID !== false) {
            let assetIDWithComma = paraTool.toNumWithComma(paraTool.dechexAssetID(rawAssetID))
            let assetID = this.cleanedAssetID(assetIDWithComma)
            let parsedAsset = {
                Token: assetID
            }
            let assetInfo = this.getSynchronizedAssetInfo(indexer, parsedAsset, chainID)
            //console.log(`getDecHexCurrencyIDSymbolAndDecimals rawAssetID=${rawAssetID}, parsedAsset=`, parsedAsset, `assetInfo=`, assetInfo)
            if (assetInfo != undefined && assetInfo.symbol != undefined && assetInfo.decimals != undefined) {
                let rAasset = {
                    Token: assetInfo.symbol
                }
                assetString = this.token_to_string(rAasset);
                //if (this.debugLevel >= paraTool.debugVerbose) console.log(`convert currency_id [${JSON.stringify(currency_id)}] -> ${assetString}`)
                symbol = assetInfo.symbol
                decimals = assetInfo.decimals
            }
        }
        return [symbol, decimals, assetString]
    }



    // universal parser
    getGenericSymbolAndDecimal(indexer, currency_id, chainID) {
        try {
            if ([paraTool.chainIDKarura, paraTool.chainIDAcala, paraTool.chainIDBifrostKSM, paraTool.chainIDBifrostDOT].includes(chainID)) {
                //assetregistry
                return this.getAssetRegistrySymbolAndDecimals(indexer, currency_id, chainID)
            } else if ([paraTool.chainIDInterlay, paraTool.chainIDKintsugi].includes(chainID)) {
                return this.getAssetRegistrySymbolAndDecimals(indexer, currency_id, chainID)
            } else if ([paraTool.chainIDMoonbeam, paraTool.chainIDMoonriver, paraTool.chainIDMoonbaseAlpha, paraTool.chainIDMoonbaseBeta].includes(chainID)) {
                //assets (default case)
                let [symbols, decimals, assetString] = this.getDecHexCurrencyIDSymbolAndDecimals(indexer, currency_id, chainID)
                if (symbols) {
                    symbols = symbols.replace('xc', '')
                }
                return [symbols, decimals, assetString]
            } else {
                // assets (default case)
                // TODO: how to fix ausd/kusd BS?
                let [symbols, decimals, assetString] = this.getDecHexCurrencyIDSymbolAndDecimals(indexer, currency_id, chainID)
                return [symbols, decimals, assetString]
            }
        } catch (e) {
            if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`getGenericSymbolAndDecimal error`, e.toString())
            return [false, false, false]
        }
    }

    // universal parser
    processGenericCurrencyID(indexer, currency_id, chainID) {
        if ([paraTool.chainIDKarura, paraTool.chainIDAcala, paraTool.chainIDBifrostKSM, paraTool.chainIDBifrostDOT].includes(chainID)) {
            //assetregistry
            return this.processAssetRegistryCurrencyID(indexer, currency_id, chainID)
        } else if ([paraTool.chainIDInterlay, paraTool.chainIDKintsugi].includes(chainID)) {
            return this.processAssetRegistryCurrencyID(indexer, currency_id, chainID)
        } else if ([paraTool.chainIDMoonbeam, paraTool.chainIDMoonriver, paraTool.chainIDMoonbaseAlpha, paraTool.chainIDMoonbaseBeta].includes(chainID)) {
            //assets (default case)
            return this.processDecHexCurrencyID(indexer, currency_id, chainID)
        } else {
            //assets (default case)
            return this.processDecHexCurrencyID(indexer, currency_id, chainID)
        }
    }

    // strip first layer
    processRawGenericCurrencyID(indexer, currency_id, chainID) {
        if ([paraTool.chainIDKarura, paraTool.chainIDAcala, paraTool.chainIDBifrostKSM, paraTool.chainIDBifrostDOT].includes(chainID)) {
            //assetregistry
            return this.token_to_string(currency_id)
        } else if ([paraTool.chainIDInterlay, paraTool.chainIDKintsugi].includes(chainID)) {
            return this.token_to_string(currency_id)
        } else if ([paraTool.chainIDMoonbeam, paraTool.chainIDMoonriver, paraTool.chainIDMoonbaseAlpha, paraTool.chainIDMoonbaseBeta].includes(chainID)) {
            //assets (default case)
            return this.processRawDecHexCurrencyID(indexer, currency_id, chainID)
        } else {
            //assets (default case)
            return this.processRawDecHexCurrencyID(indexer, currency_id, chainID)
        }
    }

    processBalancesDepositSignal(indexer, extrinsicID, e, mpState, finalized) {
        let candidate = false
        let [pallet, method] = indexer.parseEventSectionMethod(e)
        let palletMethod = `${pallet}(${method})`
        let eventIndex = e.eventID.split('-')[3]
        let d = e.data;
        let chainID = indexer.chainID
        // data: [ 'E67Dnpw6F8uUoWJstb6GdgSY91AzKdxrqnkMrFYWMYpLURD', 6711567141759 ],
        let relayChain = indexer.relayChain
        let targetedSymbol = indexer.getNativeSymbol(chainID)
        let targetedXcmInteriorKey = indexer.check_refintegrity_xcm_signal(targetedSymbol, "getNativeSymbol", palletMethod, targetedSymbol)

        let fromAddress = paraTool.getPubKey(d[0]);
        let amountReceived = paraTool.dechexToInt(d[1]);

        //let [isXCMAssetFound, standardizedXCMInfo] = indexer.getStandardizedXCMAssetInfo(chainID, assetString, rawAssetString)
        if (paraTool.validAmount(amountReceived)) {
            let caller = `generic processIncomingAssetSignal balances:Deposit`
            candidate = {
                chainIDDest: chainID,
                eventID: `${chainID}-${extrinsicID}-${eventIndex}`,
                extrinsicID: extrinsicID,
                pallet: pallet,
                method: method,
                fromAddress: fromAddress,
                blockNumberDest: this.parserBlockNumber,
                sentAt: this.parserWatermark,
                relayChain: relayChain,
                xcmSymbol: targetedSymbol,
                xcmInteriorKey: targetedXcmInteriorKey,
                destTS: this.parserTS,
                amountReceived: amountReceived,
                msgHash: mpState.msgHash,
            }
            return [candidate, caller]
        } else {
            // TODO: log
        }
        return [false, false]
    }

    processCurrenciesDepositedSignal(indexer, extrinsicID, e, mpState, finalized) {
        //if (this.debugLevel >= paraTool.debugTracing) console.log(`currencies(Deposited)`, e.data)
        let candidate = false
        let [pallet, method] = indexer.parseEventSectionMethod(e)
        let palletMethod = `${pallet}(${method})`
        let eventIndex = e.eventID.split('-')[3]
        let d = e.data;
        let chainID = indexer.chainID
        //let assetString = this.token_to_string(d[0]);
        //let assetString = this.processGenericCurrencyID(indexer, d[0], chainID);
        //let rawAssetString = this.processRawGenericCurrencyID(indexer, d[0], chainID);
        //let [isXCMAssetFound, standardizedXCMInfo] = indexer.getStandardizedXCMAssetInfo(chainID, assetString, rawAssetString)
        let relayChain = indexer.relayChain
        let targetedSymbol = this.processXcmGenericCurrencyID(indexer, d[0], chainID) //inferred approach
        let targetedXcmInteriorKey = indexer.check_refintegrity_xcm_signal(targetedSymbol, "processXcmGenericCurrencyID", palletMethod, d[0])

        let fromAddress = paraTool.getPubKey(d[1]);
        let amountReceived = paraTool.dechexToInt(d[2]);
        if (paraTool.validAmount(amountReceived)) {
            let caller = `generic processIncomingAssetSignal currencies:Deposited`
            candidate = {
                chainIDDest: chainID,
                eventID: `${chainID}-${extrinsicID}-${eventIndex}`,
                extrinsicID: extrinsicID,
                pallet: pallet,
                method: method,
                fromAddress: fromAddress,
                blockNumberDest: this.parserBlockNumber,
                sentAt: this.parserWatermark,
                relayChain: relayChain,
                xcmSymbol: targetedSymbol,
                xcmInteriorKey: targetedXcmInteriorKey,
                destTS: this.parserTS,
                amountReceived: amountReceived,
                msgHash: mpState.msgHash,
            }
            return [candidate, caller]
        } else {
            // TODO: log
        }
        return [false, false]
    }

    processTokensDepositedSignal(indexer, extrinsicID, e, mpState, finalized) {
        //if (this.debugLevel >= paraTool.debugTracing) console.log(`tokens(Deposited)`, e.data)
        let candidate = false
        let [pallet, method] = indexer.parseEventSectionMethod(e)
        let palletMethod = `${pallet}(${method})`
        let eventIndex = e.eventID.split('-')[3]
        let d = e.data;
        let chainID = indexer.chainID
        //let assetString = this.token_to_string(d[0]);
        //let assetString = this.processGenericCurrencyID(indexer, d[0], chainID);
        //let rawAssetString = this.processRawGenericCurrencyID(indexer, d[0], chainID);
        //let [isXCMAssetFound, standardizedXCMInfo] = indexer.getStandardizedXCMAssetInfo(chainID, assetString, rawAssetString)
        let relayChain = indexer.relayChain
        //console.log(`${e.eventID} processXcmGenericCurrencyID asset=`,d[0])
        let targetedSymbol = this.processXcmGenericCurrencyID(indexer, d[0], chainID) //inferred approach
        let targetedXcmInteriorKey = indexer.check_refintegrity_xcm_signal(targetedSymbol, "processXcmGenericCurrencyID", palletMethod, d[0])
        let fromAddress = paraTool.getPubKey(d[1]);
        let amountReceived = paraTool.dechexToInt(d[2]);
        //console.log(`[${fromAddress}] ${assetString}`, amountReceived, `finalized=${finalized}`)
        if (paraTool.validAmount(amountReceived)) {
            let caller = `generic processIncomingAssetSignal tokens:Deposited`
            candidate = {
                chainIDDest: chainID,
                eventID: `${chainID}-${extrinsicID}-${eventIndex}`,
                extrinsicID: extrinsicID,
                pallet: pallet,
                method: method,
                fromAddress: fromAddress,
                blockNumberDest: this.parserBlockNumber,
                sentAt: this.parserWatermark,
                relayChain: relayChain,
                xcmSymbol: targetedSymbol,
                xcmInteriorKey: targetedXcmInteriorKey,
                destTS: this.parserTS,
                amountReceived: amountReceived,
                msgHash: mpState.msgHash,
            }
            return [candidate, caller]
        } else {
            // TODO: log
        }
        return [false, false]
    }

    processAssetsIssuedSignal(indexer, extrinsicID, e, mpState, finalized = false) {
        /*
        data": [
          101,
          "p8DR3iQJe3tN8RXizq3TnH3LfHCU7e7PNQ9zTwfAj7RFzExL9",
          96000000
        ]
        data: [
          '0xa922fef94566104a6e5a35a4fcddaa9f',
          '0x21E67e31Cd2FbE33DA93443B93507841C657C044',
          144975036571423
        ]
        */
        //console.log(`assets(Issued) detected`, e)

        let candidate = false
        let [pallet, method] = indexer.parseEventSectionMethod(e)
        let palletMethod = `${pallet}(${method})`
        let d = e.data;
        let fromAddress = paraTool.getPubKey(d[1])
        let chainID = indexer.chainID
        /*
        let assetIDWithComma = paraTool.toNumWithComma(paraTool.dechexAssetID(d[0]))
        let assetID = this.cleanedAssetID(assetIDWithComma)
        let parsedAsset = {
            Token: assetID
        }
        let rawAssetString = this.token_to_string(parsedAsset);
        */
        let relayChain = indexer.relayChain
        let targetedSymbol = this.processXcmGenericCurrencyID(indexer, d[0], chainID) //inferred approach
        let targetedXcmInteriorKey = indexer.check_refintegrity_xcm_signal(targetedSymbol, "processXcmGenericCurrencyID", palletMethod, d[0])

        //TODO: not sure here..
        //let assetString = this.processGenericCurrencyID(indexer, d[0], chainID);
        //let rawAssetString = this.processRawGenericCurrencyID(indexer, d[0], chainID);
        //let parsedAsset = JSON.parse(assetString)
        // let assetInfo = this.getSynchronizedAssetInfo(indexer, parsedAsset, chainID)
        if (targetedSymbol != undefined && targetedSymbol != false) {
            let amountReceived = paraTool.dechexToInt(d[2])
            /*
            let rAasset = {
                Token: assetInfo.symbol
            }
            let assetString = this.token_to_string(rAasset);
            let [isXCMAssetFound, standardizedXCMInfo] = indexer.getStandardizedXCMAssetInfo(chainID, assetString, rawAssetString)
            */
            let eventIndex = e.eventID.split('-')[3]
            //if (this.debugLevel >= paraTool.debugTracing) console.log(`processAssetIssued`, fromAddress, amountReceived, targetedSymbol)
            if (paraTool.validAmount(amountReceived)) {
                let caller = `generic processIncomingAssetSignal assets:Issued`
                candidate = {
                    chainIDDest: chainID,
                    eventID: `${chainID}-${extrinsicID}-${eventIndex}`,
                    extrinsicID: extrinsicID,
                    pallet: pallet,
                    method: method,
                    fromAddress: fromAddress,
                    blockNumberDest: this.parserBlockNumber,
                    sentAt: this.parserWatermark,
                    relayChain: relayChain,
                    xcmSymbol: targetedSymbol,
                    xcmInteriorKey: targetedXcmInteriorKey,
                    destTS: this.parserTS,
                    amountReceived: amountReceived,
                    msgHash: mpState.msgHash,
                }
                return [candidate, caller]
            } else {
                // TODO: log
            }
        }
        return [false, false]
    }

    processEqBalanceSignal(indexer, extrinsicID, e, mpState, finalized = false) {
        /*
        data": [
          101,
          "p8DR3iQJe3tN8RXizq3TnH3LfHCU7e7PNQ9zTwfAj7RFzExL9",
          96000000
        ]
        data: [
          '0xa922fef94566104a6e5a35a4fcddaa9f',
          '0x21E67e31Cd2FbE33DA93443B93507841C657C044',
          144975036571423
        ]
        */
        //console.log(`assets(Issued) detected`, e)
        let candidate = false
        let [pallet, method] = indexer.parseEventSectionMethod(e)
        let palletMethod = `${pallet}(${method})`
        let d = e.data;
        let fromAddress = paraTool.getPubKey(d[1])
        let chainID = indexer.chainID
        /*
        let assetIDWithComma = paraTool.toNumWithComma(paraTool.dechexAssetID(d[0]))
        let assetID = this.cleanedAssetID(assetIDWithComma)

        let parsedAsset = {
            Token: assetID
        }
        let rawAssetString = this.token_to_string(parsedAsset);
        */
        let relayChain = indexer.relayChain
        let targetedSymbol = this.processXcmGenericCurrencyID(indexer, d[0], chainID) //inferred approach
        let targetedXcmInteriorKey = indexer.check_refintegrity_xcm_signal(targetedSymbol, "processXcmGenericCurrencyID", palletMethod, d[0])

        //TODO: not sure here..
        //let assetString = this.processGenericCurrencyID(indexer, d[0], chainID);
        //let rawAssetString = this.processRawGenericCurrencyID(indexer, d[0], chainID);
        //let parsedAsset = JSON.parse(assetString)
        // let assetInfo = this.getSynchronizedAssetInfo(indexer, parsedAsset, chainID)
        if (targetedSymbol != undefined && targetedSymbol != false) {
            let amountReceived = paraTool.dechexToInt(d[2])
            /*
            let rAasset = {
                Token: assetInfo.symbol
            }
            let assetString = this.token_to_string(rAasset);
            let [isXCMAssetFound, standardizedXCMInfo] = indexer.getStandardizedXCMAssetInfo(chainID, assetString, rawAssetString)
            */
            let eventIndex = e.eventID.split('-')[3]
            //if (this.debugLevel >= paraTool.debugTracing) console.log(`processAssetIssued`, fromAddress, amountReceived, targetedSymbol)
            if (paraTool.validAmount(amountReceived)) {
                let caller = `generic processIncomingAssetSignal assets:Issued`
                candidate = {
                    chainIDDest: chainID,
                    eventID: `${chainID}-${extrinsicID}-${eventIndex}`,
                    extrinsicID: extrinsicID,
                    pallet: pallet,
                    method: method,
                    fromAddress: fromAddress,
                    blockNumberDest: this.parserBlockNumber,
                    sentAt: this.parserWatermark,
                    relayChain: relayChain,
                    xcmSymbol: targetedSymbol,
                    xcmInteriorKey: targetedXcmInteriorKey,
                    destTS: this.parserTS,
                    amountReceived: amountReceived,
                    msgHash: mpState.msgHash,
                }
                return [candidate, caller]
            } else {
                // TODO: log
            }
        }
        return [false, false]
    }

    processEqBalancesSignal(indexer, extrinsicID, e, mpState, finalized = false) {
        /*
        2011-1731397-0-3
        data: [
          "cg5aZF2X3nFrzL7Wch4XoNqJXyczHDmfofK8MKweGkF2WN4Jf",
          6582132,
          16436554,
          "XcmPayment" // "XcmTransfer"
        ]
        */
        let eqAssetMap = JSON.parse('{"25969":{"symbol":"EQ","assetId":"25969","decimals":9},"6382433":{"symbol":"ACA","assetId":"6382433","decimals":12},"6450786":{"symbol":"BNB","assetId":"6450786","decimals":9},"6450787":{"symbol":"BNC","assetId":"6450787","decimals":12},"6517365":{"symbol":"CRU","assetId":"6517365","decimals":12},"6582132":{"symbol":"DOT","assetId":"6582132","decimals":10},"6648164":{"symbol":"EQD","assetId":"6648164","decimals":9},"1634956402":{"symbol":"ASTR","assetId":"1634956402","decimals":18},"1635087204":{"symbol":"AUSD","assetId":"1635087204","decimals":12},"1651864420":{"symbol":"BUSD","assetId":"1651864420","decimals":9},"1735159154":{"symbol":"GLMR","assetId":"1735159154","decimals":18},"1768060003":{"symbol":"IBTC","assetId":"1768060003","decimals":8},"1768846450":{"symbol":"INTR","assetId":"1768846450","decimals":10},"1819309104":{"symbol":"LPT0","assetId":"1819309104","decimals":9},"1819309105":{"symbol":"LPT1","assetId":"1819309105","decimals":9},"1885434465":{"symbol":"PARA","assetId":"1885434465","decimals":12},"1970496628":{"symbol":"USDT","assetId":"1970496628","decimals":6},"2019848052":{"symbol":"XDOT","assetId":"2019848052","decimals":9},"426883035443":{"symbol":"CD613","assetId":"426883035443","decimals":10},"426883100980":{"symbol":"CD714","assetId":"426883100980","decimals":10},"426883166517":{"symbol":"CD815","assetId":"426883166517","decimals":10},"435694104436":{"symbol":"EQDOT","assetId":"435694104436","decimals":9},"470171350120":{"symbol":"MXETH","assetId":"470171350120","decimals":18},"517081101362":{"symbol":"XDOT2","assetId":"517081101362","decimals":9},"517081101363":{"symbol":"XDOT3","assetId":"517081101363","decimals":9},"120364133999715":{"symbol":"MXUSDC","assetId":"120364133999715","decimals":6},"120364166444131":{"symbol":"MXWBTC","assetId":"120364166444131","decimals":8}}')

        let candidate = false
        let [pallet, method] = indexer.parseEventSectionMethod(e)
        let palletMethod = `${pallet}(${method})`
        let d = e.data;
        let fromAddress = paraTool.getPubKey(d[0])
        let chainID = indexer.chainID
        /*
        let assetIDWithComma = paraTool.toNumWithComma(paraTool.dechexAssetID(d[0]))
        let assetID = this.cleanedAssetID(assetIDWithComma)

        let parsedAsset = {
            Token: assetID
        }
        let rawAssetString = this.token_to_string(parsedAsset);
        */
        let relayChain = indexer.relayChain
        let currencyID = d[1]
        /*
        let targetedSymbol = this.processXcmGenericCurrencyID(indexer, currencyID, chainID) //inferred approach
        let targetedXcmInteriorKey = indexer.check_refintegrity_xcm_signal(targetedSymbol, "processXcmGenericCurrencyID", palletMethod, currencyID)
        */
        let targetedXcmInteriorKey = false
        let amountReceivedDecimals = paraTool.dechexToInt(d[2]);
        let candidateType = d[3]
        let decimals = 9
        let targetedSymbol = false
        if (eqAssetMap[currencyID] != undefined) {
            decimals = eqAssetMap[currencyID].decimals
            targetedSymbol = eqAssetMap[currencyID].symbol
        }
        if (decimals > 9) {
            let factor = decimals - 9;
            amountReceivedDecimals *= 10 ** (factor);
        } else if (decimals < 9) {
            let factor = 9 - decimals;
            amountReceivedDecimals /= 10 ** (factor);
        }
        console.log(`currencyID=${currencyID}, decimals=${decimals}, symbol=${targetedSymbol}`)
        if (targetedSymbol != undefined && targetedSymbol != false) {
            let amountReceived = paraTool.dechexToInt(d[2])

            /*
            let rAasset = {
                Token: assetInfo.symbol
            }
            let assetString = this.token_to_string(rAasset);
            let [isXCMAssetFound, standardizedXCMInfo] = indexer.getStandardizedXCMAssetInfo(chainID, assetString, rawAssetString)
            */
            let eventIndex = e.eventID.split('-')[3]
            if (this.debugLevel >= paraTool.debugInfo) console.log(`processAssetIssued`, fromAddress, amountReceived, targetedSymbol)
            if (paraTool.validAmount(amountReceivedDecimals)) {
                let caller = `generic processIncomingAssetSignal eqBalances:Deposit`
                candidate = {
                    chainIDDest: chainID,
                    eventID: `${chainID}-${extrinsicID}-${eventIndex}`,
                    extrinsicID: extrinsicID,
                    pallet: pallet,
                    method: method,
                    fromAddress: fromAddress,
                    blockNumberDest: this.parserBlockNumber,
                    sentAt: this.parserWatermark,
                    relayChain: relayChain,
                    xcmSymbol: targetedSymbol,
                    xcmInteriorKey: targetedXcmInteriorKey,
                    destTS: this.parserTS,
                    amountReceived: amountReceivedDecimals,
                    msgHash: mpState.msgHash,
                    candidateType: candidateType
                }
                return [candidate, caller]
            } else {
                // TODO: log
            }
        }
        return [false, false]
    }

    //use currencyIDInfo for backup search -- OK all funcs are covered
    getSynchronizedAssetInfo(indexer, parsedAsset, chainID) {
        var asset = JSON.stringify(parsedAsset);
        //console.log(`getAssetInfo `, parsedAsset, asset, chainID)
        let assetChain = paraTool.makeAssetChain(asset, chainID);
        //console.log(`** assetChain=${assetChain}`, parsedAsset, asset, chainID)
        let cachedAssetInfo = indexer.assetInfo[assetChain]
        //console.log(`getSynchronizedAssetInfo chainID=${chainID} assetChain=${assetChain} cachedAssetInfo`, cachedAssetInfo)
        if (cachedAssetInfo !== undefined && cachedAssetInfo.decimals != undefined && cachedAssetInfo.assetType != undefined && cachedAssetInfo.symbol != undefined) {
            return (cachedAssetInfo);
        }
        //cachedAssetInfo via currencyID
        let cachedAssetInfo2 = indexer.getAssetByCurrencyID(asset, chainID)
        //console.log(`getAssetInfo cachedAssetInfo2 assetChain=${assetChain}`, cachedAssetInfo2)
        if (cachedAssetInfo2 !== undefined && cachedAssetInfo2.decimals != undefined && cachedAssetInfo2.assetType != undefined && cachedAssetInfo2.symbol != undefined) {
            return (cachedAssetInfo2);
        }
        if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`parsedAsset not found --skip key=[${assetChain}]`)
    }

    cleanedAssetID(assetID) {
        let rawAssetID = paraTool.toNumWithoutComma(assetID)
        return rawAssetID
    }

    setAssetSymbolAndDecimals(indexer, assetID, out = {}) {
        let chainID = indexer.chainID
        if (assetID == undefined) {
            //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`FATAL! assetID undefined`)
        }
        let parsedAsset = {
            Token: assetID
        }
        out.asset = assetID
        let cachedAssetInfo = this.getSynchronizedAssetInfo(indexer, parsedAsset, chainID)
        if (cachedAssetInfo != undefined && cachedAssetInfo.decimals != undefined) {
            out.decimals = cachedAssetInfo.decimals
        } else {
            //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`setAssetSymbolAndDecimals ${assetID} decimals not found`)
            out.decimals = 12
        }
        if (cachedAssetInfo != undefined && cachedAssetInfo.decimals != undefined) {
            out.decoratedAsset = {
                Token: cachedAssetInfo.symbol
            }
            out.symbol = cachedAssetInfo.symbol
        } else {
            //if (this.debugLevel >= paraTool.debugErrorOnly) console.log(`setAssetSymbolAndDecimals ${assetID} symbol not found`)
            out.decoratedAsset = {
                Token: `unknown-${assetID}`
            }
        }
    }


    getDecorateOption(decorateExtra) {
        if (Array.isArray(decorateExtra)) {
            let decorateData = decorateExtra.includes("data")
            let decorateAddr = decorateExtra.includes("address")
            let decorateUSD = decorateExtra.includes("usd")
            let decorateRelated = decorateExtra.includes("related")
            return [decorateData, decorateAddr, decorateUSD, decorateRelated]
        } else if (decorateExtra == true) {
            // remove this once ready
            return [true, true, true, true]
        } else {
            return [true, true, true, false]
        }
    }

    isObject(val) {
        return (typeof val === 'object');
    }

    async decorate_query_params(query, pallet_method, args, chainID, ts, decorate = true, decorateExtra = ["data", "address", "usd", "related"]) {
        let [decorateData, decorateAddr, decorateUSD, decorateRelated] = this.getDecorateOption(decorateExtra)
        switch (pallet_method) {
            case "crowdloan:contribute":
                if (decorate) await query.decorateArgsParainfo(args, "index", chainID);
                if (decorate) await query.decorateArgsChainAsset(args, "value", chainID, ts, decorateUSD)
                break;
            case "crowdloan:addMemo":
                break;
            case "balances:transfer":
            case "balances:transferKeepAlive":
                if (decorate) await query.decorateArgsChainAsset(args, "value", chainID, ts, decorateUSD)
                break;
            case "balances:transferAll":
                break;
            case "xcmPallet:reserveTransferAssets":
            case "xcmPallet:limitedTeleportAssets":
                if (decorate) await query.decorateArgsAssets(args, "assets", chainID, ts, decorateUSD)
                break;
            case "system:remark":
            case "system:remarkWithEvent":
                if (decorate) await query.decorateArgsRemark(args, "remark")
                break;
            case "identity:setIdentity":
                if (decorate) await query.decorateArgsInfo(args, "info");
                break;
            case "currencies:transfer":
                if (decorate) await query.decorateArgsChainAsset(args, "amount", chainID, ts, decorateUSD)
                break;
            case "staking:nominate":
                break;
            case "staking:bond":
                if (decorate) await query.decorateArgsChainAsset(args, "value", chainID, ts, decorateUSD)
                break;
            case "staking:unbond":
                if (decorate) await query.decorateArgsChainAsset(args, "value", chainID, ts, decorateUSD)
                break;
            case "staking:bondExtra":
                if (decorate) await query.decorateArgsChainAsset(args, "max_additional", chainID, ts, decorateUSD)
                break;
            case "timestamp:set":
                await query.decorateArgsTS(args, "now")
                break;
        }

        // for any key with an "id" attribute...
        try {
            for (const k of Object.keys(args)) {
                if (args[k].id != undefined) {
                    let id = args[k].id;
                    let address = paraTool.getPubKey(id)
                    if (address) {
                        args[k]['idAddress'] = address
                        if (decorate) query.decorateAddress(args[k], "idAddress", decorateAddr, decorateRelated)
                    }
                }
            }
        } catch {
            // don't worry ...
        }
    }

    decode_s_internal_raw(call_s, apiAt) {
        //fetch method, section when human is not set
        let callIndex = call_s.callIndex
        let [method, section] = this.getMethodSection(callIndex, apiAt)
        let f = {
            callIndex: callIndex,
            section: section,
            method: method,
            args: call_s.args
        }
        return f
    }

    getMethodSection(callIndex, apiAt) {
        try {
            var {
                method,
                section
            } = apiAt.registry.findMetaCall(paraTool.hexAsU8(callIndex))
            return [method, section]
        } catch (e) {
            //console.log(`getMethodSection unable to decode ${callIndex}`)
        }
        return [null, null]
    }

    recursive_batch_all(call_s, apiAt, extrinsicHash, extrinsicID, lvl = '', remarks = {}) {
        if (call_s && call_s.args.calls != undefined) {
            for (let i = 0; i < call_s.args.calls.length; i++) {
                let callIndex = call_s.args.calls[i].callIndex
                let [method, section] = this.getMethodSection(callIndex, apiAt)
                let ff = {
                    callIndex: callIndex,
                    section: section,
                    method: method,
                    args: call_s.args.calls[i].args
                }
                let pallet_method = `${ff.section}:${ff.method}`
                if (pallet_method == 'system:remarkWithEvent' || pallet_method == 'system:remark') {
                    if (ff.args.remark != undefined) {
                        remarks[ff.args.remark] = 1
                    }
                }
                let o = `call ${lvl}-${i}`
                // console.log(`\t${o} - ${pallet_method}`)
                if (ff.args.call != undefined) {
                    //recursively decode opaque call
                    let s = " ".repeat()
                    //console.log(`\t${" ".repeat(o.length+2)} - additional 'call' argument found`)
                    this.decode_opaque_call(ff, apiAt, extrinsicHash, extrinsicID, `${lvl}-${i}`, remarks)
                }
                this.recursive_batch_all(ff, apiAt, extrinsicHash, extrinsicID, `${lvl}-${i}`, remarks)
                call_s.args.calls[i] = ff
            }
            //console.log("recursive_batch_all done")
        } else {
            //sudo:sudoAs case
            if (call_s && call_s.args.call != undefined) {
                //console.log(`${extrinsicHash}`, 'call only', innerexs)
                this.decode_opaque_call(call_s, apiAt, extrinsicHash, extrinsicID, `${lvl}`, remarks)
            } else {
                //console.log("recursive_batch_all no more loop")
            }
        }
    }

    decodeDestination_call(apiAt, opaqueCall = '0x010008240533ee7b029e9570efca80a60d167584b74771741a064d07134be65ace2c10ca4192b91f5f31130000e8890423c78a01010800241333ee7b029e9570efca80a60d167584b747e41a900b94e647d7106899ca303b2f07cdd53f95130000e8890423c78a', lvl = '', remarks = []) {
        let res = {}
        let extrinsicHash = ''
        let extrinsicID = ''
        let extrinsicCall = false;
        try {
            // cater for an extrinsic input...
            extrinsicCall = apiAt.registry.createType('Call', opaqueCall);
            //console.log("d decoded opaqueCall", extrinsicCall.toString())
            let innerexs = JSON.parse(extrinsicCall.toString());
            let innerOutput = {}
            try {
                // only utility batch will have struct like this
                if (innerexs && innerexs.args.calls != undefined) {
                    this.recursive_batch_all(innerexs, apiAt, extrinsicHash, extrinsicID, lvl, remarks)
                }
                if (innerexs && innerexs.args.call != undefined) {
                    //console.log(`${extrinsicHash}`, 'call only', innerexs)
                    this.decode_opaque_call(innerexs, apiAt, extrinsicHash, extrinsicID, `${lvl}`, remarks)
                }
                innerOutput = this.decode_s_internal_raw(innerexs, apiAt)
                //console.log(`${extrinsicHash}`, 'innerexs', innerexs)
                let innerOutputPV = `${innerOutput.section}:${innerOutput.method}`
                //console.log(`${extrinsicHash}`, 'innerOutput', innerOutput)
                if (innerOutputPV == 'system:remarkWithEvent' || innerOutputPV == 'system:remark') {
                    if (innerOutput.args.remark != undefined) {
                        remarks[innerOutput.args.remark] = 1
                    }
                }
            } catch (err1) {
                //console.log(`* [${extrinsicID}] ${extrinsicHash} try errored`, err1)
            }

            //console.log("innerexs", JSON.stringify(innerexs))

            res = innerOutput //this line update the f
            //console.log("innerOutput", JSON.stringify(innerOutput))

        } catch (e) {
            console.log(`* [${extrinsicID}] ${extrinsicHash} try errored`, e)
        }
        return res
    }

    //this is right the level above args
    decode_opaque_call(f, apiAt, extrinsicHash, extrinsicID, lvl = '', remarks = []) {
        //console.log(`${extrinsicHash}`, 'decode_opaque_call', f)
        if (f.args.call != undefined) {
            let opaqueCall = f.args.call
            let extrinsicCall = false;
            let isHexEncoded = (typeof opaqueCall === 'object') ? false : true
            //console.log(`d opaqueCall(hexEncoded=${isHexEncoded})`, opaqueCall)
            if (isHexEncoded) {
                try {
                    // cater for an extrinsic input...
                    extrinsicCall = apiAt.registry.createType('Call', opaqueCall);
                    //console.log("d decoded opaqueCall", extrinsicCall.toString())

                    let innerexs = JSON.parse(extrinsicCall.toString());
                    let innerOutput = {}
                    try {
                        // only utility batch will have struct like this
                        if (innerexs && innerexs.args.calls != undefined) {
                            this.recursive_batch_all(innerexs, apiAt, extrinsicHash, extrinsicID, lvl, remarks)
                        }
                        if (innerexs && innerexs.args.call != undefined) {
                            //console.log(`${extrinsicHash}`, 'call only', innerexs)
                            this.decode_opaque_call(innerexs, apiAt, extrinsicHash, extrinsicID, `${lvl}`, remarks)
                        }
                        innerOutput = this.decode_s_internal_raw(innerexs, apiAt)
                        //console.log(`${extrinsicHash}`, 'innerexs', innerexs)
                        let innerOutputPV = `${innerOutput.section}:${innerOutput.method}`
                        //console.log(`${extrinsicHash}`, 'innerOutput', innerOutput)
                        if (innerOutputPV == 'system:remarkWithEvent' || innerOutputPV == 'system:remark') {
                            if (innerOutput.args.remark != undefined) {
                                remarks[innerOutput.args.remark] = 1
                            }
                        }
                    } catch (err1) {
                        //console.log(`* [${extrinsicID}] ${extrinsicHash} try errored`, err1)
                    }

                    //console.log("innerexs", JSON.stringify(innerexs))

                    f.args.call = innerOutput //this line update the f
                    //console.log("innerOutput", JSON.stringify(innerOutput))

                } catch (e) {
                    console.log(`* [${extrinsicID}] ${extrinsicHash} try errored`, e, f)
                }
            } else {
                //This is the proxy:proxy case - where api has automatically decoded the "call"
                if (f.args.call.callIndex != undefined) {
                    let call_ss = f.args.call
                    let call_s = this.decode_s_internal_raw(call_ss, apiAt)
                    let call_sPV = `${call_s.section}:${call_s.method}`
                    //console.log(`call_sPV`, call_sPV)
                    if (call_sPV == 'system:remarkWithEvent' || call_sPV == 'system:remark') {
                        if (call_s.args.remark != undefined) {
                            remarks[call_s.args.remark] = 1
                        }
                    }
                    this.recursive_batch_all(call_s, apiAt, extrinsicHash, extrinsicID, lvl, remarks)
                    f.args.call = call_s
                }
                //console.log(`* [${extrinsicID}] ${extrinsicHash} already decoded opaqueCall`, extrinsicCall.toString())
            }
        }
    }

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
                //id: paraTool.getPubKey(address)
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

    calculateMultilocationDerivative(apiAt, paraID = null, address = null, namedNetwork = 'Any') {
        let multilocationStruct = this.make_multilocation(paraID, address, namedNetwork)
        const multilocation = apiAt.createType('XcmV1MultiLocation', multilocationStruct)
        const toHash = new Uint8Array([
            ...new Uint8Array([32]),
            ...new TextEncoder().encode('multiloc'),
            ...multilocation.toU8a(),
        ]);
        // TODO: remove api dependency for hash
        const DescendOriginAddress20 = u8aToHex(apiAt.registry.hash(toHash).slice(0, 20));
        const DescendOriginAddress32 = u8aToHex(apiAt.registry.hash(toHash).slice(0, 32));
        //const DescendOriginAddress32 = paraTool.blake2_256_from_hex(paraTool.u8aAsHex(toHash))
        //const DescendOriginAddress20 = DescendOriginAddress32.slice(0, 42)
        console.log("calculateMultilocationDerivative", multilocation.toString(), DescendOriginAddress20, DescendOriginAddress32);
        // multilocation {"parents":1,"interior":{"x2":[{"parachain":1000},{"accountKey20":{"network":{"any":null},"key":"0x44236223ab4291b93eed10e4b511b37a398dee55"}}]}}
        // 20 byte: 0x5c27c4bb7047083420eddff9cddac4a0a120b45c
        // 32 byte: 0x5c27c4bb7047083420eddff9cddac4a0a120b45cdfa7831175e442b8f14391aa
        return [DescendOriginAddress20, DescendOriginAddress32]
    }

}