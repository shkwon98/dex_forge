function idleSnapshot() {
  return {
    current_state: "idle",
    active_hands: "left",
    hand_pose_preview: { left: [], right: [] },
  };
}


async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
  if (!response.ok) {
    throw new Error(`request failed: ${response.status}`);
  }
  return response.json();
}


function startPolling(callback, intervalMs = 100) {
  let active = true;

  const tick = async () => {
    try {
      const snapshot = await request("/api/sessions/current");
      if (active) {
        callback(snapshot);
      }
    } catch {
      if (active) {
        callback(idleSnapshot());
      }
    }
  };

  tick();
  const intervalId = setInterval(tick, intervalMs);

  return () => {
    active = false;
    clearInterval(intervalId);
  };
}


export function createStatusSource() {
  return {
    subscribe(callback) {
      if (typeof window === "undefined" || typeof window.WebSocket === "undefined") {
        return startPolling(callback);
      }

      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      const socket = new window.WebSocket(`${protocol}://${window.location.host}/ws/status`);

      let pollingCleanup = null;
      let fallbackStarted = false;

      const ensurePolling = () => {
        if (fallbackStarted) {
          return;
        }
        fallbackStarted = true;
        pollingCleanup = startPolling(callback);
      };

      socket.addEventListener("message", (event) => {
        callback(JSON.parse(event.data));
      });

      socket.addEventListener("error", () => {
        ensurePolling();
      });

      socket.addEventListener("close", () => {
        ensurePolling();
      });

      return () => {
        pollingCleanup?.();
        socket.close();
      };
    },
  };
}


export const apiClient = {
  createSession: async ({ activeHands, notes, datasetRoot = "" }) =>
    request("/api/sessions", {
      method: "POST",
      body: JSON.stringify({
        active_hands: activeHands,
        notes,
        dataset_root: datasetRoot,
      }),
    }),
  getCurrentSession: async () =>
    request("/api/sessions/current"),
  getNextPrompt: async () =>
    request("/api/prompts/next", { method: "POST" }),
  updateActiveHands: async (activeHands) =>
    request("/api/sessions/active-hands", {
      method: "POST",
      body: JSON.stringify({ active_hands: activeHands }),
    }),
  startClip: async () =>
    request("/api/clips/start", { method: "POST" }),
  stopClip: async () =>
    request("/api/clips/stop", { method: "POST" }),
  decideClip: async (clipId, decision) =>
    request(`/api/clips/${clipId}/decision`, {
      method: "POST",
      body: JSON.stringify({ decision }),
    }),
  finishSession: async () =>
    request("/api/sessions/finish", {
      method: "POST",
    }),
  pickDatasetRoot: async () =>
    request("/api/system/pick-dataset-root", {
      method: "POST",
    }),
  addNote: async (note) =>
    request("/api/events/note", {
      method: "POST",
      body: JSON.stringify({ note }),
    }),
};
