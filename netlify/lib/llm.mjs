// One AI call for the whole app. Uses the FREE Google Gemini API when a Gemini key is set,
// otherwise falls back to Anthropic when an Anthropic key is set.
//
// Several keys can be used at once. When one key runs out of quota (or is rejected) the next one is tried
// automatically. Set them in Netlify (Site configuration > Environment variables), then redeploy:
//   GEMINI_API_KEYS=key1,key2,key3     (separate with commas, spaces or new lines; up to 10)
// GEMINI_API_KEY (a single key) still works and can be combined with the list.
// Same for Anthropic: ANTHROPIC_API_KEYS. Note: Google's free quota is per Google Cloud PROJECT, not per key,
// so create each Gemini key in a different project (or Google account) or they will share one quota.
const clean = v => (v || "").trim().replace(/^["']|["']$/g, ""); // tolerate stray spaces, newlines or quotes
const keys = (...vals) => [...new Set(vals.flatMap(v => String(v || "").split(/[\s,;]+/)).map(clean).filter(Boolean))].slice(0, 10);
const GKS = keys(process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEYS), AKS = keys(process.env.ANTHROPIC_API_KEY, process.env.ANTHROPIC_API_KEYS);
export const hasLLM = !!(GKS.length || AKS.length);

const cool = new Map(); // key -> time until which it is tried last (quota used up or key rejected)
let turn = 0;
// Round-robin start so the load is spread over all keys; keys that recently failed go to the end of the line.
function order(ks) {
  const s = turn++ % ks.length, rot = ks.map((_, i) => ks[(s + i) % ks.length]), now = Date.now();
  return [...rot.filter(k => (cool.get(k) || 0) <= now), ...rot.filter(k => (cool.get(k) || 0) > now)];
}
// A wrong, revoked or expired key: 401/403, or Google's 400 "API key not valid / expired".
const badKey = e => [401, 403].includes(e.status) || (e.status === 400 && /API_KEY_INVALID|API key (not valid|expired)/i.test(e.body || ""));
// Try the keys one by one. Only quota (429) and bad-key errors move on to the next key.
async function withKeys(ks, call) {
  let quota = false, last;
  for (const k of order(ks)) {
    try { return await call(k); }
    catch (e) {
      if (e.status !== 429 && !badKey(e)) throw e;
      quota ||= e.status === 429; last = e.status === 400 ? new Error("api 403") : e;
      cool.set(k, Date.now() + (e.status !== 429 ? 6e5 : /PerDay/i.test(e.body || "") ? 36e5 : 6e4));
      console.error(`API key #${ks.indexOf(k) + 1} of ${ks.length} skipped (${e.status}), trying the next one`);
    }
  }
  throw quota ? new Error("api 429") : last; // "api 429" = quota used up on every key
}
const httpErr = async (name, r) => { const body = (await r.text()).slice(0, 300); console.error(name, r.status, body); return Object.assign(new Error("api " + r.status), { status: r.status, body }); };

async function gemini(key, prompt, b64) {
  const m = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const gen = { responseMimeType: "application/json", ...(/2\.5/.test(m) && !/pro/.test(m) ? { thinkingConfig: { thinkingBudget: 0 } } : {}) };
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
    method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ contents: [{ parts: [...(b64 ? [{ inline_data: { mime_type: "image/jpeg", data: b64 } }] : []), { text: prompt }] }], generationConfig: gen }) });
  if (!r.ok) throw await httpErr("Gemini API", r);
  return (await r.json()).candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
}

async function claude(key, prompt, b64, maxTokens) {
  const content = [...(b64 ? [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } }] : []), { type: "text", text: prompt }];
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-haiku-5-5", max_tokens: maxTokens, messages: [{ role: "user", content }] }) });
  if (!r.ok) throw await httpErr("Anthropic API", r);
  return (await r.json()).content?.find(c => c.type === "text")?.text || "";
}

export async function askJSON(prompt, image, maxTokens = 500) { // image: JPEG data URL or null
  const b64 = image ? image.split(",")[1] : null;
  const t = GKS.length ? await withKeys(GKS, k => gemini(k, prompt, b64)) : await withKeys(AKS, k => claude(k, prompt, b64, maxTokens));
  try { return JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)); }
  catch { console.error("Unparseable reply:", t.slice(0, 300)); throw new Error("parse"); }
}
