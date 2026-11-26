
const TELEGRAM_API = "https://api.telegram.org";
const SUPPORT_URL = "https://t.me/ippi_support";
const APP_URL = "https://ippivpn.vercel.app";

// Фотографии
const WELCOME_IMAGE =
  "https://raw.githubusercontent.com/zakar1an-zz/ippi_vpn/main/C9C0480A-98A0-45E6-B32D-651A9B908DEE.png";

// Одна фотография для главного меню и личного кабинета
const MENU_IMAGE =
  "https://raw.githubusercontent.com/zakar1an-zz/ippi_vpn/main/8768BF5F-3C16-4306-8D79-1BA0E4039F3D.png";

const CABINET_IMAGE = MENU_IMAGE;

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

  if (!data.ok) {
    throw new Error(data.description || "Telegram API error");
  }

  return data;
}

// Supabase
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

// Форматирование
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

// Кнопки
const mainKeyboard = {
  inline_keyboard: [
    [{
      text: "Открыть ippi VPN",
      web_app: { url: APP_URL }
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

const backKeyboard = {
  inline_keyboard: [
    [{
      text: "← Главное меню",
      callback_data: "main_menu"
    }]
  ]
};

// Показать экран в одном сообщении
async function showScreen(chatId, message, photo, caption, keyboard) {
  const media = {
    type: "photo",
    media: photo,
    caption
  };

  // Если сообщение уже содержит фотографию — заменяем её
  if (message && message.photo) {
    try {
      await telegram("editMessageMedia", {
        chat_id: chatId,
        message_id: message.message_id,
        media,
        reply_markup: keyboard
      });
      return;
    } catch (error) {
      if (error.message.includes("message is not modified")) {
        return;
      }
      throw error;
    }
  }

  // Если старое сообщение было текстовым —
  // удаляем его и отправляем фотографию
  if (message) {
    try {
      await telegram("deleteMessage", {
        chat_id: chatId,
        message_id: message.message_id
      });
    } catch (error) {
      console.error("Could not delete old message:", error.message);
    }
  }

  await telegram("sendPhoto", {
    chat_id: chatId,
    photo,
    caption,
    reply_markup: keyboard
  });
}

// Главное меню
async function showMainMenu(chatId, message = null) {
  await showScreen(
    chatId,
    message,
    MENU_IMAGE,
    "🏠 ГЛАВНОЕ МЕНЮ ippi VPN\n\n" +
    "Выбирай нужный раздел:",
    mainKeyboard
  );
}

// Приветствие
async function showWelcome(chatId) {
  await telegram("sendPhoto", {
    chat_id: chatId,
    photo: WELCOME_IMAGE,
    caption:
      "👋 Добро пожаловать в ippi VPN!\n\n" +
      "Твой доступ к удобному и защищённому интернету.\n\n" +
      "Выбирай нужный раздел ниже:",
    reply_markup: mainKeyboard
  });
}

// Личный кабинет и подписка
async function showSubscription(chatId, telegramId, message = null) {
  const profile = await getProfile(telegramId);

  if (!profile) {
    await showScreen(
      chatId,
      message,
      CABINET_IMAGE,
      "Аккаунт пока не найден.\n\nНажми /start, чтобы зарегистрироваться.",
      backKeyboard
    );
    return;
  }

  const user = profile.user;
  const sub = profile.subscription;

  const name = user.first_name || "Не указано";
  const account = user.username
    ? `@${user.username}`
    : "Имя пользователя не указано";

  let subscriptionText;

  if (
    sub &&
    sub.expires_at &&
    new Date(sub.expires_at) > new Date()
  ) {
    const remaining = Math.ceil(
      (new Date(sub.expires_at).getTime() - Date.now()) / 86400000
    );

    subscriptionText =
      "✅ Статус: Активна\n" +
      `🎁 Тариф: ${planName(sub.plan_code)}\n` +
      `📅 Действует до: ${formatDate(sub.expires_at)} (МСК)\n` +
      `⏳ Осталось дней: ${remaining}`;
  } else {
    subscriptionText =
      "❌ Активной подписки нет.\n\n" +
      "Выбери тариф в приложении ippi VPN.";
  }

  await showScreen(
    chatId,
    message,
    CABINET_IMAGE,
    "👑 МОЙ ПРОФИЛЬ\n\n" +
    `📝 Имя: ${name}\n` +
    `🆔 Telegram ID: ${user.telegram_id}\n` +
    `🔗 Аккаунт: ${account}\n` +
    "✅ Аккаунт привязан\n\n" +
    "🔑 МОЯ ПОДПИСКА\n" +
    subscriptionText,
    {
      inline_keyboard: [
        [{
          text: "Открыть ippi VPN",
          web_app: { url: APP_URL }
        }],
        [{
          text: "Ключ и устройства",
          callback_data: "key_devices"
        }],
        [{
          text: "← Главное меню",
          callback_data: "main_menu"
        }]
      ]
    }
  );
}

// Ключ и устройства
async function showKeyDevices(chatId, message = null) {
  await showScreen(
    chatId,
    message,
    CABINET_IMAGE,
    "🔑 КЛЮЧ И УСТРОЙСТВА\n\n" +
    "🔐 VPN-ключ: пока не создан.\n" +
    "📱 Устройства: настройка ещё не подключена.\n\n" +
    "Эти данные появятся после настройки VPN-серверов и автоматической выдачи ключей.",
    {
      inline_keyboard: [
        [{
          text: "Моя подписка",
          callback_data: "subscription"
        }],
        [{
          text: "← Главное меню",
          callback_data: "main_menu"
        }]
      ]
    }
  );
}

// Тарифы
async function showTariffs(chatId, message = null) {
  await showScreen(
    chatId,
    message,
    MENU_IMAGE,
    "💎 ТАРИФЫ ippi VPN\n\n" +
    "Выбери подходящий тариф и оформи подписку в приложении.",
    {
      inline_keyboard: [
        [{
          text: "Посмотреть тарифы",
          web_app: { url: APP_URL }
        }],
        [{
          text: "← Главное меню",
          callback_data: "main_menu"
        }]
      ]
    }
  );
}

// Поддержка
async function showSupport(chatId, message = null) {
  await showScreen(
    chatId,
    message,
    MENU_IMAGE,
    "🎧 ПОДДЕРЖКА ippi VPN\n\n" +
    "Возникли вопросы по подключению, оплате или подписке?\n\n" +
    "Напиши нам — постараемся помочь.",
    {
      inline_keyboard: [
        [{
          text: "Написать в поддержку",
          url: SUPPORT_URL
        }],
        [{
          text: "← Главное меню",
          callback_data: "main_menu"
        }]
      ]
    }
  );
}

// Реферальная программа
async function showReferral(chatId, message = null) {
  await showScreen(
    chatId,
    message,
    MENU_IMAGE,
    "🎁 РЕФЕРАЛЬНАЯ ПРОГРАММА\n\n" +
    "Приглашай друзей и получай бонусы за их подписки.\n\n" +
    "Реферальная программа скоро появится.",
    backKeyboard
  );
}

// Обработка запросов
module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    const update = req.body || {};

    // Сообщения и команды
    if (update.message) {
      const chatId = update.message.chat.id;
      const telegramUser = update.message.from;
      const command = (update.message.text || "").split(" ")[0];

      if (command === "/start") {
        if (telegramUser) {
          await saveUser(telegramUser);
        }

        await showWelcome(chatId);

      } else if (command === "/support") {
        await showSupport(chatId);

      } else if (command === "/subscription") {
        await showSubscription(chatId, telegramUser.id);

      } else {
        await showMainMenu(chatId);
      }
    }

    // Нажатия на кнопки
    if (update.callback_query) {
      const query = update.callback_query;
      const chatId = query.message.chat.id;
      const message = query.message;

      await telegram("answerCallbackQuery", {
        callback_query_id: query.id
      });

      if (query.data === "main_menu") {
        await showMainMenu(chatId, message);

      } else if (query.data === "subscription") {
        await showSubscription(chatId, query.from.id, message);

      } else if (query.data === "key_devices") {
        await showKeyDevices(chatId, message);

      } else if (query.data === "tariffs") {
        await showTariffs(chatId, message);

      } else if (query.data === "support") {
        await showSupport(chatId, message);

      } else if (query.data === "referral") {
        await showReferral(chatId, message);
      }
    }

    return res.status(200).json({ ok: true });

  } catch (error) {
    console.error("Webhook error:", error);

    return res.status(500).json({
      ok: false
    });
  }
};
