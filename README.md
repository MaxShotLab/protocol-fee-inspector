# Protocol Fee Inspector

Read-only prototype for retrieving and verifying protocol fee income from five Maxshot Morpho V2 → V1 routes and two Maxshot native omnichain vault ledgers.

## Run

```bash
npm run refresh
npm run start:env
```

Open `http://127.0.0.1:4174`.

## Verification model

- Morpho API supplies vault configuration, V2 → V1 adapter mappings, current share prices, and fee-recipient deposit/withdraw activity.
- Direct public RPC reads supply current `totalAssets()`, `lastTotalAssets()`, `totalSupply()`, and `fee()` for pending unminted fee estimates.
- Blockscout supplies indexed `AccrueInterest(uint256,uint256)` logs from each V1 vault.
- Accrued income values each fee-share mint at the nearest daily USD share price.
- Current unredeemed income values outstanding fee-attributed shares at the current USD share price.
- Current pending income estimates unminted fee shares since the latest accrual using MetaMorpho's `lastTotalAssets` fee formula. This is shown only in the live/current view, not for selected historical dates.
- Redeemed income attributes withdrawals against fee shares first.
- A route is marked **Review** when the fee recipient mixes principal deposits or withdrawals with fee shares, because share provenance is not distinguishable after commingling.

Native vault income is read from each Base ledger's `EpochYieldProcessed(uint256,uint256,uint256)` events. The event's `fees` value is exact finalized fee income in the underlying stablecoin's 6-decimal units. USDC fee shares mint on Base; USDT fee shares mint on Arbitrum. The prototype does not estimate native fees for an epoch that has not yet finalized.

The refresh is atomic: a failed request leaves the previous verified `public/data.json` snapshot intact.

The dashboard's UTC date input reports cumulative historical as-of totals through the selected day, respecting the active route filters. Historical as-of totals are based only on fee-share mints and fee-attributed redemptions through the selected day. The live current snapshot remains visible when a historical date is selected.
