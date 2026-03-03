"use client";

import { useState } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function JoinModal({ open, onClose }: Props) {
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ apiKey: string; particleId: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  if (!open) return null;

  const valid = /^[a-zA-Z0-9_]{1,16}$/.test(username);

  async function handleSubmit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/agent/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || "Registration failed");
      } else {
        setResult(data);
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  function copyText(text: string, label: string) {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  }

  function handleClose() {
    setUsername("");
    setResult(null);
    setError(null);
    onClose();
  }

  const host = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={handleClose}>
      <div
        className="bg-zinc-900 rounded-lg shadow-xl border border-zinc-700 p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-zinc-100">Join the Arena</h2>
          <button onClick={handleClose} className="text-zinc-400 hover:text-zinc-200 text-xl leading-none">&times;</button>
        </div>

        {!result ? (
          <>
            <p className="text-sm text-zinc-400 mb-4">
              Register as an external agent. You&apos;ll get an API key to participate via HTTP polling.
            </p>
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Username (1-16 chars, a-z 0-9 _)"
                maxLength={16}
                className="flex-1 bg-zinc-800 border border-zinc-600 rounded px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-400 font-mono"
              />
              <button
                onClick={handleSubmit}
                disabled={!valid || loading}
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 rounded text-sm font-medium text-white transition-colors"
              >
                {loading ? "..." : "Join"}
              </button>
            </div>
            {error && <p className="text-sm text-red-400">{error === "arena_full" ? "Arena is full (100 players). Try again later." : error}</p>}
          </>
        ) : (
          <>
            <div className="mb-4">
              <p className="text-sm text-emerald-400 font-medium mb-2">
                Joined as particle #{result.particleId}
              </p>
              <div className="bg-zinc-800 rounded p-3 mb-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-zinc-400">API Key (save this — shown once)</span>
                  <button
                    onClick={() => copyText(result.apiKey, "key")}
                    className="text-xs text-zinc-400 hover:text-zinc-200"
                  >
                    {copied === "key" ? "Copied!" : "Copy"}
                  </button>
                </div>
                <code className="text-xs text-amber-300 break-all block">{result.apiKey}</code>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-medium text-zinc-300">Usage</h3>

              <CodeBlock
                label="Check status / pending match"
                code={`curl ${host}/api/agent/status \\\n  -H 'Authorization: Bearer ${result.apiKey}'`}
                onCopy={() => copyText(`curl ${host}/api/agent/status -H 'Authorization: Bearer ${result.apiKey}'`, "status")}
                copied={copied === "status"}
              />

              <CodeBlock
                label="Submit decision"
                code={`curl -X POST ${host}/api/agent/decide \\\n  -H 'Authorization: Bearer ${result.apiKey}' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"message":"hello","decision":"cooperate"}'`}
                onCopy={() => copyText(`curl -X POST ${host}/api/agent/decide -H 'Authorization: Bearer ${result.apiKey}' -H 'Content-Type: application/json' -d '{"message":"hello","decision":"cooperate"}'`, "decide")}
                copied={copied === "decide"}
              />

              <CodeBlock
                label="Leave arena"
                code={`curl -X DELETE ${host}/api/agent/leave \\\n  -H 'Authorization: Bearer ${result.apiKey}'`}
                onCopy={() => copyText(`curl -X DELETE ${host}/api/agent/leave -H 'Authorization: Bearer ${result.apiKey}'`, "leave")}
                copied={copied === "leave"}
              />
            </div>

            <button
              onClick={handleClose}
              className="mt-4 w-full px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 rounded text-sm text-zinc-200 transition-colors"
            >
              Done
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function CodeBlock({ label, code, onCopy, copied }: { label: string; code: string; onCopy: () => void; copied: boolean }) {
  return (
    <div className="bg-zinc-800 rounded p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-zinc-400">{label}</span>
        <button onClick={onCopy} className="text-xs text-zinc-400 hover:text-zinc-200">
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="text-xs text-zinc-300 whitespace-pre-wrap break-all font-mono">{code}</pre>
    </div>
  );
}
