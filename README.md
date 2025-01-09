# Correct Trading Fee Calculation

To calculate the correct trading fee, you can use the following code snippet:

```javascript
let symbolTotalFee = 0;

// Retrieve fee information from the Transaction Log
for (const position of closedPnLData) {
  const transactionResponse = await bybitClient.getTransactionLog({
    category: "linear",
    symbol,
    orderId: position.orderId,
  });

  if (transactionResponse.result && transactionResponse.result.list) {
    const fees = transactionResponse.result.list.reduce((feeSum, log) => {
      return feeSum + parseFloat(log.fee || 0);
    }, 0);

    symbolTotalFee += fees;
  }
}
```
