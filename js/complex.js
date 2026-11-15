(function (root) {
  const EML = (root.EML = root.EML || {});

  // Zero-sign policy: the "zero" written by snap and used as the default
  // imaginary part is -0 (see Global Constraints).
  const ZERO = -0;
  EML.ZERO = ZERO;

  const C = (EML.C = {});

  const cx = (re, im = ZERO) => ({ re, im });
  C.cx = cx;

  C.add = (a, b) => cx(a.re + b.re, a.im + b.im);
  C.sub = (a, b) => cx(a.re - b.re, a.im - b.im);
  C.mul = (a, b) => cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
  C.div = (a, b) => {
    const d = b.re * b.re + b.im * b.im;
    return cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
  };
  C.neg = (a) => cx(-a.re, -a.im);
  C.abs = (a) => Math.hypot(a.re, a.im);

  C.isFinite = (z) => Number.isFinite(z.re) && Number.isFinite(z.im);

  C.exp = (z, flags) => {
    if (z.re === -Infinity) return cx(0, ZERO);
    if (z.re === Infinity) return cx(Infinity, ZERO);
    let out;
    if (z.im === 0) {
      out = cx(Math.exp(z.re), z.im);
    } else {
      const m = Math.exp(z.re);
      out = cx(m * Math.cos(z.im), m * Math.sin(z.im));
    }
    if (flags && C.isFinite(z)) {
      if (!C.isFinite(out)) flags.overflow = true;
      else if (out.re === 0 && out.im === 0) flags.underflow = true;
    }
    return out;
  };

  C.log = (z) => {
    if (z.re === 0 && z.im === 0) return cx(-Infinity, ZERO);
    return cx(Math.log(Math.hypot(z.re, z.im)), Math.atan2(z.im, z.re));
  };

  // Principal square root (not part of EML itself; used by the reference set).
  C.sqrt = (z) => {
    if (z.re === 0 && z.im === 0) return cx(0, ZERO);
    const r = Math.hypot(z.re, z.im);
    const t = Math.sqrt((Math.abs(z.re) + r) / 2);
    const negIm = z.im < 0 || Object.is(z.im, -0);
    if (z.re >= 0) return cx(t, z.im / (2 * t));
    return cx(Math.abs(z.im) / (2 * t), negIm ? -t : t);
  };

  // Relative-only snap: a part becomes ZERO when it is exactly 0 or
  // negligible relative to the other part. No absolute floor.
  C.snap = (z) => {
    const { re, im } = z;
    const tiny = (p, q) =>
      p === 0 || (Number.isFinite(p) && Math.abs(p) <= 1e-12 * Math.abs(q));
    return cx(tiny(re, im) ? ZERO : re, tiny(im, re) ? ZERO : im);
  };

  C.eml = (a, b, flags) => C.snap(C.sub(C.exp(a, flags), C.log(b)));

  C.approxEq = (a, b, rel = 1e-9, abs = 1e-12) => {
    if (a.re === b.re && a.im === b.im) return true;
    if (!C.isFinite(a) || !C.isFinite(b)) return false; // non-finite: identical only
    return C.abs(C.sub(a, b)) <= abs + rel * Math.max(C.abs(a), C.abs(b));
  };

  const MINUS = '\u2212';
  const num = (x, digits) => {
    let s = x.toPrecision(digits);
    const e = s.indexOf('e');
    let mant = e < 0 ? s : s.slice(0, e);
    const exp = e < 0 ? '' : s.slice(e);
    if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
    return mant + exp;
  };

  C.format = (z, digits = 10) => {
    const { re, im } = z;
    if (Number.isNaN(re) || Number.isNaN(im)) return 'undefined';
    if (!Number.isFinite(re) || !Number.isFinite(im)) {
      return re === -Infinity ? MINUS + '\u221e' : '\u221e';
    }
    const imagPart = (v) => {
      const s = num(Math.abs(v), digits);
      return (s === '1' ? '' : s) + 'i';
    };
    const sign = (v) => (v < 0 ? MINUS : '');
    if (Math.abs(im) <= 1e-10 * Math.max(1, Math.abs(re))) {
      return sign(re) + num(Math.abs(re), digits);
    }
    if (Math.abs(re) <= 1e-10 * Math.max(1, Math.abs(im))) {
      return sign(im) + imagPart(im);
    }
    return sign(re) + num(Math.abs(re), digits) +
      (im < 0 ? ' ' + MINUS + ' ' : ' + ') + imagPart(im);
  };

  // ---- Principal-branch reference functions -------------------------------
  const norm = (z) => cx(z.re === 0 ? 0 : z.re, z.im === 0 ? 0 : z.im); // -0 -> +0
  const isReal = (z) => z.im === 0;
  const I = cx(0, 1);
  const ONE = cx(1, 0);
  const HALF_PI = Math.PI / 2;
  const scale = (z, k) => cx(z.re * k, z.im * k);

  const sqr = (z) => C.mul(z, z);
  // On the real axis beyond +-1 the textbook formula picks the wrong side of
  // the cut; with a +0 imaginary part the principal value has Im = +acosh|x|.
  const asinC = (z) => isReal(z) && Math.abs(z.re) > 1
    ? cx(Math.sign(z.re) * HALF_PI, Math.acosh(Math.abs(z.re)))
    : C.mul(cx(0, -1), C.log(C.add(C.mul(I, z), C.sqrt(C.sub(ONE, sqr(z))))));

  const R = {
    exp: (z) => (isReal(z) ? cx(Math.exp(z.re), 0) : C.exp(z)),
    ln: (z) => (isReal(z) && z.re > 0 ? cx(Math.log(z.re), 0) : C.log(z)),
    sqrt: (z) => (isReal(z) && z.re >= 0 ? cx(Math.sqrt(z.re), 0) : C.sqrt(z)),
    sin: (z) => isReal(z) ? cx(Math.sin(z.re), 0)
      : cx(Math.sin(z.re) * Math.cosh(z.im), Math.cos(z.re) * Math.sinh(z.im)),
    cos: (z) => isReal(z) ? cx(Math.cos(z.re), 0)
      : cx(Math.cos(z.re) * Math.cosh(z.im), -Math.sin(z.re) * Math.sinh(z.im)),
    sinh: (z) => isReal(z) ? cx(Math.sinh(z.re), 0)
      : cx(Math.sinh(z.re) * Math.cos(z.im), Math.cosh(z.re) * Math.sin(z.im)),
    cosh: (z) => isReal(z) ? cx(Math.cosh(z.re), 0)
      : cx(Math.cosh(z.re) * Math.cos(z.im), Math.sinh(z.re) * Math.sin(z.im)),
    asin: (z) => (isReal(z) && Math.abs(z.re) <= 1 ? cx(Math.asin(z.re), 0) : asinC(z)),
    atan: (z) => isReal(z) ? cx(Math.atan(z.re), 0)
      // imaginary-axis cut: with a +0 real part the principal Re is +pi/2
      : z.re === 0 && Math.abs(z.im) > 1
        ? cx(HALF_PI, Math.sign(z.im) * 0.5 * Math.log((Math.abs(z.im) + 1) / (Math.abs(z.im) - 1)))
      : C.mul(cx(0, 0.5), C.log(C.div(C.add(I, z), C.sub(I, z)))),
    asinh: (z) => isReal(z) ? cx(Math.asinh(z.re), 0)
      : C.log(C.add(z, C.sqrt(C.add(sqr(z), ONE)))),
    acosh: (z) => isReal(z) && z.re >= 1 ? cx(Math.acosh(z.re), 0)
      : C.log(C.add(z, C.mul(C.sqrt(C.add(z, ONE)), C.sqrt(C.sub(z, ONE))))),
    atanh: (z) => isReal(z) && Math.abs(z.re) < 1 ? cx(Math.atanh(z.re), 0)
      : isReal(z) && Math.abs(z.re) > 1
        ? cx(0.5 * Math.log(Math.abs((1 + z.re) / (1 - z.re))), HALF_PI)
      : scale(C.log(C.div(C.add(ONE, z), C.sub(ONE, z))), 0.5),
  };
  R.tan = (z) => (isReal(z) ? cx(Math.tan(z.re), 0) : C.div(R.sin(z), R.cos(z)));
  R.tanh = (z) => (isReal(z) ? cx(Math.tanh(z.re), 0) : C.div(R.sinh(z), R.cosh(z)));
  R.acos = (z) => isReal(z) && Math.abs(z.re) <= 1
    ? cx(Math.acos(z.re), 0)
    : C.sub(cx(HALF_PI, 0), asinC(z));
  R.sigmoid = (z) => isReal(z)
    ? cx(1 / (1 + Math.exp(-z.re)), 0)
    : C.div(ONE, C.add(ONE, C.exp(C.neg(z))));
  R.pow = (a, b) => {
    if (isReal(a) && isReal(b)) {
      if (a.re > 0 || Number.isInteger(b.re)) return cx(Math.pow(a.re, b.re), 0);
    }
    if (a.re === 0 && a.im === 0) {
      if (b.re === 0 && b.im === 0) return cx(1, 0);
      return b.re > 0 ? cx(0, 0) : cx(NaN, NaN);
    }
    return C.exp(C.mul(b, C.log(a)));
  };
  R.logb = (b, z) => C.div(R.ln(z), R.ln(b));
  R.avg = (a, b) => scale(C.add(a, b), 0.5);
  R.hypot = (a, b) => isReal(a) && isReal(b)
    ? cx(Math.hypot(a.re, b.re), 0)
    : R.sqrt(C.add(sqr(a), sqr(b)));
  R.half = (z) => scale(z, 0.5);
  R.sqr = (z) => sqr(z);
  R.inv = (z) => C.div(ONE, z);

  C.ref = {};
  for (const name of Object.keys(R)) {
    const f = R[name];
    C.ref[name] = (...args) => f(...args.map(norm));
  }
})(typeof window !== 'undefined' ? window : globalThis);
