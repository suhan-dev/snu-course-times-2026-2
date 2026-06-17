const rawData = window.SNU_COURSES;
const rows = rawData.rows;
const pageSize = 80;
const dayLabels = ["월", "화", "수", "목", "금", "토"];
const startMinute = 8 * 60;
const endMinute = 22 * 60;
const pixelsPerMinute = 0.82;
const colorPalette = ["#59b8a8", "#7bbcec", "#ff8e83", "#b9a7ff", "#f3b85d", "#7fc97f", "#f7a6c8", "#58a6d6"];

let visibleRows = [];
let renderLimit = pageSize;
let selectedKey = "";
let selectedKeys = loadSelectedKeys();

const els = {
  visibleCount: document.querySelector("#visibleCount"),
  resultNote: document.querySelector("#resultNote"),
  courseResults: document.querySelector("#courseResults"),
  courseSearch: document.querySelector("#courseSearchInput"),
  professorSearch: document.querySelector("#professorSearchInput"),
  department: document.querySelector("#departmentInput"),
  departmentList: document.querySelector("#departmentList"),
  startTime: document.querySelector("#startTime"),
  endTime: document.querySelector("#endTime"),
  timedOnly: document.querySelector("#timedOnly"),
  reset: document.querySelector("#resetButton"),
  more: document.querySelector("#moreButton"),
  clearSchedule: document.querySelector("#clearScheduleButton"),
  timeAxis: document.querySelector("#timeAxis"),
  dayColumns: document.querySelector("#dayColumns"),
  selectedCount: document.querySelector("#selectedCount"),
  creditCount: document.querySelector("#creditCount"),
  conflictCount: document.querySelector("#conflictCount"),
  selectedNote: document.querySelector("#selectedNote"),
  conflictBanner: document.querySelector("#conflictBanner"),
  selectedCourses: document.querySelector("#selectedCourses"),
  detailTitle: document.querySelector("#detailTitle"),
  detailList: document.querySelector("#detailList"),
};

const rowByKey = new Map(rows.map((row) => [row.key, row]));
const timeOptions = [
  ["", "전체"],
  ...Array.from(new Set(rows.map((row) => row.earliestStart).filter(Boolean)))
    .sort()
    .map((value) => [value, value]),
];

function setup() {
  rawData.meta.departments.forEach((dept) => {
    const option = document.createElement("option");
    option.value = dept;
    els.departmentList.append(option);
  });

  timeOptions.forEach(([value, label]) => {
    els.startTime.add(new Option(label, value));
    els.endTime.add(new Option(label, value));
  });

  buildTimeAxis();

  document.querySelectorAll("input, select").forEach((input) => {
    input.addEventListener("input", () => {
      renderLimit = pageSize;
      applyFilters();
    });
  });

  els.reset.addEventListener("click", resetFilters);
  els.more.addEventListener("click", () => {
    renderLimit += pageSize;
    renderResults();
  });
  els.clearSchedule.addEventListener("click", () => {
    selectedKeys = [];
    persistSelectedKeys();
    renderAll();
  });

  applyFilters();
  renderSchedule();
}

function loadSelectedKeys() {
  try {
    const parsed = JSON.parse(localStorage.getItem("snuScheduleKeys") || "[]");
    return Array.isArray(parsed) ? parsed.filter((key) => typeof key === "string") : [];
  } catch {
    return [];
  }
}

function persistSelectedKeys() {
  localStorage.setItem("snuScheduleKeys", JSON.stringify(selectedKeys));
}

function checkedValues(name) {
  return new Set(Array.from(document.querySelectorAll(`input[name="${name}"]:checked`)).map((input) => input.value));
}

function normalize(value) {
  return (value || "").toLocaleLowerCase("ko-KR").trim();
}

function matchesDays(row, days) {
  if (!days.size) return true;
  return row.dayList.some((day) => days.has(day));
}

function matchesTime(row, start, end) {
  if (!start && !end) return true;
  if (!row.earliestStart) return false;
  if (start && row.earliestStart < start) return false;
  if (end && row.earliestStart > end) return false;
  return true;
}

function applyFilters() {
  const categories = checkedValues("category");
  const grades = checkedValues("grade");
  const majors = checkedValues("major");
  const days = checkedValues("day");
  const courseQuery = normalize(els.courseSearch.value);
  const professorQuery = normalize(els.professorSearch.value);
  const department = normalize(els.department.value);
  const start = els.startTime.value;
  const end = els.endTime.value;
  const timedOnly = els.timedOnly.checked;

  visibleRows = rows.filter((row) => {
    if (!categories.has(row.category)) return false;
    if (!grades.has(row.grade)) return false;
    if (!majors.has(row.majorBinary)) return false;
    if (department && normalize(row.department) !== department) return false;
    if (timedOnly && !row.schedule) return false;
    if (!matchesDays(row, days)) return false;
    if (!matchesTime(row, start, end)) return false;
    if (courseQuery && !`${row.courseName} ${row.courseCode}`.toLocaleLowerCase("ko-KR").includes(courseQuery)) return false;
    if (professorQuery && !normalize(row.professor).includes(professorQuery)) return false;
    return true;
  });

  if (!visibleRows.some((row) => row.key === selectedKey)) {
    selectedKey = visibleRows[0]?.key || selectedKeys[0] || "";
  }

  renderResults();
  renderDetail(rowByKey.get(selectedKey));
}

function renderAll() {
  renderResults();
  renderSchedule();
  renderDetail(rowByKey.get(selectedKey));
}

function renderResults() {
  const shown = visibleRows.slice(0, renderLimit);
  const frag = document.createDocumentFragment();

  shown.forEach((row) => {
    const card = document.createElement("article");
    card.className = `courseCard${row.key === selectedKey ? " selected" : ""}`;

    const header = document.createElement("div");
    header.className = "courseCardHeader";

    const titleWrap = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = row.courseName;
    const meta = document.createElement("p");
    meta.className = "courseMeta";
    meta.textContent = `${row.category} · ${row.grade} · ${row.courseCode}-${row.section} · ${row.professor || "교수 미지정"}`;
    titleWrap.append(title, meta);

    const add = document.createElement("button");
    const alreadyAdded = selectedKeys.includes(row.key);
    add.className = `addButton${alreadyAdded ? " isAdded" : ""}`;
    add.type = "button";
    add.textContent = alreadyAdded ? "추가됨" : "추가";
    add.disabled = alreadyAdded;
    add.addEventListener("click", (event) => {
      event.stopPropagation();
      addCourse(row.key);
    });

    header.append(titleWrap, add);

    const time = document.createElement("p");
    time.className = "courseTime";
    time.textContent = row.schedule || "시간 미공개";

    card.append(header, time);
    card.addEventListener("click", () => {
      selectedKey = row.key;
      renderResults();
      renderDetail(row);
    });
    frag.append(card);
  });

  els.courseResults.replaceChildren(frag);
  els.visibleCount.textContent = visibleRows.length.toLocaleString("ko-KR");
  els.resultNote.textContent = `${Math.min(renderLimit, visibleRows.length).toLocaleString("ko-KR")} / ${visibleRows.length.toLocaleString("ko-KR")}`;
  els.more.hidden = shown.length >= visibleRows.length;
}

function addCourse(key) {
  if (!selectedKeys.includes(key)) {
    selectedKeys.push(key);
    selectedKey = key;
    persistSelectedKeys();
    renderAll();
  }
}

function removeCourse(key) {
  selectedKeys = selectedKeys.filter((item) => item !== key);
  if (selectedKey === key) selectedKey = selectedKeys[0] || visibleRows[0]?.key || "";
  persistSelectedKeys();
  renderAll();
}

function parseMinute(value) {
  const match = /(\d{2}):(\d{2})/.exec(value || "");
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function formatHour(minute) {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:00`;
}

function parseBlocks(row) {
  const blocks = [];
  const source = row.schedule || "";
  const pattern = /([월화수목금토])\(([^)]+)\)/g;
  let match;
  while ((match = pattern.exec(source))) {
    const day = match[1];
    const ranges = match[2].split(";").map((part) => part.trim());
    ranges.forEach((range) => {
      const rangeMatch = /(\d{2}:\d{2})~(\d{2}:\d{2})/.exec(range);
      if (!rangeMatch) return;
      const start = parseMinute(rangeMatch[1]);
      const end = parseMinute(rangeMatch[2]);
      if (start == null || end == null) return;
      blocks.push({ day, start, end: end + 10, label: `${rangeMatch[1]}~${rangeMatch[2]}` });
    });
  }
  return blocks;
}

function selectedRows() {
  return selectedKeys.map((key) => rowByKey.get(key)).filter(Boolean);
}

function conflictKeys(items) {
  const conflicts = new Set();
  const byDay = new Map(dayLabels.map((day) => [day, []]));
  items.forEach((row) => {
    parseBlocks(row).forEach((block) => {
      byDay.get(block.day)?.push({ ...block, key: row.key });
    });
  });
  byDay.forEach((blocks) => {
    for (let i = 0; i < blocks.length; i += 1) {
      for (let j = i + 1; j < blocks.length; j += 1) {
        if (blocks[i].start < blocks[j].end && blocks[j].start < blocks[i].end) {
          conflicts.add(blocks[i].key);
          conflicts.add(blocks[j].key);
        }
      }
    }
  });
  return conflicts;
}

function buildTimeAxis() {
  const frag = document.createDocumentFragment();
  for (let minute = startMinute; minute <= endMinute; minute += 60) {
    const label = document.createElement("div");
    label.className = "timeLabel";
    label.style.top = `${(minute - startMinute) * pixelsPerMinute}px`;
    label.textContent = formatHour(minute);
    frag.append(label);
  }
  els.timeAxis.replaceChildren(frag);
}

function renderSchedule() {
  const items = selectedRows();
  const conflicts = conflictKeys(items);
  const columns = new Map();
  dayLabels.forEach((day) => {
    const col = document.createElement("div");
    col.className = "dayColumn";
    col.dataset.day = day;
    columns.set(day, col);
  });

  items.forEach((row, index) => {
    const color = colorPalette[index % colorPalette.length];
    parseBlocks(row).forEach((block) => {
      const column = columns.get(block.day);
      if (!column) return;
      const el = document.createElement("button");
      el.type = "button";
      el.className = `courseBlock${conflicts.has(row.key) ? " conflict" : ""}`;
      el.style.top = `${Math.max(0, block.start - startMinute) * pixelsPerMinute}px`;
      el.style.height = `${Math.max(28, (block.end - block.start) * pixelsPerMinute)}px`;
      el.style.background = color;
      el.innerHTML = `<strong>${escapeHtml(row.courseName)}</strong><span>${escapeHtml(row.section)} · ${escapeHtml(row.professor || "교수 미지정")}</span><span>${escapeHtml(block.label)}</span>`;
      el.addEventListener("click", () => {
        selectedKey = row.key;
        renderResults();
        renderDetail(row);
      });
      column.append(el);
    });
  });

  els.dayColumns.replaceChildren(...dayLabels.map((day) => columns.get(day)));
  renderSelectedList(items, conflicts);
}

function renderSelectedList(items, conflicts) {
  const credits = items.reduce((sum, row) => sum + (Number.parseFloat(row.credits) || 0), 0);
  els.selectedCount.textContent = items.length.toLocaleString("ko-KR");
  els.creditCount.textContent = credits.toLocaleString("ko-KR", { maximumFractionDigits: 1 });
  els.conflictCount.textContent = conflicts.size.toLocaleString("ko-KR");
  els.selectedNote.textContent = items.length ? `${items.length}개 선택` : "비어 있음";
  els.conflictBanner.hidden = conflicts.size === 0;

  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "courseMeta";
    empty.textContent = "왼쪽 검색 결과에서 과목을 추가하면 시간표에 표시됩니다.";
    els.selectedCourses.replaceChildren(empty);
    return;
  }

  const frag = document.createDocumentFragment();
  items.forEach((row, index) => {
    const card = document.createElement("article");
    card.className = "selectedCard";
    card.style.borderLeftColor = colorPalette[index % colorPalette.length];
    const title = document.createElement("h3");
    title.textContent = row.courseName;
    const info = document.createElement("p");
    info.textContent = `${row.courseCode}-${row.section} · ${row.professor || "교수 미지정"} · ${row.schedule || "시간 미공개"}`;
    const remove = document.createElement("button");
    remove.className = "removeButton";
    remove.type = "button";
    remove.textContent = "삭제";
    remove.addEventListener("click", () => removeCourse(row.key));
    card.addEventListener("click", () => {
      selectedKey = row.key;
      renderResults();
      renderDetail(row);
    });
    card.append(title, info, remove);
    frag.append(card);
  });
  els.selectedCourses.replaceChildren(frag);
}

function detailRow(label, value, badge = false) {
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  if (badge && value) {
    const span = document.createElement("span");
    span.className = "badge";
    span.textContent = value;
    dd.append(span);
  } else {
    dd.textContent = value || "-";
  }
  return [dt, dd];
}

function renderDetail(row) {
  if (!row) {
    els.detailTitle.textContent = "과목을 선택하세요";
    els.detailList.replaceChildren();
    return;
  }
  els.detailTitle.textContent = row.courseName;
  els.detailList.replaceChildren(
    ...detailRow("시간표", row.schedule || "시간 미공개", Boolean(row.schedule)),
    ...detailRow("필터 기준 시간대", row.timeSlots),
    ...detailRow("과목번호", `${row.courseCode} / ${row.section}`),
    ...detailRow("구분", `${row.category} · ${row.grade} · ${row.majorStatus}`),
    ...detailRow("학과", row.department),
    ...detailRow("담당교수", row.professor),
    ...detailRow("학점", row.credits),
    ...detailRow("수강신청인원/정원", row.enrollmentCapacity),
    ...detailRow("시간 출처", row.scheduleSource),
  );
}

function resetFilters() {
  document.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.checked = input.name !== "day" && input.id !== "timedOnly";
  });
  els.courseSearch.value = "";
  els.professorSearch.value = "";
  els.department.value = "";
  els.startTime.value = "";
  els.endTime.value = "";
  renderLimit = pageSize;
  applyFilters();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

setup();
