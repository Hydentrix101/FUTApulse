const fs = require('node:fs')
const path = require('node:path')
const mongoose = require('mongoose')
const { models } = require('../server')
const { buildApprovedMigrationPlan } = require('../server/dataMigration')

const root = path.resolve(__dirname, '..')
const sourceFile = process.env.FUTAPULSE_DATA_FILE || path.join(root, 'data', 'futapulse.json')
const apply = process.argv.includes('--apply')

function mapAccountIds(users, migratedUsers) {
  return new Map(users.map((user, index) => [String(user.id), String(migratedUsers[index]._id)]))
}

function remapActionIds(ids, accountIds) {
  return (Array.isArray(ids) ? ids : []).map((id) => accountIds.get(String(id))).filter(Boolean)
}

async function main() {
  const source = JSON.parse(fs.readFileSync(sourceFile, 'utf8'))
  const plan = buildApprovedMigrationPlan(source)
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', sourceFile: path.relative(root, sourceFile), ...plan.summary }))

  if (!apply) {
    console.log('Dry run only. Add --apply and configure MONGO_URI to write approved records. The local source will be kept unchanged.')
    return
  }
  if (!process.env.MONGO_URI) throw new Error('Set MONGO_URI before applying the migration.')

  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 })
  await Promise.all([models.User.init(), models.EventRecord.init(), models.EngagementAction.init(), models.EventReport.init()])

  const migratedUsers = []
  for (const user of plan.users) {
    const email = String(user.email).trim().toLowerCase()
    let stored = await models.User.findOne({ email }).exec()
    if (!stored) {
      const username = String(user.username || '').trim()
      const conflictingUsername = await models.User.findOne({ username: username.toLowerCase() }).exec()
      if (conflictingUsername) throw new Error(`A different MongoDB account already uses an approved account username (${email}). Resolve that conflict before migration.`)
      stored = await models.User.create({
        email,
        username,
        passwordHash: String(user.passwordHash || ''),
        emailVerified: user.emailVerified === true,
        profile: user.profile && typeof user.profile === 'object' ? user.profile : {},
        usernameChanges: Number(user.usernameChanges) || 0,
        sessionVersion: Number(user.sessionVersion) || 0,
      })
    }
    migratedUsers.push(stored)
  }

  const accountIds = mapAccountIds(plan.users, migratedUsers)
  let insertedEvents = 0
  for (const sourceEvent of plan.events) {
    const ownerUserId = accountIds.get(String(sourceEvent.createdByUserId))
    if (!ownerUserId) continue
    const record = { ...sourceEvent, createdByUserId: ownerUserId }
    for (const [field, actionType] of [['attendeeUserIds', 'rsvp'], ['hypedUserIds', 'flame'], ['reminderUserIds', 'reminder']]) {
      record[field] = remapActionIds(sourceEvent[field], accountIds)
      if (record[field].length) {
        await models.EngagementAction.bulkWrite(record[field].map((userId) => ({
          updateOne: {
            filter: { eventId: String(sourceEvent.id), userId, type: actionType },
            update: { $setOnInsert: { eventId: String(sourceEvent.id), userId, type: actionType } },
            upsert: true,
          },
        })), { ordered: false })
      }
    }
    const startsAt = new Date(sourceEvent.date || sourceEvent.startTime || '')
    const endsAt = new Date(sourceEvent.endTime || '')
    const result = await models.EventRecord.updateOne(
      { eventId: String(sourceEvent.id) },
      { $setOnInsert: {
        eventId: String(sourceEvent.id),
        ownerUserId,
        status: String(sourceEvent.status || 'Draft'),
        category: String(sourceEvent.category || 'unknown'),
        startsAt: Number.isNaN(startsAt.getTime()) ? null : startsAt,
        endsAt: Number.isNaN(endsAt.getTime()) ? null : endsAt,
        record,
      } },
      { upsert: true },
    )
    if (result.upsertedCount) insertedEvents += 1
  }

  for (const report of plan.reports) {
    const posterUserId = accountIds.get(String(report.posterUserId || ''))
    if (!posterUserId) continue
    const remapReportEntries = (entries) => (Array.isArray(entries) ? entries : []).flatMap((entry) => {
      const reporterUserId = accountIds.get(String(entry.reporterUserId || ''))
      return reporterUserId ? [{ ...entry, reporterUserId }] : []
    })
    const previousReviews = (Array.isArray(report.previousReviews) ? report.previousReviews : []).map((review) => ({
      ...review,
      reporterIds: remapActionIds(review.reporterIds, accountIds),
      reports: remapReportEntries(review.reports),
    }))
    const record = {
      ...report,
      posterUserId,
      reporterIds: remapActionIds(report.reporterIds, accountIds),
      reports: remapReportEntries(report.reports),
      previousReviews,
    }
    await models.EventReport.updateOne(
      { eventId: String(report.eventId) },
      { $setOnInsert: {
        eventId: String(report.eventId),
        posterUserId,
        reporterIds: record.reporterIds,
        reports: record.reports,
        status: String(report.status || 'collecting'),
        record,
      } },
      { upsert: true },
    )
  }

  console.log(JSON.stringify({ migratedAccounts: migratedUsers.length, insertedEvents, migratedReportCases: plan.reports.length, localSourceChanged: false }))
}

main()
  .catch((error) => {
    console.error(`Migration stopped safely: ${error.message}`)
    process.exitCode = 1
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect()
  })
