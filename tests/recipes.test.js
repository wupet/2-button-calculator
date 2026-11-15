const test = require('node:test');
const assert = require('node:assert/strict');
const EML = require('./load')();

const { C, dag, calls, R } = EML;
const { cx } = C;

const recipes = EML.recipes;
const byId = EML.recipeById;

const EXPECTED_IDS = [
  'one', 'exp', 'e', 'ln', 'zero', 'sub', 'neg', 'add', 'inv', 'mul', 'div', 'pow',
  'minusOne', 'two', 'i', 'pi', 'half', 'sqr', 'sqrt', 'logb', 'sinh', 'cosh', 'tanh',
  'sigmoid', 'sin', 'cos', 'tan', 'arcsin', 'arccos', 'arctan', 'arsinh', 'arcosh',
  'artanh', 'avg', 'hypot',
];

const fmt = (z) => C.format(z, 12);
const evalPure = (call, vars) => dag.evaluate(call.root, { vars });

test('recipe table has the expected ids in order', () => {
  assert.deepEqual(recipes.map((r) => r.id), EXPECTED_IDS);
  for (const r of recipes) assert.equal(byId[r.id], r);
});

test('every entry has the documented shape', () => {
  for (const r of recipes) {
    assert.equal(typeof r.symbol, 'string', r.id);
    assert.equal(typeof r.name, 'string', r.id);
    assert.ok(Number.isInteger(r.arity) && r.arity >= 0 && r.arity <= 2, r.id);
    assert.ok(Array.isArray(r.deps), r.id);
    assert.ok(r.formula && r.explain, r.id);
    assert.equal(typeof r.build, 'function', r.id);
    assert.equal(typeof r.ref, 'function', r.id);
    assert.ok(Array.isArray(r.points), r.id);
  }
});

test('every dep appears earlier in the table', () => {
  recipes.forEach((r, idx) => {
    for (const d of r.deps) {
      const at = recipes.findIndex((x) => x.id === d);
      assert.ok(at >= 0 && at < idx, `${r.id} depends on ${d}, which is not earlier`);
    }
  });
});

// Direct dependencies actually used by build() must be exactly the declared deps.
test('declared deps match the prims the builder actually calls', () => {
  const direct = (node, acc) => {
    switch (node.prim) {
      case '1': case 'var': case 'eml': case 'lit': break;
      case 'int': case 'rat': direct(node.body, acc); return acc;
      default: acc.add(node.prim);
    }
    for (const a of node.args) direct(a, acc);
    return acc;
  };
  for (const r of recipes) {
    if (r.id === 'one') continue;
    const vars = [calls.variable('x'), calls.variable('y')].slice(0, r.arity);
    const body = r.build(R, ...vars);
    const used = [...direct(body, new Set())].sort();
    assert.deepEqual(used, [...r.deps].sort(), `deps of ${r.id}`);
  }
});

test('accuracy: pure-EML DAG vs reference at every test point', () => {
  for (const r of recipes) {
    if (r.arity === 0) continue;
    assert.ok(r.points.length > 0, `${r.id} has test points`);
    const vars = ['x', 'y'].slice(0, r.arity).map((n) => calls.variable(n));
    const call = R.call(r.id, ...vars);
    for (const p of r.points) {
      const inputs = (Array.isArray(p) ? p : [p]).map((v) => cx(v));
      assert.equal(inputs.length, r.arity, `${r.id} point arity`);
      const env = { x: inputs[0], y: inputs[1] };
      const { value: got } = evalPure(call, env);
      const want = r.ref(...inputs);
      assert.ok(C.approxEq(got, want, 1e-9),
        `${r.id}(${JSON.stringify(p)}): got ${fmt(got)} (${got.re}, ${got.im}), want ${fmt(want)} (${want.re}, ${want.im})`);
    }
  }
});

test('accuracy: constants', () => {
  const val = (id) => evalPure(R.call(id), {}).value;
  assert.ok(C.approxEq(val('e'), cx(Math.E), 1e-9));
  assert.ok(C.approxEq(val('zero'), cx(0), 1e-9));
  assert.ok(C.approxEq(val('minusOne'), cx(-1), 1e-9));
  assert.ok(C.approxEq(val('two'), cx(2), 1e-9));
  assert.ok(C.approxEq(val('i'), cx(0, 1), 1e-9), `i = ${fmt(val('i'))}`);
  const pi = val('pi');
  assert.ok(C.approxEq(pi, cx(Math.PI), 1e-9), `pi = ${fmt(pi)}`);
  assert.ok(Math.abs(pi.im) <= 1e-9, 'pi imaginary part ~ 0');
  for (const r of recipes.filter((x) => x.arity === 0)) {
    assert.ok(C.approxEq(val(r.id), r.ref(), 1e-9), `ref of ${r.id}`);
  }
});

test('branch: eml-built ln of negative reals is the principal value', () => {
  const x = calls.variable('x');
  const lnX = R.call('ln', x);
  for (const v of [-1, -2, -0.5]) {
    const got = evalPure(lnX, { x: cx(v) }).value;
    const want = C.ref.ln(cx(v));
    assert.ok(C.approxEq(got, want, 1e-9), `ln(${v}) = ${fmt(got)}, want ${fmt(want)}`);
    assert.ok(got.im > 3.14 && got.im < 3.15, `ln(${v}) imaginary part is +pi`);
  }
  const sq = evalPure(R.call('sqrt', x), { x: cx(-4) }).value;
  assert.ok(C.approxEq(sq, cx(0, 2), 1e-9), `sqrt(-4) = ${fmt(sq)}`);
});

test('R shortcuts exist for every recipe except the raw leaf', () => {
  for (const r of recipes) {
    if (r.id === 'one') continue;
    assert.equal(typeof R[r.id], 'function', `R.${r.id}`);
  }
  const x = calls.variable('x');
  const c = R.ln(x);
  assert.equal(c.prim, 'ln');
  assert.equal(c.args[0], x);
  assert.equal(R.pi(), R.pi());
});

test('paper Table 4 K values', () => {
  const x = calls.variable('x');
  const y = calls.variable('y');
  const rows = [];
  for (const r of recipes) {
    const call = R.call(r.id, ...[x, y].slice(0, r.arity));
    const K = dag.K(call.root);
    rows.push([r.id, r.arity, K, dag.height(call.root), dag.uniqueCount(call.root), r.paperK ?? '']);
    if (r.paperK !== undefined) assert.equal(K, r.paperK, `K(${r.id})`);
  }
  const want = { exp: 3, e: 3, ln: 7, zero: 7, sub: 11, add: 27, mul: 41, minusOne: 17, two: 27 };
  for (const [id, k] of Object.entries(want)) {
    assert.equal(byId[id].paperK, k, `paperK stored for ${id}`);
  }
  const pad = (s, n) => String(s).padEnd(n);
  const lines = ['id        arity  K            height  unique  paperK'];
  for (const [id, ar, K, h, u, pk] of rows) {
    lines.push(`${pad(id, 10)}${pad(ar, 7)}${pad(K, 13)}${pad(h, 8)}${pad(u, 8)}${pk}`);
  }
  console.log('\nK table (variables x,y count as leaves)\n' + lines.join('\n'));
});

test('integers by doubling and rationals', () => {
  assert.equal(R.int(0), R.zero());
  assert.equal(R.int(1).root, R.one().root);
  assert.equal(R.int(1).prim, '1');
  assert.equal(R.int(1000), R.int(1000), 'memoised');
  assert.equal(R.int(1000).prim, 'int');
  assert.equal(R.int(1000).label, '1000');
  const v1000 = evalPure(R.int(1000), {}).value;
  assert.ok(C.approxEq(v1000, cx(1000), 1e-9), `int(1000) = ${fmt(v1000)}`);
  const v1m = evalPure(R.int(1000000), {}).value;
  assert.ok(C.approxEq(v1m, cx(1e6), 1e-9), `int(1e6) = ${fmt(v1m)}`);
  for (const n of [2, 3, 5, 7, 10, 12, 255, -1, -5, -17]) {
    const v = evalPure(R.int(n), {}).value;
    assert.ok(C.approxEq(v, cx(n), 1e-9), `int(${n}) = ${fmt(v)}`);
  }
  const r = R.rational(-3, 4);
  assert.equal(r.prim, 'rat');
  assert.equal(r.label, '-3/4');
  assert.ok(C.approxEq(evalPure(r, {}).value, cx(-0.75), 1e-9));
  assert.ok(C.approxEq(evalPure(R.rational(1, 2), {}).value, cx(0.5), 1e-9));
  assert.equal(R.rational(5, 1), R.int(5));
});

test('overflow flag: 1 - 800 routes through exp(800)', () => {
  const int800 = R.int(800);
  const { value, flags } = evalPure(R.sub(R.one(), int800), {});
  assert.equal(flags.overflow, true);
  assert.ok(!C.isFinite(value) || value.re !== 1 - 800);
});

test('int(2) is the two constant itself, so small integers stay lean', () => {
  const n2 = R.int(2);
  assert.equal(n2.prim, 'int');
  assert.equal(n2.label, '2');
  assert.ok(n2.body === R.two(), "int(2) body is the two CallNode");
  assert.equal(dag.K(n2.root), dag.K(R.two().root));
  assert.equal(dag.K(n2.root), 27);
  // int(3) = two + 1 (no mul(two, one) detour)
  assert.equal(dag.K(R.int(3).root), dag.K(R.add(R.two(), R.one()).root));
});
