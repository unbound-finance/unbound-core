//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.0;

// import libraries
import '@openzeppelin/contracts/utils/math/SafeMath.sol';
import '../libraries/UniswapV2PriceProvider.sol';

//  import interfaces
import '../interfaces/IUnboundYieldWallet.sol';
import '../interfaces/IUnboundYieldWalletFactory.sol';

// contracts
import '../base/UnboundVaultBase.sol';

import '../UnboundYieldWallet.sol';

contract UniswapV2Vault is UnboundVaultBase {
    using SafeMath for uint256;

    bool[] public isPeggedToUSD;
    uint256[] public decimals;
    uint256 public maxPercentDiff;
    uint256 public allowedDelay;
    address[] public feeds;

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
        address _staking
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

        // decimals array
        decimals.push(uint256(IERC20(pair.token0()).decimals()));
        decimals.push(uint256(IERC20(pair.token1()).decimals()));

        bool isPeggedToUSD0;
        bool isPeggedToUSD1;

        pair.token0() == _stablecoin
            ? isPeggedToUSD0 = true
            : isPeggedToUSD1 = true;

        // push to isPeggedToUSD
        isPeggedToUSD.push(isPeggedToUSD0);
        isPeggedToUSD.push(isPeggedToUSD1);

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
    ) external returns (uint256 amount) {
        // get approval using permit
        pair.permit(msg.sender, address(this), _amount, _deadline, _v, _r, _s);
        // transfer tokens to vault contract
        require(pair.allowance(msg.sender, address(this)) == _amount, 'A');
        // lock pool tokens and mint uTokens
        (amount) = _lock(_amount, _mintTo, _minUTokenAmount);
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
        address _farming,
        uint256 _minUTokenAmount
    ) external returns (uint256 amount) {
        // check if it's valid farming address
        require(isValidYieldWalletFactory[_farming], 'IN');

        // lock pool tokens and mint amount
        (amount) = _lock(_amount, _mintTo, _minUTokenAmount);

        // deploy to yield wallet if required
        if (_farming != address(0)) {
            if (yieldWallet[msg.sender] == address(0)) {
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
            IUnboundYieldWallet(yieldWallet[msg.sender]).deposit(
                _farming,
                _amount
            );
        }

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
        // check if user has sufficient balance
        require(pair.balanceOf(msg.sender) >= _amount, 'BAL');

        // transfer tokens to the vault contract
        require(pair.transferFrom(msg.sender, address(this), _amount), 'TF');

        // get price of pool token from oracle
        int256 price = UniswapV2PriceProvider.latestAnswer(
            address(pair),
            decimals,
            feeds,
            isPeggedToUSD,
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
            // remove LP tokens from yield wallet first
            uint256 balanceBefore = pair.balanceOf(address(this));
            IUnboundYieldWallet(yieldWallet[msg.sender]).withdraw(amount);
            uint256 balanceAfter = pair.balanceOf(address(this));

            // transfer pool tokens back to the user
            pair.transfer(msg.sender, balanceAfter.sub(balanceBefore));

            amount = balanceAfter.sub(balanceBefore);
        } else {
            // give the pool tokens back
            pair.transfer(msg.sender, amount);
        }

        require(_minCollateral <= amount, 'MIN');

        emit Unlock(msg.sender, amount, _uTokenAmount);
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
        // get price of pool token from oracle
        int256 price = UniswapV2PriceProvider.latestAnswer(
            address(pair),
            decimals,
            feeds,
            isPeggedToUSD,
            maxPercentDiff,
            allowedDelay
        );

        uint256 currentCR = uint256(price)
            .mul(collateral[msg.sender])
            .mul(SECOND_BASE)
            .div(debt[msg.sender]);

        // multiply by 1e24 to normalize it current CR (base for nomalization + 1e6 added in above step)
        if (CR.mul(BASE.mul(SECOND_BASE)).div(SECOND_BASE) <= currentCR) {
            amount = (collateral[msg.sender].mul(_uTokenAmount)).div(
                debt[msg.sender]
            );
        } else {
            uint256 valueStart = uint256(price).mul(collateral[msg.sender]);
            uint256 loanAfter = debt[msg.sender].sub(_uTokenAmount);
            uint256 valueAfter = (CR.mul(loanAfter).mul(SECOND_BASE)).div(BASE);
            amount = valueStart.sub(valueAfter).div(uint256(price));
        }
    }

    /**
     * @notice Emergency unlock the tokens, burns the uTokens and unlocks LP Tokens
     */
    function emergencyUnlock() external {
        require(
            IERC20(address(uToken)).balanceOf(msg.sender) == debt[msg.sender],
            'BAL'
        );
        uint256 userDebt = debt[msg.sender];
        uint256 userCollateral = collateral[msg.sender];
        burn(msg.sender, userDebt);
        pair.transfer(msg.sender, userCollateral);
        emit Unlock(msg.sender, userCollateral, userDebt);
    }
}
