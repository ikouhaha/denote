type NotionPropertySchema = {
  type?: string;
  status?: { options?: Array<{ name?: string }> };
  select?: { options?: Array<{ name?: string }> };
  relation?: { data_source_id?: string };
};

type NotionSchema = Record<string, NotionPropertySchema | undefined>;

export type DennisTasksMetadata = {
  statusOptions: string[];
  priorityOptions: string[];
  taskTypeOptions: string[];
  projectDataSourceId: string;
  sprintDataSourceId: string;
};

export type NotionTaskInput = {
  title: string;
  status?: string;
  priority?: string;
  taskType?: string;
  assigneeIds?: string[];
  dueDate?: string;
  taskReceiveDate?: string;
  projectId?: string;
  sprintId?: string;
};

export type DenoteNotionTask = {
  id: string;
  provider: "notion";
  sourceId: string;
  sourceName: string;
  title: string;
  status: string;
  priority: string;
  taskType: string;
  assignees: Array<{ id: string; name: string }>;
  dueDate: string;
  taskReceiveDate: string;
  projectIds: string[];
  sprintIds: string[];
  number: number | null;
  notionId: string;
  url: string;
  updated_at: string;
  raw: unknown;
};

const REQUIRED_COLUMNS = [
  ["Task name", "title"],
  ["Status", "status"],
  ["Assign", "people"],
  ["Due", "date"],
  ["Priority", "select"],
  ["Task Type", "select"],
  ["Task Receive Date", "date"],
  ["Project", "relation"],
  ["Sprint", "relation"],
  ["Number", "number"],
  ["ID", "unique_id"]
] as const;

export function validateDennisTasksSchema(schema: NotionSchema): DennisTasksMetadata {
  for (const [name, type] of REQUIRED_COLUMNS) {
    const property = schema[name];
    if (!property) {
      throw new Error(`Missing Notion Tasks column: ${name}`);
    }
    if (property.type !== type) {
      throw new Error(`Notion Tasks column ${name} must be type ${type}`);
    }
  }

  const projectDataSourceId = schema.Project?.relation?.data_source_id;
  const sprintDataSourceId = schema.Sprint?.relation?.data_source_id;
  if (!projectDataSourceId) {
    throw new Error("Notion Tasks column Project must point to a relation data source");
  }
  if (!sprintDataSourceId) {
    throw new Error("Notion Tasks column Sprint must point to a relation data source");
  }

  return {
    statusOptions: readOptions(schema.Status, "status", "Status"),
    priorityOptions: readOptions(schema.Priority, "select", "Priority"),
    taskTypeOptions: readOptions(schema["Task Type"], "select", "Task Type"),
    projectDataSourceId,
    sprintDataSourceId
  };
}

export function buildNotionPageProperties(input: NotionTaskInput): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    "Task name": { title: [{ text: { content: requireText(input.title, "Task name") } }] }
  };

  if (input.status) {
    properties.Status = { status: { name: input.status } };
  }
  if (input.priority) {
    properties.Priority = { select: { name: input.priority } };
  }
  if (input.taskType) {
    properties["Task Type"] = { select: { name: input.taskType } };
  }
  if (input.assigneeIds?.length) {
    properties.Assign = { people: input.assigneeIds.map((id) => ({ id })) };
  }
  if (input.dueDate) {
    properties.Due = { date: { start: input.dueDate } };
  }
  if (input.taskReceiveDate) {
    properties["Task Receive Date"] = { date: { start: input.taskReceiveDate } };
  }
  if (input.projectId) {
    properties.Project = { relation: [{ id: input.projectId }] };
  }
  if (input.sprintId) {
    properties.Sprint = { relation: [{ id: input.sprintId }] };
  }

  return properties;
}

export function normalizeNotionTaskPage(page: {
  id?: string;
  url?: string;
  last_edited_time?: string;
  properties?: Record<string, unknown>;
}): DenoteNotionTask {
  const properties = page.properties ?? {};
  return {
    id: String(page.id ?? ""),
    provider: "notion",
    sourceId: "",
    sourceName: "",
    title: readTitle(properties["Task name"]),
    status: readStatus(properties.Status),
    priority: readSelect(properties.Priority),
    taskType: readSelect(properties["Task Type"]),
    assignees: readPeople(properties.Assign),
    dueDate: readDate(properties.Due),
    taskReceiveDate: readDate(properties["Task Receive Date"]),
    projectIds: readRelationIds(properties.Project),
    sprintIds: readRelationIds(properties.Sprint),
    number: readNumber(properties.Number),
    notionId: readUniqueId(properties.ID),
    url: String(page.url ?? ""),
    updated_at: String(page.last_edited_time ?? ""),
    raw: page
  };
}

export function normalizeNotionTaskPageWithSource(
  page: {
    id?: string;
    url?: string;
    last_edited_time?: string;
    properties?: Record<string, unknown>;
  },
  source: { id?: string; name?: string }
): DenoteNotionTask {
  return {
    ...normalizeNotionTaskPage(page),
    sourceId: String(source.id || "").trim(),
    sourceName: String(source.name || source.id || "").trim()
  };
}

function readOptions(property: NotionPropertySchema | undefined, kind: "status" | "select", name: string): string[] {
  const options = property?.[kind]?.options?.map((option) => String(option.name || "").trim()).filter(Boolean);
  if (!options?.length) {
    throw new Error(`Notion Tasks column ${name} has no ${kind} options`);
  }
  return options;
}

function readTitle(property: unknown): string {
  const title = getPropertyArray(property, "title");
  return title.map((item) => readRecordString(item, "plain_text")).join("").trim();
}

function readStatus(property: unknown): string {
  return readRecordString(getPropertyRecord(property, "status"), "name");
}

function readSelect(property: unknown): string {
  return readRecordString(getPropertyRecord(property, "select"), "name");
}

function readPeople(property: unknown): Array<{ id: string; name: string }> {
  return getPropertyArray(property, "people").map((person) => ({
    id: readRecordString(person, "id"),
    name: readRecordString(person, "name")
  }));
}

function readDate(property: unknown): string {
  return readRecordString(getPropertyRecord(property, "date"), "start");
}

function readRelationIds(property: unknown): string[] {
  return getPropertyArray(property, "relation").map((relation) => readRecordString(relation, "id")).filter(Boolean);
}

function readNumber(property: unknown): number | null {
  const value = getPropertyRecord(property, undefined).number;
  return typeof value === "number" ? value : null;
}

function readUniqueId(property: unknown): string {
  const uniqueId = getPropertyRecord(property, "unique_id");
  const prefix = readRecordString(uniqueId, "prefix");
  const number = uniqueId.number;
  if (typeof number !== "number") {
    return "";
  }
  return prefix ? `${prefix}-${number}` : String(number);
}

function getPropertyArray(property: unknown, key: string): Record<string, unknown>[] {
  const value = getPropertyRecord(property, undefined)[key];
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function getPropertyRecord(property: unknown, key: string | undefined): Record<string, unknown> {
  if (!isRecord(property)) {
    return {};
  }
  if (!key) {
    return property;
  }
  const value = property[key];
  return isRecord(value) ? value : {};
}

function readRecordString(record: unknown, key: string): string {
  if (!isRecord(record)) {
    return "";
  }
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function requireText(value: unknown, label: string): string {
  const text = String(value || "").trim();
  if (!text) {
    throw new Error(`${label} is required`);
  }
  return text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
