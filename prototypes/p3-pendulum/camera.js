// Pinhole camera looking down at pitch `alpha`; world: x = swing axis, y = up, z = along the rail.
export function makeCamera({ alpha, Cy, Cz, F, cx = 540, cy = 960 }) {
  const fy = -Math.sin(alpha), fz = Math.cos(alpha);   // forward
  const uy = Math.cos(alpha), uz = Math.sin(alpha);    // up
  return (x, y, z) => {
    const dy = y - Cy, dz = z - Cz;
    const depth = dy * fy + dz * fz;
    const s = F / depth;
    return [cx + x * s, cy - (dy * uy + dz * uz) * s, s];
  };
}
