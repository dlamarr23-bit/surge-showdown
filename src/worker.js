// Surge Showdown — Cloudflare Worker + Durable Object game server
import { DurableObject } from "cloudflare:workers";
import { RULES, DEMO_COUNT, cleanName, rid, shuffle, clamp, norm, json, sanitizeSettings, sanitizeQuestions, questionsForHost } from "./shared.js";
import { route } from "./router.js";

const BOT_NAMES = ["Ava M.", "Liam R.", "Mia T.", "Noah G.", "Sofia L.", "Ethan P.", "Isabella C.", "Mason K.", "Zoe H.", "Lucas B.",
  "Chloe W.", "Elijah D.", "Aria S.", "James F.", "Layla N.", "Daniel V.", "Nora J.", "Mateo A.", "Lily E.", "Henry O.",
  "Camila Q.", "Jack Y.", "Hazel Z.", "Leo U.", "Ellie I.", "Owen X.", "Stella R.", "Gabriel M.", "Ruby T.", "Julian G.",
  "Violet L.", "Wyatt P.", "Aurora C.", "Ezra K.", "Penelope H.", "Kai B.", "Naomi W.", "Diego D.", "Maya S.", "Isaac F."];

// ---------- Worker entry (used when deployed as a Worker; Pages uses functions/) ----------
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/surge") return Response.redirect(url.origin + "/surge/", 302);
    const r = await route(request, env);
    if (r) return r;
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
    this.botTimer = null;
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
    if (this.s?.players[pid]?.bot) return;
    for (const ws of this.sockets("p:" + pid)) this.send(ws, msg);
  }
  broadcast() {
    this.save();
    if (this.bcastTimer) return;
    this.bcastTimer = setTimeout(() => {
      this.bcastTimer = null;
      if (!this.s) return;
      const pub = JSON.stringify({ t: "state", state: this.publicState(false) });
      const host = JSON.stringify({ t: "state", state: this.publicState(true) });
      for (const ws of this.ctx.getWebSockets()) {
        const tags = this.ctx.getTags(ws);
        try { ws.send(tags.includes("host") ? host : pub); } catch {}
      }
    }, 200);
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
    if (s.status === "running") {
      let at = Date.now() + this.remainingMs() + 50;
      if (s.settings.demo) at = Math.min(at, Date.now() + 15000); // keeps pretend students moving
      await this.ctx.storage.setAlarm(at);
    } else await this.ctx.storage.setAlarm(Date.now() + 12 * 3600 * 1000); // cleanup
  }
  async alarm() {
    if (!this.s) return;
    if (this.s.status === "running") {
      if (this.remainingMs() <= 0) { this.endGame("time"); await this.saveNow(); }
      this.ensureBotTimer();
      await this.scheduleAlarm();
      return;
    }
    if (Date.now() - (this.s.touchedAt || this.s.createdAt) < 11 * 3600 * 1000) { await this.scheduleAlarm(); return; }
    // cleanup old game
    this.stopBotTimer();
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
        botsToAdd: 0,
        totalMs: 0, elapsedBase: 0, runStartedAt: null,
        endReason: null, results: null,
        createdAt: Date.now(), touchedAt: Date.now(),
      };
      this.buildTeams();
      if (this.s.settings.demo) this.s.botsToAdd = DEMO_COUNT;
      await this.saveNow();
      await this.scheduleAlarm();
      this.ensureBotTimer();
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
      this.send(server, { t: "hello", role: "host", rules: RULES, state: this.publicState(true), questions: questionsForHost(this.s.questions) });
    } else {
      this.ctx.acceptWebSocket(server, ["anon"]);
      server.serializeAttachment({ role: "anon" });
      this.send(server, { t: "hello", role: "anon", rules: RULES, state: this.publicState(false) });
    }
    this.ensureBotTimer();
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
    this.ensureBotTimer();
    if (m.t === "ping") return this.send(ws, { t: "pong", now: Date.now() });
    this.s.touchedAt = Date.now();
    if (a.role === "host") return this.onHost(ws, m);
    if ((a.role === "anon" || a.role === "player") && m.t === "join") return this.onJoin(ws, m);
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
  // Power-up multiplier that evens out smaller teams: biggest team size / this team size.
  // A team of 3 playing against a team of 4 gets 4/3 = ×1.33 (33% stronger power-ups).
  teamBoost(id) {
    const s = this.s;
    if (!s.settings.sizeBoost) return 1;
    const n = this.teamSize(id);
    if (n <= 0) return 1;
    let big = 0;
    for (const t of s.teams) if (s.status === "lobby" || t.active) big = Math.max(big, this.teamSize(t.id));
    return Math.max(1, big / n);
  }
  smallestTeam(onlyAlive = false) {
    let best = -1, bestN = Infinity;
    const order = shuffle(this.s.teams.map((t) => t.id));
    for (const id of order) {
      const t = this.s.teams[id];
      if (onlyAlive && (!t.alive || !t.active)) continue;
      const n = this.teamSize(id);
      if (n < bestN) { best = id; bestN = n; }
    }
    if (best < 0) return onlyAlive ? this.smallestTeam(false) : 0;
    return best;
  }
  teamScore(t) {
    let sc = t.bonus;
    for (const p of Object.values(this.s.players)) if (p.team === t.id && !p.kicked) sc += p.points;
    return Math.round(sc);
  }
  // Put a player on a team in the middle of a game (late join / re-admit)
  placeLive(p, team) {
    const s = this.s, t = s.teams[team];
    if (s.status === "lobby" || s.status === "ended") return;
    if (!t.active) { // waking up an empty team
      t.active = true; t.alive = true; t.shield = 0; t.fellAt = null;
      t.maxHp = s.settings.hpAmount; t.hp = t.maxHp;
      return;
    }
    this.recalcPerPlayerHp(team, +1);
  }

  // ----- public state -----
  publicState(isHost) {
    const s = this.s, now = Date.now();
    const players = Object.values(s.players).filter((p) => !p.kicked).map((p) => ({
      id: p.id, name: p.name, team: p.team, online: p.online, bot: !!p.bot, watch: !!p.watch,
      points: Math.round(p.points), correct: p.correct, dmg: Math.round(p.dmg),
      ...(isHost ? { wrong: p.wrong, energy: Math.floor(p.energy) } : {}),
    }));
    return {
      code: s.code, status: s.status, settings: { ...s.settings }, qCount: s.questions.length,
      teams: s.teams.map((t) => ({ ...t, hp: Math.round(t.hp), shield: Math.round(t.shield), score: this.teamScore(t), size: this.teamSize(t.id), boost: this.teamBoost(t.id) })),
      players, feed: s.feed.slice(-25),
      ...(isHost ? { removed: Object.values(s.players).filter((p) => p.kicked && !p.bot && !p.watch).map((p) => ({ id: p.id, name: p.name, team: p.team })) } : {}),
      totalMs: s.totalMs, elapsedBase: s.elapsedBase, runStartedAt: s.runStartedAt, serverNow: now,
      surge: this.surge(now), endReason: s.endReason, results: s.results,
    };
  }

  // ----- host -----
  async onHost(ws, m) {
    const s = this.s;
    switch (m.t) {
      case "settings": {
        if (s.status !== "lobby") return;
        const wasDemo = s.settings.demo;
        s.settings = sanitizeSettings(m.settings, s.settings);
        this.buildTeams();
        if (s.settings.demo !== wasDemo) this.setDemo(s.settings.demo);
        break;
      }
      case "questions": {
        const q = sanitizeQuestions(m.questions);
        if (q.length) { s.questions = q; for (const p of Object.values(s.players)) { p.order = []; } }
        this.send(ws, { t: "questions", questions: questionsForHost(s.questions) });
        break;
      }
      case "lateJoin":
        s.settings.lateJoin = !!m.on;
        if (s.status !== "lobby") this.feed(m.on ? "🚪 Joining is open — new players can jump in" : "🔒 Joining is locked", "sys");
        break;
      case "demo":
        if (s.status === "ended") return;
        this.setDemo(!!m.on);
        break;
      case "autopilot": { // demo mode: the teacher's "player view" plays itself
        const p = s.players[m.pid]; if (!p || p.bot || !s.settings.demo) return;
        p.watch = true; p.auto = !!m.on;
        if (p.auto) { p.skill ||= 0.75; p.speed ||= 0.8; p.nextAct = Date.now() + 1500; this.ensureBotTimer(); }
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
        for (const p of Object.values(s.players)) if (!p.kicked) { this.nextQuestion(p); if (p.bot || p.auto) p.nextAct = Date.now() + 1500 + Math.random() * 5000; }
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
        const p = s.players[m.pid]; if (!p || p.kicked) return;
        this.removePlayer(p);
        if (s.status !== "lobby" && s.status !== "ended") this.feed(`👋 ${p.name} left the game`, "sys");
        break;
      }
      case "readmit": {
        const p = s.players[m.pid]; if (!p || !p.kicked) return;
        p.kicked = false;
        if (s.status === "running" || s.status === "paused") {
          const t = s.teams[p.team];
          if (!t || !t.active || !t.alive) p.team = this.smallestTeam(true);
          this.placeLive(p, p.team);
          this.feed(`🚪 ${p.name} is back in the game`, "sys");
        } else if (!s.teams[p.team]) p.team = this.smallestTeam();
        this.sendToPlayer(p.id, { t: "readmitted" });
        this.sendMe(p);
        if (s.status === "running" || s.status === "paused") this.nextQuestion(p);
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
        this.ensureBotTimer();
        break;
      }
      default: return;
    }
    this.broadcast();
  }

  removePlayer(p) {
    const s = this.s;
    p.kicked = true;
    this.sendToPlayer(p.id, { t: "kicked" });
    this.recalcPerPlayerHp(p.team, -1);
    if (p.bot && (s.status === "lobby" || s.status === "ended")) delete s.players[p.id];
  }

  setDemo(on) {
    const s = this.s;
    s.settings.demo = on;
    if (on) {
      const have = Object.values(s.players).filter((p) => p.bot && !p.kicked).length;
      s.botsToAdd = Math.max(0, DEMO_COUNT - have);
      this.ensureBotTimer();
    } else {
      s.botsToAdd = 0;
      for (const p of Object.values(s.players)) if ((p.bot || p.watch) && !p.kicked) { p.auto = false; this.removePlayer(p); }
      if (s.status === "running" || s.status === "paused") this.feed("🎭 Pretend students left the game", "sys");
    }
  }

  recalcPerPlayerHp(teamId, delta) {
    const s = this.s, t = s.teams[teamId];
    if (!t || s.status === "lobby" || s.status === "ended" || s.settings.hpMode !== "perPlayer" || !t.alive) return;
    if (delta > 0) { t.maxHp += s.settings.hpAmount; t.hp += s.settings.hpAmount; }
    else if (this.teamSize(teamId) > 0) { t.maxHp = Math.max(s.settings.hpAmount, t.maxHp - s.settings.hpAmount); t.hp = Math.min(t.hp, t.maxHp); }
  }

  freshStats() {
    return { energy: 0, points: 0, correct: 0, wrong: 0, streak: 0, best: 0, dmg: 0, heal: 0, upg: { gain: 0, streak: 0 }, order: [], cur: null, opts: null, lastAns: 0, lastPow: 0 };
  }

  // ----- players -----
  newPlayer(name, team, extra = {}) {
    const s = this.s;
    const taken = new Set(Object.values(s.players).map((x) => x.name.toLowerCase()));
    let base = name, k = 2; while (taken.has(name.toLowerCase())) name = `${base.slice(0, 15)} ${k++}`;
    const p = { id: rid(8), token: rid(20), name, team, online: true, kicked: false, joinedAt: Date.now(), ...this.freshStats(), ...extra };
    s.players[p.id] = p;
    if (s.status === "running" || s.status === "paused") this.placeLive(p, team);
    return p;
  }

  onJoin(ws, m) {
    const s = this.s;
    let p = m.token ? Object.values(s.players).find((x) => x.token === m.token) : null;
    if (p?.kicked) {
      // stay connected so the teacher can let them back in
      ws.serializeAttachment({ role: "player", pid: p.id });
      this.send(ws, { t: "kicked" });
      return;
    }
    if (!p) {
      if (s.status === "ended") return this.send(ws, { t: "error", msg: "This game has ended." });
      if (s.status !== "lobby" && !s.settings.lateJoin) return this.send(ws, { t: "error", msg: "Joining is locked right now. Ask your teacher to open it." });
      if (Object.keys(s.players).length >= 250) return this.send(ws, { t: "error", msg: "This game is full." });
      const name = cleanName(m.name);
      if (!name) return this.send(ws, { t: "error", msg: "Please choose a different name." });
      let team;
      const want = Number(m.team);
      if (s.status === "lobby") team = s.settings.teamPick === "choose" && s.teams[want] ? want : this.smallestTeam();
      else team = s.settings.teamPick === "choose" && s.teams[want]?.active && s.teams[want]?.alive ? want : this.smallestTeam(true);
      p = this.newPlayer(name, team);
      if (s.status !== "lobby") this.feed(`🚪 ${p.name} joined ${s.teams[team].icon} ${s.teams[team].name}`, "sys");
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
    return { t: "me", me: { id: p.id, name: p.name, team: p.team, energy: Math.floor(p.energy), points: Math.round(p.points), correct: p.correct, wrong: p.wrong, streak: p.streak, best: p.best, dmg: Math.round(p.dmg), heal: Math.round(p.heal), upg: p.upg } };
  }
  sendMe(p, ws) {
    if (p.bot) return;
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
    p.opts = q.type === "mc" ? shuffle(q.ans.map((_, i) => i)) : null;
    if (p.bot) return;
    const msg = { t: "q", q: { id: p.cur, text: q.q, img: q.img || "", type: q.type, options: p.opts ? p.opts.map((i) => ({ t: q.ans[i].t, img: q.ans[i].img || "" })) : null } };
    if (ws) this.send(ws, msg); else this.sendToPlayer(p.id, msg);
  }

  // shared by real players and pretend students
  applyAnswer(p, ok) {
    const s = this.s;
    let gained;
    if (ok) {
      p.streak++; p.best = Math.max(p.best, p.streak); p.correct++;
      const U = RULES.upgrades;
      gained = Math.round((U.gain.levels[p.upg.gain] + U.streak.levels[p.upg.streak] * Math.min(p.streak - 1, 10)) * s.settings.energyScale);
      p.energy += gained; p.points += s.settings.ptsCorrect;
    } else {
      p.streak = 0; p.wrong++;
      gained = -Math.min(Math.floor(p.energy), s.settings.wrongPenalty);
      p.energy += gained;
    }
    return gained;
  }
  doUpgrade(p, key) {
    const U = RULES.upgrades[key]; if (!U) return "Unknown upgrade.";
    const lvl = p.upg[key];
    if (lvl >= U.levels.length - 1) return "Already maxed.";
    const cost = U.costs[lvl + 1];
    if (p.energy < cost) return "Not enough energy.";
    p.energy -= cost; p.upg[key] = lvl + 1;
    return null;
  }
  doPower(p, key, target, now = Date.now()) {
    const s = this.s;
    const P = RULES.powers[key]; if (!P) return "Unknown power-up.";
    const mine = s.teams[p.team];
    if (p.energy < P.cost) return "Not enough energy.";
    if (!mine.alive && P.target === "self") return "Your team has fallen — you can't heal or shield, but you can still attack!";
    if (!mine.alive && !s.settings.fallenCanAttack) return "Your team has fallen.";
    const amt = P.base * s.settings.powerScale * this.surge(now) * this.teamBoost(mine.id);
    const tag = s.settings.feedNames ? `${p.name} (${mine.icon} ${mine.name})` : `${mine.icon} ${mine.name}`;
    let msg = "";
    if (P.target === "enemy") {
      const t = s.teams[Number(target)];
      if (!t || t.id === mine.id || !t.alive || !t.active) return "Pick a team that is still standing.";
      p.energy -= P.cost; p.lastPow = now;
      const dealt = this.damage(t, amt, p);
      if (key === "siphon" && mine.alive) { const h = this.heal(mine, dealt); p.heal += h; }
      msg = `${P.icon} ${tag} used ${P.name} on ${t.icon} ${t.name} for ${Math.round(dealt)}`;
    } else if (P.target === "all") {
      const targets = s.teams.filter((t) => t.alive && t.active && t.id !== mine.id);
      if (!targets.length) return "No teams left to hit.";
      p.energy -= P.cost; p.lastPow = now;
      for (const t of targets) this.damage(t, amt, p, true);
      msg = `${P.icon} ${tag} launched a Barrage hitting ${targets.length} teams for ${Math.round(amt)} each`;
    } else {
      p.energy -= P.cost; p.lastPow = now;
      if (key === "mend") { const h = this.heal(mine, amt); p.heal += h; msg = `${P.icon} ${tag} healed their team for ${Math.round(h)}`; }
      if (key === "shield") { const cap = mine.maxHp * 0.5; const before = mine.shield; mine.shield = Math.min(cap, mine.shield + amt); msg = `${P.icon} ${tag} raised a shield (+${Math.round(mine.shield - before)})`; }
    }
    this.feed(msg, key);
    this.flushKOs();
    this.checkLastTeam();
    return null;
  }

  onPlayer(ws, pid, m) {
    const s = this.s, p = s.players[pid];
    if (!p || p.kicked) return;
    const now = Date.now();
    if (m.t === "leave") {
      this.removePlayer(p);
      if (s.status !== "lobby" && s.status !== "ended") this.feed(`👋 ${p.name} left the game`, "sys");
      this.broadcast();
      return;
    }
    if (m.t === "answer") {
      if (s.status !== "running") return this.send(ws, { t: "error", msg: s.status === "paused" ? "Game is paused." : "Game is not running." });
      if (now - p.lastAns < 350 || Number(m.qid) !== p.cur) return;
      p.lastAns = now;
      const q = s.questions[p.cur];
      let ok, right = -1;
      if (q.type === "mc") {
        const pick = Number(m.pick);
        right = (p.opts || []).indexOf(0);
        ok = Number.isInteger(pick) && p.opts && p.opts[pick] === 0;
      } else ok = norm(m.answer) === norm(q.ans[0].t) && norm(m.answer) !== "";
      const gained = this.applyAnswer(p, ok);
      this.send(ws, { t: "result", correct: ok, gained, answer: q.ans[0].t, answerImg: q.ans[0].img || "", right, streak: p.streak });
      this.sendMe(p);
      this.nextQuestion(p);
      this.broadcast();
      return;
    }
    if (m.t === "upgrade") {
      if (s.status !== "running") return this.send(ws, { t: "error", msg: "You can shop once the game is running." });
      const err = this.doUpgrade(p, m.key);
      if (err) return this.send(ws, { t: "error", msg: err });
      this.send(ws, { t: "toast", msg: `${RULES.upgrades[m.key].name} upgraded to level ${p.upg[m.key] + 1}!` });
      this.sendMe(p);
      this.broadcast();
      return;
    }
    if (m.t === "power") {
      if (s.status !== "running") return this.send(ws, { t: "error", msg: s.status === "paused" ? "Game is paused." : "Game is not running." });
      if (now - p.lastPow < 300) return;
      const err = this.doPower(p, m.key, m.target, now);
      if (err) return this.send(ws, { t: "error", msg: err });
      this.sendMe(p);
      this.broadcast();
      return;
    }
  }

  // ----- demo mode: pretend students -----
  ensureBotTimer() {
    const s = this.s;
    const need = s && s.status !== "ended" && (s.botsToAdd > 0 || (s.settings.demo && Object.values(s.players).some((p) => (p.bot || p.auto) && !p.kicked)));
    if (need && !this.botTimer) this.botTimer = setInterval(() => this.botTick(), 1000);
    else if (!need) this.stopBotTimer();
  }
  stopBotTimer() { if (this.botTimer) { clearInterval(this.botTimer); this.botTimer = null; } }

  botTick() {
    const s = this.s;
    if (!s || s.status === "ended") return this.stopBotTimer();
    let changed = false;
    // trickle in a few pretend students each second so the lobby fills up like a real class
    if (s.botsToAdd > 0) {
      const n = Math.min(s.botsToAdd, 2 + Math.floor(Math.random() * 3));
      for (let i = 0; i < n; i++) {
        const used = new Set(Object.values(s.players).map((p) => p.name));
        const name = BOT_NAMES.find((x) => !used.has(x)) || `Student ${Object.keys(s.players).length + 1}`;
        const team = s.status === "lobby" ? (s.settings.teamPick === "choose" ? Math.floor(Math.random() * s.teams.length) : this.smallestTeam()) : this.smallestTeam(true);
        const p = this.newPlayer(name, team, { bot: true, skill: 0.55 + Math.random() * 0.35, speed: 0.7 + Math.random() * 0.9, nextAct: Date.now() + 2000 + Math.random() * 4000 });
        if (s.status === "running" || s.status === "paused") this.nextQuestion(p);
      }
      s.botsToAdd -= n; changed = true;
    }
    if (s.status === "running") {
      const now = Date.now();
      for (const p of Object.values(s.players)) {
        if (!(p.bot || p.auto) || p.kicked || now < (p.nextAct || 0)) continue;
        if (p.cur == null) this.nextQuestion(p);
        const ok = Math.random() < p.skill;
        const q = s.questions[p.cur], right = p.opts ? p.opts.indexOf(0) : -1;
        const gained = this.applyAnswer(p, ok);
        if (p.auto) { // show the pick on the watched player's screen
          let pick = right;
          if (!ok && p.opts) { const others = p.opts.map((_, i) => i).filter((i) => i !== right); pick = others[Math.floor(Math.random() * others.length)]; }
          this.sendToPlayer(p.id, { t: "result", auto: true, pick, correct: ok, gained, answer: q.ans[0].t, answerImg: q.ans[0].img || "", right, streak: p.streak });
        }
        this.nextQuestion(p);
        p.nextAct = now + (3000 + Math.random() * 6000) * p.speed + (ok ? 0 : 1500);
        if (Math.random() < 0.6) this.botSpend(p, now);
        if (p.auto) this.sendMe(p);
        changed = true;
        if (s.status !== "running") break;
      }
    }
    if (changed) this.broadcast();
    if (!s.botsToAdd && !s.settings.demo) this.stopBotTimer();
  }

  botSpend(p, now) {
    const s = this.s, mine = s.teams[p.team], U = RULES.upgrades, P = RULES.powers;
    // early on, invest in upgrades now and then
    if (p.upg.gain < 3 && p.energy >= U.gain.costs[p.upg.gain + 1] && Math.random() < 0.55) return this.doUpgrade(p, "gain");
    if (p.upg.streak < 2 && p.energy >= U.streak.costs[p.upg.streak + 1] && Math.random() < 0.25) return this.doUpgrade(p, "streak");
    const enemies = s.teams.filter((t) => t.active && t.alive && t.id !== p.team);
    const choices = [];
    if (enemies.length) { choices.push(["strike", 5], ["siphon", 2]); if (enemies.length > 1) choices.push(["barrage", 1]); }
    if (mine.alive && mine.hp < mine.maxHp * 0.7) choices.push(["mend", 4]);
    if (mine.alive && mine.shield < mine.maxHp * 0.15) choices.push(["shield", 1]);
    const ok = choices.filter(([k]) => p.energy >= P[k].cost);
    if (!ok.length) return;
    let r = Math.random() * ok.reduce((a, [, w]) => a + w, 0), key = ok[0][0];
    for (const [k, w] of ok) { if ((r -= w) <= 0) { key = k; break; } }
    let target = null;
    if (P[key].target === "enemy") {
      const leader = enemies.slice().sort((a, b) => this.teamScore(b) - this.teamScore(a))[0];
      target = (Math.random() < 0.4 ? leader : enemies[Math.floor(Math.random() * enemies.length)]).id;
    }
    this.doPower(p, key, target, now);
  }

  damage(t, amt, attacker) {
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
    this.stopBotTimer();
    this.broadcast();
  }
}
