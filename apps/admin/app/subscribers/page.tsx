"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

interface Subscriber {
  id: string;
  email: string;
  status: "ACTIVE" | "UNSUBSCRIBED";
  source: string | null;
  subscribedAt: string;
  unsubscribedAt: string | null;
}

interface SubscriberStats {
  totalAll: number;
  totalActive: number;
  newThisWeek: number;
}

interface SubscriberResponse {
  subscribers: Subscriber[];
  page: number;
  pageSize: number;
  total: number;
  stats: SubscriberStats;
}

const PAGE_SIZE = 20;

async function api(path: string, method = "GET", body?: unknown) {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) throw new Error("NO_SESSION");
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function SubscribersPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<SubscriberResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [status, setStatus] = useState<"ACTIVE" | "UNSUBSCRIBED" | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (search) params.set("search", search);
      if (status) params.set("status", status);
      const res = await api(`/api/subscribers?${params}`);
      setData(res);
    } catch (err: any) {
      if (err.message === "NO_SESSION") {
        router.replace("/login");
        return;
      }
      setError(err.message || "Failed to load subscribers");
    } finally {
      setLoading(false);
    }
  }, [page, search, status, router]);

  useEffect(() => {
    (async () => {
      const { data: sessionData } = await supabaseBrowser().auth.getSession();
      if (!sessionData.session) {
        router.replace("/login");
        return;
      }
      setReady(true);
    })();
  }, [router]);

  useEffect(() => {
    if (ready) refresh();
  }, [ready, refresh]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput);
  }

  function handleFilter(newStatus: "ACTIVE" | "UNSUBSCRIBED" | null) {
    setPage(1);
    setStatus(newStatus);
  }

  async function updateStatus(id: string, newStatus: "ACTIVE" | "UNSUBSCRIBED") {
    setActionLoading(id);
    try {
      await api(`/api/subscribers/${id}`, "PATCH", { status: newStatus });
      refresh();
    } catch (err: any) {
      if (err.message === "NO_SESSION") {
        router.replace("/login");
        return;
      }
      setError(err.message || "Failed to update subscriber");
    } finally {
      setActionLoading(null);
    }
  }

  async function deleteSubscriber(id: string) {
    setActionLoading(id);
    try {
      await api(`/api/subscribers/${id}`, "DELETE");
      setConfirmDeleteId(null);
      refresh();
    } catch (err: any) {
      if (err.message === "NO_SESSION") {
        router.replace("/login");
        return;
      }
      setError(err.message || "Failed to delete subscriber");
    } finally {
      setActionLoading(null);
    }
  }

  function exportCSV() {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    window.location.href = `/api/subscribers/export?${params}`;
  }

  if (!ready) {
    return (
      <main className="admin-shell">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  const stats = data?.stats || { totalAll: 0, totalActive: 0, newThisWeek: 0 };
  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  return (
    <main className="admin-shell">
      <div className="admin-header">
        <div>
          <h1>Newsletter Subscribers</h1>
          <p className="muted">View and manage subscriber list</p>
        </div>
        <button className="btn btn--ghost" onClick={exportCSV}>
          Export CSV ↓
        </button>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Total Subscribers</div>
          <div className="stat-value">{stats.totalAll}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Active</div>
          <div className="stat-value">{stats.totalActive}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">New This Week</div>
          <div className="stat-value">{stats.newThisWeek}</div>
        </div>
      </div>

      {error && <p className="error" style={{ marginBottom: 16 }}>{error}</p>}

      <div className="card">
        <form className="search-bar" onSubmit={handleSearch}>
          <input
            className="input"
            placeholder="Search by email…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <button className="btn btn--primary btn--sm" type="submit">
            Search
          </button>
          {search && (
            <button
              className="btn btn--ghost btn--sm"
              type="button"
              onClick={() => {
                setSearchInput("");
                setSearch("");
                setPage(1);
              }}
            >
              Clear
            </button>
          )}
        </form>

        <div className="filter-tabs">
          <button
            className={`filter-tab ${status === null ? "filter-tab--active" : ""}`}
            onClick={() => handleFilter(null)}
          >
            All
          </button>
          <button
            className={`filter-tab ${status === "ACTIVE" ? "filter-tab--active" : ""}`}
            onClick={() => handleFilter("ACTIVE")}
          >
            Active
          </button>
          <button
            className={`filter-tab ${status === "UNSUBSCRIBED" ? "filter-tab--active" : ""}`}
            onClick={() => handleFilter("UNSUBSCRIBED")}
          >
            Unsubscribed
          </button>
        </div>

        {loading && !data ? (
          <p className="muted">Loading subscribers…</p>
        ) : data && data.subscribers.length === 0 ? (
          <div className="empty-state">No subscribers found.</div>
        ) : data ? (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Status</th>
                    <th>Source</th>
                    <th>Subscribed</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.subscribers.map((s) => (
                    <tr key={s.id}>
                      <td>{s.email}</td>
                      <td>
                        <span
                          className={`badge ${
                            s.status === "ACTIVE"
                              ? "badge--green"
                              : "badge--dark"
                          }`}
                        >
                          {s.status}
                        </span>
                      </td>
                      <td>{s.source || "-"}</td>
                      <td>{fmtDate(s.subscribedAt)}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {s.status === "ACTIVE" ? (
                          <button
                            className="action-btn"
                            disabled={actionLoading === s.id}
                            onClick={() => updateStatus(s.id, "UNSUBSCRIBED")}
                          >
                            {actionLoading === s.id ? "…" : "Unsubscribe"}
                          </button>
                        ) : (
                          <button
                            className="action-btn"
                            disabled={actionLoading === s.id}
                            onClick={() => updateStatus(s.id, "ACTIVE")}
                          >
                            {actionLoading === s.id ? "…" : "Reactivate"}
                          </button>
                        )}
                        {confirmDeleteId === s.id ? (
                          <>
                            <button
                              className="action-btn action-btn--danger"
                              disabled={actionLoading === s.id}
                              onClick={() => deleteSubscriber(s.id)}
                            >
                              {actionLoading === s.id ? "…" : "Confirm?"}
                            </button>
                            <button
                              className="action-btn"
                              disabled={actionLoading === s.id}
                              onClick={() => setConfirmDeleteId(null)}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            className="action-btn action-btn--danger"
                            disabled={actionLoading === s.id}
                            onClick={() => setConfirmDeleteId(s.id)}
                          >
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="pagination">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  ← Prev
                </button>
                <span className="muted">
                  Page {page} of {totalPages}
                </span>
                <button
                  disabled={page * PAGE_SIZE >= data.total}
                  onClick={() => setPage(page + 1)}
                >
                  Next →
                </button>
              </div>
            )}
          </>
        ) : null}
      </div>
    </main>
  );
}
