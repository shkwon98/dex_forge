import { useEffect, useState } from "react";

import { apiClient, createStatusSource } from "./api";
import { ThreeHandViewer } from "./ThreeHandViewer";
import "./styles.css";


function handModeLabel(activeHands) {
  if (activeHands === "left") {
    return "Left hand";
  }
  if (activeHands === "right") {
    return "Right hand";
  }
  return "Both hands";
}


function LaunchViewerPanel({ activeHands, previews }) {
  if (activeHands === "both") {
    return (
      <div className="launch-viewers">
        <ThreeHandViewer points={previews.left} focusedHand="left" />
        <ThreeHandViewer points={previews.right} focusedHand="right" />
      </div>
    );
  }

  return (
    <ThreeHandViewer
      points={activeHands === "right" ? previews.right : previews.left}
      focusedHand={activeHands === "right" ? "right" : "left"}
    />
  );
}


function FocusedHandToggle({ activeHands, focusedHand, onChange }) {
  if (activeHands !== "both") {
    return null;
  }

  return (
    <div className="focus-toggle">
      <span className="section-label">Focused hand</span>
      <div className="focus-actions">
        <button
          type="button"
          className={focusedHand === "left" ? "focus-button active" : "focus-button"}
          aria-pressed={focusedHand === "left"}
          onClick={() => onChange("left")}
        >
          Left hand
        </button>
        <button
          type="button"
          className={focusedHand === "right" ? "focus-button active" : "focus-button"}
          aria-pressed={focusedHand === "right"}
          onClick={() => onChange("right")}
        >
          Right hand
        </button>
      </div>
    </div>
  );
}


export function App({ api = apiClient, statusSource: providedStatusSource }) {
  const [statusSource] = useState(() => providedStatusSource ?? createStatusSource());
  const [activeHands, setActiveHands] = useState("left");
  const [datasetRoot, setDatasetRoot] = useState("");
  const [collection, setCollection] = useState(null);
  const [prompt, setPrompt] = useState(null);
  const [recording, setRecording] = useState(false);
  const [reviewRecording, setReviewRecording] = useState(null);
  const [reviewResolution, setReviewResolution] = useState(null);
  const [reviewFrameIndex, setReviewFrameIndex] = useState(0);
  const [recordingNote, setRecordingNote] = useState("");
  const [finishedSummary, setFinishedSummary] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [liveSnapshot, setLiveSnapshot] = useState({
    is_collecting: false,
    current_state: "idle",
    dataset_root: "",
    accepted_recording_count: 0,
    hand_pose_preview: { left: [], right: [] },
    active_hands: "left",
  });
  const [focusedHand, setFocusedHand] = useState("left");

  useEffect(() => {
    const unsubscribe = statusSource.subscribe((snapshot) => {
      setLiveSnapshot((current) => ({ ...current, ...snapshot }));
    });
    return unsubscribe;
  }, [statusSource]);

  useEffect(() => {
    if (liveSnapshot.is_collecting && !collection && !finishedSummary) {
      setCollection({
        active_hands: liveSnapshot.active_hands,
        dataset_root: liveSnapshot.dataset_root,
      });
    }
  }, [collection, finishedSummary, liveSnapshot]);

  useEffect(() => {
    const currentMode = collection?.active_hands ?? activeHands;
    if (currentMode === "right") {
      setFocusedHand("right");
    } else if (currentMode === "left") {
      setFocusedHand("left");
    }
  }, [activeHands, collection?.active_hands]);

  useEffect(() => {
    setReviewFrameIndex(0);
  }, [focusedHand, reviewRecording?.recording_id]);

  useEffect(() => {
    const reviewFrames = reviewRecording?.review_preview?.[focusedHand] ?? [];
    if (!reviewRecording || reviewFrames.length <= 1) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setReviewFrameIndex((current) => (current + 1) % reviewFrames.length);
    }, 220);

    return () => window.clearInterval(intervalId);
  }, [focusedHand, reviewRecording]);

  const effectiveDatasetRoot = datasetRoot || liveSnapshot.dataset_root || "";

  async function handleStartCollection(event) {
    event.preventDefault();
    setErrorMessage("");
    try {
      if (!effectiveDatasetRoot) {
        throw new Error("Choose a dataset folder before starting collection.");
      }
      const started = await api.startCollection({
        activeHands,
        datasetRoot: effectiveDatasetRoot,
      });
      const firstPrompt = await api.getNextPrompt();
      setCollection(started);
      setDatasetRoot(started.dataset_root || effectiveDatasetRoot);
      setPrompt(firstPrompt);
      setReviewRecording(null);
      setReviewResolution(null);
      setFinishedSummary(null);
      setRecording(false);
    } catch (error) {
      setErrorMessage(error.message || "Failed to start collection.");
    }
  }

  async function handleBrowseDatasetRoot() {
    setErrorMessage("");
    try {
      const selection = await api.pickDatasetRoot();
      if (!selection.dataset_root) {
        return;
      }
      setDatasetRoot(selection.dataset_root);
    } catch (error) {
      setErrorMessage(error.message || "Failed to choose a dataset directory.");
    }
  }

  async function handleRefreshPrompt() {
    setErrorMessage("");
    try {
      const nextPrompt = await api.getNextPrompt();
      setPrompt(nextPrompt);
      setReviewRecording(null);
      setReviewResolution(null);
      setRecording(false);
    } catch (error) {
      setErrorMessage(error.message || "Failed to load a prompt.");
    }
  }

  async function handleActiveHandsChange(nextHands) {
    if (!collection || recording) {
      return;
    }

    setErrorMessage("");
    try {
      const updated = await api.updateActiveHands(nextHands);
      setCollection(updated);
      setActiveHands(updated.active_hands);
    } catch (error) {
      setErrorMessage(error.message || "Failed to update active hands.");
    }
  }

  async function handleStartRecording() {
    if (!prompt) {
      return;
    }
    setErrorMessage("");
    try {
      await api.startRecording();
      setRecording(true);
      setReviewRecording(null);
    } catch (error) {
      setErrorMessage(error.message || "Failed to start recording.");
    }
  }

  async function handleStopRecording() {
    setErrorMessage("");
    try {
      const stopped = await api.stopRecording();
      setRecording(false);
      setReviewRecording(stopped);
      setReviewResolution(null);
    } catch (error) {
      setErrorMessage(error.message || "Failed to stop recording.");
    }
  }

  async function handleSaveNote() {
    if (!recordingNote) {
      return;
    }
    setErrorMessage("");
    try {
      await api.addNote(recordingNote);
      setRecordingNote("");
    } catch (error) {
      setErrorMessage(error.message || "Failed to save note.");
    }
  }

  async function handleReviewDecision(decision) {
    if (!reviewRecording) {
      return;
    }
    setErrorMessage("");
    try {
      const resolvedDecision = decision === "confirm" ? "accept" : "discard";
      await api.decideRecording(reviewRecording.recording_id, resolvedDecision);
      setReviewResolution(decision);
      setRecording(false);
      return null;
    } catch (error) {
      setErrorMessage(error.message || "Failed to update recording decision.");
      return null;
    }
  }

  async function handleAfterReview(action) {
    setErrorMessage("");
    try {
      if (action === "next") {
        setPrompt(await api.getNextPrompt());
      }
      setReviewRecording(null);
      setReviewResolution(null);
      setRecording(false);
    } catch (error) {
      setErrorMessage(error.message || "Failed to load the next prompt.");
    }
  }

  async function handleFinishCollection() {
    setErrorMessage("");
    try {
      const summary = await api.finishCollection();
      setFinishedSummary(summary);
      setDatasetRoot(summary.dataset_root || datasetRoot);
      setLiveSnapshot((current) => ({
        ...current,
        is_collecting: false,
        current_state: "idle",
        dataset_root: summary.dataset_root || current.dataset_root,
      }));
      setCollection(null);
      setPrompt(null);
      setReviewRecording(null);
      setReviewResolution(null);
      setRecording(false);
    } catch (error) {
      setErrorMessage(error.message || "Failed to finish collection.");
    }
  }

  const currentMode = collection?.active_hands ?? activeHands;
  const reviewFrames = reviewRecording?.review_preview?.[focusedHand] ?? [];
  const visiblePoints = reviewRecording
    ? (reviewFrames[reviewFrameIndex % Math.max(reviewFrames.length, 1)] ?? [])
    : (liveSnapshot.hand_pose_preview?.[focusedHand] ?? []);
  const promptHeadline = reviewRecording
    ? "Review the recorded sample."
    : prompt?.prompt_text || "Load a prompt to begin.";
  const datasetPathDescription = effectiveDatasetRoot || "No dataset folder selected";
  const acceptedRecordingCount = liveSnapshot.accepted_recording_count ?? 0;

  return (
    <div className="page-shell">
      <main className="app-shell">
        <header className="app-header">
          <div>
            <p className="app-title">DexForge</p>
            <p className="app-caption">Hand motion data collection</p>
          </div>
          <div className="header-chip">{handModeLabel(currentMode)}</div>
        </header>

        {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}

        {!collection ? (
          <section className="launch-shell">
            <form className="launch-panel" onSubmit={handleStartCollection}>
              <div className="panel-heading">
                <p className="section-label">Start Collection</p>
                <h1>Choose the hand mode and begin collecting recordings.</h1>
              </div>

              <label>
                Active hands
                <select
                  aria-label="Active hands"
                  value={activeHands}
                  onChange={(event) => setActiveHands(event.target.value)}
                >
                  <option value="left">Left</option>
                  <option value="right">Right</option>
                  <option value="both">Both</option>
                </select>
              </label>

              <div className="field-group">
                <p className="field-label">Dataset root</p>
                <div className="dataset-root-card" data-testid="dataset-root-card">
                  <div className="dataset-root-copy">
                    <p className="dataset-root-label">Current location</p>
                    <p className="dataset-root-path">{datasetPathDescription}</p>
                    <p className="dataset-root-hint">
                      {effectiveDatasetRoot
                        ? "DexForge will save task folders and MCAP recordings directly to this path."
                        : "Choose a dataset folder before starting collection."}
                    </p>
                  </div>
                  <div className="dataset-root-actions">
                    <button
                      type="button"
                      aria-label="Choose folder"
                      className="secondary-action"
                      onClick={handleBrowseDatasetRoot}
                    >
                      {effectiveDatasetRoot ? "Change folder" : "Choose folder"}
                    </button>
                  </div>
                </div>
              </div>

              <button type="submit" className="primary-action">
                Start collection
              </button>
            </form>

            {finishedSummary ? (
              <section className="summary-panel">
                <div className="panel-heading">
                  <p className="section-label">Collection Saved</p>
                  <h1>Collection finished. You can close DexForge or begin another run.</h1>
                </div>
                <p className="summary-line">Dataset folder: {finishedSummary.dataset_root || datasetPathDescription}</p>
                <p className="summary-line">Saved recordings: {finishedSummary.accepted_count}</p>
                <p className="summary-line">Discarded recordings: {finishedSummary.discarded_count}</p>
                <p className="summary-line">Invalid recordings: {finishedSummary.invalid_count}</p>
              </section>
            ) : null}

            <LaunchViewerPanel activeHands={activeHands} previews={liveSnapshot.hand_pose_preview} />
          </section>
        ) : (
          <section className="capture-shell">
            <section className="capture-stage">
              <div className="status-row">
                <div>
                  <p className="section-label">Collection</p>
                  <strong>{handModeLabel(collection.active_hands)}</strong>
                </div>
                <label className="session-hand-mode">
                  <span className="section-label">Active hands</span>
                  <select
                    aria-label="Active hands"
                    value={collection.active_hands}
                    disabled={recording}
                    onChange={(event) => handleActiveHandsChange(event.target.value)}
                  >
                    <option value="left">Left</option>
                    <option value="right">Right</option>
                    <option value="both">Both</option>
                  </select>
                </label>
                <div className="header-chip">Saved {acceptedRecordingCount}</div>
              </div>

              <div className="prompt-stage">
                <p className="section-label">Prompt</p>
                <div className="prompt-copy">
                  <h1 className="prompt-headline">{promptHeadline}</h1>
                  <p className="prompt-meta">
                    {prompt ? `${prompt.category} / ${prompt.action} / ${prompt.variation}` : "No prompt"}
                  </p>
                  <p className="prompt-support">
                    {reviewRecording
                      ? reviewRecording.failure_reason
                        ? `Failure reason: ${reviewRecording.failure_reason}`
                        : reviewResolution === "confirm"
                          ? "Confirmed. Choose Next for a new prompt or Again to record the same prompt once more."
                          : reviewResolution === "discard"
                            ? "Discarded. Choose Next for a new prompt or Again to retry the same prompt."
                            : "Confirm or discard this recording first."
                      : recording
                        ? "Recording in progress"
                        : "Ready"}
                  </p>
                </div>

                <div className="action-deck">
                  {prompt && !recording && !reviewRecording ? (
                    <button type="button" className="record-action" onClick={handleStartRecording}>
                      Start recording
                    </button>
                  ) : null}

                  {recording ? (
                    <button type="button" className="stop-action" onClick={handleStopRecording}>
                      Stop recording
                    </button>
                  ) : null}

                  {reviewRecording ? (
                    <>
                      {!reviewResolution ? (
                        <>
                          <button type="button" className="primary-action" onClick={() => handleReviewDecision("confirm")}>
                            Confirm
                          </button>
                          <button type="button" className="secondary-action" onClick={() => handleReviewDecision("discard")}>
                            Discard
                          </button>
                        </>
                      ) : (
                        <>
                          <button type="button" className="secondary-action" onClick={() => handleAfterReview("again")}>
                            Again
                          </button>
                          <button type="button" className="primary-action" onClick={() => handleAfterReview("next")}>
                            Next
                          </button>
                        </>
                      )}
                    </>
                  ) : null}

                  {!recording && !reviewRecording ? (
                    <button type="button" className="secondary-action" onClick={handleRefreshPrompt}>
                      Change prompt
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="annotation-strip">
                <label className="annotation-input">
                  <span className="section-label">Recording note</span>
                  <input
                    aria-label="Recording note"
                    value={recordingNote}
                    onChange={(event) => setRecordingNote(event.target.value)}
                    placeholder="Optional note for this recording"
                  />
                </label>
                <button type="button" className="secondary-action" onClick={handleSaveNote}>
                  Save note
                </button>
              </div>

              {!recording && !reviewRecording ? (
                <div className="session-actions">
                  <button type="button" className="secondary-action" onClick={handleFinishCollection}>
                    Finish collection
                  </button>
                </div>
              ) : null}
            </section>

            <aside className="viewer-shell">
              <FocusedHandToggle
                activeHands={currentMode}
                focusedHand={focusedHand}
                onChange={setFocusedHand}
              />
              <ThreeHandViewer points={visiblePoints} focusedHand={focusedHand} />
            </aside>
          </section>
        )}
      </main>
    </div>
  );
}
