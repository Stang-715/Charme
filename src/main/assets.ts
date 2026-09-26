import { Matrix4, Vector3, Quaternion } from "three";
import { createHash } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  readdir,
  stat,
} from "node:fs/promises";
import path from "node:path";
import type { AssetRecord } from "../shared/library";
const fail = (message: string): never => {
  throw Error(`GLB rejected: ${message}`);
};
const int = (n: any, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(n) && n >= min && n <= max;
function imageSize(b: Buffer, mime: string): [number, number] {
  if (mime === "image/png") {
    if (
      b.length < 24 ||
      b.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
    )
      return fail("invalid PNG");
    return [b.readUInt32BE(16), b.readUInt32BE(20)];
  }
  if (mime !== "image/jpeg" || b[0] !== 255 || b[1] !== 216)
    return fail("only embedded PNG/JPEG textures are supported");
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i++] !== 255) return fail("invalid JPEG");
    while (b[i] === 255) i++;
    const marker = b[i++];
    if (marker === 217 || marker === 218) break;
    if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
    const len = b.readUInt16BE(i);
    if (len < 2 || i + len > b.length) return fail("invalid JPEG segment");
    if ([192, 193, 194].includes(marker)) {
      if (len < 7) return fail("invalid JPEG dimensions");
      return [b.readUInt16BE(i + 5), b.readUInt16BE(i + 3)];
    }
    i += len;
  }
  return fail("JPEG dimensions unavailable");
}
export function inspectGlb(bytes: Buffer, name: string): AssetRecord {
  if (bytes.length > 20_000_000 || bytes.length < 28)
    fail("file must be a GLB no larger than 20 MB");
  if (
    bytes.readUInt32LE(0) !== 0x46546c67 ||
    bytes.readUInt32LE(4) !== 2 ||
    bytes.readUInt32LE(8) !== bytes.length
  )
    fail("invalid GLB header");
  let offset = 12,
    json: any,
    bin: Buffer | undefined;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) fail("truncated chunk");
    const length = bytes.readUInt32LE(offset),
      kind = bytes.readUInt32LE(offset + 4);
    offset += 8;
    if (length % 4 || offset + length > bytes.length)
      fail("invalid chunk bounds");
    if (kind === 0x4e4f534a && !json && offset === 20) {
      if (length > 2_000_000) fail("metadata too large");
      try {
        json = JSON.parse(
          bytes.subarray(offset, offset + length).toString("utf8"),
        );
      } catch {
        fail("invalid JSON");
      }
    } else if (kind === 0x004e4942 && !bin) {
      bin = bytes.subarray(offset, offset + length);
    } else fail("unsupported or duplicate chunk");
    offset += length;
  }
  if (!json || !bin || json.asset?.version !== "2.0")
    fail("missing GLB 2.0 content");
  const g = json,
    binary = bin!;
  if (
    (g.extensionsRequired ?? []).some(
      (x: string) =>
        ![
          "KHR_materials_unlit",
          "KHR_materials_clearcoat",
          "KHR_materials_transmission",
          "KHR_materials_ior",
          "KHR_materials_specular",
          "KHR_materials_sheen",
          "KHR_materials_volume",
          "KHR_materials_emissive_strength",
          "KHR_texture_transform",
        ].includes(x),
    )
  )
    fail("unsupported required extension; export an uncompressed static GLB");
  if (
    g.skins?.length ||
    g.meshes?.some((m: any) =>
      m.primitives?.some((p: any) => p.targets?.length),
    )
  )
    fail("skins and morph targets are not supported");
  const walk = (x: any) => {
    if (!x || typeof x !== "object") return;
    for (const [k, v] of Object.entries(x)) {
      if (k === "uri")
        fail(
          "external and data resource URIs are not supported; embed all resources",
        );
      if (
        k === "extensions" &&
        v &&
        typeof v === "object" &&
        Object.keys(v).some((k) =>
          [
            "KHR_draco_mesh_compression",
            "EXT_meshopt_compression",
            "KHR_texture_basisu",
          ].includes(k),
        )
      )
        fail("compressed resources are not supported");
      if (typeof v === "number" && !Number.isFinite(v))
        fail("non-finite metadata");
      walk(v);
    }
  };
  walk(g);
  if (
    !Array.isArray(g.buffers) ||
    g.buffers.length !== 1 ||
    !int(g.buffers[0].byteLength, 1, binary.length) ||
    binary.length - g.buffers[0].byteLength > 3
  )
    fail("invalid embedded buffer");
  const views = g.bufferViews ?? [];
  if (views.length > 2048) fail("too many buffer views");
  for (const v of views) {
    if (
      v.buffer !== 0 ||
      !int(v.byteOffset ?? 0) ||
      !int(v.byteLength, 1) ||
      v.byteOffset + v.byteLength > binary.length ||
      (v.byteOffset ?? 0) + v.byteLength > g.buffers[0].byteLength
    )
      fail("buffer view out of bounds");
  }
  const components: Record<number, number> = {
      5120: 1,
      5121: 1,
      5122: 2,
      5123: 2,
      5125: 4,
      5126: 4,
    },
    widths: Record<string, number> = {
      SCALAR: 1,
      VEC2: 2,
      VEC3: 3,
      VEC4: 4,
      MAT2: 4,
      MAT3: 9,
      MAT4: 16,
    };
  const accessors = g.accessors ?? [];
  if (accessors.length > 2048) fail("too many accessors");
  for (const a of accessors) {
    const v = views[a.bufferView],
      unit = components[a.componentType] * widths[a.type],
      stride = v?.byteStride ?? unit;
    if (
      a.sparse ||
      !v ||
      !unit ||
      !int(a.count, 1, 1_000_000) ||
      !int(a.byteOffset ?? 0) ||
      !int(stride, unit, 252) ||
      (a.byteOffset ?? 0) + (a.count - 1) * stride + unit > v.byteLength
    )
      fail("invalid accessor range or sparse accessor");
  }
  const value = (a: any, i: number, c = 0) => {
    const v = views[a.bufferView],
      size = components[a.componentType],
      at =
        (v.byteOffset ?? 0) +
        (a.byteOffset ?? 0) +
        i * (v.byteStride ?? size * widths[a.type]) +
        c * size;
    switch (a.componentType) {
      case 5121:
        return binary.readUInt8(at);
      case 5123:
        return binary.readUInt16LE(at);
      case 5125:
        return binary.readUInt32LE(at);
      case 5126:
        return binary.readFloatLE(at);
      default:
        return fail("unsupported position/index type");
    }
  };
  let primitives = 0,
    triangles = 0;
  const meshCosts: { p: number; t: number }[] = [];
  if (!Array.isArray(g.meshes) || !g.meshes.length || g.meshes.length > 100)
    fail("missing or excessive meshes");
  for (const mesh of g.meshes) {
    let pCount = 0,
      tCount = 0;
    if (!Array.isArray(mesh.primitives)) fail("invalid mesh");
    for (const p of mesh.primitives) {
      if ((p.mode ?? 4) !== 4) fail("only triangle meshes are supported");
      const a = accessors[p.attributes?.POSITION];
      if (!a || a.type !== "VEC3" || a.componentType !== 5126)
        fail("missing float positions");
      let min = [Infinity, Infinity, Infinity],
        max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < a.count; i++)
        for (let c = 0; c < 3; c++) {
          const n = value(a, i, c);
          if (!Number.isFinite(n) || Math.abs(n) > 1e9)
            fail("unusable positions");
          min[c] = Math.min(min[c], n);
          max[c] = Math.max(max[c], n);
        }
      if (Math.max(...max.map((n, i) => n - min[i])) < 1e-9)
        fail("empty geometry bounds");
      const idx = p.indices === undefined ? null : accessors[p.indices];
      if (
        p.indices !== undefined &&
        (!idx ||
          idx.type !== "SCALAR" ||
          ![5121, 5123, 5125].includes(idx.componentType))
      )
        fail("invalid indices");
      if (idx)
        for (let i = 0; i < idx.count; i++)
          if (value(idx, i) >= a.count) fail("index outside vertex range");
      const count = idx?.count ?? a.count;
      if (count % 3) fail("incomplete triangles");
      pCount++;
      tCount += count / 3;
    }
    meshCosts.push({ p: pCount, t: tCount });
  }
  const nodes = g.nodes ?? [];
  if (!nodes.length || nodes.length > 512) fail("node count must be 1–512");
  const visiting = new Set<number>(),
    seen = new Set<number>();
  const low = new Vector3(Infinity, Infinity, Infinity),
    high = new Vector3(-Infinity, -Infinity, -Infinity);
  const visit = (i: number, parent = new Matrix4()) => {
    if (!int(i, 0, nodes.length - 1) || visiting.has(i))
      fail("invalid or cyclic nodes");
    if (seen.has(i)) fail("node has multiple parents");
    visiting.add(i);
    seen.add(i);
    const n = nodes[i];
    for (const [key, len] of [
      ["matrix", 16],
      ["translation", 3],
      ["rotation", 4],
      ["scale", 3],
    ] as const)
      if (
        n[key] &&
        (!Array.isArray(n[key]) ||
          n[key].length !== len ||
          !n[key].every(
            (x: any) =>
              typeof x === "number" && Number.isFinite(x) && Math.abs(x) < 1e9,
          ))
      )
        fail("invalid transform");
    const local = n.matrix
      ? new Matrix4().fromArray(n.matrix)
      : new Matrix4().compose(
          new Vector3(
            ...((n.translation ?? [0, 0, 0]) as [number, number, number]),
          ),
          new Quaternion(
            ...((n.rotation ?? [0, 0, 0, 1]) as [
              number,
              number,
              number,
              number,
            ]),
          ),
          new Vector3(...((n.scale ?? [1, 1, 1]) as [number, number, number])),
        );
    const world = new Matrix4().multiplyMatrices(parent, local);
    if (n.mesh !== undefined) {
      const cost = meshCosts[n.mesh];
      if (!cost) fail("invalid mesh reference");
      primitives += cost.p;
      triangles += cost.t;
      if (triangles > 200000 || primitives > 100)
        fail("scene exceeds geometry budget");
      for (const primitive of g.meshes[n.mesh].primitives) {
        const a = accessors[primitive.attributes.POSITION];
        const point = new Vector3();
        for (let k = 0; k < a.count; k++) {
          point
            .set(value(a, k, 0), value(a, k, 1), value(a, k, 2))
            .applyMatrix4(world);
          if (![point.x, point.y, point.z].every(Number.isFinite))
            fail("invalid transformed bounds");
          low.min(point);
          high.max(point);
        }
      }
    }
    for (const child of n.children ?? []) visit(child, world);
    visiting.delete(i);
  };
  const roots = g.scenes?.[g.scene ?? 0]?.nodes;
  if (!Array.isArray(roots) || !roots.length) fail("missing default scene");
  for (const root of roots) visit(root);
  if (triangles < 1 || triangles > 200000 || primitives > 100)
    fail("exceeds 200,000 triangles or 100 primitives");
  const dimensions = high.clone().sub(low),
    longest = Math.max(dimensions.x, dimensions.y, dimensions.z);
  if (!Number.isFinite(longest) || longest < 1e-9)
    fail("empty transformed bounds");
  const bounds = dimensions.multiplyScalar(1 / longest).toArray() as [
    number,
    number,
    number,
  ];
  let textureBytes = 0;
  for (const image of g.images ?? []) {
    const v = views[image.bufferView];
    if (!v) fail("image is not embedded");
    const [w, h] = imageSize(
      binary.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength),
      image.mimeType,
    );
    if (!int(w, 1, 4096) || !int(h, 1, 4096))
      fail("texture exceeds 4096 pixels");
    textureBytes += Math.ceil((w * h * 4 * 4) / 3);
  }
  if (textureBytes > 96 * 1024 * 1024)
    fail("decoded texture budget exceeds 96 MiB");
  return {
    id: "upload-" + createHash("sha256").update(bytes).digest("hex"),
    name: name.slice(0, 200),
    bytes: bytes.length,
    bounds,
    triangles,
    primitives,
    textureBytes,
  };
}
export class AssetStore {
  constructor(readonly directory: string) {}
  file(id: string) {
    if (!/^upload-[a-f0-9]{64}$/.test(id))
      throw Error("Invalid asset identifier");
    return path.join(this.directory, id + ".glb");
  }
  async put(bytes: Buffer, name: string) {
    const record = inspectGlb(bytes, name);
    const existing = await readFile(this.file(record.id)).catch(() => null);
    if (
      existing &&
      createHash("sha256").update(existing).digest("hex") === record.id.slice(7)
    )
      return record;
    let used = 0;
    for (const filename of await readdir(this.directory).catch(() => []))
      if (/^upload-[a-f0-9]{64}\.glb$/.test(filename))
        used += (await stat(path.join(this.directory, filename))).size;
    if (used + bytes.length > 250_000_000)
      throw Error(
        "Managed assets and recovery copies exceed 250 MB. Export your data before clearing managed backups.",
      );
    await mkdir(this.directory, { recursive: true });
    const tmp = this.file(record.id) + "." + crypto.randomUUID() + ".tmp";
    const h = await open(tmp, "wx", 0o600);
    try {
      await h.writeFile(bytes);
      await h.sync();
    } finally {
      await h.close();
    }
    try {
      await rename(tmp, this.file(record.id));
    } catch (e) {
      await unlink(tmp).catch(() => {});
      throw e;
    }
    return record;
  }
  read(id: string) {
    return readFile(this.file(id));
  }
  async clear() {
    for (const n of await readdir(this.directory).catch(() => []))
      if (/^upload-[a-f0-9]{64}\.glb$/.test(n))
        await unlink(path.join(this.directory, n));
  }
}
