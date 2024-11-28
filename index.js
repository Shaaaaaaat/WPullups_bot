require("dotenv").config();
const { Bot, InlineKeyboard, Keyboard, session } = require("grammy");
const express = require("express");
const bodyParser = require("body-parser");
const crypto = require("crypto");
const stripe = require("stripe")(process.env.STRIPE_KEY); // Добавьте эту строку
const fs = require("fs");
const axios = require("axios");
const connectDB = require("./database");
const Session = require("./sessionModel");

// Логируем запуск приложения с информацией о пользователе
console.log("Приложение запущено");

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
function generatePaymentLink(paymentId, sum, email) {
  const shopId = process.env.ROBO_ID; // Логин вашего магазина в Робокассе
  const secretKey1 = process.env.ROBO_SECRET1; // Secret Key 1 для формирования подписи

  const signature = crypto
    .createHash("md5")
    .update(`${shopId}:${sum}:${paymentId}:${secretKey1}`)
    .digest("hex");

  return `https://auth.robokassa.ru/Merchant/Index.aspx?MerchantLogin=${shopId}&OutSum=${sum}&InvId=${paymentId}&SignatureValue=${signature}&Email=${encodeURIComponent(
    email
  )}&IsTest=0`; // Используйте https://auth.robokassa.ru/ для продакшена
}

// Функция для создания объекта Price
async function createStripePriceAMD(amount, currency, productName) {
  const price = await stripe.prices.create({
    unit_amount: amount * 100, // 100 евро в центах
    currency: currency.toLowerCase(),
    product_data: {
      name: productName,
    },
  });
  return price.id;
}

async function generatePaymentLinkFirst(studio, email) {
  const studioInfo = studioDetails[studio];

  if (!studioInfo) {
    throw new Error("Студия не найдена");
  }

  const paymentId = generateUniqueId(); // Генерируем уникальный ID для платежа
  const sum = studioInfo.price;
  const currency = studioInfo.currency;
  const e = email;

  if (studioInfo.paymentSystem === "robokassa") {
    // Генерация ссылки для Robokassa
    const paymentLink = generatePaymentLink(paymentId, sum, e);
    return { paymentLink, paymentId };
  } else if (studioInfo.paymentSystem === "stripeAMD") {
    // Генерация ссылки для Stripe
    const priceId = await createStripePriceAMD(
      studioInfo.price,
      currency,
      studio
    );
    const paymentLink = await createStripePaymentLink(priceId, paymentId);
    return { paymentLink, paymentId };
  } else {
    throw new Error("Неизвестная платёжная система");
  }
}

async function generateSecondPaymentLink(buy, email) {
  const actionInfo = actionData[buy];

  if (!actionInfo) {
    throw new Error("Информация не найдена");
  }

  const paymentId = generateUniqueId(); // Генерируем уникальный ID для платежа
  const sum = actionInfo.sum;
  const currency = actionInfo.currency;
  const studio = actionInfo.studio;
  const e = email;

  if (actionInfo.paymentSystem === "robokassa") {
    // Генерация ссылки для Robokassa
    const paymentLink = generatePaymentLink(paymentId, sum, e);
    return { paymentLink, paymentId };
  } else if (actionInfo.paymentSystem === "stripeAMD") {
    // Генерация ссылки для Stripe
    const priceId = await createStripePriceAMD(
      actionInfo.sum,
      currency,
      studio
    );
    const paymentLink = await createStripePaymentLink(priceId, paymentId);
    return { paymentLink, paymentId };
  } else if (actionInfo.paymentSystem === "stripeEUR") {
    // Генерация ссылки для Stripe
    const priceId = await createStripePriceEUR(
      actionInfo.sum,
      currency,
      studio
    );
    const paymentLink = await createStripePaymentLink(priceId, paymentId);
    return { paymentLink, paymentId };
  } else {
    throw new Error("Неизвестная платёжная система");
  }
}

// Функция для создания цены в Stripe
async function createStripePriceEUR(amount, currency, productName) {
  const price = await stripe.prices.create({
    unit_amount: amount * 100, // Stripe принимает сумму в минимальных единицах (центах)
    currency: currency.toLowerCase(),
    product_data: {
      name: productName,
    },
  });
  return price.id;
}

// Функция для создания ссылки на оплату через Stripe
async function createStripePaymentLink(priceId, paymentId) {
  const paymentLink = await stripe.paymentLinks.create({
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    metadata: {
      paymentId: paymentId, // Передаем идентификатор заказа
    },
  });
  return paymentLink.url;
}

const actionData = {
  buy_6900_ds_rub: {
    sum: 6900,
    lessons: 1,
    tag: "pullups_for_ladies_rub",
    currency: "RUB",
    paymentSystem: "robokassa",
  },
  buy_69_ds_eur: {
    sum: 69,
    lessons: 1,
    tag: "pullups_for_ladies_eur",
    currency: "EUR",
    paymentSystem: "stripeEUR",
    studio: "pullups_for_ladies",
  },
};

// Объект с данными для различных типов кнопок
const buttonsData = {
  ds: {
    RUB: [
      {
        text: "1 занятие (1 100₽) — действует 4 недели",
        callback_data: "buy_1100_ds_rub",
      },
      {
        text: "12 занятий (9 600₽) — действует 6 недель",
        callback_data: "buy_9600_ds_rub",
      },
      {
        text: "36 занятий (23 400₽) — действует 14 недель",
        callback_data: "buy_23400_ds_rub",
      },
    ],
    EUR: [
      {
        text: "12 занятий (105€) — действует 6 недель",
        callback_data: "buy_105_ds_eur",
      },
      {
        text: "36 занятий (249€) — действует 14 недель",
        callback_data: "buy_249_ds_eur",
      },
    ],
  },
};

const studioDetails = {
  handstand_ru: {
    price: 5400,
    currency: "RUB",
    tag: "handstand",
    paymentSystem: "robokassa",
  },
  handstand_eur: {
    price: 54,
    currency: "EUR",
    tag: "handstand",
    paymentSystem: "stripeEUR",
  },
};

// Функция для получения данных о ценах и расписании в зависимости от студии
function getPriceAndSchedule(studio) {
  const priceSchedule = {
    super_calisthenics:
      "Стоимость онлайн-курса «SuperCalisthenics»:\n👉🏻 12 занятий (доступ 6 недель):\n9600₽ | 105€\n👉🏻 36 занятий (доступ 14 недель):\n23400₽ | 249€\n👉🏻 Пробная тренировка (тест-силы)\n950₽ | 10€",
    handstand:
      "Курс «Cногшибательная стойка на руках»\n👉🏻 С тренером: 5400₽ | 59€ \n👉🏻 Только видео-уроки: 2700₽ | 29€",
  };

  return (
    priceSchedule[studio] || "Цена и расписание зависят от выбранной программы."
  );
}

// Функция для получения информации о пользователе из Airtable
async function getUserInfo(tgId) {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const clientsId = process.env.AIRTABLE_CLIENTS_ID;

  const url = `https://api.airtable.com/v0/${baseId}/${clientsId}?filterByFormula={tgId}='${tgId}'`;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
  };

  try {
    const response = await axios.get(url, { headers });
    const records = response.data.records;

    if (records.length > 0) {
      const email = records[0].fields.email || "нет email"; // Если email отсутствует, выводим сообщение
      const tag = records[0].fields.Tag || "неизвестен"; // Если тег отсутствует, выводим "неизвестен"
      const balance =
        records[0].fields.Balance !== undefined
          ? records[0].fields.Balance
          : "0";
      const currency = records[0].fields.Currency || "неизвестна"; // Если валюты нет, выводим "неизвестна"
      return { email, tag, balance, currency };
    } else {
      return null; // Если запись не найдена, возвращаем null
    }
  } catch (error) {
    console.error(
      "Error fetching user info from Airtable:",
      error.response ? error.response.data : error.message
    );
    return null; // В случае ошибки возвращаем null
  }
}

// Функция для генерации клавиатуры на основе тега пользователя
function generateKeyboard(tag) {
  let keyboard = new InlineKeyboard();
  console.log("Отправляю кнопки для оплаты");

  if (tag === "ds_rub") {
    buttonsData.ds.RUB.forEach((button) => keyboard.add(button).row());
  } else if (tag === "ds_eur") {
    buttonsData.ds.EUR.forEach((button) => keyboard.add(button).row());
  } else {
    // Если тег не распознан, возвращаем null
    return null;
  }
  return keyboard;
}

// Функция для отправки данных на вебхук
async function sendToWebhook(studio, telegramId) {
  const webhookUrl =
    "https://hook.eu1.make.com/dg644dcxuiuxrj57lugpl4dkuwv4pyvw"; // Вставьте ваш URL вебхука

  // Формируем данные для отправки
  const data = [
    {
      messenger: "telegram",
      variables: [
        {
          name: "studio",
          type: "text",
          value: studio, // Передаем выбранную студию
        },
      ],
      telegram_id: telegramId, // Передаем id пользователя
    },
  ];

  try {
    // Отправляем POST-запрос на вебхук Make.com
    await axios.post(webhookUrl, data);
    console.log("Данные успешно отправлены на вебхук");
  } catch (error) {
    console.error("Ошибка при отправке на вебхук:", error.message);
  }
}

// Функция для отправки данных в Airtable
async function sendFirstAirtable(tgId, name, nickname) {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const idId = process.env.AIRTABLE_IDS_ID;

  const url = `https://api.airtable.com/v0/${baseId}/${idId}`;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  const data = {
    fields: {
      tgId: tgId,
      FIO: name,
      Nickname: nickname,
    },
  };

  try {
    const response = await axios.post(url, data, { headers });
    return response.data.id; // Возвращаем идентификатор записи
    // await axios.post(url, data, { headers });
  } catch (error) {
    console.error(
      "Error sending data to Airtable:",
      error.response ? error.response.data : error.message
    );
  }
}

// Функция для обновления записи в Airtable
async function updateAirtableRecord(id, city, studio) {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const tableId = process.env.AIRTABLE_IDS_ID;

  const url = `https://api.airtable.com/v0/${baseId}/${tableId}/${id}`;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  const data = {
    fields: {
      City: city,
      Studio: studio,
    },
  };

  try {
    await axios.patch(url, data, { headers }); // Используем PATCH для обновления
  } catch (error) {
    console.error(
      "Error updating data in Airtable:",
      error.response ? error.response.data : error.message
    );
  }
}

// Функция для отправки данных в Airtable
async function sendToAirtable(name, email, phone, tgId, city, studio) {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const tableId = process.env.AIRTABLE_LEADS_ID;

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
      City: city,
      Studio: studio,
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

// Функция для отправки данных в Airtable 2
async function sendTwoToAirtable(tgId, invId, sum, lessons, tag, date, nick) {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const buyId = process.env.AIRTABLE_BUY_ID;

  const url = `https://api.airtable.com/v0/${baseId}/${buyId}`;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  const data = {
    fields: {
      tgId: tgId,
      inv_id: invId,
      Sum: sum,
      Lessons: lessons,
      Tag: tag,
      Date: date,
      Nickname: nick,
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

// Функция для отправки данных в Airtable 2
async function thirdTwoToAirtable(tgId, invId, sum, lessons, tag) {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const buyId = process.env.AIRTABLE_BUY_ID;

  const url = `https://api.airtable.com/v0/${baseId}/${buyId}`;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  const data = {
    fields: {
      tgId: tgId,
      inv_id: invId,
      Sum: sum,
      Lessons: lessons,
      Tag: tag,
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
  const user = ctx.from;
  const tgId = ctx.from.id;
  console.log(`ID: ${user.id}`);
  console.log(`Имя: ${user.first_name}`);
  console.log(`Фамилия: ${user.last_name || "не указана"}`);
  console.log(`Ник: ${user.username || "не указан"}`);
  console.log(`Команда /start от пользователя: ${user.id}`);

  try {
    await ctx.reply("Привет! Подскажите, пожалуйста, что вас интересует?", {
      reply_markup: new InlineKeyboard().add({
        text: "Онлайн-курс «Подтягивания для девушек»",
        callback_data: "pullups_for_ladies",
      }),
    });
  } catch (error) {
    console.error(`Не удалось отправить сообщение`, error);
  }
});

// Обработчик выбора города
bot.on("callback_query:data", async (ctx) => {
  const action = ctx.callbackQuery.data;
  const session = await Session.findOne({ userId: ctx.from.id.toString() });

  let city = "pullups_for_ladies";
  let studio = "pullups_for_ladies";

  const fullName = `${ctx.from.first_name} ${ctx.from.last_name || ""}`.trim();

  // Сохраняем выбранную студию в сессии
  session.city = "pullups_for_ladies";
  session.studio = "pullups_for_ladies";
  // Сохраняем идентификатор записи в сессии
  const airtableId = await sendFirstAirtable(
    ctx.from.id,
    fullName,
    ctx.from.username
  );
  session.airtableId = airtableId; // Сохраняем airtableId в сессии
  await session.save();

  // Обновляем запись в Airtable
  await updateAirtableRecord(session.airtableId, session.city, session.studio);

  if (action === "pullups_for_ladies") {
    // Отправляем сообщение с основным меню
    await ctx.reply(
      "Наши тренировки помогут вам:\n▫️Стать сильнее\n▫️Повысить тонус\n▫️Научиться подтягиваться\n▫️Найти друзей и единомышленников\n\nВоспользуйтесь нижним меню, чтобы выбрать нужную команду.",
      {
        reply_markup: new Keyboard()
          .text("💃🏻 Купить курс по спец. цене")
          .row()
          .text("🤸🏼‍♀️ Как проходят занятия")
          .text("❓ FAQ")
          .resized(), // делает клавиатуру компактной
      }
    );
  } else if (action === "edit_info") {
    console.log("Изменение данных (ФИ, тел., email)");
    await ctx.reply("Что хотите поменять?", {
      reply_markup: new InlineKeyboard()
        .add({ text: "ФИ", callback_data: "edit_name" })
        .add({ text: "Телефон", callback_data: "edit_phone" })
        .add({ text: "E-mail", callback_data: "edit_email" }),
    });
    session.step = "awaiting_edit";
    await session.save(); // Сохранение сессии после изменения шага
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
  } else if (session.step === "awaiting_confirmation") {
    if (action === "confirm_payment") {
      console.log("Данные подвердил");

      try {
        await bot.api.sendMessage(
          -4510303967,
          `Заявка на тренировку в ${session.studio}\nИмя: ${
            session.name
          }\nТел: ${session.phone}\nEmail: ${session.email}\nНик: @${
            ctx.from?.username || "не указан"
          }\nID: ${ctx.from?.id}`
        );
      } catch (error) {
        console.error(`Не удалось отправить сообщение`, error);
      }

      if (
        session.studio === "pullups_for_ladies" ||
        session.studio === "handstand"
      ) {
        await ctx.reply(
          "Спасибо! Какой картой вам будет удобнее оплатить курс?",
          {
            reply_markup: new InlineKeyboard()
              .add({ text: "Российской картой", callback_data: "russian_card" })
              .row()
              .add({
                text: "Зарубежной картой",
                callback_data: "foreign_card",
              }),
          }
        );
        session.step = "awaiting_card_type";
        await session.save(); // Сохранение сессии после изменения шага
      }

      // Отправляем данные в Airtable
      await sendToAirtable(
        session.name, // Имя пользователя
        session.email, // Email пользователя
        session.phone, // Телефон пользователя
        ctx.from.id, // Telegram ID пользователя
        session.city, // Город пользователя
        session.studio // Студия пользователя
      );
    }
  } else if (session.step === "awaiting_card_type") {
    if (action === "russian_card") {
      console.log("Выбрали россискую карту, отправляю тарифы");
      // Получаем данные студии из сессии и telegram_id

      if (session.studio === "pullups_for_ladies") {
        console.log("Отправляю тарифы");
        await ctx.reply("Выберите подходящий тариф для оплаты:", {
          reply_markup: new InlineKeyboard().add({
            text: "Спец. цена 6900₽ / месяц",
            callback_data: "buy_6900_ds_rub",
          }),
        });
        session.step = "online_buttons";
        await session.save(); // Сохранение сессии после изменения шага
      } else if (session.studio === "handstand") {
        console.log("Отправляю тарифы");
        await ctx.reply("Выберите подходящий тариф для оплаты:", {
          reply_markup: new InlineKeyboard()
            .add({
              text: "Курс с тренером 5400₽",
              callback_data: "buy_5400_handstand_rub",
            })
            .row()
            .add({
              text: "Только видео-уроки 2700₽",
              callback_data: "buy_2700_handstand_rub",
            }),
        });
        session.step = "online_buttons";
        await session.save(); // Сохранение сессии после изменения шага
      }
    } else if (action === "foreign_card") {
      console.log("Выбрали зарбужную карту, отправляю тарифы");
      if (session.studio === "pullups_for_ladies") {
        console.log("Отправляю тарифы");
        await ctx.reply("Выберите подходящий тариф для оплаты:", {
          reply_markup: new InlineKeyboard().add({
            text: "Спец. цена 69€ / месяц",
            callback_data: "buy_69_ds_eur",
          }),
        });
        session.step = "online_buttons";
        await session.save(); // Сохранение сессии после изменения шага
      } else if (session.studio === "handstand") {
        console.log("Отправляю тарифы");
        await ctx.reply("Выберите подходящий тариф для оплаты:", {
          reply_markup: new InlineKeyboard()
            .add({
              text: "Курс с тренером 59€",
              callback_data: "buy_59_handstand_eur",
            })
            .row()
            .add({
              text: "Только видео-уроки 29€",
              callback_data: "buy_29_handstand_eur",
            }),
        });
        session.step = "online_buttons";
        await session.save(); // Сохранение сессии после изменения шага
      }
    }
  } else if (session.step === "online_buttons") {
    console.log("генерирую ссылку для оплаты после нажатия кнопки с тарифом");
    // Генерация ссылки для оплаты
    const actionInfo = actionData[ctx.callbackQuery.data];
    const { paymentLink, paymentId } = await generateSecondPaymentLink(
      action,
      session.email
    );

    // Отправляем пользователю ссылку на оплату
    await ctx.reply(`Для оплаты перейдите по ссылке: ${paymentLink}`);

    await thirdTwoToAirtable(
      ctx.from.id,
      paymentId,
      actionInfo.sum,
      actionInfo.lessons,
      actionInfo.tag
    );
  } else if (action.startsWith("day")) {
    const buttonText = action.split(",")[1];
    const date = buttonText.match(/\(([^)]+)\)/);
    const str = JSON.stringify(date[1]);
    const str2 = JSON.parse(str);
    console.log(`Выбрал дату групповой тренировки - ${str2}`);

    // Генерация ссылки на оплату и получение paymentId
    const { paymentLink, paymentId } = await generatePaymentLinkFirst(
      session.studio,
      session.email
    );
    console.log("Отправляю ссылку для оплаты");
    await ctx.reply(
      `Отлично! Вы выбрали: ${buttonText}. Для подтверждения записи оплатите, пожалуйста, тренировку по ссылке ниже. После оплаты вы получите сообщение с подтверждением записи.`
    );
    await ctx.reply(`Для оплаты перейдите по ссылке: ${paymentLink}`);
    session.step = "completed";
    await session.save();
    // Отправка данных в Airtable
    const sum = studioDetails[session.studio].price;
    const lessons = 1;
    const tag = studioDetails[session.studio].tag; // Берем тег из студии
    await sendTwoToAirtable(
      ctx.from.id,
      paymentId,
      sum,
      lessons,
      tag,
      str2,
      ctx.from.username
    );
  } else if (action.startsWith("later")) {
    console.log("Выбрал позже указать дату групповой тренировки");
    await ctx.reply(
      `Пожалуйста, укажите ориентировочную дату тренировки в формате дд.мм\n\nЗа два дня до этой даты я вышлю актуальное расписание для выбора дня.`
    );

    // Сохраняем статус ожидания даты
    session.step = "awaiting_later_date";
    await session.save();
  } else if (action.startsWith("a_da")) {
    console.log("  тренировки с нами");
    try {
      const tgId = ctx.from.id;
      const userInfo = await getUserInfo(tgId);
      const session = await Session.findOne({ userId: tgId.toString() });
      if (userInfo) {
        const { tag, currency } = userInfo;
        const keyboard = generateKeyboard(tag);
        if (keyboard) {
          await ctx.reply(
            "Рад слышать! Чтобы записаться на следующую тренировку, пожалуйста, выберите и оплатите подходящий тариф из списка ниже:",
            {
              reply_markup: keyboard,
            }
          );
        } else {
          await ctx.reply(
            "Ваш тег не распознан. Пожалуйста, обратитесь к поддержке."
          );
        }
        // Сохраняем информацию о выборе тарифа в сессии
        session.selectedTag = tag;
        session.currency = currency;
        await session.save(); // Сохраняем обновленную сессию
      }
    } catch (error) {
      console.error("Произошла ошибка:", error);
    }
  } else if (action.startsWith("buy")) {
    console.log("генерирую ссылку для оплаты после нажатия кнопки с тарифом");

    const userInfo = await getUserInfo(ctx.from.id);
    // const { tag, email } = userInfo;
    const email = userInfo?.email || session?.email;
    const tag = userInfo?.tag || "Отсутствует";

    try {
      await bot.api.sendMessage(
        -4510303967,
        `Выставлен счет - Заявка на тренировку в ${tag}\nEmail: ${email}\nНик: @${
          ctx.from?.username || "не указан"
        }\nID: ${ctx.from?.id}`
      );
    } catch (error) {
      console.error(`Не удалось отправить сообщение`, error);
    }

    // Генерация ссылки для оплаты
    const actionInfo = actionData[action];
    const { paymentLink, paymentId } = await generateSecondPaymentLink(
      action,
      email
    );

    // Отправляем пользователю ссылку на оплату
    await ctx.reply(`Для оплаты перейдите по ссылке: ${paymentLink}`);

    await thirdTwoToAirtable(
      ctx.from.id,
      paymentId,
      actionInfo.sum,
      actionInfo.lessons,
      actionInfo.tag
    );
  } else if (action.startsWith("a_net")) {
    console.log("НЕТ - не планиурет продолжать тренировки с нами");
    // Отправляем сообщение с просьбой поделиться причиной отказа
    await ctx.reply(
      "Очень жаль, что вы решили не продолжать тренировки с нами. Пожалуйста, расскажите, почему вы приняли такое решение. Может быть, что-то не понравилось или у вас есть вопросы? Нам важно ваше мнение, чтобы стать лучше!"
    );

    // Устанавливаем шаг в сессии для обработки ответа пользователя
    session.step = "awaiting_feedback";
    await session.save();
  }
});

// Обработчик для нажатий обычных кнопок
bot.on("message:text", async (ctx) => {
  let session = await Session.findOne({ userId: ctx.from.id.toString() });
  const userMessage = ctx.message.text;
  const tgId = ctx.from.id;

  // Если сессия не найдена, создаём новую
  if (!session) {
    console.log(`Сессия не найдена для пользователя ${tgId}. Создаём новую.`);
    session = new Session({
      userId: tgId,
      step: "start_сlient",
      userState: {},
    });
    await session.save();
  }

  if (session.userState?.awaitingDeposit === true) {
    const text = ctx.message.text.trim().toLowerCase();
    const sum = parseFloat(text);
    if (isNaN(sum) || sum <= 0) {
      await ctx.reply("Пожалуйста, введите корректную сумму.");
      return;
    }
    // Получаем информацию о пользователе
    const userInfo = await getUserInfo(tgId);
    if (!userInfo) {
      await ctx.reply("Не удалось получить информацию о пользователе.");
      return;
    }

    const paymentId = generateUniqueId();
    const paymentLink = generatePaymentLink(paymentId, sum, userInfo.email);
    await ctx.reply(`Отлично! Перейдите по ссылке для оплаты: ${paymentLink}`);

    // Отправляем данные о депозите в Airtable
    await sendTwoToAirtable(
      tgId,
      paymentId,
      sum,
      0,
      "deposit",
      "deposit",
      ctx.from.username
    );

    // // Сбрасываем состояние пользователя
    // delete session.userState;
    // return;
    // Сбрасываем состояние
    session.userState = {}; // Очистка состояния
    await session.save();
  }
  // Проверка на ожидаемый ответ о времени тренировки
  if (session.step === "awaiting_personal_training_details") {
    const priceTag = session.priceTag; // Достаем priceTag из сессии
    const city = session.city;
    const place = session.studio;

    // Подтверждаем пользователю, что его запрос отправлен
    await ctx.reply(
      "Спасибо! Я свяжусь с тренером и подберу для вас удобное время. Как только согласуем все детали, по ссылке ниже можно будет оплатить занятие для подтверждения записи. Ожидайте, скоро вернусь с новостями 😊"
    );

    // // Получаем список адресатов для этой студии
    // const recipients = RECIPIENTS_BY_STUDIO[session.studio] || []; // Берем студию из сессии
    // const username = ctx.from.username ? `@${ctx.from.username}` : "Без ника"; // Определяем никнейм пользователя или заменяем на "Без ника"

    // // Отправляем сообщение каждому адресату из списка для этой студии
    // try {
    //   await bot.api.sendMessage(
    //     -4510303967,
    //     `Запрос на персональную тренировку от ${username}\nГород: ${session.city} & Студия: ${place}:\n${ctx.message.text}`
    //   );
    // } catch (error) {
    //   console.error(
    //     `Не удалось отправить сообщение пользователю ${recipientId}:`,
    //     error
    //   );
    //   // Можно добавить дополнительные действия, например:
    //   // - логирование ошибки в базе данных
    //   // - уведомление администратора о проблеме
    // }

    // Генерация клавиатуры для персональных тренировок на основе priceTag
    const keyboard = generateKeyboard(priceTag);
    await ctx.reply("Выберите подходящий тариф для оплаты:", {
      reply_markup: keyboard,
    });

    session.step = "completed";
    await session.save();
  }

  if (session.step === "awaiting_feedback") {
    // Получаем имя пользователя для передачи в отчёт
    const username = ctx.from.username ? `@${ctx.from.username}` : "Без ника";

    // Отправляем сообщение в канал/чат для отчетов
    try {
      await bot.api.sendMessage(
        -4510303967, // Замените на ID чата, куда отправлять отчет
        `Пользователь ${username} отказался от тренировок и оставил отзыв:\n"${ctx.message.text}"`
      );
    } catch (error) {
      console.error("Не удалось отправить сообщение с отзывом:", error);
    }

    // Благодарим пользователя за обратную связь
    await ctx.reply(
      "Спасибо, что поделились! Ваше мнение поможет нам стать лучше."
    );

    // Сбрасываем статус после получения обратной связи
    session.step = "completed";
    await session.save();
  }

  // Обработка кнопок для студий
  if (userMessage === "💃🏻 Купить курс по спец. цене") {
    console.log("Нажал на кнопку - 💃🏻 Купить курс по спец. цене");
    // Удаляем стационарное меню
    await ctx.reply("Пожалуйста, введите вашу фамилию и имя:", {
      reply_markup: {
        remove_keyboard: true, // Удаляет текущее стационарное меню
      },
    });

    // Устанавливаем этап в сессии
    session.step = "awaiting_name";
    await session.save(); // Сохраняем состояние сессии
  }

  // Если сообщение начинается с '/', это команда, и мы её обрабатываем отдельно
  else if (userMessage.startsWith("/")) {
    switch (userMessage) {
      case "/operator":
        console.log("Вызвал /operator");
        await ctx.reply(
          "Если у вас остались вопросы, вы можете написать нашему менеджеру Никите: @IDC_Manager, он подскажет 😉"
        );
        break;
      default:
        await ctx.reply("Неизвестная команда. Попробуйте снова.");
    }
    return; // Завершаем обработку, чтобы не продолжать ниже
  } else if (userMessage === "Как проходят тренировки") {
    console.log("Нажал на кнопку - Как проходят тренировки");
    await ctx.reply(
      "У нас не обычные групповые тренировки, где все ученики делают одинаковые задания — у нас персональный подход.\n\nНа первом занятии тренер определит ваш уровень физической подготовки и обсудит основные цели. После этого все тренировки будут написаны с учетом вашего уровня и целей 🔥\n\nМы это делаем с помощью мобильного приложения, где у вас будет свой личный кабинет, история тренировок и результаты❗️\n\nТак мы добиваемся наиболее эффективного подхода для наших учеников 🤍"
    );
  } else if (userMessage === "🤸🏼‍♀️ Как проходят занятия") {
    console.log("Нажал на кнопку - 🤸🏼‍♀️ Как проходят занятия");
    await ctx.reply(
      "1️⃣ Тест-силы:\nНа первой тренировке вы выполните несколько простых упражнений по нашей инструкции и снимете их на видео. Тренер даст детальную обратную связь: расскажет, что делаете неправильно, и отметит ваши сильные стороны 💪🏻\n\n2️⃣ Персональный подход:\nВсе тренировки адаптируются под ваш уровень. Упражнения и инструкции сохраняются в приложении, а каждое движение сопровождается демо-видео и подробным описанием.\n\n3️⃣ Удобство и гибкость:\nТренируйтесь в любое время! Мы рекомендуем записывать хотя бы один подход каждого упражнения на видео, чтобы получить обратную связь.\n\n4️⃣ Поддержка тренера:\nВаши видео всегда просматриваются тренером, который даёт рекомендации, помогает скорректировать технику и поддерживает на каждом этапе."
    );
  } else if (userMessage === "🤸🏼‍♀️ Про курс") {
    console.log("Нажал на кнопку - 🤸🏼‍♀️ Про курс");
    await ctx.reply(
      "Онлайн-курс «Сногшибательная стойка на руках»\n\nПогрузитесь в мир стойки на руках — это не только упражнение для развития силы и чувства баланса, но и великолепное достижение, которое будет вас всегда вдохновлять.\n\nНаша 21-дневная программа собрала все наши знания и наиболее эффективные упражнения, чтобы научить вас мастерству стойки на руках.\n\nПреимущество курса — все занятия можно проходить дома, не требует специального оборудования."
    );
  } else if (userMessage === "Цены и расписание") {
    console.log("Нажал на кнопку - Цены и расписание");
    const priceAndSchedule = getPriceAndSchedule(session.studio);
    await ctx.reply(priceAndSchedule);
  } else if (userMessage === "💰 Цены") {
    console.log("Нажал на кнопку - 💰 Цены");
    const priceAndSchedule = getPriceAndSchedule(session.studio);
    await ctx.reply(priceAndSchedule);
  } else if (userMessage === "⬅️ Назад") {
    console.log("Нажал на кнопку - ⬅️ Назад");
    await ctx.reply("Выберите какой курс вас интересует?", {
      reply_markup: new InlineKeyboard()
        .add({
          text: "Онлайн-курс «SuperCalisthenics»",
          callback_data: "super_calisthenics",
        })
        .row()
        .add({
          text: "Оналйн-курс «Стойка на руках»",
          callback_data: "handstand",
        }),
    });
  } else if (userMessage === "Назад") {
    console.log("Нажал на кнопку - Назад");
    // Удаляем стационарное меню
    await ctx.reply("..", {
      reply_markup: { remove_keyboard: true },
    });
    // Возвращаем клавиатуру для выбора студии в зависимости от города
    let studiosKeyboard;

    if (session.city === "Москва") {
      studiosKeyboard = new InlineKeyboard()
        .add({ text: "м. 1905г.", callback_data: "studio_ycg" })
        .row()
        .add({ text: "Поменять город", callback_data: "change_city" });
    } else if (session.city === "Санкт-Петербург") {
      studiosKeyboard = new InlineKeyboard()
        .add({ text: "м. Петроградкая", callback_data: "studio_rtc" })
        .row()
        .add({ text: "м. Выборгская", callback_data: "studio_hkc" })
        .row()
        .add({
          text: "м. Московские Ворота",
          callback_data: "studio_spi",
        })
        .row()
        .add({ text: "Поменять город", callback_data: "change_city" });
    } else if (session.city === "Ереван") {
      studiosKeyboard = new InlineKeyboard()
        .add({ text: "ул. Бузанда", callback_data: "studio_gof" })
        .row()
        .add({ text: "Поменять город", callback_data: "change_city" });
    }

    // Отправляем сообщение с выбором студии
    await ctx.reply("Выберите студию или поменяйте город:", {
      reply_markup: studiosKeyboard,
    });
  } else if (userMessage === "FAQ") {
    console.log("нажал кнопку FAQ");
    await ctx.reply(
      "По ссылке ниже вы найдете ответы на часто задаваемые вопросы о наших тренировках. \n\nКому подходят такие тренировки, есть ли противопоказания, сколько длятся занятия, как приобрести подарочный сертификат и другие вопросы. \n\nЕсли вы не нашли ответ на свой вопрос, напишите нашему менеджеру Никите @IDC_Manager. ↘️",
      {
        reply_markup: new InlineKeyboard().url(
          "Читать FAQ",
          "https://telegra.ph/I-Do-Calisthenics-FAQ-02-06"
        ),
      }
    );
  } else if (userMessage === "❓ FAQ") {
    console.log("нажал кнопку ❓ FAQ");
    await ctx.reply(
      "По ссылке ниже вы найдете ответы на часто задаваемые вопросы о наших тренировках. \n\nКому подходят такие тренировки, есть ли противопоказания, нужен ли инвентарь, как снимать свои подходы и другие вопросы. ↘️",
      {
        reply_markup: new InlineKeyboard().url(
          "Читать FAQ",
          "https://telegra.ph/I-Do-Calisthenics-Online-FAQ-11-24"
        ),
      }
    );
  } else if (session.step === "awaiting_later_date") {
    const userMessage = ctx.message.text;

    // Проверяем формат даты (дд.мм)
    const dateRegex = /^(0[1-9]|[12][0-9]|3[01])\.(0[1-9]|1[0-2])$/;
    if (dateRegex.test(userMessage)) {
      const [day, month] = userMessage.split(".");
      const year = new Date().getFullYear();
      const date = new Date(year, month - 1, day);

      // Проверяем, что дата в будущем
      const currentDate = new Date();
      currentDate.setHours(0, 0, 0, 0); // Устанавливаем время текущей даты в полночь

      if (date >= currentDate) {
        // Если дата в будущем, продолжаем сценарий
        const reminderDate = new Date(date);
        reminderDate.setDate(reminderDate.getDate() - 2);
        reminderDate.setHours(12, 30, 0, 0); // Устанавливаем фиксированное время

        const userTimezoneOffset = +3; // Пример: для Москвы установлено +3
        const reminderTimeUTC =
          reminderDate.getTime() - userTimezoneOffset * 60 * 60 * 1000;

        session.laterDate = userMessage;
        await session.save();

        const currentTime = Date.now();
        const reminderDelay = reminderTimeUTC - currentTime;

        await ctx.reply(
          `Вы выбрали ${userMessage}. Я свяжусь с вами за два дня до этой даты! \n\nЕсли у вас возникнут вопросы, вы всегда можете обратиться к нашему менеджеру Никите: @IDC_Manager`
        );

        if (reminderDelay > 0) {
          setTimeout(async () => {
            await ctx.reply(
              `Напоминаю, что вы запланировали тренировку на ${userMessage}. Выберите точную дату занятия:`
            );

            const studio = session.studio;
            const telegramId = ctx.from.id;

            // Отправляем данные на вебхук
            await sendToWebhook(studio, telegramId);

            session.step = "awaiting_next_step";
            await session.save();
          }, reminderDelay);
        }

        session.step = "completed";
        await session.save();
      } else {
        // Если дата прошедшая, повторяем запрос
        await ctx.reply(
          "Указанная дата уже прошла. Пожалуйста, выберите дату в будущем."
        );
        // Оставляем состояние "awaiting_later_date"
        session.step = "awaiting_later_date";
        await session.save();
      }
    } else {
      // Если формат неверный, повторяем запрос
      await ctx.reply(
        "Неправильный формат даты. Пожалуйста, используйте формат дд.мм (например, 04.12)."
      );
      // Оставляем состояние "awaiting_later_date"
      session.step = "awaiting_later_date";
      await session.save();
    }
  } else if (session.step === "awaiting_name") {
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
      await ctx.reply("Вы неверно указали номер, попробуйте еще раз");
    }
  } else if (session.step === "awaiting_email") {
    session.email = ctx.message.text;
    const confirmationMessage =
      "Проверьте введенные данные:\nФИ: {{ $ФИ }},\nТелефон: {{ $Tel }},\nEmail: {{ $email }}\n\nЕсли все верно, подтвердите данные"
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
  } else if (session.step.startsWith("awaiting_edit_")) {
    const field = session.step.replace("awaiting_edit_", "");
    if (field === "name") {
      session.name = ctx.message.text;
    } else if (field === "phone") {
      const phone = ctx.message.text;
      if (/^\+\d+$/.test(phone)) {
        session.phone = phone;
      } else {
        await ctx.reply("Вы неверно указали номер, попробуйте еще раз");
        return;
      }
    } else if (field === "email") {
      session.email = ctx.message.text;
    }

    const confirmationMessage =
      "Проверьте введенные данные:\nФИ: {{ $ФИ }},\nТелефон: {{ $Tel }},\nEmail: {{ $email }}\n\nЕсли все верно, подтвердите данные"
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

// Функция для обработки сценария, если пользователь уже есть в базе
async function handleExistingUserScenario(ctx) {
  try {
    const userInfo = await getUserInfo(ctx.from.id);
    if (userInfo) {
      const { tag } = userInfo;

      if (tag.includes("ds")) {
        console.log("получил кнопки меню (ds)");
        const keyboard = new Keyboard()
          .text("Узнать баланс")
          .text("Купить онлайн тренировки");
        await ctx.reply("Привет! Выберите, что вас интересует:", {
          reply_markup: { keyboard: keyboard.build(), resize_keyboard: true },
        });
      } else if (tag.includes("group")) {
        console.log("получил кнопки меню (group)");
        const keyboard = new Keyboard()
          .text("Узнать баланс")
          .text("Купить групповые тренировки");
        await ctx.reply("Привет! Выберите, что вас интересует:", {
          reply_markup: { keyboard: keyboard.build(), resize_keyboard: true },
        });
      } else if (tag.includes("personal")) {
        console.log("получил кнопки меню (personal)");
        const keyboard = new Keyboard()
          .text("Узнать баланс")
          .text("Купить персональные тренировки");
        await ctx.reply("Привет! Выберите, что вас интересует:", {
          reply_markup: { keyboard: keyboard.build(), resize_keyboard: true },
        });
      }
    }
  } catch (error) {
    console.error("Произошла ошибка:", error);
  }
}

// Запуск бота
bot.start();
