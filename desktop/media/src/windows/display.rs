//! Displays are the DXGI outputs attached to the desktop, named from the
//! monitor's EDID through DisplayConfig. Ids come from the GDI device name
//! (`\\.\DISPLAY2` is 2), which survives re-enumeration.

use std::collections::HashMap;
use std::mem::size_of;

use windows::Win32::Devices::Display::{
    DisplayConfigGetDeviceInfo, GetDisplayConfigBufferSizes, QueryDisplayConfig,
    DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME, DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME,
    DISPLAYCONFIG_DEVICE_INFO_HEADER, DISPLAYCONFIG_MODE_INFO, DISPLAYCONFIG_PATH_INFO,
    DISPLAYCONFIG_SOURCE_DEVICE_NAME, DISPLAYCONFIG_TARGET_DEVICE_NAME, QDC_ONLY_ACTIVE_PATHS,
};
use windows::Win32::Foundation::{ERROR_SUCCESS, RECT};
use windows::Win32::Graphics::Dxgi::{
    CreateDXGIFactory1, IDXGIAdapter1, IDXGIFactory1, IDXGIOutput,
};
use windows::Win32::Graphics::Gdi::HMONITOR;
use windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};

use super::failed;
use crate::{DisplayInfo, Result};

pub struct Output {
    pub info: DisplayInfo,
    pub rect: RECT,
    pub adapter: IDXGIAdapter1,
    pub output: IDXGIOutput,
}

pub fn displays() -> Result<Vec<DisplayInfo>> {
    Ok(outputs()?.into_iter().map(|o| o.info).collect())
}

pub fn outputs() -> Result<Vec<Output>> {
    let factory: IDXGIFactory1 =
        unsafe { CreateDXGIFactory1() }.map_err(|e| failed("Listing displays", e))?;
    let names = friendly_names();
    let mut found = Vec::new();
    let mut adapter_index = 0;
    while let Ok(adapter) = unsafe { factory.EnumAdapters1(adapter_index) } {
        adapter_index += 1;
        let mut output_index = 0;
        while let Ok(output) = unsafe { adapter.EnumOutputs(output_index) } {
            output_index += 1;
            let Ok(desc) = (unsafe { output.GetDesc() }) else {
                continue;
            };
            if !desc.AttachedToDesktop.as_bool() {
                continue;
            }
            let device = wide(&desc.DeviceName);
            let rect = desc.DesktopCoordinates;
            let width = (rect.right - rect.left).max(0) as u32;
            let height = (rect.bottom - rect.top).max(0) as u32;
            let scale = dpi(desc.Monitor) as f64 / 96.0;
            let id = display_id(&device, found.len());
            let info = DisplayInfo {
                id,
                name: names
                    .get(&device)
                    .cloned()
                    .unwrap_or_else(|| format!("Display {id}")),
                width,
                height,
                point_width: (width as f64 / scale).round() as u32,
                point_height: (height as f64 / scale).round() as u32,
                main: rect.left == 0 && rect.top == 0,
            };
            found.push(Output {
                info,
                rect,
                adapter: adapter.clone(),
                output,
            });
        }
    }
    Ok(found)
}

fn display_id(device: &str, index: usize) -> u64 {
    device
        .trim_start_matches(r"\\.\DISPLAY")
        .parse()
        .unwrap_or(1000 + index as u64)
}

fn dpi(monitor: HMONITOR) -> u32 {
    let (mut x, mut y) = (96, 96);
    match unsafe { GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &mut x, &mut y) } {
        Ok(()) if x > 0 => x,
        _ => 96,
    }
}

fn wide(text: &[u16]) -> String {
    let end = text.iter().position(|&c| c == 0).unwrap_or(text.len());
    String::from_utf16_lossy(&text[..end])
}

/// GDI device name (`\\.\DISPLAY1`) to the monitor's own name ("DELL U2720Q").
fn friendly_names() -> HashMap<String, String> {
    let mut names = HashMap::new();
    let (mut path_count, mut mode_count) = (0u32, 0u32);
    if unsafe {
        GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, &mut path_count, &mut mode_count)
    } != ERROR_SUCCESS
    {
        return names;
    }
    let mut paths = vec![DISPLAYCONFIG_PATH_INFO::default(); path_count as usize];
    let mut modes = vec![DISPLAYCONFIG_MODE_INFO::default(); mode_count as usize];
    let status = unsafe {
        QueryDisplayConfig(
            QDC_ONLY_ACTIVE_PATHS,
            &mut path_count,
            paths.as_mut_ptr(),
            &mut mode_count,
            modes.as_mut_ptr(),
            None,
        )
    };
    if status != ERROR_SUCCESS {
        return names;
    }
    for path in &paths[..path_count as usize] {
        let mut source = DISPLAYCONFIG_SOURCE_DEVICE_NAME {
            header: DISPLAYCONFIG_DEVICE_INFO_HEADER {
                r#type: DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME,
                size: size_of::<DISPLAYCONFIG_SOURCE_DEVICE_NAME>() as u32,
                adapterId: path.sourceInfo.adapterId,
                id: path.sourceInfo.id,
            },
            ..Default::default()
        };
        let mut target = DISPLAYCONFIG_TARGET_DEVICE_NAME {
            header: DISPLAYCONFIG_DEVICE_INFO_HEADER {
                r#type: DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME,
                size: size_of::<DISPLAYCONFIG_TARGET_DEVICE_NAME>() as u32,
                adapterId: path.targetInfo.adapterId,
                id: path.targetInfo.id,
            },
            ..Default::default()
        };
        let read = unsafe {
            DisplayConfigGetDeviceInfo(&mut source.header) == 0
                && DisplayConfigGetDeviceInfo(&mut target.header) == 0
        };
        let name = wide(&target.monitorFriendlyDeviceName);
        if read && !name.is_empty() {
            names.insert(wide(&source.viewGdiDeviceName), name);
        }
    }
    names
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_come_from_gdi_device_names() {
        assert_eq!(display_id(r"\\.\DISPLAY1", 0), 1);
        assert_eq!(display_id(r"\\.\DISPLAY12", 3), 12);
        assert_eq!(display_id("WinDisc", 2), 1002);
    }

    #[test]
    fn reads_nul_terminated_names() {
        let mut name = [0u16; 8];
        name[..4].copy_from_slice(&[0x44, 0x45, 0x4c, 0x4c]);
        assert_eq!(wide(&name), "DELL");
    }

    #[test]
    fn listed_displays_have_sizes() {
        for display in displays().unwrap_or_default() {
            assert!(display.width > 0 && display.height > 0, "{display:?}");
            assert!(
                display.point_width > 0 && display.point_height > 0,
                "{display:?}"
            );
        }
    }
}
