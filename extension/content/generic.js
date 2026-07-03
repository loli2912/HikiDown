// HikiDown — generic sites.
// Shows a small floating download button over any sizable <video> element.
// Direct file sources are downloaded as-is; blob/MSE streams fall back to
// handing the page URL to yt-dlp, which knows how to extract most sites.

(() => {
  "use strict";

  const MIN_W = 200;
  const MIN_H = 100;

  let currentVideo = null;

  const floatBtn = hikidownCreateFloatButton(() => {
    if (!currentVideo) return;
    const src = currentVideo.currentSrc || currentVideo.src || "";
    const direct = src && !src.startsWith("blob:") && !src.startsWith("data:");
    hikidownRequest(direct ? src : location.href);
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
