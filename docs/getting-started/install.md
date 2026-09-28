# Install Liatir Beta

Liatir is a local-first desktop application. The application, its interface,
your workspace index and your analysis history stay available without a
network connection. Optional AI Models and external tools are installed only
when you choose to use them.

::: warning Beta packages
Use only a package linked from the official Liatir website or GitHub
organization. Platform packages will be published only after their signing and
clean-machine release checks pass. An unsigned development build is not an
official Beta package.
:::

## Platform status

| Platform | Scientific workflows | Beta installer status |
| --- | --- | --- |
| macOS arm64 | Single-cell and native Nextflow paths verified | Local packaging verified; Developer ID signing and Apple notarization still required for public distribution |
| Windows 11 x86_64 | Single-cell Runtime Box support and Nextflow through WSL2 verified | Local NSIS installer verified, including a real silent install and uninstall; Authenticode code signing still required for public distribution |
| Linux x86_64 | Runtime Box support and native Nextflow verified | Local `.deb`, `.rpm` and AppImage packaging verified; a signed, distributable package and its update feed are still required |

These rows describe tested paths, not every computer that may happen to run
Liatir. See [Beta support and troubleshooting](/getting-started/support) before
starting a long analysis.

## macOS

An official macOS Beta is distributed as a signed and notarized `.dmg`:

1. Download the macOS arm64 disk image from the official release page.
2. Open the disk image and drag **Liatir** into **Applications**.
3. Start Liatir from **Applications** and confirm that macOS identifies the
   expected Liatir developer.
4. Create or select a workspace. Your scientific files are referenced in their
   existing locations; Liatir does not upload them.

Do not bypass a macOS warning for an unsigned or unidentified build. Report the
package name and release version instead.

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

An official Windows Beta is distributed as a code-signed `.exe` installer built
with NSIS:

1. Download the Windows x86_64 installer from the official release page.
2. Run it and confirm that Windows identifies the expected Liatir publisher.
3. Liatir installs for the current user, so no administrator account is needed.
4. Start Liatir from the Start menu and create or select a workspace.

Windows SmartScreen warns about an installer it does not recognise. Do not
choose **Run anyway** for a Beta package: report the filename and version
instead.

To run Nextflow workflows from Liatir on Windows, install Nextflow and a
compatible Java inside an x86_64 WSL2 distribution. Liatir drives that
distribution; there is no native Windows Nextflow.

## Linux

An official Linux Beta is distributed as a `.deb`, an `.rpm` or an AppImage for
x86_64:

1. Download the package that matches your distribution.
2. Install it with your package manager, or make the AppImage executable and
   run it directly.
3. Start Liatir and create or select a workspace.

Liatir needs a WebKitGTK-based webview, which the `.deb` and `.rpm` packages
declare as a dependency.

## Uninstall on macOS

Quit Liatir, then move **Liatir.app** from **Applications** to the Trash.
Removing the app does not remove your source datasets, Results, installed AI
Models, or workspace metadata. This retention is intentional so reinstalling
does not destroy scientific work.

If you also want to remove all Liatir-managed state, first back up any Results
you need, then remove `~/Library/Application Support/app.liatir.app`. Files you
kept elsewhere on disk are not owned or deleted by Liatir.

## Uninstall on Windows

Close Liatir, then remove **Liatir** from **Settings → Apps → Installed apps**,
or run the `uninstall.exe` that sits in the installation directory. This removes
the application, its Start menu entry and its uninstall registration.

It does not remove your source datasets, Results, installed AI Models or
workspace metadata. To remove all Liatir-managed state as well, back up any
Results you need first, then remove `%APPDATA%pp.liatir.app`. Managed Python
environments for Plugins are rebuildable and live separately under
`%LOCALAPPDATA%pp.liatir.app`; removing them only means Liatir recreates them
the next time a Plugin runs.

## Uninstall on Linux

Remove the package with your package manager, or delete the AppImage file.
Liatir-managed state stays in `$XDG_DATA_HOME/app.liatir.app`, which defaults to
`~/.local/share/app.liatir.app`; remove it only after backing up any Results you
need.
