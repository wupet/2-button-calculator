# EML calculator

A small web page that demonstrates a result from the paper *All elementary
functions from a single operator*: one binary operator,

    eml(x, y) = e^x − ln y

together with the constant `1` is enough to rebuild every button on a
scientific calculator (addition, multiplication, powers, trig, π, i, and so
on). This page lets you press those buttons and then look inside to see the
tree of `eml` operations that actually computes the answer. Nothing is
installed and nothing leaves your browser: it is plain HTML, CSS and
JavaScript with no dependencies and no network requests.

## The two modes and the explainer

- **Two-button mode.** A calculator with only two keys, `1` and `EML`. Press
  `1 1 EML` and you get e. Pick a constant such as π from the preset list to
  watch it being built key by key. The tree of the value on top of the stack
  is drawn next to the keypad.
- **Scientific mode.** Type or tap an ordinary expression such as
  `sin(2) + 3`, `sqrt(2) * pi` or `ln(-2)`. The page builds it out of `eml`
  and `1` only, compares the result with standard math, and shows how many
  `eml` operators it took. Every function and number you used gets a card
  explaining how it is built; the expanded view lets you unfold the tree one
  level at a time and step through the evaluation in either a Tree or a Text
  view.
- **"What is EML?"** An explainer dialog with the idea in plain language and
  small live demos.
- **Large type.** A switch that makes everything bigger for projectors.

## Opening it

- Double-click `index.html` (it works straight from disk), or
- serve the folder and visit it in a browser:

      python -m http.server
      # then open http://localhost:8000

## Running the tests

Tested with Node.js 22; no packages to install:

    node --test

## Known limitations

- **Only checked digits are shown.** Every result is computed twice: by the
  `eml` tree and by ordinary (principal-branch) math. The page shows the
  standard value rounded to the digits on which the two agree (at most 10), so
  float noise such as `sin(pi)` = 1.2e-16 shows as 0.
- **Overflow above e^709.** Everything is done in 64-bit floating point. Some
  `eml` routes pass through an `e^(...)` that is too large for a double even
  when the final answer is modest (for example `-1000` or `800 + 800`); the
  page then shows an overflow badge and leads with the standard-math answer,
  with the tree's own value in small print. When standard math also leaves the
  64-bit range (for example `e^1000` or `ln(exp(1000))`), the page says so and
  shows no number. True singularities such as `1/0` or `ln(0)` are marked
  undefined.
- **Isolated points are shown as limits.** `eml` cannot reach a few points
  exactly (for example `sin(0)` or `0 * 5`). The page evaluates them by
  nudging the inputs a tiny amount and labels the result as a limit.
- **Branch cuts.** Complex logarithms and inverse functions use the principal
  branch, but the `eml` route can land on the other side of a cut. Where the
  tree and standard math disagree (for example `arccos(2)`), the page says so
  and shows both.
- **Literals are limited to 6 significant digits** (and a magnitude of at most
  1,000,000), because each digit costs a lot of `eml` operators.
- **No scientific notation.** Write `100000`, not `1e5`. Numbers are written
  without spaces or a decimal comma: `1000` and `2.5`, not `1 000` or `2,5`.
- **Radians only.** There is no degree mode.
- The visible tree is capped at 1500 positions; very large builds are shown
  folded and can be unfolded part by part.

## Reference

Andrzej Odrzywołek, *All elementary functions from a single operator*,
arXiv:2603.21852. <https://arxiv.org/abs/2603.21852>
