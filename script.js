const MATCH_LENGTH = 40 * 60;
const players = [
  "Alex","Ben","Charlie","Dylan","Ethan",
  "Sam","Jamie","Noah","Leo","Owen"
].map((name,i)=>({name,on:i<5,spell:0,total:0}));

let elapsed=0, running=false, timer=null;
const $=s=>document.querySelector(s);
const fmt=s=>`${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;

function targetSeconds(){ return MATCH_LENGTH*5/players.length; }

function renderPlayers(){
  const row=p=>`<div class="player-row">
    <div><span class="name">${p.name}</span><span class="meta">${p.on?"ON PITCH":"BENCH"}</span></div>
    <div class="times"><strong>${fmt(p.spell)}</strong><span class="meta">Total ${fmt(p.total)}</span></div>
  </div>`;
  $("#onPitch").innerHTML=players.filter(p=>p.on).map(row).join("");
  $("#bench").innerHTML=players.filter(p=>!p.on).map(row).join("");
}

function rankedSuggestions(){
  const on=players.filter(p=>p.on);
  const off=players.filter(p=>!p.on);
  const target=targetSeconds();

  // Score every possible one-for-one swap. Lower is better.
  // The projection rewards taking off players already above the equal-time path
  // and bringing on players who currently have fewer minutes.
  const options=[];
  for(const a of on) for(const b of off){
    const remaining=Math.max(0,MATCH_LENGTH-elapsed);
    const projected=players.map(p=>{
      if(p===a) return p.total;
      if(p===b) return p.total+remaining;
      return p.total+(p.on?remaining:0);
    });
    const imbalance=projected.reduce((sum,t)=>sum+Math.abs(t-target),0);
    const immediate=(target-b.total)+(a.total-target);
    options.push({off:a,on:b,score:imbalance-immediate*.25});
  }
  return options.sort((a,b)=>a.score-b.score).slice(0,5);
}

function renderSuggestions(){
  const opts=rankedSuggestions();
  $("#suggestionList").innerHTML=opts.map((o,i)=>`
    <button class="suggestion" data-off="${o.off.name}" data-on="${o.on.name}">
      <span><span class="rank">${i+1}</span><span class="swap">${o.off.name} OFF → ${o.on.name} ON</span></span>
      <small>${i===0?"fairest option":"alternative"}</small>
    </button>`).join("");
  document.querySelectorAll(".suggestion").forEach(b=>b.addEventListener("click",()=>makeSub(b.dataset.off,b.dataset.on)));
}

function makeSub(offName,onName){
  const off=players.find(p=>p.name===offName), on=players.find(p=>p.name===onName);
  if(!off?.on || on?.on) return;
  off.on=false; off.spell=0; on.on=true; on.spell=0;
  $("#status").textContent=`Change recorded: ${off.name} off, ${on.name} on. Suggestions recalculated.`;
  render();
}

function render(){
  $("#matchClock").textContent=fmt(elapsed);
  renderPlayers(); renderSuggestions();
}

function tick(){
  if(elapsed>=MATCH_LENGTH){ finishMatch(); return; }
  elapsed++;
  players.forEach(p=>{if(p.on){p.spell++;p.total++;}});
  render();
}

$("#startPauseBtn").addEventListener("click",()=>{
  running=!running;
  $("#startPauseBtn").textContent=running?"Pause match":elapsed?"Resume match":"Start match";
  $("#status").textContent=running?"Match running.":"Match paused.";
  if(running) timer=setInterval(tick,1000); else clearInterval(timer);
});

$("#overrideBtn").addEventListener("click",()=>{
  $("#offSelect").innerHTML=players.filter(p=>p.on).map(p=>`<option>${p.name}</option>`).join("");
  $("#onSelect").innerHTML=players.filter(p=>!p.on).map(p=>`<option>${p.name}</option>`).join("");
  $("#overrideDialog").showModal();
});

$("#overrideForm").addEventListener("submit",e=>{
  const submitter=e.submitter;
  if(submitter?.id!=="confirmOverride") return;
  e.preventDefault();
  makeSub($("#offSelect").value,$("#onSelect").value);
  $("#overrideDialog").close();
});

function finishMatch(){
  running=false; clearInterval(timer);
  $("#startPauseBtn").textContent="Match ended";
  $("#startPauseBtn").disabled=true;
  const target=targetSeconds();
  $("#summaryTarget").textContent=`Equal-share reference: ${fmt(target)} per player.`;
  $("#summaryList").innerHTML=[...players].sort((a,b)=>b.total-a.total).map(p=>{
    const d=p.total-target, sign=d>0?"+":"";
    return `<div class="summary-row"><span class="name">${p.name}</span><strong>${fmt(p.total)}</strong><span class="delta">${sign}${Math.round(d/60)} min</span></div>`;
  }).join("");
  $("#summaryDialog").showModal();
  $("#status").textContent="Full time. Game-time summary generated.";
}
$("#endMatchBtn").addEventListener("click",finishMatch);
$("#closeSummary").addEventListener("click",()=>$("#summaryDialog").close());

render();
