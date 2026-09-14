import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

const SPORTS = [
  { id: "cricket", name: "Cricket", icon: "🏏" },
  { id: "tennis", name: "Tennis", icon: "🎾" },
  { id: "football", name: "Football", icon: "⚽" },
  { id: "basketball", name: "Basketball", icon: "🏀" }
];

const SPORT_GROUPS = {
  cricket: ["Cricket"],
  tennis: ["Tennis"],
  football: ["Soccer"],
  basketball: ["Basketball"]
};

async function api(url, options = {}) {
  const token = localStorage.getItem("naidu_token");

  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.error || `Request failed: ${response.status}`
    );
  }

  return data;
}

function App() {
  const [page, setPage] = useState("sports");
  const [sport, setSport] = useState("cricket");

  const [user, setUser] = useState(null);
  const [loadingUser, setLoadingUser] = useState(true);

  const [events, setEvents] = useState([]);
  const [loadingOdds, setLoadingOdds] = useState(false);
  const [oddsError, setOddsError] = useState("");

  const [slip, setSlip] = useState([]);
  const [message, setMessage] = useState("");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState("login");

  const [bets, setBets] = useState([]);
  const [transactions, setTransactions] = useState([]);

  // --------------------------------
  // LOAD USER
  // --------------------------------

  useEffect(() => {
    const token = localStorage.getItem("naidu_token");

    if (!token) {
      setLoadingUser(false);
      return;
    }

    api("/api/me")
      .then(setUser)
      .catch(() => {
        localStorage.removeItem("naidu_token");
      })
      .finally(() => {
        setLoadingUser(false);
      });
  }, []);

  // --------------------------------
  // LOAD SPORTS
  // --------------------------------

  async function loadSports(selectedSport = sport) {
    setLoadingOdds(true);
    setOddsError("");

    try {
      /*
       * First get all currently active sport keys.
       * This is important because cricket and tennis
       * use tournament-specific sport keys.
       */

      const sportsList = await api("/api/sports");

      const groups = SPORT_GROUPS[selectedSport] || [];

      const matchingSports = sportsList.filter((item) => {
        const group = String(item.group || "").toLowerCase();

        return (
          item.active === true &&
          groups.some(
            (g) => group === g.toLowerCase()
          )
        );
      });

      /*
       * If the API has no currently active league,
       * show an empty state instead of unrelated sports.
       */

      if (matchingSports.length === 0) {
        setEvents([]);
        setOddsError(
          `No ${selectedSport} matches are currently available.`
        );
        return;
      }

      /*
       * Request odds for each active league.
       */

      const results = await Promise.all(
        matchingSports.map(async (item) => {
          try {
            const data = await api(
              `/api/odds/${encodeURIComponent(item.key)}`
            );

            return Array.isArray(data) ? data : [];
          } catch {
            return [];
          }
        })
      );

      /*
       * Combine all leagues.
       */

      const combined = results.flat();

      /*
       * Remove duplicate events.
       */

      const unique = Array.from(
        new Map(
          combined.map((event) => [
            event.id,
            event
          ])
        ).values()
      );

      /*
       * Sort by match time.
       */

      unique.sort(
        (a, b) =>
          new Date(a.commence_time) -
          new Date(b.commence_time)
      );

      setEvents(unique);

    } catch (error) {
      setEvents([]);
      setOddsError(error.message);
    } finally {
      setLoadingOdds(false);
    }
  }

  useEffect(() => {
    if (page === "sports") {
      loadSports(sport);
    }
  }, [sport, page]);

  // --------------------------------
  // LOGIN / REGISTER
  // --------------------------------

  async function submitAuth(e) {
    e.preventDefault();

    try {
      const endpoint =
        authMode === "login"
          ? "/api/login"
          : "/api/register";

      const data = await api(endpoint, {
        method: "POST",
        body: JSON.stringify({
          email,
          password
        })
      });

      localStorage.setItem(
        "naidu_token",
        data.token
      );

      setUser(data.user);
      setEmail("");
      setPassword("");
      setMessage(
        authMode === "login"
          ? "Login successful"
          : "Account created"
      );

    } catch (error) {
      setMessage(error.message);
    }
  }

  // --------------------------------
  // LOGOUT
  // --------------------------------

  function logout() {
    localStorage.removeItem("naidu_token");
    setUser(null);
    setSlip([]);
    setPage("sports");
  }

  // --------------------------------
  // ADD TO SLIP
  // --------------------------------

  function addToSlip(event, outcome, price) {
    const pick = {
      eventId: event.id,
      eventName:
        `${event.home_team} vs ${event.away_team}`,
      team: outcome.name,
      odds: price,
      sport: event.sport_title || sport
    };

    setSlip((old) => {
      const exists = old.find(
        (x) => x.eventId === event.id
      );

      if (exists) {
        return old.map((x) =>
          x.eventId === event.id
            ? pick
            : x
        );
      }

      return [...old, pick];
    });

    setMessage("Added to bet slip");
  }

  // --------------------------------
  // PLACE DEMO BET
  // --------------------------------

  async function placeBet(stake) {
    if (!user) {
      setPage("login");
      return;
    }

    if (!slip.length) {
      setMessage("Add a selection first");
      return;
    }

    const amount = Number(stake);

    if (!Number.isInteger(amount) || amount <= 0) {
      setMessage("Enter a valid virtual coin amount");
      return;
    }

    try {
      const data = await api("/api/bets", {
        method: "POST",
        body: JSON.stringify({
          stake: amount,
          picks: slip
        })
      });

      setUser(data.user);
      setSlip([]);
      setMessage(
        "Demo bet placed using virtual coins"
      );

    } catch (error) {
      setMessage(error.message);
    }
  }

  // --------------------------------
  // WALLET TOP UP
  // --------------------------------

  async function demoTopup() {
    if (!user) {
      setPage("login");
      return;
    }

    try {
      const data = await api(
        "/api/demo-topup",
        {
          method: "POST"
        }
      );

      setUser(data);
      setMessage(
        "+1,000 virtual coins added"
      );

    } catch (error) {
      setMessage(error.message);
    }
  }

  // --------------------------------
  // LOAD HISTORY
  // --------------------------------

  async function loadHistory() {
    if (!user) return;

    try {
      const [betData, transactionData] =
        await Promise.all([
          api("/api/bets"),
          api("/api/transactions")
        ]);

      setBets(betData);
      setTransactions(transactionData);

    } catch {
      // Ignore history loading errors
    }
  }

  useEffect(() => {
    if (
      user &&
      (page === "bets" ||
        page === "wallet" ||
        page === "profile")
    ) {
      loadHistory();
    }
  }, [page, user]);

  // --------------------------------
  // FORMAT DATE
  // --------------------------------

  function formatDate(value) {
    try {
      return new Date(value).toLocaleString(
        "en-IN",
        {
          dateStyle: "medium",
          timeStyle: "short"
        }
      );
    } catch {
      return value;
    }
  }

  // --------------------------------
  // GET ODDS
  // --------------------------------

  function getOutcomes(event) {
    const bookmaker =
      event.bookmakers?.[0];

    const market =
      bookmaker?.markets?.find(
        (m) => m.key === "h2h"
      );

    return market?.outcomes || [];
  }

  // --------------------------------
  // LIVE CHECK
  // --------------------------------

  function isLive(event) {
    const start =
      new Date(event.commence_time);

    return start <= new Date();
  }

  // --------------------------------
  // AUTH PAGE
  // --------------------------------

  if (page === "login") {
    return (
      <div className="app">
        <header className="topbar">
          <div className="brand">
            NAIDU <span>BOOK</span>
          </div>
        </header>

        <main className="authPage">
          <div className="authCard">

            <h1>
              {authMode === "login"
                ? "Welcome Back"
                : "Create Account"}
            </h1>

            <p className="muted">
              Virtual-coins demo platform
            </p>

            <form onSubmit={submitAuth}>

              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) =>
                  setEmail(e.target.value)
                }
                required
              />

              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) =>
                  setPassword(e.target.value)
                }
                minLength={6}
                required
              />

              <button className="primaryBtn">
                {authMode === "login"
                  ? "Login"
                  : "Create Account"}
              </button>

            </form>

            <button
              className="linkBtn"
              onClick={() =>
                setAuthMode(
                  authMode === "login"
                    ? "register"
                    : "login"
                )
              }
            >
              {authMode === "login"
                ? "Create a new account"
                : "Already have an account? Login"}
            </button>

            <button
              className="secondaryBtn"
              onClick={() =>
                setPage("sports")
              }
            >
              ← Back
            </button>

          </div>
        </main>
      </div>
    );
  }

  // --------------------------------
  // MAIN APP
  // --------------------------------

  return (
    <div className="app">

      {/* HEADER */}

      <header className="topbar">

        <div className="brand">
          NAIDU <span>BOOK</span>
        </div>

        <div
          className="coinBadge"
          onClick={() =>
            setPage("wallet")
          }
        >
          🪙 {user?.coins ?? 0}
        </div>

      </header>

      {/* SPORTS TABS */}

      {page === "sports" && (
        <div className="sportTabs">

          {SPORTS.map((item) => (
            <button
              key={item.id}
              className={
                sport === item.id
                  ? "sportTab active"
                  : "sportTab"
              }
              onClick={() =>
                setSport(item.id)
              }
            >
              {item.icon} {item.name}
            </button>
          ))}

        </div>
      )}

      {/* CONTENT */}

      <main className="content">

        {/* SPORTS */}

        {page === "sports" && (
          <>
            <div className="pageHeader">

              <div>
                <h1>
                  {SPORTS.find(
                    (x) => x.id === sport
                  )?.icon}{" "}
                  {SPORTS.find(
                    (x) => x.id === sport
                  )?.name}
                </h1>

                <p>
                  Live / Upcoming
                </p>
              </div>

              <button
                className="refreshBtn"
                onClick={() =>
                  loadSports(sport)
                }
              >
                ↻ Refresh
              </button>

            </div>

            {loadingOdds && (
              <div className="loading">
                Loading {sport} matches...
              </div>
            )}

            {!loadingOdds &&
              oddsError && (
                <div className="emptyCard">
                  <div className="emptyIcon">
                    🏏
                  </div>

                  <h2>
                    No matches available
                  </h2>

                  <p>
                    {oddsError}
                  </p>

                  <button
                    className="primaryBtn"
                    onClick={() =>
                      loadSports(sport)
                    }
                  >
                    Try Again
                  </button>
                </div>
              )}

            {!loadingOdds &&
              !oddsError &&
              events.length === 0 && (
                <div className="emptyCard">

                  <div className="emptyIcon">
                    {SPORTS.find(
                      (x) => x.id === sport
                    )?.icon}
                  </div>

                  <h2>
                    No {sport} matches
                  </h2>

                  <p>
                    There are currently no
                    available matches for
                    this sport.
                  </p>

                </div>
              )}

            <div className="events">

              {events.map((event) => {

                const outcomes =
                  getOutcomes(event);

                return (
                  <div
                    className="eventCard"
                    key={event.id}
                  >

                    <div className="eventTop">

                      <div>
                        <strong>
                          {event.sport_title ||
                            sport}
                        </strong>

                        {isLive(event) && (
                          <span className="liveBadge">
                            ● LIVE
                          </span>
                        )}
                      </div>

                      <span className="eventTime">
                        {formatDate(
                          event.commence_time
                        )}
                      </span>

                    </div>

                    <div className="teams">

                      <div>
                        {event.home_team}
                      </div>

                      <span>
                        VS
                      </span>

                      <div>
                        {event.away_team}
                      </div>

                    </div>

                    {outcomes.length > 0 ? (
                      <div className="oddsGrid">

                        {outcomes.map(
                          (outcome) => (
                            <button
                              key={
                                outcome.name
                              }
                              className="oddBtn"
                              onClick={() =>
                                addToSlip(
                                  event,
                                  outcome,
                                  outcome.price
                                )
                              }
                            >

                              <span>
                                {outcome.name}
                              </span>

                              <b>
                                {Number(
                                  outcome.price
                                ).toFixed(2)}
                              </b>

                            </button>
                          )
                        )}

                      </div>
                    ) : (
                      <div className="noOdds">
                        Odds currently unavailable
                      </div>
                    )}

                  </div>
                );
              })}

            </div>
          </>
        )}

        {/* BET SLIP */}

        {page === "slip" && (
          <div>

            <div className="pageHeader">
              <h1>Bet Slip</h1>
            </div>

            {slip.length === 0 ? (
              <div className="emptyCard">
                <div className="emptyIcon">
                  🎟️
                </div>

                <h2>
                  Your slip is empty
                </h2>

                <p>
                  Select an odd from Sports
                  to add it here.
                </p>
              </div>
            ) : (
              <>
                {slip.map((pick) => (
                  <div
                    className="slipItem"
                    key={pick.eventId}
                  >

                    <strong>
                      {pick.eventName}
                    </strong>

                    <div>
                      {pick.team}
                      <b>
                        {Number(
                          pick.odds
                        ).toFixed(2)}
                      </b>
                    </div>

                  </div>
                ))}

                <div className="betPanel">

                  <p>
                    Virtual coins only
                  </p>

                  <button
                    className="primaryBtn"
                    onClick={() =>
                      placeBet(100)
                    }
                  >
                    Place Demo Bet — 100 🪙
                  </button>

                  <button
                    className="secondaryBtn"
                    onClick={() =>
                      placeBet(500)
                    }
                  >
                    Place Demo Bet — 500 🪙
                  </button>

                </div>
              </>
            )}

          </div>
        )}

        {/* WALLET */}

        {page === "wallet" && (
          <div>

            <div className="pageHeader">
              <h1>Wallet</h1>
            </div>

            <div className="walletCard">

              <span>
                Virtual Coin Balance
              </span>

              <strong>
                🪙 {user?.coins ?? 0}
              </strong>

              <button
                className="primaryBtn"
                onClick={demoTopup}
              >
                +1,000 Demo Coins
              </button>

            </div>

            <h2>
              Transactions
            </h2>

            {transactions.map(
              (tx) => (
                <div
                  className="historyItem"
                  key={tx.id}
                >
                  <span>
                    {tx.note}
                  </span>

                  <b>
                    {tx.amount > 0
                      ? "+"
                      : ""}
                    {tx.amount} 🪙
                  </b>
                </div>
              )
            )}

          </div>
        )}

        {/* BET HISTORY */}

        {page === "bets" && (
          <div>

            <div className="pageHeader">
              <h1>My Bets</h1>
            </div>

            {!user ? (
              <div className="emptyCard">
                <h2>
                  Login required
          
