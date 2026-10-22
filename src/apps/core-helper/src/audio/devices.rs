//! The output devices: Windows' default for the role most programs use, or the one the pilot
//! picked, found by its endpoint ID, then by its name, since Windows may give a USB headset
//! plugged into another port a new endpoint ID (unverified; record/areas/core/04-core-helper.md,
//! "The devices").

use std::sync::{Mutex, mpsc};

use messages::core_helper::DeviceInfo;
use wasapi::{
    Device, DeviceEnumerator, DeviceEventCallbacks, DeviceEventRegistration, Direction, Role,
};

/// A device's endpoint ID and its name.
pub fn info(device: &Device) -> Result<DeviceInfo, String> {
    Ok(DeviceInfo {
        id: device.get_id().map_err(|e| e.to_string())?,
        name: device.get_friendlyname().map_err(|e| e.to_string())?,
    })
}

/// Every output device that's connected.
pub fn outputs(enumerator: &DeviceEnumerator) -> Vec<DeviceInfo> {
    let Ok(devices) = enumerator.get_device_collection(&Direction::Render) else {
        return Vec::new();
    };
    let mut outputs: Vec<DeviceInfo> = (&devices)
        .into_iter()
        .filter_map(|d| info(&d.ok()?).ok())
        .collect();
    outputs.sort();
    outputs
}

/// The picked device when it's connected: by its endpoint ID, or else by its name.
pub fn find(enumerator: &DeviceEnumerator, picked: &DeviceInfo) -> Option<Device> {
    let connected = |d: &Device| matches!(d.get_state(), Ok(wasapi::DeviceState::Active));
    if let Some(device) = enumerator.get_device(&picked.id).ok().filter(connected) {
        return Some(device);
    }
    let devices = enumerator.get_device_collection(&Direction::Render).ok()?;
    devices
        .get_device_with_name(&picked.name)
        .ok()
        .filter(connected)
}

/// The device to play on, and whether it's the picked one: the picked device while it's
/// connected, or Windows' default.
pub fn pick(
    enumerator: &DeviceEnumerator,
    picked: Option<&DeviceInfo>,
) -> Result<(Device, bool), String> {
    if let Some(device) = picked.and_then(|p| find(enumerator, p)) {
        return Ok((device, true));
    }
    let default = enumerator
        .get_default_device_for_role(&Direction::Render, &Role::Console)
        .map_err(|e| format!("Windows has no default output device: {e}"))?;
    Ok((default, false))
}

/// What changed among the devices, from Windows' own thread.
pub enum DeviceChange {
    /// The default output device for the console role changed.
    Default,
    /// A device came, went, or changed state.
    Other,
}

/// Tells `changes` of each change among the devices for as long as the registration lives.
pub fn watch(
    enumerator: &DeviceEnumerator,
    changes: mpsc::Sender<DeviceChange>,
) -> Option<DeviceEventRegistration> {
    // Windows calls these on a thread of its own, and wants them quick.
    let changes = std::sync::Arc::new(Mutex::new(changes));
    let mut callbacks = DeviceEventCallbacks::new();
    let to = changes.clone();
    callbacks.set_default_device_callback(move |direction, role, _| {
        if direction == Direction::Render && role == Role::Console {
            let _ = to.lock().map(|s| s.send(DeviceChange::Default));
        }
    });
    let to = changes.clone();
    callbacks.set_device_state_callback(move |_, _| {
        let _ = to.lock().map(|s| s.send(DeviceChange::Other));
    });
    let to = changes.clone();
    callbacks.set_device_added_callback(move |_| {
        let _ = to.lock().map(|s| s.send(DeviceChange::Other));
    });
    callbacks.set_device_removed_callback(move |_| {
        let _ = changes.lock().map(|s| s.send(DeviceChange::Other));
    });
    enumerator.register_notification_callback(callbacks).ok()
}
