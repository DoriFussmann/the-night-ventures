import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Markdown elements, styled to sit inside a card. */
const md = {
  h1: (p) => <h3 className="mb-2 mt-1 text-base font-medium text-foreground" {...p} />,
  h2: (p) => <h4 className="mb-1.5 mt-5 text-sm font-medium text-foreground" {...p} />,
  h3: (p) => <h5 className="mb-1 mt-4 text-sm font-medium text-foreground" {...p} />,
  h4: (p) => <h6 className="mb-1 mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground" {...p} />,
  p: (p) => <p className="my-2 text-sm leading-relaxed text-foreground" {...p} />,
  ul: (p) => <ul className="my-2 list-disc space-y-1 pl-5 text-sm text-foreground" {...p} />,
  ol: (p) => <ol className="my-2 list-decimal space-y-1 pl-5 text-sm text-foreground" {...p} />,
  hr: () => <hr className="my-5 border-border" />,
  table: (p) => (
    <div className="my-3 overflow-x-auto rounded-md border border-border">
      <table className="w-full border-collapse text-left text-xs" {...p} />
    </div>
  ),
  th: (p) => <th className="whitespace-nowrap border-b border-border bg-muted px-2.5 py-1.5 font-medium text-foreground" {...p} />,
  td: (p) => <td className="border-b border-border px-2.5 py-1.5 align-top text-foreground" {...p} />,
};

function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function BuilderDocument({ title, markdown, pushedAt }) {
  if (!markdown) return null;
  const date = formatDate(pushedAt);
  return (
    <details className="rounded-md border border-border">
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-foreground">
        {title}
        {date ? <span className="ml-2 text-xs font-normal text-muted-foreground">pushed {date}</span> : null}
      </summary>
      <div className="border-t border-border px-4 pb-4 pt-2">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={md}>
          {markdown}
        </ReactMarkdown>
      </div>
    </details>
  );
}

/**
 * Read-only view of the full documents pushed from the ICP & Persona Builder.
 * They are written by the builder's push (tnv_push_icp, tnv_push_personas), never edited here.
 */
export default function BuilderDocuments({ playbook }) {
  const docs = [
    { title: "Strategic ICP", markdown: playbook.icp_strategic_md, pushedAt: playbook.icp_pushed_at },
    { title: "Operational ICP", markdown: playbook.icp_operational_md, pushedAt: playbook.icp_pushed_at },
    { title: "Persona portfolio", markdown: playbook.personas_md, pushedAt: playbook.personas_pushed_at },
  ];
  const any = docs.some((d) => d.markdown);
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-medium text-foreground">From the ICP &amp; Persona Builder</h2>
      <p className="mb-3 mt-0.5 text-xs text-muted-foreground">
        The full documents, as last pushed from the builder. Read-only here: change them in the builder and push again. Personas pushed from
        the builder appear below with codes starting with B.
      </p>
      {any ? (
        <div className="space-y-2">
          {docs.map((d) => (
            <BuilderDocument key={d.title} {...d} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Nothing has been pushed for this company yet.</p>
      )}
    </section>
  );
}
