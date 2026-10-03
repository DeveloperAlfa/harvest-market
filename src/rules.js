// Harvest Market — tabletop-edition constants and price tables.
"use strict";

const CROPS = [
  { id: "ragi", name: "Ragi", water: 2, track: [7, 8, 8, 9, 9, 10, 10], move: 0.25 },
  { id: "rice", name: "Rice", water: 3, track: [11, 11, 12, 13, 14, 15, 15], move: 0.35 },
  { id: "turmeric", name: "Turmeric", water: 3, track: [9, 11, 12, 13, 14, 15, 17], move: 0.5 },
  { id: "cotton", name: "Cotton", water: 4, track: [12, 14, 15, 17, 19, 20, 22], move: 0.7 },
  { id: "sugarcane", name: "Sugarcane", water: 5, track: [14, 17, 19, 21, 23, 25, 28], move: 0.8 },
];
const CROP = Object.fromEntries(CROPS.map(c => [c.id, c]));

const R = {
  START_CASH: 30,
  START_PLOTS: 3,
  ROUNDS: 35,
  ROUNDS_PER_PERIOD: 5,
  BOOM_AT: 350,
  LOAN_SIZE: 20,
  LOAN_INTEREST: 2,
  IDLE_UPKEEP: 1,
  WAREHOUSE_UPKEEP: 2,
  WAREHOUSE_WATER: 10,
  WAREHOUSE_FERT: 10,
  DEAL_FEE: 1,
  MONEYLENDER_PURSE: 15,
  // per Price Period (1..7)
  WATER: [3, 4, 4, 5, 6, 6, 7],
  FERT: [5, 6, 6, 7, 8, 8, 9],       // price per bag (water price + 2)
  BONUS: [0, 1, 2, 3, 4, 5, 6],     // added to every sack price, one step per season
  LAND_X: 4,           // Bank buys a plot for LAND_X x water
  FERT_PER_BARREL: true,  // if true: fertilizing a plot takes one bag per barrel of water it needs
  UPKEEP_SCALES: true,  // if true: idle = water price, warehouse = water price + 1
};

// Seven price seasons spread over the game: 5 rounds each in the 35-round game, about 3½ in the 25-round game.
const period = (r, rounds = R.ROUNDS) => Math.min(7, Math.floor((r - 1) * 7 / rounds) + 1);

function prices(round, drought, rounds = R.ROUNDS) {
  const k = period(round, rounds), w = R.WATER[k - 1], f = R.FERT[k - 1];
  return {
    period: k,
    water: drought ? 4 * w : w,
    waterNormal: w,
    waterDrought: 4 * w,
    fert: f,
    buyWater: w - 1,
    buyFert: f - 1,
    land: R.LAND_X * w,
    bonus: R.BONUS[k - 1],
  };
}

// Small seedable RNG (mulberry32) so games can be replayed.
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(a, rand) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 20 Harvest cards: 18 normal + Boom market + Glut; 10 carry a bumper (2 per crop).
function harvestDeck(rand) {
  const cards = [];
  for (let i = 0; i < 18; i++) {
    const moves = {};
    for (const c of CROPS) moves[c.id] = rand() < c.move ? (rand() < 0.5 ? 1 : -1) : 0;
    cards.push({ moves, mood: null, bumper: null });
  }
  const up = {}, down = {};
  for (const c of CROPS) { up[c.id] = 1; down[c.id] = -1; }
  cards.push({ moves: up, mood: "Boom market: all crops up", bumper: null });
  cards.push({ moves: down, mood: "Glut: all crops down", bumper: null });
  const slots = shuffle([...Array(20).keys()], rand).slice(0, 10);
  CROPS.flatMap(c => [c.id, c.id]).forEach((id, i) => { cards[slots[i]].bumper = id; });
  return shuffle(cards, rand);
}

const fertBags = cropId => R.FERT_PER_BARREL ? CROP[cropId].water : 1;

module.exports = { fertBags, CROPS, CROP, R, period, prices, rng, shuffle, harvestDeck };
