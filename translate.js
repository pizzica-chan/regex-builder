/*
 * JavaScript 以外の言語の正規表現を、同じ意味の JavaScript の正規表現（v フラグ）に置き換える。
 * 「試す」の欄と部品の説明の例は、ブラウザの JavaScript で動くので、ここで置き換えてから動かす。
 *
 * - \d \w \s . ^ $ \b などは、その言語での意味（dialects.js）を、文字クラスと先読み・後読みで書き直す
 * - アトミックグループ (?>X) と強欲な繰り返し X*+ は、(?=(X))\n の形で再現する。
 *   このとき増えるグループの番号は groupMap で元の番号に戻す
 * - 置き換えられない書き方は Untranslatable を投げる
 */
(function (global) {
  'use strict';

  class Untranslatable extends Error {}

  const hex = (cp) => cp.toString(16);
  // v フラグの文字クラスの中でも外でも、そのまま書いてよい文字
  const plain = (cp) => (cp >= 0x30 && cp <= 0x39) || (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a) || (cp > 0x7f && cp !== 0x2028 && cp !== 0x2029 && !(cp >= 0x80 && cp <= 0x9f) && !(cp >= 0xd800 && cp <= 0xdfff));
  const lit = (ch) => {
    const cp = ch.codePointAt(0);
    return plain(cp) ? ch : `\\u{${hex(cp)}}`;
  };

  // 大文字と小文字を区別しないときに、同じとみなす文字（1 文字になるものだけ）
  function caseVariants(ch, asciiOnly) {
    if (asciiOnly && !/[A-Za-z]/.test(ch)) return [ch];
    const out = new Set([ch]);
    for (const v of [ch.toLowerCase(), ch.toUpperCase()]) if ([...v].length === 1) out.add(v);
    return [...out];
  }

  // グループの番号ごとに、一致しないまま終わることがあるか（optional）と、グループの終わりの位置（end）
  function groupInfo(ast) {
    const info = new Map();
    (function walk(n, optional) {
      if (!n || typeof n !== 'object') return;
      if (n.type === 'alt') { n.alts.forEach((a) => walk(a, true)); return; }
      if (n.type === 'quant') { walk(n.target, optional || n.min === 0); return; }
      if (n.type === 'group') {
        if (n.index && !info.has(n.index)) info.set(n.index, { optional, end: n.end });
        // 否定の先読み・後読みの中のグループは、一致したあとには残らない
        walk(n.body, optional || n.kind === 'neglookahead' || n.kind === 'neglookbehind');
        return;
      }
      if (n.type === 'seq') n.items.forEach((it) => walk(it, optional));
    })(ast, false);
    return info;
  }

  // 一致しなかったグループを参照するおそれがあるか。参照がグループの終わりより前にある（\1(a) や (a\1)）ときも、
  // 参照する時点ではグループに何も入っていない
  function mayBeUnset(ref, info) {
    const g = info.get(ref.index);
    return !g || g.optional || ref.start < g.end;
  }

  function translate(src, flags, dialect) {
    const RE = global.RegexExplain;
    const D = global.RegexDialects;
    if (dialect === 'js') throw new Error('JavaScript はそのまま動かす');
    const { ast, groupCount } = RE.parse(src, flags, dialect);
    const asciiCase = D.asciiCaseOnly(dialect);
    const forced = D.forcedFlags(dialect);
    const notes = new Set();
    const has = (f) => flags.includes(f) || forced.includes(f);

    // ---------- 1 回目: JavaScript でのグループの番号を決める ----------
    let next = 0;
    const groupMap = new Array(groupCount + 1).fill(null);
    const groups = groupInfo(ast);
    let scopedCase = false;
    (function walk(n) {
      switch (n.type) {
        case 'seq': n.items.forEach((it, k) => {
          // 先頭以外の (?i) や、i を外す指定があると、範囲ごとに大文字と小文字を扱う必要がある
          if (it.type === 'flags' && (k > 0 || n !== ast || /i/.test(it.off)) && /i/.test(it.on + it.off)) scopedCase = true;
          walk(it);
        }); break;
        case 'alt': n.alts.forEach(walk); break;
        case 'quant':
          if (n.possessive) n.jsExtra = ++next;
          walk(n.target);
          break;
        case 'group':
          if (n.kind === 'modifier' && /i/.test(n.modOn + n.modOff)) scopedCase = true;
          if (n.kind === 'atomic') n.jsExtra = ++next;
          if (n.index) {
            n.jsIndex = ++next;
            if (groupMap[n.index] == null) groupMap[n.index] = n.jsIndex;
            else notes.add('同じ名前のグループが 2 つ以上あります。試す欄の表には、最初のグループの値を出します。');
          }
          walk(n.body);
          break;
        default: break;
      }
    })(ast);

    // 大文字と小文字を区別しない指定が全体に同じように効くなら、JavaScript の i フラグに任せる
    const leadingFlags = ast.type === 'seq' && ast.items[0] && ast.items[0].type === 'flags' ? ast.items[0] : null;
    const topI = has('i') || (leadingFlags && leadingFlags.on.includes('i'));
    const useJsI = topI && !scopedCase && !asciiCase;
    if (asciiCase && (topI || scopedCase)) notes.add('Java の大文字と小文字を区別しない指定は、英字（A〜Z、a〜z）だけに効かせています。');

    // ---------- 2 回目: 書き出す ----------
    const wordClass = `[${D.set('word', dialect)}]`;
    const dotEx = D.dotExcludes(dialect);

    function setBody(kind) {
      const base = { digit: 'digit', nondigit: 'digit', word: 'word', nonword: 'word', space: 'space', nonspace: 'space', hspace: 'hspace', nonhspace: 'hspace', vspace: 'vspace', nonvspace: 'vspace' }[kind];
      return { neg: /^non/.test(kind), body: D.set(base, dialect) };
    }

    function anchor(kind, ctx) {
      const java = dialect === 'java';
      const endNl = D.dollarBeforeFinal(dialect);
      const atEnd = '(?![^])';
      // Java は、最後の改行が CRLF のとき、CR と LF の間には一致しない
      const beforeFinal = endNl === 'any'
        ? '(?=(?:\\u{d}\\u{a}|(?<!\\u{d})\\u{a}|[\\u{d}\\u{85}\\u{2028}\\u{2029}])?(?![^]))'
        : endNl === 'nl' ? '(?=\\u{a}?(?![^]))' : atEnd;
      switch (kind) {
        case 'start':
          if (!ctx.m) return '(?<![^])';
          if (java) return '(?:(?<![^])|(?:(?<=[\\u{a}\\u{85}\\u{2028}\\u{2029}])|(?<=\\u{d})(?!\\u{a}))(?=[^]))';
          // PHP とサクラエディタは、文字列が改行で終わるとき、その改行のあと（文字列の末尾）には一致しない
          return D.caretNotAtEnd(dialect) ? '(?:(?<![^])|(?<=\\u{a})(?=[^]))' : '(?:(?<![^])|(?<=\\u{a}))';
        case 'end':
          if (!ctx.m) return beforeFinal;
          return java
            ? '(?=\\u{d}\\u{a}|(?<!\\u{d})\\u{a}|[\\u{d}\\u{85}\\u{2028}\\u{2029}]|(?![^]))'
            : '(?=\\u{a}|(?![^]))';
        case 'strStart': return '(?<![^])';
        case 'strEnd': return atEnd;
        case 'strEndNl': return beforeFinal;
        case 'wordb': return `(?:(?<=${wordClass})(?!${wordClass})|(?<!${wordClass})(?=${wordClass}))`;
        case 'nonwordb': return `(?:(?<=${wordClass})(?=${wordClass})|(?<!${wordClass})(?!${wordClass}))`;
        default: throw new Untranslatable('この位置の部品は、試す欄では動かせません');
      }
    }

    // 大文字と小文字を区別しないで 1 文字を書く（JavaScript の i フラグを使わないとき）
    function charOut(ch, ctx) {
      if (!ctx.i || useJsI) return lit(ch);
      const vs = caseVariants(ch, asciiCase);
      return vs.length > 1 ? `[${vs.map(lit).join('')}]` : lit(ch);
    }

    function classItem(it, ctx) {
      switch (it.type) {
        case 'char':
          if (ctx.i && !useJsI) return caseVariants(it.value, asciiCase).map(lit).join('');
          return lit(it.value);
        case 'range': {
          let out = `${lit(it.from)}-${lit(it.to)}`;
          if (ctx.i && !useJsI) {
            const a = it.from.codePointAt(0);
            const b = it.to.codePointAt(0);
            if (b - a > 5000) {
              notes.add('大きな範囲の文字クラスでは、大文字と小文字の区別を試す欄で再現できないことがあります。');
            } else {
              const extra = new Set();
              for (let cp = a; cp <= b; cp++) {
                for (const v of caseVariants(String.fromCodePoint(cp), asciiCase)) {
                  const vc = v.codePointAt(0);
                  if (vc < a || vc > b) extra.add(v);
                }
              }
              out += [...extra].map(lit).join('');
            }
          }
          return out;
        }
        case 'set': {
          const { neg, body } = setBody(it.kind);
          return neg ? `[^${body}]` : `[${body}]`;
        }
        case 'uprop': return prop(it);
        case 'posix': {
          const body = D.posixToJs(it.name, dialect);
          if (!body) throw new Untranslatable(`POSIX の文字クラス [:${it.name}:] は、試す欄では動かせません`);
          if (dialect !== 'go') notes.add('POSIX の文字クラス（[:alpha:] など）の範囲は、試す欄では近い範囲で動かしています。');
          return it.negate ? `[^${body}]` : `[${body}]`;
        }
        default: throw new Untranslatable('この文字クラスは、試す欄では動かせません');
      }
    }

    function prop(n) {
      const p = D.propToJs(n.value, dialect);
      if (!p) throw new Untranslatable(`\\p{${n.value}} は、試す欄では動かせません`);
      if (p.prop) return `${n.negate ? '\\P' : '\\p'}{${p.prop}}`;
      return n.negate ? `[^${p.range}]` : `[${p.range}]`;
    }

    function quantText(n) {
      let q;
      if (n.min === 0 && n.max === Infinity) q = '*';
      else if (n.min === 1 && n.max === Infinity) q = '+';
      else if (n.min === 0 && n.max === 1) q = '?';
      else if (n.min === n.max) q = `{${n.min}}`;
      else q = n.max === Infinity ? `{${n.min},}` : `{${n.min},${n.max}}`;
      return q + (n.lazy ? '?' : '');
    }

    // 一度一致したら戻って試し直さない部分（アトミックグループと強欲な繰り返し）。
    // 先読みで一致させた文字列をグループ extra に覚え、その文字列を後方参照で読み進める。
    // 後読みの中では右から左へ照らし合わせるので、後読みで覚えてから後方参照を置く
    function noBacktrack(body, extra, ctx) {
      return ctx.behind ? `(?:\\${extra}(?<=(${body})))` : `(?:(?=(${body}))\\${extra})`;
    }

    function withFlags(ctx, on, off) {
      const c = { ...ctx };
      for (const f of off) c[f] = false;
      for (const f of on) c[f] = true;
      return c;
    }

    function emit(n, ctx) {
      switch (n.type) {
        case 'seq': {
          let out = '';
          // 「または」の 2 つ目からの候補には、前の候補に書いた (?i) なども効く
          let c = n.flagsIn ? withFlags(ctx, n.flagsIn.on, n.flagsIn.off) : ctx;
          for (const it of n.items) {
            if (it.type === 'flags') { c = withFlags(c, it.on, it.off); continue; }
            out += emit(it, c);
          }
          return out;
        }
        case 'alt': return n.alts.map((a) => emit(a, ctx)).join('|');
        case 'char': return charOut(n.value, ctx);
        case 'literal': return [...n.value].map((ch) => charOut(ch, ctx)).join('');
        // サクラエディタは、s フラグにかかわらず . を [^\r\n] に置き換えてから渡す
        case 'dot': return ctx.s && dialect !== 'sakura' ? '[^]' : `[^${dotEx}]`;
        case 'set': {
          const { neg, body } = setBody(n.kind);
          return neg ? `[^${body}]` : `[${body}]`;
        }
        case 'uprop': return prop(n);
        case 'class': {
          const body = n.items.map((it) => classItem(it, ctx)).join('');
          return n.negate ? `[^${body}]` : `[${body}]`;
        }
        // PHP とサクラエディタの \R は、CRLF に一致したら CR だけに戻って試し直さない
        case 'linebreak': return D.atomicLinebreak(dialect)
          ? '(?:\\u{d}\\u{a}|\\u{d}(?!\\u{a})|[\\u{a}-\\u{c}\\u{85}\\u{2028}\\u{2029}])'
          : '(?:\\u{d}\\u{a}|[\\u{a}-\\u{d}\\u{85}\\u{2028}\\u{2029}])';
        case 'anchor': return anchor(n.kind, ctx);
        case 'comment': case 'flags': return '';
        case 'backref': {
          if (n.missing) return '(?!)';
          const js = groupMap[n.index];
          if (js == null) throw new Untranslatable('参照しているグループが見つかりません');
          if (ctx.i && !useJsI) notes.add('大文字と小文字を区別しない後方参照は、試す欄では大文字と小文字を区別して比べています。');
          if (mayBeUnset(n, groups)) {
            notes.add('一致しなかったグループを参照すると、この言語では失敗しますが、試す欄では空文字列として一致したものとして扱います。');
          }
          return `(?:\\${js})`;
        }
        case 'group': {
          let c = n.kind === 'modifier' ? withFlags(ctx, n.modOn, n.modOff) : ctx;
          // 後読みの中は、JavaScript が右から左へ照らし合わせる。先読みの中では、また左から右へ照らし合わせる
          if (/lookbehind/.test(n.kind)) c = { ...c, behind: true };
          else if (/lookahead/.test(n.kind)) c = { ...c, behind: false };
          const body = emit(n.body, c);
          switch (n.kind) {
            case 'capture': case 'named': return `(${body})`;
            case 'noncapture': case 'modifier': return `(?:${body})`;
            case 'lookahead': return `(?=${body})`;
            case 'neglookahead': return `(?!${body})`;
            case 'lookbehind': return `(?<=${body})`;
            case 'neglookbehind': return `(?<!${body})`;
            case 'atomic': return noBacktrack(body, n.jsExtra, ctx);
            default: throw new Untranslatable('このグループは、試す欄では動かせません');
          }
        }
        case 'quant': {
          const t = `(?:${emit(n.target, ctx)})${quantText(n)}`;
          return n.possessive ? noBacktrack(t, n.jsExtra, ctx) : t;
        }
        default: throw new Untranslatable('この部品は、試す欄では動かせません');
      }
    }

    const ctx = { i: has('i'), m: has('m'), s: has('s') };
    const source = emit(ast, ctx);
    const jsFlags = `v${useJsI ? 'i' : ''}${flags.includes('g') ? 'g' : ''}`;
    return { source, flags: jsFlags, groupMap, groupCount, notes: [...notes] };
  }

  // 試す文字列の中身によって出す注意
  function textNotes(text, dialect) {
    const D = global.RegexDialects;
    const out = [];
    if (D.codeUnits(dialect) && /[\u{10000}-\u{10ffff}]/u.test(text)) {
      out.push(`${D.get(dialect).name} は絵文字などを 2 文字として数えますが、試す欄では 1 文字として数えます。. や長さの指定を含む一致は、結果が変わることがあります。`);
    }
    return out;
  }

  // ---------- ほかの言語で使うとどうなるか ----------

  // 構文木から、言語によって意味の変わる部品が使われているかを集める
  function usedFeatures(ast, flags) {
    const f = { digit: false, word: false, space: false, dot: false, dollar: false, lineAnchor: false, backref: false, named: false, numbered: false, caseless: flags.includes('i') };
    const groups = groupInfo(ast);
    (function walk(n, ctx) {
      switch (n.type) {
        case 'seq': {
          let c = ctx;
          if (n.flagsIn) {
            const on = n.flagsIn.on;
            c = { ...c, m: c.m || on.includes('m'), s: c.s || on.includes('s') };
          }
          for (const it of n.items) {
            if (it.type === 'flags') { c = { ...c, i: c.i || it.on.includes('i'), m: c.m || it.on.includes('m'), s: c.s || it.on.includes('s') }; if (it.on.includes('i')) f.caseless = true; continue; }
            walk(it, c);
          }
          break;
        }
        case 'alt': n.alts.forEach((a) => walk(a, ctx)); break;
        case 'quant': walk(n.target, ctx); break;
        case 'group':
          if (n.kind === 'named') f.named = true;
          if (n.kind === 'capture') f.numbered = true;
          if (n.kind === 'modifier' && n.modOn.includes('i')) f.caseless = true;
          walk(n.body, n.kind === 'modifier' ? { ...ctx, m: ctx.m || n.modOn.includes('m'), s: ctx.s || n.modOn.includes('s') } : ctx);
          break;
        case 'class': n.items.forEach((it) => walk(it, ctx)); break;
        case 'set':
          if (/digit/.test(n.kind)) f.digit = true;
          if (/word/.test(n.kind)) f.word = true;
          if (/space/.test(n.kind) && !/[hv]space/.test(n.kind)) f.space = true;
          break;
        case 'dot': if (!ctx.s) f.dot = true; break;
        case 'anchor':
          if (n.kind === 'wordb' || n.kind === 'nonwordb') f.word = true;
          if ((n.kind === 'end' && !ctx.m) || n.kind === 'strEndNl') f.dollar = true;
          if ((n.kind === 'start' || n.kind === 'end') && ctx.m) f.lineAnchor = true;
          if ((n.kind === 'start' || n.kind === 'end') && !ctx.m) f.plainAnchor = true;
          break;
        // 参照する時点でいつも一致しているグループなら、どの言語でも結果は同じ
        case 'backref': if (mayBeUnset(n, groups)) f.backref = true; break;
        default: break;
      }
    })(ast, { m: flags.includes('m'), s: flags.includes('s') });
    return f;
  }

  // 位置などの情報を除いた構文木。2 つの言語で同じ読み方をしたかを比べるのに使う
  const IGNORE_KEYS = ['start', 'end', 'qStart', 'parts', 'raw', 'index', 'missing', 'quoted'];
  const CHILD_KEYS = ['items', 'alts', 'body', 'target'];
  function shape(ast) {
    return JSON.stringify(ast, (k, v) => (IGNORE_KEYS.includes(k) ? undefined : v));
  }

  // 2 つの構文木で、最初に読み方の違う部品を探す。子の部品まで同じなら null
  function firstDiff(a, b) {
    const own = (n) => JSON.stringify(n, (k, v) => (IGNORE_KEYS.includes(k) || (k && CHILD_KEYS.includes(k)) ? undefined : v));
    if (!a || !b || own(a) !== own(b)) return a || b;
    for (const k of CHILD_KEYS) {
      const x = a[k];
      const y = b[k];
      if (Array.isArray(x) || Array.isArray(y)) {
        if (!Array.isArray(x) || !Array.isArray(y) || x.length !== y.length) return a;
        for (let i = 0; i < x.length; i++) { const d = firstDiff(x[i], y[i]); if (d) return d; }
      } else if (x || y) {
        const d = firstDiff(x, y);
        if (d) return d;
      }
    }
    return null;
  }

  // JavaScript では書けない部品
  const NOT_IN_JS = { anchor: ['strStart', 'strEnd', 'strEndNl'], group: ['atomic'], type: ['flags', 'comment', 'linebreak'] };

  function hasNotInJs(ast, src) {
    let found = null;
    (function walk(n) {
      if (!n || typeof n !== 'object' || found) return;
      if (n.type === 'anchor' && NOT_IN_JS.anchor.includes(n.kind)) found = `${src.slice(n.start, n.end)} は使えません`;
      else if (n.type === 'group' && n.kind === 'atomic') found = '(?>…)（アトミックグループ）は使えません';
      else if (n.type === 'group' && n.isolated) found = '(?i) のようなフラグの書き方は使えません';
      else if (n.type === 'quant' && n.possessive) found = '*+ のような強欲な繰り返しは使えません';
      else if (NOT_IN_JS.type.includes(n.type)) found = { flags: '(?i) のようなフラグの書き方は使えません', comment: '(?#…) は使えません', linebreak: '\\R は使えません' }[n.type];
      else if (n.type === 'set' && /[hv]space/.test(n.kind)) found = '\\h や \\v（空白の集まり）は使えません';
      else if (n.type === 'posix') found = '[:alpha:] のような POSIX の文字クラスは使えません';
      for (const v of Object.values(n)) {
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') walk(v);
      }
    })(ast);
    return found;
  }

  // from の言語で書いた正規表現を、ほかの各言語で使うとどうなるかを返す。
  // 各要素は { dialect, status: 'same' | 'differs' | 'error', reasons: [...] }
  function portability(src, flags, from) {
    const RE = global.RegexExplain;
    const D = global.RegexDialects;
    const base = RE.parse(src, flags, from);
    const fromFlags = flags + D.forcedFlags(from);
    const used = usedFeatures(base.ast, fromFlags);
    const out = [];
    for (const to of D.ids) {
      if (to === from) continue;
      const reasons = [];
      const name = D.get(to).name;
      const sub = D.subject(to);
      // フラグ。i m s はどの言語にもある。u と y は JavaScript だけ
      const toFlags = [...flags].filter((f) => 'gims'.includes(f) || to === 'js').join('');
      if (from === 'js' && flags.includes('y')) reasons.push('y フラグ（今の位置からだけ探す）に当たるものがありません');
      let parsed;
      try {
        if (to === 'js') {
          const nj = hasNotInJs(base.ast, src);
          if (nj) throw new Error(`JavaScript では ${nj}`);
          try {
            new RegExp(src, toFlags.replace('g', '')); // eslint-disable-line no-new
          } catch (e) {
            // 自前の解析で日本語の説明が作れれば、それを使う
            RE.parse(src, toFlags, 'js');
            throw new Error(`JavaScript では書き方の誤りになります（${e.message}）`);
          }
        }
        parsed = RE.parse(src, toFlags, to);
      } catch (e) {
        const msg = to === 'js' && e instanceof RE.RegexParseError ? `JavaScript では${e.message}` : e.message;
        out.push({ dialect: to, status: 'error', reasons: [msg] });
        continue;
      }
      if (shape(parsed.ast) !== shape(base.ast)) {
        const d = firstDiff(base.ast, parsed.ast);
        const part = d && d.end > d.start ? `「${src.slice(d.start, d.end)}」` : '書き方の一部';
        reasons.push(`${sub}では、${part}が別の意味に読まれます`);
      }
      const toAll = toFlags + D.forcedFlags(to);
      const diff = (a, b) => a !== b;
      const uni = (fn, d) => fn(d);
      if (used.digit && diff(uni(D.unicodeDigit, from), uni(D.unicodeDigit, to))) {
        reasons.push(D.unicodeDigit(to) ? '\\d が全角数字やほかの言語の数字にも一致します' : '\\d が 0〜9 だけに一致します（全角数字には一致しません）');
      }
      if (used.word && diff(uni(D.unicodeWord, from), uni(D.unicodeWord, to))) {
        reasons.push(D.unicodeWord(to) ? '\\w と \\b が、ひらがなや漢字も単語の文字として扱います' : '\\w と \\b が、英数字と _ だけを単語の文字として扱います');
      }
      const fullSpace = (d) => !['java', 'go'].includes(d);
      if (used.space && diff(fullSpace(from), fullSpace(to))) {
        reasons.push(fullSpace(to) ? '\\s が全角スペースにも一致します' : '\\s が全角スペースに一致しません');
      }
      const dotCr = (d) => !D.dotExcludes(d).includes('\\r');
      if (used.dot && diff(dotCr(from), dotCr(to))) {
        reasons.push(dotCr(to) ? '. が CR（\\r）にも一致します' : '. が CR（\\r）に一致しません');
      }
      const beforeFinal = (d) => !!D.dollarBeforeFinal(d);
      if (used.dollar && !toAll.includes('m') && !fromFlags.includes('m') && diff(beforeFinal(from), beforeFinal(to))) {
        reasons.push(beforeFinal(to) ? '$ が、文字列の最後の改行の直前にも一致します' : '$ が、文字列の最後の改行の直前には一致しません');
      }
      const mChanges = toAll.includes('m') !== fromFlags.includes('m');
      if ((used.plainAnchor || used.lineAnchor) && mChanges) {
        reasons.push(toAll.includes('m')
          ? `^ と $ が各行の先頭と末尾に一致します（${sub}では複数行のモードが常に有効）`
          : '^ と $ が、各行ではなく文字列全体の先頭と末尾だけに一致します（m フラグを付けると各行に一致します）');
      }
      if (used.lineAnchor && !mChanges && D.lineBreaks(from) !== D.lineBreaks(to)) {
        reasons.push('複数行のモードで、^ と $ が区切りとみなす改行（CR など）が違います');
      }
      if (used.caseless && diff(D.asciiCaseOnly(from), D.asciiCaseOnly(to))) {
        reasons.push(D.asciiCaseOnly(to) ? '大文字と小文字を区別しない指定が、英字（A〜Z）だけに効きます' : '大文字と小文字を区別しない指定が、英字以外（é と É など）にも効きます');
      }
      if (used.backref && (from === 'js') !== (to === 'js')) {
        reasons.push(to === 'js' ? '一致しなかったグループを参照すると、空文字列として一致します' : '一致しなかったグループを参照すると、その参照は失敗します');
      }
      if (used.named && used.numbered && (from === 'cs') !== (to === 'cs')) {
        reasons.push('名前付きのグループと名前なしのグループを混ぜたときの、グループの番号の付け方が違います');
      }
      out.push({ dialect: to, status: reasons.length ? 'differs' : 'same', reasons });
    }
    return out;
  }

  global.RegexTranslate = { translate, textNotes, portability, Untranslatable };
})(typeof window !== 'undefined' ? window : globalThis);
