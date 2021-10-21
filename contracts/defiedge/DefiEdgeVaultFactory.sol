//SPDX-License-Identifier: Unlicense
pragma solidity >=0.7.6;

import '@openzeppelin/contracts/utils/Pausable.sol';

import './DefiEdgeVault.sol';
// libraries
import '@openzeppelin/contracts/math/SafeMath.sol';

// interfaces
import '../interfaces/IERC20.sol';

contract DefiEdgeVaultFactory is Pausable {
    mapping(address => bool) public allowed;
    mapping(address => bool) public vaults;

    address public governance;
    address public pendingGovernance;

    uint256 public index;

    mapping(uint256 => address) public vaultByIndex;
    mapping(address => uint256) public disableDates;
    mapping(address => uint256) public enableDates;

    event NewVault(address _vault, uint256 _index);
    event ChangeGovernance(address _governance);
    event AcceptGovernance(address _governance);

    event EnableVault(address _vault);
    event DisableVault(address _vault);

    modifier validAddress(address _address) {
        require(_address != address(0), 'IA');
        _;
    }

    modifier onlyGovernance() {
        require(msg.sender == governance, 'NA');
        _;
    }

    /**
     * @param _governance Address of the governance
     */
    constructor(address _governance) {
        governance = _governance;
    }

    /**
     * @notice Creates new vault
     * @param _uToken Address of the Unbound Token
     * @param _governance Address of the governance
     * @param _strategy Address of the defiedge strategy
     * @param _staking Address where the stake fees should be donated
     */
    function createVault(
        address _uToken,
        address _governance,
        address _strategy,
        address _staking
    ) external whenNotPaused returns (address vault) {
        vault = address(
            new DefiEdgeVault(_uToken, _governance, _strategy, _staking)
        );
        index = index + 1;
        vaultByIndex[index] = vault;
        vaults[vault] = true;
        emit NewVault(vault, index);
    }

    /**
     * @notice Enable vault so the vault can start minting uTokens
     * @param _vault Address of the vault to enable
     */
    function enableVault(address _vault) external onlyGovernance {
        enableDates[_vault] = block.timestamp;
        emit EnableVault(_vault);
    }

    /**
     * @notice Executes enable vault function
     * @param _vault Address of the vault
     */
    function executeEnableVault(address _vault) external {
        require(enableDates[_vault] != 0, 'ID');
        require(enableDates[_vault] + 3 days < block.timestamp, 'WD');
        allowed[_vault] = true;
    }

    /**
     * @notice Disables the vault to stop minting of uTokens
     * @param _vault Address of the vault
     */
    function disableVault(address _vault) external onlyGovernance {
        disableDates[_vault] = block.timestamp;
        emit DisableVault(_vault);
    }

    /**
     * @notice Executes disabled vault, should be called after 7 days
     * @param _vault Address of the vault contract
     */
    function executeDisableVault(address _vault) external {
        require(disableDates[_vault] != 0, 'ID');
        require(disableDates[_vault] + 7 days < block.timestamp, 'WD');
        allowed[_vault] = false;
    }

    /**
     * @notice Changes governnance via two step process
     * @param _governance Address of the new governance
     */
    function changeGovernance(address _governance)
        external
        onlyGovernance
        validAddress(_governance)
    {
        pendingGovernance = _governance;
        emit ChangeGovernance(_governance);
    }

    /**
     * @notice Accept governance role, should be called from pending governance
     */
    function acceptGovernance() external {
        require(msg.sender == pendingGovernance, 'NA');
        governance = pendingGovernance;
        emit AcceptGovernance(governance);
    }

    /**
     * @notice Pause the mint and burn functionality
     */
    function setPause() external onlyGovernance {
        _pause();
    }

    /**
     * @notice Unpause the mint and burn functionality
     */
    function setUnpause() external onlyGovernance {
        _unpause();
    }
}
