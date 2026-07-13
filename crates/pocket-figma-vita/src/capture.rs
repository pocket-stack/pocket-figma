//! Compile-time deterministic input/capture plan for Vita3K E2E builds.
//!
//! Controller input is a comma-separated state track: `frame:mask:lx:ly`.
//! Touch input is a second state track: `frame:id:x:y|id:x:y`; an empty state
//! releases every contact. States are held until the next event.

use libquickjs_sys::{JSValue, JS_FreeValue, JS_GetPropertyStr, JS_ToFloat64};
use pocketjs_vita::input::TouchSnapshot;
use pocketjs_vita::Runtime;
use std::ffi::CStr;

#[derive(Clone, Copy, Debug)]
pub struct ViewTelemetry {
    pub zoom: f64,
    pub min_zoom: f64,
    pub center_x: f64,
    pub center_y: f64,
}

impl ViewTelemetry {
    /// Read the app's last DeepZoom onView payload from its QuickJS global.
    /// This is capture-only telemetry: production input/rendering never polls
    /// or serializes JavaScript state.
    pub unsafe fn read(runtime: &Runtime) -> Result<Self, String> {
        let ctx = runtime.context();
        let view = JS_GetPropertyStr(ctx, runtime.global(), c"__pocketFigmaView".as_ptr());
        let result = (|| {
            Ok(Self {
                zoom: number_property(ctx, view, c"zoom")?,
                min_zoom: number_property(ctx, view, c"minZoom")?,
                center_x: number_property(ctx, view, c"centerX")?,
                center_y: number_property(ctx, view, c"centerY")?,
            })
        })();
        JS_FreeValue(ctx, view);
        result
    }

    pub fn encode(self) -> String {
        format!(
            "zoom={:.9}\nmin_zoom={:.9}\ncenter_x={:.9}\ncenter_y={:.9}\n",
            self.zoom, self.min_zoom, self.center_x, self.center_y
        )
    }
}

unsafe fn number_property(
    ctx: *mut libquickjs_sys::JSContext,
    object: JSValue,
    name: &CStr,
) -> Result<f64, String> {
    let value = JS_GetPropertyStr(ctx, object, name.as_ptr());
    let mut number = 0.0;
    let status = JS_ToFloat64(ctx, &mut number, value);
    JS_FreeValue(ctx, value);
    if status == 0 && number.is_finite() {
        Ok(number)
    } else {
        Err(format!(
            "Pocket Figma capture telemetry field {:?} is not finite",
            name
        ))
    }
}

#[derive(Clone, Copy, Debug)]
struct InputEvent {
    frame: u64,
    buttons: i32,
    lx: u8,
    ly: u8,
}

#[derive(Clone, Debug)]
struct TouchEvent {
    frame: u64,
    contacts: Vec<(u8, u16, u16)>,
}

pub struct CapturePlan {
    events: Vec<InputEvent>,
    touch_events: Vec<TouchEvent>,
    start: u64,
    count: u64,
}

impl CapturePlan {
    pub fn compiled() -> Self {
        Self {
            events: parse_input(option_env!("POCKET_FIGMA_VITA_CAPTURE_INPUT").unwrap_or("")),
            touch_events: parse_touch_input(
                option_env!("POCKET_FIGMA_VITA_CAPTURE_TOUCH").unwrap_or(""),
            ),
            start: parse_u64(option_env!("POCKET_FIGMA_VITA_CAP_START").unwrap_or("0"))
                .unwrap_or(0),
            count: parse_u64(option_env!("POCKET_FIGMA_VITA_CAP_N").unwrap_or("0")).unwrap_or(0),
        }
    }

    /// Scripted input when a track exists; otherwise pass real hardware
    /// through so a `--capture` build remains manually usable.
    pub fn input(
        &self,
        frame: u64,
        hardware_buttons: i32,
        hardware_lx: u8,
        hardware_ly: u8,
        hardware_touches: TouchSnapshot,
    ) -> (i32, i32, TouchSnapshot) {
        let (buttons, analog) = if self.events.is_empty() {
            (hardware_buttons, pack_analog(hardware_lx, hardware_ly))
        } else {
            let mut state = InputEvent {
                frame: 0,
                buttons: 0,
                lx: 128,
                ly: 128,
            };
            for event in &self.events {
                if event.frame > frame {
                    break;
                }
                state = *event;
            }
            (state.buttons, pack_analog(state.lx, state.ly))
        };

        let touches = if self.touch_events.is_empty() {
            hardware_touches
        } else {
            let mut contacts: &[(u8, u16, u16)] = &[];
            for event in &self.touch_events {
                if event.frame > frame {
                    break;
                }
                contacts = &event.contacts;
            }
            TouchSnapshot::from_logical(contacts)
        };
        (buttons, analog, touches)
    }

    pub fn capture_index(&self, frame: u64) -> Option<u64> {
        (frame >= self.start && frame < self.start.saturating_add(self.count))
            .then_some(frame - self.start)
    }

    pub fn complete(&self, frame: u64) -> bool {
        self.count > 0 && frame >= self.start.saturating_add(self.count)
    }

    pub fn path(index: u64) -> String {
        format!("ux0:data/pocket-figma-vita/cap/f{index:04}.rgba")
    }

    pub fn telemetry_path(index: u64) -> String {
        format!("ux0:data/pocket-figma-vita/cap/f{index:04}.view")
    }
}

fn pack_analog(lx: u8, ly: u8) -> i32 {
    (((lx as u32) << 8) | ly as u32) as i32
}

fn parse_input(source: &str) -> Vec<InputEvent> {
    let mut events = Vec::new();
    for item in source.split(',').filter(|part| !part.is_empty()) {
        let mut fields = item.split(':');
        let Some(frame) = fields.next().and_then(parse_u64) else {
            continue;
        };
        let Some(buttons) = fields.next().and_then(parse_u64) else {
            continue;
        };
        let lx = fields
            .next()
            .and_then(parse_u64)
            .and_then(|value| u8::try_from(value).ok())
            .unwrap_or(128);
        let ly = fields
            .next()
            .and_then(parse_u64)
            .and_then(|value| u8::try_from(value).ok())
            .unwrap_or(128);
        events.push(InputEvent {
            frame,
            buttons: buttons as i32,
            lx,
            ly,
        });
    }
    events.sort_by_key(|event| event.frame);
    events
}

fn parse_touch_input(source: &str) -> Vec<TouchEvent> {
    let mut events = Vec::new();
    for item in source.split(',').filter(|part| !part.is_empty()) {
        let Some((frame, contacts)) = item.split_once(':') else {
            continue;
        };
        let Some(frame) = parse_u64(frame) else {
            continue;
        };
        let contacts = contacts
            .split('|')
            .filter(|contact| !contact.is_empty())
            .filter_map(|contact| {
                let mut fields = contact.split(':');
                let id = fields
                    .next()
                    .and_then(parse_u64)
                    .and_then(|value| u8::try_from(value).ok())?;
                let x = fields
                    .next()
                    .and_then(parse_u64)
                    .and_then(|value| u16::try_from(value).ok())?;
                let y = fields
                    .next()
                    .and_then(parse_u64)
                    .and_then(|value| u16::try_from(value).ok())?;
                Some((id, x, y))
            })
            .collect();
        events.push(TouchEvent { frame, contacts });
    }
    events.sort_by_key(|event| event.frame);
    events
}

fn parse_u64(value: &str) -> Option<u64> {
    value
        .strip_prefix("0x")
        .or_else(|| value.strip_prefix("0X"))
        .map(|hex| u64::from_str_radix(hex, 16).ok())
        .unwrap_or_else(|| value.parse().ok())
}
