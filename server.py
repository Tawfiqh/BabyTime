import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from dotenv import load_dotenv

load_dotenv()  # reads variables from a .env file and sets them in os.environ

app = FastAPI()

# Read baby name from environment variable
baby_name = os.getenv("BABY_NAME", "BabyTime")

# Set up Jinja2 templating
templates = Jinja2Templates(directory="static")

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


# ── HTML Page Routes (render with Jinja2) ──────────────────────────────────────

@app.get("/")
async def index(request: Request):
    return templates.TemplateResponse(request=request, name="index.html", context={"baby_name": baby_name})

@app.get("/viewer.html")
async def viewer(request: Request):
    return templates.TemplateResponse(request=request, name="viewer.html", context={"baby_name": baby_name})

@app.get("/camera.html")
async def camera(request: Request):
    return templates.TemplateResponse(request=request, name="camera.html", context={"baby_name": baby_name})

@app.get("/slowviewer.html")
async def slowviewer(request: Request):
    return templates.TemplateResponse(request=request, name="slowviewer.html", context={"baby_name": baby_name})

@app.get("/setup.html")
async def setup(request: Request):
    return templates.TemplateResponse(request=request, name="setup.html", context={"baby_name": baby_name})


# ── Static Files ───────────────────────────────────────────────────────────────

app.mount("/", StaticFiles(directory="static", html=True), name="static")


# ── Dev entry point ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    port_number = os.getenv("PORT_NUMBER", 8443)
    cert = Path("certs/cert.pem")
    key = Path("certs/key.pem")
    if not cert.exists() or not key.exists():
        print("ERROR: certs/cert.pem or certs/key.pem not found.")
        print("Run the mkcert setup steps in README-setup.md first.")
        sys.exit(1)

    print(f"BabyTime starting on https://0.0.0.0:{port_number}")
    print(f"Local:   https://localhost:{port_number}")
    try:
        lan_ip = subprocess.check_output(["ipconfig", "getifaddr", "en0"]).decode().strip()
        print(f"Network: https://{lan_ip}:{port_number}")
    except Exception:
        pass

    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=port_number,
        ssl_keyfile="certs/key.pem",
        ssl_certfile="certs/cert.pem",
        reload=False,
    )
