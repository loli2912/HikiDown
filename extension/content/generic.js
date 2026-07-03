// HikiDown — generic sites.
// Shows a small floating download button over any sizable <video> element.
// Direct file sources are downloaded as-is; blob/MSE streams fall back to
// handing the page URL to yt-dlp, which knows how to extract most sites.

(() => {
  "use strict";

  const MIN_W = 200;
  const MIN_H = 100;

  let currentVideo = null;

  // Feeds (X, Instagram, TikTok, Facebook) play videos while the address bar
  // still says /home — yt-dlp needs the post's own permalink, so look for one
  // near the video element.
  const PERMALINK_SEL =
    'a[href*="/status/"], a[href*="/reel"], a[href*="/video"], ' +
    'a[href*="/watch"], a[href*="/shorts/"], a[href*="/p/"], ' +
    'a[href*="/posts/"], a[href*="permalink.php"], a[href*="story.php"], ' +
    'a[href*="/stories/"], a[href*="fbid="]';

  function permalinkFor(v) {
    let node = v;
    for (let i = 0; i < 10 && node && node !== document.body; i++) {
      if (node.tagName === "A" && node.href) return node.href;
      const links = node.querySelectorAll ? node.querySelectorAll(PERMALINK_SEL) : [];
      if (links.length) {
        // X puts the tweet permalink on its timestamp link
        for (const a of links) if (a.querySelector("time")) return a.href;
        return links[0].href;
      }
      // don't climb past the post container into the rest of the feed
      if (node.matches && node.matches("article, [role='article']")) break;
      node = node.parentElement;
    }
    return null;
  }

  // feed/landing paths that identify no specific video — sending them to
  // yt-dlp can only fail with "Unsupported URL"
  const FEED_PATHS = new Set(["/", "/home", "/home.php", "/watch", "/watch/", "/reels", "/feed", "/explore", "/foryou"]);

  const floatBtn = hikidownCreateFloatButton(() => {
    if (!currentVideo) return;
    const src = currentVideo.currentSrc || currentVideo.src || "";
    const direct = src && !src.startsWith("blob:") && !src.startsWith("data:");
    if (direct) return hikidownRequest(src);
    const link = permalinkFor(currentVideo);
    const target = link || location.href;
    try {
      const t = new URL(target);
      if (!link && FEED_PATHS.has(t.pathname) && !t.searchParams.get("v")) {
        hikidownToast(
          "HikiDown: can't identify this video from the feed — click the video to open it on its own page, then press download there.",
          false
        );
        return;
      }
    } catch (e) {}
    hikidownRequest(target);
  });

  function videoAtPoint(x, y) {
    let best = null;
    for (const v of document.querySelectorAll("video")) {
      const r = v.getBoundingClientRect();
      if (r.width < MIN_W || r.height < MIN_H) continue;
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) best = v;
    }
    return best;
  }

  let lastMove = 0;
  document.addEventListener("mousemove", (e) => {
    const now = Date.now();
    if (now - lastMove < 150) return;
    lastMove = now;

    // keep visible while hovering the button itself
    if (floatBtn.style.display !== "none") {
      const br = floatBtn.getBoundingClientRect();
      const pad = 8;
      if (
        e.clientX > br.left - pad && e.clientX < br.right + pad &&
        e.clientY > br.top - pad && e.clientY < br.bottom + pad
      ) return;
    }

    const v = videoAtPoint(e.clientX, e.clientY);
    if (v) {
      currentVideo = v;
      const r = v.getBoundingClientRect();
      floatBtn.style.display = "flex";
      floatBtn.style.left = Math.round(Math.min(r.right, window.innerWidth) - 38) + "px";
      floatBtn.style.top = Math.round(Math.max(r.top, 0) + 8) + "px";
    } else if (currentVideo) {
      currentVideo = null;
      floatBtn.style.display = "none";
    }
  });

  document.addEventListener("scroll", () => {
    currentVideo = null;
    floatBtn.style.display = "none";
  }, true);
})();
