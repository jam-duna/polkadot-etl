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

const Web3 = require("web3");
const web3 = new Web3();
const util = require('util');
const rlp = require('rlp')
const paraTool = require("./paraTool");
const {
    Transaction
} = require('@ethereumjs/tx')

const exec = util.promisify(require("child_process").exec);
const {
    ethers
} = require("ethers");

const {
    EVM
} = require("evm");
const whatsabi = require("@shazow/whatsabi")

function shexdec(inp) {
    return parseInt(inp.replace("0x", ""), 16);
}

function dechex(number) {
    return parseInt(number, 10).toString(16);
}

function dechexToInt(number) {
    if ((number.length > 2) && number.substring(0, 2) == "0x") {
        return parseInt(number)
    } else {
        return parseInt(number);
    }
}

function firstCharUpperCase(inp) {
    return inp.substr(0, 1).toUpperCase() + inp.substr(1)
}

function execPromise(command) {
    return new Promise(function(resolve, reject) {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                reject(error);
                return;
            }

            resolve(stdout.trim());
        });
    });
}

//ipfs://bafkreid5dy3f75af7snusqe3nopbi5tryiqxbs7uxwv5ypcckaomez4opi
function convert_ifps_link(ipfsURL) {
    let gatewayID = 0
    let gateway;
    switch (gatewayID) {
        case 1:
            gateway = 'https://gateway.pinata.cloud'
            break;
        default:
            gateway = 'https://ipfs.io'
    }

    if (ipfsURL.length >= 8 && ipfsURL.substr(0, 7) == 'ipfs://') {
        return `${gateway}/ipfs/${ipfsURL.substr(7)}`
    }
    return ipfsURL
}

async function crawl_link(url) {
    if (url.length >= 53 && url.substr(0, 7) == 'ipfs://') {
        url = `https://ipfs.io/ipfs/${url.substr(7)}`
    }
    const cmd = `curl --max-time 60 --connect-timeout 30 '${url}'`
    let result
    try {
        //console.log("CRAWLING " + bn)
        //console.log(cmd)
        result = await execPromise(cmd)
        let r = JSON.parse(result)
        return r
    } catch (e) {
        console.error(`call failed ${url} [${result}]`, e.toString())
        return false;
    }
}

//var routerContract = initContract(web3Api, routerABI, '0x7a3909C7996EFE42d425cD932fc44E3840fCAB71') // 0x4c660218a62367a7cfe4cd47f654a503ada1bb4a2adb0de1678aabc0ced320a1

var uniswapV2ReservesABI = JSON.parse('[{"constant":true,"inputs":[],"name":"getReserves","outputs":[{"internalType":"uint112","name":"_reserve0","type":"uint112"},{"internalType":"uint112","name":"_reserve1","type":"uint112"},{"internalType":"uint32","name":"_blockTimestampLast","type":"uint32"}],"payable":false,"stateMutability":"view","type":"function"}]')
var zenLinkReservesABI = JSON.parse('[{"inputs":[],"name":"getReserves","outputs":[{"internalType":"uint112","name":"_reserve0","type":"uint112"},{"internalType":"uint112","name":"_reserve1","type":"uint112"}],"stateMutability":"view","type":"function"}]')

var routerABI = JSON.parse('[{"inputs":[{"internalType":"address","name":"_factory","type":"address"},{"internalType":"address","name":"_WETH","type":"address"}],"stateMutability":"nonpayable","type":"constructor"},{"inputs":[],"name":"WETH","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"tokenA","type":"address"},{"internalType":"address","name":"tokenB","type":"address"},{"internalType":"uint256","name":"amountADesired","type":"uint256"},{"internalType":"uint256","name":"amountBDesired","type":"uint256"},{"internalType":"uint256","name":"amountAMin","type":"uint256"},{"internalType":"uint256","name":"amountBMin","type":"uint256"},{"internalType":"address","name":"to","type":"address"},{"internalType":"uint256","name":"deadline","type":"uint256"}],"name":"addLiquidity","outputs":[{"internalType":"uint256","name":"amountA","type":"uint256"},{"internalType":"uint256","name":"amountB","type":"uint256"},{"internalType":"uint256","name":"liquidity","type":"uint256"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"token","type":"address"},{"internalType":"uint256","name":"amountTokenDesired","type":"uint256"},{"internalType":"uint256","name":"amountTokenMin","type":"uint256"},{"internalType":"uint256","name":"amountETHMin","type":"uint256"},{"internalType":"address","name":"to","type":"address"},{"internalType":"uint256","name":"deadline","type":"uint256"}],"name":"addLiquidityETH","outputs":[{"internalType":"uint256","name":"amountToken","type":"uint256"},{"internalType":"uint256","name":"amountETH","type":"uint256"},{"internalType":"uint256","name":"liquidity","type":"uint256"}],"stateMutability":"payable","type":"function"},{"inputs":[],"name":"factory","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"amountOut","type":"uint256"},{"internalType":"uint256","name":"reserveIn","type":"uint256"},{"internalType":"uint256","name":"reserveOut","type":"uint256"}],"name":"getAmountIn","outputs":[{"internalType":"uint256","name":"amountIn","type":"uint256"}],"stateMutability":"pure","type":"function"},{"inputs":[{"internalType":"uint256","name":"amountIn","type":"uint256"},{"internalType":"uint256","name":"reserveIn","type":"uint256"},{"internalType":"uint256","name":"reserveOut","type":"uint256"}],"name":"getAmountOut","outputs":[{"internalType":"uint256","name":"amountOut","type":"uint256"}],"stateMutability":"pure","type":"function"},{"inputs":[{"internalType":"uint256","name":"amountOut","type":"uint256"},{"internalType":"address[]","name":"path","type":"address[]"}],"name":"getAmountsIn","outputs":[{"internalType":"uint256[]","name":"amounts","type":"uint256[]"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"amountIn","type":"uint256"},{"internalType":"address[]","name":"path","type":"address[]"}],"name":"getAmountsOut","outputs":[{"internalType":"uint256[]","name":"amounts","type":"uint256[]"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"amountA","type":"uint256"},{"internalType":"uint256","name":"reserveA","type":"uint256"},{"internalType":"uint256","name":"reserveB","type":"uint256"}],"name":"quote","outputs":[{"internalType":"uint256","name":"amountB","type":"uint256"}],"stateMutability":"pure","type":"function"},{"inputs":[{"internalType":"address","name":"tokenA","type":"address"},{"internalType":"address","name":"tokenB","type":"address"},{"internalType":"uint256","name":"liquidity","type":"uint256"},{"internalType":"uint256","name":"amountAMin","type":"uint256"},{"internalType":"uint256","name":"amountBMin","type":"uint256"},{"internalType":"address","name":"to","type":"address"},{"internalType":"uint256","name":"deadline","type":"uint256"}],"name":"removeLiquidity","outputs":[{"internalType":"uint256","name":"amountA","type":"uint256"},{"internalType":"uint256","name":"amountB","type":"uint256"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"token","type":"address"},{"internalType":"uint256","name":"liquidity","type":"uint256"},{"internalType":"uint256","name":"amountTokenMin","type":"uint256"},{"internalType":"uint256","name":"amountETHMin","type":"uint256"},{"internalType":"address","name":"to","type":"address"},{"internalType":"uint256","name":"deadline","type":"uint256"}],"name":"removeLiquidityETH","outputs":[{"internalType":"uint256","name":"amountToken","type":"uint256"},{"internalType":"uint256","name":"amountETH","type":"uint256"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"token","type":"address"},{"internalType":"uint256","name":"liquidity","type":"uint256"},{"internalType":"uint256","name":"amountTokenMin","type":"uint256"},{"internalType":"uint256","name":"amountETHMin","type":"uint256"},{"internalType":"address","name":"to","type":"address"},{"internalType":"uint256","name":"deadline","type":"uint256"},{"internalType":"bool","name":"approveMax","type":"bool"},{"internalType":"uint8","name":"v","type":"uint8"},{"internalType":"bytes32","name":"r","type":"bytes32"},{"internalType":"bytes32","name":"s","type":"bytes32"}],"name":"removeLiquidityETHWithPermit","outputs":[{"internalType":"uint256","name":"amountToken","type":"uint256"},{"internalType":"uint256","name":"amountETH","type":"uint256"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"tokenA","type":"address"},{"internalType":"address","name":"tokenB","type":"address"},{"internalType":"uint256","name":"liquidity","type":"uint256"},{"internalType":"uint256","name":"amountAMin","type":"uint256"},{"internalType":"uint256","name":"amountBMin","type":"uint256"},{"internalType":"address","name":"to","type":"address"},{"internalType":"uint256","name":"deadline","type":"uint256"},{"internalType":"bool","name":"approveMax","type":"bool"},{"internalType":"uint8","name":"v","type":"uint8"},{"internalType":"bytes32","name":"r","type":"bytes32"},{"internalType":"bytes32","name":"s","type":"bytes32"}],"name":"removeLiquidityWithPermit","outputs":[{"internalType":"uint256","name":"amountA","type":"uint256"},{"internalType":"uint256","name":"amountB","type":"uint256"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"amountOut","type":"uint256"},{"internalType":"address[]","name":"path","type":"address[]"},{"internalType":"address","name":"to","type":"address"},{"internalType":"uint256","name":"deadline","type":"uint256"}],"name":"swapETHForExactTokens","outputs":[{"internalType":"uint256[]","name":"amounts","type":"uint256[]"}],"stateMutability":"payable","type":"function"},{"inputs":[{"internalType":"uint256","name":"amountOutMin","type":"uint256"},{"internalType":"address[]","name":"path","type":"address[]"},{"internalType":"address","name":"to","type":"address"},{"internalType":"uint256","name":"deadline","type":"uint256"}],"name":"swapExactETHForTokens","outputs":[{"internalType":"uint256[]","name":"amounts","type":"uint256[]"}],"stateMutability":"payable","type":"function"},{"inputs":[{"internalType":"uint256","name":"amountIn","type":"uint256"},{"internalType":"uint256","name":"amountOutMin","type":"uint256"},{"internalType":"address[]","name":"path","type":"address[]"},{"internalType":"address","name":"to","type":"address"},{"internalType":"uint256","name":"deadline","type":"uint256"}],"name":"swapExactTokensForETH","outputs":[{"internalType":"uint256[]","name":"amounts","type":"uint256[]"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"amountIn","type":"uint256"},{"internalType":"uint256","name":"amountOutMin","type":"uint256"},{"internalType":"address[]","name":"path","type":"address[]"},{"internalType":"address","name":"to","type":"address"},{"internalType":"uint256","name":"deadline","type":"uint256"}],"name":"swapExactTokensForTokens","outputs":[{"internalType":"uint256[]","name":"amounts","type":"uint256[]"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"amountOut","type":"uint256"},{"internalType":"uint256","name":"amountInMax","type":"uint256"},{"internalType":"address[]","name":"path","type":"address[]"},{"internalType":"address","name":"to","type":"address"},{"internalType":"uint256","name":"deadline","type":"uint256"}],"name":"swapTokensForExactETH","outputs":[{"internalType":"uint256[]","name":"amounts","type":"uint256[]"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"amountOut","type":"uint256"},{"internalType":"uint256","name":"amountInMax","type":"uint256"},{"internalType":"address[]","name":"path","type":"address[]"},{"internalType":"address","name":"to","type":"address"},{"internalType":"uint256","name":"deadline","type":"uint256"}],"name":"swapTokensForExactTokens","outputs":[{"internalType":"uint256[]","name":"amounts","type":"uint256[]"}],"stateMutability":"nonpayable","type":"function"},{"stateMutability":"payable","type":"receive"}]')


var swapABI = JSON.parse('[{"inputs":[],"payable":false,"stateMutability":"nonpayable","type":"constructor"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"owner","type":"address"},{"indexed":true,"internalType":"address","name":"spender","type":"address"},{"indexed":false,"internalType":"uint256","name":"value","type":"uint256"}],"name":"Approval","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"sender","type":"address"},{"indexed":false,"internalType":"uint256","name":"amount0","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"amount1","type":"uint256"},{"indexed":true,"internalType":"address","name":"to","type":"address"}],"name":"Burn","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"sender","type":"address"},{"indexed":false,"internalType":"uint256","name":"amount0","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"amount1","type":"uint256"}],"name":"Mint","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"sender","type":"address"},{"indexed":false,"internalType":"uint256","name":"amount0In","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"amount1In","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"amount0Out","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"amount1Out","type":"uint256"},{"indexed":true,"internalType":"address","name":"to","type":"address"}],"name":"Swap","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"uint112","name":"reserve0","type":"uint112"},{"indexed":false,"internalType":"uint112","name":"reserve1","type":"uint112"}],"name":"Sync","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"from","type":"address"},{"indexed":true,"internalType":"address","name":"to","type":"address"},{"indexed":false,"internalType":"uint256","name":"value","type":"uint256"}],"name":"Transfer","type":"event"},{"constant":true,"inputs":[],"name":"DOMAIN_SEPARATOR","outputs":[{"internalType":"bytes32","name":"","type":"bytes32"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[],"name":"MINIMUM_LIQUIDITY","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[],"name":"PERMIT_TYPEHASH","outputs":[{"internalType":"bytes32","name":"","type":"bytes32"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[{"internalType":"address","name":"","type":"address"},{"internalType":"address","name":"","type":"address"}],"name":"allowance","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"internalType":"address","name":"spender","type":"address"},{"internalType":"uint256","name":"value","type":"uint256"}],"name":"approve","outputs":[{"internalType":"bool","name":"","type":"bool"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[{"internalType":"address","name":"","type":"address"}],"name":"balanceOf","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"internalType":"address","name":"to","type":"address"}],"name":"burn","outputs":[{"internalType":"uint256","name":"amount0","type":"uint256"},{"internalType":"uint256","name":"amount1","type":"uint256"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[],"name":"decimals","outputs":[{"internalType":"uint8","name":"","type":"uint8"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[],"name":"factory","outputs":[{"internalType":"address","name":"","type":"address"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[],"name":"getReserves","outputs":[{"internalType":"uint112","name":"_reserve0","type":"uint112"},{"internalType":"uint112","name":"_reserve1","type":"uint112"},{"internalType":"uint32","name":"_blockTimestampLast","type":"uint32"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"internalType":"address","name":"_token0","type":"address"},{"internalType":"address","name":"_token1","type":"address"}],"name":"initialize","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[],"name":"kLast","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"internalType":"address","name":"to","type":"address"}],"name":"mint","outputs":[{"internalType":"uint256","name":"liquidity","type":"uint256"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[],"name":"name","outputs":[{"internalType":"string","name":"","type":"string"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[{"internalType":"address","name":"","type":"address"}],"name":"nonces","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"internalType":"address","name":"owner","type":"address"},{"internalType":"address","name":"spender","type":"address"},{"internalType":"uint256","name":"value","type":"uint256"},{"internalType":"uint256","name":"deadline","type":"uint256"},{"internalType":"uint8","name":"v","type":"uint8"},{"internalType":"bytes32","name":"r","type":"bytes32"},{"internalType":"bytes32","name":"s","type":"bytes32"}],"name":"permit","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[],"name":"price0CumulativeLast","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[],"name":"price1CumulativeLast","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"internalType":"address","name":"to","type":"address"}],"name":"skim","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[{"internalType":"uint256","name":"amount0Out","type":"uint256"},{"internalType":"uint256","name":"amount1Out","type":"uint256"},{"internalType":"address","name":"to","type":"address"},{"internalType":"bytes","name":"data","type":"bytes"}],"name":"swap","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[],"name":"symbol","outputs":[{"internalType":"string","name":"","type":"string"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[],"name":"sync","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[],"name":"token0","outputs":[{"internalType":"address","name":"","type":"address"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[],"name":"token1","outputs":[{"internalType":"address","name":"","type":"address"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[],"name":"totalSupply","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"internalType":"address","name":"to","type":"address"},{"internalType":"uint256","name":"value","type":"uint256"}],"name":"transfer","outputs":[{"internalType":"bool","name":"","type":"bool"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[{"internalType":"address","name":"from","type":"address"},{"internalType":"address","name":"to","type":"address"},{"internalType":"uint256","name":"value","type":"uint256"}],"name":"transferFrom","outputs":[{"internalType":"bool","name":"","type":"bool"}],"payable":false,"stateMutability":"nonpayable","type":"function"}]')


var erc721ViewABI = JSON.parse('[{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"owner","type":"address"},{"indexed":true,"internalType":"address","name":"approved","type":"address"},{"indexed":true,"internalType":"uint256","name":"tokenId","type":"uint256"}],"name":"Approval","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"owner","type":"address"},{"indexed":true,"internalType":"address","name":"operator","type":"address"},{"indexed":false,"internalType":"bool","name":"approved","type":"bool"}],"name":"ApprovalForAll","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"from","type":"address"},{"indexed":true,"internalType":"address","name":"to","type":"address"},{"indexed":true,"internalType":"uint256","name":"tokenId","type":"uint256"}],"name":"Transfer","type":"event"},{"inputs":[{"internalType":"address","name":"to","type":"address"},{"internalType":"uint256","name":"tokenId","type":"uint256"}],"name":"approve","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"owner","type":"address"}],"name":"balanceOf","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"tokenId","type":"uint256"}],"name":"getApproved","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"owner","type":"address"},{"internalType":"address","name":"operator","type":"address"}],"name":"isApprovedForAll","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"name","outputs":[{"internalType":"string","name":"","type":"string"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"tokenId","type":"uint256"}],"name":"ownerOf","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"bytes4","name":"interfaceId","type":"bytes4"}],"name":"supportsInterface","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"symbol","outputs":[{"internalType":"string","name":"","type":"string"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"index","type":"uint256"}],"name":"tokenByIndex","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"owner","type":"address"},{"internalType":"uint256","name":"index","type":"uint256"}],"name":"tokenOfOwnerByIndex","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"tokenId","type":"uint256"}],"name":"tokenURI","outputs":[{"internalType":"string","name":"","type":"string"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"totalSupply","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"}, {"inputs":[],"name":"baseURI","outputs":[{"internalType":"string","name":"","type":"string"}],"stateMutability":"view","type":"function"}]')

const erc20ABI = JSON.parse('[{"constant":true,"inputs":[],"name":"name","outputs":[{"name":"","type":"string"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"name":"_spender","type":"address"},{"name":"_value","type":"uint256"}],"name":"approve","outputs":[{"name":"","type":"bool"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[],"name":"totalSupply","outputs":[{"name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"name":"_from","type":"address"},{"name":"_to","type":"address"},{"name":"_value","type":"uint256"}],"name":"transferFrom","outputs":[{"name":"","type":"bool"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[],"name":"decimals","outputs":[{"name":"","type":"uint8"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[{"name":"_owner","type":"address"}],"name":"balanceOf","outputs":[{"name":"balance","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[],"name":"symbol","outputs":[{"name":"","type":"string"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"name":"_to","type":"address"},{"name":"_value","type":"uint256"}],"name":"transfer","outputs":[{"name":"","type":"bool"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[{"name":"_owner","type":"address"},{"name":"_spender","type":"address"}],"name":"allowance","outputs":[{"name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"payable":true,"stateMutability":"payable","type":"fallback"},{"anonymous":false,"inputs":[{"indexed":true,"name":"owner","type":"address"},{"indexed":true,"name":"spender","type":"address"},{"indexed":false,"name":"value","type":"uint256"}],"name":"Approval","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"from","type":"address"},{"indexed":true,"name":"to","type":"address"},{"indexed":false,"name":"value","type":"uint256"}],"name":"Transfer","type":"event"}]')

const erc721ABI = JSON.parse('[{"constant":true,"inputs":[{"name":"interfaceId","type":"bytes4"}],"name":"supportsInterface","outputs":[{"name":"","type":"bool"}],"payable":false,"stateMutability":"view","type":"function"},{"inputs":[],"payable":false,"stateMutability":"nonpayable","type":"constructor"},{"anonymous":false,"inputs":[{"indexed":true,"name":"from","type":"address"},{"indexed":true,"name":"to","type":"address"},{"indexed":true,"name":"tokenId","type":"uint256"}],"name":"Transfer","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"owner","type":"address"},{"indexed":true,"name":"approved","type":"address"},{"indexed":true,"name":"tokenId","type":"uint256"}],"name":"Approval","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"owner","type":"address"},{"indexed":true,"name":"operator","type":"address"},{"indexed":false,"name":"approved","type":"bool"}],"name":"ApprovalForAll","type":"event"},{"constant":true,"inputs":[{"name":"owner","type":"address"}],"name":"balanceOf","outputs":[{"name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[{"name":"tokenId","type":"uint256"}],"name":"ownerOf","outputs":[{"name":"","type":"address"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"name":"to","type":"address"},{"name":"tokenId","type":"uint256"}],"name":"approve","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[{"name":"tokenId","type":"uint256"}],"name":"getApproved","outputs":[{"name":"","type":"address"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"name":"to","type":"address"},{"name":"approved","type":"bool"}],"name":"setApprovalForAll","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[{"name":"owner","type":"address"},{"name":"operator","type":"address"}],"name":"isApprovedForAll","outputs":[{"name":"","type":"bool"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"name":"to","type":"address"},{"name":"tokenId","type":"uint256"}],"name":"transfer","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[{"name":"from","type":"address"},{"name":"to","type":"address"},{"name":"tokenId","type":"uint256"}],"name":"transferFrom","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[{"name":"from","type":"address"},{"name":"to","type":"address"},{"name":"tokenId","type":"uint256"}],"name":"safeTransferFrom","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[{"name":"from","type":"address"},{"name":"to","type":"address"},{"name":"tokenId","type":"uint256"},{"name":"_data","type":"bytes"}],"name":"safeTransferFrom","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"}]')

const erc1155ABI = JSON.parse('[{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"account","type":"address"},{"indexed":true,"internalType":"address","name":"operator","type":"address"},{"indexed":false,"internalType":"bool","name":"approved","type":"bool"}],"name":"ApprovalForAll","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"operator","type":"address"},{"indexed":true,"internalType":"address","name":"from","type":"address"},{"indexed":true,"internalType":"address","name":"to","type":"address"},{"indexed":false,"internalType":"uint256[]","name":"ids","type":"uint256[]"},{"indexed":false,"internalType":"uint256[]","name":"values","type":"uint256[]"}],"name":"TransferBatch","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"operator","type":"address"},{"indexed":true,"internalType":"address","name":"from","type":"address"},{"indexed":true,"internalType":"address","name":"to","type":"address"},{"indexed":false,"internalType":"uint256","name":"id","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"value","type":"uint256"}],"name":"TransferSingle","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"string","name":"value","type":"string"},{"indexed":true,"internalType":"uint256","name":"id","type":"uint256"}],"name":"URI","type":"event"},{"inputs":[{"internalType":"address","name":"account","type":"address"},{"internalType":"uint256","name":"id","type":"uint256"}],"name":"balanceOf","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address[]","name":"accounts","type":"address[]"},{"internalType":"uint256[]","name":"ids","type":"uint256[]"}],"name":"balanceOfBatch","outputs":[{"internalType":"uint256[]","name":"","type":"uint256[]"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"account","type":"address"},{"internalType":"address","name":"operator","type":"address"}],"name":"isApprovedForAll","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"from","type":"address"},{"internalType":"address","name":"to","type":"address"},{"internalType":"uint256[]","name":"ids","type":"uint256[]"},{"internalType":"uint256[]","name":"amounts","type":"uint256[]"},{"internalType":"bytes","name":"data","type":"bytes"}],"name":"safeBatchTransferFrom","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"from","type":"address"},{"internalType":"address","name":"to","type":"address"},{"internalType":"uint256","name":"id","type":"uint256"},{"internalType":"uint256","name":"amount","type":"uint256"},{"internalType":"bytes","name":"data","type":"bytes"}],"name":"safeTransferFrom","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"operator","type":"address"},{"internalType":"bool","name":"approved","type":"bool"}],"name":"setApprovalForAll","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"bytes4","name":"interfaceId","type":"bytes4"}],"name":"supportsInterface","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"id","type":"uint256"}],"name":"uri","outputs":[{"internalType":"string","name":"","type":"string"}],"stateMutability":"view","type":"function"}]')

function getABIByAssetType(assetType) {
    switch (assetType) {
        case "Token":
        case "ERC20":
            return erc20ABI;
        case "ERC20LP":
            return swapABI;
        case "ERC1155":
            return erc1155ABI;
        case "ERC721":
            return erc721ABI;
        case "ERC20LPRouter": // TODO
            return routerABI;
        default:
            return null;
    }
}

function recoveredABIToMap(recoveredAbi) {
    let fldTypeMap = {}
    // Function to process inputs (including nested components)
    const processInputs = (inputs) => {
        for (const input of inputs) {
            fldTypeMap[input.name] = input.type;
            if (input.components) {
                processInputs(input.components);
            }
        }
    };
    // Process top-level inputs
    processInputs(recoveredAbi.inputs);
    return fldTypeMap;
}

function processEthersDecoded(v, fldTypeMap = {}) {
    let events = []
    let keyList = Object.keys(v);
    let keyListLen = Object.keys(v).length
    let fLen = v.length
    const half = Math.ceil(keyList.length / 2);
    const firstHalf = keyList.slice(0, half);
    const secondHalf = keyList.slice(half);
    var targetSlice = keyList.slice(half);
    if (keyListLen == fLen) {
        //console.log(`v ${keyList} has same length, keyListLen=${keyListLen}, fLen=${fLen}`, v)
    } else {
        //console.log(`v ${keyList} has different length!! keyListLen=${keyListLen}, fLen=${fLen}`, v)
    }
    for (const s of targetSlice) {
        let f = v[s];
        let fType = null;
        if (fldTypeMap[s] != undefined) {
            fType = fldTypeMap[s];
        }
        if (f && f._isBigNumber) {
            f = f.toString();
        }

        // Check if the field is an array and has named fields
        if (Array.isArray(f) && Object.keys(f).length > f.length) {
            let nestedObj = {};
            const nestedKeys = Object.keys(f).slice(f.length); // get the keys from the second half
            for (let i = 0; i < f.length; i++) {
                nestedObj[nestedKeys[i]] = f[i];
            }
            f = processEthersDecoded(nestedObj, fldTypeMap);
        }

        // Check if the field is an array and the keys match the length (indicating it is a typed array).
        else if (Array.isArray(f) && Object.keys(f).length === f.length && f.length > 0 && !Array.isArray(f[0])) {
            //console.log(`case aa Object.keys(f)=${Object.keys(f)}, f.length=${f.length}`, f)
            let bigNumberArray = f.map(item => item._isBigNumber ? item.toString() : item);
            f = bigNumberArray;
        }

        // Check if the field is an array and has nested objects.
        else if (Array.isArray(f) && f.length > 0 && typeof f[0] === 'object' && f[0] !== null) {
            let nestedEvents = [];
            //console.log(`case bb`, f)
            for (const nestedObj of f) {
                nestedEvents.push(processEthersDecoded(nestedObj, fldTypeMap));
            }
            f = nestedEvents;
        }

        let r = {
            name: s,
            type: fType,
            value: f,
        };
        events.push(r);
    }
    return events;
}

function computeSelector(signature, byteLen = 4) {
    let hash = web3.utils.keccak256(signature).substr(0, byteLen * 2 + 2)
    return hash
}

function detectERC165(codeHashInfo, bytecode) {
    /*
    (Required)
    'supportsInterface(bytes4)' //0x01ffc9a7
    */
    let erc165FuncList = ['0x01ffc9a7']
    let isERC165 = false
    if (codeHashInfo) {
        isERC165 = erc165FuncList.every(f => codeHashInfo.func.includes(f))
    }
    return isERC165
}

function detectERC20(codeHashInfo, bytecode) {
    /*
    (Optional)
    'name()' //0x06fdde03
    'symbol()' //0x95d89b41
    'decimals()' //0x313ce567

    (Required)
    'totalSupply()' //0x18160ddd
    'balanceOf(address)' //0x70a08231
    'transfer(address,uint256)' //0xa9059cbb
    'transferFrom(address,address,uint256)' //0x23b872dd
    'approve(address,uint256)' //0x095ea7b3
    'allowance(address,address)' //0xdd62ed3e
    'Approval(address indexed _owner, address indexed _spender, uint256 _value)' //0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925
    'Transfer(address indexed _from, address indexed _to, uint256 _value)'  	 //0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
    */
    let erc20FuncList = ['0x18160ddd', '0x70a08231', '0xa9059cbb', '0x23b872dd', '0x095ea7b3', '0xdd62ed3e']
    let erc20EventList = ['0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925', '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef']
    let isERC20 = false
    if (codeHashInfo) {
        //isERC20 = erc20FuncList.every(f => codeHashInfo.func.includes(f)) && erc20EventList.every(f => bytecode.includes(f.substr(2)))
        let containsERC20Func = erc20FuncList.every(f => codeHashInfo.func.includes(f)) || erc20FuncList.every(f => bytecode.includes(f.substr(2)))
        //let containsERC20Evt = erc20EventList.every(f => codeHashInfo.events.includes(f)) || erc20EventList.every(f => bytecode.includes(f.substr(2)))
        isERC20 = containsERC20Func
    }
    return isERC20
}

function detectERC721(codeHashInfo, bytecode) {
    /*
    (Optional)
    'name()' //0x06fdde03
    'symbol()' //0x95d89b41
    'tokenURI(uint256)' //0xc87b56dd

    (Required)

    'balanceOf(address)' //0x70a08231
    'ownerOf(uint256)' //0x6352211e
    'safeTransferFrom(address,address,uint256)' //0x42842e0e
    'safeTransferFrom(address,address,uint256, byte)' //0xb88d4fde
    'transferFrom(address,address,uint256)' //0x23b872dd
    'approve(address,uint256)' //0x095ea7b3
    'getApproved(uint256)' //0x081812fc
    'setApprovalForAll(address,bool)' //0xa22cb465
    'isApprovedForAll(address,address)' //0xe985e9c5

    'Transfer(address indexed _from, address indexed _to, uint256 indexed _tokenId)' //0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
    'Approval(address indexed _owner, address indexed _approved, uint256 indexed _tokenId)' //0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925
    'ApprovalForAll(address indexed _owner, address indexed _operator, bool _approved)' //0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31
    */

    let erc721FuncList = ['0x70a08231', '0x6352211e', '0x42842e0e', '0xb88d4fde', '0x23b872dd', '0x095ea7b3', '0x081812fc', '0xa22cb465', '0xe985e9c5']
    let erc721EventList = ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925', '0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31']
    let isERC721 = false
    if (codeHashInfo) {
        //isERC721 = erc721FuncList.every(f => codeHashInfo.func.includes(f)) && erc721EventList.every(e => codeHashInfo.events.includes(e))
        let containsERC721Func = erc721FuncList.every(f => codeHashInfo.func.includes(f)) || erc721FuncList.every(f => bytecode.includes(f.substr(2)))
        //let containsERC721Evt = erc721EventList.every(f => codeHashInfo.events.includes(f)) || erc721EventList.every(f => bytecode.includes(f.substr(2)))
        isERC721 = containsERC721Func
    }
    return isERC721
}

function detectERC1155(codeHashInfo, bytecode) {
    /*
    (Required)

    'balanceOf(address,uint256)' //0x00fdd58e
    'balanceOfBatch(address[],uint256[])' //0x4e1273f4
    'setApprovalForAll(address,bool)' //0xa22cb465
    'isApprovedForAll(address,address)' //0xe985e9c5
    'safeTransferFrom(address,address,uint256,uint256,bytes)' //0xf242432a
    'safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)' //0x2eb2c2d6

    'TransferSingle(address,address,address,uint256,uint256)' //0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62
    'TransferBatch(address,address,address,uint256[],uint256[])' //0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb
    'ApprovalForAll(address,address,bool)' //0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31
    'URI(string,uint256)' //0x6bb7ff708619ba0610cba295a58592e0451dee2622938c8755667688daf3529b
    */

    let erc1155FuncList = ['0x00fdd58e', '0x4e1273f4', '0xa22cb465', '0xe985e9c5', '0xf242432a', '0x2eb2c2d6'];
    let erc1155EventList = ['0xce567dca3f200f220920489ca2b5937696c31e25759ff6cb3582b35133d50fdd', '0x4e8a6893a947e8293beb559c78d360a8b657ed145adab57611365a2c9ce4987f', '0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31', '0x0e89341c1d7b373c554619aebc66b5346cd25d8a062de9b97e7f4c36665b7702'];
    let isERC1155 = false;
    if (codeHashInfo) {
        //isERC1155 = erc1155FuncList.every(f => codeHashInfo.func.includes(f)) && erc1155EventList.every(e => codeHashInfo.events.includes(e));
        let containsERC1155Func = erc1155FuncList.every(f => codeHashInfo.func.includes(f)) || erc1155FuncList.every(f => bytecode.includes(f.substr(2)))
        //let containsERC1155Evt = erc1155EventList.every(f => codeHashInfo.events.includes(f)) || erc1155EventList.every(f => bytecode.includes(f.substr(2)))
        isERC1155 = containsERC1155Func
    }
    return isERC1155;
}

function initContract(web3Api, contractABI, contractAddress) {
    try {
        let checkSumContractAddr = web3.utils.toChecksumAddress(contractAddress)
        let contract = new web3Api.eth.Contract(contractABI, checkSumContractAddr);
        return contract
    } catch (err) {
        console.log(`initContract ${contractAddress}`, err)
    }
    return false
}

async function getERC721NFTMeta(web3Api, contractAddress, tokenID, fetchMeta = false, bn = 'latest') {
    //tokenID space (uint256) is too large. must convert to hexString
    let tokenIDHex = web3.utils.toHex(tokenID);
    let tokenIDBN = web3.utils.toBN(tokenIDHex).toString();
    let ERC721MetadataID = '0x5b5e139f'
    let checkSumContractAddr = web3.utils.toChecksumAddress(contractAddress)
    let erc721ViewContract = initContract(web3Api, erc721ViewABI, checkSumContractAddr)
    let isMetadata = false
    if (bn == 'latest') {
        bn = await web3Api.eth.getBlockNumber()
    }

    var statusesPromise = Promise.allSettled([
        erc721ViewContract.methods.supportsInterface(ERC721MetadataID).call({}, bn),
        erc721ViewContract.methods.tokenURI(tokenIDHex).call({}, bn),
        erc721ViewContract.methods.ownerOf(tokenIDHex).call({}, bn)
    ])
    var [isERC721MetadataTest, tokenURI, ownerOf] = await statusesPromise;
    if (isERC721MetadataTest.status == 'fulfilled') {
        isMetadata = isERC721MetadataTest.value
    }
    if (isMetadata) {
        let nftURI = (tokenURI.status == 'fulfilled') ? tokenURI.value : 'nonexistent token'
        let tokenOwner = (ownerOf.status == 'fulfilled') ? ownerOf.value : 'nonexistent token'
        let nftTokenMetadata = {
            blockNumber: bn,
            tokenAddress: checkSumContractAddr,
            tokenType: 'ERC721Token',
            isMetadataSupported: isMetadata,
            tokenID: tokenIDBN,
        }
        if (tokenOwner == 'nonexistent token') {
            nftTokenMetadata.error = 'tokenID not exist'
            return false
        } else {
            nftTokenMetadata.tokenURI = nftURI
            if (nftURI != 'nonexistent token' && fetchMeta) {
                let fetchedMeta = await crawl_link(nftURI)
                if (fetchedMeta) {
                    nftTokenMetadata.metadata = fetchedMeta
                }
            }
            nftTokenMetadata.owner = tokenOwner
        }
        return nftTokenMetadata
    }
    return false
}

//check if a contract is erc721 by checking interfaceId
async function getERC721ContractInfo(web3Api, contractAddress, bn = 'latest') {
    let ERC721ID = '0x80ac58cd'
    let ERC721MetadataID = '0x5b5e139f' // optional function available: (name, symbol, tokenURI, baseURI)
    let ERC721EnumerableID = '0x780e9d63' // optional function available: (totalSupply, tokenByIndex,tokenOfOwnerByIndex)

    let checkSumContractAddr = web3.utils.toChecksumAddress(contractAddress)
    let erc721ViewContract = initContract(web3Api, erc721ViewABI, checkSumContractAddr)
    let isERC721 = false
    let isMetadata = false
    let isEnumerable = false
    if (bn == 'latest') {
        bn = await web3Api.eth.getBlockNumber()
    }

    var statusesPromise = Promise.allSettled([
        erc721ViewContract.methods.supportsInterface(ERC721ID).call({}, bn),
        erc721ViewContract.methods.supportsInterface(ERC721MetadataID).call({}, bn),
        erc721ViewContract.methods.supportsInterface(ERC721EnumerableID).call({}, bn),
        erc721ViewContract.methods.name().call({}, bn),
        erc721ViewContract.methods.symbol().call({}, bn),
        erc721ViewContract.methods.baseURI().call({}, bn),
        erc721ViewContract.methods.totalSupply().call({}, bn)
    ])

    var [isERC721Test, isERC721MetadataTest, isERC721EnumerableIDTest, name, symbol, baseURI, totalSupply] = await statusesPromise;
    if (isERC721Test.status == 'fulfilled') {
        isERC721 = isERC721Test.value
    }

    let metadata = {}
    if (isERC721MetadataTest.status == 'fulfilled') {
        isMetadata = isERC721MetadataTest.value
        if (isMetadata) {
            //name, symbol, tokenURI is available
            metadata.name = name.value
            metadata.symbol = symbol.value
            metadata.baseURI = (baseURI.value != undefined) ? baseURI.value : null
        }
    }

    let tokenTotalSupply = -1
    if (isERC721EnumerableIDTest.status == 'fulfilled') {
        isEnumerable = isERC721EnumerableIDTest.value
        if (isEnumerable) {
            tokenTotalSupply = totalSupply.value
        }
    }

    if (isERC721) {
        let tokenInfo = {
            blockNumber: bn,
            tokenAddress: checkSumContractAddr,
            tokenType: 'ERC721',
            isMetadataSupported: isMetadata,
            isEnumerable: isEnumerable,
            metadata: metadata,
            totalSupply: tokenTotalSupply,
            numHolders: 0
        }
        return tokenInfo
    }
    return false
}

async function getTokenTotalSupply(web3Api, contractAddress, bn = 'latest', decimals = false) {
    let checkSumContractAddr = web3.utils.toChecksumAddress(contractAddress)
    let erc20Contract = initContract(web3Api, erc20ABI, checkSumContractAddr)
    if (bn == 'latest') {
        bn = await web3Api.eth.getBlockNumber()
    }
    try {
        var totalSupply;
        if (decimals !== false) {
            console.log("HI");
            totalSupply = await Promise.all([
                erc20Contract.methods.totalSupply().call({}, bn)
            ]);
        } else {
            [decimals, totalSupply] = await Promise.all([
                erc20Contract.methods.decimals().call({}, bn),
                erc20Contract.methods.totalSupply().call({}, bn)
            ]);
        }
        let tokenTotalSupply = totalSupply / 10 ** decimals
        return [tokenTotalSupply, bn]
    } catch (err) {
        //console.log(`getTokenTotalSupply ERROR ${checkSumContractAddr}`, err)
        return [false, bn]
    }
}


//return symbol, name, decimal, totalSupply
async function getERC20TokenInfo(web3Api, contractAddress, bn = 'latest', RPCBackfill = null) {
    let x = RPCBackfill ? get_proxy_address(contractAddress, chainID, RPCBackfill) : null;
    if (x != undefined) {
        contractAddress = x;
    }
    let checkSumContractAddr
    try {
        checkSumContractAddr = web3.utils.toChecksumAddress(contractAddress)
    } catch (e) {
        return false
    }
    let erc20Contract = initContract(web3Api, erc20ABI, checkSumContractAddr)
    if (bn == 'latest') {
        bn = await web3Api.eth.getBlockNumber()
    }
    try {
        var [name, symbol, decimals, totalSupply] = await Promise.all([
            erc20Contract.methods.name().call({}, bn),
            erc20Contract.methods.symbol().call({}, bn),
            erc20Contract.methods.decimals().call({}, bn),
            erc20Contract.methods.totalSupply().call({}, bn),
        ]);
        // for a contract to be erc20, {name, symbol, decimals, totalSupply} call return successful
        let tokenInfo = {
            blockNumber: bn,
            tokenType: 'ERC20',
            name,
            symbol,
            decimals,
            totalSupply
        }
        try {
            let swapContract = initContract(web3Api, swapABI, checkSumContractAddr)
            var [token0, token1] = await Promise.all([
                swapContract.methods.token0().call({}, bn),
                swapContract.methods.token1().call({}, bn)
            ]);
            if (token0 && token1) {
                let erc20Contract0 = initContract(web3Api, erc20ABI, web3.utils.toChecksumAddress(token0))
                let erc20Contract1 = initContract(web3Api, erc20ABI, web3.utils.toChecksumAddress(token1))
                var [token0Symbol, token0Decimals, token1Symbol, token1Decimals] = await Promise.all([
                    erc20Contract0.methods.symbol().call({}, bn),
                    erc20Contract0.methods.decimals().call({}, bn),
                    erc20Contract1.methods.symbol().call({}, bn),
                    erc20Contract1.methods.decimals().call({}, bn)
                ]);
                tokenInfo.tokenType = 'ERC20LP';
                tokenInfo.token0 = token0;
                tokenInfo.token1 = token1;
                tokenInfo.token0Symbol = token0Symbol;
                tokenInfo.token1Symbol = token1Symbol;
                tokenInfo.token0Decimals = token0Decimals;
                tokenInfo.token1Decimals = token1Decimals;
            }
        } catch (err) {
            //console.log("T01", err);
        }
        return tokenInfo
    } catch (err) {
        //console.log(err);
        return false
    }
}

// StellaLP|0x1234-0xabcd:WGLMR/USDC
//(platform|ShortAddr0-ShortAddr1:Symbol0/Symbol1)
function getAssetPairKey(name, token0Addr, token1Addr, token0Symbol, token1Symbol) {
    let pieces = name.split(" ");
    let s = []
    for (const p of pieces) {
        if (p.toLowerCase() != 'token') {
            s.push(p)
        }
    }
    let token0ShortAddr = token0Addr.toLowerCase().substr(0, 6)
    let token1ShortAddr = token1Addr.toLowerCase().substr(0, 6)
    let ap = `${s.join('')}|${token0ShortAddr}-${token1ShortAddr}:${token0Symbol}/${token1Symbol}`
    return ap
}

async function getERC20LiquidityPairRawReserve(web3Api, contractAddress, bn = 'latest') {
    let checkSumContractAddr = web3.utils.toChecksumAddress(contractAddress)
    let uniswapV2Reserves = initContract(web3Api, uniswapV2ReservesABI, checkSumContractAddr)
    let zenLinkReserves = initContract(web3Api, zenLinkReservesABI, checkSumContractAddr)
    let reserve0 = false;
    let reserve1 = false;
    let blockTimestampLast = false;

    if (bn == 'latest') {
        bn = await web3Api.eth.getBlockNumber()
    }
    var statusesPromise = Promise.allSettled([
        uniswapV2Reserves.methods.getReserves().call({}, bn),
        zenLinkReserves.methods.getReserves().call({}, bn)
    ])

    var [uniswapV2ReservesTest, zenLinkReservesTest] = await statusesPromise;
    if (uniswapV2ReservesTest.status == 'fulfilled') {
        let res = uniswapV2ReservesTest.value
        reserve0 = res['_reserve0']
        reserve1 = res['_reserve1']
        blockTimestampLast = res['_blockTimestampLast']
    }
    if (zenLinkReservesTest.status == 'fulfilled') {
        let res = zenLinkReservesTest.value
        reserve0 = res['_reserve0']
        reserve1 = res['_reserve1']
    }
    return [reserve0, reserve1, blockTimestampLast]
}

//todo this currently reject uniswap fork that doesn't implement PERMIT_TYPEHASH
// zen link: missing both PERMIT_TYPEHASH and the timestamp in getReserves
async function getERC20LiquidityPairTokenInfo(web3Api, contractAddress, bn = 'latest') {
    let checkSumContractAddr = web3.utils.toChecksumAddress(contractAddress)
    let erc20LPContract = initContract(web3Api, swapABI, checkSumContractAddr)
    if (bn == 'latest') {
        bn = await web3Api.eth.getBlockNumber()
    }
    //var domainSeparator, permitTypehash
    try {
        let [domainSeparator, permitTypehash] = await Promise.all([
            erc20LPContract.methods.DOMAIN_SEPARATOR().call({}, bn),
            erc20LPContract.methods.PERMIT_TYPEHASH().call({}, bn)
        ]);
        //console.log(`${domainSeparator}, ${permitTypehash}`)
        if (permitTypehash != '0x6e71edae12b1b97f4d1f60370fef10105fa2faae0126114a169c64845d6126c9') {
            console.log(`PERMIT_TYPEHASH mismatch ${permitTypehash}`)
            //return false
        }

    } catch (err) {
        //console.log(`warning ${contractAddress} does not implement DOMAIN_SEPARATOR and/or PERMIT_TYPEHASH`)
        //return false
    }

    var [reserve0, reserve1, blockTimestampLast] = await getERC20LiquidityPairRawReserve(web3Api, checkSumContractAddr, bn)
    if (!reserve0 || !reserve1) {
        console.log(`${contractAddress} not LP token (reserves not found)`)
        return false
    }

    try {
        var [token0, token1, totalSupply] = await Promise.all([
            erc20LPContract.methods.token0().call({}, bn),
            erc20LPContract.methods.token1().call({}, bn),
            erc20LPContract.methods.totalSupply().call({}, bn)
        ]);

        let token0Contract = initContract(web3Api, swapABI, token0)
        let token1Contract = initContract(web3Api, swapABI, token1)
        var [name, lpDecimal, token0Decimal, token1Decimal, token0Symbol, token1Symbol] = await Promise.all([
            erc20LPContract.methods.name().call({}, bn),
            erc20LPContract.methods.decimals().call({}, bn),
            token0Contract.methods.decimals().call({}, bn),
            token1Contract.methods.decimals().call({}, bn),
            token0Contract.methods.symbol().call({}, bn),
            token1Contract.methods.symbol().call({}, bn)
        ]);
        // for a contract to be erc20, {name, symbol, decimals, totalSupply} call return successful
        let token0Supply = reserve0
        let token1Supply = reserve1
        let assetpairkey = getAssetPairKey(name, token0, token1, token0Symbol, token1Symbol) //name, token0Addr, token1Addr, token0Symbol, token1Symbol
        let tokenInfo = {
            blockNumber: bn,
            tokenAddress: checkSumContractAddr,
            tokenType: 'ERC20LP',
            assetPair: assetpairkey,
            token0: token0,
            token1: token1,
            token0Symbol: token0Symbol,
            token1Symbol: token1Symbol,
            decimals: lpDecimal,
            token0Decimals: token0Decimal,
            token1Decimals: token1Decimal,
            token0Supply: token0Supply / 10 ** token0Decimal,
            token1Supply: token1Supply / 10 ** token1Decimal,
            totalSupply: totalSupply / 10 ** lpDecimal
        }
        return tokenInfo
    } catch (err) {
        console.log(`${contractAddress} not LP token`, err)
        return false
    }
}

async function getNativeChainBalances(web3Api, holders, bn = 'latest') {
    if (bn == 'latest') {
        bn = await web3Api.eth.getBlockNumber()
    }
    let ether = 10 ** 18
    var checkSumholders = holders.map((holder) => {
        return web3.utils.toChecksumAddress(holder)
    })
    let holderBalancesAsync = await checkSumholders.map(async (checkSumholder) => {
        try {
            return web3Api.eth.getBalance(checkSumholder, bn)
        } catch (err) {
            console.log(`getNativeChainBalances ${checkSumholder}`, err)
            return false
        }
    });
    let holderBalances;
    try {
        holderBalances = await Promise.allSettled(holderBalancesAsync);
        //{ status: 'fulfilled', value: '503872893109922' },
        //{ status: 'rejected', reason: Error: '.....'}
        //console.log(holderBalances.map(promise => [promise.status, promise.value]));
    } catch (e) {
        console.log(`getNativeChainBalances error`, e, holderBalances)
    }
    let res = {
        blockNumber: bn,
        holders: []
    }

    for (i = 0; i < checkSumholders.length; i += 1) {
        let holderAddress = checkSumholders[i]
        let holderBalance = holderBalances[i]
        let holderRes = {
            holderAddress: holderAddress,
            balance: 0
        }
        //console.log(`holderBalance[${i}]`, holderBalance)
        if (holderBalance['status'] == 'fulfilled') {
            holderRes.balance_raw = holderBalance['value'];
            holderRes.balance = holderBalance['value'] / ether
        } else {
            holderRes.error = holderBalance['reason']
        }
        res.holders.push(holderRes)
    }
    return res
}

//await getTokenHoldersRawBalances(web3Api, tokenAddress, holders.slice(44,48), false, 255220)
async function getTokenHoldersRawBalances(web3Api, contractAddress, holders, tokenDecimal = false, bn = 'latest') {
    let checkSumContractAddr = web3.utils.toChecksumAddress(contractAddress)
    let erc20Contract = initContract(web3Api, erc20ABI, checkSumContractAddr)
    if (bn == 'latest') {
        bn = await web3Api.eth.getBlockNumber()
    }
    let res = {
        blockNumber: bn,
        tokenAddress: checkSumContractAddr,
        holders: []
    }

    if (tokenDecimal == false) {
        try {
            tokenDecimal = await erc20Contract.methods.decimals().call({}, bn)
        } catch (err) {
            console.log(`getHolderRawTokenBalance ${contractAddress} fetch tokenDecimal error`, err)
            return res
        }
    }

    var checkSumholders = holders.map((holder) => {
        return web3.utils.toChecksumAddress(holder)
    })
    let holderBalancesAsync = await checkSumholders.map(async (checkSumholder) => {
        return erc20Contract.methods.balanceOf(checkSumholder).call({}, bn)
    });
    if (holderBalancesAsync.length != holders.length) {
        console.log("holderBalancesAsync.length", holderBalancesAsync.length, "holders.length", holders.length);
    }
    if (checkSumholders.length != holders.length) {
        console.log("checkSumholders.length", checkSumholders.length, "holders.length", holders.length);
    }
    let holderBalances = [];
    try {
        holderBalances = await Promise.allSettled(holderBalancesAsync);
        //{ status: 'fulfilled', value: '503872893109922' },
        //{ status: 'rejected', reason: Error: '.....'}
        //console.log(holderBalances.map(promise => [promise.status, promise.value]));
    } catch (e) {
        console.log(`getHolderRawTokenBalance ${contractAddress} error`, e, holderBalances)
    }
    if (holderBalances.length != holders.length) {
        console.log("holderBalances.length", holderBalances.length, "holders.length", holders.length);
    }
    for (i = 0; i < checkSumholders.length; i += 1) {
        let holderAddress = checkSumholders[i]
        let holderBalance = holderBalances[i]
        let bal = 0
        let failedReson;
        let holderRes = {
            holderAddress: holderAddress,
            balance: 0
        }
        //console.log(`holderBalance[${i}]`, holderBalance)
        if (holderBalance['status'] == 'fulfilled') {
            holderRes.balance = holderBalance['value'] / 10 ** tokenDecimal
        } else {
            holderRes.error = holderBalance['reason']
        }
        res.holders.push(holderRes)
    }
    return res
}


function get_address_from_storage_value(storageVal) {
    return storageVal.length < 40 ? storageVal : "0x" + storageVal.slice(-40);
}

async function get_proxy_address(address, chainID, RPCBackfill) {
    // https://eips.ethereum.org/EIPS/eip-1967
    const contract = new ethers.Contract(address, [], new ethers.providers.JsonRpcProvider(RPCBackfill));
    let logicValue = await contract.provider.getStorageAt(address, "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc", RPCBackfill);
    let beaconValue = await contract.provider.getStorageAt(address, "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50", RPCBackfill);
    if (logicValue != "0x0000000000000000000000000000000000000000000000000000000000000000") {
        return get_address_from_storage_value(logicValue);
    }
    if (beaconValue != "0x0000000000000000000000000000000000000000000000000000000000000000") {
        return get_address_from_storage_value(beaconValue);
    }
    return (false);
}

async function detect_proxy_address(web3Api, address) {
    // https://eips.ethereum.org/EIPS/eip-1967
    let logicValue = await web3Api.eth.getStorageAt(address, "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc");
    let beaconValue = await web3Api.eth.getStorageAt(address, "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50");
    if (logicValue != "0x0000000000000000000000000000000000000000000000000000000000000000") {
        return get_address_from_storage_value(logicValue);
    }
    if (beaconValue != "0x0000000000000000000000000000000000000000000000000000000000000000") {
        return get_address_from_storage_value(beaconValue);
    }
    return (false);
}

// this function decorates and generate a "full" txn using decodedTxn and decodedReceipts
function decorateTxn(dTxn, dReceipt, dInternal, blockTS = false, chainID = false) {
    let transactionHash = (dTxn.hash) ? dTxn.hash : dTxn.transactionHash
    if (!dReceipt || dReceipt.transactionHash === undefined) {
        console.log(`decorateTxn: missing receipts`, dReceipt)
        return;
    }
    if (transactionHash != dReceipt.transactionHash) {
        console.log(`decorateTxn: txnHash mismatch (tx:${transactionHash}) vs (receipt: ${dReceipt.transactionHash})`, dTxn)
        return
    }
    //todo: how to detect reverted but successful case?
    //todo compute txfee (1559 vs legacy), current using 1284 for prototype
    /* For 1559
    baseFeePerGas: subsequently burned.
    maxPriorityFeePerGas: tip that goes to miner
    maxFeePerGas: max amount user is willing to pay. if baseFeePerGas+maxPriorityFeePerGas >=maxFeePerGas, maxPriorityFeePerGas is set to maxFeePerGas-baseFeePerGas
    txSaving: maxFeePerGas - (maxPriorityFeePerGas+maxFeePerGas)

    // max_fee_per_gas, max_priority_fee_per_gas, receipt_effective_gas_price
    */
    //console.log(`[${dReceipt.transactionHash}] dReceipt`, dReceipt)
    let gWei = 10 ** 9
    let ether = 10 ** 18
    let value = paraTool.dechexToInt(dTxn.value)
    let gasLimit = dTxn.gas ? paraTool.dechexToInt(dTxn.gas) : 0
    let gasPrice = dTxn.gasPrice ? paraTool.dechexToInt(dTxn.gasPrice) : 0
    let gasUsed = dReceipt.gasUsed ? paraTool.dechexToInt(dReceipt.gasUsed) : 0
    let txLegacyType = 0
    let tx1559Type = 2
    let txType = (dTxn.type != undefined) ? dTxn.type : txLegacyType
    if (txType != txLegacyType && txType != tx1559Type) {
        //console.log(`unknown txType=${dTxn.type}, dTxn`, dTxn)
        //process.exit(0)
    }
    let fee = gasUsed * gasPrice
    let maxFeePerGas = (dTxn.maxFeePerGas != undefined) ? paraTool.dechexToInt(dTxn.maxFeePerGas) : 0
    let maxPriorityFeePerGas = (dTxn.maxPriorityFeePerGas != undefined) ? paraTool.dechexToInt(dTxn.maxPriorityFeePerGas) : 0
    //console.log(`dReceipt effectiveGasPrice`, paraTool.dechexToInt(dReceipt.effectiveGasPrice))
    let baseFeePerGas = (dTxn.maxPriorityFeePerGas != undefined) ? paraTool.dechexToInt(dReceipt.effectiveGasPrice) : 0 //paraTool.dechexToInt("0x174876e800")
    let effectiveGasPrice = paraTool.dechexToInt(dReceipt.effectiveGasPrice)
    let cumulativeGasUsed = paraTool.dechexToInt(dReceipt.cumulativeGasUsed)
    let burnedFee = gasUsed * baseFeePerGas
    let txnSaving = (maxFeePerGas - baseFeePerGas) * gasUsed
    if (gasPrice >= baseFeePerGas) {
        baseFeePerGas = gasPrice - maxPriorityFeePerGas
    }
    let contractAddress = (dReceipt.contractAddress != undefined) ? dReceipt.contractAddress : null
    if (contractAddress && dTxn.decodedInput != undefined) {
        dTxn.decodedInput.contractAddress = contractAddress
    }
    let fTxn = {
        chainID: (chainID) ? chainID : paraTool.dechexToInt(dTxn.chainId),
        transactionHash: transactionHash,
        substrate: null,
        status: dReceipt.status,
        blockHash: dTxn.blockHash,
        blockNumber: dTxn.blockNumber,
        transactionIndex: dTxn.transactionIndex,
        timestamp: (blockTS) ? blockTS : null, // not part of the txn
        from: dTxn.from,
        to: dTxn.to,
        //creates: (dTxn.creates != undefined)? dTxn.creates: null,
        creates: contractAddress,
        transfers: dReceipt.transfers, //TODO.. also transaction actions
        swaps: dReceipt.swaps,
        value: value / ether,
        txType: dTxn.type,
        fee: fee / ether,
        burnedFee: burnedFee / ether,
        txnSaving: txnSaving / ether,
        gasLimit: gasLimit,
        gasUsed: gasUsed,
        cumulativeGasUsed: cumulativeGasUsed,
        maxFeePerGas: maxFeePerGas / gWei,
        maxPriorityFeePerGas: maxPriorityFeePerGas / gWei,
        baseFeePerGas: baseFeePerGas / gWei,
        effectiveGasPrice: effectiveGasPrice / gWei,
        gasPrice: gasPrice / gWei,
        nonce: dTxn.nonce,
        accessList: null,
        input: dTxn.input,
        decodedInput: dTxn.decodedInput,
        decodedLogs: dReceipt.decodedLogs,
    }
    //console.log(`${fTxn.transactionHash} txn`, fTxn)
    //console.log(`${fTxn.transactionHash} receipt`, dReceipt)
    if (dTxn.isConnectedCall != undefined) {
        fTxn.isConnectedCall = dTxn.isConnectedCall
    }
    if (txType == txLegacyType) {
        delete fTxn.maxFeePerGas
        delete fTxn.maxPriorityFeePerGas
        delete fTxn.txnSaving
    }
    if (fTxn.txnSaving < 0) {
        delete fTxn.txnSaving
    }
    if (dTxn.accessList) {
        fTxn.accessList = dTxn.accessList
    } else {
        delete fTxn.accessList
    }
    if (dInternal.length > 0) {
        fTxn.transactionsInternal = dInternal;
    }
    return fTxn
}

function decodeRLPTransaction(rawTxHex) {
    try {
        var tx = Transaction.fromRlpSerializedTx(rawTxHex)
        var txJSON = tx.toJSON()
        let from = web3.eth.accounts.recoverTransaction(rawTxHex);
        txJSON.from = from.toLowerCase()
        return txJSON
    } catch (error) {
        console.log(`decodeRLPTransaction rawTxHex=${rawTxHex}, error=${error.toString()}`)
        return false
    }
}

async function signEvmTx(web3Api, txStruct, wallet) {
    var signedTX = false
    try {
        signedTX = await web3Api.eth.accounts.signTransaction(txStruct, wallet.privateKey)
        console.log(`signEvmTx [acct=${wallet.address}], txHash=${signedTX.transactionHash}, txStruct=`, txStruct)
    } catch (error) {
        console.log(`signEvmTx [acct=${wallet.address}], txStruct=${txStruct} error=${error.toString()}`)
    }
    return signedTX
}

async function sendSignedTx(web3Api, signedTx) {
    var isError = 0
    let txHash = signedTx.transactionHash
    let rawTransaction = signedTx.rawTransaction
    try {
        console.log(`sendSignedTx txhHash=${txHash}, rawTransaction=${rawTransaction}`)
        await web3Api.eth.sendSignedTransaction(signedTx.rawTransaction)
    } catch (error) {
        console.log(`sendSignedTx txhHash=${txHash}, rawTransaction=${rawTransaction} error=${error.toString()}`)
        isError = error.toString()
    }
    return isError
}

async function sendSignedRLPTx(web3Api, rlpTx) {
    var isError = 0
    let txHash = web3.utils.keccak256(rlpTx)
    console.log(`sendSignedTx txhHash=${txHash}, rawTransaction=${rlpTx}`)
    try {
        await web3Api.eth.sendSignedTransaction(rlpTx)
    } catch (error) {
        console.log(`sendSignedTx txhHash=${txHash}, rawTransaction=${rlpTx} error=${error.toString()}`)
        isError = error.toString()
    }
    return isError
}

function processEthersDecodedRaw(inp, v, depth = 0) {

    if (inp.anonymous) delete inp.anonymous;
    if (inp.inputs) {
        let x = inp.inputs.map((e) => {
            if (e.internalType && e.internalType == e.type) {
                delete e.internalType;
            }
            if (e.indexed !== undefined && e.indexed === false) {
                delete e.indexed;
            }
            return processEthersDecodedRaw(e, v, depth + 1);
        })
        return x;
    } else if (inp.components) {
        if (inp.type == "tuple[]") {
            // v[inp.name] is an array, each of which follow inp.components
            if (v[inp.name]) {
                return {
                    name: inp.name,
                    type: inp.type,
                    value: v[inp.name].map((v2, idx) => {
                        //console.log("COMPONENT in tuple[]", idx, inp.name, inp.type, v2);
                        let obj = {}
                        inp.components.forEach((c) => {
                            obj[c.name] = processEthersDecodedRaw(c, v2, depth + 1);
                        });
                        return obj
                    })
                };
            } else {
                console.log("COMPONENT missing name", inp.name, inp.type);
            }
        } else if (inp.type == "tuple") {
            // v[inp.name] is an object, which follows inp.components -- so, take element c of inp.components and make an attribute of object 
            let obj = {}
            inp.components.forEach((c) => {
                obj[c.name] = processEthersDecodedRaw(c, v[inp.name], depth + 1);
            });
            return obj
        } else {
            return {
                name: inp.name,
                type: inp.type,
                value: "TODO"
            }
        }
    } else if (inp) {
        if (inp.name && v[inp.name]) {
            let value = v[inp.name];
            let val = value._isBigNumber ? value.toString() : value;
            return {
                name: inp.name,
                type: inp.type,
                value: val
            }
        } else {
            return {
                name: inp.name,
                type: inp.type,
                value: null
            }
        }

    }
}


function keccak256(hex) {
    return web3.utils.keccak256(hex)
}

function computeConnectedTxHash(tx) {
    /*
    {
      chainID: '0x',
      nonce: '0x04',
      maxFeePerGas: '0x',
      maxPriorityFeePerGas: '0x',
      gas: '0x0493e0',
      to: '0x49ba58e2ef3047b1f90375c79b93578d90d24e24',
      value: '0x',
      data: '0xcde4efa9',
      accessList: [],
      v: '0x01',
      r: '0x01',
      s: '0x01'
    }
    */
    let encodedList = []
    for (const k of Object.keys(tx)) {
        encodedList.push(tx[k])
    }
    let encoded = '0x02' + rlp.encode(encodedList).toString('hex')
    return keccak256(encoded)
}

function createTxFromEncoded(encodedList) {
    let tx = {}
    let legacyFormat = ['nonce', 'gas', 'gasPrice', 'value', 'data', 'to', 'v', 'r', 's']
    let tx1559Format = ['chainID', 'nonce', 'maxFeePerGas', 'maxPriorityFeePerGas', 'gas', 'to', 'value', 'data', 'accessList', 'v', 'r', 's']
    //let accessListFormat = ['chainID', 'nonce', 'gas','gasPrice','value','data','to','accessList','v','r','s'] // this is probably type1 with 11 fields
    let txType = legacyFormat //'legacy'
    if (encodedList.length == 11) return tx
    if (encodedList.length == 12) {
        txType = tx1559Format //'1559'
    }
    for (let i = 0; i < encodedList.length; i++) {
        tx[txType[i]] = encodedList[i]
    }
    return tx
}

function buffertoHex(bufferArr) {
    let hexArr = []
    for (const b of bufferArr) {
        if (Array.isArray(b)) {
            let r = buffertoHex(b)
            hexArr.push(r)
        } else {
            hexArr.push('0x' + b.toString('hex'))
        }
    }
    return hexArr
}
//https://github.com/ethereum/go-ethereum/blob/v1.10.25/core/types/transaction_marshalling.go#L54
//0xa902e780048080830493e09449ba58e2ef3047b1f90375c79b93578d90d24e248084cde4efa9c0010101 (connected contract call)
//0xf8d084010c5053843b9aca0082c35094588538d1eb40db215c41ee02c298ec54b8da0bb2843b9aca00b8645d3a1f9d0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000368657900000000000000000000000000000000000000000000000000000000001ba024081dad89b4404fef555f2f750e958b3cb1741f2dde2cb4eb1d1109e3c2127ca0384110ec022985cdf673e8ea71852efdce94273a831a2393c60cd88612c0259f (legacy)
//0xb9027c02f902788205078301642985012a05f20085012a05f200831a3c8194e4f8526e5ddb840aa118a21b8ac46f0c80773d0480b902044916065810335695908e164ea756596a2d6eff14607917dba3ab2fc4004999f0b45be05b000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000120000000000000000000000000000000000000000000000000000000000000000646616e746f6d0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002a3078384436303635353363383043313638313837324237463135383636413533384561663833633345430000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c097b94760a80063518c2c0000d978859318ef8092532ce80df1a179e7eaace3cf000000000000000000000000000000000000000000000000000000000000000000000000000000000000000088a8ab07c3020ae6f59096942e58d97fef1d2d39000000000000000000000000d978859318ef8092532ce80df1a179e7eaace3cf0000000000000000000000000000000000000000000000000de0b6b3a764000000000000000000000000000000000000000000000000003635c9adc5dea00000c001a0fbe673a8a73b5cdb557dea3dc2aa3f37b5ccc5fc23a622362e25e88bb0c944c2a06ed35fb4200251e9d6d1169887c317959a35e88dd9172cb5e6e87539f3aca265 (1559)
function decodeRLPTx(raw = '') {
    let r = {
        txType: 0,
        txHash: null,
        encoded: [],
        tx: null,
        errorDesc: null,
    }
    try {
        let rlptxn = rlp.decode(raw) //EIP2718: (TransactionType || TransactionPayload)
        if (Array.isArray(rlptxn)) {
            if (rlptxn.length != 9) r.errorDesc = `invalid rlp arrayLen:${rlptxn.length} (Expecting 9)`
            r.txHash = keccak256(raw)
            r.encoded = buffertoHex(rlptxn)
        } else {
            rlptxn = rlptxn.toString('hex')
            let transactionType = rlptxn.slice(0, 2)
            let transactionPayload = '0x' + rlptxn.slice(2)
            let tx = rlp.decode(transactionPayload)
            if (Array.isArray(tx)) {
                if (tx.length != 12) r.errorDesc = `invalid rlp arrayLen:${tx.length} (Expecting 12)`
                r.txType = transactionType
                r.txHash = keccak256('0x' + rlptxn)
                r.encoded = buffertoHex(tx)
            } else {
                r.errorDesc = 'Decode Failed?'
            }
        }
    } catch (e) {
        console.log(`decodeRLPTx [${raw}] err`, e)
        r.errorDesc = e.toString()
    }
    if (r.errorDesc == undefined) r.tx = createTxFromEncoded(r.encoded)
    return r
}

function parseMethodInputs(paramsString, nested, fingerprintID = false) {
    const splitInputs = [];
    let parseType = (fingerprintID && fingerprintID.length == 10) ? 'func' : 'event'
    let currentParam = '';
    let nestedLevel = 0;
    for (let i = 0; i < paramsString.length; i++) {
        const char = paramsString[i];
        if (char === '(') {
            nestedLevel++;
        } else if (char === ')') {
            nestedLevel--;
        }
        if (char === ',' && nestedLevel === 0) {
            splitInputs.push(currentParam.trim());
            currentParam = '';
        } else {
            currentParam += char;
        }
        if (i === paramsString.length - 1) {
            splitInputs.push(currentParam.trim());
        }
    }
    const paramsArray = splitInputs.map(param => {
        const separatorIndex = param.lastIndexOf(' ');
        const name = param.slice(separatorIndex + 1).trim();
        let type = param.slice(0, separatorIndex).trim();
        let topicIndex = false
        let hasTopicIndex = false
        try {
            if (parseType == 'event' && type.includes("index_topic_")) {
                let p = type.split(' ')
                hasTopicIndex = true
                topicIndex = parseInt(p[0].replace('index_topic_', ''))
                type = p[1]
            }
        } catch (e) {
            console.log(`parseMethodInputs event parsing err`, e)
        }
        if (nested && type.includes('(')) {
            const nestedStartIndex = type.indexOf('(');
            const nestedEndIndex = type.lastIndexOf(')');
            const nestedParamsString = type.slice(nestedStartIndex + 1, nestedEndIndex);
            const nestedType = type.slice(0, nestedStartIndex);
            return {
                nestedType: true,
                name: name,
                //type: nestedType,
                type: parseMethodInputs(nestedParamsString, nested)
            };
        } else {
            let t = {
                name: name,
                type: type,
            }
            if (hasTopicIndex) {
                t.topicIndex = topicIndex
            }
            return t
        }
    });
    return paramsArray;
}

function build_txn_input_stub(methodSignature = 'callBridgeCall(address token, uint256 amount, string destinationChain, string bridgedTokenSymbol, (uint8 callType, address target, uint256 value, bytes callData, bytes payload)[] sourceCalls, (uint8 callType, address target, uint256 value, bytes callData, bytes payload)[] destinationCalls, address refundRecipient, bool enableForecall)', nested = false) {
    const startIndex = methodSignature.indexOf('(') + 1;
    const endIndex = methodSignature.lastIndexOf(')');
    const inputs = methodSignature.slice(startIndex, endIndex);
    return parseMethodInputs(inputs, nested);
}

function buildSchemaInfoFromSig(methodSignature = 'PoolCreated(index_topic_1 address token0, index_topic_2 address token1, index_topic_3 uint24 fee, int24 tickSpacing, address pool)', fingerprintID = '0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118-4', nested = false) {
    const startIndex = methodSignature.indexOf('(') + 1;
    const endIndex = methodSignature.lastIndexOf(')');
    const inputs = methodSignature.slice(startIndex, endIndex);
    let schema = parseMethodInputs(inputs, nested, fingerprintID);
    let schemaType = (fingerprintID && fingerprintID.length == 10) ? 'call' : 'evt'
    let sectionName = methodSignature.substr(0, methodSignature.indexOf('('))
    let contractName = 'ContractName_TODO'
    let schemaInfo = {
        fingerprintID: fingerprintID,
        schemaType: schemaType,
        sectionName: sectionName,
        contractName: contractName,
        tblName: `${schemaType}_${sectionName}`,
        schema: schema
    }
    return schemaInfo
}


//return function signature like transferFrom(address sender, address recipient, uint256 amount) from abi
//Deposit(index_topic_1 address dst, uint256 wad) -- added index_topic for events
function getMethodSignatureOLD(e) {
    var inputs = []
    var indexedCnt = 0 //topic0 is signatureID
    for (const inp of e.inputs) {
        let isIndexed = false
        if (inp.indexed != undefined) {
            isIndexed = inp.indexed
        }
        let typeName;
        if (Array.isArray(inp.components)) {
            let t = []
            let tupleType = inp.type
            for (const c of inp.components) {
                let cTypeName = `${c.type} ${c.name}`.trim()
                t.push(cTypeName)
            }
            let componentsType = `(${t.join(', ')})`
            if (tupleType == 'tuple[]') {
                componentsType += `[]`
            }
            typeName = `${componentsType} ${inp.name}`
        } else {
            typeName = `${inp.type} ${inp.name}`.trim()
        }
        if (isIndexed) {
            indexedCnt++
            inputs.push(`index_topic_${indexedCnt} ${typeName}`)
        } else {
            inputs.push(typeName)
        }
    }
    let topicLen = (e.type == 'event') ? indexedCnt + 1 : 0
    return [`${e.name}(${inputs.join(', ')})`, topicLen]
}

function getMethodSignature(e) {
    var inputs = []
    var indexedCnt = 0 //topic0 is signatureID
    for (const inp of e.inputs) {
        let isIndexed = false
        if (inp.indexed != undefined) {
            isIndexed = inp.indexed
        }
        let typeName;
        if (Array.isArray(inp.components)) {
            let t = []
            let tupleType = inp.type
            for (const c of inp.components) {
                let cTypeName = parseType(c)
                t.push(cTypeName)
            }
            let componentsType = `(${t.join(', ')})`
            if (tupleType == 'tuple[]') {
                componentsType += `[]`
            }
            typeName = `${componentsType} ${inp.name}`
        } else {
            typeName = `${inp.type} ${inp.name}`.trim()
        }
        if (isIndexed) {
            indexedCnt++
            inputs.push(`index_topic_${indexedCnt} ${typeName}`)
        } else {
            inputs.push(typeName)
        }
    }
    let topicLen = (e.type == 'event') ? indexedCnt + 1 : 0
    return [`${e.name}(${inputs.join(', ')})`, topicLen]
}

function parseType(c) {
    let cTypeName;
    if (Array.isArray(c.components)) {
        let t = []
        let tupleType = c.type
        for (const component of c.components) {
            let typeName = parseType(component)
            t.push(typeName)
        }
        let componentsType = `(${t.join(', ')})`
        if (tupleType == 'tuple[]') {
            componentsType += `[]`
        }
        cTypeName = `${componentsType} ${c.name}`
    } else {
        cTypeName = `${c.type} ${c.name}`.trim()
    }
    return cTypeName;
}

function getMethodSignatureFlds(e) {
    var flds = []
    var indexedCnt = 0 //topic0 is signatureID
    for (const inp of e.inputs) {
        let isIndexed = false
        if (inp.indexed != undefined) {
            isIndexed = inp.indexed
        }
        let typeName;
        if (Array.isArray(inp.components)) {
            let t = []
            let tupleType = inp.type
            for (const c of inp.components) {
                let cName = `${c.name}`.trim()
                t.push(cName)
            }
            let componentsType = `(${t.join(', ')})`
            if (tupleType == 'tuple[]') {
                componentsType += `[]`
            }
            typeName = `${inp.name}`
        } else {
            typeName = `${inp.name}`.trim()
        }
        if (isIndexed) {
            indexedCnt++
            flds.push(`${typeName}`)
        } else {
            flds.push(typeName)
        }
    }
    return flds
}

// goal: generate uniqueID for func + indexed events
function getMethodFingureprint(e) {
    var inputs = []
    var indexedCnt = 0 //topic0 is signatureID
    for (const inp of e.inputs) {
        let isIndexed = false
        if (inp.indexed != undefined) {
            isIndexed = inp.indexed
        }
        let typeName;
        if (Array.isArray(inp.components)) {
            let t = []
            let tupleType = inp.type
            for (const c of inp.components) {
                let cTypeName = `${c.type}`.trim()
                t.push(cTypeName)
            }
            typeName = `(${t.join(',')})`
            if (tupleType == 'tuple[]') {
                typeName += `[]`
            }
        } else {
            typeName = `${inp.type}`.trim()
        }
        if (isIndexed) {
            indexedCnt++
            inputs.push(`index_topic_${indexedCnt} ${typeName}`)
        } else {
            inputs.push(typeName)
        }
    }
    return `${e.name}(${inputs.join(',')})`
}

function getMethodSignatureRaw(e) {
    let inputRaw = `${e.name}`
    let inputs = []
    for (const inp of e.inputs) {
        if (Array.isArray(inp.components)) {
            let tupleType = inp.type
            let t = []
            for (const c of inp.components) {
                t.push(parseTypeRaw(c))
            }
            let rawTuple = `(${t.join(',')})`
            if (tupleType == 'tuple[]') {
                rawTuple += `[]`
            }
            inputs.push(rawTuple)
        } else {
            inputs.push(inp.type)
        }
    }
    let finalRaw = `${inputRaw}(${inputs.join(',')})`
    return finalRaw
}

function parseTypeRaw(c) {
    let cTypeName;
    if (Array.isArray(c.components)) {
        let t = []
        let tupleType = c.type
        for (const component of c.components) {
            let typeName = parseTypeRaw(component)
            t.push(typeName)
        }
        let componentsType = `(${t.join(',')})`
        if (tupleType == 'tuple[]') {
            componentsType += `[]`
        }
        cTypeName = componentsType;
    } else {
        cTypeName = c.type;
    }
    return cTypeName;
}

function generateFunctionABI(signature) {
    let paramCount = 0;

    const processType = (typeStr) => {
        const name = `f${paramCount++}`;
        if (typeStr.startsWith('(')) {
            // This is a tuple, process its components
            const tupleTypes = processSignature(typeStr.slice(1, -1));
            return {
                components: postProcessTupleComponents(tupleTypes),
                internalType: 'tuple',
                name: name,
                type: 'tuple'
            };
        } else {
            // This is a simple type
            return {
                internalType: typeStr,
                name: name,
                type: typeStr
            };
        }
    };

    const processSignature = (signatureStr) => {
        let stack = [];
        let params = [];

        for (let i = 0; i < signatureStr.length; i++) {
            if (signatureStr[i] === '(') {
                stack.push(i);
            } else if (signatureStr[i] === ')') {
                const startIndex = stack.pop();
                if (stack.length === 0) { // We finished processing a tuple
                    const tupleStr = signatureStr.slice(startIndex, i + 1);
                    signatureStr = signatureStr.slice(i + 1);
                    params.push(tupleStr);
                    i = startIndex - 1; // Reset the counter to the start of the tuple
                }
            } else if (stack.length === 0 && signatureStr[i] === ',') { // We finished processing a simple type
                const typeStr = signatureStr.slice(0, i);
                signatureStr = signatureStr.slice(i + 1);
                params.push(typeStr);
                i = -1; // Reset the counter
            }
        }
        if (stack.length !== 0) {
            throw 'Invalid signature';
        }
        if (signatureStr) {
            params.push(signatureStr);
        }
        return params.map(processType);
    };

    // Post-processing to handle 'tuple' followed by '[]'
    const postProcessTupleComponents = (components) => {
        return components.reduce((acc, cur, i, src) => {
            if (cur.components) {
                // Recursively post-process nested tuple components
                cur.components = postProcessTupleComponents(cur.components);
            }
            if (cur.type === 'tuple' && src[i + 1] && src[i + 1].type === '[]') {
                cur.type = 'tuple[]';
                src.splice(i + 1, 1); // Remove the following '[]'
            }
            acc.push(cur);
            return acc;
        }, []);
    };

    const firstParenIndex = signature.indexOf('(');
    const functionName = signature.slice(0, firstParenIndex);
    const functionParamsSignature = signature.slice(firstParenIndex + 1, -1);
    let inputs = processSignature(functionParamsSignature);

    // Post-processing for top-level inputs
    inputs = postProcessTupleComponents(inputs);

    return {
        name: functionName,
        inputs: inputs,
        type: "function",
        stateMutability: "nonpayable", // default value, modify according to your needs
    };
}

//console.log(JSON.stringify(generateFunctionABI('fulfillBasicOrder_efficient_6GL6yc((address,uint256,uint256,address,address,address,uint256,uint256,uint8,uint256,uint256,bytes32,uint256,bytes32,bytes32,uint256,(uint256,address)[],bytes))'), null, 2));

function generateEventABI(signature) {
    let paramCount = 0;

    const processType = (typeStr, isIndexed) => {
        const name = `f${paramCount++}`;
        if (typeStr.startsWith('(')) {
            // This is a tuple, process its components
            const tupleTypes = processSignature(typeStr.slice(1, -1));
            return {
                components: tupleTypes,
                indexed: isIndexed,
                internalType: 'tuple',
                name: name,
                type: 'tuple'
            };
        } else {
            // This is a simple type
            return {
                indexed: isIndexed,
                internalType: typeStr.replace('*', ''),
                name: name,
                type: typeStr.replace('*', '')
            };
        }
    };

    const processSignature = (signatureStr) => {
        let stack = [];
        let params = [];

        for (let i = 0; i < signatureStr.length; i++) {
            if (signatureStr[i] === '(') {
                stack.push(i);
            } else if (signatureStr[i] === ')') {
                const startIndex = stack.pop();
                if (stack.length === 0) { // We finished processing a tuple
                    const tupleStr = signatureStr.slice(startIndex, i + 1);
                    signatureStr = signatureStr.slice(i + 1);
                    params.push(tupleStr);
                    i = startIndex - 1; // Reset the counter to the start of the tuple
                }
            } else if (stack.length === 0 && signatureStr[i] === ',') { // We finished processing a simple type
                const typeStr = signatureStr.slice(0, i);
                signatureStr = signatureStr.slice(i + 1);
                params.push(typeStr);
                i = -1; // Reset the counter
            }
        }
        if (stack.length !== 0) {
            throw 'Invalid signature';
        }
        if (signatureStr) {
            params.push(signatureStr);
        }
        return params.map((type) => processType(type, type.includes('*')));
    };

    // Post-processing to handle 'tuple' followed by '[]'
    const postProcessTupleComponents = (components) => {
        return components.reduce((acc, cur, i, src) => {
            if (cur.components) {
                // Recursively post-process nested tuple components
                cur.components = postProcessTupleComponents(cur.components);
            }
            if (cur.type === 'tuple' && src[i + 1] && src[i + 1].type === '[]') {
                cur.type = 'tuple[]';
                src.splice(i + 1, 1); // Remove the following '[]'
            }
            acc.push(cur);
            return acc;
        }, []);
    };

    const firstParenIndex = signature.indexOf('(');
    const eventName = signature.slice(0, firstParenIndex);
    const eventParamsSignature = signature.slice(firstParenIndex + 1, -1);
    let inputs = processSignature(eventParamsSignature);

    // Post-processing for top-level inputs
    inputs = postProcessTupleComponents(inputs);

    return {
        anonymous: false,
        inputs: inputs,
        name: eventName,
        type: "event"
    };
}

//console.log(JSON.stringify(generateEventABI('OrderFulfilled(bytes32,address*,address*,address,(uint8,address,uint256,uint256)[],(uint8,address,uint256,uint256,address)[])'), null, 2));
// keccak256 input to certain length
function encodeSelector(f, encodeLen = false) {
    let k = web3.utils.sha3(f)
    if (encodeLen) {
        return k.slice(0, encodeLen)
    }
    return k
}

function parseAbiSignature(abiStrArr) {
    var output = []
    try {
        var contractABI = JSON.parse(abiStrArr)
        var inputs = contractABI.filter(e => e.type === "event" || e.type === "function")
        inputs.forEach(function(e) {
            let stateMutability = e.stateMutability
            let abiType = e.type
            let [signature, topicLen] = getMethodSignatureOLD(e)
            let signatureRaw = getMethodSignatureRaw(e)
            let signatureID = (abiType == 'function') ? encodeSelector(signatureRaw, 10) : encodeSelector(signatureRaw, false)
            let fingerprint = getMethodFingureprint(e)
            let flds = getMethodSignatureFlds(e) // TODO: might need recursive
            /*
            previous fingerprintID is now secondaryID, which is NOT unique
            New fingerprintID: signatureID-encodeSelector(signature, 10) is guaranteed to be unique
            */
            let secondaryID = (abiType == 'function') ? encodeSelector(signatureRaw, 10) : `${signatureID}-${topicLen}-${encodeSelector(fingerprint, 10)}` //fingerprintID=sigID-topicLen-4BytesOfkeccak256(fingerprint) // this is NOT Unique
            let fingerprintID = (abiType == 'function') ? `${signatureID}-${encodeSelector(signature, 10)}` : `${signatureID}-${topicLen}-${encodeSelector(signature, 10)}` //fingerprintID=sigID-topicLen-4BytesOfkeccak256(fingerprint) //fingerprintID
            let modifiedFingerprintID = (abiType == 'function') ? signatureID : `${signatureID}-${topicLen}`
            let abiStr = JSON.stringify([e])
            output.push({
                stateMutability: (stateMutability) ? stateMutability : null,
                fingerprint: fingerprint,
                fingerprintID: fingerprintID,
                modifiedFingerprintID: modifiedFingerprintID,
                secondaryID: secondaryID,
                signatureID: signatureID,
                signatureRaw: signatureRaw,
                signature: signature,
                name: firstCharUpperCase(e.name),
                abi: abiStr,
                abiType: abiType,
                topicLength: topicLen,
                flds: flds
            })
        });
    } catch (err) {}
    return output
}

async function fuseBlockTransactionReceipt(evmBlk, dTxns, dReceipts, flatTraces, chainID) {
    let fBlk = evmBlk
    let blockTS = fBlk.timestamp
    let fTxns = []
    let fTxnsInternal = [];
    let fTxnsConnected = [];
    if (dTxns.length != dReceipts.length) {
        console.log(`[${fBlk.blockNumber}][${fBlk.blockHash}] txns/receipts len mismatch: txnLen=${dTxns.length}, receiptLen=${dReceipts.length}`)
    }
    // console.log(`dTrace!!!`, dTrace)
    // recurse through all the trace records in dTrace, and for any with value, accumulate in feedTrace
    let feedtrace = []
    let feedcreates = []
    let feedtraceMap = {};
    let traceCreateMap = {};
    if (flatTraces) {
        for (const t of flatTraces) {
            //check for create/create2
            let createsOps = ["create", "create2"]
            if (createsOps.includes(t.trace_type)) {
                console.log(`CONTRACT Create!`, t)
                if (traceCreateMap[t.transaction_hash] == undefined) {
                    traceCreateMap[t.transaction_hash] = [];
                }
                let contractAddress = (t.to_address != undefined) ? t.to_address : t.to
                traceCreateMap[t.transaction_hash].push(contractAddress);
            }

            //check for internal
            if (t.value > 0 && trace_address_to_str(t.trace_address) != '') {
                if (feedtraceMap[t.transaction_hash] == undefined) {
                    feedtraceMap[t.transaction_hash] = [];
                }
                feedtraceMap[t.transaction_hash].push(t);
            }
        }
    }
    for (i = 0; i < dTxns.length; i += 1) {
        let dTxn = dTxns[i]
        let dReceipt = dReceipts[i]
        let dInternal = feedtraceMap[dTxn.hash] ? feedtraceMap[dTxn.hash] : []
        let dCreates = traceCreateMap[dTxn.hash] ? traceCreateMap[dTxn.hash] : []
        let fTxn = decorateTxn(dTxn, dReceipt, dInternal, blockTS, chainID)
        if (fTxn) {
            fTxn.createdContracts = dCreates
            fTxns.push(fTxn)
            //write connected txn
            if (fTxn.isConnectedCall) {
                fTxnsConnected.push(fTxn)
            }
            //write internal txn
            if (fTxn.transactionsInternal && fTxn.transactionsInternal.length > 0) {
                for (let j = 0; j < fTxn.transactionsInternal.length; j++) {
                    fTxnsInternal.push(fTxn.transactionsInternal[j]);
                }
            }
        }
    }
    fBlk.transactions = fTxns
    fBlk.transactionsInternal = fTxnsInternal
    fBlk.transactionsConnected = fTxnsConnected
    return fBlk
}



function categorizeTokenSync(dLog) {
    if (dLog.decodeStatus == "success") {
        let dSig = dLog.signature
        let dEvents = dLog.events
        switch (dSig) {
            //0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1-1-0x1c411e9a (uniswamp v2), 2 args
            case 'Sync(uint112 reserve0, uint112 reserve1)':
                /*
                {
                  "decodeStatus": "success",
                  "address": "0xAc2657ba28768FE5F09052f07A9B7ea867A4608f",
                  "transactionLogIndex": "0x5",
                  "data": "0x000000000000000000000000000000000000000000000000000005858933350b00000000000000000000000000000000000000000000036c97b724a65ece0138",
                  "topics": [
                    "0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1"
                  ],
                  "signature": "Sync(uint112 reserve0, uint112 reserve1)",
                  "events": [
                    {
                      "name": "reserve0",
                      "type": "uint112",
                      "value": "6071090623755"
                    },
                    {
                      "name": "reserve1",
                      "type": "uint112",
                      "value": "16170280055487006114104"
                    }
                  ]
                }
                */
                let syncV2 = {
                    type: 'syncV2',
                    reserve0: dEvents[0].value,
                    reserve1: dEvents[1].value,
                    lpTokenAddress: dLog.address
                }
                return syncV2
                break;

            default:
                break;
        }
    }
    return false
}

//swapV2 is guranteed to have sync before it
function categorizeTokenSwaps(dLog) {
    if (dLog.decodeStatus == "success") {
        let dSig = dLog.signature
        let dEvents = dLog.events
        let fingerprintID = dLog.fingerprintID

        // swap xxx (token0) for yyy (token1) [sender='taker', to='maker']
        switch (fingerprintID) {
            //0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822-3-0x1cdd7c22 (uniswamp v2), 6 args
            //'Swap(index_topic_1 address sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, index_topic_2 address to)'
            case '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822-3':
                /*
                {
                    "decodeStatus": "success",
                    "address": "0xa0799832FB2b9F18Acf44B92FbbEDCfD6442DD5e",
                    "transactionLogIndex": "0x9",
                    "data": "0x0000000000000000000000000000000000000000000000000000000002831ba800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002490807a22397be44",
                    "topics": [
                        "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822",
                        "0x000000000000000000000000a6baa075fb5cf4721b43fe068ee81b56f34fa06d",
                        "0x000000000000000000000000a6baa075fb5cf4721b43fe068ee81b56f34fa06d"
                    ],
                    "signature": "Swap(index_topic_1 address sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, index_topic_2 address to)",
                    "events": [{
                            "name": "sender",
                            "type": "address",
                            "value": "0xa6baa075fb5cf4721b43fe068ee81b56f34fa06d"
                        },
                        {
                            "name": "amount0In",
                            "type": "uint256",
                            "value": "42146728"
                        },
                        {
                            "name": "amount1In",
                            "type": "uint256",
                            "value": "0"
                        },
                        {
                            "name": "amount0Out",
                            "type": "uint256",
                            "value": "0"
                        },
                        {
                            "name": "amount1Out",
                            "type": "uint256",
                            "value": "42155952704964771396"
                        },
                        {
                            "name": "to",
                            "type": "address",
                            "value": "0xa6baa075fb5cf4721b43fe068ee81b56f34fa06d"
                        }
                    ]
                }
                */
                let uniswapV2 = {
                    type: 'swapV2',
                    maker: dEvents[0].value,
                    taker: dEvents[5].value,
                    amount0In: dEvents[1].value,
                    amount1In: dEvents[2].value,
                    amount0Out: dEvents[3].value,
                    amount1Out: dEvents[4].value,
                    path: (dEvents[1].value != '0' && dEvents[4].value != '0') ? 'token0 -> token1' : 'token1 -> token0',
                    lpTokenAddress: dLog.address
                }
                return uniswapV2
                break;

                //Swap(index_topic_1 address sender, index_topic_2 address recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)
            case '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67-3':
                /*
                {
                  decodeStatus: 'success',
                  address: '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640',
                  transactionLogIndex: '0x1c',
                  logIndex: '0x91',
                  data: '0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffddc5c8a0f0000000000000000000000000000000000000000000000004563918244f400000000000000000000000000000000000000005b1a5205020bff95ddfd32673db4000000000000000000000000000000000000000000000001191b54426751a66600000000000000000000000000000000000000000000000000000000000311c1',
                  topics: [
                    '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67',
                    '0x000000000000000000000000ef1c6e67703c7bd7107eed8303fbe6ec2554bf6b',
                    '0x00000000000000000000000021bd72a7e219b836680201c25b61a4aa407f7bfd'
                  ],
                  signature: 'Swap(index_topic_1 address sender, index_topic_2 address recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)',
                  fingerprintID: '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67-3',
                  events: [
                    {
                      name: 'sender',
                      type: 'address',
                      value: '0xef1c6e67703c7bd7107eed8303fbe6ec2554bf6b'
                    },
                    {
                      name: 'recipient',
                      type: 'address',
                      value: '0x21bd72a7e219b836680201c25b61a4aa407f7bfd'
                    },
                    { name: 'amount0', type: 'int256', value: '-9187849713' },
                    { name: 'amount1', type: 'int256', value: '5000000000000000000' },
                    {
                      name: 'sqrtPriceX96',
                      type: 'uint160',
                      value: '1847784589982773393746294154411444'
                    },
                    {
                      name: 'liquidity',
                      type: 'uint128',
                      value: '20255876393206916710'
                    },
                    { name: 'tick', type: 'int24', value: '201153' }
                  ]
                }
                */
                let amount0 = dEvents[2].value
                let amount1 = dEvents[3].value
                //convert to uniswapV2 style
                let uniswapV3 = {
                    type: 'swapV3',
                    maker: dEvents[0].value, //sender
                    taker: dEvents[1].value, //recipient
                    amount0In: (amount0 > 0) ? amount0 : 0,
                    amount1In: (amount1 > 0) ? amount1 : 0,
                    amount0Out: (amount0 < 0) ? amount0 : 0,
                    amount1Out: (amount1 < 0) ? amount1 : 0,
                    sqrtPriceX96: dEvents[4].value,
                    path: (amount0 > '0' && amount1 < '0') ? 'token0 -> token1' : 'token1 -> token0',
                    lpTokenAddress: dLog.address
                }
                console.log(`categorizeTokenSwaps uniswapV3`, uniswapV3)
                return uniswapV3
                break;
            default:
                break;
        }
    }
    return false
}

function debugTraceToFlatTraces(rpcTraces, txns) {
    let traces = [];
    if (!rpcTraces) {
        return traces
    }
    for (let tx_index = 0; tx_index < rpcTraces.length; tx_index++) {
        let tx = txns[tx_index]
        //console.log(`debugTraceToFlatTraces tx`, tx)
        let tx_transaction_hash = (tx.hash) ? tx.hash : tx.transactionHash
        let tx_trace = (rpcTraces[tx_index].result) ? rpcTraces[tx_index].result : rpcTraces[tx_index];
        traces.push(...iterate_transaction_trace(
            tx_transaction_hash,
            tx_index,
            tx_trace
        ));
    }
    return traces;
}

function iterate_transaction_trace(tx_transaction_hash, tx_index, tx_trace, trace_address = []) {
    //console.log(`tx_trace`, tx_trace)
    let trace = {};
    trace.transaction_hash = tx_transaction_hash
    trace.transaction_index = tx_index;

    trace.from_address = (tx_trace['from'] != undefined) ? tx_trace['from'].toLowerCase() : null;
    trace.to_address = (tx_trace['to'] != undefined) ? tx_trace['to'].toLowerCase() : null;

    trace.input = tx_trace['input'];
    trace.output = (tx_trace['output'] != undefined) ? tx_trace['output'] : null;

    trace.value = (tx_trace['value'] != undefined) ? paraTool.dechexToIntStr(tx_trace['value']) : 0;
    trace.gas = paraTool.dechexToIntStr(tx_trace['gas']);
    trace.gas_used = paraTool.dechexToIntStr(tx_trace['gasUsed']);

    trace.error = (tx_trace['error'] != undefined) ? tx_trace['error'] : null;

    // lowercase for compatibility with parity traces
    trace.trace_type = (tx_trace['type'] != undefined) ? tx_trace['type'].toLowerCase() : null;
    trace.call_type = null

    if (trace.trace_type === 'selfdestruct') {
        // rename to suicide for compatibility with parity traces
        trace.trace_type = 'suicide';
    } else if (['call', 'callcode', 'delegatecall', 'staticcall'].includes(trace.trace_type)) {
        trace.call_type = trace.trace_type;
        trace.trace_type = 'call';
    }

    let result = [trace];

    let calls = tx_trace['calls'] || [];

    trace.subtraces = calls.length;
    trace.trace_address = trace_address;
    trace.trace_id = `${trace.trace_type}_${tx_transaction_hash}_${trace_address_to_str(trace.trace_address)}`

    for (let call_index = 0; call_index < calls.length; call_index++) {
        let call_trace = calls[call_index];
        result.push(...iterate_transaction_trace(
            tx_transaction_hash,
            tx_index,
            call_trace,
            [...trace_address, call_index]
        ));
    }
    return result;
}

function trace_address_to_str(trace_address) {
    if (trace_address === null || trace_address.length === 0) {
        return '';
    }
    return trace_address.map(address_point => address_point.toString()).join('_');
}

function categorizeTokenTransfers(dLog) {
    //console.log(`categorizeTokenTransfers`, dLog)
    if (dLog.decodeStatus == "success") {
        let dSig = dLog.signature
        let dEvents = dLog.events
        let fingerprintID = dLog.fingerprintID
        switch (dSig) {
            case 'Transfer(index_topic_1 address from, index_topic_2 address to, uint256 value)':
            case 'Transfer(index_topic_1 address from, index_topic_2 address to, uint256 amount)':
                //console.log(`** dLog`, dLog)
                //ERC20
                let erc20Transfer = {
                    type: 'ERC20',
                    from: dEvents[0].value,
                    to: dEvents[1].value,
                    value: dEvents[2].value,
                    valueRaw: dEvents[2].value,
                    tokenAddress: dLog.address,
                    logIndex: dLog.logIndex
                }
                return erc20Transfer
                break;

            case 'Transfer(index_topic_1 address from, index_topic_2 address to, index_topic_3 uint256 tokenId)':
                //ERC721
                let er721Transfer = {
                    type: 'ERC721',
                    from: dEvents[0].value,
                    to: dEvents[1].value,
                    tokenId: dEvents[2].value,
                    valueRaw: dEvents[2].value,
                    tokenAddress: dLog.address,
                    logIndex: dLog.logIndex
                }
                return er721Transfer
                break;

            case 'TransferSingle(index_topic_1 address operator, index_topic_2 address from, index_topic_3 address to, uint256 id, uint256 value)':
                //ERC1155 - single -- tranform it into batch case
                /*
                @dev Either `TransferSingle` or `TransferBatch` MUST emit when tokens are transferred, including zero value transfers as well as minting or burning (see "Safe Transfer Rules" section of the standard).
                The `_operator` argument MUST be the address of an account/contract that is approved to make the transfer (SHOULD be msg.sender).
                The `_from` argument MUST be the address of the holder whose balance is decreased.
                The `_to` argument MUST be the address of the recipient whose balance is increased.
                The `_id` argument MUST be the token type being transferred.
                The `_value` argument MUST be the number of tokens the holder balance is decreased by and match what the recipient balance is increased by.
                When minting/creating tokens, the `_from` argument MUST be set to `0x0` (i.e. zero address).
                When burning/destroying tokens, the `_to` argument MUST be set to `0x0` (i.e. zero address).

                event TransferSingle(address indexed _operator, address indexed _from, address indexed _to, uint256 _id, uint256 _value);
                */
                let er1151SingleTransfer = {
                    type: 'ERC1155',
                    operator: dEvents[0].value,
                    from: dEvents[1].value,
                    to: dEvents[2].value,
                    tokenIds: [dEvents[3].value],
                    values: [dEvents[4].value],
                    tokenAddress: dLog.address,
                    isBatch: false,
                    logIndex: dLog.logIndex
                }
                return er1151SingleTransfer
                break;

            case 'TransferBatch(index_topic_1 address operator, index_topic_2 address from, index_topic_3 address to, uint256[] ids, uint256[] values)':
                //ERC1155 - batch
                /*
                @dev Either `TransferSingle` or `TransferBatch` MUST emit when tokens are transferred, including zero value transfers as well as minting or burning (see "Safe Transfer Rules" section of the standard).
                The `_operator` argument MUST be the address of an account/contract that is approved to make the transfer (SHOULD be msg.sender).
                The `_from` argument MUST be the address of the holder whose balance is decreased.
                The `_to` argument MUST be the address of the recipient whose balance is increased.
                The `_ids` argument MUST be the list of tokens being transferred.
                The `_values` argument MUST be the list of number of tokens (matching the list and order of tokens specified in _ids) the holder balance is decreased by and match what the recipient balance is increased by.
                When minting/creating tokens, the `_from` argument MUST be set to `0x0` (i.e. zero address).
                When burning/destroying tokens, the `_to` argument MUST be set to `0x0` (i.e. zero address).

                event TransferBatch(address indexed _operator, address indexed _from, address indexed _to, uint256[] _ids, uint256[] _values);
                */
                let er1151BatchTransfer = {
                    type: 'ERC1155',
                    operator: dEvents[0].value,
                    from: dEvents[1].value,
                    to: dEvents[2].value,
                    tokenIds: dEvents[3].value,
                    values: dEvents[4].value,
                    tokenAddress: dLog.address,
                    isBatch: true,
                    logIndex: dLog.logIndex
                }
                return er1151BatchTransfer
                break;

            default:
                break;
        }
    }
    return false
}

function analyzeABIInput(e) {
    var inputs = []
    var inputsAnon = []
    var flds = [];
    var types_indexed = null;
    var types_non_indexed = null;
    var indexedCnt = 0 //topic0 is signatureID
    let len = e.type == "function" ? 10 : false;
    let idx = 0;

    addABINames(e);
    for (const inp of e.inputs) {
        let isIndexed = false
        if (inp.indexed != undefined) {
            isIndexed = inp.indexed
        }
        let typeName;

        if (Array.isArray(inp.components)) {
            let t = []
            let tupleType = inp.type
            for (const c of inp.components) {
                let cTypeName = `${c.type} ${c.name}`.trim()
                t.push(parseTypeRaw(c))
            }

            let componentsType = `(${t.join(',')})`
            if (tupleType == 'tuple[]') {
                componentsType += `[]`
            }
            typeName = `${componentsType}`
            //console.log("RESULT", typeName, inp.type);
        } else {
            typeName = `${inp.type}`.trim()
        }
        let fld = inp.name && inp.name.length > 0 ? inp.name : `_f${idx}`;
        if (isIndexed) {
            indexedCnt++
            inputs.push(`${typeName}*`)
            inputsAnon.push(inp.type);
            flds.push(`${fld}*`)
            if (types_indexed == null) types_indexed = [];
            types_indexed.push(inp.type);
        } else {
            inputs.push(typeName);
            inputsAnon.push(typeName);
            flds.push(`${fld}`)
            if (types_non_indexed == null) types_non_indexed = [];
            types_non_indexed.push(typeName);
        }
        idx++;
    }
    let text_signature_full = `${e.name}(${inputs.join(',')})`;
    let text_signature = `${e.name}(${inputsAnon.join(',')})`


    const crypto = require('crypto');
    const hash = crypto.createHash('md5');
    hash.update(text_signature);
    let text_signature_md5 = hash.digest('hex');

    const hash2 = crypto.createHash('md5');
    hash2.update(text_signature_full);
    let text_signature_full_md5 = hash2.digest('hex');

    let hex_signature = encodeSelector(text_signature, len);
    return {
        text_signature_full,
        text_signature,
        text_signature_md5,
        text_signature_full_md5,
        hex_signature,
        types_indexed,
        types_non_indexed,
        flds,
        abiMaybe: e
    };
}

//TODO standardize event_type recursively -- currently only handle one level deep
function standardizeDecodedEvnets_old(decodedEvents) {
    //console.log(`decodedEvents`, decodedEvents)
    for (let i = 0; i < decodedEvents.length; i++) {
        let dEvent = decodedEvents[i]
        //console.log(`[${dEvent.type}] dEvent value`, dEvent.value)
        if ((dEvent.type.includes('int'))) {
            if (Array.isArray(dEvent.value)) {
                //console.log(`dEvent.value`, dEvent.value)
                for (let j = 0; j < dEvent.value.length; j++) {
                    let dEventValJ = dEvent.value[j]
                    console.log(`dEvent.value[${j}]`, dEventValJ)
                    dEvent.value[j] = paraTool.dechexToIntStr(dEventValJ)
                }
            } else if (dEvent.value.substr(0, 2) == '0x') {
                dEvent.value = paraTool.dechexToIntStr(dEvent.value)
            }
            //console.log(`new dEvent.value`, dEvent.value)
        }
        //console.log(`updated dEvent[${i}]`, dEvent)
        decodedEvents[i] = dEvent
    }
    //console.log(`standardizeDecodedEvnets`, decodedEvents)
    return decodedEvents
}

function standardizeDecodedEvnetType(dEventVal, dEventType) {
    let decodedVal = dEventVal
    try {
        if (dEventVal == '0x0000000000000000000000000000000000000000000000000000000000000001') {
            console.log(`dEventVal=${dEventVal}, dEventType=${dEventType}`)
        }
        if (dEventType.includes('int') && dEventVal.substr(0, 2) == '0x') {
            decodedVal = paraTool.dechexToIntStr(dEventVal)
        } else if (dEventType.includes('bool') && typeof dEventVal === 'string') {
            // some bool are decoded as '0x0000000000000000000000000000000000000000000000000000000000000001'
            // console.log(`boolean dEventType, dEventVal`, dEventVal)
            decodedVal = (decodedVal.includes('1')) ? true : false
        }
    } catch (e) {
        console.log(`dEventVal=${dEventVal}, dEventType=${dEventType}`, e)
    }
    return decodedVal
}

function standardizeDecodedEvnets(decodedEvents) {
    //console.log(`decodedEvents`, decodedEvents)
    for (let i = 0; i < decodedEvents.length; i++) {
        let dEvent = decodedEvents[i]
        let dEventType = dEvent.type
        if (Array.isArray(dEvent.value)) {
            //console.log(`dEvent.value`, dEvent.value)
            for (let j = 0; j < dEvent.value.length; j++) {
                console.log(`dEvent.value[${j}]`, dEvent.value[j], `decodedEvents`, decodedEvents)
                dEvent.value[j] = standardizeDecodedEvnetType(dEvent.value[j], dEventType)
            }
        } else {
            //do the type checking here
            dEvent.value = standardizeDecodedEvnetType(dEvent.value, dEventType)
        }
        //console.log(`updated dEvent[${i}]`, dEvent)
        decodedEvents[i] = dEvent
    }
    //console.log(`standardizeDecodedEvnets`, decodedEvents)
    return decodedEvents
}

function asteriskToFront(signature) {
    // Extract function name and arguments
    let [funcName, args] = signature.split('(');
    // Remove closing parenthesis from arguments string and split by comma
    args = args.slice(0, -1).split(',');

    // Iterate over args and move * to front if it exists
    args = args.map(arg => arg.includes('*') ? `*${arg.replace('*', '')}` : arg);

    // Join the modified args back into a string and return the final result
    return `${funcName}(${args.join(',')})`;
}


async function crawl_evm_logs(web3Api, bn) {
    var queryOpt = {
        fromBlock: bn,
        toBlock: bn
    }
    try {
        var logs = await web3Api.eth.getPastLogs(queryOpt)
        return logs;
    } catch (e) {
        console.log(`crawl_evm_logs err ${bn}`, e)
    }
    return false
}

async function crawl_evm_block(web3Api, bn) {
    let returnFullTx = true
    try {
        return await web3Api.eth.getBlock(bn, returnFullTx)
    } catch (e) {
        console.log(`crawl_evm_block err ${bn}`, e)
    }
    return false
}

async function crawl_evm_receipts(web3Api, blk, isParallel = true) {
    console.log(`crawl_evm_receipts [#${blk.number}] ${blk.hash}`)
    if (blk.transactions == undefined) {
        return false
    }
    let txns = blk.transactions
    let receipt = []
    //console.log(`crawl_evm_receipts START (len=${txns.length})`)
    if (isParallel) {
        let receiptAsync = await txns.map(async (txn) => {
            try {
                let txHash = txn.hash
                let tIndex = txn.transactionIndex
                //console.log(`${tIndex} ${txHash}`)
                let res = web3Api.eth.getTransactionReceipt(txHash)
                return res
            } catch (err) {
                console.log("ERR-index_blocks_period", err);
            }
        });
        // this will fail unless we get back all receipt from a block
        receipt = await Promise.all(receiptAsync);
    } else {
        for (const txn of txns) {
            try {
                let txHash = txn.hash
                let tIndex = txn.transactionIndex
                let res = await web3Api.eth.getTransactionReceipt(txHash)
                //console.log(`${tIndex} ${txHash}`)
                receipt.push(res)
            } catch (e) {
                console.log(`crawl_evm_receipts getTransactionReceipt err`, e)
            }
        }
    }
    // this "null check" protects against bad data being stored in BT evmreceipts
    if (receipt.length > 0) {
        for (let i = 0; i < receipt.length; i++) {
            if (receipt[i] == null) {
                return (false);
            }
        }
    }
    //console.log(`crawl_evm_receipts DONE (len=${txns.length})`)
    return receipt
}

//curl -k -s -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"eth_getBlockByNumber","params":["0x10cac1", true],"id":1}' https://rpc.moonriver.moonbeam.network

//https://blockscout.moonbeam.network/blocks/221001/transactions
//eth frontier header {"parentHash":"0x64547fb5b03d218d8510c328b11d7ee4639f5cf6e1504aa2a6fbe1772af6161e","ommersHash":"0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347","beneficiary":"0xb3e64ef8fc9df438c9a54f4b189eddc1807b55a5","stateRoot":"0xa39ce439c1e3df9d548d975ffe4dde01d20f88c589d312e0ba735480671304b5","transactionsRoot":"0x82dc0ce6a21d855276668568ab2d98ab83dddfb7b978c47bff483823a3af89b8","receiptsRoot":"0x5bea5f91118ac331208e518a00cfb06f253d091aea82cff10aa53e6dbcf10b58","logsBloom":"0x043000000000020008000400800000402000020004000000020000020088000000010020900000020002000022000200080000000084000000000200002000000000008000000000000000080000002000000000000080000000001040000040028000000300000000008000000018000011000000000001000000102000020000000204000400000000000000000100040000000001000840400040000000000202004000000101000001000000102020020100000000001000000c000000c000018002800000400000000000001000020000000000001000000000040020000110200010000000000000000000000040000000408000122004020000000009","difficulty":0,"number":221001,"gasLimit":15000000,"gasUsed":532067,"timestamp":1642513176312,"extraData":"0x","mixHash":"0x0000000000000000000000000000000000000000000000000000000000000000","nonce":"0x0000000000000000"}
//expectedHash: 0x70a75c7e0fcf0fb9c658fa08457546e08adb032d859841cbf784c9558906180e
//this is frontier format
function compute_EVM_BlockHash(h) {
    let difficulty = (h.difficulty == 0) ? '0x' : web3.utils.toHex(h.gasUsed)
    let gasUsed = (h.gasUsed == 0) ? '0x' : web3.utils.toHex(h.gasUsed)
    let ommerHash = (h.ommerHash != undefined) ? h.ommerHash : h.sha3Uncles
    let beneficiary = (h.beneficiary != undefined) ? h.beneficiary : h.author
    let mixHash = (h.mixHash != undefined) ? h.mixHash : '0x0000000000000000000000000000000000000000000000000000000000000000'
    let nonce = (h.nonce != undefined) ? h.nonce : '0x0000000000000000'
    if (h.sealFields != undefined) {
        mixHash = h.sealFields[0]
        nonce = h.sealFields[1]
    }

    let headerArr = [h.parentHash, ommerHash, beneficiary,
        h.stateRoot, h.transactionsRoot, h.receiptsRoot, h.logsBloom,
        difficulty, web3.utils.toHex(h.number), web3.utils.toHex(h.gasLimit), gasUsed, web3.utils.toHex(h.timestamp),
        h.extraData, mixHash, nonce
    ]
    console.log(headerArr)
    console.log(rlp.encode(headerArr).toString('hex'))
    let blockHash = web3.utils.keccak256(rlp.encode(headerArr))
    return blockHash
}

function compute_num_evm_logs(evmReceipts) {
    if (Array.isArray(evmReceipts)) {
        let numLog = 0
        for (const receipt of evmReceipts) {
            if (receipt && receipt.logs && receipt.logs.length !== undefined) {
                numLog += receipt.logs.length
            }
        }
        return numLog
    }
    return 0
}

async function createWeb3Api(rpcURL) {
    const Web3 = require('web3')
    if (rpcURL) {
        console.log("RPCURL", rpcURL);

        var web3Api = new Web3(rpcURL)
        var bn = await web3Api.eth.getBlockNumber()
        console.log(`web3Api ${rpcURL} is ready currentBN=${bn}`)
        return web3Api
    }
    return false
}

function loadWallet(pk) {
    const Web3 = require("web3");
    const web3 = new Web3();
    try {
        let wallet = web3.eth.accounts.privateKeyToAccount(pk);
        console.log(`evmWallet loaded: ${wallet.address}`)
        return wallet
    } catch (error) {
        console.log(`loadWallet error=${error.toString()}`)
    }
    return false
}

function isTxContractCreate(tx) {
    if (!tx) return (false);
    let isCreate = (tx.creates != null)
    if (tx.createdContracts.length > 0) {
        console.log(`${tx.transactionHash} -> contract created[${tx.createdContracts}], len=${tx.createdContracts.length}`)
        return true
    }
    if (isCreate) {
        console.log(`${tx.transactionHash} -> contract created ${tx.creates}`)
        return true
    }
    try {
        if (tx.decodedLogs) {
            for (const l of tx.decodedLogs) {
                //PairCreated(address,address,address,uint256)
                if (l.topics.length == 3 && l.topics[0] == '0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9') {
                    let pairAddr = l.events[2]['value']
                    let checkSumContractAddr = web3.utils.toChecksumAddress(pairAddr)
                    tx.creates = checkSumContractAddr
                    return true
                }
            }
        }
    } catch (e) {
        console.log(`isTxContractCreate [${tx.transactionHash}] err`, e)
    }
    return isCreate;
}

//0xaf67fb1bf8be6a5aee2a154771ee057bd85ec55b8000dfc4b58cc49f234328c3
function getTxContractCreateAddress(tx) {
    let contractAddress = []
    let contractMap = {}
    let cnt = 0
    if (tx.creates != null) {
        contractMap[tx.creates] = 1
        cnt++
    }
    if (tx.createdContracts.length > 0) {
        for (const createAddr of tx.createdContracts) {
            contractMap[createAddr] = 1
            cnt++
        }
    }
    return Object.keys(contractMap)
}

function is_tx_native_transfer(tx) {
    // when native transfer happens both from and to are changed
    // todoL internal transfer
    if (tx && (tx.value !== undefined) && (tx.value != 0)) {
        return true
    }
    return (false);
}

function is_tx_token_transfer(tx) {
    if (tx !== undefined && (tx.transfers !== undefined) && tx.transfers.length > 0) {
        return true
    }
    return (false);
}

function is_tx_swap(tx) {
    if (tx !== undefined && (tx.swaps !== undefined) && tx.swaps.length > 0) {
        return true
    }
    return (false);
}


function is_tx_lp_sync(tx) {
    if (tx == undefined) return (false);
    if (tx.decodedLogs == undefined) return (false);
    let decodedLogs = tx.decodedLogs
    let syncs = []
    for (let i = 0; i < decodedLogs.length; i++) {
        let dLog = decodedLogs[i]
        if (dLog.decodeStatus == "success") {
            let syncEvent = categorizeTokenSync(dLog)
            if (syncEvent) {
                syncs.push(syncEvent)
                continue
            }
        }
    }
    if (syncs.length == 0) return false
    return syncs;
}

function int_to_hex(id) {
    return web3.utils.toHex(id)
}

function mapABITypeToBqType(typ) {
    switch (typ) {
        case "address":
            return "STRING";
        case "int128":
        case "uint128":
            return "STRING";
        case "int160":
        case "uint160":
            return "STRING";
        case "int256":
        case "uint256":
            return "STRING";
        case "string":
            return "STRING";
        case "bool":
            return "BOOLEAN";
        case "int8":
        case "int16":
        case "int24":
        case "int32":
        case "uint8":
        case "uint16":
        case "uint24":
            return "INTEGER";
        case "uint32":
            return "INTEGER";
        case "bytes":
            return "STRING"; // HEX string
            break;
        case "bytes32":
            return "STRING"; // HEX string
            break;
        case "tuple":
            return "JSON";
            break;
            /*
            default:
                return "JSON";
            */
    }
    if (typ.includes('int') && (!typ.includes('(') && !typ.includes(')')) && (!typ.includes('[') && !typ.includes(']'))) {
        //this exclude tuple type like (address from, address to, uint256 value, uint256 gas, uint256 nonce, bytes data)
        return "STRING"
    } else {
        return "JSON";
    }
}

function computeTableId(abiStruct, fingerprintID) {
    //console.log(`computeTableId abiStr`, abiStruct)
    let tableId = false
    let abi = abiStruct
    if (abi.length > 0) {
        let a = abi[0];
        const methodID = (a.type == "function") ? fingerprintID.substring(0, 10) : fingerprintID.replaceAll("-", "_");
        const tablePrefix = (a.type == "function") ? "call" : "evt";
        if (tablePrefix == "call" && (a.stateMutability == "view" || a.stateMutability == "pure")) return tableId;
        tableId = `${tablePrefix}_${a.name}_${methodID}`
    }
    return tableId
}

function getEVMFlds(schema) {
    let flds = []
    let protected_flds = ["chain_id", "evm_chain_id", "contract_address", "_partition", "_table_", "_file_", "_row_timestamp_", "__root__", "_colidentifier",
        "call_success", "call_tx_hash", "call_trace_address", "call_block_time", "call_block_number",
        "evt_tx_hash", "evt_index", "evt_block_time", "evt_block_number"
    ]
    for (const sch of schema) {
        if (!protected_flds.includes(sch.name)) {
            flds.push(sch.name)
        }
    }
    return flds
}

function createEvmSchema(abiStruct, fingerprintID, tableId = false) {
    let abi = abiStruct
    if (abi.length > 0) {
        let a = abi[0];
        //const methodID = (a.type == "function") ? r.fingerprintID.substring(0, 10) : r.fingerprintID.substring(0, r.fingerprintID.length - 10).replaceAll("-", "_");
        const tablePrefix = (a.type == "function") ? "call" : "evt";
        //if (tablePrefix == "call" && (a.stateMutability == "view" || a.stateMutability == "pure")) continue;
        //tableId = `${tablePrefix}_${a.name}_${methodID}`
        if (!tableId) tableId = computeTableId(abi, fingerprintID)
        const inputs = a.inputs;
        //console.log(tableId, inputs); // .length, r.signature, r.signatureRaw, abi);
        const sch = [];
        try {
            let timePartitionField = null
            sch.push({
                "name": "chain_id",
                "type": "string",
                "mode": "REQUIRED"
            });
            sch.push({
                "name": "evm_chain_id",
                "type": "integer",
                "mode": "REQUIRED"
            });
            sch.push({
                "name": "contract_address",
                "type": "string",
                "mode": "REQUIRED"
            });
            let protected_flds = ["chain_id", "evm_chain_id", "contract_address", "_partition", "_table_", "_file_", "_row_timestamp_", "__root__", "_colidentifier"];
            if (tablePrefix == "call") {
                sch.push({
                    "name": "call_success",
                    "type": "boolean",
                    "mode": "REQUIRED"
                });
                sch.push({
                    "name": "call_tx_hash",
                    "type": "string",
                    "mode": "REQUIRED"
                });
                sch.push({
                    "name": "call_tx_index",
                    "type": "integer",
                    "mode": "REQUIRED"
                });
                sch.push({
                    "name": "call_trace_address",
                    "type": "JSON",
                    "mode": "NULLABLE"
                });
                sch.push({
                    "name": "call_block_time",
                    "type": "timestamp",
                    "mode": "REQUIRED"
                });
                sch.push({
                    "name": "call_block_number",
                    "type": "integer",
                    "mode": "REQUIRED"
                });
                timePartitionField = "call_block_time";
                protected_flds.push("call_success", "call_tx_hash", "call_trace_address", "call_block_time", "call_block_number")
            } else {
                sch.push({
                    "name": "evt_tx_hash",
                    "type": "string",
                    "mode": "REQUIRED"
                });
                sch.push({
                    "name": "evt_index",
                    "type": "INTEGER",
                    "mode": "NULLABLE"
                });
                sch.push({
                    "name": "evt_block_time",
                    "type": "timestamp",
                    "mode": "REQUIRED"
                });
                sch.push({
                    "name": "evt_block_number",
                    "type": "integer",
                    "mode": "REQUIRED"
                });
                timePartitionField = "evt_block_time";
                protected_flds.push("evt_tx_hash", "evt_index", "evt_block_time", "evt_block_number");
            }
            let idx = 0;
            for (const inp of inputs) {
                switch (inp.internalType) {
                    case "IERC20":
                    case "ERC20":
                    case "IERC20Ext":
                        // TODO: _symbol, _decimals, _price_usd, _float
                        break;
                    case "IERC721":
                    case "IERC1155":
                        // TODO: add
                        break;
                }
                let description = JSON.stringify(inp);
                // cap description
                if (description.length >= 1024) description = description.substr(0, 1024);
                // rename protected
                let nm = inp.name && inp.name.length > 0 ? inp.name : `_unnamed${idx}`
                if (protected_flds.includes(nm.toLowerCase())) {
                    console.log
                    nm = `renamed${nm}`;
                }
                sch.push({
                    "name": nm,
                    "type": mapABITypeToBqType(inp.type),
                    "description": description,
                    "mode": "NULLABLE"
                });
                idx++;
            }
            let schema = {
                tableId: tableId,
                schema: sch,
                timePartitioning: {
                    type: 'DAY',
                    field: timePartitionField
                },
            }
            return schema
        } catch (err) {
            console.log(err, sch);
            return false
        }
    }
}

// this works for both project-specific tables (call_project_..., evt_project_) and general tables (call_, evt_) since the last 1-2 components are positioned the same way
function getFingerprintIDFromTableID(tableID = 'evt_RedeemSeniorBond_0xfa51bdcf530ef35114732d8f7598a2938621008a16d9bb235a8c84fe82e4841e_3') {
    let fingerprintID = false
    if (tableID.substr(0, 5) == 'call_') {
        fingerprintID = tableID.split('_').pop()
    } else if (tableID.substr(0, 4) == 'evt_') {
        let pieces = tableID.split('_')
        let topicLen = pieces.pop()
        let topic0 = pieces.pop()
        fingerprintID = `${topic0}-${topicLen}`
    }
    return fingerprintID
}

//0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118-4-0x4d1d4f92 -> evt_PoolCreated_0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118_4
function computeTableIDFromFingerprintIDAndName(fingerprintID = '0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118-4-0x4d1d4f92', name = 'PoolCreated') {
    //evtLen = 79; callLen = 21
    let tableId = false
    let typ = null
    let pieces = fingerprintID.split('-')
    if (fingerprintID.length == '79') {
        typ = 'evt'
        tableId = `${typ}_${name}_${pieces[0]}_${pieces[1]}`
    } else if (fingerprintID.length == '21') {
        typ = 'call'
        tableId = `${typ}_${name}_${pieces[0]}`
    }
    return tableId
}

function computeModifiedFingerprintID(fingerprintID = '0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118-4-0x4d1d4f92') {
    //evtLen = 79; callLen = 21
    let modifiedFingerprintID = false
    let typ = null
    let pieces = fingerprintID.split('-')
    if (fingerprintID.length == '79') {
        typ = 'evt'
        modifiedFingerprintID = `${pieces[0]}_${pieces[1]}`
    } else if (fingerprintID.length == '21') {
        typ = 'call'
        modifiedFingerprintID = `${pieces[0]}`
    }
    return modifiedFingerprintID
}


async function detect_contract_labels(web3Api, contractAddress, bn) {

}

//return symbol, name, decimal, totalSupply
async function getContractByteCode(web3Api, contractAddress, bn = 'latest', RPCBackfill = null) {
    let code = false
    try {
        code = web3Api.eth.getCode(contractAddress)
    } catch (e) {
        console.log(`getContractByteCode contractAddress=${contractAddress}. error`, e)
        return false
    }
    return code
}

async function ProcessContractByteCode(web3Api, contractAddress, bn = 'latest', topicFilter = false, RPCBackfill = null) {
    //TODO: does not decode proxy
    let contractInfo = {
        address: contractAddress.toLowerCase(),
        bytecode: null,
        bytecodeHash: null,
        function_sighashes: null,
        event_topics: null,
        is_erc20: false,
        is_erc721: false,
        is_erc1155: false,
        //is_erc165: false,
        block_timestamp: null,
        block_number: bn,
        block_hash: null,
    }

    let bytecode = await getContractByteCode(web3Api, contractAddress)
    if (bytecode) {
        contractInfo.bytecode = bytecode
        contractInfo.bytecodeHash = web3.utils.keccak256(bytecode)
        let codeHashInfo = getsigHashes(bytecode, topicFilter)
        contractInfo.function_sighashes = codeHashInfo.func
        contractInfo.event_topics = codeHashInfo.events
        //contractInfo.is_erc165 = detectERC165(codeHashInfo, bytecode)
        if (detectERC20(codeHashInfo, bytecode)) {
            contractInfo.is_erc20 = true
            let tokenInfo = await getERC20TokenInfo(web3Api, contractAddress, bn, RPCBackfill);
            if (tokenInfo) {
                //console.log("FETCHED TOKENINFO", tokenInfo);
                for (const k of Object.keys(tokenInfo)) {
                    contractInfo[k] = tokenInfo[k];
                }
            }
            //console.log(`**** [ERC20] contractAddress=${contractAddress}, codeHashInfo`, codeHashInfo)
        } else if (detectERC721(codeHashInfo, bytecode)) {
            //console.log(`**** [ERC721] contractAddress=${contractAddress}, codeHashInfo`, codeHashInfo)
            contractInfo.is_erc721 = true
            // TODO: copy values
        } else if (detectERC1155(codeHashInfo, bytecode)) {
            //console.log(`**** [ERC1155] contractAddress=${contractAddress}, codeHashInfo`, codeHashInfo)
            contractInfo.is_erc1155 = true
        }
        //console.log(`**** contractAddress=${contractAddress}, codeHashInfo`, codeHashInfo)
    }
    //console.log(`**** contractInfo`, contractInfo)
    return contractInfo
}

function extractPushData(opcodes, topicFilter = false) {
    // Filter the opcodes by name and map to pushData as hex
    //let blacklist = ["ffffff", "000000"];
    let blacklist = []
    let pushNames = ['PUSH4', 'PUSH32']
    let filteredOps = opcodes
        .filter(opcode => pushNames.includes(opcode.name))
        .map(opcode => {
            let abiType = "function";
            if (opcode.name === 'PUSH32') {
                abiType = 'event';
            }
            let hexSignature = "0x" + opcode.pushData.toString('hex');
            return {
                abiType: abiType,
                signature: hexSignature
            }
        })
        .filter(item => !blacklist.some(blacklisted => item.signature.includes(blacklisted)));
    let res = {
        func: [],
        events: [],
        unknownEvents: []
    }
    let byteHash = {}
    if (topicFilter) res.filtered = true
    for (const op of filteredOps) {
        let hash = op.signature
        if (byteHash[hash] == undefined) {
            byteHash[hash] = 1
            if (op.abiType == "function") {
                res.func.push(hash)
            } else if (op.abiType == "event") {
                if (topicFilter && topicFilter.has(hash)) {
                    res.events.push(hash)
                } else {
                    res.unknownEvents.push(hash)
                }
            }
        }
    }
    return res
}


function getsigHashes(bytecode, topicFilter = false) {
    const evm = new EVM(bytecode);
    let opcodes = evm.getOpcodes()
    let res = extractPushData(opcodes, topicFilter)
    let selectors = whatsabi.selectorsFromBytecode(bytecode)
    res.func = selectors
    return res
}

function getSchemaWithoutDesc(schema) {
    let tinySchema = []
    for (let i = 0; i < schema.length; i++) {
        let s = schema[i]
        let t = {
            mode: s.mode,
            name: s.name,
            type: s.type,
        }
        tinySchema.push(t)
    }
    return tinySchema
}

function process_evm_trace(evmTrace, res, depth, stack = [], txs) {
    for (let i = 0; i < evmTrace.length; i++) {
        let t = evmTrace[i];
        try {
            if (t.value != "0x0" && stack.length > 1) {
                res.push({
                    transactionHash: txs[stack[1]].hash, //mk check
                    stack: stack,
                    from: t.from,
                    to: t.to,
                    gas: paraTool.dechexToInt(t.gas),
                    gasUsed: paraTool.dechexToInt(t.gasUsed),
                    value: paraTool.dechexToInt(t.value),
                });
            }
            if (t.calls != undefined) {
                let newStack = [...stack];
                newStack.push(i);
                // recursive call
                process_evm_trace(t.calls, res, depth + 1, newStack, txs);
            }
        } catch (err) {
            console.log(`process_evm_trace txs[stack[1]]`, txs[stack[1]])
            console.log(`process_evm_trace err=${err.toString()}`)
            console.log(`process_evm_trace t`, t)
            console.log(`process_evm_trace stack(len=${stack.length})`, stack)
            console.log(`process_evm_trace txs(len=${txs.length})`, txs)
            //process.exit(0);
        }
    }
}

function process_evm_trace_creates(evmTrace, res, depth, stack = [], txs) {
    for (let i = 0; i < evmTrace.length; i++) {
        let t = evmTrace[i].result ? evmTrace[i].result : evmTrace[i];
        try {
            //console.log(`T.type =${t.type}`)
            if (t.type == "CREATE" || t.type == "CREATE2") { // REVIEW: what other types?
                let transactionHash = false
                if (stack.length > 0) {
                    transactionHash = (txs[stack[0]].hash) ? (txs[stack[0]].hash) : (txs[stack[0]].transactionHash) //mk check,
                } else {
                    transactionHash = (txs[i].hash) ? (txs[i].hash) : (txs[i].transactionHash) //mk check,
                }
                t.transactionHash = transactionHash
                res.push(t);
                let contractAddress = t.to;
                let byteCode = t.input;
                console.log(`[Contract ${t.type}]`, i, depth, stack, `${t.type}`, contractAddress, `transactionHash: ${transactionHash}`)
                // KEY TODO: take bytecode + contractAddress, call async function ProcessContractByteCode(web3Api, contractAddress, bn = 'latest', topicFilter = false, RPCBackfill = null) -- or better after?
            }
            // recurse into calls
            if (t.calls != undefined) {
                let newStack = [...stack];
                newStack.push(i);
                process_evm_trace_creates(t.calls, res, depth + 1, newStack, txs);
            }
        } catch (err) {
            console.log(`process_evm_trace err=${err.toString()}`)
            console.log(`process_evm_trace t`, t)
            console.log(`process_evm_trace stack(len=${stack.length})`, stack)
        }
    }
}

function standardizeRPCBlock(blk) {
    let blockIntegerFlds = ["baseFeePerGas", "difficulty", "gasLimit", "gasUsed", "number", "size", "timestamp", "totalDifficulty"]
    let txnIntegerFlds = ["blockNumber", "gas", "gasPrice", "nonce", "transactionIndex", "value", "type", "maxFeePerGas", "maxPriorityFeePerGas", "chainId"]
    for (const blockFld of Object.keys(blk)) {
        if (blockIntegerFlds.includes(blockFld)) {
            if (blk[blockFld]) blk[blockFld] = paraTool.dechexToInt(blk[blockFld])
        }
    }
    for (let i = 0; i < blk.transactions.length; i++) {
        let txn = blk.transactions[i]
        for (const txnFld of Object.keys(txn)) {
            if (txnIntegerFlds.includes(txnFld)) {
                if (txn[txnFld]) txn[txnFld] = paraTool.dechexToInt(txn[txnFld])
            }
        }
        blk.transactions[i] = txn
    }
    return blk
}

function standardizeRPCReceiptLogs(receipts) {
    let receiptIntegerFlds = ["blockNumber", "cumulativeGasUsed", "effectiveGasPrice", "gasUsed"]
    let logIntegerFlds = ["blockNumber", "transactionIndex", "logIndex"]
    for (let i = 0; i < receipts.length; i++) {
        let receipt = receipts[i]
        for (const receiptFld of Object.keys(receipt)) {
            if (receiptIntegerFlds.includes(receiptFld)) {
                if (receipt[receiptFld]) receipt[receiptFld] = paraTool.dechexToInt(receipt[receiptFld])
            }
        }
        for (let i = 0; i < receipt.logs.length; i++) {
            let log = receipt.logs[i]
            for (const logFld of Object.keys(log)) {
                if (logIntegerFlds.includes(logFld)) {
                    if (log[logFld]) log[logFld] = paraTool.dechexToInt(log[logFld])
                }
            }
            receipt.logs[i] = log
        }
        receipts[i] = receipt
    }
    return receipts
}

function xTokenBuilder(web3Api, currency_address = '0x0000000000000000000000000000000000000802', amount = 1, decimals = 18, beneficiary = '0xd2473025c560e31b005151ebadbc3e1f14a2af8fa60ed87e2b35fa930523cd3c', chainIDDest = 22006) {
    console.log(`xTokenBuilder currency_address=${currency_address}, amount=${amount}, decimals=${decimals}, beneficiary=${beneficiary}, chainIDDest=${chainIDDest}`)
    var xTokensContractAbiStr = '[{"inputs":[{"internalType":"address","name":"currency_address","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"},{"components":[{"internalType":"uint8","name":"parents","type":"uint8"},{"internalType":"bytes[]","name":"interior","type":"bytes[]"}],"internalType":"struct IxTokens.Multilocation","name":"destination","type":"tuple"},{"internalType":"uint64","name":"weight","type":"uint64"}],"name":"transfer","outputs":[],"stateMutability":"nonpayable","type":"function"}]'
    var xTokensContractAbi = JSON.parse(xTokensContractAbiStr)
    var xTokensContractAddress = '0x0000000000000000000000000000000000000804' //this is the precompiled interface
    var xTokensContract = new web3Api.eth.Contract(xTokensContractAbi, xTokensContractAddress);
    let weight = 6000000000
    let relayChain = paraTool.getRelayChainByChainID(chainIDDest)
    let paraIDDest = paraTool.getParaIDfromChainID(chainIDDest)
    let junction = []
    let junctionInterior = []
    junction.push(1) // local asset would have 0. (but this is not xcm?)
    if (paraIDDest != 0) {
        let parachainHex = paraTool.bnToHex(paraIDDest).substr(2)
        parachainHex = '0x' + parachainHex.padStart(10, '0')
        junctionInterior.push(parachainHex)
    }
    //assume "any"
    if (beneficiary.length == 66) {
        let accountId32 = `0x01${beneficiary.substr(2)}00`
        junctionInterior.push(accountId32)
    } else if (beneficiary.length == 42) {
        let accountKey20 = `0x03${beneficiary.substr(2)}00`
        junctionInterior.push(accountKey20)
    }
    let rawAmount = paraTool.toBaseUnit(`${amount}`, decimals)
    junction.push(junctionInterior)
    console.log(`junction`, junction)
    console.log(`junctionInterior`, junctionInterior)
    //[1,["0x00000007d4","0x01108cb67dcbaab765b66fdb99e3c4997ead09f1f82186e425dc9fec271e97aa7e00"]]
    console.log(`xTokenBuilder currency_address=${currency_address}, Human Readable Amount=${amount}(rawAmount=${rawAmount}, using decimals=${decimals}), junction=${junction}, weight=${weight}`)
    var data = xTokensContract.methods.transfer(currency_address, rawAmount, junction, weight).encodeABI()
    let txStruct = {
        to: xTokensContractAddress,
        value: '0',
        gas: 2000000,
        data: data
    }
    console.log(`xTokenBuilder txStruct=`, txStruct)
    return txStruct
}

function xc20AssetWithdrawBuilder(web3Api, currency_address = '0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF', amount = 1, decimals = 18, beneficiary = '0xd2473025c560e31b005151ebadbc3e1f14a2af8fa60ed87e2b35fa930523cd3c', chainIDDest = 0) {
    let isBeneficiaryEVM = (beneficiary.length == 42) ? true : false
    console.log(`xc20Builder currency_address=${currency_address}, amount=${amount}, decimals=${decimals}, beneficiary=${beneficiary}(isEVM=${isBeneficiaryEVM}), chainIDDest=${chainIDDest}`)
    //https://github.com/AstarNetwork/astar-frame/blob/polkadot-v0.9.28/precompiles/xcm/XCM.sol
    var xc20ContractAbiStr = '[{"inputs":[{"internalType":"address[]","name":"asset_id","type":"address[]"},{"internalType":"uint256[]","name":"asset_amount","type":"uint256[]"},{"internalType":"bytes32","name":"recipient_account_id","type":"bytes32"},{"internalType":"bool","name":"is_relay","type":"bool"},{"internalType":"uint256","name":"parachain_id","type":"uint256"},{"internalType":"uint256","name":"fee_index","type":"uint256"}],"name":"assets_withdraw","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address[]","name":"asset_id","type":"address[]"},{"internalType":"uint256[]","name":"asset_amount","type":"uint256[]"},{"internalType":"address","name":"recipient_account_id","type":"address"},{"internalType":"bool","name":"is_relay","type":"bool"},{"internalType":"uint256","name":"parachain_id","type":"uint256"},{"internalType":"uint256","name":"fee_index","type":"uint256"}],"name":"assets_withdraw","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"}]'

    var xc20ContractAbi = JSON.parse(xc20ContractAbiStr)
    var xc20ContractAddress = '0x0000000000000000000000000000000000005004' //this is the precompiled interface
    var xc20Contract = new web3Api.eth.Contract(xc20ContractAbi, xc20ContractAddress);
    let weight = 6000000000
    let relayChain = paraTool.getRelayChainByChainID(chainIDDest)
    let paraIDDest = paraTool.getParaIDfromChainID(chainIDDest)
    /*
    function assets_withdraw(
    address[] calldata asset_id,
    uint256[] calldata asset_amount,
    bytes32/address  recipient_account_id,
    bool      is_relay,
    uint256   parachain_id,
    uint256   fee_index
    ) external returns (bool);
    */
    let currency_address_list = []
    let amountList = []
    let isRelay = true
    let feeIndex = 0
    let data = '0x'
    if (paraIDDest != 0) {
        isRelay = false
    }
    //only teleport one asset for now
    currency_address_list.push(currency_address)
    let rawAmount = paraTool.toBaseUnit(`${amount}`, decimals)
    amountList.push(rawAmount)
    if (isBeneficiaryEVM) {
        //0xecf766ff  /BeneficiaryEVM
        console.log(`xc20Builder method=0xecf766ff, currency_address_list=${currency_address_list}, Human Readable Amount=${amount}(amountList=${amountList}, beneficiary=${beneficiary}, using decimals=${decimals})`)
        data = xc20Contract.methods['0xecf766ff'](currency_address_list, amountList, beneficiary, isRelay, paraIDDest, feeIndex).encodeABI()
    } else if (beneficiary.length == 66) {
        //0x019054d0 /BeneficiarySubstrate
        console.log(`xc20Builder method=0x019054d0, currency_address_list=${currency_address_list}, Human Readable Amount=${amount}(amountList=${amountList}, using decimals=${decimals})`)
        data = xc20Contract.methods['0x019054d0'](currency_address_list, amountList, beneficiary, isRelay, paraIDDest, feeIndex).encodeABI()
    }
    let txStruct = {
        to: xc20ContractAddress,
        gasPrice: web3.utils.numberToHex('30052000000'), //30.052Gwei
        value: '0',
        gas: 2000000,
        data: data
    }
    console.log(`xc20Builder txStruct=`, txStruct)
    return txStruct
}

module.exports = {
    toHex: function(bytes) {
        return toHex(bytes);
    },
    fromHex: function(hexStr) {
        var s = hexStr;
        if (hexStr.substr(0, 2).toLowerCase() == "0x") s = hexStr.substr(2);
        if (s == "") return new Uint8Array();
        return new Uint8Array(s.match(/.{1,2}/g).map((byte) => parseInt(byte, 16)));
    },
    crawlEvmBlock: async function(web3Api, bn) {
        return crawl_evm_block(web3Api, bn)
    },
    standardizeRPCBlock: standardizeRPCBlock,
    standardizeRPCReceiptLogs: standardizeRPCReceiptLogs,
    crawlEvmLogs: async function(web3Api, bn) {
        return crawl_evm_logs(web3Api, bn)
    },
    crawlEvmReceipts: async function(web3Api, blk, isParallel = true) {
        return crawl_evm_receipts(web3Api, blk, isParallel)
    },
    detectContractLabels: async function(web3Api, contractAddress, bn) {
        return detect_contract_labels(web3Api, contractAddress, bn)
    },
    getERC20TokenInfo: async function(web3Api, contractAddress, bn) {
        return getERC20TokenInfo(web3Api, contractAddress, bn)
    },
    getContractByteCode: async function(web3Api, contractAddress, bn) {
        return getContractByteCode(web3Api, contractAddress, bn)
    },
    ProcessContractByteCode: async function(web3Api, contractAddress, bn, topicFilter) {
        return ProcessContractByteCode(web3Api, contractAddress, bn, topicFilter)
    },
    getTokenTotalSupply: async function(web3Api, contractAddress, bn) {
        return getTokenTotalSupply(web3Api, contractAddress, bn)
    },
    getERC20LiquidityPairTokenInfo: async function(web3Api, contractAddress, bn) {
        return getERC20LiquidityPairTokenInfo(web3Api, contractAddress, bn)
    },
    getERC20LiquidityPairRawReserve: async function(web3Api, contractAddress, bn) {
        return getERC20LiquidityPairRawReserve(web3Api, contractAddress, bn)
    },
    getTokenHoldersRawBalances: async function(web3Api, contractAddress, holders, tokenDecimal, bn) {
        return getTokenHoldersRawBalances(web3Api, contractAddress, holders, tokenDecimal, bn)
    },
    getNativeChainBalances: async function(web3Api, holders, bn) {
        return getNativeChainBalances(web3Api, holders, bn)
    },
    getERC721ContractInfo: async function(web3Api, contractAddress, bn) {
        return getERC721ContractInfo(web3Api, contractAddress, bn)
    },
    getERC1155ContractInfo: async function(web3Api, contractAddress, bn) {
        // stub.. not sure how to parse 1155 yet.
        return false
    },
    getERC721NFTMeta: async function(web3Api, contractAddress, tokenID, fetchMeta = false, bn = 'latest') {
        return getERC721NFTMeta(web3Api, contractAddress, tokenID, fetchMeta, bn)
    },
    computeNumEvmlogs: function(evmReceipts) {
        return compute_num_evm_logs(evmReceipts)
    },
    computeEVMBlockHash: function(block) {
        return compute_EVM_BlockHash(block)
    },
    createWeb3Api: async function(rpcURL) {
        return createWeb3Api(rpcURL)
    },
    loadWallet: function(pk) {
        return loadWallet(pk)
    },
    decodeRLPTransaction: function(rlpTx) {
        return decodeRLPTransaction(rlpTx)
    },
    signEvmTx: async function(web3Api, txStruct, wallet) {
        return signEvmTx(web3Api, txStruct, wallet)
    },
    sendSignedTx: async function(web3Api, signedTx) {
        return sendSignedTx(web3Api, signedTx)
    },
    sendSignedRLPTx: async function(web3Api, rlpTX) {
        return sendSignedRLPTx(web3Api, rlpTX)
    },
    parseAbiSignature: function(abiStrArr) {
        return parseAbiSignature(abiStrArr)
    },
    fuseBlockTransactionReceipt: async function(evmBlk, dTxns, flatTraces, dTrace, chainID) {
        return fuseBlockTransactionReceipt(evmBlk, dTxns, flatTraces, dTrace, chainID)
    },
    decorateTxn: function(dTxn, dReceipt, dInternal, blockTS = false, chainID = false) {
        return decorateTxn(dTxn, dReceipt, dInternal, blockTS, chainID);
    },
    isTxContractCreate: function(tx) {
        return isTxContractCreate(tx);
    },
    getTxContractCreateAddress: function(tx) {
        return getTxContractCreateAddress(tx);
    },
    isTxNativeTransfer: function(tx) {
        return is_tx_native_transfer(tx);
    },
    isTxTokenTransfer: function(tx) {
        return is_tx_token_transfer(tx);
    },
    isTxSwap: function(tx) {
        return is_tx_swap(tx);
    },
    isTxLPSync: function(tx) {
        return is_tx_lp_sync(tx);
    },
    computeTokenIDHex: function(tokenID) {
        return int_to_hex(tokenID);
    },
    crawlLink: async function(ipfsUrl) {
        return crawl_link(ipfsUrl);
    },
    convertIPFSlink: function(ipfsUrl) {
        return convert_ifps_link(ipfsUrl);
    },
    validate_bigint: function(i) {
        if (i > 0 && (i.toString().length < 30)) {
            return i;
        }
        return 0;
    },
    initContract: function(web3Api, contractABI, contractAddress) {
        return initContract(web3Api, contractABI, contractAddress)
    },
    toChecksumAddress: function(addr) {
        try {
            let checkSumAddr = web3.utils.toChecksumAddress(addr)
            return checkSumAddr
        } catch (e) {
            return null
        }
    },
    debugTraceToFlatTraces: function(rpcTraces, txns) {
        return debugTraceToFlatTraces(rpcTraces, txns)
    },
    processEVMTrace: function(evmTrace, evmTxs) {
        let res = []
        process_evm_trace(evmTrace, res, 0, [0], evmTxs);
        //res = debug_trace_to_flat_traces(evmTrace, evmTxs)
        return res
    },
    keccak256: function(hex) {
        return keccak256(hex);
    },
    decodeRLPTxRaw: function(hex) {
        return decodeRLPTx(hex);
    },
    computeConnectedTxHash: function(tx) {
        return computeConnectedTxHash(tx);
    },
    evmChainIDToChainID: function(evmChainID) {
        evmChainID = parseInt(evmChainID, 10)
        switch (evmChainID) {
            case 1284:
                return 2004;
            case 1285:
                return 22023;
            case 1287:
                return 61000;
            case 1288:
                return 60888;
        }
        return null;
    },
    getABIByAssetType: function(assetType) {
        return getABIByAssetType(assetType);
    },
    buildSchemaInfoFromSig: buildSchemaInfoFromSig,
    mapABITypeToBqType: mapABITypeToBqType,
    computeTableId: computeTableId,
    createEvmSchema: createEvmSchema,
    getFingerprintIDFromTableID: getFingerprintIDFromTableID,
    computeTableIDFromFingerprintIDAndName: computeTableIDFromFingerprintIDAndName,
    computeModifiedFingerprintID: computeModifiedFingerprintID,
    getEVMFlds: getEVMFlds,
    getSchemaWithoutDesc: getSchemaWithoutDesc,
    xTokenBuilder: function(web3Api, currencyAddress, amount, decimal, beneficiary, chainIDDest) {
        return xTokenBuilder(web3Api, currencyAddress, amount, decimal, beneficiary, chainIDDest)
    },
    xc20AssetWithdrawBuilder: function(web3Api, currencyAddress, amount, decimal, beneficiary, chainIDDest) {
        return xc20AssetWithdrawBuilder(web3Api, currencyAddress, amount, decimal, beneficiary, chainIDDest)
    },
    generateEventABI: generateEventABI,
    generateFunctionABI: generateFunctionABI,
    getMethodSignatureRaw: getMethodSignatureRaw,
    analyzeABIInput: function(e) {
        return analyzeABIInput(e)
    },
    processEthersDecodedRaw: function(inputs, decoded_raw) {
        return processEthersDecodedRaw(inputs, decoded_raw)
    },
    addABINames: function(inp, prefix = "", idx = 0) {
        addABINames(inp, prefix, idx)
    },
    initEtherJsDecoder: function(abi) {
        var etherjsDecoder = new ethers.utils.Interface(abi)
        return etherjsDecoder
    },
    categorizeTokenTransfers: categorizeTokenTransfers,
    categorizeTokenSwaps: categorizeTokenSwaps,
};