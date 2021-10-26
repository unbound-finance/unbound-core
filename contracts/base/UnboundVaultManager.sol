//SPDX-License-Identifier: Unlicense
pragma solidity >=0.7.6;

// libraries
import '@openzeppelin/contracts/math/SafeMath.sol';
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

    uint256 BASE = uint256(1e18); // used to normalise the value to 1e18 format
    uint256 SECOND_BASE = uint256(1e8); // act as base decimals for LTV and CR

    address public factory; // address of vault factory
    IUniswapV2Pair public pair; // address of liquidity pool token
    IUnboundToken public uToken; // address of Unbound token to mint

    mapping(address => bool) public isValidYieldWalletFactory; // Supported factories for yieldWallets
    mapping(address => uint256) public disableYeildWalletFactoryDates; //
    mapping(address => uint256) public enableYeildWalletFactoryDates;

    address public governance;
    address public manager;
    address public pendingGovernance;

    uint256 public uTokenMintLimit; // Total UND token mint limit for vault. If set to 0 then vault can mint unlimited UND

    uint256 public LTV; // Loan to Value (LTV) rate, 1e8 is 100%
    uint256 public CR; // Collatralization Ratio, 1e8 is 100%

    uint256 public stakeFee; // fee in uToken given to the stakers
    address public staking; // address of the pair where stake fee should be sent

    uint256 public PROTOCOL_FEE; // protocol fee to be taken for team and safu
    address public team; // address where protocol fee should be sent

    uint256 public safuShare; // share of the safu fund, 1e8 is 100%
    address public safu; // address of the safu fund

    // events
    event ChangeGovernance(address _governance);
    event ChangeManager(address _manager);

    event ChangeUTokenMintLimit(uint256 _uTokenMintLimit);

    event ChangeLTV(uint256 _LTV);
    event ChangeCR(uint256 _CR);

    event ChangeTeam(uint256 _team);
    event ChangeSafu(address _safu);
    event ChangeStakeFee(uint256 _fee);
    event ChangeProtocolFee(uint256 _PROTOCOL_FEE);
    event ChangeSafuShare(uint256 _safuShare);

    event ChangeTeamFeeAddress(address _team);
    event ChangeStaking(address _staking);
    event DistributeFee(uint256 _amount);

    event EnableYieldFactory(address _factory);
    event DisableYieldFactory(address _factory);
    event ClaimTokens(address _token, address _to, uint256 _amount);

    // checks if governance is calling
    modifier onlyGovernance() {
        require(msg.sender == governance, 'NA');
        _;
    }

    modifier validAddress(address _address) {
        require(_address != address(0), 'IA');
        _;
    }

    // government and manager both can call
    modifier governanceOrManager() {
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
        uint256 transferAmt = IERC20(_token).balanceOf(address(this));
        IERC20(_token).transfer(_to, transferAmt);
        emit ClaimTokens(_token, _to, transferAmt);
    }

    /**
     * @notice Changes uToken mint limit
     * @param _uTokenMintLimit maximum uToken amount that can be minted. Set to 0 if limit is unlimited.
     */
    function changeUTokenMintLimit(uint256 _uTokenMintLimit)
        external
        onlyGovernance
    {
        uTokenMintLimit = _uTokenMintLimit;
        emit ChangeUTokenMintLimit(uTokenMintLimit);
    }

    /**
     * @notice Changes collatralization ratio
     * @param _CR New ratio to set 1e8 is 100%
     */
    function changeCR(uint256 _CR) external governanceOrManager {
        CR = _CR;
        emit ChangeCR(_CR);
    }

    /**
     * @notice Changes loan to value ratio
     * @param _LTV New loan to value ratio, 1e8 is 100%
     */
    function changeLTV(uint256 _LTV) external governanceOrManager {
        require(_LTV <= SECOND_BASE);
        LTV = _LTV;
        emit ChangeLTV(_LTV);
    }

    /**
     * @notice Changes address where the fees should be received
     * @param _team New fee to address
     */
    function changeTeamFeeAddress(address _team)
        external
        onlyGovernance
        validAddress(_team)
    {
        team = _team;
        emit ChangeTeamFeeAddress(_team);
    }

    /**
     * @notice Changes fees
     * @param _fee New fee. 1e8 is 100%
     */
    function changeFee(uint256 _fee) external onlyGovernance {
        require(_fee < SECOND_BASE);
        PROTOCOL_FEE = _fee;
        emit ChangeProtocolFee(_fee);
    }

    /**
     * @notice Change Stake Fee
     * @param _stakeFee new stake fee, 1e8 is 100%
     */
    function changeStakeFee(uint256 _stakeFee) external onlyGovernance {
        require(_stakeFee < SECOND_BASE);
        stakeFee = _stakeFee;
        emit ChangeStakeFee(_stakeFee);
    }

    /**
     * @notice CHanges staking address
     * @param _staking New staking address
     */
    function changeStaking(address _staking)
        external
        onlyGovernance
        validAddress(_staking)
    {
        staking = _staking;
        emit ChangeStaking(_staking);
    }

    /**
     * @notice Changes safuShare
     * @param _safuShare New fee. 1e8 is 100%
     */
    function changeSafuShare(uint256 _safuShare) external onlyGovernance {
        require(_safuShare <= SECOND_BASE);
        safuShare = _safuShare;
        emit ChangeSafuShare(_safuShare);
    }

    /**
     * @notice Changes address where the safu fund should be received
     * @param _safu New safu fund address
     */
    function changeSafuAddress(address _safu) external onlyGovernance {
        require(_safu != address(0));
        safu = _safu;
        emit ChangeSafu(_safu);
    }

    /**
     * @notice Change governance address
     * @param _governance New governance address
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
        require(msg.sender == pendingGovernance);
        governance = pendingGovernance;
    }

    /**
     * @notice Change manager, managers can manage LTV and CR
     * @notice _manager Address of the manager
     */
    function changeManager(address _manager)
        external
        onlyGovernance
        validAddress(_manager)
    {
        manager = _manager;
        emit ChangeManager(_manager);
    }

    /**
     * @notice Distributes the fee collected to the contract
     */
    function distributeFee() external {
        // check if safu is initialized properly
        require((safu != address(0)) && (safuShare > 0), 'INVALID');
        uint256 amount = uToken.balanceOf(address(this));

        if (team != address(0)) {
            // transfer to safu
            uToken.transfer(safu, amount.mul(safuShare).div(SECOND_BASE));

            // transfer remaining to team
            uToken.transfer(
                team,
                amount.sub(amount.mul(safuShare).div(SECOND_BASE))
            );
        } else {
            // transfer the whole to safu
            uToken.transfer(safu, amount);
        }

        emit DistributeFee(amount);
    }

    /**
     * @notice Enable yieldWallet
     * @param _factory Address of the yieldWallet factory to enable
     */
    function enableYieldWalletFactory(address _factory)
        external
        onlyGovernance
    {
        enableYeildWalletFactoryDates[_factory] = block.timestamp;
        emit EnableYieldFactory(_factory);
    }

    /**
     * @notice Executes enableYeildWalletFactory function
     * @param _factory Address of the factory
     */
    function executeEnableYeildWalletFactory(address _factory)
        external
        onlyGovernance
    {
        require(enableYeildWalletFactoryDates[_factory] != 0, 'ID');
        require(
            enableYeildWalletFactoryDates[_factory] + 3 days < block.timestamp,
            'WD'
        );
        isValidYieldWalletFactory[_factory] = true;
    }

    /**
     * @notice Disable yieldWallet factory
     * @param _factory Address of the yieldWallet factory to disable
     */
    function disableYieldWalletFactory(address _factory)
        external
        onlyGovernance
    {
        isValidYieldWalletFactory[_factory] = false;
        enableYeildWalletFactoryDates[_factory] = 0;
        emit DisableYieldFactory(_factory);
    }
}
