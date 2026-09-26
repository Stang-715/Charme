import { readFile, writeFile } from "node:fs/promises";
import { inspectGlb } from "../src/main/assets";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
const manifest = JSON.parse(
  await readFile("public/models/manifest.json", "utf8"),
);
const jobs = JSON.parse(
  await readFile("assets/studio-pbr-generations.json", "utf8"),
);
for (const job of jobs) {
  const record = manifest.assets.find((a: any) => a.id === job.name);
  const bytes = await readFile(`public/${record.model}`);
  const resource = inspectGlb(bytes, record.name);
  const len = bytes.readUInt32LE(12),
    doc = JSON.parse(bytes.subarray(20, 20 + len).toString());
  if (
    !doc.materials.some(
      (m: any) =>
        m.normalTexture && m.pbrMetallicRoughness?.metallicRoughnessTexture,
    )
  )
    throw Error("Missing PBR maps: " + job.name);
  // Decode geometry only for calibration; this does not alter the shipped model.
  delete doc.images;
  delete doc.textures;
  delete doc.materials;
  for (const mesh of doc.meshes)
    for (const p of mesh.primitives) delete p.material;
  const json = Buffer.from(JSON.stringify(doc));
  const padded = Buffer.concat([
    json,
    Buffer.alloc((4 - (json.length % 4)) % 4, 32),
  ]);
  const bin = bytes.subarray(20 + len);
  const h = Buffer.alloc(20);
  h.writeUInt32LE(0x46546c67, 0);
  h.writeUInt32LE(2, 4);
  h.writeUInt32LE(20 + padded.length + bin.length, 8);
  h.writeUInt32LE(padded.length, 12);
  h.writeUInt32LE(0x4e4f534a, 16);
  const bare = Buffer.concat([h, padded, bin]);
  const gltf = await new GLTFLoader().parseAsync(
    bare.buffer.slice(bare.byteOffset, bare.byteOffset + bare.byteLength),
    "",
  );
  const model = new T.Group();
  model.add(gltf.scene);
  model.rotation.set(...record.rotation);
  model.updateMatrixWorld(true);
  const box = new T.Box3().setFromObject(model),
    size = box.getSize(new T.Vector3());
  model.position.sub(box.getCenter(new T.Vector3()));
  const root = new T.Group();
  root.add(model);
  root.scale.setScalar(1 / Math.max(size.x, size.y, size.z));
  root.updateMatrixWorld(true);
  const target = new T.Vector3(0, 0.5, 0),
    nearest = new T.Vector3(),
    best = new T.Vector3(),
    tri = new T.Triangle();
  let distance = Infinity;
  root.traverse((node: any) => {
    if (!node.isMesh) return;
    const p = node.geometry.attributes.position,
      i = node.geometry.index;
    for (let n = 0; n < (i?.count ?? p.count); n += 3) {
      [tri.a, tri.b, tri.c].forEach((v, j) =>
        v
          .fromBufferAttribute(p, i ? i.getX(n + j) : n + j)
          .applyMatrix4(node.matrixWorld),
      );
      tri.closestPointToPoint(target, nearest);
      const d = nearest.distanceToSquared(target);
      if (d < distance) {
        distance = d;
        best.copy(nearest);
      }
    }
  });
  record.resources = {
    triangles: resource.triangles,
    primitives: resource.primitives,
    textureBytes: resource.textureBytes,
  };
  record.bounds = size.divideScalar(Math.max(size.x, size.y, size.z)).toArray();
  record.defaultAttachment = best.toArray();
  record.materialCreation = job.id;
  record.review =
    "Magnific PBR materials; embedded maps optimized to 1024px. Browser visual inspection; native acceptance pending.";
  console.log(job.name, record.resources, record.attachment);
}
await writeFile(
  "public/models/manifest.json",
  JSON.stringify(manifest, null, 2) + "\n",
);
