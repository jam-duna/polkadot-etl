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

// Indexes Substrate Chains with WSS and JSON RPC using
//  BigTable chain${chainID}
//   row.id is the HEX of the blockNumber
//   columns: (all cells with timestamp of the block)
//      blockraw:raw/blockHash -- block object holding extrinsics + events
//      trace:raw/blockHash -- array of k/v, deduped
//      finalized:blockHash
//  Mysql    block${chainID})
//      blockNumber (primary key)
//      lastTraceDT -- updated on storage
//      blockDT   -- updated on finalized head
//      blockHash -- updated on finalized head
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const ethTool = require("./ethTool");
const Endpoints = require("./summary/endpoints");
const PolkaholicDB = require("./polkaholicDB");
const TGBotAPI = require('node-telegram-bot-api');
const fs = require('fs');
const path = require("path");
const {
    bnToHex,
    hexToBn,
    hexToU8a,
    isHex,
    stringToU8a,
    u8aToHex,
    hexToString
} = require("@polkadot/util");
const {
    xxhashAsHex,
    blake2AsHex,
    blake2AsU8a
} = require('@polkadot/util-crypto');
const {
    XXHash32,
    XXHash64,
    XXHash3,
    XXHash128
} = require('xxhash-addon');
const {
    Keyring,
    decodeAddress,
    encodeAddress
} = require("@polkadot/keyring");
const {
    StorageKey
} = require('@polkadot/types');

const mysql = require("mysql2");
const Indexer = require("./indexer");
const paraTool = require("./paraTool");

const maxTraceAttempts = 10;
const minCrawlTracesToActivateRPCBackfill = 1;

module.exports = class telegrambot extends PolkaholicDB {
    constructor(debugLevel = false) {
        super()
    }

    telegramUsers = {};
    userState = {};
    bot;

    async fetchTelgramUsers() {
        let users = await this.poolREADONLY.query(`SELECT accountPubKey, username, chatID, eventsConfig from telegramconfig where chatID is not null;`)
        let userMap = {}
        for (const u of users) {
            if (u.accountPubKey != undefined) {
                u.address_ss58 = paraTool.getAddress(u.accountPubKey)
            }
            userMap[u.chatID] = u
        }
        return userMap
    }

    async initTelegramUsers() {
        this.telegramUsers = await this.fetchTelgramUsers();
        console.log(`telegramUsers`, this.telegramUsers)
    }

    async updateAccountPubkey(chatID, accountPubKey = null, username = null) {
        let pubkey = (accountPubKey) ? `'${accountPubKey}'` : `NULL`
        let ss58 = null;
        if (pubkey != undefined) {
            try {
                ss58 = paraTool.getAddress(accountPubKey)
            } catch (e) {
                pubkey = `NULL`
            }
        }
        let name = (username) ? `'${username}'` : `NULL`
        let sql = `insert into telegramconfig (chatID, accountPubKey, username) values ('${chatID}',  ${pubkey}, ${name}) on duplicate key update accountPubKey = values(accountPubKey), username = values(username)`
        this.batchedSQL.push(sql);
        let user = {
            accountPubKey: accountPubKey,
            address_ss58: ss58,
            username: username,
            chatID: chatID,
        }
        this.telegramUsers[chatID] = user
        await this.update_batchedSQL()
    }

    async initBot() {
        const configFile = fs.readFileSync('/root/telegramtoken.json');
        const config = JSON.parse(configFile);
        const token = config.telegramToken;
        const ownerchatID = paraTool.dechexToInt(config.owner);
        console.log(`TOKEN:${token}. ownerchatID=${ownerchatID}`)
        let bot = new TGBotAPI(token, {
            polling: true
        });
        this.bot = bot
        bot.on("polling_error", console.log); // not sure why it's required..

    }

    start() {

        // The menu options
        const stakingInlineMenu = {
            reply_markup: JSON.stringify({
                inline_keyboard: [
                    [{
                        text: 'Poolmember Dashboard 📈',
                        callback_data: 'pool_member_daily_rewards'
                    }, {
                        text: 'Join Nomination Pool 👥',
                        callback_data: 'join_pool'
                    }],
                    [{
                        text: 'Nominator Dashboard 💰',
                        callback_data: 'nominator_daily_rewards'
                    }, {
                        text: 'Democroacy 🗳️',
                        callback_data: 'democroacy'
                    }],
                    [{
                        text: 'Vew Account 👤',
                        callback_data: 'show_account'
                    }, {
                        text: 'Staking Dashboard 📊',
                        callback_data: 'staking_dashboard'
                    }],
                    [{
                        text: 'Set Polkadot Address ➕',
                        callback_data: 'set_address'
                    }, {
                        text: 'Settings ⚙️',
                        callback_data: 'settings'
                    }, ]
                ]
            })
        };

        const setAddressMenu = {
            reply_markup: JSON.stringify({
                inline_keyboard: [
                    [{
                        text: 'Set Polkadot Address ➕',
                        callback_data: 'set_address'
                    }]
                ]
            })
        };

        let bot = this.bot
        // Matches "/echo [whatever]"
        bot.onText(/\/echo (.+)/, (msg, match) => {
            // 'msg' is the received Message from Telegram
            // 'match' is the result of executing the regexp above on the text content
            // of the message

            const chatID = msg.chat.id;
            const resp = match[1]; // the captured "whatever"

            // send back the matched "whatever" to the chat
            bot.sendMessage(chatID, resp);
        });

        bot.on('message', async (msg) => { // Notice the async keyword here
            let chatID = msg.chat.id;
            let username = (msg.from && msg.from.username) ? msg.from.username : null;
            let user = this.telegramUsers[chatID];
            console.log(`user`, user);

            // If we're waiting for the user to input their Polkadot address, handle that
            if (this.userState[chatID] && this.userState[chatID].awaitingAddress) {
                let polkadotAddress = msg.text;

                try {
                    let pubkey = paraTool.getPubKey(polkadotAddress);
                    let address_ss58 = paraTool.getAddress(pubkey);
                    // Reset the awaiting address state
                    this.userState[chatID].awaitingAddress = false;
                    await this.updateAccountPubkey(chatID, pubkey, username); // Using await here is now valid
                    delete this.userState[chatID];
                    // Send a confirmation message back to the user
                    bot.sendMessage(chatID, `Nicely Done! Your Polkadot address has been set to: [${address_ss58}](https://polkaholic.io/account/${address_ss58})`, {
                        parse_mode: 'Markdown'
                    });
                    bot.sendMessage(chatID, 'Check out what you can do next', stakingInlineMenu);
                } catch (e) {
                    console.log(`error`, e);
                    bot.sendMessage(chatID, `Sorry, invalid address detected. Please try again.`);
                }
            } else {
                // Not waiting for an address, show the menu options
                if (msg.text.startsWith('/start') || msg.text.startsWith('/help')) {
                    bot.sendMessage(chatID, 'Welcome to the Polkadot Staking Bot. Choose an option to proceed:', stakingInlineMenu);
                }
            }
        });

        bot.on('callback_query', (callbackQuery) => {
            let message = callbackQuery.message;
            let category = callbackQuery.data; // The 'callback_data' you receive from your inline keyboard
            let chatID = message.chat.id;
            let user = this.telegramUsers[chatID]
            console.log(`user!`, user)
            let address_ss58 = null;
            if (user != undefined && user.address_ss58 != undefined) {
                address_ss58 = user.address_ss58
            }
            // Logs just for debugging purposes
            console.log(`Received callback query: ${category} from ${chatID}`);
            if (address_ss58 == undefined && category != "set_address") {
                bot.sendMessage(chatID, 'This feature is not available until Polkadot address is configured.', setAddressMenu);
            } else if (category === 'set_address') {
                // Set the user state as awaiting a Polkadot address
                this.userState[chatID] = {
                    awaitingAddress: true
                };
                // Prompt the user to enter their Polkadot address
                bot.sendMessage(chatID, 'Please enter your Polkadot address:');
            } else {
                // Handle other options
                let responseText = '';
                let parse_mode = null; //Markdown, HTML, MarkdownV2

                switch (category) {
                    case 'pool_member_daily_rewards':
                        parse_mode = "Markdown"
                        responseText = `Track your personalized nomination pool APY at [Polkaholic Account Anlytics](https://analytics.polkaholic.io/superset/dashboard/77/?account=${address_ss58})`;
                        break;
                    case 'join_pool':
                        parse_mode = "Markdown"
                        responseText = 'Fantastic choice! You can join [Polkaholic.io Nomination Pool](https://staking.polkadot.network/#/pools) and unlock cool features like daily reward tracking.';
                        break;
                    case 'nominator_daily_rewards':
                        parse_mode = "Markdown"
                        responseText = `Track your personalized nominator APY at [Polkaholic Account Anlytics](https://analytics.polkaholic.io/superset/dashboard/71/?account=${address_ss58})`;
                        break;
                    case 'show_account':
                        parse_mode = "Markdown"
                        responseText = `View Polkadot address [${address_ss58}](https://polkaholic.io/account/${address_ss58})`;
                        break;
                    case 'staking_dashboard':
                        parse_mode = "Markdown"
                        responseText = `View [Polkaholic Staking Dashboard](https://analytics.polkaholic.io/superset/dashboard/80/)`;
                        responseText = '".';
                        break;
                    case 'democroacy':
                        responseText = "TODO";
                        break;
                    case 'settings':
                        responseText = "TODO";
                        break;
                    default:
                        responseText = 'Unknown option. Please try again.';
                }

                // Send the response message
                if (parse_mode != undefined) {
                    bot.sendMessage(chatID, responseText, {
                        parse_mode: parse_mode
                    });
                } else {
                    bot.sendMessage(chatID, responseText);
                }
            }

            // Always remember to answer the callback query, even if it's with an empty string
            // This is required by the Telegram API to acknowledge that it's been processed
            bot.answerCallbackQuery(callbackQuery.id).catch(console.error);
        });
    }
}