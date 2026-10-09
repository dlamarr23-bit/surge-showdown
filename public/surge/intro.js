// ---------------- Host intro (how to play) ----------------
// Full-screen slides shown on the teacher's screen when "Start game" is
// clicked. The game timer starts only after the last slide (or Skip), so the
// class never loses battle time to the instructions.
// Setting: cfg.intro = "auto" (slides advance on their own) | "manual" | "off".
const Intro = (() => {
  const SLIDE_MS = 9000, TITLE_MS = 4500;
  let slides = [], i = 0, timer = null, started = 0, left = 0, paused = false, onDone = null, raf = null;

  const n = (v) => Number(v).toLocaleString();
  function build(st, players) {
    const R = RULES || { powers: {}, upgrades: { gain: { levels: [10, 160] } } };
    const P = R.powers, gain = R.upgrades.gain.levels;
    const pw = (k, extra) => P[k] ? `<b>${P[k].icon} ${P[k].name}</b> <span class="in-cost">${P[k].cost}⚡</span> ${extra || P[k].desc}` : "";
    const hp = st.hpMode === "flat" ? `${n(st.hpAmount)} health` : `${n(st.hpAmount)} health for every player`;
    const teams = st.teams.filter((t) => players.some((p) => p.team === t.id));
    const ends = st.lastTeamEnds ? `The game ends after <b>${st.durationMin} minutes</b> or when only <b>one team</b> is left standing.` : `The game lasts <b>${st.durationMin} minutes</b>. Fallen teams stay in until time runs out.`;
    slides = [
      { icon: "⚡", h: "Answer questions to earn energy!", pts: [
        ["✅", `Every correct answer earns <b>energy</b>. You start at <b>${gain[0]} energy</b> per question.`],
        ["❌", st.wrongPenalty ? `A wrong answer <b>costs ${st.wrongPenalty} energy</b>. Read carefully. Don't guess!` : `Wrong answers don't cost energy, but they don't earn any either.`],
        ["🔥", `Get answers right <b>in a row</b> to build a streak.`],
      ] },
      { icon: "🛒", h: "Upgrade in the shop!", pts: [
        ["📈", `<b>Energy per Question</b> raises what you earn per answer, from ${gain[0]} all the way to <b>${gain[gain.length - 1]}</b>.`],
        ["🔥", `<b>Streak Bonus</b> gives extra energy for every answer in a row you get right.`],
        ["💡", `Upgrade <b>early</b>. More energy now means bigger power-ups later.`],
      ] },
      { icon: "⚔️", h: "Sabotage the other teams!", pts: [
        ["", pw("strike")], ["", pw("siphon")], ["", pw("barrage")],
      ] },
      { icon: "🛡️", h: "Protect your team!", pts: [
        ["", pw("mend")],
        ["", pw("shield", "A shield soaks up damage <b>before</b> your health does.")],
        ["🤝", `Your whole team shares <b>one health bar</b>. Everyone helps keep it full.`],
      ] },
      { icon: "❤️", h: "Don't run out of health!", pts: [
        ["🏁", `Your team starts with <b>${hp}</b>.`],
        ["💀", `At zero health your team <b>falls</b>. Fallen teams can't heal or shield.`],
        st.fallenCanAttack ? ["⚔️", `Fallen? Keep answering! You can <b>still attack</b> and earn points.`] : ["⛔", `Fallen teams can't attack anymore, so stay alive!`],
        ...(st.sizeBoost ? [["💪", `Smaller teams get <b>stronger power-ups</b> to keep it fair.`]] : []),
      ] },
      ...(st.surgeMax > 1 ? [{ icon: "🌩️", h: "Watch for the SURGE!", pts: [
        ["⏱️", `Power-ups get <b>stronger</b> as time runs out. Watch the Surge meter at the top.`],
        ["🚀", `They start at <b>×1</b> and reach <b>×${st.surgeMax}</b> in the final seconds.`],
        st.showdown ? ["⚔️", `<b>Final Showdown:</b> in the last minute the surge <b>doubles</b> and healing turns <b>off</b>!`] : ["🧠", `Save some energy for the end, or strike early to knock a team out first?`],
      ] }] : []),
      ...((st.gamble || st.bounty || st.comeback > 0 || st.supplyDrops) ? [{ icon: "🎉", h: "Special events!", pts: [
        ...(st.gamble ? [["🎲", `<b>Double or Nothing</b> (shop): bet on your next question. Right = your team <b>gains</b> health. Wrong = it <b>loses</b> health.`]] : []),
        ...(st.bounty ? [["🎯", `The team in <b>1st place</b> has a bounty. Hit them for <b>bonus energy</b>!`]] : []),
        ...(st.supplyDrops ? [["📦", `<b>Supply drops</b> appear during the game. The first team to <b>fill the bar with correct answers</b> wins the prize!`]] : []),
        ...(st.comeback > 0 ? [["🔄", `Knocked out? Get <b>${st.comeback} correct answers</b> as a team to <b>come back</b> (once)!`]] : []),
      ] }] : []),
      { icon: "🏆", h: "How to win", pts: [
        ["⭐", `Team score = everyone's points: <b>${st.ptsCorrect}</b> per correct answer + <b>${st.ptsDamage}</b> per damage dealt.`],
        ["🎁", [st.survivalBonus ? `<b>+${n(st.survivalBonus)}</b> for every team still standing at the end` : "", st.koBonus ? `<b>+${n(st.koBonus)}</b> for the team that knocks another team out` : "", st.koPenalty ? `Get knocked out and your team <b>loses ${n(st.koPenalty)}</b> points (you can earn them back)` : ""].filter(Boolean).join(". ") + "." ],
        ["⏳", ends],
        ["🥇", `The <b>top 3 teams</b> go on the podium!`],
      ].filter((p) => p[1] !== ".") },
      { title: true, h: st.title || "Surge Showdown", teams },
    ];
  }

  function slideHTML(s) {
    if (s.title) {
      const vs = s.teams.length ? s.teams.map((t) => `<div class="in-team" style="--tc:${t.color}"><span>${esc(t.icon)}</span>${esc(t.name)}</div>`).join(`<div class="in-vs">vs.</div>`) : "";
      return `<div class="in-slide in-title"><div class="in-big">${esc(s.h)}</div><div class="in-teams">${vs}</div><div class="in-ready">Get ready…</div></div>`;
    }
    return `<div class="in-slide"><div class="in-icon">${s.icon}</div><h1 class="in-h">${s.h}</h1>
      <ul class="in-pts">${s.pts.map(([ic, t], k) => `<li style="--d:${0.25 + k * 0.18}s">${ic ? `<span class="in-ic">${ic}</span>` : ""}<span>${t}</span></li>`).join("")}</ul></div>`;
  }

  function el() {
    let o = $("#intro");
    if (o) return o;
    o = document.createElement("div");
    o.id = "intro"; o.className = "intro hidden"; o.setAttribute("role", "dialog"); o.setAttribute("aria-label", "How to play");
    o.innerHTML = `
      <button class="btn ghost in-skip" id="inSkip">Skip intro ⏭</button>
      <div class="in-stage" id="inStage" aria-live="polite"></div>
      <div class="in-foot">
        <button class="btn sm ghost" id="inBack" aria-label="Previous">◀ Back</button>
        <div class="in-dots" id="inDots"></div>
        <button class="btn sm ghost" id="inPause" aria-label="Pause"></button>
        <button class="btn sm primary" id="inNext">Next ▶</button>
      </div>
      <div class="in-prog"><div id="inBar"></div></div>`;
    document.body.appendChild(o);
    $("#inSkip").onclick = () => finish();
    $("#inNext").onclick = () => go(i + 1);
    $("#inBack").onclick = () => go(i - 1);
    $("#inPause").onclick = () => { paused = !paused; if (!paused) started = performance.now(); else left = remaining(); paint(); };
    $("#inDots").onclick = (e) => { const d = e.target.closest("[data-i]"); if (d) go(+d.dataset.i); };
    document.addEventListener("keydown", (e) => {
      if (o.classList.contains("hidden")) return;
      if (e.key === "Escape") finish();
      else if (e.key === "ArrowRight" || e.key === " " || e.key === "Enter") { e.preventDefault(); go(i + 1); }
      else if (e.key === "ArrowLeft") go(i - 1);
    });
    return o;
  }

  const dur = () => (slides[i] && slides[i].title ? TITLE_MS : SLIDE_MS);
  const remaining = () => Math.max(0, left - (performance.now() - started));
  function paint() {
    const auto = cfg.intro !== "manual";
    $("#inPause").classList.toggle("hidden", !auto);
    $("#inPause").textContent = paused ? "▶ Play" : "⏸ Pause";
    $("#inBack").disabled = i === 0;
    $("#inNext").textContent = i === slides.length - 1 ? (onDone ? "Start! ▶" : "Done ✓") : "Next ▶";
    $("#inDots").innerHTML = slides.map((_, k) => `<button class="${k === i ? "on" : k < i ? "past" : ""}" data-i="${k}" aria-label="Slide ${k + 1}"></button>`).join("");
    $(".in-prog").classList.toggle("hidden", !auto);
  }
  function tick() {
    cancelAnimationFrame(raf);
    if ($("#intro").classList.contains("hidden")) return;
    const auto = cfg.intro !== "manual";
    if (auto) {
      const r = paused ? left : remaining();
      $("#inBar").style.width = (100 * (1 - r / dur())) + "%";
      if (!paused && r <= 0) return go(i + 1);
    }
    raf = requestAnimationFrame(tick);
  }
  function go(k) {
    if (k < 0) return;
    if (k >= slides.length) return finish();
    i = k; left = dur(); started = performance.now();
    $("#inStage").innerHTML = slideHTML(slides[i]);
    paint(); tick();
  }
  function finish() {
    cancelAnimationFrame(raf);
    $("#intro").classList.add("hidden");
    document.body.classList.remove("intro-on");
    const cb = onDone; onDone = null;
    if (cb) cb();
  }
  // play(state, then): shows the slides; calls `then` once they finish or are skipped.
  function play(state, then) {
    if (!state) return then && then();
    build(state.settings, state.players || []);
    onDone = then || null; paused = false;
    const o = el();
    o.classList.remove("hidden"); document.body.classList.add("intro-on");
    go(0);
    $("#inNext").focus();
  }
  return { play };
})();
