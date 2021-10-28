const { expect } = require('chai')
const { waffle, ethers } = require('hardhat')
const BigNumber = require('bignumber.js')
BigNumber.set({ DECIMAL_PLACES: 0, ROUNDING_MODE: 1 })

const FACTORY = require('@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json')
const POOL = require('@uniswap/v3-core/artifacts/contracts/UniswapV3Pool.sol/UniswapV3Pool.json')

const { encodePriceSqrt, expandTo18Decimals, calculateTick, expandToString } = require('./helpers/utils')
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

let uniswapV3Factory;
let ethDaiPool;
let defiedgeStrategyFactory;
let defiedgeStrategy;
let testOracle;

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



describe('DefiEdgeVault', function () {
  beforeEach(async function () {
    signers = await ethers.getSigners()
    governance = signers[0].address

    let TestEth = await ethers.getContractFactory('TestEth')
    tEth = await TestEth.deploy(signers[0].address)

    let TestDai = await ethers.getContractFactory('TestDai')
    tDai = await TestDai.deploy(signers[0].address, '1337')

    let UnboundToken = await ethers.getContractFactory('UnboundToken')
    und = await UnboundToken.deploy(signers[0].address)

    uniswapV3Factory = (await waffle.deployContract(signers[0], {
      bytecode: FACTORY.bytecode,
      abi: FACTORY.abi,
    }));

    await uniswapV3Factory.createPool(tEth.address, tDai.address, "3000");

    let poolAddr = await uniswapV3Factory.getPool(tEth.address, tDai.address, "3000")

    // get uniswap pool instance
    ethDaiPool = new ethers.Contract(poolAddr, POOL.abi, signers[0]);


    // initialize the pool
    await ethDaiPool.initialize(
      encodePriceSqrt(
        expandTo18Decimals(50000000),
        expandTo18Decimals(150000000000)
      )
    );

    // deploy strategy factory
    let DefiEdgeStrategyFactory = await ethers.getContractFactory("DefiEdgeStrategyFactory");
    defiedgeStrategyFactory = await DefiEdgeStrategyFactory.deploy(signers[0].address, uniswapV3Factory.address);

    // create strategy
    await defiedgeStrategyFactory.createStrategy(ethDaiPool.address, signers[0].address, [
      {
        amount0: 0,
        amount1: 0,
        tickLower: calculateTick(2500, 60),
        tickUpper: calculateTick(3500, 60),
      },
    ]);

    // get strategy
    defiedgeStrategy = await ethers.getContractAt(
      "DefiEdgeStrategy",
      await defiedgeStrategyFactory.strategyByIndex(await defiedgeStrategyFactory.totalIndex())
    )
    // deploy swap router
    let Periphery = await ethers.getContractFactory("Periphery")
    uniswapV3Router = await Periphery.deploy()

    // add liquidity to the pool
    await tEth.approve(uniswapV3Router.address, expandTo18Decimals(50000000));
    await tDai.approve(uniswapV3Router.address, expandTo18Decimals(150000000000));

    await uniswapV3Router.mintLiquidity(
      ethDaiPool.address,
      calculateTick(3000, 60),
      calculateTick(4000, 60),
      expandTo18Decimals(50000000),
      expandTo18Decimals(150000000000),
      signers[0].address
    );

    // increase cardinary
    await ethDaiPool.increaseObservationCardinalityNext(65);

    // swap tokens
    const sqrtRatioX96 = (await ethDaiPool.slot0()).sqrtPriceX96;

    const sqrtPriceLimitX96 = Number(sqrtRatioX96) + Number(sqrtRatioX96) * 0.9;

    await ethers.provider.send("evm_increaseTime", [65]);

    await uniswapV3Router.swap(
      ethDaiPool.address,
      false,
      "10000000000000000000",
      expandToString(sqrtPriceLimitX96)
    );

    let Oracle = await ethers.getContractFactory('DefiEdgeSharePriceProvider')
    oracleLibrary = await Oracle.deploy()

    let VaultFactory = await ethers.getContractFactory(
      'DefiEdgeVaultFactory',
      {
        libraries: { DefiEdgeSharePriceProvider: oracleLibrary.address },
      }
    )
    vaultFactory = await VaultFactory.deploy(governance);

    let TestOracleShare = await ethers.getContractFactory(
      'TestOracleShare',
      {
        libraries: { DefiEdgeSharePriceProvider: oracleLibrary.address },
      }
    )
    testOracle = await TestOracleShare.deploy();


    await vaultFactory.createVault(
      und.address,
      signers[0].address,
      defiedgeStrategy.address,
      signers[1].address
    )

    ethDaiVault = await vaultFactory.vaultByIndex(1)
    ethDaiVault = await ethers.getContractAt('DefiEdgeVault', ethDaiVault)

    await tEth.connect(signers[0]).approve(defiedgeStrategy.address, expandTo18Decimals(150000000000));
    await tDai.connect(signers[0]).approve(defiedgeStrategy.address, expandTo18Decimals(150000000000));

    await defiedgeStrategy.mint(expandTo18Decimals(1), expandTo18Decimals(3500), 0, 0, 0);

    await ethDaiVault.changeLTV(LTV)
    await ethDaiVault.changeCR(CR)
    await ethDaiVault.changeFee(PROTOCOL_FEE)
    await ethDaiVault.changeStakeFee(stakeFee)

    await vaultFactory.enableVault(ethDaiVault.address)
    await und.addMinter(vaultFactory.address)

    await ethers.provider.send("evm_increaseTime", [259201])   // increase evm time by 3 days
    
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

    it('should set strategy address', async function () {
      expect(await ethDaiVault.strategy()).to.equal(defiedgeStrategy.address)
    })

    it('should set the ETH-DAI pool address', async function () {
      expect(await ethDaiVault.pair()).to.equal(ethDaiPool.address)
    })

    it('should set the decimals correctly', async function () {
      let token0 = await ethDaiPool.token0()
      let token1 = await ethDaiPool.token1()

      let token0Instance = await ethers.getContractAt('TestEth', token0)
      let token1Instance = await ethers.getContractAt('TestEth', token1)

      let token0Decimals = await token0Instance.decimals()
      let token1Decimals = await token1Instance.decimals()

      expect(await ethDaiVault.decimals(0)).to.equal(token0Decimals)
      expect(await ethDaiVault.decimals(1)).to.equal(token1Decimals)
    })

    it('should set the staking address correctly', async function () {
      expect(await ethDaiVault.staking()).to.equal(signers[1].address)
    })

    it('should set the factory address correctly', async function () {
      expect(await ethDaiVault.factory()).to.equal(vaultFactory.address)
    })

    it('should revert if utoken address is zero while creating vault', async function () {
      await expect(
        vaultFactory.createVault(
          zeroAddress,
          signers[0].address,
          defiedgeStrategy.address,
          signers[1].address
        )
      ).to.be.revertedWith('I')
    })
    it('should revert if strategy address is zero while creating vault', async function () {
      await expect(
        vaultFactory.createVault(
          und.address,
          signers[0].address,
          zeroAddress,
          signers[1].address
        )
      ).to.be.revertedWith('I')
    })

    it('should revert if strategy address is not valid', async function () {
        await expect(
          vaultFactory.createVault(
            und.address,
            signers[0].address,
            signers[1].address,
            signers[1].address
          )
        ).to.be.reverted;
    })
  })

  describe('#lock', async () => {

    it("should revert if owner doesn't have sufficient share balance", async function () {
      let ownerShareBalance = (
        await defiedgeStrategy.balanceOf(signers[0].address)
      ).toString()

      let lockAmount = new BigNumber(ownerShareBalance).plus('1').toFixed()

      await expect(
        ethDaiVault.lock(lockAmount, signers[0].address, '0')
      ).to.be.reverted
    })

    it('should revert if mintTo address is zeroAddress', async function () {
      let lockAmount = ethers.utils.parseEther('1').toString()

      await defiedgeStrategy.approve(ethDaiVault.address, lockAmount)

      await expect(
        ethDaiVault.lock(lockAmount, zeroAddress, '0')
      ).to.be.revertedWith('NO')
    })

    it('should revert if vault is not valid minter', async function () {
      await vaultFactory.disableVault(ethDaiVault.address)
      await ethers.provider.send("evm_increaseTime", [604801])   // increase evm time by 7 days
      await vaultFactory.executeDisableVault(ethDaiVault.address);

      let lockAmount = ethers.utils.parseEther('1').toString()

      await defiedgeStrategy.approve(ethDaiVault.address, lockAmount)

      await expect(
        ethDaiVault.lock(lockAmount, signers[0].address, '0')
      ).to.be.revertedWith('NA')
    })

    it('should revert if LTV is zero', async function () {
      await ethDaiVault.changeLTV("0")

      let lockAmount = ethers.utils.parseEther('1').toString()

      await defiedgeStrategy.approve(ethDaiVault.address, lockAmount)

      await expect(
        ethDaiVault.lock(lockAmount, signers[0].address, '0')
      ).to.be.revertedWith('NI')
    })

    it('should revert if minUTokenAmount is more then minted UND ', async function () {
      let lockAmount = ethers.utils.parseEther('1').toString()

      await defiedgeStrategy.approve(ethDaiVault.address, lockAmount)

      let sharePrice = await getOraclePriceForShare(
        defiedgeStrategy,
        ethDaiPool
      )
      
      let totalShareValueInUSD = new BigNumber(lockAmount)
      .multipliedBy(sharePrice.toString())
      .dividedBy(BASE)
      .toFixed()
      let mintAmount = new BigNumber(totalShareValueInUSD)
      .multipliedBy(LTV)
      .dividedBy(secondBase)
      .toFixed()
      let minUTokenAmount = new BigNumber(mintAmount).plus('1').toFixed()
 
      await expect(
        ethDaiVault
          .lock(lockAmount, signers[0].address, minUTokenAmount)
      ).to.be.revertedWith('MIN')
    })

    it('lock 1 LP first - should mint correct amount of UND to user account, staking adress & vault contract', async function () {
      let lockAmount = ethers.utils.parseEther('1').toString()

      await defiedgeStrategy.approve(ethDaiVault.address, lockAmount)

      let sharePrice = await getOraclePriceForShare(
        defiedgeStrategy,
        ethDaiPool
      )

      let totalLPTValueInUSD = new BigNumber(lockAmount)
        .multipliedBy(sharePrice.toString())
        .dividedBy(BASE)
        .toFixed()
      let mintAmount = new BigNumber(totalLPTValueInUSD)
        .multipliedBy(LTV)
        .dividedBy(secondBase)
        .toFixed()

      let protocolFee = new BigNumber(mintAmount)
        .multipliedBy(PROTOCOL_FEE)
        .dividedBy(secondBase)
        .toFixed(0)
      let stakeFees = new BigNumber(mintAmount)
        .multipliedBy(stakeFee)
        .dividedBy(secondBase)
        .toFixed(0)
      let finalMintAmount = (new BigNumber(mintAmount)
        .minus(protocolFee)
        .minus(stakeFees))
        .toFixed(0)

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
        .withArgs(zeroAddress, signers[1].address, stakeFees)
      expect(lock)
        .to.emit(und, 'Transfer')
        .withArgs(zeroAddress, signers[0].address, finalMintAmount)

      expect(lock)
        .to.emit(ethDaiVault, 'Lock')
        .withArgs(signers[0].address, lockAmount, finalMintAmount)

      expect(lock)
        .to.emit(defiedgeStrategy, 'Transfer')
        .withArgs(signers[0].address, ethDaiVault.address, lockAmount)

      expect(await und.balanceOf(ethDaiVault.address)).to.equal(protocolFee)
      expect(await und.balanceOf(signers[1].address)).to.equal(stakeFees)
      expect(await und.balanceOf(signers[0].address)).to.equal(finalMintAmount)
    })

    it('lock 6.79 LP first - should mint correct amount of UND to user account, staking adress & vault contract', async function () {
      let lockAmount = ethers.utils.parseEther('6.79').toString()

      await defiedgeStrategy.approve(ethDaiVault.address, lockAmount)

      let sharePrice = await getOraclePriceForShare(
        defiedgeStrategy,
        ethDaiPool
      )

      let totalShareValueInUSD = new BigNumber(lockAmount)
        .multipliedBy(sharePrice.toString())
        .dividedBy(BASE)
        .toFixed()
      let mintAmount = new BigNumber(totalShareValueInUSD)
        .multipliedBy(LTV)
        .dividedBy(secondBase)
        .toFixed()

      let protocolFee = new BigNumber(mintAmount)
        .multipliedBy(PROTOCOL_FEE)
        .dividedBy(secondBase)
        .toFixed(0)
      let stakeFees = new BigNumber(mintAmount)
        .multipliedBy(stakeFee)
        .dividedBy(secondBase)
        .toFixed(0)
      let finalMintAmount = (new BigNumber(mintAmount)
        .minus(protocolFee)
        .minus(stakeFees))
        .toFixed(0)

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
        .withArgs(zeroAddress, signers[1].address, stakeFees)
      expect(lock)
        .to.emit(und, 'Transfer')
        .withArgs(zeroAddress, signers[0].address, finalMintAmount)

      expect(lock)
        .to.emit(ethDaiVault, 'Lock')
        .withArgs(signers[0].address, lockAmount, finalMintAmount)

      expect(lock)
        .to.emit(defiedgeStrategy, 'Transfer')
        .withArgs(signers[0].address, ethDaiVault.address, lockAmount)

      expect(await und.balanceOf(ethDaiVault.address)).to.equal(protocolFee)
      expect(await und.balanceOf(signers[1].address)).to.equal(stakeFees)
      expect(await und.balanceOf(signers[0].address)).to.equal(finalMintAmount)
    })

    it('should store correct amount of collateral and debt amount', async function () {
      let lockAmount = ethers.utils.parseEther('1').toString()

      await defiedgeStrategy.approve(ethDaiVault.address, lockAmount)

      let sharePrice = await getOraclePriceForShare(
        defiedgeStrategy,
        ethDaiPool
      )

      let totalShareValueInUSD = new BigNumber(lockAmount)
        .multipliedBy(sharePrice.toString())
        .dividedBy(BASE)
        .toFixed()
      let mintAmount = new BigNumber(totalShareValueInUSD)
        .multipliedBy(LTV)
        .dividedBy(secondBase)
        .toFixed()

      let protocolFee = new BigNumber(mintAmount)
        .multipliedBy(PROTOCOL_FEE)
        .dividedBy(secondBase)
        .toFixed(0)
      let stakeFees = new BigNumber(mintAmount)
        .multipliedBy(stakeFee)
        .dividedBy(secondBase)
        .toFixed(0)
      let finalMintAmount = new BigNumber(mintAmount)
        .minus(protocolFee)
        .minus(stakeFees)
        .toFixed(0)

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

      await defiedgeStrategy.approve(ethDaiVault.address, lockAmount)

      let sharePrice = await getOraclePriceForShare(
        defiedgeStrategy,
        ethDaiPool
      )

      let totalShareValueInUSD = new BigNumber(lockAmount)
        .multipliedBy(sharePrice.toString())
        .dividedBy(BASE)
        .toFixed()
      let mintAmount = new BigNumber(totalShareValueInUSD)
        .multipliedBy(LTV)
        .dividedBy(secondBase)
        .toFixed()

      let protocolFee = new BigNumber(mintAmount)
        .multipliedBy(PROTOCOL_FEE)
        .dividedBy(secondBase)
        .toFixed(0)
      let stakeFees = new BigNumber(mintAmount)
        .multipliedBy(stakeFee)
        .dividedBy(secondBase)
        .toFixed(0)
      let finalMintAmount = new BigNumber(mintAmount)
        .minus(protocolFee)
        .minus(stakeFees)
        .toFixed(0)

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

      await defiedgeStrategy.approve(ethDaiVault.address, lockAmount)

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

      await defiedgeStrategy.approve(ethDaiVault.address, lockAmount)

      let sharePrice = await getOraclePriceForShare(
        defiedgeStrategy,
        ethDaiPool
      )
      let totalShareValueInUSD = new BigNumber(lockAmount)
        .multipliedBy(sharePrice.toString())
        .dividedBy(BASE)
        .toFixed()
      let mintAmount = new BigNumber(totalShareValueInUSD)
        .multipliedBy(LTV)
        .dividedBy(secondBase)
        .toFixed()

      let protocolFee = new BigNumber(mintAmount)
        .multipliedBy(PROTOCOL_FEE)
        .dividedBy(secondBase)
        .toFixed(0)
      let stakeFees = new BigNumber(mintAmount)
        .multipliedBy(stakeFee)
        .dividedBy(secondBase)
        .toFixed(0)
      let finalMintAmount = new BigNumber(mintAmount)
        .minus(protocolFee)
        .minus(stakeFees)
        .toFixed(0)

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

      await defiedgeStrategy.approve(ethDaiVault.address, lockAmount2)

      let totalShareValueInUSD2 = new BigNumber(lockAmount2)
        .multipliedBy(sharePrice.toString())
        .dividedBy(BASE)
        .toFixed()
      let mintAmount2 = new BigNumber(totalShareValueInUSD2)
        .multipliedBy(LTV)
        .dividedBy(secondBase)
        .toFixed(0)

      let protocolFee2 = new BigNumber(mintAmount2)
        .multipliedBy(PROTOCOL_FEE)
        .dividedBy(secondBase)
        .toFixed(0)
      let stakeFees2 = new BigNumber(mintAmount2)
        .multipliedBy(stakeFee)
        .dividedBy(secondBase)
        .toFixed(0)
      let finalMintAmount2 = new BigNumber(mintAmount2)
        .minus(protocolFee2)
        .minus(stakeFees2)
        .toFixed(0)

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
      await defiedgeStrategy.approve(ethDaiVault.address, lockAmount)
      await ethDaiVault.lock(lockAmount, signers[0].address, '1')

      // Transfer some extra und to user 0 to repay all debts
      let tAmount = ethers.utils.parseEther('10').toString()

      await defiedgeStrategy.transfer(signers[1].address, tAmount)
      await defiedgeStrategy
        .connect(signers[1])
        .approve(ethDaiVault.address, tAmount)
      await ethDaiVault
        .connect(signers[1])
        .lock(tAmount, signers[1].address, '1')
      let user1bal = await und.balanceOf(signers[1].address)
      await und.connect(signers[1]).transfer(signers[0].address, user1bal.toString())
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
      let shareBalanceBeforeU = (
        await defiedgeStrategy.balanceOf(signers[0].address)
      ).toString()

      let shareBalanceBeforeV = (
        await defiedgeStrategy.balanceOf(ethDaiVault.address)
      ).toString()

      await ethDaiVault.unlock(debt, collateral)

      let userExpectedUNDBal = new BigNumber(undBalanceBeforeU)
        .minus(debt)
        .toFixed()
      let userExpectedShareBal = new BigNumber(shareBalanceBeforeU)
        .plus(collateral)
        .toFixed()
      let vaultExpectedShareBal = new BigNumber(shareBalanceBeforeV)
        .minus(collateral)
        .toFixed()

      expect(await und.balanceOf(signers[0].address)).to.equal(
        userExpectedUNDBal
      )
      expect(await defiedgeStrategy.balanceOf(signers[0].address)).to.equal(
        userExpectedShareBal
      )
      expect(await defiedgeStrategy.balanceOf(ethDaiVault.address)).to.equal(
        vaultExpectedShareBal
      )
    })

    it('unlock - should emit unlock and burn event after repaying half debt', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      let halfDebt = new BigNumber(debt).dividedBy('2').toFixed(0)
      let halfCollateral = new BigNumber(collateral).dividedBy('2').minus("1").toFixed(0)

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

      let halfDebt = new BigNumber(debt).dividedBy('2').toFixed(0)
      let halfCollateral = new BigNumber(collateral).dividedBy('2').minus("1").toFixed(0)

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
      let shareBalanceBeforeU = (
        await defiedgeStrategy.balanceOf(signers[0].address)
      ).toString()

      let shareBalanceBeforeV = (
        await defiedgeStrategy.balanceOf(ethDaiVault.address)
      ).toString()

      let halfDebt = new BigNumber(debt).dividedBy('2').toFixed(0)
      let halfCollateral = new BigNumber(collateral).dividedBy('2').minus("1").toFixed(0)

      await ethDaiVault.unlock(halfDebt, halfCollateral)

      let userExpectedUNDBal = new BigNumber(undBalanceBeforeU)
        .minus(halfDebt)
        .toFixed()
      let userExpectedShareBal = new BigNumber(shareBalanceBeforeU)
        .plus(halfCollateral)
        .toFixed()
      let vaultExpectedShareBal = new BigNumber(shareBalanceBeforeV)
        .minus(halfCollateral)
        .toFixed()

      expect(await und.balanceOf(signers[0].address)).to.equal(
        userExpectedUNDBal
      )
      expect(await defiedgeStrategy.balanceOf(signers[0].address)).to.equal(
        userExpectedShareBal
      )
      expect(await defiedgeStrategy.balanceOf(ethDaiVault.address)).to.equal(
        vaultExpectedShareBal
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
      let shareBalanceBeforeU = (
        await defiedgeStrategy.balanceOf(signers[0].address)
      ).toString()

      let shareBalanceBeforeV = (
        await defiedgeStrategy.balanceOf(ethDaiVault.address)
      ).toString()

      let debtToBePaid = new BigNumber(debt).multipliedBy('0.1').toFixed(0) // 10%
      let collateralToBeReceived = new BigNumber(collateral)
        .multipliedBy(debtToBePaid)
        .dividedBy(debt)
        .toFixed(0) // 10%

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
      let userExpectedShareBal = new BigNumber(shareBalanceBeforeU)
        .plus(collateralToBeReceived)
        .toFixed()
      let vaultExpectedShareBal = new BigNumber(shareBalanceBeforeV)
        .minus(collateralToBeReceived)
        .toFixed()

      expect(await und.balanceOf(signers[0].address)).to.equal(
        userExpectedUNDBal
      )
      expect(await defiedgeStrategy.balanceOf(signers[0].address)).to.equal(
        userExpectedShareBal
      )
      expect(await defiedgeStrategy.balanceOf(ethDaiVault.address)).to.equal(
        vaultExpectedShareBal
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
      let shareBalanceBeforeU = (
        await defiedgeStrategy.balanceOf(signers[0].address)
      ).toString()

      let shareBalanceBeforeV = (
        await defiedgeStrategy.balanceOf(ethDaiVault.address)
      ).toString()

      let debtToBePaid = new BigNumber(debt).multipliedBy('0.27').toFixed(0) // 27%
      let collateralToBeReceived = new BigNumber(collateral)
        .multipliedBy(debtToBePaid)
        .dividedBy(debt)
        .toFixed(0) // 10%

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
      let userExpectedShareBal = new BigNumber(shareBalanceBeforeU)
        .plus(collateralToBeReceived)
        .toFixed()
      let vaultExpectedShareBal = new BigNumber(shareBalanceBeforeV)
        .minus(collateralToBeReceived)
        .toFixed()

      expect(await und.balanceOf(signers[0].address)).to.equal(
        userExpectedUNDBal
      )
      expect(await defiedgeStrategy.balanceOf(signers[0].address)).to.equal(
        userExpectedShareBal
      )
      expect(await defiedgeStrategy.balanceOf(ethDaiVault.address)).to.equal(
        vaultExpectedShareBal
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

    it('unlock - should update everything properly after repaying 48% debt', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      let undBalanceBeforeU = (
        await und.balanceOf(signers[0].address)
      ).toString()
      let shareBalanceBeforeU = (
        await defiedgeStrategy.balanceOf(signers[0].address)
      ).toString()

      let shareBalanceBeforeV = (
        await defiedgeStrategy.balanceOf(ethDaiVault.address)
      ).toString()

      let debtToBePaid = new BigNumber(debt).multipliedBy('0.48').toFixed(0) // 48%
      let collateralToBeReceived = new BigNumber(collateral)
        .multipliedBy(debtToBePaid)
        .dividedBy(debt)
        .toFixed(0) // 10%

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
      let userExpectedShareBal = new BigNumber(shareBalanceBeforeU)
        .plus(collateralToBeReceived)
        .toFixed()
      let vaultExpectedShareBal = new BigNumber(shareBalanceBeforeV)
        .minus(collateralToBeReceived)
        .toFixed()

      expect(await und.balanceOf(signers[0].address)).to.equal(
        userExpectedUNDBal
      )
      expect(await defiedgeStrategy.balanceOf(signers[0].address)).to.equal(
        userExpectedShareBal
      )
      expect(await defiedgeStrategy.balanceOf(ethDaiVault.address)).to.equal(
        vaultExpectedShareBal
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

    it('unlock - should update everything properly after repaying 73% debt', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      let undBalanceBeforeU = (
        await und.balanceOf(signers[0].address)
      ).toString()
      let shareBalanceBeforeU = (
        await defiedgeStrategy.balanceOf(signers[0].address)
      ).toString()

      let shareBalanceBeforeV = (
        await defiedgeStrategy.balanceOf(ethDaiVault.address)
      ).toString()

      let debtToBePaid = new BigNumber(debt).multipliedBy('0.73').toFixed(0) // 73%
      let collateralToBeReceived = new BigNumber(collateral)
        .multipliedBy(debtToBePaid)
        .dividedBy(debt)
        .toFixed(0) // 10%

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
      let userExpectedShareBal = new BigNumber(shareBalanceBeforeU)
        .plus(collateralToBeReceived)
        .toFixed()
      let vaultExpectedShareBal = new BigNumber(shareBalanceBeforeV)
        .minus(collateralToBeReceived)
        .toFixed()

      expect(await und.balanceOf(signers[0].address)).to.equal(
        userExpectedUNDBal
      )
      expect(await defiedgeStrategy.balanceOf(signers[0].address)).to.equal(
        userExpectedShareBal
      )
      expect(await defiedgeStrategy.balanceOf(ethDaiVault.address)).to.equal(
        vaultExpectedShareBal
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

    it('unlock - should update everything properly after repaying 89% debt', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      let undBalanceBeforeU = (
        await und.balanceOf(signers[0].address)
      ).toString()
      let shareBalanceBeforeU = (
        await defiedgeStrategy.balanceOf(signers[0].address)
      ).toString()

      let shareBalanceBeforeV = (
        await defiedgeStrategy.balanceOf(ethDaiVault.address)
      ).toString()

      let debtToBePaid = new BigNumber(debt).multipliedBy('0.89').toFixed(0) // 89%
      let collateralToBeReceived = new BigNumber(collateral)
        .multipliedBy(debtToBePaid)
        .dividedBy(debt)
        .toFixed(0) // 10%

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
      let userExpectedShareBal = new BigNumber(shareBalanceBeforeU)
        .plus(collateralToBeReceived)
        .toFixed()
      let vaultExpectedShareBal = new BigNumber(shareBalanceBeforeV)
        .minus(collateralToBeReceived)
        .toFixed()

      expect(await und.balanceOf(signers[0].address)).to.equal(
        userExpectedUNDBal
      )
      expect(await defiedgeStrategy.balanceOf(signers[0].address)).to.equal(
        userExpectedShareBal
      )
      expect(await defiedgeStrategy.balanceOf(ethDaiVault.address)).to.equal(
        vaultExpectedShareBal
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
      let shareBalanceBeforeU = (
        await defiedgeStrategy.balanceOf(signers[0].address)
      ).toString()

      let shareBalanceBeforeV = (
        await defiedgeStrategy.balanceOf(ethDaiVault.address)
      ).toString()

      let debtToBePaid = new BigNumber(debt).multipliedBy('0.35').toFixed(0) // 35%
      let collateralToBeReceived = new BigNumber(collateral)
        .multipliedBy(debtToBePaid)
        .dividedBy(debt)
        .toFixed(0) // 10%

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
      let userExpectedShareBal = new BigNumber(shareBalanceBeforeU)
        .plus(collateralToBeReceived)
        .toFixed()
      let vaultExpectedShareBal = new BigNumber(shareBalanceBeforeV)
        .minus(collateralToBeReceived)
        .toFixed()

      expect(await und.balanceOf(signers[0].address)).to.equal(
        userExpectedUNDBal
      )
      expect(await defiedgeStrategy.balanceOf(signers[0].address)).to.equal(
        userExpectedShareBal
      )
      expect(await defiedgeStrategy.balanceOf(ethDaiVault.address)).to.equal(
        vaultExpectedShareBal
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
      let userExpectedShareBalFinal = new BigNumber(userExpectedShareBal)
        .plus(secondHalfCollateral)
        .toFixed()
      let vaultExpectedShareBalFinal = new BigNumber(vaultExpectedShareBal)
        .minus(secondHalfCollateral)
        .toFixed()

      expect(await und.balanceOf(signers[0].address)).to.equal(
        userExpectedUNDBalFinal
      )
      expect(await defiedgeStrategy.balanceOf(signers[0].address)).to.equal(
        userExpectedShareBalFinal
      )
      expect(await defiedgeStrategy.balanceOf(ethDaiVault.address)).to.equal(
        vaultExpectedShareBalFinal
      )

      expect(await ethDaiVault.debt(signers[0].address)).to.equal('0')
      expect(await ethDaiVault.collateral(signers[0].address)).to.equal('0')
    })

    it('unlock - repaying all debt in two parts - first 13% and then 87%', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      let undBalanceBeforeU = (
        await und.balanceOf(signers[0].address)
      ).toString()
      let shareBalanceBeforeU = (
        await defiedgeStrategy.balanceOf(signers[0].address)
      ).toString()

      let shareBalanceBeforeV = (
        await defiedgeStrategy.balanceOf(ethDaiVault.address)
      ).toString()

      let debtToBePaid = new BigNumber(debt).multipliedBy('0.13').toFixed(0) // 13%
      let collateralToBeReceived = new BigNumber(collateral)
        .multipliedBy(debtToBePaid)
        .dividedBy(debt)
        .toFixed(0) // 10%

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
      let userExpectedShareBal = new BigNumber(shareBalanceBeforeU)
        .plus(collateralToBeReceived)
        .toFixed()
      let vaultExpectedShareBal = new BigNumber(shareBalanceBeforeV)
        .minus(collateralToBeReceived)
        .toFixed()

      expect(await und.balanceOf(signers[0].address)).to.equal(
        userExpectedUNDBal
      )
      expect(await defiedgeStrategy.balanceOf(signers[0].address)).to.equal(
        userExpectedShareBal
      )
      expect(await defiedgeStrategy.balanceOf(ethDaiVault.address)).to.equal(
        vaultExpectedShareBal
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
      let userExpectedShareBalFinal = new BigNumber(userExpectedShareBal)
        .plus(secondHalfCollateral)
        .toFixed()
      let vaultExpectedShareBalFinal = new BigNumber(vaultExpectedShareBal)
        .minus(secondHalfCollateral)
        .toFixed()

      expect(await und.balanceOf(signers[0].address)).to.equal(
        userExpectedUNDBalFinal
      )
      expect(await defiedgeStrategy.balanceOf(signers[0].address)).to.equal(
        userExpectedShareBalFinal
      )
      expect(await defiedgeStrategy.balanceOf(ethDaiVault.address)).to.equal(
        vaultExpectedShareBalFinal
      )

      expect(await ethDaiVault.debt(signers[0].address)).to.equal('0')
      expect(await ethDaiVault.collateral(signers[0].address)).to.equal('0')
    })

    it('unlock - repaying all debt in two parts - first 27% and then 73%', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      let undBalanceBeforeU = (
        await und.balanceOf(signers[0].address)
      ).toString()
      let shareBalanceBeforeU = (
        await defiedgeStrategy.balanceOf(signers[0].address)
      ).toString()

      let shareBalanceBeforeV = (
        await defiedgeStrategy.balanceOf(ethDaiVault.address)
      ).toString()

      let debtToBePaid = new BigNumber(debt).multipliedBy('0.27').toFixed(0) // 27%
      let collateralToBeReceived = new BigNumber(collateral)
        .multipliedBy(debtToBePaid)
        .dividedBy(debt)
        .toFixed(0) // 10%

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
      let userExpectedShareBal = new BigNumber(shareBalanceBeforeU)
        .plus(collateralToBeReceived)
        .toFixed()
      let vaultExpectedShareBal = new BigNumber(shareBalanceBeforeV)
        .minus(collateralToBeReceived)
        .toFixed()

      expect(await und.balanceOf(signers[0].address)).to.equal(
        userExpectedUNDBal
      )
      expect(await defiedgeStrategy.balanceOf(signers[0].address)).to.equal(
        userExpectedShareBal
      )
      expect(await defiedgeStrategy.balanceOf(ethDaiVault.address)).to.equal(
        vaultExpectedShareBal
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
      let userExpectedShareBalFinal = new BigNumber(userExpectedShareBal)
        .plus(secondHalfCollateral)
        .toFixed()
      let vaultExpectedShareBalFinal = new BigNumber(vaultExpectedShareBal)
        .minus(secondHalfCollateral)
        .toFixed()

      expect(await und.balanceOf(signers[0].address)).to.equal(
        userExpectedUNDBalFinal
      )
      expect(await defiedgeStrategy.balanceOf(signers[0].address)).to.equal(
        userExpectedShareBalFinal
      )
      expect(await defiedgeStrategy.balanceOf(ethDaiVault.address)).to.equal(
        vaultExpectedShareBalFinal
      )

      expect(await ethDaiVault.debt(signers[0].address)).to.equal('0')
      expect(await ethDaiVault.collateral(signers[0].address)).to.equal('0')
    })

    it('unlock - repaying all debt in two parts - first 32% and then 68%', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      let undBalanceBeforeU = (
        await und.balanceOf(signers[0].address)
      ).toString()
      let shareBalanceBeforeU = (
        await defiedgeStrategy.balanceOf(signers[0].address)
      ).toString()

      let shareBalanceBeforeV = (
        await defiedgeStrategy.balanceOf(ethDaiVault.address)
      ).toString()

      let debtToBePaid = new BigNumber(debt).multipliedBy('0.32').toFixed(0) // 32%
      let collateralToBeReceived = new BigNumber(collateral)
        .multipliedBy(debtToBePaid)
        .dividedBy(debt)
        .toFixed(0) // 10%

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
      let userExpectedShareBal = new BigNumber(shareBalanceBeforeU)
        .plus(collateralToBeReceived)
        .toFixed()
      let vaultExpectedShareBal = new BigNumber(shareBalanceBeforeV)
        .minus(collateralToBeReceived)
        .toFixed()

      expect(await und.balanceOf(signers[0].address)).to.equal(
        userExpectedUNDBal
      )
      expect(await defiedgeStrategy.balanceOf(signers[0].address)).to.equal(
        userExpectedShareBal
      )
      expect(await defiedgeStrategy.balanceOf(ethDaiVault.address)).to.equal(
        vaultExpectedShareBal
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
      let userExpectedShareBalFinal = new BigNumber(userExpectedShareBal)
        .plus(secondHalfCollateral)
        .toFixed()
      let vaultExpectedShareBalFinal = new BigNumber(vaultExpectedShareBal)
        .minus(secondHalfCollateral)
        .toFixed()

      expect(await und.balanceOf(signers[0].address)).to.equal(
        userExpectedUNDBalFinal
      )
      expect(await defiedgeStrategy.balanceOf(signers[0].address)).to.equal(
        userExpectedShareBalFinal
      )
      expect(await defiedgeStrategy.balanceOf(ethDaiVault.address)).to.equal(
        vaultExpectedShareBalFinal
      )

      expect(await ethDaiVault.debt(signers[0].address)).to.equal('0')
      expect(await ethDaiVault.collateral(signers[0].address)).to.equal('0')
    })

    it('unlock - repaying all debt in two parts - first 54% and then 46%', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      let undBalanceBeforeU = (
        await und.balanceOf(signers[0].address)
      ).toString()
      let shareBalanceBeforeU = (
        await defiedgeStrategy.balanceOf(signers[0].address)
      ).toString()

      let shareBalanceBeforeV = (
        await defiedgeStrategy.balanceOf(ethDaiVault.address)
      ).toString()

      let debtToBePaid = new BigNumber(debt).multipliedBy('0.54').toFixed(0) // 54%
      let collateralToBeReceived = new BigNumber(collateral)
        .multipliedBy(debtToBePaid)
        .dividedBy(debt)
        .toFixed(0) // 10%

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
      let userExpectedShareBal = new BigNumber(shareBalanceBeforeU)
        .plus(collateralToBeReceived)
        .toFixed()
      let vaultExpectedShareBal = new BigNumber(shareBalanceBeforeV)
        .minus(collateralToBeReceived)
        .toFixed()

      expect(await und.balanceOf(signers[0].address)).to.equal(
        userExpectedUNDBal
      )
      expect(await defiedgeStrategy.balanceOf(signers[0].address)).to.equal(
        userExpectedShareBal
      )
      expect(await defiedgeStrategy.balanceOf(ethDaiVault.address)).to.equal(
        vaultExpectedShareBal
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
      let userExpectedShareBalFinal = new BigNumber(userExpectedShareBal)
        .plus(secondHalfCollateral)
        .toFixed()
      let vaultExpectedShareBalFinal = new BigNumber(vaultExpectedShareBal)
        .minus(secondHalfCollateral)
        .toFixed()

      expect(await und.balanceOf(signers[0].address)).to.equal(
        userExpectedUNDBalFinal
      )
      expect(await defiedgeStrategy.balanceOf(signers[0].address)).to.equal(
        userExpectedShareBalFinal
      )
      expect(await defiedgeStrategy.balanceOf(ethDaiVault.address)).to.equal(
        vaultExpectedShareBalFinal
      )

      expect(await ethDaiVault.debt(signers[0].address)).to.equal('0')
      expect(await ethDaiVault.collateral(signers[0].address)).to.equal('0')
    })

    it('unlock - repaying all debt in two parts - first 79% and then 21%', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      let undBalanceBeforeU = (
        await und.balanceOf(signers[0].address)
      ).toString()
      let shareBalanceBeforeU = (
        await defiedgeStrategy.balanceOf(signers[0].address)
      ).toString()

      let shareBalanceBeforeV = (
        await defiedgeStrategy.balanceOf(ethDaiVault.address)
      ).toString()

      let debtToBePaid = new BigNumber(debt).multipliedBy('0.79').toFixed(0) // 79%
      let collateralToBeReceived = new BigNumber(collateral)
        .multipliedBy(debtToBePaid)
        .dividedBy(debt)
        .toFixed(0) // 10%

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
      let userExpectedShareBal = new BigNumber(shareBalanceBeforeU)
        .plus(collateralToBeReceived)
        .toFixed()
      let vaultExpectedShareBal = new BigNumber(shareBalanceBeforeV)
        .minus(collateralToBeReceived)
        .toFixed()

      expect(await und.balanceOf(signers[0].address)).to.equal(
        userExpectedUNDBal
      )
      expect(await defiedgeStrategy.balanceOf(signers[0].address)).to.equal(
        userExpectedShareBal
      )
      expect(await defiedgeStrategy.balanceOf(ethDaiVault.address)).to.equal(
        vaultExpectedShareBal
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
      let userExpectedShareBalFinal = new BigNumber(userExpectedShareBal)
        .plus(secondHalfCollateral)
        .toFixed()
      let vaultExpectedShareBalFinal = new BigNumber(vaultExpectedShareBal)
        .minus(secondHalfCollateral)
        .toFixed()

      expect(await und.balanceOf(signers[0].address)).to.equal(
        userExpectedUNDBalFinal
      )
      expect(await defiedgeStrategy.balanceOf(signers[0].address)).to.equal(
        userExpectedShareBalFinal
      )
      expect(await defiedgeStrategy.balanceOf(ethDaiVault.address)).to.equal(
        vaultExpectedShareBalFinal
      )

      expect(await ethDaiVault.debt(signers[0].address)).to.equal('0')
      expect(await ethDaiVault.collateral(signers[0].address)).to.equal('0')
    })

    it('unlock - repaying all debt in two parts - first 87% and then 13%', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      let undBalanceBeforeU = (
        await und.balanceOf(signers[0].address)
      ).toString()
      let shareBalanceBeforeU = (
        await defiedgeStrategy.balanceOf(signers[0].address)
      ).toString()

      let shareBalanceBeforeV = (
        await defiedgeStrategy.balanceOf(ethDaiVault.address)
      ).toString()

      let debtToBePaid = new BigNumber(debt).multipliedBy('0.87').toFixed(0) // 87%
      let collateralToBeReceived = new BigNumber(collateral)
        .multipliedBy(debtToBePaid)
        .dividedBy(debt)
        .toFixed(0) // 10%

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
      let userExpectedShareBal = new BigNumber(shareBalanceBeforeU)
        .plus(collateralToBeReceived)
        .toFixed()
      let vaultExpectedShareBal = new BigNumber(shareBalanceBeforeV)
        .minus(collateralToBeReceived)
        .toFixed()

      expect(await und.balanceOf(signers[0].address)).to.equal(
        userExpectedUNDBal
      )
      expect(await defiedgeStrategy.balanceOf(signers[0].address)).to.equal(
        userExpectedShareBal
      )
      expect(await defiedgeStrategy.balanceOf(ethDaiVault.address)).to.equal(
        vaultExpectedShareBal
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
      let userExpectedShareBalFinal = new BigNumber(userExpectedShareBal)
        .plus(secondHalfCollateral)
        .toFixed()
      let vaultExpectedShareBalFinal = new BigNumber(vaultExpectedShareBal)
        .minus(secondHalfCollateral)
        .toFixed()

      expect(await und.balanceOf(signers[0].address)).to.equal(
        userExpectedUNDBalFinal
      )
      expect(await defiedgeStrategy.balanceOf(signers[0].address)).to.equal(
        userExpectedShareBalFinal
      )
      expect(await defiedgeStrategy.balanceOf(ethDaiVault.address)).to.equal(
        vaultExpectedShareBalFinal
      )

      expect(await ethDaiVault.debt(signers[0].address)).to.equal('0')
      expect(await ethDaiVault.collateral(signers[0].address)).to.equal('0')
    })

  })

  describe('#emergencyUnlock', async () => {
    beforeEach(async function () {
      let lockAmount = ethers.utils.parseEther('1').toString()
      await defiedgeStrategy.approve(ethDaiVault.address, lockAmount)
      await ethDaiVault.lock(lockAmount, signers[0].address, '1')

      // Transfer some extra und to user 0 to repay all debts
      let tAmount = ethers.utils.parseEther('10').toString()

      await defiedgeStrategy.transfer(signers[1].address, tAmount)
      await defiedgeStrategy
        .connect(signers[1])
        .approve(ethDaiVault.address, tAmount)
      await ethDaiVault
        .connect(signers[1])
        .lock(tAmount, signers[1].address, '1')
      let user1bal = await und.balanceOf(signers[1].address)
      await und.connect(signers[1]).transfer(signers[0].address, user1bal.toString())
    })

    it('should revert if user balance if less then debt', async () => {
      let userbal = await und.balanceOf(signers[0].address)

      await und.transfer(signers[1].address, userbal.toString())

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
      let shareBalanceBeforeU = (
        await defiedgeStrategy.balanceOf(signers[0].address)
      ).toString()

      let shareBalanceBeforeV = (
        await defiedgeStrategy.balanceOf(ethDaiVault.address)
      ).toString()

      await ethDaiVault.emergencyUnlock()

      let userExpectedUNDBal = new BigNumber(undBalanceBeforeU)
        .minus(debt)
        .toFixed()
      let userExpectedShareBal = new BigNumber(shareBalanceBeforeU)
        .plus(collateral)
        .toFixed()
      let vaultExpectedShareBal = new BigNumber(shareBalanceBeforeV)
        .minus(collateral)
        .toFixed()

      expect(await und.balanceOf(signers[0].address)).to.equal(
        userExpectedUNDBal
      )
      expect(await defiedgeStrategy.balanceOf(signers[0].address)).to.equal(
        userExpectedShareBal
      )
      expect(await defiedgeStrategy.balanceOf(ethDaiVault.address)).to.equal(
        vaultExpectedShareBal
      )
    })
  })

  describe('#distributeFee', function () {
    beforeEach(async function () {
      let lockAmount = ethers.utils.parseEther('1').toString()
      await defiedgeStrategy.approve(ethDaiVault.address, lockAmount)
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
        .toFixed(0)
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
        '0'
      )
    })
  })

  describe('#getTokenreturn', async () => {
    beforeEach(async function () {
      let lockAmount = ethers.utils.parseEther('1').toString()
      await defiedgeStrategy.approve(ethDaiVault.address, lockAmount)
      await ethDaiVault.lock(lockAmount, signers[0].address, '1')

      // Transfer some extra und to user 0 to repay all debts
      let tAmount = ethers.utils.parseEther('10').toString()

      await defiedgeStrategy.transfer(signers[1].address, tAmount)
      await defiedgeStrategy
        .connect(signers[1])
        .approve(ethDaiVault.address, tAmount)
      await ethDaiVault
        .connect(signers[1])
        .lock(tAmount, signers[1].address, '1')
      let user1bal = await und.balanceOf(signers[1].address)
      await und.connect(signers[1]).transfer(signers[0].address, user1bal.toString())
    })


    it('repay 90% debt - should receive exact collateral amount', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      let sharePrice = await getOraclePriceForShare(
        defiedgeStrategy,
        ethDaiPool
      )
      console.log("sharePrice: " + sharePrice) // $1.000289665238367602
      
      let currentCr = new BigNumber(sharePrice)
        .multipliedBy(collateral)
        .multipliedBy(secondBase)
        .dividedBy(debt)
        .dividedBy(BASE)
        .toFixed()
      console.log("currentCr: " + currentCr)

      expect(currentCr).to.equal(CR, "Invalid CR ratio. Should be 200%") // collateral - 200%

      let debtToBePaid = new BigNumber(debt).multipliedBy('0.9').toFixed(0) // 90%

      let collateralToBeReceived = (new BigNumber(collateral).multipliedBy(debtToBePaid).dividedBy(debt)).toFixed(0)
      
      let burn = await ethDaiVault.unlock(debtToBePaid, collateralToBeReceived)

      expect(burn)
        .to.emit(ethDaiVault, 'Unlock')
        .withArgs(signers[0].address, collateralToBeReceived, debtToBePaid)
    })

    it('repay 50% debt - should receive exact collateral amount', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      let sharePrice = await getOraclePriceForShare(
        defiedgeStrategy,
        ethDaiPool
      )
      // console.log("sharePrice: " + sharePrice) // $1.000289665238367602
      
      let currentCr = new BigNumber(sharePrice)
        .multipliedBy(collateral)
        .multipliedBy(secondBase)
        .dividedBy(debt)
        .dividedBy(BASE)
        .toFixed()
      // console.log("currentCr: " + currentCr)

      expect(currentCr).to.equal(CR, "Invalid CR ratio. Should be 200%") // collateral - 200%

      let debtToBePaid = new BigNumber(debt).multipliedBy('0.5').toFixed(0) // 50%

      let collateralToBeReceived = (new BigNumber(collateral).multipliedBy(debtToBePaid).dividedBy(debt)).toFixed(0)
      
      let burn = await ethDaiVault.unlock(debtToBePaid, collateralToBeReceived)

      expect(burn)
        .to.emit(ethDaiVault, 'Unlock')
        .withArgs(signers[0].address, collateralToBeReceived, debtToBePaid)
    })

    it('unlock - pay 30% debt & check remaining debt & collateral value', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()


      let sharePrice = await getOraclePriceForShare(
        defiedgeStrategy,
        ethDaiPool
      )

      // console.log("sharePrice: " + sharePrice) // $1.000289665238367602

      let currentCr = new BigNumber(sharePrice)
        .multipliedBy(collateral)
        .multipliedBy(secondBase)
        .dividedBy(debt)
        .dividedBy(BASE)
      console.log('current cr: ' + currentCr)

      expect(currentCr.toFixed()).to.equal(CR, "Invalid CR ratio. Should be 200%") // enough collateral - 200%

      let debtToBePaid = new BigNumber(debt).multipliedBy('0.3').toFixed(0) // 30%

      let collateralToBeReceived = (new BigNumber(collateral).multipliedBy(debtToBePaid).dividedBy(debt)).toFixed(0)
      
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
        .multipliedBy(sharePrice)
        .dividedBy(BASE)
      let requiredDebt = new BigNumber(debtAfter)
        .multipliedBy(CR)
        .dividedBy(secondBase)

      console.log('debt After: ' + debtAfter)
      console.log('collateral After: ' + collateralAfter)
      console.log('remaining debt value usd: ' + requiredDebt.toFixed())
      console.log(
        'remaining collateral value usd: ' +
          remainingcollateralValueUSD.toFixed(0)
      )

      let currentCr2 = new BigNumber(sharePrice)
        .multipliedBy(collateralAfter)
        .multipliedBy(secondBase)
        .dividedBy(debtAfter)
        .dividedBy(BASE)
      console.log('current cr2: ' + currentCr2.toFixed(0))

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

      let sharePrice = await getOraclePriceForShare(
        defiedgeStrategy,
        ethDaiPool
      )

      // console.log("sharePrice: " + sharePrice) // $1.000289665238367602

      let currentCr = new BigNumber(sharePrice)
        .multipliedBy(collateral)
        .multipliedBy(secondBase)
        .dividedBy(debt)
        .dividedBy(BASE)
      console.log('current cr: ' + currentCr.toFixed())

      expect(currentCr.toFixed()).to.equal(CR, "Invalid CR ratio. Should be 200%") // enough collateral - 200%

      let debtToBePaid = new BigNumber(debt).multipliedBy('0.44').toFixed(0) // 44%

      let collateralToBeReceived = (new BigNumber(collateral).multipliedBy(debtToBePaid).dividedBy(debt)).toFixed(0)
      
      let burn = await ethDaiVault.unlock(debtToBePaid, collateralToBeReceived)

      expect(burn)
        .to.emit(ethDaiVault, 'Unlock')
        .withArgs(signers[0].address, collateralToBeReceived, debtToBePaid)

      let debtAfter = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateralAfter = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      let currentCr2 = new BigNumber(sharePrice)
        .multipliedBy(collateralAfter)
        .multipliedBy(secondBase)
        .dividedBy(debtAfter)
        .dividedBy(BASE)
        .toFixed(0)
      console.log('current cr2: ' + currentCr2)


      expect(currentCr2).to.equal(
        CR,
        'Invalid user cr ratio after unlock'
      )
    })

    it('unlock - verify getTokenreturn - insufficient collateral - check user cr ratio after unlock. cr ratio shoul be same', async function () {
      let debt = (await ethDaiVault.debt(signers[0].address)).toString()
      let collateral = (
        await ethDaiVault.collateral(signers[0].address)
      ).toString()

      let sharePrice = await getOraclePriceForShare(
        defiedgeStrategy,
        ethDaiPool
      )

      // console.log("sharePrice: " + sharePrice) // $1.000289665238367602

      let currentCr = new BigNumber(sharePrice)
        .multipliedBy(collateral)
        .multipliedBy(secondBase)
        .dividedBy(debt)
        .dividedBy(BASE)
      console.log('current cr: ' + currentCr.toFixed())

      expect(currentCr.toFixed(0)).to.equal(CR, "Invalid CR ratio. Should be 200%") // collateral - 200%

      let debtToBePaid = new BigNumber(debt).multipliedBy('0.05').toFixed(0) // 5%

      let valueStart = (new BigNumber(sharePrice).multipliedBy(collateral)).toFixed()
      let loanAfter = (new BigNumber(debt).minus(debtToBePaid)).toFixed()
      let valueAfter = (new BigNumber(CR).multipliedBy(loanAfter).multipliedBy(BASE).div(secondBase)).toFixed(0)
      let collateralToBeReceived = ((new BigNumber(valueStart).minus(valueAfter)).div(sharePrice)).toFixed(0)

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

      let currentCr2 = new BigNumber(sharePrice)
        .multipliedBy(collateralAfter)
        .multipliedBy(secondBase)
        .dividedBy(debtAfter)
        .dividedBy(BASE)
      console.log('current cr2: ' + currentCr2.toFixed())


      expect(currentCr2.toFixed(0)).to.equal(
        currentCr.toFixed(0),
        'Invalid user cr ratio'
      )
    })

  })


 
})

async function getOraclePriceForShare(strategy, pool) {
  return new Promise(async function (resolve, reject) {
    let token0 = await pool.token0()
    let token1 = await pool.token1()


    let token0Instance = await ethers.getContractAt('TestEth', token0)
    let token1Instance = await ethers.getContractAt('TestEth', token1)

    let token0Decimals = await token0Instance.decimals()
    let token1Decimals = await token1Instance.decimals()

    // console.log(oracleLibrary)
    let tx = await testOracle.getPriceForShare(
      strategy.address,
      [token0Decimals, token1Decimals],
    )
    let price = await tx.wait()
    // console.log(price.events[1].args.reserve0.toString())
    // console.log(price.events[1].args.reserve1.toString())
    // console.log(price.events[1].args.price.toString())
    resolve(price.events[1].args.price.toString())
  })
}
