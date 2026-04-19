# DexForge

DexForge is an operator-facing ROS 2 data collection system for building large-scale hand motion datasets.

It is designed for projects where hand articulation streams are already available from an external source such as a data glove, and the main requirement is to collect clean, labeled, reviewable motion clips through a fast local interface. DexForge combines a local web UI, a ROS 2 collection backend, structured dataset export, and a built-in dummy pose publisher for runtime validation without external hardware.

## Highlights

- Session-based collection for `left`, `right`, or `both` hands
- Prompt-driven recording workflow with per-clip review
- Structured export to `MCAP + manifest + event log`
- Live hand-stage visualization in the web UI
- Built-in dummy `PoseArray` publisher for local end-to-end testing

## Table of Contents

- [System Overview](#system-overview)
- [Expected Input Topics](#expected-input-topics)
- [Clone and Workspace Layout](#clone-and-workspace-layout)
- [Quick Start](#quick-start)
- [Local Runtime Test Without External Pose Nodes](#local-runtime-test-without-external-pose-nodes)
- [Repository Structure](#repository-structure)
- [Dataset Layout](#dataset-layout)
- [API Summary](#api-summary)
- [Scenario Library](#scenario-library)
- [Development](#development)
- [Citation](#citation)
- [Acknowledgements](#acknowledgements)

## System Overview

DexForge runs as a single local service composed of:

1. A ROS 2 subscriber node for hand pose topics
2. A FastAPI backend for session, prompt, recording, and review control
3. A React/Vite web UI served from the same backend process

The intended collection loop is:

1. Create a session with `left`, `right`, or `both` as the active hand mode
2. Request the next suggested motion prompt
3. Arm the prompt as the next clip label
4. Start and stop recording manually
5. Review the clip and `accept`, `discard`, or `retry`

The backend writes raw clips as MCAP and stores metadata required for later dataset building and model training.

## Expected Input Topics

DexForge currently expects externally published hand articulation topics in the following format:

- `/teleop/human/hand_left/pose` (`geometry_msgs/msg/PoseArray`)
- `/teleop/human/hand_right/pose` (`geometry_msgs/msg/PoseArray`)

If an external publisher is not available, DexForge can publish compatible dummy streams itself for local runtime testing.

## Clone and Workspace Layout

DexForge is a ROS 2 package and should be placed inside the `src/` directory of a ROS 2 workspace.

Example:

```bash
mkdir -p <your_ros2_ws>/src
cd <your_ros2_ws>/src
git clone https://github.com/shkwon98/dex_forge.git
```

Expected layout:

```text
<your_ros2_ws>/
  src/
    dex_forge/
```

## Quick Start

### Requirements

- Ubuntu with ROS 2 Jazzy installed
- Python 3.12
- Node.js / npm for the frontend build

Python dependencies:

- [`requirements.txt`](./requirements.txt)
- [`requirements-dev.txt`](./requirements-dev.txt)

### 1. Initial setup after clone

Run:

```bash
./scripts/setup.sh
```

This script:

- installs Python development dependencies
- installs frontend dependencies in `web/`

### 2. Build DexForge

Run:

```bash
./scripts/build.sh
```

This script:

- builds the frontend with Vite
- builds the ROS 2 package with `colcon`

### 3. Run DexForge

Run:

```bash
./scripts/run_server.sh
```

Then open:

```text
http://localhost:8010
```

The backend serves the web app and collection APIs from the same port.

## Local Runtime Test Without External Pose Nodes

DexForge includes a built-in dummy ROS 2 pose publisher so the full stack can be tested without Manus gloves or any external pose source.

Start the collection server in one terminal:

```bash
./scripts/run_server.sh
```

Start the dummy publisher in another terminal:

```bash
source /opt/ros/jazzy/setup.bash
source <your_ros2_ws>/install/setup.bash
cd <your_ros2_ws>
 
ros2 run dex_forge dex_forge_dummy_pose_publisher --hand-mode both --publish-hz 15
```

If you are already in the repository root and your workspace has been built, the same command can be run directly as:

```bash
source /opt/ros/jazzy/setup.bash
source ../../install/setup.bash
ros2 run dex_forge dex_forge_dummy_pose_publisher --hand-mode both --publish-hz 15
```

Supported hand modes:

- `left`
- `right`
- `both`

After both processes are running:

1. Open `http://localhost:8010`
2. Confirm that the live hand-stage viewer is updating
3. Create a session
4. Record and review a test clip

For a quick backend-only check:

```bash
curl -s http://localhost:8010/api/sessions/current
```

The returned `hand_pose_preview.left` and `hand_pose_preview.right` fields should contain live points when the dummy publisher is active.

## Repository Structure

```text
dex_forge/
  dex_forge/
    backend/                    # collection service, API, ROS bridge, storage logic
    dummy_pose_publisher.py     # built-in test publisher for hand PoseArray topics
    main.py                     # server entrypoint
  config/scenarios/             # scenario library JSON files
  data_schema/                  # JSON schema files for manifests and events
  tests/                        # backend tests
  web/                          # React/Vite operator UI
```

## Dataset Layout

Recorded data is written under `./dataset` relative to the working directory of the running process.

```text
dataset/
  sessions/
    <session_id>/
      session_manifest.json
      clips/
        <clip_id>/
          recording.mcap
          clip_manifest.json
          events.jsonl
  scenario_library_version.json
```

Each accepted or reviewed clip includes:

- raw MCAP recording
- structured clip metadata
- ordered event log for prompt, record, and review actions

## API Summary

HTTP endpoints:

- `POST /api/sessions`
- `GET /api/sessions/current`
- `POST /api/prompts/next`
- `POST /api/clips/start`
- `POST /api/clips/stop`
- `POST /api/clips/{clip_id}/decision`
- `POST /api/events/note`

WebSocket:

- `GET /ws/status`

## Scenario Library

Default prompts live in:

- [`config/scenarios/default_scenarios.json`](./config/scenarios/default_scenarios.json)

Each scenario contains:

- `category`
- `action`
- `variation`
- `prompt_text`
- `difficulty`
- `allowed_hands`
- `tags`

Prompt selection is filtered by the current session hand mode and avoids recently repeated `category/action` pairs.

## Development

Run backend tests:

```bash
cd <your_ros2_ws>/src/dex_forge
pytest tests -q
```

Run frontend tests:

```bash
cd <your_ros2_ws>/src/dex_forge/web
npm test
```

Build the frontend:

```bash
cd <your_ros2_ws>/src/dex_forge/web
npm run build
```

Rebuild the ROS 2 package:

```bash
./scripts/build.sh
```

Available executables:

```bash
./scripts/run_server.sh

# separate terminal
source /opt/ros/jazzy/setup.bash
source ../../install/setup.bash
ros2 run dex_forge dex_forge_dummy_pose_publisher --hand-mode both --publish-hz 15
```

## Citation

If DexForge is useful in your work, please cite the repository for now. A paper-specific citation can be added later when public release materials are available.

```bibtex
@misc{kwon2026dexforge,
  title        = {DexForge: An Operator-Facing ROS 2 Data Collection System for Large-Scale Hand Motion Datasets},
  author       = {Kwon, Sunghyun},
  year         = {2026},
  howpublished = {\url{https://github.com/shkwon98/dex_forge}},
  note         = {GitHub repository}
}
```

## Acknowledgements

DexForge is being developed as a research-oriented data collection tool for dexterous hand motion capture, prompt-driven demonstration recording, and downstream dataset construction.
