/**
 * Self-contained HTML page for GET /diagnostics/oracle-logs/view. Renders the
 * Oracle call log as a filterable table by fetching the JSON list endpoint
 * (same controller, parent path). No build step / external assets.
 */
export const ORACLE_LOG_VIEW_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Oracle Call Logs</title>
<style>
  :root { font-family: system-ui, Segoe UI, Arial, sans-serif; }
  body { margin: 0; padding: 16px; background: #0f1420; color: #e6e9ef; }
  h1 { font-size: 18px; margin: 0 0 12px; }
  .filters { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 12px; }
  .filters input, .filters select {
    background: #1a2130; color: #e6e9ef; border: 1px solid #2b3446; border-radius: 6px;
    padding: 6px 8px; font-size: 13px;
  }
  .filters button {
    background: #2d6cdf; color: #fff; border: 0; border-radius: 6px; padding: 7px 12px;
    font-size: 13px; cursor: pointer;
  }
  .filters button.ghost { background: #2b3446; }
  #meta { color: #9aa4b6; font-size: 12px; margin-left: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #222b3b; vertical-align: top; }
  th { position: sticky; top: 0; background: #161d2b; color: #9aa4b6; }
  tr.err td { background: rgba(220,60,60,0.10); }
  tr.datarow:hover td { background: rgba(255,255,255,0.04); cursor: pointer; }
  .pill { padding: 1px 7px; border-radius: 999px; font-size: 11px; }
  .pill.success { background: #14361f; color: #7ee2a2; }
  .pill.error { background: #3a1620; color: #ff8ea3; }
  .mono { font-family: ui-monospace, Consolas, monospace; white-space: pre-wrap; word-break: break-word; }
  .muted { color: #9aa4b6; }
  .view-btn {
    background: #2b3446; color: #e6e9ef; border: 0; border-radius: 6px; padding: 4px 10px;
    font-size: 11px; cursor: pointer;
  }
  #overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.55); align-items: center; justify-content: center; z-index: 10; }
  #detail { background: #161d2b; border: 1px solid #2b3446; border-radius: 10px; width: min(920px, 92vw); max-height: 86vh; overflow: auto; padding: 18px; }
  #detail h3 { margin: 18px 0 6px; font-size: 13px; color: #9aa4b6; border-bottom: 1px solid #2b3446; padding-bottom: 4px; }
  #detail h3:first-child { margin-top: 0; }
  #detail pre { white-space: pre-wrap; word-break: break-word; font-size: 12px; background: #0f1420; padding: 10px; border-radius: 6px; margin: 4px 0; }
  #detail .close { float: right; background: #2b3446; color: #fff; border: 0; border-radius: 6px; padding: 6px 10px; cursor: pointer; }
  #detail .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px; }
</style>
</head>
<body>
  <h1>Oracle Call Logs</h1>
  <div class="filters">
    <input id="f-enum" placeholder="enum / username"/>
    <input id="f-correlationId" placeholder="correlationId"/>
    <input id="f-object" placeholder="object (e.g. PROFILE)"/>
    <input id="f-oraCode" placeholder="oraCode (e.g. 904)" style="width:130px"/>
    <select id="f-status">
      <option value="">status: all</option>
      <option value="error">error</option>
      <option value="success">success</option>
    </select>
    <input id="f-limit" type="number" placeholder="limit" value="100" style="width:80px"/>
    <button onclick="load()">Apply</button>
    <button class="ghost" onclick="reset()">Reset</button>
    <label class="muted"><input type="checkbox" id="f-auto"/> auto 5s</label>
    <button class="ghost" onclick="clearLogs()">Clear buffer</button>
    <span id="meta"></span>
  </div>
  <table>
    <thead><tr>
      <th>#</th><th>time</th><th>op</th><th>object</th><th>status</th><th>ms</th>
      <th>ORA</th><th>correlationId</th><th>request</th><th></th>
    </tr></thead>
    <tbody id="rows"></tbody>
  </table>

  <div id="overlay"><div id="detail"></div></div>

<script>
  var base = location.pathname.replace(/\\/view$/, "");
  var FIELDS = ["enum", "correlationId", "object", "oraCode", "status", "limit"];
  var cache = {};

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function qs() {
    var p = new URLSearchParams();
    FIELDS.forEach(function (k) {
      var el = document.getElementById("f-" + k);
      if (el && el.value !== "") p.set(k, el.value.trim());
    });
    return p.toString();
  }
  function row(e) {
    cache[e.id] = e;
    return "<tr class='datarow " + (e.status === "error" ? "err" : "") + "' onclick='showDetail(" + e.id + ")'>"
      + "<td>" + esc(e.id) + "</td>"
      + "<td class='muted'>" + esc((e.timestamp || "").replace("T", " ").replace("Z", "")) + "</td>"
      + "<td>" + esc(e.op) + "</td>"
      + "<td>" + esc(e.object) + "</td>"
      + "<td><span class='pill " + esc(e.status) + "'>" + esc(e.status) + "</span></td>"
      + "<td>" + esc(e.durationMs) + "</td>"
      + "<td>" + esc(e.oraCode || "") + "</td>"
      + "<td class='muted'>" + esc(e.correlationId || "") + "</td>"
      + "<td class='muted'>" + esc(e.method || "") + " " + esc(e.path || "") + "</td>"
      + "<td><button class='view-btn' onclick='event.stopPropagation(); showDetail(" + e.id + ")'>View</button></td>"
      + "</tr>";
  }
  function load() {
    fetch(base + "?" + qs(), { headers: { accept: "application/json" } })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var d = (j && j.result) ? j.result : j;
        var items = d.items || [];
        cache = {};
        document.getElementById("meta").textContent =
          "showing " + items.length + " of " + d.total + " matched — click a row for details";
        document.getElementById("rows").innerHTML =
          items.map(row).join("") || "<tr><td colspan='10' class='muted'>no matching logs</td></tr>";
      })
      .catch(function (err) {
        document.getElementById("meta").textContent = "load error: " + err;
      });
  }
  function reset() {
    FIELDS.forEach(function (k) {
      var el = document.getElementById("f-" + k);
      if (el) el.value = k === "limit" ? "100" : "";
    });
    load();
  }
  function clearLogs() {
    if (!confirm("Clear the in-memory Oracle log buffer?")) return;
    fetch(base, { method: "DELETE" }).then(function () { load(); });
  }

  function field(label, value) {
    return "<div><b>" + esc(label) + ":</b> " + esc(value == null || value === "" ? "-" : value) + "</div>";
  }
  function pretty(value) {
    if (value === undefined || value === null || value === "") return "-";
    if (typeof value === "string") return value;
    try { return JSON.stringify(value, null, 2); } catch (ex) { return String(value); }
  }
  function block(title, value) {
    var text = pretty(value);
    if (text === "-") return "<h3>" + esc(title) + "</h3><div class='muted'>-</div>";
    return "<h3>" + esc(title) + "</h3><pre>" + esc(text) + "</pre>";
  }
  function showDetail(id) {
    var e = cache[id];
    if (!e) return;
    var binds = e.binds && Object.keys(e.binds).length
      ? Object.keys(e.binds).map(function (k) { return k + " = " + e.binds[k]; }).join("\\n")
      : "-";
    var html = "<button class='close' onclick='closeDetail()'>Close</button>"
      + "<h3>General</h3>"
      + "<div class='row2'>"
      + field("id", "#" + e.id) + field("timestamp", e.timestamp)
      + field("op", e.op) + field("object", e.object)
      + field("status", e.status) + field("duration (ms)", e.durationMs)
      + field("ORA code", e.oraCode) + field("row count", e.rowCount)
      + field("correlationId", e.correlationId) + field("request", (e.method || "") + " " + (e.path || ""))
      + "</div>"
      + block("Binds", binds === "-" ? undefined : binds)
      + block("SQL", e.sql)
      + block("Final SQL (binds inlined)", e.finalSql)
      + block("Oracle Response", e.response)
      + block("Error", e.error);
    document.getElementById("detail").innerHTML = html;
    document.getElementById("overlay").style.display = "flex";
  }
  function closeDetail() { document.getElementById("overlay").style.display = "none"; }
  document.getElementById("overlay").addEventListener("click", function (ev) { if (ev.target.id === "overlay") closeDetail(); });

  var timer = null;
  document.getElementById("f-auto").addEventListener("change", function (ev) {
    if (ev.target.checked) { timer = setInterval(load, 5000); }
    else if (timer) { clearInterval(timer); timer = null; }
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") { closeDetail(); return; }
    if (ev.key === "Enter" && document.getElementById("overlay").style.display !== "flex") load();
  });
  load();
</script>
</body>
</html>`;
