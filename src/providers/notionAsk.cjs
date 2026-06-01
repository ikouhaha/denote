function answerNotionMetadataQuestion(input = {}) {
  const question = String(input.question || "").trim();
  const tasks = Array.isArray(input.tasks) ? input.tasks : [];
  if (!question || tasks.length === 0) {
    return null;
  }

  const assignee = inferAssignee(question, input.history || [], tasks);
  const scopedTasks = assignee ? tasks.filter((task) => taskHasAssignee(task, assignee)) : tasks;
  const status = inferStatus(question, scopedTasks);
  const asksCount = asksForCount(question);
  const asksStatus = asksForStatus(question);
  const asksWhich = asksForWhich(question);

  if (asksCount && assignee) {
    return {
      status: "answered",
      text: [`There are ${scopedTasks.length} tasks assigned to ${assignee.name}.`, formatTaskTable(scopedTasks)].join("\n\n"),
      sources: []
    };
  }

  if (asksCount && status) {
    const matchedTasks = scopedTasks.filter((task) => normalizeText(task.status) === normalizeText(status));
    return {
      status: "answered",
      text: matchedTasks.length
        ? [`There are ${matchedTasks.length} tasks with Status = ${status}.`, formatTaskTable(matchedTasks)].join("\n\n")
        : `There are 0 tasks with Status = ${status}.`,
      sources: []
    };
  }

  if (asksStatus && scopedTasks.length > 0) {
    return {
      status: "answered",
      text: [`${assignee ? `${assignee.name}: ` : ""}${scopedTasks.length} tasks by Status:`, formatStatusCounts(scopedTasks), formatTaskTable(scopedTasks)].join("\n\n"),
      sources: []
    };
  }

  if ((asksWhich || status) && status) {
    const matchedTasks = scopedTasks.filter((task) => normalizeText(task.status) === normalizeText(status));
    return {
      status: "answered",
      text: matchedTasks.length
        ? [`${assignee ? `${assignee.name}: ` : ""}${status} tasks:`, formatTaskTable(matchedTasks)].join("\n\n")
        : `There are 0 ${assignee ? `${assignee.name} ` : ""}tasks with Status = ${status}.`,
      sources: []
    };
  }

  return null;
}

function asksForCount(question) {
  return /\bhow many\b|\bcount\b|\bnumber of\b|\btotal\b|幾|几|多少|幾多|幾條|幾個|多少個|多少條/i.test(question);
}

function asksForStatus(question) {
  return /\bstatus\b|狀態|状态/i.test(question);
}

function asksForWhich(question) {
  return /\bwhich\b|哪|邊|边|那|甚麼|什麼|什么/i.test(question);
}

function inferAssignee(question, history, tasks) {
  const names = uniqueAssigneeNames(tasks);
  const haystacks = [question, ...history.slice(-6).map((message) => message && message.content).filter(Boolean)].map(normalizeText);
  for (const name of names) {
    const normalizedName = normalizeText(name);
    if (haystacks.some((item) => item.includes(normalizedName))) {
      return { name };
    }
  }
  return null;
}

function uniqueAssigneeNames(tasks) {
  const names = [];
  const seen = new Set();
  for (const task of tasks) {
    for (const assignee of Array.isArray(task.assignees) ? task.assignees : []) {
      const name = String(assignee.name || assignee.id || "").trim();
      const key = normalizeText(name);
      if (name && !seen.has(key)) {
        seen.add(key);
        names.push(name);
      }
    }
  }
  return names.sort((a, b) => b.length - a.length);
}

function taskHasAssignee(task, assignee) {
  const target = normalizeText(assignee.name);
  return (Array.isArray(task.assignees) ? task.assignees : []).some((person) => normalizeText(`${person.name || ""} ${person.id || ""}`).includes(target));
}

function inferStatus(question, tasks) {
  const normalizedQuestion = normalizeText(question);
  const statuses = [...new Set(tasks.map((task) => String(task.status || "").trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  return statuses.find((status) => textMatchesStatus(normalizedQuestion, status)) || "";
}

function textMatchesStatus(normalizedText, status) {
  const normalizedStatus = normalizeText(status);
  if (normalizedText.includes(normalizedStatus)) {
    return true;
  }
  if (normalizedStatus === "test failed") {
    return /\btest\s*(fail|failed|failing)\b/.test(normalizedText) || normalizedText.includes("測試失敗") || normalizedText.includes("测试失败");
  }
  return false;
}

function formatStatusCounts(tasks) {
  const counts = new Map();
  for (const task of tasks) {
    const status = String(task.status || "No status").trim() || "No status";
    counts.set(status, (counts.get(status) || 0) + 1);
  }
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([status, count]) => `| ${escapeTableCell(status)} | ${count} |`);
  return ["| Status | Count |", "|---|---:|", ...rows].join("\n");
}

function formatTaskTable(tasks) {
  if (!tasks.length) {
    return "";
  }
  const rows = tasks.map((task) =>
    [
      formatTaskLink(task),
      escapeTableCell(task.status || "No status"),
      escapeTableCell(formatAssignees(task)),
      escapeTableCell(task.dueDate || "No due date"),
      escapeTableCell(formatProjects(task))
    ].join(" | ")
  );
  return ["| Task | Status | Assignees | Due | Project |", "|---|---|---|---|---|", ...rows.map((row) => `| ${row} |`)].join("\n");
}

function formatTaskLink(task) {
  const title = escapeTableCell(task.title || task.id || "Untitled task");
  const url = String(task.url || "").trim();
  return url ? `[${title}](${url})` : title;
}

function formatAssignees(task) {
  return (Array.isArray(task.assignees) ? task.assignees : []).map((person) => person.name || person.id).filter(Boolean).join(", ") || "Unassigned";
}

function formatProjects(task) {
  return (Array.isArray(task.projectNames) ? task.projectNames : []).filter(Boolean).join(", ") || "No project";
}

function escapeTableCell(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

module.exports = {
  answerNotionMetadataQuestion,
  formatTaskTable
};
