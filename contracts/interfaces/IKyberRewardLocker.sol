// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;
pragma abicoder v2;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';

interface IKyberRewardLocker{
  struct VestingSchedule {
    uint64 startBlock;
    uint64 endBlock;
    uint128 quantity;
    uint128 vestedQuantity;
  }

  /**
   * @dev vest all completed schedules for multiple tokens
   */
  function vestCompletedSchedulesForMultipleTokens(IERC20[] calldata tokens)
    external
    returns (uint256[] memory vestedAmounts);

  /**
   * @dev claim multiple tokens for specific vesting schedule,
   *      if schedule has not ended yet, claiming amounts are linear with vesting blocks
   */
  function vestScheduleForMultipleTokensAtIndices(
    IERC20[] calldata tokens,
    uint256[][] calldata indices
  )
    external
    returns (uint256[] memory vestedAmounts);

  /**
   * @dev for all completed schedule, claim token
   */
  function vestCompletedSchedules(IERC20 token) external returns (uint256);

  /**
   * @dev claim token for specific vesting schedule,
   * @dev if schedule has not ended yet, claiming amount is linear with vesting blocks
   */
  function vestScheduleAtIndices(IERC20 token, uint256[] calldata indexes)
    external
    returns (uint256);

  /**
   * @dev claim token for specific vesting schedule from startIndex to endIndex
   */
  function vestSchedulesInRange(
    IERC20 token,
    uint256 startIndex,
    uint256 endIndex
  ) external returns (uint256);

  /**
   * @dev length of vesting schedules array
   */
  function numVestingSchedules(address account, IERC20 token) external view returns (uint256);

  /**
   * @dev get detailed of each vesting schedule
   */
  function getVestingScheduleAtIndex(
    address account,
    IERC20 token,
    uint256 index
  ) external view returns(VestingSchedule memory);

  /**
   * @dev get vesting shedules array
   */
  function getVestingSchedules(address account, IERC20 token) external view returns(VestingSchedule[] memory schedules);
}