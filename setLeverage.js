const { bybitClient } = require("./config");
const fs = require("fs");
const path = require("path");

const symbolsFilePath = path.join(__dirname, "allSymbols.json");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function setLeverage() {
  try {
    const symbols = JSON.parse(fs.readFileSync(symbolsFilePath, "utf8"));
    for (const symbol of symbols) {
      bybitClient
        .setLeverage({
          category: "linear",
          symbol: symbol,
          buyLeverage: "25",
          sellLeverage: "25",
        })
        .then((response) => {
          console.log(response);
        })
        .catch((error) => {
          console.error(error);
        });

      await sleep(500);
    }
  } catch (error) {
    console.error("An error occurred while placing orders:", error.message);
  }
}

// setLeverage();
module.exports = { setLeverage };
