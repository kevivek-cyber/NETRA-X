"use client";

/**
 * Loading placeholders.
 *
 * Every view previously loaded behind a single centred line of pulsing text
 * ("Loading Evidence Ledger..."), which tells the analyst nothing about what
 * is arriving and makes the layout jump when it does. These placeholders hold
 * the shape of the content instead, so the panel is already assembled when the
 * rows land.
 *
 * The shimmer is a single background-position sweep rather than an opacity
 * pulse: a pulse reads as an alarm in a system where blinking means something,
 * and this must not compete with the live-status indicators.
 */

import React from "react";

/** One shimmering bar. Width is a CSS length or percentage. */
export const SkeletonBar: React.FC<{
  width?: string;
  height?: number;
  className?: string;
}> = ({ width = "100%", height = 10, className = "" }) => (
  <span
    className={`block skeleton-shimmer ${className}`}
    style={{ width, height }}
    aria-hidden="true"
  />
);

/**
 * Table placeholder. `cols` widths are given as percentages so the columns
 * line up with the real header that is already on screen above it.
 */
export const SkeletonTable: React.FC<{
  rows?: number;
  cols?: string[];
  label?: string;
}> = ({
  rows = 8,
  cols = ["14%", "16%", "24%", "20%", "14%", "12%"],
  label = "Loading records",
}) => (
  <div role="status" aria-label={label}>
    <div className="sr-only">{label}</div>
    <div className="divide-y divide-netra-border border border-netra-border">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 px-3 h-11 bg-netra-surface">
          {cols.map((w, c) => (
            <SkeletonBar
              key={c}
              width={w}
              height={8}
              // Staggered so the row resolves left to right rather than as one
              // block, which is how the real data actually paints.
              className={`skel-delay-${(r + c) % 6}`}
            />
          ))}
        </div>
      ))}
    </div>
  </div>
);

/** Panel placeholder: a header rule plus body lines. */
export const SkeletonPanel: React.FC<{
  lines?: number;
  label?: string;
  className?: string;
}> = ({ lines = 5, label = "Loading panel", className = "" }) => (
  <div
    className={`border border-netra-border bg-netra-card ${className}`}
    role="status"
    aria-label={label}
  >
    <div className="sr-only">{label}</div>
    <div className="border-b border-netra-border px-4 h-10 flex items-center">
      <SkeletonBar width="38%" height={9} />
    </div>
    <div className="p-4 space-y-3">
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonBar
          key={i}
          width={`${92 - i * 9}%`}
          height={8}
          className={`skel-delay-${i % 6}`}
        />
      ))}
    </div>
  </div>
);

/** Grid of instrument-tile placeholders, matching the stat row's geometry. */
export const SkeletonTiles: React.FC<{ count?: number; label?: string }> = ({
  count = 4,
  label = "Loading metrics",
}) => (
  <div
    className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-px bg-netra-border border border-netra-border"
    role="status"
    aria-label={label}
  >
    <div className="sr-only">{label}</div>
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="bg-netra-card p-4 space-y-3">
        <SkeletonBar width="52%" height={8} className={`skel-delay-${i % 6}`} />
        <SkeletonBar width="34%" height={26} className={`skel-delay-${(i + 1) % 6}`} />
        <div className="pt-2 border-t border-netra-border">
          <SkeletonBar width="70%" height={7} className={`skel-delay-${(i + 2) % 6}`} />
        </div>
      </div>
    ))}
  </div>
);
