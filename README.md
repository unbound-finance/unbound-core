# Unbound Core Contracts

Unbound acts as treasury for liquidity pool tokens. Unbound accepts pool tokens as a collateral to mint native UnboundTokens (uTokens) against it. For each pair supported, loan to value (LTV) ratio is calculated off-chain. Unbound issues the loan in form of uToken based on the current LTV and current price of the pool token. Current price of pool token is calculated by taking mean of price from Uniswap reserve ratios and price from Chainlink oracles.

To get the collateral back, user has to return the uTokens to the contract. A Collateralization Ratio (CR) is maintained to support partial unlocking of the collateral. User can also get total collateral back by paying off all the debt without caring about the CR.

The LTV is calculated off chain, governance and manager can control it. Only Governance can set and change manager for LTV.

## Contract Structure

`UniswapV2VaultFactory.sol`: Factory contract to deploy Vaults for Uniswap pool tokens.

`UniswapV2Vault.sol`: Vault is deployed from `UniswapV2VaultFactory` contract. Users interact with the Vault contract to lock and unlock LP tokens.

`UniswapV2PriceProvider.sol` Oracle library to get latest price of Uniswap pool token. The oracle fetches price from Uniswap reserves and Chainlink oracle and takes arithematic mean. If their is price deviation between to, it takes geometric mean to prevent from manipulation

`UnboundVaultBase.sol` (inherited by `UniswapV2Vault.sol`): It contains all the standard functionality required for minting of the uToken. It also manages the fees. It is

`UnboundVaultManager.sol` (inherited by `UnboundVaultBase.sol`): Manager contains all the admin functionality like changing LTV, updating CR ratio or changing governance.

`UnboundToken.sol`: Standard contract for UnboundToken based on OpenZeppelin's ERC20 implementation. The factories of new vaults accepted by Governance can be added to the uToken contract. Once new factory, it takes seven days to have the factory in active state. 7 Days delay is used to keep decentralization.
