'use strict';

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'brandme_v2';

const PLATFORMS = {
  google:   { label: 'Google',   bg: '#4285F4', url: q => `https://www.google.com/search?q=${q}` },
  note:     { label: 'Note',     bg: '#41C9B4', url: q => `https://note.com/search?q=${q}` },
  medium:   { label: 'Medium',   bg: '#191919', url: q => `https://medium.com/search?q=${q}` },
  x:        { label: 'X',        bg: '#000000', url: q => `https://twitter.com/search?q=${q}` },
  linkedin: { label: 'LinkedIn', bg: '#0A66C2', url: q => `https://www.linkedin.com/search/results/people/?keywords=${q}` },
  youtube:  { label: 'YouTube',  bg: '#FF0000', url: q => `https://www.youtube.com/results?search_query=${q}` },
  udemy:    { label: 'Udemy',    bg: '#A435F0', url: q => `https://www.udemy.com/courses/search/?q=${q}` },
  coursera: { label: 'Coursera', bg: '#0056D2', url: q => `https://www.coursera.org/search?query=${q}` },
  amazon:   { label: 'Amazon',   bg: '#FF9900', url: q => `https://www.amazon.co.jp/s?k=${q}` },
};

const CAT_ICONS = { content: '📝', network: '🤝', skill: '⚡', output: '🚀' };

const SYSTEM_PROMPT = `あなたはセルフブランディング専門のAIコーチです。
ユーザーの現在のプロフィールと目指す人物像を分析し、具体的で実行可能な推薦を提供します。

【重要な指針】
- 推薦する人物は必ず実在する著名人・インフルエンサーにしてください
- コース・書籍は実際に存在するものにしてください
- 検索クエリは実際に有益な結果が得られるものにしてください
- 日本語ユーザーには日本語コンテンツを優先し、英語の質の高いコンテンツも含めてください
- 各カテゴリにちょうど5件ずつ推薦してください
- 今週のアクションは5件、今月のアクションは5件にしてください

必ず以下のJSON形式のみで回答してください（コードブロック・マークダウン・説明文は一切不要）:

{
  "gap_analysis": {
    "summary": "現在の状態と目標のギャップの要約（80〜120字）",
    "strengths": ["活かせる強み（3つ）"],
    "development_areas": ["成長が必要な領域（3つ）"],
    "key_insight": "最も重要な気づき（40〜60字）"
  },
  "recommendations": {
    "articles": [
      {
        "title": "記事タイトルまたはトピック名",
        "description": "なぜこれが役立つか（40〜60字）",
        "search_query": "Google検索クエリ",
        "platform": "google"
      }
    ],
    "people": [
      {
        "name": "フォローすべき人物名（実在する人物）",
        "description": "この人物からどんな学びが得られるか（40〜60字）",
        "search_query": "SNS上での検索クエリ",
        "platform": "x"
      }
    ],
    "videos": [
      {
        "title": "YouTube動画またはチャンネル名",
        "description": "視聴から得られる学び（40〜60字）",
        "search_query": "YouTube検索クエリ",
        "channel": "チャンネル名（わかれば）"
      }
    ],
    "courses": [
      {
        "title": "コースまたは書籍タイトル",
        "description": "習得できるスキル・知識（40〜60字）",
        "search_query": "プラットフォーム上での検索クエリ",
        "platform": "udemy"
      }
    ]
  },
  "action_plan": {
    "this_week": [
      { "task": "具体的なアクション（1文で）", "category": "content" }
    ],
    "this_month": [
      { "task": "具体的なアクション（1文で）", "category": "skill" }
    ],
    "milestones": [
      { "period": "3ヶ月後", "goal": "達成すべきマイルストーン" },
      { "period": "6ヶ月後", "goal": "達成すべきマイルストーン" },
      { "period": "1年後",   "goal": "達成すべきマイルストーン" }
    ]
  }
}`;

// ── State ─────────────────────────────────────────────────────────────────────

let state;

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    state = raw ? JSON.parse(raw) : defaultState();
    // ensure nested objects
    state.profile   = { ...defaultState().profile,  ...(state.profile  || {}) };
    state.target    = { ...defaultState().target,   ...(state.target   || {}) };
    state.checklist = state.checklist || {};
    state.skills    = Array.isArray(state.skills) ? state.skills : [];
  } catch {
    state = defaultState();
  }
}

function defaultState() {
  return {
    apiKey:    '',
    model:     'claude-haiku-4-5-20251001',
    profile:   { age: '', gender: '', profession: '', career: '', skills: '', hobbies: '' },
    target:    { targetRole: '', targetGoals: '', timeline: '', motivation: '' },
    analysis:  null,
    checklist: {},
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// ── Utils ─────────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

let toastTimer;
function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

function setLoading(show, msg = 'AIが分析しています...') {
  document.getElementById('loadingOverlay').classList.toggle('hidden', !show);
  document.getElementById('loadingMsg').textContent = msg;
}

function platformUrl(key, query) {
  const q = encodeURIComponent(query);
  return (PLATFORMS[key] || PLATFORMS.google).url(q);
}

function platformBadge(key) {
  const p = PLATFORMS[key] || { label: key, bg: '#6366F1' };
  return `<span class="platform-badge" style="background:${p.bg}">${esc(p.label)}</span>`;
}

// ── Setup Screen ──────────────────────────────────────────────────────────────

function initSetup() {
  const input  = document.getElementById('apiKeyInput');
  const toggle = document.getElementById('toggleKeyBtn');

  toggle.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    toggle.textContent = show ? '隠す' : '表示';
  });

  document.getElementById('setupStartBtn').addEventListener('click', () => applyApiKey(input.value.trim()));
  input.addEventListener('keypress', e => { if (e.key === 'Enter') applyApiKey(input.value.trim()); });
}

function applyApiKey(key) {
  if (!key.startsWith('sk-ant-')) {
    showToast('有効なAPIキーを入力してください（sk-ant- で始まります）', 'error');
    return;
  }
  state.apiKey = key;
  saveState();
  showApp();
}

function showApp() {
  document.getElementById('setupScreen').hidden = true;
  document.getElementById('mainApp').hidden = false;
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${name}`));
}

function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  // data-goto buttons in empty states
  document.querySelectorAll('[data-goto]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.goto));
  });
}

// ── Form Binding ──────────────────────────────────────────────────────────────

function initForms() {
  document.querySelectorAll('[data-section][data-field]').forEach(el => {
    const { section, field } = el.dataset;
    el.value = state[section]?.[field] ?? '';
    el.addEventListener('input', () => {
      state[section][field] = el.value;
      saveState();
    });
  });
}

// ── Claude API ────────────────────────────────────────────────────────────────

async function callClaude(userMsg) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': state.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: state.model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMsg }],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const status = res.status;
    if (status === 401) throw new Error('APIキーが無効です。設定を確認してください。');
    if (status === 429) throw new Error('レート制限に達しました。しばらく待ってから再試行してください。');
    throw new Error(err.error?.message || `APIエラー (${status})`);
  }

  const data = await res.json();
  const text = data.content[0].text.trim();

  try {
    return JSON.parse(text);
  } catch {
    // Claude sometimes wraps JSON in a code block despite instructions
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('レスポンスの解析に失敗しました。再度お試しください。');
  }
}

function buildPrompt() {
  const { profile: p, target: t } = state;
  return `以下のユーザー情報を分析し、セルフブランディング支援のためのコンテンツ推薦とアクションプランを生成してください。

【現在のプロフィール】
年齢: ${p.age || '未入力'}
性別: ${p.gender || '未入力'}
職業・役職: ${p.profession || '未入力'}
経歴・経験: ${p.career || '未入力'}
得意なこと・スキル: ${p.skills || '未入力'}
趣味・興味関心: ${p.hobbies || '未入力'}

【目指す人物像・目標】
目指すロール: ${t.targetRole || '未入力'}
達成したいゴール: ${t.targetGoals || '未入力'}
達成期間: ${t.timeline || '未入力'}
モチベーション: ${t.motivation || '未入力'}`;
}

async function runAnalysis() {
  if (!state.apiKey) { showToast('APIキーを設定してください', 'error'); return; }

  const hasProfile = Object.values(state.profile).some(v => v.trim());
  const hasTarget  = Object.values(state.target).some(v => v.trim());
  if (!hasProfile || !hasTarget) {
    showToast('現在の自分と目指す人物像を入力してください', 'error');
    return;
  }

  setLoading(true, 'AIがプロフィールを分析しています...');
  try {
    const result = await callClaude(buildPrompt());
    state.analysis  = result;
    state.checklist = {};
    saveState();
    renderHub();
    renderPlan();
    switchTab('hub');
    showToast('分析が完了しました！');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    setLoading(false);
  }
}

// ── Hub ───────────────────────────────────────────────────────────────────────

function renderHub() {
  const { analysis } = state;
  const isEmpty = !analysis;
  document.getElementById('hubEmpty').hidden   = !isEmpty;
  document.getElementById('hubContent').hidden =  isEmpty;
  if (isEmpty) return;

  renderGapAnalysis(analysis.gap_analysis || {});
  renderRecs(analysis.recommendations || {});
}

function renderGapAnalysis(gap) {
  document.getElementById('analysisCard').innerHTML = `
    <div class="analysis-summary">
      <div class="analysis-label">✦ AI 分析結果</div>
      <p class="analysis-text">${esc(gap.summary || '')}</p>
      <div class="analysis-insight">"${esc(gap.key_insight || '')}"</div>
    </div>
    <div class="analysis-cols">
      <div class="analysis-col">
        <div class="col-title">💪 活かせる強み</div>
        ${(gap.strengths || []).map(s => `<div class="analysis-item">${esc(s)}</div>`).join('')}
      </div>
      <div class="analysis-col">
        <div class="col-title">🎯 成長が必要な領域</div>
        ${(gap.development_areas || []).map(d => `<div class="analysis-item">${esc(d)}</div>`).join('')}
      </div>
    </div>`;
}

function renderRecs({ articles = [], people = [], videos = [], courses = [] }) {
  document.getElementById('rec-articles').innerHTML = articles.map(item =>
    recCard(item.platform || 'google', item.title, item.description, item.search_query)
  ).join('');

  document.getElementById('rec-people').innerHTML = people.map(item =>
    recCard(item.platform || 'x', item.name, item.description, item.search_query)
  ).join('');

  document.getElementById('rec-videos').innerHTML = videos.map(item => {
    const sub = item.channel
      ? `<span class="sub-tag">${esc(item.channel)}</span>`
      : '';
    return recCard('youtube', item.title, item.description, item.search_query, sub);
  }).join('');

  document.getElementById('rec-courses').innerHTML = courses.map(item =>
    recCard(item.platform || 'udemy', item.title, item.description, item.search_query)
  ).join('');
}

function recCard(platformKey, title, description, query, extraTop = '') {
  const p   = PLATFORMS[platformKey] || PLATFORMS.google;
  const url = platformUrl(platformKey, query || title);
  return `
    <div class="rec-card">
      <div class="rec-card-top">
        <span class="platform-badge" style="background:${p.bg}">${p.label}</span>
        ${extraTop}
      </div>
      <div class="rec-title">${esc(title)}</div>
      <div class="rec-desc">${esc(description)}</div>
      <a class="rec-link" href="${url}" target="_blank" rel="noopener">検索する →</a>
    </div>`;
}

function initRecTabs() {
  document.querySelectorAll('.rec-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.rec-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.rec-grid').forEach(g => g.classList.add('hidden'));
      btn.classList.add('active');
      document.getElementById(`rec-${btn.dataset.rec}`).classList.remove('hidden');
    });
  });
}

// ── Plan ──────────────────────────────────────────────────────────────────────

function renderPlan() {
  const { analysis } = state;
  const isEmpty = !analysis;
  document.getElementById('planEmpty').hidden   = !isEmpty;
  document.getElementById('planContent').hidden =  isEmpty;
  if (isEmpty) return;

  const plan = analysis.action_plan || {};
  renderTasks('planWeekSection',  '今週のアクション',  plan.this_week  || [], 'week');
  renderTasks('planMonthSection', '今月のアクション',  plan.this_month || [], 'month');
  renderMilestones(plan.milestones || []);
}

function renderTasks(containerId, title, tasks, prefix) {
  const el = document.getElementById(containerId);
  el.innerHTML = `
    <div class="plan-section">
      <h3 class="plan-title">${title}</h3>
      ${tasks.map((t, i) => {
        const id   = `${prefix}_${i}`;
        const done = !!state.checklist[id];
        const icon = CAT_ICONS[t.category] || '✓';
        return `
          <div class="plan-item ${done ? 'done' : ''}" data-id="${id}">
            <div class="plan-check">${done ? '✓' : ''}</div>
            <span class="plan-cat">${icon}</span>
            <span class="plan-text">${esc(t.task)}</span>
          </div>`;
      }).join('')}
    </div>`;

  el.querySelectorAll('.plan-item').forEach(item => {
    item.addEventListener('click', () => {
      const id = item.dataset.id;
      state.checklist[id] = !state.checklist[id];
      item.classList.toggle('done', state.checklist[id]);
      item.querySelector('.plan-check').textContent = state.checklist[id] ? '✓' : '';
      saveState();
    });
  });
}

function renderMilestones(milestones) {
  document.getElementById('planMilestones').innerHTML = `
    <div class="plan-section">
      <h3 class="plan-title">マイルストーン</h3>
      <div class="milestones">
        ${milestones.map((m, i) => `
          <div class="milestone">
            <div class="milestone-line">
              <div class="milestone-dot ${i === milestones.length - 1 ? 'last' : ''}"></div>
              <div class="milestone-vline"></div>
            </div>
            <div class="milestone-content">
              <div class="milestone-period">${esc(m.period)}</div>
              <div class="milestone-goal">${esc(m.goal)}</div>
            </div>
          </div>`).join('')}
      </div>
    </div>`;
}

// ── Settings ──────────────────────────────────────────────────────────────────

function initSettings() {
  document.getElementById('settingsBtn').addEventListener('click', () => {
    document.getElementById('apiKeyEdit').value  = state.apiKey;
    document.getElementById('modelSelect').value = state.model;
    document.getElementById('settingsModal').classList.remove('hidden');
  });

  document.getElementById('closeSettingsBtn').addEventListener('click', closeSettings);
  document.getElementById('settingsModal').addEventListener('click', e => {
    if (e.target.id === 'settingsModal') closeSettings();
  });

  document.getElementById('saveSettingsBtn').addEventListener('click', () => {
    const key   = document.getElementById('apiKeyEdit').value.trim();
    const model = document.getElementById('modelSelect').value;
    if (key && !key.startsWith('sk-ant-')) {
      showToast('有効なAPIキーを入力してください', 'error');
      return;
    }
    if (key) state.apiKey = key;
    state.model = model;
    saveState();
    closeSettings();
    showToast('設定を保存しました');
  });

  document.getElementById('clearDataBtn').addEventListener('click', () => {
    if (!confirm('すべてのデータを削除してリセットします。よろしいですか？')) return;
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  });
}

function closeSettings() {
  document.getElementById('settingsModal').classList.add('hidden');
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadState();
  initSetup();
  initTabs();
  initForms();
  initRecTabs();
  initSettings();

  document.getElementById('analyzeBtn').addEventListener('click', runAnalysis);
  document.getElementById('refreshBtn').addEventListener('click', runAnalysis);

  if (state.apiKey) {
    showApp();
    if (state.analysis) {
      renderHub();
      renderPlan();
    }
  }
});
