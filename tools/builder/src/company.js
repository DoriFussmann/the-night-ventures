/* The company the whole page works on. Chosen once, in the bar at the top. Every push goes to it,
   and the ICP Builder loads its Company and Brand Facts from The Night Ventures. */
window.Company=(()=>{
  const KEY="tnv-company-v1", el=id=>document.getElementById(id), subs=[]; let cur=null, list=null;
  try{ const v=JSON.parse(localStorage.getItem(KEY)||"null"); if(v&&v.id&&v.name) cur={id:v.id,name:v.name}; }catch(e){}
  const esc=t=>String(t).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  function note(){ el("co-msg").textContent=cur?"Every push goes to "+cur.name+".":"Choose the company to work on. Every push goes to it."; }
  function set(id){
    const was=cur&&cur.id, c=(list||[]).find(x=>x.id===id)||null; cur=c?{id:c.id,name:c.name}:null;
    try{ if(cur) localStorage.setItem(KEY,JSON.stringify(cur)); else localStorage.removeItem(KEY); }catch(e){}
    note(); if((cur&&cur.id)!==was) subs.forEach(f=>{ try{ f(cur); }catch(e){} });
  }
  function start(){
    const sel=el("co-pick"); sel.disabled=true; sel.onchange=e=>set(e.target.value);
    TNV.sql("select id, name from public.companies order by name").then(l=>{
      if(!Array.isArray(l)||(l.length&&!l[0].id)) throw {code:"parse_list",message:JSON.stringify(l).slice(0,120)};
      list=l; if(cur&&!l.some(c=>c.id===cur.id)){ cur=null; try{ localStorage.removeItem(KEY); }catch(e){} subs.forEach(f=>{ try{ f(null); }catch(e){} }); }
      sel.innerHTML='<option value="">Choose a company</option>'+l.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
      sel.value=cur?cur.id:""; sel.disabled=false; note();
    }).catch(e=>{ sel.innerHTML='<option value="">Companies could not be loaded</option>'; el("co-msg").textContent=TNV.errorText(e).replace(/,? then push again\./," then reload the page."); });
  }
  return { get:()=>cur, on:f=>subs.push(f), start };
})();
Company.start();
