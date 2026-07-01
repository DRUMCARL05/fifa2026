# World Cup Predictor 2026 — Project Instructions

This file is the single source of truth for anyone (or any AI assistant) working on this codebase. Read it in full before making any changes.

---

## Project Identity

**App name:** World Cup Predictor 2026
**Live URL:** https://carlosbuilds.dev
**Admin URL:** https://carlosbuilds.dev/admin.html
**Repository:** https://github.com/DRUMCARL05/fifa2026
**Owner / Admin:** Carlos (DRUMCARL05)
**Purpose:** A family and friends World Cup knockout stage prediction game, hosted as a static site on GitHub Pages with Firebase as the backend.

---

## Architecture — Never Change These Fundamentals

```
GitHub Pages (static hosting)
    ├── index.html        → player app
    ├── admin.html        → admin results panel
    └── functions/
        ├── index.js      → Cloud Function (auto-fetch results)
        └── package.json  → Node.js 22, firebase-functions v6+

Firebase Firestore (database)
    ├── /results/matches        → match results (written by admin + Cloud Function)
    ├── /players/{slug}         → player predictions + champion pick
    ├── /meta/matchIdMap        → API ID ↔ internal match ID cache
    └── /fetchLog               → auto-fetch run history

football-data.org API (live scores)
    → polled every 5 minutes by Cloud Function
    → competition code: WC, stages: LAST_32, LAST_16, QUARTER_FINALS, SEMI_FINALS, THIRD_PLACE, FINAL
```

**Key constraint:** This is a zero-backend static app. No Node server, no Express, no build step. Everything runs in the browser or in Firebase Cloud Functions. Never introduce a bundler, framework, or server-side render step.

---

## File Responsibilities

### `index.html` — Player App
- Self-contained single file: HTML + CSS + JS + Firebase SDK (loaded via CDN)
- No external JS files, no imports from local files
- Firebase SDK version: `11.9.0` (do not upgrade without testing)
- All tournament data (GROUPS, FLAG, CODE, KO, KICKOFF) is inlined in the `<script>` block
- `localStorage` is used to store the player's name (`qp26_user`) and language
  preference (`qp26_lang`)
- All other state (predictions, champion pick, results) lives in Firestore
- **Bilingual (Spanish/English)**: teams are keyed by a language-neutral 3-letter
  code (`GROUPS`, `TEAMS_ES`, `TEAMS_EN`, single `FLAG` map). `champion` picks in
  Firestore now store a code (e.g. `"ARG"`) rather than a display name;
  `migrateChampPick()` provides backward compatibility for any older saved picks
  stored as a Spanish name. All UI copy lives in `STRINGS_ES` / `STRINGS_EN`,
  applied via a `t(key)` helper and `data-i18n` attributes. Default language is
  Spanish; toggle persists via `qp26_lang`. **`admin.html` is intentionally
  Spanish-only — no bilingual support, by design (single admin user).**
- `GROUP_QUALIFIERS` / `THIRD_QUALIFIERS`: since group-stage standings aren't
  stored in Firestore, R32 matchups are resolved via hardcoded lookup tables
  (group winner/runner-up per group, plus the 8 real third-place qualifiers per
  bracket slot). These must be verified against the actual final group standings
  before relying on them — see "Known Constraints" below.

### `admin.html` — Admin Panel
- Same self-contained pattern as `index.html`
- PIN authentication via `sessionStorage` (logs out on tab close)
- Admin PIN: stored as `const ADMIN_PIN` in the script block
- Uses amber/green colour scheme to visually distinguish from the player app
- Writes to Firestore with `autoFetched: false` to permanently lock manual results
- Spanish-only (no language toggle) — single admin user, lower priority
- **Live refresh**: the `results/matches` `onSnapshot` listener calls
  `buildAllCards()` (full rebuild of all ~32 cards) whenever any match result
  changes, not just a single-card `refreshCard(id)` call. This is required
  because R16+ cards display team names resolved from earlier matches'
  results (e.g. card #89 shows "Winner of #74"), so a change to match 74 must
  also re-render card 89, not just card 74. `refreshCard(id)` still exists and
  is used directly after a manual Publish/Clear action on that specific card.

### `functions/index.js` — Cloud Function
- Scheduled: every 5 minutes
- Runtime: Node.js 22
- Uses native `fetch` (no node-fetch dependency)
- Respects `autoFetched: false` as a permanent manual override lock
- Logs every run to `/fetchLog` collection
- Rate limit safety: 7-second sleep between each of the 6 API stage calls
- **Matches API fixtures to internal match IDs by team name, not date.** Several
  R32/R16+ matches share a calendar date (e.g. R32 matches 74 and 76 both kick
  off June 29), so date-only matching previously caused the function to silently
  write the wrong match's score under the wrong internal ID. R32 (73–88) matches
  by a static `R32_TEAMS` list of real fixtures; R16+ (89+) dynamically resolves
  expected team names from already-known results via `resolveSlot()`/`KO_BRACKET`
  (mirroring the same bracket-walking logic used in `index.html`), and only
  matches by team name once those teams are known. If a match's home/away
  orientation differs between our bracket and the API, this is detected and
  corrected (`matchIdMap[id + "_flip"]`) so scores and penalty winners are never
  reported backwards.

---

## Design System — Always Maintain These

### Colour Tokens (player app)
```css
--bg:      #07161A   /* page background */
--panel:   #0D2329   /* card background */
--panel2:  #112C34   /* input/button background */
--line:    #1A424E   /* borders */
--teal:    #2DD4BF   /* primary accent, saved state */
--teal2:   #0F766E   /* secondary teal */
--gold:    #F59E0B   /* champion card, multiplier badges */
--red:     #F43F5E   /* lock icons, error states */
--text:    #E2F4F2   /* primary text */
--muted:   #6B9EA0   /* secondary text, labels */
```

### Colour Tokens (admin app)
```css
--bg:      #0A0F0A
--panel:   #111A11
--panel2:  #162016
--line:    #1F3A1F
--amber:   #F59E0B   /* primary admin accent */
--amber2:  #92400E
--teal:    #2DD4BF   /* auto-fetched result border */
--green:   #22C55E   /* saved indicator */
--red:     #F43F5E
--text:    #E8F5E8
--muted:   #6B9E6B
```

### Typography
- **Display font:** Bebas Neue (loaded from Google Fonts) — used for scores, headings, points numbers
- **Body font:** Inter (loaded from Google Fonts) — used for all other text
- Minimum body font size: 16px equivalent (prevents iOS zoom on input focus)
- Score values: `font-family: var(--display)`, `font-size: 2rem`

### Component Rules
- **Stepper buttons:** always 52×52px, border-radius 50%, never smaller
- **Match cards:** `border-radius: 14px`, `padding: 1rem`
- **Teal border on match card** = prediction saved
- **Teal border on admin card** = auto-fetched result
- **Amber border on admin card** = manual override (locked)
- **Penalty selector:** slides in with CSS transition, never shown unless scores are equal
- **Toast notifications:** bottom-centre, rounded pill, 1800ms duration
- **Nav bar:** fixed bottom, 4 tabs (player app) / subnav tabs (admin app)

---

## Scoring System — Never Change Without Explicit Instruction

| Outcome | Base Points |
|---------|------------|
| Exact scoreline (draw) + correct penalty winner | 4 |
| Exact scoreline (any result) | 3 |
| Exact draw score + wrong pen winner, OR wrong draw score + correct pen winner | 2 |
| Correct team advances, wrong scoreline | 1 |
| Complete miss | 0 |
| Correct tournament champion | +15 (flat bonus, no multiplier) |

### Round Multipliers
| Round | Multiplier |
|-------|-----------|
| Round of 16 | ×1 |
| Quarter-Finals | ×2 |
| Semi-Finals | ×3 |
| 3rd Place | ×1 |
| Final | ×4 |

**Champion bonus is always flat +15. It does not use a multiplier. It locks at the first R16 kickoff: `2026-07-04T17:00:00Z`.**

---

## Tournament Data — Internal Match IDs

Internal match IDs run from **73 to 104**:
- 73–88: Round of 32 (shown read-only, no predictions)
- 89–96: Round of 16
- 97–100: Quarter-Finals
- 101–102: Semi-Finals
- 103: 3rd Place
- 104: Final

Match IDs must remain stable. Never renumber them. The Firestore results document uses these as keys.

### Bracket Sources (KO slot resolution)
- `{ pos, g }` = positional finisher from group stage
- `{ third }` = best 3rd-place qualifier
- `{ W: matchId }` = winner of a previous match
- `{ L: matchId }` = loser of a previous match (3rd place only)

---

## Firestore Data Structures

### `/results/matches` document
```javascript
{
  73: { h: 2, a: 0, autoFetched: true },
  74: { h: 1, a: 1, pen: "h", autoFetched: false },  // false = manual lock
  // ... keyed by numeric match ID
}
```
- `h`: home team goals
- `a`: away team goals
- `pen`: `"h"` (home wins penalties) or `"a"` (away wins penalties) — only present for draws
- `autoFetched`: `true` = written by Cloud Function, can be overwritten. `false` = manual override, Cloud Function will never touch it.

### `/players/{slug}` document
```javascript
{
  name: "Carlos",
  champion: "ARG",  // team CODE, not display name (see Bilingual note below)
  predictions: {
    89: { h: 2, a: 1, pen: null },
    90: { h: 0, a: 0, pen: "a" },
    // ... keyed by numeric match ID
  },
  updatedAt: 1751234567890
}
```
- Slug is derived from the player's name: lowercase, spaces replaced with `_`, special chars removed
- Predictions use the same structure as results (h, a, pen)
- `champion` stores a language-neutral 3-letter team code (e.g. `"ARG"` for
  Argentina), not a display name. Any pick saved before bilingual support was
  added may still be stored as a Spanish name (e.g. `"Argentina"`) — `index.html`
  handles this automatically via `migrateChampPick()` on load, converting old
  names to codes in memory without needing a Firestore migration script. An
  audit reading this field directly (bypassing the app) should account for both
  possible formats.

### `/fetchLog` collection
```javascript
{
  ts: 1751234567890,     // Unix timestamp ms
  written: 3,            // number of results written
  matchIds: [73, 74, 75] // which match IDs were updated
}
```

---

## Player Identity & Name Handling

- Players identify themselves by name only — no passwords, no email
- Name is stored in `localStorage` under key `qp26_user`
- Name is slugified for Firestore document ID: `slugify(name)` → lowercase, underscores, alphanumeric only
- If two players use the same name they share a document — warn players about this
- Name change (`changeName()`) clears localStorage and reloads; player must re-enter name

---

## Match Locking Rules

- **Group stage / R32:** no predictions at all — shown read-only in the R32 tab
- **KO matches:** predictions lock automatically when `Date.now() >= Date.parse(KICKOFF[id])`
- **Champion pick:** locks at `2026-07-04T17:00:00Z` (first R16 kickoff)
- Locked matches show a 🔒 icon and disabled stepper buttons
- Locked matches still show the result badge if a result has been published

---

## Cloud Function Rules

1. **Never remove the 7-second sleep** between API stage calls — required for rate limit compliance
2. **Never overwrite `autoFetched: false` results** — this is the manual override mechanism
3. **Always write to `/fetchLog`** after every run with results, even if `written: 0`
4. **Always use `merge: true` on metaRef.set** — the matchIdMap is additive
5. The function uses `fetch` natively (Node 22) — do not add node-fetch as a dependency
6. Timeout is set to 120 seconds — the 6 stage calls × 7s sleep = ~42s minimum, well within limit

---

## What to Do When Making Changes

### Adding a new feature to the player app
1. Keep all JS inside the single `<script type="module">` block
2. Use existing CSS variables — do not introduce new colour values without updating this file
3. Test that predictions still save correctly to Firestore after any JS changes
4. Test on mobile viewport (375px width minimum)
5. Do not add npm dependencies — the player app has zero build step

### Updating the admin panel
1. Admin uses `sessionStorage` for auth — do not switch to `localStorage`
2. Always set `autoFetched: false` when publishing a manual result
3. Keep the status bar and fetch log functional — they are the admin's primary monitoring tools
4. The live `onSnapshot` listener on `results/matches` calls `buildAllCards()`
   (not a single-card refresh) whenever any result changes, since R16+ cards
   depend on earlier matches' results. `refreshCard(id)` is still used directly
   after a Publish/Clear action on that one card for immediate feedback.

### Updating the Cloud Function

⚠️ **IMPORTANT — Two separate locations must stay in sync:**

The Firebase project and the GitHub repo live in **different folders on the local machine**. The Firebase CLI only reads from the Firebase project folder, not the GitHub repo. Always update both files to keep them in sync:

| File | Location |
|------|----------|
| Source of truth (GitHub) | `~/Documents/GitHub/fifa2026/functions/index.js` |
| Deployed by Firebase CLI | `~/functions/index.js` (inside the Firebase project folder where `firebase.json` lives) |

**Correct deployment workflow:**
```bash
# 1. Edit the file in the GitHub repo first (source of truth)
# 2. Copy it to the Firebase project folder
cp ~/Documents/GitHub/fifa2026/functions/index.js ~/functions/index.js

# 3. Deploy from the Firebase project folder (NOT the GitHub repo)
cd ~
firebase deploy --only functions
```

Running `firebase deploy --only functions` from inside `~/Documents/GitHub/fifa2026/` will NOT work — there is no `firebase.json` in that folder, so the CLI will either fail or silently skip deployment.

4. Verify the function appears in Firebase Console → Functions with a new revision name after deploying
5. Check Firebase Console → Functions → Logs within 10 minutes to confirm it ran successfully — look for "Updated matchIdMap" and "Wrote X result(s)" log lines
6. Do not change the schedule from "every 5 minutes" without updating rate limit sleep values

### Changing the scoring system
1. Update `scoreMatch()` in **both** `index.html` and `admin.html` — they must be identical
2. Update the scoring table in this file
3. Update the Rules tab in `index.html`
4. Scores are computed client-side at read time — no historical recalculation needed

---

## Key Dates & Lock Times

| Event | Date/Time (UTC) |
|-------|----------------|
| Round of 32 begins | 2026-06-28T19:00:00Z |
| Round of 16 begins / Champion pick locks | 2026-07-04T17:00:00Z |
| Quarter-Finals begin | 2026-07-09T20:00:00Z |
| Semi-Finals begin | 2026-07-14T19:00:00Z |
| 3rd Place match | 2026-07-18T19:00:00Z |
| Final | 2026-07-19T19:00:00Z |
| Firestore rules expire | 2026-08-01 |

---

## Known Constraints & Decisions

**Why no shared leaderboard via JSON export?**
Firebase Firestore gives every player a real-time live leaderboard. The export/import approach was considered and rejected in favour of this.

**Why `autoFetched` flag instead of a separate collection?**
Keeping results in a single flat document makes Firestore reads cheap (one read per listener update) and keeps the scoring engine simple.

**Why is the R32 read-only?**
The app launched mid-tournament when R32 matches had already started. This was a deliberate design decision to let all players start on equal footing from R16 onwards.

**Why does the Cloud Function match by team name instead of date?**
Multiple R32/R16+ matches share the same calendar date (e.g. R32 matches 74 and
76 both kick off June 29; several R16 dates also collide). Date-only matching
caused the function to grab the wrong API fixture for a given internal match ID,
silently writing one match's real score under a different match's slot. This
was discovered and fixed after live matches 74, 75, and 76 received incorrect
auto-fetched scores during the tournament — those three were manually corrected
via Override & Publish in the admin panel. **An audit should confirm no other
matches show a score that doesn't match the real-world result, particularly any
that finished before this fix was deployed.**

The `R32_TEAMS` list in `functions/index.js` uses the **exact team name strings
that football-data.org's API returns** — verified by querying the API directly.
Several names differ from what you might expect:
- `"Congo DR"` (not "DR Congo")
- `"United States"` (not "USA")
- `"Bosnia-Herzegovina"` (not "Bosnia and Herzegovina")
- `"Cape Verde Islands"` (not "Cabo Verde")
- `"Ivory Coast"` (correct — API does use the English name)

Do not change these strings without re-verifying against the live API response.

**Why is `index.html` bilingual but `admin.html` isn't?**
The player app is shared with the whole DISIP group, some of whom are more
comfortable in English; the admin panel has exactly one user (Carlos) who is
bilingual, so the added complexity of a second admin language wasn't worth it.

**Why Bebas Neue + Inter?**
Bebas Neue gives the score numbers a strong, stadium scoreboard feel. Inter is the most legible system-style font for small text on mobile. Both are available on Google Fonts with no licensing cost.

**Why no TypeScript / React / bundler?**
The app must deploy as raw files to GitHub Pages with zero build step. Keeping it vanilla ensures it works forever without dependency rot.

---

## Security & Firestore Rules

This app has **no Firebase Authentication** — players identify by name only, and
the admin panel uses a client-side PIN check (`ADMIN_PIN` in `admin.html`).
This is a **deliberate, accepted tradeoff** for a closed friend-group tool, not
an oversight: the PIN keeps casual users out of the admin UI, but it is not a
real security boundary — anyone who opens browser DevTools can read the PIN
or write directly to Firestore using the app's public Firebase config (which
is necessarily public, since it ships in the client-side source). There is no
way to cryptographically distinguish "the admin" from "any other visitor" at
the database layer without adding real Firebase Auth, which was judged
disproportionate to the actual risk (a friends-and-family prediction pool, not
a system handling money or sensitive data).

**Current Firestore rules** (replacing the original fully-open test-mode
rules) scope reads as public — needed for the live leaderboard and results to
work without login — while constraining writes to match the expected shape of
each collection, removing the ability for a client to write arbitrary data to
an unrelated/unexpected path:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    match /results/matches {
      allow read: if true;
      allow write: if request.time < timestamp.date(2026, 8, 1);
    }

    match /players/{slug} {
      allow read: if true;
      allow write: if request.time < timestamp.date(2026, 8, 1)
                   && request.resource.data.keys().hasAll(['name','predictions','updatedAt'])
                   && request.resource.data.name is string
                   && request.resource.data.name.size() < 50;
    }

    match /meta/{doc} {
      allow read: if true;
      allow write: if request.time < timestamp.date(2026, 8, 1);
    }

    match /fetchLog/{doc} {
      allow read: if true;
      allow write: if request.time < timestamp.date(2026, 8, 1);
    }

    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

**What this does and doesn't protect against:** it prevents a client from
writing malformed data (missing fields, wrong types) into `players/{slug}`,
and removes the previous default-allow-everything posture for any
unrecognized document path. It does **not** prevent a determined user from
writing a syntactically valid but dishonest player document (e.g. inflating
their own predictions after a match has locked) or from publishing a fake
result to `results/matches` — those protections would require Firebase Auth
plus an admin-role check, which is an explicit non-goal for this app's scale.
If the trust model of the group ever changes (e.g. opened to strangers, real
stakes introduced), this should be revisited.

**Predictions are visible to all players before lock.** The leaderboard's
real-time listener (`onSnapshot(collection(db,"players"))`) fetches every
player's full `predictions` object so it can compute everyone's score
client-side. This means a player could technically read another player's
picks before that player's matches lock, by inspecting network traffic. Low
stakes for a friend group; worth knowing if this ever needs hardening.

---

## Credentials Reference (keep private, do not commit to public repo)

| Item | Location |
|------|---------|
| Firebase config | Inlined in `index.html` and `admin.html` |
| Admin PIN | `const ADMIN_PIN` in `admin.html` |
| football-data.org token | `const FD_TOKEN` in `functions/index.js` |
| Firebase project ID | `worldcup-predictor-2026-dc494` |
| Domain registrar | Porkbun (carlosbuilds.dev) |
| GitHub account | DRUMCARL05 |

---

## Quick Reference — Admin Checklist Per Match Day

- [ ] Open `carlosbuilds.dev/admin.html` and enter PIN
- [ ] Check status bar — green dot confirms auto-fetch is running
- [ ] After a match finishes, wait up to 5 minutes for auto-fetch to populate the result (teal border)
- [ ] Verify the score is correct — if wrong, adjust with steppers and tap **Override & Publish**
- [ ] Check **Fetch Log** tab to confirm the run was logged
- [ ] Check **Players** tab to confirm leaderboard updated correctly

---

*Last updated: July 2026 (bilingual support, Cloud Function team-name matching fix with verified API names, admin live-refresh fix, Firestore rules tightened, deployment workflow clarified — Firebase project folder is separate from GitHub repo). Update this file whenever a significant architectural or design decision is made.*
