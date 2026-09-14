/**
 * Self-contained API-logs monitoring dashboard (GET /api-logs/view). Vanilla
 * JS + Chart.js via CDN — no build step, same pattern as the Oracle-call log
 * viewer. Fetches the JSON endpoints on this same controller.
 */
export const API_LOG_VIEW_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>API Logs Dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>
  :root { font-family: system-ui, Segoe UI, Arial, sans-serif; }
  body { margin: 0; padding: 16px; background: #0f1420; color: #e6e9ef; }
  h1 { font-size: 18px; margin: 0 0 12px; }
  h2 { font-size: 14px; color: #9aa4b6; margin: 20px 0 8px; }
  .cards { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; margin-bottom: 8px; }
  .card { background: #161d2b; border: 1px solid #2b3446; border-radius: 8px; padding: 10px 12px; }
  .card .v { font-size: 22px; font-weight: 600; }
  .card .l { font-size: 11px; color: #9aa4b6; }
  .charts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 8px; }
  .chart-box { background: #161d2b; border: 1px solid #2b3446; border-radius: 8px; padding: 10px; height: 220px; }
  .filters { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 14px 0; }
  .filters input, .filters select {
    background: #1a2130; color: #e6e9ef; border: 1px solid #2b3446; border-radius: 6px;
    padding: 6px 8px; font-size: 13px;
  }
  .filters button { background: #2d6cdf; color: #fff; border: 0; border-radius: 6px; padding: 7px 12px; font-size: 13px; cursor: pointer; }
  .filters button.ghost { background: #2b3446; }
  #meta { color: #9aa4b6; font-size: 12px; margin-left: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #222b3b; vertical-align: top; }
  th { position: sticky; top: 0; background: #161d2b; color: #9aa4b6; }
  tr.err td { background: rgba(220,60,60,0.10); }
  tr:hover td { background: rgba(255,255,255,0.03); cursor: pointer; }
  .pill { padding: 1px 7px; border-radius: 999px; font-size: 11px; }
  .pill.success { background: #14361f; color: #7ee2a2; }
  .pill.error { background: #3a1620; color: #ff8ea3; }
  .mono { font-family: ui-monospace, Consolas, monospace; white-space: pre-wrap; word-break: break-word; max-width: 320px; }
  .muted { color: #9aa4b6; }
  #overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.55); align-items: center; justify-content: center; }
  #detail { background: #161d2b; border: 1px solid #2b3446; border-radius: 10px; width: min(900px, 92vw); max-height: 86vh; overflow: auto; padding: 18px; }
  #detail h3 { margin-top: 18px; font-size: 13px; color: #9aa4b6; border-bottom: 1px solid #2b3446; padding-bottom: 4px; }
  #detail pre { white-space: pre-wrap; word-break: break-word; font-size: 12px; background: #0f1420; padding: 8px; border-radius: 6px; }
  #detail .close { float: right; background: #2b3446; color: #fff; border: 0; border-radius: 6px; padding: 6px 10px; cursor: pointer; }
</style>
</head>
<body>
  <h1>API Logs Dashboard</h1>

  <div class="cards" id="cards"></div>

  <div class="charts">
    <div class="chart-box"><canvas id="chartHour"></canvas></div>
    <div class="chart-box"><canvas id="chartSuccessError"></canvas></div>
    <div class="chart-box"><canvas id="chartTrend"></canvas></div>
    <div class="chart-box"><canvas id="chartEndpoints"></canvas></div>
    <div class="chart-box"><canvas id="chartCategories"></canvas></div>
    <div class="chart-box"><canvas id="chartMethods"></canvas></div>
  </div>

  <h2>Logs</h2>
  <div class="filters">
    <input id="f-username" placeholder="user"/>
    <input id="f-endpoint" placeholder="endpoint"/>
    <select id="f-method">
      <option value="">method: all</option>
      <option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option>
    </select>
    <input id="f-statusCode" placeholder="status code" style="width:110px"/>
    <select id="f-success">
      <option value="">result: all</option>
      <option value="true">success</option>
      <option value="false">error</option>
    </select>
    <select id="f-errorCategory">
      <option value="">category: all</option>
      <option>VALIDATION_ERROR</option><option>AUTHENTICATION_ERROR</option><option>AUTHORIZATION_ERROR</option>
      <option>NOT_FOUND</option><option>BUSINESS_RULE_ERROR</option><option>DATABASE_ERROR</option>
      <option>EXTERNAL_SERVICE_ERROR</option><option>TIMEOUT</option><option>APPLICATION_ERROR</option><option>UNKNOWN_ERROR</option>
    </select>
    <input id="f-minDurationMs" placeholder="min ms" style="width:90px"/>
    <input id="f-since" type="datetime-local" title="since"/>
    <input id="f-until" type="datetime-local" title="until"/>
    <input id="f-limit" type="number" value="50" style="width:80px"/>
    <button onclick="load()">Apply</button>
    <button class="ghost" onclick="reset()">Reset</button>
    <span id="meta"></span>
  </div>

  <table>
    <thead><tr>
      <th>time</th><th>request id</th><th>user</th><th>method</th><th>endpoint</th>
      <th>status</th><th>ms</th><th>result</th><th>category</th>
    </tr></thead>
    <tbody id="rows"></tbody>
  </table>

  <div id="overlay"><div id="detail"></div></div>

<script>
  var base = location.pathname.replace(/\\/view$/, "");
  var FIELDS = ["username", "endpoint", "method", "statusCode", "success", "errorCategory", "minDurationMs", "since", "until", "limit"];
  var charts = {};

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function isoLocal(el) {
    var v = document.getElementById(el).value;
    return v ? new Date(v).toISOString() : "";
  }
  function qs() {
    var p = new URLSearchParams();
    FIELDS.forEach(function (k) {
      if (k === "since" || k === "until") {
        var v = isoLocal("f-" + k);
        if (v) p.set(k, v);
        return;
      }
      var el = document.getElementById("f-" + k);
      if (el && el.value !== "") p.set(k, el.value.trim());
    });
    return p.toString();
  }
  function card(label, value) {
    return "<div class='card'><div class='v'>" + esc(value) + "</div><div class='l'>" + esc(label) + "</div></div>";
  }
  function upsertChart(id, config) {
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(document.getElementById(id).getContext("2d"), config);
  }
  function loadStats() {
    fetch(base + "/statistics").then(function (r) { return r.json(); }).then(function (j) {
      var s = (j && j.result) ? j.result : j;
      document.getElementById("cards").innerHTML =
        card("Total Requests Today", s.totalRequestsToday) +
        card("Successful", s.successfulRequests) +
        card("Failed", s.failedRequests) +
        card("Avg Response Time (ms)", s.averageResponseTimeMs) +
        card("Slow Requests (>=1000ms)", s.slowRequests) +
        card("Active Users", s.activeUsers);

      upsertChart("chartHour", { type: "bar",
        data: { labels: s.requestsPerHour.map(function (r) { return r.hour.slice(11, 16); }),
          datasets: [{ label: "Requests/hour", data: s.requestsPerHour.map(function (r) { return r.count; }), backgroundColor: "#2d6cdf" }] },
        options: baseOpts("Requests per Hour") });

      upsertChart("chartSuccessError", { type: "doughnut",
        data: { labels: ["Success", "Error"], datasets: [{ data: [s.successVsErrors.success, s.successVsErrors.error], backgroundColor: ["#2fbf71", "#e5484d"] }] },
        options: baseOpts("Success vs Errors") });

      upsertChart("chartTrend", { type: "line",
        data: { labels: s.responseTimeTrend.map(function (r) { return r.timestamp.slice(11, 19); }),
          datasets: [{ label: "ms", data: s.responseTimeTrend.map(function (r) { return r.responseTimeMs; }), borderColor: "#f5a623", tension: 0.25, pointRadius: 0 }] },
        options: baseOpts("Response Time Trend") });

      upsertChart("chartEndpoints", { type: "bar",
        data: { labels: s.topEndpoints.map(function (r) { return r.endpoint; }),
          datasets: [{ label: "Requests", data: s.topEndpoints.map(function (r) { return r.count; }), backgroundColor: "#7c5cff" }] },
        options: Object.assign(baseOpts("Top Endpoints"), { indexAxis: "y" }) });

      upsertChart("chartCategories", { type: "pie",
        data: { labels: s.errorCategories.map(function (r) { return r.category; }),
          datasets: [{ data: s.errorCategories.map(function (r) { return r.count; }), backgroundColor: ["#e5484d","#f5a623","#2fbf71","#2d6cdf","#7c5cff","#ff6fa5","#20c997","#adb5bd"] }] },
        options: baseOpts("Error Categories") });

      upsertChart("chartMethods", { type: "bar",
        data: { labels: s.requestsByMethod.map(function (r) { return r.method; }),
          datasets: [{ label: "Requests", data: s.requestsByMethod.map(function (r) { return r.count; }), backgroundColor: "#20c997" }] },
        options: baseOpts("Requests by Method") });
    }).catch(function (err) { document.getElementById("cards").innerHTML = "<div class='muted'>stats load error: " + esc(err) + "</div>"; });
  }
  function baseOpts(title) {
    return { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, title: { display: true, text: title, color: "#9aa4b6", font: { size: 11 } } },
      scales: { x: { ticks: { color: "#9aa4b6", font: { size: 9 } }, grid: { color: "#222b3b" } },
                y: { ticks: { color: "#9aa4b6", font: { size: 9 } }, grid: { color: "#222b3b" } } } };
  }

  function row(e) {
    return "<tr class='" + (e.success ? "" : "err") + "' onclick='showDetail(" + e.id + ")'>"
      + "<td class='muted'>" + esc((e.timestamp || "").replace("T", " ").replace("Z", "")) + "</td>"
      + "<td class='muted mono'>" + esc(e.requestId) + "</td>"
      + "<td>" + esc(e.username || "-") + "</td>"
      + "<td>" + esc(e.method) + "</td>"
      + "<td class='mono'>" + esc(e.routeTemplate || e.endpoint) + "</td>"
      + "<td>" + esc(e.statusCode) + "</td>"
      + "<td>" + esc(e.responseTimeMs) + "</td>"
      + "<td><span class='pill " + (e.success ? "success" : "error") + "'>" + (e.success ? "success" : "error") + "</span></td>"
      + "<td>" + esc(e.errorCategory || "") + "</td>"
      + "</tr>";
  }
  function load() {
    fetch(base + "?" + qs()).then(function (r) { return r.json(); }).then(function (j) {
      var d = (j && j.result) ? j.result : j;
      var items = d.items || [];
      document.getElementById("meta").textContent = "showing " + items.length + " of " + d.total + " matched";
      document.getElementById("rows").innerHTML = items.map(row).join("") || "<tr><td colspan='9' class='muted'>no matching logs</td></tr>";
      window.__logs = items;
    }).catch(function (err) { document.getElementById("meta").textContent = "load error: " + err; });
  }
  function reset() {
    FIELDS.forEach(function (k) { var el = document.getElementById("f-" + k); if (el) el.value = k === "limit" ? "50" : ""; });
    load();
  }
  function field(label, value) {
    return "<div><b>" + esc(label) + ":</b> " + esc(value == null ? "-" : value) + "</div>";
  }
  function block(title, value) {
    if (value === undefined) return "";
    var text; try { text = typeof value === "string" ? value : JSON.stringify(value, null, 2); } catch (e) { text = String(value); }
    return "<h3>" + esc(title) + "</h3><pre>" + esc(text) + "</pre>";
  }
  function showDetail(id) {
    fetch(base + "/" + id).then(function (r) { return r.json(); }).then(function (j) {
      var e = (j && j.result) ? j.result : j;
      var html = "<button class='close' onclick='closeDetail()'>Close</button>"
        + "<h3>General</h3>"
        + field("Request ID", e.requestId) + field("Timestamp", e.timestamp) + field("Module / Action", (e.module || "-") + " / " + (e.action || "-"))
        + field("User", (e.username || "-") + " (" + (e.userId || "-") + ")") + field("IP", e.ip) + field("User-Agent", e.userAgent)
        + field("Environment", e.environment)
        + "<h3>Request</h3>"
        + field("Method / Endpoint", e.method + " " + e.endpoint) + field("Route template", e.routeTemplate)
        + block("Route Parameters", e.routeParams) + block("Query Parameters", e.queryParams) + block("Request Body (masked)", e.requestBody)
        + "<h3>Result</h3>"
        + field("Status Code", e.statusCode) + field("Duration (ms)", e.responseTimeMs) + field("Result", e.success ? "success" : "error")
        + block("Response Summary", e.responseSummary)
        + (e.success ? "" : ("<h3>Error</h3>"
            + field("Category", e.errorCategory) + field("Client message", e.errorMessage)
            + field("Original message (internal)", e.originalErrorMessage) + field("ORA code", e.oraCode)
            + field("File / Function", (e.fileName || "-") + " / " + (e.functionName || "-"))
            + block("Validation Errors", e.validationErrors)
            + block("Stack Trace", e.stackTrace)));
      document.getElementById("detail").innerHTML = html;
      document.getElementById("overlay").style.display = "flex";
    });
  }
  function closeDetail() { document.getElementById("overlay").style.display = "none"; }
  document.getElementById("overlay").addEventListener("click", function (ev) { if (ev.target.id === "overlay") closeDetail(); });
  document.addEventListener("keydown", function (ev) { if (ev.key === "Enter") load(); if (ev.key === "Escape") closeDetail(); });

  loadStats();
  load();
</script>
</body>
</html>`;
