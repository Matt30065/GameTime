const names=["Alex","Ben","Charlie","Dylan","Ethan","Sam","Jamie","Noah","Leo","Owen"];
let players=names.map((name,i)=>({id:i,name,number:i+1,on:i<5,total:0,spell:0,lastOnAt:i<5?0:null,lastOffAt:i<5?null:0}));
let firstSubCompleted=false;
let elapsed=0,running=false,timer=null,matchLength=2400,periodLength=1200,periods=2,desiredStarters=5;
let overrideOff=null;
let firstSubCompleted=false;
let lastDecision="No substitution yet";

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

/* Balance engine v4
   1) No suggestions before the first coach-led substitution.
   2) After that, only bench players currently most in need of minutes are
      considered as incoming recommendations. This prevents an immediately
      removed high-minute player being recommended straight back on while
      lower-minute bench players are available.
   3) We return at most one best incoming option for each sensible outgoing
      player, rather than an arbitrary Top 5.
   4) Remaining match time is part of every projection.
   5) A soft stability penalty protects players who have only just come on.
*/
function stabilityPenalty(off,incoming){
  const ON_PROTECTION=3*60;
  const BENCH_PROTECTION=2*60;
  const offShortfall=Math.max(0,ON_PROTECTION-off.spell)/ON_PROTECTION;
  const benchRest=incoming.lastOffAt==null ? Infinity : Math.max(0,elapsed-incoming.lastOffAt);
  const restShortfall=Math.max(0,BENCH_PROTECTION-benchRest)/BENCH_PROTECTION;
  return (offShortfall*offShortfall*120000)+(restShortfall*restShortfall*60000);
}
function projectSwap(off,incoming,target,remaining,slots,benchCount){
  const futureOn=players.filter(p=>p.on && p!==off).concat(incoming);
  const projected=new Map(players.map(p=>[p.id,p.total]));
  const rotationBlock=Math.min(remaining,Math.max(90,remaining/(Math.max(1,benchCount)+1)));
  futureOn.forEach(p=>projected.set(p.id,projected.get(p.id)+rotationBlock));
  const futureCapacity=Math.max(0,remaining-rotationBlock)*slots;
  const deficits=players.map(p=>Math.max(0,target-projected.get(p.id)));
  const deficitTotal=deficits.reduce((a,b)=>a+b,0);
  if(deficitTotal>0){
    players.forEach((p,i)=>projected.set(p.id,projected.get(p.id)+futureCapacity*(deficits[i]/deficitTotal)));
  }
  const fairness=players.reduce((sum,p)=>sum+Math.pow(projected.get(p.id)-target,2),0);
  const stability=stabilityPenalty(off,incoming);
  return {score:fairness+stability,fairness,stability,projected,rotationBlock};
}
function engineState(){
  const on=players.filter(p=>p.on), bench=players.filter(p=>!p.on);
  const remaining=Math.max(0,matchLength-elapsed), slots=on.length;
  const totalAtEnd=players.reduce((s,p)=>s+p.total,0)+remaining*slots;
  const target=players.length?totalAtEnd/players.length:0;
  const minBench=bench.length?Math.min(...bench.map(p=>p.total)):0;
  const incomingPool=bench.filter(p=>p.total===minBench);
  return {on,bench,remaining,slots,target,minBench,incomingPool};
}
function rowOptions(off){
  if(!firstSubCompleted) return [];
  const st=engineState();
  return st.incomingPool.map(incoming=>({off,incoming,...projectSwap(off,incoming,st.target,st.remaining,st.slots,st.bench.length)})).sort((a,b)=>a.score-b.score);
}
function playerEligible(off){
  if(!firstSubCompleted) return {ok:false,reason:"First change is coach-led"};
  const st=engineState();
  if(!st.incomingPool.length) return {ok:false,reason:"No bench player needs minutes"};
  // Do not offer a player when the engine says keeping them on is clearly more
  // useful to balance than replacing them. This naturally protects a recent
  // arrival without relying on the next substitution to unlock them.
  const leastBench=st.minBench;
  const recentArrival=off.lastOnAt!=null && off.lastOnAt>0;
  if(recentArrival && off.total <= leastBench + Math.min(180, Math.max(30, st.remaining/10))){
    return {ok:false,reason:"Needs more game time"};
  }
  return {ok:true,reason:""};
}
function suggestionOptions(){
  if(!firstSubCompleted) return [];
  const out=[];
  engineState().on.forEach(off=>{
    const e=playerEligible(off); if(!e.ok) return;
    const best=rowOptions(off)[0]; if(best) out.push(best);
  });
  return out.sort((a,b)=>a.score-b.score);
}
function gridPlayer(p){
  return `<div class="grid-player"><span class="grid-shirt">#${p.number}</span> <span class="grid-name">${p.name}</span><span class="grid-meta">Spell ${fmt(p.spell)} · Total ${fmt(p.total)}</span></div>`;
}
function gridOption(o,i){
  return `<button class="grid-option ${i===0?"best":""}" data-off="${o.off.id}" data-on="${o.incoming.id}"><span class="grid-shirt">#${o.incoming.number}</span> <span class="grid-name">${o.incoming.name}</span><span class="grid-meta">Total ${fmt(o.incoming.total)} · ${i===0?"best balance":"alternative"}</span></button>`;
}
function renderRotationGrid(){
  const st=engineState();
  const maxCols=Math.max(1,st.incomingPool.length);
  $("#rotationGrid").style.setProperty("--bench-cols",maxCols);
  if(!firstSubCompleted){
    $("#gridState").textContent="Waiting for first change";
    $("#gridHelp").textContent="The first substitution is coach-led. Tap Make substitution when the coach is ready.";
    $("#rotationGrid").innerHTML=st.on.map(p=>`<div class="rotation-row" style="--bench-cols:1">${gridPlayer(p)}<div class="grid-empty">No suggestions yet</div></div>`).join("");
    return;
  }
  $("#gridState").textContent=`${fmt(st.remaining)} remaining`;
  $("#gridHelp").textContent="Each row shows the best bench options for that on-pitch player. Tap a replacement to make the change.";
  const head=`<div class="rotation-row rotation-head"><div>On pitch</div>${st.incomingPool.map((_,i)=>`<div>${i===0?"Best":"Option "+(i+1)}</div>`).join("")}</div>`;
  const rows=st.on.map(off=>{
    const eligibility=playerEligible(off);
    if(!eligibility.ok) return `<div class="rotation-row">${gridPlayer(off)}<div class="grid-empty" style="grid-column:span ${maxCols}">${eligibility.reason}</div></div>`;
    const opts=rowOptions(off);
    return `<div class="rotation-row">${gridPlayer(off)}${opts.map(gridOption).join("")}</div>`;
  }).join("");
  $("#rotationGrid").innerHTML=head+rows;
  document.querySelectorAll(".grid-option").forEach(b=>b.onclick=()=>sub(+b.dataset.off,+b.dataset.on,"Suggested change"));
}
function renderDebug(opts=suggestionOptions()){
  if(!$("#debugOutput")) return;
  const st=engineState(), lines=[];
  lines.push(`Match: ${fmt(elapsed)} elapsed | ${fmt(st.remaining)} remaining | ${st.slots} on pitch`);
  lines.push(`Projected equal-share destination: ${fmt(Math.round(st.target))}`);
  lines.push(`First coach-led substitution: ${firstSubCompleted?"YES":"NO"}`);
  lines.push(`Last decision: ${lastDecision}`,"");
  lines.push("PLAYER STATE");
  players.forEach(p=>lines.push(`#${p.number} ${p.name.padEnd(10)} ${p.on?"ON   ":"BENCH"} total ${fmt(p.total)}${p.on?` | spell ${fmt(p.spell)}`:""}`));
  lines.push("");
  if(!firstSubCompleted){ lines.push("ENGINE: inactive until the first coach-led substitution."); }
  else {
    lines.push(`Lowest bench total: ${fmt(st.minBench)}`);
    lines.push(`Incoming pool: ${st.incomingPool.map(p=>p.name).join(", ")||"none"}`,"");
    st.on.forEach(off=>{
      const e=playerEligible(off);
      lines.push(`${off.name}: ${e.ok?"eligible":"no suggestions — "+e.reason}`);
      if(e.ok) rowOptions(off).forEach((o,i)=>lines.push(`  ${i+1}. ${o.incoming.name} | fairness ${Math.round(o.fairness)} | stability ${Math.round(o.stability)} | score ${Math.round(o.score)}`));
    });
  }
  $("#debugOutput").textContent=lines.join("\n");
  $("#debugState").textContent=firstSubCompleted?"engine active":"waiting for first sub";
}
function renderMatch(){
  $("#matchClock").textContent=fmt(elapsed);
  $("#periodLabel").textContent=periodName(currentPeriod());
  $("#pitchCount").textContent=`${players.filter(p=>p.on).length} playing`;
  renderRotationGrid();
  renderDebug();
}
function sub(offId,onId,label="Change"){
  firstSubCompleted=true;
  const off=players.find(p=>p.id===offId), incoming=players.find(p=>p.id===onId);
  if(!off?.on||!incoming||incoming.on)return;
  off.on=false;off.spell=0;off.lastOffAt=elapsed;incoming.on=true;incoming.spell=0;incoming.lastOnAt=elapsed;
  firstSubCompleted=true;
  lastDecision=`${label}: ${off.name} off, ${incoming.name} on at ${fmt(elapsed)}`;
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
    elapsed=0; firstSubCompleted=false; lastDecision="No substitution yet"; players.forEach(p=>{p.total=0;p.spell=0;p.lastOnAt=p.on?0:null;p.lastOffAt=p.on?null:0;});
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


$("#debugBtn").onclick=()=>{
  const panel=$("#debugPanel");
  panel.hidden=!panel.hidden;
  $("#debugBtn").textContent=panel.hidden?"Debug":"Hide debug";
  if(!panel.hidden) renderDebug();
};

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