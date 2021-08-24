//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.0;

import './UnboundYieldWallet.sol';

contract UnboundYieldWalletFactory {
    function create(
        address _pair,
        address _user,
        address _vault
    ) external returns (address wallet) {
        wallet = address(new UnboundYieldWallet(_pair, _user, _vault));
    }
}
