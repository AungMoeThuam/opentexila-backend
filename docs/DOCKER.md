# Shared development stack

Clone the backend repository, then run from its root:

```sh
npm run stack:up
```

Requires Git, Node.js 22.15.1+ (including npm), and running Docker Desktop with Compose 2.17+ (`dockerfile_inline` support). Host `npm ci` is unnecessary for this command; dependencies are installed inside Linux containers. Host tests, formatting and optional seeding still require `npm ci`; see the [team guide](TEAM_GUIDE.md#6-before-you-push). The first build needs internet access. Authenticate Git with GitHub first if the frontend repository is private.

The command:

1. Creates `.env` from `.env.example` with random local database passwords **only if `.env` is absent**. Existing configuration is preserved.
2. Clones `https://github.com/AungMoeThuam/opentexila.git` into `../frontend` if that path is absent. It uses the remote default branch. An existing OpenTexila frontend checkout is used without pulling, switching branches, resetting or committing it. An unrelated/incomplete directory produces an error.
3. Builds the applications and starts MySQL. Waits for an authenticated database query to succeed.
4. Runs the migration container. Only pending versioned migrations are applied; `synchronize` stays disabled. A failed migration prevents the API from starting on a fresh startup.
5. Starts NestJS with nodemon, then Vue/Vite after the API starts listening. Returns when services are healthy.

The frontend development image is defined inline in this Compose file, so cloning frontend source does not depend on its standalone Dockerfile having been pushed. Both repositories remain separate Git checkouts.

```text
parent/
  backend/                 # This checkout; shared docker-compose.yml
  frontend/                # Automatically cloned if missing; editable checkout
```

Open **http://localhost:5173**. The API is also exposed at **http://localhost:3000/api/v1** for API clients. `/api/*` requests from the browser pass through Vite to `http://backend:3000`, retaining the path. The API connects to `db:3306` on Docker's network; local `.env` values `HOST`, `DB_HOST`, `DB_PORT` and `PORT` do not override these internal addresses. `DB_PORT` controls the host MySQL port only; `BACKEND_PORT` controls the host API port.

## Daily workflow

```sh
npm run stack:up       # Fetch missing frontend, build, start, wait for health
npm run stack:logs     # Follow logs from all services; Ctrl+C exits log viewing
npm run stack:down     # Remove stack containers/network; preserve database volume
docker compose ps -a
```

The stack runs in the background. Once the frontend checkout and `.env` exist, `docker compose up --build` is also available for attached logs. That raw Compose command does not clone repositories or generate configuration.

Edit backend `src/` or frontend `src/` on your machine. They are mounted read-only **inside** containers; your editor can still change the host files. Nest rebuilds/restarts and Vite hot reloads. Linux `node_modules` and compiled backend `dist` stay inside images/containers. Re-run `npm run stack:up` after changing dependencies, migrations or Docker configuration. To apply pending migrations separately, run `docker compose build migrate`, then `docker compose run --rm migrate`. The normal stack command already builds and runs this migration service.

Do not run the frontend repository's standalone Compose services at the same time on the same ports. Its production Nginx build and frontend-only UI workflow remain available separately.

## Configuration

Set these in **backend/.env** or your shell (shell values take precedence):

| Variable                                                | Default                              | Purpose                                                             |
| ------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------- |
| `FRONTEND_DIR`                                          | `../frontend`                        | Existing checkout or destination for cloning; relative to backend   |
| `FRONTEND_REPO_URL`                                     | OpenTexila frontend GitHub URL above | Clone source; used only when the destination is absent              |
| `FRONTEND_DEV_PORT`                                     | `5173`                               | Frontend localhost port                                             |
| `BACKEND_PORT`                                          | `3000`                               | Backend localhost port                                              |
| `DB_PORT`                                               | `3306`                               | MySQL localhost port                                                |
| `FRONTEND_MOCK_AUTH`                                    | `false`                              | Set `true` for isolated UI work; mock mode blocks real API requests |
| `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_ROOT_PASSWORD` | See `.env.example`                   | MySQL initialization and application credentials                    |

Authentication and attendance APIs are still under development. Real API mode will not provide a working login until those endpoints exist. Verify connectivity now with `http://localhost:5173/api/v1/examples/classrooms`; an empty `data` array on a new database is expected. For UI demos, set `FRONTEND_MOCK_AUTH=true`, run `npm run stack:up`, then use the developer role selector. Demo accounts are not automatically seeded.

To update an existing frontend checkout, review and pull its changes yourself, then rerun the stack command. The launcher deliberately does not alter any existing checkout's Git state. Commit frontend work in the frontend repository and backend/infrastructure work here.

## Existing database and optional fixtures

This file retains the `opentexila` project name, `opentexila-db` container name, and `opentexila_mysql_data` volume key used by the original database-only Compose setup. With the default project name, your existing MySQL data is reused. `npm run db:up` and `npm run db:stop` still target just MySQL.

Keep the `.env` credentials that initialized that volume. MySQL initialization variables do not reset users/passwords in an existing database. If `.env` was lost, restore its credentials; newly generated ones will not unlock an old volume. Neither launcher command removes database volumes. Do not add `-v` to `docker compose down` if you need to keep data.

Optional seeding uses the existing **host** workflow, whose safety guard only permits localhost:

```sh
npm ci
# Set a fictional SEED_PASSWORD (12+ characters) in backend/.env.
npm run db:seed
```

Keep host `DB_HOST=127.0.0.1` and `DB_PORT` equal to MySQL's published port for this command. The seed remains explicit and its existing safety guard is unchanged. Sample classroom coordinates are synthetic; see the backend README.

## Troubleshooting

- **Port already in use:** stop the other local server or choose the host ports above, then rerun the stack command.
- **Clone fails:** check GitHub access/URL. If Git left an incomplete directory, inspect it and choose a fresh `FRONTEND_DIR`; the launcher will not delete it.
- **Migration fails:** inspect `docker compose logs migrate`. Fix the migration/configuration and rerun; no automatic rollback or database reset occurs.
- **Startup wait times out:** inspect `docker compose ps -a` and `docker compose logs`. Containers remain available for diagnosis; use `npm run stack:down` to stop them.
- **API health:** the health check verifies Nest is listening after database initialization. It does not prove all feature APIs exist or continually verify MySQL queries.

This is a local development setup. Services publish only on localhost. A deployment needs a production backend runtime, HTTPS and the completed authentication/session configuration.

## Verification

Verified using a fresh clone from GitHub and a separate disposable MySQL volume: all services became healthy, migrations applied, Vue deep routes loaded, and the Vite proxy reached the real sample API/database. Backend reload and frontend HMR were observed. Stopping and restarting retained a test database marker and reported no pending migrations. The 14 backend/launcher tests passed, including preservation of an existing frontend checkout and `.env`. These checks do not imply unfinished authentication or attendance endpoints are implemented.

## Consolidated database baseline

The migration container applies one initial migration with the final schema. Existing volumes created with the older migration contents must be recreated separately before using this checkout. `stack:up` preserves volumes and does not perform this reset; old migration history can misleadingly report the rewritten baseline as applied. Read the [baseline setup guide](database-refactor-migration.md). No application database has been reset by this change.
