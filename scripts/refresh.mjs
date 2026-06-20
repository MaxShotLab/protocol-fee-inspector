import { writeFile, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const feeRecipient = "0x1C9e043DF27e8A8a142C366D88b9ed1274801D3a";
const zero = "0x0000000000000000000000000000000000000000";
const accrueTopic = "0xf66f28b40975dbb933913542c7e6a0f50a1d0f20aa74ea6e0efe65ab616323ec";
const nativeYieldTopic = "0xf287c13e9f4255c55a591feb78769f84b872cc1a6fae92e57fe1ea470e6607fd";
const day = 86400;
const rpcUrls = new Map([
  [1, "https://ethereum-rpc.publicnode.com"],
  [8453, "https://base-rpc.publicnode.com"],
  [42161, "https://arbitrum-one-rpc.publicnode.com"],
]);
const selectors = {
  lastTotalAssets: "0x568efc07",
  totalAssets: "0x01e1d114",
  totalSupply: "0x18160ddd",
  fee: "0xddca3f43",
};

const routes = [
  { id: "eth-usdc", chain: "Ethereum", chainId: 1, explorer: "https://eth.blockscout.com", token: "USDC", v1: "0xDCD35020c5bB97016358578131f012Baa9F53cf3", v2: "0xB33E87f90323ecF2E3196B865302e070B4507DBf", created: 23289467, createdAt: 1756985471 },
  { id: "base-usdc", chain: "Base", chainId: 8453, explorer: "https://base.blockscout.com", token: "USDC", v1: "0xfc8a325A2403CD940649B48ffcDfC250e084A27C", v2: "0x6963B0872d67A8795E6513bdBF1f2203c933d221", created: 35040464, createdAt: 1756870275 },
  { id: "arb-usdc", chain: "Arbitrum", chainId: 42161, explorer: "https://arbitrum.blockscout.com", token: "USDC", v1: "0x5579e27129110bBC9c0eC1388aCBf7ad04771b76", v2: "0x707e4A3454977365e39139D1256fb0cCb4bE5D41", created: 375565917, createdAt: 1756979933 },
  { id: "eth-usdt0", chain: "Ethereum", chainId: 1, explorer: "https://eth.blockscout.com", token: "USDT0", v1: "0xc2007A9c48Eecb36868Cf9D1da5D8566e90bf042", v2: "0x827F945F10fE304877f1bB567BC1c7F565E25bf7", created: 23293935, createdAt: 1757039459 },
  { id: "arb-usdt0", chain: "Arbitrum", chainId: 42161, explorer: "https://arbitrum.blockscout.com", token: "USDT0", v1: "0x3601921F4DA1a611159E2Dae7FE80dc267df0517", v2: "0xB16F63bB4346d6099286Bb855f51478D58f155F9", created: 423374798, createdAt: 1768920335 },
];

const nativeVaults = [
  { id: "native-usdc", name: "Maxshot Native USDC", token: "USDC", decimals: 6, vault: "0xCe0F05f19845CdE36058CcFb53C755Ab8739b880", ledger: "0xA7654FcbDe81999fB215Ec4b007b3746257D513c", chains: ["Ethereum", "Arbitrum", "Base", "Optimism"], chainIds: [1, 42161, 8453, 10] },
  { id: "native-usdt", name: "Maxshot Native USDT", token: "USDT", decimals: 6, vault: "0xd507d9D4F356B84e3EEEc33eeDef85BB57f59CfB", ledger: "0x3663f023FE98DA4dF2f6A4925A050d7edDF49722", chains: ["Ethereum", "Arbitrum", "Plasma"], chainIds: [1, 42161, 9745] },
];

async function nativeLedgerLogs(item) {
  const all = [];
  for (let page = 1; page < 20; page += 1) {
    const url = `https://base.blockscout.com/api?module=logs&action=getLogs&fromBlock=0&toBlock=latest&address=${item.ledger}&topic0=${nativeYieldTopic}&page=${page}&offset=1000`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Base Blockscout native ${item.token} ${response.status}`);
    const json = await response.json();
    if (json.status !== "1" && json.message !== "No logs found") throw new Error(`Base Blockscout native ${item.token}: ${json.message}`);
    const logs = Array.isArray(json.result) ? json.result : [];
    all.push(...logs);
    if (logs.length < 1000) break;
  }
  return all;
}

async function nativeLedgerState(item) {
  const calls = [
    ["feeRate", "0x978bbdb9"],
    ["feeChainId", "0xf67db96b"],
    ["lastEpochId", "0xc43b540f"],
  ].map(([key, data], index) => ({ key, id: index + 1, jsonrpc: "2.0", method: "eth_call", params: [{ to: item.ledger, data }, "latest"] }));
  const blockCall = { key: "blockNumber", id: calls.length + 1, jsonrpc: "2.0", method: "eth_blockNumber", params: [] };
  const response = await fetch(rpcUrls.get(8453), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify([...calls, blockCall].map(({ key, ...call }) => call)),
  });
  if (!response.ok) throw new Error(`Base RPC native ${item.token} ${response.status}`);
  const results = await response.json();
  return Object.fromEntries([...calls, blockCall].map((call) => {
    const result = results.find((entry) => entry.id === call.id);
    if (!result?.result || result.error) throw new Error(`Base RPC native ${item.token} ${call.key}: ${result?.error?.message || "empty result"}`);
    return [call.key, BigInt(result.result)];
  }));
}

async function graphql(query) {
  const response = await fetch("https://api.morpho.org/graphql", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Morpho API ${response.status}: ${body.slice(0, 600)}`);
  const json = JSON.parse(body);
  if (json.errors) throw new Error(json.errors.map((error) => error.message).join("; "));
  return json.data;
}

async function blockscoutLogs(route) {
  const all = [];
  for (let page = 1; page < 20; page += 1) {
    const url = `${route.explorer}/api?module=logs&action=getLogs&fromBlock=${route.created}&toBlock=latest&address=${route.v1}&topic0=${accrueTopic}&page=${page}&offset=1000`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${route.chain} Blockscout ${response.status}`);
    const json = await response.json();
    if (json.status !== "1" && json.message !== "No logs found") throw new Error(`${route.chain} Blockscout: ${json.message}`);
    const items = Array.isArray(json.result) ? json.result : [];
    all.push(...items);
    if (items.length < 1000) break;
  }
  return all;
}

function alias(index) { return `r${index}`; }
function currentQuery() {
  return `query {${routes.map((route, index) => `${alias(index)}:vaultByAddress(address:"${route.v1}",chainId:${route.chainId}){address name asset{symbol decimals price{usd}} state{blockNumber fee totalAssets totalAssetsUsd totalSupply sharePriceNumber sharePriceUsd feeRecipient}} v${index}:vaultV2ByAddress(address:"${route.v2}",chainId:${route.chainId}){address name performanceFee managementFee performanceFeeRecipient managementFeeRecipient adapters(first:20){items{__typename ... on MetaMorphoAdapter{metaMorpho{address}}}}}`).join("\n")}}`;
}
function historyQuery(start, end) {
  return `query {${routes.map((route, index) => `${alias(index)}:vaultByAddress(address:"${route.v1}",chainId:${route.chainId}){historicalState{sharePriceUsd(options:{startTimestamp:${start},endTimestamp:${end},interval:DAY}){x y}}}`).join("\n")}}`;
}
function transactionsQuery() {
  return `query { vaultV1Transactions(first:1000,orderBy:Time,orderDirection:Asc,where:{vaultAddress_in:[${routes.map((route) => `"${route.v1}"`).join(",")}],userAddress_in:["${feeRecipient}"]}){items{txHash timestamp blockNumber logIndex type shares assets vault{address asset{symbol decimals}} data{__typename ... on VaultV1DepositData{assets sender onBehalf} ... on VaultV1WithdrawData{assets sender receiver onBehalf}}} pageInfo{hasNextPage count}} }`;
}
async function contractState(route) {
  const url = rpcUrls.get(route.chainId);
  if (!url) throw new Error(`Missing RPC URL for ${route.chain}`);
  const calls = Object.entries(selectors).map(([key, data], index) => ({
    jsonrpc: "2.0",
    id: index + 1,
    method: "eth_call",
    params: [{ to: route.v1, data }, "latest"],
    key,
  }));
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(calls.map(({ key, ...call }) => call)),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${route.chain} RPC ${response.status}: ${body.slice(0, 600)}`);
  const results = JSON.parse(body);
  return Object.fromEntries(calls.map((call) => {
    const result = results.find((item) => item.id === call.id);
    if (!result?.result || result.error) throw new Error(`${route.chain} RPC ${call.key}: ${result?.error?.message || "empty result"}`);
    return [call.key, BigInt(result.result)];
  }));
}

function words(data) {
  return [BigInt(`0x${data.slice(2, 66)}`), BigInt(`0x${data.slice(66, 130)}`)];
}
function nearestPrice(points, timestamp, fallback) {
  if (!points?.length) return fallback;
  let nearest = points[0];
  for (const point of points) if (Math.abs(point.x - timestamp) < Math.abs(nearest.x - timestamp)) nearest = point;
  return Number(nearest.y || fallback);
}
function lower(value) { return String(value || "").toLowerCase(); }
function short(address) { return `${address.slice(0, 6)}…${address.slice(-4)}`; }
function pendingFeeEstimate(vault, onchain) {
  const totalAssets = onchain.totalAssets;
  const lastTotalAssets = onchain.lastTotalAssets;
  const totalSupply = onchain.totalSupply;
  const feeWad = onchain.fee;
  const totalInterest = totalAssets > lastTotalAssets ? totalAssets - lastTotalAssets : 0n;
  const feeAssets = (totalInterest * feeWad) / 1_000_000_000_000_000_000n;
  const denominator = totalAssets > feeAssets ? totalAssets - feeAssets : 0n;
  const feeShares = feeAssets > 0n && totalSupply > 0n && denominator > 0n ? (feeAssets * totalSupply) / denominator : 0n;
  const usd = (Number(feeShares) / 1e18) * Number(vault.state.sharePriceUsd || 0);
  return { shares: feeShares, usd, interestAssets: totalInterest, feeAssets };
}

const now = Math.floor(Date.now() / 1000);
const start = Math.min(...routes.map((route) => route.createdAt)) - day;
const [current, prices, transactions, logSets, nativeLogSets, nativeStates] = await Promise.all([
  graphql(currentQuery()),
  graphql(historyQuery(start, now)),
  graphql(transactionsQuery()),
  Promise.all(routes.map(blockscoutLogs)),
  Promise.all(nativeVaults.map(nativeLedgerLogs)),
  Promise.all(nativeVaults.map(nativeLedgerState)),
]);
const contractStates = await Promise.all(routes.map(contractState));

if (transactions.vaultV1Transactions.pageInfo.hasNextPage) throw new Error("Transaction result requires pagination");
const txs = transactions.vaultV1Transactions.items;
const globalEvents = [];
const routeResults = [];

for (let index = 0; index < routes.length; index += 1) {
  const route = routes[index];
  const vault = current[alias(index)];
  const wrapper = current[`v${index}`];
  const onchain = contractStates[index];
  const pricePoints = prices[alias(index)]?.historicalState?.sharePriceUsd || [];
  const logs = logSets[index].map((log) => {
    const [newTotalAssets, feeShares] = words(log.data);
    return { type: "accrue", timestamp: Number(BigInt(log.timeStamp)), block: Number(BigInt(log.blockNumber)), txHash: log.transactionHash, newTotalAssets, feeShares };
  }).filter((event) => event.feeShares > 0n);
  const walletTxs = txs.filter((tx) => lower(tx.vault.address) === lower(route.v1));
  const events = [
    ...logs,
    ...walletTxs.filter((tx) => tx.type === "Withdraw").map((tx) => ({ type: "withdraw", timestamp: Number(tx.timestamp), block: Number(tx.blockNumber), txHash: tx.txHash, shares: BigInt(tx.shares), assets: BigInt(tx.assets) })),
  ].sort((a, b) => a.timestamp - b.timestamp || a.block - b.block);

  let feePool = 0n;
  let mintedShares = 0n;
  let accruedUsd = 0;
  let redeemedUsd = 0;
  const routeDaily = new Map();
  const recordDaily = (timestamp, accruedDelta, redeemedDelta, mintedSharesDelta = 0n, redeemedSharesDelta = 0n) => {
    const bucket = Math.floor(timestamp / day) * day;
    const point = routeDaily.get(bucket) || { timestamp: bucket, accruedUsd: 0, redeemedUsd: 0, mintedShares: 0n, redeemedShares: 0n };
    point.accruedUsd += accruedDelta;
    point.redeemedUsd += redeemedDelta;
    point.mintedShares += mintedSharesDelta;
    point.redeemedShares += redeemedSharesDelta;
    routeDaily.set(bucket, point);
  };
  for (const event of events) {
    if (event.type === "accrue") {
      const value = (Number(event.feeShares) / 1e18) * nearestPrice(pricePoints, event.timestamp, vault.state.sharePriceUsd);
      feePool += event.feeShares;
      mintedShares += event.feeShares;
      accruedUsd += value;
      globalEvents.push({ timestamp: event.timestamp, accruedUsd: value, redeemedUsd: 0 });
      recordDaily(event.timestamp, value, 0, event.feeShares, 0n);
    } else {
      const consumed = event.shares < feePool ? event.shares : feePool;
      if (consumed > 0n) {
        const value = (Number(event.assets) / 10 ** vault.asset.decimals) * (Number(consumed) / Number(event.shares)) * Number(vault.asset.price.usd || 1);
        redeemedUsd += value;
        globalEvents.push({ timestamp: event.timestamp, accruedUsd: 0, redeemedUsd: value });
        recordDaily(event.timestamp, 0, value, 0n, consumed);
        feePool -= consumed;
      }
    }
  }

  const unredeemedUsd = (Number(feePool) / 1e18) * Number(vault.state.sharePriceUsd || 0);
  const pending = pendingFeeEstimate(vault, onchain);
  const mappedV1 = wrapper.adapters.items.find((item) => item.__typename === "MetaMorphoAdapter")?.metaMorpho?.address;
  const mixedWalletActivity = walletTxs.some((tx) => tx.type === "Deposit" || tx.type === "Withdraw");
  const checks = {
    v1Fee: Math.abs(Number(vault.state.fee) - 0.05) < 1e-9,
    v2Fee: Number(wrapper.performanceFee) === 0 && Number(wrapper.managementFee) === 0,
    recipient: lower(vault.state.feeRecipient) === lower(feeRecipient),
    mapping: lower(mappedV1) === lower(route.v1),
    indexed: logs.length > 0,
  };
  const status = Object.values(checks).every(Boolean) ? (mixedWalletActivity ? "review" : "verified") : "failed";
  routeResults.push({
    ...route,
    v1Name: vault.name,
    v2Name: wrapper.name,
    v1Short: short(route.v1),
    v2Short: short(route.v2),
    feeRate: Number(vault.state.fee),
    v2FeeRate: Number(wrapper.performanceFee),
    mintedFeeShares: mintedShares.toString(),
    outstandingFeeShares: feePool.toString(),
    accruedUsd,
    redeemedUsd,
    unredeemedUsd,
    pendingUnmintedFeeUsd: pending.usd,
    pendingUnmintedFeeShares: pending.shares.toString(),
    pendingInterestAssets: pending.interestAssets.toString(),
    pendingFeeAssets: pending.feeAssets.toString(),
    pendingSource: "direct_rpc",
    totalUsd: redeemedUsd + unredeemedUsd,
    estimatedTotalUsd: redeemedUsd + unredeemedUsd + pending.usd,
    totalAssetsUsd: Number(vault.state.totalAssetsUsd),
    latestVerifiedBlock: Number(vault.state.blockNumber),
    lastFeeBlock: logs.at(-1)?.block || route.created,
    feeEventCount: logs.length,
    walletActivityCount: walletTxs.length,
    dailyHistory: [...routeDaily.values()].sort((a, b) => a.timestamp - b.timestamp).map((point) => ({
      ...point,
      mintedShares: point.mintedShares.toString(),
      redeemedShares: point.redeemedShares.toString(),
    })),
    priceHistory: pricePoints.map((point) => ({ timestamp: Number(point.x), sharePriceUsd: Number(point.y) })).sort((a, b) => a.timestamp - b.timestamp),
    attribution: mixedWalletActivity ? "Fee-first withdrawal attribution" : "Direct fee-share attribution",
    checks,
    status,
  });
}

const daily = new Map();
for (const event of globalEvents) {
  const bucket = Math.floor(event.timestamp / day) * day;
  const point = daily.get(bucket) || { timestamp: bucket, accruedUsd: 0, redeemedUsd: 0 };
  point.accruedUsd += event.accruedUsd;
  point.redeemedUsd += event.redeemedUsd;
  daily.set(bucket, point);
}
const dates = [...daily.keys()].sort((a, b) => a - b);
let accruedCarry = 0;
let redeemedCarry = 0;
const history = dates.map((timestamp) => {
  const point = daily.get(timestamp);
  accruedCarry += point.accruedUsd;
  redeemedCarry += point.redeemedUsd;
  return { timestamp, accruedUsd: accruedCarry, redeemedUsd: redeemedCarry };
});

const summary = routeResults.reduce((sum, route) => ({
  accruedUsd: sum.accruedUsd + route.accruedUsd,
  redeemedUsd: sum.redeemedUsd + route.redeemedUsd,
  unredeemedUsd: sum.unredeemedUsd + route.unredeemedUsd,
  pendingUnmintedFeeUsd: sum.pendingUnmintedFeeUsd + route.pendingUnmintedFeeUsd,
  totalUsd: sum.totalUsd + route.totalUsd,
  estimatedTotalUsd: sum.estimatedTotalUsd + route.estimatedTotalUsd,
}), { accruedUsd: 0, redeemedUsd: 0, unredeemedUsd: 0, pendingUnmintedFeeUsd: 0, totalUsd: 0, estimatedTotalUsd: 0 });

const nativeResults = nativeVaults.map((item, index) => {
  const state = nativeStates[index];
  const events = nativeLogSets[index].map((log) => {
    const data = log.data.slice(2);
    const feeChainId = BigInt(`0x${data.slice(0, 64)}`);
    const interestAssets = BigInt(`0x${data.slice(64, 128)}`);
    const feeAssets = BigInt(`0x${data.slice(128, 192)}`);
    return {
      timestamp: Number(BigInt(log.timeStamp)),
      block: Number(BigInt(log.blockNumber)),
      txHash: log.transactionHash,
      feeChainId: Number(feeChainId),
      interestAssets: interestAssets.toString(),
      feeAssets: feeAssets.toString(),
      feeUsd: Number(feeAssets) / 10 ** item.decimals,
    };
  }).filter((event) => event.feeUsd > 0).sort((a, b) => a.timestamp - b.timestamp || a.block - b.block);
  const dailyMap = new Map();
  for (const event of events) {
    const timestamp = Math.floor(event.timestamp / day) * day;
    dailyMap.set(timestamp, (dailyMap.get(timestamp) || 0) + event.feeUsd);
  }
  let carry = 0;
  const history = [...dailyMap.entries()].sort((a, b) => a[0] - b[0]).map(([timestamp, feeUsd]) => ({ timestamp, feeUsd, cumulativeFeeUsd: (carry += feeUsd) }));
  const accruedUsd = events.reduce((sum, event) => sum + event.feeUsd, 0);
  const checks = {
    feeRate: state.feeRate === 50_000_000_000_000_000n,
    feeChain: item.chainIds.includes(Number(state.feeChainId)),
    indexed: events.length > 0,
  };
  return {
    ...item,
    vaultShort: short(item.vault),
    ledgerShort: short(item.ledger),
    feeRate: Number(state.feeRate) / 1e18,
    feeChainId: Number(state.feeChainId),
    feeChain: ({ 1: "Ethereum", 10: "Optimism", 8453: "Base", 42161: "Arbitrum", 9745: "Plasma" })[Number(state.feeChainId)] || `Chain ${state.feeChainId}`,
    lastEpochId: state.lastEpochId.toString(),
    accruedUsd,
    eventCount: events.length,
    firstFeeTimestamp: events[0]?.timestamp || null,
    lastFeeTimestamp: events.at(-1)?.timestamp || null,
    lastFeeBlock: events.at(-1)?.block || null,
    latestVerifiedBlock: Number(state.blockNumber),
    history,
    checks,
    status: Object.values(checks).every(Boolean) ? "verified" : "failed",
  };
});

const nativeSummary = nativeResults.reduce((sum, item) => ({
  accruedUsd: sum.accruedUsd + item.accruedUsd,
  eventCount: sum.eventCount + item.eventCount,
}), { accruedUsd: 0, eventCount: 0 });

const output = {
  generatedAt: new Date().toISOString(),
  methodology: {
    source: "Morpho API + Blockscout onchain event indexes",
    accrued: "Fee shares emitted by MetaMorpho AccrueInterest, valued at the nearest daily USD share price.",
    unredeemed: "Outstanding fee-attributed shares valued at the current USD share price.",
    pending: "Current-only estimate of unminted fee shares since the latest accrual, using direct RPC reads and MetaMorpho's lastTotalAssets fee formula.",
    redeemed: "Withdrawn underlying attributed to fee shares.",
    attribution: "Fee-first: withdrawals from a wallet mixing principal and fee shares consume fee shares first. Mixed-wallet rows are marked Review.",
  },
  feeRecipient,
  summary,
  routes: routeResults,
  history,
  native: {
    methodology: "Exact fee assets emitted by each Base YieldLedger EpochYieldProcessed event. Values use the stablecoin's 6 decimals; no unfinalized-epoch estimate is included.",
    summary: nativeSummary,
    vaults: nativeResults,
  },
};

const target = join(root, "public/data.json");
const temp = `${target}.tmp`;
await writeFile(temp, `${JSON.stringify(output, null, 2)}\n`);
await rename(temp, target);
console.log(`Refreshed ${routeResults.length} routes at ${output.generatedAt}`);
