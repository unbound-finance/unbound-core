//SPDX-License-Identifier: Unlicense
pragma solidity >=0.7.6;
pragma abicoder v2;

import '@openzeppelin/contracts/token/ERC20/SafeERC20.sol';

//interface
import '../interfaces/IStakingRewardsDual.sol';
import '../interfaces/IQuickSwapYieldWalletFactory.sol';

contract QuickSwapDualRewardsYieldWallet {

    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    address public pair;
    address public user; // owner of the yieldWallet
    address public vault; // factory from which this vault is deployed

    address public stakingRewardFactory; // Address of staking rewardd factory contract
    address public stakingContract; // Address where LPTs will be staked

    address public factory; // Address of the yield wallet factory

    IERC20 public rewardsTokenA; // Reward token 1 instance;
    IERC20 public rewardsTokenB; // Reward token 2 instance;

    mapping(address => bool) allowed;

    event Claim(address _token, address _to, uint256 _amount);
    event Deposit(uint256 _amount);
    event WithdrawFund(address indexed token, address to, uint256 amount);

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
        address _vault,
        address _stakingRewardFactory
    ) {

        IStakingRewardsDual.StakingRewardsInfo memory info = IStakingRewardsDual(_stakingRewardFactory)
            .stakingRewardsInfoByStakingToken(_pair);

        require(info.stakingRewards != address(0), 'IP');

        stakingContract = info.stakingRewards;
        
        rewardsTokenA = IERC20(info.rewardsTokenA);
        rewardsTokenB = IERC20(info.rewardsTokenB);

        pair = _pair;
        user = _user;
        vault = _vault;
        stakingRewardFactory = _stakingRewardFactory;
        factory = msg.sender;

        // approve allowance to staking contract
        IERC20(_pair).approve(stakingContract, type(uint256).max);
    }

    /**
     * @notice Deposits the LP tokens
     * @param _amount Amount of LPTs to deposit
     */
    function deposit(uint256 _amount) external onlyVault {
        IStakingRewardsDual(stakingContract).stake(_amount);
        emit Deposit(_amount);
    }

    /**
     * @notice Withdraw LP tokens
     * @param _amount Amount of LPTs to withdraw
     */
    function withdraw(uint256 _amount) external onlyVault {
        IStakingRewardsDual(stakingContract).withdraw(_amount);

        // Send LPs to vault
        _withdrawFunds(IERC20(pair), vault, _amount);
    }

    /**
     * @notice Withdraw All staked LP tokens and rewards
     */
    function getReward() external onlyOwner {
        IStakingRewardsDual(stakingContract).getReward();

        // Send Rewards token 1 to user
        _withdrawFunds(rewardsTokenA, user, rewardsTokenA.balanceOf(address(this)));

        // Send Rewards token 2 to user
        _withdrawFunds(rewardsTokenB, user, rewardsTokenB.balanceOf(address(this)));
    }

    /**
     * @notice Claim the tokens from the contract
     * @param _token Address of the token contract
     * @param _to User address where token will be sent
     */
    function claim(address _token, address _to) external onlyOwner {
        uint256 transferAmount = _withdrawFunds(IERC20(_token), _to, IERC20(_token).balanceOf(address(this)));
        emit Claim(_token, _to, transferAmount);
    }

    /**
     * @notice Return wallet info including deposited amount and reward data
     */
    function getWalletInfo()
        external
        view
        returns (uint256 stakedAmount, uint256 earnedA, uint256 earnedB)
    {
        stakedAmount = IStakingRewardsDual(stakingContract).balanceOf(address(this));
        earnedA = IStakingRewardsDual(stakingContract).earnedA(address(this));
        earnedB = IStakingRewardsDual(stakingContract).earnedB(address(this));
    }

    /* ========== INTERNAL FUNCTIONS ========== */

    function _withdrawFunds(
        IERC20 _token,
        address _to,
        uint256 _amount
    ) internal returns(uint256 userShare){

        if(address(_token) == pair){

            _token.safeTransfer(_to, _amount);
            
            emit WithdrawFund(address(_token), _to, _amount);

        } else {

            uint256 teamSharePercentage = IQuickSwapYieldWalletFactory(factory).teamShare();

            uint256 teamShare = _amount.mul(teamSharePercentage).div(1e18);
            userShare = _amount.sub(teamShare);

            _token.safeTransfer(factory, teamShare);
            _token.safeTransfer(_to, userShare);

            emit WithdrawFund(address(_token), factory, teamShare);
            emit WithdrawFund(address(_token), _to, userShare);

        }
    }
}
