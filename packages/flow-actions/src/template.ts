export interface TemplateVars {
  contact: { name: string; phone: string };
  response: string;
}

const TOKEN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

/** Replace {{contact.name}}, {{contact.phone}}, {{response}}; unknown tokens -> "". */
export function renderTemplate(input: string, vars: TemplateVars): string {
  const map: Record<string, string> = {
    "contact.name": vars.contact.name ?? "",
    "contact.phone": vars.contact.phone ?? "",
    response: vars.response ?? "",
  };
  return input.replace(TOKEN, (_m, key: string) => map[key] ?? "");
}
