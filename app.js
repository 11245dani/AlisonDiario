/* ============================================================
   MI JARDÍN INTERIOR — JavaScript
   Firebase Firestore — sincronización en tiempo real
   ============================================================ */

// ── Firebase SDK ────────────────────────────────────────────
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getFirestore,
  doc, setDoc, updateDoc, deleteDoc,
  collection, onSnapshot, query, orderBy
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyDZOHSqPlmtCabdmHYxc29T5h9GqpINa1Y",
  authDomain: "alisonj-8cc94.firebaseapp.com",
  projectId: "alisonj-8cc94",
  storageBucket: "alisonj-8cc94.firebasestorage.app",
  messagingSenderId: "178036652468",
  appId: "1:178036652468:web:e40c7cd1688ef76de05ae1"
};

const fbApp = initializeApp(firebaseConfig);
const db    = getFirestore(fbApp);

// ── Referencias Firestore ───────────────────────────────────
const LIZ_MAIN    = () => doc(db, 'jardin_alison', 'alison_data');
const ENTRIES_COL = () => collection(db, 'jardin_alison', 'alison_data', 'entries');
const BUZZON_COL  = () => collection(db, 'jardin_alison', 'alison_data', 'buzzon');
// 🆕 Colección de moods diarios independientes del diario
const MOODS_COL   = () => collection(db, 'jardin_alison', 'alison_data', 'daily_moods');
const ENTRY_DOC   = (id) => doc(db, 'jardin_alison', 'alison_data', 'entries', String(id));
const BUZZON_DOC  = (id) => doc(db, 'jardin_alison', 'alison_data', 'buzzon',  String(id));
const MOOD_DOC    = (dateStr) => doc(db, 'jardin_alison', 'alison_data', 'daily_moods', dateStr);

// ── Escritura en la nube ────────────────────────────────────
async function cloudSaveMain(data) {
  try { await setDoc(LIZ_MAIN(), { ...data, _ts: Date.now() }, { merge: true }); }
  catch(e) { console.error('cloudSaveMain:', e); }
}
async function cloudSaveEntry(entry) {
  try { await setDoc(ENTRY_DOC(entry.id), entry); }
  catch(e) { console.error('cloudSaveEntry:', e); showToast('Error al guardar 📝'); }
}
async function cloudDeleteEntry(id) {
  try { await deleteDoc(ENTRY_DOC(id)); }
  catch(e) { console.error('cloudDeleteEntry:', e); }
}
async function cloudSaveBuzzon(msg) {
  try { await setDoc(BUZZON_DOC(msg.id), msg); }
  catch(e) { console.error('cloudSaveBuzzon:', e); showToast('Error al enviar 💌'); }
}
async function cloudUpdateBuzzon(id, partial) {
  try { await updateDoc(BUZZON_DOC(id), partial); }
  catch(e) { console.error('cloudUpdateBuzzon:', e); }
}

// 🆕 Guardar mood del día — soporta múltiples emociones por día
async function cloudSaveDailyMood(moodData) {
  const dateKey = moodData.date || todayStr();
  try {
    // Leer el doc actual para acumular moods
    const { getDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const existing = await getDoc(MOOD_DOC(dateKey));
    let moods = [];
    if (existing.exists()) {
      const d = existing.data();
      moods = d.moods || (d.mood ? [{ mood: d.mood, moodEmoji: d.moodEmoji, scale: d.scale, confirmedAt: d.confirmedAt || d.date }] : []);
    }
    // Evitar duplicados exactos del mismo mood en segundos
    const alreadyHas = moods.some(m => m.mood === moodData.mood);
    if (!alreadyHas) moods.push({ mood: moodData.mood, moodEmoji: moodData.moodEmoji, scale: moodData.scale, confirmedAt: new Date().toISOString() });
    const primary = moods[moods.length - 1];
    await setDoc(MOOD_DOC(dateKey), {
      date: dateKey,
      moods,
      mood: primary.mood,
      moodEmoji: primary.moodEmoji,
      scale: primary.scale,
      motivationalMsg: moodData.motivationalMsg,
      wateredTree: moodData.wateredTree || false,
      _ts: Date.now()
    });
  } catch(e) { console.error('cloudSaveDailyMood:', e); }
}

// ── saveState / loadState ───────────────────────────────────
function saveState() {
  cloudSaveMain({
    tree: state.tree, today: state.today,
    achievements: state.achievements, capsules: state.capsules || []
  });
  try {
    localStorage.setItem('alison_local_v1', JSON.stringify({
      drafts: state.drafts, chatHistory: state.chatHistory
    }));
  } catch(e) {}
}
function loadState() {
  try {
    const s = localStorage.getItem('alison_local_v1');
    if (s) { const p = JSON.parse(s); state.drafts = p.drafts||[]; state.chatHistory = p.chatHistory||[]; }
  } catch(e) {}
}

// ── Listeners en tiempo real ────────────────────────────────
function startRealtimeSync() {
  // Doc principal: árbol, mood, logros, cápsulas
  onSnapshot(LIZ_MAIN(), (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    if (data.tree)         state.tree         = { ...defaultState.tree, ...data.tree };
    if (data.achievements) state.achievements  = data.achievements || {};
    if (data.capsules)     state.capsules      = data.capsules || [];
    if (data.today) {
      if (data.today.date === todayStr()) {
        state.today = { ...defaultState.today, ...data.today };
        _restoreMoodUI();
      } else {
        state.today  = { ...defaultState.today };
        selectedMood = null;
      }
    }
    updateAIContextPill();
    if (document.getElementById('tab-tree')?.classList.contains('active'))            renderTree();
    if (document.getElementById('epanel-achievements')?.classList.contains('active')) renderAchievements();
    if (document.getElementById('epanel-capsule')?.classList.contains('active'))      renderCapsules();
  });

  // Entradas del diario — tiempo real para ambos dispositivos
  onSnapshot(query(ENTRIES_COL(), orderBy('date', 'desc')), (snap) => {
    state.entries = snap.docs.map(d => d.data());
    renderEntries();
    if (document.getElementById('epanel-calendar')?.classList.contains('active')) renderCalendar();
  });

  // 🆕 Moods diarios independientes — para el calendario
  onSnapshot(query(MOODS_COL(), orderBy('date', 'desc')), (snap) => {
    state.dailyMoods = snap.docs.map(d => d.data());
    if (document.getElementById('epanel-calendar')?.classList.contains('active')) renderCalendar();
  });

  // Buzón de Dani — tiempo real
  onSnapshot(query(BUZZON_COL(), orderBy('date', 'desc')), (snap) => {
    state.buzzon = snap.docs.map(d => d.data());
    updateUnreadBadge();
    if (document.getElementById('dpanel-buzzon')?.classList.contains('active')) renderBuzzon();
  });
}

function _restoreMoodUI() {
  if (!state.today.mood) return;
  selectedMood = state.today.mood;
  document.querySelectorAll('.mood-btn').forEach(btn =>
    btn.classList.toggle('selected', btn.dataset.mood === selectedMood));
  const se = document.getElementById('mood-scale');
  const sv = document.getElementById('scale-value');
  if (se) se.value = state.today.scale || 7;
  if (sv) sv.textContent = state.today.scale || 7;
  if (state.today.motivationalMsg) {
    const emojis = { feliz:'💛',enamorada:'💕',tranquila:'😌',triste:'💙',enojada:'🔥',ansiosa:'🌿',cansada:'🌙',esperanzada:'🌟' };
    const el = document.getElementById('motivational-msg');
    const mt = document.getElementById('msg-text');
    const mi = document.getElementById('msg-icon');
    if (el) el.style.display = 'block';
    if (mt) mt.textContent   = state.today.motivationalMsg;
    if (mi) mi.textContent   = emojis[state.today.mood] || '💌';
  }
  // Restaurar el remember de emociones del día
  renderTodayMoodsRemember();
}

// ============================================================
gsap.registerPlugin(ScrollTrigger);

// ===================== INTRO SCREEN =====================
const INTRO_DURATION = 6000; // ms before auto-dismiss
let introSkipped = false;

function initIntroParticles() {
  const container = document.getElementById('intro-particles');
  if (!container) return;
  const emojis = ['🌸','🌺','🌷','💮','✨','💕','🌸','🌸'];
  for (let i = 0; i < 20; i++) {
    const p = document.createElement('div');
    p.className = 'intro-particle';
    p.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    p.style.cssText = `
      left:${Math.random() * 100}%;
      top:${Math.random() * 100}%;
      animation-duration:${9 + Math.random() * 10}s;
      animation-delay:${Math.random() * 8}s;
      font-size:${10 + Math.random() * 12}px;
    `;
    container.appendChild(p);
  }
}

function initIntroScreen() {
  const introOverlay = document.getElementById('intro-overlay');
  const introSkipBtn = document.getElementById('intro-skip');

  if (!introOverlay) {
    console.warn('Intro overlay not found');
    return;
  }

  // Spawn particles inside the intro
  initIntroParticles();

  // Lock scroll while intro is visible
  document.body.classList.add('intro-active');

  // ── Dismiss logic ─────────────────────────────────────────
  function skipIntro() {
    if (introSkipped) return;
    introSkipped = true;
    clearTimeout(autoSkipTimer);
    document.removeEventListener('keydown', handleKeyDown);

    // GSAP fade-out — same ease used everywhere for exits
    gsap.to(introOverlay, {
      opacity: 0,
      duration: 0.65,
      ease: 'power2.inOut',
      onComplete: () => {
        introOverlay.classList.add('hidden');
        document.body.classList.remove('intro-active');
        // Animate hero content in after intro exits (same as tab switch)
        gsap.fromTo('.diary-hero', { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out' });
      }
    });
  }

  // Button click
  if (introSkipBtn) introSkipBtn.addEventListener('click', skipIntro);

  // Keyboard: Escape skips; any other key also skips (after content has appeared)
  function handleKeyDown(e) {
    if (e.key === 'Escape') { skipIntro(); return; }
    // Any key after animations have had time to play (≥1.5 s)
    if (performance.now() > 1500) skipIntro();
  }
  document.addEventListener('keydown', handleKeyDown);

  // Auto-dismiss after duration
  const autoSkipTimer = setTimeout(() => {
    if (!introSkipped) skipIntro();
  }, INTRO_DURATION);
}

// ===================== ESTADO GLOBAL =====================
const defaultState = {
  entries: [], drafts: [],
  tree: { level:1, waterDays:0, lastWatered:null, messages:[], totalMessages:0 },
  today: { mood:null, moodEmoji:null, scale:7, motivationalMsg:null, confirmed:false, date:null },
  buzzon: [], chatHistory: [], capsules: [], achievements: {}, calendarMonth: null,
  dailyMoods: [] // 🆕 moods independientes para el calendario
};
let state        = JSON.parse(JSON.stringify(defaultState));
let selectedMood = null;

// ===================== MENSAJES MOTIVACIONALES =====================
const messages = {
  feliz:       ["💛 Tu felicidad ilumina todo a tu alrededor. Hoy brillas como nunca.","🌟 Qué hermoso ver que estás bien. Mereces cada momento de alegría.","✨ Tu sonrisa es la mejor flor de este jardín. Cuídala mucho.","🌸 Días como hoy son los que guardan los mejores recuerdos."],
  enamorada:   ["🥰 El amor que sientes es tan real y tan bonito. Abraza ese sentimiento.","💕 Estar enamorada es uno de los regalos más hermosos de la vida.","🌹 Tu corazón está floreciendo. Que ese amor te llene de luz.","💖 Lo que sientes no se mide, se vive. Vívelo completamente."],
  tranquila:   ["😌 La paz que tienes hoy es un regalo. Disfruta cada segundo.","🕊️ Estar en calma es también una forma de estar bien. Lo estás logrando.","🌿 La tranquilidad también es fuerza. Eres más fuerte de lo que crees.","🌊 Fluye como el agua. Hoy el universo está en armonía contigo."],
  triste:      ["💙 Está bien no estar bien. Las lágrimas también limpian el alma.","🌧️ Las noches más oscuras siempre tienen su amanecer. Tú lo sabrás ver.","🤍 Eres tan valiente por seguir. Cada paso que das importa.","🌸 Los días tristes también son días válidos. No te exijas más de lo que puedes."],
  enojada:     ["🔥 Tu enojo es válido. Lo que sientes importa y merece ser escuchado.","💪 Respira. Eres más grande que cualquier cosa que te haga enojar.","🌬️ Deja salir lo que sientes, después vendrá la calma. Siempre viene.","✨ Tu fuerza se nota hasta cuando estás molesta. Eso también es poder."],
  ansiosa:     ["🌿 Respira. Tres segundos dentro, tres afuera. Tú puedes con esto.","💙 La ansiedad miente. Eres capaz de mucho más de lo que crees ahora.","🕊️ Hoy solo tienes que hacer una cosa a la vez. Empecemos por respirar.","🌸 No tienes que resolverlo todo hoy. Estás bien, aquí, en este momento."],
  cansada:     ["🛌 Descansar también es productivo. Tu cuerpo te está pidiendo amor.","🌙 Hasta las flores más hermosas necesitan la noche para recuperarse.","💕 No te exijas más de lo que puedes hoy. Mañana será otro día.","🤍 El cansancio también es señal de que has dado mucho. Recárgate."],
  esperanzada: ["🌟 La esperanza que tienes hoy es semilla de algo hermoso mañana.","🌱 Creer en que viene algo mejor ya es un acto de valentía.","✨ Esa luz que ves al final del túnel... eres tú misma quien la pone.","🌸 La esperanza es el jardín más bello que existe. Síguela regando."],
  default:     ["💕 Hoy estás aquí, y eso ya es suficiente. Eres suficiente.","🌸 Cada día que escribes en este diario es un paso hacia ti misma.","✨ Tú eres la historia más hermosa que has vivido.","💖 Gracias por cuidarte. Este jardín crece contigo."]
};
function getMotivationalMsg(mood, scale) {
  if (scale <= 3) { const p = messages.triste; return p[Math.floor(Math.random()*p.length)]; }
  const pool = messages[mood] || messages.default;
  return pool[Math.floor(Math.random()*pool.length)];
}

// ===================== FECHA =====================
function formatDate(date) { return new Date(date).toLocaleDateString('es-ES',{weekday:'long',year:'numeric',month:'long',day:'numeric'}); }
function formatDateShort(date) { return new Date(date).toLocaleDateString('es-ES',{day:'2-digit',month:'short',year:'numeric'}); }
function isSameDay(d1,d2) { const a=new Date(d1),b=new Date(d2); return a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate(); }
// FIX: Usar fecha local en lugar de UTC para que coincida siempre con la fecha actual del usuario
function todayStr() { 
  const today = new Date(); 
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ===================== PARTICLES =====================
function initParticles() {
  const container = document.getElementById('particles');
  const emojis = ['🌸','🌺','🌷','💮','🌸','✨','💕','🌸'];
  for (let i=0;i<18;i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.textContent = emojis[Math.floor(Math.random()*emojis.length)];
    p.style.cssText = `left:${Math.random()*100}%;top:${Math.random()*100}%;animation-duration:${8+Math.random()*12}s;animation-delay:${Math.random()*10}s;font-size:${10+Math.random()*14}px;`;
    container.appendChild(p);
  }
}

// ===================== NAVEGACIÓN (FIX PRINCIPAL) =====================
// FIX: Se verifican las secciones antes de manipularlas para evitar errores silenciosos
document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;
    const section = document.getElementById('tab-' + target);
    if (!section) { console.warn('Sección no encontrada: tab-' + target); return; }

    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    tab.classList.add('active');
    section.classList.add('active');

    // Scroll al tope al cambiar de sección
    window.scrollTo({ top: 0, behavior: 'smooth' });

    gsap.fromTo(section, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out' });

    if (target === 'tree')   renderTree();
    if (target === 'dani')   initDaniTab();
    if (target === 'extras') initExtrasTab();
  });
});

document.getElementById('today-date').textContent = formatDate(new Date());

// ===================== MOOD SELECTOR =====================
document.querySelectorAll('.mood-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedMood           = btn.dataset.mood;
    state.today.mood       = selectedMood;
    state.today.moodEmoji  = btn.dataset.emoji;
    state.today.date       = todayStr();
    gsap.fromTo(btn,{scale:1},{scale:1.15,duration:0.15,yoyo:true,repeat:1,ease:'power2.out'});
    showMotivationalMsg();
    // Guardar mood inmediatamente en la nube para que Dani lo vea
    cloudSaveMain({ today: state.today });
  });
});

const scaleInput = document.getElementById('mood-scale');
const scaleVal   = document.getElementById('scale-value');
scaleInput.addEventListener('input', () => {
  scaleVal.textContent    = scaleInput.value;
  state.today.scale       = parseInt(scaleInput.value);
  if (selectedMood) showMotivationalMsg();
});

function showMotivationalMsg() {
  const msg = getMotivationalMsg(state.today.mood, state.today.scale);
  state.today.motivationalMsg = msg;
  const el = document.getElementById('motivational-msg');
  document.getElementById('msg-text').textContent = msg;
  const emojis = {feliz:'💛',enamorada:'💕',tranquila:'😌',triste:'💙',enojada:'🔥',ansiosa:'🌿',cansada:'🌙',esperanzada:'🌟'};
  document.getElementById('msg-icon').textContent = emojis[state.today.mood] || '💌';
  el.style.display = 'block';
  gsap.fromTo('.msg-bubble',{opacity:0,y:15,scale:0.95},{opacity:1,y:0,scale:1,duration:0.5,ease:'back.out(1.7)'});
}

// FIX: Al confirmar el mood se guarda en su propia colección para el calendario
// Permite múltiples emociones por día
document.getElementById('confirm-mood-btn').addEventListener('click', async () => {
  if (!selectedMood) { showToast('Selecciona cómo te sientes primero 🌸'); return; }
  state.today.confirmed = true;
  state.today.date      = todayStr();

  // Inicializar array de moods del día si no existe
  if (!state.today.moodsToday) state.today.moodsToday = [];
  const alreadyHas = state.today.moodsToday.some(m => m.mood === selectedMood);
  if (!alreadyHas) {
    state.today.moodsToday.push({ mood: state.today.mood, moodEmoji: state.today.moodEmoji, scale: state.today.scale, time: new Date().toISOString() });
  }

  // Guardar en doc principal
  cloudSaveMain({ today: state.today });

  // Guardar en colección de moods diarios (acumula automáticamente)
  await cloudSaveDailyMood({
    date:     todayStr(),
    mood:     state.today.mood,
    moodEmoji: state.today.moodEmoji,
    scale:    state.today.scale,
    motivationalMsg: state.today.motivationalMsg,
    confirmedAt: new Date().toISOString()
  });

  checkAchievements();

  // Actualizar la sección "remember" de emociones del día
  renderTodayMoodsRemember();

  const moodsCount = state.today.moodsToday.length;
  if (moodsCount > 1) {
    showToast(`¡Tienes una mezcla de emociones hoy! 🌈 (${moodsCount} estados guardados)`, true);
  } else {
    showToast('Estado guardado 💕 ¡Gracias por compartir cómo te sientes!', true);
  }
  gsap.to('#mood-section',{scale:0.98,opacity:0.7,duration:0.3,yoyo:true,repeat:1});
});

// ===================== REMEMBER DE EMOCIONES DEL DÍA =====================
function renderTodayMoodsRemember() {
  const container = document.getElementById('today-moods-remember');
  if (!container) return;
  const moods = state.today.moodsToday || [];
  if (moods.length === 0) { container.style.display='none'; return; }
  container.style.display = 'block';
  const isMulti = moods.length > 1;
  const colors = moods.map(m => MOOD_COLORS[m.mood]||'#FFD6E7');
  const gradBg = colors.length > 1 
    ? `linear-gradient(135deg, ${colors.map((c,i)=>`${c}44 ${Math.round(i/(colors.length-1)*100)}%`).join(', ')})` 
    : `${colors[0]}33`;
  container.style.background = gradBg;
  const chipsHTML = moods.map(m=>`<span class="remember-chip" style="background:${MOOD_COLORS[m.mood]||'#FFD6E7'}55;border-color:${MOOD_COLORS[m.mood]||'#FFD6E7'}">${m.moodEmoji||'✨'} ${m.mood}</span>`).join('');
  container.innerHTML = `
    <div class="remember-inner">
      <div class="remember-icon">${isMulti?'🌈':'🌸'}</div>
      <div class="remember-text">
        <p class="remember-label">${isMulti?'Mezcla de emociones de hoy':'Tu estado de hoy'}</p>
        <div class="remember-chips">${chipsHTML}</div>
      </div>
      <button class="remember-add-btn" id="remember-add-btn" title="Agregar otra emoción">+ Agregar</button>
    </div>`;
  document.getElementById('remember-add-btn')?.addEventListener('click', ()=>{
    document.querySelectorAll('.mood-btn').forEach(b=>b.classList.remove('selected'));
    selectedMood = null;
    document.getElementById('mood-section').scrollIntoView({behavior:'smooth', block:'center'});
    showToast('Selecciona otra emoción para agregar 🌸');
  });
}

// ===================== DIARY =====================
const diaryTextarea = document.getElementById('diary-text');
const charCount     = document.getElementById('char-count');

diaryTextarea.addEventListener('input', () => {
  const words = diaryTextarea.value.trim()===''?0:diaryTextarea.value.trim().split(/\s+/).length;
  charCount.textContent = words;
});

document.getElementById('save-entry-btn').addEventListener('click', async () => {
  const text = diaryTextarea.value.trim();
  if (!text) { showToast('Escribe algo primero 📝'); return; }
  const title = document.getElementById('entry-title').value.trim() || 'Sin título';
  const entry = {
    id: Date.now(), title, text,
    mood: state.today.mood, moodEmoji: state.today.moodEmoji,
    scale: state.today.scale, motivationalMsg: state.today.motivationalMsg,
    date: new Date().toISOString()
  };
  await cloudSaveEntry(entry); // el listener actualiza state.entries y renderiza

  // 🆕 Si hay mood del día, también guardar/actualizar el mood diario
  // para que el calendario quede coloreado aunque no haya entrada previa
  if (state.today.mood) {
    await cloudSaveDailyMood({
      date:     todayStr(),
      mood:     state.today.mood,
      moodEmoji: state.today.moodEmoji,
      scale:    state.today.scale,
      motivationalMsg: state.today.motivationalMsg
    });
  }

  checkAchievements();
  diaryTextarea.value = '';
  document.getElementById('entry-title').value = '';
  charCount.textContent = '0';
  showToast('¡Entrada guardada con amor! 💕', true);
  gsap.fromTo('#save-entry-btn',{scale:1},{scale:1.1,duration:0.15,yoyo:true,repeat:1});
});

function renderEntries() {
  const list  = document.getElementById('entries-list');
  const empty = document.getElementById('empty-diary');
  const count = document.getElementById('entries-count');
  count.textContent = `${state.entries.length} ${state.entries.length===1?'entrada':'entradas'}`;
  if (state.entries.length===0) { list.innerHTML=''; list.appendChild(empty); return; }
  list.innerHTML = '';
  state.entries.forEach((entry,i) => {
    const item = document.createElement('div');
    item.className = 'entry-item';
    item.innerHTML = `
      <div class="entry-emoji">${entry.moodEmoji||'📝'}</div>
      <div class="entry-info">
        <div class="entry-name">${entry.title}</div>
        <div class="entry-preview">${entry.text.substring(0,80)}${entry.text.length>80?'...':''}</div>
      </div>
      <div class="entry-meta">
        <div class="entry-date">${formatDateShort(entry.date)}</div>
        ${entry.scale?`<div class="entry-scale">✨ ${entry.scale}/10</div>`:''}
      </div>`;
    item.addEventListener('click',()=>openEntryModal(entry));
    list.appendChild(item);
    gsap.fromTo(item,{opacity:0,x:-20},{opacity:1,x:0,duration:0.35,delay:i*0.05,ease:'power2.out'});
  });
}

// ===================== MODAL ENTRADA =====================
function openEntryModal(entry) {
  document.getElementById('modal-mood-emoji').textContent = entry.moodEmoji||'📝';
  document.getElementById('modal-title').textContent      = entry.title;
  document.getElementById('modal-date').textContent       = formatDate(entry.date);
  document.getElementById('modal-body').textContent       = entry.text;
  const motEl = document.getElementById('modal-motivational');
  if (entry.motivationalMsg) { motEl.textContent='💌 '+entry.motivationalMsg; motEl.style.display='block'; }
  else { motEl.style.display='none'; }
  const modal = document.getElementById('entry-modal');
  modal.style.display = 'flex';
  document.getElementById('modal-delete').onclick = async () => {
    await cloudDeleteEntry(entry.id);
    modal.style.display = 'none';
    showToast('Entrada eliminada');
  };
}
document.getElementById('modal-close').addEventListener('click',()=>{ document.getElementById('entry-modal').style.display='none'; });
document.getElementById('entry-modal').addEventListener('click',e=>{ if(e.target===e.currentTarget) e.currentTarget.style.display='none'; });

// ===================== CANVAS =====================
const canvas = document.getElementById('drawing-canvas');
const ctx    = canvas.getContext('2d');
let isDrawing=false,currentTool='pen',currentColor='#FFB3C1',brushSize=5,lastX=0,lastY=0;
ctx.fillStyle='#FFFFFF'; ctx.fillRect(0,0,canvas.width,canvas.height);

function getPos(e) {
  const rect=canvas.getBoundingClientRect();
  const sx=canvas.width/rect.width,sy=canvas.height/rect.height;
  if(e.touches) return{x:(e.touches[0].clientX-rect.left)*sx,y:(e.touches[0].clientY-rect.top)*sy};
  return{x:(e.clientX-rect.left)*sx,y:(e.clientY-rect.top)*sy};
}
canvas.addEventListener('mousedown',startDraw); canvas.addEventListener('mousemove',draw);
canvas.addEventListener('mouseup',endDraw);     canvas.addEventListener('mouseleave',endDraw);
canvas.addEventListener('touchstart',e=>{e.preventDefault();startDraw(e);},{passive:false});
canvas.addEventListener('touchmove', e=>{e.preventDefault();draw(e);},{passive:false});
canvas.addEventListener('touchend',endDraw);

function startDraw(e){isDrawing=true;const p=getPos(e);lastX=p.x;lastY=p.y;if(currentTool==='fill'){fillCanvas(currentColor);isDrawing=false;}}
function draw(e){if(!isDrawing||currentTool==='fill')return;const p=getPos(e);ctx.beginPath();ctx.moveTo(lastX,lastY);ctx.lineTo(p.x,p.y);ctx.strokeStyle=currentTool==='eraser'?'#FFFFFF':currentColor;ctx.lineWidth=currentTool==='eraser'?brushSize*3:brushSize;ctx.lineCap='round';ctx.lineJoin='round';ctx.stroke();lastX=p.x;lastY=p.y;}
function endDraw(){isDrawing=false;}
function fillCanvas(color){ctx.fillStyle=color;ctx.fillRect(0,0,canvas.width,canvas.height);}

document.getElementById('tool-pen').addEventListener('click',()=>setTool('pen'));
document.getElementById('tool-eraser').addEventListener('click',()=>setTool('eraser'));
document.getElementById('tool-fill').addEventListener('click',()=>setTool('fill'));
function setTool(tool){currentTool=tool;document.querySelectorAll('.tool-btn').forEach(b=>b.classList.remove('active'));document.getElementById('tool-'+tool).classList.add('active');}

document.querySelectorAll('.color-swatch').forEach(sw=>{
  sw.addEventListener('click',()=>{document.querySelectorAll('.color-swatch').forEach(s=>s.classList.remove('active'));sw.classList.add('active');currentColor=sw.dataset.color;document.getElementById('custom-color').value=currentColor;});
});
document.getElementById('custom-color').addEventListener('input',e=>{currentColor=e.target.value;document.querySelectorAll('.color-swatch').forEach(s=>s.classList.remove('active'));});
document.getElementById('brush-size').addEventListener('input',()=>{brushSize=parseInt(document.getElementById('brush-size').value);document.getElementById('brush-size-val').textContent=brushSize+'px';});
document.getElementById('canvas-clear').addEventListener('click',()=>{ctx.fillStyle='#FFFFFF';ctx.fillRect(0,0,canvas.width,canvas.height);showToast('Canvas limpiado 🧹');});

document.getElementById('canvas-save-draft').addEventListener('click',()=>{
  const dataURL=canvas.toDataURL('image/png');
  const draft={id:Date.now(),data:dataURL,date:new Date().toISOString()};
  state.drafts.unshift(draft);
  if(state.drafts.length>20) state.drafts=state.drafts.slice(0,20);
  saveState(); renderDrafts();
  showToast('Borrador guardado 💾',true);
  checkAchievements();
});
document.getElementById('canvas-download').addEventListener('click',downloadCanvas);
function downloadCanvas(){const link=document.createElement('a');link.download=`mi-dibujo-${Date.now()}.png`;link.href=canvas.toDataURL('image/png');link.click();}

document.getElementById('canvas-share').addEventListener('click',()=>{
  const dataURL=canvas.toDataURL('image/png');
  document.getElementById('share-preview-img').src=dataURL;
  document.getElementById('share-modal').style.display='flex';
  document.getElementById('share-whatsapp').addEventListener('click',async e=>{
    e.preventDefault();
    if(navigator.share){try{const blob=await(await fetch(dataURL)).blob();const file=new File([blob],'mi-dibujo.png',{type:'image/png'});await navigator.share({files:[file],title:'Mi dibujo 🎨',text:'Te comparto este dibujo 🌸'});}catch(err){window.open('https://wa.me/?text=Te%20comparto%20este%20dibujo%20%F0%9F%8C%B8','_blank');}}
    else{window.open('https://web.whatsapp.com/','_blank');}
  });
  document.getElementById('share-download-btn').addEventListener('click',downloadCanvas);
  document.getElementById('share-copy').addEventListener('click',async()=>{
    try{const blob=await(await fetch(dataURL)).blob();await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);showToast('Imagen copiada al portapapeles 📋',true);}
    catch(e){showToast('Tu navegador no soporta esta función');}
  });
});
document.getElementById('share-modal-close').addEventListener('click',()=>document.getElementById('share-modal').style.display='none');
document.getElementById('share-modal').addEventListener('click',e=>{if(e.target===e.currentTarget)e.currentTarget.style.display='none';});

function renderDrafts(){
  const grid=document.getElementById('drafts-grid');
  if(state.drafts.length===0){grid.innerHTML=`<div class="empty-state"><div class="empty-icon">🎨</div><p>Guarda tus dibujos aquí</p></div>`;return;}
  grid.innerHTML='';
  state.drafts.forEach((draft,i)=>{
    const item=document.createElement('div'); item.className='draft-item';
    item.innerHTML=`<img src="${draft.data}" alt="Borrador ${i+1}"><button class="draft-delete" title="Eliminar">✕</button>`;
    item.querySelector('.draft-delete').addEventListener('click',e=>{e.stopPropagation();state.drafts=state.drafts.filter(d=>d.id!==draft.id);saveState();renderDrafts();});
    item.addEventListener('click',()=>{const img=new Image();img.onload=()=>{ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);};img.src=draft.data;showToast('Borrador cargado 🎨',true);});
    grid.appendChild(item);
    gsap.fromTo(item,{opacity:0,scale:0.8},{opacity:1,scale:1,duration:0.3,delay:i*0.05,ease:'back.out(1.7)'});
  });
}

// ===================== ÁRBOL =====================
const treeStates = [
  {level:1,name:'🌱 Brote tierno',    canopy:0, branches:0},
  {level:2,name:'🌿 Primeras hojas',  canopy:25,branches:0.3},
  {level:3,name:'🌳 Árbol joven',     canopy:45,branches:0.6},
  {level:4,name:'🌸 Primera floración',canopy:65,branches:0.85},
  {level:5,name:'🌺 Árbol en flor',   canopy:80,branches:1.0},
  {level:6,name:'🌟 Árbol del alma',  canopy:95,branches:1.0},
];

function renderTree() {
  const t=state.tree;
  document.getElementById('water-days').textContent    = t.waterDays;
  document.getElementById('messages-count').textContent= t.messages.length;
  const level=Math.min(Math.floor(t.waterDays/3)+1,6);
  state.tree.level=level;
  document.getElementById('tree-level-display').textContent=level;
  const ts=treeStates[level-1]||treeStates[treeStates.length-1];
  document.getElementById('tree-status-badge').textContent=ts.name;
  const r=ts.canopy;
  gsap.to('#canopy-main',{attr:{r:r},      duration:1.5,ease:'elastic.out(1,0.5)'});
  gsap.to('#canopy-l',   {attr:{r:r*0.75},duration:1.5,delay:0.1,ease:'elastic.out(1,0.5)'});
  gsap.to('#canopy-r',   {attr:{r:r*0.75},duration:1.5,delay:0.2,ease:'elastic.out(1,0.5)'});
  gsap.to('#canopy-t',   {attr:{r:r*0.6}, duration:1.5,delay:0.3,ease:'elastic.out(1,0.5)'});
  if(ts.branches>0){
    gsap.to('#branches-group',{opacity:1,duration:1});
    document.querySelectorAll('.branch').forEach((b,i)=>{
      if(i<Math.floor(6*ts.branches)) gsap.to(b,{strokeDashoffset:0,duration:1.2,delay:i*0.15,ease:'power2.inOut'});
    });
  }
  renderBranchFlowers();
  // FIX: Comparar solo la parte de fecha (YYYY-MM-DD) del lastWatered con hoy
  const lastWateredDate = t.lastWatered ? (t.lastWatered.includes('T') ? t.lastWatered.split('T')[0] : t.lastWatered) : null;
  const alreadyWatered = lastWateredDate === todayStr();
  const waterBtn=document.getElementById('water-btn');
  const waterNote=document.getElementById('water-note');
  if(alreadyWatered){waterBtn.disabled=true;waterNote.textContent='¡Ya regaste tu árbol hoy! Vuelve mañana 💕';}
  else{waterBtn.disabled=false;waterNote.textContent='¡Riégame cada día para que crezcamos juntas! 🌸';}
  renderBranchMessages();
}

function renderBranchFlowers(){
  const fg=document.getElementById('flowers-group'); fg.innerHTML='';
  const count=Math.min(state.tree.messages.length,12);
  const positions=[[200,320],[400,305],[220,260],[385,245],[245,215],[355,205],[180,295],[415,280],[230,245],[375,235],[260,195],[340,185]];
  for(let i=0;i<count;i++){
    const[x,y]=positions[i];
    const flower=document.createElementNS('http://www.w3.org/2000/svg','text');
    flower.setAttribute('x',x); flower.setAttribute('y',y); flower.setAttribute('font-size','18');
    flower.setAttribute('text-anchor','middle'); flower.setAttribute('opacity','0');
    flower.textContent=['🌸','🌺','💮','🌷','✿','❀'][i%6];
    fg.appendChild(flower);
    gsap.to(flower,{opacity:1,duration:0.8,delay:i*0.1,ease:'power2.out'});
    gsap.fromTo(flower,{attr:{y:y+10}},{attr:{y},duration:0.8,delay:i*0.1});
  }
}

function renderBranchMessages(){
  const list=document.getElementById('branch-messages-list');
  const empty=document.getElementById('empty-branches');
  if(state.tree.messages.length===0){list.innerHTML='';list.appendChild(empty);return;}
  list.innerHTML='';
  [...state.tree.messages].reverse().forEach((msg,i)=>{
    const item=document.createElement('div'); item.className='branch-msg-item';
    item.innerHTML=`<div class="branch-msg-leaf">🌿</div><div class="branch-msg-content"><p class="branch-msg-text">${msg.text}</p><div class="branch-msg-date">${formatDateShort(msg.date)} · <span class="branch-msg-mood">${msg.moodEmoji||'✨'} ${msg.mood||'sin estado'}</span></div></div>`;
    list.appendChild(item);
    gsap.fromTo(item,{opacity:0,x:-15},{opacity:1,x:0,duration:0.35,delay:i*0.04,ease:'power2.out'});
  });
}

// FIX: Al regar el árbol también se guarda el mood del día en la colección de moods
document.getElementById('water-btn').addEventListener('click', async () => {
  // FIX doble riego: comparar solo la parte de fecha
  const lastWateredDate = state.tree.lastWatered 
    ? (state.tree.lastWatered.includes('T') ? state.tree.lastWatered.split('T')[0] : state.tree.lastWatered)
    : null;
  const alreadyWatered = lastWateredDate === todayStr();
  if (alreadyWatered) { showToast('¡Ya regaste tu árbol hoy! Vuelve mañana 💕'); return; }

  // Deshabilitar el botón de inmediato para prevenir doble click
  const waterBtn = document.getElementById('water-btn');
  waterBtn.disabled = true;

  const msg = state.today.motivationalMsg || getMotivationalMsg(state.today.mood, state.today.scale);
  state.tree.waterDays++;
  state.tree.lastWatered = todayStr(); // Guardar solo YYYY-MM-DD para comparaciones limpias
  state.tree.messages.push({text:msg,mood:state.today.mood,moodEmoji:state.today.moodEmoji,date:new Date().toISOString()});
  state.tree.totalMessages = state.tree.messages.length;

  await cloudSaveMain({ tree: state.tree });

  // 🆕 Si hay mood registrado, también guardarlo en la colección de moods diarios
  if (state.today.mood) {
    await cloudSaveDailyMood({
      date:      todayStr(),
      mood:      state.today.mood,
      moodEmoji: state.today.moodEmoji,
      scale:     state.today.scale,
      motivationalMsg: msg,
      wateredTree: true
    });
  }

  checkAchievements();
  animateWatering();
  setTimeout(()=>{renderTree();showToast('¡Árbol regado! +1 día 💧 Ya llevas '+state.tree.waterDays+' días 🌸',true);},1200);
});

function animateWatering(){
  const svg=document.getElementById('tree-svg');
  for(let i=0;i<12;i++){
    const drop=document.createElementNS('http://www.w3.org/2000/svg','circle');
    drop.setAttribute('cx',250+Math.random()*100); drop.setAttribute('cy',50+Math.random()*50);
    drop.setAttribute('r',3+Math.random()*3); drop.setAttribute('fill','#a8d8ea'); drop.setAttribute('opacity','0.9');
    svg.appendChild(drop);
    gsap.to(drop,{attr:{cy:300+Math.random()*150},opacity:0,duration:0.8+Math.random()*0.5,delay:Math.random()*0.5,ease:'power2.in',onComplete:()=>drop.remove()});
  }
  gsap.fromTo('#trunk-group',{rotation:-2,transformOrigin:'300px 510px'},{rotation:2,duration:0.15,yoyo:true,repeat:6,ease:'sine.inOut',onComplete:()=>gsap.set('#trunk-group',{rotation:0})});
}

// ===================== TOAST =====================
let toastTimer=null;
function showToast(msg,pink=false){
  const toast=document.getElementById('toast');
  toast.textContent=msg;
  toast.className='toast show'+(pink?' pink-toast':'');
  if(toastTimer) clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>toast.classList.remove('show'),3000);
}

// ===================== GSAP INTRO =====================
function introAnims(){
  gsap.from('.nav',       {y:-60,opacity:0,duration:0.8,ease:'power3.out'});
  gsap.from('.hero-title',{y:30,opacity:0,duration:1,delay:0.3,ease:'power3.out'});
  gsap.from('.hero-sub',  {y:20,opacity:0,duration:0.8,delay:0.5});
  gsap.from('.hero-date', {y:15,opacity:0,duration:0.6,delay:0.2});
  gsap.from('.flower',    {scale:0,opacity:0,duration:0.8,stagger:0.1,delay:0.6,ease:'back.out(2)'});
  gsap.from('.card',{scrollTrigger:{trigger:'.card',start:'top 90%'},y:40,opacity:0,duration:0.7,stagger:0.12,ease:'power2.out'});
}

// ============================================================
//   DANI & IA
// ============================================================
document.querySelectorAll('.dani-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.dani-tab').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.dani-panel').forEach(p=>p.classList.remove('active'));
    tab.classList.add('active');
    const target=tab.dataset.dtab;
    const panel = document.getElementById('dpanel-'+target);
    if (!panel) return;
    panel.classList.add('active');
    if(target==='buzzon') { renderBuzzon(); updateUnreadBadge(); }
    if(target==='write-dani') setTimeout(initPinLock, 50);
    gsap.fromTo(panel,{opacity:0,y:12},{opacity:1,y:0,duration:0.35,ease:'power2.out'});
  });
});

function initDaniTab(){ updateAIContextPill(); updateUnreadBadge(); renderBuzzon(); }

function updateAIContextPill(){
  const pill=document.getElementById('ai-context-text');
  if(!pill) return;
  const {mood,scale}=state.today;
  const emojis={feliz:'😊',enamorada:'🥰',tranquila:'😌',triste:'😢',enojada:'😤',ansiosa:'😰',cansada:'😴',esperanzada:'🌟'};
  if(mood) pill.textContent=`${emojis[mood]||'✨'} Hoy te sientes ${mood} (${scale}/10) · ${state.entries.length} entradas en tu diario`;
  else      pill.textContent=`📖 ${state.entries.length} entradas en tu diario · Dile a la IA cómo te sientes hoy`;
}

function updateUnreadBadge(){
  const today=todayStr();
  const unread=(state.buzzon||[]).filter(m=>{
    const ud=m.scheduledFor?m.scheduledFor.split('T')[0]:null;
    return !m.read&&(!ud||ud<=today);
  }).length;
  const badge=document.getElementById('unread-badge');
  if(!badge) return;
  if(unread>0){badge.textContent=unread;badge.style.display='flex';}
  else badge.style.display='none';
}

// ---- AI Chat ----
function buildAISystemPrompt(){
  const {mood,moodEmoji,scale}=state.today;
  const entries=state.entries.slice(0,5);
  let ctx=`Eres "Jardincita", la compañera de IA personal de Alison en su aplicación "Mi Jardín Interior". Esta app fue creada con muchísimo amor por Dani para Alison.\n\nTu personalidad:\n- Eres cálida, amorosa, empática y poética. Hablas como una amiga íntima que la conoce bien.\n- Usas lenguaje femenino siempre que te refieras a Alison.\n- Mezclas naturalmente emojis con tus palabras (flores, corazones, estrellas).\n- Tus respuestas son relativamente cortas (3-6 oraciones) pero muy significativas e íntimas.\n- Nunca eres genérica. Siempre te refieres al contexto real de Alison.\n- Si Alison está triste o ansiosa, la contienes con amor. Si está feliz, celebras con ella.\n- Ocasionalmente mencionas a Dani con ternura, como quien la conoce. (Dani es su pareja especial que creó esta app.)\n\nContexto actual de Alison:\n- Árbol del alma: Nivel ${state.tree.level} (${state.tree.waterDays} días regado) 🌳\n${mood?`- Estado de hoy: ${moodEmoji} ${mood}, ${scale}/10 en bienestar`:'- Aún no ha registrado su estado de hoy'}\n- Entradas en su diario: ${state.entries.length} en total`;
  if(entries.length>0){
    ctx+=`\n\nÚltimas entradas del diario de Alison:\n`;
    entries.forEach((e,i)=>{ ctx+=`${i+1}. "${e.title}" (${formatDateShort(e.date)}, estado: ${e.mood||'no registrado'}): ${e.text.substring(0,120)}...\n`; });
    ctx+=`\n\nUsa este contexto para personalizar tus respuestas. Si Alison menciona algo que ya escribió en el diario, reconócelo con cariño.`;
  }
  ctx+=`\n\nReglas importantes:\n- No inventes información que no esté en el contexto.\n- No seas psicóloga ni des consejos médicos. Eres una amiga amorosa.\n- Si Alison menciona algo muy difícil (autolesión, crisis), recuérdale con ternura que puede hablar con alguien de confianza.\n- Siempre termina con algo que abra la conversación o invite a Alison a continuar compartiendo.`;
  return ctx;
}

async function sendAIMessage(userText){
  const chatContainer=document.getElementById('chat-messages');
  const sendBtn=document.getElementById('chat-send-btn');
  const sendIcon=document.getElementById('send-icon');
  appendChatMsg('user',userText);
  state.chatHistory.push({role:'user',content:userText});
  if(state.chatHistory.length>40) state.chatHistory=state.chatHistory.slice(-40);
  const typingEl=document.createElement('div'); typingEl.className='chat-msg ai'; typingEl.id='typing-indicator';
  typingEl.innerHTML=`<div class="typing-bubble"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>`;
  chatContainer.appendChild(typingEl); chatContainer.scrollTop=chatContainer.scrollHeight;
  sendBtn.disabled=true; sendIcon.textContent='⏳';
  try{
    const response=await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:1000,system:buildAISystemPrompt(),messages:state.chatHistory})
    });
    const data=await response.json();
    const aiText=data.content?.map(c=>c.text||'').join('')||'💕 Hubo un problema, inténtalo de nuevo.';
    document.getElementById('typing-indicator')?.remove();
    appendChatMsg('ai',aiText);
    state.chatHistory.push({role:'assistant',content:aiText});
    saveState();
  }catch(err){
    document.getElementById('typing-indicator')?.remove();
    appendChatMsg('ai','💙 Algo falló al conectarme. Asegúrate de tener conexión e inténtalo de nuevo.');
  }finally{sendBtn.disabled=false;sendIcon.textContent='💌';}
}

function appendChatMsg(role,text){
  const chatContainer=document.getElementById('chat-messages');
  const msgEl=document.createElement('div'); msgEl.className=`chat-msg ${role}`;
  msgEl.innerHTML=`<div class="chat-bubble">${text.replace(/\n/g,'<br>')}</div>`;
  chatContainer.appendChild(msgEl); chatContainer.scrollTop=chatContainer.scrollHeight;
  gsap.fromTo(msgEl,{opacity:0,y:10},{opacity:1,y:0,duration:0.35,ease:'power2.out'});
}

document.getElementById('chat-send-btn').addEventListener('click',()=>{
  const input=document.getElementById('chat-input');
  const text=input.value.trim(); if(!text) return;
  input.value=''; input.style.height='auto'; sendAIMessage(text);
});
document.getElementById('chat-input').addEventListener('keydown',e=>{
  if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();document.getElementById('chat-send-btn').click();}
});
document.querySelectorAll('.quick-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{document.getElementById('chat-input').value=btn.dataset.prompt;document.getElementById('chat-send-btn').click();});
});

// ---- BUZÓN DE DANI ----
function renderBuzzon(){
  const list=document.getElementById('buzzon-list');
  const msgs=state.buzzon||[];
  const today=todayStr();
  if(msgs.length===0){
    list.innerHTML=`<div class="empty-state"><div class="empty-icon">📭</div><p>Aún no hay mensajes de Dani</p><p class="empty-sub">Pídele a Dani que te deje un mensaje especial 💕</p></div>`;
    return;
  }
  list.innerHTML='';
  msgs.forEach((msg,i)=>{
    const unlockDate=msg.scheduledFor?msg.scheduledFor.split('T')[0]:null;
    const isLocked=unlockDate&&unlockDate>today;
    const item=document.createElement('div');
    item.className=`buzzon-item ${isLocked?'locked':(msg.read?'':'unread')}`;
    const previewText=isLocked?`🔒 Se abre el ${formatDateShort(msg.scheduledFor)}`:msg.body.substring(0,70)+'...';
    item.innerHTML=`
      <div class="buzzon-emoji">${isLocked?'🔒':(msg.emoji||'💕')}</div>
      <div class="buzzon-info">
        <div class="buzzon-title">${msg.title}</div>
        <div class="buzzon-preview">${previewText}</div>
      </div>
      <div class="buzzon-meta">
        <div class="buzzon-date">${formatDateShort(msg.date)}</div>
        <div class="buzzon-type">${typeLabel(msg.type)}</div>
      </div>`;
    if(!isLocked) item.addEventListener('click',()=>openLetterModal(msg));
    else item.addEventListener('click',()=>showToast(`Este mensaje se abre el ${formatDateShort(msg.scheduledFor)} 🔒`));
    list.appendChild(item);
    gsap.fromTo(item,{opacity:0,x:-15},{opacity:1,x:0,duration:0.3,delay:i*0.06,ease:'power2.out'});
  });
}

function typeLabel(type){
  const labels={carta:'💌 Carta',sorpresa:'🎁 Sorpresa',recordatorio:'⭐ Recordatorio',poema:'🌹 Poema'};
  return labels[type]||'💌 Carta';
}

function openLetterModal(msg){
  const modal=document.getElementById('buzzon-modal');
  const envelopeAnim=document.getElementById('envelope-anim');
  const letterContent=document.getElementById('letter-content');
  const flap=document.getElementById('envelope-flap');
  envelopeAnim.style.display='flex'; letterContent.style.display='none';
  modal.style.display='flex';
  setTimeout(()=>flap.classList.add('open'),400);
  setTimeout(async()=>{
    envelopeAnim.style.display='none';
    document.getElementById('letter-emoji').textContent     = msg.emoji||'💕';
    document.getElementById('letter-modal-title').textContent = msg.title;
    document.getElementById('letter-modal-date').textContent  = formatDate(msg.date);
    document.getElementById('letter-modal-body').textContent  = msg.body;
    letterContent.style.display='block';
    if(!msg.read) await cloudUpdateBuzzon(msg.id, { read: true });
  },1000);
}

document.getElementById('buzzon-modal-close').addEventListener('click',()=>{
  document.getElementById('buzzon-modal').style.display='none';
  document.getElementById('envelope-flap').classList.remove('open');
});
document.getElementById('buzzon-modal').addEventListener('click',e=>{
  if(e.target===e.currentTarget){e.currentTarget.style.display='none';document.getElementById('envelope-flap').classList.remove('open');}
});

// ---- ESCRIBIR A DANI ----
let selectedMsgType='carta', selectedDaniEmoji='💕';
document.querySelectorAll('.msg-type-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{document.querySelectorAll('.msg-type-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');selectedMsgType=btn.dataset.type;});
});
document.querySelectorAll('.emoji-pick').forEach(btn=>{
  btn.addEventListener('click',()=>{document.querySelectorAll('.emoji-pick').forEach(b=>b.classList.remove('active'));btn.classList.add('active');selectedDaniEmoji=btn.dataset.emoji;});
});

const daniDateInput=document.getElementById('dani-msg-date');
if(daniDateInput){const tomorrow=new Date();tomorrow.setDate(tomorrow.getDate()+1);daniDateInput.min=tomorrow.toISOString().split('T')[0];}

document.getElementById('dani-send-btn').addEventListener('click', async () => {
  const title=document.getElementById('dani-msg-title').value.trim();
  const body =document.getElementById('dani-msg-body').value.trim();
  const scheduledDate=document.getElementById('dani-msg-date').value;
  if(!title||!body){showToast('Dale un título y escribe el mensaje 💕');return;}
  const newMsg={
    id: Date.now(), title, body,
    type: selectedMsgType, emoji: selectedDaniEmoji,
    date: new Date().toISOString(),
    scheduledFor: scheduledDate?new Date(scheduledDate+'T00:00:00').toISOString():null,
    read: false
  };
  await cloudSaveBuzzon(newMsg);
  document.getElementById('dani-msg-title').value='';
  document.getElementById('dani-msg-body').value='';
  document.getElementById('dani-msg-date').value='';
  const toastMsg=scheduledDate?`💌 ¡Mensaje programado para el ${formatDateShort(newMsg.scheduledFor)}!`:'💌 ¡Mensaje enviado al buzón de Alison!';
  showToast(toastMsg,true);
  gsap.fromTo('#dani-send-btn',{scale:1},{scale:1.1,duration:0.15,yoyo:true,repeat:1});
  setTimeout(()=>{
    document.querySelectorAll('.dani-tab').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.dani-panel').forEach(p=>p.classList.remove('active'));
    const buzzTab = document.querySelector('[data-dtab="buzzon"]');
    const buzzPanel = document.getElementById('dpanel-buzzon');
    if(buzzTab) buzzTab.classList.add('active');
    if(buzzPanel) buzzPanel.classList.add('active');
    renderBuzzon();
  },1000);
});

// ============================================================
//   EXTRAS: CALENDAR, CAPSULE, ACHIEVEMENTS
// ============================================================
document.querySelectorAll('.extras-tab').forEach(tab=>{
  tab.addEventListener('click',()=>{
    document.querySelectorAll('.extras-tab').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.extras-panel').forEach(p=>p.classList.remove('active'));
    tab.classList.add('active');
    const target=tab.dataset.etab;
    const panel = document.getElementById('epanel-'+target);
    if(!panel) return;
    panel.classList.add('active');
    gsap.fromTo(panel,{opacity:0,y:12},{opacity:1,y:0,duration:0.35,ease:'power2.out'});
    if(target==='calendar')     renderCalendar();
    if(target==='capsule')      renderCapsules();
    if(target==='achievements') renderAchievements();
  });
});

function initExtrasTab(){ renderCalendar(); renderCapsules(); renderAchievements(); }

// ---- CALENDARIO (FIX PRINCIPAL) ----
// FIX: Ahora fusiona state.entries Y state.dailyMoods para colorear el calendario
// Si hay mood del día (aunque no haya entrada del diario), se pinta el día
let calViewDate=new Date();
const MOOD_COLORS={feliz:'#FFD700',enamorada:'#FF85A1',tranquila:'#A8E6CF',triste:'#BDE0FE',enojada:'#FFB347',ansiosa:'#CDB4DB',cansada:'#C8E6C9',esperanzada:'#FFF176'};
document.getElementById('cal-prev').addEventListener('click',()=>{calViewDate=new Date(calViewDate.getFullYear(),calViewDate.getMonth()-1,1);renderCalendar();});
document.getElementById('cal-next').addEventListener('click',()=>{calViewDate=new Date(calViewDate.getFullYear(),calViewDate.getMonth()+1,1);renderCalendar();});

function renderCalendar(){
  const year=calViewDate.getFullYear(),month=calViewDate.getMonth();
  const monthNames=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  document.getElementById('cal-month-title').textContent=`${monthNames[month].charAt(0).toUpperCase()+monthNames[month].slice(1)} ${year}`;

  // Mapa de entradas del diario por fecha — acumular múltiples entradas por día
  const entryMap={};
  state.entries.forEach(entry=>{
    const d=new Date(entry.date);
    const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    if(!entryMap[key]) entryMap[key]=[];
    entryMap[key].push(entry);
  });

  // Mapa de moods diarios (con soporte de múltiples moods)
  const moodMap={};
  (state.dailyMoods||[]).forEach(m=>{
    if(m.date) moodMap[m.date]=m;
  });

  // También pintar el mood de hoy si está confirmado
  const todayKey = todayStr();
  if(state.today.mood && state.today.confirmed && !moodMap[todayKey]){
    moodMap[todayKey] = { date: todayKey, mood: state.today.mood, moodEmoji: state.today.moodEmoji, scale: state.today.scale, moods: [{ mood: state.today.mood, moodEmoji: state.today.moodEmoji, scale: state.today.scale }] };
  }

  const grid=document.getElementById('calendar-grid'); grid.innerHTML='';
  ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].forEach(d=>{const h=document.createElement('div');h.className='cal-day-header';h.textContent=d;grid.appendChild(h);});
  let startWeekday=new Date(year,month,1).getDay(); startWeekday=startWeekday===0?6:startWeekday-1;
  for(let i=0;i<startWeekday;i++){const e=document.createElement('div');e.className='cal-day empty';grid.appendChild(e);}
  const daysInMonth=new Date(year,month+1,0).getDate();
  const todayFull=todayStr();

  // Frases divertidas para días con mezcla de emociones
  const crazyDayPhrases = [
    'hoy estuvo descabellado 🌀',
    'qué día tan completo 🎭',
    'un torbellino de emociones ✨',
    'de todo un poco hoy 🌈',
    'el corazón bailó solo 💃',
    'las emociones se mezclaron 🎨'
  ];

  for(let d=1;d<=daysInMonth;d++){
    const key=`${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dayEntries=entryMap[key]||[];
    const dailyMood=moodMap[key];
    const isToday=key===todayFull;
    const dayEl=document.createElement('div'); dayEl.className='cal-day';
    if(isToday) dayEl.classList.add('today');

    // Recopilar todos los moods únicos del día
    let allMoods=[];
    // Desde moods diarios (que acumulan múltiples)
    if(dailyMood?.moods && dailyMood.moods.length>0) {
      dailyMood.moods.forEach(m=>{ if(!allMoods.some(x=>x.mood===m.mood)) allMoods.push(m); });
    } else if(dailyMood?.mood) {
      allMoods.push({ mood: dailyMood.mood, moodEmoji: dailyMood.moodEmoji, scale: dailyMood.scale });
    }
    // Desde entradas del diario
    dayEntries.forEach(entry=>{ if(entry.mood && !allMoods.some(m=>m.mood===entry.mood)) allMoods.push({ mood:entry.mood, moodEmoji:entry.moodEmoji, scale:entry.scale }); });

    if(allMoods.length>0){
      dayEl.classList.add('has-entry');
      const colors = allMoods.map(m => MOOD_COLORS[m.mood]||'#FFD6E7');
      const isMulti = allMoods.length > 1;

      if(isMulti){
        // Fondo degradado con múltiples colores
        const gradStops = colors.map((c,i)=>`${c}88 ${Math.round(i/colors.length*100)}%, ${c}88 ${Math.round((i+1)/colors.length*100)}%`).join(', ');
        dayEl.style.background = `linear-gradient(135deg, ${colors.map((c,i)=>`${c}77 ${Math.round(i/(colors.length-1||1)*100)}%`).join(', ')})`;
        dayEl.style.borderColor = colors[0];
        dayEl.classList.add('multi-mood');
        // Múltiples puntitos de colores
        const dotsEl=document.createElement('div'); dotsEl.className='cal-day-mood-dots';
        colors.forEach(c=>{ const dot=document.createElement('div'); dot.className='cal-day-mood-dot-small'; dot.style.background=c; dotsEl.appendChild(dot); });
        dayEl.appendChild(dotsEl);
      } else {
        const color = colors[0];
        dayEl.style.background=color+'55'; dayEl.style.borderColor=color;
        const dot=document.createElement('div'); dot.className='cal-day-mood-dot'; dot.style.background=color;
        dayEl.appendChild(dot);
      }

      // Click handler
      dayEl.addEventListener('click',()=>{
        if(isMulti){
          const randomPhrase = crazyDayPhrases[Math.floor(Math.random()*crazyDayPhrases.length)];
          const moodList = allMoods.map(m=>`${m.moodEmoji||'✨'} ${m.mood}`).join(' · ');
          const entriesInfo = dayEntries.length>0 ? `\n📝 ${dayEntries.length} entrada${dayEntries.length>1?'s':''} guardada${dayEntries.length>1?'s':''}` : '';
          showMultiMoodToast(`${randomPhrase}\n${moodList}${entriesInfo}`, colors, allMoods, dayEntries);
        } else if(dayEntries.length>0){
          // Si hay una sola emoción pero múltiples entradas, mostrar la primera
          if(dayEntries.length===1) openEntryModal(dayEntries[0]);
          else showDayEntriesModal(dayEntries, allMoods[0]);
        } else {
          const m=allMoods[0];
          showToast(`${m.moodEmoji||'✨'} ${m.mood} · ${m.scale||'?'}/10`, true);
        }
      });
      dayEl.title = isMulti ? `Mezcla de emociones: ${allMoods.map(m=>m.mood).join(', ')}` : `${allMoods[0].mood}`;
    } else if(key<=todayFull){
      dayEl.classList.add('no-data');
    } else {
      dayEl.style.opacity='0.3';
    }

    dayEl.insertAdjacentHTML('afterbegin',`<span>${d}</span>`);
    grid.appendChild(dayEl);
  }
}

function showMultiMoodToast(msg, colors, moods, entries) {
  // Mostrar un modal especial para días con múltiples emociones
  const existing = document.getElementById('multi-mood-modal');
  if(existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'multi-mood-modal';
  modal.className = 'modal-overlay';
  modal.style.display='flex';
  const gradBg = colors.map((c,i)=>`${c}33 ${Math.round(i/(colors.length-1||1)*100)}%`).join(', ');
  const moodsHTML = moods.map(m=>`<div class="multi-mood-chip" style="background:${MOOD_COLORS[m.mood]||'#FFD6E7'}44;border-color:${MOOD_COLORS[m.mood]||'#FFD6E7'}"><span>${m.moodEmoji||'✨'}</span><span>${m.mood}</span>${m.scale?`<span class="mood-scale-mini">${m.scale}/10</span>`:''}</div>`).join('');
  const entriesHTML = entries.length>0 ? `<div class="multi-mood-entries"><p class="multi-mood-entries-title">📝 Entradas de este día:</p>${entries.map(e=>`<div class="multi-mood-entry-item" onclick="openEntryModal(${JSON.stringify(e).replace(/"/g,'&quot;')})">${e.moodEmoji||'📝'} <strong>${e.title}</strong></div>`).join('')}</div>`:'';
  const phrases = ['¡Qué día tan completo!','Las emociones se mezclaron hoy','Un torbellino de sentires','¡El corazón tuvo de todo!','Un día bien descabellado'];
  const phrase = phrases[Math.floor(Math.random()*phrases.length)];
  modal.innerHTML=`<div class="modal-card multi-mood-card" style="background:linear-gradient(160deg,${gradBg}),var(--card-bg)"><button class="modal-close" onclick="document.getElementById('multi-mood-modal').remove()">✕</button><div class="multi-mood-icon">🌈</div><h3 class="multi-mood-title">${phrase}</h3><p class="multi-mood-sub">Tuviste una mezcla de emociones este día 💕</p><div class="multi-mood-chips">${moodsHTML}</div>${entriesHTML}</div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click',e=>{ if(e.target===modal) modal.remove(); });
  gsap.fromTo(modal.querySelector('.modal-card'),{opacity:0,scale:0.92,y:20},{opacity:1,scale:1,y:0,duration:0.4,ease:'back.out(1.7)'});
}

function showDayEntriesModal(entries, mood) {
  const existing = document.getElementById('day-entries-modal');
  if(existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'day-entries-modal';
  modal.className = 'modal-overlay';
  modal.style.display='flex';
  const color = MOOD_COLORS[mood?.mood]||'#FFD6E7';
  const entriesHTML = entries.map(e=>`<div class="day-entry-item" style="border-left:3px solid ${color}">${e.moodEmoji||'📝'} <strong>${e.title}</strong><br><small>${formatDateShort(e.date)}</small></div>`).join('');
  modal.innerHTML=`<div class="modal-card"><button class="modal-close" onclick="document.getElementById('day-entries-modal').remove()">✕</button><h3 class="modal-title">${mood?.moodEmoji||'📝'} ${entries.length} entradas este día</h3><div style="margin-top:16px">${entriesHTML}</div></div>`;
  modal.querySelectorAll('.day-entry-item').forEach((el,i)=>{ el.style.cursor='pointer'; el.addEventListener('click',()=>{ modal.remove(); openEntryModal(entries[i]); }); });
  document.body.appendChild(modal);
  modal.addEventListener('click',e=>{ if(e.target===modal) modal.remove(); });
}

// ---- CÁPSULA DEL TIEMPO ----
let capsuleMonths=3;
document.querySelectorAll('.capsule-time-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.capsule-time-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active'); capsuleMonths=parseInt(btn.dataset.months);
    document.getElementById('capsule-custom-date').style.display=capsuleMonths===0?'block':'none';
  });
});
const capsuleCustomDate=document.getElementById('capsule-custom-date');
if(capsuleCustomDate){const minDate=new Date();minDate.setDate(minDate.getDate()+1);capsuleCustomDate.min=minDate.toISOString().split('T')[0];}

document.getElementById('capsule-seal-btn').addEventListener('click', async () => {
  const text=document.getElementById('capsule-text').value.trim();
  if(!text){showToast('Escribe tu carta primero ✏️');return;}
  let unlockDate;
  if(capsuleMonths===0){
    const customVal=document.getElementById('capsule-custom-date').value;
    if(!customVal){showToast('Elige una fecha personalizada 📅');return;}
    unlockDate=new Date(customVal+'T00:00:00');
  }else{unlockDate=new Date();unlockDate.setMonth(unlockDate.getMonth()+capsuleMonths);}
  const capsule={id:Date.now(),text,createdAt:new Date().toISOString(),unlockAt:unlockDate.toISOString(),opened:false};
  if(!state.capsules) state.capsules=[];
  state.capsules.push(capsule);
  await cloudSaveMain({ capsules: state.capsules });
  checkAchievements();
  document.getElementById('capsule-text').value='';
  showToast(`🔒 ¡Cápsula sellada! Se abrirá el ${formatDateShort(capsule.unlockAt)}`,true);
  gsap.fromTo('#capsule-seal-btn',{scale:1},{scale:1.1,duration:0.15,yoyo:true,repeat:1});
  renderCapsules();
});

function renderCapsules(){
  const list=document.getElementById('capsules-list');
  const capsules=state.capsules||[];
  const today=todayStr();
  if(capsules.length===0){list.innerHTML=`<div class="empty-state"><div class="empty-icon">⏳</div><p>Aún no has creado ninguna cápsula</p><p class="empty-sub">Escribe una carta para tu yo del futuro 💕</p></div>`;return;}
  list.innerHTML='';
  [...capsules].reverse().forEach((cap,i)=>{
    const unlockDate=cap.unlockAt.split('T')[0];
    const isReady=unlockDate<=today;
    const item=document.createElement('div'); item.className=`capsule-item ${isReady?'ready':'sealed'}`;
    item.innerHTML=`<div class="capsule-icon">${isReady?'📬':'🔒'}</div><div class="capsule-info"><div class="capsule-title">${isReady?'¡Tu cápsula está lista!':'Cápsula sellada'}</div><div class="capsule-meta">Creada el ${formatDateShort(cap.createdAt)} · ${isReady?'Disponible desde el':'Se abre el'} ${formatDateShort(cap.unlockAt)}</div></div><div class="capsule-status ${isReady?'ready-badge':'sealed-badge'}">${isReady?'✨ ¡Ábrela!':'🔒 Sellada'}</div>`;
    if(isReady) item.addEventListener('click',()=>openCapsuleModal(cap));
    else item.addEventListener('click',()=>showToast(`Esta cápsula se abre el ${formatDateShort(cap.unlockAt)} 🔒`));
    list.appendChild(item);
    gsap.fromTo(item,{opacity:0,y:12},{opacity:1,y:0,duration:0.3,delay:i*0.07,ease:'power2.out'});
  });
}

function openCapsuleModal(cap){
  const content=document.getElementById('capsule-modal-content');
  content.innerHTML=`<div class="capsule-reveal-content"><div class="capsule-reveal-icon">💌</div><h3 class="modal-title" style="margin-bottom:8px">Querida Alison del futuro</h3><p class="capsule-reveal-date">Escrita el ${formatDate(cap.createdAt)}</p><div class="capsule-reveal-body">${cap.text}</div><p style="font-family:var(--font-script);font-size:18px;color:var(--pink-accent)">Con amor, tu yo del pasado 🌸</p></div>`;
  document.getElementById('capsule-modal').style.display='flex';
  const found=state.capsules.find(c=>c.id===cap.id);
  if(found&&!found.opened){found.opened=true;cloudSaveMain({capsules:state.capsules});renderCapsules();}
}

document.getElementById('capsule-modal-close').addEventListener('click',()=>document.getElementById('capsule-modal').style.display='none');
document.getElementById('capsule-modal').addEventListener('click',e=>{if(e.target===e.currentTarget)e.currentTarget.style.display='none';});

// ---- LOGROS ----
const ACHIEVEMENTS_DEF=[
  {id:'first_entry',  icon:'📝',name:'Primera entrada',      desc:'Escribiste tu primera entrada en el diario',        check:s=>s.entries.length>=1},
  {id:'entries_5',    icon:'📖',name:'5 entradas escritas',  desc:'Has llenado 5 páginas de tu jardín interior',        check:s=>s.entries.length>=5},
  {id:'entries_20',   icon:'📚',name:'Escritora del alma',   desc:'20 entradas en tu diario. ¡Eres increíble!',         check:s=>s.entries.length>=20},
  {id:'first_mood',   icon:'😊',name:'Primer estado',        desc:'Registraste cómo te sientes por primera vez',        check:s=>s.today.confirmed||(s.dailyMoods&&s.dailyMoods.length>=1)},
  {id:'in_love',      icon:'💕',name:'Primera vez enamorada',desc:'Sentiste el amor y lo compartiste aquí',             check:s=>s.entries.some(e=>e.mood==='enamorada')||(s.dailyMoods&&s.dailyMoods.some(m=>m.mood==='enamorada'))},
  {id:'hard_day',     icon:'💙',name:'Superaste un día difícil',desc:'Registraste que estabas triste o ansiosa',        check:s=>s.entries.some(e=>e.mood==='triste'||e.mood==='ansiosa')||(s.dailyMoods&&s.dailyMoods.some(m=>m.mood==='triste'||m.mood==='ansiosa'))},
  {id:'tree_7',       icon:'🌱',name:'7 días seguidos 🌸',   desc:'Regaste tu árbol 7 veces. ¡Constancia hermosa!',     check:s=>s.tree.waterDays>=7},
  {id:'tree_30',      icon:'🌳',name:'Un mes de jardín',     desc:'Llevas 30 días cuidando tu jardín interior',         check:s=>s.tree.waterDays>=30},
  {id:'first_capsule',icon:'⏳',name:'Carta al futuro',      desc:'Creaste tu primera cápsula del tiempo',              check:s=>(s.capsules||[]).length>=1},
  {id:'capsule_opened',icon:'📬',name:'Viaje en el tiempo',  desc:'Abriste una cápsula del tiempo',                    check:s=>(s.capsules||[]).some(c=>c.opened)},
  {id:'first_drawing',icon:'🎨',name:'Artista del corazón',  desc:'Guardaste tu primer dibujo',                         check:s=>s.drafts.length>=1},
  {id:'first_dani',   icon:'💌',name:'Mensaje de amor',      desc:'Recibiste tu primer mensaje de Dani',                check:s=>(s.buzzon||[]).length>=1},
  {id:'hopeful',      icon:'🌟',name:'Llena de esperanza',   desc:'Registraste un día de esperanza',                    check:s=>s.entries.some(e=>e.mood==='esperanzada')||(s.dailyMoods&&s.dailyMoods.some(m=>m.mood==='esperanzada'))},
  {id:'scale_10',     icon:'✨',name:'Día 10 de 10',         desc:'Tuviste un día perfecto y lo celebraste aquí',       check:s=>s.entries.some(e=>e.scale===10)||(s.dailyMoods&&s.dailyMoods.some(m=>m.scale===10))},
];

function checkAchievements(){
  if(!state.achievements) state.achievements={};
  let newlyUnlocked=[];
  ACHIEVEMENTS_DEF.forEach(ach=>{
    if(!state.achievements[ach.id]&&ach.check(state)){
      state.achievements[ach.id]=new Date().toISOString();
      newlyUnlocked.push(ach);
    }
  });
  if(newlyUnlocked.length>0){
    cloudSaveMain({achievements:state.achievements});
    newlyUnlocked.forEach((ach,i)=>setTimeout(()=>showAchievementPopup(ach),i*3500));
  }
}

function showAchievementPopup(ach){
  const popup=document.getElementById('achievement-popup');
  document.getElementById('ach-popup-icon').textContent=ach.icon;
  document.getElementById('ach-popup-name').textContent=ach.name;
  popup.style.display='flex';
  gsap.fromTo(popup,{x:100,opacity:0},{x:0,opacity:1,duration:0.5,ease:'back.out(1.7)'});
  setTimeout(()=>gsap.to(popup,{x:100,opacity:0,duration:0.4,ease:'power2.in',onComplete:()=>popup.style.display='none'}),3200);
}

function renderAchievements(){
  if(!state.achievements) state.achievements={};
  const unlocked=Object.keys(state.achievements).length;
  const total=ACHIEVEMENTS_DEF.length;
  document.getElementById('achievements-summary').innerHTML=`
    <div class="ach-summary-card"><div class="ach-summary-num">${unlocked}</div><div class="ach-summary-label">Logros obtenidos</div></div>
    <div class="ach-summary-card"><div class="ach-summary-num">${total-unlocked}</div><div class="ach-summary-label">Por descubrir</div></div>
    <div class="ach-summary-card"><div class="ach-summary-num">${Math.round(unlocked/total*100)}%</div><div class="ach-summary-label">Completado</div></div>`;
  const grid=document.getElementById('achievements-grid'); grid.innerHTML='';
  const sorted=[...ACHIEVEMENTS_DEF].sort((a,b)=>(!!state.achievements[b.id])-(!!state.achievements[a.id]));
  sorted.forEach((ach,i)=>{
    const isUnlocked=!!state.achievements[ach.id];
    const card=document.createElement('div'); card.className=`achievement-card ${isUnlocked?'unlocked':'locked'}`;
    card.innerHTML=`<div class="ach-icon">${ach.icon}</div><div class="ach-name">${ach.name}</div><div class="ach-desc">${ach.desc}</div>${isUnlocked?`<div class="ach-unlocked-date">✨ ${formatDateShort(state.achievements[ach.id])}</div>`:`<div class="ach-lock-hint">Sigue adelante para desbloquearlo</div>`}`;
    grid.appendChild(card);
    gsap.fromTo(card,{opacity:0,y:15},{opacity:1,y:0,duration:0.3,delay:i*0.04,ease:'power2.out'});
  });
}

// ===================== PANTALLA DE BIENVENIDA =====================
// ===================== INIT =====================
// Esperar a que el DOM esté completamente listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initIntroScreen();
    loadState();
    renderDrafts();
    initParticles();
    introAnims();
    startRealtimeSync();
    if(document.getElementById('tab-tree')?.classList.contains('active')) renderTree();
  });
} else {
  // DOM ya está listo
  initIntroScreen();
  loadState();
  renderDrafts();
  initParticles();
  introAnims();
  startRealtimeSync();
  if(document.getElementById('tab-tree')?.classList.contains('active')) renderTree();
}

// ============================================================
//   PIN LOCK — Área de Dani
// ============================================================
const DEFAULT_PIN = '1234';
function getStoredPin(){ return localStorage.getItem('alison_dani_pin') || DEFAULT_PIN; }
function savePin(pin){ localStorage.setItem('alison_dani_pin', pin); }

let pinBuffer='', pinLocked=false, pinSession=false;

function initPinLock(){
  const lockScreen=document.getElementById('pin-lock-screen');
  const writeForm =document.getElementById('dani-write-form');
  if(!lockScreen) return;
  if(pinSession){ lockScreen.style.display='none'; writeForm.style.display='block'; return; }
  lockScreen.style.display='block'; writeForm.style.display='none';
  pinBuffer=''; updatePinDots();
}

function updatePinDots(){
  for(let i=0;i<4;i++){
    const dot=document.getElementById('dot-'+i);
    if(!dot) return;
    dot.classList.toggle('filled',i<pinBuffer.length);
    dot.classList.remove('shake');
  }
}

function pinSuccess(){
  pinSession=true;
  const card=document.querySelector('.pin-card');
  const overlay=document.createElement('div'); overlay.className='pin-success-overlay';
  overlay.innerHTML='<div class="pin-success-icon">💌</div>';
  if(card){ card.style.position='relative'; card.appendChild(overlay); }
  setTimeout(()=>{
    document.getElementById('pin-lock-screen').style.display='none';
    document.getElementById('dani-write-form').style.display='block';
    overlay.remove();
    showToast('¡Bienvenido, Dani! 💕 Escríbele con amor a Alison',true);
  },900);
}

function pinFailure(){
  pinLocked=true;
  for(let i=0;i<4;i++){ const dot=document.getElementById('dot-'+i); if(dot){dot.classList.remove('filled');dot.classList.add('shake');} }
  const errEl=document.getElementById('pin-error');
  if(errEl){ errEl.style.display='block'; gsap.fromTo(errEl,{opacity:0,scale:0.9},{opacity:1,scale:1,duration:0.4,ease:'back.out(1.7)'}); }
  setTimeout(()=>{ pinBuffer=''; pinLocked=false; updatePinDots(); },1500);
}

document.addEventListener('click',e=>{
  const key=e.target.closest('.pin-key');
  if(!key||pinLocked) return;
  const val=key.dataset.val;
  if(val==='clear'){ pinBuffer=''; const errEl=document.getElementById('pin-error'); if(errEl) errEl.style.display='none'; }
  else if(val==='del'){ pinBuffer=pinBuffer.slice(0,-1); }
  else if(pinBuffer.length<4){ pinBuffer+=val; if(navigator.vibrate) navigator.vibrate(30); gsap.fromTo(key,{scale:0.9},{scale:1,duration:0.2,ease:'back.out(2)'}); }
  updatePinDots();
  if(pinBuffer.length===4){
    pinLocked=true;
    setTimeout(()=>{ if(pinBuffer===getStoredPin()) pinSuccess(); else pinFailure(); },300);
  }
});

document.addEventListener('keydown',e=>{
  const panel=document.getElementById('dpanel-write-dani');
  if(!panel||!panel.classList.contains('active')) return;
  const lockScreen=document.getElementById('pin-lock-screen');
  if(!lockScreen||lockScreen.style.display==='none') return;
  if(e.key>='0'&&e.key<='9'){ const fk=document.querySelector(`.pin-key[data-val="${e.key}"]`); if(fk) fk.click(); }
  else if(e.key==='Backspace'){ const dk=document.querySelector('.pin-key-del'); if(dk) dk.click(); }
  else if(e.key==='Escape'){ const ck=document.querySelector('.pin-key-clear'); if(ck) ck.click(); }
});
