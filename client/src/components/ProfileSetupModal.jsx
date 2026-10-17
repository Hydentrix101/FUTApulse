import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { isValidUsername } from '../utils/usernames'

const DEPARTMENTS = {
  SAAT: ['AEC', 'ARE', 'APH', 'CSP', 'FAT', 'EWM', 'FWT', 'FST'],
  SBCS: ['PAT', 'FAR', 'CHE'],
  SBMS: ['ANA', 'BIM', 'MLS', 'PHS'],
  SCS: ['MED', 'SUR', 'OBS', 'PED'],
  SEET: ['AGE', 'BME', 'CEE', 'CVE', 'CPE', 'EEE', 'IPE', 'ICE', 'MEE', 'MCE', 'MNE', 'MME'],
  SEMS: ['AGY', 'AGP', 'MST', 'MCS', 'RSG'],
  SET: ['ARC', 'BDG', 'ESM', 'IDD', 'QSV', 'SVG', 'TDT', 'URP'],
  SLIT: ['BIT', 'BMT', 'EMT', 'LTT', 'PMT', 'SIMT'],
  SLS: ['BCH', 'BIO', 'BTH', 'MCB'],
  SOC: ['CSC', 'CYS', 'IFS', 'IFT', 'SEN'],
  SPS: ['CHM', 'EDT', 'LIS', 'MTS', 'PHY', 'STA'],
}

function ProfileSetupModal({
  profile,
  username: currentUsername = '',
  editableFields = {},
  onClose,
  onSave,
  saving,
}) {
  const [faculty, setFaculty] = useState(profile?.faculty || '')
  const [department, setDepartment] = useState(profile?.department || '')
  const [level, setLevel] = useState(profile?.level || '')
  const [username, setUsername] = useState(profile?.name || currentUsername)
  const [error, setError] = useState('')
  const departments = useMemo(() => DEPARTMENTS[faculty] || [], [faculty])
  const usernameChanges = Number(editableFields.usernameChanges) || 0
  const facultyChanges = Number(editableFields.facultyChanges) || 0

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    const displayName = username.trim()
    if (!isValidUsername(displayName)) {
      setError('Use 3–24 characters with at least one letter. Accents and letters from any language are supported.')
      return
    }
    try {
      await onSave({
        ...(profile || {}),
        username: displayName,
        name: displayName,
        faculty,
        department,
        level,
        role: 'explorer',
        picture: profile?.picture || `/Faculty%20Logo/${encodeURIComponent(faculty)}.png`,
      })
    } catch (saveError) {
      setError(saveError.message || 'Unable to save your profile.')
    }
  }

  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="profile-sheet glass-panel" role="dialog" aria-modal="true" aria-labelledby="profile-setup-title">
        <button className="sheet-close" type="button" onClick={onClose} aria-label="Close profile editor"><X size={18} /></button>
        <span className="eyebrow-label">{profile ? 'YOUR CAMPUS ID' : 'BUILD YOUR CAMPUS ID'}</span>
        <h2 id="profile-setup-title">{profile ? 'Edit your profile' : 'Tell FUTApulse about you'}</h2>
        <p className="setup-intro">{profile ? 'Your username is also the name displayed on your profile.' : 'Your username is also your profile name. Add your academic details so students can find their people.'} Accents and letters from any language are supported.</p>

        <form className="profile-form" onSubmit={submit}>
          <label htmlFor="profile-username">Username / profile name</label>
          <input
            id="profile-username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            minLength={3}
            maxLength={24}
            disabled={usernameChanges >= 2}
            required
          />
          <small className="profile-edit-limit">{usernameChanges >= 2 ? 'Username/profile name change limit reached; this field is locked.' : `You can change your username/profile name ${2 - usernameChanges} more time${2 - usernameChanges === 1 ? '' : 's'}.`}</small>
          <label htmlFor="profile-faculty">Faculty / school</label>
          <select id="profile-faculty" value={faculty} onChange={(event) => { setFaculty(event.target.value); setDepartment('') }} disabled={facultyChanges >= 2} required>
            <option value="">Select your faculty</option>
            {Object.keys(DEPARTMENTS).map((name) => <option key={name}>{name}</option>)}
          </select>
          <small className="profile-edit-limit">{facultyChanges >= 2 ? 'Faculty change limit reached; this field is locked.' : `You can change your faculty ${2 - facultyChanges} more time${2 - facultyChanges === 1 ? '' : 's'}.`}</small>
          <label htmlFor="profile-department">Department</label>
          <select id="profile-department" value={department} onChange={(event) => setDepartment(event.target.value)} disabled={!departments.length} required>
            <option value="">{departments.length ? 'Select your department' : 'Select faculty first'}</option>
            {departments.map((name) => <option key={name}>{name}</option>)}
          </select>
          <label htmlFor="profile-level">Academic level</label>
          <select id="profile-level" value={level} onChange={(event) => setLevel(event.target.value)} required>
            <option value="">Select your level</option>
            {[100, 200, 300, 400, 500].map((value) => <option key={value} value={String(value)}>{value} level</option>)}
          </select>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="setup-submit" type="submit" disabled={saving}>{saving ? 'Saving…' : profile ? 'Save changes' : 'Complete profile'} <span>→</span></button>
        </form>
      </section>
    </div>
  )
}

export default ProfileSetupModal
