const USERNAME_PATTERN = /^(?=.*\p{L})[\p{L}\p{M}\p{N}_ .'-]{3,24}$/u

export function isValidUsername(value) {
  return typeof value === 'string' && USERNAME_PATTERN.test(value.trim())
}
