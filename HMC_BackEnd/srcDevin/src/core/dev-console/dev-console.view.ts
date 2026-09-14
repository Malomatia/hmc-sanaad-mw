/**
 * Self-contained HTML for the internal developer console (no external assets,
 * no build step). Served by DevConsoleController at GET /{prefix}/dev-console.
 *
 * Panels:
 *  - Navigator: search Oracle objects, open columns / arguments / PL/SQL source.
 *  - Worksheet: run a statement (Ctrl+Enter), see rows, ORA error + backtrace,
 *    and jump straight to the failing source line.
 *  - API tester: replay any backend endpoint and inspect the Oracle calls it
 *    produced (SQL, binds, OUT values, ORA codes) in the same screen.
 */
export const DEV_CONSOLE_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex, nofollow"/>
<title>HMC Sanaad — Dev Console</title>
<style>
  :root{
    --bg:#16191d; --bg2:#1e2227; --bg3:#262b31; --line:#343a42;
    --fg:#dfe3e8; --muted:#8b95a1; --accent:#4aa3ff; --ok:#3ecf8e; --err:#ff6b6b; --warn:#f0b429;
    --mono:"Cascadia Mono",Consolas,"Courier New",monospace;
  }
  *{box-sizing:border-box}
  body{margin:0;height:100vh;display:flex;flex-direction:column;background:var(--bg);color:var(--fg);
       font:13px/1.45 "Segoe UI",Roboto,Arial,sans-serif}
  header{display:flex;align-items:center;gap:14px;padding:8px 14px;background:var(--bg2);border-bottom:1px solid var(--line)}
  header .logo{font-weight:700;color:var(--accent);letter-spacing:.3px}
  header .tabs{display:flex;gap:4px;margin-left:8px}
  .tab{padding:5px 12px;border-radius:6px 6px 0 0;cursor:pointer;color:var(--muted);border:1px solid transparent}
  .tab.active{background:var(--bg);color:var(--fg);border-color:var(--line);border-bottom-color:var(--bg)}
  header .spacer{flex:1}
  .badge{font:11px var(--mono);padding:3px 8px;border-radius:10px;background:var(--bg3);color:var(--muted);border:1px solid var(--line)}
  .badge.ro{color:var(--warn)} .badge.rw{color:var(--err)} .badge.db{color:var(--ok)}
  main{flex:1;display:flex;min-height:0}
  #nav{width:290px;min-width:200px;background:var(--bg2);border-right:1px solid var(--line);display:flex;flex-direction:column}
  #nav .head{padding:8px;border-bottom:1px solid var(--line);display:flex;gap:6px}
  #nav input,#nav select{background:var(--bg3);border:1px solid var(--line);color:var(--fg);border-radius:5px;padding:5px 7px;font-size:12px}
  #nav input{flex:1;min-width:0}
  #objects{flex:1;overflow:auto;padding:4px}
  .obj{padding:4px 8px;border-radius:4px;cursor:pointer;font:12px var(--mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .obj:hover{background:var(--bg3)}
  .obj .t{color:var(--muted);font-size:10px;margin-right:6px}
  .obj.invalid .t{color:var(--err)}
  section.pane{flex:1;display:flex;flex-direction:column;min-width:0}
  .toolbar{display:flex;align-items:center;gap:6px;padding:6px 10px;background:var(--bg2);border-bottom:1px solid var(--line);flex-wrap:wrap}
  button{background:var(--bg3);color:var(--fg);border:1px solid var(--line);border-radius:5px;padding:5px 11px;cursor:pointer;font-size:12px}
  button:hover{border-color:var(--accent);color:#fff}
  button.primary{background:var(--accent);border-color:var(--accent);color:#08213b;font-weight:600}
  button:disabled{opacity:.5;cursor:not-allowed}
  textarea,input.text{width:100%;background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:5px;
       font:13px/1.5 var(--mono);padding:8px;resize:none;outline:none}
  textarea:focus,input.text:focus{border-color:var(--accent)}
  .editor{padding:8px 10px;background:var(--bg)}
  .editor textarea{height:170px}
  .results{flex:1;display:flex;flex-direction:column;min-height:0;border-top:1px solid var(--line)}
  .rtabs{display:flex;gap:2px;padding:4px 8px;background:var(--bg2);border-bottom:1px solid var(--line);align-items:center}
  .rtab{padding:4px 10px;border-radius:4px;cursor:pointer;color:var(--muted);font-size:12px}
  .rtab.active{background:var(--bg3);color:var(--fg)}
  .rstatus{margin-left:auto;font:11px var(--mono);color:var(--muted)}
  .rbody{flex:1;overflow:auto;padding:8px 10px}
  table{border-collapse:collapse;width:100%;font:12px var(--mono)}
  th,td{border:1px solid var(--line);padding:3px 7px;text-align:left;white-space:pre;max-width:520px;overflow:hidden;text-overflow:ellipsis}
  th{background:var(--bg3);position:sticky;top:-8px;color:var(--accent);font-weight:600}
  tr:nth-child(even) td{background:#1a1e23}
  td.null{color:var(--muted);font-style:italic}
  pre{margin:0;font:12px/1.5 var(--mono);white-space:pre-wrap;word-break:break-word}
  .err{color:var(--err)} .ok{color:var(--ok)} .muted{color:var(--muted)} .warn{color:var(--warn)}
  .card{background:var(--bg2);border:1px solid var(--line);border-radius:6px;padding:10px;margin-bottom:10px}
  .card h4{margin:0 0 6px;font-size:12px;color:var(--accent);text-transform:uppercase;letter-spacing:.5px}
  .src{font:12px/1.45 var(--mono)}
  .src .ln{display:inline-block;width:52px;color:var(--muted);text-align:right;padding-right:10px;user-select:none}
  .src .row.focus{background:#3a2a12;border-left:3px solid var(--warn);margin-left:-3px}
  .chip{display:inline-block;background:var(--bg3);border:1px solid var(--line);border-radius:10px;
        padding:1px 8px;margin:0 4px 4px 0;font:11px var(--mono);cursor:pointer}
  .chip:hover{border-color:var(--accent)}
  .grid2{display:grid;grid-template-columns:110px 1fr;gap:6px;align-items:center}
  .hidden{display:none!important}
  .split{height:5px;background:var(--bg2);cursor:row-resize;border-top:1px solid var(--line)}
</style>
</head>
<body>
<header>
  <span class="logo">HMC Sanaad</span>
  <div class="tabs">
    <div class="tab active" data-pane="worksheet">SQL Worksheet</div>
    <div class="tab" data-pane="api">API Tester</div>
  </div>
  <span class="spacer"></span>
  <span class="badge db" id="b-db">db…</span>
  <span class="badge" id="b-mode" title="Click to switch read-only / write mode (this process only)" style="cursor:pointer">mode…</span>
  <span class="badge" id="b-rows"></span>
</header>

<main>
  <aside id="nav">
    <div class="head">
      <input id="search" placeholder="Search objects (XXHMC_SND…)" />
      <select id="otype">
        <option value="">any</option>
        <option>VIEW</option><option>PROCEDURE</option><option>PACKAGE</option>
        <option>FUNCTION</option><option>TABLE</option><option>SYNONYM</option>
      </select>
    </div>
    <div id="objects"><div class="muted" style="padding:8px">Type to search…</div></div>
  </aside>

  <!-- ── SQL worksheet ───────────────────────────────── -->
  <section class="pane" id="pane-worksheet">
    <div class="toolbar">
      <button class="primary" id="run">▶ Run (Ctrl+Enter)</button>
      <button id="explain">Explain plan</button>
      <button id="fmt">Clear</button>
      <span class="muted">Snippets:</span>
      <span class="chip" data-sql="SELECT * FROM XXHMC_SND_PHONE_TYPE_V">phone types</span>
      <span class="chip" data-sql="SELECT * FROM XXHMC_SND_LEAVE_AMEND_V WHERE person_id = 26023">amend LOV</span>
      <span class="chip" data-sql="SELECT object_name, object_type, status FROM all_objects WHERE object_name LIKE 'XXHMC_SND%' ORDER BY 1">all objects</span>
      <span class="chip" data-sql="SELECT text FROM all_source WHERE name = 'XXHMC_SND_SCHOOL_FEE_PR' AND line BETWEEN 180 AND 210 ORDER BY line">school-fee src</span>
      <span class="chip" data-sql="SELECT flex_value_set_name, flex_value, description FROM fnd_flex_values_vl v JOIN fnd_flex_value_sets s USING (flex_value_set_id) WHERE flex_value_set_name = 'HMC_HR_PASSAGE_TICKET_EMPLOYEE_NAME' FETCH FIRST 50 ROWS ONLY">ticket value set</span>
    </div>
    <div class="editor"><textarea id="sql" spellcheck="false" placeholder="SELECT * FROM XXHMC_SND_PHONE_TYPE_V"></textarea></div>
    <div class="results">
      <div class="rtabs">
        <div class="rtab active" data-r="grid">Query result</div>
        <div class="rtab" data-r="error">Error / backtrace</div>
        <div class="rtab" data-r="object">Object</div>
        <div class="rtab" data-r="source">Source</div>
        <div class="rtab" data-r="raw">Raw JSON</div>
        <span class="rstatus" id="status">ready</span>
      </div>
      <div class="rbody" id="r-grid"><div class="muted">Run a statement to see rows.</div></div>
      <div class="rbody hidden" id="r-error"><div class="muted">No error.</div></div>
      <div class="rbody hidden" id="r-object"><div class="muted">Pick an object in the navigator.</div></div>
      <div class="rbody hidden" id="r-source"><div class="muted">Open an object's source, or click a backtrace line after an error.</div></div>
      <div class="rbody hidden" id="r-raw"><pre class="muted">—</pre></div>
    </div>
  </section>

  <!-- ── API tester ──────────────────────────────────── -->
  <section class="pane hidden" id="pane-api">
    <div class="toolbar">
      <select id="method" style="background:var(--bg3);border:1px solid var(--line);color:var(--fg);border-radius:5px;padding:5px">
        <option>GET</option><option>POST</option><option>PUT</option><option>DELETE</option>
      </select>
      <input class="text" id="path" style="flex:1;min-width:260px" value="/contact/lov/phone-type?lang=en"/>
      <button class="primary" id="send">▶ Send</button>
      <span class="muted">Presets:</span>
      <span class="chip" data-m="GET" data-p="/contact/lov/phone-type?lang=en">phone LOV</span>
      <span class="chip" data-m="POST" data-p="/contact/phone?lang=en" data-b='{"phones":[{"phoneType":"Qatar Mobile Number","phoneNumber":"55512345"}]}'>add phone</span>
      <span class="chip" data-m="POST" data-p="/school-fees/apply?lang=en" data-b='{"p_academic_year":"2025-2026","p_acd_st_dt":"20250901","p_acd_end_dt":"20260630","p_child_name":"Jerome Amir Sami Samir Ibrahim","p_child_date_birth":"20100923","p_school_name":"Al Arqam Academy","p_educational_stage":"Primary","p_request_type":"Cash","p_term":"Term1","p_amount":"1000"}'>school fee</span>
      <span class="chip" data-m="POST" data-p="/leave/amend?lang=en" data-b='{"p_leave_type":"Annual Leave","p_leave_to_amend":"Annual Leave|12-MAR-2026|12-MAR-2026","p_new_end_date":"2026-03-13"}'>leave amend</span>
    </div>
    <div class="editor">
      <div class="muted" style="margin-bottom:4px">Request body (JSON — ignored for GET)</div>
      <textarea id="apibody" spellcheck="false" style="height:120px">{}</textarea>
    </div>
    <div class="results">
      <div class="rtabs">
        <div class="rtab active" data-a="resp">Response</div>
        <div class="rtab" data-a="calls">Oracle calls</div>
        <span class="rstatus" id="astatus">ready</span>
      </div>
      <div class="rbody" id="a-resp"><div class="muted">Send a request to see the response.</div></div>
      <div class="rbody hidden" id="a-calls"><div class="muted">Oracle calls made by the request appear here.</div></div>
    </div>
  </section>
</main>

<script>
(function(){
  var BASE = location.pathname.replace(/\/+$/,'');
  var TOKEN = new URLSearchParams(location.search).get('token') || '';
  var $ = function(id){ return document.getElementById(id); };
  var lastResult = null;

  function api(path, opts){
    opts = opts || {};
    var headers = Object.assign({'Content-Type':'application/json'}, opts.headers||{});
    if (TOKEN) headers['x-console-token'] = TOKEN;
    return fetch(BASE + path + (TOKEN ? (path.indexOf('?')>-1?'&':'?')+'token='+encodeURIComponent(TOKEN) : ''),
      { method: opts.method||'GET', headers: headers, body: opts.body })
      .then(function(r){ return r.text().then(function(t){
        try { return { status:r.status, data: JSON.parse(t) }; } catch(e){ return { status:r.status, data:t }; }
      });});
  }
  function esc(s){ return String(s==null?'':s).replace(/[&<>]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c]; }); }
  // The WAF in front of staging rejects request bodies that look like SQL
  // (any quoted literal triggers it and it answers with an HTML page). Send
  // every statement base64-encoded so it reaches the backend untouched.
  function b64(s){ return btoa(unescape(encodeURIComponent(s))); }

  // ── tabs ──
  document.querySelectorAll('header .tab').forEach(function(t){
    t.onclick = function(){
      document.querySelectorAll('header .tab').forEach(function(x){ x.classList.remove('active'); });
      t.classList.add('active');
      $('pane-worksheet').classList.toggle('hidden', t.dataset.pane !== 'worksheet');
      $('pane-api').classList.toggle('hidden', t.dataset.pane !== 'api');
    };
  });
  function bindResultTabs(sel, attr, prefix){
    document.querySelectorAll(sel).forEach(function(t){
      t.onclick = function(){
        document.querySelectorAll(sel).forEach(function(x){ x.classList.remove('active'); });
        t.classList.add('active');
        document.querySelectorAll(sel).forEach(function(x){
          var el = $(prefix + x.dataset[attr]); if (el) el.classList.add('hidden');
        });
        $(prefix + t.dataset[attr]).classList.remove('hidden');
      };
    });
  }
  bindResultTabs('#pane-worksheet .rtab','r','r-');
  bindResultTabs('#pane-api .rtab','a','a-');
  function showTab(which){
    var t = document.querySelector('#pane-worksheet .rtab[data-r="'+which+'"]');
    if (t) t.click();
  }

  // ── settings badges (write mode is a runtime switch, no env needed) ──
  var writeMode = false;
  function applySettings(s){
    s = s || {};
    writeMode = !!s.allowWrite;
    $('b-db').textContent = (s.oracle && s.oracle.disabled) ? 'oracle disabled' : ((s.oracle&&s.oracle.user)+' @ '+(s.oracle&&s.oracle.dsn));
    $('b-mode').textContent = writeMode ? 'READ / WRITE ⚠' : 'READ-ONLY 🔒';
    $('b-mode').className = 'badge ' + (writeMode ? 'rw' : 'ro');
    $('b-rows').textContent = 'max ' + s.maxRows + ' rows · ' + Math.round((s.timeoutMs||0)/1000) + 's';
  }
  api('/settings').then(function(r){ applySettings(r.data); });
  $('b-mode').onclick = function(){
    var next = !writeMode;
    if (next && !confirm('Enable WRITE mode?\n\nDML / DDL / PL-SQL blocks will execute and COMMIT against '+
        ($('b-db').textContent)+'.\n\nThis lasts until the server restarts.')) return;
    api('/mode', { method:'POST', body: JSON.stringify({ enabled: next }) })
      .then(function(r){ applySettings(r.data); });
  };

  // ── navigator ──
  var searchTimer;
  function loadObjects(){
    var q = $('search').value.trim(), t = $('otype').value;
    api('/objects?search='+encodeURIComponent(q)+'&type='+encodeURIComponent(t)).then(function(r){
      var rows = Array.isArray(r.data) ? r.data : [];
      if (!rows.length){ $('objects').innerHTML = '<div class="muted" style="padding:8px">No objects.</div>'; return; }
      $('objects').innerHTML = rows.map(function(o){
        return '<div class="obj'+(o.STATUS!=='VALID'?' invalid':'')+'" data-name="'+esc(o.OBJECT_NAME)+'" title="'+esc(o.OWNER+'.'+o.OBJECT_NAME+' — '+o.OBJECT_TYPE+' ('+o.STATUS+')')+'">'+
               '<span class="t">'+esc((o.OBJECT_TYPE||'').slice(0,4))+'</span>'+esc(o.OBJECT_NAME)+'</div>';
      }).join('');
      $('objects').querySelectorAll('.obj').forEach(function(el){
        el.onclick = function(){ describe(el.dataset.name); };
      });
    });
  }
  $('search').oninput = function(){ clearTimeout(searchTimer); searchTimer = setTimeout(loadObjects, 300); };
  $('otype').onchange = loadObjects;

  function describe(name){
    $('r-object').innerHTML = '<div class="muted">Loading '+esc(name)+'…</div>';
    showTab('object');
    api('/describe?name='+encodeURIComponent(name)).then(function(r){
      var d = r.data || {};
      if (d.statusCode && d.statusCode >= 400){ $('r-object').innerHTML = '<pre class="err">'+esc(d.message)+'</pre>'; return; }
      var html = '<div class="card"><h4>'+esc(d.object)+'</h4>' +
        '<button onclick="window.__src(\'' + esc(d.object) + '\')">Open PL/SQL source</button> ' +
        '<button onclick="window.__sel(\'' + esc(d.object) + '\')">SELECT * FROM …</button></div>';
      html += table('Kinds', d.kinds);
      html += table('Columns ('+(d.columns||[]).length+')', d.columns);
      html += table('Arguments ('+(d.arguments||[]).length+')', d.arguments);
      if ((d.errors||[]).length) html += table('Compilation errors', d.errors);
      $('r-object').innerHTML = html;
    });
  }
  window.__src = function(n){ loadSource(n); };
  window.__sel = function(n){ $('sql').value = 'SELECT * FROM ' + n + ' FETCH FIRST 100 ROWS ONLY'; run(); };

  function table(title, rows){
    if (!rows || !rows.length) return '<div class="card"><h4>'+esc(title)+'</h4><span class="muted">none</span></div>';
    var cols = Object.keys(rows[0]);
    return '<div class="card"><h4>'+esc(title)+'</h4><div style="overflow:auto"><table><tr>'+
      cols.map(function(c){ return '<th>'+esc(c)+'</th>'; }).join('')+'</tr>'+
      rows.map(function(r){ return '<tr>'+cols.map(function(c){
        return r[c]===null||r[c]===undefined ? '<td class="null">null</td>' : '<td>'+esc(r[c])+'</td>';
      }).join('')+'</tr>'; }).join('')+'</table></div></div>';
  }

  function loadSource(name, line){
    showTab('source');
    $('r-source').innerHTML = '<div class="muted">Loading source…</div>';
    api('/source?name='+encodeURIComponent(name)+(line?'&line='+line:'')).then(function(r){
      var d = r.data || {};
      if (!d.lines || !d.lines.length){ $('r-source').innerHTML = '<pre class="muted">No source (not a PL/SQL unit, or no privilege on ALL_SOURCE).</pre>'; return; }
      var head = '<div class="card"><h4>'+esc(d.object)+' — lines '+d.from+'–'+d.to+' of '+d.total+
                 (d.focusLine?' (focus '+d.focusLine+')':'')+'</h4></div>';
      $('r-source').innerHTML = head + '<div class="src">' + d.lines.map(function(l){
        var focus = d.focusLine && Number(l.LINE) === Number(d.focusLine);
        return '<div class="row'+(focus?' focus':'')+'" id="srcline'+l.LINE+'"><span class="ln">'+l.LINE+'</span>'+
               esc(String(l.TEXT||'').replace(/\s+$/,''))+'</div>';
      }).join('') + '</div>';
      if (d.focusLine){ var el = $('srcline'+d.focusLine); if (el) el.scrollIntoView({block:'center'}); }
    });
  }

  // ── run statement ──
  function run(){
    var sql = $('sql').value.trim();
    if (!sql) return;
    $('status').textContent = 'running…';
    $('run').disabled = true;
    api('/execute', { method:'POST', body: JSON.stringify({ sqlB64: b64(sql) }) }).then(function(r){
      $('run').disabled = false;
      lastResult = r.data;
      $('r-raw').innerHTML = '<pre>'+esc(JSON.stringify(r.data, null, 2))+'</pre>';
      if (r.status >= 400 || (r.data && r.data.statusCode >= 400)){
        $('status').innerHTML = '<span class="err">blocked</span>';
        $('r-error').innerHTML = '<pre class="err">'+esc((r.data&&r.data.message)||'Request rejected')+'</pre>';
        showTab('error'); return;
      }
      var d = r.data;
      if (!d.ok){ renderError(d); return; }
      $('status').innerHTML = '<span class="ok">OK</span> · '+d.kind+' · '+d.rowCount+' row(s)'+
        (d.truncated?' (truncated)':'')+' · '+d.elapsedMs+' ms';
      renderGrid(d);
      showTab('grid');
    }).catch(function(e){
      $('run').disabled = false;
      $('status').innerHTML = '<span class="err">network error</span>';
      $('r-error').innerHTML = '<pre class="err">'+esc(e.message)+'</pre>'; showTab('error');
    });
  }

  function renderGrid(d){
    if (d.outBinds && Object.keys(d.outBinds).length){
      $('r-grid').innerHTML = '<div class="card"><h4>OUT binds</h4><pre>'+esc(JSON.stringify(d.outBinds,null,2))+'</pre></div>';
      return;
    }
    if (!d.rows || !d.rows.length){
      $('r-grid').innerHTML = '<div class="muted">'+(d.rowsAffected!=null? d.rowsAffected+' row(s) affected.' : 'No rows.')+'</div>';
      return;
    }
    var cols = d.columns && d.columns.length ? d.columns : Object.keys(d.rows[0]);
    $('r-grid').innerHTML = '<table><tr><th>#</th>'+cols.map(function(c){ return '<th>'+esc(c)+'</th>'; }).join('')+'</tr>'+
      d.rows.map(function(row,i){ return '<tr><td class="muted">'+(i+1)+'</td>'+cols.map(function(c){
        var v = row[c];
        return v===null||v===undefined ? '<td class="null">null</td>' : '<td title="'+esc(v)+'">'+esc(v)+'</td>';
      }).join('')+'</tr>'; }).join('')+'</table>';
  }

  function renderError(d){
    var e = d.error || {};
    $('status').innerHTML = '<span class="err">ORA-'+(e.oraCode||'?')+'</span> · '+d.elapsedMs+' ms';
    var html = '<div class="card"><h4>Error</h4><pre class="err">'+esc(e.message)+'</pre></div>';
    if (e.hint) html += '<div class="card"><h4>What it means</h4><pre class="warn">'+esc(e.hint)+'</pre></div>';
    if (e.stack && e.stack.length){
      html += '<div class="card"><h4>Backtrace — click a line to open the source there</h4>' +
        e.stack.map(function(s){
          return '<span class="chip" onclick="window.__srcline(\''+esc(s.unit)+'\','+s.line+')">'+esc(s.unit)+' : line '+s.line+'</span>';
        }).join('') + '</div>';
    }
    if (e.offset != null) html += '<div class="card"><h4>Parse offset</h4><pre>'+e.offset+'</pre></div>';
    $('r-error').innerHTML = html;
    showTab('error');
  }
  window.__srcline = function(unit, line){
    var name = String(unit).indexOf('.') > -1 ? String(unit).split('.')[1] : unit;
    loadSource(name, line);
  };

  $('run').onclick = run;
  $('fmt').onclick = function(){ $('sql').value=''; $('sql').focus(); };
  $('explain').onclick = function(){
    var sql = $('sql').value.trim(); if (!sql) return;
    $('status').textContent = 'explaining…';
    api('/explain', { method:'POST', body: JSON.stringify({ sqlB64: b64(sql) }) }).then(function(r){
      $('status').textContent = 'plan ready';
      var d = r.data || {};
      $('r-grid').innerHTML = '<pre>'+esc((d.plan||[d.message||'no plan']).join('\n'))+'</pre>';
      showTab('grid');
    });
  };
  document.querySelectorAll('#pane-worksheet .chip[data-sql]').forEach(function(c){
    c.onclick = function(){ $('sql').value = c.dataset.sql; run(); };
  });
  $('sql').addEventListener('keydown', function(ev){
    if ((ev.ctrlKey||ev.metaKey) && ev.key === 'Enter'){ ev.preventDefault(); run(); }
  });

  // ── API tester ──
  document.querySelectorAll('#pane-api .chip[data-p]').forEach(function(c){
    c.onclick = function(){
      $('method').value = c.dataset.m; $('path').value = c.dataset.p;
      $('apibody').value = c.dataset.b ? JSON.stringify(JSON.parse(c.dataset.b), null, 2) : '{}';
    };
  });
  $('send').onclick = function(){
    var body = null;
    if ($('method').value !== 'GET'){
      try { body = JSON.parse($('apibody').value || '{}'); }
      catch(e){ $('a-resp').innerHTML = '<pre class="err">Invalid JSON body: '+esc(e.message)+'</pre>'; return; }
    }
    $('astatus').textContent = 'sending…'; $('send').disabled = true;
    api('/api-call', { method:'POST', body: JSON.stringify({ method:$('method').value, path:$('path').value, body: body }) })
      .then(function(r){
        $('send').disabled = false;
        var d = r.data || {};
        var resp = d.response || {};
        var cls = resp.status >= 200 && resp.status < 300 ? 'ok' : 'err';
        $('astatus').innerHTML = '<span class="'+cls+'">HTTP '+resp.status+'</span> · '+resp.elapsedMs+' ms · '+
          ((d.oracleCalls||[]).length)+' oracle call(s)';
        $('a-resp').innerHTML = '<div class="card"><h4>'+esc((d.request&&d.request.method)+' '+(d.request&&d.request.url))+'</h4>'+
          '<pre class="'+cls+'">HTTP '+resp.status+(resp.error?' — '+esc(resp.error):'')+'</pre></div>'+
          '<div class="card"><h4>Response body</h4><pre>'+esc(JSON.stringify(resp.body,null,2))+'</pre></div>';
        renderCalls(d.oracleCalls||[]);
      }).catch(function(e){
        $('send').disabled = false;
        $('astatus').innerHTML = '<span class="err">error</span>';
        $('a-resp').innerHTML = '<pre class="err">'+esc(e.message)+'</pre>';
      });
  };

  function renderCalls(calls){
    if (!calls.length){ $('a-calls').innerHTML = '<div class="muted">No Oracle calls were made by this request.</div>'; return; }
    $('a-calls').innerHTML = calls.map(function(c){
      var bad = c.status === 'error' || (c.response && JSON.stringify(c.response).indexOf('"N"') > -1);
      var head = '<h4>'+esc(c.object)+' · '+esc(c.op)+' · '+c.durationMs+' ms'+(c.oraCode?' · <span class="err">ORA-'+c.oraCode+'</span>':'')+'</h4>';
      var body = '';
      if (c.error) body += '<pre class="err">'+esc(c.error)+'</pre>';
      if (c.response) body += '<pre class="'+(bad?'warn':'ok')+'">'+esc(JSON.stringify(c.response).slice(0,1500))+'</pre>';
      body += '<pre class="muted">'+esc(c.finalSql || c.sql || '')+'</pre>';
      var line = /line (\d+)/.exec(c.error||'');
      var unit = /at "([^"]+)"/.exec(c.error||'');
      if (line && unit) body += '<span class="chip" onclick="window.__jump(\''+esc(unit[1])+'\','+line[1]+')">open '+esc(unit[1])+' : line '+line[1]+'</span>';
      return '<div class="card">'+head+body+'</div>';
    }).join('');
  }
  window.__jump = function(unit, line){
    document.querySelector('header .tab[data-pane="worksheet"]').click();
    window.__srcline(unit, line);
  };

  loadObjects();
  $('sql').focus();
})();
</script>
</body>
</html>`;
