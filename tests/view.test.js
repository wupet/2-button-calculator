const test = require('node:test');
const assert = require('node:assert/strict');
const EML = require('./load')();

const comp = (src) => EML.compile(EML.parse(src));
const walk = (v, f) => { f(v); v.children.forEach((c) => walk(c, f)); };
const close = (z, re, im = 0) => {
  assert.ok(Math.abs(z.re - re) < 1e-9 * Math.max(1, Math.abs(re)), `re ${z.re} vs ${re}`);
  assert.ok(Math.abs(z.im - im) < 1e-9, `im ${z.im} vs ${im}`);
};

test('build: folded ln(2) is a blob with one literal child', () => {
  const r = EML.viewModel.build(comp('ln(2)'));
  assert.equal(r.root.kind, 'blob');
  assert.equal(r.root.label, 'ln');
  assert.equal(r.root.path, '');
  assert.equal(r.root.children.length, 1);
  assert.equal(r.root.children[0].kind, 'blob');
  assert.equal(r.root.children[0].label, '2');
  assert.equal(r.root.children[0].path, '/0');
  assert.equal(r.count, 2);
});

test('build: unfolding the root of ln(2) shows its eml body', () => {
  const r = EML.viewModel.build(comp('ln(2)'), { unfolded: new Set(['']) });
  assert.equal(r.root.kind, 'eml');
  assert.equal(r.root.path, '>');
  let sawLit = false;
  walk(r.root, (v) => { if (v.kind === 'blob' && v.label === '2') sawLit = true; });
  assert.ok(sawLit);
});

test('build: unfoldAll beyond the cap is too big and reports full size', () => {
  // Brief said sin(2), but K(sin(2)) is 635 (< 1500); sin(sin(2)) is 1851.
  const r = EML.viewModel.build(comp('sin(sin(2))'), { unfoldAll: true }, 1500);
  assert.equal(r.tooBig, true);
  assert.ok(r.count > 1500);
  const s = EML.viewModel.build(comp('sin(2)'), { unfoldAll: true }, 500);
  assert.equal(s.tooBig, true);
  assert.equal(s.count, 635);
  assert.ok(!EML.viewModel.build(comp('sin(2)'), { unfoldAll: true }, 1500).tooBig);
});

test('build: unfoldAll on exp(1) is only one/eml, 3 nodes', () => {
  const r = EML.viewModel.build(comp('exp(1)'), { unfoldAll: true });
  assert.ok(!r.tooBig);
  walk(r.root, (v) => assert.ok(['one', 'eml'].includes(v.kind), v.kind));
  assert.equal(r.count, 3);
});

test('Resolver: sin(2)+3 folded steps to the answer', () => {
  const r = EML.viewModel.build(comp('sin(2)+3'));
  const res = new EML.Resolver(r.root, EML.dag.makeEvaluator({}));
  assert.equal(res.totalSteps, 3);
  assert.equal(res.stepIndex, 0);
  const f1 = res.frontier().map((v) => v.path);
  assert.deepEqual(f1, ['/0/0', '/1']);
  res.step();
  assert.equal(res.stepIndex, 1);
  res.back();
  assert.equal(res.stepIndex, 0);
  assert.deepEqual(res.frontier().map((v) => v.path), f1);
  while (!res.done) res.step();
  assert.equal(res.stepIndex, 3);
  close(res.values.get(''), Math.sin(2) + 3);
  res.reset();
  assert.equal(res.stepIndex, 0);
  assert.equal(res.done, false);
  assert.equal(res.values.has(''), false);
});

test('Resolver: fully unfolded exp(1) gives e', () => {
  const r = EML.viewModel.build(comp('exp(1)'), { unfoldAll: true });
  const res = new EML.Resolver(r.root, EML.dag.makeEvaluator({}));
  assert.equal(res.totalSteps, 1);
  while (!res.done) res.step();
  close(res.values.get(r.root.path), Math.E);
});
