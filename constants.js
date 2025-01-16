require("dotenv").config();

const totalMarginSize = parseFloat(process.env.TOTAL_MARGIN_SIZE);
const targetLeverage = parseFloat(process.env.TARGET_LEVERAGE);
const MANUAL_BUY = process.env.MANUAL_BUY;
const MANUAL_SELL = process.env.MANUAL_SELL;
const BYBIT_API_KEY = process.env.BYBIT_API_KEY;
const BYBIT_API_SECRET = process.env.BYBIT_API_SECRET;
const LONG_TAKE_PROFIT_1 = parseFloat(process.env.LONG_TAKE_PROFIT_PERCENT_1);
const LONG_TAKE_PROFIT_2 = parseFloat(process.env.LONG_TAKE_PROFIT_PERCENT_2);
const SHORT_TAKE_PROFIT_1 = parseFloat(process.env.SHORT_TAKE_PROFIT_PERCENT_1);
const SHORT_TAKE_PROFIT_2 = parseFloat(process.env.SHORT_TAKE_PROFIT_PERCENT_2);
const LONG_STOP_LOSS = parseFloat(process.env.LONG_STOP_LOSS_PERCENT);
const SHORT_STOP_LOSS = parseFloat(process.env.SHORT_STOP_LOSS_PERCENT);
const TAKE_PROFIT_QUANTITY = parseFloat(process.env.TAKE_PROFIT_QUANTITY);
const TAKER_FEE_RATE = parseFloat(process.env.TAKER_FEE_RATE);
const MAKER_FEE_RATE = parseFloat(process.env.MAKER_FEE_RATE);
const RESULT_NUMBER = parseInt(process.env.RESULT_NUMBER, 10);
const DAY_LENGTH = parseInt(process.env.DAY_LENGTH, 10);
const EXTRA_SYMBOLS = process.env.EXTRA_SYMBOLS
  ? process.env.EXTRA_SYMBOLS.split(",")
  : [];
let startDate = new Date(process.env.START_DATE);
let endDate = process.env.END_DATE
  ? new Date(process.env.END_DATE)
  : new Date();

const useTestnet = false;

module.exports = {
  totalMarginSize,
  targetLeverage,
  BYBIT_API_KEY,
  BYBIT_API_SECRET,
  LONG_TAKE_PROFIT_1,
  LONG_TAKE_PROFIT_2,
  SHORT_TAKE_PROFIT_1,
  SHORT_TAKE_PROFIT_2,
  LONG_STOP_LOSS,
  SHORT_STOP_LOSS,
  TAKE_PROFIT_QUANTITY,
  TAKER_FEE_RATE,
  MAKER_FEE_RATE,
  RESULT_NUMBER,
  DAY_LENGTH,
  EXTRA_SYMBOLS,
  startDate,
  endDate,
  useTestnet,
  MANUAL_SELL,
  MANUAL_BUY,
};
