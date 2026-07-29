# ALOP-AI 3D Earrings

## Behavior
- Fixed to the top-left and top-right corners.
- Lowered (`top: 36px`) so they sit inside the header area without colliding with it.
- Swings via a pure CSS pendulum animation around `transform-origin: top center`.
- The `<model-viewer>` is locked: `pointer-events: none`, no `camera-controls`.
- Emits a synthesized chime on `mouseenter` using the Web Audio API.

## Orientation
The model file (`/model.glb`) may have been exported with an unexpected up-axis.
Runtime orientation is handled with CSS transforms on the `<model-viewer>` element:

```css
--earring-rotate-x: 0deg;
--earring-rotate-y: 0deg;
--earring-rotate-z: 90deg;

If `Set-Content` is blocked or you prefer WSL / Git Bash, use this equivalent:

```bash
mkdir -p frontend/src/__tests__ frontend/docs

cat > frontend/src/__tests__/Earring.test.jsx <<'EOF'
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Earring } from "../App";

describe("Earring", () => {
  let audioMocks;

  beforeEach(() => {
    audioMocks = {
      close: vi.fn(),
      resume: vi.fn(),
      currentTime: 0,
      createOscillator: vi.fn().mockReturnValue({
        type: "",
        frequency: { setValueAtTime: vi.fn() },
        connect: vi.fn().mockReturnValue({
          connect: vi.fn().mockReturnValue({ start: vi.fn(), stop: vi.fn() }),
        }),
        start: vi.fn(),
        stop: vi.fn(),
      }),
      createGain: vi.fn().mockReturnValue({
        gain: {
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn().mockReturnValue({
          connect: vi.fn().mockReturnValue({ start: vi.fn(), stop: vi.fn() }),
        }),
      }),
    };

    window.AudioContext = vi.fn().mockReturnValue(audioMocks);
    window.webkitAudioContext = window.AudioContext;
  });

  it("renders left and right earrings", () => {
    render(
      <>
        <Earring side="left" />
        <Earring side="right" />
      </>
    );

    expect(screen.getByLabelText(/ALOP left decorative earring/)).toBeInTheDocument();
    expect(screen.getByLabelText(/ALOP right decorative earring/)).toBeInTheDocument();
  });

  it("locks the model — no camera-controls and pointer-events none", () => {
    render(<Earring side="left" />);
    const viewer = document.querySelector("model-viewer");

    expect(viewer).toBeInTheDocument();
    expect(viewer).not.toHaveAttribute("camera-controls");
    expect(viewer).toHaveStyle({ pointerEvents: "none" });
  });

  it("jingles once on hover and debounces rapid passes", () => {
    render(<Earring side="left" />);
    const earring = screen.getByLabelText(/ALOP left decorative earring/);

    fireEvent.mouseEnter(earring);
    expect(audioMocks.resume).toHaveBeenCalled();

    fireEvent.mouseEnter(earring);
    expect(audioMocks.resume).toHaveBeenCalledTimes(1);
  });
});
EOF

cat > frontend/docs/EARRINGS.md <<'EOF'
# ALOP-AI 3D Earrings

## Behavior
- Fixed to the top-left and top-right corners.
- Lowered (`top: 36px`) so they sit inside the header area without colliding with it.
- Swings via a pure CSS pendulum animation around `transform-origin: top center`.
- The `<model-viewer>` is locked: `pointer-events: none`, no `camera-controls`.
- Emits a synthesized chime on `mouseenter` using the Web Audio API.

## Orientation
The model file (`/model.glb`) may have been exported with an unexpected up-axis.
Runtime orientation is handled with CSS transforms on the `<model-viewer>` element:

```css
--earring-rotate-x: 0deg;
--earring-rotate-y: 0deg;
--earring-rotate-z: 90deg;
# Create test directory
New-Item -ItemType Directory -Force -Path "frontend\src\__tests__" | Out-Null
New-Item -ItemType Directory -Force -Path "frontend\docs" | Out-Null

# Create Earring.test.jsx
Set-Content -Path "frontend\src\__tests__\Earring.test.jsx" -Value @'
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Earring } from "../App";

describe("Earring", () => {
  let audioMocks;

  beforeEach(() => {
    audioMocks = {
      close: vi.fn(),
      resume: vi.fn(),
      currentTime: 0,
      createOscillator: vi.fn().mockReturnValue({
        type: "",
        frequency: { setValueAtTime: vi.fn() },
        connect: vi.fn().mockReturnValue({
          connect: vi.fn().mockReturnValue({ start: vi.fn(), stop: vi.fn() }),
        }),
        start: vi.fn(),
        stop: vi.fn(),
      }),
      createGain: vi.fn().mockReturnValue({
        gain: {
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn().mockReturnValue({
          connect: vi.fn().mockReturnValue({ start: vi.fn(), stop: vi.fn() }),
        }),
      }),
    };

    window.AudioContext = vi.fn().mockReturnValue(audioMocks);
    window.webkitAudioContext = window.AudioContext;
  });

  it("renders left and right earrings", () => {
    render(
      <>
        <Earring side="left" />
        <Earring side="right" />
      </>
    );

    expect(screen.getByLabelText(/ALOP left decorative earring/)).toBeInTheDocument();
    expect(screen.getByLabelText(/ALOP right decorative earring/)).toBeInTheDocument();
  });

  it("locks the model — no camera-controls and pointer-events none", () => {
    render(<Earring side="left" />);
    const viewer = document.querySelector("model-viewer");

    expect(viewer).toBeInTheDocument();
    expect(viewer).not.toHaveAttribute("camera-controls");
    expect(viewer).toHaveStyle({ pointerEvents: "none" });
  });

  it("jingles once on hover and debounces rapid passes", () => {
    render(<Earring side="left" />);
    const earring = screen.getByLabelText(/ALOP left decorative earring/);

    fireEvent.mouseEnter(earring);
    expect(audioMocks.resume).toHaveBeenCalled();

    // Immediate second hover should be ignored by debounce
    fireEvent.mouseEnter(earring);
    expect(audioMocks.resume).toHaveBeenCalledTimes(1);
  });
});
