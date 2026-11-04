import { describe, expect, test } from 'vitest';
import { computeStandings, dropCount, raceScore, seasonTotal, type RaceEntry } from './scoring';
import { validateRaceEntries } from './validate';

describe('Notice of Race §9 examples', () => {
  test('8-boat race: 1st scores 15, 2nd 14, last 8', () => {
    expect(raceScore(8, 1)).toBe(15);
    expect(raceScore(8, 2)).toBe(14);
    expect(raceScore(8, 8)).toBe(8);
  });

  test('Alex: 10-race season, 2 drops (incl. DNR), total 107', () => {
    expect(seasonTotal([13, 10, 17, 8, 14, 15, 0, 17, 9, 12])).toBe(107);
  });

  test('drops are 20% of races held, rounded down', () => {
    expect([0, 4, 5, 9, 10, 12, 14, 15].map(dropCount)).toEqual([0, 0, 1, 1, 2, 2, 2, 3]);
  });

  test('invalid places are rejected', () => {
    expect(() => raceScore(5, 0)).toThrow(RangeError);
    expect(() => raceScore(5, 6)).toThrow(RangeError);
  });
});

describe('computeStandings', () => {
  const finish = (racerId: number, place: number) => ({ racerId, place, code: null });

  test('DNF scores 0 and does not count toward race size', () => {
    const races: RaceEntry[] = [
      { raceId: 1, results: [finish(1, 1), finish(2, 2), finish(3, 3), { racerId: 4, place: null, code: 'DNF' }] },
    ];
    const s = computeStandings(races);
    const byRacer = Object.fromEntries(s.rows.map((r) => [r.racerId, r]));
    // 3 finishers, not 4: 1st = 3 + 2 = 5
    expect(byRacer[1].total).toBe(5);
    expect(byRacer[2].total).toBe(4);
    expect(byRacer[3].total).toBe(3);
    expect(byRacer[4].total).toBe(0);
    expect(byRacer[4].racesSailed).toBe(1);
    expect(byRacer[4].cells[0]).toMatchObject({ kind: 'code', code: 'DNF' });
  });

  test('missing races are DNR, drops applied, ranks assigned', () => {
    // 5 races held -> 1 drop each
    const races: RaceEntry[] = [
      { raceId: 1, results: [finish(1, 1), finish(2, 2)] }, // 1: 3, 2: 2
      { raceId: 2, results: [finish(2, 1), finish(1, 2)] }, // 2: 3, 1: 2
      { raceId: 3, results: [finish(1, 1)] }, //              1: 1, 2: DNR
      { raceId: 4, results: [finish(1, 1), finish(2, 2)] }, // 1: 3, 2: 2
      { raceId: 5, results: [finish(2, 1), finish(1, 2)] }, // 2: 3, 1: 2
      { raceId: 6, results: [] }, // created but never entered: not "held"
    ];
    const s = computeStandings(races);
    expect(s.racesHeld).toBe(5);
    expect(s.drops).toBe(1);
    expect(s.raceIds).toEqual([1, 2, 3, 4, 5]);
    const [first, second] = s.rows;
    expect(first.racerId).toBe(1);
    expect(first.total).toBe(3 + 2 + 3 + 2); // drops the 1
    expect(first.cells[2].dropped).toBe(true);
    expect(second.racerId).toBe(2);
    expect(second.total).toBe(2 + 3 + 2 + 3); // drops the DNR
    expect(second.cells[2]).toMatchObject({ kind: 'dnr', dropped: true });
    expect(second.racesSailed).toBe(4);
    // equal totals share a rank
    expect(first.rank).toBe(1);
    expect(second.rank).toBe(1);
  });

  test('empty season', () => {
    expect(computeStandings([])).toEqual({ racesHeld: 0, drops: 0, raceIds: [], rows: [] });
  });
});

describe('validateRaceEntries', () => {
  test('accepts places, codes and blanks', () => {
    const r = validateRaceEntries([
      { racerId: 1, value: '2' },
      { racerId: 2, value: '1' },
      { racerId: 3, value: 'dnf' },
      { racerId: 4, value: '' },
    ]);
    expect(r).toEqual({
      ok: true,
      results: [
        { racerId: 1, place: 2, code: null },
        { racerId: 2, place: 1, code: null },
        { racerId: 3, place: null, code: 'DNF' },
      ],
    });
  });

  test('rejects duplicate places, gaps, junk and no finishers', () => {
    expect(validateRaceEntries([{ racerId: 1, value: '1' }, { racerId: 2, value: '1' }]).ok).toBe(false);
    expect(validateRaceEntries([{ racerId: 1, value: '1' }, { racerId: 2, value: '3' }]).ok).toBe(false);
    expect(validateRaceEntries([{ racerId: 1, value: 'x' }]).ok).toBe(false);
    expect(validateRaceEntries([{ racerId: 1, value: 'DSQ' }]).ok).toBe(false);
  });
});
