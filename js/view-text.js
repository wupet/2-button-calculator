(function (root) {
  const EML = (root.EML = root.EML || {});
  const { C } = EML;

  const MAX_LEN = 2000; // longer lines are cut in the middle
  const KEEP = 900;     // characters kept at each end of a cut line

  // Cut a line (array of {text, mark}) to its first and last KEEP characters,
  // with `…(N symbols)…` between them.
  function truncate(segs) {
    let total = 0;
    for (const s of segs) total += s.text.length;
    if (total <= MAX_LEN) return segs;
    const head = [];
    let n = 0;
    for (const s of segs) {
      if (n >= KEEP) break;
      const t = s.text.slice(0, KEEP - n);
      head.push({ text: t, mark: s.mark });
      n += t.length;
    }
    const tail = [];
    n = 0;
    for (let i = segs.length - 1; i >= 0 && n < KEEP; i--) {
      const t = segs[i].text.slice(Math.max(0, segs[i].text.length - (KEEP - n)));
      tail.unshift({ text: t, mark: segs[i].mark });
      n += t.length;
    }
    const cut = total - 2 * KEEP;
    return head.concat([{ text: `…(${cut} symbols)…`, mark: false }], tail);
  }

  // Serialise the visible tree once per resolve step 0..stepIndex.
  // Each line is an array of {text, mark}; `mark` flags parts that were
  // resolved in that very step. The last line is the current state; once the
  // root is resolved it is just the value.
  function serialize(vroot, resolver) {
    // Step at which each non-leaf position became a value (1-based).
    const stepOf = new Map();
    const steps = resolver ? resolver.stepIndex : 0;
    if (resolver) {
      resolver.history.forEach((frontier, i) => {
        for (const v of frontier) stepOf.set(v.path, i + 1);
      });
    }
    const valueText = (v) => C.format(resolver.values.get(v.path), 10);

    const lines = [];
    for (let k = 0; k <= steps; k++) {
      const segs = [];
      const out = (text, mark) => {
        const last = segs[segs.length - 1];
        if (last && last.mark === mark) last.text += text;
        else segs.push({ text, mark });
      };
      // Explicit work stack: items are VNodes or literal strings.
      const work = [vroot];
      while (work.length) {
        const item = work.pop();
        if (typeof item === 'string') { out(item, false); continue; }
        const s = stepOf.get(item.path);
        if (s !== undefined && s <= k) {
          out(valueText(item), s === k);
          continue;
        }
        if (item.kind === 'one') { out('1', false); continue; }
        if (item.kind === 'var') { out(item.label, false); continue; }
        const name = item.kind === 'eml' ? 'eml' : item.label;
        if (!item.children.length) { out(name, false); continue; }
        out(name + '(', false);
        work.push(')');
        for (let i = item.children.length - 1; i >= 0; i--) {
          work.push(item.children[i]);
          if (i > 0) work.push(', ');
        }
      }
      lines.push(truncate(segs));
    }
    return lines;
  }

  class TextView {
    constructor(container) {
      this.container = container;
    }

    // One line per step 0..stepIndex; resolved parts are wrapped in <mark>.
    render(vroot, resolver) {
      const doc = root.document;
      const lines = serialize(vroot, resolver);
      const frag = doc.createDocumentFragment();
      lines.forEach((segs, i) => {
        const line = doc.createElement('div');
        line.className = 'txt-line';
        if (i > 0) {
          const eq = doc.createElement('span');
          eq.className = 'txt-eq';
          eq.textContent = '= ';
          line.append(eq);
        }
        for (const s of segs) {
          if (s.mark) {
            const m = doc.createElement('mark');
            m.textContent = s.text;
            line.append(m);
          } else {
            line.append(doc.createTextNode(s.text));
          }
        }
        frag.append(line);
      });
      this.container.textContent = '';
      this.container.append(frag);
      this.container.scrollTop = this.container.scrollHeight;
    }
  }

  TextView.serialize = serialize;
  TextView.MAX_LEN = MAX_LEN;
  EML.TextView = TextView;
})(typeof window !== 'undefined' ? window : globalThis);
