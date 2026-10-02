# Product: users

```text
Purpose:     The kinds of pilots Crosscheck is designed for, by their situation and the problems they run into.
Depends on:  01-aims.md
Decides:     Which kinds of pilots designs serve, and which one wins when two pull apart.
```

Crosscheck is designed for four ways of flying together: casually, teaching, by the book, and as a group.
When two of them pull in different directions, casual flying wins, because [01-aims](01-aims.md) breaks ties toward what we'd want when flying with our friends.
Casual pilots reach for any switch, for example, while a by-the-book crew leaves each pilot's side to that pilot.
Every session also has a host and joiners, and pilots bring flight hardware, VR headsets, and home cockpit panels.
This document describes each kind by its situation and problems, and leaves what Crosscheck does about them to v1's scope, step 4 in [the plan](plan.md).

The one problem we've seen ourselves hits every kind: most of what went wrong when we flew with FS Copilot was FS Copilot failing to sync.
The problems below are ones we expect.

## Roles in every session

### Host

- **Who:** starts the session, and can be the pilot who knows the aircraft and the sim best, or someone using Crosscheck for the first time.
- **Wants:** their friends in the same flight without walking them through it.
- **Goes wrong:** an experienced host ends up debugging a friend's setup over voice, and a first-time host doesn't know how to start a session or get their friend into it.

### Joiner

- **Who:** invited in by the host, and may not know what a profile is.
- **Wants:** to be flying with their friend within minutes.
- **Goes wrong:** when their machine differs from the host's, such as in the aircraft's version or livery, they can't tell why, or what to change.

## Ways of flying together

### Casual

- **Who:** two friends flying for fun, chatting, and splitting the work loosely, with procedures optional.
- **Wants:** either pilot reaches for anything, whenever.
- **Goes wrong:** one pilot changes something the other didn't expect, and neither notices until later.

### Teaching

- **Who:** one pilot showing another an aircraft or a procedure.
- **Wants:** the learner flies, and the teacher shows them around and steps in.
- **Goes wrong:** the teacher can't show which switch they mean, the learner gets into trouble before the teacher can take the flight controls, and the teacher can't see what the learner is looking at.

### By the book

- **Who:** two experienced pilots flying full procedures, with callouts and a real split of duties.
- **Wants:** each pilot works their own side of the cockpit and checks the other's.
- **Goes wrong:** a switch one pilot set from the checklist isn't set on the other pilot's machine, and the crew flies on with two different cockpits.

### Groups

- **Who:** a crew, and sometimes passengers.
  The crew is usually two pilots, or three with a flight engineer.
  The iniBuilds L-1011 has a flight engineer's panel, though its manual says it's designed for single-pilot operations (read in inibuilds-aircraft-l1011 1.0.8, [L-1011 study](../aircraft/inibuilds-l1011/study.md)).
  A crew can be much larger: the Boeing 314 flying boat had six flight-deck stations, and the B-36 bomber's reconnaissance version flew with 22 crew ([Boeing 314](https://en.wikipedia.org/wiki/Boeing_314_Clipper) and [B-36](https://en.wikipedia.org/wiki/Convair_B-36_Peacemaker) on Wikipedia).
  We design for crews of up to 22, the largest real crew we found in which everyone works a station on the aircraft.
  The E-4B carries up to 108 more people, but they're battle staff at desks, so in Crosscheck's terms they'd be passengers ([E-4](https://en.wikipedia.org/wiki/Boeing_E-4) on Wikipedia).
  Passengers range from one friend riding along to an event filling an A320 with more than 150 people, and some groups already fly with passengers (unverified: reported to us by an FS Copilot user).
- **Wants:** the crew want what the other kinds want, and passengers want to be aboard and watch the flight.
- **Goes wrong:** each extra machine is another setup that can differ from the host's, and another connection that can fail.

## Setups

- **Flight hardware:** a yoke or stick and a throttle.
  When the flight controls pass to a pilot, their physical throttle, trim wheel, or flap lever can sit somewhere other than the aircraft's.
- **VR headsets:** a pilot in VR can't read anything on the desktop, such as a Discord message, without taking the headset off.
- **Home cockpit panels:** physical switches bound to the aircraft through panel software such as MobiFlight or SPAD.neXt, sometimes different software for each aircraft.
  A pilot who flips a physical switch expects the other pilot's cockpit to follow, as it would for a click.
  When the other pilot clicks that switch in the sim, the first pilot's physical switch still shows the old position.
