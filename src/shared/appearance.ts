import { charmById } from "./charms";
import { tetherPoints, rimAnchor } from "./tether";
import { type CharmLibrary, slotIds } from "./library";
export const instances = [
  "hoop",
  "bottle",
  "notebook",
  "companion",
  "tag",
  "extra0",
  "extra1",
  "extra2",
  "extra3",
] as const;
export type Instance = (typeof instances)[number];
export interface Appearance {
  version: 1 | 2;
  revision: number;
  scales: Record<Instance, number>;
  links: Record<Instance, number>;
  wind: boolean;
  strength: number;
  motion: boolean;
}
export function defaultAppearance(): Appearance {
  return {
    version: 2,
    revision: 0,
    scales: Object.fromEntries(instances.map((k) => [k, 1])) as Record<
      Instance,
      number
    >,
    links: {
      hoop: 0,
      bottle: 5,
      notebook: 10,
      companion: 5,
      tag: 18,
      extra0: 18,
      extra1: 18,
      extra2: 20,
      extra3: 20,
    },
    wind: true,
    strength: 0.5,
    motion: true,
  };
}
export function validateAppearance(
  a: Appearance,
  settings?: {
    name?: string;
    extras?: (string | null)[];
    charms?: CharmLibrary;
  },
) {
  if (
    !a ||
    ![1, 2].includes(a.version) ||
    !Number.isInteger(a.revision) ||
    a.revision < 0 ||
    typeof a.wind !== "boolean" ||
    typeof a.motion !== "boolean" ||
    !Number.isFinite(a.strength) ||
    a.strength < 0 ||
    a.strength > 1
  )
    throw Error("Invalid appearance");
  for (const id of a.version === 1
    ? instances.filter((id) => !["extra2", "extra3"].includes(id))
    : instances) {
    if (
      !Number.isFinite(a.scales?.[id]) ||
      a.scales[id] < 0.5 ||
      a.scales[id] > 1.5
    )
      throw Error("Sizes must be between 50% and 150%");
    if (!Number.isInteger(a.links?.[id]) || a.links[id] < 0 || a.links[id] > 20)
      throw Error("Chain length must be 0–20 links");
  }
  if (a.scales.hoop < 0.85 || a.scales.bottle < 0.85)
    throw Error(
      "Hoop and bottle must be at least 85% to keep controls readable",
    );
  if (a.scales.hoop > 1.35)
    throw Error("Hoop size above 135% would clip the widget");
  const dimensions: Record<Instance, number> = {
    hoop: 0.4,
    bottle: 0.36,
    notebook: 0.25,
    companion: 0.25,
    tag: 0.22,
    extra0: 0.14,
    extra1: 0.14,
    extra2: 0.12,
    extra3: 0.12,
  };
  const anchorY: Record<Instance, number> = {
    hoop: 0.4,
    bottle: 0.29,
    notebook: 0.19,
    companion: 0.29,
    tag: 0.19,
    extra0: 0.27,
    extra1: 0.27,
    extra2: 0.19,
    extra3: 0.19,
  };
  for (const id of instances)
    if (
      id !== "hoop" &&
      (id !== "tag" || (!settings?.charms && !!settings?.name)) &&
      (!id.startsWith("extra") || !!settings?.extras?.[Number(id.at(-1))]) &&
      anchorY[id] -
        a.links[id] * 0.03 -
        dimensions[id] * (id === "tag" ? 0.64 : 1) * a.scales[id] <
        -0.57
    )
      throw Error(
        `${id} would extend beyond the usable widget area. Reduce size or chain length.`,
      );
  if (a.links.bottle < 3 || a.links.notebook < 4 || a.links.companion < 3)
    throw Error("Functional charms need enough chain to clear the hoop");
}

/** Conservative rest-pose boxes; runtime collisions handle contact during motion. */
export function validateLayoutEnvelope(
  a: Appearance,
  settings: {
    name?: string;
    extras?: (string | null)[];
    decoration?: string;
    charms?: CharmLibrary;
  },
) {
  validateAppearance(a, settings);
  const longName =
    settings.name &&
    [
      ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
        settings.name,
      ),
    ].length > 16;
  const definitions: Record<
    Exclude<Instance, "hoop">,
    [number, number, number, number]
  > = {
    bottle: [-0.18, 0.29, 0.13, 0.36],
    notebook: [0, 0.19, 0.185, 0.25],
    companion: [0.18, 0.29, 0.25, settings.decoration === "car" ? 0.21 : 0.25],
    tag: [0, 0.19, longName ? 0.38 : 0.22, 0.141],
    extra0: [-0.2, 0.4, 0.14, 0.14],
    extra1: [0.2, 0.4, 0.14, 0.14],
    extra2: [-0.1, 0.23, 0.12, 0.12],
    extra3: [0.1, 0.23, 0.12, 0.12],
  };
  const active: Exclude<Instance, "hoop">[] = ["bottle", "notebook"];
  if (settings.charms) {
    for (const id of slotIds)
      if (settings.charms.slots[id]?.asset) active.push(id);
  } else {
    active.push("companion");
    if (settings.name) active.push("tag");
    if (settings.extras?.[0]) active.push("extra0");
    if (settings.extras?.[1]) active.push("extra1");
  }
  const boxes = active.map((id) => {
    const [x, y, baseW, baseH] = definitions[id];
    const assetId =
      settings.charms?.slots[id as keyof CharmLibrary["slots"]]?.asset;
    const catalogBounds = assetId ? charmById(assetId)?.bounds : undefined;
    const uploaded = assetId?.startsWith("upload-") || !!catalogBounds;
    const slot = settings.charms?.slots[id as keyof CharmLibrary["slots"]];
    const record = settings.charms?.assets.find(
      (asset) => asset.id === slot?.asset,
    );
    const extent =
      (id === "companion"
        ? 0.25
        : ["extra2", "extra3"].includes(id)
          ? 0.12
          : 0.14) * a.scales[id];
    const dimensions = record?.bounds ?? catalogBounds ?? [1, 1, 1];
    let w = uploaded ? dimensions[0] * extent : baseW * a.scales[id],
      h = uploaded ? dimensions[1] * extent : baseH * a.scales[id];
    if (uploaded && slot) {
      const [rx, ry, rz] = slot.rotation.map((n) => (n * Math.PI) / 180),
        cx = Math.cos(rx),
        sx = Math.sin(rx),
        cy = Math.cos(ry),
        sy = Math.sin(ry),
        cz = Math.cos(rz),
        sz = Math.sin(rz);
      const m = [
        cy * cz,
        -cy * sz,
        sy,
        sx * sy * cz + cx * sz,
        -sx * sy * sz + cx * cz,
        -sx * cy,
      ];
      w =
        (Math.abs(m[0]) * dimensions[0] +
          Math.abs(m[1]) * dimensions[1] +
          Math.abs(m[2]) * dimensions[2]) *
        extent;
      h =
        (Math.abs(m[3]) * dimensions[0] +
          Math.abs(m[4]) * dimensions[1] +
          Math.abs(m[5]) * dimensions[2]) *
        extent;
    }
    const width = w,
      height = h;
    const endpoint = tetherPoints(
      id,
      a.links[id],
      rimAnchor([x, y, 0], a.scales.hoop),
    ).at(-1)!;
    const centerX = slot
      ? endpoint[0] - slot.attachment[0] * extent
      : endpoint[0];
    const top = slot
      ? endpoint[1] - slot.attachment[1] * extent + height / 2
      : endpoint[1];
    return {
      id,
      left: centerX - width / 2,
      right: centerX + width / 2,
      top,
      bottom: top - height,
      area: width * height,
    };
  });
  for (const box of boxes)
    if (box.left < -0.43 || box.right > 0.43 || box.bottom < -0.57)
      throw Error(`${box.id} would clip. Reduce its size or chain length.`);
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i],
        b = boxes[j];
      const overlap =
        Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
        Math.max(0, Math.min(a.top, b.top) - Math.max(a.bottom, b.bottom));
      if (overlap > Math.min(a.area, b.area) * 0.2)
        throw Error(
          `${a.id} and ${b.id} overlap. Reduce a size or change a chain length.`,
        );
    }
}
