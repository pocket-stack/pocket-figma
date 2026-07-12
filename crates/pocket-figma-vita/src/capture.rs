//! Compile-time deterministic input/capture plan for Vita3K E2E builds.
//!
//! Input is a comma-separated state track: `frame:mask:lx:ly`. A state is
//! held until the next event. Missing axes default to the centered value 128.

#[derive(Clone, Copy, Debug)]
struct InputEvent {
    frame: u64,
    buttons: i32,
    lx: u8,
    ly: u8,
}

pub struct CapturePlan {
    events: Vec<InputEvent>,
    start: u64,
    count: u64,
}

impl CapturePlan {
    pub fn compiled() -> Self {
        Self {
            events: parse_input(option_env!("POCKET_FIGMA_VITA_CAPTURE_INPUT").unwrap_or("")),
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
    ) -> (i32, i32) {
        if self.events.is_empty() {
            return (hardware_buttons, pack_analog(hardware_lx, hardware_ly));
        }
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

fn parse_u64(value: &str) -> Option<u64> {
    value
        .strip_prefix("0x")
        .or_else(|| value.strip_prefix("0X"))
        .map(|hex| u64::from_str_radix(hex, 16).ok())
        .unwrap_or_else(|| value.parse().ok())
}
