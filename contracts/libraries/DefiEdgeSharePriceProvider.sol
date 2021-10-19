//SPDX-License-Identifier: Unlicense
pragma solidity >=0.7.6;

import '@openzeppelin/contracts/math/SafeMath.sol';

import '../interfaces/IDefiEdgeStrategy.sol';

library DefiEdgeSharePriceProvider {
    using SafeMath for uint256;

    uint256 constant BASE = uint256(1e18);

    // event Price(uint256 price);

    /**
     * @notice Returns normalised value in 18 digits
     * @param _value Value which we want to normalise
     * @param _decimals Number of decimals from which we want to normalise
     * @return normalised Returns normalised value in 1e18 format
     */
    function normalise(uint256 _value, uint256 _decimals)
        internal
        pure
        returns (uint256 normalised)
    {
        normalised = _value;
        if (_decimals < 18) {
            uint256 missingDecimals = uint256(18).sub(_decimals);
            normalised = uint256(_value).mul(10**(missingDecimals));
        } else if (_decimals > 18) {
            uint256 extraDecimals = _decimals.sub(uint256(18));
            normalised = uint256(_value).div(10**(extraDecimals));
        }
    }

    /**
     * @dev Returns the share price of defiedge (only for stable coin pairs) - write.
     * @param _strategy Address of the DefiEdge strategy contract
     * @param _decimals Array of the number of decimals in both pairs
     * @return uint256 price
     */
    function getSharePrice(
        address _strategy,
        uint256[] memory _decimals
    ) external returns (uint256) {

        IDefiEdgeStrategy strategy = IDefiEdgeStrategy(_strategy);

        (uint256 reserve0, uint256 reserve1,,) = strategy.getAUMWithFees();

        uint256 reserve0Normalised = normalise(reserve0, _decimals[0]);
        uint256 reserve1Normalised = normalise(reserve1, _decimals[1]);

        uint256 totalReserve = reserve0Normalised.add(reserve1Normalised);

        uint256 totalSupplyShare = strategy.totalSupply();

        uint256 price = totalReserve.mul(BASE).div(totalSupplyShare);

        // emit Price(price);

        return price;

    }

    /**
     * @dev Returns the share price of defiedge (only for stable coin pairs) - read only.
     * @param _strategy Address of the DefiEdge strategy contract
     * @param _reserve0 reserve of token0 in strategy contract
     * @param _reserve1 reserve of token1 in strategy bcontract
     * @param _decimals Array of the number of decimals in both pairs
     * @return uint256 price
     */
    function getSharePriceFromReserve(
        address _strategy,
        uint256 _reserve0,
        uint256 _reserve1,
        uint256[] memory _decimals
    ) external view returns (uint256) {

        IDefiEdgeStrategy strategy = IDefiEdgeStrategy(_strategy);

        uint256 reserve0Normalised = normalise(_reserve0, _decimals[0]);
        uint256 reserve1Normalised = normalise(_reserve1, _decimals[1]);

        uint256 totalReserve = reserve0Normalised.add(reserve1Normalised);

        uint256 totalSupplyShare = strategy.totalSupply();

        uint256 price = totalReserve.mul(BASE).div(totalSupplyShare);

        return price;

    }
}
