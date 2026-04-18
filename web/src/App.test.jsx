import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { App } from "./App";


afterEach(() => {
  window.localStorage.clear();
});


function createApi(overrides = {}) {
  let promptCalls = 0;
  const promptSequence = [
    {
      id: "pinch",
      category: "pinch",
      action: "precision",
      variation: "thumb_index",
      prompt_text: "Do a precision pinch.",
      allowed_hands: "either",
    },
    {
      id: "grasp",
      category: "grasp",
      action: "power_grasp",
      variation: "small_object",
      prompt_text: "Perform a power grasp.",
      allowed_hands: "either",
    },
  ];
  return {
    createSession: async ({ operatorId, activeHands, notes, datasetRoot }) => ({
      session_id: "session-1",
      operator_id: operatorId,
      active_hands: activeHands,
      notes,
      dataset_root: datasetRoot,
    }),
    pickDatasetRoot: async () => ({
      dataset_root: "/tmp/chosen-dataset",
    }),
    getNextPrompt: async () => promptSequence[promptCalls++ % promptSequence.length],
    startClip: async () => ({ ok: true }),
    stopClip: async () => ({
      clip_id: "clip-1",
      status: "review",
      failure_reason: null,
      review_preview: {
        left: [[{ x: 0.1, y: 0.2, z: 0, frame_id: "recorded_left" }]],
        right: [[{ x: 0.8, y: 0.25, z: 0, frame_id: "recorded_right" }]],
      },
    }),
    decideClip: async () => ({
      clip_id: "clip-1",
      status: "accepted",
    }),
    updateActiveHands: async (activeHands) => ({
      session_id: "session-1",
      active_hands: activeHands,
    }),
    finishSession: async () => ({
      session_id: "session-1",
      dataset_root: "/tmp/dataset",
      accepted_count: 1,
      discarded_count: 0,
      retried_count: 0,
      invalid_count: 0,
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
  await user.click(screen.getByRole("button", { name: /choose folder/i }));
  await user.click(screen.getByRole("button", { name: /start session/i }));

  await screen.findByText(/do a precision pinch/i);
  expect(screen.getAllByText(/^right hand$/i).length).toBeGreaterThan(0);
  expect(screen.getByLabelText(/active hands/i)).toHaveValue("right");
});


test("runs prompt, record, note, and review actions through the operator flow", async () => {
  const user = userEvent.setup();
  const addNote = vi.fn(async () => ({ ok: true }));
  const decideClip = vi.fn(async () => ({ clip_id: "clip-1", status: "accepted" }));
  const startClip = vi.fn(async () => ({ ok: true }));
  const api = createApi({ addNote, decideClip, startClip });
  const statusSource = createStatusSource();

  render(<App api={api} statusSource={statusSource} />);

  await user.click(screen.getByRole("button", { name: /choose folder/i }));
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
  expect(screen.queryByRole("button", { name: /change prompt/i })).not.toBeInTheDocument();
  expect(screen.getByText(/recorded_left/i)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /accept clip/i }));

  await waitFor(() => {
    expect(decideClip).toHaveBeenCalledWith("clip-1", "accept");
  });
  expect(screen.getByText(/last clip accepted/i)).toBeInTheDocument();
  await screen.findByText(/perform a power grasp/i);
});


test("allows changing active hands during a session until recording starts", async () => {
  const user = userEvent.setup();
  const updateActiveHands = vi.fn(async (activeHands) => ({
    session_id: "session-1",
    active_hands: activeHands,
  }));
  const api = createApi({ updateActiveHands });
  const statusSource = createStatusSource({ active_hands: "left" });

  render(<App api={api} statusSource={statusSource} />);

  await user.click(screen.getByRole("button", { name: /choose folder/i }));
  await user.click(screen.getByRole("button", { name: /start session/i }));
  await screen.findByText(/do a precision pinch/i);

  await user.selectOptions(screen.getByLabelText(/active hands/i), "both");

  await waitFor(() => {
    expect(updateActiveHands).toHaveBeenCalledWith("both");
  });

  await user.click(screen.getByRole("button", { name: /start recording/i }));
  expect(screen.getByLabelText(/active hands/i)).toBeDisabled();
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
  await user.click(screen.getByRole("button", { name: /choose folder/i }));
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

  await user.click(screen.getByRole("button", { name: /choose folder/i }));
  await user.click(screen.getByRole("button", { name: /start session/i }));

  await screen.findByText(/do a precision pinch/i);
  expect(screen.queryByRole("button", { name: /arm clip/i })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /change prompt/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /start recording/i })).toBeInTheDocument();
});


test("shows dataset root on launch and a finish-session summary screen", async () => {
  const user = userEvent.setup();
  const api = createApi();
  const statusSource = createStatusSource();

  render(<App api={api} statusSource={statusSource} />);

  await user.click(screen.getByRole("button", { name: /choose folder/i }));
  await user.click(screen.getByRole("button", { name: /start session/i }));
  await screen.findByText(/do a precision pinch/i);

  await user.click(screen.getByRole("button", { name: /finish session/i }));

  expect(await screen.findByText(/dataset folder: \/tmp\/dataset/i)).toBeInTheDocument();
  expect(screen.getByText(/accepted clips: 1/i)).toBeInTheDocument();
});


test("fills dataset root from the native picker flow and uses the absolute path", async () => {
  const user = userEvent.setup();
  const pickDatasetRoot = vi.fn(async () => ({
    dataset_root: "/tmp/chosen-dataset",
  }));
  const createSession = vi.fn(async ({ activeHands, notes, datasetRoot }) => ({
    session_id: "session-1",
    operator_id: "",
    active_hands: activeHands,
    notes,
    dataset_root: datasetRoot,
  }));
  const api = createApi({ pickDatasetRoot, createSession });
  const statusSource = createStatusSource();

  render(<App api={api} statusSource={statusSource} />);

  await user.click(screen.getByRole("button", { name: /choose folder/i }));

  await waitFor(() => {
    expect(pickDatasetRoot).toHaveBeenCalled();
  });
  expect(screen.getAllByText(/\/tmp\/chosen-dataset/i).length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: /choose folder/i })).toHaveTextContent(/change folder/i);

  await user.click(screen.getByRole("button", { name: /start session/i }));

  await waitFor(() => {
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({ datasetRoot: "/tmp/chosen-dataset" }),
    );
  });
});


test("only the folder action button opens the picker", async () => {
  const user = userEvent.setup();
  const pickDatasetRoot = vi.fn(async () => ({
    dataset_root: "/tmp/chosen-dataset",
  }));
  const api = createApi({ pickDatasetRoot });
  const statusSource = createStatusSource();

  render(<App api={api} statusSource={statusSource} />);

  await user.click(screen.getByTestId("dataset-root-card"));

  expect(pickDatasetRoot).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: /choose folder/i }));

  await waitFor(() => {
    expect(pickDatasetRoot).toHaveBeenCalledTimes(1);
  });
});


test("ignores an aborted folder picker without showing an error", async () => {
  const user = userEvent.setup();
  const pickDatasetRoot = vi.fn(async () => ({
    dataset_root: "",
  }));
  const api = createApi({ pickDatasetRoot });
  const statusSource = createStatusSource();

  render(<App api={api} statusSource={statusSource} />);

  await user.click(screen.getByRole("button", { name: /choose folder/i }));

  await waitFor(() => {
    expect(pickDatasetRoot).toHaveBeenCalledTimes(1);
  });
  expect(screen.queryByText(/failed to choose a dataset directory/i)).not.toBeInTheDocument();
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
