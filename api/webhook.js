
const TELEGRAM_API = "https://api.telegram.org";

async function telegram(method, payload) {
  const token = process.env.BOT_TOKEN;
  if (!token) throw new Error("BOT_TOKEN missing");

  const response = await fetch(
    `${TELEGRAM_API}/bot${token}/${method}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }
  );

  const data = await response.json();
  if (!data.ok) throw new Error(data.description);
  return data;
}

async function saveUser(user) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;

  if (!url || !key) {
    throw new Error("Supabase environment variables missing");
  }

  const response = await fetch(
    `${url}/rest/v1/users?on_conflict=telegram_id`,
    {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify({
        telegram_id: user.id,
        username: user.username || null,
        first_name: user.first_name || null
      })
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Supabase error: ${error}`);
  }
}

const keyboard = {
  inline_keyboard: [
    [{
      text: "Открыть ippi VPN",
      web_app: { url: "https://ippivpn.vercel.app" }
    }],
    [
      { text: "Тарифы", callback_data: "tariffs" },
      { text: "Моя подписка", callback_data: "subscription" }
    ],
    [
      { text: "Пригласить друга", callback_data: "referral" },
      { text: "Поддержка", callback_data: "support" }
    ]
  ]
};

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    const update = req.body || {};

    if (update.message) {
      const chatId = update.message.chat.id;
      const command = (update.message.text || "").split(" ")[0];

      if (command === "/start") {
        if (update.message.from) {
          await saveUser(update.message.from);
        }

        await telegram("sendMessage", {
          chat_id: chatId,
          text:
            "👋 Добро пожаловать в ippi VPN!\n\n" +
            "Твой доступ к удобному и защищённому интернету.\n\n" +
            "Выбирай нужный раздел ниже:",
          reply_markup: keyboard
        });
      } else {
        await telegram("sendMessage", {
          chat_id: chatId,
          text: "Выбери нужный раздел в меню ippi VPN.",
          reply_markup: keyboard
        });
      }
    }

    if (update.callback_query) {
      const query = update.callback_query;
      const messages = {
        tariffs: "Наши тарифы доступны в приложении ippi VPN.",
        subscription: "Управление подпиской скоро появится.",
        referral: "Реферальная программа скоро появится.",
        support: "Раздел поддержки скоро появится."
      };

      await telegram("answerCallbackQuery", {
        callback_query_id: query.id
      });

      await telegram("sendMessage", {
        chat_id: query.message.chat.id,
        text: messages[query.data] || "Выбери раздел меню.",
        reply_markup: keyboard
      });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false });
  }
};
