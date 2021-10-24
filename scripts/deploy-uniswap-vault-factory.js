const { ethers } = require('hardhat')
const bn = require('bignumber.js')
const hre = require('hardhat')

async function main() {
  /**
   *
   *
   */

  // multisig address
  const GOVERNANCE = '0xf7Aa7e6C820e13295499ef99467835dda41dA5d1'

  /**
   *
   */

  const UniswapV2PriceProvider = await ethers.getContractFactory(
    'UniswapV2PriceProvider'
  )

  const uniswapV2PriceProvider = await UniswapV2PriceProvider.deploy()
  console.log(
    `🎉 Price Provider Deployed to: ${uniswapV2PriceProvider.address}`
  )

  // deploy factory
  let VaultFactory = await ethers.getContractFactory('UniswapV2VaultFactory', {
    libraries: { UniswapV2PriceProvider: uniswapV2PriceProvider.address },
  })

  console.log('deploying Uniswap Vault')
  const vaultFactory = await VaultFactory.deploy(
    GOVERNANCE,
    '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f'
  )

  console.log(`🎉 Factory Deployed to: ${vaultFactory.address}`)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
