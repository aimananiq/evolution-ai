export function toSlug(input: string): string {
  const stripped = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/'/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!stripped) throw new Error("invalid slug");
  return stripped;
}
