# Deploy MyAssist — BackEnd (Render)

API NestJS di-deploy ke [Render](https://render.com). Database & storage tetap pakai **Supabase** yang sudah ada.

Repo: [varseeker/myassist-backend](https://github.com/varseeker/myassist-backend)

---

## 1. Push kode ke GitHub

```bash
cd BackEnd
git add .
git commit -m "Prepare production deploy"
git push -u origin main
```

---

## 2. Buat Web Service di Render

1. Login [dashboard.render.com](https://dashboard.render.com)
2. **New +** → **Blueprint** (atau **Web Service**)
3. Connect repo `varseeker/myassist-backend`
4. Jika pakai **Blueprint**, Render membaca `render.yaml` otomatis
5. Jika manual:
   - **Runtime:** Node
   - **Build Command:** `npm install --include=dev && npm run build:render`
   - **Start Command:** `npm run start:prod`
   - **Health Check Path:** `/api/v1/health`
   - **Region:** Singapore (dekat Supabase `ap-southeast-1`)

---

## 3. Environment Variables (Render Dashboard)

Salin dari `.env` lokal Anda (jangan commit `.env`):

| Variable | Contoh / catatan |
|----------|------------------|
| `NODE_ENV` | `production` |
| `API_PREFIX` | `api/v1` |
| `DATABASE_URL` | Supabase Transaction pooler (port 6543) |
| `DIRECT_URL` | Supabase Session pooler (port 5432) |
| `SUPABASE_URL` | `https://xxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret key (server only) |
| `SUPABASE_PUBLISHABLE_KEY` | Publishable key |
| `SUPABASE_JWKS_URL` | `https://xxx.supabase.co/auth/v1/.well-known/jwks.json` |
| `SUPABASE_STORAGE_BUCKET` | `ticket-attachments` |
| `STORAGE_DRIVER` | `supabase` |
| `JWT_ACCESS_SECRET` | Random string panjang |
| `JWT_REFRESH_SECRET` | Random string panjang (beda dari access) |
| `JWT_ACCESS_EXPIRES_IN` | `15m` |
| `JWT_REFRESH_EXPIRES_IN` | `7d` |
| `CORS_ORIGIN` | URL frontend Vercel, mis. `https://myassist-frontend.vercel.app` |
| `APP_URL` | URL backend Render, mis. `https://myassist-backend.onrender.com` |

> **Penting:** `CORS_ORIGIN` harus persis URL frontend (tanpa slash di akhir).  
> `APP_URL` = URL publik backend (untuk signed download URL).

---

## 4. Setelah deploy

- API: `https://<nama-service>.onrender.com/api/v1`
- Health: `https://<nama-service>.onrender.com/api/v1/health`
- Swagger: `https://<nama-service>.onrender.com/docs`

Catat URL backend — dipakai saat deploy FrontEnd.

---

## 5. Seed database (opsional, sekali)

Di Render **Shell** atau lokal dengan `DATABASE_URL` production:

```bash
npx prisma db seed
```

---

## Troubleshooting

| Masalah | Solusi |
|---------|--------|
| Build gagal `nest: not found` | `NODE_ENV=production` skip devDeps — pakai `npm install --include=dev` di build command |
| Build gagal `tenant/user postgres.xxx not found` | **Env Supabase salah / project paused.** Buka Supabase → Connect → Connection pooling, salin ulang host (bisa `aws-0-...` atau `aws-1-...`). Set `DIRECT_URL` = Session `:5432`, `DATABASE_URL` = Transaction `:6543?pgbouncer=true`. Username pooler = `postgres.<PROJECT_REF>`. Pastikan project tidak di-pause. Uji lokal: `npm run db:test-connection` lalu `npm run db:preflight` |
| Build gagal Prisma lain | Pastikan `DATABASE_URL` & `DIRECT_URL` sudah di-set di Render **tanpa** tanda kutip |
| Bucket not found | Pastikan `SUPABASE_SERVICE_ROLE_KEY` valid; bucket dibuat otomatis saat startup |
| CORS error | Update `CORS_ORIGIN` dengan URL frontend yang benar |
| Cold start lambat | Normal di plan Free Render (~30 detik) |

### Format URL yang benar (Supabase)

Jangan menebak host. Salin dari dashboard:

```text
# Runtime (NestJS / Prisma Client)
DATABASE_URL=postgresql://postgres.<REF>:<PASSWORD>@aws-X-<REGION>.pooler.supabase.com:6543/postgres?pgbouncer=true&sslmode=require

# Migrations (prisma migrate deploy)
DIRECT_URL=postgresql://postgres.<REF>:<PASSWORD>@aws-X-<REGION>.pooler.supabase.com:5432/postgres?sslmode=require
```

Error `FATAL: tenant/user postgres.<REF> not found` artinya host pooler tidak mengenal project itu (salah region/shard, project diganti, atau project di-pause) — perbaiki env di Render, bukan kode TypeScript.

---

## 6. Messaging (WhatsApp Baileys + Telegram)

| Variable | Catatan |
|----------|---------|
| `FRONTEND_URL` | URL Vercel frontend (link di pesan) |
| `MESSAGING_WHATSAPP_DRIVER` | `baileys` (default) / `meta` (future) / `off` |
| `BAILEYS_AUTH_PATH` | Default `.baileys-auth` (butuh disk persist di Render) |
| `BAILEYS_AUTO_CONNECT` | `true` / `false` |
| `WHATSAPP_MIN_INTERVAL_MS` | Jeda minimum antar kirim (default `5000`) |
| `WHATSAPP_JITTER_MS` | Random ekstra jeda (default `2000`) |
| `WHATSAPP_PER_RECIPIENT_COOLDOWN_MS` | Cooldown per nomor (default `90000`) |
| `WHATSAPP_MAX_PER_HOUR` | Cap per jam (default `25`) |
| `WHATSAPP_MAX_PER_DAY` | Cap per hari (default `120`) |
| `MESSAGING_TELEGRAM_ENABLED` | `true` / `false` |
| `TELEGRAM_BOT_TOKEN` | Dari @BotFather |
| `TELEGRAM_BOT_USERNAME` | Username bot tanpa `@` |
| `OPS_ALERT_ENABLED` | `true` / `false` — alert ops ke Telegram admin |
| `OPS_ALERT_COOLDOWN_MS` | Anti-spam (default `300000` = 5 menit) |
| `OPS_ALERT_TELEGRAM_CHAT_IDS` | Opsional chat ID ekstra (comma-separated) |
| `OPS_ALERT_NOTIFY_STARTUP` | `true` untuk alert saat API start (default `false`) |

### Ops alerts (Telegram admin)

Backend mengirim notifikasi Telegram ke **user role ADMIN** yang sudah menautkan Telegram, saat:

- HTTP 5xx / error server
- Database disconnect / health gagal
- Uncaught exception / unhandled rejection
- Service shutdown (SIGTERM/SIGINT)
- Opsional: service start (`OPS_ALERT_NOTIFY_STARTUP=true`)

Pastikan minimal satu akun ADMIN sudah link Telegram (Profile).

Set Telegram webhook setelah deploy:

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<APP_URL>/api/v1/messaging/telegram/webhook"
```

Admin scan QR di halaman frontend **Messaging**. Kiriman WhatsApp diantre + dibatasi agar tidak mudah dianggap spam. Baileys unofficial — tetap ada risiko restrict dari WhatsApp.
