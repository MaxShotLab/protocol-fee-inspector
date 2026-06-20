const app = document.querySelector("#app");
const isGithubPages = window.location.hostname.endsWith(".github.io");
const staticDataUrl = new URL("./public/data.json", document.baseURI).href;
const state = { data: null, range: "all", chain: "all", token: "all", status: "all", specificDate: "", refreshing: false, chartHoverIndex: null };
let chartModel = null;

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compactMoney = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const shares = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });

function escape(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function filteredRoutes() {
  return state.data.routes.filter((route) =>
    (state.chain === "all" || route.chain === state.chain) &&
    (state.token === "all" || route.token === state.token) &&
    (state.status === "all" || route.status === state.status)
  );
}

function cumulativeTotalsAsOf(routes) {
  if (!state.specificDate) return null;
  const timestamp = Date.parse(`${state.specificDate}T00:00:00Z`) / 1000;
  return routes.reduce((total, route) => {
    const included = (route.dailyHistory || []).filter((point) => point.timestamp <= timestamp);
    const accruedUsd = included.reduce((sum, point) => sum + Number(point.accruedUsd || 0), 0);
    const redeemedUsd = included.reduce((sum, point) => sum + Number(point.redeemedUsd || 0), 0);
    const mintedShares = included.reduce((sum, point) => sum + BigInt(point.mintedShares || 0), 0n);
    const redeemedShares = included.reduce((sum, point) => sum + BigInt(point.redeemedShares || 0), 0n);
    const outstandingShares = mintedShares > redeemedShares ? mintedShares - redeemedShares : 0n;
    const eligiblePrices = (route.priceHistory || []).filter((point) => point.timestamp <= timestamp);
    const sharePriceUsd = Number(eligiblePrices.at(-1)?.sharePriceUsd || route.priceHistory?.[0]?.sharePriceUsd || 0);
    const unredeemedUsd = (Number(outstandingShares) / 1e18) * sharePriceUsd;
    return {
      timestamp,
      accruedUsd: total.accruedUsd + accruedUsd,
      redeemedUsd: total.redeemedUsd + redeemedUsd,
      unredeemedUsd: total.unredeemedUsd + unredeemedUsd,
      totalUsd: total.totalUsd + redeemedUsd + unredeemedUsd,
    };
  }, { timestamp, accruedUsd: 0, redeemedUsd: 0, unredeemedUsd: 0, totalUsd: 0 });
}

function visibleHistory() {
  if (state.range === "all") return state.data.history;
  const days = Number(state.range);
  const cutoff = Date.now() / 1000 - days * 86400;
  return state.data.history.filter((point) => point.timestamp >= cutoff);
}

function metric(label, value, detail, tone = "") {
  return `<section class="metric ${tone}"><p>${label}</p><strong>${money.format(value)}</strong><span>${detail}</span></section>`;
}

function statusLabel(status) {
  return status === "verified" ? "Verified" : status === "review" ? "Review" : "Failed";
}

function utcDateInput(timestamp) {
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

function render() {
  if (!state.data) {
    app.innerHTML = `<main class="loading"><div class="loading-line"></div><p>Loading verified vault data…</p></main>`;
    return;
  }

  const routes = filteredRoutes();
  const currentTotals = routes.reduce((sum, route) => ({
    accruedUsd: sum.accruedUsd + route.accruedUsd,
    unredeemedUsd: sum.unredeemedUsd + route.unredeemedUsd,
    pendingUnmintedFeeUsd: sum.pendingUnmintedFeeUsd + Number(route.pendingUnmintedFeeUsd || 0),
    redeemedUsd: sum.redeemedUsd + route.redeemedUsd,
    totalUsd: sum.totalUsd + route.totalUsd,
    estimatedTotalUsd: sum.estimatedTotalUsd + Number(route.estimatedTotalUsd ?? route.totalUsd),
  }), { accruedUsd: 0, unredeemedUsd: 0, pendingUnmintedFeeUsd: 0, redeemedUsd: 0, totalUsd: 0, estimatedTotalUsd: 0 });
  const generated = new Date(state.data.generatedAt);
  const asOfTotals = cumulativeTotalsAsOf(routes);
  const nativeVaults = state.data.native?.vaults || [];
  const nativeAsOfTimestamp = state.specificDate ? Date.parse(`${state.specificDate}T23:59:59Z`) / 1000 : null;
  const nativeCurrentTotal = nativeVaults.reduce((sum, vault) => sum + Number(vault.accruedUsd || 0), 0);
  const nativeAsOfTotal = nativeAsOfTimestamp === null ? null : nativeVaults.reduce((sum, vault) => {
    const point = (vault.history || []).filter((entry) => entry.timestamp <= nativeAsOfTimestamp).at(-1);
    return sum + Number(point?.cumulativeFeeUsd || 0);
  }, 0);
  const asOfDateLabel = asOfTotals ? new Date(asOfTotals.timestamp * 1000).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }) : "";
  const firstHistoryDate = new Date((state.data.history[0]?.timestamp || generated.getTime() / 1000) * 1000).toISOString().slice(0, 10);
  const latestDate = generated.toISOString().slice(0, 10);
  const chains = [...new Set(state.data.routes.map((route) => route.chain))];
  const tokens = [...new Set(state.data.routes.map((route) => route.token))];

  app.innerHTML = `
    <main class="page-shell">
      <header class="masthead">
        <div>
          <p class="eyebrow">Protocol revenue / Morpho</p>
          <h1>Maxshot Fee Monitor</h1>
          <p class="subtitle">Reviewing V1 fee income generated behind zero-fee V2 vault routes.</p>
        </div>
        <div class="freshness">
          <span>Data as of ${generated.toLocaleString("en-CA", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}</span>
          <button id="refresh" class="text-button" ${state.refreshing ? "disabled" : ""}>${state.refreshing ? "Refreshing…" : "Refresh data"}</button>
        </div>
      </header>

      <section class="filters" aria-label="Dashboard filters">
        <label>Time range<select id="range"><option value="all" ${state.range === "all" ? "selected" : ""}>All time</option><option value="90" ${state.range === "90" ? "selected" : ""}>Last 90 days</option><option value="30" ${state.range === "30" ? "selected" : ""}>Last 30 days</option></select></label>
        <label>Chain<select id="chain"><option value="all">All chains</option>${chains.map((chain) => `<option ${state.chain === chain ? "selected" : ""}>${chain}</option>`).join("")}</select></label>
        <label>Token<select id="token"><option value="all">All tokens</option>${tokens.map((token) => `<option ${state.token === token ? "selected" : ""}>${token}</option>`).join("")}</select></label>
        <label>Verification<select id="status"><option value="all">All statuses</option><option value="verified" ${state.status === "verified" ? "selected" : ""}>Verified</option><option value="review" ${state.status === "review" ? "selected" : ""}>Review</option><option value="failed" ${state.status === "failed" ? "selected" : ""}>Failed</option></select></label>
        <label>Specific date (UTC)<input id="specificDate" type="date" min="${firstHistoryDate}" max="${latestDate}" value="${escape(state.specificDate)}"></label>
        <button id="reset" class="outline-button">Reset filters</button>
      </section>

      ${asOfTotals ? `<section class="metric-group" aria-label="As-of fee totals">
        <div class="metric-group-heading"><p class="section-kicker">Historical as-of · UTC</p><h2>${asOfDateLabel}</h2></div>
        <div class="metrics compact">
          ${metric("Accrued fees (as of)", asOfTotals.accruedUsd, "Fee-share mints through selected date")}
          ${metric("Unredeemed value (as of)", asOfTotals.unredeemedUsd, "Outstanding shares × historical share price")}
          ${metric("Redeemed value (as of)", asOfTotals.redeemedUsd, "Fee-attributed redemptions through selected date")}
          ${metric("Total fee income (as of)", asOfTotals.totalUsd, "Redeemed + unredeemed at selected date", "primary")}
        </div>
      </section>` : ""}

      <section class="metric-group" aria-label="Current fee totals">
        <div class="metric-group-heading"><p class="section-kicker">Realtime current</p><h2>Current snapshot</h2></div>
        <div class="metrics">
          ${metric("Accrued fees (at mint)", currentTotals.accruedUsd, "Fee shares valued when accrued")}
          ${metric("Current unredeemed value", currentTotals.unredeemedUsd, "Outstanding fee-attributed shares")}
          ${metric("Pending unminted estimate", currentTotals.pendingUnmintedFeeUsd, "Estimated since latest accrual")}
          ${metric("Redeemed value (all-time)", currentTotals.redeemedUsd, "Underlying attributed to fee shares")}
          ${metric("Estimated total fee income", currentTotals.estimatedTotalUsd, "Redeemed + unredeemed + pending estimate", "primary")}
        </div>
      </section>

      <section class="chart-section">
        <div class="section-heading">
          <div><p class="section-kicker">Historical verification</p><h2>Fee income history (USD)</h2></div>
          <div class="legend"><span class="legend-line solid"></span>Accrued at mint <span class="legend-line dotted"></span>Redeemed</div>
        </div>
        <div class="chart-frame"><canvas id="history-chart" aria-label="Cumulative fee income history chart"></canvas><div id="chart-tooltip" class="chart-tooltip" hidden></div></div>
      </section>

      <section class="table-section">
        <div class="section-heading table-heading">
          <div><p class="section-kicker">Onchain reconciliation</p><h2>Vault routes <span>V2 0% → V1 5%</span></h2></div>
          <p>${routes.length} of ${state.data.routes.length} routes</p>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Chain / token</th><th>V1 income vault (5%)</th><th>V2 wrapper (0%)</th><th>Accrued shares</th><th>Unredeemed</th><th>Pending estimate</th><th>Redeemed</th><th>Latest verified block</th><th>Status</th></tr></thead>
            <tbody>${routes.map((route, index) => `<tr>
              <td>${index + 1}</td>
              <td><strong>${escape(route.chain)}</strong><span>${escape(route.token)}</span></td>
              <td><a href="${route.explorer}/address/${route.v1}" target="_blank" rel="noreferrer">${escape(route.v1Short)}</a><span>${escape(route.v1Name)}</span></td>
              <td><a href="${route.explorer}/address/${route.v2}" target="_blank" rel="noreferrer">${escape(route.v2Short)}</a><span>${escape(route.v2Name)}</span></td>
              <td class="number"><strong>${shares.format(Number(route.outstandingFeeShares) / 1e18)}</strong><span>${integer.format(route.feeEventCount)} fee events</span></td>
              <td class="number"><strong>${money.format(route.unredeemedUsd)}</strong><span>Current value</span></td>
              <td class="number"><strong>${money.format(Number(route.pendingUnmintedFeeUsd || 0))}</strong><span>Current only</span></td>
              <td class="number"><strong>${money.format(route.redeemedUsd)}</strong><span>Fee-first attributed</span></td>
              <td class="number"><strong>${integer.format(route.latestVerifiedBlock)}</strong><span>Last fee event ${integer.format(route.lastFeeBlock)}</span></td>
              <td><button class="status ${route.status}" data-route="${route.id}" title="${escape(route.attribution)}">${statusLabel(route.status)}</button></td>
            </tr>`).join("") || `<tr><td colspan="10" class="empty-row">No vault routes match these filters.</td></tr>`}</tbody>
          </table>
        </div>
        <footer class="methodology">
          <p><strong>Method:</strong> ${escape(state.data.methodology.accrued)} ${escape(state.data.methodology.pending || "")} ${escape(state.data.methodology.attribution)}</p>
          <p>Sources: Morpho API and Blockscout onchain event indexes.</p>
        </footer>
      </section>

      ${state.data.native ? `<section class="native-section">
        <div class="section-heading native-heading">
          <div><p class="section-kicker">Native vaults / Base ledgers</p><h2>Omnichain protocol fee income</h2></div>
          <p>Last finalized ledger epochs</p>
        </div>
        <div class="metrics native-metrics">
          ${metric("Current accrued native fees", nativeCurrentTotal, `${integer.format(state.data.native.summary.eventCount)} finalized fee epochs`, "primary")}
          ${nativeAsOfTotal === null ? `<section class="metric"><p>Protocol fee rate</p><strong>5%</strong><span>Applied to positive finalized epoch yield</span></section>` : metric("Native fees (as of selected date)", nativeAsOfTotal, `${asOfDateLabel} UTC`)}
        </div>
        <div class="table-wrap native-table">
          <table>
            <thead><tr><th>#</th><th>Vault / token</th><th>Base ledger</th><th>Managed chains</th><th>Accrued fee assets</th><th>Finalized epochs</th><th>Latest verified block</th><th>Status</th></tr></thead>
            <tbody>${nativeVaults.map((vault, index) => {
              const asOfPoint = nativeAsOfTimestamp === null ? null : (vault.history || []).filter((entry) => entry.timestamp <= nativeAsOfTimestamp).at(-1);
              const displayed = asOfPoint ? Number(asOfPoint.cumulativeFeeUsd) : nativeAsOfTimestamp === null ? Number(vault.accruedUsd) : 0;
              return `<tr>
                <td>${index + 1}</td>
                <td><a href="https://eth.blockscout.com/address/${vault.vault}" target="_blank" rel="noreferrer">${escape(vault.vaultShort)}</a><span>${escape(vault.name)}</span></td>
                <td><a href="https://base.blockscout.com/address/${vault.ledger}" target="_blank" rel="noreferrer">${escape(vault.ledgerShort)}</a><span>On Base · fees mint on ${escape(vault.feeChain)} (${integer.format(vault.feeChainId)})</span></td>
                <td><strong>${vault.chains.map(escape).join(" · ")}</strong><span>${escape(vault.token)} omnichain vault</span></td>
                <td class="number"><strong>${money.format(displayed)}</strong><span>${nativeAsOfTimestamp === null ? "Current finalized" : "As of selected date"}</span></td>
                <td class="number"><strong>${integer.format(vault.eventCount)}</strong><span>Ledger epoch ${escape(vault.lastEpochId)}</span></td>
                <td class="number"><strong>${integer.format(vault.latestVerifiedBlock)}</strong><span>Last fee event ${integer.format(vault.lastFeeBlock || 0)}</span></td>
                <td><span class="status ${vault.status}">${statusLabel(vault.status)}</span></td>
              </tr>`;
            }).join("")}</tbody>
          </table>
        </div>
        <footer class="methodology"><p><strong>Method:</strong> ${escape(state.data.native.methodology)}</p><p>Source: Base YieldLedger events and direct RPC state.</p></footer>
      </section>` : ""}

      <dialog id="route-dialog"><button class="dialog-close" aria-label="Close">Close</button><div id="dialog-content"></div></dialog>
    </main>`;

  bindControls();
  requestAnimationFrame(drawChart);
}

function bindControls() {
  for (const key of ["range", "chain", "token", "status", "specificDate"]) document.querySelector(`#${key}`).addEventListener("change", (event) => { state[key] = event.target.value; render(); });
  document.querySelector("#reset").addEventListener("click", () => { Object.assign(state, { range: "all", chain: "all", token: "all", status: "all", specificDate: "" }); render(); });
  document.querySelector("#refresh").addEventListener("click", refreshData);
  const dialog = document.querySelector("#route-dialog");
  document.querySelector(".dialog-close").addEventListener("click", () => dialog.close());
  document.querySelectorAll("[data-route]").forEach((button) => button.addEventListener("click", () => openRoute(button.dataset.route)));
  window.onresize = () => requestAnimationFrame(drawChart);
  bindChartControls();
}

function openRoute(id) {
  const route = state.data.routes.find((item) => item.id === id);
  const checks = Object.entries(route.checks).map(([name, pass]) => `<li><span>${escape(name.replace(/([A-Z])/g, " $1"))}</span><strong class="${pass ? "pass" : "fail"}">${pass ? "Pass" : "Fail"}</strong></li>`).join("");
  document.querySelector("#dialog-content").innerHTML = `<p class="section-kicker">Verification evidence</p><h2>${escape(route.chain)} ${escape(route.token)}</h2><p>${escape(route.attribution)}. ${route.walletActivityCount} fee-recipient deposit/withdraw event(s) detected.</p><ul class="check-list">${checks}</ul><dl><div><dt>Accrued at mint</dt><dd>${money.format(route.accruedUsd)}</dd></div><div><dt>Current unredeemed</dt><dd>${money.format(route.unredeemedUsd)}</dd></div><div><dt>Pending estimate</dt><dd>${money.format(Number(route.pendingUnmintedFeeUsd || 0))}</dd></div><div><dt>Redeemed</dt><dd>${money.format(route.redeemedUsd)}</dd></div></dl>`;
  document.querySelector("#route-dialog").showModal();
}

function drawChart() {
  const canvas = document.querySelector("#history-chart");
  if (!canvas) return;
  const points = visibleHistory();
  const tooltip = document.querySelector("#chart-tooltip");
  canvas.hidden = points.length <= 1;
  if (tooltip) tooltip.hidden = true;
  chartModel = null;
  if (points.length <= 1) return;

  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  const width = Math.max(640, rect.width);
  const height = 242;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  const pad = { top: 18, right: 22, bottom: 36, left: 72 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const max = Math.max(...points.flatMap((point) => [point.accruedUsd, point.redeemedUsd]), 1) * 1.08;
  const minTime = points[0].timestamp;
  const maxTime = points.at(-1).timestamp || minTime + 1;
  const x = (timestamp) => pad.left + ((timestamp - minTime) / Math.max(1, maxTime - minTime)) * plotW;
  const y = (value) => pad.top + plotH - (value / max) * plotH;
  chartModel = { points, pad, width, height, plotW, plotH, max, minTime, maxTime, x, y };

  ctx.font = "12px Inter, ui-sans-serif, system-ui";
  ctx.fillStyle = "#6f726f";
  ctx.strokeStyle = "#e6e4df";
  ctx.lineWidth = 1;
  for (let tick = 0; tick <= 4; tick += 1) {
    const value = (max / 4) * tick;
    const py = y(value);
    ctx.beginPath(); ctx.moveTo(pad.left, py); ctx.lineTo(width - pad.right, py); ctx.stroke();
    ctx.fillText(compactMoney.format(value), 8, py + 4);
  }
  for (let tick = 0; tick <= 5; tick += 1) {
    const time = minTime + ((maxTime - minTime) / 5) * tick;
    ctx.fillText(new Date(time * 1000).toLocaleDateString("en-US", { month: "short", year: "2-digit" }), x(time) - 18, height - 10);
  }

  function line(field, color, dashed = false) {
    ctx.beginPath();
    points.forEach((point, index) => (index ? ctx.lineTo(x(point.timestamp), y(point[field])) : ctx.moveTo(x(point.timestamp), y(point[field]))));
    ctx.strokeStyle = color; ctx.lineWidth = 2.25; ctx.setLineDash(dashed ? [5, 5] : []); ctx.stroke(); ctx.setLineDash([]);
  }
  line("accruedUsd", "#0f7653");
  line("redeemedUsd", "#6f726f", true);

  const selectedDate = state.specificDate ? Date.parse(`${state.specificDate}T00:00:00Z`) / 1000 : null;
  const selectedIndex = selectedDate ? nearestPointIndexByTimestamp(points, selectedDate) : null;
  drawChartMarker(ctx, selectedIndex, "#0f7653", true);
  drawChartMarker(ctx, state.chartHoverIndex, "#20241f", false);
  updateChartTooltip();
}

function nearestPointIndexByTimestamp(points, timestamp) {
  if (!points.length) return null;
  let nearest = 0;
  for (let index = 1; index < points.length; index += 1) {
    if (Math.abs(points[index].timestamp - timestamp) < Math.abs(points[nearest].timestamp - timestamp)) nearest = index;
  }
  return nearest;
}

function nearestPointIndexByX(offsetX) {
  if (!chartModel) return null;
  const targetTimestamp = chartModel.minTime + ((offsetX - chartModel.pad.left) / Math.max(1, chartModel.plotW)) * (chartModel.maxTime - chartModel.minTime);
  return nearestPointIndexByTimestamp(chartModel.points, targetTimestamp);
}

function drawChartMarker(ctx, index, color, selected) {
  if (!chartModel || index === null || index === undefined || !chartModel.points[index]) return;
  const point = chartModel.points[index];
  const px = chartModel.x(point.timestamp);
  const accruedY = chartModel.y(point.accruedUsd);
  const redeemedY = chartModel.y(point.redeemedUsd);
  ctx.save();
  ctx.strokeStyle = selected ? color : "rgba(32, 36, 31, .42)";
  ctx.lineWidth = selected ? 1.5 : 1;
  ctx.setLineDash(selected ? [] : [4, 4]);
  ctx.beginPath();
  ctx.moveTo(px, chartModel.pad.top);
  ctx.lineTo(px, chartModel.height - chartModel.pad.bottom);
  ctx.stroke();
  ctx.setLineDash([]);
  for (const [py, fill] of [[accruedY, "#0f7653"], [redeemedY, "#6f726f"]]) {
    ctx.beginPath();
    ctx.arc(px, py, selected ? 5 : 4, 0, Math.PI * 2);
    ctx.fillStyle = "#fbfaf7";
    ctx.fill();
    ctx.strokeStyle = fill;
    ctx.lineWidth = selected ? 2.5 : 2;
    ctx.stroke();
  }
  ctx.restore();
}

function updateChartTooltip() {
  const tooltip = document.querySelector("#chart-tooltip");
  if (!tooltip || !chartModel || state.chartHoverIndex === null || !chartModel.points[state.chartHoverIndex]) {
    if (tooltip) tooltip.hidden = true;
    return;
  }
  const point = chartModel.points[state.chartHoverIndex];
  const px = chartModel.x(point.timestamp);
  const py = Math.min(chartModel.y(point.accruedUsd), chartModel.y(point.redeemedUsd));
  tooltip.innerHTML = `<strong>${new Date(point.timestamp * 1000).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" })}</strong><span>Accrued ${money.format(point.accruedUsd)}</span><span>Redeemed ${money.format(point.redeemedUsd)}</span><small>Click to select this date</small>`;
  tooltip.hidden = false;
  const left = Math.min(Math.max(12, px + 12), chartModel.width - 190);
  const top = Math.min(Math.max(10, py - 12), chartModel.height - 104);
  tooltip.style.transform = `translate(${left}px, ${top}px)`;
}

function bindChartControls() {
  const canvas = document.querySelector("#history-chart");
  if (!canvas) return;
  canvas.addEventListener("mousemove", (event) => {
    const rect = canvas.getBoundingClientRect();
    state.chartHoverIndex = nearestPointIndexByX(event.clientX - rect.left);
    drawChart();
  });
  canvas.addEventListener("mouseleave", () => {
    state.chartHoverIndex = null;
    drawChart();
  });
  canvas.addEventListener("click", (event) => {
    const rect = canvas.getBoundingClientRect();
    const index = nearestPointIndexByX(event.clientX - rect.left);
    const point = chartModel?.points[index];
    if (!point) return;
    state.specificDate = utcDateInput(point.timestamp);
    state.chartHoverIndex = index;
    render();
  });
}

async function refreshData() {
  state.refreshing = true; render();
  try {
    const response = await fetch(isGithubPages ? staticDataUrl : "/api/refresh", isGithubPages ? { cache: "no-store" } : { method: "POST" });
    if (!response.ok) throw new Error("refresh failed");
    state.data = await response.json();
  } catch {
    alert("Live refresh was unavailable. The last verified snapshot is still displayed.");
  } finally {
    state.refreshing = false; render();
  }
}

async function loadInitialData() {
  let error;
  const dataUrls = isGithubPages ? [staticDataUrl] : ["/api/data", staticDataUrl];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    for (const url of dataUrls) {
      try {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) throw new Error(`${url} returned ${response.status}`);
        state.data = await response.json();
        render();
        return;
      } catch (caught) {
        error = caught;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
  }
  app.innerHTML = `<main class="error-state"><p class="eyebrow">Data temporarily unavailable</p><h1>The verified snapshot could not be loaded.</h1><p>The monitor will retry automatically. You can also <button id="retry-data" class="text-button">retry now</button>.</p><small>${escape(error?.message || "Unknown loading error")}</small></main>`;
  document.querySelector("#retry-data").addEventListener("click", () => { render(); loadInitialData(); });
  setTimeout(loadInitialData, 5000);
}

await loadInitialData();
