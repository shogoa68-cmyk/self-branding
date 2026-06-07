'use strict';

// ─── Supabase ─────────────────────────────────────────────────────────────────
const SUPABASE_URL      = 'https://vfgzvbhusyxzmefugsdw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZmZ3p2Ymh1c3l4em1lZnVnc2R3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3NzA1MTQsImV4cCI6MjA5NjM0NjUxNH0.85MvRWCTkZqRXzllDwOZKIs253_XlTIkT-7xgBukDeE';
const EDGE_FN_URL       = `${SUPABASE_URL}/functions/v1/generate`;
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;

// ─── Platform definitions ─────────────────────────────────────────────────────
const PLATFORMS = {
  google:   { label: 'Google',   bg: '#4285F4', fg: '#fff', url: q => `https://www.google.com/search?q=${encodeURIComponent(q)}` },
  note:     { label: 'note',     bg: '#41C9B4', fg: '#fff', url: q => `https://note.com/search?q=${encodeURIComponent(q)}` },
  x:        { label: 'X',        bg: '#000',    fg: '#fff', url: q => `https://twitter.com/search?q=${encodeURIComponent(q)}` },
  linkedin: { label: 'LinkedIn', bg: '#0A66C2', fg: '#fff', url: q => `https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(q)}` },
  youtube:  { label: 'YouTube',  bg: '#FF0000', fg: '#fff', url: q => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}` },
  udemy:    { label: 'Udemy',    bg: '#A435F0', fg: '#fff', url: q => `https://www.udemy.com/courses/search/?q=${encodeURIComponent(q)}` },
  amazon:   { label: 'Amazon',   bg: '#FF9900', fg: '#fff', url: q => `https://www.amazon.co.jp/s?k=${encodeURIComponent(q)}` },
};

// ─── State ────────────────────────────────────────────────────────────────────
let state = {
  profile:        { age: '', gender: '', profession: '', career: '', skills: '', hobbies: '' },
  target:         { targetRole: '', targetGoals: '', timeline: '', motivation: '' },
  queries:        null,
  checklist:      {},
  dailyContent:   null,
  dailyCompleted: new Set(),
};

// ─── Auth ─────────────────────────────────────────────────────────────────────
async function signInWithGoogle() {
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname },
  });
  if (error) showToast('ログインに失敗しました');
}

async function signOut() {
  await sb.auth.signOut();
  currentUser = null;
  showLoginScreen();
}

// ─── Supabase DB ──────────────────────────────────────────────────────────────
async function loadProfile() {
  if (!currentUser) return;
  let data;
  try {
    const res = await sb
      .from('profiles')
      .select('*')
      .eq('id', currentUser.id)
      .maybeSingle();
    data = res.data;
  } catch (e) {
    console.error('loadProfile error:', e);
    return;
  }

  if (!data) return;

  state.profile = {
    age:        data.age        || '',
    gender:     data.gender     || '',
    profession: data.profession || '',
    career:     data.career     || '',
    skills:     data.skills     || '',
    hobbies:    data.hobbies    || '',
  };
  state.target = {
    targetRole:  data.target_role  || '',
    targetGoals: data.target_goals || '',
    timeline:    data.timeline     || '',
    motivation:  data.motivation   || '',
  };
  state.checklist = data.checklist || {};
}

let saveTimer;
function scheduleProfileSave() {
  setSaveStatus('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushProfileSave, 1200);
}

async function flushProfileSave() {
  if (!currentUser) return;
  const { error } = await sb.from('profiles').upsert({
    id:           currentUser.id,
    age:          state.profile.age,
    gender:       state.profile.gender,
    profession:   state.profile.profession,
    career:       state.profile.career,
    skills:       state.profile.skills,
    hobbies:      state.profile.hobbies,
    target_role:  state.target.targetRole,
    target_goals: state.target.targetGoals,
    timeline:     state.target.timeline,
    motivation:   state.target.motivation,
    checklist:    state.checklist,
    updated_at:   new Date().toISOString(),
  });
  if (error) {
    console.error('save error:', error);
  } else {
    setSaveStatus('saved');
    upsertTodayLog();
  }
}

// ─── Daily Log / Progress ─────────────────────────────────────────────────────
async function upsertTodayLog() {
  if (!currentUser) return;
  const today = new Date().toISOString().split('T')[0];
  const completed = Object.keys(state.checklist).filter(k => state.checklist[k]);
  await sb.from('daily_logs').upsert(
    { user_id: currentUser.id, date: today, completed_actions: completed },
    { onConflict: 'user_id,date' }
  );
}

async function loadTodayLog() {
  if (!currentUser) return;
  const today = new Date().toISOString().split('T')[0];
  const { data } = await sb
    .from('daily_logs')
    .select('content, completed_actions')
    .eq('user_id', currentUser.id)
    .eq('date', today)
    .maybeSingle();
  if (data?.content && Object.keys(data.content).length > 0) {
    state.dailyContent   = data.content;
    state.dailyCompleted = new Set(data.completed_actions || []);
    renderDailyInput(state.dailyContent);
  }
}

async function loadStreak() {
  if (!currentUser) return 0;
  const { data } = await sb
    .from('daily_logs')
    .select('date')
    .eq('user_id', currentUser.id)
    .order('date', { ascending: false })
    .limit(60);
  if (!data || data.length === 0) return 0;

  const dates = new Set(data.map(d => d.date));
  const cur = new Date();
  cur.setHours(0, 0, 0, 0);
  let streak = 0;
  while (true) {
    const ds = cur.toISOString().split('T')[0];
    if (dates.has(ds)) { streak++; cur.setDate(cur.getDate() - 1); }
    else break;
  }
  return streak;
}

async function loadWeekActivity() {
  if (!currentUser) return [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dates = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().split('T')[0]);
  }
  const { data } = await sb
    .from('daily_logs').select('date')
    .eq('user_id', currentUser.id).in('date', dates);
  const active = new Set((data || []).map(d => d.date));
  const todayStr = today.toISOString().split('T')[0];
  return dates.map(d => ({ date: d, active: active.has(d), isToday: d === todayStr }));
}

function renderPlanStats(streak, weekActivity) {
  const el = document.getElementById('streakNumber');
  if (el) el.textContent = streak;
  const dotsEl = document.getElementById('weekDots');
  if (!dotsEl) return;
  const DAY = ['日','月','火','水','木','金','土'];
  dotsEl.innerHTML = weekActivity.map(({ date, active, isToday }) => {
    const day = DAY[new Date(date + 'T00:00:00').getDay()];
    return `<div class="week-dot-col">
      <div class="week-dot${active ? ' active' : ''}${isToday ? ' today' : ''}"></div>
      <span class="week-day">${day}</span>
    </div>`;
  }).join('');
}

async function refreshPlanStats() {
  const [streak, week] = await Promise.all([loadStreak(), loadWeekActivity()]);
  renderPlanStats(streak, week);
}

// ─── Screen management ────────────────────────────────────────────────────────
function showLoginScreen() {
  document.getElementById('loadingScreen').hidden = true;
  document.getElementById('loginScreen').hidden   = false;
  document.getElementById('appMain').hidden       = true;
}

function showApp(user) {
  document.getElementById('loadingScreen').hidden = true;
  document.getElementById('loginScreen').hidden   = true;
  document.getElementById('appMain').hidden       = false;

  const name   = user.user_metadata?.full_name || user.email;
  const avatar = user.user_metadata?.avatar_url;
  const info   = document.getElementById('userInfo');
  info.innerHTML = `
    ${avatar ? `<img class="user-avatar" src="${escHtml(avatar)}" alt="">` : ''}
    <span class="user-name">${escHtml(name)}</span>
    <span class="save-status" id="saveStatus"></span>
    <button class="btn-signout" id="signOutBtn">ログアウト</button>
  `;
  document.getElementById('signOutBtn').addEventListener('click', signOut);
}

async function onSignedIn(user) {
  currentUser = user;
  await loadProfile();
  showApp(user);
  initForms();
  initChecklist();
  bindCopyBtns();
  renderHub();
  upsertTodayLog();
  loadTodayLog();
  refreshPlanStats();
}

// ─── Claude API via Edge Function ────────────────────────────────────────────
async function callGenerate(type) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const res = await fetch(EDGE_FN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ type, profile: state.profile, target: state.target }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Generation failed');
  }
  const data = await res.json();
  return data.result;
}

function setButtonLoading(btn, loading, label = '生成中...') {
  if (!btn) return;
  btn.disabled = loading;
  if (loading) {
    btn.dataset.orig = btn.textContent;
    btn.textContent  = label;
    btn.classList.add('loading');
  } else {
    btn.textContent = btn.dataset.orig || btn.textContent;
    btn.classList.remove('loading');
  }
}

// ─── Keyword / query extraction ───────────────────────────────────────────────
function tokenize(text) {
  if (!text) return [];
  return text.split(/[\s,、。・\n\/]+/).map(t => t.trim()).filter(t => t.length >= 2);
}

function extractKeywords(profile, target) {
  const words = [
    ...tokenize(profile.profession),
    ...tokenize(profile.skills),
    ...tokenize(target.targetRole),
  ];
  const seen = new Set();
  return words.filter(w => { if (seen.has(w)) return false; seen.add(w); return true; }).slice(0, 8);
}

function extractRole(text) {
  if (!text) return 'プロフェッショナル';
  const m = text.match(/^[^、。,\n]{2,20}/);
  return m ? m[0].slice(0, 20) : text.slice(0, 20);
}

function buildQueries(profile, target) {
  const role   = extractRole(profile.profession) || 'エンジニア';
  const skills = tokenize(profile.skills).slice(0, 3).join(' ');
  const tRole  = extractRole(target.targetRole)  || 'リーダー';

  return {
    articles: [
      `${role} セルフブランディング 方法`,
      `${skills} キャリアアップ 戦略`,
      `${tRole} なるには ロードマップ`,
      `${role} SNS 発信 コンテンツ`,
      `エンジニア 個人ブランド 事例`,
    ],
    people: [
      `${role} 著名人 影響力`,
      `${tRole} ロールモデル`,
      `${skills} エキスパート`,
      `スタートアップ リーダー インフルエンサー`,
      `テック 起業家 SNS`,
    ],
    videos: [
      `${role} セルフブランディング`,
      `${skills} 学習 入門`,
      `${tRole} インタビュー`,
      `個人ブランド構築 方法`,
      `キャリア転換 成功事例`,
    ],
    courses: [
      `${skills} 実践講座`,
      `${role} スキルアップ`,
      `${tRole} 必読書`,
      `パーソナルブランディング 書籍`,
      `${skills} 資格 取得`,
    ],
  };
}

// ─── Render hub ───────────────────────────────────────────────────────────────
function renderHub() {
  const keywords = extractKeywords(state.profile, state.target);
  const queries  = state.queries;

  if (!queries) {
    document.getElementById('hubEmpty').hidden   = false;
    document.getElementById('hubContent').hidden = true;
    return;
  }
  document.getElementById('hubEmpty').hidden   = true;
  document.getElementById('hubContent').hidden = false;

  const bar = document.getElementById('keywordBar');
  bar.innerHTML = keywords.map(k => `<span class="kw-chip">${escHtml(k)}</span>`).join('');

  const categoryConfig = {
    articles: [
      { platform: 'google', desc: '記事・ブログを検索' },
      { platform: 'note',   desc: 'note で探す' },
    ],
    people: [
      { platform: 'x',        desc: 'X でフォロー候補を探す' },
      { platform: 'linkedin', desc: 'LinkedIn で人物を探す' },
    ],
    videos: [
      { platform: 'youtube', desc: '動画を探す' },
    ],
    courses: [
      { platform: 'udemy',  desc: 'コース・講座を探す' },
      { platform: 'amazon', desc: '書籍を探す' },
    ],
  };

  Object.keys(categoryConfig).forEach(cat => {
    const grid = document.getElementById(`rec-${cat}`);
    if (!grid) return;
    const catQueries = queries[cat] || [];
    const platforms  = categoryConfig[cat];
    grid.innerHTML   = '';

    catQueries.forEach(q => {
      platforms.forEach(({ platform, desc }) => {
        const p    = PLATFORMS[platform];
        const url  = p.url(q);
        const card = document.createElement('div');
        card.className = 'rec-card';
        card.innerHTML = `
          <div class="rec-card-top">
            <span class="platform-badge" style="background:${p.bg}">${escHtml(p.label)}</span>
          </div>
          <p class="rec-title">${escHtml(q)}</p>
          <p class="rec-desc">${escHtml(desc)}</p>
          <a class="rec-link" href="${url}" target="_blank" rel="noopener noreferrer">
            検索する →
          </a>`;
        grid.appendChild(card);
      });
    });
  });
}

// ─── Brand statement generation ───────────────────────────────────────────────
async function generateStatement() {
  const btn = document.getElementById('genStatementBtn');
  setButtonLoading(btn, true);
  try {
    const result = await callGenerate('statement');
    const statement = result.statement || '';
    const pitch     = result.pitch     || '';

    document.getElementById('statementBlock').innerHTML = `
      <p style="text-align:left;padding:14px 16px;font-size:15px;font-weight:500;color:var(--text);line-height:1.7">${escHtml(statement)}</p>
      <div class="gen-actions">
        <button class="btn-copy" data-copy="${escAttr(statement)}">📋 コピー</button>
      </div>`;

    document.getElementById('pitchBlock').innerHTML = `
      <p style="text-align:left;padding:14px 16px;white-space:pre-line;font-size:14px;color:var(--text);line-height:1.8">${escHtml(pitch)}</p>
      <div class="gen-actions">
        <button class="btn-copy" data-copy="${escAttr(pitch)}">📋 コピー</button>
      </div>`;

    bindCopyBtns();
    showToast('ブランドステートメントを生成しました');
  } catch (e) {
    showToast('生成に失敗しました。プロフィールを入力してから試してください。');
  } finally {
    setButtonLoading(btn, false);
  }
}

// ─── SNS profile generation ───────────────────────────────────────────────────
async function generateSnsProfiles() {
  const btn = document.getElementById('genSnsBtn');
  setButtonLoading(btn, true);
  try {
    const result = await callGenerate('sns');
    [
      { id: 'xText',        key: 'x',        max: 160 },
      { id: 'linkedinText', key: 'linkedin',  max: 220 },
      { id: 'githubText',   key: 'github',    max: 160 },
      { id: 'wantedlyText', key: 'wantedly',  max: 500 },
    ].forEach(({ id, key, max }) => {
      const el = document.getElementById(id);
      if (!el || !result[key]) return;
      el.value = result[key].slice(0, max);
      updateCharCount(el, max);
    });
    showToast('SNSプロフィールを生成しました');
  } catch (e) {
    showToast('生成に失敗しました。プロフィールを入力してから試してください。');
  } finally {
    setButtonLoading(btn, false);
  }
}

// ─── Daily input generation ───────────────────────────────────────────────────
async function generateDailyInput() {
  const btn = document.getElementById('genDailyBtn');
  setButtonLoading(btn, true);
  try {
    const result = await callGenerate('daily');
    state.dailyContent   = result;
    state.dailyCompleted = new Set();
    renderDailyInput(result);
    const today = new Date().toISOString().split('T')[0];
    await sb.from('daily_logs').upsert(
      { user_id: currentUser.id, date: today, content: result, completed_actions: [] },
      { onConflict: 'user_id,date' }
    );
    showToast('今日のインプットを生成しました');
  } catch (e) {
    showToast('生成に失敗しました。プロフィールを入力してから試してください。');
  } finally {
    setButtonLoading(btn, false);
  }
}

async function toggleDailyItem(key) {
  if (state.dailyCompleted.has(key)) {
    state.dailyCompleted.delete(key);
  } else {
    state.dailyCompleted.add(key);
  }
  if (state.dailyContent) renderDailyInput(state.dailyContent);
  const today = new Date().toISOString().split('T')[0];
  await sb.from('daily_logs').upsert(
    { user_id: currentUser.id, date: today, completed_actions: [...state.dailyCompleted] },
    { onConflict: 'user_id,date' }
  );
}

function renderDailyItem(text, key, extraLinks = []) {
  const done = state.dailyCompleted.has(key);
  const gUrl = PLATFORMS.google.url(text);
  const links = [
    `<a class="daily-task-link" href="${gUrl}" target="_blank" rel="noopener noreferrer"><span class="task-link-dot" style="background:#4285F4"></span>Google</a>`,
    ...extraLinks,
  ].join('');
  return `
    <li class="daily-task-item${done ? ' done' : ''}">
      <button class="daily-task-check" data-key="${escAttr(key)}" aria-pressed="${done}">${done ? '✓' : ''}</button>
      <div class="daily-task-body">
        <span class="daily-task-text">${escHtml(text)}</span>
        <div class="daily-task-links">${links}</div>
      </div>
    </li>`;
}

function renderDailyInput(result) {
  const el = document.getElementById('dailyContent');
  if (!el) return;
  const learning = Array.isArray(result.learning) ? result.learning : [];
  const action   = Array.isArray(result.action)   ? result.action   : [];

  const ytLink = text =>
    `<a class="daily-task-link" href="${PLATFORMS.youtube.url(text)}" target="_blank" rel="noopener noreferrer"><span class="task-link-dot" style="background:#FF0000"></span>YouTube</a>`;

  const learningHtml = learning.map((t, i) => renderDailyItem(t, `learning_${i}`, [ytLink(t)])).join('');
  const actionHtml   = action.map((t, i)   => renderDailyItem(t, `action_${i}`)).join('');

  const total = learning.length + action.length;
  const done  = [...state.dailyCompleted].filter(k => k.startsWith('learning_') || k.startsWith('action_')).length;

  el.innerHTML = `
    <div class="daily-theme">
      <span class="daily-theme-label">今日のテーマ</span>
      <p class="daily-theme-text">${escHtml(result.theme || '')}</p>
    </div>
    <div class="daily-progress-bar">
      <div class="daily-progress-fill" style="width:${total ? Math.round(done / total * 100) : 0}%"></div>
    </div>
    <p class="daily-progress-label">${done} / ${total} 完了</p>
    <div class="daily-grid">
      <div class="daily-block">
        <h4 class="daily-block-title">📚 インプット</h4>
        <ul class="daily-list">${learningHtml}</ul>
      </div>
      <div class="daily-block">
        <h4 class="daily-block-title">⚡ アクション</h4>
        <ul class="daily-list">${actionHtml}</ul>
      </div>
    </div>
    <div class="daily-message">
      <span class="daily-message-icon">💬</span>
      <p class="daily-message-text">${escHtml(result.message || '')}</p>
    </div>`;
}

function updateCharCount(textarea, max) {
  const countId = textarea.id.replace('Text', 'Count');
  const counter = document.getElementById(countId);
  if (counter) counter.textContent = `${[...textarea.value].length} / ${max}文字`;
}

// ─── Checklist ────────────────────────────────────────────────────────────────
const CHECKLIST = [
  {
    category: '自己分析・目標設定',
    items: [
      '強み・弱みを書き出す（SWOT分析）',
      '3年後のなりたい姿を言語化する',
      'ターゲットオーディエンスを定義する',
      'ブランドコンセプトを一文にまとめる',
    ],
  },
  {
    category: 'SNS・オンライン発信',
    items: [
      'X (Twitter) のプロフィールを最適化する',
      'LinkedIn のプロフィールを英語・日本語で整備する',
      'GitHub の README を充実させる',
      '週3回以上の発信ルーティンを作る',
    ],
  },
  {
    category: 'コンテンツ作成',
    items: [
      'ブログ・note の記事を月2本書く',
      '専門分野の学習記録をアウトプットする',
      '登壇・LT の機会を探して応募する',
      '実績・ポートフォリオページを作る',
    ],
  },
  {
    category: 'ネットワーク構築',
    items: [
      '業界コミュニティ・勉強会に参加する',
      'ロールモデルをフォロー＆交流する',
      'メンターを見つける、または誰かのメンターになる',
      '月1回のリアルイベントに参加する',
    ],
  },
];

function initChecklist() {
  const container = document.getElementById('checklistContainer');
  if (!container) return;
  container.innerHTML = '';

  CHECKLIST.forEach((section, si) => {
    const sec = document.createElement('div');
    sec.className = 'cl-category';
    sec.innerHTML = `<h3 class="cl-category-title">${escHtml(section.category)}</h3>`;

    section.items.forEach((item, ii) => {
      const key     = `${si}_${ii}`;
      const checked = !!state.checklist[key];
      const div     = document.createElement('div');
      div.className = `cl-item${checked ? ' done' : ''}`;
      div.innerHTML = `
        <button class="cl-box" data-key="${key}" aria-pressed="${checked}">
          ${checked ? '✓' : ''}
        </button>
        <div class="cl-text-wrap"><span class="cl-title">${escHtml(item)}</span></div>`;
      sec.appendChild(div);
    });

    container.appendChild(sec);
  });

  updateChecklistProgress();
}

function updateChecklistProgress() {
  const total = CHECKLIST.reduce((s, c) => s + c.items.length, 0);
  const done  = Object.values(state.checklist).filter(Boolean).length;
  const pct   = total ? Math.round(done / total * 100) : 0;

  const fill  = document.getElementById('clFill');
  const label = document.getElementById('clLabel');
  if (fill)  fill.style.width  = `${pct}%`;
  if (label) label.textContent = `${done} / ${total} 完了`;
}

// ─── Tab switching ────────────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === name);
  });
  document.querySelectorAll('.tab-content').forEach(sec => {
    sec.classList.toggle('active', sec.id === `tab-${name}`);
  });
  if (name === 'hub')  renderHub();
  if (name === 'plan') { updateChecklistProgress(); refreshPlanStats(); }
}

// ─── Form binding ─────────────────────────────────────────────────────────────
function initForms() {
  document.querySelectorAll('[data-section][data-field]').forEach(el => {
    const { section, field } = el.dataset;
    if (!state[section]) return;
    el.value = state[section][field] || '';
    el.addEventListener('input', () => {
      state[section][field] = el.value;
      scheduleProfileSave();
    });
  });

  [
    { id: 'xText',        max: 160 },
    { id: 'linkedinText', max: 220 },
    { id: 'githubText',   max: 160 },
    { id: 'wantedlyText', max: 500 },
  ].forEach(({ id, max }) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => updateCharCount(el, max));
  });
}

// ─── Copy helpers ─────────────────────────────────────────────────────────────
function bindCopyBtns() {
  document.querySelectorAll('.btn-copy[data-copy]').forEach(btn => {
    btn.onclick = () => {
      navigator.clipboard.writeText(btn.dataset.copy).then(() => showToast('コピーしました'));
    };
  });

  document.querySelectorAll('.btn-copy[data-target]').forEach(btn => {
    btn.onclick = () => {
      const el = document.getElementById(btn.dataset.target);
      if (!el) return;
      navigator.clipboard.writeText(el.value).then(() => showToast('コピーしました'));
    };
  });
}

// ─── Save status ─────────────────────────────────────────────────────────────
function setSaveStatus(status) {
  const el = document.getElementById('saveStatus');
  if (!el) return;
  clearTimeout(el._t);
  if (status === 'saving') {
    el.textContent = '保存中...';
    el.dataset.status = 'saving';
  } else if (status === 'saved') {
    el.textContent = '✓ 保存済み';
    el.dataset.status = 'saved';
    el._t = setTimeout(() => { el.textContent = ''; el.dataset.status = ''; }, 2500);
  }
}

// ─── Toast ────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ─── HTML escape helpers ──────────────────────────────────────────────────────
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function escAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
async function init() {
  // Login button
  document.getElementById('googleLoginBtn').addEventListener('click', signInWithGoogle);

  // Tab navigation (attached before auth so they're always ready)
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  document.querySelectorAll('[data-goto]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.goto));
  });

  // Generate queries → hub tab
  document.getElementById('generateBtn').addEventListener('click', () => {
    state.queries = buildQueries(state.profile, state.target);
    switchTab('hub');
    showToast('クエリを生成しました');
  });

  // Re-generate inside hub tab
  document.getElementById('regenBtn').addEventListener('click', () => {
    state.queries = buildQueries(state.profile, state.target);
    renderHub();
    showToast('クエリを再生成しました');
  });

  // Brand statement + pitch
  document.getElementById('genStatementBtn').addEventListener('click', generateStatement);

  // SNS profiles
  document.getElementById('genSnsBtn').addEventListener('click', generateSnsProfiles);

  // Today's input (daily)
  document.getElementById('genDailyBtn').addEventListener('click', generateDailyInput);

  // Daily task checkbox (event delegation)
  document.getElementById('dailyContent').addEventListener('click', e => {
    const btn = e.target.closest('.daily-task-check');
    if (!btn) return;
    toggleDailyItem(btn.dataset.key);
  });

  // Rec sub-tabs
  document.querySelectorAll('.rec-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.rec-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const cat = btn.dataset.rec;
      document.querySelectorAll('.rec-grid').forEach(g => {
        g.classList.toggle('hidden', g.id !== `rec-${cat}`);
      });
    });
  });

  // Checklist toggle (event delegation)
  document.getElementById('checklistContainer').addEventListener('click', e => {
    const btn = e.target.closest('.cl-box');
    if (!btn) return;
    const key = btn.dataset.key;
    state.checklist[key] = !state.checklist[key];
    scheduleProfileSave();
    initChecklist();
  });

  // Auth state listener (set up BEFORE getSession to catch INITIAL_SESSION)
  sb.auth.onAuthStateChange(async (event, session) => {
    if (session && !currentUser) {
      await onSignedIn(session.user);
    } else if (!session && event === 'SIGNED_OUT') {
      currentUser = null;
      showLoginScreen();
    }
  });

  // Fallback: getSession also processes OAuth code in URL on page load
  const { data: { session } } = await sb.auth.getSession();
  if (session && !currentUser) {
    await onSignedIn(session.user);
  } else if (!session && !currentUser) {
    showLoginScreen();
  }
}

document.addEventListener('DOMContentLoaded', init);
