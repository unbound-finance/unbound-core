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

const ethPrice = '320000000000' // $3200
const daiPrice = '100000000' // $1

const CR = '200000000' // 200%
const LTV = '50000000' // 50%
const PROTOCOL_FEE = '500000' // 0.5%
const stakeFee = '500000' // 0.5%
const safuShare = '40000000' // 40%
const secondBase = '100000000' // 1e8

let accountsPkey = [
  '0x9d297c3cdf8af0abffbf00db443d56a62798d1d562ae19a668ac73eb9052f631',
  '0xbb4a887e10689e6b2574760c2965a3cfc6013062b2d9f71bb6ce5cf08546e61a',
]

describe('UniswapV2Vault', function () {
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
    await ethDaiVault.enableYieldWalletFactory(zeroAddress)

    await vaultFactory.enableVault(ethDaiVault.address)
    await und.addMinter(vaultFactory.address)
    await ethers.provider.send('evm_increaseTime', [604800]) // increase evm time by 7 days
    await und.enableMinter(vaultFactory.address)
  })

  describe('#constructor', async () => {
    it('should set the uToken address', async function () {
      expect(await ethDaiVault.uToken()).to.equal(und.address)
    })

    it('should set the governance address', async function () {
      expect(await ethDaiVault.governance()).to.equal(signers[0].address)
    })

    it('should set the ETH-DAI pair address', async function () {
      expect(await ethDaiVault.pair()).to.equal(ethDaiPair.address)
    })

    it('should set the decimals correctly', async function () {
      let token0 = await ethDaiPair.token0()
      let token1 = await ethDaiPair.token1()

      let token0Instance = await ethers.getContractAt('TestEth', token0)
      let token1Instance = await ethers.getContractAt('TestEth', token1)

      let token0Decimals = await token0Instance.decimals()
      let token1Decimals = await token1Instance.decimals()

      expect(await ethDaiVault.decimals(0)).to.equal(token0Decimals)
      expect(await ethDaiVault.decimals(1)).to.equal(token1Decimals)
    })

    it('should set the isBase correctly', async function () {
      let isBase0 = false
      let isBase1 = false

      let token0 = await ethDaiPair.token0()

      if (token0.toLowerCase() == tDai.address.toLowerCase()) {
        isBase0 = true
      } else {
        isBase1 = true
      }

      expect(await ethDaiVault.isBase(0)).to.equal(isBase0)
      expect(await ethDaiVault.isBase(1)).to.equal(isBase1)
    })

    it('should set the feed address correctly', async function () {
      expect(await ethDaiVault.feeds(0)).to.equal(feedEthUsd.address)
    })

    it('should set the maxPercentDiff correctly', async function () {
      expect(await ethDaiVault.maxPercentDiff()).to.equal('900000000000000000')
    })

    it('should set the allowedDelay correctly', async function () {
      expect(await ethDaiVault.allowedDelay()).to.equal('5000')
    })

    it('should set the staking address correctly', async function () {
      expect(await ethDaiVault.staking()).to.equal(undDaiPair)
    })

    it('should set the factory address correctly', async function () {
      expect(await ethDaiVault.factory()).to.equal(vaultFactory.address)
    })
    it('should revert if utoken address is zero while creating vault', async function () {
      await expect(
        vaultFactory.createVault(
          zeroAddress,
          signers[0].address,
          ethDaiPair.address,
          tDai.address,
          [feedEthUsd.address],
          '900000000000000000', // 10%
          5000,
          undDaiPair
        )
      ).to.be.revertedWith('I')
    })
    it('should revert if pair address is zero while creating vault', async function () {
      await expect(
        vaultFactory.createVault(
          und.address,
          signers[0].address,
          zeroAddress,
          tDai.address,
          [feedEthUsd.address],
          '900000000000000000', // 10%
          5000,
          undDaiPair
        )
      ).to.be.revertedWith('I')
    })
    it('should revert if stablecoin address is zero while creating vault', async function () {
      await expect(
        vaultFactory.createVault(
          und.address,
          signers[0].address,
          ethDaiPair.address,
          zeroAddress,
          [feedEthUsd.address],
          '900000000000000000', // 10%
          5000,
          undDaiPair
        )
      ).to.be.revertedWith('I')
    })

    it('should revert if feeds length is more then 2', async function () {
      await expect(
        vaultFactory.createVault(
          und.address,
          signers[0].address,
          ethDaiPair.address,
          tDai.address,
          [feedEthUsd.address, feedEthUsd.address, feedEthUsd.address],
          '900000000000000000', // 10%
          5000,
          undDaiPair
        )
      ).to.be.revertedWith('IF')
    })
    it('should revert if pair address is not valid', async function () {
        await expect(
          vaultFactory.createVault(
            und.address,
            signers[0].address,
            tEth.address,
            tDai.address,
            [feedEthUsd.address],
            '900000000000000000', // 10%
            5000,
            undDaiPair
          )
        ).to.be.reverted;
      })
  })

  describe('#lockWithPermit', async () => {
    it('should revert if permit expiration is invalid', async function () {
      const { chainId } = await ethers.provider.getNetwork()

      const expiration = 0
      const nonce = (await ethDaiPair.nonces(signers[0].address)).toString()
      const permitAmount = ethers.utils.parseEther('1').toString()

      const msgParams = buildPermitParams(
        chainId,
        ethDaiPair.address,
        signers[0].address,
        ethDaiVault.address,
        nonce,
        permitAmount,
        expiration.toFixed()
      )
      const { v, r, s } = getSignatureFromTypedData(accountsPkey[0], msgParams)

      await expect(
        ethDaiVault
          .connect(signers[0])
          .lockWithPermit(
            permitAmount,
            signers[0].address,
            zeroAddress,
            '100',
            expiration,
            v,
            r,
            s
          )
      ).to.be.revertedWith('UniswapV2: EXPIRED')
    })

    it('should revert if permit signature is invalid', async function () {
      const { chainId } = await ethers.provider.getNetwork()

      const expiration = MAX_UINT_AMOUNT
      const nonce = (await ethDaiPair.nonces(signers[0].address)).toString()
      const permitAmount = ethers.utils.parseEther('1').toString()
      const dummyPermitAmount = ethers.utils.parseEther('2').toString()

      const msgParams = buildPermitParams(
        chainId,
        ethDaiPair.address,
        signers[0].address,
        ethDaiVault.address,
        nonce,
        permitAmount,
        expiration.toString()
      )
      const { v, r, s } = getSignatureFromTypedData(accountsPkey[0], msgParams)

      await expect(
        ethDaiVault
          .connect(signers[0])
          .lockWithPermit(
            dummyPermitAmount,
            signers[0].address,
            zeroAddress,
            '100',
            expiration,
            v,
            r,
            s
          )
      ).to.be.revertedWith('UniswapV2: INVALID_SIGNATURE')
    })

    it("should revert if owner doesn't have sufficient lpt balance", async function () {
      const { chainId } = await ethers.provider.getNetwork()

      let ownerLPTBalance = (
        await ethDaiPair.balanceOf(signers[0].address)
      ).toString()

      const expiration = MAX_UINT_AMOUNT
      const nonce = (await ethDaiPair.nonces(signers[0].address)).toString()
      const permitAmount = new BigNumber(ownerLPTBalance).plus('1').toFixed()

      const msgParams = buildPermitParams(
        chainId,
        ethDaiPair.address,
        signers[0].address,
        ethDaiVault.address,
        nonce,
        permitAmount,
        expiration.toString()
      )
      const { v, r, s } = getSignatureFromTypedData(accountsPkey[0], msgParams)

      await expect(
        ethDaiVault
          .connect(signers[0])
          .lockWithPermit(
            permitAmount,
            signers[0].address,
            zeroAddress,
            '1',
            expiration,
            v,
            r,
            s
          )
      ).to.be.reverted
    })

    it('should revert if mintTo address is zeroAddress', async function () {
      const { chainId } = await ethers.provider.getNetwork()

      const expiration = MAX_UINT_AMOUNT
      const nonce = (await ethDaiPair.nonces(signers[0].address)).toString()
      const permitAmount = ethers.utils.parseEther('1').toString()

      const msgParams = buildPermitParams(
        chainId,
        ethDaiPair.address,
        signers[0].address,
        ethDaiVault.address,
        nonce,
        permitAmount,
        expiration.toString()
      )
      const { v, r, s } = getSignatureFromTypedData(accountsPkey[0], msgParams)

      await expect(
        ethDaiVault
          .connect(signers[0])
          .lockWithPermit(
            permitAmount,
            zeroAddress,
            zeroAddress,
            '1',
            expiration,
            v,
            r,
            s
          )
      ).to.be.revertedWith('NO')
    })

    it('should revert if vault is not valid minter', async function () {
      await vaultFactory.disableVault(ethDaiVault.address)

      const { chainId } = await ethers.provider.getNetwork()

      const expiration = MAX_UINT_AMOUNT
      const nonce = (await ethDaiPair.nonces(signers[0].address)).toString()
      const permitAmount = ethers.utils.parseEther('1').toString()

      const msgParams = buildPermitParams(
        chainId,
        ethDaiPair.address,
        signers[0].address,
        ethDaiVault.address,
        nonce,
        permitAmount,
        expiration.toString()
      )
      const { v, r, s } = getSignatureFromTypedData(accountsPkey[0], msgParams)

      await expect(
        ethDaiVault
          .connect(signers[0])
          .lockWithPermit(
            permitAmount,
            signers[0].address,
            zeroAddress,
            '1',
            expiration,
            v,
            r,
            s
          )
      ).to.be.revertedWith('NA')
    })

    it('should revert farming address is not valid', async function () {
      await ethDaiVault.disableYieldWalletFactory(zeroAddress)

      const { chainId } = await ethers.provider.getNetwork()

      const expiration = MAX_UINT_AMOUNT
      const nonce = (await ethDaiPair.nonces(signers[0].address)).toString()
      const permitAmount = ethers.utils.parseEther('1').toString()

      const msgParams = buildPermitParams(
        chainId,
        ethDaiPair.address,
        signers[0].address,
        ethDaiVault.address,
        nonce,
        permitAmount,
        expiration.toString()
      )
      const { v, r, s } = getSignatureFromTypedData(accountsPkey[0], msgParams)

      await expect(
        ethDaiVault
          .connect(signers[0])
          .lockWithPermit(
            permitAmount,
            signers[0].address,
            zeroAddress,
            '1',
            expiration,
            v,
            r,
            s
          )
      ).to.be.revertedWith('IN')
    })

    it('should revert if LTV is 0', async function () { 

        await ethDaiVault.changeLTV("0")

        const { chainId } = await ethers.provider.getNetwork()
  
        const expiration = MAX_UINT_AMOUNT
        const nonce = (await ethDaiPair.nonces(signers[0].address)).toString()
        const permitAmount = ethers.utils.parseEther('1').toString()
  
        const msgParams = buildPermitParams(
          chainId,
          ethDaiPair.address,
          signers[0].address,
          ethDaiVault.address,
          nonce,
          permitAmount,
          expiration.toString()
        )
        const { v, r, s } = getSignatureFromTypedData(accountsPkey[0], msgParams)
  
        await expect(
          ethDaiVault
            .connect(signers[0])
            .lockWithPermit(
              permitAmount,
              signers[0].address,
              zeroAddress,
              '1',
              expiration,
              v,
              r,
              s
            )
        ).to.be.revertedWith('NI')
      })

    it('should revert if minUTokenAmount is more then minted UND', async function () {
      const { chainId } = await ethers.provider.getNetwork()

      const expiration = MAX_UINT_AMOUNT
      const nonce = (await ethDaiPair.nonces(signers[0].address)).toString()
      const permitAmount = ethers.utils.parseEther('1').toString()

      const msgParams = buildPermitParams(
        chainId,
        ethDaiPair.address,
        signers[0].address,
        ethDaiVault.address,
        nonce,
        permitAmount,
        expiration.toString()
      )
      const { v, r, s } = getSignatureFromTypedData(accountsPkey[0], msgParams)

      // let lptPrice = await getOraclePriceForLPT(
      //     ethDaiPair,
      //     tDai.address,
      //     feedEthUsd.address
      // );

      let lptPrice = await calculateLPTPriceFromUniPool(
        ethDaiPair,
        tDai.address
      )

      let totalLPTValueInUSD = new BigNumber(permitAmount)
        .multipliedBy(lptPrice.toString())
        .dividedBy(BASE)
        .toFixed()
      let mintAmount = new BigNumber(totalLPTValueInUSD)
        .multipliedBy(LTV)
        .dividedBy(secondBase)
        .toFixed()
      let minUTokenAmount = new BigNumber(mintAmount).plus('1').toFixed()

      await expect(
        ethDaiVault
          .connect(signers[0])
          .lockWithPermit(
            permitAmount,
            signers[0].address,
            zeroAddress,
            minUTokenAmount,
            expiration,
            v,
            r,
            s
          )
      ).to.be.revertedWith('MIN')
    })

    it('lockWithPermit 1 LP first - should mint correct amount of UND to user account, staking adress & vault contract', async function () {
      const { chainId } = await ethers.provider.getNetwork()

      const expiration = MAX_UINT_AMOUNT
      const nonce = (await ethDaiPair.nonces(signers[0].address)).toString()
      const permitAmount = ethers.utils.parseEther('1').toString()

      const msgParams = buildPermitParams(
        chainId,
        ethDaiPair.address,
        signers[0].address,
        ethDaiVault.address,
        nonce,
        permitAmount,
        expiration.toString()
      )
      const { v, r, s } = getSignatureFromTypedData(accountsPkey[0], msgParams)

      // let lptPrice = await getOraclePriceForLPT(
      //     ethDaiPair,
      //     tDai.address,
      //     feedEthUsd.address
      // );

      let lptPrice = await calculateLPTPriceFromUniPool(
        ethDaiPair,
        tDai.address
      )

      let totalLPTValueInUSD = new BigNumber(permitAmount)
        .multipliedBy(lptPrice.toString())
        .dividedBy(BASE)
        .toFixed()
      let mintAmount = new BigNumber(totalLPTValueInUSD)
        .multipliedBy(LTV)
        .dividedBy(secondBase)
        .toFixed()

      let protocolFee = new BigNumber(mintAmount)
        .multipliedBy(PROTOCOL_FEE)
        .dividedBy(secondBase)
        .toFixed()
      let stakeFees = new BigNumber(mintAmount)
        .multipliedBy(stakeFee)
        .dividedBy(secondBase)
        .toFixed()
      let finalMintAmount = new BigNumber(mintAmount)
        .minus(protocolFee)
        .minus(stakeFees)
        .toFixed()

      let lock = await ethDaiVault.lockWithPermit(
        permitAmount,
        signers[0].address,
        zeroAddress,
        finalMintAmount,
        expiration,
        v,
        r,
        s
      )

      expect(lock)
        .to.emit(ethDaiVault, 'Lock')
        .withArgs(signers[0].address, permitAmount, finalMintAmount)

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
        .to.emit(ethDaiPair, 'Transfer')
        .withArgs(signers[0].address, ethDaiVault.address, permitAmount)

      expect(await und.balanceOf(ethDaiVault.address)).to.equal(protocolFee)
      expect(await und.balanceOf(undDaiPair)).to.equal(stakeFees)
      expect(await und.balanceOf(signers[0].address)).to.equal(finalMintAmount)
    })

    it('lockWithPermit 1 LP - should transfer LPT from user to vault', async function () {
      let userBalanceBefore = (
        await ethDaiPair.balanceOf(signers[0].address)
      ).toString()
      let vaultBalanceBefore = (
        await ethDaiPair.balanceOf(ethDaiVault.address)
      ).toString()

      const { chainId } = await ethers.provider.getNetwork()

      const expiration = MAX_UINT_AMOUNT
      const nonce = (await ethDaiPair.nonces(signers[0].address)).toString()
      const permitAmount = ethers.utils.parseEther('1').toString()

      const msgParams = buildPermitParams(
        chainId,
        ethDaiPair.address,
        signers[0].address,
        ethDaiVault.address,
        nonce,
        permitAmount,
        expiration.toString()
      )
      const { v, r, s } = getSignatureFromTypedData(accountsPkey[0], msgParams)

      // let lptPrice = await getOraclePriceForLPT(
      //     ethDaiPair,
      //     tDai.address,
      //     feedEthUsd.address
      // );

      let lptPrice = await calculateLPTPriceFromUniPool(
        ethDaiPair,
        tDai.address
      )

      let totalLPTValueInUSD = new BigNumber(permitAmount)
        .multipliedBy(lptPrice.toString())
        .dividedBy(BASE)
        .toFixed()
      let mintAmount = new BigNumber(totalLPTValueInUSD)
        .multipliedBy(LTV)
        .dividedBy(secondBase)
        .toFixed()

      let protocolFee = new BigNumber(mintAmount)
        .multipliedBy(PROTOCOL_FEE)
        .dividedBy(secondBase)
        .toFixed()
      let stakeFees = new BigNumber(mintAmount)
        .multipliedBy(stakeFee)
        .dividedBy(secondBase)
        .toFixed()
      let finalMintAmount = new BigNumber(mintAmount)
        .minus(protocolFee)
        .minus(stakeFees)
        .toFixed()

      await expect(
        ethDaiVault.lockWithPermit(
          permitAmount,
          signers[0].address,
          zeroAddress,
          finalMintAmount,
          expiration,
          v,
          r,
          s
        )
      )
        .to.emit(ethDaiPair, 'Transfer')
        .withArgs(signers[0].address, ethDaiVault.address, permitAmount)

      let userBalanceAfterExpected = new BigNumber(userBalanceBefore)
        .minus(permitAmount)
        .toFixed()
      let vaultBalanceAfterExpected = new BigNumber(vaultBalanceBefore)
        .plus(permitAmount)
        .toFixed()

      expect(await ethDaiPair.balanceOf(signers[0].address)).to.equal(
        userBalanceAfterExpected
      )
      expect(await ethDaiPair.balanceOf(ethDaiVault.address)).to.equal(
        vaultBalanceAfterExpected
      )
    })

    it('lockWithPermit 2.43 LP second - should mint correct amount of UND to user account, staking adress & vault contract', async function () {
      const { chainId } = await ethers.provider.getNetwork()

      const expiration = MAX_UINT_AMOUNT
      const nonce = (await ethDaiPair.nonces(signers[0].address)).toString()
      const permitAmount = ethers.utils.parseEther('2.43').toString()

      const msgParams = buildPermitParams(
        chainId,
        ethDaiPair.address,
        signers[0].address,
        ethDaiVault.address,
        nonce,
        permitAmount,
        expiration.toString()
      )
      const { v, r, s } = getSignatureFromTypedData(accountsPkey[0], msgParams)

      // let lptPrice = await getOraclePriceForLPT(
      //     ethDaiPair,
      //     tDai.address,
      //     feedEthUsd.address
      // );

      let lptPrice = await calculateLPTPriceFromUniPool(
        ethDaiPair,
        tDai.address
      )

      let totalLPTValueInUSD = new BigNumber(permitAmount)
        .multipliedBy(lptPrice.toString())
        .dividedBy(BASE)
        .toFixed()
      let mintAmount = new BigNumber(totalLPTValueInUSD)
        .multipliedBy(LTV)
        .dividedBy(secondBase)
        .toFixed()

      let protocolFee = new BigNumber(mintAmount)
        .multipliedBy(PROTOCOL_FEE)
        .dividedBy(secondBase)
        .toFixed()
      let stakeFees = new BigNumber(mintAmount)
        .multipliedBy(stakeFee)
        .dividedBy(secondBase)
        .toFixed()
      let finalMintAmount = new BigNumber(mintAmount)
        .minus(protocolFee)
        .minus(stakeFees)
        .toFixed()

      let lock = await ethDaiVault.lockWithPermit(
        permitAmount,
        signers[0].address,
        zeroAddress,
        finalMintAmount,
        expiration,
        v,
        r,
        s
      )

      expect(lock)
        .to.emit(ethDaiVault, 'Lock')
        .withArgs(signers[0].address, permitAmount, finalMintAmount)

      expect(lock)
        .to.emit(und, 'Transfer')
        .withArgs(zeroAddress, ethDaiVault.address, protocolFee)
      expect(lock)
        .to.emit(und, 'Transfer')
        .withArgs(zeroAddress, undDaiPair, stakeFees)
      expect(lock)
        .to.emit(und, 'Transfer')
        .withArgs(zeroAddress, signers[0].address, finalMintAmount)

      expect(await und.balanceOf(ethDaiVault.address)).to.equal(protocolFee)
      expect(await und.balanceOf(undDaiPair)).to.equal(stakeFees)
      expect(await und.balanceOf(signers[0].address)).to.equal(finalMintAmount)
    })

    it('should store correct amount of collateral and debt amount', async function () {
      const { chainId } = await ethers.provider.getNetwork()

      const expiration = MAX_UINT_AMOUNT
      const nonce = (await ethDaiPair.nonces(signers[0].address)).toString()
      const permitAmount = ethers.utils.parseEther('1').toString()

      const msgParams = buildPermitParams(
        chainId,
        ethDaiPair.address,
        signers[0].address,
        ethDaiVault.address,
        nonce,
        permitAmount,
        expiration.toString()
      )
      const { v, r, s } = getSignatureFromTypedData(accountsPkey[0], msgParams)

      // let lptPrice = await getOraclePriceForLPT(
      //     ethDaiPair,
      //     tDai.address,
      //     feedEthUsd.address
      // );

      let lptPrice = await calculateLPTPriceFromUniPool(
        ethDaiPair,
        tDai.address
      )

      let totalLPTValueInUSD = new BigNumber(permitAmount)
        .multipliedBy(lptPrice.toString())
        .dividedBy(BASE)
        .toFixed()
      let mintAmount = new BigNumber(totalLPTValueInUSD)
        .multipliedBy(LTV)
        .dividedBy(secondBase)
        .toFixed()

      let protocolFee = new BigNumber(mintAmount)
        .multipliedBy(PROTOCOL_FEE)
        .dividedBy(secondBase)
        .toFixed()
      let stakeFees = new BigNumber(mintAmount)
        .multipliedBy(stakeFee)
        .dividedBy(secondBase)
        .toFixed()
      let finalMintAmount = new BigNumber(mintAmount)
        .minus(protocolFee)
        .minus(stakeFees)
        .toFixed()

      await ethDaiVault.lockWithPermit(
        permitAmount,
        signers[0].address,
        zeroAddress,
        finalMintAmount,
        expiration,
        v,
        r,
        s
      )

      expect(await ethDaiVault.collateral(signers[0].address)).to.equal(
        permitAmount
      )
      expect(await ethDaiVault.debt(signers[0].address)).to.equal(mintAmount)
    })

    it('should increase collateral and debt amount when locking for second time(same amount) without paying first debt', async function () {
      const { chainId } = await ethers.provider.getNetwork()

      const expiration = MAX_UINT_AMOUNT
      const nonce = (await ethDaiPair.nonces(signers[0].address)).toString()
      const permitAmount = ethers.utils.parseEther('1').toString()

      const msgParams = buildPermitParams(
        chainId,
        ethDaiPair.address,
        signers[0].address,
        ethDaiVault.address,
        nonce,
        permitAmount,
        expiration.toString()
      )
      const { v, r, s } = getSignatureFromTypedData(accountsPkey[0], msgParams)

      // let lptPrice = await getOraclePriceForLPT(
      //     ethDaiPair,
      //     tDai.address,
      //     feedEthUsd.address
      // );

      let lptPrice = await calculateLPTPriceFromUniPool(
        ethDaiPair,
        tDai.address
      )

      let totalLPTValueInUSD = new BigNumber(permitAmount)
        .multipliedBy(lptPrice.toString())
        .dividedBy(BASE)
        .toFixed()
      let mintAmount = new BigNumber(totalLPTValueInUSD)
        .multipliedBy(LTV)
        .dividedBy(secondBase)
        .toFixed()

      let protocolFee = new BigNumber(mintAmount)
        .multipliedBy(PROTOCOL_FEE)
        .dividedBy(secondBase)
        .toFixed()
      let stakeFees = new BigNumber(mintAmount)
        .multipliedBy(stakeFee)
        .dividedBy(secondBase)
        .toFixed()
      let finalMintAmount = new BigNumber(mintAmount)
        .minus(protocolFee)
        .minus(stakeFees)
        .toFixed()

      await ethDaiVault.lockWithPermit(
        permitAmount,
        signers[0].address,
        zeroAddress,
        finalMintAmount,
        expiration,
        v,
        r,
        s
      )

      expect(await ethDaiVault.collateral(signers[0].address)).to.equal(
        permitAmount
      )
      expect(await ethDaiVault.debt(signers[0].address)).to.equal(mintAmount)

      // locking for second time

      const nonce2 = (await ethDaiPair.nonces(signers[0].address)).toString()

      const msgParams2 = buildPermitParams(
        chainId,
        ethDaiPair.address,
        signers[0].address,
        ethDaiVault.address,
        nonce2,
        permitAmount,
        expiration.toString()
      )

      const {
        v: v2,
        r: r2,
        s: s2,
      } = getSignatureFromTypedData(accountsPkey[0], msgParams2)

      await ethDaiVault.lockWithPermit(
        permitAmount,
        signers[0].address,
        zeroAddress,
        finalMintAmount,
        expiration,
        v2,
        r2,
        s2
      )

      let finalCollateral = new BigNumber(permitAmount)
        .plus(permitAmount)
        .toFixed()
      let finalDebt = new BigNumber(mintAmount).plus(mintAmount).toFixed()

      expect(await ethDaiVault.collateral(signers[0].address)).to.equal(
        finalCollateral
      )
      expect(await ethDaiVault.debt(signers[0].address)).to.equal(finalDebt)
    })

    it('should increase collateral and debt amount when locking for second time(different amount) without paying first debt', async function () {
      const { chainId } = await ethers.provider.getNetwork()

      const expiration = MAX_UINT_AMOUNT
      const nonce = (await ethDaiPair.nonces(signers[0].address)).toString()
      const permitAmount = ethers.utils.parseEther('1').toString()

      const msgParams = buildPermitParams(
        chainId,
        ethDaiPair.address,
        signers[0].address,
        ethDaiVault.address,
        nonce,
        permitAmount,
        expiration.toString()
      )
      const { v, r, s } = getSignatureFromTypedData(accountsPkey[0], msgParams)

      // let lptPrice = await getOraclePriceForLPT(
      //     ethDaiPair,
      //     tDai.address,
      //     feedEthUsd.address
      // );

      let lptPrice = await calculateLPTPriceFromUniPool(
        ethDaiPair,
        tDai.address
      )

      let totalLPTValueInUSD = new BigNumber(permitAmount)
        .multipliedBy(lptPrice.toString())
        .dividedBy(BASE)
        .toFixed()
      let mintAmount = new BigNumber(totalLPTValueInUSD)
        .multipliedBy(LTV)
        .dividedBy(secondBase)
        .toFixed()

      let protocolFee = new BigNumber(mintAmount)
        .multipliedBy(PROTOCOL_FEE)
        .dividedBy(secondBase)
        .toFixed()
      let stakeFees = new BigNumber(mintAmount)
        .multipliedBy(stakeFee)
        .dividedBy(secondBase)
        .toFixed()
      let finalMintAmount = new BigNumber(mintAmount)
        .minus(protocolFee)
        .minus(stakeFees)
        .toFixed()

      await ethDaiVault.lockWithPermit(
        permitAmount,
        signers[0].address,
        zeroAddress,
        finalMintAmount,
        expiration,
        v,
        r,
        s
      )

      expect(await ethDaiVault.collateral(signers[0].address)).to.equal(
        permitAmount
      )
      expect(await ethDaiVault.debt(signers[0].address)).to.equal(mintAmount)

      // locking for second time

      const nonce2 = (await ethDaiPair.nonces(signers[0].address)).toString()
      const permitAmount2 = ethers.utils.parseEther('5.65').toString()

      const msgParams2 = buildPermitParams(
        chainId,
        ethDaiPair.address,
        signers[0].address,
        ethDaiVault.address,
        nonce2,
        permitAmount2,
        expiration.toString()
      )

      const {
        v: v2,
        r: r2,
        s: s2,
      } = getSignatureFromTypedData(accountsPkey[0], msgParams2)

      let totalLPTValueInUSD2 = new BigNumber(permitAmount2)
        .multipliedBy(lptPrice.toString())
        .dividedBy(BASE)
        .toFixed()
      let mintAmount2 = new BigNumber(totalLPTValueInUSD2)
        .multipliedBy(LTV)
        .dividedBy(secondBase)
        .toFixed()

      let protocolFee2 = new BigNumber(mintAmount2)
        .multipliedBy(PROTOCOL_FEE)
        .dividedBy(secondBase)
        .toFixed()
      let stakeFees2 = new BigNumber(mintAmount2)
        .multipliedBy(stakeFee)
        .dividedBy(secondBase)
        .toFixed()
      let finalMintAmount2 = new BigNumber(mintAmount2)
        .minus(protocolFee2)
        .minus(stakeFees2)
        .toFixed()

      await ethDaiVault.lockWithPermit(
        permitAmount2,
        signers[0].address,
        zeroAddress,
        finalMintAmount2,
        expiration,
        v2,
        r2,
        s2
      )

      let finalCollateral = new BigNumber(permitAmount)
        .plus(permitAmount2)
        .toFixed()
      let finalDebt = new BigNumber(mintAmount).plus(mintAmount2).toFixed()

      expect(await ethDaiVault.collateral(signers[0].address)).to.equal(
        finalCollateral
      )
      expect(await ethDaiVault.debt(signers[0].address)).to.equal(finalDebt)
    })
  })

  describe('#lock', async () => {
    it("should revert if owner doesn't have sufficient lpt balance", async function () {
      let ownerLPTBalance = (
        await ethDaiPair.balanceOf(signers[0].address)
      ).toString()

      let lockAmount = new BigNumber(ownerLPTBalance).plus('1').toFixed()

      await expect(
        ethDaiVault.lock(lockAmount, signers[0].address, zeroAddress, '1')
      ).to.be.reverted
    })

    it('should revert if mintTo address is zeroAddress', async function () {
      let lockAmount = ethers.utils.parseEther('1').toString()

      await ethDaiPair.approve(ethDaiVault.address, lockAmount)

      await expect(
        ethDaiVault.lock(lockAmount, zeroAddress, zeroAddress, '1')
      ).to.be.revertedWith('NO')
    })

    it('should revert if vault is not valid minter', async function () {
      await vaultFactory.disableVault(ethDaiVault.address)

      let lockAmount = ethers.utils.parseEther('1').toString()

      await ethDaiPair.approve(ethDaiVault.address, lockAmount)

      await expect(
        ethDaiVault.lock(lockAmount, signers[0].address, zeroAddress, '1')
      ).to.be.revertedWith('NA')
    })

    it('should revert if farming wallet is not valid', async function () {
      await ethDaiVault.disableYieldWalletFactory(zeroAddress)

      let lockAmount = ethers.utils.parseEther('1').toString()

      await ethDaiPair.approve(ethDaiVault.address, lockAmount)

      await expect(
        ethDaiVault.lock(lockAmount, signers[0].address, zeroAddress, '1')
      ).to.be.revertedWith('IN')
    })

    it('should revert if LTV is zero', async function () {
        await ethDaiVault.changeLTV("0")
  
        let lockAmount = ethers.utils.parseEther('1').toString()
  
        await ethDaiPair.approve(ethDaiVault.address, lockAmount)
  
        await expect(
          ethDaiVault.lock(lockAmount, signers[0].address, zeroAddress, '1')
        ).to.be.revertedWith('NI')
    })

    it('should revert if minUTokenAmount is more then minted UND ', async function () {
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
        .dividedBy(secondBase)
        .toFixed()
      let minUTokenAmount = new BigNumber(mintAmount).plus('1').toFixed()

      await expect(
        ethDaiVault
          .connect(signers[0])
          .lock(lockAmount, signers[0].address, zeroAddress, minUTokenAmount)
      ).to.be.revertedWith('MIN')
    })

    it('lock 1 LP first - should mint correct amount of UND to user account, staking adress & vault contract', async function () {
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
        .dividedBy(secondBase)
        .toFixed()

      let protocolFee = new BigNumber(mintAmount)
        .multipliedBy(PROTOCOL_FEE)
        .dividedBy(secondBase)
        .toFixed()
      let stakeFees = new BigNumber(mintAmount)
        .multipliedBy(stakeFee)
        .dividedBy(secondBase)
        .toFixed()
      let finalMintAmount = new BigNumber(mintAmount)
        .minus(protocolFee)
        .minus(stakeFees)
        .toFixed()

      let lock = await ethDaiVault.lock(
        lockAmount,
        signers[0].address,
        zeroAddress,
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

    it('lock 8.65 LP first - should mint correct amount of UND to user account, staking adress & vault contract', async function () {
      let lockAmount = ethers.utils.parseEther('8.65').toString()

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
        .dividedBy(secondBase)
        .toFixed()

      let protocolFee = new BigNumber(mintAmount)
        .multipliedBy(PROTOCOL_FEE)
        .dividedBy(secondBase)
        .toFixed()
      let stakeFees = new BigNumber(mintAmount)
        .multipliedBy(stakeFee)
        .dividedBy(secondBase)
        .toFixed()
      let finalMintAmount = new BigNumber(mintAmount)
        .minus(protocolFee)
        .minus(stakeFees)
        .toFixed()

      let lock = await ethDaiVault.lock(
        lockAmount,
        signers[0].address,
        zeroAddress,
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

    it('should store correct amount of collateral and debt amount', async function () {
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
        .dividedBy(secondBase)
        .toFixed()

      let protocolFee = new BigNumber(mintAmount)
        .multipliedBy(PROTOCOL_FEE)
        .dividedBy(secondBase)
        .toFixed()
      let stakeFees = new BigNumber(mintAmount)
        .multipliedBy(stakeFee)
        .dividedBy(secondBase)
        .toFixed()
      let finalMintAmount = new BigNumber(mintAmount)
        .minus(protocolFee)
        .minus(stakeFees)
        .toFixed()

      await ethDaiVault.lock(
        lockAmount,
        signers[0].address,
        zeroAddress,
        finalMintAmount
      )

      expect(await ethDaiVault.collateral(signers[0].address)).to.equal(
        lockAmount
      )
      expect(await ethDaiVault.debt(signers[0].address)).to.equal(mintAmount)
    })

    it('should increase collateral and debt amount when locking for second time(same amount) without paying first debt', async function () {
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
        .dividedBy(secondBase)
        .toFixed()

      let protocolFee = new BigNumber(mintAmount)
        .multipliedBy(PROTOCOL_FEE)
        .dividedBy(secondBase)
        .toFixed()
      let stakeFees = new BigNumber(mintAmount)
        .multipliedBy(stakeFee)
        .dividedBy(secondBase)
        .toFixed()
      let finalMintAmount = new BigNumber(mintAmount)
        .minus(protocolFee)
        .minus(stakeFees)
        .toFixed()

      await ethDaiVault.lock(
        lockAmount,
        signers[0].address,
        zeroAddress,
        finalMintAmount
      )

      expect(await ethDaiVault.collateral(signers[0].address)).to.equal(
        lockAmount
      )
      expect(await ethDaiVault.debt(signers[0].address)).to.equal(mintAmount)

      // locking for second time

      await ethDaiPair.approve(ethDaiVault.address, lockAmount)

      await ethDaiVault.lock(
        lockAmount,
        signers[0].address,
        zeroAddress,
        finalMintAmount
      )

      let finalCollateral = new BigNumber(lockAmount).plus(lockAmount).toFixed()
      let finalDebt = new BigNumber(mintAmount).plus(mintAmount).toFixed()

      expect(await ethDaiVault.collateral(signers[0].address)).to.equal(
        finalCollateral
      )
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
        .dividedBy(secondBase)
        .toFixed()

      let protocolFee = new BigNumber(mintAmount)
        .multipliedBy(PROTOCOL_FEE)
        .dividedBy(secondBase)
        .toFixed()
      let stakeFees = new BigNumber(mintAmount)
        .multipliedBy(stakeFee)
        .dividedBy(secondBase)
        .toFixed()
      let finalMintAmount = new BigNumber(mintAmount)
        .minus(protocolFee)
        .minus(stakeFees)
        .toFixed()

      await ethDaiVault.lock(
        lockAmount,
        signers[0].address,
        zeroAddress,
        finalMintAmount
      )

      expect(await ethDaiVault.collateral(signers[0].address)).to.equal(
        lockAmount
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
        .dividedBy(secondBase)
        .toFixed()

      let protocolFee2 = new BigNumber(mintAmount2)
        .multipliedBy(PROTOCOL_FEE)
        .dividedBy(secondBase)
        .toFixed()
      let stakeFees2 = new BigNumber(mintAmount2)
        .multipliedBy(stakeFee)
        .dividedBy(secondBase)
        .toFixed()
      let finalMintAmount2 = new BigNumber(mintAmount2)
        .minus(protocolFee2)
        .minus(stakeFees2)
        .toFixed()

      await ethDaiVault.lock(
        lockAmount2,
        signers[0].address,
        zeroAddress,
        finalMintAmount2
      )

      let finalCollateral = new BigNumber(lockAmount)
        .plus(lockAmount2)
        .toFixed()
      let finalDebt = new BigNumber(mintAmount).plus(mintAmount2).toFixed()

      expect(await ethDaiVault.collateral(signers[0].address)).to.equal(
        finalCollateral
      )
      expect(await ethDaiVault.debt(signers[0].address)).to.equal(finalDebt)
    })
  })

  describe('#unlock', async () => {
    beforeEach(async function () {
      let lockAmount = ethers.utils.parseEther('1').toString()
      await ethDaiPair.approve(ethDaiVault.address, lockAmount)
      await ethDaiVault.lock(lockAmount, signers[0].address, zeroAddress, '1')

      // Transfer some extra und to user 0 to repay all debts
      await ethDaiPair.transfer(signers[1].address, lockAmount)
      await ethDaiPair
        .connect(signers[1])
        .approve(ethDaiVault.address, lockAmount)
      await ethDaiVault
        .connect(signers[1])
        .lock(lockAmount, signers[1].address, zeroAddress, '1')
      await und.connect(signers[1]).transfer(signers[0].address, lockAmount)
    })

    it('should revert if uTokenAmount burn amount is more then debt', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let expectedMintAmount = new BigNumber(debt).plus('1').toFixed()

      await expect(
        ethDaiVault.unlock(expectedMintAmount, '1')
      ).to.be.revertedWith('BAL')
    })

    it('should revert if CR is 0', async function () {
        await ethDaiVault.changeCR("0");

        await expect(
          ethDaiVault.unlock("1", '1')
        ).to.be.revertedWith('NI')
      })

    it('should revert if minCollateral amount is less then received amount', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      let expectedLPTAmount = new BigNumber(collateral).plus('1').toFixed()

      await expect(
        ethDaiVault.unlock(debt, expectedLPTAmount)
      ).to.be.revertedWith('MIN')
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

    it('unlock - should update debt and collateral to 0 after repaying all debt', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      await ethDaiVault.unlock(debt, collateral)

      expect(await ethDaiVault.debt(signers[0].address)).to.equal('0')
      expect(await ethDaiVault.collateral(signers[0].address)).to.equal('0')
    })

    it('unlock - should burn UND and transfer LPT back to user after repaying all debt', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      let undBalanceBeforeU = (
        await und.balanceOf(signers[0].address)
      ).toString()
      let lptBalanceBeforeU = (
        await ethDaiPair.balanceOf(signers[0].address)
      ).toString()

      let lptBalanceBeforeV = (
        await ethDaiPair.balanceOf(ethDaiVault.address)
      ).toString()

      await ethDaiVault.unlock(debt, collateral)

      let userExpectedUNDBal = new BigNumber(undBalanceBeforeU)
        .minus(debt)
        .toFixed()
      let userExpectedLPTBal = new BigNumber(lptBalanceBeforeU)
        .plus(collateral)
        .toFixed()
      let vaultExpectedLPTBal = new BigNumber(lptBalanceBeforeV)
        .minus(collateral)
        .toFixed()

      expect(await und.balanceOf(signers[0].address)).to.equal(
        userExpectedUNDBal
      )
      expect(await ethDaiPair.balanceOf(signers[0].address)).to.equal(
        userExpectedLPTBal
      )
      expect(await ethDaiPair.balanceOf(ethDaiVault.address)).to.equal(
        vaultExpectedLPTBal
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

    it('unlock - should update debt and collateral after repaying half debt', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      let halfDebt = new BigNumber(debt).dividedBy('2').toFixed()
      let halfCollateral = new BigNumber(collateral).dividedBy('2').toFixed()

      await ethDaiVault.unlock(halfDebt, halfCollateral)

      let secondHalfDebt = new BigNumber(debt).minus(halfDebt).toFixed()
      let secondHalfCollateral = new BigNumber(collateral)
        .minus(halfCollateral)
        .toFixed()

      expect(await ethDaiVault.debt(signers[0].address)).to.equal(
        secondHalfDebt
      )
      expect(await ethDaiVault.collateral(signers[0].address)).to.equal(
        secondHalfCollateral
      )
    })

    it('unlock - should burn UND and transfer LPT back to user after repaying half debt', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      let undBalanceBeforeU = (
        await und.balanceOf(signers[0].address)
      ).toString()
      let lptBalanceBeforeU = (
        await ethDaiPair.balanceOf(signers[0].address)
      ).toString()

      let lptBalanceBeforeV = (
        await ethDaiPair.balanceOf(ethDaiVault.address)
      ).toString()

      let halfDebt = new BigNumber(debt).dividedBy('2').toFixed()
      let halfCollateral = new BigNumber(collateral).dividedBy('2').toFixed()

      await ethDaiVault.unlock(halfDebt, halfCollateral)

      let userExpectedUNDBal = new BigNumber(undBalanceBeforeU)
        .minus(halfDebt)
        .toFixed()
      let userExpectedLPTBal = new BigNumber(lptBalanceBeforeU)
        .plus(halfCollateral)
        .toFixed()
      let vaultExpectedLPTBal = new BigNumber(lptBalanceBeforeV)
        .minus(halfCollateral)
        .toFixed()

      expect(await und.balanceOf(signers[0].address)).to.equal(
        userExpectedUNDBal
      )
      expect(await ethDaiPair.balanceOf(signers[0].address)).to.equal(
        userExpectedLPTBal
      )
      expect(await ethDaiPair.balanceOf(ethDaiVault.address)).to.equal(
        vaultExpectedLPTBal
      )
    })

    it('unlock - should update everything properly after repaying 10% debt', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      let undBalanceBeforeU = (
        await und.balanceOf(signers[0].address)
      ).toString()
      let lptBalanceBeforeU = (
        await ethDaiPair.balanceOf(signers[0].address)
      ).toString()

      let lptBalanceBeforeV = (
        await ethDaiPair.balanceOf(ethDaiVault.address)
      ).toString()

      let debtToBePaid = new BigNumber(debt).multipliedBy('0.1').toFixed(0) // 10%
      let collateralToBeReceived = new BigNumber(collateral)
        .multipliedBy(debtToBePaid)
        .dividedBy(debt)
        .toFixed() // 10%

      let burn = await ethDaiVault.unlock(debtToBePaid, collateralToBeReceived)

      expect(burn)
        .to.emit(ethDaiVault, 'Unlock')
        .withArgs(signers[0].address, collateralToBeReceived, debtToBePaid)

      expect(burn)
        .to.emit(und, 'Transfer')
        .withArgs(signers[0].address, zeroAddress, debtToBePaid)

      let userExpectedUNDBal = new BigNumber(undBalanceBeforeU)
        .minus(debtToBePaid)
        .toFixed()
      let userExpectedLPTBal = new BigNumber(lptBalanceBeforeU)
        .plus(collateralToBeReceived)
        .toFixed()
      let vaultExpectedLPTBal = new BigNumber(lptBalanceBeforeV)
        .minus(collateralToBeReceived)
        .toFixed()

      expect(await und.balanceOf(signers[0].address)).to.equal(
        userExpectedUNDBal
      )
      expect(await ethDaiPair.balanceOf(signers[0].address)).to.equal(
        userExpectedLPTBal
      )
      expect(await ethDaiPair.balanceOf(ethDaiVault.address)).to.equal(
        vaultExpectedLPTBal
      )

      let secondHalfDebt = new BigNumber(debt).minus(debtToBePaid).toFixed()
      let secondHalfCollateral = new BigNumber(collateral)
        .minus(collateralToBeReceived)
        .toFixed()

      expect(await ethDaiVault.debt(signers[0].address)).to.equal(
        secondHalfDebt
      )
      expect(await ethDaiVault.collateral(signers[0].address)).to.equal(
        secondHalfCollateral
      )
    })

    it('unlock - should update everything properly after repaying 25% debt', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      let undBalanceBeforeU = (
        await und.balanceOf(signers[0].address)
      ).toString()
      let lptBalanceBeforeU = (
        await ethDaiPair.balanceOf(signers[0].address)
      ).toString()

      let lptBalanceBeforeV = (
        await ethDaiPair.balanceOf(ethDaiVault.address)
      ).toString()

      let debtToBePaid = new BigNumber(debt).multipliedBy('0.25').toFixed(0) // 25%
      let collateralToBeReceived = new BigNumber(collateral)
        .multipliedBy(debtToBePaid)
        .dividedBy(debt)
        .toFixed() // 10%

      let burn = await ethDaiVault.unlock(debtToBePaid, collateralToBeReceived)

      expect(burn)
        .to.emit(ethDaiVault, 'Unlock')
        .withArgs(signers[0].address, collateralToBeReceived, debtToBePaid)

      expect(burn)
        .to.emit(und, 'Transfer')
        .withArgs(signers[0].address, zeroAddress, debtToBePaid)

      let userExpectedUNDBal = new BigNumber(undBalanceBeforeU)
        .minus(debtToBePaid)
        .toFixed()
      let userExpectedLPTBal = new BigNumber(lptBalanceBeforeU)
        .plus(collateralToBeReceived)
        .toFixed()
      let vaultExpectedLPTBal = new BigNumber(lptBalanceBeforeV)
        .minus(collateralToBeReceived)
        .toFixed()

      expect(await und.balanceOf(signers[0].address)).to.equal(
        userExpectedUNDBal
      )
      expect(await ethDaiPair.balanceOf(signers[0].address)).to.equal(
        userExpectedLPTBal
      )
      expect(await ethDaiPair.balanceOf(ethDaiVault.address)).to.equal(
        vaultExpectedLPTBal
      )

      let secondHalfDebt = new BigNumber(debt).minus(debtToBePaid).toFixed()
      let secondHalfCollateral = new BigNumber(collateral)
        .minus(collateralToBeReceived)
        .toFixed()

      expect(await ethDaiVault.debt(signers[0].address)).to.equal(
        secondHalfDebt
      )
      expect(await ethDaiVault.collateral(signers[0].address)).to.equal(
        secondHalfCollateral
      )
    })

    it('unlock - should update everything properly after repaying 47% debt', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      let undBalanceBeforeU = (
        await und.balanceOf(signers[0].address)
      ).toString()
      let lptBalanceBeforeU = (
        await ethDaiPair.balanceOf(signers[0].address)
      ).toString()

      let lptBalanceBeforeV = (
        await ethDaiPair.balanceOf(ethDaiVault.address)
      ).toString()

      let debtToBePaid = new BigNumber(debt).multipliedBy('0.47').toFixed(0) // 47%
      let collateralToBeReceived = new BigNumber(collateral)
        .multipliedBy(debtToBePaid)
        .dividedBy(debt)
        .toFixed() // 10%

      let burn = await ethDaiVault.unlock(debtToBePaid, collateralToBeReceived)

      expect(burn)
        .to.emit(ethDaiVault, 'Unlock')
        .withArgs(signers[0].address, collateralToBeReceived, debtToBePaid)

      expect(burn)
        .to.emit(und, 'Transfer')
        .withArgs(signers[0].address, zeroAddress, debtToBePaid)

      let userExpectedUNDBal = new BigNumber(undBalanceBeforeU)
        .minus(debtToBePaid)
        .toFixed()
      let userExpectedLPTBal = new BigNumber(lptBalanceBeforeU)
        .plus(collateralToBeReceived)
        .toFixed()
      let vaultExpectedLPTBal = new BigNumber(lptBalanceBeforeV)
        .minus(collateralToBeReceived)
        .toFixed()

      expect(await und.balanceOf(signers[0].address)).to.equal(
        userExpectedUNDBal
      )
      expect(await ethDaiPair.balanceOf(signers[0].address)).to.equal(
        userExpectedLPTBal
      )
      expect(await ethDaiPair.balanceOf(ethDaiVault.address)).to.equal(
        vaultExpectedLPTBal
      )

      let secondHalfDebt = new BigNumber(debt).minus(debtToBePaid).toFixed()
      let secondHalfCollateral = new BigNumber(collateral)
        .minus(collateralToBeReceived)
        .toFixed()

      expect(await ethDaiVault.debt(signers[0].address)).to.equal(
        secondHalfDebt
      )
      expect(await ethDaiVault.collateral(signers[0].address)).to.equal(
        secondHalfCollateral
      )
    })

    it('unlock - should update everything properly after repaying 82% debt', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      let undBalanceBeforeU = (
        await und.balanceOf(signers[0].address)
      ).toString()
      let lptBalanceBeforeU = (
        await ethDaiPair.balanceOf(signers[0].address)
      ).toString()

      let lptBalanceBeforeV = (
        await ethDaiPair.balanceOf(ethDaiVault.address)
      ).toString()

      let debtToBePaid = new BigNumber(debt).multipliedBy('0.82').toFixed(0) // 82%
      let collateralToBeReceived = new BigNumber(collateral)
        .multipliedBy(debtToBePaid)
        .dividedBy(debt)
        .toFixed() // 10%

      let burn = await ethDaiVault.unlock(debtToBePaid, collateralToBeReceived)

      expect(burn)
        .to.emit(ethDaiVault, 'Unlock')
        .withArgs(signers[0].address, collateralToBeReceived, debtToBePaid)

      expect(burn)
        .to.emit(und, 'Transfer')
        .withArgs(signers[0].address, zeroAddress, debtToBePaid)

      let userExpectedUNDBal = new BigNumber(undBalanceBeforeU)
        .minus(debtToBePaid)
        .toFixed()
      let userExpectedLPTBal = new BigNumber(lptBalanceBeforeU)
        .plus(collateralToBeReceived)
        .toFixed()
      let vaultExpectedLPTBal = new BigNumber(lptBalanceBeforeV)
        .minus(collateralToBeReceived)
        .toFixed()

      expect(await und.balanceOf(signers[0].address)).to.equal(
        userExpectedUNDBal
      )
      expect(await ethDaiPair.balanceOf(signers[0].address)).to.equal(
        userExpectedLPTBal
      )
      expect(await ethDaiPair.balanceOf(ethDaiVault.address)).to.equal(
        vaultExpectedLPTBal
      )

      let secondHalfDebt = new BigNumber(debt).minus(debtToBePaid).toFixed()
      let secondHalfCollateral = new BigNumber(collateral)
        .minus(collateralToBeReceived)
        .toFixed()

      expect(await ethDaiVault.debt(signers[0].address)).to.equal(
        secondHalfDebt
      )
      expect(await ethDaiVault.collateral(signers[0].address)).to.equal(
        secondHalfCollateral
      )
    })

    it('unlock - should update everything properly after repaying 93% debt', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      let undBalanceBeforeU = (
        await und.balanceOf(signers[0].address)
      ).toString()
      let lptBalanceBeforeU = (
        await ethDaiPair.balanceOf(signers[0].address)
      ).toString()

      let lptBalanceBeforeV = (
        await ethDaiPair.balanceOf(ethDaiVault.address)
      ).toString()

      let debtToBePaid = new BigNumber(debt).multipliedBy('0.93').toFixed(0) // 93%
      let collateralToBeReceived = new BigNumber(collateral)
        .multipliedBy(debtToBePaid)
        .dividedBy(debt)
        .toFixed() // 10%

      let burn = await ethDaiVault.unlock(debtToBePaid, collateralToBeReceived)

      expect(burn)
        .to.emit(ethDaiVault, 'Unlock')
        .withArgs(signers[0].address, collateralToBeReceived, debtToBePaid)

      expect(burn)
        .to.emit(und, 'Transfer')
        .withArgs(signers[0].address, zeroAddress, debtToBePaid)

      let userExpectedUNDBal = new BigNumber(undBalanceBeforeU)
        .minus(debtToBePaid)
        .toFixed()
      let userExpectedLPTBal = new BigNumber(lptBalanceBeforeU)
        .plus(collateralToBeReceived)
        .toFixed()
      let vaultExpectedLPTBal = new BigNumber(lptBalanceBeforeV)
        .minus(collateralToBeReceived)
        .toFixed()

      expect(await und.balanceOf(signers[0].address)).to.equal(
        userExpectedUNDBal
      )
      expect(await ethDaiPair.balanceOf(signers[0].address)).to.equal(
        userExpectedLPTBal
      )
      expect(await ethDaiPair.balanceOf(ethDaiVault.address)).to.equal(
        vaultExpectedLPTBal
      )

      let secondHalfDebt = new BigNumber(debt).minus(debtToBePaid).toFixed()
      let secondHalfCollateral = new BigNumber(collateral)
        .minus(collateralToBeReceived)
        .toFixed()

      expect(await ethDaiVault.debt(signers[0].address)).to.equal(
        secondHalfDebt
      )
      expect(await ethDaiVault.collateral(signers[0].address)).to.equal(
        secondHalfCollateral
      )
    })

    it('unlock - repaying all debt in two parts - first 35% and then 65%', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      let undBalanceBeforeU = (
        await und.balanceOf(signers[0].address)
      ).toString()
      let lptBalanceBeforeU = (
        await ethDaiPair.balanceOf(signers[0].address)
      ).toString()

      let lptBalanceBeforeV = (
        await ethDaiPair.balanceOf(ethDaiVault.address)
      ).toString()

      let debtToBePaid = new BigNumber(debt).multipliedBy('0.35').toFixed(0) // 35%
      let collateralToBeReceived = new BigNumber(collateral)
        .multipliedBy(debtToBePaid)
        .dividedBy(debt)
        .toFixed() // 10%

      let burn = await ethDaiVault.unlock(debtToBePaid, collateralToBeReceived)

      expect(burn)
        .to.emit(ethDaiVault, 'Unlock')
        .withArgs(signers[0].address, collateralToBeReceived, debtToBePaid)
      expect(burn)
        .to.emit(und, 'Transfer')
        .withArgs(signers[0].address, zeroAddress, debtToBePaid)

      let userExpectedUNDBal = new BigNumber(undBalanceBeforeU)
        .minus(debtToBePaid)
        .toFixed()
      let userExpectedLPTBal = new BigNumber(lptBalanceBeforeU)
        .plus(collateralToBeReceived)
        .toFixed()
      let vaultExpectedLPTBal = new BigNumber(lptBalanceBeforeV)
        .minus(collateralToBeReceived)
        .toFixed()

      expect(await und.balanceOf(signers[0].address)).to.equal(
        userExpectedUNDBal
      )
      expect(await ethDaiPair.balanceOf(signers[0].address)).to.equal(
        userExpectedLPTBal
      )
      expect(await ethDaiPair.balanceOf(ethDaiVault.address)).to.equal(
        vaultExpectedLPTBal
      )

      let secondHalfDebt = new BigNumber(debt).minus(debtToBePaid).toFixed()
      let secondHalfCollateral = new BigNumber(collateral)
        .minus(collateralToBeReceived)
        .toFixed()

      expect(await ethDaiVault.debt(signers[0].address)).to.equal(
        secondHalfDebt
      )
      expect(await ethDaiVault.collateral(signers[0].address)).to.equal(
        secondHalfCollateral
      )

      //Paying remaing all debt

      let burn2 = await ethDaiVault.unlock(secondHalfDebt, secondHalfCollateral)

      expect(burn2)
        .to.emit(ethDaiVault, 'Unlock')
        .withArgs(signers[0].address, secondHalfCollateral, secondHalfDebt)
      expect(burn2)
        .to.emit(und, 'Transfer')
        .withArgs(signers[0].address, zeroAddress, secondHalfDebt)

      let userExpectedUNDBalFinal = new BigNumber(userExpectedUNDBal)
        .minus(secondHalfDebt)
        .toFixed()
      let userExpectedLPTBalFinal = new BigNumber(userExpectedLPTBal)
        .plus(secondHalfCollateral)
        .toFixed()
      let vaultExpectedLPTBalFinal = new BigNumber(vaultExpectedLPTBal)
        .minus(secondHalfCollateral)
        .toFixed()

      expect(await und.balanceOf(signers[0].address)).to.equal(
        userExpectedUNDBalFinal
      )
      expect(await ethDaiPair.balanceOf(signers[0].address)).to.equal(
        userExpectedLPTBalFinal
      )
      expect(await ethDaiPair.balanceOf(ethDaiVault.address)).to.equal(
        vaultExpectedLPTBalFinal
      )

      expect(await ethDaiVault.debt(signers[0].address)).to.equal('0')
      expect(await ethDaiVault.collateral(signers[0].address)).to.equal('0')
    })

    it('unlock - repaying all debt in two parts - first 12% and then 88%', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      let undBalanceBeforeU = (
        await und.balanceOf(signers[0].address)
      ).toString()
      let lptBalanceBeforeU = (
        await ethDaiPair.balanceOf(signers[0].address)
      ).toString()

      let lptBalanceBeforeV = (
        await ethDaiPair.balanceOf(ethDaiVault.address)
      ).toString()

      let debtToBePaid = new BigNumber(debt).multipliedBy('0.12').toFixed(0) // 12%
      let collateralToBeReceived = new BigNumber(collateral)
        .multipliedBy(debtToBePaid)
        .dividedBy(debt)
        .toFixed() // 10%

      let burn = await ethDaiVault.unlock(debtToBePaid, collateralToBeReceived)

      expect(burn)
        .to.emit(ethDaiVault, 'Unlock')
        .withArgs(signers[0].address, collateralToBeReceived, debtToBePaid)
      expect(burn)
        .to.emit(und, 'Transfer')
        .withArgs(signers[0].address, zeroAddress, debtToBePaid)

      let userExpectedUNDBal = new BigNumber(undBalanceBeforeU)
        .minus(debtToBePaid)
        .toFixed()
      let userExpectedLPTBal = new BigNumber(lptBalanceBeforeU)
        .plus(collateralToBeReceived)
        .toFixed()
      let vaultExpectedLPTBal = new BigNumber(lptBalanceBeforeV)
        .minus(collateralToBeReceived)
        .toFixed()

      expect(await und.balanceOf(signers[0].address)).to.equal(
        userExpectedUNDBal
      )
      expect(await ethDaiPair.balanceOf(signers[0].address)).to.equal(
        userExpectedLPTBal
      )
      expect(await ethDaiPair.balanceOf(ethDaiVault.address)).to.equal(
        vaultExpectedLPTBal
      )

      let secondHalfDebt = new BigNumber(debt).minus(debtToBePaid).toFixed()
      let secondHalfCollateral = new BigNumber(collateral)
        .minus(collateralToBeReceived)
        .toFixed()

      expect(await ethDaiVault.debt(signers[0].address)).to.equal(
        secondHalfDebt
      )
      expect(await ethDaiVault.collateral(signers[0].address)).to.equal(
        secondHalfCollateral
      )

      //Paying remaing all debt

      let burn2 = await ethDaiVault.unlock(secondHalfDebt, secondHalfCollateral)

      expect(burn2)
        .to.emit(ethDaiVault, 'Unlock')
        .withArgs(signers[0].address, secondHalfCollateral, secondHalfDebt)
      expect(burn2)
        .to.emit(und, 'Transfer')
        .withArgs(signers[0].address, zeroAddress, secondHalfDebt)

      let userExpectedUNDBalFinal = new BigNumber(userExpectedUNDBal)
        .minus(secondHalfDebt)
        .toFixed()
      let userExpectedLPTBalFinal = new BigNumber(userExpectedLPTBal)
        .plus(secondHalfCollateral)
        .toFixed()
      let vaultExpectedLPTBalFinal = new BigNumber(vaultExpectedLPTBal)
        .minus(secondHalfCollateral)
        .toFixed()

      expect(await und.balanceOf(signers[0].address)).to.equal(
        userExpectedUNDBalFinal
      )
      expect(await ethDaiPair.balanceOf(signers[0].address)).to.equal(
        userExpectedLPTBalFinal
      )
      expect(await ethDaiPair.balanceOf(ethDaiVault.address)).to.equal(
        vaultExpectedLPTBalFinal
      )

      expect(await ethDaiVault.debt(signers[0].address)).to.equal('0')
      expect(await ethDaiVault.collateral(signers[0].address)).to.equal('0')
    })

    it('unlock - repaying all debt in two parts - first 28% and then 72%', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      let undBalanceBeforeU = (
        await und.balanceOf(signers[0].address)
      ).toString()
      let lptBalanceBeforeU = (
        await ethDaiPair.balanceOf(signers[0].address)
      ).toString()

      let lptBalanceBeforeV = (
        await ethDaiPair.balanceOf(ethDaiVault.address)
      ).toString()

      let debtToBePaid = new BigNumber(debt).multipliedBy('0.28').toFixed(0) // 28%
      let collateralToBeReceived = new BigNumber(collateral)
        .multipliedBy(debtToBePaid)
        .dividedBy(debt)
        .toFixed() // 10%

      let burn = await ethDaiVault.unlock(debtToBePaid, collateralToBeReceived)

      expect(burn)
        .to.emit(ethDaiVault, 'Unlock')
        .withArgs(signers[0].address, collateralToBeReceived, debtToBePaid)
      expect(burn)
        .to.emit(und, 'Transfer')
        .withArgs(signers[0].address, zeroAddress, debtToBePaid)

      let userExpectedUNDBal = new BigNumber(undBalanceBeforeU)
        .minus(debtToBePaid)
        .toFixed()
      let userExpectedLPTBal = new BigNumber(lptBalanceBeforeU)
        .plus(collateralToBeReceived)
        .toFixed()
      let vaultExpectedLPTBal = new BigNumber(lptBalanceBeforeV)
        .minus(collateralToBeReceived)
        .toFixed()

      expect(await und.balanceOf(signers[0].address)).to.equal(
        userExpectedUNDBal
      )
      expect(await ethDaiPair.balanceOf(signers[0].address)).to.equal(
        userExpectedLPTBal
      )
      expect(await ethDaiPair.balanceOf(ethDaiVault.address)).to.equal(
        vaultExpectedLPTBal
      )

      let secondHalfDebt = new BigNumber(debt).minus(debtToBePaid).toFixed()
      let secondHalfCollateral = new BigNumber(collateral)
        .minus(collateralToBeReceived)
        .toFixed()

      expect(await ethDaiVault.debt(signers[0].address)).to.equal(
        secondHalfDebt
      )
      expect(await ethDaiVault.collateral(signers[0].address)).to.equal(
        secondHalfCollateral
      )

      //Paying remaing all debt

      let burn2 = await ethDaiVault.unlock(secondHalfDebt, secondHalfCollateral)

      expect(burn2)
        .to.emit(ethDaiVault, 'Unlock')
        .withArgs(signers[0].address, secondHalfCollateral, secondHalfDebt)
      expect(burn2)
        .to.emit(und, 'Transfer')
        .withArgs(signers[0].address, zeroAddress, secondHalfDebt)

      let userExpectedUNDBalFinal = new BigNumber(userExpectedUNDBal)
        .minus(secondHalfDebt)
        .toFixed()
      let userExpectedLPTBalFinal = new BigNumber(userExpectedLPTBal)
        .plus(secondHalfCollateral)
        .toFixed()
      let vaultExpectedLPTBalFinal = new BigNumber(vaultExpectedLPTBal)
        .minus(secondHalfCollateral)
        .toFixed()

      expect(await und.balanceOf(signers[0].address)).to.equal(
        userExpectedUNDBalFinal
      )
      expect(await ethDaiPair.balanceOf(signers[0].address)).to.equal(
        userExpectedLPTBalFinal
      )
      expect(await ethDaiPair.balanceOf(ethDaiVault.address)).to.equal(
        vaultExpectedLPTBalFinal
      )

      expect(await ethDaiVault.debt(signers[0].address)).to.equal('0')
      expect(await ethDaiVault.collateral(signers[0].address)).to.equal('0')
    })

    it('unlock - repaying all debt in two parts - first 53% and then 47%', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      let undBalanceBeforeU = (
        await und.balanceOf(signers[0].address)
      ).toString()
      let lptBalanceBeforeU = (
        await ethDaiPair.balanceOf(signers[0].address)
      ).toString()

      let lptBalanceBeforeV = (
        await ethDaiPair.balanceOf(ethDaiVault.address)
      ).toString()

      let debtToBePaid = new BigNumber(debt).multipliedBy('0.53').toFixed(0) // 53%
      let collateralToBeReceived = new BigNumber(collateral)
        .multipliedBy(debtToBePaid)
        .dividedBy(debt)
        .toFixed() // 10%

      let burn = await ethDaiVault.unlock(debtToBePaid, collateralToBeReceived)

      expect(burn)
        .to.emit(ethDaiVault, 'Unlock')
        .withArgs(signers[0].address, collateralToBeReceived, debtToBePaid)
      expect(burn)
        .to.emit(und, 'Transfer')
        .withArgs(signers[0].address, zeroAddress, debtToBePaid)

      let userExpectedUNDBal = new BigNumber(undBalanceBeforeU)
        .minus(debtToBePaid)
        .toFixed()
      let userExpectedLPTBal = new BigNumber(lptBalanceBeforeU)
        .plus(collateralToBeReceived)
        .toFixed()
      let vaultExpectedLPTBal = new BigNumber(lptBalanceBeforeV)
        .minus(collateralToBeReceived)
        .toFixed()

      expect(await und.balanceOf(signers[0].address)).to.equal(
        userExpectedUNDBal
      )
      expect(await ethDaiPair.balanceOf(signers[0].address)).to.equal(
        userExpectedLPTBal
      )
      expect(await ethDaiPair.balanceOf(ethDaiVault.address)).to.equal(
        vaultExpectedLPTBal
      )

      let secondHalfDebt = new BigNumber(debt).minus(debtToBePaid).toFixed()
      let secondHalfCollateral = new BigNumber(collateral)
        .minus(collateralToBeReceived)
        .toFixed()

      expect(await ethDaiVault.debt(signers[0].address)).to.equal(
        secondHalfDebt
      )
      expect(await ethDaiVault.collateral(signers[0].address)).to.equal(
        secondHalfCollateral
      )

      //Paying remaing all debt

      let burn2 = await ethDaiVault.unlock(secondHalfDebt, secondHalfCollateral)

      expect(burn2)
        .to.emit(ethDaiVault, 'Unlock')
        .withArgs(signers[0].address, secondHalfCollateral, secondHalfDebt)
      expect(burn2)
        .to.emit(und, 'Transfer')
        .withArgs(signers[0].address, zeroAddress, secondHalfDebt)

      let userExpectedUNDBalFinal = new BigNumber(userExpectedUNDBal)
        .minus(secondHalfDebt)
        .toFixed()
      let userExpectedLPTBalFinal = new BigNumber(userExpectedLPTBal)
        .plus(secondHalfCollateral)
        .toFixed()
      let vaultExpectedLPTBalFinal = new BigNumber(vaultExpectedLPTBal)
        .minus(secondHalfCollateral)
        .toFixed()

      expect(await und.balanceOf(signers[0].address)).to.equal(
        userExpectedUNDBalFinal
      )
      expect(await ethDaiPair.balanceOf(signers[0].address)).to.equal(
        userExpectedLPTBalFinal
      )
      expect(await ethDaiPair.balanceOf(ethDaiVault.address)).to.equal(
        vaultExpectedLPTBalFinal
      )

      expect(await ethDaiVault.debt(signers[0].address)).to.equal('0')
      expect(await ethDaiVault.collateral(signers[0].address)).to.equal('0')
    })

    it('unlock - repaying all debt in two parts - first 82% and then 18%', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      let undBalanceBeforeU = (
        await und.balanceOf(signers[0].address)
      ).toString()
      let lptBalanceBeforeU = (
        await ethDaiPair.balanceOf(signers[0].address)
      ).toString()

      let lptBalanceBeforeV = (
        await ethDaiPair.balanceOf(ethDaiVault.address)
      ).toString()

      let debtToBePaid = new BigNumber(debt).multipliedBy('0.82').toFixed(0) // 18%
      let collateralToBeReceived = new BigNumber(collateral)
        .multipliedBy(debtToBePaid)
        .dividedBy(debt)
        .toFixed() // 10%

      let burn = await ethDaiVault.unlock(debtToBePaid, collateralToBeReceived)

      expect(burn)
        .to.emit(ethDaiVault, 'Unlock')
        .withArgs(signers[0].address, collateralToBeReceived, debtToBePaid)
      expect(burn)
        .to.emit(und, 'Transfer')
        .withArgs(signers[0].address, zeroAddress, debtToBePaid)

      let userExpectedUNDBal = new BigNumber(undBalanceBeforeU)
        .minus(debtToBePaid)
        .toFixed()
      let userExpectedLPTBal = new BigNumber(lptBalanceBeforeU)
        .plus(collateralToBeReceived)
        .toFixed()
      let vaultExpectedLPTBal = new BigNumber(lptBalanceBeforeV)
        .minus(collateralToBeReceived)
        .toFixed()

      expect(await und.balanceOf(signers[0].address)).to.equal(
        userExpectedUNDBal
      )
      expect(await ethDaiPair.balanceOf(signers[0].address)).to.equal(
        userExpectedLPTBal
      )
      expect(await ethDaiPair.balanceOf(ethDaiVault.address)).to.equal(
        vaultExpectedLPTBal
      )

      let secondHalfDebt = new BigNumber(debt).minus(debtToBePaid).toFixed()
      let secondHalfCollateral = new BigNumber(collateral)
        .minus(collateralToBeReceived)
        .toFixed()

      expect(await ethDaiVault.debt(signers[0].address)).to.equal(
        secondHalfDebt
      )
      expect(await ethDaiVault.collateral(signers[0].address)).to.equal(
        secondHalfCollateral
      )

      //Paying remaing all debt

      let burn2 = await ethDaiVault.unlock(secondHalfDebt, secondHalfCollateral)

      expect(burn2)
        .to.emit(ethDaiVault, 'Unlock')
        .withArgs(signers[0].address, secondHalfCollateral, secondHalfDebt)
      expect(burn2)
        .to.emit(und, 'Transfer')
        .withArgs(signers[0].address, zeroAddress, secondHalfDebt)

      let userExpectedUNDBalFinal = new BigNumber(userExpectedUNDBal)
        .minus(secondHalfDebt)
        .toFixed()
      let userExpectedLPTBalFinal = new BigNumber(userExpectedLPTBal)
        .plus(secondHalfCollateral)
        .toFixed()
      let vaultExpectedLPTBalFinal = new BigNumber(vaultExpectedLPTBal)
        .minus(secondHalfCollateral)
        .toFixed()

      expect(await und.balanceOf(signers[0].address)).to.equal(
        userExpectedUNDBalFinal
      )
      expect(await ethDaiPair.balanceOf(signers[0].address)).to.equal(
        userExpectedLPTBalFinal
      )
      expect(await ethDaiPair.balanceOf(ethDaiVault.address)).to.equal(
        vaultExpectedLPTBalFinal
      )

      expect(await ethDaiVault.debt(signers[0].address)).to.equal('0')
      expect(await ethDaiVault.collateral(signers[0].address)).to.equal('0')
    })

    it('unlock - repaying all debt in two parts - first 92% and then 8%', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      let undBalanceBeforeU = (
        await und.balanceOf(signers[0].address)
      ).toString()
      let lptBalanceBeforeU = (
        await ethDaiPair.balanceOf(signers[0].address)
      ).toString()

      let lptBalanceBeforeV = (
        await ethDaiPair.balanceOf(ethDaiVault.address)
      ).toString()

      let debtToBePaid = new BigNumber(debt).multipliedBy('0.92').toFixed(0) // 8%
      let collateralToBeReceived = new BigNumber(collateral)
        .multipliedBy(debtToBePaid)
        .dividedBy(debt)
        .toFixed() // 10%

      let burn = await ethDaiVault.unlock(debtToBePaid, collateralToBeReceived)

      expect(burn)
        .to.emit(ethDaiVault, 'Unlock')
        .withArgs(signers[0].address, collateralToBeReceived, debtToBePaid)
      expect(burn)
        .to.emit(und, 'Transfer')
        .withArgs(signers[0].address, zeroAddress, debtToBePaid)

      let userExpectedUNDBal = new BigNumber(undBalanceBeforeU)
        .minus(debtToBePaid)
        .toFixed()
      let userExpectedLPTBal = new BigNumber(lptBalanceBeforeU)
        .plus(collateralToBeReceived)
        .toFixed()
      let vaultExpectedLPTBal = new BigNumber(lptBalanceBeforeV)
        .minus(collateralToBeReceived)
        .toFixed()

      expect(await und.balanceOf(signers[0].address)).to.equal(
        userExpectedUNDBal
      )
      expect(await ethDaiPair.balanceOf(signers[0].address)).to.equal(
        userExpectedLPTBal
      )
      expect(await ethDaiPair.balanceOf(ethDaiVault.address)).to.equal(
        vaultExpectedLPTBal
      )

      let secondHalfDebt = new BigNumber(debt).minus(debtToBePaid).toFixed()
      let secondHalfCollateral = new BigNumber(collateral)
        .minus(collateralToBeReceived)
        .toFixed()

      expect(await ethDaiVault.debt(signers[0].address)).to.equal(
        secondHalfDebt
      )
      expect(await ethDaiVault.collateral(signers[0].address)).to.equal(
        secondHalfCollateral
      )

      //Paying remaing all debt

      let burn2 = await ethDaiVault.unlock(secondHalfDebt, secondHalfCollateral)

      expect(burn2)
        .to.emit(ethDaiVault, 'Unlock')
        .withArgs(signers[0].address, secondHalfCollateral, secondHalfDebt)
      expect(burn2)
        .to.emit(und, 'Transfer')
        .withArgs(signers[0].address, zeroAddress, secondHalfDebt)

      let userExpectedUNDBalFinal = new BigNumber(userExpectedUNDBal)
        .minus(secondHalfDebt)
        .toFixed()
      let userExpectedLPTBalFinal = new BigNumber(userExpectedLPTBal)
        .plus(secondHalfCollateral)
        .toFixed()
      let vaultExpectedLPTBalFinal = new BigNumber(vaultExpectedLPTBal)
        .minus(secondHalfCollateral)
        .toFixed()

      expect(await und.balanceOf(signers[0].address)).to.equal(
        userExpectedUNDBalFinal
      )
      expect(await ethDaiPair.balanceOf(signers[0].address)).to.equal(
        userExpectedLPTBalFinal
      )
      expect(await ethDaiPair.balanceOf(ethDaiVault.address)).to.equal(
        vaultExpectedLPTBalFinal
      )

      expect(await ethDaiVault.debt(signers[0].address)).to.equal('0')
      expect(await ethDaiVault.collateral(signers[0].address)).to.equal('0')
    })

    it('unlock - verify getTokenreturn - insufficient collateral', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      await feedEthUsd.setPrice('200000000000') //$2000

      let lptprice = await getOraclePriceForLPT(
        ethDaiPair,
        tDai.address,
        feedEthUsd.address
      )
      lptprice = lptprice.toString() // $91.92

      let currentCr = new BigNumber(lptprice)
        .multipliedBy(collateral)
        .multipliedBy(secondBase)
        .dividedBy(debt)
        .dividedBy(BASE)
      // console.log(currentCr.toFixed())

      expect(currentCr.toNumber()).to.be.below(Number(CR)) // insufficient collateral - 162%

      let debtToBePaid = new BigNumber(debt).multipliedBy('0.9').toFixed(0) // 90%
      let collateralToBeReceived = new BigNumber(collateral)
        .multipliedBy(debtToBePaid)
        .dividedBy(debt)
        .toFixed() // 10%

      let burn = await ethDaiVault.unlock(debtToBePaid, collateralToBeReceived)

      expect(burn)
        .to.emit(ethDaiVault, 'Unlock')
        .withArgs(signers[0].address, collateralToBeReceived, debtToBePaid)
    })

    it('unlock - verify getTokenreturn - insufficient collateral', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      await feedEthUsd.setPrice('200000000000') //$2000

      let lptprice = await getOraclePriceForLPT(
        ethDaiPair,
        tDai.address,
        feedEthUsd.address
      )
      lptprice = lptprice.toString() // $91.92

      let currentCr = new BigNumber(lptprice)
        .multipliedBy(collateral)
        .multipliedBy(secondBase)
        .dividedBy(debt)
        .dividedBy(BASE)

      expect(currentCr.toNumber()).to.be.below(Number(CR)) // insufficient collateral - 162%

      let debtToBePaid = new BigNumber(debt).multipliedBy('0.5').toFixed(0) // 50%
      let collateralToBeReceived = new BigNumber(collateral)
        .multipliedBy(debtToBePaid)
        .dividedBy(debt)
        .toFixed() // 10%

      let burn = await ethDaiVault.unlock(debtToBePaid, collateralToBeReceived)

      expect(burn)
        .to.emit(ethDaiVault, 'Unlock')
        .withArgs(signers[0].address, collateralToBeReceived, debtToBePaid)
    })

    // it('unlock - verify getTokenreturn - insufficient collateral - check remaining debt & collateral value', async function () {
    //   let debt = (await ethDaiVault.debt(signers[0].address)).toString()
    //   let collateral = (
    //     await ethDaiVault.collateral(signers[0].address)
    //   ).toString()

    //   await feedEthUsd.setPrice('200000000000') //$2000

    //   let lptprice = await getOraclePriceForLPT(
    //     ethDaiPair,
    //     tDai.address,
    //     feedEthUsd.address
    //   )
    //   lptprice = lptprice.toString() // $91.92

    //   let currentCr = new BigNumber(lptprice)
    //     .multipliedBy(collateral)
    //     .multipliedBy(secondBase)
    //     .dividedBy(debt)
    //     .dividedBy(BASE)
    //   console.log('current cr: ' + currentCr.toFixed())

    //   expect(currentCr.toNumber()).to.be.below(Number(CR)) // insufficient collateral - 162%

    //   let debtToBePaid = new BigNumber(debt).multipliedBy('0.5').toFixed(0) // 30%
    //   let collateralToBeReceived = new BigNumber(collateral)
    //     .multipliedBy(debtToBePaid)
    //     .dividedBy(debt)
    //     .toFixed() // 10%

    //   let burn = await ethDaiVault.unlock(debtToBePaid, collateralToBeReceived)

    //   console.log('debt before: ' + debt)
    //   console.log('collateral before: ' + collateral)

    //   console.log('debt to be paid: ' + debtToBePaid)
    //   console.log('collateral to be received: ' + collateralToBeReceived)

    //   expect(burn)
    //     .to.emit(ethDaiVault, 'Unlock')
    //     .withArgs(signers[0].address, collateralToBeReceived, debtToBePaid)

    //   let debtAfter = (await ethDaiVault.debt(signers[0].address)).toString()
    //   let collateralAfter = (
    //     await ethDaiVault.collateral(signers[0].address)
    //   ).toString()

    //   let remainingcollateralValueUSD = new BigNumber(collateralAfter)
    //     .multipliedBy(lptprice)
    //     .dividedBy(BASE)
    //   let requiredDebt = new BigNumber(debtAfter)
    //     .multipliedBy(CR)
    //     .dividedBy(secondBase)

    //   console.log('debt After: ' + debtAfter)
    //   console.log('collateral After: ' + collateralAfter)
    //   console.log('remaining debt value usd: ' + requiredDebt.toFixed())
    //   console.log(
    //     'remaining collateral value usd: ' +
    //       remainingcollateralValueUSD.toFixed()
    //   )

    //   expect(requiredDebt.isGreaterThan(remainingcollateralValueUSD)).to.equal(
    //     false,
    //     'Invalid remaining collateral value'
    //   )
    // })

    it('unlock - verify getTokenreturn - sufficient collateral', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      await feedEthUsd.setPrice('400000000000') //$4000

      let lptprice = await getOraclePriceForLPT(
        ethDaiPair,
        tDai.address,
        feedEthUsd.address
      )
      lptprice = lptprice.toString() // $127.2792

      let currentCr = new BigNumber(lptprice)
        .multipliedBy(collateral)
        .multipliedBy(secondBase)
        .dividedBy(debt)
        .dividedBy(BASE)

      expect(Number(CR)).to.be.at.most(currentCr.toNumber()) // sufficient collateral - 225%

      let debtToBePaid = new BigNumber(debt).multipliedBy('0.5').toFixed(0) // 50%

      let totalCollateralvalueInUSd = new BigNumber(lptprice)
        .multipliedBy(collateral)
        .dividedBy(BASE)
      let remainingDebt = new BigNumber(debt).minus(debtToBePaid)
      let collateralVaultAfter = remainingDebt
        .multipliedBy(CR)
        .dividedBy(secondBase)
      let collateralTobeReceived = totalCollateralvalueInUSd
        .minus(collateralVaultAfter)
        .multipliedBy(BASE)
        .dividedBy(lptprice)
        .toFixed()

      let burn = await ethDaiVault.unlock(debtToBePaid, collateralTobeReceived)

      expect(burn)
        .to.emit(ethDaiVault, 'Unlock')
        .withArgs(signers[0].address, collateralTobeReceived, debtToBePaid)
    })

    it('unlock - verify getTokenreturn - sufficient collateral', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      await feedEthUsd.setPrice('400000000000') //$4000

      let lptprice = await getOraclePriceForLPT(
        ethDaiPair,
        tDai.address,
        feedEthUsd.address
      )
      lptprice = lptprice.toString() // $127.2792

      let currentCr = new BigNumber(lptprice)
        .multipliedBy(collateral)
        .multipliedBy(secondBase)
        .dividedBy(debt)
        .dividedBy(BASE)

      expect(Number(CR)).to.be.at.most(currentCr.toNumber()) // sufficient collateral - 225%

      let debtToBePaid = new BigNumber(debt).multipliedBy('0.3').toFixed(0) // 30%

      let totalCollateralvalueInUSd = new BigNumber(lptprice)
        .multipliedBy(collateral)
        .dividedBy(BASE)
      let remainingDebt = new BigNumber(debt).minus(debtToBePaid)
      let collateralVaultAfter = remainingDebt
        .multipliedBy(CR)
        .dividedBy(secondBase)
      let collateralTobeReceived = totalCollateralvalueInUSd
        .minus(collateralVaultAfter)
        .multipliedBy(BASE)
        .dividedBy(lptprice)
        .toFixed()

      let burn = await ethDaiVault.unlock(debtToBePaid, collateralTobeReceived)

      expect(burn)
        .to.emit(ethDaiVault, 'Unlock')
        .withArgs(signers[0].address, collateralTobeReceived, debtToBePaid)
    })

    it('unlock - verify getTokenreturn - sufficient collateral - check remaining debt & collateral value', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      await feedEthUsd.setPrice('400000000000') //$4000

      let lptprice = await getOraclePriceForLPT(
        ethDaiPair,
        tDai.address,
        feedEthUsd.address
      )
      lptprice = lptprice.toString() // $127.2792

      let currentCr = new BigNumber(lptprice)
        .multipliedBy(collateral)
        .multipliedBy(secondBase)
        .dividedBy(debt)
        .dividedBy(BASE)

      expect(Number(CR)).to.be.at.most(currentCr.toNumber()) // sufficient collateral - 225%

      let debtToBePaid = new BigNumber(debt).multipliedBy('0.7').toFixed(0) // 70%

      let totalCollateralvalueInUSd = new BigNumber(lptprice)
        .multipliedBy(collateral)
        .dividedBy(BASE)
      let remainingDebt = new BigNumber(debt).minus(debtToBePaid)
      let collateralVaultAfter = remainingDebt
        .multipliedBy(CR)
        .dividedBy(secondBase)
      let collateralTobeReceived = totalCollateralvalueInUSd
        .minus(collateralVaultAfter)
        .multipliedBy(BASE)
        .dividedBy(lptprice)
        .toFixed()

      let burn = await ethDaiVault.unlock(debtToBePaid, collateralTobeReceived)

      expect(burn)
        .to.emit(ethDaiVault, 'Unlock')
        .withArgs(signers[0].address, collateralTobeReceived, debtToBePaid)

      let debtAfter = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateralAfter = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      let remainingcollateralValueUSD = new BigNumber(collateralAfter)
        .multipliedBy(lptprice)
        .dividedBy(BASE)
      let requiredDebt = new BigNumber(debtAfter)
        .multipliedBy(CR)
        .dividedBy(secondBase)

      // console.log(remainingcollateralValueUSD.toFixed())
      // console.log(requiredDebt.toFixed())

      expect(requiredDebt.isGreaterThan(remainingcollateralValueUSD)).to.equal(
        false,
        'Invalid remaining collateral value'
      )
    })
  })

  describe('#emergencyUnlock', async () => {
    beforeEach(async function () {
      let lockAmount = ethers.utils.parseEther('1').toString()
      await ethDaiPair.approve(ethDaiVault.address, lockAmount)
      await ethDaiVault.lock(lockAmount, signers[0].address, zeroAddress, '1')

      // Transfer some extra und to user 0 to repay all debts
      await ethDaiPair.transfer(signers[1].address, lockAmount)
      await ethDaiPair
        .connect(signers[1])
        .approve(ethDaiVault.address, lockAmount)
      await ethDaiVault
        .connect(signers[1])
        .lock(lockAmount, signers[1].address, zeroAddress, '1')
      await und.connect(signers[1]).transfer(signers[0].address, lockAmount)
    })

    it('should revert if user balance if less then debt', async () => {
      let lockAmount = ethers.utils.parseEther('1').toString()

      await und.transfer(signers[1].address, lockAmount)

      await expect(ethDaiVault.emergencyUnlock()).to.be.revertedWith('BAL')
    })

    it('should set debt and collateral to 0 if paid all debt', async () => {
      expect(await ethDaiVault.debt(signers[0].address)).to.not.equal('0')
      expect(await ethDaiVault.collateral(signers[0].address)).to.not.equal('0')

      await ethDaiVault.emergencyUnlock()

      expect(await ethDaiVault.debt(signers[0].address)).to.equal('0')
      expect(await ethDaiVault.collateral(signers[0].address)).to.equal('0')
    })

    it('should emit unlock and burn event after repaying all debt', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      let tx = await ethDaiVault.emergencyUnlock()

      expect(tx)
        .to.emit(ethDaiVault, 'Unlock')
        .withArgs(signers[0].address, collateral, debt)

      expect(tx)
        .to.emit(und, 'Transfer')
        .withArgs(signers[0].address, zeroAddress, debt)
    })

    it('unlock - should burn UND and transfer LPT back to user after repaying all debt', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      let undBalanceBeforeU = (
        await und.balanceOf(signers[0].address)
      ).toString()
      let lptBalanceBeforeU = (
        await ethDaiPair.balanceOf(signers[0].address)
      ).toString()

      let lptBalanceBeforeV = (
        await ethDaiPair.balanceOf(ethDaiVault.address)
      ).toString()

      await ethDaiVault.emergencyUnlock()

      let userExpectedUNDBal = new BigNumber(undBalanceBeforeU)
        .minus(debt)
        .toFixed()
      let userExpectedLPTBal = new BigNumber(lptBalanceBeforeU)
        .plus(collateral)
        .toFixed()
      let vaultExpectedLPTBal = new BigNumber(lptBalanceBeforeV)
        .minus(collateral)
        .toFixed()

      expect(await und.balanceOf(signers[0].address)).to.equal(
        userExpectedUNDBal
      )
      expect(await ethDaiPair.balanceOf(signers[0].address)).to.equal(
        userExpectedLPTBal
      )
      expect(await ethDaiPair.balanceOf(ethDaiVault.address)).to.equal(
        vaultExpectedLPTBal
      )
    })
  })

  describe('#distributeFee', function () {
    beforeEach(async function () {
      let lockAmount = ethers.utils.parseEther('1').toString()
      await ethDaiPair.approve(ethDaiVault.address, lockAmount)
      await ethDaiVault.lock(lockAmount, signers[0].address, zeroAddress, '1')
    })

    it('should revert if safu address is not initialized', async () => {
      await ethDaiVault.changeTeamFeeAddress(signers[2].address)
      await ethDaiVault.changeSafuShare(safuShare)

      await expect(ethDaiVault.distributeFee()).to.be.revertedWith('INVALID')
    })

    it('should revert if safu share is zero', async () => {
      await ethDaiVault.changeSafuAddress(signers[1].address)
      await ethDaiVault.changeTeamFeeAddress(signers[2].address)

      await expect(ethDaiVault.distributeFee()).to.be.revertedWith('INVALID')
    })
    it('should distribute fees to correct address', async () => {
      await ethDaiVault.changeSafuAddress(signers[1].address)
      await ethDaiVault.changeTeamFeeAddress(signers[2].address)
      await ethDaiVault.changeSafuShare(safuShare)

      let balance = (await und.balanceOf(ethDaiVault.address)).toString()

      let safuAmount = new BigNumber(balance)
        .multipliedBy(safuShare)
        .dividedBy(secondBase)
        .toFixed()
      let teamAmount = new BigNumber(balance).minus(safuAmount).toFixed()

      let distribute = await ethDaiVault.distributeFee()

      expect(distribute)
        .to.emit(und, 'Transfer')
        .withArgs(ethDaiVault.address, signers[1].address, safuAmount)
      expect(distribute)
        .to.emit(und, 'Transfer')
        .withArgs(ethDaiVault.address, signers[2].address, teamAmount)
    })
    it('should distribute fees to only safu address if team address is zero address', async () => {
      await ethDaiVault.changeSafuAddress(signers[1].address)
      await ethDaiVault.changeSafuShare(safuShare)

      let balance = (await und.balanceOf(ethDaiVault.address)).toString()

      let safuAmount = new BigNumber(balance)
        .multipliedBy(safuShare)
        .dividedBy(secondBase)
        .toFixed()
      let remainingAmount = new BigNumber(balance).minus(safuAmount).toFixed()

      let distribute = await ethDaiVault.distributeFee()

      expect(distribute)
        .to.emit(und, 'Transfer')
        .withArgs(ethDaiVault.address, signers[1].address, safuAmount)
      expect(await und.balanceOf(ethDaiVault.address)).to.be.equal(
        remainingAmount
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
