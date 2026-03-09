"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import type { SimState, ClientPopup, ParticleMeta } from "@/hooks/useServerSimulation";
import { bounceOffWallsXY } from "@/simulation/physics";

const TICKS_PER_SEC = 60;
const MS_PER_TICK = 1000 / TICKS_PER_SEC;
const MAX_CATCHUP_TICKS = 12; // cap per frame to prevent death spiral
const POPUP_DURATION_MS = 670;

// Grid deformation constants
const GRID_SPACING = 16;
const DEFORM_RADIUS = 120;
const DEFORM_AMOUNT = 3;
// Particle gravity on grid
const GRAVITY_RADIUS = 200;
const GRAVITY_STRENGTH = 1.5;

/** Convert any CSS color to an rgba string with the given alpha */
function colorWithAlpha(color: string, alpha: number): string {
  // HSL: inject alpha directly
  if (color.startsWith("hsl(")) {
    return color.replace("hsl(", "hsla(").replace(")", `,${alpha})`);
  }
  // Hex
  if (color.startsWith("#") && color.length >= 7) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  // Fallback
  return `rgba(128,128,128,${alpha})`;
}

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

// Tooltip edge-flip thresholds (estimated tooltip dimensions)
const TOOLTIP_FLIP_W = 180;
const TOOLTIP_FLIP_H = 80;

function tooltipTransform(sx: number, sy: number, cw: number, ch: number): string {
  const flipX = sx > cw - TOOLTIP_FLIP_W ? "translateX(calc(-100% - 24px))" : "";
  const flipY = sy > ch - TOOLTIP_FLIP_H ? " translateY(calc(-100% - 24px))" : "";
  return flipX + flipY;
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
  const hoveredIdRef = useRef<string | null>(null);
  const hoverAnimRef = useRef<Map<string, number>>(new Map());
  const hoverPosRef = useRef({ x: 0, y: 0 });
  const mousePosRef = useRef<{ x: number; y: number } | null>(null);
  const lastMousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 }); // persists after leave
  const mouseInCanvasRef = useRef(false);
  const cursorStrengthRef = useRef(0); // animated 0→1 when cursor enters
  const tooltipRef = useRef<HTMLDivElement>(null);
  const scaleRef = useRef(1);

  const updateHoveredId = useCallback((id: string | null) => {
    hoveredIdRef.current = id;
    setHoveredId((prev) => prev === id ? prev : id);
  }, []);

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

    // Track mouse in world coordinates for grid deformation
    const rect = canvas.getBoundingClientRect();
    const dpr = dprRef.current;
    const cx = (e.clientX - rect.left) * dpr;
    const cy = (e.clientY - rect.top) * dpr;
    const { camX, camY, s } = transformRef.current;
    const wp = { x: (cx - camX) / s, y: (cy - camY) / s };
    mousePosRef.current = wp;
    lastMousePosRef.current = wp;
    mouseInCanvasRef.current = true;

    const id = hitTest(e.clientX, e.clientY);
    canvas.style.cursor = id != null ? "pointer" : "default";

    if (id == null) {
      updateHoveredId(null);
      return;
    }

    // Seed tooltip position from particle's screen coords for initial render frame
    const p = displayRef.current.find(dp => dp.id === id);
    if (p) {
      const sc = scaleRef.current;
      const offset = p.radius * sc + 2;
      hoverPosRef.current = { x: p.x * sc + offset, y: p.y * sc + offset };
    }
    updateHoveredId(id);
  }, [hitTest, updateHoveredId]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const id = hitTest(e.clientX, e.clientY);
    if (!onSelectRef.current) return;
    if (id != null && id === selectedIdRef.current) {
      onSelectRef.current(null);
    } else {
      onSelectRef.current(id);
    }
    updateHoveredId(null);
  }, [hitTest, updateHoveredId]);

  const handleMouseLeave = useCallback(() => {
    mouseInCanvasRef.current = false;
    updateHoveredId(null);
  }, [updateHoveredId]);

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
      scaleRef.current = scale;
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

      const fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
      const sim = simRef.current;
      const worldW = sim.config.canvasWidth;
      const worldH = sim.config.canvasHeight;
      const now = performance.now();

      // Advance physics ticks
      if (sim.particles.length > 0) {
        const elapsed = now - sim.lastAdvanceTime;
        // Epsilon avoids floor() rounding down at tick boundaries due to FP error
        // (e.g. 33.333*60/1000 = 1.9999… should be 2, not 1).
        const rawTicks = Math.floor(elapsed * TICKS_PER_SEC / 1000 + 1e-9);
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

      // Update tooltip position to track particle each frame
      const hId = hoveredIdRef.current;
      if (hId != null && tooltipRef.current && canvas) {
        const hp = displayParticles.find(p => p.id === hId);
        if (hp) {
          const sx = hp.x * scale;
          const sy = hp.y * scale;
          const offset = hp.radius * scale + 2;
          const tx = sx + offset;
          const ty = sy + offset;
          tooltipRef.current.style.left = `${tx}px`;
          tooltipRef.current.style.top = `${ty}px`;
          tooltipRef.current.style.transform = tooltipTransform(tx, ty, canvas.clientWidth, canvas.clientHeight);
        } else {
          hoveredIdRef.current = null;
          setHoveredId(null);
        }
      }

      const sel = selectedIdRef.current;
      const s = dpr * scale;
      // Store transform for mouse event coordinate conversion
      transformRef.current = { camX: 0, camY: 0, s };
      ctx.setTransform(s, 0, 0, s, 0, 0);

      // Background
      ctx.fillStyle = "#fafafa";
      ctx.fillRect(-worldW, -worldH, worldW * 3, worldH * 3);

      // Animate cursor deformation strength (ease in/out)
      const CURSOR_LERP_IN = 0.08;
      const CURSOR_LERP_OUT = 0.04;
      const targetStrength = mouseInCanvasRef.current ? 1 : 0;
      const lerpRate = targetStrength > cursorStrengthRef.current ? CURSOR_LERP_IN : CURSOR_LERP_OUT;
      cursorStrengthRef.current += (targetStrength - cursorStrengthRef.current) * lerpRate;
      const cursorStrength = cursorStrengthRef.current;

      // Deformable line grid — use last known position for fade-out
      const mouse = lastMousePosRef.current;
      const cols = Math.floor(worldW / GRID_SPACING) + 1;
      const rows = Math.floor(worldH / GRID_SPACING) + 1;

      // Spatial hash for particle gravity (avoids O(particles × gridPoints))
      const cellSize = GRAVITY_RADIUS;
      const hashCols = Math.ceil(worldW / cellSize) + 2;
      const hashRows = Math.ceil(worldH / cellSize) + 2;
      const spatialHash: number[][] = new Array(hashCols * hashRows);
      for (let i = 0; i < spatialHash.length; i++) spatialHash[i] = [];
      for (let i = 0; i < displayParticles.length; i++) {
        const p = displayParticles[i];
        if (p.state === 3) continue;
        const hc = Math.floor(p.x / cellSize);
        const hr = Math.floor(p.y / cellSize);
        if (hc >= 0 && hc < hashCols && hr >= 0 && hr < hashRows) {
          spatialHash[hr * hashCols + hc].push(i);
        }
      }

      // Compute displaced grid points
      const gridPts: { x: number; y: number }[][] = [];
      for (let r = 0; r < rows; r++) {
        const row: { x: number; y: number }[] = [];
        for (let c = 0; c < cols; c++) {
          let gx = c * GRID_SPACING;
          let gy = r * GRID_SPACING;
          // Cursor repulsion (animated strength)
          if (cursorStrength > 0.001) {
            const dx = gx - mouse.x;
            const dy = gy - mouse.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 0 && dist < DEFORM_RADIUS) {
              const t = 1 - dist / DEFORM_RADIUS;
              const strength = t * t * DEFORM_AMOUNT * cursorStrength;
              gx += (dx / dist) * strength;
              gy += (dy / dist) * strength;
            }
          }
          // Particle gravity — only check nearby cells
          const hc = Math.floor(gx / cellSize);
          const hr = Math.floor(gy / cellSize);
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              const nc = hc + dc;
              const nr = hr + dr;
              if (nc < 0 || nc >= hashCols || nr < 0 || nr >= hashRows) continue;
              const bucket = spatialHash[nr * hashCols + nc];
              for (let bi = 0; bi < bucket.length; bi++) {
                const p = displayParticles[bucket[bi]];
                const dx = p.x - gx;
                const dy = p.y - gy;
                const distSq = dx * dx + dy * dy;
                if (distSq > GRAVITY_RADIUS * GRAVITY_RADIUS || distSq < 1) continue;
                const dist = Math.sqrt(distSq);
                const t = 1 - dist / GRAVITY_RADIUS;
                const pull = t * t * GRAVITY_STRENGTH;
                gx += (dx / dist) * pull;
                gy += (dy / dist) * pull;
              }
            }
          }
          row.push({ x: gx, y: gy });
        }
        gridPts.push(row);
      }

      ctx.strokeStyle = "#e2e2e2";
      ctx.lineWidth = 0.5;

      // Horizontal lines
      for (let r = 0; r < rows; r++) {
        ctx.beginPath();
        ctx.moveTo(gridPts[r][0].x, gridPts[r][0].y);
        for (let c = 1; c < cols; c++) {
          ctx.lineTo(gridPts[r][c].x, gridPts[r][c].y);
        }
        ctx.stroke();
      }

      // Vertical lines
      for (let c = 0; c < cols; c++) {
        ctx.beginPath();
        ctx.moveTo(gridPts[0][c].x, gridPts[0][c].y);
        for (let r = 1; r < rows; r++) {
          ctx.lineTo(gridPts[r][c].x, gridPts[r][c].y);
        }
        ctx.stroke();
      }

      // Selected particle background aura
      if (sel) {
        const sp = displayParticles.find(p => p.id === sel);
        if (sp) {
          const auraRadius = sp.radius * 8;
          const grad = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, auraRadius);
          grad.addColorStop(0, colorWithAlpha(sp.color, 0.15));
          grad.addColorStop(0.5, colorWithAlpha(sp.color, 0.06));
          grad.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, auraRadius, 0, Math.PI * 2);
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
        const isHovered = p.id === hoveredIdRef.current;
        // Animate hover progress (0→1) per particle
        const hoverAnim = hoverAnimRef.current;
        const prevT = hoverAnim.get(p.id) ?? 0;
        const HOVER_SPEED = 0.35;
        const t = isHovered ? prevT + (1 - prevT) * HOVER_SPEED : prevT * (1 - HOVER_SPEED);
        if (t < 0.001) { hoverAnim.delete(p.id); } else { hoverAnim.set(p.id, t); }

        const scoreFontSize = (9 + t) * fontScale * (isSmall ? 0.7 : 1);
        ctx.fillStyle = "#fff";
        ctx.font = `bold ${scoreFontSize}px ${fontFamily}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        const metrics = ctx.measureText(Math.round(p.avgScore).toString());
        const textHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
        ctx.fillText(Math.round(p.avgScore).toString(), p.x, p.y + textHeight / 2 - 0.5);

        // Name label above
        const labelFontSize = (7 + t * 2) * fontScale * (isSmall ? 0.7 : 1);
        ctx.fillStyle = p.strategy === "external" ? "#E54D2E" : (isSelected ? "#18181b" : "#71717a");
        ctx.font = `${isSelected || t > 0.5 ? "bold " : ""}${labelFontSize}px ${fontFamily}`;
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
        ctx.font = `bold ${7.5 * popupFontScale}px ${fontFamily}`;
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
        return (
          <div
            ref={tooltipRef}
            className="absolute pointer-events-none z-10 px-2.5 py-1.5 bg-white border border-zinc-200 rounded shadow-sm text-[11px] font-mono leading-relaxed whitespace-nowrap"
            style={{ left: pos.x, top: pos.y }}
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
