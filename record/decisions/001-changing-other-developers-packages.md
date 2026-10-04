# 001: Changing other developers' packages

Crosscheck's own features never change another developer's package, unless a critical blocker leaves no other way.
A [plugin](../areas/product/03-v1-scope.md#plugins) for one aircraft may change that aircraft's files on the pilot's machine.
Crosscheck never ships a file of another developer's.
Decided by the user on 2026-10-04.

## Context

Several ideas reach a point where changing an aircraft's own files would solve them:

- **Avatar sync and Crosscheck objects in the cockpit:** a model that the aircraft's own files attach holds still in flight (measured on MSFS 2024, 2026-10-03, [avatars log](../areas/avatars/log.md#2026-10-03-a-model-attached-through-the-aircrafts-own-files-holds-still-in-flight)).
  GSX gets its seated passengers there by adding a section to the aircraft package's own `attached_objects.cfg` on the user's machine, and keeps the original beside it as `attached_objects.cfg.gsx` (read in GSX Pro 4.0.19 and fnx-aircraft-320, [avatars log](../areas/avatars/log.md#2026-10-03-gsx-keeps-its-passengers-aboard-by-adding-its-model-to-the-aircrafts-own-attachments)).
- **Seat awareness:** a Community package of ours that copies an aircraft's camera file and mounts after the aircraft's package replaces that file (measured on MSFS 2024, 2026-10-04, [aircraft log](../areas/aircraft/log.md#2026-10-04-a-community-package-of-ours-adds-a-seat-view-anywhere-in-the-aircraft-it-replaces-the-camera-file-when-it-mounts-after-the-aircrafts-the-sim-reads-it-at-start-and-a-free-pilot-item-lets-the-camera-hand-back-there)).
- **WASM instrument sync:** the iniBuilds A350's module presses wherever the receiving pilot's own cursor is, so syncing its displays takes a patch to that module ([WASM instrument sync](../areas/product/ideas.md#wasm-instrument-sync)).
- **Aircraft adapters:** state such as the A220's display formats lives where only code inside the aircraft reaches it ([Aircraft adapters](../areas/product/ideas.md#aircraft-adapters)).

## Options

1. **Never change another developer's package.**
   The A350's displays stay out of pointer sync, and every state that only a change to the aircraft could reach stays out of Crosscheck.
2. **Change packages wherever a feature needs it, in Crosscheck's own features too.**
   Each core feature then carries exceptions for single aircraft, and breaks on any update to a file it changed, though [plugins](../areas/product/03-v1-scope.md#plugins) exist to keep code for one product out of the core.
3. **Change an aircraft's files only from that aircraft's plugin, on the pilot's machine.**
   Each change is a plugin we write and keep matched to the aircraft's versions.

Shipping a developer's file, changed or not, was never an option, because it redistributes their work.

## Decision

Option 3.
A pilot changing a product they bought, on their own machine, is theirs to do, and the change stays in a plugin, where removing the plugin removes it.
Crosscheck's own features hold avatars and Crosscheck objects through our WASM module instead, as [avatar sync](../areas/product/03-v1-scope.md#avatar-sync) already does.

## What it commits us to

- A plugin's change applies only to the exact file it was made for, checked by the file's hash, and does nothing on any other version of the aircraft.
- Turning the plugin off gives the pilot the stock aircraft back.
- We write these changes ourselves, because making one takes a working knowledge of both the aircraft and Crosscheck that few profile authors will have.
- The route we expect to use: while the sim is closed, Crosscheck copies the aircraft's file into an overlay folder in our Community package, changes the copy there, and lets the overlay mount after the aircraft's package.
  Nothing of the developer's changes on disk, and removing the overlay restores the stock aircraft.
  That an overlay replaces an aircraft's file is measured only for the camera file, and whether it works for others, such as a WASM module, is unverified.
- Files the aircraft ships encrypted can't be changed this way.
