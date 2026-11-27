import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check, ChevronDown, ChevronRight, Loader2, RefreshCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FORM_LABELS } from "../../../../lib/fan-out/core.js";
import { CARD_ACTIONS, HOW, REASONS } from "../../../../lib/fan-out/groups.js";

const inputClass = "h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring";
const SIGNAL_TONE = { Strong: "border-emerald-300 bg-emerald-50 text-emerald-800", Occasional: "border-sky-300 bg-sky-50 text-sky-800", Noise: "border-border bg-muted text-muted-foreground" };
const DIFFICULTY_TONE = { Open: "border-emerald-300 bg-emerald-50 text-emerald-800", Contested: "border-amber-300 bg-amber-50 text-amber-800", Dominated: "border-rose-300 bg-rose-50 text-rose-800" };

function Chip({ children, tone = "border-border bg-muted text-muted-foreground" }) {
  return <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] ${tone}`}>{children}</span>;
}

/** One line of a card: what it is, who set it (the app's count, or the AI's estimate), and the content. */
function Line({ label, by, children }) {
  return (
    <div className="grid gap-x-3 gap-y-0.5 py-1.5 text-xs sm:grid-cols-[11rem_1fr]">
      <p className="text-muted-foreground">{label}{by === "ai" && <span className="ml-1 rounded bg-muted px-1 text-[10px] uppercase tracking-wider">estimate</span>}</p>
      <div className="min-w-0 text-foreground">{children}</div>
    </div>
  );
}

const pageLink = (p) => <a className="underline underline-offset-2" href={p.url} target="_blank" rel="noreferrer">{p.title || p.domain}</a>;

function Measured({ g }) {
  return (
    <>
      <Line label="ChatGPT searched">
        <ul className="space-y-0.5 font-mono text-[11px]">
          {g.searches.slice(0, 6).map((q) => <li key={q.q}>{q.q} <span className="text-muted-foreground">· {q.runs}×</span></li>)}
          {g.searches.length > 6 && <li className="font-sans text-muted-foreground">and {g.searches.length - 6} more</li>}
        </ul>
      </Line>
      <Line label="Your standing">Named in {g.standing.named} of {g.standing.of} runs where ChatGPT searched this <span className="text-muted-foreground">· a link between the two, not a proven cause</span></Line>
      <Line label="Who wins">
        {g.whoNamed.filter((w) => !w.own).length ? g.whoNamed.filter((w) => !w.own).slice(0, 5).map((w) => `${w.name} (${w.runs})`).join(" · ") : "No other brand is named in these runs."}
        {g.cited.length > 0 && <span className="block text-muted-foreground">Cited most: {g.cited.slice(0, 4).map((p) => `${p.domain} (${p.runs})`).join(" · ")}</span>}
      </Line>
      <Line label="Triggered by">{g.triggeredBy.map((t) => `${FORM_LABELS[t.form]} prompts (${t.runs})`).join(" · ")}</Line>
    </>
  );
}

function Why({ card }) {
  if (!card.reasons?.length && !card.why) return <span className="text-muted-foreground">No reason could be given from what was read.</span>;
  return (
    <>
      <span className="flex flex-wrap gap-1">{(card.reasons || []).map((r) => <Chip key={r}>{REASONS[r]?.label || r}</Chip>)}</span>
      {card.why && <span className="mt-1 block">{card.why}</span>}
    </>
  );
}

function How({ card, mine }) {
  return (
    <>
      {mine ? HOW[card.how].replace("Their own page is", "Your own page is").replace("name them", "name you").replace("knew them", "knew you") : HOW[card.how]}
      {(card.how_pages || []).length > 0 && <span className="block text-muted-foreground">{card.how_pages.slice(0, 3).map((p, i) => <React.Fragment key={p.url || i}>{i > 0 && " · "}{p.url ? pageLink(p) : p.domain}</React.Fragment>)}</span>}
      {(card.pages || []).some((p) => !p.ok) && <span className="block text-amber-800">Could not be read: {card.pages.filter((p) => !p.ok).map((p) => `${p.domain} (${p.error})`).join("; ")}</span>}
    </>
  );
}

/**
 * An Opportunity: the app's numbers, the AI's estimate of why the winner wins, what a page must cover,
 * and the action. "Write this" sends a new article to AEO Generation; the other actions stay here as to-dos.
 */
function OpportunityCard({ g, card, others, pillars, companyId, working, onWrite, onChange, onPush }) {
  const [cover, setCover] = useState((card?.cover || []).join("\n"));
  const [mergeWith, setMergeWith] = useState("");
  useEffect(() => setCover((card?.cover || []).join("\n")), [card?.id, card?.cover]);
  const closed = card && card.status !== "open";
  const page = card?.your_page || {};
  // A page that is already live is fixed by hand: a second article would compete with it.
  const hasLivePage = ["live", "cited"].includes(page.kind);
  return (
    <div className={`rounded-md border px-3 py-2 ${closed ? "border-emerald-300" : "border-border"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 basis-60 text-sm font-medium text-foreground">{g.label}</p>
        {g.isNew && <Chip tone="border-violet-300 bg-violet-50 text-violet-800">New</Chip>}
        {g.core && <Chip>80/20</Chip>}
        <Chip tone={SIGNAL_TONE[g.signal.label]}>{g.signal.label} · {g.signal.x} of {g.signal.n} runs</Chip>
        <Chip tone={DIFFICULTY_TONE[g.difficulty]}>{g.difficulty}</Chip>
        <Chip>Score {g.score}</Chip>
      </div>
      <div className="mt-1 divide-y divide-border/60">
        <Measured g={g} />
        {card && (
          <>
            <Line label="How they got there"><How card={card} /></Line>
            <Line label="Why" by="ai"><Why card={card} /></Line>
            <Line label="Your page">
              {page.kind === "none" || !page.kind ? "None found: nothing of yours covers this." : page.kind === "cited" ? <>{pageLink(page)} <span className="text-muted-foreground">· {page.note}</span></> : <>{page.code} · {page.title} <span className="text-muted-foreground">· {page.note}</span></>}
            </Line>
            <Line label="What to cover" by="ai">
              <Textarea className="min-h-[92px] text-xs md:text-xs" value={cover} disabled={working || closed} onChange={(e) => setCover(e.target.value)} onBlur={() => { const next = cover.split("\n").map((l) => l.replace(/^[-*]\s*/, "").trim()).filter(Boolean).slice(0, 6); if (next.join("\n") !== (card.cover || []).join("\n")) onChange(card.id, { cover: next }); }} />
              <span className="text-muted-foreground">3 to 6 lines, one per line. This becomes the outline of the brief; your hot takes are added on the brief.</span>
            </Line>
            <Line label="Action" by="ai">
              <span className="flex flex-wrap items-center gap-2">
                <select className={inputClass} value={card.action} disabled={working || closed} onChange={(e) => onChange(card.id, { action: e.target.value })} aria-label="Action">
                  {Object.entries(CARD_ACTIONS).filter(([k]) => k !== "new_article" || !hasLivePage).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
                <span className="min-w-0 basis-full sm:flex-1 sm:basis-0">{card.action_line}</span>
              </span>
            </Line>
          </>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        {!card && <Button type="button" size="sm" variant="outline" disabled={working} onClick={() => onWrite(g.id)}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Analyze this one</Button>}
        {card && card.status === "open" && card.action === "new_article" && g.other && <span className="text-muted-foreground">These searches fit no group, so they are not one topic to write on. Analyze again to regroup them.</span>}
        {card && card.status === "open" && card.action === "new_article" && !g.other && (
          <>
            {page.kind !== "topic" && (
              <>
                <label className="text-muted-foreground" htmlFor={`fo-theme-${card.id}`}>Theme</label>
                <select id={`fo-theme-${card.id}`} className={inputClass} value={card.pillar_id || ""} disabled={working} onChange={(e) => onChange(card.id, { pillar_id: e.target.value || null })}>
                  <option value="">Choose…</option>
                  {pillars.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
                </select>
              </>
            )}
            {others.length > 0 && (
              <select className={inputClass} value={mergeWith} disabled={working} onChange={(e) => setMergeWith(e.target.value)} aria-label="Write together with">
                <option value="">On its own page</option>
                {others.map((o) => <option key={o.card.id} value={o.card.id}>One page with: {o.g.label.slice(0, 50)}</option>)}
              </select>
            )}
            <Button type="button" size="sm" disabled={working || (page.kind !== "topic" && !card.pillar_id)} onClick={() => onPush(card, g, mergeWith)}><Send className="mr-1.5 h-3.5 w-3.5" />Write this</Button>
            <span className="text-muted-foreground">Creates a brief in AEO Generation. Nothing is created before you click.</span>
          </>
        )}
        {card && card.status === "open" && card.action !== "new_article" && (
          <>
            <Button type="button" size="sm" variant="outline" disabled={working} onClick={() => onChange(card.id, { status: "done", acted_on_at: new Date().toISOString() })}><Check className="mr-1.5 h-3.5 w-3.5" />Done</Button>
            <span className="text-muted-foreground">{card.action === "fix_existing" ? "A page that exists is fixed by hand, not by AEO Generation. Click Done when it is." : "Off-site work is done by hand. Click Done when you are on those pages."}</span>
          </>
        )}
        {card?.status === "pushed" && <span className="text-emerald-800">Sent to <Link className="underline underline-offset-2" to={`/company/${companyId}/aeo-generation`}>AEO Generation</Link> on {new Date(card.pushed_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}{card.merged_into ? ", as one brief with another Opportunity" : ""}. It is marked Acted on when the article goes live.</span>}
        {card?.status === "acted_on" && <span className="text-emerald-800">Acted on{card.acted_url ? <>: <a className="underline underline-offset-2" href={card.acted_url} target="_blank" rel="noreferrer">{card.acted_url}</a></> : ""} · {new Date(card.acted_on_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>}
        {card?.status === "done" && <span className="text-emerald-800">Done · {new Date(card.acted_on_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} <button type="button" className="ml-1 text-muted-foreground underline underline-offset-2" disabled={working} onClick={() => onChange(card.id, { status: "open", acted_on_at: null })}>Undo</button></span>}
        {card && card.status === "open" && <button type="button" className="ml-auto text-muted-foreground underline underline-offset-2 hover:text-foreground" disabled={working} onClick={() => onWrite(g.id)}>Analyze again</button>}
      </div>
    </div>
  );
}

function WinCard({ g, card, working, onWrite }) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 basis-60 text-sm font-medium text-foreground">{g.label}</p>
        {g.isNew && <Chip tone="border-violet-300 bg-violet-50 text-violet-800">New</Chip>}
        <Chip tone={SIGNAL_TONE[g.signal.label]}>{g.signal.label} · {g.signal.x} of {g.signal.n} runs</Chip>
        <Chip tone="border-emerald-300 bg-emerald-50 text-emerald-800">Named in {g.standing.named} of {g.standing.of}</Chip>
      </div>
      <div className="mt-1 divide-y divide-border/60">
        <Measured g={g} />
        {card && (
          <>
            <Line label="How you got there"><How card={card} mine /></Line>
            <Line label="Why" by="ai"><Why card={card} /></Line>
            <Line label="Repeat this" by="ai">{card.repeat_this || "–"}</Line>
          </>
        )}
      </div>
      {!card && <Button type="button" size="sm" variant="outline" className="mt-2" disabled={working} onClick={() => onWrite(g.id)}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Analyze this one</Button>}
    </div>
  );
}

function Fold({ title, hint, children, startOpen = false }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <div>
      <button type="button" className="flex w-full items-center gap-1.5 text-left text-xs font-medium text-foreground" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}{title}
        <span className="font-normal text-muted-foreground">{hint}</span>
      </button>
      {open && <div className="mt-2 space-y-2">{children}</div>}
    </div>
  );
}

/**
 * What ChatGPT goes looking for: the Query Groups of the latest Run, as Opportunities (Open first, then by
 * opportunity score), Wins and Skips, with the cards of the top ones.
 */
export default function GroupsBlock({ run, cards, pillars, limits, signal = { occasional: 0.2 }, cutoff = 0.5, companyId, working, busy, progress, onAnalyze, onWrite, onChange, onPush }) {
  if (!run) return null;
  const g = run.groups;
  const cardOf = (id) => cards.find((c) => c.group_id === id && c.scenario_run_id === run.id) || null;
  const pushable = g.opportunities.map((x) => ({ g: x, card: cardOf(x.id) })).filter((x) => x.card && x.card.status === "open" && x.card.action === "new_article");
  const needsWork = run.ungrouped > 0 || !g.all.length;
  const pc = (v) => `${Math.round(v * 100)}%`;
  if (!run.score.searched.x) return <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-foreground">ChatGPT ran no web search in any run of this Run. It answered from memory, so no page can win these prompts through search.</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Button type="button" size="sm" variant={needsWork ? "default" : "outline"} disabled={working} onClick={onAnalyze}>
          {busy === "analyze" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}{needsWork ? "Group the searches and analyze" : "Analyze the top ones again"}
        </Button>
        <span className="text-muted-foreground">
          {g.all.length ? `${g.totalSearches} searches in ${g.all.length} Query Groups: ${g.opportunities.length} opportunities, ${g.wins.length} wins, ${g.skips.length} skipped.` : "The searches of this Run are not grouped yet."}
          {run.ungrouped > 0 && g.all.length > 0 ? ` ${run.ungrouped} new searches are not sorted yet.` : ""}
        </span>
      </div>
      {progress && <p className="flex items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900"><Loader2 className="h-3.5 w-3.5 animate-spin" />{progress}</p>}

      {g.opportunities.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-foreground">Opportunities <span className="font-normal text-muted-foreground">· ChatGPT searches this in at least {pc(signal.occasional)} of the runs, and you are named in fewer than {pc(cutoff)} of those. Open ones first, then by score (signal × the share of those runs without you). The top {limits.opportunities} are analyzed. 80/20 marks the groups that account for 80% of all searches.</span></p>
          {g.opportunities.map((x) => (
            <React.Fragment key={x.id}>
              <OpportunityCard g={x} card={cardOf(x.id)} others={pushable.filter((o) => o.g.id !== x.id)} pillars={pillars} companyId={companyId} working={working} onWrite={onWrite} onChange={onChange} onPush={onPush} />
            </React.Fragment>
          ))}
        </div>
      )}
      {g.all.length > 0 && g.opportunities.length === 0 && <p className="text-xs text-muted-foreground">No opportunity in this Run: every search ChatGPT runs often enough already names you often enough to count as a win.</p>}

      {g.wins.length > 0 && (
        <Fold title={`Wins (${g.wins.length})`} hint={`· searches where you are already named in ${pc(cutoff)} or more of the runs. The top ones are analyzed, to repeat what works.`} startOpen={g.opportunities.length === 0}>
          {g.wins.map((x) => <WinCard key={x.id} g={x} card={cardOf(x.id)} working={working} onWrite={onWrite} />)}
        </Fold>
      )}
      {g.skips.length > 0 && (
        <Fold title={`Skipped (${g.skips.length})`} hint={`· noise: ChatGPT searched this in fewer than ${pc(signal.occasional)} of the runs.`}>
          <ul className="space-y-1 text-xs">
            {g.skips.map((x) => <li key={x.id} className="rounded-md border border-border px-3 py-1.5"><span className="text-foreground">{x.label}</span> <span className="text-muted-foreground">· {x.signal.x} of {x.signal.n} runs · named in {x.standing.named} of {x.standing.of} · {x.searches.slice(0, 2).map((q) => q.q).join(" | ")}</span></li>)}
          </ul>
        </Fold>
      )}
      <p className="text-xs text-muted-foreground">The counts are the app&apos;s. Lines marked “estimate” are the AI&apos;s reading of the pages ChatGPT cited: we can see what it searched and cited, not why it chose those pages. The next Run tests the estimate.</p>
    </div>
  );
}

/** The company's Insights bank: which reasons are behind the wins, with the count behind each pattern. */
export function InsightsBlock({ insights }) {
  if (!insights.length) return null;
  const count = (tag) => {
    const rows = insights.filter((i) => i.tag === tag);
    const by = {};
    for (const i of rows) for (const r of i.reasons || []) by[r] = (by[r] || 0) + 1;
    return { n: rows.length, reasons: Object.entries(by).sort((a, b) => b[1] - a[1]) };
  };
  const yours = count("your_win");
  const theirs = count("competitor_win");
  const row = (label, c) => (
    <p><span className="font-medium text-foreground">{label}</span> <span className="text-muted-foreground">({c.n} {c.n === 1 ? "insight" : "insights"})</span>{c.reasons.length ? ": " : ""}{c.reasons.map(([r, n]) => `${REASONS[r]?.label || r} ${n}`).join(" · ")}</p>
  );
  return (
    <Fold title={`Insights bank (${insights.length})`} hint="· why brands get named, across every Scenario of this company. Counts are small at first.">
      <div className="space-y-1 text-xs">
        {row("Behind your wins", yours)}
        {row("Behind competitors' wins", theirs)}
        <ul className="mt-1 space-y-0.5 text-muted-foreground">
          {insights.slice(0, 12).map((i) => (
            <li key={i.id}>
              {new Date(i.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {i.tag === "your_win" ? "your win" : "competitor win"} · {i.brand} · “{i.search}” · {(i.reasons || []).map((r) => REASONS[r]?.label || r).join(", ")} · named in {i.counts?.named} of {i.counts?.of}
              {i.verdict ? ` · ${i.verdict === "confirmed" ? "Confirmed" : "Not confirmed"}` : ""}
            </li>
          ))}
        </ul>
      </div>
    </Fold>
  );
}
