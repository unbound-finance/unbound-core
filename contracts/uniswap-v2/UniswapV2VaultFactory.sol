//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.0;

import './UniswapV2Vault.sol';
// libraries
import '@openzeppelin/contracts/utils/math/SafeMath.sol';
import '../interfaces/IERC20.sol';

contract UniswapV2VaultFactory {
    mapping(address => bool) public allowed;
    mapping(address => bool) public validVaults;

    address public governance;
    address public pendingGovernance;

    uint256 public index;

    mapping(uint256 => address) public vaultByIndex;

    event NewVault(address _vault, uint256 _index);
    event ChangeGovernance(address _governance);

    event EnableVault(address _vault);
    event DisableVault(address _vault);

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
    ) external returns (address vault) {
        vault = address(
            new UniswapV2Vault(
                _uToken,
                _governance,
                _pair,
                _stablecoin,
                _feeds,
                _maxPercentDiff,
                _allowedDelay,
                _staking
            )
        );
        index = index + 1;
        vaultByIndex[index] = vault;
        validVaults[vault] = true;
        emit NewVault(vault, index);
    }

    /**
     * @notice Enable vault so the vault can start minting uTokens
     * @param _vault Address of the vault to enable
     */
    function enableVault(address _vault) external onlyGovernance {
        require(validVaults[_vault]);
        allowed[_vault] = true;
        emit EnableVault(_vault);
    }

    /**
     * @notice Disables the vault to stop minting of uTokens
     * @param _vault Address of the vault
     */
    function disableVault(address _vault) external onlyGovernance {
        allowed[_vault] = false;
        emit DisableVault(_vault);
    }

    /**
     * @notice Changes governnance via two step process
     * @param _governance Address of the new governance
     */
    function changeGovernance(address _governance) external onlyGovernance {
        pendingGovernance = _governance;
        emit ChangeGovernance(_governance);
    }

    /**
     * @notice Accept governance role, should be called from pending governance
     */
    function acceptGovernance() external {
        require(msg.sender == pendingGovernance, 'NA');
        governance = pendingGovernance;
    }
}
