// Harvest Market — game client.
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }, del(k) { try { localStorage.removeItem(k); } catch (e) {} } };
  const FACE = ["#B23A2A", "#157C78", "#6E7F25", "#8E3B62", "#2A72B5"];
  const CROPCOL = { ragi: "#8C4A2F", rice: "#4F8A3C", turmeric: "#E0A200", cotton: "#6C7F93", sugarcane: "#8E3B62" };

  let ws, S = { you: null, room: null, game: null }, retry = 0;
  let openPlot = null, sellConfirm = false, chatOpen = false, seenLog = 0, lastPopRound = null, confirmEnd = false;
  const qty = { w: 1, f: 1 };
  let deadlineAt = null, tab = "farm";
  function goTab(t) {
    tab = t;
    document.querySelectorAll("[data-pane]").forEach(el => { el.hidden = el.dataset.pane !== t; });
    document.querySelectorAll("#tabs [data-go]").forEach(b => b.setAttribute("aria-current", b.dataset.go === t ? "page" : "false"));
  }
  const draft = { give: { coins: 0, water: 0, fert: 0, iou: 0 }, get: { coins: 0, water: 0, fert: 0, iou: 0 } };

  // ------------------------------------------------------------- connection
  function connect() {
    ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws");
    ws.onopen = () => { retry = 0; ws.send(JSON.stringify({ t: "hello", token: store.get("hm-token") })); };
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.t === "token") store.set("hm-token", m.token);
      else if (m.t === "welcome") { S = { you: null, room: null, game: null }; if (m.note) $("welcomeNote").textContent = m.note; render(); }
      else if (m.t === "state") { const prev = S; S = m; deadlineAt = m.clock && m.clock.deadlineIn != null ? Date.now() + m.clock.deadlineIn : null; render(prev); }
      else if (m.t === "error") toast(m.msg);
    };
    ws.onclose = () => { setTimeout(connect, Math.min(8000, 500 * 2 ** retry++)); };
  }
  const send = m => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); else toast("Connecting… try again in a moment."); };
  const act = a => send({ t: "act", a });
  let tt; function toast(t) { const el = $("toast"); el.textContent = t; el.hidden = false; clearTimeout(tt); tt = setTimeout(() => { el.hidden = true; }, 3000); }

  // ------------------------------------------------------------- helpers
  const G = () => S.game;
  const me = () => G() && G().players.find(p => p.id === S.you);
  const crop = id => G().crops.find(c => c.id === id);
  const bags = cid => (G().rules.FERT_PER_BARREL ? crop(cid).water : 1);
  const dues = () => { const pr = G().prices, R = G().rules; return R.UPKEEP_SCALES ? { idle: pr.waterNormal, ware: pr.waterNormal + 1 } : { idle: R.IDLE_UPKEEP, ware: R.WAREHOUSE_UPKEEP }; };
  const pname = id => (G().players.find(p => p.id === id) || {}).name || "?";
  const faceOf = id => { const i = (S.room ? S.room.members.findIndex(m => m.id === id) : 0); return FACE[(i < 0 ? 0 : i) % FACE.length]; };
  const plotLabel = id => { for (const p of G().players) { const x = p.plots.find(y => y.id === id); if (x) return `${crop(x.crop).name} plot`; } return "plot"; };
  function bundleText(b) {
    const a = [];
    if (b.coins) a.push(`${b.coins} coins`); if (b.water) a.push(`${b.water} water`); if (b.fert) a.push(`${b.fert} fertilizer`);
    b.plots.forEach(id => a.push(`a ${plotLabel(id)}`)); if (b.iou) a.push(`an IOU for ${b.iou}`);
    return a.length ? a.join(", ") : "nothing";
  }
  const show = id => ["welcome", "lobby", "game", "results"].forEach(s => { $(s).hidden = s !== id; });

  // ------------------------------------------------------------- art
  function plantGlyph(cid, x, y) {
    switch (cid) {
      case "ragi": return `<g transform="translate(${x},${y})"><path d="M0 8V-4" stroke="#3D7A30" stroke-width="2"/><g fill="#7A3B1E"><ellipse cx="-4" cy="-7" rx="2" ry="4" transform="rotate(-30 -4 -7)"/><ellipse cx="0" cy="-9" rx="2" ry="4"/><ellipse cx="4" cy="-7" rx="2" ry="4" transform="rotate(30 4 -7)"/></g></g>`;
      case "rice": return `<g transform="translate(${x},${y})" stroke="#4F9A3A" stroke-width="2" fill="none" stroke-linecap="round"><path d="M0 8C0 0-2-6-7-9"/><path d="M0 8C0 0 1-7 0-11"/><path d="M0 8C0 0 3-6 8-8"/><circle cx="-6" cy="-9" r="1.5" fill="#E8C24A" stroke="none"/><circle cx="7" cy="-8" r="1.5" fill="#E8C24A" stroke="none"/></g>`;
      case "turmeric": return `<g transform="translate(${x},${y})"><path d="M0 8C-9 2-9-6-2-11C-1-3-1 3 0 8Z" fill="#4C8B2F"/><path d="M0 8C9 2 9-6 3-10C1-3 1 3 0 8Z" fill="#6AA63E"/><circle cx="0" cy="-3" r="2.5" fill="#F2B705"/></g>`;
      case "cotton": return `<g transform="translate(${x},${y})"><path d="M0 9V-2M0 2L-5-3M0 0L5-5" stroke="#3D7A30" stroke-width="2" fill="none"/><circle cx="-5" cy="-5" r="4" fill="#FFFDF6" stroke="#9AA4AF"/><circle cx="5" cy="-7" r="4" fill="#FFFDF6" stroke="#9AA4AF"/></g>`;
      case "sugarcane": return `<g transform="translate(${x},${y})"><g fill="#8E3B62"><rect x="-4" y="-14" width="3" height="22" rx="1"/><rect x="2" y="-11" width="3" height="19" rx="1"/></g><g stroke="#E9D3DD" stroke-width="1"><path d="M-4-6h3M-4 1h3M2-3h3M2 3h3"/></g><path d="M-3-14C-9-16-12-12-13-9M3-11C9-14 12-10 13-7" stroke="#4C8B2F" stroke-width="2" fill="none"/></g>`;
    }
    return "";
  }
  function plotSvg(plot, opts = {}) {
    const drought = opts.drought, mode = plot.mode;
    if (mode === "ware") {
      const n = opts.water || 0, f = opts.fert || 0;
      const items = [];
      for (let i = 0; i < Math.min(n, 10); i++) items.push(`<g transform="translate(${8 + (i % 5) * 9},${58 + Math.floor(i / 5) * 10})"><rect width="7" height="9" rx="2" fill="#2A72B5" stroke="#232A55"/><path d="M0 3h7M0 6h7" stroke="#9CC8EE"/></g>`);
      for (let i = 0; i < Math.min(f, 10); i++) items.push(`<g transform="translate(${54 + (i % 5) * 9},${58 + Math.floor(i / 5) * 10})"><rect width="7" height="9" rx="1" fill="#6E7F25" stroke="#232A55"/></g>`);
      return `<svg viewBox="0 0 100 80" aria-hidden="true"><rect width="100" height="80" fill="#C9A06A"/><path d="M0 50h100" stroke="#A9814F" stroke-width="2"/>
        <path d="M24 26L50 8L76 26Z" fill="#5A2A1A" stroke="#232A55" stroke-width="2"/><rect x="28" y="26" width="44" height="26" fill="#B23A2A" stroke="#232A55" stroke-width="2"/>
        <rect x="43" y="34" width="14" height="18" fill="#F3D9B0" stroke="#232A55" stroke-width="2"/><path d="M43 34L57 52M57 34L43 52" stroke="#232A55" stroke-width="1.5"/>${items.join("")}</svg>`;
    }
    const soil = drought ? "#C08254" : "#9E5533", furrow = drought ? "#A06440" : "#7C3D22";
    let body = "";
    for (let r = 0; r < 5; r++) body += `<rect x="0" y="${8 + r * 15}" width="100" height="4" fill="${furrow}" opacity=".7"/>`;
    if (drought) body += `<path d="M10 20l8 6-3 8 9 4M60 12l-5 9 7 5-2 9M78 50l-9 4 3 8M30 58l7-6 6 5" stroke="#6E3A1F" stroke-width="1.2" fill="none"/>`;
    if (mode === "plant" || mode === "fert") {
      for (const y of [24, 46, 68]) for (const x of [18, 50, 82]) body += plantGlyph(plot.crop, x, y);
      if (mode === "fert") body += `<g fill="#F3B315">${[[34, 14], [66, 34], [30, 58], [70, 66]].map(([x, y]) => `<path d="M${x} ${y - 3}l1 2 2 1-2 1-1 2-1-2-2-1 2-1z"/>`).join("")}</g>`;
    } else {
      body += `<g stroke="#5D9A3A" stroke-width="1.6" stroke-linecap="round">${[[14, 30], [46, 60], [80, 22], [70, 70]].map(([x, y]) => `<path d="M${x} ${y}l-2-4M${x} ${y}l2-5"/>`).join("")}</g>`;
    }
    return `<svg viewBox="0 0 100 80" aria-hidden="true"><rect width="100" height="80" fill="${soil}"/>${body}</svg>`;
  }
  const ICON = {
    coin: `<svg viewBox="0 0 28 28"><circle cx="14" cy="15" r="11" fill="#9A6B0E"/><circle cx="14" cy="13" r="11" fill="#D49A16" stroke="#232A55" stroke-width="2"/><circle cx="14" cy="13" r="6.5" fill="none" stroke="#F7D46B" stroke-width="2"/></svg>`,
    water: `<svg viewBox="0 0 28 28"><rect x="5" y="4" width="18" height="21" rx="5" fill="#2A72B5" stroke="#232A55" stroke-width="2"/><path d="M5 11h18M5 18h18" stroke="#9CC8EE" stroke-width="2"/></svg>`,
    fert: `<svg viewBox="0 0 28 28"><path d="M8 6h12l3 4v15H5V10z" fill="#6E7F25" stroke="#232A55" stroke-width="2"/><path d="M14 21v-6M14 17l-3-3M14 16l3-3" stroke="#EEF3CF" stroke-width="2" fill="none"/></svg>`,
    loan: `<svg viewBox="0 0 28 28"><rect x="5" y="4" width="18" height="21" rx="2" fill="#FFF7C2" stroke="#232A55" stroke-width="2"/><path d="M9 10h10M9 14h10M9 18h6" stroke="#B23A2A" stroke-width="2"/></svg>`,
  };
  function cropDot(cid) { return `<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">${{ ragi: `<circle cx="9" cy="9" r="7"/>`, rice: `<rect x="2.5" y="2.5" width="13" height="13"/>`, turmeric: `<polygon points="9,1.5 16.5,15.5 1.5,15.5"/>`, cotton: `<polygon points="9,1 16.5,9 9,17 1.5,9"/>`, sugarcane: `<polygon points="9,1 16,5 16,13 9,17 2,13 2,5"/>` }[cid].replace("/>", ` fill="${CROPCOL[cid]}" stroke="#F6F2E0" stroke-width="1"/>`)}</svg>`; }

  // ------------------------------------------------------------- render
  function render(prev) {
    if (!S.room) { show("welcome"); if (!$("nameIn").value) $("nameIn").value = store.get("hm-name") || ""; return; }
    if (!S.room.started) return renderLobby();
    if (G().phase === "ended") return renderResults();
    renderGame(prev);
  }

  function renderLobby() {
    show("lobby");
    const host = S.room.host === S.you;
    $("lobbyCode").textContent = S.room.code;
    $("memberList").innerHTML = S.room.members.map((m, i) => `<div class="villager"><span class="face" style="background:${FACE[i % 5]}">${esc(m.name[0] || "?")}</span>
      <div class="who"><b>${esc(m.name)}</b><small>${m.bot ? "Bot farmer" : m.connected ? "Here" : "Away"}${m.id === S.room.host ? " · host" : ""}${m.id === S.you ? " · you" : ""}</small></div>
      ${host && m.id !== S.you ? `<button class="btn ghost" data-remove="${m.id}">Remove</button>` : ""}</div>`).join("") +
      Array.from({ length: 5 - S.room.members.length }, () => `<div class="villager" style="opacity:.5"><span class="face" style="background:#9AA4AF">?</span><div class="who"><b>Empty seat</b></div></div>`).join("");
    $("hostLobby").hidden = !host; $("waitHost").hidden = host;
    $("addBotBtn").disabled = S.room.members.length >= 5;
    $("startBtn").disabled = S.room.members.length < 2;
    $("turnSel").value = String(S.room.turnSecs);
    $("timerNote").textContent = S.room.turnSecs ? `Each round lasts up to ${fmtSecs(S.room.turnSecs)}; the harvest comes sooner if everyone is ready.` : "No round timer: the harvest waits until everyone is ready.";
    document.querySelectorAll("[data-remove]").forEach(b => b.onclick = () => send({ t: "removeMember", id: b.dataset.remove }));
  }

  function renderGame(prev) {
    show("game");
    if (!tourOn && !store.get("hm-tour") && !renderGame.toured) { renderGame.toured = true; setTimeout(startTour, 400); }
    const g = G(), p = me(), pr = g.prices, d = dues(), dry = g.weather.drought;
    // sky
    $("sky").classList.toggle("dry", dry);
    $("skyArt").innerHTML = `<div class="sunball"></div>` + (dry ? "" : `<div class="cloud" style="top:14px;width:70px;left:8%"></div><div class="cloud" style="top:38px;width:54px;left:60%;animation-delay:-18s"></div>`);
    $("roundNum").textContent = g.round;
    $("roundOf").textContent = `of ${g.rules.ROUNDS} · season ${pr.period}`;
    $("weatherWord").textContent = dry ? `Drought! Water costs ${pr.water}` : (g.lastDrought ? "The rains are back" : "Good weather");
    renderTurn();

    // farm
    if (p) {
      $("farmTitle").textContent = p.status === "farmer" ? `${p.name}'s farm` : `${p.name}, moneylender`;
      $("farmHint").textContent = p.status === "farmer" ? "Tap a plot to plant it, store goods in it, or sell it." : "You lost your land. You can still lend coins for IOUs on the deal board.";
      const W = p.plots.filter(x => x.mode === "ware").length;
      let fertLeft = p.fert, waterLeft = p.water;
      $("plots").innerHTML = p.plots.map(x => {
        const c = crop(x.crop), plan = x.mode;
        let ws = {};
        if (plan === "ware") { const f = Math.min(fertLeft, 10); fertLeft -= f; const w2 = f ? 0 : Math.min(waterLeft, 10); waterLeft -= w2; ws = { water: w2, fert: f }; }
        const label = { idle: "Empty", plant: "Planted", fert: "Planted + fert", ware: "Warehouse" }[plan];
        return `<button class="plot" data-plot="${x.id}" aria-label="${c.name} plot, ${label}">${plotSvg(x, { drought: dry, ...ws })}
          <span class="flag">${label}</span><span class="cap">${c.name}<small>${plan === "ware" ? `dues ${d.ware}` : plan === "idle" ? `dues ${d.idle}` : `${c.water} water${plan === "fert" ? ` + ${bags(c.id)} bags` : ""}`}</small></span></button>`;
      }).join("") || `<p class="hint">No land left.</p>`;
      const owe = g.ious.filter(i => i.from === p.id).reduce((s, i) => s + i.amount, 0);
      $("barn").innerHTML = [["coin", p.cash, "coins"], ["water", p.water, "water"], ["fert", p.fert, "fertilizer"], ["loan", p.loans, owe ? `loans · IOUs ${owe}` : "bank loans"]]
        .map(([i, v, k]) => `<div class="res">${ICON[i]}<div><b>${v}</b><span>${k}</span></div></div>`).join("");
      const planW = p.plots.filter(x => x.mode === "plant" || x.mode === "fert").reduce((s, x) => s + crop(x.crop).water, 0);
      const planF = p.plots.filter(x => x.mode === "fert").reduce((s, x) => s + bags(x.crop), 0);
      const spareW = Math.max(0, p.water - planW), spareF = Math.max(0, p.fert - planF);
      const room = W * 10, spare = Math.ceil(spareF / 10) + Math.ceil(spareW / 10);
      $("farmWarn").textContent = p.status === "farmer" && (spareW || spareF) && spare > W
        ? `${spareW ? spareW + " water" : ""}${spareW && spareF ? " and " : ""}${spareF ? spareF + " bags" : ""} won't be used for planting. Make a plot a warehouse to keep them, or they're sold back cheaply at the harvest.`
        : "";
      document.querySelectorAll("[data-plot]").forEach(b => b.onclick = () => { openPlot = +b.dataset.plot; sellConfirm = false; renderSheet(); });
      // harvest pops
      if (g.lastHarvest && p.lastRound && lastPopRound !== g.lastHarvest.round && prev && prev.game && prev.game.round !== g.round) {
        for (const pl of p.lastRound.planted) {
          const sacks = (pl.fert ? 2 : 1) * (g.lastHarvest.bumper === pl.crop ? 3 : 1), amt = sacks * g.lastHarvest.sack[pl.crop];
          const el = document.querySelector(`[data-plot="${pl.plot}"]`);
          if (el) el.insertAdjacentHTML("beforeend", `<span class="pop">+${amt}</span>`);
        }
      }
      if (g.lastHarvest && prev && prev.game && prev.game.round !== g.round && p.lastRound && p.lastRound.round === prev.game.round) { showReport(prev.game.round); goTab("farm"); }
      if (g.lastHarvest) lastPopRound = g.lastHarvest.round;
    }

    // neighbours
    $("neighbours").innerHTML = g.players.filter(x => x.id !== S.you).map(x => {
      const thinking = S.clock && S.clock.thinking.includes(x.id);
      const st = x.status !== "farmer" ? `<span class="st out">out</span>` : thinking ? `<span class="st think">thinking<i>.</i><i>.</i><i>.</i></span>` : x.ready ? `<span class="st ok">ready</span>` : `<span class="st">planning</span>`;
      return `<div class="nb"><div class="top"><span class="face" style="background:${faceOf(x.id)}">${esc(x.name[0])}</span><span class="nm">${esc(x.name)}</span>${st}</div>
        <div class="minis">${x.plots.map(pl => plotSvg(pl, { drought: dry })).join("") || '<span class="nums">no land</span>'}</div>
        <div class="nums">${x.cash} coins · ${x.water} water · ${x.fert} bags${x.loans ? ` · ${x.loans} loans` : ""}</div>
        ${p && (p.status === "farmer" || x.status === "farmer") ? `<button class="btn ghost small-btn" data-offer-to="${x.id}">Offer ${esc(x.name.split(" ")[0])} a deal</button>` : ""}</div>`;
    }).join("");

    document.querySelectorAll("[data-offer-to]").forEach(b => b.onclick = () => openDeal(b.dataset.offerTo));
    // mandi
    $("pWater").textContent = pr.water; $("pWater").parentElement.classList.toggle("hot", dry);
    $("pBuyWater").textContent = pr.buyWater; $("pFert").textContent = pr.fert; $("pBuyFert").textContent = pr.buyFert;
    $("pLand").textContent = `Buys a plot for ${pr.land}`;
    $("qW").textContent = qty.w; $("qF").textContent = qty.f;
    if (p) $("miniBarn").innerHTML = `You have <b>${p.cash}</b> coins · <b>${p.water}</b> water · <b>${p.fert}</b> bags · <b>${p.loans}</b> loans`;
    const forMe = g.offers.filter(o => o.from !== S.you && (o.to === S.you || (o.to == null && p && p.status === "farmer")));
    $("dealBadge").hidden = !forMe.length; $("dealBadge").textContent = forMe.length;
    if (prev && prev.game && prev.game.round === g.round) {
      const old = new Set(prev.game.offers.map(o => o.id));
      const fresh = g.offers.filter(o => !old.has(o.id) && o.from !== S.you && o.to === S.you);
      if (fresh.length && tab !== "deals") toast(`${pname(fresh[0].from)} pinned an offer for you. See Deals.`);
    }
    const h = g.lastHarvest;
    $("cropBoard").innerHTML = g.crops.map(c => {
      const owners = g.players.filter(x => x.plots.some(y => y.crop === c.id)).map(x => x.name);
      const mv = h && h.round === g.round - 1 || h && h.round === g.round - 2 ? h.moves[c.id] : 0;
      const bump = h && h.bumper === c.id && (g.round - h.round <= 2);
      return `<div class="crow ${bump ? "bumper" : ""}">${cropDot(c.id)}<span class="nm">${c.name}${bump ? " · bumper!" : ""}<small>${owners.length ? esc(owners.join(", ")) : "nobody farms it"} · ${c.water} water</small></span>
        <span class="pr">${c.track[g.pos[c.id]] + pr.bonus}</span><span class="mv ${mv > 0 ? "up" : mv < 0 ? "down" : ""}">${mv > 0 ? "▲" + mv : mv < 0 ? "▼" + -mv : ""}</span></div>`;
    }).join("");
    $("boardFoot").textContent = `Prices move at the harvest. Crop bonus this season: ${pr.bonus ? "+" + pr.bonus : "none"} (already included).`;

    // deals
    $("offerList").innerHTML = g.offers.length ? g.offers.map((o, i) => {
      const mine = o.from === S.you, forMe = !mine && (o.to == null || o.to === S.you);
      return `<div class="note ${mine ? "mine" : forMe ? "forme" : ""}" style="--tilt:${[-2, 1.5, -1, 2][i % 4]}deg">
        <b>${esc(pname(o.from))} → ${o.to == null ? "anyone" : esc(pname(o.to))}</b>
        <span>Gives <span class="gv">${esc(bundleText(o.give))}</span></span><span>Wants <span class="gv">${esc(bundleText(o.get))}</span></span>
        ${mine ? `<button class="btn ghost" data-cancel="${o.id}">Take it down</button>` : forMe ? `<button class="btn go" data-accept="${o.id}">Accept</button>` : ""}</div>`;
    }).join("") : `<p class="empty">No deals pinned. Pin one to trade water, fertilizer, land or a loan with another farmer.</p>`;
    document.querySelectorAll("[data-accept]").forEach(b => b.onclick = () => act({ type: "acceptOffer", offerId: +b.dataset.accept }));
    document.querySelectorAll("[data-cancel]").forEach(b => b.onclick = () => act({ type: "cancelOffer", offerId: +b.dataset.cancel }));
    $("iouList").innerHTML = g.ious.map(i => `<span>📜 ${esc(pname(i.from))} owes ${esc(pname(i.to))} ${i.amount} at the end of the season</span>`).join("");

    // host
    $("hostGame").hidden = S.room.host !== S.you;
    $("endConfirm").innerHTML = confirmEnd ? `<div class="pair"><button class="btn" id="endYes">Yes, end it for everyone</button><button class="btn ghost" id="endNo">Keep playing</button></div>` : "";
    if (confirmEnd) { $("endYes").onclick = () => { confirmEnd = false; send({ t: "endGame" }); }; $("endNo").onclick = () => { confirmEnd = false; render(); }; }

    renderChat(prev);
    if (openPlot != null) renderSheet();
    if (!$("dealSheet").hidden) renderDealPlots();
  }

  function renderSheet() {
    const g = G(), p = me(), x = p && p.plots.find(y => y.id === openPlot);
    if (!x || p.status !== "farmer") { $("sheet").hidden = true; openPlot = null; return; }
    const c = crop(x.crop), d = dues(), pr = g.prices;
    $("sheet").hidden = false;
    $("sheetArt").innerHTML = plotSvg(x, { drought: g.weather.drought, water: x.mode === "ware" ? p.water : 0, fert: x.mode === "ware" ? p.fert : 0 });
    $("sheetTitle").textContent = `${c.name} plot`;
    $("sheetInfo").textContent = `Sack price now ${c.track[g.pos[c.id]] + pr.bonus}. You have ${p.water} water and ${p.fert} bags.`;
    const cost = mode => {   // what choosing this would buy from the Bank
      let w = 0, f = 0;
      for (const y of p.plots) if (y !== x && (y.mode === "plant" || y.mode === "fert")) { w += crop(y.crop).water; if (y.mode === "fert") f += bags(y.crop); }
      const sw = Math.max(0, w + c.water - p.water), sf = mode === "fert" ? Math.max(0, f + bags(c.id) - p.fert) : 0;
      return { sw, sf, coins: sw * pr.water + sf * pr.fert };
    };
    const buyLine = (mode, base) => {
      if (x.mode === mode) return base;
      const k = cost(mode); if (!k.coins) return base;
      const what = [k.sw && `${k.sw} water`, k.sf && `${k.sf} bags`].filter(Boolean).join(" + ");
      return k.coins > p.cash ? `Needs ${what} for ${k.coins}; you have ${p.cash}. Borrow at the Bank first.` : `${base} · buys ${what} for ${k.coins}`;
    };
    const opts = [
      ["plant", "Plant", buyLine("plant", `${c.water} water · 1 sack`)],
      ["fert", "Plant + fertilize", buyLine("fert", `${c.water} water + ${bags(c.id)} bags · 2 sacks`)],
      ["ware", "Warehouse", `Keeps 10 water or 10 bags · dues ${d.ware}`],
      ["idle", "Leave empty", `Dues ${d.idle}`],
    ];
    const cant = m => (m === "plant" || m === "fert") && x.mode !== m && cost(m).coins > p.cash;
    $("sheetChoices").innerHTML = opts.map(([m, t, s]) => `<button class="choice" aria-pressed="${x.mode === m}" data-mode="${m}" ${cant(m) ? "disabled" : ""}><b>${t}</b><span>${s}</span></button>`).join("");
    document.querySelectorAll("#sheetChoices [data-mode]").forEach(b => b.onclick = () => { act({ type: "setPlot", plotId: x.id, mode: b.dataset.mode }); openPlot = null; $("sheet").hidden = true; });
    $("sheetSell").innerHTML = sellConfirm
      ? `<div class="pair"><button class="btn" id="sellYes">Sell for ${pr.land} coins</button><button class="btn ghost" id="sellNo">Keep it</button></div>${p.plots.length === 1 ? `<p class="warn">This is your last plot. Without land you're out of the farm.</p>` : ""}`
      : `<button class="btn ghost" id="sellAsk">Sell this plot to the Bank</button>`;
    if (sellConfirm) { $("sellYes").onclick = () => { act({ type: "sellPlot", plotId: x.id }); openPlot = null; $("sheet").hidden = true; }; $("sellNo").onclick = () => { sellConfirm = false; renderSheet(); }; }
    else $("sellAsk").onclick = () => { sellConfirm = true; renderSheet(); };
  }

  function renderChat(prev) {
    const g = G(), feed = $("feed");
    const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40;
    feed.innerHTML = g.log.map(l => {
      if (l.kind === "chat") return `<div class="msg ${l.who === S.you ? "me" : ""}"><small style="color:${faceOf(l.who)}">${esc(pname(l.who))}</small>${esc(l.text)}</div>`;
      const big = ["harvest", "boom", "out", "end", "weather", "deal"].includes(l.kind);
      return `<div class="event ${big ? "big" : ""}">${l.who && l.kind !== "deal" ? esc(pname(l.who)) + " " : ""}${esc(l.text)}</div>`;
    }).join("");
    if (atBottom || chatOpen) feed.scrollTop = feed.scrollHeight;
    const unread = g.log.slice(seenLog).filter(l => l.kind === "chat" && l.who !== S.you);
    if (chatOpen) seenLog = g.log.length;
    $("chatBadge").hidden = chatOpen || !unread.length; $("chatBadge").textContent = unread.length;
    const last = unread[unread.length - 1];
    if (!chatOpen && last && prev && prev.game && prev.game.log.length < g.log.length) {
      const b = $("bubble"); b.innerHTML = `<b>${esc(pname(last.who))}:</b> ${esc(last.text)}`; b.hidden = false;
      clearTimeout(renderChat.t); renderChat.t = setTimeout(() => { b.hidden = true; }, 4000);
    }
  }

  // deal composer
  const FIELDS = [["coins", "Coins"], ["water", "Water"], ["fert", "Fertilizer"], ["iou", "IOU"]];
  function renderDealRows() {
    for (const side of ["give", "get"]) {
      $(side + "Rows").innerHTML = FIELDS.map(([k, l]) => `<div class="stepr"><span>${l}${k === "iou" ? (side === "give" ? " you write" : " they write") : ""}</span>
        <button data-st="${side}:${k}:-1" aria-label="Less ${l}">−</button><output>${draft[side][k]}</output><button data-st="${side}:${k}:1" aria-label="More ${l}">+</button></div>`).join("");
    }
    document.querySelectorAll("[data-st]").forEach(b => b.onclick = () => {
      const [s, k, d] = b.dataset.st.split(":"); const step = k === "coins" || k === "iou" ? 5 : 1;
      draft[s][k] = Math.max(0, draft[s][k] + (+d) * step); renderDealRows();
    });
  }
  function renderDealPlots() {
    const g = G(), p = me(), sel = $("offerTo"), prevVal = sel.value;
    sel.innerHTML = `<option value="">Anyone</option>` + g.players.filter(x => x.id !== S.you).map(x => `<option value="${x.id}">${esc(x.name)}${x.status !== "farmer" ? " (moneylender)" : ""}</option>`).join("");
    sel.value = [...sel.options].some(o => o.value === prevVal) ? prevVal : "";
    const keep = (id, list) => { const was = new Set([...document.querySelectorAll(`#${id} input:checked`)].map(i => +i.value)); $(id).innerHTML = list.map(x => `<label><input type="checkbox" value="${x.id}" ${was.has(x.id) ? "checked" : ""}> ${crop(x.crop).name} plot</label>`).join(""); };
    keep("gPlots", p ? p.plots : []);
    const t = g.players.find(x => x.id === sel.value);
    keep("wPlots", t ? t.plots : []);
  }

  // ------------------------------------------------------------- turn bar: timer, who's ready, the ready button
  const fmtSecs = n => n >= 60 ? `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}` : `0:${String(n).padStart(2, "0")}`;
  function renderTurn() {
    const g = G(), p = me(), ck = S.clock || { thinking: [] };
    const conn = id => (S.room.members.find(m => m.id === id) || {}).connected;
    const farmers = g.players.filter(x => x.status === "farmer" && (x.bot || conn(x.id)));
    const ready = farmers.filter(x => x.ready && !ck.thinking.includes(x.id));
    $("roll").innerHTML = farmers.map(x => {
      const th = ck.thinking.includes(x.id), ok = x.ready && !th;
      return `<span class="dot ${ok ? "ok" : th ? "th" : ""}" style="--c:${faceOf(x.id)}" title="${esc(x.name)}: ${ok ? "ready" : th ? "thinking" : "planning"}">${esc(x.name[0])}</span>`;
    }).join("") + `<span class="cnt">${ready.length} of ${farmers.length} ready</span>`;
    const waitingOn = farmers.filter(x => !x.ready && !x.bot).map(x => x.id === S.you ? "you" : x.name);
    const thinking = farmers.filter(x => ck.thinking.includes(x.id)).map(x => x.name.replace(" (bot)", ""));
    const bits = [];
    if (ck.harvesting) bits.push("Harvest is coming in…");
    else {
      if (waitingOn.length) bits.push(`Waiting for ${waitingOn.join(", ")}`);
      if (thinking.length) bits.push(`${thinking.join(", ")} ${thinking.length > 1 ? "are" : "is"} thinking`);
      if (!bits.length) bits.push("Everyone's ready");
    }
    $("readyLine").textContent = bits.join(" · ");
    const rb = $("readyBtn");
    rb.hidden = !p || p.status !== "farmer";
    rb.disabled = !!ck.harvesting;
    if (p) {
      $("readyLabel").textContent = p.ready ? "Ready ✓  Change plans" : "Ready for harvest";
      rb.classList.toggle("on", !!p.ready);
    }
    $("curtain").hidden = !ck.harvesting;
    tick();
  }
  function tick() {
    const el = $("clock");
    if (!S.game || deadlineAt == null || (S.clock && S.clock.harvesting)) { el.hidden = true; return; }
    const total = (S.clock && S.clock.total) || (S.room.turnSecs || 1) * 1000, left = Math.max(0, deadlineAt - Date.now());
    el.hidden = false;
    $("clockText").textContent = fmtSecs(Math.ceil(left / 1000));
    $("clockFill").style.strokeDashoffset = String(94.25 * (1 - left / total));
    el.classList.toggle("low", left < 15000);
  }
  setInterval(tick, 250);
  // the tab bar sticks just under the sky header on wide screens
  new ResizeObserver(() => document.documentElement.style.setProperty("--sky-h", $("sky").offsetHeight + "px")).observe($("sky"));

  // ------------------------------------------------------------- harvest report
  function showReport(round) {
    const g = G(), p = me(), r = p.lastRound, h = g.lastHarvest;
    if (!r || !h || tourOn) return;
    const row = (label, v, cls = "") => `<div class="rrow ${cls}"><span>${label}</span><b>${v > 0 ? "+" : ""}${v}</b></div>`;
    const lines = [];
    const sackOf = pl => (pl.fert ? 2 : 1) * (h.bumper === pl.crop ? 3 : 1);
    for (const pl of r.planted) lines.push(row(`${crop(pl.crop).name}: ${sackOf(pl)} sack${sackOf(pl) > 1 ? "s" : ""} × ${h.sack[pl.crop]}${h.bumper === pl.crop ? " (bumper!)" : ""}`, sackOf(pl) * h.sack[pl.crop], "up"));
    if (!r.planted.length) lines.push(`<p class="hint">Nothing was planted this round.</p>`);
    if (r.sold) lines.push(row("Unstored goods sold back", r.sold));
    if (r.upkeep) lines.push(row("Dues and loan interest", -r.upkeep, "down"));
    const net = r.earned + r.sold - r.upkeep;
    $("reportTitle").textContent = `Round ${round} harvest`;
    $("reportBody").innerHTML = `<p class="hint">${h.bumper ? `Bumper ${crop(h.bumper).name}! ` : ""}${h.mood ? esc(h.mood) + ". " : ""}Sacks: ${g.crops.map(c => `${c.name} ${h.sack[c.id]}`).join(", ")}.</p>
      <div class="rlist">${lines.join("")}${row("This round", net, net >= 0 ? "net up" : "net down")}</div>
      ${(r.notes || []).length ? `<p class="hint small">${esc(r.notes.join(". "))}.</p>` : ""}
      <p class="hint small">Your fields are empty again. Warehouses holding goods stay as they are.</p>`;
    $("reportClose").textContent = `Plan round ${g.round}`;
    $("report").hidden = false;
  }

  // ------------------------------------------------------------- guided tour
  const TOUR = [
    { tab: "farm", sel: "#plots", title: "Your farm", text: "Each plot grows one crop. Tap a plot to plant it. If you're short of water or fertilizer, planting buys what's missing. Fields clear after every harvest, so plan them again each round." },
    { tab: "farm", sel: "#barn", title: "Your barn", text: "Coins, water, fertilizer and loans. Goods that aren't planted or kept in a warehouse plot are sold back cheaply at the harvest." },
    { tab: "farm", sel: ".board", title: "Sack prices", text: "What one sack of each crop sells for. A planted plot gives 1 sack, a fertilized one 2. Prices move at each harvest, and a bumper triples one crop." },
    { tab: "mandi", sel: ".stalls", title: "The mandi", text: "Buy or sell water and fertilizer, borrow 20 coins from the Bank (2 a round interest), or sell it a plot. Prices rise every 5 rounds; a drought makes water 4× dearer." },
    { tab: "deals", sel: ".corkboard", title: "Deal board", text: "Offers between farmers: coins, water, fertilizer, plots, or IOUs paid at the end. Bots bid for land and sell spare plots here, and answer your offers in a few seconds." },
    { tab: "village", sel: "#neighbours", title: "The village", text: "Everyone's farm and goods at a glance. Tap 'Offer a deal' on a neighbour to make them an offer." },
    { tab: "farm", sel: "#tabs", title: "Find your way", text: "Switch between Farm, Mandi, Deals and Village here. A number on Deals means an offer is waiting for you." },
    { tab: "farm", sel: "#chatFab", title: "Village chaupal", text: "Chat with everyone. Deals, weather and harvest news show up here too." },
    { tab: "farm", sel: ".turn-row", title: "Ready for harvest", text: "When your plans are set, tap Ready. The harvest comes when everyone is ready or the clock runs out." },
    { tab: "farm", sel: null, title: "How to win", text: "Keep farming to the end of the season with the most wealth. If you run out of coins and land you become a moneylender. Tap ? any time to see this again." },
  ];
  let tourOn = false, tourI = 0;
  function startTour() { tourOn = true; tourI = 0; $("tour").hidden = false; showStep(); }
  function endTour() { tourOn = false; $("tour").hidden = true; store.set("hm-tour", "done"); goTab("farm"); scrollTo({ top: 0 }); }
  function showStep() {
    const st = TOUR[tourI];
    goTab(st.tab);
    const el = st.sel && document.querySelector(st.sel);
    $("tourStep").textContent = `${tourI + 1} of ${TOUR.length}`;
    $("tourTitle").textContent = st.title; $("tourText").textContent = st.text;
    $("tourNext").textContent = tourI === TOUR.length - 1 ? "Let's farm" : "Next";
    $("tourSkip").hidden = tourI === TOUR.length - 1;
    const spot = $("tourSpot"), tip = $("tourTip");
    if (!el || !el.offsetParent && getComputedStyle(el).position !== "fixed") { spot.className = "spot none"; tip.className = "tip center"; tip.style.cssText = ""; return; }
    const sticky = $("sky").offsetHeight;
    if (!["#chatFab", ".turn-row", "#tabs"].includes(st.sel)) { const r0 = el.getBoundingClientRect(); window.scrollBy({ top: r0.top - sticky - 16, behavior: "instant" }); }
    requestAnimationFrame(() => {
      const r = el.getBoundingClientRect(), pad = 6, vw = innerWidth, vh = innerHeight;
      spot.className = "spot";
      Object.assign(spot.style, { left: r.left - pad + "px", top: r.top - pad + "px", width: r.width + pad * 2 + "px", height: Math.min(r.height, vh - r.top - 20) + pad * 2 + "px" });
      tip.className = "tip";
      const w = Math.min(340, vw - 32), left = Math.max(16, Math.min(vw - w - 16, r.left + r.width / 2 - w / 2));
      const below = r.top + Math.min(r.height, vh * 0.45) + 16;
      tip.style.width = w + "px"; tip.style.left = left + "px";
      if (r.top < vh / 2 && below + 200 < vh) { tip.style.top = below + "px"; tip.style.bottom = ""; }
      else { tip.style.top = ""; tip.style.bottom = Math.max(16, vh - r.top + 16) + "px"; }
    });
  }
  $("tourNext").onclick = () => { if (++tourI >= TOUR.length) endTour(); else showStep(); };
  $("tourSkip").onclick = endTour;
  $("helpBtn").onclick = startTour;
  addEventListener("resize", () => { if (tourOn) showStep(); });

  function renderResults() {
    show("results");
    $("resultList").innerHTML = G().results.map(r => `<div class="place ${r.rank === 1 ? "first" : ""}"><span class="rk">${r.rank}</span><div class="who"><b>${esc(r.name)}</b>${r.id === S.you ? " (you)" : ""}<small>${r.status === "farmer" ? "Still farming" : `Moneylender since round ${r.outRound}`}</small></div><span class="sc">${r.score}</span></div>`).join("");
  }

  // ------------------------------------------------------------- wiring
  $("createBtn").onclick = () => { const n = $("nameIn").value.trim(); if (!n) return toast("Type your name first."); store.set("hm-name", n); send({ t: "create", name: n }); };
  $("joinBtn").onclick = () => { const n = $("nameIn").value.trim(), c = $("codeIn").value.trim(); if (!n) return toast("Type your name first."); if (c.length !== 4) return toast("Village codes have 4 letters."); store.set("hm-name", n); send({ t: "join", name: n, code: c }); };
  $("codeIn").oninput = e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ""); };
  $("addBotBtn").onclick = () => send({ t: "addBot" });
  document.querySelectorAll("#tabs [data-go]").forEach(b => b.onclick = () => { goTab(b.dataset.go); scrollTo({ top: 0 }); });
  $("turnSel").onchange = () => send({ t: "settings", turnSecs: +$("turnSel").value });
  $("reportClose").onclick = () => { $("report").hidden = true; };
  $("report").onclick = e => { if (e.target === $("report")) $("report").hidden = true; };
  $("startBtn").onclick = () => send({ t: "start", start: +$("lengthSel").value });
  const leave = () => { send({ t: "leave" }); store.del("hm-token"); };
  $("leaveLobby").onclick = leave; $("leaveGame").onclick = leave; $("backHome").onclick = leave;
  $("readyBtn").onclick = () => { const p = me(); if (p) act({ type: "ready", value: !p.ready }); };
  document.querySelectorAll("[data-q]").forEach(b => b.onclick = () => { const [k, d] = b.dataset.q.split(":"); qty[k] = Math.max(1, Math.min(50, qty[k] + +d)); $("qW").textContent = qty.w; $("qF").textContent = qty.f; });
  document.querySelectorAll("[data-trade]").forEach(b => b.onclick = () => { const [type, item] = b.dataset.trade.split(":"); act({ type, item, qty: item === "water" ? qty.w : qty.f }); });
  $("loanTake").onclick = () => act({ type: "takeLoan" });
  $("loanRepay").onclick = () => act({ type: "repayLoan" });
  $("sheetClose").onclick = () => { openPlot = null; $("sheet").hidden = true; };
  $("sheet").onclick = e => { if (e.target === $("sheet")) { openPlot = null; $("sheet").hidden = true; } };
  function openDeal(to) {
    $("dealSheet").hidden = false; renderDealRows();
    if (to !== undefined) { renderDealPlots(); $("offerTo").value = to; }
    renderDealPlots();
  }
  $("newDealBtn").onclick = () => openDeal();
  $("dealClose").onclick = () => { $("dealSheet").hidden = true; };
  $("dealSheet").onclick = e => { if (e.target === $("dealSheet")) $("dealSheet").hidden = true; };
  $("offerTo").onchange = renderDealPlots;
  $("offerBtn").onclick = () => {
    const picked = id => [...document.querySelectorAll(`#${id} input:checked`)].map(i => +i.value);
    const to = $("offerTo").value || null;
    act({ type: "offer", to, give: { ...draft.give, plots: picked("gPlots") }, get: { ...draft.get, plots: to ? picked("wPlots") : [] } });
    for (const s of ["give", "get"]) for (const [k] of FIELDS) draft[s][k] = 0;
    $("dealSheet").hidden = true;
    goTab("deals");
  };
  $("chatFab").onclick = () => { chatOpen = true; $("chat").hidden = false; $("chatFab").hidden = true; $("bubble").hidden = true; render(); $("chatIn").focus(); };
  $("chatClose").onclick = () => { chatOpen = false; $("chat").hidden = true; $("chatFab").hidden = false; render(); };
  $("chatForm").onsubmit = e => { e.preventDefault(); const t = $("chatIn").value.trim(); if (t) { act({ type: "chat", text: t }); $("chatIn").value = ""; } };
  $("forceBtn").onclick = () => send({ t: "forceNext" });
  $("endBtn").onclick = () => { confirmEnd = true; render(); };
  document.addEventListener("keydown", e => { if (e.key === "Escape") { if (tourOn) endTour(); $("report").hidden = true; $("sheet").hidden = true; openPlot = null; $("dealSheet").hidden = true; } });

  render();
  connect();
})();
