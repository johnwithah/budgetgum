import { useState, useEffect, useCallback, useMemo } from "react";

// ─── Theme ────────────────────────────────────────────────────────────────────
const T = {
  bg: "#0a0f0d", surface: "#111a14", card: "#172018", border: "#1f2e22",
  green: "#c5f135", greenDim: "#8aaa24", greenMuted: "#2a3a1a",
  text: "#e8f5e0", textMuted: "#7a9a7a", textDim: "#4a6a4a",
  red: "#ff5c5c", orange: "#ffaa44", yellow: "#ffe066",
  blue: "#66aaff", purple: "#cc88ff",
  float: "#3a2a5a", floatBorder: "#8866cc", floatText: "#cc88ff",
  savings: "#1a2a3a", savingsBorder: "#4488cc", savingsText: "#66aaff", savingsBar: "#44aaff",
  spend: "#1a2f1a", spendBorder: "#44cc88", spendText: "#44ffaa",
};

const css = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=DM+Sans:wght@300;400;500;600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: ${T.bg}; color: ${T.text}; font-family: 'DM Sans', sans-serif; min-height: 100vh; -webkit-font-smoothing: antialiased; }
  .app { max-width: 430px; margin: 0 auto; min-height: 100vh; position: relative; padding-bottom: 90px; }

  /* Header */
  .header {
    padding: 52px 20px 14px;
    background: linear-gradient(180deg, #0d1a0f 0%, ${T.bg} 100%);
    position: sticky; top: 0; z-index: 100;
    border-bottom: 1px solid ${T.border};
    backdrop-filter: blur(20px);
  }
  .header-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
  .logo { font-family: 'DM Mono', monospace; font-size: 18px; color: ${T.green}; letter-spacing: -0.5px; }
  .logo span { color: ${T.textMuted}; }
  .total-pill {
    background: ${T.greenMuted}; border: 1px solid ${T.green}33;
    border-radius: 20px; padding: 6px 14px;
    font-family: 'DM Mono', monospace; font-size: 13px; color: ${T.green};
  }

  /* Safe-to-spend bar */
  .sts-bar {
    background: ${T.spend}88; border: 1px solid ${T.spendBorder}44;
    border-radius: 12px; padding: 10px 14px;
    display: flex; align-items: center; justify-content: space-between;
    cursor: pointer; transition: border-color 0.2s;
  }
  .sts-bar:hover { border-color: ${T.spendBorder}88; }
  .sts-left { display: flex; align-items: center; gap: 8px; }
  .sts-dot { width: 7px; height: 7px; border-radius: 50%; background: ${T.spendText}; flex-shrink: 0; }
  .sts-label { font-size: 11px; color: ${T.spendText}; font-weight: 600; letter-spacing: 0.5px; }
  .sts-sub { font-size: 10px; color: ${T.spendText}88; margin-top: 1px; }
  .sts-amount { font-family: 'DM Mono', monospace; font-size: 18px; color: ${T.spendText}; font-weight: 500; }
  .sts-amount.negative { color: ${T.red}; }

  /* Tab bar */
  .tabbar {
    position: fixed; bottom: 0; left: 50%; transform: translateX(-50%);
    width: 100%; max-width: 430px;
    background: rgba(17,26,20,0.94); border-top: 1px solid ${T.border};
    backdrop-filter: blur(24px); display: flex; padding: 10px 0 24px; z-index: 200;
  }
  .tab {
    flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px;
    background: none; border: none; cursor: pointer;
    color: ${T.textDim}; font-size: 10px; font-family: 'DM Sans', sans-serif; transition: color 0.2s;
  }
  .tab.active { color: ${T.green}; }
  .tab-icon { font-size: 20px; position: relative; }
  .badge {
    position: absolute; top: -4px; right: -8px;
    background: ${T.red}; border-radius: 8px; font-size: 9px;
    color: #fff; padding: 1px 4px; font-weight: 700;
  }

  /* Float banner */
  .float-banner {
    margin: 12px 20px 0; background: ${T.float}22;
    border: 1px solid ${T.floatBorder}66; border-radius: 14px;
    padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; cursor: pointer;
  }
  .float-banner-left { display: flex; align-items: center; gap: 10px; }
  .float-dot { width: 8px; height: 8px; border-radius: 50%; background: ${T.floatText}; }
  .float-label { font-size: 12px; color: ${T.floatText}; font-weight: 500; letter-spacing: 0.3px; }
  .float-sublabel { font-size: 11px; color: ${T.floatText}88; margin-top: 2px; }
  .float-amount { font-family: 'DM Mono', monospace; font-size: 20px; color: ${T.floatText}; font-weight: 500; }

  /* Section */
  .section { padding: 16px 20px 0; }
  .section-label { font-size: 11px; color: ${T.textDim}; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 12px; font-weight: 600; }

  /* Envelope card */
  .envelope { background: ${T.card}; border: 1px solid ${T.border}; border-radius: 18px; margin-bottom: 12px; overflow: hidden; transition: border-color 0.2s; }
  .envelope.expanded { border-color: ${T.green}44; }
  .envelope-header { padding: 16px 18px; display: flex; align-items: center; gap: 12px; cursor: pointer; }
  .envelope-icon { font-size: 22px; }
  .envelope-info { flex: 1; min-width: 0; }
  .envelope-name { font-size: 15px; font-weight: 600; color: ${T.text}; }
  .envelope-sub { font-size: 12px; color: ${T.textMuted}; margin-top: 2px; }
  .envelope-right { text-align: right; }
  .envelope-balance { font-family: 'DM Mono', monospace; font-size: 17px; font-weight: 500; color: ${T.green}; }
  .envelope-balance.low { color: ${T.orange}; }
  .envelope-balance.empty { color: ${T.red}; }
  .envelope-chevron { font-size: 12px; color: ${T.textDim}; margin-left: 8px; transition: transform 0.2s; }
  .envelope-chevron.open { transform: rotate(90deg); }
  .envelope-progress { height: 3px; background: ${T.border}; }
  .envelope-progress-fill { height: 100%; background: ${T.green}; transition: width 0.4s; border-radius: 0 2px 2px 0; }
  .envelope-progress-fill.low { background: ${T.orange}; }
  .envelope-progress-fill.empty { background: ${T.red}; }
  .envelope-body { padding: 0 18px 18px; }
  .envelope-actions { display: flex; gap: 8px; margin-bottom: 16px; }

  .btn-sm {
    flex: 1; padding: 9px 0; border-radius: 10px; border: 1px solid ${T.border};
    background: ${T.surface}; color: ${T.text}; font-size: 12px; font-weight: 500;
    cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all 0.15s;
  }
  .btn-sm:hover { border-color: ${T.green}55; color: ${T.green}; }
  .btn-sm.primary { background: ${T.greenMuted}; border-color: ${T.green}55; color: ${T.green}; }

  /* Bills */
  .bills-label { font-size: 11px; color: ${T.textDim}; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 10px; font-weight: 600; }
  .bill-item { background: ${T.surface}; border: 1px solid ${T.border}; border-radius: 12px; padding: 12px 14px; margin-bottom: 8px; }
  .bill-item.paid { opacity: 0.5; }
  .bill-row { display: flex; align-items: center; justify-content: space-between; }
  .bill-left { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
  .bill-urgency { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
  .bill-name { font-size: 14px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bill-due { font-size: 11px; color: ${T.textMuted}; margin-top: 2px; }
  .bill-amount-col { text-align: right; flex-shrink: 0; }
  .bill-amount { font-family: 'DM Mono', monospace; font-size: 15px; font-weight: 500; }
  .bill-min-label { font-size: 10px; color: ${T.orange}; margin-top: 2px; }
  .bill-toggle-row { display: flex; align-items: center; gap: 8px; margin-top: 10px; padding-top: 10px; border-top: 1px solid ${T.border}; }
  .toggle-label { font-size: 11px; color: ${T.textMuted}; flex: 1; }
  .toggle-switch { position: relative; width: 40px; height: 22px; cursor: pointer; }
  .toggle-track { position: absolute; top: 0; left: 0; right: 0; bottom: 0; border-radius: 11px; background: ${T.border}; transition: background 0.2s; }
  .toggle-track.on { background: ${T.greenMuted}; border: 1px solid ${T.green}55; }
  .toggle-thumb { position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: ${T.textDim}; transition: transform 0.2s, background 0.2s; }
  .toggle-thumb.on { transform: translateX(18px); background: ${T.green}; }
  .bill-pay-btn { padding: 6px 14px; border-radius: 8px; border: 1px solid ${T.green}44; background: ${T.greenMuted}; color: ${T.green}; font-size: 12px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all 0.15s; margin-top: 10px; width: 100%; }
  .bill-paid-badge { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: ${T.green}; margin-top: 10px; background: ${T.greenMuted}; border-radius: 6px; padding: 4px 8px; }
  .bill-link-row { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
  .bill-pay-link {
    flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px;
    padding: 9px 14px; border-radius: 8px; text-decoration: none;
    background: ${T.surface}; border: 1px solid ${T.blue}44; color: ${T.blue};
    font-size: 12px; font-weight: 600; font-family: 'DM Sans', sans-serif;
    transition: border-color 0.15s, background 0.15s;
  }
  .bill-pay-link:hover { background: ${T.blue}11; border-color: ${T.blue}88; }
  .bill-pay-link-sub { font-size: 10px; color: ${T.textDim}; margin-top: 3px; text-align: center; }
  .bill-link-edit-btn { background: none; border: 1px solid ${T.border}; border-radius: 8px; color: ${T.textDim}; font-size: 11px; padding: 8px 10px; cursor: pointer; font-family: 'DM Sans', sans-serif; white-space: nowrap; flex-shrink: 0; }
  .bill-link-edit-btn:hover { border-color: ${T.blue}44; color: ${T.blue}; }
  .bill-link-add-btn { width: 100%; padding: 9px; border-radius: 8px; border: 1px dashed ${T.border}; background: none; color: ${T.textDim}; font-size: 12px; cursor: pointer; font-family: 'DM Sans', sans-serif; margin-top: 10px; transition: border-color 0.15s, color 0.15s; }
  .bill-link-add-btn:hover { border-color: ${T.blue}44; color: ${T.blue}; }

  /* Forms */
  .add-bill-form { margin-top: 12px; }
  .form-row { display: flex; gap: 8px; margin-bottom: 8px; }
  .form-input { flex: 1; background: ${T.surface}; border: 1px solid ${T.border}; border-radius: 10px; color: ${T.text}; font-size: 14px; padding: 10px 12px; font-family: 'DM Sans', sans-serif; outline: none; transition: border-color 0.2s; width: 100%; }
  .form-input:focus { border-color: ${T.green}55; }
  .form-input::placeholder { color: ${T.textDim}; }
  .form-label { font-size: 11px; color: ${T.textDim}; margin-bottom: 4px; display: block; }
  .form-group { flex: 1; }
  .checkbox-row { display: flex; align-items: center; gap: 8px; font-size: 13px; color: ${T.textMuted}; cursor: pointer; }
  .checkbox-row input { accent-color: ${T.green}; width: 16px; height: 16px; cursor: pointer; }

  /* Sheets / Overlays */
  .overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 300; display: flex; align-items: flex-end; backdrop-filter: blur(4px); }
  .sheet { width: 100%; max-width: 430px; margin: 0 auto; background: ${T.surface}; border-radius: 24px 24px 0 0; border-top: 1px solid ${T.border}; padding: 20px 20px 40px; animation: slideUp 0.25s ease; max-height: 90vh; overflow-y: auto; }
  @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
  .sheet-handle { width: 36px; height: 4px; background: ${T.border}; border-radius: 2px; margin: 0 auto 20px; }
  .sheet-title { font-size: 18px; font-weight: 700; margin-bottom: 20px; }
  .btn-full { width: 100%; padding: 14px; border-radius: 14px; border: none; background: ${T.green}; color: ${T.bg}; font-size: 15px; font-weight: 700; cursor: pointer; font-family: 'DM Sans', sans-serif; margin-top: 8px; transition: opacity 0.15s; }
  .btn-full:hover { opacity: 0.9; }
  .btn-full.secondary { background: ${T.surface}; border: 1px solid ${T.border}; color: ${T.text}; }

  /* Bills tab */
  .bills-tab { padding: 16px 20px 0; }
  .upcoming-bill { background: ${T.card}; border: 1px solid ${T.border}; border-radius: 16px; padding: 14px 16px; margin-bottom: 10px; display: flex; align-items: center; gap: 14px; }
  .upcoming-bill.urgent { border-color: ${T.red}44; }
  .upcoming-bill.soon { border-color: ${T.orange}44; }
  .upcoming-urgency-bar { width: 3px; border-radius: 2px; height: 48px; flex-shrink: 0; }
  .upcoming-info { flex: 1; min-width: 0; }
  .upcoming-name { font-size: 15px; font-weight: 600; }
  .upcoming-meta { font-size: 12px; color: ${T.textMuted}; margin-top: 3px; }
  .upcoming-right { text-align: right; }
  .upcoming-amount { font-family: 'DM Mono', monospace; font-size: 17px; font-weight: 500; }
  .upcoming-env { font-size: 11px; color: ${T.textMuted}; margin-top: 3px; }

  /* Savings */
  .savings-card { background: ${T.savings}88; border: 1px solid ${T.savingsBorder}44; border-radius: 18px; margin-bottom: 12px; overflow: hidden; transition: border-color 0.2s; }
  .savings-card.expanded { border-color: ${T.savingsBorder}99; }
  .savings-goal-bar-track { height: 6px; background: ${T.border}; margin: 0 18px; }
  .savings-goal-bar-fill { height: 100%; border-radius: 0 3px 3px 0; background: linear-gradient(90deg, ${T.savingsBar}88, ${T.savingsBar}); transition: width 0.5s ease; }
  .savings-goal-bar-fill.complete { background: ${T.green}; }
  .savings-stats { display: flex; justify-content: space-between; padding: 8px 18px 14px; }
  .savings-stat-label { font-size: 11px; color: ${T.textDim}; }
  .savings-stat-val { font-family: 'DM Mono', monospace; font-size: 12px; color: ${T.savingsText}; margin-top: 2px; }
  .savings-stat-val.complete { color: ${T.green}; }
  .savings-complete-badge { display: inline-flex; align-items: center; gap: 6px; background: ${T.greenMuted}; border: 1px solid ${T.green}44; border-radius: 8px; padding: 6px 12px; font-size: 12px; color: ${T.green}; font-weight: 600; margin-bottom: 12px; width: 100%; justify-content: center; }
  .savings-contribute-row { display: flex; gap: 8px; margin-bottom: 8px; }
  .savings-history { margin-top: 12px; }
  .savings-history-item { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid ${T.border}; font-size: 13px; }
  .savings-history-item:last-child { border-bottom: none; }
  .savings-history-date { color: ${T.textMuted}; font-size: 11px; }
  .savings-history-amt { font-family: 'DM Mono', monospace; }

  /* ── Calendar tab ── */
  .cal-wrap { padding: 16px 20px 0; }
  .cal-nav { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
  .cal-month { font-size: 17px; font-weight: 700; }
  .cal-nav-btn { background: ${T.card}; border: 1px solid ${T.border}; border-radius: 8px; color: ${T.text}; font-size: 16px; width: 34px; height: 34px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
  .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; margin-bottom: 16px; }
  .cal-dow { text-align: center; font-size: 10px; color: ${T.textDim}; font-weight: 600; letter-spacing: 0.5px; padding: 4px 0; }
  .cal-cell {
    aspect-ratio: 1; border-radius: 10px; display: flex; flex-direction: column;
    align-items: center; justify-content: flex-start; padding-top: 6px;
    cursor: pointer; transition: background 0.15s; position: relative;
    background: transparent;
  }
  .cal-cell:hover { background: ${T.card}; }
  .cal-cell.today { background: ${T.greenMuted}; border: 1px solid ${T.green}44; }
  .cal-cell.has-bills { background: ${T.card}; }
  .cal-cell.other-month { opacity: 0.3; }
  .cal-cell.selected { background: ${T.green}22; border: 1px solid ${T.green}66; }
  .cal-day-num { font-size: 12px; font-weight: 500; line-height: 1; }
  .cal-cell.today .cal-day-num { color: ${T.green}; font-weight: 700; }
  .cal-dots { display: flex; gap: 2px; margin-top: 3px; flex-wrap: wrap; justify-content: center; }
  .cal-dot { width: 5px; height: 5px; border-radius: 50%; }
  .cal-detail { background: ${T.card}; border: 1px solid ${T.border}; border-radius: 16px; padding: 16px; margin-bottom: 12px; }
  .cal-detail-date { font-size: 13px; color: ${T.textMuted}; margin-bottom: 12px; font-weight: 600; }
  .cal-bill-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid ${T.border}; }
  .cal-bill-row:last-child { border-bottom: none; }
  .cal-bill-left { display: flex; align-items: center; gap: 10px; }
  .cal-bill-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .cal-bill-name { font-size: 14px; font-weight: 500; }
  .cal-bill-env { font-size: 11px; color: ${T.textMuted}; margin-top: 2px; }
  .cal-bill-amount { font-family: 'DM Mono', monospace; font-size: 15px; font-weight: 500; }

  /* ── Transactions tab ── */
  .txn-wrap { padding: 0 20px; }
  .txn-toolbar { display: flex; gap: 8px; padding: 16px 0 12px; align-items: center; }
  .txn-search { flex: 1; background: ${T.card}; border: 1px solid ${T.border}; border-radius: 10px; color: ${T.text}; font-size: 13px; padding: 9px 12px; font-family: 'DM Sans', sans-serif; outline: none; }
  .txn-search::placeholder { color: ${T.textDim}; }
  .txn-filter-btn { background: ${T.card}; border: 1px solid ${T.border}; border-radius: 10px; color: ${T.textMuted}; font-size: 12px; padding: 9px 12px; cursor: pointer; white-space: nowrap; font-family: 'DM Sans', sans-serif; }
  .txn-filter-btn.active { border-color: ${T.green}55; color: ${T.green}; background: ${T.greenMuted}; }
  .txn-import-btn { background: ${T.card}; border: 1px solid ${T.savingsBorder}44; border-radius: 10px; color: ${T.savingsText}; font-size: 12px; padding: 9px 12px; cursor: pointer; white-space: nowrap; font-family: 'DM Sans', sans-serif; }
  .txn-group-label { font-size: 11px; color: ${T.textDim}; letter-spacing: 1px; text-transform: uppercase; font-weight: 600; padding: 12px 0 8px; }
  .txn-item { background: ${T.card}; border: 1px solid ${T.border}; border-radius: 14px; padding: 12px 14px; margin-bottom: 8px; transition: border-color 0.15s; }
  .txn-item.assigned { border-color: ${T.green}33; }
  .txn-item.matched { border-color: ${T.green}66; background: ${T.greenMuted}22; }
  .txn-row { display: flex; align-items: center; gap: 12px; }
  .txn-icon { font-size: 22px; background: ${T.surface}; border-radius: 10px; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .txn-info { flex: 1; min-width: 0; }
  .txn-name { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .txn-meta { font-size: 11px; color: ${T.textMuted}; margin-top: 2px; }
  .txn-right { text-align: right; flex-shrink: 0; }
  .txn-amount { font-family: 'DM Mono', monospace; font-size: 16px; font-weight: 500; }
  .txn-amount.debit { color: ${T.red}; }
  .txn-amount.credit { color: ${T.green}; }
  .txn-assigned-tag { font-size: 10px; color: ${T.green}; background: ${T.greenMuted}; border-radius: 5px; padding: 2px 6px; margin-top: 3px; display: inline-block; }
  .txn-actions { display: flex; gap: 6px; margin-top: 10px; padding-top: 10px; border-top: 1px solid ${T.border}; }
  .txn-assign-select { flex: 1; background: ${T.surface}; border: 1px solid ${T.border}; border-radius: 8px; color: ${T.text}; font-size: 12px; padding: 7px 10px; font-family: 'DM Sans', sans-serif; outline: none; }
  .txn-assign-btn { padding: 7px 14px; border-radius: 8px; border: 1px solid ${T.green}44; background: ${T.greenMuted}; color: ${T.green}; font-size: 12px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; }
  .txn-match-btn { padding: 7px 14px; border-radius: 8px; border: 1px solid ${T.green}66; background: ${T.green}; color: ${T.bg}; font-size: 12px; font-weight: 700; cursor: pointer; font-family: 'DM Sans', sans-serif; }
  .txn-plaid-banner { background: ${T.savings}88; border: 1px solid ${T.savingsBorder}44; border-radius: 14px; padding: 16px; margin-bottom: 16px; }
  .txn-plaid-title { font-size: 14px; font-weight: 600; color: ${T.savingsText}; margin-bottom: 4px; }
  .txn-plaid-sub { font-size: 12px; color: ${T.textMuted}; }

  /* Float modal */
  .float-move-item { display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid ${T.border}; }
  .float-move-name { font-size: 14px; font-weight: 500; }
  .float-move-bal { font-size: 12px; color: ${T.textMuted}; margin-top: 2px; }
  .btn-move { padding: 7px 16px; border-radius: 8px; border: 1px solid ${T.green}44; background: ${T.greenMuted}; color: ${T.green}; font-size: 12px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; }

  /* Empty */
  .empty { text-align: center; padding: 48px 20px; color: ${T.textDim}; }
  .empty-icon { font-size: 40px; margin-bottom: 12px; }
  .empty-title { font-size: 16px; color: ${T.textMuted}; margin-bottom: 6px; }
  .empty-sub { font-size: 13px; }
`;

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n || 0);
const fmtD = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n || 0));
const today = new Date();
const todayY = today.getFullYear(), todayM = today.getMonth(), todayD = today.getDate();

const daysUntil = (dayOfMonth) => {
  const due = new Date(todayY, todayM, dayOfMonth);
  if (due < today) due.setMonth(due.getMonth() + 1);
  return Math.ceil((due - today) / 86400000);
};
const urgencyColor = (days) => days <= 3 ? T.red : days <= 7 ? T.orange : days <= 14 ? T.yellow : T.green;
const urgencyClass = (days) => days <= 3 ? "urgent" : days <= 7 ? "soon" : "";
const ordinal = (n) => { const s = ["th","st","nd","rd"]; const v = n % 100; return s[(v-20)%10] || s[v] || s[0]; };
const txnIcon = (name) => {
  const n = (name || "").toLowerCase();
  if (n.includes("amazon") || n.includes("shop")) return "🛍️";
  if (n.includes("uber") || n.includes("lyft") || n.includes("gas")) return "🚗";
  if (n.includes("netflix") || n.includes("hulu") || n.includes("spotify")) return "🎵";
  if (n.includes("grocer") || n.includes("publix") || n.includes("walmart") || n.includes("food")) return "🛒";
  if (n.includes("restaurant") || n.includes("cafe") || n.includes("coffee") || n.includes("pizza")) return "🍕";
  if (n.includes("electric") || n.includes("utility") || n.includes("power")) return "💡";
  if (n.includes("rent") || n.includes("mortgage")) return "🏠";
  if (n.includes("insurance")) return "🛡️";
  if (n.includes("gym") || n.includes("fitness")) return "🏋️";
  if (n.includes("transfer") || n.includes("deposit") || n.includes("payroll")) return "💰";
  return "💳";
};

const LS_KEY = "bg_envelopes_v2";
const LS_FLOAT = "bg_float_v2";
const LS_SAVINGS = "bg_savings_v1";
const LS_INCOME = "bg_income_v1";
const LS_TXN = "bg_txn_v1";

// ─── Default Data ─────────────────────────────────────────────────────────────
const DEFAULT_ENVELOPES = [
  { id: "e1", name: "Rent", icon: "🏠", balance: 1200, allocated: 1350, bills: [] },
  { id: "e2", name: "Groceries", icon: "🛒", balance: 280, allocated: 350, bills: [] },
  { id: "e3", name: "Transport", icon: "🚗", balance: 180, allocated: 220, bills: [] },
  { id: "e4", name: "Chase Sapphire", icon: "💳", balance: 340, allocated: 400, bills: [
    { id: "b1", name: "Chase Sapphire Min", goalAmount: 150, minAmount: 25, dueDay: 15, recurrence: "monthly", isCreditCard: true, useMin: false, paid: false, paidDate: null, loginUrl: "https://chase.com/login" },
  ]},
  { id: "e5", name: "Utilities", icon: "💡", balance: 90, allocated: 120, bills: [
    { id: "b2", name: "Electric & Gas", goalAmount: 90, minAmount: 90, dueDay: 20, recurrence: "monthly", isCreditCard: false, useMin: false, paid: false, paidDate: null, loginUrl: "https://sceg.com" },
  ]},
  { id: "e6", name: "Entertainment", icon: "🎵", balance: 50, allocated: 80, bills: [] },
];

// Sandbox demo transactions
const DEMO_TRANSACTIONS = [
  { id: "t1", name: "Publix Supermarkets", amount: -87.43, date: "2025-06-03", source: "plaid", assignedEnv: null, matchedBill: null },
  { id: "t2", name: "Netflix", amount: -15.49, date: "2025-06-02", source: "plaid", assignedEnv: null, matchedBill: null },
  { id: "t3", name: "Uber", amount: -12.80, date: "2025-06-02", source: "plaid", assignedEnv: null, matchedBill: null },
  { id: "t4", name: "Chase Card Payment", amount: -150.00, date: "2025-06-01", source: "plaid", assignedEnv: null, matchedBill: null },
  { id: "t5", name: "Payroll Deposit", amount: 2400.00, date: "2025-06-01", source: "plaid", assignedEnv: null, matchedBill: null },
  { id: "t6", name: "SCE&G Electric", amount: -89.12, date: "2025-05-31", source: "plaid", assignedEnv: null, matchedBill: null },
  { id: "t7", name: "Amazon", amount: -34.99, date: "2025-05-30", source: "plaid", assignedEnv: null, matchedBill: null },
  { id: "t8", name: "Spotify", amount: -10.99, date: "2025-05-29", source: "plaid", assignedEnv: null, matchedBill: null },
];

// ─── Toggle ───────────────────────────────────────────────────────────────────
function Toggle({ on, onChange }) {
  return (
    <label className="toggle-switch" onClick={() => onChange(!on)}>
      <div className={`toggle-track${on ? " on" : ""}`}>
        <div className={`toggle-thumb${on ? " on" : ""}`} />
      </div>
    </label>
  );
}

// ─── Bill Item ────────────────────────────────────────────────────────────────
function BillItem({ bill, envelopeBalance, onToggleMin, onMarkPaid, onUpdateUrl }) {
  const [editingUrl, setEditingUrl] = useState(false);
  const [urlDraft, setUrlDraft] = useState(bill.loginUrl || "");
  const days = daysUntil(bill.dueDay);
  const color = urgencyColor(days);
  const activeAmount = bill.useMin ? bill.minAmount : bill.goalAmount;
  const canAfford = envelopeBalance >= activeAmount;

  const saveUrl = () => {
    let url = urlDraft.trim();
    if (url && !url.startsWith("http")) url = "https://" + url;
    onUpdateUrl(url);
    setUrlDraft(url);
    setEditingUrl(false);
  };

  return (
    <div className={`bill-item${bill.paid ? " paid" : ""}`}>
      <div className="bill-row">
        <div className="bill-left">
          <div className="bill-urgency" style={{ background: bill.paid ? T.textDim : color }} />
          <div>
            <div className="bill-name">{bill.name}</div>
            <div className="bill-due">{bill.paid ? `Paid ${bill.paidDate}` : `Due the ${bill.dueDay}${ordinal(bill.dueDay)} · ${days}d away`}</div>
          </div>
        </div>
        <div className="bill-amount-col">
          <div className="bill-amount" style={{ color: canAfford ? T.text : T.red }}>{fmt(activeAmount)}</div>
          {bill.useMin && <div className="bill-min-label">min only</div>}
        </div>
      </div>

      {bill.isCreditCard && !bill.paid && (
        <div className="bill-toggle-row">
          <div className="toggle-label">{bill.useMin ? `Paying min · ${fmt(bill.goalAmount - bill.minAmount)} → Float` : `Paying goal · saves ${fmt(bill.goalAmount - bill.minAmount)} vs min`}</div>
          <Toggle on={!bill.useMin} onChange={(val) => onToggleMin(!val)} />
        </div>
      )}

      {/* Pay online link */}
      {!bill.paid && (
        <>
          {bill.loginUrl && !editingUrl ? (
            <div className="bill-link-row">
              <a className="bill-pay-link" href={bill.loginUrl} target="_blank" rel="noopener noreferrer">
                🔗 Pay Online
              </a>
              <button className="bill-link-edit-btn" onClick={() => { setUrlDraft(bill.loginUrl); setEditingUrl(true); }}>Edit</button>
            </div>
          ) : editingUrl ? (
            <div style={{ marginTop: 10 }}>
              <input
                className="form-input"
                placeholder="https://chase.com/login"
                value={urlDraft}
                onChange={e => setUrlDraft(e.target.value)}
                onKeyDown={e => e.key === "Enter" && saveUrl()}
                autoFocus
                style={{ marginBottom: 6 }}
              />
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn-sm primary" onClick={saveUrl}>Save</button>
                <button className="btn-sm" onClick={() => setEditingUrl(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <div>
              <button className="bill-link-add-btn" onClick={() => setEditingUrl(true)}>
                + Add payment link · opens in Safari, Passwords autofills
              </button>
            </div>
          )}
          <div className="bill-pay-link-sub">
            {bill.loginUrl ? "Opens in Safari · Apple Passwords autofills your login" : ""}
          </div>
        </>
      )}

      {!bill.paid && (
        <button className="bill-pay-btn" onClick={onMarkPaid} style={{ opacity: canAfford ? 1 : 0.6 }}>
          {canAfford ? "Mark as Paid ✓" : `⚠ Envelope short · ${fmt(envelopeBalance)} available`}
        </button>
      )}
      {bill.paid && <div className="bill-paid-badge"><span>✓</span> Paid {bill.paidDate}</div>}
    </div>
  );
}

// ─── Add Bill Form ────────────────────────────────────────────────────────────
function AddBillForm({ onAdd, onCancel }) {
  const [name, setName] = useState("");
  const [goalAmount, setGoalAmount] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [dueDay, setDueDay] = useState("");
  const [isCreditCard, setIsCreditCard] = useState(false);
  const [loginUrl, setLoginUrl] = useState("");
  const submit = () => {
    if (!name || !goalAmount || !dueDay) return;
    let url = loginUrl.trim();
    if (url && !url.startsWith("http")) url = "https://" + url;
    onAdd({ id: `b${Date.now()}`, name, goalAmount: parseFloat(goalAmount), minAmount: isCreditCard ? parseFloat(minAmount || goalAmount) : parseFloat(goalAmount), dueDay: parseInt(dueDay), recurrence: "monthly", isCreditCard, useMin: false, paid: false, paidDate: null, loginUrl: url || null });
  };
  return (
    <div className="add-bill-form">
      <div style={{ marginBottom: 8 }}>
        <label className="form-label">Bill name</label>
        <input className="form-input" placeholder="e.g. Netflix, Minimum Payment" value={name} onChange={e => setName(e.target.value)} />
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">{isCreditCard ? "Goal payment" : "Amount"}</label>
          <input className="form-input" placeholder="$0" type="number" value={goalAmount} onChange={e => setGoalAmount(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Due day</label>
          <input className="form-input" placeholder="15" type="number" min="1" max="31" value={dueDay} onChange={e => setDueDay(e.target.value)} />
        </div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <label className="checkbox-row">
          <input type="checkbox" checked={isCreditCard} onChange={e => setIsCreditCard(e.target.checked)} />
          Credit card bill (enable min/goal toggle)
        </label>
      </div>
      {isCreditCard && (
        <div style={{ marginBottom: 12 }}>
          <label className="form-label">Minimum payment</label>
          <input className="form-input" placeholder="$25" type="number" value={minAmount} onChange={e => setMinAmount(e.target.value)} />
        </div>
      )}
      <div style={{ marginBottom: 12 }}>
        <label className="form-label">Payment login URL (optional)</label>
        <input className="form-input" placeholder="chase.com/login" value={loginUrl} onChange={e => setLoginUrl(e.target.value)} />
        <div style={{ fontSize: 10, color: T.textDim, marginTop: 4 }}>Opens in Safari · Apple Passwords autofills your login</div>
      </div>
      <div className="form-row">
        <button className="btn-sm" onClick={onCancel}>Cancel</button>
        <button className="btn-sm primary" onClick={submit}>Add Bill</button>
      </div>
    </div>
  );
}

// ─── Envelope Card ────────────────────────────────────────────────────────────
function EnvelopeCard({ env, onUpdateEnvelope, onAddFloat }) {
  const [expanded, setExpanded] = useState(false);
  const [showAddBill, setShowAddBill] = useState(false);
  const [showAddFunds, setShowAddFunds] = useState(false);
  const [addAmount, setAddAmount] = useState("");
  const pct = Math.min((env.balance / env.allocated) * 100, 100);
  const balClass = env.balance <= 0 ? "empty" : env.balance < env.allocated * 0.25 ? "low" : "";
  const totalDue = env.bills.filter(b => !b.paid).reduce((s, b) => s + (b.useMin ? b.minAmount : b.goalAmount), 0);

  const handleToggleMin = useCallback((billId, useMin) => {
    const bill = env.bills.find(b => b.id === billId);
    if (!bill) return;
    const diff = bill.goalAmount - bill.minAmount;
    onUpdateEnvelope(env.id, { bills: env.bills.map(b => b.id === billId ? { ...b, useMin } : b) });
    if (useMin && diff > 0) onAddFloat(diff);
  }, [env, onUpdateEnvelope, onAddFloat]);

  const handleMarkPaid = useCallback((billId) => {
    const bill = env.bills.find(b => b.id === billId);
    if (!bill) return;
    const amount = bill.useMin ? bill.minAmount : bill.goalAmount;
    onUpdateEnvelope(env.id, {
      balance: Math.max(env.balance - amount, 0),
      bills: env.bills.map(b => b.id === billId ? { ...b, paid: true, paidDate: today.toLocaleDateString("en-US", { month: "short", day: "numeric" }) } : b),
    });
  }, [env, onUpdateEnvelope]);

  const handleUpdateBillUrl = useCallback((billId, url) => {
    onUpdateEnvelope(env.id, { bills: env.bills.map(b => b.id === billId ? { ...b, loginUrl: url } : b) });
  }, [env, onUpdateEnvelope]);

  const handleAddFunds = () => {
    const n = parseFloat(addAmount);
    if (!n || n <= 0) return;
    onUpdateEnvelope(env.id, { balance: env.balance + n, allocated: env.allocated + n });
    setAddAmount(""); setShowAddFunds(false);
  };

  return (
    <div className={`envelope${expanded ? " expanded" : ""}`}>
      <div className="envelope-header" onClick={() => setExpanded(e => !e)}>
        <div className="envelope-icon">{env.icon}</div>
        <div className="envelope-info">
          <div className="envelope-name">{env.name}</div>
          <div className="envelope-sub">{env.bills.length > 0 ? `${env.bills.filter(b => !b.paid).length} bill(s) · ${fmt(totalDue)} due` : `${fmt(env.allocated)} allocated`}</div>
        </div>
        <div className="envelope-right">
          <div className={`envelope-balance${balClass ? " " + balClass : ""}`}>{fmt(env.balance)}</div>
        </div>
        <div className={`envelope-chevron${expanded ? " open" : ""}`}>▶</div>
      </div>
      <div className="envelope-progress">
        <div className={`envelope-progress-fill${balClass ? " " + balClass : ""}`} style={{ width: `${pct}%` }} />
      </div>
      {expanded && (
        <div className="envelope-body">
          <div className="envelope-actions">
            <button className="btn-sm" onClick={() => { setShowAddFunds(f => !f); setShowAddBill(false); }}>+ Add Funds</button>
            <button className="btn-sm" onClick={() => { setShowAddBill(b => !b); setShowAddFunds(false); }}>+ Add Bill</button>
          </div>
          {showAddFunds && (
            <div className="form-row" style={{ marginBottom: 12 }}>
              <input className="form-input" placeholder="Amount" type="number" value={addAmount} onChange={e => setAddAmount(e.target.value)} />
              <button className="btn-sm primary" onClick={handleAddFunds}>Add</button>
            </div>
          )}
          {showAddBill && <AddBillForm onAdd={(bill) => { onUpdateEnvelope(env.id, { bills: [...env.bills, bill] }); setShowAddBill(false); }} onCancel={() => setShowAddBill(false)} />}
          {env.bills.length > 0 && (
            <>
              <div className="bills-label">Bills</div>
              {env.bills.map(bill => (
                <BillItem key={bill.id} bill={bill} envelopeBalance={env.balance}
                  onToggleMin={(useMin) => handleToggleMin(bill.id, useMin)}
                  onMarkPaid={() => handleMarkPaid(bill.id)}
                  onUpdateUrl={(url) => handleUpdateBillUrl(bill.id, url)} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Safe-to-Spend Bar ────────────────────────────────────────────────────────
function SafeToSpendBar({ income, envelopes, float, savings, onSetIncome }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(income));
  const totalAllocated = envelopes.reduce((s, e) => s + e.allocated, 0);
  const totalSavingsGoal = savings.reduce((s, j) => s + j.balance, 0);
  const safeToSpend = income - totalAllocated - totalSavingsGoal - float;

  if (editing) {
    return (
      <div className="sts-bar" style={{ gap: 8 }}>
        <span style={{ fontSize: 12, color: T.spendText, whiteSpace: "nowrap" }}>Monthly income:</span>
        <input
          className="form-input" type="number" value={draft}
          onChange={e => setDraft(e.target.value)}
          style={{ padding: "6px 10px", fontSize: 14, flex: 1 }}
          autoFocus
        />
        <button className="btn-sm primary" style={{ flex: "none", padding: "6px 14px" }}
          onClick={() => { onSetIncome(parseFloat(draft) || 0); setEditing(false); }}>
          Set
        </button>
      </div>
    );
  }

  return (
    <div className="sts-bar" onClick={() => { setDraft(String(income)); setEditing(true); }}>
      <div className="sts-left">
        <div className="sts-dot" style={{ background: safeToSpend < 0 ? T.red : T.spendText }} />
        <div>
          <div className="sts-label">Safe to Spend</div>
          <div className="sts-sub">{income > 0 ? `${fmt(income)} income · ${fmt(totalAllocated)} allocated` : "Tap to set monthly income"}</div>
        </div>
      </div>
      <div className={`sts-amount${safeToSpend < 0 ? " negative" : ""}`}>
        {income > 0 ? fmt(safeToSpend) : "—"}
      </div>
    </div>
  );
}

// ─── Float Banner ─────────────────────────────────────────────────────────────
function FloatBanner({ float, envelopes, onDistribute }) {
  const [open, setOpen] = useState(false);
  const [amounts, setAmounts] = useState({});
  if (float <= 0) return null;
  const handleDistribute = (envId) => {
    const n = parseFloat(amounts[envId]);
    if (!n || n <= 0 || n > float) return;
    onDistribute(envId, n);
    setAmounts(a => ({ ...a, [envId]: "" }));
  };
  return (
    <>
      <div className="float-banner" onClick={() => setOpen(true)}>
        <div className="float-banner-left">
          <div className="float-dot" />
          <div>
            <div className="float-label">Float · Unallocated</div>
            <div className="float-sublabel">Tap to distribute →</div>
          </div>
        </div>
        <div className="float-amount">{fmt(float)}</div>
      </div>
      {open && (
        <div className="overlay" onClick={() => setOpen(false)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-title">Distribute Float · {fmt(float)}</div>
            <p style={{ fontSize: 13, color: T.textMuted, marginBottom: 20 }}>Money freed up when you switched credit cards to minimum payment.</p>
            {envelopes.map(env => (
              <div className="float-move-item" key={env.id}>
                <div>
                  <div className="float-move-name">{env.icon} {env.name}</div>
                  <div className="float-move-bal">{fmt(env.balance)} in envelope</div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input className="form-input" style={{ width: 80, padding: "6px 10px", fontSize: 13 }} placeholder="$0" type="number"
                    value={amounts[env.id] || ""} onChange={e => setAmounts(a => ({ ...a, [env.id]: e.target.value }))} />
                  <button className="btn-move" onClick={() => handleDistribute(env.id)}>Move</button>
                </div>
              </div>
            ))}
            <button className="btn-full secondary" style={{ marginTop: 20 }} onClick={() => setOpen(false)}>Done</button>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Savings Card ─────────────────────────────────────────────────────────────
function SavingsCard({ jar, onUpdate }) {
  const [expanded, setExpanded] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const pct = jar.goalAmount > 0 ? Math.min((jar.balance / jar.goalAmount) * 100, 100) : 100;
  const remaining = Math.max(jar.goalAmount - jar.balance, 0);
  const complete = jar.balance >= jar.goalAmount;

  const contribute = (sign) => {
    const n = parseFloat(amount);
    if (!n || n <= 0) return;
    if (sign < 0 && n > jar.balance) return;
    const entry = { id: `c${Date.now()}`, amount: sign * n, note: note || (sign > 0 ? "Contribution" : "Withdrawal"), date: today.toLocaleDateString("en-US", { month: "short", day: "numeric" }) };
    onUpdate(jar.id, { balance: jar.balance + sign * n, history: [entry, ...(jar.history || [])] });
    setAmount(""); setNote("");
  };

  return (
    <div className={`savings-card${expanded ? " expanded" : ""}`}>
      <div className="envelope-header" onClick={() => setExpanded(e => !e)}>
        <div className="envelope-icon">{jar.icon}</div>
        <div className="envelope-info">
          <div className="envelope-name">{jar.name}</div>
          <div className="envelope-sub">{complete ? "Goal reached! 🎉" : `${fmt(remaining)} to go · ${Math.round(pct)}%`}</div>
        </div>
        <div className="envelope-right">
          <div className="envelope-balance" style={{ color: complete ? T.green : T.savingsText }}>{fmt(jar.balance)}</div>
          <div style={{ fontSize: 11, color: T.textDim, marginTop: 2 }}>of {fmt(jar.goalAmount)}</div>
        </div>
        <div className={`envelope-chevron${expanded ? " open" : ""}`}>▶</div>
      </div>
      <div className="savings-goal-bar-track">
        <div className={`savings-goal-bar-fill${complete ? " complete" : ""}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="savings-stats">
        <div><div className="savings-stat-label">Saved</div><div className={`savings-stat-val${complete ? " complete" : ""}`}>{fmt(jar.balance)}</div></div>
        <div style={{ textAlign: "center" }}><div className="savings-stat-label">Goal</div><div className="savings-stat-val">{fmt(jar.goalAmount)}</div></div>
        <div style={{ textAlign: "right" }}><div className="savings-stat-label">Remaining</div><div className="savings-stat-val">{complete ? "—" : fmt(remaining)}</div></div>
      </div>
      {expanded && (
        <div className="envelope-body" style={{ paddingTop: 0 }}>
          {complete && <div className="savings-complete-badge">🎉 Goal reached!</div>}
          <div style={{ marginBottom: 8 }}>
            <label className="form-label">Note (optional)</label>
            <input className="form-input" placeholder="e.g. paycheck, bonus..." value={note} onChange={e => setNote(e.target.value)} style={{ marginBottom: 8 }} />
            <div className="savings-contribute-row">
              <input className="form-input" placeholder="$0" type="number" value={amount} onChange={e => setAmount(e.target.value)} />
              <button className="btn-sm primary" onClick={() => contribute(1)}>+ Add</button>
              <button className="btn-sm" onClick={() => contribute(-1)} style={{ color: T.orange, borderColor: T.orange + "44" }}>− Take</button>
            </div>
          </div>
          {jar.history && jar.history.length > 0 && (
            <div className="savings-history">
              <div className="bills-label">History</div>
              {jar.history.slice(0, 6).map(h => (
                <div className="savings-history-item" key={h.id}>
                  <div><div style={{ fontSize: 13 }}>{h.note}</div><div className="savings-history-date">{h.date}</div></div>
                  <div className="savings-history-amt" style={{ color: h.amount < 0 ? T.orange : T.savingsText }}>{h.amount > 0 ? "+" : ""}{fmt(h.amount)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Bills Tab ────────────────────────────────────────────────────────────────
function BillsTab({ envelopes }) {
  const allBills = envelopes.flatMap(env => env.bills.map(b => ({ ...b, envName: env.name, envIcon: env.icon })))
    .filter(b => !b.paid).sort((a, b) => daysUntil(a.dueDay) - daysUntil(b.dueDay));
  if (allBills.length === 0) return (
    <div className="bills-tab"><div className="empty"><div className="empty-icon">📋</div><div className="empty-title">No upcoming bills</div><div className="empty-sub">Add bills inside your envelopes.</div></div></div>
  );
  return (
    <div className="bills-tab">
      <div className="section-label" style={{ paddingTop: 4, marginBottom: 16 }}>Upcoming Bills</div>
      {allBills.map(bill => {
        const days = daysUntil(bill.dueDay);
        const color = urgencyColor(days);
        const cls = urgencyClass(days);
        return (
          <div key={bill.id} className={`upcoming-bill${cls ? " " + cls : ""}`}>
            <div className="upcoming-urgency-bar" style={{ background: color }} />
            <div className="upcoming-info">
              <div className="upcoming-name">{bill.name}</div>
              <div className="upcoming-meta">Due the {bill.dueDay}{ordinal(bill.dueDay)} · {days === 0 ? "Today!" : `${days}d`}{bill.useMin && " · MIN only"}</div>
            </div>
            <div className="upcoming-right">
              <div className="upcoming-amount" style={{ color }}>{fmt(bill.useMin ? bill.minAmount : bill.goalAmount)}</div>
              <div className="upcoming-env">{bill.envIcon} {bill.envName}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Calendar Tab ─────────────────────────────────────────────────────────────
function CalendarTab({ envelopes }) {
  const [viewYear, setViewYear] = useState(todayY);
  const [viewMonth, setViewMonth] = useState(todayM);
  const [selectedDay, setSelectedDay] = useState(null);

  const allBills = envelopes.flatMap(env => env.bills.map(b => ({ ...b, envName: env.name, envIcon: env.icon })));

  const billsByDay = useMemo(() => {
    const map = {};
    allBills.forEach(bill => {
      const key = bill.dueDay;
      if (!map[key]) map[key] = [];
      map[key].push(bill);
    });
    return map;
  }, [allBills]);

  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();
  const monthName = new Date(viewYear, viewMonth, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const prevMonth = () => { if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); } else setViewMonth(m => m - 1); setSelectedDay(null); };
  const nextMonth = () => { if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); } else setViewMonth(m => m + 1); setSelectedDay(null); };

  // Build calendar cells
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push({ day: daysInPrevMonth - firstDay + 1 + i, cur: false });
  for (let i = 1; i <= daysInMonth; i++) cells.push({ day: i, cur: true });
  const remaining = 42 - cells.length;
  for (let i = 1; i <= remaining; i++) cells.push({ day: i, cur: false });

  const selectedBills = selectedDay ? (billsByDay[selectedDay] || []) : [];

  return (
    <div className="cal-wrap">
      <div className="cal-nav">
        <button className="cal-nav-btn" onClick={prevMonth}>‹</button>
        <div className="cal-month">{monthName}</div>
        <button className="cal-nav-btn" onClick={nextMonth}>›</button>
      </div>

      <div className="cal-grid">
        {["Su","Mo","Tu","We","Th","Fr","Sa"].map(d => <div key={d} className="cal-dow">{d}</div>)}
        {cells.map((cell, i) => {
          const bills = cell.cur ? (billsByDay[cell.day] || []) : [];
          const isToday = cell.cur && cell.day === todayD && viewMonth === todayM && viewYear === todayY;
          const isSelected = cell.cur && cell.day === selectedDay;
          return (
            <div key={i}
              className={`cal-cell${isToday ? " today" : ""}${bills.length > 0 ? " has-bills" : ""}${!cell.cur ? " other-month" : ""}${isSelected ? " selected" : ""}`}
              onClick={() => cell.cur && setSelectedDay(cell.day === selectedDay ? null : cell.day)}
            >
              <div className="cal-day-num">{cell.day}</div>
              {bills.length > 0 && (
                <div className="cal-dots">
                  {bills.slice(0, 3).map(b => {
                    const days = daysUntil(b.dueDay);
                    return <div key={b.id} className="cal-dot" style={{ background: b.paid ? T.textDim : urgencyColor(days) }} />;
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {selectedDay && (
        <div className="cal-detail">
          <div className="cal-detail-date">
            {new Date(viewYear, viewMonth, selectedDay).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </div>
          {selectedBills.length === 0 ? (
            <div style={{ fontSize: 13, color: T.textDim, textAlign: "center", padding: "12px 0" }}>No bills due this day</div>
          ) : selectedBills.map(bill => {
            const days = daysUntil(bill.dueDay);
            const color = bill.paid ? T.textDim : urgencyColor(days);
            return (
              <div key={bill.id} className="cal-bill-row">
                <div className="cal-bill-left">
                  <div className="cal-bill-dot" style={{ background: color }} />
                  <div>
                    <div className="cal-bill-name" style={{ color: bill.paid ? T.textMuted : T.text }}>{bill.name}</div>
                    <div className="cal-bill-env">{bill.envIcon} {bill.envName}{bill.paid ? " · Paid" : ""}</div>
                  </div>
                </div>
                <div className="cal-bill-amount" style={{ color }}>{fmt(bill.useMin ? bill.minAmount : bill.goalAmount)}</div>
              </div>
            );
          })}
        </div>
      )}

      {allBills.length === 0 && (
        <div className="empty"><div className="empty-icon">📅</div><div className="empty-title">No bills yet</div><div className="empty-sub">Add bills inside your envelopes to see them on the calendar.</div></div>
      )}
    </div>
  );
}

// ─── Transactions Tab ─────────────────────────────────────────────────────────
function TransactionsTab({ transactions, setTransactions, envelopes }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all"); // all | unassigned | credits
  const [expandedId, setExpandedId] = useState(null);
  const [assignSelections, setAssignSelections] = useState({});
  const [importing, setImporting] = useState(false);

  const filtered = useMemo(() => {
    return transactions.filter(t => {
      const matchSearch = t.name.toLowerCase().includes(search.toLowerCase());
      const matchFilter = filter === "all" ? true : filter === "unassigned" ? !t.assignedEnv : filter === "credits" ? t.amount > 0 : true;
      return matchSearch && matchFilter;
    });
  }, [transactions, search, filter]);

  // Group by date
  const grouped = useMemo(() => {
    const groups = {};
    filtered.forEach(t => {
      if (!groups[t.date]) groups[t.date] = [];
      groups[t.date].push(t);
    });
    return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
  }, [filtered]);

  const handleAssign = (txnId) => {
    const envId = assignSelections[txnId];
    if (!envId) return;
    setTransactions(prev => prev.map(t => t.id === txnId ? { ...t, assignedEnv: envId } : t));
    setExpandedId(null);
  };

  const handleMatchBill = (txnId, billId) => {
    setTransactions(prev => prev.map(t => t.id === txnId ? { ...t, matchedBill: billId } : t));
  };

  const handleManualImport = () => {
    setImporting(true);
    // Simulate a Plaid sync re-fetch with slight delay
    setTimeout(() => {
      setTransactions(DEMO_TRANSACTIONS);
      setImporting(false);
    }, 1200);
  };

  const unassignedCount = transactions.filter(t => !t.assignedEnv && t.amount < 0).length;

  const formatDate = (dateStr) => {
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  };

  // Get all bills for matching
  const allBills = envelopes.flatMap(env => env.bills.map(b => ({ ...b, envName: env.name })));

  return (
    <div className="txn-wrap">
      <div className="txn-toolbar">
        <input className="txn-search" placeholder="Search transactions..." value={search} onChange={e => setSearch(e.target.value)} />
        <button className={`txn-import-btn`} onClick={handleManualImport} disabled={importing}>
          {importing ? "Syncing…" : "⟳ Sync"}
        </button>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {["all","unassigned","credits"].map(f => (
          <button key={f} className={`txn-filter-btn${filter === f ? " active" : ""}`} onClick={() => setFilter(f)}>
            {f === "all" ? "All" : f === "unassigned" ? `Unassigned${unassignedCount > 0 ? ` (${unassignedCount})` : ""}` : "Credits"}
          </button>
        ))}
      </div>

      <div className="txn-plaid-banner">
        <div className="txn-plaid-title">🏦 Plaid · Sandbox Mode</div>
        <div className="txn-plaid-sub">Showing demo transactions. Once your Plaid Development access is approved, swap in your live secret key in Vercel env vars and real Ally transactions will appear here automatically.</div>
      </div>

      {grouped.length === 0 && (
        <div className="empty"><div className="empty-icon">🔍</div><div className="empty-title">No transactions found</div></div>
      )}

      {grouped.map(([date, txns]) => (
        <div key={date}>
          <div className="txn-group-label">{formatDate(date)}</div>
          {txns.map(t => {
            const isExpanded = expandedId === t.id;
            const assignedEnv = envelopes.find(e => e.id === t.assignedEnv);
            return (
              <div key={t.id} className={`txn-item${t.assignedEnv ? " assigned" : ""}${t.matchedBill ? " matched" : ""}`}>
                <div className="txn-row" onClick={() => setExpandedId(isExpanded ? null : t.id)} style={{ cursor: "pointer" }}>
                  <div className="txn-icon">{txnIcon(t.name)}</div>
                  <div className="txn-info">
                    <div className="txn-name">{t.name}</div>
                    <div className="txn-meta">
                      {t.source === "plaid" ? "Plaid · Ally" : "Manual"}
                      {assignedEnv && <span className="txn-assigned-tag"> → {assignedEnv.icon} {assignedEnv.name}</span>}
                    </div>
                  </div>
                  <div className="txn-right">
                    <div className={`txn-amount${t.amount > 0 ? " credit" : " debit"}`}>
                      {t.amount > 0 ? "+" : "−"}{fmtD(t.amount)}
                    </div>
                  </div>
                </div>

                {isExpanded && t.amount < 0 && (
                  <div className="txn-actions">
                    <select
                      className="txn-assign-select"
                      value={assignSelections[t.id] || t.assignedEnv || ""}
                      onChange={e => setAssignSelections(s => ({ ...s, [t.id]: e.target.value }))}
                    >
                      <option value="">Assign to envelope…</option>
                      {envelopes.map(env => <option key={env.id} value={env.id}>{env.icon} {env.name}</option>)}
                    </select>
                    <button className="txn-assign-btn" onClick={() => handleAssign(t.id)}>Assign</button>
                  </div>
                )}

                {isExpanded && t.assignedEnv && allBills.filter(b => b.envId === t.assignedEnv || envelopes.find(e => e.id === t.assignedEnv)?.bills.find(b2 => b2.id === b.id)).length > 0 && !t.matchedBill && (
                  <div style={{ marginTop: 8, padding: "8px 0 0", borderTop: `1px solid ${T.border}` }}>
                    <div style={{ fontSize: 11, color: T.textDim, marginBottom: 8 }}>Match to a bill to confirm payment processed:</div>
                    {envelopes.find(e => e.id === t.assignedEnv)?.bills.map(bill => (
                      <button key={bill.id} className="txn-match-btn" style={{ marginRight: 6, marginBottom: 6 }}
                        onClick={() => handleMatchBill(t.id, bill.id)}>
                        ✓ Match: {bill.name}
                      </button>
                    ))}
                  </div>
                )}

                {t.matchedBill && (
                  <div style={{ marginTop: 8, padding: "6px 0 0", borderTop: `1px solid ${T.border}`, fontSize: 12, color: T.green }}>
                    ✓ Matched · payment confirmed processed
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ─── Add Envelope Sheet ───────────────────────────────────────────────────────
const ICONS = ["🏠","🚗","💳","💡","🛒","🎵","💊","✈️","🐾","👟","📱","🏋️","🍕","☕","🎮","💰"];
function AddEnvelopeSheet({ onAdd, onClose }) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("💰");
  const [allocated, setAllocated] = useState("");
  const submit = () => {
    if (!name || !allocated) return;
    onAdd({ id: `e${Date.now()}`, name, icon, balance: parseFloat(allocated), allocated: parseFloat(allocated), bills: [] });
    onClose();
  };
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-title">New Envelope</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
          {ICONS.map(i => <button key={i} onClick={() => setIcon(i)} style={{ fontSize: 22, background: icon === i ? T.greenMuted : T.card, border: `1px solid ${icon === i ? T.green : T.border}`, borderRadius: 10, padding: "6px 10px", cursor: "pointer" }}>{i}</button>)}
        </div>
        <div style={{ marginBottom: 12 }}><label className="form-label">Envelope name</label><input className="form-input" placeholder="e.g. Car Insurance" value={name} onChange={e => setName(e.target.value)} /></div>
        <div style={{ marginBottom: 16 }}><label className="form-label">Starting balance</label><input className="form-input" placeholder="$0" type="number" value={allocated} onChange={e => setAllocated(e.target.value)} /></div>
        <button className="btn-full" onClick={submit}>Create Envelope</button>
        <button className="btn-full secondary" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

// ─── Add Savings Sheet ────────────────────────────────────────────────────────
const SAVINGS_ICONS = ["🎯","✈️","🏖️","🚗","🏠","💍","🎓","🐾","💻","🎸","🏋️","🌱","🛋️","🎁","💎","🚀"];
function AddSavingsSheet({ onAdd, onClose }) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("🎯");
  const [goalAmount, setGoalAmount] = useState("");
  const [startAmount, setStartAmount] = useState("");
  const submit = () => {
    if (!name || !goalAmount) return;
    const start = parseFloat(startAmount || "0");
    onAdd({ id: `s${Date.now()}`, name, icon, balance: start, goalAmount: parseFloat(goalAmount), history: start > 0 ? [{ id: "c0", amount: start, note: "Starting balance", date: today.toLocaleDateString("en-US", { month: "short", day: "numeric" }) }] : [] });
    onClose();
  };
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-title">New Savings Jar</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
          {SAVINGS_ICONS.map(i => <button key={i} onClick={() => setIcon(i)} style={{ fontSize: 22, background: icon === i ? T.savings : T.card, border: `1px solid ${icon === i ? T.savingsBorder : T.border}`, borderRadius: 10, padding: "6px 10px", cursor: "pointer" }}>{i}</button>)}
        </div>
        <div style={{ marginBottom: 12 }}><label className="form-label">What are you saving for?</label><input className="form-input" placeholder="e.g. Emergency Fund, Beach Trip" value={name} onChange={e => setName(e.target.value)} /></div>
        <div className="form-row" style={{ marginBottom: 16 }}>
          <div className="form-group"><label className="form-label">Goal amount</label><input className="form-input" placeholder="$1,000" type="number" value={goalAmount} onChange={e => setGoalAmount(e.target.value)} /></div>
          <div className="form-group"><label className="form-label">Already saved</label><input className="form-input" placeholder="$0" type="number" value={startAmount} onChange={e => setStartAmount(e.target.value)} /></div>
        </div>
        <button className="btn-full" onClick={submit}>Create Savings Jar</button>
        <button className="btn-full secondary" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [envelopes, setEnvelopes] = useState(() => { try { const s = localStorage.getItem(LS_KEY); return s ? JSON.parse(s) : DEFAULT_ENVELOPES; } catch { return DEFAULT_ENVELOPES; } });
  const [float, setFloat] = useState(() => { try { return parseFloat(localStorage.getItem(LS_FLOAT) || "0"); } catch { return 0; } });
  const [savings, setSavings] = useState(() => { try { const s = localStorage.getItem(LS_SAVINGS); return s ? JSON.parse(s) : []; } catch { return []; } });
  const [income, setIncome] = useState(() => { try { return parseFloat(localStorage.getItem(LS_INCOME) || "0"); } catch { return 0; } });
  const [transactions, setTransactions] = useState(() => { try { const s = localStorage.getItem(LS_TXN); return s ? JSON.parse(s) : DEMO_TRANSACTIONS; } catch { return DEMO_TRANSACTIONS; } });
  const [tab, setTab] = useState("envelopes");
  const [showAddEnv, setShowAddEnv] = useState(false);
  const [showAddSavings, setShowAddSavings] = useState(false);

  useEffect(() => { localStorage.setItem(LS_KEY, JSON.stringify(envelopes)); }, [envelopes]);
  useEffect(() => { localStorage.setItem(LS_FLOAT, String(float)); }, [float]);
  useEffect(() => { localStorage.setItem(LS_SAVINGS, JSON.stringify(savings)); }, [savings]);
  useEffect(() => { localStorage.setItem(LS_INCOME, String(income)); }, [income]);
  useEffect(() => { localStorage.setItem(LS_TXN, JSON.stringify(transactions)); }, [transactions]);

  const totalBalance = envelopes.reduce((s, e) => s + e.balance, 0);
  const totalSavings = savings.reduce((s, j) => s + j.balance, 0);
  const updateEnvelope = useCallback((id, changes) => setEnvelopes(prev => prev.map(e => e.id === id ? { ...e, ...changes } : e)), []);
  const addFloat = useCallback((amount) => setFloat(f => f + amount), []);
  const distributeFloat = useCallback((envId, amount) => { setFloat(f => Math.max(0, f - amount)); setEnvelopes(prev => prev.map(e => e.id === envId ? { ...e, balance: e.balance + amount } : e)); }, []);
  const addEnvelope = useCallback((env) => setEnvelopes(prev => [...prev, env]), []);
  const addSavingsJar = useCallback((jar) => setSavings(prev => [...prev, jar]), []);
  const updateSavingsJar = useCallback((id, changes) => setSavings(prev => prev.map(j => j.id === id ? { ...j, ...changes } : j)), []);

  const upcomingCount = envelopes.flatMap(e => e.bills).filter(b => !b.paid && daysUntil(b.dueDay) <= 7).length;
  const unassignedCount = transactions.filter(t => !t.assignedEnv && t.amount < 0).length;

  return (
    <>
      <style>{css}</style>
      <div className="app">
        <div className="header">
          <div className="header-row">
            <div className="logo">budget<span>gum</span></div>
            <div className="total-pill">{fmt(totalBalance + float + totalSavings)}</div>
          </div>
          <SafeToSpendBar income={income} envelopes={envelopes} float={float} savings={savings} onSetIncome={setIncome} />
        </div>

        <FloatBanner float={float} envelopes={envelopes} onDistribute={distributeFloat} />

        {tab === "envelopes" && (
          <div className="section">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div className="section-label" style={{ marginBottom: 0 }}>Envelopes</div>
              <button className="btn-sm" style={{ width: "auto", padding: "6px 14px", flex: "none" }} onClick={() => setShowAddEnv(true)}>+ New</button>
            </div>
            {envelopes.map(env => <EnvelopeCard key={env.id} env={env} onUpdateEnvelope={updateEnvelope} onAddFloat={addFloat} />)}

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, marginTop: 8 }}>
              <div className="section-label" style={{ marginBottom: 0 }}>Savings Jars</div>
              <button className="btn-sm" style={{ width: "auto", padding: "6px 14px", flex: "none", borderColor: T.savingsBorder + "66", color: T.savingsText }} onClick={() => setShowAddSavings(true)}>+ New Jar</button>
            </div>
            {savings.length === 0 ? (
              <div style={{ background: T.savings + "44", border: `1px dashed ${T.savingsBorder}44`, borderRadius: 18, padding: "24px 20px", textAlign: "center", marginBottom: 12 }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>🎯</div>
                <div style={{ fontSize: 14, color: T.savingsText, fontWeight: 600, marginBottom: 4 }}>No savings jars yet</div>
                <div style={{ fontSize: 12, color: T.textDim }}>Tap + New Jar to start saving toward a goal</div>
              </div>
            ) : savings.map(jar => <SavingsCard key={jar.id} jar={jar} onUpdate={updateSavingsJar} />)}
          </div>
        )}

        {tab === "bills" && <BillsTab envelopes={envelopes} />}
        {tab === "calendar" && <CalendarTab envelopes={envelopes} />}
        {tab === "transactions" && <TransactionsTab transactions={transactions} setTransactions={setTransactions} envelopes={envelopes} />}

        <div className="tabbar">
          <button className={`tab${tab === "envelopes" ? " active" : ""}`} onClick={() => setTab("envelopes")}>
            <span className="tab-icon">✉️</span>Envelopes
          </button>
          <button className={`tab${tab === "bills" ? " active" : ""}`} onClick={() => setTab("bills")}>
            <span className="tab-icon">
              📋
              {upcomingCount > 0 && <span className="badge">{upcomingCount}</span>}
            </span>Bills
          </button>
          <button className={`tab${tab === "calendar" ? " active" : ""}`} onClick={() => setTab("calendar")}>
            <span className="tab-icon">📅</span>Calendar
          </button>
          <button className={`tab${tab === "transactions" ? " active" : ""}`} onClick={() => setTab("transactions")}>
            <span className="tab-icon">
              🏦
              {unassignedCount > 0 && <span className="badge">{unassignedCount}</span>}
            </span>Txns
          </button>
        </div>

        {showAddEnv && <AddEnvelopeSheet onAdd={addEnvelope} onClose={() => setShowAddEnv(false)} />}
        {showAddSavings && <AddSavingsSheet onAdd={addSavingsJar} onClose={() => setShowAddSavings(false)} />}
      </div>
    </>
  );
}
