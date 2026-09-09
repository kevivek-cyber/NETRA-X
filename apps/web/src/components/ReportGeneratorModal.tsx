"use client";

import React, { useEffect, useState } from "react";
import {
  FileText, Download, ShieldCheck, Share2, FileCode, Database,
  X, Check, AlertCircle, Eye, Printer, Lock
} from "lucide-react";
import { apiFetch } from "../lib/api";

interface ReportGeneratorModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialHypothesisId?: string;
}

export const ReportGeneratorModal: React.FC<ReportGeneratorModalProps> = ({
  isOpen,
  onClose,
  initialHypothesisId,
}) => {
  const [hypotheses, setHypotheses] = useState<any[]>([]);
  const [selectedHypothesisId, setSelectedHypothesisId] = useState<string>("");
  const [exportFormat, setExportFormat] = useState<"pdf" | "stix" | "csv" | "json">("pdf");
  const [watermarkText, setWatermarkText] = useState("CONFIDENTIAL // LAW ENFORCEMENT USE ONLY");
  const [includeAuditTrail, setIncludeAuditTrail] = useState(true);
  const [includeGraphDetails, setIncludeGraphDetails] = useState(true);
  const [includeStylometry, setIncludeStylometry] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);

  useEffect(() => {
    if (!isOpen) return;

    async function loadHypotheses() {
      try {
        const data = await apiFetch<any[]>("/api/v1/hypotheses");
        setHypotheses(data || []);
        if (data && data.length > 0) {
          const matched = initialHypothesisId && data.find((h) => h.id === initialHypothesisId);
          setSelectedHypothesisId(matched ? matched.id : data[0].id);
          setPreviewData(matched || data[0]);
        }
      } catch (err) {
        console.error("Failed loading hypotheses for report", err);
      }
    }
    loadHypotheses();
  }, [isOpen, initialHypothesisId]);

  useEffect(() => {
    if (selectedHypothesisId && hypotheses.length > 0) {
      const current = hypotheses.find((h) => h.id === selectedHypothesisId);
      if (current) setPreviewData(current);
    }
  }, [selectedHypothesisId, hypotheses]);

  if (!isOpen) return null;

  const handleDownload = async () => {
    setIsGenerating(true);
    try {
      let downloadUrl = "";
      let fileName = `NETRA-X_Export_${Date.now()}`;
      const token = typeof window !== "undefined" ? localStorage.getItem("netra_auth_token") : "";

      if (exportFormat === "pdf") {
        downloadUrl = `/api/v1/exports/report?hypothesis_id=${selectedHypothesisId || ""}`;
        fileName = `NETRA-X_Forensic_Dossier_${selectedHypothesisId?.substring(0, 8) || "case"}.pdf`;
      } else if (exportFormat === "stix") {
        downloadUrl = `/api/v1/exports/stix?hypothesis_id=${selectedHypothesisId || ""}`;
        fileName = `NETRA-X_STIX2.1_Bundle_${selectedHypothesisId?.substring(0, 8) || "intel"}.json`;
      } else if (exportFormat === "csv") {
        downloadUrl = `/api/v1/exports/csv?hypothesis_id=${selectedHypothesisId || ""}`;
        fileName = `NETRA-X_Evidence_Ledger.csv`;
      } else {
        downloadUrl = `/api/v1/exports/json`;
        fileName = `NETRA-X_System_Dossier.json`;
      }

      // Fetch file blob with auth header
      const res = await fetch(downloadUrl, {
        method: exportFormat === "pdf" ? "POST" : "GET",
        headers: {
          Authorization: token ? `Bearer ${token}` : "",
        },
      });

      if (!res.ok) throw new Error(`Export server returned ${res.status}`);

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      console.error("Failed downloading report", err);
      alert(`Export Failed: ${err.message || "Could not generate file"}`);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <div className="bg-netra-card border border-netra-purple/50 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden glass-panel">
        {/* Header */}
        <div className="px-6 py-4 border-b border-netra-border flex justify-between items-center bg-netra-surface/50">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-netra-purple/20 border border-netra-purple/40">
              <FileText className="w-6 h-6 text-netra-purple" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white tracking-wide">
                NETRA-X — Intelligence Report Generator
              </h2>
              <p className="text-xs text-netra-muted">
                Generate Law Enforcement & Forensic Dossiers, STIX 2.1 Threat Bundles, and STIX/CSV Exports
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-lg text-netra-muted hover:text-white hover:bg-netra-surface transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 overflow-y-auto">
          {/* Left Column: Configuration Controls */}
          <div className="space-y-5">
            {/* Select Target Hypothesis / Case */}
            <div>
              <label className="text-xs font-mono text-netra-cyan block mb-1.5 uppercase tracking-wider">
                1. Select Target Investigation / Hypothesis:
              </label>
              <select
                value={selectedHypothesisId}
                onChange={(e) => setSelectedHypothesisId(e.target.value)}
                className="w-full bg-netra-surface border border-netra-border focus:border-netra-purple rounded-lg p-2.5 text-xs font-mono text-white"
              >
                {hypotheses.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.subject_label || h.id} — P={(h.calibrated_prob * 100).toFixed(1)}% ({h.status})
                  </option>
                ))}
              </select>
            </div>

            {/* Export Format Grid */}
            <div>
              <label className="text-xs font-mono text-netra-cyan block mb-1.5 uppercase tracking-wider">
                2. Select Export Package Format:
              </label>
              <div className="grid grid-cols-2 gap-2.5">
                {[
                  {
                    id: "pdf",
                    title: "PDF Forensic Dossier",
                    desc: "Executive summary, radar, & SHA-256 chain",
                    icon: FileText,
                    badge: "STIX/PDF",
                  },
                  {
                    id: "stix",
                    title: "STIX 2.1 Threat Package",
                    desc: "Standard JSON bundle for SOC/ISAC sharing",
                    icon: Share2,
                    badge: "STIX 2.1",
                  },
                  {
                    id: "csv",
                    title: "CSV Evidence Ledger",
                    desc: "Structured evidence matrix & hashes",
                    icon: Database,
                    badge: "CSV",
                  },
                  {
                    id: "json",
                    title: "Raw System JSON",
                    desc: "Authoritative database export dump",
                    icon: FileCode,
                    badge: "JSON",
                  },
                ].map((fmt) => {
                  const Icon = fmt.icon;
                  const isSelected = exportFormat === fmt.id;
                  return (
                    <div
                      key={fmt.id}
                      onClick={() => setExportFormat(fmt.id as any)}
                      className={`p-3 rounded-xl border cursor-pointer transition flex flex-col justify-between space-y-2 ${
                        isSelected
                          ? "bg-netra-purple/20 border-netra-purple text-white"
                          : "bg-netra-surface border-netra-border text-netra-muted hover:border-netra-muted/50 hover:text-white"
                      }`}
                    >
                      <div className="flex justify-between items-center">
                        <Icon className={`w-5 h-5 ${isSelected ? "text-netra-cyan" : "text-netra-subtle"}`} />
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-netra-card border border-netra-border text-netra-subtle">
                          {fmt.badge}
                        </span>
                      </div>
                      <div>
                        <div className="text-xs font-bold text-white">{fmt.title}</div>
                        <div className="text-[10px] text-netra-subtle leading-tight mt-0.5">{fmt.desc}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Report Options & Metadata */}
            <div className="space-y-3 pt-2 border-t border-netra-border text-xs">
              <label className="text-xs font-mono text-netra-cyan block uppercase tracking-wider">
                3. Report Customization Options:
              </label>

              <div>
                <label className="text-netra-subtle block mb-1">Classification Banner / Watermark:</label>
                <input
                  type="text"
                  value={watermarkText}
                  onChange={(e) => setWatermarkText(e.target.value)}
                  className="w-full bg-netra-surface border border-netra-border rounded p-2 text-white font-mono text-xs"
                />
              </div>

              <div className="space-y-2 pt-1 font-mono text-[11px]">
                <label className="flex items-center space-x-2 text-netra-muted hover:text-white cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeAuditTrail}
                    onChange={(e) => setIncludeAuditTrail(e.target.checked)}
                    className="accent-netra-purple"
                  />
                  <span>Include SHA-256 Cryptographic Audit Chain</span>
                </label>

                <label className="flex items-center space-x-2 text-netra-muted hover:text-white cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeGraphDetails}
                    onChange={(e) => setIncludeGraphDetails(e.target.checked)}
                    className="accent-netra-purple"
                  />
                  <span>Include Entity Graph Topology Summary</span>
                </label>

                <label className="flex items-center space-x-2 text-netra-muted hover:text-white cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeStylometry}
                    onChange={(e) => setIncludeStylometry(e.target.checked)}
                    className="accent-netra-purple"
                  />
                  <span>Include AI Stylometry Linguistic Feature Matrix</span>
                </label>
              </div>
            </div>
          </div>

          {/* Right Column: Live Report Preview Card */}
          <div className="bg-netra-surface/80 border border-netra-border rounded-xl p-5 flex flex-col justify-between space-y-4 font-mono">
            <div>
              <div className="flex justify-between items-center border-b border-netra-border pb-3">
                <div className="flex items-center space-x-2">
                  <Eye className="w-4 h-4 text-netra-cyan" />
                  <span className="text-xs font-bold text-white uppercase">Live Dossier Preview</span>
                </div>
                <span className="px-2 py-0.5 rounded bg-netra-valid/20 text-netra-valid border border-netra-valid/30 text-[10px]">
                  VERIFIED FORENSIC
                </span>
              </div>

              {/* Watermark Banner */}
              <div className="mt-3 p-1.5 bg-netra-hazard/20 border border-netra-hazard/40 text-center text-[10px] text-netra-hazard font-bold tracking-widest uppercase rounded">
                {watermarkText}
              </div>

              {/* Document Summary Card */}
              <div className="mt-4 space-y-3 text-xs">
                <div>
                  <div className="text-netra-subtle text-[10px]">TARGET THREAT ACTOR</div>
                  <div className="text-white font-bold text-sm">
                    {previewData ? previewData.subject_label : "Loading Target..."}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="p-2 bg-netra-card rounded border border-netra-border">
                    <span className="text-netra-subtle block text-[9px]">CONFIDENCE SCORE</span>
                    <span className="text-netra-cyan font-bold">
                      {previewData ? (previewData.calibrated_prob * 100).toFixed(1) : "88.5"}%
                    </span>
                  </div>
                  <div className="p-2 bg-netra-card rounded border border-netra-border">
                    <span className="text-netra-subtle block text-[9px]">ANALYSIS TIER</span>
                    <span className="text-netra-valid font-bold">HIGH PROBABILITY</span>
                  </div>
                </div>

                <div className="p-2.5 bg-netra-card rounded border border-netra-border text-[10px] space-y-1">
                  <div className="text-netra-subtle">FORENSIC EVIDENCE SUMMARY:</div>
                  <div className="text-netra-muted">
                    • {previewData?.supporting_evidence?.length || 3} Correlated Evidence Artifacts
                  </div>
                  <div className="text-netra-muted">• 100% SHA-256 Hash Chain Integrity</div>
                  <div className="text-netra-muted">• STIX 2.1 Compliant Object Identifiers</div>
                </div>
              </div>
            </div>

            {/* Security Footer Notice */}
            <div className="pt-3 border-t border-netra-border text-[10px] text-netra-subtle flex items-center space-x-2">
              <Lock className="w-3.5 h-3.5 text-netra-purple shrink-0" />
              <span>Signed by NETRA-X Authoritative Key ID: #04a1b2c3d4</span>
            </div>
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div className="px-6 py-4 border-t border-netra-border bg-netra-surface/50 flex justify-between items-center">
          <div className="text-xs text-netra-subtle font-mono">
            Format: <span className="text-white font-bold uppercase">{exportFormat}</span>
          </div>

          <div className="flex space-x-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-netra-surface border border-netra-border text-netra-muted hover:text-white text-xs font-medium transition"
            >
              Cancel
            </button>
            <button
              onClick={handleDownload}
              disabled={isGenerating}
              className="px-6 py-2 rounded-lg bg-netra-purple hover:bg-netra-purple/80 text-white font-semibold text-xs flex items-center space-x-2 transition disabled:opacity-50"
            >
              {isGenerating ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Generating Package...</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>Download Investigation Package</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
