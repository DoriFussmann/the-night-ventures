"""Browser test of the built page. Claude and Supabase are replaced by stand-ins (STUB), so nothing leaves the machine.

    pip install playwright && playwright install chromium
    python3 build.py && python3 tests/browser_test.py

The stand-ins return fixed replies. They show that the page's wiring works, not how well Claude writes or judges.
"""
import asyncio, json, pathlib, re
from collections import Counter
from playwright.async_api import async_playwright
PAGE=(pathlib.Path(__file__).resolve().parent.parent/'built'/'builder.html').as_uri()
STUB=r"""
window.__bad=false;
const STRAT='# Strategic ICP: Ledgerline\n\nOne line.\n\n## Blocking Unknowns\nNone\n\n## 4. Segments\n| Segment | Distinct need |\n|---|---|\n| Multi-entity distributors | x |\n\n## 5. Buyer Situations\n| ID | Situation | Trigger moment | Already tried | Deciding between | Stage weight | Confidence |\n|---|---|---|---|---|---|---|\n| S1 | Month-end overload | Close slipped twice | Hired temp | Tool or hire | Learn 10%, Problem 50%, Buy 40% | Hypothesized |\n| S2 | ERP migration | New ERP signed | Nothing | Native module or add-on | Learn 30%, Problem 30%, Buy 40% | Hypothesized |\n\n## 6. Alternatives\n| Category | Named examples |\n|---|---|\n| Do nothing | - |';
const PROFILE=n=>`### ${n}\n\n#### 1. Identity\n- **Dept:** Finance\n\n#### 8. Questions They Ask\n| Situation | Stage | Question | Source |\n|---|---|---|---|\n| S1 | Learn | How do finance teams handle invoices? | Invented |\n| S1 | Problem | My month-end close slipped twice, what do I do? | Invented |\n| S1 | Buy | Is AP software worth it versus hiring a clerk? | Invented |\n\n#### 9. Language\n| What the buyer calls it | What we call it |\n|---|---|\n| invoice backlog | AP automation |\n\n#### 11. Messaging Recommendations\n| Objection | Suggested response | Buy-stage question |\n|---|---|---|\n| ERP has a module | Compare | Is AP software worth it versus hiring a clerk? |\n\n#### 13. Evidence & Confidence\n| Characteristic | Classification | Basis |\n|---|---|---|\n| Owns budget | Inferred | ICP |`;
window.claude={use:async n=> n==='sample' ? (async (inp,o)=>{ const p=typeof inp==='string'?inp:inp[0].content; let t;
  if(p.includes('Write the Strategic ICP')) t=STRAT;
  else if(p.includes('Write the Operational ICP')) t='# Operational ICP: Ledgerline\n\n## 1. Eligibility\nx';
  else if(p.includes('"personas":[')) t=JSON.stringify({analysis:'Finance.',personas:[{name:'Financial Controller',priority:'Primary',purchasing_roles:['Decision Maker'],influence:'High',can_block:true,buys_or_uses:true,situations:[window.__bad?'S9':'S1'],prompt_share:60,prompt_share_reason:'decides',titles:['Controller'],existence_confidence:'Inferred',existence_basis:'ICP'},{name:'Board Adviser',priority:'Tertiary',purchasing_roles:['Influencer'],influence:'Low',can_block:false,buys_or_uses:false,situations:['S1'],prompt_share:30,titles:[],existence_confidence:'Hypothesized'}],merged:[],committee:{initiates:'Financial Controller'},segments:['Multi-entity distributors'],segment_map:[],segment_note:'Same.'});
  else if(p.includes('Write the buyer persona profile')){ window.__slim=(window.__slim||0)+(p.includes('slim structure')?1:0); t=PROFILE(p.includes('"name":"Board Adviser"')?'Board Adviser':'Financial Controller'); }
  else if(p.includes('WRITE EXACTLY THESE')){ window.__gen=(window.__gen||0)+1; const part=p.split('WRITE EXACTLY THESE')[1].split('RULES')[0]; const out=[]; for(const l of part.split('\n')){ const m=l.match(/^(\d+)\. situation (S\d+) \| stage (\w+) \| type (\w+) \| include: (.*?) \| name: (.*?)(?: \||$)/); if(!m) continue; const inc=m[5]==='none'?'':' for '+m[5].split(' = ').pop().split(';')[0]; const nm=m[6]==='none'?'':' compared with '+m[6].replace(' and ',' or ');
      out.push({slot:+m[1],prompt:(m[4]==='Recommendation'?'Who can help me sort out a growing invoice backlog':'How should I think about my invoice backlog')+' in '+m[2]+' '+m[3]+' number '+m[1]+' round '+window.__gen+inc+nm+'?',situation:m[2],stage:m[3],type:m[4],diagnostic:false}); } window.__lastGen=p; t=JSON.stringify(out); }
  else if(p.includes('EXISTING prompts and NEW candidate')){ window.__judge=p; const n=(p.split('\nNEW\n')[1].match(/^N\d+\./gm)||[]).length; const v=[]; for(let i=1;i<=n;i++) v.push({n:i,dup:(window.__gen===1&&i===3)?'N1':null,amb:window.__gen===1&&(i===5||i===6),why:'could mean charity fundraising'}); t=JSON.stringify(v); }
  else if(p.includes('QUESTIONS\n1.')){ window.__chk=p; const n=(p.split('QUESTIONS\n')[1].match(/^\d+\./gm)||[]).length; const v=[]; for(let i=1;i<=n;i++) v.push({n:i,amb:i===2||i===7,why:'funds could mean fund managers'}); t=JSON.stringify(v); }
  else if(p.includes('From the Strategic ICP below')) t='{"icp":"Mid-sized firms with invoice overload.","shared_traits":["Small finance team","No AP tooling"]}';
  else if(p.includes('Condense one buyer persona')) t='{"summary":"Runs finance","stage":"Mid-sized","trigger":"Close slipped","need":"Fewer manual invoices","pains":"late fees; rework","decision_criteria":"ERP fit","alternatives":"hire a clerk","their_words":"invoice backlog; month-end close late","where_they_listen":"peers; LinkedIn","main_tiers":"Problem, Buy"}';
  else t='## Evidence & Confidence Report\nAll inferred.\n\n1. Interview controllers';
  if(o&&o.onText) o.onText({text:t}); if(p.includes('WRITE EXACTLY THESE')) await new Promise(r=>setTimeout(r,300)); return {text:t,truncated:false}}) : n==='mcp' ? {callTool:async(srv,tool,inp)=>{ window.__sql=(window.__sql||[]); window.__sql.push(inp.query); const wrap=j=>({payload:{result:'Below is the result.\n<untrusted-data-abc>\n'+JSON.stringify(j)+'\n</untrusted-data-abc>\nUse this data'}});
    if(inp.query.includes('from public.companies')) return wrap([{id:'11111111-2222-4333-8444-555555555555',name:'Otherco'},{id:'22222222-3333-4444-8555-666666666666',name:'Ledgerline'}]);
    if(inp.query.includes('from public.pt_brands')) return wrap(window.__live||[]);
    if(inp.query.includes('tnv_push_icp')) return wrap([{result:{ok:true,icp_updated:true,traits:2,operational:false}}]);
    if(inp.query.includes('tnv_push_prompts')){ window.__pp=inp.query; return wrap([{result:{ok:true,prompts:20,brands:1,total:20}}]); }
    return wrap([{result:{ok:true,personas:2,removed:0,kept_in_use:0,existing_untouched:3}}]); }} : null};
"""





STATE="JSON.parse(localStorage.getItem('prompt-builder-v1'))"
async def state(pg): return await pg.evaluate(f"(s=>({{mix:s.mix,targets:s.cols.map(c=>c.target),live:s.cols.map(c=>c.prompts.filter(p=>p.status!=='Rejected').length),stored:s.cols.map(c=>c.prompts.length),draft:s.cols.map(c=>c.prompts.filter(p=>p.status==='Draft').length),amb:s.cols.map(c=>c.prompts.filter(p=>p.amb).length),style:s.style||''}}))({STATE})")
async def to_prompts(pg):
    """ICP → personas → Prompt Builder, with the example company."""
    await pg.goto(PAGE); await pg.evaluate("localStorage.clear()"); await pg.reload()
    await pg.click('#btn-example'); await pg.click('#btn-generate'); await pg.wait_for_timeout(600)
    await pg.click('#tool-tab-persona'); await pg.click('[data-use]'); await pg.wait_for_timeout(200); await pg.click('#p-btn-generate'); await pg.wait_for_timeout(1200)
    await pg.click('#tool-tab-prompts'); await pg.wait_for_timeout(200); await pg.click('[data-src]'); await pg.wait_for_timeout(200)
async def set_mix(pg,total,weights):
    await pg.fill('#q-mix-total',str(total)); await pg.press('#q-mix-total','Tab'); await pg.wait_for_timeout(100)
    for i,w in enumerate(weights):
        await pg.fill(f'[data-mixw="{i}"]',str(w)); await pg.press(f'[data-mixw="{i}"]','Tab'); await pg.wait_for_timeout(100)
def check(name,ok,detail=''):
    print(('ok   ' if ok else 'FAIL ')+name+(' · '+str(detail) if detail and not ok else '')); RESULTS.append(ok)
RESULTS=[]
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page(viewport={'width':1680,'height':1000})
        errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.add_init_script(STUB)

        # Persona mix
        await to_prompts(pg); s=await state(pg)
        check('mix starts at 200 with weights from the persona shares', s['mix']['total']==200 and sum(s['targets'])==200 and s['mix']['w']==[67,33], s)
        await pg.fill('[data-mixw="0"]','1'); await pg.press('[data-mixw="0"]','Tab'); await pg.wait_for_timeout(100)
        check('tabbing out of a weight box lands in the next one', await pg.evaluate("document.activeElement.dataset.mixw")=='1')
        await set_mix(pg,40,[1,1]); s=await state(pg); check('total 40, weights 1:1 → targets 20 and 20', s['targets']==[20,20], s)

        # Generation, with one duplicate and two "may be misread" verdicts from the stand-in judge
        await pg.click('[data-gen="0"]'); await pg.wait_for_timeout(3500); s=await state(pg)
        check('a batch fills the persona to its target', s['live'][0]==20, s)
        reasons=await pg.evaluate(f"[...new Set({STATE}.cols[0].log.map(l=>l.reason.split(' (')[0].split(';')[0]))]")
        check('ambiguous and duplicate candidates were sent back for rewriting', any('misread' in r for r in reasons) and any('duplicate' in r for r in reasons), reasons)
        g=await pg.evaluate("window.__lastGen"); check('the request carries rule 10 and the market line', '10. Each prompt is read on its own' in g and 'The market: ' in g)
        check('no style block when the box is empty', 'STYLE REFERENCE' not in g)

        # Approve, check existing, flags
        await pg.click('#q-approveall'); s=await state(pg); check('approve all drafts', s['draft'][0]==0, s)
        await pg.click('#q-checkamb'); await pg.wait_for_timeout(900); s=await state(pg)
        check('check existing prompts flags two back to Draft', s['amb'][0]==2 and s['draft'][0]==2, s)
        await pg.click('#q-approveall'); s=await state(pg); check('approve all drafts leaves flagged prompts alone', s['draft'][0]==2, s)
        fid=await pg.evaluate(f"{STATE}.cols[0].prompts.find(p=>p.amb).id")
        await pg.fill(f'[data-text="{fid}"]','How should my distribution company handle a growing supplier invoice backlog before year end?'); await pg.press(f'[data-text="{fid}"]','Tab'); await pg.wait_for_timeout(200)
        s=await state(pg); check('editing a flagged prompt clears its flag', s['amb'][0]==1, s)

        # Trim to target
        await set_mix(pg,40,[1,4]); s=await state(pg); check('weights 1:4 → targets 8 and 32', s['targets']==[8,32], s)
        await pg.click('[data-trim="0"]'); await pg.wait_for_timeout(150); box=await pg.inner_text('.ptrim'); s=await state(pg)
        check('trim shows a preview and rejects nothing yet', 'Trim will reject 12 of 20' in box and s['live'][0]==20, box[:80])
        await pg.click('[data-trimgo="0"]'); await pg.wait_for_timeout(200); s=await state(pg)
        check('trim brings the persona to its target and keeps rejected prompts stored', s['live'][0]==8 and s['stored'][0]==20, s)

        # Push: brands already in The Night Ventures are kept; statuses travel
        await pg.evaluate("window.__live=[{name:'Ledgerline Inc',is_own:true,domains:['ledgerline.example'],name_patterns:['Ledgerline','Ledgerline Inc'],exclude_patterns:['Ledger Nano']},{name:'HandAdded',is_own:false,domains:['handadded.example'],name_patterns:['HandAdded'],exclude_patterns:[]}]")
        await pg.click('#q-push'); await pg.wait_for_timeout(300); await pg.select_option('#tnv-company',label='Ledgerline'); await pg.click('#tnv-go'); await pg.wait_for_timeout(800)
        q=await pg.evaluate("window.__pp"); m=re.search(r'\$(tnv\w+)\$(.*)\$\1\$',q,re.S); pl=json.loads(m.group(2))
        check('push sends the existing brands back unchanged', pl['brands']==[{'name':'Ledgerline Inc','own':True,'domains':['ledgerline.example'],'name_patterns':['Ledgerline','Ledgerline Inc'],'exclude_patterns':['Ledger Nano']},{'name':'HandAdded','own':False,'domains':['handadded.example'],'name_patterns':['HandAdded'],'exclude_patterns':[]}], pl['brands'])
        st=Counter(x['status'] for x in pl['prompts']); check('push sends approved and rejected prompts with their status, no drafts', st.get('Rejected',0)==12 and 'Draft' not in st and st.get('Approved',0)>0, dict(st))

        # Style box
        await to_prompts(pg); await set_mix(pg,40,[1,1])
        await pg.click('[data-gen="0"]'); await pg.wait_for_timeout(3500); empty=await pg.evaluate("window.__lastGen")
        await to_prompts(pg); await set_mix(pg,40,[1,1])
        await pg.fill('#q-style','need a tool for supplier invoices, 3 entities, 2 people in finance. what do people use?\n- how do i stop duplicate payments'); await pg.wait_for_timeout(100)
        note=await pg.inner_text('#q-stylenote'); check('the note under the style box counts the examples', note.startswith('2 examples in use'), note)
        await pg.click('[data-gen="0"]'); await pg.wait_for_timeout(3500); styled=await pg.evaluate("window.__lastGen")
        i=styled.find('STYLE REFERENCE'); j=styled.find('WRITE EXACTLY THESE')
        check('with examples, one block is added before the slot list and nothing else changes', 0<i<j and styled[:i]+styled[j:]==empty)
        check('examples are not copied into the prompt list', not await pg.evaluate(f"{STATE}.cols[0].prompts.some(p=>p.text.includes('duplicate payments'))"))

        check('no page errors', not errs, errs)
        await b.close()
    print(f"\n{sum(RESULTS)} of {len(RESULTS)} passed"); raise SystemExit(0 if all(RESULTS) else 1)
asyncio.run(main())
