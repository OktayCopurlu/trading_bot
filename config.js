const { RestClientV5 } = require("bybit-api");
const { BYBIT_API_KEY, BYBIT_API_SECRET, useTestnet } = require("./constants");

// Bybit client
const bybitClient = new RestClientV5({
  key: BYBIT_API_KEY,
  secret: BYBIT_API_SECRET,
  testnet: useTestnet,
});

module.exports = { bybitClient };
