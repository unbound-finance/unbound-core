//SPDX-License-Identifier: Unlicense
pragma solidity >=0.7.6;

// import libraries
import '@openzeppelin/contracts/math/SafeMath.sol';
import '../libraries/UniswapV2PriceProvider.sol';

//  import interfaces
import '../interfaces/IUnboundYieldWallet.sol';
import '../interfaces/IUnboundYieldWalletFactory.sol';
import '../interfaces/IMigratorVault.sol';
import '@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol';

// contracts
import '../base/UnboundVaultBase.sol';

contract UniswapV2Vault is UnboundVaultBase {
    using SafeMath for uint256;

    bool[] public isBase;
    uint256[] public decimals;
    uint256 public maxPercentDiff;
    uint256 public allowedDelay;
    address[] public feeds;

    IMigratorVault public migrator; // Instance of new vault contract

    event Lock(address _user, uint256 _collateral, uint256 _uTokenAmount);
    event Unlock(address _user, uint256 _collateral, uint256 _uTokenAmount);

    /**
     * @notice Creates new vault
     * @param _uToken Address of the Unbound Token
     * @param _governance Address of the governance
     * @param _pair Address of the pool token
     * @param _stablecoin Address of the stablecoin
     * @param _feeds Array of the chainlink feeds to get weighed asset
     * @param _maxPercentDiff Percent deviation for oracle price. 1e8 is 100%
     * @param _allowedDelay Allowed delay for Chainlink price update, in Epoch secondss
     * @param _staking Address where the stake fees should be donated
     */
    constructor(
        address _uToken,
        address _governance,
        address _pair,
        address _stablecoin,
        address[] memory _feeds,
        uint256 _maxPercentDiff,
        uint256 _allowedDelay,
        address _staking,
        address _uniswapFactory
    ) {
        require(
            _uToken != address(0) &&
                _pair != address(0) &&
                _stablecoin != address(0),
            'I'
        );

        require(_feeds.length <= 2, 'IF');

        uToken = IUnboundToken(_uToken);
        governance = _governance;
        pair = IUniswapV2Pair(_pair);

        require(pair.decimals() == 18, 'ID');

        // verify validity of the pool
        require(
            IUniswapV2Factory(_uniswapFactory).getPair(
                pair.token0(),
                pair.token1()
            ) == _pair,
            'INP'
        );

        // decimals array
        decimals.push(uint256(IERC20(pair.token0()).decimals()));
        decimals.push(uint256(IERC20(pair.token1()).decimals()));

        bool isBase0;
        bool isBase1;

        pair.token0() == _stablecoin ? isBase0 = true : isBase1 = true;

        // push to isBase
        isBase.push(isBase0);
        isBase.push(isBase1);

        feeds = _feeds;
        maxPercentDiff = _maxPercentDiff;
        allowedDelay = _allowedDelay;

        staking = _staking;

        factory = msg.sender;
    }

    /**
     * @notice Lock pool token with the permit signature
     * @param _amount Amount of pool tokens to lock
     * @param _mintTo Address to which the UND should be minted
     * @param _minUTokenAmount Minimium amount of uTokens to receive
     * @param _deadline Deadline of the permit signature
     * @param _v V part of the signature
     * @param _r R part of the signature
     * @param _s S part of the signature
     */
    function lockWithPermit(
        uint256 _amount,
        address _mintTo,
        uint256 _minUTokenAmount,
        uint256 _deadline,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) external whenNotPaused returns (uint256 amount) {
        // get approval using permit
        pair.permit(msg.sender, address(this), _amount, _deadline, _v, _r, _s);

        // transfer tokens to vault contract
        require(pair.allowance(msg.sender, address(this)) == _amount, 'A');

        // lock pool tokens and mint uTokens
        (amount) = _lock(_amount, _mintTo, _minUTokenAmount);

        emit Lock(msg.sender, _amount, amount);
    }

    /**
     * @notice Lock pool tokens without permit
     * @param _amount Amount of pool tokens to lock
     * @param _mintTo Address to which the UND should be minted
     * @param _minUTokenAmount Minimum uTokens to receive
     */
    function lock(
        uint256 _amount,
        address _mintTo,
        uint256 _minUTokenAmount
    ) external whenNotPaused returns (uint256 amount) {
        // lock pool tokens and mint amount
        (amount) = _lock(_amount, _mintTo, _minUTokenAmount);

        emit Lock(msg.sender, _amount, amount);
    }

    /**
     * @notice Internal lock function to lock LPT
     * @param _amount Amount to lock
     * @param _mintTo Address to which the uTokens should be minted
     * @param _minUTokenAmount Minimum number of uTokens to mint
     */
    function _lock(
        uint256 _amount,
        address _mintTo,
        uint256 _minUTokenAmount
    ) internal returns (uint256 amount) {
        require(LTV != 0, 'NI');
        // check if user has sufficient balance
        require(pair.balanceOf(msg.sender) >= _amount, 'BAL');

        // transfer tokens to the vault contract
        require(pair.transferFrom(msg.sender, address(this), _amount), 'TF');

        // get price of pool token from oracle
        int256 price = UniswapV2PriceProvider.latestAnswer(
            address(pair),
            decimals,
            feeds,
            isBase,
            maxPercentDiff,
            allowedDelay
        );

        // get total value in base asset
        uint256 value = _amount.mul(uint256(price)).div(BASE);

        amount = value.mul(LTV).div(SECOND_BASE);

        collateral[msg.sender] = collateral[msg.sender].add(_amount);

        (amount) = mint(msg.sender, amount, _mintTo);

        require(_minUTokenAmount <= amount, 'MIN');
    }

    /**
     * @notice Unlocks the pool tokens
     *   To get 100% of the pool tokens back, user has burn 100% of uTokens
     * @param _uTokenAmount Number of uTokens to burn
     * @param _minCollateral Minimum collateral to give
     */
    function unlock(uint256 _uTokenAmount, uint256 _minCollateral)
        external
        whenNotPaused
        returns (uint256 amount)
    {
        require(debt[msg.sender] >= _uTokenAmount, 'BAL');

        // if user is returning 100% loan, give 100% of collateral
        if (debt[msg.sender] == _uTokenAmount) {
            amount = collateral[msg.sender];
        } else {
            amount = getTokensToReturn(_uTokenAmount);
        }

        collateral[msg.sender] = collateral[msg.sender].sub(amount);

        burn(msg.sender, _uTokenAmount);

        if (yieldWalletDeposit[msg.sender] > 0) {
            amount = _unstakeLP(msg.sender, amount);

            // transfer pool tokens back to the user
            pair.transfer(msg.sender, amount);
        } else {
            // give the pool tokens back
            pair.transfer(msg.sender, amount);
        }

        require(_minCollateral <= amount, 'MIN');

        emit Unlock(msg.sender, amount, _uTokenAmount);
    }

    function stakeLP(
        address _farming,
        uint256 _amount,
        bool _createNewWallet
    ) external whenNotPaused validAddress(_farming) {
        // check if it's valid farming address
        require(isValidYieldWalletFactory[_farming], 'IN');

        require(
            collateral[msg.sender].sub(yieldWalletDeposit[msg.sender]) >=
                _amount,
            'invalid'
        );

        if (_createNewWallet == true && yieldWallet[msg.sender] != address(0)) {
            require(yieldWalletDeposit[msg.sender] == 0, 'unstake');
        }

        if (yieldWallet[msg.sender] == address(0) || _createNewWallet == true) {
            // create vault
            address wallet = IUnboundYieldWalletFactory(_farming).create(
                address(pair),
                msg.sender,
                address(this)
            );
            yieldWallet[msg.sender] = wallet;
        }

        yieldWalletDeposit[msg.sender] = yieldWalletDeposit[msg.sender].add(
            _amount
        );
        // transfer tokens to the vault
        pair.transfer(yieldWallet[msg.sender], _amount);
        // deposit to yield
        IUnboundYieldWallet(yieldWallet[msg.sender]).deposit(_amount);
    }

    function unstakeLP(uint256 _amount) external whenNotPaused {
        _unstakeLP(msg.sender, _amount);
    }

    function _unstakeLP(address _user, uint256 _amount)
        internal
        returns (uint256 amount)
    {
        require(yieldWalletDeposit[_user] >= _amount, 'invalid');

        // remove LP tokens from yield wallet first
        uint256 balanceBefore = pair.balanceOf(address(this));
        IUnboundYieldWallet(yieldWallet[_user]).withdraw(_amount);
        uint256 balanceAfter = pair.balanceOf(address(this));

        amount = balanceAfter.sub(balanceBefore);

        yieldWalletDeposit[_user] = yieldWalletDeposit[_user].sub(amount);
    }

    /**
     * @notice Calculate return amount of collateral based on CR
     * @param _uTokenAmount Amount of uToken to consider to return the collateral
     */
    function getTokensToReturn(uint256 _uTokenAmount)
        internal
        view
        returns (uint256 amount)
    {
        require(CR != 0, 'NI');

        // get price of pool token from oracle
        int256 price = UniswapV2PriceProvider.latestAnswer(
            address(pair),
            decimals,
            feeds,
            isBase,
            maxPercentDiff,
            allowedDelay
        );

        uint256 currentCR = uint256(price)
            .mul(collateral[msg.sender])
            .mul(SECOND_BASE)
            .div(debt[msg.sender]);

        // multiply by 1e26 to normalize it current CR (base for nomalization + 1e8 added in above step)
        if (CR.mul(BASE) > currentCR) {
            // insufficient collateral
            uint256 valueStart = uint256(price).mul(collateral[msg.sender]);
            uint256 loanAfter = debt[msg.sender].sub(_uTokenAmount);
            uint256 valueAfter = (CR.mul(loanAfter).mul(BASE)).div(SECOND_BASE);

            if (valueStart < valueAfter) {
                amount = 0;
            } else {
                amount = valueStart.sub(valueAfter).div(uint256(price));
            }
        } else {
            // enough collateral
            amount = (collateral[msg.sender].mul(_uTokenAmount)).div(
                debt[msg.sender]
            );
        }
    }

    /**
     * @notice Emergency unlock the tokens, burns the uTokens and unlocks LP Tokens
     */
    function emergencyUnlock() external whenPaused {
        require(
            IERC20(address(uToken)).balanceOf(msg.sender) >= debt[msg.sender],
            'BAL'
        );

        // give the pool tokens back
        uint256 userDebt = debt[msg.sender];
        uint256 userCollateral = collateral[msg.sender];

        // if the LP tokens are in yeild wallet, withdraw it first
        if (yieldWalletDeposit[msg.sender] > 0) {
            _unstakeLP(msg.sender, yieldWalletDeposit[msg.sender]);
        }

        collateral[msg.sender] = 0; // prevent getting the same amount again
        burn(msg.sender, userDebt);
        pair.transfer(msg.sender, userCollateral);
        emit Unlock(msg.sender, userCollateral, userDebt);
    }

    /**
     * @notice Set new vault contract
     * @param _migrator Address of the new vault contract
     */
    function setMigrator(address _migrator) public onlyGovernance {
        migrator = IMigratorVault(_migrator);
    }

    /**
     * @notice Disable this vault contract and transfer assets to new vault contract
     * @param _farming Address of yield wallet factory where LPs will be staked automatically. Pass address zero if don't want to stake LP
     */
    function migrate(address _farming) public {
        require(address(migrator) != address(0), 'migrate: no migrator');

        pair.approve(address(migrator), collateral[msg.sender]);

        if (yieldWalletDeposit[msg.sender] > 0) {
            _unstakeLP(msg.sender, yieldWalletDeposit[msg.sender]);
        }

        migrator.update(
            msg.sender,
            collateral[msg.sender],
            debt[msg.sender],
            yieldWallet[msg.sender],
            yieldWalletDeposit[msg.sender],
            _farming
        );

        collateral[msg.sender] = 0;
        debt[msg.sender] = 0;
        yieldWallet[msg.sender] = address(0);
        yieldWalletDeposit[msg.sender] = 0;
    }
}
