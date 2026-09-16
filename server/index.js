import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;

const API_KEY = process.env.ODDSRADARWIRE_API_KEY;
const BASE_URL = "https://oddsradarwire.com";

// Short server-side cache.
// This prevents every browser refresh/user from consuming API calls.
const CACHE_MS = 60 * 1000;

const cache = new Map();

/*
  One NOVA PLAY sport = one OddsRadarWire sport.

  This is intentionally NOT using The Odds API sport keys anymore.
*/
const SPORTS = {
  cricket: {
    key: "cricket",
    title: "Cricket",
    providerSport: "CRICKET",
  },

  soccer: {
    key: "soccer",
    title: "Football",
    providerSport: "SOCCER",
  },

  tennis: {
    key: "tennis",
    title: "Tennis",
    providerSport: "TENNIS",
  },

  basketball: {
    key: "basketball",
    title: "Basketball",
    providerSport: "BASKETBALL",
  },
};


// ----------------------------------------------------
// CACHE
// ----------------------------------------------------

function getCache(key) {
  const item = cache.get(key);

  if (!item) return null;

  if (Date.now() - item.time > CACHE_MS) {
    cache.delete(key);
    return null;
  }

  return item.data;
}

function setCache(key, data) {
  cache.set(key, {
    time: Date.now(),
    data,
  });
}


// ----------------------------------------------------
// ODDSRADARWIRE REQUEST
// ----------------------------------------------------

async function oddsRadarRequest(endpoint, params = {}) {

  if (!API_KEY) {
    const error = new Error(
      "Missing ODDSRADARWIRE_API_KEY environment variable"
    );

    error.status = 503;

    throw error;
  }

  const url = new URL(BASE_URL + endpoint);

  for (const [key, value] of Object.entries(params)) {
    if (
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url, {
    method: "GET",

    headers: {
      "x-api-key": API_KEY,
      "Accept": "application/json",
    },
  });

  const text = await response.text();

  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {
      raw: text,
    };
  }

  if (!response.ok) {

    const error = new Error(
      data?.message ||
      data?.error ||
      `OddsRadarWire HTTP ${response.status}`
    );

    error.status = response.status;
    error.body = data;

    const retryAfter = response.headers.get("retry-after");

    if (retryAfter) {
      error.retryAfter = retryAfter;
    }

    throw error;
  }

  return data;
}


// ----------------------------------------------------
// ARRAY HELPER
// ----------------------------------------------------

function getFixtures(data) {

  if (Array.isArray(data)) {
    return data;
  }

  if (Array.isArray(data?.fixtures)) {
    return data.fixtures;
  }

  if (Array.isArray(data?.events)) {
    return data.events;
  }

  if (Array.isArray(data?.data)) {
    return data.data;
  }

  return [];
}


// ----------------------------------------------------
// TEAM NAMES
// ----------------------------------------------------

function getTeams(fixture) {

  const competitors = Array.isArray(
    fixture?.competitors
  )
    ? fixture.competitors
    : [];

  let home = competitors.find(
    c => c?.isHome === true
  )?.name;

  let away = competitors.find(
    c => c?.isHome === false
  )?.name;

  // Safety fallback
  if (!home && competitors[0]) {
    home = competitors[0].name;
  }

  if (!away && competitors[1]) {
    away = competitors[1].name;
  }

  home =
    home ||
    fixture?.home_team ||
    fixture?.homeTeam ||
    "Home";

  away =
    away ||
    fixture?.away_team ||
    fixture?.awayTeam ||
    "Away";

  return {
    home,
    away,
  };
}


// ----------------------------------------------------
// SELECTION NAME
// ----------------------------------------------------

function getSelectionName(selection, teams) {

  const value = String(
    selection?.name ??
    selection?.selection ??
    selection?.label ??
    selection?.side ??
    ""
  ).trim();

  const lower = value.toLowerCase();

  if (
    lower === "home" ||
    lower === "1" ||
    lower === "team1"
  ) {
    return teams.home;
  }

  if (
    lower === "away" ||
    lower === "2" ||
    lower === "team2"
  ) {
    return teams.away;
  }

  if (value === teams.home) {
    return teams.home;
  }

  if (value === teams.away) {
    return teams.away;
  }

  return value;
}


// ----------------------------------------------------
// VIRTUAL LAY PRICE
// ----------------------------------------------------

function makeLayPrice(backPrice) {

  const price = Number(backPrice);

  if (
    !Number.isFinite(price) ||
    price <= 1
  ) {
    return null;
  }

  /*
    Your requested NOVA PLAY virtual Lay rule:

    Back <= 5.00
      Lay = Back + 0.04

    Back > 5.00
      Lay = Back + 1.00
  */

  if (price > 5) {
    return Number(
      (price + 1).toFixed(2)
    );
  }

  return Number(
    (price + 0.04).toFixed(2)
  );
}


// ----------------------------------------------------
// NORMALIZE ONE FIXTURE
// ----------------------------------------------------

function normalizeFixture(
  fixture,
  sportKey,
  sportTitle
) {

  const teams = getTeams(fixture);

  const markets = Array.isArray(
    fixture?.markets
  )
    ? fixture.markets
    : [];

  /*
    OddsRadarWire uses canonical:
      match_winner

    We only need the Match Winner market
    for the existing NOVA PLAY Match Odds UI.
  */

  const winnerMarkets = markets.filter(
    market =>
      market &&
      (
        market.canonical === "match_winner" ||
        String(
          market.market || ""
        )
          .toLowerCase()
          .includes("winner")
      )
  );

  const market =
    winnerMarkets.find(
      m =>
        m.status === "OPEN" &&
        Number(m.tier) === 1
    ) ||
    winnerMarkets.find(
      m => m.status === "OPEN"
    ) ||
    winnerMarkets[0];

  if (!market) {
    return null;
  }

  const selections =
    Array.isArray(market.selections)
      ? market.selections
      : [];

  const outcomes = selections
    .map(selection => {

      const price =
        Number(selection?.price);

      return {
        name: getSelectionName(
          selection,
          teams
        ),

        price,

        status:
          selection?.status ||
          market?.status ||
          "OPEN",
      };
    })
    .filter(
      outcome =>
        outcome.name &&
        Number.isFinite(
          outcome.price
        ) &&
        outcome.price > 1
    );

  /*
    Match Winner should contain the two teams.
  */

  const home =
    outcomes.find(
      o => o.name === teams.home
    );

  const away =
    outcomes.find(
      o => o.name === teams.away
    );

  const selected = [
    home,
    away,
  ].filter(Boolean);

  if (!selected.length) {
    return null;
  }


  // --------------------------------------------------
  // BACK
  // --------------------------------------------------

  const backOutcomes =
    selected.map(outcome => ({
      name: outcome.name,
      price: outcome.price,
    }));


  // --------------------------------------------------
  // VIRTUAL LAY
  // --------------------------------------------------

  const layOutcomes =
    selected
      .map(outcome => {

        const lay =
          makeLayPrice(
            outcome.price
          );

        if (!lay) return null;

        return {
          name: outcome.name,
          price: lay,
        };
      })
      .filter(Boolean);


  // --------------------------------------------------
  // CONVERT TO EXISTING NOVA PLAY FORMAT
  // --------------------------------------------------

  const bookmakers = [

    {
      key: "oddsradarwire",

      title: "OddsRadarWire",

      last_update:
        new Date().toISOString(),

      markets: [

        {
          key: "h2h",

          last_update:
            new Date().toISOString(),

          outcomes:
            backOutcomes,
        },

        {
          key: "h2h_lay",

          last_update:
            new Date().toISOString(),

          outcomes:
            layOutcomes,
        },

      ],
    },

  ];


  return {

    id: String(
      fixture.id
    ),

    sport_key:
      sportKey,

    sport_title:
      sportTitle,

    commence_time:
      fixture.commence_time ||
      fixture.commenceTime ||
      fixture.start_time ||
      fixture.startTime ||
      null,

    home_team:
      teams.home,

    away_team:
      teams.away,

    bookmakers,

    source:
      "oddsradarwire",

    provider:
      fixture.provider ||
      "BETRADAR",

    phase:
      fixture.phase ||
      null,

    competition:
      fixture.competition ||
      null,

  };
}


// ----------------------------------------------------
// LOAD SPORT
// ----------------------------------------------------

async function loadSport(
  sportKey
) {

  const config =
    SPORTS[sportKey];

  if (!config) {

    const error =
      new Error(
        `Unsupported sport: ${sportKey}`
      );

    error.status = 404;

    throw error;
  }


  const cacheKey =
    `sport:${sportKey}`;


  const cached =
    getCache(cacheKey);

  if (cached) {
    return cached;
  }


  /*
    OddsRadarWire separates:

      live
      prematch

    So we fetch both.

    Because this is cached on the server,
    multiple website users do NOT each
    trigger their own provider requests.
  */

  const [
    liveData,
    prematchData,
  ] = await Promise.all([

    oddsRadarRequest(
      "/v1/fixtures",
      {
        event_type: "live",
        sport:
          config.providerSport,
        canonical:
          "match_winner",
        tier: 1,
        limit: 100,
      }
    ),

    oddsRadarRequest(
      "/v1/fixtures",
      {
        event_type: "prematch",
        sport:
          config.providerSport,
        canonical:
          "match_winner",
        tier: 1,
        limit: 100,
      }
    ),

  ]);


  const fixtures = [

    ...getFixtures(
      liveData
    ),

    ...getFixtures(
      prematchData
    ),

  ];


  const events = [];

  const seen =
    new Set();


  for (
    const fixture
    of fixtures
  ) {

    if (!fixture?.id) {
      continue;
    }

    const id =
      String(fixture.id);

    if (seen.has(id)) {
      continue;
    }

    seen.add(id);


    const normalized =
      normalizeFixture(
        fixture,
        sportKey,
        config.title
      );


    if (normalized) {
      events.push(
        normalized
      );
    }

  }


  setCache(
    cacheKey,
    events
  );


  return events;
}


// ----------------------------------------------------
// SPORTS
// ----------------------------------------------------

app.get(
  "/api/sports",
  (_req, res) => {

    const sports =
      Object.values(
        SPORTS
      ).map(
        sport => ({

          key:
            sport.key,

          group:
            sport.title,

          title:
            sport.title,

          description:
            `${sport.title} odds`,

          active:
            true,

          has_outrights:
            false,

        })
      );


    res.json(sports);
  }
);


// ----------------------------------------------------
// ODDS
// ----------------------------------------------------

app.get(
  "/api/odds/:sport",
  async (req, res) => {

    try {

      const events =
        await loadSport(
          req.params.sport
        );


      res.set(
        "x-oddsradarwire",
        "true"
      );

      res.set(
        "x-cache-ttl",
        `${CACHE_MS}ms`
      );


      res.json(events);

    } catch (error) {

      console.error(
        "OddsRadarWire error:",
        error
      );


      if (
        error.retryAfter
      ) {

        res.set(
          "Retry-After",
          error.retryAfter
        );

      }


      res.status(
        Number(error.status) ||
        502
      ).json({

        error:
          error.message,

        provider:
          "oddsradarwire",

        details:
          error.body ||
          null,

      });

    }

  }
);


// ----------------------------------------------------
// PROVIDER ACCOUNT STATUS
// ----------------------------------------------------

app.get(
  "/api/provider/me",
  async (_req, res) => {

    try {

      const data =
        await oddsRadarRequest(
          "/v1/me"
        );

      res.json(data);

    } catch (error) {

      res.status(
        Number(error.status) ||
        502
      ).json({

        error:
          error.message,

        details:
          error.body ||
          null,

      });

    }

  }
);


// ----------------------------------------------------
// PROVIDER HEALTH
// ----------------------------------------------------

app.get(
  "/api/provider/health",
  async (_req, res) => {

    try {

      const data =
        await oddsRadarRequest(
          "/v1/health"
        );

      res.json(data);

    } catch (error) {

      res.status(
        Number(error.status) ||
        502
      ).json({

        error:
          error.message,

        details:
          error.body ||
          null,

      });

    }

  }
);


// ----------------------------------------------------
// FRONTEND
// ----------------------------------------------------

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


app.get(
  "/{*splat}",
  (_req, res) => {

    res.sendFile(
      path.join(
        distPath,
        "index.html"
      )
    );

  }
);


// ----------------------------------------------------
// START
// ----------------------------------------------------

app.listen(
  PORT,
  () => {

    console.log(
      `NOVA PLAY running on port ${PORT}`
    );

    console.log(
      "Odds provider: OddsRadarWire"
    );

    console.log(
      "OddsRadarWire API key configured:",
      Boolean(API_KEY)
    );

  }
);
