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
   - **Build Command:** `npm install && npx prisma generate && npm run build && npx prisma migrate deploy`
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
| Build gagal Prisma | Pastikan `DATABASE_URL` & `DIRECT_URL` sudah di-set |
| Bucket not found | Pastikan `SUPABASE_SERVICE_ROLE_KEY` valid; bucket dibuat otomatis saat startup |
| CORS error | Update `CORS_ORIGIN` dengan URL frontend yang benar |
| Cold start lambat | Normal di plan Free Render (~30 detik) |
