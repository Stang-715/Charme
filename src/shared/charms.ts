import source from "../../public/models/manifest.json";
export interface CharmDefinition {
  id: string;
  name: string;
  model: string;
  rotation: number[];
  role: string;
  provider: string;
  creation: string;
  thumbnail?: string;
  category?: string;
  readiness?: "ready" | "pending" | "rejected";
  preserveMaterials?: boolean;
  resources?: { triangles: number; primitives: number; textureBytes: number };
  bounds?: number[];
  scale?: number;
  attachment?: number[];
  defaultAttachment?: number[];
  motionLimit?: number;
}
const valid = (asset: CharmDefinition) =>
  /^[a-z][a-z0-9-]*$/.test(asset.id) &&
  /^models\/[a-z0-9-]+\.glb$/.test(asset.model) &&
  asset.rotation.length === 3 &&
  asset.rotation.every(Number.isFinite) &&
  ["fixed", "decoration"].includes(asset.role);
export const charms: CharmDefinition[] =
  source.version === 1
    ? (source.assets as CharmDefinition[]).filter(valid)
    : [];
export const decorations = charms.filter(
  (c) =>
    (c.role === "decoration" || c.id === "tag") &&
    (!c.readiness || c.readiness === "ready"),
);
export const charmById = (id: string) => charms.find((c) => c.id === id);
