
const crypto = require("crypto");

function verifyTelegram(initData, token) {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  const authDate = Number(params.get("auth_date"));

  if (!hash || !authDate) return null;
  if (Math.abs(Date.now() / 1000 - authDate) > 86400) return null;

  const entries = [...params.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => a.localeCompare(b));

  const dataCheckString = entries
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(token)
    .digest();

  const calculatedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(calculatedHash, "hex");

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }

  try {
    return JSON.parse(params.get("user") || "null");
  } catch {
    return null;
  }
}

const plans = {
  "1_month": { price: 160 },
  "3_months": { price: 449 },
  "6_months": { price: 849 },
  "12_months": { price: 1599 }
};

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  let subscriptionId;
  let paymentId;
  let base;
  let headers;

  try {
    const token = process.env.BOT_TOKEN;
    const url = process.env.SUPABASE_URL;
    const dbKey = process.env.SUPABASE_SECRET_KEY;
    const shopId = process.env.YOOKASSA_SHOP_ID;
    const secretKey = process.env.YOOKASSA_SECRET_KEY;

    if (!token || !url || !dbKey || !shopId || !secretKey) {
      throw new Error("Server environment variables missing");
    }

    const { initData, planCode } = req.body || {};

    if (typeof initData !== "string") {
      return res.status(401).json({ error: "Missing Telegram data" });
    }

    const telegramUser = verifyTelegram(initData, token);

    if (!telegramUser?.id) {
      return res.status(401).json({ error: "Invalid Telegram data" });
    }

    const plan = plans[planCode];

    if (!plan) {
      return res.status(400).json({ error: "Invalid tariff" });
    }

    base = url.replace(/\/+$/, "");

    headers = {
      apikey: dbKey,
      Authorization: `Bearer ${dbKey}`,
      "Content-Type": "application/json"
    };

    const userResponse = await fetch(
      `${base}/rest/v1/users?telegram_id=eq.${telegramUser.id}&select=id&limit=1`,
      { headers }
    );

    if (!userResponse.ok) throw new Error("Could not load user");

    const users = await userResponse.json();

    if (!users.length) {
      return res.status(404).json({
        error: "User not found. Send /start to the bot."
      });
    }

    const userId = users[0].id;

    const subResponse = await fetch(
      `${base}/rest/v1/subscriptions`,
      {
        method: "POST",
        headers: {
          ...headers,
          Prefer: "return=representation"
        },
        body: JSON.stringify({
          user_id: userId,
          plan_code: planCode,
          status: "pending"
        })
      }
    );

    if (!subResponse.ok) throw new Error("Could not create subscription");

    const subscriptions = await subResponse.json();
    subscriptionId = subscriptions[0]?.id;

    if (!subscriptionId) throw new Error("Subscription was not created");

    const paymentResponse = await fetch(
      `${base}/rest/v1/payments`,
      {
        method: "POST",
        headers: {
          ...headers,
          Prefer: "return=representation"
        },
        body: JSON.stringify({
          user_id: userId,
          amount: plan.price,
          currency: "RUB",
          provider: "yookassa",
          status: "pending"
        })
      }
    );

    if (!paymentResponse.ok) {
      throw new Error("Could not create payment record");
    }

    const payments = await paymentResponse.json();
    paymentId = payments[0]?.id;

    if (!paymentId) throw new Error("Payment record was not created");

    const yooResponse = await fetch(
      "https://api.yookassa.ru/v3/payments",
      {
        method: "POST",
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(`${shopId}:${secretKey}`).toString("base64"),
          "Idempotence-Key": crypto.randomUUID(),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          amount: {
            value: plan.price.toFixed(2),
            currency: "RUB"
          },
          capture: true,
          confirmation: {
            type: "redirect",
            return_url: "https://ippivpn.vercel.app/"
          },
          description: `ippi VPN — тариф ${planCode}`,
          metadata: {
            subscription_id: String(subscriptionId),
            payment_id: String(paymentId),
            telegram_id: String(telegramUser.id)
          }
        })
      }
    );

    const yooPayment = await yooResponse.json();

    if (!yooResponse.ok) {
      console.error("YooKassa error:", yooPayment);
      throw new Error("YooKassa payment creation failed");
    }

    const confirmationUrl = yooPayment.confirmation?.confirmation_url;

    if (!confirmationUrl || !yooPayment.id) {
      throw new Error("YooKassa did not return payment URL");
    }

    const updateResponse = await fetch(
      `${base}/rest/v1/payments?id=eq.${paymentId}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          external_payment_id: yooPayment.id
        })
      }
    );

    if (!updateResponse.ok) {
      throw new Error("Could not save external payment ID");
    }

    return res.status(200).json({
      success: true,
      subscriptionId,
      paymentId,
      amount: plan.price,
      currency: "RUB",
      confirmationUrl
    });

  } catch (error) {
    console.error("Create order error:", error.message);

    if (base && headers) {
      if (paymentId) {
        await fetch(
          `${base}/rest/v1/payments?id=eq.${paymentId}`,
          { method: "DELETE", headers }
        ).catch(() => {});
      }

      if (subscriptionId) {
        await fetch(
          `${base}/rest/v1/subscriptions?id=eq.${subscriptionId}`,
          { method: "DELETE", headers }
        ).catch(() => {});
      }
    }

    return res.status(500).json({
      error: "Не удалось создать платёж. Попробуйте позже."
    });
  }
};
