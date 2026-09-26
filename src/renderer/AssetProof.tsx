import { useEffect, useRef, useState } from "react";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
export function AssetProof() {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("Loading generated components…");
  useEffect(() => {
    const el = host.current!;
    const renderer = new T.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(960, 520);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.localClippingEnabled = true;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    el.append(renderer.domElement);
    const scene = new T.Scene();
    scene.background = new T.Color("#26343c");
    const camera = new T.PerspectiveCamera(32, 960 / 520, 0.01, 30);
    camera.position.set(0, 0.1, 3.6);
    camera.lookAt(0, 0, 0);
    scene.add(new T.HemisphereLight(0xffffff, 0x334455, 3));
    for (const x of [-2, 2]) {
      const l = new T.DirectionalLight(0xffffff, 4);
      l.position.set(x, 3, 4);
      scene.add(l);
    }
    let disposed = false;
    const loaded: T.Object3D[] = [];
    const loader = new GLTFLoader();
    Promise.all(
      ["bottle-shell", "liquid", "liquid-surface", "chain-link"].map((n) =>
        loader.loadAsync(`./models/${n}.glb`),
      ),
    )
      .then((models) => {
        if (disposed) return;
        for (const m of models) {
          m.scene.updateMatrixWorld(true);
          const b = new T.Box3().setFromObject(m.scene),
            sz = b.getSize(new T.Vector3()),
            c = b.getCenter(new T.Vector3());
          const wrapper = new T.Group();
          m.scene.position.sub(c);
          wrapper.add(m.scene);
          wrapper.scale.setScalar(1 / Math.max(sz.x, sz.y, sz.z));
          const root = new T.Group();
          root.add(wrapper);
          m.scene = root;
        }

        for (const [i, f] of [0, 0.2, 0.6, 1].entries()) {
          const group = new T.Group();
          group.position.x = (i - 1.5) * 0.65;
          scene.add(group);
          const shell = models[0].scene.clone(true);
          group.add(shell);
          shell.traverse((n) => {
            if (n instanceof T.Mesh) {
              n.material = new T.MeshPhysicalMaterial({
                color: "#d7f5ff",
                metalness: 0,
                roughness: 0.08,
                transparent: true,
                opacity: 0.24,
                side: T.FrontSide,
                depthWrite: false,
              });
            }
          });
          const water = models[1].scene.clone(true);
          water.scale.set(0.49, 0.52, 0.49);
          water.position.y = -0.185;
          water.visible = f > 0;
          group.add(water);
          const level = -0.445 + f * 0.52;
          const plane = new T.Plane(new T.Vector3(0, -1, 0), level);
          water.traverse((n) => {
            if (n instanceof T.Mesh)
              n.material = new T.MeshPhysicalMaterial({
                color: "#138fe0",
                metalness: 0.05,
                roughness: 0.13,
                clearcoat: 1,
                clippingPlanes: [plane],
              });
          });
          const top = models[2].scene.clone(true);
          top.scale.set(0.303, 0.05, 0.303);
          top.position.y = level;
          top.visible = f > 0;
          group.add(top);
          top.traverse((n) => {
            if (n instanceof T.Mesh)
              n.material = new T.MeshPhysicalMaterial({
                color: "#66d7ff",
                metalness: 0.1,
                roughness: 0.12,
                clearcoat: 1,
              });
          });
          for (let j = 0; j < 3; j++) {
            const link = models[3].scene.clone(true);
            link.rotation.y = Math.PI / 2 + ((j % 2) * Math.PI) / 2;
            link.scale.setScalar(0.08);
            link.position.y = 0.54 + j * 0.06;
            group.add(link);
            link.traverse((n) => {
              if (n instanceof T.Mesh)
                n.material = new T.MeshStandardMaterial({
                  color: "#e9edf0",
                  metalness: 0.8,
                  roughness: 0.18,
                });
            });
          }
        }
        loaded.push(...models.map((m) => m.scene));
        renderer.render(scene, camera);
        setStatus(
          "Generated geometry loaded: empty · 20% · 60% · full. Visual feasibility inspection required.",
        );
      })
      .catch((e) => setStatus(String(e)));
    return () => {
      disposed = true;
      scene.traverse((n) => {
        if (n instanceof T.Mesh) {
          n.geometry.dispose();
          for (const m of Array.isArray(n.material) ? n.material : [n.material])
            m.dispose();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);
  return (
    <main className="dashboard">
      <h1>Magnific asset feasibility</h1>
      <p role="status">{status}</p>
      <div ref={host} />
      <p>Prototype only — not connected to hydration records.</p>
    </main>
  );
}
