# BabyTime — Setup Guide

A local baby monitor. Runs on your MacBook; old iPads and phones connect over home WiFi.

---

## Quick Start

### 1. Install Python dependencies

```bash
cd BabyTime
pip install -r requirements.txt
```

### 2. Install mkcert and generate certificates (one-time)

```bash
brew install mkcert
mkcert -install
```

Find your Mac's WiFi IP address:

```bash
ipconfig getifaddr en0
# e.g. 192.168.1.42
```

Generate the certificate (replace the IP with yours):

```bash
mkdir certs
mkcert -cert-file certs/cert.pem -key-file certs/key.pem \
  localhost 127.0.0.1 192.168.1.42
```

> If your router assigns a different IP next time, regenerate the cert with the new IP.

### 3. Start the server

```bash
python server.py
```

The server prints the URLs to use:

```
BabyTime starting on https://0.0.0.0:8443
Local:   https://localhost:8443
Network: https://192.168.1.42:8443
```

---

## Setting Up iOS / iPadOS Devices

Each iOS device needs to trust the local certificate once.

1. Open Safari and navigate to `https://192.168.1.42:8443`
2. Safari shows "Not Secure" — tap **Show Details** → **Visit Website**
3. On the page, tap **"Set up this device →"** (bottom of the screen)
4. Tap **"Download Certificate"**
5. iOS shows "Profile Downloaded" — go to:
   - **Settings → General → VPN & Device Management** → tap the mkcert profile → **Install**
6. Then go to:
   - **Settings → General → About → Certificate Trust Settings**
   - Toggle **ON** the mkcert certificate ← **do not skip this step**
7. Return to Safari, reload `https://192.168.1.42:8443` — green padlock ✓

macOS devices (Safari/Chrome) trust the certificate automatically after `mkcert -install`.

---

## Using the App

- Navigate to `https://192.168.1.42:8443` on any device
- Choose **Camera** (device in baby's room) or **Viewer** (your phone)
- The choice is remembered — next time it goes straight to that page
- To change roles: tap **Switch role** on the camera/viewer page

---

## Latency

Expect ~0.5–2 seconds of latency. This is normal for this streaming approach and fine for a baby monitor.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Camera page shows "Permission Denied" | Grant camera/mic permission in Safari settings |
| Video doesn't play on iOS viewer | Make sure you tapped "Tap to unmute" |
| "Certificate not trusted" on iOS | Complete all of Step 6 above (Certificate Trust Settings toggle) |
| Can't reach server from other device | Check all devices are on the same WiFi network |
| macOS firewall blocks connection | System Settings → Network → Firewall → Allow incoming connections for Python |
| IP address changed | Regenerate certs with new IP, restart server |

---

## Architecture Notes

- **Server**: Python FastAPI + Uvicorn, port 8443 (HTTPS)
- **Streaming**: Camera uses `MediaRecorder` → binary WebSocket chunks → server relays to all viewers
- **Viewer**: `MediaSource` API buffers and plays the incoming chunks
- **No cloud, no internet required** — everything stays on your home network
- **Future**: Audio volume analysis for noise threshold push notifications
