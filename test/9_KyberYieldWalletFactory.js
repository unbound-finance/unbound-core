const { expect } = require('chai')
const { ethers } = require('hardhat')
const BigNumber = require('bignumber.js')
BigNumber.set({ DECIMAL_PLACES: 0, ROUNDING_MODE: 1 })
const {
  buildPermitParams,
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

describe('KyberYieldWalletFactory', function () {
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
      '900000000000000000', // 10%
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
    await kyberRewardLocker.setVestingDuration(kncRewardToken.address, "100000");

    let currentBlock = await ethers.provider.getBlockNumber()
    let startBlock = Number(currentBlock) + 2
    let endBlock = Number(startBlock) + 200000
    // console.log(startBlock)
    // console.log(endBlock)

    await kyberFairlaunch.addPool(ethDaiPair.address, startBlock, endBlock, ["4206070000000000000"]);

    let KyberYieldWalletFactory = await ethers.getContractFactory(
      'KyberYieldWalletFactory'
    )
    yieldWalletFactory = await KyberYieldWalletFactory.deploy(kyberFairlaunch.address)

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
      expect(await yieldWalletFactory.farmingContract()).to.equal(kyberFairlaunch.address);
    });

    it("should set correct owner address", async function() { 
      expect(await yieldWalletFactory.owner()).to.equal(signers[0].address);
    });

  })

  describe('#create', async () => {

    it('should revert if pid is invalid for pool', async function () {

      await yieldWalletFactory.setPids([ethDaiPair.address], [2]);

      await expect(yieldWalletFactory.create(
        ethDaiPair.address,
        signers[0].address,
        ethDaiVault.address
      )).to.be.revertedWith("IP");

    })

    it('should create yield wallet contract without revert', async function () {
      await yieldWalletFactory.create(
        ethDaiPair.address,
        signers[0].address,
        ethDaiVault.address
      )
    })

    it('should create new yield wallet for first time user staking LPT', async function () {
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

    it('should emit event when creating new yield wallet for first time user staking LPT', async function () {
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

      await expect(ethDaiVault.stakeLP(yieldWalletFactory.address, lockAmount, true)
        ).to.emit(yieldWalletFactory, "YeildWalletFactory")
      
    })
  })

  describe('#setPids', async () => {

    it('should revert if caller is not owner', async function () {

      await expect(
        yieldWalletFactory
          .connect(signers[1])
          .setPids([ethDaiPair.address], [0]))
        .to.be.revertedWith("Ownable: caller is not the owner")

    })

    it('should revert if input argument is invalid', async function () {

      await expect(
        yieldWalletFactory
          .setPids([ethDaiPair.address], [0, 1]))
        .to.be.revertedWith("IA")

    })

    it('should set correct pid for address', async function () {

      await yieldWalletFactory.setPids([ethDaiPair.address], [1]);

      expect(await yieldWalletFactory.pids(ethDaiPair.address)).to.eq("1");

    })
  
  })
})
