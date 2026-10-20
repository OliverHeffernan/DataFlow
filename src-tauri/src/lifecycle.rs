//! Close/quit/update handshake with the frontend.
//!
//! Native code never closes, quits, or installs an update on its own: it emits
//! `lifecycle-request` `{ id, reason }` and waits for `lifecycle_complete`
//! `{ id, proceed }`. There is no timeout approval. Before the frontend calls
//! `lifecycle_ready`, close/quit fall back to a native confirmation so the
//! window can never be stuck open.

use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};
use tauri::menu::{Menu, MenuItem, MenuItemKind};
use tauri::{AppHandle, Emitter, Manager, RunEvent, Runtime, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

pub const REQUEST_EVENT: &str = "lifecycle-request";
pub const RESUME_EVENT: &str = "lifecycle-resume";
/// A repeated close/quit after this long offers a native force-quit prompt.
const UNRESPONSIVE_AFTER: Duration = Duration::from_secs(10);

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Reason {
    Close,
    Quit,
    Update,
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct Request {
    pub id: u64,
    pub reason: Reason,
}

struct Pending {
    request: Request,
    since: Instant,
    reply: Option<Sender<bool>>,
}

#[derive(Default)]
struct State {
    ready: bool,
    next_id: u64,
    pending: Option<Pending>,
    /// One-shot permission for the next exit request to pass unprevented.
    bypass_exit: bool,
    /// An approved update is installing; editing stays locked.
    installing: bool,
    /// A native prompt is on screen; suppress duplicates.
    native_prompt: bool,
}

#[derive(Debug, PartialEq, Eq)]
enum Begin {
    Emit(u64),
    /// Already waiting on the frontend; `unresponsive` after a long wait.
    Duplicate {
        unresponsive: bool,
    },
    NotReady,
    Busy,
}

#[derive(Debug, PartialEq, Eq)]
enum Completion {
    Exit,
    Stay,
    Replied,
}

#[derive(Clone, Default)]
pub struct Lifecycle(Arc<Mutex<State>>);

impl Lifecycle {
    fn state(&self) -> MutexGuard<'_, State> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn begin(&self, reason: Reason, reply: Option<Sender<bool>>) -> Begin {
        let mut state = self.state();
        if state.installing || state.native_prompt {
            return Begin::Busy;
        }
        if let Some(pending) = &state.pending {
            if reason == Reason::Update {
                return Begin::Busy;
            }
            return Begin::Duplicate {
                unresponsive: pending.since.elapsed() >= UNRESPONSIVE_AFTER,
            };
        }
        if !state.ready {
            return Begin::NotReady;
        }
        state.next_id += 1;
        let id = state.next_id;
        state.pending = Some(Pending {
            request: Request { id, reason },
            since: Instant::now(),
            reply,
        });
        Begin::Emit(id)
    }

    fn complete(&self, id: u64, proceed: bool) -> Result<Completion, String> {
        let mut state = self.state();
        match &state.pending {
            Some(pending) if pending.request.id == id => {}
            _ => return Err(format!("Lifecycle request {id} is not pending.")),
        }
        let pending = state.pending.take().expect("checked above");
        match pending.request.reason {
            Reason::Update => {
                // Lock out close/quit until install finishes or fails.
                state.installing = proceed;
                drop(state);
                if let Some(reply) = pending.reply {
                    let _ = reply.send(proceed);
                }
                Ok(Completion::Replied)
            }
            Reason::Close | Reason::Quit if proceed => {
                state.bypass_exit = true;
                Ok(Completion::Exit)
            }
            Reason::Close | Reason::Quit => Ok(Completion::Stay),
        }
    }

    fn abandon(&self, id: u64) {
        let mut state = self.state();
        if state.pending.as_ref().map(|p| p.request.id) == Some(id) {
            state.pending = None;
        }
    }

    fn take_exit_bypass(&self) -> bool {
        std::mem::take(&mut self.state().bypass_exit)
    }

    /// Called when the frontend registered its listener.
    pub fn ready(&self) {
        self.state().ready = true;
    }

    /// The page (re)loaded: its listener is gone and pending replies never arrive.
    pub fn frontend_reset(&self) {
        let mut state = self.state();
        state.ready = false;
        state.pending = None;
    }

    /// Asks the frontend to approve an update install. Blocks the calling
    /// (non-UI) thread until it answers. `Ok(true)` means install now; the
    /// caller must then call [`Lifecycle::install_finished`] on failure.
    pub fn request_update<R: Runtime>(&self, app: &AppHandle<R>) -> Result<bool, String> {
        let (reply, answer): (Sender<bool>, Receiver<bool>) = mpsc::channel();
        match self.begin(Reason::Update, Some(reply)) {
            Begin::Emit(id) => {
                let request = Request {
                    id,
                    reason: Reason::Update,
                };
                if let Err(error) = app.emit(REQUEST_EVENT, &request) {
                    self.abandon(id);
                    return Err(format!("Could not reach the editor: {error}"));
                }
                answer.recv().map_err(|_| {
                    "The editor reloaded before answering; the update was cancelled.".to_owned()
                })
            }
            Begin::NotReady => {
                Err("The editor is not ready to save your work; the update was cancelled.".into())
            }
            Begin::Busy | Begin::Duplicate { .. } => {
                Err("Dataflow is already closing or updating; the update was cancelled.".into())
            }
        }
    }

    /// An approved install failed: unlock editing again.
    pub fn install_finished<R: Runtime>(&self, app: &AppHandle<R>) {
        self.state().installing = false;
        let _ = app.emit(RESUME_EVENT, ());
    }

    /// Asks the frontend to approve close/quit. Always non-blocking.
    fn request_exit<R: Runtime>(&self, app: &AppHandle<R>, reason: Reason) {
        match self.begin(reason, None) {
            Begin::Emit(id) => {
                if let Err(error) = app.emit(REQUEST_EVENT, Request { id, reason }) {
                    self.abandon(id);
                    show_error(
                        app,
                        format!("Dataflow could not ask the editor to save before closing, so the window was kept open.\n\n{error}"),
                    );
                }
            }
            Begin::Duplicate { unresponsive: false } | Begin::Busy => {
                focus(app);
            }
            Begin::Duplicate { unresponsive: true } => self.confirm_native(
                app,
                "The editor has not answered the request to close. Quit anyway?\n\nChanges since the last recovery checkpoint may be lost.",
                "Quit anyway",
            ),
            Begin::NotReady => self.confirm_native(
                app,
                "Dataflow has not finished loading, so it cannot save your work. Quit anyway?",
                "Quit",
            ),
        }
    }

    fn confirm_native<R: Runtime>(&self, app: &AppHandle<R>, message: &str, confirm: &str) {
        {
            let mut state = self.state();
            if state.native_prompt {
                return;
            }
            state.native_prompt = true;
        }
        let lifecycle = self.clone();
        let handle = app.clone();
        app.dialog()
            .message(message)
            .title("Quit Dataflow?")
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(
                confirm.into(),
                "Keep open".into(),
            ))
            .show(move |quit| {
                let mut state = lifecycle.state();
                state.native_prompt = false;
                if quit {
                    state.pending = None;
                    state.bypass_exit = true;
                    drop(state);
                    handle.exit(0);
                }
            });
    }

    /// Window close requests are always prevented and routed to the frontend.
    pub fn on_window_event<R: Runtime>(&self, window: &tauri::Window<R>, event: &WindowEvent) {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            self.request_exit(window.app_handle(), Reason::Close);
        }
    }

    /// Exit requests are prevented unless a one-shot approval is pending.
    pub fn on_run_event<R: Runtime>(&self, app: &AppHandle<R>, event: &RunEvent) {
        if let RunEvent::ExitRequested { code, api, .. } = event {
            // Restarts cannot be prevented; approval always precedes them.
            if *code == Some(tauri::RESTART_EXIT_CODE) || self.take_exit_bypass() {
                return;
            }
            api.prevent_exit();
            self.request_exit(app, Reason::Quit);
        }
    }
}

fn focus<R: Runtime>(app: &AppHandle<R>) {
    for window in app.webview_windows().values() {
        let _ = window.set_focus();
    }
}

fn show_error<R: Runtime>(app: &AppHandle<R>, message: String) {
    app.dialog()
        .message(message)
        .title("Dataflow")
        .kind(MessageDialogKind::Error)
        .show(|_| {});
}

#[tauri::command]
pub fn lifecycle_ready(lifecycle: tauri::State<'_, Lifecycle>) {
    lifecycle.ready();
}

#[tauri::command]
pub fn lifecycle_complete(
    app: AppHandle,
    lifecycle: tauri::State<'_, Lifecycle>,
    id: u64,
    proceed: bool,
) -> Result<(), String> {
    if lifecycle.complete(id, proceed)? == Completion::Exit {
        // `complete` armed the one-shot exit bypass.
        app.exit(0);
    }
    Ok(())
}

const QUIT_ID: &str = "lifecycle-quit";

/// Predefined Quit items terminate the process without a preventable exit
/// request (e.g. macOS `terminate:`), so replace them with a routed item.
pub fn route_quit_items<R: Runtime>(app: &tauri::App<R>, menu: &Menu<R>) -> tauri::Result<()> {
    for item in menu.items()? {
        let MenuItemKind::Submenu(submenu) = item else {
            continue;
        };
        for (position, child) in submenu.items()?.into_iter().enumerate() {
            let MenuItemKind::Predefined(predefined) = child else {
                continue;
            };
            let label = predefined.text()?;
            if !label.starts_with("Quit") {
                continue;
            }
            let quit = MenuItem::with_id(app, QUIT_ID, &label, true, Some("CmdOrCtrl+Q"))?;
            submenu.remove(&predefined)?;
            submenu.insert(&quit, position)?;
        }
    }
    let lifecycle = app.state::<Lifecycle>().inner().clone();
    app.on_menu_event(move |app, event| {
        if event.id().as_ref() == QUIT_ID {
            lifecycle.request_exit(app, Reason::Quit);
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requests_wait_for_ready_and_deduplicate() {
        let lifecycle = Lifecycle::default();
        assert_eq!(lifecycle.begin(Reason::Close, None), Begin::NotReady);
        lifecycle.ready();
        assert_eq!(lifecycle.begin(Reason::Close, None), Begin::Emit(1));
        assert_eq!(
            lifecycle.begin(Reason::Quit, None),
            Begin::Duplicate {
                unresponsive: false
            }
        );
        assert_eq!(lifecycle.begin(Reason::Update, None), Begin::Busy);
        assert!(lifecycle.complete(2, true).is_err(), "stale id");
        assert!(!lifecycle.take_exit_bypass());
        assert_eq!(lifecycle.complete(1, false).unwrap(), Completion::Stay);
        assert!(!lifecycle.take_exit_bypass());
        assert!(lifecycle.complete(1, true).is_err(), "answered once");

        assert_eq!(lifecycle.begin(Reason::Quit, None), Begin::Emit(2));
        assert_eq!(lifecycle.complete(2, true).unwrap(), Completion::Exit);
        assert!(lifecycle.take_exit_bypass());
        assert!(!lifecycle.take_exit_bypass(), "bypass is one-shot");
    }

    #[test]
    fn update_approval_locks_until_install_finishes() {
        let lifecycle = Lifecycle::default();
        lifecycle.ready();
        let (reply, answer) = mpsc::channel();
        assert_eq!(lifecycle.begin(Reason::Update, Some(reply)), Begin::Emit(1));
        assert_eq!(lifecycle.complete(1, true).unwrap(), Completion::Replied);
        assert!(answer.recv().unwrap());
        assert_eq!(lifecycle.begin(Reason::Close, None), Begin::Busy);
        lifecycle.state().installing = false;

        let (reply, answer) = mpsc::channel();
        assert_eq!(lifecycle.begin(Reason::Update, Some(reply)), Begin::Emit(2));
        lifecycle.frontend_reset();
        assert!(answer.recv().is_err(), "reload cancels, never approves");
        assert_eq!(lifecycle.begin(Reason::Close, None), Begin::NotReady);
    }
}
