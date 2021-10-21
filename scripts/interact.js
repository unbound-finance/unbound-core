const { ethers } = require('hardhat')
const bn = require('bignumber.js')
const hre = require('hardhat')

async function main() {
  /**
   *
   *
   */

  const GOVERNANCE = '0xf7Aa7e6C820e13295499ef99467835dda41dA5d1'

  /**
   *
   */

  strategy = await ethers.getContractAt('DefiEdgeStrategy', _strategy)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
