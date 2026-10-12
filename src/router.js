// Request router for the game's API + websocket endpoints.
// Runs in the Worker (worker.js) AND in Cloudflare Pages Functions (functions/surge/...).
// Returns a Response, or null when the request is for a static file.
import { RULES, json, sanitizeQuestions } from "./shared.js";
import { userKey, validUser } from "./library.js";

export async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/surge(?=\/(api|ws)\/)/, "");
  if (!path.startsWith("/api/") && !path.startsWith("/ws/")) return null;
  if (!env.GAME) return json({ error: "Server setup isn't finished: the GAME Durable Object binding is missing." }, 500);

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
        body: JSON.stringify({ code, settings: body.settings, questions: body.questions }),
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

  // Teacher accounts: saved sets that show up on any computer (one Durable Object per username).
  // The teacher's other tools (like the Classroom Group Maker on its own address) use the same
  // account, so any site may call this. It is safe: sign-in travels in the request body, never in cookies.
  if (path === "/api/account") {
    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
    if (request.method !== "POST") return cors(json({ error: "Not found" }, 404));
    if (!env.LIB) return cors(json({ error: "Server setup isn't finished: the LIB Durable Object binding is missing." }, 500));
    let body = {};
    try { body = await request.json(); } catch {}
    const key = userKey(body.user);
    if (!validUser(key)) return cors(json({ error: "Usernames are 3 to 60 letters or numbers, with no spaces. Dots, dashes and @ are OK, so your email works." }, 400));
    const stub = env.LIB.get(env.LIB.idFromName("acct:" + key));
    return cors(await stub.fetch("https://lib/", { method: "POST", body: JSON.stringify({ ...body, display: body.user, user: key }) }));
  }

  // Import a Google Sheet (shared "Anyone with the link can view", or File → Share → Publish to web) as CSV.
  // School accounts often can't share outside the district; host.js then reads the sheet in the teacher's own browser.
  if (path === "/api/sheet") {
    const link = url.searchParams.get("url") || "";
    const pub = (link.match(/\/spreadsheets\/d\/e\/([\w-]{20,})/) || [])[1];
    const id = pub ? null : (link.match(/\/spreadsheets\/d\/([\w-]{20,})/) || [])[1];
    if (!id && !pub) return json({ error: "That doesn't look like a Google Sheets link." }, 400);
    const gid = (link.match(/[#&?]gid=(\d+)/) || [])[1];
    const src = pub
      ? `https://docs.google.com/spreadsheets/d/e/${pub}/pub?output=csv${gid ? `&single=true&gid=${gid}` : ""}`
      : `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid ? `&gid=${gid}` : ""}`; // no gid = first tab
    let r;
    try { r = await fetch(src, { redirect: "follow" }); }
    catch { return json({ error: "Couldn't reach Google Sheets. Try again, or copy the rows and paste them instead." }, 502); }
    const type = r.headers.get("content-type") || "";
    if (!r.ok || !/csv|text\/plain/.test(type)) {
      if (/rtpof=true/.test(link)) return json({ error: "That's an Excel file stored in Google Drive. Open it, click File → Save as Google Sheets, and use the new sheet's link." }, 400);
      return json({ private: true, error: "Couldn't open the sheet. In Google Sheets click Share → General access → “Anyone with the link” (Viewer), then try again." }, 400);
    }
    const text = await r.text();
    return new Response(text.slice(0, 2_000_000), { headers: { "content-type": "text/csv; charset=utf-8", "cache-control": "no-store" } });
  }

  return json({ error: "Not found" }, 404);
}

function cors(res) {
  const h = new Headers(res.headers);
  h.set("access-control-allow-origin", "*");
  h.set("access-control-allow-methods", "POST, OPTIONS");
  h.set("access-control-allow-headers", "content-type");
  h.set("access-control-max-age", "86400");
  return new Response(res.body, { status: res.status, headers: h });
}
