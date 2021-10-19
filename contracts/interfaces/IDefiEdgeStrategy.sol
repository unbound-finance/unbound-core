//SPDX-License-Identifier: Unlicense
pragma solidity >=0.7.6;

interface IDefiEdgeStrategy {

    // Return user balance of share
    function balanceOf(address account) external view returns (uint256);

    // Return total supply of share
    function totalSupply() external view returns (uint256);

    /// address of the pool
    function pool() external view returns (address);

    // Get total amounts0 and amounts1 of strategy pool
    function getAUMWithFees() external returns (uint256 amount0, uint256 amount1, uint256 totalFee0, uint256 totalFee1);

    /**
     * @dev Moves `amount` tokens from the caller's account to `recipient`.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * Emits a {Transfer} event.
     */
    function transfer(address recipient, uint256 amount) external returns (bool);

    /**
     * @dev Moves `amount` tokens from `sender` to `recipient` using the
     * allowance mechanism. `amount` is then deducted from the caller's
     * allowance.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * Emits a {Transfer} event.
     */
    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) external returns (bool);
}
