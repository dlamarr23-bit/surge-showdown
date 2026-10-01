// Cloudflare Pages Function for /surge/api/* and /surge/ws/* (the live game connection).
// Students' Chromebooks only talk to your *.pages.dev address. This function hands the
// request to the game server (the "surge-showdown" Worker) inside Cloudflare's network,
// using the SERVER service binding set up in pages/wrangler.toml.
export const onRequest = ({ request, env }) => {
  if (!env.SERVER) return new Response(JSON.stringify({ error: "Setup isn't finished: the SERVER service binding is missing." }), { status: 500, headers: { "content-type": "application/json" } });
  return env.SERVER.fetch(request);
};
