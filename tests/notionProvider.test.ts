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
    expect(validateDennisTasksSchema(baseSchema)).toMatchObject({
      statusOptions: ["Not Started", "Done"],
      priorityOptions: ["High"],
      taskTypeOptions: ["Bug"],
      projectDataSourceId: "projects-source",
      sprintDataSourceId: "sprints-source",
      propertyNames: {
        title: "Task name",
        status: "Status",
        assignee: "Assign",
        due: "Due",
        priority: "Priority",
        taskType: "Task Type",
        taskReceiveDate: "Task Receive Date",
        project: "Project",
        sprint: "Sprint",
        number: "Number",
        notionId: "ID"
      }
    });
  });

  it("accepts the raw SDK Tasks schema used by denniswork", () => {
    const metadata = validateDennisTasksSchema({
      corp: { type: "title", title: {} },
      Assign: { type: "people", people: {} },
      Status: baseSchema.Status,
      Due: { type: "date", date: {} },
      Priority: baseSchema.Priority,
      "Task Type": baseSchema["Task Type"],
      "Task Receive Date": { type: "date", date: {} },
      Project: { type: "relation", relation: { data_source_id: "projects-source" } },
      Sprint: { type: "relation", relation: { data_source_id: "sprints-source" } }
    });

    expect(metadata).toMatchObject({
      statusOptions: ["Not Started", "Done"],
      priorityOptions: ["High"],
      taskTypeOptions: ["Bug"],
      propertyNames: {
        title: "corp",
        status: "Status",
        project: "Project",
        sprint: "Sprint",
        number: "",
        notionId: ""
      }
    });
  });

  it("infers a nonstandard title column from the raw Notion schema", () => {
    const metadata = validateDennisTasksSchema({
      "Work item": { type: "title", title: {} },
      Status: baseSchema.Status
    });

    expect(metadata.propertyNames.title).toBe("Work item");
  });

  it("rejects sources without a status column", () => {
    const schema = { ...baseSchema, Status: { type: "select", select: { options: [] } } };

    expect(() => validateDennisTasksSchema(schema)).toThrow("Notion Tasks source must have a status column");
  });
});

describe("Notion task mapping", () => {
  it("builds create/update properties with optional project and complete Dennis fields", () => {
    const metadata = validateDennisTasksSchema(baseSchema);
    expect(
      buildNotionPageProperties(
        {
          title: "CCSP: Fix login bug",
          status: "Not Started",
          priority: "High",
          taskType: "Bug",
          assigneeIds: ["user-1", "user-2"],
          dueDate: "2026-06-05",
          taskReceiveDate: "2026-05-31",
          projectId: "",
          sprintId: "sprint-1"
        },
        metadata.propertyNames
      )
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

  it("builds page properties with the schema title column instead of hardcoded Task name", () => {
    const metadata = validateDennisTasksSchema({
      corp: { type: "title", title: {} },
      Status: baseSchema.Status,
      Priority: baseSchema.Priority
    });

    expect(
      buildNotionPageProperties(
        {
          title: "DIMS: Check report",
          status: "Not Started",
          priority: "High",
          taskType: "Bug"
        },
        metadata.propertyNames
      )
    ).toEqual({
      corp: { title: [{ text: { content: "DIMS: Check report" } }] },
      Status: { status: { name: "Not Started" } },
      Priority: { select: { name: "High" } }
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
            corp: { type: "title", title: [{ plain_text: "Task from source A" }] },
            Status: { type: "status", status: { name: "Done" } }
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
