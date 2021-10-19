//SPDX-License-Identifier: Unlicense
pragma solidity >=0.7.6;
pragma abicoder v2;

import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

//interface
import "../../interfaces/IMasterChefSushi.sol";

contract SushiSwapYieldWallet{

    using SafeERC20 for IERC20;

    address public pair;
    address public user; // owner of the yieldWallet
    address public vault; // factory from which this vault is deployed

    address public farming; // Address where LPTs will be staked
    uint256 public pid; // pid of the pool for pair

    IERC20 public rewardToken; // Reward token instance;


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
        address _vault,
        address _farming,
        uint256 _pid
    ) {

        IMasterChefSushi.PoolInfo memory pool =  IMasterChefSushi(_farming).poolInfo(_pid);

        require(address(pool.lpToken) == _pair, "IP");
    
        pair = _pair;
        user = _user;
        vault = _vault;
        farming = _farming;
        pid = _pid;

        rewardToken = IERC20(IMasterChefSushi(_farming).sushi());

        // approve allowance to farming contract
        IERC20(_pair).approve(_farming, type(uint256).max);
    }

    /**
     * @notice Deposits the LP tokens
     * @param _amount Amount of LPTs to deposit
     */
    function deposit(uint256 _amount) external onlyVault {
        IMasterChefSushi(farming).deposit(pid, _amount);
        if (rewardToken.balanceOf(address(this)) > 0){
            _withdrawFunds(rewardToken, user, rewardToken.balanceOf(address(this)));
        }
    }

    /**
     * @notice Withdraw LP tokens
     * @param _amount Amount of LPTs to withdraw
     */
    function withdraw(uint256 _amount) external onlyVault {

        IMasterChefSushi(farming).withdraw(pid, _amount);

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
        IERC20(_token).transfer(_to, IERC20(_token).balanceOf(address(this)));
    }

   /**
    * @notice Return wallet info including deposited amount and reward data
    */
    function getWalletInfo() 
        external view returns (IMasterChefSushi.UserInfo memory)
    {
        return IMasterChefSushi(farming).userInfo(pid, address(this));
    }

   /**
    * @notice Get pending rewards of a user from a pool, mostly for front-end
    */
    function getPendingRewards() external view returns (uint256){

        return IMasterChefSushi(farming).pendingSushi(pid, address(this));

    }

    /* ========== INTERNAL FUNCTIONS ========== */

    function _withdrawFunds(IERC20 _token, address _to, uint256 _amount) internal {
        _token.safeTransfer(_to, _amount);
    }

}
