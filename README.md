# NEUROQUEST

**The Cognitive Challenge Arena** — a team-based gamification and cognitive assessment platform.

## What is included
- Team-name + password authentication; participant email login is not used.
- Infinite practice mode with dynamically generated challenge variations.
- Server-authoritative scoring.
- Unattempted and timed-out questions receive **0 marks** and advance automatically.
- Visual challenge surfaces for Grid, Motion, Inductive, Deductive, NumBubbles, Short Cuts, Resemble and Tally Up.
- Live admin dashboard using real database records only: teams, attempts, attempted questions, correct answers, scores and recent activity.
- Admin account configured through environment variables; no admin password is committed to source control.
- Express security middleware, compression, rate limiting and health endpoint.
- Vite production build served by the Node/Express server.

## Local development

```bash
npm install
npm test
npm run dev
```

Open `http://localhost:5173`.

## Local production check

Create `.env` from `.env.example` and set a strong `JWT_SECRET` and `ADMIN_PASSWORD`, then:

```bash
npm install
npm run build
npm start
```

Open `http://localhost:3000`.

## Production deployment

### Architecture (Hybrid: Vercel + Render)

- **Frontend (Vercel)**: React + Vite application served globally from Vercel's Edge CDN. Configured via `vercel.json`.
- **Backend (Render)**: Node.js + Express API with persistent disk storage for SQLite database. Configured via `render.yaml`.

---

### Step 1: Deploy Backend on Render (Database & API)

1. Go to [Render Dashboard](https://dashboard.render.com).
2. Click **New +** -> **Web Service** (or **Blueprint** and select this repository).
3. Set:
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Persistent Disk**: Mount path `/opt/render/project/src/server/data`, Size `1 GB` (or use the pre-configured `render.yaml`).
4. Set Environment Variables on Render:
   - `NODE_ENV=production`
   - `JWT_SECRET` — long random secret, at least 32 characters
   - `ADMIN_TEAM` — the admin team/username
   - `ADMIN_PASSWORD` — the admin password
   - `CORS_ORIGIN` — your Vercel URL (e.g. `https://your-neuroquest.vercel.app` or leave unset during initial setup)
5. Copy your Render backend URL (e.g., `https://neuroquest-backend.onrender.com`).

---

### Step 2: Deploy Frontend on Vercel

1. Go to [Vercel Dashboard](https://vercel.com/new).
2. Import your GitHub repository (`NEUROQUEST-R1`).
3. Vercel will automatically read `vercel.json` (build command: `npm run build`, output directory: `client/dist`).
4. In the **Environment Variables** section on Vercel, add:
   - **Key**: `VITE_API_URL`
   - **Value**: `https://your-backend.onrender.com` (your backend URL from Step 1, without trailing slash)
5. Click **Deploy**.
6. Once deployed, copy your Vercel URL and update `CORS_ORIGIN` in your Render backend settings.

---

### Important database note
This release uses SQLite with a persistent filesystem path. On Render, keep the persistent disk enabled; do not remove the disk or the live database can be lost when the service is replaced. For a larger multi-instance production deployment, migrate the database layer to PostgreSQL before scaling horizontally.

## Source of challenge design
The challenge set and terminology are based on the supplied assessment material, including Grid Challenge, Motion Challenge, NumBubbles, Short Cuts, Resemble and Tally Up. The platform's infinite mode generates new variations rather than being limited to the seeded round count.
