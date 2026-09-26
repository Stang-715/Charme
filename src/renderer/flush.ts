const writers = new Set<() => Promise<void>>();
export function registerWriter(writer: () => Promise<void>) {
  writers.add(writer);
  return () => {
    writers.delete(writer);
  };
}
export async function flushEdits() {
  await Promise.all([...writers].map((writer) => writer()));
}
