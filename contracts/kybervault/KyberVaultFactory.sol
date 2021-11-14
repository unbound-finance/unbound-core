//SPDX-License-Identifier: Unlicense
pragma solidity >=0.7.6;

import './KyberVault.sol';
// libraries
import '@openzeppelin/contracts/math/SafeMath.sol';

// interfaces
import '../interfaces/IERC20.sol';

contract KyberVaultFactory {
    mapping(address => bool) public allowed;
    mapping(address => bool) public vaults;

    address public governance;
    address public pendingGovernance;

    uint256 public index;

    address public kyberDMMFactory;

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
     * @param _factory Address of the uniswap factory contract
     */
    constructor(address _governance, address _factory) {
        governance = _governance;
        kyberDMMFactory = _factory;
    }

    /**
     * @notice Creates new vault
     * @param _uToken Address of the Unbound Token
     * @param _governance Address of the governance
     * @param _pair Address of the pool token
     * @param _stablecoin Address of the stablecoin
     * @param _feeds Array of the chainlink feeds to get weighed asset
     * @param _maxPercentDiff Percent deviation for oracle price. 1e8 is 100%
     * @param _allowedDelay Allowed delay for Chainlink price update
     * @param _staking Address where the stake fees should be donated
     */
    function createVault(
        address _uToken,
        address _governance,
        address _pair,
        address _stablecoin,
        address[] memory _feeds,
        uint256 _maxPercentDiff,
        uint256 _allowedDelay,
        address _staking
    ) external onlyGovernance returns (address vault) {
        vault = address(
            new KyberVault(
                _uToken,
                _governance,
                _pair,
                _stablecoin,
                _feeds,
                _maxPercentDiff,
                _allowedDelay,
                _staking,
                kyberDMMFactory
            )
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
        enableDates[_vault] = 0;
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
        require(disableDates[_vault] + 3 days < block.timestamp, 'WD');
        disableDates[_vault] = 0;
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
}
