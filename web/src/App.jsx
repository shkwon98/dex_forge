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
    return "Left hand session";
  }
  if (activeHands === "right") {
    return "Right hand session";
  }
  return "Both hand session";
}


function statusLabel(state, fallback) {
  if (state === "recording") {
    return "Recording in progress";
  }
  if (state === "review") {
    return "Review clip";
  }
  if (state === "armed") {
    return "Clip armed";
  }
  return fallback;
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
    nx: 42 + ((point.x - minX) / width) * 236,
    ny: 246 - ((point.y - minY) / height) * 184,
  }));
}


function SkeletonViewer({ points, focusedHand }) {
  const normalized = normalizePoints(points);

  return (
    <div className="viewer-card">
      <div className="viewer-meta">
        <div>
          <p className="kicker">Live hand stage</p>
          <h3>{focusedHand === "left" ? "Left hand" : "Right hand"} skeleton</h3>
        </div>
        <div className="viewer-pill">{normalized.length ? "Stream alive" : "Awaiting pose"}</div>
      </div>
      <svg
        aria-label="Hand skeleton viewer"
        className="viewer-stage"
        viewBox="0 0 320 280"
        role="img"
      >
        <defs>
          <radialGradient id="viewerGlow" cx="50%" cy="30%" r="70%">
            <stop offset="0%" stopColor="rgba(197,94,32,0.24)" />
            <stop offset="100%" stopColor="rgba(197,94,32,0)" />
          </radialGradient>
        </defs>
        <rect x="18" y="18" width="284" height="244" rx="30" className="viewer-plate" />
        <rect x="30" y="30" width="260" height="220" rx="22" fill="url(#viewerGlow)" />
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
          <text x="160" y="148" textAnchor="middle" className="viewer-empty">
            Waiting for pose stream
          </text>
        )}
      </svg>
      <div className="viewer-footer">
        <span>{normalized[0]?.frame_id || "No frame id yet"}</span>
        <span>{normalized.length} joints</span>
      </div>
    </div>
  );
}


function FocusedHandToggle({ activeHands, focusedHand, onChange }) {
  if (activeHands !== "both") {
    return null;
  }

  return (
    <div className="focus-toggle">
      <span className="focus-label">Focused hand</span>
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


export function App({ api = apiClient, statusSource = createStatusSource() }) {
  const [operatorId, setOperatorId] = useState("");
  const [activeHands, setActiveHands] = useState("left");
  const [sessionNotes, setSessionNotes] = useState("");
  const [session, setSession] = useState(null);
  const [prompt, setPrompt] = useState(null);
  const [armedClip, setArmedClip] = useState(null);
  const [recording, setRecording] = useState(false);
  const [reviewClip, setReviewClip] = useState(null);
  const [clipNote, setClipNote] = useState("");
  const [statusMessage, setStatusMessage] = useState("Awaiting session");
  const [lastOutcome, setLastOutcome] = useState("");
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
    const currentMode = session?.active_hands ?? liveSnapshot.active_hands;
    if (currentMode === "right") {
      setFocusedHand("right");
    } else if (currentMode === "left") {
      setFocusedHand("left");
    } else if (!["left", "right"].includes(focusedHand)) {
      setFocusedHand("left");
    }
  }, [session?.active_hands, liveSnapshot.active_hands, focusedHand]);

  async function handleStartSession(event) {
    event.preventDefault();
    const created = await api.createSession({
      operatorId,
      activeHands,
      notes: sessionNotes,
    });
    setSession(created);
    setStatusMessage("Awaiting prompt");
    setLastOutcome("");
    setPrompt(null);
    setArmedClip(null);
    setReviewClip(null);
    setRecording(false);
  }

  async function handleNextPrompt() {
    const nextPrompt = await api.getNextPrompt();
    setPrompt(nextPrompt);
    setArmedClip(null);
    setReviewClip(null);
    setStatusMessage("Prompt ready");
  }

  async function handleArmClip() {
    if (!prompt) {
      return;
    }
    const armed = await api.armClip(prompt.id);
    setArmedClip(armed);
    setStatusMessage("Clip armed");
  }

  async function handleStartRecording() {
    await api.startClip();
    setRecording(true);
    setReviewClip(null);
    setStatusMessage("Recording in progress");
  }

  async function handleStopRecording() {
    const stopped = await api.stopClip();
    setRecording(false);
    setReviewClip(stopped);
    setStatusMessage(stopped.failure_reason ? "Clip invalid" : "Review clip");
  }

  async function handleSaveNote() {
    if (!clipNote) {
      return;
    }
    await api.addNote(clipNote);
    setStatusMessage("Clip note saved");
    setClipNote("");
  }

  async function handleDecision(decision) {
    if (!reviewClip) {
      return;
    }
    const result = await api.decideClip(reviewClip.clip_id, decision);
    setReviewClip(null);
    setArmedClip(null);
    setRecording(false);
    if (result.status === "accepted") {
      setLastOutcome("Last clip accepted");
      setStatusMessage("Ready for the next prompt");
    } else if (result.status === "discarded") {
      setLastOutcome("Last clip discarded");
      setStatusMessage("Ready for the next prompt");
    } else {
      setLastOutcome("Retry armed");
      setStatusMessage("Clip armed");
      setArmedClip(result);
    }
  }

  const currentMode = session?.active_hands ?? liveSnapshot.active_hands ?? activeHands;
  const visiblePoints = liveSnapshot.hand_pose_preview?.[focusedHand] ?? [];
  const promptHeadline = reviewClip
    ? "Review the last capture before committing it."
    : prompt?.prompt_text || "Request the next motion and keep the operator focused on one action at a time.";

  return (
    <div className="page-shell">
      <main className="stage-frame">
        <section className="masthead">
          <div>
            <p className="eyebrow">DexForge</p>
            <h1>Editorial-grade capture stage for dexterous hand data.</h1>
          </div>
          <p className="subhead">
            One prompt, one decision, one live skeleton console. The interface stays calm while the demo floor stays busy.
          </p>
        </section>

        {!session ? (
          <section className="launch-shell">
            <form className="launch-panel" onSubmit={handleStartSession}>
              <p className="kicker">Session launch</p>
              <h2>Begin a focused capture run.</h2>
              <label>
                Operator
                <input
                  aria-label="Operator"
                  value={operatorId}
                  onChange={(event) => setOperatorId(event.target.value)}
                  placeholder="collector-01"
                  required
                />
              </label>
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
                  placeholder="Optional operator notes, props, or scene context"
                />
              </label>
              <button type="submit" className="primary-action">
                Start session
              </button>
            </form>

            <SkeletonViewer points={visiblePoints} focusedHand={focusedHand} />
          </section>
        ) : (
          <section className="capture-shell">
            <div className="capture-stage">
              <header className="status-ribbon">
                <div>
                  <p className="kicker">Session active</p>
                  <strong>{handModeLabel(session.active_hands)}</strong>
                </div>
                <p className="status-copy">
                  {statusLabel(liveSnapshot.current_state, statusMessage)}
                </p>
              </header>

              <div className="prompt-stage">
                <div className="prompt-meta">
                  <div>
                    <p className="kicker">Current action</p>
                    <p className="prompt-tagline">
                      {prompt ? `${prompt.category} / ${prompt.action} / ${prompt.variation}` : "Stage is idle"}
                    </p>
                  </div>
                  {lastOutcome ? <span className="outcome-pill">{lastOutcome}</span> : null}
                </div>

                <h2 className="prompt-headline">{promptHeadline}</h2>

                <p className="prompt-support">
                  {reviewClip
                    ? reviewClip.failure_reason
                      ? `Failure reason: ${reviewClip.failure_reason}`
                      : "Clip ready for operator review."
                    : recording
                      ? "Recording is live. Keep the gesture clean and stop when the motion is complete."
                      : armedClip
                        ? "The clip is armed. Start recording when the demonstrator is ready."
                        : "Use the next prompt control to load the next gesture suggestion."}
                </p>

                <div className="action-deck">
                  <button type="button" className="primary-action" onClick={handleNextPrompt}>
                    Next prompt
                  </button>

                  {prompt && !armedClip && !recording && !reviewClip ? (
                    <button type="button" className="secondary-action" onClick={handleArmClip}>
                      Arm clip
                    </button>
                  ) : null}

                  {armedClip && !recording && !reviewClip ? (
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
                </div>
              </div>

              <aside className="annotation-strip">
                <div>
                  <p className="kicker">Operator note</p>
                  <p className="annotation-copy">
                    Use this only when needed. The main stage should remain visually quiet.
                  </p>
                </div>
                <div className="annotation-controls">
                  <label className="annotation-input">
                    <span className="sr-only">Clip note</span>
                    <input
                      aria-label="Clip note"
                      value={clipNote}
                      onChange={(event) => setClipNote(event.target.value)}
                      placeholder="steady pinch, slight occlusion, prop slipped"
                    />
                  </label>
                  <button type="button" className="secondary-action" onClick={handleSaveNote}>
                    Save note
                  </button>
                </div>
              </aside>
            </div>

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
