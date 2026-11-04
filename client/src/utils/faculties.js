export const DEPARTMENTS = {
  SAAT: ['AEC', 'ARE', 'APH', 'CSP', 'FAT', 'EWM', 'FWT', 'FST'],
  SBCS: ['PAT', 'FAR', 'CHE'],
  SBMS: ['ANA', 'BIM', 'MLS', 'PHS'],
  SCS: ['MED', 'SUR', 'OBS', 'PED'],
  SIMME: ['CVE', 'IPE', 'MEE', 'MME', 'MIE'],
  SESE: ['BME', 'CPE', 'EEE', 'ICE', 'MTE'],
  SEMS: ['AGY', 'AGP', 'MST', 'MCS', 'RSG'],
  SET: ['ARC', 'BDG', 'ESM', 'IDD', 'QSV', 'SVG', 'TDT', 'URP'],
  SLIT: ['BIT', 'BMT', 'EMT', 'LTT', 'PMT', 'SIMT'],
  SLS: ['BCH', 'BIO', 'BTH', 'MCB'],
  SOC: ['CSC', 'CYS', 'IFS', 'IFT', 'SEN'],
  SPS: ['CHM', 'EDT', 'LIS', 'MTS', 'PHY', 'STA'],
}

export const LEGACY_SEET_DEPARTMENTS = ['AGE', 'BME', 'CEE', 'CVE', 'CPE', 'EEE', 'IPE', 'ICE', 'MEE', 'MCE', 'MNE', 'MME']

export function getFacultyLogoPath(faculty) {
  const name = String(faculty || 'SEET').toUpperCase()
  const logoFaculty = name === 'SIMME' || name === 'SESE' ? 'SEET' : name
  return `/Faculty%20Logo/${encodeURIComponent(logoFaculty)}.png`
}
