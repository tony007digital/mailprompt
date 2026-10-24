/* mailprompt AI review (formerly Email QA Copilot).
   Optional. Sends one template's HTML, plus what the rule checks already
   found, to Claude with your own API key. Claude adds what rules can't judge:
   copy, CTA clarity, tone, layout risk, accessibility of the content. */
(function (MP) {
  'use strict';

  var MAX_HTML = 60000;

  function review(template, qa, settings) {
    var html = template.html.length > MAX_HTML ? template.html.slice(0, MAX_HTML) : template.html;
    var truncated = template.html.length > MAX_HTML;
    var found = qa.items.filter(function (i) { return i.level !== 'ok'; }).map(function (i) { return '- [' + i.level + '] ' + i.text; }).join('\n') || '- nothing';
    var prompt = [
      'You are an email QA specialist reviewing production HTML email code before send.',
      'Automated rule checks already found these issues. Do not repeat them:',
      found,
      '',
      'Add what rules can\'t catch. Look for: weak or vague CTA text and what to write instead; spam-trigger language (FREE, ACT NOW, excessive caps or exclamation points); subject and preheader fit; layout that will break on mobile; content that fails accessibility (meaning carried only by images or color, low contrast, tiny text); confusing hierarchy; anything that contradicts itself (dates, prices, offers); personalization that reads badly when empty.',
      'Return ONLY valid JSON, no markdown, no preamble, in this exact structure:',
      '{"summary": "one sentence", "issues": [{"severity": "critical"|"minor"|"copy", "title": "short issue title", "detail": "specific explanation referencing the actual code or copy, max 2 sentences", "fix": "the exact change or replacement text, max 1 sentence"}]}',
      'Keep it to the 8 most important issues. If the email is solid, say so and return fewer issues.',
      truncated ? '(The HTML was truncated to the first ' + MAX_HTML + ' characters.)' : '',
      '',
      'HTML to analyze:',
      html
    ].join('\n');

    return fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': settings.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({ model: settings.reviewModel || 'claude-sonnet-5-5', max_tokens: 3000, messages: [{ role: 'user', content: prompt }] })
    }).then(function (res) {
      return res.json().then(function (j) {
        if (!res.ok) throw new Error((j && j.error && j.error.message) || ('Claude API error ' + res.status));
        return j;
      });
    }).then(function (j) {
      var text = (j.content || []).map(function (c) { return c.text || ''; }).join('');
      var m = text.replace(/```json|```/g, '').match(/\{[\s\S]*\}/);
      if (!m) throw new Error('Couldn\'t read Claude\'s answer as JSON.');
      var parsed = JSON.parse(m[0]);
      var issues = (Array.isArray(parsed.issues) ? parsed.issues : []).filter(function (i) { return i && i.title; }).slice(0, 12).map(function (i) {
        return { severity: /^(critical|minor|copy)$/.test(i.severity) ? i.severity : 'minor', title: String(i.title).slice(0, 200), detail: String(i.detail || '').slice(0, 600), fix: String(i.fix || '').slice(0, 400) };
      });
      return { summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 300) : '', issues: issues, truncated: truncated, model: settings.reviewModel || 'claude-sonnet-5-5' };
    });
  }

  MP.ai = { review: review };
})(window.MP = window.MP || {});
