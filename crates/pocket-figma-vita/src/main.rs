use pocketjs_vita::{graphics, input, vita_log, Runtime};

#[cfg(feature = "capture")]
mod capture;

static APP_JS: &str = include_str!(concat!(env!("OUT_DIR"), "/app.js"));
static APP_PAK: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/app.pak"));
#[cfg(feature = "capture")]
const CAPTURE_DIR: &str = "ux0:data/pocket-figma-vita/cap";

/// QuickJS evaluates the 100 KB app bundle on this thread. Keep enough stack
/// for its parser/shape cloning plus Pocket Figma's initial DeepZoom mount.
#[no_mangle]
#[used]
pub static sceUserMainThreadStackSize: u32 = 2 * 1024 * 1024;

#[cfg(feature = "capture")]
fn mark(stage: &str) {
    let _ = std::fs::create_dir_all(CAPTURE_DIR);
    let _ = std::fs::write(format!("{CAPTURE_DIR}/stage.txt"), stage);
}

fn fail(message: &str) -> ! {
    vita_log(format_args!("[Pocket Figma Vita] {message}"));
    #[cfg(feature = "capture")]
    {
        let _ = std::fs::create_dir_all(CAPTURE_DIR);
        let _ = std::fs::write(format!("{CAPTURE_DIR}/error.txt"), message);
    }
    loop {
        std::thread::yield_now();
    }
}

fn main() {
    unsafe {
        #[cfg(feature = "capture")]
        mark("boot");
        let mut runtime = Runtime::new(APP_PAK).unwrap_or_else(|error| fail(&error));
        #[cfg(feature = "capture")]
        mark("runtime");
        runtime.eval(APP_JS).unwrap_or_else(|error| fail(&error));
        #[cfg(feature = "capture")]
        mark("eval");

        #[cfg(feature = "capture")]
        let plan = capture::CapturePlan::compiled();

        let mut frame = 0u64;
        loop {
            let pad = input::read();
            let hardware_touches = input::read_touches();
            #[cfg(feature = "capture")]
            let (buttons, analog, touches) =
                plan.input(frame, pad.buttons as i32, pad.lx, pad.ly, hardware_touches);
            #[cfg(not(feature = "capture"))]
            let (buttons, analog, touches) =
                (pad.buttons as i32, pad.left_analog(), hardware_touches);

            runtime
                .frame_with_input(buttons, analog, &touches)
                .unwrap_or_else(|error| fail(&error));
            runtime.tick();
            #[cfg(feature = "capture")]
            if frame == 0 {
                mark("frame");
            }
            runtime.render();
            graphics::present();
            #[cfg(feature = "capture")]
            if frame == 0 {
                mark("present");
            }

            #[cfg(feature = "capture")]
            if let Some(index) = plan.capture_index(frame) {
                mark("capture");
                let telemetry =
                    capture::ViewTelemetry::read(&runtime).unwrap_or_else(|error| fail(&error));
                runtime
                    .capture_golden(&capture::CapturePlan::path(index))
                    .unwrap_or_else(|error| fail(&error.to_string()));
                std::fs::write(
                    capture::CapturePlan::telemetry_path(index),
                    telemetry.encode(),
                )
                .unwrap_or_else(|error| fail(&error.to_string()));
                mark("captured");
            }

            frame = frame.wrapping_add(1);

            #[cfg(feature = "capture")]
            if plan.complete(frame) {
                let _ = std::fs::create_dir_all(CAPTURE_DIR);
                let _ = std::fs::write(format!("{CAPTURE_DIR}/done"), b"ok\n");
                // Vita3K can fault in GXM teardown when the guest exits itself.
                // The host harness owns termination after observing `done`, so
                // park the guest with all graphics state intact.
                loop {
                    std::thread::yield_now();
                }
            }
        }
    }
}
