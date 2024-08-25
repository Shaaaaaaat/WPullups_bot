const mongoose = require("mongoose");

const sessionSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  name: { type: String, default: "" },
  phone: { type: String, default: "" },
  email: { type: String, default: "" },
  step: { type: String, default: "" },
  paymentStatus: { type: String, default: "" },
  paymentId: { type: String, default: "", index: true }, // Индекс для быстрого поиска
});

const Session = mongoose.model("Session", sessionSchema);

module.exports = Session;
