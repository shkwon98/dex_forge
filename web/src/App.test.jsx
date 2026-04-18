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


function createStatusSource(initialSnapshot = {}) {
  const listeners = new Set();
  const snapshot = {
    current_state: "idle",
    active_hands: "left",
    hand_pose_preview: {
      left: [{ x: 0.2, y: 0.5, z: 0, frame_id: "left" }],
      right: [{ x: 0.75, y: 0.35, z: 0, frame_id: "right" }],
    },
    ...initialSnapshot,
  };

  return {
    subscribe(callback) {
      listeners.add(callback);
      callback(snapshot);
      return () => listeners.delete(callback);
    },
    emit(nextSnapshot) {
      const merged = { ...snapshot, ...nextSnapshot };
      for (const callback of listeners) {
        callback(merged);
      }
    },
  };
}


test("creates a session and keeps the chosen hand mode visible for later clips", async () => {
  const user = userEvent.setup();
  const api = createApi();
  const statusSource = createStatusSource({ active_hands: "right" });

  render(<App api={api} statusSource={statusSource} />);

  await user.selectOptions(screen.getByLabelText(/active hands/i), "right");
  await user.click(screen.getByRole("button", { name: /start session/i }));

  await screen.findByText(/do a precision pinch/i);
  expect(screen.getAllByText(/^right hand$/i).length).toBeGreaterThan(0);
  await screen.findByText(/do a precision pinch/i);
  expect(screen.getAllByText(/^right hand$/i).length).toBeGreaterThan(0);
});


test("runs prompt, record, note, and review actions through the operator flow", async () => {
  const user = userEvent.setup();
  const addNote = vi.fn(async () => ({ ok: true }));
  const decideClip = vi.fn(async () => ({ clip_id: "clip-1", status: "accepted" }));
  const startClip = vi.fn(async () => ({ ok: true }));
  const api = createApi({ addNote, decideClip, startClip });
  const statusSource = createStatusSource();

  render(<App api={api} statusSource={statusSource} />);

  await user.click(screen.getByRole("button", { name: /start session/i }));
  await user.click(screen.getByRole("button", { name: /start recording/i }));

  await screen.findByText(/recording in progress/i);
  await waitFor(() => {
    expect(startClip).toHaveBeenCalled();
  });
  await user.type(screen.getByLabelText(/clip note/i), "steady pinch");
  await user.click(screen.getByRole("button", { name: /save note/i }));

  await waitFor(() => {
    expect(addNote).toHaveBeenCalledWith("steady pinch");
  });

  await user.click(screen.getByRole("button", { name: /stop recording/i }));
  await screen.findByText(/review the recorded clip/i);
  await user.click(screen.getByRole("button", { name: /accept clip/i }));

  await waitFor(() => {
    expect(decideClip).toHaveBeenCalledWith("clip-1", "accept");
  });
  expect(screen.getByText(/last clip accepted/i)).toBeInTheDocument();
});


test("shows a live hand stage and allows focused-hand switching for both-hand sessions", async () => {
  const user = userEvent.setup();
  const api = createApi();
  const statusSource = createStatusSource({
    active_hands: "both",
    hand_pose_preview: {
      left: [{ x: 0.15, y: 0.55, z: 0, frame_id: "left_focus" }],
      right: [{ x: 0.85, y: 0.25, z: 0, frame_id: "right_focus" }],
    },
  });

  render(<App api={api} statusSource={statusSource} />);

  await user.selectOptions(screen.getByLabelText(/active hands/i), "both");
  await user.click(screen.getByRole("button", { name: /start session/i }));

  await screen.findByText(/live hand/i);
  expect(screen.getByText(/focused hand/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/hand skeleton viewer/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /left hand/i })).toHaveAttribute("aria-pressed", "true");

  await user.click(screen.getByRole("button", { name: /right hand/i }));

  expect(screen.getByRole("button", { name: /right hand/i })).toHaveAttribute("aria-pressed", "true");
});


test("starts a session without an operator field and immediately loads the first prompt", async () => {
  const user = userEvent.setup();
  const api = createApi();
  const statusSource = createStatusSource();

  render(<App api={api} statusSource={statusSource} />);

  expect(screen.queryByLabelText(/operator/i)).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: /start session/i }));

  await screen.findByText(/do a precision pinch/i);
  expect(screen.queryByRole("button", { name: /arm clip/i })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /change prompt/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /start recording/i })).toBeInTheDocument();
});


test("shows both live hand previews on the launch screen when both hands are selected", async () => {
  const user = userEvent.setup();
  const api = createApi();
  const statusSource = createStatusSource({
    hand_pose_preview: {
      left: [{ x: 0.15, y: 0.55, z: 0, frame_id: "left_preview" }],
      right: [{ x: 0.85, y: 0.25, z: 0, frame_id: "right_preview" }],
    },
  });

  render(<App api={api} statusSource={statusSource} />);

  await user.selectOptions(screen.getByLabelText(/active hands/i), "both");

  expect(screen.getAllByText(/live hand/i)).toHaveLength(2);
  expect(screen.getByText(/left_preview/i)).toBeInTheDocument();
  expect(screen.getByText(/right_preview/i)).toBeInTheDocument();
});
