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
      category: "pinch",
      action: "precision",
      variation: "thumb_index",
      prompt_text: "Do a precision pinch.",
    },
    {
      category: "grasp",
      action: "power_grasp",
      variation: "small_object",
      prompt_text: "Perform a power grasp.",
    },
  ];
  return {
    startCollection: async ({ activeHands, datasetRoot }) => ({
      is_collecting: true,
      active_hands: activeHands,
      dataset_root: datasetRoot,
    }),
    pickDatasetRoot: async () => ({
      dataset_root: "/tmp/chosen-dataset",
    }),
    getNextPrompt: async () => promptSequence[promptCalls++ % promptSequence.length],
    startRecording: async () => ({ ok: true }),
    stopRecording: async () => ({
      recording_id: "recording-1",
      status: "review",
      failure_reason: null,
      review_preview: {
        left: [[{ x: 0.1, y: 0.2, z: 0, frame_id: "recorded_left" }]],
        right: [[{ x: 0.8, y: 0.25, z: 0, frame_id: "recorded_right" }]],
      },
    }),
    decideRecording: async () => ({
      recording_id: "recording-1",
      status: "accepted",
    }),
    updateActiveHands: async (activeHands) => ({
      is_collecting: true,
      active_hands: activeHands,
    }),
    finishCollection: async () => ({
      dataset_root: "/tmp/dataset",
      accepted_count: 1,
      discarded_count: 0,
      invalid_count: 0,
    }),
    addNote: async () => ({ ok: true }),
    ...overrides,
  };
}


function createStatusSource(initialSnapshot = {}) {
  const listeners = new Set();
  const snapshot = {
    is_collecting: false,
    current_state: "idle",
    active_hands: "left",
    accepted_recording_count: 0,
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


test("starts collection and keeps the chosen hand mode visible for later recordings", async () => {
  const user = userEvent.setup();
  const api = createApi();
  const statusSource = createStatusSource({ active_hands: "right" });

  render(<App api={api} statusSource={statusSource} />);

  await user.selectOptions(screen.getByLabelText(/active hands/i), "right");
  await user.click(screen.getByRole("button", { name: /choose folder/i }));
  await user.click(screen.getByRole("button", { name: /start collection/i }));

  await screen.findByText(/do a precision pinch/i);
  expect(screen.getByText(/saved 0/i)).toBeInTheDocument();
  expect(screen.getAllByText(/^right hand$/i).length).toBeGreaterThan(0);
  expect(screen.getByLabelText(/active hands/i)).toHaveValue("right");
});


test("runs prompt, record, note, and review actions through the operator flow", async () => {
  const user = userEvent.setup();
  const addNote = vi.fn(async () => ({ ok: true }));
  const decideRecording = vi.fn(async () => ({ recording_id: "recording-1", status: "accepted" }));
  const startRecording = vi.fn(async () => ({ ok: true }));
  const api = createApi({ addNote, decideRecording, startRecording });
  const statusSource = createStatusSource();

  render(<App api={api} statusSource={statusSource} />);

  await user.click(screen.getByRole("button", { name: /choose folder/i }));
  await user.click(screen.getByRole("button", { name: /start collection/i }));
  await user.click(screen.getByRole("button", { name: /start recording/i }));

  await screen.findByText(/recording in progress/i);
  await waitFor(() => {
    expect(startRecording).toHaveBeenCalled();
  });
  await user.type(screen.getByLabelText(/recording note/i), "steady pinch");
  await user.click(screen.getByRole("button", { name: /save note/i }));

  await waitFor(() => {
    expect(addNote).toHaveBeenCalledWith("steady pinch");
  });

  await user.click(screen.getByRole("button", { name: /stop recording/i }));
  await screen.findByText(/review the recorded sample/i);
  expect(screen.queryByRole("button", { name: /change prompt/i })).not.toBeInTheDocument();
  expect(screen.getByText(/recorded_left/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /confirm/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /discard/i })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /confirm/i }));
  statusSource.emit({ accepted_recording_count: 1 });

  await waitFor(() => {
    expect(decideRecording).toHaveBeenCalledWith("recording-1", "accept");
  });
  expect(screen.getByRole("button", { name: /^next$/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^again$/i })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /^next$/i }));
  expect(screen.getByText(/saved 1/i)).toBeInTheDocument();
  await screen.findByText(/perform a power grasp/i);
});


test("save and record one more keeps the same prompt ready for another take", async () => {
  const user = userEvent.setup();
  const decideRecording = vi.fn(async () => ({ recording_id: "recording-1", status: "accepted" }));
  const api = createApi({ decideRecording });
  const statusSource = createStatusSource();

  render(<App api={api} statusSource={statusSource} />);

  await user.click(screen.getByRole("button", { name: /choose folder/i }));
  await user.click(screen.getByRole("button", { name: /start collection/i }));
  await user.click(screen.getByRole("button", { name: /start recording/i }));
  await user.click(screen.getByRole("button", { name: /stop recording/i }));
  await user.click(screen.getByRole("button", { name: /confirm/i }));
  await user.click(screen.getByRole("button", { name: /^again$/i }));

  await waitFor(() => {
    expect(decideRecording).toHaveBeenCalledWith("recording-1", "accept");
  });
  expect(screen.getByText(/do a precision pinch/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /start recording/i })).toBeInTheDocument();
});


test("discard requires a follow-up next or again choice", async () => {
  const user = userEvent.setup();
  const decideRecording = vi.fn(async () => ({ recording_id: "recording-1", status: "discarded" }));
  const api = createApi({ decideRecording });
  const statusSource = createStatusSource();

  render(<App api={api} statusSource={statusSource} />);

  await user.click(screen.getByRole("button", { name: /choose folder/i }));
  await user.click(screen.getByRole("button", { name: /start collection/i }));
  await user.click(screen.getByRole("button", { name: /start recording/i }));
  await user.click(screen.getByRole("button", { name: /stop recording/i }));
  await user.click(screen.getByRole("button", { name: /discard/i }));

  await waitFor(() => {
    expect(decideRecording).toHaveBeenCalledWith("recording-1", "discard");
  });
  expect(screen.getByRole("button", { name: /^next$/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^again$/i })).toBeInTheDocument();
});


test("allows changing active hands during a collection until recording starts", async () => {
  const user = userEvent.setup();
  const updateActiveHands = vi.fn(async (activeHands) => ({
    is_collecting: true,
    active_hands: activeHands,
  }));
  const api = createApi({ updateActiveHands });
  const statusSource = createStatusSource({ active_hands: "left" });

  render(<App api={api} statusSource={statusSource} />);

  await user.click(screen.getByRole("button", { name: /choose folder/i }));
  await user.click(screen.getByRole("button", { name: /start collection/i }));
  await screen.findByText(/do a precision pinch/i);

  await user.selectOptions(screen.getByLabelText(/active hands/i), "both");

  await waitFor(() => {
    expect(updateActiveHands).toHaveBeenCalledWith("both");
  });

  await user.click(screen.getByRole("button", { name: /start recording/i }));
  expect(screen.getByLabelText(/active hands/i)).toBeDisabled();
});


test("shows a live hand stage and allows focused-hand switching for both-hand collection", async () => {
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
  await user.click(screen.getByRole("button", { name: /start collection/i }));

  await screen.findByText(/live hand/i);
  expect(screen.getByText(/focused hand/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/hand skeleton viewer/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /left hand/i })).toHaveAttribute("aria-pressed", "true");

  await user.click(screen.getByRole("button", { name: /right hand/i }));

  expect(screen.getByRole("button", { name: /right hand/i })).toHaveAttribute("aria-pressed", "true");
});


test("shows dataset root on launch and a finish-collection summary screen", async () => {
  const user = userEvent.setup();
  const api = createApi();
  const statusSource = createStatusSource();

  render(<App api={api} statusSource={statusSource} />);

  await user.click(screen.getByRole("button", { name: /choose folder/i }));
  await user.click(screen.getByRole("button", { name: /start collection/i }));
  await screen.findByText(/do a precision pinch/i);

  await user.click(screen.getByRole("button", { name: /finish collection/i }));

  expect(await screen.findByText(/dataset folder: \/tmp\/dataset/i)).toBeInTheDocument();
  expect(screen.getByText(/saved recordings: 1/i)).toBeInTheDocument();
});


test("finish collection keeps the summary screen even if a stale collecting snapshot arrives", async () => {
  const user = userEvent.setup();
  const api = createApi();
  const statusSource = createStatusSource({
    is_collecting: true,
    active_hands: "left",
    dataset_root: "/tmp/dataset",
  });

  render(<App api={api} statusSource={statusSource} />);

  await screen.findByRole("button", { name: /finish collection/i });
  await user.click(screen.getByRole("button", { name: /finish collection/i }));

  expect(await screen.findByText(/collection finished/i)).toBeInTheDocument();

  statusSource.emit({
    is_collecting: true,
    active_hands: "left",
    current_state: "idle",
  });

  expect(screen.getByText(/collection finished/i)).toBeInTheDocument();
  expect(screen.queryByText(/do a precision pinch/i)).not.toBeInTheDocument();
});


test("fills dataset root from the native picker flow and uses the absolute path", async () => {
  const user = userEvent.setup();
  const pickDatasetRoot = vi.fn(async () => ({
    dataset_root: "/tmp/chosen-dataset",
  }));
  const startCollection = vi.fn(async ({ activeHands, datasetRoot }) => ({
    is_collecting: true,
    active_hands: activeHands,
    dataset_root: datasetRoot,
  }));
  const api = createApi({ pickDatasetRoot, startCollection });
  const statusSource = createStatusSource();

  render(<App api={api} statusSource={statusSource} />);

  await user.click(screen.getByRole("button", { name: /choose folder/i }));

  await waitFor(() => {
    expect(pickDatasetRoot).toHaveBeenCalled();
  });
  expect(screen.getAllByText(/\/tmp\/chosen-dataset/i).length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: /choose folder/i })).toHaveTextContent(/change folder/i);

  await user.click(screen.getByRole("button", { name: /start collection/i }));

  await waitFor(() => {
    expect(startCollection).toHaveBeenCalledWith(
      expect.objectContaining({ datasetRoot: "/tmp/chosen-dataset" }),
    );
  });
});


test("can start collection using the dataset root already present in the live snapshot", async () => {
  const user = userEvent.setup();
  const startCollection = vi.fn(async ({ activeHands, datasetRoot }) => ({
    is_collecting: true,
    active_hands: activeHands,
    dataset_root: datasetRoot,
  }));
  const api = createApi({ startCollection });
  const statusSource = createStatusSource({
    dataset_root: "/tmp/preselected-dataset",
  });

  render(<App api={api} statusSource={statusSource} />);

  expect(screen.getByText(/\/tmp\/preselected-dataset/i)).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: /start collection/i }));

  await waitFor(() => {
    expect(startCollection).toHaveBeenCalledWith(
      expect.objectContaining({ datasetRoot: "/tmp/preselected-dataset" }),
    );
  });
  expect(screen.queryByText(/choose a dataset folder before starting collection/i)).not.toBeInTheDocument();
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
