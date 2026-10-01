# ⚡ Surge Showdown

A team battle quiz game for up to 10 teams. Each student answers questions on their own Chromebook to earn energy, then spends that energy to upgrade, attack other teams, heal, or shield their own team. As the timer runs down, every power-up gets **exponentially stronger** (the "Surge"). Teams that are knocked out can keep attacking. When the game ends, the **top 3 teams go on a podium**.

- **Students:** go to your site's main address, then type the 6-digit code and their name.
- **Teacher:** go to `/surge/host` on your site.

The game also runs inside the physical-science-8 Pages site. See `ADD-TO-YOUR-SITE.md` in the add-on zip.

---

## Put it online

The game has two parts on Cloudflare (both free):

| Part | What it is | Who opens it |
|---|---|---|
| **Pages site** (`*.pages.dev`) | The pages students and teachers open | Everyone |
| **Worker** (`surge-showdown`) | The live game server (Durable Objects) | Nobody directly. The Pages site talks to it privately inside Cloudflare |

Because Chromebooks only ever load the `*.pages.dev` address, a web filter that blocks `*.workers.dev` no longer matters.

### 1. Update GitHub
Upload every file and folder from the zip into the repo (replace the old ones), including the new `pages` folder. Commit. The Worker redeploys on its own; keep it, it is the game server.

### 2. Create the Pages project (one time)
1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** tab → **Import an existing Git repository** → pick **surge-showdown**.
2. Build settings:
   - Framework preset: **None**
   - Build command: `npm run build`
   - Build output directory: `dist`
   - **Root directory (advanced): `pages`**
3. **Save and Deploy**. You get an address like `https://surge-showdown-pages.pages.dev`.
4. The connection to the game server is set up for you by `pages/wrangler.jsonc` (binding `SERVER` → Worker `surge-showdown`). You can confirm it under the Pages project's **Settings → Bindings**.

Teacher screen: `https://<your-site>.pages.dev/surge/host` · Students: `https://<your-site>.pages.dev`

> **Still blocked?** Ask IT to allow your `*.pages.dev` address (and secure websockets, `wss://`, on it). You can also add a custom domain under the Pages project → **Custom domains**.

### Making changes later
Edit a file on GitHub and commit. Both the Worker and the Pages site redeploy automatically.

---

## How to run a game

1. Open `/surge/host`. Every setting is a dropdown: game length, teams, theme, battle, surge and scoring.
2. Add questions. The easiest way is the **Google Sheets template** (button on the host screen, or `question-template.xlsx`): one row per question, with optional picture links for the question and every answer. Share the sheet as "Anyone with the link → Viewer", paste the link, click **Import**. Or paste lines:
   ```
   Question | Correct answer | Wrong | Wrong | Wrong
   Who proposed continental drift? | Alfred Wegener
   ```
   - You can paste straight from **Google Sheets** (columns: question, correct, wrong, wrong, wrong) or import a **Gimkit CSV export**.
   - A line with only a correct answer becomes a **type-the-answer** question. Typed answers aren't case-sensitive.
   - Click **💾 Save set** to keep a set in this browser for next time.
   - Add a picture to any part with `[img: https://link-to-picture]`. Google Drive links work if the file is shared.
3. Optional: tick **Demo mode: 40 pretend students** to watch a full game by yourself. Pretend students join, answer (some right, some wrong), shop and attack. Real students can still join. You can turn them on or off from the lobby or during the game.
4. Click **Create game**, project the screen, and students join with the code.
4. In the lobby you can move students between teams, shuffle the teams, or remove a student. Then click **Start**.
5. During the game: **Pause/Resume**, **+1 min / −1 min**, **End game**, move players, and **add or drop students any time**:
   - **➕ Add students** shows the join code full screen. New students go to the smallest team still standing, and that team gets extra health.
   - **New students: Can join / Locked** opens or closes joining mid-game.
   - **✕** removes a student. Removed students appear in a list with **Let back in**, and their screen picks up where they left off.
6. At the end, the podium shows the top 3 teams along with awards: MVP, most damage, most correct, longest streak, and top healer. Click **Rematch** to play again with the same students and code.

If your host tab closes or refreshes, just reopen `/surge/host` and it will reconnect to your game. Students who refresh or lose Wi-Fi also rejoin automatically.

## Game rules

| Power-up | Cost | Effect at start (×1 strength) |
|---|---|---|
| ⚔️ Strike | 40 ⚡ | 30 damage to one team |
| 🌀 Siphon | 90 ⚡ | 25 damage to one team + heals yours 25 |
| ☄️ Barrage | 150 ⚡ | 18 damage to *every* other standing team |
| 💚 Mend | 60 ⚡ | Heal your team 45 |
| 🛡️ Shield | 70 ⚡ | +50 shield, which absorbs damage first (max 50% of health) |

**Surge:** every effect above is multiplied by the surge, which climbs from ×1 to your max (default ×5) on an exponential curve. Costs stay the same, so the last minutes get chaotic.

**Upgrades:** Energy per Question (10 → 20 → 35 → 60 → 100 → 160) and Streak Bonus (extra energy for each answer in a row).

**Fallen teams** can't heal or shield, but they can still attack. You can turn this off.

**Team score** = each member's points (correct answers + damage dealt) + a knockout bonus for each final blow + a survival bonus for teams still standing at the end. If every team falls, the last team to fall gets the survival bonus.

All of these numbers can be changed in the host setup screen.

## Files
```
src/worker.js        Game server (Cloudflare Worker + Durable Object, incl. demo-mode pretend students)
src/router.js        API routes (create game, websockets, Google Sheets import)
src/shared.js        Game rules, settings and question checks
pages/               Cloudflare Pages project (functions/ forwards /surge/api + /surge/ws to the Worker)
public/surge/question-template.xlsx   Question template with picture columns
public/surge/index.html    Student page
public/surge/play.js
public/surge/host.html     Teacher page
public/surge/host.js
public/surge/common.js     Themes, question parser, shared helpers
public/surge/sample-questions.js   Built-in 8th grade science sample set
public/surge/style.css
wrangler.jsonc       Cloudflare config
```

## Test on your own computer (optional)
```
npm install
npx wrangler dev
```
Then open http://localhost:8787/surge/host in one window and http://localhost:8787/surge/ in others.
To test the Pages version too, keep that running and in a second terminal run `cd pages && npm run build && npx wrangler pages dev`.
