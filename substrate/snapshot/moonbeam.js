const paraTool = require("../paraTool");
const SnapShotter = require("./snapshotter");

//moonbeam [2004]
module.exports = class MoonbeamSnapShotter extends SnapShotter {
    constructor() {
        super()
        this.chainName = 'Moonbeam'
        this.chainDecimals = 18
        this.wsEndpoint = "wss://moonbeam-rpc.dwellir.com"
    }
}