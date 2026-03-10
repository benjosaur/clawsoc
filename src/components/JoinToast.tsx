"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import type { JoinEvent } from "@/hooks/useServerSimulation";

interface Toast extends JoinEvent {
  exiting: boolean;
}

const TOAST_DURATION = 8000;
const EXIT_DURATION = 300;
const MAX_VISIBLE = 3;

export default function JoinToast({
  joinEventsRef,
  onSelect,
}: {
  joinEventsRef: React.RefObject<JoinEvent[]>;
  onSelect: (id: string) => void;
}) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const exitTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Cleanup all timers on unmount
  useEffect(() => {
    return () => {
      for (const t of exitTimers.current.values()) clearTimeout(t);
    };
  }, []);

  // Poll the ref for new join events (drain to prevent unbounded growth)
  useEffect(() => {
    const interval = setInterval(() => {
      const events = joinEventsRef.current.splice(0);
      if (events.length === 0) return;
      setToasts((prev) => {
        const next = [...prev, ...events.map((e) => ({ ...e, exiting: false }))];
        if (next.length > MAX_VISIBLE) return next.slice(-MAX_VISIBLE);
        return next;
      });
    }, 200);
    return () => clearInterval(interval);
  }, [joinEventsRef]);

  const startExit = useCallback((id: string) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)));
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      exitTimers.current.delete(id);
    }, EXIT_DURATION);
    exitTimers.current.set(id, timer);
  }, []);

  // Auto-dismiss oldest non-exiting toast
  useEffect(() => {
    if (toasts.length === 0) return;
    const oldest = toasts.find((t) => !t.exiting);
    if (!oldest) return;
    const remaining = TOAST_DURATION - (performance.now() - oldest.time);
    if (remaining <= 0) {
      startExit(oldest.id);
      return;
    }
    const timer = setTimeout(() => startExit(oldest.id), remaining);
    return () => clearTimeout(timer);
  }, [toasts, startExit]);

  const handleClick = useCallback(
    (id: string) => {
      onSelect(id);
      setToasts((prev) => prev.filter((t) => t.id !== id));
      const existing = exitTimers.current.get(id);
      if (existing) { clearTimeout(existing); exitTimers.current.delete(id); }
    },
    [onSelect],
  );

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 pointer-events-none">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => handleClick(t.id)}
          className={`pointer-events-auto text-left px-3 py-2 bg-white border border-zinc-200 rounded-lg shadow-lg cursor-pointer hover:bg-zinc-50 transition-[opacity,transform] duration-300 ${t.exiting ? "" : "animate-toast-in"}`}
          style={{
            opacity: t.exiting ? 0 : 1,
            transform: t.exiting ? "translateY(-100%)" : "translateY(0)",
            maxWidth: 280,
          }}
        >
          <div className="flex items-center gap-2">
            <span className="text-xs">🦞</span>
            <span className="text-sm font-medium text-zinc-800 truncate">{t.id}</span>
            <span className="text-[10px] text-emerald-600 font-medium whitespace-nowrap">joined!</span>
          </div>
          <p className="text-xs text-zinc-500 mt-0.5 font-medium">Click me to find them!</p>
        </button>
      ))}
    </div>
  );
}
