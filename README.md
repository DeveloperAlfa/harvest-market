# Harvest Market Online

Play the Harvest Market card game with friends in the browser, phone or laptop. Empty seats can be filled with bots.

- **One server** (Node.js) runs the rules, so nobody can cheat or miscount.
- **Villages** are joined with a 4-letter code. 2–5 farmers per village, humans or bots.
- **Live:** every action, deal and chat message reaches everyone instantly (WebSockets).
- **Pacing:** a round timer (host picks 1–3 minutes or none; round 1 gets an extra minute), bots that take a few seconds to think and move one step at a time, and a short "harvest is coming in" pause followed by a harvest report.
- **A turn in three steps:** plan your fields (plant, warehouse or leave empty), then buy the water they need, then choose which to fertilize. Fields are empty again after every harvest (stocked warehouses stay). A field with no water stays empty; one short of fertilizer is planted unfertilized.
- **Round maths:** the turn panel always shows what you're spending (water, fertilizer, dues), the expected return at today's sack prices, and the net. Each field choice shows its own cost, return and gain over leaving it empty.
- **Autopilot:** "Ready, and repeat this plan every round" replays your field plan each round, buying the water and fertilizer it needs. It stops by itself when a drought starts or coins run short.
- **Tabs:** Farm (plots, barn, sack prices), Mandi (water, fertilizer, Bank), Deals (offer board, with a badge when something waits for you) and Village (neighbours, "Offer a deal"). A bottom tab bar on phones.
- **Bots that trade:** they sell spare plots (to farmers first, the Bank if they must), bid on good plots when rich, offer coins for IOUs as Moneylenders, and answer offers within a few seconds, with a word in chat.
- **First-time tour:** a 10-step guided tour on the first game; the ? button replays it.
- **Rules:** the tabletop edition, rebalanced online from thousands of simulated bot games (see *Balance* below).

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

## Balance

Prices were tuned so every crop stays worth planting all game and no starting crop is favoured. In 2,000 simulated bot games per mode:

| | Full · 35 rounds | Short · 25 rounds |
|---|---|---|
| Win rate by starting crop (Ragi, Rice, Turmeric, Cotton, Sugarcane) | 26 / 27 / 26 / 24 / 21% | 28 / 27 / 27 / 24 / 20% |
| Fields still planted in the last third, by crop | 65–71% | 61–69% |
| Farmers going broke per game | 1.2 | 1.2 |

- Starting coins 30. Water 3, 4, 4, 5, 6, 6, 7 across the seven seasons; fertilizer is water + 2 per bag; every sack gains +1 per season.
- Crop tracks: Ragi 7–10, Rice 11–15, Turmeric 9–17, Cotton 12–22, Sugarcane 14–28 (middle 9 / 13 / 13 / 17 / 21).
- Boom at 350 coins.
- The short game runs through all seven seasons, about 3½ rounds each, instead of skipping the first ten rounds.

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
