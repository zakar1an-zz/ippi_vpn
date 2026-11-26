
const TELEGRAM_API = "https://api.telegram.org";
const SUPPORT_URL = "https://t.me/ippi_support";

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

function supabaseHeaders() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key || !process.env.SUPABASE_URL) {
    throw new Error("Supabase environment variables missing");
  }

  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json"
  };
}

async function saveUser(user) {
  const url = process.env.SUPABASE_URL;

  const response = await fetch(
    `${url}/rest/v1/users?on_conflict=telegram_id`,
    {
      method: "POST",
      headers: {
        ...supabaseHeaders(),
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
    throw new Error(`Supabase save error: ${await response.text()}`);
  }
}

async function getProfile(telegramId) {
  const url = process.env.SUPABASE_URL;
  const headers = supabaseHeaders();

  const userResponse = await fetch(
    `${url}/rest/v1/users?telegram_id=eq.${telegramId}&select=id,telegram_id,username,first_name&limit=1`,
    { headers }
  );

  if (!userResponse.ok) {
    throw new Error(`User lookup error: ${await userResponse.text()}`);
  }

  const users = await userResponse.json();
  if (!users.length) return null;

  const user = users[0];

  const subResponse = await fetch(
    `${url}/rest/v1/subscriptions?user_id=eq.${user.id}&status=eq.active&select=plan_code,status,starts_at,expires_at&order=expires_at.desc&limit=1`,
    { headers }
  );

  if (!subResponse.ok) {
    throw new Error(`Subscription lookup error: ${await subResponse.text()}`);
  }

  const subscriptions = await subResponse.json();

  return {
    user,
    subscription: subscriptions[0] || null
  };
}

function formatDate(date) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(date));
}

function planName(code) {
  const names = {
    "1_month": "1 месяц",
    "3_months": "3 месяца",
    "6_months": "6 месяцев",
    "12_months": "12 месяцев"
  };

  return names[code] || code;
}

async function sendSubscription(chatId, telegramId) {
  const profile = await getProfile(telegramId);

  if (!profile) {
    await telegram("sendMessage", {
      chat_id: chatId,
      text: "Аккаунт пока не найден. Нажми /start, чтобы зарегистрироваться."
    });
    return;
  }

  const user = profile.user;
  const sub = profile.subscription;

  const name = user.first_name || "Не указано";
  const account = user.username ? `@${user.username}` : "Имя пользователя не указано";

  let subscriptionText;

  if (sub && sub.expires_at && new Date(sub.expires_at) > new Date()) {
    const remaining = Math.ceil(
      (new Date(sub.expires_at) - Date.now()) / 86400000
    );

    subscriptionText =
      `✅ Статус: Активна\n` +
      `🎁 Тариф: ${planName(sub.plan_code)}\n` +
      `📅 Действует до: ${formatDate(sub.expires_at)} (МСК)\n` +
      `⏳ Осталось дней: ${remaining}`;
  } else {
    subscriptionText =
      "❌ Активной подписки нет.\n\n" +
      "Выбери тариф в приложении ippi VPN.";
  }

  await telegram("sendMessage", {
    chat_id: chatId,
    text:
      "👑 МОЙ ПРОФИЛЬ\n\n" +
      `📝 Имя: ${name}\n` +
      `🆔 Telegram ID: ${user.telegram_id}\n` +
      `🔗 Аккаунт: ${account}\n` +
      "✅ Аккаунт привязан\n\n" +
      "🔑 МОЯ ПОДПИСКА\n" +
      subscriptionText,
    reply_markup: {
      inline_keyboard: [
        [{
          text: "Открыть ippi VPN",
          web_app: { url: "https://ippivpn.vercel.app" }
        }],
        [{
          text: "Ключ и устройства",
          callback_data: "key_devices"
        }],
        [{
          text: "Главное меню",
          callback_data: "main_menu"
        }]
      ]
    }
  });
}

async function sendKeyDevices(chatId) {
  await telegram("sendMessage", {
    chat_id: chatId,
    text:
      "🔑 КЛЮЧ И УСТРОЙСТВА\n\n" +
      "🔐 VPN-ключ: пока не создан.\n" +
      "📱 Устройства: настройка ещё не подключена.\n\n" +
      "Эти данные появятся после настройки VPN-серверов и автоматической выдачи ключей.",
    reply_markup: {
      inline_keyboard: [
        [{
          text: "Моя подписка",
          callback_data: "subscription"
        }],
        [{
          text: "Главное меню",
          callback_data: "main_menu"
        }]
      ]
    }
  });
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
      { text: "Ключ и устройства", callback_data: "key_devices" }
    ],
    [
      { text: "Пригласить друга", callback_data: "referral" },
      { text: "Поддержка", callback_data: "support" }
    ]
  ]
};

const supportKeyboard = {
  inline_keyboard: [
    [{
      text: "Написать в поддержку",
      url: SUPPORT_URL
    }],
    [{
      text: "В главное меню",
      callback_data: "main_menu"
    }]
  ]
};

async function sendSupport(chatId) {
  await telegram("sendMessage", {
    chat_id: chatId,
    text:
      "Поддержка ippi VPN\n\n" +
      "Если у тебя возникли вопросы по подключению, оплате или подписке — напиши нам. Мы постараемся помочь.",
    reply_markup: supportKeyboard
  });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    const update = req.body || {};

    if (update.message) {
      const chatId = update.message.chat.id;
      const telegramUser = update.message.from;
      const command = (update.message.text || "").split(" ")[0];

      if (command === "/start") {
        if (telegramUser) await saveUser(telegramUser);

        await telegram("sendMessage", {
          chat_id: chatId,
          text:
            "👋 Добро пожаловать в ippi VPN!\n\n" +
            "Твой доступ к удобному и защищённому интернету.\n\n" +
            "Выбирай нужный раздел ниже:",
          reply_markup: keyboard
        });
      } else if (command === "/support") {
        await sendSupport(chatId);
      } else if (command === "/subscription") {
        await sendSubscription(chatId, telegramUser.id);
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
      const chatId = query.message.chat.id;

      await telegram("answerCallbackQuery", {
        callback_query_id: query.id
      });

      if (query.data === "support") {
        await sendSupport(chatId);
      } else if (query.data === "subscription") {
        await sendSubscription(chatId, query.from.id);
      } else if (query.data === "key_devices") {
        await sendKeyDevices(chatId);
      } else if (query.data === "main_menu") {
        await telegram("sendMessage", {
          chat_id: chatId,
          text: "Главное меню ippi VPN:",
          reply_markup: keyboard
        });
      } else {
        const messages = {
          tariffs: "Наши тарифы доступны в приложении ippi VPN.",
          referral: "Реферальная программа скоро появится."
        };

        await telegram("sendMessage", {
          chat_id: chatId,
          text: messages[query.data] || "Выбери раздел меню.",
          reply_markup: keyboard
        });
      }
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false });
  }
};
