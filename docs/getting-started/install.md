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
| Windows 11 x86_64 | Single-cell Runtime Box support and Nextflow through WSL2 verified | Release installer gate in progress |
| Linux x86_64 | Runtime Box support and native Nextflow verified | Release package gate in progress |

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

Open **Settings → Application updates** and select **Check for updates**.
Liatir does not contact the release feed automatically. When an update is
available, Liatir downloads it, verifies its updater signature, and asks you to
restart after installation.

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

## Uninstall on macOS

Quit Liatir, then move **Liatir.app** from **Applications** to the Trash.
Removing the app does not remove your source datasets, Results, installed AI
Models, or workspace metadata. This retention is intentional so reinstalling
does not destroy scientific work.

If you also want to remove all Liatir-managed state, first back up any Results
you need, then remove `~/Library/Application Support/app.liatir.app`. Files you
kept elsewhere on disk are not owned or deleted by Liatir.

