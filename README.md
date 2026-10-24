# mailprompt

**See what you want about your email sending. Skip the platform menus.**

mailprompt is a prompt box for email engineers, developers and marketers. Type what you want to see in plain words. It builds the view from your DNS, your sending logs and your email HTML as tiles you can resize, rearrange and save.

![mailprompt demo](media/mailprompt-demo.gif)

**Try it now, no install:** [sending log demo](https://tony007digital.github.io/mailprompt/?demo) · [QA a sample email](https://tony007digital.github.io/mailprompt/?q=sample%20template)

**Watch the 80-second walkthrough:** [media/mailprompt-demo.mp4](media/mailprompt-demo.mp4)

---

## Why

Every email platform has its own UI. On a normal morning an email engineer opens the ESP dashboard, the MTA logs, a DNS checker, Postmaster Tools and a blocklist site, just to answer *"did anything break overnight?"*

mailprompt flips that. You describe the answer you want, once:

```
show me overnight deferrals, bounces, queue depth per VMTA, and the SPF and DMARC
for news.mybrand.com. Make queues big.
```

It builds that view, tells you in one sentence what needs attention, and lets you save it as your *Morning* view.

- **Better:** the screen matches your workflow, not a vendor's menus. Engineers and marketers build different views from the same box.
- **Faster:** one sentence instead of five tabs. Verdict first, evidence underneath.
- **Saves money:** free and MIT licensed. Runs entirely in your browser, so there's no server to host, no account and no per-seat pricing.

## Run it in 30 seconds

You don't need to install anything. Pick one:

1. **Online:** open [tony007digital.github.io/mailprompt](https://tony007digital.github.io/mailprompt/) and type `demo`.
2. **Offline:** click **Code → Download ZIP**, unzip, and double-click `index.html`.
3. **Clone:**
   ```bash
   git clone https://github.com/tony007digital/mailprompt.git
   cd mailprompt
   open index.html        # Windows: start index.html   Linux: xdg-open index.html
   ```

No build step, no dependencies, no `npm install`.

## What you can ask

| You type | You get |
|---|---|
| `demo` | A fictional bakery's overnight sends (PowerMTA-style log), so you can try everything |
| `check yourdomain.com` | Live SPF, DKIM, DMARC, MX, BIMI, MTA-STS and a bulk-sender readiness check |
| `spf` / `dmarc` / `mx yourdomain.com` | Just that record |
| `dkim s1 yourdomain.com` | DKIM at a specific selector (24 common selectors are checked by default) |
| `show deferrals by provider` | Deferrals grouped by Gmail, Yahoo, Microsoft, Apple, other, with the top code |
| `show bounces` | Bounce reasons: bad address, blocklisted, mailbox full, policy, DNS |
| `show queues` | What's still waiting per VMTA or pool, and how old it is |
| `timeline`, `top codes`, `by campaign` | Hourly chart, top SMTP responses, per-campaign results |
| `why did jane@example.com bounce?` | A full trace for one address with a plain-English verdict |
| `make queues big`, `hide codes` | Resize or remove tiles by asking. You can also drag them and use the size button. |
| `save view as Morning`, `open Morning` | Save and reopen your layout |
| `help` | All of the above, as tap-to-run chips |

Several requests in one sentence work too. Tiles show up in the order you mention them.

## For email developers

Paste your email HTML straight into the prompt box, or drop an `.html` or `.eml` file anywhere on the page. mailprompt saves it as a template and runs the checks right away, in your browser.

| You type | You get |
|---|---|
| `sample template` | A sample promo email with typical mistakes left in, so you can see what gets caught |
| *(paste HTML)* or `paste html` | A QA report: Gmail clipping (~102KB), broken and placeholder links, UTMs, link shorteners, alt text, image widths, unsubscribe link, preheader, viewport, `lang`, `role="presentation"`, fixed-width layouts, spammy copy |
| `merge tags` | Every tag found, mixed syntax across platforms (Liquid/Handlebars, AMPscript, Mailchimp), unbalanced tags, personal fields with no fallback |
| `outlook` or `dark mode` | Code checks: unbalanced MSO conditionals, VML without its namespace, missing DPI fix, CSS classic Outlook ignores, background images without VML, color-scheme meta, dark mode styles, Outlook.com `[data-ogsc]` rules |
| `preview` | The email in a sandboxed frame with Desktop, Mobile and Dark buttons. Dark applies your own `prefers-color-scheme` styles, or simulates auto-invert if you have none |
| `links`, `images` | The detail tables |
| `templates`, `qa welcome email`, `show me the welcome template` | Your saved templates, by name |
| *(drop an .eml file)* | Header checks: one-click unsubscribe (List-Unsubscribe-Post), DKIM and SPF alignment with your From domain, the receiver's SPF/DKIM/DMARC results, plain-text part, Message-ID. The HTML part goes through the template checks too |
| `ai review` | Optional, with your Claude key: Claude reviews the template for what rules can't judge (CTA wording, tone, layout risk, confusing copy) and suggests exact fixes. This replaces the old Email QA Copilot |
| `klaviyo templates` | Your Klaviyo templates, one click to import and QA. See below |

These are code checks, not inbox renders. For pixel-accurate rendering in classic Outlook on Windows and other real clients, use Litmus or Email on Acid.

### Connect Klaviyo

Klaviyo private API keys must never go in a web page, so mailprompt comes with a small connector you run on your own computer. Your key stays in that terminal.

1. In Klaviyo, create a private API key with **Templates: Read** (Settings → API keys).
2. Download mailprompt (Code → Download ZIP), open a terminal in the folder and run:
   ```bash
   node connector/klaviyo-connect.js
   ```
   Paste the key when asked. You need Node 18 or newer, and nothing to install.
3. In mailprompt, type the pairing code it prints: `connect klaviyo 9F2A-71C3`, then `klaviyo templates`.

The connector listens only on `127.0.0.1:8787`, only reads templates, and only answers requests that carry the pairing code. It accepts requests from the hosted mailprompt and from a downloaded copy (`file://`). Add other origins with `MAILPROMPT_ORIGINS=https://your.site`. Your browser may ask permission for the page to reach your local network: allow it.

## Use your own data

**DNS** for any real domain is looked up live from your browser over DNS-over-HTTPS (Cloudflare, with Google as a fallback). DMARC p=none and missing records come with a **Copy fix** button that hands you a corrected record.

**Sending logs:** drop a CSV anywhere on the page, or click **Load CSV**.

- PowerMTA accounting files work as-is.
- ESP event and bounce exports usually work too. Columns are matched by name, not position: `rcpt` / `email` / `recipient`, `type` / `event` / `status`, `dsnStatus` / `reason` / `response`, `dsnMta`, `vmta` / `pool`, `jobId` / `campaign`, `timeLogged` / `timestamp`.
- Try it with the sample file in [`samples/pmta-accounting-sample.csv`](samples/pmta-accounting-sample.csv).

If your export doesn't load, [open an issue](https://github.com/tony007digital/mailprompt/issues) with its header row. Don't include addresses.

## Privacy

- There is no mailprompt server. CSV, HTML and .eml files are read in your browser and never uploaded.
- DNS lookups go to Cloudflare's or Google's public DNS-over-HTTPS resolvers.
- Saved views and templates are stored in your browser's local storage. Raw .eml messages aren't saved.
- If you add a Claude key (below), it's stored in your browser and sent only to `api.anthropic.com`. Questions send your words and summary numbers, never your log file. AI review sends the one template you ask it to review.
- The Klaviyo connector keeps your Klaviyo key on your computer.

## Optional: ask in your own words

Without a key, mailprompt understands the commands above. Add a [Claude API key](https://console.anthropic.com/) under **Settings** and it also handles anything else, like *"what should I fix first?"*. Claude picks tiles from the same fixed catalog, so it can't invent layouts or numbers. The default model is `claude-haiku-5-5`, and you can change it in Settings.

## How it works

```
index.html         the page
style.css          light and dark themes
js/agent.js        turns what you type into a plan of tiles (rules first, Claude optional)
js/tiles.js        the tile catalog: every view the agent can show
js/dns.js          SPF / DKIM / DMARC / MX / BIMI / MTA-STS checks over DNS-over-HTTPS
js/logs.js         CSV import, provider detection, bounce classification, queues, traces
js/demo-data.js    the fictional demo log and demo DNS records (.example domains)
js/templates.js    the template library (local storage)
js/html-qa.js      HTML email checks: size, links, images, preheader, a11y, merge tags, Outlook, dark mode
js/eml.js          .eml header and MIME parsing
js/tiles-dev.js    developer tiles: QA, links, images, merge tags, Outlook & dark, preview, headers, Klaviyo
js/ai-review.js    optional Claude review of one template
js/klaviyo.js      talks to the local Klaviyo connector
js/app.js          layout, drag to reorder, sizes, saved views
connector/         klaviyo-connect.js, the local read-only Klaviyo connector
```

Adding a view means adding one entry to `js/tiles.js` and a keyword to `js/agent.js`.

## Roadmap

- More connectors: SendGrid, Mailgun, SES, Braze, Salesforce Marketing Cloud and live PowerMTA (Klaviyo is done)
- Live link checking (404s and redirects) through the local connector
- Scheduled views: your Morning view delivered by email or Slack at 8 AM
- An MCP server, so Claude and other agents can use the same tiles
- Approved actions: throttle a queue, suppress an address, publish a DNS fix, each with a confirm step
- More tiles: Gmail Postmaster data, blocklist checks

Ideas and pull requests are welcome.

## License

MIT © 2026 Tony Lucio. See [LICENSE](LICENSE).

Built by [Tony Lucio](https://github.com/tony007digital), email engineer.
