const { ethers } = require('hardhat')
const bn = require('bignumber.js')
const hre = require('hardhat')

async function main() {
  /**
   *
   *
   */

  const GOVERNANCE = '0x439df1F17E7ACB55edfCa0Ce95368dE3Feb5563E'

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
