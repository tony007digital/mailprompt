/* mailprompt tile library.
   The agent never invents layouts. It picks tiles from this catalog and fills
   them with your data, so answers stay consistent and checkable. */
(function (MP) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function n(x) { return Number(x || 0).toLocaleString(); }
  function p1(x) { return (x || 0).toFixed(1) + '%'; }
  function p2(x) { return (x || 0).toFixed(2) + '%'; }
  function when(t) {
    if (!t) return '';
    return new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function clock(t) { return t ? new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''; }
  function dur(ms) {
    var m = Math.round(ms / 60000);
    return m < 60 ? m + ' min' : Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
  }
  function btn(label, cmd) { return { label: label, cmd: cmd }; }
  function stat(value, label, tone) {
    return '<div class="stat"><span class="stat-v' + (tone ? ' t-' + tone : '') + '">' + esc(value) + '</span><span class="stat-l">' + esc(label) + '</span></div>';
  }
  function bar(label, value, max, right, tone) {
    var w = max ? Math.max(value ? 1.5 : 0, Math.round((value / max) * 100)) : 0;
    return '<div class="bar"><div class="bar-top"><span class="mono">' + esc(label) + '</span><span class="mono' + (tone ? ' t-' + tone : '') + '">' + esc(right) + '</span></div>' +
      '<div class="bar-track" aria-hidden="true"><div class="bar-fill' + (tone ? ' f-' + tone : '') + '" style="width:' + w + '%"></div></div></div>';
  }
  function table(cols, rows) {
    var h = '<div class="tbl-wrap"><table class="tbl"><thead><tr>' + cols.map(function (c) {
      return '<th scope="col"' + (c.num ? ' class="num"' : '') + '>' + esc(c.label) + '</th>';
    }).join('') + '</tr></thead><tbody>';
    rows.forEach(function (r) {
      h += '<tr' + (r._tone ? ' class="row-' + r._tone + '"' : '') + '>' + cols.map(function (c) {
        var v = r[c.key];
        return '<td' + (c.num ? ' class="num"' : '') + '>' + (c.html ? v : esc(v)) + '</td>';
      }).join('') + '</tr>';
    });
    return h + '</tbody></table></div>';
  }
  function needLog() {
    return { status: 'empty', body: '<p class="muted">This tile needs a sending log.</p>', actions: [btn('Load demo log', 'demo'), { label: 'Upload CSV', upload: true }] };
  }
  function verdict(text) { return '<p class="verdict">' + esc(text) + '</p>'; }
  function record(rec) { return rec ? '<pre class="rec">' + esc(rec) + '</pre>' : ''; }
  function demoNote(d) { return d ? 'demo records' : 'live DNS'; }

  var catalog = {
    // ---------- Sending log tiles ----------
    summary: {
      title: 'Sending summary', needs: 'log', size: 'M',
      render: function (ctx) {
        var s = ctx.data.summary();
        var body = '<div class="stats">' +
          stat(n(s.messages), 'messages') +
          stat(p1(s.deliveredPct), 'delivered') +
          stat(p1(s.bouncedPct), 'bounced', s.bouncedPct > 2 ? 'warn' : null) +
          stat(n(s.queued), 'still retrying', s.queued ? 'warn' : null) +
          stat(p2(s.complaintPct), 'complaints', s.complaintPct >= 0.1 ? 'warn' : null) +
          '</div>' +
          '<ul class="check ins">' + ctx.data.insights().map(function (i) {
            return '<li><span>' + esc(i.text) + '</span><span class="mono t-' + (i.level === 'info' ? 'info' : i.level) + '">' + (i.level === 'warn' ? 'WATCH' : i.level === 'ok' ? 'OK' : 'NOTE') + '</span></li>';
          }).join('') + '</ul>';
        return { status: s.bouncedPct > 2 || s.complaintPct >= 0.1 ? 'warn' : 'ok', body: body, foot: when(s.start) + ' to ' + when(s.end) + ' · ' + n(s.events) + ' events' };
      }
    },

    providers: {
      title: 'Delivery by mailbox provider', needs: 'log', size: 'L',
      render: function (ctx) {
        var list = ctx.data.byProvider();
        var warn = list.filter(function (p) { return p.state === 'warn'; });
        var rows = list.map(function (p) {
          return {
            _tone: p.state === 'warn' ? 'warn' : null,
            provider: p.provider, messages: n(p.messages), delivered: p1(p.deliveredPct), deferrals: n(p.deferrals),
            bounced: p1(p.bouncedPct), complaints: p2(p.complaintPct), state: p.state === 'warn' ? 'WATCH' : 'OK'
          };
        });
        return {
          status: warn.length ? 'warn' : 'ok',
          body: (warn.length ? verdict(warn.map(function (p) { return p.provider; }).join(', ') + ' need' + (warn.length === 1 ? 's' : '') + ' attention.') : '') +
            table([
              { key: 'provider', label: 'Provider' }, { key: 'messages', label: 'Messages', num: true },
              { key: 'delivered', label: 'Delivered', num: true }, { key: 'deferrals', label: 'Deferrals', num: true },
              { key: 'bounced', label: 'Bounced', num: true }, { key: 'complaints', label: 'Complaints', num: true },
              { key: 'state', label: 'Status', num: true }
            ], rows),
          foot: 'Provider is detected from the MX host, then the recipient domain.'
        };
      }
    },

    deferrals: {
      title: 'Deferrals by provider', needs: 'log', size: 'M',
      render: function (ctx) {
        var d = ctx.data.deferrals();
        if (!d.total) return { status: 'ok', body: verdict('No deferrals in this log.') };
        var max = d.providers[0].count;
        var top = d.providers[0];
        var body = verdict(Math.round(top.share) + '% are ' + top.provider + (top.topQueue && top.topQueueShare >= 80 ? ', ' + Math.round(top.topQueueShare) + '% of those on ' + top.topQueue : '') + '.') +
          d.providers.map(function (p, i) {
            return bar(p.provider + (p.topCode ? '  ' + p.topCode : ''), p.count, max, n(p.count), i === 0 && p.share >= 50 ? 'warn' : null);
          }).join('');
        return {
          status: top.share >= 50 && d.total > 20 ? 'warn' : 'ok', body: body, foot: n(d.total) + ' deferral events',
          actions: top.topQueue ? [btn('Show queues', 'show queues'), btn('Top codes', 'show codes')] : [btn('Top codes', 'show codes')]
        };
      }
    },

    bounces: {
      title: 'Bounce reasons', needs: 'log', size: 'M',
      render: function (ctx) {
        var b = ctx.data.bounces();
        if (!b.total) return { status: 'ok', body: verdict('No bounces in this log.') };
        var max = b.types[0].count;
        var bl = b.types.some(function (t) { return t.type === 'Blocklisted'; });
        return {
          status: bl ? 'warn' : 'ok',
          body: b.types.map(function (t) {
            return bar(t.type, t.count, max, n(t.count) + ' · ' + Math.round(t.share) + '%', t.type === 'Blocklisted' ? 'warn' : null) +
              '<p class="ex mono">' + esc(t.example.slice(0, 140)) + '</p>';
          }).join(''),
          foot: n(b.total) + ' bounces · bad addresses are suppressed by most senders automatically'
        };
      }
    },

    queues: {
      title: 'Queues', needs: 'log', size: 'L',
      render: function (ctx) {
        var all = ctx.data.queues();
        var q = all.filter(function (x) { return x.queued; }).slice(0, 8);
        if (!q.length) return { status: 'ok', body: verdict('Nothing waiting. All ' + all.length + ' queues are clear.') };
        var clear = all.length - all.filter(function (x) { return x.queued; }).length;
        var max = q[0].queued || 1;
        var backoff = q.filter(function (x) { return x.state === 'backoff'; });
        return {
          status: backoff.length ? 'warn' : 'ok',
          body: (backoff.length ? verdict(backoff.map(function (x) { return x.queue + ' → ' + x.provider; }).join(', ') + ' in backoff.') : '') +
            q.map(function (x) {
              return bar(x.queue + ' → ' + x.provider, x.queued, max, n(x.queued) + ' waiting' + (x.oldestMin ? ' · oldest ' + dur(x.oldestMin * 60000) : '') + (x.state === 'backoff' ? ' · backoff' : ''), x.state === 'backoff' ? 'warn' : null);
            }).join(''),
          foot: (clear ? clear + ' other queue' + (clear > 1 ? 's' : '') + ' clear · ' : '') + 'waiting = deferred, not yet delivered or bounced'
        };
      }
    },

    codes: {
      title: 'Top SMTP codes', needs: 'log', size: 'M',
      render: function (ctx) {
        var c = ctx.data.codes().slice(0, 6);
        if (!c.length) return { status: 'ok', body: verdict('No 4xx or 5xx responses.') };
        return {
          status: 'info',
          body: table([
            { key: 'code', label: 'Code' }, { key: 'count', label: 'Count', num: true }, { key: 'who', label: 'Mostly' }
          ], c.map(function (x) { return { code: x.code, count: n(x.count), who: x.topProvider }; })) +
            '<p class="ex mono">' + esc((c[0].example || '').slice(0, 180)) + '</p>',
          foot: 'Example shown for the top code'
        };
      }
    },

    timeline: {
      title: 'Hourly timeline', needs: 'log', size: 'L',
      render: function (ctx) {
        var b = ctx.data.timeline().buckets;
        if (!b.length) return { status: 'info', body: verdict('This log has no timestamps.') };
        var max = 1;
        b.forEach(function (x) { max = Math.max(max, x.delivered + x.deferred + x.bounced); });
        var W = 600, H = 140, gap = 4, bw = Math.max(4, (W - gap * (b.length - 1)) / b.length);
        var svg = '<svg class="chart" viewBox="0 0 ' + W + ' ' + (H + 20) + '" role="img" aria-label="Delivered, deferred and bounced per hour">';
        b.forEach(function (x, i) {
          var X = i * (bw + gap), y = H;
          [['delivered', 'f-ok'], ['deferred', 'f-warn'], ['bounced', 'f-fail']].forEach(function (k) {
            var h = (x[k[0]] / max) * H;
            if (h > 0) { y -= h; svg += '<rect class="' + k[1] + '" x="' + X.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="1.5"></rect>'; }
          });
          if (i % Math.ceil(b.length / 8) === 0) svg += '<text x="' + (X + bw / 2).toFixed(1) + '" y="' + (H + 15) + '" text-anchor="middle">' + esc(new Date(x.t).toLocaleTimeString([], { hour: 'numeric' })) + '</text>';
        });
        svg += '</svg>';
        var legend = '<div class="legend"><span><i class="sw f-ok"></i>Delivered</span><span><i class="sw f-warn"></i>Deferred</span><span><i class="sw f-fail"></i>Bounced</span></div>';
        return { status: 'info', body: svg + legend, foot: 'Events per hour' };
      }
    },

    campaigns: {
      title: 'By campaign', needs: 'log', size: 'M',
      render: function (ctx) {
        var c = ctx.data.campaigns().slice(0, 8);
        return {
          status: 'info',
          body: table([
            { key: 'campaign', label: 'Campaign' }, { key: 'messages', label: 'Msgs', num: true },
            { key: 'delivered', label: 'Deliv.', num: true }, { key: 'queued', label: 'Retrying', num: true }, { key: 'bounced', label: 'Bounced', num: true }
          ], c.map(function (x) { return { campaign: x.campaign, messages: n(x.messages), delivered: p1(x.deliveredPct), queued: n(x.queued), bounced: p1(x.bouncedPct) }; }))
        };
      }
    },

    complaints: {
      title: 'Complaints', needs: 'log', size: 'S',
      render: function (ctx) {
        var s = ctx.data.summary();
        return {
          status: s.complaintPct >= 0.1 ? 'warn' : 'ok',
          body: '<div class="stats">' + stat(p2(s.complaintPct), 'of delivered', s.complaintPct >= 0.1 ? 'warn' : null) + stat(n(s.complaints), 'reports') + '</div>',
          foot: 'From feedback loops. Gmail doesn\'t send these; use Postmaster Tools.'
        };
      }
    },

    trace: {
      title: 'Trace', needs: 'log', size: 'L',
      render: function (ctx, params) {
        var email = params.email;
        var rows = ctx.data.trace(email);
        if (!rows.length) return { status: 'info', title: 'Trace · ' + email, body: verdict('No events for ' + email + ' in this log.') };
        var last = rows[rows.length - 1];
        var defs = rows.filter(function (r) { return r.event === 'deferred'; }).length;
        var v;
        if (last.event === 'bounced') v = 'Bounced: ' + last.bounceType.toLowerCase() + ' (' + [last.basic, last.code].filter(Boolean).join(' ') + '). ' + (last.bounceType === 'Bad address' ? 'It won\'t be retried. Suppress it.' : 'Check the response below.');
        else if (last.event === 'delivered') v = 'Delivered' + (defs ? ' after ' + defs + ' deferral' + (defs > 1 ? 's' : '') + ', ' + dur(last.time - rows[0].time) + ' after the first try.' : ' on the first try.');
        else if (last.event === 'complaint') v = 'Delivered, then the recipient marked it as spam.';
        else if (last.event === 'deferred') v = 'Still retrying: ' + defs + ' deferral' + (defs > 1 ? 's' : '') + ', last at ' + clock(last.time) + '.';
        else v = 'Last event: ' + last.event + '.';
        var body = verdict(v) + '<ol class="trace">' + rows.map(function (r) {
          return '<li class="ev ev-' + esc(r.event) + '"><span class="mono t">' + esc(clock(r.time)) + '</span>' +
            '<span class="tag tag-' + esc(r.event) + '">' + esc(r.event) + '</span>' +
            '<span class="mono d">' + esc(r.event === 'delivered' || r.event === 'complaint' ? [r.basic, r.code].filter(Boolean).join(' ') || r.diag : (/^[245]\d\d/.test(r.diag) ? r.diag : [r.basic, r.code].filter(Boolean).join(' ') + '  ' + r.diag)) + '</span>' +
            (r.queue || r.mx ? '<span class="mono s">' + esc([r.queue, r.mx].filter(Boolean).join(' · ')) + '</span>' : '') + '</li>';
        }).join('') + '</ol>';
        return { status: last.event === 'bounced' ? 'fail' : last.event === 'deferred' ? 'warn' : 'ok', title: 'Trace · ' + email, body: body, foot: rows.length + ' event' + (rows.length === 1 ? '' : 's'), say: email + ': ' + v };
      }
    },

    // ---------- DNS tiles ----------
    'dns-readiness': {
      title: 'Bulk sender readiness', needs: 'dns', size: 'M',
      render: function (ctx, params, r) {
        var items = [
          ['SPF valid', r.spf.status === 'ok' ? 'ok' : r.spf.status],
          ['DKIM key published', r.dkim.status === 'ok' ? 'ok' : r.dkim.keys && r.dkim.keys.length ? 'warn' : 'fail'],
          ['DMARC record', r.dmarc.record ? 'ok' : 'fail'],
          ['DMARC enforcing', r.dmarc.policy === 'quarantine' || r.dmarc.policy === 'reject' ? 'ok' : r.dmarc.record ? 'warn' : 'fail']
        ];
        var worst = items.some(function (i) { return i[1] === 'fail'; }) ? 'fail' : items.some(function (i) { return i[1] === 'warn'; }) ? 'warn' : 'ok';
        var label = { ok: 'PASS', warn: 'REVIEW', fail: 'FAIL', info: 'INFO' };
        return {
          status: worst, title: 'Bulk sender readiness · ' + params.domain,
          body: verdict(worst === 'ok' ? 'DNS meets the Gmail, Yahoo and Microsoft sender rules.' : worst === 'warn' ? 'Meets the minimum. Worth tightening.' : 'Missing something Gmail, Yahoo and Microsoft require.') +
            '<ul class="check">' + items.map(function (i) { return '<li><span>' + esc(i[0]) + '</span><span class="mono t-' + i[1] + '">' + label[i[1]] + '</span></li>'; }).join('') + '</ul>',
          foot: 'Also required, not visible in DNS: one-click unsubscribe and spam rate under 0.3%.'
        };
      }
    },

    'dns-spf': {
      title: 'SPF', needs: 'dns', size: 'S',
      render: function (ctx, params, r) {
        var s = r.spf;
        return { status: s.status, title: 'SPF · ' + params.domain, body: verdict(s.verdict) + record(s.record), copy: s.fix && s.status !== 'ok' ? s.fix : null, foot: demoNote(r.demo) };
      }
    },

    'dns-dkim': {
      title: 'DKIM', needs: 'dns', size: 'S',
      render: function (ctx, params, r) {
        var k = r.dkim;
        var list = (k.keys || []).map(function (x) {
          return '<li><span class="mono">' + esc(x.selector) + '._domainkey</span><span class="mono">' + esc(x.revoked ? 'revoked' : (x.bits ? x.bits + '-bit' : '?')) + '</span></li>';
        }).join('');
        return {
          status: k.status, title: 'DKIM · ' + params.domain,
          body: verdict(k.verdict) + (list ? '<ul class="check">' + list + '</ul>' : ''),
          actions: k.hint ? [{ label: 'Try a selector', fill: k.hint.replace('<selector>', '') }] : null,
          foot: demoNote(r.demo) + (k.custom ? '' : ' · ' + k.searched + ' common selectors checked')
        };
      }
    },

    'dns-dmarc': {
      title: 'DMARC', needs: 'dns', size: 'S',
      render: function (ctx, params, r) {
        var d = r.dmarc;
        return { status: d.status, title: 'DMARC · ' + params.domain, body: verdict(d.verdict) + record(d.record), copy: d.fix || null, copyLabel: d.record ? 'Copy stricter record' : 'Copy starter record', foot: demoNote(r.demo) };
      }
    },

    'dns-mx': {
      title: 'MX', needs: 'dns', size: 'S',
      render: function (ctx, params, r) {
        var m = r.mx;
        var list = (m.mx || []).slice(0, 4).map(function (x) { return '<li><span class="mono">' + esc(x.host) + '</span><span class="mono">' + esc(x.pref) + '</span></li>'; }).join('');
        return { status: m.status, title: 'MX · ' + params.domain, body: verdict(m.verdict) + (list ? '<ul class="check">' + list + '</ul>' : ''), foot: demoNote(r.demo) };
      }
    },

    'dns-extras': {
      title: 'BIMI, MTA-STS, TLS-RPT', needs: 'dns', size: 'S',
      render: function (ctx, params, r) {
        var e = r.extras;
        function row(name, rec) { return '<li><span>' + esc(name) + '</span><span class="mono ' + (rec ? 't-ok' : 'muted') + '">' + (rec ? 'SET' : 'NONE') + '</span></li>'; }
        return {
          status: 'info', title: 'Extras · ' + params.domain,
          body: verdict(e.verdict) + '<ul class="check">' + row('BIMI (logo in inbox)', e.bimi) + row('MTA-STS (forced TLS)', e.mtasts) + row('TLS-RPT (TLS reports)', e.tlsrpt) + '</ul>',
          foot: 'BIMI needs DMARC at quarantine or reject.'
        };
      }
    },

    // ---------- Help ----------
    help: {
      title: 'What you can ask', size: 'L',
      render: function () {
        var groups = [
          ['Start', ['demo', 'check yourdomain.com', 'help']],
          ['Sending log', ['show deferrals by provider', 'show bounces', 'show queues', 'timeline', 'top codes', 'by campaign', 'why did jane@yahoo.example bounce?']],
          ['DNS', ['spf yourdomain.com', 'dmarc yourdomain.com', 'dkim s1 yourdomain.com', 'mx yourdomain.com']],
          ['Your layout', ['make queues big', 'save view as Morning', 'open Morning', 'clear']]
        ];
        var body = groups.map(function (g) {
          return '<div class="help-g"><h3>' + esc(g[0]) + '</h3><div class="chips">' + g[1].map(function (c) {
            return '<button type="button" class="chip" data-fill="' + esc(c) + '">' + esc(c) + '</button>';
          }).join('') + '</div></div>';
        }).join('');
        return {
          status: 'info', body: '<p class="muted">Or describe a whole morning in one sentence: <span class="mono">show me deferrals by provider, bounces, queues and check yourdomain.com. Make queues big.</span></p>' + body,
          foot: 'Add a Claude API key in settings to ask in your own words.'
        };
      }
    }
  };

  MP.tiles = {
    catalog: catalog,
    esc: esc,
    types: Object.keys(catalog)
  };
})(window.MP = window.MP || {});
