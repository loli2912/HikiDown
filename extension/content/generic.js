// HikiDown — generic sites.
// Shows a small floating download button over any sizable <video> element.
// Direct file sources are downloaded as-is; blob/MSE streams fall back to
// handing the page URL to yt-dlp, which knows how to extract most sites.

(() => {
  "use strict";

  try {
    console.log("[HikiDown] content script v" + chrome.runtime.getManifest().version);
  } catch (e) {}

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
    // wrapped in a link directly (e.g. thumbnail-style embeds)
    let node = v;
    while (node && node !== document.body) {
      if (node.tagName === "A" && node.href && !node.href.endsWith("#")) return node.href;
      node = node.parentElement;
    }
    // otherwise scan the whole post container — sites bury videos many DOM
    // levels deep, so a fixed-depth walk-up misses the permalink entirely
    const scope = postContainer(v);
    if (!scope || !scope.querySelectorAll) return null;
    const links = [...scope.querySelectorAll(PERMALINK_SEL)].filter(
      (a) => a.href && !a.href.endsWith("#")
    );
    if (!links.length) return null;
    // X puts the tweet permalink on its timestamp link
    for (const a of links) if (a.querySelector("time")) return a.href;
    for (const a of links) if (/\/status\/\d+/.test(a.href)) return a.href;
    return links[0].href;
  }

  // feed/landing paths that identify no specific video — sending them to
  // yt-dlp can only fail with "Unsupported URL"
  const FEED_PATHS = new Set(["/", "/home", "/home.php", "/watch", "/watch/", "/reels", "/feed", "/explore", "/foryou"]);

  const IS_FACEBOOK = /(^|\.)facebook\.com$/.test(location.hostname);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function postContainer(v) {
    const article = v.closest('[role="article"], article');
    if (article) return article;
    let node = v;
    for (let i = 0; i < 8 && node.parentElement; i++) node = node.parentElement;
    return node;
  }

  // Ask the main-world script (fb-main.js) to read the video's React fiber
  // props, where Facebook keeps the real video ID / permalink.
  function fiberProbe(v) {
    return new Promise((resolve) => {
      const nonce = Math.random().toString(36).slice(2);
      const finish = (url) => {
        clearTimeout(timer);
        window.removeEventListener("message", onMsg);
        delete v.dataset.hikidownProbe;
        resolve(typeof url === "string" && url ? url : null);
      };
      const onMsg = (e) => {
        if (e.source !== window || !e.data) return;
        if (e.data.type !== "hikidown-probe-result" || e.data.nonce !== nonce) return;
        finish(e.data.url);
      };
      const timer = setTimeout(() => finish(null), 500);
      window.addEventListener("message", onMsg);
      v.dataset.hikidownProbe = nonce;
      window.postMessage({ type: "hikidown-probe", nonce }, "*");
    });
  }

  // Facebook fills in the timestamp link's real href only on hover; fake the
  // hover, then rescan for permalinks.
  async function hoverReveal(container, v) {
    const candidates = container.querySelectorAll('a[href="#"], a[attributionsrc], a[role="link"]');
    let n = 0;
    for (const a of candidates) {
      if (n++ >= 20) break;
      // Facebook listens for pointer events, not just mouse events
      for (const [Ctor, type] of [
        [PointerEvent, "pointerover"],
        [PointerEvent, "pointermove"],
        [MouseEvent, "mouseover"],
        [MouseEvent, "mousemove"],
        [FocusEvent, "focusin"],
      ]) {
        try {
          a.dispatchEvent(new Ctor(type, { bubbles: true }));
        } catch (e) {}
      }
    }
    await sleep(350);
    return permalinkFor(v);
  }

  function htmlIdScan(container) {
    const html = container.innerHTML;
    const m =
      html.match(/(?:videos\/|watch\/\?v=|reel\/)(\d{8,})/) ||
      html.match(/"video_?id["\\]*:["\\]*(\d{8,})/i);
    return m ? "https://www.facebook.com/watch/?v=" + m[1] : null;
  }

  async function resolveVideoUrl(v) {
    let url = permalinkFor(v);
    if (url) return { url, step: "permalink" };
    if (IS_FACEBOOK) {
      console.log("[HikiDown] no visible permalink, trying fiber probe…");
      url = await fiberProbe(v);
      if (url) return { url, step: "fiber" };
      console.log("[HikiDown] fiber probe failed, trying hover reveal…");
      const container = postContainer(v);
      url = await hoverReveal(container, v);
      if (url) return { url, step: "hover" };
      console.log("[HikiDown] hover reveal failed, trying HTML scan…");
      url = htmlIdScan(container);
      if (url) return { url, step: "regex" };
      console.log("[HikiDown] all resolution steps failed for this post");
    }
    return null;
  }

  const floatBtn = hikidownCreateFloatButton(async () => {
    if (!currentVideo) return;
    const v = currentVideo;
    const src = v.currentSrc || v.src || "";
    const direct = src && !src.startsWith("blob:") && !src.startsWith("data:");
    if (direct) return hikidownRequest(src);

    if (IS_FACEBOOK && !permalinkFor(v)) hikidownToast("HikiDown: finding video…");
    const resolved = await resolveVideoUrl(v);
    if (resolved) {
      console.log("[HikiDown] resolved via", resolved.step + ":", resolved.url);
      return hikidownRequest(resolved.url);
    }
    try {
      const t = new URL(location.href);
      if (FEED_PATHS.has(t.pathname) && !t.searchParams.get("v")) {
        hikidownToast(
          "HikiDown: can't identify this video from the feed — click the video to open it on its own page, then press download there.",
          false
        );
        return;
      }
    } catch (e) {}
    hikidownRequest(location.href);
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
