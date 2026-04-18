const BONE_CHAINS_21 = [
  [0, 1, 2, 3, 4],
  [0, 5, 6, 7, 8],
  [0, 9, 10, 11, 12],
  [0, 13, 14, 15, 16],
  [0, 17, 18, 19, 20],
];

const BONE_CHAINS_25 = [
  ...BONE_CHAINS_21,
  [0, 21, 22, 23, 24],
];


export function buildBoneChains(pointCount) {
  if (pointCount >= 25) {
    return BONE_CHAINS_25;
  }
  if (pointCount >= 21) {
    return BONE_CHAINS_21;
  }
  return [];
}


export function buildBoneSegments(pointCount) {
  return buildBoneChains(pointCount).flatMap((chain) =>
    chain.slice(0, -1).map((jointIndex, index) => [jointIndex, chain[index + 1]]),
  );
}


export function handBounds(points) {
  if (!points?.length) {
    return {
      min: { x: -0.08, y: -0.03, z: -0.08 },
      max: { x: 0.08, y: 0.18, z: 0.08 },
      center: { x: 0, y: 0.07, z: 0 },
      extent: 0.18,
    };
  }

  const bounds = points.reduce(
    (current, point) => ({
      min: {
        x: Math.min(current.min.x, point.x),
        y: Math.min(current.min.y, point.y),
        z: Math.min(current.min.z, point.z),
      },
      max: {
        x: Math.max(current.max.x, point.x),
        y: Math.max(current.max.y, point.y),
        z: Math.max(current.max.z, point.z),
      },
    }),
    {
      min: { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY, z: Number.POSITIVE_INFINITY },
      max: { x: Number.NEGATIVE_INFINITY, y: Number.NEGATIVE_INFINITY, z: Number.NEGATIVE_INFINITY },
    },
  );

  const center = {
    x: (bounds.min.x + bounds.max.x) * 0.5,
    y: (bounds.min.y + bounds.max.y) * 0.5,
    z: (bounds.min.z + bounds.max.z) * 0.5,
  };
  const extent = Math.max(
    bounds.max.x - bounds.min.x,
    bounds.max.y - bounds.min.y,
    bounds.max.z - bounds.min.z,
    0.12,
  );

  return { ...bounds, center, extent };
}


export function defaultCameraPosition(focusedHand, extent = 0.18) {
  const lateral = focusedHand === "right" ? -1 : 1;
  return {
    x: lateral * extent * 1.25,
    y: extent * 0.85,
    z: extent * 2.15,
  };
}
