const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load.js');

const EML = load();
const C = EML.C;
const cx = C.cx;

test('eml(1,1) = e', () => {
  const r = C.eml(cx(1), cx(1));
  assert.ok(C.approxEq(r, cx(Math.E)), C.format(r));
});

test('exp(-inf) = 0, log(0) = -inf', () => {
  assert.equal(C.exp(cx(-Infinity)).re, 0);
  assert.equal(C.log(cx(0)).re, -Infinity);
  assert.ok(Object.is(C.log(cx(0)).im, -0));
});

test('exp flags', () => {
  let f = {};
  C.exp(cx(800), f);
  assert.equal(f.overflow, true);
  f = {};
  C.exp(cx(-800), f);
  assert.equal(f.underflow, true);
  f = {};
  C.exp(cx(Infinity), f);
  assert.ok(!f.overflow && !f.underflow);
  f = {};
  C.exp(cx(-Infinity), f);
  assert.ok(!f.overflow && !f.underflow);
});

test('exp keeps signed zero imaginary part', () => {
  assert.ok(Object.is(C.exp(cx(1, -0)).im, -0));
  assert.ok(Object.is(C.exp(cx(1, 0)).im, 0));
});

test('snap is relative only', () => {
  assert.ok(Object.is(C.snap(cx(5, 1e-14)).im, -0));
  assert.equal(C.snap(cx(1e-20, 0)).re, 1e-20);
  assert.ok(Object.is(C.snap(cx(1e-14, 5)).re, -0));
  assert.ok(Object.is(C.snap(cx(0, 0)).re, -0));
  assert.ok(Object.is(C.snap(cx(0, 0)).im, -0));
});

test('format', () => {
  assert.equal(C.format(cx(2, -0)), '2');
  assert.equal(C.format(cx(0, 2)), '2i');
  assert.equal(C.format(cx(-1.5, -2)), '−1.5 − 2i');
  assert.equal(C.format(cx(0, -1)), '−i');
  assert.equal(C.format(cx(0, 1)), 'i');
  assert.equal(C.format(cx(Math.LN2, Math.PI)), '0.6931471806 + 3.141592654i');
  assert.equal(C.format(cx(Infinity)), '∞');
  assert.equal(C.format(cx(-Infinity)), '−∞');
  assert.equal(C.format(cx(NaN)), 'undefined');
  assert.equal(C.format(cx(-0)), '0');
});

test('ref normalises -0 imaginary input', () => {
  const r = C.ref.ln(cx(-2, -0));
  assert.ok(C.approxEq(r, cx(0.6931471805599453, 3.141592653589793)), C.format(r));
});

test('ref principal values', () => {
  assert.ok(C.approxEq(C.ref.sqrt(cx(-4)), cx(0, 2)));
  assert.ok(Math.abs(C.ref.asin(cx(0.5)).re - Math.asin(0.5)) < 1e-12);
  assert.ok(Math.abs(C.ref.atan(cx(1)).re - Math.PI / 4) < 1e-12);
  assert.ok(C.approxEq(C.ref.asin(cx(2)), cx(Math.PI / 2, 1.3169578969248166)));
  assert.ok(C.approxEq(C.ref.acos(cx(2)), cx(0, -1.3169578969248166)));
  assert.ok(C.approxEq(C.ref.acosh(cx(0.5)), cx(0, Math.acos(0.5))));
  assert.ok(C.approxEq(C.ref.atanh(cx(2)), cx(0.5493061443340549, Math.PI / 2)));
});

test('ref matches Math.* on real domain', () => {
  const r = (f, x) => C.ref[f](cx(x)).re;
  for (const [f, m, x] of [
    ['exp', Math.exp, 1.3], ['ln', Math.log, 2.5], ['sqrt', Math.sqrt, 7],
    ['sin', Math.sin, 0.7], ['cos', Math.cos, 0.7], ['tan', Math.tan, 0.7],
    ['asin', Math.asin, 0.3], ['acos', Math.acos, 0.3], ['atan', Math.atan, 0.3],
    ['sinh', Math.sinh, 0.9], ['cosh', Math.cosh, 0.9], ['tanh', Math.tanh, 0.9],
    ['asinh', Math.asinh, 0.9], ['acosh', Math.acosh, 1.9], ['atanh', Math.atanh, 0.4],
  ]) {
    assert.ok(Math.abs(r(f, x) - m(x)) < 1e-12, f);
  }
  assert.ok(Math.abs(r('sigmoid', 0.4) - 1 / (1 + Math.exp(-0.4))) < 1e-12);
  assert.ok(Math.abs(r('half', 3) - 1.5) < 1e-12);
  assert.ok(Math.abs(r('sqr', 3) - 9) < 1e-12);
  assert.ok(Math.abs(r('inv', 4) - 0.25) < 1e-12);
  assert.ok(Math.abs(C.ref.pow(cx(2), cx(10)).re - 1024) < 1e-9);
  assert.ok(Math.abs(C.ref.pow(cx(-2), cx(3)).re + 8) < 1e-12);
  assert.ok(Math.abs(C.ref.logb(cx(2), cx(8)).re - 3) < 1e-12);
  assert.ok(Math.abs(C.ref.avg(cx(2), cx(5)).re - 3.5) < 1e-12);
  assert.ok(Math.abs(C.ref.hypot(cx(3), cx(4)).re - 5) < 1e-12);
});

test('arithmetic', () => {
  assert.ok(C.approxEq(C.mul(cx(1, 2), cx(3, 4)), cx(-5, 10)));
  assert.ok(C.approxEq(C.div(cx(-5, 10), cx(3, 4)), cx(1, 2)));
  assert.ok(C.approxEq(C.sub(cx(1, 2), cx(3, 4)), cx(-2, -2)));
  assert.ok(C.approxEq(C.add(cx(1, 2), cx(3, 4)), cx(4, 6)));
  assert.equal(C.abs(cx(3, 4)), 5);
  assert.ok(C.isFinite(cx(1, 2)) && !C.isFinite(cx(Infinity, 0)));
});

test('load returns same EML once', () => {
  assert.equal(load(), EML);
  assert.ok(Object.is(EML.ZERO, -0));
});
