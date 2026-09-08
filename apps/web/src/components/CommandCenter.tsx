"use client";

/**
 * Command Center.
 *
 * Two things changed here beyond the visual language.
 *
 * 1. The "Multi-Modal Service Mesh" panel printed PostgreSQL / Neo4j / Redis /
 *    MinIO as ONLINE from string literals. In the desktop build none of those
 *    processes exist -- the launcher pins SQLite and clears the Neo4j, Redis
 *    and MinIO settings on purpose -- so the panel asserted four healthy
 *    services where there were none. It now reports what
 *    `/api/v1/config/engine` says, and names the relational fallback as a
 *    fallback.
 *
 * 2. The stat tiles carried hardcoded subtitles ("3 Aliases - 1 PGP Key -
 *    2 BTC Wallets", "Operation ShadowByte") that did not move when the ledger
 *    did, and an "Active Cases: 1" that was the literal 1. Those are counted
 *    from the same responses that feed the figures above them.
 *
 * The sparklines are cumulative record counts derived from each row's own
 * created_at -- see lib/series.ts for why they are not synthesised.
 */

import React, { useEffect, useMemo, useState } from "react";
import {
  Activity, AlertTriangle, ArrowUpRight, Database, FileText, GitMerge,
  Globe, ShieldAlert, Users,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { useCountUp } from "../lib/useCountUp";
import { cumulativeSeries } from "../lib/series";
import { useToast } from "./StatusToasts";
import { ReviewQueue } from "./ReviewQueue";
import { ThreatGlobe } from "./viz/ThreatGlobe";
import { Sparkline } from "./viz/Sparkline";
import { ScrambleText } from "./viz/TextFX";
import { ActivityFeed } from "./viz/ActivityFeed";

interface CommandCenterProps {
  onNavigate: (view: string, targetId?: string) => void;
  onOpenReportModal?: () => void;
  onOpenIngestionModal?: () => void;
}

/** One instrument tile: figure, trend, and a caption counted from the ledger. */
function StatBlock({
  label, value, caption, icon: Icon, series, accent, loading, delay,
}: {
  label: string;
  value: number;
  caption: React.ReactNode;
  icon: React.ElementType;
  series: number[];
  accent: string;
  loading: boolean;
  delay: string;
}) {
  const shown = useCountUp(loading ? null : value);
  return (
    <div className={`crosshair-hover relative bg-netra-card border border-netra-border p-4 overflow-hidden boot-in ${delay}`}>
      <div className="flex items-start justify-between mb-3">
        <span className="telemetry-label">{label}</span>
        <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: accent }} />
      </div>

      <div className="flex items-end justify-between gap-3">
        <output className="font-display text-4xl leading-none text-netra-text tabular-nums data-arrive">
          {loading ? "--" : shown}
        </output>
        {series.length > 1 && (
          <Sparkline data={series} color={accent} width={92} height={30} />
        )}
      </div>

      <div className="mt-3 pt-2 border-t border-netra-border font-mono text-[10px] text-netra-muted">
        {caption}
      </div>
    </div>
  );
}

export const CommandCenter: React.FC<CommandCenterProps> = ({
  onNavigate,
  onOpenReportModal,
  onOpenIngestionModal,
}) => {
  const [actors, setActors] = useState<any[]>([]);
  const [hypotheses, setHypotheses] = useState<any[]>([]);
  const [evidence, setEvidence] = useState<any[]>([]);
  const [cases, setCases] = useState<any[]>([]);
  const [engine, setEngine] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const [identifierType, setIdentifierType] = useState("handle");
  const [searchQuery, setSearchQuery] = useState("");
  const [isInvestigating, setIsInvestigating] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searched, setSearched] = useState(false);

  const toast = useToast();

  const loadData = async () => {
    const [actorsRes, hypRes, evRes, caseRes, engineRes] = await Promise.allSettled([
      apiFetch<any[]>("/api/v1/actors"),
      apiFetch<any[]>("/api/v1/hypotheses"),
      apiFetch<any[]>("/api/v1/evidence"),
      apiFetch<any[]>("/api/v1/investigations"),
      apiFetch<any>("/api/v1/config/engine"),
    ]);

    if (actorsRes.status === "fulfilled") setActors(actorsRes.value);
    if (hypRes.status === "fulfilled") setHypotheses(hypRes.value);
    if (evRes.status === "fulfilled") setEvidence(evRes.value);
    if (caseRes.status === "fulfilled") setCases(caseRes.value);
    if (engineRes.status === "fulfilled") setEngine(engineRes.value);

    // A silent empty dashboard is worse than a stated failure: the analyst
    // cannot tell an empty ledger from an unreachable one.
    const failed = [actorsRes, hypRes, evRes].filter((r) => r.status === "rejected");
    if (failed.length) {
      toast.push("error", "Ledger unreachable", "Some Command Center figures could not be loaded.");
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleInvestigate = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsInvestigating(true);
    setSearched(true);
    try {
      const res = await apiFetch<any>(`/api/v1/search?q=${encodeURIComponent(searchQuery)}`);
      setSearchResults(res.results || []);
      // Previously a miss navigated away to an empty Actor Profile and raised a
      // toast saying an investigation had been "launched" -- neither was true.
      // A search that matches nothing reports that it matched nothing.
      if (!res.results?.length) {
        toast.push("info", "No ledger match", `Nothing indexed for "${searchQuery}".`);
      }
    } catch (err: any) {
      setSearchResults([]);
      toast.push("error", "Search failed", err.message || "The ledger did not respond.");
    } finally {
      setIsInvestigating(false);
    }
  };

  const handleReviewDecision = async (id: string, decision: string) => {
    try {
      await apiFetch(`/api/v1/review/${id}`, {
        method: "POST",
        body: JSON.stringify({
          decision,
          notes: `Reviewed from Command Center Queue (${decision})`,
        }),
      });
      await loadData();
      toast.push(
        decision === "REJECT" ? "warn" : "ok",
        `Hypothesis ${decision.toLowerCase()}ed`,
        `Decision written to ledger and audit chain - ${id.slice(0, 8)}`
      );
    } catch (err: any) {
      toast.push("error", "Decision failed", err.message);
    }
  };

  const openHypotheses = hypotheses.filter((h) => h.status === "PROPOSED");
  const contradicted = hypotheses.filter((h) => (h.contradictions?.length ?? 0) > 0);
  const avgConfidence =
    hypotheses.length > 0
      ? (hypotheses.reduce((s, h) => s + h.calibrated_prob, 0) / hypotheses.length) * 100
      : null;
  const retracted = evidence.filter((e) => e.retracted_at).length;
  // Archiving is recorded as a status change, not a timestamp column -- see
  // the /investigations/{id}/archive handler.
  const activeCases = cases.filter((c) => c.status !== "ARCHIVED");

  const evidenceSeries = useMemo(() => cumulativeSeries(evidence), [evidence]);
  const hypSeries = useMemo(() => cumulativeSeries(hypotheses), [hypotheses]);
  // Actors have no creation stamp in the API surface -- last_seen is the only
  // real temporal column, so the actor trend is activity over time.
  const actorSeries = useMemo(() => cumulativeSeries(actors, 24, "last_seen"), [actors]);
  const caseSeries = useMemo(() => cumulativeSeries(cases), [cases]);

  const identifiers = [
    { id: "handle", label: "Handle" },
    { id: "wallet", label: "Wallet" },
    { id: "pgp", label: "PGP" },
    { id: "onion", label: "Onion" },
    { id: "email", label: "Email / Jabber" },
  ];

  const placeholder =
    identifierType === "wallet"
      ? "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh"
      : identifierType === "pgp"
      ? "4F3B8C90... / RSA-4096 fingerprint"
      : identifierType === "onion"
      ? "darkmarketx37ab.onion"
      : identifierType === "email"
      ? "shadow_phoenix@jabber.cz"
      : "nightowl99 / ShadowByte";

  return (
    <div className="space-y-5">
      {/* --- COMMAND BAR: title, globe, search ---------------------------- */}
      <section className="relative border border-netra-border bg-netra-card overflow-hidden">
        {/* Globe bled off the right edge. Behind content, never interactive. */}
        <div
          className="absolute -right-12 -top-20 opacity-70 pointer-events-none hidden lg:block"
          aria-hidden="true"
        >
          <ThreatGlobe size={460} arcCount={7} interactive={false} />
        </div>

        <div className="relative p-5 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="telemetry-label bracketed mb-2">Module 01</div>
              <h1
                data-text="Command Center"
                className="glitch-soft font-display uppercase text-netra-text leading-[0.9] tracking-tightest"
                style={{ fontSize: "clamp(1.9rem, 4vw, 3rem)" }}
              >
                Command Center
              </h1>
              <p className="mt-2 text-xs text-netra-muted max-w-md leading-relaxed">
                Threat actor footprints, evidence provenance and the attribution
                review queue.
              </p>
            </div>

            <div className="flex items-center gap-2">
              {onOpenIngestionModal && (
                <button
                  onClick={onOpenIngestionModal}
                  className="h-9 px-3 border border-netra-border bg-netra-surface text-netra-text font-mono text-[10px] uppercase tracking-telemetry flex items-center gap-2 hover:border-netra-purple hover:text-netra-purple transition-colors"
                >
                  <Globe className="w-3.5 h-3.5" />
                  <span>Live Crawler</span>
                </button>
              )}
              {onOpenReportModal && (
                <button
                  onClick={onOpenReportModal}
                  className="h-9 px-3 border border-netra-border bg-netra-surface text-netra-text font-mono text-[10px] uppercase tracking-telemetry flex items-center gap-2 hover:border-netra-purple hover:text-netra-purple transition-colors"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Export</span>
                </button>
              )}
            </div>
          </div>

          {/* Seed identifier entry */}
          <div className="border-t border-netra-border pt-4 space-y-3">
            <div className="flex items-center gap-2 telemetry-label">
              <ShieldAlert className="w-3.5 h-3.5 text-netra-purple" />
              <span className="text-netra-text">Step 01 / Seed Identifier</span>
            </div>

            <div className="flex flex-wrap gap-px bg-netra-border border border-netra-border w-fit">
              {identifiers.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setIdentifierType(item.id)}
                  aria-pressed={identifierType === item.id}
                  className={`px-3 h-8 font-mono text-[10px] uppercase tracking-telemetry transition-colors ${
                    identifierType === item.id
                      ? "bg-netra-purple text-netra-bg font-bold"
                      : "bg-netra-surface text-netra-muted hover:text-netra-text"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <form onSubmit={handleInvestigate} className="flex gap-px bg-netra-border border border-netra-border">
              <span className="bg-netra-surface flex items-center px-3 font-mono text-[11px] text-netra-purple shrink-0">
                &gt;
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={placeholder}
                aria-label="Seed identifier"
                className="focus-rule flex-1 min-w-0 bg-netra-surface h-11 px-2 font-mono text-xs text-netra-text placeholder-netra-subtle focus:outline-none focus:bg-netra-hover transition-colors"
              />
              <button
                type="submit"
                disabled={isInvestigating || !searchQuery.trim()}
                className="key-press px-5 bg-netra-purple text-netra-bg font-mono text-[10px] font-bold uppercase tracking-telemetry flex items-center gap-2 hover:bg-netra-text disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
              >
                {isInvestigating ? (
                  <>
                    <span className="w-1.5 h-1.5 bg-netra-bg live-dot" />
                    <span>Correlating</span>
                  </>
                ) : (
                  <>
                    <span>Investigate</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </form>

            {searched && !isInvestigating && (
              <div className="pt-1">
                <div className="telemetry-label mb-2">
                  {searchResults.length} match{searchResults.length === 1 ? "" : "es"} in ledger
                </div>
                {searchResults.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-netra-border border border-netra-border stagger">
                    {searchResults.map((res: any, idx: number) => (
                      <button
                        key={idx}
                        onClick={() => onNavigate("actors", res.entity_id)}
                        className="crosshair-hover row-live bg-netra-surface border border-transparent p-3 text-left hover:bg-netra-hover transition-colors"
                      >
                        <div className="flex items-baseline justify-between gap-2 mb-1">
                          <span className="text-xs font-semibold text-netra-text truncate">
                            {res.title}
                          </span>
                          <span className="font-mono text-[9px] tracking-telemetry uppercase text-netra-purple shrink-0">
                            {res.entity_type}
                          </span>
                        </div>
                        <div className="font-mono text-[10px] text-netra-muted truncate">
                          {res.snippet}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* --- INSTRUMENT ROW ------------------------------------------------ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-px bg-netra-border border border-netra-border">
        <StatBlock
          label="Tracked Actors"
          value={actors.length}
          icon={Users}
          accent="#35C2E8"
          series={actorSeries}
          loading={loading}
          delay="boot-in-1"
          caption={
            avgConfidence != null ? (
              <>Mean attribution confidence <span className="text-netra-text">{avgConfidence.toFixed(1)}%</span></>
            ) : (
              <span className="text-netra-subtle">No hypotheses scored yet</span>
            )
          }
        />
        <StatBlock
          label="Evidence Artifacts"
          value={evidence.length}
          icon={FileText}
          accent="#EAEAEA"
          series={evidenceSeries}
          loading={loading}
          delay="boot-in-1"
          caption={
            retracted > 0 ? (
              <span className="text-netra-amber">{retracted} retracted, retained in ledger</span>
            ) : (
              <span className="text-netra-valid">All SHA-256 sealed</span>
            )
          }
        />
        <StatBlock
          label="Hypotheses"
          value={hypotheses.length}
          icon={GitMerge}
          accent="#F0A020"
          series={hypSeries}
          loading={loading}
          delay="boot-in-2"
          caption={
            <span className={openHypotheses.length ? "text-netra-amber" : ""}>
              {openHypotheses.length} awaiting analyst review
            </span>
          }
        />
        <StatBlock
          label="Active Cases"
          value={activeCases.length}
          icon={ShieldAlert}
          accent="#4AF626"
          series={caseSeries}
          loading={loading}
          delay="boot-in-3"
          caption={
            activeCases.length ? (
              <span className="truncate block">{activeCases[0].title}</span>
            ) : (
              <span className="text-netra-subtle">No open investigations</span>
            )
          }
        />
      </div>

      {/* Contradictions get their own alert bar -- the one thing an analyst
          must not scroll past. Rendered only when there are any. */}
      {contradicted.length > 0 && (
        <div className="hazard-stripe border border-netra-red bg-netra-card flex items-center gap-3 px-4 h-11">
          <AlertTriangle className="w-4 h-4 text-netra-red contradiction-alert shrink-0" />
          <span className="font-mono text-[11px] tracking-telemetry uppercase text-netra-red font-bold">
            {contradicted.length} hypothes{contradicted.length === 1 ? "is" : "es"} carry contradictory evidence
          </span>
          <button
            onClick={() => onNavigate("attribution_lab", contradicted[0].id)}
            className="ml-auto font-mono text-[10px] uppercase tracking-telemetry text-netra-text underline underline-offset-4 hover:text-netra-red transition-colors"
          >
            Inspect
          </button>
        </div>
      )}

      {/* --- QUEUE + ENGINE ------------------------------------------------ */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 min-w-0">
          <ReviewQueue
            hypotheses={hypotheses}
            onSelectHypothesis={(id) => onNavigate("attribution_lab", id)}
            onReviewDecision={handleReviewDecision}
          />
        </div>

        {/* The queue can run to dozens of hypotheses, and scrolling it used to
            leave this column as a tall empty gutter. Pinning it keeps the
            engine constants and the live audit tail on screen while the
            analyst works down the queue -- which is when they are most likely
            to want them. `self-start` is required: a stretched grid item is
            already the full column height and would have nothing to stick
            against. */}
        <div className="space-y-5 min-w-0 xl:sticky xl:top-0 xl:self-start">
          {/* Engine readout -- real constants from /api/v1/config/engine. */}
          <section className="border border-netra-border bg-netra-card boot-in boot-in-2">
            <header className="flex items-center gap-2 border-b border-netra-border px-4 h-10">
              <Database className="w-3.5 h-3.5 text-netra-purple" />
              <h2 className="telemetry-label text-netra-text">
                <ScrambleText text="ATTRIBUTION ENGINE" speed={26} />
              </h2>
            </header>

            <dl className="divide-y divide-netra-border font-mono text-[11px]">
              {[
                { k: "Storage backend", v: engine?.storage_backend, tone: "text-netra-text" },
                { k: "Fusion model", v: engine?.model_version, tone: "text-netra-text" },
                {
                  k: "Dependence λ",
                  v: engine?.lambda_discount != null ? engine.lambda_discount.toFixed(2) : null,
                  tone: "text-netra-text",
                },
                {
                  k: "Feature table",
                  v: engine?.feature_count != null ? `${engine.feature_count} features` : null,
                  tone: "text-netra-text",
                },
                {
                  k: "High-confidence cut",
                  v: engine?.thresholds?.high_confidence != null
                    ? `P >= ${engine.thresholds.high_confidence}`
                    : null,
                  tone: "text-netra-valid",
                },
              ].map((row) => (
                <div key={row.k} className="flex items-center justify-between gap-3 px-4 h-9">
                  <dt className="text-netra-muted">{row.k}</dt>
                  <dd className={row.v ? row.tone : "text-netra-subtle"}>
                    {row.v ?? "unavailable"}
                  </dd>
                </div>
              ))}
              {/* Named as a fallback, because that is what it is. The previous
                  panel reported a Neo4j projection as REBUILDABLE next to
                  three services that were not running at all. */}
              <div className="flex items-center justify-between gap-3 px-4 h-9">
                <dt className="text-netra-muted">Graph projection</dt>
                <dd className="text-netra-amber">Relational fallback</dd>
              </div>
            </dl>
          </section>

          <section className="border border-netra-border bg-netra-card boot-in boot-in-3">
            <header className="flex items-center gap-2 border-b border-netra-border px-4 h-10">
              <Activity className="w-3.5 h-3.5 text-netra-valid live-dot" />
              <h2 className="telemetry-label text-netra-text">Collection Posture</h2>
            </header>
            <div className="p-4 space-y-3">
              <p className="text-[11px] leading-relaxed text-netra-muted">
                Passive collection only. Artifacts are hashed on capture and the
                digest is written to the append-only chain before extraction runs.
              </p>
              <div className="edge-ticks h-2 w-full" aria-hidden="true" />
              <dl className="grid grid-cols-2 gap-px bg-netra-border border border-netra-border font-mono text-[10px]">
                <div className="bg-netra-surface p-2.5">
                  <dt className="telemetry-label">Actors</dt>
                  <dd className="text-netra-text text-sm tabular-nums">{actors.length}</dd>
                </div>
                <div className="bg-netra-surface p-2.5">
                  <dt className="telemetry-label">Artifacts</dt>
                  <dd className="text-netra-text text-sm tabular-nums">{evidence.length}</dd>
                </div>
              </dl>
            </div>
          </section>

          {/* Live tail of the append-only chain. Real rows, or an explicit
              "no audit events" -- never filler traffic. */}
          <ActivityFeed className="boot-in boot-in-3" />
        </div>
      </div>
    </div>
  );
};
