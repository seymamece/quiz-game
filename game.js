/* ==================================================================
   DATA MODEL (schema 8)
   Every entity carries a permanent id. Names are only labels, so
   renaming anything never breaks scores, history or references.

   classes  { clsId: {id,name,grade, students:[{id,name}],
                      absent:[stuId], picked:[stuId],
                      scores:{stuId:{pts,ok,no}}, groupState:null|{…}} }
   subjects { subjId:{id,name, grades:{ "7": { topics:{
                topicId:{id,name,
                         questions:{easy|medium|hard:[{id,q,a,img?}]},
                         usedQ:{easy|medium|hard:[qId]}} }}}} }
   attempts [ {id, ts, clsId,clsName, gradeKey, subjId,subjName,
               topicId,topicName, level, stuId,stuName,
               qId,qText, correct} ]        ids link, names are a fallback
================================================================== */
const SCHEMA = 8;
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
  if(typeof markDirty==='function') markDirty();   // cloud sync has something to send
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
  spin:    "assets/spin.mp3",   // the tune while student names are spinning — see assets/README.md
  correct: "data:audio/mpeg;base64,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TApiU+dwtFDCUJv9KzOFU3z+aYUXKn02WeW13bxqUylcVLoGadTgqkbKGV91SV5SUrdBr0KsZh3dgQrqGokp3scKGJuKTGZaM6s08h2pN0jgEKem/S7Uo1E44vW5kOhAEErDARrrVCgKquFEl+qwwwEqhSpUtmMMKZtW/16vAL6Sr3WMzN6qqr9h8QghDCuFcsLEKITIQV+qk0ZmZm2wqlP9mnqGFRQpcpH/+2DE7IIQJNsQBKDQCbob4hiTDXiX5r9E57c2U2qhSNmXYMc4KVBQNCJb54fzpZwdxm8Fe68S1UxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVAURlmRkQ/IyWy/2Wy/LAdn8st///v/2Sz+UFLPssj/8s//9bL/ZbHlihgYNH7LAdT/sP//rSz+WSz7LATl9liH/+qy/1goWPLFDAwYRioqSxbywqyIRQWiwsK1ipBUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+2DE7IETufMAJhh7CbWyX1gwj8hVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+2DEtoPLsaDEIIBuQAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+2LEhwPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//tgxIeDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//tgxIeDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//tgxIeDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV",   // applause when the answer is correct  (+ confetti)
  wrong:   "data:audio/mpeg;base64,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bbbbbBKJAepQsUeAa4Y1Mm+UiyXuUBopS5tlFVQGluNBwsTMw0CMlcTaHGfPtQi5bZjKLckVCy7xbLpZUO9+r2E+tuvzWdyV00z6urVg69fn11Fezxo0G1t7tCx///9xpor02sNRYGvSBjEAmzAqCoNPZ89MHaQ4MR2VANBCaHnB5oCxVW5B5TZ+sIk/0uv/+2DECgPMSGMGPYMAAAAANIAAAASxmzNQ0icFEt9EiUsSJJbJEjTzn8kSOmkZcs6JTvxEHBE9QNDAaf8FVnZUNiV0S9R7UDQwO1HhEe+VOiWsFR4K/g1yx4RYi/wV87/Ue4iVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+2LEUIPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//tgxIeDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV",   // the donk-zonk buzzer when the answer is wrong
  tick:    "data:audio/mpeg;base64,//tQxAAABuQBcTQRgAHkGi+7HpAAllUBQGnB8Th95c/B98EAQBAyJwf8Hw/WD+D4f6gQBCCAY/4Pv/wQMg+D5//wQ//+CAYyhz+BDiGyKsIgABmpEYwySwSqHq71Z1YiMJRwWmcWE7E64QHY0RyAq2oicHhVTBtxCkudWYcnE5aSTKT8l+lk78YQ8urueG7Oksmluzm3OcJZ/V+vHK30+4YkFx0OvQw0RJpQ0QoSQufz02XNgsg0gWJrcQLCz8WXLegf//aq8llsAFgE8ApKEv/7UsQFAAt8j2d8xAABb5TquPQJ8IQi0yWlpSFwpOTsdVCU9GmhyBG1amoaanA0Vpr2i9rUcdKShPOpUrHSP1sUdgGRUBap2Ijxp4dASsySW4NNVWVM5Wrc3Vsx29NlSbLTtaVAFl7udKzMIDIEAF+XZbRcU6oVhRIpqWlQr1SnXhlOAroCofyaxVlW3Nbw4qa3BSqqNsc+zM35VN8rZasblFRFgwDR0FfgyJVHlXhoq4fRpPPJ9cOkuVo9bolyw/xKWhZq9SQIQATEVoch2IYB//tSxAcAS2RXO4CwwYFUmGJAYQ5AXBxEmsQ4lgQjYlM/BUZl5qqOo7Zl8lqdFIVAQNA0HFhJ5YBBUsHQ2VIljQlOkgoerOywFiLUvh1hO5SA0RLEsRLdU8iIVlnq1fair8tMAI8iaRx60FGvAMkdmlErI5RQonVYdbaozGAuQY11VQwq7edDCjlL27sflP4xrHbsYwF0r6jx3uFzq5YBQ0elTpUiGmlanpBXWEg6oqnEQ6BVPqeJagqH8Rk00RnZcyOz/llkpGTKwMGIwyZ///H/+1LEDIPGhJK+QIBpwAAANIAAAARhUiZGN4qLIeKihI0BRUWJGv+LC+sVFpoKigtVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVQ==",   // clock tick during the last 5 seconds
  timeUp:  ""    // played when the timer reaches zero
};
const SOUND_VOLUME = 0.7;          // 0.0 = silent, 1.0 = full volume
const _audioCache={};
function playFile(src,rate,loop){
  if(!S.sound||!src) return false;
  try{
    let a=_audioCache[src];
    if(!a){ a=new Audio(src); a.volume=SOUND_VOLUME; _audioCache[src]=a; }
    a.loop=!!loop; a.playbackRate=rate||1; a.currentTime=0; a.play().catch(()=>{});
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
/* Loops on purpose. The draw runs about 3.5s for the name and another 2.4s for
   the level wheel, and longer still when the student picks the level by hand,
   so no fixed-length clip covers it. It is stopped when the question appears. */
const sndSpinStart=()=>{ if(!playFile(MY_SOUNDS.spin,1,true)) tone(660,0,.05,'square',.06); };
const sndSpinStop =()=>stopFile(MY_SOUNDS.spin);
const sndPick=()=>{ if(MY_SOUNDS.spin) return; tone(600+Math.random()*300,0,.05,'square',.06); };

/* ================== SMALL HELPERS ================== */
function esc(s){ const d=document.createElement('div'); d.textContent=s==null?'':s; return d.innerHTML; }
/* Fisher-Yates. Array.sort with a random comparator looks like a shuffle but
   is not uniform — some students would land on the same team far too often. */
function shuffle(arr){
  const a=[...arr];
  for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}
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
  /* Text, never HTML. Toast messages quote class, subject, topic and question
     names, and a question bank imported from a colleague is untrusted input. */
  t.textContent='';
  const span=document.createElement('span');
  span.textContent=msg;
  t.appendChild(span);
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
    sndSpinStop();          // the draw music loops; leaving the quiz must silence it
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
      <span class="name">${esc(c.name)}</span>      
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
    ? `Present today: <b>${present}</b> / ${c.students.length}. Tap a name to mark it absent — tap again to bring them back. Absent students are skipped in the quiz.<br><small>Use × only to remove someone for good; re-adding the name starts their points and history over.</small>` : '';
  const el=document.getElementById('stuList');
  el.innerHTML=c.students.length?'':'<p class="hint">No students yet. Add some above 👆</p>';
  const cid=c.id;                  // looked up fresh in handlers, in case the class changes
  c.students.forEach(s=>{
    const absent=c.absent.includes(s.id);
    const ch=document.createElement('div');
    ch.className='chip'+(c.picked.includes(s.id)?' done':'')+(absent?' absent':'');
    const nm=document.createElement('span');
    nm.textContent=s.name; nm.style.cursor='pointer';
    nm.title=absent?'Tap to mark present again':'Tap to mark absent';
    /* Marking someone absent is one tap and easy to do by mistake in a busy
       room. Tapping again undoes it, but a struck-through greyed-out chip reads
       as gone rather than reversible, and a teacher in a hurry reaches for the
       × instead — which really does remove them, and re-adding the name mints a
       new id that leaves their points and report history behind. So say so. */
    const setAbsent=(on)=>{
      const cc=S.classes[cid]; if(!cc) return;
      cc.absent = on ? cc.absent.concat([s.id]) : cc.absent.filter(x=>x!==s.id);
      save(); renderStudents();
    };
    nm.onclick=()=>{
      setAbsent(!absent);
      if(!absent) showToast(s.name+' marked absent','↩ Undo',()=>setAbsent(false),6000);
    };
    ch.appendChild(nm);
    if(absent){
      const tg=document.createElement('span'); tg.className='absentTag';
      tg.textContent='absent ↩'; tg.title='Tap to mark present again';
      tg.style.cursor='pointer';
      tg.onclick=ev=>{ ev.stopPropagation(); setAbsent(false); };
      ch.appendChild(tg);
    }
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

/* ================== QUESTION PICTURES ==================
   A diagram copied out of a textbook is often several megabytes, and it has to
   live in this browser's storage next to every class, question and score — and
   travel inside the sync payload. So everything is shrunk on the way in.

   Pictures are stored in the question itself as a data URI rather than as
   files or in cloud storage, which keeps the app working with no connection:
   a picture question in a classroom with the wifi down still shows its
   picture. The cost is size, which is why the budget is shown to the teacher
   in the Backup tab. */

const IMG_MAX_PX=1000;               // long edge; a projector never needs more
const IMG_BUDGET=3*1024*1024;        // warn well before the browser's own limit

function fmtBytes(n){
  if(n<1024) return n+' B';
  if(n<1024*1024) return Math.round(n/1024)+' KB';
  return (n/1024/1024).toFixed(1)+' MB';
}
function dataUriBytes(uri){
  if(typeof uri!=='string'||!uri) return 0;
  const i=uri.indexOf(',');
  return i<0 ? uri.length : Math.floor((uri.length-i-1)*3/4);
}
function picturesBytes(){
  let n=0;
  Object.values(S.subjects).forEach(s=>Object.values(s.grades||{}).forEach(g=>
    Object.values(g.topics||{}).forEach(t=>LEVELS.forEach(l=>
      (t.questions[l]||[]).forEach(q=>{ n+=dataUriBytes(q.img); })))));
  return n;
}

/* Downscale, then keep whichever encoding comes out smaller. Line drawings
   from a worksheet stay crisp as PNG; photographs shrink far more as JPEG.
   Trying both costs milliseconds and avoids guessing wrong either way. */
function shrinkImage(fileOrBlob){
  return new Promise((resolve,reject)=>{
    const url=URL.createObjectURL(fileOrBlob);
    const im=new Image();
    im.onload=()=>{
      URL.revokeObjectURL(url);
      let w=im.naturalWidth, h=im.naturalHeight;
      if(!w||!h){ reject(new Error('that file is not a picture')); return; }
      const scale=Math.min(1, IMG_MAX_PX/Math.max(w,h));
      w=Math.max(1,Math.round(w*scale)); h=Math.max(1,Math.round(h*scale));
      const c=document.createElement('canvas'); c.width=w; c.height=h;
      const ctx=c.getContext('2d');
      ctx.fillStyle='#fff'; ctx.fillRect(0,0,w,h);      // JPEG cannot hold transparency
      ctx.drawImage(im,0,0,w,h);
      let best=null;
      [['image/jpeg',0.82],['image/png',undefined]].forEach(([type,q])=>{
        try{ const d=c.toDataURL(type,q); if(d&&d.indexOf('data:image')===0&&(!best||d.length<best.length)) best=d; }
        catch(e){}
      });
      if(best) resolve(best); else reject(new Error('this browser could not convert it'));
    };
    im.onerror=()=>{ URL.revokeObjectURL(url); reject(new Error('that file is not a picture')); };
    im.src=url;
  });
}

/* A picture can arrive inside an imported question bank, so its value is
   untrusted like every other field from a colleague's file. Only a base64
   data:image URI is ever allowed into a src attribute — anything else, such as
   `" onerror="…`, is dropped rather than escaped and hoped for. */
const IMG_URI_RE=/^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/=]+$/i;
function safeImgUri(uri){ return (typeof uri==='string'&&IMG_URI_RE.test(uri))?uri:''; }
function imgTag(uri,className){
  const u=safeImgUri(uri);
  return u?`<img class="${className}" src="${esc(u)}" alt="Picture for this question">`:'';
}

let qImg=null;                       // picture for the question being added or edited

function renderQImg(){
  const has=document.getElementById('qImgHas'), empty=document.getElementById('qImgEmpty');
  if(!has||!empty) return;
  if(qImg){
    document.getElementById('qImgPreview').src=qImg;
    document.getElementById('qImgSize').textContent=fmtBytes(dataUriBytes(qImg));
    has.style.display=''; empty.style.display='none';
  }else{
    document.getElementById('qImgPreview').removeAttribute('src');
    has.style.display='none'; empty.style.display='';
  }
}

async function acceptImage(fileOrBlob){
  try{
    const uri=await shrinkImage(fileOrBlob);
    const size=dataUriBytes(uri);
    if(picturesBytes()+size>IMG_BUDGET){
      if(!await uiConfirm('Your pictures are using '+fmtBytes(picturesBytes())+' already.\n'
        +'Adding more may fill up what this browser will store, and very large question banks sync slowly.\n\nAdd it anyway?')) return;
    }
    qImg=uri; renderQImg();
    showToast('Picture ready ✔ '+fmtBytes(size)+' — press Add Question to save it');
  }catch(e){ uiAlert('Could not use that picture.\n'+(e.message||'')); }
}

function wireQuestionPictures(){
  const zone=document.getElementById('qImgZone'); if(!zone) return;
  document.getElementById('qImgPick').onclick=()=>document.getElementById('qImgFile').click();
  document.getElementById('qImgFile').onchange=function(){
    const f=this.files[0]; this.value='';
    if(f) acceptImage(f);
  };
  document.getElementById('qImgDrop').onclick=()=>{ qImg=null; renderQImg(); };

  zone.addEventListener('dragover',e=>{ e.preventDefault(); zone.classList.add('dragging'); });
  zone.addEventListener('dragleave',()=>zone.classList.remove('dragging'));
  zone.addEventListener('drop',e=>{
    e.preventDefault(); zone.classList.remove('dragging');
    const f=e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files[0];
    if(f) acceptImage(f);
  });

  /* Paste anywhere on the Question Banks tab, not only inside the box — a
     teacher who has just copied a figure should not have to find a target. */
  document.addEventListener('paste',e=>{
    const card=document.getElementById('qCard');
    if(!card||card.style.display==='none') return;
    const items=(e.clipboardData&&e.clipboardData.items)||[];
    for(let i=0;i<items.length;i++){
      if(items[i].type&&items[i].type.indexOf('image/')===0){
        const f=items[i].getAsFile();
        if(f){ e.preventDefault(); acceptImage(f); return; }
      }
    }
  });
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
  qImg=null; renderQImg();
}
document.getElementById('qCancel').onclick=()=>{ cancelEdit(); renderQuestions(); };
document.getElementById('qAdd').onclick=()=>{
  const t=edTopicObj(); if(!t) return;
  const q=document.getElementById('qText').value.trim();
  const a=document.getElementById('qAns').value.trim();
  if(!q) return;
  if(editId){
    const item=t.questions[qLvl].find(x=>x.id===editId);
    if(item){                              // id kept → report history stays attached
      item.q=q; item.a=a;
      if(qImg) item.img=qImg; else delete item.img;
    }
  }else{
    const item={ id:newId('q'), q, a };
    if(qImg) item.img=qImg;
    t.questions[qLvl].push(item);
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
    if(it.img){
      const th=document.createElement('img'); th.className='qThumb'; th.src=safeImgUri(it.img);
      th.alt='Picture attached to this question';
      d.appendChild(th);
    }
    const body=document.createElement('div'); body.className='qBody';
    body.innerHTML=`<strong>${i+1}.</strong> ${esc(it.q)} ${it.a?`<small>Answer: ${esc(it.a)}</small>`:''}`;
    d.appendChild(body);
    const btns=document.createElement('div'); btns.className='qBtns';
    const e=document.createElement('button'); e.textContent='✏️'; e.title='Edit';
    e.onclick=()=>{
      editId=it.id;
      document.getElementById('qText').value=it.q;
      document.getElementById('qAns').value=it.a||'';
      qImg=it.img||null; renderQImg();
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
    id:newId('a'),          // stable id: lets a resend land once instead of twice
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
  /* Answers live in their own table now, so deleting them here is only half the
     job: without this they would come straight back on the next sync. */
  if(QuizSync.configured()&&QuizSync.currentUser()){
    QuizSync.deleteAttempts(rpClassId,cut).catch(()=>{
      syncProblem='Cleared here, but the cloud copy could not be reached. Press Sync now while online.';
      renderCloud();
    });
  }
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
      /* migrateToV6 only understands the pre-v6, name-keyed format. Compare
         against 6 and not SCHEMA: once SCHEMA moves past 6, a v6 backup would
         otherwise be fed through it and come out wrecked. Shapes from v6
         onwards only ever gain optional fields, so they load as they are. */
      if(!data.schemaVersion || data.schemaVersion<6){
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
      /* The music keeps running here: the level wheel is still to come and
         cutting it the moment the name lands left an odd silence. */
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
  sndSpinStop();                 // the draw is over; the question needs quiet
  current.level=lvl; current.paused=false;
  const t=quizTopic();
  const q=pickQuestion(t,lvl);
  if(!q){
    stage.innerHTML=`<div class="stageLabel">"${esc(t.name)}" has no ${LVL[lvl].name.toLowerCase()} questions yet 😅<br>You can add some in the "Question Banks" tab.</div>
      <button class="btn" id="noQBack">← Back</button>`;
    const back=document.getElementById('noQBack');
    if(back) back.onclick=afterStudentChosen;   // handlers belong in JS, not in the markup
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
    ${imgTag(q.img,'stageImg')}
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
    if(az.length<=3) return false;                     // too short to judge on a fragment
    if(t.includes(alt)||tz.includes(az)) return true;  // they wrote a sentence around the answer
    // They wrote only part of the answer. Require most of it, otherwise a
    // single letter would score "Alveoli" and "up" would score "Jupiter".
    const need=Math.max(4,Math.ceil(az.length*0.7));
    return tz.length>=need&&az.includes(tz);
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
  const shuffled=shuffle(present);
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
    <button class="pickBtn" id="goGroup">🎲 Pick Answerer & Question</button>
    <div class="row" style="justify-content:center;margin-top:12px">
      <button class="btn ghost small" id="endGroup">🏁 Finish &amp; See Winner</button>
    </div>`;
  document.getElementById('goGroup').onclick=pickGroupAnswerer;
  document.getElementById('endGroup').onclick=finishGroupGame;
}

/* The end of the game. Teams are re-drawn every time and the points are not
   carried anywhere, so this screen is the whole reward — it just has to name
   the winners clearly and be worth cheering at. */
function finishGroupGame(){
  const c=cls(), g=c.groupState;
  if(!g) return showIdle();
  clearTimers();
  const best=Math.max(...g.scores);
  const champs=g.scores.map((s,i)=>({s,i})).filter(x=>x.s===best).map(x=>x.i);
  const ranked=g.scores.map((s,i)=>({s,i})).sort((a,b)=>b.s-a.s);

  let head;
  if(best===0){
    head=`<div class="resultBig">🤷</div>
      <div class="resultTxt" style="color:var(--dim)">No points scored yet!</div>`;
  }else if(champs.length===1){
    head=`<div class="resultBig">🏆</div>
      <div class="resultTxt" style="color:var(--green-deep)">Team ${champs[0]+1} wins!</div>
      <div class="ptTag">${best} point${best===1?'':'s'}</div>`;
    sndCorrect(); fireConfetti();
  }else{
    head=`<div class="resultBig">🤝</div>
      <div class="resultTxt" style="color:var(--yellow-deep)">It's a tie!</div>
      <div class="ptTag">Team ${champs.map(i=>i+1).join(' and Team ')} — ${best} point${best===1?'':'s'} each</div>`;
    sndCorrect(); fireConfetti();
  }

  const cards=ranked.map(({s,i})=>`
    <div class="groupCard ${champs.indexOf(i)>=0&&best>0?'active':''}">
      <h4>${champs.indexOf(i)>=0&&best>0?'🏆 ':''}Team ${i+1}</h4>
      <div class="gpts">${s}</div>
      <div class="members">${g.teams[i].map(id=>esc(stuName(c,id))).join('<br>')}</div>
    </div>`).join('');

  stage.innerHTML=`${head}
    <div class="groupGrid" style="margin-top:16px">${cards}</div>
    <div class="row" style="justify-content:center;margin-top:14px">
      <button class="pickBtn" id="againGroup">🎲 New Teams</button>
      <button class="btn ghost small" id="backGroup">Back to the board</button>
    </div>`;
  document.getElementById('againGroup').onclick=()=>{
    c.groupState=null; save(); showIdle();      // fresh teams, as they change every game
  };
  document.getElementById('backGroup').onclick=showGroupBoard;
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
  logAttempt(correct);        // group answers belong in the reports too, per answerer
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
  current.beat={ correct:0, total:0, timeLeft:S.quiz.beatSeconds, done:false, seen:[] };
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
  /* Don't ask the same question twice in one run. Tracked per run rather than
     in topic.usedQ, so a sprint never eats the pool the other modes draw from. */
  if(!current.beat.seen) current.beat.seen=[];
  let avail=bag.filter(x=>!current.beat.seen.includes(x.q.id));
  if(!avail.length){ current.beat.seen=[]; avail=bag; }   // whole topic answered, start over
  const pick=avail[Math.floor(Math.random()*avail.length)];
  current.beat.seen.push(pick.q.id);
  current.level=pick.l; current.question=pick.q;
  stage.innerHTML=`
    <div class="stageLabel">⏱️ <span id="beatTime">${current.beat.timeLeft}</span>s left · <b style="color:var(--green-deep)">${current.beat.correct} correct</b></div>
    ${imgTag(pick.q.img,'stageImg')}
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

/* ================== CLOUD SYNC ==================
   UI over sync.js. Two things are kept out of S on purpose:

   - the bookkeeping below (what the server held last time, whether this device
     has unsent changes) is per-device and must never travel in the payload
   - the encryption key, which lives in this variable and nowhere else. It is
     never written to disk, so closing the tab means typing the passphrase
     again. That is the point: a stolen laptop yields no readable names. */

const SYNC_META='quiz-sync-meta';
let cloudKey=null;                 // in memory only, for this tab, until reload

const EMPTY_META={lastSeen:null,dirty:false,lastSyncAt:null,attemptsSyncedTs:0};
function syncMeta(){
  try{ return Object.assign({},EMPTY_META,JSON.parse(localStorage.getItem(SYNC_META)||'null')); }
  catch(e){ return Object.assign({},EMPTY_META); }
}
function setSyncMeta(m){ try{ localStorage.setItem(SYNC_META,JSON.stringify(m)); }catch(e){} }
function markDirty(){
  const m=syncMeta();
  if(!m.dirty){ m.dirty=true; setSyncMeta(m); if(typeof renderCloud==='function') renderCloud(); }
  scheduleAutoSync();          // push once the teacher stops changing things
}

function deviceLabel(){
  const ua=navigator.userAgent;
  if(/Android|iPhone|iPad/i.test(ua)) return 'a phone or tablet';
  if(/Mac/i.test(ua)) return 'a Mac';
  if(/Windows/i.test(ua)) return 'a Windows computer';
  return 'a computer';
}

async function uiPassphrase(title,msg,ok='Continue'){
  const inp=document.getElementById('mInput');
  inp.type='password';
  try{ return await dlg({title,msg,input:true,ok}); }
  finally{ inp.type='text'; }
}

function cloudBody(){ return document.getElementById('cloudBody'); }

/* Sync runs by itself. The teacher signs in once per device and types the
   passphrase once per browser session; after that, changes go up on their own
   a few seconds after they stop editing. Pressing a button to save the day's
   scores is exactly the step a busy teacher forgets. */

let cloudBusy=false, unlockDeclined=false, syncProblem=null, autoTimer=null;
/* Quiet period before an automatic push. This used to be 8 seconds, which
   sounded responsive and was badly wrong: answers in a lesson arrive further
   apart than that, so the timer expired between every single one and uploaded
   the entire payload each time — roughly 25 full uploads per lesson. Two
   minutes outlasts the gaps between questions, so a lesson produces one upload
   at the end of it instead. Nothing is at risk in the meantime; localStorage
   already has it, and an unsent change is pushed on the next open. */
const AUTO_DELAY=120000;

function scheduleAutoSync(){
  if(!QuizSync.configured()||!QuizSync.currentUser()) return;
  clearTimeout(autoTimer);
  autoTimer=setTimeout(()=>doSync({auto:true}),AUTO_DELAY);
}

/* Waiting two minutes is fine while the teacher is still working. Switching
   away is the signal that they are done, so send it then rather than make the
   other computer wait for a timer that may never finish. */
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState!=='hidden') return;
  if(!cloudKey||!syncMeta().dirty) return;
  clearTimeout(autoTimer);
  doSync({auto:true});
});

function ago(ts){
  if(!ts) return '';
  const s=Math.round((Date.now()-ts)/1000);
  if(s<90) return 'just now';
  const m=Math.round(s/60); if(m<60) return m+' minute'+(m===1?'':'s')+' ago';
  const h=Math.round(m/60); if(h<24) return h+' hour'+(h===1?'':'s')+' ago';
  const d=Math.round(h/24); return d+' day'+(d===1?'':'s')+' ago';
}

function cloudStatus(){
  const m=syncMeta();
  if(syncProblem) return {text:syncProblem, colour:'var(--red)'};
  if(cloudBusy) return {text:'Syncing…', colour:'var(--dim)'};
  if(!cloudKey&&m.dirty) return {text:'Waiting for your passphrase to save your latest changes.', colour:'var(--yellow-deep)'};
  if(m.dirty) return {text:'Saving your latest changes…', colour:'var(--dim)'};
  if(m.lastSyncAt) return {text:'Everything is saved to the cloud · '+ago(m.lastSyncAt), colour:'var(--green-deep)'};
  return {text:'Nothing has been sent from this computer yet.', colour:'var(--dim)'};
}

function renderCloud(){
  const el=cloudBody(); if(!el) return;
  el.textContent='';
  const add=html=>{ const d=document.createElement('div'); d.innerHTML=html; el.appendChild(d); return d; };

  /* Only there when the browser says it can install — no dead button on a
     device that cannot, and it disappears once installed. */
  if(installPrompt){
    const box=add('<div class="row" style="margin-bottom:12px">'
      + '<button class="btn" id="doInstall">⬇ Install this app</button></div>'
      + '<p class="hint" style="margin:-6px 0 12px">Adds it to your Start menu or home screen, '
      + 'opens in its own window, and keeps working when the wifi drops.</p>');
    box.querySelector('#doInstall').onclick=doInstall;
  }

  if(!QuizSync.configured()){
    add('<p class="hint">Not set up yet. Cloud sync is optional — everything else works without it.'
      + ' To turn it on, follow <b>supabase/README.md</b> and fill in <b>supabase-config.js</b>.</p>');
    return;
  }

  const user=QuizSync.currentUser();
  if(!user){
    const dom=QuizSync.schoolDomain();
    const box=add('<div class="row"><button class="btn blue" id="cloudGoogle">Sign in with your school Google account</button></div>'
      + '<p class="hint" style="margin-top:8px">Use your <b>@'+esc(dom||'school')+'</b> account — the same one you use for school email. '
      + 'No password to remember here, and you only do this once on each computer.</p>'
      + '<details style="margin-top:10px"><summary class="hint" style="cursor:pointer">Sign in with a password instead</summary>'
      + '<div class="row" style="margin-top:8px"><input type="email" id="cloudEmail" placeholder="your school email">'
      + '<input type="password" id="cloudPass" placeholder="password"></div>'
      + '<div class="row" style="margin-top:8px"><button class="btn ghost small" id="cloudIn">Sign in</button></div>'
      + '<p class="hint" style="margin-top:6px">Only for accounts made before Google sign-in was set up.</p></details>');
    box.querySelector('#cloudGoogle').onclick=()=>{
      try{ QuizSync.signInWithGoogle(); }catch(e){ uiAlert('Could not start Google sign-in.\n'+e.message); }
    };
    box.querySelector('#cloudIn').onclick=doSignIn;
    box.querySelector('#cloudPass').addEventListener('keydown',e=>{ if(e.key==='Enter') doSignIn(); });
    return;
  }

  const st=cloudStatus();
  const box=add('<p class="hint" style="color:'+st.colour+';margin:0"><b>'+esc(user.email||'')+'</b><br>'+esc(st.text)+'</p>'
    + '<div class="row" style="margin-top:10px">'
    + '<button class="btn ghost small" id="cloudSync">🔄 Sync now</button>'
    + '<button class="btn ghost small" id="cloudOut">Sign out</button></div>');
  box.querySelector('#cloudSync').onclick=()=>doSync({manual:true});
  box.querySelector('#cloudOut').onclick=async ()=>{
    if(!await uiConfirm('Sign out of cloud sync?\nYour data stays on this computer.')) return;
    clearTimeout(autoTimer);
    await QuizSync.signOut();
    cloudKey=null; cloudSalt=null; cloudVerifier=null; unlockDeclined=false; syncProblem=null;
    renderCloud();
  };
}

/* Landing here from a confirmation or password-reset link. Say plainly what
   happened, because the alternative is a teacher who sees an ordinary page,
   assumes the link failed, and tries again. */
async function handleAuthRedirect(){
  if(!QuizSync.configured()) return;
  let r=null;
  try{ r=await QuizSync.consumeAuthRedirect(); }catch(e){ return; }
  if(!r) return;
  const tab=document.querySelector('nav button[data-tab="backup"]');
  if(tab) tab.click();
  renderCloud();
  if(r.ok){
    if(await rejectOutsideAccount(r.user)) return;
    uiAlert('Signed in ✔\nYou are signed in as '+(r.user&&r.user.email||'your account')
      +'.\n\nYour work will now be saved to the cloud on its own.');
    doSync({auto:true});
  } else {
    /* Everything that fails on the way back from Google or an email link lands
       here — an expired link, but also a refused sign-up or a misconfigured
       provider. Saying "links expire" for all of them sends the teacher looking
       in the wrong place, so let the shared translator name the real cause. */
    uiAlert(signInProblem(r.message||''));
  }
}

/* The database refuses anyone outside the school domain, so a personal account
   would sign in and then find every screen empty with no explanation. Catch it
   here and say so plainly instead. */
async function rejectOutsideAccount(user){
  if(!user||QuizSync.isSchoolAccount(user.email)) return false;
  await QuizSync.signOut();
  cloudKey=null; cloudSalt=null; cloudVerifier=null;
  renderCloud();
  uiAlert('That is not a school account.\n'+(user.email||'')
    +'\n\nCloud sync is only open to @'+QuizSync.schoolDomain()+' accounts. Sign in with your school one.');
  return true;
}

async function doSignIn(){
  const email=(document.getElementById('cloudEmail')||{}).value||'';
  const pass=(document.getElementById('cloudPass')||{}).value||'';
  if(!email.trim()||!pass){ uiAlert('Enter your email and password first.'); return; }
  try{
    const u=await QuizSync.signIn(email.trim(),pass);
    if(await rejectOutsideAccount(u)) return;
    syncProblem=null; unlockDeclined=false;
    renderCloud();
    showToast('Signed in ✔');
    doSync({manual:true});
  }catch(e){ uiAlert(signInProblem(e.message||'')); }
}

/* Supabase's own messages are written for developers. Translate the ones a
   teacher can actually hit into something they can act on. */
function signInProblem(msg){
  const m=msg.toLowerCase();
  if(m.indexOf('rate limit')>=0)
    return 'Too many emails for now.\nThe free email service allows only a few messages per hour, and that limit has been reached.\n\nWait an hour and try again, or ask whoever set this up to create your account from the Supabase dashboard — that needs no email at all.';
  if(m.indexOf('signup')>=0&&m.indexOf('not allowed')>=0 || m.indexOf('signup_disabled')>=0)
    return 'This account has not been used here before, and new accounts are currently closed.\n\n'
      +'Whoever set up the school\'s cloud sync needs to switch on "Allow new users to sign up" in Supabase. '
      +'After that, sign in with Google again — nothing else changes.';
  if(m.indexOf('expired')>=0||m.indexOf('otp_expired')>=0||m.indexOf('invalid or has expired')>=0)
    return 'That link has expired.\nAsk for a new one, or sign in with Google instead.';
  if(m.indexOf('provider is not enabled')>=0||m.indexOf('unsupported provider')>=0)
    return 'Google sign-in is not switched on for this project yet.\nWhoever set up the cloud sync needs to enable it in Supabase under Authentication → Providers.';
  if(m.indexOf('redirect')>=0)
    return 'The sign-in came back to an address this project does not recognise.\nThe app\'s address needs adding under Authentication → URL Configuration in Supabase.';
  if(m.indexOf('already registered')>=0||m.indexOf('already been registered')>=0)
    return 'That email already has an account.\nUse your password to sign in — no need to create it again.';
  if(m.indexOf('invalid login')>=0||m.indexOf('invalid credentials')>=0)
    return 'That email and password do not match an account.\nCheck for typos, and ask whoever set this up if you are not sure the account exists yet.';
  if(m.indexOf('not confirmed')>=0||m.indexOf('email not confirmed')>=0)
    return 'This account still needs confirming.\nAsk whoever set up the school\'s cloud sync to confirm it from the Supabase dashboard.';
  if(m.indexOf('password')>=0&&m.indexOf('6')>=0)
    return 'That password is too short — use at least 6 characters.';
  if(m.indexOf('failed to fetch')>=0||m.indexOf('networkerror')>=0)
    return 'No connection to the cloud.\nThe quiz itself works offline; it will sync when you are back online.';
  return 'Could not sign in.\n'+msg;
}

/* Unlocking: first time sets the passphrase, later times check it against the
   verifier stored with the row, so a typo is caught before it turns every
   name into unreadable text. Asked once per browser session, never stored. */
async function unlockKey(remote){
  if(cloudKey) return true;
  const firstTime=!(remote&&remote.exists&&remote.salt&&remote.verifier);
  if(firstTime){
    const p1=await uiPassphrase('Choose a passphrase',
      'This is what keeps your students\' names unreadable in the cloud. You type it once each time you open the app on a computer.\n\nIt is never sent anywhere and cannot be recovered — write it down somewhere safe.','Set');
    if(!p1||!p1.trim()) return false;
    if(p1.trim().length<8){ uiAlert('Please use at least 8 characters.'); return false; }
    const p2=await uiPassphrase('Type it once more','','Confirm');
    if(p2!==p1){ uiAlert('The two did not match. Nothing was changed.'); return false; }
    const salt=QuizSync.newSalt();
    cloudKey=await QuizSync.deriveKey(p1,salt);
    cloudSalt=salt; cloudVerifier=await QuizSync.makeVerifier(cloudKey);
    return true;
  }
  const p=await uiPassphrase('Your passphrase','Needed to read the student names stored in your account.','Unlock');
  if(!p) return false;
  const key=await QuizSync.deriveKey(p,remote.salt);
  if(!await QuizSync.checkVerifier(key,remote.verifier)){
    uiAlert('That passphrase does not match this account.\nNothing was changed.');
    return false;
  }
  cloudKey=key; cloudSalt=remote.salt; cloudVerifier=remote.verifier;
  return true;
}
let cloudSalt=null, cloudVerifier=null;

async function doSync(opts){
  opts=opts||{};
  if(cloudBusy) return;
  if(!QuizSync.configured()||!QuizSync.currentUser()) return;
  clearTimeout(autoTimer);
  cloudBusy=true; syncProblem=null; renderCloud();
  try{
    const remote=await QuizSync.fetchRemoteMeta();   // four columns, not the year's work
    const m=syncMeta();
    const hasState=Object.keys(S.classes).length>0||Object.keys(S.subjects).length>0;
    let d=QuizSync.decideSync({hasState,dirty:m.dirty,lastSeen:m.lastSeen},remote);

    if(d.action==='none'){
      if(opts.manual) showToast('Already up to date ✔');
      return;
    }

    if(d.action==='conflict'){
      /* Never interrupt a lesson with this. On an automatic run just say so and
         wait for the teacher to come and choose. */
      if(!opts.manual){
        syncProblem='The cloud has a different copy, saved from '+(remote.device||'another device')
          +'. Press Sync now to choose which one to keep.';
        return;
      }
      const keepMine=await dlg({ title:'This computer and the cloud both changed',
        msg:'The copy in the cloud was last saved from '+(remote.device||'another device')
          +'.\n\nKeep this computer\'s version and overwrite the cloud, or take the cloud version and replace what is here?'
          +'\n\nWhichever you drop is lost, so export a backup first if you are unsure.',
        ok:'Keep this computer', cancel:'Take the cloud version' });
      if(keepMine===null) return;
      d={action: keepMine===true?'push':'pull'};
    }

    if(!cloudKey){
      if(!opts.manual&&unlockDeclined) return;         // asked once already this session
      if(!await unlockKey(remote)){
        if(!opts.manual) unlockDeclined=true;
        syncProblem='Locked. Press Sync now and enter your passphrase to save to the cloud.';
        return;
      }
    }

    if(d.action==='push'){
      /* Answers first: they go as their own rows, and only the ones this
         device has not sent yet. Resending a few is harmless — the id is the
         key — so the mark is deliberately conservative. */
      const since=m.attemptsSyncedTs||0;
      const fresh=(S.attempts||[]).filter(a=>a.ts>=since);
      if(fresh.length) await QuizSync.pushAttempts(fresh);
      const newestTs=(S.attempts||[]).reduce((n,a)=>Math.max(n,a.ts||0),since);

      const enc=await QuizSync.encryptState(cloudKey,S);   // no answers inside
      const at=await QuizSync.pushRemote(enc,cloudSalt,cloudVerifier,deviceLabel());
      setSyncMeta({lastSeen:at,dirty:false,lastSyncAt:Date.now(),attemptsSyncedTs:newestTs});
      if(opts.manual) showToast('Saved to the cloud ✔');
    } else if(d.action==='pull'){
      const payload=await QuizSync.fetchRemotePayload();   // only now is it worth downloading
      const out=await QuizSync.decryptState(cloudKey,payload||{});
      const data=out.state;
      if(!data.classes||!data.subjects){
        syncProblem='The copy in the cloud is not readable as quiz data. Nothing here was changed.';
        return;
      }
      /* Same replace-and-normalise path as importing a backup file: this is a
         full snapshot, so anything only on this computer is meant to go. */
      S=Object.assign({schemaVersion:SCHEMA},data);
      if(!S.trash) S.trash=[]; if(!S.attempts) S.attempts=[];
      if(!S.quiz) S.quiz={mode:'individual',levelPick:'wheel',groups:3,beatSeconds:60};
      Object.values(S.classes).forEach(c=>{ if(!c.absent)c.absent=[]; if(!c.picked)c.picked=[]; if(!c.scores)c.scores={}; });
      /* Answers are no longer in the payload, so bring them from their own
         table. A device syncing for the first time gets the lot — a one-off
         cost on that device, not something every open pays. */
      try{
        const rows=await QuizSync.fetchAttempts(0);
        const seen={}, merged=[];
        rows.concat(data.attempts||[]).forEach(a=>{ if(a&&a.id&&!seen[a.id]){ seen[a.id]=1; merged.push(a); } });
        S.attempts=merged.sort((x,y)=>(x.ts||0)-(y.ts||0));
      }catch(e){ S.attempts=data.attempts||[]; }   // reports can wait; the plan matters more
      undoStack=[];
      ensureActive(); save(); await flushSave();
      const newestPulled=(S.attempts||[]).reduce((n,a)=>Math.max(n,a.ts||0),0);
      setSyncMeta({lastSeen:remote.updatedAt,dirty:false,lastSyncAt:Date.now(),attemptsSyncedTs:newestPulled});  // after flushSave, which marks dirty
      document.getElementById('soundBtn').textContent=S.sound?'🔊':'🔇';
      initQuizSettings(); refreshAll(); renderBackupStatus(); renderTrash();
      showToast(out.failed? ('Loaded, but '+out.failed+' name(s) could not be read') : 'Loaded from the cloud ✔');
    }
  }catch(e){
    const msg=e&&e.message||'';
    if(/failed to fetch|networkerror/i.test(msg)) syncProblem='No connection — your work is saved on this computer and will sync later.';
    else if(/not signed in/i.test(msg)) syncProblem='Signed out. Sign in again to keep syncing.';
    else syncProblem='Could not sync: '+msg;
    if(opts.manual) uiAlert('Sync did not finish.\n'+syncProblem);
  }finally{
    cloudBusy=false;
    renderCloud();
  }
}


/* ================== INSTALLABLE APP ==================
   Registering the service worker is what makes the browser offer "Install" and
   what gives real offline, rather than relying on the HTTP cache happening to
   still hold the files. It only works over https, so opening index.html
   straight from a folder simply skips it — the app is unaffected either way. */
function registerServiceWorker(){
  if(!('serviceWorker' in navigator)) return;
  if(location.protocol!=='https:'&&location.hostname!=='localhost'&&location.hostname!=='127.0.0.1') return;
  navigator.serviceWorker.register('sw.js').catch(()=>{});   // never block the app on this
}

/* Chrome fires this instead of showing its own prompt, so the offer has to be
   made somewhere the teacher will see it. The Backup tab is where the cloud
   card already lives, which is the same conversation. */
let installPrompt=null;
window.addEventListener('beforeinstallprompt',e=>{
  e.preventDefault(); installPrompt=e;
  if(typeof renderCloud==='function') renderCloud();
});
window.addEventListener('appinstalled',()=>{
  installPrompt=null;
  if(typeof renderCloud==='function') renderCloud();
  showToast('Installed ✔ You can open it from your Start menu or home screen now.');
});
async function doInstall(){
  if(!installPrompt) return;
  const p=installPrompt; installPrompt=null;
  try{ await p.prompt(); }catch(e){}
  renderCloud();
}

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
  if(!S.sound) sndSpinStop();   // muting has to silence the loop already playing
};
(async function init(){
  await load();
  if(!S.trash) S.trash=[];
  if(!S.attempts) S.attempts=[];
  if(S.lastBackup===undefined) S.lastBackup=null;
  if(!S.quiz) S.quiz={mode:'individual',levelPick:'wheel',groups:3,beatSeconds:60};
  /* schema 8: answers gained an id so they can be synced one row at a time.
     Older records have none — give them one, or the first sync would upload
     them again on every device. */
  S.attempts.forEach(a=>{ if(!a.id) a.id=newId('a'); });
  S.schemaVersion=SCHEMA;
  Object.values(S.classes).forEach(c=>{ if(!c.absent)c.absent=[]; if(!c.picked)c.picked=[]; if(!c.scores)c.scores={}; });
  if(pruneTrash()|pruneAttempts()) save();
  document.getElementById('soundBtn').textContent=S.sound?'🔊':'🔇';
  initQuizSettings();
  wireQuestionPictures();          // once only: it attaches a document-level paste listener
  registerServiceWorker();
  renderClasses(); renderBank(); renderSelectors(); showIdle();
  renderCloud();
  handleAuthRedirect();
  /* Pick up anything the other computer sent, and send anything left over from
     last time. Silent when there is nothing to do, so opening the app offline
     or with nothing changed asks for no passphrase and shows no dialog. */
  setTimeout(()=>doSync({auto:true}),1200);
  setTimeout(maybeRemindBackup,2500);
})();
