import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "./api";

const emptyAuth = { username: "", password: "" };
const emptyTournament = { name: "Friday Night Fights", gameId: "", numPrelimMatches: 4 };

function formatRate(value) {
  return `${Math.round(value)}%`;
}

function fighterLabel(fighter) {
  return fighter ? `${fighter.username} · ${fighter.character_name}` : "Awaiting winner";
}

function ErrorMessage({ message }) {
  return message ? <p className="error" role="alert">{message}</p> : null;
}

function AuthScreen({ onAuthenticated }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState(emptyAuth);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await apiRequest(`/api/auth/${mode}`, { method: "POST", body: form });
      onAuthenticated(data);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="eyebrow">Street Fighter 6 tournament control</div>
        <h1>Tournament<br /><span>Legends</span></h1>
        <p className="lede">Build the bracket. Call the fights. Become the story.</p>
        <form onSubmit={submit}>
          <label>Username<input value={form.username} autoComplete="username" onChange={(e) => setForm({ ...form, username: e.target.value })} /></label>
          <label>Password<input type="password" value={form.password} autoComplete={mode === "login" ? "current-password" : "new-password"} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
          <button className="primary wide" disabled={busy}>{busy ? "Entering arena..." : mode === "login" ? "Sign in" : "Create fighter"}</button>
        </form>
        <ErrorMessage message={error} />
        <button className="text-button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
          {mode === "login" ? "New challenger? Register" : "Already registered? Sign in"}
        </button>
      </section>
    </main>
  );
}

function TournamentCard({ tournament, active, onClick }) {
  return (
    <button className={`tournament-card ${active ? "active" : ""}`} onClick={onClick}>
      <div className="card-top"><strong>{tournament.name}</strong><span className={`status ${tournament.status}`}>{tournament.status.replace("_", " ")}</span></div>
      <small>{tournament.entrant_count}/{tournament.capacity} fighters · hosted by {tournament.owner_username}</small>
    </button>
  );
}

function MatchCard({ match, canManage, onResult, onUndo, onInspect, busy }) {
  const complete = Boolean(match.winner_fighter_id);
  return (
    <article className={`match-card ${complete ? "complete" : match.ready ? "ready" : "waiting"}`}>
      <div className="match-number">MATCH {match.match_index + 1}</div>
      {[match.fighterA, match.fighterB].map((fighter, index) => {
        const won = fighter && fighter.id === match.winner_fighter_id;
        return (
          <div className={`competitor ${won ? "winner" : ""}`} key={fighter?.id || index}>
            <span>{fighterLabel(fighter)}</span>
            {won && <b>WIN</b>}
            {canManage && match.ready && fighter && <button disabled={busy} onClick={() => onResult(match, fighter.id)}>Select</button>}
          </div>
        );
      })}
      <div className="match-actions">
        {match.fighterA && match.fighterB && <button className="link" onClick={() => onInspect(match)}>Stats & hype</button>}
        {canManage && complete && <button className="link danger" disabled={busy} onClick={() => onUndo(match)}>Undo</button>}
      </div>
    </article>
  );
}

function Bracket({ detail, onResult, onUndo, onInspect, busy }) {
  const rounds = useMemo(() => {
    const grouped = new Map();
    detail.matches.forEach((match) => {
      if (!grouped.has(match.round_number)) grouped.set(match.round_number, []);
      grouped.get(match.round_number).push(match);
    });
    return [...grouped.entries()];
  }, [detail.matches]);

  if (!rounds.length) return <div className="empty-state">The bracket locks when all {detail.tournament.capacity} fighters have joined.</div>;
  return (
    <div className="bracket-scroll">
      <div className="bracket">
        {rounds.map(([round, matches], roundIndex) => (
          <section className="round" key={round}>
            <h3>{rounds.length === round ? "Grand final" : round === 1 ? "Opening round" : `Round ${round}`}</h3>
            <div className="round-matches" style={{ "--round": roundIndex }}>
              {matches.map((match) => <MatchCard key={match.id} match={match} canManage={detail.canManage} onResult={onResult} onUndo={onUndo} onInspect={onInspect} busy={busy} />)}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function MatchInspector({ match, token, onClose }) {
  const [stats, setStats] = useState(null);
  const [commentary, setCommentary] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setStats(null); setCommentary(""); setError("");
    apiRequest(`/api/matches/${match.id}/stats`, { token }).then(setStats).catch((e) => setError(e.message));
  }, [match.id, token]);

  async function hype() {
    setBusy(true); setError("");
    try {
      const data = await apiRequest(`/api/matches/${match.id}/commentary`, { method: "POST", token });
      setCommentary(data.commentary);
    } catch (requestError) {
      setError(requestError.message);
    } finally { setBusy(false); }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        <div className="eyebrow">Tale of the tape</div>
        <h2>{fighterLabel(match.fighterA)} <span>vs</span> {fighterLabel(match.fighterB)}</h2>
        {stats && <div className="stat-grid">
          <div><b>{formatRate(stats.stats.p1)}</b><span>Player form</span><b>{formatRate(stats.stats.p2)}</b></div>
          <div><b>{formatRate(stats.stats.f1)}</b><span>Fighter form</span><b>{formatRate(stats.stats.f2)}</b></div>
          <div><b>{formatRate(stats.stats.c1)}</b><span>Character form</span><b>{formatRate(stats.stats.c2)}</b></div>
          <div><b>{formatRate(stats.stats.p1vp2)}</b><span>Head to head</span><b>{formatRate(stats.stats.p2vp1)}</b></div>
        </div>}
        <div className="commentary">{commentary || "Bring in the AI ring announcer for a one-of-a-kind match introduction."}</div>
        <button className="primary wide" disabled={busy} onClick={hype}>{busy ? "Building the hype..." : "Generate match introduction"}</button>
        <ErrorMessage message={error} />
      </section>
    </div>
  );
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem("authToken") || "");
  const [user, setUser] = useState(null);
  const [games, setGames] = useState([]);
  const [characters, setCharacters] = useState([]);
  const [tournaments, setTournaments] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [profileStats, setProfileStats] = useState(null);
  const [history, setHistory] = useState([]);
  const [createForm, setCreateForm] = useState(emptyTournament);
  const [joinCharacter, setJoinCharacter] = useState("");
  const [inspectedMatch, setInspectedMatch] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState("arena");

  const loadTournaments = useCallback(async () => {
    const data = await apiRequest("/api/tournaments", { token });
    setTournaments(data);
    setSelectedId((current) => current || data[0]?.id || null);
  }, [token]);

  const loadDetail = useCallback(async (id, quiet = false) => {
    if (!id) return;
    try { setDetail(await apiRequest(`/api/tournaments/${id}`, { token })); }
    catch (requestError) { if (!quiet) setError(requestError.message); }
  }, [token]);

  const loadProfile = useCallback(async () => {
    const [statsData, historyData] = await Promise.all([
      apiRequest("/api/me/stats", { token }), apiRequest("/api/me/history", { token }),
    ]);
    setProfileStats(statsData); setHistory(historyData);
  }, [token]);

  useEffect(() => {
    if (!token) return;
    Promise.all([apiRequest("/api/me", { token }), apiRequest("/api/games", { token })])
      .then(([me, gameData]) => {
        setUser(me); setGames(gameData);
        setCreateForm((form) => ({ ...form, gameId: String(gameData[0]?.id || "") }));
      }).catch(() => logout());
  }, [token]);

  useEffect(() => {
    if (!user) return;
    loadTournaments().catch((e) => setError(e.message));
    loadProfile().catch((e) => setError(e.message));
  }, [user, loadTournaments, loadProfile]);

  useEffect(() => { if (selectedId) loadDetail(selectedId); }, [selectedId, loadDetail]);

  useEffect(() => {
    if (!selectedId) return;
    const timer = window.setInterval(() => { loadDetail(selectedId, true); loadTournaments().catch(() => {}); }, 5000);
    return () => window.clearInterval(timer);
  }, [selectedId, loadDetail, loadTournaments]);

  useEffect(() => {
    const gameId = detail?.tournament.game_id || Number(createForm.gameId);
    if (!gameId) return;
    apiRequest(`/api/games/${gameId}/characters`, { token }).then(setCharacters).catch(() => setCharacters([]));
  }, [detail?.tournament.game_id, createForm.gameId, token]);

  function authenticated(data) {
    localStorage.setItem("authToken", data.token); setToken(data.token); setUser(data.user);
  }

  function logout() {
    localStorage.removeItem("authToken"); setToken(""); setUser(null); setDetail(null); setSelectedId(null);
  }

  async function mutate(action) {
    setBusy(true); setError("");
    try { await action(); await Promise.all([loadTournaments(), selectedId ? loadDetail(selectedId) : Promise.resolve(), loadProfile()]); }
    catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  }

  async function createTournament(event) {
    event.preventDefault();
    await mutate(async () => {
      const created = await apiRequest("/api/tournaments", { method: "POST", token, body: { ...createForm, gameId: Number(createForm.gameId), numPrelimMatches: Number(createForm.numPrelimMatches), eliminationType: "single" } });
      setSelectedId(created.id); setCreateForm((form) => ({ ...form, name: "Friday Night Fights" })); setView("arena");
    });
  }

  function joinTournament() {
    mutate(() => apiRequest(`/api/tournaments/${selectedId}/join`, { method: "POST", token, body: { characterId: joinCharacter ? Number(joinCharacter) : undefined } }));
  }

  function recordResult(match, fighterId) {
    mutate(() => apiRequest(`/api/matches/${match.id}/result`, { method: "POST", token, body: { winnerFighterId: fighterId } }));
  }

  function undoResult(match) {
    mutate(() => apiRequest(`/api/matches/${match.id}/undo`, { method: "POST", token }));
  }

  if (!token || !user) return <AuthScreen onAuthenticated={authenticated} />;

  return (
    <div className="app-shell">
      <header>
        <button className="brand" onClick={() => setView("arena")}><span>TL</span><b>Tournament Legends</b></button>
        <nav><button className={view === "arena" ? "active" : ""} onClick={() => setView("arena")}>Arena</button><button className={view === "history" ? "active" : ""} onClick={() => setView("history")}>My record</button></nav>
        <div className="user-chip"><div><b>{user.username}</b><small>{profileStats?.wins || 0}W · {profileStats?.losses || 0}L</small></div><button onClick={logout}>Exit</button></div>
      </header>

      {view === "arena" ? <main className="dashboard">
        <aside>
          <div className="aside-heading"><div><span className="eyebrow">Circuits</span><h2>Tournaments</h2></div><button className="icon-button" onClick={loadTournaments}>↻</button></div>
          <div className="tournament-list">{tournaments.map((t) => <TournamentCard key={t.id} tournament={t} active={selectedId === t.id} onClick={() => setSelectedId(t.id)} />)}{!tournaments.length && <div className="empty-state">No tournaments yet. Host the first one.</div>}</div>
          <form className="create-form" onSubmit={createTournament}>
            <h3>Host a tournament</h3>
            <label>Name<input value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} /></label>
            <label>Game<select value={createForm.gameId} onChange={(e) => setCreateForm({ ...createForm, gameId: e.target.value })}>{games.map((game) => <option value={game.id} key={game.id}>{game.name}</option>)}</select></label>
            <label>Opening matches<select value={createForm.numPrelimMatches} onChange={(e) => setCreateForm({ ...createForm, numPrelimMatches: e.target.value })}><option value="4">4 (8 fighters)</option><option value="8">8 (16 fighters)</option><option value="16">16 (32 fighters)</option></select></label>
            <button className="primary wide" disabled={busy}>Create tournament</button>
          </form>
        </aside>

        <section className="arena">
          <ErrorMessage message={error} />
          {detail ? <>
            <div className="hero-row"><div><span className="eyebrow">{detail.tournament.game_name} · single elimination</span><h1>{detail.tournament.name}</h1><p>Hosted by {detail.tournament.owner_username} · {detail.tournament.entrant_count}/{detail.tournament.capacity} fighters</p></div><span className={`status large ${detail.tournament.status}`}>{detail.tournament.status.replace("_", " ")}</span></div>
            {detail.tournament.status === "pending" && !detail.joined && <div className="join-banner"><div><b>Answer the call</b><span>Choose your main, or let fate pick at random.</span></div><select value={joinCharacter} onChange={(e) => setJoinCharacter(e.target.value)}><option value="">Random character</option>{characters.map((character) => <option value={character.id} key={character.id}>{character.name}</option>)}</select><button className="primary" disabled={busy} onClick={joinTournament}>Join bracket</button></div>}
            {detail.joined && detail.tournament.status === "pending" && <div className="notice">You are locked in. Waiting for {detail.tournament.capacity - detail.tournament.entrant_count} more challenger(s).</div>}
            <Bracket detail={detail} onResult={recordResult} onUndo={undoResult} onInspect={setInspectedMatch} busy={busy} />
            <section className="entrants"><h2>Fighter roster</h2><div>{detail.fighters.map((fighter) => <span key={fighter.id}><b>{fighter.username}</b>{fighter.character_name}</span>)}</div></section>
          </> : <div className="empty-state hero-empty">Choose a tournament or create a new circuit.</div>}
        </section>
      </main> : <main className="record-page">
        <div className="hero-row"><div><span className="eyebrow">Career ledger</span><h1>{user.username}'s record</h1></div><div className="record-total"><b>{formatRate(profileStats?.winRate ?? 50)}</b><span>career win rate</span></div></div>
        <div className="record-cards"><div><b>{profileStats?.fights || 0}</b><span>Total fights</span></div><div><b>{profileStats?.wins || 0}</b><span>Wins</span></div><div><b>{profileStats?.losses || 0}</b><span>Losses</span></div></div>
        <section className="history-list"><h2>Fight history</h2>{history.map((fight) => { const won = fight.winner_user_id === user.id; return <article key={fight.id}><span className={won ? "result-win" : "result-loss"}>{won ? "WIN" : "LOSS"}</span><div><b>{fight.winner_username} ({fight.winner_character_name})</b><span>defeated {fight.loser_username} ({fight.loser_character_name})</span></div><small>{fight.tournament_name}</small></article>; })}{!history.length && <div className="empty-state">No completed fights yet.</div>}</section>
      </main>}
      {inspectedMatch && <MatchInspector match={inspectedMatch} token={token} onClose={() => setInspectedMatch(null)} />}
    </div>
  );
}
