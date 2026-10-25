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
process.env.GMAIL_REFRESH_TOKEN = "gmail-refresh-token-for-tests";
process.env.GMAIL_SENDER_EMAIL = "sender@example.test";

const {
  app,
  models,
  buildFacultyTurnoutBreakdown,
  buildRsvpReminderSchedule,
  buildCriticalEventUpdateDetails,
  describeWebPushFailure,
  validateVapidCredentials
} = require("../server");
const { buildApprovedMigrationPlan } = require("../server/dataMigration");
const webPush = require("web-push");
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
  const viewIndexes = models.EventView.schema.indexes();
  const recapDismissalIndexes = models.RecapPromptDismissal.schema.indexes();
  const notificationIndexes = models.NotificationJob.schema.indexes();

  assert.ok(eventIndexes.some(([fields]) => fields.eventId === 1));
  assert.ok(eventIndexes.some(([fields]) => fields.status === 1 && fields.endsAt === 1));
  assert.ok(actionIndexes.some(([fields, options]) => fields.eventId === 1 && fields.userId === 1 && fields.type === 1 && options.unique));
  assert.ok(actionIndexes.some(([fields]) => fields.eventId === 1 && fields.type === 1 && fields.updatedAt === 1));
  assert.ok(reportIndexes.some(([fields]) => fields.eventId === 1));
  assert.ok(viewIndexes.some(([fields, options]) => fields.eventId === 1 && fields.userId === 1 && options.unique));
  assert.ok(recapDismissalIndexes.some(([fields, options]) => fields.eventId === 1 && fields.userId === 1 && options.unique));
  assert.ok(notificationIndexes.some(([fields, options]) => fields.idempotencyKey === 1 && options.unique));
});

test("notification category preferences default enabled and persist as user-profile metadata", async () => {
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const account = await createVerifiedAccount(baseUrl, "notification-preferences@futa.edu.ng", "notify_prefs");
  const categories = ["academic", "tech", "social", "religious", "sports", "seminars"];
  assert.deepEqual(account.user.profile.notificationPreferences, Object.fromEntries(categories.map((category) => [category, true])));
  assert.equal(account.user.profile.notificationPreferencesOnboardingComplete, false);

  const saved = await fetch(`${baseUrl}/api/notifications/preferences`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${account.token}` },
    body: JSON.stringify({ notificationPreferences: { social: false, seminars: false } })
  });
  assert.equal(saved.status, 200);
  const savedBody = await saved.json();
  assert.deepEqual(savedBody.notificationPreferences, {
    academic: true, tech: true, social: false, religious: true, sports: true, seminars: false
  });
  assert.equal(savedBody.notificationPreferencesOnboardingComplete, true);

  const session = await fetch(`${baseUrl}/api/auth/session`, { headers: { Authorization: `Bearer ${account.token}` } });
  const sessionBody = await session.json();
  assert.deepEqual(sessionBody.user.profile.notificationPreferences, savedBody.notificationPreferences);
  assert.equal(sessionBody.user.profile.notificationPreferencesOnboardingComplete, true);
});

test("notification delivery status requires authentication and distinguishes server and device readiness", async () => {
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const account = await createVerifiedAccount(baseUrl, "notification-status@futa.edu.ng", "notify_status");
  const unauthorized = await fetch(`${baseUrl}/api/notifications/status?platform=web`);
  assert.equal(unauthorized.status, 401);

  const headers = { Authorization: `Bearer ${account.token}` };
  const invalidPlatform = await fetch(`${baseUrl}/api/notifications/status?platform=desktop`, { headers });
  assert.equal(invalidPlatform.status, 400);

  const response = await fetch(`${baseUrl}/api/notifications/status?platform=web`, { headers });
  assert.equal(response.status, 200);
  const status = await response.json();
  assert.equal(typeof status.durableSchedulingAvailable, "boolean");
  assert.equal(typeof status.pushConfigured, "boolean");
  assert.equal(status.deviceRegistered, false);
});

test("background notification worker trigger is POST-only and requires its configured secret", async () => {
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const originalSecret = process.env.CRON_SECRET_KEY;
  delete process.env.CRON_SECRET_KEY;

  try {
    const unconfigured = await fetch(`${baseUrl}/api/internal/notifications/worker`, { method: "POST" });
    assert.equal(unconfigured.status, 503);

    process.env.CRON_SECRET_KEY = "test-cron-secret-with-sufficient-length";
    const unauthorized = await fetch(`${baseUrl}/api/internal/notifications/worker`, {
      method: "POST",
      headers: { "x-cron-secret": "wrong-secret" }
    });
    assert.equal(unauthorized.status, 401);

    const wrongMethod = await fetch(`${baseUrl}/api/internal/notifications/worker`, {
      method: "GET",
      headers: { "x-cron-secret": process.env.CRON_SECRET_KEY }
    });
    assert.equal(wrongMethod.status, 404);

    const validSecretWithoutMongo = await fetch(`${baseUrl}/api/internal/notifications/worker`, {
      method: "POST",
      headers: { "x-cron-secret": process.env.CRON_SECRET_KEY }
    });
    assert.equal(validSecretWithoutMongo.status, 503);
  } finally {
    if (originalSecret === undefined) delete process.env.CRON_SECRET_KEY;
    else process.env.CRON_SECRET_KEY = originalSecret;
  }
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

test("RSVP reminders use default intervals or the custom override while retaining the start-time reminder", () => {
  const startsAt = Date.UTC(2026, 9, 25, 10, 0);
  const event = { id: "reminder-plan", title: "Campus meetup", date: new Date(startsAt).toISOString() };
  const defaults = buildRsvpReminderSchedule(event, { now: startsAt - 2 * 60 * 60_000 });
  assert.deepEqual(defaults.map(({ suffix, dueAt }) => [suffix, dueAt.getTime()]), [
    ["1h", startsAt - 60 * 60_000],
    ["30m", startsAt - 30 * 60_000],
    ["start", startsAt]
  ]);

  const custom = buildRsvpReminderSchedule(event, { hasCustomReminder: true, now: startsAt - 2 * 60 * 60_000 });
  assert.deepEqual(custom.map(({ suffix, dueAt }) => [suffix, dueAt.getTime()]), [["start", startsAt]]);
  assert.deepEqual(buildRsvpReminderSchedule(event, { now: startsAt }), []);
});

test("critical event update details identify title, venue, and postponement changes accurately", () => {
  const original = { title: "Campus meetup", venue: "Old hall", date: "2026-10-25T10:00:00.000Z" };
  assert.deepEqual(buildCriticalEventUpdateDetails(original, { ...original, title: "Campus social" }), {
    postponed: false,
    message: "The title for Campus social has changed. Tap to check it out."
  });
  assert.deepEqual(buildCriticalEventUpdateDetails(original, { ...original, venue: "New hall" }), {
    postponed: false,
    message: "The venue for Campus meetup has changed. Tap to check it out."
  });
  assert.deepEqual(buildCriticalEventUpdateDetails(original, { ...original, date: "2026-10-26T10:00:00.000Z" }), {
    postponed: true,
    message: "⏰ POSTPONED: Campus meetup has been moved to a new date. Tap to check it out."
  });
  assert.equal(buildCriticalEventUpdateDetails(original, original), null);
});

test("Web Push diagnostics include provider status without exposing subscription endpoints", () => {
  const endpoint = "https://push.example.test/subscription/private-token?secret=value";
  const message = describeWebPushFailure({
    statusCode: 403,
    body: "VAPID key does not match subscription"
  }, endpoint);

  assert.equal(message, "push.example.test returned HTTP 403: VAPID key does not match subscription");
  assert.equal(message.includes("private-token"), false);
  assert.equal(message.includes("secret=value"), false);
});

test("VAPID configuration validates P-256 key points and matching key pairs", () => {
  const validPair = webPush.generateVAPIDKeys();
  const otherPair = webPush.generateVAPIDKeys();
  assert.deepEqual(validateVapidCredentials(validPair.publicKey, validPair.privateKey), { valid: true, error: "" });

  const mismatch = validateVapidCredentials(validPair.publicKey, otherPair.privateKey);
  assert.equal(mismatch.valid, false);
  assert.match(mismatch.error, /do not match/);

  const invalidCurvePoint = Buffer.concat([Buffer.from([0x04]), Buffer.alloc(64)]).toString("base64url");
  const invalidPoint = validateVapidCredentials(invalidCurvePoint, validPair.privateKey);
  assert.equal(invalidPoint.valid, false);
  assert.match(invalidPoint.error, /P-256 curve/);

  const malformed = validateVapidCredentials("not+a+base64url+key", validPair.privateKey);
  assert.equal(malformed.valid, false);
  assert.match(malformed.error, /base64url/);
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

test("notification configuration reports recap upload availability without exposing secrets", async () => {
  const original = {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET
  };
  delete process.env.CLOUDINARY_CLOUD_NAME;
  delete process.env.CLOUDINARY_API_KEY;
  delete process.env.CLOUDINARY_API_SECRET;
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/notifications/config`);
    assert.equal(response.status, 200);
    const config = await response.json();
    assert.equal(config.recapUploadConfigured, false);
    assert.deepEqual(config.recapUploadMissingVariables, ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"]);
    assert.equal(Object.hasOwn(config, "CLOUDINARY_API_SECRET"), false);
    assert.doesNotMatch(JSON.stringify(config), /api_secret\s*:/i);
  } finally {
    if (original.cloudName === undefined) delete process.env.CLOUDINARY_CLOUD_NAME;
    else process.env.CLOUDINARY_CLOUD_NAME = original.cloudName;
    if (original.apiKey === undefined) delete process.env.CLOUDINARY_API_KEY;
    else process.env.CLOUDINARY_API_KEY = original.apiKey;
    if (original.apiSecret === undefined) delete process.env.CLOUDINARY_API_SECRET;
    else process.env.CLOUDINARY_API_SECRET = original.apiSecret;
  }
});

test("signup sends verification through Gmail API and sanitizes provider failures", async () => {
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const originalEmailSender = app.locals.emailSender;
  const originalGmailOAuthClientFactory = app.locals.gmailOAuthClientFactory;
  const originalGmailApiFetch = app.locals.gmailApiFetch;
  const originalRefreshToken = process.env.GMAIL_REFRESH_TOKEN;
  const apiRequests = [];
  const providerLogs = [];
  let oauthSignal;
  let failureType = "";

  app.locals.emailSender = undefined;
  app.locals.gmailOAuthClientFactory = ({ clientId, clientSecret, transporterOptions }) => {
    assert.equal(clientId, "google-client-id-for-tests");
    assert.equal(clientSecret, "google-client-secret-for-tests");
    assert.equal(transporterOptions.timeout, 15_000);
    assert.equal(transporterOptions.signal instanceof AbortSignal, true);
    oauthSignal = transporterOptions.signal;
    return {
      setCredentials: (credentials) => assert.deepEqual(credentials, { refresh_token: "gmail-refresh-token-for-tests" }),
      getAccessToken: async () => {
        if (failureType === "invalid_grant") {
          const error = new Error("invalid_grant: sender authorization was revoked.");
          error.response = { data: { error: "invalid_grant", error_description: "Refresh token expired or revoked." } };
          throw error;
        }
        return { token: "gmail-api-access-token-for-tests" };
      }
    };
  };
  app.locals.gmailApiFetch = async (url, options) => {
    apiRequests.push({ url, options });
    if (failureType === "permission") {
      return {
        ok: false,
        status: 403,
        json: async () => ({
          error: {
            code: 403,
            message: "Insufficient Permission",
            errors: [{ reason: "insufficientPermissions" }]
          }
        })
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: "gmail_message_123" })
    };
  };
  const originalConsoleError = console.error;
  console.error = (...args) => providerLogs.push(args);

  try {
    const success = await fetch(`${baseUrl}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "gmail-success@futa.edu.ng", username: "gmail_success", password: "CorrectPassword1" })
    });
    assert.equal(success.status, 202);
    assert.equal(apiRequests[0].url, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    assert.equal(apiRequests[0].options.method, "POST");
    assert.equal(apiRequests[0].options.headers.Authorization, "Bearer gmail-api-access-token-for-tests");
    assert.equal(apiRequests[0].options.signal, oauthSignal);
    const requestBody = JSON.parse(apiRequests[0].options.body);
    const mimeMessage = Buffer.from(requestBody.raw, "base64url").toString("utf8");
    assert.match(mimeMessage, /To: gmail-success@futa\.edu\.ng/);
    assert.match(mimeMessage, /From: FUTApulse <sender@example\.test>/);
    const encodedSubject = mimeMessage.match(/^Subject: =\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=$/m)?.[1];
    assert.equal(Buffer.from(encodedSubject, "base64").toString("utf8"), "Verify your FUTApulse email");
    const encodedTextBody = mimeMessage.match(/Content-Type: text\/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n--futapulse_/)?.[1];
    const textBody = Buffer.from(encodedTextBody.replace(/\s/g, ""), "base64").toString("utf8");
    assert.match(textBody, /Your FUTApulse verification code is \d{6}/);

    failureType = "permission";
    const failure = await fetch(`${baseUrl}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "gmail-failure@futa.edu.ng", username: "gmail_failure", password: "CorrectPassword1" })
    });
    assert.equal(failure.status, 502);
    assert.match((await failure.json()).error, /lacks the gmail.send permission/);
    assert.equal(providerLogs.length, 1);
    assert.equal(providerLogs[0][0], "Gmail API email delivery failed.");
    assert.equal(providerLogs[0][1].statusCode, 403);
    assert.equal(providerLogs[0][1].reason, "insufficientPermissions");
    assert.doesNotMatch(JSON.stringify(providerLogs[0]), /gmail-failure@futa\.edu\.ng/);
    const savedDatabase = JSON.parse(fs.readFileSync(dataFile, "utf8"));
    assert.equal(savedDatabase.emailChallenges.some((challenge) => challenge.email === "gmail-failure@futa.edu.ng"), false);

    failureType = "invalid_grant";
    const tokenFailure = await fetch(`${baseUrl}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "gmail-token-failure@futa.edu.ng", username: "gmail_token_failure", password: "CorrectPassword1" })
    });
    assert.equal(tokenFailure.status, 502);
    assert.match((await tokenFailure.json()).error, /GMAIL_REFRESH_TOKEN \(invalid_grant\)/);
    assert.equal(providerLogs.length, 2);
    assert.equal(providerLogs[1][1].code, "invalid_grant");
    assert.doesNotMatch(JSON.stringify(providerLogs[1]), /gmail-token-failure@futa\.edu\.ng/);

    failureType = "";
    const configuredRefreshToken = process.env.GMAIL_REFRESH_TOKEN;
    delete process.env.GMAIL_REFRESH_TOKEN;
    const unconfigured = await fetch(`${baseUrl}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "unconfigured@futa.edu.ng", username: "unconfigured_user", password: "CorrectPassword1" })
    });
    assert.equal(unconfigured.status, 503);
    assert.match((await unconfigured.json()).error, /GMAIL_REFRESH_TOKEN/);
    process.env.GMAIL_REFRESH_TOKEN = configuredRefreshToken;
  } finally {
    console.error = originalConsoleError;
    app.locals.gmailOAuthClientFactory = originalGmailOAuthClientFactory;
    app.locals.gmailApiFetch = originalGmailApiFetch;
    app.locals.emailSender = originalEmailSender;
    process.env.GMAIL_REFRESH_TOKEN = originalRefreshToken;
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

test("GET /api/events/hot includes every event with RSVPs from over half of profile-complete verified accounts", async () => {
  const originalDatabase = fs.readFileSync(dataFile, "utf8");
  const completeProfile = { name: "Test Student", faculty: "SEET", department: "Computer Science", level: "200", role: "explorer" };
  const users = [
    ...Array.from({ length: 4 }, (_, index) => ({
      id: `hot-eligible-${index}`,
      emailVerified: true,
      profile: { ...completeProfile }
    })),
    { id: "hot-incomplete-profile", emailVerified: true, profile: { name: "Incomplete Student" } },
    { id: "hot-unverified", emailVerified: false, profile: { ...completeProfile } }
  ];
  const hotEvents = [
    ...eventData.map((event) => ({ ...event })),
    ...Array.from({ length: 7 }, (_, index) => createEvent({
      id: `event-extra-hot-${index}`,
      title: `Extra Hot ${index}`,
      rsvpCount: 3,
      reminderCount: 0,
      flameCount: 0
    }))
  ];
  const exactHalf = hotEvents.find((event) => event.id === "event-low");
  exactHalf.rsvpCount = 2;
  exactHalf.reminderCount = 4;
  const endedHot = hotEvents.find((event) => event.id === "event-ended-29m");
  endedHot.rsvpCount = 3;

  try {
    fs.writeFileSync(dataFile, JSON.stringify({ profiles: [], users, events: hotEvents }, null, 2));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/events/hot`);
    assert.equal(response.status, 200);
    const body = await response.json();
    const hotIds = body.events.map((event) => event.id);
    assert.equal(body.events.length, 10, "all qualifying events must be returned, without a top-five cap");
    assert.ok(hotIds.includes("event-high"));
    assert.ok(hotIds.includes("event-mid"));
    assert.ok(hotIds.includes("event-ended-29m"), "events remain eligible during the existing ended grace period");
    assert.equal(hotIds.includes("event-low"), false, "exactly half is not more than half, even with high reminders");
    assert.equal(body.events.find((event) => event.id === "event-mid").hotRsvpPercentage, 75);
    assert.ok(body.events.every((event) => event.isHot));
  } finally {
    fs.writeFileSync(dataFile, originalDatabase);
  }
});

test("visible event views are unique, exclude the organizer, and are private owner aggregates", async () => {
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const owner = await createVerifiedAccount(baseUrl, "event-view-owner@futa.edu.ng", "event_view_owner");
  const viewer = await createVerifiedAccount(baseUrl, "event-viewer@futa.edu.ng", "event_viewer");
  const activeEvent = createEvent({
    id: "event-view-count",
    title: "View-count event",
    createdByUserId: owner.user.id
  });
  const endedEvent = createEvent({
    id: "event-view-dismissal",
    title: "Recap reminder event",
    createdByUserId: owner.user.id,
    date: new Date(Date.now() - 90 * 60_000).toISOString(),
    startTime: new Date(Date.now() - 90 * 60_000).toISOString(),
    endTime: new Date(Date.now() - 5 * 60_000).toISOString()
  });
  const expiredPublicEvent = createEvent({
    id: "event-ended-outside-public-window",
    title: "Private organizer recap access",
    createdByUserId: owner.user.id,
    date: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
    startTime: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
    endTime: new Date(Date.now() - 40 * 60_000).toISOString(),
    recapPhotos: [{ url: "https://images.example.test/recap.webp" }],
    recapPublishedAt: new Date().toISOString()
  });
  const database = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  database.events.push(activeEvent, endedEvent, expiredPublicEvent);
  fs.writeFileSync(dataFile, JSON.stringify(database, null, 2));

  const viewerHeaders = { Authorization: `Bearer ${viewer.token}` };
  const firstView = await fetch(`${baseUrl}/api/events/${activeEvent.id}/views`, { method: "POST", headers: viewerHeaders });
  const duplicateView = await fetch(`${baseUrl}/api/events/${activeEvent.id}/views`, { method: "POST", headers: viewerHeaders });
  const ownerView = await fetch(`${baseUrl}/api/events/${activeEvent.id}/views`, { method: "POST", headers: { Authorization: `Bearer ${owner.token}` } });
  assert.equal(firstView.status, 200);
  assert.deepEqual(await firstView.json(), { recorded: true });
  assert.equal(duplicateView.status, 200);
  assert.deepEqual(await duplicateView.json(), { recorded: false });
  assert.deepEqual(await ownerView.json(), { recorded: false });

  const ownerEventsResponse = await fetch(`${baseUrl}/api/events`, { headers: { Authorization: `Bearer ${owner.token}` } });
  const ownerEvents = (await ownerEventsResponse.json()).events;
  assert.equal(ownerEvents.find((event) => event.id === activeEvent.id).viewCount, 1);
  const ownerEngagementResponse = await fetch(`${baseUrl}/api/events/engagement`, {
    headers: { Authorization: `Bearer ${owner.token}` }
  });
  const ownerEngagement = (await ownerEngagementResponse.json()).updates.find((event) => event.id === activeEvent.id);
  assert.equal(ownerEngagement.viewCount, 1);
  const viewerEventsResponse = await fetch(`${baseUrl}/api/events`, { headers: viewerHeaders });
  const viewerEvent = (await viewerEventsResponse.json()).events.find((event) => event.id === activeEvent.id);
  assert.equal(Object.hasOwn(viewerEvent, "viewCount"), false);
  const viewerEngagementResponse = await fetch(`${baseUrl}/api/events/engagement`, { headers: viewerHeaders });
  const viewerEngagement = (await viewerEngagementResponse.json()).updates.find((event) => event.id === activeEvent.id);
  assert.equal(Object.hasOwn(viewerEngagement, "viewCount"), false);

  const dismissalResponse = await fetch(`${baseUrl}/api/events/${endedEvent.id}/recap-prompt-dismissal`, {
    method: "POST",
    headers: { ...{ "Content-Type": "application/json" }, Authorization: `Bearer ${owner.token}` }
  });
  assert.equal(dismissalResponse.status, 200);
  const refreshedOwnerEvents = await fetch(`${baseUrl}/api/events`, { headers: { Authorization: `Bearer ${owner.token}` } });
  const dismissedEvent = (await refreshedOwnerEvents.json()).events.find((event) => event.id === endedEvent.id);
  assert.equal(dismissedEvent.recapPromptDismissed, true);

  const publicRecapResponse = await fetch(`${baseUrl}/api/events/${expiredPublicEvent.id}`);
  assert.equal(publicRecapResponse.status, 200);
  const publicRecapEvent = (await publicRecapResponse.json()).event;
  assert.equal(publicRecapEvent.recapPhotos.length, 1);
  assert.equal(publicRecapEvent.viewCount, undefined);
  const ownerExpiredEventResponse = await fetch(`${baseUrl}/api/events/${expiredPublicEvent.id}`, {
    headers: { Authorization: `Bearer ${owner.token}` }
  });
  assert.equal(ownerExpiredEventResponse.status, 200);
  const ownerExpiredEvent = (await ownerExpiredEventResponse.json()).event;
  assert.equal(ownerExpiredEvent.viewCount, undefined);
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
  const originalDatabase = fs.readFileSync(dataFile, "utf8");
  const profile = { name: "Test Student", faculty: "SEET", department: "Computer Science", level: "200", role: "explorer" };
  const users = Array.from({ length: 4 }, (_, index) => ({
    id: `hot-grace-eligible-${index}`,
    emailVerified: true,
    profile: { ...profile }
  }));
  try {
    const database = JSON.parse(originalDatabase);
    fs.writeFileSync(dataFile, JSON.stringify({ ...database, users }, null, 2));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/events/hot`);
    assert.equal(response.status, 200);
    const { events } = await response.json();
    assert.ok(events.some((event) => event.id === "event-ended-29m"));
    assert.ok(!events.some((event) => event.id === "event-ended-31m"));
    assert.ok(!events.some((event) => event.id === "event-no-end"));
    assert.ok(!events.some((event) => event.id === "event-invalid-window"));
  } finally {
    fs.writeFileSync(dataFile, originalDatabase);
  }
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

test("signing in on another device invalidates the previous account session", async () => {
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const initialSession = await createVerifiedAccount(baseUrl, "single-session@futa.edu.ng", "single_session");

  const firstLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "single_session", password: "CorrectPassword1" })
  });
  assert.equal(firstLogin.status, 200);
  const firstToken = (await firstLogin.json()).token;

  const initialSessionCheck = await fetch(`${baseUrl}/api/auth/session`, {
    headers: { Authorization: `Bearer ${initialSession.token}` }
  });
  assert.equal(initialSessionCheck.status, 401);

  const secondLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "single_session", password: "CorrectPassword1" })
  });
  assert.equal(secondLogin.status, 200);
  const secondToken = (await secondLogin.json()).token;

  const firstSessionCheck = await fetch(`${baseUrl}/api/auth/session`, {
    headers: { Authorization: `Bearer ${firstToken}` }
  });
  assert.equal(firstSessionCheck.status, 401);

  const currentSessionCheck = await fetch(`${baseUrl}/api/auth/session`, {
    headers: { Authorization: `Bearer ${secondToken}` }
  });
  assert.equal(currentSessionCheck.status, 200);
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

test("cancelled events leave the public feed, stay in the owner's seven-day profile archive, and can be removed", async () => {
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const owner = await createVerifiedAccount(baseUrl, "cancelled-archive@futa.edu.ng", "cancelled_archive");
  const ownerHeaders = { Authorization: `Bearer ${owner.token}` };
  const guest = await createVerifiedAccount(baseUrl, "cancelled-viewer@futa.edu.ng", "cancelled_viewer");
  const event = createEvent({
    id: "event-cancelled-owner-archive",
    title: "Cancelled but retained privately",
    createdByUserId: owner.user.id,
    date: new Date(Date.now() + 86400000).toISOString(),
    endTime: new Date(Date.now() + 90000000).toISOString()
  });
  const endedEvent = createEvent({
    id: "event-ended-owner-removal",
    title: "Ended event can be removed directly",
    createdByUserId: owner.user.id,
    date: new Date(Date.now() - 3 * 86400000).toISOString(),
    endTime: new Date(Date.now() - 2 * 86400000).toISOString()
  });
  const database = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  database.events.push(event, endedEvent);
  fs.writeFileSync(dataFile, JSON.stringify(database, null, 2));

  const cancellation = await fetch(`${baseUrl}/api/events/${event.id}`, { method: "DELETE", headers: ownerHeaders });
  assert.equal(cancellation.status, 200);
  assert.equal((await cancellation.json()).cancelled, true);

  const publicEvents = await fetch(`${baseUrl}/api/events`, { headers: { Authorization: `Bearer ${guest.token}` } });
  assert.ok(!(await publicEvents.json()).events.some((item) => item.id === event.id));
  const publicDetails = await fetch(`${baseUrl}/api/events/${event.id}`, { headers: { Authorization: `Bearer ${guest.token}` } });
  assert.equal(publicDetails.status, 200);
  assert.equal((await publicDetails.json()).event.status, "Cancelled");
  const ownerEvents = await fetch(`${baseUrl}/api/events`, { headers: ownerHeaders });
  const archivedEvent = (await ownerEvents.json()).events.find((item) => item.id === event.id);
  assert.equal(archivedEvent.status, "Cancelled");

  const removal = await fetch(`${baseUrl}/api/events/${event.id}`, { method: "DELETE", headers: ownerHeaders });
  assert.equal(removal.status, 200);
  assert.equal((await removal.json()).removed, true);
  const refreshedOwnerEvents = await fetch(`${baseUrl}/api/events`, { headers: ownerHeaders });
  const finalEvents = (await refreshedOwnerEvents.json()).events;
  assert.ok(!finalEvents.some((item) => item.id === event.id));
  assert.ok(finalEvents.some((item) => item.id === endedEvent.id));
  const removeEndedEvent = await fetch(`${baseUrl}/api/events/${endedEvent.id}`, { method: "DELETE", headers: ownerHeaders });
  assert.equal(removeEndedEvent.status, 200);
  const endedRemoval = await removeEndedEvent.json();
  assert.equal(endedRemoval.removed, true);
  assert.equal(endedRemoval.cancelled, undefined);
  const finalOwnerEvents = await fetch(`${baseUrl}/api/events`, { headers: ownerHeaders });
  assert.ok(!(await finalOwnerEvents.json()).events.some((item) => item.id === endedEvent.id));
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
  const localDatabase = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  localDatabase.pushDevices = [{ userId: owner.user.id, deviceKey: "delete-owner-device" }];
  localDatabase.notificationJobs = [
    { recipientUserId: owner.user.id, eventId: "another-event" },
    { recipientUserId: "another-user", eventId }
  ];
  localDatabase.engagementActions = [{ userId: owner.user.id, eventId: "another-event" }];
  fs.writeFileSync(dataFile, JSON.stringify(localDatabase));

  const deletion = await fetch(`${baseUrl}/api/auth/account`, {
    method: "DELETE",
    headers,
    body: JSON.stringify({ password: "CorrectPassword1", confirmation: "DELETE" })
  });
  assert.equal(deletion.status, 200);
  const eventsAfterDeletion = await fetch(`${baseUrl}/api/events`);
  assert.ok(!(await eventsAfterDeletion.json()).events.some((event) => event.id === eventId));
  const afterDeletion = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  assert.deepEqual(afterDeletion.pushDevices, []);
  assert.deepEqual(afterDeletion.engagementActions, []);
  assert.deepEqual(afterDeletion.notificationJobs, []);
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
