const paraTool = require("../paraTool");
const SnapShotter = require("./snapshotter");
const {
    BN
} = require("@polkadot/util");

//bifrost[2030]
module.exports = class BifrostSnapShotter extends SnapShotter {
    constructor() {
        super()
        this.chainName = 'Bifrost'
        this.chainDecimals = 12
        this.wsEndpoint = "wss://hk.p.bifrost-rpc.liebi.com/ws"
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

    //tokenConversion.exchangeRate
    //tokens.totalIssuance
    //tokens.locks
    //tokens.reserves
    //farming?
    //farming.poolInfos
    //salp - ignore
    async handleSnapshot(apiAt) {
        // get currency metadata from assetRegistry
        const currencyMetadata = await this.paginated_fetch(apiAt, 'assetRegistry.currencyMetadatas')
        // create a Map of assets
        const assets = new Map();
        for (const [k, v] of currencyMetadata) {
            const assetDetails = v.toHuman();
            assets.set(k.args[0].toString(), assetDetails);
        }

        // get totalIssuance for native currency
        let targetPallet = 'balances.totalIssuance' // api.section.storage -> section|storage
        let targetPalletRes = await this.state_fetch_val(apiAt, targetPallet)
        const kVal = 'BNC'
        var vVal = paraTool.dechexToIntStr(targetPalletRes.toJSON())
        let totalIssuanceRec = this.setRecSnapShotInfo("balances.totalIssuance")
        totalIssuanceRec.track = "asset"
        totalIssuanceRec.track_val = kVal
        totalIssuanceRec.kv = kVal
        totalIssuanceRec.pv = {
            raw: vVal
        }
        const ten = new BN(10);
        const x = ten.pow(new BN(12 - 4)); // keep 4 digits for fraction
        const tokensIssued = new BN(vVal)

        totalIssuanceRec.pv.humanAmount = tokensIssued.div(x).toNumber() / 10000 // including 4 digits fraction
        totalIssuanceRec.pv.name = 'Bifrost Native Token'
        totalIssuanceRec.pv.symbol = 'BNC'
        this.write_snapshot_rec(totalIssuanceRec)

        // Now TOKENS not native currency
        targetPallet = 'tokens.totalIssuance' // api.section.storage -> section|storage
        targetPalletRes = await this.paginated_fetch(apiAt, targetPallet)
        for (const [k, v] of targetPalletRes) {
            //const decodedKey = k.args.map((k) => k.toJSON());
            const kVal = k.args[0].toJSON();
            const assetDetailsLookedUp = assets.get(k.args[0].toString());
            var vVal = paraTool.dechexToInt(v.toString())
            let totalIssuanceRec = this.setRecSnapShotInfo("tokens.totalIssuance")
            totalIssuanceRec.track = "asset"
            totalIssuanceRec.track_val = JSON.stringify(kVal)
            totalIssuanceRec.kv = kVal
            totalIssuanceRec.pv = {
                raw: vVal
            }
            if (assetDetailsLookedUp) {
                // Calculate 10**decimals using BN's pow method
                const ten = new BN(10);
                const x = ten.pow(new BN(assetDetailsLookedUp.decimals - 4)); // keep 4 digits for fraction
                const tokensIssued = new BN(v.toString())

                // Perform the division
                const humanAmount = tokensIssued.div(x).toNumber() / 10000 // including 4 digits fraction
                totalIssuanceRec.pv.humanAmount = humanAmount
                totalIssuanceRec.pv.name = assetDetailsLookedUp.name
                totalIssuanceRec.pv.symbol = assetDetailsLookedUp.symbol
                totalIssuanceRec.track_val = assetDetailsLookedUp.symbol // if it's a known asset, use symbol
                console.log(`Full details of ${assetDetailsLookedUp.symbol} : ${humanAmount} : ${JSON.stringify(assetDetailsLookedUp)}`)
            } else {
                const lookUpKey2 = k.args[0].toHuman();
                console.log(`Only details of ${totalIssuanceRec.track_val} : ${v.toString()}`)
            }
            this.write_snapshot_rec(totalIssuanceRec)

            // console.log(`k=${JSON.stringify(res[0].toHuman())}, val`, `${res[1].toString()}`)
        }
        // obtain vtokenMinting.tokenPool data
        targetPallet = 'vtokenMinting.tokenPool' // api.section.storage -> section|storage
        targetPalletRes = await this.paginated_fetch(apiAt, targetPallet)
        for (const [k, v] of targetPalletRes) {
            const kVal = k.args[0].toJSON();
            const assetDetailsLookedUp = assets.get(k.args[0].toString());
            // continue if assetDetailsLookedUp is not found
            if (!assetDetailsLookedUp) {
                console.log(`No assetDetailsLookedUp for ${kVal}`)
                continue
            }
            const vVal = paraTool.dechexToIntStr(v.toJSON())
            let tokenPoolRec = this.setRecSnapShotInfo(targetPallet)
            tokenPoolRec.track = "vtoken"
            tokenPoolRec.track_val = assetDetailsLookedUp.symbol
            tokenPoolRec.kv = kVal
            tokenPoolRec.pv = {
                raw: vVal,
                symbol: assetDetailsLookedUp.symbol,
                name: assetDetailsLookedUp.name,
                humanAmount: paraTool.dechexToInt(v.toJSON()) / 10 ** assetDetailsLookedUp.decimals
            }
            this.write_snapshot_rec(tokenPoolRec)
        }
    }
}