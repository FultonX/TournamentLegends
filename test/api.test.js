const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "tournament-legends-"));
process.env.DATABASE_PATH = path.join(testDirectory, "test.sqlite");
process.env.JWT_SECRET = "integration-test-secret";
delete process.env.OPENAI_API_KEY;

const db = require("../src/db");
const { app } = require("../server");

let server;
let baseUrl;

before(async () => {
  db.runMigrations();
  server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  fs.rmSync(testDirectory, { recursive: true, force: true });
});

async function request(url, { method = "GET", token, body } = {}) {
  const response = await fetch(`${baseUrl}${url}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  return { status: response.status, data };
}

test("full single-elimination lifecycle persists structural bracket and history", async () => {
  const players = [];
  for (let index = 1; index <= 8; index += 1) {
    const response = await request("/api/auth/register", {
      method: "POST",
      body: { username: `fighter${index}`, password: "test-password" },
    });
    assert.equal(response.status, 201);
    players.push(response.data);
  }

  const games = await request("/api/games", { token: players[0].token });
  assert.equal(games.status, 200);
  assert.equal(games.data[0].code, "SF6");
  const characters = await request(`/api/games/${games.data[0].id}/characters`, { token: players[0].token });
  assert.equal(characters.data.length, 18);

  const created = await request("/api/tournaments", {
    method: "POST",
    token: players[0].token,
    body: { name: "Integration Invitational", gameId: games.data[0].id, numPrelimMatches: 4, eliminationType: "single" },
  });
  assert.equal(created.status, 201);
  const tournamentId = created.data.id;

  for (let index = 0; index < players.length; index += 1) {
    const joined = await request(`/api/tournaments/${tournamentId}/join`, {
      method: "POST",
      token: players[index].token,
      body: { characterId: characters.data[index].id },
    });
    assert.equal(joined.status, 201);
    assert.equal(joined.data.started, index === players.length - 1);
  }

  let detail = (await request(`/api/tournaments/${tournamentId}`, { token: players[0].token })).data;
  assert.equal(detail.tournament.status, "in_progress");
  assert.deepEqual(
    [...new Set(detail.matches.map((match) => match.round_number))].map((round) => detail.matches.filter((match) => match.round_number === round).length),
    [4, 2, 1]
  );
  assert.equal(detail.fighters.filter((fighter) => fighter.seed_index !== null).length, 8);

  const opening = detail.matches[0];
  const neutralStats = await request(`/api/matches/${opening.id}/stats`, { token: players[0].token });
  assert.equal(neutralStats.status, 200);
  assert.deepEqual(neutralStats.data.ordered, Array(12).fill(50));

  const missingCommentary = await request(`/api/matches/${opening.id}/commentary`, { method: "POST", token: players[0].token });
  assert.equal(missingCommentary.status, 503);

  while (detail.tournament.status !== "completed") {
    const ready = detail.matches.find((match) => match.ready);
    assert.ok(ready, "an unresolved bracket must expose a ready match");
    const result = await request(`/api/matches/${ready.id}/result`, {
      method: "POST",
      token: players[0].token,
      body: { winnerFighterId: ready.fighterA.id },
    });
    assert.equal(result.status, 200);
    detail = (await request(`/api/tournaments/${tournamentId}`, { token: players[0].token })).data;
  }

  assert.equal(detail.matches.filter((match) => match.winner_fighter_id).length, 7);
  const profile = await request("/api/me/stats", { token: players[0].token });
  assert.ok(profile.data.fights >= 1);
  const history = await request("/api/me/history", { token: players[0].token });
  assert.ok(history.data.length >= 1);

  const undo = await request(`/api/matches/${opening.id}/undo`, { method: "POST", token: players[0].token });
  assert.equal(undo.status, 200);
  assert.equal(undo.data.clearedMatches, 3);

  detail = (await request(`/api/tournaments/${tournamentId}`, { token: players[0].token })).data;
  assert.equal(detail.tournament.status, "in_progress");
  assert.equal(detail.matches.filter((match) => match.winner_fighter_id).length, 4);
  const final = detail.matches.at(-1);
  assert.equal(final.winner_fighter_id, null);
  assert.equal(final.fighterA, null);
});

test("authentication, validation, duplicate joins, and host authorization are enforced", async () => {
  const unauthenticated = await request("/api/tournaments");
  assert.equal(unauthenticated.status, 401);

  const login = await request("/api/auth/login", { method: "POST", body: { username: "fighter1", password: "test-password" } });
  assert.equal(login.status, 200);

  const tournaments = await request("/api/tournaments", { token: login.data.token });
  const tournamentId = tournaments.data[0].id;
  const duplicate = await request(`/api/tournaments/${tournamentId}/join`, { method: "POST", token: login.data.token, body: {} });
  assert.equal(duplicate.status, 409);

  const detail = (await request(`/api/tournaments/${tournamentId}`, { token: login.data.token })).data;
  const ready = detail.matches.find((match) => match.ready);
  const forbidden = await request(`/api/matches/${ready.id}/result`, {
    method: "POST",
    token: (await request("/api/auth/login", { method: "POST", body: { username: "fighter2", password: "test-password" } })).data.token,
    body: { winnerFighterId: ready.fighterA.id },
  });
  assert.equal(forbidden.status, 403);
});
