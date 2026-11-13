"use strict";
/* Decision Moments: one base persona, in one buyer situation, at the moment they are ready to act.
   Step A matches the user's description to a persona and situation; Step B writes and refines one seed prompt;
   Step C writes 10 recommendation prompts from it (two per angle) and checks them; Step D pushes to The Night Ventures
   (tnv_push_moment, migration 083). Reads the ICP and personas with the Prompt Builder's parsers (window.PromptParse). */
const $=id=>document.getElementById("d-"+id);
const esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const STORE="moment-builder-v1";
const ANGLES=[
  ["Direct ask","asks straight out who can do this for them"],
  ["Service category","asks whether a kind of service or tool exists that does it"],
  ["Named comparison","weighs one or two named competitors against each other or against doing it themselves"],
  ["Hire or do it myself","asks whether to pay someone or do it themselves, and who to pay if so"],
  ["Constraint-led","leads with their hard constraint (budget, time, fee model, risk) and asks what fits it"]];
const MIN_W=12, MAX_W=80, SET_N=10;
let M={srcId:"",cur:null};
const UI={busy:false,brands:null,brandsFor:"",existing:null,existingFor:"",moments:null,armed:""};
const blank=()=>({code:"",title:"",text:"",pi:-1,sid:"",reason:"",seed:"",path:"",fb:"",versions:[],seedFinal:false,prompts:[],setFb:"",setFinal:false,pushedAt:"",companyId:""});
function save(){ try{ localStorage.setItem(STORE,JSON.stringify(M)); }catch(e){} }
function load(){ try{ const s=JSON.parse(localStorage.getItem(STORE)||"null"); if(s&&typeof s==="object") M=Object.assign(M,s); }catch(e){} }

let toastT;
function toast(m){ const t=document.getElementById("toast"); t.textContent=m; t.hidden=false; clearTimeout(toastT); toastT=setTimeout(()=>t.hidden=true,2600); }
let sampleP=Promise.resolve(null);
if(window.claude&&typeof window.claude.use==="function") sampleP=window.claude.use("sample").catch(()=>null);
async function ask(prompt,tier){
  const sample=await sampleP; if(!sample) throw {code:"no_claude"};
  let out="", input=prompt;
  for(let k=0;k<3;k++){ const r=await sample(input,{modelTier:tier,cache:false}); out+=(r.text||""); if(!r.truncated) break;
    input=[{role:"user",content:prompt},{role:"assistant",content:out},{role:"user",content:"Continue exactly where you stopped. Do not repeat anything."}]; }
  return out;
}
const pjson=(t,open,close)=>{ t=String(t||""); const a=t.indexOf(open), b=t.lastIndexOf(close); if(a<0||b<=a) throw {code:"parse"}; return JSON.parse(t.slice(a,b+1)); };
const words=t=>String(t||"").trim().split(/\s+/).filter(Boolean).length;
const hasTerm=(text,term)=>new RegExp("(^|[^a-z0-9])"+String(term).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"($|[^a-z0-9])","i").test(text);
function errText(e){
  const c=e&&e.code;
  if(c==="no_claude") return "Claude is not available in this view. Open the page in claude.ai.";
  if(c==="rate_limited") return "Claude is rate limited. Wait a minute, then try again.";
  if(c==="not_granted") return "This needs permission to ask Claude. Select the button again and allow it.";
  if(c==="parse") return "Claude's reply could not be read. Select the button again.";
  return "Something went wrong"+(e&&e.message?": "+String(e.message).slice(0,160):"")+". Select the button again.";
}

/* ---------- Source: a saved persona set and its ICP ---------- */
function source(){
  const P=window.PromptParse; if(!P||!M.srcId) return null;
  const set=PersonaStore.list().find(x=>x.id===M.srcId), packed=unpackPersonas(set);
  if(!set||!packed||!packed.plan||!Array.isArray(packed.plan.personas)) return null;
  const icp=ICPStore.list().find(x=>x.id===set.icpId); if(!icp||!icp.markdown) return null;
  const parsed=P.parseIcp(icp.markdown);
  const personas=packed.plan.personas.map((p,i)=>P.parsePersona(p,(packed.profiles||{})[i]||""));
  const company=(icp.company||set.company||"").replace(/\(.*?\)/g,"").trim();
  return {set,icp,parsed,personas,company,offer:icpSection(icp.markdown,/problem|reasons to buy/i,1800)};
}
function icpSection(md,re,cap){ const L=String(md||"").split(/\r?\n/); const i=L.findIndex(l=>/^#{2,3}\s/.test(l)&&re.test(l)); if(i<0) return "";
  const out=[]; for(let j=i+1;j<L.length;j++){ if(/^#{2,3}\s/.test(L[j])) break; out.push(L[j]); } return out.join("\n").trim().slice(0,cap); }

/* ---------- The Night Ventures: brands, existing prompts, moments ---------- */
const coId=()=>{ const c=window.Company&&Company.get(); return c?c.id:""; };
const uuidOk=id=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id||"");
async function brands(){ const id=coId(); if(!uuidOk(id)) return [];
  if(UI.brandsFor===id&&UI.brands) return UI.brands;
  try{ UI.brands=await TNV.brands(id); UI.brandsFor=id; }catch(e){ UI.brands=null; return []; }
  return UI.brands; }
function ownNames(src){ const b=(UI.brands||[]).filter(x=>x.is_own), out=new Set();
  for(const x of b){ out.add(x.name); for(const p of (x.name_patterns||[])) out.add(p); }
  if(!out.size&&src&&src.company) out.add(src.company);
  return [...out].map(x=>String(x||"").trim()).filter(x=>x.length>1); }
function competitors(src){ const own=ownNames(src).map(x=>x.toLowerCase());
  const fromTnv=(UI.brands||[]).filter(x=>!x.is_own).map(x=>x.name);
  const fromIcp=src?[...new Set(src.parsed.alternatives.flatMap(a=>a.names))]:[];
  return [...new Set((fromTnv.length?fromTnv:fromIcp).filter(n=>n&&!own.includes(String(n).toLowerCase())))]; }
async function existing(){ const id=coId(); if(!uuidOk(id)) return [];
  if(UI.existingFor===id&&UI.existing) return UI.existing;
  try{ UI.existing=await TNV.sql(`select code, prompt from public.pt_prompts where company_id='${id}'::uuid and status='Approved' order by code limit 600`); UI.existingFor=id; }catch(e){ UI.existing=null; return []; }
  return UI.existing; }
async function loadMoments(){
  const id=coId(), msg=$("listmsg");
  if(!uuidOk(id)){ UI.moments=null; msg.textContent="Choose the company at the top of the page to see its moments."; renderList(); return; }
  msg.textContent="Loading…";
  try{ UI.moments=await TNV.sql(`select m.id, m.code, m.title, m.status, m.updated_at, (select count(*) from public.pt_prompts p where p.moment_id=m.id) as n from public.pt_moments m where m.company_id='${id}'::uuid order by m.created_at`); msg.textContent=UI.moments.length?"":"No moments pushed for this company yet."; }
  catch(e){ UI.moments=null; msg.textContent=TNV.errorText(e).replace(/,? then push again\./,"."); }
  renderList();
}
async function openMoment(mid){
  const id=coId(); if(!uuidOk(id)||!uuidOk(mid)) return;
  const [m]=await TNV.sql(`select * from public.pt_moments where id='${mid}'::uuid and company_id='${id}'::uuid`);
  if(!m){ toast("That moment could not be read"); return; }
  const ps=await TNV.sql(`select code, prompt, variables, named_brands from public.pt_prompts where moment_id='${mid}'::uuid order by code`);
  const src=source(); let pi=-1;
  const bm=String(m.persona_code||"").match(/^B(\d+)$/); if(bm) pi=Number(bm[1])-1;
  if(!src||pi<0||pi>=src.personas.length) pi=-1;
  M.cur=Object.assign(blank(),{code:m.code,title:m.title||"",text:m.moment_text||"",pi,sid:m.situation_id||"",reason:m.match_reason||"",seed:m.seed_prompt||"",path:m.path_note||"",
    versions:Array.isArray(m.seed_versions)?m.seed_versions:[],seedFinal:!!m.seed_prompt,setFinal:ps.length>0,companyId:id,pushedAt:m.updated_at||"",
    prompts:ps.map((p,i)=>({n:i+1,angle:((p.variables||[]).find(v=>v.k==="Angle")||{}).v||"",text:p.prompt,named:p.named_brands||[],issue:""}))});
  save(); render(); toast("Opened "+m.code+(pi<0?". Pick its base persona again in Step A":""));
}

/* ---------- Requests to Claude ---------- */
function personaBlock(src,pi){ const p=src.personas[pi];
  return `${p.name}${p.role?" ("+p.role+")":""}${p.slim?". Influences the decision but does not buy or use the product.":""}
${String(p.context||"").slice(0,2200)}
Their words: ${p.buyer.join("; ")||"plain everyday language"}
Words they never use (the seller's jargon): ${p.ours.join("; ")||"none listed"}
Objections they raise: ${p.objections.join("; ")||"none listed"}`; }
function sitLine(src,sid){ const s=src.parsed.situations.find(x=>x.id===sid); return s?`${s.id}: ${s.name}. Trigger moment: ${s.trigger} Already tried: ${s.tried} Deciding between: ${s.deciding}`:"none chosen"; }
const REC_RULE=`A recommendation prompt: the person wants something done and asks the AI who or what to use. A good answer to it is a choice between named providers, services or tools, not an explanation of a topic.`;
function matchPrompt(src,text){
  return `A user describes a person at a moment of need. Match it to the closest existing buyer persona and buyer situation.

MOMENT
${text}

BUYER SITUATIONS (from the ICP)
${src.parsed.situations.map(s=>sitLine(src,s.id)).join("\n")}

PERSONAS
${src.personas.map((p,i)=>`P${i+1}. ${p.name}${p.role?" ("+p.role+")":""}. Situations: ${p.situations.join(", ")||"none"}. ${String(p.context||"").replace(/\s+/g," ").slice(0,600)}`).join("\n")}

Pick the persona this person is, and the situation they are in. Prefer a situation that persona is linked to. If nothing fits well, still pick the closest, set "fit" to false and say in "missing" what the ICP or personas lack.
Return JSON only, no code fence: {"persona": <persona number>, "situation": "S1", "fit": true or false, "reason": "<one sentence, at most 30 words>", "missing": "<if fit is false, at most 25 words>", "title": "<a short title for the moment, at most 8 words>"}`;
}
function seedPrompt(src,c,feedback){
  const prev=c.seed?`\nPREVIOUS VERSION\nPrompt: ${c.seed}\nPath to us: ${c.path}\n`:"";
  return `You write the one prompt a specific person would type into an AI assistant such as ChatGPT at a specific moment, and a short note on how its answer should lead to the seller.

SELLER
${src.company||"The seller"}. What they solve and why customers buy:
${src.offer||"(see the ICP customer line) "+src.parsed.customer}

PERSON
${personaBlock(src,c.pi)}

SITUATION
${sitLine(src,c.sid)}

THE MOMENT, IN THE USER'S WORDS
${c.text}

COMPETITORS THAT COULD BE NAMED IN THE ANSWER
${competitors(src).join(", ")||"none listed"}
${prev}${feedback?`\nUSER FEEDBACK ON THE PREVIOUS VERSION (apply it)\n${feedback}\n`:""}
RULES FOR THE PROMPT
1. ${REC_RULE}
2. First person, natural, the way this person would type it. One ask.
3. It carries the moment's context that changes which provider the AI would pick (their position, constraints, what just happened), said the way the person would say it. No label such as "As a ...".
4. From the prompt alone it is clear what kind of person is asking and in which market.
5. Never name the seller or anything in "Never mention". Competitors may be named only if this person would plausibly name them; usually they do not.
6. Between ${MIN_W} and ${MAX_W} words.
Never mention: ${ownNames(src).join("; ")||"none"}

THE NOTE ("path")
- need: what the person needs done, in a few words
- category: the kind of provider or service that does it
- why_us: why the seller's offer fits this person at this moment, from the seller description only; no invented claims
- competitors: which of the competitors above would most likely compete for the answer

Return JSON only, no code fence: {"prompt": "...", "path": {"need": "...", "category": "...", "why_us": "...", "competitors": ["..."]}}`;
}
function pathText(p){ if(!p||typeof p!=="object") return String(p||""); return `Need: ${p.need||""}\nCategory: ${p.category||""}\nWhy us: ${p.why_us||""}\nCompeting for the answer: ${(p.competitors||[]).join(", ")||"none named"}`; }
function setPrompt(src,c,only,note){
  const others=c.prompts.filter(p=>!only||p.n!==only.n);
  const slots=only?[{n:only.n,angle:only.angle}]:Array.from({length:SET_N},(_,i)=>({n:i+1,angle:ANGLES[Math.floor(i/2)][0]}));
  return `You write prompts a specific person would type into an AI assistant such as ChatGPT. All of them come from one moment and all of them are recommendation prompts.

PERSON
${personaBlock(src,c.pi)}

SITUATION
${sitLine(src,c.sid)}

THE MOMENT
${c.text}

SEED PROMPT (agreed with the user; the others keep its person, its moment and its voice)
${c.seed}

WHERE THE ANSWER SHOULD LEAD
${c.path}

COMPETITORS THEY MAY NAME
${competitors(src).join(", ")||"none listed"}
${only?`\nTHE OTHER PROMPTS IN THE SET (do not repeat or rephrase them)\n${others.map(p=>"- "+p.text).join("\n")}\n`:""}${note?`\nUSER FEEDBACK (apply it)\n${note}\n`:""}
ANGLES
${ANGLES.map(([a,d])=>`- ${a}: ${d}`).join("\n")}

WRITE EXACTLY THESE
${slots.map(s=>`${s.n}. angle: ${s.angle}`).join("\n")}

RULES
1. ${REC_RULE} Every prompt.
2. Same person, same moment, same context as the seed. Say the context the way the person would, and vary how it is said; no fixed opening and no label such as "As a ...".
3. Each prompt must stand on its own: an AI that sees only that prompt can tell who is asking and in which market.
4. Vary length and amount of context across the set, between ${MIN_W} and ${MAX_W} words.
5. Never name the seller or anything in "Never mention". The Named comparison angle names one or two competitors from the list, exactly as written there; other angles name none.
6. No two prompts ask the same thing in different words.
Never mention: ${ownNames(src).join("; ")||"none"}

Return JSON only, no code fence: a list with one object per line above: {"n": number, "angle": "...", "prompt": "...", "named_brands": ["..."]}`;
}
function judgePrompt(src,c,ex){
  return `Check a set of NEW prompts written for one person at one moment. EXISTING prompts are already tested for the same company.

THE MOMENT
${c.text}

SEED PROMPT
${c.seed}

For each NEW prompt decide:
- "dup": does it ask the same thing as an EXISTING prompt or an earlier NEW prompt, even reworded? Give "E<number>" or "N<number>", else null. The same need with a different angle, constraint or named option is not a duplicate.
- "rec": is it a recommendation prompt? ${REC_RULE}
- "same": does it come from the same person in the same moment as the seed?
- "why": if dup, rec false or same false, at most 14 words on what is wrong.

Return JSON only, no code fence: [{"n": <new number>, "dup": null, "rec": true, "same": true, "why": ""}] with one object per NEW prompt.

EXISTING
${ex.map((e,i)=>`E${i+1}. ${e.prompt}`).join("\n")||"none"}

NEW
${c.prompts.map(p=>`N${p.n}. ${p.text}`).join("\n")}`;
}
function localIssue(src,p){
  const out=[], w=words(p.text);
  if(w<MIN_W||w>MAX_W) out.push(`${w} words (allowed ${MIN_W} to ${MAX_W})`);
  for(const o of ownNames(src)) if(hasTerm(p.text,o)){ out.push("names your own brand"); break; }
  return out;
}

/* ---------- Actions ---------- */
function busy(b,msgEl,text){ UI.busy=b; document.querySelectorAll("#tool-moments button").forEach(x=>{ x.disabled=b; }); if(msgEl&&text!=null) msgEl.textContent=text; if(!b) render(); }
async function doMatch(){
  const src=source(), c=M.cur, msg=$("amsg"); if(!src){ msg.textContent="Pick the base personas first."; return; }
  c.text=$("text").value.trim(); if(words(c.text)<6){ msg.textContent="Describe the moment in a sentence or two first."; return; }
  busy(true,msg,"Matching to a persona and situation…");
  try{ const j=pjson(await ask(matchPrompt(src,c.text),"default"),"{","}");
    const pi=Number(j.persona)-1; c.pi=pi>=0&&pi<src.personas.length?pi:0;
    const sid=String(j.situation||"").toUpperCase(); c.sid=src.parsed.situations.some(s=>s.id===sid)?sid:(src.personas[c.pi].situations[0]||"");
    c.reason=String(j.reason||"").trim()+(j.fit===false?` Weak fit: ${String(j.missing||"").trim()}`:""); if(!c.title) c.title=String(j.title||"").trim().slice(0,90);
    msg.textContent=j.fit===false?"No persona fits well. The closest is chosen; check it, or the ICP may need this case.":"Matched. Change the persona or situation if it is wrong.";
    save(); render(); }
  catch(e){ msg.textContent=errText(e); }
  finally{ busy(false); }
}
async function doSeed(withFb){
  const src=source(), c=M.cur, msg=$("bmsg"); if(!src||c.pi<0||!c.sid){ msg.textContent="Finish Step A first."; return; }
  const fb=withFb?$("fb").value.trim():""; if(withFb&&!fb){ msg.textContent="Write your feedback first."; return; }
  c.seed=$("seed")?$("seed").value.trim()||c.seed:c.seed; c.path=$("path")?$("path").value.trim()||c.path:c.path;
  busy(true,msg,withFb?"Rewriting with your feedback…":"Writing the seed prompt…");
  try{ await brands();
    const j=pjson(await ask(seedPrompt(src,c,fb),"complex"),"{","}"); const p=String(j.prompt||"").replace(/\s+/g," ").trim(); if(!p) throw {code:"parse"};
    if(c.seed) c.versions.push({prompt:c.seed,path_note:c.path,feedback:fb,at:new Date().toISOString()});
    c.seed=p; c.path=pathText(j.path); c.fb=""; const iss=localIssue(src,{text:p});
    msg.textContent=iss.length?`Check: ${iss.join("; ")}.`:"Read it as the person. Rewrite with feedback until it is right, then finalize it.";
    save(); render(); }
  catch(e){ msg.textContent=errText(e); }
  finally{ busy(false); }
}
async function doSet(only,note){
  const src=source(), c=M.cur, msg=$("cmsg"); if(!src||!c.seedFinal){ msg.textContent="Finalize the seed prompt first."; return; }
  busy(true,msg,only?`Rewriting prompt ${only.n}…`:note?"Rewriting the set with your feedback…":"Writing 10 prompts…");
  try{ await brands();
    const list=pjson(await ask(setPrompt(src,c,only,note),"complex"),"[","]");
    const comp=competitors(src).map(x=>x.toLowerCase());
    const rows=list.map(r=>({n:Number(r.n),angle:String(r.angle||"").trim(),text:String(r.prompt||"").replace(/\s+/g," ").trim(),named:(Array.isArray(r.named_brands)?r.named_brands:[]).map(String).filter(x=>comp.includes(x.toLowerCase())),issue:""})).filter(r=>r.text&&r.n>=1&&r.n<=SET_N);
    if(only){ const r=rows.find(x=>x.n===only.n)||rows[0]; if(!r) throw {code:"parse"}; Object.assign(only,{text:r.text,named:r.named,issue:""}); }
    else { if(rows.length<SET_N) throw {code:"parse"}; c.prompts=rows.slice(0,SET_N).sort((a,b)=>a.n-b.n); c.setFb=""; }
    save(); render(); await doCheck(true); }
  catch(e){ msg.textContent=errText(e); busy(false); }
}
async function doCheck(inline){
  const src=source(), c=M.cur, msg=$("cmsg"); if(!src||!c.prompts.length) return;
  syncRows(); busy(true,msg,"Checking for duplicates and for recommendation prompts…");
  try{ const ex=(await existing()).filter(e=>!(c.code&&String(e.code).startsWith(c.code+"-")));
    const v=pjson(await ask(judgePrompt(src,c,ex),"default"),"[","]"), by={}; for(const x of v) if(x&&x.n!=null) by[Number(x.n)]=x;
    let bad=0;
    for(const p of c.prompts){ const iss=localIssue(src,p), j=by[p.n];
      if(j){ if(j.dup){ const m=String(j.dup).match(/^([EN])(\d+)$/i); iss.push(m&&m[1].toUpperCase()==="E"&&ex[Number(m[2])-1]?`duplicate of ${ex[Number(m[2])-1].code}`:"duplicate of "+j.dup); }
        if(j.rec===false) iss.push("not a recommendation prompt"); if(j.same===false) iss.push("drifts from the moment"); if((j.dup||j.rec===false||j.same===false)&&j.why) iss.push(String(j.why).slice(0,120)); }
      else iss.push("not checked");
      p.issue=iss.join("; "); if(p.issue) bad++; }
    msg.textContent=bad?`${bad} of ${c.prompts.length} need a look. Edit them, or rewrite one with a note.`:`All ${c.prompts.length} pass. Read them as the person, then finalize the set.`;
    save(); render(); }
  catch(e){ msg.textContent=errText(e); }
  finally{ busy(false); }
}
function syncRows(){ const c=M.cur; if(!c) return; document.querySelectorAll("[data-ptext]").forEach(t=>{ const p=c.prompts.find(x=>x.n===Number(t.dataset.ptext)); if(p&&p.text!==t.value.trim()){ p.text=t.value.replace(/\s+/g," ").trim(); p.issue="edited; check again"; } }); }
function doPush(){
  const src=source(), c=M.cur; if(!src||!c||!c.setFinal) return;
  const co=window.Company&&Company.get();
  if(c.code&&c.companyId&&co&&c.companyId!==co.id){ $("dmsg").textContent="This moment belongs to another company. Choose that company at the top, or start a new moment."; return; }
  TNV.open({
    items:[`The moment ${c.code||"(a new DM code)"} "${c.title||"untitled"}": your description, persona ${c.pi>=0?"B"+(c.pi+1)+" ("+src.personas[c.pi].name+")":"?"}, situation ${c.sid}, the seed prompt, its path note and ${c.versions.length} earlier version${c.versions.length===1?"":"s"}.`,
      `${c.prompts.length} prompts as Approved, codes ${c.code||"DM…"}-01 to -${String(c.prompts.length).padStart(2,"0")}, type Recommendation, linked to the moment. A prompt whose wording changed loses its earlier test results.`,
      "Tracked brands and all other prompts are not touched. The database refuses any prompt that names your own brand.",
      "Persona codes B1, B2 … follow the order of the personas pushed from the Persona Builder."],
    run: async (co2,status)=>{
      let code=c.code;
      if(!code){ status("Choosing the next moment code…"); const r=await TNV.sql(`select coalesce(max(substring(code from 3)::int),0)+1 as n from public.pt_moments where company_id='${co2.id}'::uuid and code ~ '^DM[0-9]+$'`); code="DM"+Number(r[0]&&r[0].n||1); }
      status("Writing to The Night Ventures…");
      const res=await TNV.pushMoment(co2.id,{moment:{code,title:c.title,moment_text:c.text,persona_code:c.pi>=0?"B"+(c.pi+1):"",situation_id:c.sid,match_reason:c.reason,seed_prompt:c.seed,path_note:c.path,seed_versions:c.versions,runs:10,status:"final"},
        prompts:c.prompts.map((p,i)=>({id:`${code}-${String(i+1).padStart(2,"0")}`,prompt:p.text,angle:p.angle,named_brands:p.named,status:"Approved"}))});
      c.code=code; c.companyId=co2.id; c.pushedAt=new Date().toISOString(); UI.existing=null; save(); render(); loadMoments();
      $("dmsg").textContent=`Pushed ${code}. Next: The Night Ventures › Prompt Tests, select the ${code} prompts and run them.`;
      return `Pushed to ${co2.name}: moment ${code} with ${res.prompts} prompts.`;
    }
  });
}

/* ---------- Rendering ---------- */
function renderSources(){
  const L=PersonaStore.list();
  $("sources").innerHTML=L.length?L.map(x=>`<div class="savedrow"><div><span class="lab">${esc(x.name||x.id)}${M.srcId===x.id?'<span class="tag">in use</span>':""}</span><span class="hint">${esc([x.count?x.count+" persona"+(x.count===1?"":"s"):"",x.icpName?"from "+x.icpName:x.company].filter(Boolean).join(" · "))}</span></div><div class="savedbtns"><button class="btn" type="button" data-dsrc="${esc(x.id)}">${M.srcId===x.id?"In use":"Use These Personas"}</button></div></div>`).join("")
    :'<p class="status" style="margin:0">No saved personas yet. Build them in the Persona Builder and save them.</p>';
}
function renderList(){
  const L=UI.moments||[];
  $("list").innerHTML=L.map(m=>`<div class="savedrow"><div><span class="lab">${esc(m.code)} · ${esc(m.title||"untitled")}${M.cur&&M.cur.code===m.code&&M.cur.companyId===coId()?'<span class="tag">open</span>':""}</span><span class="hint">${esc(m.n+" prompts · "+m.status)}</span></div><div class="savedbtns"><button class="btn" type="button" data-dopen="${esc(m.id)}">${UI.armed===m.id?"Click again to replace your draft":"Open"}</button></div></div>`).join("");
}
function render(){
  renderSources(); renderList();
  const src=source(), c=M.cur;
  $("work").hidden=!src||!c; if(!src||!c) return;
  if(document.activeElement!==$("text")) $("text").value=c.text;
  $("code").hidden=!c.code; $("code").textContent=c.code;
  const matched=c.pi>=0&&!!c.sid;
  $("matchbox").hidden=!matched;
  if(matched){
    $("title").value=c.title;
    $("persona").innerHTML=src.personas.map((p,i)=>`<option value="${i}">B${i+1} · ${esc(p.name)}</option>`).join(""); $("persona").value=String(c.pi);
    $("sit").innerHTML=src.parsed.situations.map(s=>`<option value="${s.id}">${s.id} · ${esc(s.name)}${src.personas[c.pi].situations.includes(s.id)?"":" (not linked to this persona)"}</option>`).join(""); $("sit").value=c.sid;
    $("reason").textContent=c.reason;
  }
  $("secb").hidden=!matched;
  $("seedbox").hidden=!c.seed; $("seedgo").hidden=!!c.seed;
  if(c.seed){ $("seed").value=c.seed; $("path").value=c.path; $("fb").value=c.fb||""; $("seedw").textContent=`· ${words(c.seed)} words`;
    $("seed").readOnly=$("path").readOnly=c.seedFinal; $("fb").disabled=$("seedre").disabled=c.seedFinal; $("seedfin").hidden=c.seedFinal; $("seedopen").hidden=!c.seedFinal;
    $("vcount").textContent=c.versions.length;
    $("versions").innerHTML=c.versions.map((v,i)=>`<div class="savedrow"><div><span class="lab">${esc(v.prompt)}</span>${v.feedback?`<span class="hint">Feedback after it: ${esc(v.feedback)}</span>`:""}</div>${c.seedFinal?"":`<div class="savedbtns"><button class="btn quiet" type="button" data-vback="${i}">Use this one</button></div>`}</div>`).reverse().join(""); }
  $("secc").hidden=!c.seedFinal;
  const has=c.prompts.length>0;
  $("setgo").hidden=has; $("check").hidden=!has||c.setFinal; $("setfbbox").hidden=!has;
  $("rows").innerHTML=c.prompts.map(p=>`<div class="prow" style="grid-template-columns:150px minmax(0,1fr) auto"><div><span class="lab" style="color:var(--navy)">${p.n}. ${esc(p.angle)}</span><span class="hint" style="display:block;color:var(--muted);font-size:12px">${words(p.text)} words${p.named&&p.named.length?" · names "+esc(p.named.join(", ")):""}</span></div>
    <div><textarea data-ptext="${p.n}" rows="2"${c.setFinal?" readonly":""} aria-label="Prompt ${p.n}">${esc(p.text)}</textarea>${p.issue?`<div class="ptags"><span class="pill">${esc(p.issue)}</span></div>`:""}${c.setFinal?"":`<input type="text" data-pnote="${p.n}" placeholder="Note for a rewrite (optional)" style="margin-top:6px;font-size:13px" aria-label="Note for prompt ${p.n}">`}</div>
    <div>${c.setFinal?"":`<button class="btn" type="button" data-pre="${p.n}">Rewrite</button>`}</div></div>`).join("");
  $("setfb").value=c.setFb||""; $("setfb").disabled=$("setre").disabled=c.setFinal; $("setfin").hidden=c.setFinal; $("setopen").hidden=!c.setFinal;
  $("secd").hidden=!c.setFinal;
  $("push").textContent=c.code&&c.pushedAt?"Push again to The Night Ventures":"Push to The Night Ventures";
}

/* ---------- Events ---------- */
$("sources").addEventListener("click",e=>{ const b=e.target.closest("[data-dsrc]"); if(!b||UI.busy) return;
  if(M.srcId!==b.dataset.dsrc){ M.srcId=b.dataset.dsrc; if(M.cur){ M.cur.pi=-1; M.cur.sid=""; } }
  if(!M.cur) M.cur=blank(); save(); render(); });
$("new").onclick=()=>{ if(UI.busy) return; if(!source()){ toast("Pick the base personas first"); return; }
  if(M.cur&&M.cur.text&&!M.cur.pushedAt&&UI.armed!=="new"){ UI.armed="new"; $("new").textContent="Click again to discard the current draft"; setTimeout(()=>{ if(UI.armed==="new"){ UI.armed=""; $("new").textContent="New moment"; } },4000); return; }
  UI.armed=""; $("new").textContent="New moment"; M.cur=blank(); save(); render(); $("text").focus(); };
$("refresh").onclick=()=>{ UI.brands=null; UI.existing=null; loadMoments(); };
$("list").addEventListener("click",async e=>{ const b=e.target.closest("[data-dopen]"); if(!b||UI.busy) return; const id=b.dataset.dopen;
  if(!source()){ toast("Pick the base personas first"); return; }
  if(M.cur&&M.cur.text&&!M.cur.pushedAt&&UI.armed!==id){ UI.armed=id; renderList(); setTimeout(()=>{ if(UI.armed===id){ UI.armed=""; renderList(); } },4000); return; }
  UI.armed=""; try{ await openMoment(id); }catch(err){ toast(TNV.errorText(err)); } });
$("text").addEventListener("input",e=>{ if(M.cur){ M.cur.text=e.target.value; save(); } });
$("title").addEventListener("input",e=>{ M.cur.title=e.target.value; save(); });
$("persona").onchange=e=>{ M.cur.pi=Number(e.target.value); M.cur.reason="Chosen by hand."; save(); render(); };
$("sit").onchange=e=>{ M.cur.sid=e.target.value; M.cur.reason="Chosen by hand."; save(); render(); };
$("match").onclick=doMatch;
$("seedgo").onclick=()=>doSeed(false);
$("seedre").onclick=()=>doSeed(true);
$("seed").addEventListener("input",e=>{ M.cur.seed=e.target.value; $("seedw").textContent=`· ${words(e.target.value)} words`; save(); });
$("path").addEventListener("input",e=>{ M.cur.path=e.target.value; save(); });
$("fb").addEventListener("input",e=>{ M.cur.fb=e.target.value; save(); });
$("seedfin").onclick=()=>{ const src=source(), c=M.cur; c.seed=$("seed").value.replace(/\s+/g," ").trim(); const iss=localIssue(src,{text:c.seed});
  if(!c.seed){ return; } if(iss.length){ $("bmsg").textContent=`Fix this first: ${iss.join("; ")}.`; return; }
  c.seedFinal=true; $("bmsg").textContent="Seed finalized."; save(); render(); };
$("seedopen").onclick=()=>{ const c=M.cur; c.seedFinal=false; c.setFinal=false; $("bmsg").textContent=c.prompts.length?"Seed unlocked. The prompt set stays; rewrite it if the seed changes.":"Seed unlocked."; save(); render(); };
$("versions").addEventListener("click",e=>{ const b=e.target.closest("[data-vback]"); if(!b) return; const c=M.cur, v=c.versions[Number(b.dataset.vback)]; if(!v) return;
  c.versions.push({prompt:c.seed,path_note:c.path,feedback:"(replaced by an earlier version)",at:new Date().toISOString()}); c.seed=v.prompt; c.path=v.path_note||c.path; save(); render(); });
$("setgo").onclick=()=>doSet(null,"");
$("setre").onclick=()=>{ const fb=$("setfb").value.trim(); if(!fb){ $("cmsg").textContent="Write your feedback first."; return; } syncRows(); doSet(null,fb); };
$("setfb").addEventListener("input",e=>{ M.cur.setFb=e.target.value; save(); });
$("check").onclick=()=>doCheck(false);
$("rows").addEventListener("change",e=>{ if(e.target.dataset.ptext){ syncRows(); save(); render(); } });
$("rows").addEventListener("click",e=>{ const b=e.target.closest("[data-pre]"); if(!b||UI.busy) return; syncRows(); const p=M.cur.prompts.find(x=>x.n===Number(b.dataset.pre)); const n=document.querySelector(`[data-pnote="${b.dataset.pre}"]`); if(p) doSet(p,n?n.value.trim():""); });
$("setfin").onclick=()=>{ const c=M.cur; syncRows(); const left=c.prompts.filter(p=>p.issue);
  if(c.prompts.length<SET_N){ $("cmsg").textContent=`The set needs ${SET_N} prompts.`; return; }
  if(left.length&&UI.armed!=="fin"){ UI.armed="fin"; $("cmsg").textContent=`${left.length} prompt${left.length===1?" still has":"s still have"} a note. Select Finalize set again to keep them as they are.`; setTimeout(()=>{ if(UI.armed==="fin") UI.armed=""; },6000); return; }
  if(c.prompts.some(p=>/names your own brand/.test(p.issue))){ $("cmsg").textContent="A prompt names your own brand. Change it first."; return; }
  UI.armed=""; c.setFinal=true; $("cmsg").textContent="Set finalized."; save(); render(); };
$("setopen").onclick=()=>{ M.cur.setFinal=false; save(); render(); };
$("push").onclick=doPush;

/* Reads from The Night Ventures only while this tool is open; switching company elsewhere just clears what was read. */
if(window.Company) Company.on(()=>{ UI.brands=null; UI.existing=null; UI.moments=null; if(location.hash==="#moments") loadMoments(); else renderList(); });
PersonaStore.on(render); ICPStore.on(render);
load(); if(M.srcId&&!M.cur) M.cur=blank();
render();
window.addEventListener("hashchange",()=>{ if(location.hash==="#moments"&&UI.moments===null) loadMoments(); });
if(location.hash==="#moments") loadMoments();
