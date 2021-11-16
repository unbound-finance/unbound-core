const { expect } = require('chai')
const { ethers } = require('hardhat')
const BigNumber = require('bignumber.js')
BigNumber.set({ DECIMAL_PLACES: 0, ROUNDING_MODE: 1 })
const { MAX_UINT_AMOUNT } = require('../helpers/contract-helpers')

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

const ethPrice = '320000000000' // $3200
const daiPrice = '100000000' // $1

const CR = '200000000' // 200%
const LTV = '50000000' // 50%
const PROTOCOL_FEE = '500000' // 0.5%
const stakeFee = '500000' // 0.5%
const safuShare = '40000000' // 40%
const SECOND_BASE = '100000000' // 1e8

describe('UnboundVaultBase', function () {
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

    await ethDaiVault.changeLTV(LTV)
    await ethDaiVault.changeCR(CR)
    await ethDaiVault.changeFee(PROTOCOL_FEE)
    await ethDaiVault.changeStakeFee(stakeFee)

    await ethDaiVault.enableYieldWalletFactory(zeroAddress);
    await vaultFactory.enableVault(ethDaiVault.address);
    await und.addMinter(vaultFactory.address)

    await ethers.provider.send("evm_increaseTime", [259201])   // increase evm time by 3 days

    await ethDaiVault.executeEnableYeildWalletFactory(zeroAddress);
    await vaultFactory.executeEnableVault(ethDaiVault.address);
    await und.enableMinter(vaultFactory.address)
  })

  describe('#mint', async () => {
    it('should revert if mintTo address is zeroAddress', async function () {
      let lockAmount = ethers.utils.parseEther('1').toString()

      await ethDaiPair.approve(ethDaiVault.address, lockAmount)

      await expect(
        ethDaiVault.lock(lockAmount, zeroAddress, '1')
      ).to.be.revertedWith('NO')
    })

    it('should revert if vault is not valid minter', async function () {
      await vaultFactory.disableVault(ethDaiVault.address)
      await ethers.provider.send("evm_increaseTime", [604801])   // increase evm time by 7 days
      await vaultFactory.executeDisableVault(ethDaiVault.address);
      
      let lockAmount = ethers.utils.parseEther('1').toString()

      await ethDaiPair.approve(ethDaiVault.address, lockAmount)

      await expect(
        ethDaiVault.lock(lockAmount, signers[0].address, '1')
      ).to.be.revertedWith('NA')
    })

    it('should revert if uToken mint limit is reached', async function () {
      await ethDaiVault.changeUTokenMintLimit('1')

      let lockAmount = ethers.utils.parseEther('1').toString()

      await ethDaiPair.approve(ethDaiVault.address, lockAmount)

      await expect(
        ethDaiVault.lock(lockAmount, signers[0].address, '10')
      ).to.be.revertedWith('LE')
    })

    it('should increase uTokenMinted on mint UND', async function () {
      expect(await ethDaiVault.uTokenMinted()).to.equal("0")

      await ethDaiVault.changeUTokenMintLimit('100000000000000000000000') // 1,00,000 UND

      let lockAmount = ethers.utils.parseEther('1').toString()

      await ethDaiPair.approve(ethDaiVault.address, lockAmount)

      await ethDaiVault.lock(lockAmount, signers[0].address, '10')

      expect(await ethDaiVault.uTokenMinted()).to.equal("56568542494923801952")

    })

    it('should increase uTokenMinted on mint UND -  2nd time', async function () {
      expect(await ethDaiVault.uTokenMinted()).to.equal("0")

      await ethDaiVault.changeUTokenMintLimit('100000000000000000000000') // 1,00,000 UND

      let lockAmount = ethers.utils.parseEther('1').toString()

      await ethDaiPair.approve(ethDaiVault.address, lockAmount)

      await ethDaiVault.lock(lockAmount, signers[0].address, '10')

      expect(await ethDaiVault.uTokenMinted()).to.equal("56568542494923801952")

      await ethDaiPair.approve(ethDaiVault.address, lockAmount)

      await ethDaiVault.lock(lockAmount, signers[0].address, '10')

      expect(await ethDaiVault.uTokenMinted()).to.equal("113137084989847603904")

    })

    it('should revert when und mint limit is reached -2nd time', async function () {

      expect(await ethDaiVault.uTokenMinted()).to.equal("0")

      await ethDaiVault.changeUTokenMintLimit('113137084989847603903') // 113 UND - little less then 2nd time mint amount

      let lockAmount = ethers.utils.parseEther('1').toString()

      await ethDaiPair.approve(ethDaiVault.address, lockAmount)

      await ethDaiVault.lock(lockAmount, signers[0].address, '10')

      expect(await ethDaiVault.uTokenMinted()).to.equal("56568542494923801952")

      await ethDaiPair.approve(ethDaiVault.address, lockAmount)

      await expect(
        ethDaiVault.lock(lockAmount, signers[0].address, '10')
      ).to.be.revertedWith('LE')

    })


    it('uTokenMinted should be equal to balance of all users after mint', async function () {
      
      expect(await ethDaiVault.uTokenMinted()).to.equal("0")

      await ethDaiVault.changeUTokenMintLimit('100000000000000000000000') // 1,00,000 UND

      let lockAmount = ethers.utils.parseEther('1').toString()

      await ethDaiPair.approve(ethDaiVault.address, lockAmount)

      await ethDaiVault.lock(lockAmount, signers[0].address, '10')

      expect(await ethDaiVault.uTokenMinted()).to.equal("56568542494923801952") // 56568542494923801952

      let balanceUser1 = (await und.balanceOf(signers[0].address)).toString()
      let balanceUser2 = (await und.balanceOf(signers[1].address)).toString()
      let balanceVault = (await und.balanceOf(ethDaiVault.address)).toString()
      let balanceStaking = (await und.balanceOf(undDaiPair)).toString()

      let totalAvailableUND = (new BigNumber(balanceUser1).plus(balanceUser2).plus(balanceVault).plus(balanceStaking)).toFixed()

      expect(await ethDaiVault.uTokenMinted()).to.equal(totalAvailableUND) // 56568542494923801952

    })

    it('lock 1 LP - should mint correct amount of UND to user account, staking adress & vault contract', async function () {
      let lockAmount = ethers.utils.parseEther('1').toString()

      await ethDaiPair.approve(ethDaiVault.address, lockAmount)

      let lptPrice = await calculateLPTPriceFromUniPool(
        ethDaiPair,
        tDai.address
      )

      let totalLPTValueInUSD = new BigNumber(lockAmount)
        .multipliedBy(lptPrice.toString())
        .dividedBy(BASE)
        .toFixed()
      let mintAmount = new BigNumber(totalLPTValueInUSD)
        .multipliedBy(LTV)
        .dividedBy(SECOND_BASE)
        .toFixed()

      let protocolFee = new BigNumber(mintAmount)
        .multipliedBy(PROTOCOL_FEE)
        .dividedBy(SECOND_BASE)
        .toFixed()
      let stakeFees = new BigNumber(mintAmount)
        .multipliedBy(stakeFee)
        .dividedBy(SECOND_BASE)
        .toFixed()
      let finalMintAmount = new BigNumber(mintAmount)
        .minus(protocolFee)
        .minus(stakeFees)
        .toFixed()

      let lock = await ethDaiVault.lock(
        lockAmount,
        signers[0].address,
        finalMintAmount
      )

      expect(lock)
        .to.emit(und, 'Transfer')
        .withArgs(zeroAddress, ethDaiVault.address, protocolFee)
      expect(lock)
        .to.emit(und, 'Transfer')
        .withArgs(zeroAddress, undDaiPair, stakeFees)
      expect(lock)
        .to.emit(und, 'Transfer')
        .withArgs(zeroAddress, signers[0].address, finalMintAmount)

      expect(lock)
        .to.emit(ethDaiVault, 'Lock')
        .withArgs(signers[0].address, lockAmount, finalMintAmount)

      expect(lock)
        .to.emit(ethDaiPair, 'Transfer')
        .withArgs(signers[0].address, ethDaiVault.address, lockAmount)

      expect(await und.balanceOf(ethDaiVault.address)).to.equal(protocolFee)
      expect(await und.balanceOf(undDaiPair)).to.equal(stakeFees)
      expect(await und.balanceOf(signers[0].address)).to.equal(finalMintAmount)
    })

    it('should store correct debt amount', async function () {
      let lockAmount = ethers.utils.parseEther('1').toString()

      await ethDaiPair.approve(ethDaiVault.address, lockAmount)

      let lptPrice = await calculateLPTPriceFromUniPool(
        ethDaiPair,
        tDai.address
      )

      let totalLPTValueInUSD = new BigNumber(lockAmount)
        .multipliedBy(lptPrice.toString())
        .dividedBy(BASE)
        .toFixed()
      let mintAmount = new BigNumber(totalLPTValueInUSD)
        .multipliedBy(LTV)
        .dividedBy(SECOND_BASE)
        .toFixed()

      let protocolFee = new BigNumber(mintAmount)
        .multipliedBy(PROTOCOL_FEE)
        .dividedBy(SECOND_BASE)
        .toFixed()
      let stakeFees = new BigNumber(mintAmount)
        .multipliedBy(stakeFee)
        .dividedBy(SECOND_BASE)
        .toFixed()
      let finalMintAmount = new BigNumber(mintAmount)
        .minus(protocolFee)
        .minus(stakeFees)
        .toFixed()

      await ethDaiVault.lock(
        lockAmount,
        signers[0].address,
        finalMintAmount
      )

      expect(await ethDaiVault.collateral(signers[0].address)).to.equal(
        lockAmount
      )
      expect(await ethDaiVault.debt(signers[0].address)).to.equal(mintAmount)
    })

    it('should increase debt amount when locking for second time(same amount) without paying first debt', async function () {
      let lockAmount = ethers.utils.parseEther('1').toString()

      await ethDaiPair.approve(ethDaiVault.address, lockAmount)

      let lptPrice = await calculateLPTPriceFromUniPool(
        ethDaiPair,
        tDai.address
      )

      let totalLPTValueInUSD = new BigNumber(lockAmount)
        .multipliedBy(lptPrice.toString())
        .dividedBy(BASE)
        .toFixed()
      let mintAmount = new BigNumber(totalLPTValueInUSD)
        .multipliedBy(LTV)
        .dividedBy(SECOND_BASE)
        .toFixed()

      let protocolFee = new BigNumber(mintAmount)
        .multipliedBy(PROTOCOL_FEE)
        .dividedBy(SECOND_BASE)
        .toFixed()
      let stakeFees = new BigNumber(mintAmount)
        .multipliedBy(stakeFee)
        .dividedBy(SECOND_BASE)
        .toFixed()
      let finalMintAmount = new BigNumber(mintAmount)
        .minus(protocolFee)
        .minus(stakeFees)
        .toFixed()

      await ethDaiVault.lock(
        lockAmount,
        signers[0].address,
        finalMintAmount
      )

      expect(await ethDaiVault.debt(signers[0].address)).to.equal(mintAmount)

      // locking for second time

      await ethDaiPair.approve(ethDaiVault.address, lockAmount)

      await ethDaiVault.lock(
        lockAmount,
        signers[0].address,
        finalMintAmount
      )

      let finalDebt = new BigNumber(mintAmount).plus(mintAmount).toFixed()

      expect(await ethDaiVault.debt(signers[0].address)).to.equal(finalDebt)
    })

    it('should increase collateral and debt amount when locking for second time(different amount) without paying first debt', async function () {
      let lockAmount = ethers.utils.parseEther('1').toString()

      await ethDaiPair.approve(ethDaiVault.address, lockAmount)

      let lptPrice = await calculateLPTPriceFromUniPool(
        ethDaiPair,
        tDai.address
      )

      let totalLPTValueInUSD = new BigNumber(lockAmount)
        .multipliedBy(lptPrice.toString())
        .dividedBy(BASE)
        .toFixed()
      let mintAmount = new BigNumber(totalLPTValueInUSD)
        .multipliedBy(LTV)
        .dividedBy(SECOND_BASE)
        .toFixed()

      let protocolFee = new BigNumber(mintAmount)
        .multipliedBy(PROTOCOL_FEE)
        .dividedBy(SECOND_BASE)
        .toFixed()
      let stakeFees = new BigNumber(mintAmount)
        .multipliedBy(stakeFee)
        .dividedBy(SECOND_BASE)
        .toFixed()
      let finalMintAmount = new BigNumber(mintAmount)
        .minus(protocolFee)
        .minus(stakeFees)
        .toFixed()

      await ethDaiVault.lock(
        lockAmount,
        signers[0].address,
        finalMintAmount
      )

      expect(await ethDaiVault.debt(signers[0].address)).to.equal(mintAmount)

      // locking for second time

      let lockAmount2 = ethers.utils.parseEther('2.5').toString()

      await ethDaiPair.approve(ethDaiVault.address, lockAmount2)

      let totalLPTValueInUSD2 = new BigNumber(lockAmount2)
        .multipliedBy(lptPrice.toString())
        .dividedBy(BASE)
        .toFixed()
      let mintAmount2 = new BigNumber(totalLPTValueInUSD2)
        .multipliedBy(LTV)
        .dividedBy(SECOND_BASE)
        .toFixed()

      let protocolFee2 = new BigNumber(mintAmount2)
        .multipliedBy(PROTOCOL_FEE)
        .dividedBy(SECOND_BASE)
        .toFixed()
      let stakeFees2 = new BigNumber(mintAmount2)
        .multipliedBy(stakeFee)
        .dividedBy(SECOND_BASE)
        .toFixed()
      let finalMintAmount2 = new BigNumber(mintAmount2)
        .minus(protocolFee2)
        .minus(stakeFees2)
        .toFixed()

      await ethDaiVault.lock(
        lockAmount2,
        signers[0].address,
        finalMintAmount2
      )

      let finalDebt = new BigNumber(mintAmount).plus(mintAmount2).toFixed()

      expect(await ethDaiVault.debt(signers[0].address)).to.equal(finalDebt)
    })
  })

  describe('#burn', async () => {
    beforeEach(async function () {

      await ethDaiVault.changeUTokenMintLimit('200000000000000000000') // 200 UND

      let lockAmount = ethers.utils.parseEther('1').toString()
      await ethDaiPair.approve(ethDaiVault.address, lockAmount)
      await ethDaiVault.lock(lockAmount, signers[0].address, '1')

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

    it('unlock - should decrease uTokenMinted amount on burn', async function () {
      
      expect(await ethDaiVault.uTokenMinted()).to.equal("113137084989847603904")

      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      await ethDaiVault.unlock(debt, collateral)

      let expectedAmount = (new BigNumber("113137084989847603904").minus(debt)).toFixed()

      expect(await ethDaiVault.uTokenMinted()).to.equal(expectedAmount)

    })

    it('unlock - should decrease uTokenMinted amount on burn - 2nd time', async function () {
      
      expect(await ethDaiVault.uTokenMinted()).to.equal("113137084989847603904")

      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      await ethDaiVault.unlock(debt, collateral)

      let expectedAmount = (new BigNumber("113137084989847603904").minus(debt)).toFixed()

      expect(await ethDaiVault.uTokenMinted()).to.equal(expectedAmount) // 56568542494923801952

      let debtUser1 = (await ethDaiVault.debt(signers[1].address)).toString()

      let debtToBePaid = new BigNumber(debtUser1).multipliedBy('0.5').toFixed(0) // 50%

      await ethDaiVault.connect(signers[1]).unlock(debtToBePaid, "1")

      let expectedAmount2 = (new BigNumber(expectedAmount).minus(debtToBePaid)).toFixed()

      expect(await ethDaiVault.uTokenMinted()).to.equal(expectedAmount2) // 28284271247461900976

    })

    it('uTokenMinted should be equal to balance of all users after burn', async function () {
      
      expect(await ethDaiVault.uTokenMinted()).to.equal("113137084989847603904")

      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      await ethDaiVault.unlock(debt, collateral)

      let expectedAmount = (new BigNumber("113137084989847603904").minus(debt)).toFixed()

      expect(await ethDaiVault.uTokenMinted()).to.equal(expectedAmount) // 56568542494923801952

      let balanceUser1 = (await und.balanceOf(signers[0].address)).toString()
      let balanceUser2 = (await und.balanceOf(signers[1].address)).toString()
      let balanceVault = (await und.balanceOf(ethDaiVault.address)).toString()
      let balanceStaking = (await und.balanceOf(undDaiPair)).toString()

      let totalAvailableUND = (new BigNumber(balanceUser1).plus(balanceUser2).plus(balanceVault).plus(balanceStaking)).toFixed()

      expect(await ethDaiVault.uTokenMinted()).to.equal(totalAvailableUND) // 56568542494923801952

    })

    it('unlock - should emit unlock and burn event after repaying all debt', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      let burn = await ethDaiVault.unlock(debt, collateral)

      expect(burn)
        .to.emit(ethDaiVault, 'Unlock')
        .withArgs(signers[0].address, collateral, debt)

      expect(burn)
        .to.emit(und, 'Transfer')
        .withArgs(signers[0].address, zeroAddress, debt)
    })

    it('unlock - should update debt amount to 0 after repaying all debt', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      await ethDaiVault.unlock(debt, collateral)

      expect(await ethDaiVault.debt(signers[0].address)).to.equal('0')
    })

    it('unlock - should burn UND after repaying all debt', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      let undBalanceBeforeU = (
        await und.balanceOf(signers[0].address)
      ).toString()

      await ethDaiVault.unlock(debt, collateral)

      let userExpectedUNDBal = new BigNumber(undBalanceBeforeU)
        .minus(debt)
        .toFixed()

      expect(await und.balanceOf(signers[0].address)).to.equal(
        userExpectedUNDBal
      )
    })

    it('unlock - should emit unlock and burn event after repaying half debt', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      let halfDebt = new BigNumber(debt).dividedBy('2').toFixed()
      let halfCollateral = new BigNumber(collateral).dividedBy('2').toFixed()

      let burn = await ethDaiVault.unlock(halfDebt, halfCollateral)

      expect(burn)
        .to.emit(ethDaiVault, 'Unlock')
        .withArgs(signers[0].address, halfCollateral, halfDebt)

      expect(burn)
        .to.emit(und, 'Transfer')
        .withArgs(signers[0].address, zeroAddress, halfDebt)
    })

    it('unlock - should update debt amount after repaying half debt', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      let halfDebt = new BigNumber(debt).dividedBy('2').toFixed()
      let halfCollateral = new BigNumber(collateral).dividedBy('2').toFixed()

      await ethDaiVault.unlock(halfDebt, halfCollateral)

      let secondHalfDebt = new BigNumber(debt).minus(halfDebt).toFixed()

      expect(await ethDaiVault.debt(signers[0].address)).to.equal(
        secondHalfDebt
      )
    })

    it('unlock - should burn UND after repaying half debt', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      let undBalanceBeforeU = (
        await und.balanceOf(signers[0].address)
      ).toString()

      let halfDebt = new BigNumber(debt).dividedBy('2').toFixed()
      let halfCollateral = new BigNumber(collateral).dividedBy('2').toFixed()

      await ethDaiVault.unlock(halfDebt, halfCollateral)

      let userExpectedUNDBal = new BigNumber(undBalanceBeforeU)
        .minus(halfDebt)
        .toFixed()

      expect(await und.balanceOf(signers[0].address)).to.equal(
        userExpectedUNDBal
      )
    })
  })
})

async function getOraclePriceForLPT(pair, stablecoin, feed) {
  return new Promise(async function (resolve, reject) {
    let maxPercentDiff = '900000000000000000'
    let allowedDelay = 5000

    let isBase0 = false
    let isBase1 = false

    let token0 = await pair.token0()
    let token1 = await pair.token1()

    if (token0.toLowerCase() == stablecoin.toLowerCase()) {
      isBase0 = true
    } else {
      isBase1 = true
    }

    let token0Instance = await ethers.getContractAt('TestEth', token0)
    let token1Instance = await ethers.getContractAt('TestEth', token1)

    let token0Decimals = await token0Instance.decimals()
    let token1Decimals = await token1Instance.decimals()

    let price = await oracleLibrary.latestAnswer(
      pair.address,
      [token0Decimals, token1Decimals],
      [feed],
      [isBase0, isBase1],
      maxPercentDiff,
      allowedDelay
    )
    resolve(price)
  })
}

async function calculateLPTPriceFromUniPool(pair, stablecoin) {
  return new Promise(async function (resolve, reject) {
    let token0 = await pair.token0()

    const totalSupply = (await pair.totalSupply()).toString()
    const reserve = await pair.getReserves()

    let totalPoolValueInDai

    if (token0.toLowerCase() == stablecoin.toLowerCase()) {
      totalPoolValueInDai = new BigNumber(
        reserve._reserve0.toString()
      ).multipliedBy(2)
    } else {
      totalPoolValueInDai = new BigNumber(
        reserve._reserve1.toString()
      ).multipliedBy(2)
    }

    resolve(
      totalPoolValueInDai.multipliedBy(BASE).dividedBy(totalSupply).toFixed()
    )
  })
}
