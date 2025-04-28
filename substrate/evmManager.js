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
const ethTool = require("./ethTool");
const mysql = require("mysql2");

//let debugMethodIDs = []
//let debugTopics = []
let debugMethodIDs = ['0x00000000', '0xeb672419', '0x3fe317a6']
let debugTopics = ["0x4264ac208b5fde633ccdd42e0f12c3d6d443a4f3779bbf886925b94665b63a22", "0x6bacc01dbe442496068f7d234edd811f1a5f833243e0aec824f86ab861f3c90d", "0x9d9af8e38d66c62e2c12f0225249fd9d721c54b83f48d9352c97c6cacdcb6f31", "0x7724394874fdd8ad13292ec739b441f85c6559f10dc4141b8d4c0fa4cbf55bdb", "0x26464d64ddb13f6d187de632d165bd1065382ec0b66c25c648957116e7bc25c8", "0x9592d37825c744e33fa80c469683bbd04d336241bb600b574758efd182abe26a", "0xdb80dd488acf86d17c747445b0eabb5d57c541d3bd7b6b87af987858e5066b2b", "0x4531cd5795773d7101c17bdeb9f5ab7f47d7056017506f937083be5d6e77a382", "0x4531cd5795773d7101c17bdeb9f5ab7f47d7056017506f937083be5d6e77a382", "0x61cbb2a3dee0b6064c2e681aadd61677fb4ef319f0b547508d495626f5a62f64", "0x94effa14ea3a1ef396fa2fd829336d1597f1d76b548c26bfa2332869706638af", "0x892cd8f5b436bd5fb7dac1f11aafb73345d892ba3e9fe09cd94d95ba84928e73", "0x34c73884fbbb790762253ae313e57da96c00670344647f0cb8d41ee92b9f1971", "0xda3e33974bbf2831f9e3fc7b8b26063a80f531c6e04fdd9a2f0517d127e9cfa0", "0x70b68cf6c199ef99e5b5c7d28a773f57ef282d13d444778e515cb4f37f298a03", "0x0029c0b4d760ad1c766c10bcd447eb6426e49a6f1aab829f0611fc7476f1c293", "0x3ac0594a85a20354f9dc74f33728416d19ce00d04a406c108cc2dcf2cecea134", "0x9b40a0c04afa8f9eef3f1ebc97daec669a2656167be57934841f15a47754564e", "0x4fd86e42fdf9189d86bda34d3e693c24264ea2b54ff7796d9e1d40f5e29f4f59", "0xa0ac5e19ca3a09af9a3a13c5c51f911c89eefd4b9eb548f4766b991b14ad6868", "0xff64d41f60feb77d52f64ae64a9fc3929d57a89d0cc55728762468bae5e0fe52", "0x4ae4bd7655e0d350876a23cd90c4227b13db560e34435c6a488150a9c844bf5f", "0x5149f98486ba112b96c3a141a926691732ea47e97d0a37c608dcef72731e7a6d", "0x8a274cdd629b9aae599b13d8bfee3ee4a15350b0386a9b64087a393db0093767", "0x2a89b2e3d580398d6dc2db5e0f336b52602bbaa51afa9bb5cdf59239cf0d2bea", "0x817d4bff561141beb16b2903ff5c3bc3b859a140279ddf19b1dad22614dd1d75", "0x0178be5ff07ff0255343266c94130c9a7c518cf8ba70cbf6198cfb3572ab9d3f", "0x3c70af01296aef045b2f5c9d3c30b05d4428fd257145b9c7fcd76418e65b5980", "0x9f402f3b81cd8d17326941e3a09e87466236a430fb9e931fa23f4f8dcd111cac", "0x4c1d1fdebe46d255ef3bfcbd19dbe80241f155dfb8de9fdacc068866c96f6464", "0xaad3ec96b23739e5c653e387e24c59f5fc4a0724c18ad1970feb0d1444981fac", "0x452a344f03203071e1daf66e007976c85cb2380deabf1c91f3c4fb1fca412049", "0xbf2ed60bd5b5965d685680c01195c9514e4382e28e3a5a2d2d5244bf59411b93", "0xc55b6bb707fbeb19bbc0b1fc0871714c9120ab58914214a91a400a29756681c7", "0xcfaaa26691e16e66e73290fc725eee1a6b4e0e693a1640484937aac25ffb55a4", "0xd9dc24857f317ed9abbbb42e920ede0104231eb1d3d70236a74887ffaf159868", "0xe2bbb158ea830e9efa91fa2a38c9708f9f6109a6c571d6a762b53a83776a3d67", "0xf06a29c94c6f4edc1085072972d9441f7603e81c8535a308f214285d0653c850", "0xf8a8fd6dd9544ca87214e80c840685bd13ff4682cacb0c90821ed74b1d248926"]


module.exports = class EvmManager extends PolkaholicDB {

    //evm
    contractABIs = {};
    constructor(debugLevel = false) {
        super()
    }

    async initContractABIs(isEVM = true) {
        this.contractABIs = await crawler.getContractABI();
    }

    buildSchemaInfoFromFingerprintID(methodSignature, fingerprintID) {
        let schemaInfo = false
        let foundApi = this.contractABIs[fingerprintID]
        if (foundApi) {
            let methodSignature = foundApi.signature
            let methodSignatureFull = foundApi.signature_full
            let methodABIStr = foundApi.abi
            if (methodABIStr == undefined || methodABIStr == null) {
                let abiType = (fingerprintID && fingerprintID.length == 10) ? 'function' : 'event'
                if (abiType == 'function') {
                    methodABIStr = ethTool.generateFunctionABI(abiType)
                } else {
                    methodABIStr = ethTool.generateEventABI(abiType)
                }
            }
            let schema = ethTool.createEvmSchema([methodABIStr], fingerprintID)
            let schemaType = (fingerprintID && fingerprintID.length == 10) ? 'call' : 'evt'
            let schemaInfo = {
                fingerprintID: fingerprintID,
                schemaType: schemaType,
                schema: schema
            }
            return schemaInfo
        }
        return schemaInfo
    }

    decodeReceipt(r) {
        // shallow copy throws error here... not sure why?
        //let res = JSON.parse(JSON.stringify(r))
        //console.log(`decodeReceipt r`, r)
        var res = Object.assign({}, r);
        if (!res) return;
        if (res.logs) {
            res.decodedLogs = res.logs.map((log) => {
                let dLog = this.decodeLog(log)
                let topic0 = log.topics[0]
                if (debugTopics.includes(topic0)) {
                    console.log(`DEBUG Topic=${topic0}`, log, JSON.stringify(dLog, null, 2))
                }
                return dLog
            })
            delete res.logs;
        }
        let transfers = []
        let swaps = []
        let syncs = []
        let transferActions = [] //todo
        for (let i = 0; i < res.decodedLogs.length; i++) {
            let dLog = res.decodedLogs[i]

            if (dLog.decodeStatus == "success") {
                //console.log(`dLog success case ***`, dLog)
                let transfer = ethTool.categorizeTokenTransfers(dLog)
                if (transfer) {
                    transfers.push(transfer)
                    continue
                }
                let swap = ethTool.categorizeTokenSwaps(dLog)
                if (swap) {
                    swaps.push(swap)
                    continue
                }
            } else if (dLog.decodeStatus == "error") {
                console.log(`dLog Error case ***`, dLog)
            } else if (dLog.decodeStatus == "error") {
                console.log(`dLog Unknown case ***`, dLog)
            }
        }
        res.transfers = transfers
        res.swaps = swaps
        //res.syncs = syncs
        res.contractAddress = r.contractAddress
        return res
    }

    decodeTransaction(txn) {
        //etherscan is marking native case as "Trafer"
        //let contractcreationAddress = (txn.creates != undefined) ? txn.creates : false
        let output = txn
        //TODO: need to handle both RPC and WS format
        let decodedTxnInput = this.decodeTransactionInput(txn)
        if (decodedTxnInput.decodeStatus == "success") {
            //console.log(`decodedTxnInput success case ***`, decodedTxnInput)
        } else if (decodedTxnInput.decodeStatus == "unknown") {
            console.log(`decodedTxnInput unknown case ***`, decodedTxnInput)
        } else if (decodedTxnInput.decodeStatus == "error") {
            console.log(`decodedTxnInput Error case ***`, decodedTxnInput)
        }
        if (decodedTxnInput && debugMethodIDs.includes(decodedTxnInput.methodID)) {
            console.log(`DEBUG methodID=${decodedTxnInput.methodID}`, txn, JSON.stringify(decodedTxnInput, null, 2))
        }
        output.decodedInput = decodedTxnInput
        return output
    }

    decodeLog(log) {
        let topics = log.topics
        let topic0 = topics[0]
        let lookupID = `${topic0}-${topics.length}`
        let res = {
            decodeStatus: "unknown",
            address: log.address,
            transactionLogIndex: (log.transactionLogIndex != undefined) ? log.transactionLogIndex : log.transactionIndex,
            logIndex: log.logIndex,
            data: log.data,
            topics: topics,
        }
        let r = this.contractABIs[lookupID];
        if (r) {
            res.signature = r.signature
            let isSynthetic = false
            let abi = r.abi
            let signatureFull = r.signature_full
            if (abi == undefined || abi == null) {
                res.decodeError = 'abi not found for known signature';
                abi = ethTool.generateEventABI(signatureFull)
                //console.log(`synthetic evnet abi`, abi)
            }
            try {
                var etherjsDecoder = ethTool.initEtherJsDecoder([abi])
                let decoded_raw = etherjsDecoder.decodeEventLog(topic0, log.data, log.topics);
                res.events = ethTool.processEthersDecodedRaw(abi, decoded_raw);
                res.decodeStatus = 'success';
                res.decodeError = null
                return res
            } catch (err) {
                if (isSynthetic) {
                    res.decodeError = `[synthetic] ${signatureFull} ${err.toString()}`
                } else {
                    res.decodeError = `${signatureFull} ${err.toString()}`
                }
            }
        } else {
            res.decodeError = 'unknown topic';
        }
        return res
    }

    decodeTransactionInput(txn) {
        let txInput = txn.input
        let methodID = (txInput.length >= 10) ? txInput.slice(0, 10) : null
        let res = {
            methodID,
            txInput,
            decodeStatus: 'unknown'
        };
        if (methodID) {
            let r = this.contractABIs[methodID]
            if (r) {
                if (debugMethodIDs.includes(methodID)) {
                    console.log(`debugMethodIDs methodID=${methodID}`, r)
                }
                res.signature = r.signature
                let isSynthetic = false
                let abi = r.abi
                let signatureFull = r.signature_full
                if (abi == undefined || abi == null) {
                    res.decodeError = 'abi not found for known signature';
                    abi = ethTool.generateFunctionABI(signatureFull)
                    //console.log(`synthetic function abi`, abi)
                }
                try {
                    var etherjsDecoder = ethTool.initEtherJsDecoder([abi])
                    var decoded_raw = etherjsDecoder.decodeFunctionData(methodID, txInput);
                    res.params = ethTool.processEthersDecodedRaw(abi, decoded_raw);
                    res.decodeStatus = 'success'
                    res.decodeError = null
                    return res;
                } catch (err) {
                    res.decodeStatus = "error"
                    if (isSynthetic) {
                        res.decodeError = `[synthetic] ${signatureFull} ${err.toString()}`
                    } else {
                        res.decodeError = `${signatureFull} ${err.toString()}`
                    }
                    console.log(`++++ ERROR ${txn.hash}`, res)
                    return res;
                }
            }
            res.decodeStatus = "unknown"
            res.decodeError = "unknown method"
            return res;
        }
        // native transfer case or contract creation
        res.decodeStatus = "success";
        if (txn.to == undefined) {
            res.signature = "contractCreation";
            res.contractAddress = null; // ??
            return res
        }
        res.signature = "nativeTransfer";
        return res
    }

    async processReceipts(evmReceipts) {
        let decodedReceipts = []
        // add logIndex to receipts
        let logIndexCnt = 0
        for (let i = 0; i < evmReceipts.length; i++) {
            let evmReceipt = evmReceipts[i]
            for (let j = 0; j < evmReceipt.logs; i++) {
                evmReceipt.logs[j].logIndex = logIndexCnt
                logIndexCnt++
            }
            evmReceipts[i] = evmReceipt
        }
        let recptAsync = await evmReceipts.map(async (receipt) => {
            try {
                return this.decodeReceipt(receipt)
            } catch (err) {
                console.log(`processReceipts ${receipt}`, err)
                return false
            }
        });
        let decodedReceiptsRes = await Promise.all(recptAsync);
        for (const dReceipt of decodedReceiptsRes) {
            let decodedLogs = dReceipt.decodedLogs
            decodedReceipts.push(dReceipt)
        }
        //console.log(`decodeReceipts`, decodedReceipts)
        return decodedReceipts
    }

    async processTransactions(txns) {
        let decodeTxns = []
        let txnsAsync = await txns.map(async (txn) => {
            try {
                return this.decodeTransaction(txn)
            } catch (err) {
                console.log(`processTransactions ${txns}`, err)
                return false
            }
        });
        let decodeTxnsRes = await Promise.all(txnsAsync);
        for (const dTxn of decodeTxnsRes) {
            decodeTxns.push(dTxn)
        }
        return decodeTxns
    }

    async transformBlock(r) {
        let rpcBlock = r.block
        let evmBlk = ethTool.standardizeRPCBlock(rpcBlock)
        let rpcReceipt = r.receipts
        let evmReceipts = ethTool.standardizeRPCReceiptLogs(rpcReceipt)
        var statusesPromise = Promise.all([
            this.processTransactions(evmBlk.transactions),
            this.processReceipts(evmReceipts)
        ])
        let [dTxns, dReceipts] = await statusesPromise
        //console.log(`transformBlock dTxns[${dTxns.length}]`, dTxns)
        //console.log(`transformBlock dReceipts[${dReceipts.length}]`, dReceipts)
        return [evmBlk, dTxns, dReceipts]
    }
}