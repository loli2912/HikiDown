// HikiDown background service worker.
// Relays download requests from content scripts to the local HikiDown server.

const SERVER = "http://127.0.0.1:8765";

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "hikidown-download") {
    queueDownload(msg)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
    return true; // keep the message channel open for the async response
  }
});

async function queueDownload(msg) {
  const settings = await chrome.storage.sync.get({ maxHeight: "best", audioOnly: false });
  let res;
  try {
    res = await fetch(SERVER + "/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: msg.url,
        pageUrl: msg.pageUrl || msg.url,
        maxHeight: settings.maxHeight,
        audioOnly: settings.audioOnly,
      }),
    });
  } catch (e) {
    return { ok: false, error: "HikiDown server is not running — launch start-server.bat first." };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    return { ok: false, error: data.error || "Server error (" + res.status + ")" };
  }
  return { ok: true, id: data.id };
}
