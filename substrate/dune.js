const axios = require('axios');

const apiKey = 'g4B9SsKTgmoAVvxYd1N7M6Eyq0U3d8I6';

const currentTime = new Date();

async function fetchData(url) {
    try {
        const response = await axios.get(url, {
            headers: {
                'X-Dune-API-Key': apiKey
            }
        });

        return response.data;
    } catch (error) {
        throw new Error('Error fetching data:', error);
    }
}

async function get_slowStakings() {
    let ingestions = [];
    try {
        const csvData = await fetchData('https://api.dune.com/api/v1/query/3794567/results/csv?limit=1000');
        const rows = csvData.split('\n').slice(1); // Skip header row
        rows.forEach(row => {
            const [chain_id, lastBlockTime] = row.split(',');

            if (lastBlockTime) {
                const blockTime = new Date(lastBlockTime);
                const timeDifference = Math.round((currentTime - blockTime) / (1000 * 60 * 60));
                if (chain_id == 'kusama' && (timeDifference > 24)) {
                    ingestions.push(`${chain_id} (${timeDifference} hrs)`);
                } else if (chain_id == 'polkadot' && (timeDifference > 72)) {
                    ingestions.push(`${chain_id} (${timeDifference} hrs)`);
                }
            }
        });


    } catch (error) {
        console.error(error);
    }
    return ingestions;
}

async function get_slowIngestions() {
    let ingestions = [];
    try {
        const csvData = await fetchData('https://api.dune.com/api/v1/query/3617826/results/csv?limit=1000');
        const rows = csvData.split('\n').slice(1); // Skip header row
        rows.forEach(row => {
            const [chain_id, lastBlockTime, b1] = row.split(',');

            if (lastBlockTime) {
                const blockTime = new Date(lastBlockTime);
                const timeDifference = Math.round((currentTime - blockTime) / (1000 * 60 * 60));

                if (timeDifference > 3) {
                    ingestions.push(`${chain_id} (${timeDifference} hrs)`);
                }
            }
        });


    } catch (error) {
        console.error(error);
    }
    return ingestions;
}

async function get_slowSnapshots() {
    let s = [];
    try {
        const csvData = await fetchData('https://api.dune.com/api/v1/query/3685986/results/csv?limit=1000');
        const rows = csvData.split('\n').slice(1); // Skip header row
        rows.forEach(row => {
            const [chain_id, lastBlockTime] = row.split(',');

            if (lastBlockTime) {
                const blockTime = new Date(lastBlockTime);
                const timeDifference = Math.round((currentTime - blockTime) / (1000 * 60 * 60)); // Difference in hours

                if (timeDifference > 27) {
                    s.push(`${chain_id} (${timeDifference} hours old)`);
                }
            }
        });
    } catch (error) {
        console.error(error);
    }
    return s;
}

async function get_slowBalances() {
    let s = [];
    try {
        const csvData = await fetchData('https://api.dune.com/api/v1/query/3697940/results/csv?limit=1000');
        const rows = csvData.split('\n').slice(1); // Skip header row
        rows.forEach(row => {
            const a = row.split(',');
            let chain_id = a[0];
            let lastBlockTime = a[1];
            if (lastBlockTime) {
                const blockTime = new Date(lastBlockTime);
                const timeDifference = Math.round((currentTime - blockTime) / (1000 * 60 * 60)); // Difference in hours

                if (timeDifference > 25) {
                    s.push(`${chain_id} (${timeDifference} hours old)`);
                }
            }
        });
    } catch (error) {
        console.error(error);
    }
    return s;
}

// Function to send a message to Slack #substrate-etl-public channel
async function sendMessageToSlack(message) {
    const slackWebhookUrl = 'https://hooks.slack.com/services/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'
    try {
        const response = await axios.post(slackWebhookUrl, {
            text: message,
            channel: "#substrate-etl-public", // specify the channel here
        });

        console.log('Message sent to Slack:', response.data);
    } catch (error) {
        console.error('Error sending message to Slack:', error);
    }
}

async function get_slow_data() {
    let msg = "";
    let stakings = await get_slowStakings();
    let ingestions = await get_slowIngestions();
    let snapshots = await get_slowSnapshots();
    let balances = await get_slowBalances();
    if (stakings.length > 0) {
        msg += "Slow stakings:\r\n " + stakings.join(" \r\n ") + "\r\n";
    }
    if (ingestions.length > 0) {
        msg += "Slow chains:\r\n " + ingestions.join(" \r\n ") + "\r\n";
    }
    if (snapshots.length > 0) {
        msg += "Slow snapshots:\r\n " + snapshots.join(" \r\n ") + "\r\n";
    }
    if (balances.length > 0) {
        msg += "Slow balances:\r\n " + balances.join(" \r\n ") + "\r\n";
    }

    if (msg.length > 8) {
        await sendMessageToSlack(msg);
    } else {
        console.log("Nothing to send!");
    }
}

get_slow_data();