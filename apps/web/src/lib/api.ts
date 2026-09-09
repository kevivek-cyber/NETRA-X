/**
 * NETRA-X — API client.
 *
 * This module was missing from the repository: ten components import it and
 * the production build failed with "Module not found: Can't resolve
 * '../lib/api'". It is reconstructed here from the call sites and from the
 * live FastAPI contract, so the frontend compiles and runs.
 *
 * Exports required by existing components:
 *   apiFetch          — src/app/page.tsx and 9 components
 *   setAuthToken      — LoginScreen (on login), page.tsx (on logout)
 *   getAuthToken      — page.tsx (session restore)
 *   downloadReportPdf — AttributionLab (Export Signed PDF Report)
 */

function resolveApiBase(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();

  // No explicit API URL.
  //
  // NEXT_PUBLIC_* is inlined by Next.js at build time, so a frontend built
  // without it -- which is what the deployed netrax.onrender.com service does
  // -- has no value here at runtime and must fall back to something real.
  //
  // The deployed API lives at netra-x.onrender.com. This constant was removed
  // once as "a guess at a service name render.yaml does not define"; it is not
  // a guess, it is the running backend, and dropping it took the live site
  // down. render.yaml names the service netra-api, but the deployed instance
  // predates that file and answers on this host.
  if (!configured) {
    if (typeof window !== "undefined") {
      const host = window.location.hostname;
      if (host === "localhost" || host === "127.0.0.1") {
        // Development: frontend on :3000, API on :8000.
        return "http://localhost:8000";
      }
      return "https://netra-x.onrender.com";
    }
    return "http://localhost:8000";
  }

  const base = configured.replace(/\/+$/, "");
  // Render's two-service blueprint injects this via `fromService … property:
  // host`, which yields a bare hostname ("netra-api.onrender.com") with no
  // scheme. Used as-is that produces a *relative* fetch URL, so every request
  // resolved against the frontend's own origin and 404'd -- the deployed app
  // could not reach its API at all. Anything without a scheme gets https,
  // except localhost, which is served over http in development.
  if (/^https?:\/\//i.test(base)) return base;
  const scheme = /^(localhost|127\.0\.0\.1)(:|$)/i.test(base) ? "http" : "https";
  return `${scheme}://${base}`;
}

const API_BASE = resolveApiBase();

const TOKEN_KEY = "netrax_access_token";

/**
 * In-memory mirror of the token.
 *
 * The token is also persisted to localStorage so a page reload keeps the
 * session, but localStorage is unavailable during server-side rendering and
 * can throw in privacy modes -- hence the guards and the in-memory fallback.
 */
let tokenCache: string | null = null;

export function getAuthToken(): string | null {
  if (tokenCache) return tokenCache;
  if (typeof window === "undefined") return null;
  try {
    tokenCache = window.localStorage.getItem(TOKEN_KEY);
  } catch {
    tokenCache = null;
  }
  return tokenCache;
}

/** Store the token. Passing "" clears it -- this is how logout is implemented. */
export function setAuthToken(token: string): void {
  tokenCache = token || null;
  if (typeof window === "undefined") return;
  try {
    if (token) {
      window.localStorage.setItem(TOKEN_KEY, token);
    } else {
      window.localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    // Storage unavailable (private mode, blocked cookies). The in-memory
    // token still works for the life of the page.
  }
}

/** FastAPI returns errors as {"detail": "..."} -- surface that, not "500". */
async function errorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.detail === "string") return body.detail;
    if (Array.isArray(body?.detail)) {
      // Pydantic validation errors
      return body.detail
        .map((d: any) => `${(d.loc ?? []).join(".")}: ${d.msg}`)
        .join("; ");
    }
    if (body?.message) return String(body.message);
  } catch {
    // Non-JSON error body; fall through to the status line.
  }
  return `${res.status} ${res.statusText}`;
}

/**
 * Fetch JSON from the API, attaching the bearer token when present.
 *
 * Components call this as `apiFetch<T>(path, options?)` and read `err.message`
 * in their catch blocks, so failures throw an Error carrying the server's
 * `detail` string.
 */
export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getAuthToken();

  const headers: Record<string, string> = {
    Accept: "application/json",
    ...((options.headers as Record<string, string>) || {}),
  };

  // Only set a JSON content type when there is a body to describe.
  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch (err) {
    // fetch() rejects with a bare "Failed to fetch" for every network-level
    // failure, and the browser deliberately withholds the reason. On a
    // deployed build that one message covers three very different
    // misconfigurations, so it is worth naming them: without the target URL
    // the person seeing it cannot tell which they have hit.
    const target = `${API_BASE}${path}`;
    const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(API_BASE);
    const hint = isLocal
      ? "The frontend is pointing at localhost, so NEXT_PUBLIC_API_URL was not set at build time. " +
        "Next.js inlines that value during `npm run build`, so it must be set before the build, " +
        "not just at runtime."
      : "The API did not accept the request. Most often the API's CORS_ORIGINS does not list this " +
        "site's exact origin, or the API service is asleep or down.";
    throw new Error(
      `Cannot reach the NETRA-X API at ${target}. ${hint} ` +
        `(origin: ${typeof window !== "undefined" ? window.location.origin : "server"})`
    );
  }

  if (res.status === 401) {
    // Expired or invalid session -- clear it so the app returns to login
    // rather than looping on failed authenticated requests.
    setAuthToken("");
    throw new Error(await errorMessage(res));
  }

  if (!res.ok) {
    throw new Error(await errorMessage(res));
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return (await res.json()) as T;
}

/**
 * Download the signed PDF case report for a hypothesis.
 *
 * The endpoint is POST /api/v1/exports/report with `hypothesis_id` as a query
 * parameter, and it returns PDF bytes rather than JSON -- so this cannot go
 * through apiFetch.
 */
export async function downloadReportPdf(hypothesisId: string): Promise<void> {
  const token = getAuthToken();

  const res = await fetch(
    `${API_BASE}/api/v1/exports/report?hypothesis_id=${encodeURIComponent(
      hypothesisId
    )}`,
    {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }
  );

  if (!res.ok) {
    throw new Error(await errorMessage(res));
  }

  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `netrax_report_${hypothesisId}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking immediately can cancel the download in some browsers.
  window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
}
