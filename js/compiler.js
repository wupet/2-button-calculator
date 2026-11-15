(function (root) {
  const EML = (root.EML = root.EML || {});
  const C = EML.C;
  const R = EML.R;
  const calls = EML.calls;
  const dag = EML.dag;

  // Compiler: AST -> recipe call tree (EML); reference evaluator (standard math);
  // run(): the single entry point that reports an honest status.

  const MAX_NODES = 200;
  const LITERAL_ERR = 'Number too long to build in EML \u2014 round it to 6 digits';
  const TOO_LONG = 'Expression too long for this demo';

  const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };

  // Exact decimal text -> reduced fraction {p, q}. Enforces the literal cap
  // (<= 6 significant digits, value <= 1e6).
  EML.numberToRational = (text) => {
    const m = /^(\d*)(?:\.(\d*))?$/.exec(text);
    if (!m || (m[1] === '' && !m[2])) throw new EML.ParseError("Unexpected number '" + text + "'", 0);
    const intPart = m[1] || '';
    const frac = m[2] || '';
    const digits = (intPart + frac).replace(/^0+/, '').replace(/0+$/, '');
    if (digits.length > 6) throw new EML.ParseError(LITERAL_ERR, 0);
    let p = parseInt((intPart + frac) || '0', 10);
    let q = Math.pow(10, frac.length);
    if (p / q > 1e6) throw new EML.ParseError(LITERAL_ERR, 0);
    const g = gcd(p, q) || 1;
    p /= g;
    q /= g;
    return { p, q };
  };

  const binOps = { '+': 'add', '-': 'sub', '*': 'mul', '/': 'div', '^': 'pow' };

  EML.compile = (ast) => {
    switch (ast.type) {
      case 'num': {
        const { p, q } = EML.numberToRational(ast.text);
        return calls.literal(ast.value, ast.text, R.rational(p, q));
      }
      case 'const': return R[ast.name]();
      case 'neg': return R.neg(EML.compile(ast.arg));
      case 'bin': return R[binOps[ast.op]](EML.compile(ast.left), EML.compile(ast.right));
      case 'call': return R.call(ast.name, ...ast.args.map(EML.compile));
      default: throw new Error('Unknown AST node ' + ast.type);
    }
  };

  // Standard-math value of the AST. Literals are cx(v, +0).
  EML.reference = (ast) => {
    const rec = EML.recipeById;
    const go = (a) => {
      switch (a.type) {
        case 'num': return C.cx(a.value, 0);
        case 'const':
          return a.name === 'pi' ? C.cx(Math.PI, 0) : a.name === 'e' ? C.cx(Math.E, 0) : C.cx(0, 1);
        case 'neg': return rec.neg.ref(go(a.arg));
        case 'bin': return rec[binOps[a.op]].ref(go(a.left), go(a.right));
        case 'call': return rec[a.name].ref(...a.args.map(go));
        default: throw new Error('Unknown AST node ' + a.type);
      }
    };
    return go(ast);
  };

  const countNodes = (ast) => {
    let n = 0;
    const stack = [ast];
    while (stack.length) {
      const a = stack.pop();
      n++;
      if (a.type === 'neg') stack.push(a.arg);
      else if (a.type === 'bin') stack.push(a.left, a.right);
      else if (a.type === 'call') for (const x of a.args) stack.push(x);
    }
    return n;
  };

  const collectLits = (node) => {
    const out = [];
    const seen = new Set();
    const stack = [node];
    while (stack.length) {
      const n = stack.pop();
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      if (n.kind === 'lit') out.push(n); // a literal's own tree holds no further literals
      else if (n.kind === 'eml') stack.push(n.a, n.b);
    }
    return out;
  };

  // Zero-valued literals are nudged by an absolute step; nonzero ones by a relative 1e-12.
  const nudged = (lits, sign, zeroStep) => {
    const map = new Map();
    for (const l of lits) {
      const v = l.value === 0 ? sign * zeroStep : l.value * (1 + sign * 1e-12);
      map.set(l.id, C.cx(v, EML.ZERO));
    }
    return map;
  };

  // The zero step is tried small-to-large. 1e-14 keeps sqrt(0) honest (sqrt(step) << 1e-6), but the
  // per-node snap erases relative parts below 1e-12, so sin(0) (whose numerator is exp(i*step) -
  // exp(-i*step)) only survives from about 1e-12 up. Each level is fully validated, so a
  // larger step can never turn a disagreement into a 'limit'.
  const ZERO_STEPS = [1e-14, 1e-13, 1e-12, 1e-11, 1e-10];

  const clean = (z) => C.cx(Math.abs(z.re) < 1e-6 ? 0 : z.re, Math.abs(z.im) < 1e-6 ? 0 : z.im);

  const empty = (src, status, note, extra) => Object.assign({
    src, ast: null, call: null, root: null, K: null, height: null, unique: null,
    value: null, raw: null, ref: null, status, note, flags: null, overrides: null,
  }, extra);

  // Limit check: nudge every literal slightly each way; if the EML tree settles
  // on the reference value from both sides, report it as a limit.
  const tryLimit = (rootNode, ref) => {
    const lits = collectLits(rootNode);
    if (!lits.length) return null;
    const steps = lits.some((l) => l.value === 0) ? ZERO_STEPS : [ZERO_STEPS[0]];
    for (const step of steps) {
      const plus = nudged(lits, +1, step);
      const minus = nudged(lits, -1, step);
      const a = dag.evaluate(rootNode, { overrides: plus }).value;
      const b = dag.evaluate(rootNode, { overrides: minus }).value;
      if (!C.isFinite(a) || !C.isFinite(b)) continue;
      if (!C.approxEq(a, b, 1e-6, 1e-6)) continue;
      const avg = C.cx((a.re + b.re) / 2, (a.im + b.im) / 2);
      if (!C.approxEq(avg, ref, 1e-6, 1e-6)) continue;
      return { value: clean(avg), overrides: plus };
    }
    return null;
  };

  EML.run = (src) => {
    let ast;
    let call;
    try {
      ast = EML.parse(src);
      if (countNodes(ast) > MAX_NODES) throw new EML.ParseError(TOO_LONG, 0);
      call = EML.compile(ast);
    } catch (e) {
      if (e instanceof EML.ParseError) return empty(src, 'error', e.message);
      throw e;
    }
    const rootNode = call.root;
    const ref = EML.reference(ast);
    const base = {
      src, ast, call, root: rootNode,
      K: dag.K(rootNode), height: dag.height(rootNode), unique: dag.uniqueCount(rootNode),
      value: null, raw: null, ref, status: null, note: '', flags: null, overrides: null,
    };

    // 1. Standard math itself has no finite answer.
    if (!C.isFinite(ref)) {
      return Object.assign(base, {
        status: 'undefined', value: ref, note: 'Not defined here in standard math either.',
      });
    }

    // 2. The EML tree reproduces the reference.
    const { value: raw, flags } = dag.evaluate(rootNode, {});
    base.raw = raw;
    base.flags = flags;
    if (C.isFinite(raw) && C.approxEq(raw, ref, 1e-7)) {
      return Object.assign(base, { status: 'ok', value: raw });
    }

    // 3. A route computed an exp(...) beyond the 64-bit float range.
    if (flags.overflow || flags.underflow) {
      return Object.assign(base, {
        status: 'overflow', value: raw,
        note: 'This EML route computes an e^(\u2026) too big for a 64-bit float, so the tree can\u2019t finish. ' +
          'Standard math says ' + C.format(ref) + '.',
      });
    }

    // 4. Approaching the point from both sides gives the reference value.
    const lim = tryLimit(rootNode, ref);
    if (lim) {
      return Object.assign(base, {
        status: 'limit', value: lim.value, overrides: lim.overrides,
        note: 'EML can\u2019t reach this point exactly \u2014 this is the limit as you approach it.',
      });
    }

    // 5. Genuine disagreement.
    return Object.assign(base, {
      status: 'mismatch', value: raw,
      note: 'The EML tree and standard math disagree here (branch cut or precision). ' +
        'Standard math says ' + C.format(ref) + '.',
    });
  };
})(typeof window !== 'undefined' ? window : globalThis);
