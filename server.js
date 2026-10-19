const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");

if (fs.existsSync(path.join(__dirname, ".env"))) process.loadEnvFile(path.join(__dirname, ".env"));

const EMAIL_SEND_TIMEOUT_MS = 15_000;
const PORT = Number(process.env.PORT || 3001);
const ROOT = __dirname;
const CLIENT_DIST = path.join(ROOT, "client", "dist");
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = process.env.FUTAPULSE_DATA_FILE || path.join(DATA_DIR, "futapulse.json");
const app = express();
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

function toPublicEvent(event, viewerId = "") {
  const {
    attendeeUserIds = [],
    hypedUserIds = [],
    reminderUserIds = [],
    ...publicEvent
  } = event;
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
  record: { type: mongoose.Schema.Types.Mixed, required: true }
}, { timestamps: true, minimize: false });
eventRecordSchema.index({ status: 1, endsAt: 1 });
eventRecordSchema.index({ category: 1, status: 1, startsAt: 1 });
const EventRecord = mongoose.models.FutapulseEvent || mongoose.model("FutapulseEvent", eventRecordSchema, "events");

const engagementActionSchema = new mongoose.Schema({
  eventId: { type: String, required: true },
  userId: { type: String, required: true },
  type: { type: String, enum: ["rsvp", "flame", "reminder"], required: true },
  faculty: { type: String, default: "" }
}, { timestamps: true });
engagementActionSchema.index({ eventId: 1, userId: 1, type: 1 }, { unique: true });
engagementActionSchema.index({ userId: 1, type: 1, updatedAt: -1 });
const EngagementAction = mongoose.models.FutapulseEngagementAction
  || mongoose.model("FutapulseEngagementAction", engagementActionSchema, "engagement_actions");

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

async function listStoredEvents(viewerId = "") {
  if (!isMongoConnected()) return readDatabase().events;
  const records = await EventRecord.find({}).lean().exec();
  const events = records.map((item) => item.record).filter(Boolean);
  if (!events.length) return events;
  const eventIds = events.map((event) => String(event.id));
  const actions = await EngagementAction.find({ eventId: { $in: eventIds } }).select("eventId userId type faculty").lean().exec();
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
    database.engagementActionIds = (database.engagementActionIds || []).filter((actionKey) => {
      const separator = String(actionKey).indexOf(":");
      return separator < 0 || String(actionKey).slice(0, separator) !== String(eventId);
    });
    writeDatabase(database);
    return;
  }
  await Promise.all([
    EventRecord.deleteOne({ eventId: String(eventId) }).exec(),
    EventReport.deleteOne({ eventId: String(eventId) }).exec(),
    EngagementAction.deleteMany({ eventId: String(eventId) }).exec()
  ]);
}

async function deleteStoredEventsForOwner(ownerUserId) {
  const ownerId = String(ownerUserId);
  if (!isMongoConnected()) {
    const database = readDatabase();
    const ownedIds = new Set(database.events.filter((event) => String(event.createdByUserId || "") === ownerId).map((event) => String(event.id)));
    database.events = database.events.filter((event) => !ownedIds.has(String(event.id)));
    database.eventReports = (database.eventReports || []).filter((item) => !ownedIds.has(String(item.eventId)));
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
    EngagementAction.deleteMany({ $or: [
      { userId: ownerId },
      ...(eventIds.length ? [{ eventId: { $in: eventIds } }] : [])
    ] }).exec()
  ]);
}

function normalizeUser(user) {
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
    profile: user.profile || { name: user.username }
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
  let message = String(error?.message || "No provider message.")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
  for (const secret of [process.env.GOOGLE_CLIENT_SECRET, process.env.GMAIL_REFRESH_TOKEN]) {
    if (secret && secret.length > 4) message = message.replaceAll(secret, "[redacted]");
  }
  return {
    name: String(error?.name || "Error").slice(0, 80),
    code: String(error?.code || "").slice(0, 80),
    statusCode: Number.isInteger(error?.statusCode)
      ? error.statusCode
      : Number.isInteger(error?.response?.status) ? error.response.status : null,
    message: message.slice(0, 300)
  };
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
      const error = new Error(`Gmail API rejected the message (${response.status}).`);
      error.code = "EMAIL_DELIVERY_FAILED";
      error.statusCode = response.status;
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
      const error = new Error(cause.statusCode
        ? `Gmail API rejected the message (${cause.statusCode}).`
        : "Gmail API did not confirm that the message was accepted.");
      error.code = "EMAIL_DELIVERY_FAILED";
      error.statusCode = cause.statusCode;
      throw error;
    }
    const error = new Error("Gmail API email delivery failed or timed out. Check the OAuth refresh token, Gmail API access, and sender-account configuration.", { cause });
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
app.use(cors({
  origin: process.env.CORS_ORIGIN ? CORS_ORIGINS : true,
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-FUTApulse-OAuth-Request"],
  credentials: true
}));
app.use(express.json({ limit: "4mb" }));

app.get("/api/health", (request, response) => {
  response.json({
    ok: true,
    service: "futapulse-api",
    database: databaseBackend === "mongodb" ? "mongodb" : "local-fallback",
    databaseConnected: isMongoConnected(),
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
      communityGuidelinesAcceptedAt: user.profile?.communityGuidelinesAcceptedAt || null
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
      communityGuidelinesAcceptedAt: user.profile?.communityGuidelinesAcceptedAt || null
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
      await User.deleteOne({ _id: user._id }).exec();
    } else {
      const database = readDatabase();
      database.users = database.users.filter((item) => item.id !== user.id);
      database.profiles = database.profiles.filter((item) => item.userId !== user.id);
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
    const storedEvents = await listStoredEvents(viewerId);
    const level = request.query.level;
    const category = request.query.category;
    let events = storedEvents.filter((event) => {
      const isOwnerDraft = Boolean(user && event.status === "Draft" && String(event.createdByUserId || "") === String(user._id || user.id));
      return isOwnerDraft
        || (["Published", "Live"].includes(event.status) && isWithinEventDisplayWindow(event));
    });
    if (level) events = events.filter((event) => !event.audience || event.audience.includes("all") || event.audience.includes(level));
    if (category && category !== "all") events = events.filter((event) => event.category === category);
    events = await decorateEventsWithCurrentOrganizers(events, database);
    return response.json({ events: events.map((event) => toPublicEvent(event, viewerId)) });
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return response.status(401).json({ error: "Session is no longer valid." });
    }
    console.error("Event list request failed.", error);
    return response.status(500).json({ error: "Unable to load campus events." });
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
    const events = await listStoredEvents(viewerId);
    const updates = events
      .filter((event) => ["Published", "Live"].includes(event.status) && isWithinEventDisplayWindow(event))
      .map((event) => {
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
          isHot: (rsvpCount * 2) + (reminderCount * 3) + flameCount >= HOT_EVENT_THRESHOLD
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

const HOT_EVENT_THRESHOLD = 10;
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

function getEventHotScore(event) {
  const rsvps = Number(event.rsvpCount ?? event.turnoutCount) || 0;
  const reminders = Number(event.reminderCount) || 0;
  const flames = Number(event.flameCount) || 0;
  return (rsvps * 2) + (reminders * 3) + flames;
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
  const storedEvents = await listStoredEvents();
  const events = storedEvents
    .filter((event) => {
      if (!["Published", "Live"].includes(event.status)) return false;
      return isWithinEventDisplayWindow(event);
    })
    .map((event) => {
      const hotScore = getEventHotScore(event);
      return { ...event, hotScore, isHot: hotScore >= HOT_EVENT_THRESHOLD };
    })
    .filter((event) => event.hotScore >= HOT_EVENT_THRESHOLD)
    .sort((a, b) => b.hotScore - a.hotScore)
    .slice(0, 5);
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
    const event = {
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
      await storeEvent(event);
      return response.status(201).json({ event: toPublicEvent(event), similarEvents: advisoryMatches.map(({ event: match, score }) => ({ event: toPublicEvent(match), score })) });
    }
    await storeEvent(event);
    return response.status(201).json({ event: toPublicEvent(event), similarEvents: [] });
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return response.status(401).json({ error: "Your session is no longer valid. Sign in again." });
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
    const updated = {
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
      await storeEvent(updated);
      return response.json({ event: toPublicEvent(updated), similarEvents: advisoryMatches.map(({ event: match, score }) => ({ event: toPublicEvent(match), score })) });
    }
    await storeEvent(updated);
    return response.json({ event: toPublicEvent(updated), similarEvents: [] });
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return response.status(401).json({ error: "Your session is no longer valid. Sign in again." });
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
    await deleteStoredEvent(event.id);
    return response.json({ message: event.status === "Draft" ? "Draft deleted." : "Event deleted." });
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return response.status(401).json({ error: "Your session is no longer valid. Sign in again." });
    }
    console.error("Event deletion failed.", error);
    return response.status(500).json({ error: "Unable to delete this event right now." });
  }
});

function isFutapulseAdmin(user) {
  return user?.emailVerified === true
    && String(user.email || "").trim().toLowerCase() === FUTAPULSE_ADMIN_EMAIL;
}

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
    if (enabled) {
      try {
        await EngagementAction.updateOne(action, { $set: { faculty: String(user.profile?.faculty || "").trim().slice(0, 80) } }, { upsert: true }).exec();
      } catch (error) {
        // The unique compound index makes repeated or racing enables idempotent.
        if (error.code !== 11000) throw error;
      }
    } else {
      await EngagementAction.deleteOne(action).exec();
    }
    const updatedEvent = (await listStoredEvents(userId)).find((item) => String(item.id) === eventId);
    if (!updatedEvent) return response.status(404).json({ error: "Event not found." });
    const [decoratedEvent] = await decorateEventsWithCurrentOrganizers([updatedEvent], { users: [], events: [] });
    return response.json({ event: toPublicEvent(decoratedEvent, userId) });
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
    event.hotScore = getEventHotScore(event);
    event.isHot = event.hotScore >= HOT_EVENT_THRESHOLD;
    writeDatabase(database);
  }
  const [updatedEvent] = await decorateEventsWithCurrentOrganizers([event], database);
  return response.json({ event: toPublicEvent(updatedEvent, userId) });
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return response.status(401).json({ error: "Your session is no longer valid. Sign in again." });
    }
    console.error("Event engagement update failed.", error);
    return response.status(500).json({ error: "Unable to update this event interaction right now." });
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
      event.hotScore = getEventHotScore(event);
      event.isHot = event.hotScore >= HOT_EVENT_THRESHOLD;
      writeDatabase(database);
    }
    const [updatedEvent] = await decorateEventsWithCurrentOrganizers([event], database);
    return response.json({ event: toPublicEvent(updatedEvent, userId), hypeCount: event.flameCount || 0 });
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) return response.status(401).json({ error: "Your session is no longer valid. Sign in again." });
    console.error("Event hype update failed.", error);
    return response.status(500).json({ error: "Unable to update event hype right now." });
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
  const listen = () => app.listen(PORT, "0.0.0.0", () => {
    console.log(`FUTApulse API listening on port ${PORT}`);
  });

  if (!process.env.MONGO_URI) {
    ensureDatabase();
    console.warn("MONGO_URI is not set; using local fallback storage in development.");
    return listen();
  }

  return mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 })
    .then(async () => {
      await Promise.all([User.init(), EmailChallenge.init(), EventRecord.init(), EngagementAction.init(), EventReport.init()]);
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
  models: { User, EmailChallenge, EventRecord, EngagementAction, EventReport },
  buildFacultyTurnoutBreakdown
};
