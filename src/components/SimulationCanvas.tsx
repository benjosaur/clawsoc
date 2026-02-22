"use client";

import { useRef, useEffect } from "react";
import { SimulationConfig } from "@/simulation/types";
import { CanvasView } from "@/simulation/protocol";
import type { InterpState } from "@/hooks/useServerSimulation";

const FRAME_INTERVAL = 100;   // ms between server fast frames
const POPUP_DURATION_MS = 670; // must match hook constant

interface Props {
  viewRef: React.RefObject<CanvasView | null>;
  interpRef: React.RefObject<InterpState>;
  config: SimulationConfig;
}

export default function SimulationCanvas({ viewRef, interpRef, config }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = config.canvasWidth * dpr;
    canvas.height = config.canvasHeight * dpr;
    canvas.style.width = `${config.canvasWidth}px`;
    canvas.style.height = `${config.canvasHeight}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.scale(dpr, dpr);

    let raf: number;

    function draw() {
      if (!ctx) return;

      const { canvasWidth, canvasHeight } = config;
      const { prev, curr, frameTime } = interpRef.current;

      if (!curr) {
        raf = requestAnimationFrame(draw);
        return;
      }

      // Interpolation factor: 0 at frame arrival → 1 at next expected frame
      const t = prev
        ? Math.min(1, (performance.now() - frameTime) / FRAME_INTERVAL)
        : 1;

      // Background
      ctx.fillStyle = "#fafafa";
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      // Subtle dot grid
      ctx.fillStyle = "#e2e2e2";
      for (let x = 20; x < canvasWidth; x += 20) {
        for (let y = 20; y < canvasHeight; y += 20) {
          ctx.beginPath();
          ctx.arc(x, y, 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Build prev position lookup for lerp
      const prevMap = new Map<number, { x: number; y: number }>();
      if (prev) {
        for (const p of prev.particles) {
          prevMap.set(p.id, { x: p.x, y: p.y });
        }
      }

      // Draw particles with interpolated positions
      for (const p of curr.particles) {
        const pp = prevMap.get(p.id);
        const x = pp ? pp.x + (p.x - pp.x) * t : p.x;
        const y = pp ? pp.y + (p.y - pp.y) * t : p.y;

        ctx.save();

        // Glow for colliding particles
        if (p.state === 1) {
          ctx.shadowColor = p.color;
          ctx.shadowBlur = 24;
        }

        // Circle
        ctx.beginPath();
        ctx.arc(x, y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();

        if (p.state === 1) {
          ctx.shadowBlur = 0;
        }

        ctx.restore();

        // Average score inside circle
        ctx.fillStyle = "#fff";
        ctx.font = `bold ${p.radius > 12 ? 10 : 8}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(p.avgScore.toFixed(1), x, y + 0.5);

        // Name label above
        ctx.fillStyle = "#71717a";
        ctx.font = "8px Inter, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(p.label, x, y - p.radius - 4);
      }

      // Draw floating popups (fully client-side animation from spawnTime)
      const now = performance.now();
      for (const popup of curr.popups) {
        const progress = Math.min(1, (now - popup.spawnTime) / POPUP_DURATION_MS);
        if (progress >= 1) continue;
        const alpha = 1 - progress;
        const yOffset = progress * 18;

        ctx.save();
        ctx.globalAlpha = Math.max(0, alpha);
        ctx.fillStyle = popup.color;
        ctx.font = "bold 9px Inter, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(popup.text, popup.x, popup.y - yOffset);
        ctx.restore();
      }

      raf = requestAnimationFrame(draw);
    }

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [viewRef, interpRef, config]);

  return (
    <canvas
      ref={canvasRef}
      className="rounded border border-zinc-200"
    />
  );
}
