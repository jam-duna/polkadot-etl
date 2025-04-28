# polkadot-etl

polkadot-etl indexes Polkadot, Kusama and their Substrate based parachains for BigQuery and Dune ingestion.

The index is fully available in BigQuery in the crypto-polkadot dataset.


The index is stored in mysql + BigTable, and is set up with:

* mysql (5.7): substrate/schema/polkadotetl.sql
* BigTable: substrate/cbt/cbt.sh

The `PolkaholicDB` class manages the connections to the above tables with a `POLKAHOLIC_DB` variable (see
also `POLKAHOLIC_DB_REPLICA`, which support multiple replicas in load balanced instance groups in 3+ regions).
managing "ini" file credentials in one place:

```
[client]
host = polkaholic
user = polkaholic
password = ******
database = polkaholic
default-character-set=utf8mb4

[email]
email = info@polkaholic.io
password = ******

[gc]
projectName = us-west1-wlk
bigqueryDataset = polkaholic
bigtableInstance = polkaholic
bigtableCluster = polkaholic
storageBucket = polkaholic
```

Each chain's blocks are stored in a `block${chainID}` table in mysql
and a BigTable `chain${chainID}`, with the state of the chain kept in
a single record in the `chain` table.  ChainIDs are 0 + 2 for Polkadot
and Kusama, and then `paraID` and `paraID + 20000` for Polkadot
parachains and Kusama parachains (mostly..exceptions are for chains like Kilt
and Subsocial).

Indexing is managed with `polkaholic crawlblocks ${chainID}` -- to
kick off indexing of a chain, you will need to add a record into the
`chain` table with a valid WSEndpoint (e.g. wss://rpc.polkadot.io)

```
mysql> select * from chain where chainID = 0 \G
*************************** 1. row ***************************
                     chainID: 0
                          id: polkadot
                      prefix: 0
                   chainName: Polkadot
                  relayChain: polkadot
                  WSEndpoint: wss://rpc.polkadot.io
                 WSEndpoint2:
                 WSEndpoint3: NULL
...
               blocksCovered: 11092165
             blocksFinalized: 11092162
            lastCleanChainTS: NULL
               blocksCleaned: 9729723
                 displayName: Polkadot Relay Chain
             standardAccount: *25519
                    decimals: [10]
                     symbols: ["DOT"]
                     website: https://polkadot.network
                 coingeckoID: polkadot
```

Then run `polkaholic crawlblocks 0`, which will fill up the
`block${chainID}` table and `chain${chainID}` BigTable.  (Polkaholic
runs 2 crawler services for every chain for redundancy.)  While most
parachains support `subscribeStorage` to support the fetching of
traces, most public endpoints do not support "unsafe" trace calls.
All gaps in traces have to be covered using our internal nodes
(currently 20) and snapshots of 25-30 additional chain instances.

The end setup for mysql:
```
mysql> show tables;
+--------------------------+
| Tables_in_defi           |
+--------------------------+
| account                  |
| address                  |
| addressTopN              |
| addressoffer             |
| apikey                   |
| asset                    |
| assetInit                |
| assetholder0             |
| assetholder1000          |
| assetholder2             |
| assetholder2000          |
| assetholder2002          |
...
| assetlog                 |
| auditHashes              |
| block0                   |
| block1000                |
| block2                   |
| block2000                |
| block2002                |
...
| blocklog                 |
| blockunfinalized         |
| chain                    |
| chainEndpoint            |
| chainPalletStorage       |
| chainhostnameendpoint    |
| chainparachain           |
| coingecko                |
| coingecko_market_chart   |
| contractabi              |
| crowdloan                |
| events                   |
| eventslog                |
| evmtxs                   |
| evmtxslog                |
| extrinsicdocs            |
| extrinsics               |
| extrinsicslog            |
| extrinsicsrecent         |
| follow                   |
| indexlog                 |
| method                   |
| multisigaccount          |
| offer                    |
| proxyaccount             |
| rewards                  |
| rewardslog               |
| specVersions             |
| subaccount               |
| substrateetllog          |
| testParseTraces          |
| token1155holder          |
| tokenholder              |
| transfers                |
| transferslog             |
| transfersrecent          |
| user                     |
| xcmlog                   |
| xcmmap                   |
| xcmmessages              |
| xcmmessagesrecent        |
| xcmtransfer              |
| xcmtransferdestcandidate |
+--------------------------+
```
BigTable:
```
# cbt ls
accountrealtime
addressextrinsic
apikeys
chain0
chain1000
chain2
chain2000
...
hashes
...
```

The crawling service listens for new blocks and storage events over
WebSockets (`wss://`).  It should be run on at least 2 nodes and is
managed with a service powered by `polkaholic crawlblocks ${chainID}`.

The WS-based crawler stores all blocks and trace data in BigTable tables `chain${chainID}` using 6 column families:

```
# cbt ls chain0
Family Name	GC Policy
-----------	---------
blockraw	versions() > 1
events		versions() > 1
feed	   	versions() > 1
finalized	versions() > 1
n		versions() > 1
trace		versions() > 1
````

Chains with EVM support (Moonbeam, Astar, ...) have additional columns.

Block numbers are keyed by 8 digit hex (instead of decimal) to support prefix scans by the indexer.

* The `subscribeStorage` events result in a call to fetch the block and turn it _manually_ into sidecar compatible form, resulting in cells in both the `block` and `trace` column family by the indexing process, 
* The `subscribeFinalizedHeads` events result in cells in only the `finalized` column family.  Multiple block candidates at a given height result in multiple columns, but when a block is finalized, other non-finalized candidates are deleted.

Here is the crawlblocks process on chain 2000 (acala), run _manually_ on one node:
```
# # ./polkaholic crawlblocks 2000
chain API connected 2000
You are connected to ACALA chain 2000 endpoint=... with types + rpc + signedExt
...
subscribeStorage Acala bn=1396814 0x0d5aaa4b68bce292eafe392b52870a13d0e3f416beb86b69b6d6c90185049c03: cbt read chain2000 prefix=0x0015504e
subscribeFinalizedHeads Acala 1396812 CHECK: cbt read chain2000 prefix=0x0015504c |   update chain set blocksFinalized = '1396812', lastFinalizedDT = Now() where chainID = '2000'
...
```

Here is a single block for chain 2000:
```
# cbt read chain2000 prefix=0x0015504c
----------------------------------------
0x0015504c
  blockraw:0x7414093b4997ab781fd2e01e4a502c5c48e58ba0cff565a6864220366196009e @ 2022/07/09-11:43:18.000000
    "{\"header\":{\"parentHash\":\"0x6a288a32a987d87db925bd030424594a4f6365c7feb8ab87428ab9c95f0cc2c0\",\"number\":1396812,\"stateRoot\":\"0x001b9629fc78a4fb04305c99d57e033325c5226484a178d738b8b1b90a7842ec\",\"extrinsicsRoot\":\"0xaa605341d6f38461921df4d0ef72c8607e41b818e56d7daabb5d5842bd949b18\",\"digest\":{\"logs\":[{\"preRuntime\":[\"0x61757261\",\"0xb07b3b0800000000\"]},{\"seal\":[\"0x61757261\",\"0x184eb4cf21f21a502091d9cb3a0aa6b54d20321a514a050a40df0b850c4d914f6c4b2ba83f5b96e7fc29cb2c084ea847a248d5b0d1d91b967c92ee7fd8f09989\"]}]}},\"extrinsics\":[\"0x280401000bd5f245e48101\",\"0xcd..."],\"number\":1396812,\"hash\":\"0x7414093b4997ab781fd2e01e4a502c5c48e58ba0cff565a6864220366196009e\",\"blockTS\":1657392198}"
  events:0x7414093b4997ab781fd2e01e4a502c5c48e58ba0cff565a6864220366196009e @ 2022/07/09-11:43:18.000000
    "[{\"phase\":{\"initialization\":null},\"event\":{\"data\":[{\"token\":\"AUSD\"},...]"
  feed:0x7414093b4997ab781fd2e01e4a502c5c48e58ba0cff565a6864220366196009e @ 2022/07/09-11:43:18.000000
    "{\"header\":{\"parentHash\":\"0x6a288a32a987d87db925bd030424594a4f6365c7feb8ab87428ab9c95f0cc2c0\",\"number\":1396812,\"stateRoot\":\"0x001b9629fc78a4fb04305c99d57e033325c5226484a178d738b8b1b90a7842ec\",\"extrinsicsRoot\":\"0xaa605341d6f38461921df4d0ef72c8607e41b818e56d7daabb5d5842bd949b18\",\"digest\":{\"logs\":[{\"preRuntime\":[\"0x61757261\",\"0xb07b3b0800000000\"]},{\"seal\":[\"0x61757261\",\"0x184eb4cf21f21a502091d9cb3a0aa6b54d20321a514a050a40df0b850c4d914f6c4b2ba83f5b96e7fc29cb2c084ea847a248d5b0d1d91b967c92ee7fd8f09989\"]}]}},\"extrinsics\":[{\"chainID\":2000,\"ts\":1657392198,\"blockHash\":\"0x7414093b4997ab781fd2e01e4a502c5c48e58ba0cff565a6864220366196009e\",\"blockNumber\":1396812,\"extr...
  finalized:0x7414093b4997ab781fd2e01e4a502c5c48e58ba0cff565a6864220366196009e @ 2022/07/09-11:43:49.843000
    "1"
  finalized:0x7414093b4997ab781fd2e01e4a502c5c48e58ba0cff565a6864220366196009e @ 2022/07/09-11:43:49.600000
    "1"
  n:traceType                              @ 2022/07/09-11:43:18.000000
    "subscribeStorage"
  trace:0x7414093b4997ab781fd2e01e4a502c5c48e58ba0cff565a6864220366196009e @ 2022/07/09-11:43:18.000000
    "[{\"k\":\"0x027a4e29b47efb389eca0f0ba7a8d619057d256c2b189477f5441f02ad1f0fd6\",\"v\":null},{\"k\":\"0x15464cac3378d46f113cd5b7a4d71c8436cf781e2bdd3b2fe1ce339b2858e5682f857e6151a46fd95ac09ed30bf9c17475373689bb8965cf5c3cd9cff1894f407310acd892d4f165\",\"v\":\"0x100a000000\"},{\"k\":\"0x1da53b775b270400e7e61ed5cbc5a146c726478796bad0b9cabd7481dbe64983\",\"v\":null},{\"k\":\"0x26aa394eea5630e07c48ae0c9558cef702a5c1b19ab7a04f536c519aca4983ac\",\"v\":\"0x104c501500\"},{\"k\":\"0x26aa394eea5630e07c48ae0c9558cef70a98fdbe9ce6c55837576c60c7af3850\",\"v\":\"0x100c000000\"},{\"k\":\"0x26aa394eea5630e07c48ae0c9558cef734abf5cb34d6244378cddbf18e849d96\",\"v\":\"0x60a8f44824000000000000000000000000708435b502000000\"},{\"k\":\"0x26aa394eea5630...
```

The above log shows how to inspect with `cbt` on the command line.
In most cases there will be multiple cells for `finalized` due to multiple indexers, but any row with a `finalized` cell should have only one block/trace matching column.

The tip of each crawled chain is held in the `chain` table in the `blocksCovered` and `blocksFinalized` column.
```
mysql> select chainID, chainName, blocksFinalized, blocksCovered from chain where crawling = 1;
+---------+---------------------+-----------------+---------------+
| chainID | chainName           | blocksFinalized | blocksCovered |
+---------+---------------------+-----------------+---------------+
|       0 | Polkadot            |        14321625 |      14321627 |
|       2 | Kusama              |        16709278 |      16709281 |
|    1000 | Statemint           |         3248772 |       3248774 |
|    1001 | Collectives         |          644977 |        644977 |
|    2000 | Acala               |         2983362 |       2983364 |
|    2002 | Clover              |         2899160 |       2899160 |
|    2004 | Moonbeam            |         2984929 |       2984931 |
|    2006 | Astar               |         2979581 |       2979583 |
...
```

### Backfill of Blocks and Traces + Other Processes

The crawling service is not perfect due to missing blocks, RPC
connectivity issues, unavailability of archive nodes, bootnodes, bad
code pushes, and general system failures.  Thus the `polkaholic
auditchain` script identifies missing blocks and traces, whereas
`polkaholic backfill` and `polkaholic crawltraces` scripts crawl the
blocks + traces that are missing.  Both these `auditchain` and
`backfill` process are covered systematically with an hourly
`indexchain` process to fill any gaps, which minimizes the need for
human interventions.

The following operations are put in regular cron jobs / services:
```
* `polkaholic pricefeed` (every 5 mins) -- fetches the latest prices from the coingecko API
* `polkaholic updateassetpricelog` (every 5 mins) -- fetches the latest prices from top defi chains: moonbeam, astar, ...
* `polkaholic identity` -- fetches new identities from Polkadot and Kusama
* `xcmindexer xcmmessages` -- matches outgoing and incoming XCM messages
* `xcmindexer xcmtransfer` -- matches outgoing XCM transfers and incoming asset signals
* `xcmindexer xcmgarload` -- loads [XCM Global Asset Registry](https://github.com/colorfulnotion/xcm-global-registry)
* `substrate-etl dump` -- exports to [substrate-etl](https://github.com/colorfulnotion/substrate-etl)
```

At present, we manually:
* maintain chain.WSEndpoint using endpoints from polkadot.js.org for new chains
* supervise `xcmgar` imports from [XCM Global Asset Registry](https://github.com/colorfulnotion/substrate-etl)
* supervise `substrate-etl` exports into publicly available BigQuery [polkadot](https://github.com/colorfulnotion/substrate-etl/polkadot) and [kusama](https://github.com/colorfulnotion/substrate-etl/kusama) datasets 
* solve issues reported by parachain teams and Polkadot ecosystem leadership

### Google Cloud Deployment

At present, 50 chains are crawled/indexed by a 10 GKE cluster (6 core, 16GB).  

Ansible is used with auto generated YAML (see `yaml`) with `generateCrawlerYAML` and deployment is managed with `Makefile`:
* `make indexers` - updates 20 indexers
* `make ui` - updates US/AS/EU endpoints powering https://polkaholic.io 

Other:
* Mysql Backup is automated on mysql via GCP Cloud SQL
* Backup of BigTable is done with `polkaholic backupchains`

## Contributing

### Contributing Guidelines

[Contribution Guidelines](CONTRIBUTING.md)

### Contributor Code of Conduct

[Code of Conduct](CODE_OF_CONDUCT.md)

## License

polkadot-etl is [GPL 3.0 licensed](LICENSE).
