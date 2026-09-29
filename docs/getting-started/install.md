# Install Liatir Beta

Liatir is a local-first desktop application. The application, its interface,
your workspace index and your analysis history stay available without a
network connection. Optional AI Models and external tools are installed only
when you choose to use them.

Get Liatir from the [Download page](/download). Use only packages linked from
there: the macOS app is signed and notarized by Apple, the Windows app is
distributed by the Microsoft Store, and every update is verified against
Liatir's signature before it is installed.

## Platforms

| Platform | Package | Updates |
| --- | --- | --- |
| macOS, Apple silicon (M1 or newer) | `.dmg`, signed and notarized | From inside Liatir |
| Windows 10 or 11, x86_64 | Microsoft Store | Through the Microsoft Store |
| Linux x86_64 | AppImage, `.deb` or `.rpm` | AppImage from inside Liatir; `.deb` and `.rpm` through your package manager |

Intel Macs are not supported. See [Beta support and troubleshooting](/getting-started/support)
before starting a long analysis.

## macOS

1. Download the disk image for Mac from the [Download page](/download).
2. Open it and drag **Liatir** into **Applications**.
3. Start Liatir from **Applications**. macOS shows that the app was downloaded
   from the internet and checked by Apple; confirm to open it.
4. Create or select a workspace. Your scientific files are referenced in their
   existing locations; Liatir does not upload them.

If macOS says the developer cannot be verified, the file did not come from the
Download page: delete it and download it again from there.

## Application updates

Each time it starts, Liatir asks `updates.liatir.com` once whether a newer
version exists. If one does, a notice offers to install it; you can close it, or
choose **Don't show again for this version** — a later version shows it again.
Nothing is downloaded until you choose to install. To stop the startup check,
open **Settings → Application updates** and turn off **Check when Liatir starts**;
**Check for updates** there works either way.

When you install, Liatir downloads the update, verifies its updater signature,
and asks you to restart. Copies installed from the Microsoft Store are updated by
the Store instead.

An update is refused while a Job is running. Finish or cancel the Job first so
an analysis is never interrupted by application replacement.

## Migration and recovery

On first start after upgrading from an older build, Liatir copies legacy
workspace and analysis indexes into its isolated application storage. The
migration is one-time and non-destructive: original entries and user-visible
Results are not deleted.

If the app does not reopen correctly after an update:

1. preserve the Liatir application-data folder;
2. reinstall the same official package or the previous supported package;
3. reopen Liatir and inspect **Jobs** and **Results**;
4. export diagnostics before removing any application data.

## Windows

1. Open the [Download page](/download) and choose **Get it from Microsoft Store**,
   or search for **Liatir** in the Microsoft Store app.
2. Select **Get** or **Install**. No administrator account is needed.
3. Start Liatir from the Start menu and create or select a workspace.

The bundled Native Tools and Nextflow run inside WSL2 on Windows, because they
have no Windows build. Install WSL2 once with `wsl --install` in an
administrator terminal and restart; nothing has to be installed inside it for
the Native Tools. To run Nextflow workflows, also install Nextflow and a
compatible Java inside an x86_64 WSL2 distribution.

## Linux

1. Download the package for your distribution from the [Download page](/download):
   the AppImage runs on any distribution, the `.deb` suits Debian and Ubuntu, and
   the `.rpm` suits Fedora and openSUSE.
2. Install the `.deb` or `.rpm` with your package manager, or make the AppImage
   executable (`chmod +x Liatir_*.AppImage`) and run it directly.
3. Start Liatir and create or select a workspace.

Liatir needs a WebKitGTK-based webview, which the `.deb` and `.rpm` packages
declare as a dependency. Only the AppImage updates itself from inside Liatir.

## Uninstall on macOS

Quit Liatir, then move **Liatir.app** from **Applications** to the Trash.
Removing the app does not remove your source datasets, Results, installed AI
Models, or workspace metadata. This retention is intentional so reinstalling
does not destroy scientific work.

If you also want to remove all Liatir-managed state, first back up any Results
you need, then remove `~/Library/Application Support/app.liatir.app`. Files you
kept elsewhere on disk are not owned or deleted by Liatir.

## Uninstall on Windows

Close Liatir, then remove it from **Settings → Apps → Installed apps**, or
right-click it in the Start menu and choose **Uninstall**.

Windows deletes a Store app's own storage together with the app, and that
includes Liatir's workspace index, installed AI Models and the Results stored
inside Liatir. Before uninstalling, copy any Results you need to a normal folder.
Source datasets you keep elsewhere on disk are never owned or deleted by Liatir.

## Uninstall on Linux

Remove the package with your package manager, or delete the AppImage file.
Liatir-managed state stays in `$XDG_DATA_HOME/app.liatir.app`, which defaults to
`~/.local/share/app.liatir.app`; remove it only after backing up any Results you
need.
