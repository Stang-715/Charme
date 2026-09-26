import * as T from "three";
/** Dynamic interface lettering on the existing generated tag; no replacement charm mesh. */
export function tagLettering(
  name: string,
  style: "metal" | "neon",
  color: string,
) {
  const canvas =
    typeof document === "undefined"
      ? new OffscreenCanvas(1024, 512)
      : document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext("2d") as
    CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  const chars = [
    ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(name),
  ].map((s) => s.segment);
  const lines =
    chars.length > 12
      ? [
          chars.slice(0, Math.ceil(chars.length / 2)).join(""),
          chars.slice(Math.ceil(chars.length / 2)).join(""),
        ]
      : [name];
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let font = 150;
  do {
    ctx.font = `800 ${font}px sans-serif`;
    if (lines.every((line) => ctx.measureText(line).width <= 890)) break;
    font -= 2;
  } while (font > 30);
  const gradient = ctx.createLinearGradient(0, 120, 0, 380);
  gradient.addColorStop(0, "#ffffff");
  gradient.addColorStop(0.42, "#c4d5dc");
  gradient.addColorStop(0.5, "#4c646f");
  gradient.addColorStop(0.7, "#ffffff");
  gradient.addColorStop(1, "#7d9ca7");
  ctx.lineWidth = 7;
  ctx.strokeStyle = "#09242c";
  if (style === "neon") {
    ctx.shadowColor = color;
    ctx.shadowBlur = 28;
  }
  ctx.fillStyle = style === "neon" ? color : gradient;
  lines.forEach((line, i) => {
    const y = 256 + (i - (lines.length - 1) / 2) * 172;
    ctx.strokeText(line, 512, y);
    ctx.fillText(line, 512, y);
  });
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  const material = new T.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  const sprite = new T.Sprite(material);
  sprite.name = "Editable name lettering";
  sprite.position.set(0, -0.08, 0.17);
  sprite.scale.set(0.94, 0.47, 1);
  return sprite;
}
