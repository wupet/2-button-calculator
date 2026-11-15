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

  const bgcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
  const MAX_FRAC_DIGITS = 9; // keeps q <= 1e9, exact in a double

  // Exact decimal text -> reduced fraction {p, q}. Enforces the literal cap
  // (<= 6 significant digits, value <= 1e6, at most 9 decimal places once
  // trailing zeros are dropped). Pure digit-string/BigInt math, so any length is safe.
  EML.numberToRational = (text) => {
    const m = /^(\d*)(?:\.(\d*))?$/.exec(text);
    if (!m || (m[1] === '' && !m[2])) throw new EML.ParseError("Unexpected number '" + text + "'", 0);
    const intPart = m[1].replace(/^0+/, '');
    const frac = (m[2] || '').replace(/0+$/, '');
    const sig = (intPart + frac).replace(/^0+/, '').replace(/0+$/, '');
    if (sig.length > 6 || frac.length > MAX_FRAC_DIGITS) throw new EML.ParseError(LITERAL_ERR, 0);
    let p = BigInt((intPart + frac) || '0');
    let q = 10n ** BigInt(frac.length);
    if (p > 1000000n * q) throw new EML.ParseError(LITERAL_ERR, 0);
    const g = bgcd(p, q);
    p /= g;
    q /= g;
    return { p: Number(p), q: Number(q) };
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

  const opOf = (a) => (a.type === 'neg' ? 'neg' : a.type === 'bin' ? binOps[a.op] : a.name);
  const isZero = (z) => z.re === 0 && z.im === 0;
  const isReal1 = (z, v) => z.re === v && z.im === 0;

  // A genuine singularity of standard math: the op is not defined at these
  // (finite) inputs. Checked only where a node's output is not finite.
  const POLES = {
    div: (a, b) => isZero(b),
    inv: (z) => isZero(z),
    ln: (z) => isZero(z),
    logb: (b, z) => isZero(z) || isReal1(b, 1),
    pow: (a) => isZero(a),
    artanh: (z) => isReal1(z, 1) || isReal1(z, -1),
    arctan: (z) => z.re === 0 && (z.im === 1 || z.im === -1),
  };
  // Ops that can give an exact 0 from nonzero inputs without any underflow
  // (cancellation, ln 1, arcosh 1, ...). Anywhere else, a 0 out of nonzero
  // inputs means a value fell below the smallest double.
  const EXACT_ZERO = new Set(['add', 'sub', 'avg', 'hypot', 'ln', 'logb', 'arcosh', 'arccos']);
  // Ops whose overflow means the result itself is beyond the double range
  // (unlike, say, an inverse function that squares its argument internally).
  const GROWS = new Set(['exp', 'pow', 'sinh', 'cosh', 'mul', 'div', 'inv', 'add', 'sub', 'neg',
    'sqr', 'half', 'avg', 'hypot', 'sin', 'cos', 'tan']);

  // Standard-math value of the AST, plus the first node (post-order) whose
  // inputs are finite but whose output is not:
  //   failure = null | {kind: 'pole'} | {kind: 'range', cause: 'overflow'|'underflow', atRoot, grows}
  // A value that underflows to 0 is itself a range failure (it comes first, so
  // ln(exp(-800)) is reported as underflow, not as the pole ln 0).
  // Literals are cx(v, +0).
  EML.referenceTrace = (ast) => {
    const rec = EML.recipeById;
    let failure = null;
    // -> {v: value, uf: true when v is a 0 produced by underflow}
    const go = (a) => {
      let kids;
      switch (a.type) {
        case 'num': return { v: C.cx(a.value, 0), uf: false };
        case 'const':
          return {
            v: a.name === 'pi' ? C.cx(Math.PI, 0) : a.name === 'e' ? C.cx(Math.E, 0) : C.cx(0, 1),
            uf: false,
          };
        case 'neg': kids = [go(a.arg)]; break;
        case 'bin': kids = [go(a.left), go(a.right)]; break;
        case 'call': kids = a.args.map(go); break;
        default: throw new Error('Unknown AST node ' + a.type);
      }
      const op = opOf(a);
      const args = kids.map((k) => k.v);
      const anyUf = kids.some((k) => k.uf);
      const v = rec[op].ref(...args);
      if (!failure && args.every(C.isFinite) && !C.isFinite(v)) {
        if (POLES[op] && POLES[op](...args) && !anyUf) failure = { kind: 'pole', node: a };
        else {
          failure = {
            kind: 'range', node: a, atRoot: a === ast, grows: GROWS.has(op),
            cause: anyUf ? 'underflow' : 'overflow',
          };
        }
      }
      const freshUf = isZero(v) && !anyUf && !EXACT_ZERO.has(op) && args.every((x) => !isZero(x));
      // A value that fell below the smallest double is a range failure too: the
      // 0 it leaves behind must never be trusted (exp(-800)*exp(400)*exp(400) is 1).
      if (!failure && freshUf) {
        failure = { kind: 'range', node: a, atRoot: a === ast, grows: false, cause: 'underflow' };
      }
      return { v, uf: freshUf || (isZero(v) && anyUf) };
    };
    return { value: go(ast).v, failure };
  };

  // Standard-math value of the AST (a complex number). Pass `info` to also
  // receive the trace's failure (see referenceTrace).
  EML.reference = (ast, info) => {
    const t = EML.referenceTrace(ast);
    if (info) info.failure = t.failure;
    return t.value;
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

  // R23: every literal gets its own nudge factor (1 + k/7) for the k-th literal,
  // so a - a is no longer exactly 0 once nudged. Zero literals move by an
  // absolute step, nonzero ones by a relative one.
  const nudged = (lits, sign, step) => {
    const map = new Map();
    lits.forEach((l, k) => {
      const f = 1 + k / 7;
      const v = l.value === 0 ? sign * step.zero * f : l.value * (1 + sign * step.rel * f);
      map.set(l.id, C.cx(v, EML.ZERO));
    });
    return map;
  };

  // Steps are tried small-to-large. A zero step of 1e-14 keeps sqrt(0) honest (sqrt(step) << 1e-6),
  // but the per-node snap erases relative parts below 1e-12, so sin(0) (whose numerator is
  // exp(i*step) - exp(-i*step)) only survives from about 1e-12 up; likewise a cancellation
  // a - a leaves only ~rel*a/7. Each level is fully validated against the reference, so a
  // larger step can never turn a disagreement into a 'limit'.
  const STEPS = [1e-14, 1e-13, 1e-12, 1e-11, 1e-10].map((x) => ({ zero: x, rel: x }));

  const empty = (src, status, note, extra) => Object.assign({
    src, ast: null, call: null, root: null, K: null, height: null, unique: null,
    value: null, raw: null, ref: null, status, note, flags: null, overrides: null, range: null,
  }, extra);

  const UNDEFINED_NOTE = 'Not defined here in standard math either.';
  const OVERFLOW_NOTE = '64-bit floating point overflows along the way (a value beyond ~1.8e308), ' +
    'so neither side can give a number.';
  const UNDERFLOW_NOTE = '64-bit floating point runs out of range (a value below ~1e-308 ' +
    'rounds to 0), so neither side can give a number.';
  const EXCEEDS = ' The true value exceeds ~1.8e308.';

  // Note for a range failure of the reference (see referenceTrace).
  const rangeNote = (f) => (f.cause === 'underflow' ? UNDERFLOW_NOTE
    : OVERFLOW_NOTE + (f.atRoot && f.grows ? EXCEEDS : ''));

  // Note for a genuine EML/standard-math disagreement.
  EML.mismatchNote = (raw, ref) => (C.isFinite(raw)
    ? 'The EML tree and standard math disagree here (branch cut or precision). '
    : 'The EML route hits ln 0 / ∞ here, so the tree can’t finish. ') +
    'Standard math says ' + C.format(ref) + '.';

  // Limit check: nudge every literal slightly each way; if the EML tree settles
  // on the reference value from both sides, report it as a limit.
  const tryLimit = (rootNode, ref) => {
    const lits = collectLits(rootNode);
    if (!lits.length) return null;
    for (const step of STEPS) {
      const plus = nudged(lits, +1, step);
      const minus = nudged(lits, -1, step);
      const a = dag.evaluate(rootNode, { overrides: plus }).value;
      const b = dag.evaluate(rootNode, { overrides: minus }).value;
      if (!C.isFinite(a) || !C.isFinite(b)) continue;
      if (!C.approxEq(a, b, 1e-6, 1e-6)) continue;
      const avg = C.cx((a.re + b.re) / 2, (a.im + b.im) / 2);
      if (!C.approxEq(avg, ref, 1e-6, 1e-6)) continue;
      return { value: avg, overrides: plus };
    }
    return null;
  };

  const runUnsafe = (src) => {
    let ast;
    let call;
    try {
      ast = EML.parse(src);
      if (countNodes(ast) > MAX_NODES) throw new EML.ParseError(TOO_LONG, 0);
      call = EML.compile(ast);
    } catch (e) {
      if (e instanceof EML.ParseError) return empty(src, 'error', e.message);
      throw e; // unexpected: caught by the EML.run safety net
    }
    const rootNode = call.root;
    const info = {};
    const ref = EML.reference(ast, info);
    const base = {
      src, ast, call, root: rootNode,
      K: dag.K(rootNode), height: dag.height(rootNode), unique: dag.uniqueCount(rootNode),
      value: null, raw: null, ref, status: null, note: '', flags: null, overrides: null, range: null,
    };

    // 1. Standard math itself has no answer: a genuine pole somewhere (1/0, ln 0,
    //    artanh 1, ...; also 1/(1/0), whose root would otherwise come out finite).
    if (info.failure && info.failure.kind === 'pole') {
      return Object.assign(base, { status: 'undefined', value: ref, note: UNDEFINED_NOTE });
    }

    const { value: raw, flags } = dag.evaluate(rootNode, {});
    base.raw = raw;
    base.flags = flags;

    // 2. The reference left the 64-bit range somewhere, so there is nothing to
    //    check against: report it, and never present a number.
    if (info.failure || !C.isFinite(ref)) {
      const f = info.failure || { kind: 'range', cause: 'overflow', atRoot: true, grows: false };
      return Object.assign(base, {
        status: 'overflow', value: raw,
        range: { cause: f.cause, atRoot: f.atRoot, exceeds: f.cause === 'overflow' && f.atRoot && f.grows },
        note: rangeNote(f),
      });
    }

    // 3. The EML tree reproduces the reference.
    if (C.isFinite(raw) && C.approxEq(raw, ref, 1e-7)) {
      return Object.assign(base, { status: 'ok', value: raw });
    }

    // 4. A route computed an exp(...) beyond the 64-bit float range.
    if (flags.overflow || flags.underflow) {
      return Object.assign(base, {
        status: 'overflow', value: raw,
        note: 'This EML route computes an e^(\u2026) ' +
          (flags.overflow ? 'too big' : 'too small (below ~1e-308)') +
          ' for a 64-bit float, so the tree can\u2019t finish. ' +
          'Standard math says ' + C.format(ref) + '.',
      });
    }

    // 5. Approaching the point from both sides gives the reference value.
    const lim = tryLimit(rootNode, ref);
    if (lim) {
      return Object.assign(base, {
        status: 'limit', value: lim.value, overrides: lim.overrides,
        note: 'EML can\u2019t reach this point exactly \u2014 this is the limit as you approach it.',
      });
    }

    // 6. Genuine disagreement.
    return Object.assign(base, { status: 'mismatch', value: raw, note: EML.mismatchNote(raw, ref) });
  };

  // Safety net: whatever happens inside, run() always returns a Result and never throws.
  EML.run = (src) => {
    try {
      return runUnsafe(src);
    } catch (e) {
      if (typeof console !== 'undefined') console.error('EML.run: unexpected error', e);
      return empty(src, 'error', 'Something went wrong evaluating this expression.');
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
