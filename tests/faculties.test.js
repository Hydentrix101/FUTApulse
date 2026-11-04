const test = require("node:test");
const assert = require("node:assert/strict");

test("SIMME and SESE use their updated departments and the SEET logo", async () => {
  const { DEPARTMENTS, getFacultyLogoPath } = await import("../client/src/utils/faculties.js");

  assert.deepEqual(DEPARTMENTS.SIMME, ["CVE", "IPE", "MEE", "MME", "MIE"]);
  assert.deepEqual(DEPARTMENTS.SESE, ["BME", "CPE", "EEE", "ICE", "MTE"]);
  assert.equal(Object.hasOwn(DEPARTMENTS, "SEET"), false);
  assert.equal(Object.hasOwn(DEPARTMENTS, "LEGACY_SEET_DEPARTMENTS"), false);
  assert.equal(Object.values(DEPARTMENTS).some((departments) => departments.includes("SEET")), false);
  assert.equal(getFacultyLogoPath("SIMME"), "/Faculty%20Logo/SEET.png");
  assert.equal(getFacultyLogoPath("SESE"), "/Faculty%20Logo/SEET.png");
});
