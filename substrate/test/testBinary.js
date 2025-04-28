// node testDecodeBlock.js

async function main() {
    const {
        ApiPromise,
        WsProvider
    } = require('@polkadot/api');
    const paraTool = require("./paraTool");

    var [chainID, blockNumber, blockHash, eraNumber] = [0, 17890262, "0xf677980b19abdbf2880c16bafe2d8545c14a55e1252076c87b3fa75defe66f80", 1242];
    var WSEndpoints = "wss://polkadot.api.onfinality.io/ws?apikey=e6c965c6-b08d-492c-b0e8-5128fbef2e63" //wss://polkadot.api.onfinality.io/ws?apikey=e6c965c6-b08d-492c-b0e8-5128fbef2e63
    var api = await ApiPromise.create({
        provider: new WsProvider(WSEndpoints) //wss://kusama-rpc.polkadot.io
    });
    await api.isReady;
}


async function findNextEraChangeCombined(api, startBlock, jmp = 20000) {
    let head = await api.query.system.number(); // Hardstop for the search
    let latestBlock = paraTool.dechexToInt(head);
    let initialEra = await getEraAtBlock(api, startBlock);

    let fixedJumps = 7;
    let dynamicJumps = 3;
    let searchBlocks = [];

    // Fixed-step jumps
    for (let i = 1; i <= fixedJumps; i++) {
        let nextBlock = startBlock + i * jmp;
        if (nextBlock > latestBlock) break; // Don't exceed the latest block
        searchBlocks.push(nextBlock);
    }

    // Calculate dynamic-step jumps if there's remaining distance
    if (searchBlocks.length === fixedJumps) {
        let lastFixedJumpBlock = searchBlocks[searchBlocks.length - 1];
        let remainingDistance = latestBlock - lastFixedJumpBlock;
        let dynamicStepSize = Math.ceil(remainingDistance / (dynamicJumps + 1)); // +1 to ensure we reach or exceed latestBlock

        for (let i = 1; i <= dynamicJumps; i++) {
            let nextBlock = lastFixedJumpBlock + i * dynamicStepSize;
            if (nextBlock > latestBlock) break; // Adjust to not exceed the latest block
            searchBlocks.push(nextBlock);
        }
    }

    // Make parallel queries
    let eras = await Promise.all(searchBlocks.map(block => getEraAtBlock(api, block)));

    // Find the first jump where the era changes
    for (let i = 0; i < eras.length; i++) {
        if (eras[i] !== initialEra) {
            // Prepare to perform binary search in this range
            let low = i > 0 ? searchBlocks[i - 1] : startBlock;
            let high = searchBlocks[i];
            return await binarySearchForEraChange(api, low, high, initialEra);
        }
    }

    if (eras.length > 0 && eras[eras.length - 1] === initialEra) {
        // If the last jump still has the same era, it means no era change detected up to the latestBlock
        console.log("No era change detected up to the latest block.");
        return -1;
    }

    // If we've gone through all jumps without finding an era change, check the range from the last jump to the latestBlock
    return await binarySearchForEraChange(api, searchBlocks[searchBlocks.length - 1], latestBlock, initialEra);
}


async function binarySearchForEraChange(api, low, high, initialEra) {
    while (low <= high) {
        let mid = Math.floor((low + high) / 2);

        // Parallelize queries for the era at `mid` and `mid - 1`
        let [midEra, prevEra] = await Promise.all([
            getEraAtBlock(api, mid),
            getEraAtBlock(api, mid - 1)
        ]);

        if (midEra !== initialEra && prevEra === initialEra) {
            // Found the exact block where the era changes
            console.log(`Era change found at block ${mid}`);
            return mid;
        } else if (midEra === initialEra) {
            // If the era at `mid` is still the initial era, search in the right half
            low = mid + 1;
        } else {
            // If the era at `mid` has already changed, and `prevEra` is different, search in the left half
            high = mid - 1;
        }
    }

    // If the loop exits without returning, it means the era change wasn't found in the range
    console.log("Era change not found in the specified range.");
    return -1;
}

async function fetchBlockHash(api, blockNumber) {
    try {
        let blockHash = await api.rpc.chain.getBlockHash(blockNumber);
        //console.log(`[${blockNumber}] ${blockHash.toHex()}`)
        return blockHash.toHex()
    } catch (e) {
        console.log(`setAPIAt err`, e)
        return false
    }
}

async function findNextEraChange(api, startBlock, jmp = 20000) {
    let searchBlock = startBlock;
    let head = await api.query.system.number(); //Hardstop for the search
    let latestBlock = paraTool.dechexToInt(head)

    let initialEra = await getEraAtBlock(api, searchBlock);
    let rangeEra, nextBlock;

    // Make jumps to find the range where the era changes, respecting the blockchain's current head
    while (true) {
        nextBlock = searchBlock + step;
        if (nextBlock > latestBlock) {
            nextBlock = latestBlock; // Adjust to not exceed the latest block
        }
        rangeEra = await getEraAtBlock(api, nextBlock);

        if (initialEra !== rangeEra) {
            // If era changed, prepare to perform binary search in this range
            break;
        } else if (nextBlock === latestBlock) {
            // If reached the latest block without detecting an era change
            console.log(`terminate at head - nO change detected!!`)
            return -1; // Indicates no era change detected up to the latest block
        } else {
            // If era is the same, continue jumping
            searchBlock = nextBlock;
        }
    }

    // Binary search to find the precise block where the era changes
    let low = searchBlock;
    let high = nextBlock;

    while (low <= high) {
        let mid = Math.floor((low + high) / 2);
        let midEra = await getEraAtBlock(api, mid);

        if (midEra === initialEra) {
            // If the era at mid is still the initial era, search right half
            low = mid + 1;
        } else {
            // If era has changed at mid, verify if it's the first block of the change
            let prevEra = await getEraAtBlock(api, mid - 1);
            if (prevEra === initialEra) {
                console.log(`Found! ${prevEra} @ ${mid}`)
                return mid; // Found the first block after the era change
            } else {
                high = mid - 1; // Search left half
            }
        }
    }

    // Should not reach here with correct logic and an era change within the range
    console.log(`terminate at no change detected!!`)
    return -1;
}

async function getEraAtBlock(api, blockNumber) {
    // Set the specific block to retrieve the era value at that block
    let block_hash = await fetchBlockHash(api, blockNumber)
    const era = await api.query.staking.currentEra.at(block_hash);
    let eraBN = paraTool.dechexToInt(era)
    console.log(`[${blockNumber}] ${block_hash} era=${eraBN}`)
    return eraBN;
}

// Example usage
const api = await ApiPromise.create({
    provider
}); // Ensure you have initialized the API with your provider
const startBlock = 100000; // Example start block, adjust as necessary
const endBlock = 200000; // Example end block, adjust as necessary

findEraChange(api, startBlock, endBlock).then(eraChangeBlock => {
    if (eraChangeBlock !== -1) {
        console.log(`Era changed at block ${eraChangeBlock}`);
    } else {
        console.log('Era change not found within the given range');
    }
});


main()
    .then(() => {
        process.exit(0);
    })
    .catch((e) => {
        console.error('ERROR', e);
        process.exit(1);
    });