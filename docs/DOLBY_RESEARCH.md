# Dolby and HDR support audit — 5 September 2026

Izumi can improve compatibility without implementing a new proprietary decoder. The supplied research gets the distinction between encoded transport, metadata-aware conversion, and certified output broadly right. Its licensing guarantees and claim that software FEL support is impossible are not reliable.

This audit combines upstream sources with the local desktop/Android code and a read-only runtime probe of the local Windows library. It does not certify a TV/AVR combination or establish a patent/licensing exemption.

## Validation of the supplied claims

| Claim | Finding and practical consequence |
|---|---|
| AC-3 decoding never needs a license because FFmpeg supports it | Unsupported as a blanket legal conclusion. FFmpeg distinguishes its software license from patent questions, which depend on jurisdiction and use. Open-source implementation availability does not establish patent clearance for AC-3, E-AC3, TrueHD, or DV. [FFmpeg legal guidance](https://ffmpeg.org/legal.html) |
| Atmos passthrough preserves objects for a receiver | Technically sound for a compatible encoded stream and output chain. It does not prove that every E-AC3/TrueHD track contains Atmos, or that every backend/device combination transports it. The additional claim of an unconditional licensing exemption is not established by the cited forum discussions. [mpv transport options](https://mpv.io/manual/stable/#options-audio-spdif) |
| DV metadata conversion is possible in open-source software | Yes. This is distinct from emitting a display-recognized native DV signal. mpv's `source-dynamic` output uses scene information to produce HDR10 luminance metadata; it does not send full DV or HDR10+ metadata and is documented as experimental. Do not interpret this option as certified DV/HDR10+ passthrough. [mpv colour-target documentation](https://mpv.io/manual/stable/#options-target-colorspace-hint-mode) |
| Profile 5 has no HDR10-compatible base-layer fallback | Correct. Dropping DV interpretation is therefore not a general safe fallback. Dolby's public DASH specification distinguishes Profile 5 from backward-compatible Profile 8.1. [Dolby DASH specification](https://professional.dolby.com/siteassets/content-creation/dolby-vision-for-content-creators/dolbyvisioninmpegdashspecification_v2_0_public_20190107.pdf) |
| Profile 8.1 and 8.4 need different base-layer handling | Correct: 8.1 is HDR10-compatible; 8.4 is HLG-compatible. A codec string such as `dvh1.08.06` gives profile 8 and level 6, not “8.1” or “8.4”. Preserve and inspect compatibility/color metadata instead of forcing PQ/HLG from filenames. [Dolby DASH specification](https://professional.dolby.com/siteassets/content-creation/dolby-vision-for-content-creators/dolbyvisioninmpegdashspecification_v2_0_public_20190107.pdf), [Dolby's HLG/Profile 8.4 explanation](https://professional.dolby.com/siteassets/all/dolby-case-study_uefa_english.pdf) |
| mpv always ignores FEL and software reconstruction is impossible | Outdated. Upstream merged Profile 7 FEL work on **1 July 2026**, assigned to the 0.42 milestone. The implementation needs corresponding FFmpeg support and libplacebo API **367+**. This establishes technical feasibility, not licensing clearance or support in every packaged binary. [Merged mpv change](https://github.com/mpv-player/mpv/pull/17932), [renderer dependency guard](https://github.com/mpv-player/mpv/blob/master/video/out/vo_gpu_next.c) |
| Spatializer checks detect Atmos passthrough | Incorrect conflation. `canBeSpatialized` evaluates a specified audio format and current route for platform spatialization. Google requires the expected decoder-output encoding/layout and matching audio attributes. Media3 already integrates spatialization into track selection. Encoded bitstream capability is a separate AudioManager check. [Android spatial audio](https://developer.android.com/media/grow/spatial-audio), [AudioManager](https://developer.android.com/reference/android/media/AudioManager#getDirectPlaybackSupport(android.media.AudioFormat,%20android.media.AudioAttributes)) |
| Native DV on Windows is universally impossible | Too broad. Dolby documents compatible Windows/Edge/PlayReady playback paths. This does not provide a portable raw-DV HDMI API for Izumi's embedded mpv renderer. Treat that renderer's native output as unsupported, while investigating platform paths individually. [Dolby DRM guidelines](https://professionalsupport.dolby.com/s/article/DRM-Guidelines-for-Dolby-Content), [Dolby-enabled PCs](https://professional.dolby.com/categories/pc/) |
| $2,500/year plus $3/TV establishes Izumi's licensing cost | These are not a verified quote for an app. Artistic-trim/content-creation licensing is a separate product category from consumer playback implementation and branding. Dolby's current FAQ advertises a $1,000 perpetual facility mastering/playback license; it is not an Izumi distribution license. No authoritative app-specific royalty quote was established. Descriptive compatibility text also should not be conflated with permission to use Dolby logos or claim certification. [Dolby FAQ](https://professionalsupport.dolby.com/s/article/General-Dolby-Vision-FAQs), [content-creation licensing](https://professional.dolby.com/content-creation/dolby-vision-for-content-creators/), [implementation licensing](https://handbook.dolby.com/imp/implementation-license/) |

## What the repository and local binary establish

Already implemented: optional AC-3/E-AC3/TrueHD/DTS/DTS-HD transport, processing/speed interlocks, Android API 33 direct-bitstream checks, guarded native DV/HDR10+/HLG routes, AC-4 platform fallback, exact DRM capability queries, and reproducible engine build scripts. These are existing features, not new proposals from the supplied research.

Linux/Flatpak and the Android build script pin mpv **0.41.0**. Android pins FFmpeg **8.1.2** and libplacebo **7.360.1**. Updating only an mpv option cannot add the newer FEL pipeline.

The local `src-tauri/libmpv-2.dll` reported:

```text
mpv-version:        mpv v0.41.0-744-g304426c39
ffmpeg-version:     N-124930-g2576e0943
libplacebo-version: v7.365.0 (v7.360.0-80-gd4624cb-dirty)
DLL SHA-256:        5c876d79e070529128331591b48f87846fb30557f19c11280df9c6ee9b6dbafa
```

This libplacebo version is below the upstream FEL renderer guard. These measurements describe the local DLL, not every released artifact. The Windows build script hashes its downloaded archive, so its archive digest must not be compared directly to this DLL digest.

## Changes made in this audit

- Auto transport now requires a TrueHD report; MAT alone no longer enables it. Android describes MAT as capable of carrying TrueHD **or** PCM, including PCM with objects. That does not establish that a MAT-only route accepts this backend's TrueHD output. [Android AudioFormat](https://developer.android.com/reference/android/media/AudioFormat#ENCODING_DOLBY_MAT)
- Failed capability refreshes clear stale encoded-format reports. Android probes reuse the same device enumeration, stop recommending Android numeric IDs as mpv device names, and do not label a plain speaker as a receiver merely because it is routed.
- Diagnostics use the audio API output format and video-renderer target. An HDR source tone-mapped to SDR no longer gets labeled HDR solely from source properties; absent output data stays unknown. [mpv properties](https://mpv.io/manual/stable/#properties-audio-out-params)
- Native HDR status uses the verified active track rather than the requested route. Settings/stats show the available source DV profile/level; settings also show FFmpeg/libplacebo versions and source/target colours. MEL/FEL and Profile 8 compatibility are not guessed.

## Recommended next work

1. **Build and validate a FEL-capable engine candidate.** Pin compatible mpv, FFmpeg and libplacebo revisions together, record artifact versions, and test single-track and dual-track Profile 7, software decoding, GPU decoding, seeking and subtitles. Include a sample where enhancement-layer application visibly changes the result. Keep the existing release floor until that candidate passes. This is an engineering/dependency project, not a new display-tunneling feature.
2. **Make Windows Auto passthrough useful.** Query the actual selected WASAPI endpoint using `IAudioClient::IsFormatSupported` with the correct IEC-61937 structures; invalidate results on endpoint changes. Accept exact support, not a “closest PCM match”, and confirm with a receiver. [Microsoft format probing](https://learn.microsoft.com/en-us/windows/win32/api/audioclient/nf-audioclient-iaudioclient-isformatsupported), [IEC-61937 representation](https://learn.microsoft.com/en-us/windows/win32/coreaudio/representing-formats-for-iec-61937-transmissions)
3. **Probe Android per track and per backend.** Current checks use representative 48 kHz stereo/5.1/7.1 formats. Add actual sample rate/layout, track-change updates, and explicit AudioSink output observations. libmpv opens IEC-61937 frames, while Media3 can choose platform decoding or encoded output; source-codec support is insufficient evidence for either sink. [mpv Android backend](https://github.com/mpv-player/mpv/blob/v0.41.0/audio/out/ao_audiotrack.c)
4. **Add separate headphone-spatialization diagnostics.** Report available/enabled state and `canBeSpatialized` for the actual decoded layout. Preserve Media3's existing selection behavior and label this platform spatialization; do not use it to enable HDMI transport or claim Atmos objects. [Google's integration guidance](https://developer.android.com/media/grow/spatial-audio)
5. **Strengthen DV colour regression coverage.** Use legally distributable, independently inspected Profile 5, 8.1, 8.4, Profile 7 MEL/FEL, and HDR10+ samples. Inspect RPU/compatibility metadata rather than inferring subprofiles from names. Verify SDR tone mapping, HDR output, switching modes, and preservation across the actual decoder/filter path. The current audit found diagnostic errors, not evidence of a specific Profile 8 colour-conversion defect to patch.
6. **Evaluate display-aware tone-mapping targets.** The explicit HDR10 preset currently requests a fixed 1,000-nit target. Consider calibrated display targets and an optional per-scene metadata mode, with visual tests for clipping, brightness changes, and SDR desktop composition. Keep HDR10+ metadata interpretation distinct from native HDR10+ output.

## Validation performed

- 47 focused Vitest tests passed across Dolby policy, DRM, Android routing/inspection and build contracts.
- Four Rust playback source-contract checks passed.
- Android `:tauri-plugin-mpv:compileDebugKotlin` passed. Dependency/toolchain deprecation warnings remain.
- `npm run check` passed with zero errors/warnings; the production frontend build passed.
- A local libmpv smoke test used a generated 48 kHz sine source and a 44.1 kHz null audio output. The source and API-output properties correctly reported different rates. It produced no speaker output and did not exercise HDMI.

The Samsung TV client is a separate repository. No TV code, shared protocol, deployment, or release artifact was changed in this audit. Physical acceptance follows the matrix in [DOLBY_PLAYBACK.md](DOLBY_PLAYBACK.md).
