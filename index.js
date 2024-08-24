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

  return `https://auth.robokassa.ru/Merchant/Index.aspx?MerchantLogin=${shopId}&OutSum=${amount}&InvId=${paymentId}&SignatureValue=${signature}&IsTest=0`; // Используйте https://auth.robokassa.ru/ для продакшена
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
    return res.status(400).send("Invalid signature");
  }

  // Обработка статуса платежа
  const session = await Session.findOne({ paymentId: InvId });

  if (session) {
    // Обновите статус оплаты в базе данных
    session.paymentStatus = "success";
    await session.save();

    // Отправьте сообщение пользователю через бота
    await bot.api.sendMessage(session.userId, "Оплата прошла успешно");
  } else {
    await bot.api.sendMessage(session.userId, "Не удалось подтвердить оплату");
  }

  res.status(200).send(`OK${InvId}`);
});

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

    // Отправьте ссылку на оплату с уникальным paymentId
    await ctx.reply(`Оплатите по ссылке: ${generatePaymentLink(paymentId, 3)}`);
  } else if (action === "rubles" || action === "euros") {
    if (action === "rubles") {
      const paymentId = generateUniqueId();
      session.paymentId = paymentId;
      await session.save();

      // Отправьте ссылку на оплату
      await ctx.reply(
        `Оплатите по ссылке: ${generatePaymentLink(paymentId, 3)}`
      );
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

// Установка вебхука
const setWebhook = async () => {
  try {
    // Удаление старого вебхука
    await bot.api.deleteWebhook();

    // Установка нового вебхука
    await bot.api.setWebhook(
      process.env.WEBHOOK_URL || `https://your-webhook-url`
    );
    console.log("Webhook set successfully");
  } catch (error) {
    console.error("Failed to set webhook:", error);
  }
};

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server is running on port ${PORT}`);
  // Установка вебхука после запуска сервера
  setWebhook();
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

// Убедитесь, что не вызывается bot.start() и используйте вебхук
// bot.start(); // Не вызывайте это, если используете вебхук
