# Profiles and TV sync

Profiles are optional. An untouched installation retains the existing account/login entry. Creating or customising a household explicitly enables the chooser. Turning profiles off retains their stored data; deleting a profile creates a synced deletion marker so an offline device cannot resurrect it.

## What syncs

- The encrypted household registry contains names, bundled avatar IDs, colours, viewing limits, salted PIN verifiers, and deletion markers.
- Watch history and resume records use separate profile categories. Legacy records belong only to the main profile.
- Active selection, unlocked sessions, and PIN input stay local. Tracker OAuth credentials are not included in the household registry or background sync; connect each account in its intended profile on each device.
- TV Home snapshots and checkpoints carry the profile ID. The Worker stores independent `profileId~catalogue` snapshots. Selecting a profile on the TV never changes the profile selected on a phone or computer.
- The Worker’s opt-in TV resolver config exposes a minimal household roster to the authenticated TV. Source credentials never appear in that response. Profile PIN input is transient request data over HTTPS, not a stored credential.

## Rollout and limits

Update the desktop/mobile clients, redeploy the bundled Worker (1.7.0), and install the matching standalone `izumiCompanion` build. Open and sync each configured profile on the main client to publish its personalised Home snapshot. Until one exists, the independent Worker can supply public catalogue rows, not that profile’s private tracker library.

TV offers a remote-friendly chooser, PIN keypad, and refresh action. Names, avatars, PINs and viewing limits are edited on phone/desktop under Settings → Profiles. LAN fallback needs the linked device to have the same active profile; independent Worker playback does not.

These are household UI gates, not separate encrypted accounts or protection against someone controlling storage, a paired device or the Worker. Parental filtering depends on provider metadata; unrated titles remain allowed. A physical-TV test and a two-device live Worker test are still required before calling this production-verified.

Automated coverage includes registry merging and deletions, per-profile records, legacy migration, TV storage separation, PIN verification, profile-tagged requests, stale snapshot rejection, and known adult/rating propagation.
