// Shared helpers for host + player pages
const BASE = "/surge"; // folder the game lives in on the site
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

// ---- question parsing ----
// Accepts: rows pasted from Google Sheets (tabs), "a | b | c" lines, CSV files (Gimkit export or our template),
// with an optional header row. Pictures: an image column from the template, a cell that is just an image link,
// or "[img: link]" inside any part.
// A question is { q, img, correct, cImg, wrong: [...], wImg: [...] }
function parseCSV(text) {
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"' && cur === "") q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); rows.push(row); row = []; cur = "";
    } else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
function textToRows(text) {
  text = String(text || "");
  if (text.includes("\t")) return text.split(/\r?\n/).map((l) => l.split("\t"));
  const lines = text.split(/\r?\n/);
  if (lines.some((l) => l.includes("|"))) return lines.map((l) => (l.includes("|") ? l.split("|") : parseCSV(l)[0] || []));
  return parseCSV(text);
}
const IMG_TAG = /\[img:\s*([^\]\s]+)\s*\]/i;
const isUrl = (s) => /^https?:\/\/\S+$/i.test(s);
function splitImg(cell) {
  let t = String(cell ?? "").trim(), img = "", bare = false;
  const m = t.match(IMG_TAG);
  if (m) { img = m[1]; t = t.replace(IMG_TAG, "").trim(); }
  else if (isUrl(t) && (/\.(png|jpe?g|gif|webp|svg|bmp)(\?|#|$)/i.test(t) || /drive\.google\.com|googleusercontent\.com|imgur\.com|wikimedia\.org|unsplash\.com/i.test(t))) { img = t; t = ""; bare = true; }
  return { t, img: fixImg(img), bare };
}
// Google Drive share links → direct picture links
function fixImg(u) {
  u = String(u || "").trim();
  const m = u.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]{20,})/i);
  return m ? `https://drive.google.com/thumbnail?id=${m[1]}&sz=w1000` : u;
}
function headerRoles(row) {
  // returns an array of roles if this row is a header row, else null
  const cells = row.map((c) => String(c || "").trim().toLowerCase());
  if (!cells.some((c) => /^question/.test(c))) return null;
  let w = -1;
  return cells.map((c) => {
    const pic = /image|picture|img|photo|pic\b/.test(c);
    if (/^question/.test(c)) return pic ? ["qImg"] : ["q"];
    if (/correct|right answer/.test(c) && !/incorrect/.test(c)) return pic ? ["cImg"] : ["correct"];
    if (/wrong|incorrect|distractor|option|answer/.test(c)) {
      if (pic) return ["wImg", Math.max(0, w)];
      w++; return ["wrong", w];
    }
    return null;
  });
}
function parseQuestions(text) { return rowsToQuestions(textToRows(text)); }
function rowsToQuestions(rows) {
  const out = [];
  let roles = null;
  for (const raw of rows) {
    const row = raw.map((c) => String(c ?? "").trim());
    if (!row.some(Boolean)) continue;
    const hr = headerRoles(row);
    if (hr) { roles = hr; continue; }
    if (/gimkit/i.test(row[0]) || /^(example|instructions?)\b/i.test(row[0])) continue;
    const q = { q: "", img: "", correct: "", cImg: "", wrong: [], wImg: [] };
    if (roles) {
      row.forEach((cell, i) => {
        const r = roles[i]; if (!r || !cell) return;
        const f = splitImg(cell);
        const [k, n] = r;
        if (k === "q") { q.q = f.t; if (f.img) q.img = f.img; }
        else if (k === "qImg") q.img = fixImg(cell);
        else if (k === "correct") { q.correct = f.t; if (f.img) q.cImg = f.img; }
        else if (k === "cImg") q.cImg = fixImg(cell);
        else if (k === "wrong") { q.wrong[n] = f.t; if (f.img) q.wImg[n] = f.img; }
        else if (k === "wImg") q.wImg[n] = fixImg(cell);
      });
      const W = [], WI = [];
      for (let i = 0; i < Math.max(q.wrong.length, q.wImg.length); i++) if (q.wrong[i] || q.wImg[i]) { W.push(q.wrong[i] || ""); WI.push(q.wImg[i] || ""); }
      q.wrong = W; q.wImg = WI;
    } else {
      const fields = [];
      for (const cell of row) {
        if (!cell) continue;
        const f = splitImg(cell);
        if (f.bare && fields.length && !fields[fields.length - 1].img) fields[fields.length - 1].img = f.img;
        else fields.push(f);
      }
      const [fq, fc, ...fw] = fields;
      if (!fq || !fc) continue;
      Object.assign(q, { q: fq.t, img: fq.img, correct: fc.t, cImg: fc.img, wrong: fw.map((x) => x.t), wImg: fw.map((x) => x.img) });
    }
    if (/^question$/i.test(q.q)) continue;
    if (!q.q && !q.img) continue;
    if (!q.correct && !q.cImg) continue;
    if (!q.wrong.length && !q.correct) continue;
    q.wrong = q.wrong.slice(0, 5); q.wImg = q.wImg.slice(0, 5);
    out.push(q);
  }
  return out;
}
const fieldText = (t, img) => [t || "", img ? `[img: ${img}]` : ""].filter(Boolean).join(" ");
function questionsToText(qs) {
  return qs.map((q) => [fieldText(q.q, q.img), fieldText(q.correct, q.cImg), ...(q.wrong || []).map((w, i) => fieldText(w, (q.wImg || [])[i]))].join(" | ")).join("\n");
}
const imgTag = (src, cls = "") => src ? `<img class="${cls}" src="${esc(src)}" alt="" referrerpolicy="no-referrer" loading="eager" onerror="this.style.display='none'">` : "";

// ---- websocket with auto-reconnect ----
// Live connection with auto-reconnect.
// - heartbeat: a ping every 15s; if nothing comes back for 35s the socket is treated as dead and reopened
//   (school filters and sleeping Wi-Fi can leave a socket "open" but silent)
// - first retry is almost instant; later retries back off up to 8s
// - reconnects right away when the tab is shown again or the network comes back
// - queue: true keeps messages sent while offline and sends them after reconnecting (teacher controls)
function connect(path, { onOpen, onMessage, onStatus, queue = false }) {
  let ws, tries = 0, closedByUs = false, pingT, retryT, lastMsg = Date.now();
  const outbox = [];
  const api = {
    send(o) {
      if (ws && ws.readyState === 1) { ws.send(JSON.stringify(o)); return true; }
      if (queue && o.t !== "ping") { outbox.push(o); if (outbox.length > 50) outbox.shift(); }
      return false;
    },
    close() { closedByUs = true; clearInterval(pingT); clearTimeout(retryT); ws && ws.close(); },
    get online() { return !!ws && ws.readyState === 1; },
    offset: 0,
  };
  const open = () => {
    clearTimeout(retryT);
    if (closedByUs) return;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const sock = ws = new WebSocket(`${proto}//${location.host}${path}`);
    onStatus && onStatus("connecting");
    sock.onopen = () => {
      tries = 0; lastMsg = Date.now();
      onStatus && onStatus("online"); onOpen && onOpen();
      while (outbox.length && sock.readyState === 1) sock.send(JSON.stringify(outbox.shift()));
      clearInterval(pingT);
      pingT = setInterval(() => {
        if (Date.now() - lastMsg > 35000) { try { sock.close(4001, "heartbeat"); } catch {} return; }
        api.send({ t: "ping" });
      }, 15000);
    };
    sock.onmessage = (e) => {
      lastMsg = Date.now();
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.state && m.state.serverNow) api.offset = m.state.serverNow - Date.now();
      onMessage(m);
    };
    sock.onclose = (e) => {
      if (sock !== ws) return; // an old socket we already replaced
      clearInterval(pingT);
      if (closedByUs || e.code === 4000) { onStatus && onStatus("closed", e); return; }
      onStatus && onStatus("offline", e);
      tries++;
      retryT = setTimeout(open, tries === 1 ? 300 : Math.min(8000, 500 * 2 ** Math.min(tries, 4)));
    };
  };
  const wake = () => { if (!closedByUs && (!ws || ws.readyState > 1)) { tries = 0; open(); } };
  window.addEventListener("online", wake);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") wake(); });
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
  // ⚔️ final showdown: last 60 seconds of a 2+ minute game, surge doubles
  const showdown = !!(st.settings.showdown && st.status !== "lobby" && st.status !== "ended" && st.totalMs >= 120000 && remaining <= 60000);
  const surge = (st.status === "lobby" ? 1 : 1 + (M - 1) * (Math.exp(k * p) - 1) / (Math.exp(k) - 1)) * (showdown ? 2 : 1);
  return { remaining, elapsed, p, surge, showdown };
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
