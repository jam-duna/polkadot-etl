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

const paraTool = require('./paraTool');
const jsonld = require('./jsonld');
const {
    u8aToHex,
} = require("@polkadot/util");
var util_crypto_1 = require("@polkadot/util-crypto");

const assetChainSeparator = "~" // TODO: redundant, get from paraTool instead
const {
    renderIcon
} = require('@download/blockies');

function currency_format(c, priceUSD = false, priceUSDCurrent = false, isDefaultOriginal = true, withParentheses = false) {
    if (isNaN(c)) {
        return `NA`
    }
    let _m = 2;
    if (c > 100000) _m = 0;
    if (c < .1) _m = 3;
    if (c < .01) _m = 4;
    var formatter = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: _m
    });
    //console.log(`currency_format2 c=${c}, priceUSD=${priceUSD}, priceUSDCurrent=${priceUSDCurrent},isDefaultOriginal=${isDefaultOriginal}, withParentheses=${withParentheses}`) // why this doesnt work???
    let leftParentheses = (withParentheses == true) ? '(' : ''
    let rightParentheses = (withParentheses == true) ? ')' : ''
    if (priceUSD && priceUSDCurrent && priceUSD > 0 && priceUSDCurrent > 0) {
        let originalUSD = formatter.format(c);
        let currentUSD = formatter.format(c * (priceUSDCurrent / priceUSD));
        if (isDefaultOriginal) {
            //present original USD as default value
            let msgTitle = "Displaying value at the time of Txn; Click to show current value"
            return `<button type="button" class="btn btn-link" style="font-size:0.9rem;font-style:normal; padding:unset" currency="usd" original="0"  originalUSD="${leftParentheses}${originalUSD}${rightParentheses}" currentUSD="${leftParentheses}${currentUSD}${rightParentheses}" data-mdb-placement="right" title="${msgTitle}" >${leftParentheses}${originalUSD}${rightParentheses}</button>`
        } else {
            //present current USD as default value
            let msgTitle = "Displaying current value; Click to show value are the time of Txn"
            return `<button type="button" class="btn btn-link" style="font-size:0.9rem;font-style:normal; padding:unset" currency="usd" original="1"  originalUSD="${leftParentheses}${originalUSD}${rightParentheses}" currentUSD="${leftParentheses}${currentUSD}${rightParentheses}" data-mdb-placement="right" title="${msgTitle}" >${leftParentheses}${currentUSD}${rightParentheses}</button>`
        }
    }
    return formatter.format(c);
}

function round(value, decimals = 2) {
    return Number(Math.round(value + 'e' + decimals) + 'e-' + decimals);
}

function presentPercentage(val, decimals = 2) {
    let value = val * 100
    let n = Number(Math.round(value + 'e' + decimals) + 'e-' + decimals);
    return `${n}%`
}

function presentGasPrice(valGwei, chainSymbol = 'ChainToken') {
    let v = (valGwei / 10 ** 9).toFixed(20).replace(/0+$/, '')
    if (chainSymbol == undefined) chainSymbol = ''
    return `${v} ${chainSymbol} (${valGwei} Gwei)`
}

function timeSince(seconds, secondePrecision = true) {
    var interval = seconds / 86400;
    var remainder = seconds % 86400;
    if (interval >= 1) {
        let days = Math.floor(interval)
        let pl = (days > 1) ? "s " : " "
        if (!secondePrecision || remainder < 3600) {
            return `${days} day${pl}`.trim()
        } else {
            return `${days} day${pl}${timeSince(remainder, false)}`
        }
    }
    interval = seconds / 3600;
    remainder = seconds % 3600;
    if (interval > 1) {
        let hours = Math.floor(interval);
        let pl = (hours > 1) ? "s " : " "
        if (!secondePrecision || remainder < 60) {
            return `${hours} hr${pl}`.trim()
        } else {
            return `${hours} hr${pl}${timeSince(remainder, false)}`
        }
    }
    interval = seconds / 60;
    remainder = seconds % 60;
    if (interval > 1) {
        let minutes = Math.floor(interval);
        let pl = (minutes > 1) ? "s " : " ";
        if (!secondePrecision || remainder < 1) {
            return `${minutes} min${pl}`.trim()
        } else {
            return `${minutes} min${pl}${timeSince(remainder, false)}`
        }
    }
    return Math.floor(seconds) + " secs";
}


function present_parachain(parachain) {
    switch (parachain) {
        case 2000:
            return "Kusama"
            break;
        case 2001:
            return "Karura"
            break;
        default:
            return "Parachain " + parachain;
            break;
    }
}

function hex2a(str) {
    const buf = new Buffer.from(str, 'hex');
    return buf.toString('utf8');
}

function get_short_hash(hash) {
    if (hash) {
        if (hash.length >= 30) {
            return `<code>${hash.substr(0,8)}...${hash.substr(-6)}</code>`;
        } else {
            return `<code>${hash}</code>`;
        }
    }
    return "-";
}

function get_full_hash(hash) {
    if (hash) {
        return `<code>${hash}</code>`
    }
    return "-";
}

function copyToClipboard(inp) {
    const clipboardIcon = '<i class="fa-regular fa-copy"></i>';
    return "<a href='javascript:copyToClipboard(\"" + inp + "\")'>" + clipboardIcon + "</a>";
}

function tx_link_with_desc(link, desc, allowCopy = true) {
    let out = `<a href='/tx/${link}'>` + get_short_hash(desc) + `</a>`;
    if (allowCopy) out += copyToClipboard(desc);
    return out;
}

function tx_link(id, allowCopy = true) {
    let out = `<a href='/tx/${id}'>` + get_short_hash(id) + `</a>`;
    if (allowCopy) out += copyToClipboard(id);
    return out;
}

function tx_link_full(id, allowCopy = true) {
    let out = `<a href='/tx/${id}'>` + id + `</a>`;
    if (allowCopy) out += copyToClipboard(id);
    return out;
}

function account_link(id, allowCopy = true, shortHash = true) {
    let accountID = paraTool.getPubKey(id);
    let h = shortHash ? get_short_hash(id) : id;
    let out = `<a href='/account/${accountID}'>` + h + `</a>`;
    if (accountID.length == 42) {
        out = `<a href='/address/${accountID}'>` + h + `</a>`;
    }
    if (allowCopy) out += copyToClipboard(id);
    return out;
}

function address_link(id, allowCopy = true, shortHash = true) {
    let h = shortHash ? get_short_hash(id) : id;
    let out = `<a href='/address/${id}'>` + h + `</a>`;
    if (allowCopy) out += copyToClipboard(id);
    return out;
}

function account_link_full(id, allowCopy = true) {
    let accountID = paraTool.getPubKey(id);
    let view = (accountID.length == 42) ? 'address' : 'account';
    let out = `<a href='/${view}/${accountID}'>` + id + `</a>`;
    if (allowCopy) out += copyToClipboard(id);
    return out;
}

function address_link_full(id, allowCopy = true) {
    let out = `<a href='/address/${id}'>` + id + `</a>`;
    if (allowCopy) out += copyToClipboard(id);
    return out;
}

function present_id_row(row, fld) {
    if (row[fld] == undefined) return "";

    let id = row[fld];
    let res = '<a href="/account/' + id + '">' + id + '</a>';
    let hit = null;
    if (row[fld + "Address"] != undefined) {
        hit = fld + "Address";
    } else if (row[fld] != undefined) {
        hit = fld;
    }
    if (hit != null) {
        if (row[hit + "_nickname"] != undefined) {
            res += "<BR>" + row[hit + "_nickname"]
        } else if (row[hit + "_info"] != undefined) {
            try {
                let info = row[hit + "_info"];
                if (info.display != undefined) {
                    res += "<BR>" + info.display;
                }
            } catch (err) {
                console.log("present_id_row err", err, row)
            }
        }
    }
    return res;
}

function present_topic(id, allowCopy = true) {
    let out = get_short_hash(id);
    if (allowCopy) out += copyToClipboard(id);
    return out;
}

function present_raw_data(id, allowCopy = true) {
    let out = get_short_hash(id);
    if (allowCopy) out += copyToClipboard(id);
    return out;
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

function present_dests(ids) {
    let res = []
    if (!ids) return res;
    for (const d of ids) {
        if (d.id) {
            res.push(d.id)
        }
    }
    return res
}

function parse_token_asset(rAsset) {
    let asset = {}
    for (const k of Object.keys(rAsset)) {
        asset[capitalizeFirstLetter(k)] = rAsset[k]
    }
    if (asset.Token) {
        return asset.Token;
    } else if (asset.ForeignAsset) {
        switch (asset.ForeignAsset) {
            case "0":
                return "RMRK";
            default:
                return "ForeignAsset:" + asset.ForeignAsset;
        }
    } else if (asset.LiquidCrowdloan) {
        switch (asset.LiquidCrowdloan) {
            case 13:
            case "13":
                return "lcDOT";
                break;
            default:
                return "ACALA(" + asset.LiquidCrowdloan + ")";
        }
    } else if (Array.isArray(rAsset)) {
        let tok0 = parse_token_asset(rAsset[0]);
        let tok1 = parse_token_asset(rAsset[1]);
        return tok0 + "/" + tok1;
    }
    return JSON.stringify(rAsset);
}

function camel2title(camelCase) {
    // no side-effects
    return camelCase
        // inject space before the upper case letters
        .replace(/([A-Z])/g, function(match) {
            return " " + match;
        })
        // replace first char with upper case
        .replace(/^./, function(match) {
            return match.toUpperCase();
        });
}

function capitalizeFirstLetter(string) {
    if (string == undefined || string == false) return ''
    return string.charAt(0).toUpperCase() + string.slice(1);
}

function presentTempChainIdentifer(chainID) {
    if (chainID == undefined) return ""
    return paraTool.getTempID(chainID)
}


function show_account_info(c, fld) {
    try {
        if (c[fld] == undefined) return ("");
        if (c[fld + "_nickname"] != undefined) {
            return (c[fld + "_nickname"]);
        }
        if (c[fld + "_subIdentityName"] != undefined) {
            return (c[fld + "_subIdentityName"]);
        }
        if (c[fld + "_info"] != undefined) {
            let info = c[fld + "_info"];
            return (info.display);
        }
    } catch (err) {
        console.log(err);
    }
}

module.exports = {
    currencyFormat: function(c, _maximumFractionDigits = 2) {
        try {
            if (c < .01) _maximumFractionDigits = 3;
            if (c < .001) _maximumFractionDigits = 43;
            var formatter = new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'USD',
                maximumFractionDigits: _maximumFractionDigits
            });
            return formatter.format(c);
        } catch (e) {
            return '-'
        }

    },
    presentPercentChange: function(p) {
        return p + "%"; // TODO: improve this
    },
    presentPercentage: function(n, decimals = 2) {
        return presentPercentage(n, decimals)
    },
    presentCurrency: function(c) {
        if (c.token) {
            return c.token
        }
        return (JSON.stringify(c));
    },
    presentRemark: function(c) {
        return (hex2a(c.substr(2)));
    },
    presentAmount: function(a, decimal = 12) {
        let val = paraTool.dechexToInt(a)
        let amt = val / 10 ** decimal;
        return (amt.toString());
    },
    presentNumber: function(a) {
        if (a == undefined || (!a)) return ("-");
        if (a >= 1000000000000) {
            let amt = a / 1000000000000;
            return (new Intl.NumberFormat('en-IN', {
                maximumSignificantDigits: 3
            }).format(amt) + "T");
        }
        if (a >= 1000000000) {
            let amt = a / 1000000000;
            return (new Intl.NumberFormat('en-IN', {
                maximumSignificantDigits: 3
            }).format(amt) + "B");
        }
        if (a >= 1000000) {
            let amt = a / 1000000;
            return (new Intl.NumberFormat('en-IN', {
                maximumSignificantDigits: 3
            }).format(amt) + "M");
        }
        if (a >= 1000) {
            let amt = a / 1000;
            return (new Intl.NumberFormat('en-IN', {
                maximumSignificantDigits: 3
            }).format(amt) + "K");
        }
        return (a.toString());
    },
    presentFloat: function(a, decplaces = 5) {
        return a.toLocaleString("en-US", {
            minimumFractionDigits: decplaces
        });
    },
    presentPath: function(p) {
        if (Array.isArray(p)) {
            let tokens = p.map((piece) => {
                if (piece.token) {
                    return piece.token;
                } else {
                    return "unk";
                }
            });
            return tokens.join(" -> ");
        }
        return (JSON.stringify(p));
    },
    presentInfo: function(p) {
        let attrs = ["display", "legal", "web", "riot", "email", "image", "twitter"];
        for (var i = 0; i < attrs.length; i++) {
            if (p[attrs[i]]) {
                return hex2a(p[attrs[i]].raw.substr(2));
            }
        }
    },
    presentTx: function(id) {
        return tx_link(id)
    },
    presentFullTx: function(id) {
        return tx_link_full(id)
    },
    presentExtrinsicID: function(extrinsicHash, extrinsicID) {
        return tx_link_with_desc(extrinsicHash, extrinsicID)
    },
    presentID: function(id, shortHash = false) {
        if (shortHash) {
            return account_link(id)
        } else {
            return account_link_full(id)
        }
    },
    presentAddress: function(id, shortHash = false) {
        if (shortHash) {
            return address_link(id)
        } else {
            return address_link_full(id)
        }
    },
    presentFullID: function(id) {
        return account_link_full(id)
    },
    presentIDs: function(ids) {
        try {
            let account_links = ids.map((id) => {
                return account_link_full(id);
            });
            return `[${account_links.join(" , ")}]`;
        } catch (e) {}!no

    },
    beautifyCamelCase: function(str) {
        return capitalizeFirstLetter(camel2title(str).trim())
    },
    presentDest: function(d) {
        if (!d) return JSON.stringify("");
        try {
            if (d.id) {
                return d.id
            } else if (d.v0) { // {"v0":{"x1":{"parachain":"2000"}}}
                if (d.v0.x1 && d.v0.x1.parachain) {
                    return present_parachain(d.v0.x1.parachain);
                }
            } else if (d.v1) { //  {"v1":{"parents":0,"interior":{"x1":{"parachain":2001}}}}
                if (d.v1.interior && d.v1.interior.x1 && d.v1.interior.x1.parachain) {
                    return present_parachain(d.v1.interior.x1.parachain);
                }
            }
        } catch (e) {
            console.log(e);
        }
        return (JSON.stringify(d));
    },
    presentDests: function(ids) {
        return present_dests(ids)
    },
    presentSearchResult: function(r) {
        return `<p><a href='${r.link}'>` + r.text + "</a><br>" + r.description + "</p>";
    },
    presentAssetPair: function(assetChain, symbol, asset0, asset1, symbol0, symbol1, chainID) {
        return `<a href="/asset/${chainID}/` + encodeURIComponent(asset0) + '">' + symbol0 + `</a> / <a href="/asset/${chainID}/` + encodeURIComponent(asset1) + '">' + symbol1 + '</a>';
        //let assetPair = symbol + ":" + asset0.substring(0, 6) + "/" + asset1.substring(0, 6);
        // (<a href="/asset/' + encodeURIComponent(assetChain) + '">' + assetPair + '</a>)';
    },
    presentAssetPairChart: function(assetChain) {
        return '<a href="/chart/' + encodeURIComponent(assetChain) + '">Chart</a>';
    },
    presentAssets: function(a) {
        if (a.v1) { // {"v1":[{"id":{"concrete":{"parents":0,"interior":{"here":null}}},"fun":{"fungible":7694181620528}}]}
            if (a.v1.length > 0) {
                if (a.v1[0].id && a.v1[0].fun && a.v1[0].fun.fungibleamount) {
                    let amt = a.v1[0].id.fun.fungibleamount;
                    return amt;
                }
            }

        } else if (a.v0) { // {"v0":[{"concreteFungible":{"id":{"null":null},"amount":25567000000000}}]}
            if (a.v0.length > 0) {
                let amt = a.v0[0].concreteFungible.amount;
                return amt;
            }
        }
        return (JSON.stringify(a));
    },
    presentRelayBlock: function(chainID, relayBN) {
        let relayChain = paraTool.getRelayChainByChainID(chainID)
        if (relayChain != "unknown") {
            return `<a href='/block/${relayChain}/${relayBN}'>${capitalizeFirstLetter(relayChain)}-${relayBN}</a>`
        } else {
            return ''
        }
    },
    presentBlock: function(chainID, bn) {
        return `<a href='/block/${chainID}/${bn}'>${bn}</a>`
    },
    presentTrace: function(chainID, bn, blockHash) {
        return `<a href='/trace/${chainID}/${bn}/${blockHash}'>Trace ${bn}</a>`
    },
    presentXCMScanTrace: function(traceID) {
        if (traceID) {
            return `<a class='btn btn-sm' href='https://xcmscan.polkaholic.io/trace/${traceID}?uiEmbed=v0'>XCM Timeline</a>`
        }
        return ""
    },
    presentSecondsAgoTS: function(ts) {
        let now = Math.floor(new Date().getTime() / 1000);
        let secondsago = now - ts;
        if (secondsago < 0) secondsago = 0;
        return timeSince(secondsago) + " ago";
    },
    getRecentDateRange: function(daysago = 7) {
        let now = Math.floor(new Date().getTime() / 1000);
        let [startDate, _] = ts_to_logDT_hr(now - daysago * 86400);
        let [endDate, __] = ts_to_logDT_hr(now);
        return [startDate, endDate];
    },
    presentTS: function(ts) {
        let res = new Date(ts * 1000).toISOString().replace(/T/, ' ').replace(/\..+/, '');
        res += " +UTC";
        return res;
    },
    presentChain: function(chainID, chainName) {
        return `<a href='/blocks/${chainID}'>` + chainName + `</a>`;
    },
    presentSpecVersion: function(chainID, specVersion) {
        return `<a href='/specversion/${chainID}/${specVersion}'>` + specVersion + `</a>`;
    },
    presentTopic: function(t) {
        return present_topic(t);
    },
    presentRawData: function(t) {
        return present_raw_data(t);
    },
    presentMS: function presentMS(ms) {
        return new Date(parseInt(ms, 10)).toISOString();
    },
    presentTokenAsset: function(asset) {
        return parse_token_asset(asset);
    },
    presentCopyToClipboardId: function(inp) {
        const clipboardIcon = '<i class="fa-regular fa-copy"></i>';
        return "<a href='javascript:copyToClipboardId(\"" + inp + "\")'>" + clipboardIcon + "</a>";
    },
    presentTokenAttribute: function(t, attr) {
        let str = "";
        if (t[attr] > 0) {
            str = attr + ": " + (Math.round(t[attr] * 100000) / 100000);
            let v = t[attr + "USD"];
            if (v && v > 0) {
                str = str + " (" + currency_format(v) + ")";
            }
        }
        return str;
    },
    validPassword: function(p) {
        try {
            return (p.length > 6);
        } catch (e) {
            return (false);
        }
        return (false);
    },
    validEmail: function(emailToValidate) {
        //const emailRegexp = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
        //return (emailRegexp.test(emailToValidate));
        return (true);
    },
    camelize: function(inp) {
        let sa = inp.replaceAll("_", " ").split(" ");
        let r = sa.map((w, i) => {
            if (i == 0) {
                return w.toLowerCase();
            } else {
                return w.substr(0, 1).toUpperCase() + w.substr(1);
            }
        })
        let o = r.join("");
        return (o);
    },
    capitalizeFirstLetter: function(inp) {
        return capitalizeFirstLetter(inp)
    },
    currencyFormat: function(c, priceUSD = false, priceUSDCurrent = false, isDefaultOriginal = true, withParentheses = false) {
        return currency_format(c, priceUSD, priceUSDCurrent, isDefaultOriginal, withParentheses);
    },
    presentTempChainIdentifer: function(chainID) {
        return presentTempChainIdentifer(chainID)
    },
    getShortHash: function(hash, shortHash = true, allowCopy = true) {
        let out = shortHash ? get_short_hash(hash) : hash;
        if (allowCopy && hash != null && (typeof hash == "string") && (hash.length > 0)) {
            out += copyToClipboard(hash);
        }
        return out;
    },
    getVerificationPath: function(symbols, path) {
        let p = JSON.stringify(path).replaceAll('"', '');
        return JSON.stringify(symbols) + copyToClipboard(p);
    },
    getEVMMethod: function(sig) {
        let out = sig.split("(");
        return capitalizeFirstLetter(out[0]);
    },
    getFullHash: function(hash, allowCopy = true) {
        let out = get_full_hash(hash);
        if (allowCopy) {
            out += copyToClipboard(hash);
        }
        return out;
    },
    blake2: function(inp) {
        var blake2 = function(value) {
            return util_crypto_1.blake2AsU8a(value, 512);
        };
        return u8aToHex(blake2(inp))
    },
    isJSONString: function(x) {
        if (typeof x != "string") return (false);
        let l = x.length;
        if (x.length < 2) return (false);
        if (x.charAt(0) == "{" && x.charAt(l - 1) == "}") return (true);
        if (x.charAt(0) == "[" && x.charAt(l - 1) == "]") return (true);
        return (false);
    },
    showAccountInfo: function(c, fld) {
        return show_account_info(c, fld);
    },
    presentIDRow: function(row, fld) {
        return present_id_row(row, fld)
    },
    getTimelineRows: function(timeline) {
        return timeline.map((t) => {
            return [t.id, t.blockNumber.toString(), t.blockTS, t.blockTS + 6, t.objects, t.extra]
        });
    },
    presentERCToken: function(id, assetInfo, allowCopy = true) {
        let asset = (assetInfo != undefined && assetInfo.asset != undefined) ? assetInfo.asset : false
        let symbol = (assetInfo != undefined && assetInfo.symbol != undefined) ? assetInfo.symbol : false
        let localSymbol = (assetInfo != undefined && assetInfo.localSymbol != undefined) ? assetInfo.localSymbol : symbol
        let assetName = (assetInfo != undefined && assetInfo.assetName != undefined) ? assetInfo.assetName : false
        let assetRep = localSymbol
        if (assetName) {
            assetRep = `${assetName} (${localSymbol})`
        }
        let chainID = (assetInfo != undefined && assetInfo.chainID != undefined) ? assetInfo.chainID : false
        if (!chainID || !symbol || !asset) {
            return '-'
        }
        let out = `<a href="/token/` + encodeURIComponent(asset) + '">' + assetRep + '</a>';
        if (allowCopy) out += copyToClipboard(id);
        return out;
    },
    presentERCID: function(id, allowCopy = true) {
        let out = `<a href="/address/` + encodeURIComponent(id) + '">' + id + '</a>';
        if (allowCopy) out += copyToClipboard(id);
        return out;
    },
    presentStack: function(s) {
        let out = s.map((x, idx) => {
            return (idx > 0) ? "1" : "0"
        })
        return "call " + out.join("_");
    },
    getPublicWSEndpoints: function(chain) {
        let endpoints = [];
        if (chain.WSEndpoint && chain.WSEndpoint.length > 0 && paraTool.isPublicEndpoint(chain.WSEndpoint)) {
            endpoints.push(chain.WSEndpoint);
        }
        if (chain.WSEndpoint2 && chain.WSEndpoint2.length > 0 && paraTool.isPublicEndpoint(chain.WSEndpoint2)) {
            endpoints.push(chain.WSEndpoint2);
        }
        if (chain.WSEndpoint3 && chain.WSEndpoint3.length > 0 && paraTool.isPublicEndpoint(chain.WSEndpoint3)) {
            endpoints.push(chain.WSEndpoint3);
        }
        return endpoints;
    },
    verifierEnabled: function() {
        return true;
    },
    getEvmTxnType: function(txType) {
        if (txType == 0) {
            return '0 (Legacy)'
        } else if (txType == 2) {
            return '2 (EIP-1559)'
        }
    },
    presentGasPrice: function(valGwei, chainSymbol = 'ChainToken') {
        return presentGasPrice(valGwei, chainSymbol)
    },

    presentBlockiesOrIdenticon: function(address, sz = 128) {
        if (address.length == '42') {
            /*let cl = `width="${sz}px"  loading="lazy"`
            const canvas = createCanvas(sz, sz);
            var icon = renderIcon({
                    seed: address.toLowerCase(), // seed used to generate icon data, default: random
                    //color: '#dfe', // to manually specify the icon color, default: random
                    //bgcolor: '#aaa', // choose a different background color, default: white
                    size: 8, // width/height of the icon in blocks, default: 10
                    scale: 4 // width/height of each block in pixels, default: 5
                },
                canvas
            );
            return ('<img class="circularImage" src="' + canvas.toDataURL() + `" ${cl} />`) */
        } else {
            return (`<img class="circularImage" src="/identicon/${address}" width="${sz}px"  loading="lazy"/>`)
        }
    },

    presentBlockies: function(address, sz = 128) {
        /*const canvas = createCanvas(sz, sz);
        let cl = `width="${sz}"  loading="lazy"`
        var icon = renderIcon({
                seed: address.toLowerCase(), // seed used to generate icon data, default: random
                //color: '#dfe', // to manually specify the icon color, default: random
                //bgcolor: '#aaa', // choose a different background color, default: white
                size: 8, // width/height of the icon in blocks, default: 10
                scale: 4 // width/height of each block in pixels, default: 5
            },
            canvas
        );
        return ('<img class="circularImage" src="' + canvas.toDataURL() + `" ${cl} />`) */
    },
    txToJSONLD: function(tx) {
        try {
            return jsonld.txToJSONLD(tx);
        } catch {
            return null;
        }
    },
    accountToJSONLD: function(account, nm = null) {
        try {
            return jsonld.accountToJSONLD(address, nm);
        } catch {
            return null;
        }
    }
};