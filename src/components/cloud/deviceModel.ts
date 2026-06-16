import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";

/**
 * Shared, cached loader for the hero device GLB. The file is fetched and
 * draco-decoded once per session; every scene clones the parsed scene graph
 * so transforms/visibility stay isolated per consumer.
 *
 * The GLB ships a single clean "BestlyGunmetal" PBR material on two nodes
 * ("base" + "lid"). The original Tripo export baked a noisy color/roughness
 * texture onto the lid and patched its top with a broken self-overlapping
 * "lid_top_flat" fill — both produced shimmering checkerboard artifacts on
 * scroll. That bake + fill were stripped in Blender: textures removed, the
 * broken top replaced with one clean capped panel, all surfaces unified to
 * gunmetal. No runtime material fix-ups needed anymore.
 */
let gltfPromise: Promise<GLTF> | null = null;

export function loadDeviceGLTF(): Promise<GLTF> {
  if (!gltfPromise) {
    const draco = new DRACOLoader();
    draco.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/");
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
    gltfPromise = loader.loadAsync("/models/device-web-split.glb");
  }
  return gltfPromise;
}
