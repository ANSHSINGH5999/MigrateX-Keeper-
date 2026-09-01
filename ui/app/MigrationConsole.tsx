"use client";

import { useState, useTransition } from "react";
import { generatePlan, runDryRun, runExecution } from "./actions";
import type { PlanResult, DryRunResult, ExecutionUiResult } from "./actions";
import Reveal from "./components/Reveal";

const DEFAULT_WALLET = "0x11F1a6f2119dB47840c7B5B45EE289CE2E64E7B2";

export default function MigrationConsole() {
  const [amount, setAmount] = useState("0.005");
  const [sourceAddress, setSourceAddress] = useState(DEFAULT_WALLET);
  const [recipientAddress, setRecipientAddress] = useState(DEFAULT_WALLET);

  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [dryRunResult, setDryRunResult] = useState<DryRunResult | null>(null);
  const [execResult, setExecResult] = useState<ExecutionUiResult | null>(null);

  const [isPlanning, startPlan] = useTransition();
  const [isDryRunning, startDryRun] = useTransition();
  const [isExecuting, startExecute] = useTransition();

  function onGeneratePlan() {
    setDryRunResult(null);
    setExecResult(null);
    startPlan(async () => {
      setPlan(await generatePlan({ amount, sourceAddress, recipientAddress }));
    });
  }

  function onDryRun() {
    if (!plan?.ok) return;
    setExecResult(null);
    startDryRun(async () => {
      setDryRunResult(await runDryRun(plan.plan));
    });
  }

  function onExecute() {
    if (!dryRunResult?.ok) return;
    startExecute(async () => {
      setExecResult(await runExecution(dryRunResult.workflowId));
    });
  }

  const canDryRun = plan?.ok === true;
  const canExecute = dryRunResult?.ok === true && dryRunResult.safeToExecute;

  return (
    <Reveal className="block">
      <section id="console" className="grid grid-cols-1 lg:grid-cols-[0.85fr_1.15fr] border-t-[1.5px] border-ink">
        <div className="border-b-[1.5px] lg:border-b-0 lg:border-r-[1.5px] border-ink px-8 lg:px-14 py-24 flex flex-col justify-center gap-4.5">
          <div className="font-mono text-[10px] tracking-[0.14em] uppercase text-dim">Live Console</div>
          <h2 className="font-serif text-[38px]">Migration console</h2>
          <span className="font-cursive text-gold text-[30px]">Preflight, not prayers.</span>
          <p className="text-[15px] text-dim max-w-[42ch]">
            Every run passes through the same three gates: generate a real plan via the Rust core,
            dry-run it against the live KeeperHub server, then — and only then — execute exactly what
            you reviewed.
          </p>
        </div>
        <div className="px-8 lg:px-14 py-24 flex flex-col gap-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <Field label="Token" value="WETH · Aave V3" readOnly />
            <Field label="Network" value="Sepolia (11155111)" readOnly />
            <Field label="Amount (WETH)" value={amount} onChange={setAmount} />
            <Field label="Wallet address" value={sourceAddress} onChange={(v) => { setSourceAddress(v); setRecipientAddress(v); }} />
          </div>
          <div className="flex gap-2.5 flex-wrap">
            <ConsoleButton onClick={onGeneratePlan} disabled={isPlanning} solid>
              {isPlanning ? "generating…" : "Generate Plan"}
            </ConsoleButton>
            <ConsoleButton onClick={onDryRun} disabled={!canDryRun || isDryRunning}>
              {isDryRunning ? "validating…" : "Dry Run"}
            </ConsoleButton>
            <ConsoleButton onClick={onExecute} disabled={!canExecute || isExecuting}>
              {isExecuting ? "executing…" : "Execute"}
            </ConsoleButton>
          </div>

          <div className="bg-ink text-cream font-mono text-xs leading-[2] p-4.5 min-h-[220px] max-h-[380px] overflow-y-auto border-[1.5px] border-ink shadow-[4px_4px_0_var(--color-gold)]">
            {!plan && <Line dim>$ awaiting input…</Line>}
            {plan && <PlanBlock result={plan} />}
            {dryRunResult && <DryRunBlock result={dryRunResult} />}
            {execResult && <ExecBlock result={execResult} />}
          </div>

          {execResult?.ok && (
            <div className="border-[1.5px] border-ink border-l-[6px] border-l-log-ok bg-cream-hover p-3.5 font-mono text-xs">
              ✓ Migration complete —{" "}
              <span className="font-bold break-all">
                {execResult.transactions[0]?.hash ?? execResult.executionId}
              </span>
            </div>
          )}
        </div>
      </section>
    </Reveal>
  );
}

function ConsoleButton({
  children,
  onClick,
  disabled,
  solid,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  solid?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex-1 min-w-[120px] font-mono text-[11px] uppercase tracking-[0.03em] px-3.5 py-3 border-[1.5px] border-ink rounded-[3px] transition-all duration-200 disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:translate-x-0 disabled:hover:translate-y-0 ${
        solid
          ? "bg-ink text-cream shadow-[4px_4px_0_var(--color-ink)] hover:bg-gold hover:text-ink hover:shadow-[4px_4px_0_var(--color-gold-hover)]"
          : "bg-transparent shadow-[4px_4px_0_var(--color-ink)] hover:bg-cream-hover hover:shadow-[4px_4px_0_var(--color-gold)]"
      } hover:-translate-x-0.5 hover:-translate-y-0.5`}
    >
      {children}
    </button>
  );
}

function Field({
  label,
  value,
  onChange,
  readOnly,
}: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  readOnly?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[10px] tracking-[0.08em] uppercase text-dim">{label}</span>
      <input
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange?.(e.target.value)}
        className={`font-mono text-[13px] px-3 py-2.5 border-[1.5px] border-ink rounded-none focus:outline-none focus:ring-2 focus:ring-gold ${
          readOnly ? "bg-cream-hover text-dim" : "bg-white"
        }`}
      />
    </label>
  );
}

function Line({ children, dim, cls }: { children: React.ReactNode; dim?: boolean; cls?: "ok" | "error" }) {
  const color = dim ? "text-[#666]" : cls === "ok" ? "text-[#68D391]" : cls === "error" ? "text-[#f08a72]" : "text-cream";
  return <div className={`whitespace-pre-wrap break-words ${color}`}>{children}</div>;
}

function PlanBlock({ result }: { result: PlanResult }) {
  if (!result.ok) return <Line cls="error">✗ {result.error}</Line>;
  return (
    <>
      <Line>
        <span className="text-gold">$</span> generate-plan
      </Line>
      <Line dim>{JSON.stringify(result.plan, null, 2)}</Line>
    </>
  );
}

function DryRunBlock({ result }: { result: DryRunResult }) {
  if (!result.ok) return <Line cls="error">✗ {result.error}</Line>;
  return (
    <>
      <Line>
        <span className="text-gold">$</span> dry-run
      </Line>
      <Line>
        workflow: <span className="text-gold">{result.workflowId}</span>
      </Line>
      <Line cls={result.safeToExecute ? "ok" : "error"}>{result.message}</Line>
    </>
  );
}

function ExecBlock({ result }: { result: ExecutionUiResult }) {
  if (!result.ok) return <Line cls="error">✗ {result.error}</Line>;
  return (
    <>
      <Line>
        <span className="text-gold">$</span> execute
      </Line>
      <Line>
        status: <span className="text-gold">{result.status}</span>
      </Line>
      <Line dim>{result.summary}</Line>
      {result.transactions.map((t) => (
        <Line key={t.hash} cls="ok">
          tx {t.hash}
        </Line>
      ))}
    </>
  );
}
