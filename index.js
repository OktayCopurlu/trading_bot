const { RestClientV5 } = require("bybit-api");
const express = require("express");

const totalMarginSize = 20; // Total margin size in USDT
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

    const marketPriceData = await bybitClient.getTickers({
      category: "linear",
      symbol: signal.symbol,
    });

    if (marketPriceData.retCode !== 0) {
      return `Failed to get tickers : ${marketPriceData.retMsg}`;
    }

    if (
      !marketPriceData.result ||
      !marketPriceData.result.list ||
      marketPriceData.result.list.length === 0
    ) {
      return `Could not fetch price for symbol: ${signal.symbol}`;
    }

    const symbolPrice = parseFloat(marketPriceData.result.list[0].lastPrice);
    const instrumentDetails = await bybitClient.getInstrumentsInfo({
      category: "linear",
      symbol: signal.symbol,
    });

    if (instrumentDetails.retCode !== 0) {
      return `Failed to getInstrumentsInfo : ${instrumentDetails.retMsg}`;
    }

    const instrument = instrumentDetails.result.list[0];
    if (!instrument) {
      return `Symbol not found: ${signal.symbol}`;
    }

    const minQty = parseFloat(instrument.lotSizeFilter.minOrderQty);
    const qtyPrecision = parseInt(
      instrument.lotSizeFilter.qtyStep.split(".")[1]?.length || 0
    );
    const tickSize = parseFloat(instrument.priceFilter.tickSize);

    // Calculate the correct quantity for the target leverage
    const targetNotional = totalMarginSize * targetLeverage; // $5 * 25x = $125
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
      const openPositionSide = openPosition.side;

      // If the current signal is the opposite of the open position, close the open position first
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

          return `Position closed: ${signal.symbol}`;
        } else {
          console.log(`No conditional orders to cancel for ${signal.symbol}`);
        }
      } else {
        return `Open ${openPositionSide} position already exists for ${signal.symbol}`;
      }
    }

    if (side !== "Close") {
      // Place the new  order
      const response = await bybitClient.submitOrder({
        category: "linear",
        symbol: signal.symbol,
        side,
        orderType: "Market",
        qty: calculatedQuantity,
        price: limitPrice,
        // timeInForce: "GoodTillCancel",
      });

      if (response.retCode !== 0) {
        return `Order rejected: ${response.retMsg}`;
      } else {
        console.log(
          `Limit Order placed: ${signal.symbol} ${side}, with ${totalMarginSize} USDT margin, ${targetLeverage}x leverage. Quantity: ${calculatedQuantity}, Price: ${limitPrice}`
        );
      }

      // Pozisyon açıldıktan sonra %12.5'i için take profit ayarla
      const takeProfitQuantity = (calculatedQuantity * 0.25).toFixed(
        qtyPrecision
      );
      const takeProfitPrice =
        side === "Buy"
          ? (symbolPrice * 1.005).toFixed(4) // %12.5 yukarı fiyat
          : (symbolPrice * 0.995).toFixed(4); // %12.5 aşağı fiyat

      const position = await bybitClient.getPositionInfo({
        category: "linear",
        symbol: signal.symbol,
      });

      if (position.retCode !== 0) {
        return `Failed to close position: ${position.retMsg}`;
      }

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
          return `Take profit rejected: ${takeProfitResponse.retMsg}`;
        } else {
          return `Take profit order placed: ${signal.symbol} ${takeProfitQuantity} at ${takeProfitPrice}`;
        }
      } else {
        return "No open position for the specified symbol.";
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

// / endpoint
app.get("/", (req, res) => {
  res.status(200).send(`TRADING BOT IS RUNNING`);
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Webhook server running on http://localhost:${PORT}`);
});
