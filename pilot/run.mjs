#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PILOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const MAX_TARGETS = 10;
const MAX_RESPONSE_BYTES = 1_000_000;
const USER_AGENT = "AutomatonPilotResearch/1.0 (public pages; no automated outreach)";

function decodeHtml(text) {
  return text
    .replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number(value)))
    .replace(/&#x([\da-f]+);/gi, (_, value) => String.fromCodePoint(parseInt(value, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function htmlText(html) {
  return decodeHtml(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<\/(h[1-3]|p|li|div|section|br|tr|article)\s*>/gi, "\n")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function removeNonVisibleMarkup(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
}

function getTagText(html, tag) {
  const match = html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, "i"));
  return match ? htmlText(match[1]) : "";
}

function getMetaContent(html, key) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const name = tag.match(/\b(?:name|property)=["']([^"']+)["']/i)?.[1]?.toLowerCase();
    if (name !== key) continue;
    return decodeHtml(tag.match(/\bcontent=["']([^"']*)["']/i)?.[1] || "").trim();
  }
  return "";
}

function collectTerms(text, regex, limit = 5) {
  const results = [];
  for (const match of text.matchAll(regex)) {
    const snippet = match[0].replace(/\s+/g, " ").trim();
    if (snippet && !results.includes(snippet)) results.push(snippet);
    if (results.length >= limit) break;
  }
  return results;
}

export function extractSnapshot(html, url, capturedAt = new Date().toISOString()) {
  const visibleHtml = removeNonVisibleMarkup(html);
  const text = htmlText(visibleHtml);
  const title = getTagText(visibleHtml, "title");
  const headings = [...visibleHtml.matchAll(/<h[1-2]\b[^>]*>([\s\S]*?)<\/h[1-2]\s*>/gi)]
    .map((match) => htmlText(match[1]))
    .filter((heading) =>
      !/\b(total|check out|sign in|signing in|create an account|cart|menu|search|reset password|check your email)\b/i.test(heading),
    )
    .filter((heading) => !/^\$\s?[\d,.]+$/.test(heading))
    .filter(Boolean)
    .slice(0, 8);
  const sortedTerms = (regex) => collectTerms(text, regex).sort((a, b) => a.localeCompare(b));

  return {
    url,
    capturedAt,
    title,
    description: getMetaContent(html, "description"),
    headings,
    prices: sortedTerms(
      /\b(?:regular price|sale price|price)\s+\$?\s?\d{1,4}(?:,\d{3})*(?:\.\d{2})?|\b\d+\s*(?:count|ct)\s*[-:]\s*\$\s?\d{1,4}(?:\.\d{2})?/gi,
    ),
    offers: sortedTerms(/\b(?:save\s+\d+%|up to \d+% off|\d+% off|bundle and save|subscribe and save)/gi),
    availability: sortedTerms(/\b(?:sold out|out of stock|in stock|currently unavailable)\b/gi),
  };
}

function validateUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid HTTPS URL`);
  }
  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.port ||
    url.hostname === "localhost" ||
    /^\d+(?:\.\d+){3}$/.test(url.hostname)
  ) {
    throw new Error(`${label} must be a public HTTPS URL without credentials or a custom port`);
  }
  return url.href;
}

function validateTargets(targets) {
  if (!targets || !Array.isArray(targets.watchlist) || !Array.isArray(targets.prospects)) {
    throw new Error("Targets file must contain prospects and watchlist arrays");
  }
  if (targets.watchlist.length === 0 || targets.watchlist.length > MAX_TARGETS) {
    throw new Error(`Watchlist must contain 1-${MAX_TARGETS} pages`);
  }
  for (const [index, target] of targets.watchlist.entries()) {
    if (!target || typeof target.name !== "string" || !target.name.trim()) {
      throw new Error(`Watchlist item ${index + 1} needs a name`);
    }
    target.url = validateUrl(target.url, `Watchlist item ${index + 1} URL`);
  }
  for (const [index, prospect] of targets.prospects.entries()) {
    if (!prospect || typeof prospect.name !== "string" || !prospect.name.trim()) {
      throw new Error(`Prospect ${index + 1} needs a name`);
    }
    prospect.website = validateUrl(prospect.website, `Prospect ${index + 1} website`);
    prospect.page = validateUrl(prospect.page, `Prospect ${index + 1} page`);
  }
  return targets;
}

async function fetchPage(url) {
  const response = await fetch(url, {
    headers: {
      accept: "text/html",
      "user-agent": USER_AGENT,
    },
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status >= 300 && response.status < 400) {
    throw new Error(`Redirect refused (${response.status}); update the URL in targets.json`);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (!response.headers.get("content-type")?.toLowerCase().includes("text/html")) {
    throw new Error("Page did not return HTML");
  }
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_RESPONSE_BYTES) throw new Error("Page exceeds the 1 MB response limit");

  const reader = response.body?.getReader();
  if (!reader) throw new Error("Response body was empty");
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("Page exceeds the 1 MB response limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function escapeMarkdown(value) {
  return value.replace(/[|\\]/g, "\\$&").replace(/\s+/g, " ").trim();
}

function renderReport(snapshots, previous, prospects, failures, capturedAt) {
  const lines = [
    "# Public-page competitor watch",
    "",
    `**Captured:** ${capturedAt}`,
    "**Status:** Draft for human review; not sent to anyone.",
    "",
    "## Page observations",
    "",
  ];

  for (const { name, snapshot } of snapshots) {
    lines.push(`### ${name}`, "", `Source: [public page](${snapshot.url})`, "");
    lines.push(`- Page title: ${snapshot.title || "Not found"}`);
    if (snapshot.description) lines.push(`- Meta description: ${escapeMarkdown(snapshot.description)}`);
    if (snapshot.headings.length) {
      lines.push(`- Headings: ${snapshot.headings.map(escapeMarkdown).join("; ")}`);
    }
    for (const [label, values] of [
      ["Displayed price text", snapshot.prices],
      ["Offer text", snapshot.offers],
      ["Availability text", snapshot.availability],
    ]) {
      if (values.length) lines.push(`- ${label}: ${values.map(escapeMarkdown).join(" | ")}`);
    }

    const earlier = previous?.[snapshot.url];
    if (!earlier) {
      lines.push("- Comparison: baseline; no earlier local snapshot exists.");
    } else {
      const changed = ["title", "description", "headings", "prices", "offers", "availability"]
        .filter((key) => JSON.stringify(snapshot[key]) !== JSON.stringify(earlier[key]));
      lines.push(
        changed.length
          ? `- Comparison: possible difference in extracted fields since ${earlier.capturedAt}: ${changed.join(", ")}. This may reflect dynamic page content; verify the source before describing it as a change.`
          : `- Comparison: no change in extracted fields since ${earlier.capturedAt}.`,
      );
    }
    lines.push("");
  }

  if (failures.length) {
    lines.push("## Pages not captured", "");
    for (const failure of failures) lines.push(`- ${failure.name}: ${failure.error}`);
    lines.push("");
  }

  lines.push("## Email drafts for human review", "");
  if (!prospects.length) {
    lines.push("No prospect drafts configured.", "");
  }
  for (const prospect of prospects) {
    const snapshot = snapshots.find((item) => item.name === prospect.name)?.snapshot;
    const hook = snapshot?.headings[0] || snapshot?.title;
    lines.push(
      `### ${prospect.name}`,
      "",
      `**Public site:** ${prospect.website}`,
      "",
      `**Subject:** A small public-page research pilot for ${prospect.name}`,
      "",
      `Hi ${prospect.name} team,`,
      "",
      hook
        ? `I noticed your public site highlights “${hook}.” I’m testing a human-reviewed weekly brief tracking public product-page changes, bundles, and offers across acne-care skincare brands.`
        : "I’m testing a human-reviewed weekly brief tracking public product-page changes, bundles, and offers across acne-care skincare brands.",
      "",
      "Would a short sample be useful to your team, and which brands or changes would you want it to cover? No worries if it is not relevant.",
      "",
      "Best,",
      "[Your name]",
      "",
      "_Draft only. Verify the page and recipient, personalize it, and send manually if appropriate._",
      "",
    );
  }

  lines.push(
    "## Review checklist",
    "",
    "- Confirm every quoted observation on its source page and check the capture time.",
    "- Treat prices, offers, and stock labels as time-sensitive.",
    "- Verify the prospect and contact channel before any manual outreach.",
    "- Do not infer sales, customer demand, or health outcomes from page content.",
    "- Remove unsupported claims; no email is sent by this tool.",
    "",
  );
  return lines.join("\n");
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

export async function run({ targetsPath = path.join(PILOT_DIR, "targets.json") } = {}) {
  const targets = validateTargets(JSON.parse(await readFile(targetsPath, "utf8")));
  const stateDir = path.join(PILOT_DIR, "state");
  const reportDir = path.join(PILOT_DIR, "reports");
  const latestPath = path.join(stateDir, "latest.json");
  const previous = await readJson(latestPath, {});
  const capturedAt = new Date().toISOString();
  const snapshots = [];
  const failures = [];

  for (const target of targets.watchlist) {
    try {
      const html = await fetchPage(target.url);
      snapshots.push({
        name: target.name,
        snapshot: extractSnapshot(html, target.url, capturedAt),
      });
    } catch (error) {
      failures.push({ name: target.name, error: error.message });
    }
  }

  if (snapshots.length === 0) {
    throw new Error(`No pages captured. ${failures.map((item) => `${item.name}: ${item.error}`).join("; ")}`);
  }

  await mkdir(stateDir, { recursive: true });
  await mkdir(reportDir, { recursive: true });
  const next = { ...previous };
  for (const { snapshot } of snapshots) next[snapshot.url] = snapshot;
  const stamp = capturedAt.replace(/[:.]/g, "-");
  const reportPath = path.join(reportDir, `report-${stamp}.md`);
  await writeFile(latestPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  await writeFile(
    reportPath,
    renderReport(snapshots, previous, targets.prospects, failures, capturedAt),
    { mode: 0o600 },
  );
  return { reportPath, captured: snapshots.length, failed: failures.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = await run();
    console.log(`Captured ${result.captured} page(s); ${result.failed} failed.`);
    console.log(`Draft report: ${result.reportPath}`);
    console.log("No messages were sent.");
    if (result.failed) process.exitCode = 1;
  } catch (error) {
    console.error(`Pilot run failed: ${error.message}`);
    process.exitCode = 1;
  }
}
