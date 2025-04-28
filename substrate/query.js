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

const AssetManager = require("./assetManager");
const paraTool = require("./paraTool");
const btTool = require("./btTool");
const ethTool = require("./ethTool");
const mysql = require("mysql2");
const uiTool = require('./uiTool')
const assetAndPriceFeedTTL = 300; // how long the data stays cached
const {
    AML
} = require('elliptic-sdk');


module.exports = class Query extends AssetManager {
    debugLevel = paraTool.debugNoLog;

    constructor(debugLevel = paraTool.debugNoLog) {
        super()

        if (debugLevel) {
            this.debugLevel = debugLevel;
        }
    }

    async init() {
        await this.assetManagerInit()
        this.contractABIs = await this.getContractABI();
        return (true);
    }

    async setupQueryChainAndAPI(chainID, withSpecVersions = true, backfill = false) {
        let chain = await this.getChainWithVersion(chainID, withSpecVersions);
        await this.setupAPI(chain, backfill);
        this.relayChain = chain.relayChain;
        return (chain);
    }

    // this supports reloading of chains/assets/specVersions every 15m
    async autoUpdate(intervalSeconds = 900) {
        while (1) {
            await this.sleep(intervalSeconds * 1000);
            console.log("query autoUpdating...")
            await this.init();
        }
    }
    async checkAPIKey(apikey) {
        let minkey = this.currentMinuteKey();
        let ratekey = `rate:${minkey}`;
        let ratelimit = 300;
        let usage = 0;
        try {
            const [row] = await this.btAPIKeys.row(apikey).get([ratekey, "n"]);
            if (row["n"] && row["n"]["ratelimit"]) {
                let x = row["n"]["ratelimit"];
                ratelimit = parseInt(x[0].value, 10);
            }
            if (row["rate"] && row["rate"][minkey]) {
                let y = row["rate"][minkey];
                if (y.length > 0) {
                    usage = y[0].value;
                }
            }
            //console.log("checkAPIKey", apikey, "usage", usage, "ratelimit", ratelimit);
            if (usage < ratelimit) {
                return ({
                    "success": true
                });
            } else {
                return ({
                    "error": "rate limit exceeded",
                    "code": 429
                });
            }
        } catch (e) {
            if (e.code == 404) {
                //console.log("checkAPIKey 404", apikey)
                return ({
                    "success": true
                });
            } else {
                return ({
                    "error": "general error",
                    "code": 401
                });
            }
        }

    }

    currentMinuteKey() {
        let today = new Date();
        let dd = today.getUTCDate().toString().padStart(2, '0');
        let mm = String(today.getUTCMonth() + 1).padStart(2, '0'); //January is 0!
        let yyyy = today.getUTCFullYear();
        let hr = today.getUTCHours().toString().padStart(2, "0");
        let min = today.getUTCMinutes().toString().padStart(2, "0");
        return `${yyyy}${mm}${dd}-${hr}${min}`;
    }

    async tallyAPIKey(apikey, cnt = 1) {
        // increment "rate" cell
        try {
            let minkey = this.currentMinuteKey();
            let ratekey = `rate:${minkey}`;
            const row = this.btAPIKeys.row(apikey);
            await row.increment(ratekey, cnt);
            return (true);
        } catch (e) {
            console.log(e);
        }
        return (true);
    }


    canonicalizeEmail(e) {
        return e.trim().toLowerCase();
    }

    getPasswordHash(h) {
        let SALT = (process.env.POLKAHOLIC_SALT != undefined) ? process.env.POLKAHOLIC_SALT : "";
        return uiTool.blake2(`${SALT}${h}`)
    }

    create_api_key(email) {
        let ts = Math.floor(Date.now() / 1000)
        let raw = uiTool.blake2(email + ts.toString());
        raw = raw.substring(2, 34);
        return (raw);
    }

    async userExists(email) {
        var sql = `select password from user where email = '${email}' limit 1`;
        let users = await this.poolREADONLY.query(sql);
        return (users.length > 0)
    }

    async getRuntimeExtrinsics(chain) {
        var sql = `select section, method, numStars, numExtrinsics, numExtrinsics30d, numExtrinsics7d from extrinsics where chainID = '${chain.chainID}' order by section, method`;
        let extrinsics = await this.poolREADONLY.query(sql);
        return (extrinsics);
    }

    async getRuntimeEvents(chain) {
        var sql = `select section, method, numStars, numEvents, numEvents30d, numEvents7d from events where chainID = '${chain.chainID}' order by section, method`;
        let events = await this.poolREADONLY.query(sql);
        return events;
    }

    resetPasswordSig(toMail, ts) {
        let h = ts + toMail + this.POLKAHOLIC_EMAIL_PASSWORD;
        let sig = uiTool.blake2(h);
        return sig;
    }

    async getAssethubPools(assets) {
        let sql = `select * from assethubpools` // TODO: filter by assets

        try {
            let pools = await this.poolREADONLY.query(sql);
            return pools
        } catch (err) {
            console.log(err);
            return [];
        }
    }

    async getAssethubLog(asset, against, timeframe) {
        let w = ''
        switch (timeframe) {
            case 'day':
                w = ` and indexTS > UNIX_TIMESTAMP(Now()) - 3600*48`;
                break;
            case 'week':
                w = ` and indexTS > UNIX_TIMESTAMP(Now()) - 86400*8`;
                break;
            case 'month':
                w = ` and indexTS > UNIX_TIMESTAMP(Now()) - 86400*31`;
                break;
            case 'all':
                w = ` and indexTS > UNIX_TIMESTAMP(Now()) - 86400*365`;
                break;
        }
        try {
            let sql = `select * from assethublog where asset = ${mysql.escape(asset)} ${w}` // filter by timeframe
            console.log(sql)
            let log = await this.poolREADONLY.query(sql);
            return log;
        } catch (err) {
            console.log(err);
            return [];
        }
    }

    async sendResetPasswordLink(toMail) {
        // include nodemailer
        const nodemailer = require('nodemailer');
        // declare vars
        let fromMail = 'info@polkaholic.io';

        let subject = 'Polkaholic.io Password Reset';
        let ts = new Date().getTime().toString();
        let sig = this.resetPasswordSig(toMail, ts);
        let RESETURL = `http://polkaholic.io/resetpassword/${toMail}/${ts}/${sig}`
        let text = `To reset your password on Polkaholic click this link:\r\n${RESETURL}`;

        // auth
        var transporter = nodemailer.createTransport({
            service: 'Godaddy',
            secureConnection: false,
            auth: {
                user: this.POLKAHOLIC_EMAIL_USER,
                pass: this.POLKAHOLIC_EMAIL_PASSWORD
            }
        });

        // email options
        let mailOptions = {
            from: fromMail,
            to: toMail,
            subject: subject,
            text: text
        };

        // send email
        transporter.sendMail(mailOptions, (error, response) => {
            if (error) {
                console.log(error);
            }
        });
    }

    async resetPassword(email, password, ts, sig) {
        let expectedSig = this.resetPasswordSig(email, ts);
        if (sig != expectedSig) return ({
            error: "Could not reset password"
        });

        var passwordHash = this.getPasswordHash(password)
        let sql = `update user set password = ${mysql.escape(passwordHash)} where email = ${mysql.escape(email)}`;
        try {
            this.batchedSQL.push(sql);
            await this.update_batchedSQL();
            return ({
                success: true
            });
        } catch (e) {
            this.logger.error({
                "op": "query.resetPassword",
                sql,
                e
            });
            return ({
                error: "Could not reset password"
            });
        }
    }

    // create table dedsnapshot ( address_ss58 varchar(67), address_pubkey varchar(67), free varchar(64), locked varchar(64), reserved varchar(64), total varchar(64), primary key (address_ss58) )
    async getDEDSnapshot(accountID) {
        try {
            let sql0 = `select address_ss58, address_pubkey, total from dedsnapshot where address_ss58 = ${mysql.escape(accountID)} or address_pubkey = ${mysql.escape(accountID)} limit 1`
            console.log(sql0);
            let recs = await this.poolREADONLY.query(sql0)
            if (recs.length > 0) {
                return recs[0];
            }
            return (null);
        } catch (e) {
            console.log(e);
            return (null);
        }
    }

    async unfollowUser(rawFromAddress, rawToAddress) {
        try {
            let fromAddress = paraTool.getPubKey(rawFromAddress)
            let toAddress = paraTool.getPubKey(rawToAddress)
            // TODO: validate fromAddress + toAddress
            // check that we are following the user already
            let sql0 = `select isFollowing from follow where fromAddress = '${fromAddress}' and toAddress = '${toAddress}'`
            let isFollowing = await this.poolREADONLY.query(sql0)
            if (isFollowing.length > 0) {
                // TODO: make this a transaction
                var sql = `delete from follow where fromAddress = ${mysql.escape(fromAddress)} and toAddress = ${mysql.escape(toAddress)}`
                var sql2 = `update account set numFollowing = numFollowing - 1 where address = ${mysql.escape(fromAddress)}`
                var sql3 = `update account set numFollowers = numFollowers - 1 where address = ${mysql.escape(toAddress)}`
                this.batchedSQL.push(sql);
                this.batchedSQL.push(sql2);
                this.batchedSQL.push(sql3);
                await this.update_batchedSQL();
                return ({
                    success: true
                });
            } else {
                return ({
                    error: "not following"
                });
            }
        } catch (e) {
            this.logger.error({
                "op": "query.followUser",
                rawFromAddress,
                rawToAddress,
                err
            });

            return ({
                error: "Could not unfollow user"
            });
        }
    }

    async getFollowers(rawToAddress, rawUserAddress = false, decorate = true, decorateExtra = ["data", "address", "usd", "related"]) {
        try {
            let [decorateData, decorateAddr, decorateUSD, decorateRelated] = this.getDecorateOption(decorateExtra)

            let toAddress = paraTool.getPubKey(rawToAddress)
            var sql = `select fromAddress, 0 as isFollowing from follow where toAddress = '${toAddress}' order by followDT desc limit 500`
            let followers = await this.poolREADONLY.query(sql);
            if (rawUserAddress) {
                let isFollowing = {};
                let userAddress = paraTool.getPubKey(rawUserAddress)

                let sql0 = `select toAddress from follow where fromAddress = '${userAddress}' limit 500`
                let userFollowing = await this.poolREADONLY.query(sql0);
                for (let i = 0; i < userFollowing.length; i++) {
                    let u = userFollowing[i];
                    isFollowing[u.toAddress] = 1;
                }
                for (let i = 0; i < followers.length; i++) {
                    if (decorate) this.decorateAddress(followers[i], "toAddress", decorateAddr, decorateRelated);
                    if (isFollowing[followers[i].toAddress] !== undefined) {
                        followers[i].isFollowing = 1;
                    }
                }
                return (followers);
            }
        } catch (err) {
            this.logger.error({
                "op": "query.getFollowers",
                rawToAddress,
                rawUserAddress,
                err
            });
        }
        return [];
    }

    async getFollowing(rawFromAddress, rawUserAddress = false, decorate = true, decorateExtra = ["data", "address", "usd", "related"]) {
        try {
            let [decorateData, decorateAddr, decorateUSD, decorateRelated] = this.getDecorateOption(decorateExtra)

            let fromAddress = paraTool.getPubKey(rawFromAddress)
            var sql = `select toAddress, 0 as isFollowing from follow where fromAddress = '${fromAddress}' order by followDT desc limit 500`
            let following = await this.poolREADONLY.query(sql);
            let isFollowing = {};
            if (rawUserAddress) {
                let userAddress = paraTool.getPubKey(rawUserAddress)
                let sql0 = `select toAddress from follow where fromAddress = '${userAddress}' limit 500`
                let userFollowing = await this.poolREADONLY.query(sql0);
                for (let i = 0; i < userFollowing.length; i++) {
                    let u = userFollowing[i];
                    isFollowing[u.toAddress] = 1;
                }
                for (let i = 0; i < following.length; i++) {
                    if (decorate) this.decorateAddress(following[i], "toAddress", decorateAddr, decorateRelated);
                    if (isFollowing[following[i].toAddress] !== undefined) {
                        following[i].isFollowing = 1;
                    }
                }
            }
            return (following);
        } catch (err) {
            console.log(err);
            this.logger.error({
                "op": "query.getFollowers",
                rawFromAddress,
                rawUserAddress,
                err
            });
            return [];
        }
        return [];
    }


    async getCountryCode(ip) {
        const maxmind = require('maxmind');
        const dbPath = "/root/go/src/github.com/jam-duna/polkadot-etl/substrate/GeoLite2-Country.mmdb";
        try {
            const lookup = await maxmind.open(dbPath);
            const geoData = lookup.get(ip);
            if (geoData && geoData.country && geoData.country.iso_code === 'US') {
                return (geoData.country.iso_code);
            }
        } catch (error) {
            console.log(error);
        }
        return "UN";
    }

    async storeAMLCheck(address, appkey, ip) {
        try {
            let countryCode = await this.getCountryCode(ip);
            var sql = `insert into amlcheck ( address, appkey, countryCode, ip, firstCheckDT, lastCheckDT ) values (${mysql.escape(address)}, ${mysql.escape(appkey)}, ${mysql.escape(countryCode)}, ${mysql.escape(ip)}, Now(), Now() ) on duplicate key update lastCheckDT = values(lastCheckDT), countryCode = values(countryCode), ip = values(ip)`
            this.batchedSQL.push(sql);
            await this.update_batchedSQL();
            return {
                ok: true
            };
        } catch (err) {
            return {
                ok: true,
                err
            };
        }
        let valid = false;
        try {
            if (address.length == 66) {
                let pubkey = address;
                address = this.getSS58ByChainID(pubkey)
            } else {
                let pubkey = paraTool.getPubKey(address);
                if (pubkey === false) {
                    return {
                        ok: false
                    };
                }
            }
            valid = true;
        } catch (error) {
            return {
                ok: false
            };
        }
        let risk_score = null;

        try {
            const requestBody = {
                subject: {
                    asset: 'holistic',
                    blockchain: 'holistic',
                    type: 'address',
                    hash: address
                },
                type: 'wallet_exposure',
                customer_reference: `dotswap`
            };
            const {
                client
            } = new AML({
                key: "898e8e5e5c94671f05cff4a4379f38a4",
                secret: "79192527758b87f458f614c310e3650c"
            });
            const response = await client.post('/v2/wallet/synchronous', requestBody);

            if (response.data.risk_score) {
                risk_score = response.data.risk_score;
            }
            var sql = `insert into amlcheck ( address, appkey, ip, numchecks, amlcheck, risk_score, firstCheckDT, lastCheckDT ) values (${mysql.escape(address)}, ${mysql.escape(appkey)}, ${mysql.escape(ip)}, 1, ${mysql.escape(JSON.stringify(response.data))}, ${mysql.escape(risk_score)}, Now(), Now() ) on duplicate key update numchecks = numchecks + values(numchecks), lastCheckDT = values(lastCheckDT)`
            this.batchedSQL.push(sql);
            await this.update_batchedSQL();
            if (risk_score > 0) {
                return ({
                    ok: false,
                    risk_score,
                    description: response.data
                });
            } else {
                return ({
                    ok: true,
                    risk_score,
                    description: response.data
                });
            }
        } catch (e) {
            if (e.response.status === 404) {
                var sql = `insert into amlcheck ( address, appkey, ip, numchecks, amlcheck, risk_score, firstCheckDT, lastCheckDT ) values (${mysql.escape(address)}, ${mysql.escape(appkey)}, ${mysql.escape(ip)}, 1, ${mysql.escape(JSON.stringify({"err":404}))}, ${mysql.escape(risk_score)}, Now(), Now() ) on duplicate key update numchecks = numchecks + values(numchecks), lastCheckDT = values(lastCheckDT)`
                this.batchedSQL.push(sql);
                await this.update_batchedSQL();
                return ({
                    ok: true,
                    risk_score,
                    description: "404-not found"
                });
            } else {
                var sql = `insert into amlcheck ( address, appkey, ip, numchecks, amlcheck, risk_score, firstCheckDT, lastCheckDT ) values (${mysql.escape(address)}, ${mysql.escape(appkey)}, ${mysql.escape(ip)}, 1, ${mysql.escape(JSON.stringify({"err":e}))}, ${mysql.escape(risk_score)}, Now(), Now() ) on duplicate key update numchecks = numchecks + values(numchecks), lastCheckDT = values(lastCheckDT)`
                this.batchedSQL.push(sql);
                await this.update_batchedSQL();
                return ({
                    ok: false,
                    risk_score: null,
                    description: e
                });
            }
        }
    }

    async registerUser(email, password) {
        email = this.canonicalizeEmail(email);
        if (!uiTool.validEmail(email)) {
            return ({
                error: `Invalid email: ${email}`
            });
        }
        if (!uiTool.validPassword(password)) {
            return ({
                error: "Invalid password (must be 6 chars or more)"
            });
        }
        let userAlreadyExists = await this.userExists(email);
        if (userAlreadyExists) {
            return ({
                error: "User already exists."
            });
        }
        var passwordHash = this.getPasswordHash(password)
        try {
            var sql = `insert into user ( email, password, createDT ) values (${mysql.escape(email)}, ${mysql.escape(passwordHash)}, Now() )`
            this.batchedSQL.push(sql);
            await this.update_batchedSQL();
            return ({
                success: true
            });
        } catch (e) {
            this.logger.error({
                "op": "query.registerUser",
                email,
                passwordHash,
                err
            });
            return ({
                error: "Could not register user"
            });
        }
    }

    async validateUser(email, password) {
        let passwordHash = this.getPasswordHash(password)
        try {
            var sql = `select password from user where email = '${email}' limit 1`;
            let users = await this.poolREADONLY.query(sql);
            if (users.length == 0) {
                return {
                    error: "Email not found"
                };
            }
            if (users.length == 1 && (users[0].password != passwordHash)) {
                return {
                    error: "Password incorrect"
                };
            }
            return ({
                success: true
            });
        } catch (err) {
            this.logger.error({
                "op": "query.validateUser",
                email,
                passwordHash,
                err
            });
            return ({
                error: "Could not validate your account"
            })
        }
    }

    async updateAPIKeyPlan(email, apikey, planID) {
        // TODO with stripe
        try {
            // update bigtable with new PlanID
            let ratelimit = this.getPlanRateLimit(planID);
            let nrec = {};
            nrec["ratelimit"] = {
                value: JSON.stringify(ratelimit),
                timestamp: new Date()
            };
            let rowsToInsert = [{
                key: apikey,
                data: {
                    n: nrec
                }
            }];
            await this.btAPIKeys.insert(rowsToInsert);

            var sql = `update apikey set planID = ${mysql.escape(planID)} where email = ${mysql.escape(email)} and apikey = ${mysql.escape(apikey)}`;
            this.batchedSQL.push(sql);
            await this.update_batchedSQL();
            return (true);
        } catch (err) {
            this.logger.error({
                "op": "query.updateAPIKeyPlan",
                email,
                apikey,
                err
            });
            return (false);
        }
    }

    getAPIKeyPlan(loggedInEmail, apikey) {}
    async getAPIKeys(email) {
        var sql = `select apikey, createDT, planID from apikey where email = '${email}' and deleted = 0 limit 100`;
        try {
            let apikeys = await this.poolREADONLY.query(sql);
            return (apikeys);
        } catch (e) {
            this.logger.error({
                "op": "query.getAPIKeys",
                email,
                apikey,
                err
            });
            return (false);
        }
    }

    // # of request allowed per minute
    getPlanRateLimit(planID) {
        switch (planID) {
            case 1:
                return (1200); // 20 QPS
            case 2:
                return (6000); // 100 QPS
            case 3:
                return (30000); // 500 QPS
            default:
                return (300); // 5 QPS
        }
    }

    getPlans() {
        return [{
            name: "Developer",
            monthlyUSD: 0,
            minuteLimit: this.getPlanRateLimit(0)
        }, {
            name: "Lite",
            monthlyUSD: 199,
            minuteLimit: this.getPlanRateLimit(1)
        }, {
            name: "Pro",
            monthlyUSD: 399,
            minuteLimit: this.getPlanRateLimit(2)
        }, {
            name: "Enterprise",
            monthlyUSD: 1999,
            minuteLimit: this.getPlanRateLimit(3)
        }];
    }

    async createAPIKey(email, planID = 0) {
        let apikey = this.create_api_key(email)
        var sql = `insert into apikey (email, apikey, createDT) values (${mysql.escape(email)}, ${mysql.escape(apikey)}, Now())`;
        try {
            // update bigtable
            let ratelimit = this.getPlanRateLimit(planID);
            console.log(apikey, planID, ratelimit);
            let nrec = {};
            nrec["ratelimit"] = {
                value: JSON.stringify(ratelimit),
                timestamp: new Date()
            };
            let rowsToInsert = [{
                key: apikey,
                data: {
                    n: nrec
                }
            }];
            this.batchedSQL.push(sql);
            await this.update_batchedSQL();
            await this.btAPIKeys.insert(rowsToInsert);
            return ({
                success: true,
                apikey: apikey
            })
        } catch (err) {
            this.logger.error({
                "op": "query.createAPIKey",
                email,
                sql,
                err
            });
            return ({
                error: "Could not create API Key"
            });
        }
    }

    async deleteAPIKey(email, apikey) {
        var sql = `update apikey set deleted = 1, deleteDT = Now() where email = ${mysql.escape(email)} and apikey = ${mysql.escape(apikey)}`;
        try {
            this.batchedSQL.push(sql);
            await this.update_batchedSQL();
            return ({
                success: true
            })
        } catch (e) {
            this.logger.error({
                "op": "query.deleteAPIKey",
                email,
                sql,
                err
            });
            return ({
                error: "Could not delete API Key"
            });
        }
    }

    async search_address(addr) {
        let res = [];
        try {
            let [tblName, tblRealtime] = this.get_btTableRealtime()
            // TODO: use getRow?
            let [rows] = await tblRealtime.getRows({
                keys: [addr]
            });
            rows.forEach((row) => {
                let rowData = row.data;
                if (rowData["wasmcontract"]) {
                    for (const chainID of Object.keys(rowData["wasmcontract"])) {
                        let cells = rowData["wasmcontract"][chainID]
                        let cell = cells[0];
                        let c = JSON.parse(cell.value);
                        if (c && c.address) {
                            // TODO: adjust description based on PSP22, ... contractType features
                            res.push({
                                link: `/wasmcontract/${c.address}/${c.chainID}`,
                                text: "WASM Contract: " + c.address,
                                description: `ChainID: ${c.chainID} Deployer: ${c.deployer}`
                            })
                        }
                    }
                } else if (rowData["evmcontract"]) {
                    for (const chainID of Object.keys(rowData["evmcontract"])) {
                        let cells = rowData["evmcontract"][chainID]
                        let cell = cells[0];
                        let c = JSON.parse(cell.value);
                        if (c && c.asset) {
                            // TODO: adjust text/description based on ERC20, ERC721, ERC1155 assetType data
                            console.log("SEARCH RES", c);
                            let [__, id] = this.convertChainID(c.chainID)
                            let chainName = this.getChainName(c.chainID);
                            let description = `Chain ID: ${c.chainID} ${chainName}`
                            let paraID = paraTool.getParaIDfromChainID(chainID)
                            if (paraID > 0) {
                                description += ` ParaID: ${paraID}`;
                            }
                            if (c.symbol) {
                                description += ` ${c.symbol}`
                            }
                            res.push({
                                link: `/address/${c.asset}/${c.chainID}`,
                                text: "EVM Contract: " + c.asset,
                                description: description,
                                numHolders: c.numHolders
                            })
                        }
                    }
                } else {
                    if (addr.length == 42) {
                        res.push({
                            link: "/address/" + addr,
                            text: addr,
                            description: "Address"
                        })
                    } else {
                        res.push({
                            link: "/account/" + addr,
                            text: addr,
                            description: "Address"
                        })
                    }
                }
            });
        } catch (err) {
            if (err.code == 404) {
                return res;
            } else {
                this.logger.error({
                    "op": "query.search_address",
                    addr,
                    err
                });
            }
        }
        return res;
    }

    getChainInfo(chainID = paraTool.chainIDPolkadot) {
        return this.getChainFullInfo(chainID)
    }

    redirect_search_block(hash, blockcells, res = []) {
        let cell = blockcells[0];
        let feed = JSON.parse(cell.value);
        if (feed) {
            let chainID = feed.chainID;
            let blockNumber = feed.blockNumber;
            if (blockNumber) {
                // send users to eg /block/0/9963670?blockhash=0xcf10b0c43f5c87de7cb9b3c0be6187097bd936bde19bd937516482ac01a8d46f
                res.push({
                    type: "block",
                    blockNumber: blockNumber,
                    chainID: chainID,
                    link: `/block/${chainID}/${blockNumber}?blockhash=${hash}`,
                    text: `chain: ${chainID} blockNumber: ${blockNumber} hash: ${hash}`,
                    description: this.getChainName(chainID) + " Block " + blockNumber + " : " + hash
                })
            }
        }
    }

    redirect_search_stateroot(hash, blockcells, res = []) {
        let cell = blockcells[0];
        let feed = JSON.parse(cell.value);
        if (feed) {
            let blockHash = feed.blockHash
            let chainID = feed.chainID;
            let blockNumber = feed.blockNumber;
            if (blockNumber) {
                // send users to eg /block/0/9963670?blockhash=0xcf10b0c43f5c87de7cb9b3c0be6187097bd936bde19bd937516482ac01a8d46f
                res.push({
                    type: "stateroot",
                    chainID: chainID,
                    blockNumber: blockNumber,
                    link: `/block/${chainID}/${blockNumber}?blockhash=${blockHash}`,
                    text: `chain: ${chainID} blockNumber: ${blockNumber} hash: ${blockHash}`,
                    description: this.getChainName(chainID) + " Block " + blockNumber + " : " + blockHash
                })
            }
        }
    }

    // send users to eg /xcmmessage/{msgHash}
    redirect_search_xcmmessage(search, cells, res = []) {
        let cell = cells[0];
        let m = JSON.parse(cell.value);
        if (m && m.msgHash) {
            res.push({
                type: "xcmmessage",
                chainID: m.chainID,
                blockNumber: m.blockNumber,
                link: `/xcmmessage/${m.msgHash}/${m.sentAt}`,
                text: `hash: ${m.msgHash} sentAt: ${m.sentAt} relay chain: ${m.relayChain}`,
                description: this.getChainName(m.chainID) + " Block " + m.blockNumber + ` : block time: ${m.blockTS} `
            })
        }
    }

    // send users to eg /chain/{id}
    redirect_search_chain(search, cells, res = []) {
        let cell = cells[0];
        let c = JSON.parse(cell.value);
        if (c && (c.chainID != undefined)) {
            let chainID = c.chainID;
            res.push({
                link: `/blocks/${c.id}`,
                text: `${c.chainName}`,
                description: `chainID: ${c.chainID} id: ${c.id} para ID: ${c.paraID} relay chain: ${c.relayChain}`,
                numHolders: c.numHolders
            })
        }
    }

    // send users to eg /chain/{id}
    redirect_search_symbol(search, cells, res = []) {
        let cell = cells[0];
        let c = JSON.parse(cell.value);
        if (c && c.symbol) {
            res.push({
                link: `/symbol/${c.symbol}`,
                text: `${c.symbol}`,
                description: `relay chain: ${c.relayChain}`,
                numHolders: c.numHolders
            })
        }
    }

    // send users to eg /wasmcode/{codeHash}
    redirect_search_wasmcode(hash, cells, res = []) {
        let cell = cells[0];
        let c = JSON.parse(cell.value);
        if (c && c.codeHash) {
            res.push({
                type: "codehash",
                chainID: c.chainID,
                link: `/wasmcode/${c.codeHash}/${c.chainID}`,
                text: "WASM Code: " + c.codeHash,
                description: `ChainID: ${c.chainID} Storer: ${c.storer}`
            })
        }
    }

    check_block_hash(hash, blockcells, res) {
        let cell = blockcells[0];
        let feed = JSON.parse(cell.value);
        if (feed) {
            let chainID = feed.chainID;
            let blockNumber = feed.blockNumber;
            let relayBN = (feed.relayBN != undefined) ? feed.relayBN : null
            let relayStateRoot = (feed.relayStateRoot != undefined) ? feed.relayStateRoot : null
            let blockType = 'substrate'
            if (feed.blockType != undefined) {
                blockType = feed.blockType
            }
            if (blockNumber) {
                res.hash = hash
                res.chainID = chainID
                res.blockNumber = blockNumber
                if (blockType == 'evm') {
                    res.hashType = 'evmBlockHash'
                } else if (blockType == 'substrate') {
                    if (relayBN) res.relayBN = relayBN
                    if (relayStateRoot) res.relayStateRoot = relayStateRoot
                    res.hashType = 'substrateBlockHash'
                }
            }
        }
    }

    check_stateroot_hash(hash, blockcells, res) {
        let cell = blockcells[0];
        let feed = JSON.parse(cell.value);
        if (feed) {
            let chainID = feed.chainID;
            let blockNumber = feed.blockNumber;
            let blockhash = feed.blockHash;
            let hashType = 'stateroot'
            if (blockNumber) {
                res.hash = hash
                res.blockhash = blockhash
                res.chainID = chainID
                res.blockNumber = blockNumber
                res.hashType = hashType
            }
        }
    }

    check_tx_hash(hash, txcells, res) {
        let cell = txcells[0]; // TODO: how do you support edge case of multiple distinct txhashes - can we use versions https://github.com/paritytech/polkadot/issues/231
        let feed = JSON.parse(cell.value);
        if (feed) {
            let chainID = feed.chainID;
            let blockNumber = (feed.blockNumber != undefined) ? feed.blockNumber : null;
            let hashType = (feed.extrinsicHash != undefined) ? 'extrinsicHash' : 'transactionHash'
            res.hash = hash
            res.chainID = chainID
            res.blockNumber = blockNumber
            res.hashType = hashType
        }
    }

    redirect_search_tx(hash, txcells, res = []) {
        let cell = txcells[0]; // TODO: how do you support edge case of multiple distinct txhashes - can we use versions https://github.com/paritytech/polkadot/issues/231
        let feed = JSON.parse(cell.value);
        if (feed) {
            let chainID = feed.chainID;
            let blockNumber = feed.blockNumber;
            let addr = feed.addr;
            res.push({
                type: "tx",
                chainID: chainID,
                blockNumber: blockNumber,
                link: "/tx/" + hash,
                text: `chain: ${chainID} blockNumber: ${blockNumber} address: ${addr}`,
                description: "tx"
            })
        }
    }

    async search_hash(hash) {
        let res = [];
        let families = ['feed', 'feedunfinalized', 'feedevmunfinalized', 'feedpending'] // 3 columnfamily
        try {
            let [rows] = await this.btHashes.getRows({
                keys: [hash]
            });
            rows.forEach((row) => {
                let rowData = row.data;
                //priority: use feed then feedunfinalized/feedevmunfinalized
                let data = false
                if (rowData["feed"]) {
                    // finalized
                    data = rowData["feed"]
                } else if (rowData["feedunfinalized"]) {
                    data = rowData["feedunfinalized"]
                } else if (rowData["feedevmunfinalized"]) {
                    data = rowData["feedevmunfinalized"]
                } else if (rowData["feedpending"]) {
                    data = rowData["feedpending"]
                }
                if (data) {
                    if (data["block"]) {
                        this.redirect_search_block(hash, data["block"], res)
                    } else if (data["stateroot"]) {
                        this.redirect_search_stateroot(hash, data["stateroot"], res)
                    } else if (data["tx"]) {
                        this.redirect_search_tx(hash, data["tx"], res)
                    }
                } else {
                    if (rowData["wasmcode"]) {
                        for (const chainID of Object.keys(rowData["wasmcode"])) {
                            this.redirect_search_wasmcode(hash, rowData["wasmcode"][chainID], res)
                        }
                    }
                    if (rowData["wasmcontract"]) {
                        for (const chainID of Object.keys(rowData["wasmcontract"])) {
                            this.redirect_search_wasmcontract(hash, rowData["wasmcontract"][chainID], res)
                        }
                    } else if (rowData["xcmmessage"]) {
                        for (const sentAt of Object.keys(rowData["xcmmessage"])) {
                            this.redirect_search_xcmmessage(hash, rowData["xcmmessage"][sentAt], res)
                        }
                    } else if (rowData["symbol"]) {
                        for (const relayChain of Object.keys(rowData["symbol"])) {
                            this.redirect_search_symbol(hash, rowData["symbol"][relayChain], res)
                        }
                    } else if (rowData["chain"]) {
                        for (const chainID of Object.keys(rowData["chain"])) {
                            this.redirect_search_chain(hash, rowData["chain"][chainID], res)
                        }
                    }
                }
            });
        } catch (err) {
            if (err.code == 404) {
                console.log("NOT FOUND", hash);
                return res;
            } else {
                console.log(err);
                this.logger.error({
                    "op": "query.search_hash",
                    hash,
                    err
                });
            }
        }
        return res;
    }

    async lookupHash(hash) {
        let res = {
            hash: hash,
            hashType: 'NotFound', //substrateBlockHash/evmBlockHash, extrinsicHash, transactionHash
            status: 'NotFound',
            chainID: null,
            blockNumber: null,
        };
        let families = ['feed', 'feedunfinalized', 'feedevmunfinalized', 'feedpending', 'feedxcmdest', 'xcminfofinalized'] // 3 columnfamily
        try {
            // TODO: use getRow
            let [rows] = await this.btHashes.getRows({
                keys: [hash]
            });
            for (let i = 0; i < rows.length; i++) {
                let row = rows[i];
                let rowData = row.data;
                //priority: use feed then feedunfinalized/feedevmunfinalized
                let blockcells = false;
                let txcells = false;
                let data = false

                if (rowData["xcminfofinalized"]) {
                    data = rowData["xcminfofinalized"]
                    res.status = 'finalizeddest'
                } else if (rowData["feedxcmdest"]) {
                    data = rowData["feedxcmdest"]
                    res.status = 'finalizeddest'
                } else if (rowData["evmtx"]) {
                    data = rowData["evmtx"]
                    res.status = 'finalized';
                } else if (rowData["evmtxunfinalized"]) {
                    data = rowData["evmtxunfinalized"]
                    res.status = 'unfinalized';
                } else if (rowData["feed"]) {
                    // finalized
                    data = rowData["feed"]
                    res.status = 'finalized'

                    // **** SPECIAL CASE: EVM txhash ..
                    try {
                        if (data.tx != undefined && data.tx[0]) {
                            const cell = data.tx[0];
                            let c = JSON.parse(cell.value);
                            if (c.gasLimit != undefined) {
                                if (this.is_evm_xcmtransfer_input(c.input)) {
                                    let substrateTXHash = c.substrate.extrinsicHash;
                                    let substratetx = await this.getTransaction(substrateTXHash);
                                    if (substratetx.xcmdest != undefined) {
                                        res.status = "finalizeddest";
                                        // bring this in!
                                        res.xcmdest = substratetx.xcmdest;
                                        res.xcmInfo = substratetx.xcmInfo;
                                    }
                                }
                            }
                        }
                    } catch (errS) {
                        console.log(errS);
                    }
                } else if (rowData["feedunfinalized"]) {
                    data = rowData["feedunfinalized"]
                    res.status = 'unfinalized'
                } else if (rowData["feedevmunfinalized"]) {
                    data = rowData["feedevmunfinalized"]
                    res.status = 'unfinalized'
                } else if (rowData["feedpending"]) {
                    data = rowData["feedpending"]
                    res.status = 'pending'
                }
                if (data) {
                    if (data["block"]) {
                        blockcells = data["block"]
                        this.check_block_hash(hash, blockcells, res)
                    } else if (data["stateroot"]) {
                        blockcells = data["stateroot"]
                        this.check_stateroot_hash(hash, blockcells, res)
                    } else if (data["tx"]) {
                        txcells = data["tx"]
                        this.check_tx_hash(hash, txcells, res)
                    }
                }
            }
        } catch (err) {
            if (err.code == 404) {
                return res;
            } else {
                this.logger.error({
                    "op": "query.lookupHashsearch_hash",
                    hash,
                    err
                });
            }
        }
        return res;
    }

    async search_blocks(bn) {
        let chains = await this.getChains();
        let res = [];
        for (var i = 0; i < chains.length; i++) {
            if (bn < chains[i].blocksCovered) {
                res.push({
                    link: "/block/" + chains[i].chainID + "/" + bn,
                    text: chains[i].chainName + " Block " + bn.toString(),
                    description: "Block",
                    numHolders: chains[i].numHolders
                });
            }
        }
        return res;
    }

    async getSearchResults(search) {
        if (search.length > 45 && search.length < 53) {
            search = paraTool.getPubKey(search);
        }
        var tasks = [this.search_address(search.toLowerCase()), this.search_hash(search.toLowerCase())];
        var results = await Promise.all(tasks);
        var out = results.flat(2);
        if (out.length == 0) {
            let bn = parseInt(search, 10);
            if (bn > 0) {
                return await this.search_blocks(bn);
            }
        }
        if (out.length > 1) { // better would be sort by TVL (numHolders*priceUSD) desc
            out.sort(function(a, b) {
                let b1 = (b.numHolders !== undefined) ? b.numHolders : 0;
                let a1 = (a.numHolders !== undefined) ? a.numHolders : 0;
                return (b1 - a1);
            })
        }
        return out;
    }

    async getChainSymbols(chainID_or_chainName) {
        let [chainID, id] = this.convertChainID(chainID_or_chainName)
        if (chainID === false) return [];
        try {
            let sql = `select distinct symbol from asset where chainID = ${chainID} and assetType = 'Token' order by symbol`;
            let symbols = await this.poolREADONLY.query(sql);
            return symbols;
        } catch (err) {
            this.logger.error({
                "op": "query.getChainSymbols",
                chainID_or_chainName,
                err
            });
        }
    }

    //return a lint of parachains where we have endpoint access
    async getGARSupportedList(relaychain = 'polkadot') {
        let supportedListMap = {}
        try {
            let sql = `select id, chainId, paraId, relaychain from chain where crawling = 1 and relaychain in ('kusama', 'polkadot')`;
            let chains = await this.poolREADONLY.query(sql);
            for (const c of chains) {
                let k = `${c.relaychain}-${c.paraId}`
                let s = {
                    id: c.id,
                    chainID: c.chainId,
                    paraID: c.chainId,
                    relaychain: c.relaychain,
                }
                supportedListMap[k] = s
            }
            return supportedListMap
        } catch (err) {
            this.logger.error({
                "op": "query.getGARSupportedList",
                relaychain,
                err
            });
        }
    }

    //WARNING: This call is exposed externally. should not include any non-public ws
    async getChain(chainID_or_chainName, isExternal = false) {
        let [chainID, id] = this.convertChainID(chainID_or_chainName)
        if (chainID === false) {
            throw new paraTool.NotFoundError(`Chain not found: ${chainID_or_chainName}`)
            return (false);
        }
        try {
            let chains = await this.poolREADONLY.query(`select id, chainID, chainName, blocksCovered, blocksFinalized, blocksArchived, symbol, UNIX_TIMESTAMP(lastCrawlDT) as lastCrawlTS, UNIX_TIMESTAMP(lastFinalizedDT) as lastFinalizedTS, iconUrl, crawling, crawlingStatus, numTraces, WSEndpoint, WSEndpoint2, WSEndpoint3, relayChain, paraID, ss58Format, RPCBackfill,
            numHolders, totalIssuance,
            numExtrinsics, numExtrinsics7d, numExtrinsics30d,
            numSignedExtrinsics, numSignedExtrinsics7d, numSignedExtrinsics30d,
            numTransfers, numTransfers7d, numTransfers30d,
            numEvents, numEvents7d, numEvents30d,
            valueTransfersUSD, valueTransfersUSD7d, valueTransfersUSD30d,
            numXCMTransferIncoming, numXCMTransferIncoming7d, numXCMTransferIncoming30d,
            numXCMTransferOutgoing, numXCMTransferOutgoing7d, numXCMTransferOutgoing30d,
            valXCMTransferIncomingUSD, valXCMTransferIncomingUSD7d, valXCMTransferIncomingUSD30d,
            valXCMTransferOutgoingUSD, valXCMTransferOutgoingUSD7d, valXCMTransferOutgoingUSD30d,
            tracesAvailable,
            subscanURL, dappURL, githubURL, parachainsURL, isEVM, isWASM from chain where chainID = ${chainID}`)
            if (chains.length == 1) {
                let chainInfo = chains[0]
                if (chainInfo.isEVM) {
                    let evmChains = await this.poolREADONLY.query(`select evmChainID,
                  numTransactionsEVM, numTransactionsEVM7d, numTransactionsEVM30d,
                  numReceiptsEVM, numReceiptsEVM7d, numReceiptsEVM30d,
                  floor(gasUsed / (numEVMBlocks+1)) as gasUsed,
                  floor(gasUsed7d / (numEVMBlocks7d+1)) as gasUsed7d,
                  floor(gasUsed30d / (numEVMBlocks30d+1)) as gasUsed30d,
                  floor(gasLimit / (numEVMBlocks+1)) as gasLimit,
                  floor(gasLimit7d / (numEVMBlocks7d+1)) as gasLimit7d,
                  floor(gasLimit30d / (numEVMBlocks30d+1)) as gasLimit30d
                  from chain where chainID = ${chainID} and isEVM = 1`);
                    if (evmChains.length == 1) {
                        let evmChainInfo = evmChains[0]
                        for (const k of Object.keys(evmChainInfo)) {
                            let v = evmChainInfo[k]
                            chainInfo[k] = paraTool.dechexToInt(v)
                        }
                    }
                }
                if (isExternal) {
                    if (!paraTool.isPublicEndpoint(chainInfo.WSEndpoint)) chainInfo.WSEndpoint = null
                    if (!paraTool.isPublicEndpoint(chainInfo.WSEndpoint2)) chainInfo.WSEndpoint2 = null
                    if (!paraTool.isPublicEndpoint(chainInfo.WSEndpoint3)) chainInfo.WSEndpoint3 = null
                    // hardcoded for publicEndpoint = true for now
                    chainInfo.chainID = parseInt(chainInfo.chainID)
                    if ((chainInfo.chainID == 2006 || chainInfo.chainID == 22007) || (chainInfo.chainID == 2004 || chainInfo.chainID == 22023 || chainInfo.chainID == 61000 || chainInfo.chainID == 60888)) {
                        let id = chainInfo.id;
                        if (id == "moonbase-alpha") id = "moonbase";
                        chainInfo.RPCBackfill = `https://${id}-internal.polkaholic.io:8443`
                        chainInfo.WSEndpoint = `wss://${id}-internal.polkaholic.io`
                    }
                }
                return chainInfo
            }
        } catch (err) {
            this.logger.error({
                "op": "query.getChain",
                chainID,
                id,
                err
            });
        }
        return (false);
    }

    trimquote(s) {
        if (s.length >= 2 && (s.substring(0, 1) == '"') && (s.substring(s.length - 1, s.length))) {
            return s.substring(1, s.length - 1);
        }
        return s;
    }

    async getTraceXCMInfo(extrinsicHash) {
        let traceID = null
        let sql = `select extrinsicHash, extrinsicID, traceID from xcmtransfer where extrinsicHash = '${extrinsicHash}' order by isFeeItem, sourceTS desc limit 1`
        let xcmtransfers = await this.poolREADONLY.query(sql);
        if (xcmtransfers.length > 0) {
            let xcmtransfer = xcmtransfers[0]
            if (xcmtransfer.traceID != undefined) {
                traceID = xcmtransfer.traceID
            }
        }
        return traceID;
    }

    async getXCMTransfersUI(filters = {}, limit = 10, decorate = true, decorateExtra = ["data", "address", "usd", "related"]) {
        let [decorateData, decorateAddr, decorateUSD, decorateRelated] = this.getDecorateOption(decorateExtra)
        let chainList = filters.chainList ? filters.chainList : [];
        let blockNumber = filters.blockNumber ? parseInt(filters.blockNumber, 10) : null;
        let address = filters.address ? filters.address : null;
        let xcmType = filters.xcmType ? filters.xcmType : null;
        let symbols = filters.symbol ? filters.symbol.split(',') : [];
        let startTS = filters.startTS ? filters.startTS : null;
        let endTS = filters.endTS ? filters.endTS : null;
        //console.log(`filters`, filters)
        let patchedXcms = [] // we will update the missing xcmInfo once instead of rebuilding it over and over again
        let out = [];
        try {
            let w = [];
            if (address) {
                w.push(`(fromAddress='${address}' or destAddress='${address}')`);
            }
            if (blockNumber) {
                w.push(`(blockNumber='${parseInt(blockNumber, 10)}')`)
            }
            if (xcmType) {
                w.push(`(xcmType='${xcmType}')`)
            }
            if (symbols.length > 0) {
                w.push(`( symbol in ( '${symbols.join("','")}'))`)
            }
            if (!isNaN(startTS) && !isNaN(endTS) && startTS && endTS) {
                w.push(`( sourceTS >= ${startTS} && sourceTS < ${endTS})`)
            }
            let chainListFilter = "";
            if (chainList.length > 0) {
                w.push(`( chainID in ( ${chainList.join(",")} ) or chainIDDest in (${chainList.join(",")}) )`)
            }
            let wstr = (w.length > 0) ? " where " + w.join(" and ") : "";
            let sql = `select extrinsicHash, extrinsicID, transferIndex, xcmIndex, chainID, chainIDDest, blockNumber, fromAddress, destAddress, sectionMethod, symbol, relayChain, amountSentUSD, amountReceivedUSD, blockNumberDest, executedEventID, sentAt, sourceTS, destTS, amountSent, amountReceived, status, destStatus, relayChain, incomplete, relayChain, msgHash, errorDesc, convert(xcmInfo using utf8) as xcmInfo, traceID from xcmtransfer ${wstr} order by sourceTS desc limit ${limit}`
            let xcmtransfers = await this.poolREADONLY.query(sql);
            //console.log(filters, sql);
            for (let i = 0; i < xcmtransfers.length; i++) {
                let x = xcmtransfers[i];
                x.chainName = this.getChainName(x.chainID);
                [x.chainID, x.id] = this.convertChainID(x.chainID)
                x.paraID = paraTool.getParaIDfromChainID(x.chainID)

                // looks up assetInfo
                let symbolRelayChain = paraTool.makeAssetChain(x.symbol, x.relayChain);
                let assetInfo = this.getXcmAssetInfoBySymbolKey(symbolRelayChain);
                if (assetInfo) {
                    x.decimals = assetInfo.decimals;
                    x.amountSent = x.amountSent / 10 ** x.decimals;
                    x.amountReceived = x.amountReceived / 10 ** x.decimals;
                    x.xcmFee = x.amountSent - x.amountReceived
                    let chainIDOriginationInfo = this.chainInfos[x.chainID]
                    if (chainIDOriginationInfo != undefined && chainIDOriginationInfo.ss58Format != undefined) {
                        if (x.fromAddress != undefined) {
                            if (x.fromAddress.length == 42) x.sender = x.fromAddress
                            if (x.fromAddress.length == 66) x.sender = paraTool.getAddress(x.fromAddress, chainIDOriginationInfo.ss58Format)
                        }
                    }

                    x.symbol = assetInfo.symbol;
                    //if (assetInfo.localSymbol) x.localSymbol = assetInfo.localSymbol;
                } else {
                    console.log(`[${x.extrinsicHash}] [${x.extrinsicID}] MISSING x.asset`, x.asset, x.chainID);
                }
                let section = null,
                    method = null;
                if (x.chainIDDest != undefined) {
                    let chainIDDestInfo = this.chainInfos[x.chainIDDest]
                    if (chainIDDestInfo != undefined && chainIDDestInfo.ss58Format != undefined) {
                        if (x.destAddress != undefined) {
                            if (x.destAddress.length == 42) x.beneficiary = x.destAddress
                            if (x.destAddress.length == 66) x.beneficiary = paraTool.getAddress(x.destAddress, chainIDDestInfo.ss58Format)
                        }
                    }
                    let [_, idDest] = this.convertChainID(x.chainIDDest)
                    //[x.chainIDDest, x.idDest] = this.convertChainID(x.chainIDDest)
                    x.idDest = (idDest == false) ? null : idDest
                    x.chainDestName = this.getChainName(x.chainIDDest);
                    x.paraIDDest = paraTool.getParaIDfromChainID(x.chainIDDest)
                    let sectionPieces = x.sectionMethod.split(':')
                    if (sectionPieces.length == 2) {
                        section = sectionPieces[0];
                        method = sectionPieces[1];
                    }
                }
                let parsedXcmInfo;
                try {
                    parsedXcmInfo = (x.xcmInfo != undefined) ? JSON.parse(`${x.xcmInfo}`) : false;
                    if (parsedXcmInfo.origination) {
                        x.amountSent = parsedXcmInfo.origination.amountSent;
                        x.amountSentUSD = parsedXcmInfo.origination.amountSentUSD;
                    }
                    if (parsedXcmInfo.destination) {
                        x.amountReceivedUSD = parsedXcmInfo.destination.amountReceivedUSD;
                        x.amountReceived = parsedXcmInfo.destination.amountReceived;
                    }
                } catch (e) {
                    parsedXcmInfo = false
                }
                let r = {
                    extrinsicHash: x.extrinsicHash,
                    extrinsicID: x.extrinsicID,
                    incomplete: x.incomplete,
                    status: x.status,

                    section: section,
                    method: method,

                    // relayChain
                    relayChain: x.relayChain,

                    //source section
                    sender: x.sender, //AccountKey20 or SS58
                    fromAddress: x.fromAddress,
                    id: x.id,
                    chainID: x.chainID,
                    chainName: x.chainName,
                    blockNumber: x.blockNumber,
                    sourceTS: x.sourceTS,

                    //dest section
                    beneficiary: (x.beneficiary != undefined) ? x.beneficiary : null, //AccountKey20 or SS58
                    destAddress: (x.destAddress != undefined) ? x.destAddress : null,
                    idDest: x.idDest,
                    chainIDDest: x.chainIDDest,
                    chainDestName: x.chainDestName,
                    blockNumberDest: x.blockNumberDest,
                    destTS: x.destTS,

                    symbol: x.symbol,
                    //localSymbol: x.localSymbol,
                    currencyID: x.currencyID,
                    traceID: x.traceID,
                    amountSent: x.amountSent,
                    amountSentUSD: x.amountSentUSD,
                    amountReceived: x.amountReceived,
                    amountReceivedUSD: x.amountReceivedUSD,
                    xcmFee: x.xcmFee,
                    xcmFeeUSD: x.xcmFeeUSD,
                    priceUSD: x.priceUSD,
                    priceUSDCurrent: x.priceUSDCurrent,
                }
                if (parsedXcmInfo) {
                    if (parsedXcmInfo != undefined && parsedXcmInfo.origination != undefined) {
                        let isMsgSent = parsedXcmInfo.origination.complete
                        parsedXcmInfo.origination.isMsgSent = isMsgSent
                        //delete parsedXcmInfo.origination.complete
                    }
                    r.xcmInfo = parsedXcmInfo
                }
                /*
                if (decorate) {
                    this.decorateAddress(r, "fromAddress", decorateAddr, decorateRelated)
                    this.decorateAddress(r, "destAddress", decorateAddr, decorateRelated)
                }
                */
                out.push(this.clean_extrinsic_object(r));
            }

        } catch (err) {
            console.log(`getXCMTransfers err`, err)
            this.logger.error({
                "op": "query.getXCMTransfers",
                address,
                err
            });
        }
        return out;
    }

    async getXCMTransfers(filters = {}, limit = 10, decorate = true, decorateExtra = ["data", "address", "usd", "related"]) {

        let [decorateData, decorateAddr, decorateUSD, decorateRelated] = this.getDecorateOption(decorateExtra)
        let chainList = filters.chainList ? filters.chainList : [];
        let blockNumber = filters.blockNumber ? parseInt(filters.blockNumber, 10) : null;
        let address = filters.address ? filters.address : null;
        let xcmType = filters.xcmType ? filters.xcmType : null;
        let symbols = filters.symbol ? filters.symbol.split(',') : [];
        let startTS = filters.startTS ? filters.startTS : null;
        let endTS = filters.endTS ? filters.endTS : null;
        //console.log(`filters`, filters)
        let patchedXcms = [] // we will update the missing xcmInfo once instead of rebuilding it over and over again
        let out = [];
        try {
            let w = [];
            if (address) {
                w.push(`(fromAddress='${address}' or destAddress='${address}')`);
            }
            if (blockNumber) {
                w.push(`(blockNumber='${parseInt(blockNumber, 10)}')`)
            }
            if (xcmType) {
                w.push(`(xcmType='${xcmType}')`)
            }
            if (symbols.length > 0) {
                w.push(`( symbol in ( '${symbols.join("','")}'))`)
            }
            if (!isNaN(startTS) && !isNaN(endTS) && startTS && endTS) {
                w.push(`( sourceTS >= ${startTS} && sourceTS < ${endTS})`)
            }
            let chainListFilter = "";
            if (chainList.length > 0) {
                w.push(`( chainID in ( ${chainList.join(",")} ) or chainIDDest in (${chainList.join(",")}) )`)
            }
            let wstr = (w.length > 0) ? " where " + w.join(" and ") : "";
            let sql = `select extrinsicHash, extrinsicID, transferIndex, xcmIndex, chainID, chainIDDest, blockNumber, fromAddress, destAddress, sectionMethod, symbol, relayChain, amountSentUSD, amountReceivedUSD, blockNumberDest, executedEventID, sentAt, sourceTS, destTS, amountSent, amountReceived, status, destStatus, relayChain, incomplete, relayChain, msgHash, errorDesc, convert(xcmInfo using utf8) as xcmInfo, traceID from xcmtransfer ${wstr} order by sourceTS desc limit ${limit}`
            let xcmtransfers = await this.poolREADONLY.query(sql);
            //console.log(filters, sql);
            for (let i = 0; i < xcmtransfers.length; i++) {
                let x = xcmtransfers[i];
                x.chainName = this.getChainName(x.chainID);
                [x.chainID, x.id] = this.convertChainID(x.chainID)
                x.paraID = paraTool.getParaIDfromChainID(x.chainID)

                // looks up assetInfo
                let symbolRelayChain = paraTool.makeAssetChain(x.symbol, x.relayChain);
                let assetInfo = this.getXcmAssetInfoBySymbolKey(symbolRelayChain);
                if (assetInfo) {
                    x.decimals = assetInfo.decimals;
                    x.amountSent = x.amountSent / 10 ** x.decimals;
                    x.amountReceived = x.amountReceived / 10 ** x.decimals;
                    x.xcmFee = x.amountSent - x.amountReceived
                    let chainIDOriginationInfo = this.chainInfos[x.chainID]
                    if (chainIDOriginationInfo != undefined && chainIDOriginationInfo.ss58Format != undefined) {
                        if (x.fromAddress != undefined) {
                            if (x.fromAddress.length == 42) x.sender = x.fromAddress
                            if (x.fromAddress.length == 66) x.sender = paraTool.getAddress(x.fromAddress, chainIDOriginationInfo.ss58Format)
                        }
                    }

                    x.symbol = assetInfo.symbol;
                    //if (assetInfo.localSymbol) x.localSymbol = assetInfo.localSymbol;
                } else {
                    console.log(`[${x.extrinsicHash}] [${x.extrinsicID}] MISSING x.asset`, x.asset, x.chainID);
                }
                let section = null,
                    method = null;
                if (x.chainIDDest != undefined) {
                    let chainIDDestInfo = this.chainInfos[x.chainIDDest]
                    if (chainIDDestInfo != undefined && chainIDDestInfo.ss58Format != undefined) {
                        if (x.destAddress != undefined) {
                            if (x.destAddress.length == 42) x.beneficiary = x.destAddress
                            if (x.destAddress.length == 66) x.beneficiary = paraTool.getAddress(x.destAddress, chainIDDestInfo.ss58Format)
                        }
                    }
                    let [_, idDest] = this.convertChainID(x.chainIDDest)
                    //[x.chainIDDest, x.idDest] = this.convertChainID(x.chainIDDest)
                    x.idDest = (idDest == false) ? null : idDest
                    x.chainDestName = this.getChainName(x.chainIDDest);
                    x.paraIDDest = paraTool.getParaIDfromChainID(x.chainIDDest)
                    let sectionPieces = x.sectionMethod.split(':')
                    if (sectionPieces.length == 2) {
                        section = sectionPieces[0];
                        method = sectionPieces[1];
                    }
                }
                let parsedXcmInfo;
                try {
                    parsedXcmInfo = (x.xcmInfo != undefined) ? JSON.parse(`${x.xcmInfo}`) : false;
                    if (parsedXcmInfo.origination) {
                        x.amountSent = parsedXcmInfo.origination.amountSent;
                        x.amountSentUSD = parsedXcmInfo.origination.amountSentUSD;
                    }
                    if (parsedXcmInfo.destination) {
                        x.amountReceivedUSD = parsedXcmInfo.destination.amountReceivedUSD;
                        x.amountReceived = parsedXcmInfo.destination.amountReceived;
                    }
                } catch (e) {
                    parsedXcmInfo = false
                }
                let r = {
                    extrinsicHash: x.extrinsicHash,
                    extrinsicID: x.extrinsicID,
                    incomplete: x.incomplete,
                    status: x.status,

                    section: section,
                    method: method,

                    // relayChain
                    relayChain: x.relayChain,

                    //source section
                    sender: x.sender, //AccountKey20 or SS58
                    fromAddress: x.fromAddress,
                    id: x.id,
                    chainID: x.chainID,
                    chainName: x.chainName,
                    blockNumber: x.blockNumber,
                    sourceTS: x.sourceTS,

                    //dest section
                    beneficiary: (x.beneficiary != undefined) ? x.beneficiary : null, //AccountKey20 or SS58
                    destAddress: (x.destAddress != undefined) ? x.destAddress : null,
                    idDest: x.idDest,
                    chainIDDest: x.chainIDDest,
                    chainDestName: x.chainDestName,
                    blockNumberDest: x.blockNumberDest,
                    destTS: x.destTS,

                    symbol: x.symbol,
                    //localSymbol: x.localSymbol,
                    currencyID: x.currencyID,
                    traceID: x.traceID,
                    amountSent: x.amountSent,
                    amountSentUSD: x.amountSentUSD,
                    amountReceived: x.amountReceived,
                    amountReceivedUSD: x.amountReceivedUSD,
                    xcmFee: x.xcmFee,
                    xcmFeeUSD: x.xcmFeeUSD,
                    priceUSD: x.priceUSD,
                    priceUSDCurrent: x.priceUSDCurrent,
                }
                if (parsedXcmInfo) {
                    if (parsedXcmInfo != undefined && parsedXcmInfo.origination != undefined) {
                        let isMsgSent = parsedXcmInfo.origination.complete
                        parsedXcmInfo.origination.isMsgSent = isMsgSent
                        //delete parsedXcmInfo.origination.complete
                    }
                    r = {}
                    r.xcmInfo = parsedXcmInfo
                }
                /*
                if (decorate) {
                    this.decorateAddress(r, "fromAddress", decorateAddr, decorateRelated)
                    this.decorateAddress(r, "destAddress", decorateAddr, decorateRelated)
                }
                */
                out.push(this.clean_extrinsic_object(r));
            }

        } catch (err) {
            console.log(`getXCMTransfers err`, err)
            this.logger.error({
                "op": "query.getXCMTransfers",
                address,
                err
            });
        }
        return out;
    }

    async getHashStatus(hash) {
        // 'notFound', 'pending', 'unfinalized', 'finalized'
        let res = {
            hashType: 'unknown',
            status: 'notFound'
        }
        let families = ['feed', 'feedunfinalized', 'feedevmunfinalized', 'feedpending', "feedxcmdest"] // 3 columnfamily
        try {
            let [rows] = await this.btHashes.getRows({
                keys: [hash]
            });
            rows.forEach((row) => {
                let rowData = row.data;
                //priority: use feed then feedunfinalized/feedevmunfinalized
                let data = false;
                if (rowData["feedxcmdest"]) {
                    data = rowData["feedxcmdest"]
                    res.status = 'finalizeddest'
                } else if (rowData["feed"]) {
                    // finalized
                    data = rowData["feed"]
                    res.status = 'finalized'
                } else if (rowData["feedunfinalized"]) {
                    data = rowData["feedunfinalized"]
                    res.status = 'unfinalized'
                } else if (rowData["feedevmunfinalized"]) {
                    data = rowData["feedevmunfinalized"]
                    res.status = 'unfinalized'
                } else if (rowData["feedpending"]) {
                    data = rowData["feedpending"]
                    res.status = 'pending'
                }
                if (data) {
                    if (data["tx"]) {
                        res.hashType = 'tx'
                    } else if (data["block"]) {
                        res.hashType = 'block'
                    }
                }
            });
        } catch (err) {
            this.logger.error({
                "op": "query.getHashStatus",
                hash,
                err
            });
        }
        return res;
    }

    getAssetSymbol(asset) {
        try {
            if (typeof asset == "string") {
                let a = JSON.parse(asset)
                if (a.Token) return (a.Token);
                return (false);
            }
            if (asset && asset.Token) {
                if (a.Token) return (a.Token);
                return (false);
            }
        } catch (err) {
            this.logger.error({
                "op": "query.getAssetSymbol",
                asset,
                err
            });

        }
        return (false);
    }

    is_evm_xcmtransfer_input(inp) {
        try {
            let xcmMethodList = ["0xb38c60fa", "0xb9f813ff", "0xfe430475", "0x185de2ae", "0xd7ab340c", "0xb648f3fe", "0xecf766ff", "0x019054d0"]
            let txMethodID = inp.substr(0, 10)
            if (xcmMethodList.includes(txMethodID)) {
                return true
            }
        } catch (e) {
            console.log(`is_evm_xcmtransfer_input inp=${inp}`, e)
        }
        return false
    }

    async get_tx_link(f, txHash, finalized = false) {
        for (const hash of Object.keys(f)) {
            const cell = f[hash][0];
            let c = JSON.parse(cell.value);
            try {
                let chainID = c.chainID
                let bn = c.bn
                let r = await this.fetch_evm_block_gs(chainID, bn);
                let [bl, targetTrace] = await this.decorate_block_transaction_trace(r, chainID, txHash)
                //******* TODO: use targetTrace somehow!!! ******
                if (bl && Array.isArray(bl.transactions)) {
                    let tx = bl.transactions[0]
                    tx.finalized = finalized;
                    tx.status = finalized ? "finalized" : "unfinalized";
                    //tx.chainID = c.chainID;
                    tx.chainName = this.getChainName(c.chainID)
                    //TODO: update txn.transactionsInternal to use new format
                    tx.transactionsInternal = []
                    return tx;
                } else {
                    return false
                }
            } catch (err) {
                console.log(err);
            }
        }
        return null;
    }

    async getContractsCall(extrinsicHash) {
        let sql = `select identifier, CONVERT(decodedCall using utf8) as decodedCall from contractsCall where extrinsicHash = '${extrinsicHash}' order by blockTS desc limit 1`;
        console.log(sql);
        let recs = await this.poolREADONLY.query(sql);
        if (recs.length > 0) {
            return recs[0];
        }
        return null;
    }

    async getTransaction(txHash, decorate = true, decorateExtra = ["usd", "address", "related", "data"], isRecursive = true) {
        //console.log(`getTransaction txHash=${txHash}, decorate=${decorate}, decorateExtra=${decorateExtra}`)
        let [decorateData, decorateAddr, decorateUSD, decorateRelated] = this.getDecorateOption(decorateExtra)
        //console.log(`getTransaction txHash=${txHash} decorateData=${decorateData} decorateAddr=${decorateAddr} decorateUSD=${decorateUSD} decorateRelated=${decorateRelated}`)
        const filter = {
            column: {
                cellLimit: 1
            },
        };
        if (!this.validAddress(txHash)) {
            throw new paraTool.InvalidError(`Invalid Extrinsic Hash: ${txHash}`)
        }
        try {
            const [row] = await this.btHashes.row(txHash).get({
                filter
            });

            let rowData = row.data;
            let feedData = false
            let feedTX = false
            let XCMInfoData = false
            let status = ""
            let isPending = false
            let isEVMUnfinalized = false
            if (rowData["feed"]) {
                feedData = rowData["feed"]
                status = "finalized"
            } else if (rowData["feedunfinalized"]) {
                feedData = rowData["feedunfinalized"]
                status = "unfinalized"
            } else if (rowData["feedevmunfinalized"]) {
                feedData = rowData["feedevmunfinalized"]
                status = "unfinalized"
                isEVMUnfinalized = true
            } else if (rowData["feedpending"]) {
                feedData = rowData["feedpending"]
                status = "pending"
                isPending = true
            }
            if (rowData["evmtx"]) {
                return await this.get_tx_link(rowData["evmtx"], txHash, true);
            } else if (rowData["evmtxunfinalized"]) {
                return await this.get_tx_link(rowData["evmtxunfinalized"], txHash, false);
            } else if (feedData && feedData["tx"]) {
                feedTX = feedData["tx"]
            }
            if (rowData["xcminfofinalized"]) {
                XCMInfoData = rowData["xcminfofinalized"]
                status = "finalizeddest"
            }
            if (feedTX) {
                const cell = feedTX[0];
                let c = JSON.parse(cell.value);
                //console.log(`getTransaction raw ${txHash}`, c)
                if (!paraTool.auditHashesTx(c)) {
                    console.log(`Audit Failed`, txHash)
                }

                if (c.transactionHash) {
                    // this is an EVM tx
                    let assetChain = c.to ? paraTool.makeAssetChain(c.to.toLowerCase(), c.chainID) : null;
                    if (this.assetInfo[assetChain]) {
                        c.assetInfo = this.assetInfo[assetChain];
                    }
                    c.chainName = this.getChainName(c.chainID)
                    let chainAsset = this.getChainAsset(c.chainID)
                    let cTimestamp = (isPending) ? Math.floor(Date.now() / 1000) : c.timestamp
                    if (isPending) {
                        c.timestamp = cTimestamp
                    }
                    let cFee = (isPending) ? 0 : c.fee
                    //await this.decorateUSD(c, "value", chainAsset, c.chainID, cTimestamp, decorateUSD)
                    if (decorateUSD) {
                        let p = await this.computePriceUSD({
                            val: c.value,
                            asset: chainAsset,
                            chainID: c.chainID,
                            ts: cTimestamp
                        });
                        if (p) {
                            c.valueUSD = p.valUSD;
                            c.priceUSD = p.priceUSD;
                            c.priceUSDCurrent = p.priceUSDCurrent;
                        }
                    }

                    c.symbol = this.getChainSymbol(c.chainID);
                    if (!isPending && decorateUSD) {
                        c.feeUSD = c.fee * c.priceUSD;
                    }

                    c.result = c.status // this is success/fail indicator of the evm tx
                    c.status = status // finalized/unfinalized

                    // decorate transactionsInternal
                    if (c.transactionsInternal !== undefined && c.transactionsInternal.length > 0) {
                        for (let i = 0; i < c.transactionsInternal.length; i++) {
                            let t = c.transactionsInternal[i];
                            t.valueRaw = t.value;
                            t.value = t.valueRaw / 10 ** this.getChainDecimal(c.chainID);
                            if (decorateUSD) {
                                t.valueUSD = c.priceUSD * t.value;
                                t.priceUSD = c.priceUSD;
                                t.priceUSDCurrent = c.priceUSDCurrent;
                            }
                        }
                    }
                    // decorate transfers
                    if (c.transfers !== undefined && c.transfers.length > 0) {
                        for (let i = 0; i < c.transfers.length; i++) {
                            let t = c.transfers[i];
                            //let tokenAsset = t.tokenAddress.toLowerCase();
                            //let tokenAssetChain = paraTool.makeAssetChain(tokenAsset, c.chainID);
                            let [isXcAsset, tokenAssetChain, rawAssetChain] = paraTool.getErcTokenAssetChain(t.tokenAddress, c.chainID) // REVIEW
                            let [tokenAsset, _] = paraTool.parseAssetChain(tokenAssetChain)
                            if (this.assetInfo[tokenAssetChain]) {
                                t.assetInfo = this.assetInfo[tokenAssetChain];
                                if (t.assetInfo.decimals !== false) {
                                    t.value = t.value / 10 ** t.assetInfo.decimals;
                                    if (decorateUSD) {
                                        let p = await this.computePriceUSD({
                                            val: t.value,
                                            asset: tokenAsset,
                                            chainID: c.chainID,
                                            ts: cTimestamp
                                        });
                                        if (p) {
                                            t.valueUSD = p.valUSD;
                                            t.priceUSD = p.priceUSD;
                                            t.priceUSDCurrent = p.priceUSDCurrent;
                                        }
                                    }
                                }
                            }
                        }
                    }
                    let rowDataKeys = Object.keys(rowData)

                    if (c.substrate != undefined && isRecursive) {
                        if (XCMInfoData) {
                            //MK: TODO - present as array
                            let xcmInfo = this.pickXcmInfo(XCMInfoData)
                            if (xcmInfo) {
                                c.xcmInfo = xcmInfo
                            }
                        } else if (this.is_evm_xcmtransfer_input(c.input)) {
                            //  fetch xcmInfo from substrate extrinsicHash
                            //console.log(`evmTxhash=${txHash}, extrinsicsHash=${c.substrate.extrinsicHash}`)
                            try {
                                let substratetx = await this.getTransaction(c.substrate.extrinsicHash);
                                if (substratetx.xcmInfo != undefined) {
                                    c.xcmInfo = substratetx.xcmInfo;
                                }
                                if (substratetx.traceID != undefined) {
                                    c.traceID = substratetx.traceID
                                }
                            } catch (errS) {
                                console.log("FETCH XCMTRANSFER ERR", errS);
                            }
                        }
                    }
                    return c;
                }

                let isExtrinsicXcm = this.detectExtrinsicXcm(c)
                //c.params = JSON.stringify(c.params)
                let d = await this.decorateExtrinsic(c, c.chainID, status, decorate, decorateExtra)

                if (!isPending) {
                    //pending does not have event, fee, specVersion, blockNumber
                    let dEvents = []
                    if (d.events) {
                        for (const evt of d.events) {
                            let [dEvent, isTransferType] = await this.decorateEvent(evt, d.chainID, d.ts, decorate, decorateExtra)
                            dEvents.push(dEvent)
                        }
                        d.events = dEvents
                        //await this.decorateFee(d, d.chainID, decorateUSD)
                        d.specVersion = this.getSpecVersionForBlockNumber(d.chainID, d.blockNumber);
                    }
                }

                try {

                    let traceID = null
                    if (XCMInfoData) {
                        //MK: TODO - present as array
                        let xcmInfo = this.pickXcmInfo(XCMInfoData)
                        if (xcmInfo) {
                            c.xcmInfo = xcmInfo
                            d.xcmInfo = c.xcmInfo
                        }
                        return d;
                    } else if (isExtrinsicXcm) {
                        //let [traceID] = await this.getTraceXCMInfo(txHash)
                        //if (traceID != undefined) d.traceID = traceID
                        //console.log(`${txHash} is extrinsicXcm! traceID=${traceID}`)
                    }
                    return d;
                } catch (err) {
                    console.log(err);
                    this.logger.warn({
                        "op": "query.getTransaction",
                        txHash,
                        err
                    });
                }

                return d;
            }

        } catch (err) {
            if (err.code == 404) {
                throw new paraTool.NotFoundError(`Transaction not found: ${txHash}`)
            } else {
                console.log(err);
                this.logger.error({
                    "op": "query.getTransaction",
                    txHash,
                    err
                });
            }
        }
        return (false);
    }

    async getAssetQuery(chainID, asset, queryType = "pricefeed", homeAddress = false, querylimit = 3000) {
        switch (queryType) {
            case "pricefeed":
                if (querylimit > 3000) querylimit = 3000
                return await this.getAssetPriceFeed(chainID, asset, querylimit)
            case "holders":
                if (querylimit > 3000) querylimit = 1000
                return await this.getAssetHolders(chainID, asset, querylimit)
            case "related":
                if (querylimit > 3000) querylimit = 100
                return await this.getAssetsRelated(chainID, asset, homeAddress = false, querylimit)
            default:
                return false;
                break;
        }
    }

    async getAssetPriceFeed(q, interval = "hourly", limit = 2160) {
        let lookback = 90;
        let w = [];
        switch (interval) {
            case "5min":
                w.push("indexTS % 300 = 0")
                lookback = 7;
                break;
            case "hourly":
                w.push("indexTS % 3600 = 0")
                lookback = 90;
                break;
            default:
            case "daily":
                w.push("indexTS % 86400 = 0")
                break;
        }
        w.push(`indexTS >= UNIX_TIMESTAMP( date_sub(Now(), INTERVAL ${lookback} DAY ) )`);
        let tbl = "assetpricelog";
        if (q.symbol && q.relayChain) {
            let symbolRelayChain = paraTool.makeAssetChain(q.symbol, q.relayChain);
            let xcmAssetInfo = this.getXcmAssetInfoBySymbolKey(symbolRelayChain)
            if (xcmAssetInfo == undefined) {
                throw new paraTool.InvalidError(`Invalid symbol relay chain: ${q.symbol}/${q.relayChain}`)
            }
            tbl = "xcmassetpricelog";
            w.push(`symbol = '${q.symbol}'`)
            w.push(`relayChain = '${q.relayChain}'`)
        } else if (q.asset && q.chainID) {
            let assetChain = paraTool.makeAssetChain(q.asset, q.chainID);
            if (this.assetInfo[assetChain] == undefined) {
                throw new paraTool.InvalidError(`Invalid asset: ${q.asset} on ${q.chainID}`)
            }
            w.push(`asset = '${q.asset}'`)
            w.push(`chainID = '${q.chainID}'`)
        }
        if (q.routerAssetChain) {
            w.push(`routerAssetChain = '${q.routerAssetChain}'`)
        }
        let wstr = w.join(" and ");
        let assetSQL = `select indexTS, priceUSD, routerAssetChain, verificationPath, liquid from ${tbl} where ${wstr} order by indexTS  limit ${limit*10}`
        //console.log(`assetSQL`, assetSQL)
        let assetlog = await this.poolREADONLY.query(assetSQL);
        try {
            if (assetlog && assetlog.length > 0) {
                let priceinfo = {};
                for (let i = 0; i < assetlog.length; i++) {
                    let a = assetlog[i];
                    // choose the most liquid (0 is most liquid, 1 is less liquid)
                    if (priceinfo[a.indexTS] == undefined || priceinfo[a.indexTS].liquid > a.liquid) {
                        priceinfo[a.indexTS] = a;
                    }
                }
                let results = [];
                for (const indexTS of Object.keys(priceinfo)) {
                    results.push([indexTS * 1000, priceinfo[indexTS].priceUSD]);
                }
                return (results);
            }
        } catch (err) {
            this.logger.error({
                "op": "query.getAssetPriceFeed",
                q,
                err
            });
        }
        return ([]);
    }

    async getAssetPairOHLCV(assetChain, limit = 10000) {
        try {
            let [asset, chainID] = paraTool.parseAssetChain(assetChain)
            let sql = `select indexTS, open, close, low, high, token0Volume, token1Volume, issuance from assetlog where asset = '${asset}' and chainID = '${chainID}' and indexTS >= UNIX_TIMESTAMP(date_sub(Now(), interval 180 day)) order by indexTS desc limit ${limit}`
            let data = await this.poolREADONLY.query(sql);
            let parsedAsset = JSON.parse(asset);
            let parsedToken0 = parsedAsset[0];
            let parsedToken1 = parsedAsset[1];
            let token0 = JSON.stringify(parsedAsset[0]);
            let token1 = JSON.stringify(parsedAsset[1]);

            let ts = this.currentTS();
            let out = [];
            for (let i = 0; i < data.length; i++) {
                let d = data[i];
                let ts = data[i].indexTS;
                let volumeUSD = 0;
                if (d.open < 10000) {
                    try {
                        let token0Volume = parseFloat(d.token0Volume);
                        let token1Volume = parseFloat(d.token1Volume);
                        let p0 = await this.computePriceUSD({
                            asset: token0,
                            chainID,
                            ts
                        });
                        let p1 = await this.computePriceUSD(1.0, {
                            asset: token1,
                            chainID
                        }, ts);
                        // this is the amount of swap volume
                        volumeUSD = token0Volume * p0.priceUSD + token1Volume * p1.priceUSD;
                    } catch (err) {
                        console.log("computevolumeUSD", token0, token1, err);
                    }
                    out.push([d.indexTS * 1000, d.open, d.close, d.low, d.high, volumeUSD]);
                }
            }
            return out;
        } catch (err) {
            this.logger.error({
                "op": "query.getAssetPairOHLCV",
                assetChain,
                err
            });
        }
    }

    async getAssetHolders(chainID, asset, limit = 1000) {
        let assetChain = paraTool.makeAssetChain(asset, chainID);
        console.log("assetChain", assetChain)
        if (this.assetInfo[assetChain] == undefined) {
            let alternativeAssetChain = paraTool.makeAssetChainFromXcContractAddress(asset, chainID); //fall back
            if (this.assetInfo[alternativeAssetChain] == undefined) {
                throw new paraTool.InvalidError(`Invalid asset: ${assetChain}`)
            } else {
                assetChain = alternativeAssetChain
            }
        }
        let holders = [];
        return holders
        // TODO: bring from substrate-etl.{polkadot,kusama}.balances${paraID}
        try {
            let [asset, chainID] = paraTool.parseAssetChain(assetChain)
            let sql = `select holder, free, reserved, miscFrozen, frozen  from substrate-etl.${relayChai}.balances${paraID} where asset = '${asset}' and free > 0 ${w} order by free desc limit ${limit}`
            let holders = await this.poolREADONLY.query(sql);
            let ts = this.currentTS();
            let p = await this.computePriceUSD({
                asset,
                chainID
            });
            let priceUSDCurrent = p && p.priceUSDCurrent ? p.priceUSDCurrent : 0

            /*for (let i = 0; i < holders.length; i++) {
                holders[i].free = parseFloat(holders[i].free);
                holders[i].reserved = parseFloat(holders[i].reserved);
                holders[i].miscFrozen = parseFloat(holders[i].miscFrozen);
                holders[i].frozen = parseFloat(holders[i].frozen);

                // transferable = free - misc_frozen
                holders[i].transferable = holders[i].free - holders[i].miscFrozen;
                holders[i].transferableUSD = holders[i].transferable * priceUSDCurrent;

                // balance = free + reserved
                holders[i].balance = holders[i].free + holders[i].reserved;
                holders[i].balanceUSD = priceUSDCurrent * holders[i].balance;

                holders[i].reservedUSD = priceUSDCurrent * holders[i].reserved;

                // fee_payable = free - fee_frozen ... but what is "Locked balance" vs "Frozen fee" since "miscFrozen" is always exactly "frozen"?
                holders[i].miscFrozenUSD = priceUSDCurrent * holders[i].miscFrozen;
                holders[i].frozenUSD = priceUSDCurrent * holders[i].frozen;
            }
	    */
            return holders;
        } catch (err) {
            this.logger.error({
                "op": "query.getAssetHolders",
                assetChain,
                err
            });
        }

    }

    async getAsset(currencyID, chainID) {
        try {
            // look up asset/currencyID in xcContractAddress and map to asset
            if (this.xcContractAddress[currencyID] != undefined) {
                currencyID = this.xcContractAddress[currencyID].asset
            }
            let assets = await this.poolREADONLY.query(`select asset.asset, asset.chainID, asset.assetType, asset.decimals, assetName, asset.symbol as localSymbol, asset.currencyID, asset.xcContractAddress, xcmasset.symbol from asset left join xcmasset on asset.xcmInteriorKey = xcmasset.xcmInteriorKey where asset.chainID = '${chainID}' and ( asset.currencyID = '${currencyID}' or asset.asset = '${currencyID}' ) order by asset.numHolders desc limit 1`);
            if (assets.length == 0) {
                throw new paraTool.InvalidError(`Asset/currencyID not found: ${currencyID}`)
            }
            let chainInfo = this.chainInfos[chainID];
            let [__, id] = this.convertChainID(chainID)
            let chainName = this.getChainName(chainID);
            let asset = assets[0];
            asset.id = id;
            asset.chainName = chainName;
            asset.iconUrl = chainInfo.iconUrl;
            return asset;
        } catch (err) {
            console.log(err);
            this.logger.error({
                "op": "query.getAsset",
                err
            });
        }
        return null;
    }


    getHoldingsState(holdings, asset, chainID) {
        if (!holdings) return (false);
        for (const assetType of Object.keys(holdings)) {
            let a = holdings[assetType];
            for (let i = 0; i < a.length; i++) {
                let b = a[i];
                if ((b.assetInfo.asset == asset) && (b.assetInfo.chainID == chainID)) {
                    return b.state;
                }
            }
        }
        return (undefined);
    }

    async getAssetsRelated(chainID, asset, limit = 100) {
        let assetChain = paraTool.makeAssetChain(asset, chainID);
        if (this.assetInfo[assetChain] == undefined) {
            throw new paraTool.InvalidError(`Invalid asset: ${assetChain}`)
        }
        let assets = [];
        try {
            let [asset, chainID] = paraTool.parseAssetChain(assetChain)
            if (!this.assetInfo) {
                console.log("getAssetsRelated MISS", assetChain);
                return (false);
            }
            for (const assetChainRelated of Object.keys(this.assetInfo)) {
                let assetInfoRelated = this.assetInfo[assetChainRelated];
                if ((assetInfoRelated.token0 == asset) || (assetInfoRelated.token1 == asset) || (assetInfoRelated.currencyID == asset)) {
                    assets.push(assetInfoRelated);
                }
            }
        } catch (err) {
            this.logger.error({
                "op": "query.getAssetsRelated",
                assetChain,
                err
            });
        }
        return (assets);
    }

    verificationURL(chainID, router) {
        switch (chainID) {
            case 2004:
                return `https://moonscan.io/address/${router}#readContract`
            case 22023:
                return `https://moonriver.moonscan.io/address/${router}#readContract`
            case 61000:
                return `https://moonbase.moonscan.io/address/${router}#readContract`
            case 2006:
                return `https://blockscout.com/astar/${router}`
            case 22007:
                return `https://blockscout.com/shiden/${router}`
        }
        return null;
    }
    unwrap_verificationPath(verificationPathRaw) {
        try {
            let res = {}
            let vp = JSON.parse(verificationPathRaw);
            for (const routerAssetChain of Object.keys(vp)) {
                res.routerAssetChain = routerAssetChain;
                [res.router, res.chainID] = paraTool.parseAssetChain(res.routerAssetChain);
                if (res.chainID) {
                    res.chainName = this.getChainName(res.chainID);
                    let [__, id] = this.convertChainID(res.chainID)
                    res.id = id;
                    let verificationURL = this.verificationURL(res.chainID, res.router);
                    if (verificationURL) {
                        res.verificationURL = verificationURL;
                    }
                }
                if (vp[routerAssetChain].path) {
                    res.path = vp[routerAssetChain].path;
                    res.pathSymbols = res.path.map((asset) => {
                        let assetChain = paraTool.makeAssetChain(asset, res.chainID);
                        let symbol = (this.assetInfo[assetChain]) ? this.assetInfo[assetChain].symbol : "UNK"
                        return symbol;
                    });
                    res.blockNumber = vp[routerAssetChain].blockNumber;
                }
                return res;
            }
            return (vp);
        } catch (err) {
            console.log(err);
            return null;
        }

    }

    async getAssetPriceUSDCurrentRouterAsset(asset, chainID) {
        let sql = `select indexTS, assetpricelog.routerAssetChain, router.routerName, liquid, priceUSD, priceUSD10, priceUSD100, priceUSD1000, convert(verificationPath using utf8) verificationPath from assetpricelog left join router on assetpricelog.routerAssetChain = router.routerAssetChain where assetpricelog.asset = '${asset}' and assetpricelog.chainID = '${chainID}' and indexTS >= unix_timestamp(date_sub(Now(), interval 90 MINUTE)) order by indexTS Desc` // choose
        let routerChainRecs = await this.poolREADONLY.query(sql)
        let routerChains = {}
        if (routerChainRecs.length > 0) {
            for (const r of routerChainRecs) {
                if (routerChains[r.routerAssetChain] == undefined || routerChains[r.routerAssetChain].indexTS < r.indexTS) {
                    routerChains[r.routerAssetChain] = r;
                }
            }
            let routerAssetChains = [];
            for (const r of Object.keys(routerChains)) {
                routerAssetChains.push(routerChains[r]);
            }
            // sort by liquid
            routerAssetChains.sort(function(a, b) {
                return a.liquid - b.liquid
            });
            for (const rac of routerAssetChains) {
                rac.verificationPath = this.unwrap_verificationPath(rac.verificationPath);
            }
            return routerAssetChains;
        }
        return [];
    }

    async getSymbolPriceUSDCurrentRouterAsset(symbol, relayChain = null) {
        let sql = `select indexTS, xcmassetpricelog.routerAssetChain, router.routerName, liquid, priceUSD, priceUSD10, priceUSD100, priceUSD1000, convert(verificationPath using utf8) verificationPath from xcmassetpricelog left join router on xcmassetpricelog.routerAssetChain = router.routerAssetChain where symbol = '${symbol}' and indexTS >= unix_timestamp(date_sub(Now(), interval 90 MINUTE)) order by indexTS Desc` // choose
        let routerChainRecs = await this.poolREADONLY.query(sql)
        let routerChains = {}
        if (routerChainRecs.length > 0) {
            for (const r of routerChainRecs) {
                if (routerChains[r.routerAssetChain] == undefined || routerChains[r.routerAssetChain].indexTS < r.indexTS) {
                    routerChains[r.routerAssetChain] = r;
                }
            }
            let routerAssetChains = [];
            for (const r of Object.keys(routerChains)) {
                routerAssetChains.push(routerChains[r]);
            }
            // sort by liquid
            routerAssetChains.sort(function(a, b) {
                return a.liquid - b.liquid
            });
            for (const rac of routerAssetChains) {
                rac.verificationPath = this.unwrap_verificationPath(rac.verificationPath);
            }
            return routerAssetChains;
        }
        return [];
    }

    async getSymbolAssets(symbol) {
        let sql = `select xcmasset.*, asset.assetType, asset.assetName, asset.asset, asset.chainID, asset.symbol as localSymbol, asset.chainName, asset.currencyID, numHolders, totalFree, totalReserved, totalMiscFrozen, totalFrozen from xcmasset, asset where xcmasset.xcmInteriorKey = asset.xcmInteriorKey and xcmasset.symbol = '${symbol}' order by numHolders desc;`
        console.log("getSymbolAssets", sql);
        let assets = await this.poolREADONLY.query(sql)
        if (assets.length == 0) {
            throw new NotFoundError(`Invalid symbol: ${symbol}`)
        }


        let ts = this.getCurrentTS();
        for (let i = 0; i < assets.length; i++) {
            let v = assets[i];
            let [__, id] = this.convertChainID(v.chainID)
            let chainName = this.getChainName(v.chainID);
            let a = {
                assetType: v.assetType,
                assetName: v.assetName,
                numHolders: v.numHolders,
                asset: v.asset,
                symbol: v.symbol,
                relayChain: v.relayChain,
                decimals: v.decimals,
                chainID: v.chainID,
                chainName: v.chainName,
                currencyID: v.currencyID,
                priceUSD: v.priceUSD,
                id,
                chainName,
                localSymbol: v.localSymbol,
                tvlFree: 0,
                tvlReserved: 0,
                tvlMiscFrozen: 0,
                tvlFrozen: 0
            };

            if (a.totalFree == null) a.totalFree = 0
            if (a.totalReserved == null) a.totalReserved = 0
            if (a.totalFrozen == null) a.totalFrozen = 0
            if (a.totalMiscFrozen == null) a.totalMiscFrozen = 0
            a.totalFree = parseFloat(v.totalFree)
            a.tvlFree = a.priceUSD * a.totalFree
            a.totalReserved = parseFloat(v.totalReserved)
            a.tvlReserved = a.priceUSD * a.totalReserved
            a.totalMiscFrozen = parseFloat(v.totalMiscFrozen)
            a.tvlMiscFrozen = a.priceUSD * a.totalMiscFrozen
            a.totalFrozen = parseFloat(v.totalFrozen)
            a.tvlFrozen = a.priceUSD * a.totalFrozen
            assets[i] = a
        }
        return assets;
    }

    async getChainChannels(chainID_or_chainName = "all") {
        var chainID = null,
            id = null,
            chain = {};
        if (chainID_or_chainName == "all") {

        } else {
            [chainID, id] = this.convertChainID(chainID_or_chainName)
            if (chainID === false) throw new NotFoundError(`Invalid chain: ${chainID_or_chainName}`)
            chain = await this.getChain(chainID)
        }

        try {
            let w = (chainID) ? `(chainID = '${chainID}' or chainIDDest = '${chainID}')` : `(status != 'Closed')`
            let sql = `select chainID, chainIDDest, relayChain, status, msgHashOpenRequest, sentAtOpenRequest, openRequestTS, maxMessageSize, maxCapacity, msgHashAccepted, msgHashAccepted, sentAtAccepted, acceptTS, msgHashClosing, sentAtClosing, closingInitiatorChainID, closingTS, numXCMMessagesOutgoing1d, numXCMMessagesOutgoing7d, numXCMMessagesOutgoing30d, valXCMMessagesOutgoingUSD1d, valXCMMessagesOutgoingUSD7d, valXCMMessagesOutgoingUSD30d, symbols from channel where ${w}`
            let channels = await this.poolREADONLY.query(sql);
            for (let i = 0; i < channels.length; i++) {
                let c = channels[i];
                let [_, id] = this.convertChainID(c.chainID);
                let [__, idDest] = this.convertChainID(c.chainIDDest);
                c.chainName = this.getChainName(c.chainID);
                c.chainNameDest = this.getChainName(c.chainIDDest);
                c.id = id;
                c.idDest = idDest;
                if (c.symbols) {
                    try {
                        c.symbols = JSON.parse(c.symbols);
                    } catch (e) {
                        //...
                    }
                }
            }
            return (channels);
        } catch (err) {
            // TODO
            console.log(err);
            return [];
        }
    }

    async getChannelXCMAssetlog(chainID_or_chainName, chainIDDest_or_chainName, symbol = null, relayChain = null, limit = 1000) {
        let [chainID, id] = this.convertChainID(chainID_or_chainName)
        if (chainID === false) throw new NotFoundError(`Invalid chain: ${chainID_or_chainName}`)
        let [chainIDDest, idDest] = this.convertChainID(chainIDDest_or_chainName)
        if (chainIDDest === false) throw new NotFoundError(`Invalid chain: ${chainIDDest_or_chainName}`)
        try {
            let w = [];
            // get xcmassetlog of a specific symbol
            if (symbol == null) {
                // no restriction
            } else if (symbol) {
                w.push(` and symbol = '${symbol}'`)
            }
            if (relayChain == null) {
                // no restriction
            } else if (relayChain) {
                w.push(` and relayChain = '${relayChain}'`)
            }
            let wStr = w.join(" ");
            let sql = `select logDT, UNIX_TIMESTAMP(logDT) as logTS, symbol, relayChain, numXCMTransfersOutgoingUSD, valXCMTransferOutgoingUSD from xcmassetlog where chainID = '${chainID}' and chainIDDest = '${chainIDDest}' and logDT >= date(date_sub(Now(), interval 90 day)) ${wStr} order by logDT desc  limit ${limit}`
            console.log(sql);
            let recs = await this.poolREADONLY.query(sql);
            for (let i = 0; i < recs.length; i++) {
                let [logDT, _] = paraTool.ts_to_logDT_hr(recs[i].logTS);
                recs[i].logDT = logDT;
            }
            return recs;
        } catch (err) {
            // TODO:
            console.log(err);
        }
        return ([]);
    }

    async getChainAssets(chainID_or_chainName = "all", assetType = "Token") {
        var chainID = null,
            id = null,
            chain = {};
        if (chainID_or_chainName == "all") {

        } else {
            [chainID, id] = this.convertChainID(chainID_or_chainName)
            if (chainID === false) throw new NotFoundError(`Invalid chain: ${chainID_or_chainName}`)
            chain = await this.getChain(chainID)
        }
        let assets = [];
        console.log("getChainAssets", chainID_or_chainName, assetType);
        try {
            let w = "";
            // get xcmassets of a chain or relaychain
            if (chainID == null) {
                // no restriction
            } else if (chainID == 0) {
                w = "and xcmasset.relayChain = 'polkadot'";
            } else if (chainID == 2) {
                w = "and xcmasset.relayChain = 'kusama'";
            } else if (chainID > 2) {
                w = `and asset.chainID = ${chainID}`
            }
            if (assetType) {
                w += ` and asset.assetType = '${assetType}'`
            }

            let sql = null
            if (assetType == "Token") {
                sql = `select xcmasset.*, asset.assetType, asset.assetName, asset.asset, asset.chainID, asset.symbol as localSymbol, xcmasset.symbol, asset.decimals, asset.currencyID, token0, token1, token0Decimals, token1Decimals, token0Symbol, token1Symbol, totalFree, totalReserved, totalMiscFrozen, totalFrozen, token0Supply, token1Supply, totalSupply, numHolders from xcmasset, asset where xcmasset.xcmInteriorKey = asset.xcmInteriorKey ${w} order by numHolders desc;`
            } else if (assetType == "System") {
                sql = `select assetType, assetName, asset, chainID, symbol from  asset where 1 ${w}`
            } else { // ERC20, ERC20LP, Loan
                sql = `select asset.assetType, asset.assetName, asset.asset, asset.chainID, asset.priceUSD, asset.symbol as localSymbol, asset.decimals, asset.currencyID, token0, token1, token0Decimals, token1Decimals, token0Symbol, token1Symbol, totalFree, totalReserved, totalMiscFrozen, totalFrozen, token0Supply, token1Supply, totalSupply, numHolders from asset where priceUSD > 0 ${w} order by numHolders desc;`
            }
            console.log(sql);
            assets = await this.poolREADONLY.query(sql);
            if (assets.length == 0) {
                // TODO: throw NotFound error
            }

            let ts = this.getCurrentTS();
            for (let i = 0; i < assets.length; i++) {
                let v = assets[i];
                let a = {};
                let assetChain = paraTool.makeAssetChain(v.asset, v.chainID);
                let [__, id] = this.convertChainID(v.chainID)
                let chainName = this.getChainName(v.chainID);
                if (v.assetType == 'LiquidityPair' || v.assetType == 'ERC20LP') { //'ERC20','ERC20LP','ERC721','ERC1155','Token','LiquidityPair','NFT','Loan','Special'
                    a = {
                        assetType: v.assetType,
                        assetName: v.assetName,
                        numHolders: v.numHolders,
                        id,
                        asset: v.asset,
                        symbol: v.symbol,
                        token0: v.token0,
                        token0Symbol: v.token0Symbol,
                        token0Decimals: v.token0Decimals,
                        token1: v.token1,
                        token1Symbol: v.token1Symbol,
                        token1Decimals: v.token1Decimals,
                        decimals: v.decimals,
                        chainID: v.chainID,
                        chainName: v.chainName,
                        assetChain: assetChain,
                        priceUSD: v.priceUSD,
                        tvlFree: v.totalSupply * v.priceUSD0
                    }
                } else if (v.assetType == "System") {
                    a = {
                        assetType: v.assetType,
                        assetName: v.assetName,
                        numHolders: v.numHolders,
                        id,
                        asset: v.asset,
                        symbol: v.symbol,
                        chainID: v.chainID,
                        chainName: v.chainName,
                        assetChain: assetChain,
                    }
                } else {
                    //does not have assetPair, token0, token1, token0Symbol, token1Symbol, token0Decimals, token1Decimals
                    a = {
                        assetType: v.assetType,
                        assetName: v.assetName,
                        numHolders: v.numHolders,
                        asset: v.asset,
                        symbol: v.symbol,
                        decimals: v.decimals,
                        chainID: v.chainID,
                        chainName,
                        id,
                        currencyID: v.currencyID,
                        localSymbol: v.localSymbol,
                        relayChain: v.relayChain,
                        assetChain: assetChain,
                        priceUSD: v.priceUSD,
                        totalFree: 0,
                        totalReserved: 0,
                        totalMiscFrozen: 0,
                        totalFrozen: 0,
                        tvlFree: 0,
                        tvlReserved: 0,
                        tvlMiscFrozen: 0,
                        tvlFrozen: 0
                    }
                    console.log("REC", v);
                    if (v.assetType == "ERC20") {
                        a.totalSupply = parseFloat(v.totalSupply)
                        a.tvlFree = a.priceUSD * a.totalSupply
                    } else {
                        if (a.totalFree == null) a.totalFree = 0
                        a.totalFree = parseFloat(v.totalFree)
                        a.tvlFree = a.priceUSD * a.totalFree
                        a.totalReserved = parseFloat(v.totalReserved)
                        a.tvlReserved = a.priceUSD * a.totalReserved
                        a.totalMiscFrozen = parseFloat(v.totalMiscFrozen)
                        a.tvlMiscFrozen = a.priceUSD * a.totalMiscFrozen
                        a.totalFrozen = parseFloat(v.totalFrozen)
                        a.tvlFrozen = a.priceUSD * a.totalFrozen
                    }
                }
                assets[i] = a
            }
        } catch (err) {
            console.log(err);
            this.logger.error({
                "op": "query.getChainAssets",
                chainID_or_chainName,
                err
            });
        }
        return assets;
    }

    async getChainRecentBlocks(chainID_or_chainName, startBN = false, limit = 50) {
        let chain = await this.getChain(chainID_or_chainName);
        let [chainID, id] = this.convertChainID(chainID_or_chainName)
        if (chainID === false) return ([]);
        if (!startBN) startBN = chain.blocksCovered - limit;
        try {
            if (chainID == 1 || chainID == 43114 || chainID == 42161) {
                let sql = `select blockNumber, blockHash, UNIX_TIMESTAMP(blockDT) as blockTS, numTransactions as numTransactionsEVM, 0 as numSignedExtrinsics, valueTransfersUSD, 0 as numTransactionsInternalEVM, gasUsed, numTransfers, numEvents, fees, feesBurned from block${chainID} order by blockNumber desc limit 50`
                let blocks = await this.poolREADONLY.query(sql);
                return blocks;
            }
            let evmflds = (chain.isEVM) ? ", numTransactionsEVM, numTransactionsInternalEVM, gasUsed" : "";
            let sql = `select blockNumber, if(blockDT is Null, 0, 1) as finalized, blockHash, blockDT, UNIX_TIMESTAMP(blockDT) as blockTS, numExtrinsics, numEvents, numTransfers, numSignedExtrinsics, numXCMTransfersIn, numXCMTransfersOut, numXCMMessagesOut, numXCMMessagesIn, valueTransfersUSD ${evmflds} from block${chainID} where blockNumber > ${startBN} order by blockNumber Desc limit ${limit}`
            let blocks = await this.poolREADONLY.query(sql);
            let blocksunfinalized = await this.poolREADONLY.query(`select blockNumber, blockHash, UNIX_TIMESTAMP(blockDT) as blockTS, numExtrinsics, numEvents, numTransfers, numSignedExtrinsics, valueTransfersUSD from blockunfinalized where chainID = ${chainID} and blockNumber >= ${startBN}`);
            let bufData = {};
            let bufBlockHashes = {};
            for (let b = 0; b < blocksunfinalized.length; b++) {
                let bn = blocksunfinalized[b].blockNumber;
                if (bufBlockHashes[bn] == undefined) {
                    bufBlockHashes[bn] = [];
                }
                bufBlockHashes[bn].push(blocksunfinalized[b].blockHash);
                bufData[bn] = blocksunfinalized[b];
            }

            for (let b = 0; b < blocks.length; b++) {
                let bn = blocks[b].blockNumber;
                if ((blocks[b].finalized == 0) && bufBlockHashes[bn] !== undefined) {
                    blocks[b].blockHash = bufBlockHashes[bn];
                    if (bufData[bn] !== undefined) {
                        blocks[b].blockTS = bufData[bn].blockTS;
                        blocks[b].numExtrinsics = bufData[bn].numExtrinsics;
                        blocks[b].numEvents = bufData[bn].numEvents;
                        blocks[b].numTransfers = bufData[bn].numTransfers;
                        blocks[b].valueTransfersUSD = bufData[bn].valueTransfersUSD;
                    }
                }
            }
            return (blocks);
        } catch (err) {
            this.logger.error({
                "op": "query.getChainRecentBlocks",
                chainID_or_chainName,
                err
            });

        }
        return ([]);
    }

    async decorateBlock(block, chainID, evmBlock = false, decorate = true, decorateExtra = ["data", "address", "usd", "related"]) {
        let [decorateData, decorateAddr, decorateUSD, decorateRelated] = this.getDecorateOption(decorateExtra)
        try {
            let exts = block.extrinsics
            let decoratedExts = []
            for (const d of exts) {
                //let de = await this.decorateBlockExtrinsic(d, chainID, block.blockTS, decorate, decorateExtra)
                let de = await this.decorateExtrinsic(d, chainID, "", decorate, decorateExtra)
                decoratedExts.push(de)
            }
            block.extrinsics = decoratedExts
            if (decorate && block.author != undefined) {
                block.authorAddress = paraTool.getPubKey(block.author)
                this.decorateAddress(block, "authorAddress", decorateAddr, false)
            } else if (evmBlock && evmBlock.author != undefined) {
                block.author = evmBlock.author
                block.authorAddress = paraTool.getPubKey(evmBlock.author)
                this.decorateAddress(block, "authorAddress", decorateAddr, false)
            }

            block.specVersion = this.getSpecVersionForBlockNumber(chainID, block.number);
            if (evmBlock) {
                if (evmBlock.transactionsInternal !== undefined && evmBlock.transactionsInternal.length > 0) {
                    for (let i = 0; i < evmBlock.transactionsInternal.length; i++) {
                        let t = evmBlock.transactionsInternal[i];
                        t.valueRaw = t.value;
                        t.value = t.valueRaw / 10 ** this.getChainDecimal(chainID);
                        if (decorateUSD) {
                            /*t.valueUSD = c.priceUSD * t.value;
                            t.priceUSD = c.priceUSD;
                            t.priceUSDCurrent = c.priceUSDCurrent;*/
                        }
                    }
                }
                if (evmBlock.transactionsConnected == undefined) evmBlock.transactionsConnected = []
                block.evmBlock = evmBlock
                // decorate transactionsInternal
            }
        } catch (err) {
            this.logger.error({
                "op": "decorateBlock",
                chainID,
                number: block.number,
                err
            });
        }
        return block
    }

    async decorateTrace(trace, chainID, blockNumber) {
        try {
            let traceIdx = 0
            for (const kv of trace) {
                kv.traceID = `${blockNumber}-${traceIdx}`
                let [section, storage] = this.lookup_trace_sectionStorage(kv.k, kv.v);
                if (section || storage) {
                    kv.section = section;
                    kv.storage = storage;
                }
                traceIdx++
            }
        } catch (err) {
            this.logger.error({
                "op": "decorateTrace",
                chainID,
                number: blockNumber,
                err
            });
        }
        return trace
    }

    async decorateAutoTrace(trace, chainID, blockNumber) {
        try {
            for (const kv of trace) {
                if (kv.p != undefined || kv.s != undefined) {
                    kv.section = kv.p;
                    kv.storage = kv.s;
                    delete kv.p;
                    delete kv.s;
                }
            }
        } catch (err) {
            this.logger.error({
                "op": "decorateTrace",
                chainID,
                number: blockNumber,
                err
            });
        }
        return trace
    }

    async decorate_block_transaction_trace(r, chainID, txHash) {
        //let tableIdDisabled = true
        //console.log(`decorate_block_transaction_trace txHash=${txHash}`)
        //console.log('decorate_evm_block', r)
        //let evmRPCInternalApi = this.evmRPCInternal
        let blkNum = false
        let blkHash = false
        let blockTS = false
        let blockAvailable = false
        let traceAvailable = false
        let receiptsAvailable = false
        let rpcBlock = r.block
        let rpcReceipts = r.receipts
        let rpcTraces = r.traces
        let evmReceipts = []
        let evmTrace = false
        let blk = false
        let stream_bq = false
        let write_bt = false
        let targetTrace = false;
        let transactionIndex;
        for (const txn of rpcBlock.transactions) {
            if (txn.hash == txHash) {
                transactionIndex = paraTool.dechexToInt(txn.transactionIndex)
                break
            }
        }
        if (transactionIndex == undefined) {
            console.log(`lookup failed!`)
            return [false, false]
        }
        if (rpcBlock) {
            blockAvailable = true
            let targetTxn = rpcBlock.transactions[transactionIndex]
            rpcBlock.transactions = [targetTxn]
            blk = ethTool.standardizeRPCBlock(rpcBlock)
            blkNum = blk.number;
            blkHash = blk.hash;
            blockTS = blk.timestamp;
        } else {
            console.log(`rpcBlock missing`, r)
        }
        if (rpcTraces) {
            targetTrace = rpcTraces[transactionIndex]
            traceAvailable = true
            evmTrace = [targetTrace]
        } else {
            console.log(`rpcTraces missing`, r)
        }
        if (rpcReceipts) {
            receiptsAvailable = true
            let targetReceipt = rpcReceipts[transactionIndex]
            evmReceipts = ethTool.standardizeRPCReceiptLogs([targetReceipt])
        } else {
            console.log(`rpcReceipts missing`, r)
        }
        /*
        console.log(`blk`, blk)
        console.log(`evmReceipts`, evmReceipts)
        console.log(`evmTrace`, evmTrace)
        */
        //console.log(`decorate_block_transaction [${blkNum}] [${blkHash}] Trace=${traceAvailable}, Receipts=${receiptsAvailable} , currTS=${this.getCurrentTS()}, blockTS=${blockTS}`)
        var statusesPromise = Promise.all([
            this.processTransactions(blk.transactions),
            this.processReceipts(evmReceipts)
        ])
        let [dTxns, dReceipts] = await statusesPromise

        //console.log(`++++ [#${blkNum} ${blkHash}] dTxns len=${dTxns.length}`, dTxns)
        //console.log(`[#${blkNum} ${blkHash}] dReceipts len=${dReceipts.length}`, dReceipts)
        let flatTraces = ethTool.debugTraceToFlatTraces(evmTrace, dTxns)
        //console.log(`flatTraces[${flatTraces.length}]`, flatTraces)
        //fuseBlockTransactionReceipt(evmBlk, dTxns, dReceipts, flatTraces, chainID)
        let evmBlockTransaction = await ethTool.fuseBlockTransactionReceipt(blk, blk.transactions, dReceipts, flatTraces, chainID)
        //console.log(`evmBlockTransaction`, evmBlockTransaction)
        //console.log(JSON.stringify(evmBlockTransaction))
        return [evmBlockTransaction, targetTrace]
    }

    async decorate_evm_block(chainID, r) {
        console.log('decorate_evm_block', r)
        //let evmRPCInternalApi = this.evmRPCInternal

        let blkNum = false
        let blkHash = false
        let blockTS = false
        let blockAvailable = false
        let traceAvailable = false
        let receiptsAvailable = false
        let rpcBlock = r.block
        let rpcReceipts = r.receipts
        //let chainID = r.chain_id
        let evmReceipts = []
        let evmTrace = false
        let blk = false
        let stream_bq = false
        let write_bt = false

        if (rpcBlock) {
            blockAvailable = true
            blk = ethTool.standardizeRPCBlock(rpcBlock)
            console.log(`evmBlk++`, blk)
            blkNum = blk.number;
            blkHash = blk.hash;
            blockTS = blk.timestamp;
        } else {
            console.log(`r.block missing`, r)
        }
        if (r.traces) {
            traceAvailable = true
            evmTrace = r.traces
        }
        if (rpcReceipts) {
            receiptsAvailable = true
            evmReceipts = ethTool.standardizeRPCReceiptLogs(rpcReceipts)
        } else {
            console.log(`r.rpcReceipts missing`, r)
        }
        //console.log(`blk.transactions`, blk.transactions)
        console.log(`decorate_evm_block [${blkNum}] [${blkHash}] Trace=${traceAvailable}, Receipts=${receiptsAvailable} , currTS=${this.getCurrentTS()}, blockTS=${blockTS}`)
        var statusesPromise = Promise.all([
            this.processTransactions(blk.transactions),
            this.processReceipts(evmReceipts)
        ])
        let [dTxns, dReceipts] = await statusesPromise

        //console.log(`++++ [#${blkNum} ${blkHash}] dTxns len=${dTxns.length}`, dTxns)
        //console.log(`[#${blkNum} ${blkHash}] dReceipts len=${dReceipts.length}`, dReceipts)
        let flatTraces = ethTool.debugTraceToFlatTraces(evmTrace, dTxns)
        //console.log(`flatTraces[${flatTraces.length}]`, flatTraces)
        //fuseBlockTransactionReceipt(evmBlk, dTxns, dReceipts, flatTraces, chainID)
        let evmFullBlock = await ethTool.fuseBlockTransactionReceipt(blk, blk.transactions, dReceipts, flatTraces, chainID)
        return evmFullBlock;
    }

    async getBlock(chainID_or_chainName, blockNumber, blockHash = false, decorate = true, decorateExtra = ["data", "address", "usd", "related"]) {
        let [chainID, id] = this.convertChainID(chainID_or_chainName)

        if (chainID === false) throw new paraTool.NotFoundError(`Invalid chain: ${chainID_or_chainName}`)
        let chain = await this.getChain(chainID);
        if (blockNumber > chain.blocksCovered) {
            throw new paraTool.InvalidError(`Invalid blockNumber: ${blockNumber} (tip: ${chain.blocksCovered})`)
        }
        try {
            let families = ["feed", "finalized", "feedevm"];
            let row = await this.fetch_block(chain, blockNumber, families, true, blockHash);
            let evmFullBlock = (row.evmFullBlock) ? row.evmFullBlock : false
            if (row && row.receipts != undefined) {
                try {
                    row.evmBlock = await this.decorate_evm_block(chainID, row)

                    return row
                } catch (err) {
                    console.log(err);
                }
            }
            if (row.feed) {
                let block = row.feed;
                block = await this.decorateBlock(row.feed, chainID, evmFullBlock, decorate, decorateExtra);

                let sql = `select numXCMTransfersIn, numXCMMessagesIn, numXCMTransfersOut, numXCMMessagesOut, valXCMTransferIncomingUSD, valXCMTransferOutgoingUSD from block${chainID} where blockNumber = '${blockNumber}' limit 1`;
                let blockStatsRecs = await this.poolREADONLY.query(sql);
                if (blockStatsRecs.length == 1) {
                    let s = blockStatsRecs[0];
                    block.numXCMTransfersIn = s.numXCMTransfersIn;
                    block.numXCMMessagesIn = s.numXCMMessagesIn;
                    block.numXCMTransfersOut = s.numXCMTransfersOut;
                    block.numXCMMessagesOut = s.numXCMMessagesOut;
                    block.valXCMTransferIncomingUSD = s.valXCMTransferIncomingUSD;
                    block.valXCMTransferOutgoingUSD = s.valXCMTransferOutgoingUSD;
                }
                return block;
            } else {
                throw new paraTool.NotFoundError(`Block not indexed yet: ${blockNumber}`)
            }
        } catch (err) {
            if (err.code == 404) {
                throw new paraTool.NotFoundError(`Block not found: ${blockNumber}`)
            }
            this.logger.error({
                "op": "query.getBlock",
                chainID,
                blockNumber,
                blockHash,
                err
            });
        }
        return false;
    }

    async getTrace(chainID_or_chainName, blockNumber, blockHash = false) {
        let [chainID, id] = this.convertChainID(chainID_or_chainName)
        if (chainID === false) {
            throw new paraTool.NotFoundError(`Invalid chain: ${chainID_or_chainName}`)
        }
        let chain = await this.getChain(chainID);
        if (blockNumber > chain.blocksCovered) {
            throw new paraTool.InvalidError(`Invalid blockNumber: ${blockNumber} (tip: ${chain.blocksCovered})`)
        }
        let traces = [];
        try {
            const filter = {
                filter: [{
                    family: ["finalized", "trace", "autotrace", "n"],
                    cellLimit: 100
                }]
            };

            const tableChain = this.getTableChain(chainID);
            const [row] = await tableChain.row(paraTool.blockNumberToHex(blockNumber)).get(filter);
            let rowData = row.data
            if (rowData) {
                let nData = rowData.n;
                let traceType = "unknown";
                for (const k of Object.keys(nData)) {
                    if (k == "traceType") {
                        traceType = nData[k][0].value;
                        break;
                    }
                }

                let finalizedData = rowData.finalized;
                let finalizedHashes = {};
                let bh = null;
                let finalized = false;
                if (finalizedData) {
                    for (const k of Object.keys(finalizedData)) {
                        finalizedHashes[k] = true;
                        finalized = true;
                        bh = k;
                        break;
                    }
                }
                let autoTraceData = rowData.autotrace;
                let traceData = rowData.trace;
                if (autoTraceData) {
                    for (const k of Object.keys(autoTraceData)) {
                        if (k == "raw" || (bh != null && (finalizedHashes[k] != undefined)) || bh == null) {
                            let t = JSON.parse(autoTraceData[k][0].value);
                            let out = {};
                            if (k == "raw" && bh != null && finalized) {
                                out.blockHash = bh
                                out.finalized = true;
                            } else if (k != "raw" && finalized && (k == bh)) {
                                out.blockHash = k;
                                out.finalized = true;
                            } else if (!finalized && ((blockHash == false) || (blockHash == k))) {
                                out.blockHash = k;
                            }
                            if (out.blockHash != undefined) {
                                out.traceType = traceType;
                                out.trace = await this.decorateAutoTrace(t, chainID, blockNumber);
                                traces.push(out);
                            }
                            break;
                        }
                    }
                } else if (traceData) {
                    for (const k of Object.keys(traceData)) {
                        if (k == "raw" || (bh != null && (finalizedHashes[k] != undefined)) || bh == null) {
                            let t = JSON.parse(traceData[k][0].value);
                            let out = {};
                            if (k == "raw" && bh != null && finalized) {
                                out.blockHash = bh
                                out.finalized = true;
                            } else if (k != "raw" && finalized && (k == bh)) {
                                out.blockHash = k;
                                out.finalized = true;
                            } else if (!finalized && ((blockHash == false) || (blockHash == k))) {
                                out.blockHash = k;
                            }
                            if (out.blockHash != undefined) {
                                out.traceType = traceType;
                                out.trace = await this.decorateTrace(t, chainID, blockNumber);
                                traces.push(out);
                            }
                            break;
                        }
                    }
                }
            }

            return traces;
        } catch (err) {
            this.logger.error({
                "op": "query.getTrace",
                chainID,
                blockNumber,
                blockHash,
                err
            });
        }
        return traces;
    }


    async getBlockByHash(blockHash = false, decorate = true, decorateExtra = ["data", "address", "usd", "related"]) {
        let res = await this.lookupHash(blockHash)
        if (res.hashType == "substrateBlockHash" || res.hashType == "evmBlockHash") {
            /*{
                "hash": "0xd62500cbc13a6d68aa3ad9131b54951a11bed3bc19ba8aebfda933fca6f443a2",
                "hashType": "evmBlockHash",
                "status": "finalized",
                "chainID": "2004",
                "blockNumber": 808508
            }
            */
            if (res.status == "finalized" || res.status == "unfinalized") {
                let chainID = res.chainID
                let blockNumber = res.blockNumber
                let block = await this.getBlock(chainID, blockNumber, blockHash, decorate, decorateExtra)
                if (res.hashType == "evmBlockHash" && block.evmBlock) {
                    // return just the evmBlock is looked up by evmBlockHash
                    return block.evmBlock
                } else {
                    block.chainID = res.chainID
                    return block
                }
            }
        }
        return false
    }

    parse_date(d) {
        return d; // TODO
    }

    parse_asset(a) {
        let [assetUnparsed, chainID] = paraTool.parseAssetChain(a);
        return (assetUnparsed);
    }

    async getAccountBalances(rawAddress, lookback = 180, ts = null, maxRows = 1000) {
        let chainList = []
        let balances = await this.getAccount(rawAddress, "balances", chainList, maxRows, ts, lookback);
        // TODO: treat "false" case
        return (balances);
    }

    async getAccountUnfinalized(rawAddress, lookback = 180, ts = null, maxRows = 1000) {
        let chainList = []
        let unfinalized = await this.getAccount(rawAddress, "unfinalized", chainList, maxRows, ts, lookback);
        // TODO: treat "false" case
        return (unfinalized);
    }

    page_params(ts, limit, p, chainList, decorate, decorateExtra) {
        let out = `ts=${ts}&limit=${limit}`
        if (p > 0) out += `&p=${p}`
        if (chainList.length > 0) {
            out += `&chainfilters=` + chainList.join(",");
        }
        if (decorate) {
            out += `&decorateExtra=` + decorateExtra.join(",");
        }
        return out;
    }

    async get_account_extrinsics_unfinalized(address, rows, maxRows = 1000, chainList = [], decorate = true, decorateExtra = ["data", "address", "usd", "related"]) {
        let [decorateData, decorateAddr, decorateUSD, decorateRelated] = this.getDecorateOption(decorateExtra)
        let feedItems = 0;
        let isEVMAddr = paraTool.isValidEVMAddress(address)
        var decoratedFeeds = []

        if (rows && rows.length > 0) {
            for (const row of rows) {
                let rowData = row.data
                if (rowData["feedunfinalized"]) {
                    let [addressPiece, ts, extrinsicHashPiece] = paraTool.parse_addressExtrinsic_rowKey(row.id)
                    let extrinsics = rowData["feedunfinalized"];
                    for (const extrinsicHashEventID of Object.keys(extrinsics)) {
                        for (const cell of extrinsics[extrinsicHashEventID]) {
                            var t = JSON.parse(cell.value);
                            if (this.chainFilters(chainList, t.chainID) && feedItems < maxRows && decoratedFeeds[extrinsicHashPiece] == undefined) {
                                let d = await this.decorateExtrinsic(t, t.chainID, "", decorate, decorateExtra)
                                decoratedFeeds[extrinsicHashPiece] = {
                                    extrinsicHash: extrinsicHashPiece,
                                    ts: parseInt(t.ts, 10),
                                    params: t.params,
                                    section: d.section,
                                    method: d.method,
                                    id: d.id,
                                    chainID: parseInt(t.chainID, 10),
                                    chainName: this.getChainName(t["chainID"]),
                                    finalized: 0
                                }
                            }
                            break;
                        }
                    }
                }
                if (rowData["feed"]) {
                    let [addressPiece, ts, extrinsicHashPiece] = paraTool.parse_addressExtrinsic_rowKey(row.id)
                    let extrinsics = rowData["feed"];
                    for (const extrinsicHashEventID of Object.keys(extrinsics)) {
                        for (const cell of extrinsics[extrinsicHashEventID]) {
                            var t = JSON.parse(cell.value);
                            if (this.chainFilters(chainList, t.chainID) && decoratedFeeds[extrinsicHashPiece] != undefined) {
                                decoratedFeeds[extrinsicHashPiece]['extrinsicID'] = t.extrinsicID;
                                decoratedFeeds[extrinsicHashPiece]['blockNumber'] = parseInt(t.blockNumber, 10);
                                decoratedFeeds[extrinsicHashPiece]['ts'] = parseInt(t.ts, 10);
                                decoratedFeeds[extrinsicHashPiece]['finalized'] = 1;
                            }
                            break;
                        }
                    }
                }
            }
        }
        let unfinalized = [];
        for (const extrinsicHash of Object.keys(decoratedFeeds)) {
            unfinalized.push(decoratedFeeds[extrinsicHash])
        }
        return unfinalized
    }

    //cbt read addressextrinsic prefix=0x109d58c19ac53a8cf9fe9793e0ae027d5dada0b79e6f6ee81a8fbe4cb0955649
    async get_account_extrinsics(address, rows, maxRows = 1000, chainList = [], decorate = true, decorateExtra = ["data", "address", "usd", "related"], TSStart = null, pageIndex = 0) {
        let [decorateData, decorateAddr, decorateUSD, decorateRelated] = this.getDecorateOption(decorateExtra)
        let feed = [];
        let feedItems = 0;
        let isEVMAddr = paraTool.isValidEVMAddress(address)
        var decoratedFeeds = []
        let decorateEvents = decorateExtra.includes("events");
        let p = 0;
        let pTS = null;
        if (rows && rows.length > 0) {
            for (const row of rows) {
                let rowData = row.data

                if (rowData["feed"] || (rowData["feedto"])) {
                    let [addressPiece, ts, extrinsicHashPiece] = paraTool.parse_addressExtrinsic_rowKey(row.id)
                    let extrinsics = null;
                    if (rowData["feed"]) {
                        extrinsics = rowData["feed"];
                    } else if (rowData["feedto"]) {
                        extrinsics = rowData["feedto"];
                    }
                    if (pTS != ts) {
                        p = 0;
                        pTS = ts;
                    }
                    for (const extrinsicHashEventID of Object.keys(extrinsics)) {
                        for (const cell of extrinsics[extrinsicHashEventID]) {
                            var t = JSON.parse(cell.value);
                            if (!this.chainFilters(chainList, t.chainID)) {
                                //filter non-specified records .. do not decorate
                                continue
                            }
                            let isEVMTx = (t.transactionHash != undefined) ? true : false
                            if (isEVMTx) {
                                // this is an EVM tx
                                let c = t
                                let decodedInput = t['decodedInput']
                                if (decodedInput != undefined && decodedInput.signature != undefined) {
                                    c.method = decodedInput.methodID
                                    let sa = decodedInput.signature.split('(');
                                    c.section = (sa.length > 0) ? sa[0] : "Unknown";
                                } else {
                                    c.method = "Unknown";
                                    c.section = "Unknown";
                                }
                                if (decorate) {
                                    this.decorateAddress(c, "fromAddress", decorateAddr, decorateRelated)
                                    this.decorateAddress(c, "from", decorateAddr, decorateRelated)
                                }
                                if (c.to && c.to.length > 0) {
                                    if (decorate) this.decorateAddress(c, "to", decorateAddr, decorateRelated)
                                    let assetChain = paraTool.makeAssetChain(c.to.toLowerCase(), c.chainID);
                                    if (this.assetInfo[assetChain]) {
                                        c.assetInfo = this.assetInfo[assetChain];
                                    }
                                }
                                let [_, id] = this.convertChainID(c.chainID)
                                c.id = id;
                                c.chainName = this.getChainName(c.chainID)
                                let cTimestamp = c.timestamp
                                let chainAsset = this.getChainAsset(c.chainID)
                                if (decorateUSD) {
                                    let p = await this.computePriceUSD({
                                        val: c.value,
                                        asset: chainAsset,
                                        chainID: c.chainID,
                                        ts: cTimestamp
                                    });
                                    if (p) {
                                        c.valueUSD = p.valUSD;
                                        c.priceUSD = p.priceUSD;
                                        c.priceUSDCurrent = p.priceUSDCurrent;
                                        c.symbol = p.symbol;
                                        c.feeUSD = c.fee * c.priceUSD;
                                    }
                                } else {
                                    c.symbol = this.getChainSymbol(c.chainID);
                                }
                                c.result = c.status // this is success/fail indicator of the evm tx
                                // decorate transfers
                                if (c.transfers !== undefined && c.transfers.length > 0) {
                                    for (let i = 0; i < c.transfers.length; i++) {
                                        let t = c.transfers[i];
                                        if (decorateAddr) {
                                            this.decorateAddress(t, "from", decorateAddr, decorateRelated)
                                            this.decorateAddress(t, "to", decorateAddr, decorateRelated)
                                        }
                                        let tokenAsset = t.tokenAddress.toLowerCase();
                                        let tokenAssetChain = paraTool.makeAssetChain(tokenAsset, c.chainID);
                                        if (this.assetInfo[tokenAssetChain]) {
                                            t.assetInfo = this.assetInfo[tokenAssetChain];
                                            if (t.assetInfo.decimals !== false) {
                                                t.value = t.value / 10 ** t.assetInfo.decimals;
                                                if (decorateUSD) {
                                                    let p = await this.computePriceUSD({
                                                        val: t.value,
                                                        asset: tokenAsset,
                                                        chainID: c.chainID,
                                                        ts: cTimestamp
                                                    });
                                                    if (p) {
                                                        t.valueUSD = p.valUSD;
                                                        t.priceUSD = p.priceUSD;
                                                        t.priceUSDCurrent = p.priceUSDCurrent;
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                                if (TSStart && (t['ts'] == TSStart) && (p < pageIndex)) {
                                    console.log("SKIPPING (p<pageIndex)", "ts", ts, "ts0", t['ts'], "p", p, "pageIndex", pageIndex)
                                    // skip this until hitting pageIndex
                                    p++;
                                } else if (feedItems < maxRows) {
                                    p++;
                                    decoratedFeeds.push(c)
                                    feedItems++;
                                } else if (feedItems == maxRows) {
                                    return {
                                        data: decoratedFeeds,
                                        nextPage: `/account/extrinsics/${address}?` + this.page_params(ts, maxRows, p, chainList, decorate, decorateExtra)
                                    }
                                    break;
                                }
                            } else {
                                if (t['extrinsicHash'] == undefined) {
                                    t['extrinsicHash'] = extrinsicHashPiece;
                                }
                                if (t['result'] == undefined) {
                                    t['result'] = 1; //mark old record as sucess for now
                                }
                                t['blockNumber'] = parseInt(t.blockNumber, 10);
                                t['chainID'] = parseInt(t.chainID, 10);
                                t['chainName'] = this.getChainName(t["chainID"]);
                                t['nonce'] = parseInt(t.nonce, 10);
                                t['ts'] = parseInt(t.ts, 10);
                                if (t.params) t['params'] = t.params;
                                if (t.events) {
                                    if (decorateEvents) {} else {
                                        delete t['events'];
                                    }
                                }
                                if (TSStart && (t['ts'] == TSStart) && (p < pageIndex)) {
                                    console.log("SKIPPING (p<pageIndex)", "ts", ts, "ts0", t['ts'], "p", p, "pageIndex", pageIndex)
                                    // skip this until hitting pageIndex
                                    p++;
                                } else if (feedItems < maxRows) {
                                    p++;
                                    let d = await this.decorateExtrinsic(t, t.chainID, "", decorate, decorateExtra)
                                    decoratedFeeds.push(d)
                                    feedItems++;
                                } else if (feedItems == maxRows) {
                                    return {
                                        data: decoratedFeeds,
                                        nextPage: `/account/extrinsics/${address}?` + this.page_params(ts, maxRows, p, chainList, decorate, decorateExtra)
                                    }
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }
        return {
            data: decoratedFeeds,
            nextPage: null
        };
    }

    async get_account_transfers(address, rows, maxRows = 1000, chainList = [], decorate = true, decorateExtra = ["data", "address", "usd", "related"], TSStart = null, pageIndex = 0) {
        let [decorateData, decorateAddr, decorateUSD, decorateRelated] = this.getDecorateOption(decorateExtra)
        let feedTransfer = [];
        let feedTransferItems = 0;
        let p = 0;
        let pTS = null;
        let prevKey = false;
        if (rows && rows.length > 0) {
            for (const row of rows) {
                let rowData = row.data
                if (rowData["feedtransfer"]) {
                    let [accKey, ts, extrinsicHash] = paraTool.parse_addressExtrinsic_rowKey(row.id)
                    let extrinsicsTransfer = rowData["feedtransfer"]; // TODO: feedtransferunfinalized
                    if (pTS != ts) {
                        p = 0;
                        pTS = ts;
                    }
                    //transfer:extrinsicHash [rows]
                    //tranfers:extrinsicHash#eventID
                    //tranfers:0x0804ea6287afaf070b7717505770da790785b0b36d34529d51b5c9670ea49cb5#5-324497-0-0 @ 2022/02/01-16:47:48.000000

                    //for each feedtransfer:extrinsicHash row, reverse the cells
                    for (const extrinsicHashEventID of Object.keys(extrinsicsTransfer).reverse()) {
                        //let extrinsicsTransferCells = extrinsicsTransfer[extrinsicHashEventID]
                        //console.log(`extrinsicsTransfer[${extrinsicHashEventID}] length=${extrinsicsTransferCells.length}`)
                        for (const cell of extrinsicsTransfer[extrinsicHashEventID]) {
                            try {
                                let extrinsicHash = extrinsicHashEventID.split('#')[0]
                                let eventID = extrinsicHashEventID.split('#')[1]
                                var t = JSON.parse(cell.value);
                                if (!this.chainFilters(chainList, t.chainID)) {
                                    //filter non-specified records .. do not decorate
                                    continue
                                }
                                //console.log(`extrinsicHash`, t)
                                if (t['extrinsicHash'] != undefined) {
                                    t['extrinsicHash'] = extrinsicHash;
                                }
                                t['blockNumber'] = parseInt(t.blockNumber, 10);
                                t['chainID'] = parseInt(t.chainID, 10);
                                t['chainName'] = this.getChainName(t["chainID"]);

                                let [__, id] = this.convertChainID(t.chainID);
                                t['id'] = id
                                if (t.ts) t['ts'] = parseInt(t.ts, 10);

                                let tt = await this.decorateQueryFeedTransfer(t, t.chainID, decorate, decorateExtra)
                                let currKey = `${tt.extrinsicHash}|${tt.fromAddress}|${tt.toAddress}|${tt.rawAmount}` // it's probably "safe" to check without asset type here.
                                if (currKey == prevKey) {
                                    console.log(`skip duplicate [${tt.eventID}] (${tt.transferType}, ${currKey})`)
                                } else if (TSStart && (t['ts'] == TSStart) && (p < pageIndex)) {
                                    console.log("SKIPPING (p<pageIndex)", "ts", ts, "ts0", t['ts'], "p", p, "pageIndex", pageIndex)
                                    // skip this until hitting pageIndex
                                    p++;
                                } else if (feedTransferItems < maxRows) {
                                    console.log("INCLUDING", "ts", ts, "ts0", t['ts'], "p", p, "pageIndex", pageIndex)
                                    p++;
                                    feedTransfer.push(tt);
                                    feedTransferItems++;
                                } else if (feedTransferItems == maxRows) {
                                    return {
                                        data: feedTransfer,
                                        nextPage: `/account/transfers/${address}?` + this.page_params(ts, maxRows, p, chainList, decorate, decorateExtra)
                                    }
                                }
                                console.log("prevkey SET", currKey);
                                prevKey = currKey
                            } catch (err) {
                                // bad data
                                console.log(err);
                            }
                            break;
                        }
                    }
                }
            }
        }
        return {
            data: feedTransfer,
            nextPage: null
        }
    }

    async get_account_evmtransfers(address, rows, maxRows = 1000, chainList = [], decorate = true, decorateExtra = ["data", "address", "usd", "related"], TSStart = null, pageIndex = 0) {
        let [decorateData, decorateAddr, decorateUSD, decorateRelated] = this.getDecorateOption(decorateExtra)
        let feedTransfer = [];
        let feedTransferItems = 0;
        let p = 0;
        let pTS = null;
        let prevKey = false;
        if (rows && rows.length > 0) {
            for (const row of rows) {
                let rowData = row.data
                if (rowData["feedevmtransfer"]) {
                    let [accKey, ts, transactionHash] = paraTool.parse_addressExtrinsic_rowKey(row.id)
                    let transactionsTransfer = rowData["feedevmtransfer"];
                    if (pTS != ts) {
                        p = 0;
                        pTS = ts;
                    }
                    //transfer:extrinsicHash [rows]
                    //tranfers:extrinsicHash#eventID
                    //tranfers:0x0804ea6287afaf070b7717505770da790785b0b36d34529d51b5c9670ea49cb5#5-324497-0-0 @ 2022/02/01-16:47:48.000000

                    //for each feedevmtransfer:extrinsicHash row, cell come in reverse order
                    for (const transactionHashEventID of Object.keys(transactionsTransfer).reverse()) {
                        //console.log(`extrinsicsTransfer[${extrinsicHashEventID}] length=${extrinsicsTransferCells.length}`)
                        for (const cell of transactionsTransfer[transactionHashEventID]) {
                            try {
                                let transactionHash = transactionHashEventID.split('#')[0]
                                let eventID = transactionHashEventID.split('#')[1]
                                var t = JSON.parse(cell.value);
                                if (!this.chainFilters(chainList, t.chainID)) {
                                    //filter non-specified records .. do not decorate
                                    continue
                                }
                                t['transactionHash'] = transactionHash;
                                t['blockNumber'] = parseInt(t.blockNumber, 10);
                                t['chainID'] = parseInt(t.chainID, 10);
                                t['chainName'] = this.getChainName(t["chainID"]);

                                let [__, id] = this.convertChainID(t.chainID);
                                t['id'] = id
                                if (t.ts) t['ts'] = parseInt(t.ts, 10);

                                let tt = await this.decorateQueryFeedEVMTransfer(t, t.chainID, decorate, decorateExtra)
                                let currKey = `${transactionHash}|${t.from}|${t.to}|${t.value}` // it's probably "safe" to check without asset type here.
                                if (currKey == prevKey) {
                                    console.log(`skip duplicate [${tt.eventID}] (${currKey})`)
                                } else if (TSStart && (t['ts'] == TSStart) && (p < pageIndex)) {
                                    console.log("SKIPPING (p<pageIndex)", "ts", ts, "ts0", t['ts'], "p", p, "pageIndex", pageIndex)
                                    // skip this until hitting pageIndex
                                    p++;
                                } else if (feedTransferItems < maxRows) {
                                    console.log("INCLUDING", "ts", ts, "ts0", t['ts'], "p", p, "pageIndex", pageIndex)
                                    p++;
                                    feedTransfer.push(tt);
                                    feedTransferItems++;
                                } else if (feedTransferItems == maxRows) {
                                    return {
                                        data: feedTransfer,
                                        nextPage: `/account/evmtransfers/${address}?` + this.page_params(ts, maxRows, p, chainList, decorate, decorateExtra)
                                    }
                                }
                                console.log("prevkey SET", currKey);
                                prevKey = currKey
                            } catch (err) {
                                // bad data
                                console.log(err);
                            }
                            break;
                        }
                    }
                }
            }
        }
        return {
            data: feedTransfer,
            nextPage: null
        }
    }


    // column: link
    // cell value: { title, description, metadata, linktype }
    async get_hashes_related(address, relatedData, hashesType = "address") {
        console.log("get_hashes_related", address);
        let related = [];
        if (relatedData) {
            for (const col of Object.keys(relatedData)) {
                let cell = relatedData[col];
                try {
                    let res = JSON.parse(cell[0].value)

                    related.push(res);
                    if (res.description == "Reversed H160 Address") {
                        let reverseAddr = res.title
                        related.push({
                            "datasource": "NativeH160",
                            "url": "/account/" + reverseAddr, //this redirect to NativeH160 (moonbeam/moonriver case)
                            "title": reverseAddr,
                            "description": `Native H160 Address (Moonbeam, Moonriver)`,
                            "linktype": "address",
                            "metadata": {}
                        });
                    }
                } catch (err) {
                    console.log("RELATED ERR", err);
                }
            }
        }
        if (hashesType == "address") {
            if (paraTool.isValidSubstratePublicKey(address)) {
                // ss58Pubkey
                let ss58Pubkey = paraTool.getPubKey(address)
                related.push({
                    "datasource": "SS58",
                    "url": "/account/" + ss58Pubkey,
                    "title": ss58Pubkey,
                    "description": "SS58 Public Key",
                    "linktype": "address",
                    "metadata": {}
                });

                // ss58 substrate universal
                let substrateAddr = paraTool.getAddress(address, 42)
                related.push({
                    "datasource": "SS58",
                    "url": "/account/" + substrateAddr,
                    "title": substrateAddr,
                    "description": `SS58 Address: Substrate (Prefix: 42)`,
                    "linktype": "address",
                    "metadata": {}
                });
                // H160 link for this address
                let evmH160 = paraTool.pubkeyToH160(address)
                let h160SS58Pubkey = paraTool.h160ToPubkey(evmH160)
                let h160SubstrateAddr = paraTool.getAddress(h160SS58Pubkey)
                // h160SS58Pubkey is derived as first 20bytes of blake2("evm:20bytes(ss58Pubkey)), which is different from the original ss58Pubkey
                related.push({
                    "datasource": "H160",
                    "url": "/account/" + h160SS58Pubkey, // evmH160 is not directly searchable in our system. will have to redirect user to h160SS58Pubkey
                    "title": evmH160,
                    "description": `H160 Address`,
                    "linktype": "address",
                    "metadata": {}
                });

                /* H160 Public Key is too confusing, let's not show it
                related.push({
                    "datasource": "H160",
                    "url": "/account/" + h160SS58Pubkey,
                    "title": h160SS58Pubkey,
                    "description": `H160 Public Key`,
                    "linktype": "address",
                    "metadata": {}
                });
                related.push({
                    "datasource": "H160",
                    "url": "/account/" + h160SubstrateAddr,
                    "title": h160SubstrateAddr,
                    "description": `H160 SS58 Address: Substrate (Prefix: 42)`,
                    "linktype": "address",
                    "metadata": {}
                });
                */
                // add networkID based SS58 generation
                for (const chainID of Object.keys(this.chainInfos)) {
                    let chainName = this.getChainName(chainID);
                    let ss58Format = this.chainInfos[chainID].ss58Format;
                    let evmSS58 = paraTool.getAddress(address, ss58Format)
                    related.push({
                        "datasource": "SS58",
                        "url": "/account/" + evmSS58,
                        "title": evmSS58,
                        "description": `SS58 Address: ${chainName} (Prefix: ${ss58Format})`,
                        "linktype": "address",
                        "metadata": {}
                    });
                }
            } else if (paraTool.isValidEVMAddress(address)) {
                // Note: Astar public key ss58 generation -> recovery original ss58 from evmAddress is not possible
                // TODO: add xrc20 generation .. if the address is a contract Address
                // Input is H160 for this address
                let evmH160 = address
                let h160SS58Pubkey = paraTool.h160ToPubkey(evmH160)
                let h160SubstrateAddr = paraTool.getAddress(h160SS58Pubkey)
                // h160SS58Pubkey is derived as first 20bytes of blake2("evm:20bytes(ss58Pubkey)), which is different from the original ss58Pubkey
                related.push({
                    "datasource": "H160",
                    "url": "/account/" + h160SS58Pubkey, // evmH160 is not directly searchable in our system. will have to redirect user to h160SS58Pubkey
                    "title": evmH160,
                    "description": `H160 Address`,
                    "linktype": "address",
                    "metadata": {}
                });
                related.push({
                    "datasource": "NativeH160",
                    "url": "/account/" + address, //this redirect to NativeH160 (moonbeam/moonriver case)
                    "title": address,
                    "description": `Native H160 Address (Moonbeam, Moonriver)`,
                    "linktype": "address",
                    "metadata": {}
                });
            }
        }
        return (related)
    }

    async getMultiAccount(rawAddresses, requestedChainID = 0, chainList = []) {
        let addresses = []
        for (let i = 0; i < rawAddresses.length; i++) {
            let x = paraTool.getPubKey(rawAddresses[i]);
            if (x) addresses.push(x);
        }
        let accounts = [];
        if (addresses.length == 0) return (accounts);
        try {
            let [tblName, tblRealtime] = this.get_btTableRealtime()
            const filter = [{
                column: {
                    cellLimit: 1
                },
                families: ["realtime", "evmcontract", "wasmcontract", "label"],
                limit: 10,
            }];

            let [rows] = await tblRealtime.getRows({
                keys: addresses,
                filter
            });


            for (const row of rows) {
                let address = row.id;
                let rowData = row.data;
                let isEVMAddr = paraTool.isValidEVMAddress(address)
                let [assets, contract, labels] = await this.get_account_realtime(address, rowData["realtime"], rowData["evmcontract"], rowData["wasmcontract"], rowData["label"], chainList)
                let chainsMap = {};
                for (let i = 0; i < assets.length; i++) {
                    let a = assets[i];
                    let chainID = a.assetInfo.chainID;
                    if (chainsMap[chainID] == undefined) {
                        let chainInfo = this.chainInfos[chainID];
                        var id, chainName, ss58Format, ss58Address, iconUrl, subscanURL, dappURL, WSEndpoint;
                        if (chainInfo !== undefined) {
                            chainName = this.getChainName(chainID);
                            id = chainInfo.id;
                            ss58Format = this.chainInfos[chainID].ss58Format;
                            ss58Address = isEVMAddr ? false : paraTool.getAddress(address, ss58Format);
                            iconUrl = this.chainInfos[chainID].iconUrl;
                            subscanURL = this.chainInfos[chainID].subscanURL;
                            dappURL = this.chainInfos[chainID].dappURL;
                            WSEndpoint = this.chainInfos[chainID].WSEndpoint;
                        }
                        chainsMap[chainID] = {
                            chainID,
                            chainName,
                            id,
                            ss58Format,
                            ss58Address,
                            iconUrl,
                            subscanURL,
                            dappURL,
                            WSEndpoint,
                            assets: [],
                            balanceUSD: 0
                        };
                    }
                    let o = a.assetInfo;
                    o.state = a.state;
                    chainsMap[a.assetInfo.chainID].assets.push(o);
                }

                // if we didn't get any assets at all for the requestedChainID, synthesize a 0 asset record so that the user can see it
                if (chainsMap[requestedChainID] == undefined && this.chainInfos[requestedChainID] != undefined) {
                    let chainInfo = this.chainInfos[requestedChainID];
                    let chainName = this.getChainName(requestedChainID);
                    let id = chainInfo.id;
                    let ss58Format = chainInfo.ss58Format;
                    let ss58Address = isEVMAddr ? false : paraTool.getAddress(address, ss58Format);
                    let iconUrl = chainInfo.iconUrl;
                    let zeroAssets = [];
                    chainsMap[requestedChainID] = {
                        chainID: requestedChainID,
                        chainName,
                        id,
                        ss58Format,
                        ss58Address,
                        iconUrl,
                        assets: zeroAssets,
                        balanceUSD: 0
                    }
                }
                // turn chainsMap into chains array, and compute balanceUSD
                let chains = [];
                let balanceUSD = 0;
                for (const chainID of Object.keys(chainsMap)) {
                    let chain = chainsMap[chainID];
                    let chainBalanceUSD = 0;
                    for (let j = 0; j < chain.assets.length; j++) {
                        let a = chain.assets[j];
                        if (a.state.balanceUSD !== undefined && !isNaN(a.state.balanceUSD)) {
                            chainBalanceUSD += a.state.balanceUSD;
                        }
                    }
                    chain.assets.sort(function(a, b) {
                        let bBalance = (b.state.balanceUSD !== undefined) ? b.state.balanceUSD : 0;
                        let aBalance = (a.state.balanceUSD !== undefined) ? a.state.balanceUSD : 0;
                        if (aBalance != bBalance) {
                            return (bBalance - aBalance);
                        }
                        let bFree = b.state.free !== undefined ? b.state.free : 0;
                        let aFree = a.state.free !== undefined ? a.state.free : 0;
                        if (aFree != bFree) {
                            return (bFree - aFree);
                        }
                        return 0;
                    })
                    chain.balanceUSD = chainBalanceUSD;
                    balanceUSD += chain.balanceUSD;
                    chains.push(chain);
                }

                // check asc vs desc
                chains.sort(function(a, b) {
                    if (requestedChainID == a.chainID) {
                        return -1;
                    }
                    if (requestedChainID == b.chainID) {
                        return 1;
                    }
                    let bBalance = b.balanceUSD;
                    let aBalance = a.balanceUSD;
                    if (aBalance != bBalance) {
                        return (bBalance - aBalance);
                    }
                    let bAssets = b.assets.length;
                    let aAssets = a.assets.length;
                    if (aAssets != bAssets) {
                        return (bAssets - aAssets);
                    }
                    return (a.chainID - b.chainID);
                })


                let requestedChainPrefix = null;
                if (requestedChainID) {
                    requestedChainPrefix = this.getChainPrefix(requestedChainID);
                } else if (chains.length > 0) {
                    requestedChainPrefix = chains[0].ss58Format;
                } else {
                    requestedChainPrefix = 0;
                }
                let requestedChainAddress = isEVMAddr ? address : paraTool.getAddress(address, requestedChainPrefix)
                let account = {
                    address,
                    requestedChainAddress,
                    requestedChainPrefix,
                    balanceUSD,
                    chains,
                    labels,
                    numFollowing: 0,
                    numFollowers: 0,
                    isFollowing: false,
                    nickname: null,
                    info: null,
                    judgements: null,
                    infoKSM: null,
                    judgementsKSM: null,
                    related: null
                }

                let a = this.lookup_account(address);
                if (a) {
                    account.nickname = a.nickname;
                    try {
                        if (a.parentDisplay != null && a.subName) {
                            account.subName = `${a.parentDisplay}/${a.subName}`
                            account.parent = a.parent
                        } else if (a.parentDisplayKSM != null && a.subNameKSM) {
                            account.subName = `${a.parentDisplayKSM}/${a.subNameKSM}`
                            account.parent = a.parentKSM
                        } else {
                            account.subName = null;
                        }
                        account.info = (a.info != null) ? a.info : null;
                        account.judgements = (a.judgements != null) ? a.judgements : null;
                        account.infoKSM = (a.infoKSM != null) ? a.infoKSM : null;
                        account.judgementsKSM = (a.judgementsKSM != null) ? a.judgementsKSM : null;
                        account.related = (a.related != null) ? a.related : null;
                    } catch (e) {
                        console.log(e)
                    }
                    account.numFollowers = a.numFollowers;
                    account.numFollowing = a.numFollowing;
                }

                accounts.push(account);
            }
        } catch (err) {
            console.log("getMultiAccount", err);
            throw err;
        }

        return (accounts);
    }

    async get_account_realtime(address, realtimeData, evmcontractData, wasmcontractData, labelData, chainList = []) {
        let realtime = {};
        let contract = null;
        let labels = {};
        if (realtimeData) {
            let lastCellTS = {};
            for (const assetChainEncoded of Object.keys(realtimeData)) {
                let cell = realtimeData[assetChainEncoded];
                let assetChain = paraTool.decodeAssetChain(assetChainEncoded);
                let [asset, chainID] = paraTool.parseAssetChain(assetChain);
                if (!this.chainFilters(chainList, chainID)) {
                    //filter non-specified records .. do not decorate
                    continue
                }
                if (chainID !== undefined) {
                    try {
                        let assetInfo = this.assetInfo[assetChain];
                        if (assetInfo == undefined) {
                            try {
                                let assetType = "Token"; // /ERC20/ERC20LP/...
                                if (realtime[assetType] == undefined) {
                                    realtime[assetType] = [];
                                }
                                let c = JSON.parse(cell[0].value);
                                if (c.symbol && c.balance) {
                                    let chainName = this.getChainName(chainID);
                                    realtime[assetType].push({
                                        assetChain,
                                        assetInfo: {
                                            asset,
                                            chainName,
                                            symbol: c.symbol,
                                            chainID,
                                            assetName: c.symbol,
                                            assetType
                                        },
                                        state: {
                                            free: c.balance,
                                            balanceUSD: c.valueUSD
                                        }
                                    })
                                }
                            } catch (err) {
                                console.log(err)
                            }
                        } else {
                            let assetType = assetInfo.assetType;
                            if (realtime[assetType] == undefined) {
                                realtime[assetType] = [];
                            }
                            let cellTS = cell[0].timestamp / 1000000;
                            if ((lastCellTS[assetChain] == undefined) || (lastCellTS[assetChain] > cellTS)) {
                                realtime[assetType].push({
                                    assetChain,
                                    assetInfo,
                                    state: JSON.parse(cell[0].value)
                                });
                                lastCellTS[assetChain] = cellTS;
                            }
                        }
                    } catch (err) {
                        console.log("REALTIME ERR", err);
                    }
                }
            }
        }
        let totalUSDVal = await this.compute_holdings_USD(realtime);

        let current = [];
        let covered = {};
        for (const k of Object.keys(realtime)) {
            let kassets = realtime[k];
            for (let j = 0; j < kassets.length; j++) {
                if (!covered[kassets[j].assetChain]) {
                    covered[kassets[j].assetChain] = true;
                    let a = kassets[j]
                    if (a != undefined && a.state != undefined) {
                        let aState = a.state
                        if (aState.free || aState.reserved || aState.miscFrozen || aState.feeFrozen || aState.frozen || aState.supplied || aState.borrowed) {
                            current.push(kassets[j]);
                        }
                    }
                }
            }
        }
        //console.log("REALTIME", realtime, "totalUSDVAL", totalUSDVal, "current", current);

        if (evmcontractData) {
            let lastCellTS = {};
            for (const chainID of Object.keys(evmcontractData)) {
                let cells = evmcontractData[chainID];
                if (!this.chainFilters(chainList, chainID)) {
                    //filter non-specified records .. do not decorate
                    continue
                }
                contract = JSON.parse(cells[0].value)
                break;
            }

        } else if (wasmcontractData) {
            let lastCellTS = {};
            for (const chainID of Object.keys(wasmcontractData)) {
                let cell = wasmcontractData[chainID];
                if (!this.chainFilters(chainList, chainID)) {
                    //filter non-specified records .. do not decorate
                    continue
                }
                contract = JSON.parse(cell[0].value)
                break;
            }
            // TODO
        }

        if (labelData) {
            for (const labelType of Object.keys(labelData)) {
                let cell = labelData[labelType];
                let label = JSON.parse(cell[0].value)
                labels[labelType] = label;
            }
        }

        return [current, contract, labels];
    }

    async get_account_history(address, rows, maxRows = 1000, chainList = [], daily = false) {
        let history = {};
        let nHistoryItems = 0;
        let minTS = 0;
        let logDT = false;
        let logDTStr = "";
        let dailyhistory = {};
        if (rows && rows.length > 0) {
            for (const row of rows) {
                let rowData = row.data
                if (rowData["history"]) {
                    let historyData = rowData["history"];
                    let [accKey, ts] = paraTool.parse_addressHistory_rowKey(row.id)
                    for (const assetChainEncoded of Object.keys(historyData)) {
                        let assetChain = paraTool.decodeAssetChain(assetChainEncoded)
                        let [asset, chainID] = paraTool.parseAssetChain(assetChain);
                        if (!this.chainFilters(chainList, chainID)) {
                            //filter non-specified records .. do not decorate
                            continue
                        }
                        if (this.assetInfo[assetChain] !== undefined) {
                            let assetInfo = this.assetInfo[assetChain];
                            let assetType = assetInfo.assetType;
                            let targetAsset = assetInfo.asset;
                            for (const cell of historyData[assetChainEncoded]) {
                                var state = JSON.parse(cell.value);
                                let indexTS = cell.timestamp / 1000000;
                                if (history[assetChain] == undefined) {
                                    history[assetChain] = {
                                        assetInfo: assetInfo,
                                        states: []
                                    };
                                }
                                let flds = this.get_assetType_flds(assetType);
                                //compute asset history..
                                await this.decorate_assetState(assetInfo, state, flds, indexTS);
                                //console.log(`indexTS=${indexTS}`, decoratedState)
                                if (daily) {
                                    logDT = (daily) ? Math.round(indexTS / 86400) : 0;
                                    logDTStr = `${assetChain}-${logDT}`;
                                }
                                // if daily is true, we only want a single record (the first one) for each day for each assetChain
                                if ((nHistoryItems < maxRows && daily == false) || (daily && dailyhistory[logDTStr] == undefined)) {
                                    history[assetChain].states.push([indexTS, state]);
                                    if (daily) {
                                        dailyhistory[logDTStr] = true;
                                    }
                                    nHistoryItems++;
                                    minTS = ts
                                } else if (nHistoryItems == maxRows) {
                                    return {
                                        data: history,
                                        nextPage: `/account/history/${address}?` + this.page_params(ts, maxRows, p, chainList, decorate, decorateExtra),
                                        minTS
                                    }
                                }
                                break;
                            }
                        }
                    }
                }
            }
        }
        return {
            data: history,
            nextPage: null,
            minTS
        }
    }

    async get_account_crowdloans(address, rows, maxRows = 1000, chainList = [], decorate = true, decorateExtra = ["data", "address", "usd", "related"], TSStart = null, pageIndex = 0) {
        let [decorateData, decorateAddr, decorateUSD, decorateRelated] = this.getDecorateOption(decorateExtra)
        let crowdloans = [];
        let numItems = 0;
        let p = 0;
        let pTS = null;
        if (rows && rows.length > 0) {
            //console.log(`address=${address}, row.length=${rows.length}`)
            for (const row of rows) {
                let rowData = row.data
                if (rowData["feedcrowdloan"]) {
                    let crowdloansData = rowData["feedcrowdloan"];
                    let [accKey, ts, extrinsicHash] = paraTool.parse_addressExtrinsic_rowKey(row.id)
                    if (pTS != ts) {
                        p = 0;
                        pTS = ts;
                    }
                    for (const extrinsicHashEventID of Object.keys(crowdloansData)) {
                        //feedcrowdloan:extrinsicHash#eventID
                        //feedcrowdloan:0x4d709ef89a0d8b1f9c65b74ca87726cc236a4f1255738f3015944e5a20d712c8#0-7652261-7-47
                        for (const cell of crowdloansData[extrinsicHashEventID]) {
                            try {
                                var t = JSON.parse(cell.value);
                                if (!this.chainFilters(chainList, t.chainID)) {
                                    //filter non-specified records .. do not decorate
                                    continue
                                }
                                let extrinsicHash = extrinsicHashEventID.split('#')[0]
                                t['blockNumber'] = parseInt(t.blockNumber, 10);
                                t['chainID'] = parseInt(t.chainID, 10);
                                t['chainName'] = this.getChainName(t["chainID"]);
                                t['asset'] = this.getChainAsset(t["chainID"]);
                                if (decorateUSD) {
                                    let p = await this.computePriceUSD({
                                        val: t['amount'],
                                        asset: t['asset'],
                                        chainID: t['chainID'],
                                        ts: t['ts']
                                    });
                                    if (p) {
                                        t['amountUSD'] = p.valUSD;
                                        t['priceUSD'] = p.priceUSD;
                                        t['priceUSDCurrent'] = p.priceUSDCurrent;
                                    }
                                }
                                let relayChain = paraTool.getRelayChainByChainID(parseInt(t['chainID'], 10))
                                t['chainIDDest'] = paraTool.getChainIDFromParaIDAndRelayChain(parseInt(t['paraID'], 10), relayChain);

                                if (t['chainIDDest']) {
                                    t['chainDestName'] = this.getChainName(t['chainIDDest']);
                                    if (this.chainInfos[t['chainIDDest']] != undefined) {
                                        t['id'] = this.chainInfos[t['chainIDDest']].id;
                                        t['iconUrl'] = this.chainInfos[t['chainIDDest']].iconUrl;
                                        t['dappURL'] = this.chainInfos[t['chainIDDest']].dappURL;
                                        t['parachainsURL'] = this.chainInfos[t['chainIDDest']].parachainsURL;
                                    }
                                    if (TSStart && (t['ts'] == TSStart) && (p < pageIndex)) {
                                        console.log("SKIPPING (p<pageIndex)", "ts", ts, "ts0", t['ts'], "p", p, "pageIndex", pageIndex)
                                        // skip this until hitting pageIndex
                                        p++;
                                    } else if (numItems < maxRows) {
                                        p++;
                                        crowdloans.push(t);
                                        numItems++;
                                    } else if (numItems == maxRows) {
                                        return {
                                            data: crowdloans,
                                            nextPage: `/account/crowdloans/${address}?` + this.page_params(ts, maxRows, p, chainList, decorate, decorateExtra),
                                        }
                                    }
                                }
                                break;
                            } catch (err) {
                                console.log(err);
                            }
                        }
                    }
                } else {
                    console.log(`address=${address}, rowData["feedcrowdloan"] not set`, row)
                }
            }
        }
        return {
            data: crowdloans,
            nextPage: null
        }
    }

    async get_account_rewards(address, rows, maxRows = 1000, chainList = [], decorate = true, decorateExtra = ["data", "address", "usd", "related"], TSStart = null, pageIndex = 0) {
        let [decorateData, decorateAddr, decorateUSD, decorateRelated] = this.getDecorateOption(decorateExtra)
        let rewards = [];
        let numItems = 0;
        let p = 0;
        let pTS = null;

        if (rows && rows.length > 0) {
            for (const row of rows) {
                let rowData = row.data
                if (rowData["feedreward"]) {
                    let [accKey, ts, extrinsicHash] = paraTool.parse_addressExtrinsic_rowKey(row.id)
                    if (pTS != ts) {
                        p = 0;
                        pTS = ts;
                    }
                    let rewardsData = rowData["feedreward"];
                    for (const extrinsicHashEventID of Object.keys(rewardsData)) {
                        //feedreward:extrinsicHash#eventID
                        //feedreward:0x0d27e60509f22a8d313fd69aa02442b23935e2ce9699b5a87a94eae8cc4c08c2#5-324060-2-58 @ 2022/02/01-15:17:12.000000
                        for (const cell of rewardsData[extrinsicHashEventID]) {
                            try {
                                var t = JSON.parse(cell.value);
                                if (!this.chainFilters(chainList, t.chainID)) {
                                    //filter non-specified records .. do not decorate
                                    continue
                                }
                                let extrinsicHash = extrinsicHashEventID.split('#')[0]
                                t['blockNumber'] = parseInt(t.blockNumber, 10);
                                t['chainID'] = parseInt(t.chainID, 10);
                                t['chainName'] = this.getChainName(t["chainID"]);
                                let [__, id] = this.convertChainID(t.chainID);
                                t['id'] = id
                                t['asset'] = this.getChainAsset(t["chainID"]);
                                if (decorateUSD) {
                                    let p = await this.computePriceUSD({
                                        val: t['amount'],
                                        asset: t['asset'],
                                        chainID: t['chainID'],
                                        ts: t['ts']
                                    });
                                    if (p) {
                                        t['amountUSD'] = p.valUSD;
                                        t['priceUSD'] = p.priceUSD;
                                        t['priceUSDCurrent'] = p.priceUSDCurrent;
                                    }
                                }
                                if (TSStart && (t['ts'] == TSStart) && (p < pageIndex)) {
                                    console.log("SKIPPING (p<pageIndex)", "ts", ts, "ts0", t['ts'], "p", p, "pageIndex", pageIndex)
                                    // skip this until hitting pageIndex
                                    p++;
                                } else if (numItems < maxRows) {
                                    p++;
                                    rewards.push(t);
                                    numItems++;
                                } else if (numItems == maxRows) {
                                    return {
                                        data: rewards,
                                        nextPage: `/account/rewards/${address}?` + this.page_params(ts, maxRows, p, chainList, decorate, decorateExtra),
                                    }
                                }
                                break;
                            } catch (err) {
                                console.log(err);
                            }
                        }
                    }
                }
            }
        }
        return {
            data: rewards,
            nextPage: null
        }
    }

    clean_extrinsic_object(o) {
        if (o.chainID && typeof o.chainID == "string") {
            o.chainID = parseInt(o.chainID, 10);
        }
        if (o.chainIDDest && typeof o.chainIDDest == "string") {
            o.chainIDDest = parseInt(o.chainIDDest, 10);
        }
        if (o.blockNumber && typeof o.blockNumber == "string") {
            o.blockNumber = parseInt(o.blockNumber, 10);
        }
        return (o);
    }

    async getAccountFeed(fromAddress, chainList = [], maxRows = 1000, decorate = true, decorateExtra = ["data", "address", "usd", "related"], pageIndex = 0) {

        let [decorateData, decorateAddr, decorateUSD, decorateRelated] = this.getDecorateOption(decorateExtra)

        let following = await this.getFollowing(fromAddress);
        let feed = [];
        if ((following == false) || (following.length == 0)) return (feed);
        let TSStart = this.currentTS() - 86400 * 3;
        let ranges = [];

        for (const f of following) {
            let startRow = f.toAddress;
            let endRow = f.toAddress + "#" + paraTool.inverted_ts_key(TSStart)
            // build filter for getRows call below
            ranges.push({
                start: startRow,
                end: endRow
            })
        }
        if (ranges.length == 0) {
            return (feed);
        }
        try {
            let [rows] = await this.btAddressExtrinsic.getRows({
                ranges: ranges,
                filter: [{
                    family: ["feed"],
                    cellLimit: 1
                }],
                limit: maxRows
            });
            let extrinsics = await this.get_account_extrinsics(fromAddress, rows, maxRows, chainList, decorate, decorateExtra);
            if (extrinsics.data) {
                for (let d = 0; d < extrinsics.data.length; d++) {
                    feed.push(extrinsics.data[d]);
                }
            }
        } catch (err) {
            this.logger.error({
                "op": "query.getAccountFeed",
                chainID,
                blockNumber,
                blockHash,
                err
            });

        }
        return {
            data: feed,
            nextPage: null
        };

    }

    async getBlockNumberByTS(chainID, ts, rangebackward = -1, rangeforward = 60) {
        let startTS = ts + rangebackward;
        let endTS = ts + rangeforward;
        let b0 = null;
        let b1 = null;
        let sql = `select blockNumber, blockDT, unix_timestamp(blockDT) as blockTS from block${chainID} where blockDT >= from_unixtime(${startTS}) and blockDT <= from_unixtime(${endTS}) order by blockNumber`;
        let blocks = await this.poolREADONLY.query(sql);
        for (let i = 0; i < blocks.length; i++) {
            let block = blocks[i];
            if (i == 0) {
                b0 = block.blockNumber;
            }
            if (i == blocks.length - 1) {
                b1 = block.blockNumber;
            }
        }
        return [b0, b1];
    }

    async getAccountRelated(address, decorate = true, decorateExtra = ["data", "address", "usd"]) {
        try {
            let [decorateData, decorateAddr, decorateUSD, decorateRelated] = this.getDecorateOption(decorateExtra)

            let a = this.lookup_account(address);
            if (a && a.related != undefined) {
                let related = [];
                for (let i = 0; i < a.related.length; i++) {
                    // TODO: add try catch
                    let r = a.related[i]
                    let r0 = JSON.parse(JSON.stringify(r));
                    if (decorate) {
                        this.decorateAddresses(r0, "signatories", decorateAddr, decorateRelated)
                        this.decorateAddresses(r0, "other_signatories", decorateAddr, decorateRelated)
                        this.decorateAddress(r0, "delegateOf", decorateAddr, decorateRelated);
                        this.decorateAddress(r0, "delegate", decorateAddr, decorateRelated);
                    }
                    delete r0.address;
                    related.push(r0);
                }
                return related;
            }
        } catch (err) {
            console.log(err);
        }
        return [];
    }

    async getAccountOffers(address, limit = 1000, decorate = true, decorateExtra = ["data", "address", "usd", "related"]) {
        let sql = `select offer.offerID, offer.description, startDT, rewardAmount, rewardSymbol, rewardClaimed, chainID, blockNumber, blockTS, extrinsicID, extrinsicHash, claimDT from addressoffer join offer on addressoffer.offerID = offer.offerID where address = '${address}'`
        let claims = await this.poolREADONLY.query(sql);
        return claims;
    }

    async getSponsorOffers() {
        let sql = `select offerID, addressSponsor, balanceUSDMin, description, section, method, reward, symbol, targeting from offer where status = 'Active'`
        let offers = await this.poolREADONLY.query(sql);
        return offers;
    }

    getAddressTopNFilters() {
        return [{
                filter: 'balanceUSD',
                display: "Balance USD",
                type: "currency"
            }, {
                filter: 'numChains',
                display: "# Chains",
                type: "number"
            }, {
                filter: 'numAssets',
                display: "# Assets",
                type: "number"
            }, {
                filter: 'numTransfersIn',
                display: "# Transfers In",
                type: "number"
            }, {
                filter: 'avgTransferInUSD',
                display: "Avg Transfer In (USD)",
                type: "currency"
            }, {
                filter: 'sumTransferInUSD',
                display: "Total Transfers In (USD)",
                type: "currency"
            }, {
                filter: 'numTransfersOut',
                display: "# Transfers Out",
                type: "number"
            }, {
                filter: 'avgTransferOutUSD',
                display: "Avg Transfer Out (USD)",
                type: "currency"
            }, {
                filter: 'sumTransferOutUSD',
                display: "Total Transfers Out (USD)",
                type: "currency"
            }, {
                filter: 'numExtrinsics',
                display: "# Extrinsics",
                type: "number"
            }, {
                filter: 'numExtrinsicsDefi',
                display: "# Extrinsics (Defi)",
                type: "number"
            }, {
                filter: 'numCrowdloans',
                display: "# Crowdloans",
                type: "number"
            },
            //{filter:'numSubAccounts', display: "# Subaccounts", type: "number"},
            {
                filter: 'numRewards',
                display: "# Rewards",
                type: "number"
            }, {
                filter: 'rewardsUSD',
                display: "Rewards (USD)",
                type: "currency"
            }
        ];
    }

    async getAddressTopN(topN = "balanceUSD", decorate = true, decorateExtra = ["data", "address", "usd", "related"]) {
        let topNfilters = this.getAddressTopNFilters().map((f) => (f.filter));
        if (!topNfilters.includes(topN)) {
            throw new InvalidError(`Invalid filter ${topN}`)
        }
        let [decorateData, decorateAddr, decorateUSD, decorateRelated] = this.getDecorateOption(decorateExtra)

        let sql = `select N, address, balanceUSD, val from addressTopN where topN = '${topN}' order by N asc`
        let addressTopN = await this.poolREADONLY.query(sql);
        for (let i = 0; i < addressTopN.length; i++) {
            let a = addressTopN[i];
            if (decorate) this.decorateAddress(a, "address", decorateAddr, decorateRelated)
        }
        return addressTopN;
    }

    async getAddressContract(rawAddress, chainID) {
        let address = paraTool.getPubKey(rawAddress)
        if (!this.validAddress(address)) {
            throw new paraTool.InvalidError(`Invalid address ${address}`)
        }
        let labels = [];
        let realtime = {};
        let w = (chainID) ? `and asset.chainID = '${chainID}'` : ""
        let contract = null;
        let assetChain = chainID ? paraTool.makeAssetChain(address, chainID) : "";
        if (this.xcContractAddress[address] != undefined) {
            let sql = `select asset.asset, asset.assetType, asset.symbol as localSymbol, asset.assetName, asset.chainID, asset.priceUSD, asset.totalSupply, asset.numHolders, asset.decimals, xcmasset.symbol from asset left join xcmasset on asset.xcmInteriorKey = xcmasset.xcmInteriorKey where asset.xcContractAddress = '${rawAddress}' and asset.assetType = 'Token' ${w}`
            let extraRecs = await this.poolREADONLY.query(sql)
            if (extraRecs.length == 1) {
                console.log("getAddressContract XCCONTRACT UNAMBIGUOUS", extraRecs.length, sql);
                let e = extraRecs[0];
                var p = await this.computePriceUSD({
                    asset: e.asset,
                    chainID: e.chainID
                });
                contract = {};
                contract.assetName = e.assetName;
                contract.symbol = e.symbol;
                let [__, id] = this.convertChainID(e.chainID)
                let chainName = this.getChainName(e.chainID);
                contract.chainID = e.chainID;
                contract.id = id;
                contract.assetType = e.assetType;
                contract.chainName = chainName;
                contract.localSymbol = e.localSymbol;
                if (p) contract.priceUSD = p.priceUSDCurrent;
                contract.totalSupply = e.totalSupply;
                contract.numHolders = e.numHolders;
                contract.decimals = e.decimals;
            } else {
                console.log("getAddressContract XCCONTRACT AMBIGUOUS", extraRecs.length, sql);
                contract = [];
                for (const e of extraRecs) {
                    let [__, id] = this.convertChainID(e.chainID)
                    let chainName = this.getChainName(e.chainID);
                    contract.push({
                        link: `/address/${rawAddress}/${e.chainID}`,
                        text: `${rawAddress} on ${chainName}`,
                        description: `${e.localSymbol} System Contract`
                    })
                }
            }

            return [realtime, contract, labels];
        } else {
            let families = ["realtime", "evmcontract", "wasmcontract", "label"];
            let row = false;
            contract = null;
            try {
                let [tblName, tblRealtime] = this.get_btTableRealtime()
                const filter = [{
                    column: {
                        cellLimit: 1
                    },
                    families: families,
                }];
                [row] = await tblRealtime.row(address).get({
                    filter
                });
                let rowData = row.data;
                [realtime, contract, labels] = await this.get_account_realtime(address, rowData["realtime"], rowData["evmcontract"], rowData["wasmcontract"], rowData["label"], [])
            } catch (err) {
                console.log(err);
            }

            let w = chainID ? `and asset.chainID = '${chainID}'` : ''
            let sql = `select asset.creator, asset.assetType, asset.createdAtTx, unix_timestamp(asset.createDT) as createTS, asset.asset, asset.symbol as localSymbol, asset.assetName, asset.chainID, asset.priceUSD, asset.totalSupply, asset.numHolders, asset.decimals, token0, token1, token0Decimals, token1Decimals, token0Symbol, token1Symbol, xcmasset.symbol from asset left join xcmasset on asset.xcmInteriorKey = xcmasset.xcmInteriorKey where asset.asset = '${address}' ${w}`
            let extraRecs = await this.poolREADONLY.query(sql)
            if (extraRecs.length == 1) {
                console.log("getAddressContract UNAMBIGUOUS SINGLE CHAIN", sql);
                let e = extraRecs[0];
                contract = e
                var p = await this.computePriceUSD({
                    asset: e.asset,
                    chainID: e.chainID
                });
                contract.chainID = e.chainID;
                let [__, id] = this.convertChainID(e.chainID)
                let chainName = this.getChainName(e.chainID);
                contract.id = id;
                contract.chainName = chainName;
                contract.address = e.asset
                contract.asset = e.asset
                if (!contract.symbol) {
                    contract.symbol = e.localSymbol
                } else {
                    contract.localSymbol = e.localSymbol;
                }
                if (p) contract.priceUSD = p.priceUSDCurrent;
            } else if (extraRecs.length > 1) {
                console.log("getAddressContract AMBIGUOUS MULTI CHAIN", sql);
                contract = [];
                for (const e of extraRecs) {
                    let [__, id] = this.convertChainID(e.chainID)
                    let chainName = this.getChainName(e.chainID);
                    let description = e.assetName ? e.assetName : e.assetType;
                    if (e.localSymbol) {
                        description += `: ${e.localSymbol}`
                    }
                    contract.push({
                        link: `/address/${e.asset}/${e.chainID}`,
                        text: `${e.asset} on ${chainName}`,
                        description: `${description}`
                    })
                }
            }
            return [realtime, contract, labels];
        }
    }


    async getAccount(rawAddress, accountGroup = "realtime", chainList = [], maxRows = 1000, TSStart = null, lookback = 180, decorate = true, decorateExtra = ["data", "address", "usd", "related"], pageIndex = 0) {
        let [decorateData, decorateAddr, decorateUSD, decorateRelated] = this.getDecorateOption(decorateExtra)
        let address = paraTool.getPubKey(rawAddress)
        if (!this.validAddress(address)) {
            throw new paraTool.InvalidError(`Invalid address ${address}`)
        }
        var hrstart = process.hrtime()
        // xcmtransfers comes from mysql "xcmtransfer" table
        if (accountGroup == "xcmtransfers") {
            let filters = {
                chainList,
                address
            };
            //return await this.getXCMTransfers(filters, maxRows, decorate, decorateExtra);
            return await this.getXCMTransfersUI(filters, maxRows, decorate, decorateExtra);
        }
        // xcmtransfers comes from mysql "xcmtransfer" table
        if (accountGroup == "feed") {
            return await this.getAccountFeed(address, chainList, maxRows, decorate, decorateExtra);
        }

        // offers are what is in progress and what has been claimed
        if (accountGroup == "offers") {
            return await this.getAccountOffers(address, maxRows, decorate, decorateExtra);
        }
        // related
        if (accountGroup == "related") {
            return await this.getAccountRelated(address, decorate, decorateExtra);
        }

        // everything else comes from the "address" table, but could come from other "addressextrinsic"
        // based on the account group, figure out the source tableName and families needed from the table

        //addressextrinsic: feed, feedtransfer, crowdloans, rewards
        //addressrealtime: realtime (default)
        //addresshistory: history
        //hash related

        let tableName = "addressrealtime"
        let families = []
        let TSpagination = false;
        switch (accountGroup) {
            case "extrinsics":
                tableName = "addressextrinsic"
                families.push("feed");
                TSpagination = true;
                break;
            case "evmtxs":
                tableName = "addressextrinsic"
                families.push("feed");
                families.push("feedto"); // tmp column used to easily drop and readd
                TSpagination = true;
                break;
            case "unfinalized":
                tableName = "addressextrinsic"
                families.push("feed");
                families.push("feedunfinalized");
                TSpagination = false;
                break;
            case "transfers":
                tableName = "addressextrinsic"
                families.push("feedtransfer");
                TSpagination = true;
                break;
            case "evmtransfers":
                tableName = "addressextrinsic"
                families.push("feedevmtransfer");
                TSpagination = true;
                break;
            case "crowdloans":
                tableName = "addressextrinsic"
                families.push("feedcrowdloan");
                TSpagination = true;
                break;
            case "rewards":
                tableName = "addressextrinsic"
                families.push("feedreward");
                TSpagination = true;
                break;
            case "realtime":
                tableName = "addressrealtime"
                families.push("realtime");
                families.push("evmcontract");
                families.push("wasmcontract");
                break;
            case "ss58h160":
                tableName = "hashes"
                families.push("related");
                break;
            case "balances":
            case "history":
                tableName = "addresshistory"
                families.push("history");
                TSpagination = true;
                break;
            default:
                return false;
        }
        if (accountGroup == "balances") {
            maxRows = 1000;
        }
        //console.log(accountGroup, tableName);
        let startRow = address;
        if (TSpagination && (TSStart != null)) {
            startRow = address + "#" + paraTool.inverted_ts_key(TSStart)
        }
        try {
            let row = false,
                rows = false
            if (tableName == "addressrealtime") {
                try {
                    let [tblName, tblRealtime] = this.get_btTableRealtime()
                    const filter = [{
                        column: {
                            cellLimit: 1
                        },
                        families: families,
                        limit: maxRows,
                    }];
                    [row] = await tblRealtime.row(address).get({
                        filter
                    });

                } catch (err) {
                    if (err.code == 404) {
                        throw new paraTool.NotFoundError(`Account not found ${address}`);
                    }
                    this.logger.error({
                        "op": "query.getAccount",
                        address,
                        accountGroup,
                        err
                    });
                    return false;
                }
            } else if (tableName == "addressextrinsic") {
                let endRow = address + "#ZZZ"
                if (accountGroup == "unfinalized") {
                    endRow = address + "#" + paraTool.inverted_ts_key(this.currentTS() - 3600 * 2);
                }
                try {
                    let x = await this.btAddressExtrinsic.getRows({
                        start: startRow,
                        end: endRow,
                        limit: maxRows + 1,
                        filter: [{
                            family: families,
                            cellLimit: 1
                        }]
                    });
                    if (x.length > 0) {
                        [rows] = x;
                    }
                } catch (err) {
                    if (err.code == 404) {
                        throw Error(`Account not found ${address}`);
                    }
                    console.log(err);
                    this.logger.error({
                        "op": "query.getAccount",
                        address,
                        accountGroup,
                        err
                    });
                }
            } else if (tableName == "hashes") {

                const filter = [{
                    column: {
                        cellLimit: 1
                    },
                    limit: maxRows + 1,
                    families: families
                }];

                try {
                    [row] = await this.btHashes.row(address).get({
                        filter
                    });
                } catch (err) {
                    if (err.code == 404) {
                        //NO REASON TO throw an error, there are no "special" hashes
                    }
                    this.logger.error({
                        "op": "query.getAccount",
                        address,
                        accountGroup,
                        err
                    });
                }
            }
            switch (accountGroup) {
                case "realtime":
                    if (row) {
                        let rowData = row.data;
                        let [realtime, contract, labels] = await this.get_account_realtime(address, rowData["realtime"], rowData["evmcontract"], rowData["wasmcontract"], rowData["label"], chainList)
                        return realtime;
                    } else {
                        let [realtime, contract, labels] = await this.get_account_realtime(address, null, null, null, null, chainList)
                        return realtime;
                    }
                case "ss58h160":
                    let relatedData = false
                    if (row && row.data["related"] != undefined) {
                        relatedData = row.data["related"]
                    }
                    return await this.get_hashes_related(address, relatedData, "address")
                case "unfinalized":
                    //feed:extrinsicHash#chainID-extrinsicID
                    return await this.get_account_extrinsics_unfinalized(address, rows, maxRows, chainList, decorate, decorateExtra);
                case "evmtxs":
                case "extrinsics":
                    //feed:extrinsicHash#chainID-extrinsicID
                    return await this.get_account_extrinsics(address, rows, maxRows, chainList, decorate, decorateExtra, TSStart, pageIndex);
                case "transfers":
                    // need to also bring in "feedtransferunfinalized" from the same table
                    //feedtransfer:extrinsicHash#eventID
                    return await this.get_account_transfers(address, rows, maxRows, chainList, decorate, decorateExtra, TSStart, pageIndex);
                case "evmtransfers":
                    //feedtransfer:transactionHash#eventID
                    return await this.get_account_evmtransfers(address, rows, maxRows, chainList, decorate, decorateExtra, TSStart, pageIndex);
                case "crowdloans":
                    //feedcrowdloan:extrinsicHash#eventID
                    return await this.get_account_crowdloans(address, rows, maxRows, chainList, decorate, decorateExtra, TSStart, pageIndex);
                case "rewards":
                    //feedreward:extrinsicHash#eventID
                    return await this.get_account_rewards(address, rows, maxRows, chainList, decorate, decorateExtra, TSStart, pageIndex);
                case "history":
                    let relatedExtrinsicsMap = {}
                    let hist = await this.get_account_history(address, rows, maxRows, chainList, false)
                    try {
                        //MK: history has family "history" but we are calling "feed" family here??
                        let [extrinsics] = await this.btAddressExtrinsic.getRows({
                            start: startRow,
                            end: address + "#" + paraTool.inverted_ts_key(hist.minTS) + "#ZZZ",
                            filter: [{
                                //family: families,
                                family: ["feed"],
                                cellLimit: 1
                            }],
                            limit: maxRows
                        });
                        if (extrinsics && extrinsics.length > 0) {
                            for (const ext of extrinsics) {
                                let [addressPiece, ts, extrinsicHashPiece] = paraTool.parse_addressExtrinsic_rowKey(ext.id)
                                let out = {};
                                let rowData = ext.data
                                if (rowData["feed"]) {
                                    let extrinsics = rowData["feed"];
                                    for (const extrinsicHashEventID of Object.keys(extrinsics)) {
                                        for (const cell of extrinsics[extrinsicHashEventID]) {
                                            let t = JSON.parse(cell.value);
                                            // here we copy just a FEW of the flds over for recognitions sake
                                            let flds = ["chainID", "blockNumber", "extrinsicHash", "extrinsicID", "section", "method"];
                                            for (const fld of flds) {
                                                if (t[fld] !== undefined) {
                                                    if (fld == "chainID" || fld == "blockNumber") {
                                                        out[fld] = parseInt(t[fld], 10); // can we avoid this step?
                                                    } else {
                                                        out[fld] = t[fld];
                                                    }

                                                }
                                            }
                                        }
                                    }
                                }
                                relatedExtrinsicsMap[ts] = out;
                            }
                        }
                    } catch (err) {
                        this.logger.error({
                            "op": "query.getAccount",
                            address,
                            accountGroup,
                            err
                        });
                    }
                    // console.log("*** relatedExtrinsicMap ** ", relatedExtrinsicsMap);
                    let out = [];
                    for (const assetChain of Object.keys(hist.data)) {
                        let h = hist.data[assetChain];
                        let states = hist.data[assetChain].states;
                        for (let i = 0; i < states.length; i++) {
                            // each of these is a pair [indexTS, state] ... but we can push a POTENTIAL extrinsicHash IF they happen to be the SAME ts
                            if (states[i].length == 2) {
                                let [indexTS, _] = states[i];
                                if (relatedExtrinsicsMap[indexTS] !== undefined) {
                                    states[i].push(this.clean_extrinsic_object(relatedExtrinsicsMap[indexTS]));
                                }
                            }
                        }
                        out.push(h);
                    }
                    return {
                        data: out,
                            nextPage: hist.nextPage
                    };
                case "balances":
                    let historyObj = await this.get_account_history(address, rows, maxRows, chainList, true);
                    let h = historyObj.data
                    let balances = [];
                    let currentTS = this.currentTS();
                    let startTS = currentTS - 86400 * lookback;
                    for (let ts = startTS; ts <= currentTS; ts += 86400) {

                        let totalUSDVal = 0;
                        for (const assetChain of Object.keys(h)) {
                            let assetInfo = this.assetInfo[assetChain];
                            if (assetInfo !== undefined) {
                                let assetType = assetInfo.assetType;
                                let chainID = assetInfo.chainID;
                                let flds = this.get_assetType_flds(assetType);
                                let states = h[assetChain].states; // each of these is a pair [indexTS, state]
                                let state = false;
                                for (let i = 0; i < states.length; i++) {
                                    if (states[i].length == 2) {
                                        let [indexTS, stateAt] = states[i];
                                        if (ts >= indexTS && (state == false)) {
                                            state = stateAt;
                                            // can we break here?
                                        }
                                    }
                                }
                                if (state) {
                                    let USDval = await this.decorate_assetState(assetInfo, state, flds, ts);
                                    totalUSDVal += USDval
                                }
                            } else {
                                console.log("failed to find: ", assetChain);
                            }
                        }

                        balances.push([ts * 1000, totalUSDVal]);
                    }
                    return (balances);
                default:
                    return false;
                    break;
            }
        } catch (err) {
            if (err instanceof paraTool.InvalidError || err instanceof paraTool.NotFoundError) {
                throw err
            }
            console.log(err);
            this.logger.error({
                "op": "query.getAccount",
                address,
                accountGroup,
                err
            });
            return {};
        }
    }

    validAddress(address) {
        if (!address) return false;
        if (address.length == 66) return true;
        if (address.length == 42) return true;
        return false;
    }

    async getRealtimeAsset(rawAddress) {
        const maxRows = 1000;
        let address = paraTool.getPubKey(rawAddress)
        if (!this.validAddress(address)) {
            throw new paraTool.InvalidError(`Invalid address ${address}`)
        }
        var hrstart = process.hrtime()
        try {
            console.log("reading: ", rawAddress);
            let [tblName, tblRealtime] = this.get_btTableRealtime()
            const filter = [{
                column: {
                    cellLimit: 1
                },
                families: [
                    "realtime"
                ],
                limit: maxRows
            }];

            const [row] = await tblRealtime.row(address).get({
                filter
            });

            let rowData = row.data;
            let account = {};
            const realtimeData = rowData["realtime"];
            let realtime = {};
            if (realtimeData) {
                for (const assetChainEncoded of Object.keys(realtimeData)) {
                    let cell = realtimeData[assetChainEncoded];
                    let assetChain = paraTool.decodeAssetChain(assetChainEncoded);
                    let [asset, chainID] = paraTool.parseAssetChain(assetChain);
                    if (chainID !== undefined) {
                        try {
                            let assetInfo = this.assetInfo[assetChain];
                            if (assetInfo == undefined) {
                                // console.log("NO ASSETINFO", assetChain, "asset", asset, "chainID", chainID, cell[0].value);
                            } else {
                                let assetType = assetInfo.assetType;
                                if (realtime[assetType] == undefined) {
                                    realtime[assetType] = [];
                                }
                                realtime[assetType].push({
                                    assetInfo,
                                    state: JSON.parse(cell[0].value)
                                });
                            }
                        } catch (err) {
                            console.log("REALTIME ERR", err);
                        }
                    }
                }
            }
            await this.compute_holdings_USD(realtime);
            return (realtime);
        } catch (err) {
            if (err.code == 404) {
                throw Error("Account not found");
            }
            console.log(err);
            this.logger.error({
                "op": "query.getRealtimeAsset",
                address,
                err
            });
        }
        return (false);
    }

    decorateEventModule(evt, decorate = true, decorateData = true) {
        try {
            let [section, method] = paraTool.parseSectionMethod(evt)
            let nEvent = {}
            nEvent.eventID = evt.eventID
            if (decorate && decorateData) nEvent.docs = evt.docs
            nEvent.section = evt.section
            nEvent.method = evt.method
            nEvent.data = evt.data
            if (decorate && decorateData) nEvent.dataType = evt.dataType // returning dataType for now?
            return nEvent
        } catch (err) {
            this.logger.error({
                "op": "query.decorateEventModule",
                evt,
                err
            });
        }
    }

    async decorateParams(section, method, args, chainID, ts, depth = 0, decorate = true, decorateExtra = ["data", "address", "usd"]) {
        this.chainParserInit(chainID, this.debugLevel);
        let [decorateData, decorateAddr, decorateUSD, decorateRelated] = this.getDecorateOption(decorateExtra)
        try {
            if (section == 'ethereum' && method == 'transact') {
                if (args.transaction != undefined) {
                    let evmTx = false;
                    if (args.transaction.eip1559 != undefined) {
                        evmTx = args.transaction.eip1559
                    } else if (args.transaction.legacy != undefined) {
                        evmTx = args.transaction.legacy
                    }
                    if (args.transaction.v1 != undefined) {
                        evmTx = args.transaction.v1
                    }
                    if (args.transaction.v2 != undefined) {
                        evmTx = args.transaction.v2
                    }
                    if (decorate && evmTx) {
                        let output = this.decodeTransactionInput(evmTx)
                        if (output != undefined) {
                            args.decodedEvmInput = output
                        }
                    }
                }
            }
            if (section == 'ethereumXcm' && method == 'transactThroughProxy') {
                //console.log(`${section}:${method} args`, args)
                if (args.xcm_transaction != undefined) {
                    let evmTx = false;
                    if (args.xcm_transaction.v1 != undefined) evmTx = args.xcm_transaction.v1
                    if (args.xcm_transaction.v2 != undefined) evmTx = args.xcm_transaction.v2
                    if (decorate && evmTx) {
                        let output = this.decodeTransactionInput(evmTx)
                        if (output != undefined) {
                            args.decodedEvmInput = output
                        }
                    }
                }
            }

            if (args.other_signatories != undefined) {
                if (decorate) this.decorateAddresses(args, "other_signatories", decorateAddr, false) // ignore here?
            }
            if (args.real != undefined) {
                let address = paraTool.getPubKey(args.real)
                if (address) {
                    args.realAddress = address
                    if (decorate) this.decorateAddress(args, "realAddress", decorateAddr, false)
                }
            }
            if (args.calls != undefined) { // this is an array
                //console.log(depth, "descend into calls", args.calls.length)
                let i = 0;
                for (const c of args.calls) {
                    let call_section = c.section;
                    let call_method = c.method;
                    //console.log(depth, "call ", i , call_section, call_method, c);
                    i++;
                    await this.decorateParams(call_section, call_method, c.args, chainID, ts, depth + 1, decorate, decorateExtra)
                }
            } else if (args.call != undefined) { // this is an object
                let call = args.call
                let call_section = call.section;
                let call_method = call.method;
                //console.log(depth, "descend into call", call)
                await this.decorateParams(call_section, call_method, call.args, chainID, ts, depth + 1, decorate, decorateExtra)
            } else {
                let pallet_method = `${section}:${method}`
                //console.log(depth, "leaf", pallet_method, args)
                await this.chainParser.decorate_query_params(this, pallet_method, args, chainID, ts, 0, decorate, decorateExtra)
            }
        } catch (err) {
            console.log(err);
            this.logger.error({
                "op": "query.decorateParams",
                section,
                method,
                args,
                chainID,
                err
            });
        }
    }

    async decorateExtrinsic(ext, chainID, status = "", decorate = true, decorateExtra = ["data", "address", "usd", "related"]) {
        let [decorateData, decorateAddr, decorateUSD, decorateRelated] = this.getDecorateOption(decorateExtra)
        if (typeof chainID == "string") {
            chainID = parseInt(chainID, 10);
        }
        //console.log(`decorateExtrinsic [${ext.extrinsicID}] decorateData=${decorateData} decorateAddr=${decorateAddr} decorateUSD=${decorateUSD} decorateRelated=${decorateRelated}`)
        let decoratedExt = {
            chainID: chainID,
            id: null,
            chainName: this.getChainName(ext.chainID),
            extrinsicHash: ext.extrinsicHash,
            extrinsicID: ext.extrinsicID,
            blockNumber: ext.blockNumber,
            ts: ext.ts,
            blockHash: ext.blockHash,
        }

        try {
            if (ext.signer != undefined && ext.signer != 'NONE') {
                let signer = ext.signer
                let fromAddress = paraTool.getPubKey(signer)
                //console.log(`decorateExtrinsic [${ext.extrinsicID}] [decorate=${decorate}], signer=${signer}, fromAddress=${fromAddress}`)
                decoratedExt.signer = signer
                decoratedExt.fromAddress = fromAddress
                //console.log(`decoratedExt before decorateAddress [decorate=${decorate}, decorateAddr=${decorateAddr},decorateRelated=${decorateRelated}]`, decoratedExt)
                if (decorate) this.decorateAddress(decoratedExt, "fromAddress", decorateAddr, decorateRelated)
                //console.log(`decoratedExt after decorateAddress  [decorate=${decorate}, decorateAddr=${decorateAddr},decorateRelated=${decorateRelated}]`, decoratedExt)
            } else {
                //console.log(`decorateExtrinsic ext.signer not ok [${ext.extrinsicID}]`, ext.signer)
            }

            if (ext.evm != undefined) {
                decoratedExt.evm = ext.evm
            }
            if (ext.signature) {
                decoratedExt.signature = ext.signature
            }
            if (ext.lifetime) {
                decoratedExt.lifetime = ext.lifetime
            }

            [decoratedExt.chainID, decoratedExt.id] = this.convertChainID(decoratedExt.chainID)

            decoratedExt.nonce = ext.nonce
            decoratedExt.tip = ext.tip
            decoratedExt.fee = ext.fee
            decoratedExt.weight = 0
            //decoratedExt.weightToFeeCoefficient = 0
            decoratedExt.transfers = []
            //console.log(`decorateExtrinsic ext.transfers`, ext.transfers)
            if (ext.transfers) {
                decoratedExt.transfers = ext.transfers
            }
            //console.log(`decoratedExt before fee [decorate=${decorate}, decorateUSD=${decorateUSD}]`, decoratedExt)
            if (ext.fee > 0) {
                await this.decorateFee(decoratedExt, decoratedExt.chainID, decorateUSD)
            }
            decoratedExt.result = ext.result
            //console.log(`decoratedExt after fee [decorate=${decorate}, decorateUSD=${decorateUSD}]`, decoratedExt)
            if (ext.err != undefined) decoratedExt.err = ext.err
            if (status != "") decoratedExt.status = status;
            if (ext.genTS) decoratedExt.genTS = decoratedExt.genTS
            if (ext.source) decoratedExt.source = decoratedExt.source

            let [section, method] = paraTool.parseSectionMethod(ext)
            decoratedExt.callIndex = null
            decoratedExt.section = section
            decoratedExt.method = method
            decoratedExt.params = ext.params
            decoratedExt.calls = await this.paramToCalls(ext.extrinsicID, section, method, ext.callIndex, ext.params, ext.paramsDef, chainID, ext.ts, '0', decorate, decorateData)
            if (ext.paramsDef) {
                decoratedExt.paramsDef = ext.paramsDef
            }
            if (ext.callIndex != undefined) {
                decoratedExt.callIndex = ext.callIndex
            }

            if (ext.decodedEvents != undefined) {
                decoratedExt.decodedEvents = ext.decodedEvents;
            }
            if (ext.identifier != undefined) {
                decoratedExt.identifier = ext.identifier;
            }
            if (ext.decodedCall != undefined) {
                decoratedExt.decodedCall = ext.decodedCall;
            }

            if (ext.events != undefined) {
                decoratedExt.events = []
                for (const evt of ext.events) {
                    let dEvent = this.decorateEventModule(evt, decorate, decorateData)
                    decoratedExt.events.push(dEvent)
                    if (dEvent.section == "system" && (dEvent.method == "ExtrinsicSuccess" || dEvent.method == "ExtrinsicFailure")) {
                        if (dEvent.data != undefined && dEvent.data[0].weight != undefined) {
                            if (dEvent.data[0].weight.refTime != undefined) {
                                decoratedExt.weight = dEvent.data[0].weight.refTime;
                            } else if (!isNaN(dEvent.data[0].weight)) {
                                decoratedExt.weight = dEvent.data[0].weight;
                            }
                        }
                    }
                }
            }
            //console.log(`decoratedExt after decorateEventModule [decorate=${decorate}, decorateUSD=${decorateUSD}]`, decoratedExt)
            if (ext.params != undefined && decorate) {
                await this.decorateParams(section, method, ext.params, ext.paramsDef, chainID, ext.ts, 0, decorate, decorateData)
                //decoratedExt.calls = await this.paramToCalls(section, method, ext.params, chainID, ext.ts, '0', decorate, decorateData)

                // WASM decoration of contract metadata is done at the "extrinsic" level rather than "params" level
                // for now, we ignore utility batch / proxy etc and put metadata up at the top level
                if (section == "contracts" && method == "call") {
                    let args = ext.params
                    if (args.dest != undefined && args.dest.id != undefined) {
                        // we could decode on the fly here but we need more ABIs!!!
                        let contractsCall = await this.getContractsCall(ext.extrinsicHash);
                        if (contractsCall) {
                            if (contractsCall.identifier) {
                                decoratedExt.identifier = contractsCall.identifier;
                            }
                            if (contractsCall.decodedCall) {
                                decoratedExt.decodedCall = contractsCall.decodedCall;
                            }
                        }

                    }
                }

            }
            //console.log(`decoratedExt after decorateParams [decorate=${decorate}, decorateUSD=${decorateUSD}]`, decoratedExt)
        } catch (err) {
            console.log(`decorateExtrinsic err`, err.toString())
            this.logger.error({
                "op": "query.decorateExtrinsic",
                ext,
                chainID,
                ts,
                err
            });
        }

        //decoratedExt.chainName = this.getChainName(chainID)
        return decoratedExt
    }

    async decorateFee(extrinsic, chainID, decorateUSD = true) {
        try {
            var chainSymbol = this.getChainSymbol(chainID)
            var chainDecimals = this.getChainDecimal(chainID)
            var fee = (extrinsic.fee != undefined) ? (extrinsic.fee) : 0
            var tip = (extrinsic.tip != undefined) ? (extrinsic.tip) : 0
            var targetAsset = `{"Token":"${chainSymbol}"}`
            extrinsic.chainSymbol = chainSymbol
            if (decorateUSD) {
                let p = await this.computePriceUSD({
                    asset: targetAsset,
                    chainID,
                    ts: extrinsic.ts
                });
                if (p) {
                    extrinsic.priceUSD = p.priceUSD
                    extrinsic.feeUSD = fee * p.priceUSD
                    extrinsic.tipUSD = tip * p.priceUSD
                    extrinsic.priceUSDCurrent = p.priceUSDCurrent
                }
            }
        } catch (err) {
            this.logger.error({
                "op": "query.decorateFee",
                extrinsic,
                chainID,
                err
            });

        }
    }

    detectExtrinsicXcm(extrinsic) {
        let events = extrinsic.events
        let knownXcmEventList = ['xcmpallet:Attempted', 'polkadotXcm:Attempted', 'xcmpQueue:XcmpMessageSent']
        if (events) {
            for (const evt of events) {
                let [pallet, method] = paraTool.parseSectionMethod(evt)
                let pallet_method = `${pallet}:${method}`
                if (knownXcmEventList.includes(pallet_method)) {
                    return true
                }
            }
        }
        return false
    }

    async decorateQueryFeedTransfer(feedtransfer, chainID, decorate = true, decorateExtra = ["data", "address", "usd", "related"]) {
        /*
          FeedTransfer contains asset other than native token. must use asset/rawAsset instead
                */
        let [decorateData, decorateAddr, decorateUSD, decorateRelated] = this.getDecorateOption(decorateExtra)
        var rawBal = feedtransfer.rawAmount
        var bal = feedtransfer.amount
        if (feedtransfer.amount == undefined) {
            var chainDecimals = this.getChainDecimal(chainID)
            bal = feedtransfer.rawAmount / 10 ** chainDecimals //use native chain decimals to process unknown asset
        }
        var aseetSymbol = null;
        if (feedtransfer.symbol != undefined) {
            aseetSymbol = feedtransfer.symbol
        }

        let res = {
            symbol: aseetSymbol,
            dataRaw: bal,
        }

        if (decorateUSD) {
            var targetAsset = feedtransfer.asset
            let p = await this.computePriceUSD({
                val: bal,
                asset: targetAsset,
                chainID,
                ts: feedtransfer.ts
            })
            if (p) {
                res.dataUSD = p.valUSD
                res.priceUSD = p.priceUSD
                res.priceUSDCurrent = p.priceUSDCurrent
            }
        }


        let dFeedtransfer = {
            chainID: feedtransfer.chainID,
            chainName: feedtransfer.chainName,
            id: feedtransfer.id,
            blockNumber: feedtransfer.blockNumber,
            blockHash: feedtransfer.blockHash,
            ts: feedtransfer.ts,
            transferType: null,
            eventID: feedtransfer.eventID,
            section: feedtransfer.section,
            method: feedtransfer.method,
            extrinsicID: feedtransfer.extrinsicID,
            extrinsicHash: feedtransfer.extrinsicHash,
            from: feedtransfer.from,
            to: feedtransfer.to,
        }

        if (feedtransfer.isIncoming != undefined) {
            if (feedtransfer.isIncoming == 1) {
                dFeedtransfer.transferType = 'incoming'
            } else {
                dFeedtransfer.transferType = 'outgoing'
            }
        }
        if (dFeedtransfer.from != undefined) {
            dFeedtransfer.fromAddress = paraTool.getPubKey(dFeedtransfer.from)
            if (decorate) this.decorateAddress(dFeedtransfer, "fromAddress", decorateAddr, decorateRelated)
        }
        if (dFeedtransfer.to != undefined) {
            dFeedtransfer.toAddress = paraTool.getPubKey(dFeedtransfer.to)
            if (decorate) this.decorateAddress(dFeedtransfer, "toAddress", decorateAddr, decorateRelated)
        }

        dFeedtransfer.rawAsset = feedtransfer.rawAsset
        dFeedtransfer.rawAmount = feedtransfer.rawAmount
        if (decorateUSD) dFeedtransfer.amountUSD = (feedtransfer.amountUSD != undefined) ? feedtransfer.amountUSD : 0
        dFeedtransfer.decimals = (feedtransfer.decimals != undefined) ? feedtransfer.decimals : null // unknown case
        dFeedtransfer.data = feedtransfer.data
        if (decorateData) dFeedtransfer.decodedData = res
        return dFeedtransfer
    }

    async decorateQueryFeedEVMTransfer(feedtransfer, chainID, decorate = true, decorateExtra = ["data", "address", "usd", "related"]) {
        let [decorateData, decorateAddr, decorateUSD, decorateRelated] = this.getDecorateOption(decorateExtra)
        var value = feedtransfer.value
        var assetSymbol = null;
        var decimals = null;
        let dFeedtransfer = {
            chainID: feedtransfer.chainID,
            chainName: feedtransfer.chainName,
            id: feedtransfer.id,
            blockNumber: feedtransfer.blockNumber,
            ts: feedtransfer.ts,
            transactionHash: feedtransfer.transactionHash,
            from: feedtransfer.from,
            to: feedtransfer.to,
            tokenAddress: feedtransfer.tokenAddress,
            valueRaw: value
        }
        let asset = feedtransfer.tokenAddress.toLowerCase();
        let assetChain = paraTool.makeAssetChain(asset, chainID);
        let assetInfo = this.assetInfo[assetChain];
        if (assetInfo != undefined) {
            dFeedtransfer.decimals = assetInfo.decimals;
            dFeedtransfer.value = dFeedtransfer.valueRaw / 10 ** assetInfo.decimals;
            dFeedtransfer.symbol = assetInfo.symbol;
            if (decorateUSD) {
                let p = await this.computePriceUSD({
                    val: dFeedtransfer.value,
                    asset,
                    chainID,
                    ts: feedtransfer.ts
                })
                if (p) {
                    dFeedtransfer.valueUSD = p.valUSD
                    dFeedtransfer.priceUSD = p.priceUSD
                    dFeedtransfer.priceUSDCurrent = p.priceUSDCurrent
                }
            }
            console.log("DECORATE", decorateUSD, asset, dFeedtransfer);
        } else {
            console.log("MISSING", assetChain, feedtransfer.tokenAddress.toLowerCase(), chainID);
        }
        if (decorate) {
            if (dFeedtransfer.from != undefined) {
                //if (decorate) this.decorateAddress(dFeedtransfer, "fromAddress", decorateAddr, decorateRelated)
            }
            if (dFeedtransfer.to != undefined) {
                // if (decorate) this.decorateAddress(dFeedtransfer, "toAddress", decorateAddr, decorateRelated)
            }
        }


        return dFeedtransfer
    }

    // input: 1642608001
    // output: 1642608000
    hourly_key_from_ts(ts) {
        let out = Math.round(ts / 3600) * 3600;
        return (out.toString());
    }

    async searchXCMTransfers(filters = {}, limit = 1000, decorate = true, decorateExtra = ["data", "address", "usd", "related"]) {
        let [decorateData, decorateAddr, decorateUSD, decorateRelated] = this.getDecorateOption(decorateExtra)
        let w = [];
        for (const filt of Object.keys(filters)) {
            let v = filters[filt]
            switch (filt.toLowerCase()) {
                case "blocknumberstart":
                case "blockstart":
                case "startblock":
                    w.push(`blockNumber >= ${v}`);
                    break;
                case "endblock":
                case "blockend":
                case "blocknumberend":
                    w.push(`blockNumber <= ${v}`);
                    break;
                case "section":
                    w.push(`lower(p) = lower('${v}')`);
                    break;
                case "method":
                    w.push(`lower(m) = lower('${v}')`);
                    break;
                case "fromaddress":
                    let fromAddress = paraTool.getPubKey(v);
                    w.push(`fromAddress = '${fromAddress}'`);
                    break;
                case "toaddress":
                    let destAddress = paraTool.getPubKey(v);
                    w.push(`destAddress = '${destAddress}'`);
                    break;
                case "complete":
                    let complete = (parseInt(v) > 0) ? 0 : 1;
                    w.push(`incomplete = '${complete}'`);
                    break;
                case "datestart":
                case "startdate":
                    w.push(`Date(FROM_UNIXTIME(sourceTS)) >= '${v}'`);
                    break;
                case "dateend":
                case "enddate":
                    w.push(`Date(FROM_UNIXTIME(sourceTS)) <= '${v}'`);
                    break;
                case "result":
                    let result = v > 0
                    w.push(`incomplete = ${result}`);
                    break;
                case "chainid":
                case "chainidentifier":
                    let [chainID, id] = this.convertChainID(v)
                    if (chainID !== false) {
                        w.push(`chainID = ${chainID}`);
                    } else {
                        throw new Error(`invalid chainIdentifier: ${v}`);
                    }
                    break;
                case "chainiddest":
                case "chainidentifierdest":
                    let [chainIDDest, id2] = this.convertChainID(v)
                    if (chainIDDest !== false) {
                        w.push(`chainIDDest = ${chainIDDest}`);
                    } else {
                        throw new Error(`invalid chainIdentifierDest: ${v}`);
                    }
                    break;
                default:
                    throw new Error(`XCM Transfers invalid filter: ${filt}`);
            }
        }
        let wstr = w.join(" and ")
        if (w.length > 0) {
            wstr = " WHERE " + wstr
        }
        let sql = `select msgHash, extrinsicHash, extrinsicID, chainID, chainIDDest, blockNumber, fromAddress, destAddress, sectionMethod, symbol, relayChain, blockNumberDest, sourceTS, destTS, amountSent, amountReceived, status, relayChain, incomplete, amountSentUSD, amountReceivedUSD from xcmtransfer ${wstr} order by sourceTS desc limit ${limit}`
        let xcmtransfers = await this.poolREADONLY.query(sql);
        let out = [];
        for (let i = 0; i < xcmtransfers.length; i++) {
            let x = xcmtransfers[i];
            try {
                let symbolRelayChain = paraTool.makeAssetChain(x.symbol, x.relayChain);
                let assetInfo = this.getXcmAssetInfoBySymbolKey(symbolRelayChain);
                if (assetInfo && assetInfo.decimals) {
                    decimals = assetInfo[rawassetChain].decimals;
                    if (decorate) {
                        this.decorateAddress(x, "fromAddress", decorateAddr, decorateRelated)
                        this.decorateAddress(x, "destAddress", decorateAddr, decorateRelated)
                    }
                    if (x.msgHash == undefined) x.msgHash = '0x'
                    let amountSent = (x.amountSent != undefined) ? x.amountSent / 10 ** decimals : 0
                    let amountReceived = (x.amountReceived != undefined) ? x.amountReceived / 10 ** decimals : 0;
                    x.amountSent = amountSent
                    x.amountReceived = amountReceived
                    let [_, id] = this.convertChainID(x.chainID)
                    x.chainName = this.getChainName(x.chainID);
                    let [__, idDest] = this.convertChainID(x.chainIDDest)
                    x.id = id
                    x.idDest = idDest
                    x.chainDestName = this.getChainName(x.chainIDDest);
                    out.push(x);
                }
            } catch (e) {
                this.logger.error({
                    "op": "query.searchXCMTransfers",
                    x,
                    err
                });
            }
        }
        return out;
    }


    async getRecentXCMMessages(filters, limit, decorate, decorateExtra) {
        let chainList = (filters.chainList != undefined) ? filters.chainList : [];
        let blockNumber = (filters.blockNumber != undefined) ? filters.blockNumber : null;
        let beneficiaries = (filters.beneficiaries != undefined) ? filters.beneficiaries : null;
        let chainListFilter = "";

        if (filters.chainID != undefined && filters.chainIDDest != undefined) {
            let chainID = parseInt(filters.chainID);
            let chainIDDest = parseInt(filters.chainIDDest);
            chainListFilter = ` and chainID = '${chainID}' and chainIDDest = '${chainIDDest}' `
        } else if (chainList.length > 0) {
            chainListFilter = ` and ( chainID in ( ${chainList.join(",")} ) or chainIDDest in (${chainList.join(",")}) )`
        }
        if (filters.symbol) {
            // TODO: chainListFilter = ` and ( xcmasset.symbol = '${filters.symbol}' )` -- need xcmInteriorKey in xcmmessages
        }
        // if we don't have a blockNumber, bring in all the matched >= 0 records in the last 12 hours [matched=-1 implies we suppressed it from xcmmessage_dedup process]
        let w = (blockNumber) ? `( blockNumber = '${parseInt(blockNumber, 10)}' )` : "blockTS > UNIX_TIMESTAMP(date_sub(Now(), interval 10 day))";
        let mysqlQuery = `SELECT msgHash, msgStr as msg, version, sentAt, chainID, chainIDDest, msgType, blockNumber, incoming, blockTS, extrinsicHash, extrinsicID, sectionMethod, sourceTS, destTS, beneficiaries, beneficiaries as destAddress, assetsReceived, amountSentUSD, amountReceivedUSD, matched, UNIX_TIMESTAMP(matchDT) as matchTS, parentMsgHash, parentSentAt, parentBlocknumber, childMsgHash, childSentAt, childBlocknumber, sourceBlocknumber as blockNumberOutgoing, destBlocknumber as blockNumberIncoming, executedEventID, destStatus, errorDesc, xcmmessages.relayChain, extrinsicTraceID FROM xcmmessages where ${w} and matched >= 0 ${chainListFilter} order by blockTS desc limit ${limit}`;
        console.log(mysqlQuery);
        let results = [];
        let recs = await this.poolREADONLY.query(mysqlQuery);
        let blockNumberIncoming = {};
        let blockNumberOutgoing = {};
        let included = {};
        for (let i = 0; i < recs.length; i++) {
            let r = recs[i];
            try {
                let assetsReceived = JSON.parse(r.assetsReceived)
                let dedupedAssetsReceived = []
                let eventIDMap = {}
                for (const ar of assetsReceived) {
                    if (eventIDMap[ar.eventID] == undefined) {
                        eventIDMap[ar.eventID] = 1
                        dedupedAssetsReceived.push(ar)
                    }
                }
                r.assetsReceived = dedupedAssetsReceived
            } catch (e) {
                r.assetsReceived = []
            }

            let chainID = parseInt(r.chainID, 10);
            let chainIDDest = parseInt(r.chainIDDest, 10);
            let parsedMsg = {};
            let [_chainID, id] = this.convertChainID(chainID)
            let [_chainIDDest, idDest] = this.convertChainID(chainIDDest)
            r.id = id
            r.idDest = idDest;
            r.msg = JSON.parse(r.msg.toString());
            r.chainName = this.getChainName(chainID);
            r.chainDestName = this.getChainName(chainIDDest);
            if (r.beneficiaries != undefined) {
                let chainIDDestInfo = this.chainInfos[chainIDDest]
                if (chainIDDestInfo != undefined && chainIDDestInfo.ss58Format != undefined) {
                    if (r.beneficiaries != undefined) {
                        let beneficiarie0 = r.beneficiaries.split('|')[0]
                        if (beneficiarie0.length == 42) r.destAddress = beneficiarie0
                        if (beneficiarie0.length == 66) r.destAddress = paraTool.getAddress(beneficiarie0, chainIDDestInfo.ss58Format)
                    }
                }
            }
            r.relayChain = paraTool.getRelayChainByChainID(r.chainIDDest)
            if (r.matched == 0 && (this.getCurrentTS() - r.blockTS < 60)) {
                // if this record hasn't been matched, mark as pending / in transit if its very new (60s)
                r.pending = 1;
            }
            if (r.matched == 0 && (included[r.msgHash] != undefined) && Math.abs(included[r.msgHash] - r.blockTS) < 30) {
                // if we already included a matched message within 30s of this one, don't bother
            } else if (included[r.msgHash] == undefined) {
                results.push(r);
                included[r.msgHash] = r.blockTS;
            }
        }
        return (results);
    }

    async getSpecVersionMetadata(chainID_or_chainName, specVersion) {
        let [chainID, id] = this.convertChainID(chainID_or_chainName)
        if (chainID === false) {
            throw new paraTool.InvalidError(`Invalid chain: ${chainID_or_chainName}`)
        }

        var sql = `select specVersion, metadata, blockNumber, blockHash, UNIX_TIMESTAMP(firstSeenDT) as firstSeenTS from specVersions where chainID = '${chainID}' and specVersion = '${specVersion}' limit 1`
        try {
            let recs = await this.poolREADONLY.query(sql);
            if (recs.length > 0) {
                recs[0].metadata = recs[0].metadata.toString();
                return recs[0];
            }
            return (false);
        } catch (err) {
            this.logger.error({
                "op": "query.getSpecVersionMetadata",
                err,
                filters
            });
        }
    }

    async getSpecVersions(chainID_or_chainName) {
        // Based on metadata crawl, supply metadata for latest specVersion;
        // NOTE: we could dump all older specVersions but all older metadata is overkill.
        let [chainID, id] = this.convertChainID(chainID_or_chainName)
        if (chainID === false) {
            throw new paraTool.InvalidError(`Invalid chain: ${chainID_or_chainName}`)
        }

        try {
            var sql = `select specVersion, blockNumber, blockHash, UNIX_TIMESTAMP(firstSeenDT) as firstSeenTS from specVersions where chainID = ${chainID} order by specVersion DESC`
            let recs = await this.poolREADONLY.query(sql);
            return (recs);
        } catch (err) {
            this.logger.error({
                "op": "query.getSpecVersions",
                chainID,
                err
            });
        }
        return false;
    }

    async getChainLog(chainID_or_chainName, lookback = 90) {
        let [chainID, id] = this.convertChainID(chainID_or_chainName)
        if (chainID === false) {
            throw new paraTool.InvalidError(`Invalid chain: ${chainID_or_chainName}`)
        }
        try {
            var sql = `select logDT, UNIX_TIMESTAMP(logDT) as logTS, startBN, endBN, numExtrinsics, numEvents, numTransfers, numSignedExtrinsics, valueTransfersUSD, numTransactionsEVM, numActiveAccounts, numPassiveAccounts, numNewAccounts, numReapedAccounts, numAddresses, fees, numXCMTransfersIn, numXCMTransfersOut, valXCMTransferIncomingUSD, valXCMTransferOutgoingUSD, numXCMMessagesIn, numXCMMessagesOut from blocklog where chainID = '${chainID}' and logDT >= date_sub(Now(), interval ${lookback} DAY) and logDT >= '2023-01-01' order by logDT desc`;
            let recs = await this.poolREADONLY.query(sql);
            for (let i = 0; i < recs.length; i++) {
                let [logDT, _] = paraTool.ts_to_logDT_hr(recs[i].logTS);
                recs[i].logDT = logDT;
                recs[i].fees = parseFloat(recs[i].fees);
            }
            return (recs);
        } catch (err) {
            this.logger.error({
                "op": "query.getChainLog",
                chainID,
                err
            });
        }
        return false;
    }

    async getExtrinsicDocs(chainID_or_chainName, s, m) {
        // Based on metadata crawl, supply metadata for latest specVersion;
        // NOTE: we could dump all older specVersions but all older metadata is overkill.
        let [chainID, id] = this.convertChainID(chainID_or_chainName)
        if (chainID === false) return (false);
        try {
            var sql = `select chainID, section, method, docs from extrinsicdocs where chainID = ${chainID} and section = '${s}' and method = '${m}' limit 1`
            let docs = await this.poolREADONLY.query(sql);
            if (docs.length > 0) {
                return docs[0];
            }
            return (docs);
        } catch (err) {

        }
        return (false);
    }

    async verifyClaimAddress(address, message, signature) {
        try {
            // check that signed message is from address...
            let verified = paraTool.isValidSignature(message, signature, address);
            if (!verified) {
                return (false);
            }
            let sql = `insert into account ( address, verified, verifyDT ) values ( ${mysql.escape(address)}, 1, Now() ) on duplicate key update verified = values(verified), verifyDT = values(verifyDT)`
            this.batchedSQL.push(sql);
            await this.update_batchedSQL();
            return (true);
        } catch (err) {
            this.logger.error({
                "op": "query.verifyClaimAddress",
                address,
                message,
                signature,
                err
            });
            return false
        }
    }

    chainFilters(chainList = [], targetChainID) {
        if (targetChainID == undefined) return false
        if (isNaN(targetChainID)) return false
        let chainID = paraTool.dechexToInt(targetChainID, 10)
        if (chainList.length == 0) {
            return true
        } else if (chainList.includes(chainID)) {
            return true
        }
        return false
    }

    getRewardLevelHOLIC(action) {
        let rewardAmount = 0;
        switch (action) {
            case "addresssuggestion":
                rewardAmount = 25;
                break;
            case "issuereport":
                rewardAmount = 100;
                break;
            case "securityreport":
                rewardAmount = 2500;
                break;
        }
        return rewardAmount * 1000000000000;
    }

    async getRecentAddressSuggestions(status = "Submitted", lookbackDays = 7) {
        let sql = `select address, submitter, nickname, addressType, submitDT, status, judgementDT from addresssuggestion where status = '${status}' and submitDT > date_sub(Now(), INTERVAL ${lookbackDays} DAY) order by submitDT Desc`
        let suggestions = await this.poolREADONLY.query(sql)
        return suggestions;
    }

    async updateAddressSuggestionStatus(address, submitter, status, judge = "") {
        if (address.length != 66) return (false)
        if (submitter.length != 66) return (false);
        if (!(status == "Accepted" || status == "Rejected")) return (false);
        let sql = `update addresssuggestion set status = ${mysql.escape(status)}, judgementDT = Now(), judge = ${mysql.escape(judge)} where address = '${address}' and submitter = '${submitter}'`
        this.batchedSQL.push(sql);
        if (status == "Accepted") {
            let rewardAmount = this.getRewardLevelHOLIC("addresssuggestion");
            let sql2 = `insert into rewardsholic (address, amount, grantDT, rewardStatus) values ( '${address}',  '${rewardAmount}', Now(), 'Granted' )`
            this.batchedSQL.push(sql2);
        }
        await this.update_batchedSQL();
    }

    async submitAddressSuggestion(address, nickname, submitter, addressType) {
        if (address.length != 66) return ({
            err: "Invalid address"
        });
        if (submitter.length != 66) return ({
            err: "Invalid submitter"
        });
        if (nickname.length < 4 || nickname.length > 128) return ({
            err: "Invalid suggestion (nicknames should be between 4 and 128 characters"
        });
        // TODO: check for spamming by submitter
        try {
            let vals = ["nickname", "addressType", "submitDT"];
            let data = `('${address}', '${submitter}', ${mysql.escape(nickname)}, '${addressType}', Now() )`;
            await this.upsertSQL({
                "table": "addresssuggestion",
                "keys": ["address", "submitter"],
                "vals": vals,
                "data": [data],
                "replace": vals
            });
            return {
                status: "Your suggestion has been received."
            }
        } catch (err) {
            return {
                err: "An error has occurred."
            }
        }
    }


    async getEvent(eventID) {
        let ida = eventID.split("-");
        if (ida.length != 4) {
            throw new paraTool.NotFoundError(`Invalid eventID`)
        }
        let chainID = parseInt(ida[0], 10);
        let blockNumber = parseInt(ida[1], 10);
        let extrinsic = parseInt(ida[2], 10);
        let event = parseInt(ida[3], 10)
        let [_, id] = this.convertChainID(chainID);
        let chain = await this.getChain(chainID);

        try {
            let families = ["feed", "finalized", "feedevm"];
            let row = await this.fetch_block(chain, blockNumber, families, true);
            let block = row.feed;
            let eventIndex = 0;
            for (const extrinsic of block.extrinsics) {
                for (const e of extrinsic.events) {
                    if (eventIndex == event) {
                        return (e)
                    }
                    eventIndex++
                }
            }
            if (event < ext.events.length) {
                return (events[event]);
            } else {
                throw new paraTool.NotFoundError(`Invalid eventID: Event ${event} not in Extrinsic ${extrinsic} of Block number ${blockNumber} (# Events: ${events.length})`)
            }
            return event;
        } catch (err) {
            if (err.code == 404) {
                throw new paraTool.NotFoundError(`Block not found: ${blockNumber}`)
            }
            this.logger.error({
                "op": "query.getEvent",
                chainID,
                blockNumber,
                err
            });
        }
        return (null);
    }


    async getXCMMessage(msgHash, number = null, decorate = true, decorateExtra = true) {
        //search bn first, if not found, fall back to sentAt
        let [decorateData, decorateAddr, decorateUSD, decorateRelated] = this.getDecorateOption(decorateExtra)
        let w = (number) ? ` and sentAt = ${number}` : "";
        let w1 = (number) ? ` and blockNumber = ${number}` : "";
        let bnSql = `select msgHash, chainID, chainIDDest, sentAt, msgType, msgHex, msgStr as msg, blockTS, blockNumber, relayChain, version, path, extrinsicHash, extrinsicID, parentMsgHash, parentSentAt, parentBlocknumber, childMsgHash, childSentAt, childBlocknumber, assetChains, blockTS, incoming, sourceTS, destTS, sourceSentAt, destSentAt, sourceBlocknumber, destBlocknumber, executedEventID, destStatus, errorDesc from xcmmessages
        where msgHash = '${msgHash}' ${w1} order by blockTS desc limit 1`
        let sentAtSql = `select msgHash, chainID, chainIDDest, sentAt, msgType, msgHex, msgStr as msg, blockTS, blockNumber, relayChain, version, path, extrinsicHash, extrinsicID, parentMsgHash, parentSentAt, parentBlocknumber, childMsgHash, childSentAt, childBlocknumber, assetChains, blockTS, incoming, sourceTS, destTS, sourceSentAt, destSentAt, sourceBlocknumber, destBlocknumber, executedEventID, destStatus, errorDesc from xcmmessages
        where msgHash = '${msgHash}' ${w} order by blockTS desc limit 1`
        let xcmrecs = await this.poolREADONLY.query(bnSql);
        if (xcmrecs.length == 0) {
            console.log(`getXCMMessage [msgHash/bn = ${msgHash}/${number}] not found`, paraTool.removeNewLine(bnSql))
            xcmrecs = await this.poolREADONLY.query(sentAtSql);
        }
        if (xcmrecs.length == 0) {
            console.log(`getXCMMessage [msgHash/sentAt = ${msgHash}/${number}] not found`, paraTool.removeNewLine(bnSql))
            throw new paraTool.NotFoundError(`XCM Message not found: ${msgHash}/${number}`)
        }
        let x = xcmrecs[0];

        x.paraID = paraTool.getParaIDfromChainID(x.chainID)
        x.paraIDDest = paraTool.getParaIDfromChainID(x.chainIDDest)
        x.msgHex = `${x.msgHex}`

        let blockTS = (x.blockTS != undefined) ? x.blockTS : 0
        let dAssetChains = []
        let xcmMsg = (x.msg != undefined) ? JSON.parse(x.msg) : null
        x.msg = xcmMsg

        if (xcmMsg != undefined) {
            let xcmMsg0 = JSON.parse(JSON.stringify(xcmMsg)) // deep copy here
            let analysis = this.performAnalysisInstructions(xcmMsg0, x.chainID, x.chainIDDest)
            if (analysis != undefined && analysis.assetChains) {
                let assetChainsKey = Object.keys(analysis.assetChains)
                //console.log(`performAnalysisInstructions analysis.assetChains`, assetChainsKey)
                try {
                    dAssetChains = await this.decorateXCMAssetReferences(JSON.stringify(assetChainsKey), blockTS, decorate, decorateExtra)
                    x.assetChains = dAssetChains
                } catch (err) {
                    console.log(err);
                }
            }
            //console.log(`++++ decorateXCMMsg dAssetChains`, dAssetChains)
            let dMsg = await this.decorateXCMMsg(x.chainID, x.chainIDDest, xcmMsg0, blockTS, dAssetChains, decorate, decorateExtra)
            //x.decodeMsg = dMsg //let's not return both version.. less is more
            x.msg = dMsg
            if (dMsg.destAddress != undefined) {
                x.destAddress = dMsg.destAddress
                x.destSS58Address = this.getSS58ByChainID(x.destAddress, x.chainIDDest)
            }
        }
        if (decorate) this.decorateAddress(x, "destAddress", decorateAddr, decorateRelated);
        x.path = (x.path != undefined) ? JSON.parse(x.path) : []
        // add id, idDest, chainName, chainNameDest
        let [_, id] = this.convertChainID(x.chainID)
        x.chainName = this.getChainName(x.chainID);
        let [__, idDest] = this.convertChainID(x.chainIDDest)
        x.chainDestName = this.getChainName(x.chainIDDest);
        if (id == false) {
            //temporary id
            id = paraTool.getTempID(x.chainID)
        }
        if (idDest == false) {
            //temporary idDest
            idDest = paraTool.getTempID(x.chainIDDest)
        }
        x.id = id
        x.idDest = idDest
        return x;
    }

    /*
    decorateXCM -- in query.js "getXCMMessage" compute
    (a) asset referenced;
    (b) estimated valueUSD to any XCM instruction
    (c) estimated value xcm contained within
    (d) any encoded call of transact
    (e) any nickname of beneficiary (accountID32/20);
    */
    async decorateXCMAssetReferences(assetChainsStr, blockTS = 0, decorate = true, decorateExtra = true) {
        let assetChains = []
        if (assetChainsStr != undefined) {
            try {
                assetChains = JSON.parse(assetChainsStr)
            } catch (err) {
                console.log(`AssetChains ERR`, err.toString())
                assetChains = []
            }
        }
        let dAssetChains = []
        for (const assetChain of assetChains) {
            let dAssetChain = await this.decorateXCMAssetReference(assetChain, blockTS, decorate, decorateExtra)
            dAssetChains.push(dAssetChain)
        }
        return dAssetChains
    }

    decorateFungible(fun, xcmAssetInfo) {
        if (fun != undefined && fun.fungible != undefined && xcmAssetInfo && xcmAssetInfo.decimals) {
            let assetFun = fun
            let fungible = assetFun.fungible
            let decimals = xcmAssetInfo.decimals
            let fungibleAmount = fungible / 10 ** decimals
            let dassetFun = {
                xcmInteriorKey: xcmAssetInfo.xcmInteriorKey,
                symbol: xcmAssetInfo.symbol,
                decimals: decimals,
                fungible: fungible,
                fungibleAmount: fungibleAmount,
                fungibleUSD: fungibleAmount * xcmAssetInfo.priceUSD,
                fungibleUSDCurrent: fungibleAmount * xcmAssetInfo.priceUSDCurrent,
            }
            //console.log(`decorateFungible ->`, fun)
            return dassetFun
        } else {
            // can't decorate
            return fun
        }
    }

    async decorateInternalXCMInstruction(chainID, chainIDDest, dXcmMsg, internalXCM, instructionK, instructionV, blockTS = 0, dAssetChains = [], decorate = true, decorateExtra = true) {
        let [decorateData, decorateAddr, decorateUSD, decorateRelated] = this.getDecorateOption(decorateExtra)
        let dInstructionV = {}
        switch (instructionK) {
            case "withdrawAsset":
            case "reserveAssetDeposited":
                for (let i = 0; i < instructionV.length; i++) {
                    if (dAssetChains.length >= i + 1 && instructionV[i] != undefined && instructionV[i].fun != undefined) {
                        let xcmAssetInfo = dAssetChains[i] // "inferenced"
                        instructionV[i].fun = this.decorateFungible(instructionV[i].fun, xcmAssetInfo)
                        console.log(`++ instructionV[${i}]`, instructionV[i])
                    } else {
                        continue // cannot decorate without going through the messy lookup again..
                    }
                }
                dInstructionV[instructionK] = instructionV
                internalXCM = dInstructionV
                break;
            case "claimAsset":
                if (instructionV.assets != undefined) {
                    let instructionVAssets = instructionV.assets
                    for (let i = 0; i < instructionVAssets.length; i++) {
                        if (dAssetChains.length >= i + 1 && instructionVAssets[i] != undefined && instructionVAssets[i].fun != undefined) {
                            let xcmAssetInfo = dAssetChains[i] // "inferenced"
                            instructionVAssets[i].fun = this.decorateFungible(instructionVAssets[i].fun, xcmAssetInfo)
                            console.log(`++ instructionVAssets[${i}]`, instructionVAssets[i])
                        } else {
                            continue // cannot decorate without going through the messy lookup again..
                        }
                    }
                    instructionV.assets = instructionVAssets
                }
                dInstructionV[instructionK] = instructionV
                internalXCM = dInstructionV
                break;
            case "clearOrigin":
                dInstructionV[instructionK] = instructionV
                internalXCM = dInstructionV
                break;
            case "buyExecution":
                if (instructionV.fees != undefined && instructionV.fees.fun != undefined) {
                    if (dAssetChains.length != 0) {
                        let xcmAssetInfo = dAssetChains[0] // "inferenced"
                        instructionV.fees.fun = this.decorateFungible(instructionV.fees.fun, xcmAssetInfo)
                    }
                }
                dInstructionV[instructionK] = instructionV
                internalXCM = dInstructionV
                break;
            case "depositAsset":
                //TODO: need to decorate addr
                if (instructionV.beneficiary != undefined) {
                    let destAddress = this.chainParser.processBeneficiary(this, instructionV.beneficiary, 'polkadot', true)
                    if (destAddress) {
                        dXcmMsg.destAddress = destAddress
                    }
                }
                dInstructionV[instructionK] = instructionV
                internalXCM = dInstructionV
                break;
            case "transact":
                if (chainIDDest != undefined) {
                    //init with chainDest
                    await this.setupQueryChainAndAPI(chainIDDest);
                }
                console.log(`decorateInternalXCMInstruction transact!!!`, instructionV)
                let opaqueCall = instructionV.call.encoded
                let ext = this.chainParser.decodeDestination_call(this.api, opaqueCall)
                if (ext.args != undefined && decorate) {
                    let section = (ext.section != undefined) ? ext.section : ''
                    let method = (ext.method != undefined) ? ext.method : ''
                    await this.decorateParams(section, method, ext.args, chainIDDest, 0, 0, decorate, ["data", "address"])
                }
                instructionV.decodedCall = ext
                dInstructionV[instructionK] = instructionV
                internalXCM = dInstructionV
                if (dXcmMsg.transactList == undefined) dXcmMsg.transactList = []
                dXcmMsg.transactList.push(instructionV)
                break
            case "refundSurplus":
                dInstructionV[instructionK] = instructionV
                internalXCM = dInstructionV
                break;
            default:
                dInstructionV[instructionK] = instructionV
                internalXCM = dInstructionV
                break;
        }
    }

    async decorateXCMInstructionV1(chainID, chainIDDest, dXcmMsg, instructionK, instructionV, blockTS = 0, dAssetChains = [], decorate = true, decorateExtra = true) {
        this.chainParserInit(paraTool.chainIDPolkadot, this.debugLevel);
        let [decorateData, decorateAddr, decorateUSD, decorateRelated] = this.getDecorateOption(decorateExtra)
        let version = dXcmMsg.version
        let dInstructionV = {}

        switch (instructionK) {
            case "withdrawAsset":
            case "reserveAssetDeposited":
                console.log(`instructionV`, instructionV)
                if (instructionV.assets != undefined) {
                    console.log(`instructionV.assets`, instructionV.assets)
                    for (let i = 0; i < instructionV.assets.length; i++) {
                        if (dAssetChains.length >= i + 1 && instructionV.assets[i] != undefined && instructionV.assets[i].fun != undefined) {
                            let xcmAssetInfo = dAssetChains[i] // "inferenced"
                            instructionV.assets[i].fun = this.decorateFungible(instructionV.assets[i].fun, xcmAssetInfo)
                            console.log(`++ instructionV.assets[${i}]`, instructionV.assets[i])
                        } else {
                            continue // cannot decorate without going through the messy lookup again..
                        }
                    }
                }
                if (instructionV.effects != undefined) {
                    //console.log(`instructionV.effects`, instructionV.effects)
                    for (let i = 0; i < instructionV.effects.length; i++) {
                        let instructionXCMK = Object.keys(instructionV.effects[i])[0]
                        let instructionXCMV = instructionV.effects[i][instructionXCMK]
                        //console.log(`instructionXCMK=${instructionXCMK}, instructionXCMV`, instructionXCMV)
                        await this.decorateInternalXCMInstruction(chainID, chainIDDest, dXcmMsg, instructionV.effects[i], instructionXCMK, instructionXCMV, blockTS, dAssetChains, decorate, decorateExtra)
                    }
                }
                dInstructionV[instructionK] = instructionV
                //console.log(`dInstructionV`, JSON.stringify(dInstructionV, null, 4))
                dXcmMsg[version] = dInstructionV
                //console.log(`dXcmMsg++`, JSON.stringify(dXcmMsg, null, 4))
                break;
            case "clearOrigin":
                dInstructionV[instructionK] = instructionV
                dXcmMsg[version] = dInstructionV
                break;
            case "buyExecution":
                if (instructionV.fees != undefined && instructionV.fees.fun != undefined) {
                    if (dAssetChains.length != 0) {
                        let xcmAssetInfo = dAssetChains[0] // "inferenced"
                        instructionV.fees.fun = this.decorateFungible(instructionV.fees.fun, xcmAssetInfo)
                    }
                }
                dInstructionV[instructionK] = instructionV
                dXcmMsg[version] = dInstructionV
                break;
            case "depositAsset":
                //TODO: need to decorate addr
                if (instructionV.beneficiary != undefined) {
                    let destAddress = this.chainParser.processBeneficiary(this, instructionV.beneficiary, 'polkadot', true)
                    if (destAddress) {
                        dXcmMsg.destAddress = destAddress
                    }
                }
                dInstructionV[instructionK] = instructionV
                dXcmMsg[version] = dInstructionV
                break;
            case "depositReserveAsset":
                if (Array.isArray(instructionV.xcm)) {
                    for (let i = 0; i < instructionV.xcm.length; i++) {
                        let instructionXCMK = Object.keys(instructionV.xcm[i])[0]
                        let instructionXCMV = instructionV.xcm[i][instructionXCMK]
                        //console.log(`instructionXCMK=${instructionXCMK}, instructionXCMV`, instructionXCMV)
                        await this.decorateInternalXCMInstruction(chainID, chainIDDest, dXcmMsg, instructionV.xcm[i], instructionXCMK, instructionXCMV, blockTS, dAssetChains, decorate, decorateExtra)
                    }
                }
                console.log(`depositReserveAsset final`, JSON.stringify(instructionV, null, 4))
                dInstructionV[instructionK] = instructionV
                dXcmMsg[version] = dInstructionV
                break;
            case "transact":
                if (chainIDDest != undefined) {
                    //init with chainDest
                    await this.setupQueryChainAndAPI(chainIDDest);
                }
                console.log(`decorateXCMInstructionV1 transact!!!`, instructionV)
                let opaqueCall = instructionV.call.encoded
                let ext = this.chainParser.decodeDestination_call(this.api, opaqueCall)
                if (ext.args != undefined && decorate) {
                    let section = (ext.section != undefined) ? ext.section : ''
                    let method = (ext.method != undefined) ? ext.method : ''
                    await this.decorateParams(section, method, ext.args, chainIDDest, 0, 0, decorate, ["data", "address"])
                }
                instructionV.decodedCall = ext
                dInstructionV[instructionK] = instructionV
                dXcmMsg[version] = dInstructionV
                if (dXcmMsg.transactList == undefined) dXcmMsg.transactList = []
                dXcmMsg.transactList.push(instructionV)
                break
            case "refundSurplus":
                dInstructionV[instructionK] = instructionV
                internalXCM = dInstructionV
                break;
            default:
                console.log(`unhandled case ${instructionK}`)
                dInstructionV[instructionK] = instructionV
                dXcmMsg[version] = dInstructionV
                break;
        }
        console.log('im here 2')
    }

    async decorateXCMInstructionV2(chainID, chainIDDest, dXcmMsg, instructionK, instructionV, blockTS = 0, dAssetChains = [], decorate = true, decorateExtra = true) {
        if (chainIDDest != undefined) {
            //init with chainDest
            this.chainParserInit(chainIDDest, this.debugLevel);
        } else {
            this.chainParserInit(paraTool.chainIDPolkadot, this.debugLevel);
        }
        let [decorateData, decorateAddr, decorateUSD, decorateRelated] = this.getDecorateOption(decorateExtra)
        let version = dXcmMsg.version
        let dInstructionV = {}
        switch (instructionK) {
            case "withdrawAsset":
            case "reserveAssetDeposited":
                for (let i = 0; i < instructionV.length; i++) {
                    if (dAssetChains.length >= i + 1 && instructionV[i] != undefined && instructionV[i].fun != undefined) {
                        let xcmAssetInfo = dAssetChains[i] // "inferenced"
                        instructionV[i].fun = this.decorateFungible(instructionV[i].fun, xcmAssetInfo)
                        console.log(`++ instructionV[${i}]`, instructionV[i])
                    } else {
                        continue // cannot decorate without going through the messy lookup again..
                    }
                }
                dInstructionV[instructionK] = instructionV
                dXcmMsg[version].push(dInstructionV)
                break;
            case "clearOrigin":
                dInstructionV[instructionK] = instructionV
                dXcmMsg[version].push(dInstructionV)
                break;
            case "buyExecution":
                if (instructionV.fees != undefined && instructionV.fees.fun != undefined) {
                    if (dAssetChains.length != 0) {
                        let xcmAssetInfo = dAssetChains[0] // "inferenced"
                        instructionV.fees.fun = this.decorateFungible(instructionV.fees.fun, xcmAssetInfo)
                    }
                }
                dInstructionV[instructionK] = instructionV
                dXcmMsg[version].push(dInstructionV)
                break;
            case "depositAsset":
                //TODO: need to decorate addr
                if (instructionV.beneficiary != undefined) {
                    let destAddress = this.chainParser.processBeneficiary(this, instructionV.beneficiary, 'polkadot', true)
                    if (destAddress) {
                        dXcmMsg.destAddress = destAddress
                    }
                }
                dInstructionV[instructionK] = instructionV
                dXcmMsg[version].push(dInstructionV)
                break;
            case "depositReserveAsset":
                if (Array.isArray(instructionV.xcm)) {
                    for (let i = 0; i < instructionV.xcm.length; i++) {
                        let instructionXCMK = Object.keys(instructionV.xcm[i])[0]
                        let instructionXCMV = instructionV.xcm[i][instructionXCMK]
                        //console.log(`instructionXCMK=${instructionXCMK}, instructionXCMV`, instructionXCMV)
                        await this.decorateInternalXCMInstruction(chainID, chainIDDest, dXcmMsg, instructionV.xcm[i], instructionXCMK, instructionXCMV, blockTS, dAssetChains, decorate, decorateExtra)
                    }
                }
                console.log(`depositReserveAsset final`, JSON.stringify(instructionV, null, 4))
                dInstructionV[instructionK] = instructionV
                dXcmMsg[version].push(dInstructionV)
                break;
            case "transact":
                if (chainIDDest != undefined) {
                    //init with chainDest
                    await this.setupQueryChainAndAPI(chainIDDest);
                }
                console.log(`decorateXCMInstruction transact!!!`, instructionV)
                let opaqueCall = instructionV.call.encoded
                let ext = this.chainParser.decodeDestination_call(this.api, opaqueCall)
                console.log(`transact!!`, ext)
                if (ext.args != undefined && decorate) {
                    let section = (ext.section != undefined) ? ext.section : ''
                    let method = (ext.method != undefined) ? ext.method : ''
                    await this.decorateParams(section, method, ext.args, chainIDDest, 0, 0, decorate, ["data", "address"])
                }
                instructionV.decodedCall = ext
                dInstructionV[instructionK] = instructionV
                dXcmMsg[version].push(dInstructionV)
                if (dXcmMsg.transactList == undefined) dXcmMsg.transactList = []
                dXcmMsg.transactList.push(instructionV)
                break
            case "refundSurplus":
                dInstructionV[instructionK] = instructionV
                dXcmMsg[version].push(dInstructionV)
                break;
            default:
                console.log(`unhandled case ${instructionK}`)
                dInstructionV[instructionK] = instructionV
                dXcmMsg[version].push(dInstructionV)
                break;
        }
    }

    async decorateXCMInstructionV3(chainID, chainIDDest, dXcmMsg, instructionK, instructionV, blockTS = 0, dAssetChains = [], decorate = true, decorateExtra = true) {
        if (chainIDDest != undefined) {
            //init with chainDest
            this.chainParserInit(chainIDDest, this.debugLevel);
        } else {
            this.chainParserInit(paraTool.chainIDPolkadot, this.debugLevel);
        }
        let [decorateData, decorateAddr, decorateUSD, decorateRelated] = this.getDecorateOption(decorateExtra)
        let version = dXcmMsg.version
        let dInstructionV = {}
        switch (instructionK) {
            case "receiveTeleportedAsset":
            case "withdrawAsset":
            case "reserveAssetDeposited":
                //console.log(`instructionK=${instructionK} ++ dAssetChains`, dAssetChains)
                for (let i = 0; i < instructionV.length; i++) {
                    //console.log(`instructionK=${instructionK} instructionV[${i}]`, instructionV[i])
                    if (dAssetChains.length >= i + 1 && instructionV[i] != undefined && instructionV[i].fun != undefined) {
                        let xcmAssetInfo = dAssetChains[i] // "inferenced"
                        instructionV[i].fun = this.decorateFungible(instructionV[i].fun, xcmAssetInfo)
                        //console.log(`++ instructionV[${i}]`, instructionV[i])
                    } else {
                        continue // cannot decorate without going through the messy lookup again..
                    }
                }
                dInstructionV[instructionK] = instructionV
                dXcmMsg[version].push(dInstructionV)
                break;
            case "clearOrigin":
                dInstructionV[instructionK] = instructionV
                dXcmMsg[version].push(dInstructionV)
                break;
            case "buyExecution":
                if (instructionV.fees != undefined && instructionV.fees.fun != undefined) {
                    if (dAssetChains.length != 0) {
                        let xcmAssetInfo = dAssetChains[0] // "inferenced"
                        instructionV.fees.fun = this.decorateFungible(instructionV.fees.fun, xcmAssetInfo)
                    }
                }
                dInstructionV[instructionK] = instructionV
                dXcmMsg[version].push(dInstructionV)
                break;
            case "depositAsset":
                //TODO: need to decorate addr
                if (instructionV.beneficiary != undefined) {
                    let destAddress = this.chainParser.processBeneficiary(this, instructionV.beneficiary, 'polkadot', true)
                    if (destAddress) {
                        dXcmMsg.destAddress = destAddress
                    }
                }
                dInstructionV[instructionK] = instructionV
                dXcmMsg[version].push(dInstructionV)
                break;
            case "depositReserveAsset":
                if (Array.isArray(instructionV.xcm)) {
                    for (let i = 0; i < instructionV.xcm.length; i++) {
                        let instructionXCMK = Object.keys(instructionV.xcm[i])[0]
                        let instructionXCMV = instructionV.xcm[i][instructionXCMK]
                        //console.log(`instructionXCMK=${instructionXCMK}, instructionXCMV`, instructionXCMV)
                        await this.decorateInternalXCMInstruction(chainID, chainIDDest, dXcmMsg, instructionV.xcm[i], instructionXCMK, instructionXCMV, blockTS, dAssetChains, decorate, decorateExtra)
                    }
                }
                console.log(`depositReserveAsset final`, JSON.stringify(instructionV, null, 4))
                dInstructionV[instructionK] = instructionV
                dXcmMsg[version].push(dInstructionV)
                break;
            case "transact":
                if (chainIDDest != undefined) {
                    //init with chainDest
                    await this.setupQueryChainAndAPI(chainIDDest);
                }
                console.log(`decorateXCMInstruction transact!!!`, instructionV)
                let opaqueCall = instructionV.call.encoded
                let ext = this.chainParser.decodeDestination_call(this.api, opaqueCall)
                console.log(`transact!!`, ext)
                if (ext.args != undefined && decorate) {
                    let section = (ext.section != undefined) ? ext.section : ''
                    let method = (ext.method != undefined) ? ext.method : ''
                    await this.decorateParams(section, method, ext.args, chainIDDest, 0, 0, decorate, ["data", "address"])
                }
                instructionV.decodedCall = ext
                dInstructionV[instructionK] = instructionV
                dXcmMsg[version].push(dInstructionV)
                if (dXcmMsg.transactList == undefined) dXcmMsg.transactList = []
                dXcmMsg.transactList.push(instructionV)
                break
            case "refundSurplus":
                dInstructionV[instructionK] = instructionV
                dXcmMsg[version].push(dInstructionV)
                break;
            default:
                console.log(`unhandled case ${instructionK}`)
                dInstructionV[instructionK] = instructionV
                dXcmMsg[version].push(dInstructionV)
                break;
        }
    }


    async decorateXCMMsg(chainID, chainIDDest, xcmMsg, blockTS = 0, dAssetChains = [], decorate = true, decorateExtra = true) {
        console.log(`decorateXCMMsg chainID=${chainID}, chainIDDest=${chainIDDest}`)
        let [decorateData, decorateAddr, decorateUSD, decorateRelated] = this.getDecorateOption(decorateExtra)
        let dXcmMsg = {}
        let version = Object.keys(xcmMsg)[0]
        //console.log(`decorateXCMMsg version=${version}`, xcmMsg)
        let xcmMsgV = xcmMsg[version]

        dXcmMsg.version = version

        try {
            let xcmPath = []

            //"withdrawAsset", "clearOrigin","buyExecution", "depositAsset"
            switch (version) {
                case 'v0':
                    //skip for now
                    break;
                case 'v1':
                    let v1_instructionK = Object.keys(xcmMsgV)[0]
                    let v1_instructionV = xcmMsgV[v1_instructionK]
                    //console.log(`v1_instructionK=${v1_instructionK}, v1_instructionV`, v1_instructionV)
                    dXcmMsg[version] = {}
                    await this.decorateXCMInstructionV1(chainID, chainIDDest, dXcmMsg, v1_instructionK, v1_instructionV, blockTS, dAssetChains, decorate, decorateExtra)
                    break;
                case 'v2':
                    dXcmMsg[version] = []
                    for (let i = 0; i < xcmMsgV.length; i++) {
                        let instructionK = Object.keys(xcmMsgV[i])[0]
                        xcmPath.push(instructionK)
                    }
                    //console.log(`decorateXCMMsg Path`, xcmPath)
                    for (let i = 0; i < xcmPath.length; i++) {
                        let v2_instructionK = xcmPath[i]
                        let v2_instructionV = xcmMsgV[i][v2_instructionK]
                        //console.log(`v2_instructionK=${v2_instructionK}, v2_instructionV`, v2_instructionV)
                        await this.decorateXCMInstructionV2(chainID, chainIDDest, dXcmMsg, v2_instructionK, v2_instructionV, blockTS, dAssetChains, decorate, decorateExtra)
                    }
                    break;
                case 'v3':
                    dXcmMsg[version] = []
                    for (let i = 0; i < xcmMsgV.length; i++) {
                        let instructionK = Object.keys(xcmMsgV[i])[0]
                        xcmPath.push(instructionK)
                    }
                    console.log(`decorateXCMMsg Path`, xcmPath)
                    for (let i = 0; i < xcmPath.length; i++) {
                        let v3_instructionK = xcmPath[i]
                        let v3_instructionV = xcmMsgV[i][v3_instructionK]
                        //console.log(`v3_instructionK=${v3_instructionK}, v3_instructionV`, v3_instructionV)
                        await this.decorateXCMInstructionV3(chainID, chainIDDest, dXcmMsg, v3_instructionK, v3_instructionV, blockTS, dAssetChains, decorate, decorateExtra)
                    }
                    break;

                default:
                    break;
            }
        } catch (err) {
            console.log(err);
        }
        return dXcmMsg
    }

    async decorateXCMAssetReference(assetChain, blockTS = 0, decorate = true, decorateExtra = true) {
        let [decorateData, decorateAddr, decorateUSD, decorateRelated] = this.getDecorateOption(decorateExtra)
        if (this.assetInfo[assetChain]) {
            let [asset, chainID] = paraTool.parseAssetChain(assetChain)
            let dXCMAsset = {
                xcmInteriorKey: this.assetInfo[assetChain].xcmInteriorKey,
                assetChain: assetChain,
                asset: asset,
                chainID: chainID,
                decimals: this.assetInfo[assetChain].decimals,
                symbol: this.assetInfo[assetChain].symbol,
            }
            if (decorateUSD) {
                let p = await this.computePriceUSD({
                    asset,
                    chainID,
                    ts: blockTS
                });
                if (p) {
                    dXCMAsset.priceUSD = p.priceUSD
                    dXCMAsset.priceUSDCurrent = p.priceUSDCurrent
                }
            }
            return dXCMAsset
        } else {
            // should not happen.
            console.log(`*decimals not found assetChain=${assetChain}`)
        }
    }

    async decorateXCM(rawXcmRec, decorate = true, decorateExtra = true) {
        let [decorateData, decorateAddr, decorateUSD, decorateRelated] = this.getDecorateOption(decorateExtra)
        rawXcmRec.msgHex = `${rawXcmRec.msgHex}`
        let [parentMsgHash, parentBlocknumber, parentSentAt] = [rawXcmRec.parentMsgHash, rawXcmRec.parentBlocknumber, rawXcmRec.parentSentAt];
        let [childMsgHash, childBlocknumber, childSentAt] = [rawXcmRec.childMsgHash, rawXcmRec.childBlocknumber, rawXcmRec.childSentAt];
        let blockTS = (rawXcmRec.blockTS != undefined) ? rawXcmRec.blockTS : 0
        if (rawXcmRec.version != 'v2') {
            // for debugging
            if (rawXcmRec.relayChain == 'polkadot') {
                rawXcmRec.assetChains = '["{\\"Token\\":\\"DOT\\"}~0"]'
            } else {
                rawXcmRec.assetChains = '["{\\"Token\\":\\"KSM\\"}~2"]'
            }
        }
        //console.log(`decorateXCM, relayChain=${rawXcmRec.relayChain},version=${rawXcmRec.version}, rawXcmRec.assetChains=${rawXcmRec.assetChains}`)
        let dAssetChains = await this.decorateXCMAssetReferences(rawXcmRec.assetChains, blockTS, decorate, decorateExtra)
        //console.log(`dAssetChains`, JSON.stringify(dAssetChains))
        let xcmMsg = (rawXcmRec.msgStr != undefined) ? JSON.parse(rawXcmRec.msgStr) : null
        let dMsg;
        if (xcmMsg != undefined) {
            let xcmMsg0 = JSON.parse(JSON.stringify(xcmMsg)) // deep copy here
            dMsg = await this.decorateXCMMsg(rawXcmRec.chainID, rawXcmRec.chainIDDest, xcmMsg0, blockTS, dAssetChains, decorate, decorateExtra)
        }
        let transactList = (dMsg.transactList != undefined) ? dMsg.transactList : []
        let destAddress = (dMsg.destAddress != undefined) ? dMsg.destAddress : null
        let destSS58Address = this.getSS58ByChainID(destAddress, rawXcmRec.chainIDDest)

        let [_, id] = this.convertChainID(rawXcmRec.chainID);
        let [__, idDest] = this.convertChainID(rawXcmRec.chainIDDest);
        if (id == false) id = paraTool.getTempID(rawXcmRec.chainID)
        if (idDest == false) idDest = paraTool.getTempID(rawXcmRec.chainIDDest)
        let assetsReceived = rawXcmRec.assetsReceived;
        let dXcm = {
            msgHash: rawXcmRec.msgHash,
            msgHex: rawXcmRec.msgHex,
            msg: xcmMsg,
            msgType: rawXcmRec.msgType,
            version: rawXcmRec.version,
            destAddress: destAddress,
            destSS58Address: destSS58Address,
            received: rawXcmRec.received,
            relayChain: rawXcmRec.relayChain,
            paraID: rawXcmRec.paraID,
            id: id,
            idDest: idDest,
            blockTS: rawXcmRec.blockTS, //TODO: remove ambiguous blockTS
            receivedTS: rawXcmRec.receivedTS,
            sentTS: rawXcmRec.sentTS,
            blockNumber: rawXcmRec.blockNumber, //TODO: remove ambiguous blockNumber, which one depends whether received ... should put paraID blockNumber (sent), paraIDDest blockNumber (received)
            blockNumberReceived: rawXcmRec.blockNumberReceived, // /idDest/blockNumberReceived
            blockNumberSent: rawXcmRec.blockNumberSent, // /id/blockNumberSent
            paraIDDest: rawXcmRec.paraIDDest,
            //decodeMsg: dMsg,
            extrinsicID: rawXcmRec.extrinsicID,
            extrinsicHash: rawXcmRec.extrinsicHash,
            destStatus: rawXcmRec.destStatus,
            executedEventID: rawXcmRec.executedEventID,
            errorDesc: rawXcmRec.errorDesc,
            parentMsgHash,
            parentBlocknumber,
            parentSentAt,
            childMsgHash,
            childBlocknumber,
            childSentAt,
            assetsReceived,
            assetChains: dAssetChains,
            transactList: transactList,
        }

        if (decorate) this.decorateAddress(dXcm, "destAddress", decorateAddr, decorateRelated);
        return dXcm
    }


    getSS58ByChainID(destAddress, chainID = 0) {
        let ss58Address = false
        if (!destAddress) return false
        if (destAddress.length == 42) {
            ss58Address = destAddress
        } else if (destAddress.length == 66) {
            let chainIDDestInfo = this.chainInfos[chainID]
            if (chainIDDestInfo.ss58Format != undefined) {
                ss58Address = paraTool.getAddress(destAddress, chainIDDestInfo.ss58Format)
            } else {
                ss58Address = paraTool.getAddress(destAddress, 42) // default
            }
        }
        return ss58Address
    }

    async get_sourcify_evmcontract(asset) {
        const axios = require("axios");
        // check https://sourcify.dev/server/check-by-addresses?addresses=0x3a7798ca28cfe64c974f8196450e1464f43a0d1e&chainIds=1284,1285,1287
        try {
            let url = `https://sourcify.dev/server/check-by-addresses?addresses=${asset}&chainIds=1284,1285,1287`
            let response = await axios.get(url)
            response = response.data;
            for (let i = 0; i < response.length; i++) {
                let r = response[i];
                // if status is false, give up
                if (!r.status || (r.status === "false") || r.status === false) {
                    // TODO: store miss in abiRaw and only call sourcify again if addDT is more than 1-5 mins ago
                    return null;
                }
                // for any chainIDs in the response, get the files {"address": "0x3A7798CA28CFE64C974f8196450e1464f43A0d1e","status": "perfect","chainIds": ["1287"]}
                let abiraw = [];
                let contractCode = [];
                let contract = {
                    code: {}
                };
                for (const evmchainID of r.chainIds) {
                    let chainID = ethTool.evmChainIDToChainID(evmchainID) // e.g moonbeam 1284 => 2004
                    if (chainID) {
                        let files = 0;
                        let codeResult = {}
                        let filesUrl = `https://sourcify.dev/server/files/tree/${evmchainID}/${asset}`
                        let filesResponse = await axios.get(filesUrl)
                        for (const fileurl of filesResponse.data) {
                            let f = await axios.get(fileurl)
                            console.log(fileurl, f.data);
                            if (f.data && f.data.output != undefined && f.data.output.abi != undefined) {
                                let flds = ["compiler", "language", "settings", "sources"]
                                for (const fld of flds) {
                                    if (f.data[fld] != undefined) {
                                        contract[fld] = f.data[fld];
                                    }
                                }
                                contract.ABI = f.data.output.abi
                                abiraw.push(`('${asset}', '${chainID}', ${mysql.escape(JSON.stringify(contract.ABI))})`)
                            } else {
                                codeResult[fileurl] = f.data;
                                files++;
                            }
                        }
                        if (files > 0) {
                            let y = {
                                result: [codeResult]
                            }
                            contractCode.push(`('${asset}', '${chainID}', ${mysql.escape(JSON.stringify(y))}, Now())`)
                        }
                        contract.chainID = chainID;
                    } else {

                        // TODO: store miss in abiRaw and only call sourcify again if addDT is more than 1-5 mins ago
                    }
                }
                let vals = ["abiraw"];
                await this.upsertSQL({
                    "table": "asset",
                    "keys": ["asset", "chainID"],
                    "vals": vals,
                    "data": abiraw,
                    "replace": vals
                });
                let vals2 = ["code", "addDT"];
                await this.upsertSQL({
                    "table": "contractCode",
                    "keys": ["asset", "chainID"],
                    "vals": vals2,
                    "data": contractCode,
                    "replace": vals2
                });
                return contract;
            }
        } catch (err) {
            console.log(err);
            return null
        }
    }

    async getEVMContract(asset, chainID = null) {
        try {
            let assetChain = (chainID) ? paraTool.makeAssetChain(asset, chainID) : "";
            let where_asset = (this.xcContractAddress[asset] != undefined) ? `asset.xcContractAddress = '${asset}'` : `asset.asset = '${asset}'`
            let w = (chainID) ? ` and asset.chainID = '${chainID}'` : "";
            let sql = `select asset.asset, asset.assetType, asset.chainID, convert(asset.abiRaw using utf8) as ABI, convert(contractCode.code using utf8) code, asset.xcContractAddress, addDT from asset left join contractCode on contractCode.asset = asset.asset and contractCode.chainID = asset.chainID where ( ${where_asset} ) ${w} order by addDT desc limit 1`
            let evmContracts = await this.poolREADONLY.query(sql);
            if (evmContracts.length == 0) {
                // return not found error
                let evmContract = await this.get_sourcify_evmcontract(asset, chainID);

                throw new paraTool.NotFoundError(`EVM Contract not found: ${asset}`)
                return (false);
            }
            let evmContract = evmContracts[0];
            if (this.xcContractAddress[asset] != undefined) {
                evmContract.asset = evmContract.xcContractAddress;
            }
            let [_, id] = this.convertChainID(evmContract.chainID)
            let chainName = this.getChainName(evmContract.chainID);
            evmContract.id = id;
            evmContract.chainName = chainName;
            try {
                let code = JSON.parse(evmContract.code);
                if (code && code.result && Array.isArray(code.result) && code.result.length > 0) {
                    let result = code.result[0];
                    evmContract.code = {};
                    for (const key of Object.keys(result)) {
                        evmContract.code[key] = result[key];
                    }
                    //evmContract.ABI = JSON.parse(evmContract.ABI);
                }
            } catch (err) {
                console.log(err);
                delete evmContract.ABI
            }
            try {
                if (evmContract.ABI && evmContract.ABI.length > 0) {
                    let abiRaw = JSON.parse(evmContract.ABI);
                    if (abiRaw.result != undefined) {
                        abiRaw = abiRaw.result;
                    }
                    if (typeof abiRaw == "string") {
                        abiRaw = JSON.parse(abiRaw);
                    }
                    if (abiRaw.length > 0) {
                        evmContract.ABI = abiRaw;
                    }
                }
                if (Array.isArray(evmContract.ABI) && (evmContract.ABI.length > 0)) {

                } else {
                    evmContract.ABI = ethTool.getABIByAssetType(evmContract.assetType)
                }
            } catch (err) {
                console.log(err);
                delete evmContract.ABI
            }
            return evmContract;
        } catch (err) {
            console.log(err)
        }
    }

    async getWASMCode(codeHash, chainID = null) {
        try {
            const axios = require("axios");
            let w = (chainID) ? ` and chainID = '${chainID}'` : "";
            let sql = `select codeHash, chainID, wasm, codeStoredBN, codeStoredTS, extrinsicID, extrinsicHash, language, compiler, storer, storer_ss58, CONVERT(metadata using utf8) metadata, status, convert(srcURLs using utf8) srcURLs, verifier, convert(authors using utf8) authors, contractName, verifyDT from wasmCode where codeHash = '${codeHash}' ${w}`
            let wasmCodes = await this.poolREADONLY.query(sql);
            let covered = {};
            if (wasmCodes.length == 0) {
                // return not found error
                throw new paraTool.NotFoundError(`WASM Code Hash not found: ${codeHash}`)
                return (false);
            }
            let wasmCode = {
                wasm: "",
                codeHash,
                metadata: {},
                id: "unknown",
                chainName: "unknown",
                contracts: [],
                source: [],
                codeStoredBN: null,
                codeStoredTS: null,
                status: null,
                srcURLs: [],
                chainID: null
            };

            for (const w of wasmCodes) {
                if (w.wasm) {
                    if (wasmCode.chainID == null || (w.chainID < wasmCode.chainID) || (w.status == "Verified")) {
                        let flds = ["codeStoredBN", "codeStoredTS", "extrinsicID", "extrinsicHash", "language", "compiler", "storer", "storer_ss58", "verified", "contractName", "verifyDT", "status"];
                        for (const f of flds) {
                            if (w[f] != undefined && wasmCode[f] == undefined) {
                                wasmCode[f] = w[f];
                            }
                        }
                    }
                    wasmCode.wasm = w.wasm.toString();
                    try {
                        wasmCode.metadata = JSON.parse(w.metadata);
                    } catch (err) {
                        console.log(err);
                    }
                }
                if (w.chainID != undefined) {
                    let [_, id] = this.convertChainID(w.chainID)
                    let chainName = this.getChainName(w.chainID);
                    wasmCode.id = id;
                    wasmCode.chainName = chainName;

                    // fetch all the contracts
                    sql = `select chainID, address, address_ss58, extrinsicHash, extrinsicID, instantiateBN, blockTS, deployer, deployer_ss58 from contract where codeHash ='${codeHash}' and chainID = '${w.chainID}'`
                    let contracts = await this.poolREADONLY.query(sql);
                    for (const c of contracts) {
                        c.id = id;
                        c.chainName = chainName;
                    }
                    wasmCode.contracts = wasmCode.contracts.concat(contracts);
                }
                if (w.srcURLs) {
                    wasmCode.srcURLs = w.srcURLs
                    // contract.srcURLs
                    let srcURLs = wasmCode.srcURLs ? this.get_srcURLs(JSON.parse(w.srcURLs)) : [];
                    for (const srcUrl of srcURLs) {
                        if (covered[srcUrl]) {} else if (srcUrl.includes(".zip") || srcUrl.includes("Cargo.lock") || srcUrl.includes("Cargo.toml") || srcUrl.includes(".contract")) {
                            covered[srcUrl] = true;
                            wasmCode.source.push({
                                srcUrl
                            });
                        } else {
                            covered[srcUrl] = true;
                            try {
                                let response = await axios.get(srcUrl, {
                                    responseType: 'text'
                                })
                                response = response.data;
                                wasmCode.source.push({
                                    srcUrl,
                                    source: JSON.stringify(response)
                                });
                            } catch (e) {}
                        }
                    }
                }
            }
            return wasmCode
        } catch (err) {
            console.log("PROB", err)
        }
    }

    get_srcURLs(arr) {
        if (!arr) return [];

        function compareStrings(a, b) {
            // Count the number of "/" characters in each string
            const countA = (a.match(/\//g) || []).length;
            const countB = (b.match(/\//g) || []).length;

            // Compare the number of "/" characters first
            if (countA !== countB) {
                return countA - countB;
            } else {
                // If the number of "/" characters is the same, sort alphabetically
                return a.localeCompare(b);
            }
        }

        // Use the custom sorting function to sort the array
        return arr.sort(compareStrings);
    }

    async getSnapshotBlocks(chainID, opt) {
        try {
            let logDT = opt.logDT
            let startHR = opt.startHR
            let finalHR = opt.finalHR
            let period = await this.getSnapshotBN(chainID, logDT, startHR, finalHR)
            return period
        } catch (e) {
            console.log(e)
            return false
        }
    }

    async getWASMContract(address, chainIDorChainName = null) {
        let chainID = this.network_to_chainID(chainIDorChainName);
        if (chainID == null) {
            // return not found error
            throw new paraTool.NotFoundError(`Unknown network: ${chainIDorChainName}`)
        }
        address = paraTool.getPubKey(address);
        let w = (chainID) ? ` and contract.chainID = '${chainID}'` : "";
        let sql = `select address, address_ss58, contract.chainID, contract.extrinsicHash, contract.extrinsicID, instantiateBN, contract.codeHash, convert(constructor using utf8) as constructor, convert(salt using utf8) as salt, blockTS, deployer, deployer_ss58, convert(wasm using utf8) as wasm, codeStoredBN, codeStoredTS, convert(metadata using utf8) as metadata, convert(srcURLs using utf8) as srcURLs, verifier, convert(authors using utf8) authors, contractName, language, compiler, version, status, verifyDT from contract left join wasmCode on contract.codeHash = wasmCode.codeHash and contract.chainID = wasmCode.chainID where address = '${address}' ${w}`
        let contracts = await this.poolREADONLY.query(sql);
        if (contracts.length == 0) {
            // return not found error
            throw new paraTool.NotFoundError(`WASM Contract not found: ${address}`)
        }
        let contract = contracts[0];
        try {
            let [_, id] = this.convertChainID(contract.chainID)
            let chainName = this.getChainName(contract.chainID);
            contract.id = id;
            contract.chainName = chainName;
            let chain = await this.getChain(contract.chainID);
            try {
                contract.authors = contract.authors ? JSON.parse(contract.authors) : [];
            } catch (err) {

            }
            contract.srcURLs = this.get_srcURLs(contract.srcURLs)
            contract.addressPubKey = contract.address
            contract.address = paraTool.getAddress(contract.addressPubKey, chain.ss58Format);
            contract.metadata = contract.metadata ? JSON.parse(contract.metadata) : null;
        } catch (e) {
            console.log(e)
        }

        return contract;
    }

    async getChainWASMContracts(chainID_or_chainName) {
        let [chainID, id] = this.convertChainID(chainID_or_chainName)
        let chainName = this.getChainName(chainID);
        let sql = `select address, contract.chainID, contract.extrinsicHash, contract.extrinsicID, instantiateBN, contract.codeHash, blockTS, deployer, deployer_ss58, status, language, compiler
 from contract left join wasmCode on contract.codeHash = wasmCode.codeHash and contract.chainID = wasmCode.chainID where contract.chainID = '${chainID}' order by blockTS desc`
        let contracts = await this.poolREADONLY.query(sql);
        for (let i = 0; i < contracts.length; i++) {
            let contract = contracts[i];
            try {
                contract.id = id;
                contract.chainID = chainID;
                contract.chainName = chainName;
            } catch (e) {
                console.log(e)
            }
        }
        return contracts;
    }

    async getChainWASMCode(chainID_or_chainName) {
        let [chainID, id] = this.convertChainID(chainID_or_chainName)
        let chainName = this.getChainName(chainID);
        let sql = `select chainID, extrinsicHash, extrinsicID, codeHash, codeStoredBN, storer, storer_ss58, status, codeStoredTS, language, compiler from wasmCode where chainID = '${chainID}' order by codeStoredTS desc`
        let code = await this.poolREADONLY.query(sql);
        for (let i = 0; i < code.length; i++) {
            let c = code[i];
            try {
                c.id = id;
                c.chainID = chainID;
                c.chainName = chainName;
            } catch (e) {
                console.log(e)
            }
        }
        return code;
    }

    network_to_chainID(network) {
        switch (network) {
            case "shibuya":
                return 30000;
            case "rococo":
                return 41002;
            case "astar":
                return 2006;
            case "shiden":
                return 22007;
            case "pendulum":
                return 2094;
            case "amplitude":
                return 22124;
        }
        return null;
    }

    // verify codeHash signature is on list of valid addresses
    async verify_codeHash_signature(codeHash, signature) {
        const ethers = require("ethers");
        let validAddresses = ["0xE4aEa4bEf4c033DC5E881eb863b25C1644Ff2D61"]
        const messageBytes = ethers.utils.toUtf8Bytes(codeHash);
        const signerAddr = await ethers.utils.verifyMessage(messageBytes, signature);
        //console.log('Recovered address:', signerAddr);
        if (validAddresses.includes(signerAddr)) {
            return (signerAddr);
        }
        return (null);
    }

    async verified_wasm_codeHash(chainID, codeHash, signature) {
        let sql = `select codeHash from wasmCode where chainID = '${chainID}' and codeHash = '${codeHash}' and status = 'Verified'`;
        let recs = await this.poolREADONLY.query(sql);
        if (recs.length > 0) {
            return (true);
        }
        return (false);
    }

    async recordWASMCodeVerification(chainID, codeHash, srcURLs, size, signature, verifier, metadata = null) {
        try {
            let wasm = null;
            let status = 'Verified';
            let language = null;
            let compiler = null;
            let contractName = null;
            let version = null;
            let authors = null

            if (metadata) {
                let source = metadata.source;
                let contract = metadata.contract;
                if (source) {
                    if (source.wasm) wasm = source.wasm;
                    if (source.language) language = source.language;
                    if (source.compiler) compiler = source.compiler;
                    //console.log("SOURCE", language, compiler);
                }
                if (contract) {
                    if (contract.name) contractName = contract.name;
                    if (contract.version) version = contract.version;
                    if (contract.authors) authors = contract.authors;
                    //console.log("CONTRACT", contractName, version, authors);
                }
                metadata = JSON.stringify(metadata)
            } else {
                this.logger.error({
                    "op": "verify: nometadata",
                    codeHash,
                    chainID
                });
                throw new paraTool.InvalidError("No .contract metadata found");
            }
            if (wasm == null) {
                this.logger.error({
                    "op": "recordWASMCodeVerification: no wasm code",
                    codeHash,
                    chainID
                });
                throw new paraTool.InvalidError("No WASM code found in metadata");
            }
            // check wasm hex bytes against codeHash
            let actualHash = "0x" + paraTool.blake2_256_from_hex(wasm);
            if (actualHash != codeHash) {
                this.logger.error({
                    "op": "recordWASMCodeVerification: codehash mismatch",
                    actualHash,
                    codeHash
                });
                throw new paraTool.InvalidError(`Code Hash provided ${codeHash} does not match byte code hash of ${actualHash}`);
            }
            let keys = ["codeHash", "chainID"];
            let vals = ["status", "language", "compiler", "contractName", "version", "authors", "srcURLs", "verifyDT", "signature", "verifier", "metadata", "wasm"];
            let sql = await this.upsertSQL({
                "table": "wasmCode",
                "keys": ["codeHash", "chainID"],
                "vals": vals,
                "data": [`(${mysql.escape(codeHash)}, ${mysql.escape(chainID)}, ${mysql.escape(status)}, ${mysql.escape(language)}, ${mysql.escape(compiler)}, ${mysql.escape(contractName)}, ${mysql.escape(version)}, ${mysql.escape(JSON.stringify(authors))}, ${mysql.escape(JSON.stringify(srcURLs))}, Now(), ${mysql.escape(signature)}, ${mysql.escape(verifier)}, ${mysql.escape(metadata)}, ${mysql.escape(wasm)} )`],
                "replace": ["status"],
                "replaceIfNull": ["metadata", "language", "compiler", "contractName", "version", "authors", "srcURLs", "verifyDT", "signature", "verifier", "wasm"]
            });
            this.logger.info({
                "op": "recordWASMCodeVerification SUCCESS",
                sql
            });
            return (true)
        } catch (err) {
            this.logger.error({
                "op": "recordWASMCodeVerification fail",
                err
            });
            throw new paraTool.InvalidError(err.toString());
        }
        return (false);
    }

    async getChainWASMCodeInfo(network, codeHash = null) {
        let chainID = this.network_to_chainID(network);
        let sql = codeHash ? `select codeHash, chainID, status, CONVERT(metadata using utf8) as metadata, CONVERT(srcURLs using utf8) as srcURLs, verifyDT, signature, verifier from wasmCode where codeHash = '${codeHash}' and chainID = '${chainID}'` : `select codeHash, chainID, status, CONVERT(metadata using utf8) as metadata, verifyDT, signature, verifier where chainID = '${chainID}' order by verifyDT desc limit 10`;
        let recs = await this.poolREADONLY.query(sql);
        if (recs.length == 1) {
            let r = recs[0];
            try {
                r.metadata = JSON.parse(r.metadata);
                r.srcURLs = JSON.parse(r.srcURLs);

            } catch (err) {

            }
            return r;
        }

        return null;
    }

    // Receives VERIFIED source code zip file with signature of codeHash, which is checked against whitelist
    // 0. If the network/codeHash is already verified, it doesn't do anything
    // 1. creates local codehash-specific directory
    // 2. copies zipfile into 1
    // 3. unzips zipfile into 1
    // 4. get metadata from unzipped 3, parsing metadata JSON
    // 5. records wasmCode data
    // 6. copies everything to CDN
    async postChainWASMContractVerification(network, codeHash, fileData, signature, publishSource = 1) {
        this.logger.info({
            "op": "postChainWASMContractVerification:INIT",
            network,
            codeHash
        });
        const util = require('util');
        const exec = util.promisify(require('child_process').exec);
        const AdmZip = require('adm-zip');
        const fs = require('fs');
        const path = require('path');
        let outputDirectory = "/tmp"
        let bucketDir = publishSource ? 'cdn.polkaholic.io/wasmcode' : 'unpublishedwasmcode';
        let size = fileData.size;
        let originalname = fileData.originalname;
        let gsDirectory = "gs://" + bucketDir;
        let zipFilePath = fileData.path;
        let chainID = this.network_to_chainID(network);
        if (chainID == null) {
            this.logger.error({
                "op": "postChainWASMContractVerification:invalid-network",
                network,
                codeHash
            });
            throw new paraTool.InvalidError(`Invalid network ${network}`)
        }

        // 0. If the network/codeHash is already verified, it doesn't do anything
        let verifier = await this.verify_codeHash_signature(codeHash, signature)
        if (verifier == null) {
            throw new paraTool.InvalidError(`Invalid signature ${signature} for ${codeHash}`)
        }


        if (await this.verified_wasm_codeHash(chainID, codeHash)) {
            // TODO: reenable
            // throw new paraTool.InvalidError(`Already verified ${codeHash} for ${network}`)
            this.logger.error({
                "op": "postChainWASMContractVerification:validate-verifier",
                verifier,
                publishSource,
                size,
                originalname,
                zipFilePath
            });
        }

        // 1. creates local codehash-specific directory
        let targetDirectory = path.join(outputDirectory, codeHash);
        if (!fs.existsSync(targetDirectory)) {
            fs.mkdirSync(targetDirectory);
        }

        // 2. copies zip file into local codehash-specific directory
        let zipFilePathOriginalName = path.join(targetDirectory, originalname);
        //console.log(`cp ${zipFilePath} ${zipFilePathOriginalName}`);
        fs.copyFileSync(zipFilePath, zipFilePathOriginalName);
        this.logger.info({
            "op": "postChainWASMContractVerification-zip file",
            zipFilePath,
            zipFilePathOriginalName
        });

        // 3. unzips zipfile into codehash-specific directory
        const zip = new AdmZip(zipFilePath);
        zip.extractAllTo(targetDirectory, true);
        const extractedEntries = zip.getEntries();

        // 4. gets metadata from unzipped file of 3, parsing metadata JSON
        let metadata = null;
        let cdnURL = "https://" + path.join(bucketDir, codeHash, originalname); // zip file
        let srcURLs = (publishSource > 0) ? [cdnURL] : [];
        for (const entry of extractedEntries) {
            if (entry.isDirectory) continue;
            if (entry.entryName.includes(".contract")) {
                let fn = path.join(targetDirectory, entry.entryName);
                //console.log("ENTRY", entry.entryName, fn);
                // parse metadata JSON
                try {
                    let metadataRaw = await fs.readFileSync(fn, "utf8")
                    metadata = JSON.parse(metadataRaw);
                } catch (err) {
                    throw new paraTool.InvalidError("Could not find metadata");
                }
            }
            if (publishSource > 0) {
                srcURLs.push("https://" + path.join(bucketDir, codeHash, entry.entryName));
            }
            if (metadata) {
                console.log("found metadata with srcURLs=", srcURLs);
            }
        }
        this.logger.info({
            "op": "postChainWASMContractVerification-unzipped",
            srcURLs
        });

        // 5. record wasmCode data
        try {
            await this.recordWASMCodeVerification(chainID, codeHash, srcURLs, size, signature, verifier, metadata);
        } catch (err) {
            throw new paraTool.InvalidError(err.toString());
        }

        // 6. copy the entire codehash specific directroy to google storage
        try {
            let cmd = `gsutil -m cp -r ${targetDirectory} ${gsDirectory}`
            const {
                stdout,
                stderr
            } = await exec(cmd, {
                maxBuffer: 1024 * 64000
            });
            let infoURL = `https://api.polkaholic.io/info/${network}/${codeHash}`;
            let result = {
                "success": true,
                network,
                codeHash,
                chainID,
                srcURLs,
                infoURL
            };
            this.logger.info({
                "op": "postChainWASMContractVerification-SUCCESS",
                cmd,
                result
            });
            console.log(cmd, stdout, result);
            return result;
        } catch (err) {
            throw new paraTool.InvalidError(err.toString());
        }
        return (false);
    }

    async updateWASMContract(address, contractData) {
        // fetch address codeHash's metadata
        let contract = await this.getContract(address)
        if (contract.metadata && contract.metadata.length > 0) {
            // throw exception if there is metadata already
            throw new paraTool.InvalidError(`Contract metadata exists already for Address ${address}`)
        }
        let metadata = JSON.parse(contractData);
        let source = metadata.source;
        let claimedHash = source.hash;
        let wasm = source.wasm;
        let language = source.language;
        let compiler = source.compiler;
        let actualHash = "0x" + paraTool.blake2_256_from_hex(wasm);
        if (claimedHash != actualHash) {
            throw new paraTool.InvalidError(`Hash error in .contract: file has hash ${claimedHash} but actual hash is ${actualHash}`)
        }
        if (contract.codeHash != actualHash) {
            throw new paraTool.InvalidError(`Code hash is ${contract.codeHash} but hash of supplied code is ${actualHash}`)
        }
        // store { metadata, language, compiler } (by the actualHash) in codeHash.metadata
        let sql = `update wasmCode set metadata = ${mysql.escape(contractData)}, language = ${mysql.escape(language)}, compiler = ${mysql.escape(compiler)} where codeHash = '${contract.codeHash}'`
        this.batchedSQL.push(sql);
        await this.update_batchedSQL();
    }

    async updateWASMCode(codeHash, contractData) {
        // fetch address codeHash's metadata
        let code = await this.getWASMCode(codeHash)
        if (code.metadata && code.metadata.length > 0) {
            // throw exception if there is metadata already
            throw new paraTool.InvalidError(`Code hash metadata exists already for codeHash ${codeHash}`)
        }
        let metadata = JSON.parse(contractData);
        let source = metadata.source;
        let claimedHash = source.hash;
        let wasm = source.wasm;
        let language = source.language;
        let compiler = source.compiler;
        let actualHash = "0x" + paraTool.blake2_256_from_hex(wasm);
        if (claimedHash != actualHash) {
            throw new paraTool.InvalidError(`Hash error in .contract: file has hash ${claimedHash} but actual hash is ${actualHash}`)
        }
        if (code.codeHash != actualHash) {
            throw new paraTool.InvalidError(`Code hash is ${contract.codeHash} but hash of supplied code is ${actualHash}`)
        }
        // store { metadata, language, compiler } (by the actualHash) in codeHash.metadata
        let sql = `update wasmCode set metadata = ${mysql.escape(contractData)}, language = ${mysql.escape(language)}, compiler = ${mysql.escape(compiler)} where codeHash = '${contract.codeHash}'`
        this.batchedSQL.push(sql);
        await this.update_batchedSQL();
    }

    async getXCMInfoLatest(chainID_or_chainName) {
        let [chainID, id] = this.convertChainID(chainID_or_chainName)
        if (chainID_or_chainName == "xcminfo") chainID = null;
        let w = (chainID) ? ` and chainID = '${chainID}'  ` : ""
        if (typeof chainID_or_chainName == "string" && (chainID_or_chainName.includes("0x"))) {
            w = ` and extrinsicHash = '${chainID_or_chainName}' `
        }
        let sql = `select traceID, convert(xcmInfo using utf8) as xcmInfo from xcmtransfer where  sourceTS > unix_timestamp(date_sub(Now(), interval 3 day)) and xcmInfo is not null ${w} order by sourceTS desc limit 1`
        try {
            let xcminfos = await this.poolREADONLY.query(sql);
            if (xcminfos.length > 0) {
                let xcminfo = JSON.parse(xcminfos[0].xcmInfo)
                xcminfo.traceID = xcminfos[0].traceID;
                return xcminfo;
            }
        } catch (e) {
            console.log(e);
        }
        return null;
    }

    async getXCMTransfersLog(chainID_or_chainName = null, chainIDDest_or_chainName = null) {
        let [chainID, id] = (chainID_or_chainName == null || chainID_or_chainName == "all") ? [null, null] : this.convertChainID(chainID_or_chainName)
        let [chainIDDest, idDest] = (chainIDDest_or_chainName == null || chainIDDest_or_chainName == "all") ? [null, null] : this.convertChainID(chainIDDest_or_chainName)
        let w = [];
        w.push(`sourceTS > unix_timestamp(date_sub(Now(), interval 48 hour))`)
        if (chainID) {
            w.push(`chainID = '${chainID}'`);
        }
        if (chainIDDest) {
            w.push(`chainIDDest = '${chainIDDest}'`);
        }
        if (typeof chainID_or_chainName == "string" && (chainID_or_chainName.includes("0x"))) {
            w.push(`extrinsicHash = '${chainID_or_chainName}'`);
        }
        let addTS_origination_unfinalized = {};
        let wstr = w.join(" and ");
        let sql = `select extrinsicHash, transactionHash, xcmIndex, transferIndex, symbol, msgHash, sourceTS, chainID, chainIDDest, convert(xcmInfo using utf8) xcmInfo, addTS, stage, 0 as delay from xcmtransferslog where ${wstr} order by addTS desc limit 100`
        try {
            let xcmtransferslog = await this.poolREADONLY.query(sql);
            if (xcmtransferslog.length > 0) {
                for (const m of xcmtransferslog) {
                    if (m.stage == "OriginationUnfinalized") {
                        addTS_origination_unfinalized[m.extrinsicHash] = m.addTS;
                    }
                    m.xcmInfo = JSON.parse(m.xcmInfo)
                }
                for (const m of xcmtransferslog) {
                    if (m.stage != "OriginationUnfinalized" && addTS_origination_unfinalized[m.extrinsicHash] != undefined) {
                        m.delay = m.addTS - addTS_origination_unfinalized[m.extrinsicHash];
                        if (m.delay > 180) {
                            m.delay = -1; // probably weirdness happened with extrinsicHash non-uniqueness
                        }
                    }
                }
            }
            return xcmtransferslog;
        } catch (e) {
            console.log(e);
        }
        return [];
    }

    pickXcmInfo(XCMInfoData) {
        let mainXcmInfo = false
        let xcmInfos = btTool.decode_xcminfofinalized(XCMInfoData)
        if (Array.isArray(xcmInfos) && xcmInfos.length > 0) {
            //MK - TODO: return infos as array
            mainXcmInfo = xcmInfos[0]
            if (xcmInfos.length >= 2) {
                let prevConf = 0
                for (const xcmInfo of xcmInfos) {
                    if (xcmInfo != undefined && xcmInfo.destination != undefined && xcmInfo.destination.confidence != undefined) {
                        let currConf = xcmInfo.destination.confidence
                        console.log(`prevConf=${prevConf}, currConf=${currConf}`)
                        if (currConf > prevConf) {
                            mainXcmInfo = xcmInfo
                            prevConf = currConf
                        }
                    }
                }
            }
        }
        return mainXcmInfo
    }

    async getXCMInfo(hash) {
        console.log(`!!! getXCMInfo hash=${hash} called`)
        const filter = {
            column: {
                cellLimit: 1
            },
        };
        if (!this.validAddress(hash)) {
            throw new paraTool.InvalidError(`Invalid Extrinsic Hash: ${hash}`)
        }
        try {
            const [row] = await this.btHashes.row(hash).get({
                filter
            });
            let rowData = row.data;
            let XCMInfoData = null;
            if (rowData["xcminfofinalized"]) {
                XCMInfoData = rowData["xcminfofinalized"]
            }
            if (XCMInfoData) {
                let xcmInfo = this.pickXcmInfo(XCMInfoData)
                return xcmInfo
            } else {
                throw new paraTool.InvalidError(`${hash} not found`)
            }
        } catch (e) {
            throw new paraTool.InvalidError(`Invalid ${hash}, err=${e.toString()}`)
        }
    }

    async getRouter(routerAssetChain) {
        let sql = `select routerName, routerAssetChain, tvl from router where routerAssetChain = '${routerAssetChain}' limit 1`;
        let routers = await this.poolREADONLY.query(sql)
        if (routers.length == 0) {
            throw new paraTool.InvalidError(`${routerAssetChain} not found`)
        }
        let router = routers[0];
        [router.asset, router.chainID] = paraTool.parseAssetChain(router.routerAssetChain);
        let [chainID, id] = this.convertChainID(router.chainID);
        router.id = id;
        router.chainName = this.getChainName(chainID)
        return router;
    }

    canonicalize_chainfilters(chainfilters) {
        if (typeof chainfilters == "string") {
            if (chainfilters == "all") return [];
            chainfilters = chainfilters.split(",");
        }
        let out = [];
        for (let i = 0; i < chainfilters.length; i++) {
            let [chainID, id] = this.convertChainID(chainfilters[i]);

            if (id) {
                out.push(chainID);
            } else {
                return null
            }
        }
        return out;
    }

    async getRouters(q, limit = 100) {
        let w = [];
        if (q.chainfilters) {
            let chainfilters = this.canonicalize_chainfilters(q.chainfilters);
            if (chainfilters && (chainfilters.length > 0)) {
                w.push(` chainID in (${chainfilters.join(",")})`)
            }
        }
        w.push("tvl > 0");
        let wstr = (w.length > 0) ? `where ${w.join(" and ")}` : "";
        let sql = `select routerName, routerAssetChain, chainID, tvl from router ${wstr} order by tvl desc limit ${limit}`;
        let routers = await this.poolREADONLY.query(sql)
        for (const r of routers) {
            [r.asset, r.chainID] = paraTool.parseAssetChain(r.routerAssetChain);
            let [chainID, id] = this.convertChainID(r.chainID);
            r.id = id;
            r.chainName = this.getChainName(chainID)
        }

        return routers;
    }

    async getPool(asset, chainID) {
        let sql = `select assetType, asset, chainID, assetName, token0, token1, token0Symbol, token1Symbol, symbol, decimals, priceUSD, totalFree, totalReserved, apy1d, apy7d, apy30d, feesUSD1d, feesUSD7d, feesUSD30d from asset where asset = '${asset}' and chainID = '${chainID}'`
        let pools = await this.poolREADONLY.query(sql)
        if (pools.length == 0) {
            throw new paraTool.InvalidError(`${asset}/${chainID} not found`)
        }
        let p = pools[0];
        let [_, id] = this.convertChainID(chainID)
        p.id = id
        p.chainName = this.getChainName(chainID)
        p.poolName = p.token0Symbol + "/" + p.token1Symbol;
        p.tvlFree = p.priceUSD * p.totalFree;
        p.tvlReserved = p.priceUSD * p.totalReserved;

        return p;
    }

    async getPoolHistory(asset, chainID, interval = "hourly", lookbackDays = 90) {
        let sql = `select indexTS, priceUSD, low, high, open, close, lp0, lp1, token0Volume, token1Volume, issuance, CONVERT(state using utf8) as state from assetlog where asset = '${asset}' and chainID = '${chainID}' and indexTS > UNIX_TIMESTAMP(date_sub(Now(), INTERVAL ${lookbackDays} DAY)) and indexTS % 3600 = 0 order by indexTS desc`
        console.log("getPoolHistory", sql);
        let recs = await this.poolREADONLY.query(sql)
        let h = [];
        let pool = await this.getPool(asset, chainID);

        let token0 = pool.token0;
        let token1 = pool.token1;
        for (const r of recs) {
            let p0 = await this.getTokenPriceUSD(token0, chainID, r.indexTS + 1800);
            let p1 = await this.getTokenPriceUSD(token1, chainID, r.indexTS + 1800);
            if (p0 && p1) {
                let issuance = parseFloat(r.issuance);
                let tvlUSD = p0.priceUSD * r.lp0 + p1.priceUSD * r.lp1;
                let priceUSD = tvlUSD / issuance;
                let state = JSON.parse(r.state);
                let volumeUSD = parseFloat(r.token0Volume) * p0.priceUSD + parseFloat(r.token1Volume) * p1.priceUSD;
                let feesUSD = .0025 * volumeUSD; // (state.token0Volume) * 0.0025 * p0.priceUSD + (s.token1Volume) * 0.0025 * p1.priceUSD;
                let feesUSDimp = state.token0Fee * p0.priceUSD + state.token1Fee * p1.priceUSD; // which could be negative
                h.push({
                    indexTS: r.indexTS,
                    issuance: issuance,
                    priceUSD: priceUSD,
                    open: r.open,
                    low: r.low,
                    high: r.high,
                    close: r.close,
                    tvlUSD: tvlUSD,
                    volumeUSD: volumeUSD,
                    feesUSD: feesUSD,
                    feesUSDimp: feesUSDimp
                });
            }
        }
        h.sort(function(a, b) {
            return (a.indexTS - b.indexTS);
        });
        return h;
    }

    async getPools(q) {
        try {
            let w = [];
            if (q.symbol) {
                // this xc prefix is a hack but works so... hmm.
                w.push(`( token0symbol = '${q.symbol}' or token1Symbol = '${q.symbol}' or token0symbol = 'xc${q.symbol}' or token1symbol = 'xc${q.symbol}')`);
            }
            if (q.assetChain) {
                let [asset, chainID] = paraTool.parseAssetChain(q.assetChain);
                w.push(`( ( token0 = '${asset}' or token1 = '${asset}' ) and chainID = '${chainID}' )`);
            } else if (q.routerAssetChain) {
                if (q.routerAssetChain.includes("parachain")) {
                    let [_, chainID] = paraTool.parseAssetChain(q.routerAssetChain);
                    w.push(`(asset.chainID = '${chainID}')`)
                } else {
                    w.push(`(assetName in (select assetName from router where routerAssetChain = '${q.routerAssetChain}'))`);
                }
            } else if (q.chainfilters) {
                let chainfilters = this.canonicalize_chainfilters(q.chainfilters)
                if (chainfilters && chainfilters.length > 0) {
                    w.push(`( chainID in (${chainfilters.join(",")}) or token0xcmchainID in (${chainfilters.join(",")}) or token1xcmchainID in (${chainfilters.join(",")}))`);
                }
            }
            if (w.length == 0) {
                w.push(" tvlUSD > 0 ");
            }
            w.push(`assetType in ('ERC20LP', 'LiquidityPair')`);
            let wstr = (w.length > 0) ? w.join(" and ") : "";
            let sql = `select assetType, assetName, asset, chainID, priceUSD, symbol as localSymbol, decimals, currencyID, token0, token1, token0Decimals, token1Decimals, token0Symbol, token1Symbol, totalFree, totalReserved, totalMiscFrozen, totalFrozen, token0Supply, token1Supply, totalSupply, numHolders, tvlUSD, apy1d, apy7d, apy30d, feesUSD1d, feesUSD7d, feesUSD30d from asset where ${wstr};`
            console.log(sql);

            let pools = await this.poolREADONLY.query(sql)
            for (let p of pools) {
                if (p.totalFree == 0) {
                    p.priceUSD = 0;
                }
                let [_, id] = this.convertChainID(p.chainID)
                p.id = id
                p.chainName = this.getChainName(p.chainID)
                p.poolName = p.token0Symbol + "/" + p.token1Symbol;
            }
            return pools
        } catch (e) {
            console.log(e)
            //throw new paraTool.InvalidError(`Invalid ${hash}, err=${e.toString()}`)
        }
    }
}