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

// Real R32 fixtures (home, away) in football-data.org's English team names.
// This is the ground truth used to match API fixtures to our internal match IDs —
// date alone is NOT reliable since several R32 matches share the same calendar date
// (e.g. M74 and M76 both kick off 2026-06-29), which previously caused the Cloud
// Function to silently mismatch fixtures and write the wrong team's score under
// the wrong internal match ID.
const R32_TEAMS = {
  73: ["South Africa", "Canada"],
  74: ["Germany", "Paraguay"],
  75: ["Netherlands", "Morocco"],
  76: ["Brazil", "Japan"],
  77: ["France", "Sweden"],
  78: ["Ivory Coast", "Norway"],
  79: ["Mexico", "Ecuador"],
  80: ["England", "Congo DR"],           // API uses "Congo DR" not "DR Congo"
  81: ["United States", "Bosnia-Herzegovina"], // API uses "United States" and "Bosnia-Herzegovina" (en-dash)
  82: ["Belgium", "Senegal"],
  83: ["Portugal", "Croatia"],
  84: ["Spain", "Austria"],
  85: ["Switzerland", "Algeria"],
  86: ["Argentina", "Cape Verde Islands"], // API uses "Cape Verde Islands" not "Cabo Verde"
  87: ["Colombia", "Ghana"],
  88: ["Australia", "Egypt"],
};
// Normalizes a team name for loose comparison (case/diacritics/whitespace insensitive)
function normTeam(name) {
  return String(name || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // strip accents
    .toLowerCase().replace(/[^a-z0-9]/g, "");
}
// Build a reverse lookup: normalised API name → normalised R32_TEAMS name,
// so we can catch variants like "Côte d'Ivoire" matching "Ivory Coast"
// by checking both the raw name AND the TEAM_MAP-translated version.
function teamsMatch(apiName, wantName) {
  const normApi = normTeam(apiName);
  const normWant = normTeam(wantName);
  if (normApi === normWant) return true;
  // Also try matching via TEAM_MAP translation
  const mapped = normTeam(TEAM_MAP[apiName] || "");
  return mapped && mapped === normWant;
}

// Full knockout bracket structure (mirrors index.html / admin.html exactly).
// Used to dynamically resolve R16+ team names from already-known results,
// so those rounds can also be matched to the API by team name instead of
// date alone (R16+ dates can collide too, e.g. July 6 has both #92 and #93).
const KO_BRACKET = {
  73:{s:[{pos:2,g:"A"},{pos:2,g:"B"}]},
  74:{s:[{pos:1,g:"E"},{third:"E"}]},
  75:{s:[{pos:1,g:"F"},{pos:2,g:"C"}]},
  76:{s:[{pos:1,g:"C"},{pos:2,g:"F"}]},
  77:{s:[{pos:1,g:"I"},{third:"I"}]},
  78:{s:[{pos:2,g:"E"},{pos:2,g:"I"}]},
  79:{s:[{pos:1,g:"A"},{third:"A"}]},
  80:{s:[{pos:1,g:"L"},{third:"L"}]},
  81:{s:[{pos:1,g:"D"},{third:"D"}]},
  82:{s:[{pos:1,g:"G"},{third:"G"}]},
  83:{s:[{pos:2,g:"K"},{pos:2,g:"L"}]},
  84:{s:[{pos:1,g:"H"},{pos:2,g:"J"}]},
  85:{s:[{pos:1,g:"B"},{third:"B"}]},
  86:{s:[{pos:1,g:"J"},{pos:2,g:"H"}]},
  87:{s:[{pos:1,g:"K"},{third:"K"}]},
  88:{s:[{pos:2,g:"D"},{pos:2,g:"G"}]},
  89:{s:[{W:74},{W:77}]},
  90:{s:[{W:73},{W:75}]},
  91:{s:[{W:76},{W:78}]},
  92:{s:[{W:79},{W:80}]},
  93:{s:[{W:83},{W:84}]},
  94:{s:[{W:81},{W:82}]},
  95:{s:[{W:86},{W:88}]},
  96:{s:[{W:85},{W:87}]},
  97:{s:[{W:89},{W:90}]},
  98:{s:[{W:93},{W:94}]},
  99:{s:[{W:91},{W:92}]},
  100:{s:[{W:95},{W:96}]},
  101:{s:[{W:97},{W:98}]},
  102:{s:[{W:99},{W:100}]},
  103:{s:[{L:101},{L:102}]},
  104:{s:[{W:101},{W:102}]},
};
// Group qualifiers (winner/runner-up) and 3rd-place bracket-slot teams,
// used by resolveSlot() to turn pos/third slots into real English team names.
// IMPORTANT: keep this in sync with index.html's GROUP_QUALIFIERS / THIRD_QUALIFIERS
// (English here since we're matching against the football-data.org API).
const GROUP_QUALIFIERS_EN = {
  A:{1:"Mexico",        2:"South Africa"},
  B:{1:"Switzerland",   2:"Canada"},
  C:{1:"Brazil",        2:"Morocco"},
  D:{1:"USA",           2:"Australia"},
  E:{1:"Germany",       2:"Ivory Coast"},
  F:{1:"Netherlands",   2:"Japan"},
  G:{1:"Belgium",       2:"Egypt"},
  H:{1:"Spain",         2:"Cabo Verde"},
  I:{1:"France",        2:"Norway"},
  J:{1:"Argentina",     2:"Austria"},
  K:{1:"Colombia",      2:"Portugal"},
  L:{1:"England",       2:"Croatia"},
};
const THIRD_QUALIFIERS_EN = {
  E:"Paraguay", I:"Sweden", A:"Ecuador", L:"DR Congo",
  D:"Bosnia and Herzegovina", G:"Senegal", B:"Algeria", K:"Ghana",
};
// Resolves a bracket slot to a real team name (English), given currently-known
// results. Returns null if not yet resolvable (match not finished, or feeder
// match's own teams aren't resolvable yet).
function resolveSlot(slot, results) {
  if (slot.pos) return (GROUP_QUALIFIERS_EN[slot.g] && GROUP_QUALIFIERS_EN[slot.g][slot.pos]) || null;
  if (slot.third) return THIRD_QUALIFIERS_EN[slot.third] || null;
  if (slot.W) {
    const res = results[slot.W];
    const feeder = KO_BRACKET[slot.W];
    if (!res || res.h == null || !feeder) return null;
    const hT = resolveSlot(feeder.s[0], results);
    const aT = resolveSlot(feeder.s[1], results);
    if (!hT || !aT) return null;
    if (res.h > res.a) return hT;
    if (res.a > res.h) return aT;
    if (res.pen === "h") return hT;
    if (res.pen === "a") return aT;
    return null;
  }
  if (slot.L) {
    const res = results[slot.L];
    const feeder = KO_BRACKET[slot.L];
    if (!res || res.h == null || !feeder) return null;
    const hT = resolveSlot(feeder.s[0], results);
    const aT = resolveSlot(feeder.s[1], results);
    if (!hT || !aT) return null;
    if (res.h > res.a) return aT;
    if (res.a > res.h) return hT;
    if (res.pen === "h") return aT;
    if (res.pen === "a") return hT;
    return null;
  }
  return null;
}

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

      // 3. Build / update matchIdMap (our ID → their ID) using team-name matching.
      // Only do this for matches we haven't mapped yet.
      // IMPORTANT: date alone is not a reliable key (multiple R32 fixtures can share
      // a calendar date), so for R32 (73-88) we match on actual team names via
      // R32_TEAMS, and only fall back to date-only matching for later rounds
      // (89+) where the participating teams aren't known in advance.
      const unmapped = Object.keys(KICKOFF).filter(id => !matchIdMap[id]);
      if (unmapped.length > 0) {
        for (const ourId of unmapped) {
          const numOurId = parseInt(ourId, 10);
          const date = KICKOFF[ourId];
          let apiMatch = null;

          if (R32_TEAMS[numOurId]) {
            // R32: match by team names, not just date, to avoid same-day collisions
            const [wantHome, wantAway] = R32_TEAMS[numOurId];
            apiMatch = allApiMatches.find(m => {
              const apiHome = m.homeTeam && m.homeTeam.name;
              const apiAway = m.awayTeam && m.awayTeam.name;
              // Accept either orientation; we record whether it's flipped below
              return (teamsMatch(apiHome, wantHome) && teamsMatch(apiAway, wantAway)) ||
                     (teamsMatch(apiHome, wantAway) && teamsMatch(apiAway, wantHome));
            });
            if (apiMatch) {
              const apiHome = normTeam(apiMatch.homeTeam && apiMatch.homeTeam.name);
              // Record whether the API's home/away is flipped relative to ours
              matchIdMap[ourId] = apiMatch.id;
              matchIdMap[ourId + "_flip"] = !teamsMatch(apiMatch.homeTeam.name, wantHome);
            } else {
              console.log(`Match ${ourId}: no team-name match found in API for ${R32_TEAMS[numOurId].join(" vs ")} on ${date}`);
            }
          } else {
            // R16+ : resolve expected team names dynamically from already-known
            // results (their own feeder matches), then match by team name just
            // like R32. Falls back to date-only matching only if the bracket
            // isn't resolvable yet (feeder match unfinished) — in that case we
            // skip for now and retry on a later run once the feeder is known.
            const bracketEntry = KO_BRACKET[numOurId];
            const wantHomeName = bracketEntry ? resolveSlot(bracketEntry.s[0], currentResults) : null;
            const wantAwayName = bracketEntry ? resolveSlot(bracketEntry.s[1], currentResults) : null;

            if (wantHomeName && wantAwayName) {
              apiMatch = allApiMatches.find(m => {
                const apiHome = m.homeTeam && m.homeTeam.name;
                const apiAway = m.awayTeam && m.awayTeam.name;
                return (teamsMatch(apiHome, wantHomeName) && teamsMatch(apiAway, wantAwayName)) ||
                       (teamsMatch(apiHome, wantAwayName) && teamsMatch(apiAway, wantHomeName));
              });
              if (apiMatch) {
                matchIdMap[ourId] = apiMatch.id;
                matchIdMap[ourId + "_flip"] = !teamsMatch(apiMatch.homeTeam.name, wantHomeName);
              } else {
                console.log(`Match ${ourId}: no team-name match found for ${wantHomeName} vs ${wantAwayName} on ${date}`);
              }
            } else {
              // Feeder match(es) not finished yet — teams unknown, can't safely
              // match by name. Skip for now; will retry automatically on next run.
              console.log(`Match ${ourId}: teams not yet resolvable (feeder match pending), skipping for now`);
            }
          }
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

        // Correct for home/away orientation mismatch between our bracket and the API,
        // recorded as "<id>_flip" in matchIdMap during the matching step above.
        const flipped = matchIdMap[ourId + "_flip"] === true;
        const h = flipped ? ft.away : ft.home;
        const a = flipped ? ft.home : ft.away;

        // Penalty winner — football-data.org uses score.penalties
        let pen = null;
        if (h === a) {
          const pkScore = score.penalties;
          if (pkScore && pkScore.home != null && pkScore.away != null) {
            const penHomeWins = pkScore.home > pkScore.away;
            pen = flipped ? (penHomeWins ? "a" : "h") : (penHomeWins ? "h" : "a");
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
