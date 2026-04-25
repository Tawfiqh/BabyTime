import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI()

# ── State ──────────────────────────────────────────────────────────────────────

camera_ws: Optional[WebSocket] = None
viewer_connections: list = []
# First chunk from camera contains the fMP4 init segment (moov box).
# Sent to viewers who join after streaming has started so they can decode.
init_chunk: Optional[bytes] = None

# Slow viewer snapshot storage
latest_snapshot: Optional[dict] = None  # {"image": base64_string, "timestamp": ISO8601}
latest_audio_level: Optional[dict] = None  # {"rms": int, "peak": int, "timestamp": ISO8601}


# ── WebSocket: Camera ──────────────────────────────────────────────────────────

@app.websocket("/ws/camera")
async def camera_endpoint(ws: WebSocket):
    global camera_ws, init_chunk
    await ws.accept()
    camera_ws = ws
    init_chunk = None
    print("Camera connected", flush=True)
    try:
        while True:
            data = await ws.receive_bytes()
            if init_chunk is None:
                init_chunk = data
            dead: list[WebSocket] = []
            for viewer in viewer_connections:
                try:
                    await viewer.send_bytes(data)
                except Exception:
                    dead.append(viewer)
            for d in dead:
                viewer_connections.remove(d)
    except WebSocketDisconnect:
        print("Camera disconnected", flush=True)
        camera_ws = None
        init_chunk = None


# ── WebSocket: Viewer ──────────────────────────────────────────────────────────

@app.websocket("/ws/viewer")
async def viewer_endpoint(ws: WebSocket):
    await ws.accept()
    if init_chunk is not None:
        await ws.send_bytes(init_chunk)
    viewer_connections.append(ws)
    print(f"Viewer connected ({len(viewer_connections)} total)", flush=True)
    try:
        # Keep the connection alive; viewers only receive, never send data.
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        if ws in viewer_connections:
            viewer_connections.remove(ws)
        print(f"Viewer disconnected ({len(viewer_connections)} remaining)", flush=True)


# ── Status API ─────────────────────────────────────────────────────────────────

@app.get("/api/status")
async def status():
    return {
        "camera_connected": camera_ws is not None,
        "viewer_count": len(viewer_connections),
    }


# ── Slow Viewer API ────────────────────────────────────────────────────────────

@app.post("/api/camera/snapshot")
async def save_snapshot(data: dict):
    global latest_snapshot, latest_audio_level
    latest_snapshot = {
        "image": data.get("image"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    latest_audio_level = {
        "rms": data.get("audioRms"),
        "peak": data.get("audioPeak"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    return {"status": "ok"}


@app.get("/api/camera/snapshot")
async def get_snapshot():
    if latest_snapshot is None:
        raise HTTPException(status_code=404, detail="No snapshot available")
    return latest_snapshot


@app.get("/api/camera/audio-level")
async def get_audio_level():
    if latest_audio_level is None:
        raise HTTPException(status_code=404, detail="No audio level available")
    return latest_audio_level


# ── CA Certificate Download ────────────────────────────────────────────────────

@app.get("/setup/ca.pem")
async def serve_ca_cert():
    try:
        caroot = subprocess.check_output(["mkcert", "-CAROOT"]).decode().strip()
        ca_path = Path(caroot) / "rootCA.pem"
        if not ca_path.exists():
            return HTMLResponse("CA certificate not found. Run: mkcert -install", status_code=404)
        return FileResponse(
            str(ca_path),
            media_type="application/x-pem-file",
            filename="BabyTimeCA.pem",
        )
    except FileNotFoundError:
        return HTMLResponse("mkcert not installed. Run: brew install mkcert && mkcert -install", status_code=500)


# ── Static Files ───────────────────────────────────────────────────────────────

app.mount("/", StaticFiles(directory="static", html=True), name="static")


# ── Dev entry point ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    cert = Path("certs/cert.pem")
    key = Path("certs/key.pem")
    if not cert.exists() or not key.exists():
        print("ERROR: certs/cert.pem or certs/key.pem not found.")
        print("Run the mkcert setup steps in README-setup.md first.")
        sys.exit(1)

    print("BabyTime starting on https://0.0.0.0:8443")
    print("Local:   https://localhost:8443")
    try:
        lan_ip = subprocess.check_output(["ipconfig", "getifaddr", "en0"]).decode().strip()
        print(f"Network: https://{lan_ip}:8443")
    except Exception:
        pass

    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=8443,
        ssl_keyfile="certs/key.pem",
        ssl_certfile="certs/cert.pem",
        reload=False,
    )
