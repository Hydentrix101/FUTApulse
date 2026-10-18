const APPROVED_ACCOUNT_EMAILS = new Set([
  'immanuelidowu1@gmail.com',
  'hydentrix@gmail.com',
])

function buildApprovedMigrationPlan(database = {}) {
  const users = Array.isArray(database.users) ? database.users : []
  const events = Array.isArray(database.events) ? database.events : []
  const reports = Array.isArray(database.eventReports) ? database.eventReports : []
  const approvedUsers = users.filter((user) => APPROVED_ACCOUNT_EMAILS.has(String(user.email || '').trim().toLowerCase()))
  const approvedUserIds = new Set(approvedUsers.map((user) => String(user.id || '')))
  const approvedEventRecords = events.filter((event) => approvedUserIds.has(String(event.createdByUserId || '')))
  const approvedEventIds = new Set(approvedEventRecords.map((event) => String(event.id || '')))
  const approvedReports = reports.filter((report) => approvedEventIds.has(String(report.eventId || '')))

  return {
    users: approvedUsers,
    events: approvedEventRecords,
    reports: approvedReports,
    summary: {
      approvedAccounts: approvedUsers.length,
      approvedEvents: approvedEventRecords.length,
      reportsForApprovedEvents: approvedReports.length,
      excludedAccounts: users.length - approvedUsers.length,
      excludedEvents: events.length - approvedEventRecords.length,
    },
  }
}

module.exports = { APPROVED_ACCOUNT_EMAILS, buildApprovedMigrationPlan }
