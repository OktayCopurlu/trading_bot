const { RestClientV5, WebsocketClient } = require("bybit-api");
const express = require("express");
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const generateHtmlTable = require("./generateHtmlTable");
const parseSignal = require("./parseSignal");
const {
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

// Read symbols from JSON file
const symbolsFilePath = path.join(__dirname, "symbols.json");
let symbolsData = JSON.parse(fs.readFileSync(symbolsFilePath, "utf8"));
let SYMBOLS_DATA = symbolsData.symbols;
let SYMBOL_LIST = symbolsData.symbols.map((s) => s.symbol);

function manageAllPositions(side) {
  for (const symbol of SYMBOL_LIST) {
    const signal = parseSignal({
      symbol: symbol,
      signal: side,
      price: "2",
    });

    placeOrder(signal);
  }
}

async function placeOrder(signal) {
  console.log(signal);
  try {
    const side = signal.signal;

    // Fetch market price
    const marketPriceData = await bybitClient.getTickers({
      category: "linear",
      symbol: signal.symbol,
    });

    if (marketPriceData.retCode !== 0) {
      return `Failed to get tickers : ${marketPriceData.retMsg}`;
    }

    const symbolPrice = parseFloat(marketPriceData.result.list[0].lastPrice);

    // Get qtyPrecision and tickSize from symbols.json
    let symbolData = SYMBOLS_DATA.find((s) => s.symbol === signal.symbol);
    if (!symbolData) {
      // If data not found in JSON, fetch from API
      const instrumentDetails = await bybitClient.getInstrumentsInfo({
        category: "linear",
        symbol: signal.symbol,
      });

      if (instrumentDetails.retCode !== 0) {
        return `Failed to get Instruments Info : ${instrumentDetails.retMsg}`;
      }

      const instrument = instrumentDetails.result.list[0];
      const qtyPrecision = parseInt(
        instrument.lotSizeFilter.qtyStep.split(".")[1]?.length || 0
      );
      const tickSize = parseFloat(instrument.priceFilter.tickSize);

      // Update symbol data
      symbolData = { symbol: signal.symbol, qtyPrecision, tickSize };
      SYMBOLS_DATA.push(symbolData);
      symbolsData.symbols = SYMBOLS_DATA;
      fs.writeFileSync(
        symbolsFilePath,
        JSON.stringify(symbolsData, null, 2),
        "utf8"
      );
      console.log(`Added new symbol data: ${signal.symbol}`);
    }

    const { qtyPrecision, tickSize } = symbolData;

    // Calculate the correct quantity for the target leverage
    const targetNotional = totalMarginSize * targetLeverage;
    let calculatedQuantity = (targetNotional / symbolPrice).toFixed(
      qtyPrecision
    );
    calculatedQuantity = Math.max(calculatedQuantity, 1).toFixed(qtyPrecision);

    // Calculate limit price
    const priceOffset = parseFloat(tickSize) * 5;
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
        addSymbolToJson(signal.symbol);
        console.log(
          `Order placed: ${signal.symbol} ${side}, Quantity: ${calculatedQuantity}, Price: ${limitPrice}`
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
//   price: "2.49",
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

if (startDate === undefined || endDate === undefined) {
  startDate = new Date();
  startDate.setDate(startDate.getDate() - DAY_LENGTH);
  endDate = new Date();
}

app.get("/", async (req, res) => {
  try {
    const html = await generateHtmlTable(
      bybitClient,
      SYMBOL_LIST,
      startDate,
      endDate,
      TAKER_FEE_RATE,
      MAKER_FEE_RATE,
      RESULT_NUMBER
    );

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

app.get("/buy", async (req, res) => {
  manageAllPositions("Buy");
  res.status(200).send("All positions turned to buy.");
});

app.get("/sell", async (req, res) => {
  manageAllPositions("Sell");
  res.status(200).send("All positions turned to sell.");
});

app.get("/close", async (req, res) => {
  manageAllPositions("Close");
  res.status(200).send("All positions closed.");
});

// // WebSocket client
// const wsClient = new WebsocketClient({
//   key: BYBIT_API_KEY,
//   secret: BYBIT_API_SECRET,
//   testnet: useTestnet,
//   market: "v5",
//   channel_type: "private",
// });

// wsClient.subscribeV5(["order"]);

// // Handle WebSocket messages
// wsClient.on("update", async (data) => {
//   if (data.topic === "order") {
//     for (let index = 0; index < data.data.length; index++) {
//       const orderData = data.data[index];
//       const orderStatus = orderData.orderStatus;

//       if (
//         orderStatus === "Filled" &&
//         orderData.stopOrderType === "PartialTakeProfit"
//       ) {
//         console.log(`Take Profit order ${orderData.symbol} has been filled.`);

//         // Cancel existing Stop Loss order if any
//         const existingOrders = await bybitClient.getActiveOrders({
//           category: "linear",
//           symbol: orderData.symbol,
//         });

//         for (const order of existingOrders.result.list) {
//           if (order.stopOrderType === "StopLoss") {
//             const cancelResponse = await bybitClient.cancelOrder({
//               category: "linear",
//               symbol: orderData.symbol,
//               orderId: order.orderId,
//             });

//             if (cancelResponse.retCode !== 0) {
//               console.error(
//                 `Failed to cancel existing Stop Loss order: ${cancelResponse.retMsg}`
//               );
//             } else {
//               console.log(
//                 `Existing Stop Loss order ${order.orderId} cancelled.`
//               );
//             }
//           }
//         }

//         // Calculate Stop Loss price
//         const symbolPrice = orderData.avgPrice;
//         const side = orderData.side;
//         const stopLossPrice =
//           side === "Sell"
//             ? (symbolPrice * 0.981).toFixed(4)
//             : (symbolPrice * 1.019).toFixed(4);

//         // Create Stop Loss order
//         const stopLossResponse = await bybitClient.setTradingStop({
//           category: "linear",
//           symbol: orderData.symbol,
//           stopLoss: stopLossPrice,
//           slTriggerBy: "MarkPrice",
//         });

//         if (stopLossResponse.retCode !== 0) {
//           return `Stop Loss rejected: ${stopLossResponse.retMsg}`;
//         } else {
//           return `Stop Loss set for ${orderData.symbol} at ${stopLossPrice}`;
//         }
//       }
//     }
//   }
// });
