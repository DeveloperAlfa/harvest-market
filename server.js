// Harvest Market Online — rooms with join codes, live play over WebSockets.
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");
const { Game } = require("./src/engine");
const { playBot } = require("./src/bot");

const PORT = process.env.PORT || 8080;
const PUBLIC = path.join(__dirname, "public");
const MAX_SEATS = 5;
const ROOM_TTL_MS = 3 * 60 * 60 * 1000;
const BOT_NAMES = ["Asha (bot)", "Bhima (bot)", "Chitra (bot)", "Dev (bot)", "Esha (bot)"];

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
function makeRoom() { const room = { code: newCode(), host: null, members: [], game: null, touched: Date.now() }; rooms.set(room.code, room); return room; }
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
      members: room.members.map(m => ({ id: m.id, name: m.name, bot: m.bot, connected: m.connected })) },
    game: room.game ? room.game.view() : null,
  };
}
function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function broadcast(room) {
  room.touched = Date.now();
  for (const m of room.members) for (const ws of socketsByMember.get(m.id) || []) send(ws, roomView(room, m.id));
}

function runBots(room) {
  const g = room.game; if (!g || g.phase !== "trade") return;
  for (const m of room.members) if (m.bot) playBot(g, m.id);
}
function humansReady(room) {
  const g = room.game;
  return room.members.every(m => {
    if (m.bot || !m.connected) return true;
    const p = g.player(m.id);
    return !p || p.status !== "farmer" || p.ready;
  });
}
function maybeResolve(room) {
  const g = room.game;
  if (!g || g.phase !== "trade") return;
  if (humansReady(room)) { g.resolve(); runBots(room); }
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
      } else { me.connected = false; maybeResolve(room); broadcast(room); }
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
      room.game = new Game({ seed: crypto.randomInt(2 ** 31), start: msg.start === 11 ? 11 : 1,
        players: room.members.map(m => ({ id: m.id, name: m.name, bot: m.bot })) });
      runBots(room);
      return broadcast(room);
    }
    case "act": {
      if (!room.game) return fail("The game hasn't started.");
      const r = room.game.act(me.id, msg.a);
      if (!r.ok) fail(r.error);
      maybeResolve(room);
      return broadcast(room);
    }
    case "forceNext": {
      if (!isHost) return fail("Only the host can move the game on.");
      if (!room.game || room.game.phase !== "trade") return;
      room.game.resolve(); runBots(room);
      return broadcast(room);
    }
    case "endGame": {
      if (!isHost || !room.game) return fail("Only the host can end the game.");
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
}
function detach(ws) {
  if (!ws.member) return;
  const set = socketsByMember.get(ws.member);
  if (set) { set.delete(ws); if (!set.size) socketsByMember.delete(ws.member); }
  const room = ws.room, id = ws.member;
  ws.room = null; ws.member = null;
  if (room && !socketsByMember.has(id)) {
    const m = room.members.find(x => x.id === id);
    if (m) { m.connected = false; maybeResolve(room); broadcast(room); }
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
    rooms.delete(code);
  }
}, 30000);
sweeper.unref();

server.listen(PORT, () => console.log(`Harvest Market Online on http://localhost:${PORT}`));
module.exports = { server };
