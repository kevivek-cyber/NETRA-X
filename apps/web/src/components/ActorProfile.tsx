"use client";

import React, { useEffect, useState } from "react";
import {
  Users, Key, Wallet, Globe, Clock, ShieldCheck, GitMerge,
  Server, ArrowLeft, ExternalLink, Hash, Check, FileText
} from "lucide-react";
import { useToast } from "./StatusToasts";
import { apiFetch } from "../lib/api";
import { CryptoUTXOVisualizer } from "./CryptoUTXOVisualizer";
import { SkeletonPanel, SkeletonTiles } from "./viz/Skeleton";
import { useLive } from "../lib/live";

interface ActorProfileProps {
  actorId?: string;
  onBack: () => void;
  onNavigate: (view: string, id?: string) => void;
  onOpenReportModal?: () => void;
}

export const ActorProfile: React.FC<ActorProfileProps> = ({
  actorId,
  onBack,
  onNavigate,
  onOpenReportModal,
}) => {
  const toast = useToast();
  // Refetch when a teammate changes data on the shared server.
  const { revision } = useLive();

  const [actor, setActor] = useState<any>(null);
  const [timeline, setTimeline] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<string>("identity");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadActor() {
      try {
        const actors = await apiFetch<any[]>("/api/v1/actors");
        const target = actorId ? actors.find((a) => a.id === actorId) : actors[0];
        setActor(target || actors[0]);

        if (target || actors[0]) {
          const tRes = await apiFetch<any>(`/api/v1/actors/${target?.id || actors[0].id}/timeline`);
          setTimeline(tRes.timeline || []);
        }
      } catch (err) {
        console.error("Failed loading actor profile", err);
      } finally {
        setLoading(false);
      }
    }
    loadActor();
  }, [actorId, revision]);

  if (loading || !actor) {
    return (
      <div className="space-y-5">
        <SkeletonPanel lines={3} label="Loading threat actor profile" />
        <SkeletonTiles count={4} />
        <SkeletonPanel lines={6} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Header & Navigation */}
      <div className="flex justify-between items-center border-b border-netra-border pb-4">
        <button
          onClick={onBack}
          className="flex items-center space-x-2 text-xs text-netra-muted hover:text-white transition"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Explorer</span>
        </button>
        <span className="text-xs font-mono text-netra-subtle">UUIDv7: {actor.id}</span>
      </div>

      {/* Main Hero Header */}
      <div className="bg-netra-card border border-netra-border rounded-xl p-6 glass-panel space-y-4">
        <div className="flex justify-between items-start">
          <div className="space-y-2">
            <div className="flex items-center space-x-3">
              <h1 className="text-3xl font-bold text-white tracking-wide">{actor.primary_alias}</h1>
              <span className="px-2.5 py-1 rounded bg-netra-purple/20 text-netra-purple border border-netra-purple/40 text-xs font-medium">
                {actor.category}
              </span>
              {actor.is_synthetic && (
                <span className="px-2 py-0.5 rounded bg-netra-surface border border-netra-border text-netra-subtle text-[10px] font-mono">
                  SYNTHETIC RESEARCH DATA
                </span>
              )}
            </div>
            <p className="text-xs text-netra-muted">
              Primary Threat Actor Profile • Last Scan: {new Date(actor.last_seen).toLocaleDateString()}
            </p>
          </div>

          <div className="text-right space-y-2">
            <div className="text-xs text-netra-subtle font-mono">BASE CONFIDENCE</div>
            <div className="text-2xl font-bold text-netra-valid font-mono">{(actor.confidence * 100).toFixed(0)}%</div>
            <div className="flex items-center space-x-2 justify-end">
              {onOpenReportModal && (
                <button
                  onClick={onOpenReportModal}
                  className="px-3 py-1.5 bg-netra-cyan/20 border border-netra-cyan/40 hover:bg-netra-cyan/40 text-netra-cyan text-xs font-mono rounded transition flex items-center space-x-1"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Generate Dossier</span>
                </button>
              )}
              <button
                onClick={() => {
                  const val = prompt("Enter new identifier value (Handle, PGP Key, Wallet, or Onion URL):");
                  if (val && val.trim()) {
                    toast.push("ok", "Identifier attached", `${val.trim()} -> ${actor.primary_alias}`);
                  }
                }}
                className="px-3 py-1.5 bg-netra-purple/20 border border-netra-purple/40 hover:bg-netra-purple text-white text-xs font-mono rounded transition flex items-center space-x-1"
              >
                <Key className="w-3.5 h-3.5 text-netra-cyan" />
                <span>+ Add Identifier</span>
              </button>
            </div>
          </div>
        </div>


        {/* Tab Navigation */}
        <div className="flex space-x-2 border-t border-netra-border pt-4 text-xs font-medium">
          {[
            { id: "identity", label: "Identity & Aliases", icon: Users },
            { id: "pgp", label: "PGP Keys", icon: Key },
            { id: "wallets", label: "Crypto Wallets", icon: Wallet },
            { id: "infrastructure", label: "Onion Infrastructure", icon: Globe },
            { id: "timeline", label: "Activity Timeline", icon: Clock },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center space-x-2 px-3 py-2 rounded-lg transition ${
                  isActive
                    ? "bg-netra-purple/20 text-white border border-netra-purple/50"
                    : "text-netra-muted hover:bg-netra-hover hover:text-white"
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? "text-netra-purple" : "text-netra-subtle"}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab Contents */}
      {activeTab === "identity" && (
        <div className="grid grid-cols-2 gap-6">
          <div className="bg-netra-card border border-netra-border rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-semibold text-white border-b border-netra-border pb-2 flex items-center space-x-2">
              <Users className="w-4 h-4 text-netra-purple" />
              <span>Known Aliases & Handles</span>
            </h2>
            <div className="space-y-2">
              {actor.aliases.map((al: any) => (
                <div key={al.id} className="p-3 bg-netra-surface border border-netra-border rounded flex justify-between items-center">
                  <div>
                    <div className="text-sm font-semibold text-white">{al.value}</div>
                    <div className="text-xs text-netra-subtle">{al.platform} • Source: {al.source}</div>
                  </div>
                  <span className="text-xs font-mono text-netra-cyan">{(al.confidence * 100).toFixed(0)}% Conf</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-netra-card border border-netra-border rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-semibold text-white border-b border-netra-border pb-2">
              Cross-Platform Linkage Hypotheses
            </h2>
            <div className="p-4 bg-netra-surface border border-netra-border rounded-lg space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs font-semibold text-white">ShadowByte &harr; Vortex99</span>
                <span className="text-xs font-mono text-netra-valid">88.5% Calibrated</span>
              </div>
              <p className="text-xs text-netra-muted">
                Candidate pair linked via PGP key reuse, Bitcoin wallet co-spending, Favicon hash matching, and stylometric similarity.
              </p>
              <button
                onClick={() => onNavigate("attribution_lab")}
                className="w-full py-2 bg-netra-purple/20 text-netra-purple hover:bg-netra-purple hover:text-netra-bg border border-netra-purple/40 rounded text-xs font-medium transition"
              >
                Inspect in Attribution Lab
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === "pgp" && (
        <div className="bg-netra-card border border-netra-border rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-semibold text-white border-b border-netra-border pb-2 flex items-center space-x-2">
            <Key className="w-4 h-4 text-netra-purple" />
            <span>Cryptographic PGP Fingerprints</span>
          </h2>
          {actor.pgp_keys.map((k: any) => (
            <div key={k.id} className="p-4 bg-netra-surface border border-netra-border rounded-lg space-y-2 font-mono text-xs">
              <div className="flex justify-between items-center">
                <span className="text-netra-purple font-bold">Key ID: {k.key_id}</span>
                <span className="text-netra-subtle">RSA 4096-bit</span>
              </div>
              <div className="text-white bg-netra-bg p-2.5 rounded border border-netra-border tracking-widest select-all">
                {k.fingerprint}
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === "wallets" && (
        <div className="space-y-6">
          <div className="bg-netra-card border border-netra-border rounded-xl p-5 space-y-4">
            <h2 className="text-sm font-semibold text-white border-b border-netra-border pb-2 flex items-center space-x-2">
              <Wallet className="w-4 h-4 text-netra-cyan" />
              <span>Tracked Cryptocurrency Wallets</span>
            </h2>
            <div className="space-y-3">
              {actor.wallets.map((w: any) => (
                <div key={w.id} className="p-3 bg-netra-surface border border-netra-border rounded flex justify-between items-center text-xs font-mono">
                  <div>
                    <div className="text-netra-cyan font-bold">{w.address}</div>
                    <div className="text-netra-subtle text-[11px]">Chain: {w.chain} • Cluster: {w.cluster_id}</div>
                  </div>
                  <span className="text-netra-valid">Co-Spending Linked</span>
                </div>
              ))}
            </div>
          </div>

          <CryptoUTXOVisualizer actorId={actor.id} />
        </div>
      )}

      {activeTab === "infrastructure" && (
        <div className="bg-netra-card border border-netra-border rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-semibold text-white border-b border-netra-border pb-2 flex items-center space-x-2">
            <Globe className="w-4 h-4 text-netra-cyan" />
            <span>Onion Services & Misconfiguration Leaks</span>
          </h2>
          <div className="p-4 bg-netra-surface border border-netra-border rounded-lg space-y-3 text-xs">
            <div className="flex justify-between items-center font-mono">
              <span className="text-netra-purple font-bold">shadowmarket7x4k2.onion</span>
              <span className="text-netra-subtle">Onion v3</span>
            </div>
            <div className="grid grid-cols-2 gap-4 font-mono text-[11px] pt-2 border-t border-netra-border">
              <div>
                <span className="text-netra-subtle">Favicon mmh3 Hash:</span>
                <div className="text-netra-cyan font-bold">-1598234912</div>
              </div>
              <div>
                <span className="text-netra-subtle">Matched Clearnet Origin IP:</span>
                <div className="text-netra-valid font-bold">185.220.101.5 (ZettaHosting)</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "timeline" && (
        <div className="bg-netra-card border border-netra-border rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-semibold text-white border-b border-netra-border pb-2 flex items-center space-x-2">
            <Clock className="w-4 h-4 text-netra-amber" />
            <span>Chronological Intelligence Activity Stream</span>
          </h2>
          <div className="space-y-3 border-l-2 border-netra-purple/50 pl-4">
            {timeline.map((ev) => (
              <div key={ev.id} className="relative space-y-1">
                <div className="absolute -left-[21px] top-1.5 w-2.5 h-2.5 rounded-full bg-netra-purple" />
                <div className="text-xs text-netra-subtle font-mono">{ev.timestamp} • Source: {ev.source}</div>
                <div className="text-sm font-semibold text-white">{ev.event_type}</div>
                <div className="text-xs text-netra-muted">{ev.detail}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
