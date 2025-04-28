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

const fs = require('fs');
const Web3 = require("web3");
const web3 = new Web3();

const assetChainSeparator = "~"

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

function isInt(n) {
    return Number(n) === n && n % 1 === 0;
}

function isNumeric(str) {
  if (typeof str != "string") return false // we only process strings!
  return !isNaN(str) && // use type coercion to parse the _entirety_ of the string (`parseFloat` alone does not do this)...
         !isNaN(parseFloat(str)) // ...and ensure strings of whitespace fail
}

function dechexToInt(number) {
    if (number && typeof number == "string" && (number.length > 2) && number.substring(0, 2) == "0x") {
        return parseInt(number);
    }
    return parseInt(number)
}

function dechexAssetID(number) {
    if ((number.length > 2) && number.substring(0, 2) == "0x") {
        let n = hexToBn(number)
        return n.toString()
    } else {
        return `${parseInt(number)}`;
    }
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

// (0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF, polkadot-2004) -> {"Token":"42259045809535163221576417993425387648"}~polkadot-2004
function makeAssetChainFromXcContractAddress(xcAssetAddress, chainkey = 'polkadot-2004') {
    let xcAssetID = false
    let asset = {
        Token: null,
    }
    if (xcAssetAddress != undefined) {
        if (xcAssetAddress.length = 42 && xcAssetAddress.substr(0, 2) == "0x") {
            xcAssetID = contractAddrToXcAssetID(xcAssetAddress)
            asset.Token = xcAssetID
            return (JSON.stringify(asset) + assetChainSeparator + chainkey);
        }
    }
    return false
}

//'[{"network":"kusama"},{"parachain":2000},{"generalKey":"0x0080"}]'
//'[{"network":"kusama"},"here"]'
//'[{"network":"kusama"},{"parachain":2016}]'
function convert_xcmInteriorKey_to_xcmV1MultiLocation(xcmInteriorKey = 'polkadot~[{"parachain":1000},{"palletInstance":50},{"generalIndex":1984}]', isUppercase = false) {
    try {
        /*
        let pieces = xcmInteriorKey.split(assetChainSeparator);
        let relayChain = pieces[1];
        let assetUnparsed = (pieces.length > 1) ? pieces[1] : undefined;
        */
        let pieces = JSON.parse(xcmInteriorKey)
        //console.log(`xcmInteriorKey=${xcmInteriorKey}`, pieces)
        let network = pieces.shift()
        let assetUnparsed = {}
        if (pieces.length == 1) {
            assetUnparsed = JSON.stringify(pieces[0])
        } else {
            assetUnparsed = JSON.stringify(pieces)
        }
        // always use parent as reference
        let xcmVersionedMultiLocation = {}
        let xcmV1MultiLocation = {
            parents: 1,
            interior: {}
        }
        if (assetUnparsed == '"here"') {
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
            //console.log(`assetUnparsed ${assetUnparsed} interiorN=${interiorN},interior`, interior)
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
        console.log(`convert_xcmInteriorKey_to_xcmV1MultiLocation err`, e)
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
        console.log(`xcmV1MultiLocation_to_byte error`, JSON.stringify(xcmV1MultiLocation, null, 4), e)
    }
    return multiLocationHex
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
    let network = encodeNetwork(relayChain)
    if (xcmInteriorKey == 'here') {
        xcmInteriorKey = '"here"'
    }
    return makeXcmInteriorKeyV2(xcmInteriorKey, network)
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
    let interior = JSON.parse(interiorStr)
    let globalInterior = [network]
    if (Array.isArray(interior)) {
        globalInterior = globalInterior.concat(interior);
    } else {
        globalInterior.push(interior)
    }
    //return (relayChain + assetChainSeparator + interior);
    return JSON.stringify(globalInterior)
}

function makeXcmInteriorKeyV1(interior, relayChain = 'kusama') {
    return (interior + assetChainSeparator + relayChain);
}

function parseXcmInteriorKeyV1(xcmInteriorKey = '[{"parachain":2023},{"palletInstance":10}]~kusama') {
    let pieces = xcmInteriorKey.split(assetChainSeparator);
    let assetUnparsed = pieces[0];
    let relayChain = (pieces.length > 1) ? pieces[1] : undefined;
    return [assetUnparsed, relayChain];
}

function git_hash(isRelativePath = true) {
    //let path = (isRelativePath) ? '.' : ''
    let path = '.'
    let commitHash = 'NA'
    try {
        const rev = fs.readFileSync(`${path}/.git/HEAD`).toString().trim().split(/.*[: ]/).slice(-1)[0];
        if (rev.indexOf('/') === -1) {
            commitHash = `${rev}`.substr(0, 8)
            return commitHash;
        } else {
            commitHash = `${fs.readFileSync(`${path}/.git/` + rev).toString().trim()}`.substr(0, 8);
            return commitHash;
        }
    } catch (e) {
        console.log(`git_hash err ${e.toString()}`)
        return `NA`
    }
}

module.exports = {

    // DebugLevel
    debugNoLog: 0,
    debugErrorOnly: 1,
    debugInfo: 2,
    debugVerbose: 3,
    debugTracing: 4,

    // assetType
    assetTypeToken: "Token",
    assetTypeLiquidityPair: "LiquidityPair",
    assetTypeXCAsset: "XCAsset",
    assetTypeXCMTransfer: "XCMTransfer",

    stringToHex: function(x) {
        return stringToHex(x)
    },

    dechexToInt: function(number) {
        return dechexToInt(number);
    },
    dechexAssetID: function(number) {
        return dechexAssetID(number);
    },

    makeAssetChain: function(asset, chainkey = 'relaychain-paraID') {
        return (asset + assetChainSeparator + chainkey);
    },

    parseAssetChain: function(assetChainkey) {
        let pieces = assetChainkey.split(assetChainSeparator);
        let assetUnparsed = pieces[0];
        let chainkey = (pieces.length > 1) ? pieces[1] : undefined;
        return [assetUnparsed, chainkey];
    },

    /*
    makeXcmInteriorKeyV1: function(interior, relayChain = 'kusama') {
        return makeXcmInteriorKeyV1(interior, relayChain)
    },
    parseXcmInteriorKeyV1: function (xcmInteriorKey = '[{"parachain":2023},{"palletInstance":10}]~kusama') {
        return parseXcmInteriorKeyV1(xcmInteriorKey);
    },
    makeXcmInteriorKeyV2: function(interior, relayChain = 'kusama') {
        return makeXcmInteriorKeyV2(interior, relayChain)
    },
    parseXcmInteriorKeyV2: function (xcmInteriorKey = '[{"parachain":2023},{"palletInstance":10}]~kusama') {
        return parseXcmInteriorKeyV2(xcmInteriorKey);
    },
    */
    /*
    paraTool uses older XcmInteriorKeyV1 format, whereas xcmgarTool uses XcmInteriorKeyV2 format
    */
    makeXcmInteriorKey: function(interiorStr, network = {
        network: 'kusama'
    }) {
        return makeXcmInteriorKeyV2(interiorStr, network)
    },
    parseXcmInteriorKey: function(xcmInteriorKey = '[{"network":"polkadot"},{"parachain":2000},{"generalKey":"0x02f4c723e61709d90f89939c1852f516e373d418a8"}]') {
        return parseXcmInteriorKeyV2(xcmInteriorKey)
    },
    convertXcmInteriorKeyV1toV2: function(xcmInteriorKeyV1) {
        return convertXcmInteriorKeyV1toV2(xcmInteriorKeyV1)
    },
    convertXcmInteriorKeyV2toV1: function(xcmInteriorKeyV2) {
        return convertXcmInteriorKeyV2toV1(xcmInteriorKeyV2)
    },
    cleanedAssetID: function(assetID) {
        return toNumWithoutComma(assetID);
    },
    toNumWithComma: function(tx) {
        return toNumWithComma(tx)
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
    xcAssetIDToContractAddr: function(xcAssetID) {
        return xcAssetIDToContractAddr(xcAssetID)
    },
    contractAddrToXcAssetID: function(xcAssetAddress) {
        return contractAddrToXcAssetID(xcAssetAddress)
    },
    makeAssetChainFromXcContractAddress: function(xcContractAddress, chainkey) {
        return makeAssetChainFromXcContractAddress(xcContractAddress, chainkey);
    },
    convertXcmInteriorKeyToXcmV1MultiLocation: function(xcmInteriorKey, isUppercase = false) {
        return convert_xcmInteriorKey_to_xcmV1MultiLocation(xcmInteriorKey, isUppercase)
    },
    convertXcmV1MultiLocationToByte: function(xcmV1MultiLocation, api = false) {
        //return false
        return convert_xcmV1MultiLocation_to_byte(xcmV1MultiLocation, api)
    },
    encodeNetwork: function(relayChain = 'polkadot') {
        return encodeNetwork(relayChain)
    },
    commitHash: function(shortHash = true) {
        return git_hash(shortHash)
    },
    isInt: function(x) {
        return isInt(x)
    },
    isNumeric: function(x) {
        return isNumeric(x)
    },
    bnToHex: function(x) {
        return bnToHex(x)
    },
};
