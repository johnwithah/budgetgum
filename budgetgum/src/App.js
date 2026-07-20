import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { usePlaidLink } from "react-plaid-link";
import { useCloudState, EMPTY_STATE, clearCache } from "./useCloudState";
import {
  TYPES, TYPE_META, isBill, hasTarget,
  nextDueDate, lockDate, isLocked, isPaid, paidThisPeriod, periodKey, paymentHistory,
  spentThisMonth, targetAmount, suggestedPayment, progress, scheduleVariance, promoRisk,
  billAmountStats, amountDrift, periodDueForTx, dueDateOptions,
  safeToSpend, shortfall, upcomingLocks, buildAlerts, overdueInfo,
  matchEnvelope, normalizeMerchant,
  incomeByMonth, incomeBySource, incomeByWeek, incomeStats, incomeTransactions,
  money, daysBetween, DOW,
} from "./engine";

const api = (path, body) =>
  fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: body ? JSON.stringify(body) : undefined,
  });

const ICONS  = ["💳","🏦","🏠","⚡","🚗","🛒","🍕","🎬","💊","✈️","🎓","📱","🐾","🏋️","🎮","💰","🎯","📚"];
const COLORS = ["#30d158","#0a84ff","#ffd60a","#bf5af2","#ff375f","#ff9f0a","#64d2ff","#5e5ce6","#ff6961","#34c759"];

// ═════════════════════════════════════════════════════════════════════════════
function LockScreen({ onUnlock }) {
  const [pw, setPw] = useState(""); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  async function submit() {
    if (!pw || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await api("/api/login", { password: pw });
      if (r.ok) { setPw(""); onUnlock(); }
      else { const d = await r.json().catch(()=>({})); setErr(d.error || "Incorrect password"); }
    } catch { setErr("Connection failed"); }
    setBusy(false);
  }
  return (
    <div style={{fontFamily:"-apple-system,'SF Pro Display',sans-serif",background:"#000",minHeight:"100vh",color:"#fff",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"0 32px",maxWidth:430,margin:"0 auto"}}>
      <style>{`*{box-sizing:border-box;margin:0;padding:0}input::placeholder{color:#48484a}
        @keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-6px)}75%{transform:translateX(6px)}}.shake{animation:shake .3s}`}</style>
      <div style={{fontSize:64,marginBottom:20}}>🍬</div>
      <div style={{fontSize:32,fontWeight:700,letterSpacing:"-1.2px",marginBottom:6}}>Budgetgum</div>
      <div style={{fontSize:15,color:"#636366",marginBottom:36}}>Enter your password to unlock</div>
      <input type="password" value={pw} autoFocus onChange={e=>{setPw(e.target.value);setErr(null);}}
        onKeyDown={e=>e.key==="Enter"&&submit()} placeholder="Password" className={err?"shake":""}
        style={{background:"#1c1c1e",border:err?"1px solid #ff375f":"1px solid #2c2c2e",color:"#fff",borderRadius:14,padding:"16px 18px",width:"100%",fontFamily:"inherit",fontSize:17,outline:"none",marginBottom:12}}/>
      {err && <div style={{color:"#ff375f",fontSize:14,marginBottom:12}}>{err}</div>}
      <button onClick={submit} disabled={busy||!pw}
        style={{background:"#c5f135",color:"#000",border:"none",borderRadius:14,padding:16,width:"100%",fontFamily:"inherit",fontSize:17,fontWeight:600,cursor:"pointer",opacity:(busy||!pw)?.4:1}}>
        {busy?"Unlocking…":"Unlock"}
      </button>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
function PlaidButton({ onLinked, onError, label = "🏦  Connect Your Bank" }) {
  const [linkToken, setLinkToken] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api("/api/create_link_token").then(async r => {
      const d = await r.json();
      if (!r.ok) throw new Error(d.plaid?.error_code || d.error || "Failed");
      setLinkToken(d.link_token);
    }).catch(e => onError?.(e.message));
  }, [onError]);
  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: async (public_token) => {
      setBusy(true);
      try {
        const r = await api("/api/exchange_public_token", { public_token });
        if (!r.ok) { const d = await r.json().catch(()=>({})); throw new Error(d.plaid?.error_code || d.error); }
        onLinked();
      } catch (e) { onError?.(e.message); }
      setBusy(false);
    },
  });
  return (
    <button className="btn-green" onClick={()=>open()} disabled={!ready||busy} style={{opacity:(!ready||busy)?.5:1}}>
      {busy?"Linking…":!ready?"Loading…":label}
    </button>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [authState, setAuthState] = useState("checking");
  const [bankConnected, setBankConnected] = useState(false);

  // ── THE BIG CHANGE ────────────────────────────────────────────────────────
  // One state object, living on the server. Every device reads the same row.
  // localStorage is now just a cache so the app renders instantly offline.
  const [state, setState, syncStatus, saveNow] = useCloudState(authState === "unlocked");
  const { envelopes, transactions, accounts, unmapped } = state;

  // Thin wrappers so every existing call site still reads naturally.
  const setEnvelopes    = useCallback(u => setState(s => ({...s, envelopes:    typeof u==="function" ? u(s.envelopes)    : u})), [setState]);
  const setTransactions = useCallback(u => setState(s => ({...s, transactions: typeof u==="function" ? u(s.transactions) : u})), [setState]);
  const setAccounts     = useCallback(u => setState(s => ({...s, accounts:     typeof u==="function" ? u(s.accounts)     : u})), [setState]);
  const setUnmapped     = useCallback(u => setState(s => ({...s, unmapped:     typeof u==="function" ? u(s.unmapped)     : u})), [setState]);
  const setLastSync     = useCallback(v => setState(s => ({...s, lastSync: v})), [setState]);

  const [tab, setTab] = useState("home");
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState(null);
  const [editEnv, setEditEnv] = useState(null);
  const [detailEnv, setDetailEnv] = useState(null);
  const [fundEnv, setFundEnv] = useState(null);
  const [mapTx, setMapTx] = useState(null);
  const [txDetail, setTxDetail] = useState(null);   // a sorted transaction being viewed/edited
  const [activityView, setActivityView] = useState("all");   // all | income
  const [settings, setSettings] = useState(false);

  const checkingBalance = useMemo(
    () => (accounts||[]).filter(a => a.type === "depository" && a.subtype !== "savings")
                        .reduce((s,a) => s + (a.available ?? a.balance ?? 0), 0),
    [accounts]
  );

  const sts    = safeToSpend(envelopes, checkingBalance);
  const alerts = useMemo(() => buildAlerts(envelopes, transactions, checkingBalance, state.importSince || "2026-07-14"), [envelopes, transactions, checkingBalance, state.importSince]);
  const locks  = useMemo(() => upcomingLocks(envelopes, transactions), [envelopes, transactions]);
  const bills  = envelopes.filter(e => isBill(e.type));
  const debts  = envelopes.filter(e => e.type === TYPES.DEBT);

  // ── Home is a "where should my money go?" screen ──────────────────────────
  // Spending envelopes (the discretionary ones) go up top; then the bills that
  // are actually asking for money right now: due within 14 days AND not yet
  // fully funded. Fully-funded or far-off bills drop off Home (handled) but
  // still live in the Bills tab.
  const spendingEnvelopes = useMemo(
    () => envelopes.filter(e => e.type === TYPES.SPENDING),
    [envelopes]
  );
  const upcomingUnfundedBills = useMemo(() => {
    return envelopes
      .filter(e => isBill(e.type))
      .filter(e => !isPaid(e, transactions))
      .filter(e => shortfall(e, transactions) > 0)   // not fully funded
      .map(e => {
        const due = nextDueDate(e);
        return { env: e, due, days: due ? daysBetween(new Date(), due) : 999 };
      })
      .filter(x => x.days <= 14)
      .sort((a, b) => a.days - b.days);
  }, [envelopes, transactions]);

  function showToast(m) { setToast(m); setTimeout(()=>setToast(null), 3200); }

  const checkSession = useCallback(async () => {
    try {
      const r = await fetch("/api/session", { credentials: "same-origin" });
      const d = await r.json();
      setAuthState(d.authenticated ? "unlocked" : "locked");
      setBankConnected(Boolean(d.bankConnected));
    } catch { setAuthState("locked"); }
  }, []);
  useEffect(() => { checkSession(); }, [checkSession]);

  // ── Auto-fund on lock day ─────────────────────────────────────────────────
  // A lock date arriving is a TIME event, not a state change — nothing in React
  // re-renders just because the clock rolled past it. The old version only
  // watched envelope/transaction COUNTS, so it fired on app open and basically
  // never again: toggling autopay, editing an amount, or a balance arriving
  // from the bank all left it asleep.
  //
  // Now it watches what the decision actually depends on, and ticks once a
  // minute so a lock that lands while the app is open is caught immediately.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 60000);
    return () => clearInterval(t);
  }, []);

  // A fingerprint of every input to the auto-fund decision. When any of it
  // moves, the effect re-evaluates.
  const autofundKey = useMemo(() =>
    envelopes
      .filter(e => e.autopay && isBill(e.type))
      .map(e => [
        e.id,
        e.funded || 0,
        targetAmount(e),
        isLocked(e, transactions) ? 1 : 0,
        isPaid(e, transactions) ? 1 : 0,
      ].join(":"))
      .join("|"),
    [envelopes, transactions]
  );

  useEffect(() => {
    if (authState !== "unlocked" || !envelopes.length) return;

    let available = sts;
    let changed = false;
    let fundedTotal = 0;

    const next = envelopes.map(env => {
      if (!env.autopay || !isBill(env.type)) return env;
      if (isPaid(env, transactions)) return env;
      if (!isLocked(env, transactions)) return env;
      const need = targetAmount(env) - (env.funded || 0);
      if (need <= 0.005) return env;                    // already covered
      const grab = Math.min(need, Math.max(0, available));
      if (grab <= 0.005) return env;                    // nothing spare to give
      available -= grab;
      fundedTotal += grab;
      changed = true;
      return { ...env, funded: (env.funded || 0) + grab };
    });

    if (changed) {
      setEnvelopes(next);
      showToast(`Auto-funded ${money(fundedTotal)} for locked bills`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState, autofundKey, sts, tick]);

  // ── Sync with bank ────────────────────────────────────────────────────────
  const syncBank = useCallback(async () => {
    setSyncing(true);
    try {
      // Only import transactions on/after this date, so old history doesn't
      // backfill into envelopes you just created. Defaults to July 14, 2026.
      const since = state.importSince || "2026-07-14";
      const r = await api("/api/get_transactions", { since });
      if (r.status === 401) { setAuthState("locked"); setSyncing(false); return; }
      const d = await r.json();
      if (!r.ok) {
        if (d.code === "RELINK") { setBankConnected(false); showToast("Bank needs re-linking"); }
        else if (d.code === "NO_BANK") { setBankConnected(false); showToast("No bank connected"); }
        else showToast(d.plaid?.error_code || "Sync failed");
        setSyncing(false); return;
      }

      const seen = new Set(transactions.map(t => t.id));
      const ignored = new Set(state.ignored || []);
      const fresh = (d.transactions || [])
        .filter(t => !seen.has(t.id) && !t.pending)
        .filter(t => !ignored.has(t.id))   // deleted transactions never come back
        .filter(t => t.date >= since);     // backstop: never import before the cutoff

      const matched = [], needsAssign = [], deposits = [];
      fresh.forEach(t => {
        if (t.amount <= 0) {
          // A credit. Is it a refund from somewhere you spend, or income?
          // We can't know from the transaction itself — but if its merchant
          // matches an envelope you've already taught, a refund is the far more
          // likely story, so we ask instead of assuming.
          const envId = matchEnvelope(t, envelopes);
          const looksLikeRefund = Boolean(envId) &&
            envelopes.find(e => e.id === envId)?.type === TYPES.SPENDING;
          if (looksLikeRefund) needsAssign.push({ ...t, likelyRefund: true, suggestedEnvelopeId: envId });
          else deposits.push({ ...t, envelopeId: null, kind: "deposit" });
          return;
        }
        const envId = matchEnvelope(t, envelopes);
        if (envId) matched.push({ ...t, envelopeId: envId });
        else needsAssign.push(t);
      });

      // Recorded immediately: matched outflows + deposits. Only unmatched
      // outflows go to the sort queue.
      const recorded = [...matched, ...deposits];

      // One atomic state update — keeps the server write consistent.
      setState(s => {
        const allTx = recorded.length ? [...recorded, ...s.transactions] : s.transactions;
        let nextEnvelopes = matched.length
          ? s.envelopes.map(env => applyPayments(env, matched.filter(t => t.envelopeId === env.id)))
          : s.envelopes;

        // Variable bills with auto-update on re-learn their reserve amount from
        // the payment that just cleared. Computed against the full transaction
        // list so the new payment is included.
        nextEnvelopes = nextEnvelopes.map(env => {
          if (!env.autoAmount || env.type !== TYPES.RECURRING) return env;
          const stats = billAmountStats(env, allTx);
          if (!stats || !stats.enough) return env;
          if (Math.abs(stats.suggested - (env.billAmount || 0)) < 0.01) return env;
          return { ...env, billAmount: stats.suggested };
        });

        // Adopt merchant branding from Plaid the first time we see it. Only
        // fills empty fields — anything you set by hand is never overwritten.
        nextEnvelopes = nextEnvelopes.map(env => {
          if (env.logoUrl || env.website) return env;
          const hit = matched.find(t => t.envelopeId === env.id && (t.logo || t.website));
          if (!hit) return env;
          return { ...env, logoUrl: hit.logo || env.logoUrl, website: hit.website || env.website };
        });

        return {
          ...s,
          accounts: d.accounts || [],
          transactions: allTx,
          envelopes: nextEnvelopes,
          unmapped: needsAssign.length ? [...needsAssign, ...s.unmapped] : s.unmapped,
          lastSync: new Date().toISOString(),
        };
      });

      const inflowNote = deposits.length ? `, ${deposits.length} deposit${deposits.length>1?"s":""}` : "";
      showToast(`Synced — ${fresh.length} new${inflowNote}`);
    } catch { showToast("Sync failed"); }
    setSyncing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, envelopes, setState, state.importSince, state.ignored]);

  // ── The release mechanic ──────────────────────────────────────────────────
  // Applying a payment to an envelope: a debt balance drops, a goal grows, and
  // for a bill the funded amount settles to 0 (unused reservation released).
  //
  // BILLS/DEBTS/GOALS only act on outflows — a refund shouldn't un-pay a bill.
  // SPENDING envelopes net both directions: a refund puts money back where you
  // spent it, which is the whole point of assigning it there.
  function applyPayments(env, payments) {
    if (!payments.length) return env;

    if (env.type === TYPES.SPENDING) {
      const net = payments.reduce((s,t) => s + t.amount, 0);   // outflow +, refund −
      return { ...env, funded: Math.max(0, (env.funded || 0) - net) };
    }

    const outflows = payments.filter(t => t.amount > 0);
    if (!outflows.length) return env;
    const total = outflows.reduce((s,t) => s + t.amount, 0);
    let next = { ...env };
    if (env.type === TYPES.DEBT)      next.currentBalance = Math.max(0, (env.currentBalance || 0) - total);
    else if (env.type === TYPES.GOAL) next.currentBalance = (env.currentBalance || 0) + total;
    if (isBill(env.type)) next.funded = 0;
    return next;
  }

  // ── The MIRROR of applyPayments ────────────────────────────────────────────
  // Undoing a payment has to reverse exactly what applying it did, or balances
  // drift silently. A debt balance goes back UP, a goal comes back DOWN. The
  // funded/paid side is trickier: settling a bill zeroed `funded` and left no
  // record of what it was, so we can't perfectly restore the old reservation.
  // Reversing the balance is the part that must be right (it's what corrupts
  // your payoff math); the funded reset is cosmetic and self-heals next period.
  function unapplyPayments(env, payments) {
    if (!payments.length) return env;

    if (env.type === TYPES.SPENDING) {
      const net = payments.reduce((s,t) => s + t.amount, 0);
      return { ...env, funded: Math.max(0, (env.funded || 0) + net) };
    }

    const outflows = payments.filter(t => t.amount > 0);
    if (!outflows.length) return env;
    const total = outflows.reduce((s,t) => s + t.amount, 0);
    let next = { ...env };
    if (env.type === TYPES.DEBT)      next.currentBalance = (env.currentBalance || 0) + total;
    else if (env.type === TYPES.GOAL) next.currentBalance = Math.max(0, (env.currentBalance || 0) - total);
    // Clear any manual "paid" override for this period — removing the payment
    // means it may no longer be paid, and isPaid() will recompute from what's left.
    if (isBill(env.type)) next.manualPaidPeriod = null;
    return next;
  }

  // Move a sorted transaction to a different envelope: reverse it off the old
  // one, apply it to the new one, relabel it.
  function moveTransaction(tx, newEnvId) {
    if (tx.envelopeId === newEnvId) { setTxDetail(null); return; }
    setState(s => ({
      ...s,
      transactions: s.transactions.map(t => t.id === tx.id ? { ...t, envelopeId: newEnvId } : t),
      envelopes: s.envelopes.map(e => {
        if (e.id === tx.envelopeId) return unapplyPayments(e, [tx]);
        if (e.id === newEnvId)      return applyPayments(e, [{ ...tx, envelopeId: newEnvId }]);
        return e;
      }),
    }));
    setTxDetail(null);
    showToast("Moved");
  }

  // Re-queue: reverse effects, pull it out of sorted, drop it back in the queue
  // to be sorted again.
  function requeueTransaction(tx) {
    setState(s => ({
      ...s,
      transactions: s.transactions.filter(t => t.id !== tx.id),
      unmapped: [{ ...tx, envelopeId: null }, ...s.unmapped],
      envelopes: s.envelopes.map(e => e.id === tx.envelopeId ? unapplyPayments(e, [tx]) : e),
    }));
    setTxDetail(null);
    showToast("Sent back to sort queue");
  }

  // Delete: reverse effects, remove it, and remember its id so the next bank
  // sync won't re-import it. (It's still in your real bank feed, so without the
  // ignore-list it would silently come back.)
  function deleteTransaction(tx) {
    setState(s => ({
      ...s,
      transactions: s.transactions.filter(t => t.id !== tx.id),
      unmapped: s.unmapped.filter(t => t.id !== tx.id),
      ignored: [...(s.ignored || []), tx.id],
      envelopes: s.envelopes.map(e => e.id === tx.envelopeId ? unapplyPayments(e, [tx]) : e),
    }));
    setTxDetail(null);
    showToast("Deleted — won't return on sync");
  }

  function fund(envId, amount) {
    if (amount <= 0) return;
    if (amount > sts) { showToast("Not enough safe to spend"); return; }
    setEnvelopes(p => p.map(e => e.id === envId ? { ...e, funded: (e.funded||0) + amount } : e));
    showToast(`Funded ${money(amount)}`);
  }
  function unfund(envId, amount) {
    const env = envelopes.find(e => e.id === envId);
    if (!env) return;
    if (isLocked(env, transactions)) { showToast("🔒 Locked — autopay is in flight"); return; }
    const take = Math.min(amount, env.funded || 0);
    setEnvelopes(p => p.map(e => e.id === envId ? { ...e, funded: (e.funded||0) - take } : e));
    showToast(`Released ${money(take)}`);
  }

  function saveEnvelope(data) {
    if (data.id) {
      setEnvelopes(p => p.map(e => e.id === data.id ? { ...e, ...data } : e));
      showToast("Envelope updated");
    } else {
      const created = { ...data, id: `env_${Date.now()}`, funded: 0, matchPatterns: data.matchPatterns || [] };
      if (data.type === TYPES.DEBT) {
        created.originalBalance = data.currentBalance;
        created.startDate = new Date().toISOString().split("T")[0];
      }
      setEnvelopes(p => [...p, created]);
      showToast("Envelope created");
    }
    setEditEnv(null);
  }

  function deleteEnvelope(id) {
    const env = envelopes.find(e => e.id === id);
    if (env && isLocked(env, transactions)) { showToast("🔒 Can't delete — autopay locked"); return; }
    setState(s => ({
      ...s,
      envelopes: s.envelopes.filter(e => e.id !== id),
      transactions: s.transactions.map(t => t.envelopeId === id ? { ...t, envelopeId: null } : t),
    }));
    setDetailEnv(null);
    showToast("Envelope deleted");
  }

  function assignTx(tx, envId, remember) {
    const assigned = { ...tx, envelopeId: envId };
    setState(s => {
      const allTx = [assigned, ...s.transactions];
      return {
        ...s,
        transactions: allTx,
        unmapped: s.unmapped.filter(t => t.id !== tx.id),
        envelopes: s.envelopes.map(e => {
          if (e.id !== envId) return e;
          let next = applyPayments(e, [assigned]);
          if (remember) {
            const pattern = normalizeMerchant(tx.desc);
            if (pattern && !(next.matchPatterns||[]).includes(pattern)) {
              next.matchPatterns = [...(next.matchPatterns||[]), pattern];
            }
          }
          // Re-learn the reserve amount if this bill tracks itself.
          if (next.autoAmount && next.type === TYPES.RECURRING) {
            const stats = billAmountStats(next, allTx);
            if (stats && stats.enough) next = { ...next, billAmount: stats.suggested };
          }
          return next;
        }),
      };
    });
    setMapTx(null);
    showToast(remember ? "Assigned — will auto-match next time" : "Assigned");
  }

  // Adopt the learned amount for a variable bill.
  function updateBillAmount(env, amount) {
    setEnvelopes(p => p.map(e => e.id === env.id ? { ...e, billAmount: amount } : e));
    showToast(`Updated to ${money(amount)}`);
  }

  // When on, the reserve amount re-learns itself each time a payment clears.
  function toggleAutoAmount(env) {
    const on = !env.autoAmount;
    setEnvelopes(p => p.map(e => e.id === env.id ? { ...e, autoAmount: on } : e));
    showToast(on ? "Will keep itself updated" : "Auto-update off");
  }

  // Pin a payment to a specific billing period (or clear the pin and go back to
  // automatic nearest-due matching). Purely a labeling change — it doesn't move
  // money, so no balance reversal is needed.
  function setTransactionPeriod(tx, key) {
    setState(s => ({
      ...s,
      transactions: s.transactions.map(t =>
        t.id === tx.id ? { ...t, periodOverride: key || undefined } : t),
    }));
    setTxDetail(prev => prev && prev.id === tx.id ? { ...prev, periodOverride: key || undefined } : prev);
    showToast(key ? "Applied to that period" : "Back to automatic");
  }

  // Flip a transaction that was imported with the wrong sign.
  //
  // Before the sign fix, the API ran Math.abs() on every amount, so deposits
  // came in looking like charges. Those are still sitting in your history as
  // positive numbers. This reverses whatever effect the transaction had on its
  // envelope, flips it to an inflow, and detaches it — turning it back into the
  // deposit it always was.
  function convertToDeposit(tx) {
    setState(s => ({
      ...s,
      transactions: s.transactions.map(t => t.id === tx.id
        ? { ...t, amount: -Math.abs(t.amount), envelopeId: null, kind: "deposit", periodOverride: undefined }
        : t),
      envelopes: s.envelopes.map(e =>
        e.id === tx.envelopeId ? unapplyPayments(e, [tx]) : e),
    }));
    setTxDetail(null);
    showToast("Moved to income");
  }

  // The same repair, in bulk. Finds charges whose merchant matches something
  // already known to be an income source.
  const miscategorizedDeposits = useMemo(() => {
    const incomeNames = new Set(
      incomeTransactions(transactions).map(t => normalizeMerchant(t.desc)).filter(Boolean)
    );
    if (!incomeNames.size) return [];
    return transactions.filter(t =>
      t.amount > 0 && incomeNames.has(normalizeMerchant(t.desc))
    );
  }, [transactions]);

  function fixAllDeposits() {
    const ids = new Set(miscategorizedDeposits.map(t => t.id));
    if (!ids.size) return;
    setState(s => ({
      ...s,
      transactions: s.transactions.map(t => ids.has(t.id)
        ? { ...t, amount: -Math.abs(t.amount), envelopeId: null, kind: "deposit", periodOverride: undefined }
        : t),
      envelopes: s.envelopes.map(e => {
        const hits = miscategorizedDeposits.filter(t => t.envelopeId === e.id);
        return hits.length ? unapplyPayments(e, hits) : e;
      }),
    }));
    showToast(`Moved ${ids.size} to income`);
  }

  function markPaid(env) {
    const key = periodKey(env);
    setEnvelopes(p => p.map(e => {
      if (e.id !== env.id) return e;
      const list = new Set([...(e.manualPaidPeriods || []), ...(e.manualPaidPeriod ? [e.manualPaidPeriod] : [])]);
      list.add(key);
      return { ...e, manualPaidPeriods: [...list], manualPaidPeriod: undefined, funded: 0 };
    }));
    showToast("Marked as paid");
  }

  // Escape hatch: undo a manual "paid" mark for a given period. Only affects the
  // manual flag — a real cleared transaction still counts as paid on its own.
  function unmarkPaid(env, key) {
    setEnvelopes(p => p.map(e => {
      if (e.id !== env.id) return e;
      const list = (e.manualPaidPeriods || []).filter(k => k !== key);
      const legacy = e.manualPaidPeriod === key ? undefined : e.manualPaidPeriod;
      return { ...e, manualPaidPeriods: list, manualPaidPeriod: legacy };
    }));
    showToast("Unmarked");
  }

  // Mark a specific historical period paid (from the archive view).
  function markPeriodPaid(env, key) {
    setEnvelopes(p => p.map(e => {
      if (e.id !== env.id) return e;
      const list = new Set([...(e.manualPaidPeriods || []), ...(e.manualPaidPeriod ? [e.manualPaidPeriod] : [])]);
      list.add(key);
      return { ...e, manualPaidPeriods: [...list], manualPaidPeriod: undefined };
    }));
    showToast("Marked paid");
  }

  async function handleLinked() { setBankConnected(true); showToast("Bank connected"); await syncBank(); }
  async function logout() {
    await api("/api/logout").catch(()=>{});
    clearCache();              // don't leave balances in browser storage while locked
    setAuthState("locked");
  }

  // ── AUTO-LOCK ─────────────────────────────────────────────────────────────
  // Walk away from the laptop and the app locks itself. This calls the real
  // logout endpoint rather than just covering the screen — the session cookie
  // is destroyed, so reopening the tab (or hitting back) can't get you in.
  //
  // Any real interaction resets the clock. We deliberately don't count
  // mousemove: a nudged desk or a cat shouldn't keep your bank data on screen.
  const lastActivity = useRef(Date.now());
  const lockMinutes = state.autoLockMinutes ?? 10;

  useEffect(() => {
    if (authState !== "unlocked" || lockMinutes === 0) return;

    const bump = () => { lastActivity.current = Date.now(); };
    const events = ["mousedown", "keydown", "touchstart", "scroll", "focus"];
    events.forEach(e => window.addEventListener(e, bump, { passive: true }));

    const limit = lockMinutes * 60 * 1000;

    const check = () => {
      if (Date.now() - lastActivity.current >= limit) logout();
    };

    // Poll rather than one long timeout, so a laptop that was asleep for an
    // hour locks the moment it wakes instead of when a stale timer fires.
    const timer = setInterval(check, 15000);

    // Coming back to a backgrounded tab is the highest-risk moment — check
    // immediately rather than waiting up to 15s for the next poll.
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      events.forEach(e => window.removeEventListener(e, bump));
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState, lockMinutes]);

  if (authState === "checking")
    return <div style={{background:"#000",minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{fontSize:44,opacity:.35}}>🍬</div></div>;
  if (authState === "locked") return <LockScreen onUnlock={checkSession} />;

  return (
    <div style={S.app}>
      <style>{CSS}</style>
      {toast && <div className="toast">{toast}</div>}

      {/* ═══ HEADER ═══ */}
      <div style={{padding:"24px 22px 0"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
              <span className="eyebrow">🍬 Budgetgum</span>
              <SyncDot status={syncStatus} />
              <button onClick={()=>setSettings(true)} className="tiny-link">Settings</button>
              <button onClick={logout} className="lock-btn" title={`Lock now (auto-locks after ${lockMinutes} min)`}>
                🔒 Lock
              </button>
            </div>
            <div style={{fontSize:44,fontWeight:700,letterSpacing:"-2.2px",lineHeight:1,color:sts>=0?"#c5f135":"#ff375f"}}>
              {money(sts)}
            </div>
            <div style={{fontSize:15,color:"#636366",marginTop:5}}>safe to spend</div>
          </div>
          <div style={{textAlign:"right",paddingTop:4}}>
            {bankConnected ? (
              <>
                <div className="eyebrow" style={{marginBottom:5}}>In Checking</div>
                <div style={{fontSize:22,fontWeight:700,letterSpacing:"-1px"}}>{money(checkingBalance)}</div>
                <div style={{fontSize:12,color:"#636366",marginTop:2}}>{money(envelopes.reduce((s,e)=>s+(e.funded||0),0))} reserved</div>
                <button onClick={syncBank} disabled={syncing} className="tiny-link" style={{color:syncing?"#48484a":"#0a84ff",marginTop:4}}>
                  {syncing ? "Syncing…" : "Sync"}
                </button>
              </>
            ) : (
              <div style={{fontSize:12,color:"#48484a",maxWidth:110,textAlign:"right"}}>Connect a bank to see real balances</div>
            )}
          </div>
        </div>

        {!bankConnected && (
          <div className="card" style={{padding:16,marginTop:16,border:"1px solid #30d15840"}}>
            <div style={{fontSize:15,fontWeight:600,marginBottom:4}}>Connect Your Bank</div>
            <div style={{fontSize:13,color:"#636366",marginBottom:12,lineHeight:1.5}}>
              Safe to Spend is your real checking balance minus what you've reserved. Without a bank, it's guesswork.
            </div>
            <PlaidButton onLinked={handleLinked} onError={showToast} />
          </div>
        )}

        <div className="tabs">
          {[["home","⊞","Home"],["envelopes","▣","Envelopes"],["bills","◎","Bills"],["debt","◐","Debt"],["activity","≡","Activity"]].map(([t,ic,l])=>(
            <button key={t} onClick={()=>setTab(t)} className={`tab ${tab===t?"on":""}`}>
              <span style={{fontSize:18}}>{ic}</span>{l}
            </button>
          ))}
        </div>
      </div>

      {/* ═══ HOME ═══ */}
      {tab === "home" && (
        <div style={S.page}>
          {alerts.length > 0 && (
            <div style={{marginBottom:24}}>
              {alerts.slice(0,4).map((a,i) => (
                <button key={i} className={`alert ${a.level}`} onClick={()=>setDetailEnv(a.env)}>
                  <span style={{fontSize:18,flexShrink:0}}>{a.level==="critical"?"🚨":a.level==="warn"?"⚠️":"🔔"}</span>
                  <div style={{flex:1,textAlign:"left"}}>
                    <div style={{fontSize:14,fontWeight:600,letterSpacing:"-.2px"}}>{a.title}</div>
                    <div style={{fontSize:12,color:"#aeaeb2",marginTop:2,lineHeight:1.4}}>{a.body}</div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {locks.length > 0 && (
            <div style={{marginBottom:24}}>
              <div className="sec">Locking Soon</div>
              <div className="card" style={{padding:16}}>
                <div style={{fontSize:13,color:"#8e8e93",marginBottom:12,lineHeight:1.5}}>
                  Autopay pulls funds days before the due date. Once locked, that money can't be moved.
                </div>
                {locks.map(({env,lockIn,needs,has,short}) => (
                  <div key={env.id} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 0",borderBottom:"0.5px solid rgba(255,255,255,.07)"}}>
                    <EnvIcon env={env} size={26} radius={7} bg="transparent" />
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:14,fontWeight:500}}>{env.name}</div>
                      <div style={{fontSize:12,color:short>0?"#ffd60a":"#30d158",marginTop:1}}>
                        {money(has)} of {money(needs)}{short>0?` · ${money(short)} short`:" · ready"}
                      </div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:13,fontWeight:700,color:lockIn<=1?"#ff375f":lockIn<=3?"#ffd60a":"#8e8e93"}}>
                        {lockIn===0?"TODAY":`${lockIn}d`}
                      </div>
                      <div style={{fontSize:10,color:"#48484a",letterSpacing:".4px"}}>TO LOCK</div>
                    </div>
                  </div>
                ))}
                <div style={{display:"flex",justifyContent:"space-between",paddingTop:12,fontSize:13}}>
                  <span style={{color:"#8e8e93"}}>Safe to Spend after locks</span>
                  <span style={{fontWeight:700,color:(sts - locks.reduce((s,l)=>s+l.short,0))>=0?"#c5f135":"#ff375f"}}>
                    {money(sts - locks.reduce((s,l)=>s+l.short,0))}
                  </span>
                </div>
              </div>
            </div>
          )}

          {unmapped.length > 0 && (
            <button className="card" style={{padding:"13px 16px",marginBottom:20,width:"100%",display:"flex",alignItems:"center",gap:12,border:"1px solid #ffd60a40",cursor:"pointer"}}
              onClick={()=>setMapTx(unmapped[0])}>
              <span style={{fontSize:22}}>📥</span>
              <div style={{flex:1,textAlign:"left"}}>
                <div style={{fontSize:15,fontWeight:600}}>Transactions to sort</div>
                <div style={{fontSize:12,color:"#636366",marginTop:1}}>Teach Budgetgum where these go</div>
              </div>
              <span className="badge">{unmapped.length}</span>
            </button>
          )}

          {envelopes.length === 0 ? (
            <EmptyState onAdd={()=>setEditEnv({})} />
          ) : (
            <>
              {/* Spending — the discretionary envelopes competing for Safe to Spend */}
              {spendingEnvelopes.length > 0 && (
                <>
                  <div className="sec">Spending</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:11,marginBottom:22}}>
                    {spendingEnvelopes.map(env => (
                      <EnvCard key={env.id} env={env} transactions={transactions} onClick={()=>setDetailEnv(env)} />
                    ))}
                  </div>
                </>
              )}

              {/* Coming due — bills within 14 days that still need funding.
                  This is the actual decision: fund these, or keep it spendable? */}
              {upcomingUnfundedBills.length > 0 && (
                <>
                  <div className="sec">Needs Funding · Next 14 Days</div>
                  <div style={{display:"flex",flexDirection:"column",gap:9,marginBottom:22}}>
                    {upcomingUnfundedBills.map(({env,due,days}) => {
                      const need = shortfall(env, transactions);
                      const urg = days<=2?"#ff375f":days<=5?"#ffd60a":"#30d158";
                      const canCover = sts >= need;
                      return (
                        <div key={env.id} className="card" style={{padding:14}}>
                          <div style={{display:"flex",alignItems:"center",gap:11}}>
                            <EnvIcon env={env} size={36} radius={10} bg={urg+"22"} />
                            <div style={{flex:1,minWidth:0,cursor:"pointer"}} onClick={()=>setDetailEnv(env)}>
                              <div style={{display:"flex",alignItems:"center",gap:6}}>
                                <span style={{fontSize:15,fontWeight:600,letterSpacing:"-.3px"}}>{env.name}</span>
                                {env.autopay && <span style={{fontSize:11}}>🔒</span>}
                              </div>
                              <div style={{fontSize:12,color:urg,fontWeight:500,marginTop:2}}>
                                {days===0?"Due today":days===1?"Due tomorrow":`Due in ${days} days`}
                                {due?` · ${due.toLocaleDateString("en-US",{month:"short",day:"numeric"})}`:""}
                              </div>
                            </div>
                            <div style={{textAlign:"right"}}>
                              <div style={{fontSize:15,fontWeight:700,letterSpacing:"-.4px"}}>{money(need)}</div>
                              <div style={{fontSize:10.5,color:"#8e8e93"}}>to fund</div>
                            </div>
                          </div>
                          <div style={{display:"flex",gap:7,marginTop:11}}>
                            <button className="btn-mini" style={{background:canCover?"#c5f135":"#2c2c2e",color:canCover?"#000":"#8e8e93"}}
                              onClick={()=>setFundEnv(env)}>
                              {canCover ? `Fund ${money(need)}` : "Fund partially"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {spendingEnvelopes.length === 0 && upcomingUnfundedBills.length === 0 && (
                <div className="card" style={{padding:"22px 20px",textAlign:"center",marginBottom:16}}>
                  <div style={{fontSize:30,marginBottom:8}}>✓</div>
                  <div style={{fontSize:15,fontWeight:600,marginBottom:4}}>All caught up</div>
                  <div style={{fontSize:13,color:"#636366",lineHeight:1.5}}>
                    No spending envelopes, and nothing due in the next 14 days needs funding.
                    Check the Bills or Debt tabs for the full picture.
                  </div>
                </div>
              )}

              <button className="btn-dim" onClick={()=>setEditEnv({})}>+ New Envelope</button>
            </>
          )}
        </div>
      )}

      {/* ═══ ENVELOPES ═══ */}
      {tab === "envelopes" && (
        <div style={S.page}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <div className="sec" style={{margin:0}}>All Envelopes</div>
            <button className="link" onClick={()=>setEditEnv({})}>+ New</button>
          </div>
          {envelopes.length === 0 ? <EmptyState onAdd={()=>setEditEnv({})} /> : (
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {envelopes.map(env => (
                <EnvRow key={env.id} env={env} transactions={transactions}
                  onOpen={()=>setDetailEnv(env)} onFund={()=>setFundEnv(env)} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ BILLS ═══ */}
      {tab === "bills" && (
        <div style={S.page}>
          {bills.length === 0 ? (
            <>
              <div className="sec">Bills</div>
              <div className="card" style={{padding:28,textAlign:"center"}}>
                <div style={{fontSize:36,marginBottom:10}}>◎</div>
                <div style={{fontSize:15,fontWeight:600,marginBottom:4}}>No bills yet</div>
                <div style={{fontSize:13,color:"#636366",lineHeight:1.5,marginBottom:16}}>
                  Recurring and Debt envelopes show up here automatically.
                </div>
                <button className="btn-green" onClick={()=>setEditEnv({type:TYPES.RECURRING})}>Add a Bill</button>
              </div>
            </>
          ) : (
            <BillsView bills={bills} transactions={transactions} dataSince={state.importSince || "2026-07-14"}
              onOpen={env=>setDetailEnv(env)} onMarkPaid={env=>markPaid(env)} />
          )}
        </div>
      )}

      {/* ═══ DEBT PAYOFF ═══ */}
      {tab === "debt" && (
        <div style={S.page}>
          <div className="sec">Debt Payoff</div>
          {debts.length === 0 ? (
            <div className="card" style={{padding:28,textAlign:"center"}}>
              <div style={{fontSize:36,marginBottom:10}}>◐</div>
              <div style={{fontSize:15,fontWeight:600,marginBottom:4}}>No debts tracked</div>
              <div style={{fontSize:13,color:"#636366",lineHeight:1.5,marginBottom:16}}>
                Add a Debt envelope to watch a credit card or loan drop toward zero — with a
                suggested payment and a warning if a 0% period is running out.
              </div>
              <button className="btn-green" onClick={()=>setEditEnv({type:TYPES.DEBT})}>Track a Debt</button>
            </div>
          ) : (
            <>
              {/* Quick totals across every debt */}
              <div className="card" style={{padding:"16px 18px",marginBottom:16,display:"flex"}}>
                {[
                  ["Total owed", money(debts.reduce((s,e)=>s+(e.currentBalance||0),0)), "#fff"],
                  ["Paid off", money(debts.reduce((s,e)=>s+Math.max(0,(e.originalBalance||0)-(e.currentBalance||0)),0)), "#30d158"],
                  ["Suggested/mo", money(debts.reduce((s,e)=>s+suggestedPayment(e),0)), "#c5f135"],
                ].map(([label,val,color],i)=>(
                  <div key={i} style={{flex:1,textAlign:i===0?"left":i===1?"center":"right"}}>
                    <div style={{fontSize:11.5,color:"#8e8e93",fontWeight:500,marginBottom:4}}>{label}</div>
                    <div style={{fontSize:18,fontWeight:700,letterSpacing:"-.8px",color}}>{val}</div>
                  </div>
                ))}
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {debts.map(env => <DebtCard key={env.id} env={env} onClick={()=>setDetailEnv(env)} />)}
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══ ACTIVITY ═══ */}
      {tab === "activity" && (
        <div style={S.page}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <div className="sec" style={{margin:0}}>{activityView==="income"?"Income":"Transactions"}</div>
            {bankConnected && <button className="link" onClick={syncBank} disabled={syncing} style={{color:syncing?"#48484a":"#0a84ff",fontSize:15}}>{syncing?"Syncing…":"↻ Sync"}</button>}
          </div>

          <div style={{display:"flex",gap:6,background:"#1c1c1e",borderRadius:11,padding:4,marginBottom:16}}>
            {[["all","All"],["income","Income"]].map(([v,label])=>(
              <button key={v} onClick={()=>setActivityView(v)}
                style={{flex:1,background:activityView===v?"#2c2c2e":"transparent",color:activityView===v?"#fff":"#8e8e93",
                        border:"none",borderRadius:8,padding:"8px 0",fontSize:13.5,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                {label}
              </button>
            ))}
          </div>

          {activityView === "income" ? (
            <IncomeView transactions={transactions} onOpenTx={tx=>setTxDetail(tx)} />
          ) : transactions.length === 0 ? (
            <div className="card" style={{padding:28,textAlign:"center",color:"#636366",fontSize:14}}>
              No transactions yet. Connect your bank and sync.
            </div>
          ) : (
            <div className="grp">
              {transactions
                .slice()
                // Sort by date, not insertion order. Transactions arrive in
                // whatever order the bank hands them over, and changing the
                // import cutoff backfills older ones after newer ones are
                // already in the list — so the raw array is not chronological.
                .sort((a, b) => (a.date === b.date
                  ? String(a.id).localeCompare(String(b.id))
                  : (a.date < b.date ? 1 : -1)))
                .slice(0, 80)
                .map(tx => {
                const env = envelopes.find(e => e.id === tx.envelopeId);
                const isDeposit = tx.amount <= 0 || tx.kind === "deposit";
                return (
                  <button key={tx.id} className="row row-tap" style={{width:"100%",textAlign:"left",background:"none",border:"none",fontFamily:"inherit",color:"#fff"}}
                    onClick={()=>setTxDetail(tx)}>
                    {isDeposit
                      ? <div className="ibox" style={{background:"#30d15822"}}>⬇</div>
                      : <EnvIcon env={env} size={36} radius={10} />}
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:15,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{tx.desc}</div>
                      <div style={{fontSize:12,color:"#636366",marginTop:1}}>{isDeposit?"Deposit":env?.name||"Unassigned"} · {tx.date}</div>
                    </div>
                    <div style={{fontSize:15,fontWeight:600,color:isDeposit?"#30d158":"#aeaeb2"}}>
                      {isDeposit?`+${money(Math.abs(tx.amount))}`:`−${money(tx.amount)}`}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="tabbar">
        {[["home","⊞","Home"],["envelopes","▣","Envelopes"],["bills","◎","Bills"],["debt","◐","Debt"],["activity","≡","Activity"]].map(([t,ic,l])=>(
          <button key={t} onClick={()=>setTab(t)} className={`tb ${tab===t?"on":""}`}>
            <span style={{fontSize:21}}>{ic}</span>{l}
          </button>
        ))}
      </div>

      {/* ═══ SHEETS ═══ */}
      {settings  && <SettingsSheet state={state} saveNow={saveNow} syncStatus={syncStatus}
                      bankConnected={bankConnected}
                      miscategorized={miscategorizedDeposits}
                      onFixDeposits={()=>{ fixAllDeposits(); setSettings(false); }}
                      onDisconnectBank={async()=>{ await api("/api/disconnect_bank"); setBankConnected(false); setAccounts([]); showToast("Bank disconnected"); }}
                      onLogout={logout} onClose={()=>setSettings(false)} onToast={showToast} />}
      {editEnv   && <EnvelopeForm initial={editEnv} onSave={saveEnvelope} onCancel={()=>setEditEnv(null)} />}
      {detailEnv && <EnvelopeDetail env={envelopes.find(e=>e.id===detailEnv.id) || detailEnv}
                      transactions={transactions}
                      dataSince={state.importSince || "2026-07-14"}
                      onClose={()=>setDetailEnv(null)}
                      onEdit={()=>{ setEditEnv(detailEnv); setDetailEnv(null); }}
                      onDelete={()=>deleteEnvelope(detailEnv.id)}
                      onFund={()=>{ setFundEnv(detailEnv); setDetailEnv(null); }}
                      onMarkPaid={()=>markPaid(detailEnv)}
                      onMarkPeriodPaid={markPeriodPaid}
                      onUnmarkPeriod={unmarkPaid}
                      onUpdateAmount={updateBillAmount}
                      onToggleAutoAmount={toggleAutoAmount} />}
      {fundEnv   && <FundSheet env={envelopes.find(e=>e.id===fundEnv.id)} sts={sts} transactions={transactions}
                      onFund={a=>{fund(fundEnv.id,a); setFundEnv(null);}}
                      onUnfund={a=>{unfund(fundEnv.id,a); setFundEnv(null);}}
                      onClose={()=>setFundEnv(null)} />}
      {mapTx     && <AssignSheet tx={mapTx} envelopes={envelopes}
                      onAssign={assignTx}
                      onSkip={()=>{
                        // A skipped credit is income — keep it in the record so
                        // earnings history stays complete. A skipped debit was
                        // never a budget item, so it just leaves the queue.
                        setState(s => ({
                          ...s,
                          unmapped: s.unmapped.filter(t => t.id !== mapTx.id),
                          transactions: mapTx.amount <= 0
                            ? [{ ...mapTx, envelopeId: null, kind: "deposit", likelyRefund: undefined }, ...s.transactions]
                            : s.transactions,
                        }));
                        setMapTx(null);
                      }}
                      onClose={()=>setMapTx(null)} />}
      {txDetail  && <TransactionDetail tx={txDetail} envelopes={envelopes}
                      onMove={moveTransaction}
                      onRequeue={requeueTransaction}
                      onDelete={deleteTransaction}
                      onSetPeriod={setTransactionPeriod}
                      onConvertToDeposit={convertToDeposit}
                      onClose={()=>setTxDetail(null)} />}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// ENVELOPE ICON — real logo when we have one, emoji when we don't.
//
// Three sources, in order:
//   1. env.logoUrl   — a logo Plaid gave us, or one you pasted in
//   2. env.website   — we derive a favicon from the domain
//   3. env.icon      — your emoji, which always works
//
// The emoji is the floor, not a placeholder. Logos fail: domains change, CDNs
// 404, favicons come back as a blank square. Every failure falls through to the
// emoji rather than leaving a broken-image icon sitting in your budget.
// ═════════════════════════════════════════════════════════════════════════════
function domainOf(raw) {
  if (!raw) return null;
  let s = String(raw).trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
  s = s.split("/")[0].split("?")[0];
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(s) ? s : null;
}

function logoSrcFor(env) {
  if (env?.logoUrl) return env.logoUrl;
  const d = domainOf(env?.website);
  // Google's favicon service — no API key, no signup, works for essentially
  // every company that has a website.
  return d ? `https://www.google.com/s2/favicons?domain=${d}&sz=128` : null;
}

function EnvIcon({ env, size = 36, radius = 10, bg, style }) {
  const [failed, setFailed] = useState(false);
  const src = failed ? null : logoSrcFor(env);
  const fontSize = Math.round(size * 0.48);

  return (
    <div style={{
      width:size, height:size, borderRadius:radius, flexShrink:0,
      display:"flex", alignItems:"center", justifyContent:"center",
      fontSize, overflow:"hidden",
      background: bg !== undefined ? bg : (env?.color ? env.color + "22" : "#2c2c2e"),
      ...style,
    }}>
      {src ? (
        <img src={src} alt="" onError={()=>setFailed(true)}
          style={{width:"72%",height:"72%",objectFit:"contain",borderRadius:4}}/>
      ) : (env?.icon || "💸")}
    </div>
  );
}
// ═════════════════════════════════════════════════════════════════════════════
// ENVELOPE TRANSACTIONS — the list that has to add up.
//
// The old version showed "the 10 most recent, any month" next to a total that
// meant "everything this month." Two different questions, one screen, numbers
// that couldn't reconcile. If a total is on screen, you should be able to count
// the rows and arrive at it.
//
// So: this month's transactions in full, with the sum stated at the bottom, and
// anything older tucked behind a toggle. Refunds are shown but marked, since
// they deliberately don't reduce spending.
// ═════════════════════════════════════════════════════════════════════════════
function EnvelopeTransactions({ env, transactions }) {
  const [showEarlier, setShowEarlier] = useState(false);

  const mine = transactions
    .filter(t => t.envelopeId === env.id)
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  if (!mine.length) return null;

  const now = new Date();
  const m = now.getMonth(), y = now.getFullYear();
  const inThisMonth = t => {
    const d = new Date(t.date + "T00:00:00");
    return d.getMonth() === m && d.getFullYear() === y;
  };

  const thisMonth = mine.filter(inThisMonth);
  const earlier   = mine.filter(t => !inThisMonth(t));

  const outflows = thisMonth.filter(t => t.amount > 0);
  const refunds  = thisMonth.filter(t => t.amount <= 0);
  const gross    = outflows.reduce((s, t) => s + t.amount, 0);
  const returned = refunds.reduce((s, t) => s + Math.abs(t.amount), 0);
  const total    = gross - returned;

  const monthLabel = now.toLocaleDateString("en-US", { month: "long" });

  const Row = ({ t, dim }) => {
    const isIn = t.amount <= 0;
    return (
      <div className="row" style={{padding:"11px 14px",opacity:dim?.6:1}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:14,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.desc}</div>
          <div style={{fontSize:11.5,color:"#636366",marginTop:1}}>
            {new Date(t.date+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}
            {isIn && " · refund"}
          </div>
        </div>
        <div style={{fontSize:14,fontWeight:600,color:isIn?"#30d158":"#aeaeb2"}}>
          {isIn ? `+${money(Math.abs(t.amount))}` : `−${money(t.amount)}`}
        </div>
      </div>
    );
  };

  return (
    <>
      <Label style={{marginTop:14}}>
        {monthLabel} · {thisMonth.length} transaction{thisMonth.length===1?"":"s"}
      </Label>

      {thisMonth.length === 0 ? (
        <div className="card" style={{padding:16,marginBottom:12,fontSize:13,color:"#636366",textAlign:"center"}}>
          Nothing yet this month.
        </div>
      ) : (
        <div className="grp" style={{marginBottom:12}}>
          {outflows.map(t => <Row key={t.id} t={t} />)}
          {refunds.map(t => <Row key={t.id} t={t} />)}
          {returned > 0 && (
            <div className="row" style={{padding:"10px 14px"}}>
              <div style={{flex:1,fontSize:12.5,color:"#636366"}}>Spent {money(gross)}, refunded {money(returned)}</div>
            </div>
          )}
          <div className="row" style={{padding:"12px 14px",background:"rgba(255,255,255,.03)"}}>
            <div style={{flex:1,fontSize:13.5,fontWeight:600,color:"#8e8e93"}}>
              Net spent in {monthLabel}
            </div>
            <div style={{fontSize:15,fontWeight:700,letterSpacing:"-.3px"}}>{money(total)}</div>
          </div>
        </div>
      )}

      {earlier.length > 0 && (
        !showEarlier ? (
          <button className="btn-dim" style={{marginBottom:12,fontSize:13.5}}
            onClick={()=>setShowEarlier(true)}>
            Show {earlier.length} earlier transaction{earlier.length===1?"":"s"}
          </button>
        ) : (
          <>
            <Label>Earlier</Label>
            <div className="grp" style={{marginBottom:12}}>
              {earlier.slice(0,50).map(t => <Row key={t.id} t={t} dim />)}
            </div>
            {earlier.length > 50 && (
              <div style={{fontSize:11.5,color:"#48484a",textAlign:"center",marginBottom:12}}>
                Showing the 50 most recent of {earlier.length}
              </div>
            )}
            <button className="btn-dim" style={{marginBottom:12,fontSize:13.5}}
              onClick={()=>setShowEarlier(false)}>Hide earlier</button>
          </>
        )
      )}
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// INCOME VIEW — what actually landed.
//
// Built for variable income specifically. A salaried person needs one number;
// someone driving needs to know the shape: what's typical, how wide the swing
// is, and whether this month is tracking ahead or behind. The averages exclude
// the current partial month and week, because comparing a half-finished July
// against complete months would understate every single time you looked.
// ═════════════════════════════════════════════════════════════════════════════
function IncomeView({ transactions, onOpenTx }) {
  const [monthKey, setMonthKey] = useState(null);   // null = current month

  const months = useMemo(() => incomeByMonth(transactions, 6), [transactions]);
  const weeks  = useMemo(() => incomeByWeek(transactions, 8), [transactions]);
  const stats  = useMemo(() => incomeStats(transactions), [transactions]);
  const income = useMemo(() => incomeTransactions(transactions), [transactions]);

  const activeKey = monthKey || months[0]?.key;
  const activeMonth = months.find(m => m.key === activeKey) || months[0];
  const sources = useMemo(() => incomeBySource(transactions, activeKey), [transactions, activeKey]);
  const monthTx = income.filter(t => (t.date || "").slice(0,7) === activeKey);

  if (!income.length) {
    return (
      <div className="card" style={{padding:28,textAlign:"center"}}>
        <div style={{fontSize:34,marginBottom:10}}>⬇</div>
        <div style={{fontSize:15,fontWeight:600,marginBottom:4}}>No income recorded yet</div>
        <div style={{fontSize:13,color:"#636366",lineHeight:1.55}}>
          Deposits you don't assign to an envelope land here. Sync your bank and any
          payouts will start showing up.
        </div>
      </div>
    );
  }

  const maxMonth = Math.max(...months.map(m => m.total), 1);
  const maxWeek  = Math.max(...weeks.map(w => w.total), 1);

  return (
    <>
      {/* Headline */}
      <div className="card" style={{padding:"18px 18px 16px",marginBottom:14}}>
        <div style={{fontSize:11.5,color:"#8e8e93",fontWeight:600,textTransform:"uppercase",letterSpacing:".5px"}}>
          Earned in {activeMonth?.label.split(" ")[0]}
        </div>
        <div style={{fontSize:38,fontWeight:700,letterSpacing:"-1.8px",color:"#30d158",lineHeight:1.1,marginTop:3}}>
          {money(activeMonth?.total || 0)}
        </div>
        {stats.monthsTracked > 0 && activeMonth?.isCurrent && (
          <div style={{fontSize:12.5,color:"#8e8e93",marginTop:5,lineHeight:1.5}}>
            {stats.thisMonth >= stats.avgMonth
              ? `${money(stats.thisMonth - stats.avgMonth)} above your ${money(stats.avgMonth)} average`
              : `${money(stats.avgMonth - stats.thisMonth)} below your ${money(stats.avgMonth)} average — month may not be done`}
          </div>
        )}
      </div>

      {/* Month bars — tap to switch */}
      <div className="card" style={{padding:16,marginBottom:14}}>
        <div style={{fontSize:12.5,fontWeight:600,color:"#8e8e93",marginBottom:14}}>By month</div>
        <div style={{display:"flex",alignItems:"flex-end",gap:8,height:96}}>
          {months.slice().reverse().map(m => {
            const on = m.key === activeKey;
            const h = Math.max(3, (m.total / maxMonth) * 76);
            return (
              <button key={m.key} onClick={()=>setMonthKey(m.key)}
                style={{flex:1,background:"none",border:"none",padding:0,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:6,height:"100%",justifyContent:"flex-end"}}>
                <div style={{fontSize:9.5,color:on?"#30d158":"#48484a",fontWeight:600}}>
                  {m.total>0 ? Math.round(m.total) : ""}
                </div>
                <div style={{width:"100%",height:h,borderRadius:5,
                  background:on?"linear-gradient(180deg,#30d158,#1f8f3c)":"#2c2c2e"}}/>
                <div style={{fontSize:10,color:on?"#fff":"#636366",fontWeight:on?600:400}}>{m.shortLabel}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Where it came from */}
      {sources.length > 0 && (
        <>
          <div className="sec">Sources · {activeMonth?.label}</div>
          <div className="grp" style={{marginBottom:14}}>
            {sources.map(s => {
              const pct = activeMonth?.total > 0 ? (s.total / activeMonth.total) * 100 : 0;
              return (
                <div key={s.key} className="row" style={{padding:"12px 14px",flexDirection:"column",alignItems:"stretch",gap:7}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:14.5,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.name}</div>
                      <div style={{fontSize:11.5,color:"#636366",marginTop:1}}>{s.count} deposit{s.count===1?"":"s"} · {Math.round(pct)}%</div>
                    </div>
                    <div style={{fontSize:15,fontWeight:700,color:"#30d158",letterSpacing:"-.3px"}}>{money(s.total)}</div>
                  </div>
                  <div className="bar"><div className="fill" style={{width:`${pct}%`,background:"#30d158"}}/></div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Weekly rhythm — the number that matters when income varies */}
      {stats.weeksTracked >= 2 && (
        <>
          <div className="sec">Weekly rhythm</div>
          <div className="card" style={{padding:16,marginBottom:14}}>
            <div style={{display:"flex",gap:14,marginBottom:14}}>
              <div style={{flex:1}}>
                <div style={{fontSize:11,color:"#8e8e93",marginBottom:2}}>Typical week</div>
                <div style={{fontSize:17,fontWeight:700,letterSpacing:"-.4px"}}>{money(stats.avgWeek)}</div>
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:11,color:"#8e8e93",marginBottom:2}}>Best</div>
                <div style={{fontSize:17,fontWeight:700,color:"#30d158",letterSpacing:"-.4px"}}>{money(stats.bestWeek)}</div>
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:11,color:"#8e8e93",marginBottom:2}}>Leanest</div>
                <div style={{fontSize:17,fontWeight:700,color:"#ff9f0a",letterSpacing:"-.4px"}}>{money(stats.leanWeek)}</div>
              </div>
            </div>
            <div style={{display:"flex",alignItems:"flex-end",gap:5,height:52,marginBottom:10}}>
              {weeks.slice().reverse().map((w,i) => (
                <div key={i} style={{flex:1,height:Math.max(3,(w.total/maxWeek)*48),borderRadius:4,
                  background:w.isCurrent?"#30d158":"#2c2c2e"}} title={`${w.label}: ${money(w.total)}`}/>
              ))}
            </div>
            {stats.swing > 0.6 && (
              <div style={{fontSize:12,color:"#8e8e93",lineHeight:1.55,paddingTop:10,borderTop:".5px solid rgba(255,255,255,.07)"}}>
                Your weeks swing a lot — best to leanest is a {money(stats.bestWeek - stats.leanWeek)} spread.
                Funding bills off a lean week rather than a good one is the safer habit.
              </div>
            )}
          </div>
        </>
      )}

      {/* The deposits themselves */}
      <div className="sec">Deposits · {activeMonth?.label}</div>
      {monthTx.length === 0 ? (
        <div className="card" style={{padding:20,textAlign:"center",fontSize:13,color:"#636366"}}>
          Nothing recorded this month.
        </div>
      ) : (
        <div className="grp">
          {monthTx.map(t => (
            <button key={t.id} className="row row-tap" onClick={()=>onOpenTx(t)}
              style={{width:"100%",textAlign:"left",background:"none",border:"none",fontFamily:"inherit",color:"#fff"}}>
              <div className="ibox" style={{background:"#30d15822",color:"#30d158"}}>⬇</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:14.5,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.desc}</div>
                <div style={{fontSize:11.5,color:"#636366",marginTop:1}}>
                  {new Date(t.date+"T00:00:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})}
                </div>
              </div>
              <div style={{fontSize:15,fontWeight:700,color:"#30d158"}}>+{money(Math.abs(t.amount))}</div>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// TRANSACTION DETAIL — move, re-queue, or delete a sorted transaction
// ═════════════════════════════════════════════════════════════════════════════
function TransactionDetail({ tx, envelopes, onMove, onRequeue, onDelete, onSetPeriod, onConvertToDeposit, onClose }) {
  const [moving, setMoving] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const env = envelopes.find(e => e.id === tx.envelopeId);
  const isDeposit = tx.amount <= 0 || tx.kind === "deposit";

  return (
    <Sheet onClose={onClose} title={null}>
      <div style={{textAlign:"center",marginBottom:20}}>
        <div style={{display:"flex",justifyContent:"center",marginBottom:10}}>
          {isDeposit
            ? <div style={{fontSize:44}}>⬇</div>
            : <EnvIcon env={env} size={52} radius={14} />}
        </div>
        <div style={{fontSize:20,fontWeight:700,letterSpacing:"-.5px"}}>{tx.desc}</div>
        <div style={{fontSize:26,fontWeight:700,letterSpacing:"-1px",marginTop:6,color:isDeposit?"#30d158":"#fff"}}>
          {isDeposit?`+${money(Math.abs(tx.amount))}`:`−${money(tx.amount)}`}
        </div>
        <div style={{fontSize:13,color:"#8e8e93",marginTop:6}}>
          {tx.date}{tx.type==="bank"?" · from bank":""}
        </div>
        {!isDeposit && (
          <div style={{display:"inline-block",marginTop:10,background:env?env.color+"22":"#2c2c2e",color:env?env.color:"#8e8e93",borderRadius:20,padding:"5px 14px",fontSize:13,fontWeight:600}}>
            {env ? env.name : "Unassigned"}
          </div>
        )}
      </div>

      {isDeposit && !env ? (
        !moving ? (
          <>
            <div className="card" style={{padding:16,marginBottom:8,fontSize:13,color:"#8e8e93",lineHeight:1.55,textAlign:"center"}}>
              Treated as income. It's already in your checking balance, so it isn't
              subtracted from any envelope.
            </div>
            <button className="btn-dim" style={{marginBottom:8}} onClick={()=>setMoving(true)}>
              This was a refund — assign it
            </button>
          </>
        ) : (
          <div className="card" style={{padding:14,marginBottom:8}}>
            <div style={{fontSize:13,color:"#8e8e93",marginBottom:4}}>Refund from…</div>
            <div style={{fontSize:11.5,color:"#636366",marginBottom:10,lineHeight:1.5}}>
              This will subtract from what you've spent in that envelope.
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:7}}>
              {envelopes.map(e => (
                <button key={e.id} onClick={()=>onMove(tx, e.id)}
                  style={{background:"#2c2c2e",border:"none",borderRadius:12,padding:"11px 14px",display:"flex",alignItems:"center",gap:11,cursor:"pointer",fontFamily:"inherit",color:"#fff"}}>
                  <EnvIcon env={e} size={30} radius={8} bg="transparent" />
                  <div style={{flex:1,textAlign:"left"}}>
                    <div style={{fontSize:15,fontWeight:500}}>{e.name}</div>
                    <div style={{fontSize:12,color:"#8e8e93"}}>{TYPE_META[e.type].label}</div>
                  </div>
                  <span style={{color:"#48484a",fontSize:17}}>›</span>
                </button>
              ))}
            </div>
            <button className="btn-dim" style={{marginTop:10}} onClick={()=>setMoving(false)}>Cancel</button>
          </div>
        )
      ) : !moving ? (
        <>
          {/* Which billing period is this payment for? */}
          {env && isBill(env.type) && (() => {
            const options = dueDateOptions(env, tx.date);
            if (!options.length) return null;
            const currentKey = periodDueForTx(env, tx).toISOString().split("T")[0];
            const auto = !tx.periodOverride;
            return (
              <div className="card" style={{padding:14,marginBottom:8}}>
                <div style={{fontSize:13,fontWeight:600,marginBottom:3}}>Which bill is this for?</div>
                <div style={{fontSize:11.5,color:"#8e8e93",lineHeight:1.5,marginBottom:10}}>
                  {auto
                    ? "Matched automatically to the nearest due date. Change it if that's not right."
                    : "You set this manually."}
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {options.map(d => {
                    const k = d.toISOString().split("T")[0];
                    const on = k === currentKey;
                    return (
                      <button key={k} onClick={()=>onSetPeriod(tx, on && !auto ? null : k)}
                        style={{background:on?"#c5f13518":"#2c2c2e",border:on?"1px solid #c5f135":"1px solid transparent",
                                borderRadius:11,padding:"10px 13px",display:"flex",alignItems:"center",gap:10,
                                cursor:"pointer",fontFamily:"inherit",color:"#fff",textAlign:"left"}}>
                        <div style={{width:18,height:18,borderRadius:9,flexShrink:0,border:on?"5px solid #c5f135":"1.5px solid #48484a"}}/>
                        <div style={{flex:1}}>
                          <div style={{fontSize:14,fontWeight:500,color:on?"#c5f135":"#fff"}}>
                            {d.toLocaleDateString("en-US",{month:"long",year:"numeric"})}
                          </div>
                          <div style={{fontSize:11,color:"#8e8e93",marginTop:1}}>
                            due {d.toLocaleDateString("en-US",{month:"short",day:"numeric"})}
                            {on && auto ? " · auto-matched" : ""}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
                {!auto && (
                  <button className="btn-mini" style={{marginTop:9,width:"100%",color:"#8e8e93"}}
                    onClick={()=>onSetPeriod(tx, null)}>
                    Back to automatic
                  </button>
                )}
              </div>
            );
          })()}
          <button className="btn-dim" style={{marginBottom:8}} onClick={()=>setMoving(true)}>Move to another envelope</button>
        </>
      ) : (
        <div className="card" style={{padding:14,marginBottom:8}}>
          <div style={{fontSize:13,color:"#8e8e93",marginBottom:10}}>Move to…</div>
          <div style={{display:"flex",flexDirection:"column",gap:7}}>
            {envelopes.filter(e => e.id !== tx.envelopeId).map(e => (
              <button key={e.id} onClick={()=>onMove(tx, e.id)}
                style={{background:"#2c2c2e",border:"none",borderRadius:12,padding:"11px 14px",display:"flex",alignItems:"center",gap:11,cursor:"pointer",fontFamily:"inherit",color:"#fff"}}>
                <EnvIcon env={e} size={30} radius={8} bg="transparent" />
                <div style={{flex:1,textAlign:"left"}}>
                  <div style={{fontSize:15,fontWeight:500}}>{e.name}</div>
                  <div style={{fontSize:12,color:"#8e8e93"}}>{TYPE_META[e.type].label}</div>
                </div>
                <span style={{color:"#48484a",fontSize:17}}>›</span>
              </button>
            ))}
          </div>
          <button className="btn-dim" style={{marginTop:10}} onClick={()=>setMoving(false)}>Cancel</button>
        </div>
      )}

      {!isDeposit && (
        <button className="btn-dim" style={{marginBottom:8}} onClick={()=>onRequeue(tx)}>
          Send back to sort queue
        </button>
      )}

      {!isDeposit && (
        <button className="btn-dim" style={{marginBottom:8}} onClick={()=>onConvertToDeposit(tx)}>
          This is income, not a charge
        </button>
      )}

      {!confirmDel ? (
        <button className="btn-dim" style={{color:"#ff375f"}} onClick={()=>setConfirmDel(true)}>Delete transaction</button>
      ) : (
        <div>
          <div style={{fontSize:12,color:"#8e8e93",lineHeight:1.5,margin:"4px 2px 8px",textAlign:"center"}}>
            Reverses its effect on any envelope and stops it returning on the next sync.
          </div>
          <button className="btn-dim" style={{background:"#ff375f",color:"#fff"}} onClick={()=>onDelete(tx)}>
            Really delete?
          </button>
        </div>
      )}
    </Sheet>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// SYNC INDICATOR — a quiet dot. You should be able to trust it without watching it.
// ═════════════════════════════════════════════════════════════════════════════
function SyncDot({ status }) {
  const map = {
    idle:    { c: "#30d158", t: "Synced" },
    loading: { c: "#8e8e93", t: "Loading…" },
    saving:  { c: "#ffd60a", t: "Saving…" },
    saved:   { c: "#30d158", t: "Saved" },
    error:   { c: "#ff375f", t: "Offline — saved on this device only" },
  };
  const s = map[status] || map.idle;
  return (
    <span title={s.t} style={{display:"inline-flex",alignItems:"center",gap:4}}>
      <span style={{width:6,height:6,borderRadius:3,background:s.c,display:"inline-block",
                    animation: status==="saving"||status==="loading" ? "pulse 1s infinite" : "none"}}/>
      {status === "error" && <span style={{fontSize:10,color:"#ff375f"}}>offline</span>}
    </span>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// SETTINGS — backup, restore, bank, lock
// ═════════════════════════════════════════════════════════════════════════════
function SettingsSheet({ state, saveNow, syncStatus, bankConnected, miscategorized, onFixDeposits, onDisconnectBank, onLogout, onClose, onToast }) {
  const [restoring, setRestoring] = useState(false);
  const [json, setJson] = useState("");
  const [confirmWipe, setConfirmWipe] = useState(false);

  function exportBackup() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `budgetgum-backup-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    onToast("Backup downloaded");
  }

  async function doRestore() {
    let parsed;
    try {
      parsed = JSON.parse(json);
    } catch {
      onToast("That's not valid JSON");
      return;
    }
    if (!Array.isArray(parsed.envelopes)) {
      onToast("No envelopes found in that backup");
      return;
    }
    await saveNow({ ...EMPTY_STATE, ...parsed });
    onToast(`Restored ${parsed.envelopes.length} envelopes`);
    setRestoring(false);
    setJson("");
    onClose();
  }

  async function wipe() {
    await saveNow(EMPTY_STATE);
    onToast("Everything cleared");
    onClose();
  }

  const importSince = state.importSince || "2026-07-14";
  function setImportSince(v) {
    saveNow({ ...state, importSince: v });
    onToast("Import date updated");
  }

  // Empty the whole sort queue — the unassigned transactions waiting to be
  // filed. This doesn't touch already-sorted transactions or envelope balances;
  // it just discards the backlog of things you never assigned.
  function clearQueue() {
    saveNow({ ...state, unmapped: [] });
    onToast("Sort queue cleared");
  }

  // Drop only the queue items dated before the import cutoff — keeps anything
  // legitimately recent, clears the old backfill.
  function clearOldQueue() {
    const kept = (state.unmapped || []).filter(t => t.date >= importSince);
    const removed = (state.unmapped || []).length - kept.length;
    saveNow({ ...state, unmapped: kept });
    onToast(`Cleared ${removed} old — ${kept.length} kept`);
  }

  return (
    <Sheet onClose={onClose} title="Settings">
      <div className="grp" style={{marginBottom:14}}>
        <div className="row" style={{justifyContent:"space-between"}}>
          <span style={{fontSize:14.5,color:"#8e8e93"}}>Sync</span>
          <span style={{fontSize:14.5,fontWeight:600,color:syncStatus==="error"?"#ff375f":"#30d158"}}>
            {syncStatus==="error" ? "Offline" : "On"}
          </span>
        </div>
        <div className="row" style={{justifyContent:"space-between"}}>
          <span style={{fontSize:14.5,color:"#8e8e93"}}>Envelopes</span>
          <span style={{fontSize:14.5,fontWeight:600}}>{state.envelopes.length}</span>
        </div>
        <div className="row" style={{justifyContent:"space-between"}}>
          <span style={{fontSize:14.5,color:"#8e8e93"}}>Transactions</span>
          <span style={{fontSize:14.5,fontWeight:600}}>{state.transactions.length}</span>
        </div>
      </div>

      {/* Repair for transactions imported before the sign fix */}
      {miscategorized.length > 0 && (
        <div className="grp" style={{marginBottom:8,padding:"13px 15px",border:"1px solid #ffd60a33"}}>
          <div style={{fontSize:14.5,fontWeight:600,marginBottom:3}}>
            {miscategorized.length} deposit{miscategorized.length===1?"":"s"} recorded as charges
          </div>
          <div style={{fontSize:12,color:"#8e8e93",lineHeight:1.5,marginBottom:10}}>
            These match merchants you already receive income from, but were imported before
            deposits were handled correctly. Moving them fixes your income totals and undoes
            any effect they had on envelopes.
          </div>
          <div style={{marginBottom:10}}>
            {miscategorized.slice(0,5).map(t=>(
              <div key={t.id} style={{display:"flex",justifyContent:"space-between",fontSize:12,color:"#aeaeb2",padding:"3px 0"}}>
                <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginRight:8}}>{t.desc}</span>
                <span style={{flexShrink:0}}>{t.date}</span>
              </div>
            ))}
            {miscategorized.length>5 && (
              <div style={{fontSize:11.5,color:"#636366",marginTop:3}}>+{miscategorized.length-5} more</div>
            )}
          </div>
          <button className="btn-mini" style={{background:"#c5f135",color:"#000",width:"100%"}}
            onClick={onFixDeposits}>
            Move {miscategorized.length} to income
          </button>
        </div>
      )}

      {/* Auto-lock */}
      <div className="grp" style={{marginBottom:8,padding:"13px 15px"}}>
        <div style={{fontSize:14.5,fontWeight:600,marginBottom:3}}>Lock automatically after</div>
        <div style={{fontSize:12,color:"#8e8e93",lineHeight:1.5,marginBottom:10}}>
          Signs you out when you stop using it, so your balances aren't sitting on screen.
        </div>
        <div style={{display:"flex",gap:6}}>
          {[[5,"5m"],[10,"10m"],[30,"30m"],[60,"1h"],[0,"Never"]].map(([m,label])=>{
            const on = (state.autoLockMinutes ?? 10) === m;
            return (
              <button key={m} onClick={()=>{ saveNow({...state, autoLockMinutes:m}); onToast(m===0?"Auto-lock off":`Locks after ${label}`); }}
                style={{flex:1,background:on?"#c5f135":"#2c2c2e",color:on?"#000":"#fff",border:"none",
                        borderRadius:9,padding:"9px 0",fontSize:12.5,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Import cutoff — only pull transactions on/after this date */}
      <div className="grp" style={{marginBottom:8,padding:"13px 15px"}}>
        <div style={{fontSize:14.5,fontWeight:600,marginBottom:3}}>Import transactions from</div>
        <div style={{fontSize:12,color:"#8e8e93",lineHeight:1.5,marginBottom:10}}>
          Bank syncs skip anything before this date, so old history won't land in envelopes you just made.
        </div>
        <input className="in" type="date" value={importSince}
          onChange={e=>setImportSince(e.target.value)} />
      </div>

      {/* Sort queue cleanup */}
      {(state.unmapped || []).length > 0 && (
        <div className="grp" style={{marginBottom:8,padding:"13px 15px"}}>
          <div style={{fontSize:14.5,fontWeight:600,marginBottom:3}}>
            Sort queue · {(state.unmapped || []).length}
          </div>
          <div style={{fontSize:12,color:"#8e8e93",lineHeight:1.5,marginBottom:10}}>
            Unassigned transactions waiting to be filed. Clearing them doesn't affect
            envelope balances or anything you've already sorted.
          </div>
          <button className="btn-dim" style={{marginBottom:8}} onClick={clearOldQueue}>
            Clear ones before {importSince}
          </button>
          <button className="btn-dim" style={{color:"#ff375f"}} onClick={clearQueue}>
            Clear all {(state.unmapped || []).length}
          </button>
        </div>
      )}

      <div style={{fontSize:12,color:"#636366",lineHeight:1.55,marginBottom:14,padding:"0 2px"}}>
        Your budget is stored on the server and syncs across every device you sign into.
        Download a backup anyway — it costs nothing and it's yours.
      </div>

      <button className="btn-dim" style={{marginBottom:8}} onClick={exportBackup}>Download backup</button>

      {!restoring ? (
        <button className="btn-dim" style={{marginBottom:8}} onClick={()=>setRestoring(true)}>Restore from backup</button>
      ) : (
        <div className="card" style={{padding:14,marginBottom:8}}>
          <div style={{fontSize:13,color:"#8e8e93",marginBottom:8,lineHeight:1.5}}>
            Paste a backup JSON. This <strong style={{color:"#ff9f0a"}}>replaces everything</strong> currently in the app.
          </div>
          <textarea value={json} onChange={e=>setJson(e.target.value)} placeholder='{"envelopes":[...]}'
            style={{background:"#2c2c2e",border:"none",color:"#fff",borderRadius:10,padding:12,width:"100%",height:120,
                    fontFamily:"ui-monospace,monospace",fontSize:11.5,resize:"vertical",outline:"none",marginBottom:8}}/>
          <div style={{display:"flex",gap:8}}>
            <button className="btn-dim" style={{flex:1}} onClick={()=>{setRestoring(false);setJson("");}}>Cancel</button>
            <button className="btn-green" style={{flex:1,fontSize:14,padding:13}} onClick={doRestore} disabled={!json.trim()}>Restore</button>
          </div>
        </div>
      )}

      {bankConnected && (
        <button className="btn-dim" style={{marginBottom:8}} onClick={onDisconnectBank}>Disconnect bank</button>
      )}

      <button className="btn-dim" style={{marginBottom:8}} onClick={onLogout}>Lock app</button>

      {!confirmWipe ? (
        <button className="btn-dim" style={{color:"#ff375f"}} onClick={()=>setConfirmWipe(true)}>Erase all data</button>
      ) : (
        <button className="btn-dim" style={{background:"#ff375f",color:"#fff"}} onClick={wipe}>
          Really erase everything?
        </button>
      )}
    </Sheet>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// (Components below are unchanged from v2)
// ═════════════════════════════════════════════════════════════════════════════

function EmptyState({ onAdd }) {
  return (
    <div className="card" style={{padding:"36px 24px",textAlign:"center"}}>
      <div style={{fontSize:44,marginBottom:14}}>✉️</div>
      <div style={{fontSize:18,fontWeight:700,letterSpacing:"-.4px",marginBottom:6}}>No envelopes yet</div>
      <div style={{fontSize:14,color:"#636366",lineHeight:1.55,marginBottom:20}}>
        Start with one. A credit card you're paying down, a bill that repeats, or just a grocery budget.
      </div>
      <button className="btn-green" onClick={onAdd}>Create Your First Envelope</button>
    </div>
  );
}

function EnvCard({ env, transactions, onClick }) {
  const locked = isLocked(env, transactions);
  const paid = isPaid(env, transactions);
  let big, small, pct, barColor;
  if (env.type === TYPES.SPENDING) {
    const spent = spentThisMonth(env, transactions);
    const left = (env.monthlyBudget||0) - spent;
    big = money(left); small = `of ${money(env.monthlyBudget)}`;
    pct = Math.min(100, (spent/(env.monthlyBudget||1))*100);
    barColor = pct>90?"#ff375f":pct>70?"#ffd60a":env.color;
  } else if (env.type === TYPES.DEBT) {
    big = money(env.currentBalance||0); small = "still owed";
    pct = progress(env); barColor = "#30d158";
  } else if (env.type === TYPES.GOAL) {
    big = money(env.currentBalance||0); small = `of ${money(env.targetAmount)}`;
    pct = progress(env); barColor = env.color;
  } else {
    big = money(env.billAmount||0); small = paid ? "paid" : "due";
    pct = paid?100:Math.min(100,((env.funded||0)/(env.billAmount||1))*100);
    barColor = paid?"#30d158":env.color;
  }
  return (
    <button className="card env-card" onClick={onClick}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
        <EnvIcon env={env} size={34} radius={9} bg="transparent" />
        <div style={{display:"flex",gap:3}}>
          {locked && <span style={{fontSize:13}}>🔒</span>}
          {paid && <span style={{fontSize:13,color:"#30d158"}}>✓</span>}
        </div>
      </div>
      <div style={{fontSize:12,color:"#636366",fontWeight:500,marginBottom:2}}>{env.name}</div>
      <div style={{fontSize:20,fontWeight:700,letterSpacing:"-.9px",lineHeight:1.1}}>{big}</div>
      <div style={{fontSize:11,color:"#48484a",marginBottom:9}}>{small}</div>
      <div className="bar"><div className="fill" style={{width:`${pct}%`,background:barColor}}/></div>
      {(env.funded||0) > 0 && (
        <div style={{fontSize:10,color:locked?"#ffd60a":"#8e8e93",marginTop:6}}>
          {locked ? "🔒 " : ""}{money(env.funded)} set aside
        </div>
      )}
    </button>
  );
}

function EnvRow({ env, transactions, onOpen, onFund }) {
  const locked = isLocked(env, transactions);
  const paid = isPaid(env, transactions);
  const short = shortfall(env, transactions);
  const due = nextDueDate(env);
  return (
    <div className="card" style={{padding:16}}>
      <div style={{display:"flex",alignItems:"center",gap:12,cursor:"pointer"}} onClick={onOpen}>
        <EnvIcon env={env} size={42} radius={12} bg={env.color+"22"} style={{border:`1px solid ${env.color}33`}} />
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <span style={{fontSize:16,fontWeight:600,letterSpacing:"-.3px"}}>{env.name}</span>
            {locked && <span style={{fontSize:12}}>🔒</span>}
            {paid && <span style={{fontSize:12,color:"#30d158"}}>✓</span>}
          </div>
          <div style={{fontSize:12,color:"#636366",marginTop:2}}>
            {TYPE_META[env.type].label}
            {isBill(env.type) && due && ` · due ${due.toLocaleDateString("en-US",{month:"short",day:"numeric"})}`}
            {env.autopay && " · autopay"}
          </div>
        </div>
        <span style={{color:"#48484a",fontSize:18}}>›</span>
      </div>
      {isBill(env.type) && !paid && (
        <div style={{marginTop:12,paddingTop:12,borderTop:".5px solid rgba(255,255,255,.07)"}}>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:6}}>
            <span style={{color:"#8e8e93"}}>Funded {money(env.funded||0)} / {money(targetAmount(env))}</span>
            {short>0 && <span style={{color:"#ffd60a",fontWeight:600}}>{money(short)} short</span>}
          </div>
          <div className="bar" style={{marginBottom:10}}>
            <div className="fill" style={{width:`${Math.min(100,((env.funded||0)/(targetAmount(env)||1))*100)}%`,background:short>0?"#ffd60a":"#30d158"}}/>
          </div>
          <button className="btn-dim" style={{padding:10,fontSize:14}} onClick={onFund} disabled={locked}>
            {locked ? "🔒 Locked" : "Fund"}
          </button>
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// BILLS VIEW — today up top, unpaid grouped by month, then a paid archive.
// The whole point: no bill is ever in an ambiguous state.
// ═════════════════════════════════════════════════════════════════════════════
function BillsView({ bills, transactions, dataSince, onOpen, onMarkPaid }) {
  const today = new Date();
  const todayStr = today.toLocaleDateString("en-US", { weekday:"long", month:"long", day:"numeric" });

  const allUnpaid = bills.filter(b => !isPaid(b, transactions))
    .map(b => ({ env: b, due: nextDueDate(b), overdue: overdueInfo(b, transactions, dataSince) }))
    .sort((a,b) => (a.due||0) - (b.due||0));

  // A bill whose due date passed unpaid has already rolled its next due date
  // forward — so grouping by that date would file a missed JULY bill under
  // AUGUST. Pull those out into their own section at the top instead, where
  // they read as what they are: late, not upcoming.
  const overdue = allUnpaid.filter(x => x.overdue);
  const unpaid  = allUnpaid.filter(x => !x.overdue);

  const paid = bills.filter(b => isPaid(b, transactions))
    .map(b => ({ env: b, due: nextDueDate(b) }))
    .sort((a,b) => (a.due||0) - (b.due||0));

  // Group the rest by "Month Year" of the due date, preserving sort order.
  const groups = [];
  const seen = new Map();
  for (const item of unpaid) {
    const label = item.due
      ? item.due.toLocaleDateString("en-US", { month:"long", year:"numeric" })
      : "No date";
    if (!seen.has(label)) { seen.set(label, groups.length); groups.push({ label, items: [] }); }
    groups[seen.get(label)].items.push(item);
  }

  const totalDue = allUnpaid.reduce((s,x) => s + Math.max(0, targetAmount(x.env) - (x.env.funded||0)), 0);

  return (
    <>
      {/* Today + at-a-glance */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:16}}>
        <div>
          <div style={{fontSize:12,color:"#8e8e93",fontWeight:600,textTransform:"uppercase",letterSpacing:".5px",marginBottom:2}}>Today</div>
          <div style={{fontSize:19,fontWeight:700,letterSpacing:"-.5px"}}>{todayStr}</div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:12,color:"#8e8e93"}}>{allUnpaid.length} unpaid</div>
          {totalDue>0 && <div style={{fontSize:15,fontWeight:700,color:"#ffd60a",letterSpacing:"-.4px"}}>{money(totalDue)} to fund</div>}
        </div>
      </div>

      {allUnpaid.length === 0 && (
        <div className="card" style={{padding:"22px 20px",textAlign:"center",marginBottom:22,border:"1px solid #30d15833"}}>
          <div style={{fontSize:30,marginBottom:8}}>✓</div>
          <div style={{fontSize:15,fontWeight:600,color:"#30d158"}}>Every bill is handled</div>
          <div style={{fontSize:13,color:"#636366",marginTop:3}}>Nothing outstanding. Nice.</div>
        </div>
      )}

      {/* Overdue — pulled to the top, out of the month it would otherwise hide in */}
      {overdue.length > 0 && (
        <div style={{marginBottom:22}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
            <div style={{fontSize:12.5,fontWeight:700,color:"#ff375f",textTransform:"uppercase",letterSpacing:".7px"}}>
              Overdue
            </div>
            <div style={{flex:1,height:".5px",background:"rgba(255,55,95,.25)"}}/>
            <div style={{fontSize:11,color:"#ff375f"}}>{overdue.length}</div>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:9}}>
            {overdue.map(({env}) => (
              <BillRow key={env.id} env={env} transactions={transactions} dataSince={dataSince}
                onOpen={()=>onOpen(env)} onMarkPaid={()=>onMarkPaid(env)} />
            ))}
          </div>
        </div>
      )}

      {/* Unpaid, grouped by month */}
      {groups.map(group => (
        <div key={group.label} style={{marginBottom:20}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
            <div style={{fontSize:12.5,fontWeight:700,color:"#c5f135",textTransform:"uppercase",letterSpacing:".7px"}}>{group.label}</div>
            <div style={{flex:1,height:".5px",background:"rgba(255,255,255,.1)"}}/>
            <div style={{fontSize:11,color:"#48484a"}}>{group.items.length}</div>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:9}}>
            {group.items.map(({env}) => (
              <BillRow key={env.id} env={env} transactions={transactions} dataSince={dataSince}
                onOpen={()=>onOpen(env)} onMarkPaid={()=>onMarkPaid(env)} />
            ))}
          </div>
        </div>
      ))}

      {/* Paid archive — the reassurance zone */}
      {paid.length > 0 && (
        <div style={{marginTop:6}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
            <div style={{fontSize:12.5,fontWeight:700,color:"#30d158",textTransform:"uppercase",letterSpacing:".7px"}}>Paid This Period</div>
            <div style={{flex:1,height:".5px",background:"rgba(255,255,255,.1)"}}/>
            <div style={{fontSize:11,color:"#48484a"}}>{paid.length}</div>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:9}}>
            {paid.map(({env}) => (
              <PaidBillRow key={env.id} env={env} transactions={transactions} onOpen={()=>onOpen(env)} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// A paid bill, styled like a receipt — unmistakable, settled, with the real
// cleared amount and date. This is the confirmation an anxious brain needs.
function PaidBillRow({ env, transactions, onOpen }) {
  const actual = paidThisPeriod(env, transactions);
  const manual = actual <= 0;   // paid via manual mark, no cleared transaction
  const hist = paymentHistory(env, transactions, 2);
  const paidDate = hist[0]?.paidDate;

  return (
    <button className="card row-tap" onClick={onOpen}
      style={{padding:"13px 15px",width:"100%",textAlign:"left",border:"1px solid #30d15825",background:"#16211a",fontFamily:"inherit",color:"#fff",cursor:"pointer"}}>
      <div style={{display:"flex",alignItems:"center",gap:11}}>
        <div className="ibox" style={{background:"#30d15826",color:"#30d158",fontSize:18}}>✓</div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:15,fontWeight:600}}>{env.name}</div>
          <div style={{fontSize:12,color:"#30d158",marginTop:2,fontWeight:500}}>
            {manual ? "Marked paid" : `Paid${paidDate?` ${new Date(paidDate+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}`:""}`}
          </div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:15,fontWeight:700,color:"#30d158"}}>{money(manual ? targetAmount(env) : actual)}</div>
          <div style={{fontSize:10.5,color:"#8e8e93"}}>{manual ? "confirmed" : "cleared"}</div>
        </div>
      </div>
    </button>
  );
}

function BillRow({ env, transactions, dataSince, onOpen, onMarkPaid }) {
  const paid = isPaid(env, transactions);
  const locked = isLocked(env, transactions);
  const due = nextDueDate(env);
  const days = due ? daysBetween(new Date(), due) : null;
  const amt = targetAmount(env);
  const actual = paidThisPeriod(env, transactions);
  const overdue = paid ? null : overdueInfo(env, transactions, dataSince);
  const urg = overdue ? "#ff375f" : days===null?"#8e8e93":days<=1?"#ff375f":days<=5?"#ffd60a":"#30d158";
  return (
    <div className="card" style={{padding:"13px 15px",opacity:paid?.55:1,
      border: overdue && !overdue.pending ? "1px solid #ff375f66" : "1px solid transparent",
      background: overdue && !overdue.pending ? "#241014" : undefined}}>
      {overdue && (
        <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:10,paddingBottom:10,
          borderBottom:".5px solid rgba(255,255,255,.08)"}}>
          <span style={{fontSize:14}}>{overdue.pending ? "⏳" : "🚨"}</span>
          <div style={{fontSize:12,fontWeight:600,color:overdue.pending?"#ffd60a":"#ff375f",lineHeight:1.4}}>
            {overdue.pending
              ? `Due ${overdue.period.dueDate.toLocaleDateString("en-US",{month:"short",day:"numeric"})} — payment hasn't posted yet`
              : `${overdue.period.label} payment never posted · ${overdue.daysPast} days late`}
          </div>
        </div>
      )}
      <div style={{display:"flex",alignItems:"center",gap:11}}>
        {paid
          ? <div className="ibox" style={{background:"#30d15822"}}>✓</div>
          : <EnvIcon env={env} size={36} radius={10} bg={urg+"22"} />}
        <div style={{flex:1,minWidth:0,cursor:"pointer"}} onClick={onOpen}>
          <div style={{display:"flex",alignItems:"center",gap:5}}>
            <span style={{fontSize:15,fontWeight:600,textDecoration:paid?"line-through":"none",color:paid?"#636366":"#fff"}}>{env.name}</span>
            {locked && <span style={{fontSize:11}}>🔒</span>}
          </div>
          <div style={{fontSize:12,color:paid?"#48484a":urg,marginTop:2,fontWeight:500}}>
            {paid
              ? `Paid ${money(actual)}`
              : (() => {
                  const dateStr = due ? due.toLocaleDateString("en-US",{month:"short",day:"numeric"}) : "";
                  const countdown = days===0 ? "Due today" : days===1 ? "Due tomorrow" : days<0 ? `${Math.abs(days)} days overdue` : `Due in ${days} days`;
                  return due ? `${dateStr} · ${countdown}` : countdown;
                })()}
            {!paid && env.autopay && ` · autopay`}
          </div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:15,fontWeight:600}}>{money(amt)}</div>
          {!paid && (env.funded||0)>0 && <div style={{fontSize:11,color:"#8e8e93",marginTop:1}}>{money(env.funded)} ready</div>}
        </div>
      </div>
      {!paid && (
        <div style={{display:"flex",gap:8,marginTop:11}}>
          {env.paymentUrl && (
            <a href={env.paymentUrl} target="_blank" rel="noopener noreferrer" className="btn-mini" style={{background:"#c5f135",color:"#000",textDecoration:"none"}}>Pay now ↗</a>
          )}
          <button className="btn-mini" onClick={onMarkPaid}>Mark paid</button>
        </div>
      )}
    </div>
  );
}

function DebtCard({ env, onClick }) {
  const pct = progress(env);
  const variance = scheduleVariance(env);
  const risk = promoRisk(env);
  const sugg = suggestedPayment(env);
  const orig = env.originalBalance || 0;
  return (
    <button className="card" onClick={onClick} style={{padding:17,textAlign:"left",width:"100%",border:risk&&risk.status!=="ok"?"1px solid #ffd60a44":"none"}}>
      <div style={{display:"flex",alignItems:"center",gap:11,marginBottom:13}}>
        <EnvIcon env={env} size={42} radius={12} bg={env.color+"22"} />
        <div style={{flex:1}}>
          <div style={{fontSize:16,fontWeight:600}}>{env.name}</div>
          <div style={{fontSize:12,color:"#636366",marginTop:1}}>
            Payoff by {new Date(env.targetDate+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}
          </div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:20,fontWeight:700,letterSpacing:"-.8px"}}>{money(env.currentBalance||0)}</div>
          <div style={{fontSize:11,color:"#48484a"}}>of {money(orig)}</div>
        </div>
      </div>
      <div className="bar" style={{height:7,marginBottom:8}}>
        <div className="fill" style={{width:`${pct}%`,background:"linear-gradient(90deg,#30d158,#c5f135)"}}/>
      </div>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:12}}>
        <span style={{color:"#30d158",fontWeight:600}}>{Math.round(pct)}% paid off</span>
        {variance !== null && (
          <span style={{color:variance>=0?"#30d158":"#ff9f0a",fontWeight:600}}>
            {variance>=0 ? `${money(variance)} ahead` : `${money(Math.abs(variance))} behind`}
          </span>
        )}
      </div>
      <div style={{background:"#2c2c2e",borderRadius:10,padding:"10px 12px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div>
          <div style={{fontSize:11,color:"#8e8e93"}}>Suggested {env.frequency||"monthly"}</div>
          <div style={{fontSize:17,fontWeight:700,letterSpacing:"-.5px",color:"#c5f135"}}>{money(sugg)}</div>
        </div>
        <div style={{fontSize:11,color:"#48484a",textAlign:"right",maxWidth:130,lineHeight:1.4}}>to finish on time</div>
      </div>
      {risk && risk.status !== "ok" && (
        <div style={{marginTop:10,background:"#2a1f08",border:"1px solid #ffd60a33",borderRadius:10,padding:"9px 11px",display:"flex",gap:8,alignItems:"flex-start"}}>
          <span style={{fontSize:14}}>⚠️</span>
          <div style={{fontSize:12,color:"#ffd60a",lineHeight:1.45}}>{risk.message}</div>
        </div>
      )}
      {risk && risk.status === "ok" && (
        <div style={{marginTop:8,fontSize:11,color:"#30d158",textAlign:"center"}}>0% APR — {risk.daysLeft} days left</div>
      )}
    </button>
  );
}

function EnvelopeForm({ initial, onSave, onCancel }) {
  const [f, setF] = useState({
    type: initial.type || TYPES.SPENDING,
    name: initial.name || "", icon: initial.icon || "💳", color: initial.color || "#0a84ff",
    monthlyBudget: initial.monthlyBudget || "", billAmount: initial.billAmount || "",
    currentBalance: initial.currentBalance || "", targetAmount: initial.targetAmount || "",
    targetDate: initial.targetDate || "", frequency: initial.frequency || "monthly",
    dueDay: initial.dueDay ?? 1, annualDate: initial.annualDate || "01-01",
    minimumPayment: initial.minimumPayment || "", promoEndDate: initial.promoEndDate || "",
    postPromoAPR: initial.postPromoAPR || "", paymentUrl: initial.paymentUrl || "",
    autopay: initial.autopay || false, autopayLeadDays: initial.autopayLeadDays ?? 5,
    id: initial.id, matchPatterns: initial.matchPatterns || [],
    website: initial.website || "", logoUrl: initial.logoUrl || "",
  });
  const set = (k,v) => setF(p => ({...p,[k]:v}));
  const bill = isBill(f.type);
  const target = hasTarget(f.type);

  const preview = useMemo(() => {
    if (!target || !f.targetDate) return null;
    const s = suggestedPayment({...f, currentBalance: parseFloat(f.currentBalance)||0,
      targetAmount: parseFloat(f.targetAmount)||0, dueDay: parseInt(f.dueDay)||1});
    return s > 0 ? s : null;
  }, [f, target]);

  function save() {
    if (!f.name.trim()) return;
    onSave({ ...f, name: f.name.trim(), website: f.website.trim(),
      monthlyBudget: parseFloat(f.monthlyBudget)||0, billAmount: parseFloat(f.billAmount)||0,
      currentBalance: parseFloat(f.currentBalance)||0, targetAmount: parseFloat(f.targetAmount)||0,
      minimumPayment: parseFloat(f.minimumPayment)||0, postPromoAPR: parseFloat(f.postPromoAPR)||0,
      dueDay: parseInt(f.dueDay)||1, autopayLeadDays: parseInt(f.autopayLeadDays)||5 });
  }

  return (
    <Sheet onClose={onCancel} title={initial.id ? "Edit Envelope" : "New Envelope"}>
      {!initial.id && (
        <>
          <Label>Type</Label>
          <div style={{display:"flex",flexDirection:"column",gap:7,marginBottom:6}}>
            {Object.values(TYPES).map(t => (
              <button key={t} onClick={()=>set("type",t)}
                style={{background:f.type===t?"#c5f13518":"#2c2c2e",border:f.type===t?"1px solid #c5f135":"1px solid transparent",
                        borderRadius:12,padding:"11px 13px",textAlign:"left",cursor:"pointer",fontFamily:"inherit"}}>
                <div style={{fontSize:14,fontWeight:600,color:f.type===t?"#c5f135":"#fff"}}>{TYPE_META[t].label}</div>
                <div style={{fontSize:11.5,color:"#8e8e93",marginTop:2,lineHeight:1.4}}>{TYPE_META[t].blurb}</div>
              </button>
            ))}
          </div>
        </>
      )}

      <Label>Name</Label>
      <input className="in" value={f.name} onChange={e=>set("name",e.target.value)} placeholder={f.type===TYPES.DEBT?"Amex Blue Cash":"Groceries"} />

      {f.type === TYPES.SPENDING && (<><Label>Monthly budget</Label>
        <input className="in" type="number" value={f.monthlyBudget} onChange={e=>set("monthlyBudget",e.target.value)} placeholder="600" /></>)}

      {f.type === TYPES.RECURRING && (<><Label>Amount</Label>
        <input className="in" type="number" value={f.billAmount} onChange={e=>set("billAmount",e.target.value)} placeholder="15.99" /></>)}

      {f.type === TYPES.DEBT && (
        <>
          <Label>Current balance owed</Label>
          <input className="in" type="number" value={f.currentBalance} onChange={e=>set("currentBalance",e.target.value)} placeholder="6000" />
          <Label>Pay off by</Label>
          <input className="in" type="date" value={f.targetDate} onChange={e=>set("targetDate",e.target.value)} />
          <Label>Minimum payment <Dim>(optional)</Dim></Label>
          <input className="in" type="number" value={f.minimumPayment} onChange={e=>set("minimumPayment",e.target.value)} placeholder="35" />
          <Label>0% APR ends <Dim>(optional — but this is the one that matters)</Dim></Label>
          <input className="in" type="date" value={f.promoEndDate} onChange={e=>set("promoEndDate",e.target.value)} />
          {f.promoEndDate && (<><Label>Rate after 0% <Dim>(optional)</Dim></Label>
            <input className="in" type="number" value={f.postPromoAPR} onChange={e=>set("postPromoAPR",e.target.value)} placeholder="24.99" /></>)}
        </>
      )}

      {f.type === TYPES.GOAL && (
        <>
          <Label>Target amount</Label>
          <input className="in" type="number" value={f.targetAmount} onChange={e=>set("targetAmount",e.target.value)} placeholder="2000" />
          <Label>Already saved</Label>
          <input className="in" type="number" value={f.currentBalance} onChange={e=>set("currentBalance",e.target.value)} placeholder="0" />
          <Label>By when</Label>
          <input className="in" type="date" value={f.targetDate} onChange={e=>set("targetDate",e.target.value)} />
        </>
      )}

      {(bill || target) && (
        <>
          <Label>How often</Label>
          <div style={{display:"flex",gap:7,marginBottom:6}}>
            {["monthly","weekly","annual"].map(fr => (
              <button key={fr} onClick={()=>set("frequency",fr)}
                style={{flex:1,background:f.frequency===fr?"#c5f135":"#2c2c2e",color:f.frequency===fr?"#000":"#fff",
                        border:"none",borderRadius:10,padding:"10px 0",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit",textTransform:"capitalize"}}>{fr}</button>
            ))}
          </div>
          {f.frequency === "monthly" && (<><Label>Day of month</Label>
            <input className="in" type="number" min="1" max="31" value={f.dueDay} onChange={e=>set("dueDay",e.target.value)} /></>)}
          {f.frequency === "weekly" && (<><Label>Day of week</Label>
            <div style={{display:"flex",gap:5,marginBottom:6}}>
              {DOW.map((d,i)=>(
                <button key={d} onClick={()=>set("dueDay",i)}
                  style={{flex:1,background:Number(f.dueDay)===i?"#c5f135":"#2c2c2e",color:Number(f.dueDay)===i?"#000":"#8e8e93",
                          border:"none",borderRadius:8,padding:"9px 0",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>{d[0]}</button>
              ))}
            </div></>)}
          {f.frequency === "annual" && (<><Label>Date (MM-DD)</Label>
            <input className="in" value={f.annualDate} onChange={e=>set("annualDate",e.target.value)} placeholder="04-15" /></>)}
        </>
      )}

      {preview && (
        <div style={{background:"#1a2408",border:"1px solid #c5f13544",borderRadius:12,padding:"13px 15px",margin:"14px 0 6px"}}>
          <div style={{fontSize:11,color:"#8e9e6a",letterSpacing:".4px",textTransform:"uppercase",marginBottom:3}}>Suggested {f.frequency} payment</div>
          <div style={{fontSize:26,fontWeight:700,color:"#c5f135",letterSpacing:"-1px"}}>{money(preview)}</div>
          <div style={{fontSize:11.5,color:"#8e8e93",marginTop:4,lineHeight:1.45}}>
            A hint, not a rule. Pay what you can — Budgetgum recalculates from what actually clears.
          </div>
        </div>
      )}

      {bill && (
        <>
          <Label>Payment link <Dim>(optional)</Dim></Label>
          <input className="in" value={f.paymentUrl} onChange={e=>set("paymentUrl",e.target.value)} placeholder="https://..." />
          <div style={{background:"#2c2c2e",borderRadius:12,padding:"13px 15px",marginTop:12}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div style={{flex:1,paddingRight:12}}>
                <div style={{fontSize:14,fontWeight:600}}>Autopay</div>
                <div style={{fontSize:11.5,color:"#8e8e93",marginTop:2,lineHeight:1.45}}>
                  Funds lock a few business days early — once the ACH is moving, you can't take it back.
                </div>
              </div>
              <button onClick={()=>set("autopay",!f.autopay)}
                style={{width:50,height:30,borderRadius:15,background:f.autopay?"#30d158":"#48484a",border:"none",position:"relative",cursor:"pointer",flexShrink:0}}>
                <div style={{position:"absolute",top:3,left:f.autopay?23:3,width:24,height:24,borderRadius:12,background:"#fff",transition:"left .18s"}}/>
              </button>
            </div>
            {f.autopay && (
              <div style={{marginTop:12,paddingTop:12,borderTop:".5px solid rgba(255,255,255,.09)"}}>
                <div style={{fontSize:12,color:"#8e8e93",marginBottom:7}}>Locks this many business days before due:</div>
                <div style={{display:"flex",gap:6}}>
                  {[2,3,4,5,7].map(n=>(
                    <button key={n} onClick={()=>set("autopayLeadDays",n)}
                      style={{flex:1,background:Number(f.autopayLeadDays)===n?"#c5f135":"#3a3a3c",color:Number(f.autopayLeadDays)===n?"#000":"#fff",
                              border:"none",borderRadius:8,padding:"9px 0",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>{n}</button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      <Label style={{marginTop:16}}>Logo <Dim>(optional)</Dim></Label>
      <div className="card" style={{padding:13,marginBottom:6}}>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>
          <EnvIcon env={{icon:f.icon, color:f.color, website:f.website, logoUrl:f.logoUrl}}
            size={44} radius={12} bg={f.color+"22"} />
          <div style={{flex:1,fontSize:11.5,color:"#8e8e93",lineHeight:1.5}}>
            Type a company's website and Budgetgum will pull its logo. Leave it blank
            to keep the emoji.
          </div>
        </div>
        <input className="in" value={f.website} onChange={e=>set("website",e.target.value)}
          placeholder="progressive.com" autoCapitalize="none" autoCorrect="off" />
      </div>

      <Label style={{marginTop:16}}>Emoji <Dim>(used if there's no logo)</Dim></Label>
      <div style={{display:"flex",flexWrap:"wrap",gap:7,marginBottom:6}}>
        {ICONS.map(ic=>(
          <button key={ic} onClick={()=>set("icon",ic)}
            style={{width:42,height:42,borderRadius:11,background:f.icon===ic?"#c5f135":"#2c2c2e",fontSize:20,border:"none",cursor:"pointer"}}>{ic}</button>
        ))}
      </div>

      <Label>Color</Label>
      <div style={{display:"flex",gap:9,flexWrap:"wrap",marginBottom:6}}>
        {COLORS.map(c=>(
          <button key={c} onClick={()=>set("color",c)}
            style={{width:29,height:29,borderRadius:"50%",background:c,border:f.color===c?"3px solid #fff":"3px solid transparent",cursor:"pointer"}}/>
        ))}
      </div>

      <button className="btn-green" style={{marginTop:14}} onClick={save} disabled={!f.name.trim()}>
        {initial.id ? "Save Changes" : "Create Envelope"}
      </button>
    </Sheet>
  );
}

function EnvelopeDetail({ env, transactions, dataSince, onClose, onEdit, onDelete, onFund, onMarkPaid, onMarkPeriodPaid, onUnmarkPeriod, onUpdateAmount, onToggleAutoAmount }) {
  const [confirmDel, setConfirmDel] = useState(false);
  const locked = isLocked(env, transactions);
  const paid = isPaid(env, transactions);
  const risk = promoRisk(env);
  const variance = scheduleVariance(env);
  const due = nextDueDate(env);
  const lock = lockDate(env);

  return (
    <Sheet onClose={onClose} title={null}>
      <div style={{textAlign:"center",marginBottom:20}}>
        <div style={{display:"flex",justifyContent:"center",marginBottom:10}}>
          <EnvIcon env={env} size={64} radius={16} bg={env.color+"1f"} />
        </div>
        <div style={{fontSize:12,color:"#8e8e93",letterSpacing:".4px",textTransform:"uppercase"}}>{TYPE_META[env.type].label}</div>
        <div style={{fontSize:24,fontWeight:700,letterSpacing:"-.7px",marginTop:2}}>{env.name}</div>
        {paid && <div style={{display:"inline-block",marginTop:8,background:"#30d15822",color:"#30d158",borderRadius:20,padding:"4px 12px",fontSize:12,fontWeight:700}}>✓ PAID THIS PERIOD</div>}
        {locked && <div style={{display:"inline-block",marginTop:8,marginLeft:6,background:"#ffd60a22",color:"#ffd60a",borderRadius:20,padding:"4px 12px",fontSize:12,fontWeight:700}}>🔒 LOCKED</div>}
      </div>

      {env.type === TYPES.DEBT && (
        <>
          <div className="card" style={{padding:16,marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:10}}>
              <div>
                <div style={{fontSize:11,color:"#8e8e93",textTransform:"uppercase",letterSpacing:".4px"}}>Still owed</div>
                <div style={{fontSize:28,fontWeight:700,letterSpacing:"-1.2px"}}>{money(env.currentBalance)}</div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:11,color:"#8e8e93"}}>Started at</div>
                <div style={{fontSize:15,color:"#8e8e93"}}>{money(env.originalBalance)}</div>
              </div>
            </div>
            <div className="bar" style={{height:8,marginBottom:8}}>
              <div className="fill" style={{width:`${progress(env)}%`,background:"linear-gradient(90deg,#30d158,#c5f135)"}}/>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:12.5}}>
              <span style={{color:"#30d158",fontWeight:600}}>{Math.round(progress(env))}% paid off</span>
              {variance !== null && (
                <span style={{color:variance>=0?"#30d158":"#ff9f0a",fontWeight:600}}>
                  {variance>=0?`${money(variance)} ahead of plan`:`${money(Math.abs(variance))} behind plan`}
                </span>
              )}
            </div>
          </div>

          {risk && risk.status !== "ok" && (
            <div style={{background:"#2a1f08",border:"1px solid #ffd60a44",borderRadius:14,padding:14,marginBottom:10,display:"flex",gap:10}}>
              <span style={{fontSize:18}}>⚠️</span>
              <div>
                <div style={{fontSize:13.5,fontWeight:600,color:"#ffd60a",marginBottom:3}}>0% APR risk</div>
                <div style={{fontSize:12.5,color:"#d4b95e",lineHeight:1.5}}>{risk.message}</div>
                {env.postPromoAPR>0 && risk.exposedAmount>0 && (
                  <div style={{fontSize:12,color:"#ff9f0a",marginTop:6,fontWeight:600}}>
                    ≈ {money(risk.exposedAmount * (env.postPromoAPR/100))}/yr in interest if that happens
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      <div className="grp" style={{marginBottom:12}}>
        {isBill(env.type) && (
          <>
            <DRow k="Next due" v={due ? due.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"}) : "—"} />
            <DRow k={hasTarget(env.type)?"Suggested payment":"Amount"} v={money(targetAmount(env))} accent />
            {env.minimumPayment>0 && <DRow k="Minimum payment" v={money(env.minimumPayment)} />}
            <DRow k="Set aside" v={money(env.funded||0)} />
            {env.autopay && lock && <DRow k="Locks on" v={lock.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})} />}
            {paid && <DRow k="Paid this period" v={money(paidThisPeriod(env, transactions))} accent />}
          </>
        )}
        {env.type === TYPES.SPENDING && (
          <>
            <DRow k="Monthly budget" v={money(env.monthlyBudget)} />
            <DRow k="Spent this month" v={money(spentThisMonth(env, transactions))} />
            <DRow k="Left" v={money((env.monthlyBudget||0) - spentThisMonth(env, transactions))} accent />
          </>
        )}
        {env.type === TYPES.GOAL && (
          <>
            <DRow k="Saved" v={money(env.currentBalance||0)} accent />
            <DRow k="Target" v={money(env.targetAmount)} />
            <DRow k="Suggested" v={money(suggestedPayment(env))} />
          </>
        )}
      </div>

      {env.paymentUrl && !paid && (
        <a href={env.paymentUrl} target="_blank" rel="noopener noreferrer" className="btn-green" style={{display:"block",textAlign:"center",textDecoration:"none",marginBottom:8}}>Go pay it ↗</a>
      )}
      {isBill(env.type) && !paid && (
        <button className="btn-dim" style={{marginBottom:8}} onClick={onMarkPaid}>Mark as paid</button>
      )}
      <button className="btn-dim" style={{marginBottom:8}} onClick={onFund} disabled={locked}>
        {locked ? "🔒 Funds locked" : "Fund / release money"}
      </button>

      {isBill(env.type) && (
        <>
      {/* What this bill actually costs — learned from real payments */}
      {env.type === TYPES.RECURRING && (() => {
        const stats = billAmountStats(env, transactions);
        if (!stats || !stats.enough) return null;
        const drift = amountDrift(env, transactions);
        return (
          <>
            <Label style={{marginTop:14}}>What it actually costs</Label>
            <div className="card" style={{padding:14,marginBottom:12,border:drift?"1px solid #ffd60a33":"1px solid transparent"}}>
              <div style={{display:"flex",gap:14}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:11,color:"#8e8e93",marginBottom:2}}>Average</div>
                  <div style={{fontSize:16,fontWeight:700,letterSpacing:"-.4px"}}>{money(stats.avg)}</div>
                </div>
                <div style={{flex:1}}>
                  <div style={{fontSize:11,color:"#8e8e93",marginBottom:2}}>{stats.variable?"Range":"Latest"}</div>
                  <div style={{fontSize:16,fontWeight:700,letterSpacing:"-.4px"}}>
                    {stats.variable ? `${money(stats.min)}–${money(stats.max)}` : money(stats.latest)}
                  </div>
                </div>
                <div style={{flex:1}}>
                  <div style={{fontSize:11,color:"#8e8e93",marginBottom:2}}>Payments</div>
                  <div style={{fontSize:16,fontWeight:700,letterSpacing:"-.4px"}}>{stats.count}</div>
                </div>
              </div>

              {drift && (
                <div style={{marginTop:12,paddingTop:12,borderTop:".5px solid rgba(255,255,255,.08)"}}>
                  <div style={{fontSize:12.5,color:"#ffd60a",lineHeight:1.5,marginBottom:10}}>
                    {drift.under
                      ? `You're reserving ${money(drift.current)}, but recent charges run higher. ${money(drift.suggested)} would cover ${stats.variable?"the swings":"it"}.`
                      : `You're reserving ${money(drift.current)} — more than this bill has cost lately. ${money(drift.suggested)} would be enough.`}
                  </div>
                  <button className="btn-mini" style={{background:"#c5f135",color:"#000",width:"100%"}}
                    onClick={()=>onUpdateAmount(env, drift.suggested)}>
                    Update to {money(drift.suggested)}
                  </button>
                </div>
              )}

              {stats.variable && (
                <button onClick={()=>onToggleAutoAmount(env)}
                  style={{background:"#2c2c2e",border:"none",borderRadius:11,padding:"11px 13px",width:"100%",display:"flex",alignItems:"center",gap:11,cursor:"pointer",fontFamily:"inherit",marginTop:10}}>
                  <div style={{width:20,height:20,borderRadius:6,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,color:"#000",
                    background:env.autoAmount?"#c5f135":"#48484a"}}>{env.autoAmount?"✓":""}</div>
                  <div style={{flex:1,textAlign:"left"}}>
                    <div style={{fontSize:13,fontWeight:500,color:"#fff"}}>Keep this amount up to date</div>
                    <div style={{fontSize:11,color:"#8e8e93",marginTop:1}}>Adjusts on its own as new payments clear</div>
                  </div>
                </button>
              )}
            </div>
          </>
        );
      })()}

          <Label style={{marginTop:14}}>Payment history</Label>
          <div className="grp" style={{marginBottom:12}}>
            {paymentHistory(env, transactions, 6, dataSince).map(p => (
              <div key={p.key} className="row" style={{padding:"11px 14px"}}>
                <div style={{width:26,height:26,borderRadius:8,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,
                  background:p.paid?"#30d15826":p.noData?"#2c2c2e":p.missed?"#ff375f26":"#2c2c2e",
                  color:p.paid?"#30d158":p.noData?"#48484a":p.missed?"#ff375f":"#8e8e93"}}>
                  {p.paid?"✓":p.noData?"–":p.missed?"!":"•"}
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:14,fontWeight:500,color:p.noData?"#8e8e93":"#fff"}}>{p.label}</div>
                  <div style={{fontSize:11.5,color:p.missed?"#ff375f":"#636366",marginTop:1}}>
                    {p.paid
                      ? (p.manual && p.amount<=0 ? "Marked paid" : `Paid${p.paidDate?` ${new Date(p.paidDate+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}`:""}`)
                      : p.noData ? "Before your import date"
                      : p.upcoming ? "Upcoming"
                      : "Missed — no payment found"}
                  </div>
                </div>
                <div style={{textAlign:"right"}}>
                  {p.amount>0
                    ? <div style={{fontSize:14,fontWeight:600,color:"#30d158"}}>{money(p.amount)}</div>
                    : p.missed
                      ? <button className="btn-mini" style={{padding:"5px 10px",fontSize:12}} onClick={()=>onMarkPeriodPaid(env, p.key)}>Mark paid</button>
                      : p.manual
                        ? <button className="btn-mini" style={{padding:"5px 10px",fontSize:12,color:"#8e8e93"}} onClick={()=>onUnmarkPeriod(env, p.key)}>Undo</button>
                        : <span style={{fontSize:12,color:"#48484a"}}>—</span>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <EnvelopeTransactions env={env} transactions={transactions} />

      <div style={{display:"flex",gap:8,marginTop:6}}>
        <button className="btn-dim" style={{flex:1}} onClick={onEdit}>Edit</button>
        {!confirmDel ? (
          <button className="btn-dim" style={{flex:1,color:"#ff375f"}} onClick={()=>setConfirmDel(true)} disabled={locked}>Delete</button>
        ) : (
          <button className="btn-dim" style={{flex:1,background:"#ff375f",color:"#fff"}} onClick={onDelete}>Really delete?</button>
        )}
      </div>
    </Sheet>
  );
}

function FundSheet({ env, sts, transactions, onFund, onUnfund, onClose }) {
  const [amt, setAmt] = useState("");
  if (!env) return null;
  const need = shortfall(env, transactions);
  const n = parseFloat(amt) || 0;
  return (
    <Sheet onClose={onClose} title={`Fund ${env.name}`}>
      <div style={{display:"flex",gap:10,marginBottom:16}}>
        <div style={{flex:1,background:"#2c2c2e",borderRadius:12,padding:"12px 14px"}}>
          <div style={{fontSize:11,color:"#8e8e93"}}>Safe to spend</div>
          <div style={{fontSize:19,fontWeight:700,color:"#c5f135",letterSpacing:"-.6px"}}>{money(sts)}</div>
        </div>
        <div style={{flex:1,background:"#2c2c2e",borderRadius:12,padding:"12px 14px"}}>
          <div style={{fontSize:11,color:"#8e8e93"}}>Set aside here</div>
          <div style={{fontSize:19,fontWeight:700,letterSpacing:"-.6px"}}>{money(env.funded||0)}</div>
        </div>
      </div>
      {need > 0 && (
        <div style={{background:"#2a2408",border:"1px solid #ffd60a33",borderRadius:11,padding:"10px 13px",marginBottom:14,fontSize:12.5,color:"#ffd60a",lineHeight:1.45}}>
          Needs {money(need)} more to cover {money(targetAmount(env))}.
        </div>
      )}
      <Label>Amount</Label>
      <input className="in" type="number" value={amt} autoFocus onChange={e=>setAmt(e.target.value)} placeholder="0" />
      <div style={{display:"flex",gap:7,marginTop:9,marginBottom:16}}>
        {need>0 && <button className="chip" onClick={()=>setAmt(String(Math.min(need,sts)))}>Fill the gap</button>}
        <button className="chip" onClick={()=>setAmt(String(Math.max(0,Math.floor(sts/2))))}>Half of safe</button>
        {(env.funded||0)>0 && <button className="chip" onClick={()=>setAmt(String(env.funded))}>All of it</button>}
      </div>
      <button className="btn-green" onClick={()=>onFund(n)} disabled={n<=0||n>sts} style={{marginBottom:8,opacity:(n<=0||n>sts)?.4:1}}>
        Move {money(n)} in
      </button>
      {(env.funded||0)>0 && (
        <button className="btn-dim" onClick={()=>onUnfund(n)} disabled={n<=0||n>(env.funded||0)} style={{opacity:(n<=0||n>(env.funded||0))?.4:1}}>
          Take {money(n)} back out
        </button>
      )}
    </Sheet>
  );
}

function AssignSheet({ tx, envelopes, onAssign, onSkip, onClose }) {
  const [remember, setRemember] = useState(true);
  const isCredit = tx.amount <= 0;
  return (
    <Sheet onClose={onClose} title={isCredit ? "Money came back — where from?" : "Where does this go?"}>
      <div className="card" style={{padding:14,marginBottom:14}}>
        <div style={{fontSize:15,fontWeight:600,marginBottom:3}}>{tx.desc}</div>
        <div style={{fontSize:13,color:isCredit?"#30d158":"#8e8e93"}}>
          {isCredit ? `+${money(Math.abs(tx.amount))}` : money(tx.amount)} · {tx.date}
        </div>
      </div>

      {isCredit && (
        <div className="card" style={{padding:13,marginBottom:14,border:"1px solid #30d15833"}}>
          <div style={{fontSize:12.5,color:"#8e8e93",lineHeight:1.55}}>
            Assign this to an envelope and it counts as a <strong style={{color:"#30d158"}}>refund</strong> —
            it'll subtract from what you've spent there. Skip it and it's treated as
            <strong style={{color:"#fff"}}> income</strong>, which only affects your checking balance.
          </div>
        </div>
      )}
      <div style={{display:"flex",flexDirection:"column",gap:7,marginBottom:14}}>
        {envelopes.map(env=>(
          <button key={env.id} onClick={()=>onAssign(tx, env.id, remember)}
            style={{background:"#2c2c2e",border:"none",borderRadius:13,padding:"12px 14px",display:"flex",alignItems:"center",gap:11,cursor:"pointer",fontFamily:"inherit",color:"#fff"}}>
            <EnvIcon env={env} size={32} radius={9} bg="transparent" />
            <div style={{flex:1,textAlign:"left"}}>
              <div style={{fontSize:15,fontWeight:500}}>{env.name}</div>
              <div style={{fontSize:12,color:"#8e8e93"}}>{TYPE_META[env.type].label}</div>
            </div>
            <span style={{color:"#48484a",fontSize:17}}>›</span>
          </button>
        ))}
      </div>
      <button onClick={()=>setRemember(!remember)}
        style={{background:"#2c2c2e",border:"none",borderRadius:12,padding:"12px 14px",width:"100%",display:"flex",alignItems:"center",gap:11,cursor:"pointer",fontFamily:"inherit",marginBottom:10}}>
        <div style={{width:21,height:21,borderRadius:6,background:remember?"#c5f135":"#48484a",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,color:"#000",flexShrink:0}}>
          {remember?"✓":""}
        </div>
        <div style={{flex:1,textAlign:"left"}}>
          <div style={{fontSize:13.5,fontWeight:500,color:"#fff"}}>Always match transactions like this</div>
          <div style={{fontSize:11.5,color:"#8e8e93",marginTop:1}}>Teach it once, never sort this bill again</div>
        </div>
      </button>
      <button className="btn-dim" onClick={onSkip} style={{color:"#8e8e93"}}>
        {isCredit ? "It's income — not a refund" : "Skip — not a budget item"}
      </button>
    </Sheet>
  );
}

function Sheet({ children, onClose, title }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={e=>e.stopPropagation()}>
        <div className="handle"/>
        {title && (
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"16px 20px 6px"}}>
            <span style={{fontSize:20,fontWeight:700,letterSpacing:"-.5px"}}>{title}</span>
            <button className="link" onClick={onClose}>Done</button>
          </div>
        )}
        <div style={{padding: title ? "8px 20px 40px" : "20px 20px 40px"}}>{children}</div>
      </div>
    </div>
  );
}
const Label = ({children,style}) => <div style={{fontSize:12.5,color:"#8e8e93",fontWeight:500,margin:"13px 0 6px",...style}}>{children}</div>;
const Dim = ({children}) => <span style={{color:"#48484a",fontWeight:400}}>{children}</span>;
const DRow = ({k,v,accent}) => (
  <div className="row" style={{justifyContent:"space-between",padding:"12px 15px"}}>
    <span style={{fontSize:14.5,color:"#8e8e93"}}>{k}</span>
    <span style={{fontSize:14.5,fontWeight:600,color:accent?"#c5f135":"#fff"}}>{v}</span>
  </div>
);

const S = {
  app: {fontFamily:"-apple-system,'SF Pro Display','SF Pro Text','Helvetica Neue',sans-serif",background:"#000",minHeight:"100vh",color:"#fff",maxWidth:430,margin:"0 auto",position:"relative",WebkitFontSmoothing:"antialiased"},
  page: {padding:"20px 22px 110px"},
};

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
::-webkit-scrollbar{display:none}
input::placeholder,textarea::placeholder{color:#48484a}
input[type=date]::-webkit-calendar-picker-indicator{filter:invert(.4)}
button{-webkit-tap-highlight-color:transparent}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes sheetUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
@keyframes toastIn{from{opacity:0;transform:translateX(-50%) translateY(8px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}

.card{background:#1c1c1e;border-radius:18px;border:none;color:#fff;font-family:inherit}
.env-card{padding:15px;text-align:left;cursor:pointer;width:100%;transition:opacity .12s}
.env-card:active{opacity:.6}
.row-tap{transition:background .12s}
.row-tap:active{background:rgba(255,255,255,.04)}
.grp{background:#1c1c1e;border-radius:15px;overflow:hidden}
.row{padding:13px 15px;display:flex;align-items:center;gap:11px}
.row+.row{border-top:.5px solid rgba(255,255,255,.08)}
.ibox{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0}
.ibox-lg{width:42px;height:42px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:21px;flex-shrink:0}
.bar{background:#2c2c2e;border-radius:3px;height:4px;overflow:hidden}
.fill{height:100%;border-radius:3px;transition:width .7s cubic-bezier(.25,.46,.45,.94)}

.sec{font-size:12.5px;font-weight:600;color:#636366;text-transform:uppercase;letter-spacing:.6px;margin-bottom:10px}
.eyebrow{font-size:12px;font-weight:600;color:#636366;letter-spacing:.4px;text-transform:uppercase}
.tiny-link{background:none;border:none;color:#48484a;font-size:11px;cursor:pointer;font-family:inherit;padding:0;text-decoration:underline}
.lock-btn{background:#2c2c2e;border:none;color:#aeaeb2;font-size:10.5px;font-weight:600;cursor:pointer;font-family:inherit;padding:4px 9px;border-radius:8px;letter-spacing:.2px;transition:background .12s}
.lock-btn:active{background:#3a3a3c}

.tabs{display:flex;border-bottom:.5px solid rgba(255,255,255,.1);margin-top:18px}
.tab{flex:1;background:none;border:none;border-bottom:2px solid transparent;padding-bottom:10px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px;color:#636366;font-size:9px;font-weight:500;letter-spacing:.2px;text-transform:uppercase;font-family:inherit;transition:color .15s}
.tab.on{color:#c5f135;border-bottom-color:#c5f135}

.tabbar{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:430px;background:rgba(0,0,0,.85);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border-top:.5px solid rgba(255,255,255,.1);display:flex;padding:10px 0 28px;z-index:40}
.tb{flex:1;background:none;border:none;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px;color:#636366;font-size:9px;font-weight:500;letter-spacing:.2px;text-transform:uppercase;font-family:inherit;transition:color .15s}
.tb.on{color:#c5f135}

.btn-green{background:#c5f135;color:#000;border:none;border-radius:13px;font-family:inherit;font-size:16px;font-weight:600;letter-spacing:-.3px;padding:15px;cursor:pointer;width:100%;transition:opacity .12s}
.btn-green:active{opacity:.72}
.btn-green:disabled{opacity:.4;cursor:default}
.btn-dim{background:#2c2c2e;color:#fff;border:none;border-radius:13px;font-family:inherit;font-size:14.5px;font-weight:500;padding:13px;cursor:pointer;width:100%;transition:opacity .12s}
.btn-dim:active{opacity:.6}
.btn-dim:disabled{opacity:.45;cursor:default}
.btn-mini{background:#2c2c2e;color:#fff;border:none;border-radius:9px;font-family:inherit;font-size:12.5px;font-weight:600;padding:7px 13px;cursor:pointer;flex:1;text-align:center;display:flex;align-items:center;justify-content:center}
.chip{background:#2c2c2e;color:#c5f135;border:none;border-radius:9px;font-family:inherit;font-size:12px;font-weight:600;padding:8px 12px;cursor:pointer;flex:1}
.link{background:none;border:none;color:#c5f135;font-family:inherit;font-size:16px;font-weight:600;cursor:pointer}
.link:active{opacity:.5}

.in{background:#2c2c2e;border:none;color:#fff;border-radius:11px;padding:13px 15px;width:100%;font-family:inherit;font-size:16px;letter-spacing:-.2px;transition:background .15s;outline:none}
.in:focus{background:#3a3a3c}

.alert{display:flex;gap:11px;align-items:flex-start;border-radius:14px;padding:13px 15px;margin-bottom:8px;width:100%;cursor:pointer;font-family:inherit;border:1px solid;background:#1c1c1e;color:#fff;transition:opacity .12s}
.alert:active{opacity:.7}
.alert.critical{background:#2a0d12;border-color:#ff375f66}
.alert.warn{background:#2a2108;border-color:#ffd60a44}
.alert.info{background:#1c1c1e;border-color:#2c2c2e}

.badge{background:#ff375f;border-radius:9px;padding:2px 7px;font-size:11.5px;font-weight:700;color:#fff}
.overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:50;display:flex;flex-direction:column;justify-content:flex-end;animation:fadeIn .2s;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
.sheet{background:#1c1c1e;border-radius:20px 20px 0 0;width:100%;max-width:430px;margin:0 auto;animation:sheetUp .3s cubic-bezier(.32,1,.23,1);max-height:90vh;overflow-y:auto}
.handle{width:34px;height:4px;background:#48484a;border-radius:2px;margin:11px auto 0}
.toast{position:fixed;bottom:98px;left:50%;transform:translateX(-50%);background:rgba(44,44,46,.97);backdrop-filter:blur(24px);border-radius:20px;padding:11px 19px;font-size:14.5px;font-weight:500;white-space:nowrap;z-index:200;animation:toastIn .26s cubic-bezier(.32,1,.23,1);max-width:90vw;overflow:hidden;text-overflow:ellipsis}
`;
