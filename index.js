const { RestClientV5, WebsocketClient } = require("bybit-api");
const express = require("express");
require("dotenv").config();

const totalMarginSize = process.env.TOTAL_MARGIN_SIZE;
const targetLeverage = process.env.TARGET_LEVERAGE;
const BYBIT_API_KEY = process.env.BYBIT_API_KEY;
const BYBIT_API_SECRET = process.env.BYBIT_API_SECRET;
const LONG_TAKE_PROFIT_1 = process.env.LONG_TAKE_PROFIT_PERCENT_1;
const LONG_TAKE_PROFIT_2 = process.env.LONG_TAKE_PROFIT_PERCENT_2;
const SHORT_TAKE_PROFIT_1 = process.env.SHORT_TAKE_PROFIT_PERCENT_1;
const SHORT_TAKE_PROFIT_2 = process.env.SHORT_TAKE_PROFIT_PERCENT_2;
const LONG_STOP_LOSS = process.env.LONG_STOP_LOSS_PERCENT;
const SHORT_STOP_LOSS = process.env.SHORT_STOP_LOSS_PERCENT;
const TAKE_PROFIT_QUANTITY = process.env.TAKE_PROFIT_QUANTITY;
const TAKER_FEE_RATE = process.env.TAKER_FEE_RATE;
const MAKER_FEE_RATE = process.env.MAKER_FEE_RATE;
const RESULT_NUMBER = process.env.RESULT_NUMBER;
const DAY_LENGTH = process.env.DAY_LENGTH;
const EXTRA_SYMBOLS = process.env.EXTRA_SYMBOLS;
let startDate = new Date(process.env.START_DATE);
let endDate = process.env.END_DATE
  ? new Date(process.env.END_DATE)
  : new Date();

const useTestnet = false;

// Bybit client
const bybitClient = new RestClientV5({
  key: BYBIT_API_KEY,
  secret: BYBIT_API_SECRET,
  testnet: useTestnet,
});

// Express server for webhook
const app = express();
app.use(express.json());

// Function to parse incoming webhook messages
function parseSignal(jsonSignal) {
  try {
    const { symbol, price, signal } = jsonSignal;
    let newSymbol = symbol;
    if (!signal) {
      console.log("No actionable signal found");
      return null;
    }
    // Remove .P suffix if it exists
    if (symbol.includes(".P")) {
      newSymbol = symbol.replace(".P", "").trim();
    }

    return {
      symbol: newSymbol,
      signal,
      entry: parseFloat(price),
    };
  } catch (err) {
    return `Error parsing signal: ${err}`;
  }
}

async function placeOrder(signal) {
  try {
    const side = signal.signal;

    // Fetch market price and instrument details
    const marketPriceData = await bybitClient.getTickers({
      category: "linear",
      symbol: signal.symbol,
    });

    if (marketPriceData.retCode !== 0) {
      return `Failed to get tickers : ${marketPriceData.retMsg}`;
    }

    const symbolPrice = parseFloat(marketPriceData.result.list[0].lastPrice);
    const instrumentDetails = await bybitClient.getInstrumentsInfo({
      category: "linear",
      symbol: signal.symbol,
    });

    if (instrumentDetails.retCode !== 0) {
      return `Failed to get Instruments Info : ${instrumentDetails.retMsg}`;
    }

    const instrument = instrumentDetails.result.list[0];
    const minQty = parseFloat(instrument.lotSizeFilter.minOrderQty);
    const qtyPrecision = parseInt(
      instrument.lotSizeFilter.qtyStep.split(".")[1]?.length || 0
    );
    const tickSize = parseFloat(instrument.priceFilter.tickSize);

    // Calculate the correct quantity for the target leverage
    const targetNotional = totalMarginSize * targetLeverage;
    let calculatedQuantity = (targetNotional / symbolPrice).toFixed(
      qtyPrecision
    );
    calculatedQuantity = Math.max(calculatedQuantity, minQty).toFixed(
      qtyPrecision
    );

    // Calculate limit price
    const priceOffset = tickSize * 5;
    const limitPrice =
      side === "Buy"
        ? (symbolPrice - priceOffset).toFixed(4)
        : (symbolPrice + priceOffset).toFixed(4);

    // Check for existing positions
    const openPositions = await bybitClient.getPositionInfo({
      category: "linear",
      symbol: signal.symbol,
    });

    if (openPositions.result) {
      const openPosition = openPositions.result.list[0];
      const openPositionSide = openPosition.side;

      if (openPositionSide !== side) {
        if (openPositionSide !== "") {
          const orderResponse = await bybitClient.submitOrder({
            category: "linear",
            symbol: signal.symbol,
            side: openPositionSide === "Buy" ? "Sell" : "Buy",
            orderType: "Market",
            qty: openPosition.size,
            timeInForce: "GoodTillCancel",
          });

          if (orderResponse.retCode !== 0) {
            return `Failed to close position: ${orderResponse.retMsg}`;
          }
        }
      } else {
        return `Open ${openPositionSide} position already exists for ${signal.symbol}`;
      }
    }

    if (side !== "Close") {
      // Place the new order
      const response = await bybitClient.submitOrder({
        category: "linear",
        symbol: signal.symbol,
        side,
        orderType: "Market",
        qty: calculatedQuantity,
        price: limitPrice,
      });

      if (response.retCode !== 0) {
        return `Order rejected: ${response.retMsg}`;
      } else {
        console.log(
          `Limit Order placed: ${signal.symbol} ${side}, Quantity: ${calculatedQuantity}, Price: ${limitPrice}`
        );
      }

      // Set Take Profit and Stop Loss
      const takeProfitQuantity = (
        calculatedQuantity * TAKE_PROFIT_QUANTITY
      ).toFixed(qtyPrecision);
      const takeProfitPrice1 =
        side === "Buy"
          ? (symbolPrice * LONG_TAKE_PROFIT_1).toFixed(4) // %25 yukarı fiyat
          : (symbolPrice * SHORT_TAKE_PROFIT_1).toFixed(4); // %25 aşağı fiyat

      const takeProfitPrice2 =
        side === "Buy"
          ? (symbolPrice * LONG_TAKE_PROFIT_2).toFixed(4) // %50 yukarı fiyat
          : (symbolPrice * SHORT_TAKE_PROFIT_2).toFixed(4); // %50 aşağı fiyat

      // Stop Loss hesaplama
      const stopLossPrice =
        side === "Buy"
          ? (symbolPrice * LONG_STOP_LOSS).toFixed(4) // %50 aşağı fiyat
          : (symbolPrice * SHORT_STOP_LOSS).toFixed(4); // %50 yukarı fiyat

      const position = await bybitClient.getPositionInfo({
        category: "linear",
        symbol: signal.symbol,
      });

      if (position.retCode !== 0) {
        return `Failed to close position: ${position.retMsg}`;
      }

      const takeProfitPoints = [takeProfitPrice1, takeProfitPrice2];
      if (position.result.list[0].size > 0) {
        for (let i = 0; i < takeProfitPoints.length; i++) {
          const takeProfitPrice = takeProfitPoints[i];
          const takeProfitResponse = await bybitClient.setTradingStop({
            category: "linear",
            symbol: signal.symbol,
            takeProfit: takeProfitPrice,
            tpTriggerBy: "MarkPrice",
            tpslMode: "Partial",
            tpOrderType: "Limit",
            tpSize: takeProfitQuantity,
            tpLimitPrice: takeProfitPrice,
            positionIdx: 0,
          });

          if (takeProfitResponse.retCode !== 0) {
            console.log(`Take profit rejected: ${takeProfitResponse.retMsg}`);
          } else {
            console.log(
              `Take profit order placed: ${signal.symbol} ${takeProfitQuantity} at ${takeProfitPrice}`
            );
          }
        }

        // Create Stop Loss order
        const stopLossResponse = await bybitClient.setTradingStop({
          category: "linear",
          symbol: signal.symbol,
          stopLoss: stopLossPrice,
          slTriggerBy: "MarkPrice",
        });

        if (stopLossResponse.retCode !== 0) {
          return `Stop Loss rejected: ${stopLossResponse.retMsg}`;
        } else {
          return `Stop Loss set for ${signal.symbol} at ${stopLossPrice}`;
        }
      }
    }
  } catch (error) {
    return `An error occurred while placing the order: ${JSON.stringify(
      error
    )}`;
  }
}

// const signal = parseSignal({
//   symbol: "XRPUSDT",
//   price: "0.31",
//   signal: "Sell",
// });

// if (signal) {
//   const response = placeOrder(signal);
// }

// Start the server
const PORT = process.env.PORT || 3300;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

const SYMBOLS = [
  "1CATUSDT",
  "1000APUUSDT",
  "1000PEPEUSDT",
  "10000WHYUSDT",
  "A8USDT",
  "BENDOGUSDT",
  "CARVUSDT",
  "CVXUSDT",
  "EGLDUSDT",
  "FARTCOINUSDT",
  "GMEUSDT",
  "GRIFFAINUSDT",
  "HBARUSDT",
  "HIVEUSDT",
  "HYPEUSDT",
  "IDEXUSDT",
  "KSMUSDT",
  "LAIUSDT",
  "MAXUSDT",
  "MBLUSDT",
  "RENUSDT",
  "SDUSDT",
  "SILLYUSDT",
  "STPTUSDT",
  "VELODROMEUSDT",
  "VOXELUSDT",
  "WAVESUSDT",
  "ZRCUSDT",
];

const ALL_SYMBOLS = SYMBOLS.concat(
  EXTRA_SYMBOLS ? EXTRA_SYMBOLS.split(",") : []
);

if (startDate === undefined || endDate === undefined) {
  startDate = new Date();
  startDate.setDate(startDate.getDate() - DAY_LENGTH);
  endDate = new Date();
}

async function fetchTradingDataWithTransactionLogs() {
  const results = [];
  let totalClosedPositions = 0;
  let totalPnL = 0;
  let totalFee = 0;
  let totalInvestment = 0;
  let totalInvestmentWithLeverage = 0;

  for (const symbol of ALL_SYMBOLS) {
    try {
      // Kapalı pozisyonları al
      const response = await bybitClient.getClosedPnL({
        category: "linear",
        symbol,
        limit: RESULT_NUMBER,
      });

      if (!response || !response.result || !response.result.list) {
        console.log(`No data returned for ${symbol}`);
        continue;
      }

      const closedPnLData = response.result.list.filter((pos) => {
        const closedTime = new Date(parseInt(pos.updatedTime));
        return closedTime >= startDate && closedTime <= endDate;
      });
      const totalPositions = closedPnLData.length;
      const symbolTotalPnL = closedPnLData.reduce(
        (sum, pos) => sum + parseFloat(pos.closedPnl),
        0
      );

      // Fee Hesaplama
      const symbolTotalFee = closedPnLData.reduce((sum, pos) => {
        const feeRate =
          pos.orderType === "Market" ? TAKER_FEE_RATE : MAKER_FEE_RATE;
        const openingFee =
          parseFloat(pos.avgEntryPrice) * parseFloat(pos.qty) * feeRate;
        const closingFee =
          parseFloat(pos.avgExitPrice) * parseFloat(pos.qty) * feeRate;
        return sum + openingFee + closingFee;
      }, 0);

      // Total Investment Hesaplama
      const symbolTotalInvestment = closedPnLData.reduce((sum, pos) => {
        const leverage = parseFloat(pos.leverage);
        const initialInvestment = parseFloat(pos.cumEntryValue) / leverage;
        return sum + initialInvestment;
      }, 0);

      const symbolTotalInvestmentWithLeverage = closedPnLData.reduce(
        (sum, pos) => {
          const initialInvestment = parseFloat(pos.cumEntryValue);
          return sum + initialInvestment;
        },
        0
      );

      results.push({
        symbol,
        totalPositions,
        totalPnL: symbolTotalPnL.toFixed(2),
        totalFee: symbolTotalFee.toFixed(2),
        totalInvestment: symbolTotalInvestment.toFixed(2),
        totalInvestmentWithLeverage:
          symbolTotalInvestmentWithLeverage.toFixed(2),
      });

      totalClosedPositions += totalPositions;
      totalPnL += symbolTotalPnL;
      totalFee += symbolTotalFee;
      totalInvestment += symbolTotalInvestment;
      totalInvestmentWithLeverage += symbolTotalInvestmentWithLeverage;
    } catch (error) {
      console.error(`Error fetching data for ${symbol}:`, error.message);
    }
  }

  return {
    results,
    totalClosedPositions,
    totalPnL: totalPnL.toFixed(2),
    totalFee: totalFee.toFixed(2),
    totalInvestment: totalInvestment.toFixed(0),
    totalInvestmentWithLeverage: totalInvestmentWithLeverage.toFixed(0),
  };
}

app.get("/", async (req, res) => {
  try {
    const {
      results,
      totalClosedPositions,
      totalPnL,
      totalFee,
      totalInvestment,
      totalInvestmentWithLeverage,
    } = await fetchTradingDataWithTransactionLogs();

    // PnL'leri büyükten küçüğe sırala
    results.sort((a, b) => b.totalPnL - a.totalPnL);

    const options = { day: "2-digit", month: "2-digit", year: "numeric" };
    const formattedStartDate = startDate.toLocaleDateString("de-CH", options);
    const formattedEndDate = endDate.toLocaleDateString("de-CH", options);

    // HTML Tablosu oluştur
    let html = `
      <h1 style="text-align: center;">Trading Bot Last ${RESULT_NUMBER} PnL Results</h1>
      <table border="1" cellpadding="10" cellspacing="0" style="border-collapse: collapse; width: 80%; margin: auto; text-align: center;">
        <thead>
          <tr style="background-color: #f2f2f2;">
            <th>Date Range</th>
            <th>Number of Closed Positions</th>
            <th>Total PnL (USDT)</th>
            <th>Total Fee (USDT)</th>
            <th>Total Investment (USDT)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>${formattedStartDate} - ${formattedEndDate}</td>
            <td>${totalClosedPositions}</td>
            <td style="color: ${
              totalPnL >= 0 ? "green" : "red"
            };">${totalPnL} USDT</td>
            <td>${totalFee} USDT</td>
            <td>${totalInvestment} USDT</td>
          </tr>
        </tbody>
      </table>

      <br>
      <table border="1" cellpadding="10" cellspacing="0" style="border-collapse: collapse; width: 80%; margin: auto; text-align: center;">
        <thead>
          <tr style="background-color: #f2f2f2;">
            <th>Symbol</th>
            <th>Total Positions</th>
            <th>Total Investment (USDT)</th>
            <th>Total Fee (USDT)</th>
            <th>Total PnL (USDT)</th>
          </tr>
        </thead>
        <tbody>
    `;

    results.forEach(
      ({ symbol, totalPositions, totalInvestment, totalFee, totalPnL }) => {
        html += `
        <tr>
          <td>${symbol}</td>
          <td>${totalPositions}</td>
          <td>${totalInvestment}</td>
          <td>${totalFee}</td>
          <td style="color: ${
            totalPnL >= 0 ? "green" : "red"
          };">${totalPnL}</td>
        </tr>
      `;
      }
    );

    html += `
        </tbody>
      </table>
    `;

    res.status(200).send(html);
  } catch (error) {
    res.status(500).send(`Error: ${error.message}`);
  }
});

// Webhook endpoint
app.post("/webhook", async (req, res) => {
  const signal = parseSignal(req.body);

  if (signal) {
    const response = await placeOrder(signal);
    res.status(200).send(response);
  } else {
    res.status(400).send("Invalid signal received.");
  }
});

// WebSocket client
const wsClient = new WebsocketClient({
  key: BYBIT_API_KEY,
  secret: BYBIT_API_SECRET,
  testnet: useTestnet,
  market: "v5",
  channel_type: "private",
});

wsClient.subscribeV5(["order"]);

// Handle WebSocket messages
wsClient.on("update", async (data) => {
  if (data.topic === "order") {
    for (let index = 0; index < data.data.length; index++) {
      const orderData = data.data[index];
      const orderStatus = orderData.orderStatus;

      if (
        orderStatus === "Filled" &&
        orderData.stopOrderType === "PartialTakeProfit"
      ) {
        console.log(`Take Profit order ${orderData.symbol} has been filled.`);

        // Cancel existing Stop Loss order if any
        const existingOrders = await bybitClient.getActiveOrders({
          category: "linear",
          symbol: orderData.symbol,
        });

        for (const order of existingOrders.result.list) {
          if (order.stopOrderType === "StopLoss") {
            const cancelResponse = await bybitClient.cancelOrder({
              category: "linear",
              symbol: orderData.symbol,
              orderId: order.orderId,
            });

            if (cancelResponse.retCode !== 0) {
              console.error(
                `Failed to cancel existing Stop Loss order: ${cancelResponse.retMsg}`
              );
            } else {
              console.log(
                `Existing Stop Loss order ${order.orderId} cancelled.`
              );
            }
          }
        }

        // Calculate Stop Loss price
        const symbolPrice = orderData.avgPrice;
        const side = orderData.side;
        const stopLossPrice =
          side === "Sell"
            ? (symbolPrice * 0.981).toFixed(4)
            : (symbolPrice * 1.019).toFixed(4);

        // Create Stop Loss order
        const stopLossResponse = await bybitClient.setTradingStop({
          category: "linear",
          symbol: orderData.symbol,
          stopLoss: stopLossPrice,
          slTriggerBy: "MarkPrice",
        });

        if (stopLossResponse.retCode !== 0) {
          return `Stop Loss rejected: ${stopLossResponse.retMsg}`;
        } else {
          return `Stop Loss set for ${orderData.symbol} at ${stopLossPrice}`;
        }
      }
    }
  }
});
