"use client";

import { useState, useEffect } from "react";

type Tab = "scores" | "log" | "player";

interface TabDef { id: Tab; label: string }

interface Props {
  scorePanel: React.ReactNode;
  logPanel: React.ReactNode;
  playerPanel?: React.ReactNode;
}

export default function PanelTabs({ scorePanel, logPanel, playerPanel }: Props) {
  const tabs: TabDef[] = [
    { id: "scores", label: "Scoreboard" },
    { id: "log", label: "Game Log" },
  ];
  if (playerPanel) tabs.push({ id: "player", label: "Player" });

  const [active, setActive] = useState<Tab>("scores");

  // Auto-switch to player tab when a player is selected
  useEffect(() => {
    if (playerPanel) {
      setActive("player");
    } else {
      setActive((prev) => (prev === "player" ? "scores" : prev));
    }
  }, [playerPanel != null]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex border-b border-zinc-200">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActive(tab.id)}
            className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
              active === tab.id
                ? "text-zinc-900 border-b-2 border-zinc-900"
                : "text-zinc-400 hover:text-zinc-600"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-auto pt-2">
        {active === "scores" && scorePanel}
        {active === "log" && logPanel}
        {active === "player" && playerPanel}
      </div>
    </div>
  );
}
