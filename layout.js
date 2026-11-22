/*
 * 欄（カード）の配置を、用意した型から選んで切り替える。
 * 型は CSS グリッドの領域（grid-template-areas）で表し、選んだ型は localStorage に保存する。
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
      desc: '上に「正規表現」、中段に「部品」と「意味」を左右に並べ、下に「試す」',
      cols: 'minmax(0, 1fr) minmax(0, 1fr)',
      rows: 'auto auto auto',
      areas: [
        ['pattern', 'pattern'],
        ['palette', 'meaning'],
        ['tester', 'tester'],
      ],
    },
    {
      id: 'palette-left',
      name: '部品を左に',
      desc: '左に「部品」、右に「正規表現」・「意味」・「試す」を縦に並べる',
      cols: 'minmax(0, 2fr) minmax(0, 3fr)',
      rows: 'auto auto 1fr',
      areas: [
        ['palette', 'pattern'],
        ['palette', 'meaning'],
        ['palette', 'tester'],
      ],
    },
    {
      id: 'meaning-right',
      name: '意味を右に',
      desc: '左に「正規表現」・「部品」・「試す」を縦に並べ、右に「意味」',
      cols: 'minmax(0, 3fr) minmax(0, 2fr)',
      rows: 'auto auto 1fr',
      areas: [
        ['pattern', 'meaning'],
        ['palette', 'meaning'],
        ['tester', 'meaning'],
      ],
    },
    {
      id: 'test-focus',
      name: '試すを上に',
      desc: '上に「正規表現」、中段に「試す」と「意味」を左右に並べ、下に「部品」',
      cols: 'minmax(0, 1fr) minmax(0, 1fr)',
      rows: 'auto auto auto',
      areas: [
        ['pattern', 'pattern'],
        ['tester', 'meaning'],
        ['palette', 'palette'],
      ],
    },
    {
      id: 'test-second',
      name: '試すを2段目に',
      desc: '上に「正規表現」、その下に「試す」、いちばん下に「部品」と「意味」を左右に並べる',
      cols: 'minmax(0, 1fr) minmax(0, 1fr)',
      rows: 'auto auto auto',
      areas: [
        ['pattern', 'pattern'],
        ['tester', 'tester'],
        ['palette', 'meaning'],
      ],
    },
    {
      id: 'single',
      name: '縦一列',
      desc: '「正規表現」・「部品」・「意味」・「試す」を縦一列に並べる',
      cols: 'minmax(0, 1fr)',
      rows: 'auto auto auto auto',
      areas: [['pattern'], ['palette'], ['meaning'], ['tester']],
    },
  ];

  // 小さな図の中で各欄を示す 1 文字
  const SHORT = { pattern: '式', palette: '部', meaning: '意', tester: '試' };

  const board = document.getElementById('board');
  const picker = document.getElementById('layout-picker');
  const statusEl = document.getElementById('layout-status');

  const areasCss = (areas) => areas.map((row) => `"${row.join(' ')}"`).join(' ');

  function applyPreset(preset) {
    board.style.setProperty('--board-cols', preset.cols);
    board.style.setProperty('--board-rows', preset.rows);
    board.style.setProperty('--board-areas', areasCss(preset.areas));
    for (const btn of picker.querySelectorAll('button')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.preset === preset.id));
    }
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
    thumb.style.gridTemplateColumns = preset.cols;
    thumb.style.gridTemplateAreas = areasCss(preset.areas);
    const ids = [...new Set(preset.areas.flat())];
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
    });
    picker.append(btn);
  }

  const saved = PRESETS.find((p) => p.id === load());
  applyPreset(saved || PRESETS[0]);
})();
