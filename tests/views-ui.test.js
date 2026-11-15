const test = require('node:test');
const assert = require('node:assert/strict');
const EML = require('./load')({ ui: true });

const { C } = EML;
const comp = (src) => EML.compile(EML.parse(src));
const build = (src, opts) => EML.viewModel.build(comp(src), opts).root;
const resolverFor = (vroot) => new EML.Resolver(vroot, EML.dag.makeEvaluator({}));
const flat = (line) => line.map((s) => s.text).join('');
const marked = (line) => line.filter((s) => s.mark).map((s) => s.text);
const noOverlap = (lay) => {
  for (let i = 0; i < lay.nodes.length; i++) {
    for (let j = i + 1; j < lay.nodes.length; j++) {
      const a = lay.nodes[i];
      const b = lay.nodes[j];
      if (a.y === b.y) assert.ok(Math.abs(a.x - b.x) >= (a.w + b.w) / 2, `overlap ${a.path} / ${b.path}`);
    }
  }
};

test('UI scripts define their pure functions without a document', () => {
  assert.equal(typeof EML.TreeView, 'function');
  assert.equal(typeof EML.TreeView.layout, 'function');
  assert.equal(typeof EML.TextView.serialize, 'function');
  assert.equal(typeof EML.modeTwo.init, 'function');
  assert.equal(typeof globalThis.document, 'undefined');
});

test('layout: exp(1) is E over two 1 leaves', () => {
  const lay = EML.TreeView.layout(build('exp(1)', { unfoldAll: true }));
  assert.equal(lay.nodes.length, 3);
  assert.equal(lay.edges.length, 2);
  const byPath = new Map(lay.nodes.map((n) => [n.path, n]));
  const [p, a, b] = lay.nodes;
  assert.equal(p.kind, 'eml');
  assert.deepEqual(lay.edges.map((e) => e[0]), [p.path, p.path]);
  const [c0, c1] = lay.edges.map((e) => byPath.get(e[1]));
  assert.ok(Math.abs(p.x - (c0.x + c1.x) / 2) < 1e-9);
  assert.ok(a.y > p.y && b.y > p.y);
  assert.equal(a.y, b.y);
  assert.ok(a.x < b.x);
  assert.ok(lay.width > 0 && lay.height > 0);
  noOverlap(lay);
});

test('layout: parent x is mean of children, y grows with depth, no overlap (sin(2) unfolded)', () => {
  const lay = EML.TreeView.layout(build('sin(2)', { unfoldAll: true }));
  const byPath = new Map(lay.nodes.map((n) => [n.path, n]));
  const kids = new Map();
  for (const [f, t] of lay.edges) {
    if (!kids.has(f)) kids.set(f, []);
    kids.get(f).push(byPath.get(t));
  }
  for (const [f, cs] of kids) {
    const p = byPath.get(f);
    const mean = cs.reduce((s, c) => s + c.x, 0) / cs.length;
    assert.ok(Math.abs(p.x - mean) < 1e-6, `mean at ${f}`);
    for (const c of cs) assert.ok(c.y > p.y);
  }
  for (const n of lay.nodes) {
    assert.ok(n.x - n.w / 2 >= 0 && n.x + n.w / 2 <= lay.width, 'inside the drawing');
    assert.ok(n.y + n.h / 2 <= lay.height);
  }
  noOverlap(lay);
});

test('layout: wide folded blobs on one row do not overlap', () => {
  noOverlap(EML.TreeView.layout(build('sin(2)+cos(3)*ln(5)')));
});

test('prune: resolved positions become chips, their subtrees vanish', () => {
  const root = build('sin(2)+3');
  const res = resolverFor(root);
  while (res.stepIndex < 2) res.step();
  const pruned = EML.TreeView.prune(root, res);
  const chips = [];
  (function walk(v) { if (v.kind === 'chip') chips.push(v); v.children.forEach(walk); })(pruned);
  assert.ok(chips.length >= 1);
  for (const c of chips) assert.equal(c.children.length, 0);
  assert.equal(EML.TreeView.prune(root, null), root);
});

test('serialize: ln(2) folded, step 0 is one unmarked line', () => {
  const root = build('ln(2)');
  const lines = EML.TextView.serialize(root, resolverFor(root));
  assert.equal(lines.length, 1);
  assert.equal(flat(lines[0]), 'ln(2)');
  assert.deepEqual(marked(lines[0]), []);
});

test('serialize: stepping ln(2) marks what resolved; last line is the value', () => {
  const root = build('ln(2)');
  const res = resolverFor(root);
  res.step();
  let lines = EML.TextView.serialize(root, res);
  assert.equal(lines.length, 2);
  assert.equal(flat(lines[1]), 'ln(2)');
  assert.deepEqual(marked(lines[1]), ['2']);
  assert.equal(flat(lines[0]), 'ln(2)');
  assert.deepEqual(marked(lines[0]), []);

  while (!res.done) res.step();
  lines = EML.TextView.serialize(root, res);
  assert.equal(lines.length, res.stepIndex + 1);
  const last = lines[lines.length - 1];
  assert.equal(flat(last), C.format(res.values.get(''), 10));
  assert.equal(flat(last), '0.6931471806');
  assert.deepEqual(marked(last), ['0.6931471806']);
});

test('serialize: unfolded exp(1) prints eml(1, 1) then e; null resolver gives one line', () => {
  const root = build('exp(1)', { unfoldAll: true });
  const res = resolverFor(root);
  res.step();
  const lines = EML.TextView.serialize(root, res);
  assert.equal(flat(lines[0]), 'eml(1, 1)');
  assert.equal(flat(lines[1]), '2.718281828');
  assert.equal(EML.TextView.serialize(root, null).length, 1);
});

test('serialize: lines beyond 2000 chars are cut in the middle with a symbol count', () => {
  const root = build('sin(2)', { unfoldAll: true });
  const text = flat(EML.TextView.serialize(root, resolverFor(root))[0]);
  const m = /…\((\d+) symbols\)…/.exec(text);
  assert.ok(m, 'marker present');
  assert.ok(text.length <= 2000);
  assert.ok(text.startsWith('eml('));
  assert.ok(text.endsWith(')'));
  const ser = (v) => (v.kind === 'one' ? '1' : `eml(${ser(v.children[0])}, ${ser(v.children[1])})`);
  const full = ser(root);
  assert.ok(full.length > 2000);
  assert.equal(Number(m[1]), full.length - 1800);
  assert.equal(text.length - m[0].length + Number(m[1]), full.length);
  // Short lines are untouched.
  const short = build('exp(1)', { unfoldAll: true });
  assert.ok(!flat(EML.TextView.serialize(short, resolverFor(short))[0]).includes('symbols'));
});

test('badgeText: exclamation only for named constants', () => {
  assert.equal(EML.modeTwo.badgeText(C.cx(Math.E, 0)), '= e!');
  assert.equal(EML.modeTwo.badgeText(C.cx(Math.PI, 0)), '= π!');
  assert.equal(EML.modeTwo.badgeText(C.cx(2, 0)), '= 2');
  assert.equal(EML.modeTwo.badgeText(C.cx(3.3, 0)), '');
});

test('pressing 1 1 EML gives a drawable 3-node tree', () => {
  const m = new EML.RpnMachine();
  m.push1(); m.push1(); m.pressEml();
  const r = EML.viewModel.build(m.top.call, { unfoldAll: true });
  assert.equal(r.count, 3);
  assert.equal(EML.TreeView.layout(r.root).nodes.length, 3);
});
