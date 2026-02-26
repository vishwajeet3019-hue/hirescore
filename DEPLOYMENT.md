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
3. Render will create services `hirescore-api` (prod) and `hirescore-api-staging` (staging) using:
- Root dir: `backend`
- Build: `pip install -r requirements.txt`
- Start: `uvicorn main:app --host 0.0.0.0 --port $PORT`
4. In Render service environment variables, set:
- `OPENAI_API_KEY=...`
- `AUTH_TOKEN_SECRET=<long-random-secret>`
- `ADMIN_API_KEYS=<one-or-more-admin-keys-comma-separated>`
- `AUTH_DB_PATH=/var/data/hirescore_auth.db`
- `CORS_ALLOW_ORIGINS=https://hirescore.in,https://www.hirescore.in`
- Optional for preview testing:
- `CORS_ALLOW_ORIGIN_REGEX=https://.*\.vercel\.app`
5. Enable persistent storage in Render (already defined in `render.yaml`):
- mount path: `/var/data`
- db file path: `/var/data/hirescore_auth.db`
6. Optional payments (Stripe):
- `STRIPE_SECRET_KEY=...`
- `STRIPE_WEBHOOK_SECRET=...`
- `PAYMENT_SUCCESS_URL=https://hirescore.in/pricing?payment=success`
- `PAYMENT_CANCEL_URL=https://hirescore.in/pricing?payment=cancelled`
7. Email OTP + welcome emails:
- `EMAIL_OTP_REQUIRED=true`
- `OTP_SIGNING_SECRET=<random-secret>`
- `EMAIL_SMTP_HOST=<smtp-host>`
- `EMAIL_SMTP_PORT=587`
- `EMAIL_SMTP_USE_TLS=true`
- `EMAIL_SMTP_USERNAME=<smtp-username>`
- `EMAIL_SMTP_PASSWORD=<smtp-password>`
- `EMAIL_SMTP_FROM=no-reply@hirescore.in`
- `EMAIL_SMTP_FROM_NAME=HireScore`
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

1. Deploy via Render Blueprint (`render.yaml`) so `hirescore-api-staging` is created automatically.
2. Set `OPENAI_API_KEY` for `hirescore-api-staging`.
3. Confirm staging env values are present:
- `CORS_ALLOW_ORIGINS=https://staging.hirescore.in`
- `BYPASS_PLAN_LIMITS=true`
- `BYPASS_PLAN_AS=elite`
- `AUTH_DB_PATH=/var/data/hirescore_auth.db`
4. Add Render custom domain:
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

## 7) Admin + Analytics + Feedback

- Admin dashboard URL: `https://hirescore.in/admin` (or staging equivalent).
- Enter the value configured in `ADMIN_API_KEYS` to unlock admin endpoints.
- Admin can:
  - view user analytics/events/feedback/credit transactions,
  - edit user email/password,
  - set credits directly or apply credit +/- adjustments.
- Passwords are stored hashed; plain-text passwords are not retrievable.
- Mandatory feedback flow:
  - after first analysis, user must submit 1-5 star feedback + comment before next analysis.
- Signup/login security:
  - signup now uses email OTP verification before account creation.
  - welcome email is sent after OTP verification succeeds.
  - forgot-password flow uses email OTP reset.
