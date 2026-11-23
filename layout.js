/*
 * 欄（カード）の配置を、用意した型から選んで切り替える。
 * 型は CSS グリッドの領域（grid-template-areas）で表し、選んだ型は localStorage に保存する。
 * 「正規表現」の欄は型にかかわらず画面の上に固定するので、型で並べるのは「部品」「意味」「テスト」の 3 つ。
 * 画面の幅が狭いときは、型にかかわらず縦一列になる（style.css）。
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'regex-builder:layout-preset';

  // areas の名前は、各欄の data-card と同じにする
  const PRESETS = [
    {
      id: 'standard',
      name: '標準',
      desc: '「部品」と「意味」を左右に並べ、下に「テスト」',
      cols: 'minmax(0, 1fr) minmax(0, 1fr)',
      rows: 'auto auto',
      areas: [
        ['palette', 'meaning'],
        ['tester', 'tester'],
      ],
    },
    {
      id: 'palette-left',
      name: '部品を左に',
      desc: '左に「部品」、右に「意味」と「テスト」を縦に並べる',
      cols: 'minmax(0, 2fr) minmax(0, 3fr)',
      rows: 'auto 1fr',
      areas: [
        ['palette', 'meaning'],
        ['palette', 'tester'],
      ],
    },
    {
      id: 'meaning-right',
      name: '意味を右に',
      desc: '左に「部品」と「テスト」を縦に並べ、右に「意味」',
      cols: 'minmax(0, 3fr) minmax(0, 2fr)',
      rows: 'auto 1fr',
      areas: [
        ['palette', 'meaning'],
        ['tester', 'meaning'],
      ],
    },
    {
      id: 'test-focus',
      name: 'テストを上に',
      desc: '「テスト」と「意味」を左右に並べ、下に「部品」',
      cols: 'minmax(0, 1fr) minmax(0, 1fr)',
      rows: 'auto auto',
      areas: [
        ['tester', 'meaning'],
        ['palette', 'palette'],
      ],
    },
    {
      id: 'test-second',
      name: 'テストを2段目に',
      desc: '上に「テスト」、下に「部品」と「意味」を左右に並べる',
      cols: 'minmax(0, 1fr) minmax(0, 1fr)',
      rows: 'auto auto',
      areas: [
        ['tester', 'tester'],
        ['palette', 'meaning'],
      ],
    },
    {
      id: 'single',
      name: '縦一列',
      desc: '「部品」・「意味」・「テスト」を縦一列に並べる',
      cols: 'minmax(0, 1fr)',
      rows: 'auto auto auto',
      areas: [['palette'], ['meaning'], ['tester']],
    },
  ];

  // 小さな図の中で各欄を示す 1 文字
  const SHORT = { pattern: '式', palette: '部', meaning: '意', tester: 'テ' };

  const board = document.getElementById('board');
  const picker = document.getElementById('layout-picker');
  const statusEl = document.getElementById('layout-status');
  const menu = document.getElementById('layout-menu');
  const currentEl = document.getElementById('layout-current');

  const areasCss = (areas) => areas.map((row) => `"${row.join(' ')}"`).join(' ');

  function applyPreset(preset) {
    board.style.setProperty('--board-cols', preset.cols);
    board.style.setProperty('--board-rows', preset.rows);
    board.style.setProperty('--board-areas', areasCss(preset.areas));
    for (const btn of picker.querySelectorAll('button')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.preset === preset.id));
    }
    currentEl.textContent = preset.name;
  }

  function save(id) {
    try { localStorage.setItem(STORAGE_KEY, id); } catch (_) { /* 保存できなくても切り替えは続ける */ }
  }

  function load() {
    try { return localStorage.getItem(STORAGE_KEY); } catch (_) { return null; }
  }

  function buildThumb(preset) {
    const thumb = document.createElement('span');
    thumb.className = 'layout-thumb';
    thumb.setAttribute('aria-hidden', 'true');
    // 図では、上に固定される「正規表現」の欄も 1 段目に描く
    const width = preset.areas[0].length;
    thumb.style.gridTemplateColumns = preset.cols;
    thumb.style.gridTemplateAreas = areasCss([Array(width).fill('pattern'), ...preset.areas]);
    const ids = ['pattern', ...new Set(preset.areas.flat())];
    for (const id of ids) {
      const cell = document.createElement('span');
      cell.className = `layout-cell cell-${id}`;
      cell.style.gridArea = id;
      cell.textContent = SHORT[id];
      thumb.append(cell);
    }
    return thumb;
  }

  for (const preset of PRESETS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'layout-option';
    btn.dataset.preset = preset.id;
    btn.title = preset.desc;
    btn.setAttribute('aria-label', `${preset.name}（${preset.desc}）`);
    const name = document.createElement('span');
    name.className = 'layout-name';
    name.textContent = preset.name;
    btn.append(buildThumb(preset), name);
    btn.addEventListener('click', () => {
      applyPreset(preset);
      save(preset.id);
      statusEl.textContent = `配置を「${preset.name}」にしました`;
      menu.open = false;
      menu.querySelector('summary').focus();
    });
    picker.append(btn);
  }

  // メニューの外を押したときと、Esc キーを押したときに閉じる
  document.addEventListener('click', (e) => {
    if (menu.open && !menu.contains(e.target)) menu.open = false;
  });
  menu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menu.open) {
      menu.open = false;
      menu.querySelector('summary').focus();
    }
  });

  const saved = PRESETS.find((p) => p.id === load());
  applyPreset(saved || PRESETS[0]);
})();
