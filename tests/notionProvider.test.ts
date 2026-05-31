import { describe, expect, it } from "vitest";
import {
  buildNotionPageProperties,
  normalizeNotionTaskPageWithSource,
  normalizeNotionTaskPage,
  validateDennisTasksSchema
} from "../src/providers/notionProvider.js";

const baseSchema = {
  "Task name": { type: "title", title: {} },
  Status: {
    type: "status",
    status: {
      options: [
        { id: "status-1", name: "Not Started", color: "gray" },
        { id: "status-2", name: "Done", color: "green" }
      ]
    }
  },
  Assign: { type: "people", people: {} },
  Due: { type: "date", date: {} },
  Priority: {
    type: "select",
    select: { options: [{ id: "priority-1", name: "High", color: "red" }] }
  },
  "Task Type": {
    type: "select",
    select: { options: [{ id: "type-1", name: "Bug", color: "red" }] }
  },
  "Task Receive Date": { type: "date", date: {} },
  Project: { type: "relation", relation: { data_source_id: "projects-source" } },
  Sprint: { type: "relation", relation: { data_source_id: "sprints-source" } },
  Number: { type: "number", number: {} },
  ID: { type: "unique_id", unique_id: {} }
};

describe("Notion provider schema", () => {
  it("extracts Dennis Tasks metadata from the actual Notion schema", () => {
    expect(validateDennisTasksSchema(baseSchema)).toEqual({
      statusOptions: ["Not Started", "Done"],
      priorityOptions: ["High"],
      taskTypeOptions: ["Bug"],
      projectDataSourceId: "projects-source",
      sprintDataSourceId: "sprints-source"
    });
  });

  it("rejects missing required columns instead of using fallbacks", () => {
    const schema = { ...baseSchema };
    delete (schema as Record<string, unknown>).Priority;

    expect(() => validateDennisTasksSchema(schema)).toThrow("Missing Notion Tasks column: Priority");
  });

  it("rejects wrong property types instead of guessing mappings", () => {
    const schema = { ...baseSchema, Status: { type: "select", select: { options: [] } } };

    expect(() => validateDennisTasksSchema(schema)).toThrow("Notion Tasks column Status must be type status");
  });
});

describe("Notion task mapping", () => {
  it("builds create/update properties with optional project and complete Dennis fields", () => {
    expect(
      buildNotionPageProperties({
        title: "CCSP: Fix login bug",
        status: "Not Started",
        priority: "High",
        taskType: "Bug",
        assigneeIds: ["user-1", "user-2"],
        dueDate: "2026-06-05",
        taskReceiveDate: "2026-05-31",
        projectId: "",
        sprintId: "sprint-1"
      })
    ).toEqual({
      "Task name": { title: [{ text: { content: "CCSP: Fix login bug" } }] },
      Status: { status: { name: "Not Started" } },
      Priority: { select: { name: "High" } },
      "Task Type": { select: { name: "Bug" } },
      Assign: { people: [{ id: "user-1" }, { id: "user-2" }] },
      Due: { date: { start: "2026-06-05" } },
      "Task Receive Date": { date: { start: "2026-05-31" } },
      Sprint: { relation: [{ id: "sprint-1" }] }
    });
  });

  it("normalizes readonly Number and ID without dropping Notion URL", () => {
    const page = {
      id: "page-1",
      url: "https://notion.so/page-1",
      last_edited_time: "2026-05-31T09:00:00.000Z",
      properties: {
        "Task name": { type: "title", title: [{ plain_text: "DIMS: Check report" }] },
        Status: { type: "status", status: { name: "Testing" } },
        Priority: { type: "select", select: { name: "High" } },
        "Task Type": { type: "select", select: { name: "Bug" } },
        Assign: { type: "people", people: [{ id: "user-1", name: "Dennis" }] },
        Due: { type: "date", date: { start: "2026-06-05" } },
        "Task Receive Date": { type: "date", date: { start: "2026-05-31" } },
        Project: { type: "relation", relation: [{ id: "project-1" }] },
        Sprint: { type: "relation", relation: [] },
        Number: { type: "number", number: 42 },
        ID: { type: "unique_id", unique_id: { prefix: "TASK", number: 7 } }
      }
    };

    expect(normalizeNotionTaskPage(page)).toMatchObject({
      id: "page-1",
      provider: "notion",
      title: "DIMS: Check report",
      status: "Testing",
      priority: "High",
      taskType: "Bug",
      assignees: [{ id: "user-1", name: "Dennis" }],
      dueDate: "2026-06-05",
      taskReceiveDate: "2026-05-31",
      projectIds: ["project-1"],
      sprintIds: [],
      number: 42,
      notionId: "TASK-7",
      url: "https://notion.so/page-1"
    });
  });

  it("adds source identity when normalizing pages from multiple task sources", () => {
    expect(
      normalizeNotionTaskPageWithSource(
        {
          id: "page-2",
          properties: {
            "Task name": { type: "title", title: [{ plain_text: "Task from source A" }] }
          }
        },
        { id: "source-a", name: "Tasks A" }
      )
    ).toMatchObject({
      id: "page-2",
      sourceId: "source-a",
      sourceName: "Tasks A",
      title: "Task from source A"
    });
  });
});
