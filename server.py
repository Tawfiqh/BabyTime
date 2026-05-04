import argparse
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
    """mkcert CA when available; else certs/ca.pem (OpenSSL self-signed copy)."""
    repo_ca = Path("certs/ca.pem")
    if repo_ca.exists():
        return FileResponse(
            str(repo_ca),
            media_type="application/x-pem-file",
            filename="BabyTimeCA.pem",
        )
    try:
        caroot = subprocess.check_output(["mkcert", "-CAROOT"]).decode().strip()
        ca_path = Path(caroot) / "rootCA.pem"
        if not ca_path.exists():
            return HTMLResponse(
                "CA certificate not found. Install mkcert and run mkcert -install, "
                "or use OpenSSL-generated certs (certs/ca.pem).",
                status_code=404,
            )
        return FileResponse(
            str(ca_path),
            media_type="application/x-pem-file",
            filename="BabyTimeCA.pem",
        )
    except FileNotFoundError:
        return HTMLResponse(
            "No CA available. Use mkcert, or run with OpenSSL certs so certs/ca.pem exists.",
            status_code=500,
        )


# ── Static Files ───────────────────────────────────────────────────────────────

app.mount("/", StaticFiles(directory="static", html=True), name="static")


# ── Dev entry point ────────────────────────────────────────────────────────────

def _guess_lan_ip() -> Optional[str]:
    try:
        return subprocess.check_output(["ipconfig", "getifaddr", "en0"]).decode().strip()
    except Exception:
        pass
    try:
        out = subprocess.check_output(
            ["ip", "-4", "route", "get", "8.8.8.8"],
            stderr=subprocess.DEVNULL,
        ).decode()
        parts = out.split()
        if "src" in parts:
            return parts[parts.index("src") + 1]
    except Exception:
        pass
    return None


if __name__ == "__main__":
    import uvicorn

    parser = argparse.ArgumentParser(description="BabyTime HTTPS (or HTTP) server")
    parser.add_argument(
        "--http",
        action="store_true",
        help="Serve plain HTTP on port 8442 (camera on localhost only; use for no-TLS testing)",
    )
    args = parser.parse_args()

    cert = Path("certs/cert.pem")
    key = Path("certs/key.pem")

    if args.http:
        print("BabyTime starting on http://0.0.0.0:8442 (HTTP — no TLS)")
        print("Local:   http://localhost:8442")
        lan = _guess_lan_ip()
        if lan:
            print(f"Network: http://{lan}:8442")
        print("Tip: getUserMedia works on http://localhost; LAN HTTP may block camera.")
        uvicorn.run(
            "server:app",
            host="0.0.0.0",
            port=8442,
            reload=False,
        )
    else:
        if not cert.exists() or not key.exists():
            print("ERROR: certs/cert.pem or certs/key.pem not found.", file=sys.stderr)
            print("Run: bash install.sh   or   bash scripts/ensure-certs.sh", file=sys.stderr)
            sys.exit(1)

        print("BabyTime starting on https://0.0.0.0:8443")
        print("Local:   https://localhost:8443")
        lan = _guess_lan_ip()
        if lan:
            print(f"Network: https://{lan}:8443")

        uvicorn.run(
            "server:app",
            host="0.0.0.0",
            port=8443,
            ssl_keyfile="certs/key.pem",
            ssl_certfile="certs/cert.pem",
            reload=False,
        )
