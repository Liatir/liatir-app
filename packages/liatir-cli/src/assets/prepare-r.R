# Dependency preparation only: never source plugin analysis code.
args <- commandArgs(trailingOnly = TRUE)
project <- normalizePath(args[[1]], mustWork = TRUE)
manifest_path <- args[[2]]
library <- args[[3]]
dir.create(library, recursive = TRUE, showWarnings = FALSE)
.libPaths(c(library, .Library))
options(repos = c(CRAN = "https://cloud.r-project.org"), timeout = 600)
Sys.setenv(RENV_CONFIG_AUTOLOADER_ENABLED = "FALSE", RENV_CONFIG_AUTO_SNAPSHOT = "FALSE")
for (package in c("jsonlite", "renv")) {
  if (!requireNamespace(package, quietly = TRUE, lib.loc = library)) install.packages(package, lib = library)
}
manifest <- jsonlite::fromJSON(manifest_path, simplifyVector = FALSE)
if (!is.null(manifest$r$minVersion) && getRversion() < manifest$r$minVersion) {
  stop(paste("This Plugin needs R >=", manifest$r$minVersion))
}
lockfile <- file.path(project, "renv.lock")
packages <- unique(c("jsonlite", unlist(manifest$r$packages, use.names = FALSE)))
if (file.exists(lockfile)) {
  lock <- jsonlite::fromJSON(lockfile, simplifyVector = FALSE)
  names_required <- sub("^bioc::", "", packages)
  if (!all(names_required %in% names(lock$Packages))) {
    stop("renv.lock is missing declared packages. Update it with renv::snapshot() before building.")
  }
  renv::restore(project = project, library = library, lockfile = lockfile, prompt = FALSE, retry = FALSE)
} else {
  # Only author builds resolve new packages; installed bundles always restore a lock.
  renv::install(packages, project = project, library = library, prompt = FALSE)
  renv::snapshot(project = project, library = library, lockfile = lockfile,
                 packages = sub("^bioc::", "", packages), prompt = FALSE)
}
# Fail visibly if restore did not provide a usable package at its locked version.
lock <- jsonlite::fromJSON(lockfile, simplifyVector = FALSE)
for (name in names(lock$Packages)) {
  actual <- as.character(utils::packageVersion(name, lib.loc = library))
  if (!identical(actual, lock$Packages[[name]]$Version)) stop(paste("Locked version mismatch for", name))
}
