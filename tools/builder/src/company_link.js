"use strict";
/* One control for the whole page: the company bar. Each tool's own pickers ("Use This ICP", "Use These Personas",
   the ICP Builder's Saved ICPs list) are hidden, and the company chosen in the bar picks for them:
   - its ICP: the newest saved ICP for that company (by company id once saved with one, else by company name);
   - its personas: the newest saved persona set built from that ICP.
   The Persona Builder, Prompt Builder and Decision Moments then use those, through the tools' own buttons, so every rule
   in those tools still applies. Work that belongs to the same company is never replaced. Prompts on the page that belong to
   another company are not replaced without a click, because the Prompt Builder keeps unsaved work only in this browser. */
(function(){
  const el=id=>document.getElementById(id);
  const esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  const norm=s=>String(s||"").toLowerCase().replace(/\(.*?\)/g," ").replace(/[^a-z0-9]+/g," ").trim();
  const ls=k=>{ try{ return JSON.parse(localStorage.getItem(k)||"null"); }catch(e){ return null; } };
  const byDate=(a,b)=>String(b.savedAt||"").localeCompare(String(a.savedAt||""));
  function sameCo(item,co){
    if(!item||!co) return false;
    if(item.companyId) return item.companyId===co.id;
    const a=norm(item.company), b=norm(co.name); if(!a||!b) return false;
    return a===b||a.startsWith(b+" ")||b.startsWith(a+" ");
  }
  function resolve(co){
    if(!co) return {co:null,icp:null,ps:null};
    const icp=ICPStore.list().filter(x=>sameCo(x,co)).sort(byDate)[0]||null;
    const ps=icp?PersonaStore.list().filter(p=>p.icpId===icp.id).sort(byDate)[0]||null:null;
    return {co,icp,ps};
  }

  /* Hide the pickers; each tool gets one line saying what it uses. */
  const css=document.createElement("style");
  css.textContent=`#icpsaved,#p-icpbox,#q-sources,#q-srcpick,#d-sources,#d-srcpick{display:none!important}
.colink{margin:0;padding:10px 14px;border-radius:10px;background:var(--mint);color:var(--mint-ink);font-size:14px}
.colink.warn{background:var(--card);color:var(--navy);border:1px solid var(--orange);border-left-width:4px}
.colink .btn{margin-left:8px;padding:4px 10px;font-size:13px}`;
  document.head.appendChild(css);
  function line(id,after){ let p=el(id); if(!p){ p=document.createElement("p"); p.id=id; p.className="colink"; p.setAttribute("role","status"); after.insertAdjacentElement("afterend",p); } return p; }
  const pIcp=el("p-icpbox"), qSrc=el("q-sources"), dSrc=el("d-sources");
  if(qSrc){ const sub=qSrc.previousElementSibling; if(sub&&sub.classList.contains("sub")) sub.id="q-srcpick"; const h=qSrc.parentElement.querySelector("h2"); if(h) h.textContent="Source"; }
  if(dSrc){ const sub=dSrc.previousElementSibling; if(sub&&sub.classList.contains("sub")) sub.id="d-srcpick"; const h=dSrc.parentElement.querySelector("h2"); if(h) h.textContent="Source"; }
  const L={p:pIcp&&line("lnk-p",pIcp), q:qSrc&&line("lnk-q",qSrc), d:dSrc&&line("lnk-d",dSrc)};
  function say(p,html,warn){ if(!p) return; p.innerHTML=html; p.classList.toggle("warn",!!warn); }

  function missing(r){
    if(!r.co) return "Choose the company at the top of the page.";
    if(!r.icp) return `No saved ICP for ${esc(r.co.name)} yet. Generate it in the ICP Builder; it is saved automatically.`;
    return "";
  }
  const icpText=r=>`ICP "${esc(r.icp.name||r.icp.id)}"${r.icp.savedAt?" (saved "+esc(new Date(r.icp.savedAt).toLocaleDateString())+")":""}`;
  const psText=r=>r.ps?`personas "${esc(r.ps.name||r.ps.id)}"`:"";
  const noPs=r=>`No saved personas built from ${icpText(r)} yet. Build them in the Persona Builder; they are saved automatically.`;

  let forced=false;
  function apply(){
    const r=resolve(window.Company&&Company.get());
    const m=missing(r);
    /* Persona Builder: use the company's ICP. Its own button reopens the personas saved for it. */
    if(L.p){
      const st=ls("persona-builder-v1")||{}, building=el("p-btn-stop")&&!el("p-btn-stop").hidden;
      if(m) say(L.p,m,true);
      else if(st.savedId===r.icp.id) say(L.p,`${esc(r.co.name)}: ${icpText(r)}.`);
      else if(building) say(L.p,`${esc(r.co.name)}: ${icpText(r)} is used once the current build ends.`,true);
      else { const b=document.querySelector(`#p-savedlist [data-use="${CSS.escape(r.icp.id)}"]`); if(b){ b.click(); say(L.p,`${esc(r.co.name)}: ${icpText(r)}.`); } }
    }
    /* Prompt Builder: the company's personas; its saved prompt set for them if there is one. */
    if(L.q){
      const S=ls("prompt-builder-v1")||{}, src=S.src, has=src&&(S.cols||[]).some(c=>(c.prompts||[]).length);
      if(m) say(L.q,m,true);
      else if(!r.ps) say(L.q,noPs(r),true);
      else if(src&&src.personasId===r.ps.id) say(L.q,`${esc(r.co.name)}: ${psText(r)}, from ${icpText(r)}.`);
      else if(src&&has&&!forced&&ICPStore.list().some(x=>x.id===src.icpId&&sameCo(x,r.co))) say(L.q,`${esc(r.co.name)}: working on ${esc(src.personasName||"earlier personas")}. Newer personas exist: ${psText(r)}. <button class="btn" type="button" data-lnk="switch">Switch to them</button>`,true);
      else if(src&&has&&!forced) say(L.q,`The prompts on this page belong to ${esc(src.company||"another company")}. Save them with Save Prompts if you want to keep them, then <button class="btn" type="button" data-lnk="switch">Switch to ${esc(r.co.name)}</button>`,true);
      else {
        forced=false;
        const set=(window.PromptStore?PromptStore.list():[]).filter(x=>x.personasId===r.ps.id).sort(byDate)[0];
        const b=set?document.querySelector(`#q-sets [data-open="${CSS.escape(set.id)}"]`):document.querySelector(`#q-sources [data-src="${CSS.escape(r.ps.id)}"]`);
        if(b){ b.click(); if(!set&&has){ const again=document.querySelector(`#q-sources [data-src="${CSS.escape(r.ps.id)}"]`); if(again) again.click(); } }
        say(L.q,`${esc(r.co.name)}: ${psText(r)}, from ${icpText(r)}${set?`; opened the saved prompt set "${esc(set.name)}"`:""}.`);
      }
    }
    /* Decision Moments: the company's personas. */
    if(L.d){
      const st=ls("moment-builder-v1")||{};
      if(m) say(L.d,m,true);
      else if(!r.ps) say(L.d,noPs(r),true);
      else { if(st.srcId!==r.ps.id){ const b=document.querySelector(`#d-sources [data-dsrc="${CSS.escape(r.ps.id)}"]`); if(b) b.click(); }
        say(L.d,`${esc(r.co.name)}: ${psText(r)}, from ${icpText(r)}.`); }
    }
  }
  document.addEventListener("click",e=>{ if(e.target&&e.target.closest&&e.target.closest("[data-lnk=switch]")){ forced=true; apply(); } });
  let t=0; const later=()=>{ clearTimeout(t); t=setTimeout(apply,150); };
  if(window.Company) Company.on(later);
  ICPStore.on(later); PersonaStore.on(later); if(window.PromptStore) PromptStore.on(later);
  window.addEventListener("hashchange",later);
  later();
  window.CompanyLink={apply,resolve,sameCo};
})();
