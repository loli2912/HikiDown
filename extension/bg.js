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

// Sites like Facebook/Instagram refuse anonymous downloads, so we forward the
// browser's cookies for the video's site to the local server. YouTube is
// deliberately excluded: it works anonymously, and downloading with account
// cookies risks getting the account rate-limited.
const NO_COOKIE_HOSTS = /(^|\.)(youtube\.com|googlevideo\.com|youtu\.be)$/;

async function collectCookies(msg) {
  const out = [];
  const seen = new Set();
  for (const raw of [msg.pageUrl, msg.url]) {
    let u;
    try { u = new URL(raw); } catch { continue; }
    if (!u.protocol.startsWith("http") || NO_COOKIE_HOSTS.test(u.hostname)) continue;
    let cookies = [];
    try { cookies = await chrome.cookies.getAll({ url: u.href }); } catch { continue; }
    for (const c of cookies) {
      const key = c.domain + "|" + c.path + "|" + c.name;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        domain: c.domain,
        path: c.path,
        name: c.name,
        value: c.value,
        secure: c.secure,
        expirationDate: c.expirationDate,
      });
    }
  }
  return out;
}

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
        cookies: await collectCookies(msg),
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
