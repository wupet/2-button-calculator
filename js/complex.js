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
  // Smith's algorithm: never forms |b|^2, so it neither overflows for |b| > 1e154
  // nor underflows for |b| < 1e-154. A real divisor takes a plain fast path
  // (with a +0 imaginary part when the dividend is real).
  C.div = (a, b) => {
    if (b.re === 0 && b.im === 0) {
      if (a.re === 0 && a.im === 0) return cx(NaN, NaN); // 0/0
      // nonzero / 0: infinite (a pole); keep each part's own direction.
      return cx(a.re === 0 ? 0 : a.re / 0, a.im === 0 ? 0 : a.im / 0);
    }
    if (b.im === 0) return cx(a.re / b.re, a.im === 0 ? 0 : a.im / b.re);
    if (Math.abs(b.re) >= Math.abs(b.im)) {
      const r = b.im / b.re;
      const den = b.re + b.im * r;
      return cx((a.re + a.im * r) / den, (a.im - a.re * r) / den);
    }
    const r = b.re / b.im;
    const den = b.re * r + b.im;
    return cx((a.re * r + a.im) / den, (a.im * r - a.re) / den);
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

  // ---- Showing only verified digits ------------------------------------------
  // raw = what the EML tree gave, ref = the independent standard-math value.
  // The digits shown are the reference's, rounded to as many significant digits
  // as the two agree on: d = floor(-log10(|raw - ref| / |ref|)), at most 10.
  // Each part is rounded at the same absolute resolution, so a part that is only
  // noise vanishes. When ref is exactly 0, or when not even the leading digit is
  // confirmed and |ref| is below the 'ok' check's absolute floor (1e-12, e.g.
  // sin(pi) = 1.2e-16 vs 6.1e-17), the value shows as 0. Otherwise at least one
  // digit is kept. Returns null when either side is not finite (nothing verified).
  const NOISE = 1e-12;
  const MAX_SHOWN = 10;
  // x rounded to a multiple of 10^q, built from decimal text so it is exact.
  const roundAt = (x, q) => {
    if (x === 0) return 0;
    const [m, e] = x.toExponential(16).split('e');
    const n = Math.round(Number(m + 'e' + (Number(e) - q)));
    if (n === 0) return 0;
    const v = Number(n + 'e' + q);
    // Cap each part at MAX_SHOWN significant digits.
    return Number(v.toPrecision(Math.min(MAX_SHOWN, Math.max(1, String(Math.abs(n)).length))));
  };
  C.verify = (raw, ref) => {
    if (!raw || !ref || !C.isFinite(raw) || !C.isFinite(ref)) return null;
    if (ref.re === 0 && ref.im === 0) return { value: cx(0, 0), digits: 0 };
    const mag = C.abs(ref);
    const err = C.abs(C.sub(raw, ref));
    let d = err === 0 ? 17 : Math.floor(-Math.log10(err / mag));
    if (d < 1) {
      if (mag < NOISE) return { value: cx(0, 0), digits: 0 };
      d = 1;
    }
    d = Math.min(d, 17);
    const q = Math.floor(Math.log10(mag)) - d + 1; // place of the last verified digit
    return { value: cx(roundAt(ref.re, q), roundAt(ref.im, q)), digits: Math.min(d, MAX_SHOWN) };
  };
  // The one formatter for every value the page presents as checked.
  C.formatVerified = (raw, ref) => {
    const v = C.verify(raw, ref);
    return v ? C.format(v.value, MAX_SHOWN) : '—';
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
  // tanh(x+iy) = (sinh x cosh x + i sin y cos y) / (sinh^2 x + cos^2 y): no
  // cancellation near the poles, and for |x| > 20 the exact float limit
  // sign(x) + 4 sin y cos y e^(-2|x|) i, so a large x never gives inf/inf.
  const tanhC = (z) => {
    const x = z.re;
    const y = z.im;
    if (Math.abs(x) > 20) return cx(Math.sign(x), 4 * Math.sin(y) * Math.cos(y) * Math.exp(-2 * Math.abs(x)));
    const sh = Math.sinh(x);
    const cy = Math.cos(y);
    const d = sh * sh + cy * cy;
    return cx(sh * Math.cosh(x) / d, Math.sin(y) * cy / d);
  };
  // tan z = -i tanh(iz)
  const tanC = (z) => {
    const t = tanhC(cx(-z.im, z.re));
    return cx(t.im, -t.re);
  };
  R.tan = (z) => (isReal(z) ? cx(Math.tan(z.re), 0) : tanC(z));
  R.tanh = (z) => (isReal(z) ? cx(Math.tanh(z.re), 0) : tanhC(z));
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
