const fs = require('fs');
const axios = require('axios');

const apiKey = 'apiKey'; // Replace with your actual API key
const csvFilePath = '/Users/myichael/Downloads/stakings0_modified3.csv'; // Replace with your CSV file path

// Read CSV file
fs.readFile(csvFilePath, 'utf8', (err, data) => {
    if (err) {
        console.error('Error reading file:', err);
        return;
    }

    console.log(`DATA:`, data)

    const url = 'https://api.dune.com/api/v1/table/upload/csv';

    const headers = {
        'X-Dune-Api-Key': apiKey
    };

    const payload = {
        "table_name": "polkadot_stakings",
        "description": "Polkadot stakings info",
        "is_private": false,
        "data": data
    };

    console.log(`payload`, payload)

    // Configuration options for Axios
    const axiosConfig = {
        headers: headers,
        maxContentLength: Infinity, // No limit on the content length
        maxBodyLength: Infinity // No limit on the body length
    };

    //return
    // Make a POST request to upload the CSV
    axios.post(url, payload, axiosConfig)
        .then(response => {
            console.log('Response status code:', response.status);
            console.log('Response content:', response.data);
        })
        .catch(error => {
            console.error('Error uploading data:', error.response ? error.response.data : error.message);
        });

});