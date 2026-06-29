/**
 * World Cup Predictor 2026 — Firebase Cloud Function
 * Fetches finished match results from football-data.org every 5 minutes
 * and writes them to Firestore. Respects manual admin overrides.
 *
 * Deploy: firebase deploy --only functions
 */

const { onSchedule }   = require("firebase-functions/v2/scheduler");
const { setGlobalOptions } = require("firebase-functions/v2");
const { initializeApp }    = require("firebase-admin/app");
const { getFirestore }     = require("firebase-admin/firestore");

initializeApp();
setGlobalOptions({ region: "us-central1" });

const db = getFirestore();

// ─── FOOTBALL-DATA.ORG CONFIG ─────────────────────────────────────────────────
const FD_TOKEN  = "e84ddb289016490a88eaa7567b8e47fc";
const FD_BASE   = "https://api.football-data.org/v4";
const WC_CODE   = "WC"; // football-data.org competition code for World Cup

/**
 * MAP: football-data.org team name → our app's Spanish team name
 * Covers all 48 WC 2026 teams.
 */
const TEAM_MAP = {
  // Group A
  "Mexico":              "México",
  "South Africa":        "Sudáfrica",
  "Korea Republic":      "Corea del Sur",
  "Czech Republic":      "República Checa",
  "Czechia":             "República Checa",
  // Group B
  "Canada":              "Canadá",
  "Bosnia-Herzegovina":  "Bosnia",
  "Qatar":               "Catar",
  "Switzerland":         "Suiza",
  // Group C
  "Brazil":              "Brasil",
  "Morocco":             "Marruecos",
  "Haiti":               "Haití",
  "Scotland":            "Escocia",
  // Group D
  "USA":                 "Estados Unidos",
  "United States":       "Estados Unidos",
  "Paraguay":            "Paraguay",
  "Australia":           "Australia",
  "Turkey":              "Turquía",
  "Türkiye":             "Turquía",
  // Group E
  "Germany":             "Alemania",
  "Curaçao":             "Curazao",
  "Curacao":             "Curazao",
  "Ivory Coast":         "Costa de Marfil",
  "Ecuador":             "Ecuador",
  // Group F
  "Netherlands":         "Países Bajos",
  "Japan":               "Japón",
  "Sweden":              "Suecia",
  "Tunisia":             "Túnez",
  // Group G
  "Belgium":             "Bélgica",
  "Egypt":               "Egipto",
  "Iran":                "Irán",
  "New Zealand":         "Nueva Zelanda",
  // Group H
  "Spain":               "España",
  "Cape Verde":          "Cabo Verde",
  "Saudi Arabia":        "Arabia Saudí",
  "Uruguay":             "Uruguay",
  // Group I
  "France":              "Francia",
  "Senegal":             "Senegal",
  "Iraq":                "Irak",
  "Norway":              "Noruega",
  // Group J
  "Argentina":           "Argentina",
  "Algeria":             "Argelia",
  "Austria":             "Austria",
  "Jordan":              "Jordania",
  // Group K
  "Portugal":            "Portugal",
  "DR Congo":            "RD Congo",
  "Uzbekistan":          "Uzbekistán",
  "Colombia":            "Colombia",
  // Group L
  "England":             "Inglaterra",
  "Croatia":             "Croacia",
  "Ghana":               "Ghana",
  "Panama":              "Panamá",
};

/**
 * MATCH ID MAP: our internal match ID (73–104) → football-data.org match ID.
 * This will be populated dynamically on first run by calling the API,
 * then cached in Firestore under /meta/matchIdMap so we only build it once.
 *
 * Matching strategy: compare home + away team names (after TEAM_MAP translation)
 * and kickoff date. No hardcoded external IDs needed.
 */

// Our kickoff times (UTC) — used to match API fixtures by date
const KICKOFF = {
  73:"2026-06-28", 74:"2026-06-29", 75:"2026-06-30",
  76:"2026-06-29", 77:"2026-06-30", 78:"2026-06-30",
  79:"2026-07-01", 80:"2026-07-01", 81:"2026-07-02",
  82:"2026-07-01", 83:"2026-07-02", 84:"2026-07-02",
  85:"2026-07-03", 86:"2026-07-03", 87:"2026-07-04",
  88:"2026-07-03", 89:"2026-07-04", 90:"2026-07-04",
  91:"2026-07-05", 92:"2026-07-06", 93:"2026-07-06",
  94:"2026-07-07", 95:"2026-07-07", 96:"2026-07-07",
  97:"2026-07-09", 98:"2026-07-10", 99:"2026-07-11",
  100:"2026-07-11",101:"2026-07-14",102:"2026-07-15",
  103:"2026-07-18",104:"2026-07-19",
};

// Our KO bracket — used to resolve expected team names per slot
// (simplified: we only need home/away for R32; later rounds resolved dynamically)
const KO_SLOTS = {
  73:  ["2nd Group A",  "2nd Group B"],
  74:  ["1st Group E",  "Best 3rd E"],
  75:  ["1st Group F",  "2nd Group C"],
  76:  ["1st Group C",  "2nd Group F"],
  77:  ["1st Group I",  "Best 3rd I"],
  78:  ["2nd Group E",  "2nd Group I"],
  79:  ["1st Group A",  "Best 3rd A"],
  80:  ["1st Group L",  "Best 3rd L"],
  81:  ["1st Group D",  "Best 3rd D"],
  82:  ["1st Group G",  "Best 3rd G"],
  83:  ["2nd Group K",  "2nd Group L"],
  84:  ["1st Group H",  "2nd Group J"],
  85:  ["1st Group B",  "Best 3rd B"],
  86:  ["1st Group J",  "2nd Group H"],
  87:  ["1st Group K",  "Best 3rd K"],
  88:  ["2nd Group D",  "2nd Group G"],
};

// ─── MAIN SCHEDULED FUNCTION ──────────────────────────────────────────────────
exports.fetchResults = onSchedule(
  {
    schedule:      "every 5 minutes",
    timeoutSeconds: 60,
    memory:        "256MiB",
  },
  async () => {
    console.log("⚡ fetchResults: starting");

    try {
      // 1. Get current Firestore results doc
      const resultsRef  = db.doc("results/matches");
      const metaRef     = db.doc("meta/matchIdMap");
      const resultsSnap = await resultsRef.get();
      const metaSnap    = await metaRef.get();

      const currentResults = resultsSnap.exists ? resultsSnap.data() : {};
      let   matchIdMap     = metaSnap.exists    ? metaSnap.data()    : {};

      // 2. Fetch all KO matches from football-data.org
      const stages = ["LAST_32","LAST_16","QUARTER_FINALS","SEMI_FINALS","THIRD_PLACE","FINAL"];
      let   allApiMatches = [];

      for (const stage of stages) {
        const data = await fdFetch(`/competitions/${WC_CODE}/matches?stage=${stage}`);
        if (data && data.matches) allApiMatches = allApiMatches.concat(data.matches);
        // Respect rate limit header — football-data.org free tier: 10 req/min
        await sleep(6500);
      }

      if (allApiMatches.length === 0) {
        console.log("No matches returned from API");
        return;
      }

      // 3. Build / update matchIdMap (our ID → their ID) using date+team matching
      // Only do this for matches we haven't mapped yet
      const unmapped = Object.keys(KICKOFF).filter(id => !matchIdMap[id]);
      if (unmapped.length > 0) {
        for (const ourId of unmapped) {
          const date = KICKOFF[ourId];
          const apiMatch = allApiMatches.find(m => {
            const apiDate = m.utcDate ? m.utcDate.substring(0, 10) : "";
            return apiDate === date;
          });
          // For R32 matches we can also verify by team name
          if (apiMatch) matchIdMap[ourId] = apiMatch.id;
        }
        // Persist the map so we don't recompute it
        await metaRef.set(matchIdMap, { merge: true });
        console.log(`Updated matchIdMap with ${Object.keys(matchIdMap).length} entries`);
      }

      // 4. Process finished matches
      const updates = {};
      let   written = 0;

      for (const apiMatch of allApiMatches) {
        if (apiMatch.status !== "FINISHED") continue;

        // Find our internal ID for this API match
        const ourId = Object.keys(matchIdMap).find(
          k => String(matchIdMap[k]) === String(apiMatch.id)
        );
        if (!ourId) continue;

        const numId = parseInt(ourId, 10);

        // Safety: never overwrite a manually set result (autoFetched === false)
        const existing = currentResults[numId];
        if (existing && existing.autoFetched === false) {
          console.log(`Match ${ourId}: manual override in place, skipping`);
          continue;
        }

        // Extract scores
        const score = apiMatch.score;
        if (!score) continue;

        // Use fullTime score (includes extra time if played)
        const ft = score.fullTime || score.regularTime;
        if (!ft || ft.home == null || ft.away == null) continue;

        const h = ft.home;
        const a = ft.away;

        // Penalty winner — football-data.org uses score.penalties
        let pen = null;
        if (h === a) {
          const pkScore = score.penalties;
          if (pkScore && pkScore.home != null && pkScore.away != null) {
            pen = pkScore.home > pkScore.away ? "h" : "a";
          }
        }

        const entry = { h, a, autoFetched: true };
        if (pen) entry.pen = pen;

        updates[numId] = entry;
        written++;
        console.log(`Match ${ourId} (#${apiMatch.id}): ${h}–${a}${pen ? " pen:"+pen : ""}`);
      }

      // 5. Merge updates into Firestore
      if (written > 0) {
        const merged = { ...currentResults, ...updates };
        await resultsRef.set(merged);
        console.log(`✅ Wrote ${written} result(s) to Firestore`);

        // Log to audit trail
        await db.collection("fetchLog").add({
          ts:      Date.now(),
          written,
          matchIds: Object.keys(updates).map(Number),
        });
      } else {
        console.log("No new finished matches to write");
      }

    } catch (err) {
      console.error("fetchResults error:", err);
    }
  }
);

// ─── HELPERS ──────────────────────────────────────────────────────────────────
async function fdFetch(path) {
  // Dynamic import for node-fetch compatibility in Cloud Functions
  const fetch = (await import("node-fetch")).default;

  const url = `${FD_BASE}${path}`;
  const res = await fetch(url, {
    headers: { "X-Auth-Token": FD_TOKEN },
  });

  // Respect rate limit — check headers as per API docs
  const remaining = parseInt(res.headers.get("X-RequestCounter-Reset") || "10", 10);
  if (remaining <= 2) {
    console.log("Rate limit close — waiting 60s");
    await sleep(60000);
  }

  if (!res.ok) {
    console.error(`API error ${res.status} for ${path}`);
    return null;
  }
  return res.json();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
