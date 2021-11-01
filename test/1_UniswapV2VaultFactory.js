const { expect } = require("chai");
const { ethers } = require("hardhat");

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

describe("UniswapV2VaultFactory", function() {

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

        let TestAggregatorProxyEthUsd = await ethers.getContractFactory("TestAggregatorProxyEthUsd");
        feedEthUsd = await TestAggregatorProxyEthUsd.deploy();
        await feedEthUsd.setPrice(ethPrice) // 1 ETH = $3000
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
        it("should revert if input address is zero address", async function() { 
            await expect(vaultFactory.changeGovernance(zeroAddress))
                .to.be.revertedWith("IA");
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
        it("should emit accept governance event", async () => {
            await vaultFactory.changeGovernance(signers[1].address);
            await 
            await expect(vaultFactory.connect(signers[1]).acceptGovernance())
                    .to.emit(vaultFactory, "AcceptGovernance")
                    .withArgs(signers[1].address)
        });
  });

  describe("#createVault", async () => {

    it("should revert if caller is not governance", async () => {

        await expect(vaultFactory.connect(signers[1]).createVault(
            und.address,
            signers[0].address,
            ethDaiPair,
            tDai.address,
            [feedEthUsd.address],
            "900000000000000000",
            5000,
            undDaiPair
        )).of.be.revertedWith('NA');

    });

    it("should create vault with valid index", async () => {
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

        expect(await vaultFactory.index()).to.be.equal(1);

        expect(await vaultFactory.vaults(await vaultFactory.vaultByIndex(1))).to.be.equal(true)

    });

    it("should emit new vault event", async function() { 

        let tx = await vaultFactory.createVault(
            und.address,
            signers[0].address,
            ethDaiPair,
            tDai.address,
            [feedEthUsd.address],
            "900000000000000000",
            5000,
            undDaiPair
        );

        let vault = await vaultFactory.vaultByIndex(1)

        expect(tx).to.emit(vaultFactory, "NewVault").withArgs(vault, 1);
    })

    // it("should revert if same pair vault is created for second time", async () => {
    //     await vaultFactory.createVault(
    //         und.address,
    //         signers[0].address,
    //         ethDaiPair,
    //         tDai.address,
    //         [feedEthUsd.address],
    //         "900000000000000000",
    //         5000,
    //         undDaiPair
    //     );

    //     expect(await vaultFactory.index()).to.be.equal(1);

    //     await expect(vaultFactory.createVault(
    //         und.address,
    //         signers[0].address,
    //         ethDaiPair,
    //         tDai.address,
    //         [feedEthUsd.address],
    //         "900000000000000000",
    //         5000,
    //         undDaiPair
    //     )).to.be.reverted;

    // });
  })

  describe("#enableVault", async () => {

    it("should revert if caller is not governance", async () => {
        await expect(
            vaultFactory
                .connect(signers[1])
                .enableVault(zeroAddress)
        ).to.be.revertedWith('NA');
    });

    // it("should revert if vault address is not valid", async () => {
    //     await expect(
    //         vaultFactory.enableVault(zeroAddress)
    //     ).to.be.reverted;
    // });

    it("should set enableDates for vault", async () => {

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

        let vault = await vaultFactory.vaultByIndex(1);

        let result = await vaultFactory.enableVault(vault);

        let timestamp = (await ethers.provider.getBlock(result.blockNumber)).timestamp

        expect(await vaultFactory.enableDates(vault)).to.be.equal(timestamp);

    });

    it("should emit enableDates event", async () => {

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

        let vault = await vaultFactory.vaultByIndex(1);

        await expect(vaultFactory.enableVault(vault)).to.emit(vaultFactory, "EnableVault").withArgs(vault);

    });

    it("should allow vault", async () => {

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

        let vault = await vaultFactory.vaultByIndex(1);

        await vaultFactory.enableVault(vault);
        await ethers.provider.send("evm_increaseTime", [259201])   // increase evm time by 3 days
        await vaultFactory.executeEnableVault(vault);

        expect(await vaultFactory.allowed(vault)).to.be.equal(true);

    });

    it("should emit enable vault event", async function() { 
        
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

        let vault = await vaultFactory.vaultByIndex(1);

        await expect(vaultFactory.enableVault(vault))
            .to.emit(vaultFactory, "EnableVault")
            .withArgs(vault);
    });

  })

  describe("#executeEnableVault", async () => {

    it("should revert if date is not set for vault", async function() { 

        await expect(
            vaultFactory.executeEnableVault(zeroAddress)
        ).to.be.revertedWith('ID');

    })

    it("should revert if executeEnableVault before 3 days after enableVault", async function() { 

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

        let vault = await vaultFactory.vaultByIndex(1);

        await vaultFactory.enableVault(vault);

        await expect(
            vaultFactory.executeEnableVault(vault)
        ).to.be.revertedWith('WD');
        
    })

    it("should allow vault", async function() { 

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

        let vault = await vaultFactory.vaultByIndex(1);

        await vaultFactory.enableVault(vault);
        await ethers.provider.send("evm_increaseTime", [259201])   // increase evm time by 3 days
        await vaultFactory.executeEnableVault(vault);
    
        expect(await vaultFactory.allowed(vault)).to.be.equal(true);
        
    })

    it("should set enable date to zero", async function() { 

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

        let vault = await vaultFactory.vaultByIndex(1);

        await vaultFactory.enableVault(vault);
        await ethers.provider.send("evm_increaseTime", [259201])   // increase evm time by 3 days
        await vaultFactory.executeEnableVault(vault);
    
        expect(await vaultFactory.enableDates(vault)).to.be.equal(0);
        
    })
  })

  describe("#disableVault", async () => {
    let vault;

    beforeEach(async function () {
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

        vault = await vaultFactory.vaultByIndex(1);

        await vaultFactory.enableVault(vault);
        await ethers.provider.send("evm_increaseTime", [259201])   // increase evm time by 3 days
        await vaultFactory.executeEnableVault(vault);
    })

    it("should revert if caller is not governance", async () => {
        await expect(
            vaultFactory
                .connect(signers[1])
                .disableVault(vault)
        ).to.be.revertedWith('NA');
    });

    it("should disableDates for vault", async () => {

        expect(await vaultFactory.allowed(vault)).to.be.equal(true);

        let result = await vaultFactory.disableVault(vault);

        let timestamp = (await ethers.provider.getBlock(result.blockNumber)).timestamp

        expect(await vaultFactory.disableDates(vault)).to.be.equal(timestamp);

    });


    it("should emit disableDates event", async () => {

        expect(await vaultFactory.allowed(vault)).to.be.equal(true);

        await expect(vaultFactory.disableVault(vault)).to.emit(vaultFactory, "DisableVault").withArgs(vault);

    });

    it("should disable vault", async () => {

        expect(await vaultFactory.allowed(vault)).to.be.equal(true);

        await vaultFactory.disableVault(vault);
        await ethers.provider.send("evm_increaseTime", [259201])   // increase evm time by 3 days
        await vaultFactory.executeDisableVault(vault);
        
        expect(await vaultFactory.allowed(vault)).to.be.equal(false);

    });

    it("should emit disable vault event", async function() { 

        await expect(vaultFactory.disableVault(vault))
            .to.emit(vaultFactory, "DisableVault")
            .withArgs(vault);
    })

  })

  describe("#executeDisableVault", async () => {

    let vault;

    beforeEach(async function () {
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

        vault = await vaultFactory.vaultByIndex(1);

        await vaultFactory.enableVault(vault);
        await ethers.provider.send("evm_increaseTime", [259201])   // increase evm time by 3 days
        await vaultFactory.executeEnableVault(vault);
    
    })


    it("should revert if date is not set for vault", async function() { 

        await expect(
            vaultFactory.executeDisableVault(zeroAddress)
        ).to.be.revertedWith('ID');

    })

    it("should revert if executeDisableVault before 3 days after disableVault", async function() { 

        await vaultFactory.disableVault(vault);

        await expect(
            vaultFactory.executeDisableVault(vault)
        ).to.be.revertedWith('WD');
        
    })

    it("should disallow vault", async function() { 

        await vaultFactory.disableVault(vault);
        await ethers.provider.send("evm_increaseTime", [259201])   // increase evm time by 3 days
        await vaultFactory.executeDisableVault(vault);
    
        expect(await vaultFactory.allowed(vault)).to.be.equal(false);
        
    })

    it("should set disable date to zero", async function() { 

        await vaultFactory.disableVault(vault);
        await ethers.provider.send("evm_increaseTime", [259201])   // increase evm time by 3 days
        await vaultFactory.executeDisableVault(vault);
    
        expect(await vaultFactory.disableDates(vault)).to.be.equal(0);
        
    })
  })

//   describe("#setPause", async () => {
//     it("should revert is caller is not owner", async function() { 
//         await expect(vaultFactory.connect(signers[1]).setPause()).to.be.revertedWith("NA");            
//     });
//     it("should pause contract", async function() { 
//         await vaultFactory.setPause();            
//         expect(await vaultFactory.paused()).to.equal(true);
//     });
//     it("should revert if craeteVault when contract is paused", async function() { 
//         await vaultFactory.setPause();  

//         await expect(
//             vaultFactory.createVault(
//                 und.address,
//                 signers[0].address,
//                 ethDaiPair,
//                 tDai.address,
//                 [feedEthUsd.address],
//                 "900000000000000000",
//                 5000,
//                 undDaiPair
//             )
//         ).to.be.revertedWith("Pausable: paused");
//     });
//   })

//   describe("#setUnpause", async () => {
//     it("should revert is caller is not owner", async function() { 
//         await expect(vaultFactory.connect(signers[1]).setUnpause()).to.be.revertedWith("NA");            
//     });
//     it("should unpause contract", async function() { 
//         await vaultFactory.setPause();            
//         expect(await vaultFactory.paused()).to.equal(true);

//         await vaultFactory.setUnpause();            
//         expect(await vaultFactory.paused()).to.equal(false);
//     });
//     it("should revert if craeteVault when contract is paused and can create once contract is unpaused", async function() { 
//         await vaultFactory.setPause();  
                  
//         await expect(
//             vaultFactory.createVault(
//                 und.address,
//                 signers[0].address,
//                 ethDaiPair,
//                 tDai.address,
//                 [feedEthUsd.address],
//                 "900000000000000000",
//                 5000,
//                 undDaiPair
//             )
//         ).to.be.revertedWith("Pausable: paused");

//         await vaultFactory.setUnpause();  

//         await expect(vaultFactory.createVault(
//             und.address,
//             signers[0].address,
//             ethDaiPair,
//             tDai.address,
//             [feedEthUsd.address],
//             "900000000000000000",
//             5000,
//             undDaiPair
//         )).to.emit(vaultFactory, "NewVault");

//     });
//   })
    
});
