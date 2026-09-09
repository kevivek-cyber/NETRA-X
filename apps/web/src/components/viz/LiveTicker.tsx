"use client";

/**
 * LiveTicker -- the continuous telemetry strip pinned to the bottom of the
 * console, and UtcClock for the header.
 *
 * The ticker exists because an operations console should show that the system
 * is doing something between analyst actions. It carries real figures passed
 * in by the caller; it is never filled with invented event text.
 */

import React, { useEffect, useState } from "react";

interface LiveTickerProps {
  items: string[];
  /** Seconds for one full pass. Longer = slower. */
  duration?: number;
  className?: string;
}

export const LiveTicker: React.FC<LiveTickerProps> = ({
  items,
  duration = 60,
  className = "",
}) => {
  if (!items.length) return null;

  // The strip is duplicated so the translate can loop seamlessly: by the time
  // the first copy has scrolled fully out, the second is exactly in its place.
  const strip = (key: string) => (
    <div className="ticker-strip" key={key} aria-hidden={key === "b"}>
      {items.map((item, i) => (
        <span key={i} className="ticker-item">
          <span className="text-netra-purple">///</span>
          <span>{item}</span>
        </span>
      ))}
    </div>
  );

  return (
    <div className={`ticker-viewport ${className}`}>
      <div
        className="ticker-track"
        style={{ animationDuration: `${duration}s` }}
      >
        {strip("a")}
        {strip("b")}
      </div>
    </div>
  );
};

/**
 * Zulu clock. Intelligence work is timestamped in UTC, and a console that
 * shows local time makes every screenshot ambiguous about when it was taken.
 */
export const UtcClock: React.FC<{ className?: string }> = ({ className = "" }) => {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    // Set on mount rather than at first render: rendering a clock during SSR
    // produces markup that cannot match the client and React logs a hydration
    // mismatch for it.
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!now) {
    return <span className={className}>--:--:--Z</span>;
  }

  const p = (n: number) => String(n).padStart(2, "0");
  return (
    <time
      dateTime={now.toISOString()}
      className={className}
      suppressHydrationWarning
    >
      {p(now.getUTCHours())}:{p(now.getUTCMinutes())}:{p(now.getUTCSeconds())}Z
    </time>
  );
};
