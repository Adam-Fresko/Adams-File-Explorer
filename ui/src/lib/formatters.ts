const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit"
});

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric"
});

const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

const stripTrailingZeros = (value: string) =>
  value.replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");

const isSameLocalDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

export const formatModified = (modifiedUnixMs?: number | null): string => {
  if (modifiedUnixMs === null || modifiedUnixMs === undefined) {
    return "--";
  }

  const date = new Date(modifiedUnixMs);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }

  const now = new Date();
  if (isSameLocalDay(date, now)) {
    return `Today at ${timeFormatter.format(date)}`;
  }

  return `${dateFormatter.format(date)} at ${timeFormatter.format(date)}`;
};

export const formatSize = (sizeBytes?: number | null): string => {
  if (sizeBytes === null || sizeBytes === undefined) {
    return "--";
  }

  if (sizeBytes < 0) {
    return "--";
  }

  if (sizeBytes === 0) {
    return "0 B";
  }

  let value = sizeBytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  if (unitIndex === 0) {
    return `${Math.round(value)} ${UNITS[unitIndex]}`;
  }

  const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${stripTrailingZeros(value.toFixed(precision))} ${UNITS[unitIndex]}`;
};
