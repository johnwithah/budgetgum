import { useState, useEffect, useCallback } from "react";
import { usePlaidLink } from "react-plaid-link";

// ─── Defaults ─────────────────────────────────────────────────────────────────
const DEFAULT_ENVELOPES = [
  { id: 1, name: "Groceries",     budget: 600,  spent: 0, color: "#30d158", icon: "🛒" },
  { id: 2, name: "Rent",          budget: 1800, spent: 0, color: "#0a84ff", icon: "🏠" },
  { id: 3, name: "Utilities",     budget: 200,  spent: 0, color: "#ffd60a", icon: "⚡" },
  { id: 4, name: "Transport",     budget: 150,  spent: 0, color: "#bf5af2", icon: "🚗" },
  { id: 5, name: "Dining Out",    budget: 300,  spent: 0, color: "#ff375f", icon: "🍕" },
  { id: 6, name: "Entertainment", budget: 100,  spent: 0, color: "#ff9f0a", icon: "🎬" },
];

const DEFAULT_BILLS = [
  { id: 1, name: "Rent",          amount: 1800,  dueDay: 1,  envelopeId: 2, paid: false, category: "Housing" },
  { id: 2, name: "Electric Bill", amount: 85,    dueDay: 15, envelopeId: 3, paid: false, category: "Utilities" },
  { id: 3, name: "Internet",      amount: 60,    dueDay: 20, envelopeId: 3, paid: false, category: "Utilities" },
  { id: 4, name: "Spotify",       amount: 10.99, dueDay: 8,  envelopeId: 6, paid: false, category: "Subscriptions" },
  { id: 5, name: "Car Insurance", amount: 120,   dueDay: 22, envelopeId: 4, paid: false, category: "Transport" },
  { id: 6, name: "Netflix",       amount: 15.99, dueDay: 12, envelopeId: 6, paid: false, category: "Subscriptions" },
];

function guessEnvelope(tx) {
  const n = (tx.desc || "").toLowerCase();
  if (/rent|apartment|lease/.test(n)) return 2;
  if (/electric|utility|water|gas bill|internet|wifi|at&t|verizon|comcast/.test(n)) return 3;
  if (/uber|lyft|gas station|parking|transit|metro/.test(n)) return 4;
  if (/restaurant|cafe|coffee|mcdonald|chipotle|doordash|grubhub|ubereats/.test(n)) return 5;
  if (/netflix|spotify|hulu|disney|amazon prime|apple/.test(n)) return 6;
  if (/whole foods|trader joe|kroger|safeway|walmart|target|costco|aldi|publix|harris teeter/.test(n)) return 1;
  const m = { FOOD_AND_DRINK:1, GROCERIES:1, TRANSPORTATION:4, TRAVEL:4, ENTERTAINMENT:6, RESTAURANTS:5, RENT_AND_UTILITIES:3 };
  return m[tx.category] || null;
}

const fmt = n => new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(n);
const ordinal = n => { const s=["th","st","nd","rd"]; const v=n%100; return `${n}${s[(v-20)%10]||s[v]||s[0]}`; };
function getDays(dueDay) {
  const t = new Date(), d = new Date(t.getFullYear(), t.getMonth(), dueDay);
  if (d < t) d.setMonth(d.getMonth()+1);
  return Math.ceil((d-t)/86400000);
}
const urgency = d => d<=3 ? "#ff375f" : d<=7 ? "#ffd60a" : "#30d158";

// Budget config still lives in localStorage — envelopes and bills are just your
// own categories, not secrets. The access token is what moved server-side.
function usePersisted(key, def) {
  const [val, set] = useState(() => {
    try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : def; }
    catch { return def; }
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }, [key, val]);
  return [val, set];
}

const ICONS  = ["💰","🛒","🏠","⚡","🚗","🍕","🎬","💊","✈️","🎓","👗","🐾","🏋️","📱","🎮"];
const COLORS = ["#30d158","#0a84ff","#ffd60a","#bf5af2","#ff375f","#ff9f0a","#64d2ff","#5e5ce6","#ff6961","#34c759"];

// Every fetch sends the session cookie. `credentials: "same-origin"` is what
// makes the browser attach it.
const api = (path, body) =>
  fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: body ? JSON.stringify(body) : undefined,
  });

// ═══════════════════════════════════════════════════════════════════════════════
// LOCK SCREEN
// ═══════════════════════════════════════════════════════════════════════════════
function LockScreen({ onUnlock }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!pw || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await api("/api/login", { password: pw });
      if (r.ok) { setPw(""); onUnlock(); }
      else {
        const d = await r.json().catch(() => ({}));
        setErr(d.error || "Incorrect password");
      }
    } catch {
      setErr("Connection failed");
    }
    setBusy(false);
  }

  return (
    <div style={{fontFamily:"-apple-system,'SF Pro Display','Helvetica Neue',sans-serif",background:"#000",minHeight:"100vh",color:"#fff",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"0 32px",maxWidth:430,margin:"0 auto"}}>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0}
        input::placeholder{color:#48484a}
        @keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-6px)}75%{transform:translateX(6px)}}
        .shake{animation:shake .3s}
      `}</style>

      <div style={{fontSize:64,marginBottom:20}}>🍬</div>
      <div style={{fontSize:32,fontWeight:700,letterSpacing:"-1.2px",marginBottom:6}}>Budgetgum</div>
      <div style={{fontSize:15,color:"#636366",marginBottom:36,letterSpacing:"-.2px"}}>Enter your password to unlock</div>

      <input
        type="password"
        value={pw}
        autoFocus
        onChange={e => { setPw(e.target.value); setErr(null); }}
        onKeyDown={e => e.key === "Enter" && submit()}
        placeholder="Password"
        className={err ? "shake" : ""}
        style={{background:"#1c1c1e",border:err?"1px solid #ff375f":"1px solid #2c2c2e",color:"#fff",borderRadius:14,padding:"16px 18px",width:"100%",fontFamily:"inherit",fontSize:17,letterSpacing:"-.3px",outline:"none",marginBottom:12}}
      />

      {err && <div style={{color:"#ff375f",fontSize:14,marginBottom:12,textAlign:"center"}}>{err}</div>}

      <button
        onClick={submit}
        disabled={busy || !pw}
        style={{background:"#c5f135",color:"#000",border:"none",borderRadius:14,padding:16,width:"100%",fontFamily:"inherit",fontSize:17,fontWeight:600,letterSpacing:"-.3px",cursor:"pointer",opacity:(busy||!pw)?.4:1,transition:"opacity .15s"}}>
        {busy ? "Unlocking…" : "Unlock"}
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLAID BUTTON
// ═══════════════════════════════════════════════════════════════════════════════
function PlaidButton({ onLinked, onError }) {
  const [linkToken, setLinkToken] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api("/api/create_link_token")
      .then(async r => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.plaid?.error_code || d.error || "Failed");
        setLinkToken(d.link_token);
      })
      .catch(e => onError?.(e.message));
  }, [onError]);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: async (public_token) => {
      setBusy(true);
      try {
        // We hand over the public_token and get back nothing but {ok:true}.
        // The access token never comes down here.
        const r = await api("/api/exchange_public_token", { public_token });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.plaid?.error_code || d.error || "Link failed");
        }
        onLinked();
      } catch (e) {
        onError?.(e.message);
      }
      setBusy(false);
    },
  });

  return (
    <button className="btn-green" onClick={() => open()} disabled={!ready || busy}
      style={{ opacity: (!ready || busy) ? .5 : 1 }}>
      {busy ? "Linking…" : !ready ? "Loading…" : "🏦  Connect Your Bank"}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════════════════
export default function App() {
  // ── auth state ──
  const [authState, setAuthState] = useState("checking"); // checking | locked | unlocked
  const [bankConnected, setBankConnected] = useState(false);

  const [tab, setTab] = useState("dashboard");
  const [envelopes, setEnvelopes] = usePersisted("bg_envelopes", DEFAULT_ENVELOPES);
  const [bills, setBills] = usePersisted("bg_bills", DEFAULT_BILLS);
  const [transactions, setTransactions] = usePersisted("bg_transactions", []);
  const [accounts, setAccounts] = usePersisted("bg_accounts", []);
  const [lastSync, setLastSync] = usePersisted("bg_last_sync", null);
  const [unmapped, setUnmapped] = usePersisted("bg_unmapped", []);

  const [syncing, setSyncing] = useState(false);
  const [showAddEnv, setShowAddEnv] = useState(false);
  const [showAddBill, setShowAddBill] = useState(false);
  const [showAddTx, setShowAddTx] = useState(false);
  const [payModal, setPayModal] = useState(null);
  const [mapModal, setMapModal] = useState(null);
  const [toast, setToast] = useState(null);

  const [newEnv, setNewEnv] = useState({name:"",budget:"",icon:"💰",color:"#0a84ff"});
  const [newBill, setNewBill] = useState({name:"",amount:"",dueDay:"",envelopeId:"",category:"Other"});
  const [newTx, setNewTx] = useState({desc:"",amount:"",envelopeId:"",date:new Date().toISOString().split("T")[0]});

  // ── Check session on load ──
  const checkSession = useCallback(async () => {
    try {
      const r = await fetch("/api/session", { credentials: "same-origin" });
      const d = await r.json();
      setAuthState(d.authenticated ? "unlocked" : "locked");
      setBankConnected(Boolean(d.bankConnected));
    } catch {
      setAuthState("locked");
    }
  }, []);

  useEffect(() => { checkSession(); }, [checkSession]);

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(null), 3000); }

  async function logout() {
    await api("/api/logout").catch(() => {});
    setAuthState("locked");
  }

  const totalBudget = envelopes.reduce((s,e) => s+e.budget, 0);
  const totalSpent  = envelopes.reduce((s,e) => s+e.spent, 0);
  const totalLeft   = totalBudget - totalSpent;
  const pct = Math.min((totalSpent/totalBudget)*100, 100);
  const unpaidBills = bills.filter(b => !b.paid).sort((a,b) => getDays(a.dueDay)-getDays(b.dueDay));
  const totalBalance = accounts.filter(a => a.type === "depository").reduce((s,a) => s+(a.available||a.balance||0), 0);

  // ── Sync: no token passed. The server knows who we are and looks it up. ──
  const syncBank = useCallback(async () => {
    setSyncing(true);
    try {
      const r = await api("/api/get_transactions");

      if (r.status === 401) { setAuthState("locked"); setSyncing(false); return; }

      const d = await r.json();

      if (!r.ok) {
        if (d.code === "RELINK") {
          setBankConnected(false);
          showToast("Bank needs re-linking");
        } else if (d.code === "NO_BANK") {
          setBankConnected(false);
          showToast("No bank connected");
        } else {
          showToast(d.plaid?.error_code || "Sync failed");
        }
        setSyncing(false);
        return;
      }

      setAccounts(d.accounts || []);

      const existing = new Set(transactions.map(t => t.id));
      const fresh = (d.transactions || []).filter(t => !existing.has(t.id) && !t.pending);

      const mapped = [], needsMap = [];
      fresh.forEach(t => {
        const envId = guessEnvelope(t);
        if (envId) mapped.push({ ...t, envelopeId: envId });
        else needsMap.push(t);
      });

      if (mapped.length) {
        setTransactions(p => [...mapped, ...p]);
        setEnvelopes(p => p.map(env => {
          const added = mapped.filter(t => t.envelopeId === env.id).reduce((s,t) => s+t.amount, 0);
          return added ? { ...env, spent: env.spent + added } : env;
        }));
      }
      if (needsMap.length) setUnmapped(p => [...needsMap, ...p]);

      setLastSync(new Date().toISOString());
      showToast(`Synced — ${fresh.length} new transaction${fresh.length !== 1 ? "s" : ""}`);
    } catch (e) {
      showToast("Sync failed");
    }
    setSyncing(false);
  }, [transactions, setTransactions, setEnvelopes, setAccounts, setLastSync, setUnmapped]);

  async function handleLinked() {
    setBankConnected(true);
    showToast("Bank connected");
    await syncBank();
  }

  async function disconnectBank() {
    await api("/api/disconnect_bank").catch(() => {});
    setBankConnected(false);
    setAccounts([]);
    showToast("Bank disconnected");
  }

  function assignUnmapped(tx, envId) {
    setTransactions(p => [{ ...tx, envelopeId: envId }, ...p]);
    setEnvelopes(p => p.map(e => e.id === envId ? { ...e, spent: e.spent + tx.amount } : e));
    setUnmapped(p => p.filter(t => t.id !== tx.id));
    setMapModal(null); showToast("Transaction assigned");
  }

  function payBill(bill) {
    setBills(p => p.map(b => b.id === bill.id ? { ...b, paid: true } : b));
    setEnvelopes(p => p.map(e => e.id === bill.envelopeId ? { ...e, spent: e.spent + bill.amount } : e));
    setTransactions(p => [{ id:`bill-${Date.now()}`, desc:bill.name, amount:bill.amount, envelopeId:bill.envelopeId, date:new Date().toISOString().split("T")[0], type:"bill" }, ...p]);
    setPayModal(null); showToast(`${bill.name} paid`);
  }

  function addEnvelope() {
    if (!newEnv.name || !newEnv.budget) return;
    setEnvelopes(p => [...p, { id:Date.now(), name:newEnv.name, budget:parseFloat(newEnv.budget), spent:0, color:newEnv.color, icon:newEnv.icon }]);
    setNewEnv({name:"",budget:"",icon:"💰",color:"#0a84ff"}); setShowAddEnv(false); showToast("Envelope created");
  }
  function addBill() {
    if (!newBill.name || !newBill.amount || !newBill.dueDay) return;
    setBills(p => [...p, { id:Date.now(), ...newBill, amount:parseFloat(newBill.amount), dueDay:parseInt(newBill.dueDay), envelopeId:parseInt(newBill.envelopeId)||null, paid:false }]);
    setNewBill({name:"",amount:"",dueDay:"",envelopeId:"",category:"Other"}); setShowAddBill(false); showToast("Bill added");
  }
  function addManualTx() {
    if (!newTx.desc || !newTx.amount || !newTx.envelopeId) return;
    const amt = parseFloat(newTx.amount);
    setEnvelopes(p => p.map(e => e.id === parseInt(newTx.envelopeId) ? { ...e, spent: e.spent + amt } : e));
    setTransactions(p => [{ id:`man-${Date.now()}`, ...newTx, amount:amt, envelopeId:parseInt(newTx.envelopeId), type:"manual" }, ...p]);
    setNewTx({desc:"",amount:"",envelopeId:"",date:new Date().toISOString().split("T")[0]}); setShowAddTx(false); showToast("Expense logged");
  }

  const fmtSync = lastSync ? new Date(lastSync).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}) : null;

  // ── Gate everything behind auth ──
  if (authState === "checking") {
    return (
      <div style={{background:"#000",minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center"}}>
        <div style={{fontSize:44,opacity:.35}}>🍬</div>
      </div>
    );
  }
  if (authState === "locked") {
    return <LockScreen onUnlock={checkSession} />;
  }

  return (
    <div style={{fontFamily:"-apple-system,'SF Pro Display','SF Pro Text','Helvetica Neue',sans-serif",background:"#000",minHeight:"100vh",color:"#fff",maxWidth:430,margin:"0 auto",position:"relative",WebkitFontSmoothing:"antialiased"}}>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{display:none}
        input::placeholder{color:#48484a}
        input[type=date]::-webkit-calendar-picker-indicator{filter:invert(.4)}
        button{-webkit-tap-highlight-color:transparent}
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        @keyframes sheetUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
        @keyframes toastIn{from{opacity:0;transform:translateX(-50%) translateY(8px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
        .card{background:#1c1c1e;border-radius:20px}
        .grp{background:#1c1c1e;border-radius:16px;overflow:hidden}
        .row{padding:14px 16px;display:flex;align-items:center;gap:12px}
        .row+.row{border-top:.5px solid rgba(255,255,255,.1)}
        .input{background:#2c2c2e;border:none;color:#fff;border-radius:12px;padding:14px 16px;width:100%;font-family:inherit;font-size:17px;letter-spacing:-.3px;transition:background .15s}
        .input:focus{background:#3a3a3c;outline:none}
        select.input option{background:#2c2c2e}
        .overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:50;display:flex;flex-direction:column;justify-content:flex-end;animation:fadeIn .2s;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
        .sheet{background:#1c1c1e;border-radius:20px 20px 0 0;width:100%;max-width:430px;margin:0 auto;animation:sheetUp .32s cubic-bezier(.32,1,.23,1);max-height:88vh;overflow-y:auto}
        .btn-green{background:#c5f135;color:#000;border:none;border-radius:14px;font-family:inherit;font-size:17px;font-weight:600;letter-spacing:-.3px;padding:16px;cursor:pointer;width:100%;transition:opacity .12s}
        .btn-green:active{opacity:.72}
        .btn-dim{background:#2c2c2e;color:#fff;border:none;border-radius:14px;font-family:inherit;font-size:15px;font-weight:500;padding:14px;cursor:pointer;width:100%;transition:opacity .12s}
        .btn-dim:active{opacity:.6}
        .link{background:none;border:none;color:#c5f135;font-family:inherit;font-size:17px;font-weight:600;cursor:pointer;letter-spacing:-.3px;transition:opacity .12s}
        .link:active{opacity:.5}
        .row-tap{background:none;border:none;width:100%;text-align:left;cursor:pointer;padding:0;font-family:inherit;color:inherit;transition:opacity .12s}
        .row-tap:active{opacity:.5}
        .pay-chip{background:#c5f135;color:#000;border:none;border-radius:20px;padding:6px 15px;font-size:14px;font-weight:700;cursor:pointer;transition:opacity .12s}
        .pay-chip:active{opacity:.7}
        .badge{background:#ff375f;border-radius:10px;padding:2px 7px;font-size:12px;font-weight:700;color:#fff}
        .sec-label{font-size:13px;font-weight:600;color:#636366;text-transform:uppercase;letter-spacing:.6px}
      `}</style>

      {toast && <div style={{position:"fixed",bottom:96,left:"50%",transform:"translateX(-50%)",background:"rgba(44,44,46,.96)",backdropFilter:"blur(24px)",WebkitBackdropFilter:"blur(24px)",borderRadius:22,padding:"11px 20px",fontSize:15,fontWeight:500,whiteSpace:"nowrap",zIndex:200,animation:"toastIn .28s cubic-bezier(.32,1,.23,1)",letterSpacing:"-.3px"}}>{toast}</div>}

      <div style={{height:20}}/>

      {/* HEADER */}
      <div style={{padding:"0 22px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:5}}>
              <span style={{fontSize:13,fontWeight:600,color:"#636366",letterSpacing:".4px",textTransform:"uppercase"}}>🍬 Budgetgum</span>
              <button onClick={logout} style={{background:"none",border:"none",color:"#48484a",fontSize:11,cursor:"pointer",fontFamily:"inherit",padding:0,textDecoration:"underline"}}>Lock</button>
            </div>
            <div style={{fontSize:42,fontWeight:700,letterSpacing:"-2px",lineHeight:1,color:totalLeft>=0?"#c5f135":"#ff375f"}}>{fmt(totalLeft)}</div>
            <div style={{fontSize:15,color:"#636366",marginTop:5,letterSpacing:"-.2px"}}>available to spend</div>
          </div>
          <div style={{textAlign:"right",paddingTop:6}}>
            {bankConnected && accounts.length > 0 ? (
              <>
                <div style={{fontSize:13,fontWeight:500,color:"#636366",letterSpacing:".4px",textTransform:"uppercase",marginBottom:5}}>Bank Balance</div>
                <div style={{fontSize:24,fontWeight:700,letterSpacing:"-1px",color:"#30d158"}}>{fmt(totalBalance)}</div>
                <button onClick={syncBank} disabled={syncing} style={{background:"none",border:"none",color:syncing?"#636366":"#0a84ff",fontSize:13,fontWeight:500,cursor:"pointer",marginTop:3,padding:0,fontFamily:"inherit"}}>
                  {syncing ? "Syncing…" : fmtSync ? `Synced ${fmtSync}` : "Sync now"}
                </button>
              </>
            ) : (
              <>
                <div style={{fontSize:13,fontWeight:500,color:"#636366",letterSpacing:".4px",textTransform:"uppercase",marginBottom:5}}>Budget</div>
                <div style={{fontSize:24,fontWeight:700,letterSpacing:"-1px"}}>{fmt(totalBudget)}</div>
                <div style={{fontSize:13,color:"#636366",marginTop:3}}>spent {fmt(totalSpent)}</div>
              </>
            )}
          </div>
        </div>

        {bankConnected && accounts.length > 0 && (
          <div style={{display:"flex",gap:8,marginBottom:14,overflowX:"auto",paddingBottom:2}}>
            {accounts.map(a => (
              <div key={a.id} style={{background:"#1c1c1e",borderRadius:12,padding:"8px 14px",flexShrink:0}}>
                <div style={{fontSize:12,color:"#636366",marginBottom:2}}>{a.name} ····{a.mask}</div>
                <div style={{fontSize:16,fontWeight:700,letterSpacing:"-.5px",color:a.type==="credit"?"#ff375f":"#fff"}}>{fmt(a.available||a.balance)}</div>
              </div>
            ))}
          </div>
        )}

        {!bankConnected && (
          <div className="card" style={{padding:"16px 18px",marginBottom:14,border:"1px solid #30d15840"}}>
            <div style={{fontSize:15,fontWeight:600,letterSpacing:"-.3px",marginBottom:4}}>Connect Your Bank</div>
            <div style={{fontSize:13,color:"#636366",marginBottom:14,lineHeight:1.5}}>
              Your credentials go directly to Plaid and are never stored by Budgetgum.
            </div>
            <PlaidButton onLinked={handleLinked} onError={msg => showToast(msg)} />
          </div>
        )}

        {unmapped.length > 0 && (
          <button className="row-tap card" style={{padding:"12px 16px",marginBottom:14,width:"100%",display:"flex",alignItems:"center",gap:12,border:"1px solid #ffd60a40"}} onClick={() => setMapModal(unmapped[0])}>
            <div style={{fontSize:24}}>📥</div>
            <div style={{flex:1}}>
              <div style={{fontSize:15,fontWeight:600,letterSpacing:"-.3px"}}>Transactions to assign</div>
              <div style={{fontSize:13,color:"#636366",marginTop:1}}>Tap to sort into envelopes</div>
            </div>
            <span className="badge">{unmapped.length}</span>
          </button>
        )}

        <div className="card" style={{padding:"14px 16px",marginBottom:6}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:9,fontSize:13,fontWeight:500,letterSpacing:"-.2px"}}>
            <span style={{color:"#aeaeb2"}}>Monthly progress</span>
            <span style={{color:pct>90?"#ff375f":pct>70?"#ffd60a":"#c5f135"}}>{Math.round(pct)}%</span>
          </div>
          <div style={{background:"#2c2c2e",borderRadius:5,height:5,overflow:"hidden"}}>
            <div style={{height:"100%",width:`${pct}%`,background:pct>90?"linear-gradient(90deg,#ff375f,#ff6961)":pct>70?"linear-gradient(90deg,#ffd60a,#ff9f0a)":"linear-gradient(90deg,#c5f135,#30d158)",borderRadius:5,transition:"width 1s ease"}}/>
          </div>
        </div>

        <div style={{display:"flex",borderBottom:".5px solid rgba(255,255,255,.1)",marginTop:18}}>
          {[["dashboard","⊞","Home"],["envelopes","▣","Envelopes"],["bills","◎","Bills"],["activity","≡","Activity"]].map(([t,ic,label]) => (
            <button key={t} onClick={() => setTab(t)} style={{flex:1,background:"none",border:"none",borderBottom:tab===t?"2px solid #c5f135":"2px solid transparent",paddingBottom:10,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:3,color:tab===t?"#c5f135":"#636366",transition:"color .15s",fontSize:10,fontWeight:500,letterSpacing:".4px",textTransform:"uppercase"}}>
              <span style={{fontSize:18}}>{ic}</span>{label}
            </button>
          ))}
        </div>
      </div>

      {/* DASHBOARD */}
      {tab === "dashboard" && (
        <div style={{padding:"20px 22px 110px"}}>
          {unpaidBills.filter(b => getDays(b.dueDay) <= 7).length > 0 && (
            <div style={{marginBottom:24}}>
              <div className="sec-label" style={{marginBottom:10}}>Coming Up</div>
              <div className="grp">
                {unpaidBills.filter(b => getDays(b.dueDay) <= 7).map(bill => {
                  const days = getDays(bill.dueDay), env = envelopes.find(e => e.id === bill.envelopeId);
                  return (
                    <div key={bill.id} className="row">
                      <div style={{width:38,height:38,borderRadius:11,background:urgency(days)+"22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>{env?.icon||"📄"}</div>
                      <div style={{flex:1}}>
                        <div style={{fontSize:16,fontWeight:500,letterSpacing:"-.3px"}}>{bill.name}</div>
                        <div style={{fontSize:13,color:urgency(days),fontWeight:500,marginTop:2}}>{days===0?"Due today":`${days} days`}</div>
                      </div>
                      <div style={{fontSize:17,fontWeight:600,letterSpacing:"-.5px",marginRight:10}}>{fmt(bill.amount)}</div>
                      <button className="pay-chip" onClick={() => setPayModal(bill)}>Pay</button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="sec-label" style={{marginBottom:10}}>Envelopes</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:24}}>
            {envelopes.map(env => {
              const p = Math.min((env.spent/env.budget)*100, 100), left = env.budget - env.spent;
              return (
                <button key={env.id} className="row-tap card" style={{padding:16,textAlign:"left"}} onClick={() => setTab("envelopes")}>
                  <div style={{fontSize:28,marginBottom:10}}>{env.icon}</div>
                  <div style={{fontSize:13,color:"#636366",fontWeight:500,letterSpacing:"-.2px",marginBottom:2}}>{env.name}</div>
                  <div style={{fontSize:22,fontWeight:700,letterSpacing:"-1px",color:left>=0?"#fff":"#ff375f",lineHeight:1.1}}>{fmt(left)}</div>
                  <div style={{fontSize:12,color:"#48484a",marginBottom:10}}>of {fmt(env.budget)}</div>
                  <div style={{background:"#2c2c2e",borderRadius:3,height:3,overflow:"hidden"}}>
                    <div style={{height:"100%",width:`${p}%`,background:p>90?"#ff375f":p>70?"#ffd60a":env.color,borderRadius:3,transition:"width 1s ease"}}/>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="sec-label" style={{marginBottom:10}}>Recent</div>
          <div className="grp">
            {transactions.length === 0 && <div style={{padding:"20px 16px",textAlign:"center",fontSize:14,color:"#48484a"}}>No transactions yet.</div>}
            {transactions.slice(0,6).map(tx => {
              const env = envelopes.find(e => e.id === tx.envelopeId);
              return (
                <div key={tx.id} className="row">
                  <div style={{width:34,height:34,borderRadius:10,background:env?env.color+"22":"#2c2c2e",display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,flexShrink:0}}>{env?.icon||"💸"}</div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:16,fontWeight:500,letterSpacing:"-.3px"}}>{tx.desc}</div>
                    <div style={{fontSize:13,color:"#636366",marginTop:1}}>{env?.name||"—"} · {tx.date}</div>
                  </div>
                  <div style={{fontSize:16,fontWeight:600,letterSpacing:"-.4px",color:"#aeaeb2"}}>−{fmt(tx.amount)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ENVELOPES */}
      {tab === "envelopes" && (
        <div style={{padding:"20px 22px 110px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <div className="sec-label">All Envelopes</div>
            <button className="link" style={{fontSize:15}} onClick={() => setShowAddEnv(true)}>+ New</button>
          </div>
          {envelopes.map(env => {
            const p = Math.min((env.spent/env.budget)*100, 100), left = env.budget - env.spent;
            const envTxs = transactions.filter(t => t.envelopeId === env.id);
            return (
              <div key={env.id} className="card" style={{padding:18,marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <div style={{display:"flex",alignItems:"center",gap:12}}>
                    <div style={{width:42,height:42,borderRadius:13,background:env.color+"22",border:`1px solid ${env.color}33`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22}}>{env.icon}</div>
                    <div>
                      <div style={{fontSize:17,fontWeight:600,letterSpacing:"-.4px"}}>{env.name}</div>
                      <div style={{fontSize:13,color:"#636366",marginTop:1}}>{envTxs.length} transaction{envTxs.length!==1?"s":""}</div>
                    </div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:20,fontWeight:700,letterSpacing:"-1px",color:left>=0?"#fff":"#ff375f"}}>{fmt(left)}</div>
                    <div style={{fontSize:12,color:"#636366"}}>of {fmt(env.budget)}</div>
                  </div>
                </div>
                <div style={{background:"#2c2c2e",borderRadius:4,height:5,overflow:"hidden",marginBottom:10}}>
                  <div style={{height:"100%",width:`${p}%`,background:p>90?"#ff375f":p>70?"#ffd60a":env.color,borderRadius:4,transition:"width 1s ease"}}/>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:13,color:"#636366",marginBottom:envTxs.length?12:0}}>
                  <span>Spent {fmt(env.spent)}</span>
                  <span style={{color:p>90?"#ff375f":"#636366"}}>{Math.round(p)}%</span>
                </div>
                {envTxs.length > 0 && (
                  <div style={{borderTop:".5px solid rgba(255,255,255,.08)",paddingTop:10,marginBottom:12}}>
                    {envTxs.slice(0,3).map(tx => (
                      <div key={tx.id} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",fontSize:14}}>
                        <span style={{color:"#636366"}}>{tx.desc}</span>
                        <span style={{color:"#aeaeb2"}}>−{fmt(tx.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
                <button className="btn-dim" onClick={() => { setNewTx(p => ({...p, envelopeId:String(env.id)})); setShowAddTx(true); }}>Add Expense</button>
              </div>
            );
          })}
        </div>
      )}

      {/* BILLS */}
      {tab === "bills" && (
        <div style={{padding:"20px 22px 110px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <div className="sec-label">Bill Reminders</div>
            <button className="link" style={{fontSize:15}} onClick={() => setShowAddBill(true)}>+ New</button>
          </div>
          <div className="card" style={{padding:"16px 18px",marginBottom:20,display:"flex"}}>
            {[["Total",fmt(bills.reduce((s,b)=>s+b.amount,0)),"#fff"],["Paid",fmt(bills.filter(b=>b.paid).reduce((s,b)=>s+b.amount,0)),"#30d158"],["Due",fmt(bills.filter(b=>!b.paid).reduce((s,b)=>s+b.amount,0)),"#ffd60a"]].map(([label,val,color],i) => (
              <div key={i} style={{flex:1,textAlign:i===0?"left":i===1?"center":"right"}}>
                <div style={{fontSize:12,color:"#636366",fontWeight:500,marginBottom:4}}>{label}</div>
                <div style={{fontSize:20,fontWeight:700,letterSpacing:"-1px",color}}>{val}</div>
              </div>
            ))}
          </div>
          <div className="sec-label" style={{marginBottom:10}}>Unpaid · {unpaidBills.length}</div>
          <div className="grp" style={{marginBottom:24}}>
            {unpaidBills.map(bill => {
              const days = getDays(bill.dueDay), env = envelopes.find(e => e.id === bill.envelopeId);
              return (
                <button key={bill.id} className="row-tap row" onClick={() => setPayModal(bill)}>
                  <div style={{width:36,height:36,borderRadius:11,background:urgency(days)+"22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>{env?.icon||"📄"}</div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:16,fontWeight:500,letterSpacing:"-.3px"}}>{bill.name}</div>
                    <div style={{fontSize:13,color:"#636366",marginTop:1}}>Due {ordinal(bill.dueDay)} · {bill.category}</div>
                  </div>
                  <div style={{textAlign:"right",marginRight:6}}>
                    <div style={{fontSize:16,fontWeight:600,letterSpacing:"-.4px"}}>{fmt(bill.amount)}</div>
                    <div style={{fontSize:12,color:urgency(days),fontWeight:500,marginTop:1}}>{days===0?"Today":`${days}d`}</div>
                  </div>
                  <div style={{color:"#48484a",fontSize:18}}>›</div>
                </button>
              );
            })}
          </div>
          <div className="sec-label" style={{marginBottom:10}}>Paid · {bills.filter(b=>b.paid).length}</div>
          <div className="grp">
            {bills.filter(b => b.paid).map(bill => (
              <div key={bill.id} className="row" style={{opacity:.45}}>
                <div style={{width:36,height:36,borderRadius:11,background:"#30d15822",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>✓</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:16,fontWeight:500,letterSpacing:"-.3px",textDecoration:"line-through",color:"#636366"}}>{bill.name}</div>
                  <div style={{fontSize:13,color:"#48484a",marginTop:1}}>{bill.category}</div>
                </div>
                <div style={{fontSize:15,color:"#48484a",fontWeight:600}}>{fmt(bill.amount)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ACTIVITY */}
      {tab === "activity" && (
        <div style={{padding:"20px 22px 110px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <div className="sec-label">Transactions</div>
            <button className="link" style={{fontSize:15}} onClick={() => setShowAddTx(true)}>+ Log</button>
          </div>
          {bankConnected && (
            <>
              <button className="btn-dim" style={{marginBottom:8,fontSize:15,fontWeight:600,letterSpacing:"-.3px",color:syncing?"#636366":"#0a84ff"}} onClick={syncBank} disabled={syncing}>
                {syncing ? "Syncing…" : "↻  Sync Bank"}
              </button>
              <button onClick={disconnectBank} style={{background:"none",border:"none",color:"#48484a",fontSize:12,cursor:"pointer",fontFamily:"inherit",width:"100%",padding:"4px 0 14px",textAlign:"center"}}>
                Disconnect bank
              </button>
            </>
          )}
          <div className="grp">
            {transactions.length === 0 && <div style={{padding:"24px 16px",textAlign:"center",color:"#636366",fontSize:15}}>No transactions yet.</div>}
            {transactions.map(tx => {
              const env = envelopes.find(e => e.id === tx.envelopeId);
              return (
                <div key={tx.id} className="row">
                  <div style={{width:36,height:36,borderRadius:10,background:env?env.color+"22":"#2c2c2e",display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,flexShrink:0}}>{env?.icon||"💸"}</div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:16,fontWeight:500,letterSpacing:"-.3px"}}>{tx.desc}</div>
                    <div style={{fontSize:13,color:"#636366",marginTop:1}}>{env?.name||"—"} · {tx.date}</div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:16,fontWeight:600,letterSpacing:"-.4px",color:"#aeaeb2"}}>−{fmt(tx.amount)}</div>
                    <div style={{fontSize:11,color:"#48484a",marginTop:1,textTransform:"capitalize"}}>{tx.type}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB BAR */}
      <div style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:430,background:"rgba(0,0,0,.82)",backdropFilter:"blur(24px)",WebkitBackdropFilter:"blur(24px)",borderTop:".5px solid rgba(255,255,255,.1)",display:"flex",padding:"10px 0 28px"}}>
        {[["dashboard","⊞","Home"],["envelopes","▣","Envelopes"],["bills","◎","Bills"],["activity","≡","Activity"]].map(([t,ic,label]) => (
          <button key={t} onClick={() => setTab(t)} style={{flex:1,background:"none",border:"none",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:3,color:tab===t?"#c5f135":"#636366",transition:"color .15s",fontSize:10,fontWeight:500,letterSpacing:".4px",textTransform:"uppercase"}}>
            <span style={{fontSize:22}}>{ic}</span>{label}
          </button>
        ))}
      </div>

      {/* ASSIGN MODAL */}
      {mapModal && (
        <div className="overlay" onClick={() => setMapModal(null)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div style={{width:36,height:5,background:"#48484a",borderRadius:3,margin:"12px auto 0"}}/>
            <div style={{padding:"20px 20px 8px"}}>
              <div style={{fontSize:20,fontWeight:700,letterSpacing:"-.5px",marginBottom:4}}>Where does this go?</div>
              <div style={{fontSize:15,color:"#636366"}}>{mapModal.desc} · {fmt(mapModal.amount)}</div>
              <div style={{fontSize:13,color:"#48484a",marginTop:2}}>{mapModal.date}</div>
            </div>
            <div style={{padding:"8px 20px 40px",display:"flex",flexDirection:"column",gap:8}}>
              {envelopes.map(env => (
                <button key={env.id} className="row-tap" style={{background:"#2c2c2e",borderRadius:14,padding:"13px 16px",display:"flex",alignItems:"center",gap:12}} onClick={() => assignUnmapped(mapModal, env.id)}>
                  <span style={{fontSize:22}}>{env.icon}</span>
                  <div style={{flex:1}}>
                    <div style={{fontSize:16,fontWeight:500,letterSpacing:"-.3px"}}>{env.name}</div>
                    <div style={{fontSize:13,color:"#636366"}}>{fmt(env.budget-env.spent)} left</div>
                  </div>
                  <span style={{color:"#48484a",fontSize:18}}>›</span>
                </button>
              ))}
              <button className="link" style={{textAlign:"center",color:"#636366",fontSize:15,marginTop:4}} onClick={() => { setUnmapped(p => p.filter(t => t.id !== mapModal.id)); setMapModal(null); }}>Skip this transaction</button>
            </div>
          </div>
        </div>
      )}

      {/* PAY MODAL */}
      {payModal && (
        <div className="overlay" onClick={() => setPayModal(null)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div style={{width:36,height:5,background:"#48484a",borderRadius:3,margin:"12px auto 0"}}/>
            <div style={{textAlign:"center",padding:"28px 24px 20px"}}>
              <div style={{fontSize:56,marginBottom:14}}>{envelopes.find(e=>e.id===payModal.envelopeId)?.icon||"📄"}</div>
              <div style={{fontSize:15,color:"#636366",fontWeight:500}}>{payModal.category}</div>
              <div style={{fontSize:28,fontWeight:700,letterSpacing:"-1px",marginTop:4}}>{payModal.name}</div>
              <div style={{fontSize:48,fontWeight:700,letterSpacing:"-2.5px",color:"#c5f135",marginTop:8,lineHeight:1}}>{fmt(payModal.amount)}</div>
              <div style={{fontSize:14,color:"#636366",marginTop:8}}>Due {ordinal(payModal.dueDay)} · {getDays(payModal.dueDay)} days away</div>
            </div>
            <div style={{margin:"0 20px 16px"}}>
              <div className="grp">
                {[["From Envelope",envelopes.find(e=>e.id===payModal.envelopeId)?.name||"Unassigned"],["Frequency","Monthly"],["Category",payModal.category]].map(([k,v]) => (
                  <div key={k} className="row" style={{justifyContent:"space-between"}}>
                    <span style={{fontSize:16,color:"#636366"}}>{k}</span>
                    <span style={{fontSize:16,fontWeight:500}}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{padding:"0 20px 12px"}}><button className="btn-green" onClick={() => payBill(payModal)}>Confirm Payment</button></div>
            <div style={{padding:"0 20px 20px"}}><button className="link" style={{width:"100%",textAlign:"center",color:"#636366",fontSize:16}} onClick={() => setPayModal(null)}>Cancel</button></div>
          </div>
        </div>
      )}

      {/* ADD ENVELOPE */}
      {showAddEnv && (
        <div className="overlay" onClick={() => setShowAddEnv(false)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div style={{width:36,height:5,background:"#48484a",borderRadius:3,margin:"12px auto 0"}}/>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"18px 20px 8px"}}>
              <span style={{fontSize:20,fontWeight:700,letterSpacing:"-.5px"}}>New Envelope</span>
              <button className="link" onClick={() => setShowAddEnv(false)}>Cancel</button>
            </div>
            <div style={{padding:"12px 20px 40px",display:"flex",flexDirection:"column",gap:10}}>
              <input placeholder="Name" value={newEnv.name} onChange={e => setNewEnv(p => ({...p, name:e.target.value}))} className="input"/>
              <input placeholder="Monthly budget" type="number" value={newEnv.budget} onChange={e => setNewEnv(p => ({...p, budget:e.target.value}))} className="input"/>
              <div style={{fontSize:13,color:"#636366",fontWeight:500,marginTop:4}}>Icon</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                {ICONS.map(ic => <button key={ic} onClick={() => setNewEnv(p => ({...p, icon:ic}))} style={{width:46,height:46,borderRadius:13,background:newEnv.icon===ic?"#c5f135":"#2c2c2e",fontSize:22,border:"none",cursor:"pointer"}}>{ic}</button>)}
              </div>
              <div style={{fontSize:13,color:"#636366",fontWeight:500}}>Color</div>
              <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                {COLORS.map(c => <button key={c} onClick={() => setNewEnv(p => ({...p, color:c}))} style={{width:30,height:30,borderRadius:"50%",background:c,border:newEnv.color===c?"3px solid #fff":"3px solid transparent",cursor:"pointer"}}/>)}
              </div>
              <button className="btn-green" style={{marginTop:6}} onClick={addEnvelope}>Create Envelope</button>
            </div>
          </div>
        </div>
      )}

      {/* ADD BILL */}
      {showAddBill && (
        <div className="overlay" onClick={() => setShowAddBill(false)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div style={{width:36,height:5,background:"#48484a",borderRadius:3,margin:"12px auto 0"}}/>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"18px 20px 8px"}}>
              <span style={{fontSize:20,fontWeight:700,letterSpacing:"-.5px"}}>New Bill</span>
              <button className="link" onClick={() => setShowAddBill(false)}>Cancel</button>
            </div>
            <div style={{padding:"12px 20px 40px",display:"flex",flexDirection:"column",gap:10}}>
              <input placeholder="Bill name" value={newBill.name} onChange={e => setNewBill(p => ({...p, name:e.target.value}))} className="input"/>
              <input placeholder="Amount" type="number" value={newBill.amount} onChange={e => setNewBill(p => ({...p, amount:e.target.value}))} className="input"/>
              <input placeholder="Due day (1–31)" type="number" min="1" max="31" value={newBill.dueDay} onChange={e => setNewBill(p => ({...p, dueDay:e.target.value}))} className="input"/>
              <select value={newBill.envelopeId} onChange={e => setNewBill(p => ({...p, envelopeId:e.target.value}))} className="input">
                <option value="">Link to envelope (optional)</option>
                {envelopes.map(e => <option key={e.id} value={e.id}>{e.icon} {e.name}</option>)}
              </select>
              <select value={newBill.category} onChange={e => setNewBill(p => ({...p, category:e.target.value}))} className="input">
                {["Housing","Utilities","Transport","Subscriptions","Insurance","Health","Other"].map(c => <option key={c}>{c}</option>)}
              </select>
              <button className="btn-green" onClick={addBill}>Add Bill Reminder</button>
            </div>
          </div>
        </div>
      )}

      {/* ADD TRANSACTION */}
      {showAddTx && (
        <div className="overlay" onClick={() => setShowAddTx(false)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div style={{width:36,height:5,background:"#48484a",borderRadius:3,margin:"12px auto 0"}}/>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"18px 20px 8px"}}>
              <span style={{fontSize:20,fontWeight:700,letterSpacing:"-.5px"}}>Log Expense</span>
              <button className="link" onClick={() => setShowAddTx(false)}>Cancel</button>
            </div>
            <div style={{padding:"12px 20px 40px",display:"flex",flexDirection:"column",gap:10}}>
              <input placeholder="Description" value={newTx.desc} onChange={e => setNewTx(p => ({...p, desc:e.target.value}))} className="input"/>
              <input placeholder="Amount" type="number" value={newTx.amount} onChange={e => setNewTx(p => ({...p, amount:e.target.value}))} className="input"/>
              <select value={newTx.envelopeId} onChange={e => setNewTx(p => ({...p, envelopeId:e.target.value}))} className="input">
                <option value="">Select envelope</option>
                {envelopes.map(e => <option key={e.id} value={e.id}>{e.icon} {e.name}</option>)}
              </select>
              <input type="date" value={newTx.date} onChange={e => setNewTx(p => ({...p, date:e.target.value}))} className="input"/>
              <button className="btn-green" onClick={addManualTx}>Record Expense</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
