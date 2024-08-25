require("dotenv").config();
const { Bot, InlineKeyboard } = require("grammy");
const express = require("express");
const bodyParser = require("body-parser");
const crypto = require("crypto");
const fs = require("fs");
const axios = require("axios");
const connectDB = require("./database");
const Session = require("./sessionModel");

// Создаем экземпляр бота
const bot = new Bot(process.env.BOT_API_KEY);

// Подключаемся к MongoDB
connectDB();

// Функция для загрузки сообщений из JSON-файла
const loadMessages = () => {
  return JSON.parse(fs.readFileSync("messages.json", "utf8"));
};
const messages = loadMessages();

// Функция для генерации уникального ID в допустимом диапазоне
function generateUniqueId() {
  const maxId = 2147483647;
  const minId = 1;
  return (Date.now() % (maxId - minId + 1)) + minId;
}

// Функция для генерации ссылки на оплату Stripe
function generatePaymentLink(paymentId, amount, email) {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const stripeBaseUrl = process.env.STRIPE_BASE_URL;

  return `${stripeBaseUrl}/checkout/${paymentId}?amount=${amount}&email=${encodeURIComponent(
    email
  )}&secret_key=${stripeSecretKey}`;
}

// Функция для отправки данных в Airtable
async function sendToAirtable(name, email, phone, tgId, invId) {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const tableId = process.env.AIRTABLE_TABLE_ID;

  const url = `https://api.airtable.com/v0/${baseId}/${tableId}`;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  const data = {
    fields: {
      FIO: name,
      email: email,
      Phone: phone,
      tgId: tgId,
      Tag: "Webinar",
      inv_id: invId,
    },
  };

  try {
    await axios.post(url, data, { headers });
  } catch (error) {
    console.error(
      "Error sending data to Airtable:",
      error.response ? error.response.data : error.message
    );
  }
}

// Создаем и настраиваем Express-приложение
const app = express();
app.use(bodyParser.json()); // Используем JSON для обработки запросов от Telegram и Робокассы

// Обработчик команд бота
bot.command("start", async (ctx) => {
  await Session.findOneAndUpdate(
    { userId: ctx.from.id.toString() },
    { userId: ctx.from.id.toString(), step: "start" },
    { upsert: true }
  );

  ctx.reply(messages.start, {
    reply_markup: new InlineKeyboard()
      .add({ text: "Записаться на вебинар", callback_data: "register" })
      .row()
      .add({ text: "Узнать, что будет на вебинаре", callback_data: "info" }),
  });
});

// Обработчик для callback_query, связанных с действиями
bot.on("callback_query:data", async (ctx) => {
  const action = ctx.callbackQuery.data;
  const session = await Session.findOne({ userId: ctx.from.id.toString() });

  if (!session) {
    console.log("Session not found for user:", ctx.from.id.toString());
    return;
  }

  if (action === "register" || action === "register_from_info") {
    await ctx.reply(messages.enterName);
    session.step = "awaiting_name";
    await session.save(); // Сохранение сессии после изменения шага
  } else if (action === "info") {
    await ctx.reply(messages.webinarInfo, {
      reply_markup: new InlineKeyboard().add({
        text: "Записаться на вебинар",
        callback_data: "register_from_info",
      }),
    });
  } else if (action === "edit_info") {
    await ctx.reply(messages.editChoice, {
      reply_markup: new InlineKeyboard()
        .add({ text: "ФИ", callback_data: "edit_name" })
        .add({ text: "Телефон", callback_data: "edit_phone" })
        .add({ text: "E-mail", callback_data: "edit_email" }),
    });
    session.step = "awaiting_edit";
    await session.save(); // Сохранение сессии после изменения шага
  } else if (action === "confirm_payment") {
    if (session.step === "awaiting_confirmation") {
      await ctx.reply("Выберите тип карты для оплаты:", {
        reply_markup: new InlineKeyboard()
          .add({ text: "Российская карта (₽)", callback_data: "rubles" })
          .add({ text: "Зарубежная карта (€)", callback_data: "euros" }),
      });
      session.step = "awaiting_payment_type";
      await session.save(); // Сохранение сессии после изменения шага
    }
  } else if (action === "rubles" || action === "euros") {
    const paymentId = generateUniqueId();
    session.paymentId = paymentId;
    await session.save(); // Сохранение сессии после генерации paymentId

    let paymentLink;
    if (action === "rubles") {
      paymentLink = generatePaymentLink(paymentId, 300, session.email); // Пример суммы в копейках для рублевого расчета
      await ctx.reply(`Оплатите по ссылке: ${paymentLink}`);
    } else if (action === "euros") {
      paymentLink = generatePaymentLink(paymentId, 900, session.email); // Пример суммы в центрах для евро расчета
      await ctx.reply(`Оплатите по ссылке: ${paymentLink}`);
    }

    // Отправьте данные в Airtable с inv_id
    await sendToAirtable(
      session.name,
      session.email,
      session.phone,
      ctx.from.id,
      paymentId // Передаем inv_id
    );

    // Очистите сессию после отправки данных в Airtable
    session.step = "completed";
    await session.save(); // Сохранение сессии после завершения
  } else if (action.startsWith("edit_")) {
    session.step = `awaiting_edit_${action.replace("edit_", "")}`;
    await ctx.reply(
      messages[
        `enter${
          action.replace("edit_", "").charAt(0).toUpperCase() +
          action.replace("edit_", "").slice(1)
        }`
      ]
    );
    await session.save(); // Сохранение сессии после изменения шага
  }
});

// Обработчик для ввода данных
bot.on("message:text", async (ctx) => {
  const session = await Session.findOne({ userId: ctx.from.id.toString() });

  if (!session) {
    console.log("Session not found for user:", ctx.from.id.toString());
    return;
  }

  if (session.step === "awaiting_name") {
    session.name = ctx.message.text;
    await ctx.reply(messages.enterPhone);
    session.step = "awaiting_phone";
    await session.save(); // Сохранение сессии после изменения шага
  } else if (session.step === "awaiting_phone") {
    const phone = ctx.message.text;
    if (/^\+\d+$/.test(phone)) {
      session.phone = phone;
      await ctx.reply(messages.enterEmail);
      session.step = "awaiting_email";
      await session.save(); // Сохранение сессии после изменения шага
    } else {
      await ctx.reply(messages.invalidPhone);
    }
  } else if (session.step === "awaiting_email") {
    session.email = ctx.message.text;
    const confirmationMessage = messages.confirmation
      .replace("{{ $ФИ }}", session.name)
      .replace("{{ $Tel }}", session.phone)
      .replace("{{ $email }}", session.email);

    await ctx.reply(confirmationMessage, {
      reply_markup: new InlineKeyboard()
        .add({ text: "Все верно", callback_data: "confirm_payment" })
        .row()
        .add({ text: "Изменить", callback_data: "edit_info" }),
    });

    session.step = "awaiting_confirmation";
    await session.save(); // Сохранение сессии после изменения шага
  } else if (session.step === "awaiting_confirmation") {
    if (ctx.message.text === "Все верно") {
      await ctx.reply("Выберите тип карты для оплаты:", {
        reply_markup: new InlineKeyboard()
          .add({ text: "Российская карта (₽)", callback_data: "rubles" })
          .add({ text: "Зарубежная карта (€)", callback_data: "euros" }),
      });
      session.step = "awaiting_payment_type";
      await session.save(); // Сохранение сессии после изменения шага
    }
  } else if (session.step.startsWith("awaiting_edit_")) {
    const field = session.step.replace("awaiting_edit_", "");
    if (field === "name") {
      session.name = ctx.message.text;
    } else if (field === "phone") {
      const phone = ctx.message.text;
      if (/^\+\d+$/.test(phone)) {
        session.phone = phone;
      } else {
        await ctx.reply(messages.invalidPhone);
        return;
      }
    } else if (field === "email") {
      session.email = ctx.message.text;
    }

    const confirmationMessage = messages.confirmation
      .replace("{{ $ФИ }}", session.name)
      .replace("{{ $Tel }}", session.phone)
      .replace("{{ $email }}", session.email);

    await ctx.reply(confirmationMessage, {
      reply_markup: new InlineKeyboard()
        .add({ text: "Все верно", callback_data: "confirm_payment" })
        .row()
        .add({ text: "Изменить", callback_data: "edit_info" }),
    });

    session.step = "awaiting_confirmation";
    await session.save(); // Сохранение сессии после изменения шага
  }
});

// Запуск бота
bot.start();
