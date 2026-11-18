// Deterministic elementary functions built only from IEEE-754 +, -, *, / (and Math.floor/abs, which
// are exact). JS engines are free to implement Math.sin/cos/exp/atan2 differently (we measured
// 1-ulp differences between Node 26 and Chrome 156), so simulation cores that must produce
// bit-identical state in the browser preview and the offline renderer use these instead.
// Accuracy: ~1-2 ulp on the ranges used by simulations (|x| < 1e6). Not a general libm.

const PIO2_1 = 1.5707963267341256;      // first 33 bits of pi/2
const PIO2_1T = 6.077100506506192e-11;  // pi/2 - PIO2_1
const INV_PIO2 = 0.6366197723675814;

function kernelSin(x) { // |x| <= pi/4
  const z = x * x;
  return x + x * z * (-1.6666666666666632e-1 + z * (8.33333333332249e-3 + z * (-1.984126982985795e-4
    + z * (2.7557313707070068e-6 + z * (-2.5050760253406863e-8 + z * 1.58969099521155e-10)))));
}
function kernelCos(x) { // |x| <= pi/4
  const z = x * x;
  const r = z * (4.16666666666666e-2 + z * (-1.388888888887411e-3 + z * (2.480158728947673e-5
    + z * (-2.7557314351390663e-7 + z * (2.087572321298175e-9 + z * -1.1359647557788195e-11)))));
  const hz = 0.5 * z, w = 1 - hz;
  return w + (((1 - w) - hz) + z * r);
}
function reduce(x) {
  const n = Math.floor(x * INV_PIO2 + 0.5);
  const r = (x - n * PIO2_1) - n * PIO2_1T;
  return [r, ((n % 4) + 4) % 4];
}
export function dsin(x) {
  const [r, q] = reduce(x);
  return q === 0 ? kernelSin(r) : q === 1 ? kernelCos(r) : q === 2 ? -kernelSin(r) : -kernelCos(r);
}
export function dcos(x) {
  const [r, q] = reduce(x);
  return q === 0 ? kernelCos(r) : q === 1 ? -kernelSin(r) : q === 2 ? -kernelCos(r) : kernelSin(r);
}
const LN2_HI = 6.93147180369123816490e-1, LN2_LO = 1.90821492927058770002e-10, INV_LN2 = 1.44269504088896338700;
export function dexp(x) {
  if (x > 709) return Infinity; if (x < -745) return 0;
  const k = Math.floor(x * INV_LN2 + 0.5);
  const hi = x - k * LN2_HI, lo = k * LN2_LO, r = hi - lo;
  const t = r * r;
  const c = r - t * (1.66666666666666019037e-1 + t * (-2.77777777770155933842e-3 + t * (6.61375632143793436117e-5
    + t * (-1.65339022054652515390e-6 + t * 4.13813679705723846039e-8))));
  const y = 1 - ((lo - (r * c) / (2 - c)) - hi);
  // scale by 2^k exactly
  let s = y, kk = k;
  while (kk > 0) { const step = Math.min(kk, 1000); s *= 2 ** step; kk -= step; }
  while (kk < 0) { const step = Math.max(kk, -1000); s *= 2 ** step; kk -= step; }
  return s;
}
/** asin on [-1, 1) via Newton on dsin (deterministic, used in setup code). */
export function dasin(v) {
  let t = v + (v * v * v) / 6;
  for (let i = 0; i < 60; i++) { const d = (dsin(t) - v) / dcos(t); t -= d; if (Math.abs(d) < 1e-17) break; }
  return t;
}
