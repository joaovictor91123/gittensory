import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CommandTable } from "@/components/site/command-table";
import {
  ACTION_COMMAND_ENTRIES,
  MAINTAINER_COMMAND_ENTRIES,
  PUBLIC_COMMAND_ENTRIES,
} from "@/lib/command-reference";

// #6986: pinned after migrating the hand-rolled <table> markup onto the shared Table primitive --
// confirms the real table structure, columns, and default-role lookup still render correctly.
describe("CommandTable", () => {
  it("renders a real <table> with the syntax/effect/default-roles columns and one row per entry", () => {
    render(
      <CommandTable
        title="Commands"
        entries={[
          { id: "review", title: "Review", description: "Runs a review pass." },
          {
            id: "unlisted-command",
            title: "Unlisted",
            description: "Not in the role summary map.",
          },
        ]}
      />,
    );

    const table = screen.getByRole("table");
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent);
    expect(headers).toEqual(["Syntax", "Effect", "Default roles"]);

    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3); // header row + 2 entries

    expect(within(rows[1]!).getByText("@loopover review")).toBeTruthy();
    expect(within(rows[1]!).getByText("Runs a review pass.")).toBeTruthy();
    expect(within(rows[1]!).getByText("maintainer, collaborator, confirmed_miner")).toBeTruthy();

    // Falls back to "see policy" when the entry id has no DEFAULT_ROLE_SUMMARY mapping.
    expect(within(rows[2]!).getByText("@loopover unlisted-command")).toBeTruthy();
    expect(within(rows[2]!).getByText("see policy")).toBeTruthy();
  });

  it("renders the title heading", () => {
    render(<CommandTable title="Commands reference" entries={[]} />);
    expect(screen.getByRole("heading", { name: "Commands reference" })).toBeTruthy();
  });

  it("has a DEFAULT_ROLE_SUMMARY entry for every generated command id, never the generic fallback (#7096)", () => {
    // Drift guard: a new command added to any of the three src/github/commands.ts catalogs without a matching
    // DEFAULT_ROLE_SUMMARY entry must fail here rather than silently render "see policy" on the live docs page.
    const allEntries = [
      ...PUBLIC_COMMAND_ENTRIES,
      ...MAINTAINER_COMMAND_ENTRIES,
      ...ACTION_COMMAND_ENTRIES,
    ];
    expect(allEntries.length).toBeGreaterThan(0);
    const { container } = render(<CommandTable title="All commands" entries={allEntries} />);
    const missing = allEntries
      .filter((entry) => within(container).queryByText(`@loopover ${entry.id}`))
      .filter((entry) => {
        const row = within(container).getByText(`@loopover ${entry.id}`).closest("tr");
        return row?.textContent?.includes("see policy");
      })
      .map((entry) => entry.id);
    expect(missing).toEqual([]);
  });
});
