"use client";

import { useState } from "react";

type Tab = "avg" | "total" | "log";

const TABS: { id: Tab; label: string }[] = [
  { id: "avg", label: "Avg" },
  { id: "total", label: "Total" },
  { id: "log", label: "Log" },
];

interface Props {
  avgPanel: React.ReactNode;
  totalPanel: React.ReactNode;
  logPanel: React.ReactNode;
}

export default function PanelTabs({ avgPanel, totalPanel, logPanel }: Props) {
  const [active, setActive] = useState<Tab>("avg");

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex border-b border-zinc-200">
        {TABS.map((tab) => (
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
      <div className="flex-1 min-h-0 overflow-auto">
        {active === "avg" && avgPanel}
        {active === "total" && totalPanel}
        {active === "log" && logPanel}
      </div>
    </div>
  );
}
