import { getStore } from "@netlify/blobs";
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const txt = (v, n) => String(v ?? "").replace(/[<>]/g, "").trim().slice(0, n);
const pct = v => { v = Number(v); return Number.isFinite(v) && v > 0 && v <= 100 ? +v.toFixed(2) : null; };
const MAX = 1000; let cache = null, at = 0;

export default async (req) => {
  const s = getStore("patterns"), url = new URL(req.url);
  if (req.method === "GET") {
    const id = url.searchParams.get("id");
    if (id) return /^[0-9a-f-]{36}$/.test(id) ? J(await s.get(id, { type: "json" })) : J({ error: "Bad id" }, 400);
    if (!cache || Date.now() - at > 30000) {
      const { blobs } = await s.list();
      const rows = await Promise.all(blobs.slice(0, MAX).map(b => s.get(b.key, { type: "json" })));
      cache = rows.filter(Boolean).map(({ thumb, ...r }) => r); at = Date.now();
    }
    return J(cache);
  }
  if (req.method === "POST") {
    let b; try { b = await req.json(); } catch { return J({ error: "Bad JSON" }, 400); }
    if (b.hp) return J({ ok: true }); // honeypot
    const name = txt(b.name, 40), stop = pct(b.stop), target = pct(b.target);
    const ok = name && ["long", "short"].includes(b.dir) && stop && target && Array.isArray(b.curve) && b.curve.length === 48 &&
      b.curve.every(n => Number.isFinite(n) && Math.abs(n) < 10) && typeof b.thumb === "string" && b.thumb.length < 60000 &&
      /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(b.thumb);
    if (!ok) return J({ error: "Invalid submission" }, 400);
    if ((await s.list()).blobs.length >= MAX) return J({ error: "Database full" }, 507);
    const id = crypto.randomUUID();
    await s.setJSON(id, { id, name, dir: b.dir, asset: txt(b.asset, 30), stop, target,
      outcome: ["target", "stop"].includes(b.outcome) ? b.outcome : "unknown", notes: txt(b.notes, 500),
      curve: b.curve.map(n => +n.toFixed(4)), thumb: b.thumb, t: Date.now() });
    cache = null; return J({ ok: true, id }, 201);
  }
  if (req.method === "DELETE") { // moderation: set ADMIN_TOKEN env var in Netlify
    if (!process.env.ADMIN_TOKEN || req.headers.get("x-admin-token") !== process.env.ADMIN_TOKEN) return J({ error: "Forbidden" }, 403);
    await s.delete(url.searchParams.get("id")); cache = null; return J({ ok: true });
  }
  return J({ error: "Method not allowed" }, 405);
};
export const config = { path: "/api/patterns" };
