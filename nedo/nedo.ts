// Import
import { ApiPromise, WsProvider } from '@polkadot/api';
import {readAssetsFromFile} from "./read_assets"
import {BN} from "@polkadot/util";

interface JSONableCodec {
  toJSON(): any;
}

async function main () {
    const filePath = '/Users/funkmeister380/xcm-global-registry-internal/assets/polkadot/polkadot_2030_assets.json'; // Adjust the file path as needed

    const assets = await readAssetsFromFile(filePath);

    const wsProvider = new WsProvider('wss://hk.p.bifrost-rpc.liebi.com/ws');
    const api = await ApiPromise.create({ provider: wsProvider });

    const timeNow = await api.query.timestamp.now();
    const totalIssuance = await api.query.tokens.totalIssuance.entries();

    // loop through all tokens..
    for(const [k, v] of totalIssuance){
        const decodedKey = k.args.map((k: JSONableCodec) => k.toJSON());
        const assetDetails = {"type": Object.keys(decodedKey[0])[0].toLowerCase(),
        "value": decodedKey[0],
        "extracted": Object.values(decodedKey[0])[0]
        }
        const tokenSignature: { [key: string]: string } = {};
        tokenSignature[Object.keys(decodedKey[0])[0].toLowerCase()] = `${Object.values(decodedKey[0])[0]}`;
        const assetDetailsJson = JSON.stringify(tokenSignature);
        const assetDetailsLookedUp = assets.get(assetDetailsJson);
        if(assetDetailsLookedUp){
            // Calculate 10**decimals using BN's pow method
            const ten = new BN(10);
            const x = ten.pow(new BN(assetDetailsLookedUp.decimals-2)); // keep 2 digits for fraction
            const tokensIssued = new BN(v.toString())

            // Perform the division
            const humanAmount = tokensIssued.div(x).toNumber()/100 // including 2 digits fraction
            console.log(`Full details of ${assetDetailsLookedUp.symbol} : ${humanAmount} : ${JSON.stringify(assetDetailsLookedUp)}`)
        } else {
            console.log(`Only details of ${decodedKey[0]} : ${v.toString()}`)
        }
    }
}

main().then(() => console.log('completed'))
// Construct
