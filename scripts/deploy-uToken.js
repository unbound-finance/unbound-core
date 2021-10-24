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

  const UnboundToken = await ethers.getContractFactory('UnboundToken')
  const und = await UnboundToken.deploy(GOVERNANCE)

  console.log(`🎉 UND Deployed to: ${und.address}`)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
