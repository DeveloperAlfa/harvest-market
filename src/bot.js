// Simple scripted farmer: plants when it expects a profit, buys what it needs,
// stores a little water against droughts, borrows only to plant, never trades.
"use strict";
const { CROP, R, fertBags } = require("./rules");

function expectedSack(game, cropId) {
  const c = CROP[cropId];
  let x = game.pos[cropId];
  if (x < 3) x++; else if (x > 3) x--;          // prices settle toward the middle first
  return c.track[x] + game.prices.bonus;
}

function playBot(game, pid) {
  const p = game.player(pid);
  if (!p || game.phase !== "trade") return;
  if (p.status !== "farmer") { game.act(pid, { type: "ready", value: true }); return; }
  const pr = game.prices, drought = game.weather.drought;

  // Rank plots by expected profit of planting this round.
  const plans = p.plots.map(plot => {
    const sack = expectedSack(game, plot.crop), need = CROP[plot.crop].water;
    const waterCost = need * (drought ? pr.waterDrought : pr.waterNormal);
    const bags = fertBags(plot.crop);
    const fert = sack * 1.2 > bags * pr.fert;     // fertilizer pays on average (bumper chance included)
    const gain = sack * 1.2 * (fert ? 2 : 1) - (fert ? bags * pr.fert : 0);
    return { plot, need, bags, fert, profit: gain - waterCost + R.IDLE_UPKEEP };
  }).sort((a, b) => b.profit - a.profit);

  const reserve = p.plots.length * R.WAREHOUSE_UPKEEP + p.loans * R.LOAN_INTEREST;
  let water = p.water, fert = p.fert;       // goods not yet committed to a plot
  const chosen = [];
  for (const pl of plans) {
    if (pl.profit <= 0) break;
    const buyW = Math.max(0, pl.need - water);
    let buyF = pl.fert ? Math.max(0, pl.bags - fert) : 0;
    let cost = buyW * pr.water + buyF * pr.fert;
    if (p.cash - cost < reserve && p.loans < p.plots.length && pl.profit > R.LOAN_INTEREST * 2) {
      game.act(pid, { type: "takeLoan" });
    }
    if (p.cash - cost < reserve && pl.fert) { cost -= buyF * pr.fert; buyF = 0; pl.fert = fert >= pl.bags; }
    if (p.cash - cost < reserve && cost > 0) continue;
    if (buyW) game.act(pid, { type: "bankBuy", item: "water", qty: buyW });
    if (buyF) game.act(pid, { type: "bankBuy", item: "fert", qty: buyF });
    water += buyW - pl.need;
    if (pl.fert) fert += buyF - pl.bags;
    chosen.push(pl);
  }
  // Uses: chosen plots planted; spare plots hold drought water if affordable, else idle.
  const spare = plans.filter(pl => !chosen.includes(pl));
  for (const pl of chosen) game.act(pid, { type: "setPlot", plotId: pl.plot.id, mode: pl.fert ? "fert" : "plant" });
  const keepWater = !drought && spare.length && p.cash > 40;
  spare.forEach((pl, i) => {
    const ware = i === 0 && (keepWater || p.water - chosen.reduce((s, c) => s + c.need, 0) > 0);
    game.act(pid, { type: "setPlot", plotId: pl.plot.id, mode: ware ? "ware" : "idle" });
  });
  if (keepWater) {
    const planned = chosen.reduce((s, c) => s + c.need, 0);
    const want = Math.min(R.WAREHOUSE_WATER, Math.floor((p.cash - reserve - 20) / pr.water));
    const extra = Math.max(0, want - Math.max(0, p.water - planned));
    if (extra > 0) game.act(pid, { type: "bankBuy", item: "water", qty: extra });
  }
  if (p.loans > 0 && p.cash > 60) game.act(pid, { type: "repayLoan" });
  game.act(pid, { type: "ready", value: true });
}

module.exports = { playBot };
