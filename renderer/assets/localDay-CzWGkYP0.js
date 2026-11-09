function localDayStart(timestamp) {
  const day = new Date(timestamp);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}
function localDayKey(timestamp) {
  const day = new Date(timestamp);
  const month = `${day.getMonth() + 1}`.padStart(2, "0");
  const date = `${day.getDate()}`.padStart(2, "0");
  return `${day.getFullYear()}-${month}-${date}`;
}
function recentLocalDays(days, now = Date.now()) {
  const count = Math.max(0, Math.floor(days));
  const anchor = new Date(localDayStart(now));
  const windows = [];
  for (let offset = count - 1; offset >= 0; offset--) {
    const start = new Date(anchor);
    start.setDate(start.getDate() - offset);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    windows.push({ key: localDayKey(start.getTime()), start: start.getTime(), end: end.getTime() });
  }
  return windows;
}
function currentLocalDay(now = Date.now()) {
  const start = localDayStart(now);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { key: localDayKey(start), start, end: end.getTime() };
}
export {
  currentLocalDay as c,
  localDayKey as l,
  recentLocalDays as r
};
