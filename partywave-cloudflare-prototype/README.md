# PartyWave

A Cloudflare-native prototype for party audio: a host creates an 8-character room, guests join with the code, and the host can capture browser tab/window audio and send it to guests over WebRTC.

## What is included

- Create party / join party
- 8-character party codes
- Cloudflare Worker + Durable Object WebSocket signaling
- Host/guest roles
- WebRTC host-audio broadcast
- YouTube URL/ID loading with synchronized play/pause state
- Mobile-friendly dark-green + beige UI
- Share invite / copy code
- Basic connection status and room member count
- Spotify and YouTube Music provider UI with policy-safe limitations

## Important architecture limitation

The browser cannot simply take Spotify/YouTube's protected audio and have the server rebroadcast it. In particular, Spotify's developer policies prohibit non-interactive broadcasting and synchronized sound recordings. The prototype therefore uses **browser tab/window audio capture** for the actual multi-phone audio feature.

For YouTube:
1. Open the YouTube source in the embedded player.
2. As host, click **Start host audio broadcast**.
3. In the browser picker, select the tab playing the source and enable **Share tab audio**.
4. Guests receive that captured audio through WebRTC.

This is a prototype. For larger parties, replace the host-to-every-guest WebRTC mesh with an SFU/media server and add TURN.

## Run locally

Requirements: Node.js 20+.

```bash
npm install
npx wrangler login
npm run dev
```

Open the local URL Wrangler prints.

Test with two browser windows/devices. Create a party in one and join with the code in the other.

## Deploy

```bash
npx wrangler login
npm run deploy
```

Cloudflare will deploy the Worker and static assets together.

## Cloudflare setup

This project uses Workers Static Assets and a SQLite-backed Durable Object. Current Cloudflare docs say SQLite-backed Durable Objects are available on Workers Free; usage limits still apply.

## First extensions I would build

1. TURN server for restrictive mobile networks.
2. SFU media layer for 20+ guests.
3. Persistent room metadata + expiry/cleanup.
4. Host password / moderation controls.
5. Reconnection and late-join media negotiation.
6. YouTube Data API search with a server-side API key.
7. Queue, voting, DJ permissions, volume controls and latency monitoring.
8. Proper analytics, rate limiting, abuse protection and CSP.
9. Optional Spotify metadata/login integration only where it complies with Spotify's current platform policies.
