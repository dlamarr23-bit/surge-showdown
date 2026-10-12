// Teacher accounts: saved question sets that follow the teacher to any computer.
// One Durable Object per account (named "acct:<username>") holds the password hash,
// the sign-in tokens and the saved sets. It uses the plain fetch() style (no
// "cloudflare:workers" import) so it can also be tested in a normal browser.
import { json, sanitizeQuestions, questionsForHost } from "./shared.js";

const ITER = 20000;           // PBKDF2 rounds: about 4 ms, under the free plan's 10 ms CPU limit (the lockout below stops guessing)
const MAX_SETS = 300;         // saved sets per account
const MAX_TOKENS = 20;        // computers that can stay signed in at once
const enc = new TextEncoder();
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
const randHex = (n) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return hex(a); };
const sha = async (s) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
const sameText = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
async function hashPassword(pw, saltHex, iterations = ITER) {
  const key = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}

// Usernames are case-insensitive: "MrLaMarr" and "mrlamarr" are the same account.
export const userKey = (u) => String(u || "").trim().toLowerCase();
export const validUser = (k) => /^[a-z0-9][a-z0-9._@+-]{2,59}$/.test(k);
const setName = (n) => String(n || "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
const cleanSet = (qs) => questionsForHost(sanitizeQuestions(qs));

export class Library {
  constructor(state, env) {
    this.storage = state.storage;
  }

  async fetch(request) {
    let b = {};
    try { b = await request.json(); } catch {}
    try { return await this.handle(b); }
    catch (e) { return json({ error: "Something went wrong with your account. Try again." }, 500); }
  }

  async handle(b) {
    const acct = await this.storage.get("acct");
    const pw = String(b.password || "");

    if (b.action === "create") {
      if (acct) return json({ error: "That username is taken. If it's yours, click Sign in instead. Otherwise pick another username." }, 409);
      if (pw.length < 6) return json({ error: "Use a password with at least 6 characters." }, 400);
      if (pw.length > 200) return json({ error: "That password is too long." }, 400);
      const salt = randHex(16);
      const a = { user: String(b.display || b.user).trim().slice(0, 60), salt, iter: ITER, hash: await hashPassword(pw, salt), created: Date.now(), tokens: [], fails: 0, lockUntil: 0 };
      const token = await this.newToken(a);
      await this.storage.put("acct", a);
      return json({ user: a.user, token, sets: [] });
    }

    if (!acct) return json({ error: "No account with that username. Check the spelling, or create an account." }, 404);

    if (b.action === "login") {
      const now = Date.now();
      if (acct.lockUntil > now) return json({ error: `Too many wrong passwords. Wait ${Math.ceil((acct.lockUntil - now) / 60000)} minute(s) and try again.` }, 429);
      if (!pw || !sameText(await hashPassword(pw, acct.salt, acct.iter || ITER), acct.hash)) {
        acct.fails = (acct.fails || 0) + 1;
        if (acct.fails >= 5) acct.lockUntil = now + 60000 * 2 ** Math.min(acct.fails - 5, 6); // 1 min, then 2, 4 ... up to 64
        await this.storage.put("acct", acct);
        return json({ error: "Wrong password." }, 401);
      }
      acct.fails = 0; acct.lockUntil = 0;
      const token = await this.newToken(acct);
      await this.storage.put("acct", acct);
      return json({ user: acct.user, token, sets: await this.allSets() });
    }

    // everything below needs a sign-in token
    const th = await sha(String(b.token || ""));
    if (!b.token || !acct.tokens.some((t) => sameText(t.h, th))) return json({ error: "You were signed out. Please sign in again.", signedOut: true }, 401);

    if (b.action === "sets") return json({ user: acct.user, sets: await this.allSets() });

    if (b.action === "save") {
      const name = setName(b.name);
      if (!name) return json({ error: "Give the set a name first." }, 400);
      const questions = cleanSet(b.questions);
      if (!questions.length) return json({ error: "No questions to save." }, 400);
      if (!(await this.storage.get("set:" + name)) && (await this.setCount()) >= MAX_SETS) return json({ error: `Your account is full (${MAX_SETS} sets). Delete a set you don't need, then save again.` }, 400);
      await this.storage.put("set:" + name, { name, questions, updated: Date.now() });
      return json({ name, questions });
    }

    // Copies sets saved on one computer into the account. Sets the account already has are left alone.
    if (b.action === "merge") {
      const incoming = b.sets && typeof b.sets === "object" ? b.sets : {};
      let room = MAX_SETS - (await this.setCount()), added = 0;
      for (const [raw, qs] of Object.entries(incoming).slice(0, MAX_SETS)) {
        const name = setName(raw), questions = cleanSet(qs);
        if (!name || !questions.length || room <= 0 || (await this.storage.get("set:" + name))) continue;
        await this.storage.put("set:" + name, { name, questions, updated: Date.now() });
        room--; added++;
      }
      return json({ added, sets: await this.allSets() });
    }

    if (b.action === "delete") {
      await this.storage.delete("set:" + setName(b.name));
      return json({ ok: true });
    }

    if (b.action === "logout") {
      acct.tokens = acct.tokens.filter((t) => !sameText(t.h, th));
      await this.storage.put("acct", acct);
      return json({ ok: true });
    }

    return json({ error: "Unknown request." }, 400);
  }

  async newToken(acct) {
    const token = randHex(24);
    acct.tokens = [...(acct.tokens || []), { h: await sha(token), at: Date.now() }].slice(-MAX_TOKENS);
    return token;
  }
  async allSets() {
    const m = await this.storage.list({ prefix: "set:" });
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  async setCount() {
    return (await this.storage.list({ prefix: "set:" })).size;
  }
}
