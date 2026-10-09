// Shared game rules + helpers. Used by the Durable Object (worker.js) and the
// request router (router.js), which also runs inside Cloudflare Pages Functions.

export const RULES = {
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
  // Special events (each one can be turned off in setup)
  gamble: { name: "Double or Nothing", icon: "🎲", cost: 30, base: 60, cooldownSec: 60,
    desc: "Bet on your next question. Right: your team gains health. Wrong: your team loses it (never knocks you out)." },
  bountyEnergy: 0.5,                       // bonus energy per 1 damage dealt to the bounty team
  comebackHp: 0.3,                         // a revived team comes back with this share of its max health
  showdownSec: 60,                         // final showdown length (surge ×2, no healing)
  drop: { need: 5, perPlayer: 2.5, firstSec: 90, everySec: 120, expireSec: 75, minLeftSec: 45, share: 0.35, energy: 100 },
};

export const DEFAULT_SETTINGS = {
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
  sizeBoost: true, // smaller teams get stronger power-ups (biggest team size / this team size)
  lastTeamEnds: false,
  teamPick: "auto", // auto | choose
  lateJoin: true,
  wrongPenalty: 5,
  ptsCorrect: 10,
  ptsDamage: 1,
  survivalBonus: 300,
  koBonus: 200,
  koPenalty: 0, // points the fallen team loses when knocked out (score can go negative)
  feedNames: true,
  demo: false,
  gamble: true,      // 🎲 Double or Nothing in the shop
  bounty: true,      // 🎯 bonus energy for hitting the team in 1st place
  comeback: 10,      // 🔄 correct answers a fallen team needs to come back once (0 = off)
  supplyDrops: true, // 📦 race to 5 correct answers for a prize
  showdown: true,    // ⚔️ last minute: surge ×2, no healing
};

export const DEMO_COUNT = 40;

const BAD = ["fuck","shit","bitch","ass","dick","cock","pussy","nigg","fag","cunt","slut","whore","penis","vagina","sex","porn","rape","nazi","hitler","kkk","damn","hell"];
export const cleanName = (s) => {
  let n = String(s || "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 18);
  const flat = n.toLowerCase().replace(/[^a-z]/g, "");
  if (!n || BAD.some((b) => flat.includes(b))) return "";
  return n;
};
export const rid = (n = 16) => {
  const a = new Uint8Array(n); crypto.getRandomValues(a);
  return Array.from(a, (b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
};
export const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const num = (v, d, lo, hi) => { const x = Number(v); return Number.isFinite(x) ? clamp(x, lo, hi) : d; };
export const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9.\-/ ]/g, "").replace(/\s+/g, " ").trim();
export const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export function sanitizeSettings(input, prev = DEFAULT_SETTINGS) {
  const s = { ...DEFAULT_SETTINGS, ...prev };
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
  s.teams = s.teams.slice();
  while (s.teams.length < 10) s.teams.push({ name: `Team ${s.teams.length + 1}`, icon: "⭐", color: "#888888" });
  s.durationMin = num(i.durationMin, s.durationMin, 1, 90);
  s.hpAmount = Math.round(num(i.hpAmount, s.hpAmount, 50, 100000));
  s.hpMode = i.hpMode === "flat" ? "flat" : i.hpMode === "perPlayer" ? "perPlayer" : s.hpMode;
  s.surgeMax = num(i.surgeMax, s.surgeMax, 1, 20);
  s.surgeCurve = num(i.surgeCurve, s.surgeCurve, 0.5, 10);
  s.powerScale = num(i.powerScale, s.powerScale, 0.25, 5);
  s.energyScale = num(i.energyScale, s.energyScale, 0.25, 5);
  for (const k of ["fallenCanAttack", "sizeBoost", "lastTeamEnds", "lateJoin", "feedNames", "demo", "gamble", "bounty", "supplyDrops", "showdown"]) {
    if (typeof i[k] === "boolean") s[k] = i[k];
    else if (i[k] === "true" || i[k] === "false") s[k] = i[k] === "true";
  }
  s.teamPick = i.teamPick === "choose" ? "choose" : i.teamPick === "auto" ? "auto" : s.teamPick;
  s.wrongPenalty = Math.round(num(i.wrongPenalty, s.wrongPenalty, 0, 1000));
  s.ptsCorrect = Math.round(num(i.ptsCorrect, s.ptsCorrect, 0, 1000));
  s.ptsDamage = num(i.ptsDamage, s.ptsDamage, 0, 100);
  s.survivalBonus = Math.round(num(i.survivalBonus, s.survivalBonus, 0, 100000));
  s.koBonus = Math.round(num(i.koBonus, s.koBonus, 0, 100000));
  s.koPenalty = Math.round(num(i.koPenalty, s.koPenalty, 0, 100000));
  s.comeback = Math.round(num(i.comeback, s.comeback, 0, 100));
  return s;
}

// Image links: only plain http(s) URLs. Google Drive share links become direct image links.
export function cleanImg(u) {
  let s = String(u || "").trim();
  if (!s) return "";
  if (!/^https?:\/\/[^\s"'<>]+$/i.test(s) || s.length > 2000) return "";
  const m = s.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]{20,})/i);
  if (m) s = `https://drive.google.com/thumbnail?id=${m[1]}&sz=w1000`;
  return s;
}

// Question format (from the host page):
//   { q, img, correct, cImg, wrong: [..], wImg: [..] }
// Stored as { q, img, type, ans: [{ t, img }] } where ans[0] is the correct answer.
export function sanitizeQuestions(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const q of list.slice(0, 500)) {
    const text = String(q?.q || "").slice(0, 400).trim();
    const img = cleanImg(q?.img);
    const correct = { t: String(q?.correct || "").slice(0, 200).trim(), img: cleanImg(q?.cImg) };
    const wrongT = Array.isArray(q?.wrong) ? q.wrong : [];
    const wrongI = Array.isArray(q?.wImg) ? q.wImg : [];
    const wrong = [];
    for (let k = 0; k < Math.max(wrongT.length, wrongI.length) && wrong.length < 5; k++) {
      const a = { t: String(wrongT[k] || "").slice(0, 200).trim(), img: cleanImg(wrongI[k]) };
      if (a.t || a.img) wrong.push(a);
    }
    if (!text && !img) continue;
    if (!correct.t && !correct.img) continue;
    const type = wrong.length ? "mc" : "text";
    if (type === "text" && !correct.t) continue; // typed answers need text
    out.push({ q: text, img, type, ans: [correct, ...wrong] });
  }
  return out;
}

// Back to the host-page format (so the host can edit a running game's questions)
export function questionsForHost(qs) {
  return qs.map((x) => ({
    q: x.q, img: x.img || "", correct: x.ans[0].t, cImg: x.ans[0].img || "",
    wrong: x.ans.slice(1).map((a) => a.t), wImg: x.ans.slice(1).map((a) => a.img || ""),
  }));
}
