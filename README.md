# DexForge

DexForge is an LLM-enhanced ROS 2 hand motion dataset builder.

It is designed for projects where hand articulation streams are already available from an external source such as a data glove, and the main requirement is to collect clean, labeled, reviewable recordings through a fast local interface. DexForge combines a local web UI, a ROS 2 collection backend, structured dataset export, and a built-in dummy pose publisher for runtime validation without external hardware.

## Highlights

- Collection flow for `left`, `right`, or `both` hands
- Prompt-driven recording workflow with per-recording review
- Structured export to task-grouped `MCAP + task metadata`
- Live hand-stage visualization in the web UI
- Built-in dummy `PoseArray` publisher for local end-to-end testing

## Table of Contents

- [DexForge](#dexforge)
  - [Highlights](#highlights)
  - [Table of Contents](#table-of-contents)
  - [System Overview](#system-overview)
  - [Expected Input Topics](#expected-input-topics)
  - [Clone and Workspace Layout](#clone-and-workspace-layout)
  - [Quick Start](#quick-start)
    - [Requirements](#requirements)
    - [1. Initial setup after clone](#1-initial-setup-after-clone)
    - [2. Build DexForge](#2-build-dexforge)
    - [3. Run DexForge](#3-run-dexforge)
  - [Local Runtime Test Without External Pose Nodes](#local-runtime-test-without-external-pose-nodes)
  - [Repository Structure](#repository-structure)
  - [Dataset Layout](#dataset-layout)
  - [Prompt Generation](#prompt-generation)
  - [Citation](#citation)
  - [Acknowledgements](#acknowledgements)

## System Overview

DexForge runs as a single local service composed of:

1. A ROS 2 subscriber node for hand pose topics
2. A FastAPI backend for collection, prompt, recording, and review control
3. A React/Vite web UI served from the same backend process

The intended collection loop is:

1. Start a collection with `left`, `right`, or `both` as the active hand mode
2. Request the next suggested motion prompt
4. Start and stop recording manually
5. Review the recording and `save`, `discard`, or `save and record one more`

The backend writes raw recordings as MCAP inside task folders for later dataset building and model training.

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
- installs Ollama automatically on Linux when missing
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
3. Start a collection
4. Record and review a test sample

For a quick backend-only check:

```bash
curl -s http://localhost:8010/api/collection
```

The returned `hand_pose_preview.left` and `hand_pose_preview.right` fields should contain live points when the dummy publisher is active.

## Repository Structure

```text
dex_forge/
  dex_forge/
    backend/                    # collection service, API, ROS bridge, storage logic
    dummy_pose_publisher.py     # built-in test publisher for hand PoseArray topics
    main.py                     # server entrypoint
    instruction_generator.py    # on-demand Ollama prompt generation
  tests/                        # backend tests
  web/                          # React/Vite operator UI
```

## Dataset Layout

By default, recorded data is written under [`./dataset`](./dataset) in the repository root. The dataset root can also be changed from the UI before starting a collection.

```text
dataset/
  tasks/
    tasks.json
    <sha256>/
      task.json
      recording_000001/
        metadata.yaml
        *.mcap
```

Each task groups recordings captured for the same prompt text. The task directory name is the
pure SHA-256 hex digest of `prompt_text`, and `tasks.json` stores only `task_id` and
`prompt_text` for index lookups. Each recording directory is the rosbag output root and contains
the generated `metadata.yaml` plus the MCAP file created by rosbag2.

## Prompt Generation

DexForge now generates prompts from a local Ollama model on demand.
Each `POST /api/prompts/next` call triggers an immediate LLM request and returns a newly
generated single-hand instruction.

Prompt metadata still contains:

- `category`
- `action`
- `variation`
- `prompt_text`

`action` is now the SHA-256 digest of `prompt_text` (no `task_000` style indexing).

Ollama server should be available at `http://127.0.0.1:11434` and the backend uses
`qwen2.5:7b` by default.

`./scripts/run_server.sh` now performs preflight checks automatically:

- verifies `ollama` CLI is installed
- starts `ollama serve` in background if the daemon is not running
- pulls `qwen2.5:7b` automatically if missing

```bash
./scripts/run_server.sh
```

## Citation

If DexForge is useful in your work, please cite the repository for now. A paper-specific citation can be added later when public release materials are available.

```bibtex
@misc{kwon2026dexforge,
  title        = {DexForge: An LLM-Enhanced ROS 2 Hand Motion Dataset Builder},
  author       = {Kwon, Sunghyun},
  year         = {2026},
  howpublished = {\url{https://github.com/shkwon98/dex_forge}},
  note         = {GitHub repository}
}
```

## Acknowledgements

DexForge is being developed as a research-oriented data collection tool for dexterous hand motion capture, prompt-driven demonstration recording, and downstream dataset construction.
