import { get } from 'svelte/store'
import { profiledPersisted } from '$lib/profiles/store'

export const anilistToken = profiledPersisted<string | null>('anilist-token', null)
export const getToken = () => get(anilistToken)
