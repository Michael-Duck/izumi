export interface TraktTokenReply {
  access_token: string
  refresh_token: string
  expires_in: number
  created_at: number
  token_type?: string
  scope?: string
}

export interface TraktDeviceCode {
  deviceCode: string
  userCode: string
  verificationUrl: string
  expiresIn: number
  interval: number
}

export interface TraktMediaIds {
  imdb?: string
  tmdb?: number
  tvdb?: number
}

export interface TraktBulkMediaBody {
  movies?: Array<{ ids: TraktMediaIds }>
  shows?: Array<{
    ids: TraktMediaIds
    seasons?: Array<{ number: number; episodes: Array<{ number: number }> }>
  }>
  episodes?: Array<{ ids: Pick<TraktMediaIds, 'tvdb'> }>
}

export interface TraktQueuedAction {
  id: string
  path: '/sync/history' | '/sync/watchlist' | '/sync/watchlist/remove' | '/sync/ratings' | '/sync/ratings/remove'
  body: object
  createdAt: number
}
