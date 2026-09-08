"use client";

/**
 * Fullscreen control for both shells this UI runs in.
 *
 * In the packaged desktop app the window itself must go fullscreen, which only
 * the Rust side can do -- the HTML Fullscreen API inside WebView2 expands the
 * document within a webview that already fills the window, so the title bar
 * stays and nothing appears to happen. `toggle_fullscreen` is a custom Tauri
 * command for exactly that (see src-tauri/src/main.rs).
 *
 * In a plain browser there is no window to command, so the standard Fullscreen
 * API is the correct implementation rather than a degraded fallback.
 *
 * The two are detected at call time, not import time: `window.__TAURI__` is
 * injected by the shell after the document starts evaluating, and a module-level
 * check can run before it lands.
 */

import { useCallback, useEffect, useState } from "react";

/** Minimal shape of the injected bridge; avoids a dependency on @tauri-apps/api. */
type TauriBridge = { invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> };

function tauri(): TauriBridge | null {
  if (typeof window === "undefined") return null;
  const t = (window as any).__TAURI__;
  return t && typeof t.invoke === "function" ? (t as TauriBridge) : null;
}

/** True when the browser reports a fullscreen element. */
function browserIsFullscreen() {
  if (typeof document === "undefined") return false;
  return Boolean(document.fullscreenElement);
}

export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    const bridge = tauri();
    if (bridge) {
      setSupported(true);
      // Reflect the real window state on mount -- a reload inside a fullscreen
      // window would otherwise render the "enter fullscreen" affordance.
      bridge
        .invoke<boolean>("is_fullscreen")
        .then(setIsFullscreen)
        .catch(() => {
          /* command unavailable on an older shell build; leave as false */
        });
      return;
    }

    setSupported(
      typeof document !== "undefined" && Boolean(document.documentElement.requestFullscreen)
    );
    // The browser can leave fullscreen without going through our toggle (Esc,
    // or the user's own F11), so track the event rather than only our own calls.
    const onChange = () => setIsFullscreen(browserIsFullscreen());
    document.addEventListener("fullscreenchange", onChange);
    setIsFullscreen(browserIsFullscreen());
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggle = useCallback(async () => {
    const bridge = tauri();
    if (bridge) {
      try {
        setIsFullscreen(await bridge.invoke<boolean>("toggle_fullscreen"));
      } catch (err) {
        console.error("[NETRA-X] fullscreen toggle failed", err);
      }
      return;
    }

    try {
      if (browserIsFullscreen()) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
      // State is corrected by the fullscreenchange listener above; this keeps
      // the control responsive if the event is slow to fire.
      setIsFullscreen(!browserIsFullscreen());
    } catch (err) {
      // requestFullscreen rejects when not driven by a user gesture, and in
      // some embedded contexts it is blocked outright.
      console.error("[NETRA-X] fullscreen request rejected", err);
    }
  }, []);

  // F11 is the platform convention for this, and the desktop shell does not
  // handle it natively. preventDefault stops the browser's own handler from
  // fighting ours when the UI is opened in a normal tab.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F11") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  return { isFullscreen, toggle, supported };
}
