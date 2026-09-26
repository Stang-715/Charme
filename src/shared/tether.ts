/** Initial link endpoints. Optional outer chains leave the hoop sideways before hanging. */
export function tetherPoints(
  id: string,
  count: number,
  start: [number, number, number],
): [number, number, number][] {
  const points: [number, number, number][] = [start];
  for (let i = 0; i < count; i++) {
    const p = points[points.length - 1],
      outer = id === "extra0" || id === "extra1";
    points.push([
      p[0] + (outer && i < 5 ? (id === "extra0" ? -0.024 : 0.024) : 0),
      p[1] - (outer && i < 5 ? 0.018 : 0.03),
      p[2],
    ]);
  }
  return points;
}
export const hoopCollisionGroups = 0x8000007f;
export function charmCollisionGroups(index: number) {
  const own = 1 << index;
  return (own << 16) | 0x8000 | 0x7f | ((0x7f ^ own) << 8);
}
export function linkCollisionGroups(index: number) {
  const own = 1 << index;
  return ((own << 8) << 16) | (0x7f ^ own);
}

export type Point3 = [number, number, number];
/** Tether starts on the actual hoop rim, including when the hoop is resized. */
export function rimAnchor(point: Point3, scale: number): Point3 {
  const dx = point[0],
    dy = point[1] - 0.4;
  const radius = 0.19 * scale,
    length = Math.hypot(dx, dy) || 1;
  return [(dx / length) * radius, 0.4 + (dy / length) * radius, 0];
}
/** Connected display path with exact endpoints and no span exceeding a link pitch.
 * Only transforms the generated link instances; it never creates visible geometry.
 */
export function connectedTether(
  start: Point3,
  end: Point3,
  count: number,
  pitch = 0.03,
): Point3[] {
  if (count < 1) return [start, end];
  const delta = end.map((v, i) => v - start[i]) as Point3;
  const length = Math.hypot(...delta);
  if (length > count * pitch + 1e-6)
    throw Error("Tether endpoint exceeds chain reach");
  let bend: Point3 = [-delta[1], delta[0], 0];
  let norm = Math.hypot(...bend);
  if (norm < 1e-8) {
    bend = [1, 0, 0];
    norm = 1;
  }
  bend = bend.map((v) => v / norm) as Point3;
  const path = (amplitude: number): Point3[] =>
    Array.from({ length: count + 1 }, (_, i) => {
      if (i === 0) return [...start];
      if (i === count) return [...end];
      const t = i / count;
      return start.map(
        (v, j) =>
          v + delta[j] * t + bend[j] * amplitude * Math.sin(Math.PI * t),
      ) as Point3;
    });
  let lo = 0,
    hi = (count * pitch) / Math.PI;
  for (let iteration = 0; iteration < 24; iteration++) {
    const mid = (lo + hi) / 2,
      points = path(mid);
    const longest = Math.max(
      ...points
        .slice(1)
        .map((p, i) => Math.hypot(...p.map((v, j) => v - points[i][j]))),
    );
    if (longest > pitch) hi = mid;
    else lo = mid;
  }
  return path(lo);
}
