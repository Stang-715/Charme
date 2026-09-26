import { tagLettering } from "./nameTag";
import * as T from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
let renderer: T.WebGLRenderer | undefined,
  scene: T.Scene | undefined,
  camera: T.PerspectiveCamera | undefined,
  root: T.Group | undefined;
let yaw = 0,
  pitch = 0,
  distance = 2.6;
self.onmessage = async (e: MessageEvent) => {
  const value = e.data;
  if (value.type === "camera" && camera && renderer && scene) {
    if (value.command === "reset") {
      yaw = 0;
      pitch = 0;
      distance = 2.6;
    } else if (value.command === "left") yaw -= 0.3;
    else if (value.command === "right") yaw += 0.3;
    else if (value.command === "in") distance = Math.max(1.4, distance - 0.2);
    else if (value.command === "out") distance = Math.min(4, distance + 0.2);
    else {
      yaw += (value.dx || 0) * 0.01;
      pitch = Math.max(-1.2, Math.min(1.2, pitch + (value.dy || 0) * 0.01));
    }
    camera.position.set(
      distance * Math.sin(yaw) * Math.cos(pitch),
      distance * Math.sin(pitch),
      distance * Math.cos(yaw) * Math.cos(pitch),
    );
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
    return;
  }
  if (value.type === "pick" && root && camera) {
    const ray = new T.Raycaster();
    ray.setFromCamera(new T.Vector2(value.x, value.y), camera);
    const hit = ray
      .intersectObject(root, true)
      .find((hit) => hit.object instanceof T.Mesh);
    if (hit)
      self.postMessage({
        type: "attachment",
        request: value.request,
        point: hit.point.toArray(),
      });
    return;
  }
  if (value.type !== "preview") return;
  const { bytes, rotation, baseRotation, attachment, request, canvas } = value;
  try {
    // Fail before GLTFLoader can resolve any network resource from untrusted metadata.
    const view = new DataView(bytes);
    if (
      bytes.byteLength > 20_000_000 ||
      bytes.byteLength < 28 ||
      view.getUint32(0, true) !== 0x46546c67 ||
      view.getUint32(4, true) !== 2 ||
      view.getUint32(8, true) !== bytes.byteLength
    )
      throw Error("Invalid self-contained GLB");
    const metadata = JSON.parse(
      new TextDecoder().decode(
        new Uint8Array(bytes, 20, view.getUint32(12, true)),
      ),
    );
    if (
      [...(metadata.buffers || []), ...(metadata.images || [])].some(
        (r: any) => r.uri,
      ) ||
      metadata.skins?.length ||
      (metadata.meshes || []).some((m: any) =>
        m.primitives.some((p: any) => p.targets?.length),
      ) ||
      metadata.extensionsRequired?.length
    )
      throw Error(
        "Preview requires a self-contained static GLB without required extensions",
      );
    const gltf = await new GLTFLoader().parseAsync(bytes, "");
    renderer = new T.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setSize(320, 300, false);
    renderer.setPixelRatio(Math.min(value.pixelRatio ?? 1, 2));
    scene = new T.Scene();
    const pmrem = new T.PMREMGenerator(renderer);
    const environment = new RoomEnvironment();
    scene.environment = pmrem.fromScene(environment).texture;
    environment.dispose();
    pmrem.dispose();
    renderer.toneMapping = T.ACESFilmicToneMapping;
    camera = new T.PerspectiveCamera(35, 320 / 300, 0.01, 100);
    camera.position.set(0, 0, 2.6);
    camera.lookAt(0, 0, 0);
    const model = new T.Group();
    model.add(gltf.scene);
    if (baseRotation)
      model.rotation.set(...(baseRotation as [number, number, number]));
    model.updateMatrixWorld(true);
    const bounds = new T.Box3().setFromObject(model),
      size = bounds.getSize(new T.Vector3());
    model.position.sub(bounds.getCenter(new T.Vector3()));
    const normalized = new T.Group();
    normalized.add(model);
    normalized.scale.setScalar(1 / Math.max(size.x, size.y, size.z));
    root = new T.Group();
    root.add(normalized);
    root.rotation.set(
      ...(rotation.map((v: number) => (v * Math.PI) / 180) as [
        number,
        number,
        number,
      ]),
    );
    if (value.nameTag)
      root.add(
        tagLettering(
          value.nameTag.name || "Your name",
          value.nameTag.style,
          value.nameTag.color,
        ),
      );
    scene.add(root, new T.HemisphereLight(0xffffff, 0x536778, 3));
    const light = new T.DirectionalLight(0xffffff, 4);
    light.position.set(-2, 3, 4);
    scene.add(light);
    scene.updateMatrixWorld(true);
    renderer.render(scene, camera);
    const target = new T.Vector3(...attachment),
      nearest = new T.Vector3(),
      triangle = new T.Triangle(),
      highest = new T.Vector3(),
      topTarget = new T.Vector3(0, 0.5, 0),
      topCandidate = new T.Vector3();
    let distance = Infinity,
      topDistance = Infinity;
    root.traverse((node) => {
      if (!(node instanceof T.Mesh)) return;
      const positions = node.geometry.getAttribute("position"),
        index = node.geometry.index;
      for (let i = 0; i < (index?.count ?? positions.count); i += 3) {
        for (let j = 0; j < 3; j++) {
          const p = [triangle.a, triangle.b, triangle.c][j];
          p.fromBufferAttribute(
            positions,
            index ? index.getX(i + j) : i + j,
          ).applyMatrix4(node.matrixWorld);
        }
        triangle.closestPointToPoint(topTarget, topCandidate);
        const d = topCandidate.distanceToSquared(topTarget);
        if (d < topDistance) {
          topDistance = d;
          highest.copy(topCandidate);
        }
        triangle.closestPointToPoint(target, nearest);
        distance = Math.min(distance, nearest.distanceTo(target));
      }
    });
    const marker = target.project(camera);
    self.postMessage({
      type: "preview-ready",
      request,
      attachmentValid: distance < 0.035,
      recommended: highest.toArray(),
      marker: [(marker.x + 1) * 160, (1 - marker.y) * 150],
    });
  } catch (error) {
    renderer?.dispose();
    self.postMessage({ type: "preview-error", request, error: String(error) });
  }
};
