function idleSnapshot() {
  return {
    is_collecting: false,
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
      const snapshot = await request("/api/collection");
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
  startCollection: async ({ activeHands, datasetRoot = "" }) =>
    request("/api/collection/start", {
      method: "POST",
      body: JSON.stringify({
        active_hands: activeHands,
        dataset_root: datasetRoot,
      }),
    }),
  getCollection: async () =>
    request("/api/collection"),
  getNextPrompt: async () =>
    request("/api/prompts/next", { method: "POST" }),
  translatePrompt: async (promptText) =>
    request("/api/prompts/translate", {
      method: "POST",
      body: JSON.stringify({ prompt_text: promptText }),
    }),
  updateActiveHands: async (activeHands) =>
    request("/api/collection/active-hands", {
      method: "POST",
      body: JSON.stringify({ active_hands: activeHands }),
    }),
  startRecording: async () =>
    request("/api/recordings/start", { method: "POST" }),
  stopRecording: async () =>
    request("/api/recordings/stop", { method: "POST" }),
  decideRecording: async (recordingId, decision) =>
    request(`/api/recordings/${recordingId}/decision`, {
      method: "POST",
      body: JSON.stringify({ decision }),
    }),
  finishCollection: async () =>
    request("/api/collection/finish", {
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
