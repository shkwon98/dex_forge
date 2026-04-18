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

const DEFAULT_EXTENT = 0.085;
const GRID_RANGE = {
  x: [-0.075, 0.075],
  y: [-0.01, 0.13],
  z: 0,
};
const GRID_STEPS_X = [-0.075, -0.045, -0.015, 0.015, 0.045, 0.075];
const GRID_STEPS_Y = [0.0, 0.03, 0.06, 0.09, 0.12];
const AXES = [
  { key: "x", label: "X", start: { x: 0, y: 0, z: 0 }, end: { x: 0.075, y: 0, z: 0 } },
  { key: "y", label: "Y", start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0.11, z: 0 } },
  { key: "z", label: "Z", start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0, z: 0.07 } },
];


function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}


export function buildBoneChains(pointCount) {
  if (pointCount >= 25) {
    return BONE_CHAINS_25;
  }
  if (pointCount >= 21) {
    return BONE_CHAINS_21;
  }
  return [];
}


export function defaultViewState(focusedHand) {
  return {
    yaw: focusedHand === "right" ? 0.8 : -0.8,
    pitch: 0.45,
    zoom: 1.2,
  };
}


export function updateViewState(viewState, deltaX, deltaY, deltaZoom = 0) {
  return {
    yaw: viewState.yaw + deltaX * 0.01,
    pitch: clamp(viewState.pitch + deltaY * 0.01, -1.2, 1.2),
    zoom: clamp(viewState.zoom + deltaZoom, 0.6, 2.2),
  };
}


function normalizedHand(points) {
  if (!points?.length) {
    return {
      centered: [],
      extent: DEFAULT_EXTENT,
    };
  }

  const root = points[0];
  const centered = points.map((point) => ({
    ...point,
    x: point.x - root.x,
    y: point.y - root.y,
    z: point.z - root.z,
  }));

  const maxExtent = centered.reduce((current, point) => {
    return Math.max(current, Math.abs(point.x), Math.abs(point.y), Math.abs(point.z));
  }, 0.001);

  return {
    centered,
    extent: Math.max(maxExtent, DEFAULT_EXTENT),
  };
}


function createProjector(viewState, extent) {
  const scale = (110 / extent) * viewState.zoom;

  const cosYaw = Math.cos(viewState.yaw);
  const sinYaw = Math.sin(viewState.yaw);
  const cosPitch = Math.cos(viewState.pitch);
  const sinPitch = Math.sin(viewState.pitch);

  return (point) => {
    const yawX = point.x * cosYaw + point.z * sinYaw;
    const yawZ = -point.x * sinYaw + point.z * cosYaw;
    const pitchY = point.y * cosPitch - yawZ * sinPitch;
    const pitchZ = point.y * sinPitch + yawZ * cosPitch;
    const perspective = 1 / Math.max(0.45, 1.3 + pitchZ * 16);

    return {
      ...point,
      px: 160 + yawX * scale * perspective,
      py: 156 - pitchY * scale * perspective,
      depth: pitchZ,
    };
  };
}


export function projectHandPoints(points, viewState) {
  const { centered, extent } = normalizedHand(points);
  const projector = createProjector(viewState, extent);
  return centered.map(projector);
}


export function buildViewerGuides(points, viewState) {
  const { extent } = normalizedHand(points);
  const projector = createProjector(viewState, extent);

  const grid = [
    ...GRID_STEPS_X.map((x) => ({
      start: projector({ x, y: GRID_RANGE.y[0], z: GRID_RANGE.z }),
      end: projector({ x, y: GRID_RANGE.y[1], z: GRID_RANGE.z }),
    })),
    ...GRID_STEPS_Y.map((y) => ({
      start: projector({ x: GRID_RANGE.x[0], y, z: GRID_RANGE.z }),
      end: projector({ x: GRID_RANGE.x[1], y, z: GRID_RANGE.z }),
    })),
  ];

  const axes = AXES.map((axis) => ({
    key: axis.key,
    label: axis.label,
    start: projector(axis.start),
    end: projector(axis.end),
  }));

  return { grid, axes };
}
