import calibration from "./liquid-calibration.json";
export function fillHeight(fraction: number) {
  const f = Math.max(0, Math.min(1, fraction));
  const c = calibration.cdf;
  for (let i = 1; i < c.length; i++)
    if (f <= c[i])
      return (i - 1 + (f - c[i - 1]) / (c[i] - c[i - 1])) / (c.length - 1);
  return 1;
}
