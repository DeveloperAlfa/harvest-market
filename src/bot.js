// Scripted farmer: plants when it expects a profit, buys what it needs, stores a little
// water against droughts and borrows only to plant. It also trades land: it answers offers
// that are good for it, sells spare plots (to farmers first, the Bank if it must), bids on
// good plots when rich, and as a Moneylender offers coins for IOUs.
"use strict";
const { CROP, R, fertBags } = require("./rules");

function expectedSack(game, cropId) {
  const c = CROP[cropId];
  let x = game.pos[cropId];
  if (x < 3) x++; else if (x > 3) x--;          // prices settle toward the middle first
  return c.track[x] + game.prices.bonus;
}

// ------------------------------------------------------------------ valuations
const HORIZON = 6;   // rounds of farming a bot counts when valuing a plot
function plantProfit(game, cropId) {
  const pr = game.prices, c = CROP[cropId], sack = expectedSack(game, cropId), bags = fertBags(cropId);
  const fert = sack * 1.2 > bags * pr.fert;
  return sack * 1.2 * (fert ? 2 : 1) - (fert ? bags * pr.fert : 0) - c.water * pr.waterNormal;
}
function plotValue(game, cropId) {
  const pr = game.prices, left = Math.max(1, R.ROUNDS - game.round);
  return Math.max(pr.land, Math.round(Math.min(HORIZON, left) * Math.max(0, plantProfit(game, cropId) - pr.waterNormal * 0.3)));
}
function bundleValue(game, b, mine) {
  // mine = true when the bot is the one giving this bundle
  const pr = game.prices;
  let v = b.coins + b.water * pr.waterNormal + b.fert * (pr.fert - 0.5);
  for (const id of b.plots) { const x = plotOf(game, id); if (x) v += plotValue(game, x.crop) * (mine ? 1.15 : 1); }
  if (b.iou) v += mine ? b.iou : b.iou * 0.7;    // IOUs can go unpaid
  return v;
}
function plotOf(game, id) { for (const q of game.players) { const x = q.plots.find(y => y.id === id); if (x) return x; } return null; }

// Should bot `pid` accept offer `o`? Returns true/false.
function wantsOffer(game, pid, o) {
  const p = game.player(pid);
  if (!p || o.from === pid || (o.to != null && o.to !== pid)) return false;
  const lender = p.status !== "farmer";
  if (lender) return !o.get.water && !o.get.fert && !o.get.plots.length && !o.get.iou && o.give.iou > 0 && o.give.iou >= o.get.coins * 1.2 && p.cash - o.get.coins >= 0;
  if (o.get.iou) return false;                                   // bots don't write IOUs
  if (o.get.plots.length >= p.plots.length) return false;        // never sell the farm
  if (p.cash < o.get.coins + 1 || p.water < o.get.water || p.fert < o.get.fert) return false;
  if (o.give.coins + p.cash - o.get.coins - 1 < 4 && o.get.coins) return false;   // keep a little cash
  return bundleValue(game, o.give, false) - bundleValue(game, o.get, true) >= 3;
}
function considerOffers(game, pid) {
  for (const o of [...game.offers]) if (wantsOffer(game, pid, o)) game.act(pid, { type: "acceptOffer", offerId: o.id });
}

// Land and lending moves made at the start of a bot's turn.
function landMoves(game, pid) {
  const p = game.player(pid), pr = game.prices;
  if (game.offers.some(o => o.from === pid)) return;            // one offer of its own at a time
  if (p.status !== "farmer") {
    if (p.cash >= 15) game.act(pid, { type: "offer", to: null, give: { coins: 15 }, get: { iou: 20 } });
    return;
  }
  const dues = p.plots.length * (pr.waterNormal + 1) + p.loans * R.LOAN_INTEREST;
  const worst = [...p.plots].sort((a, b) => plantProfit(game, a.crop) - plantProfit(game, b.crop))[0];
  // Short of cash: sell the least useful plot, to another farmer at a premium if possible, else the Bank.
  if (p.plots.length > 1 && p.cash < dues + 4 && p.loans >= p.plots.length) {
    game.act(pid, { type: "sellPlot", plotId: worst.id });
    return;
  }
  if (p.plots.length > 1 && (p.cash < dues + 10 || plantProfit(game, worst.crop) <= 0)) {
    game.act(pid, { type: "offer", to: null, give: { plots: [worst.id] }, get: { coins: Math.round(pr.land * 1.5) } });
    return;
  }
  // Rich: bid on the best plot another farmer owns.
  if (p.cash > 60 + pr.land * 2 && p.plots.length < 6) {
    let best = null;
    for (const q of game.farmers()) if (q.id !== pid && q.plots.length > 1)
      for (const x of q.plots) { const v = plotValue(game, x.crop); if (!best || v > best.v) best = { q, x, v }; }
    if (best) {
      const bid = Math.min(p.cash - 30, Math.round(Math.max(pr.land * 1.5, best.v * 0.7)));
      if (bid > pr.land) game.act(pid, { type: "offer", to: best.q.id, give: { coins: bid }, get: { plots: [best.x.id] } });
    }
  }
}

function playBot(game, pid) {
  const p = game.player(pid);
  if (!p || game.phase !== "trade") return;
  considerOffers(game, pid);
  landMoves(game, pid);
  if (!game.player(pid) || game.phase !== "trade") return;
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

module.exports = { playBot, wantsOffer, considerOffers, plotValue };
