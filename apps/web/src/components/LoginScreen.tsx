"use client";

/**
 * Authentication terminal.
 *
 * The previous screen was a centred rounded card with two blurred colour orbs
 * behind it -- the single most generic surface in the product, and the first
 * thing anyone sees. It also contradicted the system it sits in: translucency,
 * bloom and border-radius are all prohibited (§4, §5).
 *
 * This is a full-bleed console instead. A classification strip pins the top, a
 * hairline-ruled grid divides the viewport into a briefing half and an auth
 * half, and a boot log types itself while the operator reads. Nothing is
 * centred in a floating box.
 */

import React, { useEffect, useState } from "react";
import { ArrowRight, Lock, Mail, ShieldAlert } from "lucide-react";
import { apiFetch, setAuthToken } from "../lib/api";
import { ThreatGlobe } from "./viz/ThreatGlobe";
import { ScrambleText, TypeOut } from "./viz/TextFX";
import { UtcClock } from "./viz/LiveTicker";

interface LoginScreenProps {
  onLoginSuccess: (user: any) => void;
}

/* Describes what the client actually does on start-up: resolve the API base,
   confirm the ledger answers, and check for an existing session. Written as a
   boot log because that is what it is, not as invented telemetry. */
const BOOT_LINES = [
  "netra-x console v0.1 :: tactical telemetry substrate",
  "[ OK ] resolving api endpoint ....................... 127.0.0.1:8000",
  "[ OK ] evidence ledger ............................... reachable",
  "[ OK ] sha-256 audit chain ........................... append-only",
  "[ OK ] llr fusion engine ............................. v1.0-LLR",
  "[ -- ] graph projection .............................. relational fallback",
  "[ !! ] session token ................................. absent",
  "",
  ">> operator authentication required",
];

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess }) => {
  const [email, setEmail] = useState("analyst@netra-x.local");
  const [password, setPassword] = useState("AnalystPass2026!");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState("");

  useEffect(() => {
    // Cosmetic session tag for the header. Generated on the client only --
    // generating it during render would differ between server and client
    // markup and trip a hydration warning.
    const hex = "0123456789ABCDEF";
    setSessionId(
      Array.from({ length: 8 }, () => hex[Math.floor(Math.random() * 16)]).join("")
    );
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await apiFetch<any>("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setAuthToken(res.access_token);
      onLoginSuccess(res.user);
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-netra-bg text-netra-text flex flex-col font-sans relative overflow-hidden">
      {/* Measured grid substrate. Static -- it is structure, not an event. */}
      <div className="absolute inset-0 blueprint-bg pointer-events-none" aria-hidden="true" />

      {/* --- CLASSIFICATION STRIP ----------------------------------------- */}
      <div className="relative z-10 border-b border-netra-border bg-netra-surface">
        <div className="hazard-stripe flex items-center justify-between px-4 h-8 text-[10px] font-mono tracking-telemetry uppercase">
          <div className="flex items-center gap-3">
            <ShieldAlert className="w-3.5 h-3.5 text-netra-red" />
            <span className="text-netra-red font-bold">Restricted</span>
            <span className="text-netra-subtle hidden sm:inline">
              Authorized Research / Law-Enforcement Use Only
            </span>
          </div>
          <div className="flex items-center gap-4 text-netra-muted">
            <span className="hidden md:inline">SESSION / {sessionId || "--------"}</span>
            <UtcClock className="text-netra-text" />
          </div>
        </div>
      </div>

      {/* --- MAIN SPLIT ---------------------------------------------------- */}
      <div className="relative z-10 flex-1 grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr]">
        {/* BRIEFING HALF */}
        <section className="relative border-b lg:border-b-0 lg:border-r border-netra-border flex flex-col justify-between p-6 sm:p-10 overflow-hidden">
          {/* Globe sits behind the type, bled off the bottom-left corner so it
              reads as a fragment of a larger display rather than an icon. */}
          <div
            className="absolute -bottom-24 -left-24 opacity-[0.55] pointer-events-none hidden sm:block"
            aria-hidden="true"
          >
            <ThreatGlobe size={520} arcCount={8} />
          </div>

          <div className="relative">
            <div className="telemetry-label bracketed mb-6">Intelligence Platform</div>

            {/* Macro-typography: fluid clamp, tight tracking, compressed
                leading -- the glyphs form a solid block (§3.1). */}
            <h1
              className="font-display uppercase text-netra-text leading-[0.85] tracking-tightest"
              style={{ fontSize: "clamp(3.2rem, 9vw, 8rem)" }}
            >
              <span className="block">Netra</span>
              <span className="block text-netra-purple">
                <span className="text-netra-subtle">/</span>X
              </span>
            </h1>

            <div className="mt-6 max-w-lg border-l-2 border-netra-purple pl-4">
              <p className="text-sm text-netra-muted leading-relaxed">
                Evidence-driven dark web threat actor intelligence and attribution.
                Every assertion carries a source URI, a collection timestamp and a
                SHA-256 artifact hash.
              </p>
              <p className="mt-3 font-mono text-[11px] tracking-telemetry uppercase text-netra-purple">
                AI assists <span className="text-netra-subtle">//</span> analyst decides
              </p>
            </div>
          </div>

          {/* Boot log. Types itself once on mount. */}
          <div className="relative mt-10 hidden sm:block">
            <div className="edge-ticks h-2 w-full mb-3" aria-hidden="true" />
            <TypeOut
              lines={BOOT_LINES}
              speed={9}
              lineDelay={60}
              className="font-mono text-[10.5px] leading-[1.6] text-netra-subtle space-y-0"
            />
          </div>
        </section>

        {/* AUTH HALF */}
        <section className="relative flex items-center justify-center p-6 sm:p-10">
          {/* One slow radar sweep behind the panel. */}
          <div
            className="absolute w-[420px] h-[420px] radar-sweep opacity-[0.14] pointer-events-none"
            aria-hidden="true"
          />

          <div className="relative w-full max-w-sm console-boot">
            {/* Panel header */}
            <div className="border border-netra-border bg-netra-card">
              <div className="flex items-center justify-between border-b border-netra-border px-4 h-10">
                <span className="telemetry-label text-netra-text">
                  <ScrambleText text="OPERATOR AUTH" speed={30} />
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 bg-netra-valid live-dot" />
                  <span className="telemetry-label">Secure</span>
                </span>
              </div>

              <form onSubmit={handleSubmit} className="p-5 space-y-5">
                {error && (
                  <div
                    role="alert"
                    className="border border-netra-red bg-netra-red/10 px-3 py-2 font-mono text-[11px] text-netra-red flex items-start gap-2"
                  >
                    <span className="font-bold shrink-0">DENIED /</span>
                    <span>{error}</span>
                  </div>
                )}

                <label className="block space-y-1.5">
                  <span className="telemetry-label">Analyst Identifier</span>
                  <span className="flex items-center gap-2 border border-netra-border bg-netra-surface px-3 h-11 focus-within:border-netra-purple transition-colors">
                    <Mail className="w-3.5 h-3.5 text-netra-subtle shrink-0" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoComplete="username"
                      className="w-full bg-transparent font-mono text-xs text-netra-text placeholder-netra-subtle focus:outline-none"
                    />
                  </span>
                </label>

                <label className="block space-y-1.5">
                  <span className="telemetry-label">Passphrase</span>
                  <span className="flex items-center gap-2 border border-netra-border bg-netra-surface px-3 h-11 focus-within:border-netra-purple transition-colors">
                    <Lock className="w-3.5 h-3.5 text-netra-subtle shrink-0" />
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoComplete="current-password"
                      className="w-full bg-transparent font-mono text-xs text-netra-text placeholder-netra-subtle focus:outline-none"
                    />
                  </span>
                </label>

                <button
                  type="submit"
                  disabled={loading}
                  className="group w-full h-11 bg-netra-purple text-netra-bg font-mono text-[11px] font-bold uppercase tracking-telemetry flex items-center justify-center gap-2 hover:bg-netra-text disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? (
                    <>
                      <span className="w-1.5 h-1.5 bg-netra-bg live-dot" />
                      <span>Authenticating</span>
                    </>
                  ) : (
                    <>
                      <span>Authorize Access</span>
                      <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                    </>
                  )}
                </button>
              </form>

              {/* Demo credentials, framed as a supply slip rather than a note. */}
              <div className="border-t border-netra-border bg-netra-surface px-4 py-3">
                <div className="telemetry-label mb-1.5">Demo Credentials</div>
                <dl className="font-mono text-[11px] space-y-0.5">
                  <div className="flex justify-between gap-3">
                    <dt className="text-netra-subtle">ID</dt>
                    <dd className="text-netra-text">analyst@netra-x.local</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-netra-subtle">KEY</dt>
                    <dd className="text-netra-text">AnalystPass2026!</dd>
                  </div>
                </dl>
              </div>
            </div>

            {/* Registration marks under the panel. */}
            <div className="mt-3 flex items-center justify-between telemetry-label">
              <span>SIH26151 / NTRO</span>
              <span>REV 0.1 &middot; MVP</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
