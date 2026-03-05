"use client";

import { useRef, useEffect } from "react";
import type { SimState, ClientPopup, ParticleMeta } from "@/hooks/useServerSimulation";
import { bounceOffWallsXY } from "@/simulation/physics";

const TICKS_PER_SEC = 60;
const MS_PER_TICK = 1000 / TICKS_PER_SEC;
const MAX_CATCHUP_TICKS = 12; // cap per frame to prevent death spiral
const POPUP_DURATION_MS = 670;

interface Props {
  simRef: React.RefObject<SimState>;
  metaRef: React.RefObject<Map<number, ParticleMeta>>;
  popupsRef: React.RefObject<ClientPopup[]>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  selectedId?: number | null;
}

/** Advance one tick of client-side physics (movement + wall bounce).
 *  Uses the same bounceOffWallsXY as the server to guarantee parity. */
// Spread correction over ~6s (360 ticks at 60fps). 1 - (1-α)^360 ≈ 0.99
const SYNC_LERP = 0.013;

function stepParticles(sim: SimState): void {
  const { canvasWidth, canvasHeight } = sim.config;
  for (const p of sim.particles) {
    if (p.state !== 0) continue;
    // Apply fraction of correction offset (smooth sync)
    if (p.cx !== 0 || p.cy !== 0) {
      p.x += p.cx * SYNC_LERP;
      p.y += p.cy * SYNC_LERP;
      p.cx *= (1 - SYNC_LERP);
      p.cy *= (1 - SYNC_LERP);
      // Zero out when negligible
      if (p.cx * p.cx + p.cy * p.cy < 0.25) { p.cx = 0; p.cy = 0; }
    }
    p.x += p.vx;
    p.y += p.vy;
    const b = bounceOffWallsXY(p.x, p.y, p.vx, p.vy, p.radius, canvasWidth, canvasHeight);
    p.x = b.x; p.y = b.y; p.vx = b.vx; p.vy = b.vy;
  }
  sim.localTick++;
}

export default function SimulationCanvas({ simRef, metaRef, popupsRef, containerRef, selectedId }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

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
          // Too far behind (e.g. tab was backgrounded) — snap to now
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
          label: m?.label ?? "",
          avgScore: m?.avgScore ?? 0,
          strategy: m?.strategy,
        };
      });

      // Zoom: 2x centered on selected particle
      const sel = selectedIdRef.current;
      let zoom = 1;
      let camX = 0;
      let camY = 0;

      if (sel != null) {
        const sp = displayParticles.find((p) => p.id === sel);
        if (sp) {
          zoom = 2;
          const s = dpr * scale * zoom;
          camX = canvas.width / 2 - sp.x * s;
          camY = canvas.height / 2 - sp.y * s;
        }
      }

      const s = dpr * scale * zoom;
      ctx.setTransform(s, 0, 0, s, camX, camY);

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
        ctx.save();

        if (p.state === 1) {
          ctx.shadowColor = p.color;
          ctx.shadowBlur = 24;
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();

        if (p.state === 1) {
          ctx.shadowBlur = 0;
        }

        ctx.restore();

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
        ctx.fillStyle = p.strategy === "external" ? "#E54D2E" : "#71717a";
        ctx.font = `${labelFontSize}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(p.label, p.x, p.y - p.radius - 4);
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
    <canvas
      ref={canvasRef}
      className="rounded border border-zinc-200 w-full"
    />
  );
}
