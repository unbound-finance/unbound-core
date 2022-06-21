pragma solidity 0.7.6;
pragma abicoder v2;

interface IMiniChefV2 {

    /// @notice Info of each MCV2 user.
    /// `amount` LP token amount the user has provided.
    /// `rewardDebt` The amount of reward entitled to the user.
    struct UserInfo {
        uint256 amount;
        int256 rewardDebt;
    }

    function REWARD() external view returns(address);
    function lpToken(uint256 _pid) external view returns(address);

    function userInfo(uint256 _pis, address _user) external view returns(UserInfo memory);

    function pendingReward(uint256 _pid, address _user) external view returns (uint256 pending);

    function deposit(uint256 pid, uint256 amount, address to) external;
    function withdraw(uint256 pid, uint256 amount, address to) external;

    function harvest(uint256 pid, address to) external;
}