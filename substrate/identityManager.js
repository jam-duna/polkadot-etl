// Copyright 2022-2025 Colorful Notion, Inc.
// This file is part of polkadot-etl.

// polkadot-etl is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// polkadot-etl is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with polkadot-etl.  If not, see <http://www.gnu.org/licenses/>.

const Crawler = require("./crawler");
const paraTool = require("./paraTool");
const mysql = require("mysql2");
const fs = require("fs");
const path = require('path');
const util = require('util');
const exec = util.promisify(require("child_process").exec);

module.exports = class IdentityManager extends Crawler {
    debugLevel = 0;
    /*
    debugLevel = 0 no console log
    debugLevel = 1 error only
    debugLevel = 2 info
    debugLevel = 3 verbose
    */
    constructor(debugLevel = false) {
        super()

        if (debugLevel) {
            this.debugLevel = debugLevel;
        }
    }

    async dump_identity() {
        /*
        if (chainID != paraTool.chainIDPolkadot || chainID != paraTool.chainIDKusama){
            console.log(`chainID=${chainID} Not supported`)
            return
        }
        let infoFld = (chainID == paraTool.chainIDPolkadot) ? "info": "infoKSM"
        let judgementsFld = (chainID == paraTool.chainIDPolkadot) ? "judgements": "judgementsKSM"
        */

        // 2. setup directories for tbls on date
        let NL = "\r\n";
        let dir = "/tmp";
        let fn = path.join(dir, `identity.json`)
        console.log(`writting to ${fn}`)
        let f = fs.openSync(fn, 'w', 0o666);

        let subAccountSQL = `select address as pubkey, parent as polkadot_parent, parentKSM as kusama_parent, subName as polkadot_subname, subNameKSM as kusama_subname from subaccount where ((subNameKSM is not null and subNameKSM != "null")  or (subName is not null and subName != "null"))`;
        var subAccounts = await this.poolREADONLY.query(subAccountSQL);
        let accountSQL = `select address as pubkey, info as polkadot_info, infoKSM as kusama_info, judgements as polkadot_judgements, judgementsKSM as kusama_judgements from account where (info is not null or infoKSM is not null)`;
        var accounts = await this.poolREADONLY.query(accountSQL);
        let identityMap = {}
        let subIdentityMap = {}
        let verifiedStatus = ["knownGood", "reasonable"]
        for (const account of accounts) {
            let pubkey = account.pubkey
            //console.log(`pubkey=${account.pubkey}, account`, account)
            let acct = {
                pubkey: pubkey,
                polkadot_ss58: paraTool.getAddress(pubkey, 0),
                kusama_ss58: paraTool.getAddress(pubkey, 2),
                polkadot_is_subidentity: null,
                polkadot_fullname: null,
                polkadot_name: null,
                polkadot_subname: null,
                polkadot_info: null,
                polkadot_judgements: null,
                polkadot_judgement_verified: false,
                kusama_is_subidentity: null,
                kusama_fullname: null,
                kusama_name: null,
                kusama_subname: null,
                kusama_info: null,
                kusama_judgements: null,
                kusama_judgement_verified: false,
            };
            try {
                if (account.polkadot_info != undefined) acct.polkadot_info = JSON.parse(`${account.polkadot_info}`)
                if (account.kusama_info != undefined) acct.kusama_info = JSON.parse(`${account.kusama_info}`)
                if (account.polkadot_judgements != undefined) {
                    acct.polkadot_judgements = JSON.parse(account.polkadot_judgements)
                    for (const polkadot_judgement of acct.polkadot_judgements) {
                        if (polkadot_judgement.status != undefined) {
                            if (verifiedStatus.includes(polkadot_judgement.status)) {
                                acct.polkadot_judgement_verified = true
                            }
                        }
                    }
                }
                if (account.kusama_judgements != undefined) {
                    acct.kusama_judgements = JSON.parse(account.kusama_judgements)
                    for (const kusama_judgement of acct.kusama_judgements) {
                        if (kusama_judgement.status != undefined) {
                            if (verifiedStatus.includes(kusama_judgement.status)) {
                                acct.kusama_judgement_verified = true
                            }
                        }
                    }
                }
            } catch (e) {
                console.log(`json parse err`, e)
            }
            if (acct.polkadot_info && acct.polkadot_info.display != undefined) {
                acct.polkadot_name = acct.polkadot_info.display
                acct.polkadot_fullname = acct.polkadot_info.display
            }
            if (acct.kusama_info && acct.kusama_info.display != undefined) {
                acct.kusama_name = acct.kusama_info.display
                acct.kusama_fullname = acct.kusama_info.display
            }
            console.log(`acct`, acct)
            fs.writeSync(f, JSON.stringify(acct) + NL);
            identityMap[pubkey] = acct
        }
        for (const subAccount of subAccounts) {
            //console.log(`subAccount`, subAccount)
            let pubkey = subAccount.pubkey
            let subAcct = {
                pubkey: pubkey,
                polkadot_ss58: paraTool.getAddress(pubkey, 0),
                kusama_ss58: paraTool.getAddress(pubkey, 2),
                polkadot_parent: null,
                polkadot_is_subidentity: null,
                polkadot_fullname: null,
                polkadot_name: null,
                polkadot_subname: null,
                polkadot_info: null,
                polkadot_judgements: null,
                polkadot_judgement_verified: null,
                kusama_parent: null,
                kusama_is_subidentity: null,
                kusama_fullname: null,
                kusama_name: null,
                kusama_subname: null,
                kusama_info: null,
                kusama_judgements: null,
                kusama_judgement_verified: null,
            };
            if (subAccount.polkadot_subname != undefined) {
                subAcct.polkadot_subname = subAccount.polkadot_subname
            }
            if (subAccount.kusama_subname != undefined) {
                subAcct.kusama_subname = subAccount.kusama_subname
            }
            if (subAccount.kusama_parent != undefined && subAccount.kusama_parent != "null") {
                subAcct.kusama_parent = subAccount.kusama_parent
                let parent_identity = identityMap[subAcct.kusama_parent]
                //console.log(`subAcct=${pubkey} kusama_parent=${subAccount.kusama_parent}, parent_identity`, parent_identity)
                subAcct.kusama_is_subidentity = true
                subAcct.kusama_fullname = (parent_identity.kusama_name) ? `${parent_identity.kusama_name}/${subAccount.kusama_subname}` : `/${subAccount.kusama_subname}`
                subAcct.kusama_name = parent_identity.kusama_name
                subAcct.kusama_info = parent_identity.kusama_info
                subAcct.kusama_judgements = parent_identity.kusama_judgements
                subAcct.kusama_judgement_verified = parent_identity.kusama_judgement_verified
            }
            if (subAccount.polkadot_parent != undefined && subAccount.polkadot_parent != "null") {
                subAcct.polkadot_parent = subAccount.polkadot_parent
                let parent_identity = identityMap[subAcct.polkadot_parent]
                //console.log(`subAcct=${pubkey} polkadot_parent=${subAcct.polkadot_parent}, parent_identity`, parent_identity)
                subAcct.polkadot_is_subidentity = true
                subAcct.polkadot_fullname = (parent_identity.polkadot_name) ? `${parent_identity.polkadot_name}/${subAccount.polkadot_subname}` : `/${subAccount.polkadot_subname}`
                subAcct.polkadot_name = parent_identity.polkadot_name
                subAcct.polkadot_info = parent_identity.polkadot_info
                subAcct.polkadot_judgements = parent_identity.polkadot_judgements
                subAcct.polkadot_judgement_verified = parent_identity.polkadot_judgement_verified
            }
            console.log(`subAcct`, subAcct)
            fs.writeSync(f, JSON.stringify(subAcct) + NL);
            subIdentityMap[pubkey] = subAcct
        }
        let cmd0 = `gsutil cp ${fn} gs://substrate_identity/`
        let cmd1 = `bq load --project_id=substrate-etl --max_bad_records=10 --source_format=NEWLINE_DELIMITED_JSON --replace=true polkadot_analytics.identity gs://substrate_identity/* /root/go/src/github.com/jam-duna/polkadot-etl/substrate/schema/substrateetl/identity.json`
        console.log(cmd0)
        console.log(cmd1)
        await exec(cmd0);
        await exec(cmd1);
    }

    async getHeader(chainID) {
        let bn = false;
        let blockHash = false;
        let chain = await this.setupChainAndAPI(chainID);
        try {
            let h = await this.api.rpc.chain.getHeader()
            if (h.toJSON() != undefined) {
                bn = paraTool.dechexToInt(h.toJSON().number) - 1
                blockHash = paraTool.dechexToInt(h.toJSON().parentHash) - 1
            }
        } catch (e) {
            console.log(`getHeader err`, e.toString())
            return [false, false]
        }
        return [bn, blockHash]
    }

    async updateOnChainProxyFull(chainID) {
        let proxyAddrs = await this.getOnchainProxyList(chainID);
        await this.updateOnChainProxy(chainID, proxyAddrs)
    }

    async updateOnChainSubIdentitiesFull(chainID) {
        let identityAddrs = await this.getOnchainSubIdentityList(chainID);
        await this.updateOnChainSubIdentities(chainID, identityAddrs)
    }

    async updateOnChainIdentitiesFull(chainID) {
        let identityAddrs = await this.getOnchainIdentityList(chainID);
        await this.updateOnChainIdentities(chainID, identityAddrs)
    }

    async getKnownIdentityList(chainID) {
        let sql = false;
        let identityAddrs = []
        if (chainID != paraTool.chainIDPolkadot && chainID != paraTool.chainIDKusama) {
            console.log(`skipped. only support polkadot/kusama`)
            return identityAddrs
        }
        if (chainID == paraTool.chainIDPolkadot) {
            sql = 'select address from account where info is not null;'
        } else if (chainID == paraTool.chainIDKusama) {
            sql = 'select address from account where infoKSM is not null;'
        }

        var knownAccts = await this.poolREADONLY.query(sql);
        for (const a of knownAccts) {
            identityAddrs.push({
                address: a.address
            })
        }
        return identityAddrs
    }

    async getOnchainIdentityList(chainID) {
        let identityAddrs = []
        if (chainID != paraTool.chainIDPolkadot && chainID != paraTool.chainIDKusama) {
            console.log(`skipped. only support polkadot/kusama`)
            return identityAddrs
        }
        let chain = await this.setupChainAndAPI(chainID);
        let keys = await this.api.query.identity.identityOf.keys()
        for (const key of keys) {
            let addr = paraTool.getPubKey(key.args.map((k) => k.toHuman())[0])
            identityAddrs.push({
                address: addr
            })
        }
        return identityAddrs
    }

    async updateOnChainIdentities(chainID, identityAddrs) {
        // step 0: only accept polkadot/kusama
        if (chainID != paraTool.chainIDPolkadot && chainID != paraTool.chainIDKusama) {
            console.log(`skipped. only support polkadot/kusama`)
        }

        // step 1: pass in a list of addrs from (query res)
        console.log(`[${chainID}] Input: identityAddrs[${identityAddrs.length}]`)

        //step 2: currl identity records
        // maintain two list (latest registry + removed)
        let identityRecs = []
        let removedRecs = []
        let chain = await this.setupChainAndAPI(chainID);
        for (const a of identityAddrs) {
            let [found, r] = await this.fetchOnchainIdentity(chainID, a.address)
            if (found) {
                //identityRecs.push(r)
                /*
                [0x08754abb6afba51a2f74f0b97bbcdb383f579a02a5e4541fee736710af562c6c] {
                address: '0x08754abb6afba51a2f74f0b97bbcdb383f579a02a5e4541fee736710af562c6c',
                judgements: [ { registrarIndex: 0, status: 'knownGood' } ],
                info: {
                  additional: [],
                  display: 'Parity',
                  legal: 'Parity Technologies (UK) Ltd',
                  web: 'https://parity.io/',
                  email: 'info@parity.io',
                  twitter: '@paritytech'
                  }
                }
                */
                let judgementsStr = mysql.escape(JSON.stringify(r.judgements))
                let infoStr = mysql.escape(JSON.stringify(r.info))
                var d = `('${r.address}', ${judgementsStr}, ${infoStr})`
                identityRecs.push(d)
            } else {
                removedRecs.push(r)
            }
        }


        if (chainID == paraTool.chainIDPolkadot) {
            console.log(`[Polkadot] current identityRecs[${identityRecs.length}]`, identityRecs)
            console.log(`[Polkadot] Removed identityRecs[${removedRecs.length}]`, removedRecs)
            let removedAddrList = `"` + removedRecs.join('","') + `"`
            let removevalSQL = `update account set info = null, judgements = null where address in (${removedAddrList})`
            console.log(removevalSQL);
            this.batchedSQL.push(removevalSQL);
            await this.update_batchedSQL();

            // step 3: update mysql tbl
            await this.upsertSQL({
                "table": "account",
                "keys": ["address"],
                "vals": ["judgements", "info"],
                "data": identityRecs,
                "replace": ["judgements", "info"],
            }, true);
        }

        if (chainID == paraTool.chainIDKusama) {
            console.log(`[Kusama] current identityRecs[${identityRecs.length}]`, identityRecs)
            console.log(`[Kusama] Removed identityRecs[${removedRecs.length}]`, removedRecs)
            let removedAddrList = `"` + removedRecs.join('","') + `"`
            let removevalSQL = `update account set infoKSM = null, judgementsKSM = null where address in (${removedAddrList})`
            console.log(removevalSQL);
            this.batchedSQL.push(removevalSQL);
            await this.update_batchedSQL();

            // step 3: update mysql tbl
            await this.upsertSQL({
                "table": "account",
                "keys": ["address"],
                "vals": ["judgementsKSM", "infoKSM"],
                "data": identityRecs,
                "replace": ["judgementsKSM", "infoKSM"],
            }, true);
        }
    }


    async getKnownSubIdentityList(chainID) {
        let sql = false;
        let subIdentityAddrs = []
        if (chainID != paraTool.chainIDPolkadot && chainID != paraTool.chainIDKusama) {
            console.log(`skipped. only support polkadot/kusama`)
            return subIdentityAddrs
        }
        if (chainID == paraTool.chainIDKusama) {
            sql = 'select address as subAddress from subaccount where parentKSM is not null;'
        } else if (chainID == paraTool.chainIDPolkadot) {
            sql = 'select address as subAddress from subaccount where parent is not null;'
        }

        var subaccounts = await this.poolREADONLY.query(sql);
        for (const suba of subaccounts) {
            subIdentityAddrs.push({
                subAddress: suba.subAddress
            })
        }
        return subIdentityAddrs
    }

    async getOnchainSubIdentityList(chainID) {
        let subIdentityAddrs = []
        if (chainID != paraTool.chainIDPolkadot && chainID != paraTool.chainIDKusama) {
            console.log(`skipped. only support polkadot/kusama`)
            return subIdentityAddrs
        }
        let chain = await this.setupChainAndAPI(chainID);
        let keys = await this.api.query.identity.superOf.keys()
        for (const key of keys) {
            let addr = paraTool.getPubKey(key.args.map((k) => k.toHuman())[0])
            subIdentityAddrs.push({
                subAddress: addr
            })
        }
        return subIdentityAddrs
    }

    async updateOnChainSubIdentities(chainID, subIdentityAddrs) {
        // step 0: only accept polkadot/kusama
        if (chainID != paraTool.chainIDPolkadot && chainID != paraTool.chainIDKusama) {
            console.log(`skipped. only support polkadot/kusama`)
        }

        // step 1: pass in a list of addrs from (query res)
        console.log(`[${chainID}] Input: subIdentityAddrs[${subIdentityAddrs.length}]`)

        //step 2: currl identity records
        // maintain two list (latest registry + removed)
        let subIdentityRecs = []
        let removedSubIdentityRecs = []
        let chain = await this.setupChainAndAPI(chainID);
        for (const a of subIdentityAddrs) {
            let [found, r] = await this.fetchOnchainSubIdentity(chainID, a.subAddress)
            if (found) {
                //identityRecs.push(r)
                /*
                [0x08754abb6afba51a2f74f0b97bbcdb383f579a02a5e4541fee736710af562c6c] {
                address: '0x08754abb6afba51a2f74f0b97bbcdb383f579a02a5e4541fee736710af562c6c',
                judgements: [ { registrarIndex: 0, status: 'knownGood' } ],
                info: {
                  additional: [],
                  display: 'Parity',
                  legal: 'Parity Technologies (UK) Ltd',
                  web: 'https://parity.io/',
                  email: 'info@parity.io',
                  twitter: '@paritytech'
                  }
                }
                */
                var d = `('${r.subAddress}', '${r.parentAddress}', '${r.subName}')`
                subIdentityRecs.push(d)
            } else {
                removedSubIdentityRecs.push(r)
            }
        }


        if (chainID == paraTool.chainIDPolkadot) {
            console.log(`[Polkadot] current subIdentityRecs[${subIdentityRecs.length}]`, subIdentityRecs)
            console.log(`[Polkadot] Removed subIdentityRecs[${removedSubIdentityRecs.length}]`, removedSubIdentityRecs)
            let removedAddrList = `"` + removedSubIdentityRecs.join('","') + `"`
            let removevalSQL = `update subaccount set parent = null, subName = null where address in (${removedAddrList})`
            console.log(removevalSQL);
            this.batchedSQL.push(removevalSQL);
            await this.update_batchedSQL();

            // step 3: update mysql tbl
            await this.upsertSQL({
                "table": "subaccount",
                "keys": ["address"],
                "vals": ["parent", "subName"],
                "data": subIdentityRecs,
                "replace": ["parent", "subName"],
            }, true);
        }

        if (chainID == paraTool.chainIDKusama) {
            console.log(`[Kusama] current subIdentityRecs[${subIdentityRecs.length}]`, subIdentityRecs)
            console.log(`[Kusama] Removed subIdentityRecs[${removedSubIdentityRecs.length}]`, removedSubIdentityRecs)
            let removedAddrList = `"` + removedSubIdentityRecs.join('","') + `"`
            let removevalSQL = `update subaccount set parentKSM = null, subNameKSM = null where address in (${removedAddrList})`
            console.log(removevalSQL);
            this.batchedSQL.push(removevalSQL);
            await this.update_batchedSQL();

            // step 3: update mysql tbl
            await this.upsertSQL({
                "table": "subaccount",
                "keys": ["address"],
                "vals": ["parentKSM", "subNameKSM"],
                "data": subIdentityRecs,
                "replace": ["parentKSM", "subNameKSM"],
            }, true);
        }

    }



    async fetchOnchainIdentity(chainID, addr) {
        let val = await this.api.query.identity.identityOf(addr)
        let decoratedVal = val.toString()
        let decoratedVal2 = JSON.stringify(val.toHuman())
        let identityRec = this.processIdentityVal(chainID, addr, decoratedVal, decoratedVal2)
        return identityRec
    }


    /*
      kusama: 1077
      polkadot: 486

      async getOnchainSubIdentityList(chainID) {
          if (chainID != paraTool.chainIDPolkadot && chainID != paraTool.chainIDKusama) {
              console.log(`skipped. only support polkadot/kusama`)
          }
          let chain = await this.setupChainAndAPI(chainID);
          let keys = await this.api.query.identity.subsOf.entries()
          let subIdentityAddrs = []
          for (const key of keys) {
              let addr = paraTool.getPubKey(key.args.map((k) => k.toHuman())[0])
              subIdentityAddrs.push({
                  address: addr
              })
          }
          return identityAddrs
      }

    */

    async fetchOnchainSubIdentity(chainID, subAddr) {
        let val = await this.api.query.identity.superOf(subAddr)
        let decoratedVal = val.toString()
        let decoratedVal2 = JSON.stringify(val.toHuman())
        let identityRec = this.processSubIdentityVal(chainID, subAddr, decoratedVal, decoratedVal2)
        return identityRec
    }

    processIdentityVal(chainID, addr, decoratedVal, decoratedVal2) {
        //console.log(`parsed [${addr}]`, decoratedVal)
        //can not differentiate cleared vs failed extrinsic - add both
        let identityRec = {
            address: addr,
            judgements: [],
            info: {},
        }
        try {
            if (decoratedVal == '') {
                //identity removed / failed to begin with
                console.log(`[${addr}] removed`)
                return [false, addr]
            }
            let v = JSON.parse(decoratedVal)
            let v2 = JSON.parse(decoratedVal2)

            //let v = ledec(val)
            //console.log(`parsed [${addr}]`, v)
            for (const j of v.judgements) {
                let registar = {
                    registrarIndex: j[0],
                    status: Object.keys(j[1])[0]
                }
                identityRec.judgements.push(registar)
            }

            let vInfo = v.info
            for (const fld of Object.keys(vInfo)) {
                if (chainID == paraTool.chainIDPolkadot) {
                    identityRec['info'].polkadotAddress = paraTool.getAddress(addr, paraTool.chainIDPolkadot)
                } else if (chainID == paraTool.chainIDKusama) {
                    identityRec['info'].kusamaAddress = paraTool.getAddress(addr, paraTool.chainIDKusama)
                }
                if (fld == 'additional') {
                    identityRec['info'].additional = v2.info.additional
                } else {
                    let vObj = vInfo[fld]
                    if (vObj === null) {
                        //identityRec['info'][fld] = 'Null'
                    } else if (vObj.raw != undefined) {
                        identityRec['info'][fld] = paraTool.hexToString(vObj.raw)
                    } else if (vObj.none === null) {
                        //identityRec['info'][fld] = 'None'
                    } else {
                        let vObjKey = Object.keys(vObj)[0]
                        let vObjVal = vObj[vObjKey]
                        identityRec['info'][fld] = {
                            type: vObjKey,
                            val: vObjVal,
                        }
                    }
                }
            }
        } catch (e) {
            console.log(`processIdentityVal err decoratedVal=${decoratedVal}, err=`, e)
        }
        console.log(`[${addr}] rec`, identityRec)
        return [true, identityRec]
    }


    processSubIdentityVal(chainID, subAddr, decoratedVal, decoratedVal2) {
        //console.log(`parsed [${addr}]`, decoratedVal)
        //can not differentiate cleared vs failed extrinsic - add both
        let subIdentityRec = {
            parentAddress: null,
            subAddress: subAddr,
            subName: null,
        }
        try {
            if (decoratedVal == '') {
                //identity removed / failed to begin with
                console.log(`subIdentity [${subAddr}] removed`)
                return [false, subAddr]
            }
            let v = JSON.parse(decoratedVal)
            let v2 = JSON.parse(decoratedVal2)

            subIdentityRec.parentAddress = paraTool.getPubKey(v2[0])
            let nameFld = v2[1]
            for (const fld of Object.keys(nameFld)) {
                if (fld == 'Raw') {
                    subIdentityRec.subName = `${nameFld[fld]}`
                } else {
                    subIdentityRec.subName = `${nameFld[fld]} (${fld})`
                }
            }
            //console.log(`parsed [${subAddr}]`, v)

        } catch (e) {
            console.log(`processSubIdentityVal err decoratedVal=${decoratedVal}, err=`, e)
        }
        if (subIdentityRec.subName != undefined) {
            subIdentityRec.subName = subIdentityRec.subName.replaceAll("'", "_")
        }
        console.log(`[${subAddr}] rec`, subIdentityRec)
        return [true, subIdentityRec]
    }

    async getKnownProxyList(chainID) {
        let sql = false;
        let proxyAddrs = []
        /*
        if (chainID != paraTool.chainIDPolkadot && chainID != paraTool.chainIDKusama) {
            console.log(`skipped. only support polkadot/kusama`)
            return identityAddrs
        }
        */
        sql = `select address, delegate from proxyaccount where chainID=${chainID};`
        var knownProxyAccts = await this.poolREADONLY.query(sql);
        var knownProxyAcctsMap = {}
        for (const a of knownProxyAccts) {
            if (knownProxyAcctsMap[a.address] == undefined) {
                knownProxyAcctsMap[a.address] = {
                    address: a.address,
                    delegates: [],
                }
            }
            knownProxyAcctsMap[a.address].delegates.push(a.delegate)
        }
        for (const p of Object.keys(knownProxyAcctsMap)) {
            proxyAddrs.push(knownProxyAcctsMap[p])
        }
        return proxyAddrs
    }

    async getOnchainProxyList(chainID) {
        let proxyAddrs = []
        /*
        if (chainID != paraTool.chainIDPolkadot && chainID != paraTool.chainIDKusama) {
            console.log(`skipped. only support polkadot/kusama`)
            return identityAddrs
        }
        */
        let chain = await this.setupChainAndAPI(chainID);
        let keys = await this.api.query.proxy.proxies.keys()
        for (const key of keys) {
            let addr = paraTool.getPubKey(key.args.map((k) => k.toHuman())[0])
            proxyAddrs.push({
                address: addr,
                delegates: [],
            })
        }
        return proxyAddrs
    }


    async updateOnChainProxy(chainID, proxyAddrs) {
        // step 0: get header
        let [currentBN, currentBlockHash] = await this.getHeader(chainID)
        if (!currentBN || !currentBlockHash) {
            console.log('terminated!!')
            return
        }
        // step 1: pass in a list of addrs from (query res)
        console.log(`[${chainID}] Input: proxyAddrs[${proxyAddrs.length}]`)

        //step 2: currl identity records
        // maintain two list (latest registry + removed)
        let proxyRecs = []
        let fullyRemovedProxyAddrs = []
        let removedProxySQL = []
        let chain = await this.setupChainAndAPI(chainID);
        for (const p of proxyAddrs) {
            let proxyAddr = p.address
            let [found, r] = await this.fetchOnchainProxy(chainID, proxyAddr, p.delegates, currentBlockHash)
            if (found) {
                console.log(`found proxy addr=${proxyAddr}`, r)
                for (const dl of r.delegates) {
                    let delegatePieces = dl.split('|')
                    var d = `('${chainID}', '${proxyAddr}', '${delegatePieces[1]}', '${delegatePieces[2]}', '${delegatePieces[3]}', '${currentBN}','${currentBN}')`
                    proxyRecs.push(d)
                }
                if (r.removed.length > 0) {
                    let removedDelegateList = `"` + r.removed.join('","') + `"`
                    console.log(`[partially removed] proxy addr=${proxyAddr}. removedAddr=${removedDelegateList}`)
                    let removevalSQL = `delete from proxyaccount where address = '${proxyAddr}' and delegates in (${removedDelegateList}) and chainID = ${chainID}`
                    removedProxySQL.push(removevalSQL)
                    this.batchedSQL.push(removevalSQL);
                }
            } else {
                console.log(`[fully removed] proxy addr=${proxyAddr}`)
                fullyRemovedProxyAddrs.push(proxyAddr)
            }
        }

        if (fullyRemovedProxyAddrs.length > 0) {
            let removedProxyList = `"` + fullyRemovedProxyAddrs.join('","') + `"`
            console.log(`[Fully removed] removedProxyList=${removedProxyList}`)
            let removevalSQL = `delete from proxyaccount where address in (${removedProxyList}) and chainID = ${chainID}`
            removedProxySQL.push(removevalSQL)
            this.batchedSQL.push(removevalSQL);
        }

        await this.upsertSQL({
            "table": "proxyaccount",
            "keys": ["chainID", "address", "delegate"],
            "vals": ["proxyType", "delay", "lastUpdateBN", "lastCrawlBN"],
            "data": proxyRecs,
            "replace": ["proxyType", "delay", "lastUpdateBN", "lastCrawlBN"],
        }, true);

        await this.update_batchedSQL();

    }


    async fetchOnchainProxy(chainID, addr, knownDelegates = [], currentBlockHash = false) {
        //console.log(`fetchOnchainProxy addr=${addr}`)
        let isFound = false
        let proxyRec = {
            address: addr,
            delegates: [],
            removed: [],
        }
        try {
            let val
            if (currentBlockHash) {
                //TODO..
                val = await this.api.query.proxy.proxies(addr)
            } else {
                val = await this.api.query.proxy.proxies(addr)
            }
            let decoratedVal = val.toString()
            let [recFound, currProxyRec] = this.processProxyVal(chainID, addr, knownDelegates, decoratedVal)
            isFound = recFound
            proxyRec = currProxyRec
        } catch (e) {
            console.log(`fetchOnchainProxy addr=${addr} err:`, e.toString())
            return [false, proxyRec]
        }
        return [isFound, proxyRec]
    }

    /*
    //HBVw5bpPWs3qwLq88YyovrXYDj6SUJvTwJ1oZi3J7JUwLx5 (0xcbc5959dbf516891fb1a22f198c9c0bc4b47e29df44d5f060240e3099e57ff1e)
    [
      [
        {
          delegate: 'ELue9okRW6cgRy1E5yP6zCvjvDvyr2WXCkzk3xmRk9qEFVW',
          proxyType: 'Governance',
          delay: 0
        },
        {
          delegate: 'Edyfdyoi4KJVdXUJ3SU3nuZYMpg13HHa1SWYtPDCV8UPdxy',
          proxyType: 'Staking',
          delay: 0
        },
        {
          delegate: 'HDVkVT2SyjEMxv4QWSuymAkoRigthkAn3fQeiSb56QBeXfZ',
          proxyType: 'Any',
          delay: 0
        }
      ],
      67023329100
    ]
    */
    processProxyVal(chainID, addr, knownDelegates = [], decoratedVal) {
        //console.log(`parsed [${addr}]`, decoratedVal)
        let proxyRec = {
            address: addr,
            delegates: [],
            removed: [],
        }
        let foundDelegates = {}
        try {
            if (decoratedVal == '[[],0]') {
                //identity removed
                console.log(`[${addr}] removed`)
                proxyRec.removed = knownDelegates
                return [false, proxyRec]
            }
            let v = JSON.parse(decoratedVal)
            let delegatesArr = v[0]
            let reservedBal = paraTool.dechexToInt(v[1])
            for (const d of delegatesArr) {
                let delegateAddr = d['delegate']
                let delegatePub = paraTool.getPubKey(delegateAddr)
                let delay = paraTool.dechexToInt(d['delay'])
                let delegateStr = `${delegateAddr}|${delegatePub}|${d['proxyType']}|${delay}`
                proxyRec.delegates.push(delegateStr)
                foundDelegates[delegatePub] = 1
            }
            for (const kd of knownDelegates) {
                if (!foundDelegates[kd]) {
                    // has been removed
                    proxyRec.removed.push(kd)
                } else {
                    console.log(`kd ${kd} found for ${addr}`)
                }
            }
        } catch (e) {
            console.log(`processIdentityVal err decoratedVal=${decoratedVal}, err=`, e)
        }
        console.log(`[${addr}]`, proxyRec)
        return [true, proxyRec]
    }

}