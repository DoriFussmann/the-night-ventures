"""Generates the explainer deck's files (project/deck.json and project/slides/*.html) next to this script.

    python3 gen.py

Publish them to the Slides artifact named in ../README.md.
"""
import os, pathlib
os.chdir(pathlib.Path(__file__).resolve().parent); os.makedirs("project/slides",exist_ok=True)
import json, os, datetime
PAGE="#F4F2EC"; NAVY="#16233A"; TEAL="#1F7A6B"; ORANGE="#E59A4B"; MINT="#CFE8E1"; MINTINK="#0E4D42"; MIDTEAL="#5FB3A1"
CALC="#E3E6EA"; CARD2="#E6EEF0"; CARD="#FFFFFF"; LINE="#D9DCE1"; BODY="#4A5568"; MUTED="#6A7179"; ONNAVY="#F4F2EC"; SOFT="#BFCAD9"
FONT="font-family:'Inter', 'Helvetica Neue', Arial, sans-serif"
slides=[]; order=[]
def add(id,html): slides.append((id,html)); order.append(id)
KIND={"in":("Input",MINT,MINTINK),"calc":("Calculation",CALC,NAVY),"out":("Output",ORANGE,NAVY)}
def chip(text,kind="calc",size=24):
    _,bg,fg=KIND[kind]
    return f'<div style="background:{bg};color:{fg};border-radius:10px;padding:8px 14px;font-size:{size}px;font-weight:400;line-height:1.2">{text}</div>'
def op(t): return f'<p style="font-size:28px;color:{MUTED};font-weight:400">{t}</p>'
def tag(kind):
    label,bg,fg=KIND[kind]
    return f'<div style="display:flex"><div style="background:{bg};color:{fg};border-radius:10px;padding:6px 14px;font-size:24px;font-weight:400;line-height:1.2">{label}</div></div>'
def card(title,items,kind=None,flex="1",extra=""):
    lis="".join(f'<li>{x}</li>' for x in items)
    body=f'<ul style="font-size:24px;line-height:1.38;color:{BODY};font-weight:400;padding-left:28px">{lis}</ul>' if items else ""
    return (f'<div style="flex:{flex};display:flex;flex-direction:column;gap:14px;background:{CARD};border:1px solid {LINE};border-radius:16px;padding:22px 26px">'
            +(tag(kind) if kind else "")+f'<h3 style="font-size:30px;font-weight:200;color:{NAVY};line-height:1.15">{title}</h3>{body}{extra}</div>')
def band(label,text,dark=False):
    bg,fg,lab=(NAVY,ONNAVY,ORANGE) if dark else (MINT,MINTINK,MINTINK)
    return (f'<div style="display:flex;align-items:center;gap:32px;background:{bg};border-radius:16px;padding:20px 32px">'
            f'<p style="width:260px;font-size:26px;font-weight:200;color:{lab};line-height:1.2">{label}</p>'
            f'<p style="flex:1;font-size:24px;font-weight:400;color:{fg};line-height:1.38">{text}</p></div>')
page=[0]
def content(id,eyebrow,title,inner,notes=""):
    page[0]=len(order)+1
    add(id,f'''<section id="{id}" style="background:{PAGE};color:{BODY};{FONT};padding:128px 128px 160px;display:flex;flex-direction:column;gap:30px">
<div style="display:flex;flex-direction:column;gap:12px">
<p style="font-size:26px;font-weight:400;letter-spacing:4px;color:{TEAL}">{eyebrow.upper()}</p>
<h2 style="font-size:56px;font-weight:200;line-height:1.1;color:{NAVY}">{title}</h2>
</div>
{inner}
<p style="position:absolute;left:128px;bottom:64px;width:1400px;font-size:24px;color:{MUTED}">Builder Flow · How It Works · v2</p>
<p style="position:absolute;right:128px;bottom:64px;width:120px;text-align:right;font-size:24px;color:{MUTED}">{page[0]}</p>
{"<aside>"+notes+"</aside>" if notes else ""}
</section>''')
def section(id,eyebrow,title,sub):
    add(id,f'''<section id="{id}" style="background:{NAVY};color:{ONNAVY};{FONT};padding:128px;display:flex;flex-direction:column;justify-content:center;gap:24px">
<p style="font-size:26px;font-weight:400;letter-spacing:4px;color:{ORANGE}">{eyebrow.upper()}</p>
<h2 style="font-size:80px;font-weight:200;line-height:1.08;color:{ONNAVY}">{title}</h2>
<p style="font-size:32px;font-weight:400;line-height:1.4;color:{SOFT};width:1300px">{sub}</p>
</section>''')
row=lambda inner,gap=24: f'<div style="display:flex;gap:{gap}px;align-items:stretch">{inner}</div>'
flow=lambda inner: f'<div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center">{inner}</div>'

# 1 cover
keytag=lambda k: f'<div style="background:{KIND[k][1]};color:{KIND[k][2]};border-radius:24px;padding:10px 22px;font-size:24px;font-weight:400">{KIND[k][0]}</div>'
add("cover",f'''<section id="cover" style="background:{NAVY};color:{ONNAVY};{FONT};padding:128px;display:flex;flex-direction:column;justify-content:space-between">
<p style="font-size:26px;font-weight:400;letter-spacing:4px;color:{ORANGE}">ICP › PERSONAS › PROMPTS</p>
<div style="display:flex;flex-direction:column;gap:32px">
<h1 style="font-size:120px;font-weight:200;line-height:1.05;color:{ONNAVY}">How the Builder Flow Works</h1>
<p style="font-size:40px;font-weight:400;line-height:1.3;color:{SOFT};width:1400px">The ICP Builder, the Persona Builder and the Prompt Builder: what goes in, what happens in the middle, and what comes out.</p>
</div>
<div style="display:flex;gap:16px;align-items:center">
<p style="font-size:24px;color:{SOFT};font-weight:400">Colour key</p>{keytag("in")}{keytag("calc")}{keytag("out")}
</div>
</section>''')

# 2 flow
def stage(n,name,makes,kind):
    return (f'<div style="flex:1;display:flex;flex-direction:column;gap:12px;background:{CARD};border:1px solid {LINE};border-radius:16px;padding:22px 24px">'
            f'<p style="font-size:24px;letter-spacing:3px;color:{TEAL};font-weight:400">STEP {n}</p>'
            f'<h3 style="font-size:30px;font-weight:200;color:{NAVY};line-height:1.15">{name}</h3>'
            f'<p style="font-size:24px;line-height:1.38;color:{BODY};font-weight:400">{makes}</p></div>')
content("flow","The whole flow","Four Steps, Each Built on the One Before",
 row(stage(1,"ICP Builder","Company documents in. Strategic and Operational ICP out.","in")
    +stage(2,"Persona Builder","Saved ICP in. A persona portfolio out.","calc")
    +stage(3,"Prompt Builder","Saved personas in. Reviewed prompts out.","calc")
    +stage(4,"Prompt Tests","Approved prompts in. What each AI engine did with them out.","out"),20)
 +flow(chip("Company documents","in")+op("›")+chip("ICP","calc")+op("›")+chip("Personas","calc")+op("›")+chip("Prompts","calc")+op("›")+chip("Test results","out"))
 +band("Where each runs","Steps 1 to 3 run in the builder page. Step 4 runs in The Night Ventures, in the Prompt Tests tab of the AEO Playbook.",True)
 +band("What links them","Buyer situations. The ICP defines them as S1, S2 and so on; personas and prompts may only use those IDs."),
 "Each step reads the saved result of the step before it, so regenerate and re-save upstream before rebuilding downstream.")

# ICP
section("sec-icp","Step 1","ICP Builder","Turns what the company knows about itself into a definition of who to sell to, and how to find them.")
chips9="".join(chip(x,"in") for x in ["Offering","Customer &amp; market","Qualification &amp; fit","Problem &amp; impact","Triggers &amp; timing","Sales motion","Constraints","Evidence &amp; proof","Where to find them"])
content("icp-in","ICP Builder · Inputs","Company Documents Fill 35 Fields",
 row(card("Company Documents",["Upload one or more .md files","Recognised headings and labelled rows fill fields directly","Analyse: Claude reads every file and fills the fields still empty","Filled fields are tagged “from document”"],"in")
    +card("35 Fields in 9 Sections",[],"in",extra=f'<div style="display:flex;flex-wrap:wrap;gap:10px">{chips9}</div><p style="font-size:24px;line-height:1.38;color:{BODY};font-weight:400">8 are required: company, product, value proposition, problems, delivery, pricing, customer, geography.</p>')
    +card("On Each Answer",["Customer type: organizations, individuals or both","Evidence status: Confirmed, Inferred, Hypothesized or Unknown","Size, revenue and budget only where they decide fit","Gaps stay empty; nothing is filled in for you"],"in"))
 +band("Reset","Clears inputs, uploads and output for this tool. Saved ICPs are not touched."))
content("icp-import","ICP Builder · Inputs","How Uploaded Files Are Read",
 row(card("What Is Kept",["Each competitor on one line: name, what it is, how it charges, category","Two files answering one field: both kept, each under its file name","An answer you typed stays, under “Existing answer”"],"in")
    +card("What Is Replaced or Skipped",["The same file uploaded again replaces its own answers","“_Empty_” is not an answer; the field stays empty","Company name: the latest file wins","Analyse fills only what import left empty"],"calc")
    +card("Left Out on Purpose",["Retired fields in the Company export","Conversion, voice and tone, live wording","Approved claims, never-claim, out-of-scope topics","Product name, domain, search market, language"],"calc"))
 +band("From The Night Ventures","The Company and Brand Facts exports are read as they are. “The offer” fills Product / Service; “Operating constraints” fills Constraints; “Competitors” fills Competitive alternatives.",True))
content("icp-mid","ICP Builder · In the middle","Claude Writes Two Documents Under Fixed Rules",
 flow(chip("Inputs","in")+op("×")+chip("Rules","calc")+op("›")+chip("Pass 1 · Strategic ICP","calc")+op("›")+chip("Pass 2 · Operational ICP","calc"))
 +row(card("Two Passes",["Pass 1 writes the Strategic ICP from the inputs","Pass 2 writes the Operational ICP from the Strategic ICP and adds no new criteria","Pass 2 is optional: untick “Include Operational ICP”","A long answer continues automatically"],"calc")
     +card("Rules Claude Works Under",["Every important statement carries an evidence status","No invented criteria: size, revenue or budget only if the inputs establish them","“Does not matter” carries through segments, fit and filters","Contradictions stay open as decisions","No scores, weights or market numbers without data","Competitor names only; detail beside the table"],"calc"))
 +band("Why two documents","A strong-fit customer may have no buying intent, and a company with intent may be a poor fit. Who they are and how to find them stay separate.",True))
ol=lambda items: "".join(f"<li>{x}</li>" for x in items)
def listcard(title,sub,items,kind):
    return (f'<div style="flex:1;display:flex;flex-direction:column;gap:12px;background:{CARD};border:1px solid {LINE};border-radius:16px;padding:22px 26px">{tag(kind)}'
            f'<h3 style="font-size:30px;font-weight:200;color:{NAVY};line-height:1.15">{title}</h3><p style="font-size:24px;color:{MUTED};font-weight:400">{sub}</p>'
            f'<div style="display:flex;gap:28px"><ul style="flex:1;font-size:24px;line-height:1.36;color:{BODY};padding-left:28px">{ol(items[:(len(items)+1)//2])}</ul><ul style="flex:1;font-size:24px;line-height:1.36;color:{BODY};padding-left:28px">{ol(items[(len(items)+1)//2:])}</ul></div></div>')
content("icp-out","ICP Builder · Outputs","Who the Customer Is, and How to Find Them",
 row(listcard("Strategic ICP","Who they are and why they buy",["Blocking unknowns","Ideal customer","Problem &amp; reasons to buy","What defines fit, and what does not","Segments","Buyer situations (S1, S2 …)","Alternatives","Question variables","Challenges to the inputs","Evidence &amp; validation","Open questions"],"out")
    +listcard("Operational ICP","For sales operations; optional",["Eligibility: pass or fail","ICP fit: strong, partial, weak","Buying intent: signals","How the three combine","Prospecting filters","Market sizing approach","Provisional rules"],"out"))
 +band("Saved automatically","As “Company ICP” when generation finishes. Open it again under Saved ICPs, with the inputs it was built from.")
 +band("Push to The Night Ventures","Overwrites the short ICP paragraph and shared traits in the Personas tab, and stores both full documents on the company.",True))

# Personas
section("sec-per","Step 2","Persona Builder","Works out which people take part in the purchase, and what each of them asks, in their own words.")
content("per-in","Persona Builder · Inputs","A Saved ICP, Seven Answers and Optional Evidence",
 row(card("Saved ICP",["Pick it under Saved ICPs, or upload ICP markdown","It must contain Buyer Situations with IDs","Both documents and the ICP inputs are read","It is the source of truth; personas cannot contradict it"],"in")
    +card("Seven Context Answers",["Product, value proposition, problem, delivery model, sales model, deal size, sales complexity","Filled from the saved ICP","“Find missing answers in the ICP” asks Claude for the rest"],"in")
    +card("Optional Evidence",["Real buyer language: transcripts, emails, forum threads, search queries","Customers, contacts, deals, objections","Only what you supply here can be marked Validated or Real"],"in"))
 +band("Reopening","Selecting an ICP you have already built personas for reopens those personas; it does not wipe them."))
content("per-mid","Persona Builder · In the middle","Three Steps, Locked to the ICP",
 row(card("1 · Decide Who Exists",["Claude lists the people involved in the purchase","The count follows the analysis; there is no preset number","Overlapping roles are merged","Each gets a priority, purchasing role, situations and prompt share"],"calc")
    +card("2 · Write Each Profile",["One Claude call per persona","13 sections for people who buy or use","A slim 7-section profile for pure influencers","Evidence labels only in the evidence table"],"calc")
    +card("3 · Report and Check",["Evidence report and research gaps","Six acceptance checks run automatically and show Pass or Fail","If it stops part way, Resume continues"],"calc"))
 +band("Locked to the ICP","The build stops if a persona or profile uses a situation ID or segment the ICP does not contain.",True)
 +band("Prompt share","A percentage of the prompt budget per persona, from purchasing role and existence confidence. Shares sum to 100%."))
content("per-out","Persona Builder · Outputs","A Portfolio, and What Each Persona Asks",
 row(card("The Portfolio",["Persona table: priority, role, influence, can block","Prompt share per persona","Buying committee: who initiates, pays, evaluates, blocks and uses","ICP segment mapping","Roles considered and merged"],"out")
    +card("Each Profile",["Questions they ask: Learn, Problem and Buy for each situation","Language: what the buyer calls it against what we call it","Where they look and who they trust","Objections, each tied to a Buy question","Prospecting filters; evidence and confidence"],"out"))
 +band("Saved automatically","As “Company Personas” when the build finishes. Open it again under Saved Personas.")
 +band("Push to The Night Ventures","Adds every persona next to the existing ones as B1, B2 and so on, and stores the full portfolio. A repeat push updates them in place.",True))

# Prompts
section("sec-pr","Step 3","Prompt Builder","Writes the prompts each persona would type into an AI assistant, for you to review and approve.")
content("pr-in","Prompt Builder · Inputs","The Saved ICP and Personas, Plus Four Things You Set",
 row(card("From the ICP",["Buyer situations and their stage weights","Competitor names, without the detail in brackets","Question variables and the priority values under them","The one-line customer summary"],"in")
    +card("From the Personas",["Prompt share and the situations that apply","Seed questions by situation and stage","Buyer words to use; our words to ban","Objections"],"in")
    +card("Set Here",["Tracked brands: pre-filled, you add the domains","Persona Mix: a total (default 200) and a weight per persona","Your own prompts as a style reference (optional)","Generation settings"],"in"))
 +band("Before you push","Add the own brand’s website domain. Without it, tests cannot tell whether your site was retrieved or cited.",True))
content("pr-mix","Prompt Builder · In the middle","Persona Mix Sets How Many Prompts Each Persona Gets",
 flow(chip("Total","in")+op("×")+chip("Persona weight","in")+op("›")+chip("Persona target","calc")+op("×")+chip("Situation weight","in")+op("×")+chip("Stage weight","in")+op("›")+chip("Cell target","calc"))
 +row(card("Weights",["Start from the prompt share the personas carry","Any numbers; only the proportion counts","Reset to persona shares restores them","Changing a weight never deletes a prompt"],"in")
     +card("Targets",["Total × weight, rounded so targets add up to the total","Each persona shows “N to write” or “N over target”","Rupert at 200: founder 164, advisor 20, investor 8, team member 8"],"calc")
     +card("Trim to Target",["Appears on a persona that is over target","Shows how many it will reject, by cell, before doing it","Takes from the fullest cells first, so coverage stays even","Rejected prompts stay stored"],"calc"))
 +band("At a small target","A target of 8 cannot cover every situation and stage. Raise the weight for fuller coverage."))
content("pr-mid","Prompt Builder · In the middle","The Tool Decides the Mix; Claude Writes the Words",
 flow(chip("Cell target","calc")+op("›")+chip("Slots","calc")+op("›")+chip("Claude writes","calc")+op("›")+chip("Checks","calc")+op("›")+chip("Prompts","out"))
 +row(card("The Tool Builds the Slots",["Batches of 50, largest shortfall first","At least 30% recommendation, about 20% comparison","Half of Buy cells are recommendation","Half carry a variable; 10% name an alternative"],"calc")
     +card("Claude Fills Them",["First person, 8 to 40 words, the buyer’s words, never the brand","Clear on its own who is asking and in which market","A problem plus a request for help, not a category name","Your style examples set length and tone, never the topic"],"calc")
     +card("Then It Checks",["Banned terms, length, slot match","Duplicates judged across all personas","Could it be misread as another field? Rewritten","Three attempts, then the cell is exhausted"],"calc"))
 +band("One cell","A prompt belongs to one persona, one situation and one stage: Learn, Problem or Buy."))
content("pr-out","Prompt Builder · Outputs","Reviewed Prompts, Ready to Test",
 row(card("Every Prompt Has",["One persona, one situation, one stage","A type: Question, Comparison or Recommendation","Variables and named brands","A status: Draft, Approved or Rejected"],"out")
    +card("Review",["Coverage grid: have / target for every cell","Approve all drafts: skips prompts marked “may be misread”","Check existing prompts: flags ambiguous ones back to Draft","Filters, inline edit, export as CSV or JSON"],"out"))
 +band("Push to The Night Ventures","Approved and rejected prompts go with their status; drafts stay behind. Brands already in The Night Ventures are kept as they are; new ones are added; none are removed.",True)
 +band("Changed wording","A prompt pushed again with different words loses its earlier test runs. A prompt left out of a push is not touched."))

# Tests
th=lambda t,w: f'<th style="text-align:left;background:{NAVY};color:{ONNAVY};font-size:24px;font-weight:400;padding:12px 16px;width:{w}px">{t}</th>'
def tr(cells,alt): 
    bg=PAGE if alt else CARD
    return "<tr>"+"".join(f'<td style="background:{bg};color:{NAVY if i==0 else BODY};font-size:24px;font-weight:400;padding:12px 16px;line-height:1.3">{c}</td>' for i,c in enumerate(cells))+"</tr>"
rows=[("Named","You are in the answer","Protect it; check how often"),("Cited, not named","Your page was a source","Tie the brand to the claim"),("Retrieved, not cited","Found, then not used","Improve that page"),("Absent","It searched and never found you","Write the article"),("No search","Answered from memory","Deprioritise the prompt")]
table=f'<table style="width:1000px;border-collapse:collapse"><tr>{th("Outcome",300)}{th("What happened",360)}{th("What to do",340)}</tr>'+"".join(tr(r,i%2==1) for i,r in enumerate(rows))+"</table>"
content("tests","Step 4 · Prompt Tests","What Each AI Engine Did With Each Prompt",
 row(card("How a Test Runs",["ChatGPT app 3 runs, Gemini app 2 runs per prompt","Claude and Perplexity by API, off until ticked","About $0.004 per app run; $10 monthly cap","The cost is shown before it starts","Keep the tab open while it runs"],"calc",flex="0 0 600px")
    +f'<div style="flex:1;display:flex;flex-direction:column;gap:14px">{tag("out")}{table}</div>',40)
 +band("Recorded per run","Whether it searched, the searches it ran, sites retrieved and cited, and for every tracked brand: retrieved, cited, named.",True))

# Saved
rows2=[("ICP Builder","“Company ICP”, automatically","Short ICP paragraph · shared traits · both documents"),("Persona Builder","“Company Personas”, automatically","Personas B1, B2 … · full portfolio"),("Prompt Builder","A named set, with Save Prompts","Prompts with their status · new brands only")]
table2=f'<table style="width:1664px;border-collapse:collapse"><tr>{th("Tool",360)}{th("Saved as",560)}{th("Push to The Night Ventures writes",744)}</tr>'+"".join(tr(r,i%2==1) for i,r in enumerate(rows2))+"</table>"
content("saved","Reference","Where Results Are Kept",
 table2
 +row(card("Reopening",["Saved ICPs: Open restores the documents and the inputs","Use This ICP reopens the personas built on it","Use These Personas loads them into the Prompt Builder"])
     +card("Good to Know",["Saved items are visible to anyone the page is shared with","Regenerating updates the same saved entry","Tracked brands are maintained in The Night Ventures; a push never renames or removes one"]))
 +band("Not built yet","Grouping tested prompts into article briefs, which would feed AEO Generation.",True))

# Closing
steps=["Update the company documents","ICP Builder: upload, Analyse, Generate","Read the blocking unknowns, then Push","Persona Builder: Use This ICP, Build Personas","Read the six checks, then Push","Prompt Builder: brand domains, Persona Mix, Generate","Check existing prompts, approve, Save, Push","Prompt Tests: select, check the cost, run"]
lis="".join(f'<li>{s}</li>' for s in steps)
add("run-order",f'''<section id="run-order" style="background:{NAVY};color:{ONNAVY};{FONT};padding:128px;display:flex;flex-direction:column;gap:36px">
<p style="font-size:26px;font-weight:400;letter-spacing:4px;color:{ORANGE}">TO RUN IT AGAIN</p>
<h2 style="font-size:80px;font-weight:200;line-height:1.08;color:{ONNAVY}">Run Order</h2>
<ol style="font-size:32px;font-weight:400;line-height:1.5;color:{ONNAVY};padding-left:48px">{lis}</ol>
<p style="font-size:28px;font-weight:400;line-height:1.4;color:{SOFT};width:1400px">Each step reads the saved result of the one before. After a change upstream, rebuild and re-save what depends on it.</p>
</section>''')

for id,html in slides: open(f"project/slides/{id}.html","w").write(html+"\n")
deck={"v":4,"createdOnFiles":{"v":1,"at":"2026-11-11T06:10:33Z"},"lists":"css","title":"How the ICP, Persona and Prompt Builders Work","order":order,"cover":"cover",
 "sections":{"s1":{"description":"What the flow is and how the four steps connect.","start":"cover"},"s2":{"description":"ICP Builder: inputs, how uploaded files are read, the two Claude passes and the two documents it produces.","start":"sec-icp"},"s3":{"description":"Persona Builder: inputs, the three build steps and the portfolio it produces.","start":"sec-per"},"s4":{"description":"Prompt Builder: inputs, the persona mix, how slots are built and filled, and the reviewed prompts.","start":"sec-pr"},"s5":{"description":"Testing, where results are kept, and the order to run everything in.","start":"tests"}},
 "faces":{"inter":{"family":"Inter","href":"https://fonts.googleapis.com/css2?family=Inter:wght@200;400&display=swap"}},"designSystems":[]}
json.dump(deck,open("project/deck.json","w"),indent=1)
import re
for id,html in slides:
    n=len(re.findall(r"<(?!/)[a-z0-9-]+",html)); small=[m for m in re.findall(r"font-size:(\d+)px",html) if int(m)<24]
    bad=re.findall(r"margin|class=|var\(|\dem[;\"]",html)
    print(id,n,"els","SMALL" if small else "","BAD" if bad else "")
