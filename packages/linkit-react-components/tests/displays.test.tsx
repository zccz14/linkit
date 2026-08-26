import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LinkitAvatar } from "../src/displays.js";

afterEach(() => cleanup());

describe("LinkitAvatar", () => {
  it("renders the public versioned avatar URL unchanged as a native image without fetching it", () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const avatarUrl = "https://linkit.example.test/api/public/profiles/用户/avatar?v=42";
    const { container, rerender } = render(<LinkitAvatar profile={{ username: "用户", avatar_url: avatarUrl }} size="sm" />);

    const image = container.querySelector("img.linkit-avatar__image")!;
    expect(image).toHaveAttribute("src", avatarUrl);
    expect(image).toHaveClass("linkit-avatar__image");
    expect(image.closest(".linkit-avatar")).toHaveClass("linkit-avatar--sm");
    rerender(<LinkitAvatar profile={{ username: "用户", avatar_url: avatarUrl }} size="sm" />);
    expect(container.querySelector("img.linkit-avatar__image")).toHaveAttribute("src", avatarUrl);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it("keeps its explicit size and replaces a failed image with an initial fallback", () => {
    const { container } = render(<LinkitAvatar profile={{ username: "张三", avatar_url: "https://linkit.example.test/avatar?v=1" }} size="lg" />);

    const image = container.querySelector("img.linkit-avatar__image")!;
    expect(image.closest(".linkit-avatar")).toHaveClass("linkit-avatar--lg");
    fireEvent.error(image);
    expect(container.querySelector("img.linkit-avatar__image")).not.toBeInTheDocument();
    expect(screen.getByText("张")).toHaveClass("linkit-avatar__fallback");
  });
});
