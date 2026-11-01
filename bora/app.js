/* Bora — organizador anti-procrastinação. Dados ficam no próprio celular (localStorage). */
(() => {
  'use strict';

  // ---------- Configuração ----------
  const CFG = Object.assign({
    appName: 'Bora', googleClientId: '', waterGoal: 8, glassMl: 250,
    wake: '08:00', sleep: '22:00', waterInterval: 120
  }, window.BORA_CONFIG || {});
  const KEY = 'bora:v1';
  const SCOPES = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/tasks';
  const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // ---------- Utilidades ----------
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const pad = (n) => String(n).padStart(2, '0');
  const dkey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseD = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return dkey(d); };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nowHM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const toMin = (hm) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
  const fromMin = (m) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
  const fmtDate = (s, opts = { weekday: 'long', day: 'numeric', month: 'long' }) => parseD(s).toLocaleDateString('pt-BR', opts);
  const relDay = (s) => {
    const t = dkey();
    if (s === t) return 'hoje';
    if (s === addDays(t, 1)) return 'amanhã';
    if (s === addDays(t, -1)) return 'ontem';
    return fmtDate(s, { weekday: 'short', day: 'numeric', month: 'short' });
  };
  const isStandalone = () => window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  // ---------- Estado ----------
  const defaults = () => ({
    settings: {
      name: '', waterGoal: CFG.waterGoal, glassMl: CFG.glassMl, wake: CFG.wake, sleep: CFG.sleep,
      waterInterval: CFG.waterInterval, clientId: '', pushTasksToGoogle: false
    },
    tasks: [],
    water: {},          // { 'YYYY-MM-DD': copos }
    waterLast: null,    // timestamp do último copo
    doneDays: {},       // { 'YYYY-MM-DD': quantidade concluída }
    timer: null,
    google: { token: null, exp: 0, ever: false, events: { date: null, items: [] }, waterEventIds: [], lastSync: null },
    ui: { dismissInstall: false, dismissWaterUntil: 0 },
    onboarded: false
  });

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw), def = defaults();
        return {
          ...def, ...d,
          settings: { ...def.settings, ...d.settings },
          google: { ...def.google, ...d.google },
          ui: { ...def.ui, ...d.ui }
        };
      }
    } catch (e) { /* ignora dados corrompidos */ }
    return defaults();
  }
  let S = load();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* sem espaço */ } };
  const clientId = () => (S.settings.clientId || CFG.googleClientId || '').trim();

  // ---------- Tarefas ----------
  const isRepeat = (t) => t.repeat && t.repeat !== 'none';
  function occursOn(t, day) {
    if (!isRepeat(t)) return false;
    const start = t.date || dkey(new Date(t.createdAt));
    if (day < start) return false;
    if ((t.skipDates || []).includes(day)) return false;
    const wd = parseD(day).getDay();
    if (t.repeat === 'daily') return true;
    if (t.repeat === 'weekdays') return wd >= 1 && wd <= 5;
    if (t.repeat === 'weekly') return parseD(start).getDay() === wd;
    return false;
  }
  const isDone = (t, day = dkey()) => (isRepeat(t) ? (t.doneDates || []).includes(day) : !!t.done);
  const doneToday = (t) => !isRepeat(t) && t.done && t.doneAt && dkey(new Date(t.doneAt)) === dkey();
  const isLate = (t) => {
    if (isDone(t) || isRepeat(t) || !t.date) return false;
    const today = dkey();
    if (t.date < today) return true;
    return t.date === today && t.time && toMin(t.time) + 30 < toMin(nowHM());
  };

  function sortTasks(a, b) {
    const k = (t) => [isDone(t) ? 1 : 0, isLate(t) ? 0 : 1, t.important ? 0 : 1, t.time || '99:99', t.createdAt];
    const ka = k(a), kb = k(b);
    for (let i = 0; i < ka.length; i++) { if (ka[i] < kb[i]) return -1; if (ka[i] > kb[i]) return 1; }
    return 0;
  }
  function todayTasks() {
    const today = dkey();
    return S.tasks.filter((t) => {
      if (isRepeat(t)) return occursOn(t, today);
      if (!t.date) return doneToday(t);
      return t.date <= today && (!t.done || doneToday(t));
    }).sort(sortTasks);
  }
  const upcomingTasks = () => {
    const today = dkey(), lim = addDays(today, 7);
    return S.tasks.filter((t) => !isRepeat(t) && !t.done && t.date && t.date > today && t.date <= lim)
      .sort((a, b) => (a.date + (a.time || '99')).localeCompare(b.date + (b.time || '99')));
  };
  const laterTasks = () => {
    const lim = addDays(dkey(), 7);
    return S.tasks.filter((t) => !isRepeat(t) && !t.done && t.date && t.date > lim).sort((a, b) => a.date.localeCompare(b.date));
  };
  const somedayTasks = () => S.tasks.filter((t) => !isRepeat(t) && !t.done && !t.date).sort(sortTasks);
  const getTask = (id) => S.tasks.find((t) => t.id === id);
  const nextStep = (t) => (t.steps || []).find((s) => !s.done);

  let skipNow = 0; // "Não é essa agora" — pula para a próxima sem salvar
  function nowTask() {
    const pend = todayTasks().filter((t) => !isDone(t));
    if (!pend.length) return null;
    return pend[skipNow % pend.length];
  }

  function setDone(t, done) {
    const today = dkey();
    if (isRepeat(t)) {
      t.doneDates = (t.doneDates || []).filter((d) => d !== today);
      if (done) t.doneDates.push(today);
      t.doneDates = t.doneDates.slice(-120);
    } else {
      t.done = done;
      t.doneAt = done ? Date.now() : null;
    }
    S.doneDays[today] = Math.max(0, (S.doneDays[today] || 0) + (done ? 1 : -1));
    if (done) { confetti(); haptic(); }
    if (t.gtaskId) gPushTaskStatus(t);
    save();
  }

  function streak() {
    let d = dkey(), n = 0;
    if (!S.doneDays[d]) d = addDays(d, -1);
    while (S.doneDays[d] > 0) { n++; d = addDays(d, -1); }
    return n;
  }

  // ---------- Água ----------
  const waterToday = () => S.water[dkey()] || 0;
  function addWater(n) {
    const k = dkey();
    S.water[k] = Math.max(0, (S.water[k] || 0) + n);
    if (n > 0) {
      S.waterLast = Date.now();
      haptic();
      if (S.water[k] === Number(S.settings.waterGoal)) { confetti(); toast('Meta de água batida! 💧🎉'); }
    }
    save();
  }
  function waterTimes() {
    const st = S.settings, out = [];
    const a = toMin(st.wake), b = toMin(st.sleep), step = Math.max(30, Number(st.waterInterval) || 120);
    for (let m = a; m <= b - 15; m += step) out.push(fromMin(m));
    return out;
  }
  function waterDue() {
    const st = S.settings, now = toMin(nowHM());
    if (now < toMin(st.wake) || now > toMin(st.sleep)) return null;
    if (waterToday() >= Number(st.waterGoal)) return null;
    if (Date.now() < S.ui.dismissWaterUntil) return null;
    const last = S.waterLast && dkey(new Date(S.waterLast)) === dkey() ? S.waterLast : null;
    const since = last ? (Date.now() - last) / 60000 : now - toMin(st.wake);
    return since >= Number(st.waterInterval) ? Math.round(since) : null;
  }
  const fmtMins = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${m % 60 ? pad(m % 60) : ''}`);

  // ---------- Feedback ----------
  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }
  const haptic = () => { try { navigator.vibrate && navigator.vibrate(15); } catch (e) { /* */ } };
  function confetti() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const colors = ['#f0597a', '#ff8a5c', '#ffd25c', '#3fcf8f', '#5aaeff', '#b884ff'];
    for (let i = 0; i < 28; i++) {
      const p = document.createElement('i');
      p.className = 'confetti';
      p.style.background = colors[i % colors.length];
      p.style.setProperty('--dx', `${(Math.random() - 0.5) * 360}px`);
      p.style.setProperty('--dy', `${(Math.random() - 0.7) * 420}px`);
      p.style.setProperty('--r', `${Math.random() * 720}deg`);
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 1200);
    }
  }
  let audioCtx;
  function unlockAudio() {
    try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === 'suspended') audioCtx.resume(); } catch (e) { /* */ }
  }
  function beep() {
    if (!audioCtx) return;
    [0, 0.25, 0.5].forEach((t, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = [880, 988, 1175][i];
      o.connect(g); g.connect(audioCtx.destination);
      const s = audioCtx.currentTime + t;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.25, s + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.22);
      o.start(s); o.stop(s + 0.25);
    });
  }
  async function notify(title, body) {
    try {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) reg.showNotification(title, { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' });
      else new Notification(title, { body });
    } catch (e) { /* */ }
  }

  // ---------- Calendário (.ics) — alarme nativo do iPhone, sem login ----------
  const icsEsc = (s) => String(s).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  const icsLocal = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
  const icsUtc = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const RRULE = { daily: 'FREQ=DAILY', weekdays: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', weekly: 'FREQ=WEEKLY' };
  function buildIcs(events) {
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Bora//PT-BR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    for (const e of events) {
      L.push('BEGIN:VEVENT', `UID:${String(e.uid).replace(/[^\w-]/g, '')}@bora`, `DTSTAMP:${icsUtc(new Date())}`,
        `DTSTART:${icsLocal(e.start)}`, `DTEND:${icsLocal(e.end)}`, `SUMMARY:${icsEsc(e.title)}`);
      if (e.desc) L.push(`DESCRIPTION:${icsEsc(e.desc)}`);
      if (e.rrule) L.push(`RRULE:${e.rrule}`);
      for (const m of e.alarms || [0]) {
        L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(e.title)}`, `TRIGGER:-PT${m}M`, 'END:VALARM');
      }
      L.push('END:VEVENT');
    }
    L.push('END:VCALENDAR');
    return L.join('\r\n');
  }
  function downloadIcs(name, text) {
    const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function taskStart(t) {
    const [h, m] = t.time.split(':').map(Number);
    const d = parseD(t.date || dkey()); d.setHours(h, m, 0, 0);
    return d;
  }
  function taskToEvent(t) {
    const start = taskStart(t);
    const end = new Date(start.getTime() + (Number(t.duration) || 15) * 60000);
    const steps = (t.steps || []).map((s) => `• ${s.t}`).join('\n');
    return { uid: t.id, title: t.title, start, end, rrule: RRULE[t.repeat], alarms: [0, 10], desc: steps ? `Passos:\n${steps}` : '' };
  }
  const icsForTask = (t) => downloadIcs(`${t.title.slice(0, 30).replace(/[^\w\s-]/g, '') || 'tarefa'}.ics`, buildIcs([taskToEvent(t)]));
  function icsWater() {
    const evs = waterTimes().map((hm, i) => {
      const start = parseD(dkey()); const [h, m] = hm.split(':').map(Number); start.setHours(h, m, 0, 0);
      return { uid: `agua-${i}-${hm}`, title: '💧 Beber água', start, end: new Date(start.getTime() + 5 * 60000), rrule: 'FREQ=DAILY', alarms: [0] };
    });
    downloadIcs('lembretes-agua.ics', buildIcs(evs));
  }

  // ---------- Google (Agenda + Tarefas) ----------
  const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, '');
  const gConnected = () => !!S.google.token && Date.now() < S.google.exp - 60000;

  function gLogin() {
    const id = clientId();
    if (!id) { toast('Cole o Client ID do Google em Ajustes primeiro'); go('ajustes'); return; }
    const state = uid();
    try { localStorage.setItem('bora:oauth-state', state); } catch (e) { /* */ }
    const p = new URLSearchParams({
      client_id: id, redirect_uri: redirectUri(), response_type: 'token', scope: SCOPES,
      include_granted_scopes: 'true', state
    });
    if (!S.google.ever) p.set('prompt', 'consent');
    location.href = `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
  }
  function gHandleRedirect() {
    const h = location.hash;
    if (!h.includes('access_token=') && !h.includes('error=')) return false;
    const q = new URLSearchParams(h.slice(1));
    history.replaceState(null, '', location.pathname + location.search);
    if (q.get('error')) { toast(`Google: ${q.get('error')}`); return false; }
    let expected = null;
    try { expected = localStorage.getItem('bora:oauth-state'); localStorage.removeItem('bora:oauth-state'); } catch (e) { /* */ }
    if (expected && q.get('state') !== expected) { toast('Login do Google inválido, tente de novo'); return false; }
    S.google.token = q.get('access_token');
    S.google.exp = Date.now() + Number(q.get('expires_in') || 3600) * 1000;
    S.google.ever = true;
    save();
    toast('Google conectado ✓');
    return true;
  }
  function gLogout() {
    const tk = S.google.token;
    S.google.token = null; S.google.exp = 0;
    save();
    if (tk) fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tk)}`, { method: 'POST' }).catch(() => {});
  }
  async function gFetch(url, opts = {}) {
    if (!gConnected()) throw new Error('auth');
    const r = await fetch(url, {
      ...opts,
      headers: { Authorization: `Bearer ${S.google.token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) }
    });
    if (r.status === 401) { S.google.token = null; save(); throw new Error('auth'); }
    if (!r.ok) throw new Error(`Google ${r.status}: ${(await r.text()).slice(0, 160)}`);
    return r.status === 204 ? null : r.json();
  }
  const CAL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
  const TASKS = 'https://tasks.googleapis.com/tasks/v1/lists/@default/tasks';

  let syncing = false;
  async function gSync(silent) {
    if (!gConnected()) { if (!silent) gLogin(); return; }
    if (syncing) return;
    syncing = true;
    try {
      // Agenda de hoje
      const a = parseD(dkey()), b = new Date(a); b.setDate(b.getDate() + 1);
      const ev = await gFetch(`${CAL}?${new URLSearchParams({ timeMin: a.toISOString(), timeMax: b.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '50' })}`);
      const own = new Set([...S.tasks.map((t) => t.gcalEventId).filter(Boolean), ...S.google.waterEventIds]);
      S.google.events = {
        date: dkey(),
        items: (ev.items || [])
          .filter((e) => e.status !== 'cancelled' && !own.has(e.id) && !own.has(e.recurringEventId))
          .map((e) => ({ id: e.id, title: e.summary || '(sem título)', start: e.start.dateTime || null, end: e.end?.dateTime || null, allDay: !e.start.dateTime, link: e.htmlLink }))
      };

      // Envia conclusões pendentes
      for (const t of S.tasks.filter((x) => x.gtaskId && x.gPending)) await gPushTaskStatus(t, true);

      // Google Tarefas → app
      const res = await gFetch(`${TASKS}?showCompleted=false&maxResults=100`);
      const open = res.items || [];
      const openIds = new Set(open.map((x) => x.id));
      let added = 0;
      for (const g of open) {
        if (!g.title || !g.title.trim()) continue;
        const local = S.tasks.find((t) => t.gtaskId === g.id);
        if (local) {
          local.title = g.title;
          if (local.done) { local.done = false; local.doneAt = null; }
          continue;
        }
        S.tasks.push(newTask({
          title: g.title, date: g.due ? g.due.slice(0, 10) : null, gtaskId: g.id,
          steps: (g.notes || '').split('\n').map((s) => s.replace(/^[-•*]\s*/, '').trim()).filter(Boolean).slice(0, 12).map((s) => ({ t: s, done: false }))
        }));
        added++;
      }
      // Concluída/apagada no Google → conclui aqui
      for (const t of S.tasks) {
        if (t.gtaskId && !t.done && !t.gPending && !openIds.has(t.gtaskId)) { t.done = true; t.doneAt = Date.now(); }
      }
      S.google.lastSync = Date.now();
      save();
      if (!silent) toast(added ? `${added} tarefa(s) importada(s) do Google ✓` : 'Sincronizado com o Google ✓');
    } catch (e) {
      if (e.message === 'auth') { if (!silent) toast('Sessão do Google expirou — toque em Conectar'); }
      else if (!silent) toast('Erro ao sincronizar. Veja Ajustes.');
      console.warn(e);
    } finally {
      syncing = false;
      render();
    }
  }
  async function gPushTaskStatus(t, throwOnFail) {
    if (!gConnected()) { t.gPending = true; save(); return; }
    try {
      await gFetch(`${TASKS}/${encodeURIComponent(t.gtaskId)}`, {
        method: 'PATCH',
        body: JSON.stringify(t.done ? { status: 'completed' } : { status: 'needsAction', completed: null })
      });
      t.gPending = false;
    } catch (e) { t.gPending = true; if (throwOnFail && e.message === 'auth') throw e; }
    save();
  }
  async function gCreateTask(t) {
    try {
      const body = { title: t.title };
      if (t.date) body.due = `${t.date}T00:00:00.000Z`;
      if (t.steps?.length) body.notes = t.steps.map((s) => `- ${s.t}`).join('\n');
      const r = await gFetch(TASKS, { method: 'POST', body: JSON.stringify(body) });
      t.gtaskId = r.id; save();
    } catch (e) { console.warn(e); }
  }
  function eventBody(t) {
    const e = taskToEvent(t);
    const iso = (d) => `${dkey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
    const body = {
      summary: `⏰ ${t.title}`,
      description: `${e.desc ? `${e.desc}\n\n` : ''}Criado pelo app Bora`,
      start: { dateTime: iso(e.start), timeZone: TZ },
      end: { dateTime: iso(e.end), timeZone: TZ },
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }, { method: 'popup', minutes: 10 }] }
    };
    if (e.rrule) body.recurrence = [`RRULE:${e.rrule}`];
    return body;
  }
  async function gUpsertEvent(t) {
    try {
      if (t.gcalEventId) {
        await gFetch(`${CAL}/${t.gcalEventId}`, { method: 'PUT', body: JSON.stringify(eventBody(t)) });
      } else {
        const r = await gFetch(CAL, { method: 'POST', body: JSON.stringify(eventBody(t)) });
        t.gcalEventId = r.id;
      }
      save();
      toast('Alarme criado no Google Agenda ✓');
    } catch (e) {
      toast(e.message === 'auth' ? 'Conecte o Google de novo (Ajustes)' : 'Não deu para criar no Google Agenda');
      console.warn(e);
    }
  }
  const gDeleteEvent = (id) => gFetch(`${CAL}/${id}`, { method: 'DELETE' }).catch(() => {});
  async function gWaterEvents() {
    try {
      for (const id of S.google.waterEventIds) await gDeleteEvent(id);
      S.google.waterEventIds = [];
      for (const hm of waterTimes()) {
        const end = fromMin(toMin(hm) + 5);
        const r = await gFetch(CAL, {
          method: 'POST',
          body: JSON.stringify({
            summary: '💧 Beber água', description: 'Lembrete do app Bora',
            start: { dateTime: `${dkey()}T${hm}:00`, timeZone: TZ }, end: { dateTime: `${dkey()}T${end}:00`, timeZone: TZ },
            recurrence: ['RRULE:FREQ=DAILY'], transparency: 'transparent',
            reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] }
          })
        });
        S.google.waterEventIds.push(r.id);
      }
      save();
      toast(`${S.google.waterEventIds.length} lembretes de água criados ✓`);
    } catch (e) { toast(e.message === 'auth' ? 'Conecte o Google de novo' : 'Erro ao criar lembretes'); console.warn(e); }
    render();
  }
  async function gRemoveWaterEvents() {
    for (const id of S.google.waterEventIds) await gDeleteEvent(id);
    S.google.waterEventIds = []; save(); toast('Lembretes de água removidos'); render();
  }

  // ---------- Criação de tarefa ----------
  function newTask(p) {
    return {
      id: uid(), title: '', date: dkey(), time: null, duration: 15, important: false, repeat: 'none',
      steps: [], done: false, doneAt: null, doneDates: [], skipDates: [], postponed: 0, createdAt: Date.now(), ...p
    };
  }

  // ---------- Navegação / render ----------
  let tab = 'hoje';
  function go(t) {
    tab = t;
    $$('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
    $('#fab').classList.toggle('hidden', !(t === 'hoje'));
    window.scrollTo(0, 0);
    render();
  }
  function render() {
    const v = $('#view');
    if (tab === 'hoje') v.innerHTML = viewHoje();
    else if (tab === 'foco') v.innerHTML = viewFoco();
    else if (tab === 'agua') v.innerHTML = viewAgua();
    else v.innerHTML = viewAjustes();
    document.title = CFG.appName;
  }

  function greeting() {
    const h = new Date().getHours();
    const g = h < 5 ? 'Boa noite' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
    return S.settings.name ? `${g}, ${esc(S.settings.name)}` : g;
  }

  function taskRow(t, opts = {}) {
    const done = isDone(t);
    const tags = [];
    if (opts.showDate && t.date) tags.push(`<span class="tag">${esc(relDay(t.date))}</span>`);
    if (isLate(t)) tags.push(`<span class="tag late">atrasada${t.date < dkey() ? ` · ${esc(relDay(t.date))}` : ''}</span>`);
    if (t.important) tags.push('<span class="tag star">★ importante</span>');
    if (t.time) tags.push(`<span class="tag">🕐 ${t.time}</span>`);
    if (t.duration) tags.push(`<span class="tag">⏱ ${t.duration} min</span>`);
    if (t.steps?.length) tags.push(`<span class="tag">${t.steps.filter((s) => s.done).length}/${t.steps.length} passos</span>`);
    if (isRepeat(t)) tags.push('<span class="tag">🔁</span>');
    if (t.postponed >= 2) tags.push(`<span class="tag late">adiada ${t.postponed}x</span>`);
    if (t.gtaskId) tags.push('<span class="tag gcal">Google</span>');
    return `<div class="task ${done ? 'done' : ''}">
      <button class="check" data-action="toggle" data-id="${t.id}" aria-label="${done ? 'Desmarcar' : 'Concluir'}">${done ? '✓' : ''}</button>
      <div class="body" data-action="open" data-id="${t.id}">
        <div class="t-title">${esc(t.title)}</div>
        ${tags.length ? `<div class="meta">${tags.join('')}</div>` : ''}
      </div>
      ${done ? '' : `<button class="play" data-action="focus" data-id="${t.id}" aria-label="Focar nesta tarefa">▶</button>`}
    </div>`;
  }

  function viewHoje() {
    const today = dkey();
    const all = todayTasks();
    const pend = all.filter((t) => !isDone(t));
    const done = all.filter((t) => isDone(t));
    const pct = all.length ? Math.round((done.length / all.length) * 100) : 0;
    const wt = waterToday(), wg = Number(S.settings.waterGoal);
    const wpct = Math.min(100, Math.round((wt / wg) * 100));
    const now = nowTask();
    const due = waterDue();
    const st = streak();
    let h = '';

    h += `<header class="hello"><div><h1>${greeting()}</h1><div class="date cap">${esc(fmtDate(today))}</div></div>
      ${st ? `<div class="streak" title="Dias seguidos concluindo algo">🔥 ${st}</div>` : ''}</header>`;

    if (!S.onboarded) {
      h += `<div class="card"><b>Oi! 👋 Bem-vinda ao ${esc(CFG.appName)}.</b>
        <p class="muted" style="margin:6px 0 12px">Um lugar só pro que importa hoje, com um empurrãozinho pra começar.</p>
        <div class="field"><label for="ob-name">Como você quer ser chamada?</label><input id="ob-name" placeholder="Seu nome" autocomplete="given-name"></div>
        <button class="btn primary block" data-action="onboard">Bora começar</button></div>`;
    }

    if (isIOS() && !isStandalone() && !S.ui.dismissInstall) {
      h += `<div class="banner info"><div class="txt">📲 <b>Instale no iPhone:</b> toque em <b>Compartilhar</b> ⬆️ e depois em <b>Adicionar à Tela de Início</b>.</div>
        <button class="x" data-action="dismiss-install" aria-label="Fechar">×</button></div>`;
    }

    h += `<div class="row-cards" style="margin-top:4px">
      <div class="card stat"><div class="ring" style="--p:${pct}" data-label="${pct}%"></div><div><div class="big">${done.length}/${all.length}</div><div class="small">feitas hoje</div></div></div>
      <button class="card stat" data-action="water+1" style="text-align:left"><div class="ring" style="--p:${wpct};--c:var(--water)" data-label="💧"></div><div><div class="big">${wt}/${wg}</div><div class="small">copos · toque +1</div></div></button>
    </div>`;

    if (due) {
      h += `<div class="banner water"><div class="txt">💧 Faz <b>${fmtMins(due)}</b> sem beber água.</div>
        <button class="btn water" data-action="water+1">Bebi</button><button class="x" data-action="water-snooze" aria-label="Lembrar depois">×</button></div>`;
    }

    // Próximo evento do Google
    if (S.google.events.date === today) {
      const nm = toMin(nowHM());
      const nx = S.google.events.items.find((e) => e.start && toMin(new Date(e.start).toTimeString().slice(0, 5)) >= nm - 5);
      if (nx) {
        const hm = new Date(nx.start).toTimeString().slice(0, 5);
        const diff = toMin(hm) - nm;
        h += `<div class="banner info"><div class="txt">📅 <b>${hm}</b> ${esc(nx.title)} <span class="muted">${diff > 0 ? `· em ${fmtMins(diff)}` : '· agora'}</span></div></div>`;
      }
    }

    // Agora
    if (now) {
      const step = nextStep(now);
      h += `<section class="now">
        <div class="label">${pend.length > 1 ? `Agora · 1 de ${pend.length}` : 'Agora'}</div>
        <div class="title">${esc(now.title)}</div>
        <div class="step">${step ? `Primeiro passo: <b>${esc(step.t)}</b>` : 'Só os primeiros 5 minutos. Depois você decide se continua.'}</div>
        <div class="actions">
          <button class="btn primary" data-action="start5" data-id="${now.id}">▶ Começar 5 min</button>
          <button class="btn" data-action="toggle" data-id="${now.id}">✓ Feito</button>
          <button class="btn" data-action="postpone" data-id="${now.id}">Adiar</button>
          ${pend.length > 1 ? '<button class="btn" data-action="skip-now">Outra</button>' : ''}
        </div></section>`;
    } else if (all.length) {
      h += `<section class="now empty"><div style="font-size:40px">🎉</div><b>Tudo feito por hoje!</b><p class="muted" style="margin:4px 0 0">Descansa sem culpa. Você mereceu.</p></section>`;
    } else {
      h += `<section class="now empty"><div style="font-size:36px">🌱</div><b>Nada planejado pra hoje</b>
        <p class="muted" style="margin:4px 0 12px">Qual é <i>uma</i> coisa que faria o dia valer?</p>
        <button class="btn primary" data-action="new-task">+ Adicionar tarefa</button></section>`;
    }

    if (pend.length) {
      h += `<h2 class="section">Hoje <span>${pend.length}</span></h2><div class="list">${pend.map((t) => taskRow(t)).join('')}</div>`;
    }

    if (S.google.events.date === today && S.google.events.items.length) {
      h += `<h2 class="section">Agenda Google <button data-action="gsync">Atualizar</button></h2><div class="list">
        ${S.google.events.items.map((e) => `<div class="task"><span class="event-time">${e.allDay ? 'dia' : new Date(e.start).toTimeString().slice(0, 5)}</span><div class="body"><div class="t-title">${esc(e.title)}</div></div></div>`).join('')}</div>`;
    } else if (gConnected() || S.google.ever) {
      h += `<h2 class="section">Agenda Google <button data-action="gsync">${gConnected() ? 'Atualizar' : 'Reconectar'}</button></h2>`;
    }

    if (done.length) {
      h += `<details class="more"><summary><h2 class="section">Feitas hoje ✓ <span>${done.length}</span></h2></summary><div class="list">${done.map((t) => taskRow(t)).join('')}</div></details>`;
    }
    const up = upcomingTasks();
    if (up.length) h += `<details class="more"><summary><h2 class="section">Próximos 7 dias <span>${up.length}</span></h2></summary><div class="list">${up.map((t) => taskRow(t, { showDate: true })).join('')}</div></details>`;
    const later = laterTasks();
    if (later.length) h += `<details class="more"><summary><h2 class="section">Mais pra frente <span>${later.length}</span></h2></summary><div class="list">${later.map((t) => taskRow(t, { showDate: true })).join('')}</div></details>`;
    const some = somedayTasks();
    if (some.length) h += `<details class="more"><summary><h2 class="section">Algum dia <span>${some.length}</span></h2></summary><div class="list">${some.map((t) => taskRow(t)).join('')}</div></details>`;
    return h;
  }

  // ---------- Foco ----------
  function timerLeft() {
    const t = S.timer;
    if (!t) return 0;
    if (t.pausedLeft != null) return t.pausedLeft;
    return Math.max(0, Math.round((t.endsAt - Date.now()) / 1000));
  }
  function startTimer(taskId, minutes, mode = 'focus') {
    unlockAudio();
    S.timer = { taskId, mode, total: minutes * 60, endsAt: Date.now() + minutes * 60000, pausedLeft: null, notified: false };
    save();
    go('foco');
  }
  function viewFoco() {
    const t = S.timer;
    if (!t) {
      const pend = todayTasks().filter((x) => !isDone(x));
      const sel = pend[0];
      return `<header class="hello"><div><h1>Foco</h1><div class="date">Começar é a parte mais difícil. Começa pequeno.</div></div></header>
        <div class="field"><label for="focus-task">Em quê?</label>
          <select id="focus-task">${pend.map((x) => `<option value="${x.id}" ${sel && x.id === sel.id ? 'selected' : ''}>${esc(x.title)}</option>`).join('')}<option value="">Sem tarefa específica</option></select></div>
        <div class="stack">
          <button class="preset" data-action="preset" data-min="2"><span class="em">🐣</span><span><b>2 minutos</b><small>Quando nem começar parece possível</small></span></button>
          <button class="preset" data-action="preset" data-min="5"><span class="em">🚀</span><span><b>5 minutos — só começar</b><small>Depois você decide se continua</small></span></button>
          <button class="preset" data-action="preset" data-min="25"><span class="em">🍅</span><span><b>25 minutos — foco</b><small>Pomodoro clássico, depois pausa de 5</small></span></button>
          <button class="preset" data-action="preset" data-min="50"><span class="em">🏔️</span><span><b>50 minutos — foco longo</b><small>Pra quando você já engrenou</small></span></button>
        </div>
        <div class="card" style="margin-top:16px"><b>Dica anti-trava</b><p class="muted" style="margin:6px 0 0">Se não consegue começar, a tarefa provavelmente está grande ou vaga. Abra a tarefa e quebre em passos ridiculamente pequenos (ex.: “abrir o e-mail”).</p></div>`;
    }
    const task = t.taskId ? getTask(t.taskId) : null;
    const left = timerLeft();
    const pct = t.total ? Math.round(((t.total - left) / t.total) * 100) : 0;
    const step = task && nextStep(task);
    return `<header class="hello"><div><h1>${t.mode === 'break' ? 'Pausa' : 'Foco'}</h1><div class="date">${t.mode === 'break' ? 'Levanta, bebe água, alonga.' : 'Celular virado, uma coisa de cada vez.'}</div></div></header>
      <div class="timer-wrap"><div class="timer ${t.mode === 'break' ? 'break' : ''}" style="--p:${pct}" id="timer-ring"><div class="inner"><div>
        <div class="time" id="timer-time">${pad(Math.floor(left / 60))}:${pad(left % 60)}</div>
        <div class="mode">${t.pausedLeft != null ? 'pausado' : t.mode === 'break' ? 'pausa' : 'focando'}</div></div></div></div></div>
      ${task ? `<div class="focus-task"><div class="title">${esc(task.title)}</div>
        ${step ? `<div class="step">Agora: <b>${esc(step.t)}</b></div><div class="controls"><button class="btn ok" data-action="step-done" data-id="${task.id}">✓ Passo feito</button></div>` : ''}</div>` : ''}
      <div class="controls">
        ${t.pausedLeft != null ? '<button class="btn primary" data-action="t-resume">▶ Continuar</button>' : '<button class="btn" data-action="t-pause">❚❚ Pausar</button>'}
        <button class="btn" data-action="t-plus5">+5 min</button>
        <button class="btn" data-action="t-stop">Parar</button>
      </div>
      ${task && !isDone(task) ? `<div class="controls"><button class="btn ok block" data-action="t-finish" data-id="${task.id}">🎉 Terminei a tarefa!</button></div>` : ''}`;
  }
  function tickTimer() {
    const t = S.timer;
    if (!t) return;
    const left = timerLeft();
    if (tab === 'foco') {
      const el = $('#timer-time'), ring = $('#timer-ring');
      if (el) el.textContent = `${pad(Math.floor(left / 60))}:${pad(left % 60)}`;
      if (ring) ring.style.setProperty('--p', Math.round(((t.total - left) / t.total) * 100));
    }
    if (left <= 0 && t.pausedLeft == null && !t.notified) {
      t.notified = true; save();
      beep(); haptic();
      if (t.mode === 'break') notify('Pausa acabou', 'Bora voltar?'); else notify('Tempo! ⏰', 'Mandou bem. Continua ou faz uma pausa?');
      timerDoneSheet();
    }
  }
  function timerDoneSheet() {
    const t = S.timer;
    const task = t.taskId ? getTask(t.taskId) : null;
    if (t.mode === 'break') {
      sheet(`<h3>Pausa acabou ☕</h3><p>Bora mais uma rodada?</p><div class="stack">
        <button class="btn primary" data-action="sh-focus" data-min="25">🍅 Mais 25 min</button>
        <button class="btn" data-action="sh-focus" data-min="5">🚀 Só 5 min</button>
        <button class="btn" data-action="sh-stop">Chega por agora</button></div>`);
      return;
    }
    sheet(`<h3>Tempo! 🎉</h3><p>${task ? `Você trabalhou em <b>${esc(task.title)}</b>. ` : ''}O mais difícil (começar) já foi.</p><div class="stack">
      ${task && !isDone(task) ? `<button class="btn ok" data-action="sh-finish" data-id="${task.id}">✓ Terminei a tarefa</button>` : ''}
      <button class="btn primary" data-action="sh-focus" data-min="5">Continuar mais 5 min</button>
      <button class="btn" data-action="sh-focus" data-min="25">Engatar 25 min</button>
      <button class="btn" data-action="sh-break">☕ Pausa de 5 min</button>
      <button class="btn ghost" data-action="sh-stop">Parar por aqui</button></div>`);
  }

  // ---------- Água (tela) ----------
  function viewAgua() {
    const wt = waterToday(), wg = Number(S.settings.waterGoal), ml = Number(S.settings.glassMl);
    const pct = Math.min(100, (wt / wg) * 100);
    const days = [...Array(7)].map((_, i) => addDays(dkey(), i - 6));
    const times = waterTimes();
    const last = S.waterLast && dkey(new Date(S.waterLast)) === dkey() ? new Date(S.waterLast).toTimeString().slice(0, 5) : null;
    return `<header class="hello"><div><h1>Água</h1><div class="date">${wt * ml} ml de ${wg * ml} ml${last ? ` · último copo ${last}` : ''}</div></div></header>
      <div class="glass-wrap"><div class="glass"><div class="fill" style="height:${pct}%"></div><div class="num">${wt}/${wg}</div></div></div>
      <div class="water-btns"><button class="btn" data-action="water-1" aria-label="Remover um copo">−1</button>
        <button class="btn water" data-action="water+1" style="padding:12px 28px">+1 copo (${ml} ml)</button></div>
      <h2 class="section">Últimos 7 dias</h2>
      <div class="card"><div class="bars">${days.map((d) => {
        const v = S.water[d] || 0;
        return `<div class="bar"><div class="b"><i style="height:${Math.min(100, (v / wg) * 100)}%"></i></div><span>${v}</span><span>${esc(parseD(d).toLocaleDateString('pt-BR', { weekday: 'narrow' }).toUpperCase())}</span></div>`;
      }).join('')}</div></div>
      <h2 class="section">Alarmes de água</h2>
      <div class="card"><p class="muted" style="margin:0">Com o app fechado, quem te avisa é o calendário do celular. Horários (mude em Ajustes):</p>
        <div class="times">${times.map((x) => `<span class="tag">${x}</span>`).join('')}</div>
        <div class="stack">
          ${gConnected() ? `<button class="btn water" data-action="g-water">${S.google.waterEventIds.length ? 'Recriar' : 'Criar'} alarmes no Google Agenda</button>` : ''}
          ${S.google.waterEventIds.length && gConnected() ? '<button class="btn danger" data-action="g-water-del">Remover alarmes do Google</button>' : ''}
          <button class="btn" data-action="ics-water">📅 Adicionar ao Calendário do iPhone</button>
        </div>
        <p class="hint">O arquivo abre no Calendário: toque em “Adicionar todos”. Cada horário se repete todo dia com alarme.</p></div>`;
  }

  // ---------- Ajustes ----------
  function viewAjustes() {
    const st = S.settings;
    const conn = gConnected();
    return `<header class="hello"><div><h1>Ajustes</h1><div class="date">Tudo fica salvo só neste celular.</div></div></header>
      <div class="set-group"><h4>Você</h4>
        <div class="field"><label for="s-name">Nome</label><input id="s-name" data-set="name" value="${esc(st.name)}" placeholder="Seu nome"></div></div>

      <div class="set-group"><h4>Água</h4>
        <div class="two"><div class="field"><label for="s-goal">Meta (copos)</label><input id="s-goal" type="number" min="1" max="30" inputmode="numeric" data-set="waterGoal" value="${st.waterGoal}"></div>
        <div class="field"><label for="s-ml">ml por copo</label><input id="s-ml" type="number" min="50" max="1000" step="50" inputmode="numeric" data-set="glassMl" value="${st.glassMl}"></div></div>
        <div class="two"><div class="field"><label for="s-wake">Acordo</label><input id="s-wake" type="time" data-set="wake" value="${st.wake}"></div>
        <div class="field"><label for="s-sleep">Durmo</label><input id="s-sleep" type="time" data-set="sleep" value="${st.sleep}"></div></div>
        <div class="field"><label for="s-int">Lembrar a cada</label><select id="s-int" data-set="waterInterval">
          ${[60, 90, 120, 150, 180].map((m) => `<option value="${m}" ${Number(st.waterInterval) === m ? 'selected' : ''}>${fmtMins(m)}</option>`).join('')}</select></div></div>

      <div class="set-group"><h4>Google Agenda e Tarefas</h4>
        <p class="muted" style="margin:0 0 12px">${conn ? '<span class="ok-dot"></span>Conectado' : S.google.ever ? '<span class="off-dot"></span>Sessão expirada (dura ~1h, reconectar é rápido)' : '<span class="off-dot"></span>Não conectado'}
        ${S.google.lastSync ? `<br><small class="muted">Última sincronização: ${new Date(S.google.lastSync).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</small>` : ''}</p>
        <div class="stack">
          ${conn ? '<button class="btn primary" data-action="gsync">Sincronizar agora</button><button class="btn danger" data-action="glogout">Desconectar</button>'
            : `<button class="btn primary" data-action="glogin" ${clientId() ? '' : 'disabled'}>Conectar conta Google</button>`}
        </div>
        <label class="toggle" style="margin-top:12px"><span>Tarefas novas também vão pro Google Tarefas</span><input type="checkbox" data-set="pushTasksToGoogle" ${st.pushTasksToGoogle ? 'checked' : ''}></label>
        <details style="margin-top:12px"><summary class="muted">Configuração técnica (Client ID)</summary>
          <div class="field" style="margin-top:10px"><label for="s-cid">Client ID OAuth</label><input id="s-cid" data-set="clientId" value="${esc(st.clientId)}" placeholder="${esc(CFG.googleClientId || 'xxxx.apps.googleusercontent.com')}" autocapitalize="off" autocorrect="off" spellcheck="false">
          <div class="hint">Vazio = usa o do config.js${CFG.googleClientId ? ' (já configurado)' : ' (ainda vazio)'}.</div></div>
          <div class="lbl muted" style="font-size:13px;margin-bottom:6px">URI de redirecionamento e origem para cadastrar no Google Cloud:</div>
          <div class="mono">${esc(redirectUri())}</div><div class="mono" style="margin-top:6px">${esc(location.origin)}</div>
        </details></div>

      <div class="set-group"><h4>Avisos</h4>
        <p class="muted" style="margin:0 0 12px">Com o app aberto, ele toca e avisa quando o timer acaba. Para alarmes com o app fechado, use “Alarme” nas tarefas (vai pro Calendário/Google Agenda).</p>
        <button class="btn block" data-action="notif">${'Notification' in window && Notification.permission === 'granted' ? '✓ Notificações permitidas' : 'Permitir notificações'}</button></div>

      <div class="set-group"><h4>Backup</h4>
        <p class="muted" style="margin:0 0 12px">Para trocar de celular ou não perder nada.</p>
        <div class="two"><button class="btn" data-action="export">Exportar</button><button class="btn" data-action="import">Importar</button></div>
        <input type="file" id="import-file" accept="application/json,.json" hidden></div>

      <div class="set-group"><h4>Como instalar no iPhone</h4>
        <ol class="muted" style="margin:0;padding-left:20px"><li>Abra este link no <b>Safari</b></li><li>Toque em <b>Compartilhar</b> ⬆️</li><li><b>Adicionar à Tela de Início</b></li></ol></div>

      <div class="set-group"><button class="btn danger block" data-action="reset">Apagar todos os dados deste celular</button></div>
      <p class="muted" style="text-align:center;font-size:12px;margin-top:18px">${esc(CFG.appName)} · feito com carinho 💛</p>`;
  }

  // ---------- Bottom sheet ----------
  function sheet(html) {
    const root = $('#sheet-root');
    root.innerHTML = `<div class="backdrop" data-action="sheet-close"></div><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
    const first = $('.sheet input[autofocus]', root);
    if (first) setTimeout(() => first.focus(), 250);
  }
  const closeSheet = () => { $('#sheet-root').innerHTML = ''; };

  function taskForm(t) {
    const editing = !!t;
    t = t || newTask({});
    const today = dkey(), tomorrow = addDays(today, 1);
    const when = !t.date ? 'none' : t.date === today ? 'today' : t.date === tomorrow ? 'tomorrow' : 'pick';
    sheet(`<h3>${editing ? 'Editar tarefa' : 'Nova tarefa'}</h3>
      <form id="task-form" data-id="${editing ? t.id : ''}">
        <div class="field"><input name="title" placeholder="O que precisa ser feito?" value="${esc(t.title)}" required ${editing ? '' : 'autofocus'} enterkeyhint="done"></div>
        <div class="field"><span class="lbl">Quando</span><div class="chips" data-group="when">
          <button type="button" class="chip ${when === 'today' ? 'on' : ''}" data-v="today">Hoje</button>
          <button type="button" class="chip ${when === 'tomorrow' ? 'on' : ''}" data-v="tomorrow">Amanhã</button>
          <button type="button" class="chip ${when === 'pick' ? 'on' : ''}" data-v="pick">Escolher dia</button>
          <button type="button" class="chip ${when === 'none' ? 'on' : ''}" data-v="none">Algum dia</button></div>
          <input type="date" name="date" value="${t.date || today}" style="margin-top:8px;${when === 'pick' ? '' : 'display:none'}"></div>
        <div class="two">
          <div class="field"><label>Horário (opcional)</label><input type="time" name="time" value="${t.time || ''}"></div>
          <div class="field"><label>Repetir</label><select name="repeat">
            ${[['none', 'Não repete'], ['daily', 'Todo dia'], ['weekdays', 'Dias úteis'], ['weekly', 'Toda semana']].map(([v, l]) => `<option value="${v}" ${t.repeat === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
        <div class="field"><span class="lbl">Quanto tempo leva?</span><div class="chips" data-group="duration">
          ${[5, 15, 30, 60, 120].map((m) => `<button type="button" class="chip ${Number(t.duration) === m ? 'on' : ''}" data-v="${m}">${m < 60 ? `${m} min` : `${m / 60}h`}</button>`).join('')}</div></div>
        <div class="field"><label>Passos pequenos (um por linha)</label>
          <textarea name="steps" placeholder="abrir o notebook&#10;achar o arquivo&#10;escrever a primeira frase">${esc((t.steps || []).map((s) => s.t).join('\n'))}</textarea>
          <div class="hint">Quanto menor o passo, mais fácil começar. O app mostra só o próximo.</div></div>
        <label class="toggle"><span>★ Importante (aparece primeiro)</span><input type="checkbox" name="important" ${t.important ? 'checked' : ''}></label>
        <label class="toggle" style="margin-top:10px"><span>⏰ Criar alarme ${gConnected() ? 'no Google Agenda' : 'no Calendário'}<br><small class="muted">precisa de horário</small></span><input type="checkbox" name="alarm" ${t.gcalEventId ? 'checked' : ''}></label>
        <div class="sheet-actions">
          ${editing ? '<button type="button" class="btn danger" data-action="delete" data-id="' + t.id + '">Apagar</button>' : '<button type="button" class="btn" data-action="sheet-close">Cancelar</button>'}
          <button type="submit" class="btn primary">Salvar</button></div>
      </form>`);
  }

  function saveTaskForm(form) {
    const f = new FormData(form);
    const title = String(f.get('title') || '').trim();
    if (!title) { toast('Escreva o nome da tarefa'); return; }
    const when = $('[data-group="when"] .on', form)?.dataset.v || 'today';
    const today = dkey();
    const date = when === 'today' ? today : when === 'tomorrow' ? addDays(today, 1) : when === 'pick' ? (f.get('date') || today) : null;
    const durEl = $('[data-group="duration"] .on', form);
    const id = form.dataset.id;
    const existing = id ? getTask(id) : null;
    const oldSteps = existing ? existing.steps || [] : [];
    const steps = String(f.get('steps') || '').split('\n').map((s) => s.trim()).filter(Boolean)
      .map((s) => ({ t: s, done: !!oldSteps.find((o) => o.t === s && o.done) }));
    const repeat = f.get('repeat') || 'none';
    const data = {
      title, date: repeat !== 'none' && !date ? today : date, time: f.get('time') || null,
      duration: durEl ? Number(durEl.dataset.v) : 15, important: f.get('important') === 'on', repeat, steps
    };
    let t;
    if (existing) { Object.assign(existing, data); t = existing; } else { t = newTask(data); S.tasks.push(t); }
    save();
    closeSheet();
    const wantAlarm = f.get('alarm') === 'on';
    if (wantAlarm) {
      if (!t.time) toast('Pra ter alarme, coloque um horário');
      else if (gConnected()) gUpsertEvent(t);
      else icsForTask(t); // precisa rodar ainda dentro do toque
    } else if (t.gcalEventId && gConnected()) {
      gDeleteEvent(t.gcalEventId); t.gcalEventId = null; save();
    }
    if (!existing && !t.gtaskId && S.settings.pushTasksToGoogle && gConnected() && !isRepeat(t)) gCreateTask(t);
    if (!wantAlarm) toast(existing ? 'Tarefa atualizada' : 'Tarefa criada ✓');
    render();
  }

  function taskDetail(t) {
    const steps = t.steps || [];
    sheet(`<h3>${esc(t.title)}</h3>
      <div class="meta" style="margin:-6px 0 14px">
        ${t.date ? `<span class="tag">${esc(relDay(t.date))}</span>` : '<span class="tag">algum dia</span>'}
        ${t.time ? `<span class="tag">🕐 ${t.time}</span>` : ''}${t.duration ? `<span class="tag">⏱ ${t.duration} min</span>` : ''}
        ${isRepeat(t) ? `<span class="tag">🔁 ${{ daily: 'todo dia', weekdays: 'dias úteis', weekly: 'toda semana' }[t.repeat]}</span>` : ''}
        ${t.postponed ? `<span class="tag late">adiada ${t.postponed}x</span>` : ''}
      </div>
      ${steps.length ? `<div class="card steps" style="margin-bottom:14px">${steps.map((s, i) => `<button class="step-row ${s.done ? 'done' : ''}" data-action="step-toggle" data-id="${t.id}" data-i="${i}" style="width:100%;text-align:left"><span class="check">${s.done ? '✓' : ''}</span><span>${esc(s.t)}</span></button>`).join('')}</div>`
        : '<div class="callout">💡 Parece grande? Toque em <b>Editar</b> e quebre em passos pequenos.</div>'}
      <div class="stack">
        ${isDone(t) ? `<button class="btn" data-action="toggle" data-id="${t.id}">Desmarcar como feita</button>`
          : `<button class="btn primary" data-action="start5" data-id="${t.id}">▶ Começar 5 min</button>
             <button class="btn ok" data-action="toggle" data-id="${t.id}">✓ Concluir</button>
             <button class="btn" data-action="postpone" data-id="${t.id}">Adiar</button>`}
        <div class="two"><button class="btn" data-action="edit" data-id="${t.id}">Editar</button>
          <button class="btn" data-action="alarm" data-id="${t.id}">⏰ Alarme</button></div>
      </div>`);
  }

  function postponeSheet(t) {
    const n = t.postponed || 0;
    const intervention = n >= 2 ? `<div class="callout">Essa já foi adiada <b>${n} vezes</b>. Tudo bem — normalmente é porque ela está grande ou não está clara. Que tal uma dessas antes?</div>
      <div class="stack" style="margin-bottom:16px">
        <button class="btn primary" data-action="preset-task" data-id="${t.id}" data-min="2">🐣 Fazer só 2 minutos agora</button>
        <button class="btn" data-action="edit" data-id="${t.id}">✂️ Quebrar em passos menores</button>
        <button class="btn danger" data-action="delete" data-id="${t.id}">🗑 Apagar — não é importante</button></div>
      <p>Ou adiar mesmo:</p>` : '<p>Sem culpa. Mas escolha quando, pra ela não sumir.</p>';
    if (isRepeat(t)) {
      sheet(`<h3>Pular hoje?</h3>${intervention}<div class="stack"><button class="btn" data-action="pp" data-id="${t.id}" data-v="skip">Pular só hoje</button><button class="btn ghost" data-action="sheet-close">Cancelar</button></div>`);
      return;
    }
    const canHour = toMin(nowHM()) < 22 * 60;
    sheet(`<h3>Adiar para quando?</h3>${intervention}<div class="stack">
      ${canHour ? `<button class="btn" data-action="pp" data-id="${t.id}" data-v="1h">Daqui 1 hora (${fromMin(Math.ceil((toMin(nowHM()) + 60) / 15) * 15)})</button>` : ''}
      <button class="btn" data-action="pp" data-id="${t.id}" data-v="tonight">Hoje à noite (19:00)</button>
      <button class="btn" data-action="pp" data-id="${t.id}" data-v="tomorrow">Amanhã</button>
      <button class="btn" data-action="pp" data-id="${t.id}" data-v="week">Semana que vem</button>
      <button class="btn" data-action="pp" data-id="${t.id}" data-v="someday">Algum dia</button>
      <button class="btn ghost" data-action="sheet-close">Cancelar</button></div>`);
  }
  function doPostpone(t, v) {
    const today = dkey();
    if (v === 'skip') { t.skipDates = [...(t.skipDates || []), today].slice(-60); }
    else if (v === '1h') { t.date = today; t.time = fromMin(Math.min(23 * 60 + 45, Math.ceil((toMin(nowHM()) + 60) / 15) * 15)); }
    else if (v === 'tonight') { t.date = today; t.time = '19:00'; }
    else if (v === 'tomorrow') { t.date = addDays(today, 1); }
    else if (v === 'week') { t.date = addDays(today, 7); }
    else if (v === 'someday') { t.date = null; }
    t.postponed = (t.postponed || 0) + 1;
    skipNow = 0;
    save(); closeSheet(); render();
    toast(v === 'skip' ? 'Pulada hoje' : 'Adiada. Ela volta, viu? 😉');
    if (t.gcalEventId && t.time && t.date && gConnected()) gUpsertEvent(t);
  }

  function alarmSheet(t) {
    if (!t.time) { toast('Coloque um horário na tarefa primeiro'); taskForm(t); return; }
    sheet(`<h3>Alarme para “${esc(t.title)}”</h3><p>${esc(relDay(t.date || dkey()))} às ${t.time}${isRepeat(t) ? ', repetindo' : ''}. Avisa na hora e 10 min antes.</p>
      <div class="stack">
        ${gConnected() ? `<button class="btn primary" data-action="alarm-g" data-id="${t.id}">${t.gcalEventId ? 'Atualizar' : 'Criar'} no Google Agenda</button>` : ''}
        <button class="btn ${gConnected() ? '' : 'primary'}" data-action="alarm-ics" data-id="${t.id}">📅 Adicionar ao Calendário do iPhone</button>
        <button class="btn ghost" data-action="sheet-close">Cancelar</button></div>`);
  }

  // ---------- Eventos ----------
  document.addEventListener('click', (e) => {
    const tabBtn = e.target.closest('.tabbar button');
    if (tabBtn) { go(tabBtn.dataset.tab); return; }

    const chip = e.target.closest('.chip');
    if (chip && chip.parentElement.dataset.group) {
      $$('.chip', chip.parentElement).forEach((c) => c.classList.toggle('on', c === chip));
      if (chip.parentElement.dataset.group === 'when') {
        const di = $('#task-form input[name="date"]');
        if (di) di.style.display = chip.dataset.v === 'pick' ? '' : 'none';
      }
      return;
    }

    const el = e.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action;
    const t = el.dataset.id ? getTask(el.dataset.id) : null;

    switch (a) {
      case 'new-task': taskForm(); break;
      case 'open': if (t) taskDetail(t); break;
      case 'edit': if (t) taskForm(t); break;
      case 'toggle':
        if (t) { setDone(t, !isDone(t)); closeSheet(); if (isDone(t)) toast(['Boa! ✓', 'Mandou bem! 💪', 'Uma a menos! 🎉', 'Isso aí! ✨'][Math.floor(Math.random() * 4)]); render(); }
        break;
      case 'delete':
        if (t && confirm(`Apagar “${t.title}”?`)) {
          if (t.gcalEventId && gConnected()) gDeleteEvent(t.gcalEventId);
          S.tasks = S.tasks.filter((x) => x.id !== t.id);
          if (S.timer?.taskId === t.id) S.timer = null;
          save(); closeSheet(); render(); toast('Apagada');
        }
        break;
      case 'postpone': if (t) postponeSheet(t); break;
      case 'pp': if (t) doPostpone(t, el.dataset.v); break;
      case 'skip-now': skipNow++; render(); break;
      case 'start5': closeSheet(); startTimer(t ? t.id : null, 5); break;
      case 'focus': startTimer(t.id, 25); break;
      case 'preset-task': closeSheet(); startTimer(t.id, Number(el.dataset.min)); break;
      case 'preset': startTimer($('#focus-task')?.value || null, Number(el.dataset.min)); break;
      case 'step-toggle':
        if (t) { const s = t.steps[Number(el.dataset.i)]; s.done = !s.done; save(); taskDetail(t); render(); }
        break;
      case 'step-done':
        if (t) { const s = nextStep(t); if (s) { s.done = true; haptic(); save(); if (!nextStep(t)) toast('Todos os passos feitos! Concluir a tarefa?'); render(); } }
        break;
      case 'alarm': if (t) alarmSheet(t); break;
      case 'alarm-g': if (t) { closeSheet(); gUpsertEvent(t); } break;
      case 'alarm-ics': if (t) { closeSheet(); icsForTask(t); } break;

      case 't-pause': S.timer.pausedLeft = timerLeft(); save(); render(); break;
      case 't-resume': unlockAudio(); S.timer.endsAt = Date.now() + S.timer.pausedLeft * 1000; S.timer.pausedLeft = null; save(); render(); break;
      case 't-plus5':
        if (S.timer.pausedLeft != null) S.timer.pausedLeft += 300; else S.timer.endsAt += 300000;
        S.timer.total += 300; S.timer.notified = false; save(); render(); break;
      case 't-stop': S.timer = null; save(); render(); break;
      case 't-finish': case 'sh-finish':
        if (t && !isDone(t)) setDone(t, true);
        S.timer = null; save(); closeSheet(); toast('Tarefa concluída! 🎉'); go('hoje'); break;
      case 'sh-focus': closeSheet(); startTimer(S.timer?.taskId || null, Number(el.dataset.min)); break;
      case 'sh-break': closeSheet(); startTimer(S.timer?.taskId || null, 5, 'break'); break;
      case 'sh-stop': closeSheet(); S.timer = null; save(); go('hoje'); break;

      case 'water+1': addWater(1); render(); break;
      case 'water-1': addWater(-1); render(); break;
      case 'water-snooze': S.ui.dismissWaterUntil = Date.now() + 30 * 60000; save(); render(); break;
      case 'ics-water': icsWater(); break;
      case 'g-water': gWaterEvents(); break;
      case 'g-water-del': gRemoveWaterEvents(); break;

      case 'onboard': S.settings.name = ($('#ob-name')?.value || '').trim(); S.onboarded = true; save(); render(); break;
      case 'dismiss-install': S.ui.dismissInstall = true; save(); render(); break;
      case 'glogin': gLogin(); break;
      case 'glogout': gLogout(); render(); toast('Google desconectado'); break;
      case 'gsync': gSync(false); break;
      case 'notif':
        if (!('Notification' in window)) { toast(isIOS() ? 'Instale na Tela de Início primeiro (iOS 16.4+)' : 'Navegador sem suporte'); break; }
        Notification.requestPermission().then(() => render());
        break;
      case 'export': {
        const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url; link.download = `bora-backup-${dkey()}.json`; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        break;
      }
      case 'import': $('#import-file').click(); break;
      case 'reset':
        if (confirm('Apagar TODAS as tarefas e ajustes deste celular? Não dá pra desfazer.')) { localStorage.removeItem(KEY); S = load(); go('hoje'); }
        break;
      case 'sheet-close': closeSheet(); break;
      default: break;
    }
  });

  document.addEventListener('submit', (e) => {
    if (e.target.id === 'task-form') { e.preventDefault(); saveTaskForm(e.target); }
  });

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.id === 'import-file' && el.files[0]) {
      el.files[0].text().then((txt) => {
        const d = JSON.parse(txt);
        if (!Array.isArray(d.tasks)) throw new Error('arquivo inválido');
        localStorage.setItem(KEY, JSON.stringify(d)); S = load(); render(); toast('Backup importado ✓');
      }).catch(() => toast('Arquivo inválido'));
      return;
    }
    const k = el.dataset.set;
    if (!k) return;
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (['waterGoal', 'glassMl', 'waterInterval'].includes(k)) v = Math.max(1, Number(v) || S.settings[k]);
    if (k === 'clientId') v = String(v).trim();
    S.settings[k] = v;
    save();
    if (k !== 'name') render();
    toast('Salvo');
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      render();
      tickTimer();
      if (gConnected() && (!S.google.lastSync || Date.now() - S.google.lastSync > 10 * 60000)) gSync(true);
    }
  });

  // ---------- Início ----------
  const justLoggedIn = gHandleRedirect();
  if (S.timer && timerLeft() > 0) tab = 'foco';
  go(tab);
  setInterval(tickTimer, 1000);
  setInterval(() => { if (tab === 'hoje' && !$('#sheet-root').innerHTML && !document.activeElement?.matches('input,textarea,select')) render(); }, 60000);
  if (justLoggedIn || (gConnected() && (!S.google.lastSync || Date.now() - S.google.lastSync > 10 * 60000))) gSync(!justLoggedIn);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
