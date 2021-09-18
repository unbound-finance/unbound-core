const { ethers } = require('hardhat')
const bn = require('bignumber.js')
const hre = require('hardhat')

async function main() {
  /**
   *
   *
   */

  const GOVERNANCE = ''

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
