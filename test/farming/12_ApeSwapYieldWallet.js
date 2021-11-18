const { expect } = require('chai')
const { ethers } = require('hardhat')
const BigNumber = require('bignumber.js')
BigNumber.set({ DECIMAL_PLACES: 0, ROUNDING_MODE: 1 })
const {
  buildPermitParams,
  getSignatureFromTypedData,
  MAX_UINT_AMOUNT,
} = require('../helpers/contract-helpers')
const { zeroPad } = require('ethers/lib/utils')

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

let masterchef;
let bananaToken; 

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

describe('ApeSwapYieldWallet', function () {
  beforeEach(async function () {
    signers = await ethers.getSigners()
    governance = signers[0].address

    let UniswapV2Factory = await ethers.getContractFactory('UniswapV2Factory')
    uniswapFactory = await UniswapV2Factory.deploy(zeroAddress)

    let WETH9 = await ethers.getContractFactory('WETH9')
    weth = await WETH9.deploy()

    let UniswapV2Router02 = await ethers.getContractFactory('UniswapV2Router02')
    uniswapRouter = await UniswapV2Router02.deploy(
      uniswapFactory.address,
      weth.address
    )

    let Oracle = await ethers.getContractFactory('UniswapV2PriceProvider')
    oracleLibrary = await Oracle.deploy()

    let VaultFactory = await ethers.getContractFactory(
      'UniswapV2VaultFactory',
      {
        libraries: { UniswapV2PriceProvider: oracleLibrary.address },
      }
    )

    vaultFactory = await VaultFactory.deploy(governance, uniswapFactory.address);

    let UnboundToken = await ethers.getContractFactory('UnboundToken')
    und = await UnboundToken.deploy(signers[0].address)

    let TestEth = await ethers.getContractFactory('TestEth')
    tEth = await TestEth.deploy(signers[0].address)

    let TestDai = await ethers.getContractFactory('TestDai')
    tDai = await TestDai.deploy(signers[0].address, '1337')

    await uniswapFactory.createPair(und.address, tDai.address)
    await uniswapFactory.createPair(tEth.address, tDai.address)

    undDaiPair = await uniswapFactory.getPair(und.address, tDai.address)
    ethDaiPair = await uniswapFactory.getPair(tEth.address, tDai.address)

    ethDaiPair = await ethers.getContractAt('UniswapV2Pair', ethDaiPair)

    let daiAmount = ethers.utils
      .parseEther(((Number(ethPrice) / 100000000) * 1).toString())
      .toString()
    let ethAmount = ethers.utils.parseEther('1').toString()

    await tDai.approve(uniswapRouter.address, daiAmount)
    await tEth.approve(uniswapRouter.address, ethAmount)

    await uniswapRouter.addLiquidity(
      tDai.address,
      tEth.address,
      daiAmount,
      ethAmount,
      daiAmount,
      ethAmount,
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
    ethDaiVault = await ethers.getContractAt('UniswapV2Vault', ethDaiVault)


    let TestToken = await ethers.getContractFactory('TestToken')
    bananaToken = await TestToken.deploy("Banana Token", "BANANA", 18, signers[0].address)

    let MasterChef = await ethers.getContractFactory('MasterApe')
    let currentBlock = await ethers.provider.getBlockNumber()

    masterchef = await MasterChef.deploy(bananaToken.address, bananaToken.address, signers[0].address, "100000000000000000000", currentBlock, 4)


    await masterchef.add("4000", ethDaiPair.address, false);

    let ApeSwapYieldWalletFactory = await ethers.getContractFactory(
      'ApeSwapYieldWalletFactory'
    )
    yieldWalletFactory = await ApeSwapYieldWalletFactory.deploy(masterchef.address)
    await yieldWalletFactory.changeTeamFeeAddress(signers[3].address);

    await yieldWalletFactory.setPids([ethDaiPair.address], [1]);

    await ethDaiVault.changeLTV(LTV)
    await ethDaiVault.changeCR(CR)
    await ethDaiVault.changeFee(PROTOCOL_FEE)
    await ethDaiVault.changeStakeFee(stakeFee)
    await ethDaiVault.enableYieldWalletFactory(yieldWalletFactory.address)
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

      let ApeSwapYieldWallet = await ethers.getContractFactory(
        'ApeSwapYieldWallet'
      )
      yieldwalletInstance = new ethers.Contract(
        wallet,
        ApeSwapYieldWallet.interface.fragments,
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
      expect(await yieldwalletInstance.farming()).to.be.equal(masterchef.address)
    })

    it('should set correct pid for pool', async function () {
      expect(await yieldwalletInstance.pid()).to.be.equal("1")
    })

    it('should approve proper allowance to farming contract', async function () {
      expect(await ethDaiPair.allowance(yieldwalletInstance.address, masterchef.address)).to.be.equal(MAX_UINT_AMOUNT)
    })

    it('should set reward token contract address', async function () {
      expect(await yieldwalletInstance.rewardToken()).to.be.equal(bananaToken.address)
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

      let ApeSwapYieldWallet = await ethers.getContractFactory(
        'ApeSwapYieldWallet'
      )
      let yieldwallet = new ethers.Contract(
        wallet,
        ApeSwapYieldWallet.interface.fragments,
        signers[0]
      )

      await expect(
        yieldwallet.deposit(lockAmount)
      ).to.be.revertedWith('NA')
    })

    it('should deposit event on stake LPT', async function () {

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

      let ApeSwapYieldWallet = await ethers.getContractFactory(
        'ApeSwapYieldWallet'
      )
      let yieldwallet = new ethers.Contract(
        wallet,
        ApeSwapYieldWallet.interface.fragments,
        signers[0]
      )

      expect(stake).to.emit(yieldwallet, "Deposit").withArgs(pid, lockAmount)

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
      ) // to create yield wallet for user

      await ethDaiVault.stakeLP(yieldWalletFactory.address, lockAmount1, true);

      let wallet = await ethDaiVault.yieldWallet(signers[0].address)
      let balanceBefore = (await ethDaiPair.balanceOf(masterchef.address)).toString()
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

      expect(await ethDaiPair.balanceOf(masterchef.address)).to.be.equal(balanceAfter)
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

      let ApeSwapYieldWallet = await ethers.getContractFactory(
        'ApeSwapYieldWallet'
      )
      let yieldwallet = new ethers.Contract(
        wallet,
        ApeSwapYieldWallet.interface.fragments,
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


      expect(stake).to.emit(masterchef, "Deposit").withArgs(wallet, pid, lockAmount)

    })

    it('lock - should emit proper transfer event while locking LPTs', async function () {

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
      expect(stake).to.emit(ethDaiPair, "Transfer").withArgs(wallet, masterchef.address, lockAmount)

    })

    it('lock - should transfer reward banana token to user if pending while staking ', async function () {

      let lockAmount = ethers.utils.parseEther('2').toString()
      await ethDaiPair.approve(ethDaiVault.address, lockAmount)

      let lock = await ethDaiVault.lock(
        lockAmount,
        signers[0].address,
        0
      )

      await ethDaiVault.stakeLP(yieldWalletFactory.address, lockAmount, true);
      
      let wallet = await ethDaiVault.yieldWallet(signers[0].address)

      await ethDaiPair.approve(ethDaiVault.address, lockAmount)

      let lock2 = await ethDaiVault.lock(
        lockAmount,
        signers[0].address,
        0
      )

      let stake = await ethDaiVault.stakeLP(yieldWalletFactory.address, lockAmount, false);

      expect(stake).to.emit(bananaToken, "Transfer").withArgs(masterchef.address, wallet, "900056253515844000000")
      expect(stake).to.emit(bananaToken, "Transfer").withArgs(wallet, yieldWalletFactory.address, "180011250703168800000")
      expect(stake).to.emit(bananaToken, "Transfer").withArgs(wallet, signers[0].address, "720045002812675200000")

      let ApeSwapYieldWallet = await ethers.getContractFactory(
        'ApeSwapYieldWallet'
      )
      let yieldWallet = new ethers.Contract(
        wallet,
        ApeSwapYieldWallet.interface.fragments,
        signers[0]
      )

      expect(stake).to.emit(yieldWallet, "WithdrawFund").withArgs(bananaToken.address, yieldWalletFactory.address, "180011250703168800000");
      expect(stake).to.emit(yieldWallet, "WithdrawFund").withArgs(bananaToken.address, signers[0].address, "720045002812675200000");
    })

    it('lockWithPermit - should increase yieldWalletDeposit amount on stake LPT', async function () {
      expect(
        await ethDaiVault.yieldWalletDeposit(signers[0].address)
      ).to.be.equal('0')

      const { chainId } = await ethers.provider.getNetwork()

      const expiration = MAX_UINT_AMOUNT;
      const nonce = (await ethDaiPair.nonces(signers[0].address)).toString();
      const permitAmount = ethers.utils.parseEther("1").toString();
  
      const msgParams = buildPermitParams(
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
      let balanceBefore = (await ethDaiPair.balanceOf(masterchef.address)).toString()

      const { chainId } = await ethers.provider.getNetwork()

      const expiration = MAX_UINT_AMOUNT;
      const nonce = (await ethDaiPair.nonces(signers[0].address)).toString();
      const permitAmount = ethers.utils.parseEther("1").toString();
  
      const msgParams = buildPermitParams(
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

      expect(await ethDaiPair.balanceOf(masterchef.address)).to.be.equal(balanceAfter)
    })

    it('lockWithPermit - should update correct info for user and pool in farming contract', async function () {

      const { chainId } = await ethers.provider.getNetwork()
  
      const expiration = MAX_UINT_AMOUNT;
      const nonce = (await ethDaiPair.nonces(signers[0].address)).toString();
      const permitAmount = ethers.utils.parseEther("1").toString();
  
      const msgParams = buildPermitParams(
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
  
      let ApeSwapYieldWallet = await ethers.getContractFactory(
        'ApeSwapYieldWallet'
      )
      let yieldwallet = new ethers.Contract(
        wallet,
        ApeSwapYieldWallet.interface.fragments,
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
  
      const msgParams = buildPermitParams(
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
  
  
      expect(stake).to.emit(masterchef, "Deposit").withArgs(wallet, pid, permitAmount)
  
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

      let ApeSwapYieldWallet = await ethers.getContractFactory(
        'ApeSwapYieldWallet'
      )
      let yieldwallet = new ethers.Contract(
        wallet,
        ApeSwapYieldWallet.interface.fragments,
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

    it("should transfer LPT back to user from farming wallet to user on unstake LPT", async function() {
      
      let lockAmount = ethers.utils.parseEther('1').toString()

      let wallet = await ethDaiVault.yieldWallet(signers[0].address)

      expect(await ethDaiVault.yieldWalletDeposit(signers[0].address)).to.be.equal(lockAmount)

      let balanceBeforeVault = (await ethDaiPair.balanceOf(ethDaiVault.address)).toString()
      let balanceBeforeFarming = (await ethDaiPair.balanceOf(masterchef.address)).toString()
      let balanceBeforeWallet = (await ethDaiPair.balanceOf(wallet)).toString()

      expect(balanceBeforeWallet).to.be.equal("0")

      let collateral = (await ethDaiVault.collateral(signers[0].address)).toString()

      await ethDaiVault.unstakeLP(collateral);

      let balanceAfterVault = (new BigNumber(balanceBeforeVault).plus(collateral)).toFixed()
      let balanceAfterFarming = (new BigNumber(balanceBeforeFarming).minus(collateral)).toFixed()

      expect(await ethDaiPair.balanceOf(ethDaiVault.address)).to.be.equal(balanceAfterVault)
      expect(await ethDaiPair.balanceOf(masterchef.address)).to.be.equal(balanceAfterFarming)
      expect(await ethDaiPair.balanceOf(wallet)).to.be.equal(balanceBeforeWallet)

    });

    it('unlock - should update correct info for user and pool in farming contract', async function () {

      let wallet = await ethDaiVault.yieldWallet(signers[0].address)

      let ApeSwapYieldWallet = await ethers.getContractFactory(
        'ApeSwapYieldWallet'
      )
      let yieldwallet = new ethers.Contract(
        wallet,
        ApeSwapYieldWallet.interface.fragments,
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

      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (await ethDaiVault.collateral(signers[0].address)).toString()
      
      let unstake = await ethDaiVault.unstakeLP(collateral);

      let wallet = await ethDaiVault.yieldWallet(signers[0].address)
      let pid = await yieldWalletFactory.pids(ethDaiPair.address);


      expect(unstake).to.emit(masterchef, "Withdraw").withArgs(wallet, pid, collateral)

    })

    it('unlock - should emit proper transfer event while unlock LPTs', async function () {

      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (await ethDaiVault.collateral(signers[0].address)).toString()
      
      let unstake = await ethDaiVault.unstakeLP(collateral);
      let unlock = await ethDaiVault.unlock(debt, collateral);

      let wallet = await ethDaiVault.yieldWallet(signers[0].address)

      expect(unstake).to.emit(ethDaiPair, "Transfer").withArgs(masterchef.address, wallet, collateral)
      expect(unstake).to.emit(ethDaiPair, "Transfer").withArgs(wallet, ethDaiVault.address, collateral)
      expect(unlock).to.emit(ethDaiPair, "Transfer").withArgs(ethDaiVault.address, signers[0].address, collateral)

    })

    it('unlock - should transfer banana reward to user while unstaking', async function () {
      
      let collateral = (await ethDaiVault.collateral(signers[0].address)).toString()

      let unstake = await ethDaiVault.unstakeLP(collateral);

      let wallet = await ethDaiVault.yieldWallet(signers[0].address)

      expect(unstake).to.emit(bananaToken, "Transfer").withArgs(masterchef.address, wallet, "1500093755859741000000")
      expect(unstake).to.emit(bananaToken, "Transfer").withArgs(wallet, yieldWalletFactory.address, "300018751171948200000")
      expect(unstake).to.emit(bananaToken, "Transfer").withArgs(wallet, signers[0].address, "1200075004687792800000")

      let ApeSwapYieldWallet = await ethers.getContractFactory(
        'ApeSwapYieldWallet'
      )
      let yieldWallet = new ethers.Contract(
        wallet,
        ApeSwapYieldWallet.interface.fragments,
        signers[0]
      )

      expect(unstake).to.emit(yieldWallet, "WithdrawFund").withArgs(bananaToken.address, yieldWalletFactory.address, "300018751171948200000");
      expect(unstake).to.emit(yieldWallet, "WithdrawFund").withArgs(bananaToken.address, signers[0].address, "1200075004687792800000");
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

      let ApeSwapYieldWallet = await ethers.getContractFactory(
        'ApeSwapYieldWallet'
      )
      let yieldwallet = new ethers.Contract(
        wallet,
        ApeSwapYieldWallet.interface.fragments,
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
  
      let ApeSwapYieldWallet = await ethers.getContractFactory(
        'ApeSwapYieldWallet'
      )
      let yieldwallet = new ethers.Contract(
        wallet,
        ApeSwapYieldWallet.interface.fragments,
        signers[0]
      )
  
      await bananaToken.transfer(wallet, "100")
  
      let claim = await yieldwallet.claim(bananaToken.address, signers[0].address)
      
      expect(claim).to.emit(bananaToken, "Transfer").withArgs(wallet, yieldWalletFactory.address, "20");
      expect(claim).to.emit(bananaToken, "Transfer").withArgs(wallet, signers[0].address, "80");

      expect(claim).to.emit(yieldwallet, "WithdrawFund").withArgs(bananaToken.address, yieldWalletFactory.address, "20");
      expect(claim).to.emit(yieldwallet, "WithdrawFund").withArgs(bananaToken.address, signers[0].address, "80");
    })

    it('should emit claim token event', async function () {
      let lockAmount = ethers.utils.parseEther('1').toString()
      await ethDaiPair.approve(ethDaiVault.address, lockAmount)
      await ethDaiVault.lock(
        lockAmount,
        signers[0].address,
        0
      )

      await ethDaiVault.stakeLP(yieldWalletFactory.address, lockAmount, true);
      
      let wallet = await ethDaiVault.yieldWallet(signers[0].address)
  
      let ApeSwapYieldWallet = await ethers.getContractFactory(
        'ApeSwapYieldWallet'
      )
      let yieldwallet = new ethers.Contract(
        wallet,
        ApeSwapYieldWallet.interface.fragments,
        signers[0]
      )
  
      await bananaToken.transfer(wallet, "100")
  
      await expect(
        yieldwallet
          .claim(bananaToken.address, signers[0].address)
      ).to.emit(yieldwallet, "Claim")
      .withArgs(bananaToken.address, signers[0].address, "80");
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
  
      let ApeSwapYieldWallet = await ethers.getContractFactory(
        'ApeSwapYieldWallet'
      )
      let yieldwallet = new ethers.Contract(
        wallet,
        ApeSwapYieldWallet.interface.fragments,
        signers[0]
      )

      let info = await yieldwallet.getWalletInfo();

      expect(info.amount.toString()).to.be.equal(lockAmount);
      expect(info.rewardDebt.toString()).to.be.equal("0");

      let pendingReward = await yieldwallet.getPendingRewards()
      expect(pendingReward.toString()).to.be.equal("0");

      await network.provider.send("evm_mine") // mine 1 block

      let info2 = await yieldwallet.getWalletInfo();

      expect(info2.amount.toString()).to.be.equal(lockAmount);
      expect(info2.rewardDebt.toString()).to.be.equal("0");

      let pendingReward2 = await yieldwallet.getPendingRewards()
      expect(pendingReward2.toString()).to.be.equal("300018751171948000000");

      await network.provider.send("evm_mine") // mine 1 block

      let info3 = await yieldwallet.getWalletInfo();

      expect(info3.amount.toString()).to.be.equal(lockAmount);
      expect(info3.rewardDebt.toString()).to.be.equal("0");

      let pendingReward3 = await yieldwallet.getPendingRewards()
      expect(pendingReward3.toString()).to.be.equal("600037502343896000000");
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