const express = require("express");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 10000;
const BASE_URL = "https://oddsradarwire.com";
const API_KEY = process.env.ODDSRADARWIRE_API_KEY;

app.use(express.json());

/* -------------------------------------------------------
   SIMPLE CACHE
   Free OddsRadarWire plan = 100 REST calls/day.
   We cache for 60 seconds so the website doesn't
   repeatedly consume the API quota.
------------------------------------------------------- */

const cache = new Map();
const CACHE_MS = 60 * 1000;

function getCached(key) {
  const item = cache.get(key);

  if (!item) return null;

  if (Date.now() - item.time > CACHE_MS) {
    cache.delete(key);
    return null;
  }

  return item.data;
}

function setCached(key, data) {
  cache.set(key, {
    time: Date.now(),
    data
  });
}

/* -------------------------------------------------------
   SPORTS
------------------------------------------------------- */

const SPORTS = {
  cricket: {
    key: "cricket",
    title: "Cricket",
    providerSport: "CRICKET"
  },

  soccer: {
    key: "soccer",
    title: "Football",
    providerSport: "SOCCER"
  },

  tennis: {
    key: "tennis",
    title: "Tennis",
    providerSport: "TENNIS"
  },

  basketball: {
    key: "basketball",
    title: "Basketball",
    providerSport: "BASKETBALL"
  }
};

/* -------------------------------------------------------
   ODDSRADARWIRE REQUEST
------------------------------------------------------- */

async function oddsRadarRequest(endpoint, params = {}) {
  if (!API_KEY) {
    throw new Error("ODDSRADARWIRE_API_KEY is missing");
  }

  const url = new URL(BASE_URL + endpoint);

  Object.entries(params).forEach(([key, value]) => {
    if (
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {
      url.searchParams.set(key, value);
    }
  });

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "x-api-key": API_KEY,
      "accept": "application/json"
    }
  });

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `OddsRadarWire returned invalid JSON (${response.status})`
    );
  }

  if (!response.ok) {
    const errorMessage =
      data?.message ||
      data?.error ||
      `OddsRadarWire HTTP ${response.status}`;

    throw new Error(errorMessage);
  }

  return data;
}

/* -------------------------------------------------------
   GET FIXTURE ARRAY
------------------------------------------------------- */

function extractFixtures(data) {
  if (Array.isArray(data)) {
    return data;
  }

  if (Array.isArray(data?.fixtures)) {
    return data.fixtures;
  }

  if (Array.isArray(data?.data)) {
    return data.data;
  }

  if (Array.isArray(data?.events)) {
    return data.events;
  }

  return [];
}

/* -------------------------------------------------------
   FIND MATCH WINNER MARKET
------------------------------------------------------- */

function findWinnerMarket(fixture) {
  const markets = Array.isArray(fixture?.markets)
    ? fixture.markets
    : [];

  // Prefer the documented canonical key.
  let market = markets.find(
    m =>
      String(m?.canonical || "").toLowerCase() ===
      "match_winner"
  );

  if (market) return market;

  // Fallback for provider naming differences.
  market = markets.find(m => {
    const text = String(
      m?.market || m?.name || ""
    ).toLowerCase();

    return (
      text.includes("match winner") ||
      text === "winner" ||
      text.includes("winner")
    );
  });

  return market || null;
}

/* -------------------------------------------------------
   GET SELECTION NAME
------------------------------------------------------- */

function selectionName(selection, competitors) {
  const raw =
    selection?.name ||
    selection?.label ||
    selection?.selection ||
    selection?.outcome ||
    selection?.side;

  if (raw !== undefined && raw !== null) {
    const value = String(raw);

    const lower = value.toLowerCase();

    if (
      lower !== "home" &&
      lower !== "away" &&
      lower !== "draw"
    ) {
      return value;
    }

    if (lower === "home" && competitors[0]) {
      return competitors[0].name;
    }

    if (lower === "away" && competitors[1]) {
      return competitors[1].name;
    }

    if (lower === "draw") {
      return "Draw";
    }
  }

  return "Selection";
}

/* -------------------------------------------------------
   CREATE LAY PRICE
------------------------------------------------------- */

function makeLayPrice(backPrice) {
  const price = Number(backPrice) || 0;

  if (price <= 0) {
    return null;
  }

  if (price > 5) {
    return Number((price + 1).toFixed(2));
  }

  return Number((price + 0.04).toFixed(2));
}

/* -------------------------------------------------------
   NORMALIZE ONE FIXTURE
------------------------------------------------------- */

function normalizeFixture(fixture) {
  if (!fixture || !fixture.id) {
    return null;
  }

  const competitors = Array.isArray(fixture.competitors)
    ? fixture.competitors
    : [];

  if (competitors.length < 2) {
    return null;
  }

  const winnerMarket = findWinnerMarket(fixture);

  if (!winnerMarket) {
    return null;
  }

  const selections = Array.isArray(
    winnerMarket.selections
  )
    ? winnerMarket.selections
    : [];

  if (!selections.length) {
    return null;
  }

  const outcomes = [];

  for (const selection of selections) {
    const price = Number(selection?.price);

    if (!Number.isFinite(price) || price <= 1) {
      continue;
    }

    const name = selectionName(
      selection,
      competitors
    );

    if (!name || name === "Selection") {
      continue;
    }

    outcomes.push({
      name,
      price
    });
  }

  if (outcomes.length < 2) {
    return null;
  }

  const layOutcomes = outcomes.map(outcome => ({
    name: outcome.name,
    price: makeLayPrice(outcome.price)
  }));

  const isLive =
    fixture.phase === "live" ||
    fixture.in_play === true ||
    fixture.inPlay === true;

  const commenceTime =
    fixture.start_time ||
    fixture.commence_time ||
    fixture.scheduled_start ||
    fixture.startTime ||
    null;

  return {
    id: fixture.id,

    sport: String(
      fixture.sport || ""
    ).toLowerCase(),

    home_team:
      competitors[0]?.name || "Team 1",

    away_team:
      competitors[1]?.name || "Team 2",

    homeTeam:
      competitors[0]?.name || "Team 1",

    awayTeam:
      competitors[1]?.name || "Team 2",

    commence_time: commenceTime,

    commenceTime,

    time:
      commenceTime,

    live: isLive,

    in_play: isLive,

    status:
      isLive ? "LIVE" : "UPCOMING",

    phase:
      fixture.phase || null,

    competition:
      fixture.competition || null,

    bookmakers: [
      {
        key: "oddsradarwire",
        title: "OddsRadarWire",

        markets: [
          {
            key: "h2h",
            market: "Match Winner",
            outcomes
          },

          {
            key: "h2h_lay",
            market: "Match Winner Lay",
            outcomes: layOutcomes
          }
        ]
      }
    ],

    // Easier access for our frontend.
    h2h: outcomes,

    h2h_lay: layOutcomes
  };
}

/* -------------------------------------------------------
   GET ODDS
------------------------------------------------------- */

app.get("/api/odds/:sport", async (req, res) => {
  try {
    const sportKey = String(
      req.params.sport || ""
    ).toLowerCase();

    const sport = SPORTS[sportKey];

    if (!sport) {
      return res.status(400).json({
        error: "Unsupported sport",
        supported: Object.keys(SPORTS)
      });
    }

    const cacheKey = `odds:${sportKey}`;

    const cached = getCached(cacheKey);

    if (cached) {
      return res.json(cached);
    }

    /*
      IMPORTANT:

      We intentionally do NOT send:

      canonical=match_winner

      here.

      We first retrieve the actual fixtures and then
      locate match_winner locally. This prevents a provider
      filtering difference from turning the entire response
      into [].
    */

    const [liveData, prematchData] =
      await Promise.all([
        oddsRadarRequest("/v1/fixtures", {
          event_type: "live",
          sport: sport.providerSport,
          tier: 1,
          limit: 100
        }),

        oddsRadarRequest("/v1/fixtures", {
          event_type: "prematch",
          sport: sport.providerSport,
          tier: 1,
          limit: 100
        })
      ]);

    const liveFixtures =
      extractFixtures(liveData);

    const prematchFixtures =
      extractFixtures(prematchData);

    const allFixtures = [
      ...liveFixtures,
      ...prematchFixtures
    ];

    // Remove duplicate fixture IDs.
    const uniqueFixtures = [];
    const seen = new Set();

    for (const fixture of allFixtures) {
      const id = fixture?.id;

      if (!id || seen.has(id)) {
        continue;
      }

      seen.add(id);
      uniqueFixtures.push(fixture);
    }

    const normalized = [];

    for (const fixture of uniqueFixtures) {
      const item = normalizeFixture(fixture);

      if (item) {
        normalized.push(item);
      }
    }

    /*
      LIVE first, then upcoming.
    */

    normalized.sort((a, b) => {
      if (a.live && !b.live) return -1;
      if (!a.live && b.live) return 1;

      const ta = a.commence_time
        ? new Date(a.commence_time).getTime()
        : Infinity;

      const tb = b.commence_time
        ? new Date(b.commence_time).getTime()
        : Infinity;

      return ta - tb;
    });

    setCached(cacheKey, normalized);

    console.log(
      `[OddsRadarWire] ${sportKey}: provider=${allFixtures.length}, normalized=${normalized.length}`
    );

    return res.json(normalized);

  } catch (error) {
    console.error(
      "[OddsRadarWire ERROR]",
      error
    );

    return res.status(502).json({
      error: "Unable to load odds",
      message: error.message
    });
  }
});

/* -------------------------------------------------------
   SPORTS
------------------------------------------------------- */

app.get("/api/sports", (req, res) => {
  res.json(
    Object.values(SPORTS).map(sport => ({
      key: sport.key,
      group:
        sport.key === "soccer"
          ? "Football"
          : sport.title,

      title: sport.title,

      description:
        `${sport.title} odds`,

      active: true,

      has_outrights: false
    }))
  );
});

/* -------------------------------------------------------
   PROVIDER ACCOUNT
------------------------------------------------------- */

app.get("/api/provider/me", async (req, res) => {
  try {
    const data =
      await oddsRadarRequest("/v1/me");

    res.json(data);

  } catch (error) {
    res.status(502).json({
      error: error.message
    });
  }
});

/* -------------------------------------------------------
   PROVIDER HEALTH
------------------------------------------------------- */

app.get("/api/provider/health", async (req, res) => {
  try {
    const data =
      await oddsRadarRequest("/v1/health");

    res.json(data);

  } catch (error) {
    res.status(502).json({
      error: error.message
    });
  }
});

/* -------------------------------------------------------
   BASIC HEALTH
------------------------------------------------------- */

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "NOVA PLAY",
    provider: "OddsRadarWire"
  });
});

/* -------------------------------------------------------
   FRONTEND
------------------------------------------------------- */

const distPath = path.join(
  __dirname,
  "../dist"
);

app.use(
  express.static(distPath)
);

app.get("/{*splat}", (req, res) => {
  res.sendFile(
    path.join(
      distPath,
      "index.html"
    )
  );
});

/* -------------------------------------------------------
   START
------------------------------------------------------- */

app.listen(PORT, () => {
  console.log(
    `NOVA PLAY server running on port ${PORT}`
  );
});
