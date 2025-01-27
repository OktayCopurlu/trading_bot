const { RestClientV5 } = require("bybit-api");
const fs = require("fs");
const {
  totalMarginSize,
  targetLeverage,
  BYBIT_API_KEY,
  BYBIT_API_SECRET,
  useTestnet,
} = require("./constants");

// Bybit client
const bybitClient = new RestClientV5({
  key: BYBIT_API_KEY,
  secret: BYBIT_API_SECRET,
  testnet: useTestnet,
});

async function placeOrder(signal) {
  console.log(signal);
  try {
    const side = signal.side === "long" ? "Buy" : "Sell";

    // Fetch market price
    const marketPriceData = await bybitClient.getTickers({
      category: "linear",
      symbol: signal.symbol,
    });

    if (marketPriceData.retCode !== 0) {
      return `Failed to get tickers : ${marketPriceData.retMsg}`;
    }

    const symbolPrice = parseFloat(marketPriceData.result.list[0].lastPrice);

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
        console.log(
          `Open ${openPositionSide} position already exists for ${signal.symbol}`
        );
        return `Open ${openPositionSide} position already exists for ${signal.symbol}`;
      }
    }

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
        `Order placed: ${signal.symbol} ${side}, Quantity: ${calculatedQuantity}, Price: ${limitPrice}`
      );
    }

    const position = await bybitClient.getPositionInfo({
      category: "linear",
      symbol: signal.symbol,
    });

    if (position.retCode !== 0) {
      return `Failed to get position: ${position.retMsg}`;
    }

    const takeProfitPoints = signal.takeProfits.map((tp) => {
      const tpSize = parseFloat((calculatedQuantity / 4).toFixed(2)).toString();
      const takeProfit = parseFloat(tp.price).toFixed(4);
      const tpLimitPrice = parseFloat(tp.price).toFixed(4);

      return {
        category: "linear",
        symbol: signal.symbol,
        takeProfit,
        tpTriggerBy: "MarkPrice",
        tpslMode: "Partial",
        tpOrderType: "Limit",
        tpSize,
        tpLimitPrice,
      };
    });
    const limitedTakeProfitPoints = takeProfitPoints.slice(0, 4);

    if (position.result.list[0].size > 0) {
      for (const tpOrder of limitedTakeProfitPoints) {
        const takeProfitResponse = await bybitClient.setTradingStop(tpOrder);
        if (takeProfitResponse.retCode !== 0) {
          console.log(`Take profit rejected: ${takeProfitResponse.retMsg}`);
        } else {
          console.log(
            `Take profit order placed: ${signal.symbol} ${tpOrder.tpSize} at ${tpOrder.tpLimitPrice}`
          );
        }
      }

      // Create Stop Loss order
      // const stopLossResponse = await bybitClient.setTradingStop({
      //   category: "linear",
      //   symbol: signal.symbol,
      //   stopLoss: stopLossPrice,
      //   slTriggerBy: "MarkPrice",
      // });

      // if (stopLossResponse.retCode !== 0) {
      //   return `Stop Loss rejected: ${stopLossResponse.retMsg}`;
      // } else {
      //   return `Stop Loss set for ${signal.symbol} at ${stopLossPrice}`;
      // }
    }
  } catch (error) {
    return `An error occurred while placing the order: ${JSON.stringify(
      error
    )}`;
  }
}

module.exports = placeOrder;
