import { useEffect, useMemo, useRef, useState } from "react";

import { apiClient, createStatusSource } from "./api";
import {
  buildBoneChains,
  buildViewerGuides,
  defaultViewState,
  projectHandPoints,
  updateViewState,
} from "./handView";
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


function promptMatchesHands(prompt, activeHands) {
  if (!prompt) {
    return false;
  }
  if (activeHands === "left") {
    return prompt.allowed_hands === "left" || prompt.allowed_hands === "either";
  }
  if (activeHands === "right") {
    return prompt.allowed_hands === "right" || prompt.allowed_hands === "either";
  }
  return ["left", "right", "both", "either"].includes(prompt.allowed_hands);
}


function SkeletonViewer({ points, focusedHand }) {
  const [viewState, setViewState] = useState(() => defaultViewState(focusedHand));
  const dragRef = useRef(null);
  const projected = useMemo(() => projectHandPoints(points, viewState), [points, viewState]);
  const boneChains = useMemo(() => buildBoneChains(points?.length ?? 0), [points]);
  const guides = useMemo(() => buildViewerGuides(points, viewState), [points, viewState]);

  useEffect(() => {
    setViewState(defaultViewState(focusedHand));
  }, [focusedHand]);

  function handlePointerDown(event) {
    dragRef.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event) {
    if (!dragRef.current) {
      return;
    }
    const deltaX = event.clientX - dragRef.current.x;
    const deltaY = event.clientY - dragRef.current.y;
    dragRef.current = { x: event.clientX, y: event.clientY };
    setViewState((current) => updateViewState(current, deltaX, deltaY));
  }

  function handlePointerUp() {
    dragRef.current = null;
  }

  function handleWheel(event) {
    event.preventDefault();
    const deltaZoom = event.deltaY < 0 ? 0.08 : -0.08;
    setViewState((current) => updateViewState(current, 0, 0, deltaZoom));
  }

  return (
    <section className="viewer-card">
      <div className="viewer-header">
        <div>
          <p className="section-label">Live Hand</p>
          <h2>{focusedHand === "left" ? "Left hand" : "Right hand"}</h2>
          <p className="viewer-hint">Drag to orbit. Scroll to zoom.</p>
        </div>
        <div className={projected.length ? "viewer-status live" : "viewer-status"}>
          {projected.length ? "Live" : "Waiting"}
        </div>
      </div>
      <svg
        aria-label="Hand skeleton viewer"
        className="viewer-stage"
        viewBox="0 0 320 280"
        role="img"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onWheel={handleWheel}
      >
        <rect x="18" y="18" width="284" height="244" rx="28" className="viewer-plate" />
        {guides.grid.map((line, index) => (
          <line
            key={`grid-${index}`}
            x1={line.start.px}
            y1={line.start.py}
            x2={line.end.px}
            y2={line.end.py}
            className="viewer-grid"
          />
        ))}
        {guides.axes.map((axis) => (
          <g key={axis.key}>
            <line
              x1={axis.start.px}
              y1={axis.start.py}
              x2={axis.end.px}
              y2={axis.end.py}
              className={`viewer-axis viewer-axis-${axis.key}`}
            />
            <text
              x={axis.end.px + 6}
              y={axis.end.py - 6}
              className={`viewer-axis-label viewer-axis-label-${axis.key}`}
            >
              {axis.label}
            </text>
          </g>
        ))}
        {projected.length ? (
          <>
            <ellipse cx="160" cy="228" rx="82" ry="16" className="viewer-shadow" />
            {boneChains.map((chain, index) =>
              chain.slice(0, -1).map((jointIndex, segmentIndex) => {
                const start = projected[jointIndex];
                const end = projected[chain[segmentIndex + 1]];
                if (!start || !end) {
                  return null;
                }
                return (
                  <line
                    key={`${index}-${jointIndex}`}
                    x1={start.px}
                    y1={start.py}
                    x2={end.px}
                    y2={end.py}
                    className="viewer-bone"
                  />
                );
              }),
            )}
            {[...projected]
              .sort((left, right) => left.depth - right.depth)
              .map((point, index) => (
              <circle
                key={`${point.frame_id}-${index}`}
                cx={point.px}
                cy={point.py}
                r={index === 0 ? 7 : 4.8}
                className={index === 0 ? "viewer-joint viewer-joint-root" : "viewer-joint"}
              />
              ))}
          </>
        ) : (
          <text x="160" y="146" textAnchor="middle" className="viewer-empty">
            Waiting for pose stream
          </text>
        )}
      </svg>
      <div className="viewer-footer">
        <span>{projected[0]?.frame_id || "No frame id"}</span>
        <span>{projected.length} joints</span>
      </div>
    </section>
  );
}


function LaunchViewerPanel({ activeHands, previews }) {
  if (activeHands === "both") {
    return (
      <div className="launch-viewers">
        <SkeletonViewer points={previews.left} focusedHand="left" />
        <SkeletonViewer points={previews.right} focusedHand="right" />
      </div>
    );
  }

  return (
    <SkeletonViewer
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
  const [sessionNotes, setSessionNotes] = useState("");
  const [datasetRoot, setDatasetRoot] = useState("");
  const [session, setSession] = useState(null);
  const [prompt, setPrompt] = useState(null);
  const [recording, setRecording] = useState(false);
  const [reviewClip, setReviewClip] = useState(null);
  const [reviewFrameIndex, setReviewFrameIndex] = useState(0);
  const [clipNote, setClipNote] = useState("");
  const [lastOutcome, setLastOutcome] = useState("");
  const [finishedSummary, setFinishedSummary] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [liveSnapshot, setLiveSnapshot] = useState({
    current_state: "idle",
    dataset_root: "",
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
    const currentMode = session?.active_hands ?? activeHands;
    if (currentMode === "right") {
      setFocusedHand("right");
    } else if (currentMode === "left") {
      setFocusedHand("left");
    }
  }, [activeHands, session?.active_hands]);

  useEffect(() => {
    if (!session && !datasetRoot && liveSnapshot.dataset_root) {
      setDatasetRoot(liveSnapshot.dataset_root);
    }
  }, [datasetRoot, liveSnapshot.dataset_root, session]);

  useEffect(() => {
    setReviewFrameIndex(0);
  }, [focusedHand, reviewClip?.clip_id]);

  useEffect(() => {
    const reviewFrames = reviewClip?.review_preview?.[focusedHand] ?? [];
    if (!reviewClip || reviewFrames.length <= 1) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setReviewFrameIndex((current) => (current + 1) % reviewFrames.length);
    }, 220);

    return () => window.clearInterval(intervalId);
  }, [focusedHand, reviewClip]);

  async function handleStartSession(event) {
    event.preventDefault();
    setErrorMessage("");
    try {
      const created = await api.createSession({
        activeHands,
        notes: sessionNotes,
        datasetRoot,
      });
      const firstPrompt = await api.getNextPrompt();
      setSession(created);
      setPrompt(firstPrompt);
      setLastOutcome("");
      setReviewClip(null);
      setFinishedSummary(null);
      setRecording(false);
    } catch (error) {
      setErrorMessage(error.message || "Failed to start session.");
    }
  }

  async function handleRefreshPrompt() {
    setErrorMessage("");
    try {
      const nextPrompt = await api.getNextPrompt();
      setPrompt(nextPrompt);
      setReviewClip(null);
      setRecording(false);
    } catch (error) {
      setErrorMessage(error.message || "Failed to load a prompt.");
    }
  }

  async function handleActiveHandsChange(nextHands) {
    if (!session || recording) {
      return;
    }

    setErrorMessage("");
    try {
      const updatedSession = await api.updateActiveHands(nextHands);
      setSession((current) => ({ ...current, ...updatedSession }));
      setActiveHands(updatedSession.active_hands);

      if (!reviewClip && !promptMatchesHands(prompt, updatedSession.active_hands)) {
        const nextPrompt = await api.getNextPrompt();
        setPrompt(nextPrompt);
      }
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
      await api.startClip();
      setRecording(true);
      setReviewClip(null);
    } catch (error) {
      setErrorMessage(error.message || "Failed to start recording.");
    }
  }

  async function handleStopRecording() {
    setErrorMessage("");
    try {
      const stopped = await api.stopClip();
      setRecording(false);
      setReviewClip(stopped);
    } catch (error) {
      setErrorMessage(error.message || "Failed to stop recording.");
    }
  }

  async function handleSaveNote() {
    if (!clipNote) {
      return;
    }
    setErrorMessage("");
    try {
      await api.addNote(clipNote);
      setClipNote("");
    } catch (error) {
      setErrorMessage(error.message || "Failed to save note.");
    }
  }

  async function handleDecision(decision) {
    if (!reviewClip) {
      return;
    }
    setErrorMessage("");
    try {
      const result = await api.decideClip(reviewClip.clip_id, decision);
      setReviewClip(null);
      setRecording(false);
      if (result.status === "accepted") {
        setLastOutcome("Last clip accepted");
        setPrompt(await api.getNextPrompt());
      } else if (result.status === "discarded") {
        setLastOutcome("Last clip discarded");
        setPrompt(await api.getNextPrompt());
      } else {
        setLastOutcome("Retry ready");
      }

      const updatedHands = session?.active_hands ?? activeHands;
      if (!promptMatchesHands(prompt, updatedHands)) {
        const nextPrompt = await api.getNextPrompt();
        setPrompt(nextPrompt);
      }
    } catch (error) {
      setErrorMessage(error.message || "Failed to update clip decision.");
    }
  }

  async function handleFinishSession() {
    setErrorMessage("");
    try {
      const summary = await api.finishSession();
      setFinishedSummary(summary);
      setSession(null);
      setPrompt(null);
      setReviewClip(null);
      setRecording(false);
      setLastOutcome("");
    } catch (error) {
      setErrorMessage(error.message || "Failed to finish session.");
    }
  }

  const currentMode = session?.active_hands ?? activeHands;
  const reviewFrames = reviewClip?.review_preview?.[focusedHand] ?? [];
  const visiblePoints = reviewClip
    ? (reviewFrames[reviewFrameIndex % Math.max(reviewFrames.length, 1)] ?? [])
    : (liveSnapshot.hand_pose_preview?.[focusedHand] ?? []);
  const promptHeadline = reviewClip
    ? "Review the recorded clip."
    : prompt?.prompt_text || "Loading prompt...";

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

        {!session ? (
          <section className="launch-shell">
            <form className="launch-panel" onSubmit={handleStartSession}>
              <div className="panel-heading">
                <p className="section-label">Start Session</p>
                <h1>Choose the hand mode and start recording.</h1>
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

              <label>
                Session notes
                <textarea
                  aria-label="Session notes"
                  value={sessionNotes}
                  onChange={(event) => setSessionNotes(event.target.value)}
                  rows={4}
                  placeholder="Optional notes about props, setup, or special conditions"
                />
              </label>

              <label>
                Dataset root
                <input
                  aria-label="Dataset root"
                  value={datasetRoot}
                  onChange={(event) => setDatasetRoot(event.target.value)}
                  placeholder="Where DexForge should save sessions and clips"
                />
              </label>

              <button type="submit" className="primary-action">
                Start session
              </button>
            </form>

            {finishedSummary ? (
              <section className="summary-panel">
                <div className="panel-heading">
                  <p className="section-label">Session Saved</p>
                  <h1>Session saved and ready to close or start a new run.</h1>
                </div>
                <p className="summary-line">Dataset root: {finishedSummary.dataset_root}</p>
                <p className="summary-line">Accepted clips: {finishedSummary.accepted_count}</p>
                <p className="summary-line">Discarded clips: {finishedSummary.discarded_count}</p>
                <p className="summary-line">Invalid clips: {finishedSummary.invalid_count}</p>
              </section>
            ) : null}

            <LaunchViewerPanel activeHands={activeHands} previews={liveSnapshot.hand_pose_preview} />
          </section>
        ) : (
          <section className="capture-shell">
            <section className="capture-stage">
              <div className="status-row">
                <div>
                  <p className="section-label">Session</p>
                  <strong>{handModeLabel(session.active_hands)}</strong>
                </div>
                <label className="session-hand-mode">
                  <span className="section-label">Active hands</span>
                  <select
                    aria-label="Active hands"
                    value={session.active_hands}
                    disabled={recording}
                    onChange={(event) => handleActiveHandsChange(event.target.value)}
                  >
                    <option value="left">Left</option>
                    <option value="right">Right</option>
                    <option value="both">Both</option>
                  </select>
                </label>
                {lastOutcome ? <div className="header-chip">{lastOutcome}</div> : null}
              </div>

              <div className="prompt-stage">
                <p className="section-label">Prompt</p>
                <div className="prompt-copy">
                  <h1 className="prompt-headline">{promptHeadline}</h1>
                  <p className="prompt-meta">
                    {prompt ? `${prompt.category} / ${prompt.action} / ${prompt.variation}` : "No prompt"}
                  </p>
                  <p className="prompt-support">
                    {reviewClip
                      ? reviewClip.failure_reason
                        ? `Failure reason: ${reviewClip.failure_reason}`
                        : "Choose accept, discard, or retry."
                      : recording
                        ? "Recording in progress"
                        : "Ready"}
                  </p>
                </div>

                <div className="action-deck">
                  {prompt && !recording && !reviewClip ? (
                    <button type="button" className="record-action" onClick={handleStartRecording}>
                      Start recording
                    </button>
                  ) : null}

                  {recording ? (
                    <button type="button" className="stop-action" onClick={handleStopRecording}>
                      Stop recording
                    </button>
                  ) : null}

                  {reviewClip ? (
                    <>
                      <button type="button" className="primary-action" onClick={() => handleDecision("accept")}>
                        Accept clip
                      </button>
                      <button type="button" className="secondary-action" onClick={() => handleDecision("discard")}>
                        Discard clip
                      </button>
                      <button type="button" className="secondary-action" onClick={() => handleDecision("retry")}>
                        Retry clip
                      </button>
                    </>
                  ) : null}

                  {!recording && !reviewClip ? (
                    <button type="button" className="secondary-action" onClick={handleRefreshPrompt}>
                      Change prompt
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="annotation-strip">
                <label className="annotation-input">
                  <span className="section-label">Clip note</span>
                  <input
                    aria-label="Clip note"
                    value={clipNote}
                    onChange={(event) => setClipNote(event.target.value)}
                    placeholder="Optional note for this clip"
                  />
                </label>
                <button type="button" className="secondary-action" onClick={handleSaveNote}>
                  Save note
                </button>
              </div>

              {!recording && !reviewClip ? (
                <div className="session-actions">
                  <button type="button" className="secondary-action" onClick={handleFinishSession}>
                    Finish session
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
              <SkeletonViewer points={visiblePoints} focusedHand={focusedHand} />
            </aside>
          </section>
        )}
      </main>
    </div>
  );
}
