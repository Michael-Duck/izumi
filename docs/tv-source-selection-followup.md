# TV source selection follow-up

Worker 1.11.1 separates automatic language preference from manual source availability. Preferred releases are ordered first, and other usable languages remain selectable. Conversion continues within the bounded lookup deadline instead of stopping after three attempts. A follow-up request can exclude up to 60 previously offered candidate IDs to find additional releases.

Movie lookups prefer canonical title IDs over unrelated video hints. Embedded metadata streams no longer prevent configured stream resources from answering. Mixed global and private identifiers are routed independently, with private IDs restricted to their originating add-on. A signed continuation can supplement a partial result.

Promotional markers are checked across release-description lines and decoded URL filenames. The shared file picker no longer falls back to an explicitly excluded extra when no full video remains. TV compatibility checks also reject explicitly declared 12-bit and 4:4:4 encodes.

The Companion 0.2.44 side preserves playback during catalogue refreshes, retains audio choices through native recovery, adds source refresh, and checks feature duration when the player reports it late. Both updates are needed for the complete behaviour. Native rendering and audible track selection still require physical-TV validation.
