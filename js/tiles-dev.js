/* mailprompt developer tiles: template QA, merge tags, Outlook and dark mode,
   preview, template library, .eml headers, AI review, Klaviyo. */
(function (MP) {
  'use strict';

  var esc = MP.tiles.esc;
  var cat = MP.tiles.catalog;
  var LABEL = { fix: 'FIX', check: 'CHECK', note: 'NOTE', ok: 'OK' };
  var TONE = { fix: 'fail', check: 'warn', note: 'info', ok: 'ok' };
  function kb(b) { return (b / 1024).toFixed(1) + 'KB'; }
  function verdict(t) { return '<p class="verdict">' + esc(t) + '</p>'; }
  function list(items, max) {
    if (!items.length) return '';
    return '<ul class="check qa">' + items.slice(0, max || 50).map(function (i) {
      return '<li><span>' + esc(i.text) + '</span><span class="mono t-' + TONE[i.level] + '">' + LABEL[i.level] + '</span></li>';
    }).join('') + '</ul>';
  }
  function status(items) {
    if (items.some(function (i) { return i.level === 'fix'; })) return 'fail';
    if (items.some(function (i) { return i.level === 'check'; })) return 'warn';
    return 'ok';
  }
  function short(url, n) { url = String(url || ''); n = n || 48; return url.length > n ? url.slice(0, n - 1) + '…' : url; }
  function when(t) { return t ? new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; }
  function noTemplate() {
    return { status: 'empty', body: '<p class="muted">Template not found. Paste or upload it again.</p>', actions: [{ label: 'Paste HTML', cmd: 'paste html' }, { label: 'Try a sample template', cmd: 'sample template' }] };
  }

  cat['tpl-library'] = {
    title: 'Templates', size: 'L',
    render: function () {
      var all = MP.templates.all();
      if (!all.length) {
        return {
          status: 'info', body: verdict('No templates yet.') + '<p class="muted">Paste HTML into the prompt box, drop an .html or .eml file on the page, or import from Klaviyo.</p>',
          actions: [{ label: 'Paste HTML', cmd: 'paste html' }, { label: 'Try a sample template', cmd: 'sample template' }, { label: 'Klaviyo templates', cmd: 'klaviyo templates' }]
        };
      }
      var rows = all.map(function (t) {
        var q = MP.qa.forTemplate(t);
        return '<li class="lib"><span class="lib-n">' + esc(t.name) + '<span class="muted small mono"> · ' + esc(t.source) + ' · ' + kb(q.bytes) + ' · ' + esc(when(t.updated)) + '</span></span>' +
          '<span class="lib-s mono t-' + (q.counts.fix ? 'fail' : q.counts.check ? 'warn' : 'ok') + '">' + (q.counts.fix ? q.counts.fix + ' FIX' : q.counts.check ? q.counts.check + ' CHECK' : 'OK') + '</span>' +
          '<span class="lib-a"><button type="button" class="btn ghost" data-cmd="qa ' + esc(t.name) + '">QA</button><button type="button" class="btn ghost" data-cmd="preview ' + esc(t.name) + '">Preview</button></span></li>';
      }).join('');
      return { status: 'info', body: '<ul class="check libs">' + rows + '</ul>', foot: all.length + ' template' + (all.length > 1 ? 's' : '') + ' · saved in this browser only' + (MP.templates.memoryOnly ? ' (storage full: kept until you close the tab)' : '') };
    }
  };

  cat['tpl-summary'] = {
    title: 'Email QA', needs: 'tpl', size: 'M',
    render: function (ctx) {
      if (!ctx.tpl) return noTemplate();
      var q = ctx.qa, t = ctx.tpl;
      var top = q.items.filter(function (i) { return i.level !== 'ok'; });
      var v = q.counts.fix ? q.counts.fix + ' to fix before sending' + (q.counts.check ? ', ' + q.counts.check + ' to check' : '') + '.' : q.counts.check ? 'Nothing blocking. ' + q.counts.check + ' thing' + (q.counts.check > 1 ? 's' : '') + ' to check.' : 'Looks ready to send.';
      var stats = '<div class="stats">' +
        '<div class="stat"><span class="stat-v' + (q.clip ? ' t-fail' : q.bytes >= 90 * 1024 ? ' t-warn' : '') + '">' + kb(q.bytes) + '</span><span class="stat-l">' + (q.clip ? 'Gmail clips' : 'of ~102KB clip') + '</span></div>' +
        '<div class="stat"><span class="stat-v">' + q.links.length + '</span><span class="stat-l">links</span></div>' +
        '<div class="stat"><span class="stat-v">' + q.images.length + '</span><span class="stat-l">images</span></div>' +
        '<div class="stat"><span class="stat-v' + (q.counts.fix ? ' t-fail' : '') + '">' + q.counts.fix + '</span><span class="stat-l">to fix</span></div>' +
        '</div>';
      var pre = q.preheader ? '<p class="ex mono">Preheader: ' + esc(short(q.preheader.text, 140)) + '</p>' : '';
      return {
        status: q.status, title: 'QA · ' + t.name, say: t.name + ': ' + v,
        body: verdict(v) + stats + pre + list(top, 10) + (top.length > 10 ? '<p class="muted small">+' + (top.length - 10) + ' more in the detail tiles.</p>' : ''),
        actions: [{ label: 'Links', cmd: 'links ' + t.name }, { label: 'Merge tags', cmd: 'merge tags ' + t.name }, { label: 'Outlook & dark', cmd: 'outlook ' + t.name }, { label: 'Preview', cmd: 'preview ' + t.name }, { label: 'AI review', cmd: 'ai review ' + t.name }],
        foot: 'Rule checks, in your browser · source: ' + t.source
      };
    }
  };

  cat['tpl-links'] = {
    title: 'Links', needs: 'tpl', size: 'L',
    render: function (ctx) {
      if (!ctx.tpl) return noTemplate();
      var L = ctx.qa.links;
      if (!L.length) return { status: 'warn', title: 'Links · ' + ctx.tpl.name, body: verdict('No links found. Not even an unsubscribe link.') };
      var web = L.filter(function (l) { return l.kind === 'web' && !l.unsub; });
      var utm = web.filter(function (l) { return l.utm; }).length;
      var bad = L.filter(function (l) { return l.status !== 'ok'; }).length;
      var rows = L.map(function (l) {
        var st = l.status === 'fix' ? 'FIX' : l.status === 'check' ? 'CHECK' : l.kind === 'merge' ? 'ESP' : l.unsub ? 'UNSUB' : l.kind === 'contact' ? 'OK' : l.utm ? 'UTM' : 'NO UTM';
        var tone = l.status === 'fix' ? 'fail' : l.status === 'check' ? 'warn' : st === 'NO UTM' ? 'info' : 'ok';
        return '<tr' + (l.status !== 'ok' ? ' class="row-' + (l.status === 'fix' ? 'fail' : 'warn') + '"' : '') + '><td>' + esc(short(l.text || '(no text)', 24)) + '</td><td title="' + esc(l.href) + '">' + esc(short(l.href.replace(/^https?:\/\//, '') || '(none)', 40)) + '</td><td class="num t-' + tone + '">' + st + '</td></tr>' +
          (l.note ? '<tr class="sub"><td></td><td colspan="2" class="muted">' + esc(l.note) + '</td></tr>' : '');
      }).join('');
      var lv = L.length + ' links. ' + (bad ? bad + ' need attention. ' : 'None broken. ') + (web.length ? utm + ' of ' + web.length + ' web links have UTMs.' : '');
      return {
        status: bad ? (L.some(function (l) { return l.status === 'fix'; }) ? 'fail' : 'warn') : 'ok', title: 'Links · ' + ctx.tpl.name, say: ctx.tpl.name + ': ' + lv,
        body: verdict(L.length + ' links. ' + (bad ? bad + ' need attention. ' : 'None broken. ') + (web.length ? utm + ' of ' + web.length + ' web links have UTMs.' : '')) +
          '<div class="tbl-wrap"><table class="tbl"><thead><tr><th scope="col">Text</th><th scope="col">URL</th><th scope="col" class="num">Status</th></tr></thead><tbody>' + rows + '</tbody></table></div>',
        foot: 'Links aren\'t visited, so a live 404 won\'t show here. ESP tags (like {% unsubscribe_url %}) are filled in at send.'
      };
    }
  };

  cat['tpl-images'] = {
    title: 'Images', needs: 'tpl', size: 'M',
    render: function (ctx) {
      if (!ctx.tpl) return noTemplate();
      var I = ctx.qa.images;
      if (!I.length) return { status: 'ok', title: 'Images · ' + ctx.tpl.name, body: verdict('No images. Text-only emails are fine.') };
      var noAlt = I.filter(function (i) { return !i.hasAlt; }).length;
      var rows = I.map(function (i) {
        var file = i.src.split('/').pop().split('?')[0] || i.src;
        return '<li><span><span class="mono">' + esc(short(file, 36)) + '</span><br><span class="muted small">' + (i.hasAlt ? (i.alt ? 'alt: ' + esc(short(i.alt, 60)) : 'alt="" (decorative)') : 'no alt') + (i.width ? ' · width ' + esc(i.width) : '') + (i.note ? ' · ' + esc(i.note) : '') + '</span></span>' +
          '<span class="mono t-' + (i.status === 'fix' ? 'fail' : i.status === 'check' ? 'warn' : 'ok') + '">' + (i.status === 'fix' ? 'FIX' : i.status === 'check' ? 'CHECK' : 'OK') + '</span></li>';
      }).join('');
      return { status: noAlt ? 'fail' : I.some(function (i) { return i.status === 'check'; }) ? 'warn' : 'ok', title: 'Images · ' + ctx.tpl.name, say: ctx.tpl.name + ': ' + I.length + ' images. ' + (noAlt ? noAlt + ' missing alt text.' : 'All have alt attributes.'), body: verdict(I.length + ' images. ' + (noAlt ? noAlt + ' missing alt text.' : 'All have alt attributes.')) + '<ul class="check">' + rows + '</ul>' };
    }
  };

  cat['tpl-merge'] = {
    title: 'Merge tags', needs: 'tpl', size: 'M',
    render: function (ctx) {
      if (!ctx.tpl) return noTemplate();
      var M = ctx.qa.merge;
      if (!M.tags.length) return { status: 'ok', title: 'Merge tags · ' + ctx.tpl.name, body: verdict('No merge tags. Nothing to personalize, nothing to break.') };
      var rows = M.tags.map(function (t) {
        var needs = /first|last|^name|fname|lname|full_?name|city|company|title|nickname/i.test(t.field || '');
        var st = !needs || t.fallback ? 'OK' : 'NO FALLBACK';
        return '<li><span><span class="mono">' + esc(short(t.tag, 60)) + '</span><br><span class="muted small">' + esc(t.family.split(' (')[0]) + (t.count > 1 ? ' · used ' + t.count + 'x' : '') + '</span></span><span class="mono t-' + (st === 'OK' ? 'ok' : 'warn') + '">' + st + '</span></li>';
      }).join('');
      var v = M.families.length > 1 ? 'Mixed syntax: ' + M.families.map(function (f) { return f.split(' (')[0]; }).join(' + ') + '.' : M.families[0] + '.';
      return { status: status(M.issues), title: 'Merge tags · ' + ctx.tpl.name, say: ctx.tpl.name + ': ' + (M.issues[0] ? M.issues[0].text : 'Merge tags look fine. ' + v), body: verdict(v) + list(M.issues) + '<ul class="check">' + rows + '</ul>', foot: 'Fallback = a default value or an if-block, so empty fields don\'t show as blanks.' };
    }
  };

  cat['tpl-outlook'] = {
    title: 'Outlook, Gmail & dark mode', needs: 'tpl', size: 'M',
    render: function (ctx) {
      if (!ctx.tpl) return noTemplate();
      var C = ctx.qa.clients;
      function group(name, items) {
        return '<h3 class="grp">' + esc(name) + '</h3>' + (items.length ? list(items) : '<p class="muted small">Nothing flagged.</p>');
      }
      var all = C.outlook.concat(C.gmail, C.dark);
      return {
        status: status(all), title: 'Outlook & dark · ' + ctx.tpl.name,
        say: ctx.tpl.name + ': ' + ((all.filter(function (i) { return i.level === 'fix'; })[0] || all.filter(function (i) { return i.level === 'check'; })[0] || { text: 'No Outlook, Gmail or dark mode problems found in the code.' }).text),
        body: group('Classic Outlook (Windows)', C.outlook) + group('Gmail', C.gmail) + group('Dark mode', C.dark),
        foot: 'Code checks only. Real Outlook-on-Windows rendering needs Litmus or Email on Acid.'
      };
    }
  };

  function darkify(html, hasDarkCss) {
    if (hasDarkCss) {
      return html.replace(/@media\s*(?:screen\s+and\s*)?\(\s*prefers-color-scheme\s*:\s*dark\s*\)/gi, '@media all').replace(/<head([^>]*)>/i, '<head$1><style>:root{color-scheme:dark}</style>');
    }
    var css = '<style>html{filter:invert(1) hue-rotate(180deg);background:#fff}img,picture,video,[style*="background-image"]{filter:invert(1) hue-rotate(180deg)}</style>';
    return /<\/head>/i.test(html) ? html.replace(/<\/head>/i, css + '</head>') : css + html;
  }

  cat['tpl-preview'] = {
    title: 'Preview', needs: 'tpl', size: 'L',
    render: function (ctx) {
      if (!ctx.tpl) return noTemplate();
      var mode = (ctx.tile && ctx.tile.mode) || 'desktop';
      var html = ctx.tpl.html;
      var note = '';
      if (mode === 'dark') {
        html = darkify(html, ctx.qa.clients.hasDarkCss);
        note = ctx.qa.clients.hasDarkCss ? 'Dark: your own prefers-color-scheme styles applied (close to Apple Mail).' : 'Dark: simulated full color invert (roughly what Gmail and Outlook apps do with no dark styles).';
      } else {
        // Light preview even when your computer is in dark mode.
        html = html.replace(/@media\s*(?:screen\s+and\s*)?\(\s*prefers-color-scheme\s*:\s*dark\s*\)/gi, '@media not all');
        html = /<head[^>]*>/i.test(html) ? html.replace(/<head([^>]*)>/i, '<head$1><style>:root{color-scheme:light only}</style>') : '<style>:root{color-scheme:light only}</style>' + html;
      }
      html = /<head[^>]*>/i.test(html) ? html.replace(/<head([^>]*)>/i, '<head$1><base target="_blank">') : '<base target="_blank">' + html;
      var w = mode === 'mobile' ? 375 : 680;
      var modes = [['desktop', 'Desktop'], ['mobile', 'Mobile'], ['dark', 'Dark']].map(function (m) {
        return '<button type="button" class="seg" data-pmode="' + m[0] + '" aria-pressed="' + (mode === m[0]) + '">' + m[1] + '</button>';
      }).join('');
      return {
        status: 'info', title: 'Preview · ' + ctx.tpl.name, say: ctx.tpl.name + ' preview. Switch between Desktop, Mobile and Dark above the email.',
        body: '<div class="segs" role="group" aria-label="Preview mode">' + modes + '</div>' +
          '<div class="pv-wrap"><iframe class="pv" title="Email preview" sandbox="" referrerpolicy="no-referrer" style="width:' + w + 'px" srcdoc="' + esc(html) + '"></iframe></div>' +
          (note ? '<p class="muted small">' + esc(note) + '</p>' : ''),
        foot: 'Browser preview, scripts off. Not a real inbox render.'
      };
    }
  };

  // A saved example so people can see an AI review without a key (sample template only).
  var SAMPLE_REVIEW = {
    model: 'example',
    summary: 'Clean structure and a clear offer. The greeting, the CTA wording and the deadline need work before this goes out.',
    issues: [
      { severity: 'critical', title: 'Two greetings from two platforms', detail: 'The headline uses {{ first_name }} and the body uses *|FNAME|*. Whichever your ESP doesn\'t understand prints as raw code.', fix: 'Keep one: {{ first_name|default:\'friend\' }} in the headline, and drop *|FNAME|* from the body.' },
      { severity: 'copy', title: 'The deadline is buried', detail: 'Thursday night is the reason to act, but it sits mid-paragraph and not near the button.', fix: 'Add "Order by Thursday, 9 PM" right under the Pre-order now button.' },
      { severity: 'copy', title: '"Read more" says nothing', detail: 'The recipe link label doesn\'t say where it goes, which costs clicks and confuses screen readers.', fix: 'Use "Read the story behind the loaf".' },
      { severity: 'minor', title: 'Preheader repeats the headline', detail: 'Both say pumpkin loaves are back, so the inbox preview wastes its second line.', fix: 'Use the preheader for the deadline: "Pre-order by Thursday, pick up fresh Friday."' },
      { severity: 'minor', title: 'Hero opens as an empty box with images off', detail: 'The first thing many readers see is the hero, and it has no alt text or fallback color.', fix: 'Add alt="Fresh pumpkin loaves on the bakery counter" and a background color on its cell.' }
    ]
  };

  cat['ai-review'] = {
    title: 'AI review', needs: 'tpl', size: 'L',
    render: function (ctx) {
      if (!ctx.tpl) return noTemplate();
      var a = ctx.ai || {};
      var title = 'AI review · ' + ctx.tpl.name;
      if (a.nokey && ctx.tpl.source === 'sample') a = { value: SAMPLE_REVIEW, sample: true };
      if (a.nokey) return { status: 'info', title: title, body: verdict('AI review needs your Claude API key.') + '<p class="muted">It sends this template\'s HTML and the rule findings to Anthropic, and adds what rules can\'t judge: copy, CTAs, tone, layout risk.</p>', actions: [{ label: 'Add key in Settings', settings: true }] };
      if (a.pending) return { status: 'loading', title: title, body: '<p class="muted loading-dots">Claude is reviewing ' + esc(ctx.tpl.name) + '</p>' };
      if (a.error) return { status: 'fail', title: title, body: verdict('AI review failed: ' + a.error.message), actions: [{ label: 'Try again', cmd: 'ai review ' + ctx.tpl.name }] };
      var r = a.value;
      if (!r) return { status: 'info', title: title, body: '' };
      var sev = { critical: ['FIX', 'fail'], minor: ['CHECK', 'warn'], copy: ['COPY', 'info'] };
      var rows = r.issues.map(function (i) {
        var s = sev[i.severity];
        return '<li class="ai"><span><strong>' + esc(i.title) + '</strong><br><span class="small">' + esc(i.detail) + '</span>' + (i.fix ? '<br><span class="small mono t-ok">Fix: ' + esc(i.fix) + '</span>' : '') + '</span><span class="mono t-' + s[1] + '">' + s[0] + '</span></li>';
      }).join('');
      var crit = r.issues.filter(function (i) { return i.severity === 'critical'; }).length;
      return {
        status: crit ? 'fail' : r.issues.length ? 'warn' : 'ok', title: title, say: ctx.tpl.name + ': ' + (r.summary || (r.issues.length + ' suggestions from the AI review.')),
        body: (r.summary ? verdict(r.summary) : '') + (rows ? '<ul class="check">' + rows + '</ul>' : '<p class="muted">No extra issues found.</p>'),
        foot: a.sample ? 'Saved example for the sample template. Add your Claude key in Settings to review your own emails.' : 'Claude (' + r.model + ') · adds to the rule checks, doesn\'t repeat them' + (r.truncated ? ' · HTML truncated to 60K characters' : ''),
        actions: a.sample ? [{ label: 'Add key in Settings', settings: true }] : null
      };
    }
  };

  cat['eml-headers'] = {
    title: 'Message headers', needs: 'eml', size: 'L',
    render: function (ctx) {
      var e = ctx.eml;
      if (!e) return { status: 'empty', body: '<p class="muted">Drop the .eml file on the page again. Raw messages aren\'t saved, since they contain addresses.</p>', actions: [{ label: 'Upload .eml', upload: true }] };
      var bad = e.checks.filter(function (c) { return c.level === 'fix'; }).length;
      var warn = e.checks.filter(function (c) { return c.level === 'check'; }).length;
      var rows = e.checks.map(function (c) { return '<li><span><strong>' + esc(c.name) + '</strong><br><span class="small">' + esc(c.text) + '</span></span><span class="mono t-' + TONE[c.level] + '">' + LABEL[c.level] + '</span></li>'; }).join('');
      var facts = [
        ['Subject', e.subject], ['From', (e.from.name ? e.from.name + ' ' : '') + '<' + e.from.email + '>'], ['Return-Path', e.returnPath.email],
        ['DKIM', e.dkim.map(function (k) { return 'd=' + k.d + ' s=' + k.s; }).join(', ') || 'none'], ['List-Unsubscribe', e.listUnsub || 'none'], ['Feedback-ID', e.feedbackId || 'none'], ['Received hops', String(e.received)]
      ];
      var v = bad ? bad + ' header problem' + (bad > 1 ? 's' : '') + ' to fix.' : warn ? 'No blockers. ' + warn + ' to check.' : 'Headers look right for bulk sending.';
      return {
        status: bad ? 'fail' : warn ? 'warn' : 'ok', title: 'Headers · ' + (e.subject || 'message'), say: (e.subject || 'Message') + ': ' + v,
        body: verdict(v) + '<ul class="check">' + rows + '</ul>' +
          '<div class="tbl-wrap"><table class="tbl"><tbody>' + facts.map(function (f) { return '<tr><td class="muted">' + esc(f[0]) + '</td><td>' + esc(short(f[1], 90)) + '</td></tr>'; }).join('') + '</tbody></table></div>',
        actions: [e.from.domain ? { label: 'Check ' + e.from.domain + ' DNS', cmd: 'check ' + e.from.domain } : null, e.tplName ? { label: 'QA the HTML part', cmd: 'qa ' + e.tplName } : null].filter(Boolean),
        foot: 'From the raw message. Not saved after you close the tab.'
      };
    }
  };

  cat.klaviyo = {
    title: 'Klaviyo templates', needs: 'klaviyo', size: 'L',
    render: function (ctx) {
      var k = ctx.kl || {};
      var setup = '<ol class="steps-s"><li>Download mailprompt (Code → Download ZIP) and open a terminal in that folder.</li>' +
        '<li>Run <span class="mono">node connector/klaviyo-connect.js</span> and paste a Klaviyo private key with <span class="mono">templates:read</span>.</li>' +
        '<li>Type the pairing code it shows: <span class="mono">connect klaviyo XXXX-XXXX</span></li></ol>';
      if (!MP.klaviyo.paired()) return { status: 'info', body: verdict('Connect Klaviyo in three steps. Your key stays on your computer.') + setup, foot: 'Needs Node 18 or newer. The connector only reads templates.' };
      if (k.pending) return { status: 'loading', body: '<p class="muted loading-dots">Loading your Klaviyo templates</p>' };
      if (k.error) return { status: 'fail', body: verdict(k.error.message) + setup, actions: [{ label: 'Try again', cmd: 'klaviyo templates' }] };
      var t = k.value || [];
      if (!t.length) return { status: 'info', body: verdict('Connected, but this Klaviyo account has no templates.') };
      var rows = t.map(function (x) {
        return '<li class="lib"><span class="lib-n">' + esc(x.name) + '<span class="muted small mono"> · ' + esc((x.editor_type || '').toLowerCase().replace(/_/g, ' ')) + (x.updated ? ' · ' + esc(when(Date.parse(x.updated))) : '') + '</span></span>' +
          '<span class="lib-a"><button type="button" class="btn ghost" data-import="' + esc(x.id) + '">Import + QA</button></span></li>';
      }).join('');
      return { status: 'ok', say: 'Found ' + t.length + ' Klaviyo template' + (t.length > 1 ? 's' : '') + '. Import one to run the checks.', body: '<ul class="check libs">' + rows + '</ul>', foot: t.length + ' templates · read-only' };
    }
  };

  MP.tiles.types = Object.keys(cat);
  MP.tiles.darkify = darkify;
})(window.MP = window.MP || {});
