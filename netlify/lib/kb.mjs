// Text knowledge base: facts extracted from books/notes (rules, success rates, stop/target guidance).
import { getStore } from "@netlify/blobs";
import { LIB } from "./library.mjs";
const names = LIB.map(p => p[0]);
export const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
const t = (v, n) => String(v ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, n);
let cache = null, at = 0;
export async function loadKB(force) {
  if (!force && cache && Date.now() - at < 30000) return cache;
  const s = getStore("knowledge"), { blobs } = await s.list();
  cache = (await Promise.all(blobs.slice(0, 200).map(b => s.get(b.key, { type: "json" })))).filter(Boolean); at = Date.now();
  return cache;
}
// Validate AI output before storing (untrusted text in, short plain strings out)
export function cleanItems(x) {
  return (Array.isArray(x?.items) ? x.items : []).slice(0, 12).map(i => {
    const raw = t(i?.pattern, 50), hit = names.find(n => n.toLowerCase() === raw.toLowerCase());
    return { pattern: hit || raw, rules: t(i?.rules, 300), reliability: t(i?.reliability, 300), stop: t(i?.stop, 200), target: t(i?.target, 200), notes: t(i?.notes, 300) };
  }).filter(i => slug(i.pattern) && (i.rules || i.reliability || i.stop || i.target || i.notes));
}
