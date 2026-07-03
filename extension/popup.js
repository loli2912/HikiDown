const SERVER = "http://127.0.0.1:8765";

const $ = (id) => document.getElementById(id);

$("ver").textContent = "v" + chrome.runtime.getManifest().version;

// ---- settings ----
chrome.storage.sync.get({ maxHeight: "best", audioOnly: false }).then((s) => {
  $("maxHeight").value = s.maxHeight;
  $("audioOnly").checked = s.audioOnly;
});
$("maxHeight").addEventListener("change", () =>
  chrome.storage.sync.set({ maxHeight: $("maxHeight").value })
);
$("audioOnly").addEventListener("change", () =>
  chrome.storage.sync.set({ audioOnly: $("audioOnly").checked })
);

$("openFolder").addEventListener("click", () =>
  fetch(SERVER + "/openfolder", { method: "POST" }).catch(() => {})
);
$("clearDone").addEventListener("click", () =>
  fetch(SERVER + "/clear", { method: "POST" }).then(poll).catch(() => {})
);

// ---- job list ----
function fmtBytes(n) {
  if (!n && n !== 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return n.toFixed(n >= 100 || i === 0 ? 0 : 1) + " " + units[i];
}

function render(jobs) {
  const box = $("jobs");
  box.textContent = "";
  $("empty").style.display = jobs.length ? "none" : "block";
  for (const j of jobs.slice().reverse()) {
    const div = document.createElement("div");
    div.className = "job";

    const title = document.createElement("div");
    title.className = "job-title";
    title.textContent = j.title || j.url;
    title.title = j.title || j.url;
    if (j.status === "done") {
      title.classList.add("job-title-link");
      title.title = "Show file in folder";
      title.addEventListener("click", () =>
        fetch(SERVER + "/reveal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: j.id }),
        }).catch(() => {})
      );
    }

    const bar = document.createElement("div");
    bar.className = "bar" + (j.status === "done" ? " done" : "");
    const fill = document.createElement("div");
    const pct = j.status === "done" ? 100 : Math.round((j.progress || 0) * 100);
    fill.style.width = pct + "%";
    bar.appendChild(fill);

    const meta = document.createElement("div");
    meta.className = "job-meta";
    const left = document.createElement("span");
    const right = document.createElement("span");

    if (j.status === "downloading") {
      left.textContent =
        pct + "%" + (j.speed ? " · " + fmtBytes(j.speed) + "/s" : "") +
        (j.eta ? " · " + j.eta + "s left" : "");
      const c = document.createElement("button");
      c.className = "cancel";
      c.textContent = "cancel";
      c.addEventListener("click", () =>
        fetch(SERVER + "/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: j.id }),
        }).catch(() => {})
      );
      right.appendChild(c);
    } else if (j.status === "error") {
      left.className = "err";
      left.textContent = "failed: " + (j.error || "unknown error");
    } else {
      left.textContent = j.status + (j.filename ? " · " + j.filename : "");
    }

    meta.append(left, right);
    div.append(title, bar, meta);
    box.appendChild(div);
  }
}

async function poll() {
  try {
    const res = await fetch(SERVER + "/jobs");
    const data = await res.json();
    $("status-dot").className = "up";
    $("status-text").textContent = "server running";
    render(data.jobs || []);
  } catch (e) {
    $("status-dot").className = "down";
    $("status-text").textContent = "server offline — run start-server.bat";
    render([]);
  }
}

poll();
setInterval(poll, 1000);
