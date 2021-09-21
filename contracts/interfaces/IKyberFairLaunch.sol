// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;
pragma abicoder v2;

interface IKyberFairLaunch {

  /**
   * @dev deposit to tokens to accumulate rewards
   * @param _pid: id of the pool
   * @param _amount: amount of stakeToken to be deposited
   * @param _shouldHarvest: whether to harvest the reward or not
   */
  function deposit(
    uint256 _pid,
    uint256 _amount,
    bool _shouldHarvest
  ) external;

  /**
   * @dev withdraw token (of the sender) from pool, also harvest reward
   * @param _pid: id of the pool
   * @param _amount: amount of stakeToken to withdraw
   */
  function withdraw(uint256 _pid, uint256 _amount) external;

  /**
   * @dev withdraw all tokens (of the sender) from pool, also harvest reward
   * @param _pid: id of the pool
   */
  function withdrawAll(uint256 _pid) external;

  /**
   * @dev emergency withdrawal function to allow withdraw all deposited token (of the sender)
   *   without harvesting the reward
   * @param _pid: id of the pool
   */
  function emergencyWithdraw(uint256 _pid) external;

  /**
   * @dev harvest reward from pool for the sender
   * @param _pid: id of the pool
   */
  function harvest(uint256 _pid) external;
  
  /**
   * @dev return the total of pools that have been added
   */
  function poolLength() external view returns (uint256);

  /**
   * @dev return reward locker contract address
   */
  function rewardLocker() external view returns (address);

  /**
   * @dev return full details of a pool
   */
  function getPoolInfo(uint256 _pid)
    external view
    returns(
      uint256 totalStake,
      address stakeToken,
      uint32 startBlock,
      uint32 endBlock,
      uint32 lastRewardBlock,
      uint256[] memory rewardPerBlocks,
      uint256[] memory accRewardPerShares);

  /**
   * @dev get user's info
   */
  function getUserInfo(uint256 _pid, address _account)
    external view
    returns (
      uint256 amount,
      uint256[] memory unclaimedRewards,
      uint256[] memory lastRewardPerShares);

  /**
  * @dev return list reward tokens
  */
  function getRewardTokens() external view returns (address[] memory);
  /**
   * @dev get pending reward of a user from a pool, mostly for front-end
   * @param _pid: id of the pool
   * @param _user: user to check for pending rewards
   */
  function pendingRewards(
    uint256 _pid,
    address _user
   )
    external view
    returns (uint256[] memory rewards);
}