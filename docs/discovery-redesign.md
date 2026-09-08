# Discovery redesign

## Direction and audit

Reading this as a discovery experience for film, series and anime viewers, with cinematic artwork and a familiar, accessible browsing model. Preserve izumi's Svelte implementation, Nunito typography, theme tokens, Library navigation, profile boundaries and recommendation engine. Design variance 6, motion intensity 4, visual density 5: artwork leads, transitions communicate selection, and metadata supports a decision.

The previous page showed one recommendation with a tightly cropped image beside its description. It did not use available title logos or show other recommendations. Facts had inconsistent separators. Exploring another title required recording feedback. Mobile placed decisions ahead of the synopsis, and the trailer overlay did not make the background inert or restore focus.

## Research and decisions

Research consulted on 8 September 2026:

- [NN/g: Designing effective carousels](https://www.nngroup.com/articles/designing-effective-carousels/). Keep choices recognizable, expose position and navigation, and avoid moving content while someone is reading. The feature stays still until a user acts, with explicit previous/next controls and five labeled thumbnails per group.
- [NN/g: Mobile carousels](https://www.nngroup.com/articles/mobile-carousels/). Horizontal content needs a clear affordance and touch access. Phone tiles show part of the next item, support native horizontal scrolling and snap into place. Arrow buttons remain available as an alternative.
- [W3C: Carousel pattern](https://www.w3.org/WAI/ARIA/apg/patterns/carousel/). Controls need accessible names, keyboard operation and understandable changes. Selection is announced; selecting a tile focuses and reveals the feature. The carousel never advances automatically. This implementation uses a list of button selectors, not a tablist.
- [Netflix: Updated TV experience](https://about.netflix.com/en/news/unveiling-our-innovative-new-tv-experience). Make information useful to a viewing decision visible during browsing. The adaptation here is a title treatment, synopsis, actual catalog facts, ratings with their original scale, and direct trailer/watchlist actions. This is design inspiration, not a claim that the products share a design system.

## Implementation

- Feature artwork preserves a landscape composition. Poster-only items use contained artwork. Failed logos fall back to a readable heading; the heading also remains visible until a logo loads. Missing images and descriptions have explicit fallbacks.
- Type, year, runtime or episode information, classification and language use shared dot-separated metadata. Tiles show type, year and genres without requiring hover. Unknown facts are omitted. Film runtime and episode duration have distinct labels.
- Selecting a recommendation does not record feedback. Save, skip, dismiss and undo retain their existing profile-local behavior. The recommendation reason is visible; supporting evidence is expandable.
- Trailers load only after an explicit action. Existing embed routing is reused. The shared trailer overlay now uses a native modal dialog for focus containment, background inertness, Escape dismissal and focus restoration.
- All navigation and action controls have at least 44px targets. Reduced motion disables decorative transforms and loading animation. Photo-backed content uses a dark media surface with explicit contrasting text; surrounding UI continues to use the active theme.
- Only the current pick fetches enriched metadata. Five tiles render per group, with lazy image loading. No timer, new runtime dependency, stream resolution or automatic video playback was added to discovery.

## Verification

- Svelte and TypeScript checks: no errors or warnings.
- Direct production frontend build completed successfully.
- Targeted discovery, candidate-loading and trailer-routing tests cover metadata omissions, movie/episode duration, supported trailer IDs, bounded groups, queue behavior and existing UI contracts.
- Browser checks use temporary catalog fixtures because the ordinary browser lacks the native catalog bridge. Checks cover desktop/phone sizing (including no horizontal overflow at 390px and 320px), selection and focus, series filtering, save/undo, trailer controls and Escape focus return. Broken logo and backdrop URLs fall back to a text title and contained poster; missing artwork and synopsis show their empty states. Fixtures are not shipped in application code.
- The npm precheck encountered a stale generated Worker bundle during concurrent work. Frontend checks were run directly; the Worker bundle is outside this redesign.
