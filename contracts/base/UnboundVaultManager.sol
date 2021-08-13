//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.0;

// libraries
import '@openzeppelin/contracts/utils/math/SafeMath.sol';
import '../interfaces/IERC20.sol';

// interfaces
import '@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol';
import '../interfaces/IUnboundToken.sol';

/**
 * Details
 * UnboundVaultManager acts as a manager for add admin functionalities
 * It contains all the base functionality required to mint uTokens
 */

contract UnboundVaultManager {
    using SafeMath for uint256;

    address public factory; // address of vault factory
    IUniswapV2Pair public pair; // address of liquidity pool token
    IUnboundToken public uToken; // address of Unbound token to mint

    address public governance;
    address public manager;
    address public pendingGovernance;

    uint256 public LTV; // Loan to Value (LTV) rate, 1e8 is 100%
    uint256 public CR; // Collatralization Ratio, 1e8 is 100%

    uint256 public stakeFee; // fee in uToken given to the stakers
    address public staking; // address of the pair where stake fee should be sent

    uint256 public PROTOCOL_FEE; // protocol fee to be taken for team and safu
    address public feeTo; // address where protocol fee should be sent

    // checks if governance is calling
    modifier onlyGovernance() {
        require(msg.sender == governance, 'NA');
        _;
    }

    // government and manager both can call
    modifier governanceAndManager() {
        require(msg.sender == manager || msg.sender == governance, 'NA');
        _;
    }

    /**
     * @notice Claims unwanted or airdropped tokens sent to the contract
     * @param _token Address of the token
     * @param _to Address of the receipient
     */
    function claim(address _token, address _to) external onlyGovernance {
        require(address(pair) != _token);
        IERC20(_token).transfer(_to, IERC20(_token).balanceOf(address(this)));
    }

    /**
     * @notice Changes collatralization ratio
     * @param _CR New ratio to set 1e8 is 100%
     */
    function changeCR(uint256 _CR) external governanceAndManager {
        CR = _CR;
    }

    /**
     * @notice Changes loan to value ratio
     * @param _LTV New loan to value ratio
     */
    function changeLTV(uint256 _LTV) external governanceAndManager {
        require(_LTV <= 1e8);
        LTV = _LTV;
    }

    /**
     * @notice Changes address where the fees should be received
     * @param _feeTo New fee to address
     */
    function changeFeeTo(address _feeTo) external onlyGovernance {
        feeTo = _feeTo;
    }

    /**
     * @notice Changes fees
     * @param _fee New fee. 1e8 is 100%
     */
    function changeFee(uint256 _fee) external onlyGovernance {
        PROTOCOL_FEE = _fee;
    }

    function changeStakeFee(uint256 _stakeFee) external onlyGovernance {
        stakeFee = _stakeFee;
    }

    /**
     * @notice Change governance address
     * @param _governance New governance address
     */
    function changeGovernance(address _governance) external onlyGovernance {
        pendingGovernance = _governance;
    }

    /**
     * @notice Accept governance role, should be called from pending governance
     */
    function acceptGovernance() external {
        require(msg.sender == pendingGovernance);
        governance = pendingGovernance;
    }

    /**
     * @notice Change manager, managers can manage LTV and CR
     * @notice _manager Address of the manager
     */
    function changeManager(address _manager) external onlyGovernance {
        manager = _manager;
    }
}
