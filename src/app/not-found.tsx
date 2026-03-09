"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

const STRATEGIES = [
  "always_cooperate",
  "always_defect",
  "tit_for_tat",
  "random",
  "grudger",
] as const;

const EXCUSES = [
  "This particle defected from the simulation.",
  "Looks like this page chose 'always_defect' against existing.",
  "A grudger particle deleted this page after you betrayed it once.",
  "This page played tit-for-tat and you blinked first.",
  "The Nash equilibrium of this URL is: nothing.",
  "This page cooperated with the void.",
  "We ran 500 simulations. None of them found this page.",
  "This page was frozen mid-collision and never came back.",
  "A random-strategy particle ate this route.",
  "This page exists in a society. Just not this one.",
];

function BouncingParticle({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const state = useRef({
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    trail: [] as { x: number; y: number; age: number }[],
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const s = state.current;
    s.x = width / 2;
    s.y = height / 2;
    const speed = 2.5;
    const angle = Math.random() * Math.PI * 2;
    s.vx = Math.cos(angle) * speed;
    s.vy = Math.sin(angle) * speed;

    let raf: number;
    const radius = 6;

    function draw() {
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);

      // draw trail
      for (let i = s.trail.length - 1; i >= 0; i--) {
        const t = s.trail[i];
        t.age++;
        if (t.age > 40) {
          s.trail.splice(i, 1);
          continue;
        }
        const alpha = 1 - t.age / 40;
        ctx.beginPath();
        ctx.arc(t.x, t.y, radius * alpha * 0.6, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(239, 68, 68, ${alpha * 0.3})`;
        ctx.fill();
      }

      // move
      s.x += s.vx;
      s.y += s.vy;

      // bounce off walls
      if (s.x - radius < 0) {
        s.x = radius;
        s.vx = Math.abs(s.vx);
      } else if (s.x + radius > width) {
        s.x = width - radius;
        s.vx = -Math.abs(s.vx);
      }
      if (s.y - radius < 0) {
        s.y = radius;
        s.vy = Math.abs(s.vy);
      } else if (s.y + radius > height) {
        s.y = height - radius;
        s.vy = -Math.abs(s.vy);
      }

      // leave trail
      if (Math.random() < 0.5) {
        s.trail.push({ x: s.x, y: s.y, age: 0 });
      }

      // draw particle (defector red)
      ctx.beginPath();
      ctx.arc(s.x, s.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = "#ef4444";
      ctx.fill();

      // glow
      ctx.beginPath();
      ctx.arc(s.x, s.y, radius + 4, 0, Math.PI * 2);
      const glow = ctx.createRadialGradient(
        s.x, s.y, radius,
        s.x, s.y, radius + 4
      );
      glow.addColorStop(0, "rgba(239, 68, 68, 0.4)");
      glow.addColorStop(1, "rgba(239, 68, 68, 0)");
      ctx.fillStyle = glow;
      ctx.fill();

      raf = requestAnimationFrame(draw);
    }

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="absolute inset-0 pointer-events-none"
    />
  );
}

export default function NotFound() {
  const [excuse] = useState(
    () => EXCUSES[Math.floor(Math.random() * EXCUSES.length)]
  );
  const [strategy] = useState(
    () => STRATEGIES[Math.floor(Math.random() * STRATEGIES.length)]
  );
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function measure() {
      if (containerRef.current) {
        setContainerSize({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight,
        });
      }
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative min-h-dvh flex flex-col items-center justify-center overflow-hidden"
    >
      {containerSize.width > 0 && (
        <BouncingParticle
          width={containerSize.width}
          height={containerSize.height}
        />
      )}

      <div className="relative z-10 flex flex-col items-center gap-6 px-6 text-center max-w-lg">
        <div className="text-8xl font-bold tracking-tighter text-zinc-200 select-none">
          404
        </div>

        <div className="text-lg font-medium text-zinc-800">
          {excuse}
        </div>

        <div className="flex items-center gap-2 rounded-full bg-zinc-100 px-4 py-1.5 text-xs font-mono text-zinc-500">
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{
              backgroundColor:
                strategy === "always_cooperate"
                  ? "#4ade80"
                  : strategy === "always_defect"
                  ? "#ef4444"
                  : strategy === "tit_for_tat"
                  ? "#60a5fa"
                  : strategy === "grudger"
                  ? "#f59e0b"
                  : "#a1a1aa",
            }}
          />
          strategy: {strategy}
        </div>

        <div className="mt-2 text-xs text-zinc-400 font-mono leading-relaxed max-w-md whitespace-nowrap">
          payoff_matrix[you][this_page] = {"{"} CC: 0, CD: 0, DC: 0, DD: 0 {"}"}
        </div>

        <Link
          href="/"
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 transition-colors"
        >
          Return to the simulation
        </Link>

        <p className="text-[11px] text-zinc-300 mt-2">
          We live in a society. This page does not.
        </p>
      </div>
    </div>
  );
}
