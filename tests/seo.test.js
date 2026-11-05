const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

test("the frontend exposes canonical share rewrites and homepage crawler metadata", () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(root, "client", "vercel.json"), "utf8"));
  const homepage = fs.readFileSync(path.join(root, "client", "index.html"), "utf8");
  const rewrites = vercel.rewrites;

  assert.ok(rewrites.some((rule) => rule.source === "/events/:eventId/:slug"
    && rule.destination === "https://futapulse.onrender.com/seo/events/:eventId/:slug"));
  assert.ok(rewrites.some((rule) => rule.source === "/robots.txt"
    && rule.destination === "https://futapulse.onrender.com/robots.txt"));
  assert.ok(rewrites.some((rule) => rule.source === "/sitemap.xml"
    && rule.destination === "https://futapulse.onrender.com/sitemap.xml"));
  for (const page of ["about", "privacy", "terms", "guidelines", "contact"]) {
    assert.ok(rewrites.some((rule) => rule.source === `/${page}`
      && rule.destination === `https://futapulse.onrender.com/seo/pages/${page}`));
  }
  assert.match(homepage, /<link rel="canonical" href="https:\/\/www\.futapulse\.com\.ng\/"/);
  assert.match(homepage, /property="og:title"/);
  assert.match(homepage, /name="twitter:card" content="summary_large_image"/);
  assert.match(homepage, /name="robots" content="index,follow,max-image-preview:large"/);
});
