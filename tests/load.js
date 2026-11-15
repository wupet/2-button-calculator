const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Must match the script order in index.html (Global Constraints).
const ORDER = [
  'complex', 'eml-core', 'recipes', 'parser', 'compiler', 'view-model',
  'resolve', 'rpn', 'view-tree', 'view-text', 'explainer', 'mode-two',
  'mode-sci', 'app',
];
const UI = new Set(['view-tree', 'view-text', 'explainer', 'mode-two', 'mode-sci', 'app']);

const done = { core: false, ui: false };

function run(names) {
  const dir = path.join(__dirname, '..', 'js');
  for (const name of names) {
    const filename = path.join(dir, name + '.js');
    if (!fs.existsSync(filename)) continue;
    vm.runInThisContext(fs.readFileSync(filename, 'utf8'), { filename });
  }
}

// load() loads the logic modules only (default). load({ ui: true }) also loads
// the UI scripts in page order; they define their pure functions without a
// `document` and skip all DOM work.
module.exports = function load(opts = {}) {
  if (!done.core) {
    run(ORDER.filter((n) => !UI.has(n)));
    done.core = true;
  }
  if (opts.ui && !done.ui) {
    run(ORDER.filter((n) => UI.has(n)));
    done.ui = true;
  }
  return globalThis.EML;
};
