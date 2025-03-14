//SPDX-License-Identifier: Unlicense
pragma solidity >=0.7.6;

import '@openzeppelin/contracts/access/Ownable.sol';

import './SpookySwapYieldWallet.sol';

contract SpookySwapYieldWalletFactory is Ownable {

    using SafeERC20 for IERC20;

    address public team; // Address of team where part of reward will be sent
    address public farmingContract; // MasterChef contract address where LPTs will be staked

    uint256 public constant teamShare = 2e17; // 1e18 is 100%, setting it to 20%

    mapping(address => uint256) public pids; // stakig token => pid mapping

    event YeildWalletFactory(address _wallet);
    event SetPids(address[] _stakingTokens, uint256[] _pids);
    event DistributeFee(address _rewardToken, uint256 _amount);
    event ChangeTeamFeeAddress(address _team);

    constructor(address _farming) {
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
        wallet = address(
            new SpookySwapYieldWallet(
                _pair,
                _user,
                _vault,
                farmingContract,
                pids[_pair]
            )
        );
        emit YeildWalletFactory(wallet);
    }

    /**
     * @notice Set PID for all pairs
     * @param _stakingTokens Array of pair addresses
     * @param _pids Array of pid of the pair addresses
     */
    function setPids(address[] memory _stakingTokens, uint256[] memory _pids)
        external
        onlyOwner
    {
        require(_stakingTokens.length == _pids.length, 'IA');

        for (uint256 id = 0; id < _pids.length; id++) {
            pids[_stakingTokens[id]] = _pids[id];
        }

        emit SetPids(_stakingTokens, _pids);
    }

    /**
     * @notice Distributes the fee collected to the team address
     * @param token Instance of reward token
     */
    function distributeFee(IERC20 token) external {
        // check if team is initialized properly
        require(team != address(0), 'INVALID');
        uint256 amount = token.balanceOf(address(this));
        
        // transfer the whole reward fee collected to team
        token.transfer(team, amount);

        emit DistributeFee(address(token), amount);
    }

    /**
     * @notice Changes address where the fees should be received
     * @param _team New fee to address
     */
    function changeTeamFeeAddress(address _team)
        external
        onlyOwner
    {
        require(_team != address(0), 'IA');
        team = _team;
        emit ChangeTeamFeeAddress(_team);
    }
}
