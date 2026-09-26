import { charmById, decorations } from "./charms";
export const slotIds = [
  "companion",
  "extra0",
  "extra1",
  "extra2",
  "extra3",
] as const;
export type SlotId = (typeof slotIds)[number];
export interface AssetRecord {
  id: string;
  name: string;
  bytes: number;
  bounds?: [number, number, number];
  triangles: number;
  primitives: number;
  textureBytes: number;
}
export interface Slot {
  asset: string | null;
  name?: string;
  nameStyle?: "metal" | "neon";
  nameColor?: string;
  rotation: [number, number, number];
  attachment: [number, number, number];
}
export interface CharmLibrary {
  version: 1 | 2;
  revision: number;
  assets: AssetRecord[];
  slots: Record<SlotId, Slot>;
  notice?: string;
}
export const emptySlot = (asset: string | null = null): Slot => ({
  asset,
  rotation: [0, 0, 0],
  attachment: [
    ...(asset
      ? (charmById(asset)?.defaultAttachment ?? [0, 0.5, 0])
      : [0, 0.5, 0]),
  ] as [number, number, number],
});
export function migrateLibrary(s: {
  decoration: string;
  extras: (string | null)[];
  name: string;
}): CharmLibrary {
  const slots = {
    companion: emptySlot(s.decoration),
    extra0: emptySlot(s.extras[0]),
    extra1: emptySlot(s.extras[1]),
    extra2: emptySlot(),
    extra3: emptySlot(),
  };
  const result: CharmLibrary = { version: 2, revision: 0, assets: [], slots };
  if (s.name) {
    const available = slotIds.find((id) => !slots[id].asset);
    if (available) slots[available].asset = "tag";
    else
      result.notice =
        "Your name tag is preserved in the library but unassigned: all five optional slots are occupied.";
  }
  return result;
}
export function validateLibrary(l: CharmLibrary) {
  if (
    !l ||
    ![1, 2].includes(l.version) ||
    !Number.isSafeInteger(l.revision) ||
    l.revision < 0 ||
    !Array.isArray(l.assets) ||
    l.assets.length > 512
  )
    throw Error("Unsupported or invalid charm library");
  let bytes = 0;
  const ids = new Set<string>();
  for (const a of l.assets) {
    if (
      !a ||
      !/^upload-[a-f0-9]{64}$/.test(a.id) ||
      ids.has(a.id) ||
      typeof a.name !== "string" ||
      a.name.length > 200 ||
      ![a.bytes, a.triangles, a.primitives, a.textureBytes].every(
        (n) => Number.isSafeInteger(n) && n >= 0,
      ) ||
      a.bytes > 20_000_000 ||
      a.triangles > 200000 ||
      a.primitives > 100 ||
      a.textureBytes > 96 * 1024 * 1024
    )
      throw Error("Invalid imported asset");
    if (
      a.bounds &&
      (!Array.isArray(a.bounds) ||
        a.bounds.length !== 3 ||
        !a.bounds.every((n) => Number.isFinite(n) && n >= 0 && n <= 1))
    )
      throw Error("Invalid asset bounds");
    ids.add(a.id);
    bytes += a.bytes;
  }
  if (bytes > 250_000_000)
    throw Error(
      "The imported library exceeds 250 MB. Remove unused assets first.",
    );
  let triangles = 0,
    primitives = 0,
    textures = 0;
  if (!l.slots || Object.keys(l.slots).length !== (l.version === 1 ? 3 : 5))
    throw Error("The charm slot count does not match this library version");
  for (const id of l.version === 1 ? slotIds.slice(0, 3) : slotIds) {
    const s = l.slots[id];
    if (
      !s ||
      !Array.isArray(s.rotation) ||
      s.rotation.length !== 3 ||
      !s.rotation.every((n) => Number.isFinite(n) && Math.abs(n) <= 360) ||
      !Array.isArray(s.attachment) ||
      s.attachment.length !== 3 ||
      !s.attachment.every((n) => Number.isFinite(n) && Math.abs(n) <= 0.75)
    )
      throw Error(`Invalid ${id} placement`);
    if (
      (s.name !== undefined &&
        (typeof s.name !== "string" ||
          [
            ...new Intl.Segmenter(undefined, {
              granularity: "grapheme",
            }).segment(s.name),
          ].length > 24)) ||
      (s.nameStyle !== undefined && !["metal", "neon"].includes(s.nameStyle)) ||
      (s.nameColor !== undefined && !/^#[0-9a-fA-F]{6}$/.test(s.nameColor))
    )
      throw Error(
        "Name tags accept up to 24 characters and a valid color/style",
      );
    if (s.asset !== null) {
      const a = l.assets.find((a) => a.id === s.asset);
      if (!a && !charmById(s.asset)) throw Error("Unknown charm asset");
      if (!a && !decorations.some((d) => d.id === s.asset))
        throw Error("Functional assets cannot occupy optional slots");
      const resources = a ?? charmById(s.asset)?.resources;
      if (resources) {
        triangles += resources.triangles;
        primitives += resources.primitives;
        textures += resources.textureBytes;
      }
    }
  }
  if (triangles > 300000 || primitives > 150 || textures > 192 * 1024 * 1024)
    throw Error(
      "Active charms exceed the combined scene budget. Choose a simpler asset or clear another slot.",
    );
}
export function rotatedAttachment(
  point: [number, number, number],
  oldAngles: number[],
  newAngles: number[],
): [number, number, number] {
  const matrix = (angles: number[]) => {
    const [x, y, z] = angles.map((v) => (v * Math.PI) / 180),
      a = Math.cos(x),
      b = Math.sin(x),
      c = Math.cos(y),
      d = Math.sin(y),
      e = Math.cos(z),
      f = Math.sin(z);
    return [
      c * e,
      -c * f,
      d,
      b * d * e + a * f,
      -b * d * f + a * e,
      -b * c,
      -a * d * e + b * f,
      a * d * f + b * e,
      a * c,
    ];
  };
  const old = matrix(oldAngles),
    next = matrix(newAngles),
    local = [0, 1, 2].map(
      (i) => old[i] * point[0] + old[i + 3] * point[1] + old[i + 6] * point[2],
    );
  return [0, 1, 2].map(
    (i) =>
      next[i * 3] * local[0] +
      next[i * 3 + 1] * local[1] +
      next[i * 3 + 2] * local[2],
  ) as [number, number, number];
}
