import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import { App } from "./App";


function createApi(overrides = {}) {
  return {
    createSession: async ({ operatorId, activeHands, notes }) => ({
      session_id: "session-1",
      operator_id: operatorId,
      active_hands: activeHands,
      notes,
    }),
    getNextPrompt: async () => ({
      id: "pinch",
      category: "pinch",
      action: "precision",
      variation: "thumb_index",
      prompt_text: "Do a precision pinch.",
    }),
    armClip: async () => ({
      clip_id: "clip-1",
      label: {
        category: "pinch",
        action: "precision",
        variation: "thumb_index",
      },
    }),
    startClip: async () => ({ ok: true }),
    stopClip: async () => ({
      clip_id: "clip-1",
      status: "review",
      failure_reason: null,
    }),
    decideClip: async () => ({
      clip_id: "clip-1",
      status: "accepted",
    }),
    addNote: async () => ({ ok: true }),
    ...overrides,
  };
}


test("creates a session and keeps the chosen hand mode visible for later clips", async () => {
  const user = userEvent.setup();
  const api = createApi();

  render(<App api={api} />);

  await user.type(screen.getByLabelText(/operator/i), "collector-1");
  await user.selectOptions(screen.getByLabelText(/active hands/i), "right");
  await user.type(screen.getByLabelText(/session notes/i), "right hand only");
  await user.click(screen.getByRole("button", { name: /start session/i }));

  await screen.findByText(/session active/i);
  expect(screen.getByText(/right hand session/i)).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: /next prompt/i }));
  await screen.findByText(/do a precision pinch/i);
  expect(screen.getByText(/right hand session/i)).toBeInTheDocument();
});


test("runs prompt, record, note, and review actions through the operator flow", async () => {
  const user = userEvent.setup();
  const addNote = vi.fn(async () => ({ ok: true }));
  const decideClip = vi.fn(async () => ({ clip_id: "clip-1", status: "accepted" }));
  const api = createApi({ addNote, decideClip });

  render(<App api={api} />);

  await user.type(screen.getByLabelText(/operator/i), "collector-2");
  await user.click(screen.getByRole("button", { name: /start session/i }));
  await user.click(screen.getByRole("button", { name: /next prompt/i }));
  await user.click(screen.getByRole("button", { name: /arm clip/i }));
  await user.click(screen.getByRole("button", { name: /start recording/i }));

  await screen.findByText(/recording in progress/i);
  await user.type(screen.getByLabelText(/clip note/i), "steady pinch");
  await user.click(screen.getByRole("button", { name: /save note/i }));

  await waitFor(() => {
    expect(addNote).toHaveBeenCalledWith("steady pinch");
  });

  await user.click(screen.getByRole("button", { name: /stop recording/i }));
  await screen.findByText(/review clip/i);
  await user.click(screen.getByRole("button", { name: /accept clip/i }));

  await waitFor(() => {
    expect(decideClip).toHaveBeenCalledWith("clip-1", "accept");
  });
  expect(screen.getByText(/last clip accepted/i)).toBeInTheDocument();
});
