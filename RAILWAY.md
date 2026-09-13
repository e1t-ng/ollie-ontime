# Deploy OnTime on Railway

Create one Railway service from this repository. The root Dockerfile builds the
Vinext Node standalone frontend. Its start script launches the private Node API,
waits for database migrations, then starts the frontend on Railway's PORT.
TigerData remains the database; do not create a second database.

Set these service variables using Railway's Variables tab. Never put secrets in
GitHub or in the Docker image. The local `.env` file is intentionally ignored.

| Variable | Value |
| --- | --- |
| DATABASE_MODE | tiger |
| DATABASE_URL | Existing TigerData connection string with TLS parameters |
| APP_ORIGIN | Exact public HTTPS origin, such as https://ontime.up.railway.app |
| GOOGLE_CLIENT_ID | Google OAuth web client ID |
| GOOGLE_CLIENT_SECRET | Matching Google OAuth client secret |
| GOOGLE_REDIRECT_URI | Public origin followed by /api/auth/google/callback |
| TICKETMASTER_API_KEY | Ticketmaster Discovery consumer key |

Generate a domain under Settings / Networking. Set APP_ORIGIN to that domain,
then add the same callback URL to the Google OAuth client's authorized redirect
URIs in Google Cloud. If the OAuth app is in testing, add demo users as test users.
Keep localhost redirect URIs if local development is still needed.

Do not set API_BASE_URL or API_PORT in Railway: the startup script connects both
processes internally. The Dockerfile supplies NODE_ENV=production. Environment
files and local databases are excluded from the image.

Railway uses /api/health to wait for the API and frontend. After deployment check
password login, Google login, profile saving, and friend requests on the public
URL. A passing local build does not verify the Google Cloud callback settings.

Local validation of the Railway build (PowerShell):

```powershell
$env:ONTIME_TARGET='railway'
node node_modules/vinext/dist/cli.js build
node scripts/railway-smoke.mjs
Remove-Item Env:ONTIME_TARGET
npm run test:backend
```
