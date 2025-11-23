// src/routes/api.js
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { OpenAI } = require("openai");

// You'd implement db.* using sqlite3, better-sqlite3, or whatever.
const db = require("../db");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ---------------------- helpers ---------------------- */

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

async function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing token" });
  }
  const token = auth.slice("Bearer ".length);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await db.get("SELECT * FROM users WHERE id = ?", [payload.id]);
    if (!user) return res.status(401).json({ error: "User not found" });
    req.user = user;
    next();
  } catch (err) {
    console.error(err);
    res.status(401).json({ error: "Invalid token" });
  }
}

// Small helper to wrap async routes:
const asyncRoute = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/* ---------------------- auth routes ---------------------- */

// POST /api/auth/register
router.post(
  "/auth/register",
  asyncRoute(async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: "username and password required" });

    const existing = await db.get(
      "SELECT id FROM users WHERE username = ?",
      [username]
    );
    if (existing) {
      return res.status(409).json({ error: "Username already taken" });
    }

    const hash = await bcrypt.hash(password, 10);
    const result = await db.run(
      "INSERT INTO users (username, password_hash, fight_money) VALUES (?, ?, 0)",
      [username, hash]
    );

    const user = { id: result.lastID, username };
    const token = signToken(user);
    res.json({ token, user });
  })
);

// POST /api/auth/login
router.post(
  "/auth/login",
  asyncRoute(async (req, res) => {
    const { username, password } = req.body;
    const user = await db.get(
      "SELECT * FROM users WHERE username = ?",
      [username]
    );
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    const token = signToken(user);
    res.json({ token, user: { id: user.id, username: user.username } });
  })
);

// GET /api/me
router.get(
  "/me",
  authMiddleware,
  asyncRoute(async (req, res) => {
    res.json({
      id: req.user.id,
      username: req.user.username,
      fight_money: req.user.fight_money,
    });
  })
);

/* ---------------------- games & characters ---------------------- */

// GET /api/games
router.get(
  "/games",
  authMiddleware,
  asyncRoute(async (req, res) => {
    const games = await db.all("SELECT * FROM games ORDER BY name ASC");
    res.json(games);
  })
);

// GET /api/games/:id/characters
router.get(
  "/games/:id/characters",
  authMiddleware,
  asyncRoute(async (req, res) => {
    const gameId = Number(req.params.id);
    const chars = await db.all(
      "SELECT * FROM characters WHERE game_id = ? AND is_selectable = 1 ORDER BY name ASC",
      [gameId]
    );
    res.json(chars);
  })
);

/* ---------------------- tournament helpers ---------------------- */

async function createSingleElimBracket(tournamentId, numPrelimMatches) {
  // Get fighters for this tournament (assume already created).
  const fighters = await db.all(
    "SELECT * FROM tournament_fighters WHERE tournament_id = ? ORDER BY seed_index ASC",
    [tournamentId]
  );

  // Round 1: prelim matches
  const round1Matches = [];
  for (let k = 0; k < numPrelimMatches; k++) {
    const fA = fighters[2 * k];
    const fB = fighters[2 * k + 1];
    const result = await db.run(
      `INSERT INTO matches (
        tournament_id, round_number, match_index, bracket_side,
        source_a_type, source_a_id, source_a_outcome,
        source_b_type, source_b_id, source_b_outcome
       ) VALUES (?, ?, ?, 'winners', 'fighter', ?, 'winner', 'fighter', ?, 'winner')`,
      [tournamentId, 1, k, fA.id, fB.id]
    );
    round1Matches.push({ id: result.lastID, round_number: 1, match_index: k });
  }

  // Higher rounds: winners of previous round
  let prevRoundMatches = round1Matches;
  let roundNumber = 2;

  while (prevRoundMatches.length > 1) {
    const nextRoundMatches = [];
    for (let k = 0; k < prevRoundMatches.length / 2; k++) {
      const mA = prevRoundMatches[2 * k];
      const mB = prevRoundMatches[2 * k + 1];
      const result = await db.run(
        `INSERT INTO matches (
          tournament_id, round_number, match_index, bracket_side,
          source_a_type, source_a_id, source_a_outcome,
          source_b_type, source_b_id, source_b_outcome
        ) VALUES (?, ?, ?, 'winners', 'match', ?, 'winner', 'match', ?, 'winner')`,
        [tournamentId, roundNumber, k, mA.id, mB.id]
      );
      nextRoundMatches.push({
        id: result.lastID,
        round_number: roundNumber,
        match_index: k,
      });
    }
    prevRoundMatches = nextRoundMatches;
    roundNumber += 1;
  }
}

/* ---------------------- tournaments ---------------------- */

// POST /api/tournaments
router.post(
  "/tournaments",
  authMiddleware,
  asyncRoute(async (req, res) => {
    const { gameId, numPrelimMatches, eliminationType } = req.body;

    if (![4, 8, 16].includes(numPrelimMatches)) {
      return res.status(400).json({ error: "Invalid numPrelimMatches" });
    }
    if (!["single", "double"].includes(eliminationType)) {
      return res.status(400).json({ error: "Invalid eliminationType" });
    }

    const result = await db.run(
      `INSERT INTO tournaments
       (game_id, owner_id, name, num_prelim_matches, elimination_type, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [
        gameId,
        req.user.id,
        `Tournament ${new Date().toISOString()}`,
        numPrelimMatches,
        eliminationType,
      ]
    );

    const tournamentId = result.lastID;
    res.json({ id: tournamentId });
  })
);

// GET /api/tournaments
router.get(
  "/tournaments",
  authMiddleware,
  asyncRoute(async (req, res) => {
    const { status } = req.query; // "pending", "in_progress", "completed", or undefined
    let sql = "SELECT * FROM tournaments";
    const params = [];
    if (status) {
      sql += " WHERE status = ?";
      params.push(status);
    }
    sql += " ORDER BY created_at DESC";
    const tournaments = await db.all(sql, params);
    res.json(tournaments);
  })
);

// GET /api/tournaments/:id  (tournament + fighters + matches)
router.get(
  "/tournaments/:id",
  authMiddleware,
  asyncRoute(async (req, res) => {
    const id = Number(req.params.id);

    const tournament = await db.get(
      "SELECT * FROM tournaments WHERE id = ?",
      [id]
    );
    if (!tournament) return res.status(404).json({ error: "Not found" });

    const fighters = await db.all(
      `SELECT tf.*, u.username, c.name as character_name
       FROM tournament_fighters tf
       JOIN users u ON tf.user_id = u.id
       JOIN characters c ON tf.character_id = c.id
       WHERE tf.tournament_id = ?
       ORDER BY tf.seed_index ASC`,
      [id]
    );

    const matches = await db.all(
      "SELECT * FROM matches WHERE tournament_id = ? ORDER BY round_number ASC, match_index ASC",
      [id]
    );

    res.json({ tournament, fighters, matches });
  })
);

// POST /api/tournaments/:id/join
router.post(
  "/tournaments/:id/join",
  authMiddleware,
  asyncRoute(async (req, res) => {
    const tournamentId = Number(req.params.id);
    const { characterId } = req.body;

    const tournament = await db.get(
      "SELECT * FROM tournaments WHERE id = ?",
      [tournamentId]
    );
    if (!tournament) return res.status(404).json({ error: "Not found" });
    if (tournament.status !== "pending") {
      return res.status(400).json({ error: "Tournament already started" });
    }

    // Count how many fighters joined so far
    const countRow = await db.get(
      "SELECT COUNT(*) as cnt FROM tournament_fighters WHERE tournament_id = ?",
      [tournamentId]
    );
    const currentCount = countRow.cnt;
    const max = tournament.num_prelim_matches * 2;
    if (currentCount >= max) {
      return res.status(400).json({ error: "Tournament is full" });
    }

    const seedIndex = currentCount; // simple: order of join

    const result = await db.run(
      `INSERT INTO tournament_fighters
       (tournament_id, user_id, character_id, seed_index)
       VALUES (?, ?, ?, ?)`,
      [tournamentId, req.user.id, characterId, seedIndex]
    );

    const fighterId = result.lastID;

    // If we just filled the last slot, build the bracket and mark as in_progress
    if (seedIndex + 1 === max) {
      await createSingleElimBracket(tournamentId, tournament.num_prelim_matches);
      await db.run(
        "UPDATE tournaments SET status = 'in_progress' WHERE id = ?",
        [tournamentId]
      );
    }

    res.json({ fighterId, seedIndex });
  })
);

// Resolve fighterA / fighterB for a match, following its sources.
// Works for:
//  - source_*_type = 'fighter'  (round 1)
//  - source_*_type = 'match'    (later rounds, using previous winners/losers)
async function resolveMatchFighters(match) {
  const tournamentId = match.tournament_id;

  // Load all fighters for this tournament (small set: 8/16/32 max)
  const fighters = await db.all(
    `SELECT tf.*, u.username, c.name AS character_name
     FROM tournament_fighters tf
     JOIN users u ON tf.user_id = u.id
     JOIN characters c ON tf.character_id = c.id
     WHERE tf.tournament_id = ?`,
    [tournamentId]
  );

  const findFighter = (id) => fighters.find((f) => f.id === id) || null;

  async function resolveSlot(sourceType, sourceId, outcome) {
    if (sourceType === "fighter") {
      return findFighter(sourceId);
    }

    if (sourceType === "match") {
      const parentMatch = await db.get(
        "SELECT * FROM matches WHERE id = ?",
        [sourceId]
      );
      if (!parentMatch) return null;

      if (outcome === "winner") {
        if (!parentMatch.winner_fighter_id) return null;
        return findFighter(parentMatch.winner_fighter_id);
      }

      if (outcome === "loser") {
        // Look up the fight row for that match to get the loser_fighter_id
        const fightRow = await db.get(
          "SELECT * FROM fights WHERE match_id = ?",
          [sourceId]
        );
        if (!fightRow || !fightRow.loser_fighter_id) return null;
        return findFighter(fightRow.loser_fighter_id);
      }
    }

    return null;
  }

  const fighterA = await resolveSlot(
    match.source_a_type,
    match.source_a_id,
    match.source_a_outcome
  );
  const fighterB = await resolveSlot(
    match.source_b_type,
    match.source_b_id,
    match.source_b_outcome
  );

  return { fighterA, fighterB };
}

/* ---------------------- matches & results ---------------------- */

// GET /api/tournaments/:id/next-match
router.get(
  "/tournaments/:id/next-match",
  authMiddleware,
  asyncRoute(async (req, res) => {
    const tournamentId = Number(req.params.id);

    // naive: first match with null winner, both sides resolvable
    const matches = await db.all(
      "SELECT * FROM matches WHERE tournament_id = ? AND winner_fighter_id IS NULL ORDER BY round_number ASC, match_index ASC",
      [tournamentId]
    );
    if (matches.length === 0) {
      return res.json({ match: null });
    }

    const match = matches[0];
    res.json({ match });
  })
);

// POST /api/matches/:id/result
router.post(
  "/matches/:id/result",
  authMiddleware,
  asyncRoute(async (req, res) => {
    const matchId = Number(req.params.id);
    const { winnerFighterId } = req.body;

    if (!winnerFighterId) {
      return res.status(400).json({ error: "winnerFighterId is required" });
    }

    const match = await db.get("SELECT * FROM matches WHERE id = ?", [matchId]);
    if (!match) return res.status(404).json({ error: "Match not found" });

    if (match.winner_fighter_id) {
      return res.status(400).json({ error: "Match already has a winner" });
    }

    // Resolve the two participating fighters from the match's sources
    const { fighterA, fighterB } = await resolveMatchFighters(match);

    if (!fighterA || !fighterB) {
      return res.status(400).json({
        error: "Cannot resolve fighters for this match (previous matches may not be completed yet)",
      });
    }

    if (winnerFighterId !== fighterA.id && winnerFighterId !== fighterB.id) {
      return res.status(400).json({
        error: "winnerFighterId does not match either participant in this match",
      });
    }

    const winnerF = winnerFighterId === fighterA.id ? fighterA : fighterB;
    const loserF  = winnerFighterId === fighterA.id ? fighterB : fighterA;

    // 1) Update the match with the winner
    await db.run(
      "UPDATE matches SET winner_fighter_id = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?",
      [winnerFighterId, matchId]
    );

    // 2) Insert the fight row with full winner/loser info
    await db.run(
      `INSERT INTO fights (
        match_id, tournament_id,
        winner_fighter_id, loser_fighter_id,
        winner_user_id, loser_user_id,
        winner_character_id, loser_character_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        matchId,
        match.tournament_id,
        winnerF.id,
        loserF ? loserF.id : null,
        winnerF.user_id,
        loserF ? loserF.user_id : null,
        winnerF.character_id,
        loserF ? loserF.character_id : null,
      ]
    );

    // 3) If this was the last unresolved match in the tournament, mark tournament as completed
    const remaining = await db.get(
      "SELECT COUNT(*) AS cnt FROM matches WHERE tournament_id = ? AND winner_fighter_id IS NULL",
      [match.tournament_id]
    );

    if (remaining && remaining.cnt === 0) {
      await db.run(
        "UPDATE tournaments SET status = 'completed' WHERE id = ?",
        [match.tournament_id]
      );
    }

    res.json({
      ok: true,
      winner_fighter_id: winnerF.id,
      loser_fighter_id: loserF ? loserF.id : null,
    });
  })
);

// POST /api/matches/:id/undo
router.post(
  "/matches/:id/undo",
  authMiddleware,
  asyncRoute(async (req, res) => {
    const matchId = Number(req.params.id);

    const match = await db.get(
      "SELECT * FROM matches WHERE id = ?",
      [matchId]
    );
    if (!match) return res.status(404).json({ error: "Match not found" });

    // Delete fights for this match
    await db.run("DELETE FROM fights WHERE match_id = ?", [matchId]);

    // Clear winner
    await db.run(
      "UPDATE matches SET winner_fighter_id = NULL, completed_at = NULL WHERE id = ?",
      [matchId]
    );

    res.json({ ok: true });
  })
);

/* ---------------------- stats + commentary ---------------------- */

async function computeStatsForMatch(matchId) {
  // Load match, resolve fighterA/fighterB, users, and characters
  const match = await db.get("SELECT * FROM matches WHERE id = ?", [matchId]);
  if (!match) throw new Error("Match not found");

  const tournament = await db.get(
    "SELECT * FROM tournaments WHERE id = ?",
    [match.tournament_id]
  );

  const fighters = await db.all(
    `SELECT tf.*, u.username, c.name as character_name
     FROM tournament_fighters tf
     JOIN users u ON tf.user_id = u.id
     JOIN characters c ON tf.character_id = c.id
     WHERE tf.tournament_id = ?`,
    [tournament.id]
  );

  // For brevity: assume source_a_type/source_b_type are "fighter" and resolve directly.
  const fighterA = fighters.find((f) => f.id === match.source_a_id);
  const fighterB = fighters.find((f) => f.id === match.source_b_id);

  if (!fighterA || !fighterB) {
    throw new Error("Could not resolve fighters for match");
  }

  const u1 = fighterA.user_id;
  const u2 = fighterB.user_id;
  const tf1 = fighterA.id;
  const tf2 = fighterB.id;
  const ch1 = fighterA.character_id;
  const ch2 = fighterB.character_id;

  // Helpers: overall pct, head-to-head pct
  async function overallPct(columnId, value) {
    const row = await db.get(
      `SELECT
        SUM(CASE WHEN winner_${columnId} = ? THEN 1 ELSE 0 END) as wins,
        COUNT(*) as total
       FROM fights
       WHERE winner_${columnId} = ? OR loser_${columnId} = ?`,
      [value, value, value]
    );
    if (!row || row.total === 0) return 50;
    return (100 * row.wins) / row.total;
  }

  async function versusPct(columnId, a, b) {
    const row = await db.get(
      `SELECT
        SUM(CASE WHEN winner_${columnId} = ? THEN 1 ELSE 0 END) as a_wins,
        SUM(CASE WHEN winner_${columnId} = ? THEN 1 ELSE 0 END) as b_wins
       FROM fights
       WHERE (winner_${columnId} = ? AND loser_${columnId} = ?)
          OR (winner_${columnId} = ? AND loser_${columnId} = ?)`,
      [a, b, a, b, b, a]
    );
    const total = (row?.a_wins || 0) + (row?.b_wins || 0);
    if (!total) return [50, 50];
    return [
      (100 * row.a_wins) / total,
      (100 * row.b_wins) / total,
    ];
  }

  const p1 = await overallPct("user_id", u1);
  const p2 = await overallPct("user_id", u2);
  const f1 = await overallPct("fighter_id", tf1);
  const f2 = await overallPct("fighter_id", tf2);
  const c1 = await overallPct("character_id", ch1);
  const c2 = await overallPct("character_id", ch2);

  const [p1vp2, p2vp1] = await versusPct("user_id", u1, u2);
  const [f1vf2, f2vf1] = await versusPct("fighter_id", tf1, tf2);
  const [c1vc2, c2vc1] = await versusPct("character_id", ch1, ch2);

  return {
    fighterA,
    fighterB,
    stats: {
      p1,
      f1,
      c1,
      p1vp2,
      f1vf2,
      c1vc2,
      p2vp1,
      f2vf1,
      c2vc1,
      p2,
      f2,
      c2,
    },
  };
}

// POST /api/matches/:id/commentary
router.post(
  "/matches/:id/commentary",
  authMiddleware,
  asyncRoute(async (req, res) => {
    const matchId = Number(req.params.id);

    const { fighterA, fighterB, stats } = await computeStatsForMatch(matchId);

    const prompt = `
You are a high-energy pro-wrestling style commentator hyping up a Street Fighter-style match in a tournament.

Fighters:
- Fighter 1: ${fighterA.username} using ${fighterA.character_name}
- Fighter 2: ${fighterB.username} using ${fighterB.character_name}

Percentages (0-100):

Overall records:
- Player ${fighterA.username} overall win rate: ${stats.p1}%
- ${fighterA.username} as ${fighterA.character_name}: ${stats.f1}%
- Character ${fighterA.character_name} overall: ${stats.c1}%
- Player ${fighterB.username} overall win rate: ${stats.p2}%
- ${fighterB.username} as ${fighterB.character_name}: ${stats.f2}%
- Character ${fighterB.character_name} overall: ${stats.c2}%

Head-to-head:
- Player vs player: ${fighterA.username} vs ${fighterB.username}: ${stats.p1vp2}% / ${stats.p2vp1}%
- Fighter vs fighter (${fighterA.username}/${fighterA.character_name} vs ${fighterB.username}/${fighterB.character_name}): ${stats.f1vf2}% / ${stats.f2vf1}%
- Character vs character (${fighterA.character_name} vs ${fighterB.character_name}): ${stats.c1vc2}% / ${stats.c2vc1}%

Guidelines:
- Use an excited, pro-wrestling commentator tone.
- 1 to 3 sentences max.
- If one side is a clear favorite in a head-to-head stat, lean into the “favorite vs underdog” story.
- Give hope to the underdog by mentioning at least one impressive stat in their favor if possible.
- Do NOT mention percentages numerically. Refer to them qualitatively.

Now, give the hype intro for this upcoming match.
`;

    const resp = await openai.responses.create({
      model: "gpt-5.1",
      input: prompt,
    });

    const commentary =
      resp.output?.[0]?.content?.[0]?.text || "The crowd is ready!";

    res.json({ commentary });
  })
);

module.exports = router;
