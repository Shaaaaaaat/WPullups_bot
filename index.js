require("dotenv").config();
const { Bot, InlineKeyboard } = require("grammy");
const connectDB = require("./database");
const Session = require("./sessionModel");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");

// Извлечение переменных окружения для Airtable
const { AIRTABLE_API_KEY, AIRTABLE_BASE_ID, AIRTABLE_TABLE_ID } = process.env;

// Создаем экземпляр бота
const bot = new Bot(process.env.BOT_API_KEY); // Ваш API ключ от Telegram бота

// Подключаемся к MongoDB
connectDB();

// Функция для загрузки сообщений из JSON-файла
const loadMessages = () => {
  return JSON.parse(fs.readFileSync("messages.json", "utf8"));
};
const messages = loadMessages();

// Функция для генерации уникального ID в допустимом диапазоне
function generateUniqueId() {
  const maxId = 2147483647; // Максимально допустимое значение
  const minId = 1; // Минимально допустимое значение

  // Используем Date.now() и ограничиваем его до максимального значения
  return (Date.now() % (maxId - minId + 1)) + minId;
}

// Функция для генерации ссылки на оплату
function generatePaymentLink(paymentId, amount, email) {
  const signature = crypto
    .createHash("md5")
    .update(
      `${process.env.ROBO_ID}:${amount}:${paymentId}:${process.env.ROBO_SECRET1}`
    )
    .digest("hex");

  return `https://auth.robokassa.ru/Merchant/Index.aspx?MerchantLogin=${
    process.env.ROBO_ID
  }&OutSum=${amount}&InvId=${paymentId}&SignatureValue=${signature}&IsTest=0&Email=${encodeURIComponent(
    email
  )}`;
}

// Создаем и настраиваем Express-приложение
const app = express();
app.use(bodyParser.urlencoded({ extended: true }));

// Функция для создания записи в Airtable
async function createRecordInAirtable(fields) {
  try {
    const response = await axios.post(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}`,
      { fields },
      {
        headers: {
          Authorization: `Bearer ${AIRTABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );
    return response.data.id; // Возвращаем ID созданной записи
  } catch (error) {
    console.error(
      "Error creating record in Airtable:",
      error.response ? error.response.data : error.message
    );
    throw error;
  }
}

// Функция для обновления записи в Airtable
async function updateRecordInAirtable(recordId, fields) {
  try {
    await axios.patch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}/${recordId}`,
      { fields },
      {
        headers: {
          Authorization: `Bearer ${AIRTABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error(
      "Error updating record in Airtable:",
      error.response ? error.response.data : error.message
    );
    throw error;
  }
}

app.post("/webhook/robokassa", async (req, res) => {
  const { InvId, OutSum, SignatureValue, Email } = req.body;

  // Проверьте подпись для подтверждения подлинности уведомления
  const expectedSignature = crypto
    .createHash("md5")
    .update(`${OutSum}:${InvId}:${process.env.ROBO_SECRET2}`)
    .digest("hex");

  if (SignatureValue !== expectedSignature) {
    return res.status(400).send("Invalid signature");
  }

  // Найдите сессию в базе данных по InvId
  const session = await Session.findOne({ paymentId: InvId });

  if (session) {
    // Обновите статус оплаты в базе данных
    session.paymentStatus = "success";
    session.email = Email; // Обновите email в базе данных
    await session.save();

    // Обновите данные в Airtable
    await updateRecordInAirtable(session.airtableRecordId, {
      "Payment Status": "Paid", // Допустим, у вас есть поле для статуса оплаты
    });

    // Отправьте сообщение пользователю через бота
    await bot.api.sendMessage(session.userId, "Оплата прошла успешно");
  } else {
    await bot.api.sendMessage(session.userId, "Не удалось подтвердить оплату");
  }

  res.status(200).send("OK");
});

// Обработчик команд бота
bot.command("start", async (ctx) => {
  // Сохраняем данные пользователя в базе данных
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

  if (action === "register") {
    await ctx.reply(messages.enterName);
    session.step = "awaiting_name";
  } else if (action === "info") {
    await ctx.reply(messages.webinarInfo);
  } else if (action === "edit_info") {
    await ctx.reply(messages.editChoice, {
      reply_markup: new InlineKeyboard()
        .add({ text: "ФИ", callback_data: "edit_name" })
        .add({ text: "Телефон", callback_data: "edit_phone" })
        .add({ text: "E-mail", callback_data: "edit_email" }),
    });
    session.step = "awaiting_edit";
  } else if (action === "confirm_payment") {
    // Создайте уникальный paymentId для этой транзакции
    const paymentId = generateUniqueId();
    session.paymentId = paymentId;
    await session.save();

    // Отправьте ссылку на оплату с уникальным paymentId и email
    await ctx.reply(
      `Оплатите по ссылке: ${generatePaymentLink(paymentId, 3, session.email)}`
    );
  } else if (action === "rubles" || action === "euros") {
    if (action === "rubles") {
      // Создайте уникальный paymentId для этой транзакции
      const paymentId = generateUniqueId();
      session.paymentId = paymentId;
      await session.save();

      // Отправьте ссылку на оплату с уникальным paymentId и email
      await ctx.reply(
        `Оплатите по ссылке: ${generatePaymentLink(
          paymentId,
          3,
          session.email
        )}`
      );
    } else {
      await ctx.reply(messages.paymentLinkEuros);
    }
  } else if (action.startsWith("edit_")) {
    // Начинаем редактирование выбранного поля
    session.step = `awaiting_edit_${action.replace("edit_", "")}`;
    await ctx.reply(
      messages[
        `enter${
          action.replace("edit_", "").charAt(0).toUpperCase() +
          action.replace("edit_", "").slice(1)
        }`
      ]
    );
  }

  await session.save();
});

// Обработчик для ввода данных
bot.on("message:text", async (ctx) => {
  const session = await Session.findOne({ userId: ctx.from.id.toString() });

  if (session.step === "awaiting_name") {
    session.name = ctx.message.text;
    await ctx.reply(messages.enterPhone);
    session.step = "awaiting_phone";
  } else if (session.step === "awaiting_phone") {
    const phone = ctx.message.text;
    if (/^\+\d+$/.test(phone)) {
      session.phone = phone;
      await ctx.reply(messages.enterEmail);
      session.step = "awaiting_email";
    } else {
      await ctx.reply(messages.invalidPhone);
    }
  } else if (session.step === "awaiting_email") {
    session.email = ctx.message.text;

    // Создаем запись в Airtable
    const recordId = await createRecordInAirtable({
      FIO: session.name,
      Phone: session.phone,
      Email: session.email,
      PaymentStatus: "Pending", // Пример поля для статуса оплаты
    });
    session.airtableRecordId = recordId;

    // Сохраняем изменения
    await session.save();

    await ctx.reply(messages.registrationComplete);
  } else if (session.step.startsWith("awaiting_edit_")) {
    const field = session.step.replace("awaiting_edit_", "");
    session[field] = ctx.message.text;
    await updateRecordInAirtable(session.airtableRecordId, {
      [field]: ctx.message.text,
    });

    session.step = "start"; // Возвращаемся к начальному шагу
    await ctx.reply(messages.editComplete);
  }
});

// Запуск бота
bot.start();
