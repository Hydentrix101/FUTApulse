const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const http = require("node:http");
const express = require("express");
const cors = require("cors");
const compression = require("compression");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const { Server: SocketServer } = require("socket.io");
const { createAdapter: createSocketRedisAdapter } = require("@socket.io/redis-adapter");
const { createClient: createRedisClient } = require("redis");
const webPush = require("web-push");
const cloudinary = require("cloudinary").v2;
const multer = require("multer");

if (fs.existsSync(path.join(__dirname, ".env"))) process.loadEnvFile(path.join(__dirname, ".env"));

const EMAIL_SEND_TIMEOUT_MS = 15_000;
const PORT = Number(process.env.PORT || 3001);
const ROOT = __dirname;
const CLIENT_DIST = path.join(ROOT, "client", "dist");
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = process.env.FUTAPULSE_DATA_FILE || path.join(DATA_DIR, "futapulse.json");
const app = express();
const httpServer = http.createServer(app);
let databaseBackend = "local";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const DEFAULT_FRONTEND_URL = process.env.NODE_ENV === "production"
  ? "https://fut-apulse.vercel.app"
  : "http://localhost:5173";
const FRONTEND_URL = String(process.env.FRONTEND_URL || DEFAULT_FRONTEND_URL).replace(/\/$/, "");
const CORS_ORIGINS = String(process.env.CORS_ORIGIN || FRONTEND_URL).split(",").map((origin) => origin.trim()).filter(Boolean);
// GIS popup code flow must exchange the code using the requesting app origin.
// Keep this default for non-browser flows, but select the allowlisted request
// origin for each popup exchange below.
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || FRONTEND_URL;
const GOOGLE_ALLOWED_ORIGINS = new Set([
  FRONTEND_URL,
  GOOGLE_REDIRECT_URI,
  ...CORS_ORIGINS,
  ...(process.env.NODE_ENV === "production" ? [] : ["http://localhost:5173", "http://127.0.0.1:5173"])
].map((value) => {
  try { return new URL(value).origin; } catch { return ""; }
}).filter(Boolean));
const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === "production" ? "" : "futapulse-dev-only-change-this-secret");
const REFRESH_COOKIE = "futapulse_refresh";
const REFRESH_TOKEN_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const FEEDBACK_EMAIL = "immanuelidowu1@gmail.com";
const FUTAPULSE_ADMIN_EMAIL = String(process.env.FUTAPULSE_ADMIN_EMAIL || FEEDBACK_EMAIL).trim().toLowerCase();
const EMAIL_CHALLENGE_TTL = 15 * 60 * 1000;
const EVENT_REPORT_REVIEW_THRESHOLD = 5;
const googleOAuthClient = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);

function getGooglePopupRedirectUri(request) {
  const requestedOrigin = String(request.get("origin") || request.body?.origin || "").trim();
  if (!requestedOrigin) return GOOGLE_REDIRECT_URI;
  try {
    const parsedOrigin = new URL(requestedOrigin);
    if (parsedOrigin.origin !== requestedOrigin || !GOOGLE_ALLOWED_ORIGINS.has(parsedOrigin.origin)) return "";
    return parsedOrigin.origin;
  } catch {
    return "";
  }
}

const ALLOWED_CATEGORIES = new Set(["academic", "tech", "social", "religious", "sports", "seminars"]);
const NOTIFICATION_CATEGORIES = ["academic", "tech", "social", "religious", "sports", "seminars"];
const DEFAULT_NOTIFICATION_PREFERENCES = Object.freeze(Object.fromEntries(NOTIFICATION_CATEGORIES.map((category) => [category, true])));

function normalizeNotificationPreferences(value) {
  return Object.fromEntries(NOTIFICATION_CATEGORIES.map((category) => [
    category,
    typeof value?.[category] === "boolean" ? value[category] : true
  ]));
}
const USERNAME_PATTERN = /^(?=.*\p{L})[\p{L}\p{M}\p{N}_ .'-]{3,24}$/u;

function normalizeUsername(value) {
  return typeof value === "string"
    ? value.trim().normalize("NFC").toLowerCase().normalize("NFC")
    : "";
}

function isValidUsername(value) {
  return typeof value === "string" && USERNAME_PATTERN.test(value.trim());
}

function ensureDatabase() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ profiles: [], users: [], emailChallenges: [], eventReports: [], events: [] }, null, 2));
    return;
  }
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const data = JSON.parse(raw);
    let changed = false;
    if (!Array.isArray(data.events)) {
      data.events = [];
      changed = true;
    }
    if (!Array.isArray(data.profiles)) {
      data.profiles = [];
      changed = true;
    }
    if (!Array.isArray(data.users)) {
      data.users = [];
      changed = true;
    }
    if (!Array.isArray(data.emailChallenges)) {
      data.emailChallenges = [];
      changed = true;
    }
    if (!Array.isArray(data.eventReports)) {
      data.eventReports = [];
      changed = true;
    }
    if (changed) fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ profiles: [], users: [], emailChallenges: [], eventReports: [], events: [] }, null, 2));
  }
}

function assertLocalStorageAvailable() {
  if (databaseBackend === "mongodb" && mongoose.connection.readyState !== 1) {
    const error = new Error("MongoDB is temporarily unavailable; refusing to use stale local JSON data.");
    error.code = "MONGO_UNAVAILABLE";
    throw error;
  }
}

function readDatabase() {
  assertLocalStorageAvailable();
  ensureDatabase();
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function writeDatabase(database) {
  assertLocalStorageAvailable();
  ensureDatabase();
  const temporaryFile = `${DATA_FILE}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(database, null, 2));
  fs.renameSync(temporaryFile, DATA_FILE);
}

function validateProfile(profile) {
  const requiredFields = ["name", "faculty", "department", "level", "role"];
  return requiredFields.every((field) => typeof profile[field] === "string" && profile[field].trim());
}

function isValidNewPassword(password) {
  return typeof password === "string"
    && password.length > 6
    && password.length <= 128
    && /[A-Z]/.test(password)
    && /\d/.test(password);
}

function validateEvent(event) {
  if (typeof event.organizerName !== "string" || !event.organizerName.trim()) return false;
  if (typeof event.venue === "string" && event.venue.length > 120) return false;
  if (typeof event.venueLandmark === "string" && event.venueLandmark.length > 240) return false;
  const meetingUrl = typeof event.meetingUrl === "string" ? event.meetingUrl.trim() : "";
  if (meetingUrl) {
    if (meetingUrl.length > 2048) return false;
    try {
      const parsedMeetingUrl = new URL(meetingUrl);
      if (!["http:", "https:"].includes(parsedMeetingUrl.protocol) || parsedMeetingUrl.username || parsedMeetingUrl.password) return false;
    } catch {
      return false;
    }
  }
  if (event.status === "Draft") return true;
  const requiredFields = ["title", "category", "activity", "date", "endTime", "venue", "organizerName"];
  const start = new Date(event.date).getTime();
  const end = new Date(event.endTime).getTime();
  return requiredFields.every((field) => typeof event[field] === "string" && event[field].trim())
    && ALLOWED_CATEGORIES.has(event.category)
    && Array.isArray(event.audience)
    && event.audience.length > 0
    && Number.isFinite(start)
    && Number.isFinite(end)
    && end > start;
}

function getCurrentOrganizerMetadata(user) {
  const profile = user.profile || {};
  return {
    organizerName: profile.name || user.username || "Campus Organizer",
    organizerUsername: user.username,
    organizerFaculty: profile.faculty || "",
    organizerPicture: profile.picture || `/Faculty%20Logo/${encodeURIComponent(profile.faculty || "SEET")}.png`
  };
}

async function decorateEventsWithCurrentOrganizers(events, database) {
  const creatorIds = [...new Set(events.map((event) => event.createdByUserId).filter(Boolean).map(String))];
  if (creatorIds.length === 0) return events;

  let users;
  if (isMongoConnected()) {
    const validIds = creatorIds.filter((id) => mongoose.isValidObjectId(id));
    users = validIds.length
      ? await User.find({ _id: { $in: validIds } }).select("username profile").lean().exec()
      : [];
  } else {
    users = (database.users || []).filter((user) => creatorIds.includes(String(user.id)));
  }

  const usersById = new Map(users.map((user) => [String(user._id || user.id), user]));
  return events.map((event) => {
    const owner = usersById.get(String(event.createdByUserId));
    return owner ? { ...event, ...getCurrentOrganizerMetadata(owner) } : event;
  });
}

function normalizeMatchText(value) {
  return String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function diceTokenSimilarity(firstValue, secondValue) {
  const first = normalizeMatchText(firstValue).split(" ").filter(Boolean);
  const second = normalizeMatchText(secondValue).split(" ").filter(Boolean);
  if (!first.length || !second.length) return 0;
  const firstCounts = new Map();
  const secondCounts = new Map();
  first.forEach((token) => firstCounts.set(token, (firstCounts.get(token) || 0) + 1));
  second.forEach((token) => secondCounts.set(token, (secondCounts.get(token) || 0) + 1));
  let overlap = 0;
  firstCounts.forEach((count, token) => {
    overlap += Math.min(count, secondCounts.get(token) || 0);
  });
  return (2 * overlap) / (first.length + second.length);
}

function eventSimilarityScore(first, second) {
  const titleScore = diceTokenSimilarity(first.title, second.title);
  const firstVenue = normalizeMatchText(first.venue);
  const secondVenue = normalizeMatchText(second.venue);
  const venueScore = firstVenue && firstVenue === secondVenue ? 1 : diceTokenSimilarity(first.venue, second.venue);
  const firstStart = new Date(first.date || first.startTime).getTime();
  const secondStart = new Date(second.date || second.startTime).getTime();
  const firstEnd = new Date(first.endTime).getTime();
  const secondEnd = new Date(second.endTime).getTime();
  let startScore = 0;
  let endScore = 0;
  if (Number.isFinite(firstStart) && Number.isFinite(secondStart)) {
    const minutesApart = Math.abs(firstStart - secondStart) / 60_000;
    if (minutesApart === 0) startScore = 1;
    else if (minutesApart <= 30) startScore = 0.9;
    else if (minutesApart < 24 * 60) startScore = (24 * 60 - minutesApart) / (24 * 60 - 30);
  }
  if (Number.isFinite(firstEnd) && Number.isFinite(secondEnd)) {
    const minutesApart = Math.abs(firstEnd - secondEnd) / 60_000;
    if (minutesApart === 0) endScore = 1;
    else if (minutesApart <= 30) endScore = 0.9;
    else if (minutesApart < 24 * 60) endScore = (24 * 60 - minutesApart) / (24 * 60 - 30);
  }
  const categoryScore = normalizeMatchText(first.category) === normalizeMatchText(second.category) ? 1 : 0;
  const activityScore = diceTokenSimilarity(first.activity, second.activity);
  const isExactDuplicate = normalizeMatchText(first.title) === normalizeMatchText(second.title)
    && normalizeMatchText(first.category) === normalizeMatchText(second.category)
    && normalizeMatchText(first.venue) === normalizeMatchText(second.venue)
    && firstStart === secondStart
    && firstEnd === secondEnd
    && normalizeMatchText(first.activity) === normalizeMatchText(second.activity);
  const similarity = Math.round((titleScore * 35) + (venueScore * 20) + (startScore * 15) + (endScore * 15) + (categoryScore * 10) + (activityScore * 5));
  return isExactDuplicate ? 100 : Math.min(99, similarity);
}

function isWithinEventDisplayWindow(event, now = Date.now()) {
  const startTime = new Date(event.date || event.startTime || "").getTime();
  const endTime = new Date(event.endTime || "").getTime();
  return Number.isFinite(startTime)
    && Number.isFinite(endTime)
    && endTime > startTime
    && endTime + (30 * 60 * 1000) > now;
}

function isPublicRecapVisible(event, now = Date.now()) {
  const publishedAt = new Date(event?.recapPublishedAt || "").getTime();
  return ["Published", "Live"].includes(event?.status)
    && Array.isArray(event?.recapPhotos)
    && event.recapPhotos.length > 0
    && Number.isFinite(publishedAt)
    && publishedAt <= now
    && now - publishedAt <= 30 * 60_000;
}

function toPublicEvent(event, viewerId = "") {
  const {
    attendeeUserIds = [],
    hypedUserIds = [],
    reminderUserIds = [],
    viewCount,
    recapPromptDismissed,
    ...publicEvent
  } = event;
  const endAt = new Date(event.endTime || "");
  publicEvent.isEnded = Number.isFinite(endAt.getTime()) && endAt.getTime() <= Date.now();
  if (viewerId && String(event.createdByUserId || "") === String(viewerId)) {
    if (Number.isFinite(Number(viewCount))) publicEvent.viewCount = Number(viewCount);
    if (typeof recapPromptDismissed === "boolean") publicEvent.recapPromptDismissed = recapPromptDismissed;
  }
  if (viewerId) {
    publicEvent.isGoing = Array.isArray(attendeeUserIds) && attendeeUserIds.includes(String(viewerId));
    publicEvent.isHyped = Array.isArray(hypedUserIds) && hypedUserIds.includes(String(viewerId));
    publicEvent.isReminded = Array.isArray(reminderUserIds) && reminderUserIds.includes(String(viewerId));
  }
  return publicEvent;
}

function getEventDuplicateMatches(database, candidate, excludedEventId = "") {
  return database.events
    .filter((event) => ["Published", "Live"].includes(event.status) && String(event.id) !== String(excludedEventId))
    .map((event) => ({ event, score: eventSimilarityScore(candidate, event) }))
    .filter(({ score }) => score >= 60)
    .sort((first, second) => second.score - first.score)
    .slice(0, 5);
}

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  emailVerified: { type: Boolean, default: false },
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, default: "" },
  profile: { type: mongoose.Schema.Types.Mixed, default: {} },
  postingBanUntil: { type: Date, default: null },
  googleSubject: { type: String, default: "" },
  usernameChanges: { type: Number, default: 0 },
  facultyChanges: { type: Number, default: 0 },
  passwordResetTokenHash: { type: String, default: "" },
  passwordResetExpires: { type: Date, default: null },
  sessionVersion: { type: Number, default: 0 }
}, { timestamps: true });
const User = mongoose.models.FutapulseUser || mongoose.model("FutapulseUser", userSchema);
const emailChallengeSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true, trim: true },
  purpose: { type: String, required: true },
  codeHash: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  attempts: { type: Number, default: 0 },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });
emailChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
emailChallengeSchema.index({ email: 1, purpose: 1 }, { unique: true });
const EmailChallenge = mongoose.models.FutapulseEmailChallenge || mongoose.model("FutapulseEmailChallenge", emailChallengeSchema);
const eventRecordSchema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true },
  ownerUserId: { type: String, required: true, index: true },
  status: { type: String, required: true, index: true },
  category: { type: String, required: true, index: true },
  startsAt: { type: Date, default: null, index: true },
  endsAt: { type: Date, default: null, index: true },
  lastAnnouncementAt: { type: Date, default: null },
  record: { type: mongoose.Schema.Types.Mixed, required: true }
}, { timestamps: true, minimize: false });
eventRecordSchema.index({ status: 1, endsAt: 1 });
eventRecordSchema.index({ category: 1, status: 1, startsAt: 1 });
const EventRecord = mongoose.models.FutapulseEvent || mongoose.model("FutapulseEvent", eventRecordSchema, "events");

const engagementActionSchema = new mongoose.Schema({
  eventId: { type: String, required: true },
  userId: { type: String, required: true },
  type: { type: String, enum: ["rsvp", "flame", "reminder"], required: true },
  faculty: { type: String, default: "" },
  department: { type: String, default: "" },
  customReminderAt: { type: Date, default: null }
}, { timestamps: true });
engagementActionSchema.index({ eventId: 1, userId: 1, type: 1 }, { unique: true });
engagementActionSchema.index({ userId: 1, type: 1, updatedAt: -1 });
engagementActionSchema.index({ eventId: 1, type: 1, updatedAt: 1 });
const EngagementAction = mongoose.models.FutapulseEngagementAction
  || mongoose.model("FutapulseEngagementAction", engagementActionSchema, "engagement_actions");
const eventViewSchema = new mongoose.Schema({
  eventId: { type: String, required: true },
  userId: { type: String, required: true }
}, { timestamps: true });
eventViewSchema.index({ eventId: 1, userId: 1 }, { unique: true });
eventViewSchema.index({ eventId: 1, createdAt: -1 });
const EventView = mongoose.models.FutapulseEventView
  || mongoose.model("FutapulseEventView", eventViewSchema, "event_views");
const recapPromptDismissalSchema = new mongoose.Schema({
  eventId: { type: String, required: true },
  userId: { type: String, required: true },
  dismissedAt: { type: Date, required: true }
}, { timestamps: true });
recapPromptDismissalSchema.index({ eventId: 1, userId: 1 }, { unique: true });
const RecapPromptDismissal = mongoose.models.FutapulseRecapPromptDismissal
  || mongoose.model("FutapulseRecapPromptDismissal", recapPromptDismissalSchema, "recap_prompt_dismissals");
const pushDeviceSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  deviceKey: { type: String, required: true, unique: true },
  platform: { type: String, enum: ["web"], required: true },
  endpoint: { type: String, required: true },
  subscription: { type: mongoose.Schema.Types.Mixed, required: true },
  enabled: { type: Boolean, default: true, index: true }
}, { timestamps: true, minimize: false });
pushDeviceSchema.index({ userId: 1, enabled: 1 });
const PushDevice = mongoose.models.FutapulsePushDevice
  || mongoose.model("FutapulsePushDevice", pushDeviceSchema, "push_devices");
const notificationJobSchema = new mongoose.Schema({
  idempotencyKey: { type: String, required: true, unique: true },
  recipientUserId: { type: String, required: true, index: true },
  eventId: { type: String, default: "" },
  kind: { type: String, required: true, index: true },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  dueAt: { type: Date, required: true, index: true },
  expiresAt: { type: Date, required: true },
  status: { type: String, enum: ["pending", "processing", "sent", "failed", "cancelled", "undeliverable"], default: "pending", index: true },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now, index: true },
  leaseUntil: { type: Date, default: null, index: true },
  sentAt: { type: Date, default: null },
  lastError: { type: String, default: "" }
}, { timestamps: true, minimize: false });
notificationJobSchema.index({ status: 1, nextAttemptAt: 1, dueAt: 1 });
notificationJobSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const NotificationJob = mongoose.models.FutapulseNotificationJob
  || mongoose.model("FutapulseNotificationJob", notificationJobSchema, "notification_jobs");
let realtimeServer = null;
let notificationWorkerTimer = null;
let notificationWorkerInFlight = false;
let socketRedisClients = [];

function notificationEventLink(event) {
  const link = new URL(FRONTEND_URL);
  link.searchParams.set("event", String(event.id));
  link.searchParams.set("category", String(event.category || "all"));
  link.searchParams.set("notification", "1");
  link.hash = "home";
  return link.toString();
}

async function enqueueNotification({
  idempotencyKey,
  recipientUserId,
  event,
  kind,
  title,
  message,
  dueAt = new Date(),
  universal = false,
  reactivateCancelled = false
}) {
  if (!isMongoConnected() || !recipientUserId || !event?.id || !idempotencyKey) return null;
  const now = new Date();
  const due = new Date(dueAt);
  if (!Number.isFinite(due.getTime())) throw new Error("Notification dueAt must be a valid date.");
  const payload = {
    notificationId: idempotencyKey,
    kind,
    title: String(title).slice(0, 100),
    message: String(message).slice(0, 240),
    eventId: String(event.id),
    eventTitle: String(event.title || ""),
    category: String(event.category || ""),
    venue: String(event.venue || ""),
    url: notificationEventLink(event),
    universal: universal === true
  };
  try {
    const insertFields = {
      idempotencyKey,
      recipientUserId: String(recipientUserId),
      eventId: String(event.id),
      kind,
      payload,
      dueAt: due,
      expiresAt: new Date(Math.max(now.getTime(), due.getTime()) + (8 * 24 * 60 * 60 * 1000)),
      status: "pending",
      attempts: 0,
      nextAttemptAt: due,
      leaseUntil: null,
      sentAt: null,
      lastError: ""
    };
    if (reactivateCancelled) {
      const reactivated = await NotificationJob.findOneAndUpdate(
        { idempotencyKey, status: { $in: ["cancelled", "failed", "undeliverable"] } },
        { $set: insertFields },
        { new: true }
      ).exec();
      if (reactivated) return reactivated;
    }
    return await NotificationJob.findOneAndUpdate(
      { idempotencyKey },
      { $setOnInsert: insertFields },
      { upsert: true, new: true }
    ).exec();
  } catch (error) {
    if (error.code === 11000) return null;
    throw error;
  }
}

async function enqueueNotifications(userIds, details) {
  const uniqueIds = [...new Set((userIds || []).map(String).filter(Boolean))];
  const batchSize = 50;
  for (let index = 0; index < uniqueIds.length; index += batchSize) {
    await Promise.all(uniqueIds.slice(index, index + batchSize).map((recipientUserId) => enqueueNotification({
      ...details,
      recipientUserId,
      idempotencyKey: `${details.idempotencyKey}:${recipientUserId}`
    })));
  }
}

async function enqueueCategoryAlert(event, kind = "new-event") {
  if (!isMongoConnected() || !event?.category) return;
  const category = String(event.category).toLowerCase();
  if (!NOTIFICATION_CATEGORIES.includes(category)) return;
  const users = await User.find({
    emailVerified: true,
    [`profile.notificationPreferences.${category}`]: { $ne: false }
  }).select("_id").lean().exec();
  const categoryName = ({
    academic: "Academic",
    tech: "Tech & Innovation",
    social: "Social & Vibes",
    religious: "Religious & Fellowship",
    sports: "Sports & Athletics",
    seminars: "Seminars"
  })[category];
  await enqueueNotifications(users.map((item) => item._id), {
    idempotencyKey: `${kind}:${event.id}`,
    event,
    kind,
    title: `New ${categoryName} Event Uploaded!`,
    message: `A new ${categoryName} event is now on campus. Tap to check it out.`
  });
}

async function scheduleEventEndedRecapPrompt(event) {
  if (!isMongoConnected() || !event?.id) return;
  const eventId = String(event.id);
  if (!event.createdByUserId || !["Published", "Live"].includes(event.status)) {
    await cancelEventEndedRecapPrompts(eventId);
    return;
  }
  const endTime = new Date(event.endTime || "");
  if (!Number.isFinite(endTime.getTime()) || Date.now() - endTime.getTime() > 7 * 24 * 60 * 60_000) {
    await cancelEventEndedRecapPrompts(eventId);
    return;
  }
  const recipientUserId = String(event.createdByUserId);
  const idempotencyKey = `event-ended-recap:${eventId}:${endTime.toISOString()}`;
  const existing = await NotificationJob.findOne({ idempotencyKey }).exec();
  if (existing?.status === "sent") return;

  const dueAt = endTime.getTime() > Date.now() ? endTime : new Date();
  const payload = {
    notificationId: idempotencyKey,
    kind: "event-ended-recap-prompt",
    title: "Your event has ended",
    message: `${String(event.title || "Your event").slice(0, 100)} has ended. Upload look-back photos to share the recap.`,
    eventId,
    eventTitle: String(event.title || ""),
    category: String(event.category || ""),
    venue: String(event.venue || ""),
    url: notificationEventLink(event),
    universal: false
  };

  await NotificationJob.updateMany({
    eventId,
    kind: "event-ended-recap-prompt",
    idempotencyKey: { $ne: idempotencyKey },
    status: { $in: ["pending", "processing"] }
  }, { $set: { status: "cancelled", leaseUntil: null } }).exec();

  if (existing) {
    existing.payload = payload;
    existing.dueAt = dueAt;
    existing.expiresAt = new Date(Math.max(Date.now(), dueAt.getTime()) + (8 * 24 * 60 * 60_000));
    existing.nextAttemptAt = dueAt;
    existing.status = "pending";
    existing.attempts = 0;
    existing.leaseUntil = null;
    existing.lastError = "";
    await existing.save();
    return;
  }
  await enqueueNotification({
    idempotencyKey,
    recipientUserId,
    event,
    kind: "event-ended-recap-prompt",
    title: payload.title,
    message: payload.message,
    dueAt
  });
}

async function cancelEventEndedRecapPrompts(eventId) {
  if (!isMongoConnected()) {
    const database = readDatabase();
    database.notificationJobs = (database.notificationJobs || []).map((job) => (
      String(job.eventId) === String(eventId) && job.kind === "event-ended-recap-prompt"
        && ["pending", "processing"].includes(job.status)
        ? { ...job, status: "cancelled", leaseUntil: null }
        : job
    ));
    writeDatabase(database);
    return;
  }
  await NotificationJob.updateMany({
    eventId: String(eventId),
    kind: "event-ended-recap-prompt",
    status: { $in: ["pending", "processing"] }
  }, { $set: { status: "cancelled", leaseUntil: null } }).exec();
}

function validateVapidCredentials(publicKeyValue, privateKeyValue) {
  if (typeof publicKeyValue !== "string" || typeof privateKeyValue !== "string"
    || !publicKeyValue.trim() || !privateKeyValue.trim()) {
    return { valid: false, error: "Both Web Push VAPID keys must be configured." };
  }

  const publicKey = publicKeyValue.trim();
  const privateKey = privateKeyValue.trim();
  if (!/^[A-Za-z0-9_-]+$/.test(publicKey) || !/^[A-Za-z0-9_-]+$/.test(privateKey)) {
    return { valid: false, error: "Web Push VAPID keys must be unpadded base64url values." };
  }

  const decodedPublicKey = Buffer.from(publicKey, "base64url");
  const decodedPrivateKey = Buffer.from(privateKey, "base64url");
  if (decodedPublicKey.toString("base64url") !== publicKey || decodedPrivateKey.toString("base64url") !== privateKey) {
    return { valid: false, error: "Web Push VAPID keys are not valid canonical base64url values." };
  }
  if (decodedPublicKey.length !== 65 || decodedPublicKey[0] !== 0x04 || decodedPrivateKey.length !== 32) {
    return { valid: false, error: "The VAPID public key must be a 65-byte uncompressed P-256 point and the private key must be 32 bytes." };
  }

  try {
    const ecdh = crypto.createECDH("prime256v1");
    ecdh.setPrivateKey(decodedPrivateKey);
    const derivedPublicKey = ecdh.getPublicKey(undefined, "uncompressed");
    crypto.ECDH.convertKey(decodedPublicKey, "prime256v1", undefined, undefined, "uncompressed");
    if (!crypto.timingSafeEqual(derivedPublicKey, decodedPublicKey)) {
      return { valid: false, error: "The Web Push VAPID public and private keys do not match." };
    }
  } catch {
    return { valid: false, error: "The Web Push VAPID public key is not a valid point on the P-256 curve, or the private key is invalid." };
  }

  return { valid: true, error: "" };
}

function getVapidConfiguration() {
  return validateVapidCredentials(process.env.WEB_PUSH_PUBLIC_KEY, process.env.WEB_PUSH_PRIVATE_KEY);
}

function initializePushProviders() {
  const configuration = getVapidConfiguration();
  if (!configuration.valid) {
    if (process.env.WEB_PUSH_PUBLIC_KEY || process.env.WEB_PUSH_PRIVATE_KEY) {
      console.error(`Web Push configuration is invalid: ${configuration.error}`);
    }
    return configuration;
  }
  webPush.setVapidDetails(
    process.env.WEB_PUSH_SUBJECT || "mailto:notifications@futapulse.app",
    process.env.WEB_PUSH_PUBLIC_KEY.trim(),
    process.env.WEB_PUSH_PRIVATE_KEY.trim()
  );
  return configuration;
}

function configureCloudinary() {
  const CLOUDINARY_CLOUD_NAME = String(process.env.CLOUDINARY_CLOUD_NAME || "").trim();
  const CLOUDINARY_API_KEY = String(process.env.CLOUDINARY_API_KEY || "").trim();
  const CLOUDINARY_API_SECRET = String(process.env.CLOUDINARY_API_SECRET || "").trim();
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) return false;
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true
  });
  return true;
}

function getMissingCloudinaryVariables() {
  return ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"]
    .filter((variable) => !String(process.env[variable] || "").trim());
}

function classifyCloudinaryError(error) {
  const status = Number(error?.http_code || error?.statusCode || error?.status);
  const message = String(error?.message || error?.error?.message || "").toLowerCase();
  if (error?.code === "ETIMEDOUT" || error?.code === "ECONNRESET" || error?.code === "ENOTFOUND") return "network_error";
  if (status === 401 || /invalid[_\s-]+(?:api[_\s-]+)?key|invalid[_\s-]+signature|authentication failed/.test(message)) return "invalid_credentials";
  if (status === 403) return "access_denied";
  if (status === 404 || /cloud name.*(invalid|not found)|unknown cloud/.test(message)) return "invalid_cloud_name";
  if (status >= 500) return "provider_unavailable";
  return "upload_rejected";
}

function cloudinaryErrorMessage(error, assetLabel) {
  const category = classifyCloudinaryError(error);
  if (category === "network_error") return `The connection to ${assetLabel} storage timed out. Check your internet connection and try again.`;
  if (category === "invalid_credentials") {
    const subject = assetLabel === "Cloudinary" ? "Cloudinary" : `${assetLabel} storage`;
    return `${subject} rejected the configured credentials. Check the cloud name, API key, and API secret on the API host.`;
  }
  if (category === "invalid_cloud_name") return `Cloudinary could not find the configured cloud. Check CLOUDINARY_CLOUD_NAME on the API host.`;
  if (category === "access_denied") return `Cloudinary denied this ${assetLabel} upload. Check the API key permissions and account upload settings.`;
  if (category === "provider_unavailable") return `${assetLabel} storage is temporarily unavailable. Please try again shortly.`;
  return `The ${assetLabel} could not be saved to Cloudinary. Please try again.`;
}

const recapImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 5, fileSize: 5 * 1024 * 1024 },
  fileFilter: (request, file, callback) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
      callback(new Error("Recap photos must be JPEG, PNG, or WebP images."));
      return;
    }
    callback(null, true);
  }
});

function uploadRecapImage(buffer, eventId) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({
      folder: `futapulse/event-recaps/${String(eventId).replace(/[^a-zA-Z0-9_-]/g, "_")}`,
      resource_type: "image",
      format: "webp",
      quality: "auto",
      fetch_format: "auto",
      transformation: [{ width: 1600, height: 1600, crop: "limit" }]
    }, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
    stream.end(buffer);
  });
}

function uploadEventBannerImage(buffer, eventId) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({
      folder: `futapulse/event-banners/${String(eventId).replace(/[^a-zA-Z0-9_-]/g, "_")}`,
      resource_type: "image",
      format: "webp",
      quality: "auto",
      fetch_format: "auto",
      transformation: [{ width: 1280, height: 1280, crop: "limit" }]
    }, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
    stream.end(buffer);
  });
}

function decodeEventBannerDataUrl(dataUrl) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([a-zA-Z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) throw new Error("An event banner must be a JPEG, PNG, or WebP image.");
  const buffer = Buffer.from(match[2], "base64");
  const isJpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isPng = buffer.length >= 8
    && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp = buffer.length >= 12
    && buffer.toString("ascii", 0, 4) === "RIFF"
    && buffer.toString("ascii", 8, 12) === "WEBP";
  if (!isJpeg && !isPng && !isWebp) throw new Error("An event banner does not match its declared image format.");
  return buffer;
}

async function externalizeEventBanners(event) {
  const sourceImages = Array.isArray(event.bannerImages) && event.bannerImages.length
    ? event.bannerImages
    : event.banner ? [event.banner] : [];
  if (sourceImages.length > 5) throw new Error("An event can contain at most five banner images.");
  if (sourceImages.some((image) => typeof image !== "string")) throw new Error("An event banner image is invalid.");
  if (!sourceImages.some((image) => typeof image === "string" && image.startsWith("data:image/"))) {
    if (sourceImages.some((image) => image && !image.startsWith("/") && !/^https?:\/\//i.test(image))) {
      throw new Error("Event banner URLs must use HTTP or HTTPS.");
    }
    return { ...event, bannerImages: sourceImages, banner: sourceImages[0] || "" };
  }
  if (!configureCloudinary()) {
    const error = new Error(`Event banner storage is not configured. Add ${getMissingCloudinaryVariables().join(", ")} to the server environment.`);
    error.code = "EVENT_BANNER_STORAGE_UNAVAILABLE";
    throw error;
  }

  const uploads = await Promise.allSettled(sourceImages.map(async (image) => {
    if (typeof image !== "string") throw new Error("An event banner image is invalid.");
    if (!image.startsWith("data:image/")) return { url: image, publicId: "" };
    const uploaded = await uploadEventBannerImage(decodeEventBannerDataUrl(image), event.id);
    return { url: uploaded.secure_url, publicId: uploaded.public_id };
  }));
  const failedUpload = uploads.find((result) => result.status === "rejected");
  if (failedUpload) {
    await Promise.all(uploads.filter((result) => result.status === "fulfilled" && result.value.publicId).map(async (result) => {
      try {
        await cloudinary.uploader.destroy(result.value.publicId, { resource_type: "image" });
      } catch (cleanupError) {
        console.error("Unable to remove an unreferenced event banner after upload failure.", {
          category: classifyCloudinaryError(cleanupError),
          status: Number(cleanupError?.http_code || cleanupError?.statusCode || cleanupError?.status) || null
        });
      }
    }));
    const error = failedUpload.reason;
    error.code = "EVENT_BANNER_UPLOAD_FAILED";
    throw error;
  }
  const bannerImages = uploads.map((result) => result.value.url);
  return { ...event, bannerImages, banner: bannerImages[0] || "" };
}

function eventBannerUploadErrorMessage(error) {
  return cloudinaryErrorMessage(error, "Event image");
}

function describeWebPushFailure(error, endpoint) {
  let endpointHost = "unknown push service";
  try {
    endpointHost = new URL(endpoint).host;
  } catch {
    // Keep the diagnostic useful without ever logging the subscription endpoint.
  }
  const statusCode = Number.isInteger(error?.statusCode) ? ` HTTP ${error.statusCode}` : "";
  const providerMessage = String(error?.body || error?.message || "Unknown push service error")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 300);
  return `${endpointHost} returned${statusCode}: ${providerMessage}`;
}

async function dispatchNotificationJob(job) {
  const payload = {
    ...job.payload,
    recipientUserId: String(job.recipientUserId),
    createdAt: new Date().toISOString()
  };
  const recipientRoom = `user:${job.recipientUserId}`;
  const recipientSockets = realtimeServer
    ? await realtimeServer.in(recipientRoom).fetchSockets()
    : [];
  const activeSocketCount = recipientSockets.filter((socket) => socket.data.notificationForeground === true).length;
  if (realtimeServer) realtimeServer.to(recipientRoom).emit("home-notification", payload);
  const devices = await PushDevice.find({ userId: job.recipientUserId, platform: "web", enabled: true }).lean().exec();
  const failures = [];
  let deliveredToDeviceCount = 0;
  let expiredDeviceCount = 0;
  await Promise.all(devices.map(async (device) => {
    try {
      if (device.platform === "web") {
        const vapidConfiguration = getVapidConfiguration();
        if (!vapidConfiguration.valid) {
          const configurationError = new Error(vapidConfiguration.error);
          configurationError.code = "WEB_PUSH_CONFIGURATION_ERROR";
          throw configurationError;
        }
        await webPush.sendNotification(device.subscription, JSON.stringify(payload), {
          TTL: 60 * 60 * 24 * 7,
          urgency: "high",
          topic: crypto.createHash("sha256").update(job.idempotencyKey).digest("base64url").slice(0, 32)
        });
        deliveredToDeviceCount += 1;
      }
    } catch (error) {
      if (device.platform === "web" && [404, 410].includes(error.statusCode)) {
        await PushDevice.updateOne({ deviceKey: device.deviceKey }, { $set: { enabled: false } }).exec();
        expiredDeviceCount += 1;
      } else {
        failures.push({
          statusCode: Number.isInteger(error?.statusCode) ? error.statusCode : null,
          code: error?.code || "",
          message: describeWebPushFailure(error, device.endpoint)
        });
      }
    }
  }));
  if (activeSocketCount > 0 || deliveredToDeviceCount > 0) {
    if (failures.length) {
      console.warn(`Notification ${job.idempotencyKey} reached at least one recipient channel, but ${failures.length} Web Push device(s) failed.`, failures);
    }
    return;
  }
  if (failures.length) {
    const error = new Error(failures.map((failure) => failure.message).join("; "));
    error.code = failures.every((failure) => failure.code === "WEB_PUSH_CONFIGURATION_ERROR")
      ? "WEB_PUSH_CONFIGURATION_ERROR"
      : failures.every((failure) => failure.statusCode !== null
      && failure.statusCode >= 400 && failure.statusCode < 500
      && ![408, 425, 429].includes(failure.statusCode))
      ? "WEB_PUSH_PERMANENT_FAILURE"
      : "WEB_PUSH_RETRYABLE_FAILURE";
    throw error;
  }
  if (activeSocketCount === 0 && deliveredToDeviceCount === 0) {
    const reason = expiredDeviceCount
      ? `${expiredDeviceCount} expired Web Push subscription(s) were disabled.`
      : "Recipient has no active FUTApulse session or registered Web Push device.";
    const error = new Error(reason);
    error.code = "NO_NOTIFICATION_DELIVERY_CHANNEL";
    throw error;
  }
}

async function claimDueNotificationJob(now = new Date()) {
  return NotificationJob.findOneAndUpdate({
    dueAt: { $lte: now },
    nextAttemptAt: { $lte: now },
    $or: [
      { status: "pending" },
      { status: "processing", leaseUntil: { $lte: now } }
    ]
  }, {
    $set: { status: "processing", leaseUntil: new Date(now.getTime() + 60_000) },
    $inc: { attempts: 1 }
  }, { new: true, sort: { dueAt: 1, createdAt: 1 } }).exec();
}

async function processClaimedNotificationJob(job) {
  try {
    await dispatchNotificationJob(job);
    await NotificationJob.updateOne({ _id: job._id, status: "processing" }, {
      $set: { status: "sent", sentAt: new Date(), leaseUntil: null, lastError: "" }
    }).exec();
    return "sent";
  } catch (error) {
    const attempts = Number(job.attempts) || 1;
    const permanentFailure = ["WEB_PUSH_PERMANENT_FAILURE", "WEB_PUSH_CONFIGURATION_ERROR"].includes(error.code);
    const exhausted = permanentFailure || attempts >= 8;
    const retryDelay = Math.min(60 * 60_000, 15_000 * (2 ** Math.min(attempts - 1, 7)));
    console.error(`Notification delivery failed for ${job.idempotencyKey}.`, error);
    if (error.code === "NO_NOTIFICATION_DELIVERY_CHANNEL") {
      await NotificationJob.updateOne({ _id: job._id, status: "processing" }, {
        $set: {
          status: "undeliverable",
          leaseUntil: null,
          lastError: String(error.message || error).slice(0, 500)
        }
      }).exec();
      return "undeliverable";
    }

    await NotificationJob.updateOne({ _id: job._id, status: "processing" }, {
      $set: {
        status: exhausted ? "failed" : "pending",
        nextAttemptAt: new Date(Date.now() + retryDelay),
        leaseUntil: null,
        lastError: String(error.message || error).slice(0, 500)
      }
    }).exec();
    return exhausted ? "failed" : "retried";
  }
}

async function runNotificationWorker({ limit = 20 } = {}) {
  if (!isMongoConnected()) return { processed: 0, sent: 0, retried: 0, failed: 0, undeliverable: 0, hasMore: false, unavailable: true };
  const batchLimit = Math.min(50, Math.max(1, Number.isInteger(limit) ? limit : 1));
  const claimedJobs = [];
  while (claimedJobs.length < batchLimit) {
    const job = await claimDueNotificationJob();
    if (!job) break;
    claimedJobs.push(job);
  }

  const outcomes = await Promise.all(claimedJobs.map(processClaimedNotificationJob));
  const sent = outcomes.filter((outcome) => outcome === "sent").length;
  const retried = outcomes.filter((outcome) => outcome === "retried").length;
  const failed = outcomes.filter((outcome) => outcome === "failed").length;
  const undeliverable = outcomes.filter((outcome) => outcome === "undeliverable").length;
  const now = new Date();
  const hasMore = Boolean(await NotificationJob.exists({
    dueAt: { $lte: now },
    nextAttemptAt: { $lte: now },
    $or: [
      { status: "pending" },
      { status: "processing", leaseUntil: { $lte: now } }
    ]
  }).exec());
  return { processed: claimedJobs.length, sent, retried, failed, undeliverable, hasMore, unavailable: false };
}

const eventReportSchema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true },
  posterUserId: { type: String, required: true, index: true },
  reporterIds: { type: [String], default: [] },
  reports: { type: [mongoose.Schema.Types.Mixed], default: [] },
  status: { type: String, default: "collecting", index: true },
  record: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true, minimize: false });
eventReportSchema.index({ status: 1, updatedAt: -1 });
const EventReport = mongoose.models.FutapulseEventReport
  || mongoose.model("FutapulseEventReport", eventReportSchema, "event_reports");

// Production remains gated until the local migration has been applied and the
// Mongo-backed auth, events, reports, and engagement paths have been smoke-tested.
// This is an explicit deployment acknowledgment, not an automatic migration.
const OPERATIONAL_MONGO_CUTOVER_COMPLETE = process.env.FUTAPULSE_MONGO_CUTOVER_COMPLETE === "true";

function isMongoConnected() {
  return mongoose.connection.readyState === 1;
}

function buildFacultyTurnoutBreakdown(attendees, facultyByUserId = new Map()) {
  const turnoutBreakdown = new Map();
  for (const action of attendees) {
    const faculty = String(action.faculty || facultyByUserId.get(String(action.userId)) || "").trim();
    if (faculty) turnoutBreakdown.set(faculty, (turnoutBreakdown.get(faculty) || 0) + 1);
  }
  return [...turnoutBreakdown].map(([faculty, count]) => ({ faculty, count }));
}

function eventDocumentFromRecord(event) {
  const startsAt = new Date(event.date || event.startTime || "");
  const endsAt = new Date(event.endTime || "");
  return {
    eventId: String(event.id),
    ownerUserId: String(event.createdByUserId || ""),
    status: String(event.status || "Draft"),
    category: String(event.category || ""),
    startsAt: Number.isFinite(startsAt.getTime()) ? startsAt : null,
    endsAt: Number.isFinite(endsAt.getTime()) ? endsAt : null,
    record: event
  };
}

async function listStoredEvents(viewerId = "", onlyVisible = false) {
  if (!isMongoConnected()) return readDatabase().events;
  let filter = {};
  if (onlyVisible) {
    const now = Date.now();
    const visibleEventStart = new Date(now - (30 * 60_000));
    const recentOwnerHistoryStart = new Date(now - (7 * 24 * 60 * 60_000));
    const visibilityFilters = [
      { status: { $in: ["Published", "Live"] }, endsAt: { $gt: visibleEventStart } },
      {
        status: { $in: ["Published", "Live"] },
        "record.recapPhotos.0": { $exists: true },
        "record.recapPublishedAt": { $gte: new Date(now - (30 * 60_000)).toISOString(), $lte: new Date(now).toISOString() }
      }
    ];
    if (viewerId) {
      visibilityFilters.push(
        { ownerUserId: String(viewerId), status: "Draft" },
        { ownerUserId: String(viewerId), status: { $ne: "Cancelled" }, endsAt: { $gt: recentOwnerHistoryStart, $lte: new Date(now) } },
        { ownerUserId: String(viewerId), status: "Cancelled", "record.cancelledAt": { $gte: recentOwnerHistoryStart.toISOString() } }
      );
    }
    filter = { $or: visibilityFilters };
  }
  const records = await EventRecord.find(filter).lean().exec();
  const events = records.map((item) => item.record).filter(Boolean);
  if (!events.length) return events;
  const eventIds = events.map((event) => String(event.id));
  const actions = await EngagementAction.find({ eventId: { $in: eventIds } })
    .select("eventId userId type faculty department")
    .lean()
    .exec();
  const actionsByEvent = new Map();
  for (const action of actions) {
    if (!actionsByEvent.has(action.eventId)) actionsByEvent.set(action.eventId, []);
    actionsByEvent.get(action.eventId).push(action);
  }
  const attendeesMissingFaculty = actions
    .filter((action) => action.type === "rsvp" && !String(action.faculty || "").trim())
    .map((action) => String(action.userId || ""));
  const missingFacultyUserIds = [...new Set(attendeesMissingFaculty)].filter((id) => mongoose.isValidObjectId(id));
  const facultyByUserId = new Map();
  if (missingFacultyUserIds.length) {
    const attendeeUsers = await User.find({ _id: { $in: missingFacultyUserIds } })
      .select("_id profile.faculty")
      .lean()
      .exec();
    for (const attendee of attendeeUsers) {
      const faculty = String(attendee.profile?.faculty || "").trim();
      if (faculty) facultyByUserId.set(String(attendee._id), faculty);
    }
  }
  return events.map((event) => {
    const eventActions = actionsByEvent.get(String(event.id)) || [];
    const matching = (type) => eventActions.filter((action) => action.type === type);
    const attendees = matching("rsvp");
    const hyped = matching("flame");
    const reminders = matching("reminder");
    return {
      ...event,
      rsvpCount: attendees.length,
      turnoutCount: attendees.length,
      flameCount: hyped.length,
      reminderCount: reminders.length,
      turnoutBreakdown: buildFacultyTurnoutBreakdown(attendees, facultyByUserId),
      attendeeUserIds: viewerId && attendees.some((action) => String(action.userId) === String(viewerId)) ? [String(viewerId)] : [],
      hypedUserIds: viewerId && hyped.some((action) => String(action.userId) === String(viewerId)) ? [String(viewerId)] : [],
      reminderUserIds: viewerId && reminders.some((action) => String(action.userId) === String(viewerId)) ? [String(viewerId)] : []
    };
  });
}

async function getEventViewCounts(eventIds) {
  const ids = [...new Set((eventIds || []).map(String).filter(Boolean))];
  if (!ids.length) return new Map();
  if (!isMongoConnected()) {
    const database = readDatabase();
    const counts = new Map();
    const requestedIds = new Set(ids);
    for (const view of database.eventViews || []) {
      if (requestedIds.has(String(view.eventId))) {
        counts.set(String(view.eventId), (counts.get(String(view.eventId)) || 0) + 1);
      }
    }
    return counts;
  }
  const grouped = await EventView.aggregate([
    { $match: { eventId: { $in: ids } } },
    { $group: { _id: "$eventId", count: { $sum: 1 } } }
  ]).exec();
  return new Map(grouped.map((item) => [String(item._id), Number(item.count) || 0]));
}

async function decorateOwnerEventViews(events, viewerId) {
  if (!viewerId || !events.length) return events;
  const ownedEvents = events.filter((event) => String(event.createdByUserId || "") === String(viewerId));
  if (!ownedEvents.length) return events;
  const counts = await getEventViewCounts(ownedEvents.map((event) => event.id));
  return events.map((event) => String(event.createdByUserId || "") === String(viewerId)
    ? { ...event, viewCount: counts.get(String(event.id)) || 0 }
    : event);
}

async function decorateOwnerRecapDismissals(events, viewerId) {
  if (!viewerId || !events.length) return events;
  const ownedEvents = events.filter((event) => String(event.createdByUserId || "") === String(viewerId));
  if (!ownedEvents.length) return events;
  const eventIds = ownedEvents.map((event) => String(event.id));
  let dismissedIds;
  if (isMongoConnected()) {
    const dismissals = await RecapPromptDismissal.find({
      userId: String(viewerId),
      eventId: { $in: eventIds }
    }).select("eventId").lean().exec();
    dismissedIds = new Set(dismissals.map((item) => String(item.eventId)));
  } else {
    const dismissals = readDatabase().recapPromptDismissals || [];
    dismissedIds = new Set(dismissals
      .filter((item) => String(item.userId) === String(viewerId) && eventIds.includes(String(item.eventId)))
      .map((item) => String(item.eventId)));
  }
  return events.map((event) => String(event.createdByUserId || "") === String(viewerId)
    ? { ...event, recapPromptDismissed: dismissedIds.has(String(event.id)) }
    : event);
}

async function findStoredEvent(eventId) {
  if (!isMongoConnected()) return readDatabase().events.find((item) => String(item.id) === String(eventId)) || null;
  const record = await EventRecord.findOne({ eventId: String(eventId) }).lean().exec();
  return record?.record || null;
}

async function storeEvent(event) {
  if (!isMongoConnected()) {
    const database = readDatabase();
    const index = database.events.findIndex((item) => String(item.id) === String(event.id));
    if (index < 0) database.events.push(event);
    else database.events[index] = event;
    writeDatabase(database);
    return event;
  }
  await EventRecord.updateOne({ eventId: String(event.id) }, { $set: eventDocumentFromRecord(event) }, { upsert: true }).exec();
  return event;
}

async function listStoredReports() {
  if (!isMongoConnected()) return readDatabase().eventReports || [];
  const records = await EventReport.find({}).lean().exec();
  return records.map((item) => item.record || {
    eventId: item.eventId,
    posterUserId: item.posterUserId,
    reporterIds: item.reporterIds || [],
    reports: item.reports || [],
    status: item.status || "collecting",
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  });
}

async function storeReport(reportCase) {
  if (!isMongoConnected()) {
    const database = readDatabase();
    const reports = database.eventReports || [];
    const index = reports.findIndex((item) => String(item.eventId) === String(reportCase.eventId));
    if (index < 0) reports.push(reportCase);
    else reports[index] = reportCase;
    database.eventReports = reports;
    writeDatabase(database);
    return reportCase;
  }
  await EventReport.updateOne({ eventId: String(reportCase.eventId) }, { $set: {
    eventId: String(reportCase.eventId),
    posterUserId: String(reportCase.posterUserId || ""),
    reporterIds: reportCase.reporterIds || [],
    reports: reportCase.reports || [],
    status: reportCase.status || "collecting",
    record: reportCase
  } }, { upsert: true }).exec();
  return reportCase;
}

async function deleteStoredEvent(eventId) {
  if (!isMongoConnected()) {
    const database = readDatabase();
    database.events = database.events.filter((item) => String(item.id) !== String(eventId));
    database.eventReports = (database.eventReports || []).filter((item) => String(item.eventId) !== String(eventId));
    database.eventViews = (database.eventViews || []).filter((item) => String(item.eventId) !== String(eventId));
    database.recapPromptDismissals = (database.recapPromptDismissals || []).filter((item) => String(item.eventId) !== String(eventId));
    database.engagementActionIds = (database.engagementActionIds || []).filter((actionKey) => {
      const separator = String(actionKey).indexOf(":");
      return separator < 0 || String(actionKey).slice(0, separator) !== String(eventId);
    });
    writeDatabase(database);
    await cancelEventEndedRecapPrompts(eventId);
    return;
  }
  await Promise.all([
    EventRecord.deleteOne({ eventId: String(eventId) }).exec(),
    EventReport.deleteOne({ eventId: String(eventId) }).exec(),
    EngagementAction.deleteMany({ eventId: String(eventId) }).exec(),
    EventView.deleteMany({ eventId: String(eventId) }).exec(),
    RecapPromptDismissal.deleteMany({ eventId: String(eventId) }).exec(),
    cancelEventEndedRecapPrompts(eventId),
    NotificationJob.updateMany({
      eventId: String(eventId),
      status: { $in: ["pending", "processing"] }
    }, { $set: { status: "cancelled", leaseUntil: null } }).exec()
  ]);
}

async function deleteStoredEventsForOwner(ownerUserId) {
  const ownerId = String(ownerUserId);
  if (!isMongoConnected()) {
    const database = readDatabase();
    const ownedIds = new Set(database.events.filter((event) => String(event.createdByUserId || "") === ownerId).map((event) => String(event.id)));
    database.events = database.events.filter((event) => !ownedIds.has(String(event.id)));
    database.eventReports = (database.eventReports || []).filter((item) => !ownedIds.has(String(item.eventId)));
    database.notificationJobs = (database.notificationJobs || []).filter((item) => !ownedIds.has(String(item.eventId)));
    database.eventViews = (database.eventViews || []).filter((item) => !ownedIds.has(String(item.eventId)) && String(item.userId) !== ownerId);
    database.recapPromptDismissals = (database.recapPromptDismissals || []).filter((item) => !ownedIds.has(String(item.eventId)) && String(item.userId) !== ownerId);
    database.engagementActionIds = (database.engagementActionIds || []).filter((key) => {
      const separator = String(key).indexOf(":");
      return separator < 0 || !ownedIds.has(String(key).slice(0, separator));
    });
    writeDatabase(database);
    return;
  }
  const ownedRecords = await EventRecord.find({ ownerUserId }).select("eventId").lean().exec();
  const eventIds = ownedRecords.map((item) => item.eventId);
  await Promise.all([
    eventIds.length ? EventRecord.deleteMany({ eventId: { $in: eventIds } }).exec() : Promise.resolve(),
    eventIds.length ? EventReport.deleteMany({ eventId: { $in: eventIds } }).exec() : Promise.resolve(),
    eventIds.length ? NotificationJob.deleteMany({ eventId: { $in: eventIds } }).exec() : Promise.resolve(),
    EventView.deleteMany({ $or: [
      { userId: ownerId },
      ...(eventIds.length ? [{ eventId: { $in: eventIds } }] : [])
    ] }).exec(),
    RecapPromptDismissal.deleteMany({ $or: [
      { userId: ownerId },
      ...(eventIds.length ? [{ eventId: { $in: eventIds } }] : [])
    ] }).exec(),
    EngagementAction.deleteMany({ $or: [
      { userId: ownerId },
      ...(eventIds.length ? [{ eventId: { $in: eventIds } }] : [])
    ] }).exec()
  ]);
}

function normalizeUser(user) {
  const profile = user.profile || { name: user.username };
  return {
    id: String(user._id || user.id),
    email: user.email,
    emailVerified: user.emailVerified === true,
    postingBanUntil: user.postingBanUntil ? new Date(user.postingBanUntil).toISOString() : null,
    username: user.username,
    hasPassword: Boolean(user.passwordHash),
    editableFields: {
      usernameChanges: Number(user.usernameChanges) || 0,
      facultyChanges: Number(user.facultyChanges) || 0
    },
    profile: {
      ...profile,
      notificationPreferences: normalizeNotificationPreferences(profile.notificationPreferences),
      notificationPreferencesOnboardingComplete: profile.notificationPreferencesOnboardingComplete === true
    }
  };
}

function createSession(user) {
  if (!JWT_SECRET) throw new Error("JWT_SECRET must be configured in production.");
  const safeUser = normalizeUser(user);
  return {
    token: jwt.sign({ sub: safeUser.id, username: safeUser.username, sessionVersion: user.sessionVersion || 0, tokenUse: "access" }, JWT_SECRET, { expiresIn: "15m" }),
    user: safeUser
  };
}

function sendSession(response, user, remember = false) {
  const session = createSession(user);
  const refreshToken = jwt.sign({
    sub: session.user.id,
    sessionVersion: user.sessionVersion || 0,
    persistent: remember,
    tokenUse: "refresh"
  }, JWT_SECRET, { expiresIn: remember ? "30d" : "7d" });
  response.cookie(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth",
    ...(remember ? { maxAge: REFRESH_TOKEN_MAX_AGE } : {})
  });
  return session;
}

async function advanceUserSessionVersion(user) {
  const userId = String(user._id || user.id);
  if (isMongoConnected()) {
    const updatedUser = await User.findByIdAndUpdate(userId, { $inc: { sessionVersion: 1 } }, { new: true }).exec();
    if (!updatedUser) throw new Error("The account could not be found while starting a new session.");
    user.sessionVersion = updatedUser.sessionVersion;
  } else {
    const database = readDatabase();
    const storedUser = database.users.find((item) => String(item.id) === userId);
    if (!storedUser) throw new Error("The account could not be found while starting a new session.");
    storedUser.sessionVersion = (Number(storedUser.sessionVersion) || 0) + 1;
    user.sessionVersion = storedUser.sessionVersion;
    writeDatabase(database);
  }

  if (realtimeServer) {
    const sessions = await realtimeServer.in(`user:${userId}`).fetchSockets();
    for (const socket of sessions) {
      if (socket.data.sessionVersion !== user.sessionVersion) {
        socket.emit("session-revoked", { reason: "signed-in-elsewhere" });
        socket.disconnect(true);
      }
    }
  }
}

function clearRefreshCookie(response) {
  response.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth"
  });
}

function getRefreshCookie(request) {
  const cookie = (request.get("cookie") || "").split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${REFRESH_COOKIE}=`));
  return cookie ? decodeURIComponent(cookie.slice(REFRESH_COOKIE.length + 1)) : "";
}

function refreshSessionIsPersistent(request) {
  try {
    const token = getRefreshCookie(request);
    const claims = token ? jwt.verify(token, JWT_SECRET) : null;
    return claims?.tokenUse === "refresh" && claims.persistent === true;
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) return false;
    throw error;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function createGmailOAuthClient(signal) {
  const clientId = String(process.env.GOOGLE_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.GOOGLE_CLIENT_SECRET || "").trim();
  const refreshToken = String(process.env.GMAIL_REFRESH_TOKEN || "").trim();
  if (!clientId || !clientSecret || !refreshToken) return null;
  const clientOptions = {
    clientId,
    clientSecret,
    transporterOptions: { timeout: EMAIL_SEND_TIMEOUT_MS, signal }
  };
  const client = typeof app.locals.gmailOAuthClientFactory === "function"
    ? app.locals.gmailOAuthClientFactory(clientOptions)
    : new OAuth2Client(clientOptions);
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

function encodeMimeBody(value) {
  const encoded = Buffer.from(String(value), "utf8").toString("base64");
  return encoded.match(/.{1,76}/g)?.join("\r\n") || "";
}

function encodeMimeHeader(value) {
  return `=?UTF-8?B?${Buffer.from(String(value), "utf8").toString("base64")}?=`;
}

function isSafeEmailAddress(value) {
  return typeof value === "string"
    && !/[\s<>\r\n]/.test(value)
    && /^[^@]+@[^@]+\.[^@]+$/.test(value);
}

function buildRawEmail({ to, from, subject, text, html, replyTo }) {
  const boundary = `futapulse_${crypto.randomBytes(12).toString("hex")}`;
  const headers = [
    `To: ${to}`,
    `From: FUTApulse <${from}>`,
    `Subject: ${encodeMimeHeader(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`
  ];
  if (replyTo) headers.splice(2, 0, `Reply-To: ${replyTo}`);
  const mime = [
    ...headers,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    encodeMimeBody(text),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    encodeMimeBody(html),
    `--${boundary}--`,
    ""
  ].join("\r\n");
  return Buffer.from(mime, "utf8").toString("base64url");
}

function safeProviderError(error) {
  const details = getGmailProviderDetails(error);
  let message = details.message
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
  for (const secret of [process.env.GOOGLE_CLIENT_SECRET, process.env.GMAIL_REFRESH_TOKEN]) {
    if (secret && secret.length > 4) message = message.replaceAll(secret, "[redacted]");
  }
  return {
    name: String(error?.name || "Error").slice(0, 80),
    code: details.code,
    reason: details.reason,
    statusCode: details.statusCode,
    message: message.slice(0, 300)
  };
}

function getGmailProviderDetails(error) {
  const providerError = error?.response?.data?.error
    || error?.cause?.response?.data?.error
    || error?.providerError
    || null;
  const providerErrors = Array.isArray(providerError?.errors) ? providerError.errors : [];
  return {
    statusCode: Number.isInteger(error?.statusCode)
      ? error.statusCode
      : Number.isInteger(error?.response?.status)
        ? error.response.status
        : Number.isInteger(error?.cause?.response?.status) ? error.cause.response.status : null,
    code: String(typeof providerError === "string"
      ? providerError
      : providerError?.status || providerError?.code || error?.code || "").slice(0, 80),
    reason: String(providerErrors[0]?.reason || error?.providerReason || "").slice(0, 80),
    message: String(providerError?.message
      || providerError?.error_description
      || error?.message
      || "No provider message.").slice(0, 500)
  };
}

function gmailDeliveryErrorMessage(error) {
  const details = getGmailProviderDetails(error);
  const code = details.code.toLowerCase();
  const reason = details.reason.toLowerCase();
  if (code === "invalid_grant" || /invalid_grant/i.test(details.message)) {
    return "Google rejected GMAIL_REFRESH_TOKEN (invalid_grant). Re-authorize the sender account with the gmail.send scope and replace the refresh token in Render.";
  }
  if (reason === "accessnotconfigured" || code === "accessnotconfigured") {
    return "Gmail API is not enabled for the Google Cloud project used by GOOGLE_CLIENT_ID. Enable Gmail API in that same project and redeploy.";
  }
  if (reason === "insufficientpermissions" || code === "insufficientpermissions") {
    return "The Gmail authorization lacks the gmail.send permission. Create a new refresh token for https://www.googleapis.com/auth/gmail.send and update Render.";
  }
  if (reason === "domainpolicy" || code === "domainpolicy") {
    return "The sender account's Google Workspace policy blocks Gmail API access. Use an allowed sender account or ask its administrator to permit Gmail API.";
  }
  if (details.statusCode === 401) {
    return "Google rejected the Gmail access token. Re-authorize the sender account and update GMAIL_REFRESH_TOKEN in Render.";
  }
  if (details.statusCode === 429 || details.statusCode === 403 && /rate|limit/i.test(`${code} ${reason} ${details.message}`)) {
    return "Gmail has temporarily limited this sender or project. Check Gmail sending limits and Google API quotas before retrying.";
  }
  if (details.statusCode) {
    return `Gmail API rejected the verification email (HTTP ${details.statusCode}). Check Render logs for the sanitized Google error details.`;
  }
  return "Gmail API email delivery failed or timed out. Check the OAuth refresh token, Gmail API access, and sender-account configuration.";
}

function isEmailDeliveryConfigured() {
  const sender = String(process.env.GMAIL_SENDER_EMAIL || "").trim();
  return typeof app.locals.emailSender === "function"
    || Boolean(
      String(process.env.GOOGLE_CLIENT_ID || "").trim()
      && String(process.env.GOOGLE_CLIENT_SECRET || "").trim()
      && String(process.env.GMAIL_REFRESH_TOKEN || "").trim()
      && isSafeEmailAddress(sender)
    );
}

async function deliverEmail({ to, subject, text, replyTo }) {
  if (typeof app.locals.emailSender === "function") {
    await app.locals.emailSender({ to, subject, text });
    return;
  }

  const toEmail = String(to || "").trim();
  const replyToEmail = replyTo ? String(replyTo).trim() : "";
  if (!isSafeEmailAddress(toEmail) || !subject || !text || (replyTo && !isSafeEmailAddress(replyToEmail))) {
    throw new Error("Email delivery requires a recipient, subject, and message.");
  }

  const from = String(process.env.GMAIL_SENDER_EMAIL || "").trim();
  if (!isEmailDeliveryConfigured()) {
    const error = new Error("Email delivery is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, and a valid GMAIL_SENDER_EMAIL on the server.");
    error.code = "EMAIL_NOT_CONFIGURED";
    throw error;
  }
  try {
    const timeoutSignal = AbortSignal.timeout(EMAIL_SEND_TIMEOUT_MS);
    const oauthClient = createGmailOAuthClient(timeoutSignal);
    const tokenResult = await oauthClient.getAccessToken();
    const accessToken = typeof tokenResult === "string" ? tokenResult : tokenResult?.token;
    if (!accessToken) {
      const error = new Error("Google OAuth did not return a Gmail API access token.");
      error.code = "EMAIL_DELIVERY_FAILED";
      throw error;
    }
    const html = `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033"><p>${escapeHtml(text).replace(/\r?\n/g, "<br>")}</p></div>`;
    const fetcher = app.locals.gmailApiFetch || fetch;
    const response = await fetcher("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ raw: buildRawEmail({ to: toEmail, from, subject, text, html, replyTo: replyToEmail }) }),
      signal: timeoutSignal
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const providerError = result.error || {};
      const error = new Error(providerError.message || `Gmail API rejected the message (${response.status}).`);
      error.code = "EMAIL_DELIVERY_FAILED";
      error.statusCode = response.status;
      error.providerError = providerError;
      throw error;
    }
    if (!result.id) {
      const error = new Error("Gmail API did not confirm that the message was accepted.");
      error.code = "EMAIL_DELIVERY_FAILED";
      throw error;
    }
  } catch (cause) {
    console.error("Gmail API email delivery failed.", safeProviderError(cause?.cause || cause));
    if (cause && cause.code === "EMAIL_DELIVERY_FAILED") {
      const error = new Error(gmailDeliveryErrorMessage(cause));
      error.code = "EMAIL_DELIVERY_FAILED";
      error.statusCode = cause.statusCode;
      throw error;
    }
    const error = new Error(gmailDeliveryErrorMessage(cause), { cause });
    error.code = "EMAIL_DELIVERY_FAILED";
    throw error;
  }
}

async function saveEmailChallenge({ email, purpose, codeHash, expiresAt, payload = {} }) {
  if (isMongoConnected()) {
    await EmailChallenge.findOneAndUpdate(
      { email, purpose },
      { email, purpose, codeHash, expiresAt, payload, attempts: 0 },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).exec();
    return;
  }
  const database = readDatabase();
  const challenges = Array.isArray(database.emailChallenges) ? database.emailChallenges : [];
  database.emailChallenges = challenges.filter((item) => item.email !== email || item.purpose !== purpose);
  database.emailChallenges.push({
    id: crypto.randomUUID(),
    email,
    purpose,
    codeHash,
    expiresAt: expiresAt.toISOString(),
    attempts: 0,
    payload
  });
  writeDatabase(database);
}

async function findEmailChallenge(email, purpose) {
  if (isMongoConnected()) {
    return EmailChallenge.findOne({ email, purpose, expiresAt: { $gt: new Date() } }).exec();
  }
  return (readDatabase().emailChallenges || []).find((item) =>
    item.email === email && item.purpose === purpose && new Date(item.expiresAt).getTime() > Date.now()
  ) || null;
}

async function updateEmailChallenge(challenge, update) {
  if (isMongoConnected()) {
    Object.assign(challenge, update);
    await challenge.save();
    return;
  }
  const database = readDatabase();
  const index = (database.emailChallenges || []).findIndex((item) => item.id === challenge.id);
  if (index < 0) return;
  database.emailChallenges[index] = { ...database.emailChallenges[index], ...update };
  writeDatabase(database);
}

async function deleteEmailChallenge(email, purpose) {
  if (isMongoConnected()) {
    await EmailChallenge.deleteOne({ email, purpose }).exec();
    return;
  }
  const database = readDatabase();
  database.emailChallenges = (database.emailChallenges || []).filter((item) => item.email !== email || item.purpose !== purpose);
  writeDatabase(database);
}

function hashVerificationCode(code) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

async function issueEmailChallenge(email, purpose, payload = {}) {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  await saveEmailChallenge({
    email,
    purpose,
    codeHash: hashVerificationCode(code),
    expiresAt: new Date(Date.now() + EMAIL_CHALLENGE_TTL),
    payload
  });
  try {
    const subject = purpose === "password-reset" ? "Reset your FUTApulse password"
      : purpose === "signup" ? "Verify your FUTApulse email"
        : purpose === "email-change" ? "Confirm your new FUTApulse email"
          : "FUTApulse feedback";
    await deliverEmail({
      to: email,
      subject,
      text: `Your FUTApulse verification code is ${code}. It expires in 15 minutes. If you did not request this, you can ignore this email.`
    });
  } catch (error) {
    await deleteEmailChallenge(email, purpose);
    throw error;
  }
}

function isValidEmailCode(challenge, code) {
  if (!challenge || Number(challenge.attempts) >= 5 || !/^\d{6}$/.test(code)) return false;
  const suppliedHash = Buffer.from(hashVerificationCode(code), "hex");
  const expectedHash = Buffer.from(challenge.codeHash, "hex");
  return suppliedHash.length === expectedHash.length && crypto.timingSafeEqual(suppliedHash, expectedHash);
}

async function findUserByUsername(username) {
  const normalizedUsername = normalizeUsername(username);
  if (isMongoConnected()) {
    try {
      return await User.findOne({ username: normalizedUsername }).exec();
    } catch (error) {
      if (isMongoConnected()) throw error;
      console.warn(`MongoDB disconnected during username lookup; using local fallback: ${error.message}`);
    }
  }
  return readDatabase().users.find((user) => normalizeUsername(user.username) === normalizedUsername) || null;
}

async function findUserByEmail(email) {
  if (isMongoConnected()) {
    try {
      return await User.findOne({ email: email.toLowerCase() }).exec();
    } catch (error) {
      if (isMongoConnected()) throw error;
      console.warn(`MongoDB disconnected during email lookup; using local fallback: ${error.message}`);
    }
  }
  return readDatabase().users.find((user) => user.email === email.toLowerCase()) || null;
}

async function findUserByResetTokenHash(tokenHash) {
  if (isMongoConnected()) {
    try {
      return await User.findOne({
        passwordResetTokenHash: tokenHash,
        passwordResetExpires: { $gt: new Date() }
      }).exec();
    } catch (error) {
      if (isMongoConnected()) throw error;
      console.warn(`MongoDB disconnected during password reset lookup; using local fallback: ${error.message}`);
    }
  }
  return readDatabase().users.find((user) =>
    user.passwordResetTokenHash === tokenHash
    && new Date(user.passwordResetExpires).getTime() > Date.now()
  ) || null;
}

async function findMongoUserById(id) {
  // Local development accounts historically used UUIDs, while MongoDB's User
  // model uses ObjectIds. Old local access/refresh tokens can still contain a
  // UUID after the API is switched to Atlas; treat those tokens as expired
  // instead of letting Mongoose throw a CastError and return a 500.
  if (!mongoose.isValidObjectId(id)) return null;
  return User.findById(id).exec();
}

async function getAuthenticatedUser(request) {
  const authorization = request.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return null;
  const claims = jwt.verify(token, JWT_SECRET);
  if (claims.tokenUse !== "access") return null;
  const user = isMongoConnected()
    ? await findMongoUserById(claims.sub)
    : readDatabase().users.find((item) => item.id === claims.sub) || null;
  if (!user || (claims.sessionVersion || 0) !== (user.sessionVersion || 0)) return null;
  return user;
}

async function createUser(user) {
  const normalizedUser = { ...user, username: normalizeUsername(user.username) };
  if (isMongoConnected()) {
    try {
      return await User.create(normalizedUser);
    } catch (error) {
      if (isMongoConnected() || error.code === 11000) throw error;
      console.warn(`MongoDB disconnected while saving an account; using local fallback: ${error.message}`);
    }
  }
  const database = readDatabase();
  const duplicateUsername = database.users.some((stored) => normalizeUsername(stored.username) === normalizedUser.username);
  const duplicateEmail = database.users.some((stored) => stored.email === normalizedUser.email);
  if (duplicateUsername || duplicateEmail) {
    const error = new Error("An account with that username or email already exists.");
    error.code = 11000;
    error.keyPattern = duplicateUsername ? { username: 1 } : { email: 1 };
    throw error;
  }
  const fallbackUser = { ...normalizedUser, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
  database.users.push(fallbackUser);
  writeDatabase(database);
  return fallbackUser;
}

const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

app.disable("x-powered-by");
app.use(compression());
app.use(cors({
  origin: process.env.CORS_ORIGIN ? CORS_ORIGINS : true,
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-FUTApulse-OAuth-Request"],
  credentials: true
}));
app.use(express.json({ limit: "4mb" }));

app.get("/api/health", (request, response) => {
  const missingCloudinaryVariables = getMissingCloudinaryVariables();
  response.json({
    ok: true,
    service: "futapulse-api",
    database: databaseBackend === "mongodb" ? "mongodb" : "local-fallback",
    databaseConnected: isMongoConnected(),
    eventImageStorageConfigured: missingCloudinaryVariables.length === 0,
    socketRedisConfigured: Boolean(process.env.SOCKET_REDIS_URL),
    socketRedisConnected: socketRedisClients.length === 2 && socketRedisClients.every((client) => client.isReady),
    timestamp: new Date().toISOString()
  });
});

app.get("/api/ready", (request, response) => {
  const storageReady = databaseBackend === "mongodb"
    ? isMongoConnected()
    : !process.env.MONGO_URI;
  const ready = storageReady && (process.env.NODE_ENV !== "production" || OPERATIONAL_MONGO_CUTOVER_COMPLETE);
  return response.status(ready ? 200 : 503).json({
    ready,
    database: isMongoConnected() ? "mongodb" : "local-fallback",
    operationalMongoCutover: OPERATIONAL_MONGO_CUTOVER_COMPLETE
  });
});

app.use("/api", (request, response, next) => {
  if (databaseBackend === "mongodb" && !isMongoConnected()) {
    return response.status(503).json({ error: "FUTApulse is temporarily disconnected from its cloud database. Please retry shortly." });
  }
  return next();
});

app.get("/api/config/google", (request, response) => {
  response.json({ configured: Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET), clientId: GOOGLE_CLIENT_ID || null });
});

app.get("/api/notifications/config", (request, response) => {
  const recapUploadMissingVariables = getMissingCloudinaryVariables();
  const vapidConfiguration = getVapidConfiguration();
  response.json({
    durableSchedulingAvailable: isMongoConnected(),
    webPushConfigured: vapidConfiguration.valid,
    webPushPublicKey: vapidConfiguration.valid ? process.env.WEB_PUSH_PUBLIC_KEY.trim() : null,
    webPushConfigurationError: vapidConfiguration.valid ? "" : vapidConfiguration.error,
    eventImageStorageConfigured: recapUploadMissingVariables.length === 0,
    eventImageStorageMissingVariables: recapUploadMissingVariables,
    recapUploadConfigured: recapUploadMissingVariables.length === 0,
    recapUploadMissingVariables
  });
});

app.post("/api/internal/notifications/worker", async (request, response) => {
  const expectedSecret = process.env.CRON_SECRET_KEY || "";
  const providedSecret = request.get("x-cron-secret") || "";
  if (!expectedSecret) {
    return response.status(503).json({ error: "Background notification trigger is not configured." });
  }
  const expectedBuffer = Buffer.from(expectedSecret);
  const providedBuffer = Buffer.from(providedSecret);
  if (expectedBuffer.length !== providedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
    return response.status(401).json({ error: "Background notification trigger is unauthorized." });
  }
  if (!isMongoConnected()) {
    return response.status(503).json({ error: "Durable notification scheduling requires the MongoDB queue." });
  }

  const requestedLimit = Number(request.body?.limit);
  const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, 50)
    : 20;
  try {
    const result = await runNotificationWorker({ limit });
    if (result.failed > 0) {
      return response.status(502).json({ ok: false, ...result, error: "One or more notification jobs exhausted their delivery retries." });
    }
    return response.json({ ok: true, ...result });
  } catch (error) {
    console.error("Background notification trigger failed.", error);
    return response.status(500).json({ error: "Unable to process due notifications." });
  }
});

app.get("/api/notifications/status", async (request, response) => {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return response.status(401).json({ error: "Authentication required." });
    const requestedPlatform = String(request.query.platform || "");
    if (requestedPlatform !== "web") {
      return response.status(400).json({ error: "Notification platform must be web." });
    }
    const userId = String(user._id || user.id);
    const vapidConfiguration = getVapidConfiguration();
    const pushConfigured = vapidConfiguration.valid;
    const requestedDeviceKey = String(request.query.deviceKey || "");
    if (requestedDeviceKey && !/^[a-f0-9]{64}$/.test(requestedDeviceKey)) {
      return response.status(400).json({ error: "Device key must be a SHA-256 hex digest." });
    }
    const deviceRegistered = requestedDeviceKey
      ? isMongoConnected()
        ? Boolean(await PushDevice.exists({
          userId,
          deviceKey: requestedDeviceKey,
          platform: requestedPlatform,
          enabled: true
        }))
        : (readDatabase().pushDevices || []).some((device) =>
          String(device.userId) === userId
          && device.deviceKey === requestedDeviceKey
          && device.platform === requestedPlatform
          && device.enabled === true
        )
      : false;
    return response.json({
      durableSchedulingAvailable: isMongoConnected(),
      pushConfigured,
      pushConfigurationError: pushConfigured ? "" : vapidConfiguration.error,
      deviceRegistered
    });
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return response.status(401).json({ error: "Session is no longer valid." });
    }
    console.error("Notification delivery status could not be loaded.", error);
    return response.status(500).json({ error: "Unable to check notification delivery status." });
  }
});

app.post("/api/notifications/devices/web", async (request, response) => {
  let authenticatedUserId = "";
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return response.status(401).json({ error: "Authentication required." });
    authenticatedUserId = String(user._id || user.id);
    const subscription = request.body?.subscription;
    const endpoint = typeof subscription?.endpoint === "string" ? subscription.endpoint : "";
    let endpointUrl;
    try {
      endpointUrl = new URL(endpoint);
    } catch {
      return response.status(400).json({ error: "A valid browser push subscription is required." });
    }
    if (endpointUrl.protocol !== "https:" || typeof subscription?.keys?.p256dh !== "string" || typeof subscription?.keys?.auth !== "string") {
      return response.status(400).json({ error: "The browser push subscription is incomplete or insecure." });
    }
    const vapidConfiguration = getVapidConfiguration();
    if (!vapidConfiguration.valid) {
      return response.status(503).json({ error: `Web Push is not configured correctly: ${vapidConfiguration.error}` });
    }
    const deviceKey = crypto.createHash("sha256").update(endpoint).digest("hex");
    if (isMongoConnected()) {
      await PushDevice.findOneAndUpdate(
        { deviceKey },
        { $set: {
          userId: authenticatedUserId,
          platform: "web",
          endpoint,
          subscription,
          enabled: true
        } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      ).exec();
    } else {
      const database = readDatabase();
      database.pushDevices = (database.pushDevices || []).filter((device) => device.deviceKey !== deviceKey);
      database.pushDevices.push({
        userId: authenticatedUserId,
        deviceKey,
        platform: "web",
        endpoint,
        subscription,
        enabled: true
      });
      writeDatabase(database);
    }
    return response.status(201).json({ registered: true });
  } catch (error) {
    if (error.code === 11000) {
      const subscription = request.body?.subscription;
      const endpoint = typeof subscription?.endpoint === "string" ? subscription.endpoint : "";
      const deviceKey = endpoint ? crypto.createHash("sha256").update(endpoint).digest("hex") : "";
      if (deviceKey && authenticatedUserId) {
        try {
          const reassigned = await PushDevice.updateOne({ deviceKey }, {
            $set: {
              userId: authenticatedUserId,
              platform: "web",
              endpoint,
              subscription,
              enabled: true
            }
          }).exec();
          if (reassigned.matchedCount > 0) return response.status(201).json({ registered: true });
        } catch (reassignmentError) {
          console.error("Concurrent Web Push device reassignment failed.", reassignmentError);
          return response.status(500).json({ error: "Unable to connect this browser to the signed-in account." });
        }
      }
      return response.status(409).json({ error: "This browser subscription could not be connected to the signed-in account. Please try again." });
    }
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) return response.status(401).json({ error: "Session is no longer valid." });
    console.error("Web push subscription registration failed.", error);
    return response.status(500).json({ error: "Unable to register this browser for notifications." });
  }
});

app.delete("/api/notifications/devices/:deviceKey", async (request, response) => {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return response.status(401).json({ error: "Authentication required." });
    await PushDevice.updateOne({
      deviceKey: String(request.params.deviceKey),
      userId: String(user._id || user.id)
    }, { $set: { enabled: false } }).exec();
    return response.json({ removed: true });
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) return response.status(401).json({ error: "Session is no longer valid." });
    console.error("Push device removal failed.", error);
    return response.status(500).json({ error: "Unable to remove this notification device." });
  }
});

app.patch("/api/notifications/preferences", async (request, response) => {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return response.status(401).json({ error: "Authentication required." });
    const submitted = request.body?.notificationPreferences;
    if (!submitted || typeof submitted !== "object" || Array.isArray(submitted)) {
      return response.status(400).json({ error: "Notification preferences must be an object." });
    }
    if (NOTIFICATION_CATEGORIES.some((category) => submitted[category] !== undefined && typeof submitted[category] !== "boolean")) {
      return response.status(400).json({ error: "Each category preference must be enabled or disabled." });
    }
    const notificationPreferences = {
      ...normalizeNotificationPreferences(user.profile?.notificationPreferences),
      ...Object.fromEntries(NOTIFICATION_CATEGORIES
        .filter((category) => typeof submitted[category] === "boolean")
        .map((category) => [category, submitted[category]]))
    };
    const profile = {
      ...(user.profile || { name: user.username }),
      notificationPreferences,
      notificationPreferencesOnboardingComplete: true
    };
    if (isMongoConnected()) {
      user.profile = profile;
      await user.save();
    } else {
      const database = readDatabase();
      const storedUser = database.users.find((item) => item.id === user.id);
      if (!storedUser) return response.status(401).json({ error: "Session is no longer valid." });
      storedUser.profile = profile;
      writeDatabase(database);
    }
    return response.json({ notificationPreferences, notificationPreferencesOnboardingComplete: true });
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return response.status(401).json({ error: "Session is no longer valid." });
    }
    console.error("Notification preferences update failed.", error);
    return response.status(500).json({ error: "Unable to save notification preferences right now." });
  }
});

app.post("/api/auth/username-availability", async (request, response) => {
  const displayName = typeof request.body?.username === "string" ? request.body.username.trim() : "";
  if (!isValidUsername(displayName)) {
    return response.status(400).json({
      valid: false,
      available: false,
      message: "Use 3â€“24 characters with at least one letter. Accents and letters from any language are supported."
    });
  }
  try {
    const existingUser = await findUserByUsername(normalizeUsername(displayName));
    return response.json({ valid: true, available: !existingUser });
  } catch (error) {
    console.error("Username availability check failed.", error);
    return response.status(503).json({ error: "Username availability could not be checked. Please retry." });
  }
});

app.get(["/api/auth/session", "/api/auth/verify"], async (request, response) => {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return response.status(401).json({ error: "Session is no longer valid." });
    return response.json({ user: normalizeUser(user) });
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return response.status(401).json({ error: "Session is no longer valid." });
    }
    console.error("Session validation failed.", error);
    return response.status(500).json({ error: "Unable to validate the session." });
  }
});

app.post("/api/auth/refresh", async (request, response) => {
  const refreshToken = getRefreshCookie(request);
  if (!refreshToken) return response.status(401).json({ error: "No remembered session was found." });
  try {
    const claims = jwt.verify(refreshToken, JWT_SECRET);
    if (claims.tokenUse !== "refresh") return response.status(401).json({ error: "Session is no longer valid." });
    const user = isMongoConnected()
      ? await findMongoUserById(claims.sub)
      : readDatabase().users.find((item) => item.id === claims.sub) || null;
    if (!user || (claims.sessionVersion || 0) !== (user.sessionVersion || 0)) {
      clearRefreshCookie(response);
      return response.status(401).json({ error: "Session is no longer valid." });
    }
    const session = sendSession(response, user, claims.persistent === true);
    return response.json(session);
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      clearRefreshCookie(response);
      return response.status(401).json({ error: "Session is no longer valid." });
    }
    console.error("Session refresh failed.", error);
    return response.status(500).json({ error: "Unable to restore your session right now." });
  }
});

app.post("/api/auth/logout", (request, response) => {
  clearRefreshCookie(response);
  return response.json({ message: "You have been logged out." });
});

app.post("/api/profile/setup", async (request, response) => {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return response.status(401).json({ error: "Authentication required." });
    const body = request.body || {};
    const faculty = typeof body.faculty === "string" ? body.faculty.trim() : "";
    const department = typeof body.department === "string" ? body.department.trim() : "";
    const level = typeof body.level === "string" ? body.level.trim() : "";
    const role = typeof body.role === "string" ? body.role.trim() : "explorer";
    const submittedName = typeof body.username === "string" ? body.username.trim() : "";
    const requestedUsername = normalizeUsername(submittedName || user.username);
    const displayName = typeof body.displayName === "string" && body.displayName.trim()
      ? body.displayName.trim()
      : submittedName || user.profile?.name || user.username;
    if (!isValidUsername(displayName) || !isValidUsername(requestedUsername)) {
      return response.status(400).json({ error: "Use 3â€“24 characters with at least one letter. Accents and letters from any language are supported." });
    }
    const usernameChanges = Number(user.usernameChanges) || 0;
    const usernameChanged = requestedUsername !== user.username;
    const profileAlreadyComplete = Boolean(user.profile?.faculty && user.profile?.department && user.profile?.level);
    const displayNameChanged = profileAlreadyComplete && displayName !== (user.profile?.name || user.username);
    const identityChanged = usernameChanged || displayNameChanged;
    if (identityChanged && usernameChanges >= 2) {
      return response.status(403).json({ error: "Your username has reached its two-change limit." });
    }
    if (usernameChanged) {
      const existingUsername = await findUserByUsername(requestedUsername);
      if (existingUsername && String(existingUsername._id || existingUsername.id) !== String(user._id || user.id)) {
        return response.status(409).json({ error: "That username is already taken." });
      }
    }
    const profile = {
      name: displayName,
      faculty,
      department,
      level,
      role: "explorer",
      picture: typeof body.picture === "string" ? body.picture : "",
      communityGuidelinesAcceptedAt: user.profile?.communityGuidelinesAcceptedAt || null,
      notificationPreferences: normalizeNotificationPreferences(user.profile?.notificationPreferences),
      notificationPreferencesOnboardingComplete: user.profile?.notificationPreferencesOnboardingComplete === true
    };
    if (!validateProfile(profile)) {
      return response.status(400).json({ error: "Complete your faculty, department, level, and role." });
    }

    if (isMongoConnected()) {
      user.profile = profile;
      if (usernameChanged) {
        user.username = requestedUsername;
      }
      if (identityChanged) user.usernameChanges = usernameChanges + 1;
      await user.save();
    } else {
      const database = readDatabase();
      const storedUser = database.users.find((item) => item.id === user.id);
      if (!storedUser) return response.status(401).json({ error: "Session is no longer valid." });
      storedUser.profile = profile;
      if (usernameChanged) {
        storedUser.username = requestedUsername;
      }
      if (identityChanged) storedUser.usernameChanges = usernameChanges + 1;
      writeDatabase(database);
    }
    return response.status(200).json({
      user: normalizeUser({
        ...user.toObject?.(),
        id: user.id,
        username: requestedUsername,
        usernameChanges: usernameChanges + Number(identityChanged),
        profile
      })
    });
  } catch (error) {
    if (error.code === 11000) return response.status(409).json({ error: "That username is already taken." });
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return response.status(401).json({ error: "Session is no longer valid." });
    }
    console.error("Profile onboarding failed.", error);
    return response.status(500).json({ error: "Unable to save your profile right now." });
  }
});

app.patch("/api/auth/profile", async (request, response) => {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return response.status(401).json({ error: "Authentication required." });
    const profile = request.body?.profile;
    if (!profile) {
      return response.status(400).json({ error: "Complete all required profile fields before saving." });
    }
    const submittedName = typeof request.body?.username === "string"
      ? request.body.username.trim()
      : user.profile?.name || user.username;
    const requestedUsername = normalizeUsername(submittedName);
    const displayName = typeof profile.name === "string" && profile.name.trim()
      ? profile.name.trim()
      : submittedName;
    if (!isValidUsername(displayName) || !isValidUsername(requestedUsername)) {
      return response.status(400).json({ error: "Use 3â€“24 characters with at least one letter. Accents and letters from any language are supported." });
    }
    const profileWithUsername = { ...profile, name: displayName };
    if (!validateProfile(profileWithUsername)) {
      return response.status(400).json({ error: "Complete your faculty, department, level, and role before saving." });
    }
    const usernameChanges = Number(user.usernameChanges) || 0;
    const facultyChanges = Number(user.facultyChanges) || 0;
    const usernameChanged = requestedUsername !== user.username;
    const displayNameChanged = displayName !== (user.profile?.name || user.username);
    const identityChanged = usernameChanged || displayNameChanged;
    const facultyChanged = Boolean(user.profile?.faculty) && profileWithUsername.faculty.trim() !== user.profile.faculty;
    if (identityChanged && usernameChanges >= 2) {
      return response.status(403).json({ error: "Your username has reached its two-change limit." });
    }
    if (facultyChanged && facultyChanges >= 2) {
      return response.status(403).json({ error: "Your faculty has reached its two-change limit." });
    }
    if (usernameChanged) {
      const existingUsername = await findUserByUsername(requestedUsername);
      if (existingUsername && String(existingUsername._id || existingUsername.id) !== String(user._id || user.id)) {
        return response.status(409).json({ error: "That username is already taken." });
      }
    }
    const savedProfile = {
      name: displayName,
      faculty: profileWithUsername.faculty.trim(),
      department: profileWithUsername.department.trim(),
      level: profileWithUsername.level.trim(),
      role: "explorer",
      picture: typeof profileWithUsername.picture === "string" ? profileWithUsername.picture : "",
      communityGuidelinesAcceptedAt: user.profile?.communityGuidelinesAcceptedAt || null,
      notificationPreferences: normalizeNotificationPreferences(user.profile?.notificationPreferences),
      notificationPreferencesOnboardingComplete: user.profile?.notificationPreferencesOnboardingComplete === true
    };
    if (isMongoConnected()) {
      user.profile = savedProfile;
      if (usernameChanged) {
        user.username = requestedUsername;
      }
      if (identityChanged) user.usernameChanges = usernameChanges + 1;
      if (facultyChanged) user.facultyChanges = facultyChanges + 1;
      await user.save();
    } else {
      const database = readDatabase();
      const storedUser = database.users.find((item) => item.id === user.id);
      if (!storedUser) return response.status(401).json({ error: "Session is no longer valid." });
      storedUser.profile = savedProfile;
      if (usernameChanged) {
        storedUser.username = requestedUsername;
      }
      if (identityChanged) storedUser.usernameChanges = usernameChanges + 1;
      if (facultyChanged) storedUser.facultyChanges = facultyChanges + 1;
      writeDatabase(database);
    }
    return response.json({
      user: {
        id: String(user._id || user.id),
        email: user.email,
        username: requestedUsername,
        profile: savedProfile,
        editableFields: {
          usernameChanges: usernameChanges + Number(identityChanged),
          facultyChanges: facultyChanges + Number(facultyChanged)
        }
      }
    });
  } catch (error) {
    if (error.code === 11000) return response.status(409).json({ error: "That username is already taken." });
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return response.status(401).json({ error: "Session is no longer valid." });
    }
    console.error("Profile update failed.", error);
    return response.status(500).json({ error: "Unable to save the profile right now." });
  }
});

app.post("/api/auth/change-email", async (request, response) => {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return response.status(401).json({ error: "Authentication required." });
    const email = typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : "";
    const currentPassword = typeof request.body?.currentPassword === "string" ? request.body.currentPassword : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return response.status(400).json({ error: "Enter a valid new email address." });
    }
    if (email === user.email) return response.status(400).json({ error: "That is already your account email." });
    if (user.passwordHash && !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      return response.status(401).json({ error: "Your current password is incorrect." });
    }
    const existingUser = await findUserByEmail(email);
    if (existingUser && String(existingUser._id || existingUser.id) !== String(user._id || user.id)) {
      return response.status(409).json({ error: "An account with that email already exists." });
    }
    await issueEmailChallenge(email, "email-change", { userId: String(user._id || user.id) });
    return response.status(202).json({ message: "A verification code was sent to your new email. Confirm it to update your account email." });
  } catch (error) {
    if (error.code === 11000) return response.status(409).json({ error: "An account with that email already exists." });
    if (error.code === "EMAIL_NOT_CONFIGURED") return response.status(503).json({ error: error.message });
    if (error.code === "EMAIL_DELIVERY_FAILED") return response.status(502).json({ error: error.message });
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return response.status(401).json({ error: "Session is no longer valid." });
    }
    console.error("Email verification request failed.", error);
    return response.status(500).json({ error: "Unable to send the email verification code right now." });
  }
});

app.post("/api/auth/change-email/confirm", async (request, response) => {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return response.status(401).json({ error: "Authentication required." });
    const email = typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : "";
    const code = typeof request.body?.code === "string" ? request.body.code.trim() : "";
    const challenge = await findEmailChallenge(email, "email-change");
    if (!challenge || challenge.payload?.userId !== String(user._id || user.id) || !isValidEmailCode(challenge, code)) {
      if (challenge) await updateEmailChallenge(challenge, { attempts: (Number(challenge.attempts) || 0) + 1 });
      return response.status(400).json({ error: "That email verification code is invalid or expired." });
    }
    const duplicate = await findUserByEmail(email);
    if (duplicate && String(duplicate._id || duplicate.id) !== String(user._id || user.id)) {
      return response.status(409).json({ error: "An account with that email already exists." });
    }
    user.email = email;
    user.emailVerified = true;
    user.sessionVersion = (user.sessionVersion || 0) + 1;
    if (isMongoConnected()) {
      await user.save();
    } else {
      const database = readDatabase();
      const storedUser = database.users.find((item) => item.id === user.id);
      if (!storedUser) return response.status(401).json({ error: "Session is no longer valid." });
      storedUser.email = email;
      storedUser.emailVerified = true;
      storedUser.sessionVersion = user.sessionVersion;
      writeDatabase(database);
    }
    await deleteEmailChallenge(email, "email-change");
    return response.json({ ...sendSession(response, user, refreshSessionIsPersistent(request)), message: "Email verified and updated successfully." });
  } catch (error) {
    if (error.code === 11000) return response.status(409).json({ error: "An account with that email already exists." });
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return response.status(401).json({ error: "Session is no longer valid." });
    }
    console.error("Email change confirmation failed.", error);
    return response.status(500).json({ error: "Unable to update the email right now." });
  }
});

app.post("/api/auth/change-password", async (request, response) => {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return response.status(401).json({ error: "Authentication required." });
    const currentPassword = typeof request.body?.currentPassword === "string" ? request.body.currentPassword : "";
    const newPassword = typeof request.body?.newPassword === "string" ? request.body.newPassword : "";
    if (!isValidNewPassword(newPassword)) {
      return response.status(400).json({ error: "Use more than 6 characters, at least one uppercase letter, and at least one number." });
    }
    if (user.passwordHash && !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      return response.status(401).json({ error: "Your current password is incorrect." });
    }
    const passwordHash = await bcrypt.hash(newPassword, 12);
    if (isMongoConnected()) {
      user.passwordHash = passwordHash;
      user.sessionVersion = (user.sessionVersion || 0) + 1;
      await user.save();
    } else {
      const database = readDatabase();
      const storedUser = database.users.find((item) => item.id === user.id);
      if (!storedUser) return response.status(401).json({ error: "Session is no longer valid." });
      storedUser.passwordHash = passwordHash;
      storedUser.sessionVersion = (storedUser.sessionVersion || 0) + 1;
      user.sessionVersion = storedUser.sessionVersion;
      writeDatabase(database);
    }
    const remember = refreshSessionIsPersistent(request);
    return response.json({ ...sendSession(response, user, remember), message: "Password updated successfully." });
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return response.status(401).json({ error: "Session is no longer valid." });
    }
    console.error("Password change failed.", error);
    return response.status(500).json({ error: "Unable to change the password right now." });
  }
});

app.delete("/api/auth/account", async (request, response) => {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return response.status(401).json({ error: "Authentication required." });
    const password = typeof request.body?.password === "string" ? request.body.password : "";
    const confirmation = typeof request.body?.confirmation === "string" ? request.body.confirmation : "";
    if (confirmation !== "DELETE") return response.status(400).json({ error: "Type DELETE to confirm account deletion." });
    if (user.passwordHash && !(await bcrypt.compare(password, user.passwordHash))) {
      return response.status(401).json({ error: "Your password is incorrect." });
    }
    await deleteStoredEventsForOwner(user._id || user.id);
    if (isMongoConnected()) {
      const userId = String(user._id || user.id);
      await Promise.all([
        PushDevice.deleteMany({ userId }).exec(),
        NotificationJob.deleteMany({ recipientUserId: userId }).exec()
      ]);
      await User.deleteOne({ _id: user._id }).exec();
    } else {
      const database = readDatabase();
      database.users = database.users.filter((item) => item.id !== user.id);
      database.profiles = database.profiles.filter((item) => item.userId !== user.id);
      database.pushDevices = (database.pushDevices || []).filter((item) => String(item.userId) !== String(user.id));
      database.notificationJobs = (database.notificationJobs || []).filter((item) => String(item.recipientUserId) !== String(user.id));
      database.engagementActions = (database.engagementActions || []).filter((item) => String(item.userId) !== String(user.id));
      writeDatabase(database);
    }
    clearRefreshCookie(response);
    return response.json({ message: "Your account has been deleted." });
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return response.status(401).json({ error: "Session is no longer valid." });
    }
    console.error("Account deletion failed.", error);
    return response.status(500).json({ error: "Unable to delete the account right now." });
  }
});

app.post("/api/auth/guidelines/accept", async (request, response) => {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return response.status(401).json({ error: "Sign in before confirming the community guidelines." });
    const profile = { ...(user.profile || {}), communityGuidelinesAcceptedAt: new Date().toISOString() };
    if (!validateProfile(profile)) return response.status(403).json({ error: "Complete your campus profile first." });
    if (isMongoConnected()) {
      user.profile = profile;
      await user.save();
    } else {
      const database = readDatabase();
      const storedUser = database.users.find((item) => item.id === user.id);
      if (!storedUser) return response.status(401).json({ error: "Session is no longer valid." });
      storedUser.profile = profile;
      writeDatabase(database);
    }
    return response.json({ profile });
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) return response.status(401).json({ error: "Your session is no longer valid. Sign in again." });
    console.error("Community guideline acknowledgment failed.", error);
    return response.status(500).json({ error: "Unable to save your guideline acknowledgment." });
  }
});

app.post("/api/feedback", async (request, response) => {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return response.status(401).json({ error: "Sign in before sending feedback." });
    const type = request.body?.type === "feature" ? "feature" : "bug";
    const category = typeof request.body?.category === "string" ? request.body.category.trim().slice(0, 80) : "";
    const description = typeof request.body?.description === "string" ? request.body.description.trim() : "";
    if (description.length < 5 || description.length > 2000) {
      return response.status(400).json({ error: "Feedback must contain between 5 and 2,000 characters." });
    }
    await deliverEmail({
      to: FEEDBACK_EMAIL,
      replyTo: user.email,
      subject: `FUTApulse ${type === "bug" ? "bug report" : "feature suggestion"} from ${user.username}`,
      text: [
        `Type: ${type}`,
        category ? `Category: ${category}` : "",
        `Account: ${user.username} (${user.email})`,
        "",
        description
      ].filter(Boolean).join("\n")
    });
    return response.status(202).json({ message: "Your feedback was emailed to the FUTApulse team. Thank you." });
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return response.status(401).json({ error: "Your session expired. Sign in again to send feedback." });
    }
    if (error.code === "EMAIL_NOT_CONFIGURED") return response.status(503).json({ error: error.message });
    console.error("Feedback email delivery failed.", error);
    return response.status(502).json({ error: "Feedback could not be emailed. Please retry when the mail service is available." });
  }
});

app.post("/api/auth/signup", async (request, response) => {
  const body = request.body || {};
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const displayName = typeof body.username === "string" ? body.username.trim() : "";
  const username = normalizeUsername(displayName);
  const password = typeof body.password === "string" ? body.password : "";
  const remember = body.remember === true;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response.status(400).json({ error: "Enter a valid email address." });
  if (!isValidUsername(displayName)) return response.status(400).json({ error: "Use 3â€“24 characters with at least one letter. Accents and letters from any language are supported." });
  if (!isValidNewPassword(password)) return response.status(400).json({ error: "Use more than 6 characters, at least one uppercase letter, and at least one number." });

  try {
    if (await findUserByUsername(username)) return response.status(409).json({ error: "Username already taken." });
    if (await findUserByEmail(email)) return response.status(409).json({ error: "Email already registered." });
    const passwordHash = await bcrypt.hash(password, 12);
    await issueEmailChallenge(email, "signup", { username, displayName, passwordHash, remember });
    return response.status(202).json({ verificationRequired: true, message: "A verification code was sent to the email address. Enter it to finish creating your account." });
  } catch (error) {
    if (error.code === 11000) return response.status(409).json({ error: "That email or username is already registered." });
    if (error.code === "EMAIL_NOT_CONFIGURED") return response.status(503).json({ error: error.message });
    if (error.code === "EMAIL_DELIVERY_FAILED") return response.status(502).json({ error: error.message });
    console.error("Signup verification request failed.", error);
    return response.status(500).json({ error: "Unable to send the account verification code right now." });
  }
});

app.post("/api/auth/signup/verify", async (request, response) => {
  const email = typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : "";
  const code = typeof request.body?.code === "string" ? request.body.code.trim() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\d{6}$/.test(code)) {
    return response.status(400).json({ error: "Enter the email address and six-digit verification code." });
  }
  try {
    const challenge = await findEmailChallenge(email, "signup");
    if (!isValidEmailCode(challenge, code)) {
      if (challenge) await updateEmailChallenge(challenge, { attempts: (Number(challenge.attempts) || 0) + 1 });
      return response.status(400).json({ error: "That verification code is invalid, expired, or has used all attempts." });
    }
    if (await findUserByEmail(email)) {
      await deleteEmailChallenge(email, "signup");
      return response.status(409).json({ error: "An account already uses that email address. Try logging in." });
    }
    const { username, passwordHash, remember } = challenge.payload || {};
    const displayName = typeof challenge.payload?.displayName === "string"
      ? challenge.payload.displayName
      : username;
    if (!isValidUsername(username || "") || !isValidUsername(displayName || "") || !passwordHash) {
      await deleteEmailChallenge(email, "signup");
      return response.status(400).json({ error: "The signup request expired. Please create your account again." });
    }
    const user = await createUser({
      email,
      emailVerified: true,
      username,
      passwordHash,
      emailVerified: true,
      profile: { name: displayName, faculty: "", department: "", level: "", role: "explorer" }
    });
    await deleteEmailChallenge(email, "signup");
    return response.status(201).json(sendSession(response, user, remember === true));
  } catch (error) {
    if (error.code === 11000) {
      if (error.keyPattern?.username) return response.status(409).json({ error: "Username already taken." });
      if (error.keyPattern?.email) return response.status(409).json({ error: "Email already registered." });
      return response.status(409).json({ error: "Username or email already registered." });
    }
    console.error("Signup verification failed.", error);
    return response.status(500).json({ error: "Unable to verify and create the account right now." });
  }
});

app.post("/api/auth/login", async (request, response) => {
  const body = request.body || {};
  const username = normalizeUsername(body.username);
  const password = typeof body.password === "string" ? body.password : "";
  const remember = body.remember === true;
  if (!username || !password) return response.status(400).json({ error: "Username and password are required." });
  if (password.length < 6) return response.status(400).json({ error: "Password must be at least 6 characters." });

  try {
    const user = await findUserByUsername(username);
    if (!user) {
      return response.status(404).json({ error: "No account was found with that username. Create an account to join FUTApulse." });
    }
    if (!user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
      return response.status(401).json({ error: "Incorrect password. Check your password and try again." });
    }
    await advanceUserSessionVersion(user);
    return response.json(sendSession(response, user, remember));
  } catch (error) {
    console.error("Login failed.", error);
    return response.status(500).json({ error: "Unable to sign in right now." });
  }
});

app.post("/api/auth/forgot-password", async (request, response) => {
  const email = typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return response.status(400).json({ error: "Enter a valid email address." });
  }

  try {
    if (!isEmailDeliveryConfigured()) {
      return response.status(503).json({ error: "Password recovery email is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, and GMAIL_SENDER_EMAIL on the server." });
    }
    const user = await findUserByEmail(email);
    if (user) {
      await issueEmailChallenge(user.email, "password-reset", { userId: String(user._id || user.id) });
    }
    return response.json({ message: "If an account exists for that email, a password reset code has been sent to its registered email address." });
  } catch (error) {
    if (error.code === "EMAIL_DELIVERY_FAILED") return response.status(502).json({ error: error.message });
    console.error("Password recovery request failed.", error);
    return response.status(500).json({ error: "Unable to request password recovery right now." });
  }
});

app.post("/api/auth/password-reset/verify-code", async (request, response) => {
  const email = typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : "";
  const code = typeof request.body?.code === "string" ? request.body.code.trim() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\d{6}$/.test(code)) {
    return response.status(400).json({ error: "Enter a valid email address and six-digit reset code." });
  }

  try {
    const user = await findUserByEmail(email);
    const challenge = await findEmailChallenge(email, "password-reset");
    const valid = Boolean(user && challenge
      && challenge.payload?.userId === String(user._id || user.id)
      && isValidEmailCode(challenge, code));
    if (!valid && challenge && Number(challenge.attempts) < 5) {
      await updateEmailChallenge(challenge, { attempts: (Number(challenge.attempts) || 0) + 1 });
    }
    return response.json({
      valid,
      message: valid ? "Code confirmed. Choose a new password." : "That code is invalid, expired, or unavailable.",
    });
  } catch (error) {
    console.error("Password reset code verification failed.", error);
    return response.status(500).json({ error: "Unable to verify the reset code right now." });
  }
});

app.post("/api/auth/reset-password", async (request, response) => {
  const email = typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : "";
  const code = typeof request.body?.code === "string" ? request.body.code.trim() : "";
  const password = typeof request.body?.password === "string" ? request.body.password : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\d{6}$/.test(code)) {
    return response.status(400).json({ error: "A valid registered email address and six-digit reset code are required." });
  }
  if (!isValidNewPassword(password)) {
    return response.status(400).json({ error: "Use more than 6 characters, at least one uppercase letter, and at least one number." });
  }

  try {
    const user = await findUserByEmail(email);
    const challenge = await findEmailChallenge(email, "password-reset");
    if (!user || !challenge || challenge.payload?.userId !== String(user._id || user.id) || !isValidEmailCode(challenge, code)) {
      if (challenge) await updateEmailChallenge(challenge, { attempts: (Number(challenge.attempts) || 0) + 1 });
      return response.status(400).json({ error: "That reset code is invalid, expired, or has used all attempts." });
    }
    const passwordHash = await bcrypt.hash(password, 12);
    if (isMongoConnected()) {
      user.passwordHash = passwordHash;
      user.emailVerified = true;
      user.sessionVersion = (user.sessionVersion || 0) + 1;
      await user.save();
    } else {
      const database = readDatabase();
      const storedUser = database.users.find((item) => item.id === user.id);
      if (!storedUser) return response.status(400).json({ error: "That reset token is invalid or has expired." });
      storedUser.passwordHash = passwordHash;
      storedUser.sessionVersion = (storedUser.sessionVersion || 0) + 1;
      writeDatabase(database);
    }
    await deleteEmailChallenge(email, "password-reset");
    clearRefreshCookie(response);
    return response.json({ message: "Password reset successfully. Sign in with your new password." });
  } catch (error) {
    console.error("Password reset failed.", error);
    return response.status(500).json({ error: "Unable to reset the password right now." });
  }
});

app.post("/api/auth/google", async (request, response) => {
  const body = request.body || {};
  try {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return response.status(503).json({ error: "Google sign-in is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to the server .env file." });
    let identity;
    let username;
    let displayName;
    const onboardingToken = typeof body.onboardingToken === "string" ? body.onboardingToken : "";
    if (onboardingToken) {
      const claims = jwt.verify(onboardingToken, JWT_SECRET);
      if (claims.tokenUse !== "google-onboarding") return response.status(401).json({ error: "Google sign-in session is no longer valid. Please start again." });
      identity = { email: claims.email, sub: claims.googleSubject, name: claims.name, picture: claims.picture };
      displayName = typeof body.username === "string" ? body.username.trim() : "";
      username = normalizeUsername(displayName);
    } else {
      const code = typeof body.code === "string" ? body.code : "";
      if (!code) return response.status(400).json({ error: "Google authorization code is required." });
      if (request.get("X-FUTApulse-OAuth-Request") !== "1") {
        return response.status(403).json({ error: "Google sign-in request could not be verified. Please restart sign-in." });
      }
      const redirectUri = getGooglePopupRedirectUri(request);
      if (request.get("origin") && body.origin && request.get("origin") !== body.origin) {
        return response.status(403).json({ error: "Google sign-in origin could not be verified. Please restart sign-in." });
      }
      if (!redirectUri) return response.status(403).json({ error: "Google sign-in was started from an app origin that this server does not allow." });
      const { tokens } = await googleOAuthClient.getToken({ code, redirect_uri: redirectUri });
      if (!tokens.id_token) return response.status(401).json({ error: "Google did not return a verifiable identity token." });
      const ticket = await googleOAuthClient.verifyIdToken({ idToken: tokens.id_token, audience: GOOGLE_CLIENT_ID });
      const payload = ticket.getPayload();
      if (!payload || payload.email_verified !== true || typeof payload.sub !== "string") {
        return response.status(401).json({ error: "Google must provide a verified email address." });
      }
      identity = {
        email: payload.email,
        sub: payload.sub,
        name: payload.name || "",
        picture: payload.picture || ""
      };
    }
    if (typeof identity.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity.email)) {
      return response.status(401).json({ error: "Google did not provide a valid email address." });
    }
    const email = identity.email.toLowerCase();
    let user = await findUserByEmail(email);
    if (!user) {
      if (!onboardingToken) {
        const signupToken = jwt.sign({
          email,
          name: identity.name,
          picture: identity.picture,
          googleSubject: identity.sub,
          tokenUse: "google-onboarding"
        }, JWT_SECRET, { expiresIn: "10m" });
        return response.status(200).json({ usernameRequired: true, email, name: identity.name || "", signupToken });
      }
      if (!isValidUsername(displayName)) {
        return response.status(400).json({ error: "Use 3â€“24 characters with at least one letter. Accents and letters from any language are supported." });
      }
      if (await findUserByUsername(username)) return response.status(409).json({ error: "That username is already taken." });
      const password = typeof body.password === "string" ? body.password : "";
      if (!isValidNewPassword(password)) return response.status(400).json({ error: "Use more than 6 characters, at least one uppercase letter, and at least one number." });
      const passwordHash = await bcrypt.hash(password, 12);
      user = await createUser({
        email,
        username,
        passwordHash,
        emailVerified: true,
        googleSubject: identity.sub,
        profile: { name: displayName, picture: identity.picture, faculty: "", department: "", level: "", role: "explorer" }
      });
    }
    if (!user.passwordHash) {
      const passwordSetupToken = jwt.sign({
        sub: String(user._id || user.id),
        email,
        googleSubject: identity.sub,
        tokenUse: "google-password-setup"
      }, JWT_SECRET, { expiresIn: "10m" });
      return response.status(200).json({ passwordRequired: true, passwordSetupToken, email });
    }
    await advanceUserSessionVersion(user);
    return response.json(sendSession(response, user, body.remember === true));
  } catch (error) {
    if (error.code === 11000) {
      if (error.keyPattern?.username) return response.status(409).json({ error: "That username is already taken." });
      if (error.keyPattern?.email) return response.status(409).json({ error: "An account with that email already exists." });
      return response.status(409).json({ error: "That username or email is already registered." });
    }
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return response.status(401).json({ error: "Google signup expired. Please continue with Google again." });
    }
    console.error("Google sign-in failed.", error);
    return response.status(500).json({ error: "Unable to complete Google sign-in right now." });
  }
});

app.post("/api/auth/google/password", async (request, response) => {
  const body = request.body || {};
  const token = typeof body.passwordSetupToken === "string" ? body.passwordSetupToken : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!token) return response.status(400).json({ error: "Google password setup has expired. Start Google sign-in again." });
  if (!isValidNewPassword(password)) return response.status(400).json({ error: "Use more than 6 characters, at least one uppercase letter, and at least one number." });

  try {
    const claims = jwt.verify(token, JWT_SECRET);
    if (claims.tokenUse !== "google-password-setup" || !claims.sub || !claims.email || !claims.googleSubject) {
      return response.status(401).json({ error: "Google password setup is no longer valid. Start Google sign-in again." });
    }
    const user = isMongoConnected()
      ? await findMongoUserById(claims.sub)
      : readDatabase().users.find((item) => item.id === claims.sub) || null;
    if (!user || user.email !== claims.email || (user.googleSubject && user.googleSubject !== claims.googleSubject)) {
      return response.status(401).json({ error: "Google password setup is no longer valid. Start Google sign-in again." });
    }
    if (user.passwordHash) return response.status(409).json({ error: "This account already has a password. Sign in with it or use password recovery." });

    user.passwordHash = await bcrypt.hash(password, 12);
    user.googleSubject = claims.googleSubject;
    user.emailVerified = true;
    user.sessionVersion = (user.sessionVersion || 0) + 1;
    if (isMongoConnected()) {
      await user.save();
    } else {
      const database = readDatabase();
      const storedUser = database.users.find((item) => item.id === claims.sub);
      if (!storedUser) return response.status(401).json({ error: "Google password setup is no longer valid. Start Google sign-in again." });
      storedUser.passwordHash = user.passwordHash;
      storedUser.googleSubject = claims.googleSubject;
      storedUser.emailVerified = true;
      storedUser.sessionVersion = user.sessionVersion;
      writeDatabase(database);
    }
    return response.json(sendSession(response, user, body.remember === true));
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return response.status(401).json({ error: "Google password setup expired. Start Google sign-in again." });
    }
    console.error("Google password setup failed.", error);
    return response.status(500).json({ error: "Unable to save the password right now." });
  }
});

app.get("/api/events", async (request, response) => {
  try {
    const authorization = request.get("authorization") || "";
    const user = authorization.startsWith("Bearer ") ? await getAuthenticatedUser(request) : null;
    if (authorization.startsWith("Bearer ") && !user) return response.status(401).json({ error: "Session is no longer valid." });
    const database = isMongoConnected() ? { users: [], events: [] } : readDatabase();
    const viewerId = user ? String(user._id || user.id) : "";
    const storedEvents = await listStoredEvents(viewerId, true);
    const level = request.query.level;
    const category = request.query.category;
    let events = storedEvents.filter((event) => {
      const isOwnerDraft = Boolean(user && event.status === "Draft" && String(event.createdByUserId || "") === String(user._id || user.id));
      const endedAt = new Date(event.endTime || "").getTime();
      const isOwnerRecentEndedEvent = Boolean(user
        && event.status !== "Cancelled"
        && String(event.createdByUserId || "") === String(user._id || user.id)
        && Number.isFinite(endedAt)
        && endedAt <= Date.now()
        && Date.now() - endedAt <= 7 * 24 * 60 * 60_000);
      const cancelledAt = new Date(event.cancelledAt || "").getTime();
      const isOwnerRecentCancellation = Boolean(user
        && event.status === "Cancelled"
        && String(event.createdByUserId || "") === String(user._id || user.id)
        && Number.isFinite(cancelledAt)
        && Date.now() - cancelledAt <= 7 * 24 * 60 * 60_000);
      return isOwnerDraft
        || isOwnerRecentEndedEvent
        || isOwnerRecentCancellation
        || (["Published", "Live"].includes(event.status) && (isWithinEventDisplayWindow(event) || isPublicRecapVisible(event)));
    });
    if (level) events = events.filter((event) => !event.audience || event.audience.includes("all") || event.audience.includes(level));
    if (category && category !== "all") events = events.filter((event) => event.category === category);
    const hotEligibleUserCount = await getHotEligibleUserCount(database);
    events = events.map((event) => withHotStatus(event, hotEligibleUserCount));
    events = await decorateEventsWithCurrentOrganizers(events, database);
    events = await decorateOwnerEventViews(events, viewerId);
    events = await decorateOwnerRecapDismissals(events, viewerId);
    return response.json({ events: events.map((event) => toPublicEvent(event, viewerId)) });
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return response.status(401).json({ error: "Session is no longer valid." });
    }
    console.error("Event list request failed.", error);
    return response.status(500).json({ error: "Unable to load campus events." });
  }
});

app.post("/api/events/:eventId/views", async (request, response) => {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return response.status(401).json({ error: "Sign in to record an event view." });
    const event = await findStoredEvent(request.params.eventId);
    if (!event || !["Published", "Live"].includes(event.status) || !isWithinEventDisplayWindow(event)) {
      return response.status(404).json({ error: "This event is no longer available." });
    }
    const userId = String(user._id || user.id);
    if (String(event.createdByUserId || "") === userId) return response.json({ recorded: false });

    if (!isMongoConnected()) {
      const database = readDatabase();
      const eventViews = database.eventViews || [];
      const exists = eventViews.some((view) => String(view.eventId) === String(event.id) && String(view.userId) === userId);
      if (!exists) {
        eventViews.push({ eventId: String(event.id), userId, createdAt: new Date().toISOString() });
        database.eventViews = eventViews;
        writeDatabase(database);
      }
      return response.json({ recorded: !exists });
    }
    try {
      await EventView.create({ eventId: String(event.id), userId });
      return response.status(201).json({ recorded: true });
    } catch (error) {
      if (error.code === 11000) return response.json({ recorded: false });
      throw error;
    }
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return response.status(401).json({ error: "Session is no longer valid." });
    }
    console.error("Event view could not be recorded.", error);
    return response.status(500).json({ error: "Unable to record this event view." });
  }
});

app.post("/api/events/:eventId/recap-prompt-dismissal", async (request, response) => {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return response.status(401).json({ error: "Sign in before dismissing this recap prompt." });
    const event = await findStoredEvent(request.params.eventId);
    const userId = String(user._id || user.id);
    if (!event || String(event.createdByUserId || "") !== userId) {
      return response.status(404).json({ error: "This event is not available in your organizer profile." });
    }
    const endedAt = new Date(event.endTime || "").getTime();
    if (!Number.isFinite(endedAt) || endedAt > Date.now() || Date.now() - endedAt > 7 * 24 * 60 * 60_000) {
      return response.status(409).json({ error: "The recap prompt can only be dismissed during the seven days after an event ends." });
    }
    const dismissedAt = new Date();
    if (!isMongoConnected()) {
      const database = readDatabase();
      const dismissals = database.recapPromptDismissals || [];
      const existingIndex = dismissals.findIndex((item) => String(item.eventId) === String(event.id) && String(item.userId) === userId);
      const dismissal = { eventId: String(event.id), userId, dismissedAt: dismissedAt.toISOString() };
      if (existingIndex < 0) dismissals.push(dismissal);
      else dismissals[existingIndex] = dismissal;
      database.recapPromptDismissals = dismissals;
      writeDatabase(database);
    } else {
      await RecapPromptDismissal.updateOne(
        { eventId: String(event.id), userId },
        { $set: { dismissedAt } },
        { upsert: true }
      ).exec();
    }
    return response.json({ dismissed: true });
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return response.status(401).json({ error: "Session is no longer valid." });
    }
    console.error("Recap prompt dismissal could not be saved.", error);
    return response.status(500).json({ error: "Unable to dismiss this recap prompt." });
  }
});

// Lightweight polling contract for mobile clients. Feed cards and banners are
// fetched separately; frequent count refreshes should not resend those assets.
app.get("/api/events/engagement", async (request, response) => {
  try {
    const authorization = request.get("authorization") || "";
    const user = authorization.startsWith("Bearer ") ? await getAuthenticatedUser(request) : null;
    if (authorization.startsWith("Bearer ") && !user) return response.status(401).json({ error: "Session is no longer valid." });
    const viewerId = user ? String(user._id || user.id) : "";
    const events = await listStoredEvents(viewerId, true);
    const eligibleEvents = events
      .filter((event) => (["Published", "Live"].includes(event.status) && isWithinEventDisplayWindow(event))
        || (viewerId && String(event.createdByUserId || "") === viewerId
          && (event.status === "Cancelled"
            ? Number.isFinite(new Date(event.cancelledAt || "").getTime())
              && Date.now() - new Date(event.cancelledAt).getTime() <= 7 * 24 * 60 * 60_000
            : Number.isFinite(new Date(event.endTime || "").getTime())
              && new Date(event.endTime).getTime() <= Date.now()
              && Date.now() - new Date(event.endTime).getTime() <= 7 * 24 * 60 * 60_000)));
    const ownerEvents = viewerId
      ? eligibleEvents.filter((event) => String(event.createdByUserId || "") === viewerId)
      : [];
    const ownerViewCounts = await getEventViewCounts(ownerEvents.map((event) => event.id));
    const hotEligibleUserCount = await getHotEligibleUserCount();
    const updates = eligibleEvents.map((event) => {
        const hasAction = (field) => viewerId && Array.isArray(event[field]) && event[field].includes(viewerId);
        const flameCount = Number(event.flameCount ?? event.hypeCount) || 0;
        const rsvpCount = Number(event.rsvpCount ?? event.turnoutCount) || 0;
        const reminderCount = Number(event.reminderCount) || 0;
        return {
          id: String(event.id),
          status: event.status,
          flameCount,
          hypeCount: flameCount,
          rsvpCount,
          turnoutCount: rsvpCount,
          reminderCount,
          turnoutBreakdown: Array.isArray(event.turnoutBreakdown) ? event.turnoutBreakdown : [],
          isGoing: Boolean(hasAction("attendeeUserIds")),
          isHyped: Boolean(hasAction("hypedUserIds")),
          isReminded: Boolean(hasAction("reminderUserIds")),
          isHot: isHotByRsvpCount(rsvpCount, hotEligibleUserCount),
          ...(viewerId && String(event.createdByUserId || "") === viewerId
            ? { viewCount: ownerViewCounts.get(String(event.id)) || 0 }
            : {})
        };
      });
    return response.json({ updates });
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return response.status(401).json({ error: "Session is no longer valid." });
    }
    console.error("Event engagement refresh failed.", error);
    return response.status(500).json({ error: "Unable to refresh event counts." });
  }
});

const ENGAGEMENT_COUNTERS = {
  flame: "flameCount",
  reminder: "reminderCount",
  rsvp: "rsvpCount"
};

function updateFacultyTurnoutBreakdown(turnoutBreakdown, faculty, delta) {
  const normalizedFaculty = String(faculty || "").trim();
  const current = Array.isArray(turnoutBreakdown) ? turnoutBreakdown : [];
  if (!normalizedFaculty || !delta) return current;

  const matchIndex = current.findIndex((item) => String(item.faculty || "").toLowerCase() === normalizedFaculty.toLowerCase());
  if (matchIndex < 0) return delta > 0 ? [...current, { faculty: normalizedFaculty, count: delta }] : current;

  const next = current.map((item, index) => index === matchIndex
    ? { ...item, count: Math.max(0, (Number(item.count) || 0) + delta) }
    : item);
  return next.filter((item) => Number(item.count) > 0);
}

async function getHotEligibleUserCount(database = null) {
  if (isMongoConnected()) {
    if (hotEligibleUserCountCache.value !== null && hotEligibleUserCountCache.expiresAt > Date.now()) {
      return hotEligibleUserCountCache.value;
    }
    if (hotEligibleUserCountCache.pending) return hotEligibleUserCountCache.pending;
    const completeProfile = Object.fromEntries(
      ["name", "faculty", "department", "level", "role"].map((field) => [
        `profile.${field}`,
        { $type: "string", $regex: /\S/ }
      ])
    );
    hotEligibleUserCountCache.pending = User.countDocuments({ emailVerified: true, ...completeProfile }).exec();
    try {
      const count = await hotEligibleUserCountCache.pending;
      hotEligibleUserCountCache.value = count;
      hotEligibleUserCountCache.expiresAt = Date.now() + 60_000;
      return count;
    } finally {
      hotEligibleUserCountCache.pending = null;
    }
  }
  const users = (database || readDatabase()).users || [];
  return users.filter((user) => user.emailVerified === true && validateProfile(user.profile || {})).length;
}

let hotEligibleUserCountCache = { value: null, expiresAt: 0, pending: null };

function isHotByRsvpCount(rsvpCount, eligibleUserCount) {
  return eligibleUserCount > 0 && Number(rsvpCount) * 2 > eligibleUserCount;
}

function withHotStatus(event, eligibleUserCount) {
  const rsvpCount = Number(event.rsvpCount ?? event.turnoutCount) || 0;
  return {
    ...event,
    hotRsvpPercentage: eligibleUserCount > 0 ? (rsvpCount / eligibleUserCount) * 100 : 0,
    isHot: isHotByRsvpCount(rsvpCount, eligibleUserCount)
  };
}

function eventStartDate(event) {
  const time = typeof event?.startTime === "string" ? event.startTime.trim() : "";
  const candidate = /^\d{1,2}:\d{2}(:\d{2})?$/.test(time) && event?.date
    ? `${String(event.date).slice(0, 10)}T${time.length === 5 ? `${time}:00` : time}`
    : time || event?.date || "";
  const parsed = new Date(candidate);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildRsvpReminderSchedule(event, { hasCustomReminder = false, now = Date.now() } = {}) {
  const startsAt = eventStartDate(event);
  if (!startsAt || startsAt.getTime() <= now) return [];
  return [
    ...(!hasCustomReminder ? [
      { offset: 60 * 60_000, suffix: "1h", message: `${event.title} starts in 1 hour.` },
      { offset: 30 * 60_000, suffix: "30m", message: `${event.title} is starting in 30 minutes!` }
    ] : []),
    { offset: 0, suffix: "start", message: `${event.title} is live now.` }
  ]
    .map(({ offset, suffix, message }) => ({ suffix, message, dueAt: new Date(startsAt.getTime() - offset) }))
    .filter((reminder) => reminder.dueAt.getTime() > now);
}

async function scheduleDefaultRsvpReminders(event, userId, hasCustomReminder = false) {
  if (!isMongoConnected()) return;
  await Promise.all(buildRsvpReminderSchedule(event, { hasCustomReminder }).map((reminder) => enqueueNotification({
      idempotencyKey: `rsvp-reminder:${event.id}:${userId}:${reminder.suffix}`,
      recipientUserId: userId,
      event,
      kind: `rsvp-reminder-${reminder.suffix}`,
      title: "Event reminder",
      message: reminder.message,
      dueAt: reminder.dueAt,
      reactivateCancelled: true
    })));
}

async function cancelUserEventNotifications(eventId, userId, kinds) {
  if (!isMongoConnected()) return;
  await NotificationJob.updateMany({
    eventId: String(eventId),
    recipientUserId: String(userId),
    kind: { $in: kinds },
    status: { $in: ["pending", "processing"] }
  }, { $set: { status: "cancelled", leaseUntil: null } }).exec();
}

async function rescheduleEventRsvpReminders(event) {
  if (!isMongoConnected()) return;
  const eventId = String(event.id);
  const [attendees, customReminders] = await Promise.all([
    EngagementAction.find({ eventId, type: "rsvp" }).select("userId").lean().exec(),
    EngagementAction.find({
      eventId,
      type: "reminder",
      customReminderAt: { $ne: null }
    }).select("userId customReminderAt").lean().exec()
  ]);
  const attendeeIds = new Set(attendees.map((attendee) => String(attendee.userId)).filter(Boolean));
  const customReminderByUserId = new Map(customReminders.map((reminder) => [
    String(reminder.userId),
    new Date(reminder.customReminderAt)
  ]));
  const userIds = [...new Set([...attendeeIds, ...customReminderByUserId.keys()])];
  if (!userIds.length) return;

  const reminderKinds = ["rsvp-reminder-1h", "rsvp-reminder-30m", "rsvp-reminder-start", "custom-reminder"];
  await NotificationJob.updateMany({
    eventId,
    recipientUserId: { $in: userIds },
    kind: { $in: reminderKinds },
    status: { $in: ["pending", "processing", "failed", "undeliverable"] }
  }, { $set: { status: "cancelled", leaseUntil: null } }).exec();

  const startsAt = eventStartDate(event);
  const now = Date.now();
  await Promise.all(userIds.map(async (userId) => {
    const customReminderAt = customReminderByUserId.get(userId);
    const hasCustomReminder = Boolean(customReminderAt);
    const hasValidCustomReminder = Boolean(
      customReminderAt
      && Number.isFinite(customReminderAt.getTime())
      && customReminderAt.getTime() > now
      && startsAt
      && customReminderAt < startsAt
    );
    await scheduleDefaultRsvpReminders(event, userId, hasCustomReminder);
    if (hasValidCustomReminder) {
      await scheduleCustomEventReminder(event, userId, customReminderAt);
    }
  }));
}

async function scheduleCustomEventReminder(event, userId, dueAt) {
  const startsAt = eventStartDate(event);
  const reminderAt = new Date(dueAt);
  if (!startsAt || !Number.isFinite(reminderAt.getTime()) || reminderAt.getTime() <= Date.now() || reminderAt >= startsAt) {
    throw new Error("Choose a reminder time in the future and before the event starts.");
  }
  await cancelUserEventNotifications(event.id, userId, [
    "rsvp-reminder-1h", "rsvp-reminder-30m", "custom-reminder"
  ]);
  await enqueueNotification({
    idempotencyKey: `custom-reminder:${event.id}:${userId}:${reminderAt.toISOString()}`,
    recipientUserId: userId,
    event,
    kind: "custom-reminder",
    title: "Your event reminder",
    message: `${event.title} is coming up soon.`,
    dueAt: reminderAt,
    reactivateCancelled: true
  });
}

async function notifyRsvpSocialProof(event) {
  if (!isMongoConnected()) return;
  const eventRsvpFilter = { eventId: String(event.id), type: "rsvp" };
  const recentRsvpBoundary = new Date(Date.now() - (30 * 60_000));
  const [rsvps, recentRsvpCount] = await Promise.all([
    EngagementAction.find(eventRsvpFilter)
      .select("userId faculty department").lean().exec(),
    EngagementAction.countDocuments({ ...eventRsvpFilter, updatedAt: { $gte: recentRsvpBoundary } }).exec()
  ]);
  const facultyCounts = new Map();
  const departmentCounts = new Map();
  const addCohortRsvp = (counts, label, userId) => {
    const normalized = String(label || "").trim();
    if (!normalized) return;
    const key = normalized.toLowerCase();
    const cohort = counts.get(key) || { label: normalized, userIds: new Set() };
    cohort.userIds.add(String(userId));
    counts.set(key, cohort);
  };
  for (const rsvp of rsvps) {
    addCohortRsvp(facultyCounts, rsvp.faculty, rsvp.userId);
    addCohortRsvp(departmentCounts, rsvp.department, rsvp.userId);
  }
  for (const [facultyKey, cohort] of facultyCounts) {
    if (cohort.userIds.size < 20) continue;
    const recipients = await User.find({
      "profile.faculty": { $regex: `^${escapeRegex(cohort.label)}$`, $options: "i" },
      emailVerified: true
    }).select("_id").lean().exec();
    await enqueueNotifications(recipients.map((recipient) => recipient._id), {
      idempotencyKey: `faculty-milestone:${event.id}:${facultyKey}:20`,
      event,
      kind: "faculty-milestone",
      title: "Your faculty is going",
      message: `20 people from your faculty (${cohort.label}) are going to ${event.title}. Tap to check it out.`
    });
  }
  for (const [departmentKey, cohort] of departmentCounts) {
    if (cohort.userIds.size < 10) continue;
    const recipients = await User.find({
      "profile.department": { $regex: `^${escapeRegex(cohort.label)}$`, $options: "i" },
      emailVerified: true
    }).select("_id").lean().exec();
    await enqueueNotifications(recipients.map((recipient) => recipient._id), {
      idempotencyKey: `department-milestone:${event.id}:${departmentKey}:10`,
      event,
      kind: "department-milestone",
      title: "Your department is going",
      message: `10 people from your department are coming to ${event.title}. Tap to check it out.`
    });
  }
  if (recentRsvpCount >= 30) {
    const recipients = await User.find({ emailVerified: true }).select("_id").lean().exec();
    await enqueueNotifications(recipients.map((recipient) => recipient._id), {
      idempotencyKey: `trending-spike:${event.id}:30`,
      event,
      kind: "trending-spike",
      title: "Trending on campus",
      message: `${event.title} is trending! 30+ people are coming. Tap to check it out.`
    });
  }
}

async function getEventNotificationAudience(event, includeCategoryFollowers = true) {
  if (!isMongoConnected()) return [];
  const ids = new Set();
  const [attendees, categoryUsers] = await Promise.all([
    EngagementAction.find({ eventId: String(event.id), type: "rsvp" }).select("userId").lean().exec(),
    includeCategoryFollowers && NOTIFICATION_CATEGORIES.includes(String(event.category || "").toLowerCase())
      ? User.find({
        emailVerified: true,
        [`profile.notificationPreferences.${String(event.category).toLowerCase()}`]: { $ne: false }
      }).select("_id").lean().exec()
      : Promise.resolve([])
  ]);
  attendees.forEach((item) => ids.add(String(item.userId)));
  categoryUsers.forEach((item) => ids.add(String(item._id)));
  return [...ids];
}

function buildCriticalEventUpdateDetails(previous, event) {
  const scheduleChanged = ["date", "startTime"].some((key) => String(previous[key] || "") !== String(event[key] || ""));
  const changedFields = [
    ["title", "title"],
    ["venue", "venue"]
  ].filter(([key]) => String(previous[key] || "") !== String(event[key] || "")).map(([, label]) => label);
  if (scheduleChanged) changedFields.unshift("start time");
  if (!changedFields.length) return null;
  return {
    postponed: scheduleChanged,
    message: scheduleChanged
      ? `⏰ POSTPONED: ${event.title} has been moved to a new date. Tap to check it out.`
      : changedFields.length === 1
        ? `The ${changedFields[0]} for ${event.title} has changed. Tap to check it out.`
        : `The ${changedFields.join(", ")} for ${event.title} have changed. Tap to check it out.`
  };
}

async function notifyCriticalEventUpdate(previous, event) {
  if (!isMongoConnected()) return;
  const updateDetails = buildCriticalEventUpdateDetails(previous, event);
  if (!updateDetails) return;
  const recipients = await getEventNotificationAudience(event, true);
  const results = await Promise.allSettled([
    enqueueNotifications(recipients, {
      idempotencyKey: `critical-update:${event.id}:${event.updatedAt}`,
      event,
      kind: updateDetails.postponed ? "event-postponed" : "event-critical-update",
      title: updateDetails.postponed ? "Event postponed" : "Event details changed",
      message: updateDetails.message
    }),
    rescheduleEventRsvpReminders(event)
  ]);
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Event update notification processing failed.", result.reason);
    }
  }
}

app.get("/api/events/hot", async (request, response) => {
  let viewerId = "";
  try {
    const user = await getAuthenticatedUser(request);
    if (user) viewerId = String(user._id || user.id);
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return response.status(401).json({ error: "Session is no longer valid." });
    }
    throw error;
  }
  const database = isMongoConnected() ? { users: [], events: [] } : readDatabase();
  const storedEvents = await listStoredEvents(viewerId, true);
  const hotEligibleUserCount = await getHotEligibleUserCount(database);
  const events = storedEvents
    .filter((event) => {
      if (!["Published", "Live"].includes(event.status)) return false;
      return isWithinEventDisplayWindow(event);
    })
    .map((event) => withHotStatus(event, hotEligibleUserCount))
    .filter((event) => event.isHot)
    .sort((first, second) => second.hotRsvpPercentage - first.hotRsvpPercentage
      || Number(second.rsvpCount ?? second.turnoutCount) - Number(first.rsvpCount ?? first.turnoutCount)
      || (eventStartDate(first)?.getTime() || 0) - (eventStartDate(second)?.getTime() || 0));
  return decorateEventsWithCurrentOrganizers(events, database)
    .then((updatedEvents) => response.json({ events: updatedEvents.map((event) => toPublicEvent(event, viewerId)) }))
    .catch((error) => {
      console.error("Trending event organizer details could not be loaded.", error);
      return response.status(500).json({ error: "Unable to load trending events." });
    });
});

app.post("/api/events", async (request, response) => {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return response.status(401).json({ error: "Sign in before publishing a campus event." });
    const profile = user.profile || {};
    if (!validateProfile(profile)) return response.status(403).json({ error: "Complete your campus profile before publishing an event." });
    const payload = request.body || {};
    const { allowSimilar, ...eventPayload } = payload;
    const requestedStatus = payload.status || "Draft";
    if (requestedStatus !== "Draft" && new Date(user.postingBanUntil || 0).getTime() > Date.now()) {
      return response.status(403).json({ error: `Your event-posting access is paused until ${new Date(user.postingBanUntil).toLocaleString()}.` });
    }
    let event = {
      ...eventPayload,
      id: crypto.randomUUID(),
      createdByUserId: String(user._id || user.id),
      ...getCurrentOrganizerMetadata(user),
      venue: typeof payload.venue === "string" ? payload.venue.trim().slice(0, 120) : "",
      venueLandmark: typeof payload.venueLandmark === "string" ? payload.venueLandmark.trim().slice(0, 240) : "",
      meetingUrl: typeof payload.meetingUrl === "string" ? payload.meetingUrl.trim() : "",
      turnoutCount: typeof payload.turnoutCount === "number" ? payload.turnoutCount : (Number(payload.turnoutCount) || 0),
      turnoutBreakdown: Array.isArray(payload.turnoutBreakdown) ? payload.turnoutBreakdown : [],
      status: requestedStatus,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    if (!validateEvent(event)) return response.status(400).json({ error: "Event is missing required fields." });
    const database = isMongoConnected() ? { users: [], events: [] } : readDatabase();
    const storedEvents = await listStoredEvents();
    if (event.status !== "Draft") {
      const matches = getEventDuplicateMatches({ events: storedEvents }, event);
      const blockingMatches = matches.filter((match) => match.score === 100);
      if (blockingMatches.length) {
        return response.status(409).json({
          code: "DUPLICATE_EVENT",
          error: "An event with these same details has already been published. Review the existing event before publishing.",
          matches: blockingMatches
        });
      }
      const advisoryMatches = matches.filter((match) => match.score < 100);
      if (advisoryMatches.length && allowSimilar !== true) {
        return response.status(409).json({
          code: "POSSIBLE_DUPLICATE",
          error: "A similar event already exists. Review it before confirming that this is a separate event.",
          matches: advisoryMatches
        });
      }
      event = await externalizeEventBanners(event);
      await storeEvent(event);
      void enqueueCategoryAlert(event).catch((error) => console.error("New-event notifications could not be queued.", error));
      void scheduleEventEndedRecapPrompt(event).catch((error) => console.error("Event-end recap notification could not be scheduled.", error));
      return response.status(201).json({ event: toPublicEvent(event), similarEvents: advisoryMatches.map(({ event: match, score }) => ({ event: toPublicEvent(match), score })) });
    }
    event = await externalizeEventBanners(event);
    await storeEvent(event);
    void cancelEventEndedRecapPrompts(event.id).catch((error) => console.error("Event-end recap notification could not be cancelled.", error));
    return response.status(201).json({ event: toPublicEvent(event), similarEvents: [] });
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return response.status(401).json({ error: "Your session is no longer valid. Sign in again." });
    }
    if (error.code === "EVENT_BANNER_STORAGE_UNAVAILABLE") {
      return response.status(503).json({ error: error.message });
    }
    if (error.code === "EVENT_BANNER_UPLOAD_FAILED") {
      return response.status(502).json({ error: eventBannerUploadErrorMessage(error) });
    }
    console.error("Event creation failed.", error);
    return response.status(500).json({ error: "Unable to publish this event right now." });
  }
});

app.patch("/api/events/:eventId", async (request, response) => {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return response.status(401).json({ error: "Sign in before editing an event." });
    const database = isMongoConnected() ? { users: [], events: [] } : readDatabase();
    const current = await findStoredEvent(request.params.eventId);
    if (!current) return response.status(404).json({ error: "Event not found." });
    if (!current.createdByUserId || String(current.createdByUserId) !== String(user._id || user.id)) {
      return response.status(403).json({ error: "Only the account that originally published this event can edit it." });
    }
    if (["Published", "Live"].includes(current.status) && request.body?.status === "Draft") {
      return response.status(409).json({ error: "Published events cannot be changed back into drafts." });
    }
    const { allowSimilar, ...changes } = request.body || {};
    let updated = {
      ...current,
      ...changes,
      id: current.id,
      createdByUserId: current.createdByUserId,
      ...getCurrentOrganizerMetadata(user),
      venue: typeof changes.venue === "string" ? changes.venue.trim().slice(0, 120) : current.venue,
      venueLandmark: typeof changes.venueLandmark === "string" ? changes.venueLandmark.trim().slice(0, 240) : current.venueLandmark || "",
      meetingUrl: typeof changes.meetingUrl === "string" ? changes.meetingUrl.trim() : current.meetingUrl || "",
      updatedAt: new Date().toISOString()
    };
    if (updated.status !== "Draft" && new Date(user.postingBanUntil || 0).getTime() > Date.now()) {
      return response.status(403).json({ error: `Your event-posting access is paused until ${new Date(user.postingBanUntil).toLocaleString()}.` });
    }
    if (!validateEvent(updated)) return response.status(400).json({ error: "Published events require a start and end time, title, category, activity, venue, and target audience." });
    if (updated.status !== "Draft") {
      const matches = getEventDuplicateMatches({ events: await listStoredEvents() }, updated, current.id);
      const blockingMatches = matches.filter((match) => match.score === 100);
      if (blockingMatches.length) {
        return response.status(409).json({
          code: "DUPLICATE_EVENT",
          error: "An event with these same details has already been published. Review the existing event before saving your changes.",
          matches: blockingMatches
        });
      }
      const advisoryMatches = matches.filter((match) => match.score < 100);
      if (advisoryMatches.length && allowSimilar !== true) {
        return response.status(409).json({
          code: "POSSIBLE_DUPLICATE",
          error: "A similar event already exists. Review it before confirming that this is a separate event.",
          matches: advisoryMatches
        });
      }
      updated = await externalizeEventBanners(updated);
      await storeEvent(updated);
      if (["Published", "Live"].includes(updated.status)) {
        void scheduleEventEndedRecapPrompt(updated).catch((error) => console.error("Event-end recap notification could not be scheduled.", error));
        if (current.status === "Draft") {
          void enqueueCategoryAlert(updated).catch((error) => console.error("New-event notifications could not be queued.", error));
        } else {
          const changedCriticalField = ["title", "date", "startTime", "venue"].some((key) => String(current[key] || "") !== String(updated[key] || ""));
          if (changedCriticalField) {
            void notifyCriticalEventUpdate(current, updated).catch((error) => console.error("Event update notifications could not be queued.", error));
          }
        }
      } else {
        void cancelEventEndedRecapPrompts(updated.id).catch((error) => console.error("Event-end recap notification could not be cancelled.", error));
      }
      return response.json({ event: toPublicEvent(updated), similarEvents: advisoryMatches.map(({ event: match, score }) => ({ event: toPublicEvent(match), score })) });
    }
    updated = await externalizeEventBanners(updated);
    await storeEvent(updated);
    void cancelEventEndedRecapPrompts(updated.id).catch((error) => console.error("Event-end recap notification could not be cancelled.", error));
    return response.json({ event: toPublicEvent(updated), similarEvents: [] });
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return response.status(401).json({ error: "Your session is no longer valid. Sign in again." });
    }
    if (error.code === "EVENT_BANNER_STORAGE_UNAVAILABLE") {
      return response.status(503).json({ error: error.message });
    }
    if (error.code === "EVENT_BANNER_UPLOAD_FAILED") {
      return response.status(502).json({ error: eventBannerUploadErrorMessage(error) });
    }
    console.error("Event update failed.", error);
    return response.status(500).json({ error: "Unable to update this event right now." });
  }
});

app.delete("/api/events/:eventId", async (request, response) => {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return response.status(401).json({ error: "Sign in before deleting an event." });
    const event = await findStoredEvent(request.params.eventId);
    if (!event) return response.status(404).json({ error: "Event not found." });
    if (String(event.createdByUserId || "") !== String(user._id || user.id)) {
      return response.status(403).json({ error: "Only the account that created this event can delete it." });
    }
    const eventEnded = Number.isFinite(new Date(event.endTime || "").getTime())
      && new Date(event.endTime).getTime() <= Date.now();
    if (["Published", "Live"].includes(event.status) && !eventEnded) {
      const cancelledAt = new Date();
      const cancelledEvent = {
        ...event,
        status: "Cancelled",
        cancelledAt: cancelledAt.toISOString(),
        cancellationExpiresAt: new Date(cancelledAt.getTime() + (7 * 24 * 60 * 60_000)).toISOString(),
        updatedAt: cancelledAt.toISOString()
      };
      await storeEvent(cancelledEvent);
      void cancelEventEndedRecapPrompts(event.id).catch((error) => console.error("Event-end recap notification could not be cancelled.", error));
      if (isMongoConnected()) {
        await NotificationJob.updateMany({
          eventId: String(event.id),
          status: { $in: ["pending", "processing"] },
          kind: { $in: ["rsvp-reminder-1h", "rsvp-reminder-30m", "rsvp-reminder-start", "custom-reminder"] }
        }, { $set: { status: "cancelled", leaseUntil: null } }).exec();
      }
      try {
        const recipients = await getEventNotificationAudience(cancelledEvent, true);
        await enqueueNotifications(recipients, {
          idempotencyKey: `event-cancelled:${event.id}`,
          event: cancelledEvent,
          kind: "event-cancellation",
          title: "Event cancellation notice",
          message: `⚠️ CANCELLATION NOTICE: ${event.title} has been called off. Tap to view details.`
        });
      } catch (error) {
        console.error("Event cancellation was saved, but audience notifications could not be queued.", error);
      }
      return response.json({ message: "Cancellation notice sent. The event is no longer in the public feed and remains in your profile for seven days.", cancelled: true });
    }
    await deleteStoredEvent(event.id);
    return response.json({
      message: event.status === "Draft" ? "Draft deleted." : "Event removed from your profile.",
      removed: true
    });
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return response.status(401).json({ error: "Your session is no longer valid. Sign in again." });
    }
    console.error("Event deletion failed.", error);
    return response.status(500).json({ error: "Unable to delete this event right now." });
  }
});

app.post("/api/events/:eventId/announcements", async (request, response) => {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return response.status(401).json({ error: "Sign in before sending an event announcement." });
    if (!isMongoConnected()) return response.status(503).json({ error: "Organizer broadcasts require the shared MongoDB notification queue." });
    const event = await findStoredEvent(request.params.eventId);
    if (!event || !["Published", "Live"].includes(event.status)) return response.status(404).json({ error: "This published event is not available." });
    if (String(event.createdByUserId || "") !== String(user._id || user.id)) {
      return response.status(403).json({ error: "Only the event organizer can send a broadcast." });
    }
    const message = typeof request.body?.message === "string" ? request.body.message.trim() : "";
    if (!message || message.length > 240) return response.status(400).json({ error: "Enter an announcement of 1–240 characters." });
    const now = new Date();
    const cooldownBoundary = new Date(now.getTime() - 60_000);
    const claimedEvent = await EventRecord.findOneAndUpdate({
      eventId: String(event.id),
      ownerUserId: String(user._id || user.id),
      $or: [
        { lastAnnouncementAt: null },
        { lastAnnouncementAt: { $exists: false } },
        { lastAnnouncementAt: { $lte: cooldownBoundary } }
      ]
    }, { $set: { lastAnnouncementAt: now } }, { new: true }).exec();
    if (!claimedEvent) return response.status(429).json({ error: "Please wait one minute between announcements for this event." });
    const recipients = await getEventNotificationAudience(event, true);
    const pushReadyDeviceCount = recipients.length
      ? await PushDevice.countDocuments({ userId: { $in: recipients }, platform: "web", enabled: true }).exec()
      : 0;
    await enqueueNotifications(recipients, {
      idempotencyKey: `organizer-announcement:${event.id}:${now.toISOString()}`,
      event,
      kind: "organizer-announcement",
      title: `Update: ${event.title}`,
      message
    });
    return response.status(202).json({
      queued: true,
      recipientCount: recipients.length,
      pushReadyDeviceCount,
      pushConfigured: getVapidConfiguration().valid
    });
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) return response.status(401).json({ error: "Session is no longer valid." });
    console.error("Organizer event announcement failed.", error);
    return response.status(500).json({ error: "Unable to send the event announcement right now." });
  }
});

app.post("/api/events/:eventId/recap-photos", (request, response, next) => {
  recapImageUpload.array("photos", 5)(request, response, (error) => {
    if (error) {
      const message = error.code === "LIMIT_FILE_SIZE"
        ? "Each recap photo must be 5 MB or smaller."
        : error.message || "Unable to process recap photos.";
      return response.status(400).json({ error: message });
    }
    return next();
  });
}, async (request, response) => {
  const uploadedAssets = [];
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return response.status(401).json({ error: "Sign in before uploading event recap photos." });
    if (!isMongoConnected()) return response.status(503).json({ error: "Recap uploads require the shared MongoDB database." });
    if (!configureCloudinary()) {
      return response.status(503).json({
        error: `Cloudinary is not ready. Add the missing Render environment variable${getMissingCloudinaryVariables().length === 1 ? "" : "s"}: ${getMissingCloudinaryVariables().join(", ")}.`
      });
    }
    const event = await findStoredEvent(request.params.eventId);
    if (!event || !["Published", "Live"].includes(event.status)) return response.status(404).json({ error: "This event cannot accept recap photos." });
    if (String(event.createdByUserId || "") !== String(user._id || user.id)) {
      return response.status(403).json({ error: "Only the event organizer can upload recap photos." });
    }
    const eventEnd = new Date(event.endTime || "");
    if (!Number.isFinite(eventEnd.getTime()) || eventEnd.getTime() > Date.now()
      || Date.now() - eventEnd.getTime() > 7 * 24 * 60 * 60_000) {
      return response.status(409).json({ error: "Recap photos can be uploaded after the event ends and for up to seven days." });
    }
    const files = Array.isArray(request.files) ? request.files : [];
    if (!files.length) return response.status(400).json({ error: "Choose at least one JPEG or WebP photo." });
    const currentPhotos = Array.isArray(event.recapPhotos) ? event.recapPhotos : [];
    if (currentPhotos.length + files.length > 5) return response.status(400).json({ error: "An event recap can contain at most five photos." });
    for (const file of files) {
      const isJpeg = file.buffer.length >= 3 && file.buffer[0] === 0xff && file.buffer[1] === 0xd8 && file.buffer[2] === 0xff;
      const isWebp = file.buffer.length >= 12
        && file.buffer.toString("ascii", 0, 4) === "RIFF"
        && file.buffer.toString("ascii", 8, 12) === "WEBP";
      const isPng = file.buffer.length >= 8
        && file.buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      if (!isJpeg && !isPng && !isWebp) return response.status(400).json({ error: "A recap photo does not match its declared JPEG, PNG, or WebP format." });
      const uploaded = await uploadRecapImage(file.buffer, event.id);
      uploadedAssets.push(uploaded);
    }
    const recapPublishedAt = new Date().toISOString();
    const updated = {
      ...event,
      recapPhotos: [
        ...currentPhotos,
        ...uploadedAssets.map((asset) => ({
          url: asset.secure_url,
          width: asset.width,
          height: asset.height,
          format: asset.format
        }))
      ],
      recapPublishedAt,
      updatedAt: new Date().toISOString()
    };
    await storeEvent(updated);
    if (currentPhotos.length === 0) {
      try {
        const recipients = await User.find({ emailVerified: true }).select("_id").lean().exec();
        await enqueueNotifications(recipients.map((recipient) => recipient._id), {
          idempotencyKey: `event-recap:${event.id}`,
          event: updated,
          kind: "event-recap",
          title: "Relive the vibe!",
          message: `Relive the vibe! Photos from ${event.title} are now live. Tap to check out the recap.`,
          universal: true
        });
      } catch (error) {
        console.error("Recap photos were saved, but the universal recap notification could not be queued.", error);
      }
    }
    return response.status(201).json({ event: toPublicEvent(updated), uploadedCount: uploadedAssets.length });
  } catch (error) {
    await Promise.all(uploadedAssets.filter((asset) => asset?.public_id).map(async (asset) => {
      try {
        await cloudinary.uploader.destroy(asset.public_id, { resource_type: "image" });
      } catch (cleanupError) {
        console.error("Unable to remove an unreferenced recap image after upload failure.", {
          category: classifyCloudinaryError(cleanupError),
          status: Number(cleanupError?.http_code || cleanupError?.statusCode || cleanupError?.status) || null
        });
      }
    }));
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) return response.status(401).json({ error: "Session is no longer valid." });
    const category = classifyCloudinaryError(error);
    console.error("Event recap photo upload failed.", {
      category,
      status: Number(error?.http_code || error?.statusCode) || null
    });
    return response.status(category === "provider_unavailable" ? 503 : 502).json({
      error: cloudinaryErrorMessage(error, "Photo")
    });
  }
});

function isFutapulseAdmin(user) {
  return user?.emailVerified === true
    && String(user.email || "").trim().toLowerCase() === FUTAPULSE_ADMIN_EMAIL;
}

app.get("/api/admin/cloudinary/verify", async (request, response) => {
  try {
    const reviewer = await getAuthenticatedUser(request);
    if (!reviewer) return response.status(401).json({ error: "Authentication required." });
    if (!isFutapulseAdmin(reviewer)) return response.status(403).json({ error: "Only the authorized FUTApulse account can verify Cloudinary configuration." });

    const missingVariables = getMissingCloudinaryVariables();
    if (missingVariables.length) {
      return response.status(503).json({
        configured: false,
        valid: false,
        category: "missing_credentials",
        missingVariables
      });
    }

    configureCloudinary();
    try {
      await cloudinary.api.ping({ timeout: 10_000 });
      return response.json({ configured: true, valid: true });
    } catch (error) {
      const category = classifyCloudinaryError(error);
      console.error("Cloudinary credential verification failed.", {
        category,
        status: Number(error?.http_code || error?.statusCode) || null
      });
      return response.status(502).json({
        configured: true,
        valid: false,
        category,
        error: cloudinaryErrorMessage(error, "Cloudinary")
      });
    }
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return response.status(401).json({ error: "Your session is no longer valid." });
    }
    console.error("Cloudinary credential verification could not run.", error);
    return response.status(500).json({ error: "Unable to verify Cloudinary configuration right now." });
  }
});

app.post("/api/events/:eventId/report", async (request, response) => {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return response.status(401).json({ error: "Sign in before reporting an event." });
    const database = isMongoConnected() ? { users: [], events: [] } : readDatabase();
    const event = await findStoredEvent(request.params.eventId);
    if (!event || !["Published", "Live"].includes(event.status)) return response.status(404).json({ error: "This event is no longer available to report." });
    const reporterId = String(user._id || user.id);
    if (String(event.createdByUserId || "") === reporterId) return response.status(403).json({ error: "You cannot report your own event." });

    const allowedReasons = new Set(["misleading", "inappropriate", "duplicate", "other"]);
    const reason = allowedReasons.has(request.body?.reason) ? request.body.reason : "other";
    const details = typeof request.body?.details === "string" ? request.body.details.trim().slice(0, 500) : "";
    const reports = await listStoredReports();
    let reportCase = reports.find((item) => String(item.eventId) === String(event.id));
    if (!reportCase) {
      reportCase = { eventId: event.id, posterUserId: String(event.createdByUserId || ""), reporterIds: [], reports: [], status: "collecting", emailSentAt: null, createdAt: new Date().toISOString() };
    }
    if (["ignored", "banned"].includes(reportCase.status)) {
      reportCase.previousReviews = [...(reportCase.previousReviews || []), { status: reportCase.status, reporterIds: reportCase.reporterIds, reports: reportCase.reports, reviewedAt: reportCase.reviewedAt, reviewerEmail: reportCase.reviewerEmail }];
      reportCase.reporterIds = [];
      reportCase.reports = [];
      reportCase.status = "collecting";
      reportCase.emailSentAt = null;
      reportCase.reviewedAt = null;
      reportCase.reviewerEmail = "";
    }
    if (reportCase.status !== "collecting" && !(reportCase.status === "pending_review" && !reportCase.emailSentAt)) return response.status(409).json({ error: "This event has already been sent for review." });
    const alreadyReported = reportCase.reporterIds.includes(reporterId);
    if (alreadyReported && !(reportCase.status === "pending_review" && !reportCase.emailSentAt)) return response.status(409).json({ error: "You have already reported this event." });

    if (!alreadyReported) {
      reportCase.reporterIds.push(reporterId);
      reportCase.reports.push({ reporterUserId: reporterId, reporterUsername: user.username, reason, details, createdAt: new Date().toISOString() });
    }
    if (reportCase.reporterIds.length >= EVENT_REPORT_REVIEW_THRESHOLD) reportCase.status = "pending_review";
    await storeReport(reportCase);

    if (reportCase.status === "pending_review" && !reportCase.emailSentAt) {
      const reportUrl = new URL(FRONTEND_URL);
      reportUrl.searchParams.set("event", event.id);
      reportUrl.searchParams.set("category", event.category || "all");
      reportUrl.hash = "home";
      try {
        await deliverEmail({
          to: FUTAPULSE_ADMIN_EMAIL,
          subject: `FUTApulse event needs review: ${event.title}`,
          text: [
            `This event received ${reportCase.reporterIds.length} reports and is waiting for your review. No action has been taken.`,
            "",
            `Event: ${event.title}`,
            `Organizer: ${event.organizerName || "Campus Organizer"}`,
            `Category: ${event.category}`,
            `Venue: ${event.venue}`,
            `Starts: ${event.date}`,
            `Ends: ${event.endTime}`,
            `Reports: ${reportCase.reporterIds.length}`,
            "",
            `Open the event in FUTApulse: ${reportUrl.toString()}`,
            "Sign in with the developer FUTApulse account, then open Profile options > Reported event review to choose Ban or Ignore."
          ].join("\n")
        });
        reportCase.emailSentAt = new Date().toISOString();
        await storeReport(reportCase);
      } catch (emailError) {
        console.error("Event report reached the review threshold, but the email could not be sent.", emailError);
        return response.status(503).json({ error: "Your report was saved, but the review email could not be sent. Please try again later." });
      }
    }
    return response.status(alreadyReported ? 200 : 201).json({ message: alreadyReported ? "The review email was retried." : "Thanks. Your report has been recorded.", reportCount: reportCase.reporterIds.length, sentForReview: reportCase.status === "pending_review" });
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) return response.status(401).json({ error: "Your session is no longer valid. Sign in again." });
    console.error("Event report submission failed.", error);
    return response.status(500).json({ error: "Unable to submit this report right now." });
  }
});

app.get("/api/admin/event-reports", async (request, response) => {
  try {
    const reviewer = await getAuthenticatedUser(request);
    if (!reviewer) return response.status(401).json({ error: "Authentication required." });
    if (!isFutapulseAdmin(reviewer)) return response.status(403).json({ error: "Only the authorized FUTApulse account can review event reports." });
    const database = isMongoConnected() ? { users: [], events: [] } : readDatabase();
    const pendingCases = (await listStoredReports()).filter((item) => item.status === "pending_review");
    const allEvents = await listStoredEvents();
    const events = await decorateEventsWithCurrentOrganizers(pendingCases.map((item) => allEvents.find((event) => String(event.id) === String(item.eventId))).filter(Boolean), database);
    const eventsById = new Map(events.map((event) => [event.id, event]));
    return response.json({ reports: pendingCases.filter((item) => eventsById.has(item.eventId)).map((item) => ({ ...item, event: eventsById.get(item.eventId) })) });
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) return response.status(401).json({ error: "Your session is no longer valid. Sign in again." });
    console.error("Event report review queue failed.", error);
    return response.status(500).json({ error: "Unable to load event reports." });
  }
});

app.post("/api/admin/event-reports/:eventId/decision", async (request, response) => {
  try {
    const reviewer = await getAuthenticatedUser(request);
    if (!reviewer) return response.status(401).json({ error: "Authentication required." });
    if (!isFutapulseAdmin(reviewer)) return response.status(403).json({ error: "Only the authorized FUTApulse account can review event reports." });
    const decision = request.body?.decision;
    if (!["ban", "ignore"].includes(decision)) return response.status(400).json({ error: "Choose Ban or Ignore." });
    const database = isMongoConnected() ? { users: [], events: [] } : readDatabase();
    const reportCase = (await listStoredReports()).find((item) => String(item.eventId) === String(request.params.eventId) && item.status === "pending_review");
    if (!reportCase) return response.status(404).json({ error: "This event report is no longer awaiting review." });
    const event = await findStoredEvent(reportCase.eventId);
    if (!event) return response.status(404).json({ error: "The reported event could not be found." });
    if (decision === "ban") {
      if (!reportCase.posterUserId) return response.status(409).json({ error: "This event has no verified owner account to ban." });
      const banUntil = new Date(Date.now() + (7 * 24 * 60 * 60 * 1000));
      if (isMongoConnected()) {
        if (!mongoose.isValidObjectId(reportCase.posterUserId)) return response.status(404).json({ error: "The event owner account could not be found." });
        const owner = await User.findById(reportCase.posterUserId).exec();
        if (!owner) return response.status(404).json({ error: "The event owner account could not be found." });
        owner.postingBanUntil = banUntil;
        await owner.save();
      } else {
        const owner = database.users.find((item) => item.id === reportCase.posterUserId);
        if (!owner) return response.status(404).json({ error: "The event owner account could not be found." });
        owner.postingBanUntil = banUntil.toISOString();
      }
      reportCase.status = "banned";
      reportCase.postingBanUntil = banUntil.toISOString();
    } else {
      reportCase.status = "ignored";
    }
    reportCase.reviewedAt = new Date().toISOString();
    reportCase.reviewerEmail = reviewer.email;
    await storeReport(reportCase);
    return response.json({ message: decision === "ban" ? "The event owner is blocked from posting for seven days." : "The reports were dismissed with no penalty.", decision, eventId: event.id });
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) return response.status(401).json({ error: "Your session is no longer valid. Sign in again." });
    console.error("Event report decision failed.", error);
    return response.status(500).json({ error: "Unable to apply this review decision." });
  }
});

app.patch("/api/events/:eventId/engagement", async (request, response) => {
  try {
  const type = request.body?.type;
  const counter = ENGAGEMENT_COUNTERS[type];
  if (!counter) {
    return response.status(400).json({ error: "Engagement type must be one of: flame, reminder, rsvp." });
  }
  let user = null;
  try {
    user = await getAuthenticatedUser(request);
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return response.status(401).json({ error: "Your session is no longer valid. Sign in again." });
    }
    throw error;
  }
  if (!user) return response.status(401).json({ error: "Sign in to update an event interaction." });
  if (type === "rsvp" && typeof request.body?.attending !== "boolean") {
    return response.status(400).json({ error: "Attendance must be set to coming or not coming." });
  }
  if (type !== "rsvp" && typeof request.body?.enabled !== "boolean") {
    return response.status(400).json({ error: "Hype and reminder interactions must specify enabled as true or false." });
  }

  const eventId = String(request.params.eventId);
  const userId = String(user._id || user.id);
  const enabled = type === "rsvp" ? request.body.attending : request.body.enabled;
  if (isMongoConnected()) {
    const event = await findStoredEvent(eventId);
    if (!event) return response.status(404).json({ error: "Event not found." });
    const action = { eventId, userId, type };
    const wasEnabled = Boolean(await EngagementAction.exists(action));
    if (enabled && !wasEnabled) {
      try {
        await EngagementAction.updateOne(action, {
          $set: {
            faculty: String(user.profile?.faculty || "").trim().slice(0, 80),
            department: String(user.profile?.department || "").trim().slice(0, 100)
          }
        }, { upsert: true }).exec();
      } catch (error) {
        // The unique compound index makes repeated or racing enables idempotent.
        if (error.code !== 11000) throw error;
      }
    } else if (!enabled) {
      await EngagementAction.deleteOne(action).exec();
    }
    if (type === "rsvp" && enabled && !wasEnabled) {
      try {
        const customReminder = await EngagementAction.findOne({ eventId, userId, type: "reminder" })
          .select("customReminderAt").lean().exec();
        await scheduleDefaultRsvpReminders(event, userId, Boolean(customReminder?.customReminderAt));
        await notifyRsvpSocialProof(event);
      } catch (error) {
        console.error("RSVP succeeded, but event notifications could not be scheduled.", error);
      }
    } else if (type === "rsvp" && !enabled) {
      try {
        await cancelUserEventNotifications(eventId, userId, ["rsvp-reminder-1h", "rsvp-reminder-30m", "rsvp-reminder-start"]);
      } catch (error) {
        console.error("RSVP was removed, but its scheduled reminders could not be cancelled.", error);
      }
    } else if (type === "reminder" && !enabled) {
      try {
        await cancelUserEventNotifications(eventId, userId, ["custom-reminder", "rsvp-reminder-start"]);
        if (await EngagementAction.exists({ eventId, userId, type: "rsvp" })) {
          await scheduleDefaultRsvpReminders(event, userId);
        }
      } catch (error) {
        console.error("Reminder was removed, but its scheduled notification could not be cancelled.", error);
      }
    }
    const updatedEvent = (await listStoredEvents(userId)).find((item) => String(item.id) === eventId);
    if (!updatedEvent) return response.status(404).json({ error: "Event not found." });
    const [decoratedEvent] = await decorateEventsWithCurrentOrganizers([updatedEvent], { users: [], events: [] });
    const hotEligibleUserCount = await getHotEligibleUserCount();
    return response.json({ event: toPublicEvent(withHotStatus(decoratedEvent, hotEligibleUserCount), userId) });
  }

  const database = readDatabase();
  const eventIndex = database.events.findIndex((item) => String(item.id) === eventId);
  if (eventIndex < 0) return response.status(404).json({ error: "Event not found." });
  const event = database.events[eventIndex];
  let changed = false;
  if (type === "rsvp") {
    const attendeeUserIds = Array.isArray(event.attendeeUserIds) ? event.attendeeUserIds.map(String) : [];
    const alreadyAttending = attendeeUserIds.includes(userId);
    if (alreadyAttending !== enabled) {
      event.attendeeUserIds = enabled
        ? [...new Set([...attendeeUserIds, userId])]
        : attendeeUserIds.filter((attendeeId) => attendeeId !== userId);
      const attendanceDelta = enabled ? 1 : -1;
      event.rsvpCount = Math.max(0, (Number(event.rsvpCount ?? event.turnoutCount) || 0) + attendanceDelta);
      event.turnoutCount = event.rsvpCount;
      const faculty = String(user.profile?.faculty || "").trim().slice(0, 80);
      if (faculty) event.turnoutBreakdown = updateFacultyTurnoutBreakdown(event.turnoutBreakdown, faculty, attendanceDelta);
      changed = true;
    }
  } else {
    const userIdsKey = type === "flame" ? "hypedUserIds" : "reminderUserIds";
    const userIds = Array.isArray(event[userIdsKey]) ? [...new Set(event[userIdsKey].map(String))] : [];
    const wasEnabled = userIds.includes(userId);
    if (wasEnabled !== enabled) {
      event[userIdsKey] = enabled ? [...userIds, userId] : userIds.filter((id) => id !== userId);
      event[counter] = Math.max(0, (Number(event[counter]) || 0) + (enabled ? 1 : -1));
      changed = true;
    }
  }
  if (changed) {
    event.updatedAt = new Date().toISOString();
    writeDatabase(database);
  }
  const [updatedEvent] = await decorateEventsWithCurrentOrganizers([event], database);
  const hotEligibleUserCount = await getHotEligibleUserCount(database);
  return response.json({ event: toPublicEvent(withHotStatus(updatedEvent, hotEligibleUserCount), userId) });
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return response.status(401).json({ error: "Your session is no longer valid. Sign in again." });
    }
    console.error("Event engagement update failed.", error);
    return response.status(500).json({ error: "Unable to update this event interaction right now." });
  }
});

app.post("/api/events/:eventId/reminders/schedule", async (request, response) => {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return response.status(401).json({ error: "Sign in to schedule an event reminder." });
    if (!isMongoConnected()) return response.status(503).json({ error: "Durable reminders require the shared MongoDB database. Configure MONGO_URI and retry." });
    const event = await findStoredEvent(request.params.eventId);
    if (!event || !["Published", "Live"].includes(event.status)) return response.status(404).json({ error: "This event is no longer available." });
    const notifyAt = typeof request.body?.notifyAt === "string" ? request.body.notifyAt : "";
    if (!Number.isFinite(new Date(notifyAt).getTime())) return response.status(400).json({ error: "Choose a valid reminder time." });
    const userId = String(user._id || user.id);
    const reminderAt = new Date(notifyAt);
    await scheduleCustomEventReminder(event, userId, reminderAt);
    await EngagementAction.updateOne(
      { eventId: String(event.id), userId, type: "reminder" },
      { $set: { faculty: String(user.profile?.faculty || "").trim().slice(0, 80), department: String(user.profile?.department || "").trim().slice(0, 100), customReminderAt: reminderAt } },
      { upsert: true }
    ).exec();
    await scheduleDefaultRsvpReminders(event, userId, true);
    return response.status(201).json({ scheduled: true, notifyAt: reminderAt.toISOString() });
  } catch (error) {
    if (error.message?.includes("Choose a reminder time")) return response.status(400).json({ error: error.message });
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) return response.status(401).json({ error: "Session is no longer valid." });
    console.error("Custom event reminder scheduling failed.", error);
    return response.status(500).json({ error: "Unable to schedule this reminder right now." });
  }
});

app.post("/api/events/:eventId/hype", async (request, response) => {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return response.status(401).json({ error: "Sign in to hype this event." });
    if (typeof request.body?.enabled !== "boolean") return response.status(400).json({ error: "Specify whether hype should be turned on or off." });
    const eventId = String(request.params.eventId);
    const userId = String(user._id || user.id);
    if (isMongoConnected()) {
      const event = await findStoredEvent(eventId);
      if (!event) return response.status(404).json({ error: "Event not found." });
      const action = { eventId, userId, type: "flame" };
      if (request.body.enabled) {
        try {
          await EngagementAction.updateOne(action, { $set: { faculty: String(user.profile?.faculty || "").trim().slice(0, 80) } }, { upsert: true }).exec();
        } catch (error) {
          if (error.code !== 11000) throw error;
        }
      } else {
        await EngagementAction.deleteOne(action).exec();
      }
      const updatedEvent = (await listStoredEvents(userId)).find((item) => String(item.id) === eventId);
      if (!updatedEvent) return response.status(404).json({ error: "Event not found." });
      const [decoratedEvent] = await decorateEventsWithCurrentOrganizers([updatedEvent], { users: [], events: [] });
      return response.json({ event: toPublicEvent(decoratedEvent, userId), hypeCount: updatedEvent.flameCount || 0 });
    }

    const database = readDatabase();
    const eventIndex = database.events.findIndex((item) => String(item.id) === eventId);
    if (eventIndex < 0) return response.status(404).json({ error: "Event not found." });
    const event = database.events[eventIndex];
    const hypedUserIds = Array.isArray(event.hypedUserIds) ? [...new Set(event.hypedUserIds.map(String))] : [];
    const wasHyped = hypedUserIds.includes(userId);
    if (wasHyped !== request.body.enabled) {
      event.hypedUserIds = request.body.enabled ? [...hypedUserIds, userId] : hypedUserIds.filter((id) => id !== userId);
      event.flameCount = Math.max(0, (Number(event.flameCount) || 0) + (request.body.enabled ? 1 : -1));
      event.updatedAt = new Date().toISOString();
      writeDatabase(database);
    }
    const [updatedEvent] = await decorateEventsWithCurrentOrganizers([event], database);
    const hotEligibleUserCount = await getHotEligibleUserCount(database);
    return response.json({ event: toPublicEvent(withHotStatus(updatedEvent, hotEligibleUserCount), userId), hypeCount: event.flameCount || 0 });
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) return response.status(401).json({ error: "Your session is no longer valid. Sign in again." });
    console.error("Event hype update failed.", error);
    return response.status(500).json({ error: "Unable to update event hype right now." });
  }
});

app.get("/api/events/:eventId", async (request, response) => {
  try {
    const authorization = request.get("authorization") || "";
    const user = authorization.startsWith("Bearer ") ? await getAuthenticatedUser(request) : null;
    if (authorization.startsWith("Bearer ") && !user) return response.status(401).json({ error: "Session is no longer valid." });
    const viewerId = user ? String(user._id || user.id) : "";
    const event = await findStoredEvent(request.params.eventId);
    if (!event) return response.status(404).json({ error: "Event not found." });
    const isOwner = Boolean(viewerId && String(event.createdByUserId || "") === viewerId);
    const eventEnd = new Date(event.endTime || "").getTime();
    const ownerEndedRecently = isOwner && Number.isFinite(eventEnd)
      && event.status !== "Cancelled"
      && eventEnd <= Date.now()
      && Date.now() - eventEnd <= 7 * 24 * 60 * 60_000;
    const publicRecapVisible = isPublicRecapVisible(event);
    const cancellationDate = new Date(event.cancelledAt || "").getTime();
    const cancellationVisible = event.status === "Cancelled"
      && Number.isFinite(cancellationDate)
      && Date.now() - cancellationDate <= 7 * 24 * 60 * 60_000;
    if (!cancellationVisible && !publicRecapVisible && !ownerEndedRecently
      && !(["Published", "Live"].includes(event.status) && isWithinEventDisplayWindow(event))) {
      return response.status(404).json({ error: "This event is no longer available." });
    }
    const [decoratedEvent] = await decorateEventsWithCurrentOrganizers([event], isMongoConnected() ? { users: [], events: [] } : readDatabase());
    return response.json({ event: toPublicEvent(decoratedEvent, viewerId) });
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) return response.status(401).json({ error: "Session is no longer valid." });
    console.error("Event link request failed.", error);
    return response.status(500).json({ error: "Unable to load this event." });
  }
});

app.use("/Faculty Logo", express.static(path.join(__dirname, "Faculty Logo")));
app.use("/Faculty%20Logo", express.static(path.join(__dirname, "Faculty Logo")));
app.use(express.static(CLIENT_DIST));
app.get("/", (request, response) => {
  const clientEntry = path.join(CLIENT_DIST, "index.html");
  if (!fs.existsSync(clientEntry)) {
    return response.status(503).type("text/plain").send("FUTApulse frontend is not built. Run npm --prefix client run build.");
  }
  return response.sendFile(clientEntry);
});
app.use((error, request, response, next) => {
  if (error instanceof SyntaxError && "body" in error) return response.status(400).json({ error: "Request body must be valid JSON." });

  console.error("Unhandled API error.", error);
  return response.status(500).json({ error: "Internal server error." });
});

async function startServer() {
  const listen = async () => {
    initializePushProviders();
    realtimeServer = new SocketServer(httpServer, {
      cors: { origin: process.env.CORS_ORIGIN ? CORS_ORIGINS : true, credentials: true },
      transports: ["websocket", "polling"],
      pingTimeout: 20_000,
      pingInterval: 25_000
    });
    if (process.env.SOCKET_REDIS_URL) {
      const pubClient = createRedisClient({ url: process.env.SOCKET_REDIS_URL });
      const subClient = pubClient.duplicate();
      pubClient.on("error", (error) => console.error("Socket.IO Redis publisher error.", error.code || "connection error"));
      subClient.on("error", (error) => console.error("Socket.IO Redis subscriber error.", error.code || "connection error"));
      try {
        await Promise.all([pubClient.connect(), subClient.connect()]);
        realtimeServer.adapter(createSocketRedisAdapter(pubClient, subClient));
        socketRedisClients = [pubClient, subClient];
        console.log("Socket.IO Redis adapter connected for cross-instance delivery.");
      } catch (error) {
        await Promise.allSettled([pubClient.quit(), subClient.quit()]);
        throw new Error(`SOCKET_REDIS_URL is configured but the Socket.IO Redis adapter could not connect (${error.code || "connection error"}).`);
      }
    } else if (process.env.NODE_ENV === "production") {
      console.warn("SOCKET_REDIS_URL is not set; live Socket.IO broadcasts are limited to this API instance.");
    }
    httpServer.once("close", () => {
      void Promise.allSettled(socketRedisClients.map((client) => client.quit()));
      socketRedisClients = [];
    });
    realtimeServer.use(async (socket, next) => {
      try {
        const token = typeof socket.handshake.auth?.token === "string" ? socket.handshake.auth.token : "";
        if (!token) return next(new Error("Authentication required."));
        const claims = jwt.verify(token, JWT_SECRET);
        if (claims.tokenUse !== "access") return next(new Error("Session is no longer valid."));
        const user = isMongoConnected()
          ? await findMongoUserById(claims.sub)
          : readDatabase().users.find((storedUser) => storedUser.id === claims.sub) || null;
        if (!user || (claims.sessionVersion || 0) !== (user.sessionVersion || 0)) return next(new Error("Session is no longer valid."));
        socket.data.userId = String(user._id || user.id);
        socket.data.sessionVersion = Number(user.sessionVersion) || 0;
        return next();
      } catch (error) {
        return next(new Error(error instanceof jwt.JsonWebTokenError ? "Session is no longer valid." : "Unable to authenticate the live connection."));
      }
    });
    realtimeServer.on("connection", (socket) => {
      socket.join(`user:${socket.data.userId}`);
      socket.data.notificationForeground = false;
      socket.on("notification-visibility", (visible) => {
        socket.data.notificationForeground = visible === true;
      });
    });
    httpServer.listen(PORT, "0.0.0.0", () => {
      console.log(`FUTApulse API listening on port ${PORT}`);
      const vapidConfiguration = initializePushProviders();
      if (vapidConfiguration.valid) console.log("Web Push VAPID credentials are valid.");
      if (!vapidConfiguration.valid) {
        console.warn(`Web Push is unavailable: ${vapidConfiguration.error}`);
      }
      if (!process.env.WEB_PUSH_PUBLIC_KEY && !process.env.WEB_PUSH_PRIVATE_KEY) {
        console.warn("Web Push credentials are missing. Browser/OS permission alone cannot enable closed-app delivery. Configure Web Push credentials in Render.");
      }
    });
    if (isMongoConnected()) {
      notificationWorkerTimer = setInterval(() => {
        if (notificationWorkerInFlight) return;
        notificationWorkerInFlight = true;
        void runNotificationWorker({ limit: 20 })
          .catch((error) => console.error("Notification worker tick failed.", error))
          .finally(() => { notificationWorkerInFlight = false; });
      }, 1000);
      notificationWorkerTimer.unref?.();
    }
    return httpServer;
  };

  if (!process.env.MONGO_URI) {
    ensureDatabase();
    console.warn("MONGO_URI is not set; using local fallback storage in development.");
    return listen();
  }

  return mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
    maxPoolSize: 10
  })
    .then(async () => {
      await Promise.all([
        User.init(), EmailChallenge.init(), EventRecord.init(), EngagementAction.init(), EventReport.init(),
        EventView.init(), RecapPromptDismissal.init(),
        PushDevice.init(), NotificationJob.init()
      ]);
      databaseBackend = "mongodb";
      console.log("FUTApulse connected to MongoDB and verified indexes.");
      return listen();
    })
    .catch((error) => {
      throw new Error(`MongoDB is configured but unavailable; API startup stopped to prevent writes going to a separate local database: ${error.message}`);
    });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error("FUTApulse API startup failed.", error);
    process.exitCode = 1;
  });
}

module.exports = {
  app,
  startServer,
  models: { User, EmailChallenge, EventRecord, EngagementAction, EventReport, EventView, RecapPromptDismissal, PushDevice, NotificationJob },
  buildFacultyTurnoutBreakdown,
  buildRsvpReminderSchedule,
  buildCriticalEventUpdateDetails,
  describeWebPushFailure,
  validateVapidCredentials
};
