-- PostgreSQL Schema

-- USERS ----------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  fight_money   INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- GAMES ----------------------------------------------------
CREATE TABLE IF NOT EXISTS games (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  code       TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CHARACTERS ----------------------------------------------
CREATE TABLE IF NOT EXISTS characters (
  id            SERIAL PRIMARY KEY,
  game_id       INTEGER NOT NULL,
  name          TEXT NOT NULL,
  shorthand     TEXT,
  is_selectable INTEGER NOT NULL DEFAULT 1,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_characters_game
  ON characters(game_id);

-- TOURNAMENTS ---------------------------------------------
CREATE TABLE IF NOT EXISTS tournaments (
  id                SERIAL PRIMARY KEY,
  game_id           INTEGER NOT NULL,
  owner_id          INTEGER NOT NULL,
  name              TEXT NOT NULL,
  num_prelim_matches INTEGER NOT NULL,
  elimination_type  TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending',
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (game_id) REFERENCES games(id),
  FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_tournaments_status
  ON tournaments(status);

-- TOURNAMENT FIGHTERS -------------------------------------
CREATE TABLE IF NOT EXISTS tournament_fighters (
  id           SERIAL PRIMARY KEY,
  tournament_id INTEGER NOT NULL,
  user_id      INTEGER NOT NULL,
  character_id INTEGER NOT NULL,
  seed_index   INTEGER NOT NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)      REFERENCES users(id),
  FOREIGN KEY (character_id) REFERENCES characters(id)
);

CREATE INDEX IF NOT EXISTS idx_tf_tournament
  ON tournament_fighters(tournament_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tf_tournament_seed
  ON tournament_fighters(tournament_id, seed_index);

-- MATCHES --------------------------------------------------
CREATE TABLE IF NOT EXISTS matches (
  id               SERIAL PRIMARY KEY,
  tournament_id    INTEGER NOT NULL,
  round_number     INTEGER NOT NULL,
  match_index      INTEGER NOT NULL,
  bracket_side     TEXT NOT NULL DEFAULT 'winners',

  source_a_type    TEXT NOT NULL,
  source_a_id      INTEGER NOT NULL,
  source_a_outcome TEXT NOT NULL,

  source_b_type    TEXT NOT NULL,
  source_b_id      INTEGER NOT NULL,
  source_b_outcome TEXT NOT NULL,

  winner_fighter_id INTEGER,
  completed_at      TIMESTAMP,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (tournament_id)    REFERENCES tournaments(id) ON DELETE CASCADE,
  FOREIGN KEY (winner_fighter_id) REFERENCES tournament_fighters(id)
);

CREATE INDEX IF NOT EXISTS idx_matches_tournament_round
  ON matches(tournament_id, round_number, match_index);

CREATE INDEX IF NOT EXISTS idx_matches_winner
  ON matches(winner_fighter_id);

-- FIGHTS (for stats) --------------------------------------
CREATE TABLE IF NOT EXISTS fights (
  id                   SERIAL PRIMARY KEY,
  match_id             INTEGER NOT NULL,
  tournament_id        INTEGER NOT NULL,

  winner_fighter_id    INTEGER NOT NULL,
  loser_fighter_id     INTEGER,

  winner_user_id       INTEGER NOT NULL,
  loser_user_id        INTEGER,

  winner_character_id  INTEGER NOT NULL,
  loser_character_id   INTEGER,

  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (match_id)            REFERENCES matches(id) ON DELETE CASCADE,
  FOREIGN KEY (tournament_id)       REFERENCES tournaments(id),
  FOREIGN KEY (winner_fighter_id)   REFERENCES tournament_fighters(id),
  FOREIGN KEY (loser_fighter_id)    REFERENCES tournament_fighters(id),
  FOREIGN KEY (winner_user_id)      REFERENCES users(id),
  FOREIGN KEY (loser_user_id)       REFERENCES users(id),
  FOREIGN KEY (winner_character_id) REFERENCES characters(id),
  FOREIGN KEY (loser_character_id)  REFERENCES characters(id)
);

CREATE INDEX IF NOT EXISTS idx_fights_tournament
  ON fights(tournament_id);

CREATE INDEX IF NOT EXISTS idx_fights_users
  ON fights(winner_user_id, loser_user_id);

CREATE INDEX IF NOT EXISTS idx_fights_fighters
  ON fights(winner_fighter_id, loser_fighter_id);

CREATE INDEX IF NOT EXISTS idx_fights_characters
  ON fights(winner_character_id, loser_character_id);
