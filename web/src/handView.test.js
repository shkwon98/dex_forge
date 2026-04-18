import { expect, test } from "vitest";

import { buildBoneChains, buildBoneSegments, defaultCameraPosition, handBounds } from "./handView";


test("builds palm and finger chains for 25-joint hands", () => {
  const chains = buildBoneChains(25);

  expect(chains).toContainEqual([0, 1, 2, 3, 4]);
  expect(chains).toContainEqual([0, 17, 18, 19, 20]);
  expect(chains).toContainEqual([0, 21, 22, 23, 24]);
});


test("flattens chains into adjacent bone segments", () => {
  const segments = buildBoneSegments(25);

  expect(segments).toContainEqual([0, 1]);
  expect(segments).toContainEqual([3, 4]);
  expect(segments).toContainEqual([21, 22]);
  expect(segments).toContainEqual([23, 24]);
});


test("computes stable hand bounds and a default camera position", () => {
  const points = [
    { x: -0.04, y: -0.01, z: -0.02 },
    { x: 0.08, y: 0.16, z: 0.03 },
  ];

  const bounds = handBounds(points);
  const camera = defaultCameraPosition("left", bounds.extent);

  expect(bounds.center).toEqual(
    expect.objectContaining({
      x: expect.closeTo(0.02, 5),
      y: expect.closeTo(0.075, 5),
      z: expect.closeTo(0.005, 5),
    }),
  );
  expect(bounds.extent).toBeGreaterThan(0.15);
  expect(camera.x).toBeGreaterThan(0);
  expect(camera.z).toBeGreaterThan(camera.y);
});
