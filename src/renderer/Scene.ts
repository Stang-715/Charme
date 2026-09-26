import { tagLettering } from "./nameTag";
import {
  tetherPoints,
  rimAnchor,
  connectedTether,
  hoopCollisionGroups,
  charmCollisionGroups,
  linkCollisionGroups,
} from "../shared/tether";
import { assetBytes } from "./api";
import { slotIds, type SlotId } from "../shared/library";
import { fillHeight } from "../shared/hydration";
import * as T from "three";
import R from "@dimforge/rapier3d-compat";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { charmById } from "../shared/charms";
import { type Appearance, type Instance } from "../shared/appearance";
import type { Settings } from "../shared/model";
export interface SceneOptions {
  appearance: Appearance;
  settings: Settings;
  fill: number;
  glow: boolean;
  reduced: boolean;
  editing: boolean;
  onPosition: (id: Instance, x: number, y: number) => void;
  onStatus: (s: string) => void;
}
let rapierReady: Promise<void> | undefined;
const size = {
  hoop: 0.4,
  bottle: 0.36,
  notebook: 0.25,
  companion: 0.25,
  tag: 0.22,
  extra0: 0.14,
  extra1: 0.14,
  extra2: 0.12,
  extra3: 0.12,
};
const anchors: Record<Instance, [number, number, number]> = {
  hoop: [0, 0.4, 0],
  bottle: [-0.18, 0.29, 0],
  notebook: [0, 0.19, -0.015],
  companion: [0.18, 0.29, 0],
  tag: [0, 0.19, -0.06],
  extra0: [-0.2, 0.4, -0.04],
  extra1: [0.2, 0.4, -0.04],
  extra2: [-0.1, 0.23, 0.02],
  extra3: [0.1, 0.23, 0.02],
};
export class CharmScene {
  renderer: T.WebGLRenderer;
  scene = new T.Scene();
  camera = new T.OrthographicCamera(-0.46, 0.46, 0.69, -0.69, 0.01, 10);
  world!: R.World;
  objects = new Map<Instance, T.Group>();
  bodies = new Map<Instance, R.RigidBody>();
  links: { mesh: T.Group; body: R.RigidBody }[] = [];
  private tethers = new Map<
    Instance,
    { anchor: T.Vector3; attachment: T.Vector3; links: T.Group[] }
  >();
  private resources: T.Object3D[] = [];
  private materials: T.Material[] = [];
  private frame = 0;
  private last = 0;
  private accumulator = 0;
  private disposed = false;
  private ready = false;
  private water?: T.Group;
  private surface?: T.Group;
  private waterPlane = new T.Plane(new T.Vector3(0, -1, 0), 0);
  private targetFill = 0;
  private currentFill = 0;
  private environment?: T.WebGLRenderTarget;
  private observer: ResizeObserver;
  private grabbed?: Instance;
  private options: SceneOptions;
  private hovered?: Instance;
  private rest = new Map<R.RigidBody, { x: number; y: number; z: number }>();
  private restRotations = new Map<R.RigidBody, T.Quaternion>();
  private quietSince = 0;
  private lastGust = 0;
  constructor(
    private host: HTMLElement,
    options: SceneOptions,
  ) {
    this.options = options;
    this.renderer = new T.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "low-power",
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.localClippingEnabled = true;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.85;
    host.append(this.renderer.domElement);
    this.camera.position.set(0, 0, 3);
    this.camera.lookAt(0, 0, 0);
    const pixels = new Float32Array(128 * 64 * 4);
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 128; x++) {
        const v =
          (x > 12 && x < 27 && y > 12 && y < 54) ||
          (x > 80 && x < 88 && y > 6 && y < 57)
            ? 4
            : 0.15;
        pixels.set([v, v, v, 1], (y * 128 + x) * 4);
      }
    const texture = new T.DataTexture(
      pixels,
      128,
      64,
      T.RGBAFormat,
      T.FloatType,
    );
    texture.mapping = T.EquirectangularReflectionMapping;
    texture.needsUpdate = true;
    const pmrem = new T.PMREMGenerator(this.renderer);
    this.environment = pmrem.fromEquirectangular(texture);
    this.scene.environment = this.environment.texture;
    pmrem.dispose();
    texture.dispose();
    this.scene.add(new T.HemisphereLight(0xffffff, 0x35454f, 1.3));
    for (const x of [-2, 2]) {
      const l = new T.DirectionalLight(0xffffff, 2);
      l.position.set(x, 3, 4);
      this.scene.add(l);
    }
    this.observer = new ResizeObserver(() => {
      this.renderer.setSize(host.clientWidth, host.clientHeight);
      const halfHeight = (0.46 * host.clientHeight) / host.clientWidth;
      this.camera.top = halfHeight;
      this.camera.bottom = -halfHeight;
      this.camera.updateProjectionMatrix();
      this.wake();
    });
    this.observer.observe(host);
    this.renderer.domElement.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      if (this.disposed) return;
      this.options.onStatus(
        "Graphics unavailable. Use Controls or Retry graphics.",
      );
      cancelAnimationFrame(this.frame);
    });
    document.addEventListener("visibilitychange", this.visibility);
    void this.initialize().catch((e) => {
      if (!this.disposed)
        this.options.onStatus(`Graphics unavailable: ${e.message}`);
    });
  }
  private visibility = () => {
    this.last = 0;
    this.accumulator = 0;
    if (document.hidden) {
      this.stop();
      cancelAnimationFrame(this.frame);
    } else this.wake();
  };
  private async load(name: string) {
    const def = charmById(name);
    const loader = new GLTFLoader();
    const result = name.startsWith("upload-")
      ? await loader.parseAsync(await assetBytes(name), "")
      : await loader.loadAsync(`./${def?.model ?? `models/${name}.glb`}`);
    const source = result.scene;
    this.resources.push(source);
    const inner = new T.Group();
    inner.add(source);
    if (def) inner.rotation.set(...(def.rotation as [number, number, number]));
    if (name === "chain-link") inner.rotation.y = Math.PI / 2;
    if (name === "duck") inner.rotation.y = -Math.PI / 2;
    inner.updateMatrixWorld(true);
    const box = new T.Box3().setFromObject(inner);
    const dimensions = box.getSize(new T.Vector3());
    inner.position.sub(box.getCenter(new T.Vector3()));
    const normalized = new T.Group();
    normalized.add(inner);
    normalized.scale.setScalar(
      1 / Math.max(dimensions.x, dimensions.y, dimensions.z),
    );
    const root = new T.Group();
    root.add(normalized);
    return root;
  }
  private material(root: T.Object3D, kind: string) {
    if (kind.startsWith("upload-") || charmById(kind)?.preserveMaterials) return;
    root.traverse((n) => {
      if (!(n instanceof T.Mesh)) return;
      const old = Array.isArray(n.material) ? n.material[0] : n.material;
      let m: T.MeshStandardMaterial;
      if (kind === "glass")
        m = new T.MeshPhysicalMaterial({
          color: "#779ead",
          roughness: 0.08,
          metalness: 0,
          transparent: true,
          opacity: 0.45,
          transmission: 0.4,
          thickness: 0.015,
          ior: 1.45,
          depthWrite: false,
          side: T.FrontSide,
          clearcoat: 1,
        });
      else if (kind === "water")
        m = new T.MeshPhysicalMaterial({
          color: "#128ddc",
          roughness: 0.13,
          metalness: 0.05,
          clearcoat: 1,
          clippingPlanes: [this.waterPlane],
        });
      else if (kind === "surface")
        m = new T.MeshPhysicalMaterial({
          color: "#6bdcff",
          roughness: 0.14,
          metalness: 0.1,
          clearcoat: 1,
        });
      else {
        m = old.clone();
        if (["hoop", "tag", "chain-link", "chain"].includes(kind)) {
          m.metalness = 1;
          m.roughness = 0.16;
        } else {
          m.metalness = kind === "car" ? 0.3 : 0;
          m.roughness = kind === "duck" ? 0.3 : 0.55;
        }
      }
      if (kind === "glass" || kind === "cap") {
        if (kind === "cap") {
          m = new T.MeshStandardMaterial({
            color: "#cbd0d3",
            metalness: 1,
            roughness: 0.18,
          });
        }
        m.onBeforeCompile = (shader) => {
          shader.vertexShader =
            "varying float sourceY;\n" +
            shader.vertexShader.replace(
              "#include <begin_vertex>",
              "#include <begin_vertex>\nsourceY=position.y;",
            );
          shader.fragmentShader =
            "varying float sourceY;\n" +
            shader.fragmentShader.replace(
              "#include <clipping_planes_fragment>",
              `#include <clipping_planes_fragment>\nif(sourceY ${kind === "cap" ? "<" : ">"} 0.28) discard;`,
            );
        };
      }
      this.materials.push(m);
      n.material = m;
    });
  }
  private async initialize() {
    await (rapierReady ??= R.init());
    if (this.disposed) return;
    this.world = new R.World({ x: 0, y: 0, z: 0 });
    this.world.timestep = 1 / 60;
    const hoopBody = this.world.createRigidBody(
      R.RigidBodyDesc.fixed().setTranslation(0, 0.4, 0),
    );
    for (let i = 0; i < 20; i++) {
      const angle = (i / 20) * Math.PI * 2;
      this.world.createCollider(
        R.ColliderDesc.ball(0.013)
          .setCollisionGroups(hoopCollisionGroups)
          .setTranslation(
            Math.cos(angle) * 0.19 * this.options.appearance.scales.hoop,
            Math.sin(angle) * 0.19 * this.options.appearance.scales.hoop,
            0,
          ),
        hoopBody,
      );
    }
    this.world.createCollider(
      R.ColliderDesc.ball(
        0.11 * this.options.appearance.scales.hoop,
      ).setCollisionGroups(hoopCollisionGroups),
      hoopBody,
    );
    const slots = this.options.settings.charms?.slots;
    const assetName = (id: Instance): string =>
      id === "bottle"
        ? "bottle-shell"
        : slotIds.includes(id as SlotId)
          ? (slots?.[id as SlotId]?.asset ??
            (id === "companion"
              ? this.options.settings.decoration
              : this.options.settings.extras[Number(id.at(-1))]) ??
            "duck")
          : id;
    const keys: Instance[] = ["hoop", "bottle", "notebook"];
    for (const id of slotIds)
      if (
        slots
          ? slots[id].asset
          : id === "companion" ||
            this.options.settings.extras[Number(id.at(-1))]
      )
        keys.push(id);
    const templates = new Map<string, T.Group>();
    for (const name of [
      ...new Set([
        "chain-link",
        "bottle-shell",
        "liquid",
        "liquid-surface",
        ...keys.map(assetName),
      ]),
    ])
      try {
        templates.set(name, await this.load(name));
      } catch (error) {
        if (
          [
            "chain-link",
            "bottle-shell",
            "liquid",
            "liquid-surface",
            "hoop",
            "notebook",
          ].includes(name)
        )
          throw error;
        this.options.onStatus(
          `Optional charm unavailable: ${name}. Core controls remain available.`,
        );
      }
    if (this.disposed) {
      this.release();
      return;
    }
    for (const id of keys) {
      const a = this.options.appearance;
      const template = templates.get(assetName(id));
      if (!template) continue;
      const root = template.clone(true);
      const slot = slotIds.includes(id as SlotId)
        ? slots?.[id as SlotId]
        : undefined;
      if (slot)
        root.children[0].rotation.set(
          ...(slot.rotation.map((v) => (v * Math.PI) / 180) as [
            number,
            number,
            number,
          ]),
        );
      const extent =
        (id === "tag" &&
        [
          ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
            this.options.settings.name,
          ),
        ].length > 16
          ? 0.38
          : size[id]) * a.scales[id];
      root.scale.setScalar(extent);
      if (id === "tag" && extent > 0.3 * a.scales[id]) root.scale.y *= 0.58;
      this.material(root, id === "bottle" ? "glass" : assetName(id));
      if (assetName(id) === "tag") {
        const label = tagLettering(
          (slot?.name ?? this.options.settings.name) || "Your name",
          slot?.nameStyle ?? this.options.settings.nameStyle,
          slot?.nameColor ?? this.options.settings.neonColor,
        );
        root.add(label);
        this.resources.push(label);
      }
      this.objects.set(id, root);
      this.scene.add(root);
      const [x, y, z] =
        id === "hoop" ? anchors[id] : rimAnchor(anchors[id], a.scales.hoop);
      if (id === "hoop") {
        root.position.set(x, y, z);
        continue;
      }
      const count = a.links[id],
        step = 0.03;
      root.updateMatrixWorld(true);
      const attachment = slot
        ? new T.Vector3(...slot.attachment).multiplyScalar(extent)
        : new T.Vector3(0, new T.Box3().setFromObject(root).max.y, 0);
      const attachmentHeight = attachment.y;
      const points = tetherPoints(id, count, [x, y, z]),
        end = points[count];
      const cy = end[1] - attachmentHeight;
      const body = this.world.createRigidBody(
        R.RigidBodyDesc.dynamic()
          .setTranslation(end[0] - attachment.x, cy, end[2] - attachment.z)
          .setLinearDamping(0.55)
          .setAngularDamping(0.75)
          .setCanSleep(false)
          .setCcdEnabled(true),
      );
      const collisionIndex = this.bodies.size;
      this.bodies.set(id, body);
      this.rest.set(body, {
        x: end[0] - attachment.x,
        y: cy,
        z: z - attachment.z,
      });
      this.world.createCollider(
        R.ColliderDesc.ball(extent * (id === "bottle" ? 0.17 : 0.35))
          .setMass(0.1)
          .setCollisionGroups(charmCollisionGroups(collisionIndex))
          .setRestitution(0.08)
          .setFriction(0.5),
        body,
      );
      const tether = {
        anchor: new T.Vector3(x, y, z),
        attachment: attachment.clone(),
        links: [] as T.Group[],
      };
      this.tethers.set(id, tether);
      let previous = this.world.createRigidBody(
        R.RigidBodyDesc.fixed().setTranslation(x, y, z),
      );
      for (let j = 0; j < count; j++) {
        const link = templates.get("chain-link")!.clone(true);
        link.scale.setScalar(0.04);
        this.material(link, "chain-link");
        this.scene.add(link);
        const from = new T.Vector3(...points[j]),
          to = new T.Vector3(...points[j + 1]),
          center = from.clone().add(to).multiplyScalar(0.5),
          orientation = new T.Quaternion().setFromUnitVectors(
            new T.Vector3(0, -1, 0),
            to.clone().sub(from).normalize(),
          );
        const rb = this.world.createRigidBody(
          R.RigidBodyDesc.dynamic()
            .setTranslation(center.x, center.y, center.z)
            .setRotation(orientation)
            .setLinearDamping(2)
            .setAngularDamping(0.75),
        );
        this.world.createCollider(
          R.ColliderDesc.ball(0.006)
            .setMass(0.012)
            .setCollisionGroups(linkCollisionGroups(collisionIndex)),
          rb,
        );
        this.world.createImpulseJoint(
          R.JointData.spherical(
            { x: 0, y: j === 0 ? 0 : -step / 2, z: 0 },
            { x: 0, y: step / 2, z: 0 },
          ),
          previous,
          rb,
          true,
        );
        previous = rb;
        this.links.push({ mesh: link, body: rb });
        tether.links.push(link);
        this.rest.set(rb, { x: center.x, y: center.y, z: center.z });
        this.restRotations.set(rb, orientation);
      }
      this.world.createImpulseJoint(
        R.JointData.spherical(
          { x: 0, y: count ? -step / 2 : 0, z: 0 },
          { x: attachment.x, y: attachmentHeight, z: attachment.z },
        ),
        previous,
        body,
        true,
      );
      if (id === "bottle") {
        const cap = root.clone(true);
        cap.scale.setScalar(1);
        this.material(cap, "cap");
        root.add(cap);
        this.water = templates.get("liquid")!.clone(true);
        this.water.scale.set(0.49, 0.52, 0.49);
        this.water.position.y = -0.185;
        root.add(this.water);
        this.material(this.water, "water");
        this.surface = templates.get("liquid-surface")!.clone(true);
        this.surface.scale.set(0.303, 0.05, 0.303);
        root.add(this.surface);
        this.material(this.surface, "surface");
      }
    }
    this.ready = true;
    this.currentFill = this.targetFill = this.options.fill;
    this.stop();
  }
  update(options: SceneOptions) {
    const changed =
      options.fill !== this.targetFill ||
      options.glow !== this.options.glow ||
      options.reduced !== this.options.reduced ||
      options.editing !== this.options.editing ||
      options.appearance.motion !== this.options.appearance.motion;
    this.options = options;
    this.targetFill = options.fill;
    if (changed) {
      if (options.reduced || options.editing || !options.appearance.motion)
        this.stop();
      else this.wake();
    }
  }
  pick(x: number, y: number): Instance | undefined {
    const rect = this.host.getBoundingClientRect();
    const ray = new T.Raycaster();
    ray.setFromCamera(
      new T.Vector2(
        ((x - rect.left) / rect.width) * 2 - 1,
        1 - ((y - rect.top) / rect.height) * 2,
      ),
      this.camera,
    );
    for (const hit of ray.intersectObjects([...this.objects.values()], true)) {
      for (const [id, root] of this.objects) {
        let n: T.Object3D | null = hit.object;
        while (n) {
          if (n === root) return id;
          n = n.parent;
        }
      }
    }
    return undefined;
  }
  hover(id?: Instance) {
    this.hovered = id;
  }
  grab(id: Instance) {
    this.quietSince = 0;
    if (this.grabbed && this.grabbed !== id) this.releaseGrab();
    this.grabbed = id;
    const body = this.bodies.get(id);
    if (body) {
      body.setBodyType(R.RigidBodyType.KinematicPositionBased, true);
      body.setNextKinematicTranslation(body.translation());
      body.setNextKinematicRotation(body.rotation());
    }
  }
  drag(dx: number, dy: number) {
    const b = this.bodies.get(this.grabbed!);
    if (!b) return;
    const p = b.translation();
    b.setNextKinematicTranslation({
      x: Math.max(
        -0.38,
        Math.min(0.38, p.x + (dx * 0.92) / this.host.clientWidth),
      ),
      y: Math.max(
        -0.55,
        Math.min(0.18, p.y - (dy * 1.38) / this.host.clientHeight),
      ),
      z: p.z,
    });
    this.wake();
  }
  private constrainTethers() {
    for (const [id, tether] of this.tethers) {
      const body = this.bodies.get(id)!,
        q = body.rotation();
      const offset = tether.attachment
        .clone()
        .applyQuaternion(new T.Quaternion(q.x, q.y, q.z, q.w));
      const p = body.translation(),
        endpoint = new T.Vector3(p.x, p.y, p.z).add(offset);
      const direction = endpoint.clone().sub(tether.anchor),
        reach = tether.links.length * 0.03;
      if (direction.length() > reach) {
        direction.setLength(reach);
        const corrected = tether.anchor.clone().add(direction).sub(offset);
        body.setTranslation(corrected, false);
        if (id === this.grabbed) body.setNextKinematicTranslation(corrected);
        const velocity = body.linvel(),
          v = new T.Vector3(velocity.x, velocity.y, velocity.z),
          normal = direction.normalize();
        const outward = v.dot(normal);
        if (outward > 0) {
          v.addScaledVector(normal, -outward);
          body.setLinvel(v, false);
        }
      }
    }
  }
  releaseGrab(render = true) {
    if (this.grabbed) {
      const b = this.bodies.get(this.grabbed);
      if (b) {
        b.setBodyType(R.RigidBodyType.Dynamic, true);
        b.setLinvel({ x: 0, y: 0, z: 0 }, true);
        b.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
    this.grabbed = undefined;
    if (render) this.wake();
  }
  gust(dx = 1, dy = 0) {
    if (
      this.options.reduced ||
      this.options.editing ||
      !this.options.appearance.motion ||
      !this.options.appearance.wind
    )
      return;
    this.quietSince = 0;
    const now = performance.now();
    if (now - this.lastGust < 16) return;
    this.lastGust = now;
    for (const [id, b] of this.bodies) {
      if (id === this.grabbed) continue;
      b.wakeUp();
      b.applyTorqueImpulse(
        { x: dy * 0.00000006, y: dx * 0.0000001, z: -dx * 0.00000004 },
        true,
      );
      b.applyImpulse(
        {
          x:
            Math.max(-0.012, Math.min(0.012, dx * 0.00002)) *
            this.options.appearance.strength,
          y: Math.max(-0.004, Math.min(0.004, -dy * 0.000008)),
          z: 0.0003 * this.options.appearance.strength,
        },
        true,
      );
    }
    this.wake();
  }
  stop(render = true) {
    this.releaseGrab(false);
    for (const b of [
      ...this.bodies.values(),
      ...this.links.map((l) => l.body),
    ]) {
      b.setLinvel({ x: 0, y: 0, z: 0 }, false);
      b.setAngvel({ x: 0, y: 0, z: 0 }, false);
      b.sleep();
    }
    this.last = 0;
    this.accumulator = 0;
    if (render) this.wake();
  }
  resetPose() {
    this.releaseGrab(false);
    for (const [b, p] of this.rest) {
      b.setTranslation(p, false);
      b.setRotation(
        this.restRotations.get(b) ?? { x: 0, y: 0, z: 0, w: 1 },
        false,
      );
    }
    for (const b of [
      ...this.bodies.values(),
      ...this.links.map((l) => l.body),
    ]) {
      b.setLinvel({ x: 0, y: 0, z: 0 }, false);
      b.setAngvel({ x: 0, y: 0, z: 0 }, false);
      b.sleep();
    }
    this.wake();
  }
  wake() {
    if (this.disposed || document.hidden) return;
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(this.draw);
  }
  private draw = (now: number) => {
    if (this.disposed || !this.ready) return;
    if (this.last && now - this.last < 15) {
      this.frame = requestAnimationFrame(this.draw);
      return;
    }
    const dt = this.last ? Math.min((now - this.last) / 1000, 0.05) : 1 / 60;
    this.last = now;
    const motion =
      !this.options.reduced &&
      !this.options.editing &&
      this.options.appearance.motion;
    let active = false;
    if (motion) {
      this.accumulator += dt;
      while (this.accumulator >= 1 / 60) {
        for (const [id, b] of this.bodies) {
          if (b.isSleeping()) continue;
          const p = b.translation();
          const q = b.rotation();
          if (id === "bottle") {
            const rotation = new T.Euler().setFromQuaternion(
              new T.Quaternion(q.x, q.y, q.z, q.w),
            );
            if (
              Math.abs(rotation.x) > 0.12 ||
              Math.abs(rotation.z) > 0.12 ||
              Math.abs(rotation.y) > 0.2
            ) {
              rotation.x = T.MathUtils.clamp(rotation.x, -0.12, 0.12);
              rotation.z = T.MathUtils.clamp(rotation.z, -0.12, 0.12);
              rotation.y = T.MathUtils.clamp(rotation.y, -0.2, 0.2);
              const bounded = new T.Quaternion().setFromEuler(rotation);
              b.setRotation(bounded, false);
              b.setAngvel({ x: 0, y: 0, z: 0 }, false);
            }
          }
          const sign = q.w < 0 ? -1 : 1;
          b.applyTorqueImpulse(
            {
              x: -q.x * sign * 0.0000044,
              y: -q.y * sign * 0.0000044,
              z: -q.z * sign * 0.0000044,
            },
            false,
          );
          const home = this.rest.get(b)!;
          b.applyImpulse(
            {
              x: (home.x - p.x) * 0.0008,
              y: (home.y - p.y) * 0.0008,
              z: (home.z - p.z) * 0.0008,
            },
            false,
          );
          if (!Number.isFinite(p.x + p.y + p.z) || p.y < -0.6 || p.y > 0.35) {
            this.resetPose();
            break;
          }
          if (Math.abs(p.x) > 0.39 || Math.abs(p.z) > 0.1) {
            b.setTranslation(
              {
                x: Math.max(-0.39, Math.min(0.39, p.x)),
                y: p.y,
                z: Math.max(-0.1, Math.min(0.1, p.z)),
              },
              true,
            );
            b.setLinvel({ x: 0, y: 0, z: 0 }, true);
          }
          if (id === this.grabbed) b.setLinvel({ x: 0, y: 0, z: 0 }, false);
        }
        this.world.step();
        this.constrainTethers();
        this.accumulator -= 1 / 60;
      }
    }
    if (motion && !this.grabbed) {
      const quiet = [...this.bodies].every(([id, b]) => {
        const p = b.translation(),
          h = this.rest.get(b)!,
          v = b.linvel(),
          w = b.angvel(),
          q = b.rotation();
        return (
          Math.hypot(v.x, v.y, v.z) < 0.004 &&
          Math.hypot(w.x, w.y, w.z) < 0.04 &&
          Math.hypot(p.x - h.x, p.y - h.y, p.z - h.z) < 0.012 &&
          Math.abs(q.w) > 0.998
        );
      });
      if (quiet) {
        this.quietSince ||= now;
        if (now - this.quietSince > 1000) {
          this.host.dataset.settleMs = String(Math.round(now - this.lastGust));
          this.stop(false);
        }
      } else this.quietSince = 0;
    }
    this.constrainTethers();
    for (const [id, b] of this.bodies) {
      const root = this.objects.get(id)!;
      const p = b.translation();
      root.position.set(p.x, p.y, p.z);
      const q = b.rotation();
      root.quaternion.set(q.x, q.y, q.z, q.w);
      active ||= motion && !b.isSleeping();
    }
    // Physics can transiently stretch joints during kinematic drags. Display links
    // from a bounded endpoint path so the visible assembly never tears apart.
    for (const [id, tether] of this.tethers) {
      const root = this.objects.get(id)!;
      const endpoint = tether.attachment
        .clone()
        .applyQuaternion(root.quaternion)
        .add(root.position);
      const points = connectedTether(
        tether.anchor.toArray(),
        endpoint.toArray(),
        tether.links.length,
      );
      tether.links.forEach((mesh, i) => {
        const from = new T.Vector3(...points[i]),
          to = new T.Vector3(...points[i + 1]);
        mesh.position.copy(from).add(to).multiplyScalar(0.5);
        mesh.quaternion.setFromUnitVectors(
          new T.Vector3(0, -1, 0),
          to.sub(from).normalize(),
        );
        mesh.rotateY(i % 2 ? Math.PI / 2 : 0);
      });
    }
    this.currentFill = this.options.reduced
      ? this.targetFill
      : T.MathUtils.lerp(
          this.currentFill,
          this.targetFill,
          Math.min(1, dt * 8),
        );
    if (Math.abs(this.currentFill - this.targetFill) < 0.001)
      this.currentFill = this.targetFill;
    active ||= this.currentFill !== this.targetFill;
    const bottle = this.objects.get("bottle");
    if (bottle && this.water && this.surface) {
      const level = -0.445 + 0.52 * fillHeight(this.currentFill);
      this.surface.position.y = level;
      this.water.visible = this.surface.visible = this.currentFill > 0;
      const worldLevel = bottle.localToWorld(new T.Vector3(0, level, 0));
      this.waterPlane.constant = worldLevel.y;
      this.surface.quaternion.copy(bottle.quaternion).invert();
      if (this.options.glow) {
        const pulse = this.options.reduced
          ? 0.2
          : 0.2 + 0.15 * Math.sin(now / 636);
        this.water.traverse((n) => {
          if (n instanceof T.Mesh) {
            n.material.emissive.set("#159aff");
            n.material.emissiveIntensity = pulse;
          }
        });
        active ||= !this.options.reduced;
      } else
        this.water.traverse((n) => {
          if (n instanceof T.Mesh) n.material.emissiveIntensity = 0;
        });
    }
    this.scene.updateMatrixWorld(true);
    for (const [id, root] of this.objects) {
      const v = root.getWorldPosition(new T.Vector3()).project(this.camera);
      if (id === "bottle") {
        root.localToWorld(v.set(0, -0.54, 0));
        v.project(this.camera);
      }
      this.options.onPosition(
        id,
        ((v.x + 1) / 2) * this.host.clientWidth,
        ((1 - v.y) / 2) * this.host.clientHeight,
      );
    }
    this.host.dataset.frames = String(
      Number(this.host.dataset.frames ?? 0) + 1,
    );
    this.host.dataset.settled = String(!active);
    this.renderer.render(this.scene, this.camera);
    if (active) this.frame = requestAnimationFrame(this.draw);
    else this.last = 0;
  };
  private release() {
    const geometries = new Set<T.BufferGeometry>(),
      textures = new Set<T.Texture>(),
      mats = new Set<T.Material>(this.materials);
    for (const root of this.resources)
      root.traverse((n) => {
        if (n instanceof T.Mesh || n instanceof T.Sprite) {
          if (n instanceof T.Mesh) geometries.add(n.geometry);
          for (const m of Array.isArray(n.material) ? n.material : [n.material])
            mats.add(m);
        }
      });
    for (const m of mats) {
      for (const v of Object.values(m))
        if (v instanceof T.Texture) textures.add(v);
      m.dispose();
    }
    for (const t of textures) {
      t.dispose();
      if (t.source.data instanceof ImageBitmap) t.source.data.close();
    }
    for (const g of geometries) g.dispose();
  }
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    document.removeEventListener("visibilitychange", this.visibility);
    this.release();
    this.environment?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.world?.free();
  }
}
