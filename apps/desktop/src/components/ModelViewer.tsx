import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";

/**
 * Interactive preview of a 3D file an agent produced (glTF/GLB, OBJ, STL, PLY): drag to orbit,
 * scroll to zoom. Turns slowly until you touch it; stays still with reduced motion.
 */
export default function ModelViewer({ url, name, height = 220 }: { url: string; name: string; height?: number }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.classList.contains("reduce-motion");
    const dark = document.documentElement.dataset.theme !== "light";
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
    scene.add(new THREE.HemisphereLight(0xffffff, dark ? 0x222428 : 0xb8bcc4, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.8);
    key.position.set(3, 5, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.6);
    rim.position.set(-4, 2, -3);
    scene.add(rim);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = !still;
    controls.autoRotateSpeed = 1.2;
    controls.addEventListener("start", () => { controls.autoRotate = false; });

    const material = new THREE.MeshStandardMaterial({ color: dark ? 0xd9dce2 : 0x9aa0aa, roughness: 0.55, metalness: 0.05 });
    const ext = name.toLowerCase().split(".").pop() || "";
    const frame = (object: THREE.Object3D) => {
      const box = new THREE.Box3().setFromObject(object);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      object.position.sub(center);
      const radius = Math.max(size.x, size.y, size.z) || 1;
      camera.near = radius / 100; camera.far = radius * 100;
      camera.position.set(radius * 1.45, radius * 1.0, radius * 1.8);   // whole model in view, a little from above
      camera.updateProjectionMatrix();
      controls.target.set(0, 0, 0);
      const grid = new THREE.GridHelper(radius * 3, 12, dark ? 0x3a3d44 : 0xc8ccd3, dark ? 0x26282d : 0xe1e4e9);
      grid.position.y = -size.y / 2;
      scene.add(grid);
      scene.add(object);
      setState("ready");
    };
    const fail = (e: unknown) => { setError(e instanceof Error ? e.message : "Could not open this model."); setState("error"); };

    if (ext === "glb" || ext === "gltf") new GLTFLoader().load(url, (g) => frame(g.scene), undefined, fail);
    else if (ext === "obj") new OBJLoader().load(url, (o) => { o.traverse((c) => { if ((c as THREE.Mesh).isMesh) (c as THREE.Mesh).material = material; }); frame(o); }, undefined, fail);
    else if (ext === "stl" || ext === "ply") {
      const loader = ext === "stl" ? new STLLoader() : new PLYLoader();
      loader.load(url, (geometry: THREE.BufferGeometry) => {
        geometry.computeVertexNormals();
        frame(new THREE.Mesh(geometry, material));
      }, undefined, fail);
    } else fail(new Error("Unsupported model type."));

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = `${w}px`;
      renderer.domElement.style.height = `${h}px`;
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    let raf = 0;
    const loop = () => { controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(loop); };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
        mats.forEach((x) => x.dispose());
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [url, name]);

  return (
    <div className="relative w-full overflow-hidden rounded-lg bg-[radial-gradient(ellipse_at_center,var(--surface-2),var(--base))]" style={{ height }}>
      <div ref={host} className="absolute inset-0 cursor-grab active:cursor-grabbing" aria-label={`3D preview of ${name}. Drag to rotate, scroll to zoom.`} role="img" />
      {state === "loading" && <div className="absolute inset-0 flex items-center justify-center text-xs text-ink-3">Loading model…</div>}
      {state === "error" && <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-bad">{error}</div>}
    </div>
  );
}
