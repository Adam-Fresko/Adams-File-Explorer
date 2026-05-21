const EXTENSION_ALIAS_GROUPS = [
  ["jpg", "jpeg"],
  ["tif", "tiff"],
  ["heic", "heif"]
];

export const extensionAliases = (extension: string): string[] => {
  const normalized = extension.trim().replace(/^\./, "").toLowerCase();
  if (!normalized) {
    return [];
  }

  const group = EXTENSION_ALIAS_GROUPS.find((aliases) => aliases.includes(normalized));
  if (!group) {
    return [normalized];
  }

  return [normalized, ...group.filter((alias) => alias !== normalized)];
};

export const openWithValueForExtension = (
  map: Record<string, string>,
  extension: string | null
): string | undefined => {
  if (!extension) {
    return undefined;
  }

  return extensionAliases(extension)
    .map((alias) => map[alias])
    .find((value): value is string => !!value);
};

export const withOpenWithValueForAliases = (
  map: Record<string, string>,
  extension: string,
  value: string
): Record<string, string> => {
  const aliases = extensionAliases(extension);
  if (!aliases.length) {
    return map;
  }

  return aliases.reduce(
    (next, alias) => ({
      ...next,
      [alias]: value
    }),
    { ...map }
  );
};
