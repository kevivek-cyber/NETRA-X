"use client";

/**
 * Text motion primitives.
 *
 * Both effects here communicate the same thing -- a value resolving from an
 * unknown state into a known one -- which is the central gesture of an
 * attribution tool. They are deliberately cheap: a character swap on an
 * interval, no layout thrash, no per-glyph DOM nodes.
 *
 * Both respect prefers-reduced-motion by rendering the final text immediately.
 */

import React, { useEffect, useRef, useState } from "react";

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&@$?!/\\<>[]{}=+*";

function prefersReduced() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

interface ScrambleTextProps {
  text: string;
  /** ms between scramble frames. */
  speed?: number;
  /** ms to wait before starting. */
  delay?: number;
  className?: string;
  /** Re-run whenever this changes -- e.g. a record id. */
  trigger?: unknown;
}

/**
 * Resolves each character left-to-right, cycling random glyphs until a
 * character locks. Reads as a value being decoded rather than typed.
 */
export const ScrambleText: React.FC<ScrambleTextProps> = ({
  text,
  speed = 28,
  delay = 0,
  className = "",
  trigger,
}) => {
  // Always starts empty. Reading matchMedia during render would let the server
  // and the client disagree about the first frame, which React reports as a
  // hydration mismatch; the effect below resolves it on mount instead.
  const [shown, setShown] = useState("");

  useEffect(() => {
    if (prefersReduced()) {
      setShown(text);
      return;
    }

    let frame = 0;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = setTimeout(() => {
      timer = setInterval(() => {
        frame += 1;
        // Two frames of scrambling per character before it locks.
        const locked = Math.floor(frame / 2);
        if (locked >= text.length) {
          setShown(text);
          if (timer) clearInterval(timer);
          return;
        }
        const head = text.slice(0, locked);
        const tail = text
          .slice(locked)
          .split("")
          .map((c) => (c === " " ? " " : GLYPHS[Math.floor(Math.random() * GLYPHS.length)]))
          .join("");
        setShown(head + tail);
      }, speed);
    }, delay);

    return () => {
      clearTimeout(start);
      if (timer) clearInterval(timer);
    };
  }, [text, speed, delay, trigger]);

  return (
    <span className={className} aria-label={text}>
      {shown || " "}
    </span>
  );
};

interface TypeOutProps {
  /** Lines are typed in sequence; each completes before the next begins. */
  lines: string[];
  speed?: number;
  /** ms pause between lines. */
  lineDelay?: number;
  className?: string;
  onDone?: () => void;
}

/**
 * Sequential typewriter for boot logs. Returns the lines already completed
 * plus the one in progress, so the caller can style them as a terminal feed.
 */
export const TypeOut: React.FC<TypeOutProps> = ({
  lines,
  speed = 12,
  lineDelay = 90,
  className = "",
  onDone,
}) => {
  const [done, setDone] = useState<string[]>([]);
  const [current, setCurrent] = useState("");
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    if (prefersReduced()) {
      setDone(lines);
      setCurrent("");
      doneRef.current?.();
      return;
    }

    let cancelled = false;
    let li = 0;
    let ci = 0;
    let timer: ReturnType<typeof setTimeout>;

    const step = () => {
      if (cancelled) return;
      if (li >= lines.length) {
        doneRef.current?.();
        return;
      }
      const line = lines[li];
      if (ci <= line.length) {
        setCurrent(line.slice(0, ci));
        ci += 1;
        timer = setTimeout(step, speed);
      } else {
        setDone((d) => [...d, line]);
        setCurrent("");
        li += 1;
        ci = 0;
        timer = setTimeout(step, lineDelay);
      }
    };

    step();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [lines, speed, lineDelay]);

  // Every line is always rendered; the ones not yet typed are present but
  // invisible. Rendering only the typed lines made the block grow as it went,
  // and on the auth screen that pushed the grid row taller line by line, which
  // slid the vertically-centred login panel down the page while the log ran.
  // `visibility: hidden` reserves the exact final height with no measurement
  // and no assumption about the caller's font size or line-height.
  return (
    <div className={className}>
      {lines.map((line, i) => {
        if (i < done.length) return <div key={i}>{done[i]}</div>;
        if (i === done.length && current) {
          return (
            <div key={i}>
              {current}
              <span className="caret-blink">_</span>
            </div>
          );
        }
        return (
          <div key={i} aria-hidden="true" style={{ visibility: "hidden" }}>
            {/* A space keeps blank source lines from collapsing to zero height. */}
            {line || " "}
          </div>
        );
      })}
    </div>
  );
};
