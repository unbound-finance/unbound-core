const { expect } = require("chai");
const { ethers } = require("hardhat");
const { MAX_UINT_AMOUNT } = require('../helpers/contract-helpers')

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
let ethDaiVault;

const CR = "50000000" // 50%
const LTV = "50000000" // 50%
const PROTOCOL_FEE = "500000" // 0.5%
const stakeFee = "500000" // 0.5% 
const safuShare = "40000000" // 40%
const secondBase = "100000000"; // 1e8

describe("UnboundVaultManager", function() {

    beforeEach(async function () {
        signers = await ethers.getSigners();
        governance = signers[0].address;

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
    
        vaultFactory = await VaultFactory.deploy(governance, uniswapFactory.address)

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
        await feedEthUsd.setPrice("300000000000") // 1 ETH = $3000

        await vaultFactory.createVault(
            und.address,
            signers[0].address,
            ethDaiPair,
            tDai.address,
            [feedEthUsd.address],
            "900000000000000000",
            5000,
            undDaiPair
        );

        ethDaiVault = await vaultFactory.vaultByIndex(1);
        ethDaiVault = await ethers.getContractAt("UniswapV2Vault", ethDaiVault);

        ethDaiPair = await ethers.getContractAt("UniswapV2Pair", ethDaiPair);

        await ethDaiVault.enableYieldWalletFactory(zeroAddress);
        await vaultFactory.enableVault(ethDaiVault.address);
        await und.addMinter(vaultFactory.address);

        await ethers.provider.send("evm_increaseTime", [259201])   // increase evm time by 3 days

        await ethDaiVault.executeEnableYeildWalletFactory(zeroAddress);
        await vaultFactory.executeEnableVault(ethDaiVault.address);
        await und.enableMinter(vaultFactory.address);

    });

    describe("#staticVariables", async () => {
        it("should set correct factory address", async function() { 
            expect(await ethDaiVault.factory()).to.equal(vaultFactory.address);
        });
        it("should set correct lpt pool address", async function() { 
            expect(await ethDaiVault.pair()).to.equal(ethDaiPair.address);
        });
        it("should set correct und token address", async function() { 
            expect(await ethDaiVault.uToken()).to.equal(und.address);
        });
        it("should set correct governance address", async function() { 
            expect(await ethDaiVault.governance()).to.equal(signers[0].address);
        });
        it("default pending governance address should be zero address", async function() { 
            expect(await ethDaiVault.pendingGovernance()).to.equal(zeroAddress);
        });
        it("default manager address should be zero address", async function() { 
            expect(await ethDaiVault.manager()).to.equal(zeroAddress);
        });
    });
    
    describe("#claim", async () => {
        it("should revert if caller is not governance", async function() { 
            await expect(
                ethDaiVault
                    .connect(signers[1])    
                    .claim(tEth.address, signers[0].address))
                    .to.be.revertedWith('NA');
        });

        it("should revert if trying to withdraw pool lpt", async function() { 
            await expect(
                ethDaiVault
                    .claim(ethDaiPair.address, signers[0].address))
                    .to.be.reverted;
        });

        it("should revert if trying to withdraw und", async function() { 
            await expect(
                ethDaiVault
                    .claim(ethDaiPair.address, signers[0].address))
                    .to.be.reverted;
        });

        it("should transfer token to address", async function() { 
            await tEth.transfer(ethDaiVault.address, "1000");

            expect(await tEth.balanceOf(ethDaiVault.address)).to.equal("1000");
            expect(await tEth.balanceOf(signers[1].address)).to.equal("0");

            await expect(ethDaiVault.claim(tEth.address, signers[1].address))
                .to.emit(tEth, "Transfer")
                .withArgs(
                    ethDaiVault.address,
                    signers[1].address,
                    "1000"
                );

            expect(await tEth.balanceOf(ethDaiVault.address)).to.equal("0");
            expect(await tEth.balanceOf(signers[1].address)).to.equal("1000");

        });

        it("should emit claim tokens event", async function() { 
            await tEth.transfer(ethDaiVault.address, "1000");

            // expect(await tEth.balanceOf(ethDaiVault.address)).to.equal("1000");
            // expect(await tEth.balanceOf(signers[1].address)).to.equal("0");

            await expect(ethDaiVault.claim(tEth.address, signers[1].address))
                .to.emit(ethDaiVault, "ClaimTokens")
                .withArgs(
                    tEth.address,
                    signers[1].address,
                    "1000"
                );

        });

    });

    describe("#changeManager", async () => {
        it("default manager address should be zero address", async function() { 
            expect(await ethDaiVault.manager()).to.equal(zeroAddress);
        });
        it("should revert if caller is not governance", async function() { 
            await expect(
                ethDaiVault
                    .connect(signers[1].address)
                    .changeManager(signers[1].address))
                    .to.be.reverted;
        });
        it("should revert if input address is zero address", async function() { 
            await expect(ethDaiVault.changeManager(zeroAddress))
                .to.be.revertedWith("IA");
        });
        it("should change manager address", async function() { 
            await ethDaiVault.changeManager(signers[1].address)
            expect(await ethDaiVault.manager()).to.equal(signers[1].address);
        });
        it("should emit change manager share event", async function() { 
            await expect(ethDaiVault.changeManager(signers[1].address))
                .to.emit(ethDaiVault, "ChangeManager")
                .withArgs(signers[1].address);
        });
    })

    describe("#changeGovernance", function() {
        it("should revert if not called by governance", async function() { 
            await expect(ethDaiVault.connect(signers[1]).changeGovernance(signers[1].address))
                .to.be.revertedWith("NA");
        });
        it("should revert if input address is zero address", async function() { 
            await expect(ethDaiVault.changeGovernance(zeroAddress))
                .to.be.revertedWith("IA");
        });
        it("should set pending governance as new governance address", async () => {
            await ethDaiVault.changeGovernance(signers[1].address);
            expect(await ethDaiVault.pendingGovernance()).to.equal(signers[1].address);
        });
        it("should emit change governance event", async () => {
            await expect(
                ethDaiVault.changeGovernance(signers[1].address))
                .to.emit(ethDaiVault, "ChangeGovernance")
                .withArgs(signers[1].address)
        });
    })

    describe("#acceptGovernance", async () => {
        it("should revert if caller is not pending governance", async () => {
            expect(ethDaiVault.acceptGovernance()).to.be.reverted;
        });
        it("should set governance as pending governance", async () => {
            await ethDaiVault.changeGovernance(signers[1].address);
            expect(await ethDaiVault.pendingGovernance()).to.equal(signers[1].address);
        });
        it("should revert if not accepted by pending governance", async () => {
            await ethDaiVault.changeGovernance(signers[1].address);
            await expect(ethDaiVault.acceptGovernance()).to.be.reverted;
        });
        it("should set new governance address", async () => {
            await ethDaiVault.changeGovernance(signers[1].address);
            await ethDaiVault.connect(signers[1]).acceptGovernance()
            expect(await ethDaiVault.governance()).to.equal(signers[1].address);
        });
  });

    describe("#CR", async () => {
        beforeEach("set manager address", async function(){
            await ethDaiVault.changeManager(signers[1].address)
        })
        it("default CR value should be zero address", async function() { 
            expect(await ethDaiVault.CR()).to.equal("0");
        });
        it("should revert if caller is not governance or manager", async function() { 
            await expect(
                ethDaiVault
                .connect(signers[2].address)
                .changeCR(CR))
                .to.be.reverted;
        });
        it("should set CR vaule if caller is governance", async function() { 
            await ethDaiVault.connect(signers[0]).changeCR(CR)
            expect(await ethDaiVault.CR()).to.equal(CR);
        });

        it("should set CR vaule if caller is manager", async function() { 
            await ethDaiVault.connect(signers[1]).changeCR(CR)
            expect(await ethDaiVault.CR()).to.equal(CR);
        });

        it("should emit ChangeCR event", async function() { 
            await expect(ethDaiVault.changeCR(CR))
                .to.emit(ethDaiVault, "ChangeCR")
                .withArgs(CR);
        });

    })

    describe("#LTV", async () => {
        beforeEach("set manager address", async function(){
            await ethDaiVault.changeManager(signers[1].address)
        })
        it("default LTV value should be zero address", async function() { 
            expect(await ethDaiVault.LTV()).to.equal("0");
        });
        it("should revert if caller is not governance or manager", async function() { 
            await expect(
                ethDaiVault
                .connect(signers[2].address)
                .changeLTV(LTV))
                .to.be.reverted;
        });
        it("should revert if LTV is greater sthen second base(1e8)", async function() { 
            await expect(
                ethDaiVault
                .changeLTV("100000001"))
                .to.be.reverted;
        });
        it("should set LTV vaule if caller is governance", async function() { 
            await ethDaiVault.connect(signers[0]).changeLTV(LTV)
            expect(await ethDaiVault.LTV()).to.equal(LTV);
        });

        it("should set LTV vaule if caller is manager", async function() { 
            await ethDaiVault.connect(signers[1]).changeLTV(LTV)
            expect(await ethDaiVault.LTV()).to.equal(LTV);
        });

        it("should emit ChangeLTV event", async function() { 
            await expect(ethDaiVault.changeLTV(LTV))
                .to.emit(ethDaiVault, "ChangeLTV")
                .withArgs(LTV);
        });

    })

    describe("#changeUTokenMintLimit", function() {
        it("should revert if not called by governance", async function() { 
            await expect(ethDaiVault.connect(signers[1]).changeUTokenMintLimit("100"))
                .to.be.revertedWith("NA");
        });
        it("should change uToken mint limit", async () => {
            await ethDaiVault.changeUTokenMintLimit("100");
            expect(await ethDaiVault.uTokenMintLimit()).to.equal("100");
        });
        it("should emit change uToken mint limit event", async function() { 
            await expect(ethDaiVault.changeUTokenMintLimit("100"))
                .to.emit(ethDaiVault, "ChangeUTokenMintLimit")
                .withArgs("100");
        });
    })

    describe("#changeTeamFeeAddress", function() {
        it("should revert if not called by governance", async function() { 
            await expect(ethDaiVault.connect(signers[1]).changeTeamFeeAddress(signers[1].address))
                .to.be.revertedWith("NA");
        });
        it("should revert if input address is zero address", async function() { 
            await expect(ethDaiVault.changeTeamFeeAddress(zeroAddress))
                .to.be.revertedWith("IA");
        });
        it("should set pending governance as new governance address", async () => {
            await ethDaiVault.changeTeamFeeAddress(signers[1].address);
            expect(await ethDaiVault.team()).to.equal(signers[1].address);
        });
    })

    describe("#changeFee", function() {
        it("should revert if not called by governance", async function() { 
            await expect(ethDaiVault.connect(signers[1]).changeFee(PROTOCOL_FEE))
                .to.be.revertedWith("NA");
        });
        it("should revert if fee is greater then or equal to SECOND_BASE", async function() { 
            await expect(ethDaiVault.changeFee(secondBase))
                .to.be.reverted;
        });
        it("should change protocol fees", async () => {
            await ethDaiVault.changeFee(PROTOCOL_FEE);
            expect(await ethDaiVault.PROTOCOL_FEE()).to.equal(PROTOCOL_FEE);
        });
        it("should emit change protocol fee event", async function() { 
            await expect(ethDaiVault.changeFee(PROTOCOL_FEE))
                .to.emit(ethDaiVault, "ChangeProtocolFee")
                .withArgs(PROTOCOL_FEE);
        });
    })

    describe("#changeStakeFee", function() {
        it("should revert if not called by governance", async function() { 
            await expect(ethDaiVault.connect(signers[1]).changeStakeFee(stakeFee))
                .to.be.revertedWith("NA");
        });
        it("should revert if fee is greater then or equal to SECOND_BASE", async function() { 
            await expect(ethDaiVault.changeStakeFee(secondBase))
                .to.be.reverted;
        });
        it("should set pending governance as new governance address", async () => {
            await ethDaiVault.changeStakeFee(stakeFee);
            expect(await ethDaiVault.stakeFee()).to.equal(stakeFee);
        });
        it("should emit change stake fee event", async function() { 
            await expect(ethDaiVault.changeStakeFee(stakeFee))
                .to.emit(ethDaiVault, "ChangeStakeFee")
                .withArgs(stakeFee);
        });
    })

    describe("#changeSafuShare", function() {
        it("should revert if not called by governance", async function() { 
            await expect(ethDaiVault.connect(signers[1]).changeSafuShare(safuShare))
                .to.be.revertedWith("NA");
        });
        it("should revert if safu share is greater then SECOND_BASE", async function() { 
            await expect(ethDaiVault.changeSafuShare("100000001"))
                .to.be.reverted;
        });
        it("should set pending governance as new governance address", async () => {
            await ethDaiVault.changeSafuShare(safuShare);
            expect(await ethDaiVault.safuShare()).to.equal(safuShare);
        });
        it("should emit change safu share event", async function() { 
            await expect(ethDaiVault.changeSafuShare(safuShare))
                .to.emit(ethDaiVault, "ChangeSafuShare")
                .withArgs(safuShare);
        });
    })

    describe("#changeSafuAddress", function() {
        it("should revert if not called by governance", async function() { 
            await expect(ethDaiVault.connect(signers[1]).changeSafuAddress(signers[2].address))
                .to.be.revertedWith("NA");
        });
        it("should revert if address is zero address", async function() { 
            await expect(ethDaiVault.changeSafuAddress(zeroAddress))
                .to.be.reverted;
        });
        it("should set pending governance as new governance address", async () => {
            await ethDaiVault.changeSafuAddress(signers[2].address);
            expect(await ethDaiVault.safu()).to.equal(signers[2].address);
        });
        it("should emit change safu share event", async function() { 
            await expect(ethDaiVault.changeSafuAddress(signers[2].address))
                .to.emit(ethDaiVault, "ChangeSafu")
                .withArgs(signers[2].address);
        });
    })

    describe("#distributeFee", function() {

        beforeEach(async function(){

            await ethDaiVault.changeLTV(LTV)
            await ethDaiVault.changeCR(CR)
            await ethDaiVault.changeFee(PROTOCOL_FEE);

            let lockAmount = ethers.utils.parseEther("1").toString();

            await ethDaiPair.approve(ethDaiVault.address, lockAmount);
            await ethDaiVault.lock(lockAmount, signers[0].address, "1")

        })

        it("should revert if safu share is zero", async () => {
            // Change team address
            await ethDaiVault.changeTeamFeeAddress(signers[1].address);

            // Chnage Safu address
            await ethDaiVault.changeSafuAddress(signers[2].address);

            await expect(ethDaiVault.distributeFee()).to.be.revertedWith("INVALID")

        });

        it("should revert if safu address is not initialized", async () => {
            // Change team address
            await ethDaiVault.changeTeamFeeAddress(signers[1].address);

            await expect(ethDaiVault.distributeFee()).to.be.revertedWith("INVALID")

        });

        it("should distribute fees(100%) only to safu address if team address is zero", async () => {

            expect((await und.balanceOf(ethDaiVault.address)).toString()).to.be.equal("274003877709787165") // vault balance

            // Not changing team address here

            // Chnage Safu address
            await ethDaiVault.changeSafuAddress(signers[1].address);

            // Change safu share
            await ethDaiVault.changeSafuShare(safuShare);

            let distribute = await ethDaiVault.distributeFee()

            expect(distribute).to.emit(und, "Transfer").withArgs(ethDaiVault.address, signers[1].address, "274003877709787165"); // 100% of vault balance
            expect(distribute).to.emit(ethDaiVault, "DistributeFee").withArgs("274003877709787165");


            expect((await und.balanceOf(ethDaiVault.address)).toString()).to.be.equal("0") // 0% remaining in contract balance

        });

        it("should distribute fees to correct address - 40% safu and remaining 60% to team", async () => {

            expect((await und.balanceOf(ethDaiVault.address)).toString()).to.be.equal("274003877709787165") // vault balance

            // Change team address
            await ethDaiVault.changeTeamFeeAddress(signers[1].address);

            // Chnage Safu address
            await ethDaiVault.changeSafuAddress(signers[2].address);

            // Change safu share
            await ethDaiVault.changeSafuShare(safuShare);

            let distribute = await ethDaiVault.distributeFee()

            expect(distribute).to.emit(und, "Transfer").withArgs(ethDaiVault.address, signers[2].address, "109601551083914866"); // 40% of vault balance
            expect(distribute).to.emit(und, "Transfer").withArgs(ethDaiVault.address, signers[1].address, "164402326625872299"); // 60% of vault balance
            expect(distribute).to.emit(ethDaiVault, "DistributeFee").withArgs("274003877709787165");

        });
    })

    describe("#enableYieldWalletFactory", function() {
        it("should revert if not called by governance", async function() { 
            await expect(ethDaiVault.connect(signers[1]).enableYieldWalletFactory(signers[2].address))
                .to.be.revertedWith("NA");
        });
        it("should enable factory wallet address", async () => {
            await ethDaiVault.enableYieldWalletFactory(signers[2].address);
            await ethers.provider.send("evm_increaseTime", [259201])   // increase evm time by 3 days
            await ethDaiVault.executeEnableYeildWalletFactory(signers[2].address);

            expect(await ethDaiVault.isValidYieldWalletFactory(signers[2].address)).to.equal(true);
        });
        it("should emit enable yield factory event", async function() { 
            await expect(ethDaiVault.enableYieldWalletFactory(signers[2].address))
                .to.emit(ethDaiVault, "EnableYieldFactory")
                .withArgs(signers[2].address);
        });
    })

    describe("#executeEnableYeildWalletFactory", function() {

        it("should revert if date is not set for vault", async function() { 

            await expect(
                ethDaiVault.executeEnableYeildWalletFactory(signers[3].address)
            ).to.be.revertedWith('ID');
    
        })

        it("should revert if executeEnableVault before 3 days after enableVault", async function() { 

            await ethDaiVault.enableYieldWalletFactory(signers[2].address);

            await expect(
                ethDaiVault.executeEnableYeildWalletFactory(signers[2].address)
            ).to.be.revertedWith('WD');

        });

        it("should enable yield wallet factory", async function() { 
            await ethDaiVault.enableYieldWalletFactory(signers[2].address);
            await ethers.provider.send("evm_increaseTime", [259201])   // increase evm time by 3 days
            await ethDaiVault.executeEnableYeildWalletFactory(signers[2].address);

            expect(await ethDaiVault.isValidYieldWalletFactory(signers[2].address)).to.equal(true);
        })

    })

    describe("#disableYieldWalletFactory", function() {
        it("should revert if not called by governance", async function() { 
            await expect(ethDaiVault.connect(signers[1]).disableYieldWalletFactory(signers[2].address))
                .to.be.revertedWith("NA");
        });
        it("should disable factory wallet address", async () => {
            await ethDaiVault.enableYieldWalletFactory(signers[2].address);
            await ethers.provider.send("evm_increaseTime", [259201])   // increase evm time by 3 days
            await ethDaiVault.executeEnableYeildWalletFactory(signers[2].address);

            expect(await ethDaiVault.isValidYieldWalletFactory(signers[2].address)).to.equal(true);

            await ethDaiVault.disableYieldWalletFactory(signers[2].address);
            expect(await ethDaiVault.isValidYieldWalletFactory(signers[2].address)).to.equal(false);
        });
        it("should set enableYeildWalletFactoryDates date to zero", async () => {
            await ethDaiVault.enableYieldWalletFactory(signers[2].address);
            await ethers.provider.send("evm_increaseTime", [259201])   // increase evm time by 3 days
            await ethDaiVault.executeEnableYeildWalletFactory(signers[2].address);

            expect(await ethDaiVault.isValidYieldWalletFactory(signers[2].address)).to.equal(true);

            await ethDaiVault.disableYieldWalletFactory(signers[2].address);
            expect(await ethDaiVault.enableYeildWalletFactoryDates(signers[2].address)).to.equal(0);
        });
        it("should emit disable yield factory event", async function() { 
            await ethDaiVault.enableYieldWalletFactory(signers[2].address);
            await ethers.provider.send("evm_increaseTime", [259201])   // increase evm time by 3 days
            await ethDaiVault.executeEnableYeildWalletFactory(signers[2].address);

            await expect(ethDaiVault.disableYieldWalletFactory(signers[2].address))
                .to.emit(ethDaiVault, "DisableYieldFactory")
                .withArgs(signers[2].address);
        });
    })
});
