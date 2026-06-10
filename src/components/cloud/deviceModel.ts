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
    gltfPromise = loader.loadAsync("/models/device-web-split.glb");
  }
  return gltfPromise;
}
