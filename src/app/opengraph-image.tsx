import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "ClawSoc — Prisoner's Dilemma particle simulation";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Deterministic "random" dots to suggest the particle simulation
const dots = [
  { x: 120, y: 180, r: 18, color: "#22c55e" },
  { x: 280, y: 420, r: 14, color: "#ef4444" },
  { x: 900, y: 150, r: 20, color: "#22c55e" },
  { x: 1050, y: 380, r: 16, color: "#eab308" },
  { x: 180, y: 480, r: 12, color: "#eab308" },
  { x: 750, y: 100, r: 10, color: "#ef4444" },
  { x: 1080, y: 520, r: 14, color: "#22c55e" },
  { x: 350, y: 130, r: 11, color: "#22c55e" },
  { x: 600, y: 520, r: 13, color: "#ef4444" },
  { x: 980, y: 240, r: 15, color: "#22c55e" },
  { x: 450, y: 480, r: 10, color: "#eab308" },
  { x: 80, y: 320, r: 9, color: "#22c55e" },
  { x: 1100, y: 130, r: 12, color: "#eab308" },
  { x: 700, y: 80, r: 8, color: "#22c55e" },
  { x: 500, y: 560, r: 11, color: "#ef4444" },
];

export default function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#fafafa",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Particle dots */}
        {dots.map((dot, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: dot.x - dot.r,
              top: dot.y - dot.r,
              width: dot.r * 2,
              height: dot.r * 2,
              borderRadius: "50%",
              backgroundColor: dot.color,
              opacity: 0.35,
            }}
          />
        ))}

        {/* Content */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 16,
            zIndex: 1,
          }}
        >
          <div
            style={{
              fontSize: 96,
              fontWeight: 700,
              color: "#18181b",
              letterSpacing: "-0.03em",
              lineHeight: 1,
            }}
          >
            ClawSoc
          </div>
          <div
            style={{
              fontSize: 32,
              color: "#a1a1aa",
              letterSpacing: "0.02em",
            }}
          >
            We live in a society
          </div>
          <div
            style={{
              marginTop: 16,
              fontSize: 22,
              color: "#71717a",
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <span style={{ color: "#22c55e" }}>Cooperate</span>
            <span style={{ color: "#d4d4d8" }}>vs</span>
            <span style={{ color: "#ef4444" }}>Defect</span>
            <span style={{ color: "#d4d4d8" }}>—</span>
            <span>Prisoner&apos;s Dilemma Simulation</span>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
