const { expect } = require("chai");
const { ethers } = require("hardhat");
const { MAX_UINT_AMOUNT } = require('./helpers/contract-helpers')
const BigNumber = require('bignumber.js');

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

const LTV = "50000000" // 50%


describe("UnboundToken", function() {

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

        ethDaiPair = await ethers.getContractAt("UniswapV2Pair", ethDaiPair);

        let daiAmount = ethers.utils.parseEther(((Number(ethPrice) / 100000000) * 1).toString()).toString();
        let ethAmount = ethers.utils.parseEther("1").toString();

        await tDai.approve(uniswapRouter.address, daiAmount);
        await tEth.approve(uniswapRouter.address, ethAmount);

        await uniswapRouter.addLiquidity(
            tDai.address,
            tEth.address,
            daiAmount,
            ethAmount,
            daiAmount,
            ethAmount,
            signers[0].address,
            MAX_UINT_AMOUNT
        );

        let TestAggregatorProxyEthUsd = await ethers.getContractFactory("TestAggregatorProxyEthUsd");
        feedEthUsd = await TestAggregatorProxyEthUsd.deploy();
        await feedEthUsd.setPrice(ethPrice) // 1 ETH = $3200

        await vaultFactory.createVault(
            und.address,
            signers[0].address,
            ethDaiPair.address,
            tDai.address,
            [feedEthUsd.address],
            "900000000000000000", // 10%
            5000,
            undDaiPair
        );

        ethDaiVault = await vaultFactory.vaultByIndex(1);
        ethDaiVault = await ethers.getContractAt("UniswapV2Vault", ethDaiVault);

        await ethDaiVault.changeLTV(LTV)
        await ethDaiVault.enableYieldWalletFactory(zeroAddress);
        await vaultFactory.enableVault(ethDaiVault.address);

        await und.addMinter(vaultFactory.address);
        await ethers.provider.send("evm_increaseTime", [604800])   // increase evm time by 7 days
        await und.enableMinter(vaultFactory.address);

    });

    describe("#constructor", async () => {
        it("should set the governance address", async function() { 
            expect(await und.governance()).to.equal(governance);
        });
    });

    describe("#staticVariables", async () => {
        it("should return valid name", async function() { 
            expect(await und.name()).to.equal("Unbound Dollar");
        });
        it("should return valid symbol", async function() { 
            expect(await und.symbol()).to.equal("UND");
        });
        it("should return valid total supply", async function() { 
            expect(await und.totalSupply()).to.equal("0");
        });
    })

    describe("#changeGovernance", function() {
        it("should revert if not called by governance", async function() { 
            await expect(und.connect(signers[1]).changeGovernance(signers[1].address))
                .to.be.revertedWith("NA");
        });
        it("should set pending governance as new governance address", async () => {
            await und.changeGovernance(signers[1].address);
            expect(await und.pendingGovernance()).to.equal(signers[1].address);
        });
        it("should emit change governance event", async () => {
            await expect(
                und.changeGovernance(signers[1].address))
                .to.emit(und, "ChangeGovernance")
                .withArgs(signers[1].address)
        });
    })

    describe("#acceptGovernance", async () => {
        it("should revert if caller is not pending governance", async () => {
            expect(und.acceptGovernance()).to.be.reverted;
        });
        it("should set governance as pending governance", async () => {
            await und.changeGovernance(signers[1].address);
            expect(await und.pendingGovernance()).to.equal(signers[1].address);
        });
        it("should revert if not accepted by pending governance", async () => {
            await und.changeGovernance(signers[1].address);
            await expect(und.acceptGovernance()).to.be.revertedWith("NA");
        });
        it("should set new governance address", async () => {
            await und.changeGovernance(signers[1].address);
            await und.connect(signers[1]).acceptGovernance()
            expect(await und.governance()).to.equal(signers[1].address);
        });
    });

    describe("#addMinter", function() {
        it("should revert if not called by governance", async function() { 
            await expect(und.connect(signers[1]).addMinter(zeroAddress))
                .to.be.revertedWith("NA");
        });
        it("should add minter with valid block timestamp", async () => {
            let tx = await und.addMinter(zeroAddress);
            let result = await tx.wait();

            let timestamp = (await ethers.provider.getBlock(result.blockNumber)).timestamp

            expect(await und.addTime(zeroAddress)).to.equal(timestamp);
        });

        it("should emit add minter event", async () => {
            await expect(
                und.addMinter(zeroAddress))
                .to.emit(und, "AddMinter")
                .withArgs(zeroAddress)
        });
    })

    describe("#enableMinter", function() {

        beforeEach(async function () {
            await und.addMinter(zeroAddress);
        })

        it("should revert if not called by governance", async function() { 
            await expect(und.connect(signers[1]).enableMinter(zeroAddress))
                .to.be.revertedWith("NA");
        });

        it("should revert if enable before 7 days", async () => {
            await expect(und.enableMinter(zeroAddress)).to.be.reverted;
        });
        
        it("should enable minter 7 days", async () => {

            await ethers.provider.send("evm_increaseTime", [604800])   // increase evm time by 7 days
            await und.enableMinter(zeroAddress);

            expect(await und.minters(zeroAddress)).to.equal(true);

        });

        it("should emit enable minter event", async () => {
            await ethers.provider.send("evm_increaseTime", [604800])   // increase evm time by 7 days

            await expect(
                und.enableMinter(zeroAddress))
                .to.emit(und, "EnableMinter")
                .withArgs(zeroAddress)
        });
    })

    describe("#approve", function() {
        it("should revert if approving to zeroAddress", async function() { 
            await expect(und.approve(zeroAddress, "100"))
                .to.be.revertedWith("ERC20: approve to the zero address");
        });
        it("should approve with valid amount", async function() { 
            await und.approve(signers[1].address, "100")
            expect(await und.allowance(signers[0].address, signers[1].address)).to.equal("100");
        });
        it("should emit approval event", async function() { 

            await expect(
                und.approve(signers[1].address, "100"))
                .to.emit(und, "Approval")
                .withArgs(signers[0].address, signers[1].address, "100")

        });
        it("should remove alowance after approve", async function() { 
            await und.approve(signers[1].address, "100")
            expect(await und.allowance(signers[0].address, signers[1].address)).to.equal("100");
            await und.approve(signers[1].address, "0")
            expect(await und.allowance(signers[0].address, signers[1].address)).to.equal("0");
        });
    })

    describe("#transfer", function() {

        beforeEach(async function(){

            let lockAmount = ethers.utils.parseEther("1").toString();

            await ethDaiPair.approve(ethDaiVault.address, lockAmount);
            await ethDaiVault.lock(lockAmount, signers[0].address, zeroAddress, "1")

        })

        it("should revert if receiver is zeroAddress", async function() { 
            await expect(und.transfer(zeroAddress, "100"))
                .to.be.revertedWith("ERC20: transfer to the zero address");
        });
        it("should revert if sender have no balance", async function() { 
            let ownerBalance = (await und.balanceOf(signers[0].address)).toString()
            let transferAmount = (new BigNumber(ownerBalance).plus("1")).toFixed()

            await expect(und.transfer(signers[1].address, transferAmount))
                .to.be.revertedWith("ERC20: transfer amount exceeds balance");
        });

        it("should transfer token and add, deduct balance accordingly", async function() { 
            let senderBalBefore = (await und.balanceOf(signers[0].address)).toString();
            let receiverBalBefore = (await und.balanceOf(signers[1].address)).toString();

            let transferAmount = "100000"

            let senderBalAfter = (new BigNumber(senderBalBefore).minus(transferAmount)).toFixed();
            let receiverBalAfter = (new BigNumber(receiverBalBefore).plus(transferAmount)).toFixed();

            await und.transfer(signers[1].address, transferAmount);

            expect(await und.balanceOf(signers[0].address)).to.equal(senderBalAfter);
            expect(await und.balanceOf(signers[1].address)).to.equal(receiverBalAfter);

        });

        it("should emit transfer event", async function() { 

            let transferAmount = "100000"

            await expect(
                und.transfer(signers[1].address, transferAmount))
                .to.emit(und, "Transfer")
                .withArgs(signers[0].address, signers[1].address, transferAmount
            );

        });
    })

    describe("#transferFrom", function() {

        beforeEach(async function(){

            let lockAmount = ethers.utils.parseEther("1").toString();

            await ethDaiPair.approve(ethDaiVault.address, lockAmount);
            await ethDaiVault.lock(lockAmount, signers[0].address, zeroAddress, "1")

        })

        it("should revert if sender is zeroAddress", async function() { 
            await expect(und.transferFrom(zeroAddress, signers[1].address, "100"))
                .to.be.revertedWith("ERC20: transfer from the zero address");
        });
        it("should revert if receiver is zeroAddress", async function() { 
            await expect(und.transferFrom(signers[0].address, zeroAddress, "100"))
                .to.be.revertedWith("ERC20: transfer to the zero address");
        });
        it("should revert if sender have no allowance to spend token on behalf of owner", async function() { 
            await expect(und.connect(signers[1]).transferFrom(signers[0].address, signers[1].address, "100"))
                .to.be.revertedWith("ERC20: transfer amount exceeds allowance");
        });
        it("should revert if sender have no balance", async function() { 
            let ownerBalance = (await und.balanceOf(signers[0].address)).toString()
            let transferAmount = (new BigNumber(ownerBalance).plus("1")).toFixed()

            await expect(und.transferFrom(signers[0].address, signers[1].address, transferAmount))
                .to.be.revertedWith("ERC20: transfer amount exceeds balance");
        });

        it("should transfer token and add, deduct balance accordingly", async function() {

            let transferAmount = "100000"

            await und.approve(signers[1].address, transferAmount)

            
            let senderBalBefore = (await und.balanceOf(signers[0].address)).toString();
            let receiverBalBefore = (await und.balanceOf(signers[1].address)).toString();

            let senderBalAfter = (new BigNumber(senderBalBefore).minus(transferAmount)).toFixed();
            let receiverBalAfter = (new BigNumber(receiverBalBefore).plus(transferAmount)).toFixed();

            await und.connect(signers[1]).transferFrom(signers[0].address, signers[1].address, transferAmount);

            expect(await und.balanceOf(signers[0].address)).to.equal(senderBalAfter);
            expect(await und.balanceOf(signers[1].address)).to.equal(receiverBalAfter);

        })

        it("should emit transfer event", async function() {

            let transferAmount = "100000"

            await und.approve(signers[1].address, transferAmount)

            await expect(
                und.connect(signers[1]).transferFrom(signers[0].address, signers[1].address, transferAmount))
                .to.emit(und, "Transfer")
                .withArgs(signers[0].address, signers[1].address, transferAmount
            );

        })
    })

    describe("#mint", function() {

        it("should revert if caller is not valid minter", async function() {
            await expect(und.mint(signers[0].address, "100"))
                .to.be.reverted;
        })

        it("should revert if caller is not valid minter vault", async function() {
            await vaultFactory.disableVault(ethDaiVault.address);

            await ethDaiPair.approve(ethDaiVault.address, "100");

            await expect(ethDaiVault.lock("100", signers[0].address, zeroAddress, "1"))
                .to.be.revertedWith("NA");
        })

        it("should mint UND tokens", async function() {
            let userBalBefore = (await und.balanceOf(signers[0].address)).toString();
            let lockAmount = ethers.utils.parseEther("1").toString();

            await ethDaiPair.approve(ethDaiVault.address, lockAmount);

            let expectedMintAMount = "56568542494923801952";
            let balanceAfter = (new BigNumber(userBalBefore).plus(expectedMintAMount)).toFixed();

            await ethDaiVault.lock(lockAmount, signers[0].address, zeroAddress, "1");
            
            expect(await und.balanceOf(signers[0].address)).to.equal(balanceAfter);

        })

        it("should emit Transfer event after minting", async function() {
            let lockAmount = ethers.utils.parseEther("1").toString();

            await ethDaiPair.approve(ethDaiVault.address, lockAmount);

            await expect(ethDaiVault.lock(lockAmount, signers[0].address, zeroAddress, "1"))
                .to.emit(und, "Transfer")
                .withArgs(zeroAddress, signers[0].address, "56568542494923801952");
        })

    })

    describe("#burn", function() {

        it("should revert if caller is not valid minter", async function() {
            await expect(und.burn(signers[0].address, "100"))
                .to.be.reverted;
        })

        it("should revert if caller is not valid minter vault", async function() {

            let lockAmount = ethers.utils.parseEther("1").toString();
            await ethDaiPair.approve(ethDaiVault.address, lockAmount);
            await ethDaiVault.lock(lockAmount, signers[0].address, zeroAddress, "1")

            await vaultFactory.disableVault(ethDaiVault.address);

            await expect(ethDaiVault.unlock("56568542494923801952", "1"))
                .to.be.revertedWith("NA");
        })

        it("should burn UND tokens", async function() {
            let lockAmount = ethers.utils.parseEther("1").toString();

            await ethDaiPair.approve(ethDaiVault.address, lockAmount);
            await ethDaiVault.lock(lockAmount, signers[0].address, zeroAddress, "1")
            let balanceBefore = (await und.balanceOf(signers[0].address)).toString();

            let expectedMintAMount = "56568542494923801952";
            let balanceAfter = (new BigNumber(balanceBefore).minus(expectedMintAMount)).toFixed();

            await ethDaiVault.unlock(expectedMintAMount, "1");
            
            expect(await und.balanceOf(signers[0].address)).to.equal(balanceAfter);

        })

        it("should emit transfer event", async function() {
            let lockAmount = ethers.utils.parseEther("1").toString();

            await ethDaiPair.approve(ethDaiVault.address, lockAmount);
            await ethDaiVault.lock(lockAmount, signers[0].address, zeroAddress, "1")

            let expectedMintAMount = "56568542494923801952";

            await expect(ethDaiVault.unlock(expectedMintAMount, "1"))
                .to.emit(und, "Transfer")
                .withArgs(signers[0].address, zeroAddress, expectedMintAMount);

        })

    })



    
});
