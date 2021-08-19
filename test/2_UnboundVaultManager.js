const { expect } = require("chai");
const { ethers } = require("hardhat");

const zeroAddress = "0x0000000000000000000000000000000000000000";

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
let ethDaiVault;

describe("UnboundVaultManager", function() {

    beforeEach(async function () {
        signers = await ethers.getSigners();
        governance = signers[0].address;

        let Oracle = await ethers.getContractFactory("UniswapV2PriceProvider");
        oracleLibrary = await Oracle.deploy();

        let VaultFactory = await ethers.getContractFactory("UniswapV2VaultFactory", {
            libraries: { UniswapV2PriceProvider: oracleLibrary.address }
        });
        
        vaultFactory = await VaultFactory.deploy(governance);

        let UniswapV2Factory = await ethers.getContractFactory("UniswapV2Factory");
        uniswapFactory = await UniswapV2Factory.deploy(zeroAddress);

        let WETH9 = await ethers.getContractFactory("WETH9");
        weth = await WETH9.deploy();

        let UniswapV2Router02 = await ethers.getContractFactory("UniswapV2Router02");
        uniswapRouter = await UniswapV2Router02.deploy(uniswapFactory.address, weth.address);

        let UnboundToken = await ethers.getContractFactory("UnboundToken");
        und = await UnboundToken.deploy(signers[0].address);

        let TestEth = await ethers.getContractFactory("TestEth");
        tEth = await TestEth.deploy(signers[0].address);

        let TestDai = await ethers.getContractFactory("TestDai");
        tDai = await TestDai.deploy(signers[0].address, "1337");

        await uniswapFactory.createPair(und.address, tDai.address); 
        await uniswapFactory.createPair(tEth.address, tDai.address);

        undDaiPair = await uniswapFactory.getPair(und.address, tDai.address)
        ethDaiPair = await uniswapFactory.getPair(tEth.address, tDai.address)

        let TestAggregatorProxyEthUsd = await ethers.getContractFactory("TestAggregatorProxyEthUsd");
        feedEthUsd = await TestAggregatorProxyEthUsd.deploy();
        feedEthUsd.setPrice("300000000000") // 1 ETH = $3000

        await vaultFactory.createVault(
            ethDaiPair,
            tDai.address,
            [feedEthUsd.address],
            "900000000000000000",
            5000,
            undDaiPair
        );

        ethDaiVault = await vaultFactory.vaultByIndex(1);
        ethDaiVault = await ethers.getContractAt("UniswapV2Vault", ethDaiVault);

    });

    describe("#staticVariables", async () => {
        it("should set correct factory address", async function() { 
            expect(await ethDaiVault.factory()).to.equal(vaultFactory.address);
        });
        it("should set correct lpt pool address", async function() { 
            expect(await ethDaiVault.pair()).to.equal(ethDaiPair);
        });
        it("should set correct und token address", async function() { 
            expect(await ethDaiVault.uToken()).to.equal(und.address);
        });
        it("should set correct governance address", async function() { 
            expect(await ethDaiVault.governance()).to.equal(signers[0].address);
        });
    });
    
});
