// node testDecodeBlock.js

async function main() {
    const {
        ApiPromise,
        WsProvider
    } = require('@polkadot/api');
    const paraTool = require("./paraTool");

    var [chainID, blockNumber, blockHash, eraNumber] = [0, 20439207, "0x73889aac463b4290f5e2a018b5ebbbd1a6c474b93c9d0551cccb4942c9a2e909", 1420];
    var WSEndpoints = "wss://polkadot-rpc.dwellir.com"
    var api = await ApiPromise.create({
        provider: new WsProvider(WSEndpoints) //wss://kusama-rpc.polkadot.io
    });
    await api.isReady;
    var apiAt = await api.at(blockHash)

    var votes = await api.query.convictionVoting.votingFor.entries();

    var bounties = await api.query.bounties.bounties.entries();


    var [delegateeMap, voteStateMap] = process_voteStates(votes)
    //voteStateMap['16Zw7drubm8LkaoNSPtNBAaoq2bQAL4m7oySPp4RuXvmETDG']['track_33']['casting']

    votes.forEach((vote) => {
        if (vote[1].toHuman()['Casting']) {
            if (vote[1].toHuman()['Casting']['votes'].length > 0) {
                console.log(vote[0].toHuman());
                console.log(JSON.stringify(vote[1].toHuman(), null, 4));
            }
        }
    });

    /*
        /// Referendum has been submitted and is being voted on.
        Ongoing(
            ReferendumStatus<
                TrackId,
                RuntimeOrigin,
                Moment,
                Call,
                Balance,
                Tally,
                AccountId,
                ScheduleAddress,
            >,
        ),
        /// Referendum finished with approval. Submission deposit is held.
        Approved(Moment, Deposit<AccountId, Balance>, Option<Deposit<AccountId, Balance>>),
        /// Referendum finished with rejection. Submission deposit is held.
        Rejected(Moment, Deposit<AccountId, Balance>, Option<Deposit<AccountId, Balance>>),
        /// Referendum finished with cancellation. Submission deposit is held.
        Cancelled(Moment, Deposit<AccountId, Balance>, Option<Deposit<AccountId, Balance>>),
        /// Referendum finished and was never decided. Submission deposit is held.
        TimedOut(Moment, Deposit<AccountId, Balance>, Option<Deposit<AccountId, Balance>>),
        /// Referendum finished with a kill.
        Killed(Moment),
    */

    var chainDecimals = 10
    var referenda = await api.query.referenda.referendumInfoFor.entries();


    /*
        Referendum_212
        {
            "timedOut": [
                18056905,
                {
                    "who": "16JpoofitetnvCCuAVikBmYUKMExewpn1DPA6Dy5PMEz1aYg",
                    "amount": 10000000000
                },
                null
            ]
        }
        Referendum_1
        {
            "rejected": [
                16384061,
                {
                    "who": "14d2kv44xf9nFnYdms32dYPKQsr5C9urbDzTz7iwU8iHb9az",
                    "amount": 10000000000
                },
                null
            ]
        }


        Referendum_118
        {
            "approved": [
                17193828,
                null,
                null
            ]
        }
        Referendum_439
        {
            "ongoing": {
                "track": 33,
                "origin": {
                    "origins": "MediumSpender"
                },
                "proposal": {
                    "lookup": {
                        "hash": "0x7337da82f05539f16fc526d1f9508e04d0ddfa542d43f8c99c052b8011d70d60",
                        "len": 43
                    }
                },
                "enactment": {
                    "after": 1
                },
                "submitted": 19159452,
                "submissionDeposit": {
                    "who": "12eWtdVxQ9ScYD9AzyMuSsX8B9iEikWtUGiirJ1YJtDCCuwu",
                    "amount": 10000000000
                },
                "decisionDeposit": {
                    "who": "12eWtdVxQ9ScYD9AzyMuSsX8B9iEikWtUGiirJ1YJtDCCuwu",
                    "amount": 2000000000000
                },
                "deciding": {
                    "since": 19161852,
                    "confirming": null
                },
                "tally": {
                    "ayes": "0x00000000000000000058584027cd5043",
                    "nays": "0x0000000000000000003dbb28994e7efc",
                    "support": "0x0000000000000000002be3f2980e69af"
                },
                "inQueue": false,
                "alarm": [
                    19539673,
                    [
                        19539673,
                        0
                    ]
                ]
            }
        }
    */

    /*
    treasuryIndex=592 {
      proposer: '12ow3eJ3vbjeNRahUUrBnc98mWeJTSQ7rJCAVqiFQDEnzbu8',
      value: 1067000000000000,
      beneficiary: '12ow3eJ3vbjeNRahUUrBnc98mWeJTSQ7rJCAVqiFQDEnzbu8',
      bond: 0
    }
    */
}

async function paginated_fetch(apiAt, section = "convictionVoting", storage = "votingFor") {
    if (apiAt.query[section] != undefined && apiAt.query[section][storage] != undefined) {} else {
        console.log(`${section}:${storage} not found!`)
        return false
    }
    let perPagelimit = 1000
    var section_storage_num_last_key = '';
    var section_storage_num_page = 0;
    var section_storage_done = false
    var section_storage_num = 0
    var results = []
    while (!section_storage_done) {
        let query = null
        console.log(`section_storage_num_page=${section_storage_num_page}. pageSize=${perPagelimit}, startKey=${section_storage_num_last_key}`)
        query = await apiAt.query[section][storage].entriesPaged({
            args: [],
            pageSize: perPagelimit,
            startKey: section_storage_num_last_key
        })
        if (query.length == 0) {
            console.log(`Query ${section}:${storage} Completed: poolMembers=${section_storage_num}`)
            break
        } else {
            console.log(`${section}:${storage} page: `, section_storage_num_page++);
            section_storage_num_last_key = query[query.length - 1][0];
        }
        /*
        {
          poolId: 30
          points: 0
          lastRecordedRewardCounter: 164,532,633,942,265,733
          unbondingEras: {
            1261: 1,000,000,000,000
          }
        }
        */
        for (const res of query) {
            results.push(res)
            section_storage_num++
        }
        if (query.length > 0) {} else {
            section_storage_done = true;
        }
    }
    return results
}
/*
{
  proposer: 13YWynHAu8F8uKZFbQwvPgJ67xizvo21HCEQU3Ke8z1XHoyT
  value: 250,044,500,000,000
  fee: 0
  curatorDeposit: 100,000,000,000
  bond: 12,200,000,000
  : {
    Active: {
      curator: 12GkpkHocU4y1vFV2CpnA2AhkjzGGRtwucHFY77A5yyiQKp5
      updateDue: 20,130,808
    }
  }
}
{
  proposer: 15D2JM548bqRuE45aDmeF2WqiKC56WtNnRmCxVSree9YKwVb
  value: 158,827,800,000,000
  fee: 0
  curatorDeposit: 0
  bond: 13,300,000,000
  status: Funded
}
*/
function process_bounties(bounties, chainDecimals = 10) {
    var bountyMap = {}
    for (const bountie of bounties) {
        const bountieIndex = bountie[0].args[0].toNumber();
        var bounty_info = JSON.parse(JSON.stringify(bountie[1]))
        //console.log(`bountieIndex=${bountieIndex}`, bounty_info)
        var bounty_status = Object.keys(bounty_info.status)[0]
        var bounty_status_detail = bounty_info["status"][bounty_status]
        var detaill_struct = null

        let bounty_struct = {
            bounty_index: bountieIndex,
            proposer_ss58: bounty_info.proposer,
            proposer_pubkey: paraTool.getPubKey(bounty_info.proposer),
            value: paraTool.dechexToInt(bounty_info.value) / 10 ** chainDecimals,
            fee: paraTool.dechexToInt(bounty_info.fee) / 10 ** chainDecimals,
            curatorDeposit: paraTool.dechexToInt(bounty_info.curatorDeposit) / 10 ** chainDecimals,
            bond: bounty_info.bond,
            bounty_status: bounty_status,
            //status: detaill_struct
        }
        if (bounty_status_detail != undefined && bounty_status_detail.curator != undefined) {
            //detaill_struct = {}
            bounty_struct.curator_ss58 = bounty_status_detail.curator
            bounty_struct.curator_pubkey = paraTool.getPubKey(bounty_status_detail.curator)
        }
        if (bounty_status_detail != undefined && bounty_status_detail.updateDue != undefined) {
            bounty_struct.updateDue = bounty_status_detail.updateDue
        }
        console.log(bounty_struct)
        bountyMap[`${bountieIndex}`] = bounty_struct
    }
    return bountyMap
}
//var bountyMap  = process_bounties(bounties)


function process_treasury_proposals(treasury_proposals, chainDecimals = 10) {
    var treasuryMap = {}
    for (const treasury_proposal of treasury_proposals) {
        const treasuryIndex = treasury_proposal[0].args[0].toNumber();
        var treasury_info = JSON.parse(JSON.stringify(treasury_proposal[1]))
        //console.log(`treasuryIndex=${treasuryIndex}`, treasury_info)
        let treasury_proposal_struct = {
            treasury_index: treasuryIndex,
            proposer_ss58: treasury_info.proposer,
            proposer_pubkey: paraTool.getPubKey(treasury_info.proposer),
            value: paraTool.dechexToInt(treasury_info.value) / 10 ** chainDecimals,
            beneficiary_ss58: treasury_info.beneficiary,
            beneficiary_pubkey: paraTool.getPubKey(treasury_info.beneficiary),
            bond: paraTool.dechexToInt(treasury_info.bond) / 10 ** chainDecimals
        }
        //console.log(treasury_proposal_struct)
        treasuryMap[`${treasuryIndex}`] = treasury_proposal_struct
    }
    return treasuryMap
}

function process_referenda(referenda, chainDecimals = 10) {
    var referendaMap = {}
    for (const referendum of referenda) {
        const referendumIndex = referendum[0].args[0].toNumber();
        var referendumInfo = JSON.parse(JSON.stringify(referendum[1]))
        var referendumStatus = Object.keys(referendumInfo)[0]
        var referendumDetail = referendumInfo[referendumStatus]
        //console.log(`Referendum_${referendumIndex} (status:${referendumStatus})`);
        var referendaStruct = {
            status: 'unknown',
            ref_id: referendumIndex,
        }
        referendaStruct.status = referendumStatus
        if (referendumStatus != 'ongoing' && referendumStatus != 'killed') {
            referendaStruct.moment = referendumDetail[0]
            if (referendumDetail[1] != undefined && referendumDetail[1].who != undefined && referendumDetail[1].amount != undefined) {
                referendaStruct.submission_depositor = referendumDetail[1].who
                referendaStruct.submission_deposit = paraTool.dechexToInt(referendumDetail[1].amount) / 10 ** chainDecimals
            }
        } else if (referendumStatus == "ongoing") {
            if (referendumDetail.submissionDeposit != undefined && referendumDetail.submissionDeposit.who != undefined && referendumDetail.submissionDeposit.amount != undefined) {
                referendaStruct.submission_depositor = referendumDetail.submissionDeposit.who
                referendaStruct.submission_deposit = paraTool.dechexToInt(referendumDetail.submissionDeposit.amount) / 10 ** chainDecimals
                referendumDetail.submissionDeposit.amount = paraTool.dechexToInt(referendumDetail.submissionDeposit.amount) // 10**chainDecimals
            }
            if (referendumDetail.decisionDeposit != undefined && referendumDetail.decisionDeposit.who != undefined && referendumDetail.decisionDeposit.amount != undefined) {
                referendaStruct.decision_deposit = paraTool.dechexToInt(referendumDetail.decisionDeposit.amount) / 10 ** chainDecimals
                referendumDetail.decisionDeposit.amount = paraTool.dechexToInt(referendumDetail.decisionDeposit.amount) // 10**chainDecimals
            }
            if (referendumDetail.tally != undefined) {
                referendaStruct.tally_ayes = paraTool.dechexToInt(referendumDetail.tally.ayes) / 10 ** chainDecimals
                referendaStruct.tally_nays = paraTool.dechexToInt(referendumDetail.tally.nays) / 10 ** chainDecimals
                referendaStruct.tally_support = paraTool.dechexToInt(referendumDetail.tally.support) / 10 ** chainDecimals
                referendumDetail.tally.ayes = paraTool.dechexToInt(referendumDetail.tally.ayes)
                referendumDetail.tally.nays = paraTool.dechexToInt(referendumDetail.tally.nays)
                referendumDetail.tally.support = paraTool.dechexToInt(referendumDetail.tally.support)
            }
            referendaStruct.referendum_detil = referendumDetail
        }
        //console.log(`Referendum_${referendumIndex}`, referendaStruct)
        referendaMap[`${referendumIndex}`] = referendaStruct

        /*
        for (const ref_id of Object.keys(referendaMap)){
            console.log(`Referendum_${ref_id}`, referendaMap[ref_id])
        }
        */
    }
    return referendaMap
}

function process_voteStates(votes, chainDecimals = 10) {
    var trackMap = {
        "0": 'Root',
        "1": 'WhitelistedCaller',
        "10": 'StakingAdmin',
        "11": 'Treasurer',
        "12": 'LeaseAdmin',
        "13": 'FellowshipAdmin',
        "14": 'GeneralAdmin',
        "15": 'AuctionAdmin',
        "20": 'ReferendumCanceller',
        "21": 'ReferendumKiller',
        "30": 'SmallTipper',
        "31": 'BigTipper',
        "32": 'SmallSpender',
        "33": 'MediumSpender',
        "34": 'BigSpender'
    };
    var convictionMap = {
        "0.1": 'None',
        "1": 'Locked1x',
        "2": 'Locked2x',
        "3": 'Locked3x',
        "4": 'Locked4x',
        "5": 'Locked5x',
        "6": 'Locked6x',
        'None': 0.1,
        'Locked1x': 1,
        'Locked2x': 2,
        'Locked3x': 3,
        'Locked4x': 4,
        'Locked5x': 5,
        'Locked6x': 6,
    };

    var directVotingMap = {}
    var delegateeMap = {}
    var voteStateMap = {}
    var rawVotes = votes
    for (const vote of rawVotes) {
        let voteStruct = {}
        let voteK = vote[0].toHuman()
        let voter = voteK[0]
        let track_id = voteK[1]
        let track = trackMap[`${voteK[1]}`]
        let voted = []
        let voteV = JSON.parse(JSON.stringify(vote[1]))
        //console.log(`voter=${voter} (track:${track})`);
        if (voteV.casting != undefined && voteV.delegating != undefined) {
            console.log(`voter=${voter} (track:${track}) Both casting and delegating!!!`);
        }
        if (voteV.casting != undefined) {
            //console.log(`voter=${voter} (track:${track}) is direct voting`);
            let refVotes = []
            let voteCnt = voteV.casting.votes.length
            //refVote [ 256, { standard: { vote: '0x01', balance: 75000000000 } } ]
            let casting = voteV.casting
            let casting_votes = casting.votes
            let casting_delegation = casting.delegations
            let casting_prior = casting.prior

            for (const refVote of casting_votes) {
                let pollID = refVote[0]
                let refDetail = refVote[1]
                let refV = {}
                voted.push(pollID)
                if (refDetail.standard != undefined) {
                    let voteIdx = paraTool.dechexToInt(refDetail.standard.vote)
                    let voteType = (voteIdx >= 128) ? 'aye' : 'nay'
                    let conviction_weight = (voteIdx % 16 == 0) ? 0.1 : voteIdx % 16
                    let conviction = convictionMap[`${conviction_weight}`]
                    let standardV = {
                        pollID: pollID,
                        voteType: voteType,
                        conviction: conviction,
                        conviction_weight: conviction_weight,
                        voteAye: (voteType = "aye") ? paraTool.dechexToInt(refDetail.standard.balance) / 10 ** chainDecimals : 0,
                        voteNay: (voteType = "nay") ? paraTool.dechexToInt(refDetail.standard.balance) / 10 ** chainDecimals : 0,
                        voteAbstain: 0,
                    }
                    refV[`referendum_${pollID}`] = standardV
                    refVotes.push(refV)
                } else if (refDetail.splitAbstain) {
                    //TODO
                    //{splitAbstain: { aye: 10000000000, nay: 10000000000, abstain: 20000000000 }}
                    let splitAbstainV = {
                        pollID: pollID,
                        voteType: 'splitAbstain',
                        conviction: 'None',
                        conviction_weight: 0.1,
                        voteAye: paraTool.dechexToInt(refDetail.splitAbstain.aye) / 10 ** chainDecimals,
                        voteNay: paraTool.dechexToInt(refDetail.splitAbstain.nay) / 10 ** chainDecimals,
                        voteAbstain: paraTool.dechexToInt(refDetail.splitAbstain.abstain) / 10 ** chainDecimals,
                    }
                    refV[`referendum_${pollID}`] = splitAbstainV
                    refVotes.push(refV)
                    //console.log(`splitAbstain!`, splitAbstainV)
                } else if (refDetail.split != undefined) {
                    //TODO
                    //{ split: { aye: 0, nay: 0 } }
                    // split vote has no convition
                    let splitV = {
                        pollID: pollID,
                        conviction: 'None',
                        conviction_weight: 0.1,
                        voteType: 'split',
                        voteConviction: 0.1,
                        voteAye: paraTool.dechexToInt(refDetail.split.aye) / 10 ** chainDecimals,
                        voteNay: paraTool.dechexToInt(refDetail.split.nay) / 10 ** chainDecimals,
                        voteAbstain: 0,
                    }
                    refV[`referendum_${pollID}`] = splitV
                    refVotes.push(refV)
                    //console.log(`split!`, refDetail)
                }
                //console.log(`refVote`, refVote)
            }
            //console.log(`refVotes`, refVotes)

            casting_votes = refVotes
            if (casting_delegation != undefined) {
                casting_delegation.votes = paraTool.dechexToInt(casting_delegation.votes) / 10 ** chainDecimals
                casting_delegation.capital = paraTool.dechexToInt(casting_delegation.capital) / 10 ** chainDecimals
                casting_delegation.average_conviction = 0
                if (casting_delegation.votes > 0) {
                    //casting_delegation.average_conviction = casting_delegation.votes / casting_delegation.capital
                    casting_delegation.average_conviction = Math.round(((casting_delegation.votes / casting_delegation.capital) + Number.EPSILON) * 10000) / 10000
                    if (delegateeMap[voter] == undefined) delegateeMap[voter] = {}
                    if (delegateeMap[voter][`track_${track_id}`] == undefined) {
                        delegateeMap[voter][`track_${track_id}`] = {
                            track_id: track_id,
                            track: track,
                            delegatee_ss58: voter,
                            delegatee_pubkey: paraTool.getPubKey(voter),
                            delegations_votes: 0,
                            delegations_capital: 0,
                            delegations_average_conviction: 0,
                            delegators: [],
                            delegators_info: [],
                        }
                    }
                    delegateeMap[voter][`track_${track_id}`].delegations_votes = casting_delegation.votes
                    delegateeMap[voter][`track_${track_id}`].delegations_capital = casting_delegation.capital
                    delegateeMap[voter][`track_${track_id}`].delegations_average_conviction = casting_delegation.average_conviction
                }
            }
            let priorStruct = {
                bn: casting_prior[0],
                balance: paraTool.dechexToInt(casting_prior[1]) / 10 ** chainDecimals
            }
            let castingStruct = {
                track_id: track_id,
                track: track,
                voted: voted,
                voted_cnt: voted.length,
                votes: refVotes,
                delegations: casting_delegation,
                prior: priorStruct,
            }
            voteStruct.casting = castingStruct
            if (voteCnt >= 0) {
                //console.log(`voter=${voter} (track:${track}) direct voting detail`, JSON.stringify(castingStruct, null, 4))
            }
        }
        /*
            {
              balance: '0x000000000000000000ae153d89fe8000',
              target: '14mSXQeHpF8NT1tMKu87tAbNDNjm7q9qh8hYa7BY2toNUkTo',
              conviction: 'Locked3x',
              delegations: { votes: 0, capital: 0 },
              prior: [ 0, 0 ]
            }
        */
        let delegating = voteV.delegating
        if (delegating != undefined) {
            //console.log(`voter=${voter} (track:${track}) is delegating voting`);
            let delegatingStruct = {
                track_id: track_id,
                track: track,
                balance: paraTool.dechexToInt(delegating.balance) / 10 ** chainDecimals,
                delegator_ss58: voter,
                delegator_pubkey: paraTool.getPubKey(voter),
                target_ss58: delegating.target,
                target_pubkey: paraTool.getPubKey(delegating.target),
                conviction: delegating.conviction,
                conviction_weight: convictionMap[delegating.conviction],
            }
            let delegatorInfoStruct = {
                delegator_ss58: delegatingStruct.delegator_ss58,
                delegator_pubkey: delegatingStruct.delegator_pubkey,
                balance: delegatingStruct.balance,
                conviction: delegatingStruct.conviction
            }
            let delegatee = delegatingStruct.target_ss58
            if (delegating.delegations != undefined) {
                delegating.delegations.votes = paraTool.dechexToInt(delegating.delegations.votes) / 10 ** chainDecimals
                delegating.delegations.capital = paraTool.dechexToInt(delegating.delegations.capital) / 10 ** chainDecimals
                delegating.delegations.average_conviction = 0
                if (delegating.delegations.votes > 0) {
                    //delegating.delegations.average_conviction = delegating.delegations.votes / delegating.delegations.capital
                    delegating.delegations.average_conviction = Math.round(((delegating.delegations.votes / delegating.delegations.capital) + Number.EPSILON) * 10000) / 10000
                }
            }
            delegatingStruct.delegations = delegating.delegations
            delegatingStruct.prior = {
                bn: delegating.prior[0],
                balance: paraTool.dechexToInt(delegating.prior[1]) / 10 ** chainDecimals
            }
            let hasPrior = false
            if (delegating.prior[1] > 0) {
                hasPrior = 1
                //console.log(`voteV.delegating with prior lock`, voteV.delegating)
            }
            voteStruct.delegating = delegatingStruct
            //console.log(`voter=${voter} (track:${track}) delegating detail`, JSON.stringify(voteStruct, null, 4))
            let delegateeKey = `${delegatingStruct.target}_${track_id}`
            if (delegateeMap[delegatee] == undefined) delegateeMap[delegatee] = {}
            if (delegateeMap[delegatee][`track_${track_id}`] == undefined) {
                delegateeMap[delegatee][`track_${track_id}`] = {
                    track_id: track_id,
                    track: track,
                    delegatee_ss58: delegatee,
                    delegatee_pubkey: paraTool.getPubKey(delegatee),
                    delegations_votes: 0,
                    delegations_capital: 0,
                    delegations_average_conviction: 0,
                    delegators: [],
                    delegators_info: [],
                }
            }
            delegateeMap[delegatee][`track_${track_id}`].delegators.push(voter)
            delegateeMap[delegatee][`track_${track_id}`].delegators_info.push(delegatorInfoStruct)
        }

        if (voteStateMap[voter] == undefined) voteStateMap[voter] = {}
        if (voteStateMap[voter][`track_${track_id}`] == undefined) {
            voteStateMap[voter][`track_${track_id}`] = {}
        }
        voteStateMap[voter][`track_${track_id}`] = voteStruct
    }

    /*
    Ivy: 16Zw7drubm8LkaoNSPtNBAaoq2bQAL4m7oySPp4RuXvmETDG ;
    chaos dao: 13EyMuuDHwtq5RD6w3psCJ9WvJFZzDDion6Fd2FVAqxz1g7K
    Birdo: 12s37eSMQPEN5cuVyBxk2UypUHntwumqBHy7sJkoKpZ1v3HV
    Michalis: 14id3ENXVkJ34Q51AfWDGcMHA1EbGu8obF8QJLEUkzAB8KVh
    DottyDreamer: 142H5Qn7HHfkd3r4s5wdQwt3sJMw3aiUK96495Rbr91Ewnzf
    Anon: 14zPdpZPzsB25DUHrmBxxZtNPoH3D6Cn9y5x6W4i1W342eer
    Vitas: 1v8nuDB4ChEumFThaj7sSySR88nBDmViBJfvhWA2zqmtvY3
    */
    //delegateeMap['13EyMuuDHwtq5RD6w3psCJ9WvJFZzDDion6Fd2FVAqxz1g7K']
    return [delegateeMap, voteStateMap]
}

main()
    .then(() => {
        process.exit(0);
    })
    .catch((e) => {
        console.error('ERROR', e);
        process.exit(1);
    });