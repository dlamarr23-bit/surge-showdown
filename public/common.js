// Shared helpers for host + player pages
const THEMES = {
  elements: {
    label: "Elemental Kingdoms",
    teams: [
      ["Fire", "🔥", "#ef4444"], ["Water", "💧", "#3b82f6"], ["Earth", "🪨", "#b7791f"], ["Air", "🌪️", "#e2e8f0"],
      ["Lightning", "⚡", "#facc15"], ["Ice", "❄️", "#67e8f9"], ["Nature", "🌿", "#22c55e"], ["Metal", "⚙️", "#f97316"],
      ["Light", "✨", "#f472b6"], ["Shadow", "🌑", "#8b5cf6"],
    ],
  },
  solar: {
    label: "Solar System",
    teams: [
      ["Sun", "☀️", "#facc15"], ["Mercury", "🌑", "#a8a29e"], ["Venus", "✨", "#f59e0b"], ["Earth", "🌍", "#3b82f6"],
      ["Mars", "🔴", "#ef4444"], ["Jupiter", "🟠", "#f97316"], ["Saturn", "🪐", "#d6b37a"], ["Uranus", "🧊", "#67e8f9"],
      ["Neptune", "🔵", "#6366f1"], ["Pluto", "❄️", "#f472b6"],
    ],
  },
  beasts: {
    label: "Mythic Beasts",
    teams: [
      ["Dragon", "🐉", "#ef4444"], ["Phoenix", "🦅", "#f97316"], ["Kraken", "🐙", "#8b5cf6"], ["Griffin", "🦁", "#eab308"],
      ["Unicorn", "🦄", "#f472b6"], ["Hydra", "🐍", "#22c55e"], ["Minotaur", "🐂", "#b7791f"], ["Yeti", "🏔️", "#e2e8f0"],
      ["Sphinx", "🐈", "#67e8f9"], ["Thunderbird", "⚡", "#3b82f6"],
    ],
  },
  gems: {
    label: "Gemstone Clans",
    teams: [
      ["Ruby", "❤️", "#e11d48"], ["Sapphire", "💙", "#2563eb"], ["Emerald", "💚", "#10b981"], ["Topaz", "🧡", "#f59e0b"],
      ["Amethyst", "💜", "#9333ea"], ["Diamond", "💎", "#e0f2fe"], ["Onyx", "🖤", "#71717a"], ["Opal", "🩷", "#f9a8d4"],
      ["Citrine", "💛", "#facc15"], ["Jade", "🍀", "#84cc16"],
    ],
  },
};
const themeTeams = (key) => (THEMES[key] || THEMES.elements).teams.map(([name, icon, color]) => ({ name, icon, color }));

// ---- question parsing: tab (pasted from Sheets), pipe, or CSV (Gimkit export) ----
function parseCSVLine(line) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ",") { out.push(cur); cur = ""; } else cur += c;
  }
  out.push(cur); return out;
}
function parseQuestions(text) {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    let cells;
    if (line.includes("\t")) cells = line.split("\t");
    else if (line.includes("|")) cells = line.split("|");
    else cells = parseCSVLine(line);
    cells = cells.map((c) => c.trim());
    const [q, correct, ...wrong] = cells;
    if (!q || !correct) continue;
    if (/^question$/i.test(q) || /gimkit/i.test(q)) continue;
    out.push({ q, correct, wrong: wrong.filter(Boolean) });
  }
  return out;
}
function questionsToText(qs) { return qs.map((q) => [q.q, q.correct, ...(q.wrong || [])].join(" | ")).join("\n"); }

// ---- websocket with auto-reconnect ----
function connect(path, { onOpen, onMessage, onStatus }) {
  let ws, tries = 0, closedByUs = false, pingT;
  const api = {
    send(o) { if (ws && ws.readyState === 1) { ws.send(JSON.stringify(o)); return true; } return false; },
    close() { closedByUs = true; clearInterval(pingT); ws && ws.close(); },
    offset: 0,
  };
  const open = () => {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(`${proto}//${location.host}${path}`);
    onStatus && onStatus("connecting");
    ws.onopen = () => { tries = 0; onStatus && onStatus("online"); onOpen && onOpen(); clearInterval(pingT); pingT = setInterval(() => api.send({ t: "ping" }), 25000); };
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.state && m.state.serverNow) api.offset = m.state.serverNow - Date.now();
      onMessage(m);
    };
    ws.onclose = (e) => {
      clearInterval(pingT);
      if (closedByUs || e.code === 4000) { onStatus && onStatus("closed", e); return; }
      onStatus && onStatus("offline", e);
      tries++; setTimeout(open, Math.min(8000, 500 * 2 ** Math.min(tries, 4)));
    };
  };
  open();
  return api;
}

// ---- timing from server state ----
function timing(st, offset) {
  const now = Date.now() + (offset || 0);
  const elapsed = st.elapsedBase + (st.runStartedAt ? now - st.runStartedAt : 0);
  const remaining = Math.max(0, st.totalMs - elapsed);
  const p = st.totalMs ? Math.min(1, Math.max(0, elapsed / st.totalMs)) : 0;
  const k = st.settings.surgeCurve, M = st.settings.surgeMax;
  const surge = st.status === "lobby" ? 1 : 1 + (M - 1) * (Math.exp(k * p) - 1) / (Math.exp(k) - 1);
  return { remaining, elapsed, p, surge };
}
const fmtTime = (ms) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = (sel, root = document) => root.querySelector(sel);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
function toast(msg, kind = "") {
  let wrap = $("#toasts");
  if (!wrap) { wrap = document.createElement("div"); wrap.id = "toasts"; document.body.appendChild(wrap); }
  const el = document.createElement("div"); el.className = "toast " + kind; el.textContent = msg; wrap.appendChild(el);
  setTimeout(() => el.classList.add("out"), 2600); setTimeout(() => el.remove(), 3100);
}
// readable text color on a team color
function inkOn(hex) {
  const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? "#111" : "#fff";
}
function podiumHTML(results, teams) {
  const r = results?.ranked || [];
  const slot = (x, place) => x ? `
    <div class="pod pod-${place}" style="--tc:${x.color}">
      <div class="pod-icon">${esc(x.icon)}</div>
      <div class="pod-name">${esc(x.name)}</div>
      <div class="pod-score">${x.score.toLocaleString()} pts</div>
      <div class="pod-block"><span>${place}</span></div>
    </div>` : `<div class="pod pod-${place} empty"><div class="pod-block"><span>${place}</span></div></div>`;
  return `<div class="podium">${slot(r[1], 2)}${slot(r[0], 1)}${slot(r[2], 3)}</div>`;
}
function confetti() {
  const c = document.createElement("canvas"); c.className = "confetti"; document.body.appendChild(c);
  const ctx = c.getContext("2d"); const W = (c.width = innerWidth), H = (c.height = innerHeight);
  const cols = ["#facc15", "#ef4444", "#3b82f6", "#22c55e", "#f472b6", "#8b5cf6", "#fff"];
  const ps = Array.from({ length: 160 }, () => ({ x: Math.random() * W, y: -Math.random() * H, vy: 2 + Math.random() * 4, vx: -1 + Math.random() * 2, r: Math.random() * 6.28, s: 5 + Math.random() * 7, c: cols[(Math.random() * cols.length) | 0] }));
  let f = 0; (function tick() {
    ctx.clearRect(0, 0, W, H);
    for (const p of ps) { p.y += p.vy; p.x += p.vx; p.r += 0.1; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore(); }
    if (++f < 260) requestAnimationFrame(tick); else c.remove();
  })();
}
