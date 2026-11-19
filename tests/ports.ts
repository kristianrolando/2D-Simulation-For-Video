// Ports a test studio must not use: fetch() refuses them on purpose ("bad port": the IRC and X11 ports …) and macOS itself answers on 5000 and 7000
// (AirPlay), so a studio there looks as if it never started. Only the ones inside the ranges the tests pick from are listed.
export const BAD_PORTS = new Set([5000, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 7000]);
/** the first port at or above `p` that a test may use (the studio's own HMR port, p + 1, is not fetched, so it needs no check) */
export const usablePort = (p: number) => { while (BAD_PORTS.has(p)) p++; return p; };
