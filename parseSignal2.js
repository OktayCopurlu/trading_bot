// Function to parse incoming signals
function parseSignal2(message) {
  try {
    const lines = message.trim().split("\n");

    const symbolMatch = lines[2].match(/(SHORT|LONG)\s+(\w+\/\w+)/);

    const side = symbolMatch ? symbolMatch[1].toLowerCase() : null;

    const orderSide = side === "long" ? "buy" : "sell";
    const correctSymbol = symbolMatch ? symbolMatch[2].replace("/", "") : null;

    const entryMatch = lines[1].match(/Entry\s*:\s*\$(\d+\.\d+)/);

    const takeProfitMatches = lines
      .slice(2, lines.length - 1) // Exclude entry and stop loss lines
      .filter((line) => line.includes("Target"))
      .map((line) => {
        const tpMatch = line.match(/Target\s+\d+\s+\$(\d+\.\d+)/);
        return tpMatch ? { price: parseFloat(tpMatch[1]) } : null;
      });

    if (takeProfitMatches.length === 0) return null;
    return {
      symbol: correctSymbol,
      side,
      orderSide: orderSide,
      entry: entryMatch ? parseFloat(entryMatch[1]) : null,
      takeProfits: takeProfitMatches.filter(Boolean),
    };
  } catch (error) {
    console.error("Error parsing signal:", error);
    return null;
  }
}

module.exports = parseSignal2;
