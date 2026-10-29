# Nilo and brand

Nilo, the scholar owl, is the OHarness identity: the title-bar mark, the app icon and the animated guide are one character. The grid, the frames and the animation loop live in `frontend/src/components/brand/`; this document is the rulebook for them.

## One source of truth

- The 16 by 13 `NILO_GRID` in the app (`frontend/src/components/brand/niloGrid.ts`) is the only drawing. Letters are roles: `B` body, `W` eye-white, `P` pupil, `K` beak, `R` rim. The mark, the sprite and the generated icons all come from it. Edit the grid, never a file derived from it.
- The exported files are in `brand/`: `nilo.svg` (full mascot, 8px per cell, for use outside the app), `mark.svg` (face crop, same shape as the title-bar mark) and `icon.png` (1024 app icon on a rounded graphite plate). `brand/legacy/` keeps superseded marks with a `-legacy` suffix; never delete one.
- Exported files use fixed stand-ins for the live colours: `#3AB3AD` body, `#F4EFE6` eyes, `#93E4DE` spectacle rims and chest chevron, `#161412` pupils, `#D9A441` beak.

## Style lock

- Flat blocks on a pixel grid. No outline, no shading, no highlights, no accessories.
- Four roles, one colour each, plus a rim: body follows `nilo-body` (the live `signal`); `nilo-eye`, `nilo-pupil`, `nilo-beak` and `nilo-rim` stay fixed in both themes. `nilo-screen`, `nilo-desk` and `nilo-code` exist only for the laptop in the working pose.
- Owl cues in priority order: eyes behind spectacles with a 1px pupil that looks around, an amber beak, upright ear tufts, wing nubs that gesture and type.
- Integer scaling only: N px per cell with crisp edges. The app icon is drawn at each size from the grid, never downsampled.

## Animation language

- Frame step 110 ms. She blinks every 2.4 to 6 s for 140 ms and glances every 1.4 to 4 s.
- Acting is in the brow, lids, head tilt and tufts, not a darting eyeball. Tufts lag the head lean by a step for secondary motion; hops use anticipation, a squash on launch and landing, and a settle.
- State to motion: `idle` breathes (a 1px rise and the odd tuft twitch); `thinking` sweeps the pupils, furrows the brow and pulses one to three dots; `working` types on a laptop with a glance up now and then; `waiting` waves a wing with a raised brow; `success` hops with a happy face; `error` squints with a worried brow, drooped tufts and a shake; `sleeping` closes her eyes and trails Z, z, dot.
- Click reactions: hop, wink, head turn, ruffle, hoot. Five clicks inside 1.5 s make her dizzy (`@_@`). After 90 s without input an interactive Nilo falls asleep.
- Reduced motion: no loop, one still pose per state.

## Where she may appear

A surface earns Nilo only when her state is true of it: waiting on Studio's empty canvas, idle on a quiet Chats home, thinking and working during a live run. Dense spec-sheet screens (Providers, Harnesses lists) carry none. The assistant is named **Nilo**; the word "Copilot" never appears.
