import { Hono, type Context } from 'hono';
import { html } from 'hono/html';
import { authenticate } from './auth';
import * as db from './db';
import type { DayFields, DayStatus, Env, Venue } from './db';
import { computeStandings } from './scoring';
import { validateRaceEntries, type FormEntry } from './validate';
import * as admin from './views/admin';
import { layout, todayISO, type Html } from './views/layout';
import * as pub from './views/public';

type App = { Bindings: Env; Variables: { email: string } };
const app = new Hono<App>();

function page(c: Context<App>, title: string, body: Html | string, extra: { errors?: string[]; status?: 200 | 400 | 403 | 404 } = {}) {
  const email = c.get('email');
  const flash = c.req.query('msg');
  return c.html(layout({ title, body, adminEmail: email, flash, errors: extra.errors }), extra.status ?? 200);
}

function notFound(c: Context<App>) {
  return page(c, 'Not found', html`<h1>Not found</h1><p><a href="/">Go to the leaderboard</a></p>`, { status: 404 });
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const orNull = (v: unknown) => str(v) || null;
const intParam = (v: string | undefined) => (v && /^\d+$/.test(v) ? Number(v) : NaN);
const back = (path: string, msg: string) => `${path}?msg=${encodeURIComponent(msg)}`;

// ============================================================ public

app.get('/', async (c) => {
  const season = await db.currentSeason(c.env.DB);
  if (!season) return page(c, 'Standings', 'No season has been set up yet.');
  const [{ races, entries }, days, racers] = await Promise.all([
    db.seasonRaces(c.env.DB, season.id),
    db.listRaceDays(c.env.DB, season.id),
    db.racerMap(c.env.DB),
  ]);
  const standings = computeStandings(entries);
  return page(c, 'Standings', pub.leaderboardPage(season, standings, races, days, racers, todayISO()));
});

app.get('/schedule', async (c) => {
  const season = await db.currentSeason(c.env.DB);
  if (!season) return page(c, 'Schedule', 'No season has been set up yet.');
  const days = await db.listRaceDays(c.env.DB, season.id);
  return page(c, 'Schedule', pub.schedulePage(season, days, todayISO()));
});

app.get('/day/:id', async (c) => {
  const day = await db.getRaceDay(c.env.DB, intParam(c.req.param('id')));
  if (!day) return notFound(c);
  const races = await db.racesForDay(c.env.DB, day.id);
  const [rows, racers] = await Promise.all([db.resultsForRaces(c.env.DB, races.map((r) => r.id)), db.racerMap(c.env.DB)]);
  return page(c, pub.venueLabel(day.venue) || 'Race day', pub.dayPage(day, races, rows, racers));
});

/** JSON standings, e.g. for embedding on the WordPress site. */
app.get('/api/standings', async (c) => {
  const season = await db.currentSeason(c.env.DB);
  if (!season) return c.json({ error: 'no season' }, 404);
  const [{ races, entries }, racers] = await Promise.all([db.seasonRaces(c.env.DB, season.id), db.racerMap(c.env.DB)]);
  const s = computeStandings(entries);
  const raceById = new Map(races.map((r) => [r.id, r]));
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Cache-Control', 'public, max-age=60');
  return c.json({
    season: season.name,
    racesHeld: s.racesHeld,
    drops: s.drops,
    races: s.raceIds.map((id) => ({ date: raceById.get(id)!.date, race: raceById.get(id)!.race_number })),
    standings: s.rows.map((row) => ({
      rank: row.rank,
      racer: racers.get(row.racerId)?.name ?? null,
      sailNumber: racers.get(row.racerId)?.sail_number ?? null,
      total: row.total,
      scores: row.cells.map((cell) => ({
        points: cell.score,
        dropped: cell.dropped,
        result: cell.kind === 'finish' ? cell.place : cell.kind === 'code' ? cell.code : 'DNR',
      })),
    })),
  });
});

// ============================================================ race committee

app.use('/admin', adminGuard);
app.use('/admin/*', adminGuard);

async function adminGuard(c: Context<App>, next: () => Promise<void>) {
  const auth = await authenticate(c.req.raw, c.env);
  if (!auth.ok) return page(c, 'Race Committee only', admin.deniedPage(auth.reason), { status: 403 });
  if (c.req.method === 'POST') {
    // Cross-site form posts are refused (defence in depth on top of Access's SameSite cookie).
    const origin = c.req.header('origin');
    if (!origin || new URL(origin).host !== new URL(c.req.url).host) {
      return c.text('Cross-site request refused', 403);
    }
  }
  c.set('email', auth.email);
  c.header('Cache-Control', 'no-store');
  await next();
}

app.get('/admin', async (c) => {
  const season = await db.currentSeason(c.env.DB);
  if (!season) return page(c, 'Race days', 'No current season.');
  const [days, racers, { entries }] = await Promise.all([
    db.listRaceDays(c.env.DB, season.id),
    db.listRacers(c.env.DB),
    db.seasonRaces(c.env.DB, season.id),
  ]);
  return page(c, 'Race days', admin.dashboardPage(season, days, todayISO(), racers, racesSailedMap(entries)));
});

function racesSailedMap(entries: ReturnType<typeof db.toEntries>): Map<number, number> {
  return new Map(computeStandings(entries).rows.map((r) => [r.racerId, r.racesSailed]));
}

// ---------- race days ----------

function parseDayFields(body: Record<string, unknown>): { fields: DayFields; errors: string[] } {
  const errors: string[] = [];
  const start = str(body.start_time);
  if (start && !/^\d{2}:\d{2}$/.test(start)) errors.push('Start time must look like 13:00.');
  const venue = str(body.venue);
  if (venue && !(venue in db.VENUES)) errors.push('Unknown venue.');
  const status = str(body.status) as DayStatus;
  if (!['scheduled', 'bye', 'cancelled'].includes(status)) errors.push('Unknown status.');
  return {
    fields: { start_time: start || null, venue: (venue || null) as Venue | null, status, notes: orNull(body.notes) },
    errors,
  };
}

app.get('/admin/days/new', (c) => page(c, 'Add race day', admin.dayNewPage()));

app.post('/admin/days', async (c) => {
  const season = await db.currentSeason(c.env.DB);
  if (!season) return notFound(c);
  const body = await c.req.parseBody();
  const date = str(body.date);
  const { fields, errors } = parseDayFields(body);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push('Pick a date.');
  if (errors.length) return page(c, 'Add race day', admin.dayNewPage({ date, ...fields }), { errors, status: 400 });
  try {
    const id = await db.createRaceDay(c.env.DB, season.id, date, fields);
    await db.audit(c.env.DB, c.get('email'), 'day.create', `${date} (${fields.status})`);
    return c.redirect(back(`/admin/days/${id}`, 'Race day added.'), 303);
  } catch {
    return page(c, 'Add race day', admin.dayNewPage({ date, ...fields }), {
      errors: ['There is already a race day on that date.'],
      status: 400,
    });
  }
});

app.get('/admin/days/:id', async (c) => {
  const day = await db.getRaceDay(c.env.DB, intParam(c.req.param('id')));
  if (!day) return notFound(c);
  const races = await db.racesForDay(c.env.DB, day.id);
  const [rows, racers] = await Promise.all([db.resultsForRaces(c.env.DB, races.map((r) => r.id)), db.racerMap(c.env.DB)]);
  return page(c, 'Race day', admin.dayAdminPage(day, races, rows, racers));
});

app.post('/admin/days/:id', async (c) => {
  const day = await db.getRaceDay(c.env.DB, intParam(c.req.param('id')));
  if (!day) return notFound(c);
  const { fields, errors } = parseDayFields(await c.req.parseBody());
  if (errors.length) return c.redirect(back(`/admin/days/${day.id}`, errors.join(' ')), 303);
  await db.updateRaceDay(c.env.DB, day.id, fields);
  await db.audit(c.env.DB, c.get('email'), 'day.update', `${day.date}: ${fields.status}, venue ${fields.venue ?? '-'}, ${fields.start_time ?? '-'}`);
  return c.redirect(back(`/admin/days/${day.id}`, 'Race day saved.'), 303);
});

// ---------- races ----------

/** Active racers, plus any inactive racer already in this race, alphabetically. */
async function formRacers(env: Env, existing: number[]): Promise<db.Racer[]> {
  return (await db.listRacers(env.DB)).filter((r) => r.active || existing.includes(r.id)).sort((a, b) => a.name.localeCompare(b.name));
}

function readEntries(body: Record<string, unknown>): FormEntry[] {
  return Object.entries(body)
    .filter(([k]) => /^r_\d+$/.test(k))
    .map(([k, v]) => ({ racerId: Number(k.slice(2)), value: str(v) }));
}

app.get('/admin/days/:id/races/new', async (c) => {
  const day = await db.getRaceDay(c.env.DB, intParam(c.req.param('id')));
  if (!day) return notFound(c);
  const racers = await formRacers(c.env, []);
  return page(c, 'Enter race', admin.raceFormPage({ day, racers, values: new Map(), notes: '' }));
});

app.post('/admin/days/:id/races', async (c) => {
  const day = await db.getRaceDay(c.env.DB, intParam(c.req.param('id')));
  if (!day) return notFound(c);
  const body = await c.req.parseBody();
  const entries = readEntries(body);
  const racers = await formRacers(c.env, []);
  const known = new Set(racers.map((r) => r.id));
  const v = validateRaceEntries(entries.filter((e) => known.has(e.racerId)));
  if (!v.ok) {
    const values = new Map(entries.map((e) => [e.racerId, e.value]));
    return page(c, 'Enter race', admin.raceFormPage({ day, racers, values, notes: str(body.notes) }), { errors: v.errors, status: 400 });
  }
  await db.createRace(c.env.DB, day.id, orNull(body.notes), v.results, c.get('email'));
  return c.redirect(back(`/admin/days/${day.id}`, `Race ${day.race_count + 1} saved. The leaderboard is updated.`), 303);
});

app.get('/admin/races/:id', async (c) => {
  const race = await db.getRace(c.env.DB, intParam(c.req.param('id')));
  if (!race) return notFound(c);
  const day = (await db.getRaceDay(c.env.DB, race.race_day_id))!;
  const rows = await db.resultsForRaces(c.env.DB, [race.id]);
  const racers = await formRacers(c.env, rows.map((r) => r.racer_id));
  const values = new Map(rows.map((r) => [r.racer_id, r.code ?? String(r.place)]));
  return page(c, `Edit race ${race.race_number}`, admin.raceFormPage({ day, race, racers, values, notes: race.notes ?? '' }));
});

app.post('/admin/races/:id', async (c) => {
  const race = await db.getRace(c.env.DB, intParam(c.req.param('id')));
  if (!race) return notFound(c);
  const day = (await db.getRaceDay(c.env.DB, race.race_day_id))!;
  const existing = (await db.resultsForRaces(c.env.DB, [race.id])).map((r) => r.racer_id);
  const racers = await formRacers(c.env, existing);
  const known = new Set(racers.map((r) => r.id));
  const body = await c.req.parseBody();
  const entries = readEntries(body);
  const v = validateRaceEntries(entries.filter((e) => known.has(e.racerId)));
  if (!v.ok) {
    const values = new Map(entries.map((e) => [e.racerId, e.value]));
    return page(c, `Edit race ${race.race_number}`, admin.raceFormPage({ day, race, racers, values, notes: str(body.notes) }), {
      errors: v.errors,
      status: 400,
    });
  }
  await db.updateRace(c.env.DB, race, orNull(body.notes), v.results, c.get('email'));
  return c.redirect(back(`/admin/days/${day.id}`, `Race ${race.race_number} updated.`), 303);
});

app.post('/admin/races/:id/delete', async (c) => {
  const race = await db.getRace(c.env.DB, intParam(c.req.param('id')));
  if (!race) return notFound(c);
  await db.deleteRace(c.env.DB, race, c.get('email'));
  return c.redirect(back(`/admin/days/${race.race_day_id}`, `Race ${race.race_number} deleted.`), 303);
});

// ---------- racers ----------

async function racersView(c: Context<App>) {
  const season = await db.currentSeason(c.env.DB);
  const [racers, sailed] = await Promise.all([
    db.listRacers(c.env.DB),
    season ? db.seasonRaces(c.env.DB, season.id).then((s) => racesSailedMap(s.entries)) : new Map<number, number>(),
  ]);
  return admin.racersPage(racers, sailed);
}

app.get('/admin/racers', async (c) => page(c, 'Racers', await racersView(c)));

app.post('/admin/racers', async (c) => {
  const body = await c.req.parseBody();
  const name = str(body.name);
  const sail = orNull(body.sail_number);
  const ret = str(body.return).startsWith('/admin') ? str(body.return) : '/admin/racers';
  if (!name) return c.redirect(back(ret, 'Enter a name.'), 303);
  try {
    await db.createRacer(c.env.DB, name, sail);
  } catch {
    return c.redirect(back(ret, `A racer named "${name}" already exists.`), 303);
  }
  await db.audit(c.env.DB, c.get('email'), 'racer.create', `${name}${sail ? ` #${sail}` : ''}`);
  return c.redirect(back(ret, `${name} added.`), 303);
});

app.post('/admin/racers/:id', async (c) => {
  const id = intParam(c.req.param('id'));
  const body = await c.req.parseBody();
  const name = str(body.name);
  if (!name) return c.redirect(back('/admin/racers', 'Name cannot be empty.'), 303);
  const active = str(body.active) === '1';
  try {
    await db.updateRacer(c.env.DB, id, name, orNull(body.sail_number), active);
  } catch {
    return c.redirect(back('/admin/racers', `A racer named "${name}" already exists.`), 303);
  }
  await db.audit(c.env.DB, c.get('email'), 'racer.update', `#${id}: ${name}${active ? '' : ' (inactive)'}`);
  return c.redirect(back('/admin/racers', `${name} saved.`), 303);
});

// ---------- audit ----------

app.get('/admin/audit', async (c) => page(c, 'Change log', admin.auditPage(await db.recentAudit(c.env.DB))));

app.notFound((c) => notFound(c));

export default app;
