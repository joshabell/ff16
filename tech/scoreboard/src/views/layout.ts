import { html } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';

export type Html = HtmlEscapedString | Promise<HtmlEscapedString>;

export interface LayoutOptions {
  title: string;
  body: Html | string;
  adminEmail?: string;
  flash?: string;
  errors?: string[];
}

export function layout({ title, body, adminEmail, flash, errors }: LayoutOptions): Html {
  const admin = adminEmail !== undefined;
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} – Frosty Fleet 16</title>
<link rel="icon" href="/logo.png">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Merriweather:ital,wght@0,400;0,700;1,400&family=Montserrat:wght@400;700&display=swap">
<link rel="stylesheet" href="/style.css">
${admin ? html`<meta name="robots" content="noindex">` : ''}
</head>
<body>
<div class="site${admin ? ' admin' : ''}">
<div class="site-inner">
<header class="site-header">
  <div class="site-branding">
    <p class="site-title"><a href="https://ff16.org/">Frosty Fleet 16</a></p>
    <p class="site-description">${admin ? 'Scoreboard · Race Committee' : 'Scoreboard'}</p>
  </div>
  <nav class="main-nav" aria-label="Scoreboard">
    ${admin
      ? html`<a href="/admin">Race days</a><a href="/admin/racers">Racers</a><a href="/admin/audit">Change log</a><a href="/">Public standings</a>`
      : html`<a href="/">Standings</a><a href="/schedule">Schedule</a><a href="https://ff16.org/">ff16.org</a>`}
  </nav>
  ${admin ? html`<div class="who">Signed in as ${adminEmail}</div>` : ''}
</header>
<main class="site-main">
${flash ? html`<div class="flash" role="status">${flash}</div>` : ''}
${errors && errors.length ? html`<div class="errors" role="alert"><ul>${errors.map((e) => html`<li>${e}</li>`)}</ul></div>` : ''}
${body}
</main>
<footer class="site-footer">
  <div class="site-info"><a href="https://ff16.org/">Frosty Fleet 16</a> · Beverly, Massachusetts · High-point scoring per the Notice of Race</div>
</footer>
</div>
</div>
</body>
</html>`;
}

// ---------- formatting helpers ----------

export function fmtDate(iso: string, opts: { year?: boolean } = {}): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(opts.year === false ? {} : { year: 'numeric' }),
  });
}

export function fmtShortDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
}

export function fmtTime(hhmm: string | null): string {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Today's date in Massachusetts as YYYY-MM-DD. */
export function todayISO(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}
