# Tournament Legends

Tournament Legends is a mobile-friendly Street Fighter 6 single-elimination tournament manager. Express owns authentication, bracket state, fight history, statistics, and OpenAI calls; React renders the reconnect-safe server state.

## Run

```bash
pnpm install
pnpm build
pnpm start
```

The production server listens on port `5000` by default and serves `client/dist`. For separate development servers, run `pnpm dev` at the root and `pnpm dev` in `client/`; Vite proxies `/api` to port `5000`.

Copy `.env.example` to `.env` or configure equivalent environment variables:

- `DATABASE_PATH`: SQLite file location; defaults to `data/tournament-legends.sqlite`.
- `JWT_SECRET`: required as a strong random value in production.
- `OPENAI_API_KEY`: optional; commentary returns `503` when it is absent.
- `OPENAI_MODEL`: configurable Responses API model; defaults to `gpt-5.6-luna`.
- `PORT`: defaults to `5000`.

## Implemented API

- Authentication: `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/me`
- Catalog: `GET /api/games`, `GET /api/games/:id/characters`
- Tournaments: `POST /api/tournaments`, `GET /api/tournaments`, `GET /api/tournaments/:id`, `POST /api/tournaments/:id/join`, `GET /api/tournaments/:id/next-match`
- Matches: `POST /api/matches/:id/result`, `POST /api/matches/:id/undo`, `GET /api/matches/:id/stats`, `POST /api/matches/:id/commentary`
- Career: `GET /api/me/stats`, `GET /api/me/history`

Result and undo mutations are host-only and transactional. Undo recursively clears every completed downstream match whose participant became invalid. Match responses include dynamically resolved `fighterA`, `fighterB`, and `ready` fields.

Statistics use a neutral `50` percent fallback whenever an overall or head-to-head sample has no history. The twelve values are returned in the blueprint's exact insertion order and as the `ordered` array.

## Deferred

Double elimination remains schema-reserved but cannot be created. Live updates use five-second client polling. SQLite access is isolated in `src/db.js` so a later database adapter can preserve route behavior.

Run `pnpm test` for the full eight-player bracket lifecycle, authorization, history/statistics, and cascading-undo integration coverage.
