const test = require('node:test');
const assert = require('node:assert/strict');
const EML = require('./load')();

const near = (z, re, im = 0, tol = 1e-6) => {
  assert.ok(Math.abs(z.re - re) <= tol && Math.abs(z.im - im) <= tol,
    `expected ${re}+${im}i, got ${z.re}+${z.im}i`);
};

test('numberToRational is exact and reduced', () => {
  assert.deepEqual(EML.numberToRational('0.5'), { p: 1, q: 2 });
  assert.deepEqual(EML.numberToRational('2.50'), { p: 5, q: 2 });
  assert.deepEqual(EML.numberToRational('3'), { p: 3, q: 1 });
  assert.deepEqual(EML.numberToRational('.25'), { p: 1, q: 4 });
  assert.deepEqual(EML.numberToRational('0'), { p: 0, q: 1 });
  assert.deepEqual(EML.numberToRational('1000000'), { p: 1000000, q: 1 });
});

test('numberToRational enforces the literal cap', () => {
  for (const t of ['1234567.8', '1234567', '1000001', '0.1234567']) {
    assert.throws(() => EML.numberToRational(t), (e) =>
      e instanceof EML.ParseError && /Number too long/.test(e.message), t);
  }
});

test('compile builds the right recipe tree', () => {
  const c = EML.compile(EML.parse('1+2'));
  assert.equal(c.prim, 'add');
  assert.equal(EML.compile(EML.parse('pi')).prim, 'pi');
  assert.equal(EML.compile(EML.parse('-3')).prim, 'neg');
  assert.equal(EML.compile(EML.parse('2^3')).prim, 'pow');
  assert.equal(EML.compile(EML.parse('sin(1)')).prim, 'sin');
  assert.equal(EML.compile(EML.parse('2')).prim, 'lit');
});

test('reference evaluates standard math', () => {
  near(EML.reference(EML.parse('2^10')), 1024);
  near(EML.reference(EML.parse('ln(-2)')), Math.log(2), Math.PI);
  near(EML.reference(EML.parse('i*i')), -1, 0);
});

const okCases = [
  ['ln(2)', Math.LN2], ['sin(2)+3', Math.sin(2) + 3], ['sqrt(2)*pi', Math.SQRT2 * Math.PI],
  ['2^10', 1024], ['arcsin(0.5)', Math.asin(0.5)], ['hypot(3,4)', 5], ['log(2,8)', 3],
  ['0.1+0.2', 0.3], ['500+500', 1000],
];
for (const [src, want] of okCases) {
  test(`ok: ${src}`, () => {
    const r = EML.run(src);
    assert.equal(r.status, 'ok', `${src}: ${r.status} ${r.note}`);
    near(r.value, want, 0, 1e-6 * Math.max(1, Math.abs(want)));
  });
}

test('ok (complex): ln(-2), sqrt(-4), i*i', () => {
  let r = EML.run('ln(-2)');
  assert.equal(r.status, 'ok');
  near(r.value, Math.log(2), Math.PI);
  r = EML.run('sqrt(-4)');
  assert.equal(r.status, 'ok');
  near(r.value, 0, 2);
  r = EML.run('i*i');
  assert.equal(r.status, 'ok');
  near(r.value, -1, 0);
});

for (const src of ['0*5', 'sin(0)', 'tanh(0)', 'sqrt(0)']) {
  test(`limit: ${src}`, () => {
    const r = EML.run(src);
    assert.equal(r.status, 'limit', `${src}: ${r.status} ${r.note}`);
    near(r.value, 0, 0, 1e-6);
    assert.match(r.note, /limit/);
    assert.ok(r.overrides instanceof Map);
  });
}

for (const src of ['-1000', '800+800', '1-800']) {
  test(`overflow: ${src}`, () => {
    const r = EML.run(src);
    assert.equal(r.status, 'overflow', `${src}: ${r.status} ${r.note}`);
    assert.match(r.note, /64-bit/);
  });
}

for (const src of ['1/0', 'ln(0)']) {
  test(`undefined: ${src}`, () => {
    const r = EML.run(src);
    assert.equal(r.status, 'undefined');
    assert.equal(r.note, 'Not defined here in standard math either.');
  });
}

test('error: parse errors and literal cap', () => {
  let r = EML.run('sin(');
  assert.equal(r.status, 'error');
  assert.ok(r.note.length > 0);
  assert.equal(r.root, null);
  r = EML.run('1234567.8');
  assert.equal(r.status, 'error');
  assert.match(r.note, /Number too long/);
});

test('error: expression too long (R8)', () => {
  const r = EML.run(Array(300).fill('1').join('+'));
  assert.equal(r.status, 'error');
  assert.equal(r.note, 'Expression too long for this demo');
  assert.equal(EML.run(Array(60).fill('1').join('+')).status !== 'error', true);
});

test('result carries metrics', () => {
  const r = EML.run('ln(2)');
  assert.ok(r.K > 0 && r.height > 0 && r.unique > 0);
  assert.ok(r.call && r.root && r.ast);
  assert.equal(r.src, 'ln(2)');
});

test('perf: sin(cos(tan(2)))+3', () => {
  const t0 = Date.now();
  const r = EML.run('sin(cos(tan(2)))+3');
  const ms = Date.now() - t0;
  assert.equal(r.status, 'ok', r.note);
  assert.ok(ms < 2000, `took ${ms} ms`);
});

test('numberToRational is exact for long zero tails and rejects absurd sizes', () => {
  assert.deepEqual(EML.numberToRational('0.5' + '0'.repeat(25)), { p: 1, q: 2 });
  assert.deepEqual(EML.numberToRational('000012.50'), { p: 25, q: 2 });
  assert.throws(() => EML.numberToRational('0.' + '0'.repeat(400) + '1'), (e) =>
    e instanceof EML.ParseError && /Number too long/.test(e.message));
  assert.throws(() => EML.numberToRational('1' + '0'.repeat(400)), (e) =>
    e instanceof EML.ParseError && /Number too long/.test(e.message));
});

test('run never throws on pathological literals', () => {
  let r = EML.run('0.5' + '0'.repeat(400));
  assert.equal(r.status, 'ok');
  near(r.value, 0.5);
  r = EML.run('0.' + '0'.repeat(400) + '1');
  assert.equal(r.status, 'error');
  assert.match(r.note, /Number too long/);
});

test('run safety net: unexpected internal errors become status error', () => {
  const orig = EML.reference;
  const origErr = console.error;
  const logged = [];
  console.error = (...args) => { logged.push(args); };
  EML.reference = () => { throw new Error('boom'); };
  try {
    const r = EML.run('1+1');
    assert.equal(r.status, 'error');
    assert.equal(r.note, 'Something went wrong evaluating this expression.');
    // The swallowed error is reported, not hidden.
    assert.equal(logged.length, 1);
    assert.equal(logged[0][1].message, 'boom');
  } finally {
    EML.reference = orig;
    console.error = origErr;
  }
});

test('mismatch: arccos(2) disagrees honestly (branch cut)', () => {
  const r = EML.run('arccos(2)');
  assert.equal(r.status, 'mismatch');
  assert.match(r.note, /standard math/i);
  assert.ok(r.raw && r.ref);
});

test('tan(pi/2) is neither ok nor a limit', () => {
  const r = EML.run('tan(pi/2)');
  assert.notEqual(r.status, 'ok');
  assert.notEqual(r.status, 'limit');
  assert.match(r.note, /standard math/i);
});

test('run: scientific notation is an error', () => {
  const r = EML.run('1e5');
  assert.equal(r.status, 'error');
  assert.match(r.note, /Scientific notation/);
});
