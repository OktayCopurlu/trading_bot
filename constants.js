require("dotenv").config();

const totalMarginSize = parseFloat(process.env.TOTAL_MARGIN_SIZE);
const targetLeverage = parseFloat(process.env.TARGET_LEVERAGE);
const BYBIT_API_KEY = process.env.BYBIT_API_KEY;
const BYBIT_API_SECRET = process.env.BYBIT_API_SECRET;

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
  startDate,
  endDate,
  useTestnet,
};
