import { useEffect, useState } from "react";

import { apiClient, createStatusSource } from "./api";
import "./styles.css";


const BONE_CHAINS = [
  [0, 1, 2, 3, 4],
  [0, 5, 6, 7, 8],
  [0, 9, 10, 11, 12],
  [0, 13, 14, 15, 16],
  [0, 17, 18, 19, 20],
  [0, 21, 22, 23, 24],
];


function handModeLabel(activeHands) {
  if (activeHands === "left") {
    return "Left hand";
  }
  if (activeHands === "right") {
    return "Right hand";
  }
  return "Both hands";
}


function normalizePoints(points) {
  if (!points?.length) {
    return [];
  }

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = Math.max(maxX - minX, 0.001);
  const height = Math.max(maxY - minY, 0.001);

  return points.map((point) => ({
    ...point,
    nx: 44 + ((point.x - minX) / width) * 232,
    ny: 236 - ((point.y - minY) / height) * 180,
  }));
}


function SkeletonViewer({ points, focusedHand }) {
  const normalized = normalizePoints(points);

  return (
    <section className="viewer-card">
      <div className="viewer-header">
        <div>
          <p className="section-label">Live Hand</p>
          <h2>{focusedHand === "left" ? "Left hand" : "Right hand"}</h2>
        </div>
        <div className={normalized.length ? "viewer-status live" : "viewer-status"}>
          {normalized.length ? "Live" : "Waiting"}
        </div>
      </div>
      <svg
        aria-label="Hand skeleton viewer"
        className="viewer-stage"
        viewBox="0 0 320 280"
        role="img"
      >
        <rect x="18" y="18" width="284" height="244" rx="28" className="viewer-plate" />
        {normalized.length ? (
          <>
            {BONE_CHAINS.map((chain, index) =>
              chain.slice(0, -1).map((jointIndex, segmentIndex) => {
                const start = normalized[jointIndex];
                const end = normalized[chain[segmentIndex + 1]];
                if (!start || !end) {
                  return null;
                }
                return (
                  <line
                    key={`${index}-${jointIndex}`}
                    x1={start.nx}
                    y1={start.ny}
                    x2={end.nx}
                    y2={end.ny}
                    className="viewer-bone"
                  />
                );
              }),
            )}
            {normalized.map((point, index) => (
              <circle
                key={`${point.frame_id}-${index}`}
                cx={point.nx}
                cy={point.ny}
                r={index === 0 ? 7 : 5}
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
        <span>{normalized[0]?.frame_id || "No frame id"}</span>
        <span>{normalized.length} joints</span>
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
  const [session, setSession] = useState(null);
  const [prompt, setPrompt] = useState(null);
  const [recording, setRecording] = useState(false);
  const [reviewClip, setReviewClip] = useState(null);
  const [clipNote, setClipNote] = useState("");
  const [lastOutcome, setLastOutcome] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [liveSnapshot, setLiveSnapshot] = useState({
    current_state: "idle",
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

  async function handleStartSession(event) {
    event.preventDefault();
    setErrorMessage("");
    try {
      const created = await api.createSession({
        activeHands,
        notes: sessionNotes,
      });
      const firstPrompt = await api.getNextPrompt();
      setSession(created);
      setPrompt(firstPrompt);
      setLastOutcome("");
      setReviewClip(null);
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
      } else if (result.status === "discarded") {
        setLastOutcome("Last clip discarded");
      } else {
        setLastOutcome("Retry ready");
      }
    } catch (error) {
      setErrorMessage(error.message || "Failed to update clip decision.");
    }
  }

  const currentMode = session?.active_hands ?? activeHands;
  const visiblePoints = liveSnapshot.hand_pose_preview?.[focusedHand] ?? [];
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

              <button type="submit" className="primary-action">
                Start session
              </button>
            </form>

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
                {lastOutcome ? <div className="header-chip">{lastOutcome}</div> : null}
              </div>

              <div className="prompt-stage">
                <p className="section-label">Prompt</p>
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

                  {!recording ? (
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
