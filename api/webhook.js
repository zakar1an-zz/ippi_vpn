
const TELEGRAM_API = "https://api.telegram.org";
const SUPPORT_URL = "https://t.me/ippi_support";
const APP_URL = "https://ippivpn.vercel.app";

// Фотографии
const WELCOME_IMAGE =
  "https://raw.githubusercontent.com/zakar1an-zz/ippi_vpn/main/C9C0480A-98A0-45E6-B32D-651A9B908DEE.png";

const MAIN_IMAGE =
  "https://raw.githubusercontent.com/zakar1an-zz/ippi_vpn/main/8768BF5F-3C16-4306-8D79-1BA0E4039F3D.png";

const CABINET_IMAGE =
  "https://raw.githubusercontent.com/zakar1an-zz/ippi_vpn/main/5F56BBF4-3D2A-4045-95F5-97B794B7ABE8.png";

const SUPPORT_IMAGE =
  "https://raw.githubusercontent.com/zakar1an-zz/ippi_vpn/main/6C514B83-5272-46AF-905B-6B6C1EE27AE9.png";

const REFERRAL_IMAGE =
  "https://raw.githubusercontent.com/zakar1an-zz/ippi_vpn/main/C1605ED7-916A-4D6A-B3F3-289B7250E53B.png";

// Telegram API
async function telegram(method, payload = {}) {
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

// Получение username бота автоматически
async function getBotUsername() {
  const result = await telegram("getMe");
  return result.result.username;
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

// Регистрация пользователя
async function saveUser(user) {
  const url = process.env.SUPABASE_URL;

  const response = await fetch(
    `${url}/rest/v1/users?on_conflict=telegram_id`,
    {
      method: "POST",
      headers: {
        ...supabaseHeaders(),
        Prefer: "resolution=ignore-duplicates,return=representation"
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

  const createdUsers = await response.json();

  if (createdUsers.length > 0) {
    return {
      user: createdUsers[0],
      isNew: true
    };
  }

  // Пользователь уже существует
  const existingResponse = await fetch(
    `${url}/rest/v1/users?telegram_id=eq.${user.id}&select=id,telegram_id,username,first_name&limit=1`,
    { headers: supabaseHeaders() }
  );

  if (!existingResponse.ok) {
    throw new Error(`User lookup error: ${await existingResponse.text()}`);
  }

  const existingUsers = await existingResponse.json();

  if (!existingUsers.length) {
    throw new Error("User not found after registration");
  }

  // Обновляем имя и username существующего пользователя
  await fetch(
    `${url}/rest/v1/users?telegram_id=eq.${user.id}`,
    {
      method: "PATCH",
      headers: {
        ...supabaseHeaders(),
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        username: user.username || null,
        first_name: user.first_name || null
      })
    }
  );

  return {
    user: existingUsers[0],
    isNew: false
  };
}

// Регистрация приглашения
async function registerReferral(inviterTelegramId, invitedUser) {
  if (!/^\d+$/.test(String(inviterTelegramId))) return;

  if (
    Number(inviterTelegramId) ===
    Number(invitedUser.telegram_id)
  ) {
    return;
  }

  const url = process.env.SUPABASE_URL;
  const headers = supabaseHeaders();

  const inviterResponse = await fetch(
    `${url}/rest/v1/users?telegram_id=eq.${inviterTelegramId}&select=id&limit=1`,
    { headers }
  );

  if (!inviterResponse.ok) {
    throw new Error(`Inviter lookup error: ${await inviterResponse.text()}`);
  }

  const inviters = await inviterResponse.json();

  if (!inviters.length) return;

  const response = await fetch(
    `${url}/rest/v1/referrals`,
    {
      method: "POST",
      headers: {
        ...headers,
        Prefer: "resolution=ignore-duplicates,return=minimal"
      },
      body: JSON.stringify({
        inviter_id: inviters[0].id,
        invited_id: invitedUser.id,
        status: "pending"
      })
    }
  );

  if (!response.ok) {
    throw new Error(`Referral save error: ${await response.text()}`);
  }
}

// Получение профиля и подписки
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

// Количество приглашённых
async function getReferralCount(userId) {
  const url = process.env.SUPABASE_URL;

  const response = await fetch(
    `${url}/rest/v1/referrals?inviter_id=eq.${userId}&select=id&limit=1000`,
    { headers: supabaseHeaders() }
  );

  if (!response.ok) {
    throw new Error(`Referral count error: ${await response.text()}`);
  }

  const referrals = await response.json();
  return referrals.length;
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

// Главное меню
const mainKeyboard = {
  inline_keyboard: [
    [{
      text: "Открыть ippi VPN",
      web_app: { url: APP_URL }
    }],
    [{
      text: "Моя подписка",
      callback_data: "subscription"
    }],
    [{
      text: "Ключ и устройства",
      callback_data: "key_devices"
    }],
    [
      {
        text: "Пригласить друга",
        callback_data: "referral"
      },
      {
        text: "Поддержка",
        callback_data: "support"
      }
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

// Переключение экранов
async function showScreen(chatId, message, photo, caption, keyboard) {
  const media = {
    type: "photo",
    media: photo,
    caption
  };

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

// Главное меню
async function showMainMenu(chatId, message = null) {
  await showScreen(
    chatId,
    message,
    MAIN_IMAGE,
    "🏠 ГЛАВНОЕ МЕНЮ ippi VPN\n\n" +
    "Выбирай нужный раздел:",
    mainKeyboard
  );
}

// Личный кабинет
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

// Поддержка
async function showSupport(chatId, message = null) {
  await showScreen(
    chatId,
    message,
    SUPPORT_IMAGE,
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
async function showReferral(chatId, telegramId, message = null) {
  const profile = await getProfile(telegramId);

  if (!profile) {
    await showScreen(
      chatId,
      message,
      REFERRAL_IMAGE,
      "Аккаунт не найден. Нажми /start.",
      backKeyboard
    );
    return;
  }

  const botUsername = await getBotUsername();
  const referralLink =
    `https://t.me/${botUsername}?start=ref_${telegramId}`;

  const referralCount = await getReferralCount(profile.user.id);

  const shareUrl =
    "https://t.me/share/url?url=" +
    encodeURIComponent(referralLink) +
    "&text=" +
    encodeURIComponent("Попробуй ippi VPN!");

  await showScreen(
    chatId,
    message,
    REFERRAL_IMAGE,
    "🎁 РЕФЕРАЛЬНАЯ ПРОГРАММА ippi VPN\n\n" +
    "Приглашай друзей по своей личной ссылке.\n\n" +
    "🔗 ТВОЯ ССЫЛКА:\n" +
    referralLink +
    "\n\n" +
    `👥 Приглашено друзей: ${referralCount}\n\n` +
    "🎉 Бонус: 5 бесплатных дней за первую успешную оплату друга.\n" +
    "Максимум — 15 бонусных дней за календарный месяц.\n\n" +
    "Бонусы будут начисляться после подключения автоматической проверки оплат.",
    {
      inline_keyboard: [
        [{
          text: "Поделиться ссылкой",
          url: shareUrl
        }],
        [{
          text: "← Главное меню",
          callback_data: "main_menu"
        }]
      ]
    }
  );
}

// Webhook
module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    const update = req.body || {};

    if (update.message) {
      const chatId = update.message.chat.id;
      const telegramUser = update.message.from;

      const parts = (update.message.text || "")
        .trim()
        .split(/\s+/);

      const command = (parts[0] || "").split("@")[0];
      const startPayload = parts[1] || "";

      if (command === "/start") {
        if (telegramUser) {
          const saved = await saveUser(telegramUser);

          // Учитываем приглашение только при первой регистрации
          const referralMatch = startPayload.match(/^ref_(\d+)$/);

          if (saved.isNew && referralMatch) {
            await registerReferral(
              referralMatch[1],
              saved.user
            );
          }
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

      } else if (query.data === "support") {
        await showSupport(chatId, message);

      } else if (query.data === "referral") {
        await showReferral(chatId, query.from.id, message);
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
