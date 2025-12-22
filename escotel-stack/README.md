# Mangwale Ops & Comms Stack

Stack per specs: NestJS backend, Vite React admin, Exotel microservice, and Postgres/Redis/RabbitMQ, all behind Traefik.

## Structure
- `backend/` (NestJS)
- `admin-frontend/` (Vite React)
- `exotel-service/` (Express proxy to Exotel)
- `docker-compose.yml` (services + infra)

## Prereqs
- Docker & Docker Compose
- Traefik running with external Docker network (default `traefik`)

## Setup
```bash
cd Escotel
cp .env.example .env
# edit .env to set hosts and Exotel creds
```

## Run
```bash
docker compose up -d --build
```

- Backend: `https://$BACKEND_HOST/api/v1/health`
- Admin: `https://$ADMIN_HOST/`
- Exotel service: `https://$EXOTEL_HOST/health`

If you're using the shared Traefik on this host, routes are defined via dynamic files in `/home/ubuntu/Devs/Addtional Modules/deploy/traefik/dynamic/`.
This repo includes labels for a generic Traefik setup, but production routing here is managed by the Traefik file provider.

## Verify domain and TLS
```bash
# should 308 redirect to HTTPS
curl -I http://$EXOTEL_HOST/health

# should return 200 over HTTPS (valid cert once ACME completes)
curl -I https://$EXOTEL_HOST/health

# Exotel credentials check (non-billable)
curl https://$EXOTEL_HOST/exotel/auth/check
```

## Dev tips
- Backend dev: `cd backend && npm i && npm run start:dev`
- Frontend dev: `cd admin-frontend && npm i && npm run dev`
- Exotel service dev: `cd exotel-service && npm i && npm run dev`

## Notes
- No host ports are published; Traefik routes by Host rules on the shared network.
- TLS: Traefik must expose entrypoints `web` (80) and `websecure` (443) and have a cert resolver (Let's Encrypt). This server uses `letsencrypt` via the file provider.
- Add more Exotel endpoints under `exotel-service/src/src_routes/exotel.js`.