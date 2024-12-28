const { RestClientV5 } = require("bybit-api");
const express = require("express");

const fixedUSDTAmount = 10; // Total margin size in USDT
const targetLeverage = 25; // Target leverage
// Bybit API information
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

// Express server for webhook
const app = express();
app.use(express.json());

// Function to parse incoming webhook messages
function parseSignal(jsonSignal) {
  try {
    const { symbol, price, signal, message } = jsonSignal;

    if (!signal) {
      console.log("No actionable signal: price is equal to SMA50");
      return null;
    }

    const SL_TP = message?.includes("SL")
      ? "SL"
      : message?.includes("TP")
      ? "TP"
      : undefined;
    console.log("Signal message:", SL_TP);

    return {
      action: SL_TP,
      symbol,
      signal,
      entry: parseFloat(price),
    };
  } catch (err) {
    console.error("Error parsing signal:", err);
    return null;
  }
}

// Function to place orders on Bybit
async function placeOrder(signal) {
  try {
    const side = signal.signal;

    console.log(`Fetching price for symbol: ${signal.symbol}`);
    const marketPriceData = await bybitClient.getTickers({
      category: "linear",
      symbol: signal.symbol,
    });

    if (
      !marketPriceData.result ||
      !marketPriceData.result.list ||
      marketPriceData.result.list.length === 0
    ) {
      console.error(`Could not fetch price for symbol: ${signal.symbol}`);
      return;
    }

    const symbolPrice = parseFloat(marketPriceData.result.list[0].lastPrice);
    const instrumentDetails = await bybitClient.getInstrumentsInfo({
      category: "linear",
      symbol: signal.symbol,
    });

    const instrument = instrumentDetails.result.list[0];
    if (!instrument) {
      console.error(`Symbol not found: ${signal.symbol}`);
      return;
    }

    const minQty = parseFloat(instrument.lotSizeFilter.minOrderQty);
    const qtyPrecision = parseInt(
      instrument.lotSizeFilter.qtyStep.split(".")[1]?.length || 0
    );
    const tickSize = parseFloat(instrument.priceFilter.tickSize);

    // Calculate the correct quantity for the target leverage
    const targetNotional = fixedUSDTAmount * targetLeverage; // $5 * 25x = $125
    let calculatedQuantity = (targetNotional / symbolPrice).toFixed(
      qtyPrecision
    );

    // Ensure quantity meets minimum order size
    calculatedQuantity = Math.max(calculatedQuantity, minQty).toFixed(
      qtyPrecision
    );

    // Calculate limit price
    const priceOffset = tickSize * 5; // Adjust offset as needed

    const limitPrice =
      side === "Buy"
        ? (symbolPrice - priceOffset).toFixed(4)
        : (symbolPrice + priceOffset).toFixed(4);

    // Check if there is an open position for the same symbol
    const openPositions = await bybitClient.getPositionInfo({
      category: "linear",
      symbol: signal.symbol,
    });

    if (openPositions.result) {
      const openPosition = openPositions.result.list[0];
      const currentSide = openPosition.side;

      // If the current signal is the opposite of the open position, close the open position first
      if (currentSide !== side) {
        console.log(
          `Closing open ${currentSide} position for ${signal.symbol}`
        );

        if (currentSide !== "") {
          const orderResponse = await bybitClient.submitOrder({
            category: "linear",
            symbol: signal.symbol,
            side: currentSide === "Buy" ? "Sell" : "Buy",
            orderType: "Market",
            qty: openPosition.size,
            timeInForce: "GoodTillCancel",
          });

          if (orderResponse.retCode !== 0) {
            console.error(`Failed to close position: ${orderResponse.retMsg}`);
            return;
          }
          console.log(`Position closed for ${signal.symbol}`);

          // 2. Şartlı emirleri iptal et
          console.log(`Fetching conditional orders for ${signal.symbol}`);
          const activeOrders = await bybitClient.getActiveOrders({
            category: "linear",
            symbol: signal.symbol,
          });

          if (
            activeOrders.result &&
            activeOrders.result.list &&
            activeOrders.result.list.length > 0
          ) {
            for (const order of activeOrders.result.list) {
              console.log(`Canceling conditional order: ${order.orderId}`);
              await bybitClient.cancelOrder({
                category: "linear",
                symbol: signal.symbol,
                orderId: order.orderId,
              });
            }
          } else {
            console.log(`No conditional orders to cancel for ${signal.symbol}`);
          }
        } else {
          console.log(`No conditional orders to cancel for ${signal.symbol}`);
        }
      } else {
        console.log(
          `Open ${currentSide} position already exists for ${signal.symbol}`
        );
        return;
      }
    }
    console.log("signal.action", signal.action);
    if (signal.action === undefined) {
      // Place the new limit order
      const response = await bybitClient.submitOrder({
        category: "linear",
        symbol: signal.symbol,
        side,
        orderType: "Market",
        qty: calculatedQuantity,
        price: limitPrice,
        // timeInForce: "GoodTillCancel",
      });

      console.log("Submit Order Response:", response);

      if (response.retCode !== 0) {
        console.error(`Order rejected: ${response.retMsg}`);
      } else {
        console.log(
          `Limit Order placed: ${signal.symbol} ${side}, with ${fixedUSDTAmount} USDT margin, ${targetLeverage}x leverage. Quantity: ${calculatedQuantity}, Price: ${limitPrice}`
        );
      }
    }

    // Pozisyon açıldıktan sonra %11'i için take profit ayarla
    const takeProfitQuantity = (calculatedQuantity * 0.25).toFixed(
      qtyPrecision
    ); // %11'lik miktar
    const takeProfitPrice =
      side === "Buy"
        ? (symbolPrice * 1.0044).toFixed(4) // %11 yukarı fiyat
        : (symbolPrice * 0.9956).toFixed(4); // %11 aşağı fiyat

    console.log(
      `Setting take profit for ${signal.symbol}: ${takeProfitQuantity} at ${takeProfitPrice}`
    );

    const position = await bybitClient.getPositionInfo({
      category: "linear",
      symbol: signal.symbol,
    });

    if (position.result.list[0].size > 0) {
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
        console.error(`Take profit rejected: ${takeProfitResponse.retMsg}`);
      } else {
        console.log(
          `Take profit order placed: ${signal.symbol} ${takeProfitQuantity} at ${takeProfitPrice}`
        );
      }
    } else {
      console.log("No open position for the specified symbol.");
    }
  } catch (error) {
    console.error("An error occurred while placing the order:", error);
  }
}

// Webhook endpoint
app.post("/webhook", (req, res) => {
  const signal = parseSignal(req.body);
  console.log("Received signal:", signal);

  if (signal) {
    placeOrder(signal);
    res.status(200).send("Order placed successfully.");
  } else {
    res.status(400).send("Invalid signal received.");
  }
});

// / endpoint
app.get("/", (req, res) => {
  res.status(200).send("Get worked successfully.");
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Webhook server running on http://localhost:${PORT}`);
});
