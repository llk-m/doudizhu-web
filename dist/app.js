(() => {
  const RANKS = ['3','4','5','6','7','8','9','10','J','Q','K','A','2','小王','大王'];
  const SUITS = ['♠','♥','♣','♦'];
  const TURN_ORDER = [0,1,2];
  const VALUE = Object.fromEntries(RANKS.map((r,i)=>[r,i+3]));
  const state = { players:[[],[],[]], landlord:null, turn:0, phase:'idle', lastPlay:null, passes:0, selected:new Set(), multiplier:1, bottom:[], gameId:0, seenIds:new Set(), seenRanks:new Map(), visibleActions:[] };
  const $ = s => document.querySelector(s);
  const sleep = ms => new Promise(r=>setTimeout(r,ms));
  const suitRed = s => s==='♥'||s==='♦';
  const seatName = p => p===0?'你':p===1?'阿明':'小雅';
  const nextSeat = p => TURN_ORDER[(TURN_ORDER.indexOf(p)+1)%TURN_ORDER.length];
  function loadScoreHistory(){try{const v=JSON.parse(localStorage.getItem('ddz-score-history')||'[]');return Array.isArray(v)?v.slice(0,30):[]}catch{return []}}
  const scoreHistory=loadScoreHistory();

  // 原创五声音阶牌桌配乐：由 Web Audio 实时合成，无需下载音频文件。
  const music = { enabled:localStorage.getItem('ddz-music')==='on', ctx:null, timer:null, beat:0 };
  const MELODY = [0,4,7,9,7,4,2,0,4,7,12,9,7,4,2,-1,0,2,4,7,9,7,4,2];
  function pluck(freq,when,duration=.25,volume=.035,type='triangle'){
    const osc=music.ctx.createOscillator(),gain=music.ctx.createGain();osc.type=type;osc.frequency.setValueAtTime(freq,when);gain.gain.setValueAtTime(.0001,when);gain.gain.exponentialRampToValueAtTime(volume,when+.012);gain.gain.exponentialRampToValueAtTime(.0001,when+duration);osc.connect(gain).connect(music.ctx.destination);osc.start(when);osc.stop(when+duration+.03);
  }
  function musicTick(){
    if(!music.enabled||!music.ctx)return;const now=music.ctx.currentTime+.02,n=MELODY[music.beat%MELODY.length];
    if(n>=0)pluck(220*Math.pow(2,n/12),now,.28,.03,'triangle');
    if(music.beat%4===0)pluck(110*Math.pow(2,[0,5,7,4,0,7][Math.floor(music.beat/4)%6]/12),now,.42,.024,'sine');
    if(music.beat%2===1)pluck(music.beat%4===1?880:1320,now,.045,.007,'square');music.beat++;
  }
  function updateMusicButton(){const b=$('#music-btn');if(!b)return;b.classList.toggle('music-on',music.enabled);b.setAttribute('aria-pressed',String(music.enabled));b.setAttribute('aria-label',music.enabled?'关闭背景音乐':'开启背景音乐');b.title=music.enabled?'关闭背景音乐':'开启背景音乐'}
  async function startMusic(){
    if(!music.ctx)music.ctx=new (window.AudioContext||window.webkitAudioContext)();await music.ctx.resume();clearInterval(music.timer);musicTick();music.timer=setInterval(musicTick,270);
  }
  function stopMusic(){clearInterval(music.timer);music.timer=null;if(music.ctx?.state==='running')music.ctx.suspend()}
  async function toggleMusic(){music.enabled=!music.enabled;localStorage.setItem('ddz-music',music.enabled?'on':'off');updateMusicButton();if(music.enabled)await startMusic();else stopMusic()}

  function makeDeck(){
    const deck=[]; let id=0;
    for(const rank of RANKS.slice(0,13)) for(const suit of SUITS) deck.push({id:id++,rank,suit,value:VALUE[rank]});
    deck.push({id:id++,rank:'小王',suit:'JOKER',value:16},{id:id++,rank:'大王',suit:'JOKER',value:17});
    return shuffle(deck);
  }
  function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
  // 高牌在左、低牌在右，符合常见斗地主理牌习惯。
  function sortHand(a){return a.sort((x,y)=>y.value-x.value || SUITS.indexOf(x.suit)-SUITS.indexOf(y.suit))}
  function counts(cards){const m=new Map();cards.forEach(c=>m.set(c.value,(m.get(c.value)||0)+1));return m}
  function groups(cards){return [...counts(cards)].sort((a,b)=>a[0]-b[0])}
  function markSeen(cards){cards.forEach(c=>{if(state.seenIds.has(c.id))return;state.seenIds.add(c.id);state.seenRanks.set(c.rank,(state.seenRanks.get(c.rank)||0)+1)})}
  function renderCounter(){
    const el=$('#counter-grid');if(!el)return;el.innerHTML=[...RANKS].reverse().map(rank=>{const total=rank.includes('王')?1:4,left=Math.max(0,total-(state.seenRanks.get(rank)||0));return `<div class="counter-cell ${left===0?'empty':''}"><b>${rank==='小王'?'小':rank==='大王'?'大':rank}</b><span>${left}</span></div>`}).join('');
  }
  function renderScoreHistory(){
    const total=scoreHistory.reduce((sum,x)=>sum+x.delta,0),wins=scoreHistory.filter(x=>x.delta>0).length;
    $('#total-score').textContent=(total>0?'+':'')+total;$('#history-total').textContent=(total>0?'+':'')+total;$('#history-wins').textContent=wins;$('#history-losses').textContent=scoreHistory.length-wins;
    $('#score-history').innerHTML=scoreHistory.length?scoreHistory.map(x=>`<div class="score-row"><strong class="${x.delta>0?'win':'loss'}">${x.delta>0?'胜':'负'}</strong><span>${x.role} · ${x.multiplier}倍<br><small>${x.time}</small></span><b>${x.delta>0?'+':''}${x.delta}</b></div>`).join(''):'<p>完成一局后会显示记录</p>';
  }
  function recordScore(delta){scoreHistory.unshift({delta,role:state.landlord===0?'地主':'农民',multiplier:state.multiplier,time:new Date().toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})});scoreHistory.splice(30);localStorage.setItem('ddz-score-history',JSON.stringify(scoreHistory));renderScoreHistory()}
  async function enterLandscape(){
    try{if(document.documentElement.requestFullscreen&&!document.fullscreenElement)await document.documentElement.requestFullscreen();if(screen.orientation?.lock)await screen.orientation.lock('landscape');setHint('已进入横屏模式')}catch{setHint('请关闭手机竖屏锁定后，将手机横过来')}
  }

  function classify(cards){
    const n=cards.length;if(!n)return null;const g=groups(cards), vals=g.map(x=>x[0]), cs=g.map(x=>x[1]);
    const same=n===cs[0]&&g.length===1;
    if(n===1)return {type:'single',main:vals[0],len:1};
    if(n===2&&vals[0]===16&&vals[1]===17)return {type:'rocket',main:17,len:2};
    if(n===2&&same)return {type:'pair',main:vals[0],len:2};
    if(n===3&&same)return {type:'triple',main:vals[0],len:3};
    if(n===4&&same)return {type:'bomb',main:vals[0],len:4};
    if(n===4&&cs.includes(3))return {type:'triple1',main:vals[cs.indexOf(3)],len:4};
    if(n===5&&cs.includes(3)&&cs.includes(2))return {type:'triple2',main:vals[cs.indexOf(3)],len:5};
    const consecutive=vals.every((v,i)=>i===0||v===vals[i-1]+1)&&vals.at(-1)<15;
    if(n>=5&&g.length===n&&consecutive)return {type:'straight',main:vals.at(-1),len:n};
    if(n>=6&&n%2===0&&cs.every(x=>x===2)&&consecutive)return {type:'pairs',main:vals.at(-1),len:n};
    const triples=g.filter(x=>x[1]===3).map(x=>x[0]);
    const tripleRun=triples.length>=2&&triples.at(-1)<15&&triples.every((v,i)=>!i||v===triples[i-1]+1);
    if(tripleRun&&n===triples.length*3)return {type:'plane',main:triples.at(-1),len:n};
    if(tripleRun&&n===triples.length*4&&g.filter(x=>x[1]===1).length===triples.length)return {type:'plane1',main:triples.at(-1),len:n};
    if(tripleRun&&n===triples.length*5&&g.filter(x=>x[1]===2).length===triples.length)return {type:'plane2',main:triples.at(-1),len:n};
    if(n===6&&cs.includes(4))return {type:'four2',main:vals[cs.indexOf(4)],len:6};
    if(n===8&&cs.includes(4)&&cs.filter(x=>x===2).length===2)return {type:'four2pairs',main:vals[cs.indexOf(4)],len:8};
    return null;
  }
  function beats(a,b){if(!b)return true;if(a.type==='rocket')return true;if(b.type==='rocket')return false;if(a.type==='bomb'&&b.type!=='bomb')return true;if(a.type!==b.type||a.len!==b.len)return false;return a.main>b.main}
  function rankLabel(v){return RANKS[v-3]}
  const typeName={single:'单张',pair:'对子',triple:'三张',triple1:'三带一',triple2:'三带二',straight:'顺子',pairs:'连对',plane:'飞机',plane1:'飞机带单',plane2:'飞机带对',four2:'四带二',four2pairs:'四带两对',bomb:'炸弹',rocket:'王炸'};

  function cardHTML(c, small=false){
    if(c.rank.includes('王')) return small?`<div class="mini-card mini-joker ${c.rank==='大王'?'big-joker':'small-joker'}" data-id="${c.id}"><span>${c.rank==='大王'?'大':'小'}</span><b>★</b></div>`:`<div class="card joker ${c.rank==='大王'?'big-joker':'small-joker'}" data-id="${c.id}"><span class="card-rank">${c.rank}</span><span class="card-big">★</span></div>`;
    const red=suitRed(c.suit)?'red':'';
    if(small)return `<div class="mini-card ${red}">${c.rank}${c.suit}</div>`;
    return `<button class="card ${red}" data-id="${c.id}" aria-label="${c.rank}${c.suit}"><span class="card-rank">${c.rank}</span><span class="card-suit">${c.suit}</span><span class="card-big">${c.suit}</span></button>`;
  }
  function playedCardHTML(c){
    if(c.rank.includes('王'))return `<div class="card played-card joker ${c.rank==='大王'?'big-joker':'small-joker'}"><span class="card-rank">${c.rank}</span><span class="card-big">★</span></div>`;
    const red=suitRed(c.suit)?'red':'';return `<div class="card played-card ${red}"><span class="card-rank">${c.rank}</span><span class="card-suit">${c.suit}</span><span class="card-big">${c.suit}</span></div>`;
  }
  function render(){
    $('#hand').innerHTML=state.players[0].map(c=>cardHTML(c)).join('');
    state.selected.forEach(id=>{const el=document.querySelector(`.card[data-id="${id}"]`);if(el)el.classList.add('selected')});
    [1,2].forEach(i=>{$(`#count-${i}`).textContent=state.players[i].length;$(`#backs-${i}`).innerHTML=Array(Math.min(state.players[i].length,12)).fill('<i class="card-back"></i>').join('')});
    [0,1,2].forEach(i=>{$(`#player-${i}`).classList.toggle('is-landlord',state.landlord===i);$(`#player-${i}`).classList.toggle('turn',state.phase==='playing'&&state.turn===i)});
    $('#role-label').textContent=state.landlord===0?'地主':'农民';$('#multiplier').textContent=state.multiplier;renderCounter();fitHand();
  }
  function fitHand(){
    if(state.players[0].length<2){handEl.style.removeProperty('--hand-overlap');return}
    const isLandscape=innerWidth>innerHeight&&innerHeight<=600;if(innerWidth>760&&!isLandscape){handEl.style.removeProperty('--hand-overlap');return}
    const first=handEl.querySelector('.card');if(!first)return;const width=first.getBoundingClientRect().width,available=Math.max(220,handEl.clientWidth-(isLandscape?16:32)),fitStep=(available-width)/(state.players[0].length-1),step=isLandscape?Math.min(33,fitStep):fitStep;handEl.style.setProperty('--hand-overlap',`${Math.min(-8,step-width)}px`);
  }
  function setMessage(status,action=''){ $('#round-status').textContent=status;$('#last-action').textContent=action }
  function setHint(t){$('#hint').textContent=t}
  function setActions(html){$('#actions').innerHTML=html;bindActions()}
  function bindActions(){
    $('#start-btn')?.addEventListener('click',startGame);$('#call-btn')?.addEventListener('click',()=>humanBid(true));$('#no-call-btn')?.addEventListener('click',()=>humanBid(false));
    $('#play-btn')?.addEventListener('click',humanPlay);$('#pass-btn')?.addEventListener('click',humanPass);$('#suggest-btn')?.addEventListener('click',suggestPlay);
  }
  const handEl=$('#hand');let dragMode=null,dragPointer=null,ignorePointerClick=false,dragVisited=new Set();
  function canChoose(card){return card&&card.closest('#hand')===handEl&&state.phase==='playing'&&state.turn===0}
  function setCardChoice(card,selected){const id=Number(card.dataset.id);selected?state.selected.add(id):state.selected.delete(id);card.classList.toggle('selected',selected)}
  handEl.addEventListener('pointerdown',e=>{const card=e.target.closest('.card');if(!canChoose(card))return;dragPointer=e.pointerId;dragMode=!state.selected.has(Number(card.dataset.id));dragVisited=new Set();ignorePointerClick=true;handEl.setPointerCapture?.(e.pointerId);dragVisited.add(card.dataset.id);setCardChoice(card,dragMode);validateSelection();e.preventDefault()});
  handEl.addEventListener('pointermove',e=>{if(e.pointerId!==dragPointer||dragMode===null)return;const card=document.elementFromPoint(e.clientX,e.clientY)?.closest('.card');if(canChoose(card)&&!dragVisited.has(card.dataset.id)){dragVisited.add(card.dataset.id);setCardChoice(card,dragMode);validateSelection()}const rect=handEl.getBoundingClientRect();if(e.clientX<rect.left+34)handEl.scrollLeft-=12;if(e.clientX>rect.right-34)handEl.scrollLeft+=12;e.preventDefault()});
  function endDrag(e){if(e.pointerId!==dragPointer)return;dragMode=null;dragPointer=null;dragVisited.clear();setTimeout(()=>{ignorePointerClick=false},500)}
  handEl.addEventListener('pointerup',endDrag);handEl.addEventListener('pointercancel',endDrag);
  handEl.addEventListener('click',e=>{if(ignorePointerClick){ignorePointerClick=false;return}const card=e.target.closest('.card');if(!canChoose(card))return;setCardChoice(card,!state.selected.has(Number(card.dataset.id)));validateSelection()});

  async function startGame(){
    if(innerWidth<=900&&innerHeight>innerWidth&&!document.fullscreenElement)enterLandscape();
    if(music.enabled)startMusic().catch(()=>{});
    state.gameId++;const gid=state.gameId;Object.assign(state,{players:[[],[],[]],landlord:null,turn:0,phase:'bidding',lastPlay:null,passes:0,selected:new Set(),multiplier:1,bottom:[],seenIds:new Set(),seenRanks:new Map(),visibleActions:[]});
    const deck=makeDeck();state.bottom=deck.splice(-3);for(let i=0;i<51;i++)state.players[i%3].push(deck[i]);state.players.forEach(sortHand);
    markSeen(state.players[0]);
    [0,1,2].forEach(i=>$(`#played-${i}`).innerHTML='');
    $('#landlord-cards').innerHTML=state.bottom.map(()=>'<div class="mini-card hidden">?</div>').join('');setMessage('叫地主','每局随机一位玩家先叫');render();
    setActions('');state.bidLog=[];state.bidder=null;state.gid=gid;state.bidIndex=0;const first=Math.floor(Math.random()*3);state.bidOrder=[...TURN_ORDER.slice(first),...TURN_ORDER.slice(0,first)];continueBidding();
  }
  function bidStrength(hand){
    const by=counts(hand),vals=[...by.keys()].sort((a,b)=>a-b),hasRocket=by.has(16)&&by.has(17),triples=vals.filter(v=>by.get(v)>=3).length,pairs=vals.filter(v=>by.get(v)>=2).length;
    let longest=1,run=1;for(let i=1;i<vals.length;i++){run=vals[i]<15&&vals[i]===vals[i-1]+1?run+1:1;longest=Math.max(longest,run)}
    return (hasRocket?8:0)+[...by.values()].filter(x=>x===4).length*5+(by.get(17)?3.5:0)+(by.get(16)?2.5:0)+(by.get(15)||0)*1.7+(by.get(14)||0)*.55+triples*.75+pairs*.18+(longest>=5?1.2:0);
  }
  async function humanBid(call){if(state.phase!=='bidding'||state.bidder!==0)return;state.bidLog.push({p:0,call,score:call?bidStrength(state.players[0])+.35:0});state.bidIndex++;setActions('');setMessage(call?'你叫了地主':'你选择不叫');await sleep(350);continueBidding()}
  async function continueBidding(){
    const gid=state.gid;if(state.phase!=='bidding')return;
    if(state.bidIndex>=3){const callers=state.bidLog.filter(x=>x.call).sort((a,b)=>b.score-a.score);if(!callers.length){setMessage('无人叫地主','重新发牌');await sleep(700);if(gid===state.gameId)startGame();return}return assignLandlord(callers[0].p)}
    const p=state.bidOrder[state.bidIndex];state.bidder=p;
    if(p===0){setActions('<button class="btn" id="no-call-btn">不叫</button><button class="btn primary" id="call-btn">叫地主</button>');setHint('轮到你叫地主');return}
    setActions('');setHint(`${seatName(p)}正在考虑…`);await sleep(550+Math.random()*350);if(gid!==state.gameId)return;
    const strength=bidStrength(state.players[p]);
    const call=strength>=6||(strength>=4.4&&Math.random()>.22);state.bidLog.push({p,call,score:call?strength+Math.random()*.25:0});state.bidIndex++;setMessage(call?`${seatName(p)}叫地主`:`${seatName(p)}不叫`);await sleep(400);continueBidding();
  }
  function assignLandlord(p){state.landlord=p;state.players[p].push(...state.bottom);if(p===0)markSeen(state.bottom);sortHand(state.players[p]);state.phase='playing';state.turn=p;$('#landlord-cards').innerHTML=state.bottom.map(c=>cardHTML(c,true)).join('');setMessage(`${seatName(p)}成为地主`,'地主先出牌 · 顺时针');render();beginTurn()}
  async function beginTurn(){
    if(state.phase!=='playing')return;render();const name=state.turn===0?'轮到你':state.turn===1?'阿明出牌':'小雅出牌';setMessage(name,state.lastPlay?`当前：${typeName[state.lastPlay.combo.type]}`:'自由出牌');
    if(state.turn===0){setActions(`<button class="btn" id="suggest-btn">提示</button>${state.lastPlay?'<button class="btn" id="pass-btn">不出</button>':''}<button class="btn primary" id="play-btn" disabled>出牌</button>`);setHint(state.lastPlay?'请选择能压过上家的牌':'请选择要出的牌');validateSelection()}
    else{setActions('');setHint('电脑玩家正在思考…');await sleep(700+Math.random()*500);computerTurn(state.turn)}
  }
  function validateSelection(){const cards=state.players[0].filter(c=>state.selected.has(c.id)),combo=classify(cards);const ok=combo&&beats(combo,state.lastPlay?.combo);const b=$('#play-btn');if(b)b.disabled=!ok;setHint(!cards.length?(state.lastPlay?'请选择能压过上家的牌':'请选择要出的牌'):!combo?'这不是有效牌型':!beats(combo,state.lastPlay?.combo)?'这手牌压不过上一手':`${typeName[combo.type]}，可以出牌`)}
  function humanPlay(){const cards=state.players[0].filter(c=>state.selected.has(c.id));const combo=classify(cards);if(!combo||!beats(combo,state.lastPlay?.combo))return;state.selected.clear();commitPlay(0,cards,combo)}
  function humanPass(){if(!state.lastPlay)return;state.selected.clear();commitPass(0)}
  function suggestPlay(){const cards=findMove(state.players[0],state.lastPlay?.combo);state.selected=new Set(cards.map(c=>c.id));render();validateSelection();if(!cards.length)setHint('没有能压过的牌，建议不出')}

  function combinations(arr,k){const out=[];function rec(start,p){if(p.length===k){out.push([...p]);return}for(let i=start;i<=arr.length-(k-p.length);i++){p.push(arr[i]);rec(i+1,p);p.pop()}}rec(0,[]);return out}
  function generateMoves(hand){
    const by=new Map();hand.forEach(c=>{if(!by.has(c.value))by.set(c.value,[]);by.get(c.value).push(c)});const vals=[...by.keys()].sort((a,b)=>a-b),moves=[];
    vals.forEach(v=>{const a=by.get(v);moves.push([a[0]]);if(a.length>=2)moves.push(a.slice(0,2));if(a.length>=3)moves.push(a.slice(0,3));if(a.length===4)moves.push(a.slice(0,4))});
    if(by.has(16)&&by.has(17))moves.push([by.get(16)[0],by.get(17)[0]]);
    vals.forEach(v=>{const a=by.get(v);if(a.length>=3){vals.filter(x=>x!==v).forEach(x=>{moves.push([...a.slice(0,3),by.get(x)[0]]);if(by.get(x).length>=2)moves.push([...a.slice(0,3),...by.get(x).slice(0,2)])})}});
    vals.filter(v=>by.get(v).length===4).forEach(v=>{
      const rest=vals.filter(x=>x!==v);combinations(rest,2).forEach(xs=>moves.push([...by.get(v),...xs.map(x=>by.get(x)[0])]));
      combinations(rest.filter(x=>by.get(x).length>=2),2).forEach(xs=>moves.push([...by.get(v),...xs.flatMap(x=>by.get(x).slice(0,2))]));
    });
    const normal=vals.filter(v=>v<15);for(let i=0;i<normal.length;i++){for(let j=i+4;j<normal.length;j++){const seq=normal.slice(i,j+1);if(seq.every((v,k)=>!k||v===seq[k-1]+1))moves.push(seq.map(v=>by.get(v)[0]));else break}}
    const pairVals=normal.filter(v=>by.get(v).length>=2);for(let i=0;i<pairVals.length;i++){for(let j=i+2;j<pairVals.length;j++){const seq=pairVals.slice(i,j+1);if(seq.every((v,k)=>!k||v===seq[k-1]+1))moves.push(seq.flatMap(v=>by.get(v).slice(0,2)));else break}}
    const triVals=normal.filter(v=>by.get(v).length>=3);for(let i=0;i<triVals.length;i++){for(let j=i+1;j<triVals.length;j++){const seq=triVals.slice(i,j+1);if(seq.every((v,k)=>!k||v===seq[k-1]+1)){
      const core=seq.flatMap(v=>by.get(v).slice(0,3));moves.push(core);
      const rest=vals.filter(v=>!seq.includes(v));
      combinations(rest,seq.length).forEach(xs=>moves.push([...core,...xs.map(v=>by.get(v)[0])]));
      combinations(rest.filter(v=>by.get(v).length>=2),seq.length).forEach(xs=>moves.push([...core,...xs.flatMap(v=>by.get(v).slice(0,2))]));
    }else break}}
    const unique=new Map();moves.forEach(cards=>unique.set(cards.map(c=>c.id).sort((a,b)=>a-b).join(','),cards));return [...unique.values()];
  }
  function handCost(cards){
    if(!cards.length)return -1000;const by=counts(cards), vals=[...by.keys()].sort((a,b)=>a-b);let cost=vals.length;
    const normal=vals.filter(v=>v<15);let run=1,bestRun=1;for(let i=1;i<normal.length;i++){run=normal[i]===normal[i-1]+1?run+1:1;bestRun=Math.max(bestRun,run)}if(bestRun>=5)cost-=bestRun-1;
    const pairs=normal.filter(v=>by.get(v)>=2);run=1;let bestPairs=1;for(let i=1;i<pairs.length;i++){run=pairs[i]===pairs[i-1]+1?run+1:1;bestPairs=Math.max(bestPairs,run)}if(bestPairs>=3)cost-=bestPairs-1;
    const tripleCount=vals.filter(v=>by.get(v)>=3).length,wingCount=vals.filter(v=>by.get(v)<=2).length;cost-=Math.min(tripleCount,wingCount)*.8;
    cost+=vals.filter(v=>by.get(v)===1).length*.42;cost-=vals.filter(v=>by.get(v)===4).length*.5;return cost;
  }
  function enemiesOf(p){return [0,1,2].filter(i=>i!==p&&(state.landlord===p||i===state.landlord))}
  function isTeammate(p,i){return p!==state.landlord&&i!==state.landlord&&p!==i}
  function followUpQuality(cards){
    if(!cards.length)return -4;const moves=generateMoves(cards).map(x=>({cards:x,combo:classify(x)})).filter(x=>x.combo);if(!moves.length)return 20;
    const biggest=Math.max(...moves.map(x=>x.cards.length));const finishers=moves.filter(x=>x.cards.length===cards.length).length;return handCost(cards)*4-biggest*1.15-finishers*30;
  }
  function attachmentPenalty(p,move){
    const t=move.combo.type;if(!['triple1','triple2','plane1','plane2','four2','four2pairs'].includes(t))return 0;
    let core=new Set([move.combo.main]);if(t.startsWith('plane')){const n=move.combo.len/(t==='plane1'?4:5);core=new Set(Array.from({length:n},(_,i)=>move.combo.main-i))}
    const original=counts(state.players[p]),used=counts(move.cards.filter(c=>!core.has(c.value)));let penalty=t.startsWith('four')?24:0;
    for(const [v,n] of used){penalty+=n*(v>=16?34:v===15?25:v===14?8:v*.16);if((original.get(v)||0)>n)penalty+=6}
    return penalty;
  }
  function moveScore(p,move,target){
    const remaining=state.players[p].filter(c=>!move.cards.some(x=>x.id===c.id));if(!remaining.length)return -10000;
    const enemies=enemiesOf(p),danger=Math.min(...enemies.map(i=>state.players[i].length));let score=handCost(remaining)*8+followUpQuality(remaining)+move.combo.main*.08+attachmentPenalty(p,move);
    if(['bomb','rocket'].includes(move.combo.type))score+=danger<=2?1:36;
    if(move.cards.some(c=>c.value>=15)&&remaining.length>4)score+=danger<=2?2:13;
    if(!target){
      score-=move.cards.length*1.15;score+=move.combo.main*.3;
      if(['single','pair'].includes(move.combo.type)&&move.combo.main>=15&&danger>2)score+=25;
      if(danger===1&&move.combo.type==='single')score+=42-move.combo.main*1.6;
      if(danger===1&&move.combo.type!=='single')score-=12;
      const mate=[0,1,2].find(i=>isTeammate(p,i));if(mate!==undefined&&state.players[mate].length===1&&move.combo.type==='single')score+=move.combo.main*.7-14;
    }
    if(enemies.some(i=>state.players[i].length===1)&&move.combo.type==='single')score-=move.combo.main*1.15;
    if(target&&state.lastPlay&&enemies.includes(state.lastPlay.player)&&danger<=2)score-=move.combo.main*.35;
    return score;
  }
  function findMove(hand,target,p=0){
    let moves=generateMoves(hand).map(cards=>({cards,combo:classify(cards)})).filter(x=>x.combo&&beats(x.combo,target));if(!moves.length)return [];
    if(!target){const sensible=moves.filter(m=>!['four2','four2pairs','bomb','rocket'].includes(m.combo.type));if(sensible.length)moves=sensible}
    const teammateLead=target&&state.landlord!==p&&state.lastPlay&&state.landlord!==state.lastPlay.player;
    if(teammateLead){const winning=moves.find(m=>m.cards.length===hand.length),landlordDanger=state.players[state.landlord].length<=2;if(winning)return winning.cards;if(!landlordDanger)return [];moves=moves.filter(m=>!['bomb','rocket'].includes(m.combo.type));if(!moves.length)return [];}
    moves.sort((a,b)=>moveScore(p,a,target)-moveScore(p,b,target));return moves[0].cards;
  }
  function computerTurn(p){const cards=findMove(state.players[p],state.lastPlay?.combo,p);if(cards.length){const combo=classify(cards);commitPlay(p,cards,combo)}else commitPass(p)}
  function commitPlay(p,cards,combo){state.players[p]=state.players[p].filter(c=>!cards.some(x=>x.id===c.id));markSeen(cards);state.lastPlay={player:p,combo,cards};state.passes=0;if(combo.type==='bomb'||combo.type==='rocket')state.multiplier*=2;showPlayed(p,cards);setMessage(`${seatName(p)}出了${typeName[combo.type]}`,combo.type==='bomb'||combo.type==='rocket'?'倍数翻倍！':'传给下一家');render();if(!state.players[p].length)return finish(p);state.turn=nextSeat(p);setTimeout(beginTurn,550)}
  function commitPass(p){showPlayed(p,[]);state.passes++;setMessage(`${seatName(p)}选择不出`,'传给下一家');if(state.passes>=2){const leader=state.lastPlay.player;state.lastPlay=null;state.passes=0;state.turn=leader}else state.turn=nextSeat(p);render();setTimeout(beginTurn,450)}
  function showPlayed(p,cards){
    state.visibleActions=state.visibleActions.filter(seat=>seat!==p);state.visibleActions.push(p);
    while(state.visibleActions.length>2){const oldest=state.visibleActions.shift(),oldZone=$(`#played-${oldest}`);oldZone.innerHTML='';oldZone.classList.remove('dealt')}
    const z=$(`#played-${p}`),name=seatName(p);z.innerHTML='';if(!cards.length){z.innerHTML=`<span class="pass-bubble">${name} · 不出</span>`;return}const combo=classify(cards);z.innerHTML=`<span class="play-label">${name} · ${typeName[combo.type]}</span><div class="played-cards">${sortHand([...cards]).map(playedCardHTML).join('')}</div>`;z.classList.remove('dealt');void z.offsetWidth;z.classList.add('dealt')
  }
  function finish(winner){state.phase='over';const humanWin=winner===0||(state.landlord!==0&&winner!==state.landlord);const delta=state.multiplier*(state.landlord===0?2:1)*(humanWin?1:-1);recordScore(delta);$('#result-icon').textContent=humanWin?'胜':'负';$('#result-title').textContent=humanWin?'本局获胜':'再接再厉';$('#result-copy').textContent=humanWin?'配合漂亮，牌桌由你掌控。':'差一点就赢了，调整策略再来一局。';$('#result-score').textContent=(delta>0?'+':'')+delta;setActions('<button class="btn primary" id="start-btn">再来一局</button>');setHint('本局结束');render();setTimeout(()=>$('#result-dialog').showModal(),450)}

  $('#music-btn').addEventListener('click',toggleMusic);updateMusicButton();window.addEventListener('resize',fitHand);
  $('#landscape-btn').addEventListener('click',enterLandscape);$('#score-btn').addEventListener('click',()=>{$('#score-dialog').showModal();renderScoreHistory()});$('#score-dialog .close-btn').addEventListener('click',()=>$('#score-dialog').close());
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stopMusic();else if(music.enabled)startMusic().catch(()=>{})});
  $('#rules-btn').addEventListener('click',()=>$('#rules-dialog').showModal());$('#rules-dialog .close-btn').addEventListener('click',()=>$('#rules-dialog').close());$('#again-btn').addEventListener('click',()=>{$('#result-dialog').close();startGame()});bindActions();

  function requireEmptyInput(input){if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length)throw new Error('此操作不接受参数')}
  function registerWebMCP(){const ctx=document.modelContext;if(!ctx?.registerTool)return;try{ctx.registerTool({name:'start_doudizhu_game',title:'开始斗地主',description:'开始一局新的单机斗地主游戏。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute:async(input)=>{requireEmptyInput(input);await startGame();return {status:'bidding',handSize:state.players[0].length}}});ctx.registerTool({name:'get_doudizhu_state',title:'查看牌局状态',description:'读取当前斗地主牌局的阶段、轮次和手牌数量。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},execute:(input)=>{requireEmptyInput(input);return {phase:state.phase,turn:state.turn,landlord:state.landlord,handSizes:state.players.map(x=>x.length),multiplier:state.multiplier}}})}catch(e){console.warn('WebMCP unavailable',e)}}
  renderCounter();renderScoreHistory();registerWebMCP();
})();
