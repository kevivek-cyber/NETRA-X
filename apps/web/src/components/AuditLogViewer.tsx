"use client";

import React, { useEffect, useState } from "react";
import { Lock, ShieldCheck, Hash, AlertTriangle } from "lucide-react";
import { ModuleHeader } from "./ModuleHeader";
import { apiFetch } from "../lib/api";
import { SkeletonTable } from "./viz/Skeleton";
import { useLive } from "../lib/live";

export const AuditLogViewer: React.FC = () => {
  // Refetch when a teammate changes data on the shared server.
  const { revision } = useLive();

  const [auditData, setAuditData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadAudit() {
      try {
        const res = await apiFetch<any>("/api/v1/audit");
        setAuditData(res);
      } catch (err) {
        console.error("Failed loading audit log", err);
      } finally {
        setLoading(false);
      }
    }
    loadAudit();
  }, [revision]);

  return (
    <div className="space-y-6">
      <ModuleHeader
        code="07"
        icon={Lock}
        title="Audit Chain"
        brief="Tamper-evident append-only provenance ledger. Every platform action is hash-chained to its predecessor."
      />

      {/* Verification Status Banner */}
      {auditData && (
        <div className={`p-4 rounded-xl border flex items-center justify-between font-mono text-xs ${
          auditData.chain_valid
            ? "bg-netra-valid/10 border-netra-valid/40 text-netra-valid"
            : "bg-netra-red/10 border-netra-red/40 text-netra-red"
        }`}>
          <div className="flex items-center space-x-3">
            <ShieldCheck className="w-5 h-5" />
            <div>
              <div className="font-bold text-sm">HASH CHAIN INTEGRITY: {auditData.chain_valid ? "VALID & UNBROKEN" : "COMPROMISED"}</div>
              <div className="text-[11px] opacity-80">{auditData.verification_message}</div>
            </div>
          </div>
          <div className="text-right font-bold text-sm">
            TOTAL RECORDS: {auditData.total_records}
          </div>
        </div>
      )}

      {/* Audit Log Table */}
      <div className="bg-netra-card border border-netra-border rounded-xl p-5 space-y-4">
        {loading ? (
          <SkeletonTable rows={10} cols={["18%", "18%", "22%", "22%", "20%"]} label="Verifying SHA-256 hash chain" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-netra-border text-netra-subtle bg-netra-surface">
                  <th className="p-3">Audit Event ID</th>
                  <th className="p-3">Action</th>
                  <th className="p-3">Resource Type</th>
                  <th className="p-3">Payload SHA-256</th>
                  <th className="p-3">Previous SHA-256</th>
                  <th className="p-3">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-netra-border">
                {auditData?.logs.map((l: any) => (
                  <tr key={l.id} className="hover:bg-netra-hover/50 transition">
                    <td className="p-3 text-netra-purple">{l.id.substring(0, 13)}...</td>
                    <td className="p-3 text-white font-bold">{l.action}</td>
                    <td className="p-3 text-netra-cyan">{l.resource_type}</td>
                    <td className="p-3 text-netra-valid flex items-center space-x-1">
                      <Hash className="w-3 h-3" />
                      <span>{l.payload_hash.substring(0, 16)}...</span>
                    </td>
                    <td className="p-3 text-netra-subtle">{l.prev_hash.substring(0, 16)}...</td>
                    <td className="p-3 text-netra-muted">{new Date(l.created_at).toLocaleString()}</td>
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
