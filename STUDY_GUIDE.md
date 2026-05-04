# BabyTime — Study Guide

## What We're Building

A self-hosted baby monitor web app. A MacBook runs a Python server on the home WiFi. Old iPads and phones open a webpage to either stream video/audio (camera role) or watch the feed (viewer role). No cloud, no internet required — everything stays on the home network.

---

## How It Works (High Level)

1. MacBook runs `python server.py` — a FastAPI HTTPS server on port 8443.
2. The camera device opens `https://192.168.1.42:8443`, chooses "Camera".
3. The browser calls `getUserMedia()` to access the camera and microphone.
4. `MediaRecorder` encodes the stream into ~500ms fMP4 (fragmented MP4) chunks.
5. Each chunk is sent as binary data over a WebSocket to the server (`/ws/camera`).
6. The server stores the first chunk (the "init segment") and broadcasts every chunk to all connected viewer WebSockets (`/ws/viewer`).
7. Viewer devices open the same URL, choose "Viewer".
8. Their browser connects via WebSocket, receives the binary chunks, and feeds them into the `ManagedMediaSource` API — the `<video>` element plays the live stream.

### Optional: global `babytime` command (from a git clone)

1. Run `./build-and-run.sh` in the repo. With an interactive terminal it prints status, then a short numbered list (no full-screen UI): **1** symlink to `~/.local/bin` then run (optional PATH prompt), **2** symlink to `/usr/local/bin` then run, **3** run from the clone only (default), **4** exit. Without a TTY or when you pass flags, it skips the menu. Flags: `--install-user`, `--install-system`, `--add-to-path` (see `./build-and-run.sh --help`).
2. `bin/babytime` is a tiny script that `exec`s the repo’s `run.sh`, so the symlink always points at the clone (not at a Python binary inside `.venv`). It resolves **`BASH_SOURCE` through symlinks** (e.g. `~/.local/bin/babytime` → `…/repo/bin/babytime`) so `ROOT` is the real repo, not `~/.local`.
3. **Best practice for “where to symlink”**: prefer **`~/.local/bin`** (user-level, no root). It matches how many tools (uv, pip, cargo) expect user installs. Use **`/usr/local/bin`** only when you want the command for every user on the machine and accept `sudo`.
4. **PATH**: many Linux desktops already put `~/.local/bin` on `PATH`; macOS often does not. Pass `--add-to-path` to append a small guarded block to `~/.zshrc` or `~/.bashrc`, or add `export PATH="$HOME/.local/bin:$PATH"` once yourself.

---

## Key Decisions & Why

### Server-based relay (not peer-to-peer WebRTC)

- **Chosen**: All media goes through the server.
- **Alternative**: WebRTC peer-to-peer — camera streams directly to each viewer.
- **Why this**: Server can run audio analysis for noise threshold alerts; the camera only needs one outgoing connection regardless of how many viewers there are; simpler to implement.
- **Tradeoff**: Server uses bandwidth proportional to `stream_bitrate × viewer_count`. Fine for a home LAN, would not scale to the internet.
- **Analogy**: Like a radio station broadcasting to all listeners, rather than each listener calling the studio directly.

### HTTPS with mkcert (not self-signed certs)

- **Chosen**: `mkcert` creates a locally-trusted CA that devices can opt into trusting.
- **Alternative**: Self-signed cert — browser shows an error that cannot be bypassed for `getUserMedia` on iOS.
- **Why this**: iOS Safari requires HTTPS or `localhost` to allow camera/mic access. mkcert creates a cert that iOS can actually trust. We include both the WiFi IP and the Mac Bonjour hostname (`<Computer-Name>.local`) so devices can connect with a stable local name.
- **Tradeoff**: One-time setup per iOS device (profile install + trust toggle in Settings).
- **Analogy**: Like saving a friend's contact by name instead of memorizing a phone number that might change.

### Python FastAPI over Node.js

- **Chosen**: Python + FastAPI + Uvicorn.
- **Alternative**: Node.js + Express + Socket.IO.
- **Why this**: User preference for Python; FastAPI has native async WebSocket support; fits the project's existing Python tooling.
- **Tradeoff**: Slightly more ceremony for WebSockets vs. Socket.IO, but no meaningful difference for this use case.

### User-level symlink (`~/.local/bin`) vs system-wide (`/usr/local/bin`)

- **Chosen**: Default recommendation is `~/.local/bin/babytime` → `bin/babytime` in the repo.
- **Alternative**: `/usr/local/bin/babytime` with `sudo`.
- **Why**: User-writable directories avoid root for day-to-day dev tools; fewer foot-guns than editing system paths. `/usr/local/bin` is still offered for shared machines or habit.
- **Tradeoff**: Each user who wants `babytime` on PATH runs the installer once (or shares a system link with sudo).
- **Analogy**: A shortcut in your own desk drawer versus pinning a notice on the office bulletin board everyone shares.

### Port 8443 (not 80 or 443)

- **Chosen**: Port 8443.
- **Why not 80**: HTTP on port 80 cannot serve camera pages — iOS Safari blocks `getUserMedia` on HTTP non-localhost origins.
- **Why not 443**: Requires `sudo` on macOS (ports below 1024 are privileged).
- **Tradeoff**: Users must type `:8443` in the URL.

### MediaRecorder + ManagedMediaSource (not HLS)

- **Chosen**: `MediaRecorder` on camera, `ManagedMediaSource` on iOS viewer and standard `MediaSource` on desktop viewers, both using `SourceBuffer`.
- **Alternative**: HLS — camera streams to server, server creates `.m3u8` playlists with `ffmpeg`, viewers use `<video src="stream.m3u8">`.
- **Why this**: HLS adds 3–10 seconds of latency (by design) and requires `ffmpeg`. MediaRecorder plus MSE on the viewer achieves ~0.5–2s latency with no server-side transcoding. iOS Safari uses Apple’s proprietary `ManagedMediaSource` API (not the standard `MediaSource`), while desktop browsers use the standard `MediaSource` API. The viewer detects which API is available and uses the appropriate one.
- **Tradeoff**: `MediaRecorder` requires iOS 14.3+; very old browsers may not have either API. Desktop viewers using older Chrome/Firefox versions may not have full MSE support.

---

## How Each Piece Works

### build-and-run.sh and bin/babytime

**build-and-run.sh** prints symlink status, then either a small **1–4** menu (interactive TTY, no flags) or goes straight through when stdin is not a TTY or when you pass `--install-user` / `--install-system` / `--add-to-path`. Then it runs `run.sh`. **bin/babytime** resolves its real path (when invoked via a symlink in `PATH`) and `exec`s `run.sh` from the repo root.

If you install to **`/usr/local/bin`** (menu **2** or `--install-system`), the script warns when that directory is missing from `PATH` — not when `~/.local/bin` is on `PATH` but `/usr/local/bin` is not (those are independent).

Example: `./build-and-run.sh` → choose **1** → confirm PATH → new terminal → `babytime`. Or once: `./build-and-run.sh --install-user --add-to-path`.

### install.sh, run.sh, and scripts/ensure-certs.sh

**install.sh** installs `uv`, syncs the venv from `requirements.txt`, then if `mkcert` is on `PATH` it runs **`scripts/ensure-certs.sh`**, which creates `certs/cert.pem` and `certs/key.pem` when they are missing (`mkcert -install` once per machine, then `mkcert` for the leaf cert). If `mkcert` is not installed yet, install prints a skip message — install **brew** packages only for `uv`, not for `mkcert`.

**run.sh** ensures the venv exists, then ensures certs exist by calling **`scripts/ensure-certs.sh`** unless you pass **`--skip-mkcert`**. With `--skip-mkcert`, if cert files are missing the script exits with an error instead of calling mkcert (useful when you will supply certs yourself or run without TLS later). Any other arguments are passed through to `server.py` (e.g. `./run.sh --reload` if you add that to the server entrypoint later).

### server.py

Runs the FastAPI app. Three main responsibilities:
1. WebSocket endpoint `/ws/camera` — receives binary chunks from the camera, caches the first chunk (init segment), fans out every chunk to all viewer sockets.
2. WebSocket endpoint `/ws/viewer` — sends the cached init segment immediately (so late joiners can decode), then streams all subsequent chunks.
3. HTTP endpoint `/setup/ca.pem` — runs `mkcert -CAROOT` to find the CA file location, serves it for download so iOS devices can trust it.

Example: Camera sends 50KB chunk → server loops over 3 connected viewers → sends 50KB to each.

### static/camera.html

Calls `getUserMedia()` to get a `MediaStream` (video + audio). Creates a `MediaRecorder` with `mimeType: 'video/mp4'` (falls back to `video/webm` on Chrome). Calls `recorder.start(500)` which fires `ondataavailable` every 500ms with a chunk. Sends the chunk as binary over a WebSocket. Reconnects automatically if the server goes away.

Example: Every 500ms → `{data: Blob(~40KB)}` event → `ws.send(blob)`.

### static/viewer.html

Creates either a `ManagedMediaSource` (on iOS Safari) or a standard `MediaSource` (on desktop) and assigns it as the `<video>` element's source. The viewer detects which API is available by checking `typeof ManagedMediaSource` and uses the appropriate one. On WebSocket message, appends the binary chunk to a `SourceBuffer`. A queue ensures chunks are not appended while the buffer is still processing the previous one (the `updating` flag). The first chunk received contains the fMP4 init segment, which tells the decoder the codec parameters — subsequent chunks can then be decoded. Event names differ between the two APIs (ManagedMediaSource uses `startstreaming` and `endstreaming`, while MediaSource uses `sourceopen` and `updateend`), and the viewer dynamically selects the correct event names based on which API is in use.

The page shows a small **MediaSource MIME support** panel (above the bottom buttons): for each candidate `mimeType` string, it displays `true` or `false` from the appropriate API's `isTypeSupported()` method. That makes it obvious on each device (Safari vs Chrome, iOS vs desktop) which codec line the viewer will pick first.

**`static/viewer.js`**: `connect()` resets state, calls `tryInitViewerMSE()` to pick a MIME and run `initMediaSource()`, then `openViewerWebSocket()`. MSE setup is split into `getMediaSourceMode()` (Managed vs standard API and event names), `logAllMediaSourceEvents`, `attachSourceBufferWhenOpen`, and `attachVideoElementStreamHandlers` so the main init stays short. WebSocket behavior uses named handlers (`onViewerWebSocketOpen`, `onMessage`, `onClose`, `onError`) instead of inline lambdas. Audio logic is intentionally thin: `initAudioMeter()` creates/starts an `AudioVisualizer`, and `stopAudioMeter()` stops it.

**`static/audioVisualizer.js`**: Defines an `AudioVisualizer` class that owns the full audio meter lifecycle. `start()` creates `AudioContext`, creates/configures `AnalyserNode`, connects either an HTML media element (`createMediaElementSource`) or a `MediaStream` (`createMediaStreamSource`), ensures the bars exist, and starts the requestAnimationFrame loop. `stop()` cancels the loop, closes audio resources, and clears the bars. This split keeps both `viewer.js` and `camera.js` focused on stream state while all meter details live in one place.

Example: Receive 40KB binary → `sourceBuffer.appendBuffer(data)` → video plays a new 500ms segment.

### static/setup.html

A self-contained iOS setup guide. Fetches `/api/status` to detect if the cert is now trusted (if the fetch succeeds without error, the cert is trusted). Shows a download button for the CA cert. Walks through the 4 Settings steps. Exists so the user never needs to find external docs.

### static/index.html

Checks `localStorage` for a saved role. If found, redirects immediately. Otherwise shows two buttons. Saves the choice so the user only picks once.

---

## Things That Don't Work Well

- **Old iOS devices on iOS < 14.3**: `MediaRecorder` is not available, so they cannot be cameras. Viewers need `ManagedMediaSource` (iOS Safari 17.2+) or standard `MediaSource` (desktop browsers).
- **IP address changes**: If the router assigns a new IP to the MacBook, the mkcert cert needs to be regenerated with the new IP.
- **Bonjour dependence**: `.local` hostnames depend on Bonjour/mDNS on the network. Some guest networks or isolated VLANs may block this discovery traffic.
- **Multiple cameras**: The current design supports one camera at a time. A second `register-camera` event would overwrite the first.
- **Buffer growth**: The viewer's `SourceBuffer` grows indefinitely. On long sessions this may cause memory pressure on old iPads. Solution (not yet implemented): periodically call `sourceBuffer.remove()` to trim old data.
- **Latency spikes**: If the WiFi is congested, chunks queue up and latency increases. There's no mechanism to drop old chunks and snap to live.
- **No authentication**: Anyone on the home WiFi can access the server. Acceptable for home use; not for shared networks.

---

## Key Metrics

- **Expected latency**: 0.5–2 seconds (one to four 500ms chunks in flight)
- **Bandwidth through server**: ~200–500 KB/s per viewer (720p H.264 at ~1.5 Mbps)
- **mkcert CA setup**: ~2 minutes per iOS device, one-time
- **Supported cameras**: iOS Safari 14.3+, macOS Safari, Chrome on desktop
- **Supported viewers**: Safari with `ManagedMediaSource` (e.g. iOS/macOS Safari 17.2+); other browsers need that API to exist or streaming will not start
