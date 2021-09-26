// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.7.6;

import "./testAggregatorProxyBase.sol";

contract TestAggregatorProxyEthUsd is TestAggregatorProxyBase {
    constructor() {
        _decimals = 8;
    }

    // 2021-02-27 12:26 128093000000 in Kovan
}
