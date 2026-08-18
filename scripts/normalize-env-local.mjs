import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const templatePath = resolve(root, ".env.example");
const localPath = resolve(root, ".env.local");

function assignments(contents) {
  const values = new Map();
  for (const line of contents.split(/\r?\n/)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (match) values.set(match[1], match[2]);
  }
  return values;
}

const template = readFileSync(templatePath, "utf8");
const current = existsSync(localPath) ? readFileSync(localPath, "utf8") : "";
const currentValues = assignments(current);
const templateKeys = new Set(assignments(template).keys());

const normalized = template
  .split(/\r?\n/)
  .map((line) => {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) return line;
    const [, key, templateValue] = match;
    return `${key}=${currentValues.get(key) ?? templateValue}`;
  })
  .join("\n")
  .replace(/\n*$/, "\n");

writeFileSync(localPath, normalized, { encoding: "utf8", mode: 0o600 });
chmodSync(localPath, 0o600);

const removedCount = [...currentValues.keys()].filter(
  (key) => !templateKeys.has(key),
).length;
console.log(
  `Normalized .env.local from .env.example (${templateKeys.size} documented keys, ${removedCount} obsolete keys removed).`,
);
