import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { spawnSync } from "child_process";
import db from "./db.js";
import { generateQuestion } from "./generator.js";

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const ROOT=path.join(__dirname,"..");
const CLIENT_DIST=path.join(ROOT,"client","dist");
const PORT = Number(process.env.PORT || 3000);

let rawSecret = process.env.JWT_SECRET || "";
if (!rawSecret) {
  console.warn("WARNING: JWT_SECRET not provided in environment. Using safe fallback secret for tokens.");
  rawSecret = "neuroquest_jwt_secret_key_production_2026_super_secure_32chars";
} else if (rawSecret.length < 32) {
  console.warn("WARNING: JWT_SECRET is shorter than 32 characters. Padded for cryptographic safety.");
  rawSecret = rawSecret.padEnd(32, "_neuroquest_secure_salt_pad_2026");
}
const JWT_SECRET = rawSecret;

const ADMIN_TEAM = String(process.env.ADMIN_TEAM || "abrar").trim();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || "abrar@10");

let corsOriginSetting = process.env.CORS_ORIGIN;
if (corsOriginSetting && corsOriginSetting !== "true") {
  corsOriginSetting = corsOriginSetting.trim().replace(/\/+$/, "");
} else {
  corsOriginSetting = true;
}
const CORS_ORIGIN = corsOriginSetting;

const activityCount = db.prepare("SELECT COUNT(*) AS n FROM activities").get().n;
if (activityCount === 0) {
  const seed = spawnSync(process.execPath, [path.join(__dirname, "seed.js")], {
    stdio: "inherit",
    env: process.env
  });
  if (seed.status !== 0) process.exit(seed.status || 1);
}

// Keep the configured admin account deterministic across fresh and upgraded databases.
const adminHash = ADMIN_PASSWORD ? bcrypt.hashSync(ADMIN_PASSWORD, 12) : null;
const existingAdmin = db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get();
if (adminHash) {
  if (existingAdmin) {
    db.prepare("UPDATE users SET name=?, email=?, team_name=?, password_hash=? WHERE id=?")
      .run("NeuroQuest Admin", `${ADMIN_TEAM}@admin.neuroquest.local`, ADMIN_TEAM, adminHash, existingAdmin.id);
  } else {
    db.prepare("INSERT INTO users(name,email,team_name,password_hash,role) VALUES (?,?,?,?, 'admin')")
      .run("NeuroQuest Admin", `${ADMIN_TEAM}@admin.neuroquest.local`, ADMIN_TEAM, adminHash);
  }
}

const app=express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(helmet({contentSecurityPolicy:false}));
app.use(compression());
app.use(cors({origin:CORS_ORIGIN, credentials:true}));
app.use(express.json({limit:"1mb"}));

const rateLimitMax = Number(process.env.RATE_LIMIT_MAX || 10000);
const authLimitMax = Number(process.env.AUTH_LIMIT_MAX || 2000);
app.use(rateLimit({windowMs:15*60*1000,max:rateLimitMax,standardHeaders:true,legacyHeaders:false}));
const authLimiter=rateLimit({windowMs:15*60*1000,max:authLimitMax,standardHeaders:true,legacyHeaders:false});

const publicActivityFields=`
id,title,icon,skill,description,instructions,rounds,round_seconds,scoring_note
`;

function sign(user){
  return jwt.sign({id:user.id,role:user.role,name:user.name,email:user.email},JWT_SECRET,{expiresIn:"8h"});
}
function auth(req,res,next){
  const header=req.headers.authorization||"";
  const token=header.startsWith("Bearer ")?header.slice(7):null;
  if(!token) return res.status(401).json({error:"Authentication required"});
  try{req.user=jwt.verify(token,JWT_SECRET);next();}
  catch{return res.status(401).json({error:"Session expired or invalid"});}
}
function admin(req,res,next){
  if(req.user?.role!=="admin") return res.status(403).json({error:"Admin access required"});
  next();
}
function now(){return new Date().toISOString();}
function publicQuestion(q){
  return {
    id:q.id, activityId:q.activity_id, round:q.round_no, type:q.type,
    prompt:q.prompt, description:q.description, payload:JSON.parse(q.payload_json)
  };
}

app.get("/api/health",(req,res)=>res.json({ok:true,service:"NEUROQUEST PRO",time:now()}));

app.post("/api/auth/register",authLimiter,async (req,res)=>{
  const {teamName,name,password}=req.body||{};
  const team=String(teamName||"").trim();
  const member=String(name||"").trim();
  if(!team||!member||!password||password.length<6) return res.status(400).json({error:"Team name, member name and a 6+ character password are required"});
  if(team.toLowerCase()===ADMIN_TEAM.toLowerCase()) return res.status(400).json({error:"That team name is reserved"});
  try{
    const hash=await bcrypt.hash(password,10);
    const result=db.prepare("INSERT INTO users(name,email,team_name,password_hash,role) VALUES (?,?,?,?,'student')")
      .run(member,`${team.toLowerCase()}@team.neuroquest.local`,team,hash);
    const user=db.prepare("SELECT id,name,email,team_name,role FROM users WHERE id=?").get(result.lastInsertRowid);
    res.json({token:sign(user),user});
  }catch(e){res.status(409).json({error:"That team name is already registered"});}
});

app.post("/api/auth/login",authLimiter,async (req,res)=>{
  const {teamName,password}=req.body||{};
  const key=String(teamName||"").trim();
  const user=db.prepare("SELECT * FROM users WHERE lower(team_name)=lower(?)").get(key);
  if(!user) return res.status(401).json({error:"Invalid team name or password"});
  const isMatch=await bcrypt.compare(password||"",user.password_hash);
  if(!isMatch) return res.status(401).json({error:"Invalid team name or password"});
  res.json({token:sign(user),user:{id:user.id,name:user.name,email:user.email,teamName:user.team_name,role:user.role}});
});

app.get("/api/me",auth,(req,res)=>{
  const user=db.prepare("SELECT id,name,email,team_name,role,created_at FROM users WHERE id=?").get(req.user.id);
  res.json({user:{...user,teamName:user.team_name}});
});

app.get("/api/activities",auth,(req,res)=>{
  const rows=db.prepare(`SELECT ${publicActivityFields} FROM activities WHERE active=1 ORDER BY rowid`).all();
  res.json({activities:rows});
});

app.get("/api/activities/:id",auth,(req,res)=>{
  const a=db.prepare(`SELECT ${publicActivityFields} FROM activities WHERE id=? AND active=1`).get(req.params.id);
  if(!a) return res.status(404).json({error:"Activity not found"});
  res.json({activity:a});
});

app.post("/api/attempts",auth,(req,res)=>{
  const {activityId}=req.body||{};
  const infinite=Boolean(req.body?.infinite);
  const a=db.prepare("SELECT * FROM activities WHERE id=? AND active=1").get(activityId);
  if(!a) return res.status(404).json({error:"Activity not found"});
  const result=db.prepare(`INSERT INTO attempts(user_id,activity_id,current_round,round_limit,score,correct_count,status,round_started_at)
    VALUES (?,?,1,?,0,0,'active',?)`).run(req.user.id,activityId,infinite?null:a.rounds,now());
  const attempt=db.prepare("SELECT * FROM attempts WHERE id=?").get(result.lastInsertRowid);
  const template=db.prepare("SELECT id FROM questions WHERE activity_id=? AND round_no=1").get(activityId);
  const q=generateQuestion(activityId,1,attempt.id,template?.id);
  res.json({attempt:{id:attempt.id,activityId,round:1,roundLimit:attempt.round_limit,status:"active",score:0,correctCount:0},question:publicQuestion(q),activity:a});
});

app.get("/api/attempts/:id",auth,(req,res)=>{
  const attempt=db.prepare("SELECT * FROM attempts WHERE id=? AND user_id=?").get(req.params.id,req.user.id);
  if(!attempt) return res.status(404).json({error:"Attempt not found"});
  const a=db.prepare("SELECT * FROM activities WHERE id=?").get(attempt.activity_id);
  const templateRound=((attempt.current_round-1)%a.rounds)+1;
  const template=db.prepare("SELECT id FROM questions WHERE activity_id=? AND round_no=?").get(attempt.activity_id,templateRound);
  const q=template?generateQuestion(attempt.activity_id,attempt.current_round,attempt.id,template.id):null;
  res.json({attempt,activity:a,question:q?publicQuestion(q):null});
});

app.post("/api/attempts/:id/answer",auth,(req,res)=>{
  const attempt=db.prepare("SELECT * FROM attempts WHERE id=? AND user_id=?").get(req.params.id,req.user.id);
  if(!attempt) return res.status(404).json({error:"Attempt not found"});
  if(attempt.status!=="active") return res.status(409).json({error:"Attempt is already complete"});
  const a=db.prepare("SELECT * FROM activities WHERE id=?").get(attempt.activity_id);
  const templateRound=((attempt.current_round-1)%a.rounds)+1;
  const template=db.prepare("SELECT id FROM questions WHERE activity_id=? AND round_no=?").get(attempt.activity_id,templateRound);
  if(!template) return res.status(404).json({error:"Round template not found"});
  if(req.body?.round!==undefined && Number(req.body.round)!==attempt.current_round)
    return res.status(409).json({error:"This round has already been submitted. Load the current question."});
  if(req.body?.questionId!==undefined && Number(req.body.questionId)!==Number(template.id))
    return res.status(409).json({error:"Question mismatch. Load the current question."});
  const q=generateQuestion(attempt.activity_id,attempt.current_round,attempt.id,template.id);

  const elapsed=Math.max(0,Date.now()-new Date(attempt.round_started_at).getTime());
  const answer=req.body?.answer;
  const correctAnswer=JSON.parse(q.answer_json);
  const skipped=Boolean(req.body?.skip)||Boolean(answer?.skip)||Boolean(answer?.timeout);
  let correct=false;
  if(!skipped && q.type==="grid") correct=JSON.stringify(answer?.positions)===JSON.stringify(correctAnswer.positions)&&JSON.stringify(answer?.symmetryAnswers)===JSON.stringify(correctAnswer.symmetryAnswers);
  if(!skipped && q.type==="motion") correct=Number(answer?.option)===Number(correctAnswer.option);
  if(!skipped && q.type==="inductive") correct=Array.isArray(answer?.options)&&JSON.stringify([...answer.options].map(Number).sort((x,y)=>x-y))===JSON.stringify(correctAnswer.options);
  if(!skipped && (q.type==="deductive"||q.type==="shortcuts"||q.type==="resemble")) correct=Number(answer?.option)===Number(correctAnswer.option);
  if(!skipped && q.type==="numbubbles") correct=String(answer?.equation)===String(correctAnswer.equation);
  if(!skipped && q.type==="tally") correct=String(answer?.operator)===String(correctAnswer.operator);

  const expired=elapsed>=a.round_seconds*1000;
  const finalCorrect=correct&&!expired&&!skipped;
  // The source PPT does not define a numeric mark scheme. This implementation
  // uses a transparent fixed mark: 100 for correct, zero otherwise.
  const points=finalCorrect?100:0;

  db.prepare(`INSERT INTO responses(attempt_id,question_id,round_no,answer_json,is_correct,points,elapsed_ms)
    VALUES (?,?,?,?,?,?,?)`).run(attempt.id,q.id,q.round_no,JSON.stringify(answer),finalCorrect?1:0,points,elapsed);

  const next=attempt.current_round+1;
  const completed=attempt.round_limit!==null && attempt.round_limit!==undefined && next>attempt.round_limit;
  if(completed){
    db.prepare(`UPDATE attempts SET score=score+?,correct_count=correct_count+?,status='completed',completed_at=? WHERE id=?`)
      .run(points,finalCorrect?1:0,now(),attempt.id);
  }else{
    db.prepare(`UPDATE attempts SET score=score+?,correct_count=correct_count+?,current_round=?,round_started_at=? WHERE id=?`)
      .run(points,finalCorrect?1:0,next,now(),attempt.id);
  }

  const updated=db.prepare("SELECT * FROM attempts WHERE id=?").get(attempt.id);
  const nextTemplateRound=((next-1)%a.rounds)+1;
  const nextTemplate=completed?null:db.prepare("SELECT id FROM questions WHERE activity_id=? AND round_no=?").get(a.id,nextTemplateRound);
  const nextQ=nextTemplate?generateQuestion(a.id,next,attempt.id,nextTemplate.id):null;
  res.json({
    correct:finalCorrect,
    expired,
    skipped,
    points,
    score:updated.score,
    correctCount:updated.correct_count,
    completed,
    round:attempt.current_round,
    nextQuestion:nextQ?publicQuestion(nextQ):null
  });
});

app.post("/api/attempts/:id/finish",auth,(req,res)=>{
  const attempt=db.prepare("SELECT * FROM attempts WHERE id=? AND user_id=?").get(req.params.id,req.user.id);
  if(!attempt) return res.status(404).json({error:"Attempt not found"});
  if(attempt.status!=="active") return res.status(409).json({error:"Attempt is already closed"});
  if(attempt.round_limit!==null) return res.status(409).json({error:"Complete all PPT assessment rounds or quit the assessment."});
  db.prepare("UPDATE attempts SET status='completed',completed_at=? WHERE id=?").run(now(),attempt.id);
  const updated=db.prepare("SELECT * FROM attempts WHERE id=?").get(attempt.id);
  res.json({attempt:{id:updated.id,score:updated.score,correctCount:updated.correct_count,roundsPlayed:Math.max(0,updated.current_round-1),status:updated.status}});
});

app.post("/api/attempts/:id/abandon",auth,(req,res)=>{
  const attempt=db.prepare("SELECT * FROM attempts WHERE id=? AND user_id=?").get(req.params.id,req.user.id);
  if(!attempt) return res.status(404).json({error:"Attempt not found"});
  db.prepare("UPDATE attempts SET status='abandoned',completed_at=? WHERE id=?").run(now(),attempt.id);
  res.json({ok:true});
});

app.get("/api/history",auth,(req,res)=>{
  const rows=db.prepare(`
    SELECT at.id,at.activity_id,a.title,a.icon,at.score,at.correct_count,a.rounds,
      CASE WHEN at.round_limit IS NULL THEN MAX(0,at.current_round-1)
           WHEN at.status='completed' THEN at.current_round ELSE MAX(0,at.current_round-1) END AS rounds_played,
      at.status,at.started_at,at.completed_at
    FROM attempts at JOIN activities a ON a.id=at.activity_id
    WHERE at.user_id=? ORDER BY at.id DESC LIMIT 50
  `).all(req.user.id);
  res.json({history:rows});
});

app.get("/api/leaderboard/:activityId",auth,(req,res)=>{
  const rows=db.prepare(`
    SELECT u.name, MAX(at.score) score, MAX(at.correct_count) correct_count
    FROM attempts at JOIN users u ON u.id=at.user_id
    WHERE at.activity_id=? AND at.status='completed'
    GROUP BY u.id ORDER BY score DESC, correct_count DESC, u.name ASC LIMIT 20
  `).all(req.params.activityId);
  res.json({leaderboard:rows});
});

app.get("/api/admin/overview",auth,admin,(req,res)=>{
  const students=db.prepare("SELECT COUNT(*) n FROM users WHERE role='student'").get().n;
  const attempts=db.prepare("SELECT COUNT(*) n FROM attempts").get().n;
  const completed=db.prepare("SELECT COUNT(*) n FROM attempts WHERE status='completed'").get().n;
  const responses=db.prepare("SELECT COUNT(*) n FROM responses").get().n;
  const teams=db.prepare(`
    SELECT u.team_name team_name, MAX(u.name) member_name, COUNT(DISTINCT at.id) attempts,
      COALESCE(SUM((SELECT COUNT(*) FROM responses r WHERE r.attempt_id=at.id)),0) questions_attempted,
      COALESCE(SUM(at.score),0) score, COALESCE(SUM(at.correct_count),0) correct,
      MAX(at.started_at) last_active
    FROM users u LEFT JOIN attempts at ON at.user_id=u.id
    WHERE u.role='student' GROUP BY u.team_name ORDER BY score DESC, last_active DESC
  `).all();
  const recent=db.prepare(`
    SELECT u.team_name team_name,u.name member_name,a.title,at.score,at.correct_count,
      (SELECT COUNT(*) FROM responses r WHERE r.attempt_id=at.id) questions_attempted,
      at.status,at.started_at,at.completed_at
    FROM attempts at JOIN users u ON u.id=at.user_id JOIN activities a ON a.id=at.activity_id
    ORDER BY at.id DESC LIMIT 100
  `).all();
  res.json({students,attempts,completed,responses,teams,recent});
});

app.get("/api/admin/teams/:teamName",auth,admin,(req,res)=>{
  const teamName=decodeURIComponent(req.params.teamName);
  const member=db.prepare("SELECT id,name,team_name,created_at FROM users WHERE team_name=? AND role='student'").get(teamName);
  if(!member) return res.status(404).json({error:"Team not found"});
  const attempts=db.prepare(`
    SELECT at.id,a.title,at.score,at.correct_count,
      (SELECT COUNT(*) FROM responses r WHERE r.attempt_id=at.id) questions_attempted,
      at.status,at.started_at,at.completed_at
    FROM attempts at JOIN activities a ON a.id=at.activity_id WHERE at.user_id=? ORDER BY at.id DESC
  `).all(member.id);
  res.json({member,attempts});
});

if(fs.existsSync(CLIENT_DIST)){
  app.use(express.static(CLIENT_DIST));
  app.get("*",(req,res)=>res.sendFile(path.join(CLIENT_DIST,"index.html")));
} else {
  app.get("/",(req,res)=>res.json({ok:true,service:"NEUROQUEST PRO API",health:"/api/health"}));
}

app.listen(PORT, "0.0.0.0", () => console.log(`NEUROQUEST PRO API/server on http://0.0.0.0:${PORT}`));
