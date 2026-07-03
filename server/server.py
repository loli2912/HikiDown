"""HikiDown local download server.

Receives download requests from the HikiDown browser extension and runs them
through yt-dlp with parallel fragment downloads for consistent, fast speed.

    py -3 server.py        (or just double-click start-server.bat)
"""

import ctypes
import json
import os
import shutil
import subprocess
import sys
import tempfile
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

# Windows consoles/redirects default to a legacy codepage that can't encode
# Japanese etc.; a failed print must never be able to fail a finished job.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, OSError):
        pass


def log(msg):
    try:
        print(msg, flush=True)
    except Exception:
        pass


PORT = 8765
DOWNLOAD_DIR = Path.home() / "Downloads" / "HikiDown Videos"
DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

jobs = {}          # id -> job dict
jobs_order = []    # insertion order
lock = threading.Lock()


def find_ffmpeg():
    """ffmpeg on PATH, or wherever winget put it (PATH may be stale after install)."""
    path = shutil.which("ffmpeg")
    if path:
        return path
    local = Path(os.environ.get("LOCALAPPDATA", ""))
    links = local / "Microsoft" / "WinGet" / "Links" / "ffmpeg.exe"
    if links.exists():
        return str(links)
    packages = local / "Microsoft" / "WinGet" / "Packages"
    if packages.exists():
        for pkg in packages.glob("Gyan.FFmpeg*"):
            hits = sorted(pkg.glob("**/bin/ffmpeg.exe"))
            if hits:
                return str(hits[-1])
    return None


FFMPEG = find_ffmpeg()


def _focus_explorer():
    """Bring the newest Explorer window to the foreground.

    Windows 11 opens external folder links as a background tab of an existing
    window, and blocks focus changes from background processes. Tapping ALT
    via keybd_event lifts that foreground lock so SetForegroundWindow works.
    """
    user32 = ctypes.windll.user32
    for _ in range(30):  # wait up to 3s for the window/tab to exist
        hwnd = user32.FindWindowW("CabinetWClass", None)
        if hwnd:
            time.sleep(0.3)  # let the new tab finish attaching first
            if user32.IsIconic(hwnd):
                user32.ShowWindow(hwnd, 9)  # SW_RESTORE
            user32.keybd_event(0xA4, 0, 0, 0)  # ALT down
            user32.keybd_event(0xA4, 0, 2, 0)  # ALT up (KEYEVENTF_KEYUP)
            # attach to the current foreground thread so Windows treats our
            # focus change as coming from the active app
            kernel32 = ctypes.windll.kernel32
            fg_thread = user32.GetWindowThreadProcessId(user32.GetForegroundWindow(), None)
            our_thread = kernel32.GetCurrentThreadId()
            attached = fg_thread and user32.AttachThreadInput(our_thread, fg_thread, True)
            # SwitchToThisWindow force-switches like Alt-Tab; plain
            # SetForegroundWindow is refused for background processes
            user32.SwitchToThisWindow(hwnd, True)
            user32.BringWindowToTop(hwnd)
            user32.SetForegroundWindow(hwnd)
            if attached:
                user32.AttachThreadInput(our_thread, fg_thread, False)
            return
        time.sleep(0.1)


def open_explorer(command):
    subprocess.Popen(command)
    threading.Thread(target=_focus_explorer, daemon=True).start()


def build_format(max_height, audio_only):
    if audio_only:
        return "ba[ext=m4a]/ba/b", {}
    h = f"[height<={max_height}]" if str(max_height).isdigit() else ""
    if FFMPEG:
        fmt = f"bv*[ext=mp4]{h}+ba[ext=m4a]/bv*{h}+ba/b{h}/b"
        return fmt, {"merge_output_format": "mp4"}
    # without ffmpeg only progressive (single-file) formats are usable
    return f"b[ext=mp4]{h}/b{h}/b", {}


def write_cookie_file(job_id, cookies):
    """Cookies from the extension -> Netscape cookies.txt for yt-dlp."""
    path = Path(tempfile.gettempdir()) / f"hikidown-cookies-{job_id}.txt"
    lines = ["# Netscape HTTP Cookie File\n"]
    for c in cookies:
        domain = c.get("domain", "")
        if not domain or not c.get("name"):
            continue
        # session cookies have no expiry; give one so yt-dlp doesn't drop them
        expiry = int(c.get("expirationDate") or (time.time() + 7 * 86400))
        lines.append("\t".join([
            domain,
            "TRUE" if domain.startswith(".") else "FALSE",
            c.get("path", "/"),
            "TRUE" if c.get("secure") else "FALSE",
            str(expiry),
            c["name"],
            c.get("value", ""),
        ]) + "\n")
    path.write_text("".join(lines), encoding="utf-8")
    return path


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

    cookie_file = None
    if payload.get("cookies"):
        cookie_file = write_cookie_file(job["id"], payload["cookies"])
        opts["cookiefile"] = str(cookie_file)

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
            filepath=filepath,
        )
        log(f"[done] {job['title']}")
    except yt_dlp.utils.DownloadCancelled:
        job["status"] = "cancelled"
        log(f"[cancelled] {job['url']}")
    except Exception as e:
        msg = str(e)
        if "ERROR:" in msg:
            msg = msg.split("ERROR:", 1)[1].strip()
        job.update(status="error", error=msg[:300])
        log(f"[error] {job['url']}: {msg[:200]}")
    finally:
        if cookie_file:
            try:
                cookie_file.unlink(missing_ok=True)
            except OSError:
                pass


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
        "filepath": None,
        "error": None,
        "cancelled": False,
        "created": time.time(),
    }
    with lock:
        jobs[job_id] = job
        jobs_order.append(job_id)
    threading.Thread(target=run_job, args=(job, payload), daemon=True).start()
    log(f"[queued] {payload['url']}")
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
            open_explorer(f'explorer "{DOWNLOAD_DIR}"')
            self._json(200, {"ok": True})
        elif self.path == "/reveal":
            job = jobs.get(self._body().get("id"))
            fp = job and job.get("filepath")
            if fp and Path(fp).exists():
                open_explorer(f'explorer /select,"{fp}"')
                self._json(200, {"ok": True})
            else:
                # file gone or job unfinished — fall back to the folder itself
                open_explorer(f'explorer "{DOWNLOAD_DIR}"')
                self._json(200, {"ok": True, "fallback": True})
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
