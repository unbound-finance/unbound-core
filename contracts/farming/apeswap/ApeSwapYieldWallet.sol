//SPDX-License-Identifier: Unlicense
pragma solidity >=0.7.6;
pragma abicoder v2;

import '@openzeppelin/contracts/token/ERC20/SafeERC20.sol';

//interface
import './interfaces/IMasterChefApe.sol';
import './interfaces/IApeSwapYieldWalletFactory.sol';

contract ApeSwapYieldWallet {

    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    address public pair;
    address public user; // owner of the yieldWallet
    address public vault; // factory from which this vault is deployed

    address public farming; // Address where LPTs will be staked
    uint256 public pid; // pid of the pool for pair

    address public factory; // Address of the yield wallet factory

    IERC20 public rewardToken; // Reward token instance;

    mapping(address => bool) allowed;

    event Claim(address _token, address _to, uint256 _amount);
    event Deposit(uint256 _pid, uint256 _amount);
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
        address _farming,
        uint256 _pid
    ) {
        IMasterChefApe.PoolInfo memory pool = IMasterChefApe(_farming)
            .poolInfo(_pid);

        require(address(pool.lpToken) == _pair, 'IP');

        pair = _pair;
        user = _user;
        vault = _vault;
        farming = _farming;
        pid = _pid;
        factory = msg.sender;

        rewardToken = IERC20(IMasterChefApe(_farming).cake());

        // approve allowance to farming contract
        IERC20(_pair).approve(_farming, type(uint256).max);
    }

    /**
     * @notice Deposits the LP tokens
     * @param _amount Amount of LPTs to deposit
     */
    function deposit(uint256 _amount) external onlyVault {
        IMasterChefApe(farming).deposit(pid, _amount);
        if (rewardToken.balanceOf(address(this)) > 0) {
            _withdrawFunds(
                rewardToken,
                user,
                rewardToken.balanceOf(address(this))
            );
        }
        emit Deposit(pid, _amount);
    }

    /**
     * @notice Withdraw LP tokens
     * @param _amount Amount of LPTs to withdraw
     */
    function withdraw(uint256 _amount) external onlyVault {
        IMasterChefApe(farming).withdraw(pid, _amount);

        // Send LPs to vault
        _withdrawFunds(IERC20(pair), vault, _amount);

        // Send Rewards to user account
        _withdrawFunds(rewardToken, user, rewardToken.balanceOf(address(this)));
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
        returns (IMasterChefApe.UserInfo memory)
    {
        return IMasterChefApe(farming).userInfo(pid, address(this));
    }

    /**
     * @notice Get pending rewards of a user from a pool, mostly for front-end
     */
    function getPendingRewards() external view returns (uint256) {
        return IMasterChefApe(farming).pendingCake(pid, address(this));
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

            uint256 teamSharePercentage = IApeSwapYieldWalletFactory(factory).teamShare();

            uint256 teamShare = _amount.mul(teamSharePercentage).div(1e18);
            userShare = _amount.sub(teamShare);

            _token.safeTransfer(factory, teamShare);
            _token.safeTransfer(_to, userShare);

            emit WithdrawFund(address(_token), factory, teamShare);
            emit WithdrawFund(address(_token), _to, userShare);

        }
    }
}
