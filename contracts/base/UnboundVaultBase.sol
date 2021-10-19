//SPDX-License-Identifier: Unlicense
pragma solidity >=0.7.6;

import '@openzeppelin/contracts/math/SafeMath.sol';

import '../base/UnboundVaultManager.sol';

/**
 * Details
 * UnboundVaultBase acts as base for all the vaults.
 * It contains all the base functionality required to mint uTokens
 */

contract UnboundVaultBase is UnboundVaultManager {
    using SafeMath for uint256;

    uint256 public uTokenMinted;

    mapping(address => uint256) public collateral;
    mapping(address => uint256) public debt;

    // user vaults
    mapping(address => address) public yieldWallet;
    mapping(address => uint256) public yieldWalletDeposit;

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
        
        uTokenMinted = uTokenMinted.add(_amount);

        // Validate uToken minting limit if it is not set to zero
        if(uTokenMintLimit > 0){
            require(uTokenMinted <= uTokenMintLimit, 'LE');
        }

        uint256 fee;

        debt[_account] = debt[_account].add(_amount);

        amount = _amount;

        // mint the protocol fee to Vault in form of uToken
        if (PROTOCOL_FEE > 0) {
            fee = _amount.mul(PROTOCOL_FEE).div(SECOND_BASE);
            uToken.mint(address(this), fee);
            amount = amount.sub(fee);
        }

        // donate staking fee to the staking pool
        if (stakeFee > 0) {
            fee = _amount.mul(stakeFee).div(SECOND_BASE);
            uToken.mint(staking, fee);
            amount = amount.sub(fee);
        }

        uToken.mint(_mintTo, amount);
    }

    /**
     * @dev Burns uToken amounts for given user
     * @param _account Address of the user to burn tokens from
     * @param _amount Amount to be burned
     */
    function burn(address _account, uint256 _amount) internal {
        uToken.burn(_account, _amount);
        debt[_account] = debt[_account].sub(_amount);
    }
}
