// const { expect } = require('chai')
// const { ethers } = require('hardhat')
// const BigNumber = require('bignumber.js')
// BigNumber.set({ DECIMAL_PLACES: 0, ROUNDING_MODE: 1 })
// const {
//   buildPermitParams,
//   getSignatureFromTypedData,
//   MAX_UINT_AMOUNT,
// } = require('./helpers/contract-helpers')

// const zeroAddress = '0x0000000000000000000000000000000000000000'
// const BASE = '1000000000000000000'

// let signers
// let governance

// let und
// let tEth
// let tDai
// let weth
// let uniswapFactory
// let uniswapRouter
// let ethDaiPair
// let undDaiPair
// let vaultFactory
// let oracleLibrary

// let feedEthUsd
// let ethDaiVault
// let yieldWalletFactory

// const ethPrice = '320000000000' // $3200
// const daiPrice = '100000000' // $1

// const CR = '200000000' // 200%
// const LTV = '50000000' // 50%
// const PROTOCOL_FEE = '500000' // 0.5%
// const stakeFee = '500000' // 0.5%
// const safuShare = '40000000' // 40%
// const SECOND_BASE = '100000000' // 1e8

// describe('UnboundYieldWalletFactory', function () {
//   beforeEach(async function () {
//     signers = await ethers.getSigners()
//     governance = signers[0].address

//     let UniswapV2Factory = await ethers.getContractFactory('UniswapV2Factory')
//     uniswapFactory = await UniswapV2Factory.deploy(zeroAddress)

//     let WETH9 = await ethers.getContractFactory('WETH9')
//     weth = await WETH9.deploy()

//     let UniswapV2Router02 = await ethers.getContractFactory('UniswapV2Router02')
//     uniswapRouter = await UniswapV2Router02.deploy(
//       uniswapFactory.address,
//       weth.address
//     )

//     let Oracle = await ethers.getContractFactory('UniswapV2PriceProvider')
//     oracleLibrary = await Oracle.deploy()

//     let VaultFactory = await ethers.getContractFactory(
//       'UniswapV2VaultFactory',
//       {
//         libraries: { UniswapV2PriceProvider: oracleLibrary.address },
//       }
//     )

//     vaultFactory = await VaultFactory.deploy(governance, uniswapFactory.address);

//     let UnboundToken = await ethers.getContractFactory('UnboundToken')
//     und = await UnboundToken.deploy(signers[0].address)

//     let TestEth = await ethers.getContractFactory('TestEth')
//     tEth = await TestEth.deploy(signers[0].address)

//     let TestDai = await ethers.getContractFactory('TestDai')
//     tDai = await TestDai.deploy(signers[0].address, '1337')

//     await uniswapFactory.createPair(und.address, tDai.address)
//     await uniswapFactory.createPair(tEth.address, tDai.address)

//     undDaiPair = await uniswapFactory.getPair(und.address, tDai.address)
//     ethDaiPair = await uniswapFactory.getPair(tEth.address, tDai.address)

//     ethDaiPair = await ethers.getContractAt('UniswapV2Pair', ethDaiPair)

//     let daiAmount = ethers.utils
//       .parseEther(((Number(ethPrice) / 100000000) * 1).toString())
//       .toString()
//     let ethAmount = ethers.utils.parseEther('1').toString()

//     await tDai.approve(uniswapRouter.address, daiAmount)
//     await tEth.approve(uniswapRouter.address, ethAmount)

//     await uniswapRouter.addLiquidity(
//       tDai.address,
//       tEth.address,
//       daiAmount,
//       ethAmount,
//       daiAmount,
//       ethAmount,
//       signers[0].address,
//       MAX_UINT_AMOUNT
//     )

//     let TestAggregatorProxyEthUsd = await ethers.getContractFactory(
//       'TestAggregatorProxyEthUsd'
//     )
//     feedEthUsd = await TestAggregatorProxyEthUsd.deploy()
//     await feedEthUsd.setPrice(ethPrice) // 1 ETH = $3200

//     await vaultFactory.createVault(
//       und.address,
//       signers[0].address,
//       ethDaiPair.address,
//       tDai.address,
//       [feedEthUsd.address],
//       '900000000000000000', // 10%
//       5000,
//       undDaiPair
//     )

//     ethDaiVault = await vaultFactory.vaultByIndex(1)
//     ethDaiVault = await ethers.getContractAt('UniswapV2Vault', ethDaiVault)

//     let UnboundYieldWalletFactory = await ethers.getContractFactory(
//       'UnboundYieldWalletFactory'
//     )
//     yieldWalletFactory = await UnboundYieldWalletFactory.deploy()

//     await ethDaiVault.changeLTV(LTV)
//     await ethDaiVault.changeCR(CR)
//     await ethDaiVault.changeFee(PROTOCOL_FEE)
//     await ethDaiVault.changeStakeFee(stakeFee)
//     await ethDaiVault.enableYieldWalletFactory(yieldWalletFactory.address)

//     await vaultFactory.enableVault(ethDaiVault.address)
//     await und.addMinter(vaultFactory.address)
//     await ethers.provider.send('evm_increaseTime', [604800]) // increase evm time by 7 days
//     await und.enableMinter(vaultFactory.address)
//   })

//   describe('#create', async () => {
//     it('should create yield wallet contract without revert', async function () {
//       await yieldWalletFactory.create(
//         ethDaiPair.address,
//         signers[0].address,
//         ethDaiVault.address
//       )
//     })

//     it('should create new yield wallet for first time user locking LPT', async function () {
//       expect(await ethDaiVault.yieldWallet(signers[0].address)).to.be.equal(
//         zeroAddress
//       )

//       let lockAmount = ethers.utils.parseEther('1').toString()

//       await ethDaiPair.approve(ethDaiVault.address, lockAmount)

//       await ethDaiVault.lock(
//         lockAmount,
//         signers[0].address,
//         yieldWalletFactory.address,
//         0
//       )

//       expect(await ethDaiVault.yieldWallet(signers[0].address)).to.not.equal(
//         zeroAddress
//       )
//     })

//     it('should emit event when creating new yield wallet for first time user locking LPT', async function () {
//       expect(await ethDaiVault.yieldWallet(signers[0].address)).to.be.equal(
//         zeroAddress
//       )

//       let lockAmount = ethers.utils.parseEther('1').toString()

//       await ethDaiPair.approve(ethDaiVault.address, lockAmount)

//       await expect(ethDaiVault.lock(
//         lockAmount,
//         signers[0].address,
//         yieldWalletFactory.address,
//         0
//       )).to.emit(yieldWalletFactory, "YeildWalletFactory")
      
//     })
//   })
// })

// async function calculateLPTPriceFromUniPool(pair, stablecoin) {
//   return new Promise(async function (resolve, reject) {
//     let token0 = await pair.token0()

//     const totalSupply = (await pair.totalSupply()).toString()
//     const reserve = await pair.getReserves()

//     let totalPoolValueInDai

//     if (token0.toLowerCase() == stablecoin.toLowerCase()) {
//       totalPoolValueInDai = new BigNumber(
//         reserve._reserve0.toString()
//       ).multipliedBy(2)
//     } else {
//       totalPoolValueInDai = new BigNumber(
//         reserve._reserve1.toString()
//       ).multipliedBy(2)
//     }

//     resolve(
//       totalPoolValueInDai.multipliedBy(BASE).dividedBy(totalSupply).toFixed()
//     )
//   })
// }
