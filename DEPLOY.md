Hosting and Deployment (quick guide)

This repository contains a Node + static site. The server entrypoint is `server.js` and the `start` script in `package.json` runs `node server.js`.

Recommended options

1) Render (recommended for ease)
- Create a new Web Service in Render and connect your GitHub repo.
- Build command: `npm install`
- Start command: `npm start`
- Add environment variables in Render dashboard:
  - `JWT_SECRET` (string)
  - `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` (optional)
- Render provides automatic TLS and a stable domain.

2) Railway
- Create a new project, import repo, set start command `npm start` and add env vars.

3) Self-host using PM2 (Linux)
- On the server:
  ```bash
  git clone <repo>
  cd repo
  npm install --production
  cp .env.example .env   # edit .env with secrets
  npm start
  # for permanent background process
  npm install -g pm2
  pm2 start server.js --name sanju-site
  pm2 save
  pm2 startup
  ```

4) Using systemd
- Create a `sanju-site.service` unit that runs `node server.js` under a dedicated user.

Healthcheck
- The server exposes `/health` returning `{ok:true}` for load balancers and uptime checks.

Notes
- Do NOT commit real `.env` files. Use the platform's env var settings.
- If you expect uploads to be persistent across deployments, configure object storage (S3) and update the code to store files there.

If you'd like, I can create a ready `systemd` unit file or PM2 ecosystem file and help you set up a Render deployment.
