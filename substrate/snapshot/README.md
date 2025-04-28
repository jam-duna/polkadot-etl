

# Substrate-ETL Snapshot Style Guideline

Chain's snapshot records have the following fields (see [schema here](https://github.com/colorfulnotion/polkaholic-pro/blob/main/substrate/schema/substrateetl/snapshots.json))

| Name           | Type       | Required?| Description                                          |
|----------------|------------|----------|------------------------------------------------------|
| chain_name     | STRING     | NULLABLE |                                                      |
| ts             | TIMESTAMP  | REQUIRED | timestamp when the snapshot is taken                 |
| block_number   | INTEGER    | REQUIRED | block_number when the snapshot is taken              |
| block_hash     | STRING     | REQUIRED | block_hash when the snapshot is taken                |
| address_ss58   | STRING     | NULLABLE | ss58 of the snaptshot state address if available     |
| address_pubkey | STRING     | NULLABLE | pubkey of the snaptshot state address if available   |
| section        | STRING     | REQUIRED | section of the snapshot                              |
| storage        | STRING     | REQUIRED | storage of the snapshot                              |
| track          | STRING     | NULLABLE | optional identifier for the snapshot state           |
| track_val      | STRING     | NULLABLE | optional val associated with track                   |
| kv             | ***JSON*** | NULLABLE | generic snapshot value from the key                  |
| pv             | ***JSON*** | NULLABLE | generic snapshot value from storage                  |
| source         | STRING     | REQUIRED | source that generates this snapshot                  |

Example of testing snapshot (locally)
```
substrate~$ ./substrate-etl local_snapshot --help
Usage: substrate-etl local_snapshot [options]

Generating Snapshot state

Options:
  -r, --relayChain <relayChain>  Relay chain (default: "polkadot")
  -p, --paraID <paraID>          Para ID (default: null)
  -l, --logDT <logDT>            Date (default: null)
  -e, --endDT <endDT>            For multi-day ranges (default: null)
  -f, --force                    Force even if not ready (default: false)
  -d, --daily                    Use Daily Snaptshot (default: false)
  -head, --head                  Work on head (Era0, Era1, Era2) (default: false)
  -t, --test                     test mode (default: false)
  -h, --help                     display help for command
```

Example: taking local snapshot for polkadot assethub (daily):
```
./substrate-etl snapshot -r polkadot -p 1000 -l 2024-01-01 -d


****  Initiating Polkaholic 1.0.0-3ad0ff3 ****
Error: ENOENT: no such file or directory, open '/root/.mysql/.db00.cnf'
/*
errors can be ignored
*/

paraID=1000, isHead=false, isDaily=true, chainID=1000
Days=1 polkadot:1000 [2024-01-01, 2023-03-16] -> [ '2024-01-01' ]
apiInit wsEndpoint=wss://statemint-rpc-tn.dwellir.com
2024-02-21 15:50:59        API/INIT: statemint/1001002: Not decorating unknown runtime apis: 0xfbc577b9d747efd6/1
snapShotter ready [1000] (Polkadot_AssetHub)
[
  {
    snapshotDT: '2024-01-01',
    hr: 23,
    indexTS: 1704150000,
    startBN: 5348951,
    endBN: 5349247,
    startTS: 1704150000,
    endTS: 1704153588,
    start_blockhash: '0xb1d1f4e511443ad65f6e64aaa914d7022a1d4e350c51f396366362c99038c572',
    end_blockhash: '0x7c332836ec081cee244dfaaf16fd1d1c4f034e52766c22a48a77bbb3fea67ed8'
  }
]
snapShot range.  https://api.polkaholic.io/snapshot/1000?logDT=20240101&startHR=23&finalHR=23
periods [
  {
    snapshotDT: '2024-01-01',
    hr: 23,
    indexTS: 1704150000,
    startBN: 5348951,
    endBN: 5349247,
    startTS: 1704150000,
    endTS: 1704153588,
    start_blockhash: '0xb1d1f4e511443ad65f6e64aaa914d7022a1d4e350c51f396366362c99038c572',
    end_blockhash: '0x7c332836ec081cee244dfaaf16fd1d1c4f034e52766c22a48a77bbb3fea67ed8'
  }
]
snotshot fn set:/tmp/polkadot_snapshots_1000_20240101_23.json
snapshotInfo {
  block_hash: '0x7c332836ec081cee244dfaaf16fd1d1c4f034e52766c22a48a77bbb3fea67ed8',
  block_number: 5349247,
  ts: 1704153588
}
enable_snapshot_writing. fn=/tmp/polkadot_snapshots_1000_20240101_23.json
...
close_snapshot_writing. fn=/tmp/polkadot_snapshots_1000_20240101_23.json
```


### Style Guide

 * **Separate fetching & decoding logic if possible** -- this means using snapshotter's`state_fetch_val()`, `state_fetch()`, `paginated_fetch()` to acquire data first and then decoding the kv afterwards :
	 * fn `state_fetch_val(apiAt, section_storage)`:  get the full state of section:storage where key is not iterable. (v) decoding responsibility is pushed to next stage
	 * fn `state_fetch(apiAt, section_storage,args)`: get the full state of section:storage. (k,v) decoding responsibility is pushed to next stage
	 * fn `paginated_fetch(apiAt, section_storage,args)`: get the full state of section:storage, thousand keys at a time. (k,v) decoding responsibility is pushed to next stage

* **Avoid hex, dec, or toHuman() mixed type** - having numbers showing up '17,998,744,107,192' or ''0x0000105EA8BFB8B8" is hard to work with on Dune. Instead, use **paraTool.dechexToIntStr()** to convert it for bigIntStr type, or **paraTool.dechexToInt() / 10**assetdecimals** for float type

* **Avoid using same section:storage combination for different pv struct; use track (type string) as primary identifier for certain topic and track_val as attribute_val**.  Using the records below as example:

```
RecA: asset's total issuance
{
  chain_name: 'Polkadot_AssetHub',
  block_hash: '0x7c332836ec081cee244dfaaf16fd1d1c4f034e52766c22a48a77bbb3fea67ed8',
  block_number: 5349247,
  ts: 1704153588,
  section: 'asset',
  storage: 'asset',
  source: 'polkaholic',
  track: 'stablecoin',
  track_val: 'USDT',
  kv: { currencyID: '1984', symbol: 'USDT' },
  pv: {
    owner: '15uPcYeUE2XaMiMJuR6W7QGW2LsLdKXX7F3PxKG8gcizPh3X',
    issuer: '15uPcYeUE2XaMiMJuR6W7QGW2LsLdKXX7F3PxKG8gcizPh3X',
    admin: '15uPcYeUE2XaMiMJuR6W7QGW2LsLdKXX7F3PxKG8gcizPh3X',
    freezer: '15uPcYeUE2XaMiMJuR6W7QGW2LsLdKXX7F3PxKG8gcizPh3X',
    supply: '17998744107192',
    deposit: '1000000000000',
    minBalance: '700000',
    isSufficient: true,
    accounts: '1393',
    sufficients: '1279',
    approvals: '5',
    status: 'Live'
  }
}

}
RecB : specific accounts
{
  chain_name: 'Polkadot_AssetHub',
  block_hash: '0x7c332836ec081cee244dfaaf16fd1d1c4f034e52766c22a48a77bbb3fea67ed8',
  block_number: 5349247,
  ts: 1704153588,
  section: 'asset',
  storage: 'account',
  source: 'polkaholic',
  track: 'stablecoin',
  track_val: 'USDT',
  address_ss58: '13cKp88qRTQVbMXf7BuKj3KhwAekVhAibtaYZxhykxWWjKbq',
  address_pubkey: '0x7369626c38080000000000000000000000000000000000000000000000000000',
  kv: { name: 'sibl:2104' },
  pv: { balance: 4.100002, balance_raw: '4100002' }
}

RecC : aggrgated accounts
{
  chain_name: 'Polkadot_AssetHub',
  block_hash: '0x7c332836ec081cee244dfaaf16fd1d1c4f034e52766c22a48a77bbb3fea67ed8',
  block_number: 5349247,
  ts: 1704153588,
  section: 'asset',
  storage: 'account',
  source: 'polkaholic',
  track: '1984',
  track_val: 'USDT',
  kv: { name: 'holders' },
  pv: {
    balance: 427966.3935020016,
    balance_raw: '427966393502',
    holders: 1374
  }
}
```
It's recommended to (1) have section:storage are different for rec B and rec C. such that rec B uses storage='balance_account' and rec C uses 'balance_holders'. This signals us these two records are to be parsed differently. (2) make sure all relevant records have same topic & attribute  - i.e changing rec C {track:'1984'. track_val='USDT'} to {track:'stablecoin'. track_val='USDT'} so it matches the style of rec A & B

* **Keep raw value if useful**:  keep non-native asset's currencyID in PV and raw balance in pv if possible . For exmaple, `kv: { name: 'sibl:2104' }` -> `kv: { name: 'sibl:2104', currencyID: '1984', symbol: 'USDT' }`
