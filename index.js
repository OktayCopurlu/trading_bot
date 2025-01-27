const { RestClientV5 } = require("bybit-api");
const express = require("express");
require("dotenv").config();
const { setLeverage } = require("./setLeverage");
const telegramListener = require("./telegramListener");
const {
  BYBIT_API_KEY,
  BYBIT_API_SECRET,
  startDate,
  endDate,
  useTestnet,
} = require("./constants");

// Bybit client
const bybitClient = new RestClientV5({
  key: BYBIT_API_KEY,
  secret: BYBIT_API_SECRET,
  testnet: useTestnet,
});

// Express server for webhook
const app = express();
app.use(express.json());

// Start the server
const PORT = process.env.PORT || 8888;
app.listen(PORT, () => {
  telegramListener();
  console.log(`Server is running on port ${PORT}`);
});

if (startDate === undefined || endDate === undefined) {
  startDate = new Date();
  startDate.setDate(startDate.getDate() - DAY_LENGTH);
  endDate = new Date();
}

// const signal = parseSignal(`
//   ✅Entry : $35.5 - $34.932

// (🚨 LONG AVAX/USDT 20x 🚨)

// 🎯 Target 1 $35.7485
// 🎯 Target 2 $36.0325
// 🎯 Target 3 $36.494
// 🎯 Target 4 $36.92
// 🎯 Target 5 $37.8075
// 🎯 Target 6 $39.05

// 🚫Stop loss : $33.9025
// `);

// if (signal) {
//   const response = placeOrder(signal);
// }
