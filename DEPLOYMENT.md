# HireScore Deployment Guide (`hirescore.in`)

Target architecture:
- Frontend (`frontend`) on Vercel
- Backend API (`backend`) on Render
- Custom domains:
- `https://hirescore.in` and `https://www.hirescore.in` -> Vercel
- `https://api.hirescore.in` -> Render

## 1) Backend Deploy (Render)

This repo includes `render.yaml` for the backend service.

1. Push this repo to GitHub.
2. In Render, choose **New +** -> **Blueprint** and connect the repo.
3. Render will create service `hirescore-api` using:
- Root dir: `backend`
- Build: `pip install -r requirements.txt`
- Start: `uvicorn main:app --host 0.0.0.0 --port $PORT`
4. In Render service environment variables, set:
- `OPENAI_API_KEY=...`
- `CORS_ALLOW_ORIGINS=https://hirescore.in,https://www.hirescore.in`
- Optional for preview testing:
- `CORS_ALLOW_ORIGIN_REGEX=https://.*\.vercel\.app`
5. After deploy, add custom domain in Render:
- `api.hirescore.in`

## 2) Frontend Deploy (Vercel)

1. In Vercel, import the same repo.
2. Set **Root Directory** to `frontend`.
3. Set environment variable:
- `NEXT_PUBLIC_API_BASE_URL=https://api.hirescore.in`
4. Deploy.
5. In Vercel project domains, add:
- `hirescore.in`
- `www.hirescore.in`

## 3) DNS Records (Domain Provider)

Create/update these DNS records for `hirescore.in`:

1. `A` record:
- Host: `@`
- Value: `76.76.21.21`

2. `A` record:
- Host: `www`
- Value: `76.76.21.21`

3. `CNAME` record:
- Host: `api`
- Value: `hirescore-backend.onrender.com`

If your provider already has conflicting `@`, `www`, or `api` records, remove the old ones first.

## 4) Verify

1. Backend health:
- `https://api.hirescore.in/`
- Expected JSON: `{"message":"Hirescore backend running"}`

2. Frontend:
- `https://hirescore.in/upload`
- Run one resume analysis and one build flow

3. CORS:
- If browser shows blocked CORS, verify Render env:
- `CORS_ALLOW_ORIGINS=https://hirescore.in,https://www.hirescore.in`

## 5) Local env files

- Backend sample env: `backend/.env.example`
- Frontend sample env: `frontend/.env.example`

Copy these into `.env` files for local development when needed.

## 6) Staging Environment (Unlimited Tester Mode)

Use staging for unrestricted testing across multiple devices.

### Staging domains

- Frontend staging: `staging.hirescore.in` (Vercel preview deployment alias)
- Backend staging: `api-staging.hirescore.in` (separate Render service)

### Create staging backend on Render

1. In Render, create a second web service from the same repo with root `backend`.
2. Suggested name: `hirescore-backend-staging`.
3. Use same build/start commands:
- Build: `pip install -r requirements.txt`
- Start: `uvicorn main:app --host 0.0.0.0 --port $PORT`
4. Set environment variables:
- `OPENAI_API_KEY=...`
- `CORS_ALLOW_ORIGINS=https://staging.hirescore.in`
- `BYPASS_PLAN_LIMITS=true`
- `BYPASS_PLAN_AS=elite`
5. Add Render custom domain:
- `api-staging.hirescore.in`

### Create staging frontend on Vercel

1. Create a preview deployment (do not use `--prod`).
2. Add `staging.hirescore.in` to the Vercel project.
3. Point `staging.hirescore.in` alias to the latest preview deployment.
4. Set Vercel Preview env var:
- `NEXT_PUBLIC_API_BASE_URL=https://api-staging.hirescore.in`
5. Redeploy preview.

### DNS records for staging

Add these records at your DNS provider:

1. `A` record:
- Host: `staging`
- Value: `76.76.21.21`

2. `CNAME` record:
- Host: `api-staging`
- Value: `<your-staging-render-hostname>.onrender.com`

### Verify staging

1. `https://staging.hirescore.in/upload`
2. `https://api-staging.hirescore.in/`
3. `GET /plan-status?plan=free&session_id=test` should report elite-level limits when bypass is enabled.
