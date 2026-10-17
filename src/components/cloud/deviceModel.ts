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
const DEVICE_GLB_URL = "/models/device-web-split.glb";

let gltfPromise: Promise<GLTF> | null = null;
let preloadTag: HTMLLinkElement | null = null;

/**
 * Start the GLB download as early as this route can.
 *
 * The tag used to sit in index.html, where every route paid for it: the file is
 * 2.1 MB and only the cloud page renders it, so the marketing site was shipping
 * a two-megabyte dead weight on /, /about, /products, /cookie-yeti and the rest
 * (and Chrome logged "preloaded but not used" on each one). This page's chunk
 * loads only on /cloud and /in-house-cloud, so calling this from InHouseCloud is
 * the earliest point at which the download is worth starting.
 */
export function preloadDeviceGLB(): void {
  if (typeof document === "undefined" || preloadTag) return;
  preloadTag = document.createElement("link");
  preloadTag.rel = "preload";
  preloadTag.as = "fetch";
  preloadTag.type = "model/gltf-binary";
  preloadTag.crossOrigin = "anonymous";
  preloadTag.href = DEVICE_GLB_URL;
  document.head.appendChild(preloadTag);
}

export function loadDeviceGLTF(): Promise<GLTF> {
  if (!gltfPromise) {
    const draco = new DRACOLoader();
    draco.setDecoderPath("/draco/" /* self-hosted (three 0.160 libs/draco): the site CSP only allows same-origin fetches */);
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
    gltfPromise = loader.loadAsync(DEVICE_GLB_URL);
  }
  return gltfPromise;
}
