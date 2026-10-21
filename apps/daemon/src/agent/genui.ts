// Light validation of render_ui trees against the catalog in @bits/protocol (UINode).
// Errors go back to the model so it can fix its own output; clients still render defensively.

const CONTAINERS = new Set(["stack", "row", "grid"]);
const REQUIRED: Record<string, string[]> = {
  stack: ["children"],
  row: ["children"],
  grid: ["children"],
  card: [],
  heading: ["text"],
  text: ["text"],
  stat: ["label", "value"],
  list: ["items"],
  table: ["columns", "rows"],
  chart: ["kind", "data", "x", "series"],
  timeline: ["items"],
  checklist: ["items"],
  image: ["src"],
  link: ["href", "title"],
  callout: ["text"],
  badge: ["text"],
  progress: ["value"],
  divider: [],
  actions: ["buttons"],
};

export function validateUI(node: unknown, at = "ui", depth = 0, errors: string[] = []): string[] {
  if (depth > 12) {
    errors.push(`${at}: nested too deeply`);
    return errors;
  }
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    errors.push(`${at}: must be an object with a "type"`);
    return errors;
  }
  const n = node as Record<string, unknown>;
  const type = n.type as string;
  if (!(type in REQUIRED)) {
    errors.push(`${at}: unknown type "${type}" (allowed: ${Object.keys(REQUIRED).join(", ")})`);
    return errors;
  }
  for (const key of REQUIRED[type]) if (n[key] === undefined) errors.push(`${at} (${type}): missing "${key}"`);
  if ((CONTAINERS.has(type) || type === "card") && n.children !== undefined) {
    if (!Array.isArray(n.children)) errors.push(`${at}.children: must be an array`);
    else n.children.forEach((c, i) => validateUI(c, `${at}.children[${i}]`, depth + 1, errors));
  }
  for (const key of ["items", "rows", "columns", "data", "series", "buttons"]) {
    if (n[key] !== undefined && !Array.isArray(n[key])) errors.push(`${at} (${type}).${key}: must be an array`);
  }
  if (type === "table" && Array.isArray(n.rows) && Array.isArray(n.columns)) {
    n.rows.forEach((r, i) => {
      if (!Array.isArray(r)) errors.push(`${at}.rows[${i}]: must be an array`);
    });
  }
  if (type === "chart" && !["bar", "line", "area"].includes(n.kind as string)) errors.push(`${at}: chart kind must be bar|line|area`);
  return errors;
}
