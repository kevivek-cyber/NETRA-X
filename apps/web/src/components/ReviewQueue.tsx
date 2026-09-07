"use client";

/**
 * Hypothesis review queue.
 *
 * Rebuilt as a dense instrument list rather than a stack of rounded cards with
 * tinted pill badges. Each row is a compartment: identity pair on the left, the
 * two figures that decide the call in the middle, the decision controls on the
 * right, and a probability meter running along the bottom edge.
 *
 * The probability bar is the one piece of chrome that earns an entry
 * animation -- it is the value the analyst is being asked to rule on, so it
 * fills from zero rather than appearing already drawn.
 */

import React, { useState } from "react";
import {
  AlertOctagon, ArrowUpRight, CheckCircle2, Clock, Filter, XCircle,
} from "lucide-react";

interface HypothesisItem {
  id: string;
  subject_label: string;
  object_label: string;
  calibrated_prob: number;
  confidence_tier: string;
  status: string;
  raw_log_lr: number;
  supporting_evidence?: any[];
  contradictions?: any[];
  family_breakdown?: Record<string, number>;
}

interface ReviewQueueProps {
  hypotheses: HypothesisItem[];
  onSelectHypothesis: (id: string) => void;
  onReviewDecision: (id: string, decision: string) => void;
}

const FILTERS = ["ALL", "PROPOSED", "ACCEPTED", "REJECTED", "INSUFFICIENT"];

/** Status drives border and text colour only -- no filled pills. */
function statusTone(status: string) {
  switch (status.toUpperCase()) {
    case "ACCEPTED":
      return "text-netra-valid border-netra-valid";
    case "REJECTED":
      return "text-netra-red border-netra-red";
    case "INSUFFICIENT":
      return "text-netra-muted border-netra-border";
    default:
      return "text-netra-amber border-netra-amber";
  }
}

export const ReviewQueue: React.FC<ReviewQueueProps> = ({
  hypotheses,
  onSelectHypothesis,
  onReviewDecision,
}) => {
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  const filtered = hypotheses
    .filter((h) =>
      statusFilter === "ALL" ? true : h.status.toUpperCase() === statusFilter
    )
    .sort((a, b) => b.calibrated_prob - a.calibrated_prob);

  const pendingCount = hypotheses.filter(
    (h) => h.status.toUpperCase() === "PROPOSED"
  ).length;

  return (
    <section className="border border-netra-border bg-netra-card">
      {/* Header */}
      <header className="border-b border-netra-border">
        <div className="flex items-center gap-2.5 px-4 h-11">
          <Filter className="w-3.5 h-3.5 text-netra-purple shrink-0" />
          <h2 className="telemetry-label text-netra-text">Hypothesis Review Queue</h2>
          <span className="ml-auto font-mono text-[10px] text-netra-muted tabular-nums">
            {filtered.length}/{hypotheses.length}
            {pendingCount > 0 && (
              <span className="text-netra-amber ml-2">{pendingCount} PENDING</span>
            )}
          </span>
        </div>

        {/* Segmented filter -- one continuous control, hairline separated. */}
        <div className="flex flex-wrap gap-px bg-netra-border border-t border-netra-border">
          {FILTERS.map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              aria-pressed={statusFilter === st}
              className={`flex-1 min-w-[84px] h-8 font-mono text-[10px] tracking-telemetry transition-colors ${
                statusFilter === st
                  ? "bg-netra-purple text-netra-bg font-bold"
                  : "bg-netra-surface text-netra-muted hover:text-netra-text"
              }`}
            >
              {st}
            </button>
          ))}
        </div>
      </header>

      {/* Rows */}
      {filtered.length === 0 ? (
        <p className="p-10 text-center font-mono text-[11px] text-netra-subtle">
          No hypotheses with status <span className="text-netra-text">{statusFilter}</span>.
        </p>
      ) : (
        <ul className="divide-y divide-netra-border stagger">
          {filtered.map((h) => {
            const hasContradiction =
              (h.contradictions?.length ?? 0) > 0 || h.raw_log_lr < 0;
            const familyCount = h.family_breakdown
              ? Object.keys(h.family_breakdown).length
              : h.supporting_evidence?.length ?? 0;
            const pct = h.calibrated_prob * 100;
            const decided = h.status.toUpperCase() !== "PROPOSED";

            return (
              <li key={h.id} className="relative row-live border-l-2 border-l-transparent hover:border-l-netra-purple bg-netra-card">
                <div className="p-4 space-y-3">
                  {/* Identity pair */}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="flex items-center gap-2.5 min-w-0">
                      <span className="font-display uppercase text-base text-netra-text truncate">
                        {h.subject_label}
                      </span>
                      <span className="font-mono text-netra-purple shrink-0">&lt;-&gt;</span>
                      <span className="font-display uppercase text-base text-netra-purple truncate">
                        {h.object_label}
                      </span>
                    </h3>

                    <div className="flex items-center gap-2 font-mono text-[9px] tracking-telemetry uppercase shrink-0">
                      {hasContradiction && (
                        <span className="flex items-center gap-1 border border-netra-red text-netra-red px-2 h-6">
                          <AlertOctagon className="w-3 h-3 contradiction-alert" />
                          <span className="font-bold">Contradiction</span>
                        </span>
                      )}
                      <span className={`border px-2 h-6 flex items-center font-bold ${statusTone(h.status)}`}>
                        {h.status}
                      </span>
                    </div>
                  </div>

                  {/* Figures */}
                  <dl className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-netra-border border border-netra-border">
                    <div className="bg-netra-surface p-2.5">
                      <dt className="telemetry-label">P(H1|E)</dt>
                      <dd className="font-mono text-lg text-netra-valid tabular-nums leading-tight">
                        {pct.toFixed(1)}%
                      </dd>
                    </div>
                    <div className="bg-netra-surface p-2.5">
                      <dt className="telemetry-label">Raw LLR</dt>
                      <dd
                        className={`font-mono text-lg tabular-nums leading-tight ${
                          h.raw_log_lr >= 0 ? "text-netra-purple" : "text-netra-red"
                        }`}
                      >
                        {h.raw_log_lr >= 0 ? "+" : ""}
                        {h.raw_log_lr.toFixed(2)}
                      </dd>
                    </div>
                    <div className="bg-netra-surface p-2.5">
                      <dt className="telemetry-label">Tier</dt>
                      <dd className="font-mono text-[11px] text-netra-text leading-tight pt-1.5">
                        {h.confidence_tier}
                      </dd>
                    </div>
                    <div className="bg-netra-surface p-2.5">
                      <dt className="telemetry-label">Families</dt>
                      <dd className="font-mono text-lg text-netra-text tabular-nums leading-tight">
                        {familyCount}
                      </dd>
                    </div>
                  </dl>

                  {/* Probability meter. Fills once on mount. */}
                  <div className="h-1 bg-netra-surface border border-netra-border" role="presentation">
                    <div
                      className="h-full bar-fill"
                      style={{
                        width: `${Math.min(100, Math.max(0, pct))}%`,
                        background: hasContradiction ? "#E61919" : "#35C2E8",
                      }}
                    />
                  </div>

                  {/* Controls */}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      onClick={() => onSelectHypothesis(h.id)}
                      className="h-7 px-3 border border-netra-border bg-netra-surface text-netra-text font-mono text-[10px] uppercase tracking-telemetry flex items-center gap-1.5 hover:border-netra-purple hover:text-netra-purple transition-colors"
                    >
                      <span>Waterfall</span>
                      <ArrowUpRight className="w-3 h-3" />
                    </button>

                    <div className="ml-auto flex items-center gap-2">
                      {decided ? (
                        <span className="font-mono text-[10px] text-netra-subtle uppercase tracking-telemetry">
                          Reviewed
                        </span>
                      ) : (
                        <>
                          <span className="telemetry-label hidden sm:inline">Analyst decision</span>
                          <button
                            onClick={() => onReviewDecision(h.id, "ACCEPT")}
                            className="h-7 px-2.5 border border-netra-valid text-netra-valid font-mono text-[10px] font-bold uppercase tracking-telemetry flex items-center gap-1 hover:bg-netra-valid hover:text-netra-bg transition-colors"
                          >
                            <CheckCircle2 className="w-3 h-3" />
                            Accept
                          </button>
                          <button
                            onClick={() => onReviewDecision(h.id, "REJECT")}
                            className="h-7 px-2.5 border border-netra-red text-netra-red font-mono text-[10px] font-bold uppercase tracking-telemetry flex items-center gap-1 hover:bg-netra-red hover:text-netra-bg transition-colors"
                          >
                            <XCircle className="w-3 h-3" />
                            Reject
                          </button>
                          <button
                            onClick={() => onReviewDecision(h.id, "INSUFFICIENT")}
                            className="h-7 px-2.5 border border-netra-amber text-netra-amber font-mono text-[10px] font-bold uppercase tracking-telemetry flex items-center gap-1 hover:bg-netra-amber hover:text-netra-bg transition-colors"
                          >
                            <Clock className="w-3 h-3" />
                            Insufficient
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};
