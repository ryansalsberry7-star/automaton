import assert from "node:assert/strict";
import test from "node:test";
import { extractSnapshot } from "./run.mjs";

test("extractSnapshot records title, visible headings, offers, and price snippets", () => {
  const result = extractSnapshot(
    `<html><head><title>Daily Acne Care</title>
      <meta name="description" content="A simple routine &amp; clear details"></head>
      <body><script>Ignore this $999 offer</script><h1>Cleanse and treat</h1>
      <p>Save 20% on this bundle. Regular price $121.00.</p><p>Sold out</p></body></html>`,
    "https://example.com/product",
    "2026-11-02T00:00:00.000Z",
  );

  assert.equal(result.title, "Daily Acne Care");
  assert.equal(result.description, "A simple routine & clear details");
  assert.deepEqual(result.headings, ["Cleanse and treat"]);
  assert.match(result.prices[0], /\$121\.00/);
  assert.match(result.offers[0], /Save 20%/i);
  assert.match(result.availability[0], /Sold out/i);
  assert.equal(result.capturedAt, "2026-11-02T00:00:00.000Z");
});

test("extractSnapshot ignores script content and tolerates missing metadata", () => {
  const result = extractSnapshot(
    "<html><head></head><body><script><h1>Injected</h1></script><p>Visible text</p></body></html>",
    "https://example.com/",
  );

  assert.equal(result.title, "");
  assert.equal(result.description, "");
  assert.deepEqual(result.headings, []);
  assert.deepEqual(result.prices, []);
});

test("extractSnapshot excludes cart totals from outreach hooks and normalizes terms", () => {
  const result = extractSnapshot(
    `<main><h1>$0.00</h1><h1>Acne-care routine</h1>
      <p>Save 20% on this set.</p><p>Price $45.00</p></main>`,
    "https://example.com/product",
  );

  assert.deepEqual(result.headings, ["Acne-care routine"]);
  assert.deepEqual(result.offers, ["Save 20%"]);
  assert.deepEqual(result.prices, ["Price $45.00"]);
});
