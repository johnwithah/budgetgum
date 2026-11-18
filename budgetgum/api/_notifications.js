// ─────────────────────────────────────────────────────────────────────────────
// _notifications.js — decide what's worth a push notification right now.
//
// This uses the SAME src/engine.js the app renders from, so a notification can
// never disagree with what you see when you tap it. Nothing here sends anything
// or writes anything; notify.js does that. This file just answers "what would
// I tell you, given this budget, these fresh bank transactions, and what I've
// already told you?"
//
// Every notification carries `keys` — stable strings like
// `due-1:env_123:2026-12-01` — and notify.js records them once sent. That's
// what turns a check every two hours into "Rent due tomorrow" exactly once.
// ─────────────────────────────────────────────────────────────────────────────

// Keep in sync with EMPTY_STATE.notifications in src/useCloudState.js.
const DEFAULT_PREFS = {
  bills: true,          // due-date reminders, autopay locks, overdue
  billLeadDays: 3,      // first heads-up this many days before a due date
  sort: true,           // new bank transactions waiting in the sort queue
  lowBalance: true,     // Safe to Spend below a threshold
  lowThreshold: 100,
  promo: true,          // 0% promo APR cliffs on debt envelopes
};

const prefsOf = state => ({ ...DEFAULT_PREFS, ...(state.notifications || {}) });

// engine.js is an ES module living in the React app. Depending on how Vercel
// bundles it, a dynamic import hands back either the module itself or a CJS
// wrapper with everything under `default` — accept both.
let enginePromise = null;
function loadEngine() {
  enginePromise = enginePromise || import('../src/engine.js').then(m => (m.isPaid ? m : m.default));
  return enginePromise;
}

// The funded/balance side of App.js's applyPayments(), for payments the app
// hasn't synced yet. Without this, a bill that autopaid this morning would
// still look unpaid and still be holding its funding, so we'd nag about a paid
// bill and under-report Safe to Spend. Evaluation only — never saved.
function settle(E, env, payments) {
  if (!payments.length) return env;
  const total = payments.reduce((s, t) => s + t.amount, 0);
  if (env.type === E.TYPES.SPENDING) return { ...env, funded: Math.max(0, (env.funded || 0) - total) };
  const next = { ...env };
  if (env.type === E.TYPES.DEBT)      next.currentBalance = Math.max(0, (env.currentBalance || 0) - total);
  else if (env.type === E.TYPES.GOAL) next.currentBalance = (env.currentBalance || 0) + total;
  if (E.isBill(env.type)) next.funded = Math.max(0, (env.funded || 0) - total);
  return next;
}

const fmtDay = d => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const dayKey = d => d.toLocaleDateString('en-CA');   // YYYY-MM-DD in local (process TZ) time

// fresh:    transactions straight from Plaid (mapTransaction shape), or []
// accounts: fresh Plaid accounts (mapAccount shape), or null if Plaid failed
// sent:     { key: timestamp } of notifications already delivered
async function computeNotifications(state, { fresh = [], accounts = null, sent = {} } = {}) {
  const E = await loadEngine();
  const prefs = prefsOf(state);
  const dataSince = state.importSince || '2026-07-14';
  const out = [];
  const already = k => Boolean(sent[k]);

  // ── What did the bank report that the app hasn't seen yet? ────────────────
  // Same classification as syncBank() in App.js.
  const known = new Set([
    ...(state.transactions || []).map(t => t.id),
    ...(state.unmapped || []).map(t => t.id),
    ...(state.ignored || []),
  ]);
  const envelopes = state.envelopes || [];
  const unseen = fresh.filter(t => !t.pending && !known.has(t.id) && t.date >= dataSince);
  const matched = [], needsSort = [];
  for (const t of unseen) {
    const envId = E.matchEnvelope(t, envelopes);
    if (t.amount > 0) {
      if (envId) matched.push({ ...t, envelopeId: envId });
      else needsSort.push(t);
    } else if (envId && envelopes.find(e => e.id === envId)?.type === E.TYPES.SPENDING) {
      needsSort.push(t);   // a likely refund — the app asks where it goes
    } else if (E.matchSplit(t, envelopes)) {
      needsSort.push(t);   // a sender you split across bills before (roommate)
    }
  }

  const transactions = [...matched, ...(state.transactions || [])];
  const envs = envelopes.map(env => settle(E, env, matched.filter(t => t.envelopeId === env.id)));
  const today = E.startOfDay();

  // ── Bills ─────────────────────────────────────────────────────────────────
  if (prefs.bills) {
    const lead = Math.max(1, Number(prefs.billLeadDays) || DEFAULT_PREFS.billLeadDays);

    for (const env of envs) {
      if (!E.isBill(env.type) || E.isPaid(env, transactions, dataSince)) continue;
      const url = `/?open=${encodeURIComponent(env.id)}`;
      const key = E.periodKey(env, transactions, dataSince);
      const amount = E.targetAmount(env, key);
      const short = E.shortfall(env, transactions, dataSince);
      const push = (k, level, title, body) => { if (!already(k)) out.push({ keys: [k], level, title, body, url, tag: k }); };

      // Past due. Within grace it may just be clearing; beyond it, it's missed.
      const overdue = E.overdueInfo(env, transactions, dataSince);
      if (overdue) {
        const p = overdue.period;
        if (overdue.pending) {
          push(`late:${env.id}:${p.key}`, 'warn',
            `${env.name} hasn't posted yet`,
            `${E.money(E.targetAmount(env, p.key))} was due ${fmtDay(p.dueDate)}. If you paid it, it may still be clearing.`);
        } else {
          push(`overdue:${env.id}:${p.key}`, 'critical',
            `${env.name}: ${p.label} payment never posted`,
            `${E.money(E.targetAmount(env, p.key))} was due ${fmtDay(p.dueDate)}, ${overdue.daysPast} days ago. Nothing has cleared.`);
        }
        continue;
      }

      const due = E.activeDueDate(env, transactions, dataSince);
      if (!due) continue;
      const days = E.daysBetween(today, due);
      const funding = short > 0 ? `${E.money(short)} still to set aside.` : 'Fully funded ✓';

      if (env.autopay) {
        if (E.isLocked(env, transactions, dataSince) && short > 0) {
          push(`locked-short:${env.id}:${key}`, 'critical',
            `${env.name} autopay is locked and short`,
            `Needs ${E.money(amount)}, only ${E.money(env.funded || 0)} set aside. Your bank will still pull the full amount.`);
          continue;
        }
        const lockIn = E.daysUntilLock(env, transactions, dataSince);
        if (short > 0 && lockIn !== null && lockIn >= 0 && lockIn <= lead) {
          push(`lock-soon:${env.id}:${key}`, 'warn',
            `${env.name} locks ${lockIn === 0 ? 'today' : `in ${lockIn} day${lockIn === 1 ? '' : 's'}`}`,
            `Autopay of ${E.money(amount)} on ${fmtDay(due)}. ${E.money(short)} short.`);
        }
        if (days === 1 || days === 0) {
          push(`autopay:${env.id}:${key}`, short > 0 ? 'warn' : 'info',
            `${env.name} autopays ${days === 0 ? 'today' : 'tomorrow'}`,
            `${E.money(amount)}. ${short > 0 ? `${E.money(short)} short. Your bank will pull the full amount.` : 'Covered ✓'}`);
        }
        continue;
      }

      // Manual-pay bills: a heads-up at the lead time, then tomorrow, then today.
      // Each stage fires once; whichever the check lands on first is sent.
      if (days === 0) {
        push(`due-0:${env.id}:${key}`, 'warn', `${env.name} is due today`, `${E.money(amount)}. ${funding}`);
      } else if (days === 1) {
        push(`due-1:${env.id}:${key}`, 'warn', `${env.name} is due tomorrow`, `${E.money(amount)} on ${fmtDay(due)}. ${funding}`);
      } else if (days > 1 && days <= lead) {
        push(`due-lead:${env.id}:${key}`, 'info', `${env.name} is due in ${days} days`, `${E.money(amount)} on ${fmtDay(due)}. ${funding}`);
      }
    }
  }

  // ── New transactions to sort ──────────────────────────────────────────────
  if (prefs.sort) {
    const fresh = needsSort.filter(t => !already(`tx:${t.id}`));
    if (fresh.length) {
      const waiting = (state.unmapped || []).length + needsSort.length;
      const list = fresh.slice(0, 3).map(t => `${t.desc} ${E.money(Math.abs(t.amount))}`).join(' · ');
      out.push({
        keys: fresh.map(t => `tx:${t.id}`),
        level: 'info',
        title: `${fresh.length} new transaction${fresh.length === 1 ? '' : 's'} to sort`,
        body: list + (fresh.length > 3 ? ` +${fresh.length - 3} more` : '') + (waiting > fresh.length ? ` (${waiting} waiting)` : ''),
        url: '/?sync=1',
        tag: 'sort',
      });
    }
  }

  // ── Low Safe to Spend ─────────────────────────────────────────────────────
  // Only on a fresh balance — warning off a stale number would cry wolf.
  if (prefs.lowBalance && accounts) {
    const checking = accounts
      .filter(a => a.type === 'depository' && a.subtype !== 'savings')
      .reduce((s, a) => s + (a.available ?? a.balance ?? 0), 0);
    const sts = E.safeToSpend(envs, checking);
    const threshold = Number(prefs.lowThreshold) || 0;
    const k = `low:${dayKey(today)}`;
    if (sts < threshold && !already(k)) {
      out.push({
        keys: [k],
        level: sts < 0 ? 'critical' : 'warn',
        title: sts < 0 ? `Safe to Spend is negative: ${E.money(sts)}` : `Safe to Spend is down to ${E.money(sts)}`,
        body: `${E.money(checking)} in checking, ${E.money(E.totalFunded(envs))} set aside. Your alert is at ${E.money(threshold)}.`,
        url: '/',
        tag: 'low-balance',
      });
    }
  }

  // ── 0% promo cliffs ───────────────────────────────────────────────────────
  if (prefs.promo) {
    for (const env of envs) {
      const risk = E.promoRisk(env);
      if (!risk) continue;
      const url = `/?open=${encodeURIComponent(env.id)}`;
      let k = null, title, body, level = 'warn';

      if (risk.status === 'ok') {
        // Countdown milestones while a balance is still riding the promo.
        const bucket = [7, 30].find(b => risk.daysLeft <= b);
        if (!bucket) continue;
        k = `promo-left:${env.id}:${env.promoEndDate}:${bucket}`;
        title = `${env.name}: 0% ends in ${risk.daysLeft} day${risk.daysLeft === 1 ? '' : 's'}`;
        body = `${E.money(env.currentBalance)} still owed.` +
          (env.postPromoAPR ? ` After that it starts accruing at ${env.postPromoAPR}% APR.` : '');
      } else {
        // Re-raised monthly while the risk persists.
        k = `promo:${env.id}:${risk.status}:${dayKey(today).slice(0, 7)}`;
        level = risk.status === 'expired' ? 'critical' : 'warn';
        title = `${env.name}: 0% promo risk`;
        body = risk.message;
      }
      if (!already(k)) out.push({ keys: [k], level, title, body, url, tag: k });
    }
  }

  const order = { critical: 0, warn: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

module.exports = { computeNotifications, DEFAULT_PREFS };
