"use client";

/**
 * Shared module header.
 *
 * Every view previously opened with its own `text-2xl font-bold` line, which
 * meant the console had seven slightly different title treatments and none of
 * them used the macro-typography the system is built around. This is the one
 * header: a bracketed module code, a fluid-scaled display title, a one-line
 * brief, and a slot for the view's primary controls.
 *
 * The title is fluid via clamp() per §8.3 -- it has to hold its block shape
 * from a 1280px laptop up to a wall display without a media query.
 */

import React from "react";

interface ModuleHeaderProps {
  /** Two-digit module number, matching the rail's nav codes. */
  code: string;
  title: string;
  brief: string;
  icon?: React.ElementType;
  /** Primary controls for the view, right-aligned. */
  actions?: React.ReactNode;
}

export const ModuleHeader: React.FC<ModuleHeaderProps> = ({
  code,
  title,
  brief,
  icon: Icon,
  actions,
}) => (
  <header className="border-b border-netra-border pb-4 flex flex-wrap items-end justify-between gap-4">
    <div className="min-w-0">
      <div className="flex items-center gap-2 mb-2">
        {Icon && <Icon className="w-3.5 h-3.5 text-netra-purple shrink-0" />}
        <span className="telemetry-label bracketed">Module {code}</span>
      </div>

      <h1
        data-text={title}
        className="glitch-soft font-display uppercase text-netra-text leading-[0.9] tracking-tightest"
        style={{ fontSize: "clamp(1.75rem, 3.6vw, 2.75rem)" }}
      >
        {title}
      </h1>

      <p className="mt-2 text-xs text-netra-muted max-w-xl leading-relaxed">{brief}</p>
    </div>

    {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
  </header>
);
