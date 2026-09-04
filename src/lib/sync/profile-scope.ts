export const MAIN_PROFILE_ID = 'default'
export function watchCategory(profileId: string): string {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(profileId)) throw new Error('Invalid sync profile identity.')
  return profileId === MAIN_PROFILE_ID ? 'watch' : `watch-${profileId}`
}
/** Legacy records belong exclusively to the original profile. */
export function watchPayloadForProfile(payload: string, profileId: string): boolean {
  try {
    const value = JSON.parse(payload)
    return value?.app === 'izumi' && value.kind === 'watch-history' && value.version === 1
      && (value.profileId ?? MAIN_PROFILE_ID) === profileId
  } catch { return false }
}
