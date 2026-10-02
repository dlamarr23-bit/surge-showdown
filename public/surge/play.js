// ---------------- Player app ----------------
let conn = null, S = null, me = null, RULES = null, code = null, token = null;
let removed = false;
let curQ = null, queuedQ = null, locked = false, wantTeam = null, tab = "q", lastMyHp = null, joinedOnce = false, shopBuilt = false, lastStatus = null;

const V = ["vJoin", "vWait", "vGame", "vEnd"];
const show = (v) => V.forEach((x) => $("#" + x).classList.toggle("hidden", x !== v));
// ?embed=1&name=… is the teacher's "player view" inside the demo split screen
const QS = new URLSearchParams(location.search);
const EMBED = QS.get("embed") === "1", EMBED_NAME = QS.get("name") || "";
const sessKey = (c) => (EMBED ? "ss_w_" : "ss_p_") + c;
if (EMBED) document.body.classList.add("embed");

// ---------- join flow ----------
async function tryCode(c) {
  c = String(c || "").replace(/\D/g, "");
  if (c.length !== 6) { $("#joinErr").textContent = "Enter the 6-digit code."; return; }
  $("#joinErr").textContent = "";
  try {
    const j = await (await fetch(`${BASE}/api/exists/${c}`)).json();
    if (!j.exists) { $("#joinErr").textContent = "No game with that code."; return; }
    code = c; token = store.get(sessKey(c), null);
    if (!EMBED) history.replaceState(null, "", `${BASE}/?code=${c}`);
    openConn();
  } catch { $("#joinErr").textContent = "Couldn't reach the game. Check your connection."; }
}
function openConn() {
  if (conn) conn.close();
  conn = connect(`${BASE}/ws/${code}?role=player`, { onMessage: onMsg, onStatus: (st, e) => {
    if (st === "closed" && e && e.code === 4000) kicked();
    if (st === "offline" && joinedOnce) toast("Reconnecting…");
  } });
}
function sendJoin() {
  const name = $("#nameIn").value.trim();
  if (!token && !name) { $("#joinErr").textContent = "Type your name."; return; }
  if (!token && S.settings.teamPick === "choose" && wantTeam == null && pickable().length) { $("#joinErr").textContent = "Pick a team."; return; }
  conn.send({ t: "join", name, token, team: wantTeam });
}
function pickable() { return S.teams.filter((t) => S.status === "lobby" || (t.active && t.alive)); }
function showNameStep() {
  show("vJoin");
  $("#stepCode").classList.add("hidden"); $("#stepName").classList.remove("hidden");
  const choose = S.settings.teamPick === "choose";
  $("#pickWrap").classList.toggle("hidden", !choose);
  if (choose) {
    $("#teamPick").innerHTML = pickable().map((t) => `<button data-team="${t.id}" class="${wantTeam === t.id ? "on" : ""}" style="--tc:${t.color};--on:${inkOn(t.color)}">${esc(t.icon)} ${esc(t.name)} <span class="muted" style="margin-left:auto;font-size:13px">${t.size}</span></button>`).join("");
  }
  setTimeout(() => $("#nameIn").focus(), 50);
}
function kicked() {
  // Stay connected: if the teacher lets you back in, the game picks up where you left off.
  removed = true; $("#targetModal").classList.add("hidden");
  show("vJoin"); $("#stepCode").classList.add("hidden"); $("#stepName").classList.add("hidden");
  $("#removedBox").classList.remove("hidden");
  $("#joinErr").textContent = "";
}
function leaveRemoved() {
  store.del(sessKey(code)); token = null; me = null; removed = false; if (conn) conn.close(); conn = null;
  $("#removedBox").classList.add("hidden"); $("#stepCode").classList.remove("hidden"); $("#codeIn").value = "";
  history.replaceState(null, "", `${BASE}/`);
}
function unremove() {
  if (!removed) return;
  removed = false; $("#removedBox").classList.add("hidden"); toast("Your teacher let you back in!", "good");
}

// ---------- messages ----------
function onMsg(m) {
  switch (m.t) {
    case "hello":
      RULES = m.rules; S = m.state;
      if (token) conn.send({ t: "join", token });
      else if (EMBED && EMBED_NAME) { const t = pickable()[0]; conn.send({ t: "join", name: EMBED_NAME, team: S.settings.teamPick === "choose" && t ? t.id : null }); }
      else showNameStep();
      break;
    case "joined":
      token = m.token; store.set(sessKey(code), token); joinedOnce = true; $("#joinErr").textContent = "";
      if (EMBED && parent !== window) parent.postMessage({ surgeWatch: true, pid: m.pid, code }, location.origin);
      break;
    case "me": me = m.me; unremove(); render(); break;
    case "readmitted": unremove(); break;
    case "state": S = m.state; if (removed) break; if (me) render(); else if (!token && !EMBED) showNameStep(); break;
    case "q":
      if (!m.q) { curQ = null; queuedQ = null; break; }
      if (removed) break;
      if (locked) queuedQ = m.q; else { curQ = m.q; renderQ(); }
      break;
    case "result":
      if (m.auto) { // autoplay picked for us: show it like a tap
        if (locked || !curQ) break;
        locked = true; lastPick = document.querySelectorAll(".opt")[m.pick] || null;
        if (curQ.type === "text" && $("#typedIn")) $("#typedIn").value = m.correct ? m.answer : "…";
      }
      onResult(m); break;
    case "toast": toast(m.msg, "good"); break;
    case "error":
      if (!me) {
        $("#joinErr").textContent = m.msg;
        if (token && /ended|started|full/.test(m.msg)) { store.del(sessKey(code)); token = null; }
        if (S && !token) showNameStep();
      } else toast(m.msg, "bad");
      break;
    case "kicked": kicked(); break;
  }
}

// ---------- render ----------
function myTeam() { return me && S ? S.teams[me.team] : null; }
function render() {
  if (!S || !me || removed) return;
  const t = myTeam();
  document.body.style.setProperty("--tc", t.color);
  if (S.status === "lobby") { show("vWait"); renderWait(); }
  else if (S.status === "ended") { show("vEnd"); renderEnd(lastStatus !== "ended"); }
  else { show("vGame"); renderGame(); }
  lastStatus = S.status;
}
function renderWait() {
  const t = myTeam();
  const mates = S.players.filter((p) => p.team === t.id);
  $("#waitBox").innerHTML = `
    <div class="big-ic">${esc(t.icon)}</div>
    <div class="display" style="font-size:40px">You're on <span style="color:${t.color}">${esc(t.name)}</span>!</div>
    <p class="muted" style="font-size:18px">Hi ${esc(me.name)}. Waiting for your teacher to start the game…</p>
    <div class="row" style="justify-content:center;margin-top:16px">${mates.map((p) => `<span class="tchip" style="--tc:${t.color}">${esc(p.name)}</span>`).join("")}</div>
    <p class="muted" style="margin-top:26px">${S.teams.length} teams · ${S.players.length} players · ${S.settings.durationMin} minute game</p>`;
}
function hpBar(t) {
  const hp = t.maxHp ? (t.hp / t.maxHp) * 100 : 0, sh = t.maxHp ? Math.min(100, (t.shield / t.maxHp) * 100) : 0;
  return `<div class="hpbar" style="--tc:${t.color}"><div class="hp" style="width:${hp}%"></div><div class="sh" style="width:${sh}%"></div></div>`;
}
function renderGame() {
  const t = myTeam();
  $("#phead").style.setProperty("--tc", t.color);
  $("#myTeam").innerHTML = `<span style="font-size:30px">${esc(t.icon)}</span>${esc(t.name)}`;
  $("#myHpBar").innerHTML = hpBar(t);
  $("#myHpTxt").textContent = t.alive ? `❤️ ${t.hp} / ${t.maxHp}${t.shield ? `  ·  🛡️ ${t.shield}` : ""}  ·  ${t.score.toLocaleString()} pts` : `💀 Fallen · ${t.score.toLocaleString()} pts`;
  const hpNow = t.hp + t.shield;
  if (lastMyHp != null && hpNow < lastMyHp) { flash("#ef4444"); $("#phead").classList.remove("hit"); void $("#phead").offsetWidth; $("#phead").classList.add("hit"); }
  lastMyHp = hpNow;
  $("#energy").textContent = me.energy.toLocaleString();
  $("#fallenBanner").classList.toggle("hidden", t.alive);
  if (!t.alive && !S.settings.fallenCanAttack) $("#fallenBanner").textContent = "💀 Your team has fallen! Keep answering to earn points for your team.";
  $("#pausedBanner").classList.toggle("hidden", S.status !== "paused");
  $("#streakTxt").innerHTML = me.streak > 1 ? `<span class="streak">🔥 ${me.streak} in a row</span>` : `✓ ${me.correct} correct`;
  $("#miniTeams").innerHTML = S.teams.filter((x) => x.active).map((x) => `<div class="mini ${x.alive ? "" : "fallen"}" style="--tc:${x.color};${x.id === t.id ? "outline:2px solid " + x.color : ""}">${esc(x.icon)} ${esc(x.name)} <span class="muted" style="float:right">${x.score.toLocaleString()}</span>${hpBar(x)}</div>`).join("");
  $("#ticker").innerHTML = S.feed.slice(-4).reverse().map((e) => `<div class="ev ${e.kind}">${esc(e.text)}</div>`).join("");
  if (!curQ && !locked) $("#qtext").textContent = S.status === "paused" ? "Paused" : "Loading…";
  buildShop(); updateShop();
}
function flash(color) {
  const f = document.createElement("div"); f.className = "flash"; f.style.background = color; document.body.appendChild(f); setTimeout(() => f.remove(), 520);
}

// ---------- questions ----------
function renderQ() {
  if (!curQ) return;
  $("#qimg").innerHTML = imgTag(curQ.img, "qimg");
  $("#qtext").textContent = curQ.text;
  $("#qtext").classList.toggle("short", !curQ.text);
  $("#fb").textContent = ""; $("#fb").className = "feedback";
  if (curQ.type === "mc") {
    $("#answerArea").innerHTML = `<div class="opts">${curQ.options.map((o, i) => `<button class="opt" data-i="${i}">${imgTag(o.img)}${o.t ? `<span>${esc(o.t)}</span>` : ""}</button>`).join("")}</div>`;
  } else {
    $("#answerArea").innerHTML = `<form class="typed" id="typedForm"><input class="input" id="typedIn" autocomplete="off" placeholder="Type your answer"><button class="btn primary">Submit</button></form>`;
    setTimeout(() => $("#typedIn") && $("#typedIn").focus(), 30);
  }
}
let lastPick = null;
function answer(val, btn) {
  if (locked || !curQ) return;
  if (S.status !== "running") return toast(S.status === "paused" ? "The game is paused" : "Game not running", "bad");
  locked = true; lastPick = btn || null;
  conn.send(curQ.type === "mc" ? { t: "answer", qid: curQ.id, pick: val } : { t: "answer", qid: curQ.id, answer: val });
  setTimeout(() => { if (locked && !$("#fb").textContent) { locked = false; } }, 4000); // safety unlock
}
function onResult(m) {
  const fb = $("#fb");
  if (m.correct) {
    fb.className = "feedback good"; fb.textContent = `Correct! +${m.gained} ⚡`;
    if (lastPick) lastPick.classList.add("right");
  } else {
    fb.className = "feedback bad"; fb.textContent = `Not quite${m.gained < 0 ? ` (${m.gained} ⚡)` : ""}`;
    document.querySelectorAll(".opt").forEach((b, i) => { if (i === m.right) b.classList.add("right"); else if (b === lastPick) b.classList.add("wrong"); });
    if (curQ && curQ.type === "text") fb.innerHTML = `Not quite. Answer: <span style="color:var(--ink)">${esc(m.answer)}</span>${imgTag(m.answerImg, "answer-img")}`;
  }
  setTimeout(() => {
    locked = false;
    if (queuedQ) { curQ = queuedQ; queuedQ = null; renderQ(); }
  }, m.correct ? 650 : 1700);
}

// ---------- shop ----------
function buildShop() {
  if (shopBuilt || !RULES) return; shopBuilt = true;
  $("#powers").innerHTML = Object.entries(RULES.powers).map(([k, p]) => `
    <button class="item" data-power="${k}">
      <div class="it-top"><span class="it-ic">${p.icon}</span>${p.name}</div>
      <div class="it-d">${p.desc}</div>
      <div class="it-amt" data-amt="${k}"></div>
      <div class="it-cost">⚡ ${p.cost}</div>
    </button>`).join("");
  $("#upgrades").innerHTML = Object.entries(RULES.upgrades).map(([k, u]) => `
    <button class="item" data-upg="${k}">
      <div class="it-top">${k === "gain" ? "💰" : "🔥"} ${u.name}</div>
      <div class="it-d">${u.desc}</div>
      <div class="lvl" data-lvl="${k}"></div>
      <div class="it-amt" data-uamt="${k}"></div>
      <div class="it-cost" data-ucost="${k}"></div>
    </button>`).join("");
}
function powerAmt(k) {
  const tm = timing(S, conn.offset);
  return Math.round(RULES.powers[k].base * S.settings.powerScale * tm.surge);
}
function updateShop() {
  if (!shopBuilt || !me) return;
  const t = myTeam(), running = S.status === "running";
  for (const [k, p] of Object.entries(RULES.powers)) {
    const el = document.querySelector(`[data-power="${k}"]`);
    const self = p.target === "self";
    const blocked = (!t.alive && self) || (!t.alive && !S.settings.fallenCanAttack);
    el.disabled = !running || me.energy < p.cost || blocked;
    const a = powerAmt(k);
    document.querySelector(`[data-amt="${k}"]`).textContent = blocked ? (self ? "Not available while fallen" : "Fallen teams can't attack") :
      k === "mend" ? `Heals ${a}` : k === "shield" ? `+${a} shield` : k === "barrage" ? `${a} damage to each team` : k === "siphon" ? `${a} damage + heal ${a}` : `${a} damage`;
  }
  for (const [k, u] of Object.entries(RULES.upgrades)) {
    const lvl = me.upg[k], max = u.levels.length - 1, el = document.querySelector(`[data-upg="${k}"]`);
    document.querySelector(`[data-lvl="${k}"]`).innerHTML = u.levels.map((_, i) => `<i class="${i <= lvl ? "on" : ""}"></i>`).join("");
    const now = u.levels[lvl], next = u.levels[lvl + 1];
    document.querySelector(`[data-uamt="${k}"]`).textContent = k === "gain" ? `${now} ⚡ per answer${next != null ? ` → ${next}` : ""}` : `+${now} per streak step${next != null ? ` → +${next}` : ""}`;
    document.querySelector(`[data-ucost="${k}"]`).textContent = lvl >= max ? "MAXED" : `⚡ ${u.costs[lvl + 1]}`;
    el.disabled = !running || lvl >= max || me.energy < u.costs[lvl + 1];
  }
}
let pendingPower = null;
function usePower(k) {
  const p = RULES.powers[k];
  if (p.target === "enemy") {
    pendingPower = k; openTargets();
  } else conn.send({ t: "power", key: k });
}
function openTargets() {
  const p = RULES.powers[pendingPower];
  const ts = S.teams.filter((t) => t.active && t.alive && t.id !== me.team);
  $("#tmTitle").textContent = `${p.icon} ${p.name}: ${powerAmt(pendingPower)} damage. Pick a team.`;
  $("#tmTargets").innerHTML = ts.length ? ts.map((t) => `<button class="target" data-target="${t.id}" style="--tc:${t.color}"><div class="tt">${esc(t.icon)} ${esc(t.name)}<span class="muted" style="margin-left:auto;font-size:13px">${t.score.toLocaleString()} pts</span></div>${hpBar(t)}<div class="muted" style="font-size:13px">❤️ ${t.hp}${t.shield ? ` · 🛡️ ${t.shield}` : ""}</div></button>`).join("") : `<p class="muted">No teams left to target.</p>`;
  $("#targetModal").classList.remove("hidden");
}

// ---------- end ----------
function renderEnd(fresh) {
  const R = S.results; if (!R) return;
  $("#podium").innerHTML = podiumHTML(R);
  const mine = R.ranked.find((r) => r.id === me.team);
  $("#myStats").innerHTML = `<div class="display" style="font-size:26px">${esc(myTeam().icon)} ${esc(myTeam().name)} finished #${mine ? mine.rank : "–"}</div>
    <div class="row" style="justify-content:center;margin-top:10px;gap:22px;font-weight:600">
      <span>✓ ${me.correct} correct</span><span>🔥 best streak ${me.best}</span><span>💥 ${me.dmg} damage</span><span>⭐ ${me.points} pts</span></div>`;
  $("#rankList").innerHTML = R.ranked.map((t) => `<div class="rank-row" style="--tc:${t.color}${t.id === me.team ? ";outline:2px solid " + t.color : ""}"><span class="r">${t.rank}</span><span style="font-size:22px">${esc(t.icon)}</span><b>${esc(t.name)}</b><span class="s">${t.score.toLocaleString()} pts</span></div>`).join("");
  if (fresh && mine && mine.rank <= 3) setTimeout(confetti, 1200);
}

// ---------- events ----------
$("#codeBtn").onclick = () => tryCode($("#codeIn").value);
$("#codeIn").onkeydown = (e) => { if (e.key === "Enter") tryCode($("#codeIn").value); };
$("#nameBtn").onclick = sendJoin;
$("#nameIn").onkeydown = (e) => { if (e.key === "Enter") sendJoin(); };
document.addEventListener("click", (e) => {
  const tp = e.target.closest("[data-team]"); if (tp) { wantTeam = +tp.dataset.team; showNameStep(); return; }
  const o = e.target.closest(".opt"); if (o) { answer(+o.dataset.i, o); return; }
  if (e.target.id === "leaveRemoved") { leaveRemoved(); return; }
  const tb = e.target.closest("[data-tab]"); if (tb) {
    tab = tb.dataset.tab; document.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", b === tb));
    $("#tabQ").classList.toggle("hidden", tab !== "q"); $("#tabShop").classList.toggle("hidden", tab !== "shop"); return;
  }
  const pw = e.target.closest("[data-power]"); if (pw && !pw.disabled) { usePower(pw.dataset.power); return; }
  const up = e.target.closest("[data-upg]"); if (up && !up.disabled) { conn.send({ t: "upgrade", key: up.dataset.upg }); return; }
  const tg = e.target.closest("[data-target]"); if (tg) { conn.send({ t: "power", key: pendingPower, target: +tg.dataset.target }); $("#targetModal").classList.add("hidden"); return; }
  if (e.target.id === "tmClose" || e.target.id === "targetModal") $("#targetModal").classList.add("hidden");
});
document.addEventListener("submit", (e) => { if (e.target.id === "typedForm") { e.preventDefault(); const v = $("#typedIn").value.trim(); if (v) answer(v); } });
document.addEventListener("keydown", (e) => {
  if (tab !== "q" || !curQ || curQ.type !== "mc" || document.activeElement.tagName === "INPUT") return;
  const n = parseInt(e.key, 10); if (n >= 1 && n <= curQ.options.length) { const b = document.querySelectorAll(".opt")[n - 1]; answer(n - 1, b); }
});

setInterval(() => {
  if (!S || !me || !conn || (S.status !== "running" && S.status !== "paused")) return;
  const tm = timing(S, conn.offset);
  $("#ptimer").textContent = fmtTime(tm.remaining);
  $("#ptimer").style.color = tm.remaining < 30000 ? "var(--bad)" : "";
  $("#surgeX").textContent = "×" + tm.surge.toFixed(1);
  $("#surgeX").style.setProperty("--glow", Math.min(1, (tm.surge - 1) / Math.max(1, S.settings.surgeMax - 1)));
  updateShop();
}, 500);

// ---------- boot ----------
const qp = new URLSearchParams(location.search).get("code");
if (qp) { $("#codeIn").value = qp; tryCode(qp); }
