// HikiDown — Facebook main-world probe.
// Facebook hides real permalinks from the DOM, but its React component tree
// (reachable via __reactFiber$* keys on DOM nodes) still carries the video ID
// and permalink props. Those keys are only visible from the page's own JS
// world, so this script runs with "world": "MAIN" and talks to the isolated
// content script via postMessage.

(() => {
  "use strict";

  const URL_RE = /\/(videos|watch|reel|stories)\//;

  function urlFromValue(k, v) {
    if (/^video_?(fb)?_?id$/i.test(k) && /^\d{6,}$/.test(String(v))) {
      return "https://www.facebook.com/watch/?v=" + v;
    }
    if (typeof v !== "string" || v.length > 2000) return null;
    if (/^https?:\/\/(www\.|web\.|m\.)?facebook\.com\//.test(v) &&
        (URL_RE.test(v) || /watch\/?\?v=\d/.test(v))) {
      return v;
    }
    if (v.startsWith("/") && URL_RE.test(v)) return location.origin + v;
    return null;
  }

  function scanProps(obj, depth, budget, seen) {
    if (!obj || typeof obj !== "object" || depth > 5 || budget.left <= 0) return null;
    if (obj.$$typeof || obj.nodeType || seen.has(obj)) return null;
    seen.add(obj);
    let entries;
    try {
      entries = Object.entries(obj);
    } catch (e) {
      return null;
    }
    for (const [k, v] of entries) {
      budget.left--;
      if (typeof v === "function") continue;
      const url = urlFromValue(k, v);
      if (url) return url;
    }
    for (const [k, v] of entries) {
      if (k === "children" || !v || typeof v !== "object") continue;
      const url = scanProps(v, depth + 1, budget, seen);
      if (url) return url;
    }
    return null;
  }

  // fiber may live on a wrapper div rather than the <video> itself
  function getFiber(el) {
    for (let node = el; node; node = node.parentElement) {
      const key = Object.keys(node).find((k) => k.startsWith("__reactFiber$"));
      if (key) return node[key];
    }
    return null;
  }

  function probe(video, diag) {
    let fiber = getFiber(video);
    diag.fiberFound = !!fiber;
    const seen = new WeakSet();
    let levels = 0;
    for (; levels < 60 && fiber; levels++, fiber = fiber.return) {
      const url = scanProps(fiber.memoizedProps, 0, { left: 4000 }, seen);
      if (url) {
        diag.levels = levels;
        return url;
      }
    }
    diag.levels = levels;
    return null;
  }

  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.type !== "hikidown-probe") return;
    const nonce = String(e.data.nonce || "");
    if (!nonce) return;
    let url = null;
    const diag = { fiberFound: false, levels: 0, videoFound: false };
    try {
      const video = document.querySelector(
        'video[data-hikidown-probe="' + CSS.escape(nonce) + '"]'
      );
      diag.videoFound = !!video;
      if (video) url = probe(video, diag);
    } catch (err) {
      diag.error = String(err);
    }
    console.log("[HikiDown] fiber probe:", url || "no url", diag);
    window.postMessage({ type: "hikidown-probe-result", nonce, url }, "*");
  });
})();
