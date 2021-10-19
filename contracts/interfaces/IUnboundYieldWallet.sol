//SPDX-License-Identifier: Unlicense
pragma solidity >=0.7.6;

interface IUnboundYieldWallet {
    function deposit(uint256) external;

    function withdraw(uint256) external;
}
