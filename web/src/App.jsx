import { useState } from "react";

import { apiClient } from "./api";
import "./styles.css";


function handModeLabel(activeHands) {
  if (activeHands === "left") {
    return "Left hand session";
  }
  if (activeHands === "right") {
    return "Right hand session";
  }
  return "Both hand session";
}


export function App({ api = apiClient }) {
  const [operatorId, setOperatorId] = useState("");
  const [activeHands, setActiveHands] = useState("left");
  const [sessionNotes, setSessionNotes] = useState("");
  const [session, setSession] = useState(null);
  const [prompt, setPrompt] = useState(null);
  const [armedClip, setArmedClip] = useState(null);
  const [recording, setRecording] = useState(false);
  const [reviewClip, setReviewClip] = useState(null);
  const [clipNote, setClipNote] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [lastOutcome, setLastOutcome] = useState("");

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
  }

  async function handleNextPrompt() {
    const nextPrompt = await api.getNextPrompt();
    setPrompt(nextPrompt);
    setStatusMessage("Prompt ready");
    setReviewClip(null);
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
    setStatusMessage("Capture live");
  }

  async function handleStopRecording() {
    const stopped = await api.stopClip();
    setRecording(false);
    setReviewClip(stopped);
    setStatusMessage(stopped.failure_reason ? "Clip invalid" : "Ready for review");
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

  return (
    <div className="page-shell">
      <main className="panel">
        <section className="hero">
          <p className="eyebrow">DexForge</p>
          <h1>Operator console for prompt-guided hand recording</h1>
          <p className="subhead">
            Start a session, lock the active hand mode, and capture labeled clips for later training.
          </p>
        </section>

        {!session ? (
          <form className="session-form" onSubmit={handleStartSession}>
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
                rows={3}
              />
            </label>
            <button type="submit">Start session</button>
          </form>
        ) : (
          <section className="workspace">
            <div className="status-strip">
              <div>
                <span className="label">Session active</span>
                <strong>{handModeLabel(session.active_hands)}</strong>
              </div>
              <p>{statusMessage}</p>
            </div>

            <div className="action-row">
              <button type="button" onClick={handleNextPrompt}>
                Next prompt
              </button>
              {prompt ? (
                <button type="button" onClick={handleArmClip}>
                  Arm clip
                </button>
              ) : null}
              {armedClip && !recording && !reviewClip ? (
                <button type="button" onClick={handleStartRecording}>
                  Start recording
                </button>
              ) : null}
              {recording ? (
                <button type="button" onClick={handleStopRecording}>
                  Stop recording
                </button>
              ) : null}
            </div>

            {prompt ? (
              <article className="card">
                <p className="label">Current prompt</p>
                <h2>{prompt.prompt_text}</h2>
                <p>
                  {prompt.category} / {prompt.action} / {prompt.variation}
                </p>
              </article>
            ) : null}

            {recording ? (
              <article className="card">
                <p className="label">Recording in progress</p>
                <label>
                  Clip note
                  <input
                    aria-label="Clip note"
                    value={clipNote}
                    onChange={(event) => setClipNote(event.target.value)}
                    placeholder="steady pinch"
                  />
                </label>
                <button type="button" onClick={handleSaveNote}>
                  Save note
                </button>
              </article>
            ) : null}

            {reviewClip ? (
              <article className="card review-card">
                <p className="label">Review clip</p>
                {reviewClip.failure_reason ? (
                  <p>Failure reason: {reviewClip.failure_reason}</p>
                ) : (
                  <p>Clip ready for operator review.</p>
                )}
                <div className="decision-row">
                  <button type="button" onClick={() => handleDecision("accept")}>
                    Accept clip
                  </button>
                  <button type="button" onClick={() => handleDecision("discard")}>
                    Discard clip
                  </button>
                  <button type="button" onClick={() => handleDecision("retry")}>
                    Retry clip
                  </button>
                </div>
              </article>
            ) : null}

            {lastOutcome ? <p className="outcome">{lastOutcome}</p> : null}
          </section>
        )}
      </main>
    </div>
  );
}
