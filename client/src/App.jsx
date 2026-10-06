import React,{useEffect,useRef,useState} from "react";
import {api} from "./api";

const format=(s)=>{s=Math.max(0,Math.ceil(s));return `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`};
const durationLabel=(a)=>({grid:"9 min total",motion:"6 min total",deductive:"6 min total",numbubbles:"12 sec / target",shortcuts:"4 min total",tally:"4 sec / question"}[a.id]||`${a.round_seconds} sec / question`);

function App(){
  const [user,setUser]=useState(null);
  const [page,setPage]=useState("home");
  const [activity,setActivity]=useState(null);
  const [attempt,setAttempt]=useState(null);
  const [question,setQuestion]=useState(null);
  const [feedback,setFeedback]=useState(null);
  const [history,setHistory]=useState([]);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const submitting=useRef(false);

  useEffect(()=>{api.me().then(x=>setUser(x.user)).catch(()=>{});},[]);
  useEffect(()=>{if(user&&page==="home") api.history().then(x=>setHistory(x.history)).catch(()=>{});},[user,page]);

  const logout=()=>{localStorage.removeItem("neuroquest_token");setUser(null);setPage("home");setAttempt(null);setQuestion(null);};
  const openGame=async(a)=>{
    setError("");setActivity(a);setAttempt(null);setQuestion(null);setFeedback(null);setPage("brief");
  };
  const startRounds=async(infinite)=>{
    if(!activity)return;
    setBusy(true);setError("");
    try{
      const r=await api.start(activity.id,infinite);
      setActivity(r.activity);setAttempt(r.attempt);setQuestion(r.question);setFeedback(null);setPage("game");
    }catch(e){setError(e.message)} finally{setBusy(false)}
  };
  const submit=async(answer)=>{
    if(submitting.current||!attempt||!question)return;
    submitting.current=true;setBusy(true);setError("");
    try{
      const r=await api.answer(attempt.id,answer,question.id,attempt.round);
      setAttempt(v=>({...v,score:r.score,correctCount:r.correctCount,round:r.completed?v.round:v.round+1,status:r.completed?"completed":"active"}));
      if(r.completed){setFeedback(r);setPage("result");}
      else {setQuestion(r.nextQuestion);setFeedback(null);}
    }catch(e){setError(e.message)}
    finally{submitting.current=false;setBusy(false)}
  };
  const quit=async()=>{
    if(attempt?.status==="active" && attempt.roundLimit==null){
      setBusy(true);setError("");
      try{
        const r=await api.finish(attempt.id);
        setAttempt(v=>({...v,...r.attempt,round:v.round,roundsPlayed:r.attempt.roundsPlayed}));
        setPage("result");
      }catch(e){setError(e.message)}finally{setBusy(false)}
      return;
    }
    try{if(attempt?.status==="active")await api.abandon(attempt.id)}catch{}
    setPage("home");setAttempt(null);setQuestion(null);setActivity(null);setFeedback(null);
  };

  if(!user) return <Auth onLogin={u=>{setUser(u);setPage("home")}} />;
  if(page==="brief") return <Brief activity={activity} onStart={startRounds} onBack={quit}/>;
  if(page==="game") return <Game activity={activity} attempt={attempt} question={question} onSubmit={submit} onSkip={()=>submit({skip:true})} onQuit={quit} busy={busy} error={error}/>;
  if(page==="result") return <Result activity={activity} attempt={attempt} feedback={feedback} onHome={()=>{setPage("home");setFeedback(null)}} onReplay={()=>openGame(activity)}/>;
  if(page==="admin") return <Admin onBack={()=>setPage("home")}/>;
  return <Home user={user} history={history} onLogout={logout} onPlay={openGame} onAdmin={()=>setPage("admin")} busy={busy} error={error}/>;
}

function Auth({onLogin}){
  const [mode,setMode]=useState("login"),[teamName,setTeamName]=useState(""),[name,setName]=useState(""),[password,setPassword]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const submit=async(e)=>{
    e.preventDefault();setBusy(true);setError("");
    try{
      const r=mode==="login"?await api.login(teamName,password):await api.register(teamName,name,password);
      localStorage.setItem("neuroquest_token",r.token);onLogin(r.user);
    }catch(e){setError(e.message)}finally{setBusy(false)}
  };
  return <div className="auth"><div className="auth-card panel">
    <div className="brand large"><div className="brand-mark">N</div><div><b>NEUROQUEST</b><span>Infinity Assessment</span></div></div>
    <div className="eyebrow">TEAM ACCESS</div>
    <h1>{mode==="login"?"Enter your team arena.":"Register your team."}</h1>
    <p className="muted">Use your <b>team name</b> to sign in. No email is required for participants.</p>
    <form onSubmit={submit}>
      <Field label="Team name" value={teamName} onChange={setTeamName} placeholder="e.g. Team Phoenix" type="text"/>
      {mode==="register"&&<Field label="Team representative / member" value={name} onChange={setName} placeholder="Full name"/>}
      <Field label="Password" value={password} onChange={setPassword} placeholder="Minimum 6 characters" type="password"/>
      {error&&<div className="alert bad">{error}</div>}
      <button className="btn primary wide" disabled={busy} type="submit">{busy?"Please wait…":mode==="login"?"Enter Arena":"Create Team"}</button>
    </form>
    <button className="link-btn" onClick={()=>{setMode(mode==="login"?"register":"login");setError("")}}>{mode==="login"?"New team? Register here":"Already registered? Sign in"}</button>
  </div></div>
}
function Field({label,value,onChange,placeholder,type="text"}){return <label className="field"><span>{label}</span><input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} type={type} required/></label>}

function Topbar({user,onLogout}){
  return <header className="topbar"><div className="brand"><div className="brand-mark">N</div><div><b>NEUROQUEST</b><span>Gamification Assessment</span></div></div><div className="top-actions"><span className="user-pill">{user?.role==="admin"?"ADMIN":user?.teamName||user?.team_name||user?.name}</span><button className="btn ghost" onClick={onLogout}>Logout</button></div></header>
}

function Home({user,history,onLogout,onPlay,onAdmin,busy,error}){
  const [activities,setActivities]=useState([]);
  useEffect(()=>{api.activities().then(x=>setActivities(x.activities)).catch(()=>{})},[]);
  return <div><Topbar user={user} onLogout={onLogout}/><main className="container">
    <section className="hero-grid"><div className="hero panel">
      <div className="eyebrow">ASSESS • PLAY • PROGRESS</div>
      <h1>Eight assessment games.<br/><em>One clean arena.</em></h1>
      <p className="hero-copy">Every activity starts with a clear instruction screen, then moves into numbered rounds with a visible timer, focused question layout, server-side validation and a final result.</p>
      <div className="hero-buttons"><button className="btn primary" onClick={()=>onPlay(activities[0])} disabled={!activities.length||busy}>Start Assessment</button>{user.role==="admin"&&<button className="btn ghost" onClick={onAdmin}>Admin Dashboard</button>}</div>
    </div>
    <div className="stats-card panel"><Stat n={activities.length} t="Activities"/><Stat n={activities.reduce((n,a)=>n+a.rounds,0)} t="Assessment rounds"/><Stat n={history.filter(x=>x.status==="completed").length} t="Completed"/><Stat n={history.reduce((n,x)=>n+x.score,0)} t="Marks earned"/></div></section>
    {error&&<div className="alert bad">{error}</div>}
    <section className="section"><div className="section-head"><div><div className="eyebrow">ASSESSMENT SUITE</div><h2>Choose an activity</h2></div><span className="muted">Each activity has its own rules and rounds.</span></div>
      <div className="activity-grid">{activities.map(a=><ActivityCard key={a.id} a={a} onPlay={onPlay}/>)}</div>
    </section>
    <section className="section"><div className="section-head"><div><div className="eyebrow">YOUR RECORD</div><h2>Recent attempts</h2></div></div>
      <div className="table panel">{history.length?<>{history.slice(0,8).map(h=><div className="table-row" key={h.id}><span>{h.icon} {h.title}</span><span>{h.correct_count}/{h.rounds_played} correct</span><b>{h.score} XP</b><span className="muted small">{h.status}</span></div>)}</>:<div className="empty">No completed attempts yet. Start your first activity.</div>}</div>
    </section>
  </main></div>
}
function Stat({n,t}){return <div className="stat"><b>{n}</b><span>{t}</span></div>}
function ActivityCard({a,onPlay}){return <article className="activity-card panel"><div className="activity-icon">{a.icon}</div><div className="eyebrow">{a.skill}</div><h3>{a.title}</h3><p>{a.description}</p><div className="chips"><span>{a.rounds} rounds</span><span>{durationLabel(a)}</span></div><button className="btn primary wide" onClick={()=>onPlay(a)}>Open activity →</button></article>}

function Brief({activity,onStart,onBack}){
  const [infinite,setInfinite]=useState(true);
  return <div className="game-page"><div className="game-top"><div className="brand"><div className="brand-mark">{activity.icon}</div><div><b>{activity.title}</b><span>{activity.skill}</span></div></div><button className="btn ghost" onClick={onBack}>Exit</button></div>
    <main className="brief-wrap"><section className="brief panel"><div className="eyebrow">ACTIVITY BRIEFING</div><h1>{activity.title}</h1><p className="lead">{activity.description}</p>
      <div className="brief-grid"><div className="rule-card"><span>ROUNDS</span><b>{infinite?"∞":activity.rounds}</b></div><div className="rule-card"><span>TIME</span><b>{durationLabel(activity)}</b></div><div className="rule-card"><span>SCORING</span><b>100 correct · 0 otherwise</b></div></div>
      <div className="instruction-box"><div className="eyebrow">HOW TO PLAY</div><p>{activity.instructions}</p><p className="muted small">Correct answer: +100 marks. Incorrect, skipped or timed-out question: 0 marks. Each question advances automatically.</p></div>
      <div className="mode-heading"><div className="eyebrow">CHOOSE YOUR MODE</div><span className="muted small">Fresh generated variations in both modes</span></div>
      <div className="mode-options"><button className={`mode-card ${infinite?"selected":""}`} onClick={()=>setInfinite(true)}><span className="mode-icon">∞</span><b>Infinite Practice</b><small>Unlimited dynamically generated questions. Finish whenever you want.</small><i>{infinite?"Selected":"Select mode"}</i></button><button className={`mode-card ${!infinite?"selected":""}`} onClick={()=>setInfinite(false)}><span className="mode-icon">◈</span><b>PPT Assessment</b><small>Follow the original activity round count: {activity.rounds} rounds.</small><i>{!infinite?"Selected":"Select mode"}</i></button></div>
      <div className="brief-actions"><button className="btn ghost" onClick={onBack}>Back</button><button className="btn primary" onClick={()=>onStart(infinite)}>Start {infinite?"Infinite Practice":"Assessment"} →</button></div>
    </section></main>
  </div>
}

function Game({activity,attempt,question,onSubmit,onSkip,onQuit,busy,error}){
  const [seconds,setSeconds]=useState(activity.round_seconds);
  const timeoutHandled=useRef(false);
  useEffect(()=>{setSeconds(activity.round_seconds);timeoutHandled.current=false;},[question,activity.round_seconds]);
  useEffect(()=>{
    const t=setInterval(()=>setSeconds(s=>Math.max(0,s-1)),1000);
    return ()=>clearInterval(t);
  },[question]);
  useEffect(()=>{if(seconds===0&&!busy&&!timeoutHandled.current){timeoutHandled.current=true;onSubmit({timeout:true})}},[seconds,question?.id,busy]);

  const submit=(answer)=>onSubmit(answer);
  const infinite=attempt?.roundLimit==null;
  const percent=infinite?null:Math.min(100,Math.round(((attempt?.round||1)/attempt.roundLimit)*100));

  return <div className="game-page"><div className="game-top"><div className="brand"><div className="brand-mark">{activity.icon}</div><div><b>{activity.title}</b><span>{infinite?"Infinite practice":"PPT assessment"}</span></div></div><div className="game-top-right"><div className={`timer ${seconds<=10?"danger":""}`} aria-label={`Time remaining ${seconds} seconds`}>{format(seconds)}</div><button className="btn ghost" onClick={onSkip} disabled={busy}>Skip →</button><button className="btn ghost" onClick={onQuit} disabled={busy}>{infinite?"Finish run":"Quit"}</button></div></div>
    <main className="game-wrap"><div className="round-meta"><span>{infinite?`Round ${attempt.round} · Infinite mode`:`Round ${attempt.round} of ${attempt.roundLimit}`}</span><b>{infinite?"∞":`${percent}%`}</b></div><div className={`progress ${infinite?"infinite-progress":""}`}><i style={infinite?undefined:{width:`${percent}%`}}/></div>
      <section className="question panel question-enter" key={`${question.id}-${attempt.round}`}><div className="tag">{question.type==="grid"?"MEMORY + SYMMETRY":activity.skill}</div><h2>{question.prompt}</h2><p className="question-desc">{question.description}</p>
        <QuestionRenderer key={`${question.id}-${attempt.round}`} q={question} disabled={busy} onSubmit={submit}/>
        {error&&<div className="alert bad" role="alert">{error}</div>}
        <div className="game-footnote"><span>Correct: +100 marks</span><span>Wrong / skipped / timed out: 0 marks</span></div>
      </section>
    </main>
  </div>
}

function QuestionRenderer({q,disabled,onSubmit}){
  if(q.type==="grid") return <Grid q={q} disabled={disabled} onSubmit={onSubmit}/>;
  if(q.type==="motion") return <Motion q={q} disabled={disabled} onSubmit={onSubmit}/>;
  if(q.type==="inductive") return <Inductive q={q} disabled={disabled} onSubmit={onSubmit}/>;
  if(q.type==="deductive") return <Deductive q={q} disabled={disabled} onSubmit={onSubmit}/>;
  if(q.type==="numbubbles") return <NumBubbles q={q} disabled={disabled} onSubmit={onSubmit}/>;
  if(q.type==="shortcuts") return <Shortcuts q={q} disabled={disabled} onSubmit={onSubmit}/>;
  if(q.type==="resemble") return <Resemble q={q} disabled={disabled} onSubmit={onSubmit}/>;
  if(q.type==="tally") return <Tally q={q} disabled={disabled} onSubmit={onSubmit}/>;
  return null;
}

function Grid({q,disabled,onSubmit}){
  const [phase,setPhase]=useState("intro");
  const [index,setIndex]=useState(0);
  const [symmetryAnswers,setSymmetryAnswers]=useState([]);
  const positions=q.payload.positions;
  const checks=q.payload.symmetryChecks||[];
  const check=checks[index];
  const renderGrid=(cells,highlighted=[],numbered=false)=><div className="memory-grid visual-grid">{Array.from({length:25},(_,i)=><div className={`memory-cell ${highlighted.includes(i)?"lit":""}`} key={i}>{numbered&&highlighted.includes(i)?highlighted.indexOf(i)+1:""}</div>)}</div>;
  if(phase==="intro")return <div className="memory-stage"><div className="memory-illustration">{renderGrid([],[],false)}<div className="visual-hint"><span className="pulse-dot"/> Watch each dot and remember its number.</div></div><p className="muted center">A symmetry check appears between each pair of dots. Answer it to reveal the next dot.</p><button className="btn primary" disabled={disabled} onClick={()=>setPhase("study")}>Begin memory sequence →</button></div>;
  if(phase==="study")return <div className="memory-stage"><div className="phase-label">MEMORY SEQUENCE <b>DOT {index+1} / {positions.length}</b></div>{renderGrid(positions,[positions[index]],false)}<p className="muted center">Memorize the highlighted position.</p>{index<positions.length-1?<button className="btn primary" disabled={disabled} onClick={()=>setPhase("symmetry")}>Next dot →</button>:<button className="btn primary" disabled={disabled} onClick={()=>setPhase("recall")}>Recall sequence →</button>}</div>;
  if(phase==="symmetry")return <div className="memory-stage"><div className="phase-label">QUICK CHECK <b>BEFORE THE NEXT DOT</b></div><h3 className="center symmetry-title">Are these figures symmetrical?</h3><div className="symmetry-pair"><div>{renderGrid(check?.left||[],check?.left||[])}</div><span className="symmetry-vs">VS</span><div>{renderGrid(check?.right||[],check?.right||[])}</div></div><div className="symmetry-actions"><button className="btn ghost" disabled={disabled} onClick={()=>{setSymmetryAnswers(v=>[...v,false]);setIndex(v=>v+1);setPhase("study")}}>No</button><button className="btn primary" disabled={disabled} onClick={()=>{setSymmetryAnswers(v=>[...v,true]);setIndex(v=>v+1);setPhase("study")}}>Yes, symmetrical</button></div></div>;
  const choices=q.payload.choices||[positions,[...positions].reverse(),positions.map(x=>(x+1)%25),positions.map(x=>(x+5)%25)];
  return <div className="memory-stage"><div className="phase-label">RECALL <b>SELECT THE EXACT ORDER</b></div>{renderGrid(positions,[],false)}<p className="muted center">Choose the sequence you memorized.</p><div className="answer-grid">{choices.map((arr,i)=><button key={i} disabled={disabled} className="answer-card" onClick={()=>onSubmit({positions:arr,symmetryAnswers})}><b>{String.fromCharCode(65+i)}</b><span>{arr.map(x=>x+1).join(" → ")}</span></button>)}</div></div>;
}

function Motion({q,disabled,onSubmit}){
  const [blocks,setBlocks]=useState(q.payload.walls);
  const [ball,setBall]=useState(q.payload.start||0);
  const [moves,setMoves]=useState(0);
  const route=q.payload.route||[];
  const goal=q.payload.goal||34;
  const moveBlock=(cell)=>{
    const row=Math.floor(cell/7),col=cell%7;
    const neighbors=[row>0?cell-7:-1,row<4?cell+7:-1,col>0?cell-1:-1,col<6?cell+1:-1].filter(x=>x>=0);
    const target=neighbors.find(x=>!route.includes(x)&&!blocks.includes(x)&&x!==ball&&x!==goal)
      ??Array.from({length:35},(_,i)=>i).find(x=>!route.includes(x)&&!blocks.includes(x)&&x!==ball&&x!==goal);
    if(target===undefined)return;
    setBlocks(v=>v.map(x=>x===cell?target:x));setMoves(v=>v+1);
  };
  const moveBall=(cell)=>{
    if(!route.includes(cell)||blocks.includes(cell))return;
    const adjacent=Math.abs(Math.floor(cell/7)-Math.floor(ball/7))+Math.abs((cell%7)-(ball%7))===1;
    if(adjacent)setBall(cell);
  };
  return <div><p className="muted center motion-hint">Tap a purple block to move it off the track. Tap an adjacent open track cell to move the ball.</p><div className="motion-board motion-grid" role="group" aria-label="Interactive motion puzzle">{Array.from({length:35},(_,i)=>{const blocked=blocks.includes(i),onTrack=route.includes(i);return <button key={i} disabled={disabled||!onTrack} className={`motion-cell ${onTrack?"on-track":"off-track"} ${blocked?"blocked":""} ${i===ball?"ball-cell":""} ${i===goal?"goal-cell":""}`} onClick={()=>blocked?moveBlock(i):moveBall(i)} aria-label={i===ball?"Red ball":i===goal?"Goal":blocked?"Move obstacle":onTrack?"Open track":"Outside track"}>{i===ball?<span className="motion-ball"/>:i===goal?<span className="motion-goal">●</span>:blocked?<span className="motion-block"/>:onTrack?<span className="track-dot"/>:null}</button>})}</div><div className="control-row motion-controls"><button className="btn ghost" onClick={()=>{setBlocks(q.payload.walls);setBall(q.payload.start||0);setMoves(0)}} disabled={disabled}>Reset board</button><span className="move-count">Block moves: <b>{moves}</b></span><span className={`goal-status ${ball===goal?"reached":""}`}>{ball===goal?"Goal reached ✓":"Guide the ball to the hole"}</span></div><div className="answer-heading">What is the minimum number of block moves?</div><div className="answer-grid compact">{q.payload.options.map((n,i)=><button className="answer-card" disabled={disabled||ball!==goal} key={`${n}-${i}`} onClick={()=>onSubmit({option:i})}><b>{String.fromCharCode(65+i)}</b><span>{n} moves</span></button>)}</div></div>
}

function Inductive({q,disabled,onSubmit}){
  const [selected,setSelected]=useState([]);
  const choose=(i)=>{
    if(disabled||selected.includes(i))return;
    const next=[...selected,i];
    setSelected(next);
    if(next.length===2)onSubmit({options:next.sort((a,b)=>a-b)});
  };
  return <div><div className="pattern-row">{q.payload.sequence.map((cells,i)=><div className="pattern-step" key={i}><div className="pattern-box">{Array.from({length:9},(_,n)=><i className={cells.includes(n)?"on":""} key={n}/>)}</div><small>STEP {i+1}</small></div>)}<div className="pattern-step"><div className="pattern-box missing">?</div><small>NEXT</small></div></div><p className="muted center">Select 2 matching figures · {selected.length}/2 selected</p><div className="answer-grid compact">{q.payload.options.map((x,i)=><button className={`answer-card ${selected.includes(i)?"selected-answer":""}`} disabled={disabled} key={i} onClick={()=>choose(i)}><b>{String.fromCharCode(65+i)}</b><span><span className="pattern-choice">{Array.from({length:9},(_,n)=><i className={n===x?"on":""} key={n}/>)}</span></span></button>)}</div></div>
}

function Deductive({q,disabled,onSubmit}){
  return <div><div className="logic-grid" style={{gridTemplateColumns:`repeat(${q.payload.size},minmax(0,1fr))`}}>{q.payload.matrix.map((x,i)=><div className={`logic-cell ${x===null?"missing":""}`} key={i}>{x===null?"?":<span className={`logic-symbol symbol-${x}`}>{["●","◆","▲","■"][x]}</span>}</div>)}</div><div className="answer-grid compact">{q.payload.options.map((x,i)=><button className="answer-card" disabled={disabled} key={i} onClick={()=>onSubmit({option:i})}><b>{String.fromCharCode(65+i)}</b><span className={`logic-symbol symbol-${x}`}>{["●","◆","▲","■"][x]}</span></button>)}</div></div>
}

function NumBubbles({q,disabled,onSubmit}){
  return <div><div className="target-badge">TARGET <b>{q.payload.target}</b></div><div className="bubble-field bubble-field-many">{q.payload.options.map((x,i)=><button className="bubble" disabled={disabled} key={i} style={{left:`${1+(i%5)*19}%`,top:`${1+Math.floor(i/5)*24}%`,animationDelay:`-${(i%7)*.4}s`}} onClick={()=>onSubmit({equation:x})}>{x}</button>)}</div></div>
}

function Shortcuts({q,disabled,onSubmit}){
  const pts={A:[35,92],B:[125,48],C:[215,48],D:[35,172],E:[125,172],F:[215,172]};
  return <div><div className="route-map route-visual"><svg viewBox="0 0 250 210" role="img" aria-label="Route network from A to destination F">{q.payload.edges.map(([a,b,w],i)=><g key={i}><line x1={pts[a][0]} y1={pts[a][1]} x2={pts[b][0]} y2={pts[b][1]} className="route-edge"/><text x={(pts[a][0]+pts[b][0])/2} y={(pts[a][1]+pts[b][1])/2-7} className="route-weight">{w}</text></g>)}{q.payload.nodes.map(n=><g key={n}><circle cx={pts[n][0]} cy={pts[n][1]} r="17" className={n==="F"?"route-destination":n==="A"?"route-start":n===q.payload.discountNode?"route-shortcut":"route-dot"}/><text x={pts[n][0]} y={pts[n][1]+5} textAnchor="middle" className="route-letter">{n==="F"?"★":n}</text>{n==="B"&&<g><circle cx={pts[n][0]+17} cy={pts[n][1]-15} r="8" className="red-marble"/><text x={pts[n][0]+17} y={pts[n][1]-12} textAnchor="middle" className="red-marble-letter">R</text></g>}</g>)}</svg></div><div className="route-legend"><span><i className="legend-blue"/>Blue marble starts at A</span><span><i className="legend-red"/>Red marble adds distance</span><span><i className="legend-gray"/>Grey shortcut at {q.payload.discountNode} −{q.payload.discount} once</span></div><div className="route-choice-title">Choose the route with the shortest total distance</div><div className="answer-grid compact">{q.payload.paths.map((p,i)=><button className="answer-card" disabled={disabled} key={i} onClick={()=>onSubmit({option:i})}><b>{String.fromCharCode(65+i)}</b><span>{p.path.join(" → ")}<small className="choice-sub">Blue {p.blueDistance} + Red {p.redDistance}{p.shortcutUsed?` − ${q.payload.discount} shortcut`:""} = {p.distance}</small></span></button>)}</div></div>
}

function pattern(p,mini=false){return <div className={mini?"mini-pattern":"big-pattern"}>{p.map((v,i)=><i className={v?"on":""} key={i}/>)}</div>}
function Resemble({q,disabled,onSubmit}){
  return <div><div className="resemble-layout"><div><div className="label-center">SOURCE</div>{pattern(q.payload.source)}</div><div className="rotate-arrow">→</div><div><div className="label-center">CHOOSE RESULT</div><div className="res-options">{q.payload.options.map((p,i)=><button disabled={disabled} key={i} className="res-option" onClick={()=>onSubmit({option:i})}>{pattern(p,true)}<b>{String.fromCharCode(65+i)}</b></button>)}</div></div></div></div>
}

function Tally({q,disabled,onSubmit}){
  const items=(values,multiplier)=><div className="tally-values">{values.map((item,i)=><b key={i} className={item.struck?"struck":""}>{item.value}{item.multiplier>1&&<small> ×{item.multiplier}</small>}</b>)}{multiplier>1&&<em className="mega-multiplier">Box ×{multiplier}</em>}</div>;
  return <div><div className="tally-layout"><div className="tally-box"><span>BOX A</span>{items(q.payload.left,q.payload.leftMega)}</div><div className="versus">?</div><div className="tally-box"><span>BOX B</span>{items(q.payload.right,q.payload.rightMega)}</div></div><div className="operator-row">{[">","=","<"].map(op=><button className="operator" disabled={disabled} key={op} onClick={()=>onSubmit({operator:op})}>{op}</button>)}</div></div>
}

function Result({activity,attempt,feedback,onHome,onReplay}){
  const played=attempt.roundsPlayed??activity.rounds;
  const accuracy=played?Math.round((attempt.correctCount/played)*100):0;
  return <div className="result-page"><div className="result-card panel"><div className="eyebrow">RUN COMPLETE</div><div className="result-icon">{activity.icon}</div><h1>{activity.title}</h1><div className="result-score">{attempt.score}<small> marks</small></div><p className="muted">You answered {attempt.correctCount} of {played} questions correctly.</p><div className="result-grid"><Stat n={attempt.correctCount} t="Correct"/><Stat n={played-attempt.correctCount} t="Missed"/><Stat n={`${accuracy}%`} t="Accuracy"/></div><div className="hero-buttons center"><button className="btn primary" onClick={onReplay}>Replay activity</button><button className="btn ghost" onClick={onHome}>Back to Arena</button></div></div></div>
}

function Admin({onBack}){
  const [data,setData]=useState(null),[error,setError]=useState(""),[selected,setSelected]=useState(null),[teamData,setTeamData]=useState(null),[loading,setLoading]=useState(true);
  const load=async()=>{setLoading(true);setError("");try{setData(await api.admin());}catch(e){setError(e.message)}finally{setLoading(false)}};
  useEffect(()=>{load()},[]);
  const openTeam=async(team)=>{setError("");try{setSelected(team.team_name);setTeamData(await api.adminTeam(team.team_name));}catch(e){setError(e.message)}};
  const exportCSV=()=>{
    if(!data?.teams?.length) return;
    const headers=["Rank","Team Name","Representative","Questions Attempted","Correct Answers","Score (Marks)","Last Active"];
    const rows=data.teams.map((t,i)=>[
      i+1,
      `"${(t.team_name||"").replace(/"/g,'""')}"`,
      `"${(t.member_name||"").replace(/"/g,'""')}"`,
      t.questions_attempted,
      t.correct,
      t.score,
      `"${t.last_active?new Date(t.last_active).toLocaleString():"-"}"`
    ]);
    const csvContent="data:text/csv;charset=utf-8,"+[headers.join(","),...rows.map(e=>e.join(","))].join("\n");
    const link=document.createElement("a");
    link.setAttribute("href",encodeURI(csvContent));
    link.setAttribute("download",`neuroquest_scores_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  return <div><header className="topbar"><div className="brand"><div className="brand-mark">N</div><div><b>Admin Control Center</b><span>Live data only · NEUROQUEST</span></div></div><div className="top-actions">{data?.teams?.length>0&&<button className="btn primary" onClick={exportCSV}>📥 Export CSV</button>}<button className="btn ghost" onClick={load}>Refresh</button><button className="btn ghost" onClick={onBack}>Back</button></div></header>
    <main className="container admin-page">
      {error&&<div className="alert bad">{error}</div>}
      {loading&&!data?<div className="empty panel">Loading live data…</div>:data&&<>
        <section className="admin-hero panel"><div><div className="eyebrow">LIVE ADMIN DATA</div><h1>Team performance</h1><p className="muted">Every value below comes directly from the database. No demo teams, scores or placeholder records are inserted.</p></div><div className="admin-live-dot"><i/> LIVE</div></section>
        <div className="admin-stats"><Stat n={data.students} t="Registered teams"/><Stat n={data.attempts} t="Attempts"/><Stat n={data.responses} t="Questions attempted"/><Stat n={data.completed} t="Completed runs"/></div>
        <section className="section"><div className="section-head"><div><div className="eyebrow">TEAMS</div><h2>Team scoreboard</h2></div><span className="muted small">Click a team for its complete attempt history.</span></div>
          {data.teams.length===0?<div className="empty panel">No teams have registered yet. Live team data will appear here after the first registration.</div>:<div className="team-table panel"><div className="team-head"><span>TEAM</span><span>MEMBER</span><span>QUESTIONS</span><span>CORRECT</span><span>SCORE</span><span>LAST ACTIVE</span></div>{data.teams.map(t=><button className={`team-row ${selected===t.team_name?"active-team":""}`} key={t.team_name} onClick={()=>openTeam(t)}><span className="team-name">{t.team_name}</span><span>{t.member_name}</span><span>{t.questions_attempted}</span><span>{t.correct}</span><b>{t.score}</b><span className="muted small">{t.last_active?new Date(t.last_active).toLocaleString():"—"}</span></button>)}</div>}
        </section>
        {teamData&&<section className="section"><div className="section-head"><div><div className="eyebrow">TEAM DETAILS</div><h2>{teamData.member.team_name}</h2><span className="muted">{teamData.member.name}</span></div><button className="btn ghost" onClick={()=>{setSelected(null);setTeamData(null)}}>Close</button></div>
          <div className="table panel">{teamData.attempts.length===0?<div className="empty">This team has no attempts yet.</div>:teamData.attempts.map(a=><div className="table-row team-detail-row" key={a.id}><span>{a.title}</span><span>{a.questions_attempted} questions</span><span>{a.correct_count} correct</span><b>{a.score} marks</b><span className="muted small">{a.status}</span></div>)}</div>
        </section>}
        <section className="section"><div className="section-head"><div><div className="eyebrow">RECENT LIVE ACTIVITY</div><h2>Attempt log</h2></div></div>
          {data.recent.length===0?<div className="empty panel">No attempts have been recorded yet.</div>:<div className="table panel">{data.recent.map(a=><div className="table-row" key={a.id}><span><b>{a.team_name}</b><br/><small className="muted">{a.member_name}</small></span><span>{a.title}</span><span>{a.questions_attempted} attempted</span><span>{a.correct_count} correct</span><b>{a.score} marks</b><span className="muted small">{a.status}</span></div>)}</div>}
        </section>
      </>}
    </main>
  </div>
}

export default App;
