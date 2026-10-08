// ---------------- Host music ----------------
// Songs from the vocabulary site (free Pixabay tracks, see MUSIC-CREDITS.md).
// Music plays on the host's screen only: a lobby song while students join, a
// game song during the battle (paused when the game is paused), and the
// winning song once when the podium shows. Picks and volumes are remembered
// in this browser.
(() => {
  const DIR = BASE + "/music/";
  const SONGS = {
    lobby: [
      ["competition-briefing", "Competition Briefing"],
      ["cartoon-lobby-music-3", "Cartoon Lobby Music 3"],
      ["cartoon-lobby-music-10", "Cartoon Lobby Music 10"],
      ["video-game-music", "Video Game Music"],
      ["elevator-music", "Elevator Music"],
      ["lounge-jazz", "Lounge Jazz"],
      ["waiting-room-calm", "Waiting Room (Calm)"],
    ],
    game: [
      ["game-quiz-master", "Quiz Master"],
      ["game-pixel-chiptune", "Pixel Chiptune"],
      ["game-retro-game-arcade", "Retro Game Arcade"],
      ["game-arcadia", "Arcadia"],
      ["game-rise-above", "Rise Above"],
      ["game-heroic-battle-orchestra", "Heroic Battle Orchestra"],
      ["game-airland-jazz", "Airland Jazz"],
    ],
  };
  const ON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  const saved = store.get("ss_music", {});
  const m = {
    song: { lobby: saved.lobby ?? "competition-briefing", game: saved.game ?? "game-quiz-master" },
    vol: { lobby: saved.lobbyVol ?? 60, game: saved.gameVol ?? 60 },
    mute: { lobby: !!saved.lobbyMuted, game: !!saved.gameMuted },
    win: saved.win !== false,
    part: "",       // which part the music bar controls now ('lobby' | 'game' | '')
    trying: null,   // setup screen Listen button that is playing
    lastStatus: null,
  };
  const keep = () => store.set("ss_music", { lobby: m.song.lobby, game: m.song.game, lobbyVol: m.vol.lobby, gameVol: m.vol.game, lobbyMuted: m.mute.lobby, gameMuted: m.mute.game, win: m.win });

  const player = new Audio(); player.loop = true; player.preload = "none";
  let winSong = null;

  function fill(sel, part) {
    sel.innerHTML = `<option value="">No music</option>` + SONGS[part].map(([id, name]) => `<option value="${id}">${name}</option>`).join("");
    sel.value = m.song[part];
  }
  function play(id, part) {
    const src = DIR + id + ".mp3";
    if (player.getAttribute("src") !== src) player.setAttribute("src", src);
    player.volume = m.vol[part] / 100;
    if (!player.paused) return;
    const go = player.play();
    // A browser that blocks sound until the teacher clicks: show it as muted so one click turns it on.
    if (go && go.catch) go.catch((e) => { if (e && e.name === "NotAllowedError") { m.mute[part] = true; paint(); } });
  }
  const stop = () => player.pause();

  // Which song should be playing right now, from the game state.
  function wanted() {
    if (typeof S === "undefined" || !S || editing) return "";
    if (S.status === "lobby") return "lobby";
    if (S.status === "running") return "game";
    return ""; // paused, ended
  }
  function sync() {
    if (m.trying) return; // the Listen button is in charge on the setup screen
    const st = typeof S !== "undefined" && S && !editing ? S.status : null;
    // Winning song once, when the podium first shows.
    if (st === "ended" && m.lastStatus && m.lastStatus !== "ended") {
      stop();
      if (m.win && !m.mute.game) {
        winSong = winSong || new Audio(DIR + "winning.mp3");
        winSong.currentTime = 0; winSong.volume = m.vol.game / 100;
        winSong.play().catch(() => {});
      }
    }
    if (st !== "ended" && winSong && !winSong.paused) winSong.pause();
    m.lastStatus = st;

    const part = wanted();
    const barPart = part || (st === "paused" ? "game" : "");
    if (barPart !== m.part) { m.part = barPart; if (barPart) { fill($("#muSong"), barPart); $("#muLabel").textContent = barPart === "game" ? "Game music" : "Lobby music"; } }
    $("#muBar").classList.toggle("hidden", !barPart);
    if (part && m.song[part] && !m.mute[part]) play(m.song[part], part); else stop();
    paint();
  }
  function paint() {
    const quiet = (p) => m.mute[p] || !m.song[p];
    if (m.part) {
      const b = $("#muMute"), q = quiet(m.part);
      b.innerHTML = q ? OFF : ON; b.classList.toggle("muted", q);
      b.title = (m.mute[m.part] ? "Unmute" : "Mute") + " the music"; b.setAttribute("aria-label", b.title);
      b.setAttribute("aria-pressed", String(m.mute[m.part]));
      if (document.activeElement !== $("#muSong")) $("#muSong").value = m.song[m.part];
      if (document.activeElement !== $("#muVol")) $("#muVol").value = String(m.vol[m.part]);
    }
  }

  // Setup screen: song menus, Listen buttons, volume sliders, winning song.
  [["lobby", "#muLobby", "#muLobbyTry", "#muLobbyVol"], ["game", "#muGame", "#muGameTry", "#muGameVol"]].forEach(([part, selId, tryId, volId]) => {
    const sel = $(selId), btn = $(tryId), vol = $(volId);
    fill(sel, part); vol.value = String(m.vol[part]);
    sel.onchange = () => { m.song[part] = sel.value; keep(); if (m.trying === btn) { if (sel.value) { stop(); play(sel.value, part); } else stopTrying(); } };
    btn.onclick = () => {
      if (m.trying === btn) { stopTrying(); return; }
      stopTrying();
      if (!m.song[part]) { m.song[part] = SONGS[part][0][0]; sel.value = m.song[part]; keep(); }
      m.mute[part] = false; keep();
      m.trying = btn; btn.textContent = "■ Stop";
      stop(); play(m.song[part], part);
    };
    vol.oninput = () => { m.vol[part] = Number(vol.value); if (m.trying === btn || m.part === part) player.volume = m.vol[part] / 100; keep(); };
  });
  function stopTrying() { if (!m.trying) return; m.trying.textContent = "▶ Listen"; m.trying = null; stop(); }
  $("#muWin").value = String(m.win);
  $("#muWin").onchange = (e) => { m.win = e.target.value === "true"; keep(); };

  // Music bar (lobby + game).
  $("#muMute").onclick = () => {
    const p = m.part; if (!p) return;
    if (!m.song[p]) { m.song[p] = SONGS[p][0][0]; m.mute[p] = false; }
    else m.mute[p] = !m.mute[p];
    keep(); sync();
  };
  $("#muSong").onchange = (e) => { const p = m.part; if (!p) return; m.song[p] = e.target.value; m.mute[p] = false; keep(); stop(); sync(); };
  $("#muVol").oninput = (e) => {
    const p = m.part; if (!p) return;
    m.vol[p] = Number(e.target.value); player.volume = m.vol[p] / 100;
    if (m.mute[p] && m.vol[p] > 0) m.mute[p] = false; // moving the slider turns muted music back on
    const v = p === "lobby" ? "#muLobbyVol" : "#muGameVol"; $(v).value = String(m.vol[p]);
    keep(); sync();
  };

  // Leaving the setup screen (Create game / Save changes) ends any Listen preview.
  document.addEventListener("click", (e) => { if (e.target.closest("#createBtn, #cancelEdit")) stopTrying(); }, true);

  setInterval(sync, 300);
  sync();
})();
