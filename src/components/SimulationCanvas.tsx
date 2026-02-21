"use client";

import { useRef, useEffect } from "react";
import { SimulationEngine } from "@/simulation/engine";
import { SimulationConfig, SpeechBubble, totalMatches } from "@/simulation/types";

const BUBBLE_MAX_WIDTH = 100;
const BUBBLE_PADDING = 6;
const BUBBLE_FONT = "7px Inter, system-ui, sans-serif";
const TYPING_TICKS = 12;

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const test = current ? current + " " + word : word;
    if (ctx.measureText(test).width > maxWidth) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawSpeechBubble(
  ctx: CanvasRenderingContext2D,
  bubble: SpeechBubble,
  particle: { x: number; y: number; radius: number },
  currentTick: number
) {
  const age = currentTick - bubble.spawnTick;
  if (age < 0) return;

  // Fade in for first 5 ticks, fade out for last 8 ticks
  let alpha = 1;
  if (age < 5) alpha = age / 5;
  else if (age > bubble.durationTicks - 8) alpha = (bubble.durationTicks - age) / 8;
  alpha = Math.max(0, Math.min(1, alpha));

  const isTyping = age < TYPING_TICKS;
  const displayText = isTyping ? "..." : bubble.text;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = BUBBLE_FONT;

  const lines = isTyping ? ["..."] : wrapText(ctx, displayText, BUBBLE_MAX_WIDTH - BUBBLE_PADDING * 2);
  const lineHeight = 9;
  const textWidth = Math.min(
    BUBBLE_MAX_WIDTH,
    Math.max(...lines.map((l) => ctx.measureText(l).width)) + BUBBLE_PADDING * 2
  );
  const textHeight = lines.length * lineHeight + BUBBLE_PADDING * 2;

  const bx = particle.x - textWidth / 2;
  const by = Math.max(2, particle.y - particle.radius - textHeight - 10);
  const pointerSize = 4;

  // Bubble background
  const cornerRadius = 4;
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#d4d4d8";
  ctx.lineWidth = 0.5;

  ctx.beginPath();
  ctx.moveTo(bx + cornerRadius, by);
  ctx.lineTo(bx + textWidth - cornerRadius, by);
  ctx.quadraticCurveTo(bx + textWidth, by, bx + textWidth, by + cornerRadius);
  ctx.lineTo(bx + textWidth, by + textHeight - cornerRadius);
  ctx.quadraticCurveTo(bx + textWidth, by + textHeight, bx + textWidth - cornerRadius, by + textHeight);
  // Pointer triangle
  ctx.lineTo(bx + textWidth / 2 + pointerSize, by + textHeight);
  ctx.lineTo(bx + textWidth / 2, by + textHeight + pointerSize);
  ctx.lineTo(bx + textWidth / 2 - pointerSize, by + textHeight);
  ctx.lineTo(bx + cornerRadius, by + textHeight);
  ctx.quadraticCurveTo(bx, by + textHeight, bx, by + textHeight - cornerRadius);
  ctx.lineTo(bx, by + cornerRadius);
  ctx.quadraticCurveTo(bx, by, bx + cornerRadius, by);
  ctx.closePath();

  ctx.fill();
  ctx.stroke();

  // Text
  ctx.fillStyle = isTyping ? "#a1a1aa" : "#27272a";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], bx + BUBBLE_PADDING, by + BUBBLE_PADDING + i * lineHeight);
  }

  ctx.restore();
}

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
        }

        ctx.restore();

        // Average score inside circle
        const matches = totalMatches(p.matchHistory);
        const avg = matches > 0 ? score / matches : 0;
        ctx.fillStyle = "#fff";
        ctx.font = `bold ${radius > 12 ? 10 : 8}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(avg.toFixed(1), position.x, position.y + 0.5);

        // Name label above
        ctx.fillStyle = "#71717a";
        ctx.font = "8px Inter, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(label, position.x, position.y - radius - 4);
      }

      // Draw speech bubbles
      for (const bubble of engine.speechBubbles) {
        const p = particles.find((pt) => pt.id === bubble.particleId);
        if (!p) continue;
        drawSpeechBubble(ctx, bubble, { x: p.position.x, y: p.position.y, radius: p.radius }, engine.tick);
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
