import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import pg from "pg";

const { BOT_TOKEN, DATABASE_URL, PORT = 3000 } = process.env;
if (!BOT_TOKEN || !DATABASE_URL) throw new Error("Set BOT_TOKEN and DATABASE_URL");

const APP_URL = "https://farm-empire-mini-app-production.up.railway.app";
const WEBHOOK_PATH = "/api/telegram/webhook";
const WEBHOOK_URL = APP_URL + WEBHOOK_PATH;
const WEBHOOK_SECRET = crypto.createHmac("sha256", BOT_TOKEN).update("farm-empire-webhook-v1").digest("hex");
const PACKAGES = new Map([[50, { stars: 50, price: 50 }], [130, { stars: 150, price: 130 }], [400, { stars: 500, price: 400 }]]);

const db = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: /railway|render|neon|supabase/.test(DATABASE_URL) ? { rejectUnauthorized: false } : undefined,
});
await db.query(fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));

const page = fs
  .readFileSync(new URL("./public/index.html", import.meta.url), "utf8")
  .replace("<!--CFG-->", '<script>window.FE_API="/api"</script>')
  .replace("</body>", `<script>
(() => {
  const tg = window.Telegram && window.Telegram.WebApp;
  let paymentStarted = false;
  let lastPaymentTap = 0;
  const packages = {50:50, 130:150, 400:500};
  function findPackage(target) {
    let el = target instanceof Element ? target : target && target.parentElement;
    for (let i = 0; el && i < 9; i++, el = el.parentElement) {
      const value = (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim();
      if (!/Купить/i.test(value) || !/Telegram\\s*Stars/i.test(value)) continue;
      const match = value.match(/(50|130|400)\\s*Telegram\\s*Stars/i);
      if (match && packages[Number(match[1])]) return Number(match[1]);
    }
    return null;
  }
  async function buy(price) {
    if (paymentStarted) return;
    paymentStarted = true;
    try {
      if (!tg || !tg.initData) throw new Error("Открой игру через Telegram");
      const response = await fetch("/api/stars/invoice", {
        method: "POST",
        headers: {"Content-Type":"application/json","Authorization":"tma " + tg.initData},
        body: JSON.stringify({price_xtr: price})
      });
      const data = await response.json();
      if (!response.ok || !data.invoice_url) throw new Error(data.error || "Не удалось создать счёт");
      tg.openInvoice(data.invoice_url, status => {
        paymentStarted = false;
        if (status === "paid") {
          try { tg.HapticFeedback && tg.HapticFeedback.notificationOccurred("success"); } catch {}
          window.location.reload();
        }
      });
    } catch (error) {
      paymentStarted = false;
      alert(error.message || "Ошибка оплаты");
    }
  }
  function intercept(event) {
    const price = findPackage(event.target);
    if (!price) return;
    const now = Date.now();
    if (event.type === "click" && now - lastPaymentTap < 1500) {
      event.preventDefault(); event.stopImmediatePropagation(); return;
    }
    lastPaymentTap = now;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    buy(price);
  }
  document.addEventListener("pointerup", intercept, true);
  document.addEventListener("click", intercept, true);
})();
document.addEventListener("click",e=>{const el=e.target instanceof Element?e.target:e.target?.parentElement;const node=el?.closest("[data-a]");if(!node)return;setTimeout(()=>{if(!node.isConnected)return;const opts={bubbles:true,cancelable:true,clientX:e.clientX,clientY:e.clientY,pointerId:1,pointerType:"mouse",isPrimary:true};node.dispatchEvent(new PointerEvent("pointerdown",opts));node.dispatchEvent(new PointerEvent("pointerup",opts));},0)},true);
</script></body>`)
  .replace("</body>", `<script>
(() => {
  const tg = window.Telegram && window.Telegram.WebApp;
  if (!tg || !tg.initData) return;
  let balance = 0, busy = false, lastHandled = 0;
  const authHeaders = {"Content-Type":"application/json","Authorization":"tma " + tg.initData};
  function button() {
    const nodes = [...document.querySelectorAll("button,[role=button],[data-a],div")];
    return nodes.filter(el => /Вывести\\s*\(от\\s*50/i.test((el.innerText || el.textContent || "").trim()) &&
      (el.innerText || el.textContent || "").trim().length < 90)
      .sort((a,b) => (a.innerText || a.textContent || "").length - (b.innerText || b.textContent || "").length)[0];
  }
  async function refresh() {
    try {
      const r = await fetch("/api/stars/balance", {headers:authHeaders});
      const d = await r.json();
      if (!r.ok) return;
      balance = Number(d.stars || 0);
      const b = button();
      if (b) {
        const enabled = balance >= 50;
        b.style.opacity = enabled ? "1" : ".55";
        b.style.filter = enabled ? "none" : "grayscale(.45)";
        b.setAttribute("aria-disabled", enabled ? "false" : "true");
        if ("disabled" in b) b.disabled = !enabled;
        b.title = enabled ? "Доступно к выводу: " + balance + " звёзд" : "Для вывода нужно минимум 50 звёзд";
      }
      document.querySelectorAll("body *").forEach(el => {
        if (el.children.length === 0 && /Выводимые звёзды:/i.test(el.textContent || "")) {
          el.textContent = "Выводимые звёзды: " + balance + " ★";
        }
      });
    } catch {}
  }
  async function requestWithdrawal() {
    if (busy) return;
    busy = true;
    try {
      await refresh();
      if (balance < 50) { alert("Для вывода нужно минимум 50 игровых звёзд."); return; }
      const raw = prompt("Сколько игровых звёзд вывести? Доступно: " + balance, String(balance));
      if (raw === null) return;
      const amount = Math.floor(Number(raw));
      if (!Number.isSafeInteger(amount) || amount < 50 || amount > balance) {
        alert("Укажи сумму от 50 до " + balance + " звёзд."); return;
      }
      const destination = prompt("Укажи свой Telegram @username или ID для ручной выплаты:");
      if (!destination || !destination.trim()) return;
      const r = await fetch("/api/stars/withdrawal", {
        method:"POST", headers:authHeaders,
        body:JSON.stringify({amount,destination:destination.trim()})
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error === "insufficient_stars" ? "Недостаточно звёзд на балансе." : (d.message || "Не удалось создать заявку."));
      alert("Заявка на вывод #" + d.request_id + " создана. " + amount + " звёзд зарезервировано. Выплата будет выполнена вручную.");
      await refresh();
      location.reload();
    } catch(e) { alert(e.message || "Ошибка заявки на вывод"); }
    finally { busy = false; }
  }
  function intercept(e) {
    const el = e.target instanceof Element ? e.target : e.target?.parentElement;
    const target = el?.closest("button,[role=button],[data-a],div");
    if (!target || !/Вывести\\s*\(от\\s*50/i.test((target.innerText || target.textContent || "").trim())) return;
    if (Date.now() - lastHandled < 1200) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    lastHandled = Date.now();
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    requestWithdrawal();
  }
  document.addEventListener("pointerup", intercept, true);
  document.addEventListener("click", intercept, true);
  refresh();
  setTimeout(refresh, 900);
})();
</script></body>`);

function verify(header) {
  const raw = (header || "").replace(/^tma /, "");
  const p = new URLSearchParams(raw);
  const hash = p.get("hash");
  if (!hash) return null;
  p.delete("hash");
  const check = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const calc = crypto.createHmac("sha256", secret).update(check).digest("hex");
  if (calc.length !== hash.length || !crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(hash))) return null;
  if (Date.now() / 1000 - Number(p.get("auth_date")) > 86400) return null;
  try { return JSON.parse(p.get("user")); } catch { return null; }
}

const auth = (req, res, next) => {
  const u = verify(req.get("authorization"));
  if (!u || !u.id) return res.status(401).json({ error: "bad_auth" });
  req.u = u;
  next();
};
const wrap = (f) => (req, res, next) => Promise.resolve(f(req, res)).catch(next);
async function telegram(method, body) {
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.description || `Telegram API ${method} failed`);
  return data.result;
}
async function ensureWallet(tgId) {
  await db.query(
    "insert into star_wallets(tg_id,balance) values($1,coalesce((select case when (state->>'stars') ~ '^[0-9]+$' then (state->>'stars')::integer else 0 end from players where tg_id=$1),0)) on conflict(tg_id) do nothing",
    [tgId]
  );
}
const app = express();
app.use(express.json({ limit: "300kb" }));

app.get("/", (_q, r) => r.type("html").send(page));
app.get("/health", (_q, r) => r.json({ ok: true }));

app.post(WEBHOOK_PATH, async (req, res) => {
  if (req.get("x-telegram-bot-api-secret-token") !== WEBHOOK_SECRET) return res.sendStatus(401);
  const update = req.body || {};
  try {
    if (update.pre_checkout_query) {
      const q = update.pre_checkout_query;
      const { rows } = await db.query(
        "select tg_id, price_xtr, currency, status from star_orders where invoice_payload=$1",
        [q.invoice_payload]
      );
      const ok = !!rows[0] && String(rows[0].tg_id) === String(q.from.id) &&
        rows[0].price_xtr === q.total_amount && rows[0].currency === q.currency && rows[0].status === "pending";
      await telegram("answerPreCheckoutQuery", {
        pre_checkout_query_id: q.id,
        ok,
        ...(!ok ? { error_message: "Счёт недействителен или уже использован. Создайте новую покупку." } : {})
      });
    }

    const message = update.message;
    const payment = message && message.successful_payment;
    if (payment) {
      const client = await db.connect();
      try {
        await client.query("begin");
        const orderResult = await client.query(
          "select * from star_orders where invoice_payload=$1 for update", [payment.invoice_payload]
        );
        const order = orderResult.rows[0];
        if (!order || String(order.tg_id) !== String(message.from.id) ||
            payment.currency !== "XTR" || payment.total_amount !== order.price_xtr) {
          await client.query("rollback");
          console.error("Unmatched successful Telegram payment", payment.telegram_payment_charge_id);
          return res.sendStatus(200);
        }
        if (order.status === "paid") {
          await client.query("commit");
          return res.sendStatus(200);
        }
        await client.query(
          "insert into star_wallets(tg_id) values($1) on conflict(tg_id) do nothing", [order.tg_id]
        );
        const wallet = await client.query(
          "update star_wallets set balance=balance+$2, updated_at=now() where tg_id=$1 returning balance",
          [order.tg_id, order.product_stars]
        );
        await client.query(
          `update star_orders set status='paid', telegram_payment_charge_id=$2,
           provider_payment_charge_id=$3, paid_at=now() where id=$1`,
          [order.id, payment.telegram_payment_charge_id, payment.provider_payment_charge_id || null]
        );
        await client.query(
          `insert into star_transactions(tg_id,order_id,kind,amount,balance_after,note)
           values($1,$2,'purchase',$3,$4,'Telegram Stars payment')`,
          [order.tg_id, order.id, order.product_stars, wallet.rows[0].balance]
        );
        await client.query("commit");
        console.log("Telegram Stars purchase credited", { tgId: order.tg_id, stars: order.product_stars });
      } catch (e) {
        await client.query("rollback").catch(() => {});
        throw e;
      } finally { client.release(); }
    }

    const refunded = message && message.refunded_payment;
    if (refunded) {
      const client = await db.connect();
      try {
        await client.query("begin");
        const found = await client.query(
          "select * from star_orders where telegram_payment_charge_id=$1 for update",
          [refunded.telegram_payment_charge_id]
        );
        const order = found.rows[0];
        if (order && order.status === "paid") {
          const wallet = await client.query(
            "update star_wallets set balance=greatest(0,balance-$2), updated_at=now() where tg_id=$1 returning balance",
            [order.tg_id, order.product_stars]
          );
          await client.query("update star_orders set status='refunded' where id=$1", [order.id]);
          await client.query(
            `insert into star_transactions(tg_id,order_id,kind,amount,balance_after,note)
             values($1,$2,'refund',$3,$4,'Telegram payment refund')`,
            [order.tg_id, order.id, -order.product_stars, wallet.rows[0].balance]
          );
        }
        await client.query("commit");
      } catch (e) {
        await client.query("rollback").catch(() => {});
        throw e;
      } finally { client.release(); }
    }
    return res.sendStatus(200);
  } catch (e) {
    console.error("Telegram webhook processing:", e);
    return res.sendStatus(500);
  }
});

app.get("/api/load", auth, wrap(async (req, res) => {
  await ensureWallet(req.u.id);
  const [player, wallet] = await Promise.all([
    db.query("select state, extract(epoch from updated_at)*1000 as ts from players where tg_id=$1", [req.u.id]),
    db.query("select balance from star_wallets where tg_id=$1", [req.u.id])
  ]);
  const stars = wallet.rows[0]?.balance || 0;
  const state = player.rows[0]?.state ?? null;
  if (state) state.stars = stars;
  res.json({ state, ts: player.rows[0] ? Number(player.rows[0].ts) : 0, stars });
}));

app.post("/api/save", auth, wrap(async (req, res) => {
  const s = req.body && req.body.state;
  if (!s || typeof s !== "object" || Array.isArray(s)) return res.status(400).json({ error: "bad_state" });
  await ensureWallet(req.u.id);
  const wallet = await db.query("select balance from star_wallets where tg_id=$1", [req.u.id]);
  const safeState = { ...s, stars: wallet.rows[0]?.balance || 0 };
  await db.query(
    `insert into players(tg_id,name,state) values($1,$2,$3)
     on conflict(tg_id) do update set name=$2, state=$3, updated_at=now()`,
    [req.u.id, req.u.first_name || "", safeState]);
  res.json({ ok: true, stars: safeState.stars });
}));

app.post("/api/stars/invoice", auth, wrap(async (req, res) => {
  const price = Number(req.body && req.body.price_xtr);
  const product = PACKAGES.get(price);
  if (!product) return res.status(400).json({ error: "invalid_package" });
  await ensureWallet(req.u.id);
  const id = crypto.randomUUID();
  const payload = `farm-empire-stars:${id}`;
  await db.query(
    "insert into star_orders(id,tg_id,product_stars,price_xtr,invoice_payload) values($1,$2,$3,$4,$5)",
    [id, req.u.id, product.stars, product.price, payload]
  );
  try {
    const invoiceUrl = await telegram("createInvoiceLink", {
      title: `${product.stars} игровых звёзд`,
      description: `Пополнение баланса Farm Empire на ${product.stars} звёзд`,
      payload,
      provider_token: "",
      currency: "XTR",
      prices: [{ label: `${product.stars} звёзд Farm Empire`, amount: product.price }]
    });
    res.json({ invoice_url: invoiceUrl, order_id: id, stars: product.stars, price_xtr: product.price });
  } catch (e) {
    await db.query("update star_orders set status='expired' where id=$1", [id]);
    throw e;
  }
}));

app.post("/api/stars/refund", auth, wrap(async (req, res) => {
  const orderId = String(req.body && req.body.order_id || "");
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return res.status(400).json({ error: "invalid_order_id" });
  const { rows } = await db.query(
    "select id, telegram_payment_charge_id, status from star_orders where id=$1 and tg_id=$2",
    [orderId, req.u.id]
  );
  const order = rows[0];
  if (!order || order.status !== "paid" || !order.telegram_payment_charge_id)
    return res.status(400).json({ error: "order_not_refundable" });
  await telegram("refundStarPayment", {
    user_id: req.u.id,
    telegram_payment_charge_id: order.telegram_payment_charge_id
  });
  const client = await db.connect();
  try {
    await client.query("begin");
    const locked = await client.query("select * from star_orders where id=$1 for update", [orderId]);
    if (locked.rows[0]?.status === "paid") {
      const wallet = await client.query(
        "update star_wallets set balance=greatest(0,balance-$2),updated_at=now() where tg_id=$1 returning balance",
        [req.u.id, locked.rows[0].product_stars]
      );
      await client.query("update star_orders set status='refunded' where id=$1", [orderId]);
      await client.query(
        `insert into star_transactions(tg_id,order_id,kind,amount,balance_after,note)
         values($1,$2,'refund',$3,$4,'User requested Telegram Stars refund')`,
        [req.u.id, orderId, -locked.rows[0].product_stars, wallet.rows[0].balance]
      );
    }
    await client.query("commit");
    res.json({ ok: true, status: "refunded" });
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally { client.release(); }
}));

app.get("/api/stars/balance", auth, wrap(async (req, res) => {
  await ensureWallet(req.u.id);
  const { rows } = await db.query(
    "select balance, withdrawable from star_wallets where tg_id=$1", [req.u.id]
  );
  res.json({ stars: rows[0].balance, withdrawable_stars: rows[0].withdrawable });
}));

app.get("/api/stars/history", auth, wrap(async (req, res) => {
  const { rows } = await db.query(
    "select kind, amount, balance_after, note, created_at from star_transactions where tg_id=$1 order by id desc limit 50",
    [req.u.id]
  );
  res.json({ transactions: rows });
}));

app.post("/api/stars/withdrawal", auth, wrap(async (req, res) => {
  const amount = Math.floor(Number(req.body && req.body.amount));
  const destination = String(req.body && req.body.destination || "").trim().slice(0, 256);
  if (!Number.isSafeInteger(amount) || amount < 50 || !destination)
    return res.status(400).json({ error: "minimum_50_and_destination_required" });
  const client = await db.connect();
  try {
    await client.query("begin");
    await ensureWallet(req.u.id);
    const { rows } = await client.query("select balance from star_wallets where tg_id=$1 for update", [req.u.id]);
    const balance = Number(rows[0]?.balance || 0);
    if (balance < 50 || amount > balance) {
      await client.query("rollback");
      return res.status(400).json({ error: "insufficient_stars", balance, minimum: 50 });
    }
    const updated = await client.query(
      "update star_wallets set balance=balance-$2,updated_at=now() where tg_id=$1 returning balance",
      [req.u.id, amount]
    );
    const id = crypto.randomUUID();
    await client.query(
      "insert into star_withdrawal_requests(id,tg_id,amount,destination) values($1,$2,$3,$4)",
      [id, req.u.id, amount, destination]
    );
    await client.query(
      `insert into star_transactions(tg_id,kind,amount,balance_after,note)
       values($1,'withdrawal_request',$2,$3,$4)`,
      [req.u.id, -amount, updated.rows[0].balance, `Manual withdrawal request ${id}`]
    );
    await client.query("commit");
    res.json({ ok: true, request_id: id, status: "pending", balance: updated.rows[0].balance });
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally { client.release(); }
}));

app.use((e, _q, res, _n) => {
  console.error(e);
  if (!res.headersSent) res.status(500).json({ error: "server", message: "Внутренняя ошибка сервера" });
});

app.listen(PORT, async () => {
  console.log("Farm Empire on :" + PORT);
  try {
    await telegram("setWebhook", {
      url: WEBHOOK_URL,
      secret_token: WEBHOOK_SECRET,
      allowed_updates: ["message", "pre_checkout_query"],
      drop_pending_updates: false
    });
    console.log("Telegram payment webhook configured");
  } catch (e) {
    console.error("Telegram webhook setup failed:", e.message);
  }
});
