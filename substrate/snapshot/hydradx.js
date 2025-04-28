const paraTool = require("../paraTool");
const SnapShotter = require("./snapshotter");
const {
    readFileSync, existsSync
} = require("fs");
const {
    decodeAddress
} = require("@polkadot/util-crypto");
const {
    u8aToHex,
} = require("@polkadot/util");
//hydradx[2034]
module.exports = class HydradxSnapShotter extends SnapShotter {
    constructor() {
        super()
        this.chainName = 'HydraDx'
        this.chainDecimals = 12
        this.wsEndpoint = "wss://hydradx-rpc.dwellir.com"
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

    async readAssetsFromFile(filePath) {
        const fileContent = readFileSync(filePath, {
            encoding: 'utf-8'
        });
        const records = JSON.parse(fileContent);

        const assetsMap = new Map();

        records.forEach(record => {
            // Explicitly convert 'id' and 'decimals' to numbers
            const assetID = parseInt(record.currencyID, 10);
            const decimals = parseInt(record.decimals, 10);

            // Create a new AssetAttributes object, including type conversions
            const assetAttributes = {
                currencyID: assetID,
                name: record.name,
                symbol: record.symbol,
                decimals: decimals,
                type: record.type
            };

            assetsMap.set(assetID, assetAttributes);
        });

        return assetsMap;
    }


    async handleSnapshot(apiAt) {
        let chainDecimals = this.chainDecimals
        let filePath= '/root/go/src/github.com/colorfulnotion/xcm-global-registry-internal/assets/polkadot/polkadot_2034_assets.json'

        if (!existsSync(filePath)) {
            console.log(`Using local mode for accessing Hydration assets.`)
            filePath = '../xcm-global-registry-internal/assets/polkadot/polkadot_2034_assets.json'; // Adjust the file path as needed
        }
        const assetMap = await this.readAssetsFromFile(filePath);

        // Get all XYK pools
        for (const [key, value] of await apiAt.query.xyk.poolAssets.entries()) {
            let xykPoolRec = this.setRecSnapShotInfo("pools.xyk")
            const poolAddress = key.args[0].toString();
            const totalLiquidity = await apiAt.query.xyk.totalLiquidity(poolAddress);
            const shareToken = await apiAt.query.xyk.shareToken(poolAddress);

            // Ensure assetA and assetB are cast to integers
            const [assetA, assetB] = value.unwrap().map(asset => parseInt(asset.toString(), 10));

            // Function to query balance for a given asset
            async function getAssetBalance(assetId, poolAddress) {
                if (assetId === 0) { // HDX or native token
                    const {
                        data: {
                            free
                        }
                    } = await apiAt.query.system.account(poolAddress);
                    return free.toString();
                } else { // Other tokens
                    const balance = await apiAt.query.tokens.accounts(poolAddress, assetId);
                    return balance.free.toString();
                }
            }

            // Query balances for AssetA and AssetB directly
            const positions = [{
                    assetId: assetA.toString(),
                    free: await getAssetBalance(assetA, poolAddress),
                },
                {
                    assetId: assetB.toString(),
                    free: await getAssetBalance(assetB, poolAddress),
                }
            ];

            // Setting record information
            xykPoolRec.track = "xykpool"
            xykPoolRec.address_pubkey = paraTool.getPubKey(poolAddress)
            xykPoolRec.address_ss58 = poolAddress
            xykPoolRec.kv = {
                account: poolAddress,
                pubKey: paraTool.getPubKey(poolAddress),
                shareToken: shareToken.toString(),
                assetA: assetA.toString(),
                assetB: assetB.toString(),
            }
            xykPoolRec.pv = {
                totalLiquidity: totalLiquidity.toString(),
                positions
            }
            console.log(xykPoolRec)
            this.write_snapshot_rec(xykPoolRec)
        }

        // treasury 7L53bUTBopuwFt3mKUfmkzgGLayYa1Yvn1hAg9v5UMrQzTfh
        const trsy_targetPallet = 'tokens.accounts' // api.section.storage -> section|storage
        const trsy_targetPalletRes = await this.paginated_fetch(apiAt, trsy_targetPallet,
            ['7L53bUTBopuwFt3mKUfmkzgGLayYa1Yvn1hAg9v5UMrQzTfh'])
        for (const res of trsy_targetPalletRes) {
            console.log(`k=${JSON.stringify(res[0].toHuman())}, val`, `${res[1].toString()}`)
            let kVal = res[0].args.map((k) => k.toJSON());
            let balanceRec = this.setRecSnapShotInfo("tokens.accounts")
            balanceRec.track = "balance"
            balanceRec.track_val = "treasury"
            balanceRec.address_pubkey = paraTool.getPubKey(kVal[0]),
            balanceRec.address_ss58 = kVal[0]
            balanceRec.kv = {
                account: balanceRec.address_ss58,
                pubKey: balanceRec.address_pubkey,
                asset_id: kVal[1],
                ticker: assetMap.get(kVal[1])?.symbol // if not in asset file no symbol
            }
            balanceRec.pv = res[1].toJSON()
            console.log(balanceRec)
            this.write_snapshot_rec(balanceRec)
        }

        // token balances at Omnipool account
        const omni_targetPallet = 'tokens.accounts' // api.section.storage -> section|storage
        const omni_targetPalletRes = await this.paginated_fetch(apiAt, omni_targetPallet,
            ['7L53bUTBbfuj14UpdCNPwmgzzHSsrsTWBHX5pys32mVWM3C1'])
        for (const res of omni_targetPalletRes) {
            console.log(`k=${JSON.stringify(res[0].toHuman())}, val`, `${res[1].toString()}`)
            let kVal = res[0].args.map((k) => k.toJSON());
            let balanceRec = this.setRecSnapShotInfo("tokens.accounts")
            balanceRec.track = "balance"
            balanceRec.track_val = "omnipool"
            balanceRec.address_pubkey = paraTool.getPubKey(kVal[0]),
            balanceRec.address_ss58 = kVal[0]
            balanceRec.kv = {
                account: balanceRec.address_ss58,
                pubKey: balanceRec.address_pubkey,
                asset_id: kVal[1],
                ticker: assetMap.get(kVal[1])?.symbol // if not in asset file no symbol
            }
            const pv = res[1].toJSON();
            balanceRec.pv = {
                free: paraTool.dechexToIntStr(pv.free),
                reserved: paraTool.dechexToIntStr(pv.reserved),
                frozen: paraTool.dechexToIntStr(pv.frozen),
            }
            console.log(balanceRec)
            this.write_snapshot_rec(balanceRec)
        }

        // TOTAL ISSUANCE
        let targetPallet = 'tokens.totalIssuance' // api.section.storage -> section|storage
        let targetPalletRes = await this.paginated_fetch(apiAt, targetPallet)
        for (const res of targetPalletRes) {
            console.log(`k=${JSON.stringify(res[0].toHuman())}, val`, `${res[1].toString()}`)
            let kVal = res[0].args[0].toJSON()
            let totalIssuanceRec = this.setRecSnapShotInfo("tokens.totalIssuance")
            totalIssuanceRec.track = "asset"
            totalIssuanceRec.track_val = JSON.stringify(kVal)
            totalIssuanceRec.kv = kVal
            totalIssuanceRec.pv = paraTool.dechexToIntStr(res[1].toJSON())
            console.log(totalIssuanceRec)
            this.write_snapshot_rec(totalIssuanceRec)
        }
        // OmniPool Liquidity
        targetPallet = 'omnipool.assets' // api.section.storage -> section|storage
        targetPalletRes = await this.paginated_fetch(apiAt, targetPallet)
        for (const res of targetPalletRes) {
            console.log(`k=${JSON.stringify(res[0].toHuman())}, val`, `${res[1].toString()}`)
            let kVal = res[0].args[0].toJSON()
            const vVal = res[1].toJSON()
            vVal.hubReserve = paraTool.dechexToIntStr(vVal.hubReserve);
            vVal.shares = paraTool.dechexToIntStr(vVal.shares);
            vVal.protocolShares = paraTool.dechexToIntStr(vVal.protocolShares);
            vVal.cap = paraTool.dechexToIntStr(vVal.cap);
            let omnipoolLiquidity = this.setRecSnapShotInfo(targetPallet)
            omnipoolLiquidity.track = "omniasset"
            omnipoolLiquidity.track_val = parseInt(kVal)
            omnipoolLiquidity.kv = {
                id: kVal,
                ticker: assetMap.get(omnipoolLiquidity.track_val)?.symbol
            }
            omnipoolLiquidity.pv = vVal
            console.log(omnipoolLiquidity)
            this.write_snapshot_rec(omnipoolLiquidity)
        }

        targetPallet = 'omnipool.positions' // api.section.storage -> section|storage
        targetPalletRes = await this.paginated_fetch(apiAt, targetPallet)
        for (const res of targetPalletRes) {
            console.log(`k=${JSON.stringify(res[0].toHuman())}, val`, `${res[1].toString()}`)
            let kVal = res[0].args[0].toJSON();
            const vVal = res[1].toJSON()
            vVal.amount = paraTool.dechexToIntStr(vVal.amount);
            vVal.shares = paraTool.dechexToIntStr(vVal.shares);
            vVal.price_1 = paraTool.dechexToIntStr(vVal.price[0]);
            vVal.price_2 = paraTool.dechexToIntStr(vVal.price[1]);
            delete vVal.price;
            let omnipoolLiquidity = this.setRecSnapShotInfo(targetPallet)
            omnipoolLiquidity.track = "liquidity"
            omnipoolLiquidity.track_val = parseInt(vVal.assetId)
            omnipoolLiquidity.kv = {
                id: kVal,
                ticker: assetMap.get(omnipoolLiquidity.track_val)?.symbol
            }
            omnipoolLiquidity.pv = vVal
            console.log(omnipoolLiquidity)
            this.write_snapshot_rec(omnipoolLiquidity)
        }
        targetPallet = 'uniques.asset' // api.section.storage -> section|storage
        targetPalletRes = await this.paginated_fetch(apiAt, targetPallet)
        for (const res of targetPalletRes) {
            console.log(`k=${JSON.stringify(res[0].toHuman())}, val`, `${res[1].toString()}`)
            const kVal = res[0].args[0].toString()
            const vVal = res[1].toJSON()
            let decodes = decodeAddress(vVal.owner);
            vVal.address_pubkey = u8aToHex(decodes);
            vVal.deposit = paraTool.dechexToIntStr(vVal.deposit);
            let omnipoolLiquidity = this.setRecSnapShotInfo(targetPallet)
            omnipoolLiquidity.track = "nft"
            omnipoolLiquidity.track_val = parseInt(kVal)
            omnipoolLiquidity.kv = {
                id: kVal,
                nft: res[0].args[1].toString()
            }
            omnipoolLiquidity.pv = vVal
            console.log(omnipoolLiquidity)
            this.write_snapshot_rec(omnipoolLiquidity)
        }
    }
}