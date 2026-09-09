"use client";

/**
 * Sparkline and Waveform -- micro-charts for the stat blocks and status rail.
 *
 * Deliberately axis-free and label-free: these show shape and direction, not
 * values. Anything an analyst has to read a number off gets a real figure in
 * monospace next to it, never a chart tooltip.
 *
 * The stroke is drawn with a dash-offset reveal so the line writes itself in
 * on mount -- one pass, then it stops.
 */

import React, { useEffect, useRef, useState } from "react";

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  /** Draw the area beneath the line as a flat fill. */
  fill?: boolean;
  className?: string;
}

export const Sparkline: React.FC<SparklineProps> = ({
  data,
  width = 120,
  height = 28,
  color = "#35C2E8",
  fill = true,
  className = "",
}) => {
  if (!data.length) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const stepX = width / (data.length - 1 || 1);

  const points = data.map((v, i) => {
    const x = i * stepX;
    // 2px inset top and bottom so the stroke is never clipped.
    const y = height - 2 - ((v - min) / span) * (height - 4);
    return [x, y] as const;
  });

  const line = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      {fill && <path d={area} fill={color} opacity={0.1} />}
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={1.25}
        vectorEffect="non-scaling-stroke"
        className="spark-draw"
      />
    </svg>
  );
};

interface WaveformProps {
  /** Number of vertical bars. */
  bars?: number;
  width?: number;
  height?: number;
  color?: string;
  className?: string;
  /** Frozen bars, for a panel that is not currently receiving. */
  live?: boolean;
}

/**
 * Signal-activity waveform for the ingest rail. Perpetual motion is sanctioned
 * here for the same reason as a status LED: it is showing that a stream is
 * open, and it stops when the stream does.
 */
export const Waveform: React.FC<WaveformProps> = ({
  bars = 28,
  width = 120,
  height = 24,
  color = "#4AF626",
  className = "",
  live = true,
}) => {
  // Seeded deterministically rather than with Math.random(): a random initial
  // array differs between the server render and the client's first render, and
  // React flags the mismatched bar heights on hydration. The animation below
  // takes over on mount and is random from there.
  const [levels, setLevels] = useState<number[]>(() =>
    Array.from({ length: bars }, (_, i) => 0.2 + 0.5 * Math.abs(Math.sin(i * 1.7)))
  );
  const raf = useRef<number>(0);

  useEffect(() => {
    if (!live) return;
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    let last = 0;
    const tick = (t: number) => {
      // Throttled to ~12fps: an audio-rate redraw is wasted on a 28-bar meter
      // and this sits on screen for an entire shift.
      if (t - last > 80) {
        last = t;
        setLevels((prev) => {
          const next = prev.slice(1);
          next.push(0.1 + Math.random() * Math.random() * 1.4);
          return next;
        });
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [live, bars]);

  const bw = width / bars;

  return (
    <svg width={width} height={height} className={className} aria-hidden="true">
      {levels.map((l, i) => {
        const h = Math.max(1, Math.min(1, l) * height);
        return (
          <rect
            key={i}
            x={i * bw}
            y={height - h}
            width={Math.max(1, bw - 1)}
            height={h}
            fill={color}
            opacity={live ? 0.35 + (i / bars) * 0.55 : 0.18}
          />
        );
      })}
    </svg>
  );
};
