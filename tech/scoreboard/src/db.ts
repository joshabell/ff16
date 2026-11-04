// All D1 queries live here.

import type { RaceEntry, ResultCode, ResultEntry } from './scoring';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  DEV_RC_EMAIL?: string;
}

export type Venue = 'A' | 'B' | 'C';
export type DayStatus = 'scheduled' | 'bye' | 'cancelled';

export const VENUES: Record<Venue, string> = {
  A: 'Kernwood Boat Ramp',
  B: 'Sandy Point Beach',
  C: 'Jubilee Yacht Club',
};

export interface Season { id: number; name: string; start_date: string; end_date: string }
export interface Racer { id: number; name: string; sail_number: string | null; active: number }
export interface RaceDay {
  id: number;
  season_id: number;
  date: string;
  start_time: string | null;
  venue: Venue | null;
  status: DayStatus;
  notes: string | null;
  race_count: number;
}
export interface Race {
  id: number;
  race_day_id: number;
  race_number: number;
  notes: string | null;
  updated_by: string | null;
  updated_at: string;
}
export interface RaceWithDay extends Race { date: string }
export interface ResultRow { race_id: number; racer_id: number; place: number | null; code: ResultCode | null }
export interface AuditRow { id: number; at: string; user_email: string; action: string; detail: string | null }

export async function currentSeason(db: D1Database): Promise<Season | null> {
  return db.prepare('SELECT * FROM seasons WHERE is_current = 1 ORDER BY id DESC LIMIT 1').first<Season>();
}

// ---------- racers ----------

export async function listRacers(db: D1Database): Promise<Racer[]> {
  const { results } = await db.prepare('SELECT * FROM racers ORDER BY active DESC, name COLLATE NOCASE').all<Racer>();
  return results;
}

export async function racerMap(db: D1Database): Promise<Map<number, Racer>> {
  return new Map((await listRacers(db)).map((r) => [r.id, r]));
}

export async function createRacer(db: D1Database, name: string, sail: string | null): Promise<void> {
  await db.prepare('INSERT INTO racers (name, sail_number) VALUES (?, ?)').bind(name, sail).run();
}

export async function updateRacer(db: D1Database, id: number, name: string, sail: string | null, active: boolean) {
  await db
    .prepare('UPDATE racers SET name = ?, sail_number = ?, active = ? WHERE id = ?')
    .bind(name, sail, active ? 1 : 0, id)
    .run();
}

// ---------- race days ----------

const DAY_SELECT = `
  SELECT d.*, (SELECT COUNT(*) FROM races r WHERE r.race_day_id = d.id) AS race_count
  FROM race_days d`;

export async function listRaceDays(db: D1Database, seasonId: number): Promise<RaceDay[]> {
  const { results } = await db
    .prepare(`${DAY_SELECT} WHERE d.season_id = ? ORDER BY d.date`)
    .bind(seasonId)
    .all<RaceDay>();
  return results;
}

export async function getRaceDay(db: D1Database, id: number): Promise<RaceDay | null> {
  return db.prepare(`${DAY_SELECT} WHERE d.id = ?`).bind(id).first<RaceDay>();
}

export interface DayFields { start_time: string | null; venue: Venue | null; status: DayStatus; notes: string | null }

export async function createRaceDay(db: D1Database, seasonId: number, date: string, f: DayFields): Promise<number> {
  const row = await db
    .prepare('INSERT INTO race_days (season_id, date, start_time, venue, status, notes) VALUES (?, ?, ?, ?, ?, ?) RETURNING id')
    .bind(seasonId, date, f.start_time, f.venue, f.status, f.notes)
    .first<{ id: number }>();
  return row!.id;
}

export async function updateRaceDay(db: D1Database, id: number, f: DayFields): Promise<void> {
  await db
    .prepare('UPDATE race_days SET start_time = ?, venue = ?, status = ?, notes = ? WHERE id = ?')
    .bind(f.start_time, f.venue, f.status, f.notes, id)
    .run();
}

// ---------- races & results ----------

export async function racesForDay(db: D1Database, dayId: number): Promise<Race[]> {
  const { results } = await db
    .prepare('SELECT * FROM races WHERE race_day_id = ? ORDER BY race_number')
    .bind(dayId)
    .all<Race>();
  return results;
}

export async function getRace(db: D1Database, id: number): Promise<Race | null> {
  return db.prepare('SELECT * FROM races WHERE id = ?').bind(id).first<Race>();
}

export async function resultsForRaces(db: D1Database, raceIds: number[]): Promise<ResultRow[]> {
  if (raceIds.length === 0) return [];
  const { results } = await db
    .prepare(`SELECT * FROM results WHERE race_id IN (${raceIds.map(() => '?').join(',')})`)
    .bind(...raceIds)
    .all<ResultRow>();
  return results;
}

/** Every race in the season (in sailing order) with its results, ready for computeStandings. */
export async function seasonRaces(db: D1Database, seasonId: number): Promise<{ races: RaceWithDay[]; entries: RaceEntry[] }> {
  const { results: races } = await db
    .prepare(
      `SELECT r.*, d.date FROM races r JOIN race_days d ON d.id = r.race_day_id
       WHERE d.season_id = ? ORDER BY d.date, r.race_number`,
    )
    .bind(seasonId)
    .all<RaceWithDay>();
  const { results: rows } = await db
    .prepare(
      `SELECT x.* FROM results x JOIN races r ON r.id = x.race_id JOIN race_days d ON d.id = r.race_day_id
       WHERE d.season_id = ?`,
    )
    .bind(seasonId)
    .all<ResultRow>();
  return { races, entries: toEntries(races, rows) };
}

export function toEntries(races: Race[], rows: ResultRow[]): RaceEntry[] {
  return races.map((race) => ({
    raceId: race.id,
    results: rows
      .filter((x) => x.race_id === race.id)
      .map((x) => ({ racerId: x.racer_id, place: x.place, code: x.code })),
  }));
}

function resultInserts(db: D1Database, raceId: number, results: ResultEntry[]): D1PreparedStatement[] {
  return results.map((r) =>
    db.prepare('INSERT INTO results (race_id, racer_id, place, code) VALUES (?, ?, ?, ?)').bind(raceId, r.racerId, r.place, r.code),
  );
}

export async function createRace(
  db: D1Database,
  dayId: number,
  notes: string | null,
  results: ResultEntry[],
  email: string,
): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO races (race_day_id, race_number, notes, updated_by)
       VALUES (?, (SELECT COALESCE(MAX(race_number), 0) + 1 FROM races WHERE race_day_id = ?), ?, ?)
       RETURNING id, race_number`,
    )
    .bind(dayId, dayId, notes, email)
    .first<{ id: number; race_number: number }>();
  const raceId = row!.id;
  try {
    await db.batch([
      ...resultInserts(db, raceId, results),
      auditStmt(db, email, 'race.create', `day ${dayId}, race ${row!.race_number}: ${summarize(results)}`),
    ]);
  } catch (e) {
    await db.prepare('DELETE FROM races WHERE id = ?').bind(raceId).run();
    throw e;
  }
  return raceId;
}

export async function updateRace(
  db: D1Database,
  race: Race,
  notes: string | null,
  results: ResultEntry[],
  email: string,
): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM results WHERE race_id = ?').bind(race.id),
    ...resultInserts(db, race.id, results),
    db
      .prepare("UPDATE races SET notes = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(notes, email, race.id),
    auditStmt(db, email, 'race.update', `day ${race.race_day_id}, race ${race.race_number}: ${summarize(results)}`),
  ]);
}

/** Deletes a race and renumbers the later races that day so numbering stays 1..n. */
export async function deleteRace(db: D1Database, race: Race, email: string): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM races WHERE id = ?').bind(race.id),
    // Two steps avoid colliding with the UNIQUE(race_day_id, race_number) constraint mid-update.
    db
      .prepare('UPDATE races SET race_number = -race_number WHERE race_day_id = ? AND race_number > ?')
      .bind(race.race_day_id, race.race_number),
    db
      .prepare('UPDATE races SET race_number = -race_number - 1 WHERE race_day_id = ? AND race_number < 0')
      .bind(race.race_day_id),
    auditStmt(db, email, 'race.delete', `day ${race.race_day_id}, race ${race.race_number}`),
  ]);
}

function summarize(results: ResultEntry[]): string {
  const finishers = results.filter((r) => r.place !== null).sort((a, b) => a.place! - b.place!);
  const codes = results.filter((r) => r.code);
  return [...finishers.map((r) => `${r.place}:#${r.racerId}`), ...codes.map((r) => `${r.code}:#${r.racerId}`)].join(' ');
}

// ---------- audit ----------

function auditStmt(db: D1Database, email: string, action: string, detail: string): D1PreparedStatement {
  return db.prepare('INSERT INTO audit_log (user_email, action, detail) VALUES (?, ?, ?)').bind(email, action, detail);
}

export async function audit(db: D1Database, email: string, action: string, detail: string): Promise<void> {
  await auditStmt(db, email, action, detail).run();
}

export async function recentAudit(db: D1Database, limit = 200): Promise<AuditRow[]> {
  const { results } = await db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').bind(limit).all<AuditRow>();
  return results;
}
