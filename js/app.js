/* mailprompt app: state, layout, saved views, and wiring. */
(function (MP) {
  'use strict';

  var STORE = 'mailprompt.v1';
  var KEYSTORE = 'mailprompt.claude';
  var cat = MP.tiles.catalog;
  var esc = MP.tiles.esc;
  function $(s) { return document.querySelector(s); }

  var state = { tiles: [], views: {}, current: null, logSource: null, theme: null, activeTpl: null };
  var settings = { apiKey: '', model: 'claude-haiku-5-5', reviewModel: 'claude-sonnet-5-5' };
  var data = null;
  var dnsResults = {};
  var emls = {}, lastEml = null, emlSeq = 0;
  var aiResults = {};
  var klState = null;
  var history = [], hIdx = 0, seq = 0, cmdSeq = 0;
  var SIZES = ['S', 'M', 'L'];
  var SIZE_NAME = { S: 'small', M: 'medium', L: 'large' };
  var DEMO_TILES = [{ type: 'summary', size: 'M' }, { type: 'deferrals', size: 'M' }, { type: 'providers', size: 'L' }];

  var ICON = {
    grip: '<svg viewBox="0 0 24 24" style="fill:currentColor;stroke:none"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>',
    resize: '<svg viewBox="0 0 24 24"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>',
    copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>'
  };

  // ---------- Persistence (best effort) ----------
  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(STORE) || 'null');
      if (s) {
        state.tiles = Array.isArray(s.tiles) ? s.tiles.filter(function (t) { return t && cat[t.type]; }) : [];
        state.views = s.views && typeof s.views === 'object' ? s.views : {};
        state.current = s.current || null;
        state.logSource = s.logSource || null;
        state.theme = s.theme || null;
        state.activeTpl = s.activeTpl || null;
      }
    } catch (e) { /* storage unavailable: start fresh */ }
    try { Object.assign(settings, JSON.parse(localStorage.getItem(KEYSTORE) || '{}')); } catch (e) {}
  }
  function save() {
    try {
      localStorage.setItem(STORE, JSON.stringify({ tiles: state.tiles, views: state.views, current: state.current, logSource: state.logSource, theme: state.theme, activeTpl: state.activeTpl }));
    } catch (e) {}
  }
  function saveSettings() { try { localStorage.setItem(KEYSTORE, JSON.stringify(settings)); } catch (e) {} }

  // ---------- Data ----------
  function loadDemo() {
    data = MP.logs.fromDemo();
    state.logSource = 'demo';
  }

  // ---------- Templates and messages ----------
  function addTemplate(html, name, source, meta) {
    var t = MP.templates.add({ name: name || MP.templates.nameFrom(html, 'Pasted email'), html: html, source: source || 'paste', meta: meta });
    state.activeTpl = t.id;
    return t;
  }

  function qaTiles(t) {
    var p = { tpl: t.id };
    return [
      { type: 'tpl-summary', params: p, size: 'M' }, { type: 'tpl-preview', params: p, size: 'M' },
      { type: 'tpl-links', params: p, size: 'L' }, { type: 'tpl-images', params: p, size: 'S' },
      { type: 'tpl-merge', params: p, size: 'S' }, { type: 'tpl-outlook', params: p, size: 'M' }
    ];
  }

  function showTemplate(t, how) {
    var fresh = prepend(qaTiles(t));
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    var out = output(fresh[0]);
    say((how ? how + ' ' : '') + (out.say || t.name), out.status === 'fail' ? 'fail' : out.status === 'warn' ? 'warn' : null);
    save();
  }

  function loadEml(text, name) {
    var e = MP.eml.parse(text);
    var id = 'eml' + (++emlSeq);
    if (e.html) {
      var t = addTemplate(e.html, e.subject || MP.templates.cleanName(name), 'eml', { from: e.from.domain });
      e.tplName = t.name;
    }
    emls[id] = e; lastEml = id;
    var specs = [{ type: 'eml-headers', params: { eml: id }, size: 'L' }];
    if (e.tplName) specs.push({ type: 'tpl-summary', params: { tpl: state.activeTpl }, size: 'M' }, { type: 'tpl-preview', params: { tpl: state.activeTpl }, size: 'M' });
    var fresh = prepend(specs);
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    var out = output(fresh[0]);
    say('Loaded ' + name + '. ' + (out.say || ''), out.status === 'fail' ? 'fail' : out.status === 'warn' ? 'warn' : null);
    save();
  }

  function ensureAi(t) {
    var key = t.id + ':' + t.updated;
    if (!settings.apiKey) return { nokey: true };
    var a = aiResults[key];
    if (a) return a;
    a = aiResults[key] = { pending: true };
    MP.ai.review(t, MP.qa.forTemplate(t), settings).then(function (r) {
      a.pending = false; a.value = r;
      rerenderWhere(function (x) { return x.type === 'ai-review' && x.params.tpl === t.id; });
      var out = output(state.tiles.filter(function (x) { return x.type === 'ai-review' && x.params.tpl === t.id; })[0] || { type: 'ai-review', params: { tpl: t.id } });
      if (out.say) say(out.say, out.status === 'fail' ? 'fail' : out.status === 'warn' ? 'warn' : null);
    }, function (e) {
      a.pending = false; a.error = e;
      rerenderWhere(function (x) { return x.type === 'ai-review' && x.params.tpl === t.id; });
      say('AI review failed: ' + e.message, 'fail');
    });
    return a;
  }

  function ensureKlaviyo(force) {
    if (!MP.klaviyo.paired()) return null;
    if (klState && !force) return klState;
    var k = klState = { pending: true };
    MP.klaviyo.list().then(function (list) {
      k.pending = false; k.value = list;
      rerenderWhere(function (x) { return x.type === 'klaviyo'; });
      say(list.length ? 'Found ' + list.length + ' Klaviyo template' + (list.length > 1 ? 's' : '') + '. Import one to run the checks.' : 'Connected to Klaviyo, but there are no templates yet.', 'ok');
    }, function (e) {
      k.pending = false; k.error = e;
      rerenderWhere(function (x) { return x.type === 'klaviyo'; });
      say(e.message, 'fail');
    });
    return k;
  }

  function importKlaviyo(id) {
    say('Importing from Klaviyo…', null, true);
    MP.klaviyo.get(id).then(function (r) {
      if (!r.html) throw new Error('Klaviyo returned no HTML for "' + (r.name || id) + '". System drag-and-drop templates may not include HTML.');
      var t = addTemplate(r.html, r.name || 'Klaviyo template', 'klaviyo', { klaviyoId: id });
      showTemplate(t, 'Imported from Klaviyo.');
    }).catch(function (e) { say(e.message, 'fail'); });
  }

  function loadFile(file) {
    var reader = new FileReader();
    say('Reading ' + file.name + '…', 'info', true);
    reader.onload = function () {
      try {
        var text = String(reader.result || '');
        if (/\.eml$/i.test(file.name) || (!/\.(csv|tsv)$/i.test(file.name) && MP.eml.looksLikeEml(text))) return loadEml(text, file.name);
        if (/\.html?$/i.test(file.name) || (!/\.(csv|tsv)$/i.test(file.name) && MP.templates.looksLikeHtml(text))) {
          var t = addTemplate(text, MP.templates.nameFrom(text, MP.templates.cleanName(file.name)), 'upload');
          return showTemplate(t, 'Loaded ' + file.name + '.');
        }
        data = MP.logs.fromText(text, { kind: 'file', name: file.name });
        state.logSource = 'file';
        var s = data.summary();
        if (!state.tiles.some(function (t) { return cat[t.type].needs === 'log'; })) {
          prepend([{ type: 'summary' }, { type: 'providers', size: 'L' }, { type: 'deferrals' }, { type: 'bounces' }]);
        }
        render();
        var top = data.insights()[0];
        say('Loaded ' + file.name + ': ' + s.messages.toLocaleString() + ' messages. ' + top.text, top.level);
        save();
      } catch (e) {
        say('Couldn\'t read ' + file.name + '. ' + e.message, 'fail');
      }
    };
    reader.onerror = function () { say('Couldn\'t read ' + file.name + '.', 'fail'); };
    reader.readAsText(file);
  }

  function dnsKey(params) { return params.domain + (params.selectors ? '|' + params.selectors.join(',') : ''); }

  function ensureDns(params) {
    var key = dnsKey(params);
    var d = dnsResults[key];
    if (d) return d;
    d = dnsResults[key] = { pending: true };
    d.promise = MP.dns.checkAll(params.domain, { selectors: params.selectors }).then(function (r) {
      d.pending = false; d.value = r; rerenderWhere(function (t) { return cat[t.type].needs === 'dns' && dnsKey(t.params) === key; });
      return r;
    }, function (e) {
      d.pending = false; d.error = e; rerenderWhere(function (t) { return cat[t.type].needs === 'dns' && dnsKey(t.params) === key; });
      throw e;
    });
    return d;
  }

  // ---------- Tiles ----------
  function tileKey(t) { return t.type + '|' + JSON.stringify(t.params || {}); }

  function prepend(specs) {
    var fresh = [];
    specs.forEach(function (spec) {
      if (!cat[spec.type]) return;
      var key = tileKey(spec);
      var existing = state.tiles.filter(function (x) { return tileKey(x) === key; })[0];
      if (existing) {
        if (spec.size) existing.size = spec.size;
        state.tiles.splice(state.tiles.indexOf(existing), 1);
        fresh.push(existing);
        return;
      }
      fresh.push({ id: 't' + Date.now().toString(36) + (seq++), type: spec.type, params: spec.params || {}, size: spec.size || cat[spec.type].size || 'M' });
    });
    state.tiles = fresh.concat(state.tiles);
    return fresh;
  }

  function output(t) {
    var def = cat[t.type];
    var ctx = { data: data };
    if (def.needs === 'log' && !data) {
      return { status: 'empty', body: '<p class="muted">This tile needs a sending log.</p>', actions: [{ label: 'Load demo log', cmd: 'demo' }, { label: 'Upload CSV', upload: true }] };
    }
    if (def.needs === 'dns') {
      var d = ensureDns(t.params);
      if (d.pending) return { status: 'loading', title: def.title + ' · ' + t.params.domain, body: '<p class="muted loading-dots">Looking up ' + esc(t.params.domain) + '</p>' };
      if (d.error) return { status: 'fail', title: def.title + ' · ' + t.params.domain, body: '<p class="verdict">Lookup failed: ' + esc(d.error.message || 'network error') + '</p>', actions: [{ label: 'Retry', retryDns: true }] };
      return def.render(ctx, t.params, d.value);
    }
    if (def.needs === 'tpl') {
      ctx.tpl = MP.templates.get(t.params.tpl);
      ctx.tile = t;
      if (ctx.tpl) {
        ctx.qa = MP.qa.forTemplate(ctx.tpl);
        if (t.type === 'ai-review') ctx.ai = ensureAi(ctx.tpl);
      }
      return def.render(ctx, t.params);
    }
    if (def.needs === 'eml') { ctx.eml = emls[t.params.eml] || null; return def.render(ctx, t.params); }
    if (def.needs === 'klaviyo') { ctx.kl = ensureKlaviyo(); return def.render(ctx, t.params); }
    return def.render(ctx, t.params || {});
  }

  function badge(def, status) {
    if (def.needs === 'dns') return { ok: 'PASS', warn: 'REVIEW', fail: 'FAIL', loading: '…' }[status] || '';
    return { ok: 'OK', warn: 'WATCH', fail: 'FAIL' }[status] || '';
  }

  function tileEl(t) {
    var def = cat[t.type];
    var out;
    try { out = output(t); } catch (e) { out = { status: 'fail', body: '<p class="verdict">Couldn\'t build this tile: ' + esc(e.message) + '</p>' }; }
    var title = out.title || def.title;
    var b = badge(def, out.status);
    var acts = (out.actions || []).map(function (a) {
      if (a.upload) return '<button type="button" class="btn ghost" data-upload="1">' + esc(a.label) + '</button>';
      if (a.retryDns) return '<button type="button" class="btn ghost" data-retry="1">' + esc(a.label) + '</button>';
      if (a.fill) return '<button type="button" class="btn ghost" data-fill="' + esc(a.fill) + '" data-nofire="1">' + esc(a.label) + '</button>';
      if (a.settings) return '<button type="button" class="btn ghost" data-settings="1">' + esc(a.label) + '</button>';
      return '<button type="button" class="btn ghost" data-cmd="' + esc(a.cmd) + '">' + esc(a.label) + '</button>';
    });
    if (out.copy) acts.push('<button type="button" class="btn ghost" data-copy="' + esc(out.copy) + '">' + ICON.copy + esc(out.copyLabel || 'Copy fix') + '</button>');
    var el = document.createElement('section');
    el.className = 'tile size-' + t.size + ' st-' + (out.status || 'info');
    el.dataset.id = t.id;
    el.setAttribute('aria-label', title);
    el.innerHTML =
      '<header class="tile-h">' +
      '<button type="button" class="ib grip" data-act="grip" aria-label="Move ' + esc(title) + '. Drag it, or use the arrow keys.">' + ICON.grip + '</button>' +
      '<h2 class="tile-t">' + esc(title) + '</h2>' +
      (b ? '<span class="badge b-' + esc(out.status) + '">' + b + '</span>' : '') +
      '<button type="button" class="ib sz" data-act="size" aria-label="Tile size ' + SIZE_NAME[t.size] + '. Change size.">' + ICON.resize + '<span>' + t.size + '</span></button>' +
      '<button type="button" class="ib" data-act="close" aria-label="Close ' + esc(title) + '">' + ICON.x + '</button>' +
      '</header>' +
      '<div class="tile-b">' + (out.body || '') + '</div>' +
      (acts.length ? '<div class="tile-a">' + acts.join('') + '</div>' : '') +
      (out.foot ? '<footer class="tile-f">' + esc(out.foot) + '</footer>' : '');
    return el;
  }

  function render() {
    var root = $('#tiles');
    root.innerHTML = '';
    state.tiles.forEach(function (t) { root.appendChild(tileEl(t)); });
    $('#empty').hidden = state.tiles.length > 0;
    renderViews();
    renderSource();
  }

  function rerenderWhere(fn) {
    var root = $('#tiles');
    state.tiles.forEach(function (t) {
      if (!fn(t)) return;
      var old = root.querySelector('[data-id="' + t.id + '"]');
      if (old) {
        var focused = old.contains(document.activeElement) ? document.activeElement.getAttribute('data-act') : null;
        var fresh = tileEl(t);
        fresh.style.animation = 'none';
        old.replaceWith(fresh);
        if (focused) { var f = fresh.querySelector('[data-act="' + focused + '"]'); if (f) f.focus(); }
      }
    });
  }

  function renderSource() {
    var el = $('#source');
    if (!data) { el.textContent = 'No sending log'; return; }
    var s = data.summary();
    el.textContent = (data.source.kind === 'demo' ? 'Demo log' : data.source.name) + ' · ' + s.events.toLocaleString() + ' events';
  }

  // ---------- Views ----------
  function viewNamed(name) {
    var n = String(name).toLowerCase();
    return Object.keys(state.views).filter(function (k) { return k.toLowerCase() === n; })[0] || null;
  }

  function saveView(name) {
    var existing = viewNamed(name);
    if (existing && existing !== name) delete state.views[existing];
    state.views[name] = { tiles: state.tiles.map(function (t) { return { type: t.type, params: t.params, size: t.size }; }), logSource: state.logSource, saved: Date.now() };
    state.current = name;
  }

  function openView(name) {
    var v = state.views[name];
    if (!v) return false;
    state.tiles = [];
    prepend(v.tiles.slice());
    state.current = name;
    if (v.logSource === 'demo' && !data) loadDemo();
    return true;
  }

  function renderViews() {
    var nav = $('#views');
    var names = Object.keys(state.views);
    if (!names.length) { nav.innerHTML = ''; return; }
    nav.innerHTML = names.map(function (n) {
      return '<button type="button" class="view" data-view="' + esc(n) + '" aria-current="' + (n === state.current) + '">' + esc(n) + '</button>';
    }).join('') + '<button type="button" class="view add" data-fill="save view as " data-nofire="1">+ Save view</button>';
  }

  // ---------- Agent line ----------
  function say(text, level, thinking) {
    var el = $('#said');
    el.textContent = text || '';
    el.className = 'said' + (level ? ' lvl-' + level : '') + (thinking ? ' thinking' : '');
  }
  function echo(text) { $('#you').textContent = text ? '> ' + text : ''; }

  function dnsSay(r) {
    var bad = [r.spf, r.dkim, r.dmarc].filter(function (x) { return x && x.status && x.status !== 'ok'; });
    if (!bad.length) return { text: r.domain + ': SPF, DKIM and DMARC all pass.', level: 'ok' };
    return { text: r.domain + ': ' + bad[0].verdict, level: bad.some(function (x) { return x.status === 'fail'; }) ? 'fail' : 'warn' };
  }

  // ---------- Running a command ----------
  function agentCtx() {
    var all = MP.templates.all();
    return {
      viewNamed: viewNamed, data: data, tiles: state.tiles,
      findTemplate: MP.templates.find, activeTpl: state.activeTpl ? MP.templates.get(state.activeTpl) : (all.length === 1 ? all[0] : null),
      hasTemplates: all.length > 0, firstTemplateName: all[0] ? all[0].name : '', templateNames: all.map(function (t) { return t.name; }),
      hasEml: !!lastEml, lastEml: lastEml
    };
  }

  function run(text, opts) {
    text = String(text || '').trim();
    opts = opts || {};
    if (!text) return;
    if (!opts.silent) { history.push(text); hIdx = history.length; }
    var id = ++cmdSeq;
    echo(text);
    var plan = MP.agent.route(text, agentCtx());
    if (!plan.understood && !plan.say) {
      if (settings.apiKey) {
        say('Thinking…', null, true);
        MP.agent.askClaude(text, agentCtx(), settings).then(function (p) {
          if (id === cmdSeq) apply(p, id);
        }).catch(function (e) {
          if (id === cmdSeq) say('Claude couldn\'t answer: ' + e.message, 'fail');
        });
        return;
      }
      say('I didn\'t catch that. Type help for examples, or add a Claude API key in settings to ask in your own words.');
      return;
    }
    apply(plan, id);
  }

  function apply(plan, id) {
    var said = plan.say ? { text: plan.say } : null;
    var specs = plan.tiles.slice();
    var layoutChanged = false;
    var opSaid = null;

    plan.ops.forEach(function (op) {
      if (op.op === 'clear') { state.tiles = []; state.current = null; said = said || { text: 'Cleared. What do you want to see?' }; }
      else if (op.op === 'demo') {
        loadDemo();
        specs = specs.concat(DEMO_TILES);
        var top = data.insights()[0];
        said = said || { text: 'Loaded the demo log (a fictional bakery\'s overnight sends). ' + top.text, level: top.level };
      }
      else if (op.op === 'open') { openView(op.name); said = said || { text: 'Opened ' + op.name + '.' }; }
      else if (op.op === 'deleteView') {
        var vn = viewNamed(op.name);
        if (vn) { delete state.views[vn]; if (state.current === vn) state.current = null; said = { text: 'Deleted the view ' + vn + '.' }; }
        else said = { text: 'No saved view named "' + op.name + '".' };
      }
      else if (op.op === 'paste') { openPaste(); said = said || { text: 'Paste your email HTML, then press Check it. You can also paste straight into the prompt box.' }; }
      else if (op.op === 'upload') { $('#file').click(); said = said || { text: 'Pick an .html, .eml or .csv file.' }; }
      else if (op.op === 'sampleTemplate') {
        var st = addTemplate(MP.demoTemplate.html, MP.demoTemplate.name, 'sample');
        specs = specs.concat(qaTiles(st));
      }
      else if (op.op === 'connect') {
        if (!op.code) { specs.push({ type: 'klaviyo' }); said = { text: 'Start the connector, then type the pairing code it shows: connect klaviyo XXXX-XXXX' }; return; }
        MP.klaviyo.setCode(op.code);
        klState = null;
        specs.push({ type: 'klaviyo' });
        said = { text: 'Pairing with the Klaviyo connector…' };
      }
      else if (op.op === 'disconnect') { MP.klaviyo.setCode(''); klState = null; said = { text: 'Forgot the Klaviyo pairing code. Stop the connector with Ctrl+C in its terminal.' }; }
    });

    // Claude may name a template instead of giving its id.
    specs = specs.filter(function (s) {
      if (!cat[s.type] || cat[s.type].needs !== 'tpl') return true;
      s.params = s.params || {};
      if (!s.params.tpl && s.params.template) {
        var f = MP.templates.find(s.params.template) || MP.templates.all().filter(function (x) { return x.name.toLowerCase() === String(s.params.template).toLowerCase(); })[0];
        if (!f) return false;
        s.params = { tpl: f.id };
      }
      return !!s.params.tpl;
    });
    specs.forEach(function (s) {
      if (s.params && s.params.tpl) state.activeTpl = s.params.tpl;
      if (s.type === 'ai-review' && s.params && s.params.tpl) {
        var tt = MP.templates.get(s.params.tpl);
        if (tt) { var k = tt.id + ':' + tt.updated; if (aiResults[k] && aiResults[k].error) delete aiResults[k]; }
      }
      if (s.type === 'klaviyo' && klState && !klState.pending) klState = null;
    });
    if (plan.activeTpl) state.activeTpl = plan.activeTpl;

    var added = specs.length ? prepend(specs) : [];

    plan.ops.forEach(function (op) {
      if (op.op === 'size') {
        var hit = state.tiles.filter(function (t) { return t.type === op.target; });
        if (!hit.length && cat[op.target] && !cat[op.target].needs && op.target !== 'help') return;
        if (!hit.length && cat[op.target] && cat[op.target].needs === 'log') hit = prepend([{ type: op.target, size: op.size }]);
        hit.forEach(function (t) { t.size = op.size; });
        layoutChanged = true;
        opSaid = opSaid || { text: hit.length ? 'Made ' + cat[op.target].title.toLowerCase() + ' ' + SIZE_NAME[op.size] + '.' : 'There\'s no ' + cat[op.target].title + ' tile on screen.' };
      } else if (op.op === 'remove') {
        var before = state.tiles.length;
        state.tiles = state.tiles.filter(function (t) { return t.type !== op.target; });
        layoutChanged = true;
        opSaid = opSaid || { text: before === state.tiles.length ? 'Nothing to hide.' : 'Hid ' + cat[op.target].title.toLowerCase() + '.' };
      }
    });
    if (!added.length && opSaid) said = said || opSaid;

    plan.ops.forEach(function (op) {
      if (op.op === 'save') { saveView(op.name); said = { text: 'Saved this layout as "' + op.name + '". Type "open ' + op.name + '" or tap it above anytime.', level: 'ok' }; }
    });

    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (!said && added.length) {
      var first = added[0];
      var def = cat[first.type];
      if (def.needs === 'dns') {
        said = { text: 'Checking ' + first.params.domain + '…' };
        ensureDns(first.params).promise.then(function (r) {
          if (id === cmdSeq) { var s = dnsSay(r); say(s.text, s.level); }
        }, function () { if (id === cmdSeq) say('Couldn\'t reach DNS. Check your connection and try again.', 'fail'); });
      } else if (def.needs === 'log' && data) {
        var out = output(first);
        if (out.say) said = { text: out.say, level: out.status === 'fail' ? 'fail' : out.status === 'warn' ? 'warn' : null };
        else {
          var ins = data.insights().filter(function (i) { return added.some(function (a) { return a.type === i.tile; }); })[0] || data.insights()[0];
          said = { text: ins.text, level: ins.level };
        }
        if (added.length > 2) said.text = 'Built ' + added.length + ' tiles. ' + said.text;
      } else if (def.needs === 'log' && !data) {
        said = { text: 'Those tiles need a sending log. Drop a CSV on the page, or type demo.' };
      } else {
        var o2 = output(first);
        var sumT = added.filter(function (a) { return a.type === 'tpl-summary'; })[0];
        var withSay = sumT ? output(sumT) : (o2.say ? o2 : null);
        if (withSay && !withSay.say) withSay = null;
        if (!withSay) added.some(function (a) { var o = output(a); if (o.say) { withSay = o; return true; } return false; });
        if (first.type === 'ai-review' && o2.status === 'loading') said = { text: 'Claude is reviewing the template. This takes a few seconds.' };
        else if (withSay) said = { text: withSay.say, level: withSay.status === 'fail' ? 'fail' : withSay.status === 'warn' ? 'warn' : null };
        else if (first.type === 'tpl-library') said = { text: MP.templates.all().length ? 'Your templates. Tap QA or Preview, or say: qa <name>.' : 'No templates yet. Paste HTML or type: sample template' };
        else if (cat[first.type].needs === 'tpl') { var tt2 = MP.templates.get(first.params.tpl); if (tt2) said = { text: tt2.name + ': ' + (cat[first.type].title) + '.' }; }
      }
    }
    if (said) say(said.text, said.level);
    if (layoutChanged || added.length || plan.ops.length) save();
  }

  function openPaste() {
    var d = $('#paste');
    if (d.showModal) d.showModal(); else d.setAttribute('open', '');
    setTimeout(function () { $('#paste-html').focus(); }, 30);
  }

  // ---------- Events ----------
  function cycleSize(id) {
    var t = byId(id); if (!t) return;
    t.size = SIZES[(SIZES.indexOf(t.size) + 1) % 3];
    rerenderWhere(function (x) { return x.id === id; });
    var el = $('#tiles [data-id="' + id + '"] [data-act="size"]'); if (el) el.focus();
    save();
  }
  function byId(id) { return state.tiles.filter(function (t) { return t.id === id; })[0]; }
  function move(id, delta) {
    var i = state.tiles.findIndex(function (t) { return t.id === id; });
    var j = i + delta;
    if (i < 0 || j < 0 || j >= state.tiles.length) return;
    var t = state.tiles.splice(i, 1)[0];
    state.tiles.splice(j, 0, t);
    render();
    var g = $('#tiles [data-id="' + id + '"] [data-act="grip"]'); if (g) g.focus();
    save();
  }

  function fill(text, fire) {
    var q = $('#q');
    q.value = text;
    q.focus();
    q.setSelectionRange(text.length, text.length);
    if (fire) { run(text); q.value = ''; }
  }

  var toastTimer = null;
  function toast(text) {
    var t = $('#toast');
    t.textContent = text; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 1800);
  }

  function copy(text) {
    function done() { toast('Copied'); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    } else { fallbackCopy(text); done(); }
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    ta.remove();
  }

  function onClick(e) {
    var el = e.target.closest('button, a');
    if (!el) return;
    var tile = el.closest('.tile');
    var act = el.getAttribute('data-act');
    if (act === 'size' && tile) return cycleSize(tile.dataset.id);
    if (act === 'close' && tile) {
      state.tiles = state.tiles.filter(function (t) { return t.id !== tile.dataset.id; });
      render(); save(); return;
    }
    if (el.hasAttribute('data-view')) { var name = el.getAttribute('data-view'); echo('open ' + name); openView(name); render(); say('Opened ' + name + '.'); save(); return; }
    if (el.hasAttribute('data-cmd')) return fill(el.getAttribute('data-cmd'), true);
    if (el.hasAttribute('data-fill')) {
      var text = el.getAttribute('data-fill');
      var fire = !el.hasAttribute('data-nofire') && !/yourdomain/.test(text);
      return fill(text, fire);
    }
    if (el.hasAttribute('data-pmode') && tile) {
      var pt = byId(tile.dataset.id);
      if (pt) { pt.mode = el.getAttribute('data-pmode'); rerenderWhere(function (x) { return x.id === pt.id; }); var b = $('#tiles [data-id="' + pt.id + '"] [data-pmode="' + pt.mode + '"]'); if (b) b.focus(); save(); }
      return;
    }
    if (el.hasAttribute('data-import')) return importKlaviyo(el.getAttribute('data-import'));
    if (el.hasAttribute('data-settings')) return $('#settings-btn').click();
    if (el.hasAttribute('data-upload')) return $('#file').click();
    if (el.hasAttribute('data-copy')) return copy(el.getAttribute('data-copy'));
    if (el.hasAttribute('data-retry') && tile) {
      var t = byId(tile.dataset.id);
      if (t) { delete dnsResults[dnsKey(t.params)]; MP.dns.clearCache(); render(); }
    }
  }

  // Drag to reorder (pointer events, so it works with touch too).
  var drag = null;
  function onPointerDown(e) {
    var g = e.target.closest('[data-act="grip"]');
    if (!g) return;
    var el = g.closest('.tile');
    drag = { el: el, id: el.dataset.id, sx: e.clientX, sy: e.clientY, moved: false };
    try { g.setPointerCapture(e.pointerId); } catch (err) {}
    e.preventDefault();
  }
  function onPointerMove(e) {
    if (!drag) return;
    if (!drag.moved && Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) < 6) return;
    drag.moved = true;
    drag.el.classList.add('dragging');
    var under = document.elementFromPoint(e.clientX, e.clientY);
    var over = under && under.closest('.tile');
    var root = $('#tiles');
    if (!over || over === drag.el || !root.contains(over)) return;
    var r = over.getBoundingClientRect();
    var before = e.clientX < r.left + r.width / 2;
    root.insertBefore(drag.el, before ? over : over.nextSibling);
  }
  function onPointerUp() {
    if (!drag) return;
    var d = drag; drag = null;
    d.el.classList.remove('dragging');
    if (!d.moved) return;
    var order = Array.prototype.map.call($('#tiles').children, function (c) { return c.dataset.id; });
    state.tiles.sort(function (a, b) { return order.indexOf(a.id) - order.indexOf(b.id); });
    save();
  }
  function onKeyDown(e) {
    var g = e.target.closest && e.target.closest('[data-act="grip"]');
    if (!g) return;
    var id = g.closest('.tile').dataset.id;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(id, -1); }
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(id, 1); }
  }

  function wire() {
    document.addEventListener('click', onClick);
    var root = $('#tiles');
    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('pointermove', onPointerMove);
    root.addEventListener('pointerup', onPointerUp);
    root.addEventListener('pointercancel', onPointerUp);
    root.addEventListener('keydown', onKeyDown);

    $('#ask').addEventListener('submit', function (e) {
      e.preventDefault();
      var q = $('#q');
      var v = q.value;
      q.value = '';
      run(v);
    });
    // Paste HTML straight into the prompt box to QA it.
    $('#q').addEventListener('paste', function (e) {
      var text = (e.clipboardData || window.clipboardData).getData('text');
      if (MP.eml.looksLikeEml(text)) { e.preventDefault(); try { loadEml(text, 'pasted message'); } catch (err) { say(err.message, 'fail'); } return; }
      if (MP.templates.looksLikeHtml(text)) {
        e.preventDefault();
        var t = addTemplate(text, MP.templates.nameFrom(text, 'Pasted email ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })), 'paste');
        echo('(pasted HTML)');
        showTemplate(t, 'Saved as "' + t.name + '".');
      }
    });
    var pd = $('#paste');
    $('#paste-go').addEventListener('click', function (e) {
      var html = $('#paste-html').value;
      if (!html.trim()) { e.preventDefault(); return; }
      var name = $('#paste-name').value.trim();
      var t = addTemplate(html, name || MP.templates.nameFrom(html, 'Pasted email'), 'paste');
      $('#paste-html').value = ''; $('#paste-name').value = '';
      setTimeout(function () { showTemplate(t, 'Saved as "' + t.name + '".'); }, 0);
    });
    pd.addEventListener('close', function () { $('#q').focus(); });

    $('#q').addEventListener('keydown', function (e) {
      if (e.key === 'ArrowUp' && history.length) { e.preventDefault(); hIdx = Math.max(0, hIdx - 1); this.value = history[hIdx] || ''; }
      if (e.key === 'ArrowDown' && history.length) { e.preventDefault(); hIdx = Math.min(history.length, hIdx + 1); this.value = history[hIdx] || ''; }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === '/' && document.activeElement && !/input|textarea/i.test(document.activeElement.tagName)) { e.preventDefault(); $('#q').focus(); }
    });

    $('#upload-btn').addEventListener('click', function () { $('#file').click(); });
    $('#file').addEventListener('change', function () { if (this.files[0]) loadFile(this.files[0]); this.value = ''; });
    $('#sample-dl').addEventListener('click', function () {
      var blob = new Blob([MP.demo.toCSV()], { type: 'text/csv' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'mailprompt-sample-pmta.csv';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    });

    // Drag a file anywhere.
    var depth = 0;
    function hasFiles(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') !== -1; }
    window.addEventListener('dragenter', function (e) { if (!hasFiles(e)) return; depth++; $('#drop').hidden = false; });
    window.addEventListener('dragleave', function (e) { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) $('#drop').hidden = true; });
    window.addEventListener('dragover', function (e) { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener('drop', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault(); depth = 0; $('#drop').hidden = true;
      var f = e.dataTransfer.files[0]; if (f) loadFile(f);
    });

    // Theme
    $('#theme-btn').addEventListener('click', function () {
      var cur = document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      state.theme = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', state.theme);
      save();
    });

    // Settings
    var dlg = $('#settings');
    $('#settings-btn').addEventListener('click', function () {
      $('#api-key').value = settings.apiKey || '';
      $('#api-model').value = settings.model || '';
      $('#review-model').value = settings.reviewModel || '';
      $('#kl-code').value = MP.klaviyo.getCode();
      if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
    });
    dlg.addEventListener('close', function () {
      if (dlg.returnValue === 'save') {
        settings.apiKey = $('#api-key').value.trim();
        settings.model = $('#api-model').value.trim() || 'claude-haiku-5-5';
        settings.reviewModel = $('#review-model').value.trim() || 'claude-sonnet-5-5';
        var kc = $('#kl-code').value.trim().toUpperCase();
        if (kc !== MP.klaviyo.getCode()) { MP.klaviyo.setCode(kc); klState = null; }
        saveSettings();
        toast(settings.apiKey ? 'Key saved in this browser' : 'Settings saved');
      }
    });
    $('#key-remove').addEventListener('click', function () {
      settings.apiKey = ''; saveSettings(); $('#api-key').value = ''; toast('Key removed');
    });
  }

  // ---------- Start ----------
  function start() {
    load();
    if (state.theme) document.documentElement.setAttribute('data-theme', state.theme);
    if (state.logSource === 'demo') loadDemo();
    else state.logSource = null;
    wire();
    render();
    var qs = new URLSearchParams(location.search);
    if (qs.has('demo') || location.hash === '#demo') run('demo', { silent: true });
    if (qs.get('q')) run(qs.get('q'));
    if (!qs.has('demo') && !qs.get('q')) {
      if (state.tiles.length && state.current) say('Welcome back. Here\'s your ' + state.current + ' view.');
      else if (state.tiles.length) say('Welcome back.');
    }
  }

  MP.app = { run: run, state: state, get data() { return data; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(window.MP = window.MP || {});
