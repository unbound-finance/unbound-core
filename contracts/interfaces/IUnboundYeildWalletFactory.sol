//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.0;

interface IUnboundYeildWalletFactory {
    function create(
        address,
        address,
        address
    ) external returns (address);
}
