// Surge Showdown — Cloudflare Worker + Durable Object game server
import { DurableObject } from "cloudflare:workers";

// ---------- Game rules (sent to clients so there is one source of truth) ----------
const RULES = {
  upgrades: {
    gain: {
      name: "Energy per Question",
      desc: "Earn more energy for every correct answer.",
      levels: [10, 20, 35, 60, 100, 160],
      costs: [0, 60, 180, 450, 1100, 2600],
    },
    streak: {
      name: "Streak Bonus",
      desc: "Bonus energy for each answer in a row you get right (up to 10).",
      levels: [0, 2, 5, 9, 15],
      costs: [0, 80, 240, 600, 1400],
    },
  },
  powers: {
    strike:  { name: "Strike",  icon: "⚔️", cost: 40,  base: 30, target: "enemy", desc: "Hit one team." },
    siphon:  { name: "Siphon",  icon: "🌀", cost: 90,  base: 25, target: "enemy", desc: "Hit one team and heal yours by the same amount." },
    barrage: { name: "Barrage", icon: "☄️", cost: 150, base: 18, target: "all",   desc: "Hit every other team still standing." },
    mend:    { name: "Mend",    icon: "💚", cost: 60,  base: 45, target: "self",  desc: "Heal your team." },
    shield:  { name: "Shield",  icon: "🛡️", cost: 70,  base: 50, target: "self",  desc: "Add a shield that absorbs damage." },
  },
};

const DEFAULT_SETTINGS = {
  title: "Surge Showdown",
  theme: "elements",
  teamCount: 4,
  teams: [["Fire","🔥","#ef4444"],["Water","💧","#3b82f6"],["Earth","🪨","#b7791f"],["Air","🌪️","#e2e8f0"],["Lightning","⚡","#facc15"],["Ice","❄️","#67e8f9"],["Nature","🌿","#22c55e"],["Metal","⚙️","#f97316"],["Light","✨","#f472b6"],["Shadow","🌑","#8b5cf6"]].map(([name, icon, color]) => ({ name, icon, color })),
  durationMin: 10,
  hpAmount: 300,
  hpMode: "perPlayer", // perPlayer | flat
  surgeMax: 5,
  surgeCurve: 4, // steepness of the exponential curve
  powerScale: 1,
  energyScale: 1,
  fallenCanAttack: true,
  lastTeamEnds: false,
  teamPick: "auto", // auto | choose
  lateJoin: true,
  wrongPenalty: 5,
  ptsCorrect: 10,
  ptsDamage: 1,
  survivalBonus: 300,
  koBonus: 200,
  feedNames: true,
};

const BAD = ["fuck","shit","bitch","ass","dick","cock","pussy","nigg","fag","cunt","slut","whore","penis","vagina","sex","porn","rape","nazi","hitler","kkk","damn","hell"];
const cleanName = (s) => {
  let n = String(s || "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 18);
  const flat = n.toLowerCase().replace(/[^a-z]/g, "");
  if (!n || BAD.some((b) => flat.includes(b))) return "";
  return n;
};
const rid = (n = 16) => {
  const a = new Uint8Array(n); crypto.getRandomValues(a);
  return Array.from(a, (b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
};
const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, d, lo, hi) => { const x = Number(v); return Number.isFinite(x) ? clamp(x, lo, hi) : d; };
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9.\-/ ]/g, "").replace(/\s+/g, " ").trim();
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });

function sanitizeSettings(input, prev = DEFAULT_SETTINGS) {
  const s = { ...prev };
  const i = input || {};
  s.title = String(i.title ?? s.title).slice(0, 40) || "Surge Showdown";
  s.theme = String(i.theme ?? s.theme).slice(0, 20);
  s.teamCount = Math.round(num(i.teamCount, s.teamCount, 2, 10));
  if (Array.isArray(i.teams) && i.teams.length) {
    s.teams = i.teams.slice(0, 10).map((t, k) => ({
      name: String(t?.name || `Team ${k + 1}`).replace(/[<>]/g, "").slice(0, 20),
      icon: String(t?.icon || "⭐").slice(0, 4),
      color: /^#[0-9a-f]{6}$/i.test(t?.color) ? t.color : "#888888",
    }));
  }
  while (s.teams.length < 10) s.teams.push({ name: `Team ${s.teams.length + 1}`, icon: "⭐", color: "#888888" });
  s.durationMin = num(i.durationMin, s.durationMin, 1, 90);
  s.hpAmount = Math.round(num(i.hpAmount, s.hpAmount, 50, 100000));
  s.hpMode = i.hpMode === "flat" ? "flat" : i.hpMode === "perPlayer" ? "perPlayer" : s.hpMode;
  s.surgeMax = num(i.surgeMax, s.surgeMax, 1, 20);
  s.surgeCurve = num(i.surgeCurve, s.surgeCurve, 0.5, 10);
  s.powerScale = num(i.powerScale, s.powerScale, 0.25, 5);
  s.energyScale = num(i.energyScale, s.energyScale, 0.25, 5);
  for (const k of ["fallenCanAttack", "lastTeamEnds", "lateJoin", "feedNames"]) if (typeof i[k] === "boolean") s[k] = i[k];
  s.teamPick = i.teamPick === "choose" ? "choose" : i.teamPick === "auto" ? "auto" : s.teamPick;
  s.wrongPenalty = Math.round(num(i.wrongPenalty, s.wrongPenalty, 0, 1000));
  s.ptsCorrect = Math.round(num(i.ptsCorrect, s.ptsCorrect, 0, 1000));
  s.ptsDamage = num(i.ptsDamage, s.ptsDamage, 0, 100);
  s.survivalBonus = Math.round(num(i.survivalBonus, s.survivalBonus, 0, 100000));
  s.koBonus = Math.round(num(i.koBonus, s.koBonus, 0, 100000));
  return s;
}

function sanitizeQuestions(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const q of list.slice(0, 500)) {
    const text = String(q?.q || "").slice(0, 400).trim();
    const correct = String(q?.correct || "").slice(0, 200).trim();
    const wrong = (Array.isArray(q?.wrong) ? q.wrong : []).map((w) => String(w).slice(0, 200).trim()).filter(Boolean).slice(0, 5);
    if (!text || !correct) continue;
    out.push({ q: text, correct, wrong, type: wrong.length ? "mc" : "text" });
  }
  return out;
}

// ---------- Worker entry ----------
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/surge") return Response.redirect(url.origin + "/surge/", 302);
    const path = url.pathname.replace(/^\/surge(?=\/(api|ws)\/)/, "");
    if (path === "/api/create" && request.method === "POST") {
      let body = {};
      try { body = await request.json(); } catch {}
      const questions = sanitizeQuestions(body.questions);
      if (questions.length < 1) return json({ error: "Add at least one question." }, 400);
      for (let tries = 0; tries < 8; tries++) {
        const code = String(Math.floor(100000 + Math.random() * 900000));
        const stub = env.GAME.get(env.GAME.idFromName(code));
        const r = await stub.fetch("https://do/init", {
          method: "POST",
          body: JSON.stringify({ code, settings: body.settings, questions }),
        });
        if (r.status === 200) return json(await r.json());
      }
      return json({ error: "Could not create a game. Try again." }, 500);
    }
    const m = path.match(/^\/ws\/(\d{6})$/);
    if (m) {
      if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected websocket", { status: 426 });
      const stub = env.GAME.get(env.GAME.idFromName(m[1]));
      return stub.fetch(request);
    }
    if (path === "/api/rules") return json(RULES);
    const c = path.match(/^\/api\/exists\/(\d{6})$/);
    if (c) {
      const stub = env.GAME.get(env.GAME.idFromName(c[1]));
      return stub.fetch("https://do/exists");
    }
    return env.ASSETS.fetch(request);
  },
};

// ---------- Game room ----------
export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.s = null;
    this.saveTimer = null;
    this.bcastTimer = null;
    ctx.blockConcurrencyWhile(async () => {
      this.s = (await ctx.storage.get("s")) || null;
    });
  }

  // ----- persistence & broadcast -----
  save() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(async () => {
      this.saveTimer = null;
      if (this.s) await this.ctx.storage.put("s", this.s);
    }, 400);
  }
  async saveNow() {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    if (this.s) await this.ctx.storage.put("s", this.s);
  }
  send(ws, msg) {
    try { ws.send(JSON.stringify(msg)); } catch {}
  }
  sendToPlayer(pid, msg) {
    for (const ws of this.sockets("p:" + pid)) this.send(ws, msg);
  }
  broadcast() {
    this.save();
    if (this.bcastTimer) return;
    this.bcastTimer = setTimeout(() => {
      this.bcastTimer = null;
      const pub = JSON.stringify({ t: "state", state: this.publicState(false) });
      const host = JSON.stringify({ t: "state", state: this.publicState(true) });
      for (const ws of this.ctx.getWebSockets()) {
        const tags = this.ctx.getTags(ws);
        try { ws.send(tags.includes("host") ? host : pub); } catch {}
      }
    }, 150);
  }

  // ----- timing -----
  elapsedMs(now = Date.now()) {
    const s = this.s;
    return s.elapsedBase + (s.runStartedAt ? now - s.runStartedAt : 0);
  }
  remainingMs(now = Date.now()) {
    return Math.max(0, this.s.totalMs - this.elapsedMs(now));
  }
  surge(now = Date.now()) {
    const s = this.s;
    if (s.status === "lobby") return 1;
    const p = clamp(this.elapsedMs(now) / s.totalMs, 0, 1);
    const k = s.settings.surgeCurve, M = s.settings.surgeMax;
    return 1 + (M - 1) * (Math.exp(k * p) - 1) / (Math.exp(k) - 1);
  }
  async scheduleAlarm() {
    const s = this.s;
    if (s.status === "running") await this.ctx.storage.setAlarm(Date.now() + this.remainingMs() + 50);
    else await this.ctx.storage.setAlarm(Date.now() + 12 * 3600 * 1000); // cleanup
  }
  async alarm() {
    if (!this.s) return;
    if (this.s.status === "running") {
      if (this.remainingMs() <= 0) { this.endGame("time"); await this.saveNow(); await this.scheduleAlarm(); }
      else await this.scheduleAlarm();
      return;
    }
    // cleanup old game
    for (const ws of this.ctx.getWebSockets()) { try { ws.close(1000, "Game expired"); } catch {} }
    this.s = null;
    await this.ctx.storage.deleteAll();
  }

  // ----- HTTP -----
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/rules") return json(RULES);
    if (url.pathname === "/exists") return json({ exists: !!this.s, status: this.s?.status, teamPick: this.s?.settings.teamPick });
    if (url.pathname === "/init") {
      if (this.s) return json({ error: "exists" }, 409);
      const body = await request.json();
      this.s = {
        code: body.code,
        hostKey: rid(24),
        status: "lobby",
        settings: sanitizeSettings(body.settings),
        questions: sanitizeQuestions(body.questions),
        teams: [],
        players: {},
        feed: [],
        totalMs: 0, elapsedBase: 0, runStartedAt: null,
        endReason: null, results: null,
        createdAt: Date.now(),
      };
      this.buildTeams();
      await this.saveNow();
      await this.scheduleAlarm();
      return json({ code: this.s.code, hostKey: this.s.hostKey });
    }
    // websocket
    if (!this.s) return new Response("Game not found", { status: 404 });
    const role = url.searchParams.get("role");
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    if (role === "host") {
      if (url.searchParams.get("key") !== this.s.hostKey) return new Response("Bad host key", { status: 403 });
      this.ctx.acceptWebSocket(server, ["host"]);
      server.serializeAttachment({ role: "host" });
      this.send(server, { t: "hello", role: "host", rules: RULES, state: this.publicState(true), questions: this.s.questions });
    } else {
      this.ctx.acceptWebSocket(server, ["anon"]);
      server.serializeAttachment({ role: "anon" });
      this.send(server, { t: "hello", role: "anon", rules: RULES, state: this.publicState(false) });
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketClose(ws) {
    const a = ws.deserializeAttachment() || {};
    if (a.pid && this.s?.players[a.pid]) {
      const still = this.sockets("p:" + a.pid).filter((w) => w !== ws && w.readyState === 1);
      if (!still.length) { this.s.players[a.pid].online = false; this.broadcast(); }
    }
  }
  async webSocketError(ws) { return this.webSocketClose(ws); }

  async webSocketMessage(ws, raw) {
    if (!this.s) return;
    let m; try { m = JSON.parse(raw); } catch { return; }
    const a = ws.deserializeAttachment() || {};
    if (m.t === "ping") return this.send(ws, { t: "pong", now: Date.now() });
    if (a.role === "host") return this.onHost(ws, m);
    if (a.role === "anon" && m.t === "join") return this.onJoin(ws, m);
    if (a.role === "player") return this.onPlayer(ws, a.pid, m);
  }

  // ----- teams -----
  buildTeams() {
    const s = this.s;
    s.teams = [];
    for (let i = 0; i < s.settings.teamCount; i++) {
      const t = s.settings.teams[i];
      s.teams.push({ id: i, name: t.name, icon: t.icon, color: t.color, hp: 0, maxHp: 0, shield: 0, alive: true, active: true, bonus: 0, kos: 0, fellAt: null, rank: null });
    }
    for (const p of Object.values(s.players)) if (p.team >= s.teams.length) p.team = this.smallestTeam();
  }
  teamSize(id) { return Object.values(this.s.players).filter((p) => p.team === id && !p.kicked).length; }
  smallestTeam(onlyAlive = false) {
    let best = 0, bestN = Infinity;
    const order = shuffle(this.s.teams.map((t) => t.id));
    for (const id of order) {
      const t = this.s.teams[id];
      if (onlyAlive && (!t.alive || !t.active)) continue;
      const n = this.teamSize(id);
      if (n < bestN) { best = id; bestN = n; }
    }
    return best;
  }
  teamScore(t) {
    let sc = t.bonus;
    for (const p of Object.values(this.s.players)) if (p.team === t.id && !p.kicked) sc += p.points;
    return Math.round(sc);
  }

  // ----- public state -----
  publicState(isHost) {
    const s = this.s, now = Date.now();
    const players = Object.values(s.players).filter((p) => !p.kicked).map((p) => ({
      id: p.id, name: p.name, team: p.team, online: p.online,
      points: Math.round(p.points), correct: p.correct, dmg: Math.round(p.dmg),
      ...(isHost ? { wrong: p.wrong, energy: Math.floor(p.energy) } : {}),
    }));
    return {
      code: s.code, status: s.status, settings: { ...s.settings }, qCount: s.questions.length,
      teams: s.teams.map((t) => ({ ...t, hp: Math.round(t.hp), shield: Math.round(t.shield), score: this.teamScore(t), size: this.teamSize(t.id) })),
      players, feed: s.feed.slice(-25),
      totalMs: s.totalMs, elapsedBase: s.elapsedBase, runStartedAt: s.runStartedAt, serverNow: now,
      surge: this.surge(now), endReason: s.endReason, results: s.results,
    };
  }

  // ----- host -----
  async onHost(ws, m) {
    const s = this.s;
    switch (m.t) {
      case "settings":
        if (s.status !== "lobby") return;
        s.settings = sanitizeSettings(m.settings, s.settings);
        this.buildTeams();
        break;
      case "questions": {
        const q = sanitizeQuestions(m.questions);
        if (q.length) { s.questions = q; for (const p of Object.values(s.players)) { p.order = []; } }
        this.send(ws, { t: "questions", questions: s.questions });
        break;
      }
      case "start": {
        if (s.status !== "lobby") return;
        const counts = s.teams.map((t) => this.teamSize(t.id));
        if (counts.reduce((x, y) => x + y, 0) < 1) return this.send(ws, { t: "error", msg: "No players have joined yet." });
        for (const t of s.teams) {
          t.active = counts[t.id] > 0;
          t.maxHp = s.settings.hpMode === "flat" ? s.settings.hpAmount : s.settings.hpAmount * Math.max(1, counts[t.id]);
          t.hp = t.maxHp; t.shield = 0; t.alive = t.active; t.bonus = 0; t.kos = 0; t.fellAt = null;
        }
        s.totalMs = Math.round(s.settings.durationMin * 60000);
        s.elapsedBase = 0; s.runStartedAt = Date.now(); s.status = "running";
        s.feed = []; this.feed("🚀 The battle has begun!", "sys");
        for (const p of Object.values(s.players)) this.nextQuestion(p);
        await this.scheduleAlarm();
        break;
      }
      case "pause":
        if (s.status !== "running") return;
        s.elapsedBase = this.elapsedMs(); s.runStartedAt = null; s.status = "paused";
        this.feed("⏸️ Game paused by the teacher", "sys");
        await this.scheduleAlarm();
        break;
      case "resume":
        if (s.status !== "paused") return;
        s.runStartedAt = Date.now(); s.status = "running";
        this.feed("▶️ Game resumed", "sys");
        await this.scheduleAlarm();
        break;
      case "addTime": {
        if (s.status !== "running" && s.status !== "paused") return;
        const sec = clamp(Number(m.sec) || 0, -3600, 3600);
        s.totalMs = Math.max(this.elapsedMs() + 5000, s.totalMs + sec * 1000);
        this.feed(sec >= 0 ? `⏱️ ${Math.round(sec / 60 * 10) / 10} min added to the clock` : `⏱️ ${Math.round(-sec / 60 * 10) / 10} min removed from the clock`, "sys");
        await this.scheduleAlarm();
        break;
      }
      case "end":
        if (s.status !== "running" && s.status !== "paused") return;
        this.endGame("host");
        await this.scheduleAlarm();
        break;
      case "kick": {
        const p = s.players[m.pid]; if (!p) return;
        p.kicked = true;
        this.sendToPlayer(p.id, { t: "kicked" });
        for (const w of this.sockets("p:" + p.id)) { try { w.close(4000, "Removed by teacher"); } catch {} }
        this.recalcPerPlayerHp(p.team, -1);
        break;
      }
      case "shuffle": {
        if (s.status !== "lobby") return;
        const ps = shuffle(Object.values(s.players).filter((p) => !p.kicked));
        ps.forEach((p, i) => { p.team = i % s.teams.length; this.sendMe(p); });
        break;
      }
      case "move": {
        const p = s.players[m.pid]; const to = Number(m.team);
        if (!p || !s.teams[to] || p.team === to) return;
        if (s.status !== "lobby" && (!s.teams[to].active)) return;
        const from = p.team; p.team = to;
        this.recalcPerPlayerHp(from, -1); this.recalcPerPlayerHp(to, +1);
        this.sendMe(p);
        break;
      }
      case "rematch": {
        if (s.status !== "ended") return;
        s.status = "lobby"; s.results = null; s.endReason = null; s.feed = [];
        s.totalMs = 0; s.elapsedBase = 0; s.runStartedAt = null;
        for (const [id, p] of Object.entries(s.players)) {
          if (p.kicked) { delete s.players[id]; continue; }
          Object.assign(p, this.freshStats());
          this.sendMe(p);
          this.sendToPlayer(p.id, { t: "q", q: null });
        }
        this.buildTeams();
        await this.scheduleAlarm();
        break;
      }
      default: return;
    }
    this.broadcast();
  }

  recalcPerPlayerHp(teamId, delta) {
    const s = this.s, t = s.teams[teamId];
    if (!t || s.status === "lobby" || s.status === "ended" || s.settings.hpMode !== "perPlayer" || !t.alive) return;
    if (delta > 0) { t.maxHp += s.settings.hpAmount; t.hp += s.settings.hpAmount; }
    else if (this.teamSize(teamId) > 0) { t.maxHp = Math.max(s.settings.hpAmount, t.maxHp - s.settings.hpAmount); t.hp = Math.min(t.hp, t.maxHp); }
  }

  freshStats() {
    return { energy: 0, points: 0, correct: 0, wrong: 0, streak: 0, best: 0, dmg: 0, heal: 0, upg: { gain: 0, streak: 0 }, order: [], cur: null, lastAns: 0, lastPow: 0 };
  }

  // ----- players -----
  onJoin(ws, m) {
    const s = this.s;
    let p = m.token ? Object.values(s.players).find((x) => x.token === m.token) : null;
    if (p?.kicked) { this.send(ws, { t: "kicked" }); return; }
    if (!p) {
      if (s.status === "ended") return this.send(ws, { t: "error", msg: "This game has ended." });
      if (s.status !== "lobby" && !s.settings.lateJoin) return this.send(ws, { t: "error", msg: "This game has already started." });
      if (Object.keys(s.players).length >= 200) return this.send(ws, { t: "error", msg: "This game is full." });
      let name = cleanName(m.name);
      if (!name) return this.send(ws, { t: "error", msg: "Please choose a different name." });
      const taken = new Set(Object.values(s.players).map((x) => x.name.toLowerCase()));
      let base = name, k = 2; while (taken.has(name.toLowerCase())) name = `${base.slice(0, 15)} ${k++}`;
      let team;
      const want = Number(m.team);
      if (s.status === "lobby") team = s.settings.teamPick === "choose" && s.teams[want] ? want : this.smallestTeam();
      else team = s.settings.teamPick === "choose" && s.teams[want]?.active && s.teams[want]?.alive ? want : this.smallestTeam(true);
      p = { id: rid(8), token: rid(20), name, team, online: true, kicked: false, joinedAt: Date.now(), ...this.freshStats() };
      s.players[p.id] = p;
      if (s.status !== "lobby") {
        this.recalcPerPlayerHp(team, +1);
        if (!s.teams[team].active) { s.teams[team].active = true; }
      }
    }
    p.online = true;
    ws.serializeAttachment({ role: "player", pid: p.id });
    this.send(ws, { t: "joined", pid: p.id, token: p.token });
    this.sendMe(p, ws);
    if ((s.status === "running" || s.status === "paused")) {
      if (p.cur == null) this.nextQuestion(p);
      else this.sendQuestion(p, ws);
    }
    this.broadcast();
  }

  // tags are immutable after accept, so find a player's sockets by attachment
  sockets(role) {
    if (role && role.startsWith("p:")) {
      const pid = role.slice(2);
      return this.ctx.getWebSockets().filter((w) => { const a = w.deserializeAttachment(); return a && a.pid === pid; });
    }
    return this.ctx.getWebSockets(role);
  }

  meMsg(p) {
    const s = this.s;
    return { t: "me", me: { id: p.id, name: p.name, team: p.team, energy: Math.floor(p.energy), points: Math.round(p.points), correct: p.correct, wrong: p.wrong, streak: p.streak, best: p.best, dmg: Math.round(p.dmg), heal: Math.round(p.heal), upg: p.upg } };
  }
  sendMe(p, ws) {
    const msg = this.meMsg(p);
    if (ws) this.send(ws, msg); else this.sendToPlayer(p.id, msg);
  }

  nextQuestion(p) {
    const s = this.s;
    if (!p.order || !p.order.length) {
      let order = shuffle(s.questions.map((_, i) => i));
      if (order.length > 1 && order[0] === p.cur) order.push(order.shift());
      p.order = order;
    }
    p.cur = p.order.shift();
    this.sendQuestion(p);
  }
  sendQuestion(p, ws) {
    const q = this.s.questions[p.cur];
    if (!q) return;
    const msg = { t: "q", q: { id: p.cur, text: q.q, type: q.type, options: q.type === "mc" ? shuffle([q.correct, ...q.wrong]) : null } };
    if (ws) this.send(ws, msg); else this.sendToPlayer(p.id, msg);
  }

  onPlayer(ws, pid, m) {
    const s = this.s, p = s.players[pid];
    if (!p || p.kicked) return;
    const now = Date.now();
    if (m.t === "answer") {
      if (s.status !== "running") return this.send(ws, { t: "error", msg: s.status === "paused" ? "Game is paused." : "Game is not running." });
      if (now - p.lastAns < 350 || Number(m.qid) !== p.cur) return;
      p.lastAns = now;
      const q = s.questions[p.cur];
      const ok = q.type === "mc" ? String(m.answer) === q.correct : norm(m.answer) === norm(q.correct) && norm(m.answer) !== "";
      let gained = 0;
      if (ok) {
        p.streak++; p.best = Math.max(p.best, p.streak); p.correct++;
        const U = RULES.upgrades;
        gained = (U.gain.levels[p.upg.gain] + U.streak.levels[p.upg.streak] * Math.min(p.streak - 1, 10)) * s.settings.energyScale;
        gained = Math.round(gained);
        p.energy += gained; p.points += s.settings.ptsCorrect;
      } else {
        p.streak = 0; p.wrong++;
        gained = -Math.min(Math.floor(p.energy), s.settings.wrongPenalty);
        p.energy += gained;
      }
      this.send(ws, { t: "result", correct: ok, gained, answer: q.correct, streak: p.streak });
      this.sendMe(p);
      this.nextQuestion(p);
      this.broadcast();
      return;
    }
    if (m.t === "upgrade") {
      if (s.status !== "running") return this.send(ws, { t: "error", msg: "You can shop once the game is running." });
      const U = RULES.upgrades[m.key]; if (!U) return;
      const lvl = p.upg[m.key];
      if (lvl >= U.levels.length - 1) return;
      const cost = U.costs[lvl + 1];
      if (p.energy < cost) return this.send(ws, { t: "error", msg: "Not enough energy." });
      p.energy -= cost; p.upg[m.key] = lvl + 1;
      this.send(ws, { t: "toast", msg: `${U.name} upgraded to level ${lvl + 2}!` });
      this.sendMe(p);
      this.broadcast();
      return;
    }
    if (m.t === "power") {
      if (s.status !== "running") return this.send(ws, { t: "error", msg: s.status === "paused" ? "Game is paused." : "Game is not running." });
      if (now - p.lastPow < 300) return;
      const P = RULES.powers[m.key]; if (!P) return;
      const mine = s.teams[p.team];
      if (p.energy < P.cost) return this.send(ws, { t: "error", msg: "Not enough energy." });
      if (!mine.alive && P.target === "self") return this.send(ws, { t: "error", msg: "Your team has fallen — you can't heal or shield, but you can still attack!" });
      if (!mine.alive && !s.settings.fallenCanAttack) return this.send(ws, { t: "error", msg: "Your team has fallen." });
      const amt = P.base * s.settings.powerScale * this.surge(now);
      const tag = s.settings.feedNames ? `${p.name} (${mine.icon} ${mine.name})` : `${mine.icon} ${mine.name}`;
      let msg = "";
      if (P.target === "enemy") {
        const t = s.teams[Number(m.target)];
        if (!t || t.id === mine.id || !t.alive || !t.active) return this.send(ws, { t: "error", msg: "Pick a team that is still standing." });
        p.energy -= P.cost; p.lastPow = now;
        const dealt = this.damage(t, amt, p);
        if (m.key === "siphon" && mine.alive) { const h = this.heal(mine, dealt); p.heal += h; }
        msg = `${P.icon} ${tag} used ${P.name} on ${t.icon} ${t.name} for ${Math.round(dealt)}`;
      } else if (P.target === "all") {
        const targets = s.teams.filter((t) => t.alive && t.active && t.id !== mine.id);
        if (!targets.length) return this.send(ws, { t: "error", msg: "No teams left to hit." });
        p.energy -= P.cost; p.lastPow = now;
        let total = 0; for (const t of targets) total += this.damage(t, amt, p, true);
        msg = `${P.icon} ${tag} launched a Barrage hitting ${targets.length} teams for ${Math.round(amt)} each`;
      } else {
        p.energy -= P.cost; p.lastPow = now;
        if (m.key === "mend") { const h = this.heal(mine, amt); p.heal += h; msg = `${P.icon} ${tag} healed their team for ${Math.round(h)}`; }
        if (m.key === "shield") { const cap = mine.maxHp * 0.5; const before = mine.shield; mine.shield = Math.min(cap, mine.shield + amt); msg = `${P.icon} ${tag} raised a shield (+${Math.round(mine.shield - before)})`; }
      }
      this.feed(msg, m.key);
      this.flushKOs();
      this.sendMe(p);
      this.checkLastTeam();
      this.broadcast();
      return;
    }
  }

  damage(t, amt, attacker, quietKO) {
    const s = this.s;
    let left = amt;
    const absorbed = Math.min(t.shield, left); t.shield -= absorbed; left -= absorbed;
    const hpHit = Math.min(t.hp, left); t.hp -= hpHit;
    const dealt = absorbed + hpHit;
    attacker.dmg += dealt; attacker.points += dealt * s.settings.ptsDamage;
    if (t.hp <= 0.0001 && t.alive) {
      t.hp = 0; t.shield = 0; t.alive = false; t.fellAt = Date.now();
      const at = s.teams[attacker.team];
      at.bonus += s.settings.koBonus; at.kos++;
      (this.pendingKO ||= []).push(`💀 ${t.icon} ${t.name} has fallen! Final blow: ${s.settings.feedNames ? attacker.name + " of " : ""}${at.icon} ${at.name}`);
    }
    return dealt;
  }
  heal(t, amt) {
    const h = Math.min(amt, t.maxHp - t.hp); t.hp += h; return h;
  }
  flushKOs() {
    if (!this.pendingKO) return;
    for (const m of this.pendingKO) this.feed(m, "ko");
    this.pendingKO = null;
  }
  checkLastTeam() {
    const s = this.s;
    if (s.status !== "running") return;
    const alive = s.teams.filter((t) => t.active && t.alive);
    if (alive.length === 0) this.endGame("allFallen");
    else if (alive.length === 1 && s.settings.lastTeamEnds) this.endGame("lastTeam");
  }
  feed(text, kind) {
    this.s.feed.push({ id: rid(6), text, kind, at: Date.now() });
    if (this.s.feed.length > 60) this.s.feed.splice(0, this.s.feed.length - 60);
  }

  endGame(reason) {
    const s = this.s;
    if (s.status === "ended") return;
    s.elapsedBase = Math.min(s.totalMs, this.elapsedMs()); s.runStartedAt = null;
    s.status = "ended"; s.endReason = reason;
    for (const t of s.teams) if (t.active && t.alive) t.bonus += s.settings.survivalBonus;
    if (reason === "allFallen") { // the last team to fall earns the survival bonus
      const last = s.teams.filter((t) => t.active && t.fellAt).sort((a, b) => b.fellAt - a.fellAt)[0];
      if (last) { last.bonus += s.settings.survivalBonus; last.lastStanding = true; }
    }
    const ranked = s.teams.filter((t) => t.active).map((t) => ({ id: t.id, name: t.name, icon: t.icon, color: t.color, score: this.teamScore(t), alive: t.alive, hp: Math.round(t.hp), kos: t.kos, size: this.teamSize(t.id) }))
      .sort((a, b) => b.score - a.score || b.hp - a.hp);
    ranked.forEach((r, i) => (r.rank = i + 1));
    const ps = Object.values(s.players).filter((p) => !p.kicked);
    const top = (f) => { const p = ps.slice().sort((a, b) => f(b) - f(a))[0]; return p && f(p) > 0 ? { name: p.name, team: p.team, value: Math.round(f(p)) } : null; };
    s.results = {
      ranked,
      awards: {
        mvp: top((p) => p.points),
        damage: top((p) => p.dmg),
        correct: top((p) => p.correct),
        streak: top((p) => p.best),
        healer: top((p) => p.heal),
      },
    };
    const msg = { time: "⏰ Time's up!", host: "🏁 The teacher ended the game.", allFallen: "💀 Every team has fallen!", lastTeam: "👑 Only one team remains!" }[reason] || "Game over";
    this.feed(msg, "sys");
    for (const p of ps) this.sendMe(p);
    this.broadcast();
  }
}
