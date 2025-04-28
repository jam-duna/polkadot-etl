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

async function get_assethublog() {
    let ingestions = [];
    try {
        const csvData = await fetchData('https://api.dune.com/api/v1/query/4004540/results/csv?limit=1000');
        const rows = csvData.split('\n').slice(1); // Skip header row
        rows.forEach(row => {
	    let r = row.split(",")
	    if ( r && r.length > 4 && r[1].length > 0 )  {
		let ts = r[0].replace(" UTC", "");
		console.log(r);
		let sql = `insert into assethublog (indexTS, asset, priceUSD, volumeUSD, priceDOT) values (floor(unix_timestamp('${ts}')), '${r[1]}', '${r[2]}', '${r[4]}', '${r[5]}') on duplicate key update volumeUSD=values(volumeUSD), priceDOT=values(priceDOT), priceUSD = values(priceUSD);`
	    console.log(sql);
	    }
        });


    } catch (error) {
        console.error(error);
    }
    return ingestions;
}

get_assethublog();
