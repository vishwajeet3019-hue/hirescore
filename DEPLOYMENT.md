# Deployment Guide (GoDaddy Domain)

This project has two apps:
- `frontend`: Next.js app
- `backend`: FastAPI API

Recommended setup:
- Host frontend on Vercel
- Host backend on Render
- Point your GoDaddy domain to both (`@`/`www` for frontend, `api` subdomain for backend)

## 1) Deploy Backend (Render)

1. Push this repo to GitHub.
2. In Render, create a new **Web Service** from this repo.
3. Set root directory to `backend`.
4. Configure:
- Build command: `pip install -r requirements.txt`
- Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
5. Add environment variables:
- `OPENAI_API_KEY=...`
- `CORS_ALLOW_ORIGINS=https://yourdomain.com,https://www.yourdomain.com`
6. Deploy and note your Render URL, e.g. `https://hirescore-api.onrender.com`.

## 2) Deploy Frontend (Vercel)

1. In Vercel, import this repo.
2. Set root directory to `frontend`.
3. Add environment variable:
- `NEXT_PUBLIC_API_BASE_URL=https://api.yourdomain.com`
4. Deploy and confirm Vercel URL works.

## 3) Connect GoDaddy DNS

In GoDaddy DNS Management:

1. Frontend (Vercel):
- `A` record: host `@` -> `76.76.21.21`
- `CNAME` record: host `www` -> `cname.vercel-dns.com`

2. Backend API:
- `CNAME` record: host `api` -> your Render hostname (for example `hirescore-api.onrender.com`)

3. In Vercel domain settings, add:
- `yourdomain.com`
- `www.yourdomain.com`

4. In Render custom domains, add:
- `api.yourdomain.com`

## 4) Final Verification

1. API health:
- Open `https://api.yourdomain.com/`
- Expect: `{ "message": "Hirescore backend running" }`

2. Frontend:
- Open `https://yourdomain.com/upload`
- Run analysis and build flows

3. CORS check:
- If browser shows CORS errors, re-check `CORS_ALLOW_ORIGINS` exactly matches both domains.

## Notes

- DNS propagation can take a few minutes up to 24 hours.
- If you change API domain later, update `NEXT_PUBLIC_API_BASE_URL` in Vercel and redeploy.
