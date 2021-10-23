const { expect } = require("chai");
const { ethers } = require("hardhat");

const FACTORY = require('@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json')
const POOL = require('@uniswap/v3-core/artifacts/contracts/UniswapV3Pool.sol/UniswapV3Pool.json')

const { encodePriceSqrt, expandTo18Decimals, calculateTick, expandToString } = require('./helpers/utils')

const zeroAddress = "0x0000000000000000000000000000000000000000";
const ethPrice = "320000000000"; // $3200

let signers;
let governance;

let und;
let tEth;
let tDai;
let weth;
let uniswapFactory;
let uniswapRouter;
let ethDaiPair;
let undDaiPair;
let vaultFactory;
let oracleLibrary;

let feedEthUsd;

let uniswapV3Factory;
let ethDaiPool;
let defiedgeStrategyFactory;
let defiedgeStrategy;

describe("DefiEdgeVaultFactory", function() {

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

    });

    describe("#constructor", async () => {
        it("should set the governance address", async function() { 
            expect(await vaultFactory.governance()).to.equal(governance);
        });
    });

    describe("#changeGovernance", function() {
        it("should revert if not called by governance", async function() { 
            await expect(vaultFactory.connect(signers[1]).changeGovernance(signers[1].address))
                .to.be.revertedWith("NA");
        });
        it("should set pending governance as new governance address", async () => {
            await vaultFactory.changeGovernance(signers[1].address);
            expect(await vaultFactory.pendingGovernance()).to.equal(signers[1].address);
        });
        it("should emit change governance event", async function() { 
            await expect(vaultFactory.changeGovernance(signers[1].address))
                .to.emit(vaultFactory, "ChangeGovernance")
                .withArgs(signers[1].address);
        })
    })

    describe("#acceptGovernance", async () => {
        it("should revert if caller is not pending governance", async () => {
            expect(vaultFactory.acceptGovernance()).to.be.reverted;
        });
        it("should set governance as pending governance", async () => {
            await vaultFactory.changeGovernance(signers[1].address);
            expect(await vaultFactory.pendingGovernance()).to.equal(signers[1].address);
        });
        it("should revert if not accepted by pending governance", async () => {
            await vaultFactory.changeGovernance(signers[1].address);
            await expect(vaultFactory.acceptGovernance()).to.be.revertedWith("NA");
        });
        it("should set new governance address", async () => {
            await vaultFactory.changeGovernance(signers[1].address);
            await vaultFactory.connect(signers[1]).acceptGovernance()
            expect(await vaultFactory.governance()).to.equal(signers[1].address);
        });
  });

  describe("#createVault", async () => {
    it("should create vault with valid index", async () => {
        await vaultFactory.createVault(
            und.address,
            signers[0].address,
            defiedgeStrategy.address,
            signers[1].address
        )

        expect(await vaultFactory.index()).to.be.equal(1);

        expect(await vaultFactory.vaults(await vaultFactory.vaultByIndex(1))).to.be.equal(true)

    });

    it("should emit new vault event", async function() { 

        let tx = await vaultFactory.createVault(
            und.address,
            signers[0].address,
            defiedgeStrategy.address,
            signers[1].address
        )

        let vault = await vaultFactory.vaultByIndex(1)

        expect(tx).to.emit(vaultFactory, "NewVault").withArgs(vault, 1);
    })

  })

  describe("#enableVault", async () => {

    it("should revert if caller is not governance", async () => {
        await expect(
            vaultFactory
                .connect(signers[1])
                .enableVault(zeroAddress)
        ).to.be.revertedWith('NA');
    });

    it("should revert if vault address is not valid", async () => {
        await expect(
            vaultFactory.enableVault(zeroAddress)
        ).to.be.reverted;
    });

    it("should allow vault", async () => {

        await vaultFactory.createVault(
            und.address,
            signers[0].address,
            defiedgeStrategy.address,
            signers[1].address
        )

        let vault = await vaultFactory.vaultByIndex(1);

        await vaultFactory.enableVault(vault);

        expect(await vaultFactory.allowed(vault)).to.be.equal(true);

    });

    it("should emit enable vault event", async function() { 
        
        await vaultFactory.createVault(
            und.address,
            signers[0].address,
            defiedgeStrategy.address,
            signers[1].address
        )

        let vault = await vaultFactory.vaultByIndex(1);

        await expect(vaultFactory.enableVault(vault))
            .to.emit(vaultFactory, "EnableVault")
            .withArgs(vault);
    });

  })

  describe("#disableVault", async () => {
    let vault;

    beforeEach(async function () {
        await vaultFactory.createVault(
            und.address,
            signers[0].address,
            defiedgeStrategy.address,
            signers[1].address
        )

        vault = await vaultFactory.vaultByIndex(1);

        await vaultFactory.enableVault(vault);
    })

    it("should revert if caller is not governance", async () => {
        await expect(
            vaultFactory
                .connect(signers[1])
                .disableVault(vault)
        ).to.be.revertedWith('NA');
    });

    it("should disable vault", async () => {

        expect(await vaultFactory.allowed(vault)).to.be.equal(true);

        await vaultFactory.disableVault(vault);

        expect(await vaultFactory.allowed(vault)).to.be.equal(false);

    });

    it("should emit disable vault event", async function() { 

        await expect(vaultFactory.disableVault(vault))
            .to.emit(vaultFactory, "DisableVault")
            .withArgs(vault);
    })

  })

  describe("#setPause", async () => {
    it("should revert is caller is not owner", async function() { 
        await expect(vaultFactory.connect(signers[1]).setPause()).to.be.revertedWith("NA");            
    });
    it("should pause contract", async function() { 
        await vaultFactory.setPause();            
        expect(await vaultFactory.paused()).to.equal(true);
    });
    it("should revert if craeteVault when contract is paused", async function() { 
        await vaultFactory.setPause();  

        await expect(
            vaultFactory.createVault(
                und.address,
                signers[0].address,
                defiedgeStrategy.address,
                signers[1].address
            )
        ).to.be.revertedWith("Pausable: paused");
    });
  })

  describe("#setUnpause", async () => {
    it("should revert is caller is not owner", async function() { 
        await expect(vaultFactory.connect(signers[1]).setUnpause()).to.be.revertedWith("NA");            
    });
    it("should unpause contract", async function() { 
        await vaultFactory.setPause();            
        expect(await vaultFactory.paused()).to.equal(true);

        await vaultFactory.setUnpause();            
        expect(await vaultFactory.paused()).to.equal(false);
    });
    it("should revert if craeteVault when contract is paused and can create once contract is unpaused", async function() { 
        await vaultFactory.setPause();  
                  
        await expect(
            vaultFactory.createVault(
                und.address,
                signers[0].address,
                defiedgeStrategy.address,
                signers[1].address
            )
        ).to.be.revertedWith("Pausable: paused");

        await vaultFactory.setUnpause();  

        await expect(vaultFactory.createVault(
            und.address,
            signers[0].address,
            defiedgeStrategy.address,
            signers[1].address
        )).to.emit(vaultFactory, "NewVault");

    });
  })
    
});
