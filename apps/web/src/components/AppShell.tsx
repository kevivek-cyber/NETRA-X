"use client";

/**
 * Operator chrome.
 *
 * The previous shell was a translucent blurred header over a rounded-pill
 * sidebar -- a generic SaaS dashboard frame wrapped around an intelligence
 * tool. This is a console frame instead: a classification strip, a dense
 * instrument header, a rail with hard selection markers, and a telemetry
 * ticker pinned to the floor.
 *
 * The status readouts are wired to real endpoints. `/api/v1/config/engine`
 * reports which storage backend is actually in use (SQLite in the desktop
 * build, Postgres in the compose stack) and `/api/v1/audit/verify` reports
 * whether the hash chain currently validates. Both used to be hardcoded to
 * flattering constants, which in an evidence-integrity product is the one
 * thing the chrome must never do.
 */

import React, { useEffect, useState } from "react";
import {
  Activity, Bot, CheckCircle2, FileSearch, FileText, GitMerge,
  LayoutDashboard, ListTree, Lock, LogOut, Search, ShieldAlert, Users, Globe,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { LiveTicker, UtcClock } from "./viz/LiveTicker";
import { Waveform } from "./viz/Sparkline";

interface AppShellProps {
  currentView: string;
  onNavigate: (view: string) => void;
  userEmail: string;
  onLogout: () => void;
  onOpenCopilot: () => void;
  onOpenReportModal?: () => void;
  onOpenIngestionModal?: () => void;
  children: React.ReactNode;
}

const NAV_SECTIONS = [
  {
    category: "Threat Ops",
    items: [
      { id: "command_center", label: "Command Center", icon: LayoutDashboard, code: "01" },
      { id: "cases", label: "Investigations", icon: FileSearch, code: "02" },
      { id: "actors", label: "Actor Explorer", icon: Users, code: "03" },
    ],
  },
  {
    category: "Analytics",
    items: [
      { id: "attribution_lab", label: "Attribution Lab", icon: GitMerge, code: "04" },
      { id: "graph_explorer", label: "Intelligence Graph", icon: ListTree, code: "05" },
    ],
  },
  {
    category: "Forensic Ledger",
    items: [
      { id: "evidence_vault", label: "Evidence Vault", icon: FileText, code: "06" },
      { id: "audit_log", label: "Audit Chain", icon: Lock, code: "07" },
    ],
  },
];

interface SystemState {
  backend: string | null;
  model: string | null;
  chainValid: boolean | null;
  chainLength: number | null;
}

export const AppShell: React.FC<AppShellProps> = ({
  currentView,
  onNavigate,
  userEmail,
  onLogout,
  onOpenCopilot,
  onOpenReportModal,
  onOpenIngestionModal,
  children,
}) => {
  const [sys, setSys] = useState<SystemState>({
    backend: null,
    model: null,
    chainValid: null,
    chainLength: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function loadStatus() {
      // Settled independently: a failing audit verify must not blank out the
      // engine readout, and vice versa. Anything that fails stays null and
      // renders as an explicit unknown rather than a comforting default.
      const [engine, audit] = await Promise.allSettled([
        apiFetch<any>("/api/v1/config/engine"),
        apiFetch<any>("/api/v1/audit/verify"),
      ]);
      if (cancelled) return;

      setSys({
        backend: engine.status === "fulfilled" ? engine.value.storage_backend : null,
        model: engine.status === "fulfilled" ? engine.value.model_version : null,
        chainValid:
          audit.status === "fulfilled" ? Boolean(audit.value.chain_valid) : null,
        chainLength:
          audit.status === "fulfilled" ? audit.value.total_records ?? null : null,
      });
    }

    loadStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  const chainLabel =
    sys.chainValid === null ? "UNVERIFIED" : sys.chainValid ? "INTACT" : "BROKEN";
  const chainColor =
    sys.chainValid === null
      ? "text-netra-muted"
      : sys.chainValid
      ? "text-netra-valid"
      : "text-netra-red";

  const tickerItems = [
    `LEDGER BACKEND ${sys.backend ?? "UNKNOWN"}`,
    `AUDIT CHAIN ${chainLabel}${sys.chainLength != null ? ` / ${sys.chainLength} ENTRIES` : ""}`,
    `FUSION MODEL ${sys.model ?? "UNKNOWN"}`,
    "GRAPH PROJECTION RELATIONAL FALLBACK",
    "EVIDENCE ARTIFACTS SHA-256 SEALED",
    "COLLECTION PASSIVE / LEGAL ONLY",
    "AI ASSISTS - ANALYST DECIDES",
  ];

  return (
    <div className="h-screen bg-netra-bg text-netra-text flex flex-col font-sans overflow-hidden">
      {/* --- CLASSIFICATION STRIP ------------------------------------------ */}
      <div className="hazard-stripe border-b border-netra-border bg-netra-surface flex items-center justify-between px-4 h-7 shrink-0 text-[10px] font-mono tracking-telemetry uppercase">
        <div className="flex items-center gap-3">
          <span className="text-netra-red font-bold">Restricted</span>
          <span className="text-netra-subtle hidden md:inline">
            Authorized Research / Law-Enforcement Use Only
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className={`hidden sm:inline ${chainColor}`}>CHAIN {chainLabel}</span>
          <UtcClock className="text-netra-text" />
        </div>
      </div>

      {/* --- INSTRUMENT HEADER --------------------------------------------- */}
      <header className="h-14 border-b border-netra-border bg-netra-surface px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <img
            src="/netra-x-mark.png"
            alt=""
            aria-hidden="true"
            width={36}
            height={36}
            className="w-9 h-9 object-contain select-none"
            draggable={false}
          />
          <span
            className="glitch-img align-middle"
            style={{ ["--glitch-src" as string]: "url(/netra-x-wordmark.png)" } as React.CSSProperties}
          >
            <img
              src="/netra-x-wordmark.png"
              alt="NETRA-X"
              height={20}
              className="h-5 w-auto block select-none"
              draggable={false}
            />
          </span>

          {/* Live engine readouts, hairline-separated like an instrument cluster. */}
          <dl className="hidden xl:flex items-stretch border-l border-netra-border ml-2 pl-4 gap-5 font-mono text-[10px]">
            <div>
              <dt className="telemetry-label">Backend</dt>
              <dd className="text-netra-text">{sys.backend ?? "----"}</dd>
            </div>
            <div>
              <dt className="telemetry-label">Model</dt>
              <dd className="text-netra-text">{sys.model ?? "----"}</dd>
            </div>
            <div>
              <dt className="telemetry-label">Chain</dt>
              <dd className={chainColor}>{chainLabel}</dd>
            </div>
          </dl>
        </div>

        <div className="flex items-center gap-3">
          {/* Ingest signal meter -- shows the collection channel is open. */}
          <div className="hidden lg:flex items-center gap-2 border border-netra-border px-2.5 h-8">
            <Activity className="w-3 h-3 text-netra-valid" />
            <Waveform width={64} height={14} bars={18} />
          </div>

          <button
            onClick={onOpenCopilot}
            className="flex items-center gap-2 h-8 px-3 border border-netra-border bg-netra-card text-netra-text font-mono text-[10px] uppercase tracking-telemetry hover:border-netra-purple hover:text-netra-purple transition-colors"
          >
            <Bot className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Copilot</span>
          </button>

          <button
            onClick={() =>
              window.dispatchEvent(
                new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true })
              )
            }
            title="Command palette"
            aria-label="Open command palette"
            className="hidden lg:flex items-center gap-2 h-8 px-3 border border-netra-border bg-netra-card text-netra-subtle font-mono text-[10px] hover:text-netra-text hover:border-netra-purple transition-colors"
          >
            <Search className="w-3 h-3" />
            <kbd className="tracking-telemetry">CTRL+K</kbd>
          </button>

          <div className="flex items-center gap-2.5 border-l border-netra-border pl-3 h-8">
            <div className="text-right hidden sm:block leading-tight">
              <div className="telemetry-label">Operator</div>
              <div className="font-mono text-[10px] text-netra-text">{userEmail}</div>
            </div>
            <button
              onClick={onLogout}
              className="p-1.5 text-netra-subtle hover:text-netra-red transition-colors"
              title="Terminate session"
              aria-label="Log out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* --- BODY ----------------------------------------------------------- */}
      <div className="flex flex-1 min-h-0">
        {/* RAIL */}
        <aside className="w-56 border-r border-netra-border bg-netra-surface flex flex-col shrink-0">
          {onOpenIngestionModal && (
            <button
              onClick={onOpenIngestionModal}
              className="key-press group m-3 h-10 bg-netra-purple text-netra-bg font-mono text-[10px] font-bold uppercase tracking-telemetry flex items-center justify-center gap-2 hover:bg-netra-text transition-colors shrink-0"
            >
              <Globe className="w-3.5 h-3.5" />
              <span>Crawl .onion</span>
            </button>
          )}

          <nav className="flex-1 overflow-y-auto thin-scroll">
            {NAV_SECTIONS.map((sec) => (
              <div key={sec.category} className="mb-1">
                <div className="px-3 py-2 telemetry-label border-b border-netra-border">
                  {sec.category}
                </div>
                {sec.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = currentView === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => onNavigate(item.id)}
                      data-active={isActive}
                      aria-current={isActive ? "page" : undefined}
                      className={`nav-item w-full flex items-center gap-2.5 pl-4 pr-3 h-10 text-left transition-colors ${
                        isActive
                          ? "bg-netra-card text-netra-text"
                          : "text-netra-muted hover:bg-netra-hover hover:text-netra-text"
                      }`}
                    >
                      <Icon
                        className={`w-3.5 h-3.5 shrink-0 ${
                          isActive ? "text-netra-purple" : "text-netra-subtle"
                        }`}
                      />
                      <span className="text-[11px] font-medium flex-1 truncate">
                        {item.label}
                      </span>
                      <span className="font-mono text-[9px] text-netra-subtle tabular-nums">
                        {item.code}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          {/* Rail footer: the product's governing rule, stated as a placard. */}
          <div className="border-t border-netra-border p-3 shrink-0">
            <div className="flex items-center gap-1.5 mb-1.5">
              <CheckCircle2
                className={`w-3 h-3 ${
                  sys.chainValid === false ? "text-netra-red" : "text-netra-valid"
                }`}
              />
              <span className="telemetry-label text-netra-text">Evidence Ledger</span>
            </div>
            <p className="text-[10px] leading-relaxed text-netra-subtle">
              Append-only SHA-256 chain.
              <br />
              AI assists <span className="text-netra-purple">//</span> analyst decides.
            </p>
          </div>
        </aside>

        {/* VIEWPORT */}
        <main className="flex-1 min-w-0 overflow-y-auto bg-netra-bg p-6">{children}</main>
      </div>

      {/* --- TELEMETRY FLOOR ------------------------------------------------ */}
      <div className="border-t border-netra-border bg-netra-surface h-7 flex items-center shrink-0 font-mono text-[10px] tracking-telemetry uppercase text-netra-muted">
        <div className="flex items-center gap-2 px-3 border-r border-netra-border h-full shrink-0">
          <span className="w-1.5 h-1.5 bg-netra-valid live-dot" />
          <span className="text-netra-valid hidden sm:inline">Live</span>
        </div>
        <LiveTicker items={tickerItems} duration={70} className="flex-1" />
      </div>
    </div>
  );
};
