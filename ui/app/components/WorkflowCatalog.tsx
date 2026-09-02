"use client";

import { useEffect, useState, useTransition } from "react";
import { listWorkflowCatalog, validateWorkflowById, runExecution } from "../actions";
import type { CatalogEntry, ValidateResult, ExecutionUiResult } from "../actions";
import Reveal from "./Reveal";

type Category = CatalogEntry["category"];
const CATEGORIES: { key: Category | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "core", label: "Core" },
  { key: "feature", label: "Feature" },
  { key: "leverage", label: "Leverage" },
  { key: "integration", label: "Integration" },
];

const CATEGORY_COLOR: Record<Category, string> = {
  core: "bg-ink text-cream",
  feature: "bg-[#4A90D9] text-cream",
  leverage: "bg-[#A13F2A] text-cream",
  integration: "bg-[#7A3AA1] text-cream",
};

function labelize(key: string): string {
  return key.replace(/-/g, " ");
}

type RowResult = { type: "validate"; data: ValidateResult } | { type: "execute"; data: ExecutionUiResult };

export default function WorkflowCatalog() {
  const [entries, setEntries] = useState<CatalogEntry[] | null>(null);
  const [filter, setFilter] = useState<Category | "all">("all");
  const [results, setResults] = useState<Record<string, RowResult>>({});
  const [pending, setPending] = useState<Record<string, "validate" | "execute" | undefined>>({});
  const [, startTransition] = useTransition();

  useEffect(() => {
    listWorkflowCatalog().then(setEntries);
  }, []);

  function onValidate(workflowId: string) {
    setPending((p) => ({ ...p, [workflowId]: "validate" }));
    startTransition(async () => {
      const data = await validateWorkflowById(workflowId);
      setResults((r) => ({ ...r, [workflowId]: { type: "validate", data } }));
      setPending((p) => ({ ...p, [workflowId]: undefined }));
    });
  }

  function onExecute(workflowId: string) {
    setPending((p) => ({ ...p, [workflowId]: "execute" }));
    startTransition(async () => {
      const data = await runExecution(workflowId);
      setResults((r) => ({ ...r, [workflowId]: { type: "execute", data } }));
      setPending((p) => ({ ...p, [workflowId]: undefined }));
    });
  }

  const visible = entries?.filter((e) => filter === "all" || e.category === filter) ?? [];

  return (
    <Reveal className="block">
      <section id="catalog" className="py-24 px-8 lg:px-14">
        <div className="max-w-[640px] mx-auto text-center mb-10">
          <div className="font-mono text-[10px] tracking-[0.14em] uppercase text-dim mb-2.5">
            {entries ? `${entries.length} Live Workflows` : "Loading…"}
          </div>
          <h2 className="font-serif text-[42px]">Workflow catalog</h2>
          <span className="font-cursive text-gold text-[30px] block mt-1">Every one, real.</span>
          <p className="text-sm text-dim mt-3">
            Validate or execute any workflow this project has created on KeeperHub, straight from
            the browser — the same <code className="font-mono text-xs bg-cream-hover px-1">deepCheck</code>{" "}
            validation and live execution the CLI runs, no simulated data.
          </p>
        </div>

        <div className="flex gap-2 justify-center mb-8 flex-wrap">
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              onClick={() => setFilter(c.key)}
              className={`font-mono text-[11px] uppercase tracking-[0.03em] px-3.5 py-2 border-[1.5px] border-ink rounded-[3px] transition-colors ${
                filter === c.key ? "bg-ink text-cream" : "bg-transparent hover:bg-cream-hover"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="max-w-[820px] mx-auto border-[1.5px] border-ink">
          {!entries && <div className="p-8 text-center font-mono text-xs text-dim">Loading catalog…</div>}
          {entries &&
            visible.map((entry, i) => (
              <div
                key={entry.workflowId}
                className={`flex flex-col gap-2 p-4 ${i !== visible.length - 1 ? "border-b-[1.5px] border-ink" : ""}`}
              >
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className={`font-mono text-[9px] uppercase tracking-[0.06em] px-2 py-0.5 rounded-[2px] ${CATEGORY_COLOR[entry.category]}`}>
                      {entry.category}
                    </span>
                    <span className="font-serif text-[17px] capitalize">{labelize(entry.key)}</span>
                    <span className="font-mono text-[10px] text-dim">{entry.workflowId}</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => onValidate(entry.workflowId)}
                      disabled={!!pending[entry.workflowId]}
                      className="font-mono text-[10px] uppercase tracking-[0.03em] px-3 py-1.5 border-[1.5px] border-ink rounded-[3px] bg-transparent hover:bg-cream-hover disabled:opacity-40 transition-colors"
                    >
                      {pending[entry.workflowId] === "validate" ? "checking…" : "Validate"}
                    </button>
                    <button
                      onClick={() => onExecute(entry.workflowId)}
                      disabled={!!pending[entry.workflowId]}
                      className="font-mono text-[10px] uppercase tracking-[0.03em] px-3 py-1.5 border-[1.5px] border-ink rounded-[3px] bg-gold hover:bg-gold-hover disabled:opacity-40 transition-colors"
                    >
                      {pending[entry.workflowId] === "execute" ? "running…" : "Execute"}
                    </button>
                  </div>
                </div>
                {results[entry.workflowId] && <ResultLine result={results[entry.workflowId]!} />}
              </div>
            ))}
        </div>
      </section>
    </Reveal>
  );
}

function ResultLine({ result }: { result: RowResult }) {
  if (result.type === "validate") {
    const d = result.data;
    if (!d.ok) return <div className="font-mono text-xs text-log-error">✗ {d.error}</div>;
    return (
      <div className={`font-mono text-xs ${d.valid ? "text-log-ok" : "text-log-error"}`}>
        {d.valid ? "✓" : "✗"} valid: {String(d.valid)} · nodes: {d.nodeCount}
        {d.errors ? ` · errors: ${JSON.stringify(d.errors)}` : ""}
      </div>
    );
  }
  const d = result.data;
  if (!d.ok) return <div className="font-mono text-xs text-log-error">✗ {d.error}</div>;
  return (
    <div className="font-mono text-xs text-log-ok">
      ✓ {d.status} · execution {d.executionId}
      {d.transactions.length > 0 && (
        <span className="block mt-1 text-dim">
          {d.transactions.map((t) => t.hash).join(", ")}
        </span>
      )}
    </div>
  );
}
