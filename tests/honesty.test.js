const test = require('node:test');
const assert = require('node:assert/strict');
const EML = require('./load')({ ui: true });

// Regression corpus for the whole-branch review: the page must never present
// an unverified digit, a fake number or a wrong "undefined" as correct.
const { C, modeSci } = EML;
const cx = C.cx;
const MINUS = '−';

// Parse a displayed value ("1.5 − 2i", "−1e-9", "3i") back into a complex number.
function parseShown(s) {
  const t = s.replace(/−/g, '-').replace(/\s+/g, '');
  const m = /^([+-]?[0-9.]+(?:e[+-]?\d+)?)?(?:([+-]?)([0-9.]+(?:e[+-]?\d+)?)?i)?$/.exec(t);
  assert.ok(m && t !== '', `cannot parse displayed value "${s}"`);
  if (m[3] === undefined && !t.endsWith('i')) return cx(Number(m[1]), 0);
  if (!t.endsWith('i')) throw new Error('bad ' + s);
  const imMag = m[3] === undefined ? 1 : Number(m[3]);
  if (m[1] !== undefined && m[2] === '') {
    // "3i" or "-2i": the first group swallowed the imaginary coefficient.
    return cx(0, Number(m[1]) * imMag);
  }
  return cx(m[1] === undefined ? 0 : Number(m[1]), (m[2] === '-' ? -1 : 1) * imMag);
}

// Significant digits shown in one displayed component string.
const sigDigits = (s) => {
  const mant = s.replace(/−/g, '').replace(/e.*$/, '').replace('.', '').replace(/^0+/, '');
  return Math.max(1, mant.length);
};

// The displayed value must agree with standard math at the displayed precision
// and must not show more digits than the EML tree and standard math share.
function assertHonest(src, r, big) {
  const shown = parseShown(big);
  const ref = r.ref;
  const parts = big.replace(/−/g, '-').split(/\s[+-]\s/);
  const digits = Math.max(...parts.map((p) => sigDigits(p.replace(/i$/, '') || '1')));
  if (ref.re === 0 && ref.im === 0) {
    assert.equal(big, '0', `${src}: reference is exactly 0`);
    return;
  }
  const mag = C.abs(ref);
  const unit = Math.pow(10, Math.floor(Math.log10(Math.max(Math.abs(shown.re), Math.abs(shown.im), mag))) - digits + 1);
  assert.ok(C.abs(C.sub(shown, ref)) <= 0.51 * unit * Math.SQRT2 + 1e-12,
    `${src}: shown ${big} vs ref ${C.format(ref, 17)}`);
  if (big !== '0') {
    const err = C.abs(C.sub(r.value, ref));
    const verified = err === 0 ? 17 : -Math.log10(err / mag);
    assert.ok(digits <= Math.max(1, Math.floor(verified)), `${src}: ${big} shows ${digits} digits, only ${verified.toFixed(2)} verified`);
  }
}

// ---- C1: only verified digits ------------------------------------------------
const C1 = [
  ['sin(pi)', 'ok', '0'],
  ['3-3', 'ok', '0'],
  ['0.5-0.5', 'ok', '0'],
  ['(3-3)*4', 'ok', '0'],
  ['-0.000000001', 'ok', MINUS + '1e-9'],
  ['arsinh(i)', 'ok', null, /^1\.570796\d*i$/],
  ['arcsin(1)', 'limit', null, /^1\.57\d*$/],
  ['sqrt(0)+1', 'limit', '1'],
  ['0*5+0.000001', 'limit', '0.000001'],
  ['sqrt(0)+0.0000005', 'limit', '5e-7'],
  ['cos(pi/2)', 'ok', '0'],
  ['tan(pi)', 'ok', '0'],
  ['sin(710)', 'ok', null, /^0\.0000602887\d*$/],
  ['ln(2)', 'ok', '0.6931471806'],
  ['ln(-2)', 'ok', '0.6931471806 + 3.141592654i'],
  ['sin(0)', 'limit', '0'],
  ['0.1+0.2', 'ok', '0.3'],
];
for (const [src, status, big, re] of C1) {
  test(`C1 verified digits: ${src}`, () => {
    const r = EML.run(src);
    assert.equal(r.status, status, `${src}: ${r.status} ${r.note}`);
    const v = modeSci.resultView(r);
    if (big !== null) assert.equal(v.big, big, src);
    if (re) assert.match(v.big, re, src);
    assertHonest(src, r, v.big);
    assert.equal(v.big, C.formatVerified(r.value, r.ref), `${src}: resultView uses the shared formatter`);
  });
}

test('C1: arcsin(1) shows only the digits its limit confirms, arsinh(i) has no real noise', () => {
  // The limit average agrees with pi/2 to about 7 digits (nudges start at 1e-14).
  const big = modeSci.resultView(EML.run('arcsin(1)')).big;
  assert.match(big, /^1\.57079\d{0,2}$|^1\.5708$/, big);
  assert.ok(!/\+/.test(modeSci.resultView(EML.run('arsinh(i)')).big));
});

test('C1: the formatter never shows 0 for a non-finite tree value', () => {
  assert.notEqual(C.formatVerified(cx(Infinity, 0), cx(2, 0)), '0');
  assert.notEqual(C.formatVerified(cx(NaN, NaN), cx(2, 0)), '0');
  assert.equal(C.formatVerified(cx(2, 0), cx(2, 0)), '2');
  assert.equal(C.formatVerified(cx(1e-20, 0), cx(0, 0)), '0');
  // Unverified leading digit of a tiny value: 0 (sin(pi)).
  assert.equal(C.formatVerified(cx(6.123e-17, 0), cx(1.2246e-16, 0)), '0');
});

test('C1: the "Standard math" line agrees with the big value', () => {
  for (const src of ['sin(pi)', '3-3', 'arcsin(1)', 'ln(2)']) {
    const r = EML.run(src);
    const line = modeSci.refLine(r);
    assert.ok(!/e-1[67]/.test(line), `${src}: ${line}`);
  }
});

// ---- C2: Smith division, poles vs overflow -------------------------------------
const OVER_ROOT = ['e^1000', 'exp(710)', '2^1024', '10^400', 'sinh(1000)', 'e^e^e^e'];
for (const src of OVER_ROOT) {
  test(`C2 overflow at the root: ${src}`, () => {
    const r = EML.run(src);
    assert.equal(r.status, 'overflow', `${src}: ${r.status} ${r.note}`);
    assert.match(r.note, /64-bit floating point overflows along the way \(a value beyond ~1\.8e308\), so neither side can give a number\./);
    assert.match(r.note, /The true value exceeds ~1\.8e308\./);
    const v = modeSci.resultView(r);
    assert.equal(v.big, 'too large for 64-bit floats');
    assert.doesNotMatch(v.big.replace('64-bit', ''), /\d|∞/);
  });
}

for (const src of ['ln(exp(1000))', 'exp(1000)/exp(1000)']) {
  test(`C2 overflow along the way: ${src}`, () => {
    const r = EML.run(src);
    assert.equal(r.status, 'overflow', `${src}: ${r.status} ${r.note}`);
    assert.match(r.note, /overflows along the way/);
    assert.doesNotMatch(r.note, /true value exceeds/);
    assert.doesNotMatch(r.note, /Not defined/);
    const v = modeSci.resultView(r);
    assert.doesNotMatch(v.big.replace('64-bit', ''), /\d|∞|undefined/);
  });
}

test('C2 underflow along the way: ln(exp(-800)) is not a pole', () => {
  const r = EML.run('ln(exp(-800))');
  assert.equal(r.status, 'overflow', r.note);
  assert.match(r.note, /1e-308/);
  assert.doesNotMatch(r.note, /Not defined|exceeds/);
  assert.doesNotMatch(modeSci.resultView(r).big.replace('64-bit', ''), /\d|∞/);
});

for (const [src, big] of [['10^200/10^199', '10'], ['exp(400)/exp(400)', '1'], ['2^600/2^599', '2']]) {
  test(`C2 Smith division makes ${src} ok`, () => {
    const r = EML.run(src);
    assert.equal(r.status, 'ok', `${src}: ${r.status} ${r.note}`);
    assert.equal(modeSci.resultView(r).big, big);
  });
}

test('C2: 1/exp(-400) and 1/exp(400) are ok with the right magnitude', () => {
  let r = EML.run('1/exp(-400)');
  assert.equal(r.status, 'ok', r.note);
  assertHonest('1/exp(-400)', r, modeSci.resultView(r).big);
  assert.match(modeSci.resultView(r).big, /e\+173$/);
  r = EML.run('1/exp(400)');
  assert.equal(r.status, 'ok', r.note);
  assert.ok(r.ref.re > 1e-175 && r.ref.re < 1e-173, 'reference is not 0');
  assert.match(modeSci.resultView(r).big, /e-174$/);
  assertHonest('1/exp(400)', r, modeSci.resultView(r).big);
  assert.doesNotMatch(modeSci.refLine(r), /: 0$/);
});

for (const src of ['1/0', 'ln(0)', '1/(1/0)', 'artanh(1)', 'artanh(-1)', 'arctan(i)', 'log(1, 5)', '0^(-1)', 'inv(0)']) {
  test(`C2 genuine pole stays undefined: ${src}`, () => {
    const r = EML.run(src);
    assert.equal(r.status, 'undefined', `${src}: ${r.status} ${r.note}`);
    assert.equal(r.note, 'Not defined here in standard math either.');
    const v = modeSci.resultView(r);
    assert.equal(v.big, '—', 'no doubled "undefined" and no fake value');
  });
}

test('C2 reference division (Smith) and reference functions at extremes', () => {
  const near = (z, re, im, tol = 1e-12) => assert.ok(
    Math.abs(z.re - re) <= tol * Math.max(1, Math.abs(re)) && Math.abs(z.im - im) <= tol * Math.max(1, Math.abs(im)),
    `got ${z.re} + ${z.im}i, want ${re} + ${im}i`);
  near(C.div(cx(1e200, 0), cx(1e199, 0)), 10, 0);
  near(C.div(cx(1, 0), cx(Math.exp(400), 0)), Math.exp(-400), 0, 1e-12);
  near(C.div(cx(1e300, 1e300), cx(1e300, 1e300)), 1, 0);
  near(C.div(cx(1, 1), cx(1e-160, 1e-160)), 1e160, 0);
  near(C.div(cx(1, 2), cx(3, 4)), 11 / 25, 2 / 25);
  near(C.div(cx(1, 2), cx(4, 3)), 10 / 25, 5 / 25);
  near(C.div(cx(3, 0), cx(-2, 0)), -1.5, 0);
  assert.ok(!Object.is(C.div(cx(3, 0), cx(2, 0)).im, -0), 'real fast path gives a +0 imaginary part');
  // Poles: a nonzero over zero is infinite, zero over zero is not a number.
  assert.equal(C.ref.inv(cx(0, 0)).re, Infinity);
  assert.ok(!Number.isNaN(C.ref.inv(cx(0, 0)).im));
  assert.ok(Number.isNaN(C.div(cx(0, 0), cx(0, 0)).re));
  assert.equal(C.ref.atanh(cx(1, 0)).re, Infinity);
  assert.equal(C.ref.atanh(cx(-1, 0)).re, -Infinity);
  near(C.ref.tan(cx(0, 1000)), 0, 1);
  near(C.ref.tanh(cx(1000, 1)), 1, 0);
  near(C.ref.tanh(cx(-1000, 1)), -1, 0);
  near(C.ref.tan(cx(1, -1000)), 0, -1);
  // The robust tan/tanh still match the textbook values at ordinary points.
  near(C.ref.tan(cx(1, 2)), 0.0338128260798967, 1.0147936161466335, 1e-12);
  near(C.ref.tanh(cx(1, 2)), 1.16673625724092, -0.243458201185725, 1e-12);
});

// ---- I1: breakdown cards are honest -------------------------------------------
function cardText(src, key) {
  const r = EML.run(src);
  const skel = modeSci.skeleton(r.ast, r.call);
  const ev = EML.dag.makeEvaluator({ overrides: r.overrides });
  const first = skel.find((s) => s.key === key);
  return modeSci.pieceValue(first.ast, ev(first.call.root), r.status);
}

test('I1: a "+" piece that the tree gets wrong shows standard math and says so', () => {
  const r = EML.run('1+4i');
  assert.equal(r.status, 'mismatch');
  const p = cardText('1+4i', 'r:add');
  assert.equal(p.differs, true);
  assert.match(p.text, /^1 \+ 4i/);
  assert.match(p.text, /EML tree differs here/);
});

test('I1: the negation piece of -1000 shows −1000, not −∞', () => {
  const p = cardText('-1000', 'r:neg');
  assert.equal(p.differs, true);
  assert.match(p.text, /^−1000/);
  assert.doesNotMatch(p.text, /∞/);
});

test('I1: arcsin(1) piece shows only verified digits, no imaginary noise', () => {
  const p = cardText('arcsin(1)', 'r:arcsin');
  assert.equal(p.differs, false);
  assert.match(p.text, /^1\.57\d*$/);
  assert.doesNotMatch(p.text, /i/);
});

test('I1: agreeing pieces read like the result; numbers show themselves', () => {
  assert.deepEqual(cardText('sin(2) + 3', 'r:sin'), { text: '0.9092974268', differs: false });
  assert.deepEqual(cardText('sin(2) + 3', 'num:3'), { text: '3', differs: false });
  assert.deepEqual(cardText('3-3', 'r:sub'), { text: '0', differs: false });
  const u = cardText('1/0', 'r:div');
  assert.equal(u.text.includes('—'), true);
});

// ---- I2: cancellation zeros are limits, not "branch cut or precision" -----------
for (const src of ['sin(1-1)', 'sqrt(2-2)', 'avg(1,-1)', 'hypot(1,i)']) {
  test(`I2 cancellation zero is a limit: ${src}`, () => {
    const r = EML.run(src);
    assert.equal(r.status, 'limit', `${src}: ${r.status} ${r.note}`);
    assert.equal(modeSci.resultView(r).big, '0');
  });
}

test('I2: a mismatch whose tree hits ln 0 / ∞ says so', () => {
  const ref = cx(0.5, 0);
  const note = EML.mismatchNote(cx(Infinity, 0), ref);
  assert.equal(note, 'The EML route hits ln 0 / ∞ here, so the tree can’t finish. Standard math says 0.5.');
  assert.match(EML.mismatchNote(cx(1, 2), ref), /branch cut or precision/);
});

test('I2: the old limit cases still settle on 0', () => {
  for (const src of ['0*5', 'sin(0)', 'tanh(0)', 'sqrt(0)']) {
    const r = EML.run(src);
    assert.equal(r.status, 'limit', src);
    assert.equal(modeSci.resultView(r).big, '0', src);
  }
  for (const src of ['tan(pi/2)', 'arccos(2)']) {
    const r = EML.run(src);
    assert.equal(r.status, 'mismatch', src);
  }
});

// ---- minors ----------------------------------------------------------------------
test('counts above 1e9 are shown approximately', () => {
  assert.equal(modeSci.count(1500), '1,500');
  assert.equal(modeSci.count(999999999), '999,999,999');
  assert.equal(modeSci.count(1.234e26), '≈1.2e+26');
  assert.equal(modeSci.count(5e9), '≈5.0e+9');
});
