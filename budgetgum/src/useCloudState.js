import { useState, useEffect, useRef, useCallback } from "react";

// ═════════════════════════════════════════════════════════════════════════════
// useCloudState — your budget lives on the server, not in this browser.
//
// THE FLOW
// --------
//   open app  →  render from localStorage cache instantly (no blank screen)
//             →  fetch the real state from Redis
//             →  server wins, cache is updated
//
//   you edit  →  state updates immediately (UI never waits on the network)
//             →  debounced ~800ms, then POST to Redis
//             →  every other device sees it next time it opens
//
// localStorage still exists, but it's demoted: it's a *cache*, not the truth.
// The truth is on the server. That's what makes your phone and your Mac agree.
//
// MIGRATION
// ---------
// On first load after this update, the server has nothing but your browser has
// everything. So: if the server is empty and the cache isn't, we push the cache
// up. You don't lose the envelopes you already built. Happens once, silently.
//
// CONFLICTS
// ---------
// Last write wins. If you had the app open on two devices simultaneously and
// edited both, the later save clobbers the earlier one. For one person who isn't
// literally holding two phones, this never comes up — and building real conflict
// resolution (vector clocks, CRDTs, merge UI) is a mountain of machinery for a
// problem you don't have.
// ═════════════════════════════════════════════════════════════════════════════

const CACHE_KEY = "bg_cache_v2";
const SAVE_DEBOUNCE_MS = 800;

export const EMPTY_STATE = {
  envelopes: [],
  transactions: [],
  accounts: [],
  unmapped: [],
  lastSync: null,
};

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) return { ...EMPTY_STATE, ...JSON.parse(raw) };
  } catch {}

  // ── One-time migration from the old v1 keys ──
  // Your existing envelopes were stored under bg_envelopes, bg_transactions, etc.
  // Pull them forward so nothing gets orphaned.
  try {
    const legacy = {
      envelopes:    JSON.parse(localStorage.getItem("bg_envelopes")    || "[]"),
      transactions: JSON.parse(localStorage.getItem("bg_transactions") || "[]"),
      accounts:     JSON.parse(localStorage.getItem("bg_accounts")     || "[]"),
      unmapped:     JSON.parse(localStorage.getItem("bg_unmapped")     || "[]"),
      lastSync:     JSON.parse(localStorage.getItem("bg_last_sync")    || "null"),
    };
    if (legacy.envelopes.length || legacy.transactions.length) return legacy;
  } catch {}

  return EMPTY_STATE;
}

function writeCache(state) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(state)); } catch {}
}

export function useCloudState(enabled) {
  const [state, setStateRaw] = useState(readCache);
  const [status, setStatus] = useState("idle"); // idle | loading | saving | saved | error

  const timer = useRef(null);
  const pending = useRef(null);
  const loaded = useRef(false);

  // ── Push to server ────────────────────────────────────────────────────────
  const push = useCallback(async (next) => {
    setStatus("saving");
    try {
      const r = await fetch("/api/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(next),
      });
      if (!r.ok) throw new Error("save failed");
      setStatus("saved");
      setTimeout(() => setStatus(s => (s === "saved" ? "idle" : s)), 1600);
    } catch {
      setStatus("error");
      // The cache still has it. Next successful save will carry it up.
    }
  }, []);

  // ── Load from server on mount ─────────────────────────────────────────────
  useEffect(() => {
    if (!enabled || loaded.current) return;
    loaded.current = true;

    (async () => {
      setStatus("loading");
      try {
        const r = await fetch("/api/state", { credentials: "same-origin" });
        if (!r.ok) throw new Error("load failed");
        const server = await r.json();

        const serverHasData = (server.envelopes || []).length > 0;
        const cache = readCache();
        const cacheHasData = (cache.envelopes || []).length > 0;

        if (serverHasData) {
          // Server is the truth.
          const merged = { ...EMPTY_STATE, ...server };
          setStateRaw(merged);
          writeCache(merged);
          setStatus("idle");
        } else if (cacheHasData) {
          // MIGRATION: server is empty, this browser has your budget. Push it up.
          await push(cache);
          setStateRaw(cache);
          writeCache(cache);
        } else {
          setStatus("idle");
        }
      } catch {
        // Offline or server down — keep running on the cache. Not fatal.
        setStatus("error");
      }
    })();
  }, [enabled, push]);

  // ── Set state, then debounce a save ───────────────────────────────────────
  const setState = useCallback((updater) => {
    setStateRaw(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      writeCache(next);            // cache immediately — never lose an edit
      pending.current = next;

      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (pending.current) push(pending.current);
      }, SAVE_DEBOUNCE_MS);

      return next;
    });
  }, [push]);

  // Flush any pending save when the tab goes away, so closing the app mid-edit
  // doesn't strand the last change in the debounce window.
  useEffect(() => {
    const flush = () => {
      if (timer.current && pending.current) {
        clearTimeout(timer.current);
        // keepalive lets the request survive the page unloading
        try {
          fetch("/api/state", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify(pending.current),
            keepalive: true,
          });
        } catch {}
      }
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  // Force an immediate save (used by the restore-from-backup flow).
  const saveNow = useCallback(async (next) => {
    if (timer.current) clearTimeout(timer.current);
    setStateRaw(next);
    writeCache(next);
    await push(next);
  }, [push]);

  return [state, setState, status, saveNow];
}
