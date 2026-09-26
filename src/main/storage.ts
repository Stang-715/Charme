import {
  mkdir,
  readFile,
  open,
  rename,
  copyFile,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { initialState, validateState, type State } from "../shared/model";
export class Storage {
  constructor(readonly directory: string) {}
  file(name: string) {
    return path.join(this.directory, name);
  }
  async atomic(name: string, value: unknown) {
    await mkdir(this.directory, { recursive: true });
    const tmp = this.file(`${name}.${crypto.randomUUID()}.tmp`);
    const handle = await open(tmp, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(value));
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(tmp, this.file(name));
      const dir = await open(this.directory, "r");
      try {
        await dir.sync();
      } finally {
        await dir.close();
      }
    } catch (e) {
      await unlink(tmp).catch(() => {});
      throw e;
    }
  }
  async load(): Promise<{ state: State; recovered: boolean }> {
    let text: string;
    try {
      text = await readFile(this.file("state.json"), "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT")
        return { state: initialState(), recovered: false };
      throw e;
    }
    try {
      return { state: validateState(JSON.parse(text)), recovered: false };
    } catch (error) {
      // Preserve an unknown newer schema; never downgrade by loading an old backup.
      try {
        const raw = JSON.parse(text);
        if (
          ![1, 2, 3, 4].includes(raw.schema) ||
          (raw.settings?.appearance &&
            ![1, 2].includes(raw.settings.appearance.version)) ||
          (raw.settings?.charms &&
            ![1, 2].includes(raw.settings.charms.version))
        )
          throw Error(
            "Unsupported data version. Install a compatible Charme version.",
          );
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("Unsupported")) throw e;
      }
      await copyFile(
        this.file("state.json"),
        this.file(`damaged-${Date.now()}.json`),
      );
      try {
        return {
          state: validateState(
            JSON.parse(await readFile(this.file("backup.json"), "utf8")),
          ),
          recovered: true,
        };
      } catch {
        throw Error(
          `Data could not be recovered. Original files are preserved in ${this.directory}`,
        );
      }
    }
  }
  async save(next: State, previous?: State) {
    validateState(next);
    if (previous) await this.atomic("backup.json", previous);
    await this.atomic("state.json", next);
  }
  async checkpoint(value: unknown) {
    await this.atomic("checkpoint.json", value);
  }
  async readCheckpoint() {
    try {
      return JSON.parse(await readFile(this.file("checkpoint.json"), "utf8"));
    } catch {
      return null;
    }
  }
}
