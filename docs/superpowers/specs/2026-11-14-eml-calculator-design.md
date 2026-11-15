# EML Calculator — design + implementation plan

## Context
The paper in this folder (`2603.21852v2.pdf`, Odrzywołek, "All elementary functions from a single operator") shows that
**eml(x, y) = eˣ − ln(y)** plus the constant **1** can rebuild every button of a scientific calculator.
The user wants a demo that makes this tangible **for other people** — used both live (projector/screen-share) and
by people opening a link themselves (incl. phones). It must explain itself to someone who never read the paper.

Requested features:
1. A real **two-button calculator** (`1`, `EML`).
2. A **scientific calculator**: type a normal expression → see how each element is built from 1 and eml.
3. An **expanded view** of the pure-EML version that visibly **resolves step-by-step** to the value.
4. A **mode switch** button, a **dropdown** (scientific mode) showing how each function is made, and a
   **"What is EML?"** explainer button.

User decisions: audience = showing others, both live and self-serve. Two-button input style = my call. Resolve view = **both** a collapsing tree and line-by-line text rewriting, toggleable.
Isolated failure points (e.g. 0) → **show the limit with a note**. Complex results → **match standard
principal-branch math** (ln(−2) = 0.693 + 3.142i).

My calls (flag to user): RPN stack for two-button mode (matches paper's `11xE1EE` notation); radians only;
function list = paper's Table 1; vanilla HTML/CSS/JS, **no build step, no ES modules** (runs from `file://`, any static host, works offline); implicit multiplication (`2pi`, `3(1+x)`) supported; hosting decided after it works.

## Tech & file layout
Project root: `C:\Users\wupet\OneDrive\Desktop\code\The EVIL 2 func calc\`
Each JS file is a classic script that attaches to one global namespace `window.EML` (pattern:
`(function(root){ const EML = root.EML = root.EML || {}; ... })(typeof window!=='undefined'?window:globalThis);`)
so the same files load in the browser and in Node tests (via `vm.runInThisContext` in load order).

```
index.html            layout, script tags in dependency order
css/style.css         tokens, light/dark, responsive (phone ≥360px, projector-friendly large type option)
js/complex.js         complex arithmetic (numpy-complex128-like semantics, extended reals)
js/eml-core.js        hash-consed node DAG, eml eval, K (leaf+node count), height, memo
js/recipes.js         primitive table: builders in terms of earlier primitives, tags, docs, domains
js/parser.js          expression string → AST
js/compiler.js        AST → tagged EML DAG; numeric literals; reference (direct Math) evaluator
js/resolve.js         step scheduler over a folded view
js/view-tree.js       SVG tree renderer (fold/unfold, pan/zoom, step highlight)
js/view-text.js       text rewriting renderer
js/mode-two.js        two-button calculator UI
js/mode-sci.js        scientific calculator UI, breakdown panel, "how it's built" dropdown
js/explainer.js       "What is EML?" modal
js/app.js             mode switch, wiring
tests/*.test.js       Node built-in runner (no deps): `node --test`
```

## Numeric core (the correctness gate — build and pass this before any UI)

### complex.js semantics
- `exp(z)`: `e^re·(cos im, sin im)`; special-case `re = −∞ → 0+0i`, `re = +∞ → +∞` (expected inside every
  negation via the ln 0 route — NOT an overflow). **Overflow flag** only when a *finite* input gives a non-finite
  output; **underflow flag** when a finite input gives exactly 0 (e.g. exp(−800) → 0 → later ln 0 = −∞).
- `log(z)`: `(ln|z|, atan2(im, re))`; `log(0) = −∞ + 0i`.
- **Rounding snap (relative only, no `max(1,·)` floor — a floor would zero `exp(−30)` and break `1+30`):** after
  every eml node, set `im := ±0` if `|im| ≤ 1e−12·|re|`, and `re := ±0` if `|re| ≤ 1e−12·|im|`.
- **Branch policy — goal: match standard principal-branch math** (user decision: ln(−2) must show 0.693 **+** 3.142i,
  √−4 = **+**2i). The eml-built ln mirrors the branch of the input's signed zero imaginary part (paper §4.1). Plan:
  1. Try **"snap to −0"**: snapped/zero imaginary parts become −0 (inputs also enter as `re − 0i`). Expected: eml-ln
     of a negative real = ln|x| + iπ (standard). Matching recipes: `i = exp(ln(−1) ÷ 2)`, `π = −i × ln(−1)`.
  2. If (1) fails the harness, use **"snap to +0"** (eml-ln(−1) = −iπ, verified by reviewer) with the repo's recipes
     `i = −exp(ln(−1) ÷ 2)`, `π = i × ln(−1)`, and **correct the final sign**, as the paper's compiler does: for the
     ln/√/pow-of-negative cases, conjugate where the harness shows the result is the conjugate of the reference.
  **Decided 2026-11-14 by prototype: variant (1) "snap to −0" works** (ln(−1)=+iπ, ln(−2), √−4=+2i, i=+i,
  π=+3.14159, sin/cos match Math). Variant (2) is not used. Required to pass: `ln(−1)=iπ`, `ln(−2)`, `ln(−0.5)`, `√−4 = 2i`,
  `i ≈ +i`, `π ≈ +3.14159…`, and all real-domain checks. Fix recipes, never tests.
- Extended reals required: recipes rely on `ln 0 = −∞`, `e^−∞ = 0` (negation goes through ln(0)). No NaN may
  leak from `∞·0` — handle in exp/log explicitly.
- **Complex reference library** (in complex.js, separate from eml): principal-branch `sqrt, pow, sin, cos, tan,
  asin, acos, atan, sinh, cosh, tanh, asinh, acosh, atanh` built from complex exp/log by standard formulas (never via
  eml). Used for the "reference value" so complex inputs/outputs (`ln(-2)`, `sqrt(-4)`, `sin(1+i)`) can be checked.
- **Known silent failure:** `add(a,b)`/`neg(b)` are wrong when |Im b| > π (e.g. `1+4i`). Harness test points stay
  in range; the UI badge catches it via the reference comparison.

### eml-core.js
- Node = `{id, kind: 'one'|'var'|'eml', a, b, tag?}`; hash-consing via `Map` keyed by `kind:a.id:b.id` so shared
  subtrees are one object (DAG). Memoised `eval(node, env)`, `K(node)` (paper's RPN length = leaves+eml nodes,
  computed on DAG with memo, can be huge → use Number, display with thousands separators/"≈1.2e9"),
  `height(node)`, `rpn(node)` (only when K ≤ cap).
- **Recipe call tree (drives folding; separate from the DAG).** Builders never call each other directly; they
  go through a recording wrapper `call(prim, args) → CallNode {prim, args: CallNode[], body: CallNode[] (the
  calls made inside the recipe), root: DAG node}`. Raw `eml(a,b)` and leaves are CallNodes too (`prim: 'eml'|'1'|
  'x'|'lit'`). Shared constants (i, π, 2, 1/2) are memoised CallNodes reused by reference.
  The DAG (hash-consed) is only for evaluation memo and K/height/unique-node stats.
- **Visible tree = positions, not DAG nodes.** The display is the CallNode tree expanded per *position* (an
  argument used twice, as in `sqr` or `sinh`, appears twice). Fold state and resolve state are keyed by position
  path. The ~1500 cap counts visible positions.

### recipes.js — exact table (source: paper + repo `EML_toolkit/EmL_compiler/eml_compiler_v4.py`)
Each entry: `{name, symbol, arity, deps, build(...args), formulaText, explain, domain(testPoints), table4K?}`.
Built in this order (each uses only earlier entries):

| # | prim | recipe |
|---|------|--------|
| 1 | `1` | leaf |
| 2 | `exp(z)` | `eml(z, 1)` |
| 3 | `e` | `eml(1, 1)` |
| 4 | `ln(z)` | `eml(1, eml(eml(1, z), 1))` |
| 5 | `0` | `ln(1)` |
| 6 | `a − b` | `eml(ln a, exp b)` |
| 7 | `−z` | `0 − z` (uses ln 0 = −∞) |
| 8 | `a + b` | `a − (−b)` |
| 9 | `1/z` | `exp(−ln z)` |
| 10 | `a × b` | `exp(ln a + ln b)` |
| 11 | `a ÷ b` | `a × (1/b)` |
| 12 | `aᵇ` | `exp(b × ln a)` |
| 13 | integers n | `0`, `1` as above; `−1 = −(1)`; `2 = 1+1`; n>2 by binary method: `term=1`, `acc=none`; for each bit of n from low: if bit set `acc = acc ? acc+term : term`; then `term = 2 × term` (**multiply, not `term+term`** — addition computes exp(term) and overflows above ~709, which would cap integers at ~1419); negatives `−(n)` |
| 14 | rationals p/q | `p × (1/q)`, negated if p<0 (repo `eml_rational`) |
| 15 | `i` | per branch policy: `exp(ln(−1) ÷ 2)` (−0 variant) or `−exp(ln(−1) ÷ 2)` (+0 variant, repo) |
| 16 | `π` | per branch policy: `−i × ln(−1)` (−0 variant) or `i × ln(−1)` (+0 variant, repo) |
| 17 | `half(z)` | `z ÷ 2` |
| 18 | `sqr(z)` | `z × z` |
| 19 | `√z` | `z ^ (1/2)` |
| 20 | `log_b z` | `ln z ÷ ln b` |
| 21 | `sinh z` | `(exp(2z) − 1) ÷ (2 × exp z)` (repo template; 2z = z+z) |
| 22 | `cosh z` | `(exp(2z) + 1) ÷ (2 × exp z)` |
| 23 | `tanh z` | `(exp(2z) − 1) ÷ (exp(2z) + 1)` |
| 24 | `σ(z)` | `1 ÷ (1 + exp(−z))` |
| 25 | `sin z` | `(exp(i z) − exp(−i z)) ÷ (2 i)` |
| 26 | `cos z` | `(exp(i z) + exp(−i z)) ÷ 2` |
| 27 | `tan z` | `sin z ÷ cos z` |
| 28 | `arcsin z` | `−i × ln(i z + √(1 − z²))` |
| 29 | `arccos z` | `π/2 − arcsin z` |
| 30 | `arctan z` | `(−i ÷ 2) × ln(−((z − i) ÷ (z + i)))` (repo `eml_atan`) |
| 31 | `arsinh z` | `ln(z + √(z² + 1))` |
| 32 | `arcosh z` | `ln(z + √(z+1) × √(z−1))` |
| 33 | `artanh z` | `half(ln((1+z) ÷ (1−z)))` |
| 34 | `avg(a,b)` | `half(a + b)` |
| 35 | `hypot(a,b)` | `√(sqr a + sqr b)` |

Recipes for *composite* operations (6–35) are "level-1 recipes" shown in the dropdown; the pure-EML tree is their
full recursive substitution. Shared constants (i, π, 2, 1/2) are built once and reused (DAG sharing).

### Node test harness — `tests/run-tests.js` (gate for all later work)
- Evaluates the **fully expanded pure-eml DAG** with the same `complex.js` eml the UI uses (never Math.log/exp
  shortcuts) and compares to `Math.*` (or complex reference) at each primitive's domain points, e.g.
  `{−2.5, −1, −0.5, 0.3, 0.5, 1.7, 3}` filtered by domain (arcsin/artanh in (−1,1), arcosh > 1, ln/√ > 0 plus
  negative-input complex checks for ln). Tolerance `1e−9` relative.
- Branch checks: eml-ln(−1), eml-ln(−2), eml-ln(−0.5) give a consistent documented value; `i` ≈ +i; `π` ≈ 3.14159…+0i.
- Prints K for each primitive; asserts paper Table 4 values where our route equals theirs:
  `exp = 3`, `e = 3`, `ln = 7`, `0 = 7`, `x − y = 11` (direct-search column), `x + y = 27`, `x × y = 41`,
  `−1 = 17`, `2 = 27`; for the +0 (repo) variant also `i = 131`, `π = 193`. (Hand-derived by the reviewer —
  if a value differs, investigate before changing.)
- Overflow: `sub(1, 800)`, `800+800`, `-1000` must be flagged (note `500+500` does NOT overflow — it's 1000).
- Zero points: `0*5`, `sqrt(0)`, `sin(0)`, `tanh(0)` → pure tree gives ∞/NaN; limit evaluation (below) gives 0.
- Parser/compiler tests: precedence, unary minus, implicit mult, functions with 1–2 args, decimals → rationals,
  error messages.

## Numbers, overflow, and honesty in display
- **Literals:** integers via binary doubling; decimals → exact rational `p/10^k` reduced by gcd (`0.5 → 1/2`);
  cap at 6 significant digits / |n| ≤ 10⁶ — beyond that show "number too long to build in EML, round it?".
- **Zero points → limit (user decision).** EML formulas fail at isolated points, mostly 0 (ln 0 = −∞ poisons
  products: `0×5`, `sin(0)` → ∞). Literal leaves are compiled as tagged literal roots so eval can override them.
  If the pure-tree value is non-finite/NaN (or mismatches a finite reference), re-evaluate with every literal
  nudged to `v·(1±δ)` (or `±δ` when v = 0), `δ = 1e−9`, average the two sides, and accept if both sides agree
  within 1e−6. Display the limit with note: "EML can't reach this point exactly — this is the limit as you
  approach it." If the nudge still fails, show the failure badge. Resolve stepping uses the nudged literals in
  that case (shown in the note).
- **Every result shows two values:** the EML-tree value and a direct reference value (complex reference library
  on the same AST). Badge: `✓ matches standard math` / `⚠ overflow: this EML route computes e^(800), too big for a 64-bit
  float` / `≠ branch mismatch` with a one-line why. Never present a wrong number as correct in a live demo.
- Imag parts below display tolerance shown as real; genuine complex results displayed `a + bi`.

## UI design

### Global
- Header: title, **mode switch** (segmented toggle: "Two-button" | "Scientific"), **"What is EML?"** button.
- Large-type toggle for projector; layout single-column on phones, side-by-side panels ≥ 900px.
- Light/dark via tokens on `:root` + `prefers-color-scheme`.

### Two-button mode (RPN stack)
- Two big buttons **`1`** and **`EML`**; small utility row: undo, clear, (playback speed).
- `1` pushes 1; `EML` pops b then a, pushes eml(a, b). Show: tape (`11E1E…`, paper notation),
  stack with each value (complex as a+bi), the tree of the top-of-stack (reuses view-tree), and a
  **recognizer** label when the value matches a known constant ("= e!", "= 0", "= −1", "= 2", "= i", "= π", small
  integers, 1/2, ln 2).
- **Presets** dropdown (e, 0, −1, 2, 1/2, i, π…): plays the RPN keypresses as an animation (skip-to-end button,
  since π is long); shows K ("π takes N presses").
- Error state if EML pressed with < 2 items on stack (inline hint, no alert()).

### Scientific mode
- Input field + on-screen keypad (digits, `+ − × ÷ ^ ( )`, `π e i`, functions from Table 1, `log(b, z)`,
  `avg`, `hypot`), Evaluate.
- **Breakdown panel** ("how each element is built"): one card per distinct element in the expression
  (each number, operator, function, constant): its level-1 recipe, K size in pure EML, its value; click → highlights
  it in the tree view.
- **"How it's built" dropdown**: lists all 35 primitives in bootstrapping order; selecting one shows its recipe,
  which earlier primitives it depends on (chain), K, a short plain-language note, a small expandable tree, and
  "Try it" (inserts into input).
- **Expanded view** with toggle **Tree | Text**, sharing one fold state and one resolve state:
  - Starts *folded* at the expression's own structure (e.g. `+ ( sin(2), 3 )` as blobs). Click a blob to unfold
    it one level into its recipe; "unfold all to pure EML" allowed only if visible node count ≤ cap (~1500),
    otherwise message with the count ("sin alone is N nodes — unfold a smaller piece").
  - Header stats: total K of pure-EML form, depth, unique nodes in DAG.
  - **Resolve controls:** ◀ step back, ▶ step, ▶▶ play/pause, speed slider, reset. A step evaluates every visible
    position whose children are all values (the deepest frontier), turning it into a value chip; the tree visibly
    shrinks level by level until one number remains. A **folded blob** counts as one position: once all its args
    are values it resolves in one step using the DAG memo value. Step history = stack of resolved-position sets
    (step back pops). Folding/unfolding during a resolve resets the resolve. Text view shows the same frontier as a new line
    `= …` with the replaced parts highlighted; very long lines truncate in the middle `…(N symbols)…`.
  - Pan/zoom (wheel, drag, pinch) on the SVG; auto-fit button.

### "What is EML?" explainer (modal, both modes)
Short, plain-language, interactive: the formula; why the constant 1 (ln 1 = 0); live mini-derivations
`e = eml(1,1)`, `eˣ = eml(x,1)`, `ln x = eml(1, eml(eml(1,x),1))` with a slider for x; the NAND-gate analogy;
the grammar `S → 1 | eml(S,S)`; why complex numbers appear inside (i, π via ln(−1)); caveats (floating overflow,
branch cuts); citation + arXiv link 2603.21852.

## Implementation tasks (in order; each ends green)
0. `git init` in the project folder, `.gitignore`, commit the PDF + plan copy at
   `docs/superpowers/specs/2026-11-14-eml-calculator-design.md`.
1. `complex.js`, `eml-core.js`, `recipes.js` + `tests/run-tests.js` → harness passes for all 35 primitives,
   branch checks, Table-4 K cross-check, overflow flag. **No UI work until green.**
2. `parser.js`, `compiler.js` (literals, reference evaluator, recipe call tree for folding) + tests.
3. `index.html`, `style.css`, `app.js`: shell, mode switch, explainer modal.
4. `mode-two.js` + `view-tree.js` (basic render) — two-button mode with presets & recognizer.
5. `mode-sci.js`: keypad, evaluate, dual-value badge, breakdown panel, dropdown.
6. `resolve.js`, `view-text.js`, fold/unfold + stepping in tree view; Tree|Text toggle.
7. Polish: phone width (375px) and projector (large type) layouts, dark mode, performance on `sin(cos(2))+3`.

## Verification
- `node tests/run-tests.js` — all checks pass (primitive accuracy on pure-EML trees, branches, K values, parser,
  overflow flagging).
- Open `index.html` directly from disk (file://) in Chrome via claude-in-chrome; confirm no console errors; screenshot:
  - Two-button: press `1 1 EML` → shows e (2.71828…, "= e!"); load π preset → ≈3.14159, recognizer fires.
  - Scientific: `ln(2)`, `sin(2)+3`, `sqrt(2)*pi`, `2^10`, `arcsin(0.5)` match reference; `-1000` / `800+800`
    show the overflow badge, not a wrong number; `sin(0)`, `0*5` show 0 with the limit note; `ln(-2)` shows
    0.693 + 3.142i and `sqrt(-4)` shows 2i; dropdown shows each primitive; step-resolve reaches final value
    in both Tree and Text views.
  - Resize to 375px wide and to large-type mode; no horizontal scroll.
- After it works: ask the user where to publish (claude.ai Artifact link vs GitHub Pages).
