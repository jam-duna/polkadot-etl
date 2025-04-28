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
const bs58 = require("bs58");
const {
    Keyring,
    decodeAddress,
    encodeAddress
} = require("@polkadot/keyring");
const {
    bnToBn,
    bnToHex,
    bnToU8a,
    hexToBn,
    hexToU8a,
    isHex,
    stringToU8a,
    u8aToHex,
    u8aConcat,
    hexToString,
    stringToHex
} = require("@polkadot/util");

const Big = require('big.js');
const Decimal = require('decimal.js');

const {
    signatureVerify,
    evmToAddress,
    addressToEvm,
    createKeyMulti,
    sortAddresses
} = require('@polkadot/util-crypto');

const sqlFormatter = require('sql-formatter')

const keyring = new Keyring({
    type: "sr25519",
    ss58Format: 2
});
const sha1 = require('sha1');
const Web3 = require("web3");
const web3 = new Web3();
const rlp = require('rlp')
const fs = require("fs");
const {
    XXHash32,
    XXHash64,
    XXHash3,
    XXHash128
} = require('xxhash-addon');
const {
    blake2AsHex,
    xxhashAsHex
} = require('@polkadot/util-crypto');

const {
    extractAuthor
} = require('@polkadot/api-derive/type/util')

const {
    ApiPromise,
} = require('@polkadot/api');

const assetChainSeparator = "~"

/*
function initPolkadorJSAPI() {
    if (apiParser) {
        console.log(`polkadot.js API already set`)
        return
    }
    ApiPromise.create().then((api) => {
        console.log(`setting polkadot.js once`)
        apiParser = api
    })
    return
}

async function initPolkadotAPI() {
    if (apiParser != undefined) {
        console.log(`polkadotjs already initiated`)
        return
    }
    var api = await ApiPromise.create()
    await api.isReady;
    apiParser = api
    console.log(`initiated polkadotjs api`)
}
*/

function sqrtPriceX96ToPriceWithDecimals(sqrtPriceX96, token0Decimals = 18, token1Decimals = 18) {
    var sqrtPriceX96BN = new Big(toIntegerStr(sqrtPriceX96))
    var sqar2X96BN = new Big('79228162514264337593543950336')
    var sqar2X192BN = new Big('6277101735386680763835789423207666416102355444464034512896')

    /*
    Method 1:
    price_token0_in_token1 = sqrtRatioX96 ** 2 / 2 ** 192
    var price_token0_in_token1 = sqrtPriceX96BN.pow(2).div(sqar2X192BN)

    We lose precision when doing BIG.div(BIG)  comparing to method2. No idea why
    */

    /*
    Method 2:
    sqrtPriceX96_decimal = sqrtPriceX96 / 2^96
    price_token0_in_token1 = (sqrtPriceX96_decimal ^ 2)
    */

    var sqrtPriceX96_decimal = sqrtPriceX96BN.div(sqar2X96BN)
    //console.log(`sqrtPriceX96_decimal ${sqrtPriceX96_decimal.toFixed()}`)
    var price_token0_in_token1 = sqrtPriceX96_decimal.pow(2)
    var decimalsAdj = new Big(10).pow(token0Decimals).div(new Big(10).pow(token1Decimals))
    return price_token0_in_token1.mul(decimalsAdj).toFixed()
}

function tickToPriceWithDecimals(tick, token0Decimals = 18, token1Decimals = 18) {
    let base = new Decimal(1.0001);
    let tickDecimal = new Decimal(tick);
    let decimalsDifference = new Decimal(token0Decimals - token1Decimals);
    let base10 = new Decimal(10);
    let decimalsAdj = base10.pow(decimalsDifference)
    let price = base.pow(tickDecimal).mul(decimalsAdj);
    return price.toFixed();
}

function isNumeric(str) {
    if (typeof str != "string") return false // we only process strings!
    return !isNaN(str) && // use type coercion to parse the _entirety_ of the string (`parseFloat` alone does not do this)...
        !isNaN(parseFloat(str)) // ...and ensure strings of whitespace fail
}

function q(inp) {
    return ("'" + inp + "'");
}

function toIntegerStr(n) {
    var b = bnToBn(n)
    return b.toString()
}

function toBn(n) {
    return bnToBn(n)
}

function dechexToInt(number) {
    if (number && typeof number == "string" && (number.length > 2) && number.substring(0, 2) == "0x") {
        return parseInt(number);
    }
    return parseInt(number)
}

function dechexToIntStr(number) {
    if (number && typeof number == "string" && (number.length > 2) && number.substring(0, 2) == "0x") {
        let n = hexToBn(number)
        return n.toString()
    }
    return `${number}`
}

function isInt(n) {
    return Number(n) === n && n % 1 === 0;
}

function isFloat(n) {
    return Number(n) === n && n % 1 !== 0;
}

function reverse_endian(hex) {
    return hex.match(/.{1,2}/g).reverse().join('')
}

// does not handle 1.0e+23 but does handle 123.45678987654321
function float_to_BigInt_decimals(f, decimals) {
    let fstr = f.toString();
    let e = fstr.indexOf("e");
    if (e > 0) {
        return null;
    }
    let i = fstr.indexOf(".");
    if (i == -1) {
        let bn = BigInt(fstr.padEnd(decimals + 1, "0"))
        let bnHex = bnToHex(bn)
        //let bnHex = bnToBn(bn)
        console.log(`${f}, ${decimals} -> ${bn} -> ${bnHex}`)
        return bnHex
    }
    // get everything before the decimal, then everything after the decimal, and then pad to decimals
    let bn = BigInt(fstr.substr(0, i) + fstr.substr(i + 1, fstr.length).padEnd(decimals, "0"));
    let bnHex = bnToHex(bn)
    //let bnHex = bnToBn(bn)
    console.log(`${f}, ${decimals} -> ${bn} -> ${bnHex}`)
    return bnHex;
}

function isString(s) {
    return (typeof s === 'string' || s instanceof String)
}

//see https://ethereum.stackexchange.com/questions/41506/web3-dealing-with-decimals-in-erc20
function toBaseUnit(value, decimals) {
    if (!isString(value)) {
        throw new Error('Pass strings to prevent floating point precision issues.')
    }
    let BN = web3.utils.BN
    const ten = new BN(10);
    const base = ten.pow(new BN(decimals));

    // Is it negative?
    let negative = (value.substring(0, 1) === '-');
    if (negative) {
        value = value.substring(1);
    }

    if (value === '.') {
        throw new Error(
            `Invalid value ${value} cannot be converted to` +
            ` base unit with ${decimals} decimals.`);
    }

    // Split it into a whole and fractional part
    let comps = value.split('.');
    if (comps.length > 2) {
        throw new Error('Too many decimal points');
    }

    let whole = comps[0],
        fraction = comps[1];

    if (!whole) {
        whole = '0';
    }
    if (!fraction) {
        fraction = '0';
    }
    if (fraction.length > decimals) {
        throw new Error('Too many decimal places');
    }

    while (fraction.length < decimals) {
        fraction += '0';
    }

    whole = new BN(whole);
    fraction = new BN(fraction);
    let wei = (whole.mul(base)).add(fraction);

    if (negative) {
        wei = wei.neg();
    }
    return new BN(wei.toString(10), 10);
}

function dechexAssetID(number) {
    //let numType = typeof (number)
    //console.log(`${number} Type:${numType}`)
    if ((number.length > 2) && number.substring(0, 2) == "0x") {
        let n = hexToBn(number)
        return n.toString()
    } else {
        return `${number}`;
    }
}

function parseBool(string) {
    if (string === 1 || string === 0) {
        return string === 1
    }
    try {
        switch (string.toLowerCase().trim()) {
            case "true":
            case "yes":
            case "1":
            case "t":
                return true;
            case "false":
            case "no":
            case "0":
            case "f":
            case null:
                return false;
            default:
                return false
        }
    } catch (e) {
        return false
    }

}

function toHex(bytes) {
    return (
        "0x" +
        bytes.reduce((str, byte) => str + byte.toString(16).padStart(2, "0"), "")
    );
}

function computeMultisig(caller, addresses, threshold) {

    let allAddrs = []
    allAddrs.push(get_pubkey(caller))

    for (const a of addresses) {
        allAddrs.push(get_pubkey(a))
    }
    allAddrs.sort();
    let multiAddress = createKeyMulti(allAddrs, threshold);
    let m = {
        threshold: threshold,
        multisigAddress: toHex(multiAddress),
        signatories: allAddrs,
        signatorycnt: allAddrs.length
    }
    return m
}

function getAuthor(digest, validators) {
    let author = extractAuthor(digest, validators)
    let authorPubkey = get_pubkey(author)
    return [author, authorPubkey]
}

function decode_systemAccountType(asciiName = 'modlpy/trsrycb:6664') {
    //para:2031
    //sibl:2000
    //modlpy/nopls:13312
    //modlpy/cfund:2094
    //trsry, nopl, cfund
    let groups = ["trsry", "nopl", "cfund", "sibl", "para", "trsy"]
    if (!asciiName.includes(':')) asciiName += ':'
    let r = {
        nickname: asciiName,
        isModlePy: false,
        systemAccountType: null,
        prefix: '',
        idx: null,
    }
    let pieces = asciiName.split(':')
    if (pieces.length == 2) {
        let firstPiece = pieces[0]
        let idx = pieces[1]
        if (idx != '') {
            r.idx = idx
        }
        if (firstPiece.includes('/')) {
            let p = firstPiece.split('/')
            if (p.length >= 2) {
                r.isModlePy = true
                let p1 = p[1]
                for (const c of groups) {
                    if (p1.includes(c)) {
                        r.systemAccountType = c
                        let prefix = p1.split(c)
                        r.prefix = prefix[1]
                    }
                }
            }
        } else {
            r.systemAccountType = firstPiece
        }
    }
    return r
}

function pubKey_hex2ascii(str) {
    if (typeof str != "string") return (null);
    let inp = (str.substring(0, 2) == "0x") ? str.substring(2) : str.substring(0);
    if (inp.length < 8) return (null);
    // 70617261 - para
    // 7369626c - sibl
    // 6d6f646c - modl
    let prefix = inp.substr(0, 8);
    if (prefix == "70617261" || prefix == "7369626c" || prefix == "6d6f646c") {} else return (null);
    let done = false;
    let out = "";
    let remaining = "";
    let j = inp.length;
    for (let i = j; i > 2; i -= 2) {
        let h = inp.substring(j - 2, j);
        let charCode = parseInt(h, 16);
        if (charCode == 0) {
            j = j - 2;
        } else {
            i = 0; // terminate
        }
    }
    for (let i = 0; i < j && (!done); i += 2) {
        let h = inp.substring(i, i + 2);
        let charCode = parseInt(h, 16);
        if ((charCode == 47) || (charCode >= 65 && charCode <= 90) || (charCode >= 97 && charCode <= 122)) {
            out += String.fromCharCode(charCode);
        } else {
            remaining = h + remaining;
        }
    }
    if (remaining.length > 0 && remaining.length <= 4) {
        out += ":" + parseInt(remaining, 16);
    }
    return (out);
}

//100150022 -> 100,150,022
function toNumWithComma(numb) {
    var str = numb.toString().split(".");
    str[0] = str[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return str.join(".");
}

//100,150,022 -> 100150022
function toNumWithoutComma(numb) {
    var str = numb.toString().split(".");
    str[0] = str[0].replace(/,/g, '')
    let res = str.join(".");
    if (isNaN(res)) {
        return numb
    } else {
        return res
    }
}

function getAvg(arr) {
    if (arr.length == 0) {
        return 0
    } else {
        return arr.reduce((p, c) => p + c) / arr.length
    }
}

function dtToTS(dt) {
    let dt2 = new Date(dt)
    return dt2.valueOf() / 1000
}

function getSum(arr) {
    if (arr.length == 0) {
        return 0
    } else {
        return arr.reduce((p, c) => p + c)
    }
}

//https://blockscout.moonbeam.network/blocks/221001/transactions
//eth frontier header {"parentHash":"0x64547fb5b03d218d8510c328b11d7ee4639f5cf6e1504aa2a6fbe1772af6161e","ommersHash":"0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347","beneficiary":"0xb3e64ef8fc9df438c9a54f4b189eddc1807b55a5","stateRoot":"0xa39ce439c1e3df9d548d975ffe4dde01d20f88c589d312e0ba735480671304b5","transactionsRoot":"0x82dc0ce6a21d855276668568ab2d98ab83dddfb7b978c47bff483823a3af89b8","receiptsRoot":"0x5bea5f91118ac331208e518a00cfb06f253d091aea82cff10aa53e6dbcf10b58","logsBloom":"0x043000000000020008000400800000402000020004000000020000020088000000010020900000020002000022000200080000000084000000000200002000000000008000000000000000080000002000000000000080000000001040000040028000000300000000008000000018000011000000000001000000102000020000000204000400000000000000000100040000000001000840400040000000000202004000000101000001000000102020020100000000001000000c000000c000018002800000400000000000001000020000000000001000000000040020000110200010000000000000000000000040000000408000122004020000000009","difficulty":0,"number":221001,"gasLimit":15000000,"gasUsed":532067,"timestamp":1642513176312,"extraData":"0x","mixHash":"0x0000000000000000000000000000000000000000000000000000000000000000","nonce":"0x0000000000000000"}
//expectedHash: 0x70a75c7e0fcf0fb9c658fa08457546e08adb032d859841cbf784c9558906180e
function compute_EVM_BlockHash(h) {
    let difficulty = (h.difficulty == 0) ? '0x' : web3.utils.toHex(h.gasUsed)
    let gasUsed = (h.gasUsed == 0) ? '0x' : web3.utils.toHex(h.gasUsed)

    let headerArr = [h.parentHash, h.ommersHash, h.beneficiary,
        h.stateRoot, h.transactionsRoot, h.receiptsRoot, h.logsBloom,
        difficulty, web3.utils.toHex(h.number), web3.utils.toHex(h.gasLimit), gasUsed, web3.utils.toHex(h.timestamp),
        h.extraData, h.mixHash, h.nonce
    ]
    //console.log(headerArr)
    //console.log(rlp.encode(headerArr).toString('hex'))
    let blockHash = web3.utils.keccak256(rlp.encode(headerArr))
    return blockHash
}

function parseSectionMethod(e) {
    if (e.module_name != undefined && e.module_function != undefined) {
        return [e.module_name, e.module_function]
    } else if (e.method != undefined && e.method.pallet != undefined) {
        return [e.method.pallet, e.method.method]
    } else {
        return [e.section, e.method]
    }
}

function is_transfer_event(pallet, method, data) {
    let pallet_method = `${pallet}:${method}`
    if (pallet_method == "balances:Transfer") return (true);
    return (false);
}

function get_address(pubKeyOrAddr, networkID = 0) {
    if (
        web3.utils.isHex(pubKeyOrAddr) &&
        pubKeyOrAddr.substr(0, 2).toLowerCase() != "0x"
    ) {
        return keyring.encodeAddress("0x" + pubKeyOrAddr, networkID);
    } else {
        return keyring.encodeAddress(pubKeyOrAddr, networkID);
    }
}

function get_pubkey(ss58Addr) {
    try {
        if (
            web3.utils.isHex(ss58Addr) &&
            ss58Addr.substr(0, 2).toLowerCase() != "0x"
        ) {
            var paddedPubkey = "0x" + ss58Addr;
            return toHex(keyring.decodeAddress(paddedPubkey));
        } else {
            return toHex(keyring.decodeAddress(ss58Addr));
        }
    } catch (e) {
        return (false);
    }
}

//derive H160 address from given pubKey
function pubkey_to_h160(pubkey) {
    return toHex(addressToEvm(pubkey))
}

//derive corresponding pubkey from H160 (correct)
function h160_to_pubkey(h160) {
    var ss58Addr = evmToAddress(h160)
    return get_pubkey(ss58Addr)
}

function h160_to_chain_address(h160, chainID = 5) {
    //var ss58Addr = evmToAddress(h160, dechexToInt(chainID), 'blake2')
    var ss58Addr = evmToAddress(h160)
    var addr = get_address(ss58Addr, dechexToInt(chainID))
    return addr
}

function pubkey_to_evm_ss58(pubkey, chainID = 5) {
    //var ss58Addr = evmToAddress(h160, dechexToInt(chainID), 'blake2')
    var ss58Addr = evmToAddress(pubkey_to_h160(pubkey))
    return get_address(ss58Addr, dechexToInt(chainID))
}


function blake2_256_from_hex(s) {
    let res = blake2AsHex(hexToU8a(s), 256)
    return res.slice(2)
}

function getBirth(current, r) {
    return Math.floor(
        (
            Math.max(bnToBn(current).toNumber(), r.phase.toNumber()) - r.phase.toNumber()
        ) / r.period.toNumber()
    ) * r.period.toNumber() + r.phase.toNumber();
}

function getDeath(current, r) {
    return getBirth(current) + r.period.toNumber();
}

function get_lifetime(current, r) {
    let birth = Math.floor(
        (
            Math.max(bnToBn(current).toNumber(), r.phase.toNumber()) - r.phase.toNumber()
        ) / r.period.toNumber()
    ) * r.period.toNumber() + r.phase.toNumber();
    let death = birth + r.period.toNumber();
    return [birth, death]
}

function lifetime(currentBN, periodBN, phaseBN) {
    let current = bnToBn(currentBN).toNumber()
    let period = bnToBn(periodBN).toNumber()
    let phase = bnToBn(phaseBN).toNumber()
    let birth = Math.floor(
        (
            Math.max(current, phase) - phase
        ) / period
    ) * period + phase;
    let death = birth + period;
    return [birth, death]
}

function decode_invertedTS(invertedTS) {
    let secondsToFuture = parseInt(invertedTS.substring(2), 16);
    let futureTS = 2 * 2145916800;
    let ts = futureTS - secondsToFuture
    return ts;
}

function inverted_ts_key(ts) {
    let futureTS = 2 * 2145916800;
    let secondsToFuture = Math.round((futureTS - ts));
    let out = "0x" + secondsToFuture.toString(16).padStart(8, "0");
    return out;
}

function audit_hashes_tx(tx) {
    // (0) determine whether it's substrateTx or Evm Tx
    if (tx.transactionHash != undefined) {
        return audit_evm_tx(tx)
    } else if (tx.extrinsicID != undefined) {
        return audit_substrate_tx(tx)
    } else {
        console.log(`unknown tx format`, tx)
        return (false);
    }
}

function audit_evm_tx(evmTx) {
    //todo: validate evmTX
    return true
}

function audit_substrate_tx(tx) {
    // (1) make sure section:method are present
    if (tx.section == undefined || tx.method == undefined) {
        console.log(`[${tx.extrinsicID}][${tx.extrinsicHash}] missing func section:method`)
        return false
    }
    // (2) check error decoration
    if (tx.err != undefined) {
        if (tx.err.module != undefined) {
            console.log(`[${tx.extrinsicID}][${tx.extrinsicHash}] undecorated error`, tx.err)
            return false
        }
        let errorStr = JSON.stringify(tx.err)
        if (errorStr.includes("errorID")) {
            console.log(`[${tx.extrinsicID}][${tx.extrinsicHash}] unknown error found`, tx.err)
        }
    }

    // (3) event check
    for (const evt of tx.events) {
        if (!audit_event_tx(evt)) {
            console.log(`[${tx.extrinsicID}][${tx.extrinsicHash}] event missing section:method`, evt)
            return false
        }
    }
    // (4) recursive args check
    let args = tx.params
    let res = audit_args_tx(tx, args)
    if (!res) {
        console.log(`[${tx.extrinsicID}][${tx.extrinsicHash}] audit failed`, tx.params)
        return false
    }
    return true
}

function audit_event_tx(e) {
    if (e.section == undefined || e.method == undefined) {
        console.log('missing section:method', e)
        return false
    }
    return true
}

function audit_args_tx(tx, args) {
    // there are call (proxy) and calls (utility)
    if (args !== undefined) {
        if (args.call !== undefined) {
            // the proxy route
            let c = args.call;
            if (c.callIndex !== undefined && (c.section == undefined || c.method == undefined)) {
                // missing section:method
                console.log(`[${tx.extrinsicID}][${tx.extrinsicHash}] call missing section:method`, c)
                return false
            } else {
                if (c.args != undefined) {
                    //recursive found..
                    //console.log("recursive args found from the call", c)
                    if (!audit_args_tx(tx, c.args)) {
                        console.log(`[${tx.extrinsicID}][${tx.extrinsicHash}] recursive args missing section:method`, c.args)
                        return false
                    }
                }
            }
        } else if (args.calls !== undefined) {
            // utility route
            let calls = args.calls;
            for (let i = 0; i < calls.length; i++) {
                let c = calls[i];
                if (c.callIndex !== undefined && (c.section == undefined || c.method == undefined)) {
                    console.log(`[${tx.extrinsicID}][${tx.extrinsicHash}] call missing section:method`, c)
                    return false
                } else {
                    if (c.args != undefined) {
                        //recursive found..
                        //console.log(`recursive args found from the calls[${i}]`, c)
                        if (!audit_args_tx(tx, c.args)) {
                            console.log(`[${tx.extrinsicID}][${tx.extrinsicHash}] calls[${i}] recursive args missing section:method`, c.args)
                            return false
                        }
                    }
                }
            }
        }
    } else {
        // missing args?
        console.log("missing args?", args);
        return false
    }
    return true
}

function unique(a) {
    return a.sort().filter(function(item, pos, ary) {
        return !pos || item != ary[pos - 1];
    });
}

function get_temp_id(chainID) {
    let relayChain = getRelayChainByChainID(chainID)
    let paraID = getParaIDfromChainID(chainID)
    let tempID = `${relayChain}`
    if (paraID != 0) {
        relayChain = relayChain.replace('-relay', '')
        tempID = `${relayChain}-parachain-${paraID}`
    }
    return tempID
}

function getParaIDExtra(relaychain = 'polkadot') {
    switch (relaychain) {
        case 'polkadot':
            return 0
            break;
        case 'kusama':
            return 20000
            break;
        case 'shibuya':
            return 30000
            break;
        case 'rococo':
            return 40000
            break;
        case 'moonbase':
        case 'moonbase-relay':
            return 60000
            break;
        default:
            //unknown
            return 90000
            break;
    }
}

function getRelayChainByChainID(chainID = 0) {
    if (chainID == 0) {
        return 'polkadot'; // Subsocial (22100, now paraID 2101) + Kilt (22086, 2086 on both)
    } else if (chainID == 2) {
        return 'kusama'
    }
    let r = chainID % 10000
    let prefix = (chainID - r) / 10000
    switch (prefix) {
        case 0:
            return 'polkadot';
        case 2:
            return 'kusama';
        case 3:
            return 'shibuya';
        case 4:
            return 'rococo';
        default:
            return 'unknown';
    }
    return false
}

function getRelayChainID(relaychain = 'polkadot') {
    switch (relaychain) {
        case 'polkadot':
            return 0
            break;
        case 'kusama':
            return 2
            break;
        case 'shibuya':
            return 30000
            break;
        case 'rococo':
            return 40000
            break;
        case 'westend':
            return 50000
            break;
        default:
            return 90000
            break;
    }
}

function getChainIDFromParaIDAndRelayChain(paraID, relayChain = 'polkadot') {
    // parachains that moved relaychains
    let relayChainID = getRelayChainID(relayChain)
    let paraIDExtra = getParaIDExtra(relayChain)
    if (paraID == 0) return relayChainID
    paraID = parseInt(paraID, 10);

    return paraIDExtra + paraID
}

function isRelayChain(chainID) {
    if (chainID == 0 || chainID == 2 || chainID == 30000 || chainID == 40000 || chainID == 60000 || chainID == 80000) {
        return true
    } else {
        return false
    }
}

function getParaIDfromChainID(chainID) {
    let paraID;
    if (chainID == 0 || chainID == 2 || chainID == 30000 || chainID == 40000 || chainID == 60000 || chainID == 80000) {
        paraID = 0
    } else if (chainID == 22100) { // subsocial is now 2101
        paraID = 2101;
    } else { // kilt spiritnet did not change its paraID 2086
        paraID = chainID % 10000
    }
    return paraID
}

function toUSD(symbol, relayChain) {
    symbol = symbol.toUpperCase().replace('XC', '')
    if (symbol == 'AUSD' || symbol == 'KUSD') {
        if (relayChain == 'polkadot') {
            symbol = 'AUSD'
        } else if (relayChain == 'kusama') {
            symbol = 'KUSD'
        }
    }
    return symbol
}

//(xcAsset address = "0xFFFFFFFF" + DecimalToHexWith32Digits(AssetId)
// 340282366920938463463374607431768211455 -> 0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF
// 42259045809535163221576417993425387648  -> 0xFfFFfFff1FcaCBd218EDc0EbA20Fc2308C778080
function xcAssetIDToContractAddr(xcAssetID) {
    let xcAssetAddress = '0x'
    try {
        let h = bnToHex(`${xcAssetID}`)
        let assetAddress = "0xFFFFFFFF" + h.substr(2).padStart(32, '0')
        xcAssetAddress = web3.utils.toChecksumAddress(assetAddress)
    } catch (err) {
        console.log(`xcAssetIDToContractAddr error=${err.toString()}`)
    }
    return xcAssetAddress
}

// 0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF -> 340282366920938463463374607431768211455
// 0xFfFFfFff1FcaCBd218EDc0EbA20Fc2308C778080 -> 42259045809535163221576417993425387648
function contractAddrToXcAssetID(xcAssetAddress) {
    let xcAssetID = false
    try {
        let rawAssetID = '0x' + xcAssetAddress.substr(10)
        xcAssetID = dechexAssetID(rawAssetID)
    } catch (err) {
        console.log(`contractAddrToXcAssetID error=${err.toString()}`)
    }
    return xcAssetID
}

// (0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF, 2004) -> {"Token":"42259045809535163221576417993425387648"}~2004
function makeAssetChainFromXcContractAddress(xcAssetAddress, chainID = 99) {
    let xcAssetID = false
    let asset = {
        Token: null,
    }
    if (xcAssetAddress != undefined) {
        if (xcAssetAddress.length = 42 && xcAssetAddress.substr(0, 2) == "0x") {
            xcAssetID = contractAddrToXcAssetID(xcAssetAddress)
            asset.Token = xcAssetID
            return (JSON.stringify(asset) + assetChainSeparator + chainID);
        }
    }
    return false
}

function is_public_endpoint(wss) {
    if (wss == undefined) return true
    if (wss.includes("polkaholic.io") || wss.includes("g.moonbase") || wss.includes("ws?apikey=")) {
        return false
    }
    return true
}

// Sovereign account — an account each chain in the ecosystem has, one for the relay chain and the other for other parachains.
// The account is owned by root and can only be used through SUDO (if available) or democracy (technical committee or referenda).
// The sovereign account typically signs XCM messages in other chains in the ecosystem
// It is calculated as the blake2 hash of a specific word (para or sibl) and parachain ID, truncating the hash to the correct length.
function compute_sovereign_account(parachainID) {
    let paraID;
    try {
        paraID = dechexToInt(parachainID)
        if (isNaN(paraID)) {
            return false
        }
    } catch (e) {
        return false
    }

    // (1) blake2(para+ParachainID) for the sovereign account in the relay chain, and
    let paraIDRawHex = '0x' + bnToHex(paraID).slice(2).padStart(8, '0');
    let paraIDU8a = hexToU8a(paraIDRawHex).reverse()
    let sovAddressRelay = u8aToHex(
        new Uint8Array([...new TextEncoder().encode('para'), ...paraIDU8a])
    ).padEnd(66, '0');

    // (2) blake2(sibl+ParachainID) for the sovereign account in other parachains
    let sovPara = u8aToHex(new Uint8Array([...new TextEncoder().encode('sibl'), ...paraIDU8a]))
    let sovAddressParaAccount32 = sovPara.padEnd(66, '0');
    let sovAddressParaAccount20 = sovPara.padEnd(42, '0');
    let r = {
        paraID: paraID,
        sovereignRelay: sovAddressRelay,
        sovereignAccount20: sovAddressParaAccount20,
        sovereignAccount32: sovAddressParaAccount32,
    }
    return r
}


function git_hash(isRelativePath = true) {
    let path = (isRelativePath) ? '..' : '/root/go/src/github.com/colorfulnotion/polkaholic'
    try {
        const rev = fs.readFileSync(`${path}/.git/HEAD`).toString().trim().split(/.*[: ]/).slice(-1)[0];
        if (rev.indexOf('/') === -1) {
            return `${rev}`;
        } else {
            return `${fs.readFileSync(`${path}/.git/` + rev).toString().trim()}`;
        }
    } catch (e) {
        if (isRelativePath) {
            return git_hash(false)
        }
        console.log(`git_hash err ${e.toString()}`)
        return `NA`
    }
}

function toHexString(byteArray) {
    return Array.prototype.map.call(byteArray, function(byte) {
        return ('0' + (byte & 0xFF).toString(16)).slice(-2);
    }).join('');
}

function toByteArray(hexString) {
    var result = [];
    for (var i = 0; i < hexString.length; i += 2) {
        result.push(parseInt(hexString.substr(i, 2), 16));
    }
    return result;
}


/*
{
  "v1": {
    "parents": 1,
    "interior": {
      "x3": [
        {
          "parachain": 1000
        },
        {
          "palletInstance": 36
        },
        {
          "generalIndex": "0xfd9d0bf45a2947a519a741c4b9e99eb6"
        }
      ]
    }
  }
}
*/

function padHexToFixedLength(hex, length = 8) {
    hex = hex.replace('0x', '')
    return '0x' + hex.padStart(length, '0')
}

function parseNetwork(networkStruct) {
    let networkTypes = Object.keys(networkStruct)
    let networkType = networkTypes[0]
    let networkVal = '00'
    if (networkType.toLowerCase() == 'any') {
        networkVal = '00'
    } else if (networkType.toLowerCase() == 'named') {
        networkVal = '01' + networkStruct[networkType].replace('0x', '')
    } else if (networkType.toLowerCase() == 'polkadot') {
        networkVal = '02'
    } else if (networkType.toLowerCase() == 'kusama') {
        networkVal = '03'
    }
    return networkVal
}

function lowercaseFirstLetter(string) {
    return string.charAt(0).toLowerCase() + string.slice(1);
}

function convert_multilocation_to_hex(piece) {
    let selectorEnum = 'NA'
    let selector = Object.keys(piece)[0]
    let selectorData = piece[selector]
    let encodedData = ''
    switch (lowercaseFirstLetter(selector)) {
        case "parachain": // 0x00 Parachain, bytes4
            let paraID = dechexToInt(selectorData)
            let paraIDHex = padHexToFixedLength(bnToHex(paraID), 8).replace('0x', '')
            encodedData = '0x00' + paraIDHex
            break;
        case "accountId32": // 0x01 AccountId32, bytes32
            let account32Val = ''
            let networkValA = ''
            for (const k of Object.keys(selectorData)) {
                if (k.toLowerCase() == 'id') account32Val = get_pubkey(selectorData[k])
                if (k.toLowerCase() == 'network') networkValA = parseNetwork(selectorData[k])
                encodedData = '0x01' + account32Val + networkValA
                break;
            }
        case "accountIndex64": // 0x02 AccountIndex64, byte8 via u64
            let accountIndex64Val = '0x'
            let networkValC = ''
            for (const k of Object.keys(selectorData)) {
                if (k.toLowerCase() == 'index') {
                    let acc64ID = dechexToInt(selectorData[k])
                    accountIndex64Val = padHexToFixedLength(bnToHex(paraID), 16).replace('0x', '')
                }
                if (k.toLowerCase() == 'network') networkValC = parseNetwork(selectorData[k])
                encodedData = '0x02' + accountIndex64Val + networkValC
                break;
            }
        case "accountKey20": // 0x03 AccountKey20, bytes20
            let account20Val = ''
            let networkValB = ''
            for (const k of Object.keys(selectorData)) {
                if (k.toLowerCase() == 'id') account20Val = get_pubkey(selectorData[k])
                if (k.toLowerCase() == 'network') networkValB = parseNetwork(selectorData[k])
                encodedData = '0x03' + account20Val + networkValB
                break;
            }
            break;
        case "palletInstance": // 0x04 PalletInstance, byte
            let palletInstanceID = dechexToInt(selectorData)
            let palletInstanceHex = padHexToFixedLength(bnToHex(palletInstanceID), 16).replace('0x', '')
            encodedData = '0x04' + palletInstanceHex
            break;
        case "generalIndex": // 0x05 GeneralIndex, byte16 via u128
            let generalIndexVal = isNaN(selectorData) ? selectorData.replace('0x', '') : bnToHex(selectorData).replace('0x', '')
            encodedData = '0x05' + generalIndexVal
            break;
        case "generalKey": // 0x06 GeneralKey, bytes[]
            let generalKeyVal = selectorData.replace('0x', '')
            encodedData = '0x06' + generalKeyVal
            break;
        case "onlyChild": //0x07 OnlyChild, ???
            selectorEnum = '0x07'
            break;
        case "plurality": //0x08 plurality, ???
            selectorEnum = '0x08'
            break;
        default:
            console.log(`unknown selector ${selector}!`)
            break;
    }
    //console.log(`selector: ${selector} selectorData: ${selectorData} -> encodedData:${encodedData}`)
    return encodedData
}

function convert_Multilocation_From_Hex(hex = '0x0000000378', isUppercase = false) {
    let selector = hex.substr(0, 4)
    let data = '0x' + hex.substr(4)
    let selectorType = 'NA'
    let decodedType = {}
    switch (selector) {
        case "0x00": //Parachain, bytes4
            selectorType = (isUppercase) ? "Parachain" : "parachain"
            let paraID = dechexToInt(data)
            decodedType[selectorType] = paraID
            break;
        case "0x01": //AccountId32, bytes32
            selectorType = (isUppercase) ? "AccountId32" : "accountId32"
            let networkType = data.substr(66)
            let networkName = 'Any'
            if (networkType.substr(0, 2) == '01') networkName = {
                Named: networkType.substr(2)
            } // not sure?
            if (networkType.substr(0, 2) == '02') networkName = 'Polkadot'
            if (networkType.substr(0, 2) == '03') networkName = 'Kusama'
            let account32 = data.substr(0, 66)
            decodedType[selectorType] = {
                network: networkName,
                key: account32
            }
            break;
        case "0x02": //AccountIndex64, byte8 via u64
            selectorType = (isUppercase) ? "AccountIndex64" : "accountIndex64"
            let networkTypeA = data.substr(16)
            let networkNameA = 'Any'
            if (networkTypeA.substr(0, 2) == '01') networkNameA = {
                Named: networkTypeA.substr(2)
            } // not sure?
            if (networkTypeA.substr(0, 2) == '02') networkNameA = 'Polkadot'
            if (networkTypeA.substr(0, 2) == '03') networkNameA = 'Kusama'
            let accountIndex64 = dechexToInt(data.substr(0, 34))
            decodedType[selectorType] = {
                network: networkNameA,
                index: accountIndex64
            }
            break;
        case "0x03": //AccountKey20, bytes20
            selectorType = (isUppercase) ? "AccountKey20" : "accountKey20"
            let networkTypeB = data.substr(42)
            let networkNameB = 'Any'
            if (networkTypeB.substr(0, 2) == '01') networkNameB = {
                Named: networkTypeB.substr(2)
            } // not sure?
            if (networkTypeB.substr(0, 2) == '02') networkNameB = 'Polkadot'
            if (networkTypeB.substr(0, 2) == '03') networkNameB = 'Kusama'
            let account20 = data.substr(0, 42)
            decodedType[selectorType] = {
                network: networkName,
                key: account20
            }
            break;
        case "0x04": //PalletInstance, byte
            selectorType = (isUppercase) ? "PalletInstance" : "palletInstance"
            let palletInstanceID = dechexToInt(data)
            decodedType[selectorType] = palletInstanceID
            break;
        case "0x05": //GeneralIndex, byte16 via u128
            selectorType = (isUppercase) ? "GeneralIndex" : "generalIndex"
            let generalIndexID = dechexToInt(data)
            decodedType[selectorType] = generalIndexID
            break;
        case "0x06": //GeneralKey, bytes[]
            selectorType = (isUppercase) ? "GeneralKey" : "generalKey"
            decodedType[selectorType] = data
            break;
        case "0x07": //OnlyChild, ???
            selectorType = (isUppercase) ? "OnlyChild" : "onlyChild"
            break;
        case "0x08": //plurality, ???
            selectorType = (isUppercase) ? "Plurality" : "plurality"
            break;
        default:
            break;
    }
    return decodedType
}

//see https://docs.moonbeam.network/builders/xcm/xcm-transactor/
function convert_moonbeam_evm_multiLocation_to_xcmV1MultiLocation(dest, isUppercase = false) {
    let v1 = {
        parents: 0,
        interior: {},
    }
    let cDest = {
        v1: v1
    }
    if (dest.length != 2) {
        console.log('Invalid dest')
        return false
    }
    v1.parents = dechexToInt(dest[0])
    let interior = dest[1]
    let interiorN = interior.length
    let interiorType = (isUppercase) ? `X${interiorN}` : `x${interiorN}`
    if (interiorN == 0) {
        v1.interior = {
            here: null
        }
    } else if (interiorN == 1) {
        let decodedType = convert_Multilocation_From_Hex(interior[0])
        v1.interior[interiorType] = decodedType
    } else {
        let interiorValArr = []
        for (const inter of interior) {
            let decodedType = convert_Multilocation_From_Hex(inter)
            interiorValArr.push(decodedType)
        }
        v1.interior[interiorType] = interiorValArr
    }
    cDest.v1 = v1
    //console.log(`dest ${JSON.stringify(dest, null, 4)} -> cDest ${JSON.stringify(cDest, null, 4)}`)
    return cDest
}

function convert_xcmV1MultiLocation_to_moonbeam_evm_multilocation(multilocaitonStr = '{"v1":{"parents":1,"interior":{"x3":[{"parachain":1000},{"palletInstance":36},{"generalIndex":"0xfd9d0bf45a2947a519a741c4b9e99eb6"}]}}}') {
    let multilocaiton = multilocaitonStr
    try {
        try {
            multilocaiton = JSON.parse(multilocaitonStr)
        } catch (e1) {
            //console.log(`e1`, e1)
        }
        if (multilocaiton.v1 != undefined) multilocaiton = multilocaiton.v1
        if (multilocaiton.V1 != undefined) multilocaiton = multilocaiton.V1
        // always use parent as reference
        let interiorArr = []
        let multilocaitonByteArr = [0, []]
        //console.log('multilocaiton', multilocaiton)
        for (const k of Object.keys(multilocaiton)) {
            if (k.toLowerCase() == 'parents') {
                multilocaitonByteArr[0] = dechexToInt(multilocaiton[k])
            }
            if (k.toLowerCase() == 'interior') {
                let multilocaitonInterior = multilocaiton[k]
                //console.log(`multilocaitonInterior`, multilocaitonInterior)
                let xType = Object.keys(multilocaitonInterior)[0]
                if (xType.toLowerCase(0) == 'here') {
                    // done
                } else if (xType.toLowerCase(0) == 'x1') {
                    let encodeHex = convert_multilocation_to_hex(multilocaitonInterior[xType])
                    interiorArr.push(encodeHex)
                } else {
                    //x2....x7
                    let interiorRawArr = multilocaitonInterior[xType]
                    //console.log(`xType=${xType}, interiorRawArr`, interiorRawArr)
                    if (Array.isArray(interiorRawArr)) {
                        for (const inter of interiorRawArr) {
                            let encodeHex = convert_multilocation_to_hex(inter)
                            interiorArr.push(encodeHex)
                        }
                    }
                }
            }
        }
        //console.log(`interiorArr`, interiorArr)
        multilocaitonByteArr[1] = interiorArr
        return multilocaitonByteArr
    } catch (e) {
        console.log(`convert_xcmV1MultiLocation_to_moonbeam_xcmV1MultiLocationByte`, e)
        return false
    }
}

function convert_xcmInteriorKey_to_xcmV1MultiLocation(xcmInteriorKey = '[{"parachain":1000},{"palletInstance":3}]~moonbase-relay', isUppercase = false) {
    try {
        let pieces = xcmInteriorKey.split(assetChainSeparator);
        let assetUnparsed = pieces[0];
        let relayChain = (pieces.length > 1) ? pieces[1] : undefined;
        // always use parent as reference
        let xcmVersionedMultiLocation = {}
        let xcmV1MultiLocation = {
            parents: 1,
            interior: {}
        }
        if (assetUnparsed == 'here') {
            xcmV1MultiLocation.interior = {
                here: null
            }
        } else {
            let interior = JSON.parse(assetUnparsed)
            let interiorN = interior.length
            if (interiorN == undefined) {
                interiorN = 1
                interior = [interior]
            }
            let interiorType = (isUppercase) ? `X${interiorN}` : `x${interiorN}`
            if (interiorN == 1) {
                xcmV1MultiLocation.interior[interiorType] = interior[0]
            } else {
                let interiorValArr = []
                for (const inter of interior) {
                    interiorValArr.push(inter)
                }
                xcmV1MultiLocation.interior[interiorType] = interiorValArr
            }
        }
        let versionType = (isUppercase) ? `V1` : `v1`
        xcmVersionedMultiLocation[versionType] = xcmV1MultiLocation
        return xcmVersionedMultiLocation
    } catch (e) {
        console.log(`convert_xcmInteriorKey_to_xcmV1MultiLocation xcmInteriorKey=${xcmInteriorKey}, err`, e)
        return false
    }
}

function convert_xcmV1MultiLocation_to_byte(xcmV1MultiLocation, api = false) {
    if (!api) return null;
    let multilocationStruct = {}
    if (xcmV1MultiLocation.v1 != undefined) multilocationStruct = xcmV1MultiLocation.v1
    if (xcmV1MultiLocation.V1 != undefined) multilocationStruct = xcmV1MultiLocation.V1
    let multiLocationHex = false
    try {
        let multilocation = api.createType('XcmV1MultiLocation', multilocationStruct)
        multiLocationHex = u8aToHex(multilocation.toU8a())
    } catch (e) {
        console.log(`xcmV1MultiLocation_to_byte error`, e)
    }
    return multiLocationHex
}

function getXCMTransactList(msgHash, msgStr) {
    try {
        var xcmVersionedXcm = JSON.parse(msgStr)
        var version = Object.keys(xcmVersionedXcm)[0]
        var instructions = xcmVersionedXcm[version]
        let transactList = []
        for (const ins of instructions) {
            let insKey = Object.keys(ins)
            if (insKey == 'transact') {
                let insV = ins[insKey]
                if (insV.call != undefined && insV.call.encoded != undefined) {
                    let call = insV.call.encoded.replace('0x', '')
                    transactList.push(call)
                }
            }
        }
        //console.log(`transactList`, transactList)
        let r = {
            msgHash: msgHash,
            transactList: transactList
        }
        return r
    } catch (e) {
        console.log(`err`, e)
        return false
    }
}

function decodeNetwork(network) {
    let relayChain = 'null';
    if (network.network != undefined) relayChain = network.network
    if (network.named != undefined) relayChain = hexToString(network.named)
    return relayChain
}

function encodeNetwork(relayChain = 'kusama') {
    let network = {}
    if (relayChain == 'kusama' || relayChain == 'polkadot') {
        network = {
            network: relayChain
        }
    } else {
        network = {
            named: stringToHex(relayChain)
        }
    }
    return network
}

//'[{"parachain":2000},{"generalKey":"0x02f4c723e61709d90f89939c1852f516e373d418a8"}]~polkadot' -> [{"network":"polkadot"},{"parachain":2000},{"generalKey":"0x02f4c723e61709d90f89939c1852f516e373d418a8"}]
// polkadot-here -> [{"network":"polkadot"},"here"]
function convertXcmInteriorKeyV1toV2(xcmInteriorKeyV1 = '[{"parachain":2000},{"generalKey":"0x02f4c723e61709d90f89939c1852f516e373d418a8"}]~polkadot') {
    var [xcmInteriorKey, relayChain] = parseXcmInteriorKeyV1(xcmInteriorKeyV1)
    if (xcmInteriorKey) {
        let network = encodeNetwork(relayChain)
        if (xcmInteriorKey == 'here') {
            xcmInteriorKey = '"here"'
        }
        return makeXcmInteriorKeyV2(xcmInteriorKey, network)
    }
    return null;
}

//[{"network":"polkadot"},"here"] -> polkadot-here
function convertXcmInteriorKeyV2toV1(xcmInteriorKeyV2 = '[{"network":"polkadot"},{"parachain":2000},{"generalKey":"0x02f4c723e61709d90f89939c1852f516e373d418a8"}]') {
    var [network, xcmInteriorKey] = parseXcmInteriorKeyV2(xcmInteriorKeyV2)
    let relayChain = decodeNetwork(network)
    if (xcmInteriorKey == '"here"') {
        xcmInteriorKey = 'here'
    }
    return makeXcmInteriorKeyV1(xcmInteriorKey, relayChain)
}

function parseXcmInteriorKeyV2(xcmInteriorKey = '[{"network":"polkadot"},{"parachain":2000},{"generalKey":"0x02f4c723e61709d90f89939c1852f516e373d418a8"}]') {
    /*
    let pieces = xcmInteriorKey.split(assetChainSeparator);
    let relayChain = pieces[1];
    let assetUnparsed = (pieces.length > 1) ? pieces[1] : undefined;
    */
    try {
        let pieces = JSON.parse(xcmInteriorKey)
        //console.log(`xcmInteriorKey=${xcmInteriorKey}`, pieces)
        let network = pieces.shift()
        let assetUnparsed = {}
        if (pieces.length == 1) {
            assetUnparsed = JSON.stringify(pieces[0])
        } else {
            assetUnparsed = JSON.stringify(pieces)
        }
        return [network, assetUnparsed];
    } catch (e) {
        return [false, false]
    }
}

function makeXcmInteriorKeyV2(interiorStr, network = {
    network: 'kusama'
}) {
    try {
        let interior = JSON.parse(interiorStr)
        let globalInterior = [network]
        if (Array.isArray(interior)) {
            globalInterior = globalInterior.concat(interior);
        } else {
            globalInterior.push(interior)
        }
        //return (relayChain + assetChainSeparator + interior);
        return JSON.stringify(globalInterior)
    } catch (err) {
        console.log("makeXcmInteriorKeyV2 ERR", interiorStr);
        return null;
    }
}

function makeXcmInteriorKeyV1(interior, relayChain = 'kusama') {
    return (interior + assetChainSeparator + relayChain);
}

function parseXcmInteriorKeyV1(xcmInteriorKey = '[{"parachain":2023},{"palletInstance":10}]~kusama') {
    if (xcmInteriorKey == typeof "string") {
        let pieces = xcmInteriorKey.split(assetChainSeparator);
        let assetUnparsed = pieces[0];
        let relayChain = (pieces.length > 1) ? pieces[1] : undefined;
        return [assetUnparsed, relayChain];
    } else return [null, null]
}

function formatBQ(sql) {
    try {
        var s = sqlFormatter.format(sql, {
            language: 'bigquery',
            tabWidth: 2,
            keywordCase: 'upper',
            linesBetweenQueries: 2,
        });
        return s
    } catch (e) {
        return s
    }
}

function formatTrino(sql) {
    try {
        var s = sqlFormatter.format(sql, {
            language: 'trino',
            tabWidth: 2,
            keywordCase: 'upper',
            linesBetweenQueries: 2,
        });
        return s
    } catch (e) {
        return s
    }
}

function formatSQL(sql) {
    try {
        var s = sqlFormatter.format(sql, {
            language: 'mysql',
            tabWidth: 2,
            keywordCase: 'upper',
            linesBetweenQueries: 2,
        });
        return s
    } catch (e) {
        return s
    }
}

function ts_to_logDT_hr(ts) {
    var a = new Date(ts * 1000);
    let dd = a.getUTCDate().toString().padStart(2, '0');
    let mm = String(a.getUTCMonth() + 1).padStart(2, '0'); //January is 0!
    let yyyy = a.getUTCFullYear();
    let logDT = `${yyyy}-${mm}-${dd}`;
    var hr = a.getUTCHours();
    return [logDT, hr];
}

function logDT_hr_to_ts(logDT, hr) {
    let logDTS = logDT.replaceAll('-', '')
    var y = logDTS.substr(0, 4),
        m = logDTS.substr(4, 2),
        d = logDTS.substr(6, 2)
    let a = new Date(`${y}-${m}-${d}`)
    let logDTTS = a.getTime() / 1000 + hr * 3600;
    return logDTTS
}

function getTimeFormat(logDT) {
    //2020-12-01 -> [TS, '20221201', '2022-12-01', '2022-11-30']
    //20201201 -> [TS, '20221201', '2022-12-01', '2022-11-30']
    let logTS = logDT_hr_to_ts(logDT, 0)
    let logYYYYMMDD = logDT.replaceAll('-', '')
    let [currDT, _c] = ts_to_logDT_hr(logTS)
    let [prevDT, _p] = ts_to_logDT_hr(logTS - 86400)
    return [logTS, logYYYYMMDD, currDT, prevDT]
}

class NotFoundError extends Error {
    constructor(message) {
        // Needs to pass both `message` and `options` to install the "cause" property.
        super(message);
    }
}

class InvalidError extends Error {
    constructor(message) {
        // Needs to pass both `message` and `options` to install the "cause" property.
        super(message);
    }
}

module.exports = {
    NotFoundError,
    InvalidError,

    // DebugLevel
    debugNoLog: 0,
    debugErrorOnly: 1,
    debugInfo: 2,
    debugVerbose: 3,
    debugTracing: 4,

    // Kusama parachains
    chainIDKusamaAssetHub: 21000,
    chainIDEncointer: 21001,
    chainIDKarura: 22000,
    chainIDBifrostKSM: 22001,
    chainIDKhala: 22004,
    chainIDShiden: 22007,
    //chainIDMars: 22008,
    chainIDSora: 22011,
    chainIDCrustShadow: 22012,
    chainIDIntegritee: 22015,
    //chainIDSakura: 22016,
    //chainIDSubgameGamma: 22018,
    //chainIDKpron: 22019,
    //chainIDAltairDev: 22021,
    chainIDMoonriver: 22023,
    chainIDGenshiro: 22024,
    chainIDRobonomics: 22048,
    //chainIDRobonomicsDev: 22077,
    //chainIDTrustbase: 22078,
    //chainIDLoom: 22080,
    chainIDCalamari: 22084,
    chainIDHeiko: 22085,
    chainIDKilt: 2086,
    chainIDPicasso: 22087,
    chainIDAltair: 22088,
    chainIDBasilisk: 22090,
    chainIDKintsugi: 22092,
    //chainIDUnorthodox: 22094,
    chainIDQuartz: 22095,
    chainIDBitcountry: 22096,
    chainIDSubsocial: 22100,

    chainIDZeitgeist: 2092,
    chainIDPichiu: 22102,
    chainIDDarwiniaCrab: 22105,
    chainIDLitmus: 22106,
    chainIDKico: 22107,
    chainIDMangataX: 22110,
    chainIDKabocha: 22113,
    chainIDTuring: 22114,
    chainIDDoraFactory: 22115,
    chainIDTanganika: 22116,
    chainIDListen: 22118,
    chainIDBajun: 22119,
    chainIDImbue: 22121,
    //chainIDGM: 22123,
    chainIDAmplitude: 22124,
    chainIDTinkernet: 22125,

    // Polkadot parachains
    chainIDPolkadotAssetHub: 1000,
    chainIDAcala: 2000,
    chainIDClover: 2002,
    //chainIDdarwiniaBackup: 2003,
    chainIDMoonbeam: 2004,
    chainIDAstar: 2006,
    chainIDKapex: 2007,
    //chainIDCrust: 2008,
    chainIDEquilibrium: 2011,
    chainIDParallel: 2012,
    chainIDLitentry: 2013,
    //chainIDManta: 2015,
    //chainIDSubgame: 2017,
    //chainIDSubdao: 2018,
    chainIDComposable: 2019,
    chainIDEfinity: 2021,
    chainIDNodle: 2026,
    chainIDCoinversation: 2027,
    //chainIDAres: 2028,
    chainIDBifrostDOT: 2030,
    chainIDCentrifuge: 2031,
    chainIDInterlay: 2032,
    chainIDHydraDX: 2034,
    chainIDPhala: 2035,
    chainIDUnique: 2037,
    //chainIDGeminis: 2038,
    chainIDIntegriteeShell: 2039,
    chainIDPolkadex: 2040,
    chainIDOrigintrail: 2043,
    //chainIDDarwinia: 2046,
    //chainIDKylin: 2052,
    //chainIDOmnibtc: 2055,
    chainIDOak: 2090,
    chainIDFrequency: 2091,
    chainIDPendulum: 2094,
    chainIDMythos: 3369,

    // other
    chainIDUniqueOther: 255,
    chainIDPontem: 105,
    chainIDLaminar: 11,
    chainIDMoonbaseAlpha: 61000,
    chainIDMoonbaseBeta: 60888,
    chainIDMoonbaseRelay: 60000,

    chainIDShibuya: 30000,

    // polkadot/kusama
    chainIDPolkadot: 0,
    chainIDKusama: 2,

    // other evm
    chainIDEthereum: 1,
    chainIDOptimism: 10,
    chainIDBsc: 56,
    chainIDPolygon: 137,
    chainIDZksync: 324,
    chainIDAstarEVM: 592,
    chainIDShidenEVM: 336,
    chainIDMoonbeamEVM: 1284,
    chainIDMoonriverEVM: 1285,
    chainIDArbitrum: 42161,
    chainIDAvalanche: 43114,

    // assetSource
    assetSourceCoingecko: 'coingecko',
    assetSourceOracle: 'oracle',
    assetSourceOnChain: 'onchain',

    // assetType
    assetTypeLoan: "Loan",
    assetTypeCDP: "CDP",
    assetTypeCDPSupply: "CDP_Supply",
    assetTypeCDPBorrow: "CDP_Borrow",
    assetTypeToken: "Token",
    assetTypeNFT: "NFT",
    assetTypeNFTToken: "NFTToken",
    assetTypeLiquidityPair: "LiquidityPair",
    assetTypeERC20LiquidityPair: "ERC20LP",
    assetTypeERC20: "ERC20",
    assetTypeERC721: "ERC721",
    assetTypeERC721Token: "ERC721Token",
    assetTypeERC1155: "ERC1155",
    assetTypeERC1155Token: "ERC1155Token",
    assetTypeContract: "Contract",
    assetTypeXCAsset: "XCAsset",
    assetTypeXCMTransfer: "XCMTransfer",

    toHex: function(bytes) {
        return toHex(bytes);
    },
    fromHex: function(hexStr) {
        var s = hexStr;
        if (hexStr.substr(0, 2).toLowerCase() == "0x") s = hexStr.substr(2);
        if (s == "") return new Uint8Array();
        return new Uint8Array(s.match(/.{1,2}/g).map((byte) => parseInt(byte, 16)));
    },
    getPubKey: function(ss58Addr) {
        return get_pubkey(ss58Addr)
    },
    getAddress: function(pubKeyAddr, networkID = 0) {
        return get_address(pubKeyAddr, networkID)
    },
    getNetwork: function(filePath = "summary/ss58-registry.json") {
        return readJSON(filePath);
    },
    getAllAddress: function(
        pubKeyAddr,
        filePath = "summary/ss58-registry.json"
    ) {
        return getAllAddress(pubKeyAddr, filePath);
    },
    isValidAddressPolkadotAddress: function(address) {
        return isValidAddressPolkadotAddress(address);
    },
    isValidSubstratePublicKey: function(address) {
        if (typeof address == "string" && address.length == 66) {
            return (true);
        }
        return (false);
    },
    isValidEVMAddress: function(address) {
        if (typeof address == "string" && address.length == 42) {
            return (true);
        }
        return (false);
    },
    validAmount: function(v) {
        if (typeof v == "number" && (v > 0)) return (true);
        if (typeof v == "string") {
            if (v.includes("0x")) return (false);
            let x = parseInt(v, 10);
            if (x > 0) return (true);
        }
        return (false);
    },
    decode58: function(ss58Addr) {
        return decode58(ss58Addr);
    },
    getChainID: function(ss58Addr) {
        //address <chainID(1bytes)><pubkey(32bytes)><checksum(2bytes)> = 35 bytes
        //see: https://github.com/tetcoin/tetcore/wiki/External-Address-Format-(SS58)
        return web3.utils.hexToNumber(decode58(ss58Addr).substring(0, 4));
    },
    getAddressType: function(id) {
        let idType = "invalid";
        let prefix = id.substring(0, 2);
        if (id.length == 66) {
            switch (prefix) {
                case "0x":
                    idType = "address";
                    break;
                case "1x":
                    idType = "account";
                    break;
                case "2x":
                    idType = "groupedAccounts";
                    break;
                case "3x":
                    idType = "parachain";
                    break;
                case "4x":
                    idType = "relayChain";
                    break;
                default:
                    idType = "invalid";
            }
        } else if (id.length == 64) {
            // ambiguous type
            idType = "ambiguous";
        } else if (isValidAddressPolkadotAddress(id)) {
            //the address doesn't follow 0x/1x/2x/3x/4x length68 convention...check if it's valid SS58. i.e
            var addrHex = decode58(id);
            var chainID = getChainID(id);
            console.log(`${addrHex} (chainID:${chainID})`);
            idType = "rawAddress";
        }
        return idType;

    },
    isValidSignature: function(signedMessage, signature, address) {
        var res = signatureVerify(signedMessage, signature, address)
        return res.isValid;

    },
    sqrtPriceX96ToPriceWithDecimals: function(sqrtPriceX96, token0Decimals = 18, token1Decimals = 18) {
        return sqrtPriceX96ToPriceWithDecimals(sqrtPriceX96, token0Decimals, token1Decimals)
    },
    tickToPriceWithDecimals: function(tick, token0Decimals = 18, token1Decimals = 18) {
        return tickToPriceWithDecimals(tick, token0Decimals, token1Decimals)
    },
    dechexToInt: function(number) {
        return dechexToInt(number);
    },
    dechexToIntStr: function(number) {
        return dechexToIntStr(number);
    },
    toIntegerStr: toIntegerStr,
    toBn: toBn,
    dechexAssetID: function(number) {
        return dechexAssetID(number);
    },
    isValidAddressPolkadotAddress: function(address) {
        try {
            encodeAddress(isHex(address) ? hexToU8a(address) : decodeAddress(address));
            return true;
        } catch (error) {
            return false;
        }
    },
    buf2hex: function(buffer) {
        return [...new Uint8Array(buffer)]
            .map(x => x.toString(16).padStart(2, '0'))
            .join('');
    },
    //by definition here: https://github.com/polkascan/py-substrate-interface/blob/5df61fc84a6fa185dcc17e761c412a499aad1609/substrateinterface/utils/hasher.py#L70
    twox_128: function(s) {
        var hasher64_0 = new XXHash64(0);
        var hasher64_1 = new XXHash64(1);
        let b = Buffer.from(s);
        let part1 = hasher64_0.hash(b).reverse()
        let part2 = hasher64_1.hash(b).reverse()
        let res = buf2hex(part1) + buf2hex(part2)
        return res
    },
    snake_case_string: function(str) {
        return str && str.match(
                /[A-Z]{2,}(?=[A-Z][a-z]+[0-9]*|\b)|[A-Z]?[a-z]+[0-9]*|[A-Z]|[0-9]+/g)
            .map(s => s.toLowerCase())
            .join('_');
    },
    firstCharLowerCase: function(inp) {
        if (inp.toUpperCase() == inp) { // if the whole thing is uppercase, then return all lowercase
            return inp.toLowerCase();
        }
        return inp.substr(0, 1).toLowerCase() + inp.substr(1)
    },
    firstCharUpperCase: function(inp) {
        return inp.substr(0, 1).toUpperCase() + inp.substr(1)
    },
    blockNumberToHex: function(blockNumber) {
        return "0x" + blockNumber.toString(16).padStart(8, '0');
    },
    blockNumberToHexEVM: function(blockNumber) {
        return "0x" + blockNumber.toString(16);
    },
    decode58: function(base58Str) {
        return u8aToHex(bs58.decode(base58Str));
    },
    readJSON: function(filePath) {
        var data = JSON.parse(fs.readFileSync(filePath));
        return data;
    },
    getAllAddress: function(pubKeyAddr, filePath) {
        var networks = readJSON(filePath);
        var pKeyAddr = pubKeyAddr;
        var pubKey = getPubKey(pKeyAddr);
        var output = {};
        output.pubKey = pubKey;
        output.networks = [];
        //console.log(`Publey=${pubKey} - derived from ss58 ${pubKeyAddr}`)
        networks.registry.forEach((n) => {
            if (n.standardAccount == "*25519") {
                var addr = getAddress(pubKey, n.prefix);
                //console.log(`Addr [${addr}]\t\tNetwork: ${n.network}(${n.symbols}), netowrkID=${n.prefix}, `)
                output.networks.push({
                    //symbols: n.symbols,
                    network: n.network,
                    networkID: n.prefix,
                    address: addr,
                });
            }
        });
        return output;
    },
    buf2hex: function(buffer) {
        return [...new Uint8Array(buffer)]
            .map(x => x.toString(16).padStart(2, '0'))
            .join('');
    },
    padwith0x: function(s) {
        return u8aToHex(hexToU8a(s))
    },
    twox_128: function(s) {
        let res = xxhashAsHex(s, 128)
        return res.slice(2)
    },
    getAsset: function(a) {
        let typ = [];
        let content = [];
        if (Array.isArray(a)) {
            for (let i = 0; i < a.length; i++) {
                for (const k of Object.keys(a[i])) {
                    typ.push(k);
                    content.push(a[i][k]);
                }
            }
        } else {
            for (const k of Object.keys(a)) {
                typ.push(k);
                content.push(a[k]);
            }
        }
        // types of the keys of the objects in the array, or the keys of the object
        let typHash = xxhashAsHex(typ.join(","), 64).slice(2, 10);
        // values of the objects in the array, or the values of the object
        let contentHash = xxhashAsHex(content.join(","), 128).slice(2);
        return "0x" + typHash + contentHash;

    },
    twox_64: function(s) {
        let res = xxhashAsHex(s, 64)
        return res.slice(2)
    },
    twox_128_from_hex: function(s) {
        let res = xxhashAsHex(hexToU8a(s), 128)
        return res.slice(2)
    },
    twox_64_from_hex: function(s) {
        let res = xxhashAsHex(hexToU8a(s), 64)
        return res.slice(2)
    },
    blake2_256_from_hex: function(s) {
        let res = blake2AsHex(hexToU8a(s), 256)
        return res.slice(2)
    },
    blake2_128_from_hex: function(s) {
        let res = blake2AsHex(hexToU8a(s), 128)
        return res.slice(2)
    },
    blake2_64_from_hex: function(s) {
        let res = blake2AsHex(hexToU8a(s), 64)
        return res.slice(2)
    },
    Blake256FromStr: function(s) {
        let res = blake2AsHex(stringToU8a(s), 256)
        return res.slice(2)
    },
    verifyprefix: function(currencyStr = "45bc486788b29b5a0100810082") {
        // pairs
        //45bc486788b29b5a0100810082  =XXHash(0x0100810082)
        let prefix = currencyStr.substr(0, 16)
        let rawInput = currencyStr.substr(16)
        let expectedPrefix = twox_64_from_hex(rawInput)
        if (prefix == expectedPrefix) {
            return true
        } else {
            console.log(`prefix=${prefix}, expectedPrefix=${expectedPrefix}`)
            return false
        }
    },
    assetpairkey: function(token0, token1, chainID) {
        return JSON.stringify([{
            Token: token0
        }, {
            Token: token1
        }]) + assetChainSeparator + chainID.toString();
    },
    parseAssetChain: function(assetChain) {
        let pieces = assetChain.split(assetChainSeparator);
        let assetUnparsed = pieces[0];
        let chainID = (pieces.length > 1) ? parseInt(pieces[1], 10) : undefined;
        return [assetUnparsed, chainID];
    },
    parseAssetChainAsStruct: function(assetChain) {
        let pieces = assetChain.split(assetChainSeparator);
        let assetUnparsed = pieces[0];
        let chainID = parseInt(pieces[1], 10);
        return [JSON.parse(assetUnparsed), chainID];
    },
    parseHourlyChain: function(hourKeyChain) {
        let pieces = hourKeyChain.split("#");
        let hourKey = pieces[0];
        let chainID = parseInt(pieces[1], 10);
        return [hourKey, chainID];
    },
    makeAssetChain: function(asset, chainID = 99) {
        return (asset + assetChainSeparator + chainID);
    },
    makeAssetChainFromXcContractAddress: function(xcContractAddress, chainID = 99) {
        return makeAssetChainFromXcContractAddress(xcContractAddress, chainID);
    },
    //paraTool.getErcTokenAssetChain('0xFfFFfFff1FcaCBd218EDc0EbA20Fc2308C778080', 2004) -> [true, '{"Token":"42259045809535163221576417993425387648"}~2004', '0xffffffff1fcacbd218edc0eba20fc2308c778080~2004']
    //paraTool.getErcTokenAssetChain('0x0fFFfFff1FcaCBd218EDc0EbA20Fc2308C778080', 2004) -> [false, '0x0fffffff1fcacbd218edc0eba20fc2308c778080~2004', '0x0fffffff1fcacbd218edc0eba20fc2308c778080~2004' ]
    getErcTokenAssetChain: function(tokenAddress, chainID) {
        // Store in lower case
        let lowerAsset = tokenAddress.toLowerCase()
        let assetChain = this.makeAssetChain(lowerAsset, chainID);
        let rawAssetChain = this.makeAssetChain(lowerAsset, chainID);
        let isXcAsset = false
        if (lowerAsset.substr(0, 10) == '0xffffffff') {
            // this is xcAsset
            let xcAssetID = contractAddrToXcAssetID(tokenAddress)
            let xcAsset = {
                Token: xcAssetID
            }
            isXcAsset = true
            assetChain = this.makeAssetChain(JSON.stringify(xcAsset), chainID)
        }
        return [isXcAsset, assetChain, rawAssetChain]
    },
    /*
    makeXcmInteriorKeyV1: function(interior, relayChain = 'kusama') {
        return makeXcmInteriorKeyV1(interior, relayChain)
    },
    makeXcmInteriorKeyV2: function(interior, relayChain = 'kusama') {
        return makeXcmInteriorKeyV2(interior, relayChain)
    },
    parseXcmInteriorKeyV2: function (xcmInteriorKey = '[{"parachain":2023},{"palletInstance":10}]~kusama') {
        return parseXcmInteriorKeyV2(xcmInteriorKey);
    },
    */
    /*
    paraTool uses older XcmInteriorKeyV1 format, whereas garTool uses XcmInteriorKeyV1 format
    */
    parseXcmInteriorKeyV1: function(xcmInteriorKey = '[{"parachain":2023},{"palletInstance":10}]~kusama') {
        return parseXcmInteriorKeyV1(xcmInteriorKey);
    },
    makeXcmInteriorKey: function(interior, relayChain) {
        return makeXcmInteriorKeyV1(interior, relayChain)
    },
    parseXcmInteriorKey: function(xcmInteriorKey) {
        return parseXcmInteriorKeyV1(xcmInteriorKey)
    },
    convertXcmInteriorKeyV1toV2: function(xcmInteriorKeyV1) {
        return convertXcmInteriorKeyV1toV2(xcmInteriorKeyV1)
    },
    convertXcmInteriorKeyV2toV1: function(xcmInteriorKeyV2) {
        return convertXcmInteriorKeyV2toV1(xcmInteriorKeyV2)
    },
    inverted_ts_key: function(ts) {
        return inverted_ts_key(ts);
    },
    make_addressHistory_rowKey: function(accKey, ts) {
        return accKey + "#" + inverted_ts_key(ts);
    },
    make_addressExtrinsic_rowKey: function(address, extrinsicHash, ts) {
        let invertedTS = inverted_ts_key(ts)
        return `${address.toLowerCase()}#${invertedTS}#${extrinsicHash}`
    },
    decode_invertedTS: function(invertedTS) {
        return decode_invertedTS(invertedTS)
    },
    parse_addressExtrinsic_rowKey: function(rowKey) {
        let [addressPiece, invertedTS, extrinsicHashPiece] = rowKey.split('#')
        let ts = decode_invertedTS(invertedTS)
        return [addressPiece, ts, extrinsicHashPiece];
    },
    parse_addressHistory_rowKey: function(rowKey) {
        let [addressPiece, invertedTS] = rowKey.split('#')
        let ts = decode_invertedTS(invertedTS)
        return [addressPiece, ts];
    },
    getCurrentTS: function() {
        return Math.floor(+new Date() / 1000);
    },
    parseStorageKey: function(chainID, palletName, storageName, key, decoratedKey) {
        return parse_storage_key(chainID, palletName, storageName, key, decoratedKey);
    },
    computeEVMBlockHash: function(block) {
        return compute_EVM_BlockHash(block)
    },
    getShortHash: function(hash) {
        let shortHash = (hash >= 66) ? `${hash.substr(0,8)}...${hash.substr(-6)}` : "-"
        return shortHash
    },
    pubkeyToH160: function(pubkey) {
        return pubkey_to_h160(pubkey)
    },
    h160ToPubkey: function(h160) {
        return h160_to_pubkey(h160)
    },
    h160ToChainAddress: function(h160, chainID = 5) {
        return h160_to_chain_address(h160, chainID)
    },
    pubkeyToEVMSS58: function(pubkey, chainID = 5) {
        return pubkey_to_evm_ss58(pubkey, chainID)
    },
    round: function(value, decimals) {
        return Number(Math.round(value + 'e' + decimals) + 'e-' + decimals);
    },
    floatToInt: function(floatvalue) {
        return Math.round(floatvalue);
    },
    encodeAssetChain: function(assetChain) {
        return assetChain.replaceAll(":", "~~")
    },
    decodeAssetChain: function(assetChainEncoded) {
        return assetChainEncoded.replaceAll("~~", ":")
    },
    getTimeFormat: getTimeFormat,
    //1645135200 -> [ '2022-02-17', 22 ]
    ts_to_logDT_hr: ts_to_logDT_hr,
    // '2022-02-17', 22 -> 1645135200
    logDT_hr_to_ts: logDT_hr_to_ts,
    hexAsU8: function(hexStr) {
        return hexToU8a(hexStr)
    },
    getLifetime: function(currentBN, mortalEra) {
        return get_lifetime(currentBN, mortalEra)
    },
    sha1: function(s) {
        return sha1(s)
    },
    sha1_4bytes: function(s) {
        let hex = sha1(s)
        return hex.substr(0, 8)
    },
    parseSectionMethod: function(e) {
        return parseSectionMethod(e)
    },
    auditHashesTx: function(tx) {
        return audit_hashes_tx(tx)
    },
    toNumWithComma: function(tx) {
        return toNumWithComma(tx)
    },
    toNumWithoutComma: function(tx) {
        return toNumWithoutComma(tx)
    },
    sameAddress: function(rawx, rawy) {
        let x = get_pubkey(rawx);
        let y = get_pubkey(rawy);
        return (x == y);
    },
    isObject: function(x) {
        return (typeof val === 'object');
    },
    hexToString: function(x) {
        return hexToString(x)
    },
    isInt: function(x) {
        return isInt(x)
    },
    isFloat: function(x) {
        return isFloat(x)
    },
    computeMultisig: function(caller, addresses, threshold) {
        return computeMultisig(caller, addresses, threshold)
    },
    parseBool: function(input) {
        return parseBool(input);
    },
    decode_systemAccountType: decode_systemAccountType,
    pubKeyHex2ASCII: function(str) {
        return pubKey_hex2ascii(str)
    },
    getAuthor: function(digest, validatorsList) {
        return getAuthor(digest, validatorsList);
    },
    formatBQ: formatBQ,
    formatTrino: formatTrino,
    formatSQL: formatSQL,

    isJSONString: function(x) {
        if (typeof x != "string") return (false);
        let l = x.length;
        if (x.length < 2) return (false);
        if (x.charAt(0) == "{" && x.charAt(l - 1) == "}") return (true);
        if (x.charAt(0) == "[" && x.charAt(l - 1) == "]") return (true);
        return (false);
    },
    stringToHex: function(x) {
        return stringToHex(x)
    },
    unique: function(x) {
        return unique(x)
    },
    getParaIDfromChainID: function(chainID) {
        return getParaIDfromChainID(chainID)
    },
    isRelayChain: function(chainID) {
        return isRelayChain(chainID)
    },
    getChainIDFromParaIDAndRelayChain: function(chainID, relayChain) {
        return getChainIDFromParaIDAndRelayChain(chainID, relayChain)
    },
    getRelayChainID: function(relaychain) {
        return getRelayChainID(relaychain)
    },
    getParaIDExtra: function(relaychain) {
        return getParaIDExtra(relaychain)
    },
    getRelayChainByChainID: function(chainID) {
        return getRelayChainByChainID(chainID)
    },
    toUSD: function(x, relayChain) {
        return toUSD(x, relayChain)
    },
    xcAssetIDToContractAddr: function(xcAssetID) {
        return xcAssetIDToContractAddr(xcAssetID)
    },
    contractAddrToXcAssetID: function(xcAssetAddress) {
        return contractAddrToXcAssetID(xcAssetAddress)
    },
    bnToHex: function(n) {
        return bnToHex(n)
    },
    toBaseUnit: function(value, decimals) {
        return toBaseUnit(value, decimals)
    },
    floatToBigIntDecimals: function(f, decimals) {
        return float_to_BigInt_decimals(f, decimals)
    },
    removeNewLine: function(str) {
        return str.replace(/(\r\n|\n|\r)/gm, "").replace(/\s\s+/g, ' ')
    },
    isPublicEndpoint: function(endpoint) {
        return is_public_endpoint(endpoint)
    },
    getTempID: function(chainID) {
        return get_temp_id(chainID)
    },
    computeSovereignAccount: function(paraID) {
        return compute_sovereign_account(paraID)
    },
    commitHash: function() {
        return git_hash()
    },
    u8aAsHex: function() {
        return u8aToHex()
    },
    intToHex: function(int) {
        return bnToHex(int)
    },
    isNumeric: function(x) {
        return isNumeric(x)
    },
    reverseEndian: function(hex) {
        return reverse_endian(hex)
    },
    convertXcmInteriorKeyToXcmV1MultiLocation: function(xcmInteriorKey, isUppercase) {
        return convert_xcmInteriorKey_to_xcmV1MultiLocation(xcmInteriorKey, isUppercase)
    },
    convertXcmV1MultiLocationToByte: function(xcmV1MultiLocation, api = false) {
        //return false
        return convert_xcmV1MultiLocation_to_byte(xcmV1MultiLocation, api)
    },
    convertXcmV1MultiLocationToMoonbeamEvmMultiLocation: function(xcmV1MultiLocation) {
        return convert_xcmV1MultiLocation_to_moonbeam_evm_multilocation(xcmV1MultiLocation)
    },
    convertMoonbeamEvmMultiLocationToXcmV1MultiLocation: function(xcmV1MultiLocation) {
        return convert_moonbeam_evm_multiLocation_to_xcmV1MultiLocation(xcmV1MultiLocation)
    },
    getXCMTransactList: function(msgHash, msgStr) {
        return getXCMTransactList(msgHash, msgStr)
    },
    getCurrentDayTS: function() {
        const now = new Date();
        now.setUTCHours(0, 0, 0, 0);
        let ts = 86400 + Math.floor(now.getTime() / 1000) - 1
        return ts;
    },
    getXCMErrorDescription: function(errorDesc) {
        let errorMap = {}
        let officialErrors = [
            'AccountReaped|404|The account was reaped.',
            'Overflow|0|An arithmetic overflow happened.',
            'Unimplemented|1|The instruction is intentionally unsupported.',
            'UntrustedReserveLocation|2|Origin Register does not contain a value value for a reserve transfer notification.',
            'UntrustedTeleportLocation|3|Origin Register does not contain a value value for a teleport notification.',
            'MultiLocationFull|4|`MultiLocation` value too large to descend further.',
            'MultiLocationNotInvertible|5|`MultiLocation` value ascend more parents than known ancestors of local location.',
            'BadOrigin|6|The Origin Register does not contain a valid value for instruction.',
            'InvalidLocation|7|The location parameter is not a valid value for the instruction.',
            'AssetNotFound|8|The given asset is not handled.',
            'FailedToTransactAsset|9|An asset transaction (like withdraw or deposit) failed (typically due to type conversions).',
            'NotWithdrawable|10|An asset cannot be withdrawn, potentially due to lack of ownership, availability or rights.',
            'LocationCannotHold|11|An asset cannot be deposited under the ownership of a particular location.',
            'ExceedsMaxMessageSize|12|Attempt to send a message greater than the maximum supported by the transport protocol.',
            'DestinationUnsupported|13|The given message cannot be translated into a format supported by the destination.',
            'Transport|14|Destination is routable, but there is some issue with the transport mechanism.',
            'Unroutable|15|Destination is known to be unroutable.',
            'UnknownClaim|16|Used by `ClaimAsset` when the given claim could not be recognized/found.',
            'FailedToDecode|17|Used by `Transact` when the functor cannot be decoded.',
            'TooMuchWeightRequired|18|Used by `Transact` to indicate that the given weight limit could be breached by the functor.',
            'NotHoldingFees|19|Used by `BuyExecution` when the Holding Register does not contain payable fees.',
            'TooExpensive|20|Used by `BuyExecution` when the fees declared to purchase weight are insufficient.',
            'Trap(u64)|21|Used by the `Trap` instruction to force an error intentionally. Its code is included.',
            'ExpectationFalse|22|Used by `ExpectAsset`, `ExpectError` and `ExpectOrigin` when the expectation was not true.'
        ]
        for (const officialErr of officialErrors) {
            let e = officialErr.split('|')
            let errDetail = {
                errorCode: parseInt(e[1]),
                errorType: e[0],
                errorDesc: e[2],
            }
            errorMap[errDetail.errorType.toLowerCase()] = errDetail
        }
        let errPieces = errorDesc.split(':')
        let errorType = (errPieces.length == 2) ? errPieces[1] : 'NA'
        if (errorMap[errorType.toLowerCase()] != undefined) {
            return errorMap[errorType.toLowerCase()]
        }
        return {
            errorCode: 'NA',
            errorType: 'NA',
            errorDesc: errorDesc,
        }
    }

};