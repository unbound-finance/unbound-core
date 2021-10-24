//SPDX-License-Identifier: Unlicense
pragma solidity >=0.7.6;

import '../../libraries/DefiEdgeSharePriceProvider.sol';
import '../../interfaces/IDefiEdgeStrategy.sol';

contract TestOracleShare {

    event Price(uint256 reserve0, uint256 reserve1, uint256 price);

    function getPriceForShare(
        address _strategy,
        uint256[] memory _decimals
    ) public {

        IDefiEdgeStrategy strategy = IDefiEdgeStrategy(_strategy);

        (uint256 reserve0, uint256 reserve1,,) = strategy.getAUMWithFees();

        uint256 price = DefiEdgeSharePriceProvider.getSharePriceFromReserve(
            _strategy,
            reserve0,
            reserve1,
            _decimals
        );

        emit Price(reserve0, reserve1, price);
 
    }

}