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
  if (!hash) return null;
  p.delete("hash");
  const check = [...p.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const calc = crypto.createHmac("sha256", secret).update(check).digest("hex");
  if (calc.length !== hash.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(hash))) return null;
  if (Date.now() / 1000 - Number(p.get("auth_date")) > 86400) return null;
  try { return JSON.parse(p.get("user")); } catch { return null; }
}

const auth = (req, res, next) => {
  const u = verify(req.get("authorization"));
  if (!u || !u.id) return res.status(401).json({ error: "bad_auth" });
  req.u = u;
  next();
};
const wrap = (f) => (req, res, next) => f(req, res).catch(next);

const app = express();
app.use(express.json({ limit: "300kb" }));
app.get("/", (_q, r) => r.type("html").send(page));
app.get("/health", (_q, r) => r.json({ ok: true }));

app.get("/api/load", auth, wrap(async (req, res) => {
  const { rows } = await db.query(
    "select state, extract(epoch from updated_at)*1000 as ts from players where tg_id=$1", [req.u.id]);
  res.json(rows[0] ? { state: rows[0].state, ts: Number(rows[0].ts) } : { state: null, ts: 0 });
}));

app.post("/api/save", auth, wrap(async (req, res) => {
  const s = req.body && req.body.state;
  if (!s || typeof s !== "object" || Array.isArray(s)) return res.status(400).json({ error: "bad_state" });
  await db.query(
    `insert into players(tg_id,name,state) values($1,$2,$3)
     on conflict(tg_id) do update set name=$2, state=$3, updated_at=now()`,
    [req.u.id, req.u.first_name || "", s]);
  res.json({ ok: true });
}));

app.use((e, _q, res, _n) => { console.error(e); res.status(500).json({ error: "server" }); });
app.listen(PORT, "0.0.0.0", () => console.log("Farm Empire on :" + PORT));
