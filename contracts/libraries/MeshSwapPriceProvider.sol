//SPDX-License-Identifier: Unlicense
pragma solidity >=0.7.6;

import '@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol';
import '@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol';
import '@openzeppelin/contracts/math/SafeMath.sol';

import '../interfaces/IChainlinkAggregatorV3Interface.sol';

interface IMeshSwapPair is IUniswapV2Pair{
    function fee() external view returns (uint256);
}

library MeshSwapPriceProvider {
    using SafeMath for uint256;

    uint256 constant BASE = uint256(1e18);

    /**
     * @notice Returns square root using Babylon method
     * @param y value of which the square root should be calculated
     * @return z Sqrt of the y
     */
    function sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }

    /**
     * Returns geometric mean of both reserves, multiplied by price of Chainlink.
     * @param _pair Address of the Uniswap V2 pair
     * @param _reserve0 reserves of the first asset
     * @param _reserve1 reserves of second asset
     * @return Geometric mean of given values
     */
    function getGeometricMean(
        address _pair,
        uint256 _reserve0,
        uint256 _reserve1
    ) internal view returns (uint256) {
        uint256 totalValue = _reserve0.mul(_reserve1);
        return
            sqrt(totalValue).mul(uint256(2)).mul(BASE).div(
                getTotalSupplyAtWithdrawal(_pair)
            );
    }

    /**
     * Calculates the price of the pair token using the formula of arithmetic mean.
     * @param _pair Address of the Uniswap V2 pair
     * @param _reserve0 Total eth for token 0.
     * @param _reserve1 Total eth for token 1.
     * @return Arithematic mean of _reserve0 and _reserve1
     */
    function getArithmeticMean(
        address _pair,
        uint256 _reserve0,
        uint256 _reserve1
    ) internal view returns (uint256) {
        uint256 totalValue = _reserve0.add(_reserve1);
        return totalValue.mul(BASE).div(getTotalSupplyAtWithdrawal(_pair));
    }

    /**
     * @notice Returns Uniswap V2 pair total supply at the time of withdrawal.
     * @param _pair Address of the pair
     * @return totalSupply Total supply of the Uniswap V2 pair at the time user withdraws
     */
    function getTotalSupplyAtWithdrawal(address _pair)
        internal
        view
        returns (uint256 totalSupply)
    {
        IMeshSwapPair pair = IMeshSwapPair(_pair);
        totalSupply = pair.totalSupply();
        uint256 _fee = pair.fee();
        bool feeOn = _fee != 0;
        if (feeOn) {
            uint256 kLast = pair.kLast();
            if (kLast != 0) {
                (uint112 reserve_0, uint112 reserve_1, ) = pair.getReserves();
                uint256 rootK = sqrt(uint256(reserve_0).mul(reserve_1));
                uint256 rootKLast = sqrt(kLast);
                if (rootK > rootKLast) {
                    uint256 numerator = totalSupply.mul(rootK.sub(rootKLast));
                    uint256 denominator = rootK.mul(5).add(rootKLast);
                    uint256 liquidity = numerator / denominator;
                    totalSupply = totalSupply.add(liquidity);
                }
            }
        }
    }

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
     * Returns price from Chainlink feed
     * @param _feed Chainlink feed address
     * @param _allowedDelay Allowed delay to check chainlink update delay
     * @return Chainlink price
     */
    function getChainlinkPrice(address _feed, uint256 _allowedDelay)
        internal
        view
        returns (uint256)
    {
        IChainlinkAggregatorV3Interface feed = IChainlinkAggregatorV3Interface(
            _feed
        );
        (, int256 _price, , uint256 _updatedAt, ) = feed.latestRoundData();
        // check if the oracle is expired
        require(_updatedAt >= block.timestamp.sub(_allowedDelay), 'OLD');
        uint256 price = normalise(uint256(_price), feed.decimals());
        return uint256(price);
    }

    /**
     * @notice Get latest price from Chainlink
     * @param _feeds Array of the Chainlink feeds
     * @param _allowedDelay Allowed delay in the Chainlink price update
     * @return price Latest chainlink price
     */
    function getLatestPrice(address[] memory _feeds, uint256 _allowedDelay)
        public
        view
        returns (uint256 price)
    {
        if (_feeds.length == 2) {
            uint256 price0 = getChainlinkPrice(_feeds[0], _allowedDelay);
            uint256 price1 = getChainlinkPrice(_feeds[1], _allowedDelay);

            price = price0.mul(price1).div(BASE);
        } else {
            price = getChainlinkPrice(_feeds[0], _allowedDelay);
        }
    }

    /**
     * @notice Returns reserve value in dollars
     * @param _price Chainlink Price.
     * @param _reserve Token reserves.
     * @param _decimals Number of decimals in the the reserve value
     * @return Returns normalised reserve value in 1e18
     */
    function getReserveValue(
        uint256 _price,
        uint112 _reserve,
        uint256 _decimals
    ) internal pure returns (uint256) {
        require(_price > 0, 'ERR_NO_ORACLE_PRICE');
        uint256 reservePrice = normalise(_reserve, _decimals);
        return uint256(reservePrice).mul(_price).div(BASE);
    }

    /**
     * @notice Returns true if there is price difference
     * @param _reserve0 Reserve value of first reserve in stablecoin.
     * @param _reserve1 Reserve value of first reserve in stablecoin.
     * @param _maxPercentDiff Maximum deviation at which geometric mean should take in effect
     * @return result True if there is different in both prices, false if not.
     */
    function hasPriceDifference(
        uint256 _reserve0,
        uint256 _reserve1,
        uint256 _maxPercentDiff
    ) internal pure returns (bool result) {
        uint256 diff = _reserve0.mul(BASE).div(_reserve1);
        if (
            diff > (BASE.add(_maxPercentDiff)) ||
            diff < (BASE.sub(_maxPercentDiff))
        ) {
            return true;
        }
        diff = _reserve1.mul(BASE).div(_reserve0);
        if (
            diff > (BASE.add(_maxPercentDiff)) ||
            diff < (BASE.sub(_maxPercentDiff))
        ) {
            return true;
        }
        return false;
    }

    /**
     * @dev Returns the pair's price.
     *   It calculates the price using Chainlink as an external price source and the pair's tokens reserves using the arithmetic mean formula.
     *   If there is a price deviation, instead of the reserves, it uses a weighted geometric mean with constant invariant K.
     * @param _pair Address of the Uniswap V2 pair
     * @param _decimals Array of the number of decimals in both pairs
     * @param _feeds Array of Chainlink feeds
     * @param _maxPercentDiff Maximum percentage different when GM should come in effect
     * @param _allowedDelay Allowed delay in Chainlink update
     * @return int256 price
     */
    function latestAnswer(
        address _pair,
        uint256[] memory _decimals,
        address[] memory _feeds,
        bool[] memory _isBase,
        uint256 _maxPercentDiff,
        uint256 _allowedDelay
    ) external view returns (int256) {
        IMeshSwapPair pair = IMeshSwapPair(_pair);

        uint256 chainlinkPrice0;
        uint256 chainlinkPrice1;
        if (_isBase[0]) {
            chainlinkPrice0 = BASE;
            chainlinkPrice1 = uint256(getLatestPrice(_feeds, _allowedDelay));
        } else {
            chainlinkPrice0 = uint256(getLatestPrice(_feeds, _allowedDelay));
            chainlinkPrice1 = BASE;
        }

        //Get token reserves in ethers
        (uint112 reserve0, uint112 reserve1, ) = pair.getReserves();

        uint256 reserveInStablecoin0 = getReserveValue(
            chainlinkPrice0,
            reserve0,
            _decimals[0]
        );
        uint256 reserveInStablecoin1 = getReserveValue(
            chainlinkPrice1,
            reserve1,
            _decimals[1]
        );

        if (
            hasPriceDifference(
                reserveInStablecoin0,
                reserveInStablecoin1,
                _maxPercentDiff
            )
        ) {
            //Calculate the weighted geometric mean
            return
                int256(
                    getGeometricMean(
                        _pair,
                        reserveInStablecoin0,
                        reserveInStablecoin1
                    )
                );
        } else {
            //Calculate the arithmetic mean
            return
                int256(
                    getArithmeticMean(
                        _pair,
                        reserveInStablecoin0,
                        reserveInStablecoin1
                    )
                );
        }
    }
}
