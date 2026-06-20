import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const data = JSON.parse(await readFile(join(root, "public/data.json"), "utf8"));

assert.equal(data.routes.length, 5, "expected five configured vault routes");
assert.equal(new Set(data.routes.map((route) => route.v1.toLowerCase())).size, 5, "V1 addresses must be unique");
assert.equal(new Set(data.routes.map((route) => route.v2.toLowerCase())).size, 5, "V2 addresses must be unique");
assert.ok(data.routes.every((route) => route.feeRate === 0.05), "all V1 fees must be 5%");
assert.ok(data.routes.every((route) => route.v2FeeRate === 0), "all V2 fees must be 0%");
assert.ok(data.routes.every((route) => Object.values(route.checks).every(Boolean)), "all deterministic verification checks must pass");
assert.ok(data.routes.every((route) => route.feeEventCount > 0), "every V1 route must contain fee events");
assert.ok(data.routes.every((route) => Array.isArray(route.dailyHistory) && route.dailyHistory.length > 0), "every route must include daily fee history");
assert.ok(data.routes.every((route) => Array.isArray(route.priceHistory) && route.priceHistory.length > 0), "every route must include historical share prices");
assert.ok(data.routes.every((route) => route.dailyHistory.every((point) => typeof point.mintedShares === "string" && typeof point.redeemedShares === "string")), "daily share deltas must be serialized exactly");
assert.ok(data.routes.every((route) => typeof route.pendingUnmintedFeeUsd === "number" && typeof route.pendingUnmintedFeeShares === "string"), "every route must include a current pending-fee estimate");
assert.equal(data.routes.reduce((sum, route) => sum + route.feeEventCount, 0), 1522, "unexpected fee-event count");
assert.equal(data.routes.filter((route) => route.status === "review").length, 1, "one mixed-wallet route should require review");
assert.equal(data.native.vaults.length, 2, "expected two native vault ledgers");
assert.ok(data.native.vaults.every((vault) => vault.feeRate === 0.05), "all native vault fees must be 5%");
assert.ok(data.native.vaults.every((vault) => vault.status === "verified" && Object.values(vault.checks).every(Boolean)), "all native ledger checks must pass");
assert.ok(data.native.vaults.every((vault) => vault.eventCount > 0 && vault.history.length > 0), "native ledgers must include fee history");
assert.deepEqual(data.native.vaults.map((vault) => vault.feeChainId), [8453, 42161], "unexpected native fee destination chains");
assert.ok(Math.abs(data.native.vaults.reduce((sum, vault) => sum + vault.accruedUsd, 0) - data.native.summary.accruedUsd) < 1e-6, "native accrued summary mismatch");

for (let index = 1; index < data.history.length; index += 1) {
  assert.ok(data.history[index].timestamp > data.history[index - 1].timestamp, "history timestamps must increase");
  assert.ok(data.history[index].accruedUsd >= data.history[index - 1].accruedUsd, "accrued history must be monotonic");
  assert.ok(data.history[index].redeemedUsd >= data.history[index - 1].redeemedUsd, "redeemed history must be monotonic");
}

const sums = data.routes.reduce((total, route) => ({
  accruedUsd: total.accruedUsd + route.accruedUsd,
  redeemedUsd: total.redeemedUsd + route.redeemedUsd,
  unredeemedUsd: total.unredeemedUsd + route.unredeemedUsd,
  pendingUnmintedFeeUsd: total.pendingUnmintedFeeUsd + route.pendingUnmintedFeeUsd,
  totalUsd: total.totalUsd + route.totalUsd,
  estimatedTotalUsd: total.estimatedTotalUsd + route.estimatedTotalUsd,
}), { accruedUsd: 0, redeemedUsd: 0, unredeemedUsd: 0, pendingUnmintedFeeUsd: 0, totalUsd: 0, estimatedTotalUsd: 0 });
for (const key of Object.keys(sums)) assert.ok(Math.abs(sums[key] - data.summary[key]) < 1e-6, `${key} summary mismatch`);
assert.ok(data.summary.estimatedTotalUsd >= data.summary.totalUsd, "estimated current total must include verified total plus pending fees");

const cutoff = Date.parse("2026-06-05T00:00:00Z") / 1000;
const asOfTotal = data.routes.reduce((sum, route) => {
  const included = route.dailyHistory.filter((point) => point.timestamp <= cutoff);
  const redeemedUsd = included.reduce((value, point) => value + point.redeemedUsd, 0);
  const minted = included.reduce((value, point) => value + BigInt(point.mintedShares), 0n);
  const redeemed = included.reduce((value, point) => value + BigInt(point.redeemedShares), 0n);
  const outstanding = minted > redeemed ? minted - redeemed : 0n;
  const price = route.priceHistory.filter((point) => point.timestamp <= cutoff).at(-1)?.sharePriceUsd || 0;
  return sum + redeemedUsd + (Number(outstanding) / 1e18) * price;
}, 0);
assert.ok(asOfTotal > 0 && asOfTotal < data.summary.totalUsd, "historical as-of total must differ from current total");

console.log(`Verified ${data.routes.length} Morpho routes and ${data.native.vaults.length} native ledgers, including the June 5 as-of total (${asOfTotal.toFixed(2)} USD).`);
