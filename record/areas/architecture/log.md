# Architecture: log

What our experiments found for the [architecture plan](plan.md)'s nodes, newest entry first.
The probes and their raw output are in [experiments/areas/architecture](../../../experiments/areas/architecture), with the results in its `results/` folder.

## 2026-10-08: A Rust program captures one process's audio, plays on a device it picks by name, and reads the keyboard and flight hardware through Raw Input in sink mode, and builds with Visual Studio's linker

**Asked:** can a Rust program do the native work the core's helper would do, which is to capture one process's audio through WASAPI's process loopback, capture a microphone, play on an output device it picks, and read input through Raw Input in sink mode, and does it build without Visual Studio (node 1.3.3)?

**Expected:** yes to each job, since the `wasapi` crate 0.25 has `new_application_loopback_client` and `windows-sys` has Raw Input, and a build for Rust's GNU target linking with Rust's own MinGW tools.

**Found:** on our development machine, Windows 10.0.26200, with p02's helper built by rustc 1.95.0 on `wasapi` 0.25.0 and `windows-sys` 0.59.0:

- One copy played a 440Hz tone at −26dBFS peak on "Speakers (Focusrite USB Audio)", which it found by name among the output devices.
  A second copy captured the first's process tree through process loopback at 48,000 frames a second, and read −29.0dBFS RMS and −26.0dBFS peak each second, the tone's own level.
- The default input device gave 48,000 frames a second at about −65dBFS RMS, a quiet room.
- Registered in sink mode for keyboards, joysticks, and gamepads, the helper received all three presses and releases of F24 that another copy sent, from device 0, which marks input a program sent, while its own window never had the focus.
  In the same 4s it received about 1,450 HID reports from three devices nobody touched, the flight hardware on this PC.
- The build for the default target, x86_64-pc-windows-msvc, linked with Visual Studio 2022's linker, in 17s, to 238,592 bytes.
- The build for x86_64-pc-windows-gnu failed.
  With the target added to the MSVC toolchain, rustc found no `dlltool.exe`.
  With Rust's GNU toolchain, 1.99.0, its own `dlltool.exe` failed at `CreateProcess`, because it calls an assembler that Rust doesn't ship.
  The `windows` crates need it to build their import libraries.

**Changed:** Rust does each job the helper needs, through crates that already wrap them.
On Windows, the helper's build takes a C toolchain besides Rust: Visual Studio's Build Tools for the MSVC target, or a full MinGW for the GNU target, which we haven't tried.

What we haven't run: Raw Input with the sim in front, which the take-control input's [tentative decision](decisions.md#the-core-catches-the-take-control-key-and-buttons) leaves open; a key a person pressed rather than one a program sent; and which devices the HID reports came from.

**Affects:** node 1.3's answer, and the tentative decisions on [the take-control input](decisions.md#the-core-catches-the-take-control-key-and-buttons) and [the audio](decisions.md#the-core-runs-crosschecks-audio).

**Evidence:** `results/p02-rust-helper-2026-10-08-17-14-54.txt`.

## 2026-10-08: A tray icon alone costs 1.0 MB of memory in Rust, 1.6 MB in .NET Native AOT, 5.1 MB in WinForms, and 39.7 MB over three processes in Electron

**Asked:** what does a process that shows only a tray icon cost, idle, in each runtime the watcher could run in (node 1.3.1)?

**Expected:** Electron well above the others, since its executable took 35 MB running as plain Node ([the product plan](../product/plan.md#7-tech-stack-and-architecture)).

**Found:** on our development machine, Windows 10.0.26200 with 16 logical processors, p01 started each program, waited 15s after its icon appeared, then left it idle for 60s.
Memory is the private working set, which Task Manager's Memory column shows, summed over the program and every process it started:

| Runtime | Processes | Memory | Working set | Private bytes | On disk |
| --- | --- | --- | --- | --- | --- |
| Node v22.23.1, no tray icon, for comparison | 2, with `conhost` | 11.0 MB | 38.4 MB | 16.7 MB | 83.0 MB |
| Electron 43.4.0's main process | 3 | 39.7 MB | 165.9 MB | 104.7 MB | 347.4 MB |
| .NET 9 WinForms, self-contained single file | 1 | 5.1 MB | 33.3 MB | 8.1 MB | 107.7 MB |
| .NET 9 Native AOT, calling `Shell_NotifyIconW` | 1 | 1.6 MB | 11.3 MB | 3.3 MB | 1.1 MB |
| Rust 1.95.0, calling `Shell_NotifyIconW` | 1 | 1.0 MB | 9.6 MB | 1.4 MB | 0.1 MB |

- None of them used any processor time that Windows recorded in the 60s.
- Electron started two processes beside its main one, of 15.4 MB and 6.3 MB.
- Node's working set, 31.3 MB for `node` itself, agrees with the 29 MB the product plan gives.
- The Native AOT build linked with Visual Studio 2022's `link.exe`, and found it only once the Visual Studio Installer's folder was on `PATH`.

**Changed:** a watcher in Rust costs the pilot about 1 MB all day, a tenth of an idle Node process, and one in Electron about 40 MB.

**Affects:** node 1.3's answer, and the watcher's row in [01-spine](01-spine.md#components).

**Evidence:** `results/p01-tray-runtimes-2026-10-08-17-12-53.txt`.
