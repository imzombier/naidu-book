import React,{Component,useEffect,useMemo,useState}from"react";
import{createRoot}from"react-dom/client";
import"./style.css";

const SPORTS=[["cricket","🏏","Cricket"],["soccer","⚽","Football"],["tennis","🎾","Tennis"],["basketball","🏀","Basketball"]];
const fmt=n=>Number(n||0).toLocaleString("en-IN");
const isLive=e=>!e?.completed&&new Date(e?.commence_time||0).getTime()<=Date.now();
const makeLayPrice=back=>{const o=Number(back)||0;return o>5?Number((o+1).toFixed(2)):Number((o+0.04).toFixed(2));};
const calc=(side,odds,stake)=>{const s=Math.max(0,Number(stake)||0),o=Math.max(1.01,Number(odds)||1.01);return side==="lay"?{win:s,loss:s*Math.max(0,o-1)}:{win:s*Math.max(0,o-1),loss:s};};
const safeToken=()=>{try{return window.localStorage.getItem("nova")||""}catch{return""}};
class ErrorBoundary extends Component{constructor(p){super(p);this.state={error:null}}static getDerivedStateFromError(error){return{error}}componentDidCatch(error,info){console.error("NOVA PLAY render error",error,info)}render(){if(this.state.error)return <div className="page"><section className="empty big"><b>NOVA PLAY could not render this screen.</b><small>Please refresh the page. If this continues, send this error to support.</small><code style={{display:"block",marginTop:12,whiteSpace:"pre-wrap",wordBreak:"break-word"}}>{String(this.state.error?.message||this.state.error)}</code><button className="primary" onClick={()=>location.reload()}>Refresh</button></section></div>;return this.props.children}}

function App(){
 const[page,setPage]=useState("home"),[sport,setSport]=useState("cricket"),[events,setEvents]=useState([]),[match,setMatch]=useState(null),[slip,setSlip]=useState([]),[favorites,setFavorites]=useState([]),[token,setToken]=useState(safeToken()),[user,setUser]=useState(null),[auth,setAuth]=useState(false),[search,setSearch]=useState(""),[toast,setToast]=useState("");
 const[homeFilter,setHomeFilter]=useState("all"),[providerStatus,setProviderStatus]=useState("loading");
 const[selected,setSelected]=useState(null);
 useEffect(()=>{if(token)fetch("/api/me",{headers:{Authorization:"Bearer "+token}}).then(r=>r.ok?r.json():null).then(x=>x&&setUser(x.user)).catch(()=>{})},[token]);
 useEffect(()=>{load();const id=setInterval(load,30000);return()=>clearInterval(id)},[sport]);
 useEffect(()=>{if(!toast)return;const id=setTimeout(()=>setToast(""),2200);return()=>clearTimeout(id)},[toast]);
 async function load(){
  setProviderStatus("loading");
  let out=[];
  try{
   const sr=await fetch("/api/sports",{cache:"no-store"});
   const ss=sr.ok?await sr.json():[];
   const wanted=sport;
   const keys=Array.isArray(ss)?ss.filter(x=>x?.active&&((x.group||"").toLowerCase()===wanted||(x.key||"").toLowerCase().startsWith(wanted+"_"))).map(x=>x.key).filter(Boolean).slice(0,6):[];
   for(const key of keys){
    const r=await fetch("/api/odds/"+encodeURIComponent(key)+"?regions=eu&markets=h2h&oddsFormat=decimal",{cache:"no-store"});
    if(!r.ok) continue;
    const d=await r.json();
    if(Array.isArray(d)) out.push(...d.map(x=>({...x,sport_key:key,source:"odds-api"})));
   }
   out=[...new Map(out.map(x=>[x.id,x])).values()].sort((a,b)=>new Date(a.commence_time)-new Date(b.commence_time));
   setEvents(out);
   setProviderStatus(out.length?"live":"empty");
   if(!out.length)setToast("The Odds API returned no live or upcoming matches for this sport");
  }catch(err){
   console.error("Odds API load failed",err);
   setEvents([]);
   setProviderStatus("error");
   setToast("Unable to load live odds from the provider");
  }
 }
 function openMatch(e){setMatch(e);setSelected(null);setPage("match");}
 function chooseBet(e,selection,odds,side,market="h2h"){setSelected({eventId:e.id,eventName:`${e.home_team} vs ${e.away_team}`,selection,odds:Number(odds),side,market,stake:100});}
 function updateSelected(patch){if(patch===null){setSelected(null);return;}setSelected(s=>s?{...s,...patch}:s);}
 function addToSlip(x){
  if(!token){setAuth(true);return;}
  setSlip(a=>[...a.filter(z=>!(z.eventId===x.eventId&&z.selection===x.selection&&z.side===x.side)),x]);
  setToast(`${x.side==="lay"?"Lay":"Back"} selection added to virtual slip`);
  setSelected(null);
 }
 function placeSelected(){if(!selected)return;addToSlip(selected);}
 function coins(){if(!token){setAuth(true);return;}fetch("/api/demo-coins",{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({amount:1000})}).then(r=>r.json()).then(d=>{if(d.user){setUser(d.user);setToast("+1,000 virtual coins")}}).catch(()=>{});}
 return <>
  <header><button className="logo"onClick={()=>setPage("home")}><b>N</b><span className="brandText">NOVA<span>PLAY</span></span></button><div className="right"><button className="searchMini"onClick={()=>document.getElementById("eventSearch")?.focus()}>⌕</button><button onClick={()=>user?setPage("wallet"):setAuth(true)}>🪙 {fmt(user?.coins||0)}</button><button onClick={()=>user?setPage("profile"):setAuth(true)}>◉</button></div></header>
  <main>
   {page==="home"&&<Home {...{setPage,sport,setSport,events,open:openMatch,search,setSearch,favorites,setFavorites,filter:homeFilter,setFilter:setHomeFilter,chooseBet}}/>}
   {page==="sports"&&<Sports {...{sport,setSport,events,open:openMatch,search,setSearch,favorites,setFavorites,chooseBet}}/>}
   {page==="match"&&<Match e={match}back={()=>setPage("home")}chooseBet={chooseBet}selected={selected}updateSelected={updateSelected}placeSelected={placeSelected}/>} 
   {page==="slip"&&<Slip items={slip}setSlip={setSlip}/>} 
   {page==="wallet"&&<Wallet user={user}coins={coins}/>} 
   {page==="profile"&&<Profile user={user}setPage={setPage}logout={()=>{localStorage.removeItem("nova");setToken("");setUser(null);setPage("home")}}/>}
   {page==="history"&&<History token={token}/>} {page==="games"&&<Games/>}
  </main>
  <nav><button onClick={()=>setPage("home")}>⌂<small>Home</small></button><button onClick={()=>setPage("sports")}>◈<small>Sports</small></button><button className="center"onClick={()=>setPage("slip")}>▱<i>{slip.length}</i><small>Slip</small></button><button onClick={()=>setPage("games")}>◇<small>Games</small></button><button onClick={()=>user?setPage("profile"):setAuth(true)}>♙<small>Account</small></button></nav>
  {auth&&<Auth close={()=>setAuth(false)}done={(t,u)=>{localStorage.setItem("nova",t);setToken(t);setUser(u);setAuth(false)}}/>}{toast&&<div className="toast">{toast}</div>}
 </>;
}

function Home({setPage,sport,setSport,events,open,search,setSearch,favorites,setFavorites,filter,setFilter,chooseBet}){
 const filtered=useMemo(()=>events.filter(e=>{const q=`${e.home_team} ${e.away_team} ${e.sport_title}`.toLowerCase();if(!q.includes(search.toLowerCase()))return false;return filter==="all"||(filter==="live"&&isLive(e))||(filter==="upcoming"&&!isLive(e));}),[events,search,filter]);
 const live=filtered.filter(isLive),upcoming=filtered.filter(e=>!isLive(e));
 return <div className="page homePage">
  <section className="hero"><div><div className="livePill"><i/> LIVE FEED CONNECTED</div><small>WELCOME TO NOVA PLAY</small><h1>Live sports.<br/><em>Exchange markets.</em></h1><p>Follow live and upcoming matches with Back/Lay virtual-coin markets.</p><div className="heroActions"><button className="primary"onClick={()=>setPage("sports")}>Explore Sports →</button><button className="ghost"onClick={()=>setPage("games")}>Game Lounge</button></div></div><div className="orb">🪙<small>VIRTUAL<br/>ONLY</small></div></section>
  <div className="stats"><div><b>{live.length}</b><small>Live now</small></div><div><b>{upcoming.length}</b><small>Upcoming</small></div><div><b>4</b><small>Sports</small></div></div>
  <div className="searchBox"><span>⌕</span><input id="eventSearch"placeholder="Search teams, players or leagues"value={search}onChange={e=>setSearch(e.target.value)}/></div>
  <h2>Popular sports</h2><Rail sport={sport}setSport={setSport}/>
  <div className="providerStatus">{providerStatus==="loading"?"Loading live odds…":providerStatus==="live"?"● Live provider feed":"Provider feed: "+providerStatus}</div><div className="homeFilters"><button className={filter==="all"?"active":""}onClick={()=>setFilter("all")}>All</button><button className={filter==="live"?"active":""}onClick={()=>setFilter("live")}>● Live</button><button className={filter==="upcoming"?"active":""}onClick={()=>setFilter("upcoming")}>Upcoming</button></div>
  {(filter==="all"||filter==="live")&&<section className="eventSection"><div className="sectionLine"><h2>🔴 Live Matches <small>{live.length}</small></h2><button onClick={()=>setFilter("live")}>View live →</button></div>{live.length?<Events events={live}open={open}favorites={favorites}setFavorites={setFavorites}chooseBet={chooseBet}/>:<div className="empty">No live matches right now.</div>}</section>}
  {(filter==="all"||filter==="upcoming")&&<section className="eventSection"><div className="sectionLine"><h2>Upcoming Matches <small>{upcoming.length}</small></h2><button onClick={()=>setFilter("upcoming")}>View upcoming →</button></div>{upcoming.length?<Events events={upcoming}open={open}favorites={favorites}setFavorites={setFavorites}chooseBet={chooseBet}/>:<div className="empty">No upcoming matches right now.</div>}</section>}
  <div className="note">🛡️ Virtual coins only · No cash value · Back/Lay odds refresh automatically.</div>
 </div>;
}
function Rail({sport,setSport}){return <div className="rail">{SPORTS.map(x=><button className={sport===x[0]?"sel":""}onClick={()=>setSport(x[0])}key={x[0]}>{x[1]} {x[2]}</button>)}</div>}

function Events({events,open,favorites,setFavorites,chooseBet}){return <div className="events">{events.map(e=><EventCard key={e.id}e={e}open={open}favorites={favorites}setFavorites={setFavorites}chooseBet={chooseBet}/>)}</div>}
function EventCard({e,open,favorites,setFavorites,chooseBet}){
 const h2hMarkets=e.bookmakers?.flatMap(b=>(b.markets||[]).filter(m=>m.key==="h2h"))||[];
 const layMarkets=e.bookmakers?.flatMap(b=>(b.markets||[]).filter(m=>m.key==="h2h_lay"))||[];
 const names=[e.home_team,e.away_team];
 const os=names.map(name=>{const prices=h2hMarkets.flatMap(m=>(m.outcomes||[]).filter(o=>o.name===name).map(o=>Number(o.price))).filter(Number.isFinite);return prices.length?{name,price:Math.max(...prices)}:null}).filter(Boolean);
 const live=isLive(e);const fav=favorites.includes(e.id);
 return <article className="eventCard"onClick={()=>open(e)}>
  <div className="meta"><span className={live?"liveBadge":"upBadge"}>{live?"● LIVE":"UPCOMING"} · {e.sport_title||"SPORT"}</span><button className={fav?"star on":"star"}onClick={v=>{v.stopPropagation();setFavorites(a=>fav?a.filter(x=>x!==e.id):[...a,e.id])}}>{fav?"★":"☆"}</button></div>
  <div className="eventTitle"><div><b>{e.home_team}</b><b>{e.away_team}</b></div><time>{new Date(e.commence_time).toLocaleString("en-IN",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})}</time></div>
  <div className="miniMarket"><div className="miniHead"><span>Match Odds</span><b>BACK</b><b>LAY</b></div>{os.slice(0,3).map(o=>{const realLay=layMarkets.flatMap(m=>(m.outcomes||[]).filter(x=>x.name===o.name).map(x=>Number(x.price))).filter(Number.isFinite);const lp=realLay.length?Math.min(...realLay):makeLayPrice(o.price);return <div className="miniRow"key={o.name}onClick={v=>v.stopPropagation()}><span title={o.name}>{o.name}</span><button className="backBox"onClick={v=>{v.stopPropagation();chooseBet(e,o.name,o.price,"back","h2h")}}><strong>{(+o.price).toFixed(2)}</strong><small>🪙 {fmt(1000)}</small></button><button className="layBox"onClick={v=>{v.stopPropagation();chooseBet(e,o.name,lp,"lay","h2h_lay")}}><strong>{lp.toFixed(2)}</strong><small>🪙 {fmt(1000)}</small></button></div>;})}{!os.length&&<div className="suspended">Odds unavailable · Open match</div>}</div>
  <footer><span>{live?"Live market":"Starts "+new Date(e.commence_time).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}</span><span>Tap match →</span></footer>
 </article>;
}

function Sports(p){return <div className="page"><div className="title"><div><small>SPORTS HUB</small><h1>All matches</h1></div><b>● LIVE</b></div><div className="searchBox"><span>⌕</span><input id="eventSearch"placeholder="Search teams, players or leagues"value={p.search}onChange={e=>p.setSearch(e.target.value)}/></div><Rail sport={p.sport}setSport={p.setSport}/><Events events={p.events.filter(e=>`${e.home_team} ${e.away_team} ${e.sport_title}`.toLowerCase().includes(p.search.toLowerCase()))}open={p.open}favorites={p.favorites}setFavorites={p.setFavorites}chooseBet={p.chooseBet}/></div>}

function Match({e:initialEvent,back,chooseBet,selected,updateSelected,placeSelected}){
 const[current,setCurrent]=useState(initialEvent);const[refreshing,setRefreshing]=useState(false);const[tab,setTab]=useState("all");
 useEffect(()=>setCurrent(initialEvent),[initialEvent]);
 useEffect(()=>{if(!initialEvent?.sport_key)return;const id=setInterval(async()=>{setRefreshing(true);try{const r=await fetch("/api/odds/"+encodeURIComponent(initialEvent.sport_key)+"?regions=eu&markets=h2h,spreads,totals");if(r.ok){const a=await r.json();const n=a.find(x=>x.id===initialEvent.id);if(n)setCurrent({...n,sport_key:initialEvent.sport_key})}}finally{setRefreshing(false)}},20000);return()=>clearInterval(id)},[initialEvent?.id,initialEvent?.sport_key]);
 if(!current)return <div className="page"><div className="empty">Select a match to view markets.</div></div>;
 const e=current;
 const markets=e.bookmakers?.flatMap(b=>b.markets||[])||[];
 const h2hMarkets=markets.filter(x=>x.key==="h2h");
 const layMarkets=markets.filter(x=>x.key==="h2h_lay");
 const names=[e.home_team,e.away_team];
 const os=names.map(name=>{const prices=h2hMarkets.flatMap(m=>(m.outcomes||[]).filter(o=>o.name===name).map(o=>Number(o.price))).filter(Number.isFinite);return prices.length?{name,price:Math.max(...prices)}:null}).filter(Boolean);
 const live=isLive(e);
 return <div className="page matchPage"><button className="back"onClick={back}>← Back to matches</button>
  <section className="match"><div className="liveState">{live?"● LIVE":"UPCOMING"}{refreshing&&<span> · updating odds…</span>}</div><small>{e.sport_title||"SPORT"}</small><div className="matchTeams"><h1>{e.home_team}</h1><strong>VS</strong><h1>{e.away_team}</h1></div><p>{new Date(e.commence_time).toLocaleString("en-IN",{weekday:"short",day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"})}</p></section>
  <section className="marketBlock"><MarketHeader title="Match Odds"/><div className="exchangeTable"><div className="tableHead"><span>Selection</span><b>BACK</b><b>LAY</b></div>{os.map(o=>{const realLay=layMarkets.flatMap(m=>(m.outcomes||[]).filter(x=>x.name===o.name).map(x=>Number(x.price))).filter(Number.isFinite);const lp=realLay.length?Math.min(...realLay):makeLayPrice(o.price);return <React.Fragment key={o.name}><div className="matchRunner"><span><strong>{o.name}</strong><small>🪙 Available</small></span><button className="backBox"onClick={()=>chooseBet(e,o.name,o.price,"back","h2h")}><strong>{(+o.price).toFixed(2)}</strong><small>🪙 1,000</small></button><button className="layBox"onClick={()=>chooseBet(e,o.name,lp,"lay","h2h_lay")}><strong>{(+lp).toFixed(2)}</strong><small>🪙 1,000</small></button></div>{selected&&selected.eventId===e.id&&selected.selection===o.name&&<BetPanel selected={selected}update={updateSelected}place={placeSelected}/>}</React.Fragment>})}{!os.length&&<div className="suspended bigSuspend">SUSPENDED · Odds not available</div>}</div><div className="limits">Min: 100 coins · Max: 10,000 coins</div></section>
  <section className="marketBlock superOver"><MarketHeader title="Who Will Win The Match?" subtitle="Inc Super Over"/>{os.length?<div className="superGrid">{os.slice(0,2).map(o=><button key={o.name}onClick={()=>chooseBet(e,o.name,+o.price,"back","super_over")}><span>{o.name}</span><strong>{(+o.price).toFixed(2)}</strong><small>🪙 1,000 available</small></button>)}</div>:<div className="suspended">SUSPENDED</div>}<div className="limits">Min: 100 coins · Max: 10,000 coins</div></section>
  <section className="marketBlock bookmaker"><MarketHeader title="Bookmaker"/>{os.length?<div className="exchangeTable"><div className="tableHead"><span>Selection</span><b>BACK</b><b>LAY</b></div>{os.slice(0,2).map(o=>{const bp=Math.max(1.01,Number(o.price)-0.01);const lp=Number(o.price)+0.01;return <div className="matchRunner"key={o.name}><span><strong>{o.name}</strong><small>Virtual bookmaker</small></span><button className="backBox"onClick={()=>chooseBet(e,o.name,bp,"back","bookmaker")}><strong>{bp.toFixed(2)}</strong><small>🪙 1,000</small></button><button className="layBox"onClick={()=>chooseBet(e,o.name,lp,"lay","bookmaker")}><strong>{lp.toFixed(2)}</strong><small>🪙 1,000</small></button></div>;})}</div>:<div className="suspended bigSuspend">SUSPENDED</div>}<div className="limits">Min: 100 coins · Max: 10,000 coins</div></section>
  <div className="marketTabs"><button className={tab==="all"?"active":""}onClick={()=>setTab("all")}>All</button><button className={tab==="winner"?"active":""}onClick={()=>setTab("winner")}>Winner</button><button className={tab==="handicap"?"active":""}onClick={()=>setTab("handicap")}>Handicap</button><button className={tab==="totals"?"active":""}onClick={()=>setTab("totals")}>Totals</button></div>
  {tab!=="all"&&<AdditionalMarkets markets={markets}tab={tab}e={e}chooseBet={chooseBet}/>}<div className="note">Live/upcoming status and odds depend on the provider feed. All selections, stakes and P&L in this demo use virtual coins only.</div>
 </div>;
}
function MarketHeader({title,subtitle}){return <div className="marketHeader"><div><b>{title}</b>{subtitle&&<small>{subtitle}</small>}</div><span>BACK&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;LAY</span></div>}
function BetPanel({selected,update,place}){const c=calc(selected.side,selected.odds,selected.stake);const quick=[100,200,500,1000,2000,5000,10000];return <div className="betPanel"onClick={e=>e.stopPropagation()}><div className="betTop"><span className={selected.side}>{selected.side.toUpperCase()}</span><b>{selected.selection}</b><small>@ {selected.odds.toFixed(2)}</small></div><div className="pnl"><div><small>PROFIT</small><b>+🪙{fmt(c.win)}</b></div><div><small>{selected.side==="lay"?"LIABILITY / LOSS":"LOSS"}</small><b>-🪙{fmt(c.loss)}</b></div></div><div className="acceptRow"><span>Accept any odds</span><i>●</i><strong>Avail Bal : virtual</strong></div><div className="stakeEdit"><button onClick={()=>update({stake:Math.max(1,selected.stake-100)})}>−</button><input type="number"min="1"value={selected.stake}onChange={e=>update({stake:Math.max(1,Number(e.target.value)||1)})}/><button onClick={()=>update({stake:selected.stake+100})}>+</button><span>@</span><input type="number"step="0.01"min="1.01"value={selected.odds}onChange={e=>update({odds:Math.max(1.01,Number(e.target.value)||1.01)})}/></div><div className="quickMoney">{quick.map(x=><button key={x}onClick={()=>update({stake:x})}>{x>=1000?x/1000+"K":x}</button>)}</div><div className="betActions"><button onClick={()=>update(null)} className="cancel">Cancel</button><button onClick={place}className="primary">Place Bet</button></div></div>}
function AdditionalMarkets({markets,tab,e,chooseBet}){const key=tab==="handicap"?"spreads":tab==="totals"?"totals":"h2h";const m=markets.find(x=>x.key===key);if(!m)return <div className="empty">Market not available.</div>;return <section className="market"><header><b>{tab}</b><small>VIRTUAL</small></header><div>{(m.outcomes||[]).map(o=><button key={o.name}onClick={()=>chooseBet(e,o.name,o.price,"back",m.key)}><span>{o.name}</span><b>{(+o.price).toFixed(2)}</b></button>)}</div></section>}

function Slip({items,setSlip}){const total=items.reduce((a,x)=>a+(+x.stake||0),0);return <div className="page"><div className="title"><div><small>YOUR PICKS</small><h1>Virtual exchange slip</h1></div>{items.length>0&&<button onClick={()=>setSlip([])}>Clear</button>}</div>{!items.length?<div className="empty big">🧾<br/><b>Slip is empty</b><small>Tap a BACK or LAY price on a match.</small></div>:<>{items.map((x,i)=>{const c=calc(x.side,x.odds,x.stake);return <div className="slip"key={i}><div><span className={x.side}>{x.side.toUpperCase()}</span><b>{x.selection}</b><small>{x.eventName} · {x.market} · {x.odds.toFixed(2)}</small><small>Stake 🪙 {fmt(x.stake)} · Win +🪙 {fmt(c.win)} · Loss -🪙 {fmt(c.loss)}</small></div><button onClick={()=>setSlip(a=>a.filter((_,j)=>j!==i))}>×</button></div>})}<section className="stake"><div><b>Total stake</b><strong>🪙 {fmt(total)}</strong></div><button className="primary"onClick={()=>alert("Demo only: connect your virtual-bet API to place these selections.")}>Place virtual bets</button></section></>}</div>}
function Wallet({user,coins}){return <div className="page"><small>MY WALLET</small><h1>Coin Center</h1><section className="balance"><small>AVAILABLE VIRTUAL COINS</small><h1>🪙 {fmt(user?.coins)}</h1><button className="primary"onClick={coins}>＋ Claim 1,000</button></section><div className="note">No deposits, UPI payments or cash withdrawals are included. Coins have no cash value.</div></div>}
function Profile({user,setPage,logout}){return <div className="page"><div className="profile"><div>{user?.username?.[0]?.toUpperCase()}</div><h1>{user?.username}</h1><small>Virtual-coin member</small></div><div className="menu"><button onClick={()=>setPage("wallet")}>🪙 Coin Center</button><button onClick={()=>setPage("history")}>📜 Bet History</button><button>⭐ Favorites</button><button>⚙️ Settings</button></div><button className="danger"onClick={logout}>Log out</button></div>}
function History({token}){const[a,setA]=useState([]);useEffect(()=>{fetch("/api/bets",{headers:{Authorization:"Bearer "+token}}).then(r=>r.json()).then(x=>setA(x.bets||[])).catch(()=>{})},[token]);return <div className="page"><small>ACCOUNT</small><h1>Bet History</h1>{a.map(x=><div className="history"key={x.id}><b>{x.selection}</b><small>{x.event_name} · 🪙 {x.stake}</small><em>{x.status}</em></div>)}{!a.length&&<div className="empty">No virtual bets yet.</div>}</div>}
function Games(){return <div className="page"><small>GAME LOUNGE</small><h1>Play Zone</h1><section className="gameHero"><h2>Neon Game Night</h2><p>Arcade-style demo games using virtual coins.</p>✨</section><div className="games">{["🎰 Neon Slots","🎲 Dice Lab","🃏 Card Room","🎯 Spin Arena","🕹️ Retro Rush","🏆 Prize Room"].map(x=><button key={x}><b>{x.split(" ")[0]}</b>{x.slice(2)}<small>Demo game</small></button>)}</div></div>}
function Auth({close,done}){const[m,setM]=useState("login"),[u,setU]=useState(""),[p,setP]=useState(""),[e,setE]=useState("");async function go(){try{const r=await fetch(m==="login"?"/api/login":"/api/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:u,password:p})}),d=await r.json();r.ok?done(d.token,d.user):setE(d.error||"Unable to continue")}catch{setE("Network error")}}return <div className="overlay"><div className="modal"><button className="x"onClick={close}>×</button><div className="authLogo">N</div><small>{m==="login"?"WELCOME BACK":"CREATE ACCOUNT"}</small><h2>{m==="login"?"Login":"Create account"}</h2><input placeholder="Username"value={u}onChange={e=>setU(e.target.value)}/><input placeholder="Password"type="password"value={p}onChange={e=>setP(e.target.value)}/>{e&&<p className="error">{e}</p>}<button className="primary full"onClick={go}>{m==="login"?"Login":"Register"}</button><button className="switch"onClick={()=>setM(m==="login"?"register":"login")}>{m==="login"?"Create an account":"Back to login"}</button></div></div>}

const root=document.getElementById("root");
if(root)createRoot(root).render(<ErrorBoundary><App/></ErrorBoundary>);
