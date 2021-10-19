//SPDX-License-Identifier: Unlicense
pragma solidity >=0.7.6;

import './UnboundYieldWallet.sol';

contract UnboundYieldWalletFactory {
    event YeildWalletFactory(address _wallet);

    /**
     * @notice Creates Yeild wallet
     * @param _pair Address of Uniswap V2 Pair
     * @param _user Address of the owner of the vault
     * @param _vault Address of the vault the wallet is linked to
     */
    function create(
        address _pair,
        address _user,
        address _vault
    ) external returns (address wallet) {
        wallet = address(new UnboundYieldWallet(_pair, _user, _vault));
        emit YeildWalletFactory(wallet);
    }
}
