"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ListTree, Maximize2, ZoomIn, ZoomOut, Info, Download, Filter,
  Layers, ExternalLink, Copy, Check, RefreshCw, Zap
} from "lucide-react";
import cytoscape from "cytoscape";
import { apiFetch } from "../lib/api";
import { useToast } from "./StatusToasts";

interface GraphExplorerProps {
  actorId?: string;
  onNavigate?: (view: string, targetId?: string) => void;
}

interface InspectedNode {
  id: string;
  label: string;
  type: string;
  degree: number;
  detail?: string;
  category?: string;
  links: { label: string; confidence: number; peer: string; peerId?: string }[];
}

const C_GROUND = "#0A0A0A";
const C_PHOSPHOR = "#EAEAEA";

const C = {
  ground: "#0A0A0A",
  hazard: "#E61919",
  amber: "#F0A020",
  cyan: "#00F0FF",
  purple: "#8B2CFF",
  phosphor: "#EAEAEA",
  rule: "#282828",
  edge: "#55535080",
  edgeLive: "#EAEAEA",
  muted: "#9A9A9A",
  surface: "#2A2A2A",
  surfaceLift: "#343434",
};

const ico = (svg: string) =>
  "data:image/svg+xml;utf8," + encodeURIComponent(svg.replace(/\s+/g, " ").trim());

const glyph = (body: string, stroke: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const ICON = {
  actor: ico(glyph('<circle cx="12" cy="12" r="7"/><path d="M12 1.5v3.5M12 19v3.5M1.5 12h3.5M19 12h3.5"/><circle cx="12" cy="12" r="2.1"/>', C_GROUND)),
  linkedActor: ico(glyph('<circle cx="12" cy="12" r="7"/><path d="M12 1.5v3.5M12 19v3.5M1.5 12h3.5M19 12h3.5"/><circle cx="12" cy="12" r="2.1"/>', "#E61919")),
  sharedHandle: ico(glyph('<circle cx="9" cy="8.5" r="3"/><circle cx="16" cy="15" r="3"/><path d="M4 19.5c0-2.6 2.2-4.4 5-4.4M11 5.5c2.8 0 5 1.8 5 4.4"/>', "#F0A020")),
  sharedWallet: ico(glyph('<rect x="2.5" y="6.4" width="19" height="11.6" rx="1.6"/><path d="M2.5 10.4h19"/><path d="M12 13v3M9 14.5h6"/>', "#F0A020")),
  alias: ico(glyph('<circle cx="12" cy="8.2" r="3.5"/><path d="M5.2 19.8c0-3.5 3-5.9 6.8-5.9s6.8 2.4 6.8 5.9"/>', C_PHOSPHOR)),
  pgp: ico(glyph('<circle cx="8.2" cy="12" r="3.4"/><path d="M11.6 12h9.2M17.4 12v3.4M20.4 12v2.4"/>', C_PHOSPHOR)),
  wallet: ico(glyph('<rect x="3" y="6.4" width="18" height="11.6" rx="1.6"/><path d="M3 10.4h18"/><circle cx="17" cy="14.4" r="1"/>', C_PHOSPHOR)),
  onion: ico(glyph('<circle cx="12" cy="12" r="8.4"/><ellipse cx="12" cy="12" rx="3.9" ry="8.4"/><path d="M3.6 12h16.8"/>', C_PHOSPHOR)),
  server: ico(glyph('<rect x="3" y="4.4" width="18" height="6" rx="1.4"/><rect x="3" y="13.6" width="18" height="6" rx="1.4"/><path d="M6.4 7.4h.01M6.4 16.6h.01"/>', C_PHOSPHOR)),
};

export const GraphExplorer: React.FC<GraphExplorerProps> = ({ actorId, onNavigate }) => {
  const toast = useToast();
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const reqRef = useRef(0);

  const [selectedNode, setSelectedNode] = useState<InspectedNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ nodes: 0, edges: 0 });
  const [actors, setActors] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string>(actorId ?? "");
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);

  // Layout physics selector: cose (force-directed), concentric, circle, grid
  const [layoutMode, setLayoutMode] = useState<"cose" | "concentric" | "circle" | "grid">("cose");
  // Type Filter filter chips
  const [typeFilter, setTypeFilter] = useState<string>("ALL");

  const inspect = useCallback((node: cytoscape.NodeSingular): InspectedNode => {
    const links = node
      .connectedEdges()
      .map((e) => {
        const peer = e.source().id() === node.id() ? e.target() : e.source();
        return {
          label: String(e.data("label") || "LINKED"),
          confidence: Number(e.data("confidence") ?? 0),
          peer: String(peer.data("label") || peer.id()),
          peerId: peer.id(),
        };
      })
      .sort((a, b) => b.confidence - a.confidence);

    return {
      id: node.id(),
      label: node.data("label"),
      type: node.data("type"),
      detail: node.data("detail"),
      category: node.data("category"),
      degree: node.degree(false),
      links,
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    const req = ++reqRef.current;
    const stale = () => disposed || req !== reqRef.current;

    async function loadGraphData() {
      try {
        const list = await apiFetch<any[]>("/api/v1/actors");
        if (stale()) return;
        setActors(list);

        const graphData = selectedId
          ? await apiFetch<any>(`/api/v1/actors/${selectedId}/graph`)
          : await apiFetch<any>("/api/v1/graph");
        if (stale() || !containerRef.current) return;

        const elements: cytoscape.ElementDefinition[] = [];

        (graphData.nodes || []).forEach((n: any) => {
          elements.push({
            data: {
              id: n.id,
              label: n.label,
              type: n.type,
              sharedBy: n.shared_by ?? 0,
              detail: n.detail ?? "",
              category: n.category ?? "",
            },
          });
        });

        (graphData.edges || []).forEach((e: any) => {
          elements.push({
            data: {
              id: e.id,
              source: e.source,
              target: e.target,
              label: e.label,
              confidence: typeof e.confidence === "number" ? e.confidence : 0.9,
            },
          });
        });

        setStats({
          nodes: (graphData.nodes || []).length,
          edges: (graphData.edges || []).length,
        });

        if (cyRef.current) cyRef.current.destroy();

        let chosenLayout: any = {
          name: layoutMode,
          animate: false,
          padding: 60,
        };

        if (layoutMode === "cose") {
          chosenLayout = {
            name: "cose",
            animate: false,
            padding: 60,
            nodeRepulsion: () => 22000,
            idealEdgeLength: () => 110,
            edgeElasticity: () => 80,
            gravity: 28,
            componentSpacing: 150,
            nodeDimensionsIncludeLabels: true,
            randomize: false,
            numIter: 1600,
          };
        } else if (layoutMode === "concentric") {
          chosenLayout = {
            name: "concentric",
            concentric: (n: any) => n.degree(),
            levelWidth: () => 1,
            minNodeSpacing: 78,
            padding: 64,
            avoidOverlap: true,
            animate: false,
          };
        } else if (layoutMode === "circle") {
          chosenLayout = {
            name: "circle",
            padding: 60,
            avoidOverlap: true,
            animate: false,
          };
        } else if (layoutMode === "grid") {
          chosenLayout = {
            name: "grid",
            padding: 60,
            avoidOverlap: true,
            animate: false,
          };
        }

        const cy = cytoscape({
          container: containerRef.current,
          elements,
          minZoom: 0.25,
          maxZoom: 3,
          style: [
            {
              selector: "node",
              style: {
                shape: "ellipse",
                "background-color": C.surface,
                "border-width": 2,
                "border-color": C.muted,
                width: 48,
                height: 48,
                "background-image": ICON.alias,
                "background-fit": "none",
                "background-width": "50%",
                "background-height": "50%",
                "background-image-opacity": 0.92,
                label: "data(label)",
                color: C.phosphor,
                "font-family": "JetBrains Mono, IBM Plex Mono, monospace",
                "font-size": "11px",
                "text-valign": "bottom",
                "text-margin-y": 9,
                "text-max-width": "110px",
                "text-wrap": "ellipsis",
                "text-background-color": C.ground,
                "text-background-opacity": 0.85,
                "text-background-padding": "3px",
                "transition-property": "opacity, border-color, background-color",
                "transition-duration": 140,
              },
            },
            {
              selector: 'node[type = "Actor"]',
              style: {
                shape: "hexagon",
                "background-color": C.hazard,
                "border-color": C.hazard,
                "border-width": 2,
                width: 66,
                height: 66,
                "background-image": ICON.actor,
                "background-width": "44%",
                "background-height": "44%",
                "background-image-opacity": 1,
                "font-size": "13px",
                color: C.phosphor,
                "text-margin-y": 12,
              },
            },
            {
              selector: 'node[type = "LinkedActor"]',
              style: {
                shape: "hexagon",
                "background-color": C.surface,
                "border-color": C.hazard,
                "border-width": 2,
                width: 62,
                height: 62,
                "background-image": ICON.linkedActor,
                "background-width": "44%",
                "background-height": "44%",
                "background-image-opacity": 1,
                "font-size": "12px",
                color: C.phosphor,
                "text-margin-y": 10,
              },
            },
            {
              selector: 'node[type = "SharedHandle"]',
              style: {
                shape: "round-rectangle",
                "background-color": C.surfaceLift,
                "border-color": C.amber,
                "border-width": 3,
                width: 92,
                height: 62,
                "background-image": ICON.sharedHandle,
                "background-width": "40%",
                "background-height": "40%",
                "font-size": "12px",
                color: C.amber,
                "text-margin-y": 10,
              },
            },
            {
              selector: 'node[type = "SharedWallet"]',
              style: {
                shape: "round-rectangle",
                "background-color": C.surfaceLift,
                "border-color": C.amber,
                "border-width": 3,
                width: 98,
                height: 64,
                "background-image": ICON.sharedWallet,
                "background-width": "40%",
                "background-height": "40%",
                "font-size": "11px",
                color: C.amber,
                "text-margin-y": 10,
              },
            },
            {
              selector: "node.match",
              style: {
                "border-color": "#4AF626",
                "border-width": 4,
                "text-background-color": "#0A0A0A",
                "text-background-opacity": 1,
                color: "#4AF626",
                "z-index": 40,
              },
            },
            {
              selector: 'node[type = "PGPKey"]',
              style: { shape: "diamond", width: 58, height: 58, "background-image": ICON.pgp, "background-width": "40%", "background-height": "40%", "border-color": C.phosphor },
            },
            {
              selector: 'node[type = "Wallet"]',
              style: { shape: "rectangle", width: 60, height: 44, "background-image": ICON.wallet, "background-width": "46%", "background-height": "46%", "border-color": C.phosphor },
            },
            {
              selector: 'node[type = "OnionService"]',
              style: { shape: "hexagon", width: 54, height: 54, "background-image": ICON.onion, "background-width": "46%", "background-height": "46%", "border-color": C.phosphor },
            },
            {
              selector: 'node[type = "Server"]',
              style: { shape: "rectangle", width: 56, height: 42, "background-image": ICON.server, "background-width": "46%", "background-height": "46%" },
            },
            {
              selector: "edge",
              style: {
                "line-color": "#565452",
                "target-arrow-color": "#565452",
                "target-arrow-shape": "triangle",
                "arrow-scale": 0.75,
                "curve-style": "bezier",
                width: "mapData(confidence, 0.4, 1, 1.5, 7)",
                label: "",
                "font-family": "JetBrains Mono, IBM Plex Mono, monospace",
                "font-size": "9px",
                color: C.muted,
                "text-background-color": C.ground,
                "text-background-opacity": 0.9,
                "text-background-padding": "2px",
                "transition-property": "line-color, target-arrow-color, opacity",
                "transition-duration": 140,
              },
            },
            { selector: ".dim", style: { opacity: 0.18 } },
            { selector: "node.quiet", style: { "text-opacity": 0 } },
            {
              selector: "node.hl",
              style: { "border-color": C.hazard, "border-width": 2.5 },
            },
            {
              selector: "edge.hl",
              style: {
                "line-color": C.edgeLive,
                "target-arrow-color": C.edgeLive,
                "width": 4,
                label: "data(label)",
                "z-index": 20,
              },
            },
            {
              selector: "node:selected",
              style: { "border-color": C.hazard, "border-width": 3 },
            },
          ] as any,
          layout: chosenLayout,
        });

        cyRef.current = cy;
        cy.fit(undefined, 48);

        if (typeof window !== "undefined") {
          (window as unknown as Record<string, unknown>).__NETRA_CY__ = cy;
        }

        const focus = (node: cytoscape.NodeSingular) => {
          const keep = node.closedNeighborhood();
          cy.elements().addClass("dim");
          keep.removeClass("dim").addClass("hl");
        };
        const clearFocus = () => cy.elements().removeClass("dim hl");

        cy.on("mouseover", "node", (evt) => focus(evt.target));
        cy.on("mouseout", "node", () => {
          const sel = cy.$("node:selected");
          if (sel.length) focus(sel[0] as cytoscape.NodeSingular);
          else clearFocus();
        });

        const applyLabelDensity = () => {
          if (selectedId) return;
          const zoomed = cy.zoom() > 0.6;
          cy.nodes().forEach((n) => {
            const t = n.data("type");
            const always = t === "Actor" || t === "SharedHandle" || t === "SharedWallet";
            n.toggleClass("quiet", !always && !zoomed);
          });
        };
        applyLabelDensity();
        cy.on("zoom", applyLabelDensity);

        cy.on("tap", "node", (evt) => {
          setSelectedNode(inspect(evt.target));
          focus(evt.target);
        });

        cy.on("tap", (evt) => {
          if (evt.target === cy) {
            setSelectedNode(null);
            clearFocus();
          }
        });

        const el = containerRef.current;
        cy.on("mouseover", "node", () => { if (el) el.style.cursor = "pointer"; });
        cy.on("mouseout", "node", () => { if (el) el.style.cursor = "default"; });
      } catch (err) {
        console.error("Failed loading graph", err);
      } finally {
        if (!stale()) setLoading(false);
      }
    }

    loadGraphData();
    return () => {
      disposed = true;
      if (cyRef.current) {
        cyRef.current.destroy();
        cyRef.current = null;
      }
    };
  }, [actorId, selectedId, layoutMode, inspect]);

  // Apply node search filtering
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const q = query.trim().toLowerCase();
    cy.elements().removeClass("match dim hl");
    if (!q) return;

    const hits = cy.nodes().filter((n) => {
      const l = String(n.data("label") ?? "").toLowerCase();
      const d = String(n.data("detail") ?? "").toLowerCase();
      const c = String(n.data("category") ?? "").toLowerCase();
      return l.includes(q) || d.includes(q) || c.includes(q);
    });
    if (hits.length === 0) return;

    const keep = hits.closedNeighborhood();
    cy.elements().addClass("dim");
    keep.removeClass("dim");
    hits.removeClass("dim").addClass("match");
    cy.animate({ fit: { eles: keep, padding: 90 }, duration: 320 });
  }, [query, stats]);

  // Apply Type Filter
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes().removeClass("dim");
    if (typeFilter === "ALL") return;

    cy.nodes().forEach((n) => {
      const t = n.data("type");
      if (
        (typeFilter === "ACTOR" && (t === "Actor" || t === "LinkedActor")) ||
        (typeFilter === "PGP" && t === "PGPKey") ||
        (typeFilter === "WALLET" && (t === "Wallet" || t === "SharedWallet")) ||
        (typeFilter === "ONION" && t === "OnionService") ||
        (typeFilter === "SHARED" && (t === "SharedHandle" || t === "SharedWallet"))
      ) {
        n.removeClass("dim");
      } else {
        n.addClass("dim");
      }
    });
  }, [typeFilter]);

  const zoomBy = (factor: number) => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.zoom({ level: cy.zoom() * factor, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
  };

  const handleRecenter = () => {
    if (cyRef.current) cyRef.current.fit(undefined, 48);
  };

  const handleExportPNG = () => {
    const cy = cyRef.current;
    if (!cy) return;
    const png = cy.png({ bg: "#0A0A0A", full: true, scale: 2 });
    const a = document.createElement("a");
    a.href = png;
    a.download = `netrax_intelligence_graph_${selectedId || "full"}.png`;
    a.click();
    toast.push("ok", "Graph Exported", "Saved high-resolution graph PNG image");
  };

  const handleCopyUUID = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopied(true);
    toast.push("ok", "Copied to Clipboard", `UUID ${id} copied`);
    setTimeout(() => setCopied(false), 2000);
  };

  const ctrl =
    "p-2 border border-netra-border bg-netra-surface text-netra-muted hover:text-white hover:border-netra-cyan transition-colors";

  return (
    <div className="space-y-4 font-sans">
      {/* Header Toolbar */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end border-b border-netra-border pb-3 gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <ListTree className="w-3.5 h-3.5 text-netra-purple shrink-0" />
            <span className="telemetry-label bracketed">Module 05</span>
          </div>
          <h1
            data-text="Intelligence Graph"
            className="glitch-soft font-display uppercase text-netra-text leading-[0.9] tracking-tightest"
            style={{ fontSize: "clamp(1.75rem, 3.6vw, 2.75rem)" }}
          >
            Intelligence Graph
          </h1>
          <p className="mt-2 text-xs text-netra-muted max-w-xl leading-relaxed">
            Multi-modal threat actor entity graph. Heuristic node filtering and
            physics layouts over the projected topology.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Node Type Filter Chips */}
          <div className="flex items-center space-x-1 bg-netra-surface p-1 rounded-lg border border-netra-border font-mono text-[10px]">
            {[
              { id: "ALL", label: "All" },
              { id: "ACTOR", label: "Actors" },
              { id: "PGP", label: "PGP Keys" },
              { id: "WALLET", label: "Wallets" },
              { id: "ONION", label: "Onions" },
              { id: "SHARED", label: "Shared" },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setTypeFilter(f.id)}
                className={`px-2 py-1 rounded transition ${
                  typeFilter === f.id
                    ? "bg-netra-cyan text-netra-bg font-bold"
                    : "text-netra-subtle hover:text-white"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Layout Physics Switcher */}
          <select
            value={layoutMode}
            onChange={(e: any) => setLayoutMode(e.target.value)}
            className="bg-netra-surface border border-netra-border text-netra-text font-mono text-[11px] px-2 py-1.5 focus:border-netra-cyan outline-none rounded"
          >
            <option value="cose">Force-Directed (cose)</option>
            <option value="concentric">Concentric Rings</option>
            <option value="circle">Circular Topology</option>
            <option value="grid">Grid Matrix</option>
          </select>

          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search handle, wallet..."
            aria-label="Search the graph"
            className="bg-netra-surface border border-netra-border text-netra-text font-mono text-[11px] px-2.5 py-1.5 w-[160px] placeholder:text-netra-subtle focus:border-netra-cyan outline-none rounded"
          />

          {actors.length > 1 && (
            <select
              value={selectedId}
              onChange={(e) => {
                setSelectedId(e.target.value);
                setSelectedNode(null);
                setLoading(true);
              }}
              aria-label="Actor under investigation"
              className="bg-netra-surface border border-netra-border text-netra-text font-mono text-[11px] px-2 py-1.5 focus:border-netra-cyan outline-none max-w-[180px] rounded"
            >
              <option value="">— Full network map —</option>
              {actors.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.primary_alias} — {a.category}
                </option>
              ))}
            </select>
          )}

          <button
            onClick={handleExportPNG}
            className="px-3 py-1.5 rounded bg-netra-purple/20 border border-netra-purple/40 text-netra-purple hover:text-white text-xs font-mono transition flex items-center space-x-1"
            title="Export Graph PNG Image"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export PNG</span>
          </button>

          <div className="flex rounded overflow-hidden">
            <button onClick={() => zoomBy(1.3)} className={ctrl} title="Zoom in" aria-label="Zoom in">
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => zoomBy(1 / 1.3)} className={`${ctrl} border-l-0`} title="Zoom out" aria-label="Zoom out">
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button onClick={handleRecenter} className={`${ctrl} border-l-0`} title="Fit canvas" aria-label="Fit canvas">
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Canvas + Node Inspector Sidebar */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 h-[calc(100vh-215px)] min-h-[640px]">
        <div className="md:col-span-4 bg-netra-card border border-netra-border rounded-xl relative overflow-hidden glass-panel">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-netra-bg/80 z-20 text-xs font-mono text-netra-cyan animate-pulse space-x-2">
              <RefreshCw className="w-4 h-4 animate-spin text-netra-cyan" />
              <span>Rendering Interactive Topology Graph ({layoutMode.toUpperCase()})...</span>
            </div>
          )}
          <div
            ref={containerRef}
            className="w-full h-full"
            style={{
              backgroundImage:
                "linear-gradient(#1C1C1C 1px, transparent 1px), linear-gradient(90deg, #1C1C1C 1px, transparent 1px)",
              backgroundSize: "44px 44px",
            }}
          />

          {/* Canvas Key Legend */}
          {!loading && (
            <div className="absolute bottom-0 left-0 border-t border-r border-netra-border bg-netra-bg/95 px-3 py-2 font-mono text-[9px] uppercase tracking-telemetry text-netra-subtle flex items-center gap-x-4 rounded-tr-lg">
              <span className="flex items-center gap-x-1.5">
                <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
                  <polygon points="5.5,0 11,3 11,8 5.5,11 0,8 0,3" fill="#E61919" />
                </svg>
                Actor
              </span>
              <span className="flex items-center gap-x-1.5">
                <svg width="14" height="11" viewBox="0 0 14 11" aria-hidden="true">
                  <rect x="0.8" y="1.4" width="12.4" height="8.2" rx="2" fill="#343434" stroke="#F0A020" strokeWidth="1.8" />
                </svg>
                Shared Cluster
              </span>
              <span className="flex items-center gap-x-1.5">
                <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
                  <circle cx="5.5" cy="5.5" r="4.4" fill="#141414" stroke="#8A8A8A" strokeWidth="1.4" />
                </svg>
                Handle
              </span>
              <span className="flex items-center gap-x-1.5">
                <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
                  <polygon points="5.5,0.6 10.4,5.5 5.5,10.4 0.6,5.5" fill="#141414" stroke="#EAEAEA" strokeWidth="1.4" />
                </svg>
                PGP
              </span>
              <span className="flex items-center gap-x-1.5">
                <svg width="13" height="11" viewBox="0 0 13 11" aria-hidden="true">
                  <rect x="0.7" y="1.7" width="11.6" height="7.6" fill="#141414" stroke="#EAEAEA" strokeWidth="1.4" />
                </svg>
                Wallet
              </span>
              <span className="text-netra-subtle/70">| {stats.nodes} Nodes • {stats.edges} Edges</span>
            </div>
          )}
        </div>

        {/* Node Inspector Panel */}
        <div className="bg-netra-card border border-netra-border rounded-xl p-4 space-y-4 font-mono text-xs overflow-y-auto flex flex-col justify-between">
          <div className="space-y-3">
            <h2 className="font-semibold text-white border-b border-netra-border pb-2 flex items-center justify-between">
              <span className="flex items-center space-x-2">
                <Info className="w-4 h-4 text-netra-cyan" />
                <span>Node Inspector</span>
              </span>
              {selectedNode && (
                <button
                  onClick={() => handleCopyUUID(selectedNode.id)}
                  className="p-1 text-netra-subtle hover:text-white rounded hover:bg-netra-surface"
                  title="Copy Node UUID"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-netra-valid" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              )}
            </h2>

            {selectedNode ? (
              <div className="space-y-3">
                <div>
                  <span className="text-netra-subtle uppercase tracking-telemetry text-[10px]">Node Type</span>
                  <div className="text-netra-cyan font-bold">{selectedNode.type}</div>
                </div>

                <div>
                  <span className="text-netra-subtle uppercase tracking-telemetry text-[10px]">Label / Handle</span>
                  <div className="text-white font-bold break-all text-xs">{selectedNode.label}</div>
                </div>

                <div>
                  <span className="text-netra-subtle uppercase tracking-telemetry text-[10px]">UUIDv7 Entity ID</span>
                  <div className="text-netra-muted text-[10px] break-all">{selectedNode.id}</div>
                </div>

                <div className="pt-2 border-t border-netra-border">
                  <span className="text-netra-subtle uppercase tracking-telemetry text-[10px]">
                    Linked Edges ({selectedNode.degree})
                  </span>
                  <div className="mt-2 space-y-2 max-h-[220px] overflow-y-auto pr-1">
                    {selectedNode.links.map((l, i) => (
                      <div key={i} className="border-l-2 border-netra-cyan/60 pl-2 py-0.5 space-y-0.5">
                        <div className="text-white text-[10px] font-semibold break-all">{l.peer}</div>
                        <div className="flex items-center justify-between text-[9px] text-netra-subtle">
                          <span className="uppercase text-netra-purple">{l.label}</span>
                          <span className="text-netra-valid">{(l.confidence * 100).toFixed(0)}%</span>
                        </div>
                        <div className="h-[2px] bg-netra-border rounded">
                          <div
                            className="h-full bg-netra-cyan rounded"
                            style={{ width: `${Math.max(2, l.confidence * 100)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                    {selectedNode.links.length === 0 && (
                      <div className="text-netra-subtle text-[10px]">No linked edges in this projection.</div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-netra-subtle text-[11px] leading-relaxed space-y-2">
                <p>
                  Hover over any node to isolate its 1-hop neighborhood. Click a node to view attributes, PGP fingerprints, wallet co-spending clusters, and edge confidence.
                </p>
                <div className="p-2.5 rounded bg-netra-surface border border-netra-border text-[10px] space-y-1">
                  <div className="text-white font-bold">Quick Controls:</div>
                  <div>• Use top filter chips to isolate PGP or Wallets</div>
                  <div>• Switch layout physics to Concentric or Circle</div>
                  <div>• Export high-res PNG graph for evidence</div>
                </div>
              </div>
            )}
          </div>

          {selectedNode && onNavigate && (
            <button
              onClick={() => onNavigate("attribution_lab", selectedNode.id)}
              className="w-full py-2 bg-netra-purple/20 hover:bg-netra-purple border border-netra-purple/40 text-netra-purple hover:text-white rounded text-xs font-bold transition flex items-center justify-center space-x-1.5"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Inspect in Attribution Lab</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
