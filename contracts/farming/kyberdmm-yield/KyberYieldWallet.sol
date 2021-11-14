//SPDX-License-Identifier: Unlicense
pragma solidity >=0.7.6;
pragma abicoder v2;

import '@openzeppelin/contracts/token/ERC20/SafeERC20.sol';

//interface
import '../../interfaces/IKyberRewardLocker.sol';
import '../../interfaces/IKyberFairLaunch.sol';
import './interfaces/IKyberYieldWalletFactory.sol';

contract KyberYieldWallet {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    address public pair;
    address public user; // owner of the yieldWallet
    address public vault; // factory from which this vault is deployed

    address public farming; // Address where LPTs will be staked
    uint256 public pid; // pid of the pool for pair

    address public factory; // Address of the yieldwallet factory

    address public rewardLocker; // Contract address where rewards will be vested;

    mapping(address => bool) allowed;

    modifier onlyVault() {
        require(msg.sender == vault, 'NA');
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == user, 'NA');
        _;
    }

    event WithdrawFund(address indexed token, address to, uint256 amount);

    constructor(
        address _pair,
        address _user,
        address _vault,
        address _farming,
        uint256 _pid
    ) {
        (, address stakeToken, , , , , ) = IKyberFairLaunch(_farming)
            .getPoolInfo(_pid);

        require(stakeToken == _pair, 'IP');

        pair = _pair;
        user = _user;
        vault = _vault;
        farming = _farming;
        pid = _pid;
        factory = msg.sender;

        // approve allowance to farming contract
        IERC20(_pair).approve(_farming, type(uint256).max);

        rewardLocker = IKyberFairLaunch(_farming).rewardLocker();
    }

    /**
     * @notice Deposits the LP tokens
     * @param _amount Amount of LPTs to deposit
     */
    function deposit(uint256 _amount) external onlyVault {
        IKyberFairLaunch(farming).deposit(pid, _amount, true);
    }

    /**
     * @notice Withdraw LP tokens
     * @param _amount Amount of LPTs to withdraw
     */
    function withdraw(uint256 _amount) external onlyVault {
        IKyberFairLaunch(farming).withdraw(pid, _amount);

        _withdrawFunds(IERC20(pair), vault, _amount);
    }

    /**
     * @notice Claim the tokens
     * @param _token Address of the token contract
     * @param _to User address where token will be sent
     */
    function claim(address _token, address _to) external onlyOwner {
        _withdrawFunds(
            IERC20(_token),
            _to,
            IERC20(_token).balanceOf(address(this))
        );
    }

    /**
     * @notice harvest reward from pool for this yield wallet
     */
    function harvest() external onlyOwner {
        IKyberFairLaunch(farming).harvest(pid);
    }

    /**
     * @notice Harvests and claims the tokens
     * @param _token Address of the token contract
     * @param _to User address where token will be sent
     */
    function harvestAndClaim(address _token, address _to) external onlyOwner {
        IKyberFairLaunch(farming).harvest(pid);
        _withdrawFunds(
            IERC20(_token),
            _to,
            IERC20(_token).balanceOf(address(this))
        );
    }

    /**
     * @notice Return wallet info including deposited amount and reward data
     */
    function getWalletInfo()
        external
        view
        returns (
            uint256 amount,
            uint256[] memory unclaimedRewards,
            uint256[] memory lastRewardPerShares
        )
    {
        return IKyberFairLaunch(farming).getUserInfo(pid, address(this));
    }

    /**
     * @notice Get pending rewards of a user from a pool, mostly for front-end
     */
    function getPendingRewards() external view returns (uint256[] memory) {
        return IKyberFairLaunch(farming).pendingRewards(pid, address(this));
    }

    /* ========== REWARD LOCKER FUNCITONS ========== */

    /**
     * @notice vest all completed schedules for multiple tokens
     * @param tokens Array of Reward token (knc token) instance
     */
    function vestCompletedSchedulesForMultipleTokens(IERC20[] calldata tokens)
        external
        returns (uint256[] memory vestedAmounts)
    {
        vestedAmounts = IKyberRewardLocker(rewardLocker)
            .vestCompletedSchedulesForMultipleTokens(tokens);
    }

    /**
     * @notice claim multiple tokens for specific vesting schedule,
     *      if schedule has not ended yet, claiming amounts are linear with vesting blocks
     * @param tokens Array of Reward token (knc token) instance
     * @param indices Array of schedule indexes to claim token for each reward tokens
     */
    function vestScheduleForMultipleTokensAtIndices(
        IERC20[] calldata tokens,
        uint256[][] calldata indices
    ) external returns (uint256[] memory vestedAmounts) {
        return
            IKyberRewardLocker(rewardLocker)
                .vestScheduleForMultipleTokensAtIndices(tokens, indices);
    }

    /**
     * @notice claim token for all completed vesting schedule
     * @param token Reward token (knc token) instance
     */
    function vestCompletedSchedules(IERC20 token)
        external
        returns (uint256 totalVestedAmount)
    {
        totalVestedAmount = IKyberRewardLocker(rewardLocker)
            .vestCompletedSchedules(token);

        _withdrawFunds(token, user, totalVestedAmount);
    }

    /**
     * @notice claim token for specific vesting schedule
     * @param token Reward token (knc token) instance
     * @param indexes Array of schedule indexes to claim token
     */
    function vestScheduleAtIndices(IERC20 token, uint256[] memory indexes)
        external
        returns (uint256 totalVestedAmount)
    {
        totalVestedAmount = IKyberRewardLocker(rewardLocker)
            .vestScheduleAtIndices(token, indexes);

        _withdrawFunds(token, user, totalVestedAmount);
    }

    /**
     * @notice claim token for specific vesting schedule from startIndex to endIndex
     * @param token Reward token (knc token) instance
     * @param startIndex Start index of the schedule
     * @param endIndex End index of the schedule
     */
    function vestSchedulesInRange(
        IERC20 token,
        uint256 startIndex,
        uint256 endIndex
    ) external returns (uint256 totalVestedAmount) {
        totalVestedAmount = IKyberRewardLocker(rewardLocker)
            .vestSchedulesInRange(token, startIndex, endIndex);

        _withdrawFunds(token, user, totalVestedAmount);
    }

    /**
     * @notice The number of vesting dates in an account's schedule.
     * @param token Reward token (knc token) instance
     */
    function numVestingSchedules(IERC20 token) external view returns (uint256) {
        return
            IKyberRewardLocker(rewardLocker).numVestingSchedules(
                address(this),
                token
            );
    }

    /**
     * @notice The number of vesting dates in an account's schedule.
     * @param token Reward token (knc token) instance
     */
    function getVestingSchedules(IERC20 token)
        external
        view
        returns (IKyberRewardLocker.VestingSchedule[] memory)
    {
        return
            IKyberRewardLocker(rewardLocker).getVestingSchedules(
                address(this),
                token
            );
    }

    /**
     * @notice The number of vesting dates in an account's schedule.
     * @param token Reward token (knc token) instance
     * @param index index of vesting schedule
     */
    function getVestingScheduleAtIndex(IERC20 token, uint256 index)
        external
        view
        returns (IKyberRewardLocker.VestingSchedule memory)
    {
        return
            IKyberRewardLocker(rewardLocker).getVestingScheduleAtIndex(
                address(this),
                token,
                index
            );
    }

    /* ========== INTERNAL FUNCTIONS ========== */

    function _withdrawFunds(
        IERC20 _token,
        address _to,
        uint256 _amount
    ) internal {
        if (address(_token) == pair) {
            _token.safeTransfer(_to, _amount);

            emit WithdrawFund(address(_token), _to, _amount);
        } else {
            uint256 teamSharePercentage = IKyberYieldWalletFactory(factory)
                .teamShare();

            uint256 teamShare = _amount.mul(teamSharePercentage).div(1e18);
            uint256 userShare = _amount.sub(teamShare);

            _token.safeTransfer(factory, teamShare);
            _token.safeTransfer(_to, userShare);

            emit WithdrawFund(address(_token), factory, teamShare);
            emit WithdrawFund(address(_token), _to, userShare);
        }
    }
}
