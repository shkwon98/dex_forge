import { useEffect, useMemo, useRef, useState } from "react";

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { buildBoneSegments, defaultCameraPosition } from "./handView";


const JOINT_RADIUS = 0.0048;
const ROOT_RADIUS = 0.0072;
const FIXED_TARGET = new THREE.Vector3(0, 0.08, 0);
const LEFT_COLORS = {
  joint: 0x67e8f9,
  jointEmissive: 0x164e63,
  bone: 0xe2e8f0,
  boneEmissive: 0x0f172a,
  rim: 0x67e8f9,
};
const RIGHT_COLORS = {
  joint: 0xf472b6,
  jointEmissive: 0x9d174d,
  bone: 0xfbcfe8,
  boneEmissive: 0x4a044e,
  rim: 0xf472b6,
};


function paletteForHand(focusedHand) {
  return focusedHand === "right" ? RIGHT_COLORS : LEFT_COLORS;
}


function applyPalette(runtime, focusedHand) {
  const palette = paletteForHand(focusedHand);

  runtime.rimLight.color.setHex(palette.rim);
  runtime.jointMeshes.forEach((mesh, index) => {
    if (index === 0) {
      return;
    }
    mesh.material.color.setHex(palette.joint);
    mesh.material.emissive.setHex(palette.jointEmissive);
  });
  runtime.boneMeshes.forEach((mesh) => {
    mesh.material.color.setHex(palette.bone);
    mesh.material.emissive.setHex(palette.boneEmissive);
  });
}


function moveBone(mesh, start, end) {
  const startVector = new THREE.Vector3(start.x, start.y, start.z);
  const endVector = new THREE.Vector3(end.x, end.y, end.z);
  const midpoint = new THREE.Vector3().addVectors(startVector, endVector).multiplyScalar(0.5);
  const direction = new THREE.Vector3().subVectors(endVector, startVector);
  const length = Math.max(direction.length(), 0.0001);

  mesh.visible = true;
  mesh.position.copy(midpoint);
  mesh.scale.set(1, length, 1);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
}


export function ThreeHandViewer({ points, focusedHand }) {
  const hostRef = useRef(null);
  const canvasRef = useRef(null);
  const runtimeRef = useRef(null);
  const targetPointsRef = useRef([]);
  const [renderError, setRenderError] = useState(false);
  const boneSegments = useMemo(() => buildBoneSegments(points?.length ?? 0), [points]);
  const boneSegmentsRef = useRef(boneSegments);

  useEffect(() => {
    boneSegmentsRef.current = boneSegments;
  }, [boneSegments]);

  useEffect(() => {
    if (!hostRef.current || !canvasRef.current) {
      return undefined;
    }
    if (typeof window === "undefined" || /jsdom/i.test(window.navigator.userAgent)) {
      return undefined;
    }

    let animationFrameId = null;
    let resizeObserver = null;

    try {
      const renderer = new THREE.WebGLRenderer({
        canvas: canvasRef.current,
        antialias: true,
        alpha: true,
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;

      const scene = new THREE.Scene();
      scene.fog = new THREE.Fog(0x0b1220, 0.35, 1.4);

      const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 6);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.enablePan = false;
      controls.minDistance = 0.14;
      controls.maxDistance = 1.1;

      const ambient = new THREE.AmbientLight(0xffffff, 0.85);
      const keyLight = new THREE.DirectionalLight(0xffffff, 1.15);
      keyLight.position.set(0.28, 0.42, 0.36);
      const rimLight = new THREE.DirectionalLight(0x67e8f9, 0.55);
      rimLight.position.set(-0.22, 0.18, -0.4);
      scene.add(ambient, keyLight, rimLight);

      const stage = new THREE.Group();
      scene.add(stage);

      const floor = new THREE.Mesh(
        new THREE.CircleGeometry(0.22, 64),
        new THREE.MeshBasicMaterial({
          color: 0x0f172a,
          transparent: true,
          opacity: 0.4,
        }),
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -0.018;
      stage.add(floor);

      const grid = new THREE.GridHelper(0.32, 8, 0x7dd3fc, 0x334155);
      grid.position.y = -0.015;
      stage.add(grid);

      const axes = new THREE.AxesHelper(0.08);
      stage.add(axes);

      const jointGroup = new THREE.Group();
      const jointMeshes = Array.from({ length: 25 }, (_, index) => {
        const mesh = new THREE.Mesh(
          new THREE.SphereGeometry(index === 0 ? ROOT_RADIUS : JOINT_RADIUS, 18, 18),
          new THREE.MeshStandardMaterial({
            color: index === 0 ? 0xf8fafc : 0x67e8f9,
            emissive: index === 0 ? 0x1e293b : 0x164e63,
            roughness: 0.28,
            metalness: 0.16,
          }),
        );
        jointGroup.add(mesh);
        return mesh;
      });
      stage.add(jointGroup);

      const boneGroup = new THREE.Group();
      const boneMeshes = Array.from({ length: 24 }, () => {
        const mesh = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0022, 0.0029, 1, 12),
          new THREE.MeshStandardMaterial({
            color: 0xe2e8f0,
            emissive: 0x0f172a,
            roughness: 0.34,
            metalness: 0.12,
          }),
        );
        boneGroup.add(mesh);
        return mesh;
      });
      stage.add(boneGroup);

      const resize = () => {
        const width = hostRef.current?.clientWidth || 320;
        const height = hostRef.current?.clientHeight || 360;
        renderer.setSize(width, height, false);
        camera.aspect = width / Math.max(height, 1);
        camera.updateProjectionMatrix();
      };

      resize();
      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(hostRef.current);
      }

      const cameraPosition = defaultCameraPosition(focusedHand);
      camera.position.set(cameraPosition.x, cameraPosition.y, cameraPosition.z);
      controls.target.copy(FIXED_TARGET);
      camera.lookAt(FIXED_TARGET);
      applyPalette(
        {
          rimLight,
          jointMeshes,
          boneMeshes,
        },
        focusedHand,
      );

      const animate = () => {
        jointMeshes.forEach((mesh, index) => {
          const target = targetPointsRef.current[index];
          if (!target) {
            mesh.visible = false;
            return;
          }
          mesh.visible = true;
          mesh.position.lerp(target, 0.26);
        });

        boneMeshes.forEach((mesh, index) => {
          const segment = boneSegmentsRef.current[index];
          if (!segment) {
            mesh.visible = false;
            return;
          }
          const [startIndex, endIndex] = segment;
          const start = jointMeshes[startIndex];
          const end = jointMeshes[endIndex];
          if (!start?.visible || !end?.visible) {
            mesh.visible = false;
            return;
          }
          moveBone(mesh, start.position, end.position);
        });

        controls.update();
        renderer.render(scene, camera);
        animationFrameId = window.requestAnimationFrame(animate);
      };
      animate();

      runtimeRef.current = {
        renderer,
        scene,
        camera,
        controls,
        stage,
        rimLight,
        jointMeshes,
        boneMeshes,
      };
      setRenderError(false);
    } catch {
      setRenderError(true);
    }

    return () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }
      resizeObserver?.disconnect();

      const runtime = runtimeRef.current;
      runtimeRef.current = null;
      if (!runtime) {
        return;
      }

      runtime.controls.dispose();
      runtime.jointMeshes.forEach((mesh) => {
        mesh.geometry.dispose();
        mesh.material.dispose();
      });
      runtime.boneMeshes.forEach((mesh) => {
        mesh.geometry.dispose();
        mesh.material.dispose();
      });

      runtime.scene.traverse((object) => {
        if (object.type === "Mesh" && object.geometry && !object.geometry.disposed) {
          object.geometry.dispose?.();
        }
      });
      runtime.renderer.dispose();
    };
  }, []);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) {
      return;
    }

    const cameraPosition = defaultCameraPosition(focusedHand);
    runtime.camera.position.set(
      cameraPosition.x,
      cameraPosition.y,
      cameraPosition.z,
    );
    runtime.controls.target.copy(FIXED_TARGET);
    runtime.camera.lookAt(FIXED_TARGET);
    runtime.controls.update();
    applyPalette(runtime, focusedHand);
  }, [focusedHand]);

  useEffect(() => {
    targetPointsRef.current = Array.from({ length: 25 }, (_, index) => {
      const point = points?.[index];
      if (!point) {
        return null;
      }
      return new THREE.Vector3(point.x, point.y, point.z);
    });
  }, [points]);

  return (
    <section className="viewer-card">
      <div className="viewer-header">
        <div>
          <p className="section-label">Live Hand</p>
          <h2>{focusedHand === "left" ? "Left hand" : "Right hand"}</h2>
          <p className="viewer-hint">Orbit with drag. Zoom with the wheel. Grid and axes stay world-fixed.</p>
        </div>
        <div className={points?.length ? "viewer-status live" : "viewer-status"}>
          {points?.length ? "Live" : "Waiting"}
        </div>
      </div>
      <div ref={hostRef} className="viewer-stage-wrap">
        <canvas
          ref={canvasRef}
          aria-label="Hand skeleton viewer"
          className="viewer-stage"
        />
        {!points?.length ? (
          <div className="viewer-overlay">Waiting for pose stream</div>
        ) : null}
        {renderError ? (
          <div className="viewer-overlay">WebGL viewer unavailable in this environment</div>
        ) : null}
      </div>
      <div className="viewer-footer">
        <span>{points?.[0]?.frame_id || "No frame id"}</span>
        <span>{points?.length ?? 0} joints</span>
      </div>
    </section>
  );
}
