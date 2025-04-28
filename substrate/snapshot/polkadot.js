const paraTool = require("../paraTool");
const SnapShotter = require("./snapshotter");

const trackMap = {
    "0": 'Root',
    "1": 'WhitelistedCaller',
    "2": 'WishForChange',
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
const convictionMap = {
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

module.exports = class PolkadotSnapShotter extends SnapShotter {
    constructor() {
        super()
        this.chainName = 'Polkadot'
        this.chainDecimals = 10
        this.wsEndpoint = "wss://rpc.polkadot.io"
    }


    process_referenda(referenda, chainDecimals = 10) {
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
        }
        return referendaMap
    }

    process_voteStates(votes, chainDecimals = 10) {


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

    process_treasury_proposals(treasury_proposals, chainDecimals = 10) {
        var treasuryMap = {}
        for (const treasury_proposal of treasury_proposals) {
            const treasuryIndex = treasury_proposal[0].args[0].toNumber();
            var treasury_info = JSON.parse(JSON.stringify(treasury_proposal[1]))
            //console.log(`treasuryIndex=${treasuryIndex}`, treasury_info)
            let treasury_proposal_struct = {
                treasury_index: treasuryIndex,
                proposer_ss58: treasury_info.proposer,
                proposer: paraTool.getPubKey(treasury_info.proposer),
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

    process_bounties(bounties, chainDecimals = 10) {
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
            //console.log(bounty_struct)
            bountyMap[`${bountieIndex}`] = bounty_struct
        }
        return bountyMap
    }

    async computeTotalStaked(apiAt) {
        let chainDecimals = this.chainDecimals
        let currEra = await apiAt.query.staking.currentEra();
        let eraNumber = paraTool.dechexToInt(currEra.toString())

        let erasTotalStake = await apiAt.query.staking.erasTotalStake(eraNumber);
        let totalStaked = paraTool.dechexToInt(erasTotalStake.toString()) / 10 ** chainDecimals;

        let erasTotalIssuance = await apiAt.query.balances.totalIssuance();
        let totalIssuance = paraTool.dechexToInt(erasTotalIssuance.toString()) / 10 ** chainDecimals;

        let eraCounterForNominators = await apiAt.query.staking.counterForNominators();
        let nominatorCnt = paraTool.dechexToInt(eraCounterForNominators.toString())

        let eraCounterForValidators = await apiAt.query.staking.counterForValidators();
        let totalValidatorCnt = paraTool.dechexToInt(eraCounterForValidators.toString())

        let eraActiveValidators = await apiAt.query.staking.validatorCount();
        let activeValidatorCnt = paraTool.dechexToInt(eraActiveValidators.toString())

        let poolCnt = 0
        let poolMemberCnt = 0
        if (apiAt.query.nominationPools.counterForPoolMembers != undefined && apiAt.query.nominationPools.counterForBondedPools != undefined) {
            let eraPoolCnt = await apiAt.query.nominationPools.counterForBondedPools();
            let eraPoolMemberCnt = await apiAt.query.nominationPools.counterForPoolMembers();
            poolCnt = paraTool.dechexToInt(eraPoolCnt.toString())
            poolMemberCnt = paraTool.dechexToInt(eraPoolMemberCnt.toString())
        }
        let stakingPv = {
            era: eraNumber,
            totalIssuance: totalIssuance,
            totalStaked: totalStaked,
            totalValidators: totalValidatorCnt,
            activeValidators: activeValidatorCnt,
            pools: poolCnt,
            nominators: nominatorCnt,
            poolMembers: poolMemberCnt,
        }
        let stakingInfoRec = this.setRecSnapShotInfo("stakings.info")
        stakingInfoRec.track = "era"
        stakingInfoRec.track_val = eraNumber
        //stakingInfoRec.kv = kVal
        stakingInfoRec.pv = stakingPv
        //console.log(`staking rec`, stakingInfoRec)
        this.write_snapshot_rec(stakingInfoRec)
    }


    // handle snapshot logic
    async handleSnapshot(apiAt) {
        let chainDecimals = this.chainDecimals
        await this.computeTotalStaked(apiAt)
        let fetchOpenGovV2 = (apiAt.query.referenda != undefined && apiAt.query.convictionVoting != undefined) ? true : false
        if (fetchOpenGovV2) {

            // fetch voting
            var votes = await this.paginated_fetch(apiAt, "convictionVoting.votingFor")
            var [delegateeMap, voteStateMap] = this.process_voteStates(votes, chainDecimals)
            for (const voter of Object.keys(voteStateMap)) {
                let voteTracks = voteStateMap[voter]
                let voteTrackList = Object.keys(voteTracks).sort()
                //console.log(`voter=${voter} list=${voteTrackList}`)
                for (const voteTrack of voteTrackList) {
                    let voteTrackInfo = voteTracks[voteTrack]
                    let readableTrack = trackMap[`${voteTrack.replace("track_", "")}`]
                    let kv = Object.keys(voteTrackInfo)[0] // casting or delegating
                    let recType = (kv == "casting") ? "voter" : "delegator"

                    let cvVotingForRec = this.setRecSnapShotInfo("convictionVoting.votingFor")
                    cvVotingForRec.address_pubkey = paraTool.getPubKey(voter)
                    cvVotingForRec.address_ss58 = voter
                    cvVotingForRec.track = `opengov_${recType}`
                    cvVotingForRec.track_val = readableTrack
                    //cvVotingForRec.kv = kVal
                    cvVotingForRec.pv = voteTrackInfo
                    //console.log(`voter rec`, cvVotingForRec)
                    this.write_snapshot_rec(cvVotingForRec)
                }
            }

            for (const delegatee of Object.keys(delegateeMap)) {
                let voteTracks = delegateeMap[delegatee]
                let voteTrackList = Object.keys(voteTracks).sort()
                //console.log(`delegatee=${delegatee} list=${voteTrackList}`)
                for (const voteTrack of voteTrackList) {
                    let voteTrackInfo = voteTracks[voteTrack]
                    let readableTrack = trackMap[`${voteTrack.replace("track_", "")}`]

                    let cvDelegateeRec = this.setRecSnapShotInfo("convictionVoting.delegatee")
                    cvDelegateeRec.address_pubkey = paraTool.getPubKey(delegatee)
                    cvDelegateeRec.address_ss58 = delegatee
                    cvDelegateeRec.track = "opengov"
                    cvDelegateeRec.track_val = readableTrack
                    //cvDelegateeRec.kv = kVal
                    cvDelegateeRec.pv = voteTrackInfo
                    //console.log(`delegatee rec`, cvDelegateeRec)
                    this.write_snapshot_rec(cvDelegateeRec)
                }
            }

            // fetch referenda
            var referenda = await this.paginated_fetch(apiAt, "referenda.referendumInfoFor")
            var referendaMap = this.process_referenda(referenda, chainDecimals)
            for (const ref_id of Object.keys(referendaMap)) {
                //console.log(`Referendum_${ref_id}`, referendaMap[ref_id])
                let referendumInfo = referendaMap[ref_id]

                let referendaInfoRec = this.setRecSnapShotInfo("referenda.referendumInfoFor")
                referendaInfoRec.track = "referenda"
                referendaInfoRec.track_val = `${ref_id}`
                //referendaInfoRec.kv = kVal
                referendaInfoRec.pv = referendumInfo
                //console.log(`referenda rec`, referendaInfoRec)
                this.write_snapshot_rec(referendaInfoRec)
            }

            // fetch treasury proposal
            var treasury_proposals = await this.paginated_fetch(apiAt, "treasury.proposals")
            var treasuryMap = this.process_treasury_proposals(treasury_proposals, chainDecimals)
            var treasuryBlacklist = ['309', '359', '452', '456', '472']
            for (const proposal_id of Object.keys(treasuryMap).sort()) {
                if (!treasuryBlacklist.includes(proposal_id)) {
                    let proposal_info = treasuryMap[proposal_id]

                    let treasuryProposalRec = this.setRecSnapShotInfo("treasury.proposals")
                    treasuryProposalRec.address_pubkey = proposal_info.beneficiary_pubkey,
                        treasuryProposalRec.address_ss58 = proposal_info.beneficiary_ss58,
                        treasuryProposalRec.track = "treasury"
                    treasuryProposalRec.track_val = `${proposal_id}`
                    //treasuryProposalRec.kv = kVal
                    treasuryProposalRec.pv = proposal_info
                    //console.log(`treasury rec`, treasuryProposalRec)
                    this.write_snapshot_rec(treasuryProposalRec)
                }
            }


            // fetch bounty
            var bounties = await this.paginated_fetch(apiAt, "bounties.bounties")
            var bountyMap = this.process_bounties(bounties, chainDecimals)
            for (const bounty_id of Object.keys(bountyMap).sort()) {
                let bounty_info = bountyMap[bounty_id]

                let bountyRec = this.setRecSnapShotInfo("bounties.bounties")
                bountyRec.address_pubkey = bounty_info.proposer_pubkey,
                    bountyRec.address_ss58 = bounty_info.proposer_ss58,
                    bountyRec.track = "bounty"
                bountyRec.track_val = `${bounty_id}`
                //bountyRec.kv = kVal
                bountyRec.pv = bounty_info
                //console.log(`bounty rec`, bountyRec)
                this.write_snapshot_rec(bountyRec)
            }
        }
    }

    async processSnapshot(apiAt) {
        try {
            // step 0: set snapshot soure - in this case, we will publish as polkaholic
            this.setSnapshotSource("polkaholic")
            // step 1: enable snopshot writing to local file
            this.enable_snapshot_writing()
            console.log(`!!${this.chainName} process processSnapshot called!!!`)
            // *** step 2: the snapshot logic
            await this.handleSnapshot(apiAt)
            // *** step 3: close the file when done
            this.close_snapshot_writing()
            return true
        } catch (e) {
            console.log(`processSnapshot err`, e)
            return false
        }
    }
}