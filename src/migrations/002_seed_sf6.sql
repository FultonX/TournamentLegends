INSERT INTO games (name, code) VALUES ('Street Fighter 6', 'SF6');

INSERT INTO characters (game_id, name, shorthand, is_selectable)
SELECT games.id, roster.name, roster.shorthand, 1
FROM games
CROSS JOIN (
  SELECT 'Ryu' AS name, 'RYU' AS shorthand UNION ALL
  SELECT 'Ken', 'KEN' UNION ALL
  SELECT 'Chun-Li', 'CHU' UNION ALL
  SELECT 'Luke', 'LUK' UNION ALL
  SELECT 'Jamie', 'JAM' UNION ALL
  SELECT 'Guile', 'GUI' UNION ALL
  SELECT 'Juri', 'JUR' UNION ALL
  SELECT 'Kimberly', 'KIM' UNION ALL
  SELECT 'Marisa', 'MAR' UNION ALL
  SELECT 'JP', 'JP' UNION ALL
  SELECT 'Manon', 'MAN' UNION ALL
  SELECT 'Zangief', 'ZAN' UNION ALL
  SELECT 'Lily', 'LIL' UNION ALL
  SELECT 'Dhalsim', 'DHA' UNION ALL
  SELECT 'E. Honda', 'HON' UNION ALL
  SELECT 'Blanka', 'BLA' UNION ALL
  SELECT 'Dee Jay', 'DEE' UNION ALL
  SELECT 'Cammy', 'CAM'
) AS roster
WHERE games.code = 'SF6';
