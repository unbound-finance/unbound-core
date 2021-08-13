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
    address public team; // address where protocol fee should be sent

    uint256 public safuShare; // share of the safu fund, 1e8 is 100%
    address public safu; // address of the safu fund

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
        require(address(pair) != _token && address(uToken) != _token);
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
     * @param _team New fee to address
     */
    function changeTeamFeeAddress(address _team) external onlyGovernance {
        team = _team;
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

    /**
     * @notice Distributes the fee collected to the contract
     */
    function distributeFee() external {
        uint256 amount = IERC20(address(uToken)).balanceOf(address(this));
        IERC20(address(uToken)).transfer(safu, amount.mul(safuShare).div(1e6));
        IERC20(address(uToken)).transfer(
            team,
            amount.sub(amount.mul(safuShare).div(1e6))
        );
    }
}
