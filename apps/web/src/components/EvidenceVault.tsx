"use client";

import React, { useEffect, useState } from "react";
import { FileText, Hash, ExternalLink, Filter, Trash2, Globe, Plus } from "lucide-react";
import { ModuleHeader } from "./ModuleHeader";
import { apiFetch } from "../lib/api";
import { SkeletonTable } from "./viz/Skeleton";

interface EvidenceVaultProps {
  onOpenIngestionModal?: () => void;
}

export const EvidenceVault: React.FC<EvidenceVaultProps> = ({ onOpenIngestionModal }) => {
  const [evidenceList, setEvidenceList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadEvidence = async () => {
    try {
      const data = await apiFetch<any[]>("/api/v1/evidence");
      setEvidenceList(data);
    } catch (err) {
      console.error("Failed loading evidence", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEvidence();
  }, []);

  const [error, setError] = useState<string | null>(null);

  /**
   * Retract, not purge.
   *
   * Two things were wrong here. The copy promised to "purge" the item, but the
   * ledger is append-only -- withdrawing evidence must leave the record and its
   * audit trail intact. And the catch block dropped the row from the table even
   * when the request failed, so a rejected retraction still looked like it had
   * worked.
   */
  const handleRetractEvidence = async (id: string) => {
    const reason = prompt(
      "Reason for retracting this evidence item?\n\n" +
      "It stays on the record, marked retracted, and stops counting toward attribution."
    );
    if (reason === null) return;

    setError(null);
    try {
      await apiFetch(
        `/api/v1/evidence/${id}?reason=${encodeURIComponent(reason || "Retracted by analyst")}`,
        { method: "DELETE" }
      );
      setEvidenceList((prev) =>
        prev.map((e) =>
          e.id === id
            ? { ...e, retracted_at: new Date().toISOString(), retraction_reason: reason }
            : e
        )
      );
    } catch (err: any) {
      setError(err?.message ?? "Retraction failed. The item is unchanged.");
    }
  };

  return (
    <div className="space-y-6">
      <ModuleHeader
        code="06"
        icon={FileText}
        title="Evidence Vault"
        brief="Authoritative ledger of extracted artifacts, source URIs and SHA-256 digests."
        actions={
          onOpenIngestionModal && (
            <button
              onClick={onOpenIngestionModal}
              className="h-9 px-4 bg-netra-purple text-netra-bg font-mono text-[10px] font-bold uppercase tracking-telemetry flex items-center gap-2 hover:bg-netra-text transition-colors"
            >
              <Globe className="w-3.5 h-3.5" />
              <span>Ingest Payload</span>
            </button>
          )
        }
      />

      {error && (
        <div className="border border-netra-red/50 bg-netra-red/10 text-netra-red text-xs font-mono px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      <div className="bg-netra-card border border-netra-border rounded-xl p-5 space-y-4">
        {loading ? (
          <SkeletonTable rows={9} label="Loading evidence ledger" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-netra-border text-netra-subtle bg-netra-surface">
                  <th className="p-3">Evidence ID</th>
                  <th className="p-3">Extraction Method</th>
                  <th className="p-3">Extracted Value</th>
                  <th className="p-3">Source URI</th>
                  <th className="p-3">Dependence Group</th>
                  <th className="p-3">SHA-256 Hash</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-netra-border">
                {evidenceList.map((e) => (
                  <tr
                    key={e.id}
                    title={e.retracted_at ? `Retracted: ${e.retraction_reason ?? "no reason recorded"}` : undefined}
                    className={`transition ${
                      e.retracted_at
                        ? "opacity-45 line-through decoration-netra-muted/60"
                        : "hover:bg-netra-hover/50"
                    }`}
                  >
                    <td className="p-3 text-netra-purple">{e.id.substring(0, 13)}...</td>
                    <td className="p-3 text-netra-muted">{e.extraction_method}</td>
                    <td className="p-3 text-white font-semibold">{e.value}</td>
                    <td className="p-3 text-netra-subtle flex items-center space-x-1">
                      <span>{e.source_uri}</span>
                      <ExternalLink className="w-3 h-3 text-netra-subtle" />
                    </td>
                    <td className="p-3 text-netra-cyan">{e.dependence_group}</td>
                    <td className={`p-3 flex items-center space-x-1 ${e.sha256 ? "text-netra-valid" : "text-netra-subtle"}`}>
                      <Hash className={`w-3 h-3 ${e.sha256 ? "text-netra-valid" : "text-netra-subtle"}`} />
                      {/* Showed "Verified" precisely when no digest existed. */}
                      <span>{e.sha256 ? e.sha256.substring(0, 16) + "…" : "no digest"}</span>
                    </td>
                    <td className="p-3 text-right">
                      <button
                        onClick={() => handleRetractEvidence(e.id)}
                        disabled={!!e.retracted_at}
                        title={e.retracted_at ? "Already retracted" : "Retract evidence record"}
                        className="p-1 text-netra-muted hover:text-netra-hazard transition rounded disabled:opacity-30 disabled:hover:text-netra-muted disabled:cursor-not-allowed"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

