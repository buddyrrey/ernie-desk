const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];

const params = new URLSearchParams(location.search);
const FORCE_EMPTY = params.get("empty") === "1";
const FORCE_ERROR = params.get("error") === "1";

function pathFromHash() {
  const h = location.hash || "";
  const m = h.match(/[#&]d=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function getDataPath() {
  const fromHash = pathFromHash();
  if (fromHash) {
    localStorage.setItem("desk_data_path", fromHash);
    history.replaceState(null, "", location.pathname + location.search);
    return fromHash;
  }
  return localStorage.getItem("desk_data_path");
}

function siteRoot() {
  const href = location.href.split("#")[0].split("?")[0].replace(/index\.html?$/, "");
  const u = new URL(href.endsWith("/") ? href : href.replace(/[^/]+$/, ""));
  return u;
}

function dataUrl(rel) {
  if (!DATA_PATH) return "";
  return new URL("d/" + DATA_PATH + "/" + String(rel).replace(/^\/+/, ""), siteRoot()).href;
}

let DATA_PATH = getDataPath();
let STATE = null;
let POLL_TIMER = null;
const POLL_MS = 5000;
let VIEW = { tab: "home", screen: null, mint: null, auditMint: null };
if (params.get("tab")) VIEW.tab = params.get("tab");
if (params.get("screen")) VIEW.screen = params.get("screen");
if (params.get("mint")) VIEW.mint = params.get("mint");

async function dataFile(rel) {
  const url = dataUrl(rel) + (String(rel).includes("?") ? "&" : "?") + "v=" + Date.now();
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 404) {
    showAuth("That path didn't work.");
    throw new Error("404");
  }
  if (!res.ok) throw new Error("http " + res.status);
  return res.json();
}

function showAuth(msg) {
  $("#authGate").classList.remove("hidden");
  $("#main").classList.add("hidden");
  $("#errorState").classList.add("hidden");
  if (msg) $("#authErr").textContent = msg;
}

function showError(msg) {
  $("#errorState").classList.remove("hidden");
  $("#main").classList.add("hidden");
  $("#authGate").classList.add("hidden");
  $("#errorDetail").textContent = msg || "Couldn't load the desk data.";
}

function showMain() {
  $("#authGate").classList.add("hidden");
  $("#errorState").classList.add("hidden");
  $("#main").classList.remove("hidden");
}

$("#tokenBtn").addEventListener("click", () => {
  DATA_PATH = $("#tokenInput").value.trim();
  if (!DATA_PATH) return;
  localStorage.setItem("desk_data_path", DATA_PATH);
  boot();
});
$("#retryBtn").addEventListener("click", () => boot());

$$(".tabs button").forEach(b => b.addEventListener("click", () => {
  VIEW.tab = b.dataset.tab; VIEW.screen = null; render();
}));
document.addEventListener("click", e => {
  const back = e.target.closest("[data-back]");
  if (back) { VIEW.screen = null; VIEW.tab = back.dataset.back; render(); }
});

function money(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  const sign = v < 0 ? "-" : "";
  return sign + "$" + Math.abs(v).toFixed(2);
}

function coinLink(mint, name) {
  const s = STATE && STATE.signup_url;
  // server already stores FOMO links on activity; for names we fetch from coin
  const c = (STATE.coins || []).find(x => x.mint === mint);
  const label = (c && (c.name || c.symbol)) || name || (mint || "").slice(0, 6);
  return { label, mint };
}

function render() {
  if (!STATE) return;
  showMain();
  const s = STATE.settings || {};
  const mode = (s.mode || "PAPER").toUpperCase();
  const pill = $("#modePill");
  pill.textContent = mode;
  pill.className = "pill " + (mode === "LIVE" ? "live" : "paper");

  $$(".tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === VIEW.tab));
  $$(".tab, .screen").forEach(el => el.classList.add("hidden"));

  if (VIEW.screen === "auditor") return renderAuditor();
  if (VIEW.screen === "coin") return renderCoin();

  $("#tab-" + VIEW.tab).classList.remove("hidden");
  if (VIEW.tab === "home") renderHome();
  if (VIEW.tab === "agents") renderAgents();
  if (VIEW.tab === "account") renderAccount();
}

function renderHome() {
  const s = STATE.settings || {};
  const empty = FORCE_EMPTY;
  $("#balance").textContent = money(s.stack);
  const note = (STATE.ticket && STATE.ticket.warning) || "";
  $("#ticketNote").textContent = note;
  const open = empty ? [] : (STATE.positions || []).filter(p => p.status === "open" || p.status === "exiting");
  const box = $("#positions");
  box.innerHTML = "";
  $("#positionsEmpty").classList.toggle("hidden", open.length > 0);
  open.forEach(p => {
    const a = document.createElement("a");
    a.className = "row";
    a.href = "#";
    a.innerHTML = `<div><div class="title">${esc(p.name || p.symbol || p.mint.slice(0,6))}</div>
      <div class="sub">entry ${p.entry_price} · stop -${Number(p.stop_pct)}%</div>
      <a class="btn-fomo" href="${fomo(p.mint)}" target="_blank" rel="noopener">Sell on FOMO</a></div>
      <div class="right">${money(p.size_usd)}</div>`;
    a.addEventListener("click", ev => { if (ev.target.closest(".btn-fomo")) return; ev.preventDefault(); openCoin(p.mint); });
    box.appendChild(a);
  });
  const acts = empty ? [] : (STATE.activity || []);
  const alist = $("#activity");
  alist.innerHTML = "";
  $("#activityEmpty").classList.toggle("hidden", acts.length > 0);
  acts.forEach(act => {
    const row = document.createElement("a");
    const kind = act.kind || "";
    row.className = "row " + kind;
    row.href = act.link || fomo(act.mint) || "#";
    row.target = "_blank";
    row.rel = "noopener";
    row.innerHTML = `<div><div class="title">${esc(act.title || "")}</div><div class="sub">${esc(act.subtitle || "")}</div></div>
      <div class="right">${esc(act.right || "")}</div>`;
    if (act.mint) {
      row.addEventListener("click", ev => {
        if (ev.metaKey || ev.ctrlKey) return;
        ev.preventDefault(); openCoin(act.mint);
      });
    }
    alist.appendChild(row);
  });
}

function renderAgents() {
  const s = STATE.settings || {};
  const scans = FORCE_EMPTY ? [] : (STATE.scans || []);
  const passed = scans.filter(x => x.verdict === "pass").length;
  const killed = scans.filter(x => x.verdict === "kill");
  const audits = Object.values(STATE.audits || {});
  const taken = audits.length;
  const rejected = audits.filter(a => !Number(a.passed)).length;
  const analyses = Object.values(STATE.analyses || {});
  const lastScore = analyses[0] ? analyses[analyses.length-1] : null;
  const execs = (STATE.activity || []).filter(a => a.kind === "bought");
  const open = (STATE.positions || []).filter(p => p.status === "open" || p.status === "exiting");
  const lastExit = (STATE.positions || []).find(p => p.status === "closed");

  const cards = [
    {
      id: "scanner", title: "Scanner",
      body: `<div class="stat">${passed + killed.length} pools</div>
             ${killed.slice(0,4).map(k => rowKill(k)).join("") || '<div class="stat">watching the curve</div>'}`,
    },
    {
      id: "auditor", title: "Auditor",
      body: `<div class="stat">${taken} taken apart</div>
             <div class="stat">${rejected} rejected</div>
             <div class="stat">tap to open the disc</div>`,
      tap: () => { VIEW.screen = "auditor"; VIEW.auditMint = latestAuditMint(); render(); }
    },
    {
      id: "analyst", title: "Analyst",
      body: analystCard(),
    },
    {
      id: "executor", title: "Executor",
      body: `<div class="stat">${execs.length} trades</div>
             <div class="stat">${money(s.stack)} · ${s.stack_pct}% of stack</div>
             <div class="bar ${execs.length ? "done":""}"><span></span></div>
             <div class="stat">${execs.length ? "✓ Filled" : "idle"}</div>`,
    },
    {
      id: "risk", title: "Risk",
      body: `<div class="stat">${open.length ? "Guarding" : (lastExit ? exitLabel(lastExit) : "idle")}</div>
             <div class="pills">
               <span class="mini stop">stop -${s.stop_pct}%</span>
               <span class="mini trail">trail ${s.trail_pct}%</span>
             </div>`,
    },
  ];
  const root = $("#agentCards");
  root.innerHTML = "";
  cards.forEach(c => {
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `<h3>${c.title}</h3>${c.body}`;
    if (c.tap) el.addEventListener("click", c.tap);
    root.appendChild(el);
  });
}

function rowKill(k) {
  let p = {};
  try { p = JSON.parse(k.payload || "{}"); } catch(e) {}
  const name = p.name || p.symbol || k.mint.slice(0,6);
  return `<div class="row kill"><div class="title">${esc(name)}</div><div class="right">${esc(k.reason || p.reason || "")}</div></div>`;
}

function analystCard() {
  const analyses = Object.values(STATE.analyses || {});
  if (FORCE_EMPTY || !analyses.length) return `<div class="stat">Scoring</div><div class="stat">waiting for a pass from Auditor</div>`;
  let last = analyses[analyses.length - 1];
  let payload = {};
  try { payload = JSON.parse(last.payload || "{}"); } catch(e) {}
  const score = Number(last.score || payload.score || 0);
  const min = Number((STATE.settings || {}).min_score || 70);
  const color = score >= min ? "#7dff9a" : "#8a8578";
  const r = 30, c = 2 * Math.PI * r;
  const dash = c * Math.min(1, score / 100);
  return `<div class="stat">Scoring</div>
    <svg class="score-ring" viewBox="0 0 72 72">
      <circle cx="36" cy="36" r="${r}" fill="none" stroke="#2a2e3b" stroke-width="6"/>
      <circle cx="36" cy="36" r="${r}" fill="none" stroke="${color}" stroke-width="6"
        stroke-dasharray="${dash} ${c}" stroke-linecap="round" transform="rotate(-90 36 36)"/>
      <text x="36" y="41" text-anchor="middle" fill="#e8e4d9" font-size="14">${score}</text>
    </svg>`;
}

function exitLabel(p) {
  if (p.exit_reason === "trail") return "Trailed out";
  if (p.exit_reason === "stop") return "Stopped";
  return p.exit_reason || "closed";
}

function latestAuditMint() {
  const layers = STATE.layers || {};
  const audits = STATE.audits || {};
  const keys = Object.keys(audits);
  return keys[keys.length - 1] || Object.keys(layers)[0] || null;
}

function renderAuditor() {
  $("#screen-auditor").classList.remove("hidden");
  const mint = VIEW.auditMint;
  const empty = FORCE_EMPTY || !mint;
  $("#auditorEmpty").classList.toggle("hidden", !empty);
  $("#auditorError").classList.add("hidden");
  $("#auditLayers").innerHTML = "";
  const names = ["Mint authority","Freeze authority","Dev wallet","Top 10 holders","Liquidity","Pool age","Bundled wallets","Delegations"];
  let rows = [];
  if (mint && STATE.layers && STATE.layers[mint]) {
    rows = STATE.layers[mint].slice().sort((a,b)=>a.n-b.n);
  }
  const running = rows.length && rows.length < 8 && rows.every(r => r.pass !== null && r.pass !== "");
  $("#auditDisc").classList.toggle("spin", !!mint && !FORCE_EMPTY);
  const audit = mint && STATE.audits && STATE.audits[mint];
  let label = "taking apart…";
  if (audit) {
    let p = {};
    try { p = JSON.parse(audit.payload || "{}"); } catch(e) {}
    label = Number(audit.passed) ? "8/8 → Executor" : (audit.reason || "stopped");
  }
  if (FORCE_EMPTY) label = "idle";
  $("#auditDiscLabel").textContent = label;
  if (empty) return;
  for (let i=1;i<=8;i++) {
    const lyr = rows.find(r => Number(r.n)===i) || {n:i,name:names[i-1],pass:null,value:"not checked"};
    const el = document.createElement("div");
    const st = lyr.pass === null || lyr.pass === "" || lyr.value === "not checked" ? "grey"
      : (Number(lyr.pass) ? "ok" : "red");
    el.className = "layer " + st;
    el.innerHTML = `<div class="n">${i} · ${esc(lyr.name || names[i-1])}</div><div>${esc(lyr.value || "")}</div>`;
    $("#auditLayers").appendChild(el);
  }
}

async function openCoin(mint) {
  VIEW.screen = "coin"; VIEW.mint = mint;
  render();
  try {
    const data = await dataFile("coin/" + encodeURIComponent(mint) + ".json");
    VIEW.coin = data;
    renderCoin();
  } catch (e) {
    if (String(e.message) !== "404") {
      $("#coinMeta").innerHTML = `<div class="empty err">Couldn't load this coin.</div>`;
    }
  }
}

function renderCoin() {
  $("#screen-coin").classList.remove("hidden");
  const data = VIEW.coin;
  const mint = VIEW.mint;
  const c = (data && data.coin) || (STATE.coins || []).find(x => x.mint === mint) || { mint };
  const name = c.name || c.symbol || mint.slice(0,8);
  $("#coinHead").innerHTML = `<h1>${esc(name)}</h1>
    <div class="sub"><a href="${data && data.link ? data.link : fomo(mint)}" target="_blank" rel="noopener">${esc(name)} on FOMO</a></div>`;
  const prices = FORCE_EMPTY ? [] : ((data && data.prices) || []);
  $("#coinEmpty").classList.toggle("hidden", prices.length > 0);
  drawCandles(prices, data && data.position);
  const bits = [];
  if (data && data.audit) bits.push("audit: " + (Number(data.audit.passed) ? "passed" : data.audit.reason));
  if (data && data.analysis) bits.push("score " + data.analysis.score);
  $("#coinMeta").innerHTML = bits.map(b => `<div class="stat">${esc(b)}</div>`).join("");
  const pos = data && data.position;
  $("#coinRisk").classList.toggle("hidden", !(pos && (pos.status==="open" || pos.trail_active)));
}

function drawCandles(prices, pos) {
  const el = $("#candles");
  if (!prices.length) { el.innerHTML = ""; return; }
  const vals = prices.map(p => Number(p.price_usd)).filter(Number.isFinite);
  if (!vals.length) { el.innerHTML = ""; return; }
  const w = 390, h = 180, pad = 10;
  let min = Math.min(...vals), max = Math.max(...vals);
  let stopY = null;
  if (pos && pos.entry_price && pos.stop_pct) {
    // current exit line: trail if active else stop
    let line = Number(pos.entry_price) * (1 - Number(pos.stop_pct)/100);
    if (Number(pos.trail_active) && pos.peak_price) {
      const trail = Number((STATE.settings || {}).trail_pct || 12);
      line = Number(pos.peak_price) * (1 - trail/100);
    }
    min = Math.min(min, line); max = Math.max(max, line);
    stopY = line;
  }
  if (max === min) { max = min * 1.02 + 1e-12; }
  const x = i => pad + (w-2*pad) * (vals.length===1 ? 0.5 : i/(vals.length-1));
  const y = v => pad + (h-2*pad) * (1 - (v-min)/(max-min));
  const path = vals.map((v,i) => (i?"L":"M")+x(i)+","+y(v)).join(" ");
  let extra = "";
  if (stopY != null) {
    extra = `<line x1="${pad}" x2="${w-pad}" y1="${y(stopY)}" y2="${y(stopY)}" stroke="#f59e0b" stroke-dasharray="5 4" stroke-width="1.5"/>`;
  }
  el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <path d="${path}" fill="none" stroke="#3ee0c9" stroke-width="1.6"/>
    ${extra}
  </svg>`;
}

function renderAccount() {
  const root = $("#settings");
  const s = STATE.settings || {};
  const schema = STATE.schema || {};
  root.classList.add("readonly");
  if (root.dataset.built === "1" && !FORCE_EMPTY) {
    Object.keys(s).forEach(k => {
      const num = root.querySelector(`[data-key="${k}"][data-kind="num"]`);
      const range = root.querySelector(`[data-key="${k}"][data-kind="range"]`);
      const sel = root.querySelector(`select[data-key="${k}"]`);
      const txt = root.querySelector(`input[type=text][data-key="${k}"]`);
      if (num) num.value = s[k];
      if (range) range.value = s[k];
      if (sel) sel.value = s[k];
      if (txt) txt.value = s[k];
    });
    return;
  }
  root.innerHTML = "";
  const groups = {
    Scanner: ["min_liquidity_usd","max_top10_pct","max_h1_change_pct","poll_s","min_pool_age_min","max_wait_min","runner_h24_pct"],
    Auditor: ["auditor_enabled","max_dev_pct","auditor_max_top10_pct","min_lp_locked_pct","auditor_min_pool_age_min","max_bundled","max_delegated_accounts","retries"],
    "Analyst (rules)": ["analyst_mode","min_alive_6h","min_organic","max_chase","min_score","timeout_s","alive_volume_h1","organic_buys_h1","bundled_penalty","bundled_penalty_wallets","flush_drop_m5_pct","chase_h1_pct"],
    Executor: ["stack_pct","max_pool_pct","min_ticket_usd","below_min","recheck_liq_drop_pct","recheck_price_up_pct","executor_confirm_window_min"],
    Risk: ["risk_poll_s","stop_pct","trail_start_pct","trail_pct","timeout_h","timeout_min_gain_pct","risk_confirm_window_min"],
    Desk: ["mode","paper_start_stack","stack","report_time","notifier","rpc_url","push_rejects","fees_ref_discount","fomo_handle"],
  };
  Object.entries(groups).forEach(([title, keys]) => {
    const h = document.createElement("h2"); h.textContent = title; root.appendChild(h);
    keys.forEach(k => {
      const sch = schema[k] || {};
      const wrap = document.createElement("div");
      wrap.className = "setting";
      const type = sch.type || typeof s[k];
      let control = "";
      if (type === "bool") {
        control = `<select data-key="${k}"><option value="true"${s[k]?" selected":""}>true</option><option value="false"${!s[k]?" selected":""}>false</option></select>`;
      } else if (k === "below_min" || k === "analyst_mode" || k === "mode" || k === "notifier") {
        const opts = k==="below_min"?["bump","skip"]:k==="analyst_mode"?["rules","jev"]:k==="mode"?["PAPER","LIVE"]:["telegram","webpush"];
        control = `<select data-key="${k}">${opts.map(o=>`<option${String(s[k])===o?" selected":""}>${o}</option>`).join("")}</select>`;
      } else if (type === "str") {
        control = `<input type="text" data-key="${k}" value="${esc(s[k] ?? "")}">`;
      } else {
        const min = sch.min ?? 0, max = sch.max ?? 100, step = (type==="int"?1: (max<=1?0.01:0.1));
        control = `<input type="range" data-key="${k}" data-kind="range" min="${min}" max="${max}" step="${step}" value="${s[k] ?? 0}">
                   <input type="number" data-key="${k}" data-kind="num" min="${min}" max="${max}" step="${step}" value="${s[k] ?? 0}">`;
      }
      wrap.innerHTML = `<label><span>${k}</span><span class="muted">${sch.min!=null?sch.min+"–"+sch.max:""}</span></label>${control}`;
      wrap.querySelectorAll("input,select").forEach(el => { el.disabled = true; el.tabIndex = -1; });
      root.appendChild(wrap);
    });
  });
  root.dataset.built = "1";
}

function fomo(mint) {
  if (!mint) return "https://fomo.family";
  return "https://fomo.family/coin?address=" + encodeURIComponent(mint) + "&chainId=1399811149";
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function startPoll() {
  if (POLL_TIMER) clearInterval(POLL_TIMER);
  POLL_TIMER = setInterval(() => { refresh().catch(() => {}); }, POLL_MS);
}

async function refresh() {
  STATE = await dataFile("state.json");
  render();
  if (VIEW.screen === "coin" && VIEW.mint) {
    try {
      VIEW.coin = await dataFile("coin/" + encodeURIComponent(VIEW.mint) + ".json");
      renderCoin();
    } catch (e) {}
  }
}

async function boot() {
  if (FORCE_ERROR) { showError("Couldn't load the desk data. This is the error state."); return; }
  DATA_PATH = getDataPath();
  if (!DATA_PATH) { showAuth(""); return; }
  try {
    await refresh();
    startPoll();
  } catch (e) {
    if (String(e.message) === "404") return;
    showError(String(e.message || e));
  }
}

boot();
