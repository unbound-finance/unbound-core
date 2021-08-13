//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

interface IUnboundToken {
    function mint(address, uint256) external;

    function burn(address, uint256) external;
}

