"""Assembles the published builder page from the files in src/.

    python3 build.py

Writes built/builder.html (the page to publish) and .check/j*.js (each script block, for `node --check`).
"""
import re, pathlib
ROOT=pathlib.Path(__file__).resolve().parent
SRC=ROOT/'src'; OUT=ROOT/'built'/'builder.html'; CHECK=ROOT/'.check'
CHECK.mkdir(exist_ok=True); OUT.parent.mkdir(exist_ok=True)
def rep(s,a,b,n=1):
    assert s.count(a)==n,(a[:60],s.count(a)); return s.replace(a,b)

# ---------- ICP tool ----------
icp=open(SRC/'icp-builder.html').read()
css=re.search(r'<style>\n(.*?)</style>',icp,re.S).group(1)
ibody=icp[icp.index('<div class="wrap">')+len('<div class="wrap">'):icp.index('<div id="toast"')]
ibody=ibody[:ibody.rindex('</div>')]
ijs=re.search(r'<script>(.*)</script>',icp,re.S).group(1)
ibody=rep(ibody,'<button class="btn" id="btn-continue" type="button" hidden>Continue output</button>',
 '<button class="btn" id="btn-continue" type="button" hidden>Continue output</button>\n      <button class="btn" id="btn-save" type="button" hidden>Save ICP</button>\n      <button class="btn" id="btn-push" type="button" hidden>Push to The Night Ventures</button>')
ijs=rep(ijs,'function setBusy(b){','let busyNow=false;\nfunction setBusy(b){ busyNow=b; $("btn-save").hidden=b||!state.out; $("btn-push").hidden=b||!state.outS;')
ijs=rep(ijs,'if(icp) showOut();','if(icp){ showOut(); $("btn-save").hidden=busyNow||!state.out; $("btn-push").hidden=busyNow||!state.outS; }')
ijs=rep(ijs,'/* ---------- Views ---------- */','''/* ---------- Save ICP ---------- */
let saveConfirm="";
const slugId=s=>String(s).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,80)||"icp";
$("btn-save").onclick=()=>{ const co=(state.vals["1.1"]||"").trim(); $("save-name").value=state.savedName||(co?co+" ICP":""); $("save-msg").textContent=""; saveConfirm=""; $("savedlg").showModal(); $("save-name").select(); };
$("save-cancel").onclick=()=>$("savedlg").close();
$("save-name").addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); $("save-ok").click(); } });
async function saveIcp(name){
  const v=k=>(state.vals[k]||"").trim();
  const obj={name,company:v("1.1"),mode:state.mode,markdown:state.out,inputs:toMarkdown(true),ctx:{product:v("1.2"),value:v("1.4"),problem:v("1.5")||v("4.1"),delivery:v("1.7"),deal_size:v("1.9"),sales_model:v("6.1"),sales_complexity:v("6.2")},savedAt:new Date().toISOString()};
  if(JSON.stringify(obj).length>230000) obj.inputs="";
  await ICPStore.save(slugId(name),obj); state.savedName=name; save();
}
$("save-ok").onclick=async function(){
  const name=$("save-name").value.trim(), msg=$("save-msg");
  if(!name){ msg.textContent="Give the ICP a name."; return; }
  const id=slugId(name);
  if(ICPStore.exists(id)&&state.savedName!==name&&saveConfirm!==id){ saveConfirm=id; msg.textContent=`A saved ICP named "${name}" already exists. Select Save again to replace it.`; return; }
  this.disabled=true; msg.textContent="Saving…";
  try{ await saveIcp(name); $("savedlg").close(); toast("Saved "+name); $("out-status").textContent=`Saved as "${name}". It is listed under Saved ICPs here and in the Persona Builder.`; }
  catch(e){ msg.textContent = e&&e.code==="quota_exceeded" ? "Storage for this page is full. Delete a saved ICP, then try again." : "The ICP could not be saved. You may not have permission to save on this page."; }
  finally{ this.disabled=false; }
};
/* Results are saved automatically when a generation finishes, under the name last used or "<company> ICP". */
async function afterGenerate(){
  const co=(state.vals["1.1"]||"").trim(), name=state.savedName||(co?co.replace(/\\s*\\(.*?\\)\\s*/g," ").trim()+" ICP":"");
  if(!name||!state.outS) return;
  try{ await saveIcp(name); const st=$("out-status"); st.textContent=st.textContent+` Saved as "${name}".`; }
  catch(e){ const st=$("out-status"); st.textContent=st.textContent+" It could not be saved automatically; select Save ICP."; }
}
let icpDelArmed="";
function renderSavedIcps(){
  const L=ICPStore.list(); $("icpsaved").hidden=!L.length;
  $("icpsavedlist").innerHTML=L.map(x=>`<div class="savedrow"><div><span class="lab">${esc(x.name||x.id)}${state.savedName&&state.savedName===x.name?'<span class="tag">open</span>':""}</span><span class="hint">${esc([x.company,x.savedAt?"saved "+new Date(x.savedAt).toLocaleString([], {dateStyle:"medium",timeStyle:"short"}):""].filter(Boolean).join(" · "))}</span></div><div class="savedbtns"><button class="btn" type="button" data-iopen="${esc(x.id)}">Open</button><button class="btn quiet" type="button" data-idel="${esc(x.id)}">${icpDelArmed===x.id?"Click again to delete":"Delete"}</button></div></div>`).join("");
}
ICPStore.on(renderSavedIcps); renderSavedIcps();
$("icpsavedlist").addEventListener("click",async e=>{
  const o=e.target.closest("[data-iopen]"), d=e.target.closest("[data-idel]");
  if(o){
    if(busyNow){ toast("Wait for the current generation to finish, or select Stop"); return; }
    const x=ICPStore.list().find(i=>i.id===o.dataset.iopen); if(!x||!x.markdown) return;
    const md=String(x.markdown), cut=md.indexOf("\\n\\n---\\n\\n# Operational ICP");
    state.vals={}; state.ev={}; state.auto={}; state.uploads=[]; state.example=false; if(x.mode) state.mode=x.mode;
    if(x.inputs){ batch=[]; importMarkdown(String(x.inputs),x.name); state.uploads=[]; renderUpload(); $("import-note").hidden=true; }
    state.outS=cut>=0?md.slice(0,cut):md; state.outO=cut>=0?md.slice(cut+7):""; state.out=md; state.tab="s"; state.savedName=x.name||"";
    renderForm(); save(); renderSavedIcps(); location.hash="icp"; showOut(); setBusy(false);
    $("out-status").textContent=`Opened "${x.name||x.id}", with the inputs it was built from.`;
  } else if(d){
    const id=d.dataset.idel;
    if(icpDelArmed!==id){ icpDelArmed=id; renderSavedIcps(); setTimeout(()=>{ if(icpDelArmed===id){ icpDelArmed=""; renderSavedIcps(); } },4000); return; }
    icpDelArmed="";
    try{ const x=ICPStore.list().find(i=>i.id===id); await ICPStore.remove(id); if(x&&state.savedName===x.name){ state.savedName=""; save(); } toast("Saved ICP deleted"); }catch(err){ toast("Could not delete. You may not have permission on this page."); }
    renderSavedIcps();
  }
});

/* ---------- Push to The Night Ventures ---------- */
function summaryPrompt(){
  return `From the Strategic ICP below, write two things for a content team.

1. "icp": one paragraph of plain prose, at most 90 words, describing the ideal customer: who they are, the situation they are in and what they lack. Writers use it as the audience description for articles. No headings, lists, evidence labels or section references. Keep qualifiers the ICP states (for example "any size" or "anywhere"). Do not state an unresolved conflict or an unknown as a fact; leave it out.
2. "shared_traits": 4 to 8 short statements that are true of all ideal customers (attitudes, wants, constraints), each under 20 words, drawn from the fit criteria, the problem and the buyer situations.

Return JSON only, no code fence: {"icp":"...","shared_traits":["..."]}

${state.outS}`;
}
$("btn-push").onclick=()=>{
  if(!state.outS) return;
  TNV.open({
    guess:(state.vals["1.1"]||"").trim(),
    items:["The short ICP paragraph in the Personas tab is overwritten with a summary of this Strategic ICP.","The shared traits in the Personas tab are overwritten.","The full Strategic ICP is stored on the company.", state.outO?"The full Operational ICP is stored on the company.":"No Operational ICP was written, so any stored one is cleared."],
    run: async (co,status)=>{
      let icp="", traits=[];
      const sample=await sampleP;
      if(sample){
        status("Writing the short ICP paragraph…");
        try{ const r=await sample(summaryPrompt(),{modelTier:"default",cache:false}); const t=r.text||""; const j=JSON.parse(t.slice(t.indexOf("{"),t.lastIndexOf("}")+1));
          icp=String(j.icp||"").trim(); traits=(Array.isArray(j.shared_traits)?j.shared_traits:[]).map(x=>String(x).trim()).filter(Boolean).slice(0,10); }
        catch(e){ if(e&&e.code==="rate_limited") throw e; }
      }
      status("Writing to The Night Ventures…");
      const res=await TNV.pushIcp(co.id,{icp,shared_traits:traits,strategic_md:state.outS,operational_md:state.outO||""});
      return `Pushed to ${co.name}: the full Strategic ICP`+(res.operational?", the full Operational ICP":"")+(res.icp_updated?", the short ICP paragraph":"")+(res.traits?` and ${res.traits} shared traits`:"")+"."+(res.icp_updated?"":" The short ICP paragraph and shared traits were left as they were, because the summary could not be written.");
    }
  });
};

/* ---------- Views ---------- */''')
ibody=rep(ibody,'<main id="view-inputs">\n    <div class="setup">','<main id="view-inputs">\n    <div id="icpsaved" class="panel" style="margin-bottom:20px" hidden>\n      <p class="eyebrow">Saved ICPs</p>\n      <div id="icpsavedlist" class="savedlist"></div>\n      <p class="status" style="margin:8px 0 0">An ICP is saved automatically when it finishes generating. Open one to bring back its documents and inputs.</p>\n    </div>\n    <div class="setup">')
idlg='''<dialog id="savedlg">
  <p class="eyebrow">Output</p>
  <h2 style="font-size:26px">Save ICP</h2>
  <p class="sub" style="margin:8px 0 14px">A saved ICP can be pulled into the Persona Builder.</p>
  <label for="save-name" class="status">Name</label>
  <input id="save-name" type="text" maxlength="80" autocomplete="off">
  <p class="status" id="save-msg" role="status" style="min-height:1.4em;margin:8px 0 0"></p>
  <div class="actions"><button class="btn primary" id="save-ok" type="button">Save</button><button class="btn" id="save-cancel" type="button">Cancel</button></div>
</dialog>
<dialog id="tnvdlg">
  <p class="eyebrow">Output</p>
  <h2 style="font-size:26px">Push to The Night Ventures</h2>
  <label for="tnv-company" class="status" style="display:block;margin-top:14px">Company</label>
  <select id="tnv-company" style="margin-top:4px"></select>
  <ul id="tnv-items" style="margin:14px 0 0;padding-left:20px;font-size:14px"></ul>
  <p class="status" id="tnv-msg" role="status" style="min-height:1.4em;margin:12px 0 0"></p>
  <div class="actions"><button class="btn primary" id="tnv-go" type="button">Push</button><button class="btn" id="tnv-cancel" type="button">Cancel</button></div>
</dialog>'''
itail=icp[icp.index('<div id="toast"'):icp.index('<script>')]

# ---------- Persona tool ----------
per=open(SRC/'persona-builder.src.html').read()
pcss=per[per.index('/* Persona Builder additions */'):per.index('</style>')]
pbody=per[per.index('<div class="wrap">')+len('<div class="wrap">'):per.index('<div id="toast"')]
pbody=pbody[:pbody.rindex('</div>')]
ptail=per[per.index('<div id="toast"'):per.index('<script>')]
pjs=re.search(r'<script>(.*)</script>',per,re.S).group(1)
pbody=rep(pbody,'<div class="drop" id="drop">','''<p class="eyebrow">Saved ICPs</p>
        <div id="savedlist" class="savedlist"></div>
        <p class="status" id="savednote" style="margin:8px 0 0"></p>
        <p class="eyebrow" style="margin-top:22px">Or Upload an ICP</p>
        <div class="drop" id="drop">''')
pbody=rep(pbody,'Upload the markdown from the ICP Builder, or any ICP document.','Pick a saved ICP, or upload the markdown of any ICP document.')
pre=lambda h: re.sub(r'\b(id|for)="([^"]+)"',r'\1="p-\2"',h)
pbody=pre(pbody); ptail=pre(ptail)
pbody=rep(pbody,'href="#inputs"','href="#persona-inputs"')
pjs=rep(pjs,'const $=id=>document.getElementById(id);','const $=id=>document.getElementById("p-"+id);')
for a in ['id="c-${k}"','for="c-${k}"','id="o-${k}"','for="o-${k}"']:
    pjs=rep(pjs,a,a.replace('="','="p-'))
pjs=pjs.replace('"#view-inputs textarea"','"#p-view-inputs textarea"')
pjs=rep(pjs,'location.hash="inputs";','location.hash="persona-inputs";')
pjs=rep(pjs,'const el=$(a.dataset.h);','const el=document.getElementById(a.dataset.h);')
pjs=rep(pjs,'renderMd(md,"h")','renderMd(md,"ph")'); pjs=rep(pjs,'renderMd(liveText,"l")','renderMd(liveText,"pl")')
pjs=rep(pjs,'const state={docs:[],','const state={savedId:"",docs:[],')
pjs=rep(pjs,'state.docs.push({name,text}); const n=prefill(text); state.example=false;','state.docs.push({name,text}); const n=prefill(text); state.example=false; state.savedId=""; renderSaved();')
pjs=rep(pjs,'Object.assign(state,{docs:[],','Object.assign(state,{savedId:"",docs:[],')
pjs=rep(pjs,'state.docs=[{name:"Example ICP (invented company)",text:EX_ICP}];','state.savedId=""; renderSaved(); state.docs=[{name:"Example ICP (invented company)",text:EX_ICP}];')
pjs=rep(pjs,'/* ---------- Copy, download, toast, Claude ---------- */','''/* ---------- Saved ICPs ---------- */
let delArmed="";
function renderSaved(){
  const L=ICPStore.list(), s=ICPStore.status();
  $("savedlist").innerHTML = L.length ? L.map(x=>`<div class="savedrow"><div><span class="lab">${esc(x.name||x.id)}${state.savedId===x.id?'<span class="tag">in use</span>':""}</span><span class="hint">${esc([x.company,x.savedAt?new Date(x.savedAt).toLocaleDateString():""].filter(Boolean).join(" · "))}</span></div><div class="savedbtns"><button class="btn" type="button" data-use="${esc(x.id)}">Use This ICP</button><button class="btn quiet" type="button" data-del="${esc(x.id)}">${delArmed===x.id?"Click again to delete":"Delete"}</button></div></div>`).join("")
    : `<p class="status" style="margin:0">${s==="loading"?"Loading saved ICPs…":"No saved ICPs yet. Generate an ICP in the ICP Builder, then select Save ICP."}</p>`;
  $("savednote").textContent = s==="shared" ? "Saved ICPs are stored with this page. People you share the page with can see and use them." : s==="local" ? "Saved ICPs are stored in this browser only." : s==="slow" ? "Saved ICPs cannot be reached yet. Still trying." : "";
}
ICPStore.on(renderSaved);
$("savedlist").addEventListener("click",async e=>{
  const u=e.target.closest("[data-use]"), d=e.target.closest("[data-del]");
  if(u){
    const x=ICPStore.list().find(i=>i.id===u.dataset.use); if(!x||!x.markdown) return;
    state.docs=[{name:"Saved ICP: "+(x.name||x.id),text:String(x.markdown)}];
    if(x.inputs) state.docs.push({name:"ICP inputs: "+(x.name||x.id),text:String(x.inputs)});
    let n=0; for(const [k] of CTX){ const v=x.ctx&&typeof x.ctx[k]==="string"?x.ctx[k].trim():""; if(v){ state.ctx[k]=v; state.src[k]=true; n++; } }
    const sameIcp=state.savedId===x.id&&!!state.plan; let reopened="";
    state.savedId=x.id; state.example=false;
    if(!sameIcp){
      const ps=PersonaStore.list().find(p=>p.icpId===x.id), u=ps&&unpackPersonas(ps);
      if(u&&u.plan){ state.plan=u.plan; state.profiles=u.profiles||{}; state.tail=u.tail||""; state.savedPName=ps.name||""; reopened=` The saved personas "${ps.name}" were reopened with it`+(ps.savedAt&&x.savedAt&&ps.savedAt<x.savedAt?"; they were built before this ICP was last saved, so rebuild them if the ICP changed.":"."); }
      else { state.plan=null; state.profiles={}; state.tail=""; state.savedPName=""; }
    }
    renderInputs(); renderSaved(); save();
    const left=CTX.filter(([k])=>!val(k)).map(c=>c[1]);
    note(`Loaded "${x.name||x.id}". ${n} context answer${n===1?" was":"s were"} filled in from it.`+(sameIcp?" Your personas for it were kept.":reopened)+(left.length?` Still needed: ${left.join(", ")}. Type them in, or select Find missing answers in the ICP.`:""), left.length?"warn":"");
  } else if(d){
    const id=d.dataset.del;
    if(delArmed!==id){ delArmed=id; renderSaved(); setTimeout(()=>{ if(delArmed===id){ delArmed=""; renderSaved(); } },4000); return; }
    delArmed="";
    try{ await ICPStore.remove(id); if(state.savedId===id) state.savedId=""; renderSaved(); toast("Saved ICP deleted"); }catch(err){ renderSaved(); toast("Could not delete. You may not have permission on this page."); }
  }
});

/* ---------- Copy, download, toast, Claude ---------- */''')
pjs=rep(pjs,'renderDocs(); updateStats();\n}','renderDocs(); updateStats(); renderSaved();\n}')

# ---------- Shared ----------
css=css.replace('#pastebox',':is(#pastebox,#p-pastebox)').replace('#toast{',':is(#toast,#p-toast){').replace('.bar #st-msg','.bar :is(#st-msg,#p-st-msg)')
css=rep(css,'header.top{margin:20px 0 24px;','header.top{margin:12px 0 24px;')
pcss=pcss.replace('#live','#p-live')
extra='''
.tools{display:flex;flex-wrap:wrap;gap:8px;margin-top:20px}
.tools a{padding:8px 18px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--navy);text-decoration:none}
.tools a:hover{border-color:var(--teal)}
.tools a[aria-current="page"]{background:var(--navy);border-color:var(--navy);color:var(--on-navy)}
input[type="text"]{border:1px solid var(--line);border-radius:10px;background:var(--page);padding:8px 12px;width:100%;color:var(--navy);margin-top:4px}
input[type="text"]:focus{border-color:var(--teal);outline:none;box-shadow:0 0 0 3px var(--mint)}
.savedrow{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;justify-content:space-between;padding:10px 0;border-top:1px solid var(--line)}
.savedrow:first-child{border-top:0;padding-top:4px}
.savedrow .lab{display:block;color:var(--navy)}
.savedrow .hint{display:block;color:var(--muted);font-size:13px}
.savedbtns{display:flex;gap:6px}
.wrap.wide{max-width:none}
.wrap.wide>.tools,#tool-prompts>header,#tool-prompts>.setup,#q-work>section:not(:last-child),#q-work>section:last-child>:not(.pcols):not(.pnav){max-width:1140px;margin-left:auto;margin-right:auto}
.pnav{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:0 0 12px;position:sticky;top:0;z-index:5;background:var(--page);padding:8px 0}
.pnav .btn{padding:5px 10px;font-size:13px}
.pprog{margin-top:10px}
.pbar{height:6px;border-radius:9px;background:var(--calc);overflow:hidden;margin-bottom:6px}
.pbar i{display:block;height:100%;width:0;background:var(--teal);transition:width .4s}
@media (prefers-reduced-motion: reduce){.pbar i{transition:none}}
.pcols{display:flex;gap:16px;overflow-x:auto;align-items:flex-start;padding-bottom:16px;scrollbar-width:auto;scrollbar-color:var(--navy) var(--calc)}
.pcol{flex:1 0 440px;max-width:600px;min-width:0;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px}
.pcol h3{font-size:24px}
.ptarget{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px}
.ptarget input{width:70px;margin:0}
.ptarget b{font-weight:400;font-size:18px;color:var(--navy)}
.ptarget .pill,.mixgrid .pill{font-size:11px;background:var(--orange);color:var(--navy);border-radius:6px;padding:1px 7px}
.ptrim{margin-top:10px;background:var(--card2,#E6EEF0);border-radius:10px;padding:10px 12px}
.ptrim p{margin:0 0 6px;font-size:13px;color:var(--navy)}
.ptrim b{font-weight:400}
.ptrim .actions{margin-top:8px}
.mixtop{display:flex;flex-wrap:wrap;gap:14px;align-items:end;margin-bottom:10px}
.mixtop label{display:flex;flex-direction:column;gap:4px}
.mixtop input{width:110px;margin:0}
.mixgrid input{width:70px;margin:0}
.mixgrid td,.mixgrid th{text-align:left}
.pcount,.sumgrid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:12px}
.pcount b,.sumgrid b{display:block;color:var(--navy);font-size:20px;font-weight:200;font-variant-numeric:tabular-nums}
.pcount div:last-child b{font-size:13px;font-weight:400;padding-top:6px}
.pgrid{width:100%;border-collapse:collapse;font-size:13px;margin-top:14px;border-radius:10px;overflow:hidden}
.pgrid th{background:var(--navy);color:var(--on-navy);text-align:left;padding:6px 8px}
.pgrid td{padding:6px 8px;border-bottom:1px solid var(--line);font-variant-numeric:tabular-nums;color:var(--navy);vertical-align:middle}
.pgrid td .hint{display:block;font-size:11px;color:var(--muted);max-width:150px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pgrid td.under{box-shadow:inset 0 -3px 0 var(--orange)}
.pgrid td.ex{background:var(--calc);color:var(--muted)}
.pgrid input{width:52px;padding:4px 6px;margin:0}
.pact{margin-top:12px}
.pfilters{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:10px}
.pfilters select,.pfilters input{font-size:13px;padding:6px 8px}
.pbulk{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:10px 0}
.pbulk .btn{padding:5px 10px;font-size:13px}
.plist{max-height:640px;overflow-y:auto;border-top:1px solid var(--line)}
.prow{display:grid;grid-template-columns:auto minmax(0,1fr) 100px;gap:8px;padding:10px 2px;border-bottom:1px solid var(--line);align-items:start}
.prow input[type="checkbox"]{margin-top:10px;accent-color:var(--teal)}
.prow textarea{font-size:14px;min-height:0;padding:6px 8px}
.prow select{font-size:12px;padding:6px 4px}
.prow.st-approved select{background:var(--mint);color:var(--mint-ink);border-color:var(--mint)}
.prow.st-rejected textarea{opacity:.55}
.ptags{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
.ptags span{font-size:11px;background:var(--calc);color:var(--navy);border-radius:6px;padding:1px 7px}
.ptags span.pill{background:var(--orange)}
.row.brow{grid-template-columns:repeat(4,minmax(0,1fr)) auto}
.bact{display:flex;align-items:center;gap:6px;padding-top:24px}
.chk2{display:inline-flex;gap:6px;align-items:center;color:var(--navy);font-size:14px;cursor:pointer}
.chk2 input{accent-color:var(--teal)}
.setgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;margin-top:14px}
.setgrid label{display:flex;flex-direction:column}
.sumgrid .hint,.pcount .hint,.setgrid .hint,.ptarget .hint,.phead .hint{color:var(--muted);font-size:12px}
@media (max-width:860px){.row.brow{grid-template-columns:1fr}.bact{padding-top:0}.pcol{flex-basis:88vw}}
.chk{display:inline-flex;gap:8px;align-items:center;color:var(--on-navy-soft);font-size:14px;cursor:pointer;margin-right:8px}
.chk input{accent-color:var(--teal-mid);width:16px;height:16px}
.baract{flex-wrap:wrap}
.otabs{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
.btn[aria-pressed="true"]{background:var(--navy);border-color:var(--navy);color:var(--on-navy)}
.baract{display:flex;gap:8px;align-items:center}
.bar .btn:not(.primary){background:transparent;color:var(--on-navy);border-color:rgba(191,202,217,.45)}
.bar .btn:not(.primary):hover{border-color:var(--on-navy)}
.upbox{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:12px}
.upbox .status{flex:1 1 220px}
'''
store='''"use strict";
/* Shared library of saved ICPs: the page's database when available, this browser otherwise. */
function makeStore(colName,LS){
  let col=null, items=[], status="loading"; const subs=[];
  const emit=()=>subs.forEach(f=>{ try{ f(); }catch(e){} });
  const sort=a=>a.sort((x,y)=>String(y.savedAt||"").localeCompare(String(x.savedAt||"")));
  const toLocal=()=>{ try{ localStorage.setItem(LS,JSON.stringify(items)); }catch(e){} };
  function useLocal(){ col=null; status="local"; try{ items=sort(JSON.parse(localStorage.getItem(LS)||"[]")); }catch(e){ items=[]; } emit(); }
  if(window.claude&&typeof window.claude.use==="function"){
    window.claude.use("db").then(db=>{
      if(!db) return useLocal();
      col=db.collection(colName);
      const t=setTimeout(()=>{ if(status==="loading"){ status="slow"; emit(); } },10000);
      col.onSnapshot(s=>{ if(!s.metadata||!s.metadata.fromCache) clearTimeout(t); items=sort(s.docs.map(d=>Object.assign({},d.data(),{id:d.id}))); status="shared"; emit(); },
                     ()=>{ clearTimeout(t); useLocal(); });
    }).catch(useLocal);
  } else useLocal();
  return { list:()=>items, status:()=>status, on:f=>{ subs.push(f); }, exists:id=>items.some(x=>x.id===id),
    async save(id,obj){ if(col) await col.doc(id).set(obj); else { items=sort([Object.assign({},obj,{id})].concat(items.filter(x=>x.id!==id))); toLocal(); emit(); } },
    async remove(id){ if(col) await col.doc(id).delete(); else { items=items.filter(x=>x.id!==id); toLocal(); emit(); } } };
}
window.ICPStore=makeStore("icps","saved-icps-v1");
window.PersonaStore=makeStore("personas","saved-personas-v1");
/* Saved personas keep plan, profiles and report as one JSON string, so nothing in them can be refused as a field name. */
window.unpackPersonas=x=>{ if(!x) return null; if(x.plan) return {plan:JSON.parse(JSON.stringify(x.plan)),profiles:Object.assign({},x.profiles||{}),tail:x.tail||""}; try{ return JSON.parse(x.pack||"null"); }catch(e){ return null; } };
window.PromptStore=(()=>{
  const base=makeStore("promptsets","saved-promptsets-v1"), LSC="saved-promptcols-v1";
  const dbP=window.claude&&typeof window.claude.use==="function"?window.claude.use("db").catch(()=>null):Promise.resolve(null);
  const lc=()=>{ try{ return JSON.parse(localStorage.getItem(LSC)||"{}"); }catch(e){ return {}; } };
  const sc=m=>{ try{ localStorage.setItem(LSC,JSON.stringify(m)); }catch(e){} };
  const remote=async()=>{ const db=await dbP; return db&&base.status()!=="local"?db:null; };
  return Object.assign({},base,{
    async saveSet(id,meta,cols){ const db=await remote();
      if(db){ for(let i=0;i<cols.length;i++) await db.collection("promptcols").doc(id+"--"+i).set({set:id,i,pack:JSON.stringify(cols[i])}); }
      else { const m=lc(); m[id]=cols; sc(m); }
      await base.save(id,meta); },
    async openSet(id){ const meta=base.list().find(x=>x.id===id); if(!meta) return null; const db=await remote(); let cols=[];
      if(db){ for(let i=0;i<(meta.count||0);i++){ const s=await db.collection("promptcols").doc(id+"--"+i).get(); if(!s.exists) return null; const d=s.data(); cols.push(d.pack?JSON.parse(d.pack):d.col); } }
      else cols=lc()[id]||[];
      return JSON.parse(JSON.stringify({meta,cols})); },
    async removeSet(id){ const meta=base.list().find(x=>x.id===id), db=await remote();
      if(db){ for(let i=0;i<((meta&&meta.count)||0);i++) await db.collection("promptcols").doc(id+"--"+i).delete(); }
      else { const m=lc(); delete m[id]; sc(m); }
      await base.remove(id); }
  });
})();
/* Push to The Night Ventures: writes through the viewer's Supabase connector. */
window.TNV=(()=>{
  const PROJECT="tnwopydrxibqfmeoehid", SERVER="Supabase", el=id=>document.getElementById(id);
  const mcpP = window.claude&&typeof window.claude.use==="function" ? window.claude.use("mcp").catch(()=>null) : Promise.resolve(null);
  function rows(payload){
    const strs=[]; (function walk(x){ if(typeof x==="string") strs.push(x); else if(x&&typeof x==="object") Object.values(x).forEach(walk); })(payload);
    for(let s of strs){
      for(let k=0;k<3;k++){
        const m=s.match(/<untrusted-data-[^>]*>\\s*([\\s\\S]*?)\\s*<\\/untrusted-data-/);
        if(m){ try{ return JSON.parse(m[1]); }catch(e){} }
        try{ const j=JSON.parse(s); if(Array.isArray(j)) return j; if(j&&typeof j.result==="string"){ s=j.result; continue; } }catch(e){}
        break;
      }
    }
    if(Array.isArray(payload)) return payload;
    throw {code:"parse"};
  }
  async function sql(query){
    const mcp=await mcpP; if(!mcp) throw {code:"no_mcp"};
    const r=await mcp.callTool(SERVER,"execute_sql",{project_id:PROJECT,query},{cache:false});
    return rows(r&&r.payload!==undefined?r.payload:r&&r.content);
  }
  const dq=json=>{ let tag; do{ tag="tnv"+Math.random().toString(36).slice(2,10); }while(json.includes("$"+tag+"$")); return "$"+tag+"$"+json+"$"+tag+"$"; };
  async function call(fn,id,p){
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw {code:"bad_id"};
    const r=await sql(`select public.${fn}('${id}'::uuid, ${dq(JSON.stringify(p))}::jsonb) as result`);
    const v=r[0]&&r[0].result; const out=typeof v==="string"?JSON.parse(v):v; if(!out||!out.ok) throw {code:"parse"}; return out;
  }
  function errorText(e){
    const c=e&&e.code, m=String(e&&e.message||"");
    if(c==="no_mcp"||c==="not_granted"||c==="capability_disabled"||c==="capability_removed") return "This view cannot reach your Supabase connection. Open the page in claude.ai and try again.";
    if(c==="server_not_connected"||c==="selection_required") return "Supabase is not connected for you. Add or choose it in claude.ai Settings, Connectors, then push again.";
    if(c==="needs_reauth") return "Your Supabase connection has expired. Reconnect it in claude.ai Settings, Connectors, then push again.";
    if(c==="not_in_manifest"||c==="approval_required"||c==="consent_required"||c==="cancelled") return "The push needs your approval to use Supabase. Select Push again and allow it.";
    if(c==="blocked_by_policy") return "Your organization's settings block this page from using Supabase.";
    if(c==="tool_error") return /tnv_push_\\w+.*does not exist|column .* does not exist/i.test(m) ? "The Night Ventures database has not been prepared for pushes yet. The database change still needs to be applied." : "The database refused the change"+(m?": "+m.slice(0,200):".");
    if(c==="rate_limited") return "Claude is rate limited right now. Wait a minute, then push again.";
    if(c==="no_claude") return "Preparing the personas needs Claude, which is not available in this view.";
    if(c==="parse") return "The push ran but its confirmation could not be read. Check the company in The Night Ventures before pushing again.";
    if(c==="bad_id") return "Choose a company first.";
    if(c==="parse_row") return "Claude's summary of the persona \\""+m+"\\" could not be read. Select Push to try again. Nothing was written.";
    return "Supabase did not answer. The push may or may not have gone through; check the company in The Night Ventures before pushing again.";
  }
  let current=null, busy=false, companies=null;
  function open(opts){
    current=opts; const dlg=el("tnvdlg"), sel=el("tnv-company"), msg=el("tnv-msg"), go=el("tnv-go");
    el("tnv-items").innerHTML=opts.items.map(t=>"<li>"+String(t).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]))+"</li>").join("");
    go.hidden=false; go.disabled=true; el("tnv-cancel").textContent="Cancel"; sel.disabled=false; sel.innerHTML="<option value=\\"\\">Loading companies…</option>"; msg.textContent="";
    dlg.showModal();
    const fill=list=>{ companies=list; const g=String(opts.guess||"").toLowerCase().replace(/\\(.*?\\)/g,"").trim();
      sel.innerHTML="<option value=\\"\\">Choose a company</option>"+list.map(c=>`<option value="${c.id}">${String(c.name).replace(/[&<>"]/g,"")}</option>`).join("");
      const hit=g&&list.find(c=>{ const n=String(c.name).toLowerCase(); return n===g||g.includes(n)||n.includes(g); }); if(hit) sel.value=hit.id; go.disabled=!sel.value; };
    if(companies) fill(companies);
    else sql("select id, name from public.companies order by name").then(l=>{ if(current===opts) fill(l); }).catch(e=>{ if(current===opts){ sel.innerHTML="<option value=\\"\\">Companies could not be loaded</option>"; msg.textContent=errorText(e); } });
  }
  document.addEventListener("DOMContentLoaded",()=>{},{once:true});
  function wire(){
    el("tnv-company").onchange=e=>{ el("tnv-go").disabled=!e.target.value||busy; };
    el("tnv-cancel").onclick=()=>{ if(!busy) el("tnvdlg").close(); };
    el("tnvdlg").addEventListener("cancel",e=>{ if(busy) e.preventDefault(); });
    el("tnv-go").onclick=async()=>{
      const sel=el("tnv-company"), msg=el("tnv-msg"), go=el("tnv-go"); if(!current||busy||!sel.value) return;
      const co=(companies||[]).find(c=>c.id===sel.value); if(!co) return;
      busy=true; go.disabled=true; sel.disabled=true; msg.textContent="Starting…";
      try{ const text=await current.run(co,t=>{ msg.textContent=t; }); msg.textContent=text; go.hidden=true; el("tnv-cancel").textContent="Close"; }
      catch(e){ msg.textContent=errorText(e); go.disabled=false; sel.disabled=false; }
      finally{ busy=false; }
    };
  }
  return { open, wire, errorText, pushIcp:(id,p)=>call("tnv_push_icp",id,p), pushPersonas:(id,p)=>call("tnv_push_personas",id,p), pushPrompts:(id,p)=>call("tnv_push_prompts",id,p),
    brands:id=>{ if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw {code:"bad_id"}; return sql(`select name, is_own, domains, name_patterns, exclude_patterns from public.pt_brands where company_id='${id}'::uuid order by sort, name`); } };
})();
TNV.wire();
function showTool(){
  const h=location.hash, q=h==="#prompts", p=!q&&["#persona-inputs","#personas"].includes(h);
  document.getElementById("tool-icp").hidden=p||q; document.getElementById("tool-persona").hidden=!p; document.getElementById("tool-prompts").hidden=!q;
  const a=document.getElementById("tool-tab-icp"), b=document.getElementById("tool-tab-persona"), c=document.getElementById("tool-tab-prompts");
  a.removeAttribute("aria-current"); b.removeAttribute("aria-current"); c.removeAttribute("aria-current"); (q?c:p?b:a).setAttribute("aria-current","page");
  document.querySelector(".wrap").classList.toggle("wide",q);
}
window.addEventListener("hashchange",showTool); showTool();
'''
head=icp[:icp.index('<style>')].replace('<title>ICP Builder</title>','<title>ICP &amp; Persona Builder</title>')
out=head+'<style>\n'+css+pcss+extra+'</style>\n</head>\n<body>\n<div class="wrap">\n  <nav class="tools" aria-label="Tools">\n    <a href="#inputs" id="tool-tab-icp">ICP Builder</a>\n    <a href="#persona-inputs" id="tool-tab-persona">Persona Builder</a>\n    <a href="#prompts" id="tool-tab-prompts">Prompt Builder</a>\n  </nav>\n  <div id="tool-icp">'+ibody+'</div>\n  <div id="tool-persona" hidden>'+pbody+'</div>\n  <div id="tool-prompts" hidden>'+open(SRC/'prompts.frag.html').read()+'</div>\n</div>\n'+itail+idlg+'\n'+ptail+'<script>\n'+store+'</script>\n<script>\n(function(){'+ijs+'})();\n</script>\n<script>\n(function(){'+pjs+'})();\n</script>\n<script>\n(function(){'+open(SRC/'prompts.js').read()+'})();\n</script>\n</body>\n</html>\n'
out,_k=re.subn(r"  function rows\(payload\)\{.*?\n  \}\n(?=  async function sql)",lambda m:open(SRC/'tnv_rows.js').read(),out,flags=re.S); assert _k==1
def _r(x,y):
    global out
    assert out.count(x)==1,(x[:50],out.count(x)); out=out.replace(x,y)
_r('if(c==="parse") return "The push ran but its confirmation could not be read. Check the company in The Night Ventures before pushing again.";','if(c==="parse") return "The push ran but its confirmation could not be read. Check the company in The Night Ventures before pushing again.";\n    if(c==="parse_list") return "Supabase answered, but the company list came back in a form this page could not read. Nothing was written."+(m?" Reply started: "+m.slice(0,120):"");')
_r('sql("select id, name from public.companies order by name").then(l=>{ if(current===opts) fill(l); }).catch(e=>{','sql("select id, name from public.companies order by name").then(l=>{ if(!l.length||!l[0].id) throw {code:"parse",message:JSON.stringify(l).slice(0,120)}; if(current===opts) fill(l); }).catch(e=>{ if(e&&e.code==="parse") e={code:"parse_list",message:e.message};')
open(OUT,'w').write(out)
ids=re.findall(r'\bid="([^"$]+)"',out); d={i for i in ids if ids.count(i)>1}; print('dup ids',d)
for i,m in enumerate(re.findall(r'<script>\n(.*?)</script>',out,re.S)): open(CHECK/f'j{i}.js','w').write(m)
