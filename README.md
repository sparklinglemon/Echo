# Echo

Echo is a free and open source way to listen to music with your friends in real time. This project is intended for self-hosting and is not offered as a hosted service.

## Features
- Real-time synchronized playback
- No accounts required
- Room based listening with friends
- Uses youtube as the audio source

## Getting Started

### Prerequisites
- **Node.js** (v18 or newer recommended)

### Installation
```bash
git clone https://github.com/sparklinglemon/echo.git
cd echo
npm install
```
### Running the app
`npm start`

By default, echo will be available at http://localhost:3000. To make Echo accessible outside your local network, you can use tools such as wireguard, tailscale, or cloudflare tunnel.


## Deploying behind Cloudflare (OCI friendly)

Echo can stay on plain HTTP at the origin (OCI VM) while Cloudflare terminates TLS at the edge.

1. Point your DNS record to the OCI public IP through Cloudflare (orange cloud enabled).
2. In Cloudflare SSL/TLS, use **Full** or **Full (strict)** (recommended with an origin cert).
3. Run Echo with HTTPS redirect enabled:

```bash
FORCE_HTTPS=true npm start
```

When `FORCE_HTTPS=true`, Echo trusts Cloudflare/proxy headers and redirects any non-HTTPS request to HTTPS while also adding an HSTS header for secure requests.

Note: the app automatically upgrades WebSocket connections to `wss://` when loaded over HTTPS.
