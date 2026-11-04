import { useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { isValidUsername } from '../utils/usernames'
import { DEPARTMENTS, getFacultyLogoPath } from '../utils/faculties'
import useDialogFocus from '../hooks/useDialogFocus'

function ProfileSetupModal({
  profile,
  username: currentUsername = '',
  editableFields = {},
  onClose,
  onSave,
  saving,
}) {
  const [faculty, setFaculty] = useState(() => DEPARTMENTS[profile?.faculty] ? profile.faculty : '')
  const [department, setDepartment] = useState(() => (
    DEPARTMENTS[profile?.faculty]?.includes(profile?.department) ? profile.department : ''
  ))
  const [level, setLevel] = useState(profile?.level || '')
  const [username, setUsername] = useState(profile?.name || currentUsername)
  const [error, setError] = useState('')
  const dialogRef = useRef(null)
  const departments = useMemo(() => DEPARTMENTS[faculty] || [], [faculty])
  const usernameChanges = Number(editableFields.usernameChanges) || 0
  const facultyChanges = Number(editableFields.facultyChanges) || 0
  const legacyFaculty = profile?.faculty === 'SEET'
  useDialogFocus(dialogRef, onClose)

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    const displayName = username.trim()
    if (!isValidUsername(displayName)) {
      setError('Use 3–24 characters with at least one letter. Accents and letters from any language are supported.')
      return
    }
    if (!DEPARTMENTS[faculty]?.includes(department)) {
      setError('Choose a faculty and department from the available options.')
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
        picture: profile?.picture || getFacultyLogoPath(faculty),
      })
    } catch (saveError) {
      setError(saveError.message || 'Unable to save your profile.')
    }
  }

  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section ref={dialogRef} className="profile-sheet glass-panel" role="dialog" aria-modal="true" aria-labelledby="profile-setup-title">
        <button className="sheet-close" type="button" onClick={onClose} aria-label="Close profile editor"><X size={18} /></button>
        <span className="eyebrow-label">{profile ? 'YOUR CAMPUS ID' : 'BUILD YOUR CAMPUS ID'}</span>
        <h2 id="profile-setup-title">{profile ? 'Edit your profile' : 'Tell FUTApulse about you'}</h2>
        <p className="setup-intro">{profile ? 'Your username is also the name displayed on your profile.' : 'Your username is also your profile name. Add your academic details so students can find their people.'} Accents and letters from any language are supported.</p>
        {legacyFaculty && <p className="profile-edit-limit" role="status">SEET is no longer an available faculty. Choose your current faculty and department to update this profile.</p>}

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
          <select id="profile-faculty" value={faculty} onChange={(event) => { setFaculty(event.target.value); setDepartment('') }} disabled={facultyChanges >= 2 && !legacyFaculty} required>
            <option value="">Select your faculty</option>
            {Object.keys(DEPARTMENTS).map((name) => <option key={name}>{name}</option>)}
          </select>
          <small className="profile-edit-limit">{legacyFaculty ? 'Choose a current faculty to replace the old SEET classification.' : facultyChanges >= 2 ? 'Faculty change limit reached; this field is locked.' : `You can change your faculty ${2 - facultyChanges} more time${2 - facultyChanges === 1 ? '' : 's'}.`}</small>
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
