/* mailprompt agent.
   Turns what you type into a plan: which tiles to show, plus layout actions.
   Plain commands are handled right here in the browser, no AI needed.
   If you add a Claude API key, anything the rules don't understand is sent to
   Claude, which picks tiles from the same catalog. Only your question and
   summary numbers are sent, never your log file. */
(function (MP) {
  'use strict';

  var LOG_KEYWORDS = [
    [/defer|throttl|\b4\d\d\b|\b4xx\b|tss04|backoff|rate.?limit/, 'deferrals'],
    [/bounce|\b5\d\d\b|\b5xx\b|bad address|invalid address|hard fail/, 'bounces'],
    [/provider|\bisps?\b|by mailbox|gmail|yahoo|outlook|microsoft|hotmail|icloud|apple mail|delivery rate|deliverability/, 'providers'],
    [/queue|vmta|\bpools?\b|sending ips?|\bips?\b|stuck|waiting/, 'queues'],
    [/timeline|per hour|hourly|over time|trend|chart/, 'timeline'],
    [/\bcodes?\b|smtp responses?|responses/, 'codes'],
    [/campaign|\bjobs?\b/, 'campaigns'],
    [/complain|spam rate|\bfbl\b|feedback loop|abuse/, 'complaints'],
    [/summary|overview|health|how (did|are|is)|status|morning|overnight|today|yesterday/, 'summary']
  ];

  var TARGETS = [
    [/queues?|vmta/, 'queues'], [/deferrals?/, 'deferrals'], [/bounces?/, 'bounces'], [/providers?/, 'providers'],
    [/timeline/, 'timeline'], [/codes?/, 'codes'], [/campaigns?/, 'campaigns'], [/complaints?/, 'complaints'],
    [/summary/, 'summary'], [/trace/, 'trace'], [/readiness/, 'dns-readiness'], [/spf/, 'dns-spf'],
    [/dkim/, 'dns-dkim'], [/dmarc/, 'dns-dmarc'], [/\bmx\b/, 'dns-mx'], [/bimi|mta-?sts|extras/, 'dns-extras'], [/help/, 'help']
  ];

  var SIZE_WORDS = { big: 'L', bigger: 'L', large: 'L', larger: 'L', wide: 'L', full: 'L', huge: 'L', small: 'S', smaller: 'S', tiny: 'S', compact: 'S', medium: 'M', normal: 'M' };

  var EMAIL_RE = /[a-z0-9._%+'-]+@(?:[a-z0-9-]+\.)+[a-z]{2,}/gi;
  var DOMAIN_RE = /\b((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})\b/gi;

  function target(word) {
    for (var i = 0; i < TARGETS.length; i++) if (TARGETS[i][0].test(word)) return TARGETS[i][1];
    return null;
  }

  function dnsTiles(domain, low, selector) {
    var picks = [];
    var p = { domain: domain };
    if (/\bspf\b/.test(low)) picks.push({ type: 'dns-spf', params: p });
    if (/\bdkim\b/.test(low)) picks.push({ type: 'dns-dkim', params: selector ? { domain: domain, selectors: [selector] } : p });
    if (/\bdmarc\b/.test(low)) picks.push({ type: 'dns-dmarc', params: p });
    if (/\bmx\b/.test(low)) picks.push({ type: 'dns-mx', params: p });
    if (/bimi|mta-?sts|tls-?rpt/.test(low)) picks.push({ type: 'dns-extras', params: p });
    if (picks.length) return picks;
    return [
      { type: 'dns-readiness', params: p, size: 'M' },
      { type: 'dns-spf', params: p }, { type: 'dns-dkim', params: selector ? { domain: domain, selectors: [selector] } : p },
      { type: 'dns-dmarc', params: p }, { type: 'dns-mx', params: p }, { type: 'dns-extras', params: p }
    ];
  }

  function route(text, ctx) {
    var t = String(text || '').trim();
    var low = t.toLowerCase();
    var plan = { tiles: [], ops: [], say: null, understood: true };
    if (!t) { plan.understood = false; return plan; }
    var m;

    if (/^(help|\?|commands|what can (i|you) (ask|do|say)\??)$/.test(low)) { plan.tiles.push({ type: 'help' }); plan.say = 'Here\'s what I understand. Tap one to try it.'; return plan; }
    if (/^(clear|reset|clear all|start over|close all)$/.test(low)) { plan.ops.push({ op: 'clear' }); return plan; }
    if ((m = t.match(/^save(?: this)?(?: view| layout)?(?: as)?\s+(.+)$/i))) { plan.ops.push({ op: 'save', name: m[1].replace(/["']/g, '').trim() }); return plan; }
    if ((m = t.match(/^(?:delete|remove)\s+view\s+(.+)$/i))) { plan.ops.push({ op: 'deleteView', name: m[1].trim() }); return plan; }
    if (/^(load |use |try |run |show )?(the |me the |a )?(demo|sample)( data| log| mode)?$/.test(low)) { plan.ops.push({ op: 'demo' }); return plan; }
    if ((m = t.match(/^(?:open|load|go to)(?: view| my)?\s+(.+?)(?: view)?$/i))) {
      var vn = ctx.viewNamed(m[1].trim());
      if (vn) plan.ops.push({ op: 'open', name: vn });
      else plan.say = 'No saved view named "' + m[1].trim() + '". Set up the tiles you want, then type: save view as ' + m[1].trim();
      return plan;
    }
    if ((m = t.match(/^show(?: view| my)?\s+(.+?)(?: view)?$/i)) && ctx.viewNamed(m[1].trim())) { plan.ops.push({ op: 'open', name: ctx.viewNamed(m[1].trim()) }); return plan; }

    // Layout: "make queues big", "hide blocklists", "shrink codes"
    var sizeRe = /(?:make|set|resize|turn)\s+(?:the\s+|my\s+)?([a-z\- ]+?)\s+(?:tiles?\s+)?(?:to\s+|into\s+)?(big|bigger|large|larger|wide|full|huge|small|smaller|tiny|compact|medium|normal)\b/g;
    while ((m = sizeRe.exec(low))) { var tg = target(m[1]); if (tg) plan.ops.push({ op: 'size', target: tg, size: SIZE_WORDS[m[2]] }); }
    var growRe = /\b(enlarge|expand|widen|grow|shrink|minimi[sz]e)\s+(?:the\s+)?([a-z\-]+)/g;
    while ((m = growRe.exec(low))) { var tg2 = target(m[2]); if (tg2) plan.ops.push({ op: 'size', target: tg2, size: /shrink|minimi/.test(m[1]) ? 'S' : 'L' }); }
    var hideRe = /\b(?:hide|remove|close|drop)\s+(?:the\s+)?([a-z\-]+)/g;
    while ((m = hideRe.exec(low))) { var tg3 = target(m[1]); if (tg3) plan.ops.push({ op: 'remove', target: tg3 }); }
    var layoutOnly = plan.ops.length && !/\b(show|check|add|and|,)\b/.test(low.replace(sizeRe, '').replace(hideRe, '').replace(growRe, ''));
    if (layoutOnly) return plan;

    // Strip layout phrases before looking for content.
    var content = low.replace(sizeRe, ' ').replace(growRe, ' ').replace(hideRe, ' ');

    // Email address: trace it.
    var emails = t.match(EMAIL_RE) || [];
    var noEmails = content.replace(EMAIL_RE, ' ');
    if (emails.length) {
      emails.forEach(function (e) { plan.tiles.push({ type: 'trace', params: { email: e.toLowerCase() }, size: 'L' }); });
      if (!/,| and /.test(noEmails)) return plan;
    }

    // Domain: DNS checks.
    var domains = [];
    (noEmails.match(DOMAIN_RE) || []).forEach(function (d) {
      d = d.toLowerCase();
      if (!/\.(csv|txt|log|json|html?|js)$/.test(d) && domains.indexOf(d) === -1) domains.push(d);
    });
    var selector = null;
    if ((m = noEmails.match(/\bdkim\s+(?:selector\s+)?([a-z0-9_-]+)\s+(?:for\s+|on\s+)?(?:[a-z0-9-]+\.)+[a-z]{2,}/)) && !/\./.test(m[1])) selector = m[1];
    if ((m = noEmails.match(/\bselector\s+([a-z0-9_-]+)/))) selector = m[1];
    var DNS_WORD = { 'dns-spf': /\bspf\b/, 'dns-dkim': /\bdkim\b/, 'dns-dmarc': /\bdmarc\b/, 'dns-mx': /\bmx\b/, 'dns-extras': /bimi|mta-?sts|tls-?rpt/ };
    domains.forEach(function (d) {
      var at = noEmails.indexOf(d);
      dnsTiles(d, noEmails, selector).forEach(function (x) {
        var w = DNS_WORD[x.type] && noEmails.search(DNS_WORD[x.type]);
        x.pos = w > -1 ? w : at;
        plan.tiles.push(x);
      });
    });

    // Log keywords. Blank out domains first (same length, so positions hold)
    // so "yahoo.example" doesn't mean "providers".
    function blank(s) { return s.replace(/[^ ]/g, ' '); }
    var words = noEmails.replace(DOMAIN_RE, blank).replace(/\bby (mailbox )?(provider|isp)s?\b/g, blank);
    if (domains.length) words = words.replace(/\b(spf|dkim|dmarc|mx|bimi|check|dns)\b/g, blank);
    var seen = {};
    LOG_KEYWORDS.forEach(function (k) {
      var hit = words.search(k[0]);
      if (hit > -1 && !seen[k[1]]) { seen[k[1]] = true; plan.tiles.push({ type: k[1], pos: hit }); }
    });

    // Show tiles in the order you mentioned them.
    plan.tiles.forEach(function (x, i) { x._i = i; });
    plan.tiles.sort(function (a, b) { return ((a.pos == null ? 1e9 : a.pos) - (b.pos == null ? 1e9 : b.pos)) || (a._i - b._i); });
    plan.tiles.forEach(function (x) { delete x.pos; delete x._i; });

    if (!plan.tiles.length && !plan.ops.length) plan.understood = false;
    return plan;
  }

  // ---------- Optional: Claude ----------
  function catalogText() {
    var c = MP.tiles.catalog;
    return Object.keys(c).map(function (k) {
      var extra = k === 'trace' ? ' params: {"email": "<address>"}' : /^dns-/.test(k) ? ' params: {"domain": "<domain>"}' + (k === 'dns-dkim' ? ' optional "selectors": ["s1"]' : '') : '';
      return '- ' + k + ': ' + c[k].title + (c[k].needs === 'log' ? ' (needs a sending log)' : '') + extra;
    }).join('\n');
  }

  function stateText(ctx) {
    var lines = [];
    if (ctx.data) {
      var s = ctx.data.summary();
      lines.push('A sending log is loaded: ' + s.messages + ' messages, ' + s.deliveredPct.toFixed(1) + '% delivered, ' + s.bouncedPct.toFixed(1) + '% bounced, ' + s.queued + ' still retrying, complaint rate ' + s.complaintPct.toFixed(2) + '%.');
      var d = ctx.data.deferrals();
      if (d.total) lines.push('Deferrals: ' + d.total + ' total. ' + d.providers.slice(0, 3).map(function (p) { return p.provider + ' ' + p.count + ' (' + (p.topCode || '') + (p.topQueue ? ', mostly ' + p.topQueue : '') + ')'; }).join('; ') + '.');
      var b = ctx.data.bounces();
      if (b.total) lines.push('Bounces: ' + b.types.map(function (x) { return x.type + ' ' + x.count; }).join('; ') + '.');
      lines.push('Insights: ' + ctx.data.insights().map(function (i) { return i.text; }).join(' '));
    } else {
      lines.push('No sending log is loaded. The user can type "demo" or upload a CSV.');
    }
    if (ctx.tiles.length) lines.push('Tiles on screen: ' + ctx.tiles.map(function (x) { return x.type + (x.params && (x.params.domain || x.params.email) ? '(' + (x.params.domain || x.params.email) + ')' : ''); }).join(', ') + '.');
    return lines.join('\n');
  }

  function askClaude(text, ctx, settings) {
    var system = [
      'You are mailprompt, an assistant for email engineers and marketers.',
      'You answer by choosing tiles from a fixed catalog. You never invent layouts or numbers.',
      'Reply with JSON only, no prose around it:',
      '{"say": "<one short, direct sentence>", "tiles": [{"type": "<type>", "size": "S|M|L", "params": {}}], "ops": []}',
      'Ops you may use: {"op":"demo"} loads the demo log; {"op":"clear"}; {"op":"size","target":"<tile type>","size":"S|M|L"}; {"op":"remove","target":"<tile type>"}; {"op":"save","name":"<view name>"}.',
      'Tile catalog:', catalogText(),
      'Current state:', stateText(ctx),
      'If the answer is in the state above, give it in "say" and include the tile that shows it.',
      'If the request needs a log and none is loaded, say so and suggest the demo or an upload.',
      'If the request is outside email sending, DNS or deliverability, say what you can help with instead.'
    ].join('\n');
    return fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': settings.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({ model: settings.model || 'claude-haiku-5-5', max_tokens: 700, system: system, messages: [{ role: 'user', content: text }] })
    }).then(function (res) {
      return res.json().then(function (j) {
        if (!res.ok) throw new Error((j && j.error && j.error.message) || ('Claude API error ' + res.status));
        return j;
      });
    }).then(function (j) {
      var out = (j.content || []).map(function (c) { return c.text || ''; }).join('');
      var m = out.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('Claude didn\'t return a plan.');
      var plan = JSON.parse(m[0]);
      return sanitize(plan);
    });
  }

  function sanitize(plan) {
    var cat = MP.tiles.catalog;
    var tiles = (plan.tiles || []).filter(function (x) {
      if (!x || !cat[x.type]) return false;
      x.params = x.params || {};
      if (x.type === 'trace' && !x.params.email) return false;
      if (/^dns-/.test(x.type) && !x.params.domain) return false;
      if (x.size && !/^[SML]$/.test(x.size)) delete x.size;
      return true;
    });
    var ops = (plan.ops || []).filter(function (o) {
      return o && /^(demo|clear|size|remove|save)$/.test(o.op) && (o.op !== 'size' || (cat[o.target] && /^[SML]$/.test(o.size))) && (o.op !== 'remove' || cat[o.target]) && (o.op !== 'save' || (typeof o.name === 'string' && o.name.trim()));
    });
    return { say: typeof plan.say === 'string' ? plan.say.slice(0, 300) : null, tiles: tiles, ops: ops, understood: true, viaClaude: true };
  }

  MP.agent = { route: route, askClaude: askClaude };
})(window.MP = window.MP || {});
