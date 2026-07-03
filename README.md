# HikiDown

One-click video download buttons in your browser. A small ⬇ button appears on
every YouTube video (player + thumbnails on hover) and on video elements on
other sites. Clicking it sends the video to a tiny local server on your PC,
which downloads it with **yt-dlp** using 8 parallel connections — consistent,
fast speed, completely outside Chrome's normal download flow.

```
Browser button ──► HikiDown extension ──► local server (127.0.0.1:8765)
                                              │  yt-dlp, 8 parallel fragments
                                              ▼
                                   Downloads\HikiDown\video.mp4
```

## Setup (one time)

1. **Run `setup.bat`** — installs yt-dlp and ffmpeg (ffmpeg is required for
   1080p and above; without it YouTube tops out around 720p).
2. **Load the extension in Chrome / Edge / Brave:**
   - Open `chrome://extensions`
   - Turn on **Developer mode** (top-right)
   - Click **Load unpacked** and select the `extension` folder
3. **Run `start-server.bat`** and keep the window open while you browse.

## Daily use

- Start the server (`start-server.bat`), or set it to launch with Windows:
  press `Win+R`, type `shell:startup`, and drop a shortcut to
  `start-server-hidden.vbs` in that folder (runs with no window).
- **YouTube watch page:** a download arrow appears in the player's bottom-right
  control bar.
- **YouTube home/search/subscriptions:** hover any thumbnail — a small ⬇
  button appears in its corner.
- **Other sites:** hover over any playing/embedded video for the same button.
  Direct video files download as-is; streaming players fall back to yt-dlp's
  site extractors (works on most major sites).
- Click the **extension icon** for live progress, speed, quality setting
  (Best/4K/1080p/…), audio-only mode, cancel, and an "open folder" button.

Files are saved to `Downloads\HikiDown Videos` by default — click **Change…**
next to the folder path in the extension popup to pick any other folder (saved
in `server\config.json`, survives restarts).

## Why the speed is consistent

Downloads never go through the browser. The server uses yt-dlp with:
- `concurrent_fragment_downloads = 8` — eight fragments in parallel
- `http_chunk_size = 10 MB` — ranged requests that avoid YouTube's
  single-connection throttling
- automatic retries on flaky fragments

## Troubleshooting

| Symptom | Fix |
|---|---|
| Button click says "server not running" | Launch `start-server.bat` |
| Max quality is 720p | Install ffmpeg (`setup.bat` does it), restart the server |
| YouTube downloads suddenly fail | YouTube changed something — `py -3 -m pip install -U yt-dlp`, restart server |
| No button on some site's player | The player may swallow mouse events; try the video's dedicated page |
| Facebook / Instagram / X says "login" or "Unsupported URL" | Make sure you're logged in to that site in the browser — the extension forwards your cookies to the server (localhost only, deleted after each download). YouTube never uses cookies. |

> Note: downloading may violate some sites' terms of service (YouTube's
> included). Use for personal, offline viewing of content you have the right
> to save.
