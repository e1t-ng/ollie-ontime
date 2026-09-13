# OnTime backend handoff

The Node backend implements independent accounts, profiles, friend requests, friend groups with per-friend calendar sharing, member-only scheduling polls, ranked overlap, confirmation into a shared calendar event, and RSVP. The existing calendar CRUD/import endpoints now use these accounts.

The sign-in screen is connected. `public/login.html`, `public/login.css`, `public/login.js`, and `public/ollie.webp` are served as static assets at `/login` (also `/login.html`) and call the endpoints below on the same origin. The calendar app links to `/login` instead of the old ChatGPT sign-in link, and its sidebar has a sign-out control. The Friends view in the app is connected: it manages requests, groups, and sharing levels, and friends' calendars appear in the sidebar and the week grid alongside your own. The Polls view is connected too: it creates polls, paints availability on a drag grid, shows the group overlap, and confirms a time into everyone's calendar.

## Start on your machine

Use Node 22.13+ and run from the repository root:

```sh
npm install
npm run dev
```

This starts the API on `http://127.0.0.1:3001` and the existing frontend on `http://localhost:5173`. The frontend forwards `/api/*` to Node, so browser cookies work on the frontend origin. `npm run dev:api` and `npm run dev:frontend` start them separately. `npm run start:api` runs the API without the frontend. The existing `npm start` still starts the built frontend and needs the API running separately.

No database URL is currently configured in this checkout. With no URL, development uses PGlite (embedded PostgreSQL) persisted under `.ontime/data`, ignored by Git. Accounts, sessions, profiles, friendships, friend groups, sharing settings, calendars, and polls survive an API restart. Keep that directory to retain local data; do not run multiple API processes against it. It is a development database, not a hosted Tiger Data service or a backup.

`GET /api/health` reports `storage: "local"` or `"tiger"`. There are no seeded accounts: register through the API or your teammate's form. The old UI's demo data remains separate from saved account data.

Configuration loads from process environment, then `.env.local`, `.env`, and `.dev.vars` (existing variables win). Optional `.env.example` documents settings. Default origins are localhost and 127.0.0.1 on port 5173. If the frontend uses another port, configure `APP_ORIGIN`. If API port changes, configure `API_PORT` for Node and `API_BASE_URL` in the frontend's `.dev.vars`.

## Switch to Tiger Data

1. Obtain your service's PostgreSQL connection URL from the teammate/Tiger Data dashboard. The code alone does not create or provision a Tiger Data account.
2. In ignored `.env.local`, set `DATABASE_MODE=tiger` and `DATABASE_URL` to that URL with the provider's TLS settings. Remove an explicit `DATABASE_MODE=local` if you copied the example. Never paste credentials into source code or chat.
3. Restart the API. It applies the existing Drizzle migrations followed by `0002_fixed_gambit.sql` and `0003_google_auth.sql`, and reports `storage: tiger` after migration succeeds. Missing or failing Tiger configuration stops startup; it does not silently fall back to local storage.

The new migration adds tables/columns and preserves the original calendar/event/profile data. Existing migrations must be reflected in Drizzle's migration journal on an existing service; do not run them again manually against already-created tables. Local and Tiger Data use the same SQL schema. **Switching the URL selects another database; it does not copy local rows to the hosted database.** For the hackathon, create demo accounts in the selected database. A migration of existing local or ChatGPT-owned accounts would be a separate data-transfer operation. Legacy ChatGPT owner IDs are not automatically claimed by a matching email.

Profiles and event records remain stored until explicitly changed/deleted or the database is removed. Sessions expire after seven days and logout revokes the session in SQL. Hosted backup retention depends on your Tiger Data service settings; this code does not configure provider backups. Email verification, password reset, account deletion/export, automatic expiration cleanup, and production abuse monitoring are not implemented in this hackathon backend. The sign-in screen's "Forgot password?" dialog says so rather than pretending to send an email.

Production requires `NODE_ENV=production`, a working database URL, and HTTPS `APP_ORIGIN`. Cookies then use Secure. The Node listener binds to loopback; put it behind your deployment's reverse proxy. The frontend Worker needs an explicit reachable `API_BASE_URL` outside local development. Do not assume the old private Sites deployment runs this separate Node process. IP limits use the actual socket address, not untrusted forwarded headers; behind the frontend proxy that becomes a shared IP limit (10 registrations/15 minutes and 50 logins/15 minutes), plus 15 login attempts per identifier/15 minutes and 60 Google handshakes/15 minutes.

## Google sign-in

Create an **OAuth 2.0 Client ID** of type *Web application* in the Google Cloud console, then set in ignored `.env.local`:

```sh
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
# Optional. Defaults to the first APP_ORIGIN plus /api/auth/google/callback.
# GOOGLE_REDIRECT_URI=http://localhost:5173/api/auth/google/callback
```

Add that exact redirect URI to the client's **Authorised redirect URIs**. It must point at the *frontend* origin, not at port 3001: the browser makes that request itself, the frontend forwards it to Node, and the session cookie therefore lands on the origin the rest of the app uses. With either variable missing, `GET /api/auth/providers` reports `{"google": false}` and the sign-in screen hides the button; nothing else changes.

The flow is the authorization code flow with PKCE (S256). `GET /api/auth/google/start` stores the code verifier in `oauth_states`, sets a short-lived `ontime_oauth` binding cookie scoped to `/api/auth/google`, and redirects to Google. `GET /api/auth/google/callback` consumes that row once, requires the binding cookie to match, exchanges the code server-side, and reads the ID token's claims. Signature verification is skipped deliberately, as Google documents, because the token comes straight from the token endpoint over TLS; `iss`, `aud`, `exp`, and `email_verified` are all checked.

A first Google sign-in creates the account (username derived from the email local part, with a random suffix on collision), signs the browser in, and returns to `/login.html?google=new`, where the sign-up steps collect birthday, gender, and the agreements for the profile that already exists. Later sign-ins go straight to the app.

**An existing password account is never adopted by a matching Google email.** Registration does not verify email addresses, so linking one would let whoever registered an address first capture the real owner's Google sign-in. That sign-in is refused with `?error=google_exists` and the person is asked to use their password. Linking the two safely needs email verification, which this backend does not implement.

Accounts now carry either a password hash or a Google subject, or both; a SQL check constraint enforces that at least one exists, and `POST /auth/login` rejects Google-only accounts the same way it rejects a wrong password. Failures come back as a redirect to `/login.html?error=<code>`, never as JSON: `google_unavailable`, `google_denied`, `google_expired` (unknown, replayed, or unbound state), `google_email`, `google_exists`, `google_failed`.

## Frontend API contract

Requests with bodies use JSON. Success returns JSON; failures return `{ "error": "message" }` with 400 validation, 401 signed out, 403 forbidden, 404 inaccessible/missing, 409 conflict, 429 rate limit, or 503 storage error. Send cookies (`credentials: "include"` when calling a separate allowed origin). Browser mutations must use an allowed origin. No ChatGPT headers or client-supplied user ID can select the acting account.

```ts
async function api(path: string, method = 'GET', data?: unknown) {
  const response = await fetch('/api' + path, {
    method, credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}
```

### 1. Accounts and profiles

| Method / path | Body / result |
| --- | --- |
| POST `/auth/register` | `{email, username, password, name, timeZone?, birthday?, gender?, phone?, eventRecommendations?}` → `{user}` plus session cookie, 201 |
| POST `/auth/login` | `{identifier, password}`; identifier is email or username → `{user}` plus session cookie |
| POST `/auth/logout` | `{}` → `{ok:true}`, revokes cookie/session |
| GET `/auth/me` | `{user: {id,email,username} \| null}` |
| GET `/auth/providers` | `{google: boolean}`; whether the Google button should be shown |
| GET `/auth/google/start` | Redirects the browser to Google. Optional `?next=` is a same-site path to return to |
| GET `/auth/google/callback` | Google's redirect target. Always answers with a redirect, never JSON |
| GET `/profile` | `{profile}` with own settings and username |
| PATCH `/profile` | Any of `{name,username,birthday,homeCity,timeZone,locationSharing,bio,visibility,phone,gender,eventRecommendations,defaultSharing}` → `{profile}` |

Usernames normalize to lowercase and contain 3–30 letters, digits, or underscores; the sign-up form asks for a stricter 3–24 starting with a letter. Passwords are 15–128 characters, stored as Argon2id hashes, never plaintext — the form's minimum matches `MIN_PASSWORD` in `server/api.ts`, so change both together. `gender` is one of `Woman`, `Man`, `Non-binary`, `Prefer not to say`, or blank; `phone` and `eventRecommendations` are stored on the profile only. Sign-in accepts an email address or a username, not a phone number. Session tokens are random, stored hashed in SQL, sent only through HttpOnly/SameSite=Lax cookies. Email and username uniqueness are enforced by SQL. Birthday is blank or a real `YYYY-MM-DD` date; timezone must be IANA, e.g. `America/Chicago`. `locationSharing` accepts `never`, `while_using`, `always` as a stored preference; no live geolocation is implemented.

`visibility` is `public`, `friends` (default), or `private`. Search exposes ID, username, display name, and bio for public/friends profiles. Detailed profiles (including city/timezone) are visible to the owner, public viewers if public, or accepted friends if friends. Private profiles are hidden from search and other users. Email, birthday, and location-sharing settings are not exposed through discovery.

### 2. Friends

| Method / path | Body / result |
| --- | --- |
| GET `/users?q=al` | Username prefix, 2–30 characters → `{users:[{id,username,name,bio}]}` |
| GET `/users/:userId` | Visible `{profile}`; inaccessible profiles return 404 |
| GET `/friends` | `{friends:[{id,status,direction,user,sharing,sharingOverride,theirSharing,groups}]}`; direction incoming/outgoing |
| POST `/friends/requests` | `{userId}` → `{id,status:"pending"}`, 201 |
| PATCH `/friends/:requestId` | `{action:"accept"\|"decline"\|"cancel"\|"remove"\|"block"\|"unblock"}` |

Only the recipient accepts/declines; only the sender cancels. Blocking an existing request/connection hides discovery and prevents new invitations. Only the blocker can unblock. Removing/unblocking deletes the relationship. Existing shared polls/events remain visible to their members after a friendship changes; blocking does not retroactively cancel plans.

On `/friends`, `sharing` is what you show that friend, `theirSharing` is what they show you, and `sharingOverride` is your per-person setting or `null` when a group or your default decides it.

### 3. Calendar sharing

| Method / path | Body / result |
| --- | --- |
| GET `/friends/groups` | `{groups:[{id,name,color,sharing,members:[userId]}]}` |
| POST `/friends/groups` | `{name,color?,sharing?}` → the created group, 201 |
| PATCH `/friends/groups/:groupId` | Any of `{name,color,sharing}` |
| DELETE `/friends/groups/:groupId` | Deletes the group; the friendships are untouched |
| PUT `/friends/groups/:groupId/members` | `{userIds}` replaces the whole membership |
| PUT `/friends/sharing/:userId` | `{sharing:"none"\|"busy"\|"details"\|"default"}`; `default` clears the override |
| GET `/friends/calendar?start=&end=` | `{friends:[{userId,username,name,sharing,events}]}` over at most 62 days |

Three levels, from the calendar owner's side: `details` shows what the events are, `busy` shows only that the time is taken, `none` hides the calendar. They resolve in a fixed order — a per-person setting from `PUT /friends/sharing/:userId` wins outright, so one member of an otherwise trusted group can still be shut out; otherwise the most permissive group the viewer belongs to applies; otherwise the owner's `defaultSharing`, which is `busy` for a new account.

Nothing is shared outside an accepted friendship. A pending request, a declined one, and a block all resolve to `none` in both directions whatever the groups say, and only accepted friends can be put in a group.

`GET /friends/calendar` projects each friend's events **on the server**, so a viewer limited to `busy` never receives the titles at all: their blocks carry `{start,end}` and nothing else, and overlapping or touching ones are merged so the number of events and the seams between them stay private too. A `details` viewer receives `{id,title,start,end,location,allDay}` — notes and invitee lists are never shared at any level. Either way the feed covers what a friend owns plus what they have been invited to and not declined, the same set the scheduling polls treat as busy.

### 4. Availability polls

```ts
const {id} = await api('/polls', 'POST', {
  title: 'Post-hackathon dinner', description: 'Celebrate together', location: 'Downtown',
  timeZone: 'America/Chicago', durationMinutes: 60, minParticipants: 2,
  windows: [{start: '2030-10-01T18:00:00-05:00', end: '2030-10-01T21:00:00-05:00'}],
  invitees: [{userId: friendId, required: true}],
});
await api(`/polls/${id}/availability`, 'PUT', {
  blocks: [{start: '2030-10-01T18:00:00-05:00', end: '2030-10-01T20:00:00-05:00', status: 'preferred'}],
});
const {slots} = await api(`/polls/${id}/slots`);
// Each member submits using their own account. Organizer confirms a qualified slot.
const {eventId} = await api(`/polls/${id}/confirm`, 'POST', {start: slots.find(s => s.qualified).start});
```

| Method / path | Behavior |
| --- | --- |
| GET `/polls` | Member's `{polls:[{poll,required,submittedAt}]}` |
| POST `/polls` | Create using above shape → `{id}`, 201 |
| GET `/polls/:id` | `{poll,members,availability}`; availability contains only caller's blocks |
| PUT `/polls/:id/availability` | `{blocks:[{start,end,status}]}` replaces caller's availability; empty array clears it |
| GET `/polls/:id/slots` | `{slots,computedAt}` ranked best first; each slot has start/end, qualified, available/preferred/maybe counts and participant status |
| POST `/polls/:id/confirm` | `{start}` → `{eventId}`; organizer only, recomputes against current data |
| POST `/polls/:id/cancel` | `{}` cancels an open poll; organizer only |

Invite accepted friends only. Organizer is automatically required. Maximum 20 members, 31 nonoverlapping windows within a 31-day range, and 500 availability blocks per member. Duration is 15–240 minutes in 15-minute increments. Slots advance every 15 minutes from each window's start. Dates need explicit UTC `Z` or offsets; IANA timezone is for display, not a substitute for date-specific DST offsets.

Availability statuses: `preferred`, `available`, `maybe`, `unavailable`. Uncovered time is **unknown**. The whole meeting must be covered. Existing owned calendar events and shared plans marked Invited/Going/Maybe count as busy; declining a shared plan removes that participant's reservation. Private event titles and notes are never included in ranking responses. Poll members can see each other's availability status for candidates.

Ranking prioritizes qualified slots, attendee count, preferred count, maybe count, then earliest time. Required attendees must be available/preferred; maybe does not qualify them. The minimum counts available/preferred attendees. Confirmation locks the poll and participant accounts and rechecks conflicts before writing. Repeating the same confirmation returns the same event; choosing another time returns 409. Closed polls reject edits. Confirmed plan time changes require a new poll; organizer may still edit its title/details or delete the shared event.

### 5. Calendar and RSVP compatibility

`GET /state` returns `{user,profile,calendars,events}`. Own events include `canEdit:true` and an invitation token. Shared events appear under a virtual `Shared plans` calendar with the same event ID, `canEdit:false`, and `attendance`. The frontend should disable event editing when `canEdit === false`, and show RSVP instead. Do not insert copies of shared events.

`POST /action` retains `calendar`, `profile`, `save`, `import`, and `delete` actions from the existing frontend. Save/import return `{ok,count,ids}`; calendars and edits are checked against the session owner. Import is limited to 500 events per request. Existing calendar event date parsing remains compatible with the original frontend; send explicit offsets for portable times. Deleting a confirmed event removes memberships/RSVPs and marks its poll cancelled.

`GET /events/:eventId/rsvp` returns `{event,responses,mine}` for organizer/members. `POST /events/:eventId/rsvp` with `{status:"Going"|"Maybe"|"Not going"}` changes only the caller's RSVP. Only the organizer sees all response names. Legacy `GET /rsvp?token=...` and `POST /rsvp` with `{token,status}` still work: possession of this unguessable invitation token grants event access and allows a signed-in user to join. Treat tokens as shareable invitation links, not public event IDs.

### 6. Nearby event discovery

Set the Ticketmaster Discovery API Consumer Key in ignored `.env.local` as `TICKETMASTER_API_KEY`. The key stays in the Node process and is never returned to the browser. Restart the API after adding or rotating it.

Signed-in users can search by city without granting device location:

```text
GET /discover/events?city=Chicago&radius=25&unit=miles&category=music&size=20
```

For current-location search, the frontend must first request browser geolocation after a user gesture, and the user profile's `locationSharing` must be `while_using` or `always`:

```text
GET /discover/events?latitude=41.8781&longitude=-87.6298&radius=25&unit=miles
```

Optional parameters are `keyword`, `category`, `start`, `end`, `postalCode`, `page`, and `size`. Radius is 1–100, size is 1–50, and dates must include a UTC `Z` or numeric offset. Results are cached in this API process for five minutes to protect the provider quota. The response is `{events,page,source:"Ticketmaster"}`. Events contain normalized name, date/time/timezone, venue and city, distance, classification, price range, image URL, and Ticketmaster URL.

Coordinates are sent to Ticketmaster for the search and are not written to OnTime's database or logs. A profile set to `never` receives 403 for coordinate searches and can still use city or postal-code search. Ticketmaster results are external suggestions; adding one to an OnTime calendar should go through the existing event creation endpoint after the user chooses it.

## Verification

```sh
npm run test:backend
npx tsc --noEmit
npm run build
```

Backend tests apply every SQL migration to an isolated on-disk PostgreSQL-compatible database, create fictional accounts, exercise authorization/privacy and the full planning lifecycle, close and reopen storage, and verify account/session/event retention. They never connect to a configured Tiger Data service. A real Tiger Data connection and provider backup policy still require separate verification once credentials exist.
