import { registerHitTest } from "./hitTest";
import { charmById } from "../shared/charms";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
export function Model({
  name,
  glow = false,
  reduced = false,
  refill = 0,
}: {
  name: string;
  glow?: boolean;
  reduced?: boolean;
  refill?: number;
}) {
  const host = useRef<HTMLDivElement>(null),
    effects = useRef({ glow, reduced, refill });
  effects.current = { glow, reduced, refill };
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const redraw = useRef<() => void>(() => {});
  useEffect(() => {
    redraw.current();
  }, [glow, reduced, refill]);
  useEffect(() => {
    if (!host.current) return;
    const definition = charmById(name);
    if (!definition) {
      setError(true);
      return;
    }
    setError(false);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: "low-power",
      });
    } catch {
      setError(true);
      return;
    }
    const element = host.current;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    renderer.setClearColor(0, 0);
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene(),
      camera = new THREE.PerspectiveCamera(32, 1, 0.01, 100);
    camera.position.set(0, 0, 3.7);
    // Studio illumination only: this texture contains no model geometry.
    const lightPixels = new Float32Array(128 * 64 * 4);
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 128; x++) {
        const softbox =
          (x > 12 && x < 25 && y > 15 && y < 49) ||
          (x > 80 && x < 88 && y > 6 && y < 53);
        const value = softbox
          ? 3.0
          : 0.12 + 0.13 * Math.sin((y / 64) * Math.PI);
        const offset = (y * 128 + x) * 4;
        lightPixels.set([value, value, value, 1], offset);
      }
    const lighting = new THREE.DataTexture(
      lightPixels,
      128,
      64,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    lighting.mapping = THREE.EquirectangularReflectionMapping;
    lighting.needsUpdate = true;
    const pmrem = new THREE.PMREMGenerator(renderer),
      environment = pmrem.fromEquirectangular(lighting);
    scene.environment = environment.texture;
    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    for (const [x, y, z, intensity] of [
      [-3, 4, 5, 2.0],
      [3, 1, 3, 1.0],
      [0, -2, 2, 0.3],
    ]) {
      const light = new THREE.DirectionalLight(0xffffff, intensity);
      light.position.set(x, y, z);
      scene.add(light);
    }
    let object: THREE.Group | undefined,
      frame = 0,
      disposed = false;
    const materials: THREE.MeshStandardMaterial[] = [];
    const waterPulse = { value: 0 },
      waterLevel = { value: 0.4 };
    let refillStarted = 0,
      lastRefill = 0;
    const draw = () => {
      cancelAnimationFrame(frame);
      if (disposed) return;
      const { glow, reduced, refill } = effects.current;
      if (refill !== lastRefill) {
        lastRefill = refill;
        refillStarted = performance.now();
      }
      const refillAge = performance.now() - refillStarted;
      waterLevel.value =
        refill && refillAge < 900 && !reduced
          ? -0.4 + 0.8 * Math.min(1, refillAge / 900)
          : 0.4;
      if (name === "bottle") {
        const pulse = glow
          ? reduced
            ? 0.25
            : 0.15 + 0.18 * (1 + Math.sin(performance.now() / 636))
          : 0;
        for (const m of materials) {
          m.emissive.set("#41bdf6");
          m.emissiveIntensity = 0;
          waterPulse.value = pulse;
        }
      }
      renderer.render(scene, camera);
      if ((glow || (refill && refillAge < 900)) && !reduced)
        frame = requestAnimationFrame(draw);
    };
    const raycaster = new THREE.Raycaster();
    const unregisterHit = registerHitTest(element, (x, y) => {
      if (!object || disposed) return false;
      const rect = element.getBoundingClientRect();
      let matrix = new DOMMatrix();
      for (
        let ancestor: HTMLElement | null = element;
        ancestor;
        ancestor = ancestor.parentElement
      ) {
        const transform = getComputedStyle(ancestor).transform;
        if (transform !== "none")
          matrix = new DOMMatrix(transform).multiply(matrix);
      }
      // Translation is already captured by the transformed element's center.
      matrix.e = matrix.f = 0;
      const local = new DOMPoint(
        x - rect.left - rect.width / 2,
        y - rect.top - rect.height / 2,
      ).matrixTransform(matrix.inverse());
      const point = new THREE.Vector2(
        (local.x / element.clientWidth) * 2,
        (-local.y / element.clientHeight) * 2,
      );
      if (Math.abs(point.x) > 1 || Math.abs(point.y) > 1) return false;
      raycaster.setFromCamera(point, camera);
      return raycaster.intersectObject(object, true).length > 0;
    });
    redraw.current = draw;
    const resize = () => {
      const { width, height } = element.getBoundingClientRect();
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      draw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    const disposeModel = (root: THREE.Object3D) => {
      const textures = new Set<THREE.Texture>();
      root.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        node.geometry.dispose();
        for (const material of Array.isArray(node.material)
          ? node.material
          : [node.material]) {
          for (const value of Object.values(material))
            if (value instanceof THREE.Texture) textures.add(value);
          material.dispose();
        }
      });
      for (const texture of textures) {
        texture.dispose();
        if (texture.source.data instanceof ImageBitmap)
          texture.source.data.close();
      }
    };
    new GLTFLoader().load(
      `./${definition.model}`,
      (gltf) => {
        if (disposed) {
          disposeModel(gltf.scene);
          return;
        }
        object = gltf.scene;
        object.rotation.set(
          definition.rotation[0],
          definition.rotation[1],
          definition.rotation[2],
        );
        object.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(object),
          size = box.getSize(new THREE.Vector3()),
          center = box.getCenter(new THREE.Vector3());
        object.position.sub(center);
        const parent = new THREE.Group();
        parent.add(object);
        parent.scale.setScalar(
          ((name === "chain" ? 2.1 : 1.8) * (definition.scale ?? 1)) /
            Math.max(size.x, size.y, size.z),
        );
        scene.add(parent);
        object.traverse((node) => {
          if (node instanceof THREE.Mesh) {
            const list = Array.isArray(node.material)
              ? node.material
              : [node.material];
            for (const mat of list)
              if (mat instanceof THREE.MeshStandardMaterial) {
                materials.push(mat);
                if (name === "hoop" || name === "chain" || name === "tag") {
                  mat.metalness = 0.85;
                  mat.roughness = 0.2;
                } else {
                  mat.roughness = 0.34;
                }

                if (name === "bottle") {
                  mat.onBeforeCompile = (shader) => {
                    shader.uniforms.charmePulse = waterPulse;
                    shader.uniforms.charmeLevel = waterLevel;
                    shader.vertexShader =
                      "varying float charmeY;\n" +
                      shader.vertexShader.replace(
                        "#include <begin_vertex>",
                        "#include <begin_vertex>\ncharmeY=position.y;",
                      );
                    shader.fragmentShader =
                      "varying float charmeY; uniform float charmePulse; uniform float charmeLevel;\n" +
                      shader.fragmentShader;
                    shader.fragmentShader = shader.fragmentShader.replace(
                      "#include <emissivemap_fragment>",
                      `#include <emissivemap_fragment>
                      float waterMask=step(diffuseColor.r+0.035,diffuseColor.b)*step(diffuseColor.r+0.015,diffuseColor.g)*(1.0-smoothstep(0.18,0.30,charmeY));
                      float fill=1.0-smoothstep(charmeLevel-0.03,charmeLevel+0.03,charmeY);
                      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(dot(diffuseColor.rgb,vec3(0.333))),waterMask*(1.0-fill)*0.8);
                      totalEmissiveRadiance+=vec3(0.03,0.48,1.0)*charmePulse*waterMask*fill;`,
                    );
                  };
                }
              }
          }
        });
        resize();
      },
      undefined,
      () => {
        if (!disposed) setError(true);
      },
    );
    const lost = (event: Event) => {
      event.preventDefault();
      setError(true);
    };
    renderer.domElement.addEventListener("webglcontextlost", lost);
    return () => {
      disposed = true;
      observer.disconnect();
      unregisterHit();
      cancelAnimationFrame(frame);
      if (object) disposeModel(object);
      environment.dispose();
      pmrem.dispose();
      lighting.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      redraw.current = () => {};
    };
  }, [name, attempt]);
  return (
    <div className={`model ${name}`} ref={host}>
      {error && (
        <span className="asset-error" role="status">
          {name} model unavailable.{" "}
          <span
            role="button"
            tabIndex={0}
            data-hit
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setAttempt((x) => x + 1);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                setAttempt((x) => x + 1);
              }
            }}
          >
            Retry
          </span>
        </span>
      )}
    </div>
  );
}
