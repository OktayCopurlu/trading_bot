const fs = require("fs");

async function updateSymbolsInfo(bybitClient, symbolsFilePath, SYMBOLS) {
  for (let i = 0; i < SYMBOLS.length; i++) {
    const symbol = SYMBOLS[i];
    try {
      const instrumentDetails = await bybitClient.getInstrumentsInfo({
        category: "linear",
        symbol: symbol,
      });

      if (instrumentDetails.retCode === 0) {
        const instrument = instrumentDetails.result.list[0];
        const qtyPrecision = parseInt(
          instrument.lotSizeFilter.qtyStep.split(".")[1]?.length || 0
        );
        const tickSize = parseFloat(instrument.priceFilter.tickSize);

        // Update symbol data
        SYMBOLS[i] = {
          symbol: symbol,
          qtyPrecision: qtyPrecision,
          tickSize: tickSize,
        };
      } else {
        console.error(
          `Failed to get Instruments Info for ${symbol}: ${instrumentDetails.retMsg}`
        );
      }
    } catch (error) {
      console.error(`Error fetching data for ${symbol}:`, error.message);
    }
  }

  // Write updated symbols data to JSON file
  fs.writeFileSync(
    symbolsFilePath,
    JSON.stringify({ symbols: SYMBOLS }, null, 2),
    "utf8"
  );
  console.log("Symbols info updated successfully.");
}

module.exports = updateSymbolsInfo;
