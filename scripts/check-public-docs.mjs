import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const listed = spawnSync(
  "git",
  ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "*.md"],
  { cwd: root, encoding: "utf8" },
);

if (listed.status !== 0) {
  process.stderr.write(listed.stderr);
  process.exit(listed.status ?? 1);
}

const files = listed.stdout.split("\0").filter(Boolean);
const failures = [];
const forbidden = [
  {
    label: "machine-specific macOS home path",
    pattern: /\/Users\/(?!example(?:\/|$)|user(?:\/|$)|yourname(?:\/|$)|\.\.\.\/)[^/\s`)"']+\//,
  },
  {
    label: "machine-specific Linux home path",
    pattern: /\/home\/(?!dev(?:\/|$)|example(?:\/|$)|user(?:\/|$)|\.\.\.\/)[^/\s`)"']+\//,
  },
  { label: "machine-specific development shortcut", pattern: /~\/Dev\// },
  { label: "private workspace-document reference", pattern: /\bdocs\.local(?:\/|$)/ },
];

function lineOf(text, offset) {
  return text.slice(0, offset).split("\n").length;
}

for (const file of files) {
  const absolute = resolve(root, file);
  const text = readFileSync(absolute, "utf8");

  for (const { label, pattern } of forbidden) {
    const match = pattern.exec(text);
    if (match) failures.push(`${file}:${lineOf(text, match.index)}: ${label}`);
  }

  for (const match of text.matchAll(/\[[^\]]*]\((<[^>]+>|[^)\s]+)(?:\s+["'][^)]*["'])?\)/g)) {
    let target = match[1];
    if (target.startsWith("<") && target.endsWith(">")) {
      target = target.slice(1, -1);
    }
    if (
      target.startsWith("#") ||
      /^[a-z][a-z0-9+.-]*:/i.test(target) ||
      /[<>{}*$]/.test(target)
    ) {
      continue;
    }
    target = target.split("#", 1)[0].split("?", 1)[0];
    if (!target) continue;

    try {
      target = decodeURIComponent(target);
    } catch {
      failures.push(`${file}:${lineOf(text, match.index)}: invalid link encoding: ${match[1]}`);
      continue;
    }

    const destination = resolve(dirname(absolute), target);
    if (!existsSync(destination)) {
      failures.push(`${file}:${lineOf(text, match.index)}: broken local link: ${match[1]}`);
    }
  }
}

if (failures.length > 0) {
  process.stderr.write(`Public documentation check failed:\n${failures.join("\n")}\n`);
  process.exit(1);
}

process.stdout.write(`Public documentation check passed (${files.length} Markdown files).\n`);
