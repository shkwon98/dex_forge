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


export function createStatusSource() {
  return {
    subscribe(callback) {
      if (typeof window === "undefined" || typeof window.WebSocket === "undefined") {
        callback({
          current_state: "idle",
          active_hands: "left",
          hand_pose_preview: { left: [], right: [] },
        });
        return () => {};
      }

      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      const socket = new window.WebSocket(`${protocol}://${window.location.host}/ws/status`);

      socket.addEventListener("message", (event) => {
        callback(JSON.parse(event.data));
      });

      socket.addEventListener("error", () => {
        callback({
          current_state: "idle",
          hand_pose_preview: { left: [], right: [] },
        });
      });

      return () => socket.close();
    },
  };
}


export const apiClient = {
  createSession: async ({ operatorId, activeHands, notes }) =>
    request("/api/sessions", {
      method: "POST",
      body: JSON.stringify({
        operator_id: operatorId,
        active_hands: activeHands,
        notes,
      }),
    }),
  getNextPrompt: async () =>
    request("/api/prompts/next", { method: "POST" }),
  armClip: async (scenarioId) =>
    request("/api/clips/arm", {
      method: "POST",
      body: JSON.stringify({ scenario_id: scenarioId }),
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
  addNote: async (note) =>
    request("/api/events/note", {
      method: "POST",
      body: JSON.stringify({ note }),
    }),
};
