// Shared helpers for HikiDown content scripts.

const HIKIDOWN_ARROW_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">' +
  '<path d="M12 3a1 1 0 0 1 1 1v8.6l2.8-2.8a1 1 0 1 1 1.4 1.4l-4.5 4.5a1 1 0 0 1-1.4 0L6.8 11.2a1 1 0 1 1 1.4-1.4L11 12.6V4a1 1 0 0 1 1-1z"/>' +
  '<path d="M5 19a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1z"/></svg>';

function hikidownToast(message, ok = true) {
  try {
    const el = document.createElement("div");
    el.className = "hikidown-toast" + (ok ? "" : " hikidown-toast-error");
    el.textContent = message;
    (document.body || document.documentElement).appendChild(el);
    requestAnimationFrame(() => el.classList.add("hikidown-toast-show"));
    setTimeout(() => {
      el.classList.remove("hikidown-toast-show");
      setTimeout(() => el.remove(), 400);
    }, 4000);
  } catch (e) {
    /* page may forbid DOM changes; ignore */
  }
}

async function hikidownRequest(url) {
  try {
    const res = await chrome.runtime.sendMessage({
      type: "hikidown-download",
      url,
      pageUrl: location.href,
    });
    if (res && res.ok) {
      hikidownToast("HikiDown: queued ⬇ — open the extension popup for progress");
    } else {
      hikidownToast("HikiDown: " + ((res && res.error) || "unknown error"), false);
    }
  } catch (e) {
    hikidownToast("HikiDown: extension was reloaded — refresh this page.", false);
  }
}

// Creates the small floating download button used over thumbnails/videos.
function hikidownCreateFloatButton(onClick) {
  const btn = document.createElement("button");
  btn.className = "hikidown-float";
  btn.type = "button";
  btn.title = "Download with HikiDown";
  btn.innerHTML = HIKIDOWN_ARROW_SVG;
  btn.style.display = "none";
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });
  // mousedown on some players triggers play/pause — swallow it
  btn.addEventListener("mousedown", (e) => e.stopPropagation());
  const attach = () => (document.body || document.documentElement).appendChild(btn);
  if (document.body) attach();
  else document.addEventListener("DOMContentLoaded", attach, { once: true });
  return btn;
}
