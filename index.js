require("dotenv").config();
const { Bot, InlineKeyboard } = require("grammy");
const connectDB = require("./database");
const Session = require("./sessionModel");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const bodyParser = require("body-parser");

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

  return (Date.now() % (maxId - minId + 1)) + minId;
}

// Функция для генерации ссылки на оплату
function generatePaymentLink(paymentId, amount, email) {
  const shopId = process.env.ROBO_ID; // Логин вашего магазина в Робокассе
  const secretKey1 = process.env.ROBO_SECRET1; // Secret Key 1 для формирования подписи

  const signature = crypto
    .createHash("md5")
    .update(`${shopId}:${amount}:${paymentId}:${secretKey1}`)
    .digest("hex");

<<<<<<< HEAD
  return `https://auth.robokassa.ru/Merchant/Index.aspx?MerchantLogin=${shopId}&OutSum=${amount}&InvId=${paymentId}&SignatureValue=${signature}&IsTest=0&Email=${encodeURIComponent(
    email
  )}`;
=======
  return `https://auth.robokassa.ru/Merchant/Index.aspx?MerchantLogin=${shopId}&OutSum=${amount}&InvId=${paymentId}&SignatureValue=${signature}&IsTest=0&Email=${encodeURIComponent(email)}`;
>>>>>>> 2577f291ffceafd2efb66396a57b790d8465a287
}

// Создаем и настраиваем Express-приложение
const app = express();
app.use(bodyParser.urlencoded({ extended: true }));

// Обработчик для webhook
app.post("/webhook/robokassa", async (req, res) => {
  const { InvId, OutSum, SignatureValue, Email, PaymentStatus } = req.body;

  // Проверьте подпись для подтверждения подлинности уведомления
  const secretKey2 = process.env.ROBO_SECRET2;
  const expectedSignature = crypto
    .createHash("md5")
    .update(`${OutSum}:${InvId}:${secretKey2}`)
    .digest("hex");

  if (SignatureValue !== expectedSignature) {
<<<<<<< HEAD
    console.error("Invalid signature");
=======
    console.error('Invalid signature');
>>>>>>> 2577f291ffceafd2efb66396a57b790d8465a287
    return res.status(400).send("Invalid signature");
  }

  // Обработка статуса платежа
  const session = await Session.findOne({ paymentId: InvId });

  if (PaymentStatus === "failed") {
    if (session) {
<<<<<<< HEAD
      await bot.api.sendMessage(
        session.userId,
        "Оплата не прошла. Пожалуйста, попробуйте снова."
      );
    } else {
      console.error("Session not found for failed payment");
=======
      await bot.api.sendMessage(session.userId, "Оплата не прошла. Пожалуйста, попробуйте снова.");
    } else {
      console.error('Session not found for failed payment');
>>>>>>> 2577f291ffceafd2efb66396a57b790d8465a287
    }
  } else if (PaymentStatus === "success") {
    if (session) {
      session.paymentStatus = "success";
      session.email = Email; // Обновите email в базе данных
      await session.save();
      await bot.api.sendMessage(session.userId, "Оплата прошла успешно");
    } else {
<<<<<<< HEAD
      console.error("Session not found for successful payment");
      await bot.api.sendMessage(
        session.userId,
        "Не удалось подтвердить оплату"
      );
    }
  } else {
    console.error("Unknown payment status");
=======
      console.error('Session not found for successful payment');
      await bot.api.sendMessage(session.userId, "Не удалось подтвердить оплату");
    }
  } else {
    console.error('Unknown payment status');
>>>>>>> 2577f291ffceafd2efb66396a57b790d8465a287
  }

  res.status(200).send(`OK${InvId}`);
});

// Установите вебхук URL
<<<<<<< HEAD
const webhookUrl =
  process.env.WEBHOOK_URL ||
  `https://webinar-production-4420.up.railway.app/webhook/robokassa`;
=======
const webhookUrl = process.env.WEBHOOK_URL || `https://webinar-production-4420.up.railway.app/webhook/robokassa`;
>>>>>>> 2577f291ffceafd2efb66396a57b790d8465a287
bot.api.deleteWebhook(); // Удалите предыдущий вебхук
bot.api.setWebhook(webhookUrl); // Установите новый вебхук

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
    const paymentId = generateUniqueId();
    session.paymentId = paymentId;
    await session.save();

<<<<<<< HEAD
    await ctx.reply(
      `Оплатите по ссылке: ${generatePaymentLink(paymentId, 3, session.email)}`
    );
=======
    await ctx.reply(`Оплатите по ссылке: ${generatePaymentLink(paymentId, 3, session.email)}`);
>>>>>>> 2577f291ffceafd2efb66396a57b790d8465a287
  } else if (action === "rubles" || action === "euros") {
    if (action === "rubles") {
      const paymentId = generateUniqueId();
      session.paymentId = paymentId;
      await session.save();

<<<<<<< HEAD
      await ctx.reply(
        `Оплатите по ссылке: ${generatePaymentLink(
          paymentId,
          3,
          session.email
        )}`
      );
=======
      await ctx.reply(`Оплатите по ссылке: ${generatePaymentLink(paymentId, 3, session.email)}`);
>>>>>>> 2577f291ffceafd2efb66396a57b790d8465a287
    } else {
      await ctx.reply(messages.paymentLinkEuros);
    }
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
  }

  await session.save();
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// Ловим ошибки бота
bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`Error while handling update ${ctx.update.update_id}:`);

  const e = err.error;

  if (e instanceof Error) {
    console.error("Error in request:", e.message);
  } else {
    console.error("Unknown error:", e);
  }
});

// Остановка бота (необходимо для остановки предыдущих вебхуков и запуска новых)
// bot.api.deleteWebhook(); // Удалите предыдущий вебхук, если он существует
// bot.api.setWebhook(process.env.WEBHOOK_URL || `https://webinar-production-4420.up.railway.app/webhook/robokassa`); // Установите новый вебхук

// Запуск бота
bot.start();
