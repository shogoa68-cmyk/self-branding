'use strict';

// ─── Supabase ─────────────────────────────────────────────────────────────────
const SUPABASE_URL      = 'https://vfgzvbhusyxzmefugsdw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZmZ3p2Ymh1c3l4em1lZnVnc2R3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3NzA1MTQsImV4cCI6MjA5NjM0NjUxNH0.85MvRWCTkZqRXzllDwOZKIs253_XlTIkT-7xgBukDeE';
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
  profile:   { age: '', gender: '', profession: '', career: '', skills: '', hobbies: '' },
  target:    { targetRole: '', targetGoals: '', timeline: '', motivation: '' },
  queries:   null,
  checklist: {},
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
      .single();
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
  if (error) console.error('save error:', error);
}

// ─── Screen management ────────────────────────────────────────────────────────
function showLoginScreen() {
  document.getElementById('loginScreen').hidden = false;
  document.getElementById('appMain').hidden      = true;
}

function showApp(user) {
  document.getElementById('loginScreen').hidden = true;
  document.getElementById('appMain').hidden      = false;

  const name   = user.user_metadata?.full_name || user.email;
  const avatar = user.user_metadata?.avatar_url;
  const info   = document.getElementById('userInfo');
  info.innerHTML = `
    ${avatar ? `<img class="user-avatar" src="${escHtml(avatar)}" alt="">` : ''}
    <span class="user-name">${escHtml(name)}</span>
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
function generateStatement() {
  const p = state.profile;
  const t = state.target;

  const role      = p.profession || '専門家';
  const skills    = tokenize(p.skills).slice(0, 3).join('・') || 'スキル';
  const tRole     = t.targetRole || '理想の姿';
  const period    = t.timeline   || '近い将来';
  const why       = t.motivation || '自分のビジョンを実現するため';

  const statement = `${role}として${skills}を武器に、${period}で${tRole}へ。${why}。`;
  const pitch     = `はじめまして。私は${role}として${skills}の経験を持ちます。\n現在は${tRole}を目指し、日々スキルアップに取り組んでいます。\n${why}という想いで活動しています。`;

  document.getElementById('statementBlock').innerHTML = `
    <p class="gen-placeholder" style="text-align:left;padding:14px 16px;font-size:15px;font-weight:500;color:var(--text)">${escHtml(statement)}</p>
    <div class="gen-actions">
      <button class="btn-copy" data-copy="${escAttr(statement)}">📋 コピー</button>
    </div>`;

  document.getElementById('pitchBlock').innerHTML = `
    <p class="gen-placeholder" style="text-align:left;padding:14px 16px;white-space:pre-line;font-size:14px;color:var(--text)">${escHtml(pitch)}</p>
    <div class="gen-actions">
      <button class="btn-copy" data-copy="${escAttr(pitch)}">📋 コピー</button>
    </div>`;

  bindCopyBtns();
}

// ─── SNS profile generation ───────────────────────────────────────────────────
function generateSnsProfiles() {
  const p = state.profile;
  const t = state.target;

  const role   = p.profession || '専門家';
  const skills = tokenize(p.skills).slice(0, 3).join(' / ') || 'スキル';
  const tRole  = t.targetRole || '成長中';
  const hobby  = tokenize(p.hobbies).slice(0, 2).join('・') || '探求中';
  const period = t.timeline   || '近い将来';
  const why    = t.motivation || '';

  const profiles = {
    x:        `${role} | ${skills} | ${tRole}を目指して発信中 | ${hobby}好き`,
    linkedin: `${role} ▶ ${skills} の専門家。${period}で${tRole}へのキャリアを歩んでいます。${why ? why.slice(0, 60) : ''}`,
    github:   `${role} | ${skills} | Open to collaboration`,
    wantedly: `【${role}】\n\nスキル: ${skills}\n\n${p.career ? p.career.slice(0, 100) : ''}\n\n目標: ${tRole}を目指し、${why || 'スキルアップ'}に取り組んでいます。${p.hobbies ? `\n\n趣味: ${p.hobbies.slice(0, 80)}` : ''}`,
  };

  [
    { id: 'xText',        key: 'x',        max: 160 },
    { id: 'linkedinText', key: 'linkedin',  max: 220 },
    { id: 'githubText',   key: 'github',    max: 160 },
    { id: 'wantedlyText', key: 'wantedly',  max: 500 },
  ].forEach(({ id, key, max }) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = profiles[key].slice(0, max);
    updateCharCount(el, max);
  });
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
  if (name === 'plan') updateChecklistProgress();
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
  document.getElementById('genStatementBtn').addEventListener('click', () => {
    generateStatement();
    showToast('ブランドステートメントを生成しました');
  });

  // SNS profiles
  document.getElementById('genSnsBtn').addEventListener('click', () => {
    generateSnsProfiles();
    showToast('SNSプロフィールを生成しました');
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

  // Fallback: explicitly check session after listener is attached
  const { data: { session } } = await sb.auth.getSession();
  if (!session && !currentUser) {
    showLoginScreen();
  }
}

document.addEventListener('DOMContentLoaded', init);
