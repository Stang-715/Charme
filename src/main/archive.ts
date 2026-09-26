import { createHash } from "node:crypto";
import { validateState, type State } from "../shared/model";
import { inspectGlb, type AssetStore } from "./assets";
// Length-delimited archive: no extraction paths, links, compression, or executable entries.
const magic = Buffer.from("CHARME01");
export async function exportArchive(state: State, assets: AssetStore) {
  const records = state.settings.charms?.assets ?? [];
  const entries: { id: string; length: number; hash: string }[] = [],
    data: Buffer[] = [];
  for (const record of records) {
    const bytes = await assets.read(record.id);
    const actual = inspectGlb(bytes, record.name);
    if (actual.id !== record.id) throw Error("Asset integrity check failed");
    entries.push({
      id: record.id,
      length: bytes.length,
      hash: createHash("sha256").update(bytes).digest("hex"),
    });
    data.push(bytes);
  }
  const json = Buffer.from(JSON.stringify({ version: 1, state, entries }));
  if (json.length > 12_000_000) throw Error("Backup metadata exceeds 12 MB");
  const length = Buffer.alloc(4);
  length.writeUInt32LE(json.length);
  return Buffer.concat([magic, length, json, ...data]);
}
export function parseArchive(bytes: Buffer) {
  if (bytes.length > 270_000_000) throw Error("Backup exceeds 270 MB");
  if (!bytes.subarray(0, 8).equals(magic))
    return {
      state: validateState(JSON.parse(bytes.toString("utf8"))),
      assets: [] as { record: ReturnType<typeof inspectGlb>; bytes: Buffer }[],
    };
  if (bytes.length < 12) throw Error("Truncated backup");
  const length = bytes.readUInt32LE(8);
  if (length > 12_000_000 || 12 + length > bytes.length)
    throw Error("Invalid backup header");
  const header = JSON.parse(bytes.subarray(12, 12 + length).toString("utf8"));
  if (
    header.version !== 1 ||
    !Array.isArray(header.entries) ||
    header.entries.length > 512
  )
    throw Error("Unsupported backup");
  const state = validateState(header.state),
    seen = new Set<string>(),
    assets = [];
  let offset = 12 + length;
  for (const entry of header.entries) {
    if (
      !entry ||
      !/^upload-[a-f0-9]{64}$/.test(entry.id) ||
      seen.has(entry.id) ||
      !Number.isSafeInteger(entry.length) ||
      entry.length < 1 ||
      entry.length > 20_000_000 ||
      offset + entry.length > bytes.length
    )
      throw Error("Invalid archive entry");
    seen.add(entry.id);
    const data = bytes.subarray(offset, offset + entry.length);
    offset += entry.length;
    const expected = state.settings.charms?.assets.find(
      (a) => a.id === entry.id,
    );
    if (!expected) throw Error("Unreferenced backup asset");
    const record = inspectGlb(data, expected.name);
    if (
      record.id !== entry.id ||
      (expected.bounds &&
        JSON.stringify(expected.bounds) !== JSON.stringify(record.bounds)) ||
      record.id !== "upload-" + entry.hash ||
      ["bytes", "triangles", "primitives", "textureBytes"].some(
        (k) => (record as any)[k] !== (expected as any)[k],
      )
    )
      throw Error("Backup asset integrity mismatch");
    assets.push({ record, bytes: data });
  }
  if (
    offset !== bytes.length ||
    state.settings.charms?.assets.some((a) => !seen.has(a.id))
  )
    throw Error("Missing asset or trailing archive data");
  return { state, assets };
}
