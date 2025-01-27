const { NewMessage } = require("telegram/events");
const parseSignal = require("./parseSignal");
const placeOrder = require("./placeOrder");
const input = require("input");
const channelId = BigInt("1235659304");
const fs = require("fs");
require("dotenv").config();
const { StringSession } = require("telegram/sessions");
const { TelegramClient } = require("telegram");

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;
const sessionFilePath = "./session.json";

// Session information file path
const stringSession = fs.existsSync(sessionFilePath)
  ? new StringSession(fs.readFileSync(sessionFilePath, "utf8"))
  : new StringSession("");

const telegramClient = new TelegramClient(stringSession, apiId, apiHash, {
  connectionRetries: 5,
});

async function telegramListener() {
  const telegramSession = process.env.TELEGRAM_SESSION;
  try {
    if (telegramSession) {
      telegramClient.session.load(telegramSession);
      await telegramClient.connect();
      console.log("Telegram session loaded and connected.");
    } else if (!fs.existsSync(sessionFilePath)) {
      await telegramClient.start({
        phoneNumber: async () =>
          await input.text("Enter your phone number (+90...): "),
        password: async () =>
          await input.text("Two-step verification password (if any): "),
        phoneCode: async () =>
          await input.text("Enter the Telegram verification code: "),
        onError: (err) => console.log("An error occurred:", err),
      });

      fs.writeFileSync(sessionFilePath, telegramClient.session.save());
      console.log("Telegram session started and saved.");
    } else {
      await telegramClient.connect();
      console.log("Telegram session file found and connected.");
    }
  } catch (error) {
    console.log(
      `An error occurred while connecting to Telegram: ${error.message}`
    );
    return;
  }

  // Handling messages from Telegram
  telegramClient.addEventHandler((event) => {
    try {
      const message = event.message;
      if (message) {
        const eventChannelId = BigInt(message.peerId.channelId.toString());
        // Correct comparison using BigInt
        if (eventChannelId === channelId) {
          console.log(
            "Message received from target channel: ",
            message.message
          );
          const messageText = message.message;
          const signal = parseSignal(messageText);
          console.log("Parsed Signal: ", signal);
          if (signal === null) return;

          if (signal.symbol) {
            placeOrder(signal);
          }
        } else {
          console.log("Message received from a different channel.");
        }
      } else {
        console.log("No message found in event.");
      }
    } catch (error) {
      console.log(
        `An error occurred while checking messages: ${error.message}`
      );
    }
  }, new NewMessage({ incoming: true }));

  console.log("Event handler added for incoming messages.");

  // Reconnect on connection close
  telegramClient.on("disconnected", async () => {
    console.log("Disconnected from Telegram. Attempting to reconnect...");
    try {
      await telegramClient.connect();
      console.log("Reconnected to Telegram.");
    } catch (error) {
      console.log(
        `An error occurred while reconnecting to Telegram: ${error.message}`
      );
    }
  });
}

module.exports = telegramListener;
