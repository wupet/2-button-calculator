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

let loaded = false;

module.exports = function load() {
  if (!loaded) {
    const dir = path.join(__dirname, '..', 'js');
    for (const name of ORDER) {
      if (UI.has(name)) continue;
      const filename = path.join(dir, name + '.js');
      if (!fs.existsSync(filename)) continue;
      vm.runInThisContext(fs.readFileSync(filename, 'utf8'), { filename });
    }
    loaded = true;
  }
  return globalThis.EML;
};
