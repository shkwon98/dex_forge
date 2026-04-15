# DexForge

DexForge is an operator-driven hand motion data collection system for ROS 2.

This project records labeled hand-motion clips from externally published Manus glove topics:

- `/teleop/human/hand_left/pose` (`geometry_msgs/msg/PoseArray`)
- `/teleop/human/hand_right/pose` (`geometry_msgs/msg/PoseArray`)

It provides:

- a local web UI for operators
- a ROS 2 backend that subscribes to hand pose topics
- prompt/scenario suggestion from a curated scenario library
- per-clip recording to `MCAP + manifest + event log`

## Repository Layout

```text
dex_forge/
  dex_forge/                    # Python package
    backend/                    # collection service, API, ROS bridge, bag writer
  config/scenarios/             # scenario library JSON
  data_schema/                  # JSON schema files for manifests/events
  tests/                        # backend tests
  web/                          # React/Vite operator UI
```

## Runtime Overview

The backend process does three things in one service:

1. Runs an `rclpy` node that listens to the hand pose topics.
2. Runs a FastAPI server on port `8010`.
3. Serves the built web UI from `web/dist`.

The main operator flow is:

1. Create a session with `left`, `right`, or `both` as the active hand mode.
2. Request the next prompt from the scenario library.
3. Arm a clip for the selected prompt.
4. Start and stop recording manually.
5. Review the clip and `accept`, `discard`, or `retry`.

## Dataset Layout

Recorded data is written under `./dataset` relative to the process working directory.

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

## Requirements

- Ubuntu with ROS 2 Jazzy installed
- Python 3.12
- Node.js / npm for the web UI build

Python dependencies are listed in:

- [requirements.txt](/home/shkwon98/ros2_ws/src/dex_forge/requirements.txt)
- [requirements-dev.txt](/home/shkwon98/ros2_ws/src/dex_forge/requirements-dev.txt)

## Setup

Install Python dependencies:

```bash
cd /home/shkwon98/ros2_ws/src/dex_forge
python3 -m pip install --user -r requirements-dev.txt
```

Install web dependencies:

```bash
cd /home/shkwon98/ros2_ws/src/dex_forge/web
npm install
```

Build the web UI:

```bash
cd /home/shkwon98/ros2_ws/src/dex_forge/web
npm run build
```

Build the ROS 2 package:

```bash
cd /home/shkwon98/ros2_ws
source /opt/ros/jazzy/setup.bash
colcon build --packages-select dex_forge --base-paths /home/shkwon98/ros2_ws/src
source install/setup.bash
```

## Run

After the package and frontend are built:

```bash
cd /home/shkwon98/ros2_ws
source /opt/ros/jazzy/setup.bash
source install/setup.bash
ros2 run dex_forge dex_forge_server
```

Then open:

```text
http://localhost:8010
```

The backend serves the built React app and exposes the API from the same port.

## API Summary

HTTP endpoints:

- `POST /api/sessions`
- `GET /api/sessions/current`
- `POST /api/prompts/next`
- `POST /api/clips/arm`
- `POST /api/clips/start`
- `POST /api/clips/stop`
- `POST /api/clips/{clip_id}/decision`
- `POST /api/events/note`
- `GET /api/history`

WebSocket:

- `GET /ws/status`

## Scenario Library

Default prompts live in:

- [config/scenarios/default_scenarios.json](/home/shkwon98/ros2_ws/src/dex_forge/config/scenarios/default_scenarios.json)

Each scenario contains:

- `category`
- `action`
- `variation`
- `prompt_text`
- `difficulty`
- `allowed_hands`
- `tags`

The selector filters by session hand mode and avoids recently repeated `category/action` pairs.

## Tests

Backend tests:

```bash
cd /home/shkwon98/ros2_ws/src/dex_forge
pytest tests -q
```

Frontend tests:

```bash
cd /home/shkwon98/ros2_ws/src/dex_forge/web
npm test
```

Frontend production build:

```bash
cd /home/shkwon98/ros2_ws/src/dex_forge/web
npm run build
```

## Current Notes

- v1 stores raw clips for later normalization/training; MANO/OpenXR conversion is not implemented yet.
- The backend writes MCAP files in-process with `rosbag2_py.SequentialWriter`.
- The UI assumes a single local operator and does not implement authentication or multi-user coordination.
