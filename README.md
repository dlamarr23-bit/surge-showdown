# ⚡ Surge Showdown

A team battle quiz game for up to 10 teams. Each student answers questions on their own Chromebook to earn energy, then spends that energy to upgrade, attack other teams, heal, or shield their own team. As the timer runs down, every power-up gets **exponentially stronger** (the "Surge"). Teams that are knocked out can keep attacking. When the game ends, the **top 3 teams go on a podium**.

- **Students:** go to your site's main address, then type the 6-digit code and their name.
- **Teacher:** go to `/host.html` on your site.

---

## Put it online (GitHub → Cloudflare), about 10 minutes

You only do this once. After that, every change you push to GitHub redeploys the site automatically.

### 1. Upload to GitHub
1. Go to https://github.com/new and create a repository named **surge-showdown**. Public or private both work.
2. On the new repo page, click **"uploading an existing file"**.
3. Unzip `surge-showdown.zip` on your computer. Drag **everything inside the folder** into the upload box: the `public` and `src` folders, plus `package.json`, `wrangler.jsonc`, `README.md`, and `.gitignore`.
   > Tip: if `.gitignore` is hidden on your computer, you can skip it.
4. Click **Commit changes**.

### 2. Connect it to Cloudflare
1. Log in at https://dash.cloudflare.com and open **Workers & Pages**.
2. Click **Create** → **Workers** tab → **Import a repository**. This is not the "Pages" tab, because the game needs a Worker for its live multiplayer server.
3. Connect your GitHub account if asked, then pick **surge-showdown**.
4. Leave the defaults as they are (deploy command `npx wrangler deploy`) and click **Deploy**.
5. In a minute or so you'll get a URL like `https://surge-showdown.<your-name>.workers.dev`.

That's it. Everything runs on Cloudflare's **free plan**. The live game rooms use "Durable Objects", which the free plan includes.

> **School network:** if Chromebooks can't open `*.workers.dev`, ask IT to allow it. You can also add a custom domain in Cloudflare: open your Worker → **Settings → Domains & Routes**.

### Making changes later
Edit a file on GitHub (pencil icon) and commit. Cloudflare redeploys automatically.

---

## How to run a game

1. Open `/host.html`. Pick the game length, number of teams (2–10), theme, and battle settings.
2. Paste your questions, one per line:
   ```
   Question | Correct answer | Wrong | Wrong | Wrong
   Who proposed continental drift? | Alfred Wegener
   ```
   - You can paste straight from **Google Sheets** (columns: question, correct, wrong, wrong, wrong) or import a **Gimkit CSV export**.
   - A line with only a correct answer becomes a **type-the-answer** question. Typed answers aren't case-sensitive.
   - Click **💾 Save set** to keep a set in this browser for next time.
3. Click **Create game**, project the screen, and students join with the code.
4. In the lobby you can move students between teams, shuffle the teams, or remove a student. Then click **Start**.
5. During the game: **Pause/Resume**, **+1 min / −1 min**, **End game** at any time, plus move or remove players.
6. At the end, the podium shows the top 3 teams along with awards: MVP, most damage, most correct, longest streak, and top healer. Click **Rematch** to play again with the same students and code.

If your host tab closes or refreshes, just reopen `/host.html` and it will reconnect to your game. Students who refresh or lose Wi-Fi also rejoin automatically.

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
src/worker.js        Game server (Cloudflare Worker + Durable Object)
public/index.html    Student page
public/play.js
public/host.html     Teacher page
public/host.js
public/common.js     Themes, question parser, shared helpers
public/sample-questions.js   Built-in 8th grade science sample set
public/style.css
wrangler.jsonc       Cloudflare config
```

## Test on your own computer (optional)
```
npm install
npx wrangler dev
```
Then open http://localhost:8787/host.html in one window and http://localhost:8787 in others.
