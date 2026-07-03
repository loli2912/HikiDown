"""HikiDown local download server.

Receives download requests from the HikiDown browser extension and runs them
through yt-dlp with parallel fragment downloads for consistent, fast speed.

    py -3 server.py        (or just double-click start-server.bat)
"""

import json
import os
import shutil
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

try:
    import yt_dlp
except ImportError:
    raise SystemExit(
        "yt-dlp is not installed. Run setup.bat first (or: py -3 -m pip install yt-dlp)"
    )

PORT = 8765
DOWNLOAD_DIR = Path.home() / "Downloads" / "HikiDown Videos"
DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

jobs = {}          # id -> job dict
jobs_order = []    # insertion order
lock = threading.Lock()


def find_ffmpeg():
    """ffmpeg on PATH, or in winget's links dir (PATH may be stale after install)."""
    path = shutil.which("ffmpeg")
    if path:
        return path
    candidate = (
        Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WinGet" / "Links" / "ffmpeg.exe"
    )
    return str(candidate) if candidate.exists() else None


FFMPEG = find_ffmpeg()


def build_format(max_height, audio_only):
    if audio_only:
        return "ba[ext=m4a]/ba/b", {}
    h = f"[height<={max_height}]" if str(max_height).isdigit() else ""
    if FFMPEG:
        fmt = f"bv*[ext=mp4]{h}+ba[ext=m4a]/bv*{h}+ba/b{h}/b"
        return fmt, {"merge_output_format": "mp4"}
    # without ffmpeg only progressive (single-file) formats are usable
    return f"b[ext=mp4]{h}/b{h}/b", {}


def run_job(job, payload):
    def hook(d):
        if job["cancelled"]:
            raise yt_dlp.utils.DownloadCancelled()
        info = d.get("info_dict") or {}
        if info.get("title"):
            job["title"] = info["title"]
        if d["status"] == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            job.update(
                status="downloading",
                progress=(d.get("downloaded_bytes", 0) / total) if total else 0,
                speed=d.get("speed"),
                eta=d.get("eta"),
            )
        elif d["status"] == "finished":
            job.update(status="processing", progress=1.0, speed=None, eta=None)

    fmt, extra = build_format(payload.get("maxHeight", "best"), payload.get("audioOnly"))
    opts = {
        "format": fmt,
        "outtmpl": str(DOWNLOAD_DIR / "%(title).200B [%(id)s].%(ext)s"),
        "concurrent_fragment_downloads": 8,
        "http_chunk_size": 10 * 1024 * 1024,
        "retries": 10,
        "fragment_retries": 10,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "progress_hooks": [hook],
        **extra,
    }
    if FFMPEG:
        opts["ffmpeg_location"] = FFMPEG
    page_url = payload.get("pageUrl")
    if page_url and page_url != job["url"]:
        opts["http_headers"] = {"Referer": page_url}

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(job["url"], download=True)
        filepath = None
        rd = (info or {}).get("requested_downloads") or []
        if rd and rd[0].get("filepath"):
            filepath = rd[0]["filepath"]
        job.update(
            status="done",
            progress=1.0,
            title=(info or {}).get("title") or job["title"],
            filename=Path(filepath).name if filepath else None,
        )
        print(f"[done] {job['title']}")
    except yt_dlp.utils.DownloadCancelled:
        job["status"] = "cancelled"
        print(f"[cancelled] {job['url']}")
    except Exception as e:
        msg = str(e)
        if "ERROR:" in msg:
            msg = msg.split("ERROR:", 1)[1].strip()
        job.update(status="error", error=msg[:300])
        print(f"[error] {job['url']}: {msg[:200]}")


def create_job(payload):
    job_id = uuid.uuid4().hex[:8]
    job = {
        "id": job_id,
        "url": payload["url"],
        "title": payload["url"],
        "status": "queued",
        "progress": 0,
        "speed": None,
        "eta": None,
        "filename": None,
        "error": None,
        "cancelled": False,
        "created": time.time(),
    }
    with lock:
        jobs[job_id] = job
        jobs_order.append(job_id)
    threading.Thread(target=run_job, args=(job, payload), daemon=True).start()
    print(f"[queued] {payload['url']}")
    return job_id


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass  # keep the console for job status lines only

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        try:
            return json.loads(self.rfile.read(length))
        except Exception:
            return {}

    def do_OPTIONS(self):
        self._json(200, {})

    def do_GET(self):
        if self.path == "/ping":
            self._json(200, {"ok": True, "ffmpeg": bool(FFMPEG), "dir": str(DOWNLOAD_DIR)})
        elif self.path == "/jobs":
            with lock:
                out = [
                    {k: v for k, v in jobs[i].items() if k != "cancelled"}
                    for i in jobs_order
                ]
            self._json(200, {"ok": True, "jobs": out})
        else:
            self._json(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        if self.path == "/download":
            payload = self._body()
            url = (payload.get("url") or "").strip()
            if not url.startswith(("http://", "https://")):
                self._json(400, {"ok": False, "error": "invalid url"})
                return
            self._json(200, {"ok": True, "id": create_job(payload)})
        elif self.path == "/cancel":
            job = jobs.get(self._body().get("id"))
            if job:
                job["cancelled"] = True
            self._json(200, {"ok": True})
        elif self.path == "/clear":
            with lock:
                keep = [
                    i for i in jobs_order
                    if jobs[i]["status"] in ("queued", "downloading", "processing")
                ]
                for i in list(jobs_order):
                    if i not in keep:
                        del jobs[i]
                jobs_order[:] = keep
            self._json(200, {"ok": True})
        elif self.path == "/openfolder":
            os.startfile(DOWNLOAD_DIR)  # noqa: S606 — local convenience endpoint
            self._json(200, {"ok": True})
        else:
            self._json(404, {"ok": False, "error": "not found"})


def main():
    print("HikiDown server")
    print(f"  listening on http://127.0.0.1:{PORT}")
    print(f"  saving to    {DOWNLOAD_DIR}")
    print(f"  ffmpeg       {'found: ' + FFMPEG if FFMPEG else 'NOT FOUND (max ~720p; run setup.bat)'}")
    print("Keep this window open while browsing. Ctrl+C to stop.\n")
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
