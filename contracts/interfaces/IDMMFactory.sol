// SPDX-License-Identifier: BUSL-1.1
pragma solidity >=0.6.0 <0.8.0;

import "./IERC20_0.sol";

interface IDMMFactory {
    function createPool(
        IERC20_0 tokenA,
        IERC20_0 tokenB,
        uint32 ampBps
    ) external returns (address pool);

    function setFeeConfiguration(address feeTo, uint16 governmentFeeBps) external;

    function setFeeToSetter(address) external;

    function getFeeConfiguration() external view returns (address feeTo, uint16 governmentFeeBps);

    function feeToSetter() external view returns (address);

    function allPools(uint256) external view returns (address pool);

    function allPoolsLength() external view returns (uint256);

    function getUnamplifiedPool(IERC20_0 token0, IERC20_0 token1) external view returns (address);

    function getPools(IERC20_0 token0, IERC20_0 token1)
        external
        view
        returns (address[] memory _tokenPools);

    function isPool(
        IERC20_0 token0,
        IERC20_0 token1,
        address pool
    ) external view returns (bool);
}