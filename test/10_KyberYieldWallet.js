const { expect } = require('chai')
const { ethers } = require('hardhat')
const BigNumber = require('bignumber.js')
BigNumber.set({ DECIMAL_PLACES: 0, ROUNDING_MODE: 1 })
const {
  buildPermitParams,
  buildPermitParamsKyberDmm,
  getSignatureFromTypedData,
  MAX_UINT_AMOUNT,
} = require('./helpers/contract-helpers')

const zeroAddress = '0x0000000000000000000000000000000000000000'
const BASE = '1000000000000000000'

let signers
let governance

let und
let tEth
let tDai
let weth
let uniswapFactory
let uniswapRouter
let ethDaiPair
let undDaiPair
let vaultFactory
let oracleLibrary

let feedEthUsd
let ethDaiVault
let yieldWalletFactory
let kncRewardToken;
let kyberRewardLocker;
let kyberFairlaunch;

const ethPrice = '320000000000' // $3200
const daiPrice = '100000000' // $1

const CR = '200000000' // 200%
const LTV = '50000000' // 50%
const PROTOCOL_FEE = '500000' // 0.5%
const stakeFee = '500000' // 0.5%
const safuShare = '40000000' // 40%
const SECOND_BASE = '100000000' // 1e8

const REWARD_VESTING_DURATION = 20;

let accountsPkey = [
  "0x9d297c3cdf8af0abffbf00db443d56a62798d1d562ae19a668ac73eb9052f631",
  "0xbb4a887e10689e6b2574760c2965a3cfc6013062b2d9f71bb6ce5cf08546e61a"
]

describe('KyberYieldWallet', function () {
  beforeEach(async function () {
    signers = await ethers.getSigners()
    governance = signers[0].address

    let UniswapV2Factory = await ethers.getContractFactory('DMMFactory')
    uniswapFactory = await UniswapV2Factory.deploy(zeroAddress)

    let WETH9 = await ethers.getContractFactory('WETH9')
    weth = await WETH9.deploy()

    let UniswapV2Router02 = await ethers.getContractFactory('DMMRouter02')
    uniswapRouter = await UniswapV2Router02.deploy(
      uniswapFactory.address,
      weth.address
    )

    let Oracle = await ethers.getContractFactory('KyberDMMPriceProvider')
    oracleLibrary = await Oracle.deploy()

    let VaultFactory = await ethers.getContractFactory(
      'KyberVaultFactory',
      {
        libraries: { KyberDMMPriceProvider: oracleLibrary.address },
      }
    )

    vaultFactory = await VaultFactory.deploy(governance, uniswapFactory.address);

    let UnboundToken = await ethers.getContractFactory('UnboundToken')
    und = await UnboundToken.deploy(signers[0].address)

    let TestEth = await ethers.getContractFactory('TestEth')
    tEth = await TestEth.deploy(signers[0].address)

    let TestDai = await ethers.getContractFactory('TestDai')
    tDai = await TestDai.deploy(signers[0].address, '1337')

    await uniswapFactory.createPool(und.address, tDai.address, 20000)
    await uniswapFactory.createPool(tEth.address, tDai.address, 20000)

    undDaiPair = await uniswapFactory.getPools(und.address, tDai.address)
    ethDaiPair = await uniswapFactory.getPools(tEth.address, tDai.address)

    undDaiPair = undDaiPair[0]
    ethDaiPair = await ethers.getContractAt('DMMPool', ethDaiPair[0])

    let daiAmount = ethers.utils
      .parseEther(((Number(ethPrice) / 100000000) * 1).toString())
      .toString()
    let ethAmount = ethers.utils.parseEther('1').toString()

    await tDai.approve(uniswapRouter.address, daiAmount)
    await tEth.approve(uniswapRouter.address, ethAmount)

    await uniswapRouter.addLiquidity(
      tDai.address,
      tEth.address,
      ethDaiPair.address,
      daiAmount,
      ethAmount,
      daiAmount,
      ethAmount,
      [0, MAX_UINT_AMOUNT],
      signers[0].address,
      MAX_UINT_AMOUNT
    )

    let TestAggregatorProxyEthUsd = await ethers.getContractFactory(
      'TestAggregatorProxyEthUsd'
    )
    feedEthUsd = await TestAggregatorProxyEthUsd.deploy()
    await feedEthUsd.setPrice(ethPrice) // 1 ETH = $3200

    await vaultFactory.createVault(
      und.address,
      signers[0].address,
      ethDaiPair.address,
      tDai.address,
      [feedEthUsd.address],
      '100000000000000000', // 10%
      5000,
      undDaiPair
    )

    ethDaiVault = await vaultFactory.vaultByIndex(1)
    ethDaiVault = await ethers.getContractAt('KyberVault', ethDaiVault)


    let TestToken = await ethers.getContractFactory('TestToken')
    kncRewardToken = await TestToken.deploy("Kyber Token", "KNC", 18, signers[0].address)

    let KyberRewardLocker = await ethers.getContractFactory('KyberRewardLocker')
    kyberRewardLocker = await KyberRewardLocker.deploy(signers[0].address)

    
    let KyberFairLaunch = await ethers.getContractFactory('KyberFairLaunch')
    kyberFairlaunch = await KyberFairLaunch.deploy(signers[0].address, [kncRewardToken.address], kyberRewardLocker.address)
    
    await kyberRewardLocker.addRewardsContract(kncRewardToken.address, kyberFairlaunch.address);
    await kyberRewardLocker.setVestingDuration(kncRewardToken.address, REWARD_VESTING_DURATION);

    let currentBlock = await ethers.provider.getBlockNumber()
    let startBlock = Number(currentBlock) + 2
    let endBlock = Number(startBlock) + REWARD_VESTING_DURATION
    // console.log(startBlock)
    // console.log(endBlock)

    await kyberFairlaunch.addPool(ethDaiPair.address, startBlock, endBlock, ["4206070000000000000"]);

    let KyberYieldWalletFactory = await ethers.getContractFactory(
      'KyberYieldWalletFactory'
    )
    yieldWalletFactory = await KyberYieldWalletFactory.deploy(kyberFairlaunch.address)

    await kncRewardToken.transfer(kyberFairlaunch.address, "84121400000000000000")

    await ethDaiVault.changeLTV(LTV)
    await ethDaiVault.changeCR(CR)
    await ethDaiVault.changeFee(PROTOCOL_FEE)
    await ethDaiVault.changeStakeFee(stakeFee)
    await ethDaiVault.enableYieldWalletFactory(yieldWalletFactory.address)
    // await ethDaiVault.enableYieldWalletFactory(zeroAddress);
    await vaultFactory.enableVault(ethDaiVault.address);
    await und.addMinter(vaultFactory.address)

    await ethers.provider.send("evm_increaseTime", [259201])   // increase evm time by 3 days

    await ethDaiVault.executeEnableYeildWalletFactory(yieldWalletFactory.address);
    await vaultFactory.executeEnableVault(ethDaiVault.address);
    await und.enableMinter(vaultFactory.address);

  })

  describe('#constructor', async () => {
    let yieldwalletInstance
    beforeEach(async function () {
      let lockAmount = ethers.utils.parseEther('1').toString()
      await ethDaiPair.approve(ethDaiVault.address, lockAmount)
      await ethDaiVault.lock(
        lockAmount,
        signers[0].address,
        0
      )

      await ethDaiVault.stakeLP(yieldWalletFactory.address, lockAmount, true);

      let wallet = await ethDaiVault.yieldWallet(signers[0].address)

      let KyberYieldWallet = await ethers.getContractFactory(
        'KyberYieldWallet'
      )
      yieldwalletInstance = new ethers.Contract(
        wallet,
        KyberYieldWallet.interface.fragments,
        signers[0]
      )
    })

    it('should set correct pair address', async function () {
      expect(await yieldwalletInstance.pair()).to.be.equal(ethDaiPair.address)
    })

    it('should set correct user address', async function () {
      expect(await yieldwalletInstance.user()).to.be.equal(signers[0].address)
    })

    it('should set correct vault address', async function () {
      expect(await yieldwalletInstance.vault()).to.be.equal(ethDaiVault.address)
    })

    it('should set correct farmin contract address', async function () {
      expect(await yieldwalletInstance.farming()).to.be.equal(kyberFairlaunch.address)
    })

    it('should set correct pid for pool', async function () {
      expect(await yieldwalletInstance.pid()).to.be.equal("0")
    })

    it('should approve proper allowance to farming contract', async function () {
      expect((await ethDaiPair.allowance(yieldwalletInstance.address, kyberFairlaunch.address)).toString()).to.be.equal("115792089237316195423570985008687907853269984665640564039456584007913129639935")
    })
  })

  describe('#deposit', async () => {
    it('should revert if caller is not vault', async function () {
      let lockAmount = ethers.utils.parseEther('1').toString()
      await ethDaiPair.approve(ethDaiVault.address, lockAmount)
      await ethDaiVault.lock(
        lockAmount,
        signers[0].address,
        0
      )

      await ethDaiVault.stakeLP(yieldWalletFactory.address, lockAmount, true);

      let wallet = await ethDaiVault.yieldWallet(signers[0].address)

      let KyberYieldWallet = await ethers.getContractFactory(
        'KyberYieldWallet'
      )
      let yieldwallet = new ethers.Contract(
        wallet,
        KyberYieldWallet.interface.fragments,
        signers[0]
      )

      await expect(
        yieldwallet.deposit(lockAmount)
      ).to.be.revertedWith('NA')
    })

    it('lock - should increase yieldWalletDeposit amount on stake LPT', async function () {
      expect(
        await ethDaiVault.yieldWalletDeposit(signers[0].address)
      ).to.be.equal('0')

      let lockAmount = ethers.utils.parseEther('1').toString()
      await ethDaiPair.approve(ethDaiVault.address, lockAmount)
      await ethDaiVault.lock(
        lockAmount,
        signers[0].address,
        0
      )

      await ethDaiVault.stakeLP(yieldWalletFactory.address, lockAmount, true);

      expect(
        await ethDaiVault.yieldWalletDeposit(signers[0].address)
      ).to.be.equal(lockAmount)
    })

    it('lock - should transfer LPT to farming contract on stake LPT', async function () {

      let lockAmount1 = ethers.utils.parseEther('0.1').toString()
      await ethDaiPair.approve(ethDaiVault.address, lockAmount1)

      await ethDaiVault.lock(
        lockAmount1,
        signers[0].address,
        0
      )

      await ethDaiVault.stakeLP(yieldWalletFactory.address, lockAmount1, true);

      let wallet = await ethDaiVault.yieldWallet(signers[0].address)
      let balanceBefore = (await ethDaiPair.balanceOf(kyberFairlaunch.address)).toString()
      let walletBalanceBefore = (await ethDaiPair.balanceOf(wallet)).toString()

      expect(walletBalanceBefore).to.be.equal("0")

      let lockAmount2 = ethers.utils.parseEther('0.2').toString()
      await ethDaiPair.approve(ethDaiVault.address, lockAmount2)

      await ethDaiVault.lock(
        lockAmount2,
        signers[0].address,
        0
      )

      await ethDaiVault.stakeLP(yieldWalletFactory.address, lockAmount2, false);
      
      let balanceAfter = new BigNumber(balanceBefore)
        .plus(lockAmount2)
        .toString()

      expect(await ethDaiPair.balanceOf(kyberFairlaunch.address)).to.be.equal(balanceAfter)
      expect(await ethDaiPair.balanceOf(wallet)).to.be.equal(walletBalanceBefore)
    })

    it('lock - should update correct info for user and pool in farming contract', async function () {

      let lockAmount = ethers.utils.parseEther('2').toString()
      await ethDaiPair.approve(ethDaiVault.address, lockAmount)

      await ethDaiVault.lock(
        lockAmount,
        signers[0].address,
        0
      )

      await ethDaiVault.stakeLP(yieldWalletFactory.address, lockAmount, true);

      let wallet = await ethDaiVault.yieldWallet(signers[0].address)

      let KyberYieldWallet = await ethers.getContractFactory(
        'KyberYieldWallet'
      )
      let yieldwallet = new ethers.Contract(
        wallet,
        KyberYieldWallet.interface.fragments,
        signers[0]
      )
      
      let info = await yieldwallet.getWalletInfo();

      expect(info.amount.toString()).to.be.equal(lockAmount)

    })

    it('lock - should emit deposit event while locking LPTs', async function () {

      let lockAmount = ethers.utils.parseEther('2').toString()
      await ethDaiPair.approve(ethDaiVault.address, lockAmount)

      let lock = await ethDaiVault.lock(
        lockAmount,
        signers[0].address,
        0
      )

      let stake = await ethDaiVault.stakeLP(yieldWalletFactory.address, lockAmount, true);

      let wallet = await ethDaiVault.yieldWallet(signers[0].address)
      let pid = await yieldWalletFactory.pids(ethDaiPair.address);


      expect(stake).to.emit(kyberFairlaunch, "Deposit").withArgs(wallet, pid, stake.blockNumber, lockAmount)

    })

    it('lock - should emit proper transfer event while locking and staking LPTs', async function () {

      let lockAmount = ethers.utils.parseEther('2').toString()
      await ethDaiPair.approve(ethDaiVault.address, lockAmount)

      let lock = await ethDaiVault.lock(
        lockAmount,
        signers[0].address,
        0
      )

      let stake = await ethDaiVault.stakeLP(yieldWalletFactory.address, lockAmount, true);

      let wallet = await ethDaiVault.yieldWallet(signers[0].address)

      expect(lock).to.emit(ethDaiPair, "Transfer").withArgs(signers[0].address, ethDaiVault.address, lockAmount)
      expect(stake).to.emit(ethDaiPair, "Transfer").withArgs(ethDaiVault.address, wallet, lockAmount)
      expect(stake).to.emit(ethDaiPair, "Transfer").withArgs(wallet, kyberFairlaunch.address, lockAmount)

    })

    it('lockWithPermit - should increase yieldWalletDeposit amount on stake LPT', async function () {
      expect(
        await ethDaiVault.yieldWalletDeposit(signers[0].address)
      ).to.be.equal('0')

      const { chainId } = await ethers.provider.getNetwork()

      const expiration = MAX_UINT_AMOUNT;
      const nonce = (await ethDaiPair.nonces(signers[0].address)).toString();
      const permitAmount = ethers.utils.parseEther("1").toString();
  
      const msgParams = buildPermitParamsKyberDmm(
          chainId,
          ethDaiPair.address,
          signers[0].address,
          ethDaiVault.address,
          nonce,
          permitAmount,
          expiration.toString()
      );
      const { v, r, s } = getSignatureFromTypedData(accountsPkey[0], msgParams);

      await ethDaiVault.lockWithPermit(permitAmount, signers[0].address, "1", expiration, v, r, s)

      await ethDaiVault.stakeLP(yieldWalletFactory.address, permitAmount, true);

      expect(
        await ethDaiVault.yieldWalletDeposit(signers[0].address)
      ).to.be.equal(permitAmount)
    })

    it('lockWithPermit - should transfer LPT to yield wallet on stake LPT', async function () {
      let balanceBefore = (await ethDaiPair.balanceOf(kyberFairlaunch.address)).toString()

      const { chainId } = await ethers.provider.getNetwork()

      const expiration = MAX_UINT_AMOUNT;
      const nonce = (await ethDaiPair.nonces(signers[0].address)).toString();
      const permitAmount = ethers.utils.parseEther("1").toString();
  
      const msgParams = buildPermitParamsKyberDmm(
          chainId,
          ethDaiPair.address,
          signers[0].address,
          ethDaiVault.address,
          nonce,
          permitAmount,
          expiration.toString()
      );
      const { v, r, s } = getSignatureFromTypedData(accountsPkey[0], msgParams);

      await ethDaiVault.lockWithPermit(permitAmount, signers[0].address, "1", expiration, v, r, s)

      await ethDaiVault.stakeLP(yieldWalletFactory.address, permitAmount, true);

      let balanceAfter = new BigNumber(balanceBefore)
        .plus(permitAmount)
        .toString()

      expect(await ethDaiPair.balanceOf(kyberFairlaunch.address)).to.be.equal(balanceAfter)
    })

    it('lockWithPermit - should update correct info for user and pool in farming contract', async function () {

      const { chainId } = await ethers.provider.getNetwork()
  
      const expiration = MAX_UINT_AMOUNT;
      const nonce = (await ethDaiPair.nonces(signers[0].address)).toString();
      const permitAmount = ethers.utils.parseEther("1").toString();
  
      const msgParams = buildPermitParamsKyberDmm(
          chainId,
          ethDaiPair.address,
          signers[0].address,
          ethDaiVault.address,
          nonce,
          permitAmount,
          expiration.toString()
      );
      const { v, r, s } = getSignatureFromTypedData(accountsPkey[0], msgParams);
  
      await ethDaiVault.lockWithPermit(permitAmount, signers[0].address, "1", expiration, v, r, s)
  
      await ethDaiVault.stakeLP(yieldWalletFactory.address, permitAmount, true);

      let wallet = await ethDaiVault.yieldWallet(signers[0].address)
  
      let KyberYieldWallet = await ethers.getContractFactory(
        'KyberYieldWallet'
      )
      let yieldwallet = new ethers.Contract(
        wallet,
        KyberYieldWallet.interface.fragments,
        signers[0]
      )
      
      let info = await yieldwallet.getWalletInfo();
  
      expect(info.amount.toString()).to.be.equal(permitAmount)
  
    })
  
    it('lockWithPermit - should emit deposit event while staking LPTs', async function () {
  
      const { chainId } = await ethers.provider.getNetwork()
  
      const expiration = MAX_UINT_AMOUNT;
      const nonce = (await ethDaiPair.nonces(signers[0].address)).toString();
      const permitAmount = ethers.utils.parseEther("1").toString();
  
      const msgParams = buildPermitParamsKyberDmm(
          chainId,
          ethDaiPair.address,
          signers[0].address,
          ethDaiVault.address,
          nonce,
          permitAmount,
          expiration.toString()
      );
      const { v, r, s } = getSignatureFromTypedData(accountsPkey[0], msgParams);
  
      let lock = await ethDaiVault.lockWithPermit(permitAmount, signers[0].address, "1", expiration, v, r, s)
  
      let stake = await ethDaiVault.stakeLP(yieldWalletFactory.address, permitAmount, true);
  
      let wallet = await ethDaiVault.yieldWallet(signers[0].address)
      let pid = await yieldWalletFactory.pids(ethDaiPair.address);
  
  
      expect(stake).to.emit(kyberFairlaunch, "Deposit").withArgs(wallet, pid, stake.blockNumber, permitAmount)
  
    })
  
  })


  describe('#withdraw', async () => {
    beforeEach(async function () {
      let lockAmount = ethers.utils.parseEther('1').toString()
      await ethDaiPair.approve(ethDaiVault.address, lockAmount)
      await ethDaiVault.lock(lockAmount, signers[0].address, '1')

      await ethDaiVault.stakeLP(yieldWalletFactory.address, lockAmount, true);

      // Transfer some extra und to user 0 to repay all debts
      await ethDaiPair.transfer(signers[1].address, lockAmount)
      await ethDaiPair
        .connect(signers[1])
        .approve(ethDaiVault.address, lockAmount)
      await ethDaiVault
        .connect(signers[1])
        .lock(lockAmount, signers[1].address, '1')
      await und.connect(signers[1]).transfer(signers[0].address, lockAmount)
    })

    it('should revert if caller is not vault', async function () {

      let wallet = await ethDaiVault.yieldWallet(signers[0].address)

      let KyberYieldWallet = await ethers.getContractFactory(
        'KyberYieldWallet'
      )
      let yieldwallet = new ethers.Contract(
        wallet,
        KyberYieldWallet.interface.fragments,
        signers[0]
      )

      await expect(yieldwallet.withdraw("1")).to.be.revertedWith('NA')
    })

    it('should decrese yieldWalletDeposit amount on unstake LPT', async function () {
      let lockAmount = ethers.utils.parseEther('1').toString()

      expect(
        await ethDaiVault.yieldWalletDeposit(signers[0].address)
      ).to.be.equal(lockAmount)

      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      await ethDaiVault.unstakeLP(collateral);

      expect(
        await ethDaiVault.yieldWalletDeposit(signers[0].address)
      ).to.be.equal("0")    
    })

    it("should transfer LPT back to vault from farming wallet to user on unstake LPT", async function() {
      
      let lockAmount = ethers.utils.parseEther('1').toString()

      let wallet = await ethDaiVault.yieldWallet(signers[0].address)

      expect(await ethDaiVault.yieldWalletDeposit(signers[0].address)).to.be.equal(lockAmount)

      let balanceBeforeVault = (await ethDaiPair.balanceOf(ethDaiVault.address)).toString()
      let balanceBeforeFarming = (await ethDaiPair.balanceOf(kyberFairlaunch.address)).toString()
      let balanceBeforeWallet = (await ethDaiPair.balanceOf(wallet)).toString()

      expect(balanceBeforeWallet).to.be.equal("0")

      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      await ethDaiVault.unstakeLP(lockAmount);

      let balanceAfterVault = (new BigNumber(balanceBeforeVault).plus(collateral)).toFixed()
      let balanceAfterFarming = (new BigNumber(balanceBeforeFarming).minus(collateral)).toFixed()

      expect(await ethDaiPair.balanceOf(ethDaiVault.address)).to.be.equal(balanceAfterVault)
      expect(await ethDaiPair.balanceOf(kyberFairlaunch.address)).to.be.equal(balanceAfterFarming)
      expect(await ethDaiPair.balanceOf(wallet)).to.be.equal(balanceBeforeWallet)

    });

    it('unlock - should update correct info for user and pool in farming contract', async function () {

      let wallet = await ethDaiVault.yieldWallet(signers[0].address)

      let KyberYieldWallet = await ethers.getContractFactory(
        'KyberYieldWallet'
      )
      let yieldwallet = new ethers.Contract(
        wallet,
        KyberYieldWallet.interface.fragments,
        signers[0]
      )
      
      let infoBefore = await yieldwallet.getWalletInfo();
      
      let collateral = (await ethDaiVault.collateral(signers[0].address)).toString()
      
      await ethDaiVault.unstakeLP(collateral);

      let infoAfter = await yieldwallet.getWalletInfo();
      let infoAfterExpected = new BigNumber(infoBefore.amount.toString()).minus(collateral).toFixed();

      expect(infoAfter.amount.toString()).to.be.equal(infoAfterExpected)

    })

    it('unlock - should emit withdraw event while unstaking LPTs', async function () {

      let collateral = (await ethDaiVault.collateral(signers[0].address)).toString()
      
      let unstake = await ethDaiVault.unstakeLP(collateral);

      let wallet = await ethDaiVault.yieldWallet(signers[0].address)
      let pid = await yieldWalletFactory.pids(ethDaiPair.address);

      expect(unstake).to.emit(kyberFairlaunch, "Withdraw").withArgs(wallet, pid, unstake.blockNumber, collateral)

    })

    it('unlock - should emit proper transfer event while unlocking LPTs', async function () {

      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (await ethDaiVault.collateral(signers[0].address)).toString()
      
      let unstake = await ethDaiVault.unstakeLP(collateral);
      let unlock = await ethDaiVault.unlock(debt, collateral);

      let wallet = await ethDaiVault.yieldWallet(signers[0].address)

      expect(unstake).to.emit(ethDaiPair, "Transfer").withArgs(kyberFairlaunch.address, wallet, collateral)
      expect(unstake).to.emit(ethDaiPair, "Transfer").withArgs(wallet, ethDaiVault.address, collateral)
      expect(unlock).to.emit(ethDaiPair, "Transfer").withArgs(ethDaiVault.address, signers[0].address, collateral)

    })

    it('unlock - should harvest reward while unstaking LPTs', async function () {

      let collateral = (await ethDaiVault.collateral(signers[0].address)).toString()
      
      let unstake = await ethDaiVault.unstakeLP(collateral);

      let wallet = await ethDaiVault.yieldWallet(signers[0].address)
      let pid = await yieldWalletFactory.pids(ethDaiPair.address);

      expect(unstake).to.emit(kyberFairlaunch, "Harvest").withArgs(wallet, pid, kncRewardToken.address, "21030350000000000000", unstake.blockNumber)
      expect(unstake).to.emit(kncRewardToken, "Transfer").withArgs(kyberFairlaunch.address, kyberRewardLocker.address, "21030350000000000000")

    })
  })

  describe('#claim', async () => {
    it('should revert if caller is not user', async function () {
      let lockAmount = ethers.utils.parseEther('1').toString()
      await ethDaiPair.approve(ethDaiVault.address, lockAmount)
      await ethDaiVault.lock(
        lockAmount,
        signers[0].address,
        0
      )

      await ethDaiVault.stakeLP(yieldWalletFactory.address, lockAmount, true);

      let wallet = await ethDaiVault.yieldWallet(signers[0].address)

      let KyberYieldWallet = await ethers.getContractFactory(
        'KyberYieldWallet'
      )
      let yieldwallet = new ethers.Contract(
        wallet,
        KyberYieldWallet.interface.fragments,
        signers[0]
      )

      await expect(
        yieldwallet
          .connect(signers[1])
          .claim(ethDaiPair.address, signers[0].address)
      ).to.be.revertedWith('NA')
    })

    it('should transfer token to user account', async function () {
      let lockAmount = ethers.utils.parseEther('1').toString()
      await ethDaiPair.approve(ethDaiVault.address, lockAmount)
      await ethDaiVault.lock(
        lockAmount,
        signers[0].address,
        0
      )

      await ethDaiVault.stakeLP(yieldWalletFactory.address, lockAmount, true);
  
      let wallet = await ethDaiVault.yieldWallet(signers[0].address)
  
      let KyberYieldWallet = await ethers.getContractFactory(
        'KyberYieldWallet'
      )
      let yieldwallet = new ethers.Contract(
        wallet,
        KyberYieldWallet.interface.fragments,
        signers[0]
      )
  
      await kncRewardToken.transfer(wallet, "100")
  
      await expect(
        yieldwallet
          .claim(kncRewardToken.address, signers[0].address)
      ).to.emit(kncRewardToken, "Transfer")
      .withArgs(wallet, signers[0].address, "100");
    })
  })

  describe('#harvest', async () => {
    it('should revert if caller is not user', async function () {
      let lockAmount = ethers.utils.parseEther('1').toString()
      await ethDaiPair.approve(ethDaiVault.address, lockAmount)
      await ethDaiVault.lock(
        lockAmount,
        signers[0].address,
        0
      )

      await ethDaiVault.stakeLP(yieldWalletFactory.address, lockAmount, true);

      let wallet = await ethDaiVault.yieldWallet(signers[0].address)

      let KyberYieldWallet = await ethers.getContractFactory(
        'KyberYieldWallet'
      )
      let yieldwallet = new ethers.Contract(
        wallet,
        KyberYieldWallet.interface.fragments,
        signers[0]
      )

      await expect(
        yieldwallet
          .connect(signers[1])
          .harvest()
      ).to.be.revertedWith('NA')
    })

    it('should harvest reward', async function () {
      let lockAmount = ethers.utils.parseEther('1').toString()
      await ethDaiPair.approve(ethDaiVault.address, lockAmount)
      await ethDaiVault.lock(
        lockAmount,
        signers[0].address,
        0
      )

      await ethDaiVault.stakeLP(yieldWalletFactory.address, lockAmount, true);

      let wallet = await ethDaiVault.yieldWallet(signers[0].address)
  
      let KyberYieldWallet = await ethers.getContractFactory(
        'KyberYieldWallet'
      )
      let yieldwallet = new ethers.Contract(
        wallet,
        KyberYieldWallet.interface.fragments,
        signers[0]
      )

      let harvest = await yieldwallet.harvest()
      let pid = await yieldWalletFactory.pids(ethDaiPair.address);

      expect(harvest)
        .to.emit(kyberFairlaunch, "Harvest")
        .withArgs(wallet, pid, kncRewardToken.address, "4206070000000000000", harvest.blockNumber);

      expect(harvest)
        .to.emit(kncRewardToken, "Transfer")
        .withArgs(kyberFairlaunch.address, kyberRewardLocker.address, "4206070000000000000")

    })

  })

  describe('#getWalletInfo & #getPendingRewards', async () => {

    it('should return correct yield wallet info', async function () {

      // lock lpt and stake ot farming contract
      let lockAmount = ethers.utils.parseEther('1').toString()
      await ethDaiPair.approve(ethDaiVault.address, lockAmount)
      await ethDaiVault.lock(
        lockAmount,
        signers[0].address,
        0
      )

      await ethDaiVault.stakeLP(yieldWalletFactory.address, lockAmount, true);

      let wallet = await ethDaiVault.yieldWallet(signers[0].address)
  
      let KyberYieldWallet = await ethers.getContractFactory(
        'KyberYieldWallet'
      )
      let yieldwallet = new ethers.Contract(
        wallet,
        KyberYieldWallet.interface.fragments,
        signers[0]
      )

      let info = await yieldwallet.getWalletInfo();

      expect(info.amount.toString()).to.be.equal(lockAmount);
      expect(info.lastRewardPerShares.toString()).to.be.equal("0");

      let pendingReward = await yieldwallet.getPendingRewards()
      expect(pendingReward.toString()).to.be.equal("0");

      await network.provider.send("evm_mine") // mine 1 block

      let info2 = await yieldwallet.getWalletInfo();

      expect(info2.amount.toString()).to.be.equal(lockAmount);
      expect(info2.lastRewardPerShares.toString()).to.be.equal("0");

      let pendingReward2 = await yieldwallet.getPendingRewards()
      expect(pendingReward2.toString()).to.be.equal("4206070000000000000");

      await yieldwallet.harvest() // harvest pending rewards

      let info3 = await yieldwallet.getWalletInfo();

      expect(info3.amount.toString()).to.be.equal(lockAmount);
      expect(info3.lastRewardPerShares.toString()).to.be.equal("8412140000000");

      let pendingReward3 = await yieldwallet.getPendingRewards()
      expect(pendingReward3.toString()).to.be.equal("0");
    })

  })

  describe('#rewardLocker', async () => {

    let yieldWallet;

    beforeEach( async ()=> {
      
      // lock lpt and stake to farming contract
      let lockAmount = ethers.utils.parseEther('1').toString()
      await ethDaiPair.approve(ethDaiVault.address, lockAmount)
      await ethDaiVault.lock(
        lockAmount,
        signers[0].address,
        0
      )

      await ethDaiVault.stakeLP(yieldWalletFactory.address, lockAmount, true);

      let wallet = await ethDaiVault.yieldWallet(signers[0].address)
  
      let KyberYieldWallet = await ethers.getContractFactory(
        'KyberYieldWallet'
      )
      yieldWallet = new ethers.Contract(
        wallet,
        KyberYieldWallet.interface.fragments,
        signers[0]
      )

    })

    describe('#numVestingSchedules', async () => {

      it('should return correct vesting schedule number after harvesting reward', async function () {

        let vestingSchedule0 = await yieldWallet.numVestingSchedules(kncRewardToken.address);
        
        expect(vestingSchedule0.toString()).to.be.equal("0");

        await yieldWallet.harvest() // harvest pending rewards

        let vestingSchedule1 = await yieldWallet.numVestingSchedules(kncRewardToken.address);

        expect(vestingSchedule1.toString()).to.be.equal("1");

        await yieldWallet.harvest() // harvest pending rewards

        let vestingSchedule2 = await yieldWallet.numVestingSchedules(kncRewardToken.address);

        expect(vestingSchedule2.toString()).to.be.equal("2");

        await yieldWallet.harvest() // harvest pending rewards

        let vestingSchedule3 = await yieldWallet.numVestingSchedules(kncRewardToken.address);

        expect(vestingSchedule3.toString()).to.be.equal("3");

      })

    })

    describe('#getVestingSchedules', async () => {

      it('should return correct vesting schedule info after harvesting reward', async function () {

        let vestingSchedule0 = await yieldWallet.getVestingSchedules(kncRewardToken.address);
        expect(vestingSchedule0.length).to.be.equal(0);

        // harvesting for 1 block reward
        let harvestTx1 = await yieldWallet.harvest() // harvest pending rewards

        let vestingSchedule1 = await yieldWallet.getVestingSchedules(kncRewardToken.address);

        expect(vestingSchedule1.length).to.be.equal(1);
        expect(vestingSchedule1[0].startBlock).to.be.equal(harvestTx1.blockNumber);
        expect(vestingSchedule1[0].endBlock.toNumber()).to.be.equal(Number(harvestTx1.blockNumber.toString()) + REWARD_VESTING_DURATION);
        expect(vestingSchedule1[0].quantity.toString()).to.be.equal("4206070000000000000"); // equal to 1 block reward
        expect(vestingSchedule1[0].vestedQuantity.toString()).to.be.equal("0");

        // harvesting for 1 block reward
        let harvestTx2 = await yieldWallet.harvest() // harvest pending rewards

        let vestingSchedule2 = await yieldWallet.getVestingSchedules(kncRewardToken.address);

        expect(vestingSchedule2.length).to.be.equal(2);

        expect(vestingSchedule2[0].startBlock).to.be.equal(harvestTx1.blockNumber);
        expect(vestingSchedule2[0].endBlock.toNumber()).to.be.equal(Number(harvestTx1.blockNumber.toString()) + REWARD_VESTING_DURATION);
        expect(vestingSchedule2[0].quantity.toString()).to.be.equal("4206070000000000000"); // equal to 1 block reward
        expect(vestingSchedule2[0].vestedQuantity.toString()).to.be.equal("0");

        expect(vestingSchedule2[1].startBlock).to.be.equal(harvestTx2.blockNumber);
        expect(vestingSchedule2[1].endBlock.toNumber()).to.be.equal(Number(harvestTx2.blockNumber.toString()) + REWARD_VESTING_DURATION);
        expect(vestingSchedule2[1].quantity.toString()).to.be.equal("4206070000000000000");
        expect(vestingSchedule2[1].vestedQuantity.toString()).to.be.equal("0");
        
        // harvesting again for 1 block reward
        let harvestTx3 = await yieldWallet.harvest() // harvest pending rewards

        let vestingSchedule3 = await yieldWallet.getVestingSchedules(kncRewardToken.address);

        expect(vestingSchedule3.length).to.be.equal(3);

        expect(vestingSchedule3[0].startBlock).to.be.equal(harvestTx1.blockNumber);
        expect(vestingSchedule3[0].endBlock.toNumber()).to.be.equal(Number(harvestTx1.blockNumber.toString()) + REWARD_VESTING_DURATION);
        expect(vestingSchedule3[0].quantity.toString()).to.be.equal("4206070000000000000"); // equal to 1 block reward
        expect(vestingSchedule3[0].vestedQuantity.toString()).to.be.equal("0");

        expect(vestingSchedule3[1].startBlock).to.be.equal(harvestTx2.blockNumber);
        expect(vestingSchedule3[1].endBlock.toNumber()).to.be.equal(Number(harvestTx2.blockNumber.toString()) + REWARD_VESTING_DURATION);
        expect(vestingSchedule3[1].quantity.toString()).to.be.equal("4206070000000000000");
        expect(vestingSchedule3[1].vestedQuantity.toString()).to.be.equal("0");

        expect(vestingSchedule3[2].startBlock).to.be.equal(harvestTx3.blockNumber);
        expect(vestingSchedule3[2].endBlock.toNumber()).to.be.equal(Number(harvestTx3.blockNumber.toString()) + REWARD_VESTING_DURATION);
        expect(vestingSchedule3[2].quantity.toString()).to.be.equal("4206070000000000000");
        expect(vestingSchedule3[2].vestedQuantity.toString()).to.be.equal("0");

      })

    })

    describe('#getVestingScheduleAtIndex', async () => {

      it('should return correct vesting schedule info for specific index', async function () {

        // Harvest for 3 time - 3 blocks
        let harvestTx1 = await yieldWallet.harvest()
        let harvestTx2 = await yieldWallet.harvest()
        let harvestTx3 = await yieldWallet.harvest()

        let vestingScheduleLength = await yieldWallet.numVestingSchedules(kncRewardToken.address);
        expect(vestingScheduleLength.toString()).to.be.equal("3");

        let vestingSchedule0 = await yieldWallet.getVestingScheduleAtIndex(kncRewardToken.address, 0);
        expect(vestingSchedule0.startBlock).to.be.equal(harvestTx1.blockNumber);
        expect(vestingSchedule0.endBlock.toNumber()).to.be.equal(Number(harvestTx1.blockNumber.toString()) + REWARD_VESTING_DURATION);
        expect(vestingSchedule0.quantity.toString()).to.be.equal("4206070000000000000"); // equal to 1 block reward
        expect(vestingSchedule0.vestedQuantity.toString()).to.be.equal("0");

        let vestingSchedule1 = await yieldWallet.getVestingScheduleAtIndex(kncRewardToken.address, 1);
        expect(vestingSchedule1.startBlock).to.be.equal(harvestTx2.blockNumber);
        expect(vestingSchedule1.endBlock.toNumber()).to.be.equal(Number(harvestTx2.blockNumber.toString()) + REWARD_VESTING_DURATION);
        expect(vestingSchedule1.quantity.toString()).to.be.equal("4206070000000000000");
        expect(vestingSchedule1.vestedQuantity.toString()).to.be.equal("0");

        let vestingSchedule2 = await yieldWallet.getVestingScheduleAtIndex(kncRewardToken.address, 2);
        expect(vestingSchedule2.startBlock).to.be.equal(harvestTx3.blockNumber);
        expect(vestingSchedule2.endBlock.toNumber()).to.be.equal(Number(harvestTx3.blockNumber.toString()) + REWARD_VESTING_DURATION);
        expect(vestingSchedule2.quantity.toString()).to.be.equal("4206070000000000000");
        expect(vestingSchedule1.vestedQuantity.toString()).to.be.equal("0");
      })

    })

    describe('#vestScheduleAtIndices', async () => {

      it('vest reward for specific index - only one index at a time', async function () {

        // Harvest for 3 time (total 3 indexes) - also mined 3 blocks
        await yieldWallet.harvest()
        await yieldWallet.harvest()
        await yieldWallet.harvest()

        await expect(yieldWallet
            .vestScheduleAtIndices(kncRewardToken.address, [0]))
            .to.emit(kyberRewardLocker, "Vested")
            .withArgs(kncRewardToken.address, yieldWallet.address, "630910500000000000", 0)

        let vestingScheduleAfter0 = await yieldWallet.getVestingScheduleAtIndex(kncRewardToken.address, 0);
        expect(vestingScheduleAfter0.vestedQuantity.toString()).to.be.equal("630910500000000000"); // reward vested for 3 blocks out of "REWARD_VESTING_DURATION" blocks total
        await mineBlocks(7) // mine 7 blocks

        await expect(yieldWallet
          .vestScheduleAtIndices(kncRewardToken.address, [0]))
          .to.emit(kyberRewardLocker, "Vested")
          .withArgs(kncRewardToken.address, yieldWallet.address, "1682428000000000000", 0)

        let vestingScheduleAfter1 = await yieldWallet.getVestingScheduleAtIndex(kncRewardToken.address, 0);
        expect(vestingScheduleAfter1.vestedQuantity.toString()).to.be.equal("2313338500000000000"); // reward vested for 11 blocks out of "REWARD_VESTING_DURATION" blocks total
        
        await mineBlocks(10) // mine 10 blocks - should vest all available reward

        await expect(yieldWallet
          .vestScheduleAtIndices(kncRewardToken.address, [0]))
          .to.emit(kyberRewardLocker, "Vested")
          .withArgs(kncRewardToken.address, yieldWallet.address, "1892731500000000000", 0)

        let vestingScheduleAfter2 = await yieldWallet.getVestingScheduleAtIndex(kncRewardToken.address, 0);
        expect(vestingScheduleAfter2.vestedQuantity).to.be.equal(vestingScheduleAfter2.quantity); // all reward vested

      })

      it('vest reward for all available index', async function () {

        // Harvest for 3 time (total 3 indexes) - also mined 3 blocks
        await yieldWallet.harvest()
        await yieldWallet.harvest()
        await yieldWallet.harvest()

        await mineBlocks(10) // mine 10 blocks

        let vest = await yieldWallet.vestScheduleAtIndices(kncRewardToken.address, [0,1,2])

        expect(vest).to.emit(kyberRewardLocker, "Vested").withArgs(kncRewardToken.address, yieldWallet.address, "2733945500000000000", 0)
        expect(vest).to.emit(kyberRewardLocker, "Vested").withArgs(kncRewardToken.address, yieldWallet.address, "2523642000000000000", 1)
        expect(vest).to.emit(kyberRewardLocker, "Vested").withArgs(kncRewardToken.address, yieldWallet.address, "2313338500000000000", 2)

        let vestingScheduleAfter = await yieldWallet.getVestingSchedules(kncRewardToken.address);

        expect(vestingScheduleAfter[0].vestedQuantity.toString()).to.be.equal("2733945500000000000"); // reward vested for 13 blocks our of "REWARD_VESTING_DURATION" blocks
        expect(vestingScheduleAfter[1].vestedQuantity.toString()).to.be.equal("2523642000000000000"); // reward vested for 12 blocks our of "REWARD_VESTING_DURATION" blocks
        expect(vestingScheduleAfter[2].vestedQuantity.toString()).to.be.equal("2313338500000000000"); // reward vested for 11 blocks our of "REWARD_VESTING_DURATION" blocks

        await mineBlocks(10) // mine 10 blocks - should vest all reward

        let vest2 = await yieldWallet.vestScheduleAtIndices(kncRewardToken.address, [0,1,2])

        expect(vest2).to.emit(kyberRewardLocker, "Vested").withArgs(kncRewardToken.address, yieldWallet.address, "1472124500000000000", 0)
        expect(vest2).to.emit(kyberRewardLocker, "Vested").withArgs(kncRewardToken.address, yieldWallet.address, "1682428000000000000", 1)
        expect(vest2).to.emit(kyberRewardLocker, "Vested").withArgs(kncRewardToken.address, yieldWallet.address, "1892731500000000000", 2)

        let vestingScheduleAfter2 = await yieldWallet.getVestingSchedules(kncRewardToken.address);

        expect(vestingScheduleAfter2[0].vestedQuantity).to.be.equal(vestingScheduleAfter2[0].quantity); // all reward vested
        expect(vestingScheduleAfter2[1].vestedQuantity).to.be.equal(vestingScheduleAfter2[1].quantity); // all reward vested
        expect(vestingScheduleAfter2[2].vestedQuantity).to.be.equal(vestingScheduleAfter2[2].quantity); // all reward vested


      })

      it('should transfer reward to user address', async function () {

        // Harvest for 3 time (total 3 indexes) - also mined 3 blocks
        await yieldWallet.harvest()
        await yieldWallet.harvest()
        await yieldWallet.harvest()

        await mineBlocks(20) // mine 20 blocks - should vest all reward

        let vest = await yieldWallet.vestScheduleAtIndices(kncRewardToken.address, [0,1,2])

        expect(vest).to.emit(kyberRewardLocker, "Vested").withArgs(kncRewardToken.address, yieldWallet.address, "4206070000000000000", 0)
        expect(vest).to.emit(kyberRewardLocker, "Vested").withArgs(kncRewardToken.address, yieldWallet.address, "4206070000000000000", 1)
        expect(vest).to.emit(kyberRewardLocker, "Vested").withArgs(kncRewardToken.address, yieldWallet.address, "4206070000000000000", 2)

        expect(vest).to.emit(kncRewardToken, "Transfer").withArgs(kyberRewardLocker.address, yieldWallet.address, "12618210000000000000")
        expect(vest).to.emit(kncRewardToken, "Transfer").withArgs(yieldWallet.address, signers[0].address, "12618210000000000000")

      })
    })

    describe('#vestSchedulesInRange', async () => {

      it('should vest reward for index range', async function () {

        // Harvest for 5 time (total 5 indexes) - also mined 5 blocks
        await yieldWallet.harvest()
        await yieldWallet.harvest()
        await yieldWallet.harvest()
        await yieldWallet.harvest()
        await yieldWallet.harvest()
    
        await mineBlocks(20) // mine 20 blocks - should vest all reward
    
        let vest = await yieldWallet.vestSchedulesInRange(kncRewardToken.address, 0, 4) // vest reward for index 0,1,2,3,4

        expect(vest).to.emit(kyberRewardLocker, "Vested").withArgs(kncRewardToken.address, yieldWallet.address, "4206070000000000000", 0)
        expect(vest).to.emit(kyberRewardLocker, "Vested").withArgs(kncRewardToken.address, yieldWallet.address, "4206070000000000000", 1)
        expect(vest).to.emit(kyberRewardLocker, "Vested").withArgs(kncRewardToken.address, yieldWallet.address, "4206070000000000000", 2)
        expect(vest).to.emit(kyberRewardLocker, "Vested").withArgs(kncRewardToken.address, yieldWallet.address, "4206070000000000000", 3)
        expect(vest).to.emit(kyberRewardLocker, "Vested").withArgs(kncRewardToken.address, yieldWallet.address, "4206070000000000000", 4)

      })

      it('should transfer vested reward to user account', async function () {

        // Harvest for 5 time (total 5 indexes) - also mined 5 blocks
        await yieldWallet.harvest()
        await yieldWallet.harvest()
        await yieldWallet.harvest()
        await yieldWallet.harvest()
        await yieldWallet.harvest()
    
        await mineBlocks(20) // mine 20 blocks - should vest all reward
    
        let vest = await yieldWallet.vestSchedulesInRange(kncRewardToken.address, 0, 4) // vest reward for index 0,1,2,3,4

        expect(vest).to.emit(kncRewardToken, "Transfer").withArgs(kyberRewardLocker.address, yieldWallet.address, "21030350000000000000")
        expect(vest).to.emit(kncRewardToken, "Transfer").withArgs(yieldWallet.address, signers[0].address, "21030350000000000000")

      })

    })

    describe('#vestCompletedSchedules', async () => {

      it('should revert if trying to vest reward before endBlock', async function () {

        // Harvest for 5 time (total 5 indexes) - also mined 5 blocks
        await yieldWallet.harvest()
        await yieldWallet.harvest()
        await yieldWallet.harvest()
        await yieldWallet.harvest()
        await yieldWallet.harvest()
        
        // trying to vest reward for all index before endBlock
        await expect(yieldWallet.vestCompletedSchedules(kncRewardToken.address))
          .to.be.revertedWith("0 vesting amount")

      })

      it('should vest reward for completed indexes', async function () {

        // Harvest for 5 time (total 5 indexes) - also mined 5 blocks
        await yieldWallet.harvest()
        await yieldWallet.harvest()
        await yieldWallet.harvest()
        await yieldWallet.harvest()
        await yieldWallet.harvest()
        
        await mineBlocks(15) // mine 15 blocks - should vest all reward

        let vest = await yieldWallet.vestCompletedSchedules(kncRewardToken.address);

        expect(vest).to.emit(kyberRewardLocker, "Vested").withArgs(kncRewardToken.address, yieldWallet.address, "4206070000000000000", 0)

      })

      it('should vest reward for completed indexes', async function () {

        // Harvest for 5 time (total 5 indexes) - also mined 5 blocks
        await yieldWallet.harvest()
        await yieldWallet.harvest()
        await yieldWallet.harvest()
        await yieldWallet.harvest()
        await yieldWallet.harvest()
        
        await mineBlocks(20) // mine 20 blocks - should vest all reward

        let vest = await yieldWallet.vestCompletedSchedules(kncRewardToken.address);

        expect(vest).to.emit(kyberRewardLocker, "Vested").withArgs(kncRewardToken.address, yieldWallet.address, "4206070000000000000", 0)
        expect(vest).to.emit(kyberRewardLocker, "Vested").withArgs(kncRewardToken.address, yieldWallet.address, "4206070000000000000", 1)
        expect(vest).to.emit(kyberRewardLocker, "Vested").withArgs(kncRewardToken.address, yieldWallet.address, "4206070000000000000", 2)
        expect(vest).to.emit(kyberRewardLocker, "Vested").withArgs(kncRewardToken.address, yieldWallet.address, "4206070000000000000", 3)
        expect(vest).to.emit(kyberRewardLocker, "Vested").withArgs(kncRewardToken.address, yieldWallet.address, "4206070000000000000", 4)

      })

      it('should transfer vested reward to user account', async function () {

        // Harvest for 5 time (total 5 indexes) - also mined 5 blocks
        await yieldWallet.harvest()
        await yieldWallet.harvest()
        await yieldWallet.harvest()
        await yieldWallet.harvest()
        await yieldWallet.harvest()
    
        await mineBlocks(20) // mine 20 blocks - should vest all reward
    
        let vest = await yieldWallet.vestCompletedSchedules(kncRewardToken.address)

        expect(vest).to.emit(kncRewardToken, "Transfer").withArgs(kyberRewardLocker.address, yieldWallet.address, "21030350000000000000")
        expect(vest).to.emit(kncRewardToken, "Transfer").withArgs(yieldWallet.address, signers[0].address, "21030350000000000000")

      })

    })
    
  })
  
})


async function mineBlocks(count){
  return new Promise(async function(resolve, reject){
    for(i=1; i<=count; i++){
      await network.provider.send("evm_mine");
      if(i == count){
        resolve(true);
      }
    }
  })
}