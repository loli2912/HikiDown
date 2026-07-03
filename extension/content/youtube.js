// HikiDown — YouTube integration.
// 1. A download button inside the player controls on watch/shorts pages.
// 2. A small floating button over any video thumbnail on hover.

(() => {
  "use strict";

  // ---------- floating button over thumbnails ----------
  let currentUrl = null;
  let currentAnchor = null;

  const floatBtn = hikidownCreateFloatButton(() => {
    if (currentUrl) hikidownRequest(currentUrl);
  });

  function anchorVideoUrl(a) {
    try {
      const u = new URL(a.href, location.origin);
      if (u.pathname === "/watch" && u.searchParams.get("v")) {
        return "https://www.youtube.com/watch?v=" + u.searchParams.get("v");
      }
      const shorts = u.pathname.match(/^\/shorts\/([\w-]{6,})/);
      if (shorts) return "https://www.youtube.com/shorts/" + shorts[1];
    } catch (e) {}
    return null;
  }

  function showFloatFor(a) {
    const rect = a.getBoundingClientRect();
    if (rect.width < 120 || rect.height < 60) return; // skip tiny/nav links
    currentAnchor = a;
    floatBtn.style.display = "flex";
    floatBtn.style.left = Math.round(rect.right - 34) + "px";
    floatBtn.style.top = Math.round(rect.top + 6) + "px";
  }

  function hideFloat() {
    currentAnchor = null;
    currentUrl = null;
    floatBtn.style.display = "none";
  }

  document.addEventListener(
    "mouseover",
    (e) => {
      if (!e.target || !e.target.closest) return;
      if (e.target === floatBtn || floatBtn.contains(e.target)) return;
      const a = e.target.closest('a[href*="/watch?v="], a[href*="/shorts/"]');
      if (!a) return;
      // only thumbnails (they contain an image), not title/menu links
      if (!a.querySelector("img, yt-image")) return;
      const url = anchorVideoUrl(a);
      if (!url) return;
      currentUrl = url;
      showFloatFor(a);
    },
    true
  );

  // hide when the cursor leaves both the thumbnail and the button
  let hideCheck = 0;
  document.addEventListener("mousemove", (e) => {
    if (!currentAnchor) return;
    const now = Date.now();
    if (now - hideCheck < 120) return;
    hideCheck = now;
    const r = currentAnchor.getBoundingClientRect();
    const pad = 12;
    const inside =
      e.clientX > r.left - pad &&
      e.clientX < r.right + pad &&
      e.clientY > r.top - pad &&
      e.clientY < r.bottom + pad;
    if (!inside) hideFloat();
  });

  document.addEventListener("scroll", hideFloat, true);

  // ---------- button inside the player controls ----------
  function cleanWatchUrl() {
    const u = new URL(location.href);
    if (u.pathname === "/watch") {
      return "https://www.youtube.com/watch?v=" + (u.searchParams.get("v") || "");
    }
    return location.href;
  }

  function addPlayerButton() {
    if (!/^\/(watch|shorts)/.test(location.pathname)) return;
    const controls = document.querySelector(".ytp-right-controls");
    if (!controls || controls.querySelector(".hikidown-ytp")) return;
    const b = document.createElement("button");
    b.className = "ytp-button hikidown-ytp";
    b.title = "Download with HikiDown";
    b.innerHTML =
      '<svg viewBox="0 0 36 36" width="100%" height="100%" fill="#fff">' +
      '<path d="M18 8a1.4 1.4 0 0 1 1.4 1.4v10l3.5-3.5a1.4 1.4 0 1 1 2 2l-5.9 5.9a1.4 1.4 0 0 1-2 0l-5.9-5.9a1.4 1.4 0 1 1 2-2l3.5 3.5v-10A1.4 1.4 0 0 1 18 8z"/>' +
      '<path d="M9.5 27a1.4 1.4 0 0 1 1.4-1.4h14.2a1.4 1.4 0 1 1 0 2.8H10.9A1.4 1.4 0 0 1 9.5 27z"/></svg>';
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      hikidownRequest(cleanWatchUrl());
    });
    controls.prepend(b);
  }

  addPlayerButton();
  window.addEventListener("yt-navigate-finish", () => setTimeout(addPlayerButton, 300));
  setInterval(addPlayerButton, 2000); // YouTube rebuilds the player DOM at will
})();
