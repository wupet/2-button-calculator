const test = require('node:test');
const assert = require('node:assert/strict');
const EML = require('./load')();

const { C, R, presets, presetTape, recognize } = EML;
const { cx } = C;

const press = (m, tape) => {
  for (const ch of tape) {
    if (ch === '1') m.push1();
    else assert.equal(m.pressEml(), null);
  }
  return m;
};

test('1 1 E builds e', () => {
  const m = new EML.RpnMachine();
  m.push1(); m.push1();
  assert.equal(m.pressEml(), null);
  assert.equal(m.tape, '11E');
  assert.equal(m.stack.length, 1);
  assert.ok(C.approxEq(m.top.value, cx(Math.E, 0)));
  assert.equal(recognize(m.top.value), 'e');
});

test('pressEml on a short stack errors and changes nothing', () => {
  const m = new EML.RpnMachine();
  const msg = 'EML needs two values on the stack — press 1 first';
  assert.equal(m.pressEml(), msg);
  assert.equal(m.stack.length, 0);
  assert.equal(m.tape, '');
  assert.equal(m.top, null);
  m.push1();
  assert.equal(m.pressEml(), msg);
  assert.equal(m.stack.length, 1);
  assert.equal(m.tape, '1');
});

test('undo reverts the last press; clear empties', () => {
  const m = press(new EML.RpnMachine(), '11E');
  m.undo();
  assert.equal(m.stack.length, 2);
  assert.equal(m.tape, '11');
  assert.ok(m.stack.every((s) => C.approxEq(s.value, cx(1, 0))));
  m.undo(); m.undo(); m.undo(); // extra undo on empty is harmless
  assert.equal(m.stack.length, 0);
  assert.equal(m.tape, '');
  press(m, '11E'); m.clear();
  assert.equal(m.stack.length, 0);
  assert.equal(m.tape, '');
});

test('eml takes a = next, b = top', () => {
  // 1 (1 1 E) E = eml(1, e) = e - ln(e) = e - 1
  const m = press(new EML.RpnMachine(), '111EE');
  assert.ok(C.approxEq(m.top.value, cx(Math.E - 1, 0)));
});

test('preset list ids and labels', () => {
  assert.deepEqual(presets.map((p) => p.id), ['e', 'zero', 'minusOne', 'two', 'half', 'i', 'pi']);
  assert.deepEqual(presets.map((p) => p.label), ['e', '0', '−1', '2', '1/2', 'i', 'π']);
  assert.equal(presets.find((p) => p.id === 'half').call, R.rational(1, 2));
});

test('replaying every preset tape keypress-by-keypress recognizes it', () => {
  for (const p of presets) {
    const tape = presetTape(p.call);
    assert.equal(typeof tape, 'string', p.id);
    const m = press(new EML.RpnMachine(), tape);
    assert.equal(m.tape, tape, p.id);
    assert.equal(m.stack.length, 1, p.id);
    assert.equal(recognize(m.top.value), p.label, p.id);
    console.log(`# ${p.id}: tape length ${tape.length}`);
  }
});

test('recognize covers the documented values', () => {
  assert.equal(recognize(cx(Math.PI, 0)), 'π');
  assert.equal(recognize(cx(0, 1)), 'i');
  assert.equal(recognize(cx(0, -1)), '−i');
  assert.equal(recognize(cx(0, 0)), '0');
  assert.equal(recognize(cx(-0, -0)), '0');
  assert.equal(recognize(cx(-1, 0)), '−1');
  assert.equal(recognize(cx(-10, 0)), '−10');
  assert.equal(recognize(cx(10, 0)), '10');
  assert.equal(recognize(cx(0.5, 0)), '1/2');
  assert.equal(recognize(cx(-0.5, 0)), '−1/2');
  assert.equal(recognize(cx(Math.LN2, 0)), 'ln 2');
  assert.equal(recognize(cx(Math.SQRT2, 0)), '√2');
  assert.equal(recognize(cx(Math.exp(Math.E), 0)), 'e^e');
  assert.equal(recognize(cx(2 + 1e-12, 1e-13)), '2');
  assert.equal(recognize(cx(2, 0.5)), null);
  assert.equal(recognize(cx(0.123456, 0)), null);
  assert.equal(recognize(cx(NaN, 0)), null);
  assert.equal(recognize(cx(Infinity, 0)), null);
});
