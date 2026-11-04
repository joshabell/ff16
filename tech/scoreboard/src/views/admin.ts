import { html, raw } from 'hono/html';
import { VENUES, type AuditRow, type Race, type RaceDay, type Racer, type ResultRow, type Season } from '../db';
import { RESULT_CODES } from '../scoring';
import { fmtDate, fmtTime, type Html } from './layout';
import { dayChip, raceResultsTable, racerLabel, venueLabel } from './public';

const FEE_THRESHOLD = 3; // NoR §5: racers in 3 or more races pay $25

export function dashboardPage(
  season: Season,
  days: RaceDay[],
  today: string,
  racers: Racer[],
  racesSailed: Map<number, number>,
): Html {
  const upcoming = days.find((d) => d.date >= today && d.status !== 'bye');
  const feeDue = racers.filter((r) => (racesSailed.get(r.id) ?? 0) >= FEE_THRESHOLD);
  return html`
    <h1>${season.name} race days</h1>
    ${upcoming
      ? html`<div class="card">
          <strong>${upcoming.date === today ? 'Today' : 'Next up'}: ${fmtDate(upcoming.date)}</strong>
          ${upcoming.start_time ? ` · ${fmtTime(upcoming.start_time)}` : ''} ${dayChip(upcoming)}
          <div class="actions"><a class="btn" href="/admin/days/${upcoming.id}">Manage this race day</a></div>
        </div>`
      : ''}
    <div class="table-wrap">
      <table>
        <thead><tr><th>Date</th><th>Start</th><th>Venue</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${days.map(
            (d) => html`<tr${d.status === 'bye' && d.race_count === 0 ? html` class="row-bye"` : ''}>
              <td>${fmtDate(d.date)}</td>
              <td>${fmtTime(d.start_time)}</td>
              <td>${d.venue ?? ''}</td>
              <td>${dayChip(d)}${d.notes && d.race_count === 0 ? html`<div class="small muted">${d.notes}</div>` : ''}</td>
              <td><a href="/admin/days/${d.id}">Manage</a></td>
            </tr>`,
          )}
        </tbody>
      </table>
    </div>
    <div class="actions"><a class="btn secondary" href="/admin/days/new">Add a race day</a></div>

    <h2>Season fee</h2>
    <p class="small muted">Racers who take part in ${FEE_THRESHOLD} or more races pay $25 to the Treasurer (NoR §5).</p>
    ${feeDue.length
      ? html`<p>${feeDue.map((r, i) => html`${i ? ', ' : ''}<strong>${r.name}</strong> (${racesSailed.get(r.id)})`)}</p>`
      : html`<p class="muted">Nobody has reached ${FEE_THRESHOLD} races yet.</p>`}
  `;
}

function dayFields(day?: Partial<RaceDay>): Html {
  const status = day?.status ?? 'scheduled';
  return html`
    <label for="start_time">Start time</label>
    <input type="time" id="start_time" name="start_time" value="${day?.start_time ?? ''}">
    <label for="venue">Venue</label>
    <select id="venue" name="venue">
      <option value="">Not set</option>
      ${(Object.keys(VENUES) as (keyof typeof VENUES)[]).map(
        (v) => html`<option value="${v}"${day?.venue === v ? raw(' selected') : ''}>${v} · ${VENUES[v]}</option>`,
      )}
    </select>
    <label for="status">Status</label>
    <select id="status" name="status">
      ${(['scheduled', 'bye', 'cancelled'] as const).map(
        (s) => html`<option value="${s}"${status === s ? raw(' selected') : ''}>${{ scheduled: 'Scheduled', bye: 'BYE', cancelled: 'Cancelled' }[s]}</option>`,
      )}
    </select>
    <label for="notes">Notes</label>
    <textarea id="notes" name="notes">${day?.notes ?? ''}</textarea>`;
}

export function dayAdminPage(day: RaceDay, races: Race[], rows: ResultRow[], racers: Map<number, Racer>): Html {
  return html`
    <p class="small"><a href="/admin">← All race days</a></p>
    <h1>${fmtDate(day.date)}</h1>
    <p class="muted">${[fmtTime(day.start_time), venueLabel(day.venue)].filter(Boolean).join(' · ')} ${dayChip(day)}</p>

    <h2>Races</h2>
    ${races.length === 0 ? html`<p class="muted">No races entered yet.</p>` : ''}
    ${races.map(
      (race) => html`
        <div class="card">
          <h3 style="margin-top:0">Race ${race.race_number}</h3>
          ${raceResultsTable(race, rows.filter((r) => r.race_id === race.id), racers)}
          <div class="actions">
            <a class="btn secondary" href="/admin/races/${race.id}">Edit</a>
            <form class="inline" method="post" action="/admin/races/${race.id}/delete"
                  onsubmit="return confirm('Delete race ${race.race_number}? Later races are renumbered.')">
              <button class="danger" type="submit">Delete</button>
            </form>
            <span class="small muted">Last saved by ${race.updated_by ?? 'unknown'}, ${race.updated_at} UTC</span>
          </div>
        </div>`,
    )}
    <div class="actions"><a class="btn" href="/admin/days/${day.id}/races/new">Enter race ${races.length + 1}</a></div>

    <div class="grid2" style="margin-top:2rem">
      <form class="card stack" method="post" action="/admin/days/${day.id}">
        <h3 style="margin-top:0">Race day details</h3>
        ${dayFields(day)}
        <div class="actions"><button type="submit">Save details</button></div>
      </form>
      <form class="card stack" method="post" action="/admin/racers">
        <h3 style="margin-top:0">New racer today?</h3>
        <p class="small muted">Add them here before entering the race.</p>
        <input type="hidden" name="return" value="/admin/days/${day.id}">
        <label for="name">Name</label>
        <input type="text" id="name" name="name" required>
        <label for="sail_number">Sail number (optional)</label>
        <input type="text" id="sail_number" name="sail_number">
        <div class="actions"><button type="submit">Add racer</button></div>
      </form>
    </div>`;
}

export function dayNewPage(values: { date?: string } & Partial<RaceDay> = {}): Html {
  return html`
    <p class="small"><a href="/admin">← All race days</a></p>
    <h1>Add a race day</h1>
    <form class="card stack" method="post" action="/admin/days">
      <label for="date">Date</label>
      <input type="date" id="date" name="date" required value="${values.date ?? ''}">
      ${dayFields(values)}
      <div class="actions"><button type="submit">Add race day</button></div>
    </form>`;
}

export interface RaceFormOptions {
  day: RaceDay;
  race?: Race;
  racers: Racer[]; // racers to list, in display order
  values: Map<number, string>; // racerId -> '' | place | code
  notes: string;
}

export function raceFormPage({ day, race, racers, values, notes }: RaceFormOptions): Html {
  const title = race ? `Edit race ${race.race_number}` : `Enter race ${day.race_count + 1}`;
  const action = race ? `/admin/races/${race.id}` : `/admin/days/${day.id}/races`;
  const placeOptions = racers.map((_, i) => i + 1);
  return html`
    <p class="small"><a href="/admin/days/${day.id}">← ${fmtDate(day.date)}</a></p>
    <h1>${title}</h1>
    <p class="muted small">
      <strong>Tap racers in finishing order.</strong> Tap a racer again to remove them; later places move up.
      Use the dropdown for DNF, DSQ, OCS or RET. Leave blank anyone who didn't race.
    </p>
    ${racers.length === 0
      ? html`<div class="errors">No active racers yet. <a href="/admin/racers">Add racers</a> first.</div>`
      : ''}
    <form method="post" action="${action}" id="race-form">
      <ol class="entry">
        ${racers.map((r) => {
          const v = values.get(r.id) ?? '';
          return html`<li data-racer="${r.id}">
            <span class="badge" aria-hidden="true"></span>
            <button type="button" class="tap">${racerLabel(r)}</button>
            <select name="r_${r.id}" aria-label="Result for ${r.name}">
              <option value="">—</option>
              ${placeOptions.map((p) => html`<option value="${p}"${v === String(p) ? raw(' selected') : ''}>${p}</option>`)}
              ${RESULT_CODES.map((c) => html`<option value="${c}"${v === c ? raw(' selected') : ''}>${c}</option>`)}
            </select>
          </li>`;
        })}
      </ol>
      <div class="stack" style="margin-top:1rem">
        <label for="notes">Notes (optional)</label>
        <input type="text" id="notes" name="notes" value="${notes}" placeholder="e.g. light SW breeze, windward-leeward x2">
      </div>
      <div class="actions">
        <button type="submit">Save race</button>
        <button type="button" class="secondary" id="clear">Clear places</button>
        <a href="/admin/days/${day.id}">Cancel</a>
      </div>
    </form>
    <script>${raw(RACE_FORM_JS)}</script>`;
}

// Progressive enhancement: tapping assigns the next place; the selects still work without JS.
const RACE_FORM_JS = `
(function () {
  var rows = Array.prototype.slice.call(document.querySelectorAll('.entry li'));
  function place(li) { var v = li.querySelector('select').value; return /^\\d+$/.test(v) ? Number(v) : 0; }
  function paint() {
    rows.forEach(function (li) {
      var p = place(li), v = li.querySelector('select').value;
      li.classList.toggle('placed', p > 0);
      li.querySelector('.badge').textContent = p ? p : (v || '');
    });
  }
  rows.forEach(function (li) {
    var sel = li.querySelector('select');
    li.querySelector('.tap').addEventListener('click', function () {
      var p = place(li);
      if (p) {
        sel.value = '';
        rows.forEach(function (o) { var q = place(o); if (q > p) o.querySelector('select').value = String(q - 1); });
      } else {
        var max = rows.reduce(function (m, o) { return Math.max(m, place(o)); }, 0);
        sel.value = String(max + 1);
      }
      paint();
    });
    sel.addEventListener('change', paint);
  });
  document.getElementById('clear').addEventListener('click', function () {
    rows.forEach(function (li) { if (place(li)) li.querySelector('select').value = ''; });
    paint();
  });
  paint();
})();`;

export function racersPage(racers: Racer[], racesSailed: Map<number, number>): Html {
  return html`
    <h1>Racers</h1>
    <form class="card stack" method="post" action="/admin/racers">
      <h3 style="margin-top:0">Add a racer</h3>
      <input type="hidden" name="return" value="/admin/racers">
      <div class="grid2">
        <div><label for="name">Name</label><input type="text" id="name" name="name" required></div>
        <div><label for="sail_number">Sail number (optional)</label><input type="text" id="sail_number" name="sail_number"></div>
      </div>
      <div class="actions"><button type="submit">Add racer</button></div>
    </form>
    <p class="small muted">Racers can't be deleted once they have results. Mark them inactive to hide them from the results form.</p>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Name</th><th>Sail #</th><th class="c">Active</th><th class="n">Races</th><th></th></tr></thead>
        <tbody>
          ${racers.map((r) => {
            const n = racesSailed.get(r.id) ?? 0;
            return html`<tr>
              <td><input form="racer-${r.id}" type="text" name="name" value="${r.name}" required aria-label="Name"></td>
              <td><input form="racer-${r.id}" type="text" name="sail_number" value="${r.sail_number ?? ''}" aria-label="Sail number" style="max-width:7rem"></td>
              <td class="c"><input form="racer-${r.id}" type="checkbox" name="active" value="1"${r.active ? raw(' checked') : ''} aria-label="Active"></td>
              <td class="n">${n}${n >= FEE_THRESHOLD ? html` <span class="chip fee" title="$25 season fee due">$25</span>` : ''}</td>
              <td><form id="racer-${r.id}" method="post" action="/admin/racers/${r.id}"><button class="secondary" type="submit">Save</button></form></td>
            </tr>`;
          })}
        </tbody>
      </table>
    </div>`;
}

export function auditPage(rows: AuditRow[]): Html {
  return html`
    <h1>Change log</h1>
    <p class="small muted">Most recent 200 changes. Racer numbers (#12) refer to racer IDs.</p>
    <div class="table-wrap">
      <table>
        <thead><tr><th>When (UTC)</th><th>Who</th><th>What</th><th>Detail</th></tr></thead>
        <tbody>
          ${rows.map((r) => html`<tr><td class="small">${r.at}</td><td class="small">${r.user_email}</td><td>${r.action}</td><td class="small">${r.detail ?? ''}</td></tr>`)}
        </tbody>
      </table>
    </div>`;
}

export function deniedPage(reason: string): Html {
  return html`
    <h1>Race Committee only</h1>
    <p>This area is for the FF16 Race Committee.</p>
    <p class="small muted">${reason}</p>
    <p><a href="/">Go to the public leaderboard</a></p>`;
}
