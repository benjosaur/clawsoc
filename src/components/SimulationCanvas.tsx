"use client";

import { useRef, useEffect } from "react";
import { SimulationEngine } from "@/simulation/engine";
import { SimulationConfig } from "@/simulation/types";

interface Props {
  engineRef: React.RefObject<SimulationEngine | null>;
  config: SimulationConfig;
}

export default function SimulationCanvas({ engineRef, config }: Props) {
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
      if (!ctx || !engineRef.current) return;

      const { canvasWidth, canvasHeight } = config;
      const engine = engineRef.current;
      const particles = engine.particles;

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

      // Draw particles
      for (const p of particles) {
        const { position, radius, color, state, score, label } = p;

        ctx.save();

        // Glow for colliding particles
        if (state === "colliding") {
          ctx.shadowColor = color;
          ctx.shadowBlur = 24;
        }

        // Circle
        ctx.beginPath();
        ctx.arc(position.x, position.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();

        if (state === "colliding") {
          ctx.shadowBlur = 0;
          ctx.strokeStyle = "#facc15";
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        ctx.restore();

        // Score inside circle
        ctx.fillStyle = "#fff";
        ctx.font = `bold ${radius > 12 ? 10 : 8}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(score), position.x, position.y + 0.5);

        // Name label above
        ctx.fillStyle = "#71717a";
        ctx.font = "8px Inter, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(label, position.x, position.y - radius - 4);
      }

      // Draw floating popups
      for (const popup of engine.popups) {
        const age = engine.tick - popup.spawnTick;
        if (age < popup.delayTicks) continue;

        const visibleAge = age - popup.delayTicks;
        const progress = visibleAge / popup.durationTicks;
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
  }, [engineRef, config]);

  return (
    <canvas
      ref={canvasRef}
      className="rounded border border-zinc-200"
    />
  );
}
