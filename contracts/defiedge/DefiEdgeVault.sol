//SPDX-License-Identifier: Unlicense
pragma solidity >=0.7.6;

// import libraries
import '@openzeppelin/contracts/math/SafeMath.sol';
import '../libraries/DefiEdgeSharePriceProvider.sol';

//  import interfaces
import '../interfaces/IUnboundYieldWallet.sol';
import '../interfaces/IUnboundYieldWalletFactory.sol';
import '../interfaces/IDefiEdgeStrategy.sol';
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";

// contracts
import '../base/UnboundVaultBase.sol';

import '../UnboundYieldWallet.sol';

contract DefiEdgeVault is UnboundVaultBase {
    using SafeMath for uint256;

    uint256[] public decimals;

    IDefiEdgeStrategy public strategy;

    event Lock(address _user, uint256 _collateral, uint256 _uTokenAmount);
    event Unlock(address _user, uint256 _collateral, uint256 _uTokenAmount);

    /**
     * @notice Creates new vault
     * @param _uToken Address of the Unbound Token
     * @param _governance Address of the governance
     * @param _strategy Address of the defiedge strategy
     * @param _staking Address where the stake fees should be donated
     */
    constructor(
        address _uToken,
        address _governance,
        address _strategy,
        address _staking
    ) {
        require(
            _uToken != address(0) &&
                _strategy != address(0),
            'I'
        );


        uToken = IUnboundToken(_uToken);
        governance = _governance;
        strategy = IDefiEdgeStrategy(_strategy);
        pair = IUniswapV2Pair(strategy.pool());

        // decimals array
        decimals.push(uint256(IERC20(pair.token0()).decimals()));
        decimals.push(uint256(IERC20(pair.token1()).decimals()));

        staking = _staking;

        factory = msg.sender;
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
    ) external returns (uint256 amount) {
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
        require(strategy.balanceOf(msg.sender) >= _amount, 'BAL');

        // transfer tokens to the vault contract
        require(strategy.transferFrom(msg.sender, address(this), _amount), 'TF');

        // get price of pool token from oracle
        uint256 price = DefiEdgeSharePriceProvider.getSharePrice(
            address(strategy),
            decimals
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

        // give the pool tokens back
        strategy.transfer(msg.sender, amount);

        require(_minCollateral <= amount, 'MIN');

        emit Unlock(msg.sender, amount, _uTokenAmount);
    }

    /**
     * @notice Calculate return amount of collateral based on CR
     * @param _uTokenAmount Amount of uToken to consider to return the collateral
     */
    function getTokensToReturn(uint256 _uTokenAmount)
        internal
        returns (uint256 amount)
    {
        require(CR != 0, 'NI');

        // get price of pool token from oracle
        uint256 price = DefiEdgeSharePriceProvider.getSharePrice(
            address(strategy),
            decimals
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
            
            if(valueStart < valueAfter){
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
    function emergencyUnlock() external {
        require(
            IERC20(address(uToken)).balanceOf(msg.sender) >= debt[msg.sender],
            'BAL'
        );
        uint256 userDebt = debt[msg.sender];
        uint256 userCollateral = collateral[msg.sender];
        collateral[msg.sender] = 0; // prevent getting the same amount again
        burn(msg.sender, userDebt);
        strategy.transfer(msg.sender, userCollateral);
        emit Unlock(msg.sender, userCollateral, userDebt);
    }
}
