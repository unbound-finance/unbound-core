// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.7.6;

import "./testAggregatorProxyBase.sol";

contract TestAggregatorProxyDaiUsd is TestAggregatorProxyBase {
    constructor() {
        _decimals = 8;
    }

    // 2021-02-27 12:25 100275167 in Kovan
}
