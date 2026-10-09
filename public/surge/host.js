// ---------------- Host app ----------------
const DEFAULTS = {
  title: "Surge Showdown", theme: "elements", teamCount: 4, teams: themeTeams("elements"),
  durationMin: 10, hpAmount: 300, hpMode: "perPlayer", surgeMax: 5, surgeCurve: 4,
  powerScale: 1, energyScale: 1, fallenCanAttack: true, sizeBoost: true, lastTeamEnds: false, teamPick: "auto",
  lateJoin: true, wrongPenalty: 5, ptsCorrect: 10, ptsDamage: 1, survivalBonus: 300, koBonus: 200, feedNames: true, demo: false, intro: "auto",
};
// The Google Sheets question template ("Make a copy" link)
const SHEET_TEMPLATE_URL = "https://docs.google.com/spreadsheets/d/1id9tjF6A5Ua9x3r4QxDGTu7DRMpviwWUOj8LGmud1eU/copy";
let cfg = { ...DEFAULTS, ...store.get("ss_settings", {}) };
if (!Array.isArray(cfg.teams) || cfg.teams.length < 10) cfg.teams = themeTeams(cfg.theme);
let questions = store.get("ss_lastQuestions", []);
let RULES = null, conn = null, S = null, session = store.get("ss_host", null), editing = false;
let sortKey = "points", lastHp = {};

const views = ["setup", "lobby", "live", "results"];
function show(v) {
  views.forEach((x) => $("#" + x).classList.toggle("hidden", x !== v));
  $("#liveControls").classList.toggle("hidden", v !== "live");
}

// ---------- SETUP FORM (every setting is a dropdown row) ----------
const yesNo = [[true, "Yes"], [false, "No"]];
const range = (arr, fmt) => arr.map((v) => [v, fmt(v)]);
const times = (v) => "×" + v;
const SETTINGS = [
  { g: "game", k: "durationMin", label: "Game length", desc: "How long the battle lasts. You can add or remove time during the game.", opts: range([3, 5, 8, 10, 12, 15, 20, 25, 30, 45], (v) => `${v} min`) },
  { g: "game", k: "intro", label: "How-to-play intro", desc: "Slides on this screen explain the game when you click Start. The timer waits until they finish. Skip any time.", opts: [["auto", "Yes, auto-advance"], ["manual", "Yes, I click Next"], ["off", "No intro"]] },
  { g: "teams", k: "teamCount", label: "Number of teams", desc: "Teams with no players sit out.", opts: range([2, 3, 4, 5, 6, 7, 8, 9, 10], String) },
  { g: "teams", k: "theme", label: "Team theme", desc: "Names, icons and colors for the teams.", opts: null },
  { g: "teams", k: "teamPick", label: "How students join a team", desc: "Auto-balance keeps teams even.", opts: [["auto", "Auto-balance"], ["choose", "Students choose"]] },
  { g: "teams", k: "lateJoin", label: "Join after the game starts", desc: "New students can jump in mid-game. You can also open or lock joining during the game.", opts: yesNo },
  { g: "battle", k: "hpAmount", label: "Team health", desc: "Starting health. Teams fall when it reaches zero.", opts: range([100, 150, 200, 250, 300, 400, 500, 750, 1000, 1500, 2000], String) },
  { g: "battle", k: "hpMode", label: "Health is counted", desc: "Per player gives bigger teams more health.", opts: [["perPlayer", "Per player"], ["flat", "Per team"]] },
  { g: "battle", k: "wrongPenalty", label: "Energy lost on a wrong answer", desc: "Keeps students from guessing.", opts: range([0, 2, 5, 10, 15, 20, 25, 50], String) },
  { g: "battle", k: "powerScale", label: "Power-up strength", desc: "Bigger means faster, more dramatic battles.", opts: range([0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3], times) },
  { g: "battle", k: "energyScale", label: "Energy earned per answer", desc: "How fast students can afford power-ups.", opts: range([0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3], times) },
  { g: "battle", k: "fallenCanAttack", label: "Fallen teams can still attack", desc: "Knocked-out teams keep answering and attacking.", opts: yesNo },
  { g: "battle", k: "sizeBoost", label: "Boost smaller teams", desc: "Smaller teams get stronger power-ups to even things out. A team of 3 against a team of 4 gets power-ups 33% stronger.", opts: yesNo },
  { g: "battle", k: "lastTeamEnds", label: "End when one team is left", desc: "Otherwise the game runs until time is up.", opts: yesNo },
  { g: "battle", k: "feedNames", label: "Show names in the battle feed", desc: "No shows team names only.", opts: yesNo },
  { g: "surge", k: "surgeMax", label: "Max surge at the end", desc: "Power-up multiplier at the final second.", opts: range([1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 15], times) },
  { g: "surge", k: "surgeCurve", label: "Surge curve", desc: "Steeper curves save the big jump for the last minutes.", opts: [[2, "Gentle"], [4, "Steep"], [7, "Extreme"]] },
  { g: "scoring", k: "ptsCorrect", label: "Points per correct answer", desc: "", opts: range([0, 5, 10, 15, 20, 25, 50, 100], String) },
  { g: "scoring", k: "ptsDamage", label: "Points per 1 damage dealt", desc: "", opts: range([0, 0.25, 0.5, 1, 2, 3, 5], String) },
  { g: "scoring", k: "survivalBonus", label: "Survival bonus", desc: "For each team still standing at the end.", opts: range([0, 100, 200, 300, 500, 750, 1000, 2000], String) },
  { g: "scoring", k: "koBonus", label: "Knockout bonus", desc: "For the team that lands the final blow.", opts: range([0, 100, 200, 300, 500, 750, 1000, 2000], String) },
];
const SPEC = Object.fromEntries(SETTINGS.map((x) => [x.k, x]));

function optionsFor(spec) {
  if (spec.k === "theme") return [...Object.entries(THEMES).map(([k, t]) => [k, t.label]), ["custom", "Custom"]];
  let opts = spec.opts.slice();
  const cur = cfg[spec.k];
  if (!opts.some(([v]) => String(v) === String(cur))) { // keep a saved value that isn't in the list
    opts.push([cur, typeof cur === "number" ? (spec.opts[0][1].startsWith("×") ? times(cur) : spec.k === "durationMin" ? `${cur} min` : String(cur)) : String(cur)]);
    if (typeof cur === "number") opts.sort((a, b) => a[0] - b[0]);
  }
  return opts;
}
function readVal(k, raw) {
  const d = DEFAULTS[k];
  if (typeof d === "boolean") return raw === "true";
  if (typeof d === "number") return Number(raw);
  return raw;
}

function initSetup() {
  for (const box of document.querySelectorAll("[data-group]")) {
    box.innerHTML = SETTINGS.filter((x) => x.g === box.dataset.group).map((x) => `
      <div class="srow"><div class="stxt"><b>${x.label}</b>${x.desc ? `<span>${x.desc}</span>` : ""}</div>
      <select data-k="${x.k}" aria-label="${x.label}"></select></div>`).join("");
  }
  document.querySelectorAll("select[data-k]").forEach((sel) => sel.addEventListener("change", () => {
    const k = sel.dataset.k;
    if (k === "theme") { if (sel.value !== "custom") { cfg.theme = sel.value; cfg.teams = themeTeams(cfg.theme); } }
    else cfg[k] = readVal(k, sel.value);
    paintSetup();
  }));
  $("#demo").addEventListener("change", (e) => { cfg.demo = e.target.checked; persist(); });
  $("#title").oninput = (e) => { cfg.title = e.target.value; persist(); };
  $("#qtext").addEventListener("input", () => { questions = parseQuestions($("#qtext").value); paintQuestions(); });
  $("#sampleBtn").onclick = () => { questions = SAMPLE_QUESTIONS.slice(); $("#qtext").value = questionsToText(questions); $("#setName").value = "8th Grade Science Sample"; paintQuestions(); };
  $("#fileBtn").onclick = () => $("#fileIn").click();
  $("#fileIn").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const txt = await f.text(); questions = parseQuestions(txt); $("#qtext").value = questionsToText(questions);
    $("#setName").value = f.name.replace(/\.\w+$/, ""); paintQuestions(); e.target.value = "";
  };
  $("#templateLink").href = SHEET_TEMPLATE_URL;
  $("#sheetBtn").onclick = importSheet;
  $("#sheetUrl").onkeydown = (e) => { if (e.key === "Enter") importSheet(); };
  $("#saveSet").onclick = () => {
    const name = $("#setName").value.trim(); if (!name) return toast("Give the set a name first", "bad");
    if (!questions.length) return toast("No questions to save", "bad");
    const sets = store.get("ss_sets", {}); sets[name] = questions; store.set("ss_sets", sets); paintSets(name); toast(`Saved “${name}”`, "good");
  };
  $("#loadSet").onclick = () => {
    const name = $("#savedSets").value; const sets = store.get("ss_sets", {});
    if (!sets[name]) return; questions = sets[name]; $("#qtext").value = questionsToText(questions); $("#setName").value = name; paintQuestions();
  };
  $("#delSet").onclick = () => {
    const name = $("#savedSets").value; const sets = store.get("ss_sets", {});
    if (!sets[name] || !confirm(`Delete the saved set “${name}”?`)) return; delete sets[name]; store.set("ss_sets", sets); paintSets();
  };
  $("#createBtn").onclick = createOrSave;
  $("#cancelEdit").onclick = () => { editing = false; render(); };
  $("#qtext").value = questionsToText(questions);
  paintSets(); paintSetup(); paintQuestions();
}
async function importSheet() {
  const link = $("#sheetUrl").value.trim();
  if (!/docs\.google\.com\/spreadsheets\/d\//.test(link)) return toast("Paste a Google Sheets link first", "bad");
  $("#sheetBtn").disabled = true; $("#sheetBtn").textContent = "Importing…";
  try {
    const r = await fetch(`${BASE}/api/sheet?url=${encodeURIComponent(link)}`);
    if (!r.ok) { let msg = "Couldn't open that sheet."; try { msg = (await r.json()).error || msg; } catch {} throw new Error(msg); }
    const qs = rowsToQuestions(parseCSV(await r.text()));
    if (!qs.length) throw new Error("No questions found. Check that the first tab has the template's header row.");
    questions = qs; $("#qtext").value = questionsToText(qs); paintQuestions();
    if (!$("#setName").value) $("#setName").value = "Google Sheet set";
    toast(`Imported ${qs.length} question${qs.length === 1 ? "" : "s"}`, "good");
  } catch (e) { toast(e.message, "bad"); }
  $("#sheetBtn").disabled = false; $("#sheetBtn").textContent = "Import";
}
function persist() { store.set("ss_settings", cfg); }
function paintSetup() {
  $("#title").value = cfg.title;
  document.querySelectorAll("select[data-k]").forEach((sel) => {
    const spec = SPEC[sel.dataset.k];
    sel.innerHTML = optionsFor(spec).map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
    sel.value = spec.k === "theme" ? (THEMES[cfg.theme] ? cfg.theme : "custom") : String(cfg[spec.k]);
  });
  $("#demo").checked = !!cfg.demo;
  // team editor
  const te = $("#teamEdit");
  te.innerHTML = cfg.teams.map((t, i) => `
    <div class="te ${i >= cfg.teamCount ? "off" : ""}" data-i="${i}">
      <input class="ic" type="text" value="${esc(t.icon)}" data-f="icon" maxlength="4" aria-label="Icon">
      <input type="text" value="${esc(t.name)}" data-f="name" maxlength="20" aria-label="Team name">
      <input type="color" value="${t.color}" data-f="color" aria-label="Color">
    </div>`).join("");
  te.oninput = (e) => {
    const i = +e.target.closest(".te").dataset.i, f = e.target.dataset.f;
    cfg.teams[i] = { ...cfg.teams[i], [f]: e.target.value }; cfg.theme = "custom"; $('select[data-k="theme"]').value = "custom"; persist();
  };
  drawCurve();
  paintPowerInfo();
  persist();
}
function drawCurve() {
  const M = cfg.surgeMax, k = cfg.surgeCurve, W = 400, H = 120, pad = 10;
  const f = (p) => 1 + (M - 1) * (Math.exp(k * p) - 1) / (Math.exp(k) - 1);
  let d = "";
  for (let i = 0; i <= 80; i++) {
    const p = i / 80, y = H - pad - ((f(p) - 1) / Math.max(0.0001, M - 1)) * (H - pad * 2);
    d += (i ? "L" : "M") + (p * W).toFixed(1) + "," + (M === 1 ? H - pad : y).toFixed(1);
  }
  $("#curve").innerHTML = `
    <defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#22d3ee"/><stop offset=".6" stop-color="#facc15"/><stop offset="1" stop-color="#ef4444"/></linearGradient></defs>
    <path d="${d} L${W},${H} L0,${H} Z" fill="url(#g)" opacity=".18"/>
    <path d="${d}" fill="none" stroke="url(#g)" stroke-width="4" vector-effect="non-scaling-stroke"/>
    <text x="${W - 6}" y="20" text-anchor="end" fill="#ffd23f" font-size="16" font-weight="700">×${M}</text>`;
  $("#curveMid").textContent = `Halfway: ×${f(0.5).toFixed(1)} · 90%: ×${f(0.9).toFixed(1)}`;
}
function paintPowerInfo() {
  if (!RULES) return;
  const sc = cfg.powerScale;
  $("#powerInfo").innerHTML = Object.values(RULES.powers).map((p) =>
    `${p.icon} <b style="color:var(--ink)">${p.name}</b> (${p.cost} energy): ${p.desc} Starts at <b style="color:var(--good)">${Math.round(p.base * sc)}</b>, ends at <b style="color:var(--accent)">${Math.round(p.base * sc * cfg.surgeMax)}</b>.`
  ).join("<br>") + `<br><br>Upgrades: <b style="color:var(--ink)">Energy per Question</b> (10 → 160) and <b style="color:var(--ink)">Streak Bonus</b>. Fallen teams can't heal or shield${cfg.fallenCanAttack ? ", but they can still attack" : " and can't attack"}.${cfg.sizeBoost ? ` Smaller teams get a <b style="color:var(--ink)">size boost</b>: power-ups × (biggest team ÷ their team), so 3 players vs 4 means +33%.` : ""}`;
}
function paintQuestions() {
  store.set("ss_lastQuestions", questions);
  $("#qcount").textContent = `${questions.length} question${questions.length === 1 ? "" : "s"} ready` + (questions.length && questions.length < 10 ? " (10+ recommended so students don't see repeats too often)" : "");
  const part = (t, img) => `${imgTag(img)}${esc(t)}`;
  $("#qpreview").innerHTML = questions.slice(0, 200).map((q, i) => `<div class="qi">${i + 1}. ${part(q.q, q.img)}<br><b>✓ ${part(q.correct, q.cImg)}</b> ${q.wrong.length ? `<span class="w">✗ ${q.wrong.map((w, k) => part(w, (q.wImg || [])[k])).join(" · ")}</span>` : `<span class="w">(type the answer)</span>`}</div>`).join("") || `<div class="qi muted">Paste questions above, import a Google Sheet, or load the sample set.</div>`;
}
function paintSets(sel) {
  const sets = store.get("ss_sets", {}); const names = Object.keys(sets);
  $("#savedSets").innerHTML = names.length ? names.map((n) => `<option ${n === sel ? "selected" : ""}>${esc(n)}</option>`).join("") : `<option value="">No saved sets yet</option>`;
}
function settingsPayload() { return { ...cfg, teams: cfg.teams }; }

async function createOrSave() {
  if (!questions.length) return toast("Add at least one question first", "bad");
  if (editing && session) {
    conn.send({ t: "settings", settings: settingsPayload() });
    conn.send({ t: "questions", questions });
    editing = false; toast("Settings saved", "good"); render(); return;
  }
  $("#createBtn").disabled = true; $("#setupMsg").textContent = "Creating game…";
  try {
    const r = await fetch(BASE + "/api/create", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ settings: settingsPayload(), questions }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "Failed");
    session = { code: j.code, hostKey: j.hostKey }; store.set("ss_host", session);
    startConn();
  } catch (e) { toast(e.message, "bad"); }
  $("#createBtn").disabled = false; $("#setupMsg").textContent = "";
}

// ---------- CONNECTION ----------
function startConn() {
  if (conn) conn.close();
  conn = connect(`${BASE}/ws/${session.code}?role=host&key=${encodeURIComponent(session.hostKey)}`, {
    onMessage: onMsg,
    onStatus: (st, e) => {
      const el = $("#conn");
      el.textContent = st === "online" ? "● Live" : st === "connecting" ? "● Connecting…" : "● Reconnecting…";
      el.style.color = st === "online" ? "var(--good)" : "var(--accent)";
      if (st === "offline" && e && (e.code === 1006 || e.code === 1002)) {
        // check if game still exists
        fetch(`${BASE}/api/exists/${session.code}`).then((r) => r.json()).then((j) => { if (!j.exists) { toast("That game no longer exists", "bad"); newGame(); } }).catch(() => {});
      }
    },
  });
}
function onMsg(m) {
  if (m.t === "hello") { RULES = m.rules; S = m.state; if (m.questions) questions = m.questions; render(); }
  else if (m.t === "state") { S = m.state; render(); }
  else if (m.t === "error") toast(m.msg, "bad");
}
function newGame() {
  if (conn) conn.close(); conn = null; session = null; S = null; store.del("ss_host"); editing = false; render();
}

// ---------- DEMO SPLIT SCREEN (teacher screen + one player's screen) ----------
let watch = { code: null, pid: null, hidden: false };
const WATCH_NAME = "Teacher View";
function renderWatch() {
  const on = !!(S && S.settings.demo && !editing);
  const pane = $("#watchPane");
  document.body.classList.toggle("split", on && !watch.hidden);
  pane.classList.toggle("hidden", !on || watch.hidden);
  $("#wpShow").classList.toggle("hidden", !on || !watch.hidden);
  if (!on) return;
  const gone = watch.pid && !S.players.some((p) => p.id === watch.pid);
  if (watch.code !== S.code || (gone && S.status !== "ended")) {
    watch = { code: S.code, pid: null, hidden: watch.hidden };
    store.del("ss_w_" + S.code); // fresh player each time the view is rebuilt
    $("#wpFrame").src = `${BASE}/?code=${S.code}&embed=1&name=${encodeURIComponent(WATCH_NAME)}`;
  }
  const me = S.players.find((p) => p.id === watch.pid);
  if (me) { const t = S.teams[me.team]; $("#wpWho").textContent = `${me.name} · ${t ? t.icon + " " + t.name : ""} · ${me.points} pts`; }
}
window.addEventListener("message", (e) => {
  if (e.origin !== location.origin || !e.data || !e.data.surgeWatch || !S || e.data.code !== S.code) return;
  watch.pid = e.data.pid;
  conn.send({ t: "autopilot", pid: watch.pid, on: $("#wpAuto").value === "true" });
});
$("#wpAuto").onchange = () => { if (watch.pid) conn.send({ t: "autopilot", pid: watch.pid, on: $("#wpAuto").value === "true" }); };
$("#wpHide").onclick = () => { watch.hidden = true; renderWatch(); };
$("#wpShow").onclick = () => { watch.hidden = false; renderWatch(); };

// ---------- RENDER ----------
let lastStatus = null;
function render() {
  renderWatch();
  if (!S || editing) {
    show("setup");
    $("#createBtn").textContent = editing ? "Save changes" : "Create game →";
    $("#cancelEdit").classList.toggle("hidden", !editing);
    paintPowerInfo();
    return;
  }
  $("#brandTitle").textContent = S.settings.title;
  $("#pausedBanner").classList.toggle("hidden", S.status !== "paused");
  const url = location.host + BASE;
  paintJoinBits(url);
  if (S.status === "ended") $("#joinModal").classList.add("hidden");
  if (S.status === "lobby") { show("lobby"); renderLobby(url); }
  else if (S.status === "running" || S.status === "paused") { show("live"); renderLive(url); }
  else if (S.status === "ended") { show("results"); renderResults(lastStatus !== "ended"); }
  lastStatus = S.status;
}
function teamOptions(sel) {
  return S.teams.map((t) => `<option value="${t.id}" ${t.id === sel ? "selected" : ""}>${esc(t.icon)} ${esc(t.name)}</option>`).join("");
}
function renderLobby(url) {
  $("#joinUrl").textContent = url;
  $("#joinCode").textContent = S.code;
  $("#playerCount").textContent = S.players.length;
  $("#startBtn").disabled = S.players.length === 0;
  $("#demoBtnLobby").textContent = S.settings.demo ? "🎭 Remove pretend students" : "🎭 Add 40 pretend students";
  $("#removedLobby").innerHTML = removedHTML();
  if (pickingMove()) return;
  $("#lobbyTeams").innerHTML = S.teams.map((t) => {
    const ps = S.players.filter((p) => p.team === t.id);
    return `<div class="tcol" style="--tc:${t.color}">
      <div class="th"><span>${esc(t.icon)}</span>${esc(t.name)}${boostTag(t)}<span class="n">${ps.length}</span></div>
      <ul>${ps.map((p) => `<li><span class="${p.online ? "" : "off"}">${esc(p.name)}${p.bot ? `<span class="bot-tag" title="Pretend student">🎭</span>` : p.watch ? `<span class="bot-tag" title="Your player view">👀</span>` : ""}</span>
        <select data-move="${p.id}" title="Move to team">${teamOptions(t.id)}</select>
        <button class="xbtn" data-kick="${p.id}" title="Remove player">✕</button></li>`).join("") || `<li class="muted">Waiting…</li>`}</ul>
    </div>`;
  }).join("");
}
function boostTag(t) {
  const bp = Math.round(((t.boost || 1) - 1) * 100);
  return bp > 0 ? `<span class="boost-tag" title="Smaller team: power-ups are ${bp}% stronger">💪 +${bp}%</span>` : "";
}
function removedHTML() {
  const r = S.removed || [];
  if (!r.length) return "";
  return `<div class="removed"><div class="lbl">Removed students (${r.length})</div>${r.map((p) => `<div class="rm"><span>${esc(p.name)}</span><button class="btn sm ghost" data-readmit="${p.id}">Let back in</button></div>`).join("")}</div>`;
}
function paintJoinBits(url) {
  $("#jmUrl").textContent = url; $("#jmCode").textContent = S.code;
  for (const id of ["#lateJoinLive", "#lateJoinModal"]) if (document.activeElement !== $(id)) $(id).value = String(!!S.settings.lateJoin);
  if (document.activeElement !== $("#demoLive")) $("#demoLive").value = String(!!S.settings.demo);
  $("#jmNote").textContent = S.settings.lateJoin
    ? (S.status === "lobby" ? "Students join a team right away." : "New students go to the smallest team that is still standing, and that team gets extra health for them.")
    : "Joining is locked. Students who were already in the game can still reconnect.";
}
function hpBar(t) {
  const hp = t.maxHp ? (t.hp / t.maxHp) * 100 : 0, sh = t.maxHp ? Math.min(100, (t.shield / t.maxHp) * 100) : 0;
  return `<div class="hpbar"><div class="hp" style="width:${hp}%"></div><div class="sh" style="width:${sh}%"></div></div>`;
}
function renderLive(url) {
  $("#liveCode").textContent = S.code; $("#liveUrl").textContent = url;
  $("#removedLive").innerHTML = removedHTML();
  $("#pauseBtn").innerHTML = S.status === "paused" ? "▶ Resume" : "⏸ Pause";
  const ranked = S.teams.filter((t) => t.active).slice().sort((a, b) => b.score - a.score);
  const rankOf = Object.fromEntries(ranked.map((t, i) => [t.id, i + 1]));
  $("#battle").innerHTML = S.teams.filter((t) => t.active).map((t) => {
    const wasHit = lastHp[t.id] != null && t.hp + t.shield < lastHp[t.id];
    lastHp[t.id] = t.hp + t.shield;
    return `<div class="tcard ${t.alive ? "" : "dead"} ${wasHit ? "hit" : ""}" style="--tc:${t.color}">
      ${t.alive ? "" : `<div class="fallen-tag">FALLEN</div>`}
      <div class="tc-top"><div class="tc-icon">${esc(t.icon)}</div><div><div class="tc-name">${esc(t.name)}</div><div class="muted" style="font-size:13px;font-weight:600">#${rankOf[t.id]} · ${t.size} player${t.size === 1 ? "" : "s"}${boostTag(t)}</div></div>
        <div class="tc-score">${t.score.toLocaleString()}<small>points</small></div></div>
      <div class="tc-hp">${hpBar(t)}</div>
      <div class="tc-meta"><span>❤️ ${t.hp} / ${t.maxHp}${t.shield ? ` · 🛡️ ${t.shield}` : ""}</span><span>${t.kos ? `💀×${t.kos}` : ""}</span></div>
    </div>`;
  }).join("");
  const feed = $("#feed");
  feed.innerHTML = S.feed.slice().reverse().map((e) => `<div class="ev ${e.kind}">${esc(e.text)}</div>`).join("");
  renderPlayers();
}
const pickingMove = () => document.activeElement && document.activeElement.matches && document.activeElement.matches("select[data-move]");
function renderPlayers() {
  if (pickingMove()) return;
  const cols = [["name", "Player"], ["team", "Team"], ["correct", "✓"], ["wrong", "✗"], ["acc", "Acc"], ["energy", "⚡"], ["dmg", "Dmg"], ["points", "Pts"]];
  const ps = S.players.map((p) => ({ ...p, acc: p.correct + p.wrong ? Math.round((p.correct / (p.correct + p.wrong)) * 100) : 0 }));
  ps.sort((a, b) => (sortKey === "name" ? a.name.localeCompare(b.name) : (b[sortKey] ?? 0) - (a[sortKey] ?? 0)));
  $("#ptable").innerHTML = `<thead><tr>${cols.map(([k, l]) => `<th data-sort="${k}">${l}${sortKey === k ? " ▾" : ""}</th>`).join("")}<th></th></tr></thead><tbody>` +
    ps.map((p) => { const t = S.teams[p.team]; return `<tr>
      <td><span style="opacity:${p.online ? 1 : .45}">${esc(p.name)}</span>${p.bot ? `<span class="bot-tag" title="Pretend student">🎭</span>` : p.watch ? `<span class="bot-tag" title="Your player view">👀</span>` : ""}</td>
      <td><select data-move="${p.id}" style="padding:2px 4px;font-size:12px;border-width:1px;width:auto">${S.teams.filter((x) => x.active).map((x) => `<option value="${x.id}" ${x.id === p.team ? "selected" : ""}>${esc(x.icon)} ${esc(x.name)}</option>`).join("")}</select></td>
      <td class="num">${p.correct}</td><td class="num">${p.wrong}</td><td class="num">${p.acc}%</td><td class="num">${p.energy}</td><td class="num">${p.dmg}</td><td class="num"><b>${p.points}</b></td>
      <td><button class="xbtn" data-kick="${p.id}" title="Remove player">✕</button></td></tr>`; }).join("") + "</tbody>";
}
const AWARDS = [["mvp", "🌟", "MVP (most points)"], ["damage", "💥", "Most damage"], ["correct", "🧠", "Most correct"], ["streak", "🔥", "Longest streak"], ["healer", "💚", "Top healer"]];
function renderResults(fresh) {
  const R = S.results; if (!R) return;
  const reasons = { time: "Time ran out!", host: "The game was ended by the teacher.", allFallen: "Every team fell!", lastTeam: "Only one team was left standing!" };
  $("#endReason").textContent = reasons[S.endReason] || "";
  $("#podium").innerHTML = podiumHTML(R);
  $("#awards").innerHTML = AWARDS.map(([k, ic, label]) => { const a = R.awards[k]; if (!a) return ""; const t = S.teams[a.team];
    return `<div class="award"><div class="a-ic">${ic}</div><div class="a-t">${label}</div><div class="a-n">${esc(a.name)}</div><div class="muted">${esc(t?.icon || "")} ${esc(t?.name || "")} · ${a.value.toLocaleString()}</div></div>`; }).join("");
  $("#rankList").innerHTML = R.ranked.map((t) => `<div class="rank-row" style="--tc:${t.color}"><span class="r">${t.rank}</span><span style="font-size:24px">${esc(t.icon)}</span><b>${esc(t.name)}</b>
    <span class="muted">${t.alive ? "Survived ❤️ " + t.hp : "Fallen 💀"}${t.kos ? ` · ${t.kos} KO` : ""}</span><span class="s">${t.score.toLocaleString()} pts</span></div>`).join("");
  if (fresh) setTimeout(confetti, 1300);
}

// ---------- live ticker ----------
setInterval(() => {
  if (!S || !conn || (S.status !== "running" && S.status !== "paused")) return;
  const tm = timing(S, conn.offset);
  $("#timer").textContent = fmtTime(tm.remaining);
  $("#timer").classList.toggle("low", tm.remaining < 30000 && S.status === "running");
  $("#surgeX").textContent = "×" + tm.surge.toFixed(1);
  $("#surgeX").style.setProperty("--glow", Math.min(1, (tm.surge - 1) / Math.max(1, S.settings.surgeMax - 1)));
  $("#surgeFill").style.width = (S.settings.surgeMax > 1 ? ((tm.surge - 1) / (S.settings.surgeMax - 1)) * 100 : 0) + "%";
}, 250);

// ---------- events ----------
document.addEventListener("click", (e) => {
  const k = e.target.closest("[data-kick]");
  if (k) { const p = S.players.find((x) => x.id === k.dataset.kick); if (p && (p.bot || confirm(`Remove ${p.name} from the game? You can let them back in later.`))) conn.send({ t: "kick", pid: p.id }); }
  const ra = e.target.closest("[data-readmit]"); if (ra) conn.send({ t: "readmit", pid: ra.dataset.readmit });
  const th = e.target.closest("th[data-sort]"); if (th) { sortKey = th.dataset.sort; renderPlayers(); }
});
document.addEventListener("change", (e) => { const m = e.target.closest && e.target.closest("select[data-move]"); if (m) conn.send({ t: "move", pid: m.dataset.move, team: Number(m.value) }); });
$("#startBtn").onclick = () => {
  const go = () => { if (S && S.status === "lobby") conn.send({ t: "start" }); };
  if (cfg.intro === "off") go(); else Intro.play(S, go);
};
$("#introBtn").onclick = () => Intro.play(S);
$("#pauseBtn").onclick = () => conn.send({ t: S.status === "paused" ? "resume" : "pause" });
$("#plusBtn").onclick = () => conn.send({ t: "addTime", sec: 60 });
$("#minusBtn").onclick = () => conn.send({ t: "addTime", sec: -60 });
$("#endBtn").onclick = () => { if (confirm("End the game now and show the podium?")) conn.send({ t: "end" }); };
$("#rematchBtn").onclick = () => conn.send({ t: "rematch" });
$("#newBtn").onclick = () => { if (confirm("Start a brand-new game? Students will need the new code.")) newGame(); };
$("#editBtn").onclick = () => {
  cfg = { ...cfg, ...S.settings }; editing = true;
  $("#qtext").value = questionsToText(questions); paintSetup(); paintQuestions(); render();
};
$("#shuffleBtn").onclick = () => conn.send({ t: "shuffle" });
$("#demoBtnLobby").onclick = () => conn.send({ t: "demo", on: !S.settings.demo });
const openJoin = () => $("#joinModal").classList.remove("hidden");
$("#addBtn").onclick = openJoin; $("#addBtn2").onclick = openJoin;
$("#jmClose").onclick = () => $("#joinModal").classList.add("hidden");
$("#joinModal").onclick = (e) => { if (e.target.id === "joinModal") $("#joinModal").classList.add("hidden"); };
for (const id of ["#lateJoinLive", "#lateJoinModal"]) $(id).onchange = (e) => conn.send({ t: "lateJoin", on: e.target.value === "true" });
$("#demoLive").onchange = (e) => conn.send({ t: "demo", on: e.target.value === "true" });

// ---------- boot ----------
initSetup();
fetch(BASE + "/api/rules").then((r) => r.json()).then((r) => { RULES = r; paintPowerInfo(); }).catch(() => {});
if (session) startConn(); else render();
