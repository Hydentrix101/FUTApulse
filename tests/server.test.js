const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "futapulse-test-"));
const dataFile = path.join(dataDirectory, "futapulse.json");
process.env.FUTAPULSE_DATA_FILE = dataFile;
process.env.MONGO_URI = "";
process.env.JWT_SECRET = "futapulse-tests-only-signing-secret";
process.env.GOOGLE_CLIENT_ID = "google-client-id-for-tests";
process.env.GOOGLE_CLIENT_SECRET = "google-client-secret-for-tests";
process.env.RESEND_API_KEY = "re_test_key_for_mock_fetch";

const { app, models, buildFacultyTurnoutBreakdown } = require("../server");
const { buildApprovedMigrationPlan } = require("../server/dataMigration");
const jwt = require("jsonwebtoken");
const deliveredEmails = [];
app.locals.emailSender = async ({ text }) => deliveredEmails.push(text);

async function createVerifiedAccount(baseUrl, email, username) {
  const signupResponse = await fetch(`${baseUrl}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, username, password: "CorrectPassword1" })
  });
  assert.equal(signupResponse.status, 202);
  const code = deliveredEmails.at(-1)?.match(/code is (\d{6})/)?.[1];
  assert.ok(code, "signup should send a six-digit verification code");
  const verifyResponse = await fetch(`${baseUrl}/api/auth/signup/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code })
  });
  assert.equal(verifyResponse.status, 201);
  return verifyResponse.json();
}

function createEvent(event) {
  return {
    id: event.id,
    title: event.title,
    category: event.category || "social",
    activity: event.activity || "Activity",
    date: new Date(Date.now() + 86400000).toISOString(),
    endTime: new Date(Date.now() + 90000000).toISOString(),
    venue: "Venue",
    venueLandmark: "Landmark",
    audience: ["all"],
    status: "Published",
    turnoutCount: 0,
    turnoutBreakdown: [],
    generatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...event
  };
}

const eventData = [
  createEvent({ id: "event-low", title: "Low", rsvpCount: 1, reminderCount: 1, flameCount: 0 }),
  createEvent({ id: "event-high", title: "High", rsvpCount: 4, reminderCount: 2, flameCount: 1 }),
  createEvent({ id: "event-mid", title: "Mid", rsvpCount: 3, reminderCount: 0, flameCount: 2 }),
  createEvent({ id: "event-zero", title: "Zero", rsvpCount: 0, reminderCount: 0, flameCount: 0 }),
  createEvent({ id: "event-legacy", title: "Legacy", reminderCount: 0, flameCount: 0 }),
  createEvent({ id: "event-no-end", title: "No end time", endTime: "", rsvpCount: 20, reminderCount: 2, flameCount: 1 }),
  createEvent({ id: "event-invalid-window", title: "Invalid event window", date: new Date(Date.now() + 86400000).toISOString(), endTime: new Date(Date.now() + 3600000).toISOString(), rsvpCount: 20, reminderCount: 2, flameCount: 1 }),
  createEvent({ id: "event-ended-31m", title: "Ended outside grace period", date: new Date(Date.now() - 2 * 3600000).toISOString(), endTime: new Date(Date.now() - 31 * 60000).toISOString(), rsvpCount: 10, reminderCount: 0, flameCount: 0 }),
  createEvent({ id: "event-ended-29m", title: "Ended inside grace period", date: new Date(Date.now() - 2 * 3600000).toISOString(), endTime: new Date(Date.now() - 29 * 60000).toISOString(), rsvpCount: 5, reminderCount: 0, flameCount: 0 })
];

test("Phase 2 migration plan includes only Immanuel's approved accounts and their events", () => {
  const source = {
    users: [
      { id: "owner-immanuel", email: "immanuelidowu1@gmail.com" },
      { id: "owner-hydentrix", email: " HYDENTRIX@gmail.com " },
      { id: "other-user", email: "demo@example.com" }
    ],
    events: [
      { id: "event-immanuel", createdByUserId: "owner-immanuel" },
      { id: "event-hydentrix", createdByUserId: "owner-hydentrix" },
      { id: "event-demo", createdByUserId: "other-user" },
      { id: "event-orphan", createdByUserId: "deleted-user" }
    ],
    eventReports: [
      { eventId: "event-immanuel" },
      { eventId: "event-demo" }
    ]
  };
  const original = JSON.stringify(source);
  const plan = buildApprovedMigrationPlan(source);

  assert.deepEqual(plan.summary, {
    approvedAccounts: 2,
    approvedEvents: 2,
    reportsForApprovedEvents: 1,
    excludedAccounts: 1,
    excludedEvents: 2
  });
  assert.deepEqual(plan.events.map((event) => event.id), ["event-immanuel", "event-hydentrix"]);
  assert.equal(JSON.stringify(source), original, "planning must not mutate the local source");
});

test("Phase 2 Mongo models define event lookup and per-account action uniqueness indexes", () => {
  const eventIndexes = models.EventRecord.schema.indexes();
  const actionIndexes = models.EngagementAction.schema.indexes();
  const reportIndexes = models.EventReport.schema.indexes();

  assert.ok(eventIndexes.some(([fields]) => fields.eventId === 1));
  assert.ok(eventIndexes.some(([fields]) => fields.status === 1 && fields.endsAt === 1));
  assert.ok(actionIndexes.some(([fields, options]) => fields.eventId === 1 && fields.userId === 1 && fields.type === 1 && options.unique));
  assert.ok(reportIndexes.some(([fields]) => fields.eventId === 1));
});

test("faculty turnout groups attendance and recovers faculty from the attendee account when an action has no snapshot", () => {
  const turnout = buildFacultyTurnoutBreakdown([
    { userId: "attendee-one", faculty: "" },
    { userId: "attendee-two", faculty: "SEET" },
    { userId: "attendee-three", faculty: "" },
    { userId: "unknown-attendee", faculty: "" }
  ], new Map([
    ["attendee-one", "SEET"],
    ["attendee-three", "SPS"]
  ]));

  assert.deepEqual(turnout, [
    { faculty: "SEET", count: 2 },
    { faculty: "SPS", count: 1 }
  ]);
});

test("health and readiness clearly report the local development storage mode", async () => {
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const healthResponse = await fetch(`${baseUrl}/api/health`);
  const readinessResponse = await fetch(`${baseUrl}/api/ready`);
  const health = await healthResponse.json();
  const readiness = await readinessResponse.json();

  assert.equal(healthResponse.status, 200);
  assert.equal(health.database, "local-fallback");
  assert.equal(health.databaseConnected, false);
  assert.equal(readinessResponse.status, 200);
  assert.equal(readiness.ready, true);
  assert.equal(readiness.operationalMongoCutover, false);
});

test("signup sends verification through Resend and surfaces provider failures", async () => {
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const originalEmailSender = app.locals.emailSender;
  const originalFetch = global.fetch;
  const resendRequests = [];
  let shouldFail = false;

  app.locals.emailSender = undefined;
  global.fetch = async (input, options) => {
    if (String(input).startsWith("https://api.resend.com/")) {
      resendRequests.push(JSON.parse(options.body));
      return shouldFail
        ? new Response(JSON.stringify({ message: "Provider unavailable", name: "application_error" }), {
          status: 503,
          headers: { "Content-Type": "application/json" }
        })
        : new Response(JSON.stringify({ id: "email_test_123" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
    }
    return originalFetch(input, options);
  };

  try {
    const success = await originalFetch(`${baseUrl}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "resend-success@futa.edu.ng", username: "resend_success", password: "CorrectPassword1" })
    });
    assert.equal(success.status, 202);
    assert.deepEqual({
      from: resendRequests[0].from,
      to: resendRequests[0].to,
      subject: resendRequests[0].subject
    }, {
      from: "FUTApulse <onboarding@resend.dev>",
      to: ["resend-success@futa.edu.ng"],
      subject: "Verify your FUTApulse email"
    });
    assert.match(resendRequests[0].html, /Your FUTApulse verification code is \d{6}/);

    shouldFail = true;
    const failure = await originalFetch(`${baseUrl}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "resend-failure@futa.edu.ng", username: "resend_failure", password: "CorrectPassword1" })
    });
    assert.equal(failure.status, 502);
    assert.match((await failure.json()).error, /Resend could not deliver/);
    const savedDatabase = JSON.parse(fs.readFileSync(dataFile, "utf8"));
    assert.equal(savedDatabase.emailChallenges.some((challenge) => challenge.email === "resend-failure@futa.edu.ng"), false);
  } finally {
    global.fetch = originalFetch;
    app.locals.emailSender = originalEmailSender;
  }
});

let server;

test.before(async () => {
  fs.writeFileSync(dataFile, JSON.stringify({ profiles: [], users: [], events: eventData }, null, 2));
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dataDirectory, { recursive: true, force: true });
});

test("GET /api/events/hot returns only qualifying events, ranked by engagement score", async () => {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/events/hot`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.events.length, 2);
  assert.deepEqual(body.events.map((event) => event.id), ["event-high", "event-ended-29m"]);
  assert.equal(body.events[0].hotScore, 15);
  assert.equal(body.events[0].isHot, true);
});

test("Google onboarding saves a FUTApulse password that works for username sign-in", async () => {
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const onboardingToken = jwt.sign({
    email: "google-new@example.com",
    name: "Google New",
    picture: "",
    googleSubject: "google-sub-new",
    tokenUse: "google-onboarding"
  }, process.env.JWT_SECRET, { expiresIn: "10m" });

  const invalid = await fetch(`${baseUrl}/api/auth/google`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ onboardingToken, username: "google_new", password: "weak", remember: false })
  });
  assert.equal(invalid.status, 400);

  const created = await fetch(`${baseUrl}/api/auth/google`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ onboardingToken, username: "google_new", password: "StrongPassword1", remember: false })
  });
  assert.equal(created.status, 200);
  assert.ok((await created.json()).token);

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "google_new", password: "StrongPassword1", remember: false })
  });
  assert.equal(login.status, 200);
  assert.ok((await login.json()).token);
});

test("legacy Google-only accounts can set their first FUTApulse password using a short-lived setup token", async () => {
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const legacyId = "legacy-google-account";
  const database = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  database.users.push({
    id: legacyId,
    email: "google-legacy@example.com",
    username: "google_legacy",
    passwordHash: "",
    emailVerified: true,
    googleSubject: "google-sub-legacy",
    sessionVersion: 0,
    profile: { name: "Google Legacy", picture: "", faculty: "", department: "", level: "", role: "explorer" }
  });
  fs.writeFileSync(dataFile, JSON.stringify(database, null, 2));

  const onboardingToken = jwt.sign({
    email: "google-legacy@example.com",
    name: "Google Legacy",
    picture: "",
    googleSubject: "google-sub-legacy",
    tokenUse: "google-onboarding"
  }, process.env.JWT_SECRET, { expiresIn: "10m" });
  const googleSignIn = await fetch(`${baseUrl}/api/auth/google`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ onboardingToken, remember: false })
  });
  assert.equal(googleSignIn.status, 200);
  const googleSignInResult = await googleSignIn.json();
  assert.equal(googleSignInResult.passwordRequired, true);
  assert.equal(googleSignInResult.email, "google-legacy@example.com");
  const setup = await fetch(`${baseUrl}/api/auth/google/password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ passwordSetupToken: googleSignInResult.passwordSetupToken, password: "LegacyPassword1", remember: false })
  });
  assert.equal(setup.status, 200);

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "google_legacy", password: "LegacyPassword1", remember: false })
  });
  assert.equal(login.status, 200);
  assert.ok((await login.json()).token);
});

test("GET /api/events/hot keeps ended events only through the 30-minute grace period", async () => {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/events/hot`);
  assert.equal(response.status, 200);
  const { events } = await response.json();
  assert.ok(events.some((event) => event.id === "event-ended-29m"));
  assert.ok(!events.some((event) => event.id === "event-ended-31m"));
  assert.ok(!events.some((event) => event.id === "event-no-end"));
  assert.ok(!events.some((event) => event.id === "event-invalid-window"));
});

test("GET /api/events preserves the shared grace window and omits legacy invalid-time events", async () => {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/events`);
  assert.equal(response.status, 200);
  const { events } = await response.json();
  const ids = new Set(events.map((event) => event.id));
  assert.ok(ids.has("event-ended-29m"));
  assert.ok(!ids.has("event-ended-31m"));
  assert.ok(!ids.has("event-no-end"));
  assert.ok(!ids.has("event-invalid-window"));
});

test("hype and reminder toggles are account-bound, idempotent, and private to each viewer", async () => {
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const first = await createVerifiedAccount(baseUrl, "toggle-first@futa.edu.ng", "toggle_first");
  const second = await createVerifiedAccount(baseUrl, "toggle-second@futa.edu.ng", "toggle_second");
  const toggle = (account, type, enabled) => fetch(`${baseUrl}/api/events/event-low/engagement`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${account.token}` },
    body: JSON.stringify({ type, enabled })
  });

  const initial = await fetch(`${baseUrl}/api/events`, { headers: { Authorization: `Bearer ${first.token}` } });
  const initialEvent = (await initial.json()).events.find((event) => event.id === "event-low");
  const initialHypeCount = initialEvent.flameCount;
  const initialReminderCount = initialEvent.reminderCount;

  const hyped = await toggle(first, "flame", true);
  assert.equal(hyped.status, 200);
  assert.equal((await hyped.json()).event.flameCount, initialHypeCount + 1);
  const repeatedHype = await toggle(first, "flame", true);
  assert.equal((await repeatedHype.json()).event.flameCount, initialHypeCount + 1);

  const reminded = await toggle(first, "reminder", true);
  assert.equal(reminded.status, 200);
  assert.equal((await reminded.json()).event.reminderCount, initialReminderCount + 1);
  const repeatedReminder = await toggle(first, "reminder", true);
  assert.equal((await repeatedReminder.json()).event.reminderCount, initialReminderCount + 1);

  const firstEvents = await fetch(`${baseUrl}/api/events`, { headers: { Authorization: `Bearer ${first.token}` } });
  const firstEvent = (await firstEvents.json()).events.find((event) => event.id === "event-low");
  assert.equal(firstEvent.isHyped, true);
  assert.equal(firstEvent.isReminded, true);
  assert.equal("hypedUserIds" in firstEvent, false);
  assert.equal("reminderUserIds" in firstEvent, false);

  const secondEvents = await fetch(`${baseUrl}/api/events`, { headers: { Authorization: `Bearer ${second.token}` } });
  const secondEvent = (await secondEvents.json()).events.find((event) => event.id === "event-low");
  assert.equal(secondEvent.isHyped, false);
  assert.equal(secondEvent.isReminded, false);

  const unHyped = await toggle(first, "flame", false);
  const unReminded = await toggle(first, "reminder", false);
  assert.equal((await unHyped.json()).event.flameCount, initialHypeCount);
  assert.equal((await unReminded.json()).event.reminderCount, initialReminderCount);
});

test("PATCH engagement requires sign-in and applies idempotent attendance changes", async () => {
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const unauthenticated = await fetch(`${baseUrl}/api/events/event-zero/engagement`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "rsvp", attending: true })
  });
  assert.equal(unauthenticated.status, 401);

  const account = await createVerifiedAccount(baseUrl, "attendance-test@futa.edu.ng", "attendance_test");
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${account.token}` };
  const request = (attending) => fetch(`${baseUrl}/api/events/event-zero/engagement`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ type: "rsvp", attending })
  });
  const firstResponse = await request(true);
  assert.equal(firstResponse.status, 200);
  const firstBody = await firstResponse.json();
  assert.equal(firstBody.event.rsvpCount, 1);
  assert.equal(firstBody.event.turnoutCount, 1);

  const removalResponse = await request(false);
  assert.equal(removalResponse.status, 200);
  const removalBody = await removalResponse.json();
  assert.equal(removalBody.event.rsvpCount, 0);
  assert.equal(removalBody.event.turnoutCount, 0);

  const retryResponse = await request(false);
  assert.equal(retryResponse.status, 200);
  const retryBody = await retryResponse.json();
  assert.equal(retryBody.event.rsvpCount, 0);
  assert.equal(retryBody.event.turnoutCount, 0);
});

test("PATCH engagement initializes RSVP count from legacy turnout count", async () => {
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const account = await createVerifiedAccount(baseUrl, "legacy-attendance-test@futa.edu.ng", "legacy_attendance_test");
  const response = await fetch(`${baseUrl}/api/events/event-legacy/engagement`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${account.token}` },
    body: JSON.stringify({ type: "rsvp", attending: true })
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.event.rsvpCount, 1);
  assert.equal(body.event.turnoutCount, 1);
});

test("PATCH engagement requires an account for reminder toggles", async () => {
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const unauthenticated = await fetch(`${baseUrl}/api/events/event-mid/engagement`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "reminder", enabled: true })
  });
  assert.equal(unauthenticated.status, 401);
});

test("PATCH rejects unsupported engagement types", async () => {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/events/event-low/engagement`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "unknown" })
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "Engagement type must be one of: flame, reminder, rsvp.");
});

test("POST /api/events/:eventId/hype requires sign-in and applies an idempotent account toggle", async () => {
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const account = await createVerifiedAccount(baseUrl, "route-hype@futa.edu.ng", "route_hype");
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${account.token}` };
  const request = (enabled) => fetch(`${baseUrl}/api/events/event-zero/hype`, {
    method: "POST",
    headers,
    body: JSON.stringify({ enabled })
  });
  const denied = await fetch(`${baseUrl}/api/events/event-zero/hype`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: true }) });
  assert.equal(denied.status, 401);
  const response = await request(true);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.hypeCount, 1);
  assert.equal(body.event.flameCount, 1);
  assert.equal(body.event.hotScore, 1);
  assert.equal(body.event.isHot, false);
  assert.equal(body.event.isHyped, true);
  const repeated = await request(true);
  assert.equal((await repeated.json()).hypeCount, 1);
  const removed = await request(false);
  assert.equal((await removed.json()).hypeCount, 0);
});

test("login distinguishes an unknown username from an incorrect password", async () => {
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  await createVerifiedAccount(baseUrl, "auth-test@futa.edu.ng", "auth_test");

  const unknown = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "no_such_user", password: "correct-password" })
  });
  assert.equal(unknown.status, 404);
  assert.match((await unknown.json()).error, /Create an account/);

  const wrongPassword = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "auth_test", password: "incorrect-password" })
  });
  assert.equal(wrongPassword.status, 401);
  assert.match((await wrongPassword.json()).error, /Incorrect password/);
});

test("signup accepts accented usernames and preserves their exact profile spelling", async () => {
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const account = await createVerifiedAccount(baseUrl, "unicode-name@futa.edu.ng", "Månûël");
  assert.equal(account.user.username, "månûël");
  assert.equal(account.user.profile.name, "Månûël");

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "MÅNÛËL", password: "CorrectPassword1" })
  });
  assert.equal(login.status, 200);
  assert.equal((await login.json()).user.profile.name, "Månûël");
});

test("profile username and faculty changes are capped at two server-enforced edits", async () => {
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const signup = await createVerifiedAccount(baseUrl, "limits-test@futa.edu.ng", "limits_test");
  const authHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${signup.token}` };

  const setupResponse = await fetch(`${baseUrl}/api/profile/setup`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ username: "limits_test", displayName: "Limits Test", faculty: "SEET", department: "EEE", level: "300", role: "explorer" })
  });
  assert.equal(setupResponse.status, 200);

  const update = (username, faculty) => fetch(`${baseUrl}/api/auth/profile`, {
    method: "PATCH",
    headers: authHeaders,
    body: JSON.stringify({
      username,
      profile: { name: "Limits Test", faculty, department: "EEE", level: "300", role: "explorer" }
    })
  });
  assert.equal((await update("limits_one", "SEMS")).status, 200);
  assert.equal((await update("limits_two", "SLS")).status, 200);
  const rejected = await update("limits_three", "SOC");
  assert.equal(rejected.status, 403);
  assert.match((await rejected.json()).error, /two-change limit/);
});

test("event organizer details follow the account's current profile", async () => {
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const account = await createVerifiedAccount(baseUrl, "event-owner@futa.edu.ng", "event_owner");
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${account.token}` };
  const setup = await fetch(`${baseUrl}/api/profile/setup`, {
    method: "POST",
    headers,
    body: JSON.stringify({ username: "event_owner", displayName: "Event Owner", faculty: "SEET", department: "EEE", level: "300", role: "explorer" })
  });
  assert.equal(setup.status, 200);

  const start = new Date(Date.now() + 30 * 86400000);
  const eventResponse = await fetch(`${baseUrl}/api/events`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      title: "Independent Robotics Showcase",
      category: "tech",
      activity: "A test event for profile synchronization",
      date: start.toISOString(),
      startTime: start.toISOString(),
      endTime: new Date(start.getTime() + 3600000).toISOString(),
      venue: "Sports Complex",
      banner: "data:image/png;base64,dGVzdA==",
      audience: ["all"],
      status: "Published"
    })
  });
  assert.equal(eventResponse.status, 201);
  const created = await eventResponse.json();
  assert.equal(created.event.organizerUsername, "event_owner");

  const profileUpdate = await fetch(`${baseUrl}/api/auth/profile`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      username: "new_event_owner",
      profile: { name: "New Event Owner", faculty: "SEMS", department: "GEM", level: "400", role: "explorer", picture: "data:image/png;base64,bmV3" }
    })
  });
  assert.equal(profileUpdate.status, 200);

  const eventListResponse = await fetch(`${baseUrl}/api/events`, { headers });
  assert.equal(eventListResponse.status, 200);
  const eventList = await eventListResponse.json();
  const updatedEvent = eventList.events.find((event) => event.id === created.event.id);
  assert.equal(updatedEvent.organizerName, "New Event Owner");
  assert.equal(updatedEvent.organizerUsername, "new_event_owner");
  assert.equal(updatedEvent.organizerFaculty, "SEMS");
  assert.equal(updatedEvent.organizerPicture, "data:image/png;base64,bmV3");

  const engagementResponse = await fetch(`${baseUrl}/api/events/${created.event.id}/engagement`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ type: "flame", enabled: true })
  });
  assert.equal(engagementResponse.status, 200);
  const engagement = await engagementResponse.json();
  assert.equal(engagement.event.organizerPicture, "data:image/png;base64,bmV3");
});

test("drafts are private and only their owner can permanently delete them", async () => {
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const owner = await createVerifiedAccount(baseUrl, "draft-owner@futa.edu.ng", "draft_owner");
  const ownerHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${owner.token}` };
  const setup = await fetch(`${baseUrl}/api/profile/setup`, {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({ username: "draft_owner", displayName: "Draft Owner", faculty: "SEET", department: "EEE", level: "300", role: "explorer" })
  });
  assert.equal(setup.status, 200);

  const create = await fetch(`${baseUrl}/api/events`, {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({ title: "Private draft", category: "academic", activity: "Draft details", status: "Draft" })
  });
  assert.equal(create.status, 201);
  const draft = (await create.json()).event;

  const guestEvents = await fetch(`${baseUrl}/api/events`);
  assert.equal(guestEvents.status, 200);
  assert.ok(!(await guestEvents.json()).events.some((event) => event.id === draft.id));
  const ownerEvents = await fetch(`${baseUrl}/api/events`, { headers: ownerHeaders });
  assert.ok((await ownerEvents.json()).events.some((event) => event.id === draft.id));

  const other = await createVerifiedAccount(baseUrl, "other-user@futa.edu.ng", "other_user");
  const otherHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${other.token}` };
  const forbidden = await fetch(`${baseUrl}/api/events/${draft.id}`, { method: "DELETE", headers: otherHeaders });
  assert.equal(forbidden.status, 403);
  const removed = await fetch(`${baseUrl}/api/events/${draft.id}`, { method: "DELETE", headers: ownerHeaders });
  assert.equal(removed.status, 200);
  const ownerEventsAfterDelete = await fetch(`${baseUrl}/api/events`, { headers: ownerHeaders });
  assert.ok(!(await ownerEventsAfterDelete.json()).events.some((event) => event.id === draft.id));
});

test("account deletion removes events owned by that account", async () => {
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const owner = await createVerifiedAccount(baseUrl, "delete-owner@futa.edu.ng", "delete_owner");
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${owner.token}` };
  const setup = await fetch(`${baseUrl}/api/profile/setup`, {
    method: "POST",
    headers,
    body: JSON.stringify({ username: "delete_owner", displayName: "Delete Owner", faculty: "SEET", department: "EEE", level: "300", role: "explorer" })
  });
  assert.equal(setup.status, 200);
  const start = new Date(Date.now() + 86400000);
  const createdResponse = await fetch(`${baseUrl}/api/events`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      title: "Owned event for account deletion",
      category: "academic",
      activity: "Cleanup should remove this event",
      date: start.toISOString(),
      startTime: start.toISOString(),
      endTime: new Date(start.getTime() + 3600000).toISOString(),
      venue: "Library",
      audience: ["all"],
      status: "Published"
    })
  });
  assert.equal(createdResponse.status, 201);
  const eventId = (await createdResponse.json()).event.id;

  const deletion = await fetch(`${baseUrl}/api/auth/account`, {
    method: "DELETE",
    headers,
    body: JSON.stringify({ password: "CorrectPassword1", confirmation: "DELETE" })
  });
  assert.equal(deletion.status, 200);
  const eventsAfterDeletion = await fetch(`${baseUrl}/api/events`);
  assert.ok(!(await eventsAfterDeletion.json()).events.some((event) => event.id === eventId));
});

test("account security supports email/password changes and confirmed deletion", async () => {
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const signup = await createVerifiedAccount(baseUrl, "security-test@futa.edu.ng", "security_test");
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${signup.token}` };

  const emailResponse = await fetch(`${baseUrl}/api/auth/change-email`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email: "security-updated@futa.edu.ng", currentPassword: "CorrectPassword1" })
  });
  assert.equal(emailResponse.status, 202);
  const emailCode = deliveredEmails.at(-1)?.match(/code is (\d{6})/)?.[1];
  assert.ok(emailCode, "email change should send a six-digit verification code");
  const confirmEmail = await fetch(`${baseUrl}/api/auth/change-email/confirm`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email: "security-updated@futa.edu.ng", code: emailCode })
  });
  assert.equal(confirmEmail.status, 200);
  const confirmedEmail = await confirmEmail.json();
  assert.equal(confirmedEmail.user.email, "security-updated@futa.edu.ng");

  const passwordResponse = await fetch(`${baseUrl}/api/auth/change-password`, {
    method: "POST",
    headers: { ...headers, Authorization: `Bearer ${confirmedEmail.token}` },
    body: JSON.stringify({ currentPassword: "CorrectPassword1", newPassword: "UpdatedPassword2" })
  });
  assert.equal(passwordResponse.status, 200);
  const passwordResult = await passwordResponse.json();
  assert.ok(passwordResult.token);

  const updatedHeaders = { ...headers, Authorization: `Bearer ${passwordResult.token}` };
  const invalidDelete = await fetch(`${baseUrl}/api/auth/account`, {
    method: "DELETE",
    headers: updatedHeaders,
    body: JSON.stringify({ password: "UpdatedPassword2", confirmation: "delete" })
  });
  assert.equal(invalidDelete.status, 400);

  const deleteResponse = await fetch(`${baseUrl}/api/auth/account`, {
    method: "DELETE",
    headers: updatedHeaders,
    body: JSON.stringify({ password: "UpdatedPassword2", confirmation: "DELETE" })
  });
  assert.equal(deleteResponse.status, 200);
});
