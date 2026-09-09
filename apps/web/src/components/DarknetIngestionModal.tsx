"use client";

import React, { useState } from "react";
import {
  Globe, ShieldAlert, Zap, Terminal, CheckCircle2, Hash, FileCode,
  X, Activity, ArrowRight, Database, Lock, AlertTriangle, Layers
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { useToast } from "./StatusToasts";

interface DarknetIngestionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate?: (view: string) => void;
}

export const DarknetIngestionModal: React.FC<DarknetIngestionModalProps> = ({
  isOpen,
  onClose,
  onNavigate,
}) => {
  const toast = useToast();
  const [sourceUri, setSourceUri] = useState("http://darkmarketx37ab.onion/threads/lockbit-vortex99");
  const [sourceName, setSourceName] = useState("Darknet_Exploit_Forum_Mirror");
  // Sample payload for the demo. The addresses here are format-valid on
  // purpose: the previous sample used a truncated bech32 wallet and a 67-char
  // XMR string, which the extractor correctly rejected -- so the modal
  // reported one entity extracted from a page that visibly listed several,
  // and the XMR abstention never triggered.
  const [rawContent, setRawContent] = useState(
    `[Exploit.in Forum Post #88912]
User: Vortex99 (Alias: ShadowByte)
PGP Key Fingerprint: 4F3B 8C90 1234 5678 9ABC DEF0 4A8F 912C 9012 3456
Deposit Wallet: bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq
Legacy Wallet: 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa
ETH Payout: 0x742d35Cc6634C0532925a3b844Bc454e4438f44e
XMR Address: 4A4BJRYfnu29GPWdksz7EMUbiqx5CKSZgov3AHQXemt18FNVcjry6DLTahpw4BJRYfnu29GPWdksz7EMUbiqx5CKSZgov3A
Mirror: http://chmrw3afkpuz6dinsx4bglqv27ejoty5chmrw3afkpuz6dinsx4bglqv.onion/thread/88912
Contact Jabber: shadow_vortex99@jabber.cz
Description: Selling initial access credentials to ransomware targets. Payment via BTC co-spending or XMR.`
  );

  const [pipelineStep, setPipelineStep] = useState<number>(0);
  const [isCrawling, setIsCrawling] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleStartIngestion = async () => {
    if (!rawContent.trim()) return;

    setIsCrawling(true);
    setPipelineStep(1);
    setResult(null);
    setError(null);

    // Simulate animated step progression for live demo visual effect
    setTimeout(() => setPipelineStep(2), 700);
    setTimeout(() => setPipelineStep(3), 1400);

    try {
      setTimeout(async () => {
        setPipelineStep(4);
        try {
          const res = await apiFetch<any>("/api/v1/evidence", {
            method: "POST",
            body: JSON.stringify({
              raw_content: rawContent,
              source_name: sourceName,
              source_type: "FORUM_CRAWL",
              lawful_basis: "PASSIVE_OSINT",
              source_uri: sourceUri,
            }),
          });

          setResult(res);
          setPipelineStep(5);
          toast.push(
            "ok",
            "Ingestion & WARC Archival Complete",
            `Extracted ${res.extracted_count} evidence entities • SHA-256: ${res.artifact_sha256.substring(0, 12)}...`
          );
        } catch (err: any) {
          /*
           * No mock fallback.
           *
           * This branch used to fabricate a successful ingestion when the
           * request failed: invented evidence ids, a made-up PGP key and BTC
           * wallet, and artifact_sha256 e3b0c442...b855 -- the SHA-256 of the
           * empty string -- then raised an "Ingestion Complete" toast. On
           * screen that is indistinguishable from a real crawl, so a backend
           * outage during a demo would look like a working pipeline, and the
           * counts did not even agree with each other (extracted_count 4
           * against three listed items).
           *
           * A failed ingestion has to look like a failed ingestion.
           */
          setError(err?.message ?? "Ingestion failed. No evidence was written to the ledger.");
          setPipelineStep(0);
          toast.push("error", "Ingestion Failed", "No evidence was written to the ledger.");
        } finally {
          setIsCrawling(false);
        }
      }, 2100);
    } catch (err: any) {
      setIsCrawling(false);
      setPipelineStep(0);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <div className="bg-netra-card border border-netra-cyan/50 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden glass-panel font-sans">
        {/* Header */}
        <div className="px-6 py-4 border-b border-netra-border flex justify-between items-center bg-netra-surface/50">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-netra-cyan/20 border border-netra-cyan/40">
              <Globe className="w-6 h-6 text-netra-cyan animate-pulse" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white tracking-wide flex items-center space-x-2">
                <span>Live Darknet Ingestion & WARC Crawl Launcher</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-netra-cyan/20 text-netra-cyan border border-netra-cyan/40">
                  REAL-TIME TOR CRAWLER
                </span>
              </h2>
              <p className="text-xs text-netra-muted">
                Execute Tor v3 Crawls, Archive WARC Payloads, Extract Entities & Append SHA-256 Audit Chain
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
          {/* Left Column: Target Inputs */}
          <div className="space-y-4 font-mono text-xs">
            <div>
              <label className="text-netra-cyan block mb-1 text-[11px] uppercase tracking-wider">
                1. Target Onion URL / Endpoint:
              </label>
              <input
                type="text"
                value={sourceUri}
                onChange={(e) => setSourceUri(e.target.value)}
                placeholder="e.g. http://darkmarketx37ab.onion/thread/992"
                className="w-full bg-netra-surface border border-netra-border focus:border-netra-cyan rounded-lg p-2.5 text-white font-mono text-xs focus:outline-none"
              />
            </div>

            <div>
              <label className="text-netra-cyan block mb-1 text-[11px] uppercase tracking-wider">
                2. Intelligence Source Name:
              </label>
              <input
                type="text"
                value={sourceName}
                onChange={(e) => setSourceName(e.target.value)}
                placeholder="e.g. Exploit.in_Forum_Thread"
                className="w-full bg-netra-surface border border-netra-border focus:border-netra-cyan rounded-lg p-2.5 text-white font-mono text-xs focus:outline-none"
              />
            </div>

            <div>
              <label className="text-netra-cyan block mb-1 text-[11px] uppercase tracking-wider">
                3. Raw HTML / Forum Payload Box:
              </label>
              <textarea
                rows={6}
                value={rawContent}
                onChange={(e) => setRawContent(e.target.value)}
                placeholder="Paste darknet forum post or HTML content containing BTC wallets, PGP keys, emails..."
                className="w-full bg-netra-surface border border-netra-border focus:border-netra-cyan rounded-lg p-2.5 text-white font-mono text-[11px] placeholder-netra-subtle focus:outline-none leading-relaxed"
              />
            </div>

            <button
              onClick={handleStartIngestion}
              disabled={isCrawling || !rawContent.trim()}
              className="w-full py-3 bg-netra-cyan text-netra-bg hover:bg-netra-cyan/90 font-bold text-xs rounded-lg flex items-center justify-center space-x-2 transition disabled:opacity-50 uppercase tracking-wider"
            >
              {isCrawling ? (
                <>
                  <Activity className="w-4 h-4 animate-spin" />
                  <span>Executing Pipeline...</span>
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  <span>Execute Ingestion Pipeline</span>
                </>
              )}
            </button>
          </div>

          {/* Right Column: Animated Telemetry Log & Output */}
          <div className="bg-netra-surface/90 border border-netra-border rounded-xl p-5 flex flex-col justify-between space-y-4 font-mono">
            <div>
              <div className="flex justify-between items-center border-b border-netra-border pb-3">
                <div className="flex items-center space-x-2">
                  <Terminal className="w-4 h-4 text-netra-cyan" />
                  <span className="text-xs font-bold text-white uppercase">Pipeline Live Telemetry</span>
                </div>
                <span className="text-[10px] text-netra-subtle">TOR SOCKS5 PROXY</span>
              </div>

              {/* Sequential Steps Log */}
              <div className="mt-4 space-y-3 text-[11px]">
                {[
                  { step: 1, label: "1. Tor Circuit & Relay Routing", desc: "Socks5 proxy handshake established." },
                  { step: 2, label: "2. WARC Spec Payload Archival", desc: "Generating tamper-proof WARC headers & raw bytes." },
                  { step: 3, label: "3. Cryptographic Hash Digest", desc: "SHA-256 digest tree calculated." },
                  { step: 4, label: "4. Worker Entity Extraction", desc: "Regex & NLP parsing for BTC, PGP, XMR, Email." },
                  { step: 5, label: "5. Ledger Audit Chain Written", desc: "Appended to authoritative ledger & hash chain." },
                ].map((s) => {
                  const isActive = pipelineStep === s.step;
                  const isDone = pipelineStep > s.step;
                  return (
                    <div
                      key={s.step}
                      className={`p-2.5 rounded-lg border transition ${
                        isDone
                          ? "bg-netra-valid/10 border-netra-valid/30 text-netra-valid"
                          : isActive
                          ? "bg-netra-cyan/20 border-netra-cyan text-white animate-pulse"
                          : "bg-netra-card/50 border-netra-border/50 text-netra-subtle opacity-60"
                      }`}
                    >
                      <div className="flex justify-between items-center font-bold">
                        <span>{s.label}</span>
                        {isDone ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-netra-valid" />
                        ) : isActive ? (
                          <Activity className="w-3.5 h-3.5 text-netra-cyan animate-spin" />
                        ) : null}
                      </div>
                      <div className="text-[10px] text-netra-muted mt-0.5">{s.desc}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Failure has to be visible: the modal previously rendered a
                fabricated success in this situation. */}
            {error && (
              <div className="p-3 bg-netra-red/10 border border-netra-red/50 rounded-lg text-[11px] font-mono text-netra-red space-y-1">
                <div className="font-bold border-b border-netra-red/30 pb-1">INGESTION FAILED</div>
                <div className="break-all">{error}</div>
                <div className="text-netra-muted">
                  Nothing was written to the evidence ledger. Confirm the API is reachable and retry.
                </div>
              </div>
            )}

            {/* Results Output Summary */}
            {result && (
              <div className="p-3 bg-netra-card border border-netra-valid/40 rounded-lg space-y-2 text-[11px] animate-in fade-in">
                <div className="flex justify-between items-center text-netra-valid font-bold border-b border-netra-border pb-1">
                  <span>INGESTION SUCCESSFUL</span>
                  <span>{result.extracted_count} Entities Found</span>
                </div>
                <div>
                  <span className="text-netra-subtle">SHA-256: </span>
                  <span className="text-white font-bold">{result.artifact_sha256.substring(0, 24)}...</span>
                </div>
                {result.xmr_abstain && (
                  <div className="text-netra-amber text-[10px] flex items-center space-x-1">
                    <AlertTriangle className="w-3 h-3" />
                    <span>Monero address detected — flagged for privacy abstention.</span>
                  </div>
                )}

                {onNavigate && (
                  <div className="pt-2 flex space-x-2">
                    <button
                      onClick={() => {
                        onClose();
                        onNavigate("evidence_vault");
                      }}
                      className="flex-1 py-1 bg-netra-purple/20 border border-netra-purple/40 text-netra-purple hover:text-white text-[10px] rounded transition text-center"
                    >
                      View in Vault
                    </button>
                    <button
                      onClick={() => {
                        onClose();
                        onNavigate("graph_explorer");
                      }}
                      className="flex-1 py-1 bg-netra-cyan/20 border border-netra-cyan/40 text-netra-cyan hover:text-white text-[10px] rounded transition text-center"
                    >
                      Explore in Graph
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-netra-border bg-netra-surface/50 flex justify-between items-center">
          <div className="text-xs text-netra-subtle font-mono flex items-center space-x-2">
            <Lock className="w-3.5 h-3.5 text-netra-valid" />
            <span>Lawful Basis: PASSIVE OSINT (Cryptographic Proof Chain)</span>
          </div>

          <button
            onClick={onClose}
            className="px-5 py-2 rounded-lg bg-netra-surface border border-netra-border text-netra-muted hover:text-white text-xs font-medium transition"
          >
            Close Modal
          </button>
        </div>
      </div>
    </div>
  );
};
