# EML Calculator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static web page with (a) a real two-button calculator (`1`, `EML`) and (b) a scientific calculator that shows how every element of a typed expression is built from `1` and `eml(x,y) = eˣ − ln y`, with a foldable pure-EML tree/text view that resolves step-by-step to the value.

**Architecture:** Pure-logic core (complex math → hash-consed EML DAG + recipe call tree → parser/compiler → view model + resolver) is UI-free and tested in Node. Thin UI modules render it (SVG tree, text view, two modes, explainer). All files are classic scripts attaching to one global `EML` namespace so they load identically from `file://` and in Node tests.

**Tech Stack:** Vanilla HTML/CSS/JS (ES2020), no build step, no dependencies, no CDNs. Tests: Node 22 built-in runner (`node --test`).

**Spec:** `docs/superpowers/specs/2026-11-14-eml-calculator-design.md` (read it — it holds the UI behaviour, recipe table and the reasons behind the numeric policies).

## Global Constraints

- Every `js/*.js` file is wrapped as: `(function (root) { const EML = (root.EML = root.EML || {}); … })(typeof window !== 'undefined' ? window : globalThis);` — no `import`/`export`, no `require` in `js/`.
- Script load order (index.html and tests/load.js must match): `complex.js, eml-core.js, recipes.js, parser.js, compiler.js, view-model.js, resolve.js, rpn.js, view-tree.js, view-text.js, explainer.js, mode-two.js, mode-sci.js, app.js`.
- **Zero-sign policy (decided by prototype, do not change):** `EML.ZERO = -0`. The leaf `1` evaluates to `{re: 1, im: -0}`; the per-node snap writes `-0` for snapped parts. With this, eml-built `ln(−1) = +iπ`, `ln(−2) = 0.6931… + 3.1416…i`, `√−4 = +2i` (verified 2026-11-14).
- Recipes for constants under this policy: `i = exp(ln(−1) ÷ 2)`, `π = −i × ln(−1)` (NOT the repo's `−exp(…)` / `i × ln(−1)` forms).
- Snap is **relative only**: `im → EML.ZERO` if `im === 0 || |im| ≤ 1e−12·|re|`; `re → EML.ZERO` if `re === 0 || |re| ≤ 1e−12·|im|`. No `max(1,·)` floor.
- Integer doubling uses `mul(two, term)`, never `add(term, term)`.
- No `alert()/confirm()/prompt()` anywhere. No external network requests.
- Literal cap: ≤ 6 significant digits and |value| ≤ 1e6, else ParseError `"Number too long to build in EML — round it to 6 digits"`.
- Visible-tree cap: 1500 positions.
- Radians only.

## Review Focus

1. **Empty / garbage / half-typed input** (`""`, `"sin("`, `"2++"`, `"foo(2)"`) → friendly message in the result area, never an exception in the console. → tests in Task 4.
2. **Deep nesting** (`sin(cos(tan(2)))+3`) → `EML.run` finishes in < 2 s in Node and the page stays responsive (only the folded tree is drawn). → test in Task 5.
3. **Division by zero / undefined points** (`1/0`, `ln(0)`) → status `'undefined'` with "not defined in standard math either", not a fake limit. → test in Task 5.
4. **Button mashing in two-button mode** (EML with < 2 items; pressing keys during preset playback) → inline hint; any manual press cancels playback. → tests in Task 7 (rpn) + manual check in Task 9.
5. **Pasted Unicode** (`2×3`, `6÷2`, `5−1`, `2π`, `√4`) parses like ASCII. → test in Task 4.

---

### Task 1: Complex arithmetic + test loader

**Files:**
- Create: `js/complex.js`, `tests/load.js`, `tests/complex.test.js`

**Interfaces:**
- Produces (`EML.C` and `EML.ZERO`):
  - `EML.ZERO = -0`
  - `C.cx(re, im = EML.ZERO) → {re, im}`
  - `C.add, C.sub, C.mul, C.div (a, b) → complex`; `C.neg(a)`; `C.abs(a) → number`
  - `C.exp(z, flags?) → complex` — `re === -Infinity → cx(0, ZERO)`; `re === +Infinity → cx(Infinity, ZERO)`; when `z.im === 0` return `cx(Math.exp(re), z.im)` (keeps signed zero); else `e^re·(cos im, sin im)`. If `flags` given: finite input with non-finite output → `flags.overflow = true`; finite input with output exactly 0 → `flags.underflow = true`.
  - `C.log(z) → complex` — `(Math.log(hypot), Math.atan2(im, re))`; `log(0) = cx(-Infinity, ZERO)`.
  - `C.snap(z) → complex` (Global Constraints rule)
  - `C.eml(a, b, flags?) → snap(sub(exp(a, flags), log(b)))`
  - `C.isFinite(z) → bool`; `C.approxEq(a, b, rel = 1e-9, abs = 1e-12) → bool` (on |a−b| ≤ abs + rel·max(|a|,|b|))
  - `C.format(z, digits = 10) → string` — trims trailing zeros; shows real only when `|im| ≤ 1e-10·max(1,|re|)`; imaginary-only as `"2i"`, `"−i"`; mixed `"0.6931471806 + 3.141592654i"`; non-finite as `"∞"`, `"−∞"`, `"undefined"` (NaN). Uses Unicode minus `−`.
  - `C.ref` — principal-branch reference functions taking/returning complex, **normalising −0 imaginary inputs to +0 first**: `exp, ln, sqrt, pow(a,b), sin, cos, tan, asin, acos, atan, sinh, cosh, tanh, asinh, acosh, atanh, sigmoid, logb(b,z), avg(a,b), hypot(a,b), half, sqr, inv`. Real inputs within the real domain must equal `Math.*` to 1e-12; build complex ones from `C.exp/C.log/C.sqrt` via standard formulas (`asin z = −i·ln(iz + √(1−z²))`, `acos = π/2 − asin`, `atan z = (i/2)·ln((i+z)/(i−z))`, `asinh = ln(z+√(z²+1))`, `acosh = ln(z + √(z+1)·√(z−1))`, `atanh = ½·ln((1+z)/(1−z))`; for real inputs short-circuit to `Math.*`).
- `tests/load.js`: `module.exports = function load() { … }` — runs every `js/*.js` file that exists, in the Global-Constraints order, with `vm.runInThisContext(source, {filename})`, once; returns `globalThis.EML`. Skips UI files (`view-tree, view-text, explainer, mode-two, mode-sci, app`).

- [ ] **Step 1: Write failing tests** in `tests/complex.test.js` (use `node:test` + `node:assert/strict`):
  - `C.eml(cx(1), cx(1))` ≈ `Math.E`
  - `C.exp(cx(-Infinity))` is `{re:0}`; `C.log(cx(0)).re === -Infinity`
  - flags: `C.exp(cx(800), f)` sets `f.overflow`; `C.exp(cx(-800), f)` sets `f.underflow`; `C.exp(cx(Infinity), f)` sets neither
  - snap: `C.snap(cx(5, 1e-14)).im` is `-0` (`Object.is`); `C.snap(cx(1e-20, 0)).re === 1e-20` (relative only!)
  - `C.format(cx(2, -0)) === "2"`; `C.format(cx(0, 2)) === "2i"`; `C.format(cx(-1.5, -2)) === "−1.5 − 2i"`
  - `C.ref.ln(cx(-2, -0))` ≈ `0.6931471805599453 + 3.141592653589793i` (normalises −0)
  - `C.ref.sqrt(cx(-4))` ≈ `2i`; `C.ref.asin(cx(0.5)).re` ≈ `Math.asin(0.5)`; `C.ref.atan(cx(1)).re` ≈ `Math.PI/4`
- [ ] **Step 2:** Run `node --test` → FAIL (`EML.C` undefined).
- [ ] **Step 3:** Implement `js/complex.js` and `tests/load.js` per Interfaces.
- [ ] **Step 4:** Run `node --test` → all PASS.
- [ ] **Step 5:** Commit: `git add js/complex.js tests/ && git commit -m "feat: complex arithmetic with EML zero-sign policy"`

---

### Task 2: EML DAG + recipe recorder

**Files:**
- Create: `js/eml-core.js`, `tests/core.test.js`

**Interfaces:**
- Consumes: `EML.C`, `EML.ZERO`.
- Produces `EML.dag`:
  - Node shapes: `{id, kind:'one'}`, `{id, kind:'var', name}`, `{id, kind:'eml', a, b}`, `{id, kind:'lit', inner, value}`. `one`, `var(name)` and `eml(a,b)` are hash-consed (key `` `eml:${a.id}:${b.id}` ``); `lit` is **never** shared (fresh id each call).
  - `dag.one()`, `dag.variable(name)`, `dag.eml(a, b)`, `dag.literal(inner, value)`
  - `dag.makeEvaluator(env = {}) → (node) => complex` — memoised by node id; `env.vars: {[name]: complex}`, `env.overrides: Map<litNodeId, complex>`, `env.flags: {overflow, underflow}` (created if absent and exposed as `evaluator.flags`). `one` → `cx(1, ZERO)`; `lit` → override if present else eval(inner); `eml` → `C.eml(eval(a), eval(b), flags)`. Must not overflow the JS stack on depth ≤ 3000 (use an explicit stack, post-order).
  - `dag.evaluate(node, env) → {value, flags}` (wrapper)
  - `dag.K(node) → number` (leaves + eml nodes of the full expansion; `lit` counts as its inner; memoised), `dag.height(node) → number` (leaf = 0), `dag.uniqueCount(node) → number` (distinct ids reachable), `dag.rpn(node, cap = 5000) → string | null` (`'1'`, var name, `'E'`; null if K > cap).
- Produces `EML.calls` (recipe call tree; CallNode = `{prim, args: CallNode[], body: CallNode | null, root: Node, label}`):
  - `calls.one()` → `{prim:'1', args:[], body:null, root:dag.one(), label:'1'}`
  - `calls.variable(name)`, `calls.eml(a, b)` → `{prim:'eml', args:[a,b], body:null, root:dag.eml(a.root,b.root), label:'eml'}`
  - `calls.invoke(primId, args, label?) → CallNode` — looks up `EML.recipeById[primId]`, `body = recipe.build(EML.R, ...args)`, `root = body.root`, `label = label ?? recipe.symbol`. Zero-arity prims are memoised (same CallNode object every time).
  - `calls.literal(value, text, body)` → `{prim:'lit', args:[], body, root: dag.literal(body.root, value), label: text, value}`
- Produces `EML.R` (recorder façade used by recipe builders): `R.one()`, `R.eml(a,b)`, `R.call(id, ...args)`; plus one shortcut per recipe id generated by `recipes.js` (Task 3).

- [ ] **Step 1: Write failing tests** `tests/core.test.js`:
  - hash-consing: `dag.eml(dag.one(), dag.one()) === dag.eml(dag.one(), dag.one())`; two `dag.literal(x, 1)` calls have different ids
  - `dag.evaluate(dag.eml(one, one)).value` ≈ e; `dag.K(dag.eml(one,one)) === 3`; `height === 1`
  - ln via raw nodes: `L = eml(one, eml(eml(one, X), one))` with `X = dag.variable('x')`, `env.vars.x = cx(2)` → ≈ `Math.LN2`; `K(L) === 7`; `rpn(L) === "11xE1EE"` (paper §4.1)
  - overrides: `lit = dag.literal(one, 1)`; evaluate `dag.eml(lit, one)` with `overrides = new Map([[lit.id, cx(2)]])` → ≈ e²
  - deep chain: `prev = one; 3000× prev = dag.eml(one, prev)` → `dag.evaluate(prev)` does not throw (value may be non-finite) and `dag.height(prev) === 3000`
  - `calls.eml(calls.one(), calls.one()).label === 'eml'`
- [ ] **Step 2:** `node --test` → FAIL.
- [ ] **Step 3:** Implement `js/eml-core.js`.
- [ ] **Step 4:** `node --test` → PASS.
- [ ] **Step 5:** Commit `feat: hash-consed EML DAG and recipe call recorder`.

---

### Task 3: Recipe table + pure-EML accuracy gate

**Files:**
- Create: `js/recipes.js`, `tests/recipes.test.js`

**Interfaces:**
- Consumes: `EML.calls`, `EML.R`, `EML.C.ref`.
- Produces `EML.recipes` (ordered array) and `EML.recipeById`. Entry:
  `{id, symbol, name, arity, deps: string[], formula: string, explain: string, build(R, ...args) → CallNode, ref(...complex) → complex, points: Array<number | number[]>, paperK?: number}`
  - `formula` is the human recipe in terms of earlier prims (spec table text, e.g. `"eml(ln a, exp b)"`); `explain` is one plain-English sentence for non-math people.
- Ids and order (must match spec table, with this branch policy): `one, exp, e, ln, zero, sub, neg, add, inv, mul, div, pow, minusOne, two, i, pi, half, sqr, sqrt, logb, sinh, cosh, tanh, sigmoid, sin, cos, tan, arcsin, arccos, arctan, arsinh, arcosh, artanh, avg, hypot`.
  - `i`: `R.exp(R.div(R.ln(R.minusOne()), R.two()))`; `pi`: `R.mul(R.neg(R.i()), R.ln(R.minusOne()))`.
  - `sqrt(z) = pow(z, R.rational(1,2))`; `arccos z = sub(div(pi, two), arcsin z)`; `sigmoid z = div(one, add(one, exp(neg z)))`; others exactly per spec table.
- Produces on `EML.R`: a shortcut per id (`R.ln(a)`, `R.sub(a,b)`, `R.pi()`, …) = `R.call(id, …)`, plus:
  - `R.int(n) → CallNode` (memoised by n): `0 →` the `zero` CallNode itself, `1 →` `R.one()` itself; otherwise prim `'int'`, label `String(n)`: `n<0 → neg(int(−n))`, else binary method from spec row 13 with `term = mul(two, term)`.
  - `R.rational(p, q) → CallNode` (prim `'rat'`, label `` `${p}/${q}` ``): `q===1 → int(p)`; else `mul(int(|p|), inv(int(q)))`, negated if p<0.
- Test points: unary real `[-2.5, -1, -0.5, 0.3, 0.5, 1.7, 3]` filtered by domain — `ln, sqrt, logb(z)`: > 0; `arcsin, arccos, artanh`: (−1, 1); `arcosh`: > 1; `inv, div(b)`: ≠ 0; binary ops use pairs from `[[2,3],[-1.5,0.5],[0.3,-2],[3,-2.5]]` (pow/logb/hypot restricted to positive base / valid domains). **Avoid 0 as an input** (zero points are Task 5's job).

- [ ] **Step 1: Write failing tests** `tests/recipes.test.js`:
  - For every recipe with arity ≥ 1: build `R.call(id, ...vars)` with `calls.variable('x')`/`'y'`, evaluate the **pure DAG** (`dag.evaluate(call.root, {vars})`) at each point and `assert(C.approxEq(got, recipe.ref(...inputs), 1e-9))`; message names id + point.
  - Constants: `e ≈ Math.E`, `zero ≈ 0`, `minusOne ≈ −1`, `two ≈ 2`, `i ≈ cx(0,1)`, `pi ≈ Math.PI` (and `pi` imaginary part ≈ 0).
  - Branch: eml `ln` of `cx(-1)`, `cx(-2)`, `cx(-0.5)` equals `C.ref.ln` of the same (≈ +iπ imaginary part); `sqrt(cx(-4))` ≈ `2i`.
  - Every `deps` id appears earlier in `EML.recipes`.
  - Paper Table 4 K (via `dag.K` of the call with variables x,y as leaves): `exp 3, e 3, ln 7, zero 7, sub 11, add 27, mul 41, minusOne 17, two 27` — store as `paperK` and assert. Print a K table for all recipes with `console.log` (informational; i and π are expected to differ from paper's 131/193).
  - `R.int(1000)` and `R.int(1000000)` evaluate to 1000 / 1e6 (proves doubling via mul, no overflow); `R.rational(-3, 4)` ≈ −0.75.
  - Overflow flag: `R.sub(R.one(), int800)` evaluates with `flags.overflow === true` where `int800 = R.int(800)`.
- [ ] **Step 2:** `node --test` → FAIL.
- [ ] **Step 3:** Implement `js/recipes.js`. If any accuracy test fails, fix the recipe (alternate identity), never loosen the test; record the change in the spec's recipe table.
- [ ] **Step 4:** `node --test` → PASS (this is the correctness gate — no UI work before it is green).
- [ ] **Step 5:** Commit `feat: EML recipe table for all Table-1 primitives, verified on pure trees`.

---

### Task 4: Expression parser

**Files:**
- Create: `js/parser.js`, `tests/parser.test.js`

**Interfaces:**
- Produces `EML.parse(src: string) → AST` and `EML.ParseError` (`class extends Error { constructor(message, pos) }`).
- AST: `{type:'num', value:number, text:string}` | `{type:'const', name:'pi'|'e'|'i'}` | `{type:'neg', arg}` | `{type:'bin', op:'+'|'-'|'*'|'/'|'^', left, right}` | `{type:'call', name: recipeId, args: AST[]}`.
- Grammar: `+ −` < `× ÷` (and implicit multiplication) < unary minus < `^` (right-assoc; `-2^2 = -(2^2)`). Implicit multiplication when a number/constant/`)` is directly followed by a number, constant, function name or `(` (`2pi`, `3(1+2)`, `(1)(2)`, `2sin(1)`).
- Unicode aliases: `× * ·` → `*`; `÷ /` → `/`; `− –` → `-`; `π` → pi; `√` → sqrt (as prefix function: `√4`, `√(4)`); `σ` → sigmoid.
- Function names → recipe ids: `exp, ln, sqrt, sqr, half, inv, sigmoid, sin, cos, tan, sinh, cosh, tanh, avg, hypot`; `log` (1 arg → `ln`, 2 args `log(b, z)` → `logb`); `arcsin|asin`, `arccos|acos`, `arctan|atan`, `arsinh|asinh|arcsinh`, `arcosh|acosh|arccosh`, `artanh|atanh|arctanh`. Wrong arg count → ParseError `"sin takes 1 argument"`.
- Errors (ParseError with position): empty input `"Type an expression"`, unknown name `"Unknown function 'foo'"`, unbalanced parens, dangling operator, unexpected character.

- [ ] **Step 1: Write failing tests** (assert on AST shape or on a small `show(ast)` helper in the test file that prints prefix form):
  - `1+2*3` → `(+ 1 (* 2 3))`; `2^3^2` → `(^ 2 (^ 3 2))`; `-2^2` → `(neg (^ 2 2))`; `2pi` → `(* 2 pi)`; `3(1+2)` → `(* 3 (+ 1 2))`
  - `log(2, 8)` → `(logb 2 8)`; `log(8)` → `(ln 8)`; `asin(0.5)` → `(arcsin 0.5)`
  - Unicode: `2×3`, `6÷2`, `5−1`, `2π`, `√4` parse like ASCII
  - Errors are `EML.ParseError` (not TypeError): `""`, `"sin("`, `"2++"`, `"foo(2)"`, `"sin(1,2)"`, `"2)"`, `"$"`
  - `num.text` preserved: `0.50` → text `"0.50"`, value 0.5
- [ ] **Step 2:** `node --test` → FAIL.
- [ ] **Step 3:** Implement `js/parser.js` (hand-written tokenizer + precedence-climbing parser).
- [ ] **Step 4:** `node --test` → PASS.
- [ ] **Step 5:** Commit `feat: expression parser with unicode and implicit multiplication`.

---

### Task 5: Compiler, reference evaluator, `EML.run` with honest status

**Files:**
- Create: `js/compiler.js`, `tests/compiler.test.js`

**Interfaces:**
- Consumes: `EML.parse`, `EML.R`, `EML.calls`, `EML.dag`, `EML.C`, `EML.recipeById`.
- Produces:
  - `EML.numberToRational(text) → {p, q}` — exact decimal → reduced fraction (`"0.5" → {1,2}`, `"2.50" → {5,2}`, `"3" → {3,1}`); throws ParseError per literal cap.
  - `EML.compile(ast) → CallNode` — `num` → `calls.literal(value, text, R.rational(p,q))`; `const` → `R.pi()/R.e()/R.i()`; `neg` → `R.neg`; `bin` ops `+ - * / ^` → `add sub mul div pow`; `call` → `R.call(name, ...args)`.
  - `EML.reference(ast) → complex` via `recipeById[...].ref` and `C.ref` (literals `cx(v, +0)`).
  - `EML.run(src) → Result`:
    `{src, ast, call, root, K, height, unique, value, raw, ref, status, note, flags, overrides}` where `status ∈ 'ok'|'limit'|'overflow'|'mismatch'|'undefined'|'error'` (`'error'` = ParseError; `note` = its message; other fields null).
- Status algorithm (exact order):
  1. `ref` non-finite or NaN → `'undefined'`, `value = ref`, note `"Not defined here in standard math either."`
  2. `raw = evaluate(root)`. Finite and `approxEq(raw, ref, 1e-7)` → `'ok'`, `value = raw`.
  3. `flags.overflow || flags.underflow` → `'overflow'`, `value = raw`, note `"This EML route computes an e^(…) too big for a 64-bit float, so the tree can't finish. Standard math says ${format(ref)}."`
  4. Limit: collect every `lit` node under root; side ± with overrides `v → v·(1±1e-12)` (or `±1e-14` when v = 0 — √δ must be ≪ 1e-6 for `sqrt(0)` to pass); evaluate both (fresh evaluators); if both finite, agree within 1e-6, and their average ≈ ref within 1e-6 → `'limit'`, `value = average` with any real/imag part of magnitude < 1e-6 set to 0, `overrides` = the + side map, note `"EML can't reach this point exactly — this is the limit as you approach it."`
     (If a zero-point test lands in `'overflow'` because flags were set spuriously, run step 4 before step 3.)
  5. Otherwise `'mismatch'`, `value = raw`, note `"The EML tree and standard math disagree here (branch cut or precision). Standard math says ${format(ref)}."`

- [ ] **Step 1: Write failing tests:**
  - `ok`: `ln(2)`, `sin(2)+3`, `sqrt(2)*pi`, `2^10` (≈1024), `arcsin(0.5)`, `hypot(3,4)` (≈5), `log(2,8)` (≈3), `0.1+0.2` (≈0.3)
  - complex `ok`: `ln(-2)` ≈ `0.693… + 3.1416…i`; `sqrt(-4)` ≈ `2i`; `i*i` ≈ −1
  - `limit`: `0*5`, `sin(0)`, `tanh(0)`, `sqrt(0)` → value ≈ 0 (abs 1e-6), note contains "limit"
  - `overflow`: `-1000`, `800+800`, `1-800` → status `'overflow'`; `500+500` → `'ok'` (≈1000)
  - `undefined`: `1/0`, `ln(0)`
  - `error`: `"sin("`, `"1234567.8"` (literal cap)
  - perf: `EML.run('sin(cos(tan(2)))+3')` returns status `'ok'` in < 2000 ms
  - `numberToRational('2.50')` → `{p:5, q:2}`
- [ ] **Step 2:** `node --test` → FAIL.
- [ ] **Step 3:** Implement `js/compiler.js`.
- [ ] **Step 4:** `node --test` → PASS. If a case lands in the wrong status, investigate the recipe/limit logic (systematic-debugging), don't edit the expectation.
- [ ] **Step 5:** Commit `feat: compiler with reference check, limits and overflow status`.

---

### Task 6: View model (folding) + resolver (stepping)

**Files:**
- Create: `js/view-model.js`, `js/resolve.js`, `tests/view.test.js`

**Interfaces:**
- Consumes: CallNode, `EML.dag`.
- Produces `EML.viewModel.build(rootCall, {unfolded = new Set(), unfoldAll = false}, cap = 1500) → {root: VNode, count} | {tooBig: true, count}`
  - `VNode = {path, call, kind: 'one'|'var'|'eml'|'blob', label, children: VNode[]}`.
  - Root path `''`. A CallNode with `body !== null` is a **blob** unless its path is in `unfolded` (or `unfoldAll`): folded blob → kind `'blob'`, children = its args at paths `` `${path}/${i}` ``; unfolded → the VNode of its `body` built at path `` `${path}>` ``. `eml` → children at `/0`, `/1`. `lit`/`int`/`rat`/constants are blobs with no children.
  - `count` = number of VNodes. Stop building as soon as it exceeds `cap` and return `{tooBig: true, count: dag.K(rootCall.root)}` (full-expansion size, used in the "N nodes" message).
- Produces `EML.Resolver`: `new Resolver(vroot, evalNode: (dagNode) => complex)`
  - `values: Map<path, complex>` (resolved positions); leaves `one`/`var` are resolved at construction.
  - `frontier() → VNode[]` (unresolved, all children resolved); `step() → VNode[]` (resolves the frontier, value = `evalNode(v.call.root)`, pushes history); `back()`; `reset()`; getters `stepIndex`, `totalSteps` (= height of visible tree, where leaves height 0 and a childless blob height 1), `done`.
  - A folded blob resolves as one position once its args are resolved.

- [ ] **Step 1: Write failing tests** (build calls through `EML.compile(EML.parse(src))`):
  - `build` for `ln(2)` folded → root kind `'blob'`, label `'ln'`, one child (the literal blob `'2'`), count 2.
  - unfolding root of `ln(2)` (`unfolded = {''}`) → root kind `'eml'` at path `'>'`; tree contains the literal blob.
  - `unfoldAll` on `sin(2)` with cap 1500 → `tooBig: true` with `count > 1500`.
  - `unfoldAll` on `exp(1)` → not tooBig; every VNode kind ∈ {`one`, `eml`} (the literal `1` unfolds to the leaf); count 3.
  - Resolver on `sin(2)+3` folded: stepping until `done` makes `values.get('')` ≈ `Math.sin(2)+3`; `totalSteps === 3`; `back()` then `step()` returns same frontier paths; `reset()` → `stepIndex === 0`.
  - Resolver on fully unfolded `exp(1)`: final value ≈ e.
- [ ] **Step 2:** `node --test` → FAIL.
- [ ] **Step 3:** Implement `js/view-model.js`, `js/resolve.js`.
- [ ] **Step 4:** `node --test` → PASS.
- [ ] **Step 5:** Commit `feat: foldable view model and step resolver`.

---

### Task 7: Two-button RPN machine + value recognizer

**Files:**
- Create: `js/rpn.js`, `tests/rpn.test.js`

**Interfaces:**
- Produces `EML.RpnMachine`: `new RpnMachine()`; `push1()`; `pressEml() → null | string` (error `"EML needs two values on the stack — press 1 first"` when < 2); `undo()`; `clear()`; `stack: Array<{call: CallNode, value: complex}>` (bottom→top); `tape: string` (paper notation `1`/`E`, e.g. `"11E"`); `top → item|null`. Each EML press builds `calls.eml(a, b)` where b = popped top, a = next.
- Produces `EML.presets: Array<{id, label, call}>` for `e, zero (0), minusOne (−1), two (2), half (1/2 = R.rational(1,2)), i, pi` and `EML.presetTape(call) → string` = `dag.rpn(call.root, 100000)`.
- Produces `EML.recognize(value: complex) → string | null` — matches (rel 1e-9) against: integers −10…10, `1/2`, `−1/2`, `e`, `π`, `i`, `−i`, `ln 2`, `√2`, `e^e`; returns e.g. `"e"`, `"π"`, `"2"`, `"1/2"`.

- [ ] **Step 1: Write failing tests:** `1 1 E` → tape `"11E"`, top value ≈ e, `recognize` → `"e"`; `pressEml()` on empty returns the error string and leaves stack unchanged; `undo()` after `11E` → stack has two 1s and tape `"11"`; replaying `presetTape(pi call)` keypress-by-keypress through the machine yields top ≈ π and `recognize` → `"π"`; same for `zero` → `"0"`, `i` → `"i"`.
- [ ] **Step 2:** `node --test` → FAIL.
- [ ] **Step 3:** Implement `js/rpn.js`.
- [ ] **Step 4:** `node --test` → PASS.
- [ ] **Step 5:** Commit `feat: two-button RPN machine, presets and recognizer`.

---

### Task 8: Page shell, styles, mode switch, explainer

**Files:**
- Create: `index.html`, `css/style.css`, `js/app.js`, `js/explainer.js`

**Interfaces:**
- Consumes: everything above (script order per Global Constraints).
- `index.html` structure (ids are contracts for Tasks 9–11): `header` with `#mode-switch` (two buttons `data-mode="two"` / `data-mode="sci"`, `aria-pressed`), `#btn-explain`, `#btn-large` (large-type toggle); `main` with `<section id="mode-two">` and `<section id="mode-sci" hidden>`; `<dialog id="explainer">`.
- `app.js`: `EML.app.setMode('two'|'sci')` toggles sections + `aria-pressed`, remembers last mode in `localStorage` (try/catch); `#btn-large` toggles `html.large` (root font-size 125%), also remembered; calls `EML.modeTwo.init(sectionEl)` / `EML.modeSci.init(sectionEl)` if defined.
- `explainer.js`: `EML.explainer.open()` fills `#explainer` (once) and `showModal()`; content per spec "What is EML?" section, including a live slider x ∈ [0.1, 5] showing `eml(x,1)` vs `Math.exp(x)` and `eml(1, eml(eml(1,x),1))` vs `Math.log(x)` computed with `EML.C.eml`; closes on Esc / close button / backdrop click; arXiv link `https://arxiv.org/abs/2603.21852`.
- `style.css`: colour tokens on `:root`, dark set under `@media (prefers-color-scheme: dark)`; explicit `body` background; system font stack + `ui-monospace` for math; ≥ 44px touch targets; single column < 900px, two panels ≥ 900px; no horizontal page scroll at 360px.

- [ ] **Step 1:** Create the files with the structure above (empty mode sections are fine).
- [ ] **Step 2:** Verify in Chrome (claude-in-chrome) by opening `file:///C:/Users/wupet/OneDrive/Desktop/code/The%20EVIL%202%20func%20calc/index.html`: no console errors; mode switch toggles sections; explainer opens, slider updates both values and they match; large-type toggles; reload remembers mode.
- [ ] **Step 3:** `node --test` still PASS.
- [ ] **Step 4:** Commit `feat: page shell, mode switch and EML explainer`.

---

### Task 9: Tree + text renderers and two-button mode UI

**Files:**
- Create: `js/view-tree.js`, `js/view-text.js`, `js/mode-two.js`

**Interfaces:**
- `EML.TreeView`: `new TreeView(containerEl, {onBlobClick(path), onFit?})`; `render(vroot, resolver | null, {highlight: Set<path>})`; `fit()`. SVG; layout: leaves on consecutive x slots, parent x = mean of children, y = depth × row height; `eml` nodes drawn as small circles labelled `E`, `1` as leaf squares, blobs as rounded pills with `label` (+ `(…)` if it has children), resolved positions drawn as value chips (`C.format(v, 6)`) with their subtree hidden; frontier highlighted. Pan (pointer drag), zoom (wheel, two-pointer pinch) via `viewBox`; `fit()` frames the whole tree.
- `EML.TextView`: `new TextView(containerEl)`; `render(vroot, resolver)` — one line per step 0…`stepIndex`: serialisation `eml(a, b)`, `1`, blob `label(args…)`/`label`, resolved → number; parts resolved in that step wrapped in `<mark>`; lines longer than 2000 chars truncated in the middle as `…(N symbols)…`. Build text with DOM nodes / `textContent` (no innerHTML of user input).
- `EML.modeTwo.init(sectionEl)`: big `1` and `EML` buttons; undo, clear; tape (monospace, wraps); stack list (values via `C.format`); tree of top-of-stack via `TreeView` (fully unfolded raw tree — the stack items are raw eml calls, so no blobs); recognizer badge (`"= e!"`); presets `<select>` + Play + Skip-to-end + speed; playback presses the machine at the chosen speed; **any manual press or a new preset cancels playback**; inline error hint from `pressEml()` (auto-clears on next press). Keyboard: `1` key and `e`/`Enter` for EML.

- [ ] **Step 1:** Implement the three files.
- [ ] **Step 2:** Verify in Chrome: press `1 1 EML` → value 2.718281828…, badge "= e!", tree shows `E` with two `1` leaves; EML on empty stack shows hint, no console error; preset π plays, Skip jumps to end, value ≈ 3.14159 and badge "= π!"; pressing `1` mid-playback stops it; screenshot at 375px width shows no horizontal scroll.
- [ ] **Step 3:** `node --test` still PASS.
- [ ] **Step 4:** Commit `feat: SVG tree, text view and two-button calculator UI`.

---

### Task 10: Scientific mode UI

**Files:**
- Create: `js/mode-sci.js`

**Interfaces:**
- Consumes: `EML.run`, `EML.viewModel`, `EML.Resolver`, `EML.TreeView`, `EML.TextView`, `EML.recipes`, `EML.dag`, `EML.C`.
- `EML.modeSci.init(sectionEl)` builds:
  1. **Input row**: text input + Evaluate (Enter also evaluates); keypad: digits, `. + − × ÷ ^ ( )`, `π e i`, `⌫`, `C`, and function buttons for every Table-1 function (insert `name(`).
  2. **Result card**: big value (`result.value` via `C.format`), status badge — `ok` "✓ matches standard math", `limit` "≈ limit", `overflow` "⚠ overflow", `mismatch` "≠ differs", `undefined` "undefined", `error` (message only) — plus `note` text and the reference value line ("Standard math: …"). Stats: K ("pure-EML size: N symbols"), height, unique nodes.
  3. **Breakdown panel** "How each piece is built": one card per distinct element of the AST (numbers by text, operators, constants, functions) — symbol, name, `formula`, its pure-EML size (`dag.K` of a sample build with variables), and its value in this expression; clicking a card highlights its positions in the tree.
  4. **"How it's built" dropdown** (`<select>` listing all `EML.recipes` in order as `symbol — name`): detail pane with `formula`, `explain`, deps chain (each dep clickable to switch selection), K, a small `TreeView` of the recipe with variables folded one level, and "Try it" that inserts an example (`sin(1)`, `log(2, 8)`, …) into the input.
  5. **Expanded view**: Tree | Text toggle (shared state), "Unfold all" (shows the count message when `tooBig`), "Fold all", click blob → unfold that path (resets resolver), controls ◀ ▶ ▶▶/⏸ speed reset, step counter `stepIndex / totalSteps`. Resolver's `evalNode` uses `dag.makeEvaluator({overrides: result.overrides})` so limit results resolve with the same nudged literals (show the note).
- Evaluating a new expression stops playback and resets fold state.

- [ ] **Step 1:** Implement `js/mode-sci.js`.
- [ ] **Step 2:** Verify in Chrome (each with screenshot): `ln(2)` ✓; `sin(2)+3` ✓ and stepping reaches the value in both Tree and Text; unfold `sin` shows the "too many nodes" message with count; unfold `ln` blob shows raw eml nodes; `-1000` overflow badge with standard value in note; `sin(0)` limit badge, value 0; `ln(-2)` shows `0.6931471806 + 3.141592654i`; `sqrt(-4)` shows `2i`; `""` and `sin(` show messages, no console errors; dropdown entry for `π` shows formula, deps and tree; "Try it" works.
- [ ] **Step 3:** `node --test` still PASS.
- [ ] **Step 4:** Commit `feat: scientific mode with breakdown, recipe dropdown and step resolve`.

---

### Task 11: Polish + full verification

**Files:**
- Modify: `css/style.css`, any UI file with issues found
- Create: `README.md` (what it is, how to open, how to run tests, paper citation)

- [ ] **Step 1:** Check in Chrome at 375×800, 1280×800 and large-type mode in light and dark (`prefers-color-scheme` emulation via devtools or OS): no horizontal scroll, readable from projector distance, buttons ≥ 44px.
- [ ] **Step 2:** Run the full Verification list from the spec end-to-end; fix anything off.
- [ ] **Step 3:** `node --test` → all PASS; paste summary line.
- [ ] **Step 4:** Commit `chore: polish, README`.
