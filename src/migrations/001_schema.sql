CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  fight_money INTEGER NOT NULL DEFAULT 0 CHECK (fight_money >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT NOT NULL COLLATE NOCASE UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  shorthand TEXT,
  is_selectable INTEGER NOT NULL DEFAULT 1 CHECK (is_selectable IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (game_id, name)
);

CREATE INDEX idx_characters_game ON characters(game_id);

CREATE TABLE tournaments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id),
  owner_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  num_prelim_matches INTEGER NOT NULL CHECK (num_prelim_matches IN (4, 8, 16)),
  elimination_type TEXT NOT NULL DEFAULT 'single' CHECK (elimination_type IN ('single', 'double')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_tournaments_status ON tournaments(status);

CREATE TABLE tournament_fighters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  character_id INTEGER NOT NULL REFERENCES characters(id),
  seed_index INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tournament_id, user_id),
  UNIQUE (tournament_id, seed_index)
);

CREATE INDEX idx_tf_tournament ON tournament_fighters(tournament_id);

CREATE TABLE matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL CHECK (round_number > 0),
  match_index INTEGER NOT NULL CHECK (match_index >= 0),
  bracket_side TEXT NOT NULL DEFAULT 'winners' CHECK (bracket_side IN ('winners', 'losers')),
  source_a_type TEXT NOT NULL CHECK (source_a_type IN ('fighter', 'match')),
  source_a_id INTEGER NOT NULL,
  source_a_outcome TEXT NOT NULL DEFAULT 'winner' CHECK (source_a_outcome IN ('winner', 'loser')),
  source_b_type TEXT NOT NULL CHECK (source_b_type IN ('fighter', 'match')),
  source_b_id INTEGER NOT NULL,
  source_b_outcome TEXT NOT NULL DEFAULT 'winner' CHECK (source_b_outcome IN ('winner', 'loser')),
  winner_fighter_id INTEGER REFERENCES tournament_fighters(id),
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tournament_id, bracket_side, round_number, match_index)
);

CREATE INDEX idx_matches_tournament_round ON matches(tournament_id, round_number, match_index);
CREATE INDEX idx_matches_winner ON matches(winner_fighter_id);

CREATE TABLE fights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id INTEGER NOT NULL UNIQUE REFERENCES matches(id) ON DELETE CASCADE,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  winner_fighter_id INTEGER NOT NULL REFERENCES tournament_fighters(id),
  loser_fighter_id INTEGER NOT NULL REFERENCES tournament_fighters(id),
  winner_user_id INTEGER NOT NULL REFERENCES users(id),
  loser_user_id INTEGER NOT NULL REFERENCES users(id),
  winner_character_id INTEGER NOT NULL REFERENCES characters(id),
  loser_character_id INTEGER NOT NULL REFERENCES characters(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_fights_tournament ON fights(tournament_id);
CREATE INDEX idx_fights_users ON fights(winner_user_id, loser_user_id);
CREATE INDEX idx_fights_fighters ON fights(winner_fighter_id, loser_fighter_id);
CREATE INDEX idx_fights_characters ON fights(winner_character_id, loser_character_id);
