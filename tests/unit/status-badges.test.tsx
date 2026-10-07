// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FeeBadge, RiskBadge, SeverityBadge } from "@/components/patterns/status";

describe("status badges", () => {
  it("always carry a text label, never colour alone", () => {
    render(
      <>
        <RiskBadge level="high" />
        <RiskBadge level="watch" />
        <RiskBadge level="none" />
        <FeeBadge status="overdue" />
        <SeverityBadge severity="critical" />
      </>,
    );
    for (const text of ["High risk", "Watch", "On track", "Overdue", "Urgent"]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
  });
});
