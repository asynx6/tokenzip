# Trusted publishing — tokenzip ke npm tanpa OTP selamanya

Tujuannya: tiap kali tag `v*` di-push, GitHub Actions yang publish ke npm.
Tanpa token, tanpa OTP, dapat badge provenance ("publish dari CI, verified").
Ini jalur resmi npm yang namanya [trusted publishing](https://docs.npmjs.com/trusted-publishing)
(OIDC — npm mempercayai identitas runner GitHub, bukan password).

Kamu cuma perlu login sekali ke dua web (5 menit), sisanya permanen.

## A. GitHub — bikin environment "npm"

1. Buka https://github.com/asynx6/tokenzip/settings/environments
2. **New environment** → nama persis: `npm` → Create
3. Jangan tambah approval rules apa-apa (kosongkan required reviewers).

## B. npm — daftarkan trusted publisher

1. Buka halaman package: https://www.npmjs.com/package/@asynx6/tokenzip
   (pasti login sebagai asynx6)
2. Tab **Settings** → bagian **Trusted Publisher** → **Add trusted publisher**
   → pilih **GitHub Actions**
3. Isi tiga kolom itu:
   - Repository: `asynx6/tokenzip`
   - Workflow name: `release.yml`
   - Environment name: `npm`
   (Workflow = path `.github/workflows/release.yml`; Environment = hasil A.
   Kalau environment tidak muncul di daftar npm, tunggu 1–2 menit lalu refresh.)
4. Save.

## C. Publish v0.3.0 pertama (satu kali, masih butuh OTP)

Aturan npm saat ini: "publish from web UI or automation only" belum aktif,
jadi satu publish pertama tetap minta 2FA. Dua pilihan:

- **Paling gampang:** buka `https://www.npmjs.com/package/@asynx6/tokenzip/upload-version`
  sambil login, isi `package.json` + tarball (`npm pack` → file
  `asynx6-tokenzip-0.3.0.tgz`), selesaikan OTP. Selesai, tanpa aku.
- **Atau:** kirim kode OTP 6-digit ke aku pas siap — aku jalankan
  `npm publish --otp=<kode>` detik itu juga (kodenya cuma hidup 30 detik).

## D. Verifikasi

```
git push origin v0.3.1        # bump kecil apa pun
```
→ lihat tab Actions: workflow **Release** jalan → `npm test` →
`npm publish --provenance` → versi baru nongol di registry **tanpa OTP**.
Provenance verified kalau di `npm audit signatures` / halaman package
muncul link run GitHub-nya.

## Kenapa bukan cara lain

- **NPM_TOKEN biasa**: masih kena "publish dari token automation" diblokir
  kecuali granular access-nya diubah manual — dan token itu rahasia yang
  bocor lebih gampang daripada OIDC per-run. Trusted publishing lebih aman
  dan gak ada yang expired.
- **npm token --type=automation + "Publish from automation only"**: juga
  jalan tanpa OTP, tapi lo harus matikan 2FA-publish di Security Settings
  (turunkan keamanan akun), dan token tetap token. Skip.

## File terkait

- `.github/workflows/release.yml` — sudahcommitted, trigger `v*`,
  `permissions.id-token: write` (OIDC), `environment: npm`,
  `npm publish --provenance --access public`.
- `package.json` — `publishConfig.access: public` sudah ada (scoped package).
