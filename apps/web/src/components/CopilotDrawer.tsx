"use client";

import React, { useState } from "react";
import { Bot, X, Send, ShieldAlert, Sparkles, Hash, Trash2, Download, HelpCircle } from "lucide-react";
import { apiFetch } from "../lib/api";

interface CopilotDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CopilotDrawer: React.FC<CopilotDrawerProps> = ({ isOpen, onClose }) => {
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<Array<{ sender: "user" | "ai"; text: string; evidenceIds?: string[] }>>([
    {
      sender: "ai",
      text: "Greetings Analyst. I am the NETRA-X Constrained Intelligence Copilot. Ask me about threat actor linkages, evidence provenance, PGP keys, or crypto wallet clusters. I generate hypothesis summaries only and never decide primary attribution.",
    },
  ]);
  const [loading, setLoading] = useState(false);

  const presetQueries = [
    "Summarize LockBit operator PGP & Wallet links",
    "Explain SHA-256 evidence chain of custody",
    "Track BTC wallet co-spending clusters",
    "Show stylometry linguistic match score",
  ];

  if (!isOpen) return null;

  const handleSend = async (customQuery?: string) => {
    const textToSend = customQuery || query;
    if (!textToSend.trim()) return;

    setQuery("");
    setMessages((prev) => [...prev, { sender: "user", text: textToSend }]);
    setLoading(true);

    try {
      const res = await apiFetch<any>(`/api/v1/copilot/query?query_text=${encodeURIComponent(textToSend)}`, {
        method: "POST",
      });

      setMessages((prev) => [
        ...prev,
        {
          sender: "ai",
          text: res.response,
          evidenceIds: res.referenced_evidence_ids,
        },
      ]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        { sender: "ai", text: `Copilot service error: ${err.message}` },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleClearHistory = () => {
    setMessages([
      {
        sender: "ai",
        text: "Copilot session reset. Ready for new intelligence queries.",
      },
    ]);
  };

  const handleExportChat = () => {
    const chatText = messages
      .map((m) => `[${m.sender.toUpperCase()}]: ${m.text}`)
      .join("\n\n");
    const blob = new Blob([chatText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `NETRA-X_Copilot_Transcript_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-netra-card border-l border-netra-border z-50 flex flex-col glass-panel font-sans">
      {/* Header */}
      <div className="p-4 border-b border-netra-border flex items-center justify-between bg-netra-surface">
        <div className="flex items-center space-x-2">
          <div className="p-1.5 rounded-lg bg-netra-purple/20 border border-netra-purple/40">
            <Bot className="w-5 h-5 text-netra-purple" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white">AI Intelligence Copilot</h2>
            <span className="text-[10px] text-netra-cyan font-mono">CONSTRAINED TO LEDGER</span>
          </div>
        </div>

        <div className="flex items-center space-x-1">
          <button
            onClick={handleExportChat}
            title="Export Chat Transcript"
            className="p-1.5 text-netra-subtle hover:text-white hover:bg-netra-hover rounded transition"
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            onClick={handleClearHistory}
            title="Clear Chat History"
            className="p-1.5 text-netra-subtle hover:text-netra-hazard hover:bg-netra-hazard/10 rounded transition"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button onClick={onClose} className="p-1.5 text-netra-subtle hover:text-white transition">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Preset Suggestion Chips */}
      <div className="p-3 border-b border-netra-border bg-netra-surface/50 space-y-1.5">
        <div className="text-[10px] font-mono text-netra-cyan flex items-center space-x-1 uppercase">
          <Sparkles className="w-3 h-3 text-netra-cyan" />
          <span>Quick Investigation Queries:</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {presetQueries.map((preset, i) => (
            <button
              key={i}
              onClick={() => handleSend(preset)}
              disabled={loading}
              className="text-[10px] bg-netra-card border border-netra-border hover:border-netra-purple/60 text-netra-muted hover:text-white px-2 py-1 rounded transition text-left leading-tight"
            >
              {preset}
            </button>
          ))}
        </div>
      </div>

      {/* Messages Feed */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
        {messages.map((m, idx) => (
          <div
            key={idx}
            className={`p-3 rounded-xl space-y-1.5 ${
              m.sender === "user"
                ? "bg-netra-purple/20 text-white border border-netra-purple/40 ml-6"
                : "bg-netra-surface text-netra-text border border-netra-border mr-4"
            }`}
          >
            <div className="font-bold text-[10px] text-netra-subtle font-mono uppercase flex justify-between items-center">
              <span>{m.sender === "user" ? "Investigator" : "NETRA-X Copilot"}</span>
              {m.sender === "ai" && (
                <span className="text-[9px] text-netra-valid font-mono">VERIFIED DATASET</span>
              )}
            </div>
            <p className="leading-relaxed font-sans">{m.text}</p>

            {m.evidenceIds && m.evidenceIds.length > 0 && (
              <div className="pt-2 border-t border-netra-border/60 space-y-1 text-[10px] font-mono text-netra-cyan">
                <div>Referenced Evidence Provenance IDs:</div>
                <div className="flex flex-wrap gap-1">
                  {m.evidenceIds.slice(0, 3).map((id) => (
                    <span
                      key={id}
                      className="px-1.5 py-0.5 rounded bg-netra-card border border-netra-purple/30 text-netra-purple flex items-center space-x-1"
                    >
                      <Hash className="w-2.5 h-2.5" />
                      <span>{id.substring(0, 10)}...</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="flex items-center space-x-2 text-netra-purple text-xs font-mono p-3 bg-netra-surface rounded-xl border border-netra-border animate-pulse">
            <Sparkles className="w-4 h-4 animate-spin text-netra-cyan" />
            <span>Querying authoritative evidence ledger...</span>
          </div>
        )}
      </div>

      {/* Footer Disclaimer & Input */}
      <div className="p-3 border-t border-netra-border bg-netra-surface space-y-2">
        <div className="flex items-center space-x-2 bg-netra-bg p-2.5 rounded-lg border border-netra-border focus-within:border-netra-purple transition">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="Ask Copilot about handles, wallets, or evidence..."
            className="flex-1 bg-transparent text-xs text-white placeholder-netra-subtle focus:outline-none"
          />
          <button
            onClick={() => handleSend()}
            disabled={loading || !query.trim()}
            className="p-1.5 rounded-md bg-netra-purple text-white hover:bg-netra-purple/80 transition disabled:opacity-50"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="text-[9px] text-netra-subtle text-center font-mono">
          AI assists with explainability. Primary attribution requires analyst verification.
        </div>
      </div>
    </div>
  );
};
