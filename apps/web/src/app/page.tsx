"use client";

import React, { useEffect, useState } from "react";
import { apiFetch, getAuthToken, setAuthToken } from "../lib/api";
import { LiveProvider } from "../lib/live";
import { LoginScreen } from "../components/LoginScreen";
import { AppShell } from "../components/AppShell";
import { BootSequence } from "../components/BootSequence";
import { CommandCenter } from "../components/CommandCenter";
import { ActorProfile } from "../components/ActorProfile";
import { AttributionLab } from "../components/AttributionLab";
import { GraphExplorer } from "../components/GraphExplorer";
import { EvidenceVault } from "../components/EvidenceVault";
import { AuditLogViewer } from "../components/AuditLogViewer";
import { CasesView } from "../components/CasesView";
import { CopilotDrawer } from "../components/CopilotDrawer";
import { CommandPalette } from "../components/CommandPalette";
import { ToastProvider } from "../components/StatusToasts";
import { ReportGeneratorModal } from "../components/ReportGeneratorModal";
import { DarknetIngestionModal } from "../components/DarknetIngestionModal";

export default function Home() {
  const [user, setUser] = useState<any>(null);
  const [currentView, setCurrentView] = useState("command_center");
  const [selectedTargetId, setSelectedTargetId] = useState<string | undefined>(undefined);
  const [isCopilotOpen, setIsCopilotOpen] = useState(false);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [isIngestionModalOpen, setIsIngestionModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  /**
   * The preflight runs on every launch -- a fresh sign-in and a restored
   * session alike.
   *
   * It originally ran only after sign-in, on the reasoning that an analyst
   * reloading mid-investigation should not be made to watch a boot screen.
   * That was wrong for the shape this actually ships in: the desktop window
   * keeps its token, so every launch after the first restored a session and
   * skipped straight past the preflight. The screen effectively never ran, and
   * the one moment its checks are most worth seeing -- a cold start, before
   * any work is done -- was the exact moment it was suppressed.
   *
   * ESC still skips it, so the reload case costs a keypress rather than a
   * design compromise.
   */
  const [booting, setBooting] = useState(false);

  useEffect(() => {
    async function checkSession() {
      const token = getAuthToken();
      if (!token) {
        setLoading(false);
        return;
      }
      try {
        const u = await apiFetch<any>("/api/v1/auth/me");
        setUser(u);
        setBooting(true);
      } catch (err) {
        console.error("Session invalid", err);
        setAuthToken("");
      } finally {
        setLoading(false);
      }
    }
    checkSession();
  }, []);

  const handleLoginSuccess = (u: any) => {
    setUser(u);
    setBooting(true);
  };

  const handleNavigate = (view: string, targetId?: string) => {
    setCurrentView(view);
    if (targetId) {
      setSelectedTargetId(targetId);
    }
  };

  const handleLogout = () => {
    setAuthToken("");
    setUser(null);
  };

  if (loading) {
    // First paint, before the session check resolves. This is the very first
    // thing drawn on a cold start, so it uses the same console language as
    // everything after it rather than a centred pulsing sentence.
    return (
      <div className="min-h-screen bg-netra-bg flex items-center justify-center p-6">
        <div className="absolute inset-0 blueprint-bg pointer-events-none" aria-hidden="true" />
        <div className="relative border border-netra-border bg-netra-card px-6 py-5 min-w-[300px]">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-1.5 h-1.5 bg-netra-purple live-dot" />
            <span className="telemetry-label text-netra-text">Initializing</span>
          </div>
          <p className="font-mono text-[11px] text-netra-muted">
            Resolving operator session
            <span className="caret-blink">_</span>
          </p>
          <div className="mt-4 h-px w-full bg-netra-border" />
          <p className="mt-3 telemetry-label">NETRA-X / Tactical Telemetry</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen onLoginSuccess={handleLoginSuccess} />;
  }

  if (booting) {
    return (
      <BootSequence operator={user.email} onComplete={() => setBooting(false)} />
    );
  }

  return (
    <ToastProvider>
      {/* Inside ToastProvider so teammate activity can announce itself, and
          outside the views so one poller serves all of them. */}
      <LiveProvider userEmail={user.email}>
      <CommandPalette
        onNavigate={handleNavigate}
        onOpenCopilot={() => setIsCopilotOpen(true)}
        onLogout={handleLogout}
      />
      <AppShell
        currentView={currentView}
        onNavigate={handleNavigate}
        userEmail={user.email}
        onLogout={handleLogout}
        onOpenCopilot={() => setIsCopilotOpen(true)}
        onOpenReportModal={() => setIsReportModalOpen(true)}
        onOpenIngestionModal={() => setIsIngestionModalOpen(true)}
      >
      {/* Keyed on the view id so the enter animation replays on every module
          change; without the key React reuses the node and nothing animates. */}
      <div key={currentView} className="view-enter">
      {currentView === "command_center" && (
        <CommandCenter
          onNavigate={handleNavigate}
          onOpenReportModal={() => setIsReportModalOpen(true)}
          onOpenIngestionModal={() => setIsIngestionModalOpen(true)}
        />
      )}
      {currentView === "cases" && <CasesView />}
      {currentView === "actors" && (
        <ActorProfile
          actorId={selectedTargetId}
          onBack={() => setCurrentView("command_center")}
          onNavigate={handleNavigate}
          onOpenReportModal={() => setIsReportModalOpen(true)}
        />
      )}
      {currentView === "attribution_lab" && (
        <AttributionLab
          hypothesisId={selectedTargetId}
          onNavigate={handleNavigate}
        />
      )}
      {currentView === "graph_explorer" && (
        <GraphExplorer actorId={selectedTargetId} onNavigate={handleNavigate} />
      )}
      {currentView === "evidence_vault" && (
        <EvidenceVault onOpenIngestionModal={() => setIsIngestionModalOpen(true)} />
      )}
      {currentView === "audit_log" && <AuditLogViewer />}

      </div>

        <CopilotDrawer isOpen={isCopilotOpen} onClose={() => setIsCopilotOpen(false)} />
        <ReportGeneratorModal
          isOpen={isReportModalOpen}
          onClose={() => setIsReportModalOpen(false)}
          initialHypothesisId={selectedTargetId}
        />
        <DarknetIngestionModal
          isOpen={isIngestionModalOpen}
          onClose={() => setIsIngestionModalOpen(false)}
          onNavigate={handleNavigate}
        />
      </AppShell>
      </LiveProvider>
    </ToastProvider>
  );
}

