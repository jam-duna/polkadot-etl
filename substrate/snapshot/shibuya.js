const paraTool = require("../paraTool");
const SnapShotter = require("./snapshotter");

//astar[2006]
module.exports = class ShibuyaSnapShotter extends SnapShotter {
    constructor() {
        super()
        this.chainName = 'Shibuya'
        this.chainDecimals = 18
        this.wsEndpoint = "wss://rpc.shibuya.astar.network"
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
    */

    async processSnapshot(apiAt) {

        this.enable_snapshot_writing()
        let chainDecimals = this.chainDecimals
        console.log(`!!${this.chainName} process processSnapshot called!!!`)

        /*
        dappStaking.currentEraInfo
        {
          totalLocked: '0x0000000000040c2f1ce53876f0ee137e',
          unlocking: '0x000000000000000c93a9213767b5c3b4',
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
        let currentEraInfoPallet = 'dappStaking.currentEraInfo' // api.section.storage
        let currentEraInfoRes = await this.state_fetch_val(apiAt, currentEraInfoPallet)
        let currentEraInfoVal = JSON.parse(JSON.stringify(currentEraInfoRes))
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

        let activeProtocolStatePallet = 'dappStaking.activeProtocolState' // api.section.storage
        let activeProtocolStateRes = await this.state_fetch_val(apiAt, activeProtocolStatePallet)
        let activeProtocolStateVal = JSON.parse(JSON.stringify(activeProtocolStateRes))
        /*
        {
          era: 4,429
          nextEraStart: 5,652,415
          periodInfo: {
            number: 7
            subperiod: Voting
            nextSubperiodStartEra: 4,430
          }
          maintenance: false
        }
        */
        activeProtocolStateVal.nextEraStart = paraTool.dechexToInt(activeProtocolStateVal.nextEraStart)
        let activeProtocolStateRec = this.setRecSnapShotInfo("dappStaking.activeProtocolState")
        activeProtocolStateRec.pv = activeProtocolStateVal
        console.log(activeProtocolStateRec)
        this.write_snapshot_rec(activeProtocolStateRec)


        var stakerInfoPallet = 'dappStaking.stakerInfo' // api.section.storage
        var stakerInfoPalletRes = await this.paginated_fetch(apiAt, stakerInfoPallet)
        var stakerInfoPalletVal = JSON.parse(JSON.stringify(stakerInfoPalletRes))
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
            console.log(stakerInfoRec)
            this.write_snapshot_rec(stakerInfoRec)
        }
        this.close_snapshot_writing()
    }
}