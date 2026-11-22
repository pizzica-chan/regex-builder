(function () {
  'use strict';

  const { explain, RegexParseError, escapeHtml: esc } = window.RegexExplain;
  const $ = (id) => document.getElementById(id);

  const patternEl = $('pattern');
  const testEl = $('test-input');
  const flagBoxes = [...document.querySelectorAll('.flags input[type="checkbox"]')];

  // desc: 部品の説明。ex: [例のパターン, 例の文字列]。例の一致は表示のたびに実際に計算する
  const PALETTE = [
    {
      title: '文字の種類（1文字）',
      items: [
        { label: '数字', insert: '\\d', desc: '0〜9 の数字1文字に一致します。全角数字（０〜９）には一致しません。', ex: ['\\d+', '部屋は 302 号室、内線は ３０２'] },
        { label: '数字以外', insert: '\\D', desc: '数字（0〜9）以外の1文字に一致します。英字や記号、空白、全角数字にも一致します。', ex: ['\\D+', 'A12-34b'] },
        { label: '英数字と _', insert: '\\w', desc: '英字（a〜z、A〜Z）、数字（0〜9）、アンダースコア（_）のどれか1文字に一致します。ひらがなや漢字、全角の英数字には一致しません。', ex: ['\\w+', 'user_01 さん@host'] },
        { label: '空白', insert: '\\s', desc: 'スペース、タブ、改行など、空白に当たる1文字に一致します。全角スペースにも一致します。', ex: ['\\s+', 'a b　c'] },
        { label: '空白以外', insert: '\\S', desc: '空白（スペース、タブ、改行など）以外の1文字に一致します。', ex: ['\\S+', 'hello world'] },
        { label: '任意の文字', insert: '.', desc: '改行以外の、どんな文字でも1文字に一致します。s フラグを付けると改行にも一致します。記号の「.」そのものに一致させたいときは \\. と書きます。', ex: ['a.c', 'abc a-c ac'] },
        { label: '英小文字', insert: '[a-z]', desc: 'a から z までの英小文字1文字に一致します。i フラグを付けると大文字にも一致します。', ex: ['[a-z]+', 'Hello World'] },
        { label: '英大文字', insert: '[A-Z]', desc: 'A から Z までの英大文字1文字に一致します。', ex: ['[A-Z]', 'Hello World'] },
        { label: '英字', insert: '[A-Za-z]', desc: '英字（大文字と小文字）1文字に一致します。数字には一致しません。', ex: ['[A-Za-z]+', 'abc123DEF'] },
        { label: 'ひらがな', insert: '[ぁ-ん]', desc: '「ぁ」から「ん」までのひらがな1文字に一致します。長音記号の「ー」は含みません。', ex: ['[ぁ-ん]+', 'ひらがなとカタカナ'] },
        { label: 'カタカナ', insert: '[ァ-ヶー]', desc: '「ァ」から「ヶ」までのカタカナと、長音記号の「ー」のどれか1文字に一致します。半角カタカナは含みません。', ex: ['[ァ-ヶー]+', 'コーヒーとお茶'] },
        { label: '漢字', insert: '[一-龯]', desc: 'よく使う漢字（「一」から「龯」までの範囲）1文字に一致します。「々」と、この範囲の外にある一部の漢字は含みません。', ex: ['[一-龯]+', '日々の東京'] },
      ],
    },
    {
      title: '繰り返し（直前の部品に付ける）',
      items: [
        { label: '0回以上', insert: '*', desc: '直前の部品を0回以上繰り返します。1回もないときにも一致します。', ex: ['ab*c', 'ac abc abbbc'] },
        { label: '1回以上', insert: '+', desc: '直前の部品を1回以上繰り返します。', ex: ['ab+c', 'ac abc abbbc'] },
        { label: 'なくてもよい', insert: '?', desc: '直前の部品が1回あっても、なくても一致します。', ex: ['colou?r', 'color colour'] },
        { label: '最短で一致', insert: '?', desc: '*、+、?、{…} のすぐ後ろに付けると、繰り返しをできるだけ短いところで止めます。付けないと、できるだけ長く一致します。', ex: ['<.+?>', '<b>太字</b>'] },
      ],
    },
    {
      title: '位置',
      items: [
        { label: '先頭', insert: '^', desc: '文字列の先頭に一致します。m フラグを付けると、各行の先頭にも一致します。文字ではなく位置に一致するので、一致した文字列には何も加わりません。', ex: ['^\\d+', '123 abc 456'] },
        { label: '末尾', insert: '$', desc: '文字列の末尾に一致します。m フラグを付けると、各行の末尾にも一致します。文字ではなく位置に一致します。', ex: ['\\d+$', '123 abc 456'] },
        { label: '単語の区切り', insert: '\\b', desc: '英数字・_ と、それ以外の文字（または文字列の端）との境目に一致します。文字ではなく位置に一致します。日本語の単語の区切りには使えません。', ex: ['\\bcat\\b', 'cat concat cat_s cat.'] },
      ],
    },
    {
      title: 'グループと選択',
      items: [
        { label: 'グループ', wrap: ['(', ')'], desc: '囲んだ部分をひとまとめにし、一致した内容を番号で取り出せるようにします。\\1 と書くと、1番のグループと同じ内容にもう一度一致します。', ex: ['(ab)+', 'ababab abx'] },
        { label: '名前付きグループ', wrap: ['(?<name>', ')'], desc: 'グループに名前を付けます。一致した内容を、番号の代わりに名前で取り出せます。name の部分を好きな名前に書き換えてください。', ex: ['(?<year>\\d{4})年', '2026年11月'] },
        { label: 'まとめるだけ', wrap: ['(?:', ')'], desc: '囲んだ部分をひとまとめにします。グループと違い、一致した内容は記録しません。繰り返しや「または」の範囲を決めるときに使います。', ex: ['(?:ab)+', 'ababab abx'] },
        { label: 'または', insert: '|', desc: '左右のどちらかに一致します。( ) の中で使うと、その ( ) の中だけで「どちらか」になります。', ex: ['cat|dog', 'cat and dog'] },
        { label: '同じ文字列（番号）', insert: '\\1', select: [1, 2], desc: '1番のグループに一致した文字列と同じものに一致します（後方参照）。グループのパターンではなく、実際に一致した文字列を使います。数字の部分を、参照したいグループの番号に書き換えてください。', ex: ['\\b(\\w+)\\s+\\1\\b', 'this is is a test'] },
        { label: '同じ文字列（名前）', insert: '\\k<name>', select: [3, 7], desc: '名前付きグループに一致した文字列と同じものに一致します（後方参照）。name の部分を、参照したいグループの名前に書き換えてください。', ex: ['(?<q>["\'])(.*?)\\k<q>', 'say "hi" and \'yo"'] },
        { label: '後ろに続く', wrap: ['(?=', ')'], desc: 'すぐ後ろに、囲んだ内容が続く位置に一致します。続く部分は確かめるだけで、一致した文字列には含めません。', ex: ['\\d+(?=円)', '100円 200ドル'] },
        { label: '後ろに続かない', wrap: ['(?!', ')'], desc: 'すぐ後ろに、囲んだ内容が続かない位置に一致します。確かめるだけで、一致した文字列には含めません。', ex: ['foo(?!bar)', 'foobar foobaz'] },
        { label: '前にある', wrap: ['(?<=', ')'], desc: 'すぐ前に、囲んだ内容がある位置に一致します。確かめるだけで、一致した文字列には含めません。', ex: ['(?<=¥)\\d+', '¥500 と 300円'] },
        { label: '前にない', wrap: ['(?<!', ')'], desc: 'すぐ前に、囲んだ内容がない位置に一致します。確かめるだけで、一致した文字列には含めません。', ex: ['(?<!¥)\\b\\d+', '¥500 と 300円'] },
      ],
    },
  ];

  // 部品以外のボタンの説明
  const BUTTON_TIPS = {
    'literal-add': { label: '文字をそのまま入れる', desc: '入力した文字を、そのままの文字として入れます。. や ( のように正規表現で特別な意味を持つ記号には \\ を付けます。', ex: ['example\\.com', 'example.com exampleXcom'] },
    'class-add': { label: '文字の集まりから 1 文字', code: '[…]', desc: '入力した文字のどれか1文字に一致する部品を入れます。a-z のように - でつなぐと範囲になります。', ex: ['[aeiou]', 'regex'] },
    'class-neg-add': { label: '文字の集まり以外の 1 文字', code: '[^…]', desc: '入力した文字のどれでもない1文字に一致する部品を入れます。', ex: ['[^aeiou]+', 'regex'] },
    'rep-add': { label: '回数を指定して繰り返す', code: '{n,m}', desc: '直前の部品を、指定した回数だけ繰り返します。{3} はちょうど3回、{2,4} は2〜4回、{2,} は2回以上です。', ex: ['\\d{2,4}', '1 12 123 12345'] },
  };

  const PRESETS = [
    { name: '郵便番号（123-4567）', pattern: '^\\d{3}-\\d{4}$', flags: 'gm', test: '123-4567\n1234567\n12-34567\n100-0001' },
    { name: '携帯電話の番号', pattern: '^0[789]0-?\\d{4}-?\\d{4}$', flags: 'gm', test: '090-1234-5678\n08012345678\n03-1234-5678' },
    { name: 'メールアドレス（簡易）', pattern: '^[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+$', flags: 'gm', test: 'user@example.com\nfoo.bar+tag@mail.example.co.jp\nnot-an-email\n@example.com' },
    { name: '日付（YYYY-MM-DD）', pattern: '(?<year>\\d{4})-(?<month>0[1-9]|1[0-2])-(?<day>0[1-9]|[12]\\d|3[01])', flags: 'g', test: '締め切りは 2026-11-30、開始は 2026-12-01 です。2026-13-01 は月が正しくありません。' },
    { name: 'URL（http と https）', pattern: 'https?://[\\w.-]+(?:/[\\w\\-./?%&=#~]*)?', flags: 'g', test: '詳しくは https://example.com/docs?page=2 を見てください。http://localhost:8080/ も使えます。' },
    { name: 'ひらがなだけの行', pattern: '^[ぁ-んー]+$', flags: 'gm', test: 'ひらがな\nカタカナ\nまぜまぜカナ\nらーめん' },
    { name: 'HTML のタグ（最短一致）', pattern: '<.+?>', flags: 'g', test: '<p>こんにちは <strong>世界</strong></p>' },
    { name: '同じ単語の繰り返し', pattern: '\\b(\\w+)\\s+\\1\\b', flags: 'gi', test: 'This is is a test. The the end.' },
    { name: '金額（3 桁ごとのカンマ）', pattern: '(?<!\\d)\\d{1,3}(?:,\\d{3})*(?=円)', flags: 'g', test: '合計 1,234,567円、送料 500円、品番 12345' },
  ];

  // ---------- 部品の表示 ----------

  function buildPalette() {
    const root = $('palette');
    for (const group of PALETTE) {
      const box = document.createElement('div');
      box.className = 'palette-group';
      box.innerHTML = `<h3>${esc(group.title)}</h3>`;
      const chips = document.createElement('div');
      chips.className = 'chips';
      for (const item of group.items) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip';
        const code = item.insert ?? `${item.wrap[0]}…${item.wrap[1]}`;
        b.innerHTML = `<span>${esc(item.label)}</span><code>${esc(code)}</code>`;
        attachTip(b, item, code);
        // 押してもパターン欄の選択範囲が消えないようにする
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', () => {
          if (item.wrap) wrapSelection(item.wrap[0], item.wrap[1]);
          else insertText(item.insert, item.select);
        });
        chips.append(b);
      }
      box.append(chips);
      root.append(box);
    }
  }

  // ---------- 部品の説明（マウスを乗せたときに出す） ----------

  const tipEl = document.createElement('div');
  tipEl.id = 'part-tip';
  tipEl.className = 'part-tip';
  tipEl.setAttribute('role', 'tooltip');
  tipEl.hidden = true;
  document.body.append(tipEl);

  // 例の文字列のうち、例のパターンに一致した部分に印を付ける
  function exampleHtml(pattern, text) {
    let html = '';
    let pos = 0;
    for (const m of text.matchAll(new RegExp(pattern, 'g'))) {
      if (!m[0].length) continue;
      html += esc(text.slice(pos, m.index)) + `<mark>${esc(m[0])}</mark>`;
      pos = m.index + m[0].length;
    }
    return html + esc(text.slice(pos));
  }

  function tipHtml(item, code) {
    let html = `<div class="tip-head"><strong>${esc(item.label)}</strong>${code ? `<code>${esc(code)}</code>` : ''}</div>`;
    html += `<p>${esc(item.desc)}</p>`;
    if (item.ex) {
      const [pattern, text] = item.ex;
      html += `<div class="tip-ex"><span class="tip-ex-label">例</span><code>/${esc(pattern)}/g</code></div>`;
      html += `<div class="tip-sample">${exampleHtml(pattern, text)}</div>`;
    }
    return html;
  }

  function showTip(target, item, code) {
    tipEl.innerHTML = tipHtml(item, code);
    tipEl.hidden = false;
    target.setAttribute('aria-describedby', tipEl.id);
    const r = target.getBoundingClientRect();
    const gap = 8;
    const margin = 16;
    const w = tipEl.offsetWidth;
    const h = tipEl.offsetHeight;
    const left = Math.max(margin, Math.min(r.left, window.innerWidth - w - margin));
    let top = r.bottom + gap;
    // 下に入りきらなければ、ボタンの上に出す
    if (top + h > window.innerHeight - margin && r.top - gap - h > margin) top = r.top - gap - h;
    tipEl.style.left = `${left}px`;
    tipEl.style.top = `${top}px`;
  }

  function hideTip(target) {
    tipEl.hidden = true;
    target.removeAttribute('aria-describedby');
  }

  function attachTip(el, item, code) {
    if (!item.desc) return;
    el.addEventListener('mouseenter', () => showTip(el, item, code));
    el.addEventListener('focus', () => showTip(el, item, code));
    el.addEventListener('mouseleave', () => hideTip(el));
    el.addEventListener('blur', () => hideTip(el));
    // タッチ操作では mouseleave が起きないので、押したら閉じる
    el.addEventListener('click', () => hideTip(el));
  }

  window.addEventListener('scroll', () => { tipEl.hidden = true; }, { passive: true });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') tipEl.hidden = true; });

  // execCommand を使うと、Ctrl+Z で元に戻せる
  function replaceRange(start, end, text) {
    patternEl.focus();
    patternEl.setSelectionRange(start, end);
    const ok = document.execCommand && document.execCommand('insertText', false, text);
    if (!ok) {
      const v = patternEl.value;
      patternEl.value = v.slice(0, start) + text + v.slice(end);
    }
  }

  // select を渡すと、入れた文字列のその範囲を選んだ状態にする（書き換えてほしい部分を示すため）
  function insertText(text, select) {
    const s = patternEl.selectionStart ?? patternEl.value.length;
    const e = patternEl.selectionEnd ?? s;
    replaceRange(s, e, text);
    if (select) patternEl.setSelectionRange(s + select[0], s + select[1]);
    else patternEl.setSelectionRange(s + text.length, s + text.length);
    update();
  }

  function wrapSelection(open, close) {
    const s = patternEl.selectionStart ?? patternEl.value.length;
    const e = patternEl.selectionEnd ?? s;
    const selected = patternEl.value.slice(s, e);
    replaceRange(s, e, open + selected + close);
    if (selected) {
      const pos = s + open.length + selected.length + close.length;
      patternEl.setSelectionRange(pos, pos);
    } else if (open === '(?<name>') {
      patternEl.setSelectionRange(s + 3, s + 7); // name を選んだ状態にする
    } else {
      patternEl.setSelectionRange(s + open.length, s + open.length);
    }
    update();
  }

  function setupCustomParts() {
    for (const [id, tip] of Object.entries(BUTTON_TIPS)) attachTip($(id), tip, tip.code);
    for (const id of ['literal-add', 'class-add', 'class-neg-add', 'rep-add']) {
      $(id).addEventListener('mousedown', (e) => e.preventDefault());
    }
    $('literal-add').addEventListener('click', () => {
      const v = $('literal-text').value;
      if (!v) return;
      insertText(v.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'));
    });
    const addClass = (neg) => {
      const v = $('class-text').value;
      if (!v) return;
      insertText(`[${neg ? '^' : ''}${v.replace(/]/g, '\\]')}]`);
    };
    $('class-add').addEventListener('click', () => addClass(false));
    $('class-neg-add').addEventListener('click', () => addClass(true));
    $('rep-inf').addEventListener('change', (e) => { $('rep-max').disabled = e.target.checked; });
    $('rep-add').addEventListener('click', () => {
      const min = Math.max(0, parseInt($('rep-min').value, 10) || 0);
      let q;
      if ($('rep-inf').checked) q = `{${min},}`;
      else if ($('rep-max').value === '') q = `{${min}}`;
      else {
        const max = Math.max(min, parseInt($('rep-max').value, 10) || 0);
        q = max === min ? `{${min}}` : `{${min},${max}}`;
      }
      insertText(q);
    });
  }

  // ---------- 表示の更新 ----------

  function currentFlags() {
    return flagBoxes.filter((b) => b.checked).map((b) => b.value).join('');
  }

  function showError(msg) {
    const el = $('error');
    el.hidden = !msg;
    el.textContent = msg || '';
  }

  function renderMirror(src, hl) {
    const el = $('mirror');
    if (!src) { el.innerHTML = '<span class="hint">（まだ何もありません）</span>'; return; }
    if (!hl) { el.textContent = src; return; }
    el.innerHTML = esc(src.slice(0, hl[0])) +
      `<mark>${esc(src.slice(hl[0], hl[1]))}</mark>` +
      esc(src.slice(hl[1]));
  }

  function renderTree(nodes, src, listType) {
    const list = document.createElement(listType === 'alt' ? 'ul' : 'ol');
    if (listType === 'alt') list.className = 'alt';
    for (const n of nodes) {
      const li = document.createElement('li');
      const row = document.createElement('div');
      row.className = 'row';
      const frag = n.end > n.start ? src.slice(n.start, n.end) : '';
      row.innerHTML = `<span>${n.html}</span>${frag ? `<code class="src" title="${esc(frag)}">${esc(frag)}</code>` : ''}`;
      if (frag) {
        row.tabIndex = 0;
        const on = () => renderMirror(src, [n.start, n.end]);
        const off = () => renderMirror(src, null);
        row.addEventListener('mouseenter', on);
        row.addEventListener('focus', on);
        row.addEventListener('mouseleave', off);
        row.addEventListener('blur', off);
      }
      li.append(row);
      if (n.children && n.children.length) li.append(renderTree(n.children, src, n.listType));
      list.append(li);
    }
    return list;
  }

  function renderMeaning(src, flags) {
    const tree = $('tree');
    const summary = $('summary');
    const flagEl = $('flag-explain');
    tree.innerHTML = '';
    flagEl.innerHTML = '';
    renderMirror(src, null);
    if (!src) {
      summary.textContent = '正規表現を入力すると、ここに意味が出ます。';
      return;
    }
    let result;
    try {
      result = explain(src, flags);
    } catch (e) {
      summary.textContent = e instanceof RegexParseError
        ? `説明を作れませんでした（${e.message}、${e.pos + 1}文字目）。`
        : '説明を作れませんでした。';
      return;
    }
    const { scope, chain } = result.summary;
    summary.innerHTML = `<span class="scope">${scope}</span>${chain ? `<span class="chain">${chain}</span>` : ''}`;
    tree.append(renderTree(result.tree, src, 'steps'));
    if (result.flags.length) {
      flagEl.innerHTML = '<h3>フラグ</h3><ul>' +
        result.flags.map((f) => `<li><code>${f.flag}</code>：${esc(f.text)}</li>`).join('') +
        '</ul>';
    }
  }

  const MAX_MATCHES = 1000;
  // 一致の計算をこの時間で打ち切る。(a+)+$ のような正規表現は、文字列によって計算が終わらなくなる
  const MATCH_TIMEOUT_MS = 1500;

  // 一致の結果を、ワーカーから受け取る形（{ index, text, groups }）にそろえる
  const pack = (m) => ({ index: m.index, text: m[0], groups: m.slice(1) });

  // ワーカーが使えないとき（file:// で開いたときなど）は、画面と同じスレッドで調べる。この場合は打ち切れない
  function findMatchesHere(re, text) {
    if (!re.global) {
      re.lastIndex = 0;
      const m = re.exec(text);
      return m ? [pack(m)] : [];
    }
    const out = [];
    for (const m of text.matchAll(re)) {
      out.push(pack(m));
      if (out.length >= MAX_MATCHES) break;
    }
    return out;
  }

  // ---------- ワーカーでの一致の計算 ----------

  let worker = null;
  let workerUsable = typeof Worker === 'function';
  let job = null; // 計算中の仕事 { id, re, text, resolve, timer }
  let jobSeq = 0;

  function startWorker() {
    if (!workerUsable) return null;
    try {
      const w = new Worker('match-worker.js');
      w.onmessage = (e) => {
        if (!job || e.data.id !== job.id) return;
        finishJob(e.data.error ? { matches: [] } : { matches: e.data.matches });
      };
      // ワーカーのファイルを読めなかったときは、以後は画面と同じスレッドで調べる
      w.onerror = (e) => {
        e.preventDefault();
        workerUsable = false;
        stopWorker();
        if (job) finishJob({ matches: findMatchesHere(job.re, job.text) });
      };
      return w;
    } catch (_) {
      workerUsable = false;
      return null;
    }
  }

  function stopWorker() {
    if (worker) worker.terminate();
    worker = null;
  }

  function finishJob(result) {
    const { resolve, timer } = job;
    clearTimeout(timer);
    job = null;
    resolve(result);
  }

  // 結果は { matches } か { timeout: true } か { stale: true }
  function findMatches(re, text) {
    // 前の計算がまだ終わっていなければ、ワーカーごと止めて捨てる
    if (job) {
      stopWorker();
      finishJob({ stale: true });
    }
    if (!worker) worker = startWorker();
    if (!worker) return Promise.resolve({ matches: findMatchesHere(re, text) });

    return new Promise((resolve) => {
      const id = ++jobSeq;
      const timer = setTimeout(() => {
        stopWorker();
        finishJob({ timeout: true });
      }, MATCH_TIMEOUT_MS);
      job = { id, re, text, resolve, timer };
      worker.postMessage({ id, source: re.source, flags: re.flags, text, max: MAX_MATCHES });
    });
  }

  async function renderMatches(re) {
    const text = testEl.value;
    const hl = $('highlight');
    const table = $('match-table');
    const count = $('match-count');
    if ((!re || !text) && job) {
      // 計算中の古い結果が、あとから表示を上書きしないようにする
      stopWorker();
      finishJob({ stale: true });
    }
    if (!re) { table.innerHTML = ''; hl.textContent = text; count.textContent = ''; return; }
    if (!text) { table.innerHTML = ''; hl.innerHTML = ''; count.textContent = '試す文字列を入れてください。'; return; }

    const result = await findMatches(re, text);
    if (result.stale) return; // あとから入力された内容の結果を待つ
    table.innerHTML = '';
    if (result.timeout) {
      hl.textContent = text;
      count.textContent = `一致を調べるのに ${MATCH_TIMEOUT_MS / 1000} 秒以上かかったので、途中でやめました。` +
        '(a+)+ のように繰り返しの中に繰り返しがある正規表現は、文字列によっては計算が終わらなくなります。';
      return;
    }

    const { matches } = result;
    count.textContent = matches.length
      ? `${matches.length}${matches.length >= MAX_MATCHES ? '件以上' : '件'}の一致${re.global ? '' : '（g フラグがないので、最初の1件だけ）'}`
      : '一致しませんでした。';

    let html = '';
    let pos = 0;
    matches.forEach((m, n) => {
      const start = m.index;
      const end = start + m.text.length;
      if (start < pos) return;
      html += esc(text.slice(pos, start));
      html += m.text.length
        ? `<mark class="${n % 2 ? 'odd' : ''}" title="一致 ${n + 1}">${esc(m.text)}</mark>`
        : `<span class="empty-match" title="一致 ${n + 1}（長さ 0）"></span>`;
      pos = end;
    });
    html += esc(text.slice(pos));
    hl.innerHTML = html;

    if (!matches.length) return;
    const groupCount = matches[0].groups.length;
    const nameOf = {};
    // 名前付きグループが何番かは一致の結果から分からないので、パターンを解析して調べる
    try {
      const { ast } = window.RegexExplain.parse(re.source, re.flags);
      (function walk(n) {
        if (!n || typeof n !== 'object') return;
        if (n.type === 'group' && n.kind === 'named') nameOf[n.index] = n.name;
        for (const v of Object.values(n)) {
          if (Array.isArray(v)) v.forEach(walk);
          else if (v && typeof v === 'object') walk(v);
        }
      })(ast);
    } catch (_) { /* 名前が出せなくても表は作る */ }

    const shown = matches.slice(0, 200);
    let rows = shown.map((m, n) => {
      // 一致しなかったグループは undefined。ワーカーからの受け渡しで null になる環境もあるので両方を見る
      const cells = m.groups.map((g) => (g == null
        ? '<td><span class="none">（なし）</span></td>'
        : `<td><code>${esc(g)}</code></td>`));
      return `<tr><td>${n + 1}</td><td>${m.index}</td><td><code>${esc(m.text)}</code></td>${cells.join('')}</tr>`;
    }).join('');
    const heads = [];
    for (let g = 1; g <= groupCount; g++) {
      heads.push(`<th>グループ ${g}${nameOf[g] ? `「${esc(nameOf[g])}」` : ''}</th>`);
    }
    if (matches.length > shown.length) {
      rows += `<tr><td colspan="${3 + groupCount}" class="none">ほか ${matches.length - shown.length}件は省略</td></tr>`;
    }
    table.innerHTML = `<div class="table-wrap"><table><thead><tr><th>#</th><th>位置</th><th>一致した文字列</th>${heads.join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  // 自前の解析で誤りの場所が分かれば、日本語の説明を返す。分からなければ null（ブラウザの英語の説明を使う）
  function japaneseError(src, flags) {
    try {
      window.RegexExplain.parse(src, flags);
    } catch (e) {
      if (e instanceof RegexParseError) return `${e.message}（${e.pos + 1}文字目）`;
    }
    return null;
  }

  let lastRe = null;

  function update() {
    const src = patternEl.value;
    const flags = currentFlags();
    $('flag-view').textContent = flags;

    lastRe = null;
    if (src) {
      try {
        lastRe = new RegExp(src, flags);
        showError('');
      } catch (e) {
        showError(`正規表現の書き方に誤りがあります。${japaneseError(src, flags) || e.message}`);
      }
    } else {
      showError('');
    }

    // 書き方に誤りがあっても、解析できれば説明を出す
    renderMeaning(src, flags);
    renderMatches(src ? lastRe : null);
    saveToHash(src, flags);
  }

  // ---------- 共有 URL ----------

  let hashTimer = null;
  function saveToHash(src, flags) {
    clearTimeout(hashTimer);
    hashTimer = setTimeout(() => {
      const p = new URLSearchParams();
      if (src) p.set('p', src);
      if (flags) p.set('f', flags);
      if (testEl.value && testEl.value.length <= 2000) p.set('t', testEl.value);
      const hash = p.toString();
      history.replaceState(null, '', hash ? `#${hash}` : location.pathname + location.search);
    }, 300);
  }

  function loadFromHash() {
    if (!location.hash) return false;
    const p = new URLSearchParams(location.hash.slice(1));
    if (!p.has('p') && !p.has('t')) return false;
    patternEl.value = p.get('p') || '';
    setFlags(p.get('f') ?? '');
    testEl.value = p.get('t') || '';
    return true;
  }

  function setFlags(flags) {
    for (const b of flagBoxes) b.checked = flags.includes(b.value);
  }

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.append(t);
    setTimeout(() => t.remove(), 1600);
  }

  async function copy(text, msg) {
    try {
      await navigator.clipboard.writeText(text);
      toast(msg);
    } catch (_) {
      window.prompt('コピーしてください', text);
    }
  }

  function setupTools() {
    const sel = $('preset');
    PRESETS.forEach((p, n) => {
      const o = document.createElement('option');
      o.value = String(n);
      o.textContent = p.name;
      sel.append(o);
    });
    sel.addEventListener('change', () => {
      const p = PRESETS[Number(sel.value)];
      if (!p) return;
      patternEl.value = p.pattern;
      setFlags(p.flags);
      testEl.value = p.test;
      sel.value = '';
      update();
    });
    $('copy-literal').addEventListener('click', () => {
      if (!lastRe) { toast('正しい正規表現がありません'); return; }
      copy(lastRe.toString(), `${lastRe.toString()} をコピーしました`);
    });
    $('copy-link').addEventListener('click', () => {
      saveToHash(patternEl.value, currentFlags());
      const note = testEl.value.length > 2000 ? '（試す文字列は 2000 文字を超えるので、含めていません）' : '';
      setTimeout(() => copy(location.href, `共有 URL をコピーしました${note}`), 350);
    });
    $('clear').addEventListener('click', () => {
      patternEl.value = '';
      update();
      patternEl.focus();
    });
    patternEl.addEventListener('input', update);
    testEl.addEventListener('input', update);
    flagBoxes.forEach((b) => b.addEventListener('change', update));
  }

  buildPalette();
  setupCustomParts();
  setupTools();
  if (!loadFromHash()) {
    const p = PRESETS[3];
    patternEl.value = p.pattern;
    setFlags(p.flags);
    testEl.value = p.test;
  }
  update();
})();
