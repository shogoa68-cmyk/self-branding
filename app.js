'use strict';

// ─── State ───────────────────────────────────────────────────────────────────

const DEFAULTS = {
  profile: {
    name: '', nameEn: '', title: '', company: '',
    tagline: '', bio: '',
    snsX: '', snsLinkedIn: '', snsGitHub: '', snsNote: '',
  },
  identity: {
    strength: '', values: [], targetAudience: '', uniqueValue: '', mission: '',
  },
  skills: [],
  statement: '',
  pitch: '',
  snsTexts: { x: '', linkedin: '', github: '', wantedly: '' },
  checklist: {},
};

let state;

function loadState() {
  try {
    const raw = localStorage.getItem('brandme_state');
    state = raw ? { ...JSON.parse(JSON.stringify(DEFAULTS)), ...JSON.parse(raw) } : JSON.parse(JSON.stringify(DEFAULTS));
    // ensure nested objects exist
    state.profile   = { ...DEFAULTS.profile,   ...(state.profile || {}) };
    state.identity  = { ...DEFAULTS.identity,  ...(state.identity || {}) };
    state.snsTexts  = { ...DEFAULTS.snsTexts,  ...(state.snsTexts || {}) };
    state.checklist = state.checklist || {};
    state.skills    = Array.isArray(state.skills) ? state.skills : [];
    if (!Array.isArray(state.identity.values)) state.identity.values = [];
  } catch (_) {
    state = JSON.parse(JSON.stringify(DEFAULTS));
  }
}

function saveState() {
  localStorage.setItem('brandme_state', JSON.stringify(state));
  updateProgress();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

function copyText(text) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => showToast('クリップボードにコピーしました！'));
  } else {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    showToast('クリップボードにコピーしました！');
  }
}

// ─── Tab navigation ──────────────────────────────────────────────────────────

function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });
}

// ─── Generic form binding ────────────────────────────────────────────────────

function initForms() {
  document.querySelectorAll('[data-section][data-field]').forEach(el => {
    const { section, field } = el.dataset;
    el.value = state[section]?.[field] ?? '';

    el.addEventListener('input', () => {
      state[section][field] = el.value;
      saveState();
      updateCharCounts();
    });
  });
  updateCharCounts();
}

function updateCharCounts() {
  const tagline = document.getElementById('tagline');
  const bio     = document.getElementById('bio');
  if (tagline) document.getElementById('taglineCount').textContent = `${tagline.value.length} / 50文字`;
  if (bio)     document.getElementById('bioCount').textContent     = `${bio.value.length} / 400文字`;
}

// ─── Values ──────────────────────────────────────────────────────────────────

function initValues() {
  document.querySelectorAll('.value-chip').forEach(chip => {
    if (state.identity.values.includes(chip.dataset.value)) chip.classList.add('selected');

    chip.addEventListener('click', () => {
      const v = chip.dataset.value;
      if (chip.classList.contains('selected')) {
        chip.classList.remove('selected');
        state.identity.values = state.identity.values.filter(x => x !== v);
      } else if (state.identity.values.length < 3) {
        chip.classList.add('selected');
        state.identity.values.push(v);
      } else {
        showToast('価値観は最大3つまで選択できます');
        return;
      }
      saveState();
    });
  });
}

// ─── Skills ──────────────────────────────────────────────────────────────────

const LEVEL_LABELS = ['入門', '初級', '中級', '上級', 'エキスパート'];
const CATEGORY_JP  = { technical: 'テクニカル', business: 'ビジネス', soft: 'ソフトスキル', language: '語学' };

function initSkills() {
  const slider = document.getElementById('skillLevel');
  slider.addEventListener('input', () => {
    document.getElementById('skillLevelLabel').textContent = LEVEL_LABELS[slider.value - 1];
  });

  document.getElementById('addSkillBtn').addEventListener('click', addSkill);
  document.getElementById('skillName').addEventListener('keypress', e => { if (e.key === 'Enter') addSkill(); });

  renderSkills();
}

function addSkill() {
  const name  = document.getElementById('skillName').value.trim();
  const cat   = document.getElementById('skillCategory').value;
  const level = parseInt(document.getElementById('skillLevel').value, 10);

  if (!name) { showToast('スキル名を入力してください'); return; }
  if (state.skills.some(s => s.name === name)) { showToast('すでに追加されています'); return; }

  state.skills.push({ id: Date.now(), name, category: cat, level });
  document.getElementById('skillName').value = '';
  saveState();
  renderSkills();
}

function deleteSkill(id) {
  state.skills = state.skills.filter(s => s.id !== id);
  saveState();
  renderSkills();
}

function renderSkills() {
  const list = document.getElementById('skillsList');
  if (!state.skills.length) {
    list.innerHTML = '<div class="skills-empty">スキルをまだ追加していません。上のフォームから追加してください。</div>';
    return;
  }

  list.innerHTML = state.skills.map(s => `
    <div class="skill-item">
      <div class="skill-info">
        <div class="skill-name">${esc(s.name)}</div>
        <span class="category-badge ${s.category}">${CATEGORY_JP[s.category]}</span>
      </div>
      <div class="skill-bar-wrap">
        <div class="skill-level-text">${LEVEL_LABELS[s.level - 1]}</div>
        <div class="skill-bar">
          <div class="skill-bar-fill" style="width:${s.level * 20}%"></div>
        </div>
      </div>
      <button class="skill-delete" data-id="${s.id}" title="削除">×</button>
    </div>
  `).join('');

  list.querySelectorAll('.skill-delete').forEach(btn => {
    btn.addEventListener('click', () => deleteSkill(Number(btn.dataset.id)));
  });
}

// ─── Statement generation ────────────────────────────────────────────────────

const VALUE_JP = {
  innovation:'イノベーション', integrity:'誠実さ', growth:'成長',
  collaboration:'協働', creativity:'創造性', impact:'社会的インパクト',
  quality:'品質', learning:'学び', diversity:'多様性',
  sustainability:'持続可能性', simplicity:'シンプルさ', empowerment:'人の力を引き出すこと',
};

function initStatement() {
  document.getElementById('generateBtn').addEventListener('click', generateStatement);

  if (state.statement) renderStatement(state.statement, state.pitch);
}

function generateStatement() {
  const { name, title, tagline } = state.profile;
  const { strength, values, targetAudience, uniqueValue, mission } = state.identity;

  const nm  = name           || 'あなた';
  const ttl = title          || 'プロフェッショナル';
  const aud = targetAudience || 'クライアント・仲間';
  const str = strength       || '独自のスキルセット';
  const uv  = uniqueValue    || '独自の視点と経験';
  const ms  = mission        || 'より良い未来を共に作ること';
  const tag = tagline        || ms;
  const vls = values.length  ? values.map(v => VALUE_JP[v]).join('・') : '誠実さと品質';

  state.statement = [
    `私は、${ttl}として${aud}に価値を提供する${nm}です。`,
    '',
    `【強み】\n${str}`,
    '',
    `【大切にしていること】\n${vls}`,
    '',
    `【ユニークな提供価値】\n${uv}`,
    '',
    `【ミッション】\n${ms}`,
  ].join('\n');

  state.pitch = `${nm}といいます。${ttl}として、${aud}が抱える課題を${str}で解決しています。「${tag}」をモットーに活動しています。`;

  saveState();
  renderStatement(state.statement, state.pitch);
  showToast('ブランドステートメントを生成しました！');
}

function renderStatement(stmt, pitch) {
  renderGenerated('statementBlock', stmt, () => { state.statement = document.getElementById('statementBlock').querySelector('textarea').value; saveState(); });
  renderGenerated('pitchBlock',     pitch, () => { state.pitch     = document.getElementById('pitchBlock').querySelector('textarea').value;     saveState(); });
}

function renderGenerated(blockId, text, onEdit) {
  const block = document.getElementById(blockId);
  block.innerHTML = `
    <div class="generated-textarea-wrap">
      <textarea rows="${Math.max(4, text.split('\n').length + 1)}">${esc(text)}</textarea>
    </div>
    <div class="generated-actions">
      <button class="btn-copy">📋 コピーする</button>
    </div>
  `;
  const ta = block.querySelector('textarea');
  ta.addEventListener('input', onEdit);
  block.querySelector('.btn-copy').addEventListener('click', () => copyText(ta.value));
}

// ─── SNS profile generation ──────────────────────────────────────────────────

function initSns() {
  document.getElementById('generateSnsBtn').addEventListener('click', generateSns);

  document.querySelectorAll('.btn-copy[data-target]').forEach(btn => {
    btn.addEventListener('click', () => copyText(document.getElementById(btn.dataset.target).value));
  });

  [['xText','xCount',160],['linkedinText','linkedinCount',220],
   ['githubText','githubCount',160],['wantedlyText','wantedlyCount',500]
  ].forEach(([id, cid, limit]) => {
    document.getElementById(id).addEventListener('input', e => updateSnsCounter(cid, e.target.value.length, limit));
  });

  // restore saved texts
  if (state.snsTexts.x)         setSns('xText',        'xCount',        state.snsTexts.x,        160);
  if (state.snsTexts.linkedin)  setSns('linkedinText',  'linkedinCount', state.snsTexts.linkedin,  220);
  if (state.snsTexts.github)    setSns('githubText',    'githubCount',   state.snsTexts.github,    160);
  if (state.snsTexts.wantedly)  setSns('wantedlyText',  'wantedlyCount', state.snsTexts.wantedly,  500);
}

function setSns(taId, countId, text, limit) {
  document.getElementById(taId).value = text;
  updateSnsCounter(countId, text.length, limit);
}

function updateSnsCounter(countId, len, limit) {
  const el = document.getElementById(countId);
  el.textContent = `${len} / ${limit} 文字`;
  el.classList.toggle('over', len > limit);
}

function generateSns() {
  const { name, title, tagline, snsNote } = state.profile;
  const { strength, values, targetAudience, uniqueValue, mission } = state.identity;

  const nm  = name || 'あなた';
  const ttl = title || 'プロフェッショナル';
  const tag = tagline || mission || '';
  const str = strength || '';
  const vls = values.length ? values.map(v => VALUE_JP[v]).join('・') : '';

  const topTech = state.skills.filter(s => s.category === 'technical').sort((a,b) => b.level - a.level).slice(0,5).map(s => s.name);
  const topAll  = state.skills.sort((a,b) => b.level - a.level).slice(0,5).map(s => s.name);

  // X (160 chars)
  let x = `${ttl}`;
  if (tag) x += ` | ${tag}`;
  if (topAll.length) x += ` | ${topAll.slice(0,3).join(' / ')}`;
  if (snsNote) x += ` | 📝 ${snsNote}`;
  x = x.slice(0, 160);

  // LinkedIn headline (220 chars)
  let li = `${ttl}`;
  if (targetAudience) li += ` | ${targetAudience}の支援`;
  if (tag) li += ` | ${tag}`;
  if (topAll.length) li += ` | ${topAll.join(' / ')}`;
  li = li.slice(0, 220);

  // GitHub (160 chars)
  let gh = `${ttl}`;
  if (topTech.length) gh += ` | ${topTech.join(' / ')}`;
  if (snsNote) gh += ` | 📝 ${snsNote}`;
  gh = gh.slice(0, 160);

  // Wantedly (500 chars)
  const parts = [`【${ttl}】`];
  if (tag) parts.push('', tag);
  if (str) parts.push('', str);
  if (vls) parts.push('', `【大切にしていること】\n${vls.split('・').map(v => `・${v}`).join('\n')}`);
  if (mission) parts.push('', `【目指していること】\n${mission}`);
  if (topAll.length) parts.push('', `【スキル】\n${topAll.join(' / ')}`);
  const wa = parts.join('\n').slice(0, 500);

  state.snsTexts = { x, linkedin: li, github: gh, wantedly: wa };
  saveState();

  setSns('xText',        'xCount',        x,  160);
  setSns('linkedinText', 'linkedinCount', li,  220);
  setSns('githubText',   'githubCount',   gh,  160);
  setSns('wantedlyText', 'wantedlyCount', wa,  500);

  showToast('SNSプロフィールを生成しました！');
}

// ─── Checklist ───────────────────────────────────────────────────────────────

const CHECKLIST = [
  {
    category: 'ブランド基盤',
    items: [
      { id: 'b1', title: 'ブランドコンセプトを定義する',     desc: '強み・価値観・ターゲットを明確にする' },
      { id: 'b2', title: 'ブランドステートメントを完成させる', desc: '自分を一言で表す文章を仕上げる' },
      { id: 'b3', title: 'ブランドカラー・フォントを決める',  desc: '一貫したビジュアルアイデンティティを確立する' },
      { id: 'b4', title: 'プロフィール写真を用意する',        desc: '清潔感があり、プロらしい写真を選ぶ' },
    ],
  },
  {
    category: 'オンラインプレゼンス',
    items: [
      { id: 'o1', title: 'X (Twitter) プロフィールを最適化',   desc: 'Bio・ヘッダー画像・固定ポストを整える' },
      { id: 'o2', title: 'LinkedIn プロフィールを完成させる',  desc: '職歴・スキル・推薦文を充実させる' },
      { id: 'o3', title: 'GitHub プロフィール README を作成', desc: 'README.md で自己紹介とプロジェクトをアピール' },
      { id: 'o4', title: 'Wantedly プロフィールを更新',        desc: 'ビジョン・バリューを記入する' },
      { id: 'o5', title: 'Note でブログを始める',              desc: '専門知識を発信してオーソリティを確立する' },
    ],
  },
  {
    category: 'コンテンツ発信',
    items: [
      { id: 'c1', title: '発信テーマ・軸を決める',        desc: '何について専門的に発信するかを明確にする' },
      { id: 'c2', title: 'コンテンツカレンダーを作る',    desc: '週の投稿頻度と内容を計画する' },
      { id: 'c3', title: '最初のコンテンツを公開する',    desc: 'Note 記事または X 投稿を 1 本公開する' },
      { id: 'c4', title: 'ニッチな専門分野を確立する',    desc: '特定領域でのオーソリティを高める' },
    ],
  },
  {
    category: 'ネットワーキング',
    items: [
      { id: 'n1', title: 'コミュニティに参加する',           desc: 'Slack・Discord・勉強会などに積極参加' },
      { id: 'n2', title: '週 3 人以上と交流する',            desc: 'DM・コメント・リプライで繋がりを広げる' },
      { id: 'n3', title: '登壇・発表の機会を作る',           desc: 'LT 会や勉強会で知名度を上げる' },
      { id: 'n4', title: 'デジタル名刺を作成・更新する',     desc: 'Eight などのサービスも設定する' },
    ],
  },
];

function initChecklist() {
  const container = document.getElementById('checklistContainer');
  container.innerHTML = CHECKLIST.map(cat => `
    <div class="checklist-category">
      <div class="checklist-category-title">${cat.category}</div>
      ${cat.items.map(item => `
        <div class="checklist-item ${state.checklist[item.id] ? 'done' : ''}" data-id="${item.id}">
          <div class="check-box">${state.checklist[item.id] ? '✓' : ''}</div>
          <div class="check-text">
            <div class="check-title">${item.title}</div>
            <div class="check-desc">${item.desc}</div>
          </div>
        </div>
      `).join('')}
    </div>
  `).join('');

  container.querySelectorAll('.checklist-item').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      state.checklist[id] = !state.checklist[id];
      el.classList.toggle('done', state.checklist[id]);
      el.querySelector('.check-box').textContent = state.checklist[id] ? '✓' : '';
      saveState();
      updateChecklistProgress();
    });
  });

  updateChecklistProgress();
}

function updateChecklistProgress() {
  const total     = CHECKLIST.reduce((n, c) => n + c.items.length, 0);
  const completed = Object.values(state.checklist).filter(Boolean).length;
  const pct       = total ? Math.round((completed / total) * 100) : 0;
  document.getElementById('checklistFill').style.width = `${pct}%`;
  document.getElementById('checklistPercent').textContent = `${completed} / ${total} 完了`;
}

// ─── Overall progress ─────────────────────────────────────────────────────────

function updateProgress() {
  const checks = [
    state.profile.name,
    state.profile.title,
    state.profile.tagline,
    state.profile.bio,
    state.identity.strength,
    state.identity.targetAudience,
    state.identity.uniqueValue,
    state.identity.mission,
    state.identity.values.length > 0,
    state.skills.length >= 3,
    state.statement,
    (() => {
      const total = CHECKLIST.reduce((n,c) => n + c.items.length, 0);
      return Object.values(state.checklist).filter(Boolean).length >= total * 0.5;
    })(),
  ];

  const filled = checks.filter(Boolean).length;
  const pct = Math.round((filled / checks.length) * 100);
  document.getElementById('progressFill').style.width  = `${pct}%`;
  document.getElementById('progressPercent').textContent = `${pct}%`;
}

// ─── Boot ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadState();
  initTabs();
  initForms();
  initValues();
  initSkills();
  initStatement();
  initSns();
  initChecklist();
  updateProgress();
});
