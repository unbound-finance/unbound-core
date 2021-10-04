//SPDX-License-Identifier: Unlicense
pragma solidity >=0.7.6;

import '@openzeppelin/contracts/access/Ownable.sol';

import './KyberYieldWallet.sol';

contract KyberYieldWalletFactory is Ownable {

    address public farmingContract; // DMM contract address where LPTs will be staked

    mapping (address => uint256) public pids; // stakig token => pid mapping

    event YeildWalletFactory(address _wallet);

    constructor (address _farming) {
        farmingContract = _farming;
    }

    /**
     * @notice Creates Yeild wallet
     * @param _pair Address of DMM Pair
     * @param _user Address of the owner of the vault
     * @param _vault Address of the vault the wallet is linked to
     */
    function create(
        address _pair,
        address _user,
        address _vault
    ) external returns (address wallet) {
        wallet = address(new KyberYieldWallet(_pair, _user, _vault, farmingContract, pids[_pair]));
        emit YeildWalletFactory(wallet);
    }

    /**
     * @notice Set PID for all pairs
     * @param _stakingTokens Array of pair addresses
     * @param _pids Array of pid of the pair addresses
     */
    function setPids(address[] memory _stakingTokens, uint256[] memory _pids) external onlyOwner{
        require(_stakingTokens.length == _pids.length, "IA");

        for(uint256 id = 0; id < _pids.length; id++){
            pids[_stakingTokens[id]] = _pids[id];
        }
    }
}
