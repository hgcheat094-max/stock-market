// One AI call for the whole app. Uses the FREE Google Gemini API when GEMINI_API_KEY is set,
// otherwise falls back to Anthropic when ANTHROPIC_API_KEY is set.
const clean = v => (v || "").trim().replace(/^["']|["']$/g, ""); // tolerate stray spaces, newlines or quotes
const GK = clean(process.env.GEMINI_API_KEY), AK = clean(process.env.ANTHROPIC_API_KEY);
export const hasLLM = !!(GK || AK);

export async function askJSON(prompt, image, maxTokens = 500) { // image: JPEG data URL or null
  const b64 = image ? image.split(",")[1] : null;
  let t;
  if (GK) {
    const m = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const gen = { responseMimeType: "application/json", ...(/2\.5/.test(m) && !/pro/.test(m) ? { thinkingConfig: { thinkingBudget: 0 } } : {}) };
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
      method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": GK },
      body: JSON.stringify({ contents: [{ parts: [...(b64 ? [{ inline_data: { mime_type: "image/jpeg", data: b64 } }] : []), { text: prompt }] }], generationConfig: gen }) });
    if (!r.ok) { console.error("Gemini API", r.status, (await r.text()).slice(0, 300)); throw new Error("api " + r.status); }
    t = (await r.json()).candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
  } else {
    const content = [...(b64 ? [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } }] : []), { type: "text", text: prompt }];
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST",
      headers: { "content-type": "application/json", "x-api-key": AK, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-haiku-5-5", max_tokens: maxTokens, messages: [{ role: "user", content }] }) });
    if (!r.ok) { console.error("Anthropic API", r.status, (await r.text()).slice(0, 300)); throw new Error("api " + r.status); }
    t = (await r.json()).content?.find(c => c.type === "text")?.text || "";
  }
  try { return JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)); }
  catch { console.error("Unparseable reply:", t.slice(0, 300)); throw new Error("parse"); }
}
