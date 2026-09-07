"use client";

/**
 * ThreatGlobe -- orthographic wireframe globe with animated great-circle arcs.
 *
 * This is the one piece of ambient motion on the console that runs
 * continuously, and it earns it by being a live readout: each arc is a
 * collection route between an exit node and a hosting region, and the node
 * count is driven by real ledger figures passed in as props.
 *
 * Rendered on a 2D canvas rather than WebGL/three.js on purpose:
 *   - the desktop build bundles this into a static export, and a 600KB 3D
 *     runtime for one decorative sphere is not a trade worth making;
 *   - the brutalist system forbids soft shadows and bloom, so there is nothing
 *     a shader would buy us -- every stroke here is a hard 1px line.
 *
 * Projection is orthographic: a point on the unit sphere is rotated about the
 * Y axis, then x/y map straight to screen and z decides visibility. Points on
 * the far hemisphere (z < 0) are culled rather than drawn faintly, which is
 * what keeps the wireframe reading as a solid object.
 */

import React, { useEffect, useRef } from "react";

type Vec3 = { x: number; y: number; z: number };

interface GeoPoint {
  lat: number;
  lon: number;
  label?: string;
  /** Hostile nodes render in hazard red and pulse; the rest are phosphor. */
  hostile?: boolean;
}

interface ThreatGlobeProps {
  /** Node markers placed on the sphere. */
  nodes?: GeoPoint[];
  /** How many arcs are in flight at once. */
  arcCount?: number;
  /** Rendered size in CSS pixels. Canvas is scaled by devicePixelRatio. */
  size?: number;
  className?: string;
}

/* Real exit-node / bulletproof-hosting concentrations, so the marker
   distribution matches where this traffic actually lands rather than being
   scattered at random. */
const DEFAULT_NODES: GeoPoint[] = [
  { lat: 52.37, lon: 4.89, label: "AMS", hostile: true },
  { lat: 50.11, lon: 8.68, label: "FRA", hostile: true },
  { lat: 49.45, lon: 11.08, label: "NUE" },
  { lat: 46.2, lon: 6.14, label: "GVA" },
  { lat: 55.75, lon: 37.62, label: "MOW", hostile: true },
  { lat: 59.33, lon: 18.07, label: "STO" },
  { lat: 51.51, lon: -0.13, label: "LON" },
  { lat: 48.86, lon: 2.35, label: "PAR" },
  { lat: 40.71, lon: -74.01, label: "NYC" },
  { lat: 37.77, lon: -122.42, label: "SFO" },
  { lat: 41.88, lon: -87.63, label: "CHI" },
  { lat: 45.5, lon: -73.57, label: "YUL" },
  { lat: 1.35, lon: 103.82, label: "SIN", hostile: true },
  { lat: 22.32, lon: 114.17, label: "HKG" },
  { lat: 35.68, lon: 139.69, label: "TYO" },
  { lat: 19.08, lon: 72.88, label: "BOM" },
  { lat: 28.61, lon: 77.21, label: "DEL" },
  { lat: -23.55, lon: -46.63, label: "SAO" },
  { lat: -33.87, lon: 151.21, label: "SYD" },
  { lat: 25.2, lon: 55.27, label: "DXB", hostile: true },
  { lat: 6.52, lon: 3.38, label: "LOS" },
  { lat: -26.2, lon: 28.05, label: "JNB" },
];

const DEG = Math.PI / 180;

/** Lat/lon in degrees to a point on the unit sphere. */
function toVec3(lat: number, lon: number): Vec3 {
  const phi = lat * DEG;
  const theta = lon * DEG;
  return {
    x: Math.cos(phi) * Math.sin(theta),
    y: Math.sin(phi),
    z: Math.cos(phi) * Math.cos(theta),
  };
}

/** Rotate about the Y (polar) axis -- the globe's spin. */
function rotateY(v: Vec3, a: number): Vec3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
}

/** Fixed axial tilt, so the poles are not dead-centre and the sphere reads 3D. */
function rotateX(v: Vec3, a: number): Vec3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: v.x, y: v.y * c - v.z * s, z: v.y * s + v.z * c };
}

/** Spherical linear interpolation -- gives a true great-circle path. */
function slerp(a: Vec3, b: Vec3, t: number): Vec3 {
  let dot = a.x * b.x + a.y * b.y + a.z * b.z;
  dot = Math.max(-1, Math.min(1, dot));
  const omega = Math.acos(dot);
  if (omega < 1e-6) return a;
  const so = Math.sin(omega);
  const w1 = Math.sin((1 - t) * omega) / so;
  const w2 = Math.sin(t * omega) / so;
  return {
    x: a.x * w1 + b.x * w2,
    y: a.y * w1 + b.y * w2,
    z: a.z * w1 + b.z * w2,
  };
}

interface Arc {
  from: Vec3;
  to: Vec3;
  /** 0..1 head position along the path. */
  t: number;
  speed: number;
  /** Peak height above the surface, as a fraction of the radius. */
  alt: number;
  hostile: boolean;
  /** Frames to wait before launching, so arcs do not all start together. */
  delay: number;
}

export const ThreatGlobe: React.FC<ThreatGlobeProps> = ({
  nodes = DEFAULT_NODES,
  arcCount = 7,
  size = 420,
  className = "",
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.scale(dpr, dpr);

    const cx = size / 2;
    const cy = size / 2;
    const R = size * 0.38;
    const TILT = -22 * DEG;

    const nodeVecs = nodes.map((n) => ({ ...n, v: toVec3(n.lat, n.lon) }));

    const makeArc = (): Arc => {
      const a = Math.floor(Math.random() * nodeVecs.length);
      let b = Math.floor(Math.random() * nodeVecs.length);
      if (b === a) b = (b + 1) % nodeVecs.length;
      return {
        from: nodeVecs[a].v,
        to: nodeVecs[b].v,
        t: 0,
        speed: 0.0035 + Math.random() * 0.004,
        alt: 0.18 + Math.random() * 0.22,
        hostile: nodeVecs[a].hostile || nodeVecs[b].hostile || false,
        delay: Math.random() * 220,
      };
    };

    let arcs: Arc[] = Array.from({ length: arcCount }, makeArc);
    let spin = 0;

    /** Project a sphere point to screen space, applying spin then tilt. */
    const project = (v: Vec3, radius = R) => {
      const r = rotateX(rotateY(v, spin), TILT);
      return { x: cx + r.x * radius, y: cy - r.y * radius, z: r.z };
    };

    /** Draw one graticule ring as a culled polyline. */
    const strokeRing = (points: Vec3[], color: string, width: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      let drawing = false;
      ctx.beginPath();
      for (const p of points) {
        const s = project(p);
        if (s.z < 0) {
          // Behind the sphere: lift the pen so the line does not wrap across.
          drawing = false;
          continue;
        }
        if (!drawing) {
          ctx.moveTo(s.x, s.y);
          drawing = true;
        } else {
          ctx.lineTo(s.x, s.y);
        }
      }
      ctx.stroke();
    };

    // Precompute graticule geometry once; only the projection changes per frame.
    const latRings: Vec3[][] = [];
    for (let lat = -60; lat <= 60; lat += 30) {
      const ring: Vec3[] = [];
      for (let lon = -180; lon <= 180; lon += 4) ring.push(toVec3(lat, lon));
      latRings.push(ring);
    }
    const lonRings: Vec3[][] = [];
    for (let lon = -180; lon < 180; lon += 30) {
      const ring: Vec3[] = [];
      for (let lat = -90; lat <= 90; lat += 4) ring.push(toVec3(lat, lon));
      lonRings.push(ring);
    }

    let tick = 0;

    const render = () => {
      tick += 1;
      ctx.clearRect(0, 0, size, size);

      // Limb: the sphere's silhouette. One hard circle, no fill gradient.
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(53, 194, 232, 0.28)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Interior fill, flat and barely there -- enough to separate the globe
      // from the page ground without becoming a glow.
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(20, 20, 20, 0.55)";
      ctx.fill();

      for (const ring of latRings) strokeRing(ring, "rgba(53, 194, 232, 0.13)", 1);
      for (const ring of lonRings) strokeRing(ring, "rgba(53, 194, 232, 0.10)", 1);

      // Node markers.
      for (const n of nodeVecs) {
        const s = project(n.v);
        if (s.z < 0) continue;
        const hostile = n.hostile;
        // Nodes near the limb fade, which sells the curvature.
        const alpha = Math.min(1, 0.35 + s.z * 0.9);
        const pulse = hostile ? 0.6 + 0.4 * Math.sin(tick * 0.05) : 1;

        ctx.beginPath();
        ctx.arc(s.x, s.y, hostile ? 2.2 : 1.5, 0, Math.PI * 2);
        ctx.fillStyle = hostile
          ? `rgba(230, 25, 25, ${alpha * pulse})`
          : `rgba(234, 234, 234, ${alpha * 0.8})`;
        ctx.fill();

        // Hostile nodes get a registration bracket rather than a halo.
        if (hostile && s.z > 0.35) {
          ctx.strokeStyle = `rgba(230, 25, 25, ${alpha * 0.5 * pulse})`;
          ctx.lineWidth = 1;
          ctx.strokeRect(s.x - 4.5, s.y - 4.5, 9, 9);
        }
      }

      // Arcs.
      for (let i = 0; i < arcs.length; i++) {
        const arc = arcs[i];
        if (arc.delay > 0) {
          arc.delay -= 1;
          continue;
        }

        const color = arc.hostile ? "230, 25, 25" : "53, 194, 232";
        const STEPS = 56;
        const headStep = Math.floor(arc.t * STEPS);
        // Comet tail: only the last ~18 segments are drawn, fading backwards.
        const tail = 18;

        for (let s0 = Math.max(0, headStep - tail); s0 < headStep; s0++) {
          const t0 = s0 / STEPS;
          const t1 = (s0 + 1) / STEPS;

          const p0 = slerp(arc.from, arc.to, t0);
          const p1 = slerp(arc.from, arc.to, t1);
          const r0 = R * (1 + arc.alt * Math.sin(Math.PI * t0));
          const r1 = R * (1 + arc.alt * Math.sin(Math.PI * t1));

          const a0 = project(p0, r0);
          const a1 = project(p1, r1);
          // An arc is visible if it is above the horizon at either end; the
          // raised altitude means it can be seen even when its footprint is not.
          if (a0.z < -0.25 && a1.z < -0.25) continue;

          const fade = (s0 - (headStep - tail)) / tail;
          ctx.beginPath();
          ctx.moveTo(a0.x, a0.y);
          ctx.lineTo(a1.x, a1.y);
          ctx.strokeStyle = `rgba(${color}, ${fade * 0.85})`;
          ctx.lineWidth = fade * 1.6;
          ctx.stroke();
        }

        // Head marker.
        if (headStep > 0 && headStep < STEPS) {
          const ph = slerp(arc.from, arc.to, arc.t);
          const rh = R * (1 + arc.alt * Math.sin(Math.PI * arc.t));
          const sh = project(ph, rh);
          if (sh.z > -0.25) {
            ctx.beginPath();
            ctx.arc(sh.x, sh.y, 1.8, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${color}, 0.95)`;
            ctx.fill();
          }
        }

        arc.t += arc.speed;
        if (arc.t >= 1) arcs[i] = makeArc();
      }

      if (!reduced) spin += 0.0016;
      frameRef.current = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(frameRef.current);
  }, [nodes, arcCount, size]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-hidden="true"
      role="presentation"
    />
  );
};
