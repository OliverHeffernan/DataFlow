use crate::lifecycle::Lifecycle;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;
#[cfg(not(target_os = "macos"))]
use tauri::menu::Submenu;
use tauri::menu::{Menu, MenuItem};
use tauri::{App, AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;

const CHECK_LABEL: &str = "Check for Updates…";

pub fn setup(app: &App) -> tauri::Result<()> {
    let menu = Menu::default(app.handle())?;
    let check = MenuItem::with_id(app, "check-for-updates", CHECK_LABEL, true, None::<&str>)?;

    #[cfg(target_os = "macos")]
    if let Some(tauri::menu::MenuItemKind::Submenu(app_menu)) = menu.items()?.first() {
        app_menu.insert(&check, 1)?;
    }
    #[cfg(not(target_os = "macos"))]
    menu.prepend(&Submenu::with_items(app, "Dataflow", true, &[&check])?)?;

    crate::lifecycle::route_quit_items(app, &menu)?;
    app.set_menu(menu)?;
    let busy = Arc::new(AtomicBool::new(false));
    app.on_menu_event(move |app, event| {
        if event.id().as_ref() != "check-for-updates" || busy.swap(true, Ordering::SeqCst) {
            return;
        }
        let app = app.clone();
        let check = check.clone();
        let busy = busy.clone();
        let _ = check.set_enabled(false);
        let _ = check.set_text("Checking for updates…");

        // Native dialogs must not block the UI thread or the async executor.
        tauri::async_runtime::spawn_blocking(move || {
            if let Err(error) = tauri::async_runtime::block_on(check_and_install(&app, &check)) {
                app.dialog()
                    .message(format!(
                        "Could not update Dataflow.\n\n{error}\n\nPlease try again later."
                    ))
                    .title("Update failed")
                    .kind(MessageDialogKind::Error)
                    .blocking_show();
            }
            let _ = check.set_text(CHECK_LABEL);
            let _ = check.set_enabled(true);
            busy.store(false, Ordering::SeqCst);
        });
    });
    Ok(())
}

async fn check_and_install(
    app: &AppHandle,
    menu_item: &MenuItem<tauri::Wry>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let public_key = app
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|config| config.get("pubkey"))
        .and_then(|key| key.as_str())
        .unwrap_or_default();
    if public_key.is_empty() {
        app.dialog()
            .message("This development build is not configured for updates. Install a published Dataflow release to receive updates.")
            .title("Dataflow updates")
            .blocking_show();
        return Ok(());
    }

    let Some(update) = app
        .updater_builder()
        .timeout(Duration::from_secs(30))
        .build()?
        .check()
        .await?
    else {
        app.dialog()
            .message(format!(
                "Dataflow {} is up to date.",
                app.package_info().version
            ))
            .title("No updates available")
            .blocking_show();
        return Ok(());
    };

    let install = app.dialog()
        .message(format!(
            "Dataflow {} is available (installed: {}).\n\nThe update will be downloaded and verified first. Before it is installed, Dataflow will ask what to do with any unsaved work, then restart.",
            update.version, app.package_info().version
        ))
        .title("Update Dataflow?")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom("Download and install".into(), "Cancel".into()))
        .blocking_show();
    if !install {
        return Ok(());
    }

    let _ = menu_item.set_text("Downloading update…");
    let mut downloaded = 0_u64;
    // `download` verifies the signature before returning the package.
    let package = update
        .download(
            |bytes, total| {
                downloaded += bytes as u64;
                let label = match total.filter(|total| *total > 0) {
                    Some(total) => format!(
                        "Downloading update… {}%",
                        downloaded.saturating_mul(100) / total
                    ),
                    None => format!("Downloading update… {} KiB", downloaded / 1024),
                };
                let _ = menu_item.set_text(label);
            },
            || {
                let _ = menu_item.set_text("Verifying update…");
            },
        )
        .await?;

    // Approval must precede install: Windows exits inside `install`, and
    // restarts cannot be prevented. The frontend saves, keeps, or discards
    // unsaved work (or cancels) and keeps input locked while proceeding.
    let _ = menu_item.set_text("Waiting for unsaved work…");
    let lifecycle = app.state::<Lifecycle>().inner().clone();
    if !lifecycle.request_update(app)? {
        return Ok(());
    }

    let _ = menu_item.set_text("Installing update…");
    if let Err(error) = update.install(&package) {
        lifecycle.install_finished(app);
        return Err(error.into());
    }
    app.restart();
}
