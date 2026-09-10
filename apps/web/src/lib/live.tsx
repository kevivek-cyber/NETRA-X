"use client";

/*
  Live sync across analysts.

  Several people share one server, so any open view goes stale the moment a
  teammate edits. This polls the audit-log cursor at /api/v1/changes and
  publishes a `revision` counter; views include it in their effect
  dependencies and refetch when it moves.

  Why a cursor and not a socket: the endpoint is backed by the audit log, which
  every mutation must write for provenance, so the feed cannot miss a change.
  A publish call placed by hand in each endpoint could be forgotten, and that
  change would then silently never reach anyone.

  Why one provider rather than a hook per view: each view polling separately
  would multiply requests by the number of mounted views and let them disagree
  about the cursor.
*/

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { apiFetch } from "./api";
import { useToast } from "../components/StatusToasts";

const POLL_MS = 2500;

interface Change {
  seq: number;
  action: string;
  resource_type: string;
  resource_id: string;
  actor: string;
  at: string | null;
}

interface LiveApi {
  /** Increments whenever teammates change data. Put it in effect deps. */
  revision: number;
  /** Most recent batch, newest last. */
  changes: Change[];
  /** Force a refetch everywhere, e.g. after your own write. */
  bump: () => void;
}

const LiveContext = createContext<LiveApi>({
  revision: 0,
  changes: [],
  bump: () => {},
});

export const useLive = () => useContext(LiveContext);

/** "EVIDENCE_INGESTED" -> "evidence ingested" */
function humanise(action: string): string {
  return action.toLowerCase().replace(/_/g, " ");
}

export const LiveProvider: React.FC<{
  children: React.ReactNode;
  /** Current operator, so their own actions do not announce themselves. */
  userEmail?: string;
}> = ({ children, userEmail }) => {
  const [revision, setRevision] = useState(0);
  const [changes, setChanges] = useState<Change[]>([]);
  const cursor = useRef<number | null>(null);
  const { push } = useToast();

  const bump = useCallback(() => setRevision((r) => r + 1), []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      // Nothing on screen is being read while the window is hidden, and a
      // laptop lid closed for an hour should not wake to a backlog of polls.
      if (typeof document !== "undefined" && document.hidden) {
        return schedule();
      }

      try {
        const since = cursor.current;
        const query = since === null ? "" : `?since=${since}`;
        const body = await apiFetch<{ cursor: number; changes: Change[] }>(
          `/api/v1/changes${query}`
        );
        if (cancelled) return;

        if (since === null) {
          // First poll establishes where we joined. Without this the whole
          // history would arrive as "news" and every view would refetch.
          cursor.current = body.cursor;
        } else if (body.cursor > since) {
          cursor.current = body.cursor;

          const fromOthers = body.changes.filter((c) => c.actor !== userEmail);
          if (body.changes.length > 0) {
            setChanges(body.changes);
            setRevision((r) => r + 1);
          }

          // Announce only what someone else did: the operator already saw
          // their own action confirmed when they took it.
          if (fromOthers.length === 1) {
            const c = fromOthers[0];
            push("info", humanise(c.action), `${c.actor} · ${c.resource_type}`);
          } else if (fromOthers.length > 1) {
            const actors = Array.from(new Set(fromOthers.map((c) => c.actor)));
            push(
              "info",
              `${fromOthers.length} updates`,
              actors.join(", ")
            );
          }
        }
      } catch {
        // Deliberately silent. A dropped poll on a shared Wi-Fi is routine,
        // and the next one recovers; surfacing it would cry wolf every time
        // someone walks past the router. A genuinely unreachable server is
        // already reported by whatever view the operator is looking at.
      }
      schedule();
    }

    function schedule() {
      if (cancelled) return;
      timer = setTimeout(poll, POLL_MS);
    }

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [push, userEmail]);

  return (
    <LiveContext.Provider value={{ revision, changes, bump }}>
      {children}
    </LiveContext.Provider>
  );
};
