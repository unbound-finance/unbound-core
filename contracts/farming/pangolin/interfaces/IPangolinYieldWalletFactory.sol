//SPDX-License-Identifier: Unlicense
pragma solidity >=0.7.6;

interface IPangolinYieldWalletFactory {
    
    function team() external view returns(address);

    function teamShare() external view returns(uint256);
}
