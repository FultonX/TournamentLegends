# Tournament Legends Project Blueprint

## Product goal

Build a mobile-friendly tournament manager, initially for **Street Fighter 6 (SF6)**. Users can register, join or host tournaments, select a character, advance a single-elimination bracket, review history and statistics, and generate short AI match introductions. Keep the bracket and match history on the server so reconnecting clients recover the current state.

Use separate root-level folders for distinct projects (for example, `client/` and `server/`) rather than mixing frontend and backend code.

## Recommended architecture

- **Backend:** Node.js and Express.
- **Database:** SQLite for the first version; keep the data layer replaceable so PostgreSQL can be adopted later.
- **Frontend:** React, served by Express in production. A simple HTML/JavaScript client is acceptable for the first vertical slice.
- **Authentication:** Username/password accounts, bcrypt password hashes, and JWT authentication. The client may persist the JWT in local storage and restore the session with `GET /api/me`.
- **Live updates:** Begin with periodic polling of tournament state. WebSockets can replace polling later.
- **OpenAI:** All SDK calls and API keys must remain server-side. Never expose `OPENAI_API_KEY` or call OpenAI directly from the browser.

## Core data model

### Users and game catalog

- `users`: `id`, unique `username`, `password_hash`, `fight_money` (default `0`), and `created_at`.
- `games`: `id`, `name`, unique short `code`, and `created_at`.
- `characters`: `id`, `game_id`, `name`, optional `shorthand`, and `is_selectable`.
- Seed SF6 and its selectable, non-DLC character roster first.

### Tournaments and entrants

- `tournaments`: `id`, `game_id`, `owner_id`, `name`, `num_prelim_matches`, `elimination_type`, `status`, and `created_at`.
- Permit `num_prelim_matches` values of `4`, `8`, or `16`; entrant capacity is twice that number (8, 16, or 32).
- `elimination_type` is `single` initially; reserve `double` for later.
- `status` is `pending`, `in_progress`, or `completed`.
- `tournament_fighters`: `id`, `tournament_id`, `user_id`, `character_id`, and `seed_index`.
- A tournament fighter represents the player/character pairing for one tournament. Assign a random character or allow a draft before locking the bracket.

### Structural matches

Store bracket nodes rather than copying participants into every round:

- `matches`: `id`, `tournament_id`, `round_number`, `match_index`, `bracket_side`, source fields for slots A and B, nullable `winner_fighter_id`, and nullable `completed_at`.
- Each slot has `source_*_type` (`fighter` or `match`), `source_*_id`, and `source_*_outcome` (`winner`, with `loser` reserved for double elimination).
- Round-one slots reference `tournament_fighters`. Later slots reference prior matches.
- Resolve a participant dynamically: a fighter source returns that fighter; a match source returns the referenced match's winner, or `null` until it has one.
- Undo by clearing the selected match's winner and deleting its fight-history record. Dynamically resolved downstream slots then become empty automatically.
- Reject or clear downstream results when an earlier result changes so completed matches never retain invalid participants.

### Fight history

Treat each completed match as one fight and store a denormalized history row for statistics:

- `fights`: `id`, unique `match_id`, `tournament_id`, winner/loser fighter IDs, winner/loser user IDs, winner/loser character IDs, and `created_at`.
- Completing a match should atomically set the match winner and insert its fight row.
- Undoing a match should atomically clear its winner and delete the corresponding fight row.

## Single-elimination bracket generation

For `M` preliminary matches:

1. Require exactly `2M` entrants, shuffle them, and assign `seed_index` values `0..(2M-1)`.
2. Create `M` round-one matches. Match `k` receives seeds `2k` and `2k+1`.
3. Repeatedly halve the match count for later rounds.
4. Match `k` in round `r` references the winners of matches `2k` and `2k+1` in round `r-1`.
5. Stop after creating the single final match.

For eight preliminary matches, generate rounds containing 8, 4, 2, and 1 matches. Double elimination is explicitly deferred; later it can add a losers bracket and sources that consume match losers.

## Statistics contract

For an upcoming match, compute percentages in this exact order:

`p1, f1, c1, p1vp2, f1vf2, c1vc2, p2vp1, f2vf1, c2vc1, p2, f2, c2`

Definitions:

- `p`: the user's overall win rate across all fights.
- `f`: the tournament fighter's overall win rate (the player/character pairing represented by that fighter record).
- `c`: the character's overall win rate across all players.
- `p1vp2` / `p2vp1`: player-versus-player head-to-head rates, regardless of character.
- `f1vf2` / `f2vf1`: fighter-versus-fighter head-to-head rates.
- `c1vc2` / `c2vc1`: character-versus-character head-to-head rates.

Count wins and total appearances from `fights`. For a head-to-head pair with no history, return `50` for each side. Choose and document a consistent neutral fallback for overall rates with no history (prefer `50`). Avoid divide-by-zero results.

## OpenAI commentary

- Expose authenticated `POST /api/matches/:id/commentary`.
- Load and resolve both match participants, then calculate all twelve statistics on the server.
- Use the official OpenAI Node SDK and a current, configurable model name; do not hard-code secrets.
- Ask for a high-energy, pro-wrestling-style SF6 introduction of one to three sentences.
- Describe advantages qualitatively rather than printing numeric percentages.
- Emphasize a clear favorite/underdog story while highlighting a credible strength or upset path for the underdog when the data supports one.
- Return `{ "commentary": "..." }` and handle unavailable participants, missing configuration, SDK failures, and malformed model output cleanly.

## REST API

### Authentication and catalog