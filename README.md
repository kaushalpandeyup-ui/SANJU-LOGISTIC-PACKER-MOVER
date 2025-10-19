Sanju Local Server

Quick start

1. Install dependencies:

```powershell
npm install
```

2. Copy `.env.example` to `.env` and fill SMTP/JWT config if you have it. If not provided, the server uses Ethereal (dev) which returns a preview URL for sent emails.

3. Start the server:

```powershell
npm start
```

4. Open the site in your browser (best to use the server URL):

http://localhost:3000/login.html

Notes

- The project uses `sql.js` (WASM) for SQLite persistence; the database file is saved to `data/app.db`.
- For real emails, set `SMTP_HOST`, `SMTP_USER`, and `SMTP_PASS` in `.env`. Otherwise, signup will return an `emailPreviewUrl` (Ethereal).
- JWT secret should be set in `.env` as `JWT_SECRET` for production.
