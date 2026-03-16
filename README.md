# Somnia Whale Tracker Dashboard

A real-time (near real-time) whale tracker dashboard for the **Somnia blockchain (Testnet)**. It monitors transactions, highlights large value transfers, and presents them in a clean dark-mode UI with teal/green accents.

## How Somnia Reactivity SDK is used

This project uses the **`@somnia-chain/reactivity`** SDK as the intended real-time transport for subscribing to on-chain activity via WebSockets (Reactivity subscriptions).

In some environments, the Somnia Testnet WebSocket RPC may be unavailable or blocked. In the current implementation, the app falls back to **HTTP polling** via `viem` (fetching the latest block and scanning transactions) to keep the dashboard functional using:

- **RPC**: `https://dream-rpc.somnia.network`

## Features

- **Live feed** of detected whale transactions (newest first)
- **Stats bar**: Total whales detected, largest transaction, total volume
- **Explorer links**:
  - Wallet → `https://shannon-explorer.somnia.network/address/[wallet]`
  - Tx hash → `https://shannon-explorer.somnia.network/tx/[hash]`
- **Modern dark UI** with teal/green accents (Tailwind CSS)
- **Configurable threshold** (currently set low for testnet visibility)

## How to run locally

Install dependencies:

```bash
npm install
```

Start the dev server:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Deployed URL

`https://somnia-tracker.vercel.app`

## Tech stack

- **Next.js**
- **TypeScript**
- **Tailwind CSS**
- **Somnia Reactivity SDK** (`@somnia-chain/reactivity`)
- **viem**
