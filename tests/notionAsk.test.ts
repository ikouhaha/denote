import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { answerNotionMetadataQuestion } = require("../src/providers/notionAsk.cjs");

const tasks = [
  task("1", "Not dennis task", "Testing", ["Kenneth"]),
  task("2", "[38.1_]UAT_Group E_20260526.pptx", "In Progress", ["dennis", "Ken"], "https://notion.so/task-2"),
  task("3", "#31 (1244) [CPD] Password Policy Management", "Testing", ["dennis"], "https://notion.so/task-3"),
  task("4", "#676 Secretariat Portal_Charter Settings", "Test Failed", ["dennis", "Kenneth"], "https://notion.so/task-4"),
  task("5", "Banking data migration", "UAT Testing", ["dennis"], "https://notion.so/task-5"),
  task("6", "[37_] IRM Testing in DEV site - Comments from user", "Test Failed", ["Kenneth", "Simon Wong"], "https://notion.so/task-6")
];

describe("Notion Ask deterministic metadata answers", () => {
  it("counts assignee-related tasks without LLM excerpts or row numbers", () => {
    const answer = answerNotionMetadataQuestion({ question: "有多少個 task 是和 dennis 有關的", tasks });

    expect(answer.text).toContain("There are 4 tasks assigned to dennis.");
    expect(answer.text).toContain("| Task | Status | Assignees | Due | Project |");
    expect(answer.text).toContain("[#676 Secretariat Portal_Charter Settings](https://notion.so/task-4)");
    expect(answer.text).not.toContain("#2, #4");
    expect(answer.text).not.toContain("TODO:");
    expect(answer.sources).toEqual([]);
  });

  it("answers follow-up status questions using the previous dennis scope", () => {
    const answer = answerNotionMetadataQuestion({
      question: "這21個的status 是什麼",
      history: [{ role: "user", content: "有多少個 task 是和 dennis 有關的" }],
      tasks
    });

    expect(answer.text).toContain("dennis: 4 tasks by Status:");
    expect(answer.text).toContain("| Test Failed | 1 |");
    expect(answer.text).toContain("| UAT Testing | 1 |");
    expect(answer.text).not.toContain("Not dennis task");
  });

  it("answers which task has Test Failed without relisting every task", () => {
    const answer = answerNotionMetadataQuestion({
      question: "哪個 Test Failed?",
      history: [{ role: "user", content: "有多少個 task 是和 dennis 有關的" }],
      tasks
    });

    expect(answer.text).toContain("dennis: Test Failed tasks:");
    expect(answer.text).toContain("#676 Secretariat Portal_Charter Settings");
    expect(answer.text).not.toContain("[38.1_]UAT_Group E_20260526.pptx");
  });

  it("counts current-scope Test Failed tasks without calling the LLM or returning detail sources", () => {
    const answer = answerNotionMetadataQuestion({ question: "現在有幾條還卡在test fail 的", tasks });

    expect(answer.text).toContain("There are 2 tasks with Status = Test Failed.");
    expect(answer.text).toContain("[#676 Secretariat Portal_Charter Settings](https://notion.so/task-4)");
    expect(answer.text).toContain("[[37_] IRM Testing in DEV site - Comments from user](https://notion.so/task-6)");
    expect(answer.text).not.toContain("[38.1_]UAT_Group E_20260526.pptx");
    expect(answer.text).not.toContain("TODO:");
    expect(answer.sources).toEqual([]);
  });
});

function task(id: string, title: string, status: string, assignees: string[], url = "") {
  return {
    id,
    provider: "notion",
    sourceId: "tasks",
    sourceName: "Tasks",
    title,
    status,
    priority: "",
    taskType: "",
    assignees: assignees.map((name) => ({ id: name.toLowerCase(), name })),
    dueDate: "",
    taskReceiveDate: "",
    projectIds: ["project-1"],
    projectNames: ["ICAC CCSP & DIMS"],
    sprintIds: [],
    sprintNames: [],
    number: null,
    notionId: "",
    url,
    updated_at: "2026-05-31T00:00:00.000Z"
  };
}
