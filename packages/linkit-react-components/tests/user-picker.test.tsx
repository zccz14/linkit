import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { searchUsers, linkit } = vi.hoisted(() => {
  const searchUsers = vi.fn();
  return { searchUsers, linkit: { searchUsers } };
});
vi.mock("../src/linkit-provider.js", () => ({ useLinkit: () => linkit }));

import { LinkitUserPicker } from "../src/user-picker.js";

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); });

const alice = { user_id: "user-alice", username: "alice", avatar_url: null };

describe("LinkitUserPicker", () => {
  it("searches after a short debounce, chooses a user, and fills the hidden form value", async () => {
    vi.useFakeTimers();
    searchUsers.mockResolvedValue([alice]);
    const changed = vi.fn();
    render(<form><LinkitUserPicker lang="en" name="investor_id" onValueChange={changed} /></form>);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "ali" } });
    act(() => { vi.advanceTimersByTime(180); });
    await act(async () => {});
    expect(searchUsers).toHaveBeenCalledWith("ali", expect.any(AbortSignal));
    const option = screen.getByRole("option", { name: /alice/ });
    fireEvent.click(option);
    expect(changed).toHaveBeenCalledWith("user-alice", alice);
    expect(screen.getByDisplayValue("user-alice")).toHaveAttribute("name", "investor_id");
    expect(screen.getByText("alice")).toBeInTheDocument();
  });

  it("supports keyboard selection, clearing, and Chinese copy", async () => {
    vi.useFakeTimers();
    searchUsers.mockResolvedValue([alice]);
    const changed = vi.fn();
    render(<LinkitUserPicker lang="zh-CN" defaultValue="" onValueChange={changed} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "ali" } });
    act(() => { vi.advanceTimersByTime(180); });
    await act(async () => {});
    fireEvent.keyDown(input, { key: "Enter" });
    expect(changed).toHaveBeenLastCalledWith("user-alice", alice);
    fireEvent.click(screen.getByRole("button", { name: "清除选择" }));
    expect(changed).toHaveBeenLastCalledWith("", null);
  });

  it("does not request users for whitespace-only input and reports an empty result", () => {
    render(<LinkitUserPicker lang="zh" />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "   " } });
    expect(searchUsers).not.toHaveBeenCalled();
  });
});
