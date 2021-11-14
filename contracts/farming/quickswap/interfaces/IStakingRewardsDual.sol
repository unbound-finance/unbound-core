//SPDX-License-Identifier: Unlicense
pragma solidity >=0.7.6;
pragma abicoder v2;

interface IStakingRewardsDual {

    struct StakingRewardsInfo {
        address stakingRewards;
        address rewardsTokenA;
        address rewardsTokenB;
        uint256 rewardAmountA;
        uint256 rewardAmountB;
        uint256 duration;
    }

    function stakingRewardsInfoByStakingToken(address stakingToken) external view returns(StakingRewardsInfo memory);

    function balanceOf(address account) external view returns(uint256);

    function earnedA(address account) external view returns(uint256);
    
    function earnedB(address account) external view returns(uint256);

    function stake(uint256 _amount) external;

    function withdraw(uint256 _amount) external;
    
    function exit() external;
    
    function getReward() external;
}