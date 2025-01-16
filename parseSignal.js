const { MANUAL_SELL, MANUAL_BUY } = require("./constants");

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

    let side;
    if (MANUAL_BUY === "Sell") {
      side = "Sell";
    } else if (MANUAL_SELL === "Buy") {
      side = "Buy";
    } else {
      side = signal;
    }

    return {
      symbol: newSymbol,
      signal: side,
      entry: parseFloat(price),
    };
  } catch (err) {
    return `Error parsing signal: ${err}`;
  }
}

module.exports = parseSignal;
