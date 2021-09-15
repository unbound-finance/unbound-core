//SPDX-License-Identifier: Unlicense
pragma solidity >=0.7.6;

interface IUnboundYieldWalletFactory {
    function create(
        address,
        address,
        address
    ) external returns (address);
}
