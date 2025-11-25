// client/src/App.jsx
import React, { useEffect, useState } from "react";
import { apiRequest } from "./api";

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem("authToken") || "");
  const [user, setUser] = useState(null);

  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");

  const [tournaments, setTournaments] = useState([]);
  const [tournamentsLoading, setTournamentsLoading] = useState(false);
  const [tournamentsError, setTournamentsError] = useState("");

  const [selectedTournament, setSelectedTournament] = useState(null);
  const [currentMatch, setCurrentMatch] = useState(null);
  const [currentMatchLoading, setCurrentMatchLoading] = useState(false);
  const [commentary, setCommentary] = useState("");
  const [commentaryLoading, setCommentaryLoading] = useState(false);
  const [commentaryError, setCommentaryError] = useState("");

  // ----- auth helpers -----

  useEffect(() => {
    if (!token) return;

    async function fetchMe() {
      try {
        const me = await apiRequest("/api/me", { token });
        setUser(me);
      } catch (err) {
        console.error("Failed /me:", err);
        setUser(null);
        setToken("");
        localStorage.removeItem("authToken");
      }
    }

    fetchMe();
  }, [token]);

  async function handleLogin(e) {
    e.preventDefault();
    setLoginError("");
    try {
      const data = await apiRequest("/api/auth/login", {
        method: "POST",
        body: { username: loginUsername, password: loginPassword },
      });
      setToken(data.token);
      localStorage.setItem("authToken", data.token);
      setUser(data.user);
      setLoginPassword("");
    } catch (err) {
      setLoginError(err.message || "Login failed");
    }
  }

  function handleLogout() {
    setToken("");
    setUser(null);
    localStorage.removeItem("authToken");
    setSelectedTournament(null);
    setCurrentMatch(null);
    setCommentary("");
  }

  // ----- tournaments -----

  async function loadTournaments() {
    if (!token) return;
    setTournamentsLoading(true);
    setTournamentsError("");
    try {
      // you can pass ?status=in_progress if you want only live
      const data = await apiRequest("/api/tournaments", { token });
      setTournaments(data);
    } catch (err) {
      setTournamentsError(err.message || "Failed to load tournaments");
    } finally {
      setTournamentsLoading(false);
    }
  }

  useEffect(() => {
    if (token) {
      loadTournaments();
    }
  }, [token]);

  async function handleSelectTournament(t) {
    setSelectedTournament(t);
    setCurrentMatch(null);
    setCommentary("");
    setCommentaryError("");
    if (!t) return;
    await loadCurrentMatch(t.id);
  }

  // ----- current match -----

  async function loadCurrentMatch(tournamentId) {
    if (!token) return;
    setCurrentMatchLoading(true);
    setCommentary("");
    setCommentaryError("");
    try {
      const data = await apiRequest(`/api/tournaments/${tournamentId}/next-match`, {
        token,
      });
      setCurrentMatch(data.match || null);
    } catch (err) {
      console.error(err);
      setCurrentMatch(null);
    } finally {
      setCurrentMatchLoading(false);
    }
  }

  // ----- commentary -----

  async function generateCommentary() {
    if (!token || !currentMatch?.id) return;
    setCommentaryLoading(true);
    setCommentaryError("");
    setCommentary("");
    try {
      const data = await apiRequest(`/api/matches/${currentMatch.id}/commentary`, {
        method: "POST",
        token,
      });
      setCommentary(data.commentary || "");
    } catch (err) {
      setCommentaryError(err.message || "Failed to get commentary");
    } finally {
      setCommentaryLoading(false);
    }
  }

  // ----- render -----

  if (!token || !user) {
    return (
      <div className="app-root">
        <header className="app-header">
          <div className="app-header-title">Tournament Legends</div>
        </header>
        <main className="app-main">
          <div className="panel" style={{ maxWidth: 320, margin: "0 auto" }}>
            <h2>Login</h2>
            <form onSubmit={handleLogin}>
              <input
                className="input"
                type="text"
                placeholder="Username"
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
              />
              <input
                className="input"
                type="password"
                placeholder="Password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
              />
              <button className="button" type="submit" style={{ width: "100%" }}>
                Sign In
              </button>
            </form>
            {loginError && <div className="error">{loginError}</div>}
            <div style={{ marginTop: "0.75rem", fontSize: "0.8rem", color: "#aaa" }}>
              (Use the register endpoint or seed a user in the DB for now.)
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app-root">
      <header className="app-header">
        <div>
          <div className="app-header-title">Tournament Legends</div>
          <small>
            Logged in as <strong>{user.username}</strong>
          </small>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <button className="button secondary" onClick={loadTournaments}>
            Refresh Tournaments
          </button>
          <button className="button secondary" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </header>

      <main className="app-main">
        {/* Left: tournaments list */}
        <section className="panel" style={{ flex: 1 }}>
          <h2>Tournaments</h2>
          {tournamentsLoading && <small>Loading tournaments…</small>}
          {tournamentsError && <div className="error">{tournamentsError}</div>}

          {!tournamentsLoading && tournaments.length === 0 && (
            <small>No tournaments yet. Create one via the API or admin UI.</small>
          )}

          <ul className="tournament-list">
            {tournaments.map((t) => (
              <li
                key={t.id}
                className={
                  "tournament-item" +
                  (selectedTournament?.id === t.id ? " selected" : "")
                }
                onClick={() => handleSelectTournament(t)}
              >
                <div>
                  {t.name}
                  <span
                    className={
                      "tag " +
                      (t.status === "in_progress"
                        ? "live"
                        : t.status === "pending"
                        ? "pending"
                        : "completed")
                    }
                  >
                    {t.status}
                  </span>
                </div>
                <small>
                  Game ID: {t.game_id} • Prelims: {t.num_prelim_matches} • Type:{" "}
                  {t.elimination_type}
                </small>
              </li>
            ))}
          </ul>
        </section>

        {/* Right: current match + commentary */}
        <section className="panel" style={{ flex: 1 }}>
          <h2>Current Match</h2>

          {!selectedTournament && (
            <small>Select a tournament on the left to see the next match.</small>
          )}

          {selectedTournament && (
            <>
              <div style={{ marginBottom: "0.5rem" }}>
                <strong>{selectedTournament.name}</strong>
                <br />
                <small>
                  Status: {selectedTournament.status} • Prelims:{" "}
                  {selectedTournament.num_prelim_matches}
                </small>
              </div>

              <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
                <button
                  className="button secondary"
                  onClick={() => loadCurrentMatch(selectedTournament.id)}
                  disabled={currentMatchLoading}
                >
                  {currentMatchLoading ? "Loading…" : "Refresh Match"}
                </button>
                <button
                  className="button"
                  onClick={generateCommentary}
                  disabled={!currentMatch || commentaryLoading}
                >
                  {commentaryLoading ? "Summoning Hype…" : "Get Commentary"}
                </button>
              </div>

              {currentMatchLoading && <small>Finding the next match…</small>}

              {!currentMatchLoading && !currentMatch && selectedTournament && (
                <small>
                  No unresolved matches found. This tournament may be completed.
                </small>
              )}

              {currentMatch && (
                <div className="match-row">
                  <div>
                    Match ID: <strong>{currentMatch.id}</strong>
                  </div>
                  <div>
                    Round: <strong>{currentMatch.round_number}</strong> · Slot:{" "}
                    <strong>{currentMatch.match_index}</strong>
                  </div>
                  <div style={{ marginTop: "0.35rem", fontSize: "0.85rem" }}>
                    (The server will resolve the two fighters from this match when
                    generating commentary.)
                  </div>
                </div>
              )}

              <div className="commentary-box">
                {commentary && <span>{commentary}</span>}
                {!commentary && !commentaryLoading && (
                  <span style={{ color: "#6b7280" }}>
                    Commentary will appear here.
                  </span>
                )}
              </div>

              {commentaryError && <div className="error">{commentaryError}</div>}
            </>
          )}
        </section>
      </main>
    </div>
  );
}
