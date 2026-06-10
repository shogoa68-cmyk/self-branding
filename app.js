'use strict';

// ─── Timezone helper (JST = UTC+9) ───────────────────────────────────────────
// sv-SE locale uses YYYY-MM-DD format, making it convenient for ISO date strings
const todayJST = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
function dateJST(dateObj) {
  return dateObj.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

// ─── Supabase ─────────────────────────────────────────────────────────────────
const SUPABASE_URL      = 'https://vfgzvbhusyxzmefugsdw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZmZ3p2Ymh1c3l4em1lZnVnc2R3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3NzA1MTQsImV4cCI6MjA5NjM0NjUxNH0.85MvRWCTkZqRXzllDwOZKIs253_XlTIkT-7xgBukDeE';
const EDGE_FN_URL       = `${SUPABASE_URL}/functions/v1/generate`;
const NOTION_FN_URL     = `${SUPABASE_URL}/functions/v1/notion`;
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
  profile:          { age: '', gender: '', profession: '', career: '', skills: '', hobbies: '', lacks: '' },
  target:           { targetRole: '', targetGoals: '', timeline: '', motivation: '' },
  notion:           { token: '', dbId: '' },
  sources:          [],  // [{ id, name, url, desc }]
  queries:          null,
  checklist:        {},
  dailySuggestions: [],  // 今日の提案配列
  dailyActiveIdx:   0,   // 表示中の提案インデックス
  dailyCompleted:   new Set(),  // "{idx}_learning_0" 形式
  dailyNotes:       {},         // "{idx}_learning_0": "note" 形式
  noteExpanded:     new Set(),  // short key のみ（UI状態）
};

// 現在の提案インデックスを付与したキーを返す
function scopedKey(shortKey) {
  return `${state.dailyActiveIdx}_${shortKey}`;
}

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
    lacks:      data.lacks      || '',
  };
  state.target = {
    targetRole:  data.target_role  || '',
    targetGoals: data.target_goals || '',
    timeline:    data.timeline     || '',
    motivation:  data.motivation   || '',
  };
  state.notion = {
    token: data.notion_token || '',
    dbId:  data.notion_db_id || '',
  };
  state.sources   = data.sources   || [];
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
    lacks:        state.profile.lacks,
    notion_token: state.notion.token,
    notion_db_id: state.notion.dbId,
    sources:      state.sources,
    target_role:  state.target.targetRole,
    target_goals: state.target.targetGoals,
    timeline:     state.target.timeline,
    motivation:   state.target.motivation,
    checklist:    state.checklist,
    updated_at:   new Date().toISOString(),
  });
  if (error) {
    console.error('save error:', error);
    setSaveStatus('');
    showToast('保存に失敗しました。コンソールを確認してください。');
  } else {
    setSaveStatus('saved');
    upsertTodayLog();
  }
}

// ─── Daily Log / Progress ─────────────────────────────────────────────────────
async function upsertTodayLog() {
  if (!currentUser) return;
  const today = todayJST();
  // ignoreDuplicates: row は streak カウント用の存在確認のみ。completed_actions は上書きしない
  await sb.from('daily_logs').upsert(
    { user_id: currentUser.id, date: today },
    { onConflict: 'user_id,date', ignoreDuplicates: true }
  );
}

async function loadTodayLog() {
  if (!currentUser) return;
  const today = todayJST();
  const { data } = await sb
    .from('daily_logs')
    .select('content, completed_actions, notes')
    .eq('user_id', currentUser.id)
    .eq('date', today)
    .maybeSingle();
  if (!data) return;

  // 旧形式（オブジェクト）→ 配列に変換
  let suggestions;
  if (Array.isArray(data.content)) {
    suggestions = data.content.filter(s => s && Object.keys(s).length > 0);
  } else if (data.content && Object.keys(data.content).length > 0) {
    suggestions = [{ ...data.content, generated_at: new Date().toISOString() }];
  } else {
    return;
  }
  if (!suggestions.length) return;

  state.dailySuggestions = suggestions;
  state.dailyActiveIdx   = suggestions.length - 1;
  state.dailyCompleted   = new Set(data.completed_actions || []);
  state.dailyNotes       = data.notes || {};
  renderSuggestionTabs();
  renderDailyInput(suggestions[state.dailyActiveIdx]);
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
  let streak = 0;
  const cur = new Date();
  while (true) {
    const ds = dateJST(cur);
    if (dates.has(ds)) { streak++; cur.setDate(cur.getDate() - 1); }
    else break;
  }
  return streak;
}

async function loadWeekActivity() {
  if (!currentUser) return [];
  const todayStr = todayJST();
  const dates = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(dateJST(d));
  }
  const { data } = await sb
    .from('daily_logs').select('date')
    .eq('user_id', currentUser.id).in('date', dates);
  const active = new Set((data || []).map(d => d.date));
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
  renderSourceManager();
  bindCopyBtns();
  renderHub();
  upsertTodayLog();
  loadTodayLog();
  refreshPlanStats();
  // First-time users go to settings; returning users go to plan (dashboard)
  switchTab(state.profile.profession ? 'plan' : 'profile');
}

// ─── Claude API via Edge Function ────────────────────────────────────────────
async function callGenerate(type, extra = {}) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const res = await fetch(EDGE_FN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ type, profile: state.profile, target: state.target, ...extra }),
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
async function generateDailyInput(focusKeyword = '') {
  const btn = document.getElementById('genDailyBtn');
  setButtonLoading(btn, true);
  try {
    // 過去のテーマ（今日含む全配列）を収集してバラつきを促す
    const { data: recentLogs } = await sb
      .from('daily_logs')
      .select('content')
      .eq('user_id', currentUser.id)
      .order('date', { ascending: false })
      .limit(14);
    const recentThemes = (recentLogs || []).flatMap(l => {
      const c = l.content;
      if (Array.isArray(c)) return c.map(s => s.theme).filter(Boolean);
      return c?.theme ? [c.theme] : [];
    });

    const extra = { recentThemes, sources: state.sources };
    if (focusKeyword) extra.focusKeyword = focusKeyword;
    const result = await callGenerate('daily', extra);
    result.generated_at = new Date().toISOString();

    state.dailySuggestions.push(result);
    state.dailyActiveIdx = state.dailySuggestions.length - 1;
    state.noteExpanded   = new Set();
    calState.logs        = null;

    renderSuggestionTabs();
    renderDailyInput(result);

    const today = todayJST();
    await sb.from('daily_logs').upsert(
      {
        user_id:           currentUser.id,
        date:              today,
        content:           state.dailySuggestions,
        completed_actions: [...state.dailyCompleted],
        notes:             state.dailyNotes,
      },
      { onConflict: 'user_id,date' }
    );
    showToast('提案を生成しました');
  } catch (e) {
    showToast('生成に失敗しました。プロフィールを入力してから試してください。');
  } finally {
    setButtonLoading(btn, false);
  }
}

function renderSuggestionTabs() {
  const el = document.getElementById('suggestionTabs');
  if (!el) return;
  if (state.dailySuggestions.length <= 1) { el.innerHTML = ''; return; }
  el.innerHTML = state.dailySuggestions.map((s, i) => {
    const t = new Date(s.generated_at || Date.now()).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    return `<button class="suggestion-tab${i === state.dailyActiveIdx ? ' active' : ''}" data-idx="${i}">提案${i + 1} <span class="stab-time">${t}</span></button>`;
  }).join('');
}

function setActiveSuggestion(idx) {
  closeNoteModal();
  state.dailyActiveIdx = idx;
  state.noteExpanded   = new Set();
  const titleEl = document.getElementById('dailySectionTitle');
  if (titleEl) titleEl.textContent = '今日のインプット';
  renderSuggestionTabs();
  renderDailyInput(state.dailySuggestions[idx]);
}

async function toggleDailyItem(key) {
  const pKey    = scopedKey(key);
  const wasDone = state.dailyCompleted.has(pKey);
  if (wasDone) state.dailyCompleted.delete(pKey);
  else         state.dailyCompleted.add(pKey);
  const done = !wasDone;

  const checkBtn = document.querySelector(`.daily-task-check[data-key="${CSS.escape(key)}"]`);
  if (checkBtn) {
    checkBtn.textContent = done ? '✓' : '';
    checkBtn.setAttribute('aria-pressed', done);
    checkBtn.closest('.daily-task-item')?.classList.toggle('done', done);
  }

  // プログレスバーを更新
  const cur = state.dailySuggestions[state.dailyActiveIdx];
  if (cur) {
    const learning = Array.isArray(cur.learning) ? cur.learning : [];
    const action   = Array.isArray(cur.action)   ? cur.action   : [];
    const total = learning.length + action.length;
    const ipfx  = `${state.dailyActiveIdx}_`;
    const cnt   = [...state.dailyCompleted].filter(k => k.startsWith(`${ipfx}learning_`) || k.startsWith(`${ipfx}action_`)).length;
    const fill  = document.querySelector('.daily-progress-fill');
    const lbl   = document.querySelector('.daily-progress-label');
    if (fill) fill.style.width  = `${total ? Math.round(cnt / total * 100) : 0}%`;
    if (lbl)  lbl.textContent   = `${cnt} / ${total} 完了`;
  }

  const today = todayJST();
  await sb.from('daily_logs').upsert(
    {
      user_id:           currentUser.id,
      date:              today,
      completed_actions: [...state.dailyCompleted],
      notes:             state.dailyNotes,
    },
    { onConflict: 'user_id,date' }
  );
}

// ─── Deep Dive (keyword extraction) ──────────────────────────────────────────
async function extractNoteKeywords(noteText) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const res = await fetch(EDGE_FN_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'extract', noteText }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error('extract API error', res.status, errText);
    throw new Error(`HTTP ${res.status}: ${errText}`);
  }
  const data = await res.json();
  console.log('extract result:', data);
  return data.result?.items || [];
}

const TYPE_ICON = { person: '👤', keyword: '🔑', book: '📖', tool: '🛠️' };

function renderExtractedKeywords(items) {
  const chips = document.getElementById('extractChips');
  chips.innerHTML = items.map((item, i) =>
    `<button class="extract-chip" data-idx="${i}" data-label="${escAttr(item.label)}" data-type="${escAttr(item.type || 'keyword')}">
      ${TYPE_ICON[item.type] || '🔍'} ${escHtml(item.label)}
    </button>`
  ).join('');

  document.getElementById('extractSearchPanel').hidden = true;

  chips.querySelectorAll('.extract-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      chips.querySelectorAll('.extract-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      renderKeywordSearchPanel(chip.dataset.label);
    });
  });
}

function renderKeywordSearchPanel(keyword) {
  const panel = document.getElementById('extractSearchPanel');
  const searchLinks = [
    { platform: 'google',  color: '#4285F4' },
    { platform: 'youtube', color: '#FF0000' },
    { platform: 'amazon',  color: '#FF9900' },
    { platform: 'x',       color: '#000' },
  ].map(({ platform, color }) => {
    const p = PLATFORMS[platform];
    return `<a class="extract-search-link" href="${escAttr(p.url(keyword))}" target="_blank" rel="noopener noreferrer">
      <span class="task-link-dot" style="background:${color}"></span>${escHtml(p.label)}
    </a>`;
  }).join('');

  panel.innerHTML = `
    <div class="extract-search-head">「${escHtml(keyword)}」を調べる</div>
    <div class="extract-search-links">${searchLinks}</div>
    <button class="btn-focus-generate" data-keyword="${escAttr(keyword)}">
      ✦ このテーマで今日の提案を生成
    </button>`;
  panel.hidden = false;

  panel.querySelector('.btn-focus-generate').addEventListener('click', async () => {
    const kw = panel.querySelector('.btn-focus-generate').dataset.keyword;
    closeNoteModal();
    await generateDailyInput(kw);
  });
}

// ─── Note Modal ──────────────────────────────────────────────────────────────
let activeNoteKey = null;

function openNoteModal(key, taskText) {
  activeNoteKey = key;
  document.getElementById('noteModalTask').textContent = taskText;
  document.getElementById('noteModalTextarea').value = state.dailyNotes[scopedKey(key)] || '';
  document.getElementById('noteModal').hidden = false;
  setTimeout(() => document.getElementById('noteModalTextarea').focus(), 50);
}

function closeNoteModal() {
  if (activeNoteKey === null) return;
  const val = document.getElementById('noteModalTextarea').value;
  state.dailyNotes[scopedKey(activeNoteKey)] = val;
  const btn = document.querySelector(`.note-toggle-btn[data-key="${CSS.escape(activeNoteKey)}"]`);
  if (btn) btn.classList.toggle('active', val.trim().length > 0);
  // パネルをリセット
  document.getElementById('noteInputArea').hidden     = false;
  document.getElementById('noteExtractPanel').hidden  = true;
  document.getElementById('extractSearchPanel').hidden = true;
  document.getElementById('noteModal').hidden = true;
  activeNoteKey = null;
  saveNotesToDB();
}

async function saveNotesToDB() {
  if (!currentUser) return;
  const today = todayJST();
  await sb.from('daily_logs').upsert(
    { user_id: currentUser.id, date: today, notes: state.dailyNotes },
    { onConflict: 'user_id,date' }
  );
}

// ─── Source Manager ───────────────────────────────────────────────────────────
function renderSourceManager() {
  const el = document.getElementById('sourceManager');
  if (!el) return;

  const listHtml = state.sources.length
    ? state.sources.map(s => `
        <div class="source-item">
          <div class="source-item-info">
            <span class="source-item-name">${escHtml(s.name)}</span>
            ${s.url ? `<a class="source-item-url" href="${escAttr(s.url)}" target="_blank" rel="noopener noreferrer">${escHtml(s.url.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a>` : ''}
            ${s.desc ? `<span class="source-item-desc">${escHtml(s.desc)}</span>` : ''}
          </div>
          <button class="btn-source-del" data-id="${escAttr(s.id)}" aria-label="削除">✕</button>
        </div>`).join('')
    : '<p class="source-empty-msg">まだ登録されていません。よく参照するサイトやメディアを追加してください。</p>';

  el.innerHTML = `
    <div class="source-list">${listHtml}</div>
    <div class="source-add-form">
      <input type="text" class="source-input" id="sourceNameInput" placeholder="ソース名（例: Hacker News、海外TechブログのRSS）">
      <input type="text" class="source-input" id="sourceUrlInput" placeholder="URL（任意）">
      <input type="text" class="source-input" id="sourceDescInput" placeholder="メモ（任意、例: テックニュース・毎朝チェック）">
      <button class="btn-source-add" id="sourceAddBtn">+ 追加</button>
    </div>`;

  el.querySelectorAll('.btn-source-del').forEach(btn => {
    btn.addEventListener('click', () => {
      state.sources = state.sources.filter(s => s.id !== btn.dataset.id);
      scheduleProfileSave();
      renderSourceManager();
    });
  });

  document.getElementById('sourceAddBtn').addEventListener('click', () => {
    const nameEl = document.getElementById('sourceNameInput');
    const urlEl  = document.getElementById('sourceUrlInput');
    const descEl = document.getElementById('sourceDescInput');
    const name   = nameEl.value.trim();
    if (!name) { showToast('ソース名を入力してください'); nameEl.focus(); return; }
    state.sources.push({ id: Date.now().toString(), name, url: urlEl.value.trim(), desc: descEl.value.trim() });
    scheduleProfileSave();
    renderSourceManager();
  });
}

// ─── Notion ───────────────────────────────────────────────────────────────────
async function saveToNotion() {
  if (!state.notion.token || !state.notion.dbId) {
    showToast('設定タブでNotion連携を設定してください');
    return;
  }
  const currentSuggestion = state.dailySuggestions[state.dailyActiveIdx];
  if (!currentSuggestion) {
    showToast('今日のインプットを生成してください');
    return;
  }
  const btn = document.getElementById('notionSaveBtn');
  setButtonLoading(btn, true, '保存中...');
  try {
    const { data: { session } } = await sb.auth.getSession();
    const today = todayJST();
    const pfx = `${state.dailyActiveIdx}_`;
    const unscopedCompleted = [...state.dailyCompleted]
      .filter(k => k.startsWith(pfx))
      .map(k => k.slice(pfx.length));
    const unscopedNotes = {};
    Object.keys(state.dailyNotes).forEach(k => {
      if (k.startsWith(pfx)) unscopedNotes[k.slice(pfx.length)] = state.dailyNotes[k];
    });
    const res = await fetch(NOTION_FN_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date:      today,
        theme:     currentSuggestion.theme,
        learning:  currentSuggestion.learning,
        action:    currentSuggestion.action,
        message:   currentSuggestion.message,
        notes:     unscopedNotes,
        completed: unscopedCompleted,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Notion保存に失敗しました');
    }
    showToast('Notionに保存しました ✓');
  } catch (e) {
    showToast(e.message || 'Notion保存に失敗しました');
  } finally {
    setButtonLoading(btn, false);
  }
}

// ─── Calendar / Log ───────────────────────────────────────────────────────────
let calState = { year: 0, month: 0, logs: null };

async function loadAndRenderCalendar() {
  const now = new Date();
  if (calState.logs !== null && calState.year === now.getFullYear() && calState.month === now.getMonth()) {
    renderCalendar(calState.year, calState.month, calState.logs);
    return;
  }
  calState.year  = now.getFullYear();
  calState.month = now.getMonth();
  calState.logs  = await loadMonthLogs(calState.year, calState.month);
  renderCalendar(calState.year, calState.month, calState.logs);
}

async function loadMonthLogs(year, month) {
  if (!currentUser) return [];
  const from = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const to   = dateJST(new Date(year, month + 1, 0));
  const { data } = await sb
    .from('daily_logs')
    .select('date, content, completed_actions')
    .eq('user_id', currentUser.id)
    .gte('date', from)
    .lte('date', to);
  return data || [];
}

function renderCalendar(year, month, logs) {
  const label = document.getElementById('calMonthLabel');
  if (label) label.textContent = `${year}年${month + 1}月`;

  const grid = document.getElementById('calGrid');
  if (!grid) return;

  const logMap  = new Map(logs.map(l => [l.date, l]));
  const firstDow = new Date(year, month, 1).getDay();
  const lastDate = new Date(year, month + 1, 0).getDate();
  const todayStr = todayJST();

  let html = '';
  for (let i = 0; i < firstDow; i++) html += `<div class="cal-cell cal-empty"></div>`;

  for (let d = 1; d <= lastDate; d++) {
    const ds  = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const log = logMap.get(ds);
    let cls   = '';
    if (log) {
      const dailyDone  = (log.completed_actions || []).filter(k => k.startsWith('learning_') || k.startsWith('action_')).length;
      const total      = (log.content?.learning?.length || 0) + (log.content?.action?.length || 0);
      cls = total === 0 ? 'cal-active' : dailyDone >= total ? 'cal-complete' : dailyDone > 0 ? 'cal-partial' : 'cal-active';
    }
    const todayCls = ds === todayStr ? ' cal-today' : '';
    html += `<div class="cal-cell ${cls}${todayCls}" data-date="${ds}">${d}</div>`;
  }
  grid.innerHTML = html;

  grid.querySelectorAll('.cal-cell[data-date]').forEach(cell => {
    const log = logMap.get(cell.dataset.date);
    if (!log?.content || !Object.keys(log.content).length) return;
    cell.style.cursor = 'pointer';
    cell.addEventListener('click', () => {
      renderLogDetail(log, cell.dataset.date);
      document.getElementById('dailyContent')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

function renderLogDetail(log, dateStr) {
  const el = document.getElementById('dailyContent');
  if (!el) return;

  // Handle array format (multiple suggestions per day) — show last suggestion
  let rawContent = log.content || {};
  let suggIdx    = null;
  if (Array.isArray(rawContent)) {
    suggIdx    = rawContent.length - 1;
    rawContent = rawContent[suggIdx] || {};
  }
  const content = rawContent;
  // Normalize completed_actions: accept both unscoped (old) and scoped (new) keys
  const completed = new Set(
    (log.completed_actions || [])
      .filter(k => {
        if (k.startsWith('learning_') || k.startsWith('action_')) return true;
        if (suggIdx !== null) {
          const sp = `${suggIdx}_`;
          return k.startsWith(`${sp}learning_`) || k.startsWith(`${sp}action_`);
        }
        return false;
      })
      .map(k => {
        if (suggIdx !== null) {
          const sp = `${suggIdx}_`;
          if (k.startsWith(sp)) return k.slice(sp.length);
        }
        return k;
      })
  );
  const learning  = Array.isArray(content.learning) ? content.learning : [];
  const action    = Array.isArray(content.action)   ? content.action   : [];
  const total     = learning.length + action.length;
  const done      = completed.size;

  const d         = new Date(dateStr + 'T00:00:00');
  const dateLabel = d.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' });

  const itemHtml = (items, prefix) => items.map((text, i) => {
    const key    = `${prefix}_${i}`;
    const isDone = completed.has(key);
    const gUrl   = PLATFORMS.google.url(text);
    const ytUrl  = prefix === 'learning' ? PLATFORMS.youtube.url(text) : null;
    return `<li class="daily-task-item${isDone ? ' done' : ''}">
      <span class="past-check">${isDone ? '✓' : '○'}</span>
      <div class="daily-task-body">
        <div class="daily-task-row"><span class="daily-task-text">${escHtml(text)}</span></div>
        <div class="daily-task-links">
          <a class="daily-task-link" href="${gUrl}" target="_blank" rel="noopener noreferrer"><span class="task-link-dot" style="background:#4285F4"></span>Google</a>
          ${ytUrl ? `<a class="daily-task-link" href="${ytUrl}" target="_blank" rel="noopener noreferrer"><span class="task-link-dot" style="background:#FF0000"></span>YouTube</a>` : ''}
        </div>
      </div>
    </li>`;
  }).join('');

  // セクション見出しを日付表示に切り替え
  const titleEl = document.getElementById('dailySectionTitle');
  if (titleEl) titleEl.textContent = dateLabel + 'の提案';

  el.innerHTML = `
    <div class="past-day-bar">
      <button class="btn-back-today" id="backTodayBtn">← 今日に戻る</button>
      <span class="past-day-score">${done} / ${total} 完了</span>
    </div>
    ${content.theme ? `<div class="daily-theme"><span class="daily-theme-label">テーマ</span><p class="daily-theme-text">${escHtml(content.theme)}</p></div>` : ''}
    <div class="daily-progress-bar"><div class="daily-progress-fill" style="width:${total ? Math.round(done / total * 100) : 0}%"></div></div>
    <p class="daily-progress-label">${done} / ${total} 完了</p>
    <div class="daily-grid">
      <div class="daily-block"><h4 class="daily-block-title">📚 インプット</h4><ul class="daily-list">${itemHtml(learning, 'learning')}</ul></div>
      <div class="daily-block"><h4 class="daily-block-title">⚡ アクション</h4><ul class="daily-list">${itemHtml(action, 'action')}</ul></div>
    </div>
    ${content.message ? `<div class="daily-message"><span class="daily-message-icon">💬</span><p class="daily-message-text">${escHtml(content.message)}</p></div>` : ''}`;

  document.getElementById('backTodayBtn')?.addEventListener('click', () => {
    const titleEl = document.getElementById('dailySectionTitle');
    if (titleEl) titleEl.textContent = '今日のインプット';
    const todaySugg = state.dailySuggestions[state.dailyActiveIdx];
    if (todaySugg) {
      renderSuggestionTabs();
      renderDailyInput(todaySugg);
    } else {
      el.innerHTML = '<p class="daily-placeholder">ボタンを押すと、今日のフォーカス・学習・アクションが生成されます</p>';
    }
  });
}

function renderDailyItem(text, key, extraLinks = []) {
  const done    = state.dailyCompleted.has(scopedKey(key));
  const hasNote = !!(state.dailyNotes[scopedKey(key)]?.trim());
  const gUrl    = PLATFORMS.google.url(text);
  const links   = [
    `<a class="daily-task-link" href="${gUrl}" target="_blank" rel="noopener noreferrer"><span class="task-link-dot" style="background:#4285F4"></span>Google</a>`,
    ...extraLinks,
  ].join('');
  return `
    <li class="daily-task-item${done ? ' done' : ''}">
      <button class="daily-task-check" data-key="${escAttr(key)}" aria-pressed="${done}">${done ? '✓' : ''}</button>
      <div class="daily-task-body">
        <div class="daily-task-row">
          <span class="daily-task-text">${escHtml(text)}</span>
          <button class="note-toggle-btn${hasNote ? ' active' : ''}" data-key="${escAttr(key)}" data-text="${escAttr(text)}" title="メモ">📝</button>
        </div>
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
  const dpfx  = `${state.dailyActiveIdx}_`;
  const done  = [...state.dailyCompleted].filter(k => k.startsWith(`${dpfx}learning_`) || k.startsWith(`${dpfx}action_`)).length;

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
    </div>
    ${state.sources.length ? `<div class="daily-sources-row">
      <span class="daily-sources-label">🔗 登録ソース</span>
      <div class="daily-source-chips">${state.sources.map(s => s.url
        ? `<a class="daily-source-chip" href="${escAttr(s.url)}" target="_blank" rel="noopener noreferrer">${escHtml(s.name)}</a>`
        : `<span class="daily-source-chip no-link">${escHtml(s.name)}</span>`
      ).join('')}</div>
    </div>` : ''}
    <div class="notion-save-row">
      <button class="btn-notion-save" id="notionSaveBtn" ${state.notion.token && state.notion.dbId ? '' : 'disabled'}>
        📓 Notionに保存
      </button>
      ${!state.notion.token || !state.notion.dbId ? '<p class="notion-hint">プロフィールタブでNotion連携を設定すると保存できます</p>' : ''}
    </div>`;

  document.getElementById('notionSaveBtn')?.addEventListener('click', saveToNotion);
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
  if (name === 'plan') { updateChecklistProgress(); refreshPlanStats(); loadAndRenderCalendar(); }
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

  // Note modal
  document.getElementById('noteModalClose').addEventListener('click', closeNoteModal);
  document.getElementById('noteModalBackdrop').addEventListener('click', closeNoteModal);
  document.getElementById('noteModalSave').addEventListener('click', closeNoteModal);

  // Deep dive: extract keywords from note
  document.getElementById('noteExtractBtn').addEventListener('click', async () => {
    const noteText = document.getElementById('noteModalTextarea').value.trim();
    if (!noteText) { showToast('メモを入力してから深掘りしてください'); return; }
    document.getElementById('extractNotePreview').textContent = noteText;
    document.getElementById('extractChips').innerHTML = '<span style="color:var(--text-2);font-size:13px">抽出中...</span>';
    document.getElementById('noteInputArea').hidden = true;
    document.getElementById('noteExtractPanel').hidden = false;
    try {
      const items = await extractNoteKeywords(noteText);
      if (items.length === 0) {
        document.getElementById('extractChips').innerHTML = '<span style="color:var(--text-2);font-size:13px">キーワードが見つかりませんでした</span>';
      } else {
        renderExtractedKeywords(items);
      }
    } catch (err) {
      console.error('deep dive extract error:', err);
      document.getElementById('extractChips').innerHTML = `<span style="color:var(--danger);font-size:13px">抽出に失敗しました（詳細はコンソール参照）</span>`;
    }
  });

  // Deep dive: back to note input
  document.getElementById('extractBackBtn').addEventListener('click', () => {
    document.getElementById('noteExtractPanel').hidden = true;
    document.getElementById('extractSearchPanel').hidden = true;
    document.getElementById('noteInputArea').hidden = false;
  });

  // Brand statement + pitch
  document.getElementById('genStatementBtn').addEventListener('click', generateStatement);

  // SNS profiles
  document.getElementById('genSnsBtn').addEventListener('click', generateSnsProfiles);

  // Today's input (daily)
  document.getElementById('genDailyBtn').addEventListener('click', () => generateDailyInput());

  // Calendar navigation
  document.getElementById('calPrev').addEventListener('click', async () => {
    calState.month--;
    if (calState.month < 0) { calState.month = 11; calState.year--; }
    calState.logs = await loadMonthLogs(calState.year, calState.month);
    renderCalendar(calState.year, calState.month, calState.logs);
    document.getElementById('logDetail').hidden = true;
  });
  document.getElementById('calNext').addEventListener('click', async () => {
    calState.month++;
    if (calState.month > 11) { calState.month = 0; calState.year++; }
    calState.logs = await loadMonthLogs(calState.year, calState.month);
    renderCalendar(calState.year, calState.month, calState.logs);
    document.getElementById('logDetail').hidden = true;
  });

  // Daily task: checkbox toggle + note toggle (event delegation)
  document.getElementById('dailyContent').addEventListener('click', e => {
    const checkBtn = e.target.closest('.daily-task-check');
    if (checkBtn) { toggleDailyItem(checkBtn.dataset.key); return; }

    const noteBtn = e.target.closest('.note-toggle-btn');
    if (noteBtn) {
      openNoteModal(noteBtn.dataset.key, noteBtn.dataset.text);
      return;
    }
  });

  // Suggestion tabs click (multiple suggestions per day)
  document.getElementById('suggestionTabs').addEventListener('click', e => {
    const btn = e.target.closest('.suggestion-tab');
    if (btn) setActiveSuggestion(Number(btn.dataset.idx));
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
