
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

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const token = process.env.BOT_TOKEN;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;

    if (!token || !url || !key) {
      throw new Error("Server environment variables missing");
    }

    const initData = req.body?.initData;
    if (typeof initData !== "string" || !initData) {
      return res.status(401).json({ error: "Missing Telegram data" });
    }

    const telegramUser = verifyTelegram(initData, token);

    if (!telegramUser?.id) {
      return res.status(401).json({ error: "Invalid Telegram data" });
    }

    const headers = {
      apikey: key,
      Authorization: `Bearer ${key}`
    };

    const base = url.replace(/\/+$/, "");

    const userResponse = await fetch(
      `${base}/rest/v1/users?telegram_id=eq.${telegramUser.id}&select=id,telegram_id,username,first_name&limit=1`,
      { headers }
    );

    if (!userResponse.ok) throw new Error("Could not load user");

    const users = await userResponse.json();
    if (!users.length) {
      return res.status(404).json({ error: "User not found. Send /start to the bot." });
    }

    const user = users[0];

    const subResponse = await fetch(
      `${base}/rest/v1/subscriptions?user_id=eq.${user.id}&select=plan_code,status,starts_at,expires_at,created_at&order=created_at.desc&limit=1`,
      { headers }
    );

    if (!subResponse.ok) throw new Error("Could not load subscription");

    const subscriptions = await subResponse.json();

    const paymentResponse = await fetch(
      `${base}/rest/v1/payments?user_id=eq.${user.id}&select=amount,currency,status,created_at&order=created_at.desc&limit=10`,
      { headers }
    );

    if (!paymentResponse.ok) throw new Error("Could not load payments");

    const payments = await paymentResponse.json();

    return res.status(200).json({
      user,
      subscription: subscriptions[0] || null,
      payments
    });
  } catch (error) {
    console.error("Account API error:", error.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};
