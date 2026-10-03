// Harvest Market Online — rooms with join codes, live play over WebSockets.
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");
const { Game } = require("./src/engine");
const { playBot, wantsOffer } = require("./src/bot");

const PORT = process.env.PORT || 8080;
const PUBLIC = path.join(__dirname, "public");
const MAX_SEATS = 5;
const ROOM_TTL_MS = 3 * 60 * 60 * 1000;
const BOT_NAMES = ["Asha (bot)", "Bhima (bot)", "Chitra (bot)", "Dev (bot)", "Esha (bot)"];
// Pacing. HM_FAST=1 (tests) shrinks every delay.
const FAST = process.env.HM_FAST === "1";
const T = {
  botThink: FAST ? [5, 15] : [2000, 4500],    // before a bot's first move
  botStep: FAST ? [2, 6] : [400, 900],        // between a bot's moves
  reply: FAST ? [3, 8] : [2000, 5000],        // a bot looking at a new offer
  harvest: FAST ? 20 : 2200,                  // "harvest is coming in" pause before results
  second: FAST ? 5 : 1000,                    // length of a timer second
};
const TURN_CHOICES = [0, 60, 90, 120, 180];   // round timer options in seconds (0 = no timer)
const DEFAULT_TURN = 120;
const between = ([a, b]) => a + Math.floor(Math.random() * (b - a + 1));

// ------------------------------------------------------------------ static files
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || "/").split("?")[0]);
  if (url === "/health") { res.writeHead(200); return res.end("ok"); }
  const file = path.normalize(path.join(PUBLIC, url === "/" ? "index.html" : url));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(data);
  });
});

// ------------------------------------------------------------------ rooms
const rooms = new Map();           // code -> room
const sessions = new Map();        // token -> { code, id }
const socketsByMember = new Map(); // member id -> Set(ws)

const newId = () => crypto.randomBytes(6).toString("hex");
function newCode() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let c; do { c = Array.from({ length: 4 }, () => A[crypto.randomInt(A.length)]).join(""); } while (rooms.has(c));
  return c;
}
function makeRoom() {
  const room = { code: newCode(), host: null, members: [], game: null, touched: Date.now(),
    turnSecs: DEFAULT_TURN, deadline: null, harvesting: false, thinking: new Set(), timers: [], paused: false };
  rooms.set(room.code, room); return room;
}
function addMember(room, name, bot) {
  const m = { id: newId(), name: String(name || "").trim().slice(0, 24) || "Farmer", bot: !!bot, token: bot ? null : newId(), connected: !bot };
  room.members.push(m);
  if (!room.host && !bot) room.host = m.id;
  if (m.token) sessions.set(m.token, { code: room.code, id: m.id });
  return m;
}

function roomView(room, youId) {
  return {
    t: "state",
    you: youId,
    room: { code: room.code, host: room.host, started: !!room.game,
      members: room.members.map(m => ({ id: m.id, name: m.name, bot: m.bot, connected: m.connected })),
      turnSecs: room.turnSecs },
    clock: { total: room.roundMs || null, deadlineIn: room.deadline ? Math.max(0, room.deadline - Date.now()) : null,
      harvesting: room.harvesting, thinking: [...room.thinking], paused: room.paused },
    game: room.game ? room.game.view() : null,
  };
}
function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function broadcast(room) {
  room.touched = Date.now();
  for (const m of room.members) for (const ws of socketsByMember.get(m.id) || []) send(ws, roomView(room, m.id));
}

// ------------------------------------------------------------------ round flow
// Each round: bots "think" and make their moves one by one, a timer runs (if set),
// and when everyone is ready (or time is up) the harvest comes in after a short pause.
function clearTimers(room) { room.timers.forEach(clearTimeout); room.timers = []; room.thinking.clear(); room.deadline = null; }
const later = (room, ms, fn) => { const t = setTimeout(() => { try { fn(); } catch (e) { console.error(e); } }, ms); t.unref && t.unref(); room.timers.push(t); };
const anyoneHere = room => room.members.some(m => !m.bot && m.connected);

// Plan a bot's moves on a copy of the game, then replay them on the real game with pauses.
function planBot(game, pid) {
  const sim = Object.create(Object.getPrototypeOf(game));
  for (const [k, v] of Object.entries(game)) sim[k] = typeof v === "function" ? () => 0.5 : structuredClone(v);
  const moves = [], act = sim.act.bind(sim);
  sim.act = (id, a) => { const r = act(id, a); if (r.ok) moves.push(a); return r; };
  playBot(sim, pid);
  // drop moves that change nothing on the real board (setting an empty plot to empty)
  const p = game.player(pid);
  return moves.filter(a => !(a.type === "setPlot" && (p.plots.find(x => x.id === a.plotId) || {}).mode === a.mode && a.mode === "idle"));
}

function startRound(room) {
  clearTimers(room);
  const g = room.game; if (!g || g.phase !== "trade") return;
  if (!anyoneHere(room)) { room.paused = true; return; }   // nobody watching: wait until someone is back
  room.paused = false;
  const round = g.round;
  // round 1 gets an extra minute so new players can take the tour
  if (room.turnSecs) { const ms = (room.turnSecs + (round === g.startRound ? 60 : 0)) * T.second; room.deadline = Date.now() + ms; room.roundMs = ms; later(room, ms, () => harvest(room)); }
  for (const m of room.members) if (m.bot) {
    const p = g.player(m.id); if (!p) continue;
    room.thinking.add(m.id);
    const moves = planBot(g, m.id);
    let at = between(T.botThink);
    moves.forEach(a => {
      later(room, at, () => {
        if (g.round !== round || room.harvesting) return;
        if (a.type === "ready") room.thinking.delete(m.id);
        const before = g.offers.length, r = g.act(m.id, a);
        if (r.ok && a.type === "offer" && g.offers.length > before) botsConsider(room, g.offers[g.offers.length - 1].id);
        if (a.type === "ready") maybeResolve(room); else broadcast(room);
      });
      at += a.type === "ready" ? 0 : between(T.botStep);
    });
    if (!moves.some(a => a.type === "ready")) later(room, at, () => { room.thinking.delete(m.id); g.act(m.id, { type: "ready", value: true }); maybeResolve(room); });
  }
}
// Bots look at a newly pinned offer after a pause; they answer offers made to them by name.
const YES = ["Deal!", "Done. Pleasure doing business.", "Shake on it.", "Sold."];
const NO = ["Not at that price.", "I'll pass.", "Make it sweeter and we'll talk.", "No thanks."];
const pick = a => a[Math.floor(Math.random() * a.length)];
function botsConsider(room, offerId) {
  const g = room.game, o = g.offers.find(x => x.id === offerId);
  if (!o) return;
  const round = g.round;
  for (const m of room.members) if (m.bot && m.id !== o.from && (o.to == null || o.to === m.id)) {
    later(room, between(T.reply), () => {
      if (g.round !== round || room.harvesting || g.phase !== "trade") return;
      const still = g.offers.find(x => x.id === offerId);
      if (!still) return;
      const fromBot = (room.members.find(x => x.id === o.from) || {}).bot;
      if (wantsOffer(g, m.id, still) && g.act(m.id, { type: "acceptOffer", offerId }).ok) {
        if (!fromBot) g.act(m.id, { type: "chat", text: pick(YES) });
      } else if (o.to === m.id && !fromBot) g.act(m.id, { type: "chat", text: pick(NO) });
      broadcast(room);
    });
  }
}

function harvest(room) {
  const g = room.game;
  if (!g || g.phase !== "trade" || room.harvesting) return;
  clearTimers(room);
  room.harvesting = true;
  broadcast(room);
  later(room, T.harvest, () => {
    room.harvesting = false;
    g.resolve();
    startRound(room);
    broadcast(room);
  });
}
function everyoneReady(room) {
  const g = room.game;
  return room.thinking.size === 0 && room.members.every(m => {
    const p = g.player(m.id);
    if (!p || p.status !== "farmer") return true;
    if (!m.bot && !m.connected) return true;
    return p.ready;
  });
}
function maybeResolve(room) {
  const g = room.game;
  if (!g || g.phase !== "trade" || room.harvesting) return broadcast(room);
  if (everyoneReady(room)) harvest(room); else broadcast(room);
}

// ------------------------------------------------------------------ messages
function handle(ws, msg) {
  const fail = text => send(ws, { t: "error", msg: text });
  const me = ws.member && ws.room ? ws.room.members.find(m => m.id === ws.member) : null;

  switch (msg.t) {
    case "hello": {
      const s = sessions.get(msg.token);
      const room = s && rooms.get(s.code);
      if (!room) return send(ws, { t: "welcome" });
      attach(ws, room, s.id);
      return broadcast(room);
    }
    case "create": {
      const room = makeRoom();
      const m = addMember(room, msg.name);
      attach(ws, room, m.id);
      send(ws, { t: "token", token: m.token });
      return broadcast(room);
    }
    case "join": {
      const room = rooms.get(String(msg.code || "").toUpperCase().trim());
      if (!room) return fail("No game with that code.");
      if (room.game) return fail("That game has already started.");
      if (room.members.length >= MAX_SEATS) return fail("That table is full.");
      const m = addMember(room, msg.name);
      attach(ws, room, m.id);
      send(ws, { t: "token", token: m.token });
      return broadcast(room);
    }
    case "leave": {
      if (!me) return;
      const room = ws.room;
      detach(ws);
      if (!room.game) {
        room.members = room.members.filter(x => x.id !== me.id);
        sessions.delete(me.token);
        if (room.host === me.id) room.host = (room.members.find(x => !x.bot) || {}).id || null;
        if (!room.members.some(x => !x.bot)) rooms.delete(room.code);
        else broadcast(room);
      } else { me.connected = false; maybeResolve(room); }
      return send(ws, { t: "welcome" });
    }
  }

  if (!me) return fail("Join a game first.");
  const room = ws.room, isHost = room.host === me.id;

  switch (msg.t) {
    case "addBot": {
      if (!isHost) return fail("Only the host can add bots.");
      if (room.game) return fail("The game has started.");
      if (room.members.length >= MAX_SEATS) return fail("The table is full.");
      const used = new Set(room.members.map(x => x.name));
      addMember(room, BOT_NAMES.find(n => !used.has(n)) || "Bot", true);
      return broadcast(room);
    }
    case "settings": {
      if (!isHost) return fail("Only the host can change the timer.");
      if (room.game) return fail("The game has started.");
      const v = Number(msg.turnSecs);
      if (!TURN_CHOICES.includes(v)) return fail("Pick one of the timer options.");
      room.turnSecs = v;
      return broadcast(room);
    }
    case "removeMember": {
      if (!isHost || room.game) return fail("Only the host can remove players before the start.");
      const m = room.members.find(x => x.id === msg.id);
      if (!m || m.id === me.id) return;
      room.members = room.members.filter(x => x !== m);
      if (m.token) sessions.delete(m.token);
      for (const s of socketsByMember.get(m.id) || []) { s.room = null; s.member = null; send(s, { t: "welcome", note: "You were removed from the table." }); }
      return broadcast(room);
    }
    case "start": {
      if (!isHost) return fail("Only the host can start.");
      if (room.game) return fail("Already started.");
      if (room.members.length < 2) return fail("Add at least one more player or bot.");
      room.game = new Game({ seed: crypto.randomInt(2 ** 31), rounds: msg.rounds === 25 || msg.start === 11 ? 25 : 35,
        players: room.members.map(m => ({ id: m.id, name: m.name, bot: m.bot })) });
      startRound(room);
      return broadcast(room);
    }
    case "act": {
      if (!room.game) return fail("The game hasn't started.");
      if (room.harvesting && (msg.a || {}).type !== "chat") return fail("The harvest is coming in. Wait a moment.");
      const before = room.game.offers.length;
      const r = room.game.act(me.id, msg.a);
      if (!r.ok) fail(r.error);
      else if ((msg.a || {}).type === "offer" && room.game.offers.length > before) botsConsider(room, room.game.offers[room.game.offers.length - 1].id);
      return maybeResolve(room);
    }
    case "forceNext": {
      if (!isHost) return fail("Only the host can move the game on.");
      if (!room.game || room.game.phase !== "trade") return;
      return harvest(room);
    }
    case "endGame": {
      if (!isHost || !room.game) return fail("Only the host can end the game.");
      clearTimers(room); room.harvesting = false;
      room.game.forceEnd();
      return broadcast(room);
    }
    default: return fail("Unknown request.");
  }
}

function attach(ws, room, id) {
  detach(ws);
  ws.room = room; ws.member = id;
  if (!socketsByMember.has(id)) socketsByMember.set(id, new Set());
  socketsByMember.get(id).add(ws);
  const m = room.members.find(x => x.id === id); if (m) m.connected = true;
  if (room.paused && room.game && room.game.phase === "trade") startRound(room);
}
function detach(ws) {
  if (!ws.member) return;
  const set = socketsByMember.get(ws.member);
  if (set) { set.delete(ws); if (!set.size) socketsByMember.delete(ws.member); }
  const room = ws.room, id = ws.member;
  ws.room = null; ws.member = null;
  if (room && !socketsByMember.has(id)) {
    const m = room.members.find(x => x.id === id);
    if (m) { m.connected = false; maybeResolve(room); }
  }
}

const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 16 * 1024 });
wss.on("connection", ws => {
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });
  let budget = 40;                                     // simple flood control: 40 messages per 10 s
  const refill = setInterval(() => { budget = 40; }, 10000);
  ws.on("message", data => {
    if (--budget < 0) return send(ws, { t: "error", msg: "Slow down a little." });
    let msg; try { msg = JSON.parse(data); } catch { return; }
    try { handle(ws, msg || {}); } catch (e) { console.error(e); send(ws, { t: "error", msg: "Something went wrong." }); }
  });
  ws.on("close", () => { clearInterval(refill); detach(ws); });
});

const sweeper = setInterval(() => {
  for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); }
  const now = Date.now();
  for (const [code, room] of rooms) if (now - room.touched > ROOM_TTL_MS) {
    for (const m of room.members) if (m.token) sessions.delete(m.token);
    clearTimers(room);
    rooms.delete(code);
  }
}, 30000);
sweeper.unref();

server.listen(PORT, () => console.log(`Harvest Market Online on http://localhost:${PORT}`));
module.exports = { server };
