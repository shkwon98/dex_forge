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
