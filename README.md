# FAJT Hours

A mobile-first work-hours tracker for two monthly pay cycles: the 1st–15th and the 16th–last day.

## Live app

https://wretchedworm.github.io/FAJT-Clock-In-Out-App/

Open that on any device. On iPhone, tap Share → "Add to Home Screen" to install it
like an app (it works offline once installed).

## Turning on cross-device sync

Sync is built and tested, but it needs a free database of your own. Three steps,
about five minutes.

### 1. Make a Supabase project

Go to https://supabase.com and sign up (the GitHub button is fastest). Create a
new project — any name, a region near Singapore. Wait for it to finish setting up.

### 2. Create the tables

In the Supabase sidebar: **SQL Editor** → **New query**. Open `supabase-setup.sql`
from this repository, paste the whole thing in, press **Run**.

### 3. Paste two values into `config.js`

In the Supabase sidebar: **Project Settings** → **Data API**. Copy:

| Supabase calls it   | Goes into `config.js` as |
| ------------------- | ------------------------ |
| Project URL         | `url`                    |
| `anon` `public` key | `anonKey`                |

Save, commit, push. Wait a minute for GitHub Pages, then open the app — it will
ask for a passcode. **Type the same passcode on your phone and your Mac** and both
show the same records from then on.

The `anon` key is safe to publish. It cannot read the database on its own: the
setup script blocks direct table access and exposes only two functions, both of
which demand your room ID. Knowing the passcode is the only way in.

## Where your data lives

Your device is always the source of truth. Records are written to `localStorage`
first and mirrored to Supabase in the background, so the app works fully offline
and catches up when you have signal.

If two devices are edited while offline, the merge is per-day rather than
whole-file — separate days both survive. Only if you edit *the same day* on two
devices does one win, and it is the later edit.

Your passcode never leaves your device; it is hashed into a long ID and only that
ID is sent. This also means **there is no password reset**. Forget the passcode
and the records under it are unreachable.

## Open locally

Double-click `index.html`, or for the installable/offline behaviour run:

```sh
npm start
```

Then open `http://localhost:4173`. This local server is only reachable from this
computer — use the live URL above for your phone.

## Tests

```sh
npm test
```

Covers the hours maths (`calculations.test.js`) and the sync merge behaviour
(`sync.test.js` — two simulated devices against a fake server).

## Deployment

GitHub Pages serves the `main` branch from the repository root. Pushing to `main`
publishes the app; allow a minute or two for the change to go live.

When editing `app.js`, `calculations.js`, `sync.js`, `config.js`, or `styles.css`,
bump the `?v=` number in `index.html` and the matching entries in `sw.js` (plus the
`CACHE` name). Otherwise the service worker keeps serving the old cached files and
your changes appear to do nothing.
