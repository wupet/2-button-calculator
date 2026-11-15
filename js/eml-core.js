(function (root) {
  const EML = (root.EML = root.EML || {});
  const C = EML.C;
  const ZERO = EML.ZERO;

  // ---- Hash-consed DAG ------------------------------------------------------
  const dag = (EML.dag = {});

  let nextId = 0;
  const ONE = { id: nextId++, kind: 'one' };
  const vars = new Map();
  const emls = new Map();

  dag.one = () => ONE;

  dag.variable = (name) => {
    let n = vars.get(name);
    if (!n) vars.set(name, (n = { id: nextId++, kind: 'var', name }));
    return n;
  };

  dag.eml = (a, b) => {
    const key = `eml:${a.id}:${b.id}`;
    let n = emls.get(key);
    if (!n) emls.set(key, (n = { id: nextId++, kind: 'eml', a, b }));
    return n;
  };

  // Literal nodes are never shared: each carries its own override slot.
  dag.literal = (inner, value) => ({ id: nextId++, kind: 'lit', inner, value });

  const children = (n) =>
    n.kind === 'eml' ? [n.a, n.b] : n.kind === 'lit' ? [n.inner] : [];

  // Iterative post-order fold over the DAG. `compute(node, childValues)` is
  // called once per distinct node; results are memoised in `memo` (by id).
  // `skip(node)` may return a value to use instead of visiting the children.
  const fold = (root, memo, compute, skip) => {
    const stack = [root];
    while (stack.length) {
      const n = stack[stack.length - 1];
      if (memo.has(n.id)) { stack.pop(); continue; }
      const pre = skip && skip(n);
      if (pre !== undefined) { memo.set(n.id, pre); stack.pop(); continue; }
      const kids = children(n);
      let pending = false;
      for (const k of kids) {
        if (!memo.has(k.id)) { stack.push(k); pending = true; }
      }
      if (pending) continue;
      stack.pop();
      memo.set(n.id, compute(n, kids.map((k) => memo.get(k.id))));
    }
    return memo.get(root.id);
  };

  dag.makeEvaluator = (env = {}) => {
    const varVals = env.vars || {};
    const overrides = env.overrides;
    const flags = env.flags || (env.flags = {});
    const memo = new Map();
    const skip = (n) => (n.kind === 'lit' && overrides && overrides.has(n.id) ? overrides.get(n.id) : undefined);
    const compute = (n, [a, b]) => {
      switch (n.kind) {
        case 'one': return C.cx(1, ZERO);
        case 'var': {
          if (!Object.prototype.hasOwnProperty.call(varVals, n.name)) {
            throw new Error(`Unbound variable: ${n.name}`);
          }
          return varVals[n.name];
        }
        case 'lit': return a;
        default: return C.eml(a, b, flags);
      }
    };
    const evaluate = (node) => fold(node, memo, compute, skip);
    evaluate.flags = flags;
    return evaluate;
  };

  dag.evaluate = (node, env = {}) => {
    const ev = dag.makeEvaluator(env);
    const value = ev(node);
    return { value, flags: ev.flags };
  };

  const kMemo = new Map();
  dag.K = (node) =>
    fold(node, kMemo, (n, [a, b]) =>
      n.kind === 'eml' ? 1 + a + b : n.kind === 'lit' ? a : 1);

  const hMemo = new Map();
  dag.height = (node) =>
    fold(node, hMemo, (n, [a, b]) =>
      n.kind === 'eml' ? 1 + Math.max(a, b) : n.kind === 'lit' ? a : 0);

  dag.uniqueCount = (node) => {
    const seen = new Set();
    const stack = [node];
    while (stack.length) {
      const n = stack.pop();
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      for (const k of children(n)) stack.push(k);
    }
    return seen.size;
  };

  // Postfix string of the full expansion: '1', variable names, 'E' for eml.
  dag.rpn = (node, cap = 5000) => {
    if (dag.K(node) > cap) return null;
    const out = [];
    const stack = [node];
    while (stack.length) {
      const n = stack.pop();
      if (typeof n === 'string') { out.push(n); continue; }
      if (n.kind === 'one') out.push('1');
      else if (n.kind === 'var') out.push(n.name);
      else if (n.kind === 'lit') stack.push(n.inner);
      else stack.push('E', n.b, n.a); // pops a, b, then 'E'
    }
    return out.join('');
  };

  // ---- Recipe call tree recorder -------------------------------------------
  // CallNode = { prim, args: CallNode[], body: CallNode|null, root: Node, label }
  const calls = (EML.calls = {});

  calls.one = () => ({ prim: '1', args: [], body: null, root: dag.one(), label: '1' });

  calls.variable = (name) => ({ prim: 'var', args: [], body: null, root: dag.variable(name), label: name });

  calls.eml = (a, b) => ({ prim: 'eml', args: [a, b], body: null, root: dag.eml(a.root, b.root), label: 'eml' });

  const zeroArity = new Map();
  calls.invoke = (primId, args, label) => {
    const memoKey = args.length === 0 ? `${primId}|${label ?? ''}` : null;
    if (memoKey !== null && zeroArity.has(memoKey)) return zeroArity.get(memoKey);
    // Looked up lazily: recipes.js loads after this file.
    const recipe = EML.recipeById && EML.recipeById[primId];
    if (!recipe) throw new Error(`Unknown recipe: ${primId}`);
    const body = recipe.build(EML.R, ...args);
    const node = { prim: primId, args, body, root: body.root, label: label ?? recipe.symbol };
    if (memoKey !== null) zeroArity.set(memoKey, node);
    return node;
  };

  calls.literal = (value, text, body) => ({
    prim: 'lit', args: [], body, root: dag.literal(body.root, value), label: text, value,
  });

  // ---- Recorder façade used by recipe builders -----------------------------
  // A plain object: recipes.js adds per-recipe shortcuts onto it.
  EML.R = {
    one: () => calls.one(),
    eml: (a, b) => calls.eml(a, b),
    call: (id, ...args) => calls.invoke(id, args),
  };
})(typeof window !== 'undefined' ? window : globalThis);
