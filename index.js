const { RestClientV5, WebsocketClient } = require("bybit-api");
const express = require("express");

const totalMarginSize = 20; // Total margin size in USDT
const targetLeverage = 25; // Target leverage// Bybit API information
const BYBIT_API_KEY = process.env.BYBIT_API_KEY || "jyc9UHox5e0YIDijdK";
const BYBIT_API_SECRET =
  process.env.BYBIT_API_SECRET || "buNQyObMuC3NpVdVGZydi2CKOnu3DHucZq4W";
const useTestnet = false;

// Bybit client
const bybitClient = new RestClientV5({
  key: BYBIT_API_KEY,
  secret: BYBIT_API_SECRET,
  testnet: useTestnet,
});

// WebSocket client
const wsClient = new WebsocketClient({
  key: BYBIT_API_KEY,
  secret: BYBIT_API_SECRET,
  testnet: useTestnet,
  market: "v5",
  channel_type: "private",
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
      const takeProfitQuantity = (calculatedQuantity * 0.25).toFixed(
        qtyPrecision
      );
      const takeProfitPrice1 =
        side === "Buy"
          ? (symbolPrice * 1.01).toFixed(4) // %25 yukarı fiyat
          : (symbolPrice * 0.99).toFixed(4); // %25 aşağı fiyat

      const takeProfitPrice2 =
        side === "Buy"
          ? (symbolPrice * 1.02).toFixed(4) // %50 yukarı fiyat
          : (symbolPrice * 0.98).toFixed(4); // %50 aşağı fiyat

      // Stop Loss hesaplama
      const stopLossPrice =
        side === "Buy"
          ? (symbolPrice * 0.982).toFixed(4) // %50 aşağı fiyat
          : (symbolPrice * 1.018).toFixed(4); // %50 yukarı fiyat

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

// Root endpoint
app.get("/", (req, res) => {
  res.status(200).send(`TRADING BOT IS RUNNING`);
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
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
