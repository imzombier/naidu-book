# Naidu Book — Complete Virtual-Coin Demo

This is a fuller deployable demo, not the earlier starter. It includes:
- React mobile-first UI
- Express production server serving the built frontend
- SQLite persistence
- Registration/login with JWT
- Server-side virtual coin balance and transaction ledger
- Demo bet slip and history
- Live/upcoming sports odds proxy
- Cricket/Tennis/Football/Basketball sections
- Andar Bahar / Color Game / Roulette-style original demo games
- Wallet and profile pages
- Render-friendly port binding

## Setup
cp .env.example .env
npm install
npm run build
npm start

The live odds API uses The Odds API. You must supply your own API key as ODDS_API_KEY.

This application is intentionally limited to non-redeemable virtual coins. It does not implement INR deposits, gambling withdrawals, cash-out, or cash-value prizes.

For Render: connect the GitHub repository as a Web Service. Build command:
npm install && npm run build
Start command:
npm start
Set environment variables from .env.example in Render.
