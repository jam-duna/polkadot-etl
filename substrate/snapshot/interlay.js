const paraTool = require("../paraTool");
const SnapShotter = require("./snapshotter");

//interlay [2032]
module.exports = class InterlaySnapShotter extends SnapShotter {
    constructor() {
        super()
        this.chainName = 'Interlay'
        this.chainDecimals = 10
        this.wsEndpoint = "wss://interlay-rpc.dwellir.com"
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
        let chainDecimals = this.chainDecimals

        let targetPallet = 'tokens.totalIssuance' // api.section.storage -> section|storage
        let targetPalletRes = await this.paginated_fetch(apiAt, targetPallet)
        for (const res of targetPalletRes) {
            console.log(`k=${JSON.stringify(res[0].toHuman())}, val`, `${res[1].toString()}`)
            var kVal = JSON.parse(JSON.stringify(res[0].toHuman()))
            var vVal = paraTool.dechexToInt(JSON.parse(JSON.stringify(res[1])))
            let totalIssuanceRec = this.setRecSnapShotInfo("tokens.totalIssuance")
            totalIssuanceRec.track = "asset"
            totalIssuanceRec.track_val = JSON.stringify(kVal)
            totalIssuanceRec.kv = kVal
            totalIssuanceRec.pv = vVal
            console.log(totalIssuanceRec)
            this.write_snapshot_rec(totalIssuanceRec)
        }
    }
}