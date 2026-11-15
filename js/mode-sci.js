(function (root) {
  const EML = (root.EML = root.EML || {});
  const { C } = EML;

  // Scientific mode: type an expression, see how each piece is built from 1 and
  // eml, then watch the pure-EML tree resolve step by step. The pure helpers
  // (breakdown, skeleton, positionsFor, badgeFor, exampleFor, sampleK) have no
  // DOM; init() is a no-op without a document.

  // Exact up to 1e9; above that the count (a float sum) is only approximate.
  const count = (n) => (Number(n) > 1e9 ? '≈' + Number(n).toPrecision(2) : Number(n).toLocaleString('en-US'));
  const CAP = 1500; // visible-tree cap, positions
  const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

  // ---- Status badges ------------------------------------------------------------
  // Meaning is carried by the glyph and the words, never by colour alone.
  const BADGES = {
    ok: { text: '✓ matches standard math', tone: 'ok' },
    limit: { text: '≈ limit', tone: 'limit' },
    overflow: { text: '⚠ overflow', tone: 'warn' },
    mismatch: { text: '≠ differs', tone: 'bad' },
    undefined: { text: 'undefined', tone: 'muted' },
    error: { text: '', tone: 'error' }, // an error shows only its message
  };
  // An overflow result whose failure is really an underflow (a value below
  // ~1e-308): the reference's range failure, or a route that only underflowed.
  function isUnderflow(result) {
    if (!result || result.status !== 'overflow') return false;
    if (result.range) return result.range.cause === 'underflow';
    return !!(result.flags && result.flags.underflow && !result.flags.overflow);
  }
  // result (optional) refines the overflow badge's wording; the status stays 'overflow'.
  function badgeFor(status, result) {
    const badge = Object.assign({}, has(BADGES, status) ? BADGES[status] : BADGES.error);
    if (status === 'overflow' && isUnderflow(result)) badge.text = '⚠ out of range';
    return badge;
  }

  // ---- "Try it" examples --------------------------------------------------------
  // One valid expression per recipe id, written the way a person would type it.
  const EXAMPLES = {
    one: '1',
    exp: 'exp(1)',
    e: 'e',
    ln: 'ln(2)',
    zero: '0',
    sub: '5 − 3',
    neg: '−4',
    add: '2 + 3',
    inv: 'inv(4)',
    mul: '3 × 4',
    div: '6 ÷ 4',
    pow: '2 ^ 3',
    minusOne: '−1',
    two: '2',
    i: 'i',
    pi: 'π',
    half: 'half(5)',
    sqr: 'sqr(3)',
    sqrt: 'sqrt(2)',
    logb: 'log(2, 8)',
    sinh: 'sinh(1)',
    cosh: 'cosh(1)',
    tanh: 'tanh(1)',
    sigmoid: 'σ(1)',
    sin: 'sin(1)',
    cos: 'cos(1)',
    tan: 'tan(1)',
    arcsin: 'arcsin(0.5)',
    arccos: 'arccos(0.5)',
    arctan: 'arctan(1)',
    arsinh: 'arsinh(1)',
    arcosh: 'arcosh(2)',
    artanh: 'artanh(0.5)',
    avg: 'avg(2, 8)',
    hypot: 'hypot(3, 4)',
  };
  function exampleFor(recipeId) {
    return has(EXAMPLES, recipeId) ? EXAMPLES[recipeId] : '1';
  }

  // ---- Pure-EML size of one element, built once with variables --------------------
  const VARS = { logb: ['b', 'z'] };
  const sampleMemo = new Map();
  function sampleCall(id) {
    let call = sampleMemo.get(id);
    if (!call) {
      const r = EML.recipeById[id];
      const names = VARS[id] || (r.arity === 1 ? ['z'] : ['a', 'b', 'c']);
      const args = names.slice(0, r.arity).map((n) => EML.calls.variable(n));
      call = EML.R.call(id, ...args);
      sampleMemo.set(id, call);
    }
    return call;
  }
  const kMemo = new Map();
  function sampleK(id) {
    if (!kMemo.has(id)) kMemo.set(id, EML.dag.K(sampleCall(id).root));
    return kMemo.get(id);
  }

  // A number literal's own tree (binary doubling, or p x (1/q)).
  const numKMemo = new Map();
  function numberK(text) {
    if (!numKMemo.has(text)) {
      let k = null;
      try {
        k = EML.dag.K(EML.compile({ type: 'num', text, value: parseFloat(text) }).root);
      } catch (e) { /* too long: run() would already have refused it */ }
      numKMemo.set(text, k);
    }
    return numKMemo.get(text);
  }
  function numberFormula(text) {
    let r;
    try { r = EML.numberToRational(text); } catch (e) { return ''; }
    if (r.q !== 1) return `${count(r.p)} × (1 ÷ ${count(r.q)})`;
    if (r.p === 0) return 'ln(1)';
    if (r.p === 1) return 'the constant 1';
    if (r.p === 2) return '1 + 1';
    return 'built from 1 by doubling and adding 1';
  }

  // ---- AST helpers --------------------------------------------------------------
  const OP_ID = { '+': 'add', '-': 'sub', '*': 'mul', '/': 'div', '^': 'pow' };

  function keyOf(a) {
    switch (a.type) {
      case 'num': return 'num:' + a.text;
      case 'const': return 'r:' + a.name;
      case 'neg': return 'r:neg';
      case 'bin': return 'r:' + OP_ID[a.op];
      default: return 'r:' + a.name; // call
    }
  }
  function kidsOf(a) {
    if (a.type === 'neg') return [a.arg];
    if (a.type === 'bin') return [a.left, a.right];
    if (a.type === 'call') return a.args;
    return [];
  }
  function kindOf(a) {
    return a.type === 'num' ? 'number'
      : a.type === 'const' ? 'constant'
        : a.type === 'call' ? 'function' : 'operator';
  }

  // Distinct elements of the expression in reading order (left operand, the
  // operator, right operand). -> [{key, kind, recipeId, symbol, name, formula, K, uses}]
  function breakdown(ast) {
    const entries = [];
    const byKey = new Map();
    const visit = (a) => {
      const kids = kidsOf(a);
      const note = () => {
        const key = keyOf(a);
        const seen = byKey.get(key);
        if (seen) { seen.uses++; return; }
        let entry;
        if (a.type === 'num') {
          entry = {
            key, kind: 'number', recipeId: null, symbol: a.text, name: 'number',
            formula: numberFormula(a.text), K: numberK(a.text), uses: 1,
          };
        } else {
          const id = key.slice(2);
          const r = EML.recipeById[id];
          entry = {
            key, kind: kindOf(a), recipeId: id, symbol: r.symbol, name: r.name,
            formula: r.formula, K: sampleK(id), uses: 1,
          };
        }
        byKey.set(key, entry);
        entries.push(entry);
      };
      if (a.type === 'bin') {
        visit(kids[0]);
        note();
        visit(kids[1]);
      } else {
        note();
        for (const k of kids) visit(k);
      }
    };
    visit(ast);
    return entries;
  }

  // Pair every AST node with its compiled call: [{key, ast, call, path}] where
  // path is the node's position in the fully folded tree ('' root, '/i' kids).
  function skeleton(ast, call) {
    const out = [];
    const stack = [{ a: ast, c: call, p: '' }];
    while (stack.length) {
      const { a, c, p } = stack.pop();
      out.push({ key: keyOf(a), ast: a, call: c, path: p });
      const kids = kidsOf(a);
      for (let i = kids.length - 1; i >= 0; i--) stack.push({ a: kids[i], c: c.args[i], p: `${p}/${i}` });
    }
    return out;
  }

  // Visible positions that belong to an element. A position qualifies when it is
  // that element's own spot (folded, or unfolded down to its body) or when the
  // element's own argument call is drawn somewhere inside an unfolded body.
  function positionsFor(vroot, skel, key) {
    const paths = new Set();
    const calls = new Set();
    for (const s of skel) {
      if (s.key !== key) continue;
      paths.add(s.path);
      calls.add(s.call);
    }
    const out = new Set();
    const stack = [vroot];
    while (stack.length) {
      const v = stack.pop();
      const m = /^((?:\/\d+)*)>*$/.exec(v.path);
      if ((m && paths.has(m[1])) || calls.has(v.call)) out.add(v.path);
      for (const c of v.children) stack.push(c);
    }
    return out;
  }

  // What the result card shows as the big value. ok and limit show standard math
  // rounded to the digits the EML tree confirms (C.formatVerified). When the EML
  // route itself failed (overflow, mismatch) the standard-math value leads and the
  // tree's own value is shown smaller beneath it; when standard math has no 64-bit
  // value either, no number is shown at all.
  //   -> {big, bigLabel, sub}
  const NO_VALUE = '—';
  function resultView(result) {
    const fmt = (z) => C.format(z, 10);
    // The tree's own value; NaN reads "no number" (not "undefined", which is a status).
    const tree = (z) => 'EML tree gave: ' + (Number.isNaN(z.re) || Number.isNaN(z.im) ? 'no number' : fmt(z));
    switch (result.status) {
      case 'ok':
      case 'limit':
        return { big: C.formatVerified(result.value, result.ref), bigLabel: '', sub: '' };
      case 'undefined':
        return { big: NO_VALUE, bigLabel: '', sub: '' };
      case 'overflow':
        if (result.range || !C.isFinite(result.ref)) {
          const raw = result.value;
          const sub = !raw ? '' : tree(raw) + (C.isFinite(raw) ? ' (can’t be checked)' : '');
          const big = result.range && result.range.exceeds ? 'too large for 64-bit floats' : 'out of 64-bit float range';
          return { big, bigLabel: '', sub };
        }
        return { big: fmt(result.ref), bigLabel: 'standard math', sub: tree(result.value) };
      case 'mismatch':
        return { big: fmt(result.ref), bigLabel: 'standard math', sub: tree(result.value) };
      default:
        return { big: '', bigLabel: '', sub: '' };
    }
  }

  // The small "standard math" line under an ok or limit result: how far the two
  // independent computations agree (the big value already is the standard one).
  function refLine(result) {
    if (result.status !== 'ok' && result.status !== 'limit') return '';
    const v = C.verify(result.value, result.ref);
    if (!v) return '';
    if (result.ref.re === 0 && result.ref.im === 0) return 'Standard math: 0';
    if (v.digits === 0) return 'Standard math: 0 (to within 1e-12)';
    // Not even the first digit was confirmed: say so instead of claiming agreement.
    if (v.clamped) return `Standard math: ${C.format(result.ref, 10)} (the EML tree doesn’t confirm even its first digit here)`;
    if (v.digits >= 10) return 'Standard math agrees to all 10 digits shown';
    return `Standard math agrees to ${v.digits} significant digit${v.digits === 1 ? '' : 's'}`;
  }

  // The value line of a breakdown card for one piece: its standard-math value
  // (the reference of the piece's own subtree), shown through the verified
  // formatter when the EML tree agrees there, and marked when it does not.
  //   ast: the piece's first occurrence; z: the EML tree's value there;
  //   status: the whole result's status ('limit' uses nudged literals).
  //   -> {text, differs}
  function pieceValue(ast, z, status) {
    if (ast.type === 'num') {
      const v = C.cx(ast.value, 0);
      return { text: C.formatVerified(v, v), differs: false };
    }
    const t = EML.referenceTrace(ast);
    if (t.failure || !C.isFinite(t.value)) return { text: NO_VALUE, differs: false };
    const ref = t.value;
    const agrees = C.isFinite(z) && (status === 'limit' ? C.approxEq(z, ref, 1e-6, 1e-6) : C.approxEq(z, ref, 1e-7));
    if (agrees) return { text: C.formatVerified(z, ref), differs: false };
    return { text: C.format(ref, 10) + ' · EML tree differs here', differs: true };
  }

  // ---- DOM ------------------------------------------------------------------------
  const SPEEDS = [
    { id: 'slow', label: 'Slow', ms: 1000 },
    { id: 'medium', label: 'Medium', ms: 400 },
    { id: 'fast', label: 'Fast', ms: 120 },
  ];

  // [label, text inserted] for the function keys: every Table-1 function.
  const FUNC_KEYS = [
    ['sin', 'sin('], ['cos', 'cos('], ['tan', 'tan('],
    ['arcsin', 'arcsin('], ['arccos', 'arccos('], ['arctan', 'arctan('],
    ['sinh', 'sinh('], ['cosh', 'cosh('], ['tanh', 'tanh('],
    ['arsinh', 'arsinh('], ['arcosh', 'arcosh('], ['artanh', 'artanh('],
    ['exp', 'exp('], ['ln', 'ln('], ['log', 'log('],
    ['√', 'sqrt('], ['sqr', 'sqr('], ['half', 'half('],
    ['inv', 'inv('], ['σ', 'σ('], ['avg', 'avg('], ['hypot', 'hypot('],
  ];

  // The calculator pad, five columns. Entries: [label, insert] or [label, null, action].
  const PAD_KEYS = [
    ['7', '7'], ['8', '8'], ['9', '9'], ['÷', '÷', 'op'], ['⌫', null, 'back'],
    ['4', '4'], ['5', '5'], ['6', '6'], ['×', '×', 'op'], ['C', null, 'clear'],
    ['1', '1'], ['2', '2'], ['3', '3'], ['−', '−', 'op'], ['(', '(', 'op'],
    ['0', '0'], ['.', '.'], ['^', '^', 'op'], ['+', '+', 'op'], [')', ')', 'op'],
    ['π', 'π', 'const'], ['e', 'e', 'const'], ['i', 'i', 'const'], [',', ',', 'op'], ['=', null, 'eval'],
  ];

  const EXAMPLE_CHIPS = ['sin(2) + 3', 'ln(−2)', 'sqrt(−4)', 'sin(0)'];

  function init(section) {
    const doc = root.document;
    if (!doc) return;

    const { el, btn } = EML.dom;
    const coarse = !!(root.matchMedia && root.matchMedia('(pointer: coarse)').matches);

    // ---- calculator card -----------------------------------------------------------
    const input = el('input', {
      type: 'text', id: 'sci-input', class: 'sci-input mono', autocomplete: 'off', autocapitalize: 'off',
      autocorrect: 'off', spellcheck: 'false', 'aria-label': 'Expression', placeholder: 'e.g. sin(2) + 3',
    });
    const evalBtn = btn('Evaluate', 'btn primary');
    const pad = el('div', { class: 'sci-pad', role: 'group', 'aria-label': 'Calculator keys' });
    for (const [label, ins, kind] of PAD_KEYS) {
      const aria = { '÷': 'divide', '×': 'times', '−': 'minus', '⌫': 'backspace', C: 'clear all', '=': 'evaluate', '^': 'power', ',': 'comma' }[label];
      const props = aria ? { 'aria-label': aria } : {};
      const b = btn(label, 'keycap' + (kind ? ' ' + kind : ''), props);
      b.dataset.insert = ins === null ? '' : ins;
      b.dataset.action = ins === null ? kind : '';
      pad.append(b);
    }
    const funcs = el('div', { class: 'sci-funcs', role: 'group', 'aria-label': 'Functions' });
    for (const [label, ins] of FUNC_KEYS) {
      const b = btn(label, 'keycap', { 'aria-label': ins.slice(0, -1) });
      b.dataset.insert = ins;
      funcs.append(b);
    }
    const chips = el('div', { class: 'sci-eg' }, el('span', { class: 'hint', text: 'Try:' }));
    for (const ex of EXAMPLE_CHIPS) {
      const b = btn(ex, 'btn sci-chip mono');
      b.dataset.example = ex;
      chips.append(b);
    }
    const calcCard = el('div', { class: 'card sci-card sci-calc' },
      el('h2', { class: 'sci-h', text: 'Type an expression' }),
      el('div', { class: 'sci-inputrow' }, input, evalBtn),
      chips, pad, funcs);

    // ---- result card ---------------------------------------------------------------
    const valueEl = el('div', { class: 'value sci-value' });
    const bigLabelEl = el('div', { class: 'sci-biglabel', hidden: '' });
    const subEl = el('p', { class: 'hint sci-sub mono', hidden: '' });
    const badgeEl = el('span', { class: 'sci-badge', hidden: '' });
    const msgEl = el('p', { class: 'hint sci-msg', role: 'status', 'aria-live': 'polite' });
    const noteEl = el('p', { class: 'sci-note' });
    const refEl = el('p', { class: 'hint sci-ref mono' });
    const statsEl = el('div', { class: 'sci-stats' });
    const resultBody = el('div', { class: 'sci-result-body' },
      el('div', { class: 'sci-top' }, el('div', { class: 'sci-bigbox' }, bigLabelEl, valueEl), badgeEl),
      subEl, noteEl, refEl, statsEl);
    const resultCard = el('div', { class: 'card sci-card sci-result' },
      el('h2', { class: 'sci-h', text: 'Result' }), msgEl, resultBody);

    // ---- breakdown card ------------------------------------------------------------
    const piecesEl = el('div', { class: 'sci-pieces' });
    const breakCard = el('div', { class: 'card sci-card sci-break', hidden: '' },
      el('h2', { class: 'sci-h', text: 'How each piece is built' }),
      el('p', { class: 'hint', text: 'Tap a piece to ring where it sits in the tree.' }),
      piecesEl);

    // ---- expanded view card --------------------------------------------------------
    const treeBtn = btn('Tree', '', { 'aria-pressed': 'true' });
    const textBtn = btn('Text', '', { 'aria-pressed': 'false' });
    const viewToggle = el('div', { class: 'segmented', role: 'group', 'aria-label': 'View' }, treeBtn, textBtn);
    const unfoldAllBtn = btn('Unfold all', 'btn');
    const foldAllBtn = btn('Fold all', 'btn');
    const fitBtn = btn('Fit tree', 'btn btn-fit', { title: 'Re-centre and zoom to show the whole tree' });
    const xmsgEl = el('p', { class: 'hint sci-xmsg', role: 'status', 'aria-live': 'polite' });
    const limitEl = el('p', { class: 'sci-limit', hidden: '', text: 'Limit mode: stepping uses literals nudged by a tiny amount (a 0 shows as a tiny number such as 1e-14), so the in-between values are approximate. The last step shows the limit.' });
    const treeBox = el('div', { class: 'sci-tree' });
    const textBox = el('div', { class: 'sci-text', hidden: '', tabindex: '0', 'aria-label': 'Step-by-step rewriting' });
    const backBtn = btn('◀', 'btn', { 'aria-label': 'Step back' });
    const stepBtn = btn('▶', 'btn', { 'aria-label': 'Step forward' });
    const playBtn = btn('▶▶', 'btn primary', { 'aria-label': 'Play' });
    const resetBtn = btn('↺', 'btn', { 'aria-label': 'Reset to the start' });
    const speedSel = el('select', { class: 'sci-select', 'aria-label': 'Playback speed' });
    for (const s of SPEEDS) speedSel.append(el('option', { value: s.id, text: s.label }));
    speedSel.value = 'medium';
    const stepsEl = el('span', { class: 'sci-steps mono', 'aria-live': 'polite' });
    const progressBar = el('div', { class: 'sci-progress-bar' });
    const progressEl = el('div', { class: 'sci-progress', 'aria-hidden': 'true' }, progressBar);
    const expandCard = el('div', { class: 'card sci-card sci-expand', hidden: '' },
      el('h2', { class: 'sci-h', text: 'The pure-EML tree' }),
      el('p', { class: 'hint', text: 'Tap a dashed blob to unfold it one level. Press ▶ to resolve the tree from the leaves up. Pinch or Ctrl+scroll to zoom the tree; Fit tree resets the view.' }),
      el('div', { class: 'sci-bar' }, viewToggle, unfoldAllBtn, foldAllBtn, fitBtn),
      limitEl, xmsgEl, treeBox, textBox, progressEl,
      el('div', { class: 'sci-ctl' },
        el('div', { class: 'sci-transport', role: 'group', 'aria-label': 'Resolve the tree' }, resetBtn, backBtn, stepBtn, playBtn),
        speedSel, stepsEl));

    // ---- "how it's built" card -----------------------------------------------------
    const recipeSel = el('select', { id: 'sci-recipe', class: 'sci-select' });
    for (const r of EML.recipes) recipeSel.append(el('option', { value: r.id, text: `${r.symbol} — ${r.name}` }));
    recipeSel.value = EML.recipes[0].id;
    const dTitle = el('h3', { class: 'sci-dtitle' });
    const dFormula = el('div', { class: 'sci-formula mono' });
    const dExplain = el('p', { class: 'sci-explain' });
    const dDeps = el('div', { class: 'sci-deps' });
    const dK = el('p', { class: 'hint' });
    const pvBox = el('div', { class: 'sci-pv' });
    const pvMsg = el('p', { class: 'hint', role: 'status', 'aria-live': 'polite' });
    const tryBtn = btn('Try it', 'btn primary');
    const tryEg = el('span', { class: 'mono sci-tryeg' });
    const howCard = el('div', { class: 'card sci-card sci-how' },
      el('h2', { class: 'sci-h', text: 'How it’s built' }),
      el('div', { class: 'sci-field' },
        el('label', { for: 'sci-recipe', class: 'sci-label', text: 'Pick a function or constant' }), recipeSel),
      el('div', { class: 'sci-detail' },
        dTitle, dFormula, dExplain, dDeps, dK, pvBox, pvMsg,
        el('div', { class: 'sci-tryrow' }, tryBtn, tryEg)));

    section.textContent = '';
    section.append(el('div', { class: 'panels sci' },
      // Two columns on wide screens; on phones the columns dissolve and the
      // cards follow the reading order calc, result, pieces, tree, recipes (CSS order).
      el('div', { class: 'sci-col' }, calcCard, breakCard),
      el('div', { class: 'sci-col' }, resultCard, expandCard, howCard)));

    // ---- state ---------------------------------------------------------------------
    let result = null;
    let skel = null;
    let ev = null;
    let fold = { unfolded: new Set(), all: false };
    let vroot = null;
    let shown = 0;
    let resolver = null;
    let view = 'tree';
    let selKey = null;
    let playTimer = null;
    let playing = false;
    let tv = null;
    let txv = null;
    let pv = null;
    let pvUnfolded = new Set();

    const evalNode = (node) => {
      // The resolved root shows the same verified value as the result card.
      if ((result.status === 'ok' || result.status === 'limit') && node === result.root) {
        const v = C.verify(result.value, result.ref);
        if (v) return v.value;
      }
      return ev(node);
    };

    // ---- input ---------------------------------------------------------------------
    function insertText(text) {
      const s = input.selectionStart == null ? input.value.length : input.selectionStart;
      const e = input.selectionEnd == null ? s : input.selectionEnd;
      input.setRangeText(text, s, e, 'end');
      if (!coarse) input.focus(); // on phones, keep the on-screen keys in view
    }
    function backspace() {
      const s = input.selectionStart == null ? input.value.length : input.selectionStart;
      const e = input.selectionEnd == null ? s : input.selectionEnd;
      if (s !== e) input.setRangeText('', s, e, 'end');
      else if (s > 0) input.setRangeText('', s - 1, s, 'end');
      if (!coarse) input.focus();
    }

    pad.addEventListener('click', (ev2) => {
      const b = ev2.target.closest && ev2.target.closest('button');
      if (!b) return;
      const action = b.dataset.action;
      if (action === 'back') backspace();
      else if (action === 'clear') { input.value = ''; clearResult(); if (!coarse) input.focus(); }
      else if (action === 'eval') evaluate();
      else insertText(b.dataset.insert);
    });
    funcs.addEventListener('click', (ev2) => {
      const b = ev2.target.closest && ev2.target.closest('button');
      if (b) insertText(b.dataset.insert);
    });
    chips.addEventListener('click', (ev2) => {
      const b = ev2.target.closest && ev2.target.closest('button');
      if (!b) return;
      input.value = b.dataset.example;
      evaluate();
    });
    evalBtn.addEventListener('click', evaluate);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        evaluate();
      }
    });

    // ---- evaluate / result ---------------------------------------------------------
    function stopPlay() {
      if (playTimer) root.clearTimeout(playTimer);
      playTimer = null;
      playing = false;
    }

    function clearResult(message) {
      stopPlay();
      result = null;
      skel = null;
      vroot = null;
      resolver = null;
      selKey = null;
      resultBody.hidden = true;
      breakCard.hidden = true;
      expandCard.hidden = true;
      msgEl.className = 'hint sci-msg';
      msgEl.textContent = message === undefined
        ? 'Type an expression like sin(2) + 3, or tap the keys, then press Evaluate.'
        : message;
    }

    function showError(message) {
      clearResult(message);
      msgEl.className = 'error sci-msg';
    }

    function evaluate() {
      stopPlay();
      if (!input.value.trim()) { clearResult(); return; }
      const r = EML.run(input.value);
      if (r.status === 'error') { showError(r.note); return; }
      result = r;
      skel = skeleton(r.ast, r.call);
      ev = EML.dag.makeEvaluator({ overrides: r.overrides });
      fold = { unfolded: new Set(), all: false };
      selKey = null;
      xmsgEl.textContent = '';
      limitEl.hidden = result.status !== 'limit';
      renderResult();
      renderBreakdown();
      breakCard.hidden = false;
      expandCard.hidden = false;
      rebuildView(null);
    }

    function renderResult() {
      msgEl.textContent = '';
      resultBody.hidden = false;
      const rv = resultView(result);
      valueEl.textContent = rv.big;
      valueEl.classList.toggle('is-words', /[a-z]{3}/i.test(rv.big)); // e.g. 'too large for 64-bit floats'
      bigLabelEl.textContent = rv.bigLabel;
      bigLabelEl.hidden = !rv.bigLabel;
      subEl.textContent = rv.sub;
      subEl.hidden = !rv.sub;
      const badge = badgeFor(result.status, result);
      badgeEl.hidden = !badge.text;
      badgeEl.textContent = badge.text;
      badgeEl.className = 'sci-badge tone-' + badge.tone;
      noteEl.textContent = result.note;
      noteEl.hidden = !result.note;
      // Overflow and mismatch already lead with the standard value; repeat it only where the EML value leads.
      refEl.textContent = refLine(result);
      refEl.hidden = !refEl.textContent;
      statsEl.textContent = '';
      for (const [label, value] of [
        ['pure-EML size', `${count(result.K)} symbols`],
        ['height', count(result.height)],
        ['unique nodes', count(result.unique)],
      ]) {
        statsEl.append(el('span', { class: 'sci-stat' }, el('span', { class: 'sci-stat-k', text: label }), el('strong', { text: value })));
      }
    }

    // ---- breakdown -----------------------------------------------------------------
    function pieceText(entry) {
      const first = skel.find((s) => s.key === entry.key);
      const pv = pieceValue(first.ast, ev(first.call.root), result.status);
      return 'value here: ' + pv.text;
    }

    function renderBreakdown() {
      piecesEl.textContent = '';
      for (const entry of breakdown(result.ast)) {
        const meta = `pure-EML size: ${count(entry.K)} symbols` + (entry.uses > 1 ? ` · used ${entry.uses}×` : '');
        const card = el('button', { type: 'button', class: 'sci-piece', 'aria-pressed': 'false' },
          el('span', { class: 'sci-piece-sym mono', text: entry.symbol }),
          el('span', { class: 'sci-piece-name', text: entry.name }),
          el('span', { class: 'sci-piece-f mono', text: entry.formula }),
          el('span', { class: 'sci-piece-meta', text: meta }),
          el('span', { class: 'sci-piece-val value', text: pieceText(entry) }));
        card.dataset.key = entry.key;
        piecesEl.append(card);
      }
    }

    piecesEl.addEventListener('click', (e) => {
      const card = e.target.closest && e.target.closest('.sci-piece');
      if (!card || !vroot) return;
      selKey = selKey === card.dataset.key ? null : card.dataset.key;
      for (const c of piecesEl.children) c.setAttribute('aria-pressed', String(c.dataset.key === selKey));
      if (selKey) {
        setView('tree'); // only the tree can ring positions
        if (expandCard.scrollIntoView) {
          expandCard.scrollIntoView({ block: 'nearest', behavior: EML.dom.reduceMotion() ? 'auto' : 'smooth' });
        }
      }
      drawExpanded(false);
    });

    // ---- expanded view -------------------------------------------------------------
    function setView(next) {
      view = next;
      treeBtn.setAttribute('aria-pressed', String(next === 'tree'));
      textBtn.setAttribute('aria-pressed', String(next === 'text'));
    }

    // Build the visible tree for `nextFold`. Returns null on success, or a message
    // when it would be too big (then nothing changes).
    function rebuildView(nextFold, hugeMessage = () => 'Too many nodes to draw') {
      const f = nextFold || fold;
      const r = EML.viewModel.build(result.call, { unfolded: f.unfolded, unfoldAll: f.all }, CAP);
      if (r.tooBig) return hugeMessage(r.count);
      stopPlay();
      fold = f;
      vroot = r.root;
      shown = r.count;
      resolver = new EML.Resolver(vroot, evalNode);
      drawExpanded(true);
      return null;
    }

    function unfoldPath(path) {
      const next = { unfolded: new Set(fold.unfolded), all: fold.all };
      next.unfolded.add(path);
      const msg = rebuildView(next, () =>
        `Unfolding that would draw more than ${count(CAP)} nodes — unfold a smaller piece`);
      xmsgEl.textContent = msg || '';
    }

    unfoldAllBtn.addEventListener('click', () => {
      if (!result) return;
      const msg = rebuildView({ unfolded: new Set(), all: true }, (n) =>
        `Unfolding everything would draw ${count(n)} nodes — unfold a smaller piece`);
      xmsgEl.textContent = msg || '';
    });
    foldAllBtn.addEventListener('click', () => {
      if (!result) return;
      xmsgEl.textContent = '';
      rebuildView({ unfolded: new Set(), all: false });
    });
    treeBtn.addEventListener('click', () => { setView('tree'); drawExpanded(false); });
    textBtn.addEventListener('click', () => { setView('text'); drawExpanded(false); });
    fitBtn.addEventListener('click', () => { if (tv) tv.fit(); });

    function drawExpanded(fit) {
      if (!vroot) return;
      const isTree = view === 'tree';
      treeBox.hidden = !isTree;
      textBox.hidden = isTree;
      fitBtn.hidden = !isTree;

      if (isTree) {
        const highlight = new Set();
        const last = resolver.history[resolver.history.length - 1];
        if (last) for (const v of last) highlight.add(v.path);
        if (selKey) for (const p of positionsFor(vroot, skel, selKey)) highlight.add(p);
        if (!tv) tv = new EML.TreeView(treeBox, { onBlobClick: unfoldPath });
        tv.render(vroot, resolver, { highlight, fit });
      } else {
        if (!txv) txv = new EML.TextView(textBox);
        txv.render(vroot, resolver);
      }

      const i = resolver.stepIndex;
      const n = resolver.totalSteps;
      stepsEl.textContent = `Step ${count(i)} / ${count(n)}` + (resolver.done ? ' — resolved' : '');
      progressBar.style.width = (n ? (100 * i) / n : 0) + '%';
      progressEl.classList.toggle('done', resolver.done);
      backBtn.disabled = i === 0;
      resetBtn.disabled = i === 0;
      stepBtn.disabled = resolver.done;
      playBtn.disabled = resolver.done;
      playBtn.textContent = playing ? '⏸' : '▶▶';
      playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    }

    // ---- resolve controls ----------------------------------------------------------
    stepBtn.addEventListener('click', () => {
      if (!resolver) return;
      stopPlay();
      resolver.step();
      drawExpanded(false);
    });
    backBtn.addEventListener('click', () => {
      if (!resolver) return;
      stopPlay();
      resolver.back();
      drawExpanded(false);
    });
    resetBtn.addEventListener('click', () => {
      if (!resolver) return;
      stopPlay();
      resolver.reset();
      drawExpanded(false);
    });

    function tick() {
      playTimer = null;
      if (!playing || !resolver) return;
      resolver.step();
      if (resolver.done) playing = false;
      drawExpanded(false);
      if (playing) {
        const ms = SPEEDS.find((s) => s.id === speedSel.value).ms;
        playTimer = root.setTimeout(tick, ms);
      }
    }
    playBtn.addEventListener('click', () => {
      if (!resolver) return;
      if (playing) { stopPlay(); drawExpanded(false); return; }
      if (EML.dom.reduceMotion()) {
        // No animation: go straight to the end; the step buttons still work one at a time.
        while (!resolver.done && resolver.step().length) { /* resolve everything */ }
        drawExpanded(false);
        return;
      }
      playing = true;
      tick();
    });

    // ---- "how it's built" ----------------------------------------------------------
    function selectRecipe(id) {
      recipeSel.value = id;
      pvUnfolded = new Set();
      renderRecipe(true);
    }

    function renderRecipe(fit) {
      const r = EML.recipeById[recipeSel.value];
      dTitle.textContent = `${r.symbol} — ${r.name}`;
      dFormula.textContent = r.formula;
      dExplain.textContent = r.explain;
      dDeps.textContent = '';
      if (r.deps.length) {
        dDeps.append(el('span', { class: 'sci-label', text: 'Built from' }));
        for (const id of r.deps) {
          const d = EML.recipeById[id];
          const b = btn(`${d.symbol} ${d.name}`, 'sci-link', { 'aria-label': `Show how ${d.name} is built` });
          b.dataset.dep = id;
          dDeps.append(b);
        }
      } else {
        dDeps.append(el('span', { class: 'hint', text: 'Built directly from 1 and eml.' }));
      }
      dK.textContent = `Pure-EML size: ${count(sampleK(r.id))} symbols`;
      tryEg.textContent = exampleFor(r.id);

      const call = sampleCall(r.id);
      const unfolded = new Set(['', ...pvUnfolded]);
      const vm = EML.viewModel.build(call, { unfolded }, CAP);
      if (vm.tooBig) {
        pvMsg.textContent = `Unfolding that would draw more than ${count(CAP)} nodes — unfold a smaller piece`;
        return false;
      }
      pvMsg.textContent = '';
      if (!pv) {
        pv = new EML.TreeView(pvBox, {
          onBlobClick: (path) => {
            pvUnfolded.add(path);
            if (!renderRecipe(true)) pvUnfolded.delete(path); // too big: keep the old tree
          },
        });
      }
      pv.render(vm.root, null, { fit });
      return true;
    }

    dDeps.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('button');
      if (b && b.dataset.dep) selectRecipe(b.dataset.dep);
    });
    recipeSel.addEventListener('change', () => selectRecipe(recipeSel.value));
    tryBtn.addEventListener('click', () => {
      input.value = exampleFor(recipeSel.value);
      evaluate();
      if (calcCard.scrollIntoView) {
        calcCard.scrollIntoView({ block: 'nearest', behavior: EML.dom.reduceMotion() ? 'auto' : 'smooth' });
      }
    });

    // Leaving this mode stops playback (the resolve position is kept).
    section.addEventListener('eml:hide', () => {
      if (playing) { stopPlay(); drawExpanded(false); }
    });
    section.addEventListener('eml:show', () => {
      if (tv && !treeBox.hidden && vroot) tv.fit();
      if (pv) pv.fit();
    });

    clearResult();
    renderRecipe(true);
  }

  EML.modeSci = {
    init, resultView, refLine, pieceValue, count, breakdown, skeleton, positionsFor, badgeFor, isUnderflow, exampleFor, sampleK, numberK, SPEEDS, FUNC_KEYS,
  };
})(typeof window !== 'undefined' ? window : globalThis);
