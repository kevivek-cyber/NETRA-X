"use client";

/**
 * Live audit tail.
 *
 * Streams the real append-only chain from /api/v1/audit -- action, resource,
 * and the truncated payload digest that was written for it. Nothing here is
 * synthesised: if the ledger is quiet, the panel says the ledger is quiet
 * rather than inventing traffic to look busy, which is the failure mode this
 * whole product exists to argue against.
 *
 * Polls rather than subscribes because the API exposes no event stream. The
 * interval is deliberately slow -- this is a peripheral awareness panel, and
 * hammering the endpoint to make it feel more "live" would cost the analyst
 * real query latency for a cosmetic gain.
 */

import React, { useEffect, useRef, useState } from "react";
import { Radio } from "lucide-react";
import { apiFetch } from "../../lib/api";

interface AuditRow {
  id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  payload_hash: string;
  created_at: string;
}

interface ActivityFeedProps {
  /** Poll period in ms. */
  intervalMs?: number;
  limit?: number;
  className?: string;
}

/** Hazard-red for destructive actions, amber for review, phosphor otherwise. */
function actionTone(action: string) {
  const a = action.toUpperCase();
  if (a.includes("DELETE") || a.includes("RETRACT") || a.includes("REJECT")) {
    return "text-netra-red";
  }
  if (a.includes("REVIEW") || a.includes("ARCHIVE") || a.includes("INSUFFICIENT")) {
    return "text-netra-amber";
  }
  if (a.includes("ACCEPT") || a.includes("CREATE") || a.includes("INGEST")) {
    return "text-netra-valid";
  }
  return "text-netra-purple";
}

function hhmmss(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--:--";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

export const ActivityFeed: React.FC<ActivityFeedProps> = ({
  intervalMs = 15000,
  limit = 12,
  className = "",
}) => {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chainValid, setChainValid] = useState<boolean | null>(null);
  // Ids seen on the previous poll, so only genuinely new rows animate in.
  const seen = useRef<Set<string>>(new Set());
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await apiFetch<any>("/api/v1/audit");
        if (cancelled) return;
        const logs: AuditRow[] = (res.logs ?? []).slice(0, limit);

        const incoming = new Set<string>();
        for (const l of logs) {
          if (!seen.current.has(l.id)) incoming.add(l.id);
        }
        // First load is not "new" -- highlighting the entire backlog on mount
        // would make a quiet ledger look like a burst of activity.
        if (seen.current.size > 0 && incoming.size > 0) {
          setFresh(incoming);
          setTimeout(() => !cancelled && setFresh(new Set()), 2000);
        }
        for (const l of logs) seen.current.add(l.id);

        setRows(logs);
        setChainValid(Boolean(res.chain_valid));
        setError(null);
      } catch (err: any) {
        if (cancelled) return;
        setError(err?.message ?? "Audit endpoint unreachable");
      }
    }

    poll();
    const t = setInterval(poll, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [intervalMs, limit]);

  return (
    <section className={`border border-netra-border bg-netra-card ${className}`}>
      <header className="flex items-center gap-2 border-b border-netra-border px-4 h-10">
        <Radio
          className={`w-3.5 h-3.5 ${error ? "text-netra-red" : "text-netra-valid live-dot"}`}
        />
        <h2 className="telemetry-label text-netra-text">Audit Stream</h2>
        <span className="ml-auto telemetry-label">
          {chainValid === null
            ? ""
            : chainValid
            ? <span className="text-netra-valid">CHAIN INTACT</span>
            : <span className="text-netra-red">CHAIN BROKEN</span>}
        </span>
      </header>

      <div className="max-h-[260px] overflow-y-auto thin-scroll">
        {error ? (
          <p className="p-4 font-mono text-[11px] text-netra-red">
            {error}
          </p>
        ) : rows === null ? (
          <div className="p-4 space-y-2" role="status" aria-label="Loading audit stream">
            {Array.from({ length: 5 }).map((_, i) => (
              <span
                key={i}
                className={`block skeleton-shimmer skel-delay-${i % 6}`}
                style={{ height: 8, width: `${88 - i * 11}%` }}
              />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="p-4 font-mono text-[11px] text-netra-subtle">
            No audit events recorded.
          </p>
        ) : (
          <ul className="divide-y divide-netra-border font-mono text-[10.5px]">
            {rows.map((r) => (
              <li
                key={r.id}
                className={`flex items-baseline gap-2.5 px-3 h-9 hover:bg-netra-hover transition-colors ${
                  fresh.has(r.id) ? "row-arrive" : ""
                }`}
              >
                <time className="text-netra-subtle shrink-0 tabular-nums">
                  {hhmmss(r.created_at)}
                </time>
                <span className={`shrink-0 font-bold ${actionTone(r.action)}`}>
                  {r.action}
                </span>
                <span className="text-netra-muted truncate">
                  {r.resource_type}
                  {r.resource_id ? `/${r.resource_id.slice(0, 8)}` : ""}
                </span>
                <samp className="ml-auto shrink-0 text-netra-subtle" title={r.payload_hash}>
                  #{(r.payload_hash ?? "").slice(0, 6)}
                </samp>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
};
