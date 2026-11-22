/*
 * JavaScript の正規表現を構文木に分解し、日本語の説明を作る。
 * 外部ライブラリは使わない。v フラグの集合演算には対応しない。
 */
(function (global) {
  'use strict';

  class RegexParseError extends Error {
    constructor(message, pos) {
      super(message);
      this.pos = pos;
    }
  }

  // ---------- 構文解析 ----------

  // u フラグがないときの古い 8進数の書き方を読む。0〜3 で始まれば 3 桁まで、4〜7 なら 2 桁まで
  function readLegacyOctal(digits) {
    const max = /[0-3]/.test(digits[0]) ? 3 : 2;
    let len = 0;
    while (len < max && /[0-7]/.test(digits[len] || '')) len++;
    return { ch: String.fromCharCode(parseInt(digits.slice(0, len), 8)), len };
  }

  // グループの数を超える \N（u フラグなし）を、JavaScript と同じく文字として読む。\8 \9 は数字そのもの
  function legacyBackrefText(raw) {
    if (/^[89]/.test(raw)) return raw;
    const { ch, len } = readLegacyOctal(raw);
    return ch + raw.slice(len);
  }

  function parse(src, flags) {
    let i = 0;
    let groupCount = 0;
    const unicode = flags.includes('u') || flags.includes('v');
    // u フラグがなく、名前付きグループが 1 つもないとき、JavaScript は \k を文字の k として扱う
    const hasNamedGroups = /\(\?<(?![=!])/.test(src);
    const groupNames = [];
    const namedRefs = [];

    const err = (msg, pos = i) => { throw new RegexParseError(msg, pos); };

    // u フラグがないと、JavaScript は絵文字などを 2 つの単位（サロゲート）に分けて扱う。それに合わせて読む
    function readChar() {
      const ch = unicode ? String.fromCodePoint(src.codePointAt(i)) : src[i];
      i += ch.length;
      return ch;
    }

    function readBraceQuant() {
      const m = /^\{(\d+)(?:(,)(\d*))?\}/.exec(src.slice(i));
      if (!m) return null;
      const min = Number(m[1]);
      const max = m[2] ? (m[3] === '' ? Infinity : Number(m[3])) : min;
      return { min, max, len: m[0].length };
    }

    function parseAlt() {
      const start = i;
      const alts = [parseSeq()];
      while (src[i] === '|') {
        i++;
        alts.push(parseSeq());
      }
      if (alts.length === 1) return alts[0];
      return { type: 'alt', alts, start, end: i };
    }

    function parseSeq() {
      const start = i;
      const items = [];
      while (i < src.length && src[i] !== '|' && src[i] !== ')') {
        items.push(parseQuant(parseAtom()));
      }
      return { type: 'seq', items: mergeLiterals(items), start, end: i };
    }

    // 量指定子の付いていない文字が続くところを、1つの文字列にまとめる
    function mergeLiterals(items) {
      const out = [];
      for (const it of items) {
        const prev = out[out.length - 1];
        if (it.type === 'char' && prev && (prev.type === 'char' || prev.type === 'literal')) {
          // parts は、まとめる前の 1 文字ずつの範囲（入力欄の色分けで、エスケープを見分けるのに使う）
          out[out.length - 1] = {
            type: 'literal',
            value: prev.value + it.value,
            parts: [...(prev.parts || [{ start: prev.start, end: prev.end }]), { start: it.start, end: it.end }],
            start: prev.start,
            end: it.end,
          };
        } else {
          out.push(it);
        }
      }
      return out;
    }

    function parseAtom() {
      const start = i;
      const c = src[i];
      if (c === '^') { i++; return { type: 'anchor', kind: 'start', start, end: i }; }
      if (c === '$') { i++; return { type: 'anchor', kind: 'end', start, end: i }; }
      if (c === '.') { i++; return { type: 'dot', start, end: i }; }
      if (c === '(') return parseGroup();
      if (c === '[') return parseClass();
      if (c === '\\') return parseAtomEscape();
      if (c === '*' || c === '+' || c === '?') {
        err(`「${c}」の前に、繰り返す対象がありません`);
      }
      if (c === '{' && readBraceQuant()) {
        err('「{…}」の前に、繰り返す対象がありません');
      }
      return { type: 'char', value: readChar(), start, end: i };
    }

    function parseQuant(atom) {
      const qStart = i;
      let min;
      let max;
      const c = src[i];
      if (c === '*') { min = 0; max = Infinity; i++; }
      else if (c === '+') { min = 1; max = Infinity; i++; }
      else if (c === '?') { min = 0; max = 1; i++; }
      else if (c === '{') {
        const q = readBraceQuant();
        if (!q) return atom;
        ({ min, max } = q);
        i += q.len;
      } else {
        return atom;
      }
      let lazy = false;
      if (src[i] === '?') { lazy = true; i++; }
      return { type: 'quant', min, max, lazy, target: atom, start: atom.start, qStart, end: i };
    }

    function parseGroup() {
      const start = i;
      i++; // (
      let kind = 'capture';
      let name = null;
      let modOn = '';
      let modOff = '';
      const rest = src.slice(i);
      if (rest.startsWith('?:')) { kind = 'noncapture'; i += 2; }
      else if (rest.startsWith('?=')) { kind = 'lookahead'; i += 2; }
      else if (rest.startsWith('?!')) { kind = 'neglookahead'; i += 2; }
      else if (rest.startsWith('?<=')) { kind = 'lookbehind'; i += 3; }
      else if (rest.startsWith('?<!')) { kind = 'neglookbehind'; i += 3; }
      else if (rest.startsWith('?<')) {
        const m = /^\?<([^>]+)>/.exec(rest);
        if (!m) err('グループ名の書き方が正しくありません');
        kind = 'named';
        name = m[1];
        groupNames.push(name);
        i += m[0].length;
      } else if (rest.startsWith('?')) {
        const m = /^\?([ims]*)(?:-([ims]+))?:/.exec(rest);
        if (!m) err('「(?」のあとの書き方が正しくありません');
        kind = 'modifier';
        modOn = m[1];
        modOff = m[2] || '';
        i += m[0].length;
      }
      const index = kind === 'capture' || kind === 'named' ? ++groupCount : null;
      const body = parseAlt();
      if (src[i] !== ')') err('「(」に対応する「)」がありません', start);
      i++;
      return { type: 'group', kind, name, index, modOn, modOff, body, start, end: i };
    }

    function parseAtomEscape() {
      const start = i;
      i++; // バックスラッシュ
      if (i >= src.length) err('最後の「\\」のあとに文字がありません', start);
      const c = src[i];
      if (c === 'b' || c === 'B') {
        i++;
        return { type: 'anchor', kind: c === 'b' ? 'wordb' : 'nonwordb', start, end: i };
      }
      if (/[1-9]/.test(c)) {
        const m = /^\d+/.exec(src.slice(i));
        i += m[0].length;
        return { type: 'backref', index: Number(m[0]), raw: m[0], start, end: i };
      }
      if (c === 'k' && (unicode || hasNamedGroups)) {
        const m = /^k<([^>]+)>/.exec(src.slice(i));
        if (m) {
          i += m[0].length;
          const ref = { type: 'backref', name: m[1], start, end: i };
          namedRefs.push(ref);
          return ref;
        }
      }
      return parseCommonEscape(start, false);
    }

    // 文字クラスの中でも外でも、ほぼ同じ意味になるエスケープ。違うところは inClass で分ける
    function parseCommonEscape(start, inClass) {
      const c = src[i];
      const rest = src.slice(i);
      const sets = { d: 'digit', D: 'nondigit', w: 'word', W: 'nonword', s: 'space', S: 'nonspace' };
      if (sets[c]) { i++; return { type: 'set', kind: sets[c], start, end: i }; }
      const ctrl = { n: '\n', r: '\r', t: '\t', f: '\f', v: '\v' };
      if (ctrl[c]) { i++; return { type: 'char', value: ctrl[c], start, end: i }; }
      if (unicode && c === '0' && !/[0-9]/.test(src[i + 1] || '')) {
        i++;
        return { type: 'char', value: '\0', start, end: i };
      }
      if (!unicode && (c === '0' || (inClass && /[1-7]/.test(c)))) {
        const { ch, len } = readLegacyOctal(src.slice(i));
        i += len;
        return { type: 'char', value: ch, start, end: i };
      }
      let m;
      if (c === 'x' && (m = /^x([0-9a-fA-F]{2})/.exec(rest))) {
        i += m[0].length;
        return { type: 'char', value: String.fromCharCode(parseInt(m[1], 16)), start, end: i };
      }
      if (c === 'u') {
        if (unicode && (m = /^u\{([0-9a-fA-F]+)\}/.exec(rest))) {
          i += m[0].length;
          return { type: 'char', value: String.fromCodePoint(parseInt(m[1], 16)), start, end: i };
        }
        if ((m = /^u([0-9a-fA-F]{4})/.exec(rest))) {
          i += m[0].length;
          return { type: 'char', value: String.fromCharCode(parseInt(m[1], 16)), start, end: i };
        }
      }
      if (c === 'c' && (m = /^c([A-Za-z])/.exec(rest))) {
        i += m[0].length;
        return { type: 'char', value: String.fromCharCode(m[1].charCodeAt(0) % 32), start, end: i };
      }
      if (c === 'c' && !unicode) {
        if (inClass && (m = /^c([0-9_])/.exec(rest))) {
          i += m[0].length;
          return { type: 'char', value: String.fromCharCode(m[1].charCodeAt(0) % 32), start, end: i };
        }
        return { type: 'char', value: '\\', start, end: i }; // i は c の位置のまま
      }
      if ((c === 'p' || c === 'P') && unicode && (m = /^[pP]\{([^}]+)\}/.exec(rest))) {
        i += m[0].length;
        return { type: 'uprop', negate: c === 'P', value: m[1], start, end: i };
      }
      return { type: 'char', value: readChar(), start, end: i };
    }

    function parseClass() {
      const start = i;
      i++; // [
      let negate = false;
      if (src[i] === '^') { negate = true; i++; }
      const items = [];
      while (i < src.length && src[i] !== ']') {
        const a = parseClassAtom();
        if (a.type === 'char' && src[i] === '-' && i + 1 < src.length && src[i + 1] !== ']') {
          const dash = i;
          i++;
          const b = parseClassAtom();
          if (b.type === 'char') {
            items.push({ type: 'range', from: a.value, to: b.value, start: a.start, end: b.end });
          } else {
            items.push(a, { type: 'char', value: '-', start: dash, end: dash + 1 }, b);
          }
          continue;
        }
        items.push(a);
      }
      if (src[i] !== ']') err('「[」に対応する「]」がありません', start);
      i++;
      return { type: 'class', negate, items, start, end: i };
    }

    function parseClassAtom() {
      const start = i;
      if (src[i] === '\\') {
        i++;
        if (i >= src.length) err('最後の「\\」のあとに文字がありません', start);
        if (src[i] === 'b') { i++; return { type: 'char', value: '\b', start, end: i }; }
        return parseCommonEscape(start, true);
      }
      return { type: 'char', value: readChar(), start, end: i };
    }

    const ast = parseAlt();
    if (i < src.length) err('「)」に対応する「(」がありません');
    for (const ref of namedRefs) {
      if (!groupNames.includes(ref.name)) err(`「${ref.name}」という名前のグループがありません`, ref.start);
    }
    return { ast, groupCount };
  }

  // ---------- 説明文の生成 ----------
  //
  // 1 文字に当たる部品（\d、[a-z]、. など）は「何の文字か」を名詞で表し、
  // 量指定子が付いたら「数字が3文字」のように文字数で言う。
  // 位置だけを表す部品（^、$、\b）は、文字と区別できるよう枠で囲んで表示する。

  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  const CHAR_NAMES = {
    ' ': '半角スペース',
    '　': '全角スペース',
    '\n': '改行（LF）',
    '\r': '復帰（CR）',
    '\t': 'タブ',
    '\f': '改ページ',
    '\v': '垂直タブ',
    '\0': 'NUL文字',
    '\b': 'バックスペース',
  };

  function charName(ch) {
    if (CHAR_NAMES[ch]) return CHAR_NAMES[ch];
    const cp = ch.codePointAt(0);
    const hex = cp.toString(16).toUpperCase().padStart(4, '0');
    if (cp < 0x20 || cp === 0x7f) return `制御文字 U+${hex}`;
    if (ch.length === 1 && cp >= 0xd800 && cp <= 0xdfff) {
      return `絵文字などの片割れ U+${hex}（u フラグがないと、1文字が2つに分かれる）`;
    }
    return null;
  }

  function charHtml(ch) {
    const name = charName(ch);
    return name ? `<span class="x-name">${name}</span>` : `<code class="x-lit">${esc(ch)}</code>`;
  }

  // 文字列のうち、名前で示す文字（スペースや改行）だけを分けて表示する
  function stringHtml(s) {
    let html = '';
    let buf = '';
    for (const ch of s) {
      if (charName(ch)) {
        if (buf) { html += `<code class="x-lit">${esc(buf)}</code>`; buf = ''; }
        html += charHtml(ch);
      } else {
        buf += ch;
      }
    }
    if (buf) html += `<code class="x-lit">${esc(buf)}</code>`;
    return html;
  }

  const pos = (text) => `<span class="x-pos">${text}</span>`;
  const UNDERSCORE = '<code class="x-lit">_</code>';

  // \d などを単独で使ったときの名詞
  const SET_NOUN = {
    digit: '数字（0〜9）',
    nondigit: '数字以外の文字',
    word: `英数字か ${UNDERSCORE}`,
    nonword: `英数字と ${UNDERSCORE} 以外の文字`,
    space: '空白（スペース・タブ・改行など）',
    nonspace: '空白以外の文字',
  };

  // [...] の中で並べるときの名詞
  const SET_ITEM = {
    digit: '数字（0〜9）',
    nondigit: '数字以外',
    word: `英数字と ${UNDERSCORE}`,
    nonword: `英数字と ${UNDERSCORE} 以外`,
    space: '空白',
    nonspace: '空白以外',
  };

  const RANGE_NAMES = {
    'a-z': '英小文字',
    'A-Z': '英大文字',
    '0-9': '数字',
    'a-f': '16進数の英小文字',
    'A-F': '16進数の英大文字',
    'ぁ-ん': 'ひらがな',
    'ぁ-ゖ': 'ひらがな',
    'ァ-ン': 'カタカナ',
    'ァ-ヶ': 'カタカナ',
    'ァ-ヴ': 'カタカナ',
    '一-龠': '漢字（よく使う範囲）',
    '一-龯': '漢字（よく使う範囲）',
    '一-鿿': '漢字（CJK統合漢字）',
    '０-９': '全角数字',
    'Ａ-Ｚ': '全角英大文字',
    'ａ-ｚ': '全角英小文字',
  };

  const UPROP_NAMES = {
    L: 'あらゆる言語の文字',
    Letter: 'あらゆる言語の文字',
    Lu: '大文字',
    Ll: '小文字',
    N: '数字（全角や他の言語の数字を含む）',
    Nd: '10進数の数字',
    P: '句読点',
    S: '記号',
    Emoji: '絵文字',
    'Script=Hiragana': 'ひらがな',
    'Script=Katakana': 'カタカナ',
    'Script=Han': '漢字',
    'Script=Latin': 'ラテン文字',
  };

  function upropNoun(node) {
    const key = node.value.replace(/^(?:sc|Script_Extensions|scx)=/, 'Script=');
    const base = UPROP_NAMES[key] || `Unicode の性質「${esc(node.value)}」を持つ文字`;
    return node.negate ? `${base}以外の文字` : base;
  }

  function classItemHtml(it) {
    if (it.type === 'range') {
      const name = RANGE_NAMES[`${it.from}-${it.to}`];
      const range = `${charHtml(it.from)}〜${charHtml(it.to)}`;
      return name ? `${name}（${range}）` : range;
    }
    if (it.type === 'set') return SET_ITEM[it.kind];
    if (it.type === 'uprop') return upropNoun(it);
    return charHtml(it.value);
  }

  function classNoun(node, ctx) {
    if (node.items.length === 0) {
      return node.negate ? anyCharNoun(true) : '存在しない文字（[] はどの文字にも一致しない）';
    }
    const parts = node.items.map(classItemHtml);
    if (node.negate) return `${parts.join('、')} 以外の文字`;
    if (parts.length === 1) {
      const it = node.items[0];
      const unnamedRange = it.type === 'range' && !RANGE_NAMES[`${it.from}-${it.to}`];
      return unnamedRange ? `${parts[0]} のどれか` : parts[0];
    }
    return `${parts.join('、')} のどれか`;
  }

  function anyCharNoun(withNewline) {
    return withNewline ? '任意の文字（改行も含む）' : '任意の文字（改行以外）';
  }

  // 1 文字に当たる部品なら、その文字を表す名詞を返す。違えば null
  function singleNoun(node, ctx) {
    switch (node.type) {
      case 'char': return charHtml(node.value);
      case 'set': return SET_NOUN[node.kind];
      case 'dot': return anyCharNoun(ctx.flags.includes('s'));
      case 'class': return classNoun(node, ctx);
      case 'uprop': return upropNoun(node);
      default: return null;
    }
  }

  function anchorName(node, ctx) {
    const unit = ctx.flags.includes('m') ? '行' : '文字列';
    switch (node.kind) {
      case 'start': return `${unit}の先頭`;
      case 'end': return `${unit}の末尾`;
      case 'wordb': return '単語の区切り';
      default: return '単語の区切りではない位置';
    }
  }

  function anchorTree(node, ctx) {
    const name = pos(anchorName(node, ctx));
    switch (node.kind) {
      case 'wordb': return `ここが ${name}（英数字・${UNDERSCORE} と、それ以外の文字との境目）`;
      case 'nonwordb': return `ここは ${pos('単語の区切り')} ではない`;
      default: return `ここが ${name}`;
    }
  }

  function backrefText(node, ctx) {
    if (node.name != null) {
      return `グループ「${esc(node.name)}」と同じ文字列（そこで一致した内容がもう一度現れる）`;
    }
    if (node.index > ctx.groupCount) {
      // u フラグがないと、JavaScript はこれをグループの参照ではなく、8進数の文字コードか数字そのものとして読む
      return ctx.flags.includes('u')
        ? `グループ${node.index}と同じ文字列（ただし、グループ${node.index}はありません）`
        : `${stringHtml(legacyBackrefText(node.raw))} という文字列（グループ${node.index}はないので、\\${node.raw} はグループの参照ではなく、8進数の文字コードや数字として読まれる）`;
    }
    return `グループ${node.index}と同じ文字列（そこで一致した内容がもう一度現れる）`;
  }

  // 回数の言い方。unit は「文字」か「回」
  function countText(min, max, unit) {
    if (min === 0 && max === 1) return `1${unit}`;
    if (min === max) return `${min}${unit}`;
    if (max === Infinity) return `${min}${unit}以上`;
    return `${min}〜${max}${unit}`;
  }

  // 回数のあとに添える補足。0 回を許すときと、最短一致のとき
  function quantNote(node, withOptional = true) {
    if (node.max === 0) return '（0回なので、何もないのと同じ）';
    const notes = [];
    if (withOptional && node.min === 0) notes.push('なくてもよい');
    if (node.lazy) notes.push('できるだけ短く');
    return notes.length ? `（${notes.join('・')}）` : '';
  }

  const FLAG_WORDS = {
    i: '大文字と小文字を区別しない',
    m: '^ と $ を各行の先頭と末尾にする',
    s: '. を改行にも一致させる',
  };

  // (?i:...) や (?-s:...) の中で使うフラグ
  function innerCtx(node, ctx) {
    if (node.kind !== 'modifier') return ctx;
    let flags = ctx.flags;
    for (const f of node.modOff) flags = flags.replace(f, '');
    for (const f of node.modOn) if (!flags.includes(f)) flags += f;
    return { ...ctx, flags };
  }

  const LOOK_NOTE = '（確かめるだけで、一致した文字列には含めない）';

  function groupLabel(node) {
    switch (node.kind) {
      case 'capture': return `グループ${node.index}（一致した部分を、あとで番号で取り出せる）`;
      case 'named': return `グループ${node.index}「${esc(node.name)}」（一致した部分を、あとで名前で取り出せる）`;
      case 'noncapture': return '次をひとまとめにする（取り出しはしない）';
      case 'lookahead': return `すぐ後ろに次が続くこと${LOOK_NOTE}`;
      case 'neglookahead': return `すぐ後ろに次が続かないこと${LOOK_NOTE}`;
      case 'lookbehind': return `すぐ前に次があること${LOOK_NOTE}`;
      case 'neglookbehind': return `すぐ前に次がないこと${LOOK_NOTE}`;
      case 'modifier': {
        const parts = [];
        for (const f of node.modOn) parts.push(FLAG_WORDS[f]);
        for (const f of node.modOff) parts.push(`「${FLAG_WORDS[f]}」をやめる`);
        return `この中だけ、${parts.join('、')}`;
      }
      default: return 'グループ';
    }
  }

  const EMPTY = '何もない（空でも一致する）';

  function bodyChildren(body, ctx) {
    if (body.type === 'seq') {
      if (body.items.length === 0) return [{ html: EMPTY, start: body.start, end: body.end }];
      return body.items.map((n) => describe(n, ctx));
    }
    return [describe(body, ctx)];
  }

  // 子を持たない要素の、木での説明
  function leafTree(node, ctx) {
    switch (node.type) {
      case 'char': return `${charHtml(node.value)} という文字`;
      case 'literal': return `${stringHtml(node.value)} という文字列`;
      case 'anchor': return anchorTree(node, ctx);
      case 'backref': return backrefText(node, ctx);
      default: {
        const noun = singleNoun(node, ctx);
        return noun ? `${noun}が1文字` : null;
      }
    }
  }

  // 説明の木を作る。各要素は { html, start, end, children, listType }
  function describe(node, ctx) {
    const leaf = leafTree(node, ctx);
    if (leaf != null) return { html: leaf, start: node.start, end: node.end };
    const base = { start: node.start, end: node.end };

    switch (node.type) {
      case 'seq':
        if (node.items.length === 0) return { ...base, html: EMPTY };
        if (node.items.length === 1) return describe(node.items[0], ctx);
        return {
          ...base,
          html: '次の並び',
          children: node.items.map((n) => describe(n, ctx)),
          listType: 'steps',
        };
      case 'alt':
        return {
          ...base,
          html: '次のどれか',
          children: node.alts.map((a) => describe(a, ctx)),
          listType: 'alt',
        };
      case 'group':
        return {
          ...base,
          html: groupLabel(node),
          children: bodyChildren(node.body, innerCtx(node, ctx)),
          listType: 'steps',
        };
      case 'quant':
        return describeQuant(node, ctx);
      default:
        return { ...base, html: esc(node.type) };
    }
  }

  function describeQuant(node, ctx) {
    const base = { start: node.start, end: node.end };
    const t = node.target;

    const noun = singleNoun(t, ctx);
    if (noun) return { ...base, html: `${noun}が${countText(node.min, node.max, '文字')}${quantNote(node)}` };

    const optional = node.min === 0 && node.max === 1;
    const verb = optional ? 'あってもなくてもよい' : `${countText(node.min, node.max, '回')}繰り返す`;
    const lazy = quantNote(node, !optional);

    if (t.type === 'backref' || t.type === 'anchor') {
      return { ...base, html: `${leafTree(t, ctx)}を${verb}${lazy}` };
    }
    // (?:...) は「ひとまとめにする」を挟まず、中身を直接並べる
    if (t.type === 'group' && t.kind === 'noncapture') {
      return {
        ...base,
        html: optional ? `次の並びは${verb}${lazy}` : `次の並びを${verb}${lazy}`,
        children: bodyChildren(t.body, ctx),
        listType: 'steps',
      };
    }
    return {
      ...base,
      html: optional ? `次は${verb}${lazy}` : `次を${verb}${lazy}`,
      children: [describe(t, ctx)],
    };
  }

  // ---------- 1 行の要約 ----------

  const ARROW = '<span class="x-arrow">→</span>';
  const OR = '<span class="x-or">または</span>';

  // 2 つ以上の部品が並ぶ候補を含む「または」は、要約では中身を書かずに数だけ言う。中身は「くわしく」で見る
  const isComplexAlt = (alt) => alt.alts.some((a) => a.type === 'seq' && a.items.length > 1);
  const altCount = (alt) => `${alt.alts.length}通りの並びのどれか`;

  // 「または」で並べる。2 つ以上の部品が並ぶ候補は（ ）で囲み、どこまでが 1 つの候補かを示す
  function altChain(alt, ctx) {
    if (isComplexAlt(alt)) return altCount(alt);
    return alt.alts.map((a) => {
      const text = short(a, ctx);
      return a.type === 'seq' && a.items.length > 1 ? `（${text}）` : text;
    }).join(` ${OR} `);
  }

  // 先読み・後読みの要約。中身が 1 文字なら「すぐ前が数字ではない」のように言う
  function lookShort(node, inner, ctx) {
    const b = node.body;
    const one = b.type === 'seq' && b.items.length === 1 ? b.items[0] : b;
    const noun = singleNoun(one, ctx);
    const side = node.kind.endsWith('ahead') ? 'すぐ後ろ' : 'すぐ前';
    const neg = node.kind.startsWith('neg');
    if (noun) return `〔${side}が ${noun}${neg ? ' ではない' : ''}〕`;
    if (side === 'すぐ後ろ') return `〔すぐ後ろに ${inner} が${neg ? '続かない' : '続く'}〕`;
    return `〔すぐ前に ${inner} が${neg ? 'ない' : 'ある'}〕`;
  }

  function short(node, ctx) {
    switch (node.type) {
      case 'char': return charHtml(node.value);
      case 'literal': return stringHtml(node.value);
      case 'anchor': return pos(anchorName(node, ctx));
      case 'backref':
        if (node.name != null) return `グループ「${esc(node.name)}」と同じ文字列`;
        if (node.index > ctx.groupCount && !ctx.flags.includes('u')) return stringHtml(legacyBackrefText(node.raw));
        return `グループ${node.index}と同じ文字列`;
      case 'seq':
        return node.items.length ? node.items.map((n) => short(n, ctx)).join(` ${ARROW} `) : '何もない';
      case 'alt':
        return `［${altChain(node, ctx)}］`;
      case 'group': {
        // 中身が「または」だけなら、括弧を二重にしない
        const ictx = innerCtx(node, ctx);
        const inner = node.body.type === 'alt' ? altChain(node.body, ictx) : short(node.body, ictx);
        switch (node.kind) {
          case 'capture': return `［グループ${node.index}: ${inner}］`;
          case 'named': return `［${esc(node.name)}: ${inner}］`;
          case 'lookahead':
          case 'neglookahead':
          case 'lookbehind':
          case 'neglookbehind':
            return lookShort(node, inner, ctx);
          default: return `［${inner}］`;
        }
      }
      case 'quant': {
        const noun = singleNoun(node.target, ctx);
        if (noun) return `${noun}が${countText(node.min, node.max, '文字')}${quantNote(node)}`;
        return node.min === 0 && node.max === 1
          ? `${short(node.target, ctx)}${quantNote(node)}`
          : `${short(node.target, ctx)}を${countText(node.min, node.max, '回')}繰り返す${quantNote(node)}`;
      }
      default: {
        const noun = singleNoun(node, ctx);
        return noun ? `${noun}が1文字` : esc(node.type);
      }
    }
  }

  // 先頭と末尾の ^ $ を「どこに一致するか」の文に移し、残りを 1 つずつの手順（steps）にする。
  // 各手順は { html, start, end }。listType が 'alt' なら「または」で並ぶ候補、'steps' なら順に並ぶ部品
  function summarize(ast, ctx) {
    const unit = ctx.flags.includes('m') ? '行' : '文字列';
    const step = (n, html) => ({ html, start: n.start, end: n.end });
    if (ast.type !== 'seq') {
      return {
        scope: `${unit}の中から、次のどれかに一致する部分を探します。`,
        listType: 'alt',
        steps: ast.alts.map((a) => step(a, a.type === 'seq' && !a.items.length ? '何もない' : short(a, ctx))),
      };
    }
    let items = ast.items;
    const isAnchor = (n, kind) => n && n.type === 'anchor' && n.kind === kind;
    const head = isAnchor(items[0], 'start');
    if (head) items = items.slice(1);
    const tail = isAnchor(items[items.length - 1], 'end');
    if (tail) items = items.slice(0, -1);
    // 文字だけの手順は、1 行で見ても文字だと分かるよう「という文字」を付ける
    const steps = items.map((n) => step(n, short(n, ctx) + (n.type === 'char' || n.type === 'literal' ? ' という文字' : '')));

    let scope;
    if (!items.length) {
      if (head && tail) scope = `空の${unit}にだけ一致します。`;
      else if (head) scope = `${unit}の先頭の位置に一致します（文字は含みません）。`;
      else if (tail) scope = `${unit}の末尾の位置に一致します（文字は含みません）。`;
      else scope = '空の正規表現です。どの位置にも、長さ 0 で一致します。';
    } else if (head && tail) {
      scope = `${unit}全体が次の並びになっているときに一致します。`;
    } else if (head) {
      scope = `${unit}の先頭から始まる、次の並びに一致します。`;
    } else if (tail) {
      scope = `${unit}の末尾で終わる、次の並びに一致します。`;
    } else {
      scope = `${unit}の中から、次の並びに一致する部分を探します。`;
    }
    return { scope, listType: 'steps', steps };
  }

  const FLAG_TEXT = {
    g: 'すべての一致を探す（最初の1つで止めない）',
    i: '大文字と小文字を区別しない',
    m: '^ と $ を、文字列全体ではなく各行の先頭と末尾として扱う',
    s: '. を改行にも一致させる',
    u: 'Unicode モードにする（\\p{…} などが使え、絵文字のような文字も1文字として数える）',
    y: '調べ始める位置（最初は先頭、続けて調べるときは前回の一致の終わり）でだけ一致を調べ、その先は探さない',
    d: '一致した位置の詳しい情報を記録する',
  };

  // ---------- 入力欄の色分け ----------

  // 構文木から、色分けする範囲 [開始, 終了, 種類] の一覧を作る。種類は app.js と style.css の tok-* と同じ名前
  function tokens(ast) {
    const out = [];
    const add = (start, end, kind) => { if (end > start) out.push([start, end, kind]); };
    (function walk(n, depth) {
      switch (n.type) {
        case 'alt':
          n.alts.forEach((a, k) => {
            walk(a, depth);
            if (k < n.alts.length - 1) add(a.end, a.end + 1, 'alt');
          });
          break;
        case 'seq': n.items.forEach((it) => walk(it, depth)); break;
        case 'quant':
          walk(n.target, depth);
          add(n.qStart, n.end, 'quant');
          break;
        case 'group': {
          const kind = n.kind.includes('look') ? 'look' : `group${depth % 3}`;
          add(n.start, n.body.start, kind);
          walk(n.body, depth + 1);
          add(n.end - 1, n.end, kind);
          break;
        }
        case 'class': case 'set': case 'uprop': case 'dot': add(n.start, n.end, 'class'); break;
        case 'anchor': add(n.start, n.end, 'anchor'); break;
        case 'backref': add(n.start, n.end, 'ref'); break;
        case 'char': if (n.end - n.start > 1) add(n.start, n.end, 'esc'); break;
        case 'literal':
          // まとめた文字列の中の \. などのエスケープにも色を付ける
          for (const part of n.parts || []) if (part.end - part.start > 1) add(part.start, part.end, 'esc');
          break;
        default: break;
      }
    })(ast, 0);
    return out;
  }

  function explain(src, flags) {
    const { ast, groupCount } = parse(src, flags);
    const ctx = { flags, groupCount };
    let tree;
    if (ast.type === 'seq') {
      tree = ast.items.length
        ? ast.items.map((n) => describe(n, ctx))
        : [{ html: '空の正規表現（どの位置にも、長さ 0 で一致する）', start: 0, end: 0 }];
    } else {
      tree = [describe(ast, ctx)];
    }
    return {
      tree,
      summary: summarize(ast, ctx),
      groupCount,
      flags: [...flags].filter((f) => FLAG_TEXT[f]).map((f) => ({ flag: f, text: FLAG_TEXT[f] })),
    };
  }

  global.RegexExplain = { parse, explain, tokens, RegexParseError, escapeHtml: esc };
})(window);
