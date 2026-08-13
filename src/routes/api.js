const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { OpenAI } = require("openai");
const db = require("../db");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "development-only-change-me";
const VALID_STATUSES = new Set(["pending", "in_progress", "completed"]);

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  error.operational = true;
  return error;
}

function parseId(value, label = "id") {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, `Invalid ${label}`);
  return id;
}

function publicUser(user) {
  return { id: user.id, username: user.username, fight_money: user.fight_money ?? 0 };
}

function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: "7d" });
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return res.status(401).json({ error: "Missing token" });

  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET);
    const user = db.get("SELECT * FROM users WHERE id = ?", [payload.id]);
    if (!user) return res.status(401).json({ error: "User not found" });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function getFighter(fighterId, tournamentId) {
  if (!fighterId) return null;
  return db.get(
    `SELECT tf.*, u.username, c.name AS character_name, c.shorthand AS character_shorthand
     FROM tournament_fighters tf
     JOIN users u ON u.id = tf.user_id
     JOIN characters c ON c.id = tf.character_id
     WHERE tf.id = ? AND tf.tournament_id = ?`,
    [fighterId, tournamentId]
  ) || null;
}

function resolveSlot(match, side) {
  const type = match[`source_${side}_type`];
  const sourceId = match[`source_${side}_id`];
  const outcome = match[`source_${side}_outcome`];

  if (type === "fighter") return getFighter(sourceId, match.tournament_id);
  if (type !== "match") return null;

  const sourceMatch = db.get("SELECT * FROM matches WHERE id = ? AND tournament_id = ?", [sourceId, match.tournament_id]);
  if (!sourceMatch) return null;

  if (outcome === "winner") return getFighter(sourceMatch.winner_fighter_id, match.tournament_id);
  const fight = db.get("SELECT loser_fighter_id FROM fights WHERE match_id = ?", [sourceMatch.id]);
  return getFighter(fight?.loser_fighter_id, match.tournament_id);
}

function resolveMatchFighters(match) {
  return { fighterA: resolveSlot(match, "a"), fighterB: resolveSlot(match, "b") };
}

function serializeMatch(match) {
  const { fighterA, fighterB } = resolveMatchFighters(match);
  return { ...match, fighterA, fighterB, ready: Boolean(fighterA && fighterB && !match.winner_fighter_id) };
}

function createSingleElimBracket(tournamentId, numPrelimMatches) {
  const fighters = shuffle(db.all("SELECT * FROM tournament_fighters WHERE tournament_id = ?", [tournamentId]));
  if (fighters.length !== numPrelimMatches * 2) throw httpError(409, "Tournament must be full before creating its bracket");

  fighters.forEach((fighter, seedIndex) => {
    db.run("UPDATE tournament_fighters SET seed_index = ? WHERE id = ?", [seedIndex, fighter.id]);
    fighter.seed_index = seedIndex;
  });

  let previousRound = [];
  for (let index = 0; index < numPrelimMatches; index += 1) {
    const result = db.run(
      `INSERT INTO matches (
        tournament_id, round_number, match_index, bracket_side,
        source_a_type, source_a_id, source_a_outcome,
        source_b_type, source_b_id, source_b_outcome
      ) VALUES (?, 1, ?, 'winners', 'fighter', ?, 'winner', 'fighter', ?, 'winner')`,
      [tournamentId, index, fighters[index * 2].id, fighters[index * 2 + 1].id]
    );
    previousRound.push({ id: result.lastID });
  }

  let roundNumber = 2;
  while (previousRound.length > 1) {
    const nextRound = [];
    for (let index = 0; index < previousRound.length / 2; index += 1) {
      const result = db.run(
        `INSERT INTO matches (
          tournament_id, round_number, match_index, bracket_side,
          source_a_type, source_a_id, source_a_outcome,
          source_b_type, source_b_id, source_b_outcome
        ) VALUES (?, ?, ?, 'winners', 'match', ?, 'winner', 'match', ?, 'winner')`,
        [tournamentId, roundNumber, index, previousRound[index * 2].id, previousRound[index * 2 + 1].id]
      );
      nextRound.push({ id: result.lastID });
    }
    previousRound = nextRound;
    roundNumber += 1;
  }
}

function requireOwner(tournamentId, userId) {
  const tournament = db.get("SELECT * FROM tournaments WHERE id = ?", [tournamentId]);
  if (!tournament) throw httpError(404, "Tournament not found");
  if (tournament.owner_id !== userId) throw httpError(403, "Only the tournament host can manage results");
  return tournament;
}

function clearMatchAndDescendants(matchId, tournamentId) {
  const pending = [matchId];
  const ids = new Set();
  while (pending.length) {
    const current = pending.pop();
    if (ids.has(current)) continue;
    ids.add(current);
    const children = db.all(
      `SELECT id FROM matches
       WHERE tournament_id = ? AND ((source_a_type = 'match' AND source_a_id = ?) OR (source_b_type = 'match' AND source_b_id = ?))`,
      [tournamentId, current, current]
    );
    children.forEach((child) => pending.push(child.id));
  }

  for (const id of ids) {
    db.run("DELETE FROM fights WHERE match_id = ?", [id]);
    db.run("UPDATE matches SET winner_fighter_id = NULL, completed_at = NULL WHERE id = ?", [id]);
  }
  return ids.size;
}

function overallPercentage(kind, value) {
  const column = { player: "user_id", fighter: "fighter_id", character: "character_id" }[kind];
  const row = db.get(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN winner_${column} = ? THEN 1 ELSE 0 END), 0) AS wins
     FROM fights WHERE winner_${column} = ? OR loser_${column} = ?`,
    [value, value, value]
  );
  return row.total ? (row.wins * 100) / row.total : 50;
}

function versusPercentages(kind, first, second) {
  const column = { player: "user_id", fighter: "fighter_id", character: "character_id" }[kind];
  const row = db.get(
    `SELECT COALESCE(SUM(CASE WHEN winner_${column} = ? THEN 1 ELSE 0 END), 0) AS first_wins,
            COALESCE(SUM(CASE WHEN winner_${column} = ? THEN 1 ELSE 0 END), 0) AS second_wins
     FROM fights
     WHERE (winner_${column} = ? AND loser_${column} = ?)
        OR (winner_${column} = ? AND loser_${column} = ?)`,
    [first, second, first, second, second, first]
  );
  const total = row.first_wins + row.second_wins;
  return total ? [(row.first_wins * 100) / total, (row.second_wins * 100) / total] : [50, 50];
}

function computeStatsForMatch(matchId) {
  const match = db.get("SELECT * FROM matches WHERE id = ?", [matchId]);
  if (!match) throw httpError(404, "Match not found");
  const { fighterA, fighterB } = resolveMatchFighters(match);
  if (!fighterA || !fighterB) throw httpError(409, "Both match participants are not available yet");

  const p1 = overallPercentage("player", fighterA.user_id);
  const f1 = overallPercentage("fighter", fighterA.id);
  const c1 = overallPercentage("character", fighterA.character_id);
  const [p1vp2, p2vp1] = versusPercentages("player", fighterA.user_id, fighterB.user_id);
  const [f1vf2, f2vf1] = versusPercentages("fighter", fighterA.id, fighterB.id);
  const [c1vc2, c2vc1] = versusPercentages("character", fighterA.character_id, fighterB.character_id);
  const p2 = overallPercentage("player", fighterB.user_id);
  const f2 = overallPercentage("fighter", fighterB.id);
  const c2 = overallPercentage("character", fighterB.character_id);

  const stats = { p1, f1, c1, p1vp2, f1vf2, c1vc2, p2vp1, f2vf1, c2vc1, p2, f2, c2 };
  return { match: serializeMatch(match), fighterA, fighterB, stats, ordered: Object.values(stats) };
}

router.get("/health", (req, res) => res.json({ ok: true }));

router.post("/auth/register", asyncRoute(async (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  if (!/^[A-Za-z0-9_-]{3,24}$/.test(username)) throw httpError(400, "Username must be 3-24 letters, numbers, underscores, or hyphens");
  if (password.length < 8 || password.length > 128) throw httpError(400, "Password must be 8-128 characters");
  if (db.get("SELECT id FROM users WHERE username = ?", [username])) throw httpError(409, "Username already taken");

  const passwordHash = await bcrypt.hash(password, 12);
  let user;
  try {
    user = db.transaction(() => {
      const result = db.run("INSERT INTO users (username, password_hash) VALUES (?, ?)", [username, passwordHash]);
      return db.get("SELECT * FROM users WHERE id = ?", [result.lastID]);
    });
  } catch (error) {
    if (error.code?.startsWith("SQLITE_CONSTRAINT")) throw httpError(409, "Username already taken");
    throw error;
  }
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
}));

router.post("/auth/login", asyncRoute(async (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  const user = db.get("SELECT * FROM users WHERE username = ?", [username]);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) throw httpError(401, "Invalid credentials");
  res.json({ token: signToken(user), user: publicUser(user) });
}));

router.get("/me", authMiddleware, (req, res) => res.json(publicUser(req.user)));

router.get("/games", authMiddleware, (req, res) => {
  res.json(db.all("SELECT * FROM games ORDER BY name"));
});

router.get("/games/:id/characters", authMiddleware, asyncRoute(async (req, res) => {
  const gameId = parseId(req.params.id, "game id");
  res.json(db.all("SELECT * FROM characters WHERE game_id = ? AND is_selectable = 1 ORDER BY name", [gameId]));
}));

router.post("/tournaments", authMiddleware, asyncRoute(async (req, res) => {
  const gameId = parseId(req.body?.gameId, "game id");
  const numPrelimMatches = Number(req.body?.numPrelimMatches);
  const eliminationType = req.body?.eliminationType || "single";
  const name = String(req.body?.name || "").trim();
  if (!db.get("SELECT id FROM games WHERE id = ?", [gameId])) throw httpError(400, "Unknown game");
  if (![4, 8, 16].includes(numPrelimMatches)) throw httpError(400, "Preliminary matches must be 4, 8, or 16");
  if (eliminationType !== "single") throw httpError(400, "Only single elimination is available in this version");
  if (name.length < 3 || name.length > 80) throw httpError(400, "Tournament name must be 3-80 characters");

  const result = db.run(
    `INSERT INTO tournaments (game_id, owner_id, name, num_prelim_matches, elimination_type)
     VALUES (?, ?, ?, ?, 'single')`,
    [gameId, req.user.id, name, numPrelimMatches]
  );
  res.status(201).json({ id: result.lastID });
}));

router.get("/tournaments", authMiddleware, asyncRoute(async (req, res) => {
  const status = req.query.status;
  if (status && !VALID_STATUSES.has(status)) throw httpError(400, "Invalid tournament status");
  const params = status ? [req.user.id, status] : [req.user.id];
  const where = status ? "WHERE t.status = ?" : "";
  const tournaments = db.all(
    `SELECT t.*, g.name AS game_name, g.code AS game_code, u.username AS owner_username,
            COUNT(tf.id) AS entrant_count,
            t.num_prelim_matches * 2 AS capacity,
            MAX(CASE WHEN tf.user_id = ? THEN 1 ELSE 0 END) AS joined
     FROM tournaments t
     JOIN games g ON g.id = t.game_id
     JOIN users u ON u.id = t.owner_id
     LEFT JOIN tournament_fighters tf ON tf.tournament_id = t.id
     ${where}
     GROUP BY t.id ORDER BY t.created_at DESC, t.id DESC`,
    params
  );
  res.json(tournaments);
}));

router.get("/tournaments/:id", authMiddleware, asyncRoute(async (req, res) => {
  const tournamentId = parseId(req.params.id, "tournament id");
  const tournament = db.get(
    `SELECT t.*, g.name AS game_name, g.code AS game_code, u.username AS owner_username,
            t.num_prelim_matches * 2 AS capacity
     FROM tournaments t JOIN games g ON g.id = t.game_id JOIN users u ON u.id = t.owner_id
     WHERE t.id = ?`,
    [tournamentId]
  );
  if (!tournament) throw httpError(404, "Tournament not found");

  const fighters = db.all(
    `SELECT tf.*, u.username, c.name AS character_name, c.shorthand AS character_shorthand
     FROM tournament_fighters tf JOIN users u ON u.id = tf.user_id JOIN characters c ON c.id = tf.character_id
     WHERE tf.tournament_id = ? ORDER BY tf.seed_index IS NULL, tf.seed_index, tf.created_at`,
    [tournamentId]
  );
  const matches = db.all(
    "SELECT * FROM matches WHERE tournament_id = ? ORDER BY round_number, match_index",
    [tournamentId]
  ).map(serializeMatch);
  res.json({
    tournament: { ...tournament, entrant_count: fighters.length },
    fighters,
    matches,
    joined: fighters.some((fighter) => fighter.user_id === req.user.id),
    canManage: tournament.owner_id === req.user.id,
  });
}));

router.post("/tournaments/:id/join", authMiddleware, asyncRoute(async (req, res) => {
  const tournamentId = parseId(req.params.id, "tournament id");
  const requestedCharacterId = req.body?.characterId ? parseId(req.body.characterId, "character id") : null;

  const response = db.transaction(() => {
    const tournament = db.get("SELECT * FROM tournaments WHERE id = ?", [tournamentId]);
    if (!tournament) throw httpError(404, "Tournament not found");
    if (tournament.status !== "pending") throw httpError(409, "Tournament has already started");
    if (db.get("SELECT id FROM tournament_fighters WHERE tournament_id = ? AND user_id = ?", [tournamentId, req.user.id])) {
      throw httpError(409, "You already joined this tournament");
    }

    let character;
    if (requestedCharacterId) {
      character = db.get("SELECT * FROM characters WHERE id = ? AND game_id = ? AND is_selectable = 1", [requestedCharacterId, tournament.game_id]);
      if (!character) throw httpError(400, "Character is not selectable for this game");
    } else {
      character = db.get(
        "SELECT * FROM characters WHERE game_id = ? AND is_selectable = 1 ORDER BY RANDOM() LIMIT 1",
        [tournament.game_id]
      );
    }

    const count = db.get("SELECT COUNT(*) AS count FROM tournament_fighters WHERE tournament_id = ?", [tournamentId]).count;
    const capacity = tournament.num_prelim_matches * 2;
    if (count >= capacity) throw httpError(409, "Tournament is full");
    const result = db.run(
      "INSERT INTO tournament_fighters (tournament_id, user_id, character_id) VALUES (?, ?, ?)",
      [tournamentId, req.user.id, character.id]
    );

    const started = count + 1 === capacity;
    if (started) {
      createSingleElimBracket(tournamentId, tournament.num_prelim_matches);
      db.run("UPDATE tournaments SET status = 'in_progress' WHERE id = ?", [tournamentId]);
    }
    return { fighterId: result.lastID, character, started };
  });

  res.status(201).json(response);
}));

router.get("/tournaments/:id/next-match", authMiddleware, asyncRoute(async (req, res) => {
  const tournamentId = parseId(req.params.id, "tournament id");
  if (!db.get("SELECT id FROM tournaments WHERE id = ?", [tournamentId])) throw httpError(404, "Tournament not found");
  const unresolved = db.all(
    "SELECT * FROM matches WHERE tournament_id = ? AND winner_fighter_id IS NULL ORDER BY round_number, match_index",
    [tournamentId]
  );
  const ready = unresolved.map(serializeMatch).find((match) => match.ready) || null;
  res.json({ match: ready });
}));

router.post("/matches/:id/result", authMiddleware, asyncRoute(async (req, res) => {
  const matchId = parseId(req.params.id, "match id");
  const winnerFighterId = parseId(req.body?.winnerFighterId, "winner fighter id");

  const result = db.transaction(() => {
    const match = db.get("SELECT * FROM matches WHERE id = ?", [matchId]);
    if (!match) throw httpError(404, "Match not found");
    const tournament = requireOwner(match.tournament_id, req.user.id);
    if (tournament.status !== "in_progress") throw httpError(409, "Tournament is not in progress");
    if (match.winner_fighter_id) throw httpError(409, "Match already has a winner");
    const { fighterA, fighterB } = resolveMatchFighters(match);
    if (!fighterA || !fighterB) throw httpError(409, "Both previous matches must be completed first");
    if (![fighterA.id, fighterB.id].includes(winnerFighterId)) throw httpError(400, "Winner must be one of this match's participants");

    const winner = winnerFighterId === fighterA.id ? fighterA : fighterB;
    const loser = winnerFighterId === fighterA.id ? fighterB : fighterA;
    db.run("UPDATE matches SET winner_fighter_id = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?", [winner.id, matchId]);
    db.run(
      `INSERT INTO fights (
        match_id, tournament_id, winner_fighter_id, loser_fighter_id,
        winner_user_id, loser_user_id, winner_character_id, loser_character_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [matchId, match.tournament_id, winner.id, loser.id, winner.user_id, loser.user_id, winner.character_id, loser.character_id]
    );
    const remaining = db.get("SELECT COUNT(*) AS count FROM matches WHERE tournament_id = ? AND winner_fighter_id IS NULL", [match.tournament_id]).count;
    if (remaining === 0) db.run("UPDATE tournaments SET status = 'completed' WHERE id = ?", [match.tournament_id]);
    return { ok: true, winner, loser, tournamentCompleted: remaining === 0 };
  });
  res.json(result);
}));

router.post("/matches/:id/undo", authMiddleware, asyncRoute(async (req, res) => {
  const matchId = parseId(req.params.id, "match id");
  const response = db.transaction(() => {
    const match = db.get("SELECT * FROM matches WHERE id = ?", [matchId]);
    if (!match) throw httpError(404, "Match not found");
    requireOwner(match.tournament_id, req.user.id);
    if (!match.winner_fighter_id) throw httpError(409, "Match has no result to undo");
    const clearedMatches = clearMatchAndDescendants(match.id, match.tournament_id);
    db.run("UPDATE tournaments SET status = 'in_progress' WHERE id = ?", [match.tournament_id]);
    return { ok: true, clearedMatches };
  });
  res.json(response);
}));

router.get("/matches/:id/stats", authMiddleware, asyncRoute(async (req, res) => {
  res.json(computeStatsForMatch(parseId(req.params.id, "match id")));
}));

router.get("/me/history", authMiddleware, (req, res) => {
  const fights = db.all(
    `SELECT f.*, t.name AS tournament_name,
            wu.username AS winner_username, lu.username AS loser_username,
            wc.name AS winner_character_name, lc.name AS loser_character_name
     FROM fights f
     JOIN tournaments t ON t.id = f.tournament_id
     JOIN users wu ON wu.id = f.winner_user_id JOIN users lu ON lu.id = f.loser_user_id
     JOIN characters wc ON wc.id = f.winner_character_id JOIN characters lc ON lc.id = f.loser_character_id
     WHERE f.winner_user_id = ? OR f.loser_user_id = ?
     ORDER BY f.created_at DESC, f.id DESC LIMIT 100`,
    [req.user.id, req.user.id]
  );
  res.json(fights);
});

router.get("/me/stats", authMiddleware, (req, res) => {
  const row = db.get(
    `SELECT COUNT(*) AS fights,
            COALESCE(SUM(CASE WHEN winner_user_id = ? THEN 1 ELSE 0 END), 0) AS wins
     FROM fights WHERE winner_user_id = ? OR loser_user_id = ?`,
    [req.user.id, req.user.id, req.user.id]
  );
  res.json({ fights: row.fights, wins: row.wins, losses: row.fights - row.wins, winRate: row.fights ? (row.wins * 100) / row.fights : 50 });
});

router.post("/matches/:id/commentary", authMiddleware, asyncRoute(async (req, res) => {
  const matchId = parseId(req.params.id, "match id");
  const { fighterA, fighterB, stats } = computeStatsForMatch(matchId);
  if (!process.env.OPENAI_API_KEY) throw httpError(503, "AI commentary is not configured on this server");

  const prompt = `Write a high-energy, pro-wrestling-style introduction for this upcoming Street Fighter 6 tournament match.

${fighterA.username} plays ${fighterA.character_name}; ${fighterB.username} plays ${fighterB.character_name}.
Evidence, in required comparison order:
- Player overall: ${fighterA.username} ${stats.p1.toFixed(1)}, ${fighterB.username} ${stats.p2.toFixed(1)}
- Player/character pairing overall: ${fighterA.username}/${fighterA.character_name} ${stats.f1.toFixed(1)}, ${fighterB.username}/${fighterB.character_name} ${stats.f2.toFixed(1)}
- Character overall: ${fighterA.character_name} ${stats.c1.toFixed(1)}, ${fighterB.character_name} ${stats.c2.toFixed(1)}
- Player head-to-head: ${stats.p1vp2.toFixed(1)} to ${stats.p2vp1.toFixed(1)}
- Pairing head-to-head: ${stats.f1vf2.toFixed(1)} to ${stats.f2vf1.toFixed(1)}
- Character head-to-head: ${stats.c1vc2.toFixed(1)} to ${stats.c2vc1.toFixed(1)}

Return only the introduction in one to three sentences. Never print numbers or percentages. Describe advantages qualitatively. Establish a clear favorite and underdog when the evidence supports it, and mention a credible strength or upset path for the underdog when one exists. Avoid claiming certainty.`;

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
      input: prompt,
      max_output_tokens: 180,
    });
    const commentary = typeof response.output_text === "string" ? response.output_text.trim() : "";
    if (!commentary || commentary.length > 1200) throw httpError(502, "AI commentary returned an invalid response");
    res.json({ commentary });
  } catch (error) {
    if (error.status === 502) throw error;
    console.error("OpenAI commentary failed:", error.message);
    throw httpError(502, "AI commentary is temporarily unavailable");
  }
}));

module.exports = router;
