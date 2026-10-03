(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const SUITS = ["♠", "♥", "♣", "♦"];
  const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
  const NAMES = ["你", "阿明", "小舒", "小雅"];
  const LEVELS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
  const TYPE_NAME = {single:"单张",pair:"对子",triple:"三张",triple_pair:"三带二",straight:"顺子",pair_run:"三连对",triple_run:"钢板",bomb:"炸弹",straight_flush:"同花顺",joker_bomb:"四王炸"};
  const state = {hands:[[],[],[],[]], selected:new Set(), turn:0, last:null, passes:0, finished:[], played:[], playHistory:[], passSignals:[[],[],[],[]], tributeSession:null, running:false, timer:0, levels:[0,0], levelTeam:0, levelRank:"2", starter:0, lastRanking:null, tributeText:"", manualGroups:[], flushCycle:{"♠":0,"♥":0,"♣":0,"♦":0}};
  const DEFAULT_AI_WEIGHTS={turnLate:48,turnNormal:31,futureShort:34,futureLong:12,bombNormal:112,bombDanger:10,bombPower:24,bombPlanGain:22,controlDanger:-48,controlEarly:15,controlNormal:-10,structure:1,flushLink:2,randomTolerance:4.5,randomTemperature:3.2};
  const AI_WEIGHTS={...DEFAULT_AI_WEIGHTS,...Object.fromEntries(Object.entries(window.GUANDAN_AI_WEIGHTS||{}).filter(([,v])=>Number.isFinite(v)))};
  const saved = JSON.parse(localStorage.getItem("guandan-progress") || "null");
  if (saved && Array.isArray(saved.levels)) { state.levels = saved.levels.map(v => Math.max(0, Math.min(12, v|0))); state.levelTeam = saved.levelTeam === 1 ? 1 : 0; if(Array.isArray(saved.ranking)&&saved.ranking.length===4)state.lastRanking=saved.ranking; }

  const music={enabled:localStorage.getItem("gd-music")==="on",ctx:null,timer:null,beat:0};
  const MELODY=[0,3,7,10,7,3,5,7,12,10,7,5,3,0,3,5,7,5,3,-2];
  function pluck(freq,when,duration=.24,volume=.025,type="triangle"){const osc=music.ctx.createOscillator(),gain=music.ctx.createGain();osc.type=type;osc.frequency.setValueAtTime(freq,when);gain.gain.setValueAtTime(.0001,when);gain.gain.exponentialRampToValueAtTime(volume,when+.012);gain.gain.exponentialRampToValueAtTime(.0001,when+duration);osc.connect(gain).connect(music.ctx.destination);osc.start(when);osc.stop(when+duration+.03);}
  function musicTick(){if(!music.enabled||!music.ctx)return;const now=music.ctx.currentTime+.02,n=MELODY[music.beat%MELODY.length];pluck(220*Math.pow(2,n/12),now,.27,.026,"triangle");if(music.beat%4===0)pluck(110*Math.pow(2,[0,5,3,7][Math.floor(music.beat/4)%4]/12),now,.5,.018,"sine");if(music.beat%4===2)pluck(880,now,.05,.005,"square");music.beat++;}
  function updateMusicButton(){const b=$("#gd-music");if(!b)return;b.classList.toggle("music-on",music.enabled);b.setAttribute("aria-pressed",String(music.enabled));b.setAttribute("aria-label",music.enabled?"关闭背景音乐":"开启背景音乐");b.title=music.enabled?"关闭背景音乐":"开启背景音乐";}
  async function startMusic(){if(!music.ctx)music.ctx=new (window.AudioContext||window.webkitAudioContext)();await music.ctx.resume();clearInterval(music.timer);musicTick();music.timer=setInterval(musicTick,285);}
  function stopMusic(){clearInterval(music.timer);music.timer=null;if(music.ctx?.state==="running")music.ctx.suspend();}
  async function toggleMusic(){music.enabled=!music.enabled;localStorage.setItem("gd-music",music.enabled?"on":"off");updateMusicButton();if(music.enabled)await startMusic();else stopMusic();}

  function team(p){ return p % 2; }
  function partner(p){ return (p + 2) % 4; }
  function rankValue(rank){
    if(rank === "SJ") return 16;
    if(rank === "BJ") return 17;
    if(rank === state.levelRank) return 15;
    return RANKS.indexOf(rank) + 2;
  }
  function naturalValue(rank){ return rank === "SJ" ? 16 : rank === "BJ" ? 17 : RANKS.indexOf(rank) + 2; }
  function sortHand(hand){ return hand.sort((a,b) => rankValue(b.rank)-rankValue(a.rank) || SUITS.indexOf(a.suit)-SUITS.indexOf(b.suit)); }
  function makeDeck(){
    const deck=[]; let id=0;
    for(let d=0;d<2;d++){
      for(const rank of RANKS) for(const suit of SUITS) deck.push({id:id++,rank,suit,deck:d});
      deck.push({id:id++,rank:"SJ",suit:"小王",deck:d},{id:id++,rank:"BJ",suit:"大王",deck:d});
    }
    for(let i=deck.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [deck[i],deck[j]]=[deck[j],deck[i]]; }
    return deck;
  }
  function groups(cards){ const m=new Map(); for(const c of cards){ if(!m.has(c.rank))m.set(c.rank,[]); m.get(c.rank).push(c); } return m; }
  function consecutive(vals){ return vals.every((v,i)=>i===0||v===vals[i-1]+1); }
  function baseClassify(cards){
    const n=cards.length; if(!n) return null;
    const g=groups(cards), entries=[...g.entries()], counts=entries.map(x=>x[1].length).sort((a,b)=>b-a);
    const jokerCount=cards.filter(c=>c.rank==="SJ"||c.rank==="BJ").length;
    if(n===4 && jokerCount===4) return {type:"joker_bomb",size:4,value:200,bomb:true};
    if(g.size===1 && n>=4) return {type:"bomb",size:n,value:100+n,bomb:true,main:rankValue(cards[0].rank)};
    if(n===5 && cards.every(c=>c.suit===cards[0].suit) && isStraightRanks(entries.map(e=>e[0]))) return {type:"straight_flush",size:5,value:105.5,bomb:true,main:straightHigh(entries.map(e=>e[0]))};
    if(n===1) return {type:"single",size:1,value:rankValue(cards[0].rank),main:rankValue(cards[0].rank)};
    if(n===2 && g.size===1) return {type:"pair",size:2,value:rankValue(cards[0].rank),main:rankValue(cards[0].rank)};
    if(n===3 && g.size===1) return {type:"triple",size:3,value:rankValue(cards[0].rank),main:rankValue(cards[0].rank)};
    if(n===5 && counts.length===2 && counts[0]===3 && counts[1]===2){ const e=entries.find(x=>x[1].length===3); return {type:"triple_pair",size:5,value:rankValue(e[0]),main:rankValue(e[0])}; }
    if(n===5 && isStraightRanks(entries.map(e=>e[0]))) return {type:"straight",size:5,value:straightHigh(entries.map(e=>e[0])),main:straightHigh(entries.map(e=>e[0]))};
    if(n===6 && entries.length===3 && entries.every(e=>e[1].length===2) && isNaturalRun(entries.map(e=>e[0]))) { const v=Math.max(...entries.map(e=>naturalValue(e[0]))); return {type:"pair_run",size:6,value:v,main:v}; }
    if(n===6 && entries.length===2 && entries.every(e=>e[1].length===3) && isNaturalRun(entries.map(e=>e[0]))) { const v=Math.max(...entries.map(e=>naturalValue(e[0]))); return {type:"triple_run",size:6,value:v,main:v}; }
    return null;
  }
  function classify(cards){
    const wildIndexes=[]; cards.forEach((c,i)=>{if(c.rank===state.levelRank&&c.suit==="♥")wildIndexes.push(i);});
    const natural=baseClassify(cards); if(!wildIndexes.length)return natural;
    let best=natural, tries=0; const candidates=[...RANKS], nonWild=cards.filter((_,i)=>!wildIndexes.includes(i));
    const copy=cards.map(c=>({...c}));
    const consider=()=>{const combo=baseClassify(copy);if(combo&&(!best||combo.bomb&&!best.bomb||combo.bomb===best.bomb&&(combo.value>best.value||combo.value===best.value&&(combo.main||0)>(best.main||0))))best=combo;};
    (function assign(depth){
      if(tries>420)return;
      if(depth===wildIndexes.length){tries++;consider();const suit=nonWild.length&&nonWild.every(c=>c.suit===nonWild[0].suit)?nonWild[0].suit:null;if(suit){wildIndexes.forEach(i=>copy[i].suit=suit);consider();wildIndexes.forEach(i=>copy[i].suit="♥");}return;}
      for(const rank of candidates){copy[wildIndexes[depth]].rank=rank;assign(depth+1);}
    })(0);
    return best;
  }
  function isNaturalRun(ranks){ if(ranks.some(r=>r==="SJ"||r==="BJ"))return false; const v=ranks.map(naturalValue).sort((a,b)=>a-b); return new Set(v).size===v.length && consecutive(v); }
  function isStraightRanks(ranks){
    if(ranks.length!==5 || ranks.some(r=>r==="SJ"||r==="BJ"))return false;
    const v=[...new Set(ranks.map(naturalValue))].sort((a,b)=>a-b); if(v.length!==5)return false;
    return consecutive(v) || v.join(",")==="2,3,4,5,14";
  }
  function straightHigh(ranks){ const v=ranks.map(naturalValue).sort((a,b)=>a-b); return v.join(",")==="2,3,4,5,14" ? 5 : v[v.length-1]; }
  function beats(a,b){
    if(!a||!b)return false;
    if(a.type==="joker_bomb") return b.type!=="joker_bomb";
    if(b.type==="joker_bomb") return false;
    if(a.bomb && !b.bomb)return true;
    if(!a.bomb && b.bomb)return false;
    if(a.bomb&&b.bomb){ if(a.value!==b.value)return a.value>b.value; return (a.main||0)>(b.main||0); }
    return a.type===b.type && a.size===b.size && a.value>b.value;
  }
  function combinations(arr,k,limit=200){
    const out=[]; const pick=[];
    (function rec(start){ if(out.length>=limit)return; if(pick.length===k){out.push([...pick]);return;} for(let i=start;i<=arr.length-(k-pick.length);i++){pick.push(arr[i]);rec(i+1);pick.pop();if(out.length>=limit)return;} })(0);
    return out;
  }
  function uniqueMoves(moves){ const seen=new Set(); return moves.filter(m=>{const key=m.map(c=>c.id).sort((a,b)=>a-b).join("-");if(seen.has(key))return false;seen.add(key);return true;}); }
  function cardLinkScore(card,hand){
    if(card.rank==="SJ"||card.rank==="BJ")return 0;const value=naturalValue(card.rank);
    const suited=new Set(hand.filter(c=>c.suit===card.suit&&c.rank!=="SJ"&&c.rank!=="BJ").map(c=>naturalValue(c.rank)));let score=0;
    for(let start=Math.max(2,value-4);start<=Math.min(10,value);start++){let linked=0;for(let v=start;v<start+5;v++)if(suited.has(v))linked++;if(linked>=3)score+=linked===5?8:linked===4?3:1;}
    if(suited.has(14)&&[2,3,4,5,14].includes(value)){const low=[2,3,4,5,14].filter(v=>suited.has(v)).length;if(low>=3)score+=low===5?8:low===4?3:1;}
    return score;
  }
  function preferLoose(cards,hand){return [...cards].sort((a,b)=>cardLinkScore(a,hand)-cardLinkScore(b,hand)||SUITS.indexOf(a.suit)-SUITS.indexOf(b.suit));}
  function generateMoves(hand, target=null){
    const g=groups(hand), moves=[];
    for(const [,cs] of g){
      const loose=preferLoose(cs,hand),linked=[...loose].reverse(),keepVariants=!!target||hand.length<=16;moves.push([loose[0]]);if(keepVariants&&linked[0].id!==loose[0].id)moves.push([linked[0]]);if(cs.length>=2){moves.push(loose.slice(0,2));if(keepVariants)moves.push(linked.slice(0,2));}if(cs.length>=3){moves.push(loose.slice(0,3));if(keepVariants)moves.push(linked.slice(0,3));}
      if(cs.length>=4) for(let n=4;n<=cs.length;n++)moves.push(cs.slice(0,n));
    }
    const triples=[...g.values()].filter(x=>x.length>=3), pairs=[...g.values()].filter(x=>x.length>=2);
    for(const t of triples) for(const p of pairs) if(t[0].rank!==p[0].rank)moves.push([...preferLoose(t,hand).slice(0,3),...preferLoose(p,hand).slice(0,2)]);
    const naturals=[...g.entries()].filter(([r])=>r!=="SJ"&&r!=="BJ").sort((a,b)=>naturalValue(a[0])-naturalValue(b[0]));
    const seqRanks=[...new Set(naturals.map(x=>naturalValue(x[0])))];
    for(let i=0;i<=seqRanks.length-5;i++){const vals=seqRanks.slice(i,i+5);if(consecutive(vals)){const es=vals.map(v=>naturals.find(x=>naturalValue(x[0])===v));moves.push(es.map(e=>preferLoose(e[1],hand)[0]));for(const s of SUITS)if(es.every(e=>e[1].some(c=>c.suit===s)))moves.push(es.map(e=>e[1].find(c=>c.suit===s)));}}
    const lowAce=[2,3,4,5,14].map(v=>naturals.find(x=>naturalValue(x[0])===v)); if(lowAce.every(Boolean)){moves.push(lowAce.map(e=>preferLoose(e[1],hand)[0]));for(const s of SUITS)if(lowAce.every(e=>e[1].some(c=>c.suit===s)))moves.push(lowAce.map(e=>e[1].find(c=>c.suit===s)));}
    for(let i=0;i<naturals.length;i++){
      const p3=naturals.slice(i,i+3); if(p3.length===3&&p3.every(e=>e[1].length>=2)&&consecutive(p3.map(e=>naturalValue(e[0]))))moves.push(p3.flatMap(e=>preferLoose(e[1],hand).slice(0,2)));
      const t2=naturals.slice(i,i+2); if(t2.length===2&&t2.every(e=>e[1].length>=3)&&consecutive(t2.map(e=>naturalValue(e[0]))))moves.push(t2.flatMap(e=>preferLoose(e[1],hand).slice(0,3)));
    }
    const wilds=hand.filter(c=>c.rank===state.levelRank&&c.suit==="♥"), plain=hand.filter(c=>!wilds.some(w=>w.id===c.id)), plainGroups=groups(plain);
    if(wilds.length){
      for(const [,cs] of plainGroups){
        for(let size=2;size<=Math.min(8,cs.length+wilds.length);size++){
          const need=Math.max(0,size-cs.length);if(need>0&&need<=wilds.length)moves.push([...cs,...wilds.slice(0,need)]);
        }
      }
      const windows=[];for(let low=2;low<=10;low++)windows.push([low,low+1,low+2,low+3,low+4]);windows.push([2,3,4,5,14]);
      for(const vals of windows){const chosen=[],missing=[];for(const v of vals){const e=[...plainGroups.entries()].find(([r])=>naturalValue(r)===v);e?chosen.push(e[1][0]):missing.push(v);}if(missing.length&&missing.length<=wilds.length)moves.push([...chosen,...wilds.slice(0,missing.length)]);for(const suit of SUITS){const suited=[],suitMissing=[];for(const v of vals){const card=plain.find(c=>naturalValue(c.rank)===v&&c.suit===suit);card?suited.push(card):suitMissing.push(v);}if(suitMissing.length&&suitMissing.length<=wilds.length)moves.push([...suited,...wilds.slice(0,suitMissing.length)]);}}
      const rankEntries=[...plainGroups.values()];
      for(const t of rankEntries)for(const p of rankEntries){if(t[0].rank===p[0].rank)continue;for(let useT=0;useT<=wilds.length;useT++){const useP=wilds.length-useT;if(t.length+useT>=3&&p.length+useP>=2&&useT<=3&&useP<=2)moves.push([...t.slice(0,3-useT),...p.slice(0,2-useP),...wilds]);}}
      const addWildRun=(need,length)=>{for(let low=2;low<=14-length+1;low++){const vals=Array.from({length},(_,i)=>low+i),picked=[];let missing=0;for(const v of vals){const entry=[...plainGroups.entries()].find(([r])=>naturalValue(r)===v),take=Math.min(need,entry?.[1].length||0);if(entry)picked.push(...entry[1].slice(0,take));missing+=need-take;}if(missing>0&&missing<=wilds.length)moves.push([...picked,...wilds.slice(0,missing)]);}};
      addWildRun(2,3);addWildRun(3,2);
    }
    const jokers=hand.filter(c=>c.rank==="SJ"||c.rank==="BJ"); if(jokers.length===4)moves.push(jokers);
    const valid=uniqueMoves(moves).map(cards=>({cards,combo:classify(cards)})).filter(x=>x.combo);
    return target ? valid.filter(x=>beats(x.combo,target.combo)) : valid;
  }
  function removeMove(hand,move){const ids=new Set(move.cards.map(c=>c.id));return hand.filter(c=>!ids.has(c.id));}
  function bombBreakPenalty(move,hand){
    const handGroups=groups(hand);let penalty=0;
    for(const [rank,cards] of handGroups){const used=move.cards.filter(c=>c.rank===rank).length;if(cards.length>=4&&used>0&&used<cards.length)penalty+=34+(cards.length-used)*7;}
    const jokers=hand.filter(c=>c.rank==="SJ"||c.rank==="BJ"),usedJokers=move.cards.filter(c=>c.rank==="SJ"||c.rank==="BJ").length;if(jokers.length===4&&usedJokers>0&&usedJokers<4)penalty+=58;
    return penalty;
  }
  function moveShape(move){const bonus={straight:25,pair_run:31,triple_run:34,triple_pair:23,triple:8,pair:5,single:0,bomb:18,straight_flush:30,joker_bomb:35};return move.cards.length*18+(bonus[move.combo.type]||0)-move.cards.filter(c=>c.rank===state.levelRank&&c.suit==="♥").length*13;}
  function quickTurns(hand){
    if(!hand.length)return 0;const count=new Map([...groups(hand)].map(([r,c])=>[r,c.length]));let turns=0;
    if((count.get("SJ")||0)+(count.get("BJ")||0)===4){turns++;count.set("SJ",0);count.set("BJ",0);}for(const [rank,n] of count)if(n>=4){turns++;count.set(rank,0);}
    const takeRuns=(need,length)=>{let found=true;while(found){found=false;const vals=RANKS.map(naturalValue);for(let i=0;i<=vals.length-length;i++){const run=vals.slice(i,i+length),ranks=run.map(v=>RANKS.find(r=>naturalValue(r)===v));if(ranks.every(r=>(count.get(r)||0)>=need)){ranks.forEach(r=>count.set(r,count.get(r)-need));turns++;found=true;break;}}}};
    takeRuns(3,2);takeRuns(2,3);takeRuns(1,5);const triples=[...count].filter(([,n])=>n===3).map(([r])=>r),pairs=[...count].filter(([,n])=>n===2).map(([r])=>r);while(triples.length&&pairs.length){count.set(triples.pop(),0);count.set(pairs.pop(),0);turns++;}for(const n of count.values())if(n>0)turns++;return turns;
  }
  function planTurns(hand,memo=new Map(),depth=0,budget=null){
    if(!hand.length)return 0;const maxDepth=budget??(hand.length<=16?6:hand.length<=20?4:2),key=`${maxDepth}|${depth}|${hand.map(c=>c.id).sort((a,b)=>a-b).join(".")}`;if(memo.has(key))return memo.get(key);if(depth>=maxDepth){const q=quickTurns(hand);memo.set(key,q);return q;}let moves=generateMoves(hand);if(moves.some(m=>m.cards.length===hand.length)){memo.set(key,1);return 1;}
    const limit=hand.length<=12?28:hand.length<=16?22:14,candidates=moves.sort((a,b)=>moveShape(b)-bombBreakPenalty(b,hand)-moveShape(a)+bombBreakPenalty(a,hand)).slice(0,limit);let best=99;for(const move of candidates){const estimate=1+planTurns(removeMove(hand,move),memo,depth+1,maxDepth);if(estimate<best)best=estimate;if(best<=2)break;}memo.set(key,best);return best;
  }
  function structureDamage(move,hand,weights=AI_WEIGHTS){
    let cost=0;const handGroups=groups(hand);for(const [rank,cards] of handGroups){const used=move.cards.filter(c=>c.rank===rank).length;if(!used||used===cards.length)continue;if(cards.length===3)cost+=16;else if(cards.length===2)cost+=9;}
    cost+=bombBreakPenalty(move,hand);cost+=move.cards.filter(c=>c.rank===state.levelRank&&c.suit==="♥").length*20;cost+=move.cards.reduce((n,c)=>n+cardLinkScore(c,hand)*weights.flushLink,0);return cost;
  }
  function powerProfile(hand){const gs=groups(hand),rankBombs=[...gs.values()].filter(cs=>cs.length>=4),jokers=hand.filter(c=>c.rank==="SJ"||c.rank==="BJ"),jokerBomb=jokers.length===4;return{bombs:rankBombs.length+(jokerBomb?1:0),cards:rankBombs.reduce((n,cs)=>n+cs.length,0)+(jokerBomb?4:0),looseJokers:jokerBomb?0:jokers.length};}
  function unseenRankCount(rank,p){const total=rank==="SJ"||rank==="BJ"?2:8,played=state.played.filter(c=>c.rank===rank).length,own=state.hands[p].filter(c=>c.rank===rank).length;return Math.max(0,total-played-own);}
  function likelyControl(move,p){
    const c=move.combo;if(c.type==="joker_bomb")return true;if(c.bomb)return false;const need=c.type==="pair"?2:c.type==="triple"||c.type==="triple_pair"?3:c.type==="single"?1:0;if(!need)return false;
    const allRanks=[...RANKS,"SJ","BJ"].filter(r=>rankValue(r)>(c.main||c.value));if(allRanks.some(r=>unseenRankCount(r,p)>=need))return false;
    const opponents=[0,1,2,3].filter(x=>team(x)!==team(p)&&state.hands[x].length);return opponents.every(x=>state.passSignals[x].some(s=>s.type===c.type&&s.size===c.size&&s.value<=c.value))||allRanks.every(r=>unseenRankCount(r,p)<need);
  }
  function moveCost(move,hand,target,p=0,context={}){
    const w=context.weights||AI_WEIGHTS,c=move.combo,remain=removeMove(hand,move),memo=context.memo||new Map(),early=hand.length>14;if(!remain.length)return-100000;const turns=context.fast?quickTurns(remain):context.trainingDepth===null||context.trainingDepth===undefined?planTurns(remain,memo):planTurns(remain,memo,0,context.trainingDepth);let score=turns*(hand.length<=10?w.turnLate:w.turnNormal)-move.cards.length*(early?2:4);
    score+=(c.main||c.value)*(target?(early?1.35:.9):(early?1.7:.65))+structureDamage(move,hand,w)*w.structure;score+=move.cards.filter(x=>rankValue(x.rank)>=15).length*(early?18:target?10:13);
    const power=context.power||powerProfile(hand),planGain=(context.baseTurns||turns+1)-turns,powerHand=power.bombs>=2&&power.cards>=Math.ceil(hand.length*.65);
    if(c.bomb)score+=context.closesSoon?-30:context.danger?w.bombDanger:!target&&powerHand?Math.max(45,w.bombPower):planGain>=2?35:w.bombNormal;const controls=likelyControl(move,p);if(controls)score+=context.danger?w.controlDanger:early?w.controlEarly:w.controlNormal;if(turns<=1&&controls)score-=70;
    if(!target&&powerHand&&c.bomb)score-=Math.min(35,power.cards*2);if(target&&c.bomb&&planGain>0)score-=planGain*w.bombPlanGain;
    if(!target&&early&&c.type==="single"&&groups(hand).get(move.cards[0].rank)?.length===1)score-=18;if(!target&&early&&c.type==="pair"&&groups(hand).get(move.cards[0].rank)?.length===2)score-=14;
    if(!target&&c.type==="single"&&context.enemyOne)score+=likelyControl(move,p)?10:190;if(!target&&c.type==="pair"&&context.enemyTwo)score+=120;
    if(!target&&context.mateNext&&context.mateLow){const mateCards=state.hands[partner(p)].length;if(c.type==="single"&&mateCards===1)score+=(c.main||c.value)*-4;if(c.type==="pair"&&mateCards===2)score+=(c.main||c.value)*-3;}
    return score;
  }
  function chooseAI(p,weights=AI_WEIGHTS){
    const hand=state.hands[p],target=state.last,moves=generateMoves(hand,target);if(!moves.length)return null;const finish=moves.find(m=>m.cards.length===hand.length);if(finish)return finish;
    const activeEnemies=[0,1,2,3].filter(x=>team(x)!==team(p)&&state.hands[x].length),enemyMin=Math.min(...activeEnemies.map(x=>state.hands[x].length)),next=nextActive(p),nextIsEnemy=next>=0&&team(next)!==team(p),mateNext=next===partner(p),mateLow=state.hands[partner(p)].length<=2,enemyOne=nextIsEnemy&&state.hands[next].length===1,enemyTwo=nextIsEnemy&&state.hands[next].length===2;
    if(target&&team(target.player)===team(p)){
      if(enemyMin<=1&&nextIsEnemy){const block=moves.filter(m=>!m.combo.bomb&&likelyControl(m,p)).sort((a,b)=>(a.combo.main||a.combo.value)-(b.combo.main||b.combo.value))[0];if(block)return block;}
      if(hand.length<=10&&state.hands[target.player].length>6){const memo=new Map(),takeover=moves.filter(m=>!m.combo.bomb&&likelyControl(m,p)&&planTurns(removeMove(hand,m),memo)<=1).sort((a,b)=>structureDamage(a,hand)-structureDamage(b,hand))[0];if(takeover)return takeover;}
      return null;
    }
    if(!target&&state.hands[partner(p)].length<=2){const mateCards=state.hands[partner(p)],mateCombo=classify(mateCards);if(mateCombo){const feed=moves.filter(m=>!m.combo.bomb&&m.combo.type===mateCombo.type&&m.combo.size===mateCombo.size&&beats(mateCombo,m.combo)).sort((a,b)=>(a.combo.main||a.combo.value)-(b.combo.main||b.combo.value))[0];if(feed)return feed;}}
    let pool=[...moves];if(!target&&enemyOne){const safe=pool.filter(m=>m.combo.type!=="single");if(safe.length)pool=safe;}if(!target&&enemyTwo){const safe=pool.filter(m=>m.combo.type!=="pair");if(safe.length)pool=safe;}
    const power=powerProfile(hand),bombDominant=power.bombs>=2&&power.cards>=Math.ceil(hand.length*.65);if(!target&&hand.length>12&&!bombDominant){const disciplined=pool.filter(m=>!m.combo.bomb&&!(m.combo.type==="single"&&(m.combo.main||m.combo.value)>=14));if(disciplined.length)pool=disciplined;}
    const danger=enemyMin<=3||(target&&team(target.player)!==team(p)&&state.hands[target.player].length<=5),memo=new Map(),fast=!!weights.trainingFast,trainingDepth=Number.isInteger(weights.trainingDepth)?weights.trainingDepth:null,estimate=cards=>fast?quickTurns(cards):trainingDepth===null?planTurns(cards,memo):planTurns(cards,memo,0,trainingDepth),baseTurns=fast||hand.length>18&&trainingDepth===null?quickTurns(hand):estimate(hand);
    const scored=pool.map(move=>{const remain=removeMove(hand,move),futureTurns=estimate(remain),closesSoon=futureTurns<=1;return{move,closesSoon,futureTurns,cost:moveCost(move,hand,target,p,{danger,closesSoon,enemyOne,enemyTwo,mateNext,mateLow,baseTurns,power,weights,fast:fast||trainingDepth===0,trainingDepth,memo})+futureTurns*(hand.length<=16?weights.futureShort:weights.futureLong)};});scored.sort((a,b)=>a.cost-b.cost||a.futureTurns-b.futureTurns||structureDamage(a.move,hand,weights)-structureDamage(b.move,hand,weights)||(a.move.combo.main||a.move.combo.value)-(b.move.combo.main||b.move.combo.value));let best=scored[0];
    if(!danger&&hand.length>8){const tolerance=power.bombs>=2?weights.randomTolerance*3.1:hand.length>18?weights.randomTolerance*1.55:weights.randomTolerance,near=scored.filter(x=>x.cost<=best.cost+tolerance).slice(0,5);if(near.length>1){const temperature=power.bombs>=2?weights.randomTemperature*1.7:weights.randomTemperature,drawWeights=near.map(x=>Math.exp(-(x.cost-best.cost)/temperature)),total=drawWeights.reduce((a,b)=>a+b,0);let roll=Math.random()*total;for(let i=0;i<near.length;i++){roll-=drawWeights[i];if(roll<=0){best=near[i];break;}}}}
    if(target&&!danger&&team(target.player)!==team(p)&&state.hands[target.player].length>7&&!best.closesSoon){const spendsControl=best.move.cards.some(c=>rankValue(c.rank)>=15),damage=structureDamage(best.move,hand),powerHand=power.bombs>=2&&power.cards>=Math.ceil(hand.length*.65),planGain=baseTurns-best.futureTurns,targetHigh=(target.combo.main||target.combo.value)>=14;if(best.move.combo.bomb&&!powerHand&&planGain<2||damage>=50||hand.length>12&&spendsControl&&!targetHigh&&planGain<1)return null;}
    return best.move;
  }

  function applyTribute(){
    const r=state.lastRanking;if(!r)return null;const first=r[0],second=r[1],doubleDown=team(first)===team(second),payers=doubleDown?[r[2],r[3]]:[r[3]];
    const bigJokers=payers.reduce((n,p)=>n+state.hands[p].filter(c=>c.rank==="BJ").length,0);if(bigJokers>=2){state.starter=first;state.tributeText=`${NAMES[payers[0]]}${doubleDown?`、${NAMES[payers[1]]}`:""}持有两张大王，抗贡成功`;return{anti:true,doubleDown,payers,starter:first,text:state.tributeText,exchanges:[]};}
    const offered=payers.map(from=>({from,tribute:[...state.hands[from]].filter(c=>!(c.rank===state.levelRank&&c.suit==="♥")).sort((a,b)=>rankValue(b.rank)-rankValue(a.rank)||naturalValue(b.rank)-naturalValue(a.rank))[0]})).filter(x=>x.tribute).sort((a,b)=>rankValue(b.tribute.rank)-rankValue(a.tribute.rank)||payers.indexOf(a.from)-payers.indexOf(b.from));
    const receivers=doubleDown?[first,second]:[first],exchanges=offered.map((x,i)=>({...x,to:receivers[i]}));if(!exchanges.length)return null;
    for(const x of exchanges){state.hands[x.from]=state.hands[x.from].filter(c=>c.id!==x.tribute.id);state.hands[x.to].push(x.tribute);}
    for(const x of exchanges){const sizes=groups(state.hands[x.to]),eligible=state.hands[x.to].filter(c=>naturalValue(c.rank)<=10&&c.rank!=="SJ"&&c.rank!=="BJ"&&!(c.rank===state.levelRank&&c.suit==="♥"));x.back=[...eligible].sort((a,b)=>(sizes.get(a.rank)?.length||0)-(sizes.get(b.rank)?.length||0)||naturalValue(a.rank)-naturalValue(b.rank))[0];if(x.back){state.hands[x.to]=state.hands[x.to].filter(c=>c.id!==x.back.id);state.hands[x.from].push(x.back);}}
    state.hands.forEach(sortHand);state.starter=exchanges[0].from;state.tributeText=exchanges.map(x=>`${NAMES[x.from]}向${NAMES[x.to]}进贡${x.tribute.rank}，${NAMES[x.to]}还${x.back?.rank||"牌"}`).join("；");return{anti:false,doubleDown,payers,starter:state.starter,text:state.tributeText,exchanges};
  }

  function legalReturnCards(hand){return hand.filter(c=>naturalValue(c.rank)<=10&&c.rank!=="SJ"&&c.rank!=="BJ"&&!(c.rank===state.levelRank&&c.suit==="♥"));}
  function chooseAutoReturn(hand){const sizes=groups(hand);return [...legalReturnCards(hand)].sort((a,b)=>{const cost=c=>{const count=sizes.get(c.rank)?.length||0,bomb=count>=4?100:0,set=count===3?24:count===2?12:0,wild=c.rank===state.levelRank&&c.suit==="♥"?200:0;return bomb+set+wild+cardLinkScore(c,hand)*7+naturalValue(c.rank)*.1;};return cost(a)-cost(b)||naturalValue(a.rank)-naturalValue(b.rank);})[0];}
  function prepareTributeSession(result){const session={result,kind:null,index:-1};if(result.anti)return session;const index=result.exchanges.findIndex(x=>x.from===0||x.to===0);if(index<0)return session;const x=result.exchanges[index];session.index=index;if(x.from===0){if(x.back){state.hands[0]=state.hands[0].filter(c=>c.id!==x.back.id);state.hands[x.to].push(x.back);}state.hands[x.to]=state.hands[x.to].filter(c=>c.id!==x.tribute.id);state.hands[0].push(x.tribute);x.back=null;session.kind="tribute";}else{if(x.back){state.hands[x.from]=state.hands[x.from].filter(c=>c.id!==x.back.id);state.hands[0].push(x.back);}x.back=null;session.kind="back";}state.hands.forEach(sortHand);return session;}
  function renderTributeTable(){const session=state.tributeSession;if(!session)return;for(let p=0;p<4;p++)$(`#gd-played-${p}`).innerHTML="";const result=session.result;if(result.anti){setMessage("抗贡成功",`${result.text}，由${NAMES[result.starter]}先出牌`);return;}result.exchanges.forEach((x,i)=>{const waitingTribute=session.kind==="tribute"&&session.index===i,waitingBack=session.kind==="back"&&session.index===i;$(`#gd-played-${x.from}`).insertAdjacentHTML("beforeend",`<div class="gd-play-record tribute-record">${waitingTribute?'<span class="gd-pass">待选贡牌</span>':cardHTML(x.tribute)}<span class="gd-play-label">${NAMES[x.from]} → ${NAMES[x.to]} · 进贡</span></div>`);$(`#gd-played-${x.to}`).insertAdjacentHTML("beforeend",`<div class="gd-play-record tribute-record">${waitingBack?'<span class="gd-pass">待选还牌</span>':x.back?cardHTML(x.back):'<span class="gd-pass">待还牌</span>'}<span class="gd-play-label">${NAMES[x.to]} → ${NAMES[x.from]} · 还贡</span></div>`);});const prompt=session.kind==="tribute"?"请先理牌，再选择一张最大的合法贡牌":session.kind==="back"?"请先理牌，再选择一张自然点数不超过 10 的牌":"贡还完成，请确认开始本局";setMessage("进贡与还贡",prompt);}
  function confirmTributeChoice(){const session=state.tributeSession;if(!session?.kind)return;const chosen=state.hands[0].filter(c=>state.selected.has(c.id));if(chosen.length!==1){$("#gd-hint").textContent="请选择正好 1 张牌";return;}const card=chosen[0],x=session.result.exchanges[session.index];if(session.kind==="tribute"){const eligible=state.hands[0].filter(c=>!(c.rank===state.levelRank&&c.suit==="♥")),max=Math.max(...eligible.map(c=>rankValue(c.rank)));if(rankValue(card.rank)!==max||card.rank===state.levelRank&&card.suit==="♥"){$("#gd-hint").textContent="进贡必须选择手中最大的非红桃级牌";return;}state.hands[0]=state.hands[0].filter(c=>c.id!==card.id);state.hands[x.to].push(card);x.tribute=card;const back=chooseAutoReturn(state.hands[x.to]);if(back){state.hands[x.to]=state.hands[x.to].filter(c=>c.id!==back.id);state.hands[0].push(back);x.back=back;}}else{if(!legalReturnCards([card]).length){$("#gd-hint").textContent="还贡只能选择自然点数不超过 10 的非红桃级牌";return;}state.hands[0]=state.hands[0].filter(c=>c.id!==card.id);state.hands[x.from].push(card);x.back=card;}state.selected.clear();state.hands.forEach(sortHand);session.kind=null;state.tributeText=session.result.exchanges.map(e=>`${NAMES[e.from]}进贡${e.tribute.rank}，${NAMES[e.to]}还${e.back?.rank||"牌"}`).join("；");updateAll();renderTributeTable();renderControls();}
  function finishTributePhase(){const starter=state.turn;state.tributeSession=null;renderPlayHistory();setMessage(`${NAMES[starter]}先出牌`,"贡还结束，本局开始");runTurn();}

  function startGame(){
    clearTimeout(state.timer); state.levelRank=LEVELS[state.levels[state.levelTeam]]; const deck=makeDeck();
    state.hands=[[],[],[],[]]; for(let i=0;i<108;i++)state.hands[i%4].push(deck[i]); state.hands.forEach(sortHand);
    const tribute=applyTribute(),tributeSession=tribute?prepareTributeSession(tribute):null;
    state.selected.clear(); state.manualGroups=[];state.flushCycle={"♠":0,"♥":0,"♣":0,"♦":0};state.last=null; state.passes=0; state.finished=[]; state.played=[];state.playHistory=[];state.passSignals=[[],[],[],[]]; state.running=true;const myMeta=$("#gd-player-0 .gd-me-meta small");if(myMeta)myMeta.textContent="与小舒一队";
    state.tributeSession=tributeSession;if(!tribute)state.starter=(state.starter+1)%4; state.turn=state.starter;
    updateAll();renderPlayHistory();const detected=SUITS.filter(s=>straightFlushOptions(state.hands[0],s).length).length;setMessage(`${NAMES[state.turn]}先出牌`, tribute?tribute.text:(detected?`有 ${detected} 种花色可组成同花顺，点击亮起的花色预选`:`本局打 ${state.levelRank}`));if(music.enabled)startMusic().catch(()=>{});
    if(tribute){renderTributeTable();renderControls();highlightTurn();}else runTurn();
  }
  function nextActive(from){ for(let n=1;n<=4;n++){const p=(from+n)%4;if(state.hands[p].length && !state.finished.includes(p))return p;}return -1; }
  function playMove(p,cards){
    const combo=classify(cards); if(!combo || (state.last&&!beats(combo,state.last.combo)))return false;
    const ids=new Set(cards.map(c=>c.id)); state.hands[p]=state.hands[p].filter(c=>!ids.has(c.id)); state.last={player:p,cards:[...cards],combo}; state.passes=0; state.played.push(...cards); if(p===0)state.selected.clear();
    showPlay(p,cards,TYPE_NAME[combo.type]);
    let justFinished=false;if(!state.hands[p].length && !state.finished.includes(p)){justFinished=true;state.finished.push(p); markFinished(p);if(state.finished.length===2&&team(state.finished[0])===team(state.finished[1])){const rest=[0,1,2,3].filter(x=>!state.finished.includes(x)).sort((a,b)=>state.hands[a].length-state.hands[b].length);state.finished.push(...rest);finishGame();return true;}if(state.finished.length===3){const last=[0,1,2,3].find(x=>!state.finished.includes(x));state.finished.push(last);finishGame();return true;} }
    state.turn=nextActive(p); updateAll();if(p===0&&justFinished)setMessage(`你已出完 · 第 ${state.finished.indexOf(0)+1} 名`,`牌局继续，已公开对家小舒的剩余手牌`);else setMessage(`${NAMES[p]}：${TYPE_NAME[combo.type]}`, `${NAMES[state.turn]}出牌`); runTurn(); return true;
  }
  function pass(p){
    if(!state.last)return;state.passSignals[p].push({type:state.last.combo.type,size:state.last.combo.size,value:state.last.combo.value});if(state.passSignals[p].length>12)state.passSignals[p].shift(); state.passes++; showPass(p); const active=4-state.finished.length;
    const requiredPasses=active-(state.hands[state.last.player].length?1:0);
    if(state.passes>=Math.max(1,requiredPasses)){
      const winner=state.last.player; state.last=null;state.passes=0;
      let lead=state.hands[winner].length?winner:partner(winner); if(!state.hands[lead].length)lead=nextActive(winner);
      state.turn=lead; setMessage(`${NAMES[lead]}接风`, "新一轮，可以出任意牌");
    }else{state.turn=nextActive(p);setMessage(`${NAMES[p]}不出`, `${NAMES[state.turn]}出牌`);}
    updateAll();runTurn();
  }
  function runTurn(){
    clearTimeout(state.timer); if(!state.running)return;
    if(state.turn<0||!state.hands[state.turn]?.length||state.finished.includes(state.turn))state.turn=nextActive(state.turn<0?0:state.turn);
    if(state.turn<0)return;
    renderControls(); highlightTurn();
    if(state.turn!==0){const think=1150+Math.random()*1000+Math.min(450,state.hands[state.turn].length*15);state.timer=setTimeout(()=>{const player=state.turn;try{const m=chooseAI(player);m?playMove(player,m.cards):pass(player);}catch(error){const fallback=generateMoves(state.hands[player],state.last)[0];if(fallback)playMove(player,fallback.cards);else if(state.last)pass(player);}},think);}
  }
  function finishGame(){
    state.running=false;clearTimeout(state.timer);const first=state.finished[0],matePos=state.finished.indexOf(partner(first));const gain=matePos===1?3:matePos===2?2:1;const winTeam=team(first);state.levels[winTeam]=Math.min(12,state.levels[winTeam]+gain);state.levelTeam=winTeam;
    state.lastRanking=[...state.finished];localStorage.setItem("guandan-progress",JSON.stringify({levels:state.levels,levelTeam:state.levelTeam,ranking:state.lastRanking}));
    updateHeader();const won=winTeam===0,doubleDown=matePos===1;$("#gd-result-icon").textContent=won?"胜":"负";$("#gd-result-icon").classList.toggle("lose",!won);$("#gd-result-title").textContent=doubleDown?`${won?"我方":"对方"}双下 · 升 3 级`:(won?`我方升 ${gain} 级`:`对方升 ${gain} 级`);$("#gd-result-copy").textContent=`下局由${winTeam===0?"我方":"对方"}打 ${LEVELS[state.levels[winTeam]]}`;
    $("#gd-ranking").innerHTML=state.finished.map((p,i)=>`<div class="gd-rank-item"><b>${i+1}</b>${NAMES[p]}${team(p)===0?" · 我方":""}</div>`).join("");setTimeout(()=>$("#gd-result-dialog").showModal(),350);renderControls();
  }
  function markFinished(p){const el=$(`#gd-player-${p}`);if(!el)return;const label=p===0?el.querySelector(".gd-me-meta small"):el.querySelector(".gd-meta em");if(label)label.textContent=`第 ${state.finished.length} 名 · 观战中`;}
  function cardHTML(c,small=false){
    const joker=c.rank==="SJ"||c.rank==="BJ",red=c.suit==="♥"||c.suit==="♦"||c.rank==="BJ",label=c.rank==="SJ"?"小王":c.rank==="BJ"?"大王":c.rank;
    const wild=c.rank===state.levelRank&&c.suit==="♥";
    return `<div class="gd-card${red?" red":""}${joker?" joker":""}" data-id="${c.id}"><span class="gd-rank">${label}</span><span class="gd-suit">${joker?"★":c.suit}</span><span class="gd-big-suit">${joker?"★":c.suit}</span>${wild?'<i class="gd-wild">配</i>':""}</div>`;
  }
  function moveSuit(move){const normal=move.cards.filter(c=>!(c.rank===state.levelRank&&c.suit==="♥")),suits=[...new Set(normal.map(c=>c.suit))];return suits.length===1?suits[0]:"♥";}
  function straightFlushOptions(hand,suit){return generateMoves(hand).filter(m=>m.combo.type==="straight_flush"&&moveSuit(m)===suit).sort((a,b)=>a.combo.main-b.combo.main);}
  function arrangedGroups(){
    const makeRanks=hand=>[...groups(hand).entries()].map(([rank,cards])=>({type:"rank",rank,cards:[...cards].sort((a,b)=>SUITS.indexOf(a.suit)-SUITS.indexOf(b.suit))}));
    const byId=new Map(state.hands[0].map(c=>[c.id,c])),used=new Set(),manual=[];state.manualGroups=state.manualGroups.map(ids=>ids.filter(id=>byId.has(id))).filter(ids=>ids.length>1);
    state.manualGroups.forEach((ids,index)=>{const cards=ids.map(id=>byId.get(id)).filter(Boolean).sort((a,b)=>rankValue(b.rank)-rankValue(a.rank)||SUITS.indexOf(a.suit)-SUITS.indexOf(b.suit));cards.forEach(c=>used.add(c.id));manual.push({type:"combo",label:`牌组 ${index+1}`,groupIndex:index,cards});});
    return [...manual,...makeRanks(state.hands[0].filter(c=>!used.has(c.id))).sort((a,b)=>rankValue(b.rank)-rankValue(a.rank))];
  }
  function renderHand(){
    const el=$("#gd-hand"),list=arrangedGroups(),landscape=innerHeight<=600&&innerWidth>innerHeight,mobile=innerWidth<=760,vGap=landscape?22:mobile?23:26,cardW=landscape?47:mobile?53:59;
    el.innerHTML=list.map(g=>{const ids=g.cards.map(c=>c.id).join(","),stack=`--v-gap:${vGap}px;--stack-extra:${(g.cards.length-1)*vGap}px;width:${cardW}px;flex-basis:${cardW}px`,cards=g.cards.map((c,i)=>cardHTML(c).replace('data-id=',`style="--i:${i};--stack-top:${i*vGap}px" data-id=`)).join("");if(g.type==="combo")return `<div class="gd-hand-block gd-rank-stack gd-combo-block manual" data-width="${cardW}" style="${stack}"><button class="gd-group-pick combo" data-ids="${ids}" title="全选${g.label}">全选</button><button class="gd-group-remove" data-group="${g.groupIndex}" title="拆开并还原这组牌">拆开</button>${cards}</div>`;const rankLabel=g.rank==="BJ"?"大王":g.rank==="SJ"?"小王":g.rank;return `<div class="gd-hand-block gd-rank-stack" data-width="${cardW}" data-rank="${g.rank}" style="${stack}">${g.cards.length>1?`<button class="gd-group-pick rank" data-ids="${ids}" title="全选所有 ${rankLabel}">${rankLabel} · 全选</button>`:""}${cards}</div>`;}).join("");
    const blocks=$$("#gd-hand .gd-hand-block"),available=Math.max(120,el.clientWidth-24),total=blocks.reduce((n,b)=>n+(+b.dataset.width||cardW),0),over=blocks.length>1?Math.min(0,(available-total)/(blocks.length-1)):0;blocks.forEach((node,i)=>{node.style.setProperty("--stack-overlap",`${Math.max(-28,over)}px`);node.style.zIndex=i+1;});
    $$("#gd-hand .gd-card").forEach(node=>node.classList.toggle("selected",state.selected.has(+node.dataset.id)));
  }
  function renderBacks(){for(let p=1;p<4;p++){const shown=state.running?state.hands[p].length:27,el=$(`#gd-backs-${p}`);if(p===2&&state.running&&state.hands[0].length===0){el.classList.add("revealed");el.innerHTML=`<div class="gd-revealed-hand">${sortHand([...state.hands[p]]).map(cardHTML).join("")}</div>`;}else{el.classList.remove("revealed");const n=Math.min(7,Math.ceil(shown/4));el.innerHTML=Array.from({length:n},()=>'<i class="gd-back"></i>').join("");}$(`#gd-count-${p}`).textContent=shown;}}
  function renderCounter(){const unseen=state.hands.slice(1).flat(),order=["BJ","SJ",state.levelRank,...RANKS.slice().reverse().filter(r=>r!==state.levelRank)];const count=(r,s)=>state.running?unseen.filter(c=>c.rank===r&&(!s||c.suit===s)).length:(r==="SJ"||r==="BJ"?2:s?2:8);$("#gd-counter-grid").innerHTML=order.map(r=>{const n=count(r),label=r==="BJ"?"大王":r==="SJ"?"小王":r;if(r==="SJ"||r==="BJ")return `<div class="gd-counter-cell joker-count${n?"":" zero"}"><b>${label}</b><strong>${n}</strong></div>`;return `<div class="gd-counter-cell${n?"":" zero"}"><b>${label}</b><div class="gd-suit-counts">${SUITS.map(s=>`<span class="${s==="♥"||s==="♦"?"red":""}">${s}${count(r,s)}</span>`).join("")}</div></div>`;}).join("");}
  function updateHeader(){$("#gd-level-us").textContent=LEVELS[state.levels[0]];$("#gd-level-them").textContent=LEVELS[state.levels[1]];$("#gd-level-now").textContent=`本局打 ${state.levelRank}`;}
  function updateAll(){renderHand();renderBacks();renderCounter();updateHeader();}
  function renderPlayHistory(){for(let p=0;p<4;p++)$(`#gd-played-${p}`).innerHTML="";state.playHistory.forEach((entry,index)=>{const age=state.playHistory.length-1-index,when=age===0?"最新":`前 ${age} 手`;$(`#gd-played-${entry.player}`).insertAdjacentHTML("beforeend",`<div class="gd-play-record${entry.pass?" pass-record":""}" data-age="${age}">${entry.pass?'<span class="gd-pass">不出</span>':entry.cards.map(cardHTML).join("")}<span class="gd-play-label">${when} · ${NAMES[entry.player]} · ${entry.label}</span></div>`);});}
  function showPlay(p,cards,label){state.playHistory.push({player:p,cards:[...cards],label,pass:false});state.playHistory=state.playHistory.slice(-3);renderPlayHistory();}
  function showPass(p){state.playHistory.push({player:p,cards:[],label:"不出",pass:true});state.playHistory=state.playHistory.slice(-3);renderPlayHistory();}
  function setMessage(status,msg){$("#gd-status").textContent=status;$("#gd-message").textContent=msg;$("#gd-hint").textContent=msg;}
  function highlightTurn(){$$(".gd-player,.gd-me").forEach(x=>x.classList.remove("turn"));const el=$(`#gd-player-${state.turn}`);if(el)el.classList.add("turn");}
  function renderControls(){
    const el=$("#gd-actions");if(!state.running){renderFlushTools();el.innerHTML='<button class="gd-btn primary" id="gd-start">开始游戏</button>';$("#gd-start").onclick=startGame;return;}const arrangeLabel=state.selected.size>1?`收为一组 (${state.selected.size})`:"收为一组",cancel=state.selected.size?'<button class="gd-btn cancel" id="gd-clear-btn">取消预选</button>':"";
    if(state.tributeSession){renderFlushTools("贡还 · 同花顺");const kind=state.tributeSession.kind;if(kind){el.innerHTML=`<button class="gd-btn arrange" id="gd-arrange-btn">${arrangeLabel}</button>${cancel}<button class="gd-btn primary" id="gd-confirm-tribute">${kind==="tribute"?"确认进贡":"确认还贡"}</button>`;$("#gd-arrange-btn").onclick=arrangeHand;if($("#gd-clear-btn"))$("#gd-clear-btn").onclick=clearSelection;$("#gd-confirm-tribute").onclick=confirmTributeChoice;}else{el.innerHTML='<button class="gd-btn primary" id="gd-finish-tribute">贡还完成 · 开始本局</button>';$("#gd-finish-tribute").onclick=finishTributePhase;}return;}
    renderFlushTools();
    if(!state.hands[0].length){el.innerHTML='<button class="gd-btn spectator" disabled>观战中 · 电脑继续出牌</button>';return;}
    if(state.turn!==0){el.innerHTML=`<button class="gd-btn arrange" id="gd-arrange-btn">${arrangeLabel}</button>${cancel}<button class="gd-btn" disabled>电脑思考中</button>`;$("#gd-arrange-btn").onclick=arrangeHand;if($("#gd-clear-btn"))$("#gd-clear-btn").onclick=clearSelection;return;}
    el.innerHTML=`<button class="gd-btn arrange" id="gd-arrange-btn">${arrangeLabel}</button>${cancel}<button class="gd-btn" id="gd-hint-btn">提示</button>${state.last?'<button class="gd-btn" id="gd-pass-btn">不出</button>':""}<button class="gd-btn primary" id="gd-play-btn">出牌</button>`;
    $("#gd-arrange-btn").onclick=arrangeHand;if($("#gd-clear-btn"))$("#gd-clear-btn").onclick=clearSelection;$("#gd-hint-btn").onclick=hintMove;if($("#gd-pass-btn"))$("#gd-pass-btn").onclick=()=>pass(0);$("#gd-play-btn").onclick=humanPlay;
  }
  function renderFlushTools(label="同花顺"){const el=$("#gd-flush-tools");if(!el)return;el.innerHTML=`<span>${label}</span>${SUITS.map(s=>{const n=state.running?straightFlushOptions(state.hands[0],s).length:0;return `<button class="gd-flush-btn ${s==="♥"||s==="♦"?"red":""}${n?" available":""}" data-suit="${s}" ${n?"":"disabled"}>${s}${n>1?`<i>${n}</i>`:""}</button>`;}).join("")}`;$$(".gd-flush-btn.available").forEach(b=>b.onclick=()=>selectStraightFlush(b.dataset.suit));}
  function selectStraightFlush(suit){const options=straightFlushOptions(state.hands[0],suit);if(!options.length)return;const index=state.flushCycle[suit]%options.length,move=options[index];state.flushCycle[suit]=(index+1)%options.length;state.selected.clear();move.cards.forEach(c=>state.selected.add(c.id));renderHand();renderControls();$("#gd-hint").textContent=`已预选 ${suit} 同花顺 ${index+1}/${options.length}${options.length>1?"，再点切换下一组":""}`;}
  function arrangeHand(){const ids=[...state.selected];if(ids.length<2){$("#gd-hint").textContent="请先选择至少 2 张牌，再点“收为一组”";return;}state.manualGroups=state.manualGroups.map(g=>g.filter(id=>!state.selected.has(id))).filter(g=>g.length>1);state.manualGroups.push(ids);state.selected.clear();renderHand();renderControls();$("#gd-hint").textContent=`已把 ${ids.length} 张牌收为牌组 ${state.manualGroups.length}`;}
  function clearSelection(){state.selected.clear();renderHand();renderControls();$("#gd-hint").textContent="已取消预选";}
  function describeSelection(){if(!state.selected.size)return;const cards=state.hands[0].filter(c=>state.selected.has(c.id)),combo=classify(cards);if(!combo){$("#gd-hint").textContent=`已选 ${cards.length} 张`;return;}let extra="";if(combo.type==="straight_flush"){const normal=cards.filter(c=>!(c.rank===state.levelRank&&c.suit==="♥"));extra=` · ${(normal[0]?.suit)||"♥"}`;}$("#gd-hint").textContent=`已识别：${TYPE_NAME[combo.type]}${extra}`;}
  function hintMove(){const ms=generateMoves(state.hands[0],state.last);state.selected.clear();if(ms.length){const memo=new Map(),enemyMin=Math.min(...[1,3].filter(x=>state.hands[x].length).map(x=>state.hands[x].length)),danger=enemyMin<=3;const scored=ms.map(move=>({move,cost:moveCost(move,state.hands[0],state.last,0,{memo,danger,closesSoon:planTurns(removeMove(state.hands[0],move),memo)<=1})}));scored.sort((a,b)=>a.cost-b.cost);const m=scored[0].move;m.cards.forEach(c=>state.selected.add(c.id));setMessage("出牌提示",TYPE_NAME[m.combo.type]);}else setMessage("没有能压过的牌","请选择不出");renderHand();renderControls();}
  function humanPlay(){const cards=state.hands[0].filter(c=>state.selected.has(c.id)),combo=classify(cards);if(!combo){setMessage("牌型不正确","请重新选择");return;}if(state.last&&!beats(combo,state.last.combo)){setMessage("压不过上一手","需要同型更大或使用炸弹");return;}playMove(0,cards);}
  let drag=false,dragSelect=true,dragSeen=new Set();
  function touchCard(node){if(!node||!node.classList.contains("gd-card")||!node.closest("#gd-hand"))return;const id=+node.dataset.id;if(dragSeen.has(id))return;dragSeen.add(id);dragSelect?state.selected.add(id):state.selected.delete(id);node.classList.toggle("selected",dragSelect);}
  function pickGroup(button){const ids=button.dataset.ids.split(",").map(Number),all=ids.every(id=>state.selected.has(id));ids.forEach(id=>all?state.selected.delete(id):state.selected.add(id));renderHand();describeSelection();}
  $("#gd-hand").addEventListener("pointerdown",e=>{const remove=e.target.closest(".gd-group-remove");if(remove){e.preventDefault();state.manualGroups.splice(+remove.dataset.group,1);renderHand();renderControls();$("#gd-hint").textContent="牌组已拆开并还原";return;}const pick=e.target.closest(".gd-group-pick");if(pick){e.preventDefault();pickGroup(pick);renderControls();return;}const c=e.target.closest(".gd-card");if(!c||(state.turn!==0&&!state.tributeSession?.kind))return;drag=true;dragSeen.clear();dragSelect=!state.selected.has(+c.dataset.id);touchCard(c);});
  window.addEventListener("pointermove",e=>{if(!drag)return;touchCard(document.elementFromPoint(e.clientX,e.clientY)?.closest?.(".gd-card"));});window.addEventListener("pointerup",()=>{if(drag){describeSelection();renderControls();}drag=false;dragSeen.clear();});
  $("#gd-rules").onclick=()=>$("#gd-rules-dialog").showModal();$("#gd-rules-dialog .gd-close").onclick=()=>$("#gd-rules-dialog").close();$("#gd-again").onclick=()=>{$("#gd-result-dialog").close();startGame();};
  $("#gd-music").onclick=toggleMusic;updateMusicButton();document.addEventListener("visibilitychange",()=>{if(document.hidden)stopMusic();else if(music.enabled)startMusic().catch(()=>{});});
  $("#gd-landscape").onclick=async()=>{try{if(document.documentElement.requestFullscreen&&!document.fullscreenElement)await document.documentElement.requestFullscreen();if(screen.orientation?.lock)await screen.orientation.lock("landscape");}catch(e){setMessage("请旋转手机","浏览器不允许网页强制旋转时，请开启系统自动旋转");}};
  window.addEventListener("resize",()=>state.running&&renderHand());
  state.levelRank=LEVELS[state.levels[state.levelTeam]];updateAll();renderControls();
  window.__guandan={classify,beats,generateMoves,makeDeck,state};
})();
