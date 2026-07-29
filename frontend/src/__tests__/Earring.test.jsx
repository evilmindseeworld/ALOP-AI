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
});
