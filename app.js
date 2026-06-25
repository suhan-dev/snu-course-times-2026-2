const rawData = window.SNU_COURSES;
const rows = rawData.rows;
const pageSize = 80;
const dayLabels = ["월", "화", "수", "목", "금", "토"];
const startMinute = 8 * 60;
const endMinute = 22 * 60;
const fallbackPixelsPerMinute = 0.49;
const scheduleStorageKey = "snuScheduleState:2026-2";
const legacyScheduleStorageKey = "snuScheduleKeys";
const themeStorageKey = "snuTheme:2026-2";
const colorPalette = ["#59b8a8", "#7bbcec", "#ff8e83", "#b9a7ff", "#f3b85d", "#7fc97f", "#f7a6c8", "#58a6d6"];
const strictCompactQueries = new Set(["전자기"]);
const englishLectureQueries = new Set(["영강", "영어강의", "영어강좌", "englishlecture", "english"]);

let visibleRows = [];
let renderLimit = pageSize;
let selectedKey = "";
let selectedKeys = [];
let resizeTimer;

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
  more: document.querySelector("#moreButton"),
  clearSchedule: document.querySelector("#clearScheduleButton"),
  saveImage: document.querySelector("#saveImageButton"),
  themeToggle: document.querySelector("#themeToggleButton"),
  themeToggleText: document.querySelector("#themeToggleText"),
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
  lastUpdated: document.querySelector("#lastUpdatedText"),
};

const rowByKey = new Map(rows.map((row) => [row.key, row]));
const rowOrder = new Map(rows.map((row, index) => [row.key, index]));
const rowKeyByStableId = new Map(rows.map((row) => [stableCourseId(row), row.key]));
selectedKeys = loadSelectedKeys();
selectedKey = selectedKeys[0] || "";
const timeOptions = [
  ["", "전체"],
  ...Array.from(new Set(rows.map((row) => row.earliestStart).filter(Boolean)))
    .sort()
    .map((value) => [value, value]),
];

function setup() {
  applyTheme(loadTheme());
  requestDurableStorage();
  renderLastUpdated();
  persistScheduleState();

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

  els.more.addEventListener("click", () => {
    renderLimit += pageSize;
    renderResults();
  });
  els.saveImage.addEventListener("click", downloadTimetableImage);
  els.themeToggle.addEventListener("click", () => {
    applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark", true);
  });
  els.clearSchedule.addEventListener("click", () => {
    selectedKeys = [];
    selectedKey = visibleRows[0]?.key || "";
    persistScheduleState();
    renderAll();
  });
  window.addEventListener("pagehide", persistScheduleState);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") persistScheduleState();
  });
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      buildTimeAxis();
      renderSchedule();
    }, 80);
  });

  applyFilters();
  renderSchedule();
  window.requestAnimationFrame(() => {
    buildTimeAxis();
    renderSchedule();
  });
}

function renderLastUpdated() {
  if (!els.lastUpdated) return;
  const fetchedAt = rawData.meta?.fetchedAt || "";
  els.lastUpdated.textContent = fetchedAt ? `마지막 업데이트 ${formatUpdatedAt(fetchedAt)}` : "업데이트 시간 확인 중";
}

function formatUpdatedAt(value) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
  if (!match) return value;
  const [, year, month, day, hour, minute] = match;
  return `${year}.${month}.${day} ${hour}:${minute}`;
}

async function requestDurableStorage() {
  try {
    if (navigator.storage?.persist) await navigator.storage.persist();
  } catch {
    // Storage persistence is a browser hint; saving still works without it.
  }
}

function loadTheme() {
  try {
    return localStorage.getItem(themeStorageKey) === "dark" ? "dark" : "light";
  } catch {
    return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  }
}

function applyTheme(theme, persist = false) {
  const isDark = theme === "dark";
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
  els.themeToggle?.setAttribute("aria-pressed", String(isDark));
  if (els.themeToggleText) els.themeToggleText.textContent = isDark ? "라이트모드" : "다크모드";
  try {
    if (persist) localStorage.setItem(themeStorageKey, isDark ? "dark" : "light");
  } catch {}
}

function stableCourseId(row) {
  return [row.category, row.courseCode, row.section].map((part) => String(part || "")).join("|");
}

function uniqueValidKeys(keys) {
  const seen = new Set();
  return keys.filter((key) => {
    if (!rowByKey.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function keysFromStableIds(ids) {
  return uniqueValidKeys(ids.map((id) => rowKeyByStableId.get(id)).filter(Boolean));
}

function loadSelectedKeys() {
  try {
    const parsed = JSON.parse(localStorage.getItem(scheduleStorageKey) || "null");
    if (Array.isArray(parsed?.selectedStableIds)) {
      const keys = keysFromStableIds(parsed.selectedStableIds);
      if (keys.length) return keys;
    }
    if (Array.isArray(parsed?.selectedKeys)) {
      const keys = uniqueValidKeys(parsed.selectedKeys);
      if (keys.length) return keys;
    }
    if (Array.isArray(parsed)) {
      const keys = uniqueValidKeys(parsed);
      if (keys.length) return keys;
    }
  } catch {
    return loadLegacySelectedKeys();
  }
  return loadLegacySelectedKeys();
}

function loadLegacySelectedKeys() {
  try {
    const parsed = JSON.parse(localStorage.getItem(legacyScheduleStorageKey) || "[]");
    return Array.isArray(parsed) ? uniqueValidKeys(parsed.filter((key) => typeof key === "string")) : [];
  } catch {
    return [];
  }
}

function persistScheduleState() {
  const validKeys = uniqueValidKeys(selectedKeys);
  const selectedRow = validKeys.includes(selectedKey) ? rowByKey.get(selectedKey) : null;
  selectedKeys = validKeys;
  const state = {
    version: 2,
    term: rawData.meta?.term || "2026 2학기",
    updatedAt: new Date().toISOString(),
    selectedKeys: validKeys,
    selectedStableIds: validKeys.map((key) => stableCourseId(rowByKey.get(key))),
    selectedKey: selectedRow ? selectedKey : validKeys[0] || "",
    selectedStableId: selectedRow ? stableCourseId(selectedRow) : "",
  };
  try {
    localStorage.setItem(scheduleStorageKey, JSON.stringify(state));
    localStorage.setItem(legacyScheduleStorageKey, JSON.stringify(validKeys));
  } catch {
    // Private/incognito storage can reject writes; the in-memory schedule still works.
  }
}

function checkedValues(name) {
  return new Set(Array.from(document.querySelectorAll(`input[name="${name}"]:checked`)).map((input) => input.value));
}

function normalize(value) {
  return (value || "").toLocaleLowerCase("ko-KR").trim();
}

function compactNormalize(value) {
  return normalize(value).replace(/[^0-9a-z가-힣ㄱ-ㅎㅏ-ㅣ]+/g, "");
}

function orderedCharacterMatch(value, query) {
  const compactValue = compactNormalize(value);
  const compactQuery = compactNormalize(query);
  if (!compactQuery) return { start: 0, span: 0 };

  let fromIndex = 0;
  let startIndex = -1;
  let endIndex = -1;
  for (const character of compactQuery) {
    const foundIndex = compactValue.indexOf(character, fromIndex);
    if (foundIndex === -1) return null;
    if (startIndex === -1) startIndex = foundIndex;
    endIndex = foundIndex;
    fromIndex = foundIndex + character.length;
  }
  return { start: startIndex, span: endIndex - startIndex + 1 };
}

function includesOrderedCharacters(value, query) {
  return Boolean(orderedCharacterMatch(value, query));
}

function includesLooseSpacing(value, query) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return true;
  const normalizedValue = normalize(value);
  const compactQuery = compactNormalize(normalizedQuery);
  if (normalizedValue.includes(normalizedQuery)) return true;
  if (compactNormalize(value).includes(compactQuery)) return true;
  return false;
}

function professorSearchText(row) {
  return row.professor || "교수 미정 교수미지정 담당교수 미정";
}

function matchesCourseQuery(row, query) {
  return Number.isFinite(courseSearchScore(row, query));
}

function courseSearchScore(row, query) {
  const normalizedQuery = normalize(query);
  const compactQuery = compactNormalize(normalizedQuery);
  if (!compactQuery) return 0;

  const compactName = compactNormalize(row.courseName);
  const compactCode = compactNormalize(row.courseCode);
  if (englishLectureQueries.has(compactQuery)) return row.isEnglishLecture ? 1 : Number.POSITIVE_INFINITY;
  if (compactName === compactQuery) return 0;
  if (compactName.startsWith(compactQuery)) return 10 + compactName.length - compactQuery.length;

  const nameIndex = compactName.indexOf(compactQuery);
  if (nameIndex !== -1) return 30 + nameIndex + compactName.length / 100;
  if (strictCompactQueries.has(compactQuery)) return Number.POSITIVE_INFINITY;

  const orderedMatch = orderedCharacterMatch(row.courseName, normalizedQuery);
  if (orderedMatch) return 100 + orderedMatch.start * 4 + orderedMatch.span + compactName.length / 100;

  const codeIndex = compactCode.indexOf(compactQuery);
  if (codeIndex !== -1) return 1000 + codeIndex + compactCode.length / 100;
  return Number.POSITIVE_INFINITY;
}

function selectedValue(name) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value || "";
}

function matchesDays(row, days, mode) {
  if (!days.size) return true;
  if (mode === "exact") {
    if (row.dayList.length !== days.size) return false;
    return row.dayList.every((day) => days.has(day));
  }
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
  const dayMode = selectedValue("dayMode") || "include";
  const courseQuery = els.courseSearch.value;
  const professorQuery = els.professorSearch.value;
  const department = normalize(els.department.value);
  const start = els.startTime.value;
  const end = els.endTime.value;

  visibleRows = rows.filter((row) => {
    if (!categories.has(row.category)) return false;
    if (!grades.has(row.grade)) return false;
    if (!majors.has(row.majorBinary)) return false;
    if (department && !includesLooseSpacing(row.department, department)) return false;
    if (!matchesDays(row, days, dayMode)) return false;
    if (!matchesTime(row, start, end)) return false;
    if (!matchesCourseQuery(row, courseQuery)) return false;
    if (!includesLooseSpacing(professorSearchText(row), professorQuery)) return false;
    return true;
  });

  if (normalize(courseQuery)) {
    visibleRows.sort((left, right) => {
      const scoreDelta = courseSearchScore(left, courseQuery) - courseSearchScore(right, courseQuery);
      return scoreDelta || (rowOrder.get(left.key) ?? 0) - (rowOrder.get(right.key) ?? 0);
    });
  }

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
    const titleLine = document.createElement("div");
    titleLine.className = "courseTitleLine";
    const title = document.createElement("h3");
    title.textContent = row.courseName;
    titleLine.append(title);
    if (row.isEnglishLecture) {
      const englishBadge = document.createElement("span");
      englishBadge.className = "miniBadge englishBadge";
      englishBadge.textContent = "영강";
      englishBadge.title = "영어강의";
      titleLine.append(englishBadge);
    }
    const meta = document.createElement("p");
    meta.className = "courseMeta";
    meta.textContent = `${row.category} · ${row.grade} · ${row.department || "학과 미지정"} · ${row.courseCode}-${row.section} · ${row.professor || "교수 미지정"}`;
    meta.title = meta.textContent;
    titleWrap.append(titleLine, meta);

    const add = document.createElement("button");
    const alreadyAdded = selectedKeys.includes(row.key);
    add.className = `addButton${alreadyAdded ? " isRemove" : ""}`;
    add.type = "button";
    add.textContent = alreadyAdded ? "삭제" : "추가";
    add.setAttribute("aria-label", alreadyAdded ? `${row.courseName} 삭제` : `${row.courseName} 추가`);
    add.addEventListener("click", (event) => {
      event.stopPropagation();
      if (alreadyAdded) removeCourse(row.key);
      else addCourse(row.key);
    });

    header.append(titleWrap, add);

    const time = document.createElement("p");
    time.className = "courseTime";
    time.textContent = row.schedule || "시간 미공개";
    time.title = time.textContent;

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
    persistScheduleState();
    renderAll();
  }
}

function removeCourse(key) {
  selectedKeys = selectedKeys.filter((item) => item !== key);
  if (selectedKey === key) selectedKey = selectedKeys[0] || visibleRows[0]?.key || "";
  persistScheduleState();
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

function currentPixelsPerMinute() {
  const timelineHeight = els.dayColumns?.getBoundingClientRect().height || els.timeAxis?.getBoundingClientRect().height || 0;
  const minutes = endMinute - startMinute;
  const pixelsPerMinute = timelineHeight > 0 ? timelineHeight / minutes : fallbackPixelsPerMinute;
  document.documentElement.style.setProperty("--minute-px", `${pixelsPerMinute}px`);
  return pixelsPerMinute;
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
      blocks.push({ day, start, end, label: `${rangeMatch[1]}~${rangeMatch[2]}` });
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
  const pixelsPerMinute = currentPixelsPerMinute();
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
  const pixelsPerMinute = currentPixelsPerMinute();
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
      const heightPx = (block.end - block.start) * pixelsPerMinute;
      const densityClass = heightPx < 28 ? " isMicro" : heightPx < 56 ? " isTiny" : heightPx < 76 ? " isCompact" : " isFull";
      el.className = `courseBlock${densityClass}${conflicts.has(row.key) ? " conflict" : ""}`;
      el.style.top = `${Math.max(0, block.start - startMinute) * pixelsPerMinute}px`;
      el.style.height = `${heightPx}px`;
      el.style.background = rgbaColor(color, 0.13);
      el.style.borderColor = color;
      el.style.color = mixWithInk(color);
      el.title = `${row.courseName} ${row.section} · ${row.professor || "교수 미지정"} · ${block.label}`;
      el.setAttribute("aria-label", `${row.courseName} ${row.section} · ${row.professor || "교수 미지정"} · ${block.label}`);
      const title = `<strong>${escapeHtml(row.courseName)}</strong><span class="professorName">${escapeHtml(row.professor || "교수 미지정")}</span>`;
      el.innerHTML = title;
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
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      removeCourse(row.key);
    });
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
    ...detailRow("영어강의 여부", row.isEnglishLecture ? "영강 · 영어강의" : "일반", Boolean(row.isEnglishLecture)),
    ...detailRow("수강신청인원/정원", row.enrollmentCapacity),
    ...detailRow("시간 출처", row.scheduleSource),
    ...detailRow("특이사항", row.flags),
  );
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function hexToRgb(value) {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(value);
  if (!match) return null;
  return [Number.parseInt(match[1], 16), Number.parseInt(match[2], 16), Number.parseInt(match[3], 16)];
}

function rgbaColor(value, alpha) {
  const rgb = hexToRgb(value);
  return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})` : value;
}

function mixWithInk(value) {
  const rgb = hexToRgb(value);
  if (!rgb) return value;
  const ink = [33, 48, 68];
  const mixed = rgb.map((channel, index) => Math.round(channel * 0.68 + ink[index] * 0.32));
  return `rgb(${mixed[0]}, ${mixed[1]}, ${mixed[2]})`;
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  words.forEach((word) => {
    const trial = current ? `${current} ${word}` : word;
    if (ctx.measureText(trial).width <= maxWidth) {
      current = trial;
      return;
    }
    if (current) lines.push(current);
    current = word;
  });
  if (current) lines.push(current);

  const output = lines.slice(0, maxLines);
  output.forEach((line, index) => {
    const finalLine = index === maxLines - 1 && lines.length > maxLines ? `${line.replace(/.{2}$/, "")}...` : line;
    ctx.fillText(finalLine, x, y + index * lineHeight);
  });
  return output.length * lineHeight;
}

function downloadTimetableImage() {
  const items = selectedRows();
  const scale = 2;
  const width = 2400;
  const height = 1600;
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);

  ctx.fillStyle = "#f8fbff";
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#213044";
  ctx.font = "800 54px system-ui, -apple-system, sans-serif";
  ctx.fillText("2026-2 SNU 시간표", 72, 92);
  ctx.fillStyle = "#6d7a8d";
  ctx.font = "700 24px system-ui, -apple-system, sans-serif";
  ctx.fillText(`과목 ${items.length}개 · 학점 ${els.creditCount.textContent} · 마지막 업데이트 ${formatUpdatedAt(rawData.meta?.fetchedAt || "")}`, 72, 128);

  const tableX = 72;
  const tableY = 176;
  const tableW = width - 144;
  const tableH = height - 236;
  const timeW = 104;
  const headerH = 64;
  const dayW = (tableW - timeW) / dayLabels.length;
  const minuteScale = (tableH - headerH) / (endMinute - startMinute);

  ctx.fillStyle = "#ffffff";
  drawRoundedRect(ctx, tableX, tableY, tableW, tableH, 18);
  ctx.fill();
  ctx.strokeStyle = "#dce7ef";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = "#f8fcff";
  ctx.fillRect(tableX + 1, tableY + 1, tableW - 2, headerH);
  ctx.strokeStyle = "#dce7ef";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(tableX, tableY + headerH);
  ctx.lineTo(tableX + tableW, tableY + headerH);
  ctx.stroke();

  ctx.fillStyle = "#213044";
  ctx.font = "800 23px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("시간", tableX + timeW / 2, tableY + headerH / 2);
  dayLabels.forEach((day, index) => {
    ctx.fillText(day, tableX + timeW + dayW * index + dayW / 2, tableY + headerH / 2);
  });

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "right";
  ctx.font = "700 21px system-ui, -apple-system, sans-serif";
  for (let minute = startMinute; minute <= endMinute; minute += 60) {
    const y = tableY + headerH + (minute - startMinute) * minuteScale;
    ctx.strokeStyle = "#e5eef5";
    ctx.beginPath();
    ctx.moveTo(tableX + timeW, y);
    ctx.lineTo(tableX + tableW, y);
    ctx.stroke();
    ctx.fillStyle = "#6d7a8d";
    ctx.fillText(formatHour(minute), tableX + timeW - 18, Math.min(tableY + tableH - 12, y + 8));
  }

  ctx.strokeStyle = "#edf3f7";
  for (let index = 0; index <= dayLabels.length; index += 1) {
    const x = tableX + timeW + dayW * index;
    ctx.beginPath();
    ctx.moveTo(x, tableY + headerH);
    ctx.lineTo(x, tableY + tableH);
    ctx.stroke();
  }

  const conflicts = conflictKeys(items);
  items.forEach((row, index) => {
    const color = colorPalette[index % colorPalette.length];
    const rgb = hexToRgb(color) || [89, 184, 168];
    parseBlocks(row).forEach((block) => {
      const dayIndex = dayLabels.indexOf(block.day);
      if (dayIndex === -1) return;
      const x = tableX + timeW + dayW * dayIndex + 12;
      const y = tableY + headerH + Math.max(0, block.start - startMinute) * minuteScale;
      const w = dayW - 24;
      const h = Math.max(36, (block.end - block.start) * minuteScale);
      ctx.fillStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.16)`;
      drawRoundedRect(ctx, x, y + 7, w, Math.max(22, h - 14), 14);
      ctx.fill();
      ctx.strokeStyle = conflicts.has(row.key) ? "#ff6460" : color;
      ctx.lineWidth = conflicts.has(row.key) ? 5 : 3;
      ctx.stroke();
      ctx.fillStyle = mixWithInk(color);
      ctx.textAlign = "center";
      ctx.font = "800 24px system-ui, -apple-system, sans-serif";
      const textY = y + Math.max(34, h / 2 - 13);
      wrapCanvasText(ctx, row.courseName, x + w / 2, textY, w - 32, 30, h < 70 ? 1 : 2);
      if (h >= 70) {
        ctx.font = "700 18px system-ui, -apple-system, sans-serif";
        ctx.fillText(row.professor || "교수 미지정", x + w / 2, Math.min(y + h - 22, textY + 54));
      }
    });
  });

  const link = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  link.download = `snu-2026-2-timetable-${stamp}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

setup();
