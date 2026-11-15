const test = require('node:test');
const assert = require('node:assert/strict');
const EML = require('./load')();

const { parse, ParseError } = EML;

// Prefix-form printer: (+ 1 (* 2 3)), (neg x), (sin 1), constants by name.
function show(a) {
  switch (a.type) {
    case 'num': return a.text;
    case 'const': return a.name;
    case 'neg': return `(neg ${show(a.arg)})`;
    case 'bin': return `(${a.op} ${show(a.left)} ${show(a.right)})`;
    case 'call': return `(${a.name} ${a.args.map(show).join(' ')})`;
    default: throw new Error('bad node ' + a.type);
  }
}
const p = (s) => show(parse(s));

test('precedence and associativity', () => {
  assert.equal(p('1+2*3'), '(+ 1 (* 2 3))');
  assert.equal(p('1-2-3'), '(- (- 1 2) 3)');
  assert.equal(p('8/4/2'), '(/ (/ 8 4) 2)');
  assert.equal(p('2^3^2'), '(^ 2 (^ 3 2))');
  assert.equal(p('-2^2'), '(neg (^ 2 2))');
  assert.equal(p('2^-1'), '(^ 2 (neg 1))');
  assert.equal(p('2*-3'), '(* 2 (neg 3))');
  assert.equal(p('-2*3'), '(* (neg 2) 3)');
  assert.equal(p('(1+2)*3'), '(* (+ 1 2) 3)');
  assert.equal(p('--2'), '(neg (neg 2))');
});

test('constants', () => {
  assert.equal(p('pi'), 'pi');
  assert.equal(p('e'), 'e');
  assert.equal(p('i'), 'i');
  assert.equal(p('PI'), 'pi');
});

test('implicit multiplication', () => {
  assert.equal(p('2pi'), '(* 2 pi)');
  assert.equal(p('3(1+2)'), '(* 3 (+ 1 2))');
  assert.equal(p('(1)(2)'), '(* 1 2)');
  assert.equal(p('2sin(1)'), '(* 2 (sin 1))');
  assert.equal(p('pi e'), '(* pi e)');
  assert.equal(p('(1+2)pi'), '(* (+ 1 2) pi)');
  assert.equal(p('2-3'), '(- 2 3)'); // minus stays subtraction
  assert.equal(p('2√4'), '(* 2 (sqrt 4))');
});

test('functions and aliases', () => {
  assert.equal(p('log(2, 8)'), '(logb 2 8)');
  assert.equal(p('log(8)'), '(ln 8)');
  assert.equal(p('asin(0.5)'), '(arcsin 0.5)');
  for (const [alias, id] of [
    ['arcsin', 'arcsin'], ['asin', 'arcsin'], ['arccos', 'arccos'], ['acos', 'arccos'],
    ['arctan', 'arctan'], ['atan', 'arctan'], ['arsinh', 'arsinh'], ['asinh', 'arsinh'],
    ['arcsinh', 'arsinh'], ['arcosh', 'arcosh'], ['acosh', 'arcosh'], ['arccosh', 'arcosh'],
    ['artanh', 'artanh'], ['atanh', 'artanh'], ['arctanh', 'artanh'],
    ['exp', 'exp'], ['ln', 'ln'], ['sqrt', 'sqrt'], ['sqr', 'sqr'], ['half', 'half'],
    ['inv', 'inv'], ['sigmoid', 'sigmoid'], ['σ', 'sigmoid'], ['sin', 'sin'], ['cos', 'cos'],
    ['tan', 'tan'], ['sinh', 'sinh'], ['cosh', 'cosh'], ['tanh', 'tanh'],
  ]) {
    assert.equal(p(`${alias}(1)`), `(${id} 1)`, alias);
  }
  assert.equal(p('avg(1,2)'), '(avg 1 2)');
  assert.equal(p('hypot(3, 4)'), '(hypot 3 4)');
  assert.equal(p('SIN(1)'), '(sin 1)');
  assert.equal(p('sin(cos(1))^2'), '(^ (sin (cos 1)) 2)');
});

test('unicode aliases parse like ASCII', () => {
  assert.equal(p('2×3'), p('2*3'));
  assert.equal(p('2·3'), p('2*3'));
  assert.equal(p('6÷2'), p('6/2'));
  assert.equal(p('5−1'), p('5-1'));
  assert.equal(p('5–1'), p('5-1'));
  assert.equal(p('−3'), p('-3'));
  assert.equal(p('2π'), '(* 2 pi)');
  assert.equal(p('√4'), '(sqrt 4)');
  assert.equal(p('√(4)'), '(sqrt 4)');
  assert.equal(p('√-4'), '(sqrt (neg 4))');
  assert.equal(p('√√16'), '(sqrt (sqrt 16))');
  assert.equal(p('σ(0)'), '(sigmoid 0)');
  assert.equal(p('\u00a02\u00a0+\u00a03 '), '(+ 2 3)'); // nbsp whitespace
});

test('num nodes keep text and value', () => {
  const a = parse('0.50');
  assert.equal(a.type, 'num');
  assert.equal(a.text, '0.50');
  assert.equal(a.value, 0.5);
  assert.equal(parse('.5').value, 0.5);
  assert.equal(parse('.5').text, '.5');
  assert.equal(parse('007').value, 7);
});

test('AST shapes', () => {
  assert.deepEqual(parse('-pi'), { type: 'neg', arg: { type: 'const', name: 'pi' } });
  const b = parse('1+2');
  assert.equal(b.type, 'bin');
  assert.equal(b.op, '+');
  const c = parse('log(2,8)');
  assert.equal(c.type, 'call');
  assert.equal(c.name, 'logb');
  assert.equal(c.args.length, 2);
});

function perr(src, re) {
  assert.throws(() => parse(src), (e) => {
    assert.ok(e instanceof ParseError, `${JSON.stringify(src)} threw ${e && e.constructor.name}: ${e && e.message}`);
    assert.ok(e instanceof Error);
    assert.equal(typeof e.pos, 'number', 'pos');
    if (re) assert.match(e.message, re);
    return true;
  });
}

test('errors are ParseError with a position', () => {
  perr('', /Type an expression/);
  perr('   ', /Type an expression/);
  perr('sin(');
  perr('2++');
  perr('foo(2)', /Unknown function 'foo'/);
  perr('sin(1,2)', /sin takes 1 argument/);
  perr('sin()', /sin takes 1 argument/);
  perr('avg(1)', /avg takes 2 arguments/);
  perr('log(1,2,3)');
  perr('2)');
  perr('(1+2');
  perr('$');
  perr('1+');
  perr('*2');
  perr('2*');
  perr('()');
  perr('1.2.3');
  perr('1,5');
  perr('x');
  perr('sin 2');
  perr('sin');
  perr('2 +* 3');
  perr('√');
  perr('(', null);
});

test('error positions point at the problem', () => {
  const pos = (s) => { try { parse(s); } catch (e) { return e.pos; } };
  assert.equal(pos('1+$'), 2);
  assert.equal(pos('2)'), 1);
  assert.equal(pos('foo(2)'), 0);
  assert.equal(pos('1+foo(2)'), 2);
});

test('pathological nesting yields ParseError, not RangeError', () => {
  perr('('.repeat(100000) + '1' + ')'.repeat(100000));
  perr('-'.repeat(100000) + '1');
  perr('√'.repeat(100000) + '1');
  assert.equal(p('('.repeat(50) + '1' + ')'.repeat(50)), '1');
});

test('scientific notation is rejected (R11)', () => {
  for (const src of ['1e5', '2e-3', '1E+4', '2.5e3', '3 + 1e5']) {
    assert.throws(() => parse(src), (e) => e instanceof ParseError &&
      e.message === "Scientific notation isn't supported — write the number out (e.g. 100000)", src);
  }
});

test('number followed by Euler e still means implicit multiplication', () => {
  assert.equal(p('2e'), '(* 2 e)');
  assert.equal(p('2e*5'), '(* (* 2 e) 5)');
  assert.equal(p('2(e)'), '(* 2 e)');
  assert.equal(p('e^2'), '(^ e 2)');
  assert.equal(p('2e^2'), '(* 2 (^ e 2))');
  assert.equal(p('2e+x'.replace('x', 'e')), '(+ (* 2 e) e)');
});

// R24: a space between two numbers is almost always a typo for one number
// ("1 000"), and a decimal comma ("2,5") is not a 2-argument list.
test('two numbers separated by a space are a parse error with a joined hint (R24)', () => {
  const cases = [['1 000', 'Two numbers in a row — did you mean 1000?'],
    ['2 3', 'Two numbers in a row — did you mean 23?'],
    ['1 000 000 + 1', 'Two numbers in a row — did you mean 1000000?'],
    ['5 + 2 3', 'Two numbers in a row — did you mean 23?']];
  for (const [src, msg] of cases) {
    assert.throws(() => parse(src), (e) => e instanceof ParseError && e.message === msg, src);
  }
  assert.equal(EML.run('1 000').status, 'error');
});

test('a decimal comma at top level is a parse error (R24)', () => {
  for (const [src, msg] of [['2,5', 'Use a dot for decimals (2.5)'], ['1 + 2,5', 'Use a dot for decimals (2.5)'],
    ['(0,75)', 'Use a dot for decimals (0.75)']]) {
    assert.throws(() => parse(src), (e) => e instanceof ParseError && e.message === msg, src);
  }
  // Inside a function call the comma still separates arguments.
  assert.equal(p('log(2,5)'), '(logb 2 5)');
  assert.equal(p('hypot(3,4)'), '(hypot 3 4)');
  assert.throws(() => parse('sin(2,5)'), (e) => e instanceof ParseError && /takes 1 argument/.test(e.message));
});

test('other implicit multiplication is unchanged by R24', () => {
  assert.equal(p('2pi'), '(* 2 pi)');
  assert.equal(p('2 pi'), '(* 2 pi)');
  assert.equal(p('3(1+2)'), '(* 3 (+ 1 2))');
  assert.equal(p('3 (1+2)'), '(* 3 (+ 1 2))');
  assert.equal(p('2sin(1)'), '(* 2 (sin 1))');
  assert.equal(p('2e'), '(* 2 e)');
  assert.equal(p('(2)(3)'), '(* 2 3)');
  assert.equal(p('(2) 3'), '(* 2 3)');
});

// Hints for numbers typed with spaces or thousands commas.
test('two numbers in a row: join only whole numbers, otherwise suggest an operator', () => {
  const cases = [['1.5 2', 'Two numbers in a row — add an operator, e.g. 1.5*2'],
    ['1 2.5', 'Two numbers in a row — add an operator, e.g. 1*2.5'],
    ['1 000 2.5', 'Two numbers in a row — add an operator, e.g. 1000*2.5'],
    ['2. 3', 'Two numbers in a row — add an operator, e.g. 2.*3'],
    ['1 000', 'Two numbers in a row — did you mean 1000?']];
  for (const [src, msg] of cases) {
    assert.throws(() => parse(src), (e) => e instanceof ParseError && e.message === msg, src);
  }
});

test('thousands commas get their own hint; other top-level commas stay decimal hints', () => {
  const cases = [['1,000', "Don't use commas in numbers — write 1000"],
    ['1,000,000', "Don't use commas in numbers — write 1000000"],
    ['12,345,678.5', "Don't use commas in numbers — write 12345678.5"],
    ['1,000 + 1', "Don't use commas in numbers — write 1000"],
    ['2,500', "Don't use commas in numbers — write 2500"],
    ['2,5', 'Use a dot for decimals (2.5)'],
    ['0,125', 'Use a dot for decimals (0.125)'],
    ['1,0000', 'Use a dot for decimals (1.0000)'],
    ['1000,000', 'Use a dot for decimals (1000.000)'],
    ['1.5,000', "Unexpected ','"]];
  for (const [src, msg] of cases) {
    assert.throws(() => parse(src), (e) => e instanceof ParseError && e.message === msg, src);
  }
  // Inside a function call the comma still separates arguments.
  assert.equal(p('log(1,000)'), '(logb 1 000)');
});
