(function (root) {
  const EML = (root.EML = root.EML || {});
  const { C, calls, dag, R } = EML;
  const { cx } = C;

  const ERR_NEEDS_TWO = 'EML needs two values on the stack \u2014 press 1 first';
  const MINUS = '\u2212';

  // ---- Two-button RPN machine ------------------------------------------------
  // Buttons: `1` pushes the constant 1; `EML` pops b (top) then a and pushes
  // eml(a, b). The tape records the presses in the paper's notation ("11E").
  class RpnMachine {
    constructor() {
      this.evaluate = dag.makeEvaluator({}); // shared memo keeps values cheap
      this.stack = [];
      this.tape = '';
      this._history = [];
    }

    get top() {
      return this.stack.length ? this.stack[this.stack.length - 1] : null;
    }

    _snapshot() {
      this._history.push({ stack: this.stack.slice(), tape: this.tape });
    }

    _item(call) {
      return { call, value: this.evaluate(call.root) };
    }

    push1() {
      this._snapshot();
      this.stack.push(this._item(calls.one()));
      this.tape += '1';
    }

    pressEml() {
      if (this.stack.length < 2) return ERR_NEEDS_TWO;
      this._snapshot();
      const b = this.stack.pop();
      const a = this.stack.pop();
      this.stack.push(this._item(calls.eml(a.call, b.call)));
      this.tape += 'E';
      return null;
    }

    undo() {
      const prev = this._history.pop();
      if (!prev) return;
      this.stack = prev.stack;
      this.tape = prev.tape;
    }

    clear() {
      this.stack = [];
      this.tape = '';
      this._history = [];
    }
  }
  EML.RpnMachine = RpnMachine;

  // ---- Presets: constants the paper builds, shown as ready-made tapes --------
  EML.presets = [
    { id: 'e', label: 'e', call: R.e() },
    { id: 'zero', label: '0', call: R.zero() },
    { id: 'minusOne', label: MINUS + '1', call: R.minusOne() },
    { id: 'two', label: '2', call: R.two() },
    { id: 'half', label: '1/2', call: R.rational(1, 2) },
    { id: 'i', label: 'i', call: R.i() },
    { id: 'pi', label: '\u03c0', call: R.pi() },
  ];

  EML.presetTape = (call) => dag.rpn(call.root, 100000);

  // ---- Value recognizer -------------------------------------------------------
  const KNOWN = [];
  for (let n = -10; n <= 10; n++) KNOWN.push([n < 0 ? MINUS + -n : String(n), cx(n, 0)]);
  KNOWN.push(
    ['1/2', cx(0.5, 0)],
    [MINUS + '1/2', cx(-0.5, 0)],
    ['e', cx(Math.E, 0)],
    ['\u03c0', cx(Math.PI, 0)],
    ['i', cx(0, 1)],
    [MINUS + 'i', cx(0, -1)],
    ['ln 2', cx(Math.LN2, 0)],
    ['\u221a2', cx(Math.SQRT2, 0)],
    ['e^e', cx(Math.exp(Math.E), 0)],
  );

  EML.recognize = (value) => {
    if (!value || !C.isFinite(value)) return null;
    for (const [label, known] of KNOWN) {
      if (C.approxEq(value, known, 1e-9, 1e-12)) return label;
    }
    return null;
  };
})(typeof window !== 'undefined' ? window : globalThis);
