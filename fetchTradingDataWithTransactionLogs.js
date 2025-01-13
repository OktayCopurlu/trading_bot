async function fetchTradingDataWithTransactionLogs(
  bybitClient,
  SYMBOLS,
  startDate,
  endDate,
  TAKER_FEE_RATE,
  MAKER_FEE_RATE,
  RESULT_NUMBER
) {
  const results = [];
  let totalClosedPositions = 0;
  let totalPnL = 0;
  let totalFee = 0;
  let totalInvestment = 0;
  let totalInvestmentWithLeverage = 0;

  for (const symbol of SYMBOLS) {
    try {
      // Kapalı pozisyonları al
      const response = await bybitClient.getClosedPnL({
        category: "linear",
        symbol,
        limit: RESULT_NUMBER,
      });

      if (!response || !response.result || !response.result.list) {
        console.log(`No data returned for ${symbol}`);
        continue;
      }

      const closedPnLData = response.result.list.filter((pos) => {
        const closedTime = new Date(parseInt(pos.updatedTime));
        return closedTime >= startDate && closedTime <= endDate;
      });
      const totalPositions = closedPnLData.length;
      const symbolTotalPnL = closedPnLData.reduce(
        (sum, pos) => sum + parseFloat(pos.closedPnl),
        0
      );

      // Fee Hesaplama
      const symbolTotalFee = closedPnLData.reduce((sum, pos) => {
        const feeRate =
          pos.orderType === "Market" ? TAKER_FEE_RATE : MAKER_FEE_RATE;
        const openingFee =
          parseFloat(pos.avgEntryPrice) * parseFloat(pos.qty) * feeRate;
        const closingFee =
          parseFloat(pos.avgExitPrice) * parseFloat(pos.qty) * feeRate;
        return sum + openingFee + closingFee;
      }, 0);

      // Total Investment Hesaplama
      const symbolTotalInvestment = closedPnLData.reduce((sum, pos) => {
        const leverage = parseFloat(pos.leverage);
        const initialInvestment = parseFloat(pos.cumEntryValue) / leverage;
        return sum + initialInvestment;
      }, 0);

      const symbolTotalInvestmentWithLeverage = closedPnLData.reduce(
        (sum, pos) => {
          const initialInvestment = parseFloat(pos.cumEntryValue);
          return sum + initialInvestment;
        },
        0
      );

      results.push({
        symbol,
        totalPositions,
        totalPnL: symbolTotalPnL.toFixed(2),
        totalFee: symbolTotalFee.toFixed(2),
        totalInvestment: symbolTotalInvestment.toFixed(2),
        totalInvestmentWithLeverage:
          symbolTotalInvestmentWithLeverage.toFixed(2),
      });

      totalClosedPositions += totalPositions;
      totalPnL += symbolTotalPnL;
      totalFee += symbolTotalFee;
      totalInvestment += symbolTotalInvestment;
      totalInvestmentWithLeverage += symbolTotalInvestmentWithLeverage;
    } catch (error) {
      console.error(`Error fetching data for ${symbol}:`, error.message);
    }
  }

  return {
    results,
    totalClosedPositions,
    totalPnL: totalPnL.toFixed(2),
    totalFee: totalFee.toFixed(2),
    totalInvestment: totalInvestment.toFixed(0),
    totalInvestmentWithLeverage: totalInvestmentWithLeverage.toFixed(0),
  };
}

module.exports = fetchTradingDataWithTransactionLogs;
