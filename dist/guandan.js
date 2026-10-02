(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const SUITS = ["♠", "♥", "♣", "♦"];
  const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
  const NAMES = ["你", "阿明", "小岚", "小雅"];
  const LEVELS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
  const TYPE_NAME = {single:"单张",pair:"对子",triple:"三张",triple_pair:"三带二",straight:"顺子",pair_run:"三连对",triple_run:"钢板",bomb:"炸弹",straight_flush:"同花顺",joker_bomb:"四王炸"};
  const state = {hands:[[],[],[],[]], selected:new Set(), turn:0, last:null, passes:0, finished:[], played:[], running:false, timer:0, levels:[0,0], levelTeam:0, levelRank:"2", starter:0, lastRanking:null, tributeText:"", arrangeMode:"rank"};
  const saved = JSON.parse(localStorage.getItem("guandan-progress") || "null");
  if (saved && Array.isArray(saved.levels)) { state.levels = saved.levels.map(v => Math.max(0, Math.min(12, v|0))); state.levelTeam = saved.levelTeam === 1 ? 1 : 0; if(Array.isArray(saved.ranking)&&saved.ranking.length===4)state.lastRanking=saved.ranking; }

  function team(p){ return p % 2; }
  function partner(p){ return (p + 2) % 4; }
  function rankValue(rank){
    if(rank === "SJ") return 16;
    if(rank === "BJ") return 17;
    if(rank === state.levelRank) return 15;
    return RANKS.indexOf(rank) + 2;
  }
  function naturalValue(rank){ return rank === "SJ" ? 16 : rank === "BJ" ? 17 : RANKS.indexOf(rank) + 2; }
  function sortHand(hand){ return hand.sort((a,b) => rankValue(a.rank)-rankValue(b.rank) || SUITS.indexOf(a.suit)-SUITS.indexOf(b.suit)); }
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
  function generateMoves(hand, target=null){
    const g=groups(hand), moves=[];
    for(const [,cs] of g){
      moves.push([cs[0]]); if(cs.length>=2)moves.push(cs.slice(0,2)); if(cs.length>=3)moves.push(cs.slice(0,3));
      if(cs.length>=4) for(let n=4;n<=cs.length;n++)moves.push(cs.slice(0,n));
    }
    const triples=[...g.values()].filter(x=>x.length>=3), pairs=[...g.values()].filter(x=>x.length>=2);
    for(const t of triples) for(const p of pairs) if(t[0].rank!==p[0].rank)moves.push([...t.slice(0,3),...p.slice(0,2)]);
    const naturals=[...g.entries()].filter(([r])=>r!=="SJ"&&r!=="BJ").sort((a,b)=>naturalValue(a[0])-naturalValue(b[0]));
    const seqRanks=[...new Set(naturals.map(x=>naturalValue(x[0])))];
    for(let i=0;i<=seqRanks.length-5;i++){const vals=seqRanks.slice(i,i+5);if(consecutive(vals)){const es=vals.map(v=>naturals.find(x=>naturalValue(x[0])===v));moves.push(es.map(e=>e[1][0]));for(const s of SUITS)if(es.every(e=>e[1].some(c=>c.suit===s)))moves.push(es.map(e=>e[1].find(c=>c.suit===s)));}}
    const lowAce=[2,3,4,5,14].map(v=>naturals.find(x=>naturalValue(x[0])===v)); if(lowAce.every(Boolean)){moves.push(lowAce.map(e=>e[1][0]));for(const s of SUITS)if(lowAce.every(e=>e[1].some(c=>c.suit===s)))moves.push(lowAce.map(e=>e[1].find(c=>c.suit===s)));}
    for(let i=0;i<naturals.length;i++){
      const p3=naturals.slice(i,i+3); if(p3.length===3&&p3.every(e=>e[1].length>=2)&&consecutive(p3.map(e=>naturalValue(e[0]))))moves.push(p3.flatMap(e=>e[1].slice(0,2)));
      const t2=naturals.slice(i,i+2); if(t2.length===2&&t2.every(e=>e[1].length>=3)&&consecutive(t2.map(e=>naturalValue(e[0]))))moves.push(t2.flatMap(e=>e[1].slice(0,3)));
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
    }
    const jokers=hand.filter(c=>c.rank==="SJ"||c.rank==="BJ"); if(jokers.length===4)moves.push(jokers);
    const valid=uniqueMoves(moves).map(cards=>({cards,combo:classify(cards)})).filter(x=>x.combo);
    return target ? valid.filter(x=>beats(x.combo,target.combo)) : valid;
  }
  function moveCost(move,hand,target){
    const c=move.combo; let score=0;
    score -= move.cards.length*13;
    score += (c.main||c.value)*.65;
    if(c.bomb)score += target&&target.combo.bomb ? 8 : 70;
    score += move.cards.filter(x=>rankValue(x.rank)>=15).length*9;
    score += move.cards.filter(x=>x.rank===state.levelRank&&x.suit==="♥").length*17;
    const handGroups=groups(hand);for(const [rank,cards] of handGroups)if(cards.length>=4){const used=move.cards.filter(ca=>ca.rank===rank).length;if(used>0&&used<cards.length)score+=48;}
    if(move.cards.length===hand.length)score-=1000;
    const remain=hand.filter(ca=>!move.cards.some(m=>m.id===ca.id));
    score += estimateTurns(remain)*16;
    return score;
  }
  function estimateTurns(hand){
    if(!hand.length)return 0; let left=[...hand],turns=0;
    while(left.length&&turns<12){const ms=generateMoves(left).filter(x=>!x.combo.bomb);const best=ms.sort((a,b)=>b.cards.length-a.cards.length)[0]||{cards:[left[0]]};const ids=new Set(best.cards.map(c=>c.id));left=left.filter(c=>!ids.has(c.id));turns++;}
    return turns+Math.ceil(left.length/2);
  }
  function chooseAI(p){
    const hand=state.hands[p], target=state.last, moves=generateMoves(hand,target);
    if(!moves.length)return null;
    if(target && team(target.player)===team(p)){
      const finish=moves.find(m=>m.cards.length===hand.length);
      if(finish)return finish;
      return null;
    }
    if(!target&&state.hands[partner(p)].length<=2){const need=state.hands[partner(p)].length;const feed=moves.filter(m=>m.cards.length===need&&!m.combo.bomb).sort((a,b)=>(a.combo.main||a.combo.value)-(b.combo.main||b.combo.value))[0];if(feed)return feed;}
    const enemyCounts=[0,1,2,3].filter(x=>team(x)!==team(p)&&state.hands[x].length).map(x=>state.hands[x].length);
    const danger=target&&team(target.player)!==team(p)&&(state.hands[target.player].length<=4||Math.min(...enemyCounts)<=2);
    let pool=moves;
    if(!danger){const nonBomb=pool.filter(m=>!m.combo.bomb);if(nonBomb.length)pool=nonBomb;}
    if(danger&&target){const finish=pool.find(m=>m.cards.length===hand.length);if(finish)return finish;}
    return pool.sort((a,b)=>moveCost(a,hand,target)-moveCost(b,hand,target))[0];
  }

  function applyTribute(){
    const r=state.lastRanking;if(!r)return null;const first=r[0],second=r[1],last=r[3],doubleDown=team(first)===team(second);let pairs=doubleDown?[[last,first],[r[2],second]]:[[last,first]];
    const losingTeam=team(last),bigJokers=[0,1,2,3].filter(p=>team(p)===losingTeam).reduce((n,p)=>n+state.hands[p].filter(c=>c.rank==="BJ").length,0);
    if(bigJokers>=2){state.starter=first;state.tributeText=`${NAMES[last]}一方双大王抗贡`;return state.tributeText;}
    const exchanges=[];
    for(const [from,to] of pairs){
      const tribute=[...state.hands[from]].filter(c=>!(c.rank===state.levelRank&&c.suit==="♥")).sort((a,b)=>rankValue(b.rank)-rankValue(a.rank))[0];
      const back=[...state.hands[to]].filter(c=>!(c.rank===state.levelRank&&c.suit==="♥")).sort((a,b)=>rankValue(a.rank)-rankValue(b.rank))[0];
      if(tribute&&back)exchanges.push({from,to,tribute,back});
    }
    if(!exchanges.length)return null;
    for(const x of exchanges){state.hands[x.from]=state.hands[x.from].filter(c=>c.id!==x.tribute.id&&c.id!==x.back.id);state.hands[x.to]=state.hands[x.to].filter(c=>c.id!==x.back.id&&c.id!==x.tribute.id);state.hands[x.from].push(x.back);state.hands[x.to].push(x.tribute);}
    state.hands.forEach(sortHand);const highest=exchanges.sort((a,b)=>rankValue(b.tribute.rank)-rankValue(a.tribute.rank))[0];state.starter=highest.from;
    state.tributeText=exchanges.map(x=>`${NAMES[x.from]}向${NAMES[x.to]}进贡${x.tribute.rank}`).join("，");return state.tributeText;
  }

  function startGame(){
    clearTimeout(state.timer); state.levelRank=LEVELS[state.levels[state.levelTeam]]; const deck=makeDeck();
    state.hands=[[],[],[],[]]; for(let i=0;i<108;i++)state.hands[i%4].push(deck[i]); state.hands.forEach(sortHand);
    const tribute=applyTribute();
    state.selected.clear(); state.last=null; state.passes=0; state.finished=[]; state.played=[]; state.running=true;
    if(!tribute)state.starter=(state.starter+1)%4; state.turn=state.starter;
    updateAll(); setMessage(`${NAMES[state.turn]}先出牌`, tribute||`本局打 ${state.levelRank}`);
    if(tribute){renderControls();highlightTurn();state.timer=setTimeout(runTurn,1400);}else runTurn();
  }
  function nextActive(from){ for(let n=1;n<=4;n++){const p=(from+n)%4;if(state.hands[p].length && !state.finished.includes(p))return p;}return -1; }
  function playMove(p,cards){
    const combo=classify(cards); if(!combo || (state.last&&!beats(combo,state.last.combo)))return false;
    const ids=new Set(cards.map(c=>c.id)); state.hands[p]=state.hands[p].filter(c=>!ids.has(c.id)); state.last={player:p,cards:[...cards],combo}; state.passes=0; state.played.push(...cards); state.selected.clear();
    showPlay(p,cards,TYPE_NAME[combo.type]);
    if(!state.hands[p].length && !state.finished.includes(p)){ state.finished.push(p); markFinished(p); if(state.finished.length===3){const last=[0,1,2,3].find(x=>!state.finished.includes(x));state.finished.push(last);finishGame();return true;} }
    state.turn=nextActive(p); updateAll(); setMessage(`${NAMES[p]}：${TYPE_NAME[combo.type]}`, `${NAMES[state.turn]}出牌`); runTurn(); return true;
  }
  function pass(p){
    if(!state.last)return; state.passes++; showPass(p); const active=4-state.finished.length;
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
    renderControls(); highlightTurn();
    if(state.turn!==0)state.timer=setTimeout(()=>{const m=chooseAI(state.turn);m?playMove(state.turn,m.cards):pass(state.turn);},520+Math.random()*360);
  }
  function finishGame(){
    state.running=false;clearTimeout(state.timer);const first=state.finished[0],matePos=state.finished.indexOf(partner(first));const gain=matePos===1?3:matePos===2?2:1;const winTeam=team(first);state.levels[winTeam]=Math.min(12,state.levels[winTeam]+gain);state.levelTeam=winTeam;
    state.lastRanking=[...state.finished];localStorage.setItem("guandan-progress",JSON.stringify({levels:state.levels,levelTeam:state.levelTeam,ranking:state.lastRanking}));
    updateHeader();const won=winTeam===0;$("#gd-result-icon").textContent=won?"胜":"负";$("#gd-result-icon").classList.toggle("lose",!won);$("#gd-result-title").textContent=won?`我方升 ${gain} 级`:`对方升 ${gain} 级`;$("#gd-result-copy").textContent=`下局由${winTeam===0?"我方":"对方"}打 ${LEVELS[state.levels[winTeam]]}`;
    $("#gd-ranking").innerHTML=state.finished.map((p,i)=>`<div class="gd-rank-item"><b>${i+1}</b>${NAMES[p]}${team(p)===0?" · 我方":""}</div>`).join("");setTimeout(()=>$("#gd-result-dialog").showModal(),350);renderControls();
  }
  function markFinished(p){const el=$(`#gd-player-${p}`);if(el)el.querySelector(".gd-meta em").textContent=`第 ${state.finished.length} 名`;}
  function cardHTML(c,small=false){
    const joker=c.rank==="SJ"||c.rank==="BJ",red=c.suit==="♥"||c.suit==="♦"||c.rank==="BJ",label=c.rank==="SJ"?"小王":c.rank==="BJ"?"大王":c.rank;
    const wild=c.rank===state.levelRank&&c.suit==="♥";
    return `<div class="gd-card${red?" red":""}${joker?" joker":""}" data-id="${c.id}"><span class="gd-rank">${label}</span><span class="gd-suit">${joker?"★":c.suit}</span><span class="gd-big-suit">${joker?"★":c.suit}</span>${wild?'<i class="gd-wild">配</i>':""}</div>`;
  }
  function arrangedGroups(){
    const list=[...groups(state.hands[0]).entries()].map(([rank,cards])=>({rank,cards:[...cards].sort((a,b)=>SUITS.indexOf(a.suit)-SUITS.indexOf(b.suit))}));
    if(state.arrangeMode==="smart")return list.sort((a,b)=>{const bucket=x=>x.cards.length>=4?0:x.cards.length===3?1:x.cards.length===2?2:3;return bucket(a)-bucket(b)||rankValue(a.rank)-rankValue(b.rank);});
    return list.sort((a,b)=>rankValue(a.rank)-rankValue(b.rank));
  }
  function renderHand(){
    const el=$("#gd-hand"),list=arrangedGroups(),vGap=innerHeight<=600&&innerWidth>innerHeight?3:innerWidth<=760?7:10;el.innerHTML=list.map(g=>`<div class="gd-rank-stack" data-rank="${g.rank}" style="--v-gap:${vGap}px;--stack-extra:${(g.cards.length-1)*vGap}px">${g.cards.map((c,i)=>cardHTML(c).replace('data-id=',`style="--i:${i};--stack-top:${i*vGap}px" data-id=`)).join("")}</div>`).join("");
    const stacks=$$("#gd-hand .gd-rank-stack"),available=Math.max(120,el.clientWidth-24),w=57,over=stacks.length>1?Math.min(0,(available-w*stacks.length)/(stacks.length-1)):0;stacks.forEach((node,i)=>{node.style.setProperty("--stack-overlap",`${Math.max(-39,over)}px`);node.style.zIndex=i+1;});
    $$("#gd-hand .gd-card").forEach(node=>node.classList.toggle("selected",state.selected.has(+node.dataset.id)));
  }
  function renderBacks(){for(let p=1;p<4;p++){const shown=state.running?state.hands[p].length:27,n=Math.min(7,Math.ceil(shown/4));$(`#gd-backs-${p}`).innerHTML=Array.from({length:n},()=>'<i class="gd-back"></i>').join("");$(`#gd-count-${p}`).textContent=shown;}}
  function renderCounter(){const all=state.hands.flat(),order=["BJ","SJ",state.levelRank,...RANKS.slice().reverse().filter(r=>r!==state.levelRank)];const count=(r,s)=>state.running?all.filter(c=>c.rank===r&&(!s||c.suit===s)).length:(r==="SJ"||r==="BJ"?2:s?2:8);$("#gd-counter-grid").innerHTML=order.map(r=>{const n=count(r),label=r==="BJ"?"大王":r==="SJ"?"小王":r;if(r==="SJ"||r==="BJ")return `<div class="gd-counter-cell joker-count${n?"":" zero"}"><b>${label}</b><strong>${n}</strong></div>`;return `<div class="gd-counter-cell${n?"":" zero"}"><b>${label}</b><div class="gd-suit-counts">${SUITS.map(s=>`<span class="${s==="♥"||s==="♦"?"red":""}">${s}${count(r,s)}</span>`).join("")}</div></div>`;}).join("");}
  function updateHeader(){$("#gd-level-us").textContent=LEVELS[state.levels[0]];$("#gd-level-them").textContent=LEVELS[state.levels[1]];$("#gd-level-now").textContent=`本局打 ${state.levelRank}`;}
  function updateAll(){renderHand();renderBacks();renderCounter();updateHeader();}
  function showPlay(p,cards,label){for(let i=0;i<4;i++)if(i!==p)$(`#gd-played-${i}`).innerHTML="";$(`#gd-played-${p}`).innerHTML=cards.map(cardHTML).join("")+`<span class="gd-pass">${label}</span>`;}
  function showPass(p){$(`#gd-played-${p}`).innerHTML='<span class="gd-pass">不出</span>';}
  function setMessage(status,msg){$("#gd-status").textContent=status;$("#gd-message").textContent=msg;$("#gd-hint").textContent=msg;}
  function highlightTurn(){$$(".gd-player,.gd-me").forEach(x=>x.classList.remove("turn"));const el=$(`#gd-player-${state.turn}`);if(el)el.classList.add("turn");}
  function renderControls(){
    const el=$("#gd-actions");if(!state.running){el.innerHTML='<button class="gd-btn primary" id="gd-start">开始游戏</button>';$("#gd-start").onclick=startGame;return;}
    if(state.turn!==0){el.innerHTML='<button class="gd-btn arrange" id="gd-arrange-btn">理牌</button><button class="gd-btn" disabled>电脑思考中</button>';$("#gd-arrange-btn").onclick=arrangeHand;return;}
    el.innerHTML=`<button class="gd-btn arrange" id="gd-arrange-btn">理牌</button><button class="gd-btn" id="gd-hint-btn">提示</button>${state.last?'<button class="gd-btn" id="gd-pass-btn">不出</button>':""}<button class="gd-btn primary" id="gd-play-btn">出牌</button>`;
    $("#gd-arrange-btn").onclick=arrangeHand;$("#gd-hint-btn").onclick=hintMove;if($("#gd-pass-btn"))$("#gd-pass-btn").onclick=()=>pass(0);$("#gd-play-btn").onclick=humanPlay;
  }
  function arrangeHand(){state.arrangeMode=state.arrangeMode==="rank"?"smart":"rank";renderHand();setMessage(state.arrangeMode==="smart"?"智能理牌":"点数理牌",state.arrangeMode==="smart"?"炸弹、三张、对子已分组":"已按牌点从小到大排列");}
  function describeSelection(){if(!state.selected.size)return;const cards=state.hands[0].filter(c=>state.selected.has(c.id)),combo=classify(cards);if(!combo){$("#gd-hint").textContent=`已选 ${cards.length} 张`;return;}let extra="";if(combo.type==="straight_flush"){const normal=cards.filter(c=>!(c.rank===state.levelRank&&c.suit==="♥"));extra=` · ${(normal[0]?.suit)||"♥"}`;}$("#gd-hint").textContent=`已识别：${TYPE_NAME[combo.type]}${extra}`;}
  function hintMove(){const ms=generateMoves(state.hands[0],state.last);state.selected.clear();if(ms.length){const m=ms.sort((a,b)=>moveCost(a,state.hands[0],state.last)-moveCost(b,state.hands[0],state.last))[0];m.cards.forEach(c=>state.selected.add(c.id));setMessage("出牌提示",TYPE_NAME[m.combo.type]);}else setMessage("没有能压过的牌","请选择不出");renderHand();}
  function humanPlay(){const cards=state.hands[0].filter(c=>state.selected.has(c.id)),combo=classify(cards);if(!combo){setMessage("牌型不正确","请重新选择");return;}if(state.last&&!beats(combo,state.last.combo)){setMessage("压不过上一手","需要同型更大或使用炸弹");return;}playMove(0,cards);}
  let drag=false,dragSelect=true,dragSeen=new Set();
  function touchCard(node){if(!node||!node.classList.contains("gd-card")||!node.closest("#gd-hand"))return;const id=+node.dataset.id;if(dragSeen.has(id))return;dragSeen.add(id);dragSelect?state.selected.add(id):state.selected.delete(id);node.classList.toggle("selected",dragSelect);}
  $("#gd-hand").addEventListener("pointerdown",e=>{const c=e.target.closest(".gd-card");if(!c||state.turn!==0)return;drag=true;dragSeen.clear();dragSelect=!state.selected.has(+c.dataset.id);touchCard(c);});
  window.addEventListener("pointermove",e=>{if(!drag)return;touchCard(document.elementFromPoint(e.clientX,e.clientY)?.closest?.(".gd-card"));});window.addEventListener("pointerup",()=>{if(drag)describeSelection();drag=false;dragSeen.clear();});
  $("#gd-rules").onclick=()=>$("#gd-rules-dialog").showModal();$("#gd-rules-dialog .gd-close").onclick=()=>$("#gd-rules-dialog").close();$("#gd-again").onclick=()=>{$("#gd-result-dialog").close();startGame();};
  $("#gd-landscape").onclick=async()=>{try{if(document.documentElement.requestFullscreen&&!document.fullscreenElement)await document.documentElement.requestFullscreen();if(screen.orientation?.lock)await screen.orientation.lock("landscape");}catch(e){setMessage("请旋转手机","浏览器不允许网页强制旋转时，请开启系统自动旋转");}};
  window.addEventListener("resize",()=>state.running&&renderHand());
  state.levelRank=LEVELS[state.levels[state.levelTeam]];updateAll();renderControls();
  window.__guandan={classify,beats,generateMoves,makeDeck,state};
})();
