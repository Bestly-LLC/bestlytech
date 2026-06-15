import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";

/**
 * Shared, cached loader for the hero device GLB. The file is fetched and
 * draco-decoded once per session; every scene clones the parsed scene graph
 * so transforms/visibility stay isolated per consumer.
 */
let gltfPromise: Promise<GLTF> | null = null;

export function loadDeviceGLTF(): Promise<GLTF> {
  if (!gltfPromise) {
    const draco = new DRACOLoader();
    draco.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/");
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
    gltfPromise = loader.loadAsync("/models/device-web-split.glb").then((gltf) => {
      // The lid has two coplanar top surfaces: the original Tripo face (carries
      // a baked, noisy texture) and a clean flat plate ("lid_top_flat") laid
      // over it to hide that noise. Coplanar = z-fighting that shimmers as the
      // lid angle changes on scroll. Pull the flat plate forward in the depth
      // test (polygon offset) so it always wins — the noisy face never peeks
      // through. Applied once on the cached parse; clones inherit it.
      gltf.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((m) => {
          if (m && m.name === "lid_top_flat") {
            m.polygonOffset = true;
            m.polygonOffsetFactor = -4;
            m.polygonOffsetUnits = -4;
            mesh.renderOrder = 1;
            m.needsUpdate = true;
          }
        });
      });
      return gltf;
    });
  }
  return gltfPromise;
}
