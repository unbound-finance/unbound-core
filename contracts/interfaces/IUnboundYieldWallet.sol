//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.0;

interface IUnboundYieldWallet {
    function deposit(address, uint256) external;

    function withdraw(uint256) external;

    function deploy(address, uint256) external;
}
