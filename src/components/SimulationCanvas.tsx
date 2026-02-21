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

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf: number;

    function draw() {
      if (!ctx || !engineRef.current) return;

      const { canvasWidth, canvasHeight } = config;
      const particles = engineRef.current.particles;

      // Background
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      // Subtle grid
      ctx.strokeStyle = "#1e293b";
      ctx.lineWidth = 0.5;
      for (let x = 0; x < canvasWidth; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvasHeight);
        ctx.stroke();
      }
      for (let y = 0; y < canvasHeight; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvasWidth, y);
        ctx.stroke();
      }

      // Draw particles
      for (const p of particles) {
        const { position, radius, color, state, score, label } = p;

        ctx.save();

        // Glow effect for colliding particles
        if (state === "colliding") {
          ctx.shadowColor = "white";
          ctx.shadowBlur = 20;
        }

        // Circle
        ctx.beginPath();
        ctx.arc(position.x, position.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();

        if (state === "colliding") {
          ctx.strokeStyle = "#facc15";
          ctx.lineWidth = 2.5;
          ctx.stroke();
        }

        ctx.restore();

        // Score inside circle
        ctx.fillStyle = "#fff";
        ctx.font = "bold 10px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(score), position.x, position.y);

        // Name label above
        ctx.fillStyle = "#94a3b8";
        ctx.font = "9px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(label, position.x, position.y - radius - 6);
      }

      raf = requestAnimationFrame(draw);
    }

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [engineRef, config]);

  return (
    <canvas
      ref={canvasRef}
      width={config.canvasWidth}
      height={config.canvasHeight}
      className="rounded-lg border border-slate-700"
    />
  );
}
