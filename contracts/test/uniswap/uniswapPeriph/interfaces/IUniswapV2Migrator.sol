pragma solidity >=0.4.23 <=0.8.0;
// SPDX-License-Identifier: MIT

interface IUniswapV2Migrator {
    function migrate(address token, uint amountTokenMin, uint amountETHMin, address to, uint deadline) external;
}
