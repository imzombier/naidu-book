import React,{useEffect,useState}from"react";
import{createRoot}from"react-dom/client";
import"./style.css";

const SPORTS=[
{id:"cricket",name:"Cricket",icon:"🏏",group:"cricket"},
{id:"tennis",name:"Tennis",icon:"🎾",group:"tennis"},
{id:"football",name:"Football",icon:"⚽",group:"soccer"},
{id:"basketball",name:"Basketball",icon:"🏀",group:"basketball"}
];

async function api(url,opt={}){
 const t=localStorage.getItem("naidu_token");
 const h={"Content-Type":"application/json",...(opt.headers||{})};
 if(t)h.Authorization=`Bearer ${t}`;
 const r=await fetch(url,{...opt,headers:h});
 const d=await r.json().catch(()=>({}));
 if(!r.ok)throw Error(d.error||"Request failed");
 return d;
}

const date=x=>new Date(x).toLocaleString("en-IN",{dateStyle:"medium",timeStyle:"short"});

function App(){
 const[page,setPage]=useState("sports"),[sport,setSport]=useState("cricket");
 const[user,setUser]=useState(null),[events,setEvents]=useState([]);
 const[loading,setLoading]=useState(false),[error,setError]=useState("");
 const[slip,setSlip]=useState([]),[msg,setMsg]=useState("");
 const[bets,setBets]=useState([]),[tx,setTx]=useState([]);
 const[email,setEmail]=useState(""),[password,setPassword]=useState("");
 const[auth,setAuth]=useState("login");

 useEffect(()=>{
  if(localStorage.getItem("naidu_token"))
   api("/api/me").then(setUser).catch(()=>localStorage.removeItem("naidu_token"));
 },[]);

 useEffect(()=>{if(page==="sports")load(sport)},[sport,page]);

 useEffect(()=>{
  if(user&&(page==="wallet"||page==="bets"))
   Promise.all([api("/api/bets"),api("/api/transactions")])
    .then(([b,t])=>{setBets(b);setTx(t)}).catch(()=>{});
 },[user,page]);

 async function load(s){
  setLoading(true);setError("");setEvents([]);
  try{
   const list=await api("/api/sports");
   const cfg=SPORTS.find(x=>x.id===s);
   const comps=list.filter(x=>x.active&&String(x.group||"").toLowerCase()===cfg.group);
   if(!comps.length)throw Error(`No ${cfg.name} competitions available right now.`);
   const all=(await Promise.all(comps.map(async x=>{
    try{return await api("/api/odds/"+encodeURIComponent(x.key))}
    catch{return[]}
   }))).flat();
   const unique=[...new Map(all.map(x=>[x.id,x])).values()]
    .sort((a,b)=>new Date(a.commence_time)-new Date(b.commence_time));
   setEvents(unique);
   if(!unique.length)setError(`No ${cfg.name} matches with odds available right now.`);
  }catch(e){setError(e.message)}
  finally{setLoading(false)}
 }

 async function submit(e){
  e.preventDefault();setMsg("");
  try{
   const d=await api(auth==="login"?"/api/login":"/api/register",{
    method:"POST",body:JSON.stringify({email,password})
   });
   localStorage.setItem("naidu_token",d.token);
   setUser(d.user);setEmail("");setPassword("");setPage("sports");
   setMsg(auth==="login"?"Login successful":"Account created with 10,000 virtual coins");
  }catch(e){setMsg(e.message)}
 }

 function add(ev,o){
  const p={eventId:ev.id,eventName:`${ev.home_team} vs ${ev.away_team}`,team:o.name,odds:o.price};
  setSlip(a=>a.some(x=>x.eventId===ev.id)?a.map(x=>x.eventId===ev.id?p:x):[...a,p]);
  setMsg("Added to bet slip");
 }

 async function bet(stake){
  if(!user)return setPage("login");
  if(!slip.length)return setMsg("Add a selection first");
  try{
   const d=await api("/api/bets",{
    method:"POST",body:JSON.stringify({stake,picks:slip})
   });
   setUser(d.user);setSlip([]);setMsg(`Demo bet placed: ${stake} 🪙`);
  }catch(e){setMsg(e.message)}
 }

 async function topup(){
  if(!user)return setPage("login");
  try{
   const d=await api("/api/demo-topup",{method:"POST"});
   setUser(d);setMsg("+1,000 virtual coins");
  }catch(e){setMsg(e.message)}
 }

 function logout(){
  localStorage.removeItem("naidu_token");
  setUser(null);setSlip([]);setPage("sports");
 }

 function outcomes(e){
  return e.bookmakers?.[0]?.markets?.find(x=>x.key==="h2h")?.outcomes||[];
 }

 if(page==="login")return <div className="app">
  <header className="topbar"><div className="brand">NAIDU <span>BOOK</span></div></header>
  <main className="content authPage"><div className="authCard">
   <h1>{auth==="login"?"Welcome Back":"Create Account"}</h1>
   <p className="muted">Virtual-coins demo platform</p>
   <form onSubmit={submit}>
    <input type="email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} required/>
    <input type="password" placeholder="Password (6+ characters)" value={password} onChange={e=>setPassword(e.target.value)} minLength="6" required/>
    <button className="primaryBtn">{auth==="login"?"Login":"Create Account"}</button>
   </form>
   <button className="linkBtn" onClick={()=>setAuth(auth==="login"?"register":"login")}>
    {auth==="login"?"Create a new account":"Already have an account? Login"}
   </button>
   <button className="secondaryBtn" onClick={()=>setPage("sports")}>← Back</button>
  </div></main>
 </div>;

 return <div className="app">

  <header className="topbar">
   <div className="brand">NAIDU <span>BOOK</span></div>
   <button className="coinBadge" onClick={()=>setPage("wallet")}>🪙 {user?.coins||0}</button>
  </header>

  {page==="sports"&&<div className="sportTabs">
   {SPORTS.map(x=><button key={x.id} className={sport===x.id?"sportTab active":"sportTab"} onClick={()=>setSport(x.id)}>
    {x.icon} {x.name}
   </button>)}
  </div>}

  <main className="content">

   {page==="sports"&&<section>
    <div className="pageHeader">
     <div><h1>{SPORTS.find(x=>x.id===sport)?.icon} {SPORTS.find(x=>x.id===sport)?.name}</h1><p>Live / Upcoming</p></div>
     <button className="refreshBtn" onClick={()=>load(sport)}>↻ Refresh</button>
    </div>

    {loading&&<div className="loading">Loading {sport} matches...</div>}

    {!loading&&error&&<div className="emptyCard">
     <div className="emptyIcon">{SPORTS.find(x=>x.id===sport)?.icon}</div>
     <h2>No matches available</h2><p>{error}</p>
     <button className="primaryBtn" onClick={()=>load(sport)}>Try Again</button>
    </div>}

    {!loading&&!error&&events.map(e=>{
     const os=outcomes(e);
     return <div className="eventCard" key={e.id}>
      <div className="eventTop">
       <strong>{e.sport_title||SPORTS.find(x=>x.id===sport)?.name}</strong>
       <span className="eventTime">{date(e.commence_time)}</span>
      </div>
      <div className="teams">
       <div>{e.home_team}</div><span>VS</span><div>{e.away_team}</div>
      </div>
      {os.length?<div className="oddsGrid">
       {os.map(o=><button className="oddBtn" key={o.name} onClick={()=>add(e,o)}>
        <span>{o.name}</span><b>{Number(o.price).toFixed(2)}</b>
       </button>)}
      </div>:<div className="noOdds">Odds unavailable</div>}
     </div>
    })}
   </section>}

   {page==="slip"&&<section>
    <div className="pageHeader"><h1>Bet Slip</h1></div>
    {!slip.length?<div className="emptyCard"><div className="emptyIcon">🎟️</div><h2>Your slip is empty</h2><p>Select an odd from Sports.</p></div>:
    <>
     {slip.map(x=><div className="slipItem" key={x.eventId}><strong>{x.eventName}</strong><div>{x.team}<b>{Number(x.odds).toFixed(2)}</b></div></div>)}
     <div className="betPanel"><p>Virtual coins only</p>
      <button className="primaryBtn" onClick={()=>bet(100)}>Place Demo Bet — 100 🪙</button>
      <button className="secondaryBtn" onClick={()=>bet(500)}>Place Demo Bet — 500 🪙</button>
     </div>
    </>}
   </section>}

   {page==="wallet"&&<section>
    <div className="pageHeader"><h1>Wallet</h1></div>
    {!user?<div className="emptyCard"><h2>Login required</h2><button className="primaryBtn" onClick={()=>setPage("login")}>Login</button></div>:
    <>
     <div className="walletCard"><span>Virtual Coin Balance</span><strong>🪙 {user.coins}</strong><button className="primaryBtn" onClick={topup}>+1,000 Demo Coins</button></div>
     <h2>Transactions</h2>
     {tx.map(x=><div className="historyItem" key={x.id}><span>{x.note}</span><b>{x.amount>0?"+":""}{x.amount} 🪙</b></div>)}
    </>}
   </section>}

   {page==="bets"&&<section>
    <div className="pageHeader"><h1>My Bets</h1></div>
    {!user?<div className="emptyCard"><h2>Login required</h2><button className="primaryBtn" onClick={()=>setPage("login")}>Login</button></div>:
    !bets.length?<div className="emptyCard"><div className="emptyIcon">🎟️</div><h2>No bets yet</h2></div>:
    bets.map(x=><div className="historyCard" key={x.id}><strong>Bet #{x.id}</strong><span>Stake: {x.stake} 🪙</span><span>Status: {x.status}</span><small>{date(x.created_at)}</small></div>)}
   </section>}

   {page==="casino"&&<section>
    <div className="pageHeader"><h1>🎰 Casino</h1></div>
    <div className="casinoGrid">
     {["🎴 Andar Bahar","🎨 Color Game"].map(x=><div className="casinoCard" key={x}><div>{x.split(" ")[0]}</div><h2>{x.substring(2)}</h2><p>Demo game</p><button className="primaryBtn" onClick={()=>setMsg("Demo casino game selected")}>Play Demo</button></div>)}
    </div>
   </section>}

   {page==="profile"&&<section>
    <div className="pageHeader"><h1>Profile</h1></div>
    {!user?<div className="emptyCard"><h2>Welcome to Naidu Book</h2><button className="primaryBtn" onClick={()=>setPage("login")}>Login / Register</button></div>:
    <div className="profileCard"><div className="avatar">👤</div><h2>{user.email}</h2><p>Virtual Coins: <b>{user.coins}</b></p><button className="secondaryBtn" onClick={logout}>Logout</button></div>}
   </section>}

  </main>

  {msg&&<div className="toast" onClick={()=>setMsg("")}>{msg}</div>}

  <nav className="bottomNav">
   <button className="navItem" onClick={()=>setPage("sports")}><span>🏠</span>Home</button>
   <button className="navItem active" onClick={()=>setPage("sports")}><span>🏏</span>Sports</button>
   <button className="navItem" onClick={()=>setPage("casino")}><span>🎰</span>Casino</button>
   <button className="navItem" onClick={()=>setPage("wallet")}><span>🪙</span>Wallet</button>
   <button className="navItem" onClick={()=>setPage("profile")}><span>👤</span>Profile</button>
  </nav>

 </div>;
}

createRoot(document.getElementById("root")).render(<App/>);
