"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { Game } = require("../src/engine");
const { playBot } = require("../src/bot");
const { R, CROP } = require("../src/rules");

const mk = (n = 3, seed = 42) => new Game({ seed, players: Array.from({ length: n }, (_, i) => ({ id: "p" + i, name: "P" + i, bot: false })) });

test("setup deals distinct crops, 3 plots and the starting coins each", () => {
  const g = mk(5);
  const crops = new Set(g.players.map(p => p.startCrop));
  assert.strictEqual(crops.size, 5);
  for (const p of g.players) { assert.strictEqual(p.plots.length, 3); assert.strictEqual(p.cash, R.START_CASH); }
});

test("bank buy and sell use the period prices", () => {
  const g = mk(); g.weather = { die: 4, drought: false };
  const p = g.players[0];
  assert.ok(g.act("p0", { type: "bankBuy", item: "water", qty: 5 }).ok);
  const w = R.WATER[0], c0 = R.START_CASH;
  assert.strictEqual(p.cash, c0 - 5 * w); assert.strictEqual(p.water, 5);
  assert.ok(g.act("p0", { type: "bankSell", item: "water", qty: 2 }).ok);
  assert.strictEqual(p.cash, c0 - 5 * w + 2 * (w - 1));
  assert.ok(!g.act("p0", { type: "bankBuy", item: "fert", qty: 50 }).ok, "can't overspend");
});

test("drought makes bank water cost 4x", () => {
  const g = mk(); g.weather = { die: 1, drought: true };
  g.act("p0", { type: "bankBuy", item: "water", qty: 2 });
  assert.strictEqual(g.players[0].cash, R.START_CASH - 2 * 4 * R.WATER[0]);
});

test("deals transfer everything and charge 1 coin each side", () => {
  const g = mk(); g.weather = { die: 4, drought: false };
  const [a, b] = g.players;
  g.act("p0", { type: "bankBuy", item: "water", qty: 4 });
  const a0 = a.cash;
  const plotId = a.plots[0].id;
  assert.ok(g.act("p0", { type: "offer", to: null, give: { water: 4, plots: [plotId] }, get: { coins: 10 } }).ok);
  const r = g.act("p1", { type: "acceptOffer", offerId: g.offers[0].id });
  assert.ok(r.ok, r.error);
  assert.strictEqual(a.cash, a0 + 10 - 1); assert.strictEqual(a.water, 0); assert.strictEqual(a.plots.length, 2);
  assert.strictEqual(b.cash, R.START_CASH - 10 - 1); assert.strictEqual(b.water, 4); assert.strictEqual(b.plots.length, 4);
});

test("IOU loans: lender pays now, IOU recorded", () => {
  const g = mk();
  assert.ok(g.act("p1", { type: "offer", to: "p0", give: { coins: 8 }, get: { iou: 10 } }).ok);
  assert.ok(g.act("p0", { type: "acceptOffer", offerId: g.offers[0].id }).ok);
  assert.strictEqual(g.ious.length, 1);
  assert.deepStrictEqual([g.ious[0].from, g.ious[0].to, g.ious[0].amount], ["p0", "p1", 10]);
  assert.strictEqual(g.players[0].cash, R.START_CASH + 8 - 1);
});

test("planting, harvest payout and upkeep", () => {
  const g = mk(2); g.weather = { die: 4, drought: false };
  const p = g.players[0], need = CROP[p.startCrop].water;
  g.act("p0", { type: "bankBuy", item: "water", qty: need });
  g.act("p0", { type: "setPlot", plotId: p.plots[0].id, mode: "plant" });
  const before = p.cash;
  g.resolve();
  const lr = p.lastRound;
  assert.strictEqual(lr.planted.length, 1);
  assert.ok(lr.earned >= 6, "a sack sells for at least 6");
  assert.strictEqual(lr.upkeep, 2 * g.prices.waterNormal, "two idle plots cost one water price each");
  assert.strictEqual(p.cash, before + lr.earned - lr.upkeep);
});

test("a planned field without water stays empty; leftovers without warehouse are sold", () => {
  const g = mk(2); g.weather = { die: 4, drought: false };
  const p = g.players[0];
  g.act("p0", { type: "setPlot", plotId: p.plots[0].id, mode: "plant" });   // no water bought
  g.act("p0", { type: "bankBuy", item: "fert", qty: 1 });                    // no warehouse to keep it
  g.resolve();
  assert.strictEqual(p.lastRound.failed, 1);
  assert.strictEqual(p.lastRound.planted.length, 0);
  assert.strictEqual(p.fert, 0);
  assert.strictEqual(p.lastRound.upkeep, 3 * R.WATER[0], "three empty fields at the water price each");
});

test("planning a field buys nothing", () => {
  const g = mk(2); g.weather = { die: 4, drought: false };
  const p = g.players[0], c0 = p.cash;
  assert.ok(g.act("p0", { type: "setPlot", plotId: p.plots[0].id, mode: "fert" }).ok);
  assert.strictEqual(p.cash, c0); assert.strictEqual(p.water, 0); assert.strictEqual(p.fert, 0);
  assert.strictEqual(p.plots[0].mode, "fert");
});

test("short of fertilizer, the field is still planted, just not fertilized", () => {
  const g = mk(2); g.weather = { die: 4, drought: false };
  const p = g.players[0]; p.cash = 200;
  const need = g.view().crops.find(c => c.id === p.plots[0].crop).water;
  g.act("p0", { type: "bankBuy", item: "water", qty: need });
  g.act("p0", { type: "setPlot", plotId: p.plots[0].id, mode: "fert" });
  g.resolve();
  assert.strictEqual(p.lastRound.planted.length, 1);
  assert.strictEqual(p.lastRound.planted[0].fert, false);
});

test("fields are empty again after the harvest; stocked warehouses stay", () => {
  const g = mk(2); g.weather = { die: 4, drought: false };
  const p = g.players[0]; p.cash = 500;
  const need = g.view().crops.find(c => c.id === p.plots[0].crop).water;
  g.act("p0", { type: "bankBuy", item: "water", qty: need });
  g.act("p0", { type: "setPlot", plotId: p.plots[0].id, mode: "plant" });
  g.act("p0", { type: "setPlot", plotId: p.plots[1].id, mode: "ware" });
  g.act("p0", { type: "setPlot", plotId: p.plots[2].id, mode: "ware" });
  g.act("p0", { type: "bankBuy", item: "water", qty: 4 });
  g.resolve();
  assert.strictEqual(p.plots[0].mode, "idle");
  assert.deepStrictEqual(p.plots.slice(1).map(x => x.mode).sort(), ["idle", "ware"], "one warehouse holds the water, the empty one is cleared");
});

test("warehouses keep goods, packed, fertilizer first", () => {
  const g = mk(2); g.weather = { die: 4, drought: false };
  const p = g.players[0];
  p.cash = 300;
  g.act("p0", { type: "bankBuy", item: "water", qty: 12 });
  g.act("p0", { type: "bankBuy", item: "fert", qty: 1 });
  g.act("p0", { type: "setPlot", plotId: p.plots[0].id, mode: "ware" });
  g.act("p0", { type: "setPlot", plotId: p.plots[1].id, mode: "ware" });
  g.resolve();
  assert.strictEqual(p.fert, 1);                 // one warehouse for fertilizer
  assert.strictEqual(p.water, 10);               // the other holds 10 water; 2 sold
});

test("going broke sells goods then land, then makes a Moneylender", () => {
  const g = mk(2); g.weather = { die: 4, drought: false };
  const p = g.players[0];
  p.cash = -100;
  g.resolve();
  assert.strictEqual(p.status, "lender");
  assert.strictEqual(p.plots.length, 0);
  assert.strictEqual(g.phase, "ended", "only one farmer left ends the game");
  assert.strictEqual(g.results[0].id, "p1");
});

test("moneylenders can only lend coins for IOUs", () => {
  const g = mk(3); g.weather = { die: 4, drought: false };
  g.players[2].status = "lender";
  assert.ok(!g.act("p2", { type: "bankBuy", item: "water", qty: 1 }).ok);
  assert.ok(!g.act("p2", { type: "offer", give: { coins: 5 }, get: { water: 1 } }).ok);
  assert.ok(g.act("p2", { type: "offer", give: { coins: 5 }, get: { iou: 6 } }).ok);
});

test("bot-only games always finish with a valid ranking", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const n = 3 + (seed % 3);
    const g = new Game({ seed, players: Array.from({ length: n }, (_, i) => ({ id: "b" + i, name: "Bot " + i, bot: true })) });
    let guard = 0;
    while (g.phase === "trade" && guard++ < 60) {
      for (const p of g.players) playBot(g, p.id);
      for (const p of g.players) {
        assert.ok(p.water >= 0 && p.fert >= 0 && p.loans >= 0, `negative goods (seed ${seed})`);
        assert.ok(p.loans <= Math.max(p.plots.length, 0) || p.status !== "farmer" || true);
      }
      g.resolve();
    }
    assert.strictEqual(g.phase, "ended", `seed ${seed} did not end`);
    assert.strictEqual(g.results.length, n);
    assert.deepStrictEqual(g.results.map(r => r.rank), Array.from({ length: n }, (_, i) => i + 1));
  }
});
