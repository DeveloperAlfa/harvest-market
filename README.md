# Harvest Market Online

Play the Harvest Market card game with friends in the browser, phone or laptop. Empty seats can be filled with bots.

- **One server** (Node.js) runs the rules, so nobody can cheat or miscount.
- **Villages** are joined with a 4-letter code. 2–5 farmers per village, humans or bots.
- **Live:** every action, deal and chat message reaches everyone instantly (WebSockets).
- **Pacing:** a round timer (host picks 1–3 minutes or none; round 1 gets an extra minute), bots that take a few seconds to think and move one step at a time, and a short "harvest is coming in" pause followed by a harvest report.
- **Plans reset:** fields are empty again after every harvest (stocked warehouses stay). Planting buys any missing water or fertilizer; if goods are later sold or traded away, the newest plans fall back to empty.
- **First-time tour:** an 8-step guided tour on the first game; the ? button replays it.
- **Rules:** the tabletop edition, as tuned with 1,000 simulated games: crop prices, fertilizer per barrel, dues that rise with the water price, Boom at 200.

## Run it on your laptop

```bash
npm install
npm start            # http://localhost:8080
npm test             # rules engine + live server tests
```

Friends on the same Wi-Fi can open `http://<your-laptop-ip>:8080`.

## Put it online for free

Nothing here needs a paid service: no database, no accounts, no API keys. Games live in the server's memory, so restarting the server ends any games in progress. Free tiers change often, so check each provider's current terms before relying on one.

| Option | Cost | Good for | Notes |
|---|---|---|---|
| **Cloudflare Tunnel** from your laptop (`cloudflared tunnel --url http://localhost:8080`) | Free, no account needed for a quick tunnel | Game nights | Gives a public `https://…trycloudflare.com` link while your laptop runs the server. |
| **Render** (Web Service, free instance) | Free | An always-available link | Connect the GitHub repo; build `npm install`, start `npm start`. Free instances sleep when idle, so the first visit takes about a minute to wake up. |
| **Koyeb** (free instance) | Free | Same as Render | Deploy from GitHub with the same commands. |
| Fly.io / Railway | Usually needs a card or trial credit | Later, when it grows | Not needed for a friends prototype. |

A custom domain (optional) is the only thing you might pay for, typically a few hundred rupees a year.

## How it's built

```
server.js          rooms, join codes, WebSocket messages, bots, reconnects
src/rules.js       crops, prices per season, Harvest deck, seeded RNG
src/engine.js      the rules engine: actions, deals, harvest, dues, going broke, scoring
src/bot.js         scripted bot farmer
public/            the game client (index.html, style.css, app.js), no build step
test/              engine tests (incl. 200 full bot games) and a live two-player server test
```

The engine is the same one the AI benchmark will use. Bots and LLM agents plug into `game.act(playerId, action)` exactly like human players do.

## What's next (from the MMO plan)

1. "Autopilot" for players who go quiet (the bot plays their turn).
2. Accounts and ratings (Glicko/TrueSkill), then matchmaking with strangers.
3. Saving games to a database so restarts don't end them.
4. LLM-powered bot farmers that negotiate in chat.
