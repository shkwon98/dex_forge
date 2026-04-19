import { afterEach, expect, test, vi } from "vitest";

import { createStatusSource } from "./api";


afterEach(() => {
  vi.restoreAllMocks();
});


test("falls back to polling current collection when websocket setup fails", async () => {
  const addEventListener = vi.fn((event, handler) => {
    if (event === "error") {
      setTimeout(() => handler(new Event("error")), 0);
    }
  });
  const close = vi.fn();
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      is_collecting: true,
      current_state: "idle",
      active_hands: "both",
      hand_pose_preview: {
        left: [{ x: 1, y: 2, z: 3, frame_id: "left_polled" }],
        right: [],
      },
    }),
  }));

  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("window", {
    location: { protocol: "http:", host: "localhost:8010" },
    setInterval,
    clearInterval,
    WebSocket: vi.fn(() => ({
      addEventListener,
      close,
    })),
  });

  const callback = vi.fn();
  const unsubscribe = createStatusSource().subscribe(callback);

  await new Promise((resolve) => setTimeout(resolve, 20));

  expect(fetchMock).toHaveBeenCalledWith(
    "/api/collection",
    expect.objectContaining({
      headers: expect.objectContaining({
        "Content-Type": "application/json",
      }),
    }),
  );
  expect(callback).toHaveBeenCalledWith(
    expect.objectContaining({
      active_hands: "both",
      hand_pose_preview: expect.objectContaining({
        left: [expect.objectContaining({ frame_id: "left_polled" })],
      }),
    }),
  );

  unsubscribe();
  expect(close).toHaveBeenCalled();
});
