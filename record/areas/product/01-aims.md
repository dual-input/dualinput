# Product: aims

```text
Purpose:     What Crosscheck is for, who it serves, and what it won't do.
Depends on:  nothing.
Decides:     Who Crosscheck is for, its aims and non-goals, and the relay and license commitments every design works within.
```

Crosscheck is built for us first, and then for anyone who flies MSFS 2024 with friends.
Its pilots are flight sim enthusiasts at every level of technical skill.
Some would write a profile, the file that tells Crosscheck what to sync on one aircraft, and others don't know what a profile is for.
When two choices are otherwise even, Crosscheck takes the one we'd want when flying with our friends.

## Aims

- **Pilots never need to understand Crosscheck to use it.**
  Someone who has never heard of a profile goes from installing Crosscheck to flying with a friend without reading any documentation.
- **Every aircraft we list has been flown gate to gate with Crosscheck.**
  We write and maintain the profiles for a short list of aircraft, and open profile writing to everyone after v1.
- **A session can hold any number of people.**
- **Pilots join with a code and never make an account.**
- **A pilot in VR can use everything Crosscheck offers during a flight without taking the headset off.**
- **Crosscheck is free, and takes donations.**

## Relay and license

The relay is the server that carries a session's traffic when the pilots' machines can't connect to each other directly.

- **We aim to keep the relay near $10 a month,** mostly by connecting machines directly whenever they can.
  When a feature needs more relay traffic to work well, it gets the traffic and we revisit the target.
- **We run one relay,** and add regions only if we can host them for free.
- **The relay's address is a setting,** so after v1 a group can run its own relay near its pilots.
- **The license will be open,** and we pick it before the repository goes public.

## Non-goals

- MSFS 2020.
- Working with other shared-cockpit tools, such as joining a YourControls session.
- Features for organizations, such as rosters, checkride scoring, and admin controls.
  A flight recorder made for friends stays possible.
- Several aircraft in one session, such as a formation flight.
- Voice chat, which Discord covers.
- Xbox: MSFS 2024 runs there, but we build for Windows PCs only.
