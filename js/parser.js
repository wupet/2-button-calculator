(function (root) {
  const EML = (root.EML = root.EML || {});

  // Expression parser: text -> AST. Pure logic, no DOM.
  //   AST = {type:'num', value, text} | {type:'const', name:'pi'|'e'|'i'} | {type:'neg', arg}
  //       | {type:'bin', op:'+'|'-'|'*'|'/'|'^', left, right} | {type:'call', name:recipeId, args}
  // Precedence (low -> high): + -  <  * / and implicit multiplication  <  unary minus  <  ^ (right-assoc)
  // so -2^2 = -(2^2) and 2^-1 works. A prefix sqrt (√) binds like a function call: √4^2 = (√4)^2.

  class ParseError extends Error {
    constructor(message, pos) {
      super(message);
      this.name = 'ParseError';
      this.pos = pos;
    }
  }

  const MAX_DEPTH = 200;

  // Typed name -> recipe id ('log' is resolved by argument count).
  const FUNCS = {
    exp: 'exp', ln: 'ln', sqrt: 'sqrt', sqr: 'sqr', half: 'half', inv: 'inv', sigmoid: 'sigmoid',
    sin: 'sin', cos: 'cos', tan: 'tan', sinh: 'sinh', cosh: 'cosh', tanh: 'tanh',
    avg: 'avg', hypot: 'hypot', log: 'log',
    arcsin: 'arcsin', asin: 'arcsin', arccos: 'arccos', acos: 'arccos',
    arctan: 'arctan', atan: 'arctan',
    arsinh: 'arsinh', asinh: 'arsinh', arcsinh: 'arsinh',
    arcosh: 'arcosh', acosh: 'arcosh', arccosh: 'arcosh',
    artanh: 'artanh', atanh: 'artanh', arctanh: 'artanh',
  };
  const CONSTS = { pi: 'pi', e: 'e', i: 'i' };
  const PUNCT = {
    '+': '+', '-': '-', '−': '-', '–': '-',
    '*': '*', '×': '*', '·': '*',
    '/': '/', '÷': '/', '^': '^',
    '(': '(', ')': ')', ',': ',',
  };
  const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

  function plural(n) { return n === 1 ? '1 argument' : n + ' arguments'; }

  // Expected argument count for a recipe id; the only thing the parser reads from recipes.
  function arityOf(id) {
    const r = EML.recipeById && EML.recipeById[id];
    return r ? r.arity : 1;
  }

  function tokenize(src) {
    const toks = [];
    let i = 0;
    while (i < src.length) {
      const ch = src[i];
      if (/\s/.test(ch)) { i++; continue; }
      if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] || ''))) {
        const text = /^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)/.exec(src.slice(i))[0];
        if (src[i + text.length] === '.') {
          throw new ParseError("Unexpected character '.'", i + text.length);
        }
        toks.push({ t: 'num', text, value: parseFloat(text), pos: i });
        i += text.length;
      } else if (/[A-Za-z]/.test(ch)) {
        const text = /^[A-Za-z]+/.exec(src.slice(i))[0];
        toks.push({ t: 'name', text, lower: text.toLowerCase(), pos: i });
        i += text.length;
      } else if (ch === 'π') { // π
        toks.push({ t: 'name', text: ch, lower: 'pi', pos: i });
        i++;
      } else if (ch === 'σ') { // σ
        toks.push({ t: 'name', text: ch, lower: 'sigmoid', pos: i });
        i++;
      } else if (ch === '√') { // √
        toks.push({ t: 'sqrt', text: ch, pos: i });
        i++;
      } else if (has(PUNCT, ch)) {
        toks.push({ t: 'op', op: PUNCT[ch], text: ch, pos: i });
        i++;
      } else {
        throw new ParseError("Unexpected character '" + ch + "'", i);
      }
    }
    toks.push({ t: 'end', text: 'end of input', pos: src.length });
    return toks;
  }

  function parse(src) {
    if (typeof src !== 'string' || src.trim() === '') throw new ParseError('Type an expression', 0);
    const toks = tokenize(src);
    let k = 0;
    let depth = 0;

    const peek = () => toks[k];
    const isOp = (tok, op) => tok.t === 'op' && tok.op === op;
    const unexpected = (tok) => new ParseError(
      tok.t === 'end' ? 'Unexpected end of input' : "Unexpected '" + tok.text + "'", tok.pos);
    const enter = (tok) => {
      if (++depth > MAX_DEPTH) throw new ParseError('Expression is nested too deeply', tok.pos);
    };

    // Can this token begin an operand directly after another operand (implicit multiplication)?
    const startsOperand = (tok) =>
      tok.t === 'num' || tok.t === 'name' || tok.t === 'sqrt' || isOp(tok, '(');

    function parseExpr() {
      let left = parseTerm();
      for (;;) {
        const tok = peek();
        if (isOp(tok, '+') || isOp(tok, '-')) {
          k++;
          left = { type: 'bin', op: tok.op, left, right: parseTerm() };
        } else return left;
      }
    }

    function parseTerm() {
      let left = parseUnary();
      for (;;) {
        const tok = peek();
        if (isOp(tok, '*') || isOp(tok, '/')) {
          k++;
          left = { type: 'bin', op: tok.op, left, right: parseUnary() };
        } else if (startsOperand(tok)) {
          left = { type: 'bin', op: '*', left, right: parseUnary() };
        } else return left;
      }
    }

    function parseUnary() {
      const tok = peek();
      if (isOp(tok, '-')) {
        enter(tok);
        k++;
        const arg = parseUnary();
        depth--;
        return { type: 'neg', arg };
      }
      return parsePower();
    }

    function parsePower() {
      const base = parsePrimary();
      const tok = peek();
      if (isOp(tok, '^')) {
        k++;
        enter(tok);
        const exponent = parseUnary(); // right-assoc; allows 2^-1
        depth--;
        return { type: 'bin', op: '^', left: base, right: exponent };
      }
      return base;
    }

    // Operand of a prefix sqrt: an atom, optionally negated or nested (√-4, √√16).
    function parseSqrtOperand() {
      const tok = peek();
      if (isOp(tok, '-')) {
        enter(tok);
        k++;
        const arg = parseSqrtOperand();
        depth--;
        return { type: 'neg', arg };
      }
      return parsePrimary();
    }

    function parsePrimary() {
      const tok = peek();
      if (tok.t === 'num') {
        k++;
        return { type: 'num', value: tok.value, text: tok.text };
      }
      if (tok.t === 'sqrt') {
        enter(tok);
        k++;
        const arg = parseSqrtOperand();
        depth--;
        return { type: 'call', name: 'sqrt', args: [arg] };
      }
      if (isOp(tok, '(')) {
        enter(tok);
        k++;
        const inner = parseExpr();
        const close = peek();
        if (!isOp(close, ')')) {
          throw close.t === 'end'
            ? new ParseError("Missing ')' to close '('", tok.pos)
            : unexpected(close);
        }
        k++;
        depth--;
        return inner;
      }
      if (tok.t === 'name') return parseName(tok);
      throw unexpected(tok);
    }

    function parseName(tok) {
      k++;
      const hasParen = isOp(peek(), '(');
      if (has(FUNCS, tok.lower)) {
        if (!hasParen) {
          throw new ParseError("'" + tok.text + "' needs parentheses, e.g. " + tok.text + '(…)', tok.pos);
        }
        return parseCall(tok);
      }
      if (has(CONSTS, tok.lower)) return { type: 'const', name: CONSTS[tok.lower] };
      if (hasParen) throw new ParseError("Unknown function '" + tok.text + "'", tok.pos);
      throw new ParseError("Unknown name '" + tok.text + "'", tok.pos);
    }

    function parseCall(tok) {
      const open = peek();
      k++; // '('
      enter(open);
      const args = [];
      if (isOp(peek(), ')')) {
        k++;
      } else {
        for (;;) {
          args.push(parseExpr());
          const t = peek();
          if (isOp(t, ',')) { k++; continue; }
          if (isOp(t, ')')) { k++; break; }
          throw t.t === 'end' ? new ParseError("Missing ')' to close '('", open.pos) : unexpected(t);
        }
      }
      depth--;
      let id = FUNCS[tok.lower];
      if (id === 'log') {
        if (args.length === 1) id = 'ln';
        else if (args.length === 2) id = 'logb';
        else throw new ParseError('log takes 1 or 2 arguments', tok.pos);
      }
      const want = arityOf(id);
      if (args.length !== want) throw new ParseError(tok.text + ' takes ' + plural(want), tok.pos);
      return { type: 'call', name: id, args };
    }

    const ast = parseExpr();
    if (peek().t !== 'end') throw unexpected(peek());
    return ast;
  }

  EML.ParseError = ParseError;
  EML.parse = parse;
})(typeof window !== 'undefined' ? window : globalThis);
