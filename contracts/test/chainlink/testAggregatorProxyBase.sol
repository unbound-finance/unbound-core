// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.0;

import "../../interfaces/IChainlinkAggregatorV3Interface.sol";

contract TestAggregatorProxyBase is IChainlinkAggregatorV3Interface {
    int256 _price;
    uint8 _decimals;
    string _description;
    uint256 _version;

    function decimals() external view override returns (uint8) {
        return _decimals;
    }

    function description() external view override returns (string memory) {
        return _description;
    }

    function version() external view override returns (uint256) {
        return _version;
    }

    function setPrice(int256 newPrice) external {
        _price = newPrice;
    }

    function setDecimal(uint8 newDecimals) external {
        _decimals = newDecimals;
    }

    function latestRoundData()
        external
        view
        override
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        roundId = 0;
        answer = _price;
        startedAt = 0;
        updatedAt = block.timestamp;
        answeredInRound = 0;
    }

    function getRoundData(uint80 _roundId)
        external
        view
        override
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        roundId = _roundId;
        answer = _price;
        startedAt = 0;
        updatedAt = block.timestamp;
        answeredInRound = 0;
    }
}
