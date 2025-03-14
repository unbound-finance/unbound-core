const { expect } = require('chai')
const { ethers } = require('hardhat')
const BigNumber = require('bignumber.js')
BigNumber.set({ DECIMAL_PLACES: 0, ROUNDING_MODE: 1 })
const {
  buildPermitParams,
  getSignatureFromTypedData,
  MAX_UINT_AMOUNT,
} = require('../helpers/contract-helpers')

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

let rewardFactory;
let dQuickToken; 

const ethPrice = '320000000000' // $3200

const CR = '200000000' // 200%
const LTV = '50000000' // 50%
const PROTOCOL_FEE = '500000' // 0.5%
const stakeFee = '500000' // 0.5%

describe('DfynYieldWalletFactory', function () {
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
      '900000000000000000', // 10%
      5000,
      undDaiPair
    )

    ethDaiVault = await vaultFactory.vaultByIndex(1)
    ethDaiVault = await ethers.getContractAt('UniswapV2Vault', ethDaiVault)


    let TestToken = await ethers.getContractFactory('TestToken')
    dQuickToken = await TestToken.deploy("Dragon Quick", "dQuick", 18, signers[0].address)

    let currentBlock = await ethers.provider.getBlockNumber()
    let timestamp = (await ethers.provider.getBlock(currentBlock)).timestamp

    let DfynStakingRewardsFactory = await ethers.getContractFactory('DfynStakingRewardsFactory')
    rewardFactory = await DfynStakingRewardsFactory.deploy(dQuickToken.address, timestamp + 10)

    let DfynYieldWalletFactory = await ethers.getContractFactory(
      'DfynYieldWalletFactory'
    )
    yieldWalletFactory = await DfynYieldWalletFactory.deploy(rewardFactory.address)

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

    it("should set farming contract address", async function() { 
      expect(await yieldWalletFactory.rewardFactoryContract()).to.equal(rewardFactory.address);
    });

    it("should set correct owner address", async function() { 
      expect(await yieldWalletFactory.owner()).to.equal(signers[0].address);
    });

  })

  describe('#create', async () => {

    it('should revert if staking token is invalid for pool', async function () {
      
      await rewardFactory.deploy(ethDaiPair.address, "300000000000000000000000" ,86400, 35, 15552000, 3, 25);

      await expect(yieldWalletFactory.create(
        dQuickToken.address,
        signers[0].address,
        ethDaiVault.address
      )).to.be.revertedWith("IP");

    })

    it('should create yield wallet contract without revert', async function () {

      await rewardFactory.deploy(ethDaiPair.address, "300000000000000000000000" ,86400, 35, 15552000, 3, 25);

      await yieldWalletFactory.create(
        ethDaiPair.address,
        signers[0].address,
        ethDaiVault.address
      )
    })

    it('should create new yield wallet for first time user staking LPT', async function () {

      await rewardFactory.deploy(ethDaiPair.address, "300000000000000000000000" ,86400, 35, 15552000, 3, 25);

      expect(await ethDaiVault.yieldWallet(signers[0].address)).to.be.equal(
        zeroAddress
      )

      let lockAmount = ethers.utils.parseEther('1').toString()

      await ethDaiPair.approve(ethDaiVault.address, lockAmount)

      await ethDaiVault.lock(
        lockAmount,
        signers[0].address,
        0
      )

      await ethDaiVault.stakeLP(yieldWalletFactory.address, lockAmount, true);

      expect(await ethDaiVault.yieldWallet(signers[0].address)).to.not.equal(
        zeroAddress
      )
    })

    it('should emit event when creating new yield wallet for first time user locking LPT', async function () {
      
      await rewardFactory.deploy(ethDaiPair.address, "300000000000000000000000" ,86400, 35, 15552000, 3, 25);

      expect(await ethDaiVault.yieldWallet(signers[0].address)).to.be.equal(
        zeroAddress
      )

      let lockAmount = ethers.utils.parseEther('1').toString()

      await ethDaiPair.approve(ethDaiVault.address, lockAmount)
      await ethDaiVault.lock(
        lockAmount,
        signers[0].address,
        0
      )

      await expect(ethDaiVault.stakeLP(yieldWalletFactory.address, lockAmount, true))
        .to.emit(yieldWalletFactory, "YeildWalletFactory")
      
    })
  })

  describe("#changeTeamFeeAddress", function() {
    it("should revert if not called by owner", async function() { 
        await expect(ethDaiVault.connect(signers[1]).changeTeamFeeAddress(signers[1].address))
            .to.be.revertedWith("NA");
    });
    it("should revert if input address is zero address", async function() { 
        await expect(ethDaiVault.changeTeamFeeAddress(zeroAddress))
            .to.be.revertedWith("IA");
    });
    it("should set new team address", async () => {
        await ethDaiVault.changeTeamFeeAddress(signers[1].address);
        expect(await ethDaiVault.team()).to.equal(signers[1].address);
    });
  })

  describe("#distributeFee", function() {

    it("should revert if team address is not initialized", async () => {
        await expect(ethDaiVault.distributeFee()).to.be.revertedWith("INVALID")

    });

    it("should distribute fees(100%) to team address ", async () => {

        await tDai.transfer(yieldWalletFactory.address, "1000");

        expect((await tDai.balanceOf(yieldWalletFactory.address)).toString()).to.be.equal("1000") // factory balance

        // Chnage team address
        await yieldWalletFactory.changeTeamFeeAddress(signers[3].address);

        let distribute = await yieldWalletFactory.distributeFee(tDai.address)

        expect(distribute).to.emit(tDai, "Transfer").withArgs(yieldWalletFactory.address, signers[3].address, "1000"); // 100% of factory balance
        expect(distribute).to.emit(yieldWalletFactory, "DistributeFee").withArgs(tDai.address, "1000");


        expect((await tDai.balanceOf(yieldWalletFactory.address)).toString()).to.be.equal("0") // 0% remaining in contract balance

    });

})

})
