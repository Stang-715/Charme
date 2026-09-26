/** Renderer-owned hit tests follow the transformed, generated meshes. */
const tests = new WeakMap<Element, (x: number, y: number) => boolean>();
export function registerHitTest(
  element: Element,
  test: (x: number, y: number) => boolean,
) {
  tests.set(element, test);
  return () => tests.delete(element);
}
export function interactiveAt(target: Element, x: number, y: number) {
  const control = target.closest("[data-hit]");
  if (!control) return false;
  if (!control.classList.contains("charm")) return true;
  return [...control.querySelectorAll(".model")].some((model) =>
    tests.get(model)?.(x, y),
  );
}
