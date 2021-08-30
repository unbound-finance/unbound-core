//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.0;

interface IUnboundVaultFactory {
    function allowed(address) external view returns (bool);
}
