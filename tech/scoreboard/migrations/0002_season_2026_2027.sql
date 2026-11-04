-- 2026–2027 season and schedule, from seasons/season-2-2026-2027/notice-of-race.html §6.
-- "BYE or [time]" weeks are seeded as BYE with their tentative start time; the RC can switch them to scheduled.

INSERT INTO seasons (id, name, start_date, end_date, is_current)
VALUES (1, '2026–2027', '2026-11-01', '2027-04-11', 1);

INSERT INTO race_days (season_id, date, start_time, status, notes) VALUES
  (1, '2026-11-01', '13:00', 'scheduled', NULL),
  (1, '2026-11-08', '11:00', 'bye', 'Backup date if the Nov 1 race is canceled'),
  (1, '2026-11-15', '13:00', 'scheduled', NULL),
  (1, '2026-11-22', NULL,    'bye', '11:00 AM start (7.0 ft) drops to 2.5 ft during the 2-hr race'),
  (1, '2026-11-29', '13:00', 'scheduled', NULL),
  (1, '2026-12-06', '11:00', 'bye', 'Backup date if the Nov 29 race is canceled'),
  (1, '2026-12-13', '13:00', 'scheduled', NULL),
  (1, '2026-12-20', NULL,    'bye', '11:00 AM start (3.9 ft) is below the 4 ft minimum'),
  (1, '2026-12-27', '13:00', 'scheduled', NULL),
  (1, '2027-01-03', NULL,    'bye', '11:00 AM start (5.1 ft) drops to 1.2 ft during the 2-hr race'),
  (1, '2027-01-10', '13:00', 'scheduled', NULL),
  (1, '2027-01-17', NULL,    'bye', 'High tide 5.3 hrs from nearest start (11 AM/1 PM)'),
  (1, '2027-01-24', '13:00', 'scheduled', NULL),
  (1, '2027-01-31', NULL,    'bye', 'High tide 4.7 hrs from nearest start (11 AM/1 PM)'),
  (1, '2027-02-07', '11:00', 'scheduled', NULL),
  (1, '2027-02-14', NULL,    'bye', '1:00 PM start (2.8 ft) is below the 4 ft minimum'),
  (1, '2027-02-21', '11:00', 'scheduled', NULL),
  (1, '2027-02-28', NULL,    'bye', 'High tide 4.3 hrs from nearest start (11 AM/1 PM)'),
  (1, '2027-03-07', '11:00', 'scheduled', NULL),
  (1, '2027-03-14', NULL,    'bye', '1:00 PM start (3.3 ft) is below the 4 ft minimum'),
  (1, '2027-03-21', '11:00', 'scheduled', NULL),
  (1, '2027-03-28', NULL,    'bye', '1:00 PM start (3.1 ft) is below the 4 ft minimum'),
  (1, '2027-04-04', '11:00', 'scheduled', NULL),
  (1, '2027-04-11', '13:00', 'bye', 'Backup date if the Apr 4 race is canceled');
