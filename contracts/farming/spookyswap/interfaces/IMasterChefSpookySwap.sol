pragma solidity 0.7.6;
pragma abicoder v2;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';

interface IMasterChefSpookySwap {

    /// @notice Info of each MCV2 pool.
    /// `allocPoint` The amount of allocation points assigned to the pool.
    /// Also known as the amount of BOO to distribute per second.
    struct PoolInfo {
        uint128 accBooPerShare;
        uint64 lastRewardTime;
        uint64 allocPoint;
    }

    /// @notice Info of each MCV2 user.
    /// `amount` LP token amount the user has provided.
    /// `rewardDebt` The amount of BOO entitled to the user.
    struct UserInfo {
        uint amount;
        uint rewardDebt;
    }

    function poolInfo(uint256 _pid) external view returns(PoolInfo memory);

    function userInfo(uint256 _pis, address _user) external view returns(UserInfo memory);

    function pendingBOO(uint256 _pid, address _user) external view returns (uint256);

    function lpToken(uint256 _pid) external view returns(IERC20);
    
    function isLpToken(address _lpToken) external view returns(bool);

    function BOO() external view returns (address);

    function deposit(uint256 _pid, uint256 _amount) external;

    function withdraw(uint256 _pid, uint256 _amount) external;

    
}