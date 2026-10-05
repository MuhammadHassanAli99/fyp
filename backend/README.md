# Backend API

Node.js + TypeScript + Express + MySQL (`uids`).

## Setup

```bash
cd backend
cp .env.example .env   # set DB_PASSWORD etc.
npm install
npm run dev
```

API: `http://localhost:3000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health + DB check |
| GET/POST | `/api/platforms` | List / create platforms |
| GET/PUT/DELETE | `/api/platforms/:id` | Read / update / delete |
| GET/POST | `/api/users` | List / create users |
| GET/PUT/DELETE | `/api/users/:id` | Read / update / delete |
| GET/POST | `/api/entities` | List / create entities |
| GET/PUT/DELETE | `/api/entities/:id` | Read / update / delete |
| GET/POST | `/api/idps` | List / create IdPs |
| GET/PUT/DELETE | `/api/idps/:id` | Read / update / delete |

## Scripts

- `npm run dev` – watch mode (`tsx`)
- `npm run build` – compile to `dist/`
- `npm start` – run compiled output
