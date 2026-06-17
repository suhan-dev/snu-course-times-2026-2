const rawData = window.SNU_COURSES;
const rows = rawData.rows;
const pageSize = 160;
let visibleRows = [];
let renderLimit = pageSize;
let selectedKey = "";

const els = {
  totalCount: document.querySelector("#totalCount"),
  visibleCount: document.querySelector("#visibleCount"),
  timedCount: document.querySelector("#timedCount"),
  fetchedAt: document.querySelector("#fetchedAt"),
  resultNote: document.querySelector("#resultNote"),
  body: document.querySelector("#courseBody"),
  search: document.querySelector("#searchInput"),
  department: document.querySelector("#departmentInput"),
  departmentList: document.querySelector("#departmentList"),
  startTime: document.querySelector("#startTime"),
  endTime: document.querySelector("#endTime"),
  timedOnly: document.querySelector("#timedOnly"),
  reset: document.querySelector("#resetButton"),
  more: document.querySelector("#moreButton"),
  detailTitle: document.querySelector("#detailTitle"),
  detailList: document.querySelector("#detailList"),
};

const timeOptions = [
  ["", "전체"],
  ...Array.from(new Set(rows.map((row) => row.earliestStart).filter(Boolean)))
    .sort()
    .map((value) => [value, value]),
];

function setup() {
  els.totalCount.textContent = rawData.meta.totalRows.toLocaleString("ko-KR");
  els.timedCount.textContent = rawData.meta.timedRows.toLocaleString("ko-KR");
  els.fetchedAt.textContent = rawData.meta.fetchedAt;

  rawData.meta.departments.forEach((dept) => {
    const option = document.createElement("option");
    option.value = dept;
    els.departmentList.append(option);
  });

  timeOptions.forEach(([value, label]) => {
    const start = new Option(label, value);
    const end = new Option(label, value);
    els.startTime.add(start);
    els.endTime.add(end);
  });

  document.querySelectorAll("input, select").forEach((input) => {
    input.addEventListener("input", () => {
      renderLimit = pageSize;
      applyFilters();
    });
  });
  els.reset.addEventListener("click", resetFilters);
  els.more.addEventListener("click", () => {
    renderLimit += pageSize;
    renderTable();
  });

  applyFilters();
}

function checkedValues(name) {
  return new Set(
    Array.from(document.querySelectorAll(`input[name="${name}"]:checked`)).map((input) => input.value),
  );
}

function normalize(value) {
  return (value || "").toLocaleLowerCase("ko-KR").trim();
}

function matchesQuery(row, query) {
  if (!query) return true;
  return row.search.includes(query);
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
  const query = normalize(els.search.value);
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
    return matchesQuery(row, query);
  });

  if (!visibleRows.some((row) => row.key === selectedKey)) {
    selectedKey = visibleRows[0]?.key || "";
  }

  renderTable();
  renderDetail(visibleRows.find((row) => row.key === selectedKey));
}

function td(text, className = "") {
  const cell = document.createElement("td");
  cell.textContent = text || "";
  if (className) cell.className = className;
  return cell;
}

function renderTable() {
  const shown = visibleRows.slice(0, renderLimit);
  const frag = document.createDocumentFragment();

  shown.forEach((row) => {
    const tr = document.createElement("tr");
    tr.dataset.key = row.key;
    if (row.key === selectedKey) tr.classList.add("selected");
    tr.append(
      td(row.category),
      td(row.grade),
      td(row.majorBinary),
      td(row.department, "dept"),
      td(row.courseName, "course"),
      td(row.courseCode),
      td(row.section),
      td(row.professor),
      td(row.credits),
      td(row.days),
      td(row.schedule, "schedule"),
    );
    tr.addEventListener("click", () => {
      selectedKey = row.key;
      renderTable();
      renderDetail(row);
    });
    frag.append(tr);
  });

  els.body.replaceChildren(frag);
  els.visibleCount.textContent = visibleRows.length.toLocaleString("ko-KR");
  els.resultNote.textContent = `${shown.length.toLocaleString("ko-KR")} / ${visibleRows.length.toLocaleString("ko-KR")}행 표시`;
  els.more.hidden = shown.length >= visibleRows.length;
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
    els.detailTitle.textContent = "과목이 없습니다";
    els.detailList.replaceChildren();
    return;
  }
  els.detailTitle.textContent = row.courseName;
  const nodes = [
    ...detailRow("시간표", row.schedule, true),
    ...detailRow("필터 기준 시간대", row.timeSlots),
    ...detailRow("과목번호", `${row.courseCode} / ${row.section}`),
    ...detailRow("구분", `${row.category} · ${row.grade} · ${row.majorStatus}`),
    ...detailRow("학과", row.department),
    ...detailRow("담당교수", row.professor),
    ...detailRow("학점", row.credits),
    ...detailRow("수강신청인원/정원", row.enrollmentCapacity),
    ...detailRow("시간 출처", row.scheduleSource),
  ];
  els.detailList.replaceChildren(...nodes);
}

function resetFilters() {
  document.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.checked = input.name !== "day" && input.id !== "timedOnly";
  });
  els.search.value = "";
  els.department.value = "";
  els.startTime.value = "";
  els.endTime.value = "";
  renderLimit = pageSize;
  applyFilters();
}

setup();
