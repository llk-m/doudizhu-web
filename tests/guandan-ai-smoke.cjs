const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");

let source = fs.readFileSync(path.join(__dirname, "..", "dist", "guandan.js"), "utf8");
source = source.replace(/state\.levelRank=LEVELS\[state\.levels\[state\.levelTeam\]\];updateAll\(\);renderControls\(\);\s*window\.__guandan=\{classify,beats,generateMoves,makeDeck,state\};/, "window.__guandan={classify,state,chooseAI,planTurns,removeMove,bombBreakPenalty};");

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
const { state, chooseAI, classify, planTurns, removeMove, bombBreakPenalty } = context.window.__guandan;
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
assert.equal(move.combo.type, "single", "AI should lead a control single before two intact bombs");

setTable([...cards("3", 5), ...cards("4", 1), ...cards("5", 1), ...cards("6", 1), ...cards("7", 1)]);
move = chooseAI(2);
assert.ok(bombBreakPenalty(move, state.hands[2]) > 0 && planTurns(removeMove(state.hands[2], move)) === 1, "AI should allow a profitable split that creates a two-turn finish");

console.log("Guandan AI smoke tests passed");
