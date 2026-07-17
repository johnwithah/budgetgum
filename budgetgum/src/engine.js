// ═════════════════════════════════════════════════════════════════════════════
// engine.js — all the math. No React, no UI, no side effects.
//
// THE CORE IDEA
// -------------
// Almost nothing here is stored. It's derived, every render, from two inputs:
//   1. Your envelopes (the plan)
//   2. Your transactions from Plaid (what actually happened)
//
// "Is this bill paid?" is not a checkbox you tick — it's a question we ask the
// transaction list. That means you can never forget to reset it, and it can
// never disagree with your bank.
// ═════════════════════════════════════════════════════════════════════════════

// ── Envelope types ───────────────────────────────────────────────────────────
export const TYPES = {
  SPENDING:  "spending",   // groceries, gas — resets monthly, no deadline
  RECURRING: "recurring",  // netflix, insurance — fixed bill, has a due date
  DEBT:      "debt",       // credit card, loan — balance to pay DOWN by a date
  GOAL:      "goal",       // vacation, emergency fund — balance to build UP by a date
};

export const TYPE_META = {
  [TYPES.SPENDING]:  { label: "Spending",  blurb: "A monthly budget that resets. Groceries, gas, dining." },
  [TYPES.RECURRING]: { label: "Recurring", blurb: "A fixed bill on a schedule. Netflix, insurance, rent." },
  [TYPES.DEBT]:      { label: "Debt",      blurb: "Pay a balance down to zero by a date. Credit cards, loans." },
  [TYPES.GOAL]:      { label: "Goal",      blurb: "Save up to a target by a date. Vacation, new laptop." },
};

// Types that behave like bills — they show in the Bills tab, can autopay,
// and get a paid/unpaid state each period.
export const isBill = t => t === TYPES.RECURRING || t === TYPES.DEBT;
// Types that track a running balance toward a deadline.
export const hasTarget = t => t === TYPES.DEBT || t === TYPES.GOAL;

// ── Date helpers ─────────────────────────────────────────────────────────────
const DAY_MS = 86400000;

export const startOfDay = (d = new Date()) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate());

export const daysBetween = (a, b) =>
  Math.round((startOfDay(b) - startOfDay(a)) / DAY_MS);

export const isWeekend = d => d.getDay() === 0 || d.getDay() === 6;

// Walk backwards N *business* days. This matters more than it sounds: five
// business days before Monday the 19th is Monday the 12th, not Wednesday the
// 14th — the weekend eats two days. Getting this wrong by two days is exactly
// how you overdraft.
//
// (Federal holidays are not accounted for. A bank holiday could shift a lock
// date one day later than we show. Noted, not solved.)
export function subtractBusinessDays(date, n) {
  const d = new Date(date);
  let left = n;
  while (left > 0) {
    d.setDate(d.getDate() - 1);
    if (!isWeekend(d)) left -= 1;
  }
  return startOfDay(d);
}

// Clamp a day-of-month to a real day — dueDay 31 in February becomes the 28th/29th.
function clampDay(year, month, day) {
  const last = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, last));
}

// ── When is this bill next due? ──────────────────────────────────────────────
export function nextDueDate(env, from = new Date()) {
  if (!isBill(env.type)) return null;
  const today = startOfDay(from);

  if (env.frequency === "weekly") {
    // dueDay is 0–6 (Sun–Sat)
    const d = new Date(today);
    const diff = (env.dueDay - d.getDay() + 7) % 7;
    d.setDate(d.getDate() + diff);
    return d;
  }

  if (env.frequency === "annual") {
    // dueDate stored as "MM-DD"
    const [m, day] = (env.annualDate || "01-01").split("-").map(Number);
    let d = clampDay(today.getFullYear(), m - 1, day);
    if (d < today) d = clampDay(today.getFullYear() + 1, m - 1, day);
    return d;
  }

  // monthly (default)
  let d = clampDay(today.getFullYear(), today.getMonth(), env.dueDay || 1);
  if (d < today) d = clampDay(today.getFullYear(), today.getMonth() + 1, env.dueDay || 1);
  return d;
}

// The current billing period runs from one due date to the next. A payment
// "counts" for this period if it falls inside that window.
//
// This is what makes the ✓ self-clearing: once the due date passes, `nextDue`
// rolls forward, the window slides with it, and last month's payment falls out
// of range. You never uncheck anything.
export function periodStart(env, from = new Date()) {
  const next = nextDueDate(env, from);
  if (!next) return null;
  const d = new Date(next);
  if (env.frequency === "weekly")      d.setDate(d.getDate() - 7);
  else if (env.frequency === "annual") d.setFullYear(d.getFullYear() - 1);
  else                                 d.setMonth(d.getMonth() - 1);
  return startOfDay(d);
}

// ── What has actually been paid? ─────────────────────────────────────────────
// This reads real cleared transactions. Not your intentions.

export function txForEnvelope(env, transactions) {
  return transactions.filter(t => t.envelopeId === env.id);
}

// Total paid within the current billing period.
export function paidThisPeriod(env, transactions) {
  if (!isBill(env.type)) return 0;
  const start = periodStart(env);
  const end = nextDueDate(env);
  return transactions
    .filter(t => t.envelopeId === env.id)
    .filter(t => t.amount > 0)   // outflows only; ignore refunds/inflows
    .filter(t => {
      const d = startOfDay(new Date(t.date + "T00:00:00"));
      return d >= start && d < end;
    })
    .reduce((s, t) => s + t.amount, 0);
}

// Paid = any payment landed this period, OR you manually marked it.
// (Manual override exists for checks, cash, or when Plaid is slow.)
//
// Manual confirmations are stored per-period in `manualPaidPeriods` (an array of
// due-date keys). We also honor the legacy single `manualPaidPeriod` field so
// envelopes created before the archive existed still read correctly.
export function isPaid(env, transactions) {
  if (!isBill(env.type)) return false;
  const key = periodKey(env);
  if ((env.manualPaidPeriods || []).includes(key)) return true;
  if (env.manualPaidPeriod === key) return true;   // legacy
  return paidThisPeriod(env, transactions) > 0;
}

// A stable string identifying the current period, so a manual "mark paid"
// can be scoped to it and expire naturally.
export function periodKey(env) {
  const next = nextDueDate(env);
  return next ? next.toISOString().split("T")[0] : "";
}

// Step a due date back exactly one period. Used to walk history backwards.
export function prevDueDate(env, due) {
  const d = new Date(due);
  if (env.frequency === "weekly")      d.setDate(d.getDate() - 7);
  else if (env.frequency === "annual") d.setFullYear(d.getFullYear() - 1);
  else {
    // monthly — clamp so e.g. the 31st becomes the last valid day of the month
    const targetMonth = d.getMonth() - 1;
    const y = d.getFullYear();
    const last = new Date(y, targetMonth + 1, 0).getDate();
    return startOfDay(new Date(y, targetMonth, Math.min(env.dueDay || d.getDate(), last)));
  }
  return startOfDay(d);
}

// ═════════════════════════════════════════════════════════════════════════════
// THE ARCHIVE — frozen, per-period payment history
//
// The anti-anxiety feature. For each past (and current) billing period we ask
// one question of the real transaction record: was this satisfied, and with
// what? Because it's derived from the actual cleared transaction, the answer is
// permanent — the transaction IS the proof. Once "July: paid $127.40" is true,
// it stays true, because that payment doesn't move.
//
// Returns most-recent-first: [{ key, dueDate, label, paid, amount, paidDate,
// manual, missed }]. `missed` = a past period with no payment and no manual
// confirmation — the one state that deserves attention.
// ═════════════════════════════════════════════════════════════════════════════
export function paymentHistory(env, transactions, count = 6) {
  if (!isBill(env.type)) return [];
  const today = startOfDay();
  const manualSet = new Set([
    ...(env.manualPaidPeriods || []),
    ...(env.manualPaidPeriod ? [env.manualPaidPeriod] : []),   // legacy
  ]);

  const out = [];
  let due = nextDueDate(env);
  for (let i = 0; i < count && due; i++) {
    const windowStart = prevDueDate(env, due);
    const windowEnd = due;
    const key = due.toISOString().split("T")[0];

    const inWindow = transactions
      .filter(t => t.envelopeId === env.id && t.amount > 0)
      .filter(t => {
        const d = startOfDay(new Date(t.date + "T00:00:00"));
        return d >= windowStart && d < windowEnd;
      });

    const amount = inWindow.reduce((s, t) => s + t.amount, 0);
    const paidDate = inWindow.length
      ? inWindow.map(t => t.date).sort().slice(-1)[0]
      : null;

    const manual = manualSet.has(key);
    const paid = amount > 0 || manual;
    const isPast = windowEnd <= today;   // due date has passed

    out.push({
      key,
      dueDate: due,
      label: due.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
      shortLabel: due.toLocaleDateString("en-US", { month: "short" }),
      paid,
      amount,
      paidDate,
      manual,
      missed: isPast && !paid,
      upcoming: !isPast,
    });

    due = prevDueDate(env, due);
  }
  return out;
}

// ── Spending envelopes: how much of this month's budget is gone? ─────────────
export function spentThisMonth(env, transactions) {
  const now = new Date();
  const m = now.getMonth(), y = now.getFullYear();
  return transactions
    .filter(t => t.envelopeId === env.id)
    .filter(t => t.amount > 0)   // outflows only; a refund shouldn't inflate spending
    .filter(t => {
      const d = new Date(t.date + "T00:00:00");
      return d.getMonth() === m && d.getFullYear() === y;
    })
    .reduce((s, t) => s + t.amount, 0);
}

// ═════════════════════════════════════════════════════════════════════════════
// THE LOCK
// ═════════════════════════════════════════════════════════════════════════════
//
// An autopay ACH is initiated several business days before the due date. Once
// it's in flight, the money is leaving whether your budget agrees or not. So we
// stop pretending it's yours.
//
// Three zones of money:
//   SAFE      — in checking, unallocated. Spend freely.
//   FUNDED    — reserved in an envelope. You can pull it back out.
//   LOCKED    — autopay in flight. You cannot.
//
// The lock isn't really the feature. The *countdown* is — knowing four days
// out that a wall is coming is what lets you do something about it. By the time
// the lock lands, the money is either there or it isn't.

export function lockDate(env) {
  if (!env.autopay || !isBill(env.type)) return null;
  const due = nextDueDate(env);
  if (!due) return null;
  return subtractBusinessDays(due, env.autopayLeadDays ?? 5);
}

export function isLocked(env, transactions) {
  if (!env.autopay) return false;
  if (isPaid(env, transactions)) return false;   // already cleared, nothing in flight
  const lock = lockDate(env);
  if (!lock) return false;
  return startOfDay() >= lock;
}

export function daysUntilLock(env) {
  const lock = lockDate(env);
  return lock ? daysBetween(new Date(), lock) : null;
}

// ── What does this envelope want this period? ────────────────────────────────
export function targetAmount(env) {
  switch (env.type) {
    case TYPES.SPENDING:  return env.monthlyBudget || 0;
    case TYPES.RECURRING: return env.billAmount || 0;
    case TYPES.DEBT:      return suggestedPayment(env);
    case TYPES.GOAL:      return suggestedPayment(env);
    default: return 0;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// PAYOFF MATH — debts and goals
// ═════════════════════════════════════════════════════════════════════════════

// How many payment periods remain before the target date?
export function periodsRemaining(env, from = new Date()) {
  if (!env.targetDate) return null;
  const target = startOfDay(new Date(env.targetDate + "T00:00:00"));
  const today = startOfDay(from);
  if (target <= today) return 0;

  const days = daysBetween(today, target);
  if (env.frequency === "weekly") return Math.max(1, Math.ceil(days / 7));
  if (env.frequency === "annual") return Math.max(1, Math.ceil(days / 365));

  // monthly — count actual due dates between now and target
  let count = 0;
  let d = nextDueDate(env, today);
  while (d && d <= target && count < 600) {
    count += 1;
    d = clampDay(d.getFullYear(), d.getMonth() + 1, env.dueDay || 1);
  }
  return Math.max(count, 1);
}

// The number the app suggests but never enforces.
//
//   $6,000 owed, payoff Jan 19, monthly, 6 periods left → $1,000/mo
//
// Crucially this recalculates off the CURRENT balance. Pay $600 instead of
// $1,000 and next month's suggestion rises on its own — the app doesn't nag,
// it just tells you the truth about what it now takes.
export function suggestedPayment(env) {
  if (!hasTarget(env.type)) return 0;
  const remaining = env.type === TYPES.DEBT
    ? (env.currentBalance || 0)
    : Math.max(0, (env.targetAmount || 0) - (env.currentBalance || 0));
  const periods = periodsRemaining(env);
  if (!periods || remaining <= 0) return 0;
  return Math.ceil(remaining / periods);
}

// Progress toward payoff / savings goal, measured against the ORIGINAL balance
// so the bar reflects real ground covered.
export function progress(env) {
  if (!hasTarget(env.type)) return 0;
  if (env.type === TYPES.DEBT) {
    const orig = env.originalBalance || env.targetAmount || 0;
    if (!orig) return 0;
    const paidOff = orig - (env.currentBalance || 0);
    return Math.max(0, Math.min(100, (paidOff / orig) * 100));
  }
  const target = env.targetAmount || 0;
  if (!target) return 0;
  return Math.max(0, Math.min(100, ((env.currentBalance || 0) / target) * 100));
}

// Are you on schedule?
//
// Compares where your balance IS to where a straight-line plan says it SHOULD be.
// Negative = behind. This is the number that a silent recalculation would hide
// from you, and with a 0% promo deadline, hiding it is how you end up paying
// 24% APR on $4,000.
export function scheduleVariance(env) {
  if (env.type !== TYPES.DEBT || !env.targetDate || !env.startDate) return null;

  const start = startOfDay(new Date(env.startDate + "T00:00:00"));
  const target = startOfDay(new Date(env.targetDate + "T00:00:00"));
  const today = startOfDay();

  const totalDays = daysBetween(start, target);
  if (totalDays <= 0) return null;
  const elapsed = Math.max(0, Math.min(totalDays, daysBetween(start, today)));

  const orig = env.originalBalance || 0;
  const shouldOwe = orig * (1 - elapsed / totalDays);
  const actuallyOwe = env.currentBalance || 0;

  // positive = ahead of schedule, negative = behind
  return Math.round(shouldOwe - actuallyOwe);
}

// ── The 0% promo warning — the feature that's actually worth money ───────────
//
// If you're carrying a balance on a 0% intro APR card, the promo end date is a
// cliff. Miss it and the remaining balance starts accruing at the real rate.
// Nobody's budget app tells you you're about to walk off it. This one does.
export function promoRisk(env) {
  if (env.type !== TYPES.DEBT || !env.promoEndDate || !env.currentBalance) return null;

  const promoEnd = startOfDay(new Date(env.promoEndDate + "T00:00:00"));
  const today = startOfDay();
  if (promoEnd <= today) {
    return { status: "expired", message: "0% period has ended" };
  }

  const target = env.targetDate ? startOfDay(new Date(env.targetDate + "T00:00:00")) : null;

  // Is the plan itself already set to finish after the promo dies?
  if (target && target > promoEnd) {
    const over = daysBetween(promoEnd, target);
    return {
      status: "plan_too_slow",
      daysOver: over,
      message: `Your payoff date is ${over} days after 0% ends`,
      exposedAmount: null,
    };
  }

  // The plan is fine. But is your actual pace fine?
  const variance = scheduleVariance(env);
  if (variance !== null && variance < 0) {
    const perPeriod = suggestedPayment(env);
    const periodsToPromo = periodsRemaining({ ...env, targetDate: env.promoEndDate });
    const projected = Math.max(0, (env.currentBalance || 0) - perPeriod * (periodsToPromo || 0));
    if (projected > 0) {
      return {
        status: "pace_too_slow",
        exposedAmount: Math.round(projected),
        message: `At this pace, ~$${Math.round(projected).toLocaleString()} will still be owed when 0% ends`,
      };
    }
  }

  const daysLeft = daysBetween(today, promoEnd);
  return { status: "ok", daysLeft, message: `${daysLeft} days of 0% left` };
}

// ═════════════════════════════════════════════════════════════════════════════
// SAFE TO SPEND
// ═════════════════════════════════════════════════════════════════════════════
//
//   Safe to Spend = real checking balance − everything currently reserved
//
// The bank balance is never fiction. That's the whole reason we anchor to it
// rather than to a monthly income figure, which for rideshare income would be
// out of date within a week.
//
// `funded` is money still sitting in checking but already spoken for. Once a
// payment clears, the money has physically left the account (so the balance
// drops on its own) and we release the funding — which is how paying $600 out
// of a $1,000-funded envelope hands you back $400.

export function totalFunded(envelopes) {
  return envelopes.reduce((s, e) => s + (e.funded || 0), 0);
}

export function safeToSpend(envelopes, checkingBalance) {
  return (checkingBalance || 0) - totalFunded(envelopes);
}

// How short is this envelope of what it needs?
export function shortfall(env, transactions) {
  if (!isBill(env.type)) return 0;
  if (isPaid(env, transactions)) return 0;
  return Math.max(0, targetAmount(env) - (env.funded || 0));
}

// ── The forecast: what's about to lock, and can you cover it? ────────────────
//
// This is the screen that does the real work. The lock is just a guardrail —
// this is what gives you time to act.
export function upcomingLocks(envelopes, transactions, withinDays = 7) {
  return envelopes
    .filter(e => e.autopay && isBill(e.type))
    .filter(e => !isPaid(e, transactions))
    .filter(e => !isLocked(e, transactions))
    .map(e => ({
      env: e,
      lockIn: daysUntilLock(e),
      needs: targetAmount(e),
      has: e.funded || 0,
      short: shortfall(e, transactions),
    }))
    .filter(x => x.lockIn !== null && x.lockIn <= withinDays)
    .sort((a, b) => a.lockIn - b.lockIn);
}

// ── Alerts ───────────────────────────────────────────────────────────────────
export function buildAlerts(envelopes, transactions, checkingBalance) {
  const alerts = [];
  const sts = safeToSpend(envelopes, checkingBalance);

  for (const env of envelopes) {
    if (!isBill(env.type)) continue;
    const paid = isPaid(env, transactions);
    const locked = isLocked(env, transactions);
    const short = shortfall(env, transactions);
    const due = nextDueDate(env);
    const daysToDue = due ? daysBetween(new Date(), due) : null;

    // 🚨 The loudest one: it's locked and underfunded. The bank is pulling the
    // full amount regardless. This is an overdraft warning, not a budget note.
    if (locked && short > 0) {
      alerts.push({
        level: "critical",
        env,
        title: `${env.name} autopay is locked and short`,
        body: `Needs ${money(targetAmount(env))}, only ${money(env.funded || 0)} set aside. Your bank will still pull the full amount.`,
      });
      continue;
    }

    // ⚠️ Locking soon and short — you still have time to fix it.
    const lockIn = daysUntilLock(env);
    if (env.autopay && !paid && lockIn !== null && lockIn >= 0 && lockIn <= 4 && short > 0) {
      alerts.push({
        level: "warn",
        env,
        title: `${env.name} locks in ${lockIn === 0 ? "today" : `${lockIn} day${lockIn === 1 ? "" : "s"}`}`,
        body: `${money(short)} short. ${sts >= short ? `You have ${money(sts)} safe to spend.` : `You only have ${money(sts)} safe to spend.`}`,
      });
      continue;
    }

    // Due soon, not autopay, not paid — just a reminder.
    if (!env.autopay && !paid && daysToDue !== null && daysToDue <= 5) {
      alerts.push({
        level: daysToDue <= 1 ? "warn" : "info",
        env,
        title: `${env.name} due ${daysToDue === 0 ? "today" : daysToDue === 1 ? "tomorrow" : `in ${daysToDue} days`}`,
        body: env.paymentUrl ? "Tap to pay" : `${money(targetAmount(env))} due`,
      });
    }
  }

  // Promo cliffs
  for (const env of envelopes) {
    const risk = promoRisk(env);
    if (risk && (risk.status === "pace_too_slow" || risk.status === "plan_too_slow" || risk.status === "expired")) {
      alerts.push({
        level: risk.status === "expired" ? "critical" : "warn",
        env,
        title: `${env.name} — 0% risk`,
        body: risk.message,
      });
    }
  }

  const order = { critical: 0, warn: 1, info: 2 };
  return alerts.sort((a, b) => order[a.level] - order[b.level]);
}

// ── Transaction matching ─────────────────────────────────────────────────────
//
// The whole "paid" mechanism is worthless if we can't tell that
// "AMEX EPAYMENT ACH PMT" is your Amex bill. So envelopes carry match patterns
// — and they LEARN. When you manually assign a transaction, we offer to
// remember the merchant. You train each bill once, then it's silent forever.

export function normalizeMerchant(desc) {
  return (desc || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(ach|pmt|payment|epayment|autopay|online|web|id|ref|des|indn|co)\b/g, " ")
    .replace(/\d{4,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchEnvelope(tx, envelopes) {
  const norm = normalizeMerchant(tx.desc);
  if (!norm) return null;
  for (const env of envelopes) {
    for (const pattern of env.matchPatterns || []) {
      if (norm.includes(pattern.toLowerCase())) return env.id;
    }
  }
  return null;
}

// ── Formatting ───────────────────────────────────────────────────────────────
export const money = n =>
  new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(n || 0);

export const shortDate = d =>
  d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";

export const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
