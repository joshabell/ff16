// FF16 high-point scoring, per the Notice of Race §9 plus Race Committee rulings (Nov 2026):
//
//   Race score = (finishers in that race) + (finishers behind you)
//
// - Only boats that FINISH count toward the size of the race.
// - A boat with a code (DNF, DSQ, OCS, RET) scores 0 and does not count toward the race size.
// - A boat with no result for a race (DNR) scores 0.
// - "Races held" = races with at least one result. Each racer drops their lowest
//   floor(20% of races held) scores; the season total is the sum of the rest.
//
// This module is pure (no database, no network) so it can be unit-tested directly.

export const RESULT_CODES = ['DNF', 'DSQ', 'OCS', 'RET'] as const;
export type ResultCode = (typeof RESULT_CODES)[number];

export function isResultCode(value: string): value is ResultCode {
  return (RESULT_CODES as readonly string[]).includes(value);
}

export interface ResultEntry {
  racerId: number;
  place: number | null; // finishing place (1 = first), or null when a code applies
  code: ResultCode | null;
}

export interface RaceEntry {
  raceId: number;
  results: ResultEntry[];
}

export type Cell =
  | { kind: 'finish'; place: number; finishers: number; score: number; dropped: boolean }
  | { kind: 'code'; code: ResultCode; score: 0; dropped: boolean }
  | { kind: 'dnr'; score: 0; dropped: boolean };

export interface StandingRow {
  racerId: number;
  rank: number;
  total: number;
  racesSailed: number; // races with any result (finish or code); used for the $25 fee threshold
  cells: Cell[]; // one per race held, in race order
}

export interface Standings {
  racesHeld: number;
  drops: number;
  raceIds: number[]; // races held, in order
  rows: StandingRow[];
}

/** Points for finishing in `place` among `finishers` boats. */
export function raceScore(finishers: number, place: number): number {
  if (!Number.isInteger(place) || place < 1 || place > finishers) {
    throw new RangeError(`place ${place} is not valid in a race with ${finishers} finishers`);
  }
  return finishers + (finishers - place);
}

/** Number of scores each racer drops: 20% of races held, rounded down. */
export function dropCount(racesHeld: number): number {
  return Math.floor(racesHeld / 5);
}

/** Indexes of the `drops` lowest scores (earliest race first when scores tie). */
export function droppedIndexes(scores: number[], drops: number): Set<number> {
  return new Set(
    scores
      .map((score, index) => ({ score, index }))
      .sort((a, b) => a.score - b.score || a.index - b.index)
      .slice(0, drops)
      .map((x) => x.index),
  );
}

/** Season total for one racer, given a score (0 for DNR) for every race held. */
export function seasonTotal(scores: number[]): number {
  const dropped = droppedIndexes(scores, dropCount(scores.length));
  return scores.reduce((sum, s, i) => (dropped.has(i) ? sum : sum + s), 0);
}

/** Full season standings from raw results. Races with no results are ignored. */
export function computeStandings(races: RaceEntry[]): Standings {
  const held = races.filter((r) => r.results.length > 0);
  const drops = dropCount(held.length);

  const racerIds = [...new Set(held.flatMap((r) => r.results.map((x) => x.racerId)))];

  const rows: StandingRow[] = racerIds.map((racerId) => {
    const cells: Cell[] = held.map((race) => {
      const result = race.results.find((x) => x.racerId === racerId);
      if (!result) return { kind: 'dnr', score: 0, dropped: false };
      if (result.code) return { kind: 'code', code: result.code, score: 0, dropped: false };
      const finishers = race.results.filter((x) => x.place !== null).length;
      const place = result.place as number;
      return { kind: 'finish', place, finishers, score: raceScore(finishers, place), dropped: false };
    });
    const dropped = droppedIndexes(
      cells.map((c) => c.score),
      drops,
    );
    dropped.forEach((i) => (cells[i].dropped = true));
    return {
      racerId,
      rank: 0,
      total: cells.reduce((sum, c) => (c.dropped ? sum : sum + c.score), 0),
      racesSailed: cells.filter((c) => c.kind !== 'dnr').length,
      cells,
    };
  });

  // Highest total first. Equal totals share a rank (1, 2, 2, 4); no tie-break per RC ruling.
  rows.sort((a, b) => b.total - a.total || a.racerId - b.racerId);
  rows.forEach((row, i) => {
    row.rank = i > 0 && rows[i - 1].total === row.total ? rows[i - 1].rank : i + 1;
  });

  return { racesHeld: held.length, drops, raceIds: held.map((r) => r.raceId), rows };
}
