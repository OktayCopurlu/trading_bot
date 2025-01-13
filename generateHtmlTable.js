const fetchTradingDataWithTransactionLogs = require("./fetchTradingDataWithTransactionLogs");

async function generateHtmlTable(
  bybitClient,
  SYMBOLS,
  startDate,
  endDate,
  TAKER_FEE_RATE,
  MAKER_FEE_RATE,
  RESULT_NUMBER
) {
  const {
    results,
    totalClosedPositions,
    totalPnL,
    totalFee,
    totalInvestment,
    totalInvestmentWithLeverage,
  } = await fetchTradingDataWithTransactionLogs(
    bybitClient,
    SYMBOLS,
    startDate,
    endDate,
    TAKER_FEE_RATE,
    MAKER_FEE_RATE,
    RESULT_NUMBER
  );

  // PnL'leri büyükten küçüğe sırala
  results.sort((a, b) => b.totalPnL - a.totalPnL);

  const options = { day: "2-digit", month: "2-digit", year: "numeric" };
  const formattedStartDate = startDate.toLocaleDateString("de-CH", options);
  const formattedEndDate = endDate.toLocaleDateString("de-CH", options);
  // Gün sayısını hesapla
  const timeDifference = endDate.getTime() - startDate.getTime();
  const dayDifference = Math.ceil(timeDifference / (1000 * 3600 * 24));

  // HTML Tablosu oluştur
  let html = `
    <h1 style="text-align: center;">Trading Bot Last ${RESULT_NUMBER} PnL Results</h1>
    <table border="1" cellpadding="10" cellspacing="0" style="border-collapse: collapse; width: 80%; margin: auto; text-align: center;">
      <thead>
        <tr style="background-color: #f2f2f2;">
          <th>Date Range</th>
          <th>Number of Closed Positions</th>
          <th>Total PnL (USDT)</th>
          <th>Total Fee (USDT)</th>
          <th>Total Investment (USDT)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${formattedStartDate} - ${formattedEndDate} (${dayDifference} Days)</td>
          <td>${totalClosedPositions}</td>
          <td style="color: ${
            totalPnL >= 0 ? "green" : "red"
          };">${totalPnL} USDT</td>
          <td>${totalFee} USDT</td>
          <td>${totalInvestment} USDT</td>
        </tr>
      </tbody>
    </table>

    <br>
    <table border="1" cellpadding="10" cellspacing="0" style="border-collapse: collapse; width: 80%; margin: auto; text-align: center;">
      <thead>
        <tr style="background-color: #f2f2f2;">
          <th>Symbol (${results.length})</th>
          <th>Total Positions</th>
          <th>Total Investment (USDT)</th>
          <th>Total Fee (USDT)</th>
          <th>Total PnL (USDT)</th>
        </tr>
      </thead>
      <tbody>
  `;

  results.forEach(
    ({ symbol, totalPositions, totalInvestment, totalFee, totalPnL }) => {
      html += `
      <tr>
        <td>${symbol}</td>
        <td>${totalPositions}</td>
        <td>${totalInvestment}</td>
        <td>${totalFee}</td>
        <td style="color: ${totalPnL >= 0 ? "green" : "red"};">${totalPnL}</td>
      </tr>
    `;
    }
  );

  html += `
      </tbody>
    </table>
  `;

  return html;
}

module.exports = generateHtmlTable;
