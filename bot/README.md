# RealmeInfoBot

A new, independently controlled Telegram bot for Realme device lookup.

The bot uses the renovated RealmeBot API and does not depend on the previous RealmeInfoBot implementation.

## Commands

/start
/help
/menu
/whatis <device>
/codename <device>
/deviceinfo <device>
/search <query>
/series <series>
/devices
/ota <device>

## Configuration

Set:

- TELEGRAM_BOT_TOKEN
- REALME_API_URL
- OTA_API_URL (optional)

The OTA adapter is deliberately isolated because the original OTA implementation is not present in this repository. Point OTA_API_URL at the existing OTA service when its endpoint is known.

## Run

    cd bot
    npm install
    npm start

The bot uses Telegram long polling and clears an existing webhook at startup so polling can take over cleanly.
