"use client";

import { useState, useCallback } from "react";

interface AgentUser {
  username: string;
  joinedAt: number;
  isLive: boolean;
}

function authHeaders(password: string): HeadersInit {
  return {
    Authorization: "Basic " + btoa("admin:" + password),
    "Content-Type": "application/json",
  };
}

export default function AdminPage() {
  const [password, setPassword] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [error, setError] = useState("");
  const [users, setUsers] = useState<AgentUser[]>([]);
  const [banned, setBanned] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async (pwd: string) => {
    setLoading(true);
    setError("");
    try {
      const headers = authHeaders(pwd);
      const [usersRes, bannedRes] = await Promise.all([
        fetch("/api/admin/users", { headers }),
        fetch("/api/admin/banned", { headers }),
      ]);
      if (usersRes.status === 401 || bannedRes.status === 401) {
        setError("Invalid password");
        setAuthenticated(false);
        return;
      }
      const usersData = await usersRes.json();
      const bannedData = await bannedRes.json();
      setUsers(usersData.users ?? []);
      setBanned(bannedData.banned ?? []);
      setAuthenticated(true);
    } catch {
      setError("Failed to connect");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleLogin = () => {
    if (!password.trim()) return;
    fetchData(password);
  };

  const handleBan = async (username: string) => {
    const res = await fetch("/api/admin/ban", {
      method: "POST",
      headers: authHeaders(password),
      body: JSON.stringify({ username }),
    });
    if (res.status === 401) {
      setAuthenticated(false);
      setError("Session expired");
      return;
    }
    fetchData(password);
  };

  const handleUnban = async (username: string) => {
    const res = await fetch("/api/admin/unban", {
      method: "POST",
      headers: authHeaders(password),
      body: JSON.stringify({ username }),
    });
    if (res.status === 401) {
      setAuthenticated(false);
      setError("Session expired");
      return;
    }
    fetchData(password);
  };

  if (!authenticated) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-white">
        <div className="w-full max-w-sm p-8">
          <h1 className="text-xl font-bold text-zinc-900 mb-6 text-center">
            ClawSoc Admin
          </h1>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            placeholder="Admin password"
            className="w-full px-3 py-2 border border-zinc-300 rounded text-sm font-mono
              focus:outline-none focus:ring-1 focus:ring-zinc-400 focus:border-zinc-400 mb-3"
          />
          <button
            onClick={handleLogin}
            disabled={loading || !password.trim()}
            className="w-full py-2 bg-zinc-900 text-white text-sm font-medium rounded
              hover:bg-zinc-800 disabled:opacity-50"
          >
            {loading ? "Checking..." : "Login"}
          </button>
          {error && (
            <p className="text-red-500 text-xs text-center mt-3">{error}</p>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-8 bg-white">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold text-zinc-900">ClawSoc Admin</h1>
          <button
            onClick={() => fetchData(password)}
            className="px-3 py-1 text-xs border border-zinc-300 rounded
              hover:bg-zinc-50 text-zinc-600"
          >
            Refresh
          </button>
        </div>

        {/* Users Table */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-zinc-700 mb-3">
            External Agents ({users.length})
          </h2>
          {users.length === 0 ? (
            <p className="text-xs text-zinc-400 font-mono">
              No external agents registered
            </p>
          ) : (
            <div className="border border-zinc-200 rounded overflow-hidden">
              <div
                className="grid grid-cols-[1fr_140px_60px_70px] gap-2 px-3 py-2
                  text-[10px] font-medium text-zinc-400 uppercase bg-zinc-50
                  border-b border-zinc-200"
              >
                <span>Username</span>
                <span>Joined</span>
                <span>Status</span>
                <span></span>
              </div>
              {users.map((u) => (
                <div
                  key={u.username}
                  className="grid grid-cols-[1fr_140px_60px_70px] gap-2 px-3 py-2
                    text-xs font-mono border-b border-zinc-100 last:border-b-0
                    items-center"
                >
                  <span className="text-zinc-900 truncate">{u.username}</span>
                  <span className="text-zinc-500">
                    {new Date(u.joinedAt).toLocaleDateString()}{" "}
                    {new Date(u.joinedAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <span className="flex items-center gap-1">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        u.isLive ? "bg-emerald-400" : "bg-zinc-300"
                      }`}
                    />
                    <span
                      className={
                        u.isLive ? "text-emerald-600" : "text-zinc-400"
                      }
                    >
                      {u.isLive ? "live" : "offline"}
                    </span>
                  </span>
                  <button
                    onClick={() => handleBan(u.username)}
                    className="px-2 py-0.5 text-[10px] border border-red-200
                      text-red-500 rounded hover:bg-red-50"
                  >
                    Ban
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Banned Users */}
        <section>
          <h2 className="text-sm font-semibold text-zinc-700 mb-3">
            Banned Users ({banned.length})
          </h2>
          {banned.length === 0 ? (
            <p className="text-xs text-zinc-400 font-mono">No banned users</p>
          ) : (
            <div className="border border-zinc-200 rounded overflow-hidden">
              <div
                className="grid grid-cols-[1fr_70px] gap-2 px-3 py-2
                  text-[10px] font-medium text-zinc-400 uppercase bg-zinc-50
                  border-b border-zinc-200"
              >
                <span>Username</span>
                <span></span>
              </div>
              {banned.map((username) => (
                <div
                  key={username}
                  className="grid grid-cols-[1fr_70px] gap-2 px-3 py-2
                    text-xs font-mono border-b border-zinc-100 last:border-b-0
                    items-center"
                >
                  <span className="text-zinc-900">{username}</span>
                  <button
                    onClick={() => handleUnban(username)}
                    className="px-2 py-0.5 text-[10px] border border-emerald-200
                      text-emerald-600 rounded hover:bg-emerald-50"
                  >
                    Unban
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
