/*
 * テスト文字列との一致を調べる処理。ワーカー（match-worker.js）と画面（app.js）の両方から使う。
 * 結果は構造化複製（ワーカーとの受け渡し）できる形にする。
 */
(function (global) {
  'use strict';

  // ranges は各グループの [開始, 終了]。一致しなかったグループは null。
  // groupMap を渡すと、元の正規表現のグループ番号（1 から）に並べ直す。
  // JavaScript 以外の言語を置き換えて動かすとき、グループが増えたり番号がずれたりするため（translate.js）
  function pack(m, groupMap) {
    const order = groupMap ? groupMap.slice(1) : null;
    const pick = (arr, fallback) => (order ? order.map((j) => (j == null ? fallback : arr[j])) : arr.slice(1));
    return {
      index: m.index,
      text: m[0],
      groups: pick(m, undefined),
      ranges: m.indices ? pick(m.indices, null).map((r) => r || null) : null,
    };
  }

  // d フラグを足して、グループの位置も取る。d フラグが使えない環境では位置なしで調べる
  function compile(source, flags) {
    if (!flags.includes('d')) {
      try { return new RegExp(source, flags + 'd'); } catch (_) { /* 下で作り直す */ }
    }
    return new RegExp(source, flags);
  }

  // 長さ 0 の一致のあとの探し方は、言語によって違う（emptyMode）。
  // '': JavaScript と同じく、1 文字進めて探す（Java、C#、サクラエディタも同じ）
  // 'retry': Python と PHP。同じ位置から長さ 1 以上の一致を探し、なければ 1 文字進める（a?? は a にも一致する）
  // 'skip': Go。前の一致のすぐあとの長さ 0 の一致は数えない（x* を axx に使うと、末尾の空の一致はない）
  function findAllEmptyAware(re, source, flags, text, max, groupMap, emptyMode) {
    const matches = [];
    const unicode = re.unicode || re.unicodeSets;
    let prevEnd = -1;
    let m;
    re.lastIndex = 0;
    while (matches.length < max && (m = re.exec(text))) {
      if (m[0] !== '') {
        matches.push(pack(m, groupMap));
        prevEnd = re.lastIndex;
        continue;
      }
      const at = m.index;
      if (!(emptyMode === 'skip' && at === prevEnd)) matches.push(pack(m, groupMap));
      prevEnd = at;
      if (emptyMode === 'retry' && matches.length < max) {
        // 終わりの位置が at より後ろであること（長さ 1 以上）を、後読みで確かめる。
        // u と v フラグでは [^] が絵文字などを 1 文字と数えるので、at までの文字数をコードポイントで数える
        const before = unicode ? [...text.slice(0, at)].length : at;
        const ne = compile(`(?:${source})(?<=[^]{${before + 1}})`, `${flags.replace(/[gy]/g, '')}y`);
        ne.lastIndex = at;
        const n = ne.exec(text);
        if (n && n[0] !== '') {
          matches.push(pack(n, groupMap));
          prevEnd = ne.lastIndex;
          re.lastIndex = ne.lastIndex;
          continue;
        }
      }
      const step = unicode && text.codePointAt(at) > 0xffff ? 2 : 1;
      re.lastIndex = at + step;
      if (re.lastIndex > text.length) break;
    }
    return matches;
  }

  // ---------- POSIX（GNU grep）の一致 ----------
  // program は translate.js の buildProgram が組み立てた状態機械。1 行ずつ、いちばん左で、いちばん長い一致を探す。
  // grep と同じく、長さ 0 の一致は出さずに 1 文字進めて探し直す。グループの位置は、見つけた範囲に終わりをそろえて、
  // JavaScript の正規表現（source）で求める
  function posixMatcher(program) {
    const { states } = program;
    const tests = states.map((st) => (st.t === 'c' ? new RegExp(`^(?:${st.re})$`, program.flags) : null));
    const word = new RegExp(`^${program.word}$`, 'v');
    const isWord = (ch) => ch !== undefined && word.test(ch);
    function assert(k, chars, p) {
      const prev = chars[p - 1];
      const next = chars[p];
      switch (k) {
        case 'start': case 'strStart': return p === 0;
        case 'end': case 'strEnd': return p === chars.length;
        case 'wordb': return isWord(prev) !== isWord(next);
        case 'nonwordb': return isWord(prev) === isWord(next);
        case 'wordStart': return !isWord(prev) && isWord(next);
        case 'wordEnd': return isWord(prev) && !isWord(next);
        default: return false;
      }
    }
    if (program.refs) return refMatcher(program, tests, assert);
    // chars の from 文字目から探し、いちばん左の始まりと、そこからいちばん長い終わりを { start, end } で返す（文字の番号）
    return function longest(chars, from) {
      let best = null;
      let list = [];
      let seen = new Map(); // 状態 → いちばん左の始まり（同じ状態なら、始まりが左のものだけを残す）
      const addThread = (into, seenMap, st, start, p) => {
        const old = seenMap.get(st);
        if (old !== undefined && old <= start) return;
        seenMap.set(st, start);
        const s = states[st];
        if (s.t === 's') { addThread(into, seenMap, s.a, start, p); addThread(into, seenMap, s.b, start, p); }
        else if (s.t === 'a') { if (assert(s.k, chars, p)) addThread(into, seenMap, s.next, start, p); }
        else if (s.t === 'm') { if (!best || start < best.start || (start === best.start && p > best.end)) best = { start, end: p }; }
        else into.push({ st, start });
      };
      for (let p = from; p <= chars.length; p++) {
        if (!best) addThread(list, seen, program.start, p, p);
        if (best) list = list.filter((th) => th.start <= best.start);
        if (p === chars.length || (!list.length && best)) break;
        const next = [];
        const nextSeen = new Map();
        for (const th of list) {
          // 同じ状態に、あとから始まりが左のものが来たら、右のものは捨てる
          if (seen.get(th.st) !== th.start) continue;
          const s = states[th.st];
          if (tests[th.st].test(chars[p])) addThread(next, nextSeen, s.next, th.start, p + 1);
        }
        list = next;
        seen = nextSeen;
      }
      return best;
    };
  }

  // 後方参照がある状態機械（translate.js の program.refs）。始まりの位置ごとに、すべての道筋を試して、いちばん長い終わりを探す。
  // 道筋は「状態・位置・グループに一致した範囲」で区別し、同じものは 1 度だけ調べる。調べる数が REF_BUDGET を超えたら、例外を投げる
  const REF_BUDGET = 200000;
  function refMatcher(program, tests, assert) {
    const { states } = program;
    // 後方参照で参照されるグループだけを、道筋の区別に使う
    const used = [...new Set(states.filter((st) => st.t === 'b').map((st) => st.k))];
    // 大文字と小文字を区別しないときの比べ方。1 文字の大文字にして同じなら同じ（translate.js の posixUpper と同じ決まり）。
    // glibc が知らない文字（program.unknown）は、ほかの文字と同じにならない
    const unknown = program.unknown ? new RegExp(`[${program.unknown}]`, 'v') : null;
    const known = (c) => !unknown || !unknown.test(c);
    const keyCache = new Map();
    const key = (c) => {
      if (!keyCache.has(c)) {
        let k = c;
        if (known(c)) {
          const u = c.toUpperCase();
          const l = c.toLowerCase();
          // 大文字が 2 文字以上になる文字（ᾀ）は、小文字で比べる（ᾀ と ᾈ が同じになる）
          if ([...u].length === 1) k = known(u) ? u : c;
          else if ([...l].length === 1 && known(l)) k = `+${l}`;
        }
        keyCache.set(c, k);
      }
      return keyCache.get(c);
    };
    const same = program.fold ? (a, b) => a === b || key(a) === key(b) : (a, b) => a === b;
    return function longest(chars, from) {
      for (let start = from; start <= chars.length; start++) {
        let best = -1;
        const ends = new Set();
        let steps = 0;
        const seen = new Set();
        // caps: グループ k の [始まり, 終わり]。open: グループ k の、閉じていない始まり。再帰ではなくスタックで調べる
        const stack = [[program.start, start, {}, {}]];
        while (stack.length) {
          const [st, p, caps, open] = stack.pop();
          const id = `${st},${p},${used.map((k) => `${caps[k] ? caps[k].join(':') : '-'}/${open[k] ?? '-'}`).join(',')}`;
          if (seen.has(id)) continue;
          seen.add(id);
          if (++steps > REF_BUDGET) throw new Error('posix-ref-budget');
          const s = states[st];
          switch (s.t) {
            case 'm': ends.add(p); break;
            case 's': stack.push([s.b, p, caps, open], [s.a, p, caps, open]); break;
            case 'a': if (assert(s.k, chars, p)) stack.push([s.next, p, caps, open]); break;
            case 'c': if (p < chars.length && tests[st].test(chars[p])) stack.push([s.next, p + 1, caps, open]); break;
            case 'gs': stack.push([s.next, p, caps, { ...open, [s.k]: p }]); break;
            case 'ge': stack.push([s.next, p, { ...caps, [s.k]: [open[s.k], p] }, open]); break;
            case 'b': {
              const g = caps[s.k];
              if (!g) break; // 一致していないグループの参照は失敗する
              const len = g[1] - g[0];
              if (p + len > chars.length) break;
              let ok = true;
              for (let k = 0; k < len && ok; k++) ok = same(chars[g[0] + k], chars[p + k]);
              if (ok) stack.push([s.next, p + len, caps, open]);
              break;
            }
            default:
          }
        }
        for (const e of ends) if (e > best) best = e;
        if (best >= 0) return { start, end: best };
      }
      return null;
    };
  }

  function findAllPosix(program, source, flags, text, max, lines, groupMap) {
    const longest = posixMatcher(program);
    // grep は、一致する行を選ぶときと、選んだ行の中で一致の位置を求めるときで、大文字と小文字の決まりが少し違う（translate.js の posix-line）。
    // filter があれば、filter で一致しない行は飛ばす
    const lineOk = program.filter ? posixMatcher(program.filter) : null;
    const global = flags.includes('g');
    const matches = [];
    const lineList = text.split('\n');
    let offset = 0; // 行の始まりの位置（UTF-16）
    for (const line of lineList) {
      if (matches.length >= max || (!global && matches.length)) break;
      const chars = [...line];
      const units = [0]; // 文字の番号 → UTF-16 の位置
      for (const ch of chars) units.push(units[units.length - 1] + ch.length);
      let p = lineOk && !lineOk(chars, 0) ? chars.length + 1 : 0;
      while (p <= chars.length && matches.length < max) {
        const m = longest(chars, p);
        if (!m) break;
        if (m.end === m.start) { p = m.start + 1; continue; }
        matches.push(posixPack(source, flags, line, units[m.start], units[m.end], offset, groupMap));
        if (!global) break;
        p = m.end;
      }
      offset += line.length + 1;
    }
    let lineHits = null;
    // 行ごとの判定: filter で行を選び、後方参照があるときは、さらに一致があるかを確かめる（filter は後方参照を何にでも一致させる）
    if (lines) {
      lineHits = lines.map((line) => {
        const chars = [...line];
        if (lineOk && !lineOk(chars, 0)) return false;
        return lineOk && !program.refs ? true : !!longest(chars, 0);
      });
    }
    return { matches, lineHits };
  }

  // 見つけた範囲（行の中の UTF-16 の位置 s〜e）のグループを、JavaScript の正規表現で求める
  function posixPack(source, flags, line, s, e, offset, groupMap) {
    let m = null;
    try {
      const re = compile(`(?:${source})(?<=^[^]{${[...line.slice(0, e)].length}})`, `${flags.replace(/[gy]/g, '')}y`);
      re.lastIndex = s;
      m = re.exec(line);
    } catch (_) { /* グループの位置なしで返す */ }
    if (!m || m.index !== s || m[0].length !== e - s) {
      return { index: offset + s, text: line.slice(s, e), groups: [], ranges: null };
    }
    const packed = pack(m, groupMap);
    packed.index = offset + s;
    if (packed.ranges) packed.ranges = packed.ranges.map((r) => (r ? [r[0] + offset, r[1] + offset] : null));
    return packed;
  }

  // サクラエディタ本体の探し方（v2.4.2 の CSearchAgent::SearchWord）。1 行ずつ、行末の改行（CRLF、LF、CR）を含めた文字列で探す。
  // 探し始める位置は行末の改行の前までに限る。長さ 0 の一致のあとは 1 文字（サロゲートペアは 2 単位）進める
  function findAllPerLine(source, flags, text, max, groupMap) {
    const re = compile(source, flags.includes('g') ? flags : `${flags}g`);
    const global = flags.includes('g');
    const matches = [];
    for (const lm of text.matchAll(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g)) {
      const line = lm[0];
      const content = line.replace(/(?:\r\n|\r|\n)$/, '').length;
      let pos = 0;
      while (pos <= content && matches.length < max) {
        re.lastIndex = pos;
        const m = re.exec(line);
        if (!m) break;
        const packed = pack(m, groupMap);
        packed.index += lm.index;
        if (packed.ranges) packed.ranges = packed.ranges.map((r) => (r ? [r[0] + lm.index, r[1] + lm.index] : null));
        matches.push(packed);
        if (!global) return matches;
        const end = m.index + m[0].length;
        pos = end > m.index ? end : end + (line.codePointAt(end) > 0xffff ? 2 : 1);
      }
      if (matches.length >= max) break;
    }
    return matches;
  }

  // lines を渡すと、各行を別々の文字列として調べ、一致したかを lineHits に入れる
  function findAll(source, flags, text, max, lines, groupMap, emptyMode = '', program = null) {
    if (program && program.perLine) {
      const lineHits = lines ? findAll(source, flags, '', 0, lines, groupMap).lineHits : null;
      return { matches: findAllPerLine(source, flags, text, max, groupMap), lineHits };
    }
    if (program && program.states) {
      try {
        return findAllPosix(program, source, flags, text, max, lines, groupMap);
      } catch (e) {
        // 後方参照がある正規表現で、調べる道筋が多すぎるときは、JavaScript の正規表現で探す（下の drop の処理）
        if (e.message !== 'posix-ref-budget') throw e;
      }
    }
    // POSIX で状態機械を使わないとき（後方参照があるとき）も、grep と同じく 1 行ずつ調べ、長さ 0 の一致は出さない。
    // program.filter があれば、それで一致しない行は飛ばす（translate.js の posix-line）
    if (emptyMode === 'drop') {
      const lineOk = program && program.filter ? posixMatcher(program.filter) : null;
      const matches = [];
      let offset = 0;
      for (const line of text.split('\n')) {
        if (matches.length >= max || (!flags.includes('g') && matches.length)) break;
        const skip = lineOk && !lineOk([...line], 0);
        for (const m of skip ? [] : findAll(source, flags, line, max - matches.length, null, groupMap).matches) {
          if (!m.text.length) continue;
          m.index += offset;
          if (m.ranges) m.ranges = m.ranges.map((r) => (r ? [r[0] + offset, r[1] + offset] : null));
          matches.push(m);
          if (!flags.includes('g')) break;
        }
        offset += line.length + 1;
      }
      const hits = lines ? findAll(source, flags, '', 0, lines, groupMap).lineHits : null;
      return { matches, lineHits: hits && lineOk ? hits.map((h, k) => h && !!lineOk([...lines[k]], 0)) : hits };
    }
    const re = compile(source, flags);
    let matches = [];
    if (re.global && emptyMode) {
      matches = findAllEmptyAware(re, source, flags, text, max, groupMap, emptyMode);
    } else if (re.global) {
      for (const m of text.matchAll(re)) {
        matches.push(pack(m, groupMap));
        if (matches.length >= max) break;
      }
    } else {
      const m = re.exec(text);
      if (m) matches.push(pack(m, groupMap));
    }
    let lineHits = null;
    if (lines) {
      const one = new RegExp(source, flags.replace(/[gy]/g, ''));
      lineHits = lines.map((line) => one.test(line));
    }
    return { matches, lineHits };
  }

  global.MatchCore = { findAll };
})(typeof window !== 'undefined' ? window : self);
