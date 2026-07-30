/* ==================================================================
   DATA MODEL (schema 6)
   Every entity carries a permanent id. Names are only labels, so
   renaming anything never breaks scores, history or references.

   classes  { clsId: {id,name,grade, students:[{id,name}],
                      absent:[stuId], picked:[stuId],
                      scores:{stuId:{pts,ok,no}}, groupState:null|{…}} }
   subjects { subjId:{id,name, grades:{ "7": { topics:{
                topicId:{id,name,
                         questions:{easy|medium|hard:[{id,q,a}]},
                         usedQ:{easy|medium|hard:[qId]}} }}}} }
   attempts [ {ts, clsId,clsName, gradeKey, subjId,subjName,
               topicId,topicName, level, stuId,stuName,
               qId,qText, correct} ]        ids link, names are a fallback
================================================================== */
const SCHEMA = 6;
const LVL = { easy:{name:'Easy',pts:10,color:'#2e8fb5'}, medium:{name:'Medium',pts:20,color:'#e0a422'}, hard:{name:'Hard',pts:30,color:'#d95f83'} };
const LEVELS = ['easy','medium','hard'];
const emptyQ = () => ({ easy:[], medium:[], hard:[] });

function newId(p){ return p+'_'+Math.random().toString(36).slice(2,9)+Date.now().toString(36).slice(-3); }

let S = {
  schemaVersion: SCHEMA,
  classes: {},
  subjects: {},
  activeClass: null,      // clsId
  activeSubject: null,    // subjId
  activeTopic: null,      // topicId (quiz screen)
  edGrade: null,          // grade key in the Question Banks tab
  edTopic: null,          // topicId in the Question Banks tab
  timers: { easy:20, medium:30, hard:45 },
  sound: true,
  trash: [],
  lastBackup: null,
  attempts: [],
  quiz: { mode:'individual', levelPick:'wheel', groups:3, beatSeconds:60 }
};
let undoStack = [];

/* ---------- accessors ---------- */
const cls  = () => S.activeClass   ? S.classes[S.activeClass]   : null;
const sub  = () => S.activeSubject ? S.subjects[S.activeSubject] : null;
function firstKey(o){ return o ? Object.keys(o)[0]||null : null; }
function gradeFromName(name){ const m=String(name).match(/\d+/); return m?m[0]:String(name).trim(); }
function allGrades(){
  const set=new Set();
  Object.values(S.classes).forEach(c=>{ if(c.grade&&String(c.grade).trim()) set.add(String(c.grade).trim()); });
  return [...set].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
}
function quizGradeObj(){ const c=cls(), s=sub(); return (c&&s) ? (s.grades[c.grade]||null) : null; }
function quizTopic(){ const g=quizGradeObj(); return (g&&S.activeTopic&&g.topics[S.activeTopic]) ? g.topics[S.activeTopic] : null; }
const edGradeObj = () => (sub()&&S.edGrade&&sub().grades[S.edGrade]) ? sub().grades[S.edGrade] : null;
const edTopicObj = () => (edGradeObj()&&S.edTopic&&edGradeObj().topics[S.edTopic]) ? edGradeObj().topics[S.edTopic] : null;
/* students */
function stuById(c,id){ return (c&&c.students||[]).find(s=>s.id===id)||null; }
function stuName(c,id){ const s=stuById(c,id); return s?s.name:'(removed)'; }
function presentIds(c){ return (c.students||[]).filter(s=>!(c.absent||[]).includes(s.id)).map(s=>s.id); }

/* ================== STORAGE ==================
   Saves are debounced: a burst of changes becomes one write instead of
   dozens, which matters both for localStorage speed and for a database. */
const KEY='quiz-state-v6';
async function storeSet(k,v){
  let ok=false;
  try{ if(window.storage){ await window.storage.set(k,v); ok=true; } }catch(e){}
  if(!ok){ try{ localStorage.setItem(k,v); }catch(e){ console.warn('save failed',e); } }
}
async function storeGet(k){
  try{ if(window.storage){ const r=await window.storage.get(k); if(r&&r.value) return r.value; } }catch(e){}
  try{ return localStorage.getItem(k); }catch(e){}
  return null;
}
let _saveTimer=null, _savePending=false;
function save(){ _savePending=true; clearTimeout(_saveTimer); _saveTimer=setTimeout(flushSave,350); }
async function flushSave(){
  if(!_savePending) return;
  _savePending=false;
  await storeSet(KEY, JSON.stringify(S));
}
window.addEventListener('beforeunload',()=>{           // never lose the last few changes
  if(_savePending){ try{ localStorage.setItem(KEY, JSON.stringify(S)); }catch(e){} }
});

/* ---------- migration from the old name-keyed format ---------- */
function migrateToV6(old){
  const N={ schemaVersion:SCHEMA, classes:{}, subjects:{},
    activeClass:null, activeSubject:null, activeTopic:null, edGrade:null, edTopic:null,
    timers: old.timers||{easy:20,medium:30,hard:45},
    sound: old.sound!==false,
    trash: [],                                  // old trash entries referenced names; start clean
    lastBackup: old.lastBackup||null,
    attempts: [],
    quiz: old.quiz||{mode:'individual',levelPick:'wheel',groups:3,beatSeconds:60} };

  const clsIdByName={}, stuIdByKey={}, subjIdByName={}, topicIdByKey={};

  Object.entries(old.classes||{}).forEach(([name,c])=>{
    const id=newId('c'); clsIdByName[name]=id;
    const students=(c.students||[]).map(n=>{
      const sid=newId('s'); stuIdByKey[name+'\u0000'+n]=sid; return {id:sid,name:n};
    });
    const byName={}; students.forEach(s=>byName[s.name]=s.id);
    const scores={};
    Object.entries(c.scores||{}).forEach(([n,v])=>{ if(byName[n]) scores[byName[n]]=v; });
    N.classes[id]={ id, name, grade:c.grade||gradeFromName(name), students,
      absent:(c.absent||[]).map(n=>byName[n]).filter(Boolean),
      picked:(c.picked||[]).map(n=>byName[n]).filter(Boolean),
      scores, groupState:null };
  });

  Object.entries(old.subjects||{}).forEach(([sname,sj])=>{
    const sid=newId('u'); subjIdByName[sname]=sid;
    const grades={};
    Object.entries(sj.grades||{}).forEach(([g,go])=>{
      const topics={};
      Object.entries(go.topics||{}).forEach(([tname,t])=>{
        const tid=newId('t'); topicIdByKey[sname+'\u0000'+g+'\u0000'+tname]=tid;
        const questions=emptyQ();
        LEVELS.forEach(l=>((t.questions&&t.questions[l])||[]).forEach(q=>{
          questions[l].push({ id:newId('q'), q:q.q, a:q.a||'' });
        }));
        topics[tid]={ id:tid, name:tname, questions, usedQ:emptyQ() };
      });
      grades[g]={ topics };
    });
    N.subjects[sid]={ id:sid, name:sname, grades };
  });

  /* keep the report history, linking it to the new ids where possible */
  N.attempts=(old.attempts||[]).map(a=>({
    ts:a.ts,
    clsId:clsIdByName[a.cls]||null, clsName:a.cls||'',
    gradeKey:a.grade||'',
    subjId:subjIdByName[a.subject]||null, subjName:a.subject||'',
    topicId:topicIdByKey[a.subject+'\u0000'+a.grade+'\u0000'+a.topic]||null, topicName:a.topic||'',
    level:a.level||'easy',
    stuId:stuIdByKey[a.cls+'\u0000'+a.student]||null, stuName:a.student||'',
    qId:null, qText:a.q||'',
    correct:!!a.correct
  }));

  N.activeClass   = clsIdByName[old.activeClass]   || firstKey(N.classes);
  N.activeSubject = subjIdByName[old.activeSubject]|| firstKey(N.subjects);
  return N;
}

const SAMPLE = () => {
  const qs = (arr)=>arr.map(([q,a])=>({id:newId('q'),q,a}));
  const tid1=newId('t');
  const sid=newId('u');
  return { [sid]: { id:sid, name:'General Knowledge', grades:{ '6':{ topics:{
    [tid1]:{ id:tid1, name:'Nature & Science',
      questions:{
        easy: qs([['How many days are there in a week?','7'],['What colour do you get when you mix blue and yellow?','Green']]),
        medium: qs([['At what temperature does water boil?','100°C / 212°F']]),
        hard: qs([['In which organelle does photosynthesis take place?','Chloroplast']])
      },
      usedQ: emptyQ() }
  } } } } };
};

async function load(){
  const v=await storeGet(KEY);
  if(v){ try{ S=Object.assign(S,JSON.parse(v)); ensureActive(); return; }catch(e){} }
  for(const oldKey of ['quiz-state-v5','quiz-state-v4','quiz-state-v3']){
    const raw=await storeGet(oldKey);
    if(raw){
      try{
        let o=JSON.parse(raw);
        o.subjects=normaliseOldSubjects(o.subjects,o.classes);
        S=migrateToV6(o);
        ensureActive(); save();
        setTimeout(()=>showToast('Your data was upgraded to the new format ✔'),1200);
        return;
      }catch(e){ console.warn('migration failed',e); }
    }
  }
  S.subjects=SAMPLE();
  S.activeSubject=firstKey(S.subjects);
  ensureActive();
}
/* older files kept questions directly on the subject or under no grade */
function normaliseOldSubjects(subjects, classes){
  const out={};
  Object.keys(subjects||{}).forEach(n=>{
    const sj=subjects[n];
    if(sj.grades) out[n]=sj;
    else if(sj.topics) out[n]={grades:{'General':{topics:sj.topics}}};
    else if(sj.questions) out[n]={grades:{'General':{topics:{'All Topics':{questions:sj.questions,usedQ:emptyQ()}}}}};
  });
  Object.keys(classes||{}).forEach(n=>{ if(!classes[n].grade) classes[n].grade='General'; });
  return out;
}

function ensureActive(){
  if(!S.classes) S.classes={}; if(!S.subjects) S.subjects={};
  if(S.activeClass && !S.classes[S.activeClass]) S.activeClass=null;
  if(!S.activeClass) S.activeClass=firstKey(S.classes);
  if(S.activeSubject && !S.subjects[S.activeSubject]) S.activeSubject=null;
  if(!S.activeSubject) S.activeSubject=firstKey(S.subjects);
  const g=quizGradeObj();
  if(!g || !S.activeTopic || !g.topics[S.activeTopic]) S.activeTopic = g?firstKey(g.topics):null;
  const grades=allGrades();
  if(!S.edGrade || !grades.includes(S.edGrade)) S.edGrade=grades[0]||null;
  if(!edGradeObj() || !S.edTopic || !edGradeObj().topics[S.edTopic]) S.edTopic = edGradeObj()?firstKey(edGradeObj().topics):null;
}

/* ================== SOUND ================== */
const MY_SOUNDS = {
  spin:    "data:audio/mpeg;base64,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C2S9ISMEeEF0AB3AEYwBqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//tixIcDwAABpAAAACAAADSAAAAEqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqg==",   // the fun tune while student names are spinning
  correct: "data:audio/mpeg;base64,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TApiU+dwtFDCUJv9KzOFU3z+aYUXKn02WeW13bxqUylcVLoGadTgqkbKGV91SV5SUrdBr0KsZh3dgQrqGokp3scKGJuKTGZaM6s08h2pN0jgEKem/S7Uo1E44vW5kOhAEErDARrrVCgKquFEl+qwwwEqhSpUtmMMKZtW/16vAL6Sr3WMzN6qqr9h8QghDCuFcsLEKITIQV+qk0ZmZm2wqlP9mnqGFRQpcpH/+2DE7IIQJNsQBKDQCbob4hiTDXiX5r9E57c2U2qhSNmXYMc4KVBQNCJb54fzpZwdxm8Fe68S1UxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVAURlmRkQ/IyWy/2Wy/LAdn8st///v/2Sz+UFLPssj/8s//9bL/ZbHlihgYNH7LAdT/sP//rSz+WSz7LATl9liH/+qy/1goWPLFDAwYRioqSxbywqyIRQWiwsK1ipBUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+2DE7IETufMAJhh7CbWyX1gwj8hVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+2DEtoPLsaDEIIBuQAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+2LEhwPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//tgxIeDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//tgxIeDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//tgxIeDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV",   // applause when the answer is correct  (+ confetti)
  wrong:   "data:audio/mpeg;base64,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bbbbbBKJAepQsUeAa4Y1Mm+UiyXuUBopS5tlFVQGluNBwsTMw0CMlcTaHGfPtQi5bZjKLckVCy7xbLpZUO9+r2E+tuvzWdyV00z6urVg69fn11Fezxo0G1t7tCx///9xpor02sNRYGvSBjEAmzAqCoNPZ89MHaQ4MR2VANBCaHnB5oCxVW5B5TZ+sIk/0uv/+2DECgPMSGMGPYMAAAAANIAAAASxmzNQ0icFEt9EiUsSJJbJEjTzn8kSOmkZcs6JTvxEHBE9QNDAaf8FVnZUNiV0S9R7UDQwO1HhEe+VOiWsFR4K/g1yx4RYi/wV87/Ue4iVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+2LEUIPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//tgxIeDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV",   // the donk-zonk buzzer when the answer is wrong
  tick:    "data:audio/mpeg;base64,//tQxAAABuQBcTQRgAHkGi+7HpAAllUBQGnB8Th95c/B98EAQBAyJwf8Hw/WD+D4f6gQBCCAY/4Pv/wQMg+D5//wQ//+CAYyhz+BDiGyKsIgABmpEYwySwSqHq71Z1YiMJRwWmcWE7E64QHY0RyAq2oicHhVTBtxCkudWYcnE5aSTKT8l+lk78YQ8urueG7Oksmluzm3OcJZ/V+vHK30+4YkFx0OvQw0RJpQ0QoSQufz02XNgsg0gWJrcQLCz8WXLegf//aq8llsAFgE8ApKEv/7UsQFAAt8j2d8xAABb5TquPQJ8IQi0yWlpSFwpOTsdVCU9GmhyBG1amoaanA0Vpr2i9rUcdKShPOpUrHSP1sUdgGRUBap2Ijxp4dASsySW4NNVWVM5Wrc3Vsx29NlSbLTtaVAFl7udKzMIDIEAF+XZbRcU6oVhRIpqWlQr1SnXhlOAroCofyaxVlW3Nbw4qa3BSqqNsc+zM35VN8rZasblFRFgwDR0FfgyJVHlXhoq4fRpPPJ9cOkuVo9bolyw/xKWhZq9SQIQATEVoch2IYB//tSxAcAS2RXO4CwwYFUmGJAYQ5AXBxEmsQ4lgQjYlM/BUZl5qqOo7Zl8lqdFIVAQNA0HFhJ5YBBUsHQ2VIljQlOkgoerOywFiLUvh1hO5SA0RLEsRLdU8iIVlnq1fair8tMAI8iaRx60FGvAMkdmlErI5RQonVYdbaozGAuQY11VQwq7edDCjlL27sflP4xrHbsYwF0r6jx3uFzq5YBQ0elTpUiGmlanpBXWEg6oqnEQ6BVPqeJagqH8Rk00RnZcyOz/llkpGTKwMGIwyZ///H/+1LEDIPGhJK+QIBpwAAANIAAAARhUiZGN4qLIeKihI0BRUWJGv+LC+sVFpoKigtVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVQ==",   // clock tick during the last 5 seconds
  timeUp:  ""    // played when the timer reaches zero
};
const SOUND_VOLUME = 0.7;          // 0.0 = silent, 1.0 = full volume
const _audioCache={};
function playFile(src,rate){
  if(!S.sound||!src) return false;
  try{
    let a=_audioCache[src];
    if(!a){ a=new Audio(src); a.volume=SOUND_VOLUME; _audioCache[src]=a; }
    a.playbackRate=rate||1; a.currentTime=0; a.play().catch(()=>{});
    return true;
  }catch(e){ return false; }
}
function stopFile(src){ const a=_audioCache[src]; if(a){ try{a.pause();a.currentTime=0;}catch(e){} } }
let AC=null;
function ac(){ if(!AC) AC=new (window.AudioContext||window.webkitAudioContext)(); return AC; }
function tone(freq,start,dur,type='sine',vol=.25){
  if(!S.sound) return;
  const c=ac(),o=c.createOscillator(),g=c.createGain();
  o.type=type;o.frequency.value=freq;o.connect(g);g.connect(c.destination);
  const t=c.currentTime+start;
  g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(vol*SOUND_VOLUME,t+.02);
  g.gain.exponentialRampToValueAtTime(.001,t+dur);
  o.start(t);o.stop(t+dur+.05);
}
const sndCorrect=()=>{ if(playFile(MY_SOUNDS.correct))return; [523,659,784,1047].forEach((f,i)=>tone(f,i*.12,.35,'triangle')); };
const sndWrong  =()=>{ if(playFile(MY_SOUNDS.wrong))return;   tone(200,0,.5,'sawtooth',.2);tone(150,.05,.55,'sawtooth',.2); };
const sndTimeUp =()=>{ if(playFile(MY_SOUNDS.timeUp))return;  [440,440,330].forEach((f,i)=>tone(f,i*.18,.15,'square',.15)); };
let _tock=false;
const sndTick=()=>{ _tock=!_tock; if(playFile(MY_SOUNDS.tick,_tock?1:0.88))return; tone(_tock?900:760,0,.06,'square',.08); };
const sndSpinStart=()=>{ if(!playFile(MY_SOUNDS.spin)) tone(660,0,.05,'square',.06); };
const sndSpinStop =()=>stopFile(MY_SOUNDS.spin);
const sndPick=()=>{ if(MY_SOUNDS.spin) return; tone(600+Math.random()*300,0,.05,'square',.06); };

/* ================== SMALL HELPERS ================== */
function esc(s){ const d=document.createElement('div'); d.textContent=s==null?'':s; return d.innerHTML; }
function mkIco(txt,title,fn){
  const b=document.createElement('button'); b.className='icoBtn'; b.textContent=txt; b.title=title;
  b.onclick=ev=>{ ev.stopPropagation(); fn(); };
  return b;
}
function topicQCount(t){ return LEVELS.reduce((a,l)=>a+t.questions[l].length,0); }
function gradeQCount(g){ return Object.values(g.topics).reduce((a,t)=>a+topicQCount(t),0); }
function subjectQCount(s){ return Object.values(s.grades).reduce((a,g)=>a+gradeQCount(g),0); }
function subjByName(name){ return Object.values(S.subjects).find(s=>s.name===name)||null; }
function classByName(name){ return Object.values(S.classes).find(c=>c.name===name)||null; }

/* ================== STYLED DIALOGS ================== */
const mBack=document.getElementById('modalBack'),mTitle=document.getElementById('mTitle'),
      mMsg=document.getElementById('mMsg'),mInput=document.getElementById('mInput'),
      mOk=document.getElementById('mOk'),mCancel=document.getElementById('mCancel'),
      mArea=document.getElementById('mArea');
let mResolve=null,mMode='none';
function mClose(val){ mBack.classList.remove('show'); const r=mResolve; mResolve=null; if(r)r(val); }
mOk.onclick=()=>mClose(mMode==='input'?mInput.value:mMode==='area'?mArea.value:true);
mCancel.onclick=()=>mClose(mMode==='none'?false:null);
mBack.addEventListener('mousedown',e=>{ if(e.target===mBack) mCancel.click(); });
document.addEventListener('keydown',e=>{
  if(!mBack.classList.contains('show'))return;
  if(e.key==='Enter'){ if(e.target===mArea) return; e.preventDefault(); mOk.click(); }
  if(e.key==='Escape'){ e.preventDefault(); mCancel.click(); }
});
function dlg({title,msg='',input=false,area=false,def='',ok='OK',cancel='Cancel',showCancel=true,placeholder=''}){
  return new Promise(res=>{
    mResolve=res; mMode=area?'area':(input?'input':'none');
    mTitle.textContent=title||'';
    mMsg.textContent=msg; mMsg.style.display=msg?'block':'none';
    mInput.style.display=input?'block':'none'; mInput.value=def||'';
    mArea.style.display=area?'block':'none'; mArea.value=''; mArea.placeholder=placeholder;
    mOk.textContent=ok;
    mCancel.style.display=showCancel?'inline-block':'none'; mCancel.textContent=cancel;
    mBack.classList.add('show');
    if(input) setTimeout(()=>{mInput.focus();mInput.select();},60);
    if(area) setTimeout(()=>mArea.focus(),60);
  });
}
function splitMsg(m){ const p=String(m).split('\n'); return [p[0],p.slice(1).join('\n')]; }
function uiAlert(m){ const [t,x]=splitMsg(m); return dlg({title:t,msg:x,showCancel:false,ok:'OK'}); }
function uiConfirm(m){ const [t,x]=splitMsg(m); return dlg({title:t,msg:x,ok:'Yes',cancel:'Cancel'}); }
function uiPrompt(m,def=''){ const [t,x]=splitMsg(m); return dlg({title:t,msg:x,input:true,def,ok:'Save'}); }
function uiTextarea(m,ph=''){ const [t,x]=splitMsg(m); return dlg({title:t,msg:x,area:true,ok:'Add All',placeholder:ph}); }

/* ================== TRASH & UNDO ================== */
const TRASH_DAYS=30;
function pruneTrash(){
  const cut=Date.now()-TRASH_DAYS*86400000, n=S.trash.length;
  S.trash=S.trash.filter(t=>t.ts>=cut);
  return n!==S.trash.length;
}
function recordDelete(kind,label,data,undo){
  const e={ id:newId('d'), kind, label, data, ts:Date.now() };
  S.trash.unshift(e);
  if(S.trash.length>200) S.trash.length=200;
  undoStack.push({entryId:e.id,undo});
  if(undoStack.length>30) undoStack.shift();
  save(); showToast(`Deleted: ${label}`,'↩ Undo',doUndo,6000);
}
function doUndo(){
  const last=undoStack.pop(); if(!last) return false;
  const i=S.trash.findIndex(t=>t.id===last.entryId);
  const label=i>=0?S.trash[i].label:'';
  if(i>=0) S.trash.splice(i,1);
  try{ last.undo(); }catch(e){}
  ensureActive(); save(); refreshAll();
  if(label) showToast(`Restored: ${label} ↩`);
  return true;
}
let toastTimer=null;
function showToast(msg,actionLabel,actionFn,ms=4500){
  let t=document.getElementById('toast');
  if(!t){
    t=document.createElement('div'); t.id='toast';
    t.style.cssText='position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:120;'+
      'background:var(--ink);color:#fff;padding:12px 16px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.25);'+
      'display:flex;align-items:center;gap:14px;font-family:Nunito;font-weight:700;font-size:.95rem;max-width:92vw';
    document.body.appendChild(t);
  }
  t.innerHTML=`<span>${msg}</span>`;
  if(actionLabel){
    const b=document.createElement('button');
    b.textContent=actionLabel;
    b.style.cssText='background:var(--yellow);color:var(--ink);border:none;border-radius:8px;padding:6px 12px;font-family:Nunito;font-weight:800;cursor:pointer';
    b.onclick=()=>{ clearTimeout(toastTimer); t.style.display='none'; actionFn&&actionFn(); };
    t.appendChild(b);
  }
  t.style.display='flex';
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>{t.style.display='none';},ms);
}
document.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){
    const tag=(e.target.tagName||'').toLowerCase();
    if(tag==='input'||tag==='textarea') return;
    e.preventDefault(); doUndo();
  }
});
function refreshAll(){
  renderClasses(); renderBank(); renderScores();
  if(document.getElementById('tab-quiz').classList.contains('show')){ renderSelectors(); showIdle(); }
  if(document.getElementById('tab-backup').classList.contains('show')) renderTrash();
  if(document.getElementById('tab-reports').classList.contains('show')) renderReports();
}

/* ================== FULLSCREEN & TABS ================== */
document.getElementById('fsBtn').onclick=()=>{
  if(!document.fullscreenElement) document.documentElement.requestFullscreen().catch(()=>{});
  else document.exitFullscreen();
};
document.addEventListener('fullscreenchange',()=>{
  document.getElementById('fsBtn').textContent=document.fullscreenElement?'🗗':'⛶';
});
document.querySelectorAll('nav button').forEach(b=>{
  b.onclick=()=>{
    document.querySelectorAll('nav button').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    document.querySelectorAll('section').forEach(s=>s.classList.remove('show'));
    document.getElementById('tab-'+b.dataset.tab).classList.add('show');
    const t=b.dataset.tab;
    if(t==='board') renderScores();
    if(t==='reports') renderReports();
    if(t==='classes') renderClasses();
    if(t==='questions') renderBank();
    if(t==='quiz'){ renderSelectors(); showIdle(); }
    if(t==='backup'){ renderBackupStatus(); renderTrash(); }
  };
});

/* ================== CLASSES ================== */
function addClassNames(names){
  let added=0, skipped=[];
  names.map(s=>s.trim()).filter(Boolean).forEach(n=>{
    if(classByName(n)){ skipped.push(n); return; }
    const id=newId('c');
    S.classes[id]={ id, name:n, grade:gradeFromName(n), students:[], absent:[], picked:[], scores:{}, groupState:null };
    if(!S.activeClass) S.activeClass=id;
    added++;
  });
  if(added){ ensureActive(); save(); renderClasses(); }
  return {added,skipped};
}
function addClass(){
  const inp=document.getElementById('clsInput');
  if(!inp.value.trim()) return;
  const r=addClassNames(inp.value.split(','));
  inp.value='';
  if(r.skipped.length) uiAlert(`Already existed: ${r.skipped.join(', ')}`);
}
document.getElementById('clsAdd').onclick=addClass;
document.getElementById('clsInput').addEventListener('keydown',e=>{ if(e.key==='Enter') addClass(); });
document.getElementById('clsBulk').onclick=async ()=>{
  const txt=await uiTextarea('Bulk add classes\nOne class per line — the grade of each is detected from its name (7-A → Grade 7).','7-A\n7-B\n8-A\n9-C\n10-B');
  if(!txt||!txt.trim()) return;
  const r=addClassNames(txt.split('\n'));
  const grades=allGrades();
  uiAlert(`Added ${r.added} class${r.added===1?'':'es'} ✔\nGrades ready for question banks: ${grades.join(', ')}${r.skipped.length?`\nAlready existed: ${r.skipped.join(', ')}`:''}`);
};

function renderClasses(){
  const el=document.getElementById('clsList');
  const list=Object.values(S.classes);
  el.innerHTML=list.length?'':'<p class="hint" style="margin-top:10px">No classes yet. Add your first one 👆</p>';
  list.forEach(c=>{
    const d=document.createElement('div');
    d.className='itemCard'+(S.activeClass===c.id?' sel':'');
    d.innerHTML=`${S.activeClass===c.id?'<span class="selBadge">✔</span>':'<span style="width:18px"></span>'}
      <span class="name">${esc(c.name)} <span class="gradeBadge">Grade ${esc(c.grade||'?')}</span></span>
      <span class="meta">${c.students.length} student${c.students.length===1?'':'s'}</span>`;
    d.onclick=()=>{ S.activeClass=c.id; ensureActive(); save(); renderClasses(); };
    d.appendChild(mkIco('🎓','Change grade',async ()=>{
      const g=await uiPrompt(`Grade for class "${c.name}":`,c.grade||'');
      if(g===null) return;
      c.grade=g.trim(); ensureActive(); save(); renderClasses();
    }));
    d.appendChild(mkIco('✏️','Rename',async ()=>{
      const nn=await uiPrompt('New class name:',c.name);
      if(!nn||!nn.trim()||nn.trim()===c.name) return;
      const t=nn.trim();
      if(classByName(t)){ uiAlert('A class with this name already exists.'); return; }
      c.name=t; c.grade=gradeFromName(t);   // id never changes, so history is safe
      ensureActive(); save(); renderClasses(); renderSelectors();
    }));
    d.appendChild(mkIco('🗑','Delete class',async ()=>{
      if(!await uiConfirm(`Delete class "${c.name}"?\nIt goes to the Trash and you can undo right away.`)) return;
      const snap=JSON.parse(JSON.stringify(c));
      delete S.classes[c.id];
      if(S.activeClass===c.id) S.activeClass=firstKey(S.classes);
      ensureActive();
      recordDelete('class',`Class "${c.name}"`,{cls:snap},()=>{ S.classes[snap.id]=snap; });
      renderClasses();
    }));
    el.appendChild(d);
  });
  renderStudents();
}

/* ================== STUDENTS ================== */
function addStudents(){
  const c=cls(); if(!c) return;
  const inp=document.getElementById('stuInput');
  let added=0;
  inp.value.split(',').map(s=>s.trim()).filter(Boolean).forEach(n=>{
    if(c.students.some(s=>s.name===n)) return;
    c.students.push({ id:newId('s'), name:n }); added++;
  });
  inp.value=''; inp.focus();
  if(added){ save(); renderStudents(); }
}
document.getElementById('stuAdd').onclick=addStudents;
document.getElementById('stuInput').addEventListener('keydown',e=>{ if(e.key==='Enter') addStudents(); });
document.getElementById('stuClear').onclick=async ()=>{
  const c=cls(); if(!c) return;
  if(!await uiConfirm('Clear the whole student list?')) return;
  const snap={ students:[...c.students], absent:[...c.absent], picked:[...c.picked], scores:JSON.parse(JSON.stringify(c.scores)) };
  const cid=c.id, n=c.students.length;
  c.students=[]; c.absent=[]; c.picked=[];
  recordDelete('students',`Student list of "${c.name}" (${n})`,{cid,snap},()=>{
    const t=S.classes[cid]; if(t){ t.students=snap.students; t.absent=snap.absent; t.picked=snap.picked; t.scores=snap.scores; }
  });
  renderStudents();
};
function renderStudents(){
  const card=document.getElementById('stuCard');
  const c=cls();
  if(!c){ card.style.display='none'; return; }
  card.style.display='block';
  document.getElementById('stuTitle').textContent=`${c.name} · Students`;
  const present=presentIds(c).length;
  document.getElementById('attnLine').innerHTML = c.students.length
    ? `Present today: <b>${present}</b> / ${c.students.length}. Tap a name to mark it absent — absent students are skipped in the quiz.` : '';
  const el=document.getElementById('stuList');
  el.innerHTML=c.students.length?'':'<p class="hint">No students yet. Add some above 👆</p>';
  c.students.forEach(s=>{
    const absent=c.absent.includes(s.id);
    const ch=document.createElement('div');
    ch.className='chip'+(c.picked.includes(s.id)?' done':'')+(absent?' absent':'');
    const nm=document.createElement('span');
    nm.textContent=s.name; nm.style.cursor='pointer';
    nm.title=absent?'Tap to mark present':'Tap to mark absent';
    nm.onclick=()=>{
      if(absent) c.absent=c.absent.filter(x=>x!==s.id); else c.absent.push(s.id);
      save(); renderStudents();
    };
    ch.appendChild(nm);
    if(absent){ const tg=document.createElement('span'); tg.className='absentTag'; tg.textContent='absent'; ch.appendChild(tg); }
    const e=document.createElement('button'); e.textContent='✏️'; e.title='Edit name'; e.className='edit';
    e.onclick=async ()=>{
      const nn=await uiPrompt('Edit student name:',s.name);
      if(!nn||!nn.trim()||nn.trim()===s.name) return;
      const t=nn.trim();
      if(c.students.some(x=>x.name===t&&x.id!==s.id)){ uiAlert('A student with this name already exists.'); return; }
      s.name=t;                    // id unchanged → scores AND report history follow along
      save(); renderStudents();
    };
    const x=document.createElement('button'); x.textContent='×'; x.title='Remove';
    x.onclick=async ()=>{
      if(!await uiConfirm(`Remove "${s.name}" from the list?`)) return;
      const snap={ stu:{...s}, pos:c.students.findIndex(y=>y.id===s.id), score:c.scores[s.id]||null, cid:c.id };
      c.students=c.students.filter(y=>y.id!==s.id);
      c.absent=c.absent.filter(y=>y!==s.id);
      c.picked=c.picked.filter(y=>y!==s.id);
      recordDelete('student',`Student "${s.name}"`,snap,()=>{
        const t=S.classes[snap.cid]; if(!t) return;
        t.students.splice(Math.min(snap.pos,t.students.length),0,snap.stu);
        if(snap.score) t.scores[snap.stu.id]=snap.score;
      });
      renderStudents();
    };
    ch.appendChild(e); ch.appendChild(x); el.appendChild(ch);
  });
}

/* ================== QUESTION BANKS ================== */
function renderBank(){
  ensureActive();
  const gSel=document.getElementById('edGradeSel'), sSel=document.getElementById('edSubSel');
  const grades=allGrades(), subs=Object.values(S.subjects);
  gSel.innerHTML=grades.length
    ? grades.map(g=>`<option value="${esc(g)}" ${g===S.edGrade?'selected':''}>Grade ${esc(g)}</option>`).join('')
    : '<option value="">— Add classes first (grades come from them) —</option>';
  sSel.innerHTML=subs.length
    ? subs.map(s=>`<option value="${esc(s.id)}" ${s.id===S.activeSubject?'selected':''}>${esc(s.name)}</option>`).join('')
    : '<option value="">— Click "+ New Subject" —</option>';
  gSel.onchange=()=>{ S.edGrade=gSel.value; S.edTopic=edGradeObj()?firstKey(edGradeObj().topics):null; cancelEdit(); save(); renderBank(); };
  sSel.onchange=()=>{ S.activeSubject=sSel.value; S.edTopic=null; cancelEdit(); ensureActive(); save(); renderBank(); };
  renderTopics();
}

document.getElementById('subNew').onclick=async ()=>{
  const txt=await uiTextarea('New subject\nOne subject per line — add as many as you like at once.','Math\nScience\nEnglish\nComputer Science');
  if(!txt||!txt.trim()) return;
  let added=0, skipped=[];
  txt.split('\n').map(s=>s.trim()).filter(Boolean).forEach(n=>{
    if(subjByName(n)){ skipped.push(n); return; }
    const id=newId('u');
    S.subjects[id]={ id, name:n, grades:{} };
    S.activeSubject=id; added++;
  });
  S.edTopic=null; ensureActive(); save(); renderBank();
  uiAlert(`Added ${added} subject${added===1?'':'s'} ✔${skipped.length?`\nAlready existed: ${skipped.join(', ')}`:''}`);
};
document.getElementById('subRen').onclick=async ()=>{
  const s=sub(); if(!s) return;
  const nn=await uiPrompt('New subject name:',s.name);
  if(!nn||!nn.trim()||nn.trim()===s.name) return;
  const t=nn.trim();
  if(subjByName(t)){ uiAlert('A subject with this name already exists.'); return; }
  s.name=t; save(); renderBank(); renderSelectors();
};
document.getElementById('subDel').onclick=async ()=>{
  const s=sub(); if(!s) return;
  const qc=subjectQCount(s);
  if(!await uiConfirm(`Delete subject "${s.name}"?\nThat is ${qc} question${qc===1?'':'s'} across all its grades and topics. It goes to the Trash.`)) return;
  const snap=JSON.parse(JSON.stringify(s));
  delete S.subjects[s.id];
  S.activeSubject=firstKey(S.subjects); S.edTopic=null;
  ensureActive(); cancelEdit();
  recordDelete('subject',`Subject "${snap.name}" (${qc} questions)`,{subj:snap},()=>{ S.subjects[snap.id]=snap; });
  renderBank();
};
document.getElementById('subCopyGrade').onclick=async ()=>{
  const s=sub(); if(!s||!S.edGrade){ uiAlert('Select a grade and subject first.'); return; }
  const src=edGradeObj();
  if(!src||!Object.keys(src.topics).length){ uiAlert(`Grade ${S.edGrade} has no topics to copy yet.`); return; }
  const others=allGrades().filter(g=>g!==S.edGrade);
  const target=await uiPrompt(`Copy all topics of Grade ${S.edGrade} to which grade?\nAvailable: ${others.join(', ')||'(add more classes to get more grades)'}`,others[0]||'');
  if(!target||!target.trim()) return;
  const tg=target.trim();
  if(tg===S.edGrade){ uiAlert('That is the same grade.'); return; }
  if(!s.grades[tg]) s.grades[tg]={topics:{}};
  let added=0, skipped=0;
  Object.values(src.topics).forEach(t=>{
    if(Object.values(s.grades[tg].topics).some(x=>x.name===t.name)){ skipped++; return; }
    const id=newId('t');
    s.grades[tg].topics[id]=cloneTopic(t,id);
    added++;
  });
  save(); renderBank();
  uiAlert(`Copied ${added} topic${added===1?'':'s'} to Grade ${tg}.${skipped?` (${skipped} skipped — same name already there.)`:''}`);
};
function cloneTopic(t,id){
  const q=emptyQ();
  LEVELS.forEach(l=>t.questions[l].forEach(x=>q[l].push({ id:newId('q'), q:x.q, a:x.a })));
  return { id, name:t.name, questions:q, usedQ:emptyQ() };
}

/* ---- export / import ---- */
function subjectPayload(s){ return { id:s.id, name:s.name, grades:s.grades }; }
function download(name,obj){
  const blob=new Blob([JSON.stringify(obj,null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; a.click();
  URL.revokeObjectURL(a.href);
}
document.getElementById('subExp').onclick=()=>{
  const s=sub(); if(!s) return;
  download(s.name.replace(/[^\w\- ]/g,'').trim().replace(/\s+/g,'-')+'-questions.json',
    { app:'quiz-game-subject', schema:SCHEMA, ...subjectPayload(s) });
};
document.getElementById('subExpAll').onclick=()=>{
  const list=Object.values(S.subjects);
  if(!list.length){ uiAlert('There are no subjects to export yet.'); return; }
  const d=new Date(),p=x=>String(x).padStart(2,'0');
  download(`all-question-banks-${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}.json`,
    { app:'quiz-game-subjects', schema:SCHEMA, subjects:list.map(subjectPayload) });
  uiAlert(`Exported ${list.length} subject${list.length===1?'':'s'} ✔\nQuestions only — no student names or scores.`);
};
document.getElementById('subImp').onclick=()=>document.getElementById('subFile').click();

/* Accepts new (id-based) and all older formats. Merges by NAME, since two
   teachers' files legitimately have different ids for the same subject. */
function gradesFromAnyFormat(d){
  let grades=null;
  if(d.grades) grades=d.grades;
  else if(d.topics) grades={'General':{topics:d.topics}};
  else if(d.questions&&d.questions.easy) grades={'General':{topics:{'All Topics':{questions:d.questions}}}};
  if(!grades) return null;
  const out={};
  Object.entries(grades).forEach(([g,go])=>{
    const topics={};
    Object.entries(go.topics||{}).forEach(([k,t])=>{
      const id=newId('t');
      const q=emptyQ();
      LEVELS.forEach(l=>((t.questions&&t.questions[l])||[]).forEach(x=>q[l].push({id:newId('q'),q:x.q,a:x.a||''})));
      topics[id]={ id, name:t.name||k, questions:q, usedQ:emptyQ() };
    });
    out[g]={topics};
  });
  return out;
}
function mergeIntoSubject(target,grades){
  let nT=0,nQ=0;
  Object.entries(grades).forEach(([g,go])=>{
    if(!target.grades[g]) target.grades[g]={topics:{}};
    const tg=target.grades[g].topics;
    Object.values(go.topics).forEach(src=>{
      let dst=Object.values(tg).find(t=>t.name===src.name);
      if(!dst){ const id=newId('t'); dst={id,name:src.name,questions:emptyQ(),usedQ:emptyQ()}; tg[id]=dst; nT++; }
      LEVELS.forEach(l=>src.questions[l].forEach(q=>{
        if(!dst.questions[l].some(x=>x.q===q.q)){ dst.questions[l].push({id:newId('q'),q:q.q,a:q.a}); nQ++; }
      }));
      dst.usedQ=emptyQ();
    });
  });
  return {nT,nQ};
}
document.getElementById('subFile').onchange=function(){
  const f=this.files[0]; if(!f) return;
  const rd=new FileReader();
  rd.onload=async ()=>{
    try{
      const d=JSON.parse(rd.result);
      const many = Array.isArray(d.subjects) ? d.subjects
                 : (d.subjects&&typeof d.subjects==='object') ? Object.entries(d.subjects).map(([n,v])=>({name:n,...v}))
                 : null;
      if(many){
        const names=many.map(s=>s.name||'Imported');
        const overlap=names.filter(n=>subjByName(n));
        if(!await uiConfirm(`Import ${many.length} subject${many.length===1?'':'s'}?\n${names.join(', ')}${overlap.length?`\n\nAlready yours (${overlap.join(', ')}) will be MERGED — nothing of yours is deleted.`:''}`)) return;
        let nT=0,nQ=0,created=0;
        many.forEach(sj=>{
          const grades=gradesFromAnyFormat(sj); if(!grades) return;
          let target=subjByName(sj.name);
          if(!target){ const id=newId('u'); target={id,name:sj.name||'Imported',grades:{}}; S.subjects[id]=target; created++; }
          const r=mergeIntoSubject(target,grades); nT+=r.nT; nQ+=r.nQ;
          S.activeSubject=target.id;
        });
        S.edTopic=null; ensureActive(); save(); renderBank();
        uiAlert(`Done ✔\n${created} new subject${created===1?'':'s'}, ${nT} new topic${nT===1?'':'s'}, ${nQ} new question${nQ===1?'':'s'}.`);
        return;
      }
      const grades=gradesFromAnyFormat(d);
      if(!grades){ uiAlert('This file is not a question bank.\nIf it is a full backup, use the Backup tab instead.'); return; }
      const name=d.name||'Imported Subject';
      const exists=subjByName(name);
      if(exists){
        const merge=await dlg({ title:`You already have "${name}"`,
          msg:'Merge — adds its new topics and questions into yours (nothing is deleted).\nKeep separate — imports it as a second subject.',
          ok:'Merge', cancel:'Keep separate' });
        if(merge===true){
          const r=mergeIntoSubject(exists,grades);
          S.activeSubject=exists.id; S.edTopic=null; ensureActive(); save(); renderBank();
          uiAlert(`Merged into "${name}" ✔\n${r.nT} new topic${r.nT===1?'':'s'}, ${r.nQ} new question${r.nQ===1?'':'s'}.`);
          return;
        }
      }
      let nm=name; while(subjByName(nm)) nm+=' (copy)';
      const id=newId('u');
      S.subjects[id]={ id, name:nm, grades };
      S.activeSubject=id; S.edTopic=null; ensureActive(); save(); renderBank();
      uiAlert(`Imported "${nm}" ✔`);
    }catch(e){ uiAlert('Could not read this file.'); }
  };
  rd.readAsText(f); this.value='';
};

/* ---- paste a whole plan from Word ---- */
const TXT_MARKERS=[
  ['subject',/^[#*\-\s]*(subject|ders)\s*[:\-]\s*(.+)$/i],
  ['grade',  /^[#*\-\s]*(grade|class|s\u0131n\u0131f|seviye)\s*[:\-]\s*(.+)$/i],
  ['topic',  /^[#*\-\s]*(topic|unit|konu|\u00fcnite|unite)\s*[:\-]\s*(.+)$/i]
];
const TXT_LEVELS=[
  ['easy',  /^[#*\-\s]*(easy|kolay)\s*[:\-]?\s*(\(.*\))?$/i],
  ['medium',/^[#*\-\s]*(medium|orta)\s*[:\-]?\s*(\(.*\))?$/i],
  ['hard',  /^[#*\-\s]*(hard|difficult|zor)\s*[:\-]?\s*(\(.*\))?$/i]
];
function parsePlanText(txt){
  const res={}, warn=[];
  let subject=null, grade=null, topic=null, level='easy', buf=[], count=0;
  const flush=()=>{
    const lines=buf.map(s=>s.trim()).filter(Boolean); buf=[];
    if(!lines.length) return;
    if(!subject||!grade||!topic){ warn.push(`Skipped a question before Subject/Grade/Topic: "${lines[0].slice(0,40)}…"`); return; }
    const bank=res[subject].grades[grade].topics[topic].questions[level];
    const pipes=lines.filter(l=>l.includes('|'));
    if(pipes.length>1 && pipes.length===lines.length){
      lines.forEach(line=>{ const p=line.indexOf('|');
        const q=line.slice(0,p).trim(), a=line.slice(p+1).trim();
        if(q){ bank.push({id:newId('q'),q,a}); count++; } });
      return;
    }
    let ans='', qLines=[];
    lines.forEach(line=>{
      const am=line.match(/^(answer|correct|cevap|do\u011fru cevap)\s*[:\-]\s*(.+)$/i);
      if(am){ ans=am[2].trim(); return; }
      const p=line.indexOf('|');
      if(p>=0){ const b=line.slice(0,p).trim(), a=line.slice(p+1).trim(); if(b)qLines.push(b); if(a)ans=a; }
      else qLines.push(line);
    });
    if(!qLines.length) return;
    bank.push({ id:newId('q'), q:qLines.join('\n'), a:ans }); count++;
  };
  txt.replace(/\r/g,'').split('\n').forEach(raw=>{
    const line=raw.trim();
    if(line.startsWith('//')) return;
    if(/^[=_~\-*]{4,}$/.test(line)) return;
    for(const [kind,re] of TXT_MARKERS){
      const m=line.match(re);
      if(m){
        flush(); const val=m[2].trim();
        if(kind==='subject'){ subject=val; grade=null; topic=null; level='easy';
          if(!res[subject]) res[subject]={grades:{}}; }
        else if(kind==='grade'){
          if(!subject){ warn.push('A Grade line appeared before any Subject line.'); return; }
          grade=(val.match(/\d+/)||[val])[0]; topic=null; level='easy';
          if(!res[subject].grades[grade]) res[subject].grades[grade]={topics:{}}; }
        else{
          if(!subject||!grade){ warn.push(`Topic "${val}" appeared before Subject/Grade.`); return; }
          topic=val; level='easy';
          if(!res[subject].grades[grade].topics[topic])
            res[subject].grades[grade].topics[topic]={ name:topic, questions:emptyQ() }; }
        return;
      }
    }
    for(const [lv,re] of TXT_LEVELS){ if(re.test(line)){ flush(); level=lv; return; } }
    if(!line) flush(); else buf.push(line);
  });
  flush();
  return {subjects:res,count,warn};
}
document.getElementById('subImpText').onclick=async ()=>{
  const txt=await uiTextarea(
    'Paste your plan from Word\nUse these markers on their own lines:\n  Subject:  Grade:  Topic:  then  Easy / Medium / Hard\nLeave a blank line between questions. Options go under the question; the answer follows a | or an "Answer:" line. Lines starting with // are ignored.',
    'Subject: Chemistry\nGrade: 9\nTopic: Atomic Structure\n\nEasy\nWhat is the smallest particle of an element? | The atom\n\nWhich particle has a negative charge?\nA) Proton\nB) Electron\nC) Neutron\nAnswer: B) Electron\n\nMedium\nWhat does the atomic number tell you? | The number of protons');
  if(!txt||!txt.trim()) return;
  const {subjects,count,warn}=parsePlanText(txt);
  const names=Object.keys(subjects);
  if(!names.length||!count){ uiAlert('Nothing could be read.\nMake sure the document has "Subject:", "Grade:" and "Topic:" lines before the questions.'); return; }
  const report=[];
  names.forEach(s=>Object.keys(subjects[s].grades).forEach(g=>Object.values(subjects[s].grades[g].topics).forEach(t=>{
    report.push(`${s} · Grade ${g} · ${t.name} — ${t.questions.easy.length} easy, ${t.questions.medium.length} medium, ${t.questions.hard.length} hard`);
  })));
  if(!await uiConfirm(`Found ${count} question${count===1?'':'s'} — add them?\n\n${report.join('\n')}${warn.length?`\n\n⚠ ${warn.slice(0,3).join('\n⚠ ')}`:''}`)) return;
  let nT=0,nQ=0,created=0;
  names.forEach(n=>{
    let target=subjByName(n);
    if(!target){ const id=newId('u'); target={id,name:n,grades:{}}; S.subjects[id]=target; created++; }
    const grades={};
    Object.entries(subjects[n].grades).forEach(([g,go])=>{
      const topics={};
      Object.values(go.topics).forEach(t=>{ const id=newId('t'); topics[id]={id,name:t.name,questions:t.questions,usedQ:emptyQ()}; });
      grades[g]={topics};
    });
    const r=mergeIntoSubject(target,grades); nT+=r.nT; nQ+=r.nQ;
    S.activeSubject=target.id;
  });
  S.edTopic=null; ensureActive(); save(); renderBank();
  uiAlert(`Done ✔\n${created} new subject${created===1?'':'s'}, ${nT} new topic${nT===1?'':'s'}, ${nQ} question${nQ===1?'':'s'} added — each in its own topic and level.`);
};

/* ================== TOPICS ================== */
function addTopicNames(names){
  const s=sub(); if(!s||!S.edGrade) return {added:0,skipped:[]};
  if(!s.grades[S.edGrade]) s.grades[S.edGrade]={topics:{}};
  const tps=s.grades[S.edGrade].topics;
  let added=0, skipped=[];
  names.map(x=>x.trim()).filter(Boolean).forEach(n=>{
    if(Object.values(tps).some(t=>t.name===n)){ skipped.push(n); return; }
    const id=newId('t');
    tps[id]={ id, name:n, questions:emptyQ(), usedQ:emptyQ() };
    S.edTopic=id; added++;
  });
  return {added,skipped};
}
function addTopic(){
  const inp=document.getElementById('topInput');
  if(!inp.value.trim()) return;
  const r=addTopicNames(inp.value.split(','));
  inp.value='';
  if(r.added){ save(); renderBank(); }
  if(r.skipped.length) uiAlert(`Already existed: ${r.skipped.join(', ')}`);
}
document.getElementById('topAdd').onclick=addTopic;
document.getElementById('topInput').addEventListener('keydown',e=>{ if(e.key==='Enter') addTopic(); });
document.getElementById('topBulk').onclick=async ()=>{
  if(!sub()||!S.edGrade) return;
  const txt=await uiTextarea(`Bulk add topics — ${sub().name} · Grade ${S.edGrade}\nOne topic per line, straight from your yearly plan.`,'Unit 1: Hardware\nUnit 2: Software\nUnit 3: Networks');
  if(!txt||!txt.trim()) return;
  const r=addTopicNames(txt.split('\n'));
  if(r.added){ save(); renderBank(); }
  uiAlert(`Added ${r.added} topic${r.added===1?'':'s'} ✔${r.skipped.length?`\nAlready existed: ${r.skipped.join(', ')}`:''}`);
};

function renderTopics(){
  const card=document.getElementById('topCard');
  const s=sub();
  if(!s||!S.edGrade){ card.style.display='none'; renderQuestions(); return; }
  card.style.display='block';
  document.getElementById('topTitle').textContent=`${s.name} · Grade ${S.edGrade} · Topics`;
  const el=document.getElementById('topList');
  const topics=edGradeObj()?Object.values(edGradeObj().topics):[];
  el.innerHTML=topics.length?'':'<p class="hint" style="margin-top:10px">No topics for this grade yet. Add the units from your yearly plan 👆</p>';
  topics.forEach(t=>{
    const d=document.createElement('div');
    d.className='itemCard topic'+(S.edTopic===t.id?' sel':'');
    d.innerHTML=`${S.edTopic===t.id?'<span class="selBadge">✔</span>':'<span style="width:18px"></span>'}
      <span class="name">📌 ${esc(t.name)}</span>
      <span class="meta">${topicQCount(t)} question${topicQCount(t)===1?'':'s'}</span>`;
    d.onclick=()=>{ S.edTopic=t.id; qSel.clear(); cancelEdit(); save(); renderBank(); };
    d.appendChild(mkIco('📤','Copy this topic to another grade',async ()=>{
      const others=allGrades().filter(g=>g!==S.edGrade);
      const target=await uiPrompt(`Copy "${t.name}" to which grade?\nAvailable: ${others.join(', ')||'(add more classes to get more grades)'}`,others[0]||'');
      if(!target||!target.trim()) return;
      const tg=target.trim();
      if(tg===S.edGrade){ uiAlert('That is the same grade.'); return; }
      const nn=await uiPrompt(`Topic name in Grade ${tg}\nKeep it or change it.`,t.name);
      if(!nn||!nn.trim()) return;
      if(!s.grades[tg]) s.grades[tg]={topics:{}};
      if(Object.values(s.grades[tg].topics).some(x=>x.name===nn.trim())){ uiAlert(`Grade ${tg} already has a topic named "${nn.trim()}".`); return; }
      const id=newId('t');
      const c=cloneTopic(t,id); c.name=nn.trim();
      s.grades[tg].topics[id]=c;
      save(); renderBank();
      uiAlert(`Copied ✔\n"${t.name}" is now in Grade ${tg} as "${c.name}".`);
    }));
    d.appendChild(mkIco('📋','Duplicate topic',()=>{
      const id=newId('t');
      const c=cloneTopic(t,id); c.name=t.name+' (copy)';
      edGradeObj().topics[id]=c; S.edTopic=id; save(); renderBank();
    }));
    d.appendChild(mkIco('✏️','Rename',async ()=>{
      const nn=await uiPrompt('New topic name:',t.name);
      if(!nn||!nn.trim()||nn.trim()===t.name) return;
      if(Object.values(edGradeObj().topics).some(x=>x.name===nn.trim()&&x.id!==t.id)){ uiAlert('A topic with this name already exists.'); return; }
      t.name=nn.trim(); save(); renderBank(); renderSelectors();
    }));
    d.appendChild(mkIco('🗑','Delete topic',async ()=>{
      const qc=topicQCount(t);
      if(!await uiConfirm(`Delete topic "${t.name}"${qc?` and its ${qc} question${qc===1?'':'s'}`:''}?\nIt goes to the Trash.`)) return;
      const sid=s.id, g=S.edGrade, snap=JSON.parse(JSON.stringify(t));
      delete edGradeObj().topics[t.id];
      if(S.edTopic===t.id) S.edTopic=firstKey(edGradeObj().topics);
      ensureActive(); cancelEdit();
      recordDelete('topic',`Topic "${snap.name}"`,{sid,g,topic:snap},()=>{
        const sj=S.subjects[sid];
        if(sj&&sj.grades[g]) sj.grades[g].topics[snap.id]=snap;
      });
      renderBank();
    }));
    el.appendChild(d);
  });
  renderQuestions();
}

/* ================== QUESTIONS ================== */
let qLvl='easy', editId=null, qSel=new Set();
document.querySelectorAll('#qTabs button').forEach(b=>{
  b.onclick=()=>{
    document.querySelectorAll('#qTabs button').forEach(x=>x.classList.remove('active'));
    b.classList.add('active'); qLvl=b.dataset.l; qSel.clear(); cancelEdit(); renderQuestions();
  };
});
function cancelEdit(){
  editId=null;
  document.getElementById('qText').value='';
  document.getElementById('qAns').value='';
  document.getElementById('qAdd').textContent='Add Question';
  document.getElementById('qCancel').style.display='none';
}
document.getElementById('qCancel').onclick=()=>{ cancelEdit(); renderQuestions(); };
document.getElementById('qAdd').onclick=()=>{
  const t=edTopicObj(); if(!t) return;
  const q=document.getElementById('qText').value.trim();
  const a=document.getElementById('qAns').value.trim();
  if(!q) return;
  if(editId){
    const item=t.questions[qLvl].find(x=>x.id===editId);
    if(item){ item.q=q; item.a=a; }        // id kept → report history stays attached
  }else{
    t.questions[qLvl].push({ id:newId('q'), q, a });
  }
  cancelEdit(); save(); renderBank();
};
document.getElementById('qBulk').onclick=async ()=>{
  const t=edTopicObj(); if(!t) return;
  const txt=await uiTextarea(`Bulk add ${LVL[qLvl].name} questions — ${t.name}\nLeave a BLANK LINE between questions. Multiple-choice options go on their own lines under the question. The answer follows a | or an "Answer:" line.`,
    'What does WWW stand for? | World Wide Web\n\nWhich device connects two networks?\nA) Monitor\nB) Router\nC) Keyboard\nAnswer: B) Router\n\nName one input device.');
  if(!txt||!txt.trim()) return;
  let added=0;
  txt.replace(/\r/g,'').split(/\n\s*\n/).forEach(block=>{
    const lines=block.split('\n').map(s=>s.trim()).filter(Boolean);
    if(!lines.length) return;
    let ans='', qLines=[];
    lines.forEach(line=>{
      const am=line.match(/^(answer|correct|cevap)\s*[:\-]\s*(.+)$/i);
      if(am){ ans=am[2].trim(); return; }
      const p=line.indexOf('|');
      if(p>=0){ const b=line.slice(0,p).trim(), a=line.slice(p+1).trim(); if(b)qLines.push(b); if(a)ans=a; }
      else qLines.push(line);
    });
    if(qLines.length){ t.questions[qLvl].push({ id:newId('q'), q:qLines.join('\n'), a:ans }); added++; }
  });
  save(); renderBank();
  uiAlert(`Added ${added} question${added===1?'':'s'} to ${LVL[qLvl].name} ✔`);
};

function renderQuestions(){
  const card=document.getElementById('qCard');
  const t=edTopicObj();
  if(!t){ card.style.display='none'; renderTimerInputs(); return; }
  card.style.display='block';
  document.getElementById('qTitle').textContent=`${sub().name} · Grade ${S.edGrade} · ${t.name}`;
  const el=document.getElementById('qList');
  const list=t.questions[qLvl];
  el.innerHTML=list.length?'':'<p class="hint" style="margin-top:10px">No questions at this level yet.</p>';
  list.forEach((it,i)=>{
    const d=document.createElement('div');
    d.className='qItem'+(editId===it.id?' editing':'');
    const cb=document.createElement('input'); cb.type='checkbox'; cb.checked=qSel.has(it.id); cb.title='Select';
    cb.onclick=ev=>{ ev.stopPropagation(); cb.checked?qSel.add(it.id):qSel.delete(it.id); renderSelBar(list.length); };
    d.appendChild(cb);
    const body=document.createElement('div'); body.className='qBody';
    body.innerHTML=`<strong>${i+1}.</strong> ${esc(it.q)} ${it.a?`<small>Answer: ${esc(it.a)}</small>`:''}`;
    d.appendChild(body);
    const btns=document.createElement('div'); btns.className='qBtns';
    const e=document.createElement('button'); e.textContent='✏️'; e.title='Edit';
    e.onclick=()=>{
      editId=it.id;
      document.getElementById('qText').value=it.q;
      document.getElementById('qAns').value=it.a||'';
      document.getElementById('qAdd').textContent='💾 Update';
      document.getElementById('qCancel').style.display='inline-block';
      document.getElementById('qText').focus();
      renderQuestions();
    };
    const x=document.createElement('button'); x.textContent='🗑'; x.title='Delete';
    x.onclick=()=>{
      const tid=t.id, sid=sub().id, g=S.edGrade, lv=qLvl, pos=i, q={...it};
      t.questions[lv]=t.questions[lv].filter(y=>y.id!==it.id);
      t.usedQ[lv]=t.usedQ[lv].filter(id=>id!==it.id);
      if(editId===it.id) cancelEdit();
      qSel.delete(it.id);
      recordDelete('question',`Question: "${q.q.split('\n')[0].slice(0,40)}…"`,{sid,g,tid,lv,pos,q},()=>{
        const tp=S.subjects[sid]&&S.subjects[sid].grades[g]&&S.subjects[sid].grades[g].topics[tid];
        if(tp) tp.questions[lv].splice(Math.min(pos,tp.questions[lv].length),0,q);
      });
      renderBank();
    };
    btns.appendChild(e); btns.appendChild(x); d.appendChild(btns); el.appendChild(d);
  });
  renderSelBar(list.length);
  renderTimerInputs();
}
function renderSelBar(total){
  const el=document.getElementById('qList');
  const old=document.getElementById('selBar'); if(old) old.remove();
  if(!total) return;
  const t=edTopicObj(); if(!t) return;
  const bar=document.createElement('div'); bar.className='selBar'; bar.id='selBar';
  const n=qSel.size;
  bar.innerHTML=`<span class="count">${n?`${n} selected`:'Tick the boxes to delete several at once'}</span>`;
  const all=document.createElement('button'); all.className='btn ghost small';
  all.textContent=(n===total)?'Clear selection':'Select all';
  all.onclick=()=>{ if(n===total) qSel.clear(); else t.questions[qLvl].forEach(q=>qSel.add(q.id)); renderQuestions(); };
  bar.appendChild(all);
  if(n){
    const del=document.createElement('button'); del.className='btn danger small';
    del.textContent=`🗑 Delete selected (${n})`;
    del.onclick=async ()=>{
      if(!await uiConfirm(`Delete ${n} question${n===1?'':'s'}?\nThey go to the Trash.`)) return;
      const sid=sub().id, g=S.edGrade, tid=t.id, lv=qLvl;
      const removed=[];
      t.questions[lv].forEach((q,i)=>{ if(qSel.has(q.id)) removed.push({pos:i,q:{...q}}); });
      t.questions[lv]=t.questions[lv].filter(q=>!qSel.has(q.id));
      t.usedQ[lv]=t.usedQ[lv].filter(id=>!qSel.has(id));
      qSel.clear(); cancelEdit();
      recordDelete('questions',`${removed.length} question${removed.length===1?'':'s'} (${t.name})`,{sid,g,tid,lv,removed},()=>{
        const tp=S.subjects[sid]&&S.subjects[sid].grades[g]&&S.subjects[sid].grades[g].topics[tid];
        if(tp) removed.forEach(r=>tp.questions[lv].splice(Math.min(r.pos,tp.questions[lv].length),0,r.q));
      });
      renderBank();
    };
    bar.appendChild(del);
  }
  el.appendChild(bar);
}
function renderTimerInputs(){
  LEVELS.forEach(l=>{
    const inp=document.getElementById('t'+l[0].toUpperCase()+l.slice(1));
    inp.value=S.timers[l];
    inp.onchange=()=>{ S.timers[l]=Math.max(5,parseInt(inp.value)||20); save(); };
  });
}

/* ================== SCOREBOARD ================== */
document.getElementById('scoreReset').onclick=async ()=>{
  const c=cls(); if(!c) return;
  if(!await uiConfirm(`Reset all scores for ${c.name}?`)) return;
  c.scores={}; save(); renderScores();
};
function renderScores(){
  const t=document.getElementById('scoreTable'), c=cls();
  document.getElementById('boardTitle').textContent=c?`${c.name} · Scoreboard`:'Scoreboard';
  if(!c){ t.innerHTML='<tr><td class="hint">Select a class first.</td></tr>'; return; }
  const rows=Object.entries(c.scores).map(([id,v])=>({name:stuName(c,id),...v}))
    .sort((a,b)=>b.pts-a.pts);
  if(!rows.length){ t.innerHTML='<tr><td class="hint">No points yet. Let the quiz begin! 🎉</td></tr>'; return; }
  t.innerHTML='<tr><th>Student</th><th>✅</th><th>❌</th><th>Points</th></tr>'+
    rows.map((r,i)=>`<tr class="${i===0?'top':''}"><td>${i===0?'👑 ':''}${esc(r.name)}</td><td>${r.ok}</td><td>${r.no}</td><td>${r.pts}</td></tr>`).join('');
}

/* ================== REPORTS ==================
   Attempts are grouped by id, so renaming a student, topic or question
   keeps their whole history together. Names come from the live data. */
const ATTEMPT_CAP = 20000;
const ATTEMPT_DAYS = 400;
let rpClassId='', rpDays=0;
function rateColor(p){ return p>=75?'var(--green-deep)':p>=50?'var(--yellow-deep)':'var(--red)'; }
function rateBar(name,ok,total){
  const p=total?Math.round(ok/total*100):0;
  return `<div class="rateRow">
    <span class="nm">${esc(name)}</span>
    <span class="track"><span class="fill" style="width:${p}%;background:${rateColor(p)}"></span></span>
    <span class="pct" style="color:${rateColor(p)}">${p}%</span>
    <span class="n">${ok}/${total}</span></div>`;
}
function pruneAttempts(){
  const cut=Date.now()-ATTEMPT_DAYS*86400000;
  const before=S.attempts.length;
  S.attempts=S.attempts.filter(a=>a.ts>=cut);
  if(S.attempts.length>ATTEMPT_CAP) S.attempts=S.attempts.slice(-ATTEMPT_CAP);
  return before!==S.attempts.length;
}
function logAttempt(correct){
  const c=cls(), s=sub(), t=quizTopic();
  if(!S.attempts) S.attempts=[];
  S.attempts.push({
    ts:Date.now(),
    clsId:c?c.id:null, clsName:c?c.name:'',
    gradeKey:c?c.grade:'',
    subjId:s?s.id:null, subjName:s?s.name:'',
    topicId:t?t.id:null, topicName:t?t.name:'',
    level:current.level,
    stuId:current.studentId||null, stuName:current.student||'',
    qId:current.question?current.question.id:null,
    qText:(current.question&&current.question.q||'').split('\n')[0].slice(0,120),
    correct:!!correct
  });
  if(S.attempts.length>ATTEMPT_CAP) pruneAttempts();
  save();
}
function currentAttempts(){
  const cut = rpDays>0 ? Date.now()-rpDays*86400000 : 0;
  return (S.attempts||[]).filter(a=>a.clsId===rpClassId && a.ts>=cut);
}
/* live name if the thing still exists, otherwise the snapshot taken at the time */
function liveTopicName(a){
  const s=a.subjId&&S.subjects[a.subjId];
  if(s){ for(const g of Object.values(s.grades)){ const t=g.topics[a.topicId]; if(t) return s.name+' · '+t.name; } }
  return (a.subjName||'?')+' · '+(a.topicName||'?');
}
function liveStudentName(a){
  const c=a.clsId&&S.classes[a.clsId];
  if(c){ const s=stuById(c,a.stuId); if(s) return s.name; }
  return a.stuName||'(removed)';
}
function liveQuestionText(a){
  if(a.subjId&&S.subjects[a.subjId]){
    for(const g of Object.values(S.subjects[a.subjId].grades)){
      const t=g.topics[a.topicId];
      if(t) for(const l of LEVELS){ const q=t.questions[l].find(x=>x.id===a.qId); if(q) return q.q.split('\n')[0]; }
    }
  }
  return a.qText||'(question)';
}
function renderReports(){
  ensureActive();
  const sel=document.getElementById('rpClass');
  const list=Object.values(S.classes);
  if(!rpClassId || !S.classes[rpClassId]) rpClassId=S.activeClass||firstKey(S.classes)||'';
  sel.innerHTML=list.length?list.map(c=>`<option value="${esc(c.id)}" ${c.id===rpClassId?'selected':''}>${esc(c.name)}</option>`).join(''):'<option value="">— no classes —</option>';
  sel.onchange=()=>{ rpClassId=sel.value; renderReports(); };
  const per=document.getElementById('rpPeriod');
  per.value=String(rpDays);
  per.onchange=()=>{ rpDays=parseInt(per.value)||0; renderReports(); };

  const A=currentAttempts();
  const sum=document.getElementById('rpSummary');
  const tc=document.getElementById('rpTopicCard'), sc=document.getElementById('rpStudentCard'), hc=document.getElementById('rpHardCard');
  if(!A.length){
    sum.innerHTML='<p class="rpEmpty">No answers recorded for this class in this period yet. Play a quiz and they will show up here. 🎲</p>';
    tc.style.display=sc.style.display=hc.style.display='none';
    return;
  }
  const total=A.length, ok=A.filter(a=>a.correct).length, pct=Math.round(ok/total*100);
  const students=new Set(A.map(a=>a.stuId||a.stuName)).size;
  sum.innerHTML=`<div class="rpStat">
    <div class="box"><div class="big">${total}</div><div class="lbl">Answers</div></div>
    <div class="box"><div class="big" style="color:${rateColor(pct)}">${pct}%</div><div class="lbl">Correct</div></div>
    <div class="box"><div class="big">${students}</div><div class="lbl">Students</div></div></div>`;

  const byTopic={};
  A.forEach(a=>{ const k=a.topicId||('n:'+a.topicName);
    (byTopic[k]=byTopic[k]||{ok:0,t:0,label:liveTopicName(a)}); byTopic[k].t++; if(a.correct)byTopic[k].ok++; });
  document.getElementById('rpTopics').innerHTML=
    Object.values(byTopic).sort((x,y)=>(x.ok/x.t)-(y.ok/y.t)).map(v=>rateBar(v.label,v.ok,v.t)).join('');
  tc.style.display='block';

  const byStu={};
  A.forEach(a=>{ const k=a.stuId||('n:'+a.stuName);
    (byStu[k]=byStu[k]||{ok:0,t:0,label:liveStudentName(a)}); byStu[k].t++; if(a.correct)byStu[k].ok++; });
  document.getElementById('rpStudents').innerHTML='<tr><th>Student</th><th>Answered</th><th>Correct</th><th>Rate</th></tr>'+
    Object.values(byStu).sort((x,y)=>(y.ok/y.t)-(x.ok/x.t)).map(v=>{
      const p=Math.round(v.ok/v.t*100);
      return `<tr><td>${esc(v.label)}</td><td>${v.t}</td><td>${v.ok}</td><td style="color:${rateColor(p)};font-weight:800">${p}%</td></tr>`;
    }).join('');
  sc.style.display='block';

  const byQ={};
  A.forEach(a=>{ const k=a.qId||('n:'+a.qText);
    (byQ[k]=byQ[k]||{ok:0,t:0,label:liveQuestionText(a),topic:liveTopicName(a)}); byQ[k].t++; if(a.correct)byQ[k].ok++; });
  const hard=Object.values(byQ).filter(v=>v.t>=2 && v.ok/v.t<0.6).sort((x,y)=>(x.ok/x.t)-(y.ok/y.t)).slice(0,10);
  if(hard.length){
    document.getElementById('rpHard').innerHTML=hard.map(v=>{
      const p=Math.round(v.ok/v.t*100);
      return `<div class="qItem"><div class="qBody"><strong style="color:${rateColor(p)}">${p}%</strong> · ${esc(v.label)} <small>${esc(v.topic)} — ${v.ok}/${v.t} correct</small></div></div>`;
    }).join('');
    hc.style.display='block';
  }else hc.style.display='none';
}
document.getElementById('rpExport').onclick=()=>{
  const A=currentAttempts();
  if(!A.length){ uiAlert('Nothing to export for this class and period yet.'); return; }
  const q=s=>`"${String(s==null?'':s).replace(/"/g,'""')}"`;
  const head=['Date','Time','Class','Grade','Subject','Topic','Level','Student','Result','Question'];
  const rows=A.map(a=>{ const d=new Date(a.ts);
    return [d.toLocaleDateString(),d.toLocaleTimeString(),
      (S.classes[a.clsId]||{}).name||a.clsName, a.gradeKey,
      (S.subjects[a.subjId]||{}).name||a.subjName, liveTopicName(a).split(' · ').pop(),
      a.level, liveStudentName(a), a.correct?'Correct':'Wrong', liveQuestionText(a)].map(q).join(',');
  });
  const csv='\ufeff'+[head.map(q).join(','),...rows].join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  const d=new Date(),p=x=>String(x).padStart(2,'0');
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`report-${((S.classes[rpClassId]||{}).name||'class')}-${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}.csv`;
  a.click(); URL.revokeObjectURL(a.href);
};
document.getElementById('rpClear').onclick=async ()=>{
  const A=currentAttempts();
  if(!A.length){ uiAlert('No history for this class in this period.'); return; }
  const nm=(S.classes[rpClassId]||{}).name||'this class';
  if(!await uiConfirm(`Clear ${A.length} recorded answer${A.length===1?'':'s'} for "${nm}"${rpDays?` (last ${rpDays} days)`:''}?\nReport history only — Scoreboard points stay. This cannot be undone.`)) return;
  const cut=rpDays>0?Date.now()-rpDays*86400000:0;
  S.attempts=S.attempts.filter(a=>!(a.clsId===rpClassId && a.ts>=cut));
  save(); renderReports();
};

/* ================== BACKUP & TRASH ================== */
document.getElementById('bakExport').onclick=()=>{
  const d=new Date(),p=x=>String(x).padStart(2,'0');
  download(`quiz-backup-${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}.json`,
    { app:'quiz-game', schema:SCHEMA, data:S });
  S.lastBackup=Date.now(); save(); flushSave();
  renderBackupStatus();
  showToast('Backup saved ✔ Keep this file in Google Drive or a USB stick.');
};
function daysSince(ts){ return ts?Math.floor((Date.now()-ts)/86400000):null; }
function renderBackupStatus(){
  const card=document.getElementById('bakStatusCard'); if(!card) return;
  const d=daysSince(S.lastBackup);
  let txt;
  if(d===null){ card.style.background='rgba(214,69,69,.12)'; card.style.borderColor='var(--red)';
    txt='⚠ <b>You have never made a backup.</b> If this browser is cleared, everything is lost. Click <b>Export All Data</b> below.'; }
  else if(d>=7){ card.style.background='rgba(224,164,34,.14)'; card.style.borderColor='var(--yellow-deep)';
    txt=`⏰ Your last backup was <b>${d} day${d===1?'':'s'} ago</b>.`; }
  else { card.style.background='rgba(143,214,148,.18)'; card.style.borderColor='var(--green-deep)';
    txt=`✔ Last backup: <b>${d===0?'today':d+' day'+(d===1?'':'s')+' ago'}</b>. You're covered.`; }
  card.style.display='block';
  card.innerHTML=`<p style="margin:0;font-weight:700">${txt}</p>`;
}
let reminderShown=false;
function maybeRemindBackup(){
  if(reminderShown) return;
  const d=daysSince(S.lastBackup);
  if(d===null||d>=7){
    reminderShown=true;
    showToast(d===null?'Tip: make your first backup so your work is safe.':`It's been ${d} days since your last backup.`,
      '💾 Back up now', ()=>document.querySelector('nav button[data-tab=backup]').click(), 8000);
  }
}
document.getElementById('bakImport').onclick=()=>document.getElementById('bakFile').click();
document.getElementById('bakFile').onchange=function(){
  const f=this.files[0]; if(!f) return;
  const rd=new FileReader();
  rd.onload=async ()=>{
    try{
      const d=JSON.parse(rd.result);
      let data=d.data||d;
      if(!data.classes||!data.subjects){ uiAlert('This file is not a valid quiz backup.'); return; }
      if(!await uiConfirm('Importing will REPLACE everything on this computer (classes, students, questions, scores). Continue?')) return;
      if(!data.schemaVersion || data.schemaVersion<SCHEMA){
        data.subjects=normaliseOldSubjects(data.subjects,data.classes);
        data=migrateToV6(data);
      }
      S=Object.assign({schemaVersion:SCHEMA},data);
      if(!S.trash) S.trash=[]; if(!S.attempts) S.attempts=[];
      if(!S.quiz) S.quiz={mode:'individual',levelPick:'wheel',groups:3,beatSeconds:60};
      undoStack=[];
      ensureActive(); save(); flushSave();
      document.getElementById('soundBtn').textContent=S.sound?'🔊':'🔇';
      initQuizSettings(); refreshAll(); renderBackupStatus(); renderTrash();
      uiAlert('Backup imported successfully! ✔ All your data is loaded.');
    }catch(e){ uiAlert('Could not read this file.'); }
  };
  rd.readAsText(f); this.value='';
};
function renderTrash(){
  pruneTrash();
  const el=document.getElementById('trashList'); if(!el) return;
  if(!S.trash.length){ el.innerHTML='<p class="hint">Trash is empty.</p>'; return; }
  el.innerHTML='';
  S.trash.forEach(t=>{
    const w=daysSince(t.ts);
    const d=document.createElement('div');
    d.className='itemCard'; d.style.cursor='default';
    d.innerHTML=`<span class="name">${esc(t.label)}</span><span class="meta">${w===0?'today':w+' day'+(w===1?'':'s')+' ago'}</span>`;
    const r=document.createElement('button'); r.className='btn small'; r.textContent='↩ Restore';
    r.onclick=()=>restoreFromTrash(t.id);
    d.appendChild(r); el.appendChild(d);
  });
}
function restoreFromTrash(id){
  const i=S.trash.findIndex(t=>t.id===id); if(i<0) return;
  const t=S.trash[i], d=t.data;
  try{
    if(t.kind==='class') S.classes[d.cls.id]=d.cls;
    else if(t.kind==='subject') S.subjects[d.subj.id]=d.subj;
    else if(t.kind==='topic'){
      const sj=S.subjects[d.sid];
      if(!sj||!sj.grades[d.g]) return uiAlert('Its subject or grade no longer exists — restore that first.');
      sj.grades[d.g].topics[d.topic.id]=d.topic;
    }
    else if(t.kind==='students'){
      const c=S.classes[d.cid]; if(!c) return uiAlert('That class no longer exists.');
      c.students=d.snap.students; c.absent=d.snap.absent; c.picked=d.snap.picked; c.scores=d.snap.scores;
    }
    else if(t.kind==='student'){
      const c=S.classes[d.cid]; if(!c) return uiAlert('That class no longer exists.');
      c.students.splice(Math.min(d.pos,c.students.length),0,d.stu);
      if(d.score) c.scores[d.stu.id]=d.score;
    }
    else if(t.kind==='question'||t.kind==='questions'){
      const sj=S.subjects[d.sid];
      const tp=sj&&sj.grades[d.g]&&sj.grades[d.g].topics[d.tid];
      if(!tp) return uiAlert('Its topic no longer exists — restore that first.');
      if(t.kind==='question') tp.questions[d.lv].splice(Math.min(d.pos,tp.questions[d.lv].length),0,d.q);
      else d.removed.forEach(r=>tp.questions[d.lv].splice(Math.min(r.pos,tp.questions[d.lv].length),0,r.q));
    }
  }catch(e){ return uiAlert('Could not restore this item.'); }
  S.trash.splice(i,1);
  undoStack=undoStack.filter(u=>u.entryId!==id);
  ensureActive(); save(); refreshAll(); renderTrash();
  showToast(`Restored: ${t.label} ↩`);
}
document.getElementById('trashEmpty').onclick=async ()=>{
  if(!S.trash.length) return;
  if(!await uiConfirm(`Empty the trash?\nThis permanently removes ${S.trash.length} item${S.trash.length===1?'':'s'}.`)) return;
  S.trash=[]; undoStack=[]; save(); renderTrash();
};

/* ================== QUIZ SELECTORS & BANNER ================== */
function renderSelectors(){
  ensureActive();
  const sc=document.getElementById('selClass'), ss=document.getElementById('selSubject'), st=document.getElementById('selTopic');
  const cl=Object.values(S.classes), sl=Object.values(S.subjects);
  sc.innerHTML=cl.length?cl.map(c=>`<option value="${esc(c.id)}" ${c.id===S.activeClass?'selected':''}>${esc(c.name)}</option>`).join(''):'<option value="">— Add a class —</option>';
  ss.innerHTML=sl.length?sl.map(s=>`<option value="${esc(s.id)}" ${s.id===S.activeSubject?'selected':''}>${esc(s.name)}</option>`).join(''):'<option value="">— Add a subject —</option>';
  const g=quizGradeObj();
  const tl=g?Object.values(g.topics):[];
  document.getElementById('topicLabel').textContent = cls()&&cls().grade ? `📌 Topic (Grade ${cls().grade})` : '📌 Topic';
  st.innerHTML=tl.length?tl.map(t=>`<option value="${esc(t.id)}" ${t.id===S.activeTopic?'selected':''}>${esc(t.name)}</option>`).join(''):'<option value="">— No topics for this grade —</option>';
  sc.onchange=()=>{ S.activeClass=sc.value; S.activeTopic=null; current.groups=null; ensureActive(); save(); renderSelectors(); showIdle(); };
  ss.onchange=()=>{ S.activeSubject=ss.value; S.activeTopic=null; ensureActive(); save(); renderSelectors(); showIdle(); };
  st.onchange=()=>{ S.activeTopic=st.value; save(); showIdle(); };
}
function renderBanner(){
  const b=document.getElementById('quizBanner');
  const c=cls(), s=sub(), t=quizTopic();
  if(c&&s&&t){
    b.innerHTML=`🏫 <b>${esc(c.name)}</b> · 📖 <b>${esc(s.name)}</b> · 📌 <b>${esc(t.name)}</b>`;
    b.style.display='block';
  }else b.style.display='none';
}

/* ================== QUIZ SETTINGS ================== */
function initQuizSettings(){
  document.querySelectorAll('#modeSeg button').forEach(b=>{
    b.onclick=()=>{
      S.quiz.mode=b.dataset.m; save();
      document.querySelectorAll('#modeSeg button').forEach(x=>x.classList.toggle('on',x.dataset.m===S.quiz.mode));
      renderQuizOpts(); showIdle();
    };
    b.classList.toggle('on', b.dataset.m===S.quiz.mode);
  });
  const ob=document.getElementById('quizOptsBtn'), op=document.getElementById('quizOpts');
  ob.onclick=()=>{ const open=op.style.display==='none'; op.style.display=open?'block':'none'; ob.textContent=open?'Options ▴':'Options ▾'; };
  renderQuizOpts();
}
function renderQuizOpts(){
  const op=document.getElementById('quizOpts');
  let html='';
  if(S.quiz.mode!=='beat'){
    html+=`<div class="optToggle"><span class="lbl">🎡 Difficulty</span>
      <span class="switch" id="swLevel">
        <button data-v="wheel" class="${S.quiz.levelPick==='wheel'?'on':''}">Spin the wheel</button>
        <button data-v="student" class="${S.quiz.levelPick==='student'?'on':''}">Student chooses</button>
      </span>
      <span class="hint" style="margin:0">The wheel keeps it fair — nobody can always pick Easy.</span></div>`;
  }
  if(S.quiz.mode==='group'){
    html+=`<div class="optToggle"><span class="lbl">👥 Number of teams</span>
      <input type="number" class="numIn" id="optGroups" min="2" max="8" value="${S.quiz.groups}">
      <button class="btn ghost small" id="reTeam">🔀 Re-draw teams</button></div>`;
  }
  if(S.quiz.mode==='beat'){
    html+=`<div class="optToggle"><span class="lbl">⏱️ Time per student</span>
      <input type="number" class="numIn" id="optBeat" min="20" max="300" value="${S.quiz.beatSeconds}"> <span class="hint" style="margin:0">seconds</span></div>
      <p class="hint" style="margin-top:8px">One student answers as many as they can before time runs out. Only correct answers count — no penalty. Keyboard: <b>→</b> correct, <b>←</b> skip.</p>`;
  }
  op.innerHTML=html;
  const sw=document.getElementById('swLevel');
  if(sw) sw.querySelectorAll('button').forEach(b=>b.onclick=()=>{ S.quiz.levelPick=b.dataset.v; save(); renderQuizOpts(); });
  const g=document.getElementById('optGroups');
  if(g) g.onchange=()=>{ S.quiz.groups=Math.max(2,Math.min(8,parseInt(g.value)||3)); save(); };
  const rt=document.getElementById('reTeam');
  if(rt) rt.onclick=()=>{ const c=cls(); if(c){ c.groupState=null; save(); } showIdle(); };
  const bt=document.getElementById('optBeat');
  if(bt) bt.onchange=()=>{ S.quiz.beatSeconds=Math.max(20,Math.min(300,parseInt(bt.value)||60)); save(); };
}

/* ================== QUIZ FLOW ================== */
const stage=document.getElementById('stage');
let current={ studentId:null, student:null, level:null, question:null,
              tick:null, anim:null, beatTimer:null, timeLeft:0, total:0, ringC:0, paused:false, beat:null };
function clearTimers(){ clearInterval(current.tick); clearTimeout(current.anim); clearInterval(current.beatTimer); }

document.getElementById('newRound').onclick=()=>{
  const c=cls();
  if(c){ c.picked=[]; c.groupState=null; save(); }
  showIdle();
};

function showIdle(){
  clearTimers(); current.paused=false; sndSpinStop(); renderBanner();
  if(!cls()){ stage.innerHTML='<div class="stageLabel">First add a class in the "🏫 Classes" tab 👆</div>'; return; }
  if(!sub()){ stage.innerHTML='<div class="stageLabel">First create a subject in the "📖 Question Banks" tab 👆</div>'; return; }
  if(!quizGradeObj()||!quizTopic()){
    stage.innerHTML=`<div class="stageLabel">"${esc(sub().name)}" has no topics for this class yet.<br>Go to "📖 Question Banks" and add topics for Grade ${esc(cls().grade||'?')} 👆</div>`;
    return;
  }
  if(S.quiz.mode==='group') return showIdleGroup();
  if(S.quiz.mode==='beat')  return showIdleBeat();
  showIdleIndividual();
}
function showIdleIndividual(){
  const c=cls();
  const present=presentIds(c);
  const left=present.filter(id=>!c.picked.includes(id)).length;
  stage.innerHTML=`
    <div class="stageLabel">${present.length? `${left||present.length} name${(left||present.length)===1?'':'s'} in the hat 🎩`
      : (c.students.length?'Everyone is marked absent — mark someone present in the Classes tab 👆':`No students in "${esc(c.name)}" yet 👆`)}</div>
    <button class="pickBtn" id="pickGo" ${present.length?'':'disabled style="opacity:.4"'}>🎲 Pick a Student!</button>`;
  const b=document.getElementById('pickGo');
  if(b&&present.length) b.onclick=startPick;
}
function spinNames(ids,winnerId,then,steps){
  const c=cls();
  const total=steps||17;                 // fewer steps = a shorter drumroll
  sndSpinStart();
  stage.innerHTML=`<div class="stageLabel">Who will it be? 🥁</div>
    <div class="bigName" id="nameFlip">…</div>
    <svg class="underline" id="uLine" viewBox="0 0 200 14"><path d="M4 8 Q 50 2 100 8 T 196 7" stroke="#e0a422" stroke-width="4" fill="none" stroke-linecap="round"/></svg>`;
  const el=document.getElementById('nameFlip');
  let i=0, delay=55;
  (function spin(){
    el.textContent=stuName(c,ids[Math.floor(Math.random()*ids.length)]);
    sndPick(); i++;
    if(i<total){ delay*=1.13; current.anim=setTimeout(spin,delay); }
    else{
      sndSpinStop();
      el.textContent=stuName(c,winnerId); el.classList.add('landed');
      const u=document.getElementById('uLine'); if(u) u.classList.add('showU');
      current.anim=setTimeout(then,600);
    }
  })();
}
function startPick(){
  const c=cls();
  const present=presentIds(c);
  let pool=present.filter(id=>!c.picked.includes(id));
  if(!pool.length){ c.picked=c.picked.filter(id=>!present.includes(id)); pool=[...present]; }
  const winner=pool[Math.floor(Math.random()*pool.length)];
  c.picked.push(winner); save();
  current.studentId=winner; current.student=stuName(c,winner);
  spinNames(present,winner,afterStudentChosen);
}
function afterStudentChosen(){
  if(S.quiz.levelPick==='wheel') spinLevelWheel(startQuestion);
  else showLevelChoice();
}
function spinLevelWheel(then){
  const chosen=LEVELS[Math.floor(Math.random()*3)];
  stage.innerHTML=`<div class="stageLabel"><b style="color:var(--yellow-deep)">${esc(current.student)}</b> — spinning for a level… 🎡</div>
    <div class="wheelSlot" id="slot">?</div>`;
  const slot=document.getElementById('slot');
  let i=0, delay=55;
  (function roll(){
    const l=LEVELS[i%3];
    slot.textContent=LVL[l].name; slot.className='wheelSlot '+l;
    sndPick(); i++;
    if(i<13){ delay*=1.14; current.anim=setTimeout(roll,delay); }
    else{ slot.textContent=LVL[chosen].name+'!'; slot.className='wheelSlot '+chosen;
          current.anim=setTimeout(()=>then(chosen),700); }
  })();
}
function showLevelChoice(){
  stage.innerHTML=`<div class="stageLabel">You're up, <b style="color:var(--yellow-deep)">${esc(current.student)}</b>! Choose your level:</div>
    <div class="lvlChoice">
      <button class="lvlBtn easy" data-l="easy">🟦 Easy<small>10 pts · ${S.timers.easy} sec</small></button>
      <button class="lvlBtn medium" data-l="medium">🟨 Medium<small>20 pts · ${S.timers.medium} sec</small></button>
      <button class="lvlBtn hard" data-l="hard">🟥 Hard<small>30 pts · ${S.timers.hard} sec</small></button>
    </div>`;
  stage.querySelectorAll('.lvlBtn').forEach(b=>b.onclick=()=>startQuestion(b.dataset.l));
}
window.afterStudentChosen=afterStudentChosen;

/* pick an unused question BY ID, so deleting/reordering never confuses it */
function pickQuestion(topic,lvl){
  const list=topic.questions[lvl];
  if(!list.length) return null;
  if(!topic.usedQ[lvl]) topic.usedQ[lvl]=[];
  let avail=list.filter(q=>!topic.usedQ[lvl].includes(q.id));
  if(!avail.length){ topic.usedQ[lvl]=[]; avail=list; }
  const q=avail[Math.floor(Math.random()*avail.length)];
  topic.usedQ[lvl].push(q.id);
  topic.usedQ[lvl]=topic.usedQ[lvl].filter(id=>list.some(x=>x.id===id));   // drop stale ids
  save();
  return q;
}
function makePauseButton(){
  const b=document.createElement('button');
  b.className='pauseBtn'; b.id='pauseBtn'; b.textContent='⏸ Pause';
  b.onclick=()=>{
    if(current.paused){ current.paused=false; if(S.quiz.mode!=='beat') runTimer(); b.textContent='⏸ Pause'; }
    else { current.paused=true; clearInterval(current.tick); b.textContent='▶ Resume'; }
  };
  return b;
}
function runTimer(){
  const ring=document.getElementById('ring'), tn=document.getElementById('tNum');
  if(!ring||!tn) return;
  const total=current.total, C=current.ringC;
  clearInterval(current.tick);
  current.tick=setInterval(()=>{
    if(current.paused) return;
    current.timeLeft--;
    if(current.timeLeft<0){
      clearInterval(current.tick); sndTimeUp();
      tn.textContent='⏰'; ring.setAttribute('stroke','#d64545');
      const lab=document.querySelector('.stageLabel');
      if(lab) lab.innerHTML='<b style="color:#d64545">Time\u2019s up!</b> Teacher decides 👇';
      const pb=document.getElementById('pauseBtn'); if(pb) pb.style.display='none';
      return;
    }
    tn.textContent=current.timeLeft;
    ring.setAttribute('stroke-dashoffset', C*(1-current.timeLeft/total));
    if(current.timeLeft<=5){ ring.setAttribute('stroke','#d64545'); sndTick(); }
  },1000);
}
function startQuestion(lvl){
  current.level=lvl; current.paused=false;
  const t=quizTopic();
  const q=pickQuestion(t,lvl);
  if(!q){
    stage.innerHTML=`<div class="stageLabel">"${esc(t.name)}" has no ${LVL[lvl].name.toLowerCase()} questions yet 😅<br>You can add some in the "Question Banks" tab.</div>
      <button class="btn" onclick="afterStudentChosen()">← Back</button>`;
    return;
  }
  current.question=q;
  current.timeLeft=S.timers[lvl]; current.total=S.timers[lvl];
  const R=52, C=2*Math.PI*R; current.ringC=C;
  const g=cls().groupState;
  const label = (S.quiz.mode==='group'&&g)
    ? `<b style="color:${LVL[lvl].color}">${LVL[lvl].name}</b> · Team ${g.turn+1} — ${esc(current.student)}`
    : `<b style="color:${LVL[lvl].color}">${LVL[lvl].name}</b> · ${esc(current.student)}`;
  stage.innerHTML=`
    <div class="stageLabel">${label}</div>
    <div class="timerWrap">
      <svg width="120" height="120">
        <circle cx="60" cy="60" r="${R}" stroke="#e8e2d4" stroke-width="9" fill="none"/>
        <circle id="ring" cx="60" cy="60" r="${R}" stroke="${LVL[lvl].color}" stroke-width="9" fill="none"
          stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="0"/>
      </svg>
      <div class="tNum" id="tNum">${current.total}</div>
    </div>
    <div class="questionText">${esc(qStem(q.q))}</div>
    <div id="answerArea"></div>
    <div class="answerBox" id="ansBox"></div>
    <div class="row" style="justify-content:center;gap:10px">
      <div id="pauseHost"></div>
      ${q.a?'<button class="btn ghost small" id="showAns">👁 Show Answer</button>':''}
    </div>
    <div class="judge" id="judgeRow">
      <button class="ok" id="jOk">✅ Correct</button>
      <button class="no" id="jNo">❌ Wrong</button>
    </div>`;
  document.getElementById('pauseHost').appendChild(makePauseButton());
  renderAnswerArea();
  const sa=document.getElementById('showAns');
  if(sa) sa.onclick=()=>{ document.getElementById('ansBox').textContent='Answer: '+q.a; sa.remove(); };
  document.getElementById('jOk').onclick=()=>finish(true);
  document.getElementById('jNo').onclick=()=>finish(false);
  runTimer();
}

/* ---------- reading a stored question ---------- */
function qStem(text){ return String(text).split('\n')[0]; }
function parseOptions(text){
  return String(text).split('\n').slice(1).map(l=>l.trim()).filter(Boolean).map(line=>{
    const m=line.match(/^([A-Za-z]|\d{1,2})\s*[).\-:]\s*(.+)$/);
    return m?{label:m[1].toUpperCase(),text:m[2].trim()}:{label:'',text:line.replace(/^[-•*]\s*/,'')};
  });
}
const SUBSUP={'\u2080':'0','\u2081':'1','\u2082':'2','\u2083':'3','\u2084':'4','\u2085':'5','\u2086':'6','\u2087':'7','\u2088':'8','\u2089':'9','\u00b2':'2','\u00b3':'3','\u00b9':'1'};
function normAns(s){
  return String(s||'').toLowerCase().trim()
    .replace(/^[a-z0-9]\s*[).\-:]\s*/,'')
    .replace(/[\u2080-\u2089\u00b2\u00b3\u00b9]/g,c=>SUBSUP[c])
    .replace(/[^a-z0-9\u00e7\u011f\u0131\u00f6\u015f\u00fc\s]/g,'')
    .replace(/\s+/g,' ').trim();
}
function correctIndex(opts,answer){
  const a=String(answer||'').trim(); if(!a) return -1;
  const letter=(a.match(/^([A-Za-z]|\d{1,2})\s*[).\-:]?\s*/)||[])[1];
  if(letter){ const i=opts.findIndex(o=>o.label&&o.label===letter.toUpperCase()); if(i>=0) return i; }
  const na=normAns(a);
  let i=opts.findIndex(o=>normAns(o.text)===na);
  if(i>=0) return i;
  return opts.findIndex(o=>na&&normAns(o.text)&&(na.includes(normAns(o.text))||normAns(o.text).includes(na)));
}
function isTrueFalse(q,a){
  const opts=parseOptions(q), na=normAns(a), tf=/^(true|false|t|f|yes|no)$/;
  if(opts.length===2&&opts.every(o=>tf.test(normAns(o.text)))) return true;
  return opts.length===0&&tf.test(na);
}
function typedMatches(typed,answer){
  const t=normAns(typed), tz=t.replace(/\s/g,'');
  if(!t) return false;
  return String(answer).split(/\s*(?:\/|,| or )\s*/i).map(normAns).filter(Boolean).some(alt=>{
    const az=alt.replace(/\s/g,'');
    if(t===alt||tz===az) return true;
    return alt.length>3&&(t.includes(alt)||alt.includes(t)||tz.includes(az)||az.includes(tz));
  });
}
function renderAnswerArea(){
  const host=document.getElementById('answerArea');
  const q=current.question.q, ans=current.question.a;
  const opts=parseOptions(q), tf=isTrueFalse(q,ans);
  if(opts.length>=2||tf){
    const list=opts.length>=2?opts:[{label:'✔',text:'True'},{label:'✘',text:'False'}];
    const right=correctIndex(list,ans);
    const wrap=document.createElement('div');
    wrap.className='optWrap'+((tf&&opts.length<2)?' tf':'');
    list.forEach((o,i)=>{
      const b=document.createElement('button');
      b.className='optBtn';
      b.innerHTML=`<span class="lbl">${esc(o.label||String.fromCharCode(65+i))}</span><span>${esc(o.text)}</span>`;
      b.onclick=()=>pickOption(wrap,i,right);
      wrap.appendChild(b);
    });
    host.appendChild(wrap);
    return;
  }
  const wrap=document.createElement('div'); wrap.className='typeWrap';
  const inp=document.createElement('input');
  inp.type='text'; inp.placeholder='Type your answer…'; inp.autocomplete='off';
  const go=document.createElement('button'); go.className='btn'; go.textContent='Check';
  const send=()=>submitTyped(inp,go);
  go.onclick=send;
  inp.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); send(); } });
  wrap.appendChild(inp); wrap.appendChild(go); host.appendChild(wrap);
  setTimeout(()=>inp.focus(),80);
}
function pickOption(wrap,chosen,right){
  clearInterval(current.tick);
  const btns=[...wrap.querySelectorAll('.optBtn')];
  btns.forEach((b,i)=>{
    b.disabled=true;
    if(right>=0&&i===right) b.classList.add('right');
    else if(i===chosen) b.classList.add('wrongPick');
    else b.classList.add('fade');
  });
  if(right<0){ document.getElementById('ansBox').textContent='No saved answer — teacher decides 👇'; return; }
  const ok=chosen===right;
  document.getElementById('judgeRow').style.display='none';
  current.anim=setTimeout(()=>finish(ok), ok?900:1500);
}
function submitTyped(inp,go){
  const typed=inp.value.trim();
  if(!typed){ inp.focus(); return; }
  clearInterval(current.tick);
  inp.disabled=true; go.disabled=true; go.textContent='✓';
  const ans=current.question.a;
  if(ans&&typedMatches(typed,ans)){
    document.getElementById('judgeRow').style.display='none';
    current.anim=setTimeout(()=>finish(true),700);
    return;
  }
  const box=document.getElementById('ansBox');
  box.style.color='var(--ink)';
  box.innerHTML=ans
    ? `They wrote: <b>${esc(typed)}</b> &nbsp;·&nbsp; Answer: <b style="color:var(--green-deep)">${esc(ans)}</b> — teacher decides 👇`
    : `They wrote: <b>${esc(typed)}</b> — teacher decides 👇`;
}

/* ---------- finishing an answer ---------- */
function finish(correct){
  clearInterval(current.tick); current.paused=false;
  if(S.quiz.mode==='beat') return finishBeat(correct);
  logAttempt(correct);
  if(S.quiz.mode==='group') return finishGroup(correct);
  finishIndividual(correct);
}
function finishIndividual(correct){
  const c=cls(), id=current.studentId, nm=current.student;
  if(!c.scores[id]) c.scores[id]={pts:0,ok:0,no:0};
  if(correct){
    c.scores[id].pts+=LVL[current.level].pts; c.scores[id].ok++;
    sndCorrect(); fireConfetti();
    stage.innerHTML=`<div class="resultBig">🎉</div>
      <div class="resultTxt" style="color:var(--green-deep)">Great job, ${esc(nm)}!</div>
      <div class="ptTag">+${LVL[current.level].pts} points</div>
      <button class="pickBtn" id="nextBtn">Next Student 🎲</button>`;
  }else{
    c.scores[id].no++;
    sndWrong();
    const card=document.getElementById('stageCard');
    card.classList.add('shake'); setTimeout(()=>card.classList.remove('shake'),600);
    stage.innerHTML=`<div class="resultBig">❌</div>
      <div class="resultTxt" style="color:var(--red)">Nice try, ${esc(nm)} — you'll get the next one! 💪</div>
      ${current.question.a?`<div class="hint">Correct answer: <b style="color:var(--ink)">${esc(current.question.a)}</b></div>`:''}
      <button class="pickBtn" id="nextBtn">Next Student 🎲</button>`;
  }
  save();
  document.getElementById('nextBtn').onclick=showIdle;
}

/* ---------- group mode (teams live on the class, so a refresh keeps them) ---------- */
function showIdleGroup(){
  const c=cls();
  const present=presentIds(c);
  if(present.length<2){ stage.innerHTML='<div class="stageLabel">Group mode needs at least 2 present students.</div>'; return; }
  if(c.groupState){ return showGroupBoard(); }
  stage.innerHTML=`<div class="stageLabel">${present.length} students · ${S.quiz.groups} teams</div>
    <button class="pickBtn" id="makeTeams">👥 Make Random Teams</button>`;
  document.getElementById('makeTeams').onclick=()=>makeTeams(present);
}
function makeTeams(present){
  const c=cls();
  const shuffled=[...present].sort(()=>Math.random()-0.5);
  const teams=Array.from({length:S.quiz.groups},()=>[]);
  shuffled.forEach((id,i)=>teams[i%S.quiz.groups].push(id));
  c.groupState={ teams, scores:teams.map(()=>0), turn:0, memberIdx:teams.map(()=>0) };
  save();
  stage.innerHTML='<div class="stageLabel">Making teams… 🥁</div><div class="bigName" id="tm">…</div>';
  const tm=document.getElementById('tm'); let i=0;
  const iv=setInterval(()=>{
    tm.textContent=stuName(c,present[Math.floor(Math.random()*present.length)]); sndPick();
    if(++i>16){ clearInterval(iv); showGroupBoard(); }
  },80);
}
function showGroupBoard(){
  const c=cls(), g=c.groupState;
  const cards=g.teams.map((mem,i)=>`
    <div class="groupCard ${i===g.turn?'active':''}">
      <h4>Team ${i+1}</h4>
      <div class="gpts">${g.scores[i]}</div>
      <div class="members">${mem.map(id=>esc(stuName(c,id))).join('<br>')}</div>
    </div>`).join('');
  stage.innerHTML=`<div class="stageLabel">Team <b style="color:var(--yellow-deep)">${g.turn+1}</b>'s turn — get ready!</div>
    <div class="groupGrid">${cards}</div>
    <button class="pickBtn" id="goGroup">🎲 Pick Answerer & Question</button>`;
  document.getElementById('goGroup').onclick=pickGroupAnswerer;
}
function pickGroupAnswerer(){
  const c=cls(), g=c.groupState;
  const team=g.teams[g.turn].filter(id=>!(c.absent||[]).includes(id) && stuById(c,id));
  if(!team.length){ g.turn=(g.turn+1)%g.teams.length; save(); return showGroupBoard(); }
  const who=team[g.memberIdx[g.turn]%team.length];
  g.memberIdx[g.turn]++; save();
  current.studentId=who; current.student=stuName(c,who);
  spinNames(team,who,()=>{ if(S.quiz.levelPick==='wheel') spinLevelWheel(startQuestion); else showLevelChoice(); },14);
}
function finishGroup(correct){
  const c=cls(), g=c.groupState;
  if(correct){
    g.scores[g.turn]+=LVL[current.level].pts;
    sndCorrect(); fireConfetti();
    stage.innerHTML=`<div class="resultBig">🎉</div>
      <div class="resultTxt" style="color:var(--green-deep)">Team ${g.turn+1} scores!</div>
      <div class="ptTag">+${LVL[current.level].pts} points · ${esc(current.student)}</div>
      <button class="pickBtn" id="nextBtn">Next Team ▶</button>`;
  }else{
    sndWrong();
    const card=document.getElementById('stageCard');
    card.classList.add('shake'); setTimeout(()=>card.classList.remove('shake'),600);
    stage.innerHTML=`<div class="resultBig">❌</div>
      <div class="resultTxt" style="color:var(--red)">No points for Team ${g.turn+1}.</div>
      ${current.question.a?`<div class="hint">Correct answer: <b style="color:var(--ink)">${esc(current.question.a)}</b></div>`:''}
      <button class="pickBtn" id="nextBtn">Next Team ▶</button>`;
  }
  g.turn=(g.turn+1)%g.teams.length; save();
  document.getElementById('nextBtn').onclick=showGroupBoard;
}

/* ---------- beat the clock ---------- */
function showIdleBeat(){
  const c=cls();
  if(!presentIds(c).length){ stage.innerHTML='<div class="stageLabel">No present students 👆</div>'; return; }
  stage.innerHTML=`<div class="stageLabel">Beat the Clock · ${S.quiz.beatSeconds} seconds ⏱️</div>
    <button class="pickBtn" id="pickGo">🎲 Pick a Student!</button>`;
  document.getElementById('pickGo').onclick=()=>{
    const present=presentIds(c);
    let pool=present.filter(id=>!c.picked.includes(id));
    if(!pool.length){ c.picked=c.picked.filter(id=>!present.includes(id)); pool=[...present]; }
    const who=pool[Math.floor(Math.random()*pool.length)];
    c.picked.push(who); save();
    current.studentId=who; current.student=stuName(c,who);
    spinNames(present,who,startBeatRun,14);
  };
}
function startBeatRun(){
  current.beat={ correct:0, total:0, timeLeft:S.quiz.beatSeconds, done:false };
  current.paused=false;
  beatNextQuestion();
  clearInterval(current.beatTimer);
  current.beatTimer=setInterval(()=>{
    if(current.paused) return;
    current.beat.timeLeft--;
    const tn=document.getElementById('beatTime');
    if(tn) tn.textContent=current.beat.timeLeft;
    if(current.beat.timeLeft<=5) sndTick();
    if(current.beat.timeLeft<=0){ clearInterval(current.beatTimer); endBeatRun(); }
  },1000);
}
function beatNextQuestion(){
  if(!current.beat||current.beat.done) return;
  const t=quizTopic();
  const bag=[];
  LEVELS.forEach(l=>t.questions[l].forEach(q=>bag.push({l,q})));
  if(!bag.length){ endBeatRun(); return; }
  const pick=bag[Math.floor(Math.random()*bag.length)];
  current.level=pick.l; current.question=pick.q;
  stage.innerHTML=`
    <div class="stageLabel">⏱️ <span id="beatTime">${current.beat.timeLeft}</span>s left · <b style="color:var(--green-deep)">${current.beat.correct} correct</b></div>
    <div class="questionText">${esc(qStem(pick.q.q))}</div>
    <div id="answerArea"></div>
    <div class="answerBox" id="ansBox"></div>
    <div class="row" style="justify-content:center;gap:10px">
      <div id="pauseHost"></div>
      ${pick.q.a?'<button class="btn ghost small" id="showAns">👁 Show</button>':''}
    </div>
    <div class="judge" id="judgeRow">
      <button class="ok" id="jOk">✅ Correct →</button>
      <button class="no" id="jNo">❌ Skip ←</button>
    </div>`;
  document.getElementById('pauseHost').appendChild(makePauseButton());
  renderAnswerArea();
  const sa=document.getElementById('showAns');
  if(sa) sa.onclick=()=>{ document.getElementById('ansBox').textContent='Answer: '+pick.q.a; sa.remove(); };
  document.getElementById('jOk').onclick=()=>finishBeat(true);
  document.getElementById('jNo').onclick=()=>finishBeat(false);
}
function finishBeat(correct){
  if(!current.beat||current.beat.done) return;
  current.beat.total++;
  if(correct){ current.beat.correct++; sndCorrect(); } else sndWrong();
  logAttempt(correct);
  beatNextQuestion();
}
function endBeatRun(){
  current.beat.done=true;
  clearInterval(current.beatTimer);
  sndTimeUp(); fireConfetti();
  const b=current.beat;
  stage.innerHTML=`<div class="resultBig">⏱️</div>
    <div class="resultTxt" style="color:var(--green-deep)">${esc(current.student)} got ${b.correct} correct!</div>
    <div class="hint">${b.total} answered in ${S.quiz.beatSeconds} seconds</div>
    <button class="pickBtn" id="nextBtn">Next Student 🎲</button>`;
  document.getElementById('nextBtn').onclick=showIdle;
}

/* ================== CONFETTI ================== */
function fireConfetti(){
  if(typeof confetti!=='function') return;
  const end=Date.now()+1200;
  (function f(){
    confetti({particleCount:6,angle:60,spread:60,origin:{x:0},colors:['#e0a422','#2e8fb5','#d95f83','#2f8f55']});
    confetti({particleCount:6,angle:120,spread:60,origin:{x:1},colors:['#e0a422','#2e8fb5','#d95f83','#2f8f55']});
    if(Date.now()<end) requestAnimationFrame(f);
  })();
  confetti({particleCount:120,spread:100,origin:{y:.6}});
}

/* ================== KEYBOARD ================== */
document.addEventListener('keydown',e=>{
  if(!document.getElementById('tab-quiz').classList.contains('show')) return;
  const tag=(e.target.tagName||'').toLowerCase();
  if(tag==='input'||tag==='textarea'||tag==='select') return;
  const judge=document.getElementById('judgeRow');
  if(!judge||judge.style.display==='none') return;
  if(e.key==='ArrowRight'){ e.preventDefault(); const b=document.getElementById('jOk'); if(b) b.click(); }
  if(e.key==='ArrowLeft'){ e.preventDefault(); const b=document.getElementById('jNo'); if(b) b.click(); }
  if(e.key===' '){ const p=document.getElementById('pauseBtn'); if(p){ e.preventDefault(); p.click(); } }
});

/* ================== INIT ================== */
/* The school logo is optional. If assets/gisu-logo.png is missing we hide the
   img instead of leaving a broken-image icon next to the title. Checked three
   ways because a failed file:// image does not always fire 'error': now, on
   error, and once more after load when the result is certain. */
(function(){
  const logo=document.getElementById('brandLogo');
  if(!logo) return;
  const check=()=>{ if(logo.complete&&!logo.naturalWidth) logo.style.display='none'; };
  check();
  logo.addEventListener('error',check);
  window.addEventListener('load',check);
})();

document.getElementById('soundBtn').onclick=function(){
  S.sound=!S.sound; this.textContent=S.sound?'🔊':'🔇'; save();
};
(async function init(){
  await load();
  if(!S.trash) S.trash=[];
  if(!S.attempts) S.attempts=[];
  if(S.lastBackup===undefined) S.lastBackup=null;
  if(!S.quiz) S.quiz={mode:'individual',levelPick:'wheel',groups:3,beatSeconds:60};
  S.schemaVersion=SCHEMA;
  Object.values(S.classes).forEach(c=>{ if(!c.absent)c.absent=[]; if(!c.picked)c.picked=[]; if(!c.scores)c.scores={}; });
  if(pruneTrash()|pruneAttempts()) save();
  document.getElementById('soundBtn').textContent=S.sound?'🔊':'🔇';
  initQuizSettings();
  renderClasses(); renderBank(); renderSelectors(); showIdle();
  setTimeout(maybeRemindBackup,2500);
})();
