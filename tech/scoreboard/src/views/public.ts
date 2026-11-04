import { html } from 'hono/html';
import { VENUES, type Race, type RaceDay, type RaceWithDay, type Racer, type ResultRow, type Season } from '../db';
import { raceScore, type Cell, type Standings } from '../scoring';
import { fmtDate, fmtShortDate, fmtTime, ordinal, type Html } from './layout';

export function racerLabel(r: Racer | undefined): Html {
  if (!r) return html`<span class="muted">(removed racer)</span>`;
  return html`${r.name}${r.sail_number ? html` <span class="sail">#${r.sail_number}</span>` : ''}`;
}

export function dayChip(d: RaceDay): Html {
  if (d.race_count > 0) return html`<span class="chip sailed">Sailed · ${d.race_count} race${d.race_count === 1 ? '' : 's'}</span>`;
  const label = { scheduled: 'Scheduled', bye: 'BYE', cancelled: 'Cancelled' }[d.status];
  return html`<span class="chip ${d.status}">${label}</span>`;
}

export function venueLabel(v: RaceDay['venue']): string {
  return v ? `${v} · ${VENUES[v]}` : '';
}

function cellHtml(cell: Cell): Html {
  const cls = cell.dropped ? 'drop' : '';
  if (cell.kind === 'finish') {
    return html`<td class="n ${cls}" title="${ordinal(cell.place)} of ${cell.finishers}${cell.dropped ? ' · dropped' : ''}">${cell.score}</td>`;
  }
  if (cell.kind === 'code') {
    return html`<td class="n ${cls}" title="${cell.code} · 0 points${cell.dropped ? ' · dropped' : ''}"><span class="code">${cell.code}</span></td>`;
  }
  return html`<td class="n ${cls}" title="Did not race · 0 points${cell.dropped ? ' · dropped' : ''}"><span class="dnr">–</span></td>`;
}

export function leaderboardPage(
  season: Season,
  standings: Standings,
  races: RaceWithDay[],
  days: RaceDay[],
  racers: Map<number, Racer>,
  today: string,
): Html {
  const raceById = new Map(races.map((r) => [r.id, r]));
  const held = standings.raceIds.map((id) => raceById.get(id)!);
  // Group consecutive races by day for the header row.
  const groups: { dayId: number; date: string; count: number }[] = [];
  for (const r of held) {
    const last = groups[groups.length - 1];
    if (last && last.dayId === r.race_day_id) last.count++;
    else groups.push({ dayId: r.race_day_id, date: r.date, count: 1 });
  }
  const next = days.find((d) => d.date >= today && d.status === 'scheduled' && d.race_count === 0);

  return html`
    <h1>${season.name} Season Standings</h1>
    ${next
      ? html`<p class="muted">Next race: <strong>${fmtDate(next.date)}</strong>${next.start_time ? ` at ${fmtTime(next.start_time)}` : ''}${next.venue ? `, ${VENUES[next.venue]}` : ''}</p>`
      : ''}
    ${standings.rows.length === 0
      ? html`<div class="card"><p>No races have been scored yet this season.</p><p class="small muted">See the <a href="/schedule">schedule</a>.</p></div>`
      : html`
        <div class="table-wrap">
          <table class="standings">
            <thead>
              <tr class="days">
                <th rowspan="2" class="c">#</th>
                <th rowspan="2" class="racer">Racer</th>
                <th rowspan="2" class="n">Total</th>
                ${groups.map((g) => html`<th colspan="${g.count}" class="c"><a href="/day/${g.dayId}">${fmtShortDate(g.date)}</a></th>`)}
              </tr>
              <tr>
                ${held.map((r) => html`<th class="n">R${r.race_number}</th>`)}
              </tr>
            </thead>
            <tbody>
              ${standings.rows.map(
                (row) => html`<tr>
                  <td class="c">${row.rank}</td>
                  <td class="racer">${racerLabel(racers.get(row.racerId))}</td>
                  <td class="n total">${row.total}</td>
                  ${row.cells.map(cellHtml)}
                </tr>`,
              )}
            </tbody>
          </table>
        </div>
        <p class="small muted">
          ${standings.racesHeld} race${standings.racesHeld === 1 ? '' : 's'} held ·
          ${standings.drops === 0
            ? 'no scores dropped yet (each racer drops one score for every 5 races held)'
            : `each racer's lowest ${standings.drops} score${standings.drops === 1 ? '' : 's'} dropped (20%, rounded down; shown struck through)`} ·
          <span class="dnr">–</span> did not race (0) · codes such as <span class="code">DNF</span> score 0.
          Hover or tap a score for the finishing place.
        </p>`}
    <h2>How scoring works</h2>
    <p>Each finisher scores the number of boats that finished the race plus one point for every finisher behind them.
    In a race with 6 finishers, 1st scores 6 + 5 = 11 and last scores 6 + 0 = 6. Boats that don't finish (DNF, DSQ, OCS, RET)
    score 0 and don't count toward the size of the race. Boats that don't race score 0.</p>
  `;
}

export function schedulePage(season: Season, days: RaceDay[], today: string): Html {
  const shown = days.filter((d) => d.status !== 'bye' || d.race_count > 0);
  return html`
    <h1>${season.name} Schedule</h1>
    <p class="muted">BYE weeks are hidden. The Notice of Race lists backup dates used when a race is canceled.</p>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Date</th><th>Start</th><th>Venue</th><th>Status</th></tr></thead>
        <tbody>
          ${shown.map(
            (d) => html`<tr${d.date < today && d.race_count === 0 ? html` class="row-bye"` : ''}>
              <td>${d.race_count > 0 ? html`<a href="/day/${d.id}">${fmtDate(d.date)}</a>` : fmtDate(d.date)}</td>
              <td>${fmtTime(d.start_time)}</td>
              <td>${venueLabel(d.venue)}</td>
              <td>${dayChip(d)}</td>
            </tr>`,
          )}
        </tbody>
      </table>
    </div>`;
}

export function raceResultsTable(race: Race, rows: ResultRow[], racers: Map<number, Racer>): Html {
  const finishers = rows.filter((r) => r.place !== null).sort((a, b) => a.place! - b.place!);
  const coded = rows.filter((r) => r.code);
  return html`
    <div class="table-wrap">
      <table>
        <thead><tr><th class="c">Place</th><th>Racer</th><th class="n">Points</th></tr></thead>
        <tbody>
          ${finishers.map(
            (r) => html`<tr><td class="c">${ordinal(r.place!)}</td><td>${racerLabel(racers.get(r.racer_id))}</td><td class="n">${raceScore(finishers.length, r.place!)}</td></tr>`,
          )}
          ${coded.map(
            (r) => html`<tr><td class="c"><span class="code">${r.code}</span></td><td>${racerLabel(racers.get(r.racer_id))}</td><td class="n">0</td></tr>`,
          )}
        </tbody>
      </table>
    </div>
    ${race.notes ? html`<p class="small muted">${race.notes}</p>` : ''}`;
}

export function dayPage(day: RaceDay, races: Race[], rows: ResultRow[], racers: Map<number, Racer>): Html {
  return html`
    <p class="small"><a href="/">← Standings</a></p>
    <h1>${fmtDate(day.date)}</h1>
    <p class="muted">${[fmtTime(day.start_time), venueLabel(day.venue)].filter(Boolean).join(' · ')} ${dayChip(day)}</p>
    ${day.notes ? html`<p>${day.notes}</p>` : ''}
    ${races.length === 0 ? html`<p>No results for this day.</p>` : ''}
    ${races.map(
      (race) => html`<h2>Race ${race.race_number}</h2>${raceResultsTable(
        race,
        rows.filter((r) => r.race_id === race.id),
        racers,
      )}`,
    )}`;
}
