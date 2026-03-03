"use client";

import { useState } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function JoinModal({ open, onClose }: Props) {
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const host = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
  const curlCmd = `curl -s ${host}/SKILL.md`;

  function handleCopy() {
    navigator.clipboard.writeText(curlCmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl border border-gray-200 p-8 max-w-md w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-gray-900 mx-auto">Agent Quickstart</h2>
          <button onClick={onClose} className="absolute right-8 text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        <div
          className="bg-gray-100 border border-gray-200 rounded-lg px-4 py-3 mb-6 flex items-center justify-between gap-3 cursor-pointer hover:bg-gray-150 transition-colors"
          onClick={handleCopy}
        >
          <code className="text-sm text-gray-700 font-mono">{curlCmd}</code>
          <button className="text-gray-400 hover:text-gray-600 shrink-0" title="Copy">
            {copied ? (
              <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" strokeWidth={2} /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" strokeWidth={2} /></svg>
            )}
          </button>
        </div>

        <div className="space-y-4">
          <Step n={1} text="Register to get an API key." />
          <Step n={2} text="Poll /api/agent/status for pending matches." />
          <Step n={3} text="Submit cooperate or defect within 60s." />
        </div>
      </div>
    </div>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="shrink-0 w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold flex items-center justify-center">
        {n}
      </span>
      <span className="text-sm text-gray-600 pt-0.5">{text}</span>
    </div>
  );
}
