"""Browser test of the Decision Moments tool. Claude and Supabase are replaced by stand-ins, as in browser_test.py
(its STUB is reused, with the moment requests added on top). Nothing leaves the machine.

    python3 build.py && python3 tests/moments_test.py
"""
import asyncio, json, pathlib, re
from playwright.async_api import async_playwright
HERE=pathlib.Path(__file__).resolve().parent
PAGE=__import__('os').environ.get('PAGE_URI') or (pathlib.Path(__file__).resolve().parent.parent/'built'/'builder.html').as_uri()
BASE=re.search(r'STUB=r"""(.*?)"""',(HERE/'browser_test.py').read_text(),re.S).group(1)
EXTRA=r"""
window.__live=[{name:'Ledgerline',is_own:true,domains:['ledgerline.example'],name_patterns:['Ledgerline'],exclude_patterns:[]},{name:'PayStack Pro',is_own:false,domains:[],name_patterns:['PayStack Pro'],exclude_patterns:[]},{name:'Northbook',is_own:false,domains:[],name_patterns:['Northbook'],exclude_patterns:[]}];
window.__m={match:0,seed:0,set:0,one:0,judge:0,push:null,ownInSet:false};
const baseUse=window.claude.use;
window.claude={use:async n=>{
  const real=await baseUse(n);
  if(n==='sample') return async (inp,o)=>{ const p=typeof inp==='string'?inp:inp[0].content; let t=null;
    if(p.includes('Match it to the closest existing buyer persona')){ window.__m.match++; t=JSON.stringify({persona:1,situation:'S1',fit:true,reason:'A controller whose close keeps slipping.',title:'Close slipped, wants help now'}); }
    else if(p.includes('a short note on how its answer should lead to the seller')){ window.__m.seed++; window.__m.seedReq=p;
      t=JSON.stringify({prompt:window.__m.seed===1?'Our month-end close slipped twice and I need someone to take over invoice coding fast, who should I use for a ten-person finance team?':'Month-end close slipped twice, ten-person finance team, who can take invoice coding off our hands this quarter without a big implementation?',path:{need:'invoice coding handled',category:'payables software',why_us:'flat fee, built for multi-entity distributors',competitors:['PayStack Pro','Northbook']}}); }
    else if(p.includes('All of them come from one moment')){ const lines=p.split('WRITE EXACTLY THESE')[1].split('RULES')[0].split('\n').map(l=>l.match(/^(\d+)\. angle: (.*)$/)).filter(Boolean);
      if(lines.length===1) window.__m.one++; else window.__m.set++; window.__m.setReq=p;
      t=JSON.stringify(lines.map(m=>({n:+m[1],angle:m[2],prompt:(window.__m.ownInSet&&m[1]==='4'?'Is Ledgerline any good for':'Who can help a ten-person finance team whose month-end close slipped twice with')+' invoice coding, angle '+m[2]+', number '+m[1]+' try '+(window.__m.set+window.__m.one)+'?',named_brands:m[2]==='Named comparison'?['PayStack Pro','Madeup Co']:[]}))); }
    else if(p.includes('Check a set of NEW prompts')){ window.__m.judge++; window.__m.judgeReq=p; const n=(p.split('\nNEW\n')[1].match(/^N\d+\./gm)||[]).length; const v=[];
      for(let i=1;i<=n;i++) v.push({n:i,dup:window.__m.judge===1&&i===3?'E1':null,rec:!(window.__m.judge===1&&i===5),same:true,why:window.__m.judge===1&&(i===3||i===5)?'stand-in reason':''}); t=JSON.stringify(v); }
    if(t!==null){ if(o&&o.onText) o.onText({text:t}); return {text:t,truncated:false}; }
    return real(inp,o); };
  if(n==='mcp') return {callTool:async(srv,tool,inp)=>{ const q=inp.query, wrap=j=>({payload:{result:'Below is the result.\n<untrusted-data-abc>\n'+JSON.stringify(j)+'\n</untrusted-data-abc>\nUse this data'}});
    if(q.includes('from public.pt_moments m')) return wrap(window.__m.push?[{id:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',code:'DM1',title:'Close slipped, wants help now',status:'final',n:10}]:[]);
    if(q.includes('select code, prompt from public.pt_prompts')) return wrap([{code:'P1-001',prompt:'Who can help me sort out a growing invoice backlog?'}]);
    if(q.includes('max(substring(code from 3)')) return wrap([{n:1}]);
    if(q.includes('tnv_push_moment')){ window.__m.push=q; return wrap([{result:{ok:true,moment_id:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',code:'DM1',prompts:10,moment_prompts:10}}]); }
    return real.callTool(srv,tool,inp); }};
  return real; }};
"""
RESULTS=[]
def check(name,ok,detail=''):
    print(('ok   ' if ok else 'FAIL ')+name+(' · '+str(detail)[:300] if detail and not ok else '')); RESULTS.append(ok)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page(); errs=[]
        pg.on('pageerror',lambda e: errs.append(str(e)))
        await pg.add_init_script(BASE+EXTRA)
        await pg.goto(PAGE); await pg.evaluate("localStorage.clear()"); await pg.reload()
        await pg.click('#btn-example'); await pg.click('#btn-generate'); await pg.wait_for_timeout(600)
        await pg.click('#tool-tab-persona'); await pg.click('[data-use]'); await pg.wait_for_timeout(200); await pg.click('#p-btn-generate'); await pg.wait_for_timeout(1200)
        await pg.select_option('#co-pick',label='Ledgerline'); await pg.wait_for_timeout(300)
        await pg.click('#tool-tab-moments'); await pg.wait_for_timeout(300)
        check('the tab opens and shows the saved personas', await pg.is_visible('#tool-moments') and await pg.locator('[data-dsrc]').count()==1)
        check('the work area waits for a persona set', await pg.is_hidden('#d-work'))
        await pg.click('[data-dsrc]'); await pg.wait_for_timeout(100)
        await pg.click('#d-match'); await pg.wait_for_timeout(100)
        check('matching asks for a description first', 'Describe the moment' in await pg.text_content('#d-amsg'))
        await pg.fill('#d-text','A financial controller at a distributor, month-end close slipped twice, wants to fix invoice coding now and has budget approval.')
        await pg.click('#d-match'); await pg.wait_for_timeout(300)
        check('step A: matched persona B1 and situation S1, with a title and a reason', await pg.input_value('#d-persona')=='0' and await pg.input_value('#d-sit')=='S1' and await pg.input_value('#d-title')=='Close slipped, wants help now' and 'controller' in await pg.text_content('#d-reason'))
        await pg.click('#d-seedgo'); await pg.wait_for_timeout(300)
        req=await pg.evaluate("window.__m.seedReq")
        check('the seed request carries the moment, the persona, competitors from TNV and the own brand as never mention', 'slipped twice, wants to fix' in req and 'Financial Controller' in req and 'PayStack Pro' in req and 'Never mention: Ledgerline' in req)
        check('step B: seed prompt and path note shown', 'who should I use' in await pg.input_value('#d-seed') and 'Competing for the answer: PayStack Pro, Northbook' in await pg.input_value('#d-path'))
        await pg.click('#d-seedre'); await pg.wait_for_timeout(100)
        check('rewrite needs feedback', 'feedback first' in await pg.text_content('#d-bmsg'))
        await pg.fill('#d-fb','shorter, no "fast"'); await pg.click('#d-seedre'); await pg.wait_for_timeout(300)
        req=await pg.evaluate("window.__m.seedReq")
        check('the rewrite sends the previous version and the feedback', 'PREVIOUS VERSION' in req and 'shorter, no "fast"' in req)
        st=await pg.evaluate("JSON.parse(localStorage.getItem('moment-builder-v1')).cur")
        check('the earlier version is kept with its feedback', len(st['versions'])==1 and st['versions'][0]['feedback']=='shorter, no "fast"' and 'without a big implementation' in st['seed'], st['versions'])
        check('the prompt set waits for a final seed', await pg.is_hidden('#d-secc'))
        await pg.click('#d-seedfin'); await pg.wait_for_timeout(100)
        check('finalizing locks the seed and opens step C', await pg.is_visible('#d-secc') and await pg.get_attribute('#d-seed','readonly') is not None and await pg.is_disabled('#d-seedre'))
        await pg.click('#d-setgo'); await pg.wait_for_timeout(600)
        st=await pg.evaluate("JSON.parse(localStorage.getItem('moment-builder-v1')).cur")
        angles=[x['angle'] for x in st['prompts']]
        check('step C: 10 prompts, two per angle, in order', len(st['prompts'])==10 and angles==[a for a in ['Direct ask','Service category','Named comparison','Hire or do it myself','Constraint-led'] for _ in (0,1)], angles)
        check('named brands are kept only when they are tracked competitors', st['prompts'][4]['named']==['PayStack Pro'], st['prompts'][4]['named'])
        jr=await pg.evaluate("window.__m.judgeReq")
        check('the check compares against the company prompts in TNV', 'E1. Who can help me sort out a growing invoice backlog?' in jr)
        check('the check flags the duplicate (with the TNV code) and the non-recommendation prompt', 'duplicate of P1-001' in st['prompts'][2]['issue'] and 'not a recommendation prompt' in st['prompts'][4]['issue'] and not st['prompts'][0]['issue'], [x['issue'] for x in st['prompts']])
        await pg.fill('[data-pnote="3"]','ask about a fee model instead'); await pg.click('[data-pre="3"]'); await pg.wait_for_timeout(600)
        st=await pg.evaluate("JSON.parse(localStorage.getItem('moment-builder-v1')).cur"); sr=await pg.evaluate("window.__m.setReq")
        check('rewriting one prompt asks for that one only, with the note and the rest of the set', await pg.evaluate("window.__m.one")==1 and 'ask about a fee model instead' in sr and 'THE OTHER PROMPTS IN THE SET' in sr and 'try 2' in st['prompts'][2]['text'])
        check('the set is checked again after the rewrite, and now passes', await pg.evaluate("window.__m.judge")==2 and all(not x['issue'] for x in st['prompts']), [x['issue'] for x in st['prompts']])
        await pg.fill('[data-ptext="4"]','Is Ledgerline any good for a ten-person finance team whose month-end close slipped twice?'); await pg.dispatch_event('[data-ptext="4"]','change'); await pg.wait_for_timeout(100)
        await pg.click('#d-check'); await pg.wait_for_timeout(400)
        st=await pg.evaluate("JSON.parse(localStorage.getItem('moment-builder-v1')).cur")
        check('an edited prompt that names the own brand is flagged', 'names your own brand' in st['prompts'][3]['issue'], st['prompts'][3])
        await pg.click('#d-setfin'); await pg.click('#d-setfin'); await pg.wait_for_timeout(100)
        check('the set cannot be finalized while a prompt names the own brand', await pg.is_hidden('#d-secd') and 'own brand' in await pg.text_content('#d-cmsg'))
        await pg.fill('[data-ptext="4"]','Is there a payables service for a ten-person finance team whose month-end close slipped twice, and who runs it?'); await pg.dispatch_event('[data-ptext="4"]','change'); await pg.wait_for_timeout(100)
        await pg.click('#d-check'); await pg.wait_for_timeout(400)
        await pg.click('#d-setfin'); await pg.wait_for_timeout(100)
        check('finalizing the set opens step D', await pg.is_visible('#d-secd'))
        await pg.click('#d-push'); await pg.wait_for_timeout(200)
        check('the push dialog shows the chosen company', await pg.is_visible('#tnvdlg') and 'Ledgerline' in await pg.text_content('#tnv-company'))
        await pg.click('#tnv-go'); await pg.wait_for_timeout(500)
        q=await pg.evaluate("window.__m.push")
        payload=json.loads(re.search(r"\$tnv\w+\$(.*)\$tnv\w+\$",q,re.S).group(1)) if q else {}
        codes=[x['id'] for x in payload.get('prompts',[])]
        check('push calls tnv_push_moment with DM1 and prompts DM1-01 to DM1-10', 'tnv_push_moment' in q and payload['moment']['code']=='DM1' and codes==[f'DM1-{i:02d}' for i in range(1,11)], codes)
        m=payload.get('moment',{})
        check('the moment carries persona B1, S1, the seed, the path note, 1 earlier version and 10 runs', m.get('persona_code')=='B1' and m.get('situation_id')=='S1' and 'without a big implementation' in m.get('seed_prompt','') and 'Why us:' in m.get('path_note','') and len(m.get('seed_versions',[]))==1 and m.get('runs')==10, m)
        check('no pushed prompt names the own brand', not any('ledgerline' in x['prompt'].lower() for x in payload.get('prompts',[])))
        check('the confirmation names the moment', 'moment DM1 with 10 prompts' in await pg.text_content('#tnv-msg'))
        await pg.click('#tnv-cancel'); await pg.wait_for_timeout(300)
        check('the moment is listed from TNV after the push', 'DM1' in await pg.text_content('#d-list') and 'Push again' in await pg.text_content('#d-push'))
        await pg.reload(); await pg.wait_for_timeout(600)
        st=await pg.evaluate("JSON.parse(localStorage.getItem('moment-builder-v1')).cur")
        check('the moment survives a reload', st['code']=='DM1' and st['setFinal'] and await pg.is_visible('#d-secd'))
        await pg.click('#tool-tab-prompts'); await pg.wait_for_timeout(200)
        check('the other tools still switch', await pg.is_visible('#tool-prompts') and await pg.is_hidden('#tool-moments'))
        check('no page errors', not errs, errs)
        await b.close()
    print(f"\n{sum(RESULTS)} of {len(RESULTS)} passed"); raise SystemExit(0 if all(RESULTS) else 1)
asyncio.run(main())
