type NotionPropertySchema = {
  type?: string;
  title?: Record<string, never>;
  status?: { options?: Array<{ name?: string }> };
  select?: { options?: Array<{ name?: string }> };
  people?: Record<string, never>;
  date?: Record<string, never>;
  relation?: { data_source_id?: string };
  number?: Record<string, never>;
  unique_id?: Record<string, never>;
};

type NotionSchema = Record<string, NotionPropertySchema | undefined>;

export type DennisTasksMetadata = {
  statusOptions: string[];
  priorityOptions: string[];
  taskTypeOptions: string[];
  projectDataSourceId: string;
  sprintDataSourceId: string;
  propertyNames: NotionTaskPropertyNames;
};

export type NotionTaskPropertyNames = {
  title: string;
  status: string;
  assignee: string;
  due: string;
  priority: string;
  taskType: string;
  taskReceiveDate: string;
  project: string;
  sprint: string;
  number: string;
  notionId: string;
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
  projectNames: string[];
  sprintIds: string[];
  sprintNames: string[];
  number: number | null;
  notionId: string;
  url: string;
  updated_at: string;
  raw: unknown;
};

const EMPTY_PROPERTY_NAMES: NotionTaskPropertyNames = {
  title: "",
  status: "",
  assignee: "",
  due: "",
  priority: "",
  taskType: "",
  taskReceiveDate: "",
  project: "",
  sprint: "",
  number: "",
  notionId: ""
};

export function validateDennisTasksSchema(schema: NotionSchema): DennisTasksMetadata {
  const propertyNames = inferNotionTaskPropertyNames(schema);
  if (!propertyNames.title) {
    throw new Error("Notion Tasks source must have a title column");
  }
  if (!propertyNames.status) {
    throw new Error("Notion Tasks source must have a status column");
  }

  const projectDataSourceId = propertyNames.project ? schema[propertyNames.project]?.relation?.data_source_id || "" : "";
  const sprintDataSourceId = propertyNames.sprint ? schema[propertyNames.sprint]?.relation?.data_source_id || "" : "";

  return {
    statusOptions: readOptions(schema[propertyNames.status], "status"),
    priorityOptions: propertyNames.priority ? readOptions(schema[propertyNames.priority], "select") : [],
    taskTypeOptions: propertyNames.taskType ? readOptions(schema[propertyNames.taskType], "select") : [],
    projectDataSourceId,
    sprintDataSourceId,
    propertyNames
  };
}

export function buildNotionPageProperties(input: NotionTaskInput, propertyNames = defaultNotionTaskPropertyNames()): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    [propertyNames.title]: { title: [{ text: { content: requireText(input.title, "Task name") } }] }
  };

  if (input.status && propertyNames.status) {
    properties[propertyNames.status] = { status: { name: input.status } };
  }
  if (input.priority && propertyNames.priority) {
    properties[propertyNames.priority] = { select: { name: input.priority } };
  }
  if (input.taskType && propertyNames.taskType) {
    properties[propertyNames.taskType] = { select: { name: input.taskType } };
  }
  if (input.assigneeIds?.length && propertyNames.assignee) {
    properties[propertyNames.assignee] = { people: input.assigneeIds.map((id) => ({ id })) };
  }
  if (input.dueDate && propertyNames.due) {
    properties[propertyNames.due] = { date: { start: input.dueDate } };
  }
  if (input.taskReceiveDate && propertyNames.taskReceiveDate) {
    properties[propertyNames.taskReceiveDate] = { date: { start: input.taskReceiveDate } };
  }
  if (input.projectId && propertyNames.project) {
    properties[propertyNames.project] = { relation: [{ id: input.projectId }] };
  }
  if (input.sprintId && propertyNames.sprint) {
    properties[propertyNames.sprint] = { relation: [{ id: input.sprintId }] };
  }

  return properties;
}

export function normalizeNotionTaskPage(page: {
  id?: string;
  url?: string;
  last_edited_time?: string;
  properties?: Record<string, unknown>;
}, propertyNames = inferNotionTaskPropertyNamesFromPage(page.properties ?? {})): DenoteNotionTask {
  const properties = page.properties ?? {};
  return {
    id: String(page.id ?? ""),
    provider: "notion",
    sourceId: "",
    sourceName: "",
    title: readTitle(properties[propertyNames.title]),
    status: readStatus(properties[propertyNames.status]),
    priority: readSelect(properties[propertyNames.priority]),
    taskType: readSelect(properties[propertyNames.taskType]),
    assignees: readPeople(properties[propertyNames.assignee]),
    dueDate: readDate(properties[propertyNames.due]),
    taskReceiveDate: readDate(properties[propertyNames.taskReceiveDate]),
    projectIds: readRelationIds(properties[propertyNames.project]),
    projectNames: [],
    sprintIds: readRelationIds(properties[propertyNames.sprint]),
    sprintNames: [],
    number: readNumber(properties[propertyNames.number]),
    notionId: readUniqueId(properties[propertyNames.notionId]),
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
  source: { id?: string; name?: string },
  propertyNames?: NotionTaskPropertyNames
): DenoteNotionTask {
  return {
    ...normalizeNotionTaskPage(page, propertyNames),
    sourceId: String(source.id || "").trim(),
    sourceName: String(source.name || source.id || "").trim()
  };
}

function inferNotionTaskPropertyNames(schema: NotionSchema): NotionTaskPropertyNames {
  return {
    title: findPropertyName(schema, "title", ["Task name", "Name", "Title"], true),
    status: findPropertyName(schema, "status", ["Status"], true),
    assignee: findPropertyName(schema, "people", ["Assign", "Assignee", "Person", "People"], false),
    due: findPropertyName(schema, "date", ["Due", "Due date", "Deadline"], false),
    priority: findPropertyName(schema, "select", ["Priority"], false),
    taskType: findPropertyName(schema, "select", ["Task Type", "Task type"], false),
    taskReceiveDate: findPropertyName(schema, "date", ["Task Receive Date"], false),
    project: findPropertyName(schema, "relation", ["Project"], false),
    sprint: findPropertyName(schema, "relation", ["Sprint"], false),
    number: findPropertyName(schema, "number", ["Number"], false),
    notionId: findPropertyName(schema, "unique_id", ["ID"], false)
  };
}

function inferNotionTaskPropertyNamesFromPage(properties: Record<string, unknown>): NotionTaskPropertyNames {
  const schema = Object.fromEntries(
    Object.entries(properties).map(([name, property]) => [name, { type: readRecordString(property, "type") }])
  ) as NotionSchema;
  return inferNotionTaskPropertyNames(schema);
}

function defaultNotionTaskPropertyNames(): NotionTaskPropertyNames {
  return {
    ...EMPTY_PROPERTY_NAMES,
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
  };
}

function findPropertyName(schema: NotionSchema, type: string, preferredNames: string[], allowFallback: boolean): string {
  for (const name of preferredNames) {
    if (schema[name]?.type === type) {
      return name;
    }
  }
  return allowFallback ? Object.entries(schema).find(([, property]) => property?.type === type)?.[0] || "" : "";
}

function readOptions(property: NotionPropertySchema | undefined, kind: "status" | "select"): string[] {
  const options = property?.[kind]?.options?.map((option) => String(option.name || "").trim()).filter(Boolean);
  return options || [];
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
