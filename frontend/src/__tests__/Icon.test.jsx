import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import Icon, { ICON_NAMES } from "../components/Icon";

describe("Icon", () => {
  it("renders nothing for an unknown name rather than throwing", () => {
    // A missing icon should not take a toolbar down.
    const { container } = render(<Icon name="not-an-icon" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders every name in the set", () => {
    for (const name of ICON_NAMES) {
      const { container } = render(<Icon name={name} />);
      expect(container.querySelector("svg"), `${name} rendered nothing`).not.toBeNull();
    }
  });

  it("is hidden from assistive tech, because the button around it carries the name", () => {
    const { container } = render(<Icon name="send" />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("honours the size prop on both axes", () => {
    const { container } = render(<Icon name="send" size={13} />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("width", "13");
    expect(svg).toHaveAttribute("height", "13");
  });

  it("uses currentColor so an icon inherits its button's colour", () => {
    // Every icon must be stroked or filled with currentColor — a hardcoded
    // colour would survive the theme switch and look broken in one mode.
    for (const name of ICON_NAMES) {
      const { container } = render(<Icon name={name} />);
      const svg = container.querySelector("svg");
      const paint = `${svg.getAttribute("fill")} ${svg.getAttribute("stroke")}`;
      expect(paint, `${name} does not use currentColor`).toContain("currentColor");
    }
  });

  it("draws filled icons with a fill and stroked icons with a stroke", () => {
    const { container: filled } = render(<Icon name="crown" />);
    expect(filled.querySelector("svg")).toHaveAttribute("fill", "currentColor");

    const { container: stroked } = render(<Icon name="send" />);
    expect(stroked.querySelector("svg")).toHaveAttribute("fill", "none");
    expect(stroked.querySelector("svg")).toHaveAttribute("stroke", "currentColor");
  });
});
