const test = require('node:test');
const assert = require('node:assert/strict');
const EML = require('./load')();

const { C, dag, calls, R } = EML;
const { cx } = C;

test('hash-consing shares one/var/eml but never lit', () => {
  const one = dag.one();
  assert.equal(one, dag.one());
  assert.equal(dag.variable('x'), dag.variable('x'));
  assert.notEqual(dag.variable('x'), dag.variable('y'));
  assert.equal(dag.eml(dag.one(), dag.one()), dag.eml(dag.one(), dag.one()));
  const a = dag.literal(one, 1);
  const b = dag.literal(one, 1);
  assert.notEqual(a.id, b.id);
  assert.equal(a.kind, 'lit');
  assert.equal(a.inner, one);
  assert.equal(a.value, 1);
});

test('eml(1,1) = e, K = 3, height = 1', () => {
  const n = dag.eml(dag.one(), dag.one());
  const { value, flags } = dag.evaluate(n);
  assert.ok(C.approxEq(value, cx(Math.E)));
  assert.equal(dag.K(n), 3);
  assert.equal(dag.height(n), 1);
  assert.equal(dag.height(dag.one()), 0);
  assert.equal(dag.uniqueCount(n), 2);
  assert.equal(flags.overflow, undefined);
});

test('ln built from raw nodes (paper 4.1)', () => {
  const one = dag.one();
  const X = dag.variable('x');
  const L = dag.eml(one, dag.eml(dag.eml(one, X), one));
  const { value } = dag.evaluate(L, { vars: { x: cx(2) } });
  assert.ok(C.approxEq(value, cx(Math.LN2)));
  assert.equal(dag.K(L), 7);
  assert.equal(dag.rpn(L), '11xE1EE');
  assert.equal(dag.rpn(L, 5), null);
  assert.equal(dag.rpn(one), '1');
  assert.equal(dag.rpn(X), 'x');
});

test('overrides replace literal nodes', () => {
  const one = dag.one();
  const lit = dag.literal(one, 1);
  const n = dag.eml(lit, one);
  const overrides = new Map([[lit.id, cx(2)]]);
  const { value } = dag.evaluate(n, { overrides });
  assert.ok(C.approxEq(value, cx(Math.exp(2))));
  // without override a lit evaluates as its inner
  assert.ok(C.approxEq(dag.evaluate(n).value, cx(Math.E)));
  assert.equal(dag.K(lit), 1);
  assert.equal(dag.K(n), 3);
});

test('evaluator exposes flags and memoises across calls', () => {
  const one = dag.one();
  const big = dag.eml(dag.variable('b'), one);
  const ev = dag.makeEvaluator({ vars: { b: cx(1000) } });
  assert.ok(!C.isFinite(ev(big)));
  assert.equal(ev.flags.overflow, true);
  assert.equal(ev(big), ev(big));
  assert.throws(() => dag.evaluate(dag.variable('nope')), /nope/);
});

test('deep chain (3000) does not overflow the stack', () => {
  const one = dag.one();
  let prev = one;
  for (let i = 0; i < 3000; i++) prev = dag.eml(one, prev);
  assert.doesNotThrow(() => dag.evaluate(prev));
  assert.equal(dag.height(prev), 3000);
  assert.equal(dag.K(prev), 6001);
  assert.equal(dag.uniqueCount(prev), 3001);
  assert.equal(dag.rpn(prev), null);
});

test('calls recorder: primitives', () => {
  const e = calls.eml(calls.one(), calls.one());
  assert.equal(e.label, 'eml');
  assert.equal(e.prim, 'eml');
  assert.equal(e.body, null);
  assert.equal(e.root, dag.eml(dag.one(), dag.one()));
  const o = calls.one();
  assert.deepEqual([o.prim, o.label, o.body, o.args], ['1', '1', null, []]);
  const v = calls.variable('x');
  assert.deepEqual([v.prim, v.label], ['var', 'x']);
  assert.equal(v.root, dag.variable('x'));
});

test('calls.literal wraps a body in a fresh lit', () => {
  const body = calls.one();
  const l1 = calls.literal(1, '1', body);
  const l2 = calls.literal(1, '1', body);
  assert.equal(l1.prim, 'lit');
  assert.equal(l1.label, '1');
  assert.equal(l1.value, 1);
  assert.equal(l1.body, body);
  assert.equal(l1.root.kind, 'lit');
  assert.equal(l1.root.inner, body.root);
  assert.notEqual(l1.root, l2.root);
});

test('calls.invoke uses recipeById lazily; zero-arity memoised', () => {
  const saved = EML.recipeById;
  try {
    let builds = 0;
    EML.recipeById = {
      myexp: { symbol: 'exp', arity: 1, build: (r, a) => r.eml(a, r.one()) },
      myE: { symbol: 'e', arity: 0, build: (r) => { builds++; return r.call('myexp', r.one()); } },
    };
    const x = calls.variable('x');
    const c = calls.invoke('myexp', [x]);
    assert.equal(c.prim, 'myexp');
    assert.equal(c.label, 'exp');
    assert.equal(c.args[0], x);
    assert.equal(c.body.prim, 'eml');
    assert.equal(c.root, c.body.root);
    assert.equal(calls.invoke('myexp', [x], 'EXP').label, 'EXP');

    const e1 = calls.invoke('myE', []);
    const e2 = R.call('myE');
    assert.equal(e1, e2);
    assert.equal(builds, 1);
    assert.equal(e1.label, 'e');
    assert.ok(C.approxEq(dag.evaluate(e1.root).value, cx(Math.E)));
    assert.throws(() => calls.invoke('missing', []), /missing/);
  } finally {
    EML.recipeById = saved;
  }
});

test('R facade', () => {
  const e = R.eml(R.one(), R.one());
  assert.equal(e.root, dag.eml(dag.one(), dag.one()));
});
