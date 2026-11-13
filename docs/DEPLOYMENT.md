# Deploying the hosted demo

This page shows how to put OpenTexila on one server with HTTPS. It uses Docker Compose and Caddy. The demo runs for about 2 months. The accounts are in [Hosted demo: accounts and data](PRODUCTION_DEMO_ACCOUNTS.md).

## What runs

```text
browser --HTTPS--> Caddy (ports 80, 443) --> Nginx (Vue app, /api/ passed on) --> API --> MySQL
```

- **One address.** The page and the API use the same domain, so the sign-in cookies work. The API has no CORS, so do not host the page and the API on different domains.
- **Only Caddy is open to the internet.** MySQL and the API have no published ports.
- **HTTPS is needed.** The production cookies are `Secure` with a `__Host-` name, and the browser only gives location access on HTTPS.
- **Caddy gets the certificate by itself** from Let's Encrypt, and renews it. The certificates are kept in a Docker volume.

Files: `docker-compose.prod.yml`, `deploy/Caddyfile`, `.env.production.example`, and the `production` target in `Dockerfile`. The frontend image comes from `../frontend/Dockerfile` (target `production`).

## Before you start

1. A server with Docker and the Compose plugin. A small Linux server is enough (for example an AWS EC2 `t3.small` with 2 GB of memory, or a `t3.micro` with 1 GB plus swap, and a 20 GB disk).
2. A domain name. Add an **A record** that points to the server's public IP address. On EC2, use an Elastic IP, so the address does not change.
3. Open ports **80** and **443** to the internet (the security group on EC2). Port 80 is needed for the certificate check. Open port 22 only for your own IP.
4. The `backend` and `frontend` repositories next to each other on the server, for example:

```text
~/opentexila/backend
~/opentexila/frontend
```

### Small server (1 GB of memory)

Add swap first, or the image build can run out of memory. Use 4 GB on a `t3.micro`:

```bash
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Build one image at a time: `docker compose --env-file .env.production -f docker-compose.prod.yml build api` and then `... build web`, before `up -d`.

## Steps

1. Go to the backend folder and create the settings file:

```bash
cd ~/opentexila/backend
cp .env.production.example .env.production
```

2. Edit `.env.production`. Set `DOMAIN`, `ACME_EMAIL`, `DB_PASSWORD`, `DB_ROOT_PASSWORD` and `JWT_SECRET`. Create the secrets with `openssl rand -base64 48`. Never commit this file.

3. Build and start:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

The database starts first, then the migrations run, then the API, the web app and Caddy. The first start takes a few minutes.

4. Load the demo data. Do this **once**, on the empty database:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm api \
  node --experimental-strip-types --no-warnings database/seeds/production.ts
```

It prints the counts. It stops with an error if the database already has users.

5. Open `https://<your domain>` and sign in with `admin@example.com`. Then check the live demo (see below).

## Check that it works

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml ps
docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail 50 caddy
```

All services should be `running` (`healthy` for `db`, `api` and `web`). If the certificate fails, the log of `caddy` says why. The usual causes are a wrong DNS record or a closed port 80 or 443.

## Before a demo

Reset the live check-in class, so all ten students are Pending again:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm api \
  node --experimental-strip-types --no-warnings scripts/reset-live-demo.ts
```

## Update to a new version

```bash
cd ~/opentexila/backend && git pull
cd ../frontend && git pull
cd ../backend
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

New migrations run by themselves. Do not run the seed again.

## Start again from zero

This **deletes all data**, including the certificates:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml down -v
```

Then do steps 3 and 4 again. The new seed uses the date of that day.

## Back up and stop

- Back up the database: `docker compose --env-file .env.production -f docker-compose.prod.yml exec db sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' > backup.sql`
- When the demo period ends, stop the server (or delete it) so it does not cost money.

## Notes

- **Sign-in limit.** The API limits sign-in attempts for each IP address. `TRUST_PROXY_HOPS=2` (set in the compose file) makes the API see the real address behind Caddy and Nginx.
- **No dev sign-in.** `DEV_AUTH_ENABLED` is off. People sign in with email and password (JWT mode).
- **Time zone.** `INSTITUTION_TIMEZONE` defaults to `Australia/Melbourne`. The database and the API use UTC.
- **Mercury.** This setup does not run on Mercury (shared hosting). It needs a server where you can run Docker.
