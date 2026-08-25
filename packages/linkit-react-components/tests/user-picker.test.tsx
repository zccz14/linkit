import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { searchUsers, linkit } = vi.hoisted(() => {
  const searchUsers = vi.fn();
  return { searchUsers, linkit: { searchUsers } };
});
vi.mock("../src/linkit-provider.js", () => ({ useLinkit: () => linkit }));

import { LinkitUserPicker } from "../src/user-picker.js";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

const alice = {
  user_id: "user-alice",
  username: "alice",
  avatar_url: null,
};
const bob = { user_id: "user-bob", username: "bob", avatar_url: null };

async function searchFor(value: string) {
  fireEvent.change(screen.getByRole("combobox"), { target: { value } });
  act(() => {
    vi.advanceTimersByTime(180);
  });
  await act(async () => {});
}

describe("LinkitUserPicker", () => {
  it("searches after a short debounce, chooses a user, and fills the hidden form value", async () => {
    vi.useFakeTimers();
    searchUsers.mockResolvedValue([alice]);
    const changed = vi.fn();
    render(
      <form>
        <LinkitUserPicker
          className="consumer-picker"
          lang="en"
          name="investor_id"
          onValueChange={changed}
        />
      </form>,
    );
    expect(
      document.querySelector(".linkit-user-picker.consumer-picker"),
    ).toBeInTheDocument();

    await searchFor("ali");
    expect(searchUsers).toHaveBeenCalledWith("ali", expect.any(AbortSignal));
    fireEvent.click(screen.getByRole("option", { name: /alice/ }));

    expect(changed).toHaveBeenCalledWith("user-alice", alice);
    expect(screen.getByDisplayValue("user-alice")).toHaveAttribute(
      "name",
      "investor_id",
    );
    expect(screen.getByText("alice")).toBeInTheDocument();
  });

  it("passes a UUID-character query through and presents the username with its UID", async () => {
    vi.useFakeTimers();
    const uuidUser = {
      user_id: "a1b2c3d4-0000-0000-0000-000000000001",
      username: "alice",
      avatar_url: null,
    };
    searchUsers.mockResolvedValue([uuidUser]);
    render(<LinkitUserPicker lang="en" />);

    await searchFor("A1B2-");

    expect(searchUsers).toHaveBeenCalledWith("A1B2-", expect.any(AbortSignal));
    expect(
      screen.getByRole("option", { name: /alice.*a1b2c3d4/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveAttribute(
      "placeholder",
      "Search username or UUID",
    );
  });

  it("supports keyboard selection, clearing, and Chinese copy in single mode", async () => {
    vi.useFakeTimers();
    searchUsers.mockResolvedValue([alice]);
    const changed = vi.fn();
    render(
      <LinkitUserPicker lang="zh-CN" defaultValue="" onValueChange={changed} />,
    );

    await searchFor("ali");
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(changed).toHaveBeenLastCalledWith("user-alice", alice);

    fireEvent.click(screen.getByRole("button", { name: "移除 alice" }));
    expect(changed).toHaveBeenLastCalledWith("", null);
  });

  it("keeps multi selection controlled, deduplicated, ordered, and represented by repeated hidden values", async () => {
    vi.useFakeTimers();
    searchUsers.mockImplementation((term: string) =>
      Promise.resolve(term === "ali" ? [alice] : [alice, bob]),
    );
    const changed = vi.fn();
    function ControlledPicker() {
      const [value, setValue] = useState<string[]>([]);
      return (
        <form>
          <LinkitUserPicker
            multiple
            lang="en"
            name="member_ids"
            value={value}
            onValueChange={(ids, users) => {
              changed(ids, users);
              setValue(ids);
            }}
          />
        </form>
      );
    }
    render(<ControlledPicker />);

    await searchFor("ali");
    fireEvent.click(screen.getByRole("option", { name: /alice/ }));
    await searchFor("bob");
    expect(
      screen.queryByRole("option", { name: /alice/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: /bob/ }));

    expect(changed).toHaveBeenLastCalledWith(
      ["user-alice", "user-bob"],
      [alice, bob],
    );
    expect(
      screen
        .getAllByDisplayValue(/user-(alice|bob)/)
        .map((input) => input.getAttribute("name")),
    ).toEqual(["member_ids", "member_ids"]);
    expect(screen.queryByText("user-alice")).not.toBeInTheDocument();
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText("bob")).toBeInTheDocument();

    await searchFor("ali");
    expect(
      screen.queryByRole("option", { name: /alice/ }),
    ).not.toBeInTheDocument();
  });

  it("removes an individual selected member, clears all members, and removes the last member with Backspace", async () => {
    vi.useFakeTimers();
    searchUsers.mockImplementation((term: string) =>
      Promise.resolve(term === "ali" ? [alice] : [bob]),
    );
    function ControlledPicker() {
      const [value, setValue] = useState<string[]>([]);
      return (
        <LinkitUserPicker
          multiple
          lang="en"
          value={value}
          onValueChange={(ids) => setValue(ids)}
        />
      );
    }
    render(<ControlledPicker />);

    await searchFor("ali");
    fireEvent.click(screen.getByRole("option", { name: /alice/ }));
    await searchFor("bob");
    fireEvent.click(screen.getByRole("option", { name: /bob/ }));

    fireEvent.click(screen.getByRole("button", { name: "Remove alice" }));
    expect(screen.queryByText("alice")).not.toBeInTheDocument();
    expect(screen.getByText("bob")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Backspace" });
    expect(screen.queryByText("bob")).not.toBeInTheDocument();

    await searchFor("ali");
    fireEvent.click(screen.getByRole("option", { name: /alice/ }));
    await searchFor("bob");
    fireEvent.click(screen.getByRole("option", { name: /bob/ }));
    fireEvent.click(screen.getByRole("button", { name: "Clear all members" }));
    expect(screen.queryByText("alice")).not.toBeInTheDocument();
    expect(screen.queryByText("bob")).not.toBeInTheDocument();
  });

  it("does not request users for whitespace-only input", () => {
    render(<LinkitUserPicker lang="zh" />);
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "   " },
    });
    expect(searchUsers).not.toHaveBeenCalled();
  });
});
