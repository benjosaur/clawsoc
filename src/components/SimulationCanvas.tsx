"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import type { SimState, ClientPopup, ParticleMeta } from "@/hooks/useServerSimulation";
import { bounceOffWallsXY } from "@/simulation/physics";

const TICKS_PER_SEC = 60;
const MS_PER_TICK = 1000 / TICKS_PER_SEC;
const MAX_CATCHUP_TICKS = 12; // cap per frame to prevent death spiral
const POPUP_DURATION_MS = 670;

interface Props {
  simRef: React.RefObject<SimState>;
  metaRef: React.RefObject<Map<string, ParticleMeta>>;
  popupsRef: React.RefObject<ClientPopup[]>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
}

/** Advance one tick of client-side physics (movement + wall bounce).
 *  Uses the same bounceOffWallsXY as the server to guarantee parity. */
// Spread correction over ~3s (180 ticks at 60fps). 1 - (1-α)^180 ≈ 0.99
const SYNC_LERP = 0.026;
const APPROACH_TICKS = 12;

function stepParticles(sim: SimState): void {
  const { canvasWidth, canvasHeight } = sim.config;
  for (const p of sim.particles) {
    if (p.state === 2) {
      // Smooth approach: lerp velocity toward entry direction (decaying to zero)
      const remaining = Math.max(0, p.freezeAt - sim.localTick);
      const decay = remaining / APPROACH_TICKS;
      const VEL_LERP = 0.2;
      const POS_LERP = 0.15;
      p.vx += (p.tvx * decay - p.vx) * VEL_LERP;
      p.vy += (p.tvy * decay - p.vy) * VEL_LERP;
      p.x += (p.tx - p.x) * POS_LERP;
      p.y += (p.ty - p.y) * POS_LERP;
      if (remaining <= 0) {
        p.x = p.tx; p.y = p.ty;
        p.vx = 0; p.vy = 0;
        p.state = 1;
      }
      continue;
    }
    if (p.state !== 0) continue;
    // Apply fraction of correction offset (smooth sync)
    if (p.cx !== 0 || p.cy !== 0) {
      p.x += p.cx * SYNC_LERP;
      p.y += p.cy * SYNC_LERP;
      p.cx *= (1 - SYNC_LERP);
      p.cy *= (1 - SYNC_LERP);
    }
    p.x += p.vx;
    p.y += p.vy;
    const b = bounceOffWallsXY(p.x, p.y, p.vx, p.vy, p.radius, canvasWidth, canvasHeight);
    p.x = b.x; p.y = b.y; p.vx = b.vx; p.vy = b.vy;
  }
  sim.localTick++;
}

// Strategy display names
const STRATEGY_LABELS: Record<string, string> = {
  always_cooperate: "Always Cooperate",
  always_defect: "Always Defect",
  tit_for_tat: "Tit for Tat",
  random: "Random",
  grudger: "Grudger",
  external: "External",
};

export default function SimulationCanvas({ simRef, metaRef, popupsRef, containerRef, selectedId, onSelect }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // Shared refs for mouse → draw loop coordination
  const transformRef = useRef({ camX: 0, camY: 0, s: 1 });
  const displayRef = useRef<{ id: string; x: number; y: number; radius: number }[]>([]);
  const dprRef = useRef(1);

  // Hover: track particle ID in state (triggers render), position in ref (no render)
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const hoverPosRef = useRef({ x: 0, y: 0 });
  const tooltipRef = useRef<HTMLDivElement>(null);

  const hitTest = useCallback((clientX: number, clientY: number): string | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const dpr = dprRef.current;
    const cx = (clientX - rect.left) * dpr;
    const cy = (clientY - rect.top) * dpr;
    const { camX, camY, s } = transformRef.current;
    const wx = (cx - camX) / s;
    const wy = (cy - camY) / s;

    // Use a generous hit area (bounding box with padding) around each particle
    const HIT_PAD = 6;
    let closest: string | null = null;
    let closestDistSq = Infinity;
    for (const p of displayRef.current) {
      const dx = wx - p.x;
      const dy = wy - p.y;
      const hitR = p.radius + HIT_PAD;
      // Quick bounding-box check then distance
      if (Math.abs(dx) > hitR || Math.abs(dy) > hitR) continue;
      const distSq = dx * dx + dy * dy;
      if (distSq <= hitR * hitR && distSq < closestDistSq) {
        closest = p.id;
        closestDistSq = distSq;
      }
    }
    return closest;
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const id = hitTest(e.clientX, e.clientY);
    canvas.style.cursor = id != null ? "pointer" : "default";

    if (id == null || id === selectedIdRef.current) {
      setHoveredId((prev) => prev !== null ? null : prev);
      return;
    }

    const rect = canvas.getBoundingClientRect();
    hoverPosRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    // Update tooltip position imperatively to avoid re-renders on every mouse move
    if (tooltipRef.current) {
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      tooltipRef.current.style.left = `${mx + 12}px`;
      tooltipRef.current.style.top = `${my + 12}px`;
      tooltipRef.current.style.transform =
        `${mx > cw - 180 ? "translateX(calc(-100% - 24px))" : ""}` +
        `${my > ch - 80 ? " translateY(calc(-100% - 24px))" : ""}`;
    }
    setHoveredId((prev) => prev === id ? prev : id);
  }, [hitTest]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const id = hitTest(e.clientX, e.clientY);
    if (!onSelectRef.current) return;
    if (id != null && id === selectedIdRef.current) {
      onSelectRef.current(null);
    } else {
      onSelectRef.current(id);
    }
    setHoveredId(null);
  }, [hitTest]);

  const handleMouseLeave = useCallback(() => {
    setHoveredId(null);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let scale = 1;
    let dpr = window.devicePixelRatio || 1;

    function resize() {
      if (!canvas || !ctx || !container) return;
      dpr = window.devicePixelRatio || 1;
      dprRef.current = dpr;
      const sim = simRef.current;
      const worldW = sim.config.canvasWidth;
      const worldH = sim.config.canvasHeight;
      const cw = container.clientWidth;
      scale = cw / worldW;
      const ch = Math.round(cw * (worldH / worldW));

      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
      canvas.style.width = `${cw}px`;
      canvas.style.height = `${ch}px`;
    }

    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(container);

    let raf: number;

    function draw() {
      if (!ctx || !canvas) return;

      const sim = simRef.current;
      const worldW = sim.config.canvasWidth;
      const worldH = sim.config.canvasHeight;
      const now = performance.now();

      // Advance physics ticks
      if (sim.particles.length > 0) {
        const elapsed = now - sim.lastAdvanceTime;
        const rawTicks = Math.floor(elapsed / MS_PER_TICK);
        if (rawTicks >= MAX_CATCHUP_TICKS) {
          // Too far behind (e.g. tab was backgrounded) — snap corrections
          for (const p of sim.particles) {
            if (p.state === 2) {
              p.x = p.tx; p.y = p.ty;
              p.vx = 0; p.vy = 0;
              p.state = 1;
            }
            p.x += p.cx;
            p.y += p.cy;
            p.cx = 0;
            p.cy = 0;
          }
          for (let i = 0; i < MAX_CATCHUP_TICKS; i++) stepParticles(sim);
          sim.lastAdvanceTime = now;
        } else if (rawTicks > 0) {
          for (let i = 0; i < rawTicks; i++) stepParticles(sim);
          sim.lastAdvanceTime += rawTicks * MS_PER_TICK;
        }
      }

      if (sim.particles.length === 0) {
        raf = requestAnimationFrame(draw);
        return;
      }

      // Sub-tick fraction for smooth rendering
      const fraction = (now - sim.lastAdvanceTime) / MS_PER_TICK;

      // Build display positions (sub-tick interpolated)
      const meta = metaRef.current;
      const displayParticles = sim.particles.map((p) => {
        const m = meta.get(p.id);
        const isMoving = p.state === 0;
        return {
          id: p.id,
          x: isMoving ? p.x + p.vx * fraction : p.x,
          y: isMoving ? p.y + p.vy * fraction : p.y,
          state: p.state,
          color: m?.color ?? "#888",
          radius: p.radius,
          avgScore: m?.avgScore ?? 0,
          strategy: m?.strategy,
        };
      });

      // Store for hit testing
      displayRef.current = displayParticles;

      const sel = selectedIdRef.current;
      const s = dpr * scale;
      // Store transform for mouse event coordinate conversion
      transformRef.current = { camX: 0, camY: 0, s };
      ctx.setTransform(s, 0, 0, s, 0, 0);

      // Background
      ctx.fillStyle = "#fafafa";
      ctx.fillRect(-worldW, -worldH, worldW * 3, worldH * 3);

      // Subtle dot grid
      ctx.fillStyle = "#e2e2e2";
      for (let gx = 20; gx < worldW; gx += 20) {
        for (let gy = 20; gy < worldH; gy += 20) {
          ctx.beginPath();
          ctx.arc(gx, gy, 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Draw particles
      for (const p of displayParticles) {
        const isSelected = sel != null && p.id === sel;
        const isParked = p.state === 3;
        ctx.save();

        if (isParked) {
          ctx.globalAlpha = 0.4;
        } else if (p.state === 1 || p.state === 2) {
          ctx.shadowColor = p.color;
          ctx.shadowBlur = 24;
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();

        ctx.restore();

        ctx.save();

        // Average score inside circle
        const isSmall = (container?.clientWidth ?? 640) < 640;
        const fontScale = Math.max(1, 1 / scale);
        const scoreFontSize = (p.radius > 12 ? 10 : 8) * fontScale * (isSmall ? 0.7 : 1);
        ctx.fillStyle = "#fff";
        ctx.font = `bold ${scoreFontSize}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        const metrics = ctx.measureText(Math.round(p.avgScore).toString());
        const textHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
        ctx.fillText(Math.round(p.avgScore).toString(), p.x, p.y + textHeight / 2);

        // Name label above
        const labelFontSize = 8 * fontScale * (isSmall ? 0.7 : 1);
        ctx.fillStyle = p.strategy === "external" ? "#E54D2E" : (isSelected ? "#18181b" : "#71717a");
        ctx.font = `${isSelected ? "bold " : ""}${labelFontSize}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(p.id, p.x, p.y - p.radius - 4);

        ctx.restore();
      }

      // Draw floating popups
      const popups = popupsRef.current;
      const popupFontScale = Math.max(1, 1 / scale);
      for (const popup of popups) {
        const progress = Math.min(1, (now - popup.spawnTime) / POPUP_DURATION_MS);
        if (progress >= 1) continue;
        const alpha = 1 - progress;
        const yOffset = progress * 18;

        ctx.save();
        ctx.globalAlpha = Math.max(0, alpha);
        ctx.fillStyle = popup.color;
        ctx.font = `bold ${9 * popupFontScale}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(popup.text, popup.x, popup.y - yOffset);
        ctx.restore();
      }

      raf = requestAnimationFrame(draw);
    }

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [simRef, metaRef, popupsRef, containerRef]);

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        className="rounded border border-zinc-200 w-full"
        onMouseMove={handleMouseMove}
        onClick={handleClick}
        onMouseLeave={handleMouseLeave}
      />
      {hoveredId != null && (() => {
        const meta = metaRef.current.get(hoveredId);
        if (!meta) return null;
        const games = meta.cc + meta.cd + meta.dc + meta.dd;
        const coops = meta.cc + meta.cd;
        const coopPct = games > 0 ? Math.round((coops / games) * 100) : 0;
        const pos = hoverPosRef.current;
        const cw = canvasRef.current?.clientWidth ?? 300;
        const ch = canvasRef.current?.clientHeight ?? 200;
        return (
          <div
            ref={tooltipRef}
            className="absolute pointer-events-none z-10 px-2.5 py-1.5 bg-white border border-zinc-200 rounded shadow-sm text-[11px] font-mono leading-relaxed whitespace-nowrap"
            style={{
              left: pos.x + 12,
              top: pos.y + 12,
              transform:
                `${pos.x > cw - 180 ? "translateX(calc(-100% - 24px))" : ""}` +
                `${pos.y > ch - 80 ? " translateY(calc(-100% - 24px))" : ""}`,
            }}
          >
            <div className="font-semibold text-zinc-800">
              {meta.strategy === "external" ? "\uD83E\uDD9E" : "\uD83E\uDD16"}{" "}
              {meta.id}{" "}
              <span className="font-normal text-zinc-400">
                {STRATEGY_LABELS[meta.strategy] ?? meta.strategy}
              </span>
            </div>
            <div className="text-zinc-500">
              Avg: {meta.avgScore.toFixed(1)} · Games: {games} · Coop: <span style={{ color: meta.color }}>{coopPct}%</span>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
