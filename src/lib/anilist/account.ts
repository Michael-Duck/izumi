import { profiledPersisted } from '$lib/profiles/store'
export const anilistUser = profiledPersisted<string>('anilist-username', '')
