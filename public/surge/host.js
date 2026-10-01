// ---------------- Host app ----------------
const DEFAULTS = {
  title: "Surge Showdown", theme: "elements", teamCount: 4, teams: themeTeams("elements"),
  durationMin: 10, hpAmount: 300, hpMode: "perPlayer", surgeMax: 5, surgeCurve: 4,
  powerScale: 1, energyScale: 1, fallenCanAttack: true, lastTeamEnds: false, teamPick: "auto",
  lateJoin: true, wrongPenalty: 5, ptsCorrect: 10, ptsDamage: 1, survivalBonus: 300, koBonus: 200, feedNames: true,
};
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

// ---------- SETUP FORM ----------
const nums = ["durationMin", "teamCount", "hpAmount", "wrongPenalty", "powerScale", "energyScale", "surgeMax", "ptsCorrect", "ptsDamage", "survivalBonus", "koBonus"];
const bools = ["fallenCanAttack", "lastTeamEnds", "lateJoin", "feedNames"];
const segs = ["teamPick", "hpMode", "surgeCurve"];

function initSetup() {
  $("#theme").innerHTML = Object.entries(THEMES).map(([k, t]) => `<option value="${k}">${t.label}</option>`).join("") + `<option value="custom">Custom</option>`;
  $("#durPresets").innerHTML = [5, 8, 10, 15, 20].map((m) => `<button class="btn sm ghost" data-m="${m}">${m} min</button>`).join("");
  $("#durPresets").onclick = (e) => { const m = e.target.dataset.m; if (m) { cfg.durationMin = +m; paintSetup(); } };
  $("#title").oninput = (e) => { cfg.title = e.target.value; persist(); };
  for (const k of nums) $("#" + k).addEventListener("input", (e) => { cfg[k] = Number(e.target.value); paintSetup(false); });
  for (const k of bools) $("#" + k).addEventListener("change", (e) => { cfg[k] = e.target.checked; persist(); });
  for (const k of segs) $("#" + k).addEventListener("click", (e) => {
    const v = e.target.dataset.v; if (v == null) return;
    cfg[k] = k === "surgeCurve" ? Number(v) : v; paintSetup();
  });
  $("#theme").onchange = (e) => { if (e.target.value !== "custom") { cfg.theme = e.target.value; cfg.teams = themeTeams(cfg.theme); } paintSetup(); };
  $("#qtext").addEventListener("input", () => { questions = parseQuestions($("#qtext").value); paintQuestions(); });
  $("#sampleBtn").onclick = () => { $("#qtext").value = questionsToText(SAMPLE_QUESTIONS); questions = SAMPLE_QUESTIONS.slice(); $("#setName").value = "8th Grade Science Sample"; paintQuestions(); };
  $("#fileBtn").onclick = () => $("#fileIn").click();
  $("#fileIn").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const txt = await f.text(); $("#qtext").value = questionsToText(parseQuestions(txt));
    questions = parseQuestions(txt); $("#setName").value = f.name.replace(/\.\w+$/, ""); paintQuestions(); e.target.value = "";
  };
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
function persist() { store.set("ss_settings", cfg); }
function paintSetup(full = true) {
  $("#title").value = cfg.title;
  for (const k of nums) { const el = $("#" + k); if (document.activeElement !== el || full) el.value = cfg[k]; }
  for (const k of bools) $("#" + k).checked = !!cfg[k];
  for (const k of segs) $("#" + k).querySelectorAll("button").forEach((b) => b.classList.toggle("on", String(cfg[k]) === b.dataset.v));
  $("#durationMinV").textContent = cfg.durationMin + " min";
  $("#teamCountV").textContent = cfg.teamCount;
  $("#powerScaleV").textContent = "×" + cfg.powerScale;
  $("#energyScaleV").textContent = "×" + cfg.energyScale;
  $("#surgeMaxV").textContent = "×" + cfg.surgeMax;
  $("#theme").value = THEMES[cfg.theme] ? cfg.theme : "custom";
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
    cfg.teams[i] = { ...cfg.teams[i], [f]: e.target.value }; cfg.theme = "custom"; $("#theme").value = "custom"; persist();
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
  ).join("<br>") + `<br><br>Upgrades: <b style="color:var(--ink)">Energy per Question</b> (10 → 160) and <b style="color:var(--ink)">Streak Bonus</b>. Fallen teams can't heal or shield${cfg.fallenCanAttack ? ", but they can still attack" : " and can't attack"}.`;
}
function paintQuestions() {
  store.set("ss_lastQuestions", questions);
  $("#qcount").textContent = `${questions.length} question${questions.length === 1 ? "" : "s"} ready` + (questions.length && questions.length < 10 ? " (10+ recommended so students don't see repeats too often)" : "");
  $("#qpreview").innerHTML = questions.slice(0, 200).map((q, i) => `<div class="qi">${i + 1}. ${esc(q.q)}<br><b>✓ ${esc(q.correct)}</b> ${q.wrong.length ? `<span class="w">✗ ${q.wrong.map(esc).join(" · ")}</span>` : `<span class="w">(type the answer)</span>`}</div>`).join("") || `<div class="qi muted">Paste questions above or load the sample set.</div>`;
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

// ---------- RENDER ----------
let lastStatus = null;
function render() {
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
  if (pickingMove()) return;
  $("#lobbyTeams").innerHTML = S.teams.map((t) => {
    const ps = S.players.filter((p) => p.team === t.id);
    return `<div class="tcol" style="--tc:${t.color}">
      <div class="th"><span>${esc(t.icon)}</span>${esc(t.name)}<span class="n">${ps.length}</span></div>
      <ul>${ps.map((p) => `<li><span class="${p.online ? "" : "off"}">${esc(p.name)}</span>
        <select data-move="${p.id}" title="Move to team">${teamOptions(t.id)}</select>
        <button class="xbtn" data-kick="${p.id}" title="Remove player">✕</button></li>`).join("") || `<li class="muted">Waiting…</li>`}</ul>
    </div>`;
  }).join("");
}
function hpBar(t) {
  const hp = t.maxHp ? (t.hp / t.maxHp) * 100 : 0, sh = t.maxHp ? Math.min(100, (t.shield / t.maxHp) * 100) : 0;
  return `<div class="hpbar"><div class="hp" style="width:${hp}%"></div><div class="sh" style="width:${sh}%"></div></div>`;
}
function renderLive(url) {
  $("#liveCode").textContent = S.code; $("#liveUrl").textContent = url;
  $("#pauseBtn").innerHTML = S.status === "paused" ? "▶ Resume" : "⏸ Pause";
  const ranked = S.teams.filter((t) => t.active).slice().sort((a, b) => b.score - a.score);
  const rankOf = Object.fromEntries(ranked.map((t, i) => [t.id, i + 1]));
  $("#battle").innerHTML = S.teams.filter((t) => t.active).map((t) => {
    const wasHit = lastHp[t.id] != null && t.hp + t.shield < lastHp[t.id];
    lastHp[t.id] = t.hp + t.shield;
    return `<div class="tcard ${t.alive ? "" : "dead"} ${wasHit ? "hit" : ""}" style="--tc:${t.color}">
      ${t.alive ? "" : `<div class="fallen-tag">FALLEN</div>`}
      <div class="tc-top"><div class="tc-icon">${esc(t.icon)}</div><div><div class="tc-name">${esc(t.name)}</div><div class="muted" style="font-size:13px;font-weight:600">#${rankOf[t.id]} · ${t.size} player${t.size === 1 ? "" : "s"}</div></div>
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
      <td><span style="opacity:${p.online ? 1 : .45}">${esc(p.name)}</span></td>
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
  if (k) { const p = S.players.find((x) => x.id === k.dataset.kick); if (p && confirm(`Remove ${p.name} from the game?`)) conn.send({ t: "kick", pid: p.id }); }
  const th = e.target.closest("th[data-sort]"); if (th) { sortKey = th.dataset.sort; renderPlayers(); }
});
document.addEventListener("change", (e) => { const m = e.target.closest("select[data-move]"); if (m) conn.send({ t: "move", pid: m.dataset.move, team: Number(m.value) }); });
$("#startBtn").onclick = () => conn.send({ t: "start" });
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

// ---------- boot ----------
initSetup();
fetch(BASE + "/api/rules").then((r) => r.json()).then((r) => { RULES = r; paintPowerInfo(); }).catch(() => {});
if (session) startConn(); else render();
