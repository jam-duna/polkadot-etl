const {
    AML
} = require('elliptic-sdk');

async function main() {
    const {
        client
    } = new AML({
        key: "898e8e5e5c94671f05cff4a4379f38a4",
        secret: "79192527758b87f458f614c310e3650c"
    });
    const requestBody = {
        subject: {
            asset: 'holistic',
            blockchain: 'holistic',
            type: 'address',
            hash: '5DykyfCFjeDPufZYkg5MkuxFGZvudtd4dpzAKn9XpCsqmkUV'
        },
        type: 'wallet_exposure',
        customer_reference: 'dotswap'
    };

    try {
        const response = await client.post('/v2/wallet/synchronous', requestBody);
        console.log(JSON.stringify(response.data, null, 4));
    } catch (error) {
        if (error.response.status === 404) {
            console.error("Resource not found:");
        } else {
            console.error("An error occurred:", error);
        }
        //console.error("An error occurred:", error);*/
    }

}

main()
    .then(() => {
        process.exit(0);
    })
    .catch((e) => {
        console.error('ERROR', e);
        process.exit(1);
    });