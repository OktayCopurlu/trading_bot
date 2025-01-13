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

module.exports = parseSignal;
