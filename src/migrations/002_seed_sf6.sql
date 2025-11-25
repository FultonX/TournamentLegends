-- Seed the game -------------------------------------------------
INSERT INTO games (name, code)
VALUES ('Street Fighter 6', 'SF6')
ON CONFLICT (code) DO NOTHING;

-- Seed some SF6 characters (extend as needed) -------------------
INSERT INTO characters (game_id, name, shorthand, is_selectable)
VALUES
  ((SELECT id FROM games WHERE code = 'SF6'), 'Ryu',      'RYU', 1),
  ((SELECT id FROM games WHERE code = 'SF6'), 'Ken',      'KEN', 1),
  ((SELECT id FROM games WHERE code = 'SF6'), 'Chun-Li',  'CHU', 1),
  ((SELECT id FROM games WHERE code = 'SF6'), 'Luke',     'LUK', 1),
  ((SELECT id FROM games WHERE code = 'SF6'), 'Jamie',    'JAM', 1),
  ((SELECT id FROM games WHERE code = 'SF6'), 'Guile',    'GUI', 1),
  ((SELECT id FROM games WHERE code = 'SF6'), 'Juri',     'JUR', 1),
  ((SELECT id FROM games WHERE code = 'SF6'), 'Kimberly', 'KIM', 1),
  ((SELECT id FROM games WHERE code = 'SF6'), 'Marisa',   'MAR', 1),
  ((SELECT id FROM games WHERE code = 'SF6'), 'JP',       'JP',  1),
  ((SELECT id FROM games WHERE code = 'SF6'), 'Manon',    'MAN', 1),
  ((SELECT id FROM games WHERE code = 'SF6'), 'Zangief',  'ZAN', 1)
ON CONFLICT DO NOTHING;
