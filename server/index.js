import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const PORT = process.env.PORT || 10000;
const BASE_URL = "https://oddsradarwire.com";
const API_KEY = process.env.ODDSRADARWIRE_API_KEY;

app.use(express.json());

/* =====================================================
   CACHE
===================================================== */

const cache = new Map();

const CACHE_MS = 60 * 1000;

function getCached(key) {
  const item = cache.get(key);

  if (!item) {
    return null;
  }

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

/* =====================================================
   SPORTS
===================================================== */

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

/* =====================================================
   ODDSRADARWIRE API REQUEST
===================================================== */

async function oddsRadarRequest(endpoint, params = {}) {
  if (!API_KEY) {
    throw new Error(
      "ODDSRADARWIRE_API_KEY is missing from Render environment variables"
    );
  }

  const url = new URL(BASE_URL + endpoint);

  for (const [key, value] of Object.entries(params)) {
    if (
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {
      url.searchParams.set(key, String(value));
    }
  }

  console.log(
    `[OddsRadarWire] GET ${url.pathname}${url.search}`
  );

  const response = await fetch(url, {
    method: "GET",

    headers: {
      "x-api-key": API_KEY,
      "Accept": "application/json"
    }
  });

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `OddsRadarWire returned invalid JSON. HTTP ${response.status}`
    );
  }

  if (!response.ok) {
    const message =
      data?.message ||
      data?.error ||
      data?.detail ||
      `OddsRadarWire HTTP ${response.status}`;

    throw new Error(message);
  }

  return data;
}

/* =====================================================
   EXTRACT FIXTURES
===================================================== */

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

  if (Array.isArray(data?.results)) {
    return data.results;
  }

  return [];
}

/* =====================================================
   FIND MATCH WINNER MARKET
===================================================== */

function findWinnerMarket(fixture) {
  const markets = Array.isArray(fixture?.markets)
    ? fixture.markets
    : [];

  let market = markets.find(
    (m) =>
      String(m?.canonical || "").toLowerCase() ===
      "match_winner"
  );

  if (market) {
    return market;
  }

  market = markets.find((m) => {
    const text = String(
      m?.market ||
      m?.name ||
      m?.market_name ||
      ""
    ).toLowerCase();

    return (
      text.includes("match winner") ||
      text === "winner" ||
      text.includes("winner")
    );
  });

  return market || null;
}

/* =====================================================
   GET COMPETITORS
===================================================== */

function getCompetitors(fixture) {
  if (Array.isArray(fixture?.competitors)) {
    return fixture.competitors;
  }

  if (Array.isArray(fixture?.participants)) {
    return fixture.participants;
  }

  return [];
}

/* =====================================================
   SELECTION NAME
===================================================== */

function getSelectionName(
  selection,
  competitors
) {
  let value =
    selection?.name ??
    selection?.label ??
    selection?.selection ??
    selection?.outcome ??
    selection?.side;

  if (
    value !== undefined &&
    value !== null
  ) {
    const text = String(value);
    const lower = text.toLowerCase();

    if (
      lower !== "home" &&
      lower !== "away" &&
      lower !== "draw"
    ) {
      return text;
    }

    if (
      lower === "home" &&
      competitors[0]?.name
    ) {
      return competitors[0].name;
    }

    if (
      lower === "away" &&
      competitors[1]?.name
    ) {
      return competitors[1].name;
    }

    if (lower === "draw") {
      return "Draw";
    }
  }

  if (
    selection?.competitor_id &&
    competitors.length
  ) {
    const competitor =
      competitors.find(
        (c) =>
          String(c?.id) ===
          String(selection.competitor_id)
      );

    if (competitor?.name) {
      return competitor.name;
    }
  }

  return null;
}

/* =====================================================
   LAY PRICE
===================================================== */

function makeLayPrice(backPrice) {
  const price = Number(backPrice);

  if (!Number.isFinite(price) || price <= 1) {
    return null;
  }

  /*
    NOVA PLAY virtual/demo lay calculation.

    Back < 5.00
      Lay = Back + 2%

    Back >= 5.00
      Lay = Back + 1.00

    Examples:

    1.50 -> 1.53
    1.75 -> 1.79
    2.00 -> 2.04
    4.99 -> 5.09
    5.00 -> 6.00
    5.01 -> 6.01
    6.00 -> 7.00
  */

  if (price < 5) {
    return Number(
      (price * 1.02).toFixed(2)
    );
  }

  return Number(
    (price + 1).toFixed(2)
  );
}

/* =====================================================
   FIND REAL LAY PRICE
===================================================== */

function getRealLayPrice(selection) {
  const possible =
    selection?.lay_price ??
    selection?.layPrice ??
    selection?.lay ??
    selection?.exchange_lay_price ??
    null;

  const price = Number(possible);

  if (
    Number.isFinite(price) &&
    price > 1
  ) {
    return price;
  }

  return null;
}

/* =====================================================
   NORMALIZE ONE FIXTURE
===================================================== */

function normalizeFixture(fixture) {
  if (!fixture) {
    return null;
  }

  const fixtureId =
    fixture.id ??
    fixture.fixture_id ??
    fixture.event_id;

  if (!fixtureId) {
    return null;
  }

  const competitors =
    getCompetitors(fixture);

  if (competitors.length < 2) {
    return null;
  }

  const homeTeam =
    competitors.find(
      (c) => c?.isHome === true
    )?.name ||
    competitors[0]?.name ||
    "Team 1";

  const awayTeam =
    competitors.find(
      (c) => c?.isHome === false
    )?.name ||
    competitors[1]?.name ||
    "Team 2";

  /* ===================================================
     FIND MATCH WINNER
  =================================================== */

  const winnerMarket =
    findWinnerMarket(fixture);

  if (!winnerMarket) {
    console.log(
      `[OddsRadarWire] Fixture ${fixtureId}: no match_winner market`
    );

    return null;
  }

  const selections =
    Array.isArray(
      winnerMarket?.selections
    )
      ? winnerMarket.selections
      : [];

  if (!selections.length) {
    return null;
  }

  const outcomes = [];

  for (const selection of selections) {
    const price = Number(
      selection?.price ??
      selection?.odds ??
      selection?.decimal_price
    );

    if (
      !Number.isFinite(price) ||
      price <= 1
    ) {
      continue;
    }

    const name =
      getSelectionName(
        selection,
        competitors
      );

    if (!name) {
      continue;
    }

    const realLay =
      getRealLayPrice(selection);

    outcomes.push({
      name,
      price,

      selection_id:
        selection?.id ??
        selection?.selection_id ??
        null,

      line:
        selection?.line ??
        null,

      status:
        selection?.status ??
        winnerMarket?.status ??
        "OPEN",

      layPrice:
        realLay
    });
  }

  /* ===================================================
     MATCH WINNER NEEDS TWO SELECTIONS
  =================================================== */

  if (outcomes.length < 2) {
    return null;
  }

  /* ===================================================
     CREATE LAY MARKET
  =================================================== */

  const layOutcomes =
    outcomes.map((outcome) => ({
      name: outcome.name,

      price:
        outcome.layPrice ??
        makeLayPrice(outcome.price)
    }));

  /* ===================================================
     LIVE DETECTION
  =================================================== */

  const phase =
    String(
      fixture?.phase ||
      fixture?.status ||
      ""
    ).toLowerCase();

  const isLive =
    fixture?.live === true ||
    fixture?.in_play === true ||
    fixture?.inPlay === true ||
    phase === "live" ||
    phase === "inplay" ||
    phase === "in_play";

  /* ===================================================
     START TIME
  =================================================== */

  const commenceTime =
    fixture?.start_time ??
    fixture?.commence_time ??
    fixture?.scheduled_start ??
    fixture?.scheduledStart ??
    fixture?.startTime ??
    null;

  /* ===================================================
     COMPETITION
  =================================================== */

  const competition =
    fixture?.competition ??
    fixture?.league ??
    fixture?.tournament ??
    null;

  /* ===================================================
     BOOKMAKER OBJECT
  =================================================== */

  const bookmaker = {
    key: "oddsradarwire",

    title: "OddsRadarWire",

    markets: [
      {
        key: "h2h",

        market: "Match Winner",

        outcomes: outcomes.map(
          (o) => ({
            name: o.name,
            price: o.price,

            selection_id:
              o.selection_id,

            line:
              o.line,

            status:
              o.status
          })
        )
      },

      {
        key: "h2h_lay",

        market: "Match Winner Lay",

        outcomes: layOutcomes
      }
    ]
  };

  /* ===================================================
     RETURN NORMALIZED EVENT
  =================================================== */

  return {
    id: String(fixtureId),

    sport: String(
      fixture?.sport || ""
    ).toLowerCase(),

    home_team: homeTeam,

    away_team: awayTeam,

    homeTeam,

    awayTeam,

    commence_time: commenceTime,

    commenceTime,

    time: commenceTime,

    live: isLive,

    in_play: isLive,

    status:
      isLive
        ? "LIVE"
        : "UPCOMING",

    phase:
      fixture?.phase ?? null,

    competition,

    provider:
      fixture?.provider ??
      "ODDSRADARWIRE",

    bookmakers: [
      bookmaker
    ],

    h2h: outcomes.map(
      (o) => ({
        name: o.name,
        price: o.price
      })
    ),

    h2h_lay: layOutcomes
  };
}

/* =====================================================
   REMOVE DUPLICATES
===================================================== */

function uniqueFixtures(fixtures) {
  const result = [];
  const seen = new Set();

  for (const fixture of fixtures) {
    const id =
      fixture?.id ??
      fixture?.fixture_id ??
      fixture?.event_id;

    if (!id) {
      continue;
    }

    const key = String(id);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(fixture);
  }

  return result;
}

/* =====================================================
   SORT MATCHES
===================================================== */

function sortFixtures(fixtures) {
  return fixtures.sort(
    (a, b) => {
      /*
        LIVE first.
      */

      if (
        a.live &&
        !b.live
      ) {
        return -1;
      }

      if (
        !a.live &&
        b.live
      ) {
        return 1;
      }

      /*
        Then by start time.
      */

      const timeA =
        a.commence_time
          ? new Date(
              a.commence_time
            ).getTime()
          : Number.MAX_SAFE_INTEGER;

      const timeB =
        b.commence_time
          ? new Date(
              b.commence_time
            ).getTime()
          : Number.MAX_SAFE_INTEGER;

      return timeA - timeB;
    }
  );
}

/* =====================================================
   ODDS ROUTE
===================================================== */

app.get(
  "/api/odds/:sport",
  async (req, res) => {
    try {
      const sportKey =
        String(
          req.params.sport || ""
        ).toLowerCase();

      const sport =
        SPORTS[sportKey];

      if (!sport) {
        return res.status(400).json({
          error:
            "Unsupported sport",

          supported:
            Object.keys(SPORTS)
        });
      }

      const cacheKey =
        `odds:${sportKey}`;

      /* ===============================================
         RETURN CACHE
      =============================================== */

      const cached =
        getCached(cacheKey);

      if (cached) {
        console.log(
          `[OddsRadarWire] ${sportKey}: returning cached data (${cached.length})`
        );

        return res.json(cached);
      }

      console.log(
        `[OddsRadarWire] Loading ${sportKey} fixtures...`
      );

      /*
        IMPORTANT:

        We deliberately DO NOT send:

        canonical=match_winner

        to the provider.

        We retrieve fixtures first and
        find Match Winner locally.
      */

      const livePromise =
        oddsRadarRequest(
          "/v1/fixtures",
          {
            event_type: "live",

            sport:
              sport.providerSport,

            tier: 1,

            limit: 100
          }
        );

      const prematchPromise =
        oddsRadarRequest(
          "/v1/fixtures",
          {
            event_type: "prematch",

            sport:
              sport.providerSport,

            tier: 1,

            limit: 100
          }
        );

      const [
        liveData,
        prematchData
      ] =
        await Promise.all([
          livePromise,
          prematchPromise
        ]);

      const liveFixtures =
        extractFixtures(
          liveData
        );

      const prematchFixtures =
        extractFixtures(
          prematchData
        );

      console.log(
        `[OddsRadarWire] ${sportKey}: live=${liveFixtures.length}, prematch=${prematchFixtures.length}`
      );

      /* ===============================================
         COMBINE
      =============================================== */

      const allFixtures = [
        ...liveFixtures,
        ...prematchFixtures
      ];

      /* ===============================================
         REMOVE DUPLICATES
      =============================================== */

      const unique =
        uniqueFixtures(
          allFixtures
        );

      console.log(
        `[OddsRadarWire] ${sportKey}: unique=${unique.length}`
      );

      /* ===============================================
         NORMALIZE
      =============================================== */

      const normalized = [];

      for (const fixture of unique) {
        try {
          const item =
            normalizeFixture(
              fixture
            );

          if (item) {
            normalized.push(item);
          }
        } catch (error) {
          console.error(
            `[OddsRadarWire] Failed to normalize fixture ${fixture?.id}:`,
            error.message
          );
        }
      }

      /* ===============================================
         SORT
      =============================================== */

      sortFixtures(
        normalized
      );

      /* ===============================================
         CACHE
      =============================================== */

      setCached(
        cacheKey,
        normalized
      );

      console.log(
        `[OddsRadarWire] ${sportKey}: provider=${allFixtures.length}, normalized=${normalized.length}`
      );

      return res.json(
        normalized
      );

    } catch (error) {
      console.error(
        "[OddsRadarWire ERROR]",
        error
      );

      return res.status(502).json({
        error:
          "Unable to load odds",

        message:
          error.message
      });
    }
  }
);

/* =====================================================
   SPORTS ROUTE
===================================================== */

app.get(
  "/api/sports",
  (req, res) => {
    const sports =
      Object.values(
        SPORTS
      ).map(
        (sport) => ({
          key:
            sport.key,

          group:
            sport.key ===
            "soccer"
              ? "Football"
              : sport.title,

          title:
            sport.title,

          description:
            `${sport.title} odds`,

          active: true,

          has_outrights:
            false
        })
      );

    res.json(sports);
  }
);

/* =====================================================
   PROVIDER ACCOUNT
===================================================== */

app.get(
  "/api/provider/me",
  async (req, res) => {
    try {
      const data =
        await oddsRadarRequest(
          "/v1/me"
        );

      res.json(data);

    } catch (error) {
      console.error(
        "[Provider ME ERROR]",
        error
      );

      res.status(502).json({
        error:
          error.message
      });
    }
  }
);

/* =====================================================
   PROVIDER HEALTH
===================================================== */

app.get(
  "/api/provider/health",
  async (req, res) => {
    try {
      const data =
        await oddsRadarRequest(
          "/v1/health"
        );

      res.json(data);

    } catch (error) {
      console.error(
        "[Provider HEALTH ERROR]",
        error
      );

      res.status(502).json({
        error:
          error.message
      });
    }
  }
);

/* =====================================================
   NOVA PLAY HEALTH
===================================================== */

app.get(
  "/api/health",
  (req, res) => {
    res.json({
      ok: true,

      service:
        "NOVA PLAY",

      provider:
        "OddsRadarWire",

      server:
        "online",

      time:
        new Date().toISOString()
    });
  }
);

/* =====================================================
   DEBUG ROUTE
   Shows provider fixture counts WITHOUT API KEY.
===================================================== */

app.get(
  "/api/debug/:sport",
  async (req, res) => {
    try {
      const sportKey =
        String(
          req.params.sport || ""
        ).toLowerCase();

      const sport =
        SPORTS[sportKey];

      if (!sport) {
        return res.status(400).json({
          error:
            "Unsupported sport",

          supported:
            Object.keys(SPORTS)
        });
      }

      const [
        liveData,
        prematchData
      ] =
        await Promise.all([
          oddsRadarRequest(
            "/v1/fixtures",
            {
              event_type: "live",

              sport:
                sport.providerSport,

              tier: 1,

              limit: 100
            }
          ),

          oddsRadarRequest(
            "/v1/fixtures",
            {
              event_type: "prematch",

              sport:
                sport.providerSport,

              tier: 1,

              limit: 100
            }
          )
        ]);

      const live =
        extractFixtures(
          liveData
        );

      const prematch =
        extractFixtures(
          prematchData
        );

      const all = [
        ...live,
        ...prematch
      ];

      const marketSummary =
        {};

      for (const fixture of all) {
        const markets =
          Array.isArray(
            fixture?.markets
          )
            ? fixture.markets
            : [];

        for (const market of markets) {
          const canonical =
            market?.canonical ||
            market?.market ||
            market?.name ||
            "unknown";

          marketSummary[
            canonical
          ] =
            (marketSummary[
              canonical
            ] || 0) + 1;
        }
      }

      res.json({
        sport:
          sport.providerSport,

        live:
          live.length,

        prematch:
          prematch.length,

        total:
          all.length,

        markets:
          marketSummary
      });

    } catch (error) {
      console.error(
        "[DEBUG ERROR]",
        error
      );

      res.status(502).json({
        error:
          error.message
      });
    }
  }
);

/* =====================================================
   STATIC FRONTEND
===================================================== */

const distPath =
  path.join(
    __dirname,
    "../dist"
  );

app.use(
  express.static(
    distPath
  )
);

/* =====================================================
   FRONTEND FALLBACK
===================================================== */

app.get(
  "/{*splat}",
  (req, res) => {
    res.sendFile(
      path.join(
        distPath,
        "index.html"
      )
    );
  }
);

/* =====================================================
   START SERVER
===================================================== */

app.listen(
  PORT,
  () => {
    console.log(
      `NOVA PLAY server running on port ${PORT}`
    );

    console.log(
      `OddsRadarWire configured: ${Boolean(API_KEY)}`
    );
  }
);
