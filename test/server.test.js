"use strict";
const test = require("node:test");
const assert = require("node:assert");
const WebSocket = require("ws");

process.env.PORT = "18081";
const { server } = require("../server");

function client() {
  const ws = new WebSocket("ws://localhost:18081/ws");
  const box = { ws, state: null, errors: [], token: null, waiters: [] };
  ws.on("message", d => {
    const m = JSON.parse(d);
    if (m.t === "state") box.state = m;
    if (m.t === "error") box.errors.push(m.msg);
    if (m.t === "token") box.token = m.token;
    box.waiters.splice(0).forEach(f => f());
  });
  box.send = m => ws.send(JSON.stringify(m));
  box.until = (pred, ms = 3000) => new Promise((res, rej) => {
    const t0 = Date.now();
    const check = () => { if (pred(box)) return res(); if (Date.now() - t0 > ms) return rej(new Error("timeout")); box.waiters.push(check); setTimeout(check, 50); };
    check();
  });
  box.open = new Promise(r => ws.on("open", r));
  return box;
}

test("two humans and a bot play a round over WebSockets", async () => {
  const a = client(), b = client();
  await a.open; await b.open;
  a.send({ t: "create", name: "Nipun" });
  await a.until(x => x.state && x.state.room);
  const code = a.state.room.code;
  b.send({ t: "join", code, name: "Friend" });
  await b.until(x => x.state && x.state.room && x.state.room.members.length === 2);
  a.send({ t: "addBot" });
  await a.until(x => x.state.room.members.length === 3);
  b.send({ t: "start" });                                   // not host
  await b.until(x => x.errors.length > 0);
  a.send({ t: "start" });
  await a.until(x => x.state.game && x.state.game.round === 1);
  const g = a.state.game, aid = a.state.you, bid = b.state.you;
  const pa = g.players.find(p => p.id === aid);
  // a buys water and plants one plot; makes an offer that b accepts
  // two loans make sure even drought-priced water is affordable
  a.send({ t: "act", a: { type: "takeLoan" } });
  a.send({ t: "act", a: { type: "takeLoan" } });
  const need = g.crops.find(c => c.id === pa.plots[0].crop).water;
  a.send({ t: "act", a: { type: "bankBuy", item: "water", qty: need + 1 } });
  a.send({ t: "act", a: { type: "setPlot", plotId: pa.plots[0].id, mode: "plant" } });
  a.send({ t: "act", a: { type: "offer", to: bid, give: { water: 1 }, get: { coins: 3 } } });
  await b.until(x => x.state.game && x.state.game.offers.length === 1);
  b.send({ t: "act", a: { type: "acceptOffer", offerId: b.state.game.offers[0].id } });
  await a.until(x => x.state.game.offers.length === 0 && x.state.game.log.some(l => l.kind === "deal"));
  a.send({ t: "act", a: { type: "chat", text: "Water anyone?" } });
  await b.until(x => x.state.game && x.state.game.log.some(l => l.kind === "chat"));
  a.send({ t: "act", a: { type: "ready", value: true } });
  b.send({ t: "act", a: { type: "ready", value: true } });
  await a.until(x => x.state.game.round > 1 || x.state.game.phase === "ended");
  const after = a.state.game.players.find(p => p.id === aid);
  assert.ok(after.lastRound, "round report exists");
  assert.strictEqual(after.lastRound.planted.length, 1);
  // reconnect with token restores the seat
  const c = client(); await c.open;
  c.send({ t: "hello", token: a.token });
  await c.until(x => x.state && x.state.you === aid);
  a.ws.close(); b.ws.close(); c.ws.close();
});

test.after(() => { server.close(); setTimeout(() => process.exit(process.exitCode || 0), 50).unref(); });
