export const parentDirectoryOf = (path: string): string | null => {
  if (!path) {
    return null;
  }

  const isWindowsDrivePath = /^[A-Za-z]:[\\/]/.test(path);
  const root = isWindowsDrivePath ? `${path.slice(0, 2)}\\` : path.startsWith("/") ? "/" : "";

  let trimmed = path;
  while (trimmed.length > root.length && (trimmed.endsWith("/") || trimmed.endsWith("\\"))) {
    trimmed = trimmed.slice(0, -1);
  }

  if (!trimmed || trimmed === root) {
    return null;
  }

  const lastSeparatorIndex = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (lastSeparatorIndex < 0) {
    return null;
  }

  if (isWindowsDrivePath && lastSeparatorIndex <= 2) {
    return root;
  }

  if (lastSeparatorIndex === 0) {
    return "/";
  }

  return trimmed.slice(0, lastSeparatorIndex);
};
