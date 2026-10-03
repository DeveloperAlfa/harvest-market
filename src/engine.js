// Harvest Market — authoritative rules engine (tabletop edition rules).
// Pure game logic: no networking. Every action is validated here.
"use strict";
const { CROPS, CROP, R, prices, rng, shuffle, harvestDeck, fertBags } = require("./rules");

const MODES = ["idle", "plant", "fert", "ware"];
const ITEMS = ["water", "fert"];
const int = v => Number.isInteger(v) ? v : NaN;

class Game {
  constructor({ seed = Date.now(), players, start = 1 }) {
    if (!players || players.length < 2 || players.length > 5) throw new Error("A game needs 2 to 5 players");
    this.seed = seed >>> 0;
    this.rand = rng(this.seed);
    this.round = start;
    this.startRound = start;
    this.pos = Object.fromEntries(CROPS.map(c => [c.id, 3]));
    this.deck = [];
    this.lastDrought = false;
    this.offers = [];
    this.ious = [];
    this.log = [];
    this.lastHarvest = null;
    this.phase = "trade";
    this.results = null;
    this._ids = 1;
    this._seq = 0;          // order in which plots were planned, newest trimmed first
    const crops = shuffle(CROPS.map(c => c.id), this.rand).slice(0, players.length);
    this.players = players.map((p, i) => ({
      id: p.id, name: p.name, bot: !!p.bot, startCrop: crops[i], status: "farmer",
      cash: R.START_CASH, water: 0, fert: 0, loans: 0, ready: false, outRound: null, lastRound: null,
      plots: Array.from({ length: R.START_PLOTS }, () => ({ id: this._ids++, crop: crops[i], mode: "idle" })),
    }));
    this.say("system", `Game started at round ${this.round}. Crops: ` +
      this.players.map(p => `${p.name} ${CROP[p.startCrop].name}`).join(", ") + ".");
    this.rollWeather();
  }

  // ------------------------------------------------------------------ helpers
  get prices() { return prices(this.round, this.weather.drought); }
  player(id) { return this.players.find(p => p.id === id); }
  farmers() { return this.players.filter(p => p.status === "farmer"); }
  say(kind, text, who) { this.log.push({ round: this.round, kind, text, who: who || null, t: Date.now() }); if (this.log.length > 500) this.log.shift(); }
  rollWeather() {
    const die = 1 + Math.floor(this.rand() * 6);
    const drought = this.lastDrought ? die <= 3 : die === 1;
    this.weather = { die, drought, continued: this.lastDrought && drought };
    this.say("weather", drought ? (this.lastDrought ? `Rolled ${die}: the drought continues.` : `Rolled ${die}: drought!`) : `Rolled ${die}: no drought.`);
  }

  // ------------------------------------------------------------------ actions
  act(playerId, a) {
    try {
      const err = this._act(playerId, a || {});
      return err ? { ok: false, error: err } : { ok: true };
    } catch (e) {
      return { ok: false, error: "That action could not be completed." };
    }
  }

  _act(pid, a) {
    const p = this.player(pid);
    if (!p) return "You are not in this game.";
    if (a.type === "chat") {
      const text = String(a.text || "").trim().slice(0, 300);
      if (!text) return "Message is empty.";
      this.say("chat", text, p.id);
      return null;
    }
    if (this.phase !== "trade") return "The game is over.";
    const pr = this.prices;
    const farmerOnly = () => p.status !== "farmer" ? "Moneylenders can only lend." : null;

    switch (a.type) {
      case "ready": p.ready = !!a.value; return null;

      case "bankBuy": case "bankSell": {
        const e = farmerOnly(); if (e) return e;
        const qty = int(a.qty), item = a.item;
        if (!ITEMS.includes(item) || !(qty > 0) || qty > 200) return "Choose water or fertilizer and a quantity.";
        if (a.type === "bankBuy") {
          const cost = qty * (item === "water" ? pr.water : pr.fert);
          if (p.cash < cost) return `That costs ${cost}; you have ${p.cash}.`;
          p.cash -= cost; p[item] += qty;
          this.say("bank", `bought ${qty} ${item === "water" ? "water" : "fertilizer"} for ${cost}.`, p.id);
        } else {
          if (p[item] < qty) return `You only have ${p[item]}.`;
          const gain = qty * (item === "water" ? pr.buyWater : pr.buyFert);
          p[item] -= qty; p.cash += gain;
          this.say("bank", `sold ${qty} ${item === "water" ? "water" : "fertilizer"} for ${gain}.`, p.id);
        }
        return null;
      }

      case "sellPlot": {
        const e = farmerOnly(); if (e) return e;
        const i = p.plots.findIndex(x => x.id === a.plotId);
        if (i < 0) return "That plot is not yours.";
        const [plot] = p.plots.splice(i, 1);
        p.cash += pr.land;
        this.say("bank", `sold a ${CROP[plot.crop].name} plot to the Bank for ${pr.land}.`, p.id);
        this._dropOffersUsingPlot(plot.id);
        return null;
      }

      case "setPlot": {
        const e = farmerOnly(); if (e) return e;
        const plot = p.plots.find(x => x.id === a.plotId);
        if (!plot) return "That plot is not yours.";
        if (!MODES.includes(a.mode)) return "Unknown plot use.";
        plot.mode = a.mode;
        return null;
      }

      case "takeLoan": {
        const e = farmerOnly(); if (e) return e;
        if (p.loans >= p.plots.length) return "You can hold at most one Bank Loan per plot you own.";
        p.loans++; p.cash += R.LOAN_SIZE;
        this.say("bank", `took a Bank Loan of ${R.LOAN_SIZE}.`, p.id);
        return null;
      }

      case "repayLoan": {
        const e = farmerOnly(); if (e) return e;
        if (p.loans < 1) return "You have no Bank Loan.";
        if (p.cash < R.LOAN_SIZE) return `Repaying costs ${R.LOAN_SIZE}.`;
        p.loans--; p.cash -= R.LOAN_SIZE;
        this.say("bank", `repaid a Bank Loan.`, p.id);
        return null;
      }

      case "offer": {
        const give = this._bundle(a.give), get = this._bundle(a.get);
        if (!give || !get) return "Offer amounts must be whole numbers, zero or more.";
        if (this._empty(give) && this._empty(get)) return "An offer needs something in it.";
        if (a.to != null) {
          const t = this.player(a.to);
          if (!t || t.id === p.id) return "Choose another player.";
        }
        if (p.status !== "farmer") {
          if (!this._lenderOk(give, get)) return "Moneylenders can only offer coins in exchange for IOUs.";
        }
        const has = this._has(p, give); if (has) return has;
        const offer = { id: this._ids++, from: p.id, to: a.to ?? null, give, get, round: this.round };
        this.offers.push(offer);
        this.say("offer", this._describe(offer), p.id);
        return null;
      }

      case "cancelOffer": {
        const i = this.offers.findIndex(o => o.id === a.offerId && o.from === p.id);
        if (i < 0) return "Offer not found.";
        this.offers.splice(i, 1);
        this.say("offer", "withdrew an offer.", p.id);
        return null;
      }

      case "acceptOffer": {
        const o = this.offers.find(x => x.id === a.offerId);
        if (!o) return "That offer is gone.";
        if (o.from === p.id) return "You can't accept your own offer.";
        if (o.to != null && o.to !== p.id) return "That offer is for someone else.";
        const q = this.player(o.from);
        if (p.status !== "farmer" && !this._lenderOk(o.get, o.give)) return "Moneylenders can only lend coins for IOUs.";
        if (q.status !== "farmer" && !this._lenderOk(o.give, o.get)) return "That offer is no longer valid.";
        const e1 = this._has(q, o.give); if (e1) { this.offers = this.offers.filter(x => x !== o); return "The other player no longer has what they offered."; }
        const e2 = this._has(p, o.get); if (e2) return e2;
        const qCash = q.cash - o.give.coins + o.get.coins - R.DEAL_FEE;
        const pCash = p.cash - o.get.coins + o.give.coins - R.DEAL_FEE;
        if (qCash < 0) return `${q.name} can't cover the 1-coin deal fee.`;
        if (pCash < 0) return "You can't cover the 1-coin deal fee.";
        this._transfer(q, p, o.give);
        this._transfer(p, q, o.get);
        q.cash -= R.DEAL_FEE; p.cash -= R.DEAL_FEE;
        this.offers = this.offers.filter(x => x !== o);
        this.say("deal", `${p.name} accepted ${q.name}'s offer: ${this._describe(o, true)}`, p.id);
        return null;
      }

      default: return "Unknown action.";
    }
  }

  _bundle(b) {
    b = b || {};
    const out = { coins: int(b.coins || 0), water: int(b.water || 0), fert: int(b.fert || 0), iou: int(b.iou || 0),
      plots: Array.isArray(b.plots) ? b.plots.map(Number) : [] };
    if ([out.coins, out.water, out.fert, out.iou].some(v => !(v >= 0) || v > 100000)) return null;
    if (out.plots.some(x => !Number.isInteger(x))) return null;
    return out;
  }
  _empty(b) { return !b.coins && !b.water && !b.fert && !b.iou && !b.plots.length; }
  _lenderOk(lenderGives, lenderGets) {
    return lenderGives.coins > 0 && !lenderGives.water && !lenderGives.fert && !lenderGives.iou && !lenderGives.plots.length &&
      lenderGets.iou > 0 && !lenderGets.coins && !lenderGets.water && !lenderGets.fert && !lenderGets.plots.length;
  }
  _has(p, b) {
    if (p.cash < b.coins) return `${p.name} doesn't have ${b.coins} coins.`;
    if (p.water < b.water) return `${p.name} doesn't have ${b.water} water.`;
    if (p.fert < b.fert) return `${p.name} doesn't have ${b.fert} fertilizer.`;
    for (const id of b.plots) if (!p.plots.some(x => x.id === id)) return `${p.name} doesn't own that plot.`;
    if (b.iou > 0 && p.status !== "farmer") return "Only farmers can write IOUs.";
    return null;
  }
  _transfer(from, to, b) {
    from.cash -= b.coins; to.cash += b.coins;
    from.water -= b.water; to.water += b.water;
    from.fert -= b.fert; to.fert += b.fert;
    for (const id of b.plots) {
      const i = from.plots.findIndex(x => x.id === id);
      const [plot] = from.plots.splice(i, 1);
      plot.mode = "idle";
      to.plots.push(plot);
      this._dropOffersUsingPlot(id);
    }
    if (b.iou > 0) this.ious.push({ id: this._ids++, from: from.id, to: to.id, amount: b.iou, round: this.round });
  }
  _dropOffersUsingPlot(id) { this.offers = this.offers.filter(o => !o.give.plots.includes(id) && !o.get.plots.includes(id)); }
  _plotName(id) { for (const p of this.players) { const x = p.plots.find(y => y.id === id); if (x) return `${CROP[x.crop].name} plot`; } return "plot"; }
  _bundleText(b) {
    const parts = [];
    if (b.coins) parts.push(`${b.coins} coins`);
    if (b.water) parts.push(`${b.water} water`);
    if (b.fert) parts.push(`${b.fert} fertilizer`);
    for (const id of b.plots) parts.push(`a ${this._plotName(id)}`);
    if (b.iou) parts.push(`an IOU for ${b.iou}`);
    return parts.length ? parts.join(", ") : "nothing";
  }
  _describe(o, done) {
    const who = o.to != null ? ` to ${this.player(o.to).name}` : " to anyone";
    return `${done ? "" : "offers" + who + ": "}${this._bundleText(o.give)} for ${this._bundleText(o.get)}.`;
  }

  // ------------------------------------------------------------------ round resolution
  allReady() { return this.players.filter(p => !p.bot && p.status === "farmer").every(p => p.ready); }

  resolve() {
    if (this.phase !== "trade") return;
    const pr = this.prices, rep = {};
    // 1. plant
    for (const p of this.farmers()) {
      const r = rep[p.id] = { planted: [], failed: 0, earned: 0, sold: 0, upkeep: 0, notes: [] };
      for (const plot of p.plots) {
        if (plot.mode !== "plant" && plot.mode !== "fert") continue;
        const need = CROP[plot.crop].water, fert = plot.mode === "fert";
        const bags = fertBags(plot.crop);
        if (p.water >= need) {
          p.water -= need;
          const fed = fert && p.fert >= bags;
          if (fed) p.fert -= bags; else if (fert) r.unfed = (r.unfed || 0) + 1;
          r.planted.push({ plot: plot.id, crop: plot.crop, fert: fed });
        } else r.failed++;
      }
      if (r.failed) r.notes.push(`${r.failed} field(s) had no water and stayed empty`);
      if (r.unfed) r.notes.push(`${r.unfed} field(s) were planted without fertilizer (not enough bags)`);
    }
    // 2. harvest
    if (!this.deck.length) this.deck = harvestDeck(this.rand);
    const card = this.deck.pop(), moves = {};
    for (const c of CROPS) {
      const before = this.pos[c.id];
      let x = before; if (x < 3) x++; else if (x > 3) x--;
      x = Math.max(0, Math.min(6, x + card.moves[c.id]));
      this.pos[c.id] = x; moves[c.id] = c.track[x] - c.track[before];
    }
    const sack = Object.fromEntries(CROPS.map(c => [c.id, c.track[this.pos[c.id]] + pr.bonus]));
    for (const p of this.farmers()) {
      const r = rep[p.id];
      for (const pl of r.planted) {
        const sacks = (pl.fert ? 2 : 1) * (card.bumper === pl.crop ? 3 : 1);
        r.earned += sacks * sack[pl.crop];
      }
      p.cash += r.earned;
    }
    this.lastHarvest = { round: this.round, moves, bumper: card.bumper, mood: card.mood, sack };
    this.say("harvest", `Harvest: ${card.bumper ? `bumper ${CROP[card.bumper].name}! ` : "no bumper. "}${card.mood ? card.mood + ". " : ""}` +
      CROPS.map(c => `${c.name} ${sack[c.id]}`).join(", ") + ".");
    // 3. storage + 4. upkeep
    for (const p of this.farmers()) {
      const r = rep[p.id];
      const W = p.plots.filter(x => x.mode === "ware").length;
      const fertKept = Math.min(p.fert, W * R.WAREHOUSE_FERT);
      const wFert = Math.ceil(fertKept / R.WAREHOUSE_FERT);
      const waterKept = Math.min(p.water, (W - wFert) * R.WAREHOUSE_WATER);
      const wWater = Math.ceil(waterKept / R.WAREHOUSE_WATER);
      const soldF = p.fert - fertKept, soldW = p.water - waterKept;
      r.sold = soldF * pr.buyFert + soldW * pr.buyWater;
      if (soldF || soldW) r.notes.push(`unstored goods sold: ${soldW} water, ${soldF} fertilizer`);
      p.fert = fertKept; p.water = waterKept; p.cash += r.sold;
      const usedW = wFert + wWater, emptyW = W - usedW;
      const idle = p.plots.filter(x => x.mode === "idle").length + r.failed + emptyW;
      const idleCost = R.UPKEEP_SCALES ? pr.waterNormal : R.IDLE_UPKEEP;
      const wareCost = R.UPKEEP_SCALES ? pr.waterNormal + 1 : R.WAREHOUSE_UPKEEP;
      r.upkeep = idle * idleCost + usedW * wareCost + p.loans * R.LOAN_INTEREST;
      p.cash -= r.upkeep;
      p.lastRound = { round: this.round, ...r };
    }
    // 5. going broke / no land
    for (const p of this.farmers()) {
      if (p.cash < 0) {
        const goods = p.water * pr.buyWater + p.fert * pr.buyFert;
        if (goods) { p.cash += goods; p.water = 0; p.fert = 0; this.say("broke", `had to sell goods to the Bank for ${goods}.`, p.id); }
        const order = ["idle", "ware", "plant", "fert"];
        p.plots.sort((a, b) => order.indexOf(a.mode) - order.indexOf(b.mode));
        while (p.cash < 0 && p.plots.length) { p.plots.shift(); p.cash += pr.land; this.say("broke", `had to sell a plot to the Bank for ${pr.land}.`, p.id); }
      }
      if (p.cash < 0 || p.plots.length === 0) this._goOut(p);
    }
    // 6. fields are cleared for the new round; warehouses that still hold goods stay warehouses
    for (const p of this.farmers()) {
      let full = Math.ceil(p.fert / R.WAREHOUSE_FERT) + Math.ceil(p.water / R.WAREHOUSE_WATER);
      for (const x of p.plots) {
        if (x.mode === "ware" && full > 0) { full--; continue; }
        x.mode = "idle"; delete x.order;
      }
    }
    // 7. boom, next round
    const boom = this.farmers().some(p => p.cash >= R.BOOM_AT);
    this.offers = [];
    const lastLand = pr.land, lastBuyW = pr.buyWater, lastBuyF = pr.buyFert;
    this.round += boom ? 2 : 1;
    if (boom) this.say("boom", `Boom! Someone has ${R.BOOM_AT}+ coins, so a round is skipped.`);
    if (this.round > R.ROUNDS || this.farmers().length <= 1) {
      this.round = Math.min(this.round, R.ROUNDS);
      return this._end(lastLand, lastBuyW, lastBuyF);
    }
    this.lastDrought = this.weather.drought;
    this.rollWeather();
    for (const p of this.players) p.ready = false;
  }

  _goOut(p) {
    p.status = "lender"; p.outRound = this.round;
    p.cash = Math.max(0, p.cash) + R.MONEYLENDER_PURSE;
    p.water = 0; p.fert = 0; p.loans = 0; p.plots = [];
    const lost = this.ious.filter(i => i.from === p.id);
    this.ious = this.ious.filter(i => i.from !== p.id);
    this.say("out", `is out of the farm and becomes a Moneylender.${lost.length ? " Their IOUs are now worthless." : ""}`, p.id);
  }

  _end(land, buyW, buyF) {
    this.phase = "ended";
    const active = new Set(this.farmers().map(p => p.id));
    const scored = this.players.map(p => {
      const held = this.ious.filter(i => i.to === p.id && active.has(i.from)).reduce((s, i) => s + i.amount, 0);
      const owed = this.ious.filter(i => i.from === p.id).reduce((s, i) => s + i.amount, 0);
      const score = p.status === "farmer"
        ? p.cash + p.plots.length * land + p.water * buyW + p.fert * buyF + held - R.LOAN_SIZE * p.loans - owed
        : p.cash + held;
      return { id: p.id, name: p.name, status: p.status, score, outRound: p.outRound };
    });
    scored.sort((a, b) => (a.status === b.status ? b.score - a.score : a.status === "farmer" ? -1 : 1));
    this.results = scored.map((s, i) => ({ ...s, rank: i + 1 }));
    this.say("end", "Game over. " + this.results.map(r => `${r.rank}. ${r.name} (${r.score})`).join(", "));
  }

  forceEnd() { if (this.phase === "trade") { const pr = this.prices; this._end(pr.land, pr.buyWater, pr.buyFert); } }

  view() {
    return {
      seed: this.seed, round: this.round, phase: this.phase, weather: this.weather, lastDrought: this.lastDrought,
      prices: this.prices, pos: this.pos, deckLeft: this.deck.length, lastHarvest: this.lastHarvest,
      players: this.players, offers: this.offers, ious: this.ious, log: this.log.slice(-150), results: this.results,
      crops: CROPS, rules: R,
    };
  }
}

module.exports = { Game, MODES };
