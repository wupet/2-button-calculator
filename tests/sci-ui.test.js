const test = require('node:test');
const assert = require('node:assert/strict');
const EML = require('./load')({ ui: true });

const { modeSci } = EML;
const keys = (src) => modeSci.breakdown(EML.parse(src)).map((e) => e.key);

test('mode-sci loads without a document and init is a no-op', () => {
  assert.equal(typeof globalThis.document, 'undefined');
  for (const fn of ['init', 'breakdown', 'skeleton', 'positionsFor', 'badgeFor', 'exampleFor', 'sampleK']) {
    assert.equal(typeof modeSci[fn], 'function', fn);
  }
  assert.doesNotThrow(() => modeSci.init({}));
});

test('badgeFor covers all six statuses with the spec wording', () => {
  assert.deepEqual(modeSci.badgeFor('ok'), { text: '✓ matches standard math', tone: 'ok' });
  assert.deepEqual(modeSci.badgeFor('limit'), { text: '≈ limit', tone: 'limit' });
  assert.deepEqual(modeSci.badgeFor('overflow'), { text: '⚠ overflow', tone: 'warn' });
  assert.deepEqual(modeSci.badgeFor('mismatch'), { text: '≠ differs', tone: 'bad' });
  assert.deepEqual(modeSci.badgeFor('undefined'), { text: 'undefined', tone: 'muted' });
  assert.equal(modeSci.badgeFor('error').text, '');
  assert.equal(modeSci.badgeFor('error').tone, 'error');
  // Unknown statuses read as errors; callers cannot mutate the table.
  assert.equal(modeSci.badgeFor('nope').tone, 'error');
  modeSci.badgeFor('ok').text = 'changed';
  assert.equal(modeSci.badgeFor('ok').text, '✓ matches standard math');
});

test('breakdown lists distinct elements in reading order', () => {
  assert.deepEqual(keys('sin(2) + 3'), ['r:sin', 'num:2', 'r:add', 'num:3']);
  assert.deepEqual(keys('2 + 2 + 2'), ['num:2', 'r:add']);
  assert.deepEqual(keys('-x'.replace('x', '1')), ['r:neg', 'num:1']);
  assert.deepEqual(keys('pi * e'), ['r:pi', 'r:mul', 'r:e']);
  assert.deepEqual(keys('sqrt(-4)'), ['r:sqrt', 'r:neg', 'num:4']);
  assert.deepEqual(keys('log(2, 8)'), ['r:logb', 'num:2', 'num:8']);
  assert.deepEqual(keys('0.5 + 0.50'), ['num:0.5', 'r:add', 'num:0.50']);
});

test('breakdown entries carry symbol, name, formula, K and use count', () => {
  const entries = modeSci.breakdown(EML.parse('sin(2) + sin(3)'));
  const sin = entries.find((e) => e.key === 'r:sin');
  assert.equal(sin.kind, 'function');
  assert.equal(sin.symbol, 'sin');
  assert.equal(sin.name, EML.recipeById.sin.name);
  assert.equal(sin.formula, EML.recipeById.sin.formula);
  assert.equal(sin.uses, 2);
  // K of a sample build with a variable argument.
  const z = EML.calls.variable('z');
  assert.equal(sin.K, EML.dag.K(EML.R.call('sin', z).root));
  assert.ok(sin.K > 100);

  const add = entries.find((e) => e.key === 'r:add');
  assert.equal(add.kind, 'operator');
  assert.equal(add.symbol, '+');
  const two = entries.find((e) => e.key === 'num:2');
  assert.equal(two.kind, 'number');
  assert.equal(two.symbol, '2');
  assert.equal(two.K, EML.dag.K(EML.compile(EML.parse('2')).root));
  const pi = modeSci.breakdown(EML.parse('pi'))[0];
  assert.equal(pi.kind, 'constant');
  assert.equal(pi.symbol, 'π');
});

test('every breakdown entry has a positive K and a formula, for every recipe', () => {
  for (const r of EML.recipes) {
    const k = modeSci.sampleK(r.id);
    assert.ok(Number.isInteger(k) && k >= 1, `${r.id} K=${k}`);
  }
  assert.equal(modeSci.sampleK('one'), 1);
  assert.equal(modeSci.sampleK('e'), 3);
  assert.equal(modeSci.sampleK('exp'), 3);
  assert.equal(modeSci.sampleK('ln'), 7);
  assert.equal(modeSci.sampleK('sin'), EML.dag.K(EML.R.call('sin', EML.calls.variable('q')).root));
});

test('number cards describe how the literal is built', () => {
  const f = (t) => modeSci.breakdown(EML.parse(t))[0].formula;
  assert.equal(f('0'), 'ln(1)');
  assert.equal(f('1'), 'the constant 1');
  assert.equal(f('2'), '1 + 1');
  assert.match(f('13'), /doubling/);
  assert.equal(f('0.5'), '1 × (1 ÷ 2)');
  assert.ok(modeSci.numberK('13') > modeSci.numberK('2'));
});

test('exampleFor: every recipe gets an example that evaluates cleanly (status ok)', () => {
  for (const r of EML.recipes) {
    const ex = modeSci.exampleFor(r.id);
    assert.equal(typeof ex, 'string');
    const res = EML.run(ex);
    assert.equal(res.status, 'ok', `${r.id}: "${ex}" -> ${res.status} ${res.note}`);
  }
  assert.equal(modeSci.exampleFor('sin'), 'sin(1)');
  assert.equal(modeSci.exampleFor('logb'), 'log(2, 8)');
});

test('skeleton pairs each AST node with its call at the folded path', () => {
  const res = EML.run('sin(2) + 3');
  const skel = modeSci.skeleton(res.ast, res.call);
  assert.deepEqual(skel.map((s) => s.path), ['', '/0', '/0/0', '/1']);
  assert.deepEqual(skel.map((s) => s.key), ['r:add', 'r:sin', 'num:2', 'num:3']);
  assert.equal(skel[0].call, res.call);
  assert.equal(skel[2].call.prim, 'lit');
});

test('positionsFor finds an element folded, unfolded and inside a body', () => {
  const res = EML.run('sin(2) + 3');
  const skel = modeSci.skeleton(res.ast, res.call);
  const folded = EML.viewModel.build(res.call, {}).root;
  assert.deepEqual([...modeSci.positionsFor(folded, skel, 'r:sin')], ['/0']);
  assert.deepEqual([...modeSci.positionsFor(folded, skel, 'num:3')], ['/1']);
  assert.deepEqual([...modeSci.positionsFor(folded, skel, 'r:add')], ['']);
  assert.equal(modeSci.positionsFor(folded, skel, 'r:cos').size, 0);

  // Unfold sin: its spot becomes '/0>' (the body), and the literal 2 is drawn
  // again deeper inside that body.
  const unfolded = EML.viewModel.build(res.call, { unfolded: new Set(['/0']) }).root;
  const sinPos = modeSci.positionsFor(unfolded, skel, 'r:sin');
  assert.ok(sinPos.has('/0>'));
  const twoPos = modeSci.positionsFor(unfolded, skel, 'num:2');
  assert.ok(twoPos.size >= 1);
  for (const p of twoPos) assert.ok(p.startsWith('/0>'), p);
  // The sum itself is untouched by unfolding sin.
  assert.deepEqual([...modeSci.positionsFor(unfolded, skel, 'r:add')], ['']);
});

test('R13 caveat: only sin(sin(2)) trips the unfold-all cap; tan(2)+3, sin(2)+3 and sin(2) fit', () => {
  const tooBig = (src) => EML.viewModel.build(EML.run(src).call, { unfoldAll: true }, 1500);
  const a = tooBig('sin(sin(2))');
  assert.ok(a.tooBig);
  assert.equal(a.count, EML.run('sin(sin(2))').K);
  assert.ok(!tooBig('sin(2)').tooBig);
  assert.ok(!tooBig('sin(2)+3').tooBig);
  assert.ok(!tooBig('tan(2)+3').tooBig);
  assert.equal(tooBig('tan(2)+3').count, 1273);
});

test('limit results resolve with the nudged literals and end at the tidy value', () => {
  const res = EML.run('sin(0)');
  assert.equal(res.status, 'limit');
  const ev = EML.dag.makeEvaluator({ overrides: res.overrides });
  const vroot = EML.viewModel.build(res.call, {}).root;
  const resolver = new EML.Resolver(vroot, (n) => ev(n));
  while (!resolver.done && resolver.step().length) { /* run to the end */ }
  assert.ok(resolver.done);
  const top = resolver.values.get(vroot.path);
  assert.ok(Math.abs(top.re) < 1e-6 && Math.abs(top.im) < 1e-6);
  // A literal 0 resolves to its nudged value (about 1e-12), not 0.
  const zeroLeaf = [...resolver.values.entries()].find(([k]) => k === '/0');
  assert.ok(zeroLeaf && zeroLeaf[1].re > 0 && zeroLeaf[1].re < 1e-9);
});

test('resultView: ok and limit keep the EML value big, with no label or sub line', () => {
  const ok = modeSci.resultView(EML.run('ln(2)'));
  assert.deepEqual(ok, { big: '0.6931471806', bigLabel: '', sub: '' });
  const lim = modeSci.resultView(EML.run('sin(0)'));
  assert.deepEqual(lim, { big: '0', bigLabel: '', sub: '' });
  assert.equal(modeSci.resultView(EML.run('ln(-2)')).big, '0.6931471806 + 3.141592654i');
});

test('resultView: overflow leads with standard math and shows what the tree gave', () => {
  const r = EML.run('-1000');
  assert.equal(r.status, 'overflow');
  const v = modeSci.resultView(r);
  assert.equal(v.big, '\u22121000');
  assert.equal(v.bigLabel, 'standard math');
  assert.equal(v.sub, 'EML tree gave: ' + EML.C.format(r.value, 10));
  assert.equal(v.sub, 'EML tree gave: \u2212\u221e');
});

test('resultView: mismatch leads with standard math too (synthetic result)', () => {
  const C = EML.C;
  const r = { status: 'mismatch', value: C.cx(1, 2), ref: C.cx(3, 0) };
  assert.deepEqual(modeSci.resultView(r), { big: '3', bigLabel: 'standard math', sub: 'EML tree gave: 1 + 2i' });
});

test('resultView: undefined shows its value plainly; error shows nothing', () => {
  const u = EML.run('1/0');
  assert.equal(u.status, 'undefined');
  assert.deepEqual(modeSci.resultView(u), { big: 'undefined', bigLabel: '', sub: '' });
  assert.deepEqual(modeSci.resultView(EML.run('sin(')), { big: '', bigLabel: '', sub: '' });
});

test('EML.dom exposes el, btn and a live reduceMotion', () => {
  assert.equal(typeof EML.dom.el, 'function');
  assert.equal(typeof EML.dom.btn, 'function');
  assert.equal(EML.dom.reduceMotion(), false); // no matchMedia in Node
  const saved = globalThis.matchMedia;
  try {
    globalThis.matchMedia = () => ({ matches: true });
    assert.equal(EML.dom.reduceMotion(), true);
    globalThis.matchMedia = () => ({ matches: false });
    assert.equal(EML.dom.reduceMotion(), false);
  } finally {
    if (saved === undefined) delete globalThis.matchMedia; else globalThis.matchMedia = saved;
  }
});

// Spec "Verification" list, scientific mode, end to end: status, value, the
// result card text, every primitive in the dropdown, and step-resolve to the
// final value in both the Tree and Text views.
test('Verification list: scientific-mode expressions', () => {
  const C = EML.C;
  const num = (src) => EML.run(src).value;
  const approx = (z, re, im = 0, tol = 1e-9) => {
    assert.ok(Math.abs(z.re - re) <= tol * Math.max(1, Math.abs(re)), `re ${z.re} vs ${re}`);
    assert.ok(Math.abs(z.im - im) <= tol * Math.max(1, Math.abs(im)), `im ${z.im} vs ${im}`);
  };
  const cases = [
    ['ln(2)', Math.log(2)],
    ['sin(2)+3', Math.sin(2) + 3],
    ['sqrt(2)*pi', Math.SQRT2 * Math.PI],
    ['2^10', 1024],
    ['arcsin(0.5)', Math.asin(0.5)],
  ];
  for (const [src, want] of cases) {
    const r = EML.run(src);
    assert.equal(r.status, 'ok', src);
    approx(r.value, want);
    assert.deepEqual(modeSci.resultView(r), { big: C.format(r.value, 10), bigLabel: '', sub: '' }, src);
  }

  for (const [src, shown] of [['-1000', '−1000'], ['800+800', '1600']]) {
    const r = EML.run(src);
    assert.equal(r.status, 'overflow', src);
    const v = modeSci.resultView(r);
    assert.equal(v.big, shown, src);
    assert.equal(v.bigLabel, 'standard math', src);
  }

  for (const src of ['sin(0)', '0*5']) {
    const r = EML.run(src);
    assert.equal(r.status, 'limit', src);
    assert.equal(modeSci.resultView(r).big, '0', src);
    assert.match(r.note, /limit/);
  }

  approx(num('ln(-2)'), Math.log(2), Math.PI);
  assert.equal(modeSci.resultView(EML.run('ln(-2)')).big, '0.6931471806 + 3.141592654i');
  approx(num('sqrt(-4)'), 0, 2);
  assert.equal(modeSci.resultView(EML.run('sqrt(-4)')).big, '2i');

  // The dropdown (breakdown) shows each primitive that the expression uses.
  const used = (src) => modeSci.breakdown(EML.parse(src)).map((e) => e.key);
  assert.deepEqual(used('sqrt(2)*pi'), ['r:sqrt', 'num:2', 'r:mul', 'r:pi']);
  assert.deepEqual(used('2^10'), ['num:2', 'r:pow', 'num:10']);
  assert.deepEqual(used('arcsin(0.5)'), ['r:arcsin', 'num:0.5']);

  // Step-resolve reaches the final value, in both views (same Resolver feeds both).
  for (const src of ['ln(2)', 'sin(2)+3', 'sqrt(2)*pi', '2^10', 'arcsin(0.5)']) {
    const res = EML.run(src);
    for (const unfoldAll of [false, true]) {
      const vm = EML.viewModel.build(res.call, { unfoldAll }, 1500);
      if (vm.tooBig) continue;
      const resolver = new EML.Resolver(vm.root, EML.dag.makeEvaluator({}));
      while (!resolver.done && resolver.step().length) { /* to the end */ }
      assert.ok(resolver.done, `${src} unfoldAll=${unfoldAll}`);
      approx(resolver.values.get(vm.root.path), res.value.re, res.value.im);
      const lines = EML.TextView.serialize(vm.root, resolver);
      const last = lines[lines.length - 1].map((s) => s.text).join('');
      assert.equal(last, C.format(resolver.values.get(vm.root.path), 10), `${src} text view`);
    }
  }
});
