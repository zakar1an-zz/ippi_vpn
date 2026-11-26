
const TELEGRAM_API = "https://api.telegram.org";

const PLANS = {
  "1_month": { price: 160, days: 30, title: "1 месяц" },
  "3_months": { price: 449, days: 90, title: "3 месяца" },
  "6_months": { price: 849, days: 180, title: "6 месяцев" },
  "12_months": { price: 1599, days: 365, title: "12 месяцев" }
};

function headers(key, extra = {}) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...extra
  };
}

async function sendTelegram(token, chatId, message) {
  const response = await fetch(
    `${TELEGRAM_API}/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message
      })
    }
  );

  const result = await response.json();

  if (!response.ok || !result.ok) {
    throw new Error("Telegram notification failed");
  }
}

async function getYooPayment(shopId, secret, id) {
  const response = await fetch(
    `https://api.yookassa.ru/v3/payments/${encodeURIComponent(id)}`,
    {
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(`${shopId}:${secret}`).toString("base64")
      }
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error("Could not verify YooKassa payment");
  }

  return data;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    const token = process.env.BOT_TOKEN;
    const supabaseUrl = process.env.SUPABASE_URL;
    const dbKey = process.env.SUPABASE_SECRET_KEY;
    const shopId = process.env.YOOKASSA_SHOP_ID;
    const yooSecret = process.env.YOOKASSA_SECRET_KEY;

    if (!token || !supabaseUrl || !dbKey || !shopId || !yooSecret) {
      throw new Error("Missing environment variables");
    }

    const notification = req.body || {};
    const notifiedPayment = notification.object || {};
    const externalId = notifiedPayment.id;

    if (
      notification.event !== "payment.succeeded" ||
      !externalId
    ) {
      return res.status(200).json({ ok: true, ignored: true });
    }

    // Проверяем платёж напрямую через ЮKassa.
    const yooPayment = await getYooPayment(
      shopId,
      yooSecret,
      externalId
    );

    if (
      yooPayment.status !== "succeeded" ||
      yooPayment.paid !== true
    ) {
      return res.status(200).json({ ok: true, paid: false });
    }

    const base = supabaseUrl.replace(/\/+$/, "");
    const dbHeaders = headers(dbKey);
    const metadata = yooPayment.metadata || {};

    // Находим платёж в нашей базе.
    const paymentQuery = new URLSearchParams({
      external_payment_id: `eq.${externalId}`,
      select: "id,user_id,amount,currency,status,telegram_notified_at"
    });

    const paymentResponse = await fetch(
      `${base}/rest/v1/payments?${paymentQuery}`,
      { headers: dbHeaders }
    );

    if (!paymentResponse.ok) {
      throw new Error("Could not load payment");
    }

    const payments = await paymentResponse.json();
    const payment = payments[0];

    if (!payment) {
      return res.status(200).json({ ok: true, ignored: true });
    }

    if (payment.status !== "pending" && payment.status !== "paid") {
      return res.status(200).json({ ok: true, ignored: true });
    }

    // Проверяем сумму, валюту и идентификаторы.
    if (
      String(metadata.payment_id) !== String(payment.id) ||
      String(metadata.telegram_id || "") === "" ||
      String(yooPayment.amount?.currency) !== "RUB" ||
      String(payment.currency) !== "RUB" ||
      Number(yooPayment.amount?.value) !== Number(payment.amount)
    ) {
      throw new Error("Payment data mismatch");
    }

    const subscriptionId = metadata.subscription_id;

    if (!subscriptionId) {
      throw new Error("Missing subscription ID");
    }

    // Получаем подписку.
    const subQuery = new URLSearchParams({
      id: `eq.${subscriptionId}`,
      user_id: `eq.${payment.user_id}`,
      select: "id,user_id,plan_code,status",
      limit: "1"
    });

    const subResponse = await fetch(
      `${base}/rest/v1/subscriptions?${subQuery}`,
      { headers: dbHeaders }
    );

    if (!subResponse.ok) {
      throw new Error("Could not load subscription");
    }

    const subscriptions = await subResponse.json();
    const subscription = subscriptions[0];

    if (!subscription) {
      throw new Error("Subscription not found");
    }

    const plan = PLANS[subscription.plan_code];

    if (!plan || Number(payment.amount) !== plan.price) {
      throw new Error("Invalid subscription plan or price");
    }

    // Проверяем Telegram ID пользователя.
    const userQuery = new URLSearchParams({
      id: `eq.${payment.user_id}`,
      select: "telegram_id",
      limit: "1"
    });

    const userResponse = await fetch(
      `${base}/rest/v1/users?${userQuery}`,
      { headers: dbHeaders }
    );

    if (!userResponse.ok) {
      throw new Error("Could not load user");
    }

    const users = await userResponse.json();
    const user = users[0];

    if (
      !user ||
      String(user.telegram_id) !== String(metadata.telegram_id)
    ) {
      throw new Error("Telegram user mismatch");
    }

    // Активируем подписку только один раз.
    if (subscription.status === "pending") {
      const activeQuery = new URLSearchParams({
        user_id: `eq.${payment.user_id}`,
        status: "eq.active",
        expires_at: "not.is.null",
        select: "expires_at",
        order: "expires_at.desc",
        limit: "1"
      });

      const activeResponse = await fetch(
        `${base}/rest/v1/subscriptions?${activeQuery}`,
        { headers: dbHeaders }
      );

      if (!activeResponse.ok) {
        throw new Error("Could not check active subscriptions");
      }

      const activeSubscriptions = await activeResponse.json();

      const now = new Date();
      const previousExpiry = activeSubscriptions[0]?.expires_at
        ? new Date(activeSubscriptions[0].expires_at)
        : now;

      const startDate = previousExpiry > now
        ? previousExpiry
        : now;

      const expiryDate = new Date(
        startDate.getTime() +
        plan.days * 24 * 60 * 60 * 1000
      );

      const activateResponse = await fetch(
        `${base}/rest/v1/subscriptions?id=eq.${subscription.id}&status=eq.pending`,
        {
          method: "PATCH",
          headers: headers(dbKey, {
            Prefer: "return=representation"
          }),
          body: JSON.stringify({
            status: "active",
            starts_at: startDate.toISOString(),
            expires_at: expiryDate.toISOString()
          })
        }
      );

      if (!activateResponse.ok) {
        throw new Error("Could not activate subscription");
      }

      const activated = await activateResponse.json();

      if (!activated.length) {
        const check = await fetch(
          `${base}/rest/v1/subscriptions?id=eq.${subscription.id}&select=status`,
          { headers: dbHeaders }
        );

        if (!check.ok) {
          throw new Error("Could not verify subscription");
        }

        const rows = await check.json();

        if (rows[0]?.status !== "active") {
          throw new Error("Subscription activation failed");
        }
      }
    } else if (subscription.status !== "active") {
      return res.status(200).json({ ok: true, ignored: true });
    }

    // Помечаем платёж оплаченным.
    if (payment.status === "pending") {
      const paidResponse = await fetch(
        `${base}/rest/v1/payments?id=eq.${payment.id}&status=eq.pending`,
        {
          method: "PATCH",
          headers: headers(dbKey, {
            Prefer: "return=representation"
          }),
          body: JSON.stringify({
            status: "paid"
          })
        }
      );

      if (!paidResponse.ok) {
        throw new Error("Could not update payment");
      }

      const paidRows = await paidResponse.json();

      if (!paidRows.length) {
        const check = await fetch(
          `${base}/rest/v1/payments?id=eq.${payment.id}&select=status,telegram_notified_at`,
          { headers: dbHeaders }
        );

        if (!check.ok) {
          throw new Error("Could not verify payment status");
        }

        const rows = await check.json();

        if (rows[0]?.status !== "paid") {
          throw new Error("Payment status update failed");
        }

        payment.status = "paid";
        payment.telegram_notified_at =
          rows[0].telegram_notified_at;
      }
    }

    // Отправляем сообщение, если оно ещё не было отправлено.
    if (!payment.telegram_notified_at) {
      await sendTelegram(
        token,
        user.telegram_id,
        `Оплата успешно получена!\n\n` +
        `Подписка ippi VPN «${plan.title}» активирована.`
      );

      const notifyResponse = await fetch(
        `${base}/rest/v1/payments?id=eq.${payment.id}&telegram_notified_at=is.null`,
        {
          method: "PATCH",
          headers: dbHeaders,
          body: JSON.stringify({
            telegram_notified_at: new Date().toISOString()
          })
        }
      );

      if (!notifyResponse.ok) {
        throw new Error("Could not save notification status");
      }
    }

    return res.status(200).json({
      ok: true,
      activated: true
    });

  } catch (error) {
    console.error("YooKassa webhook error:", error.message);

    return res.status(500).json({
      ok: false
    });
  }
};
