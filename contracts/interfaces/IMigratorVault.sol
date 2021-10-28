//SPDX-License-Identifier: Unlicense
pragma solidity >=0.7.6;

interface IMigratorVault {

    function update(
        address _user, 
        uint256 _collateral, 
        uint256 _debt,
        address _yieldWallet, 
        uint256 _yieldWalletDeposit,
        address _farming
    ) external;
}
