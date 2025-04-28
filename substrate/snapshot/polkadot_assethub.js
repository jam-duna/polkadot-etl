const paraTool = require("../paraTool");
const SnapShotter = require("./snapshotter");
const {
    BN
} = require('@polkadot/util');

//polkadot assethub [1000]
module.exports = class PolkadotAssetHubSnapShotter extends SnapShotter {
    constructor() {
        super()
        this.chainName = 'Polkadot_AssetHub'
        this.chainDecimals = 10
        this.wsEndpoint = "wss://statemint-rpc-tn.dwellir.com"
    }

    async processSnapshot(apiAt) {
        try {
            // step 0: set snapshot soure - in this case, we will publish as polkaholic
            this.setSnapshotSource("polkaholic")
            // step 1: enable snopshot writing to local file
            this.enable_snapshot_writing()
            console.log(`!!${this.chainName} process processSnapshot called!!!`)
            // *** step 2: the snapshot logic
            await this.handleSnapshot(apiAt)
            // *** step 3: close the file when done
            this.close_snapshot_writing()
            return true
        } catch (e) {
            console.log(`processSnapshot err`, e)
            return false
        }
    }

    async handleSnapshot(apiAt) {
        let other = {};
        const perPagelimit = 1000;
        let currencyList = {
            "1984": "USDT",
            "1337": "USDC"
        }
        let decimals = 6; // could get this from assets.metadata.
        let totalIssuance = 0
        let totalIssuanceMap = {}
        for (const [currencyID, symbol] of Object.entries(currencyList)) {
            let query = await apiAt.query.assets.asset(currencyID);
            let val = query.toHuman();
            if (val) {
                let rec = this.setRecSnapShotInfo("asset.asset");
                ['supply', 'deposit', 'minBalance', 'accounts', 'sufficients', 'approvals'].forEach((attr) => {
                    val[attr] = paraTool.toNumWithoutComma(val[attr])
                })
                //console.log(val)
                totalIssuance = val['supply'] / 10 ** decimals;
                rec.track = "stablecoin";
                rec.track_val = symbol;
                rec.kv = {
                    currencyID,
                    symbol
                }
                totalIssuanceMap[currencyID] = val
                rec.pv = val;

                this.write_snapshot_rec(rec);


                let last_key = '';
                let done = false;
                let holderCnt = paraTool.dechexToInt(totalIssuanceMap[currencyID].accounts)
                let targetMaxHolder = 5000
                let isSmallAsset = (holderCnt <= targetMaxHolder)
                console.log(`holderCnt=${holderCnt}, targetMaxHolder=${targetMaxHolder}, isSmallAsset=${isSmallAsset}`)

                let query = await this.paginated_fetch(apiAt, 'assets.account', [currencyID])

                // "0xc30aa287059cd2bdd121662e18c200b4698ff6fa452b79f70ac63a40a3a690ee": "circle",
                // "0x14d250c8742fb2b6cb832873e07f07593a487afadf9edb2e2e028c28233fa347": "tether"
                for (const user of query) {
                    let key = user[0].toHuman();
                    let val = user[1].toHuman();
                    let account_id = key[1];
                    let address = paraTool.getPubKey(account_id);
                    if (val.balance != undefined) {
                        let balance_raw = paraTool.toNumWithoutComma(val.balance); // no need to call dexhexIntToString here!
                        let balance = balance_raw / 10 ** decimals;
                        let asciiName = paraTool.pubKeyHex2ASCII(address);
                        if (asciiName || isSmallAsset || (balance / totalIssuance > .0025)) {
                            let rec = this.setRecSnapShotInfo("asset.account");
                            rec.track = "stablecoin";
                            rec.track_val = symbol;
                            rec.address_ss58 = account_id;
                            rec.address_pubkey = address;
                            rec.kv = {
                                name: asciiName,
                                currencyID,
                                symbol
                            }
                            rec.pv = {
                                balance,
                                balance_raw
                            }
                            //console.log(rec)
                            this.write_snapshot_rec(rec);
                        } else {
                            if (other[currencyID] == undefined) {
                                let rec = this.setRecSnapShotInfo("asset.account");
                                // rec.address_ss58/address_pubkey skipped
                                rec.track = "stablecoin";
                                rec.track_val = symbol;
                                rec.kv = {
                                        name: "holders",
                                        currencyID,
                                        symbol
                                    },
                                    rec.pv = {
                                        balance,
                                        balance_raw,
                                        holders: 1
                                    }
                                other[currencyID] = rec;
                            } else {
                                other[currencyID].pv.balance += balance;
                                const bigNum1 = new BN(other[currencyID].pv.balance_raw);
                                const bigNum2 = new BN(balance_raw);
                                const sum = bigNum1.add(bigNum2);
                                other[currencyID].pv.balance_raw = sum.toString();
                                other[currencyID].pv.holders++;
                            }
                        }
                    }
                }
            }
        }
        for (const currencyID of Object.keys(other)) {
            let rec = other[currencyID];
            //console.log(rec);
            this.write_snapshot_rec(rec);
        }
    }
}