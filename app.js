const rawData = window.SNU_COURSES;
const rows = rawData.rows;
const pageSize = 80;
const dayLabels = ["월", "화", "수", "목", "금", "토"];
const startMinute = 8 * 60;
const endMinute = 22 * 60;
const fallbackPixelsPerMinute = 0.49;
const scheduleStorageKey = "snuScheduleState:2026-2";
const legacyScheduleStorageKey = "snuScheduleKeys";
const savedSchedulesStorageKey = "snuSavedTimetables:2026-2";
const themeStorageKey = "snuTheme:2026-2";
const shareParamName = "s";
const colorPalette = ["#59b8a8", "#7bbcec", "#ff8e83", "#b9a7ff", "#f3b85d", "#7fc97f", "#f7a6c8", "#58a6d6"];
const strictCompactQueries = new Set(["전자기"]);
const englishLectureQueries = new Set(["영강", "영어강의", "영어강좌", "englishlecture", "english"]);

let visibleRows = [];
let renderLimit = pageSize;
let selectedKey = "";
let selectedKeys = [];
let activeSavedId = "";
let savedSchedules = { activeId: "", items: [] };
let resizeTimer;
let toastTimer;
let pendingSaveMode = "save-as";
let pendingRenameId = "";

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
  newSchedule: document.querySelector("#newScheduleButton"),
  shareSchedule: document.querySelector("#shareScheduleButton"),
  saveSchedule: document.querySelector("#saveScheduleButton"),
  saveAsSchedule: document.querySelector("#saveAsScheduleButton"),
  loadSchedule: document.querySelector("#loadScheduleButton"),
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
  documentName: document.querySelector("#documentName"),
  documentStatus: document.querySelector("#documentStatus"),
  toast: document.querySelector("#toast"),
  loadModal: document.querySelector("#loadScheduleModal"),
  savedScheduleList: document.querySelector("#savedScheduleList"),
  closeLoadModal: document.querySelector("#closeLoadModalButton"),
  saveNameModal: document.querySelector("#saveNameModal"),
  saveNameTitle: document.querySelector("#saveNameTitle"),
  scheduleNameInput: document.querySelector("#scheduleNameInput"),
  confirmSaveName: document.querySelector("#confirmSaveNameButton"),
  cancelSaveName: document.querySelector("#cancelSaveNameButton"),
};

const rowByKey = new Map(rows.map((row) => [row.key, row]));
const rowOrder = new Map(rows.map((row, index) => [row.key, index]));
const rowKeyByStableId = new Map(rows.map((row) => [stableCourseId(row), row.key]));
const rowKeyByShareHash = new Map();
rows.forEach((row) => {
  const hash = courseShareHash(row);
  if (!rowKeyByShareHash.has(hash)) rowKeyByShareHash.set(hash, row.key);
});
const initialShareHashes = readShareHashesFromLocation();
savedSchedules = loadSavedSchedules();
activeSavedId = initialShareHashes.length ? "" : loadActiveSavedId();
selectedKeys = initialShareHashes.length ? keysFromShareHashes(initialShareHashes) : loadSelectedKeys();
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
  els.newSchedule.addEventListener("click", createNewSchedule);
  els.shareSchedule.addEventListener("click", shareCurrentSchedule);
  els.saveSchedule.addEventListener("click", saveCurrentSchedule);
  els.saveAsSchedule.addEventListener("click", saveCurrentScheduleAs);
  els.loadSchedule.addEventListener("click", openLoadScheduleModal);
  els.closeLoadModal.addEventListener("click", closeLoadScheduleModal);
  els.loadModal.addEventListener("click", (event) => {
    if (event.target === els.loadModal) closeLoadScheduleModal();
  });
  els.confirmSaveName.addEventListener("click", confirmNamedSave);
  els.cancelSaveName.addEventListener("click", closeSaveNameModal);
  els.saveNameModal.addEventListener("click", (event) => {
    if (event.target === els.saveNameModal) closeSaveNameModal();
  });
  els.scheduleNameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") confirmNamedSave();
    if (event.key === "Escape") closeSaveNameModal();
  });
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
  if (initialShareHashes.length) {
    removeShareParamsFromUrl();
    showToast(selectedKeys.length ? "공유 시간표를 불러왔습니다." : "불러올 수 있는 과목이 없습니다.");
  }
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

function shareCourseIdentity(row) {
  const code = compactNormalize(row.courseCode);
  const section = compactNormalize(row.section);
  // Keep share hashes tied to official course/section IDs, not row order, so data refreshes do not scramble links.
  if (code || section) return `course:${code}|section:${section}`;
  return [
    "fallback",
    compactNormalize(row.category),
    compactNormalize(row.courseName),
    compactNormalize(row.professor),
    compactNormalize(row.schedule),
  ].join("|");
}

function hashString64(value) {
  let hash = 0xcbf29ce484222325n;
  for (const character of String(value)) {
    hash ^= BigInt(character.codePointAt(0));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(36).padStart(13, "0");
}

function courseShareHash(row) {
  return hashString64(shareCourseIdentity(row));
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

function keysFromShareHashes(hashes) {
  return uniqueValidKeys(hashes.map((hash) => rowKeyByShareHash.get(hash)).filter(Boolean));
}

function uniqueShareHashesForKeys(keys) {
  return Array.from(new Set(uniqueValidKeys(keys).map((key) => courseShareHash(rowByKey.get(key)))));
}

function loadSavedSchedules() {
  try {
    const parsed = JSON.parse(localStorage.getItem(savedSchedulesStorageKey) || "null");
    const items = Array.isArray(parsed?.items) ? parsed.items : Array.isArray(parsed) ? parsed : [];
    return {
      activeId: typeof parsed?.activeId === "string" ? parsed.activeId : "",
      items: items
        .filter((item) => item && typeof item.id === "string")
        .map((item) => ({
          id: item.id,
          name: String(item.name || "내 시간표"),
          updatedAt: item.updatedAt || "",
          selectedShareHashes: parseShareHashList(Array.isArray(item.selectedShareHashes) ? item.selectedShareHashes.join(".") : item.selectedShareHashes),
          selectedStableIds: Array.isArray(item.selectedStableIds) ? item.selectedStableIds.filter(Boolean) : [],
          selectedKeys: Array.isArray(item.selectedKeys) ? item.selectedKeys.filter(Boolean) : [],
        })),
    };
  } catch {
    return { activeId: "", items: [] };
  }
}

function saveSavedSchedules() {
  try {
    savedSchedules.activeId = activeSavedId;
    localStorage.setItem(savedSchedulesStorageKey, JSON.stringify(savedSchedules));
  } catch {
    showToast("브라우저 저장 공간을 사용할 수 없습니다.");
  }
}

function loadActiveSavedId() {
  try {
    const parsed = JSON.parse(localStorage.getItem(scheduleStorageKey) || "null");
    const candidate = typeof parsed?.activeSavedId === "string" ? parsed.activeSavedId : savedSchedules.activeId;
    return savedSchedules.items.some((item) => item.id === candidate) ? candidate : "";
  } catch {
    return savedSchedules.items.some((item) => item.id === savedSchedules.activeId) ? savedSchedules.activeId : "";
  }
}

function keysFromSavedSchedule(schedule) {
  const stableKeys = keysFromStableIds(schedule?.selectedStableIds || []);
  if (stableKeys.length) return stableKeys;
  const exactKeys = uniqueValidKeys(schedule?.selectedKeys || []);
  if (exactKeys.length) return exactKeys;
  return keysFromShareHashes(schedule?.selectedShareHashes || []);
}

function createScheduleRecord(name, keys = selectedKeys) {
  const validKeys = uniqueValidKeys(keys);
  return {
    id: `tt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: String(name || "내 시간표").trim() || "내 시간표",
    updatedAt: new Date().toISOString(),
    selectedShareHashes: uniqueShareHashesForKeys(validKeys),
    selectedStableIds: validKeys.map((key) => stableCourseId(rowByKey.get(key))),
    selectedKeys: validKeys,
  };
}

function selectedSignature(keys = selectedKeys) {
  return uniqueShareHashesForKeys(keys).slice().sort().join(".");
}

function savedScheduleSignature(schedule) {
  return parseShareHashList((schedule?.selectedShareHashes || []).join(".")).slice().sort().join(".");
}

function currentSavedSchedule() {
  return savedSchedules.items.find((item) => item.id === activeSavedId) || null;
}

function isDocumentDirty() {
  const saved = currentSavedSchedule();
  if (!saved) return selectedKeys.length > 0;
  return selectedSignature() !== savedScheduleSignature(saved);
}

function scheduleStatsForKeys(keys) {
  const validKeys = uniqueValidKeys(keys);
  const credits = validKeys.reduce((sum, key) => sum + (Number.parseFloat(rowByKey.get(key)?.credits) || 0), 0);
  return {
    count: validKeys.length,
    credits: credits.toLocaleString("ko-KR", { maximumFractionDigits: 1 }),
  };
}

function defaultSaveName() {
  const saved = currentSavedSchedule();
  if (!saved) return nextScheduleName();
  let base = `${saved.name} 복사본`;
  const used = new Set(savedSchedules.items.map((item) => item.name));
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${base} ${index}`)) index += 1;
  return `${base} ${index}`;
}

function updateDocumentState() {
  const saved = currentSavedSchedule();
  const dirty = isDocumentDirty();
  const name = saved?.name || "제목 없음";
  if (els.documentName) {
    els.documentName.textContent = name;
    els.documentName.title = name;
  }
  if (els.documentStatus) {
    els.documentStatus.textContent = saved ? dirty ? "수정됨" : "저장됨" : "저장 안 됨";
    els.documentStatus.classList.toggle("saved", Boolean(saved && !dirty));
    els.documentStatus.classList.toggle("dirty", Boolean(!saved || dirty));
  }
}

function parseShareHashList(value) {
  return String(value || "")
    .split(/[.,~\s]+/)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => /^[0-9a-z]+$/.test(token));
}

function readShareHashesFromLocation() {
  try {
    const url = new URL(window.location.href);
    return parseShareHashList(url.searchParams.get(shareParamName));
  } catch {
    return [];
  }
}

function removeShareParamsFromUrl() {
  if (!window.history?.replaceState) return;
  window.history.replaceState(null, document.title, `${window.location.origin}${window.location.pathname}`);
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
    const shareKeys = keysFromShareHashes(parsed?.selectedShareHashes || []);
    if (shareKeys.length) return shareKeys;
    if (Array.isArray(parsed)) {
      const keys = uniqueValidKeys(parsed);
      if (keys.length) return keys;
    }
  } catch {
    return loadLegacySelectedKeys();
  }
  const activeSchedule = savedSchedules.items.find((item) => item.id === activeSavedId);
  if (activeSchedule) {
    const keys = keysFromSavedSchedule(activeSchedule);
    if (keys.length) return keys;
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
    selectedShareHashes: uniqueShareHashesForKeys(validKeys),
    selectedKey: selectedRow ? selectedKey : validKeys[0] || "",
    selectedStableId: selectedRow ? stableCourseId(selectedRow) : "",
    activeSavedId,
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
    meta.textContent = [
      row.category,
      row.grade,
      row.department || "학과 미지정",
      row.professor || "교수 미지정",
      `${row.courseCode}-${row.section}`,
    ].join(" · ");
    meta.title = `${row.category} · ${row.grade} · ${row.department || "학과 미지정"} · ${row.professor || "교수 미지정"} · ${row.courseCode}-${row.section}`;
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
    time.textContent = roomLine(row);
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

function showToast(message) {
  if (!els.toast) return;
  window.clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    els.toast.hidden = true;
  }, 2200);
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const input = document.createElement("textarea");
    input.value = value;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.append(input);
    input.select();
    const copied = document.execCommand("copy");
    input.remove();
    return copied;
  }
}

function buildShareUrl() {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  const hashes = uniqueShareHashesForKeys(selectedKeys);
  url.searchParams.set(shareParamName, hashes.join("."));
  return url.toString();
}

async function shareCurrentSchedule() {
  if (!selectedKeys.length) {
    showToast("공유할 과목이 없습니다.");
    return;
  }
  const copied = await copyText(buildShareUrl());
  const stats = scheduleStatsForKeys(selectedKeys);
  showToast(copied ? `현재 시간표 ${stats.credits}학점 시간표 기준으로 URL이 복사되었습니다.` : "URL 복사에 실패했습니다.");
}

function nextScheduleName() {
  const used = new Set(savedSchedules.items.map((item) => item.name));
  let index = savedSchedules.items.length + 1;
  let name = `내 시간표 ${index}`;
  while (used.has(name)) {
    index += 1;
    name = `내 시간표 ${index}`;
  }
  return name;
}

function saveCurrentSchedule() {
  const existingIndex = savedSchedules.items.findIndex((item) => item.id === activeSavedId);
  if (existingIndex === -1) {
    openSaveNameModal("save");
    return;
  }

  const previous = savedSchedules.items[existingIndex];
  savedSchedules.items[existingIndex] = {
    ...createScheduleRecord(previous.name),
    id: previous.id,
  };
  activeSavedId = previous.id;
  saveSavedSchedules();
  persistScheduleState();
  renderSchedule();
  updateDocumentState();
  showToast("시간표를 저장했습니다.");
}

function saveCurrentScheduleAs() {
  openSaveNameModal("save-as");
}

function openSaveNameModal(mode) {
  pendingSaveMode = mode;
  pendingRenameId = "";
  const isFirstSave = mode === "save";
  els.saveNameTitle.textContent = isFirstSave ? "시간표 저장" : "다른 이름으로 저장";
  els.confirmSaveName.textContent = "저장";
  els.scheduleNameInput.value = isFirstSave ? nextScheduleName() : defaultSaveName();
  els.saveNameModal.hidden = false;
  window.requestAnimationFrame(() => {
    els.scheduleNameInput.focus();
    els.scheduleNameInput.select();
  });
}

function closeSaveNameModal() {
  els.saveNameModal.hidden = true;
}

function confirmNamedSave() {
  const name = els.scheduleNameInput.value.trim();
  if (!name) {
    showToast("시간표 이름을 입력해주세요.");
    return;
  }
  if (pendingSaveMode === "rename") {
    renameSavedSchedule(pendingRenameId, name);
    return;
  }
  const record = createScheduleRecord(name);
  savedSchedules.items.unshift(record);
  activeSavedId = record.id;
  saveSavedSchedules();
  persistScheduleState();
  closeSaveNameModal();
  renderSchedule();
  updateDocumentState();
  showToast(pendingSaveMode === "save" ? "시간표를 저장했습니다." : "다른 이름으로 저장했습니다.");
}

function confirmDiscardIfDirty() {
  if (!isDocumentDirty()) return true;
  return window.confirm("저장되지 않은 변경사항이 있습니다. 계속할까요?");
}

function createNewSchedule() {
  if (!confirmDiscardIfDirty()) return;
  selectedKeys = [];
  selectedKey = visibleRows[0]?.key || "";
  activeSavedId = "";
  persistScheduleState();
  renderAll();
  showToast("새 시간표를 만들었습니다.");
}

function formatSavedAt(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function openLoadScheduleModal() {
  renderSavedScheduleList();
  els.loadModal.hidden = false;
}

function closeLoadScheduleModal() {
  els.loadModal.hidden = true;
}

function renderSavedScheduleList() {
  if (!savedSchedules.items.length) {
    const empty = document.createElement("p");
    empty.className = "savedEmpty";
    empty.textContent = "저장된 시간표가 없습니다.";
    els.savedScheduleList.replaceChildren(empty);
    return;
  }

  const frag = document.createDocumentFragment();
  savedSchedules.items.forEach((schedule) => {
    const item = document.createElement("article");
    item.className = `savedScheduleItem${schedule.id === activeSavedId ? " active" : ""}`;
    const info = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = schedule.name;
    const keys = keysFromSavedSchedule(schedule);
    const stats = scheduleStatsForKeys(keys);
    const meta = document.createElement("p");
    meta.textContent = `${stats.count}과목 · ${stats.credits}학점 · ${formatSavedAt(schedule.updatedAt) || "저장 시간 미확인"}`;
    info.append(title, meta);

    const actions = document.createElement("div");
    actions.className = "savedScheduleActions";
    const load = document.createElement("button");
    load.type = "button";
    load.className = "ghostButton smallButton";
    load.textContent = "불러오기";
    load.addEventListener("click", () => loadSavedSchedule(schedule.id));
    const rename = document.createElement("button");
    rename.type = "button";
    rename.className = "ghostButton smallButton";
    rename.textContent = "이름 변경";
    rename.addEventListener("click", () => openRenameScheduleModal(schedule.id));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "ghostButton smallButton dangerButton";
    remove.textContent = "삭제";
    remove.addEventListener("click", () => deleteSavedSchedule(schedule.id));
    actions.append(load, rename, remove);
    item.append(info, actions);
    frag.append(item);
  });
  els.savedScheduleList.replaceChildren(frag);
}

function openRenameScheduleModal(id) {
  const schedule = savedSchedules.items.find((item) => item.id === id);
  if (!schedule) return;
  pendingSaveMode = "rename";
  pendingRenameId = id;
  closeLoadScheduleModal();
  els.saveNameTitle.textContent = "시간표 이름 변경";
  els.confirmSaveName.textContent = "변경";
  els.scheduleNameInput.value = schedule.name;
  els.saveNameModal.hidden = false;
  window.requestAnimationFrame(() => {
    els.scheduleNameInput.focus();
    els.scheduleNameInput.select();
  });
}

function renameSavedSchedule(id, name) {
  const schedule = savedSchedules.items.find((item) => item.id === id);
  if (!schedule) return;
  schedule.name = name;
  schedule.updatedAt = new Date().toISOString();
  saveSavedSchedules();
  closeSaveNameModal();
  pendingRenameId = "";
  if (activeSavedId === id) updateDocumentState();
  renderSavedScheduleList();
  openLoadScheduleModal();
  showToast("시간표 이름을 변경했습니다.");
}

function loadSavedSchedule(id) {
  if (id !== activeSavedId && !confirmDiscardIfDirty()) return;
  const schedule = savedSchedules.items.find((item) => item.id === id);
  if (!schedule) return;
  selectedKeys = keysFromSavedSchedule(schedule);
  selectedKey = selectedKeys[0] || visibleRows[0]?.key || "";
  activeSavedId = schedule.id;
  saveSavedSchedules();
  persistScheduleState();
  closeLoadScheduleModal();
  renderAll();
  showToast("저장된 시간표를 불러왔습니다.");
}

function deleteSavedSchedule(id) {
  const schedule = savedSchedules.items.find((item) => item.id === id);
  if (!schedule || !window.confirm(`'${schedule.name}' 시간표를 삭제할까요?`)) return;
  savedSchedules.items = savedSchedules.items.filter((item) => item.id !== id);
  if (activeSavedId === id) activeSavedId = "";
  saveSavedSchedules();
  persistScheduleState();
  renderSavedScheduleList();
  renderSchedule();
  updateDocumentState();
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
      const blockDescription = [row.courseName, row.section, row.professor || "교수 미지정", block.label, roomText(row)]
        .filter(Boolean)
        .join(" · ");
      el.title = blockDescription;
      el.setAttribute("aria-label", blockDescription);
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
  updateDocumentState();

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
    info.textContent = [
      `${row.courseCode}-${row.section}`,
      row.professor || "교수 미지정",
      row.schedule || "시간 미공개",
      roomText(row),
    ].filter(Boolean).join(" · ");
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

function englishIndicator() {
  const span = document.createElement("span");
  span.className = "miniBadge englishBadge detailTitleBadge";
  span.textContent = "영강";
  span.title = "영어강의";
  return span;
}

function filteredFlags(row) {
  return (row.flags || "")
    .split(",")
    .map((flag) => flag.trim())
    .filter((flag) => flag && flag !== "영어강의" && flag !== "외국어강의")
    .join(", ");
}

function roomText(row) {
  return row.lectureRoom || row.scheduleRoom || "";
}

function roomLine(row) {
  const schedule = row.schedule || "시간 미공개";
  const room = roomText(row);
  return room ? `${schedule} · ${room}` : schedule;
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
  els.detailTitle.replaceChildren(document.createTextNode(row.courseName));
  if (row.isEnglishLecture) els.detailTitle.append(englishIndicator());
  const detailRows = [
    ...detailRow("시간표", row.schedule || "시간 미공개", Boolean(row.schedule)),
  ];
  if (roomText(row)) detailRows.push(...detailRow("강의실", roomText(row)));
  if (row.scheduleRoom && row.scheduleRoom !== row.lectureRoom) detailRows.push(...detailRow("시간-강의실", row.scheduleRoom));
  if (row.timeSlots) detailRows.push(...detailRow("필터 기준 시간대", row.timeSlots));
  detailRows.push(
    ...detailRow("과목번호", `${row.courseCode} / ${row.section}`),
    ...detailRow("구분", `${row.category} · ${row.grade} · ${row.majorStatus}`),
    ...detailRow("학과", row.department),
    ...detailRow("담당교수", row.professor),
    ...detailRow("학점", row.credits),
    ...detailRow("수강신청인원/정원", row.enrollmentCapacity),
    ...detailRow("시간 출처", row.scheduleSource),
  );
  if (row.roomSource) detailRows.push(...detailRow("강의실 출처", row.roomSource));
  const flags = filteredFlags(row);
  if (flags) detailRows.push(...detailRow("특이사항", flags));
  els.detailList.replaceChildren(
    ...detailRows,
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
      const textY = y + Math.max(34, h >= 110 ? h / 2 - 36 : h / 2 - 13);
      const titleHeight = wrapCanvasText(ctx, row.courseName, x + w / 2, textY, w - 32, 30, h < 70 ? 1 : 2);
      if (h >= 70) {
        ctx.font = "700 18px system-ui, -apple-system, sans-serif";
        const professorY = Math.min(y + h - (row.lectureRoom && h >= 110 ? 42 : 22), textY + titleHeight + 24);
        ctx.fillText(row.professor || "교수 미지정", x + w / 2, professorY);
        if (row.lectureRoom && h >= 110) {
          ctx.font = "700 16px system-ui, -apple-system, sans-serif";
          wrapCanvasText(ctx, row.lectureRoom, x + w / 2, Math.min(y + h - 18, professorY + 22), w - 34, 20, 1);
        }
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
