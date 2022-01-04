const { expect } = require('chai')
const { ethers } = require('hardhat')
const BigNumber = require('bignumber.js')
BigNumber.set({ DECIMAL_PLACES: 0, ROUNDING_MODE: 1 })
const {
  buildPermitParams,
  buildPermitParamsKyberDmm,
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
let kyberDmmFactory
let kyberDmmRouter
let ethDaiPair
let undDaiPair
let vaultFactory
let oracleLibrary

let chainlinkRegistry
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

describe('KyberVault', function () {
  beforeEach(async function () {
    signers = await ethers.getSigners()
    governance = signers[0].address

    let KyberDMMFactory = await ethers.getContractFactory('DMMFactory')
    kyberDmmFactory = await KyberDMMFactory.deploy(zeroAddress)

    let WETH9 = await ethers.getContractFactory('WETH9')
    weth = await WETH9.deploy()

    let KyberDMMRouter02 = await ethers.getContractFactory('DMMRouter02')
    kyberDmmRouter = await KyberDMMRouter02.deploy(
      kyberDmmFactory.address,
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

    vaultFactory = await VaultFactory.deploy(governance, kyberDmmFactory.address);

    let UnboundToken = await ethers.getContractFactory('UnboundToken')
    und = await UnboundToken.deploy(signers[0].address)

    let TestEth = await ethers.getContractFactory('TestEth')
    tEth = await TestEth.deploy(signers[0].address)

    let TestDai = await ethers.getContractFactory('TestDai')
    tDai = await TestDai.deploy(signers[0].address, '1337')

    await kyberDmmFactory.createPool(und.address, tDai.address, 20000)
    await kyberDmmFactory.createPool(tEth.address, tDai.address, 20000)

    undDaiPair = await kyberDmmFactory.getPools(und.address, tDai.address)
    ethDaiPair = await kyberDmmFactory.getPools(tEth.address, tDai.address)

    undDaiPair = undDaiPair[0]
    ethDaiPair = await ethers.getContractAt('DMMPool', ethDaiPair[0])

    let daiAmount = ethers.utils
      .parseEther(((Number(ethPrice) / 100000000) * 1).toString())
      .toString()
    let ethAmount = ethers.utils.parseEther('1').toString()

    await tDai.approve(kyberDmmRouter.address, daiAmount)
    await tEth.approve(kyberDmmRouter.address, ethAmount)

    await kyberDmmRouter.addLiquidity(
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

    let pairToken0 = await ethDaiPair.token0()
    let pairToken1 = await ethDaiPair.token1()

    let ChainlinkRegistryMock = await ethers.getContractFactory("ChainlinkRegistryMock");
    chainlinkRegistry = await ChainlinkRegistryMock.deploy(pairToken0, pairToken1);

    await chainlinkRegistry.setDecimals(8);
    await chainlinkRegistry.setAnswer(
        ethPrice,
        "100000000"
    ); 

    await vaultFactory.createVault(
      und.address,
      signers[0].address,
      ethDaiPair.address,
      tDai.address,
      chainlinkRegistry.address,
      '900000000000000000', // 10%
      5000,
      undDaiPair
    )

    ethDaiVault = await vaultFactory.vaultByIndex(1)
    ethDaiVault = await ethers.getContractAt('KyberVault', ethDaiVault)

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

    it('should set the registry address correctly', async function () {
      expect(await ethDaiVault.registry()).to.equal(chainlinkRegistry.address)
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
          chainlinkRegistry.address,
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
          chainlinkRegistry.address,
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
          chainlinkRegistry.address,
          '900000000000000000', // 10%
          5000,
          undDaiPair
        )
      ).to.be.revertedWith('I')
    })

    it('should revert if pair address is not valid', async function () {
        await expect(
          vaultFactory.createVault(
            und.address,
            signers[0].address,
            tEth.address,
            tDai.address,
            chainlinkRegistry.address,
            '900000000000000000', // 10%
            5000,
            undDaiPair
          )
        ).to.be.reverted;
    })
    it('should revert if LP token decimals is not 18', async function () {

      let pairToken = await ethers.getContractFactory('TestToken')
      pairToken = await pairToken.deploy("Uniswap LP", "LP", 9, signers[0].address)

      await expect(
        vaultFactory.createVault(
          und.address,
          signers[0].address,
          pairToken.address,
          tDai.address,
          chainlinkRegistry.address,
          '900000000000000000', // 10%
          5000,
          undDaiPair
        )
      ).to.be.revertedWith('ID')
    })
  })

  describe('#lockWithPermit', async () => {
    it('should revert if permit expiration is invalid', async function () {
      const { chainId } = await ethers.provider.getNetwork()

      const expiration = 0
      const nonce = (await ethDaiPair.nonces(signers[0].address)).toString()
      const permitAmount = ethers.utils.parseEther('1').toString()

      const msgParams = buildPermitParamsKyberDmm(
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
            '100',
            expiration,
            v,
            r,
            s
          )
      ).to.be.revertedWith('ERC20Permit: EXPIRED')
    })

    it('should revert if permit signature is invalid', async function () {
      const { chainId } = await ethers.provider.getNetwork()

      const expiration = MAX_UINT_AMOUNT
      const nonce = (await ethDaiPair.nonces(signers[0].address)).toString()
      const permitAmount = ethers.utils.parseEther('1').toString()
      const dummyPermitAmount = ethers.utils.parseEther('2').toString()

      const msgParams = buildPermitParamsKyberDmm(
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
            '100',
            expiration,
            v,
            r,
            s
          )
      ).to.be.revertedWith('ERC20Permit: INVALID_SIGNATURE')
    })

    it("should revert if owner doesn't have sufficient lpt balance", async function () {
      const { chainId } = await ethers.provider.getNetwork()

      let ownerLPTBalance = (
        await ethDaiPair.balanceOf(signers[0].address)
      ).toString()

      const expiration = MAX_UINT_AMOUNT
      const nonce = (await ethDaiPair.nonces(signers[0].address)).toString()
      const permitAmount = new BigNumber(ownerLPTBalance).plus('1').toFixed()

      const msgParams = buildPermitParamsKyberDmm(
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

      const msgParams = buildPermitParamsKyberDmm(
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
      await ethers.provider.send("evm_increaseTime", [604801])   // increase evm time by 7 days
      await vaultFactory.executeDisableVault(ethDaiVault.address);

      const { chainId } = await ethers.provider.getNetwork()

      const expiration = MAX_UINT_AMOUNT
      const nonce = (await ethDaiPair.nonces(signers[0].address)).toString()
      const permitAmount = ethers.utils.parseEther('1').toString()

      const msgParams = buildPermitParamsKyberDmm(
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
            '1',
            expiration,
            v,
            r,
            s
          )
      ).to.be.revertedWith('NA')
    })

    it('should revert if LTV is 0', async function () { 

        await ethDaiVault.changeLTV("0")

        const { chainId } = await ethers.provider.getNetwork()
  
        const expiration = MAX_UINT_AMOUNT
        const nonce = (await ethDaiPair.nonces(signers[0].address)).toString()
        const permitAmount = ethers.utils.parseEther('1').toString()
  
        const msgParams = buildPermitParamsKyberDmm(
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

      const msgParams = buildPermitParamsKyberDmm(
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
      //     chainlinkRegistry.address
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

      const msgParams = buildPermitParamsKyberDmm(
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
      //     chainlinkRegistry.address
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

      const msgParams = buildPermitParamsKyberDmm(
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
      //     chainlinkRegistry.address
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

      const msgParams = buildPermitParamsKyberDmm(
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
      //     chainlinkRegistry.address
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

      const msgParams = buildPermitParamsKyberDmm(
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
      //     chainlinkRegistry.address
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

      const msgParams = buildPermitParamsKyberDmm(
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
      //     chainlinkRegistry.address
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

      const msgParams2 = buildPermitParamsKyberDmm(
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

      const msgParams = buildPermitParamsKyberDmm(
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
      //     chainlinkRegistry.address
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

      const msgParams2 = buildPermitParamsKyberDmm(
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
        ethDaiVault.lock(lockAmount, signers[0].address, '1')
      ).to.be.reverted
    })

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

    it('should revert if LTV is zero', async function () {
        await ethDaiVault.changeLTV("0")
  
        let lockAmount = ethers.utils.parseEther('1').toString()
  
        await ethDaiPair.approve(ethDaiVault.address, lockAmount)
  
        await expect(
          ethDaiVault.lock(lockAmount, signers[0].address, '1')
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
          .lock(lockAmount, signers[0].address, minUTokenAmount)
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

    it('should revert if uTokenAmount burn amount is more then debt', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let expectedMintAmount = new BigNumber(debt).plus('1').toFixed()

      await expect(
        ethDaiVault.unlock(expectedMintAmount, '1')
      ).to.be.revertedWith('BAL')
    })

    // it('should revert if CR is 0', async function () {
    //     await ethDaiVault.changeCR("0");

    //     await expect(
    //       ethDaiVault.unlock("1", '1')
    //     ).to.be.revertedWith('NI')
    // })

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
  })

  describe('#getTokenreturn', async () => {
    beforeEach(async function () {
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


    it('unlock - insufficient collateral repay 90% debt', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      await chainlinkRegistry.setAnswer(
        "200000000000", //$2000
        "100000000"
      ); 

      let lptprice = await getOraclePriceForLPT(
        ethDaiPair,
        tDai.address,
        chainlinkRegistry.address
      )
      lptprice = lptprice.toString() // $91.92

      let currentCr = new BigNumber(lptprice)
        .multipliedBy(collateral)
        .multipliedBy(secondBase)
        .dividedBy(debt)
        .dividedBy(BASE)
      // console.log(currentCr.toFixed())

      expect(currentCr.isLessThan(CR)).to.equal(true, "Invalid CR ratio. Should be less then 200%") // insufficient collateral - 162%

      let debtToBePaid = new BigNumber(debt).multipliedBy('0.9').toFixed(0) // 90%

      let collateralValue = (new BigNumber(lptprice).multipliedBy(collateral).multipliedBy(secondBase).dividedBy(CR).dividedBy(BASE)).toFixed()
      let remainingValue = (new BigNumber(debt).minus(collateralValue)).toFixed()
      let collateralToBeReceived;
      
      if(new BigNumber(debtToBePaid).isLessThanOrEqualTo(remainingValue)){
        collateralToBeReceived = 0;
      } else {
        let remainingLoan = (new BigNumber(debtToBePaid).minus(remainingValue)).toFixed()
        collateralToBeReceived = (new BigNumber(CR).multipliedBy(remainingLoan).multipliedBy(BASE).dividedBy(lptprice).dividedBy(secondBase)).toFixed()
      }
      
      let burn = await ethDaiVault.unlock(debtToBePaid, collateralToBeReceived)

      expect(burn)
        .to.emit(ethDaiVault, 'Unlock')
        .withArgs(signers[0].address, collateralToBeReceived, debtToBePaid)
    })

    it('unlock - insufficient collateral repay 50% debt', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      await chainlinkRegistry.setAnswer(
        "200000000000", //$2000
        "100000000"
      ); 
      
      let lptprice = await getOraclePriceForLPT(
        ethDaiPair,
        tDai.address,
        chainlinkRegistry.address
      )
      lptprice = lptprice.toString() // $91.92

      let currentCr = new BigNumber(lptprice)
        .multipliedBy(collateral)
        .multipliedBy(secondBase)
        .dividedBy(debt)
        .dividedBy(BASE)

        expect(currentCr.isLessThan(CR)).to.equal(true, "Invalid CR ratio. Should be less then 200%") // insufficient collateral - 162%

      let debtToBePaid = new BigNumber(debt).multipliedBy('0.5').toFixed(0) // 50%
      
      let collateralValue = (new BigNumber(lptprice).multipliedBy(collateral).multipliedBy(secondBase).dividedBy(CR).dividedBy(BASE)).toFixed()
      let remainingValue = (new BigNumber(debt).minus(collateralValue)).toFixed()
      let collateralToBeReceived;
      
      if(new BigNumber(debtToBePaid).isLessThanOrEqualTo(remainingValue)){
        collateralToBeReceived = 0;
      } else {
        let remainingLoan = (new BigNumber(debtToBePaid).minus(remainingValue)).toFixed()
        collateralToBeReceived = (new BigNumber(CR).multipliedBy(remainingLoan).multipliedBy(BASE).dividedBy(lptprice).dividedBy(secondBase)).toFixed()
      }
      
      let burn = await ethDaiVault.unlock(debtToBePaid, collateralToBeReceived)

      expect(burn)
        .to.emit(ethDaiVault, 'Unlock')
        .withArgs(signers[0].address, collateralToBeReceived, debtToBePaid)
    })

    it('unlock - insufficient collateral - check remaining debt & collateral value', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      await chainlinkRegistry.setAnswer(
        "200000000000", //$2000
        "100000000"
      ); 
      
      let lptprice = await getOraclePriceForLPT(
        ethDaiPair,
        tDai.address,
        chainlinkRegistry.address
      )
      lptprice = lptprice.toString() // $91.92

      console.log("lptprice: " + lptprice)
      let currentCr = new BigNumber(lptprice)
        .multipliedBy(collateral)
        .multipliedBy(secondBase)
        .dividedBy(debt)
        .dividedBy(BASE)
      console.log('current cr: ' + currentCr.toFixed())

      expect(currentCr.isLessThan(CR)).to.equal(true, "Invalid CR ratio. Should be less then 200%") // insufficient collateral - 162%

      let debtToBePaid = new BigNumber(debt).multipliedBy('0.3').toFixed(0) // 30%

      let collateralValue = (new BigNumber(lptprice).multipliedBy(collateral).multipliedBy(secondBase).dividedBy(CR).dividedBy(BASE)).toFixed()
      let remainingValue = (new BigNumber(debt).minus(collateralValue)).toFixed()
      let collateralToBeReceived;
      
      if(new BigNumber(debtToBePaid).isLessThanOrEqualTo(remainingValue)){
        collateralToBeReceived = "0";
      } else {
        let remainingLoan = (new BigNumber(debtToBePaid).minus(remainingValue)).toFixed()
        console.log("remainingLoan: " + remainingLoan)
        collateralToBeReceived = (new BigNumber(CR).multipliedBy(remainingLoan).multipliedBy(BASE).dividedBy(lptprice).dividedBy(secondBase)).toFixed()
      }
      
      console.log("collateralToBeReceived: " + collateralToBeReceived)
      let burn = await ethDaiVault.unlock(debtToBePaid, collateralToBeReceived)

      console.log('debt before: ' + debt)
      console.log('collateral before: ' + collateral)

      console.log('debt to be paid: ' + debtToBePaid)
      console.log('collateral to be received: ' + collateralToBeReceived)

      expect(burn)
        .to.emit(ethDaiVault, 'Unlock')
        .withArgs(signers[0].address, collateralToBeReceived, debtToBePaid)

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

      console.log('debt After: ' + debtAfter)
      console.log('collateral After: ' + collateralAfter)
      console.log('remaining debt value usd: ' + requiredDebt.toFixed())
      console.log(
        'remaining collateral value usd: ' +
          remainingcollateralValueUSD.toFixed()
      )

      let currentCr2 = new BigNumber(lptprice)
        .multipliedBy(collateralAfter)
        .multipliedBy(secondBase)
        .dividedBy(debtAfter)
        .dividedBy(BASE)
      console.log('current cr2: ' + currentCr2.toFixed())

      expect(requiredDebt.isGreaterThan(remainingcollateralValueUSD)).to.equal(
        false,
        'Invalid remaining collateral value'
      )

    })

    it('unlock - insufficient collateral - check user cr ratio after unlock. should be equal to 200%', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      await chainlinkRegistry.setAnswer(
        "200000000000", //$2000
        "100000000"
      ); 
      
      let lptprice = await getOraclePriceForLPT(
        ethDaiPair,
        tDai.address,
        chainlinkRegistry.address
      )
      lptprice = lptprice.toString() // $91.92

      let currentCr = new BigNumber(lptprice)
        .multipliedBy(collateral)
        .multipliedBy(secondBase)
        .dividedBy(debt)
        .dividedBy(BASE)
      console.log('current cr: ' + currentCr.toFixed())

      expect(currentCr.isLessThan(CR)).to.equal(true, "Invalid CR ratio. Should be less then 200%") // insufficient collateral - 162%

      let debtToBePaid = new BigNumber(debt).multipliedBy('0.3').toFixed(0) // 30%

      let collateralValue = (new BigNumber(lptprice).multipliedBy(collateral).multipliedBy(secondBase).dividedBy(CR).dividedBy(BASE)).toFixed()
      let remainingValue = (new BigNumber(debt).minus(collateralValue)).toFixed()
      let collateralToBeReceived;
      
      if(new BigNumber(debtToBePaid).isLessThanOrEqualTo(remainingValue)){
        collateralToBeReceived = 0;
      } else {
        let remainingLoan = (new BigNumber(debtToBePaid).minus(remainingValue)).toFixed()
        collateralToBeReceived = (new BigNumber(CR).multipliedBy(remainingLoan).multipliedBy(BASE).dividedBy(lptprice).dividedBy(secondBase)).toFixed()
      }
      
      let burn = await ethDaiVault.unlock(debtToBePaid, collateralToBeReceived)

      expect(burn)
        .to.emit(ethDaiVault, 'Unlock')
        .withArgs(signers[0].address, collateralToBeReceived, debtToBePaid)

      let debtAfter = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateralAfter = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      let currentCr2 = new BigNumber(lptprice)
        .multipliedBy(collateralAfter)
        .multipliedBy(secondBase)
        .dividedBy(debtAfter)
        .dividedBy(BASE)
      console.log('current cr2: ' + currentCr2.toFixed())


      expect(currentCr2.isEqualTo(CR)).to.equal(
        true,
        'Invalid user cr ratio after unlock'
      )
    })

    it('unlock - verify getTokenreturn - insufficient collateral - check user cr ratio after unlock. should increase cr ratio', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      await chainlinkRegistry.setAnswer(
        "200000000000", //$2000
        "100000000"
      ); 
      
      let lptprice = await getOraclePriceForLPT(
        ethDaiPair,
        tDai.address,
        chainlinkRegistry.address
      )
      lptprice = lptprice.toString() // $91.92

      let currentCr = new BigNumber(lptprice)
        .multipliedBy(collateral)
        .multipliedBy(secondBase)
        .dividedBy(debt)
        .dividedBy(BASE)
      console.log('current cr: ' + currentCr.toFixed())

      expect(currentCr.isLessThan(CR)).to.equal(true, "Invalid CR ratio. Should be less then 200%") // insufficient collateral - 162%

      let debtToBePaid = new BigNumber(debt).multipliedBy('0.05').toFixed(0) // 5%

      // let collateralValue = (new BigNumber(lptprice).multipliedBy(collateral).multipliedBy(secondBase).dividedBy(CR).dividedBy(BASE)).toFixed()
      // let remainingValue = (new BigNumber(debt).minus(collateralValue)).toFixed()
      // let collateralToBeReceived;
      
      // if(new BigNumber(debtToBePaid).isLessThanOrEqualTo(remainingValue)){
      //   collateralToBeReceived = 0;
      // } else {
      //   let remainingLoan = (new BigNumber(debtToBePaid).minus(remainingValue)).toFixed()
      //   console.log("remainingLoan: " + remainingLoan)
      //   collateralToBeReceived = (new BigNumber(CR).multipliedBy(remainingLoan).multipliedBy(BASE).dividedBy(lptprice).dividedBy(secondBase)).toFixed()
      // }
      // console.log("debtToBePaid: " + debtToBePaid)
      // console.log("collateralValue: " + collateralValue)
      // console.log("remainingValue: " + remainingValue)
      // console.log("collateralToBeReceived: " + collateralToBeReceived)

      let valueStart = (new BigNumber(lptprice).multipliedBy(collateral)).toFixed()
      let loanAfter = (new BigNumber(debt).minus(debtToBePaid)).toFixed()
      let valueAfter = (new BigNumber(CR).multipliedBy(loanAfter).multipliedBy(BASE).div(secondBase)).toFixed()
      let collateralToBeReceived = ((new BigNumber(valueStart).minus(valueAfter)).div(lptprice)).toFixed()

      if(new BigNumber(valueStart).isLessThan(valueAfter)){
        collateralToBeReceived = "0"
      }
      console.log("debtToBePaid: " + debtToBePaid)
      console.log("valueStart: " + valueStart)
      console.log("loanAfter: " + loanAfter)
      console.log("valueAfter: " + valueAfter)
      console.log("collateralToBeReceived: " + collateralToBeReceived)


      let burn = await ethDaiVault.unlock(debtToBePaid, collateralToBeReceived)

      expect(burn)
        .to.emit(ethDaiVault, 'Unlock')
        .withArgs(signers[0].address, collateralToBeReceived, debtToBePaid)

      let debtAfter = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateralAfter = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      let currentCr2 = new BigNumber(lptprice)
        .multipliedBy(collateralAfter)
        .multipliedBy(secondBase)
        .dividedBy(debtAfter)
        .dividedBy(BASE)
      console.log('current cr2: ' + currentCr2.toFixed())


      expect(currentCr2.isGreaterThan(currentCr)).to.equal(
        true,
        'Invalid user cr ratio'
      )
    })

    it('unlock - verify getTokenreturn - sufficient collateral', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      await chainlinkRegistry.setAnswer(
        "400000000000", //$4000
        "100000000"
      ); 
      
      let lptprice = await getOraclePriceForLPT(
        ethDaiPair,
        tDai.address,
        chainlinkRegistry.address
      )
      lptprice = lptprice.toString() // $127.2792

      let currentCr = new BigNumber(lptprice)
        .multipliedBy(collateral)
        .multipliedBy(secondBase)
        .dividedBy(debt)
        .dividedBy(BASE)
      console.log("currentCr: " + currentCr)

      expect(Number(CR)).to.be.at.most(currentCr.toNumber()) // sufficient collateral - 225%

      let debtToBePaid = new BigNumber(debt).multipliedBy('0.5').toFixed(0) // 50%

      let collateralTobeReceived = (new BigNumber(collateral).multipliedBy(debtToBePaid).dividedBy(debt)).toFixed()

      let burn = await ethDaiVault.unlock(debtToBePaid, collateralTobeReceived)

      let debtAfter = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateralAfter = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      let currentCr2 = new BigNumber(lptprice)
      .multipliedBy(collateralAfter)
      .multipliedBy(secondBase)
      .dividedBy(debtAfter)
      .dividedBy(BASE)
      console.log('current cr2: ' + currentCr2.toFixed())

      expect(burn)
        .to.emit(ethDaiVault, 'Unlock')
        .withArgs(signers[0].address, collateralTobeReceived, debtToBePaid)
    })

    it('unlock - verify getTokenreturn - sufficient collateral', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      await chainlinkRegistry.setAnswer(
        "400000000000", //$4000
        "100000000"
      ); 
      
      let lptprice = await getOraclePriceForLPT(
        ethDaiPair,
        tDai.address,
        chainlinkRegistry.address
      )
      lptprice = lptprice.toString() // $127.2792

      let currentCr = new BigNumber(lptprice)
        .multipliedBy(collateral)
        .multipliedBy(secondBase)
        .dividedBy(debt)
        .dividedBy(BASE)
      console.log("currentCr: " + currentCr)
      

      expect(Number(CR)).to.be.at.most(currentCr.toNumber()) // sufficient collateral - 225%

      let debtToBePaid = new BigNumber(debt).multipliedBy('0.3').toFixed(0) // 30%

      let collateralTobeReceived = (new BigNumber(collateral).multipliedBy(debtToBePaid).dividedBy(debt)).toFixed()

      let burn = await ethDaiVault.unlock(debtToBePaid, collateralTobeReceived)


      let debtAfter = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateralAfter = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()
      
      let currentCr2 = new BigNumber(lptprice)
      .multipliedBy(collateralAfter)
      .multipliedBy(secondBase)
      .dividedBy(debtAfter)
      .dividedBy(BASE)
      console.log('current cr2: ' + currentCr2.toFixed())

      expect(burn)
        .to.emit(ethDaiVault, 'Unlock')
        .withArgs(signers[0].address, collateralTobeReceived, debtToBePaid)
    })

    it('unlock - verify getTokenreturn - sufficient collateral - check remaining debt & collateral value', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      await chainlinkRegistry.setAnswer(
        "400000000000", //$4000
        "100000000"
      ); 
      
      let lptprice = await getOraclePriceForLPT(
        ethDaiPair,
        tDai.address,
        chainlinkRegistry.address
      )
      lptprice = lptprice.toString() // $127.2792

      let currentCr = new BigNumber(lptprice)
        .multipliedBy(collateral)
        .multipliedBy(secondBase)
        .dividedBy(debt)
        .dividedBy(BASE)
      console.log("currentCr: " + currentCr)
      

      expect(Number(CR)).to.be.at.most(currentCr.toNumber()) // sufficient collateral - 225%

      let debtToBePaid = new BigNumber(debt).multipliedBy('0.7').toFixed(0) // 70%

      let collateralTobeReceived = (new BigNumber(collateral).multipliedBy(debtToBePaid).dividedBy(debt)).toFixed()

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

      // console.log("remaining collateral value usd: "+remainingcollateralValueUSD.toFixed())
      // console.log("remaining debt value usd: "+requiredDebt.toFixed())

      
      let currentCr2 = new BigNumber(lptprice)
      .multipliedBy(collateralAfter)
      .multipliedBy(secondBase)
      .dividedBy(debtAfter)
      .dividedBy(BASE)
      console.log('current cr2: ' + currentCr2.toFixed())
      expect(requiredDebt.isGreaterThan(remainingcollateralValueUSD)).to.equal(
        false,
        'Invalid remaining collateral value'
      )
    })

    it('unlock - verify getTokenreturn - sufficient collateral - check user cr ratio after unlock. should greater then or equal to 200%', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      await chainlinkRegistry.setAnswer(
        "400000000000", //$4000
        "100000000"
      ); 
      
      let lptprice = await getOraclePriceForLPT(
        ethDaiPair,
        tDai.address,
        chainlinkRegistry.address
      )
      lptprice = lptprice.toString() // $127.2792

      let currentCr = new BigNumber(lptprice)
        .multipliedBy(collateral)
        .multipliedBy(secondBase)
        .dividedBy(debt)
        .dividedBy(BASE)
      console.log("currentCr: " + currentCr)

      expect(Number(CR)).to.be.at.most(currentCr.toNumber()) // sufficient collateral - 225%

      let debtToBePaid = new BigNumber(debt).multipliedBy('0.7').toFixed(0) // 70%

      let collateralTobeReceived = (new BigNumber(collateral).multipliedBy(debtToBePaid).dividedBy(debt)).toFixed()

      let burn = await ethDaiVault.unlock(debtToBePaid, collateralTobeReceived)

      expect(burn)
        .to.emit(ethDaiVault, 'Unlock')
        .withArgs(signers[0].address, collateralTobeReceived, debtToBePaid)

      let debtAfter = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateralAfter = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      let currentCr2 = new BigNumber(lptprice)
        .multipliedBy(collateralAfter)
        .multipliedBy(secondBase)
        .dividedBy(debtAfter)
        .dividedBy(BASE)
      console.log('current cr2: ' + currentCr2.toFixed())

      expect(currentCr2.isGreaterThanOrEqualTo(CR)).to.equal(
        true,
        'Invalid user cr ratio after unlock'
      )
    })

  })

  describe('#stakeLP', async () => {

    let yieldWalletFactory, sushiToken, masterchef;

    beforeEach(async function () {

      let TestToken = await ethers.getContractFactory('TestToken')
      sushiToken = await TestToken.deploy("Sushi Token", "SUSHI", 18, signers[0].address)
  
      let MasterChef = await ethers.getContractFactory('MasterChef')
      masterchef = await MasterChef.deploy(sushiToken.address, signers[0].address, "100000000000000000000")
  
      await masterchef.add("4000", ethDaiPair.address, false);
  
      let SushiSwapYieldWalletFactory = await ethers.getContractFactory(
        'SushiSwapYieldWalletFactory'
      )
      yieldWalletFactory = await SushiSwapYieldWalletFactory.deploy(masterchef.address)
  
      await ethDaiVault.enableYieldWalletFactory(yieldWalletFactory.address)
      await ethers.provider.send("evm_increaseTime", [259201])   // increase evm time by 3 days
      await ethDaiVault.executeEnableYeildWalletFactory(yieldWalletFactory.address);

      let lockAmount = ethers.utils.parseEther('1').toString()
      await ethDaiPair.approve(ethDaiVault.address, lockAmount)
      await ethDaiVault.lock(lockAmount, signers[0].address, '1')

    })

    it('should revert if contract is paused', async () => {

      await ethDaiVault.setPause();

      await expect(ethDaiVault.stakeLP(yieldWalletFactory.address, "1", true))
        .to.be.revertedWith('Pausable: paused')
    })

    it('should revert if farming address is zeroaddress', async () => {

      await expect(ethDaiVault.stakeLP(zeroAddress, "1", true))
        .to.be.revertedWith('IA');

    })

    it('should revert if farming address is not enabled', async () => {

      await expect(ethDaiVault.stakeLP(signers[1].address, "1", true))
        .to.be.revertedWith('IN');
        
    })

    it('should revert if stake amount is greater then collateral minus staked amount', async () => {

      let collateral = (await ethDaiVault.collateral(signers[0].address)).toString()
      let staked = (await ethDaiVault.yieldWalletDeposit(signers[0].address)).toString()
      let stakeAmt = (new BigNumber(collateral).minus(staked).plus(1)).toFixed()

      await expect(ethDaiVault.stakeLP(yieldWalletFactory.address, stakeAmt, true))
        .to.be.revertedWith('invalid');
        
    })

    it('should revert if createNewVault and already staked LP', async function () {

      await ethDaiVault.stakeLP(yieldWalletFactory.address, "1", true);

      await expect(ethDaiVault.stakeLP(yieldWalletFactory.address, "1", true))
      .to.be.revertedWith('unstake');

    })


    it('should create new yield wallet for user if staking lp for first time', async function () {

      expect(await ethDaiVault.yieldWallet(signers[0].address)).to.eq(zeroAddress)

      await ethDaiVault.stakeLP(yieldWalletFactory.address, "1", true);

      let wallet = await ethDaiVault.yieldWallet(signers[0].address)

      expect(await ethDaiVault.yieldWallet(signers[0].address)).to.eq(wallet)

    })

    it('should create new yield wallet for user if opted for createNewWallet', async function () {

      expect(await ethDaiVault.yieldWallet(signers[0].address)).to.eq(zeroAddress)

      await ethDaiVault.stakeLP(yieldWalletFactory.address, "1", true);

      let wallet = await ethDaiVault.yieldWallet(signers[0].address)

      expect(await ethDaiVault.yieldWallet(signers[0].address)).to.eq(wallet)

      await ethDaiVault.unstakeLP("1");

      await ethDaiVault.stakeLP(yieldWalletFactory.address, "1", true);

      let wallet2 = await ethDaiVault.yieldWallet(signers[0].address)

      expect(wallet).to.not.equal(wallet2)

    })

    it('should increase yieldWalletDeposit amount on stake LPT', async function () {

      expect(await ethDaiVault.yieldWalletDeposit(signers[0].address)).to.be.equal('0')

      let lockAmount = ethers.utils.parseEther('1').toString()

      await ethDaiVault.stakeLP(yieldWalletFactory.address, lockAmount, true);

      expect(await ethDaiVault.yieldWalletDeposit(signers[0].address)).to.be.equal(lockAmount)

    })

    it('should transfer LPT to farming contract on stake LPT', async function () {

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

    it('should update correct info for user and pool in farming contract', async function () {

      let lockAmount = ethers.utils.parseEther('1').toString()

      await ethDaiVault.stakeLP(yieldWalletFactory.address, lockAmount, true);

      let wallet = await ethDaiVault.yieldWallet(signers[0].address)

      let SushiSwapYieldWallet = await ethers.getContractFactory(
        'SushiSwapYieldWallet'
      )
      let yieldwallet = new ethers.Contract(
        wallet,
        SushiSwapYieldWallet.interface.fragments,
        signers[0]
      )
      let info = await yieldwallet.getWalletInfo();

      expect(info.amount.toString()).to.be.equal(lockAmount)

    })

    it('should deposit event on stake LPT', async function () {

      let lockAmount = ethers.utils.parseEther('1').toString()

      let stake = await ethDaiVault.stakeLP(yieldWalletFactory.address, lockAmount, true);

      let wallet = await ethDaiVault.yieldWallet(signers[0].address)
      let pid = await yieldWalletFactory.pids(ethDaiPair.address);

      let SushiSwapYieldWallet = await ethers.getContractFactory(
        'SushiSwapYieldWallet'
      )
      let yieldwallet = new ethers.Contract(
        wallet,
        SushiSwapYieldWallet.interface.fragments,
        signers[0]
      )

      expect(stake).to.emit(yieldwallet, "Deposit").withArgs(pid, lockAmount)

    })

    it('should emit proper transfer event while staking LPTs', async function () {

      let lockAmount = ethers.utils.parseEther('1').toString()

      let stake = await ethDaiVault.stakeLP(yieldWalletFactory.address, lockAmount, true);
      let wallet = await ethDaiVault.yieldWallet(signers[0].address)

      expect(stake).to.emit(ethDaiPair, "Transfer").withArgs(ethDaiVault.address, wallet, lockAmount)
      expect(stake).to.emit(ethDaiPair, "Transfer").withArgs(wallet, masterchef.address, lockAmount)

    })

  })

  describe('#unstakeLP', async () => {

    let yieldWalletFactory, sushiToken, masterchef;

    beforeEach(async function () {

      let TestToken = await ethers.getContractFactory('TestToken')
      sushiToken = await TestToken.deploy("Sushi Token", "SUSHI", 18, signers[0].address)
  
      let MasterChef = await ethers.getContractFactory('MasterChef')
      masterchef = await MasterChef.deploy(sushiToken.address, signers[0].address, "100000000000000000000")
  
      await masterchef.add("4000", ethDaiPair.address, false);
  
      let SushiSwapYieldWalletFactory = await ethers.getContractFactory(
        'SushiSwapYieldWalletFactory'
      )
      yieldWalletFactory = await SushiSwapYieldWalletFactory.deploy(masterchef.address)
  
      await ethDaiVault.enableYieldWalletFactory(yieldWalletFactory.address)
      await ethers.provider.send("evm_increaseTime", [259201])   // increase evm time by 3 days
      await ethDaiVault.executeEnableYeildWalletFactory(yieldWalletFactory.address);

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

    it('should revert if contract is paused', async () => {

      await ethDaiVault.setPause();

      await expect(ethDaiVault.unstakeLP("1"))
        .to.be.revertedWith('Pausable: paused')
    })

    it('should revert if unstake amount is greater then stake amount', async () => {

      let unstakeAmt = ethers.utils.parseEther('2').toString()

      await expect(ethDaiVault.unstakeLP(unstakeAmt))
        .to.be.revertedWith('invalid');

    })

    it('should decrese yieldWalletDeposit amount on unstake LPT', async function () {
      let lockAmount = ethers.utils.parseEther('1').toString()

      expect(
        await ethDaiVault.yieldWalletDeposit(signers[0].address)
      ).to.be.equal(lockAmount)

      await ethDaiVault.unstakeLP(lockAmount);

      expect(
        await ethDaiVault.yieldWalletDeposit(signers[0].address)
      ).to.be.equal("0")    
    })

    it("should transfer LPT back to vault from farming wallet on unstake LPT", async function() {
      
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

    it('should update correct info for user and pool in farming contract', async function () {

      let wallet = await ethDaiVault.yieldWallet(signers[0].address)

      let SushiSwapYieldWallet = await ethers.getContractFactory(
        'SushiSwapYieldWallet'
      )
      let yieldwallet = new ethers.Contract(
        wallet,
        SushiSwapYieldWallet.interface.fragments,
        signers[0]
      )
      
      let infoBefore = await yieldwallet.getWalletInfo();
      
      let collateral = (await ethDaiVault.collateral(signers[0].address)).toString()
      
      await ethDaiVault.unstakeLP(collateral);
      
      let infoAfter = await yieldwallet.getWalletInfo();
      let infoAfterExpected = new BigNumber(infoBefore.amount.toString()).minus(collateral).toFixed();

      expect(infoAfter.amount.toString()).to.be.equal(infoAfterExpected)

    })

    it('should emit withdraw event while unstaking LPTs', async function () {

      let collateral = (await ethDaiVault.collateral(signers[0].address)).toString()
      
      let unstake = await ethDaiVault.unstakeLP(collateral);

      let wallet = await ethDaiVault.yieldWallet(signers[0].address)
      let pid = await yieldWalletFactory.pids(ethDaiPair.address);


      expect(unstake).to.emit(masterchef, "Withdraw").withArgs(wallet, pid, collateral)

    })

    it('should emit proper transfer event while unlock LPTs', async function () {

      let collateral = (await ethDaiVault.collateral(signers[0].address)).toString()
      
      let unstake = await ethDaiVault.unstakeLP(collateral);

      let wallet = await ethDaiVault.yieldWallet(signers[0].address)

      expect(unstake).to.emit(ethDaiPair, "Transfer").withArgs(masterchef.address, wallet, collateral)
      expect(unstake).to.emit(ethDaiPair, "Transfer").withArgs(wallet, ethDaiVault.address, collateral)

    })

  })


  describe('#emergencyUnlock', async () => {
    beforeEach(async function () {
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

      await ethDaiVault.setPause();
    })

    it('should revert if contract is not paused', async () => {

      await ethDaiVault.setUnpause();

      let lockAmount = ethers.utils.parseEther('1').toString()

      await und.transfer(signers[1].address, lockAmount)

      await expect(ethDaiVault.emergencyUnlock()).to.be.revertedWith('Pausable: not paused')
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
      await ethDaiVault.lock(lockAmount, signers[0].address, '1')
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

      let distribute = await ethDaiVault.distributeFee()

      expect(distribute)
        .to.emit(und, 'Transfer')
        .withArgs(ethDaiVault.address, signers[1].address, balance)
      expect(await und.balanceOf(ethDaiVault.address)).to.be.equal(
        0
      )
    })
  })
})

async function getOraclePriceForLPT(pair, stablecoin, registry) {
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
      registry,
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
