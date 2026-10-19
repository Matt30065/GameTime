const names=["Alex","Ben","Charlie","Dylan","Ethan","Sam","Jamie","Noah","Leo","Owen"];
let players=names.map((name,i)=>({id:i,name,number:i+1,on:i<5,total:0,spell:0,lastOnAt:i<5?0:null,lastOffAt:i<5?null:0}));
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
  document.querySelectorAll(".num-edit").forEach(i=>i.onchange=e=>{players.find(p=>p.id==e.target.dataset.id).number=e.target.value||0;});
  document.querySelectorAll(".name-edit").forEach(i=>i.onchange=e=>{players.find(p=>p.id==e.target.dataset.id).name=e.target.value.trim()||"Player";});
}
$("#startingCount").addEventListener("change",e=>{
  desiredStarters=Math.max(1,Math.min(players.length,+e.target.value||1));
  const selected=players.filter(p=>p.on);
  if(selected.length>desiredStarters) selected.slice(desiredStarters).forEach(p=>p.on=false);
  if(selected.length<desiredStarters) players.filter(p=>!p.on).slice(0,desiredStarters-selected.length).forEach(p=>p.on=true);
  renderSetup();
});

function matchTile(p,clickable=false){
  return `<button class="player-tile ${p.on?"on":""}" ${clickable?"":"tabindex='-1'"} data-id="${p.id}">
    <div class="shirt">${p.number}</div><div class="player-name">${p.name}</div>
    <div class="tile-time"><strong>${p.on?fmt(p.spell):"BENCH"}</strong>Total ${fmt(p.total)}</div>
  </button>`;
}
function currentPeriod(){
  return Math.max(1,Math.min(periods,Math.floor(elapsed/periodLength)+1));
}
function periodName(n){
  if(periods===2) return n===1?"1st half":"2nd half";
  return `Period ${n} of ${periods}`;
}

/* Balance engine v3
   The equal share is a full-time destination, not a substitution trigger.
   Each possible swap is projected against the time remaining. We also apply
   a fading stability cost so the engine does not immediately undo a change:
   - taking off somebody who has only just come on is expensive;
   - bringing back somebody who has only just gone off is expensive.
   These are soft penalties, not bans, so unusual grassroots situations remain
   possible. The displayed top five are diversified by outgoing player. */
function stabilityPenalty(off,incoming){
  const MIN_STABLE_SPELL=4*60;   // strongest protection during first 4 mins on
  const MIN_BENCH_REST=3*60;     // strongest protection during first 3 mins off
  const offShortfall=Math.max(0,MIN_STABLE_SPELL-off.spell)/MIN_STABLE_SPELL;
  const benchRest=incoming.lastOffAt==null ? Infinity : Math.max(0,elapsed-incoming.lastOffAt);
  const restShortfall=Math.max(0,MIN_BENCH_REST-benchRest)/MIN_BENCH_REST;
  // Scale in squared-seconds, comparable with the fairness score below.
  return (offShortfall*offShortfall*90000)+(restShortfall*restShortfall*70000);
}
function suggestionOptions(){
  const on=players.filter(p=>p.on), bench=players.filter(p=>!p.on);
  if(!on.length||!bench.length) return [];
  const remaining=Math.max(0,matchLength-elapsed);
  const slots=on.length;
  const totalAtEnd=players.reduce((s,p)=>s+p.total,0)+remaining*slots;
  const target=totalAtEnd/players.length;
  const all=[];

  for(const off of on) for(const incoming of bench){
    const futureOn=on.filter(p=>p!==off).concat(incoming);
    const projected=new Map(players.map(p=>[p.id,p.total]));

    // Look one sensible rotation block ahead, then allocate the rest toward
    // each player's remaining deficit. This makes time-left part of the score.
    const rotationBlock=Math.min(remaining,Math.max(90,remaining/(Math.max(1,bench.length)+1)));
    futureOn.forEach(p=>projected.set(p.id,projected.get(p.id)+rotationBlock));
    const futureCapacity=Math.max(0,remaining-rotationBlock)*slots;
    const deficits=players.map(p=>Math.max(0,target-projected.get(p.id)));
    const deficitTotal=deficits.reduce((a,b)=>a+b,0);
    if(deficitTotal>0){
      players.forEach((p,i)=>projected.set(p.id,projected.get(p.id)+futureCapacity*(deficits[i]/deficitTotal)));
    }

    const fairness=players.reduce((sum,p)=>sum+Math.pow(projected.get(p.id)-target,2),0);
    const stability=stabilityPenalty(off,incoming);
    all.push({off,incoming,score:fairness+stability,fairness,stability});
  }
  all.sort((a,b)=>a.score-b.score);

  // Give the coach genuinely different choices: first take the best option for
  // each different outgoing player, then fill any spare slots by overall score.
  const chosen=[], usedOff=new Set();
  for(const option of all){
    if(!usedOff.has(option.off.id)){
      chosen.push(option); usedOff.add(option.off.id);
      if(chosen.length===5) return chosen;
    }
  }
  for(const option of all){
    if(!chosen.includes(option)) chosen.push(option);
    if(chosen.length===5) break;
  }
  return chosen;
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
  off.on=false;off.spell=0;off.lastOffAt=elapsed;incoming.on=true;incoming.spell=0;incoming.lastOnAt=elapsed;
  $("#status").textContent=`${label}: #${off.number} ${off.name} off, #${incoming.number} ${incoming.name} on.`;
  renderMatch();
}
function tick(){
  if(elapsed>=matchLength){finish();return}
  elapsed++;
  players.forEach(p=>{if(p.on){p.total++;p.spell++;}});
  renderMatch();
}
$("#startMatch").addEventListener("click",()=>{
  try {
    const hm=Math.max(5,Number($("#halfMinutes").value)||20);
    periods=Math.max(1,Number($("#periodCount").value)||2);
    desiredStarters=Math.max(1,Math.min(players.length,Number($("#startingCount").value)||5));
    periodLength=hm*60; matchLength=periodLength*periods;
    const selected=players.filter(p=>p.on).length;
    if(selected!==desiredStarters){
      $("#setupMessage").textContent=`Select exactly ${desiredStarters} starters (currently ${selected}).`;
      return;
    }
    $("#setupMessage").textContent="";
    elapsed=0; players.forEach(p=>{p.total=0;p.spell=0;});
    $("#setupScreen").hidden=true;
    $("#matchScreen").hidden=false;
    running=true;
    $("#pauseBtn").textContent="Pause";
    clearInterval(timer); timer=setInterval(tick,1000);
    $("#status").textContent="Match started.";
    renderMatch();
    window.scrollTo({top:0,behavior:"instant"});
  } catch(err) {
    console.error(err);
    $("#setupMessage").textContent="Could not start the match. Please refresh and try again.";
  }
});
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
    p.on=mode==="add";p.spell=0;if(mode==="add"){p.lastOnAt=elapsed}else{p.lastOffAt=elapsed}
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