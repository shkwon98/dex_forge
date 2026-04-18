import { expect, test } from "vitest";

import { buildBoneChains, buildViewerGuides, defaultViewState, projectHandPoints } from "./handView";


test("projects hand points into a stable 3d view with depth ordering", () => {
  const points = [
    { x: 0, y: 0, z: 0, frame_id: "root" },
    { x: 0.01, y: 0.05, z: -0.01, frame_id: "tip" },
  ];

  const projected = projectHandPoints(points, defaultViewState("left"));

  expect(projected).toHaveLength(2);
  expect(projected[0]).toEqual(
    expect.objectContaining({
      px: expect.any(Number),
      py: expect.any(Number),
      depth: expect.any(Number),
    }),
  );
  expect(projected[0].px).not.toBe(projected[1].px);
  expect(projected[0].py).not.toBe(projected[1].py);
});


test("builds palm and finger chains for 25-joint hands", () => {
  const chains = buildBoneChains(25);

  expect(chains).toContainEqual([0, 1, 2, 3, 4]);
  expect(chains).toContainEqual([0, 17, 18, 19, 20]);
  expect(chains).toContainEqual([0, 21, 22, 23, 24]);
});


test("builds grid and axis guides for orientation cues", () => {
  const points = [
    { x: 0, y: 0, z: 0, frame_id: "root" },
    { x: 0.02, y: 0.05, z: -0.01, frame_id: "tip" },
  ];

  const guides = buildViewerGuides(points, defaultViewState("left"));

  expect(guides.grid.length).toBeGreaterThan(4);
  expect(guides.axes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ key: "x", label: "X" }),
      expect.objectContaining({ key: "y", label: "Y" }),
      expect.objectContaining({ key: "z", label: "Z" }),
    ]),
  );
});
