// Deterministic elementary functions built only from IEEE-754 +, -, *, / (and Math.floor/abs, which
// are exact). JS engines are free to implement Math.sin/cos/exp/atan2 differently (we measured
// 1-ulp differences between Node 26 and Chrome 156), so simulation cores that must produce
// bit-identical state in the browser preview and the offline renderer use these instead.
// Accuracy: ~1-2 ulp on the ranges used by simulations (|x| < 1e6). Not a general libm.

const PIO2_1 = 1.5707963267341256;      // first 33 bits of pi/2
const PIO2_1T = 6.077100506506192e-11;  // pi/2 - PIO2_1
const INV_PIO2 = 0.6366197723675814;

function kernelSin(x: number): number { // |x| <= pi/4
  const z = x * x;
  return x + x * z * (-1.6666666666666632e-1 + z * (8.33333333332249e-3 + z * (-1.984126982985795e-4
    + z * (2.7557313707070068e-6 + z * (-2.5050760253406863e-8 + z * 1.58969099521155e-10)))));
}
function kernelCos(x: number): number { // |x| <= pi/4
  const z = x * x;
  const r = z * (4.16666666666666e-2 + z * (-1.388888888887411e-3 + z * (2.480158728947673e-5
    + z * (-2.7557314351390663e-7 + z * (2.087572321298175e-9 + z * -1.1359647557788195e-11)))));
  const hz = 0.5 * z, w = 1 - hz;
  return w + (((1 - w) - hz) + z * r);
}
function reduce(x: number): [number, number] {
  const n = Math.floor(x * INV_PIO2 + 0.5);
  const r = (x - n * PIO2_1) - n * PIO2_1T;
  return [r, ((n % 4) + 4) % 4];
}
export function dsin(x: number): number {
  const [r, q] = reduce(x);
  return q === 0 ? kernelSin(r) : q === 1 ? kernelCos(r) : q === 2 ? -kernelSin(r) : -kernelCos(r);
}
export function dcos(x: number): number {
  const [r, q] = reduce(x);
  return q === 0 ? kernelCos(r) : q === 1 ? -kernelSin(r) : q === 2 ? -kernelCos(r) : kernelSin(r);
}
const LN2_HI = 6.93147180369123816490e-1, LN2_LO = 1.90821492927058770002e-10, INV_LN2 = 1.44269504088896338700;
export function dexp(x: number): number {
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
export function dasin(v: number): number {
  let t = v + (v * v * v) / 6;
  for (let i = 0; i < 60; i++) { const d = (dsin(t) - v) / dcos(t); t -= d; if (Math.abs(d) < 1e-17) break; }
  return t;
}

const ATANHI = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00];
const ATANLO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT = [3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01, -1.11111104054623557880e-01,
  9.09088713343650656196e-02, -7.69187620504482999495e-02, 6.66107313738753120669e-02, -5.83357013379057348645e-02,
  4.97687799461593236017e-02, -3.65315727442169155270e-02, 1.62858201153657823623e-02];
/** atan, fdlibm algorithm (deterministic: only + - * /). */
export function datan(x: number): number {
  const neg = x < 0; let a = neg ? -x : x;
  if (a > 1e17) return neg ? -ATANHI[3] : ATANHI[3];
  let id = -1;
  if (a >= 0.4375) {
    if (a < 0.6875) { id = 0; a = (2 * a - 1) / (2 + a); }
    else if (a < 1.1875) { id = 1; a = (a - 1) / (a + 1); }
    else if (a < 2.4375) { id = 2; a = (a - 1.5) / (1 + 1.5 * a); }
    else { id = 3; a = -1 / a; }
  }
  const z = a * a, w = z * z;
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  if (id < 0) return neg ? -(a - a * (s1 + s2)) : a - a * (s1 + s2);
  const r = ATANHI[id] - ((a * (s1 + s2) - ATANLO[id]) - a);
  return neg ? -r : r;
}
export function datan2(y: number, x: number): number {
  if (x > 0) return datan(y / x);
  if (x < 0) return y >= 0 ? datan(y / x) + Math.PI : datan(y / x) - Math.PI;
  return y > 0 ? Math.PI / 2 : y < 0 ? -Math.PI / 2 : 0;
}
/** natural log via Newton on dexp (deterministic; for setup code, not hot loops). */
export function dlog(x: number): number {
  if (!(x > 0)) return x === 0 ? -Infinity : NaN;
  let e = 0; while (x > 2) { x /= 2; e++; } while (x < 0.5) { x *= 2; e--; }
  let y = x - 1;
  for (let i = 0; i < 40; i++) { const ey = dexp(y); const d = (ey - x) / ey; y -= d; if (Math.abs(d) < 1e-17) break; }
  return y + e * 0.6931471805599453;
}
export function dpow(b: number, p: number): number { return p === 0 ? 1 : b === 0 ? 0 : dexp(p * dlog(b)); }
