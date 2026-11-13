"use strict";
const $=id=>document.getElementById("q-"+id);
const esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const STORE="prompt-builder-v1";
const STAGES=["Learn","Problem","Buy"], TYPES=["Question","Comparison","Recommendation"], STATUSES=["Draft","Approved","Rejected"];
const DEFAULTS={target:100,batch:50,recMin:30,cmpShare:20,recBuyMin:50,varShare:50,altShare:10,diagMax:10,minWords:8,maxWords:40};
const SETTING_LABELS=[["batch","Batch size"],["recMin","Recommendation share, minimum %"],["cmpShare","Comparison share %"],["recBuyMin","Recommendation share inside Buy cells, minimum %"],["varShare","Prompts carrying a variable %"],["altShare","Prompts naming an alternative %"],["diagMax","Personal diagnostics, maximum %"],["minWords","Prompt length, minimum words"],["maxWords","Prompt length, maximum words"]];
let S={src:null,brands:[],settings:{...DEFAULTS},cols:[],rot:{},name:"",setId:""};
const UI={filters:{},busy:-1,status:{},trim:-1};
function save(){ try{ localStorage.setItem(STORE,JSON.stringify(S)); }catch(e){} }
function load(){ try{ const s=JSON.parse(localStorage.getItem(STORE)||"null"); if(s&&s.settings){ S=Object.assign(S,s); S.settings=Object.assign({},DEFAULTS,s.settings); } }catch(e){} }

/* ---------- Toast, copy, download, Claude ---------- */
let toastT;
function toast(m){ const t=document.getElementById("toast"); t.textContent=m; t.hidden=false; clearTimeout(toastT); toastT=setTimeout(()=>t.hidden=true,2600); }
async function copy(text,what){ try{ await navigator.clipboard.writeText(text); toast(what+" copied"); }catch(e){ document.getElementById("dlg-text").value=text; document.getElementById("dlg").showModal(); document.getElementById("dlg-text").select(); } }
let downloads=null, sampleP=Promise.resolve(null);
if(window.claude&&typeof window.claude.use==="function"){
  sampleP=window.claude.use("sample").catch(()=>null);
  window.claude.use("downloads").then(d=>{ if(d){ downloads=d; $("dljson").hidden=false; $("dlcsv").hidden=false; } }).catch(()=>{});
}
async function download(filename,data){ if(!downloads) return; try{ await downloads.save({filename,data}); toast("Saved "+filename); }catch(e){ if(e&&e.code==="declined") return; toast("Download is not available here. Use Copy instead."); } }

/* ---------- Reading the ICP and the personas ---------- */
const splitRow=line=>line.trim().replace(/^\|/,"").replace(/\|\s*$/,"").split(/(?<!\\)\|/).map(c=>c.trim().replace(/\\\|/g,"|"));
const plain=s=>String(s||"").replace(/\*\*/g,"").replace(/<br\s*\/?>/gi," ").trim();
function mdTables(md){
  const out=[], L=String(md||"").split(/\r?\n/);
  for(let i=0;i<L.length-1;i++){
    if(L[i].trim().startsWith("|") && /^\s*\|?\s*:?-{2,}/.test(L[i+1])){
      const header=splitRow(L[i]).map(h=>plain(h).toLowerCase()), rows=[], start=i; i+=2;
      while(i<L.length && L[i].trim().startsWith("|")){ rows.push(splitRow(L[i]).map(plain)); i++; }
      out.push({header,rows,start,end:i}); i--;
    }
  }
  return out;
}
const col=(t,re)=>t.header.findIndex(h=>re.test(h));
function splitList(s){ return plain(s).split(/\s*[;,]\s*|\s+\/\s+/).map(x=>x.replace(/^(e\.g\.|for example)\s*/i,"").trim()).filter(x=>x&&!/^(-|—|none|n\/a|not named in the inputs\.?|unknown)$/i.test(x)); }
/* The Named examples column may carry detail in brackets after a name ("Acme (free plan; paid tiers)"). Only the bare name is a brand:
   split outside brackets, then drop the brackets. */
const bareName=s=>String(s||"").replace(/\s*[(\[][^)\]]*[)\]]/g,"").replace(/\s*[(\[].*$/,"").replace(/^(e\.g\.|for example)\s*/i,"").replace(/[\s.:,;–—-]+$/,"").trim();
function splitNames(s){ const out=[]; let depth=0, cur="";
  for(const ch of plain(s)){ if(ch==="("||ch==="[") depth++; else if(ch===")"||ch==="]") depth=Math.max(0,depth-1);
    if(depth===0&&(ch===";"||ch===",")){ out.push(cur); cur=""; } else cur+=ch; }
  out.push(cur);
  return [...new Set(out.flatMap(x=>x.split(/\s+\/\s+/)).map(bareName).filter(x=>x&&!/^(-|—|none|n\/a|not named in the inputs\.?|unknown)$/i.test(x)))]; }
/* Values in the Question Variables table. Split outside brackets. A bracket after a real value is a note and is dropped ("Seed (most common)").
   A bracket after a filler word holds the values themselves ("Any (AI, software, climate)"), so those are used. Fillers such as "etc." are not values. */
function splitValues(s){ const parts=[]; let depth=0, cur="";
  for(const ch of plain(s)){ if(ch==="("||ch==="[") depth++; else if(ch===")"||ch==="]") depth=Math.max(0,depth-1);
    if(depth===0&&(ch===";"||ch===",")){ parts.push(cur); cur=""; } else cur+=ch; }
  parts.push(cur);
  const out=[], filler=/^(etc\.?|and so on|and more|others?|any|all|various|unknown|none|n\/a|-|—|not named in the inputs\.?)$/i;
  for(const raw of parts.flatMap(x=>x.split(/\s+\/\s+/))){ const t=raw.trim(), m=t.match(/^(.*?)\s*[(\[]([^)\]]*)[)\]]?\s*$/);
    if(m){ const head=m[1].trim(); if(!head||filler.test(head)||/\b(unknown|not stated)\b/i.test(head)) out.push(...m[2].split(/\s*[;,]\s*/)); else out.push(head); }
    else out.push(t); }
  return [...new Set(out.map(x=>x.replace(/^(e\.g\.?|for example|such as)\s*/i,"").replace(/[\s.]+$/,"").trim()).filter(x=>x&&!filter(x)))];
  function filter(x){ return filler.test(x)||filler.test(x+"."); } }
/* Variables saved before this fix were split inside brackets. Read them again from the saved ICP and repair the tags on existing prompts. Prompt wording is not touched. */
function cleanVariables(){
  if(!S.src||!Array.isArray(S.src.variables)) return 0;
  let fresh=null; try{ const icp=ICPStore.list().find(x=>x.id===S.src.icpId); if(icp&&icp.markdown) fresh=parseIcp(icp.markdown).variables; }catch(e){}
  if(!fresh||!fresh.length||JSON.stringify(fresh)===JSON.stringify(S.src.variables)) return 0;
  S.src.variables=fresh; let n=0; const odd=v=>(v.match(/[(\[]/g)||[]).length!==(v.match(/[)\]]/g)||[]).length;
  for(const c of S.cols) for(const q of c.prompts){ if(!(q.vars||[]).some(v=>odd(String(v.v)))) continue;
    q.vars=q.vars.map(v=>{ if(!odd(String(v.v))) return v; const def=fresh.find(x=>x.name===v.k), hit=def&&def.values.find(y=>hasTerm(q.text,y)); return hit?{k:v.k,v:hit}:null; }).filter(Boolean); n++; }
  return n;
}
/* State saved before this fix holds names that were split inside the brackets. Rebuild the bare names, drop the fragments, and carry the change into tracked brands and prompts. */
function cleanNames(){
  if(!S.src||!Array.isArray(S.src.alternatives)) return {brands:0,prompts:0};
  const map=new Map(); let touched=false;
  for(const a of S.src.alternatives){ const old=a.names||[], neu=splitNames(old.join(", ")); for(const o of old){ const b=bareName(o), hit=neu.find(n=>n.toLowerCase()===b.toLowerCase()); map.set(o,hit&&/^[^)\]]*$/.test(o.split(/[(\[]/)[0])&&o.split(/[(\[]/)[0].trim()?hit:null); }
    if(old.join("|")!==neu.join("|")){ a.names=neu; touched=true; } }
  if(!touched) return {brands:0,prompts:0};
  const good=[...new Set(S.src.alternatives.flatMap(a=>a.names))]; let nb=0, np=0; const kept=[];
  for(const b of S.brands){ if(b.own||!map.has(b.name)||map.get(b.name)===b.name){ kept.push(b); continue; }
    const to=map.get(b.name); nb++;
    if(!to){ if(listOf(b.domains).length) kept.push(b); continue; }
    const twin=kept.find(k=>k.name.toLowerCase()===to.toLowerCase());
    if(twin){ twin.domains=[...new Set(listOf(twin.domains).concat(listOf(b.domains)))].join(", "); continue; }
    b.patterns=[...new Set(listOf(b.patterns).map(x=>x===b.name||map.has(x)?(map.get(x)||to):x).filter(Boolean))].join(", ")||to; b.name=to; kept.push(b); }
  S.brands=kept;
  const esc2=x=>x.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  for(const c of S.cols) for(const q of c.prompts){ let t=q.text;
    for(const n of good) t=t.replace(new RegExp("("+esc2(n)+")\\s*\\([^)]*\\)","gi"),"$1");
    const stale=(q.alts||[]).some(x=>map.has(x)&&map.get(x)!==x);
    const alts=t!==q.text||stale ? good.filter(n=>hasTerm(t,n)) : (q.alts||[]);
    if(t!==q.text||alts.join("|")!==(q.alts||[]).join("|")){ q.text=t; q.alts=alts; np++; } }
  return {brands:nb,prompts:np};
}
/* One or two sentences saying who the customer is: the summary under the ICP's title, else the paragraph under "Ideal Customer". */
function icpCustomer(md){ const L=String(md||"").split(/\r?\n/);
  const para=from=>{ const out=[]; for(let j=from;j<L.length;j++){ const t=L[j].trim(); if(!t){ if(out.length) break; continue; } if(/^#|^\|/.test(t)) break; out.push(t); } return plain(out.join(" ")).trim(); };
  let i=L.findIndex(l=>/^#\s/.test(l)), t=i>=0?para(i+1):"";
  if(!t){ i=L.findIndex(l=>/^#{2,3}\s*\d*\.?\s*Ideal Customer/i.test(l)); if(i>=0) t=para(i+1); }
  return t.slice(0,600); }
function market(){ if(S.src&&!S.src.customer){ try{ const icp=ICPStore.list().find(x=>x.id===S.src.icpId); if(icp&&icp.markdown) S.src.customer=icpCustomer(icp.markdown); }catch(e){} } return (S.src&&S.src.customer)||""; }
function parseIcp(md){
  const T=mdTables(md), out={situations:[],alternatives:[],variables:[],customer:icpCustomer(md)};
  const st=T.find(t=>t.header[0]==="id"&&col(t,/trigger/)>=0);
  if(st){ const n=col(st,/^situation|name/), tr=col(st,/trigger/), al=col(st,/already tried/), de=col(st,/deciding/), sw=col(st,/stage weight/);
    for(const r of st.rows){ const id=(r[0]||"").toUpperCase().match(/S\d{1,2}/); if(!id) continue;
      const w={}; for(const s of STAGES){ const m=(r[sw]||"").match(new RegExp(s+"\\s*:?\\s*(\\d+(?:\\.\\d+)?)\\s*%","i")); w[s]=m?Number(m[1]):0; }
      const sum=w.Learn+w.Problem+w.Buy; if(sum>0) for(const s of STAGES) w[s]=w[s]/sum; else for(const s of STAGES) w[s]=1/3;
      out.situations.push({id:id[0],name:r[n]||"",trigger:r[tr]||"",tried:r[al]||"",deciding:r[de]||"",w}); } }
  const at=T.find(t=>col(t,/^category/)>=0&&col(t,/named examples/)>=0);
  if(at){ const c=col(at,/^category/), n=col(at,/named examples/); for(const r of at.rows) out.alternatives.push({category:r[c]||"",names:splitNames(r[n])}); }
  const vt=T.find(t=>t.header[0]==="variable");
  if(vt){ const v=col(vt,/values/); for(const r of vt.rows){ const values=splitValues(r[v>=0?v:1]); if(r[0]) out.variables.push({name:r[0],values}); }
    // Shortlist of priority values under the table, for attributes that do not decide fit (usually sector, sometimes geography).
    const L=md.split(/\r?\n/), short=[];
    for(let i=vt.end;i<L.length;i++){ const t=L[i].trim(); if(/^#{1,3}\s/.test(t)) break; const m=t.match(/^(?:[-*+]|\d+[.)])\s+\**(.{2,80}?)\**\s*(?::\**|\s[–—-])\s+\S/); if(m) short.push(plain(m[1]).trim()); }
    if(short.length){ const low=x=>String(x).toLowerCase(), isSec=x=>/sector|industry|vertical/i.test(x.name), secItems=[];
      for(const item of short){ const hint=(item.match(/[(\[]([^)\]]+)[)\]]/)||[])[1]||"", bare=bareName(item)||item;
        // An item belongs to the variable its bracket names ("United States (founder location)"), else to a variable that already lists it, else to sector.
        const byHint=hint&&out.variables.find(x=>low(x.name).includes(low(hint))||low(hint).includes(low(x.name)));
        const byValue=out.variables.find(x=>!isSec(x)&&x.values.some(y=>y.length>3&&low(bare).includes(low(y))));
        if(byHint&&!isSec(byHint)){ if(!byHint.values.some(y=>low(y)===low(bare))) byHint.values.push(bare); }
        else if(byValue){ /* already listed there */ }
        else secItems.push(bare); }
      if(secItems.length){ const sec=out.variables.find(isSec); if(sec) sec.values=secItems; else out.variables.push({name:"Sector",values:secItems}); } }
    out.variables=out.variables.filter(x=>x.values.length); }
  return out;
}
function parsePersona(p,md){
  const T=mdTables(md), out={name:p.name,role:(p.purchasing_roles||[]).join(", "),share:Number(p.prompt_share)||0,situations:(p.situations||[]).map(s=>String(s).toUpperCase()),slim:p.buys_or_uses===false,seeds:[],buyer:[],ours:[],objections:[]};
  const cut=md.search(/^#{3,5}\s*\d*\.?\s*Questions They Ask/mi); out.context=(cut>0?md.slice(0,cut):md.slice(0,2500)).replace(/^###\s.*$/m,"").trim().slice(0,3000);
  const qt=T.find(t=>t.header.includes("stage")&&t.header.includes("question"));
  if(qt){ const a=qt.header.indexOf("situation"), b=qt.header.indexOf("stage"), q=qt.header.indexOf("question"); for(const r of qt.rows){ const stg=STAGES.find(s=>s.toLowerCase()===(r[b]||"").toLowerCase()); if(stg&&r[q]) out.seeds.push({s:(r[a]||"").toUpperCase(),st:stg,q:r[q]}); } }
  const lt=T.find(t=>(t.header[0]||"").includes("buyer calls"));
  if(lt) for(const r of lt.rows){ for(const x of splitList(r[0])) out.buyer.push(x.replace(/["“”]/g,"")); for(const x of splitList(r[1])) out.ours.push(x.replace(/["“”]/g,"")); }
  const lowBuyer=out.buyer.map(x=>x.toLowerCase()); out.ours=[...new Set(out.ours.filter(x=>x.length>3&&!lowBuyer.includes(x.toLowerCase())))];
  const ot=T.find(t=>(t.header[0]||"").includes("objection")); if(ot) for(const r of ot.rows) if(r[0]) out.objections.push(r[0]);
  return out;
}
function loadSource(id){
  const set=PersonaStore.list().find(x=>x.id===id);
  const packed=unpackPersonas(set);
  if(!set||!packed||!packed.plan||!Array.isArray(packed.plan.personas)) return "These saved personas cannot be read. Save them again in the Persona Builder.";
  const icp=ICPStore.list().find(x=>x.id===set.icpId);
  if(!icp||!icp.markdown) return "The ICP these personas were built from is not among the saved ICPs. Save the ICP again, rebuild the personas from it, and save them.";
  const parsed=parseIcp(icp.markdown);
  if(!parsed.situations.length) return "The ICP has no Buyer Situations table. Regenerate the ICP, save it, rebuild the personas and save them.";
  const personas=packed.plan.personas.map((p,i)=>parsePersona(p,(packed.profiles||{})[i]||""));
  const known=parsed.situations.map(s=>s.id);
  for(const p of personas) p.situations=p.situations.filter(s=>known.includes(s));
  if(!personas.some(p=>p.situations.length)) return "None of these personas is linked to a buyer situation. Rebuild the personas in the Persona Builder and save them.";
  const company=(icp.company||set.company||"").replace(/\(.*?\)/g,"").trim();
  S={src:Object.assign({personasId:id,personasName:set.name||id,icpId:icp.id,company},parsed,{personas}),
     brands:[{name:company||"Own brand",domains:"",patterns:company,exclude:"",own:true}].concat([...new Set(parsed.alternatives.flatMap(a=>a.names))].filter(n=>n.toLowerCase()!==company.toLowerCase()).map(n=>({name:n,domains:"",patterns:n,exclude:"",own:false}))),
     settings:Object.assign({},S.settings),
     mix:null, styles:personas.map(()=>S.style||""), style:"", run:null,
     cols:personas.map(p=>({target:0,weights:Object.fromEntries(p.situations.map(s=>[s,1])),prompts:[],exhausted:{},log:[],seq:0})),
     rot:{},name:(company?company+" ":"")+"Prompts",setId:""};
  ensureMix();
  return "";
}

/* ---------- Cells, targets and the slot list ---------- */
/* ---------- Persona mix: one total, one weight per persona ---------- */
const shareWeights=()=>{ const w=S.src.personas.map(p=>Math.max(0,Number(p.share)||0)); return w.some(x=>x>0)?w:w.map(()=>1); };
function ensureMix(){ if(!S.src) return; const n=S.cols.length;
  if(!S.mix||!Array.isArray(S.mix.w)||S.mix.w.length!==n) S.mix={total:Number.isFinite(S.mix&&S.mix.total)?S.mix.total:200,w:shareWeights()};
  applyMix(); }
/* Each persona's target is its weight's part of the total, rounded so the targets add up to the total. */
function applyMix(){ const T=Math.max(0,Math.round(Number(S.mix.total)||0)), w=S.mix.w.map(x=>Math.max(0,Number(x)||0)), sum=w.reduce((a,b)=>a+b,0);
  const raw=w.map(x=>sum?T*x/sum:0), fl=raw.map(Math.floor); let rem=T-fl.reduce((a,b)=>a+b,0);
  raw.map((x,i)=>[x-fl[i],i]).sort((a,b)=>b[0]-a[0]).forEach(([,i])=>{ if(rem>0&&sum){ fl[i]++; rem--; } });
  S.cols.forEach((c,i)=>{ if(c.target!==fl[i]){ c.target=fl[i]; c.exhausted={}; } }); }
const mixPct=i=>{ const sum=S.mix.w.reduce((a,b)=>a+(Math.max(0,Number(b)||0)),0); return sum?Math.round(Math.max(0,Number(S.mix.w[i])||0)/sum*100):0; };
/* Trim to target: which prompts to reject so a persona over its target comes back to it. One at a time from the cell that is furthest over its own target, so coverage stays even.
   Inside a cell: prompts marked "may be misread" first, then drafts, then the most recently written. */
function trimPlan(ci){ const c=S.cols[ci], t=cellTargets(ci), h=haveMap(ci); let over=live(ci).length-c.target; const out=[], taken=new Set();
  const rank=p=>(p.amb?0:2)+(p.status==="Draft"?0:1);
  while(over>0){ const ks=Object.keys(h).filter(k=>h[k]>0).sort((a,b)=>((h[b]-(t[b]||0))-(h[a]-(t[a]||0)))||(h[b]-h[a])); if(!ks.length) break; const k=ks[0];
    const pick=c.prompts.filter(p=>p.status!=="Rejected"&&!taken.has(p.id)&&key(p.s,p.st)===k).sort((a,b)=>rank(a)-rank(b)||(a.id<b.id?1:-1))[0]; if(!pick) break;
    taken.add(pick.id); out.push(pick); h[k]--; over--; }
  return out; }
const key=(s,st)=>s+"|"+st;
function cellTargets(ci){
  const p=S.src.personas[ci], c=S.cols[ci], T=Math.max(0,Math.round(Number(c.target)||0)), cells=[];
  const sw=p.situations.map(s=>Math.max(0,Number(c.weights[s])||0)), swSum=sw.reduce((a,b)=>a+b,0)||1;
  p.situations.forEach((s,i)=>{ const sit=S.src.situations.find(x=>x.id===s); for(const st of STAGES) cells.push({s,st,raw:T*(sw[i]/swSum)*sit.w[st]}); });
  const fl=cells.map(x=>Math.floor(x.raw)); let rem=T-fl.reduce((a,b)=>a+b,0);
  cells.map((x,i)=>[x.raw-fl[i],i]).sort((a,b)=>b[0]-a[0]).forEach(([,i])=>{ if(rem>0){ fl[i]++; rem--; } });
  const out={}; cells.forEach((x,i)=>out[key(x.s,x.st)]=fl[i]); return out;
}
const live=ci=>S.cols[ci].prompts.filter(p=>p.status!=="Rejected");
function haveMap(ci){ const m={}; for(const p of live(ci)) m[key(p.s,p.st)]=(m[key(p.s,p.st)]||0)+1; return m; }
function shortfalls(ci){ const t=cellTargets(ci), h=haveMap(ci), c=S.cols[ci]; return Object.keys(t).map(k=>({k,need:t[k]-(h[k]||0),ex:!!c.exhausted[k]})).filter(x=>x.need>0); }
function canGenerate(ci){ const c=S.cols[ci], sf=shortfalls(ci); if(live(ci).length>=c.target||!sf.length) return "target"; if(sf.every(x=>x.ex)) return "exhausted"; return ""; }
const rot=(k,n)=>{ S.rot[k]=(S.rot[k]||0)+1; return (S.rot[k]-1)%n; };
function planBatch(ci){
  const st=S.settings, c=S.cols[ci], p=S.src.personas[ci];
  const open=shortfalls(ci).filter(x=>!x.ex).map(x=>({k:x.k,need:x.need}));
  const size=Math.min(st.batch,c.target-live(ci).length,open.reduce((a,x)=>a+x.need,0)), slots=[];
  while(slots.length<size){ open.sort((a,b)=>b.need-a.need); if(!open.length||open[0].need<=0) break; const [s,stage]=open[0].k.split("|"); slots.push({s,st:stage}); open[0].need--; }
  // Types: Buy cells at least half Recommendation, Learn almost all Question, then top up to the batch minimums.
  const n=slots.length, buy=slots.filter(x=>x.st==="Buy"), prob=slots.filter(x=>x.st==="Problem"), learn=slots.filter(x=>x.st==="Learn");
  learn.forEach(x=>x.ty="Question");
  const buyRec=Math.ceil(buy.length*st.recBuyMin/100); buy.forEach((x,i)=>x.ty=i<buyRec?"Recommendation":(i-buyRec)%2===0?"Comparison":"Question");
  prob.forEach(x=>x.ty="Question");
  let rec=slots.filter(x=>x.ty==="Recommendation").length, cmp=slots.filter(x=>x.ty==="Comparison").length;
  const recNeed=Math.ceil(n*st.recMin/100), cmpNeed=Math.round(n*st.cmpShare/100);
  for(const x of prob){ if(rec<recNeed){ x.ty="Recommendation"; rec++; } else if(cmp<cmpNeed){ x.ty="Comparison"; cmp++; } }
  for(const x of buy){ if(rec>=recNeed) break; if(x.ty==="Question"){ x.ty="Recommendation"; rec++; } }
  for(const x of learn){ if(rec>=recNeed&&cmp>=cmpNeed) break; if(rec<recNeed){ x.ty="Recommendation"; rec++; } else if(cmp<cmpNeed){ x.ty="Comparison"; cmp++; } }
  // Shuffle order deterministically so types and variables spread across cells.
  slots.forEach((x,i)=>{ x.n=i+1; x.vars=[]; x.alts=[]; x.tries=0; });
  const V=S.src.variables, names=[...new Set(S.src.alternatives.flatMap(a=>a.names))].filter(nm=>!ownPatterns().some(o=>o.toLowerCase()===nm.toLowerCase()));
  if(V.length){ const want=Math.round(n*st.varShare/100); let step=want?n/want:0; for(let j=0;j<want;j++){ const x=slots[Math.min(n-1,Math.floor(j*step))]; if(!x||x.vars.length) continue; const v=V[rot("var",V.length)]; x.vars.push({k:v.name,v:v.values[rot("v:"+v.name,v.values.length)]}); } }
  if(names.length){ let want=Math.round(n*st.altShare/100); if(n>=8&&want<1) want=1; const pool=slots.filter(x=>x.ty!=="Question").concat(slots.filter(x=>x.ty==="Question"));
    for(let j=0;j<want&&j<pool.length;j++){ const x=pool[Math.floor(j*pool.length/want)]; if(x.alts.length) continue; x.alts.push(names[rot("alt",names.length)]); if(x.ty==="Comparison"&&names.length>1){ const b=names[rot("alt",names.length)]; if(b!==x.alts[0]) x.alts.push(b); } } }
  // Objections: each needs at least one Buy-stage prompt over the persona's full set.
  const covered=new Set(c.prompts.filter(q=>q.status!=="Rejected"&&q.obj!=null).map(q=>q.obj)); let oi=0;
  for(const x of buy){ while(oi<p.objections.length&&covered.has(oi)) oi++; if(oi>=p.objections.length) break; x.obj=oi; covered.add(oi); }
  return slots;
}

/* ---------- Brands ---------- */
const listOf=s=>String(s||"").split(",").map(x=>x.trim()).filter(Boolean);
function ownPatterns(){ const o=S.brands.find(b=>b.own); return o?[...new Set([o.name].concat(listOf(o.patterns)))].filter(x=>x&&x.length>1):[]; }
const hasTerm=(text,term)=>new RegExp("(^|[^a-z0-9])"+term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"($|[^a-z0-9])","i").test(text);

/* ---------- The instruction to the AI ---------- */
const WORDING=`1. Written as the person would type it to an AI assistant: first person, natural, one ask per prompt.
2. Between {MIN} and {MAX} words. Mix short direct questions with longer ones that give context.
3. Use only terms from "Use these terms". Never use a term from "Never use these terms".
4. Never name the brand listed under "Never mention".
5. Describe the category as a problem plus a request for help, not by a category name the buyer may not know. For example "is there a service that finds investors and helps me reach them" and not "managed outreach service".
6. Recommendation prompts use openings such as: "Who can help...", "Which companies...", "Is there a service that...", "What are the best...", "What are the alternatives to...", "Who offers...".
7. Numbers and details must be plausible for this person (sizes, amounts, timeframes).
8. No more than {DIAG}% of the batch may be personal diagnostics ("what am I doing wrong", "should I pause"). These rarely trigger a search.
9. An influencer asks from their own position and about their own concerns. A buyer's question with a new opening is a duplicate, not a new prompt.
10. Each prompt is read on its own by an AI assistant that knows nothing about this person. From the prompt alone it must be clear what kind of person is asking and in which market, so that it cannot be taken for a question about a different field. A word that is clear inside this market can mean something else outside it. Say it the way the person would, inside the sentence, and vary how it is said from prompt to prompt: no fixed opening and no label such as "As a ...". The market: {MARKET}`;
const AMB_TEST=`Read each one as an AI assistant would: it sees only that one question and knows nothing else. A question is ambiguous when a reasonable reader could take it to be about a different field, or to come from a different kind of asker, than this market: {MARKET}
A question is not ambiguous merely because it is short or leaves out detail. It is ambiguous only when the missing context changes what is being asked.`;
const marketLine=()=>market()||"the one described by the person and the situations above";
/* Style reference: a few prompts the user wrote the way they would type them. Used for length, tone and amount of context only. */
/* Style reference: a few prompts the user wrote the way this persona would type them. Used for length, tone and amount of context only.
   One box per persona. A single global box existed before; its text is carried over to every persona once. */
const STYLE_MAX=5;
function ensureStyles(){ if(!S.src) return; const n=S.cols.length;
  if(!Array.isArray(S.styles)||S.styles.length!==n) S.styles=S.cols.map((_,i)=>(Array.isArray(S.styles)&&typeof S.styles[i]==="string"&&S.styles[i])||S.style||"");
  S.style=""; }
const styleLines=ci=>String((S.styles||[])[ci]||"").split(/\r?\n/).map(x=>x.replace(/^\s*(?:[-*•]|\d+[.)])\s+/,"").replace(/\s+/g," ").trim()).filter(Boolean);
const styleList=ci=>styleLines(ci).slice(0,STYLE_MAX);
function styleBlock(ci){ const ex=styleList(ci); if(!ex.length) return "";
  return `STYLE REFERENCE
The user wrote these the way they type to an AI assistant. Match their length, their tone and how much background they give before the ask.
Take nothing else from them: not their topics, not their wording, not their subject matter. What each prompt is about comes only from the numbered list that follows.
${ex.map(x=>"- "+x).join("\n")}

`; }
function styleNote(ci){ const ex=styleList(ci), st=S.settings; if(!ex.length) return "";
  const w=ex.map(words), lo=Math.min(...w), hi=Math.max(...w), raw=styleLines(ci).length;
  let t=`${ex.length} example${ex.length===1?"":"s"} in use, ${lo===hi?lo:lo+" to "+hi} words each.`;
  if(raw>STYLE_MAX) t+=` Only the first ${STYLE_MAX} of ${raw} lines are used.`;
  if(ex.length<3) t+=" Three to five give a steadier result.";
  if(lo<st.minWords||hi>st.maxWords) t+=` Prompts must still be ${st.minWords} to ${st.maxWords} words. Your examples go ${lo<st.minWords&&hi>st.maxWords?"below and above":lo<st.minWords?"below":"above"} that; change the length limits under Generation settings if you want prompts as ${lo<st.minWords?"short":"long"} as yours.`;
  return t; }
function existingAll(){ const out=[]; S.cols.forEach((c,ci)=>c.prompts.forEach(p=>out.push({ci,id:p.id,text:p.text}))); return out; }
function genPrompt(ci,slots,round,notes){
  const p=S.src.personas[ci], st=S.settings, sits=[...new Set(slots.map(x=>x.s))].map(id=>S.src.situations.find(s=>s.id===id));
  const first=!S.cols[ci].prompts.length&&round===1;
  const seeds=p.seeds.filter(q=>slots.some(x=>x.s===q.s&&x.st===q.st)).slice(0,60);
  const ex=existingAll();
  const slotLine=x=>`${x.n}. situation ${x.s} | stage ${x.st} | type ${x.ty} | include: ${x.vars.length?x.vars.map(v=>v.k+" = "+v.v).join("; "):"none"} | name: ${x.alts.length?x.alts.join(" and "):"none"}`+(x.obj!=null?` | express this objection: "${p.objections[x.obj]}"`:"")+(notes[x.n]?` | previous attempt was rejected: ${notes[x.n]}`:"");
  return `You are writing the questions a specific person would type into an AI assistant such as ChatGPT.

PERSON
${p.name}${p.role?" ("+p.role+")":""}${p.slim?". This person influences the decision but never buys or uses the product; they ask from their own position.":""}
${p.context}

THEIR WORDS
Use these terms: ${p.buyer.join("; ")||"plain everyday language"}
Never use these terms: ${p.ours.join("; ")||"none listed"}
Never mention: ${ownPatterns().join("; ")||"none"}

SITUATIONS
${sits.map(s=>`${s.id}: ${s.name}. Trigger moment: ${s.trigger} Already tried: ${s.tried} Deciding between: ${s.deciding}`).join("\n")}

OPTIONS THEY KNOW ABOUT
${S.src.alternatives.map(a=>`- ${a.category}${a.names.length?": "+a.names.join(", "):""}`).join("\n")||"none listed"}

DETAILS THEY MIGHT INCLUDE
${S.src.variables.map(v=>`- ${v.name}: ${v.values.join(", ")}`).join("\n")||"none listed"}

EXAMPLES OF THEIR QUESTIONS${first?" (start from these: rewrite them to meet the rules, then add what the slots require)":""}
${seeds.map(q=>`- [${q.s} ${q.st}] ${q.q}`).join("\n")||"none"}

ALREADY WRITTEN, DO NOT REPEAT OR REPHRASE
${ex.map(e=>"- "+e.text).join("\n")||"nothing yet"}

${styleBlock(ci)}WRITE EXACTLY THESE
${slots.map(slotLine).join("\n")}

RULES
${WORDING.replace("{MIN}",st.minWords).replace("{MAX}",st.maxWords).replace("{DIAG}",st.diagMax).replace("{MARKET}",marketLine())}
Each prompt must add new ground: a new angle within its situation, a new detail or a new named option. When a slot says "include", work that detail into the prompt in the person's words. When a slot says "name", use that name exactly.

Definitions:
- Learn: understanding the topic, not looking for a provider.
- Problem: stuck on something specific, looking for a way through.
- Buy: comparing options, providers, prices and risks.
- Question: asks for an explanation, benchmark or how-to.
- Comparison: asks to weigh named options or categories.
- Recommendation: asks who or what can help, inviting named providers.

Return JSON only, no code fence: a list with one object per slot: {"slot": number, "prompt": "text", "situation": "S1", "stage": "Learn|Problem|Buy", "type": "Question|Comparison|Recommendation", "variables": ["..."], "named_brands": ["..."], "diagnostic": true or false}. "diagnostic" is true only for a personal diagnostic question.`;
}
function judgePrompt(cands){
  const ex=existingAll();
  return `Below are EXISTING prompts and NEW candidate prompts, all written for the same brand. For each NEW prompt, decide whether it asks the same question as an existing prompt or as an earlier NEW prompt, even when it is reworded, given a different opening, or asked from another person's position ("A founder I mentor..."). The same topic with a different ask, a different situation detail or a different named option is not a duplicate.

Then, separately, decide whether each NEW prompt is ambiguous. ${AMB_TEST.replace("{MARKET}",market()||"the market the EXISTING prompts are plainly about")}

Return JSON only, no code fence: [{"n": <new prompt number>, "dup": "E<number>" or "N<number>" or null, "amb": true or false, "why": "<if amb, at most 12 words on how it could be misread>"}] with one object per NEW prompt.

EXISTING
${ex.map((e,i)=>`E${i+1}. ${e.text}`).join("\n")||"none"}

NEW
${cands.map((c,i)=>`N${i+1}. ${c.text}`).join("\n")}`;
}
function ambPrompt(list){
  return `Below are questions that people will type into an AI assistant such as ChatGPT.

${AMB_TEST.replace("{MARKET}",market()||"the market most of the questions are plainly about")}

Return JSON only, no code fence: [{"n": <number>, "amb": true or false, "why": "<if amb, at most 12 words on how it could be misread>"}] with one object per question.

QUESTIONS
${list.map((t,i)=>`${i+1}. ${t}`).join("\n")}`;
}
function parseJsonList(t){ t=String(t||""); const a=t.indexOf("["), b=t.lastIndexOf("]"); if(a<0||b<=a) throw {code:"parse"}; const j=JSON.parse(t.slice(a,b+1)); if(!Array.isArray(j)) throw {code:"parse"}; return j; }
async function ask(sample,prompt,tier,onText){
  let out="", input=prompt;
  for(let k=0;k<3;k++){ const base=out, r=await sample(input,{modelTier:tier,cache:false,onText:onText?({text})=>onText(base+text):undefined}); out=base+(r.text||""); if(!r.truncated) break;
    input=[{role:"user",content:prompt},{role:"assistant",content:out},{role:"user",content:"Continue exactly where you stopped. Do not repeat anything."}]; }
  return out;
}

/* ---------- Checks ---------- */
const words=t=>String(t).trim().split(/\s+/).filter(Boolean).length;
function localIssues(ci,p){
  const st=S.settings, per=S.src.personas[ci], out=[], w=words(p.text);
  if(w<st.minWords||w>st.maxWords) out.push(`${w} words (allowed ${st.minWords} to ${st.maxWords})`);
  for(const o of ownPatterns()) if(hasTerm(p.text,o)){ out.push("names the own brand"); break; }
  for(const t of per.ours) if(hasTerm(p.text,t)){ out.push(`uses our term "${t}"`); break; }
  for(const a of (p.alts||[])) if(!p.text.toLowerCase().includes(a.toLowerCase())) out.push(`does not name ${a}`);
  for(const v of (p.vars||[])){ const ws=v.v.toLowerCase().split(/[^a-z0-9$€£%]+/).filter(x=>x.length>2); if(ws.length&&!ws.some(x=>p.text.toLowerCase().includes(x))) out.push(`does not include ${v.k}: ${v.v}`); }
  return out;
}

/* ---------- Generation ---------- */
const RUN={on:false,stop:false};
const PROG={ci:-1,frac:0,text:"",t0:0,timer:0};
function paintProgress(){
  const box=document.querySelector(`[data-prog="${PROG.ci}"]`); if(!box) return;
  const s=Math.floor((Date.now()-PROG.t0)/1000), el=`${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;
  box.hidden=false; box.querySelector("i").style.width=Math.round(Math.min(1,PROG.frac)*100)+"%"; box.querySelector("span").textContent=`${PROG.text} · ${el} elapsed`;
}
function startProgress(ci){ PROG.ci=ci; PROG.frac=0.02; PROG.text="Starting"; PROG.t0=Date.now(); clearInterval(PROG.timer); PROG.timer=setInterval(paintProgress,1000); paintProgress(); }
function setProgress(frac,text){ PROG.frac=Math.max(PROG.frac,frac); PROG.text=text; paintProgress(); }
function stopProgress(){ clearInterval(PROG.timer); PROG.ci=-1; }
function setStatus(ci,t){ UI.status[ci]=t; const el=document.querySelector(`[data-status="${ci}"]`); if(el) el.textContent=t; }
/* Writes one batch for a persona. A prompt that passes the local checks and Claude's duplicate and misread check is saved as Approved.
   One that fails is rewritten, up to three rounds, and then dropped. Returns what happened, for Generate all. */
async function generate(ci,inRun){
  const res={added:0,dropped:0,stopped:false,error:"",idle:false};
  if(UI.busy>=0||(RUN.on&&!inRun)){ res.idle=true; return res; }
  if(checking){ toast("Wait for the check to finish"); res.idle=true; return res; }
  const slots=planBatch(ci); if(!slots.length){ setStatus(ci,"Nothing left to generate for this persona."); res.idle=true; return res; }
  const sample=await sampleP;
  if(!sample){ setStatus(ci,"Claude is not available in this view, so prompts cannot be generated here. Open the page in claude.ai."); res.error="no_claude"; return res; }
  UI.busy=ci; renderCols(); startProgress(ci);
  const c=S.cols[ci], st=S.settings, added=[], notes={}, total=slots.length; let pending=slots, logged=0;
  const diagCap=Math.floor(slots.length*st.diagMax/100); let diag=0;
  try{
    for(let round=1;round<=3&&pending.length;round++){
      if(RUN.stop){ res.stopped=true; break; }
      const need=pending.length, had=added.length, stepName=round>1?`Attempt ${round} of 3 for ${need} that failed`:`Step 1 of 2`;
      setStatus(ci,`Writing ${need} prompt${need===1?"":"s"}${round>1?" (attempt "+round+" for the ones that failed)":""}…`);
      setProgress((had+0.02*need)/total,`${stepName} · asking Claude for ${need} prompts`);
      const list=parseJsonList(await ask(sample,genPrompt(ci,pending,round,notes),"complex",text=>{ const w=Math.min(need,(text.match(/"slot"\s*:/g)||[]).length); setProgress((had+0.75*w)/total,`${stepName} · writing prompts: ${w} of ${need}`); }));
      const bySlot={}; for(const r of list) if(r&&r.slot!=null) bySlot[Number(r.slot)]=r;
      const cands=[], failed=[];
      const fail=(x,why,text)=>{ x.tries++; notes[x.n]=why; failed.push(x); if(text){ c.log.push({cell:key(x.s,x.st),text,reason:why}); logged++; } };
      for(const x of pending){
        const r=bySlot[x.n], text=r&&String(r.prompt||"").replace(/\s+/g," ").trim();
        if(!text){ fail(x,"no prompt was returned"); continue; }
        const cand={slot:x,text,s:x.s,st:x.st,ty:x.ty,vars:x.vars,alts:x.alts,obj:x.obj,diag:!!r.diagnostic};
        const mism=[]; if(r.stage&&String(r.stage).toLowerCase()!==x.st.toLowerCase()) mism.push("wrong stage"); if(r.type&&String(r.type).toLowerCase()!==x.ty.toLowerCase()) mism.push("wrong type"); if(r.situation&&String(r.situation).toUpperCase()!==x.s) mism.push("wrong situation");
        const issues=mism.concat(localIssues(ci,cand));
        if(cand.diag&&diag>=diagCap) issues.push("personal diagnostic over the cap; ask something else");
        if(issues.length){ fail(x,issues.join("; "),text); continue; }
        if(cand.diag) diag++;
        cands.push(cand);
      }
      if(cands.length&&RUN.stop){ res.stopped=true; break; }
      if(cands.length&&inRun) cands.forEach(x=>{ x.inRun=true; });
      if(cands.length){
        setStatus(ci,`Checking ${cands.length} prompt${cands.length===1?"":"s"} for duplicates across all personas…`);
        setProgress((had+0.8*need)/total,`${round>1?"Attempt "+round+" of 3":"Step 2 of 2"} · checking ${cands.length} for duplicates and for prompts that could be misread`);
        const ex=existingAll(); let verdict={}; const amb={};
        try{ for(const v of parseJsonList(await ask(sample,judgePrompt(cands),"default"))) if(v&&v.n!=null){ verdict[Number(v.n)]=v.dup||null; if(v.amb===true) amb[Number(v.n)]=String(v.why||"").trim().slice(0,140)||"unclear who is asking or in which market"; } }
        catch(e){ if(e&&e.code&&e.code!=="parse") throw e; verdict=null; }
        cands.forEach((cand,i)=>{
          const d=verdict?verdict[i+1]:null;
          if(verdict&&d){ const m=String(d).match(/^([EN])(\d+)$/i); const other=m&&m[1].toUpperCase()==="E"&&ex[Number(m[2])-1]&&ex[Number(m[2])-1].ci!==ci;
            if(cand.diag) diag--; fail(cand.slot, other?"duplicate of another persona's prompt; ask something this person alone would ask":"duplicate of an existing prompt; cover new ground", cand.text); return; }
          if(!verdict&&inRun){ if(cand.diag) diag--; fail(cand.slot,"the duplicate check could not be read; write it again",cand.text); return; }
          if(verdict&&amb[i+1]){ if(cand.diag) diag--; fail(cand.slot,`could be misread out of context (${amb[i+1]}); make clear from the prompt alone who is asking and in which market`,cand.text); return; }
          c.seq=(c.seq||0)+1;
          const row={id:`P${ci+1}-${String(c.seq).padStart(3,"0")}`,s:cand.s,st:cand.st,ty:cand.ty,vars:cand.vars,alts:cand.alts,text:cand.text,status:verdict?"Approved":"Draft",diag:cand.diag,unchecked:!verdict};
          if(verdict) row.ck=true;
          if(cand.obj!=null) row.obj=cand.obj;
          c.prompts.push(row); added.push(row);
        });
      }
      pending=failed; save(); renderCols(); setProgress(added.length/total,`${added.length} of ${total} accepted`+(failed.length?` · ${failed.length} to retry`:""));
    }
    res.added=added.length;
    if(res.stopped){ setStatus(ci,`Stopped. ${added.length} prompt${added.length===1?"":"s"} added and approved before the stop.`); }
    else{
    for(const x of pending) c.exhausted[key(x.s,x.st)]=true;
    res.dropped=pending.length; c.dropped=(c.dropped||0)+pending.length;
    const n=added.length, rec=added.filter(x=>x.ty==="Recommendation").length, cmp=added.filter(x=>x.ty==="Comparison").length, dg=added.filter(x=>x.diag).length;
    const ex=[...new Set(pending.map(x=>key(x.s,x.st)))];
    setStatus(ci,`Added and approved ${n} prompt${n===1?"":"s"}: ${rec} recommendation (${n?Math.round(rec/n*100):0}% of ${n}), ${cmp} comparison, ${n-rec-cmp} question; ${dg} personal diagnostic${dg===1?"":"s"}.`+(pending.length?` ${pending.length} slot${pending.length===1?"":"s"} could not be filled after three attempts and ${pending.length===1?"was":"were"} dropped; ${ex.length} cell${ex.length===1?" is":"s are"} marked exhausted.`:"")+(added.some(x=>x.unchecked)?" The duplicate check could not be read for some prompts; they are flagged and left as drafts.":""));
    }
  }catch(e){
    const code=e&&e.code; res.added=added.length; res.error=code||"failed";
    setStatus(ci, code==="rate_limited" ? `Claude is rate limited. ${added.length} prompts were added before it stopped. Wait a minute, then generate again.`
      : code==="not_granted" ? "Generating needs permission to ask Claude. Select the button again and allow it."
      : code==="parse" ? `Claude's reply could not be read. ${added.length} prompts were added before it stopped. Select the button again.`
      : `Generation stopped${e&&e.message?": "+e.message:""}. ${added.length} prompts were added. Select the button again.`);
  }
  stopProgress(); UI.busy=-1; save(); render();
  return res;
}

/* ---------- Rendering ---------- */
function renderSources(){
  const L=PersonaStore.list();
  $("sources").innerHTML = L.length ? L.map(x=>`<div class="savedrow"><div><span class="lab">${esc(x.name||x.id)}${S.src&&S.src.personasId===x.id?'<span class="tag">in use</span>':""}</span><span class="hint">${esc([x.count?x.count+" persona"+(x.count===1?"":"s"):"",x.icpName?"from "+x.icpName:x.company,x.savedAt?new Date(x.savedAt).toLocaleDateString():""].filter(Boolean).join(" · "))}</span></div><div class="savedbtns"><button class="btn" type="button" data-src="${esc(x.id)}">${S.src&&S.src.personasId===x.id?"Reload":"Use These Personas"}</button></div></div>`).join("")
    : '<p class="status" style="margin:0">No saved personas yet. Build personas in the Persona Builder, then select Save Personas.</p>';
}
function renderSets(){
  const L=PromptStore.list();
  $("sets").innerHTML=L.map(x=>`<div class="savedrow"><div><span class="lab">${esc(x.name||x.id)}${S.setId===x.id?'<span class="tag">open</span>':""}</span><span class="hint">${esc([x.total!=null?x.total+" prompts":"",x.approved!=null?x.approved+" approved":"",x.savedAt?new Date(x.savedAt).toLocaleDateString():""].filter(Boolean).join(" · "))}</span></div><div class="savedbtns"><button class="btn" type="button" data-open="${esc(x.id)}">Open</button><button class="btn quiet" type="button" data-del="${esc(x.id)}">${delArmed===x.id?"Click again to delete":"Delete"}</button></div></div>`).join("");
}
function renderBrands(){
  $("brands").innerHTML=S.brands.map((b,i)=>`<div class="row brow" data-b="${i}">
    <label for="q-bn-${i}"><span class="lab">Brand${b.own?'<span class="req">own brand</span>':""}</span><input type="text" id="q-bn-${i}" data-bf="name" value="${esc(b.name)}"></label>
    <label for="q-bd-${i}"><span class="lab">Website domains</span><input type="text" id="q-bd-${i}" data-bf="domains" value="${esc(b.domains)}" placeholder="example.com"></label>
    <label for="q-bp-${i}"><span class="lab">Name patterns</span><input type="text" id="q-bp-${i}" data-bf="patterns" value="${esc(b.patterns)}"></label>
    <label for="q-be-${i}"><span class="lab">Exclude patterns</span><input type="text" id="q-be-${i}" data-bf="exclude" value="${esc(b.exclude)}" placeholder="name collisions"></label>
    <div class="bact"><label class="chk2"><input type="radio" name="q-own" data-own="${i}" ${b.own?"checked":""}> Own</label><button class="btn quiet" type="button" data-rmb="${i}" aria-label="Remove ${esc(b.name)}">×</button></div></div>`).join("");
}
function renderSettings(){
  $("settings").innerHTML=SETTING_LABELS.map(([k,l])=>`<label for="q-set-${k}"><span class="hint">${esc(l)}</span><input type="text" inputmode="numeric" id="q-set-${k}" data-set="${k}" value="${esc(S.settings[k])}"></label>`).join("");
}
const pct=(n,base)=>base>=20?`${n} of ${base} (${Math.round(n/base*100)}%)`:`${n} of ${base}`;
function renderSummary(){
  const all=S.cols.flatMap((c,ci)=>c.prompts.filter(p=>p.status!=="Rejected")), n=all.length, ap=all.filter(p=>p.status==="Approved").length;
  $("sumtitle").textContent=(S.src.company||"Brand")+" Prompts";
  const by=(f,vals)=>vals.map(v=>`${v} ${pct(all.filter(p=>p[f]===v).length,n)}`).join(" · ");
  $("summary").innerHTML=`<div class="sumgrid"><div><span class="hint">Generated</span><b>${n}</b></div><div><span class="hint">Approved</span><b>${n?pct(ap,n):"0"}</b></div><div><span class="hint">Personas</span><b>${S.cols.length}</b></div><div><span class="hint">Tested</span><b>Not yet</b></div></div>`+
    (n?`<p class="status" style="margin:12px 0 0">By stage: ${by("st",STAGES)}</p><p class="status" style="margin:4px 0 0">By type: ${by("ty",TYPES)}</p>`:"")+
    `<p class="status" style="margin:12px 0 0">Testing against ChatGPT and Gemini (search rate, retrieved, cited, named) is the next build step and runs in The Night Ventures, because it needs a server. Approved prompts from here feed it.</p>`;
}
function filtered(ci){ const f=UI.filters[ci]||{}; const q=(f.q||"").toLowerCase(); return S.cols[ci].prompts.filter(p=>(!f.s||p.s===f.s)&&(!f.st||p.st===f.st)&&(!f.ty||p.ty===f.ty)&&(f.status?p.status===f.status:p.status!=="Rejected"||f.status==="Rejected")&&(!q||p.text.toLowerCase().includes(q))); }
function trimBox(ci){ const plan=trimPlan(ci), c=S.cols[ci], h=haveMap(ci), cut={}; for(const p of plan) cut[key(p.s,p.st)]=(cut[key(p.s,p.st)]||0)+1;
  const ap=plan.filter(p=>p.status==="Approved").length, cells=Object.keys(cut).sort();
  return `<div class="ptrim" role="group" aria-label="Trim to target"><p><b>Trim will reject ${plan.length} of ${live(ci).length} prompts</b>, leaving ${live(ci).length-plan.length} against a target of ${c.target}. ${ap} of them are approved, ${plan.length-ap} are drafts. Rejected prompts stay stored and can be set back by hand.</p>
   <p class="hint">By situation and stage, now → after: ${cells.map(k=>`${k.replace("|"," ")} ${h[k]} → ${h[k]-cut[k]}`).join(" · ")}</p>
   <div class="actions"><button class="btn primary" type="button" data-trimgo="${ci}">Reject ${plan.length}</button><button class="btn" type="button" data-trimno="${ci}">Cancel</button></div></div>`; }
function renderMix(){ if(!S.src||!S.mix) return;
  const tot=S.cols.reduce((a,_,i)=>a+live(i).length,0);
  $("mix").innerHTML=`<div class="mixtop"><label for="q-mix-total"><span class="hint">Total prompts across all personas</span><input type="text" inputmode="numeric" id="q-mix-total" value="${esc(S.mix.total)}"></label><button class="btn" type="button" id="q-mix-reset">Reset to persona shares</button><span class="hint">${tot} written so far, not counting rejected</span></div>
   <table class="pgrid mixgrid"><thead><tr><th>Persona</th><th>Share from the personas</th><th>Weight</th><th>Part of total</th><th>Target</th><th>Written</th><th></th></tr></thead><tbody>${
     S.src.personas.map((p,i)=>{ const have=live(i).length, t=S.cols[i].target; return `<tr><td>${esc(p.name)}</td><td>${p.share?p.share+"%":"not given"}</td><td><input type="text" inputmode="decimal" data-mixw="${i}" value="${esc(S.mix.w[i])}" aria-label="Weight for ${esc(p.name)}"></td><td>${mixPct(i)}%</td><td><b>${t}</b></td><td>${have}</td><td>${have>t?`<span class="pill">${have-t} over target</span>`:have<t?`${t-have} to write`:"at target"}</td></tr>`; }).join("")}</tbody></table>`; }
function colHtml(ci){
  const p=S.src.personas[ci], c=S.cols[ci], t=cellTargets(ci), h=haveMap(ci), f=UI.filters[ci]||{}, busy=UI.busy===ci, why=canGenerate(ci);
  const gen=live(ci).length, ap=c.prompts.filter(x=>x.status==="Approved").length, rows=filtered(ci);
  const opt=(vals,cur,all)=>`<option value="">${all}</option>`+vals.map(v=>`<option${v===cur?" selected":""}>${esc(v)}</option>`).join("");
  const next=Math.min(S.settings.batch,Math.max(0,c.target-gen));
  return `<div class="pcol" data-ci="${ci}" id="q-col-${ci}">
   <div class="phead"><h3>${esc(p.name)}</h3><p class="hint">${esc(p.role||"")}${p.slim?" · influencer only":""}</p>
    <div class="ptarget"><span class="hint">Target</span><b>${c.target}</b><span class="hint">${mixPct(ci)}% of ${S.mix.total}, set under Persona Mix</span>${gen>c.target?`<span class="pill">${gen-c.target} over target</span><button class="btn" type="button" data-trim="${ci}" ${UI.busy>=0||RUN.on?"disabled":""}>Trim to target</button>`:""}</div>
    ${UI.trim===ci&&gen>c.target?trimBox(ci):""}
    <div class="pstyle"><label class="hint" for="q-style-${ci}">Your own prompts for this persona (optional): 3 to 5, one per line. Claude copies their length and tone, never their topic.</label><textarea id="q-style-${ci}" data-style="${ci}" rows="4" placeholder="One prompt per line">${esc((S.styles||[])[ci]||"")}</textarea><p class="hint" data-stylenote="${ci}">${esc(styleNote(ci))}</p></div>
    <div class="pcount"><div><span class="hint">Generated</span><b>${gen}</b></div><div><span class="hint">Approved</span><b>${ap}</b></div><div><span class="hint">Tested</span><b>0</b></div><div><span class="hint">Own brand named</span><b>Not tested</b></div></div></div>
   <table class="pgrid"><thead><tr><th>Situation</th><th>Weight</th>${STAGES.map(s=>`<th>${s}</th>`).join("")}</tr></thead><tbody>${
     p.situations.map(s=>{ const sit=S.src.situations.find(x=>x.id===s); return `<tr><td title="${esc(sit.name)}">${s} <span class="hint">${esc(sit.name)}</span></td><td><input type="text" inputmode="decimal" data-w="${ci}|${s}" value="${esc(c.weights[s])}" aria-label="Weight for ${s}"></td>${STAGES.map(st=>{ const k=key(s,st), have=h[k]||0, tg=t[k]||0; return `<td class="${c.exhausted[k]&&have<tg?"ex":have<tg?"under":""}" title="${c.exhausted[k]?"Exhausted: no distinct prompts left":""}">${have} / ${tg}${c.exhausted[k]&&have<tg?" ·":""}</td>`; }).join("")}</tr>`; }).join("")||'<tr><td colspan="5">No buyer situation applies to this persona.</td></tr>'}</tbody></table>
   <div class="pact"><button class="btn primary" type="button" data-gen="${ci}" ${why||UI.busy>=0||RUN.on||!p.situations.length?"disabled":""}>${busy?"Working…":why==="exhausted"?"No distinct prompts left for this persona":why==="target"?"Target reached":"Generate next "+next}</button></div>
   <div class="pprog" data-prog="${ci}" hidden><div class="pbar"><i></i></div><span class="hint"></span></div>
   <p class="status" data-status="${ci}" role="status">${esc(UI.status[ci]||"")}</p>
   <div class="pfilters">
     <select data-f="${ci}|s" aria-label="Filter by situation">${opt(p.situations,f.s,"All situations")}</select>
     <select data-f="${ci}|st" aria-label="Filter by stage">${opt(STAGES,f.st,"All stages")}</select>
     <select data-f="${ci}|ty" aria-label="Filter by type">${opt(TYPES,f.ty,"All types")}</select>
     <select data-f="${ci}|status" aria-label="Filter by status">${opt(STATUSES,f.status,"Draft and approved")}</select>
     <input type="text" data-f="${ci}|q" value="${esc(f.q||"")}" placeholder="Search" aria-label="Search prompts" style="margin:0">
   </div>
   <div class="pbulk"><span class="hint">${rows.length} shown</span><button class="btn" type="button" data-bulk="${ci}|all">Select all shown</button><button class="btn" type="button" data-bulk="${ci}|Approved">Approve selected</button><button class="btn" type="button" data-bulk="${ci}|Rejected">Reject selected</button><button class="btn" type="button" data-bulk="${ci}|approveall">Approve all drafts</button></div>
   <div class="plist">${rows.map(r=>{ const iss=localIssues(ci,r); return `<div class="prow st-${r.status.toLowerCase()}" data-id="${r.id}">
      <input type="checkbox" data-sel="${r.id}" aria-label="Select ${r.id}">
      <div class="pmain"><textarea rows="3" data-text="${r.id}" aria-label="Prompt ${r.id}">${esc(r.text)}</textarea>
       <div class="ptags"><span>${r.id}</span><span>${r.s}</span><span>${r.st}</span><span>${r.ty}</span>${(r.vars||[]).map(v=>`<span>${esc(v.k)}: ${esc(v.v)}</span>`).join("")}${(r.alts||[]).map(a=>`<span>names ${esc(a)}</span>`).join("")}${r.diag?"<span>diagnostic</span>":""}${iss.map(i=>`<span class="pill h">${esc(i)}</span>`).join("")}${r.unchecked?'<span class="pill h">duplicate check not done</span>':""}${r.amb?`<span class="pill h">may be misread: ${esc(r.amb)}</span>`:""}${r.status==="Rejected"&&r.rej?`<span class="pill">rejected: ${esc(r.rej)}</span>`:""}</div></div>
      <select data-status-of="${r.id}" aria-label="Status of ${r.id}">${STATUSES.map(s=>`<option${s===r.status?" selected":""}>${s}</option>`).join("")}</select></div>`; }).join("")||'<p class="status">No prompts here yet.</p>'}</div>
  </div>`;
}
function renderCols(){
  if(!S.src) return;
  const keep=$("cols").scrollLeft;
  $("pnav").innerHTML=`<span class="hint">${S.cols.length} personas, one column each. Scroll sideways or jump to:</span>`+S.cols.map((c,ci)=>`<button class="btn" type="button" data-jump="${ci}">${esc(S.src.personas[ci].name)} · ${live(ci).length}/${c.target}</button>`).join("");
  $("cols").innerHTML=S.cols.map((_,ci)=>colHtml(ci)).join(""); $("cols").scrollLeft=keep;
  renderMix(); renderSummary(); renderRun(); if(PROG.ci>=0) paintProgress();
}
function render(){
  renderSources(); renderSets(); $("work").hidden=!S.src; $("setname").value=S.name||"";
  if(S.src){ renderBrands(); renderSettings(); renderCols(); }
}

/* ---------- Events ---------- */
let srcArmed="", delArmed="", resetArmed=false;
$("sources").addEventListener("click",e=>{
  const b=e.target.closest("[data-src]"); if(!b) return; const id=b.dataset.src;
  const has=S.src&&S.cols.some(c=>c.prompts.length);
  if(has&&srcArmed!==id){ srcArmed=id; $("srcmsg").textContent="This replaces the prompts you are working on. Save them first if you want to keep them, then select the button again."; setTimeout(()=>{ if(srcArmed===id) srcArmed=""; },8000); return; }
  srcArmed=""; const prev=S; const err=loadSource(id);
  if(err){ S=prev; $("srcmsg").textContent=err; return; }
  UI.filters={}; UI.status={}; $("srcmsg").textContent=`Loaded ${S.src.personas.length} personas, ${S.src.situations.length} buyer situations, ${S.src.variables.length} question variables and ${S.brands.length-1} competitor names.`; save(); render();
});
$("brands").addEventListener("input",e=>{ const r=e.target.closest("[data-b]"); if(!r||!e.target.dataset.bf) return; S.brands[+r.dataset.b][e.target.dataset.bf]=e.target.value; save(); });
$("brands").addEventListener("change",e=>{ if(e.target.dataset.own!=null){ S.brands.forEach((b,i)=>b.own=i===+e.target.dataset.own); save(); renderBrands(); renderCols(); } else if(e.target.dataset.bf){ renderCols(); } });
$("brands").addEventListener("click",e=>{ const b=e.target.closest("[data-rmb]"); if(!b) return; const i=+b.dataset.rmb; if(S.brands[i].own){ toast("Mark another brand as own before removing this one"); return; } S.brands.splice(i,1); save(); renderBrands(); });
$("addbrand").onclick=()=>{ S.brands.push({name:"",domains:"",patterns:"",exclude:"",own:!S.brands.some(b=>b.own)}); save(); renderBrands(); };
$("settings").addEventListener("change",e=>{ const k=e.target.dataset.set; if(!k) return; const v=Number(e.target.value); if(Number.isFinite(v)&&v>=0){ S.settings[k]=v; save(); renderCols(); } else e.target.value=S.settings[k]; });
$("cols").addEventListener("input",e=>{ const t=e.target; if(t.dataset.style==null) return; const ci=+t.dataset.style; S.styles[ci]=t.value; save(); const n=document.querySelector(`[data-stylenote="${ci}"]`); if(n) n.textContent=styleNote(ci); });
$("mix").addEventListener("change",e=>{ const t=e.target;
  if(t.id==="q-mix-total"){ const v=Math.round(Number(t.value)); if(Number.isFinite(v)&&v>=0) S.mix.total=v; }
  else if(t.dataset.mixw!=null){ const v=Number(t.value); if(Number.isFinite(v)&&v>=0) S.mix.w[+t.dataset.mixw]=v; }
  else return;
  UI.trim=-1; applyMix(); save();
  // Redrawing replaces the boxes. Wait until the cursor has moved on, redraw, then put it back, so tabbing from one weight to the next works.
  setTimeout(()=>{ const a=document.activeElement, sel=a&&$("mix").contains(a)?(a.id?"#"+a.id:a.dataset.mixw!=null?`[data-mixw="${a.dataset.mixw}"]`:""):""; renderCols(); if(sel){ const el=$("mix").querySelector(sel); if(el){ el.focus(); if(el.select) el.select(); } } },0); });
$("mix").addEventListener("click",e=>{ if(!e.target.closest("#q-mix-reset")) return; S.mix.w=shareWeights(); UI.trim=-1; applyMix(); save(); renderCols(); toast("Weights reset to the personas' prompt shares"); });
$("pnav").addEventListener("click",e=>{ const b=e.target.closest("[data-jump]"); if(!b) return; const el=document.getElementById("q-col-"+b.dataset.jump); if(el) el.scrollIntoView({behavior:"smooth",inline:"start",block:"nearest"}); });
const colsEl=$("cols");
colsEl.addEventListener("click",e=>{
  const g=e.target.closest("[data-gen]"); if(g){ generate(+g.dataset.gen); return; }
  const tr=e.target.closest("[data-trim]"); if(tr){ UI.trim=UI.trim===+tr.dataset.trim?-1:+tr.dataset.trim; renderCols(); return; }
  if(e.target.closest("[data-trimno]")){ UI.trim=-1; renderCols(); return; }
  const tg=e.target.closest("[data-trimgo]"); if(tg){ if(UI.busy>=0||checking||RUN.on){ toast("Wait for the current run to finish"); return; } const ci=+tg.dataset.trimgo, plan=trimPlan(ci); for(const p of plan) p.status="Rejected"; UI.trim=-1; save(); renderCols(); toast(`${plan.length} prompt${plan.length===1?"":"s"} rejected to bring this persona to its target`); return; }
  const b=e.target.closest("[data-bulk]"); if(!b) return; const [ci,act]=b.dataset.bulk.split("|"), colEl=b.closest(".pcol");
  if(act==="approveall"){ const n=approveDrafts([+ci]); toast((n?`${n} draft${n===1?"":"s"} approved for this persona.`:"No drafts to approve for this persona.")+heldNote()); return; }
  if(act==="all"){ const boxes=[...colEl.querySelectorAll("[data-sel]")], on=boxes.some(x=>!x.checked); boxes.forEach(x=>x.checked=on); return; }
  const ids=[...colEl.querySelectorAll("[data-sel]:checked")].map(x=>x.dataset.sel); if(!ids.length){ toast("Select prompts first"); return; }
  for(const p of S.cols[+ci].prompts) if(ids.includes(p.id)){ p.status=act; if(act==="Approved") delete p.amb; if(act!=="Rejected") delete p.rej; } save(); renderCols(); toast(`${ids.length} prompt${ids.length===1?"":"s"} ${act.toLowerCase()}`);
});
colsEl.addEventListener("change",e=>{
  const t=e.target, colEl=t.closest(".pcol"); if(!colEl) return; const ci=+colEl.dataset.ci, c=S.cols[ci];
  if(t.dataset.w){ const s=t.dataset.w.split("|")[1], v=Number(t.value); if(Number.isFinite(v)&&v>=0) c.weights[s]=v; save(); renderCols(); }
  else if(t.dataset.f){ const k=t.dataset.f.split("|")[1]; (UI.filters[ci]=UI.filters[ci]||{})[k]=t.value; renderCols(); }
  else if(t.dataset.statusOf){ const p=c.prompts.find(x=>x.id===t.dataset.statusOf); if(p){ p.status=t.value; if(t.value!=="Rejected") delete p.rej; if(t.value==="Approved") delete p.amb; save(); renderCols(); } }
  else if(t.dataset.text){ const p=c.prompts.find(x=>x.id===t.dataset.text); if(p){ const v=t.value.replace(/\s+/g," ").trim(); if(v&&v!==p.text){ p.text=v; p.edited=true; delete p.amb; delete p.ck; save(); renderCols(); } else t.value=p.text; } }
});
function exportRows(){ const out=[]; S.cols.forEach((c,ci)=>c.prompts.forEach(p=>out.push({id:p.id,persona:S.src.personas[ci].name,situation:p.s,stage:p.st,type:p.ty,variables:(p.vars||[]).map(v=>v.k+": "+v.v),named_brands:p.alts||[],status:p.status,prompt:p.text}))); return out; }
function exportJson(){ return JSON.stringify({brand:S.src.company,personas_set:S.src.personasName,exported_at:new Date().toISOString(),tracked_brands:S.brands.map(b=>({name:b.name,own:!!b.own,domains:listOf(b.domains),name_patterns:listOf(b.patterns),exclude_patterns:listOf(b.exclude)})),situations:S.src.situations.map(s=>({id:s.id,name:s.name})),prompts:exportRows()},null,1); }
function exportCsv(){ const q=v=>'"'+String(v).replace(/"/g,'""')+'"'; return ["ID,Persona,Situation,Stage,Type,Variables,Named brands,Status,Prompt"].concat(exportRows().map(r=>[r.id,r.persona,r.situation,r.stage,r.type,r.variables.join("; "),r.named_brands.join("; "),r.status,r.prompt].map(q).join(","))).join("\n"); }
const fileSlug=()=>(S.src.company||"brand").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||"brand";
$("copyjson").onclick=()=>copy(exportJson(),"Prompts");
$("dljson").onclick=()=>download("prompts-"+fileSlug()+".json",exportJson());
$("dlcsv").onclick=()=>download("prompts-"+fileSlug()+".csv",exportCsv());
$("reset").onclick=function(){
  if(!resetArmed){ resetArmed=true; this.textContent="Click again to delete all prompts here"; setTimeout(()=>{ resetArmed=false; this.textContent="Reset prompts"; },4000); return; }
  resetArmed=false; this.textContent="Reset prompts"; S.cols.forEach(c=>{ c.prompts=[]; c.exhausted={}; c.log=[]; c.seq=0; }); S.rot={}; UI.status={}; save(); render(); toast("Prompts cleared");
};

/* ---------- Push to The Night Ventures ---------- */
/* Approve every Draft in the given persona columns. Rejected prompts stay rejected. */
function approveDrafts(cis){ let n=0; held=0; for(const ci of cis) for(const p of S.cols[ci].prompts) if(p.status==="Draft"){ if(p.amb){ held++; continue; } p.status="Approved"; n++; } if(n){ save(); renderCols(); } return n; }
let held=0;
const heldNote=()=>held?` ${held} marked "may be misread" stay as drafts: edit them, or select and approve them yourself.`:"";
$("approveall").onclick=()=>{ if(!S.src) return; const n=approveDrafts(S.cols.map((_,i)=>i)); toast((n?`${n} draft${n===1?"":"s"} approved across all personas.`:"No drafts to approve.")+heldNote()); };
/* One-off check of prompts written before the stand-alone rule existed. A flagged prompt goes back to Draft with the reason shown on it. */
let checking=false;
/* Sends prompts to Claude 40 at a time and asks which could be misread out of context. A flagged prompt goes back to Draft with the reason on it;
   one that passes is marked checked (ck), so a later run does not send it again. Stops between batches when `halt()` says so. Throws on a Claude error. */
async function checkPrompts(sample,all,say,halt){
  const out={done:0,flagged:0,unread:0,stopped:false};
  for(let i=0;i<all.length;i+=40){ if(halt&&halt()){ out.stopped=true; break; }
    const part=all.slice(i,i+40); say(`Checking prompts ${i+1} to ${i+part.length} of ${all.length}…`);
    let v; try{ v=parseJsonList(await ask(sample,ambPrompt(part.map(p=>p.text)),"default")); }catch(e){ if(e&&e.code&&e.code!=="parse") throw Object.assign(e,{partial:out}); out.unread+=part.length; continue; }
    const by={}; for(const r of v) if(r&&r.n!=null) by[Number(r.n)]=r;
    part.forEach((p,k)=>{ const r=by[k+1]; if(!r){ out.unread++; return; } out.done++; if(r.amb===true){ p.amb=String(r.why||"").trim().slice(0,140)||"unclear who is asking or in which market"; p.status="Draft"; delete p.ck; out.flagged++; } else { delete p.amb; p.ck=true; } });
    save(); renderCols(); }
  return out;
}
$("checkamb").onclick=async()=>{
  if(!S.src||checking||RUN.on) return; if(UI.busy>=0){ toast("Wait for generation to finish"); return; }
  const msg=$("checkmsg"), sample=await sampleP; if(!sample){ msg.textContent="Claude is not available in this view, so the check cannot run here. Open the page in claude.ai."; return; }
  const all=S.cols.flatMap(c=>c.prompts.filter(p=>p.status!=="Rejected")); if(!all.length){ msg.textContent="There are no prompts to check."; return; }
  checking=true; $("checkamb").disabled=true;
  try{ const r=await checkPrompts(sample,all,t=>{ msg.textContent=t; });
    msg.textContent=`Checked ${r.done} of ${all.length} prompts. ${r.flagged} could be misread out of context and ${r.flagged===1?"is":"are"} back in Draft with the reason shown on ${r.flagged===1?"it":"each"}. Filter by status "Draft" to see them.`+(r.unread?` ${r.unread} could not be checked; run it again.`:"");
  }catch(e){ const r=e.partial||{done:0,flagged:0}; msg.textContent=`The check stopped${e&&e.code==="rate_limited"?" because Claude is rate limited":""}. ${r.done} prompts were checked and ${r.flagged} flagged. Run it again to finish.`; }
  checking=false; $("checkamb").disabled=false; save(); renderCols();
};

/* ---------- Generate all ---------- */
/* One run: check what is there, trim personas over target, approve drafts that passed, then write every persona up to its target.
   S.run is saved, so the result table survives a reload and a stopped run can be resumed. */
function runRows(){ if(!S.src||!S.run) return "";
  const st=S.run.state, cur=S.run.ci;
  return `<table class="pgrid rungrid"><thead><tr><th>Persona</th><th>Approved</th><th>Target</th><th>Exhausted cells</th><th>Dropped</th><th></th></tr></thead><tbody>${S.cols.map((c,ci)=>{
    const ap=c.prompts.filter(p=>p.status==="Approved").length, dr=c.prompts.filter(p=>p.status==="Draft").length, ex=shortfalls(ci).filter(x=>x.ex).length, why=canGenerate(ci);
    const note=st==="running"&&cur===ci?"writing now":st==="running"&&cur<ci?"waiting":ap>=c.target?"target met":why==="exhausted"?"no distinct prompts left":why==="target"?"at target, counting drafts":st==="running"?"done":"not finished";
    return `<tr><td>${esc(S.src.personas[ci].name)}</td><td><b>${ap}</b></td><td>${c.target}</td><td>${ex}</td><td>${c.dropped||0}</td><td>${note}${dr?` · ${dr} draft${dr===1?"":"s"} left for you`:""}</td></tr>`; }).join("")}</tbody></table>`; }
function renderRun(){ if(!S.src) return; const r=S.run, resume=r&&(r.state==="stopped"||r.state==="error");
  $("genall").hidden=RUN.on; $("genall").textContent=resume?"Resume Generate all":"Generate all"; $("stop").hidden=!RUN.on; $("stop").disabled=RUN.stop; $("stop").textContent=RUN.stop?"Stopping after this request…":"Stop";
  $("runmsg").textContent=r?r.msg||"":""; $("runrows").innerHTML=runRows(); }
const runSay=t=>{ if(S.run){ S.run.msg=t; } const el=$("runmsg"); if(el) el.textContent=t; };
$("stop").onclick=()=>{ if(!RUN.on) return; RUN.stop=true; renderRun(); };
$("genall").onclick=async()=>{
  if(!S.src||RUN.on||checking) return; if(UI.busy>=0){ toast("Wait for generation to finish"); return; }
  const sample=await sampleP; if(!sample){ S.run={state:"error",ci:-1,msg:"Claude is not available in this view, so prompts cannot be generated here. Open the page in claude.ai."}; renderRun(); return; }
  const resumed=!!(S.run&&(S.run.state==="stopped"||S.run.state==="error"));
  if(!resumed) S.cols.forEach(c=>{ c.dropped=0; });
  RUN.on=true; RUN.stop=false; S.run={state:"running",ci:-1,msg:"",trimmed:resumed&&S.run.trimmed||0,flagged:resumed&&S.run.flagged||0,approved:resumed&&S.run.approved||0,rejected:resumed&&S.run.rejected||0}; UI.trim=-1; save(); renderCols();
  const end=(state,msg)=>{ RUN.on=false; RUN.stop=false; S.run.state=state; S.run.ci=-1; S.run.msg=msg; save(); render(); };
  const tally=()=>{ const dr=S.cols.reduce((a,c)=>a+c.prompts.filter(p=>p.status==="Draft").length,0);
    return `Before writing: ${S.run.flagged} existing prompt${S.run.flagged===1?"":"s"} flagged as possibly misread, ${S.run.approved} draft${S.run.approved===1?"":"s"} approved, ${S.run.rejected} draft${S.run.rejected===1?"":"s"} rejected (flagged or failing a check) and replaced, ${S.run.trimmed} rejected to bring personas to target. Rejected prompts stay stored, with the reason.`+(dr?` ${dr} draft${dr===1?"":"s"} left: filter by status "Draft".`:""); };
  try{
    // 1. Check prompts that have not been checked yet (first, so that trimming removes the flagged ones first).
    checking=true;
    const todo=S.cols.flatMap(c=>c.prompts.filter(p=>p.status!=="Rejected"&&!p.ck));
    if(todo.length){ const r=await checkPrompts(sample,todo,t=>runSay("Step 1 of 4 · "+t),()=>RUN.stop); S.run.flagged+=r.flagged;
      if(r.stopped){ checking=false; end("stopped",`Stopped during the check. ${r.done} of ${todo.length} prompts were checked. Select Resume to continue.`); return; } }
    checking=false;
    // 2. Drafts: approve those that passed the check and have no local issue; reject the rest, so the run ends with no drafts.
    //    A rejected prompt stays stored with the reason, and the writing step replaces it.
    runSay("Step 2 of 4 · Approving drafts that passed the check, rejecting the rest…");
    S.cols.forEach((c,ci)=>{ for(const p of c.prompts){ if(p.status!=="Draft") continue; const iss=localIssues(ci,p);
      if(p.ck&&!p.amb&&!p.unchecked&&!iss.length){ p.status="Approved"; S.run.approved++; }
      else { p.status="Rejected"; p.rej=p.amb?"could be misread: "+p.amb:iss.length?iss.join("; "):"not checked"; S.run.rejected++; } } });
    // 3. Trim personas over target. No preview in a run. Flagged prompts go first.
    runSay("Step 3 of 4 · Trimming personas that are over target…");
    S.cols.forEach((c,ci)=>{ const plan=trimPlan(ci); for(const p of plan) p.status="Rejected"; S.run.trimmed+=plan.length; });
    save(); renderCols();
    // 4. Write each persona up to its target.
    for(let ci=0;ci<S.cols.length;ci++){
      S.run.ci=ci;
      for(let guard=0;guard<60;guard++){
        if(RUN.stop){ end("stopped",`Stopped while writing for ${S.src.personas[ci].name}. Select Resume to continue. ${tally()}`); return; }
        if(canGenerate(ci)) break;
        runSay(`Step 4 of 4 · Writing for ${S.src.personas[ci].name} (${ci+1} of ${S.cols.length}): ${live(ci).length} of ${S.cols[ci].target}`); renderRun();
        const r=await generate(ci,true);
        if(r.stopped){ end("stopped",`Stopped while writing for ${S.src.personas[ci].name}. Select Resume to continue. ${tally()}`); return; }
        if(r.error){ end("error",`The run stopped while writing for ${S.src.personas[ci].name}${r.error==="rate_limited"?" because Claude is rate limited. Wait a minute, then select Resume":r.error==="not_granted"?" because it needs permission to ask Claude. Select Resume and allow it":". Select Resume to continue"}. ${tally()}`); return; }
        if(r.idle||(!r.added&&!r.dropped)) break;
      }
    }
    end("finished",`Finished. ${tally()} Save Prompts and Push to The Night Ventures are yours to click.`);
  }catch(e){ checking=false; end("error",`The run stopped${e&&e.code==="rate_limited"?" because Claude is rate limited. Wait a minute, then select Resume":". Select Resume to continue"}. ${tally()}`); }
};
/* The Night Ventures is where tracked brands are maintained. A brand already there (same website domain, else same name) is sent back unchanged, so a push never renames, empties or removes one. */
const dom=d=>String(d||"").replace(/^https?:\/\//i,"").replace(/^www\./i,"").replace(/\/.*$/,"").trim().toLowerCase();
function mergeBrands(live,mine){
  const arr=v=>Array.isArray(v)?v:[], low=x=>String(x||"").trim().toLowerCase();
  const out=(live||[]).filter(l=>l&&l.name).map(l=>({name:l.name,own:!!l.is_own,domains:arr(l.domains),name_patterns:arr(l.name_patterns),exclude_patterns:arr(l.exclude_patterns)}));
  const kept=out.length, hasOwn=out.some(l=>l.own), added=[];
  for(const b of mine){
    const hit=out.slice(0,kept).find(l=>l.domains.map(dom).some(d=>d&&b.domains.map(dom).includes(d)))||out.slice(0,kept).find(l=>low(l.name)===low(b.name))||out.slice(0,kept).find(l=>l.name_patterns.some(x=>low(x)===low(b.name)));
    if(hit||added.some(a=>low(a.name)===low(b.name))) continue;
    added.push(Object.assign({},b,{own:b.own&&!hasOwn})); }
  return {brands:out.concat(added),kept,added:added.length,addedNames:added.map(a=>a.name)};
}
$("push").onclick=()=>{
  if(!S.src) return;
  const rows=exportRows().filter(r=>r.status!=="Draft"), ap=rows.filter(r=>r.status==="Approved").length;
  if(!ap){ toast("Approve some prompts first"); return; }
  const own=S.brands.find(b=>b.own), noDomain=!own||!listOf(own.domains).length;
  TNV.open({
    guess:S.src.company,
    items:[`${ap} approved prompt${ap===1?" is":"s are"} sent to the Prompt Tests tab${rows.length>ap?`, plus ${rows.length-ap} rejected so they stay marked`:""}. Drafts are not sent.`,
      "Prompts already there are updated by ID. Test results are kept, except for a prompt whose wording changed: its earlier results are removed, because they tested different words. Prompts in The Night Ventures that are not in this set are left alone.",
      "Tracked brands already in The Night Ventures are kept exactly as they are. A brand that is only in this list is added. None are removed.",
      noDomain?"The own brand has no website domain yet. Without it, tests cannot tell whether the site was retrieved or cited. Cancel and add it under Tracked Brands.":"The existing Prompts tab and its prompts are not changed."],
    run: async (co,status)=>{
      status("Reading the tracked brands in The Night Ventures…");
      const mine=S.brands.filter(b=>b.name.trim()).map(b=>({name:b.name.trim(),own:!!b.own,domains:listOf(b.domains).map(dom),name_patterns:[...new Set([b.name.trim()].concat(listOf(b.patterns)))],exclude_patterns:listOf(b.exclude)}));
      const m=mergeBrands(await TNV.brands(co.id),mine);
      status("Writing to The Night Ventures…");
      const res=await TNV.pushPrompts(co.id,{source_set:S.name||"",brands:m.brands,
        prompts:rows.map(r=>({id:r.id,persona:r.persona,situation:r.situation,stage:r.stage,type:r.type,variables:r.variables,named_brands:r.named_brands,prompt:r.prompt,status:r.status}))});
      return `Pushed to ${co.name}: ${res.prompts} prompts. Tracked brands: ${m.kept} already there and left as they are, ${m.added} added${m.added?" ("+m.addedNames.join(", ")+")":""}. The company now has ${res.total} prompts in its Prompt Tests tab.`;
    }
  });
};

/* ---------- Saved prompt sets ---------- */
const slugId=s=>String(s).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,80)||"prompts";
let saveConfirm="";
$("setname").addEventListener("input",e=>{ S.name=e.target.value; save(); });
$("save").onclick=async function(){
  const msg=$("setmsg"); if(!S.src){ msg.textContent="Pick saved personas first."; return; }
  const name=(S.name||"").trim(); if(!name){ msg.textContent="Give the prompt set a name."; return; }
  const id=slugId(name);
  if(PromptStore.exists(id)&&S.setId!==id&&saveConfirm!==id){ saveConfirm=id; msg.textContent=`A prompt set named "${name}" already exists. Select Save Prompts again to replace it.`; return; }
  const all=S.cols.flatMap(c=>c.prompts.filter(p=>p.status!=="Rejected"));
  const meta={name,company:S.src.company,personasId:S.src.personasId,personasName:S.src.personasName,total:all.length,approved:all.filter(p=>p.status==="Approved").length,count:S.cols.length,savedAt:new Date().toISOString(),
    pack:JSON.stringify({src:S.src,brands:S.brands,settings:S.settings,rot:S.rot,mix:S.mix,styles:S.styles})};
  this.disabled=true; msg.textContent="Saving…";
  try{ await PromptStore.saveSet(id,meta,S.cols); S.setId=id; save(); msg.textContent=`Saved "${name}".`; renderSets(); }
  catch(e){ msg.textContent = e&&e.code==="quota_exceeded" ? "Storage for this page is full. Delete a saved set, then try again." : "The prompt set could not be saved. You may not have permission to save on this page."; }
  finally{ this.disabled=false; }
};
$("sets").addEventListener("click",async e=>{
  const o=e.target.closest("[data-open]"), d=e.target.closest("[data-del]"), msg=$("setmsg");
  if(o){
    if(UI.busy>=0){ toast("Wait for generation to finish"); return; }
    msg.textContent="Opening…";
    try{ const x=await PromptStore.openSet(o.dataset.open); const st0=x&&x.meta&&(x.meta.pack?JSON.parse(x.meta.pack):x.meta.state); if(!st0){ msg.textContent="This prompt set could not be read."; return; }
      S=Object.assign({},st0,{settings:Object.assign({},DEFAULTS,st0.settings),cols:x.cols,name:x.meta.name,setId:o.dataset.open}); cleanNames(); cleanVariables(); ensureMix(); ensureStyles(); UI.filters={}; UI.status={}; UI.trim=-1; save(); render(); msg.textContent=`Opened "${x.meta.name}".`; }
    catch(err){ msg.textContent="This prompt set could not be opened."; }
  } else if(d){
    const id=d.dataset.del; if(delArmed!==id){ delArmed=id; renderSets(); setTimeout(()=>{ if(delArmed===id){ delArmed=""; renderSets(); } },4000); return; }
    delArmed=""; try{ await PromptStore.removeSet(id); if(S.setId===id) S.setId=""; toast("Prompt set deleted"); }catch(err){ toast("Could not delete. You may not have permission on this page."); } renderSets();
  }
});
PersonaStore.on(renderSources); ICPStore.on(renderSources); PromptStore.on(renderSets);
load();
{ const fixed=cleanNames(), tags=cleanVariables(); if(tags) save(); if(fixed.brands||fixed.prompts){ save(); setTimeout(()=>toast(`Competitor names cleaned: ${fixed.brands} tracked brand${fixed.brands===1?"":"s"}, ${fixed.prompts} prompt${fixed.prompts===1?"":"s"}`),400); } }
if(S.src){ const had=!!S.mix&&Array.isArray(S.styles); ensureMix(); ensureStyles(); if(S.run&&S.run.state==="running"){ S.run.state="stopped"; S.run.ci=-1; S.run.msg="The page was closed or reloaded during a run. Select Resume to continue."; } if(!had) save(); }
render();
