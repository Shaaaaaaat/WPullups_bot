require("dotenv").config();
const { Bot, InlineKeyboard } = require("grammy");
const express = require("express");
const bodyParser = require("body-parser");
const crypto = require("crypto");
const fs = require("fs");
const axios = require("axios");
const stripe = require("stripe")(process.env.STRIPE_KEY);
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
  const maxId = 2147483647; // Максимально допустимое значение
  const minId = 1; // Минимально допустимое значение
  return (Date.now() % (maxId - minId + 1)) + minId;
}

// Функция для создания объекта Price в Stripe
async function createPrice() {
  const price = await stripe.prices.create({
    unit_amount: 100, // 1 евро в центах
    currency: "eur",
    product_data: {
      name: "Webinar Registration",
    },
  });
  return price.id;
}

// Функция для создания ссылки на оплату в Stripe
async function createPaymentLink(priceId) {
  const paymentLink = await stripe.paymentLinks.create({
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
  });
  return paymentLink.url;
}

// Функция для генерации ссылки на оплату Робокассы
function generatePaymentLinkRobokassa(paymentId, amount, email) {
  const shopId = process.env.ROBO_ID;
  const secretKey1 = process.env.ROBO_SECRET1;

  const signature = crypto
    .createHash("md5")
    .update(`${shopId}:${amount}:${paymentId}:${secretKey1}`)
    .digest("hex");

  return `https://auth.robokassa.ru/Merchant/Index.aspx?MerchantLogin=${shopId}&OutSum=${amount}&InvId=${paymentId}&SignatureValue=${signature}&Email=${encodeURIComponent(
    email
  )}&IsTest=0`;
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
app.use(bodyParser.json());

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
    await ctx.reply(
      "Произошла ошибка. Пожалуйста, начните регистрацию заново."
    );
    return;
  }

  switch (action) {
    case "register":
    case "register_from_info":
      await ctx.reply(messages.enterName);
      session.step = "awaiting_name";
      await session.save();
      break;

    case "info":
      await ctx.reply(messages.webinarInfo, {
        reply_markup: new InlineKeyboard().add({
          text: "Записаться на вебинар",
          callback_data: "register_from_info",
        }),
      });
      break;

    case "edit_info":
      await ctx.reply(messages.editChoice, {
        reply_markup: new InlineKeyboard()
          .add({ text: "ФИ", callback_data: "edit_name" })
          .add({ text: "Телефон", callback_data: "edit_phone" })
          .add({ text: "E-mail", callback_data: "edit_email" }),
      });
      session.step = "awaiting_edit";
      await session.save();
      break;

    case "confirm_payment":
      if (session.step === "awaiting_confirmation") {
        await ctx.reply("Выберите тип карты для оплаты:", {
          reply_markup: new InlineKeyboard()
            .add({ text: "Российская (₽)", callback_data: "rubles" })
            .add({ text: "Зарубежная (€)", callback_data: "euros" }),
        });
        session.step = "awaiting_payment_type";
        await session.save();
      }
      break;

    case "rubles":
    case "euros":
      const paymentId = generateUniqueId();
      session.paymentId = paymentId;
      await session.save();

      let paymentLink;

      if (action === "rubles") {
        paymentLink = generatePaymentLinkRobokassa(paymentId, 3, session.email);
        await ctx.reply("Нажмите на кнопку ниже для оплаты в рублях:", {
          reply_markup: new InlineKeyboard().add({
            text: "Оплатить в ₽",
            url: paymentLink,
          }),
        });
      } else if (action === "euros") {
        try {
          const priceId = await createPrice();
          paymentLink = await createPaymentLink(priceId);
          await ctx.reply("Нажмите на кнопку ниже для оплаты в евро:", {
            reply_markup: new InlineKeyboard().add({
              text: "Оплатить в €",
              url: paymentLink,
            }),
          });
          session.paymentId = priceId; // Сохраняем priceId для евро
        } catch (error) {
          await ctx.reply(
            "Произошла ошибка при создании ссылки для оплаты. Попробуйте снова позже."
          );
          return;
        }
      }

      await sendToAirtable(
        session.name,
        session.email,
        session.phone,
        ctx.from.id,
        session.paymentId // Используем paymentId или priceId в зависимости от типа оплаты
      );

      session.step = "completed";
      await session.save();
      break;

    case "edit_name":
    case "edit_phone":
    case "edit_email":
      session.step = `awaiting_edit_${action.replace("edit_", "")}`;
      await ctx.reply(
        messages[
          `edit${
            action.replace("edit_", "").charAt(0).toUpperCase() +
            action.replace("edit_", "").slice(1)
          }`
        ]
      );
      await session.save();
      break;

    default:
      await ctx.reply("Неизвестное действие.");
      break;
  }
});

// Обработчик для ввода данных
bot.on("message:text", async (ctx) => {
  const session = await Session.findOne({ userId: ctx.from.id.toString() });

  if (!session) {
    await ctx.reply(
      "Произошла ошибка. Пожалуйста, начните регистрацию заново."
    );
    return;
  }

  switch (session.step) {
    case "awaiting_name":
      session.name = ctx.message.text;
      await ctx.reply(messages.enterPhone);
      session.step = "awaiting_phone";
      await session.save();
      break;

    case "awaiting_phone":
      const phone = ctx.message.text;
      if (/^\+\d+$/.test(phone)) {
        session.phone = phone;
        await ctx.reply(messages.enterEmail);
        session.step = "awaiting_email";
        await session.save();
      } else {
        await ctx.reply(messages.invalidPhone);
      }
      break;

    case "awaiting_email":
      session.email = ctx.message.text;
      const confirmationMessage = messages.confirmation
        .replace("{{ $ФИ }}", session.name)
        .replace("{{ $Tel }}", session.phone)
        .replace("{{ $email }}", session.email);

      await ctx.reply(confirmationMessage, {
        reply_markup: new InlineKeyboard()
          .add({ text: "Все верно", callback_data: "confirm_payment" })
          .row()
          .add({ text: "Редактировать", callback_data: "edit_info" }),
      });
      session.step = "awaiting_confirmation";
      await session.save();
      break;

    case "awaiting_edit_name":
    case "awaiting_edit_phone":
    case "awaiting_edit_email":
      const editField = session.step.replace("awaiting_edit_", "");
      session[editField] = ctx.message.text;
      await ctx.reply(`Ваше ${editField} обновлено.`);
      session.step = "awaiting_confirmation";
      await ctx.reply(
        messages.confirmation
          .replace("{{ $ФИ }}", session.name)
          .replace("{{ $Tel }}", session.phone)
          .replace("{{ $email }}", session.email),
        {
          reply_markup: new InlineKeyboard()
            .add({ text: "Все верно", callback_data: "confirm_payment" })
            .row()
            .add({ text: "Редактировать", callback_data: "edit_info" }),
        }
      );
      await session.save();
      break;

    default:
      await ctx.reply(
        "Неизвестный шаг. Пожалуйста, начните регистрацию заново."
      );
      break;
  }
});

// Запуск бота
bot.start();
