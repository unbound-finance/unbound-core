//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.0;

import '@openzeppelin/contracts/utils/math/SafeMath.sol';

import '../base/UnboundVaultManager.sol';

/**
 * Details
 * UnboundVaultBase acts as base for all the vaults.
 * It contains all the base functionality required to mint uTokens
 */

contract UnboundVaultBase is UnboundVaultManager {
    using SafeMath for uint256;

    mapping(address => uint256) public collateral;
    mapping(address => uint256) public debt;

    // user vaults
    mapping(address => address) public yeildWallet;
    mapping(address => uint256) public yeildWalletDeposit;

    /**
     * @dev Mints uToken and updates loan values
     * @param _account Address of the user issuing loan
     * @param _amount Amount of uTokens to be minted
     * @param _mintTo Address where the minted uTokens need to be sent
     */
    function mint(
        address _account,
        uint256 _amount,
        address _mintTo
    ) internal returns (uint256 amount) {
        require(_mintTo != address(0), 'NO');

        uint256 fee;

        // mint the protocol fee to Vault in form of uToken
        if (PROTOCOL_FEE > 0) {
            fee = _amount.mul(PROTOCOL_FEE).div(secondBase);
            uToken.mint(address(this), fee);
        }

        amount = _amount.sub(fee);

        // donate staking fee to the staking pool
        if (stakeFee > 0) {
            fee = _amount.mul(stakeFee).div(secondBase);
            uToken.mint(staking, fee);
        }

        amount = amount.sub(fee);

        uToken.mint(_mintTo, amount);

        debt[_account] = debt[_account].add(amount);
    }

    /**
     * @dev Burns uToken amounts for given user
     * @param _account Address of the user to burn tokens from
     * @param _amount Amount to be burned
     */
    function burn(address _account, uint256 _amount)
        internal
        returns (uint256 amount)
    {
        uToken.burn(_account, _amount);
        debt[_account] = debt[_account].sub(amount);
    }
}
