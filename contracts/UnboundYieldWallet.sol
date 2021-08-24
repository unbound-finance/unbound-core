//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.0;

contract UnboundYieldWallet {
    address public pair;
    address public user; // owner of the yieldWallet
    address public vault; // factory from which this vault is deployed

    mapping(address => bool) allowed;

    modifier onlyVault() {
        require(msg.sender == vault, 'NA');
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == user, 'NA');
        _;
    }

    constructor(
        address _pair,
        address _user,
        address _vault
    ) {
        pair = _pair;
        user = _user;
        vault = _vault;
    }

    /**
     * @notice Deposits the LP tokens
     */
    function deposit(address _contract, uint256 _amount) external onlyVault {}

    /**
     * @notice Withdraw LP tokens
     */
    function withdraw(uint256 _amount) external onlyVault {}

    /**
     * @notice Claim the tokens
     */
    function claim(address _token, address _to) external onlyOwner {}
}
