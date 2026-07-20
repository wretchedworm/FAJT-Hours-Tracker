# FAJT Hours

A mobile-first work-hours tracker for two monthly pay cycles: the 1st–15th and the 16th–last day.

## Live app

https://wretchedworm.github.io/FAJT-Clock-In-Out-App/

Open that on any device. On iPhone, tap Share → "Add to Home Screen" to install it
like an app (it works offline once installed).

## Where your data lives

Records are stored in `localStorage` — the browser's own storage, on that one device.

**This means your phone and your Mac keep separate records.** Clocking in on your
phone will not show up on your Mac. Syncing between devices needs a backend
(a cloud database plus login) and is not built yet.

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

## Deployment

GitHub Pages serves the `main` branch from the repository root. Pushing to `main`
publishes the app; allow a minute or two for the change to go live.

When editing `app.js`, `calculations.js`, or `styles.css`, bump the `?v=` number in
`index.html` and the matching entries in `sw.js` (plus the `CACHE` name). Otherwise
the service worker keeps serving the old cached files and your changes appear to do
nothing.
