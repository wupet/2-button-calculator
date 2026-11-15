(function (root) {
  const EML = (root.EML = root.EML || {});
  const C = EML.C;
  const R = EML.R;
  const calls = EML.calls;
  const ref = C.ref;
  const cx = C.cx;

  // ---- Test points ----------------------------------------------------------
  // Zero is deliberately never an input here (zero points are handled by the
  // limit evaluation, tested elsewhere).
  const U = [-2.5, -1, -0.5, 0.3, 0.5, 1.7, 3];
  const P = [[2, 3], [-1.5, 0.5], [0.3, -2], [3, -2.5]];
  const unary = (pred) => U.filter(pred);
  const ALL = unary(() => true);
  const POS = unary((x) => x > 0);
  const OPEN1 = unary((x) => x > -1 && x < 1);
  const GT1 = unary((x) => x > 1);
  const NONZERO = unary((x) => x !== 0);

  // ---- The table ------------------------------------------------------------
  // Each build(R, ...args) is written only in terms of earlier entries (via the
  // recording façade R), so the call tree mirrors the bootstrapping order.
  const recipes = [];
  const recipeById = {};
  const def = (id, symbol, name, arity, deps, formula, explain, build, refFn, points, paperK) => {
    const entry = { id, symbol, name, arity, deps, formula, explain, build, ref: refFn, points };
    if (paperK !== undefined) entry.paperK = paperK;
    recipes.push(entry);
    recipeById[id] = entry;
  };

  def('one', '1', 'one', 0, [],
    'the constant 1',
    'The only constant the machine starts with; everything else is built from it.',
    (R_) => R_.one(),
    () => cx(1, 0), []);

  def('exp', 'exp', 'exponential', 1, [],
    'eml(z, 1)',
    'Feeding 1 into the second slot makes the log part vanish, leaving plain e to the power z.',
    (R_, z) => R_.eml(z, R_.one()),
    ref.exp, ALL, 3);

  def('e', 'e', 'Euler’s number', 0, [],
    'eml(1, 1)',
    'The very first thing you can build: e to the 1, minus the log of 1 (which is 0).',
    (R_) => R_.eml(R_.one(), R_.one()),
    () => cx(Math.E, 0), [], 3);

  def('ln', 'ln', 'natural logarithm', 1, [],
    'eml(1, eml(eml(1, z), 1))',
    'Three nested eml steps make the exponential and the logarithm cancel, leaving just the log of z.',
    (R_, z) => R_.eml(R_.one(), R_.eml(R_.eml(R_.one(), z), R_.one())),
    ref.ln, POS, 7);

  def('zero', '0', 'zero', 0, ['ln'],
    'ln(1)',
    'The log of 1 is 0, so zero is the log function applied to the one constant we have.',
    (R_) => R_.ln(R_.one()),
    () => cx(0, 0), [], 7);

  def('sub', '−', 'subtraction', 2, ['exp', 'ln'],
    'eml(ln a, exp b)',
    'eml computes e^x minus ln y; with x = ln a and y = e^b this is a minus b.',
    (R_, a, b) => R_.eml(R_.ln(a), R_.exp(b)),
    C.sub, P, 11);

  def('neg', '−', 'negation', 1, ['zero', 'sub'],
    '0 − z',
    'Negating is subtracting from zero (this leans on ln 0 being minus infinity).',
    (R_, z) => R_.sub(R_.zero(), z),
    C.neg, ALL);

  def('add', '+', 'addition', 2, ['sub', 'neg'],
    'a − (−b)',
    'Adding b is the same as subtracting its negative.',
    (R_, a, b) => R_.sub(a, R_.neg(b)),
    C.add, P, 27);

  def('inv', '1/z', 'reciprocal', 1, ['exp', 'neg', 'ln'],
    'exp(−ln z)',
    'Take the log, flip its sign, then undo the log: that turns z into 1 over z.',
    (R_, z) => R_.exp(R_.neg(R_.ln(z))),
    ref.inv, NONZERO);

  def('mul', '×', 'multiplication', 2, ['exp', 'add', 'ln'],
    'exp(ln a + ln b)',
    'Logs turn multiplying into adding, so add the logs and undo the log.',
    (R_, a, b) => R_.exp(R_.add(R_.ln(a), R_.ln(b))),
    C.mul, P, 41);

  def('div', '÷', 'division', 2, ['mul', 'inv'],
    'a × (1/b)',
    'Dividing by b is multiplying by its reciprocal.',
    (R_, a, b) => R_.mul(a, R_.inv(b)),
    C.div, P);

  def('pow', '^', 'power', 2, ['exp', 'mul', 'ln'],
    'exp(b × ln a)',
    'A power is a repeated multiplication, which logs turn into: b times the log of a, then undo the log.',
    (R_, a, b) => R_.exp(R_.mul(b, R_.ln(a))),
    ref.pow, [[2, 3], [0.3, -2], [3, -2.5], [1.7, 0.5]]);

  def('minusOne', '−1', 'minus one', 0, ['neg'],
    '−(1)',
    'Negate the constant 1.',
    (R_) => R_.neg(R_.one()),
    () => cx(-1, 0), [], 17);

  def('two', '2', 'two', 0, ['add'],
    '1 + 1',
    'Two is one plus one.',
    (R_) => R_.add(R_.one(), R_.one()),
    () => cx(2, 0), [], 27);

  // Branch policy ("snap to -0"): i = exp(ln(-1) / 2), pi = -i * ln(-1).
  def('i', 'i', 'imaginary unit', 0, ['exp', 'ln', 'minusOne', 'div', 'two'],
    'exp(ln(−1) ÷ 2)',
    'The log of −1 is pi times i; halve it and undo the log to get the square root of −1.',
    (R_) => R_.exp(R_.div(R_.ln(R_.minusOne()), R_.two())),
    () => cx(0, 1), []);

  def('pi', 'π', 'pi', 0, ['mul', 'neg', 'i', 'ln', 'minusOne'],
    '−i × ln(−1)',
    'The log of −1 is pi times i, so multiplying by minus i leaves pi.',
    (R_) => R_.mul(R_.neg(R_.i()), R_.ln(R_.minusOne())),
    () => cx(Math.PI, 0), []);

  def('half', 'half', 'half', 1, ['div', 'two'],
    'z ÷ 2',
    'Divide by two.',
    (R_, z) => R_.div(z, R_.two()),
    ref.half, ALL);

  def('sqr', 'sqr', 'square', 1, ['mul'],
    'z × z',
    'Multiply z by itself.',
    (R_, z) => R_.mul(z, z),
    ref.sqr, ALL);

  def('sqrt', '√', 'square root', 1, ['pow', 'inv', 'mul', 'two'],
    'z ^ (1/2)',
    'A square root is the power one half.',
    (R_, z) => R_.pow(z, R_.rational(1, 2)),
    ref.sqrt, POS);

  // Argument order matches the keypad: log(b, z) = log of z in base b.
  def('logb', 'log', 'logarithm to a base', 2, ['div', 'ln'],
    'ln z ÷ ln b',
    'The log in any base is the natural log of the number divided by the natural log of the base.',
    (R_, b, z) => R_.div(R_.ln(z), R_.ln(b)),
    ref.logb, [[2, 3], [3, 0.5], [0.5, 1.7], [3, 2.5], [1.7, 0.3]]);

  def('sinh', 'sinh', 'hyperbolic sine', 1, ['sub', 'exp', 'add', 'div', 'mul', 'two'],
    '(exp(2z) − 1) ÷ (2 × exp z)',
    'Written with exponentials: (e^2z − 1) divided by 2e^z, which equals (e^z − e^−z) / 2.',
    (R_, z) => R_.div(
      R_.sub(R_.exp(R_.add(z, z)), R_.one()),
      R_.mul(R_.two(), R_.exp(z))),
    ref.sinh, ALL);

  def('cosh', 'cosh', 'hyperbolic cosine', 1, ['add', 'exp', 'div', 'mul', 'two'],
    '(exp(2z) + 1) ÷ (2 × exp z)',
    'Written with exponentials: (e^2z + 1) divided by 2e^z, which equals (e^z + e^−z) / 2.',
    (R_, z) => R_.div(
      R_.add(R_.exp(R_.add(z, z)), R_.one()),
      R_.mul(R_.two(), R_.exp(z))),
    ref.cosh, ALL);

  def('tanh', 'tanh', 'hyperbolic tangent', 1, ['sub', 'add', 'exp', 'div'],
    '(exp(2z) − 1) ÷ (exp(2z) + 1)',
    'The ratio of the hyperbolic sine to the hyperbolic cosine, written with e^2z.',
    (R_, z) => R_.div(
      R_.sub(R_.exp(R_.add(z, z)), R_.one()),
      R_.add(R_.exp(R_.add(z, z)), R_.one())),
    ref.tanh, ALL);

  def('sigmoid', 'σ', 'logistic sigmoid', 1, ['div', 'add', 'exp', 'neg'],
    '1 ÷ (1 + exp(−z))',
    'Squashes any number into the range 0 to 1 with an S-shaped curve.',
    (R_, z) => R_.div(R_.one(), R_.add(R_.one(), R_.exp(R_.neg(z)))),
    ref.sigmoid, ALL);

  def('sin', 'sin', 'sine', 1, ['sub', 'exp', 'mul', 'i', 'neg', 'div', 'two'],
    '(exp(iz) − exp(−iz)) ÷ (2i)',
    'Euler’s formula: sine is the difference of two complex exponentials divided by 2i.',
    (R_, z) => R_.div(
      R_.sub(R_.exp(R_.mul(R_.i(), z)), R_.exp(R_.neg(R_.mul(R_.i(), z)))),
      R_.mul(R_.two(), R_.i())),
    ref.sin, ALL);

  def('cos', 'cos', 'cosine', 1, ['add', 'exp', 'mul', 'i', 'neg', 'div', 'two'],
    '(exp(iz) + exp(−iz)) ÷ 2',
    'Euler’s formula: cosine is the average of two complex exponentials.',
    (R_, z) => R_.div(
      R_.add(R_.exp(R_.mul(R_.i(), z)), R_.exp(R_.neg(R_.mul(R_.i(), z)))),
      R_.two()),
    ref.cos, ALL);

  def('tan', 'tan', 'tangent', 1, ['div', 'sin', 'cos'],
    'sin z ÷ cos z',
    'Tangent is sine divided by cosine.',
    (R_, z) => R_.div(R_.sin(z), R_.cos(z)),
    ref.tan, ALL);

  def('arcsin', 'arcsin', 'inverse sine', 1, ['mul', 'neg', 'i', 'ln', 'add', 'sqrt', 'sub', 'sqr'],
    '−i × ln(iz + √(1 − z²))',
    'Solves sin w = z using logs and a square root; the answer is the angle whose sine is z.',
    (R_, z) => R_.mul(R_.neg(R_.i()),
      R_.ln(R_.add(R_.mul(R_.i(), z), R_.sqrt(R_.sub(R_.one(), R_.sqr(z)))))),
    ref.asin, OPEN1);

  def('arccos', 'arccos', 'inverse cosine', 1, ['sub', 'div', 'pi', 'two', 'arcsin'],
    'π/2 − arcsin z',
    'The angle whose cosine is z is a quarter turn minus the angle whose sine is z.',
    (R_, z) => R_.sub(R_.div(R_.pi(), R_.two()), R_.arcsin(z)),
    ref.acos, OPEN1);

  def('arctan', 'arctan', 'inverse tangent', 1, ['mul', 'div', 'neg', 'i', 'two', 'ln', 'sub', 'add'],
    '(−i ÷ 2) × ln(−((z − i) ÷ (z + i)))',
    'Solves tan w = z using a complex logarithm; the answer is the angle whose tangent is z.',
    (R_, z) => R_.mul(R_.div(R_.neg(R_.i()), R_.two()),
      R_.ln(R_.neg(R_.div(R_.sub(z, R_.i()), R_.add(z, R_.i()))))),
    ref.atan, ALL);

  def('arsinh', 'arsinh', 'inverse hyperbolic sine', 1, ['ln', 'add', 'sqrt', 'sqr'],
    'ln(z + √(z² + 1))',
    'Solves sinh w = z with a logarithm and a square root.',
    (R_, z) => R_.ln(R_.add(z, R_.sqrt(R_.add(R_.sqr(z), R_.one())))),
    ref.asinh, ALL);

  def('arcosh', 'arcosh', 'inverse hyperbolic cosine', 1, ['ln', 'add', 'mul', 'sqrt', 'sub'],
    'ln(z + √(z+1) × √(z−1))',
    'Solves cosh w = z with a logarithm and two square roots.',
    (R_, z) => R_.ln(R_.add(z,
      R_.mul(R_.sqrt(R_.add(z, R_.one())), R_.sqrt(R_.sub(z, R_.one()))))),
    ref.acosh, GT1);

  def('artanh', 'artanh', 'inverse hyperbolic tangent', 1, ['half', 'ln', 'div', 'add', 'sub'],
    'half(ln((1+z) ÷ (1−z)))',
    'Solves tanh w = z: half the log of (1+z) over (1−z).',
    (R_, z) => R_.half(R_.ln(R_.div(R_.add(R_.one(), z), R_.sub(R_.one(), z)))),
    ref.atanh, OPEN1);

  def('avg', 'avg', 'average', 2, ['half', 'add'],
    'half(a + b)',
    'Add the two numbers and halve the total.',
    (R_, a, b) => R_.half(R_.add(a, b)),
    ref.avg, P);

  def('hypot', 'hypot', 'hypotenuse', 2, ['sqrt', 'add', 'sqr'],
    '√(a² + b²)',
    'The length of the diagonal of a right triangle with sides a and b (Pythagoras).',
    (R_, a, b) => R_.sqrt(R_.add(R_.sqr(a), R_.sqr(b))),
    ref.hypot, P);

  EML.recipes = recipes;
  EML.recipeById = recipeById;

  // ---- Shortcuts on the recorder façade --------------------------------------
  // 'one' stays the raw leaf (R.one is already the leaf constructor).
  for (const r of recipes) {
    if (r.id === 'one') continue;
    R[r.id] = (...args) => calls.invoke(r.id, args);
  }

  // ---- Integers and rationals -------------------------------------------------
  const intMemo = new Map();
  R.int = (n) => {
    if (!Number.isInteger(n)) throw new Error(`R.int needs an integer, got ${n}`);
    if (n === 0) return R.zero();
    if (n === 1) return R.one();
    let node = intMemo.get(n);
    if (node) return node;
    let body;
    if (n < 0) {
      body = R.neg(R.int(-n));
    } else {
      // Binary method over the bits of n, high to low (Horner form): double by
      // MULTIPLICATION, then add the 1 bit with the small operand on the right.
      // Both constraints come from the eml routes: add(a, b) = a - (-b) computes
      // exp(b), so any large right-hand operand overflows past ~709 (this is why
      // the low-to-high form acc + term cannot reach 1e6, and why
      // add(term, term) would cap integers near 1419). add(large, 1) and
      // mul(2, large) only ever take logs of large values, so they stay finite.
      const bits = n.toString(2);
      let acc = R.one();
      for (let k = 1; k < bits.length; k++) {
        acc = R.mul(R.two(), acc);
        if (bits[k] === '1') acc = R.add(acc, R.one());
      }
      body = acc;
    }
    node = { prim: 'int', args: [], body, root: body.root, label: String(n) };
    intMemo.set(n, node);
    return node;
  };

  const ratMemo = new Map();
  R.rational = (p, q) => {
    if (!Number.isInteger(p) || !Number.isInteger(q) || q <= 0) {
      throw new Error(`R.rational needs integer p and positive integer q, got ${p}/${q}`);
    }
    if (q === 1) return R.int(p);
    const label = `${p}/${q}`;
    let node = ratMemo.get(label);
    if (node) return node;
    const mag = R.mul(R.int(Math.abs(p)), R.inv(R.int(q)));
    const body = p < 0 ? R.neg(mag) : mag;
    node = { prim: 'rat', args: [], body, root: body.root, label };
    ratMemo.set(label, node);
    return node;
  };
})(typeof window !== 'undefined' ? window : globalThis);
