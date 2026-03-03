"use client";

import { useState, useRef, useEffect } from "react";

interface ParticleInfo {
  id: number;
  label: string;
  color: string;
}

interface Props {
  particles: ParticleInfo[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  onSearchDatabase: (query: string) => void;
  isSearching?: boolean;
  offlinePlayerLabel?: string | null;
}

export default function PlayerSearch({
  particles,
  selectedId,
  onSelect,
  onSearchDatabase,
  isSearching,
  offlinePlayerLabel,
}: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const matches =
    query.length > 0
      ? particles.filter((p) =>
          p.label.toLowerCase().includes(query.toLowerCase()),
        )
      : [];

  // Sync input when offline player is loaded externally
  useEffect(() => {
    if (offlinePlayerLabel && selectedId == null) {
      setQuery(offlinePlayerLabel);
    }
  }, [offlinePlayerLabel, selectedId]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleSelect(id: number) {
    // Toggle off if clicking same player
    if (selectedId === id) {
      onSelect(null);
      setQuery("");
    } else {
      const p = particles.find((p) => p.id === id);
      onSelect(id);
      if (p) setQuery(p.label);
    }
    setOpen(false);
  }

  function handleChange(value: string) {
    setQuery(value);
    setOpen(value.length > 0);
    if (value.length === 0) onSelect(null);
  }

  return (
    <div ref={wrapperRef} className="relative">
      <svg
        className="absolute left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-300 pointer-events-none"
        viewBox="0 0 20 20"
        fill="currentColor"
      >
        <path
          fillRule="evenodd"
          d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z"
          clipRule="evenodd"
        />
      </svg>
      <input
        type="text"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && matches.length > 0) {
            handleSelect(matches[0].id);
          }
        }}
        onFocus={() => query.length > 0 && setOpen(true)}
        placeholder="Find player…"
        className="w-28 pl-5 pr-2 py-1 border border-zinc-200 rounded text-xs font-mono text-zinc-700 placeholder:text-zinc-300 focus:outline-none focus:ring-1 focus:ring-amber-300 focus:border-amber-300"
      />
      {open && query.length > 0 && (
        <div className="absolute top-full left-0 mt-1 w-48 max-h-48 overflow-y-auto bg-white border border-zinc-200 rounded shadow-lg z-50">
          {matches.map((p) => (
            <button
              key={p.id}
              onClick={() => handleSelect(p.id)}
              className={`w-full flex items-center gap-1.5 px-2 py-1 text-[11px] font-mono text-left hover:bg-amber-50 transition-colors ${
                selectedId === p.id ? "bg-amber-50 font-semibold" : "text-zinc-600"
              }`}
            >
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: p.color }}
              />
              <span className="truncate">{p.label}</span>
            </button>
          ))}
          <button
            onClick={() => {
              onSearchDatabase(query);
              setOpen(false);
            }}
            disabled={isSearching}
            className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-mono text-left text-zinc-400 hover:bg-zinc-50 transition-colors border-t border-zinc-100"
          >
            <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path d="M2 4.5A2.5 2.5 0 014.5 2h11A2.5 2.5 0 0118 4.5v2a.5.5 0 01-.5.5h-15a.5.5 0 01-.5-.5v-2zM2 9a1 1 0 011-1h14a1 1 0 011 1v1.5a.5.5 0 01-.5.5h-15a.5.5 0 01-.5-.5V9zM3 13a1 1 0 00-1 1v2.5A2.5 2.5 0 004.5 19h11a2.5 2.5 0 002.5-2.5V14a1 1 0 00-1-1H3z" />
            </svg>
            <span className="truncate">
              {isSearching ? "Searching..." : `Search database`}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
