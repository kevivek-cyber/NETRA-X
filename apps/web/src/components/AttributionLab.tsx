"use client";

import React, { useEffect, useState } from "react";
import {
  GitMerge, ShieldCheck, AlertOctagon, CheckCircle2, XCircle, HelpCircle,
  Download, Lock, FileText, ArrowRight, FileSpreadsheet, Shield
} from "lucide-react";
import { useToast } from "./StatusToasts";
import { apiFetch, downloadReportPdf } from "../lib/api";
import { EvidenceWaterfall } from "./EvidenceWaterfall";
import { SkeletonPanel, SkeletonTiles } from "./viz/Skeleton";

interface AttributionLabProps {
  hypothesisId?: string;
  onNavigate: (view: string) => void;
}

export const AttributionLab: React.FC<AttributionLabProps> = ({
  hypothesisId,
  onNavigate
}) => {
  const toast = useToast();
  const [hypothesis, setHypothesis] = useState<any>(null);
  const [engineConfig, setEngineConfig] = useState<any>(null);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [reviewMessage, setReviewMessage] = useState<string | null>(null);

  useEffect(() => {
    async function loadHypothesis() {
      try {
        const list = await apiFetch<any[]>("/api/v1/hypotheses");
        const target = hypothesisId ? list.find((h) => h.id === hypothesisId) : list[0];
        setHypothesis(target || list[0]);
      } catch (err) {
        console.error("Failed loading hypothesis", err);
      }
    }
    async function loadEngineConfig() {
      try {
        const cfg = await apiFetch<any>("/api/v1/config/engine");
        setEngineConfig(cfg);
      } catch (err) {
        console.error("Failed loading engine config", err);
      }
    }
    loadHypothesis();
    loadEngineConfig();
  }, [hypothesisId]);

  if (!hypothesis) {
    return (
      <div className="space-y-5">
        <SkeletonPanel lines={3} label="Loading attribution lab" />
        <SkeletonTiles count={4} />
        <SkeletonPanel lines={7} />
      </div>
    );
  }

  const handleDecision = async (decision: "ACCEPT" | "REJECT" | "INSUFFICIENT") => {
    setSubmitting(true);
    setReviewMessage(null);
    try {
      const updated = await apiFetch<any>(`/api/v1/review/${hypothesis.id}`, {
        method: "POST",
        body: JSON.stringify({ decision, notes }),
      });
      setHypothesis(updated);
      setReviewMessage(`Analyst Decision '${decision}' recorded & SHA-256 hash-chained to audit log.`);
    } catch (err: any) {
      setReviewMessage(`Error submitting decision: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handlePdfExport = async () => {
    setExporting(true);
    try {
      await downloadReportPdf(hypothesis.id);
    } catch (err: any) {
      toast.push("error", "Export failed", err.message);
    } finally {
      setExporting(false);
    }
  };

  const handleStixExport = () => {
    window.open(`/api/v1/exports/stix?hypothesis_id=${hypothesis.id}`, "_blank");
  };

  const handleCsvExport = () => {
    window.open(`/api/v1/exports/csv?hypothesis_id=${hypothesis.id}`, "_blank");
  };

  const lambdaDisplay = engineConfig ? engineConfig.lambda_discount.toFixed(2) : "…";
  const storageBackend = engineConfig ? engineConfig.storage_backend : "Evidence Ledger";

  return (
    <div className="space-y-6">
      {/* Assessment Type Mandatory Warning Banner */}
      <div className="bg-netra-amber/10 border border-netra-amber/40 rounded-xl p-3.5 flex items-center justify-between font-mono text-xs text-netra-amber">
        <div className="flex items-center space-x-2">
          <Shield className="w-4 h-4 text-netra-amber shrink-0" />
          <span className="font-bold">ASSESSMENT TYPE: INVESTIGATIVE LEAD</span>
          <span className="text-netra-subtle">•</span>
          <span>Analyst review required before legal submission</span>
        </div>
        <span className="bg-netra-amber/20 text-netra-amber px-2 py-0.5 rounded text-[11px] font-bold border border-netra-amber/30">
          PROVENANCE PROTECTED
        </span>
      </div>

      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-netra-border pb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <GitMerge className="w-3.5 h-3.5 text-netra-purple shrink-0" />
            <span className="telemetry-label bracketed">Module 04</span>
          </div>
          <h1
            data-text="Attribution Lab"
            className="glitch-soft font-display uppercase text-netra-text leading-[0.9] tracking-tightest"
            style={{ fontSize: "clamp(1.75rem, 3.6vw, 2.75rem)" }}
          >
            Attribution Lab
          </h1>
          <p className="mt-2 text-xs text-netra-muted max-w-xl leading-relaxed">
            Log-likelihood ratio fusion, dependence discounting (λ = {lambdaDisplay})
            and isotonic calibration.
          </p>
        </div>

        {/* Multi-Format Export Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleStixExport}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-netra-cyan/20 text-netra-cyan hover:bg-netra-cyan/30 font-mono text-xs border border-netra-cyan/40 transition"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>STIX 2.1 JSON</span>
          </button>
          <button
            onClick={handleCsvExport}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-netra-valid/15 text-netra-valid hover:bg-netra-valid/25 font-mono text-xs border border-netra-valid/40 transition"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>CSV Ledger</span>
          </button>
          <button
            onClick={handlePdfExport}
            disabled={exporting}
            className="flex items-center space-x-2 px-4 py-2 rounded-lg bg-netra-purple text-netra-bg hover:bg-netra-purple/80 font-medium text-xs transition disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            <span>{exporting ? "Generating..." : "Export Signed PDF"}</span>
          </button>
        </div>
      </div>

      {/* Candidate Pair Header */}
      <div className="bg-netra-card border border-netra-border rounded-xl p-6 glass-panel space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="p-3 rounded-xl bg-netra-surface border border-netra-purple/50">
              <span className="text-xs text-netra-subtle block font-mono">SUBJECT ENTITY</span>
              <span className="text-lg font-bold text-white">{hypothesis.subject_label}</span>
            </div>

            <ArrowRight className="w-6 h-6 text-netra-purple" />

            <div className="p-3 rounded-xl bg-netra-surface border border-netra-cyan/50">
              <span className="text-xs text-netra-subtle block font-mono">CANDIDATE TARGET</span>
              <span className="text-lg font-bold text-netra-cyan">{hypothesis.object_label}</span>
            </div>
          </div>

          <div className="text-right space-y-1">
            <span className={`px-3 py-1 rounded text-xs font-mono font-bold ${
              hypothesis.status === "ACCEPTED" || hypothesis.status === "ACCEPT"
                ? "bg-netra-valid/20 text-netra-valid border border-netra-valid/40"
                : hypothesis.status === "REJECTED" || hypothesis.status === "REJECT"
                ? "bg-netra-red/20 text-netra-red border border-netra-red/40"
                : "bg-netra-amber/20 text-netra-amber border border-netra-amber/40"
            }`}>
              STATUS: {hypothesis.status}
            </span>
            <div className="text-xs text-netra-muted font-mono">
              Raw LLR Score: <span className="text-white font-bold">{hypothesis.raw_log_lr.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Calibrated Probability Gauge */}
        <div className="p-4 bg-netra-surface border border-netra-border rounded-xl space-y-2">
          <div className="flex justify-between items-center text-xs font-mono">
            <span className="text-netra-muted font-medium">ISOTONIC CALIBRATED POSTERIOR PROBABILITY</span>
            <span className="font-bold text-netra-valid text-sm">
              {(hypothesis.calibrated_prob * 100).toFixed(1)}% ({hypothesis.confidence_tier})
            </span>
          </div>

          <div className="w-full h-3.5 bg-netra-bg rounded-full overflow-hidden border border-netra-border flex">
            <div
              className="h-full bg-netra-cyan bar-fill transition-all duration-500"
              style={{ width: `${hypothesis.calibrated_prob * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2 Cols): Evidence Waterfall */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-netra-card border border-netra-border rounded-xl p-5 space-y-4">
            <h2 className="text-sm font-semibold text-white border-b border-netra-border pb-2 flex items-center justify-between">
              <span>Authoritative Evidence Waterfall</span>
              <span className="text-xs text-netra-subtle font-mono">DISCOUNT FACTOR  λ = {lambdaDisplay}</span>
            </h2>

            <EvidenceWaterfall
              supporting={hypothesis.supporting_evidence}
              contradictions={hypothesis.contradictions}
              familyBreakdown={hypothesis.family_breakdown}
              storageBackend={storageBackend}
            />
          </div>
        </div>

        {/* Right Column (1 Col): Mandatory Analyst Review Action Panel */}
        <div className="space-y-6">
          <div className="bg-netra-card border border-netra-border rounded-xl p-5 space-y-4 sticky top-20 glass-panel">
            <h2 className="text-sm font-semibold text-white border-b border-netra-border pb-2 flex items-center space-x-2">
              <ShieldCheck className="w-4 h-4 text-netra-valid" />
              <span>Mandatory Analyst Review</span>
            </h2>

            <p className="text-xs text-netra-muted leading-relaxed">
              AI model outputs generate hypotheses only. Analysts must evaluate the evidence waterfall and record an immutable decision.
            </p>

            <div className="space-y-2">
              <label className="text-xs text-netra-subtle font-medium block">Analyst Assessment Notes:</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Enter justification notes (e.g. Verified multi-family corroboration across PGP key & wallet cluster...)"
                rows={4}
                className="w-full bg-netra-surface border border-netra-border rounded-lg p-2.5 text-xs text-white placeholder-netra-subtle focus:outline-none focus:border-netra-purple transition"
              />
            </div>

            {reviewMessage && (
              <div className="p-3 rounded bg-netra-surface border border-netra-purple/40 text-xs text-netra-cyan font-mono leading-tight">
                {reviewMessage}
              </div>
            )}

            <div className="space-y-2 pt-2">
              <button
                onClick={() => handleDecision("ACCEPT")}
                disabled={submitting}
                className="w-full py-2.5 rounded-lg bg-transparent border border-netra-valid text-netra-valid hover:bg-netra-valid hover:text-netra-bg font-bold text-xs flex items-center justify-center space-x-2 shadow transition disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>ACCEPT LINKAGE</span>
              </button>

              <button
                onClick={() => handleDecision("REJECT")}
                disabled={submitting}
                className="w-full py-2.5 rounded-lg bg-transparent border border-netra-red text-netra-red hover:bg-netra-red hover:text-netra-text font-bold text-xs flex items-center justify-center space-x-2 shadow transition disabled:opacity-50"
              >
                <XCircle className="w-4 h-4" />
                <span>REJECT LINKAGE</span>
              </button>

              <button
                onClick={() => handleDecision("INSUFFICIENT")}
                disabled={submitting}
                className="w-full py-2.5 rounded-lg bg-netra-surface border border-netra-border text-netra-muted hover:text-white font-semibold text-xs flex items-center justify-center space-x-2 transition disabled:opacity-50"
              >
                <HelpCircle className="w-4 h-4" />
                <span>INSUFFICIENT EVIDENCE</span>
              </button>
            </div>

            <div className="pt-3 border-t border-netra-border text-[11px] text-netra-subtle flex items-center space-x-1.5 font-mono">
              <Lock className="w-3.5 h-3.5 text-netra-valid" />
              <span>Decisions append to SHA-256 audit chain.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
