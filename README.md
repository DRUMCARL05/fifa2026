# ⚽ World Cup Predictor 2026

A real-time, mobile-first World Cup prediction game built for friends and family. Players predict knockout stage scores from their phones, scores sync instantly to the cloud, and a live leaderboard updates automatically as real match results come in.

Built with vanilla HTML/CSS/JS, Firebase Firestore, and a Cloud Function that fetches live results from football-data.org every 5 minutes.

---

## Live App

| Link | Purpose |
|------|---------|
| `https://[your-username].github.io/[repo-name]/` | Player app — share this with everyone |
| `https://[your-username].github.io/[repo-name]/admin.html` | Admin panel — keep this private |

---

## Features

### Player App (`index.html`)
- **One-time name entry** — type your name once, saved forever, never asked again
- **Champion prediction** — pick the tournament winner for a flat +15 bonus points, locks at Round of 16 kickoff
- **Knockout predictions** — Round of 16 through Final, one tab per round
- **Large stepper buttons** — tap + and − to set scores, no typing needed
- **Penalty selector** — slides in automatically when scores are tied
- **Auto-save** — predictions sync to Firestore instantly on every tap
- **Live leaderboard** — all players' scores update in real time as results come in
- **Round multipliers** — points scale up in later rounds
- **Match locking** — predictions disable automatically at kickoff time
- **WhatsApp share** — one tap generates a pre-written score message
- **Offline resilient** — shows a banner if connection drops, re-syncs automatically

### Admin Panel (`admin.html`)
- **PIN-protected** — session-based login, logs out when browser tab closes
- **Auto-fetch status bar** — live green dot, last run time, next run countdown
- **Per-round tabs** — R32 → R16 → QF → SF → 3rd Place + Final
- **Result cards** — same large stepper UX as the player app
- **Teal border** = auto-fetched result · **Amber border** = your manual override
- **Publish button** — pushes a single result to Firestore instantly, visible to all players within seconds
- **Manual override** — adjust any auto-fetched score and publish; Cloud Function will never overwrite it
- **Clear button** — removes a result; auto-fetch will repopulate it
- **Players tab** — live leaderboard with points, exact scores, correct results
- **Fetch Log tab** — history of every automatic write from the Cloud Function

### Cloud Function (`functions/index.js`)
- Runs every 5 minutes via Firebase Cloud Scheduler
- Fetches finished match results from football-data.org API
- Matches results to internal match IDs by date
- Writes to Firestore only if no manual override exists (`autoFetched: false` = permanent lock)
- Logs every run to a `fetchLog` Firestore collection for admin visibility
- Handles penalty winners from API data automatically

---

## Scoring System

| Result | Points |
|--------|--------|
| Exact scoreline (draw) + correct penalty winner | **4 pts** |
| Exact scoreline | **3 pts** |
| Exact draw score + wrong penalty winner, or wrong draw score + correct penalty winner | **2 pts** |
| Correct team advances, wrong scoreline | **1 pt** |
| Complete miss | **0 pts** |
| Correct tournament champion | **+15 pts bonus** (flat, locked at R16) |

### Round Multipliers

| Round | Multiplier |
|-------|-----------|
| Round of 16 | ×1 |
| Quarter-Finals | ×2 |
| Semi-Finals | ×3 |
| 3rd Place | ×1 |
| Final | ×4 |

---

## Architecture

```
football-data.org API
        ↓ every 5 min
  Firebase Cloud Function
        ↓ writes results
  Firestore Database
  ├── /results/matches     ← real match scores (admin + auto-fetch)
  ├── /players/{name}      ← each player's predictions + champion pick
  ├── /meta/matchIdMap     ← cached API ID ↔ internal ID mapping
  └── /fetchLog            ← auto-fetch run history
        ↓ real-time listeners
  index.html (players)     ← live leaderboard, locked cards, score badges
  admin.html (admin)       ← result entry, override controls, fetch log
```

All data lives in Firestore. `localStorage` is used only to remember the player's name between visits. No backend server required — the app runs entirely on GitHub Pages static hosting.

---

## Tournament Structure

- **48 teams** across 12 groups (Groups A–L)
- **Round of 32** — 16 matches (shown read-only; predictions start at R16)
- **Round of 16** — 8 matches
- **Quarter-Finals** — 4 matches
- **Semi-Finals** — 2 matches
- **3rd Place** — 1 match
- **Final** — 1 match
- **Total predictable matches** — 32 (R16 through Final)

---

## Repository Structure

```
/
├── index.html              # Player-facing app (share with everyone)
├── admin.html              # Admin results panel (keep URL private)
├── README.md               # This file
└── functions/
    ├── index.js            # Cloud Function — auto-fetches match results
    └── package.json        # Node.js dependencies for the function
```

---

## Setup & Deployment

### Prerequisites
- A [GitHub](https://github.com) account
- A [Firebase](https://firebase.google.com) project on the **Blaze (pay-as-you-go)** plan
- A [football-data.org](https://www.football-data.org) free API key
- [Node.js](https://nodejs.org) v22+ and npm installed locally

### 1. Firebase Setup

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and create a project
2. Enable **Firestore Database** in test mode
3. Set Firestore rules to allow reads/writes through the tournament end:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.time < timestamp.date(2026, 8, 1);
    }
  }
}
```

4. Register a web app in Project Settings → Your Apps → Web
5. Copy the `firebaseConfig` object

### 2. Configure the App

Replace the `firebaseConfig` object in both `index.html` and `admin.html` with your own:

```javascript
const firebaseConfig = {
  apiKey:            "your-api-key",
  authDomain:        "your-project.firebaseapp.com",
  projectId:         "your-project-id",
  storageBucket:     "your-project.appspot.com",
  messagingSenderId: "your-sender-id",
  appId:             "your-app-id"
};
```

Also update the admin PIN in `admin.html`:
```javascript
const ADMIN_PIN = "your-pin";
```

And the football-data.org API token in `functions/index.js`:
```javascript
const FD_TOKEN = "your-token";
```

### 3. Deploy to GitHub Pages

1. Push both `index.html` and `admin.html` to the root of a public GitHub repository
2. Go to **Settings → Pages → Source** → select `main` branch → Save
3. Your app will be live at `https://[username].github.io/[repo-name]/`

### 4. Deploy the Cloud Function

```bash
# Install Firebase CLI
npm install -g firebase-tools

# Login
firebase login

# Initialise in the repo root
firebase init functions
# Choose: existing project, JavaScript, No ESLint, No install now

# Install dependencies
cd functions && npm install && cd ..

# Deploy
firebase deploy --only functions
```

Verify deployment at Firebase Console → Functions. You should see `fetchResults` with a clock (scheduled) trigger.

---

## Admin Usage Guide

### Accessing the Admin Panel
Navigate to `/admin.html` and enter your PIN. The session lasts until you close the browser tab.

### Reading the Status Bar
- 🟢 **Green dot** — Cloud Function is active and running on schedule
- Last run time and result count shown inline
- Next run countdown updates in real time

### Publishing a Result
1. Navigate to the correct round tab
2. Use + and − buttons to set the final score
3. If the match ended in a draw, select the penalty winner
4. Tap **Publish Result** — the result goes live for all players instantly

### Overriding an Auto-Fetched Result
If the API returns an incorrect score (teal border card):
1. Adjust the score using the steppers
2. Tap **Override & Publish**
3. The card turns amber — the Cloud Function will never touch this result again

### Clearing a Result
Tap the **✕ Clear** button to remove a result. The Cloud Function will repopulate it automatically when it next runs, if the match is finished.

---

## API Rate Limits

football-data.org free tier allows **10 requests per minute**. The Cloud Function fetches 6 stages sequentially with a 7-second pause between each call, staying well within the limit. The function runs every 5 minutes, making 6 API calls per run — approximately 1,700 calls per day during the tournament, comfortably within free tier limits.

---

## Firebase Free Tier Usage

The Blaze plan is required for Cloud Functions but includes a generous free tier:

| Resource | Free tier | Estimated usage |
|----------|-----------|----------------|
| Function invocations | 2M/month | ~8,600/month |
| Firestore reads | 50K/day | <1K/day |
| Firestore writes | 20K/day | <500/day |

Expected monthly Firebase cost: **$0.00**

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Hosting | GitHub Pages (free, static) |
| Database | Firebase Firestore |
| Serverless function | Firebase Cloud Functions v2 (Node.js 22) |
| Live scores API | football-data.org v4 |
| Frontend | Vanilla HTML, CSS, JavaScript (no frameworks) |
| Fonts | Google Fonts — Bebas Neue + Inter |
| Auth | PIN-based session (admin), name-based identity (players) |

---

## Browser Support

Works in all modern mobile and desktop browsers. Tested on:
- Safari (iOS 16+)
- Chrome (Android)
- Chrome / Safari / Firefox (desktop)

No app installation required — players open a link in their default browser.

---

## Tournament Calendar

| Date | Event |
|------|-------|
| 11 Jun 2026 | Group stage begins |
| 28 Jun 2026 | Round of 32 begins |
| 4 Jul 2026 | Round of 16 begins · Champion pick locks |
| 9 Jul 2026 | Quarter-Finals |
| 14 Jul 2026 | Semi-Finals |
| 18 Jul 2026 | 3rd Place match |
| 19 Jul 2026 | **Final** |

---

## License

MIT — free to use, modify, and share.

---

*Built during the 2026 FIFA World Cup for a family prediction league. Started as a Claude artifact, evolved into a full Firebase-backed web app deployed on GitHub Pages.*
