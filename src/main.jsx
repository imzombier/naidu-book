import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

const SPORTS = [
  ["cricket", "🏏", "Cricket"],
  ["soccer", "⚽", "Football"],
  ["tennis", "🎾", "Tennis"],
  ["basketball", "🏀", "Basketball"]
];

const fmt = (n) => Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });

function toDate(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const raw = String(value).trim();
  if (/^\d+$/.test(raw)) return toDate(Number(raw));
  // Provider timestamps without an explicit timezone are treated as UTC.
  // This avoids the browser interpreting them as local time and shifting the match.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(raw)) {
    const d = new Date(`${raw}Z`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) return d;
  return null;
}

function eventIsLive(e) {
  if (e?.live === true || e?.in_play === true || e?.status === "LIVE") return true;
  if (e?.live === false || e?.in_play === false || e?.status === "UPCOMING") return false;
  const d = toDate(e?.commence_time ?? e?.commenceTime ?? e?.time);
  return !!d && d.getTime() <= Date.now();
}

function formatMatchTime(e) {
  const d = toDate(e?.commence_time ?? e?.commenceTime ?? e?.time);
  if (!d) return "Time unavailable";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  }).format(d);
}

function formatShortTime(e) {
  const d = toDate(e?.commence_time ?? e?.commenceTime ?? e?.time);
  if (!d) return "Time unavailable";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  }).format(d);
}

function makeLayPrice(back) {
  const o = Number(back);
  if (!Number.isFinite(o) || o <= 1) return null;
  // User rule: below 5 => +2%; 5.00 or above => +1.00.
  return o < 5 ? Number((o * 1.02).toFixed(2)) : Number((o + 1).toFixed(2));
}

function bookmakerValue(decimalOdds) {
  const o = Number(decimalOdds);
  if (!Number.isFinite(o) || o <= 1) return 0;
  // Convert decimal odds to rupee profit on a 100-coin base, then reduce 2%.
  return Number((((o - 1) * 100) * 0.98).toFixed(2));
}

function calc(side, odds, stake) {
  const s = Math.max(0, Number(stake) || 0);
  const o = Math.max(1.01, Number(odds) || 1.01);
  return side === "lay"
    ? { profit: s, liability: s * (o - 1) }
    : { profit: s * (o - 1), liability: s };
}

function App() {
  const [page, setPage] = useState("home");
  const [sport, setSport] = useState("cricket");
  const [events, setEvents] = useState([]);
  const [match, setMatch] = useState(null);
  const [selected, setSelected] = useState(null);
  const [slip, setSlip] = useState([]);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("loading");
  const [toast, setToast] = useState("");
  const [coins, setCoins] = useState(() => Number(localStorage.getItem("novaCoins") || 10000));

  useEffect(() => {
    localStorage.setItem("novaCoins", String(coins));
  }, [coins]);

  useEffect(() => {
    loadOdds();
    const id = setInterval(loadOdds, 60000);
    return () => clearInterval(id);
  }, [sport]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 2200);
    return () => clearTimeout(id);
  }, [toast]);

  async function loadOdds() {
    setStatus("loading");
    try {
      const r = await fetch(`/api/odds/${encodeURIComponent(sport)}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      const list = Array.isArray(data) ? data : [];
      list.sort((a, b) => {
        const al = eventIsLive(a), bl = eventIsLive(b);
        if (al !== bl) return al ? -1 : 1;
        const ad = toDate(a.commence_time)?.getTime() ?? Infinity;
        const bd = toDate(b.commence_time)?.getTime() ?? Infinity;
        return ad - bd;
      });
      setEvents(list);
      setStatus(list.length ? "live" : "empty");
    } catch (err) {
      console.error(err);
      setEvents([]);
      setStatus("error");
      setToast("Unable to load provider matches");
    }
  }

  function openMatch(e) {
    setMatch(e);
    setSelected(null);
    setPage("match");
  }

  function chooseBet(e, selection, odds, side, market = "match_odds") {
    setSelected({
      eventId: e.id,
      eventName: `${e.home_team} vs ${e.away_team}`,
      selection,
      odds: Number(odds),
      side,
      market,
      stake: 100,
      editingStake: false
    });
  }

  function updateSelected(patch) {
    if (patch === null) return setSelected(null);
    setSelected((s) => (s ? { ...s, ...patch } : s));
  }

  function placeBet() {
    if (!selected) return;
    const stake = Number(selected.stake) || 0;
    if (stake < 1) return setToast("Enter a valid stake");
    if (stake > coins) return setToast("Not enough virtual coins");

    setCoins((c) => c - stake);
    setSlip((items) => [
      ...items.filter((x) => !(x.eventId === selected.eventId && x.selection === selected.selection && x.market === selected.market && x.side === selected.side)),
      { ...selected }
    ]);
    setToast("Virtual bet added to Slip");
    setSelected(null);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events.filter((e) => {
      const text = `${e.home_team || ""} ${e.away_team || ""} ${e.competition?.name || ""}`.toLowerCase();
      if (q && !text.includes(q)) return false;
      if (filter === "live") return eventIsLive(e);
      if (filter === "upcoming") return !eventIsLive(e);
      return true;
    });
  }, [events, search, filter]);

  const live = filtered.filter(eventIsLive);
  const upcoming = filtered.filter((e) => !eventIsLive(e));

  return (
    <>
      <header>
        <button className="logo" onClick={() => setPage("home")}>
          <b>N</b><span className="brandText">NOVA<span>PLAY</span></span>
        </button>
        <div className="right">
          <button onClick={() => document.getElementById("eventSearch")?.focus()}>⌕</button>
          <button onClick={() => setPage("wallet")}>🪙 {fmt(coins)}</button>
        </div>
      </header>

      <main>
        {page === "home" && (
          <Home
            sport={sport} setSport={setSport} search={search} setSearch={setSearch}
            filter={filter} setFilter={setFilter} live={live} upcoming={upcoming}
            openMatch={openMatch} status={status}
          />
        )}
        {page === "sports" && (
          <Sports sport={sport} setSport={setSport} events={filtered} openMatch={openMatch} />
        )}
        {page === "match" && match && (
          <Match
            initialEvent={match}
            back={() => setPage("home")}
            selected={selected}
            chooseBet={chooseBet}
            updateSelected={updateSelected}
            placeBet={placeBet}
          />
        )}
        {page === "slip" && <Slip items={slip} setSlip={setSlip} />}
        {page === "wallet" && <Wallet coins={coins} setCoins={setCoins} openAdmin={() => setPage("admin")} />}
        {page === "admin" && <Admin coins={coins} setCoins={setCoins} back={() => setPage("wallet")} />}
        {page === "games" && <Games />}
      </main>

      <nav>
        <button onClick={() => setPage("home")}>⌂<small>Home</small></button>
        <button onClick={() => setPage("sports")}>◈<small>Sports</small></button>
        <button className="center" onClick={() => setPage("slip")}>▱<i>{slip.length}</i><small>Slip</small></button>
        <button onClick={() => setPage("games")}>◇<small>Games</small></button>
        <button onClick={() => setPage("wallet")}>♙<small>Coins</small></button>
      </nav>

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}

function Home({ sport, setSport, search, setSearch, filter, setFilter, live, upcoming, openMatch, status }) {
  return (
    <div className="page homePage">
      <section className="hero">
        <div>
          <div className="livePill"><i /> VIRTUAL SPORTS</div>
          <small>WELCOME TO NOVA PLAY</small>
          <h1>Live sports.<br /><em>Exchange markets.</em></h1>
          <p>Live and upcoming matches with virtual-coin Back/Lay markets.</p>
          <div className="heroActions">
            <button className="primary" onClick={() => document.getElementById("matches")?.scrollIntoView({ behavior: "smooth" })}>View Matches →</button>
            <button className="ghost" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>Refresh</button>
          </div>
        </div>
        <div className="orb">🪙<small>VIRTUAL<br />ONLY</small></div>
      </section>

      <div className="stats">
        <div><b>{live.length}</b><small>Live now</small></div>
        <div><b>{upcoming.length}</b><small>Upcoming</small></div>
        <div><b>4</b><small>Sports</small></div>
      </div>

      <div className="searchBox"><span>⌕</span><input id="eventSearch" placeholder="Search teams, players or leagues" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      <h2>Sports</h2>
      <Rail sport={sport} setSport={setSport} />
      <div className="providerStatus">{status === "loading" ? "Loading provider feed…" : status === "live" ? "● Provider feed connected" : status === "empty" ? "No matches available right now" : "Provider feed error"}</div>
      <div className="homeFilters">
        {[["all", "All"], ["live", "● Live"], ["upcoming", "Upcoming"]].map(([k, label]) => <button key={k} className={filter === k ? "active" : ""} onClick={() => setFilter(k)}>{label}</button>)}
      </div>

      <div id="matches">
        {(filter === "all" || filter === "live") && <section className="eventSection"><div className="sectionLine"><h2>🔴 Live Matches <small>{live.length}</small></h2></div>{live.length ? <Events events={live} openMatch={openMatch} /> : <div className="empty">No live matches right now.</div>}</section>}
        {(filter === "all" || filter === "upcoming") && <section className="eventSection"><div className="sectionLine"><h2>Upcoming Matches <small>{upcoming.length}</small></h2></div>{upcoming.length ? <Events events={upcoming} openMatch={openMatch} /> : <div className="empty">No upcoming matches right now.</div>}</section>}
      </div>
      <div className="note">🛡️ Virtual coins only · No cash value · Odds refresh automatically.</div>
    </div>
  );
}

function Rail({ sport, setSport }) {
  return <div className="rail">{SPORTS.map(([key, icon, name]) => <button key={key} className={sport === key ? "sel" : ""} onClick={() => setSport(key)}>{icon} {name}</button>)}</div>;
}

function Events({ events, openMatch }) {
  return <div className="events">{events.map((e) => <EventCard key={e.id} e={e} openMatch={openMatch} />)}</div>;
}

function getMatchOdds(e) {
  const markets = e?.bookmakers?.flatMap((b) => b.markets || []) || [];
  const h2h = markets.filter((m) => m.key === "h2h");
  const lay = markets.filter((m) => m.key === "h2h_lay");
  const names = [e.home_team, e.away_team].filter(Boolean);
  return names.map((name) => {
    const backs = h2h.flatMap((m) => (m.outcomes || []).filter((o) => o.name === name).map((o) => Number(o.price))).filter(Number.isFinite);
    if (!backs.length) return null;
    const back = Math.max(...backs);
    const providerLays = lay.flatMap((m) => (m.outcomes || []).filter((o) => o.name === name).map((o) => Number(o.price))).filter(Number.isFinite);
    const layPrice = providerLays.length ? Math.min(...providerLays) : makeLayPrice(back);
    return { name, back, lay: layPrice };
  }).filter(Boolean);
}

function EventCard({ e, openMatch }) {
  const os = getMatchOdds(e);
  const live = eventIsLive(e);
  return (
    <article className="eventCard" onClick={() => openMatch(e)}>
      <div className="meta"><span className={live ? "liveBadge" : "upBadge"}>{live ? "● LIVE" : "UPCOMING"}</span><span>{e.competition?.name || e.sport_title || "SPORT"}</span></div>
      <div className="eventTitle"><div><b>{e.home_team}</b><b>{e.away_team}</b></div><time>{formatShortTime(e)}</time></div>
      <div className="miniMarket">
        <div className="miniHead"><span>Match Odds</span><b>BACK</b><b>LAY</b></div>
        {os.map((o) => <div className="miniRow" key={o.name}><span title={o.name}>{o.name}</span><div className="backBox"><strong>{o.back.toFixed(2)}</strong></div><div className="layBox"><strong>{o.lay.toFixed(2)}</strong></div></div>)}
        {!os.length && <div className="suspended">Market unavailable</div>}
      </div>
      <footer><span>{live ? "Live market" : `Starts ${formatShortTime(e)}`}</span><span>Open match →</span></footer>
    </article>
  );
}

function Sports({ sport, setSport, events, openMatch }) {
  return <div className="page"><div className="title"><div><small>SPORTS HUB</small><h1>All matches</h1></div></div><Rail sport={sport} setSport={setSport} /><Events events={events} openMatch={openMatch} /></div>;
}

function Match({ initialEvent, back, selected, chooseBet, updateSelected, placeBet }) {
  const [current, setCurrent] = useState(initialEvent);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState("all");

  useEffect(() => setCurrent(initialEvent), [initialEvent]);

  useEffect(() => {
    if (!initialEvent?.sport) return;
    let cancelled = false;
    const refresh = async () => {
      setRefreshing(true);
      try {
        const r = await fetch(`/api/odds/${encodeURIComponent(initialEvent.sport)}`, { cache: "no-store" });
        if (!r.ok) return;
        const data = await r.json();
        const n = Array.isArray(data) ? data.find((x) => String(x.id) === String(initialEvent.id)) : null;
        if (n && !cancelled) setCurrent(n);
      } catch (err) { console.warn("Match refresh failed", err); }
      finally { if (!cancelled) setRefreshing(false); }
    };
    const id = setInterval(refresh, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, [initialEvent?.id, initialEvent?.sport]);

  if (!current) return <div className="page"><div className="empty">Select a match.</div></div>;
  const e = current;
  const os = getMatchOdds(e);
  const live = eventIsLive(e);

  return (
    <div className="page matchPage">
      <button className="back" onClick={back}>← Back</button>
      <section className="match">
        <div className="liveState">{live ? "● LIVE" : "UPCOMING"}{refreshing && <span> · updating…</span>}</div>
        <small>{e.competition?.name || e.sport_title || e.sport || "SPORT"}</small>
        <div className="matchTeams"><h1>{e.home_team}</h1><strong>VS</strong><h1>{e.away_team}</h1></div>
        <p>{formatMatchTime(e)}</p>
      </section>

      <div className="marketTabs topTabs">
        {[["all", "All"], ["match", "Match Odds"], ["book", "Bookmaker"], ["fancy", "Fancy"]].map(([k, label]) => <button key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>{label}</button>)}
      </div>

      {(tab === "all" || tab === "match") && <MatchOddsSection e={e} outcomes={os} selected={selected} chooseBet={chooseBet} updateSelected={updateSelected} placeBet={placeBet} />}
      {(tab === "all" || tab === "match") && <SuperOverSection e={e} outcomes={os} chooseBet={chooseBet} />}
      {(tab === "all" || tab === "book") && <BookmakerSection e={e} outcomes={os} selected={selected} chooseBet={chooseBet} updateSelected={updateSelected} placeBet={placeBet} />}
      {tab === "fancy" && <div className="empty">Fancy market is not available in the current provider feed.</div>}

      <div className="note">All stakes, profits and balances shown here are virtual coins only.</div>
    </div>
  );
}

function MatchOddsSection({ e, outcomes, selected, chooseBet, updateSelected, placeBet }) {
  return <section className="marketBlock"><MarketHeader title="Match Odds" />
    <div className="exchangeTable"><div className="tableHead"><span>Selection</span><b>BACK</b><b>LAY</b></div>
      {outcomes.map((o) => <React.Fragment key={o.name}>
        <div className="matchRunner"><span><strong>{o.name}</strong></span><button className="backBox" onClick={() => chooseBet(e, o.name, o.back, "back", "match_odds")}><strong>{o.back.toFixed(2)}</strong></button><button className="layBox" onClick={() => chooseBet(e, o.name, o.lay, "lay", "match_odds")}><strong>{o.lay.toFixed(2)}</strong></button></div>
        {selected?.eventId === e.id && selected?.selection === o.name && selected?.market === "match_odds" && <BetPanel selected={selected} update={updateSelected} place={placeBet} />}
      </React.Fragment>)}
      {!outcomes.length && <div className="suspended bigSuspend">SUSPENDED</div>}
    </div>
  </section>;
}

function SuperOverSection({ e, outcomes, chooseBet }) {
  return <section className="marketBlock"><MarketHeader title="Who Will Win The Match?" subtitle="Inc Super Over" />
    {outcomes.length ? <div className="superGrid">{outcomes.map((o) => <button key={o.name} onClick={() => chooseBet(e, o.name, o.back, "back", "super_over")}><span>{o.name}</span><strong>{o.back.toFixed(2)}</strong></button>)}</div> : <div className="suspended">SUSPENDED</div>}
  </section>;
}

function BookmakerSection({ e, outcomes, selected, chooseBet, updateSelected, placeBet }) {
  return <section className="marketBlock"><MarketHeader title="Bookmaker" />
    <div className="exchangeTable"><div className="tableHead"><span>Selection</span><b>BACK</b><b>LAY</b></div>
      {outcomes.map((o) => {
        const back = bookmakerValue(o.back);
        const lay = bookmakerValue(o.lay);
        return <React.Fragment key={o.name}>
          <div className="matchRunner"><span><strong>{o.name}</strong></span><button className="backBox" onClick={() => chooseBet(e, o.name, Math.max(1.01, 1 + back / 100), "back", "bookmaker")}><strong>₹{back.toFixed(2)}</strong></button><button className="layBox" onClick={() => chooseBet(e, o.name, Math.max(1.01, 1 + lay / 100), "lay", "bookmaker")}><strong>₹{lay.toFixed(2)}</strong></button></div>
          {selected?.eventId === e.id && selected?.selection === o.name && selected?.market === "bookmaker" && <BetPanel selected={selected} update={updateSelected} place={placeBet} />}
        </React.Fragment>;
      })}
      {!outcomes.length && <div className="suspended bigSuspend">SUSPENDED</div>}
    </div>
  </section>;
}

function MarketHeader({ title, subtitle }) {
  return <div className="marketHeader"><div><b>{title}</b>{subtitle && <small>{subtitle}</small>}</div><span>BACK&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;LAY</span></div>;
}

function BetPanel({ selected, update, place }) {
  const c = calc(selected.side, selected.odds, selected.stake);
  const quick = [100, 200, 500, 1000, 2000, 5000];
  return <div className="betPanel" onClick={(e) => e.stopPropagation()}>
    <div className="betTop"><span className={selected.side}>{selected.side.toUpperCase()}</span><b>{selected.selection}</b><small>@ {selected.odds.toFixed(2)}</small></div>
    <div className="pnl"><div><small>POTENTIAL PROFIT</small><b>+🪙{fmt(c.profit)}</b></div><div><small>{selected.side === "lay" ? "LIABILITY / LOSS" : "LOSS"}</small><b>-🪙{fmt(c.liability)}</b></div></div>
    <div className="acceptRow"><span>Accept any odds</span><i>●</i><strong>Virtual coins</strong></div>
    <div className="stakeEdit">
      <button onClick={() => update({ stake: Math.max(1, Number(selected.stake) - 100) })}>−</button>
      <input type="number" min="1" value={selected.stake} onChange={(e) => update({ stake: Math.max(1, Number(e.target.value) || 1) })} />
      <button onClick={() => update({ stake: Number(selected.stake) + 100 })}>+</button>
    </div>
    <div className="quickMoney">{quick.map((x) => <button key={x} onClick={() => update({ stake: x })}>🪙 {x.toLocaleString("en-IN")}</button>)}</div>
    {!selected.editingStake ? <button className="editStakeButton" onClick={() => update({ editingStake: true })}>✏️ Edit Stake</button> : <div className="customStake"><input autoFocus type="number" min="1" value={selected.stake} onChange={(e) => update({ stake: Math.max(1, Number(e.target.value) || 1) })} /><button onClick={() => update({ editingStake: false })}>Save Stake</button></div>}
    <div className="betActions"><button onClick={() => update(null)} className="cancel">Cancel</button><button onClick={place} className="primary">Place Bet</button></div>
  </div>;
}

function Slip({ items, setSlip }) {
  const total = items.reduce((a, x) => a + Number(x.stake || 0), 0);
  return <div className="page"><div className="title"><div><small>YOUR PICKS</small><h1>Bet Slip</h1></div>{items.length > 0 && <button onClick={() => setSlip([])}>Clear</button>}</div>
    {!items.length ? <div className="empty big">🧾<br /><b>Slip is empty</b><small>Tap a BACK or LAY price on a match.</small></div> : <>{items.map((x, i) => { const c = calc(x.side, x.odds, x.stake); return <div className="slip" key={`${x.eventId}-${i}`}><div><span className={x.side}>{x.side.toUpperCase()}</span><b>{x.selection}</b><small>{x.eventName} · {x.market}</small><small>Stake 🪙 {fmt(x.stake)} · Profit +🪙 {fmt(c.profit)} · Liability 🪙 {fmt(c.liability)}</small></div><button onClick={() => setSlip((a) => a.filter((_, j) => j !== i))}>×</button></div>; })}<section className="stake"><div><b>Total stake</b><strong>🪙 {fmt(total)}</strong></div><div className="note">Virtual bets are already reserved from the demo balance.</div></section></>}</div>;
}

function Wallet({ coins, setCoins, openAdmin }) {
  const [requests, setRequests] = useState(() => {
    try { return JSON.parse(localStorage.getItem("novaCoinRequests") || "[]"); } catch { return []; }
  });
  const [redeems, setRedeems] = useState(() => {
    try { return JSON.parse(localStorage.getItem("novaRedeemRequests") || "[]"); } catch { return []; }
  });
  const [selectedPackage, setSelectedPackage] = useState(500);
  const [redeemAmount, setRedeemAmount] = useState(500);
  const [message, setMessage] = useState("");

  useEffect(() => localStorage.setItem("novaCoinRequests", JSON.stringify(requests)), [requests]);
  useEffect(() => localStorage.setItem("novaRedeemRequests", JSON.stringify(redeems)), [redeems]);

  function requestCoins() {
    const item = {
      id: `CR-${Date.now()}`,
      coins: Number(selectedPackage),
      createdAt: new Date().toISOString(),
      status: "PENDING"
    };
    setRequests((x) => [item, ...x]);
    setMessage(`Coin request ${item.id} submitted for ${fmt(item.coins)} virtual coins.`);
  }

  function requestRedeem() {
    const amount = Number(redeemAmount) || 0;
    if (amount < 1) return setMessage("Enter a valid virtual-coin amount.");
    if (amount > coins) return setMessage("Not enough virtual coins.");
    const item = {
      id: `RD-${Date.now()}`,
      coins: amount,
      createdAt: new Date().toISOString(),
      status: "PENDING"
    };
    setRedeems((x) => [item, ...x]);
    setMessage(`Redeem request ${item.id} submitted for review.`);
  }

  return <div className="page">
    <div className="title"><div><small>MY COINS</small><h1>Virtual Coin Center</h1></div><button onClick={openAdmin}>Admin Demo</button></div>
    <section className="balance">
      <small>AVAILABLE VIRTUAL COINS</small>
      <h1>🪙 {fmt(coins)}</h1>
      <button className="primary" onClick={() => setCoins((c) => c + 1000)}>＋ Claim 1,000 Demo Coins</button>
    </section>

    <section className="marketBlock">
      <div className="marketHeader"><div><b>Request Virtual Coins</b><small>Demo wallet credit request</small></div></div>
      <div className="quickMoney">
        {[300, 500, 1000, 2000, 5000].map((x) => <button key={x} className={selectedPackage === x ? "active" : ""} onClick={() => setSelectedPackage(x)}>🪙 {fmt(x)}</button>)}
      </div>
      <button className="primary" onClick={requestCoins}>Submit Coin Request</button>
    </section>

    <section className="marketBlock">
      <div className="marketHeader"><div><b>Redeem Virtual Coins</b><small>Demo redemption request — no cash payout</small></div></div>
      <div className="quickMoney">
        {[500, 1000, 2000, 5000].map((x) => <button key={x} className={redeemAmount === x ? "active" : ""} onClick={() => setRedeemAmount(Math.min(x, coins))}>🪙 {fmt(x)}</button>)}
      </div>
      <input className="walletInput" type="number" min="1" value={redeemAmount} onChange={(e) => setRedeemAmount(Number(e.target.value) || 0)} placeholder="Enter virtual coins" />
      <button className="primary" onClick={requestRedeem}>Apply for Redemption</button>
    </section>

    {!!message && <div className="note">{message}</div>}
    <section className="marketBlock">
      <div className="marketHeader"><div><b>Coin Request History</b></div></div>
      {!requests.length ? <div className="empty">No coin requests yet.</div> : requests.slice(0, 8).map((r) => <div className="slip" key={r.id}><div><b>{r.id}</b><small>🪙 {fmt(r.coins)} · {new Date(r.createdAt).toLocaleString("en-IN")}</small></div><strong>{r.status}</strong></div>)}
    </section>

    <section className="marketBlock">
      <div className="marketHeader"><div><b>Redemption History</b></div></div>
      {!redeems.length ? <div className="empty">No redemption requests yet.</div> : redeems.slice(0, 8).map((r) => <div className="slip" key={r.id}><div><b>{r.id}</b><small>🪙 {fmt(r.coins)} · {new Date(r.createdAt).toLocaleString("en-IN")}</small></div><strong>{r.status}</strong></div>)}
    </section>

    <div className="note">🛡️ Virtual coins only. No deposits, UPI payments, bank transfers, or cash value are processed by this demo wallet.</div>
  </div>;
}

function Admin({ coins, setCoins, back }) {
  const [requests, setRequests] = useState(() => { try { return JSON.parse(localStorage.getItem("novaCoinRequests") || "[]"); } catch { return []; } });
  const [redeems, setRedeems] = useState(() => { try { return JSON.parse(localStorage.getItem("novaRedeemRequests") || "[]"); } catch { return []; } });
  const [message, setMessage] = useState("");

  useEffect(() => localStorage.setItem("novaCoinRequests", JSON.stringify(requests)), [requests]);
  useEffect(() => localStorage.setItem("novaRedeemRequests", JSON.stringify(redeems)), [redeems]);

  function approveCoin(id) {
    setRequests((items) => items.map((r) => {
      if (r.id !== id || r.status !== "PENDING") return r;
      setCoins((c) => c + Number(r.coins));
      setMessage(`Approved ${r.id}: 🪙 ${fmt(r.coins)} added to demo wallet.`);
      return { ...r, status: "APPROVED", approvedAt: new Date().toISOString() };
    }));
  }

  function rejectCoin(id) {
    setRequests((items) => items.map((r) => r.id === id && r.status === "PENDING" ? { ...r, status: "REJECTED", rejectedAt: new Date().toISOString() } : r));
    setMessage(`Coin request ${id} rejected.`);
  }

  function approveRedeem(id) {
    setRedeems((items) => items.map((r) => {
      if (r.id !== id || r.status !== "PENDING") return r;
      if (Number(r.coins) > coins) { setMessage(`Cannot approve ${r.id}: insufficient virtual coins.`); return r; }
      setCoins((c) => c - Number(r.coins));
      setMessage(`Approved ${r.id}: 🪙 ${fmt(r.coins)} deducted from demo wallet.`);
      return { ...r, status: "APPROVED", approvedAt: new Date().toISOString() };
    }));
  }

  function rejectRedeem(id) {
    setRedeems((items) => items.map((r) => r.id === id && r.status === "PENDING" ? { ...r, status: "REJECTED", rejectedAt: new Date().toISOString() } : r));
    setMessage(`Redemption ${id} rejected.`);
  }

  return <div className="page">
    <div className="title"><div><small>ADMIN DEMO</small><h1>Wallet Requests</h1></div><button onClick={back}>← Wallet</button></div>
    <section className="balance"><small>DEMO WALLET BALANCE</small><h1>🪙 {fmt(coins)}</h1></section>
    {message && <div className="note">{message}</div>}

    <section className="marketBlock"><div className="marketHeader"><div><b>Coin Requests</b><small>Approve to credit virtual coins</small></div></div>
      {!requests.length ? <div className="empty">No requests.</div> : requests.map((r) => <div className="slip" key={r.id}><div><b>{r.id}</b><small>🪙 {fmt(r.coins)} · {new Date(r.createdAt).toLocaleString("en-IN")}</small></div><div>{r.status === "PENDING" ? <><button onClick={() => approveCoin(r.id)}>Approve</button> <button onClick={() => rejectCoin(r.id)}>Reject</button></> : <strong>{r.status}</strong>}</div></div>)}
    </section>

    <section className="marketBlock"><div className="marketHeader"><div><b>Redemption Requests</b><small>Approve to deduct virtual coins</small></div></div>
      {!redeems.length ? <div className="empty">No requests.</div> : redeems.map((r) => <div className="slip" key={r.id}><div><b>{r.id}</b><small>🪙 {fmt(r.coins)} · {new Date(r.createdAt).toLocaleString("en-IN")}</small></div><div>{r.status === "PENDING" ? <><button onClick={() => approveRedeem(r.id)}>Approve</button> <button onClick={() => rejectRedeem(r.id)}>Reject</button></> : <strong>{r.status}</strong>}</div></div>)}
    </section>
    <div className="note">Demo/admin controls are stored in this browser's local storage and are not a production authentication system.</div>
  </div>;
}

function Games() { return <div className="page"><small>GAME LOUNGE</small><h1>Play Zone</h1><section className="gameHero"><h2>Neon Game Night</h2><p>Arcade-style demo games using virtual coins.</p>✨</section><div className="games">{["🎰 Neon Slots", "🎲 Dice Lab", "🃏 Card Room", "🎯 Spin Arena", "🕹️ Retro Rush", "🏆 Prize Room"].map((x) => <button key={x}><b>{x.split(" ")[0]}</b>{x.slice(2)}<small>Demo game</small></button>)}</div></div>; }

function ErrorBoundary({ children }) {
  return children;
}

createRoot(document.getElementById("root")).render(<ErrorBoundary><App /></ErrorBoundary>);
