//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.0;

import '@openzeppelin/contracts/utils/math/SafeMath.sol';

import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import '@openzeppelin/contracts/token/ERC20/extensions/draft-ERC20Permit.sol';

// import interfaces
import './interfaces/IUnboundVault.sol';
import './interfaces/IUnboundVaultFactory.sol';

contract UnboundToken is ERC20, ERC20Permit {
    using SafeMath for uint256;

    address public governance;
    address public pendingGovernance;

    // allowed factories to mint the UNDs
    mapping(address => bool) public minters;
    mapping(address => uint256) public addTime;

    event AddMinter(address _minter);
    event EnableMinter(address _minter);
    event ChangeGovernance(address _governance);

    modifier onlyGovernance() {
        require(msg.sender == governance, 'NA');
        _;
    }

    // check if the minter is valid
    modifier validMinter() {
        IUnboundVault vault = IUnboundVault(msg.sender);
        // check if it's deployed from valid factory
        require(minters[address(vault.factory())], 'NA');
        // check if the vault is allowed to mint UTokens
        require(
            IUnboundVaultFactory(address(vault.factory())).allowed(msg.sender),
            'NA'
        );
        _;
    }

    constructor(address _governance)
        ERC20Permit('Unbound Dollar')
        ERC20('Unbound Dollar', 'UND')
    {
        governance = _governance;
    }

    /**
     * @notice Mint tokens to the provided account
     * @param _account Address where tokens will be minted
     * @param _amount Amount of tokens to be minted
     */
    function mint(address _account, uint256 _amount) external validMinter {
        _mint(_account, _amount);
    }

    /**
     * @notice Burn tokens from the provided account
     * @param _account Address to burn tokens from
     * @param _amount Amount of tokens to be burned
     */
    function burn(address _account, uint256 _amount) external validMinter {
        _burn(_account, _amount);
    }

    /**
     * @notice Adds the minter
     * @param _minter address of the minter
     */
    function addMinter(address _minter) external onlyGovernance {
        addTime[_minter] = block.timestamp;
        emit AddMinter(_minter);
    }

    /**
     * @notice Enable the minter
     * @param _minter Address of the minter
     */
    function enableMinter(address _minter) external onlyGovernance {
        require(addTime[_minter] > 0);
        require(block.timestamp.sub(addTime[_minter]) >= 604800);
        minters[_minter] = true;
        emit EnableMinter(_minter);
    }

    /**
     * @notice Changes governnance via two step process
     * @param _governance Address of the new governance
     */
    function changeGovernance(address _governance) external onlyGovernance {
        require(_governance != address(0));
        pendingGovernance = _governance;
        emit ChangeGovernance(_governance);
    }

    /**
     * @notice Accept governance role
     */
    function acceptGovernance() external {
        require(msg.sender == pendingGovernance, 'NA');
        governance = pendingGovernance;
    }
}
