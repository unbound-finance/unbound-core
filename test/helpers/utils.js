const { BigNumber } = require('ethers')
const bn = require("bignumber.js");
bn.config({ EXPONENTIAL_AT: 999999, DECIMAL_PLACES: 40 });

exports.encodePriceSqrt = function(reserve0, reserve1){
    const number = BigNumber.from(
        new bn(reserve1.toString())
          .div(reserve0.toString())
          .sqrt()
          .multipliedBy(new bn(2).pow(96))
          .integerValue(3)
          .toString()
      );
      return number;
}

exports.expandTo18Decimals = function(value){
    return (value * 1e18).toLocaleString("fullwide", { useGrouping: false });
}

exports.calculateTick = function(price, tickSpacing){
    const logTick = 46054 * Math.log10(Math.sqrt(price));
    return BigNumber.from(logTick + tickSpacing - (logTick % tickSpacing));
}

exports.expandToString = function(value){
    return value.toLocaleString("fullwide", { useGrouping: false });
}