"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronRight, Hash, ShieldCheck, AlertOctagon, ExternalLink, Info } from "lucide-react";

interface EvidenceWaterfallProps {
  supporting: any[];
  contradictions: any[];
  familyBreakdown?: Record<string, number>;
  /** Live storage backend label from /api/v1/config/engine (e.g. "SQLite", "PostgreSQL"). */
  storageBackend?: string;
}

export const EvidenceWaterfall: React.FC<EvidenceWaterfallProps> = ({
  supporting,
  contradictions,
  familyBreakdown = {},
  storageBackend = "Evidence Ledger",
}) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedModalItem, setSelectedModalItem] = useState<any | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  // Compute maximum total LLR score for waterfall bar normalization
  const maxSupportScore = Math.max(...Object.values(familyBreakdown), 10.0);
  const totalContradictionPenalty = contradictions.reduce((sum, item) => sum + Math.abs(item.contribution), 0);

  return (
    <div className="space-y-6">
      {/* --- VISUAL STACKED WATERFALL BAR CHART --- */}
      <div className="bg-netra-surface border border-netra-border rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-netra-muted uppercase tracking-wider flex items-center space-x-2">
            <Info className="w-4 h-4 text-netra-purple" />
            <span>Multi-Evidence Family Contribution Cascade</span>
          </h3>
          <div className="text-xs font-mono text-netra-subtle">
            <span className="text-netra-purple font-bold">{storageBackend} Source of Truth</span>
          </div>
        </div>

        {/* Stacked Family Contribution Bars */}
        <div className="space-y-3 font-mono text-xs">
          {Object.entries(familyBreakdown).map(([family, score]) => {
            const widthPct = Math.min(100, Math.max(8, (score / maxSupportScore) * 100));
            return (
              <div key={family} className="space-y-1">
                <div className="flex justify-between text-netra-muted text-[11px]">
                  <span className="font-bold text-netra-purple">{family}</span>
                  <span className="text-netra-valid">+{score.toFixed(2)} LLR</span>
                </div>
                <div className="w-full bg-netra-bg h-3.5 rounded-full overflow-hidden border border-netra-border flex">
                  <div
                    className="h-full bg-netra-cyan bar-fill transition-all duration-500"
                    style={{ width: `${widthPct}%` }}
                  />
                </div>
              </div>
            );
          })}

          {/* Contradiction Red Bar Pulling Left */}
          {totalContradictionPenalty > 0 && (
            <div className="space-y-1 pt-2 border-t border-netra-border/50">
              <div className="flex justify-between text-netra-red text-[11px]">
                <span className="font-bold">CONTRADICTIONS PENALTY</span>
                <span>-{totalContradictionPenalty.toFixed(2)} LLR</span>
              </div>
              <div className="w-full bg-netra-bg h-3.5 rounded-full overflow-hidden border border-netra-red/40 flex justify-end">
                <div
                  className="h-full bg-netra-red bar-fill contradiction-alert transition-all duration-500"
                  style={{ width: `${Math.min(100, (totalContradictionPenalty / 15.0) * 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* --- DETAILED EVIDENCE LEDGER ITEMS --- */}
      <div className="space-y-4">
        {/* Supporting Evidence Items */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-netra-muted uppercase tracking-wider flex items-center justify-between">
            <span>Corroborating Evidence ({supporting.length})</span>
            <span className="text-netra-purple font-mono">+LLR FUSED</span>
          </h3>

          {supporting.map((item) => {
            const isExpanded = expandedId === item.evidence_id;
            return (
              <div
                key={item.evidence_id}
                className="bg-netra-surface border border-netra-border hover:border-netra-purple/50 rounded-lg overflow-hidden transition"
              >
                <div
                  onClick={() => toggleExpand(item.evidence_id)}
                  className="p-3.5 flex items-center justify-between cursor-pointer select-none"
                >
                  <div className="flex items-center space-x-3">
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4 text-netra-purple" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-netra-subtle" />
                    )}
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="text-xs font-bold text-netra-purple">{item.family}</span>
                        <span className="text-xs text-netra-subtle">•</span>
                        <span className="text-xs font-mono text-netra-cyan bg-netra-cyan/10 px-1.5 py-0.5 rounded border border-netra-cyan/20">
                          {item.dependence_group}
                        </span>
                      </div>
                      <div className="text-xs font-semibold text-white mt-0.5">{item.value}</div>
                    </div>
                  </div>

                  <div className="text-right flex items-center space-x-4">
                    <div className="text-xs hidden sm:block">
                      <span className="text-netra-subtle">Reliability: </span>
                      <span className="font-mono text-netra-valid">{(item.reliability * 100).toFixed(0)}%</span>
                    </div>
                    <div className="text-xs font-mono bg-netra-purple/20 text-netra-purple px-2.5 py-1 rounded border border-netra-purple/30 font-bold">
                      +{item.contribution.toFixed(2)} LLR
                    </div>
                  </div>
                </div>

                {isExpanded && (
                  <div className="p-4 bg-netra-bg/90 border-t border-netra-border space-y-3 text-xs font-mono">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <span className="text-netra-subtle">Evidence ID:</span>
                        <div className="text-white font-bold">{item.evidence_id}</div>
                      </div>
                      <div>
                        <span className="text-netra-subtle">Extraction Method:</span>
                        <div className="text-netra-muted">{item.extraction_method}</div>
                      </div>
                      <div>
                        <span className="text-netra-subtle">Source URI:</span>
                        <div className="text-netra-muted break-all flex items-center space-x-1">
                          <span>{item.source_uri}</span>
                          <ExternalLink className="w-3 h-3 text-netra-subtle shrink-0" />
                        </div>
                      </div>
                      <div>
                        <span className="text-netra-subtle">Raw Artifact SHA-256:</span>
                        <div className={`break-all flex items-center space-x-1 ${item.sha256 ? "text-netra-valid" : "text-netra-subtle"}`}>
                          <Hash className={`w-3 h-3 shrink-0 ${item.sha256 ? "text-netra-valid" : "text-netra-subtle"}`} />
                          <span>{item.sha256 ?? "no artifact digest on record"}</span>
                        </div>
                      </div>
                    </div>

                    <div className="pt-2 flex justify-end">
                      <button
                        onClick={() => setSelectedModalItem(item)}
                        className="px-3 py-1.5 bg-netra-purple/20 hover:bg-netra-purple/30 text-netra-purple rounded border border-netra-purple/40 text-xs font-bold transition flex items-center space-x-1"
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>Inspect Raw Provenance Ledger</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Contradiction Items */}
        {contradictions.length > 0 && (
          <div className="space-y-2 pt-4 border-t border-netra-border">
            <h3 className="text-xs font-semibold text-netra-red uppercase tracking-wider flex items-center justify-between">
              <span>Contradiction Penalties ({contradictions.length})</span>
              <span className="font-mono">-UNCAPPED PENALTY</span>
            </h3>

            {contradictions.map((item) => {
              const isExpanded = expandedId === item.evidence_id;
              return (
                <div
                  key={item.evidence_id}
                  className="bg-netra-red/10 border border-netra-red/40 rounded-lg overflow-hidden transition"
                >
                  <div
                    onClick={() => toggleExpand(item.evidence_id)}
                    className="p-3.5 flex items-center justify-between cursor-pointer select-none"
                  >
                    <div className="flex items-center space-x-3">
                      <AlertOctagon className="w-4 h-4 text-netra-red shrink-0" />
                      <div>
                        <div className="text-xs font-bold text-netra-red">CONTRADICTION FLAG</div>
                        <div className="text-xs font-semibold text-white mt-0.5">{item.value}</div>
                      </div>
                    </div>

                    <div className="text-xs font-mono bg-netra-red/20 text-netra-red px-2.5 py-1 rounded border border-netra-red/40 font-bold">
                      {item.contribution.toFixed(2)} LLR
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="p-4 bg-netra-bg/90 border-t border-netra-red/30 space-y-2 text-xs font-mono">
                      <div className="text-netra-muted">Source URI: {item.source_uri}</div>
                      <div className="text-netra-subtle">Extraction Method: {item.extraction_method}</div>
                      <div className="text-netra-red font-semibold">
                        Notice: Contradiction penalties directly subtract without damping or capping.
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* --- DRILL-DOWN PROVENANCE MODAL --- */}
      {selectedModalItem && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-netra-surface border border-netra-purple/50 rounded-2xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-netra-border pb-3">
              <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                <ShieldCheck className="w-4 h-4 text-netra-purple" />
                <span>Raw Evidence Provenance Ledger</span>
              </h3>
              <button
                onClick={() => setSelectedModalItem(null)}
                className="text-netra-subtle hover:text-white font-mono text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 font-mono text-xs text-netra-muted">
              <div>
                <span className="text-netra-subtle block">Evidence ID:</span>
                <span className="text-white font-bold">{selectedModalItem.evidence_id}</span>
              </div>
              <div>
                <span className="text-netra-subtle block">Extraction Method & Extractor Version:</span>
                <span className="text-netra-purple">{selectedModalItem.extraction_method} (v1.0.0-synthetic)</span>
              </div>
              <div>
                <span className="text-netra-subtle block">Immutable Artifact SHA-256:</span>
                <span className={`break-all block p-2 bg-netra-bg rounded border ${selectedModalItem.sha256 ? "text-netra-valid border-netra-valid/30" : "text-netra-subtle border-netra-border"}`}>
                  {selectedModalItem.sha256 ?? "No artifact digest on record for this item."}
                </span>
              </div>
              <div>
                <span className="text-netra-subtle block">Source Collection URI:</span>
                <span className="text-netra-cyan break-all">{selectedModalItem.source_uri}</span>
              </div>
              <div>
                <span className="text-netra-subtle block">Dependence Group:</span>
                <span className="text-white">{selectedModalItem.dependence_group}</span>
              </div>
              <div>
                <span className="text-netra-subtle block">LLR Score Contribution:</span>
                <span className="text-netra-purple font-bold">+{selectedModalItem.contribution} LLR</span>
              </div>
            </div>

            <div className="pt-3 border-t border-netra-border flex justify-end">
              <button
                onClick={() => setSelectedModalItem(null)}
                className="px-4 py-2 bg-netra-purple text-netra-bg font-bold rounded-lg text-xs hover:bg-netra-purple/80 transition"
              >
                Close Provenance Inspector
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
