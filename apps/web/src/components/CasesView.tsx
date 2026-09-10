"use client";

import React, { useEffect, useState } from "react";
import { FileSearch, Plus, ShieldCheck, Users, Calendar, Trash2, Archive, Key, Tag } from "lucide-react";
import { ModuleHeader } from "./ModuleHeader";
import { useToast } from "./StatusToasts";
import { apiFetch } from "../lib/api";
import { SkeletonPanel } from "./viz/Skeleton";
import { useLive } from "../lib/live";

export const CasesView: React.FC = () => {
  const toast = useToast();
  // Refetch when a teammate changes data on the shared server.
  const { revision } = useLive();

  const [cases, setCases] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showIdentifierModal, setShowIdentifierModal] = useState(false);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);

  // New case fields
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  // Add identifier fields
  const [idType, setIdType] = useState("handle");
  const [idValue, setIdValue] = useState("");

  const loadCases = async () => {
    try {
      const res = await apiFetch<any[]>("/api/v1/investigations");
      setCases(res);
    } catch (err) {
      console.error("Failed loading cases", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCases();
  }, [revision]);

  const handleCreateCase = async () => {
    if (!title.trim()) return;
    try {
      const created = await apiFetch<any>("/api/v1/investigations", {
        method: "POST",
        body: JSON.stringify({ title, description }),
      });
      setCases((prev) => [created, ...prev]);
      setShowModal(false);
      setTitle("");
      setDescription("");
    } catch (err: any) {
      toast.push("error", "Could not create investigation", err.message);
    }
  };

  const handleDeleteCase = async (caseId: string) => {
    if (!confirm("Are you sure you want to permanently delete this investigation case?")) return;
    try {
      await apiFetch(`/api/v1/investigations/${caseId}`, { method: "DELETE" });
      setCases((prev) => prev.filter((c) => c.id !== caseId));
    } catch (err: any) {
      // The row used to be dropped from the table here regardless, so a
      // rejected delete looked identical to a successful one until refresh.
      toast.push("error", "Could not delete investigation",
                 err?.message ?? "The case is unchanged.");
    }
  };

  const handleArchiveCase = async (caseId: string) => {
    try {
      await apiFetch(`/api/v1/investigations/${caseId}/archive`, { method: "PATCH" });
      setCases((prev) =>
        prev.map((c) => (c.id === caseId ? { ...c, status: "ARCHIVED" } : c))
      );
    } catch (err: any) {
      toast.push("error", "Could not archive investigation",
                 err?.message ?? "The case is unchanged.");
    }
  };

  /**
   * This raised a success toast and called nothing -- the identifier was never
   * sent, never stored, and gone on the next render, while the toast claimed
   * it had been added. It now posts to the case and reports real failures.
   */
  const handleAddIdentifier = async () => {
    if (!idValue.trim() || !selectedCaseId) return;
    try {
      await apiFetch(`/api/v1/investigations/${selectedCaseId}/identifiers`, {
        method: "POST",
        body: JSON.stringify({ id_type: idType, value: idValue.trim() }),
      });
      toast.push("ok", `${idType.toUpperCase()} identifier added`,
                 `${idValue.trim()} -> case ${selectedCaseId.substring(0, 8)}`);
      setShowIdentifierModal(false);
      setIdValue("");
    } catch (err: any) {
      toast.push("error", "Could not add identifier",
                 err?.message ?? "The identifier was not saved.");
    }
  };


  return (
    <div className="space-y-6">
      <ModuleHeader
        code="02"
        icon={FileSearch}
        title="Investigations"
        brief="Object-level ACL case management and evidence container scope."
        actions={
          <button
            onClick={() => setShowModal(true)}
            className="h-9 px-4 bg-netra-purple text-netra-bg font-mono text-[10px] font-bold uppercase tracking-telemetry flex items-center gap-2 hover:bg-netra-text transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Case</span>
          </button>
        }
      />

      <div className="grid grid-cols-2 gap-4">
        {loading ? (
          <>
            <SkeletonPanel lines={4} label="Loading investigation cases" />
            <SkeletonPanel lines={4} />
          </>
        ) : (
          cases.map((c) => (
            <div key={c.id} className="bg-netra-card border border-netra-border hover:border-netra-purple/50 rounded-xl p-5 space-y-3 transition glass-panel">
              <div className="flex justify-between items-start">
                <div>
                  <h2 className="text-base font-bold text-white">{c.title}</h2>
                  <div className="text-xs text-netra-subtle font-mono mt-0.5">Case ID: {c.id}</div>
                </div>
                <span className="px-2.5 py-1 rounded bg-netra-valid/20 text-netra-valid border border-netra-valid/30 text-xs font-mono">
                  {c.status}
                </span>
              </div>

              <p className="text-xs text-netra-muted">{c.description || "No description provided."}</p>

              {/* Case Action Toolbar */}
              <div className="flex items-center justify-between pt-2 border-t border-netra-border/60">
                <button
                  onClick={() => {
                    setSelectedCaseId(c.id);
                    setShowIdentifierModal(true);
                  }}
                  className="flex items-center space-x-1.5 text-xs text-netra-purple hover:text-white transition font-mono px-2 py-1 rounded bg-netra-purple/10 border border-netra-purple/20"
                >
                  <Tag className="w-3.5 h-3.5 text-netra-purple" />
                  <span>+ Add Identifier</span>
                </button>

                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => handleArchiveCase(c.id)}
                    title="Archive Case"
                    className="p-1.5 text-netra-muted hover:text-netra-amber hover:bg-netra-amber/10 rounded transition"
                  >
                    <Archive className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDeleteCase(c.id)}
                    title="Delete Case"
                    className="p-1.5 text-netra-muted hover:text-netra-hazard hover:bg-netra-hazard/10 rounded transition"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="pt-2 flex justify-between items-center text-[11px] text-netra-subtle font-mono">
                <span className="flex items-center space-x-1">
                  <Users className="w-3.5 h-3.5 text-netra-purple" />
                  <span>{c.member_count} Investigators</span>
                </span>
                <span className="flex items-center space-x-1">
                  <Calendar className="w-3.5 h-3.5 text-netra-subtle" />
                  <span>{new Date(c.created_at).toLocaleDateString()}</span>
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add Identifier Modal */}
      {showIdentifierModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-netra-card border border-netra-border rounded-xl p-6 w-full max-w-md space-y-4 glass-panel">
            <h3 className="text-base font-bold text-white border-b border-netra-border pb-2 flex items-center space-x-2">
              <Key className="w-5 h-5 text-netra-purple" />
              <span>Add Identifier to Investigation</span>
            </h3>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-netra-subtle block mb-1">Identifier Type:</label>
                <select
                  value={idType}
                  onChange={(e) => setIdType(e.target.value)}
                  className="w-full bg-netra-surface border border-netra-border rounded p-2.5 text-white font-mono"
                >
                  <option value="handle font-mono">Threat Actor Handle / Alias</option>
                  <option value="wallet font-mono">Cryptocurrency Wallet Address</option>
                  <option value="pgp font-mono">PGP Key / Fingerprint</option>
                  <option value="onion font-mono">Darknet Onion URL</option>
                  <option value="email font-mono">Email / Jabber Handle</option>
                </select>
              </div>

              <div>
                <label className="text-netra-subtle block mb-1">Identifier Value:</label>
                <input
                  type="text"
                  value={idValue}
                  onChange={(e) => setIdValue(e.target.value)}
                  placeholder="Enter handle, wallet, PGP key or URL..."
                  className="w-full bg-netra-surface border border-netra-border rounded p-2.5 text-white placeholder-netra-subtle font-mono focus:outline-none focus:border-netra-purple"
                />
              </div>
            </div>

            <div className="flex justify-end space-x-3 pt-2">
              <button
                onClick={() => setShowIdentifierModal(false)}
                className="px-4 py-2 rounded bg-netra-surface border border-netra-border text-netra-muted hover:text-white text-xs font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleAddIdentifier}
                className="px-4 py-2 rounded bg-netra-purple text-white hover:bg-netra-purple/80 text-xs font-medium"
              >
                Add Identifier
              </button>
            </div>
          </div>
        </div>
      )}


      {/* New Case Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-netra-card border border-netra-border rounded-xl p-6 w-full max-w-md space-y-4 glass-panel">
            <h3 className="text-base font-bold text-white border-b border-netra-border pb-2">
              Create New Investigation Case
            </h3>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-netra-subtle block mb-1">Case Title:</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Operation Darknet Syndicate"
                  className="w-full bg-netra-surface border border-netra-border rounded p-2.5 text-white placeholder-netra-subtle focus:outline-none focus:border-netra-purple"
                />
              </div>

              <div>
                <label className="text-netra-subtle block mb-1">Description:</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Summary of investigation scope..."
                  rows={3}
                  className="w-full bg-netra-surface border border-netra-border rounded p-2.5 text-white placeholder-netra-subtle focus:outline-none focus:border-netra-purple"
                />
              </div>
            </div>

            <div className="flex justify-end space-x-3 pt-2">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 rounded bg-netra-surface border border-netra-border text-netra-muted hover:text-white text-xs font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateCase}
                className="px-4 py-2 rounded bg-netra-purple text-netra-bg hover:bg-netra-purple/80 text-xs font-medium"
              >
                Create Case
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
