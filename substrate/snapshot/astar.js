const paraTool = require("../paraTool");
const SnapShotter = require("./snapshotter");

//astar[2006]
module.exports = class AstarSnapShotter extends SnapShotter {
    constructor() {
        super()
        this.chainName = 'Astar'
        this.chainDecimals = 18
        this.wsEndpoint = "wss://rpc.astar.network"
    }

    // v3 user call: dappsStaking.lock for voting
    // also check: dappStaking.contractStake (staked vs stakedFuture)
    /*
    dappStaking.activeProtocolState: PalletDappStakingV3ProtocolState
    dappStaking.contractStake: PalletDappStakingV3ContractStakeAmount
    dappStaking.counterForIntegratedDApps: u32
    [DONE] dappStaking.currentEraInfo: PalletDappStakingV3EraInfo
    dappStaking.dAppTiers: Option<PalletDappStakingV3DAppTierRewards>
    dappStaking.eraRewards: Option<PalletDappStakingV3EraRewardSpan>
    dappStaking.activeProtocolState
    */

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

    /*
        async handleSnapshot(apiAt){
            let chainDecimals = this.chainDecimals

            let targetPallet = 'tokens.totalIssuance' // api.section.storage -> section|storage
            let targetPalletRes = await this.paginated_fetch(apiAt, targetPallet)
            for (const res of targetPalletRes){
                console.log(`k=${JSON.stringify(res[0].toHuman())}, val`, `${res[1].toString()}`)
                var kVal =  JSON.parse(JSON.stringify(res[0].toHuman()))
                var vVal = paraTool.dechexToInt(JSON.parse(JSON.stringify(res[1])))
                let totalIssuanceRec = this.setRecSnapShotInfo("tokens.totalIssuance")
                totalIssuanceRec.track = "asset"
                totalIssuanceRec.track_val = JSON.stringify(kVal)
                totalIssuanceRec.kv = kVal
                totalIssuanceRec.pv = vVal
                console.log(totalIssuanceRec)
                this.write_snapshot_rec(totalIssuanceRec)
            }
        }
    */

    async handleSnapshot(apiAt) {

        this.enable_snapshot_writing()
        let chainDecimals = this.chainDecimals
        console.log(`!!${this.chainName} process processSnapshot called!!!`)


        /*
        dappStaking.currentEraInfo
        {
          totalLocked: '0x0000000000040c2f1ce53876f0ee137e',
          unlocking: '0x000000000000000c93a9213767b5c3b4',１
          currentStakeAmount: {
            voting: '0x0000000000000c9692f95997ef180000',
            buildAndEarn: 0,
            era: 4335,
            period: 1
          },
          nextStakeAmount: {
            voting: '0x0000000000000c9692f95997ef180000',
            buildAndEarn: 0,
            era: 4336,
            period: 1
          }
        }
        */



        /*
        dappStaking.activeProtocolState
        {
          era: 713
          nextEraStart: 6,040,534
          periodInfo: {
            number: 1
            subperiod: BuildAndEarn
            nextSubperiodStartEra: 763
          }
          maintenance: false
        }
        */

        let currentEra = false;
        let currentActiveProtocolStatePallet = 'dappStaking.activeProtocolState' // api.section.storage
        let currentActiveProtocolStateRes = await this.state_fetch_val(apiAt, currentActiveProtocolStatePallet)
        if (currentActiveProtocolStateRes) {
            let currentActiveProtocolStateVal = JSON.parse(JSON.stringify(currentActiveProtocolStateRes))
            // console.log(`currentActiveProtocolStateVal`, currentActiveProtocolStateVal)
            currentEra = paraTool.dechexToInt(currentActiveProtocolStateVal.era)
            this.setCurrentEra(currentEra)
            currentActiveProtocolStateVal.era = currentEra
            currentActiveProtocolStateVal.nextEraStart = paraTool.dechexToInt(currentActiveProtocolStateVal.nextEraStart)
            let periodInfo = currentActiveProtocolStateVal.periodInfo
            periodInfo.number = paraTool.dechexToInt(periodInfo.number)
            periodInfo.nextSubperiodStartEra = paraTool.dechexToInt(periodInfo.nextSubperiodStartEra)
            currentActiveProtocolStateVal.periodInfo = periodInfo
            let currentActiveProtocolStateRec = this.setRecSnapShotInfo("dappStaking.activeProtocolState")
            currentActiveProtocolStateRec.pv = currentActiveProtocolStateVal
            console.log(`currentEraInfoRec`, currentActiveProtocolStateRec)
            this.write_snapshot_rec(currentActiveProtocolStateRec)
        } else {
            //not available
        }

        let currentEraInfoPallet = 'dappStaking.currentEraInfo' // api.section.storage
        let currentEraInfoRes = await this.state_fetch_val(apiAt, currentEraInfoPallet)
        if (currentEraInfoRes) {
            let currentEraInfoVal = JSON.parse(JSON.stringify(currentEraInfoRes))
            // console.log(`currentEraInfoVal`, currentEraInfoVal)
            currentEraInfoVal.totalLocked = paraTool.dechexToInt(currentEraInfoVal.totalLocked) / 10 ** chainDecimals
            currentEraInfoVal.unlocking = paraTool.dechexToInt(currentEraInfoVal.unlocking) / 10 ** chainDecimals
            currentEraInfoVal.currentStakeAmount.voting = paraTool.dechexToInt(currentEraInfoVal.currentStakeAmount.voting) / 10 ** chainDecimals
            currentEraInfoVal.currentStakeAmount.buildAndEarn = paraTool.dechexToInt(currentEraInfoVal.currentStakeAmount.buildAndEarn) / 10 ** chainDecimals
            currentEraInfoVal.nextStakeAmount.voting = paraTool.dechexToInt(currentEraInfoVal.nextStakeAmount.voting) / 10 ** chainDecimals
            currentEraInfoVal.nextStakeAmount.buildAndEarn = paraTool.dechexToInt(currentEraInfoVal.nextStakeAmount.buildAndEarn) / 10 ** chainDecimals
            let currentEraInfoRec = this.setRecSnapShotInfo("dappStaking.currentEraInfo")
            currentEraInfoRec.pv = currentEraInfoVal
            console.log(currentEraInfoRec)
            this.write_snapshot_rec(currentEraInfoRec)
        } else {
            //not available
        }

        // /*
        // {
        //   era: 4,429
        //   nextEraStart: 5,652,415
        //   periodInfo: {
        //     number: 7
        //     subperiod: Voting
        //     nextSubperiodStartEra: 4,430
        //   }
        //   maintenance: false
        // }
        // */
        let activeProtocolStatePallet = 'dappStaking.activeProtocolState' // api.section.storage
        let activeProtocolStateRes = await this.state_fetch_val(apiAt, activeProtocolStatePallet)
        if (activeProtocolStateRes) {
            let activeProtocolStateVal = JSON.parse(JSON.stringify(activeProtocolStateRes))
            currentEra = paraTool.dechexToInt(activeProtocolStateVal.era)
            this.setCurrentEra(currentEra)
            activeProtocolStateVal.nextEraStart = paraTool.dechexToInt(activeProtocolStateVal.nextEraStart)
            let activeProtocolStateRec = this.setRecSnapShotInfo("dappStaking.activeProtocolState")
            activeProtocolStateRec.pv = activeProtocolStateVal
            console.log(activeProtocolStateRec)
            this.write_snapshot_rec(activeProtocolStateRec)
        }


        var stakerInfoPallet = 'dappStaking.stakerInfo' // api.section.storage
        var stakerInfoPalletRes = await this.paginated_fetch(apiAt, stakerInfoPallet)
        if (stakerInfoPalletRes) {
            for (const res of stakerInfoPalletRes) {
                /*
                k=["bFbx867ozpfyvAruAu2Sg2zL4AoR5YGBD9fF3WuNW6SJVBE",{"Evm":"0xf3824888ecca4514dd776f0db38d6530ab8fb280"}]
                {
                  staked: {
                    voting: '0x000000000000003635c9adc5dea00000',
                    buildAndEarn: 0,
                    era: 4346,
                    period: 3
                  },
                  loyalStaker: true
                }
                */
                //console.log(`kVal=${JSON.stringify(res[0].toHuman())}, val`, vVal)
                var kVal = JSON.parse(JSON.stringify(res[0].toHuman()))
                var vVal = JSON.parse(JSON.stringify(res[1]))
                vVal.staked.voting = paraTool.dechexToInt(vVal.staked.voting) / 10 ** chainDecimals
                vVal.staked.buildAndEarn = paraTool.dechexToInt(vVal.staked.buildAndEarn) / 10 ** chainDecimals
                let stakerInfoStruct = vVal
                let dAppType = Object.keys(kVal[1])[0]
                stakerInfoStruct.dAppType = dAppType
                stakerInfoStruct.dAppAddress = kVal[1][dAppType]
                stakerInfoStruct.dApp = kVal[1]
                let stakerInfoRec = this.setRecSnapShotInfo("dappStaking.stakerInfo")
                stakerInfoRec.address_ss58 = kVal[0]
                stakerInfoRec.address_pubkey = paraTool.getPubKey(kVal[0])
                stakerInfoRec.pv = stakerInfoStruct
                console.log("stakerInfo", stakerInfoRec)
                this.write_snapshot_rec(stakerInfoRec)
            }
        }

        let inflationParams = 'inflation.inflationParams'
        let inflationParamsRes = await this.state_fetch_val(apiAt, inflationParams)
        if (inflationParamsRes) {
            var vVal = JSON.parse(JSON.stringify(inflationParamsRes))
            if (vVal.maxInflationRate) {
                vVal.maxInflationRate = paraTool.dechexToInt(vVal.maxInflationRate) / 10 ** chainDecimals
            }
            if (vVal.treasuryPart) {
                vVal.treasuryPart = paraTool.dechexToInt(vVal.treasuryPart) / 10 ** chainDecimals
            }
            if (vVal.collatorsPart) {
                vVal.collatorsPart = paraTool.dechexToInt(vVal.collatorsPart) / 10 ** chainDecimals
            }
            if (vVal.dappsPart) {
                vVal.dappsPart = paraTool.dechexToInt(vVal.dappsPart) / 10 ** chainDecimals
            }
            if (vVal.baseStakersPart) {
                vVal.baseStakersPart = paraTool.dechexToInt(vVal.baseStakersPart) / 10 ** chainDecimals
            }
            if (vVal.adjustableStakersPart) {
                vVal.adjustableStakersPart = paraTool.dechexToInt(vVal.adjustableStakersPart) / 10 ** chainDecimals
            }
            if (vVal.bonusPart) {
                vVal.bonusPart = paraTool.dechexToInt(vVal.bonusPart) / 10 ** chainDecimals
            }
            if (vVal.idealStakingRate) {
                vVal.idealStakingRate = paraTool.dechexToInt(vVal.idealStakingRate) / 10 ** chainDecimals
            }
            let inflationParamsStruct = vVal
            let inflationParamsRec = this.setRecSnapShotInfo("inflation.inflationParams")
            inflationParamsRec.pv = inflationParamsStruct
            console.log("inflationParamsRec", inflationParamsRec)
            this.write_snapshot_rec(inflationParamsRec)
        }

        let activeInflationConfig = 'inflation.activeInflationConfig'
        let activeInflationConfigRes = await this.state_fetch_val(apiAt, activeInflationConfig)
        if (activeInflationConfigRes) {
            var vVal = JSON.parse(JSON.stringify(activeInflationConfigRes))
            if (vVal.issuanceSafetyCap) {
                vVal.issuanceSafetyCap = paraTool.dechexToInt(vVal.issuanceSafetyCap) / 10 ** chainDecimals
            }
            if (vVal.collatorRewardPerBlock) {
                vVal.collatorRewardPerBlock = paraTool.dechexToInt(vVal.collatorRewardPerBlock) / 10 ** chainDecimals
            }
            if (vVal.treasuryRewardPerBlock) {
                vVal.treasuryRewardPerBlock = paraTool.dechexToInt(vVal.treasuryRewardPerBlock) / 10 ** chainDecimals
            }
            if (vVal.dappRewardPoolPerEra) {
                vVal.dappRewardPoolPerEra = paraTool.dechexToInt(vVal.dappRewardPoolPerEra) / 10 ** chainDecimals
            }
            if (vVal.baseStakerRewardPoolPerEra) {
                vVal.baseStakerRewardPoolPerEra = paraTool.dechexToInt(vVal.baseStakerRewardPoolPerEra) / 10 ** chainDecimals
            }
            if (vVal.adjustableStakerRewardPoolPerEra) {
                vVal.adjustableStakerRewardPoolPerEra = paraTool.dechexToInt(vVal.adjustableStakerRewardPoolPerEra) / 10 ** chainDecimals
            }
            if (vVal.bonusRewardPoolPerPeriod) {
                vVal.bonusRewardPoolPerPeriod = paraTool.dechexToInt(vVal.bonusRewardPoolPerPeriod) / 10 ** chainDecimals
            }
            if (vVal.idealStakingRate) {
                vVal.idealStakingRate = paraTool.dechexToInt(vVal.idealStakingRate) / 10 ** chainDecimals
            }
            let activeInflationConfigStruct = vVal
            let activeInflationConfigRec = this.setRecSnapShotInfo("inflation.activeInflationConfig")
            activeInflationConfigRec.pv = activeInflationConfigStruct
            console.log("activeInflationConfigRec", activeInflationConfigRec)
            this.write_snapshot_rec(activeInflationConfigRec)
        }

        let integratedDApps = 'dappStaking.integratedDApps'
        let integratedDAppsRes = await this.paginated_fetch(apiAt, integratedDApps)
        if (integratedDAppsRes) {
            for (const res of integratedDAppsRes) {
                var kVal = JSON.parse(JSON.stringify(res[0].toHuman()))
                var vVal = JSON.parse(JSON.stringify(res[1]))
                // console.log("kVal", kVal[0])
                // console.log("vVal", vVal)
                let integratedDAppsStruct = vVal
                integratedDAppsStruct.Evm = kVal[0].Evm
                let integratedDAppsRec = this.setRecSnapShotInfo("dappStaking.integratedDApps")
                integratedDAppsRec.pv = integratedDAppsStruct
                console.log("integratedDAppsRec", integratedDAppsRec)
                this.write_snapshot_rec(integratedDAppsRec)
            }
        }

        let dAppTiers = 'dappStaking.dAppTiers'
        let dAppTiersRes = await this.paginated_fetch(apiAt, dAppTiers)
        if (dAppTiersRes) {
            for (const res of dAppTiersRes) {
                var rewardTmp = []
                var kVal = JSON.parse(JSON.stringify(res[0].toHuman()))
                var vVal = JSON.parse(JSON.stringify(res[1]))
                for (const reward of vVal.rewards) {
                    rewardTmp.push(paraTool.dechexToInt(reward) / 10 ** chainDecimals)
                }
                vVal.rewards = rewardTmp
                let dapps = vVal.dapps
                let obj = Object.entries(dapps);
                let dappsTmp = []
                for (var dappItem of obj) {
                    dappItem.push(vVal.rewards[dappItem[1]])
                    dappsTmp.push(dappItem)
                }
                let dAppTiersStruct = vVal
                dAppTiersStruct.era = kVal[0]
                dAppTiersStruct.dappsList = dappsTmp
                let dAppTiersRec = this.setRecSnapShotInfo("dappStaking.dAppTiers")
                dAppTiersRec.pv = dAppTiersStruct
                console.log("dAppTiersRec", dAppTiersRec)
                this.write_snapshot_rec(dAppTiersRec)
            }
        }

        let contractStake = 'dappStaking.contractStake'
        let contractStakeRes = await this.paginated_fetch(apiAt, contractStake)
        if (contractStakeRes) {
            for (const res of contractStakeRes) {
                var kVal = JSON.parse(JSON.stringify(res[0].toHuman()))
                var vVal = JSON.parse(JSON.stringify(res[1]))
                vVal.staked.voting = paraTool.dechexToInt(vVal.staked.voting) / 10 ** chainDecimals
                vVal.staked.buildAndEarn = paraTool.dechexToInt(vVal.staked.buildAndEarn) / 10 ** chainDecimals
                if (vVal.stakedFuture) {
                    vVal.stakedFuture.voting = paraTool.dechexToInt(vVal.stakedFuture.voting) / 10 ** chainDecimals
                    vVal.stakedFuture.buildAndEarn = paraTool.dechexToInt(vVal.stakedFuture.buildAndEarn) / 10 ** chainDecimals
                }
                let contractStakeStruct = vVal
                contractStakeStruct.dAppID = kVal[0]
                let contractStakeRec = this.setRecSnapShotInfo("dappStaking.contractStake")
                contractStakeRec.pv = contractStakeStruct
                console.log("contractStakeRec", contractStakeRec)
                this.write_snapshot_rec(contractStakeRec)
            }
        }

        let eraRewards = 'dappStaking.eraRewards'
        let eraRewardsRes = await this.paginated_fetch(apiAt, eraRewards)
        if (eraRewardsRes) {
            for (const res of eraRewardsRes) {
                var spanTmp = []
                var kVal = JSON.parse(JSON.stringify(res[0].toHuman()))
                var vVal = JSON.parse(JSON.stringify(res[1]))
                for (var span of vVal.span) {
                    span.stakerRewardPool = paraTool.dechexToInt(span.stakerRewardPool) / 10 ** chainDecimals
                    span.staked = paraTool.dechexToInt(span.staked) / 10 ** chainDecimals
                    span.dappRewardPool = paraTool.dechexToInt(span.dappRewardPool) / 10 ** chainDecimals
                    spanTmp.push(span)
                }
                vVal.span = spanTmp
                let eraRewardsStruct = vVal
                eraRewardsStruct.era = kVal[0]
                let eraRewardsRec = this.setRecSnapShotInfo("dappStaking.eraRewards")
                eraRewardsRec.pv = eraRewardsStruct
                console.log("eraRewardsStruct", eraRewardsRec)
                this.write_snapshot_rec(eraRewardsRec)
            }
        }

        let totalIssuance = 'balances.totalIssuance'
        let totalIssuanceRes = await this.state_fetch_val(apiAt, totalIssuance)
        if (totalIssuanceRes) {
            let balance = JSON.parse(JSON.stringify(totalIssuanceRes))
            let totalIssuanceStruct = {
                'totalIssuance': paraTool.dechexToInt(balance) / 10 ** chainDecimals
            }
            let totalIssuanceRec = this.setRecSnapShotInfo("balances.totalIssuance")
            totalIssuanceRec.pv = totalIssuanceStruct
            console.log("totalIssuance", totalIssuanceRec)
            this.write_snapshot_rec(totalIssuanceRec)
        }
    }
}