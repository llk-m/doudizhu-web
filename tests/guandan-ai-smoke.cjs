const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");

let source = fs.readFileSync(path.join(__dirname, "..", "dist", "guandan.js"), "utf8");
assert.match(source, /if\(state\.tributeSession\)\{renderFlushTools\("贡还 · 同花顺"\)/, "tribute phase should keep the four straight-flush suit choices visible");
source = source.replace(/state\.levelRank=LEVELS\[state\.levels\[state\.levelTeam\]\];updateAll\(\);renderControls\(\);\s*window\.__guandan=\{classify,beats,generateMoves,makeDeck,state\};/, "window.__guandan={classify,state,chooseAI,planTurns,removeMove,bombBreakPenalty,generateMoves,chooseAutoReturn,makeDeck};");

const classList = { add() {}, remove() {}, toggle() {} };
const node = new Proxy({ classList, style: { setProperty() {} }, dataset: {}, addEventListener() {}, setAttribute() {}, closest() { return null; } }, { get(target, key) { return key in target ? target[key] : () => {}; }, set(target, key, value) { target[key] = value; return true; } });
const context = {
  console,
  Math,
  Set,
  Map,
  JSON,
  localStorage: { getItem() { return null; }, setItem() {} },
  document: { querySelector() { return node; }, querySelectorAll() { return []; }, addEventListener() {}, documentElement: node },
  window: { addEventListener() {} },
  screen: {},
  innerWidth: 1200,
  innerHeight: 800,
  setTimeout() { return 0; },
  clearTimeout() {},
  setInterval() { return 0; },
  clearInterval() {},
};
vm.runInNewContext(source, context);
const { state, chooseAI, classify, planTurns, removeMove, bombBreakPenalty, generateMoves, chooseAutoReturn, makeDeck } = context.window.__guandan;
let id = 1;
const suits = ["♠", "♥", "♣", "♦"];
const cards = (rank, count) => Array.from({ length: count }, (_, i) => ({ id: id++, rank, suit: suits[i % 4], deck: i > 3 ? 1 : 0 }));
const junk = count => Array.from({ length: count }, (_, i) => ({ id: id++, rank: String(3 + (i % 6)), suit: suits[i % 4], deck: 0 }));
const setTable = (aiHand, targetCards = null) => {
  const target = targetCards || [];
  state.hands = [junk(8), [...target, ...junk(Math.max(0, 8 - target.length))], aiHand, junk(8)];
  state.finished = [];
  state.played = [];
  state.passSignals = [[], [], [], []];
  state.last = target.length ? { player: 1, cards: target, combo: classify(target) } : null;
  state.turn = 2;
};

const triple = cards("4", 3);
setTable([...cards("7", 5), ...cards("8", 5)], triple);
let move = chooseAI(2);
assert.ok(!move || move.combo.bomb, `AI must not answer a triple by tearing a five-card bomb into a triple; got ${move?.combo?.type}`);

setTable([...cards("7", 5), ...cards("8", 5), ...cards("2", 1), ...cards("BJ", 1)]);
move = chooseAI(2);
assert.ok(move.combo.bomb || move.combo.type === "single", "a power hand should release either an intact bomb or a control single without breaking bombs");

setTable([...cards("3", 5), ...cards("4", 1), ...cards("5", 1), ...cards("6", 1), ...cards("7", 1)]);
move = chooseAI(2);
assert.ok(bombBreakPenalty(move, state.hands[2]) > 0 && planTurns(removeMove(state.hands[2], move)) === 1, "AI should allow a profitable split that creates a two-turn finish");

state.levelRank = "2";
const wild = { id: id++, rank: "2", suit: "♥", deck: 0 };
const wildPairRunHand = [...cards("3", 2), ...cards("4", 2), ...cards("5", 1), wild];
assert.ok(generateMoves(wildPairRunHand).some(m => m.combo.type === "pair_run"), "AI must generate a three-pair run completed by a wild card");

const protectedFlush = ["3", "4", "5", "6", "7"].map(rank => ({ id: id++, rank, suit: "♠", deck: 0 }));
const looseEight = { id: id++, rank: "8", suit: "♣", deck: 0 };
assert.equal(chooseAutoReturn([...protectedFlush, looseEight]).id, looseEight.id, "automatic return should preserve a straight flush instead of returning one of its cards");

setTable([...cards("3", 1), ...cards("6", 1), ...cards("BJ", 1)]);
state.hands[3] = cards("9", 1);
state.hands[0] = junk(5);
state.turn = 2;
move = chooseAI(2);
assert.equal(move.cards[0].rank, "BJ", "AI should use a controlling single when the next opponent has one card");

const flushSkeleton = ["3", "4", "5", "6", "7"].map(rank => ({ id: id++, rank, suit: "♠", deck: 0 }));
const expendableFive = { id: id++, rank: "5", suit: "♣", deck: 0 };
setTable([...flushSkeleton, expendableFive], cards("4", 1));
move = chooseAI(2);
assert.equal(move.cards[0].id, expendableFive.id, "AI should spend the duplicate loose card and preserve its straight-flush skeleton");

const normalOpening = [
  ...cards("7", 4), ...cards("8", 4),
  ...cards("3", 1), ...cards("4", 1), ...cards("5", 1), ...cards("6", 1),
  ...cards("9", 1), ...cards("10", 1), ...cards("J", 1), ...cards("Q", 1), ...cards("K", 1), ...cards("A", 1),
  ...cards("SJ", 1), ...cards("BJ", 1)
];
setTable(normalOpening);
for (let attempt = 0; attempt < 1; attempt++) {
  move = chooseAI(2);
  assert.ok(!move.combo.bomb, "AI must not lead a bomb merely because an ordinary opening hand contains two bombs");
  assert.ok(!move.cards.some(card => card.rank === "SJ" || card.rank === "BJ"), "AI must not lead loose jokers from an ordinary opening hand");
}

const fullDeck = makeDeck();
state.hands = [[], [], [], []];
fullDeck.forEach((card, index) => state.hands[index % 4].push(card));
state.last = null;
state.finished = [];
state.played = [];
state.passSignals = [[], [], [], []];
state.turn = 2;
assert.ok(chooseAI(2)?.cards.length, "AI should evaluate a full 27-card opening hand");

console.log("Guandan AI smoke tests passed");
