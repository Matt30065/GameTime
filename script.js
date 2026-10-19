const names=["Alex","Ben","Charlie","Dylan","Ethan","Sam","Jamie","Noah","Leo","Owen"];
let players=names.map((name,i)=>({id:i,name,number:i+1,on:i<5,total:0,spell:0}));
let elapsed=0,running=false,timer=null,matchLength=2400,periodLength=1200,periods=2,desiredStarters=5;
let overrideOff=null;

const $=s=>document.querySelector(s);
const fmt=s=>`${String(Math.floor(Math.max(0,s)/60)).padStart(2,"0")}:${String(Math.max(0,s)%60).padStart(2,"0")}`;

function setupTile(p){
  return `<div class="player-tile ${p.on?"selected":""}" data-id="${p.id}">
    <div class="shirt">${p.number}</div><div class="player-name">${p.name}</div>
    <div class="edit-row">
      <input class="num-edit" data-id="${p.id}" type="number" min="0" max="99" value="${p.number}" aria-label="Shirt number">
      <input class="name-edit" data-id="${p.id}" value="${p.name}" aria-label="Player name">
    </div>
  </div>`;
}
function renderSetup(){
  $("#setupPlayers").innerHTML=players.map(setupTile).join("");
  const count=players.filter(p=>p.on).length;
  $("#starterCount").textContent=`${count} / ${desiredStarters} selected`;
  document.querySelectorAll("#setupPlayers .player-tile").forEach(t=>t.onclick=e=>{
    if(e.target.matches("input")) return;
    const p=players.find(x=>x.id==t.dataset.id);
    if(p.on){p.on=false}else if(players.filter(x=>x.on).length<desiredStarters){p.on=true}
    renderSetup();
  });
  document.querySelectorAll(".num-edit").forEach(i=>i.oninput=e=>players.find(p=>p.id==e.target.dataset.id).number=e.target.value||0);
  document.querySelectorAll(".name-edit").forEach(i=>i.oninput=e=>players.find(p=>p.id==e.target.dataset.id).name=e.target.value||"Player");
}
$("#startingCount").oninput=e=>{
  desiredStarters=Math.max(1,Math.min(players.length,+e.target.value||1));
  const selected=players.filter(p=>p.on);
  if(selected.length>desiredStarters) selected.slice(desiredStarters).forEach(p=>p.on=false);
  if(selected.length<desiredStarters) players.filter(p=>!p.on).slice(0,desiredStarters-selected.length).forEach(p=>p.on=true);
  renderSetup();
};

function matchTile(p,clickable=false){
  return `<button class="player-tile ${p.on?"on":""}" ${clickable?"":"tabindex='-1'"} data-id="${p.id}">
    <div class="shirt">${p.number}</div><div class="player-name">${p.name}</div>
    <div class="tile-time"><strong>${p.on?fmt(p.spell):"BENCH"}</strong>Total ${fmt(p.total)}</div>
  </button>`;
}
function currentPeriod(){
  return Math.min(periods,Math.floor(elapsed/periodLength)+1);
}
function periodName(n){
  if(periods===2) return n===1?"1st half":"2nd half";
  return `Period ${n} of ${periods}`;
}

/* Optimization:
   At every refresh, score every possible one-for-one swap using the remaining
   match time. For each candidate, estimate the fairest attainable distribution
   from now to full time, rather than treating the equal-share target as a hard
   substitution threshold. Lower projected squared deviation = fairer outcome. */
function suggestionOptions(){
  const on=players.filter(p=>p.on), bench=players.filter(p=>!p.on);
  if(!on.length||!bench.length) return [];
  const remaining=Math.max(0,matchLength-elapsed);
  const slots=on.length;
  const totalPlayerMinutesAtEnd=players.reduce((s,p)=>s+p.total,0)+remaining*slots;
  const target=totalPlayerMinutesAtEnd/players.length;
  const opts=[];
  for(const off of on) for(const incoming of bench){
    const futureOn=on.filter(p=>p!==off).concat(incoming);
    const projected=new Map(players.map(p=>[p.id,p.total]));
    // Approximate future allocation: current proposed on-field group receives
    // the next rotation block; deficit weighting rewards players furthest below
    // the attainable final average.
    const block=Math.min(remaining,Math.max(60,remaining/(Math.max(1,bench.length)+1)));
    futureOn.forEach(p=>projected.set(p.id,projected.get(p.id)+block));
    const rest=Math.max(0,remaining-block)*slots;
    const deficits=players.map(p=>Math.max(0,target-projected.get(p.id)));
    const sumDef=deficits.reduce((a,b)=>a+b,0)||1;
    players.forEach((p,i)=>projected.set(p.id,projected.get(p.id)+rest*(deficits[i]/sumDef)));
    const score=players.reduce((s,p)=>s+Math.pow(projected.get(p.id)-target,2),0);
    opts.push({off,incoming,score});
  }
  return opts.sort((a,b)=>a.score-b.score).slice(0,5);
}
function renderSuggestions(){
  const opts=suggestionOptions();
  $("#suggestions").innerHTML=opts.length?opts.map((o,i)=>`
    <button class="suggestion" data-off="${o.off.id}" data-on="${o.incoming.id}">
      <span class="rank">${i+1}</span>
      <span class="swap">#${o.off.number} ${o.off.name} OFF → #${o.incoming.number} ${o.incoming.name} ON</span>
      <span class="reason">${i===0?"Best projected balance":"Alternative"}</span>
    </button>`).join(""):`<p class="subtle">No one-for-one substitution available.</p>`;
  document.querySelectorAll(".suggestion").forEach(b=>b.onclick=()=>sub(+b.dataset.off,+b.dataset.on,"Suggested change"));
}
function renderMatch(){
  $("#matchClock").textContent=fmt(elapsed);
  $("#periodLabel").textContent=periodName(currentPeriod());
  $("#pitchTiles").innerHTML=players.filter(p=>p.on).map(p=>matchTile(p)).join("");
  $("#benchTiles").innerHTML=players.filter(p=>!p.on).map(p=>matchTile(p)).join("");
  $("#pitchCount").textContent=`${players.filter(p=>p.on).length} playing`;
  renderSuggestions();
}
function sub(offId,onId,label="Change"){
  const off=players.find(p=>p.id===offId), incoming=players.find(p=>p.id===onId);
  if(!off?.on||!incoming||incoming.on)return;
  off.on=false;off.spell=0;incoming.on=true;incoming.spell=0;
  $("#status").textContent=`${label}: #${off.number} ${off.name} off, #${incoming.number} ${incoming.name} on.`;
  renderMatch();
}
function tick(){
  if(elapsed>=matchLength){finish();return}
  elapsed++;
  players.forEach(p=>{if(p.on){p.total++;p.spell++;}});
  renderMatch();
}
$("#startMatch").onclick=()=>{
  const hm=Math.max(5,+$("#halfMinutes").value||20);
  periods=Math.max(1,+$("#periodCount").value||2);
  periodLength=hm*60;matchLength=periodLength*periods;
  desiredStarters=Math.max(1,+$("#startingCount").value||5);
  if(players.filter(p=>p.on).length!==desiredStarters){
    $("#setupMessage").textContent=`Please select exactly ${desiredStarters} starters.`;return;
  }
  $("#setupScreen").hidden=true;$("#matchScreen").hidden=false;
  running=true;$("#pauseBtn").textContent="Pause";timer=setInterval(tick,1000);
  $("#status").textContent="Match started.";renderMatch();
};
$("#pauseBtn").onclick=()=>{
  running=!running;$("#pauseBtn").textContent=running?"Pause":"Resume";
  clearInterval(timer);if(running)timer=setInterval(tick,1000);
  $("#status").textContent=running?"Match resumed.":"Match paused.";
};
$("#endBtn").onclick=finish;

function openOverride(){
  overrideOff=null;$("#overrideTitle").textContent="Who is coming off?";
  $("#overrideTiles").innerHTML=players.filter(p=>p.on).map(p=>matchTile(p,true)).join("");
  $("#overrideTiles").querySelectorAll(".player-tile").forEach(t=>t.onclick=()=>{
    overrideOff=+t.dataset.id;$("#overrideTitle").textContent="Who is going on?";
    $("#overrideTiles").innerHTML=players.filter(p=>!p.on).map(p=>matchTile(p,true)).join("");
    $("#overrideTiles").querySelectorAll(".player-tile").forEach(x=>x.onclick=()=>{
      const onId=+x.dataset.id;const off=players.find(p=>p.id===overrideOff),inc=players.find(p=>p.id===onId);
      sub(overrideOff,onId,"Coach override");$("#overrideDialog").close();
      $("#status").textContent=`Confirmed: #${off.number} ${off.name} off, #${inc.number} ${inc.name} on.`;
    });
  });
  $("#overrideDialog").showModal();
}
$("#overrideBtn").onclick=openOverride;
$("#cancelOverride").onclick=()=>$("#overrideDialog").close();

function openSingle(mode){
  const pool=mode==="add"?players.filter(p=>!p.on):players.filter(p=>p.on);
  $("#singleTitle").textContent=mode==="add"?"Add a player to the pitch":"Remove a player from the pitch";
  $("#singleTiles").innerHTML=pool.map(p=>matchTile(p,true)).join("");
  $("#singleTiles").querySelectorAll(".player-tile").forEach(t=>t.onclick=()=>{
    const p=players.find(x=>x.id==t.dataset.id);
    p.on=mode==="add";p.spell=0;
    $("#singleActionDialog").close();
    $("#status").textContent=mode==="add"?`#${p.number} ${p.name} added to the pitch.`:`#${p.number} ${p.name} removed from the pitch.`;
    renderMatch();
  });
  $("#singleActionDialog").showModal();
}
$("#addPitchBtn").onclick=()=>openSingle("add");
$("#removePitchBtn").onclick=()=>openSingle("remove");
$("#cancelSingle").onclick=()=>$("#singleActionDialog").close();

function finish(){
  running=false;clearInterval(timer);
  const slots=players.reduce((s,p)=>s+p.total,0);
  const equal=slots/players.length;
  $("#summaryText").textContent=`Actual equal-share reference for this match: ${fmt(Math.round(equal))} per player.`;
  $("#summaryList").innerHTML=[...players].sort((a,b)=>b.total-a.total).map(p=>{
    const d=Math.round((p.total-equal)/60),sign=d>0?"+":"";
    return `<div class="summary-row"><span>#${p.number} ${p.name}</span><strong>${fmt(p.total)}</strong><span class="delta">${sign}${d} min</span></div>`;
  }).join("");
  $("#summaryDialog").showModal();
}
$("#newMatchBtn").onclick=()=>location.reload();

renderSetup();