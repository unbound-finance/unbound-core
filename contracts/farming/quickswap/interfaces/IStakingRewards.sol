//SPDX-License-Identifier: Unlicense
pragma solidity >=0.7.6;
pragma abicoder v2;

interface IStakingRewards {

    struct StakingRewardsInfo {
        address stakingRewards;
        uint rewardAmount;
        uint duration;
    }

    function stakingRewardsInfoByStakingToken(address stakingToken) external view returns(StakingRewardsInfo memory);
    
    function rewardsToken() external view returns(address);

    function balanceOf(address account) external view returns(uint256);

    function earned(address account) external view returns(uint256);

    function stake(uint256 _amount) external;

    function withdraw(uint256 _amount) external;
    
    function exit() external;
    
    function getReward() external;
}