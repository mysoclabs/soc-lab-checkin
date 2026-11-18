import { describe, it, expect } from "vitest";
import { gradeAttempt, evaluateQuestion } from "./assessment-grading";

describe("assessment grading", () => {
  it("short answers match accepted answers ignoring case and spaces", () => {
    expect(evaluateQuestion({ id: "q", type: "short", marks: 1, correct: ["Firewall"] }, "  firewall ")).toBe("correct");
    expect(evaluateQuestion({ id: "q", type: "short", marks: 1, correct: ["Firewall"] }, "fire wall")).toBe("wrong");
  });
  it("multiple select needs exactly the correct set", () => {
    const q = { id: "q", type: "multi" as const, marks: 2, correct: ["a", "b"] };
    expect(evaluateQuestion(q, ["b", "a"])).toBe("correct");
    expect(evaluateQuestion(q, ["a"])).toBe("wrong");
    expect(evaluateQuestion(q, ["a", "b", "c"])).toBe("wrong");
  });
  it("theory is not auto graded until admin awards marks", () => {
    const qs = [
      { id: "1", type: "mcq" as const, marks: 2, correct: ["x"] },
      { id: "2", type: "theory" as const, marks: 3, correct: [] },
      { id: "3", type: "truefalse" as const, marks: 1, correct: ["true"] },
    ];
    const r = gradeAttempt(qs, { "1": "x", "2": "essay" });
    expect(r).toMatchObject({ score: 2, max_score: 6, correct_count: 1, skipped_count: 1, pending_review_count: 1 });
    const r2 = gradeAttempt(qs, { "1": "x", "2": "essay" }, { "2": 3 });
    expect(r2.score).toBe(5);
    expect(r2.pending_review_count).toBe(0);
  });
});
