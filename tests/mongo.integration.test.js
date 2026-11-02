const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const replicaSetUri = process.env.FUTAPULSE_TEST_MONGO_URI;

test("Mongo replica-set event edits and notification outbox are durable and conflict-safe", {
  skip: !replicaSetUri
}, async () => {
  process.env.MONGO_URI = replicaSetUri;
  process.env.JWT_SECRET = process.env.JWT_SECRET || "futapulse-mongo-integration-test-secret";

  const jwt = require("jsonwebtoken");
  const mongoose = require("mongoose");
  const { startServer, models } = require("../server");
  const ownerEmail = `integration-${crypto.randomUUID()}@example.test`;
  const eventIds = [];
  let owner;
  let server;
  let accountRateLimitHash = "";

  try {
    server = await startServer();
    const topologyType = mongoose.connection.getClient().topology.description.type;
    assert.equal(topologyType, "ReplicaSetWithPrimary", "integration URI must connect to a MongoDB replica set");

    owner = await models.User.create({
      email: ownerEmail,
      emailVerified: true,
      username: `int_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`,
      profile: {
        name: "Mongo Integration",
        faculty: "SEET",
        department: "EEE",
        level: "300",
        role: "explorer",
        hasCompletedTour: true
      }
    });
    accountRateLimitHash = crypto.createHash("sha256").update(`user:${owner._id}`).digest("hex");
    const accessToken = jwt.sign({
      sub: String(owner._id),
      username: owner.username,
      sessionVersion: 0,
      tokenUse: "access"
    }, process.env.JWT_SECRET, { expiresIn: "15m" });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`
    };

    const draftResponse = await fetch(`${baseUrl}/api/events`, {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "Mongo revision integration draft", status: "Draft" })
    });
    assert.equal(draftResponse.status, 201);
    const draft = (await draftResponse.json()).event;
    eventIds.push(draft.id);

    const concurrentEdits = await Promise.all([
      fetch(`${baseUrl}/api/events/${draft.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ expectedRevision: draft.revision, title: "Concurrent revision A" })
      }),
      fetch(`${baseUrl}/api/events/${draft.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ expectedRevision: draft.revision, title: "Concurrent revision B" })
      })
    ]);
    assert.deepEqual(concurrentEdits.map((response) => response.status).sort(), [200, 409]);
    const storedDraft = await models.EventRecord.findOne({ eventId: draft.id }).lean().exec();
    assert.equal(storedDraft.revision, draft.revision + 1);

    const startsAt = new Date(Date.now() + 60 * 60_000);
    const endsAt = new Date(startsAt.getTime() + 60 * 60_000);
    const publishResponse = await fetch(`${baseUrl}/api/events`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: `Mongo outbox integration ${crypto.randomUUID()}`,
        category: "social",
        activity: "Integration verification",
        date: startsAt.toISOString(),
        endTime: endsAt.toISOString(),
        venue: "Integration venue",
        status: "Published",
        audience: ["all"]
      })
    });
    assert.equal(publishResponse.status, 201);
    const published = (await publishResponse.json()).event;
    eventIds.push(published.id);

    const persistedEvent = await models.EventRecord.findOne({ eventId: published.id }).lean().exec();
    const outboxEntry = await models.NotificationOutbox.findOne({
      eventId: published.id,
      type: "new-event"
    }).lean().exec();
    assert.ok(persistedEvent, "event record should be committed");
    assert.ok(outboxEntry, "notification intent should be committed with the event");
    const rateLimitWindowStart = Math.floor(Date.now() / (60 * 60 * 1000)) * (60 * 60 * 1000);
    const rateLimitBucket = await models.ApiRateLimitBucket.findById(`${rateLimitWindowStart}:${accountRateLimitHash}`).lean().exec();
    assert.ok(rateLimitBucket?.totalHits >= 4, "event mutation limits should be stored in MongoDB per account");

    const deadline = Date.now() + 15_000;
    let notificationJob = null;
    let completedOutbox = null;
    while (Date.now() < deadline) {
      [notificationJob, completedOutbox] = await Promise.all([
        models.NotificationJob.findOne({ eventId: published.id, kind: "new-event" }).lean().exec(),
        models.NotificationOutbox.findById(outboxEntry._id).lean().exec()
      ]);
      if (notificationJob && completedOutbox?.status === "completed") break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.ok(notificationJob, "worker should materialize the durable notification intent");
    assert.equal(completedOutbox.status, "completed");
  } finally {
    if (owner && mongoose.connection.readyState === 1) {
      await Promise.all([
        models.EventRecord.deleteMany({ eventId: { $in: eventIds } }).exec(),
        models.NotificationOutbox.deleteMany({ eventId: { $in: eventIds } }).exec(),
        models.NotificationJob.deleteMany({ eventId: { $in: eventIds } }).exec(),
        ...(accountRateLimitHash ? [models.ApiRateLimitBucket.deleteMany({ keyHash: accountRateLimitHash }).exec()] : []),
        models.User.deleteOne({ _id: owner._id }).exec()
      ]);
    }
    if (server) await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
  }
});
