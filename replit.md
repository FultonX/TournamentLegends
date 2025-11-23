# Tournament API

## Overview
This is a Node.js backend API for managing fighting game tournaments with AI-powered commentary. The application supports user authentication, tournament creation, bracket management, and match commentary using OpenAI.

## Recent Changes (Nov 23, 2025)
- Imported GitHub repository and configured for Replit environment
- Created package.json with all required dependencies
- Configured server to run on port 5000 with host 0.0.0.0
- Set up OpenAI API key integration for AI commentary
- Created workflow to start the server automatically
- Added .gitignore for Node.js projects

## Project Architecture

### Tech Stack
- **Runtime**: Node.js 20
- **Framework**: Express.js
- **Database**: SQLite (better-sqlite3)
- **Authentication**: JWT (jsonwebtoken) with bcrypt password hashing
- **AI Integration**: OpenAI API for match commentary
- **CORS**: Enabled for cross-origin requests

### Project Structure
```
.
├── server.js                 # Main server entry point
├── src/
│   ├── db.js                # Database connection and migration runner
│   ├── routes/
│   │   └── api.js           # All API endpoints
│   └── migrations/
│       ├── 001_schema.sql   # Database schema
│       └── 002_seed_sf6.sql # Street Fighter 6 character data
├── package.json
└── .gitignore
```

### Database Schema
- **users**: User accounts with authentication
- **games**: Fighting games (e.g., Street Fighter 6)
- **characters**: Game characters
- **tournaments**: Tournament metadata
- **tournament_fighters**: Participants in tournaments
- **matches**: Bracket matches with sources and winners
- **fights**: Historical fight records for statistics

### API Endpoints

#### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login and get JWT token
- `GET /api/me` - Get current user info (requires auth)

#### Games & Characters
- `GET /api/games` - List all games
- `GET /api/games/:id/characters` - Get characters for a game

#### Tournaments
- `POST /api/tournaments` - Create new tournament
- `GET /api/tournaments` - List tournaments (optional status filter)
- `GET /api/tournaments/:id` - Get tournament details with fighters and matches
- `POST /api/tournaments/:id/join` - Join tournament with character selection
- `GET /api/tournaments/:id/next-match` - Get next unresolved match

#### Matches
- `POST /api/matches/:id/result` - Submit match result
- `POST /api/matches/:id/undo` - Undo match result
- `POST /api/matches/:id/commentary` - Generate AI commentary for a match

## Environment Variables
- `OPENAI_API_KEY` - Required for AI commentary feature
- `JWT_SECRET` - Optional, defaults to 'dev-secret' (should be set in production)
- `PORT` - Optional, defaults to 5000

## Frontend
The server is configured to serve a React frontend from `client/dist`, but no frontend is currently built. The API can be accessed directly at the root URL and all endpoints are under `/api`.

## Future Enhancements
- Build React frontend for tournament management UI
- Implement double-elimination bracket support
- Add more fighting games and characters
- Enhance AI commentary with more context
