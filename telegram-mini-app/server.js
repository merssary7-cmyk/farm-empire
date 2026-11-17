import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import pg from "pg";

const { BOT_TOKEN, DATABASE_URL, PORT = 3000 } = process.env;
if (!BOT_TOKEN || !DATABASE_URL) throw new Error("Set BOT_TOKEN and DATABASE_URL");

const db = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: /railway|render|neon|supabase/.test(DATABASE_URL) ? { rejectUnauthorized: false } : undefined,
});
await db.query(fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));

const page = fs.readFileSync(new URL("./public/index.html", import.meta.url), "utf8")
  .replace("<!--CFG-->", '<script>window.FE_API="/api"</script>');

function verify(header) {
  const raw = (header || "").replace(/^tma /, "");
  const p = new URLSearchParams(raw);
  const hash = p.get("hash");
  const authDate = Number(p.get("auth_date"));
  const now = Math.floor(Date.now() / 1000);
  if (!hash || !Number.isFinite(authDate) || authDate > now + 60 || now - authDate > 86400) return null;
  p.delete("hash");
  const check = [...p.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const calc = crypto.createHmac("sha256", secret).update(check).digest("hex");
  const a = Buffer.from(calc, "hex"), b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { return JSON.parse(p.get("user") || "null"); } catch { return null; }
}

const auth = (req, res, next) => {
  const user = verify(req.get("authorization"));
  if (!user?.id) return res.status(401).json({ error: "bad_auth" });
  req.user = user;
  next();
};
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "300kb" }));
app.get("/", (_req, res) => res.type("html").send(page));
app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/api/load", auth, wrap(async (req, res) => {
  const { rows } = await db.query(
    "select state, extract(epoch from updated_at)*1000 as ts from players where tg_id=$1",
    [req.user.id]
  );
  res.json(rows[0] ? { state: rows[0].state, ts: Number(rows[0].ts) } : { state: null, ts: 0 });
}));

app.post("/api/save", auth, wrap(async (req, res) => {
  const state = req.body?.state;
  if (!state || typeof state !== "object" || Array.isArray(state))
    return res.status(400).json({ error: "bad_state" });
  await db.query(
    `insert into players(tg_id,name,state) values($1,$2,$3)
     on conflict(tg_id) do update set name=excluded.name, state=excluded.state, updated_at=now()`,
    [req.user.id, req.user.first_name || "", state]
  );
  res.json({ ok: true });
}));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "server" });
});
app.listen(PORT, "0.0.0.0", () => console.log("Farm Empire Mini App listening on " + PORT));
