"use client";

/**
 * Post-authentication boot sequence.
 *
 * This is a real preflight, not a themed progress bar. Every line below issues
 * an actual request and prints what came back -- the storage backend the API
 * reports, the true record counts, whether the hash chain verifies right now.
 * A check that fails prints FAIL in hazard red and stays on screen; the
 * operator reaches the console knowing exactly which subsystem is degraded
 * rather than discovering it three clicks later on an empty panel.
 *
 * That constraint is the whole point. A boot screen that always succeeds is
 * decoration, and decoration that imitates a diagnostic is worse than none in
 * a tool whose product claim is provenance.
 *
 * Escape, Enter or a click skips to the console. It also auto-advances shortly
 * after the last check settles, so the sequence never blocks an analyst who
 * has seen it a hundred times.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../lib/api";
import { ThreatGlobe } from "./viz/ThreatGlobe";

type CheckState = "pending" | "running" | "ok" | "warn" | "fail";

interface Check {
  id: string;
  label: string;
  /** Resolves to the value printed on the right, or throws to fail the line. */
  run: () => Promise<{ value: string; state?: CheckState }>;
}

interface BootSequenceProps {
  operator: string;
  onComplete: () => void;
}

const CHECKS: Check[] = [
  {
    id: "link",
    label: "api endpoint",
    run: async () => {
      const h = await apiFetch<any>("/health");
      return { value: h.platform ?? "reachable" };
    },
  },
  {
    id: "engine",
    label: "llr fusion engine",
    run: async () => {
      const e = await apiFetch<any>("/api/v1/config/engine");
      return { value: `${e.model_version} / ${e.feature_count} features` };
    },
  },
  {
    id: "store",
    label: "evidence ledger",
    run: async () => {
      const e = await apiFetch<any>("/api/v1/config/engine");
      return { value: `${e.storage_backend} authoritative` };
    },
  },
  {
    id: "chain",
    label: "sha-256 audit chain",
    run: async () => {
      const a = await apiFetch<any>("/api/v1/audit/verify");
      return a.chain_valid
        ? { value: `intact / ${a.total_records} records` }
        : { value: "CHAIN BROKEN", state: "fail" as CheckState };
    },
  },
  {
    id: "actors",
    label: "threat actor index",
    run: async () => {
      const a = await apiFetch<any[]>("/api/v1/actors");
      return { value: `${a.length} tracked` };
    },
  },
  {
    id: "artifacts",
    label: "artifact store",
    run: async () => {
      const e = await apiFetch<any[]>("/api/v1/evidence");
      const retracted = e.filter((x) => x.retracted_at).length;
      return {
        value: retracted
          ? `${e.length} sealed / ${retracted} retracted`
          : `${e.length} sealed`,
      };
    },
  },
  {
    id: "queue",
    label: "attribution queue",
    run: async () => {
      const h = await apiFetch<any[]>("/api/v1/hypotheses");
      const open = h.filter((x) => x.status === "PROPOSED").length;
      return {
        value: open ? `${open} awaiting review` : `${h.length} scored`,
        state: open ? ("warn" as CheckState) : undefined,
      };
    },
  },
  {
    id: "graph",
    label: "graph projection",
    run: async () => {
      // Neo4j is never provisioned in the desktop or demo deployments, so this
      // reports the fallback plainly instead of implying a projection exists.
      await apiFetch<any>("/api/v1/graph");
      return { value: "relational fallback", state: "warn" as CheckState };
    },
  },
];

const GLYPH = { pending: " ", running: "*", ok: "OK", warn: "--", fail: "!!" };

function stateColor(s: CheckState) {
  switch (s) {
    case "ok":
      return "text-netra-valid";
    case "warn":
      return "text-netra-amber";
    case "fail":
      return "text-netra-red";
    case "running":
      return "text-netra-purple";
    default:
      return "text-netra-subtle";
  }
}

export const BootSequence: React.FC<BootSequenceProps> = ({ operator, onComplete }) => {
  const [states, setStates] = useState<Record<string, CheckState>>(() =>
    Object.fromEntries(CHECKS.map((c) => [c.id, "pending" as CheckState]))
  );
  const [values, setValues] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const finished = useRef(false);

  // onComplete is called from timers and key handlers; the ref keeps those
  // callbacks stable without re-running the boot effect when the parent
  // re-renders with a new function identity.
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;

  const skip = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    completeRef.current();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      // Checks are launched on a stagger so the list reads as a sequence
      // rather than eight lines resolving in one frame. They still run
      // concurrently -- this is presentation pacing, not artificial delay on
      // the requests themselves.
      await Promise.all(
        CHECKS.map(
          (check, i) =>
            new Promise<void>((resolve) => {
              setTimeout(async () => {
                if (cancelled) return resolve();
                setStates((s) => ({ ...s, [check.id]: "running" }));
                try {
                  const res = await check.run();
                  if (cancelled) return resolve();
                  setValues((v) => ({ ...v, [check.id]: res.value }));
                  setStates((s) => ({ ...s, [check.id]: res.state ?? "ok" }));
                } catch (err: any) {
                  if (cancelled) return resolve();
                  setValues((v) => ({
                    ...v,
                    [check.id]: err?.message?.slice(0, 42) ?? "unreachable",
                  }));
                  setStates((s) => ({ ...s, [check.id]: "fail" }));
                }
                resolve();
              }, 160 + i * 190);
            })
        )
      );

      if (cancelled) return;
      setDone(true);
      // Brief hold so the completed board is readable, then hand over.
      setTimeout(skip, 1100);
    }

    boot();
    return () => {
      cancelled = true;
    };
  }, [skip]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter" || e.key === " ") skip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [skip]);

  const settled = CHECKS.filter((c) => states[c.id] !== "pending" && states[c.id] !== "running");
  const pct = Math.round((settled.length / CHECKS.length) * 100);
  const failures = CHECKS.filter((c) => states[c.id] === "fail").length;

  return (
    <div
      className="fixed inset-0 z-50 bg-netra-bg text-netra-text flex flex-col cursor-pointer select-none"
      onClick={skip}
      role="status"
      aria-live="polite"
      aria-label="System boot sequence"
    >
      <div className="absolute inset-0 blueprint-bg pointer-events-none" aria-hidden="true" />
      <div
        className="absolute -right-32 top-1/2 -translate-y-1/2 opacity-30 pointer-events-none hidden lg:block"
        aria-hidden="true"
      >
        <ThreatGlobe size={620} arcCount={9} interactive={false} />
      </div>

      <div className="relative flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-3xl console-boot">
          {/* Banner */}
          <div className="flex items-end justify-between border-b border-netra-border pb-3 mb-5">
            <div>
              <div className="telemetry-label bracketed mb-1.5">System Preflight</div>
              <h1
                className="font-display uppercase leading-[0.85] tracking-tightest text-netra-text"
                style={{ fontSize: "clamp(2rem, 5vw, 3.4rem)" }}
              >
                Netra<span className="text-netra-purple">/X</span>
              </h1>
            </div>
            <dl className="text-right font-mono text-[10px] leading-relaxed">
              <div>
                <dt className="telemetry-label">Operator</dt>
                <dd className="text-netra-text">{operator}</dd>
              </div>
            </dl>
          </div>

          {/* Check list */}
          <ul className="font-mono text-[11.5px] leading-[1.9] space-y-0">
            {CHECKS.map((c, i) => {
              const st = states[c.id];
              const val = values[c.id];
              return (
                <li
                  key={c.id}
                  className={`flex items-baseline gap-2 transition-opacity duration-200 ${
                    st === "pending" ? "opacity-25" : "opacity-100"
                  }`}
                  style={{ transitionDelay: `${i * 20}ms` }}
                >
                  <span className={`shrink-0 ${stateColor(st)}`}>
                    [
                    <span className={st === "running" ? "caret-blink" : ""}>
                      {GLYPH[st].padEnd(2, " ")}
                    </span>
                    ]
                  </span>
                  <span className="text-netra-muted shrink-0">{c.label}</span>
                  {/* Leader dots, drawn with a repeating border so the column
                      of values stays flush regardless of label length. */}
                  <span
                    className="flex-1 border-b border-dotted border-netra-border/70 translate-y-[-3px] min-w-[1rem]"
                    aria-hidden="true"
                  />
                  <span
                    className={`shrink-0 text-right ${
                      st === "fail"
                        ? "text-netra-red"
                        : st === "warn"
                        ? "text-netra-amber"
                        : "text-netra-text"
                    }`}
                  >
                    {val ?? (st === "running" ? "..." : "")}
                  </span>
                </li>
              );
            })}
          </ul>

          {/* Progress */}
          <div className="mt-6 pt-4 border-t border-netra-border">
            <div className="flex items-center justify-between telemetry-label mb-2">
              <span>
                {done
                  ? failures
                    ? `Preflight complete / ${failures} subsystem${failures > 1 ? "s" : ""} degraded`
                    : "Preflight complete"
                  : "Running preflight"}
              </span>
              <span className="tabular-nums text-netra-text">{pct}%</span>
            </div>

            {/* Segmented meter -- one segment per check, so the bar is a
                readout of the list above rather than an unrelated animation. */}
            <div className="flex gap-px h-1.5">
              {CHECKS.map((c) => {
                const st = states[c.id];
                return (
                  <span
                    key={c.id}
                    className={`flex-1 transition-colors duration-300 ${
                      st === "ok"
                        ? "bg-netra-valid"
                        : st === "warn"
                        ? "bg-netra-amber"
                        : st === "fail"
                        ? "bg-netra-red"
                        : st === "running"
                        ? "bg-netra-purple live-dot"
                        : "bg-netra-border"
                    }`}
                  />
                );
              })}
            </div>

            <p className="mt-4 telemetry-label">
              {done ? "Entering console" : "Standby"}
              <span className="caret-blink text-netra-purple">_</span>
              <span className="float-right normal-case tracking-normal text-netra-subtle">
                press ESC to skip
              </span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
