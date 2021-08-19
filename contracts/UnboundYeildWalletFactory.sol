//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.0;

import './UnboundYeildWallet.sol';

contract UnboundYeildWalletFactory {
    function create(
        address _pair,
        address _user,
        address _vault
    ) external returns (address wallet) {
        wallet = address(new UnboundYeildWallet(_pair, _user, _vault));
    }
}
