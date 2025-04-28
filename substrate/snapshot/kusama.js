const paraTool = require("../paraTool");
const SnapShotter = require("./snapshotter");
const PolkadotSnapShotter = require("./polkadot");

module.exports = class KusamaSnapShotter extends PolkadotSnapShotter {
    constructor() {
        super()
        this.chainName = 'Kusama'
        this.chainDecimals = 12
        this.wsEndpoint = "wss://kusama.api.onfinality.io/ws?apikey=e6c965c6-b08d-492c-b0e8-5128fbef2e63" // wss://kusama-rpc.polkadot.io
    }
}