# Liatir R Plugin SDK — managed by @liatir/cli.
# Declare the contract once; plugin$main emits it without calling the handler at build time.
if (!requireNamespace("jsonlite", quietly = TRUE)) stop("Missing jsonlite. Prepare this Plugin's runtime first.")

.liatir_json <- function(value) jsonlite::toJSON(value, auto_unbox = TRUE, null = "null", na = "null", digits = NA)
.liatir_object <- function(value) is.list(value) && (length(value) == 0L || !is.null(names(value)))
.liatir_compact <- function(value) value[!vapply(value, is.null, logical(1))]
.liatir_field <- function(type, ...) {
  spec <- c(list(type = type), list(...))
  # auto_unbox keeps scalar inputs natural; schema arrays must stay arrays even
  # when they contain only one extension or option.
  for (key in c("accept", "ext", "options")) if (!is.null(spec[[key]])) spec[[key]] <- as.list(spec[[key]])
  spec
}
field <- lapply(c("string", "number", "boolean", "file", "json", "stats"), function(type) {
  force(type)
  function(...) .liatir_field(type, ...)
})
names(field) <- c("string", "number", "boolean", "file", "json", "stats")

.liatir_validate <- function(schema, payload, output = FALSE) {
  if (!.liatir_object(payload)) stop("Plugin input/output must be a named list (JSON object).")
  if (output && any(!names(payload) %in% names(schema))) stop("Output is not declared in the contract.")
  result <- list()
  for (name in names(schema)) {
    spec <- schema[[name]]
    value <- payload[[name]]
    if (is.null(value) && !output) value <- spec$default
    if (is.null(value)) {
      if (isTRUE(spec$required)) stop(paste("Missing required", if (output) "output" else "input", name))
      result[name] <- list(NULL)
      next
    }
    scalar <- is.atomic(value) && length(value) == 1L && !is.na(value)
    valid <- switch(spec$type,
      string = is.character(value) && scalar,
      number = is.numeric(value) && scalar && is.finite(value),
      boolean = is.logical(value) && scalar,
      file = (is.character(value) && scalar) || (output && .liatir_object(value) &&
        (is.character(value$path) || is.character(value$content))),
      json = output,
      stats = output && .liatir_object(value), FALSE)
    if (!isTRUE(valid)) stop(paste(if (output) "Output" else "Input", name, "must be", spec$type))
    result[name] <- list(value)
  }
  if (output) payload else result
}

liatir_bridge <- function() {
  dev_id <- Sys.getenv("LIATIR_DEV_SESSION_ID")
  scope <- Sys.getenv("LIATIR_RUN_SCOPE")
  job_id <- Sys.getenv("LIATIR_JOB_ID", "unknown")
  dev <- if (identical(scope, "plugin-dev")) list(scope = scope, sessionId = dev_id,
    workspaceId = Sys.getenv("LIATIR_WORKSPACE_ID")) else NULL
  invoke <- function(cmd, payload = list()) {
    ipc_file <- Sys.getenv("LIATIR_IPC_FILE")
    if (!nzchar(ipc_file)) stop("Liatir app connection missing: LIATIR_IPC_FILE is not set.")
    ipc <- jsonlite::fromJSON(ipc_file, simplifyVector = FALSE)
    if (!is.numeric(ipc$port) || ipc$port < 1 || ipc$port > 65535 || !is.character(ipc$token) || length(ipc$token) != 1L || !nzchar(ipc$token) || grepl("[\r\n]", ipc$token)) stop("Invalid Liatir connection file.")
    if (!is.null(dev)) payload$`__liatirDevContext` <- dev
    if (!length(payload)) payload <- structure(list(), names = character())
    body <- .liatir_json(list(cmd = cmd, payload = payload))
    con <- socketConnection(host = "127.0.0.1", port = ipc$port, open = "r+b", blocking = TRUE, timeout = 600)
    on.exit(close(con))
    request <- paste0("POST /invoke HTTP/1.0\r\nHost: 127.0.0.1\r\nAuthorization: Bearer ", ipc$token,
      "\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: ", nchar(body, type = "bytes"), "\r\n\r\n", body)
    writeBin(charToRaw(enc2utf8(request)), con)
    flush(con)
    status <- readLines(con, n = 1, warn = FALSE)
    headers <- character()
    repeat {
      line <- readLines(con, n = 1, warn = FALSE)
      if (!length(line) || line == "") break
      headers <- c(headers, line)
    }
    if (!grepl("^HTTP/1\\.[01] 200 ", status)) stop(paste("Liatir bridge request failed:", status))
    bytes <- raw()
    repeat {
      chunk <- readBin(con, "raw", n = 65536L)
      if (!length(chunk)) break
      bytes <- c(bytes, chunk)
    }
    response <- jsonlite::fromJSON(rawToChar(bytes), simplifyVector = FALSE)
    if (!isTRUE(response$ok)) stop(if (is.null(response$error)) paste(cmd, "failed") else response$error)
    response$result
  }
  paths <- function() {
    base <- invoke("lia_fs_paths")
    if (!is.null(dev)) {
      rel <- paste0("workspaces/", dev$workspaceId, "/plugin-dev/", dev$sessionId)
      invoke("lia_fs_mkdir", list(rel = rel, permanent = TRUE))
      invoke("lia_fs_mkdir", list(rel = rel, permanent = FALSE))
      base$data <- paste0(base$data, "/", rel)
      base$cache <- paste0(base$cache, "/", rel)
      base$temp <- base$cache
    }
    base
  }
  fs_scope <- function(permanent, plugin = NULL) {
    call <- function(cmd, payload = list()) invoke(cmd, .liatir_compact(c(payload,
      list(permanent = permanent, pluginStoragePlugin = plugin))))
    list(
      list_content = function(rel = "") call("lia_fs_list_dir", list(rel = rel)),
      new_directory = function(rel) call("lia_fs_mkdir", list(rel = rel)),
      remove = function(rel, recursive = FALSE) call("lia_fs_rm", list(rel = rel, recursive = recursive)),
      stat = function(rel = "") call("lia_fs_stat", list(rel = rel)),
      write_text = function(rel, contents, create_dirs = TRUE, append = FALSE) call("lia_fs_write_text", list(rel = rel, contents = contents, createDirs = create_dirs, append = append)),
      read_text = function(rel) call("lia_fs_read_text", list(rel = rel)),
      write_bytes = function(rel, data_base64, create_dirs = TRUE) call("lia_fs_write_bytes", list(rel = rel, dataBase64 = data_base64, createDirs = create_dirs)),
      read_bytes = function(rel) call("lia_fs_read_bytes", list(rel = rel)),
      exists = function(rel) call("lia_fs_exists", list(rel = rel)),
      move = function(src, dest, create_dirs = TRUE, overwrite = FALSE) call("lia_fs_move", list(src = src, dest = dest, createDirs = create_dirs, overwrite = overwrite)),
      copy = function(src, dest, recursive = FALSE, create_dirs = TRUE, overwrite = FALSE) call("lia_fs_copy", list(src = src, dest = dest, recursive = recursive, createDirs = create_dirs, overwrite = overwrite)),
      path = function() {
        if (is.null(plugin)) return(paths()[[if (permanent) "data" else "cache"]])
        call("lia_fs_mkdir", list(rel = ""))
        call("lia_fs_stat", list(rel = ""))$path
      },
      clear = function() invoke(if (permanent) "lia_fs_clear_data" else "lia_fs_clear_cache"),
      clear_storage = function() invoke("lia_plugin_storage_clear", list(plugin = plugin)))
  }
  jobs <- list(
    spawn = function(cmd, args = list(), cwd = NULL, env = NULL, label = NULL, kind = NULL, metadata = NULL) {
      invoke("lia_jobs_spawn", .liatir_compact(list(cmd = cmd, args = as.list(args), cwd = cwd, env = env,
        label = label, kind = kind, metadata = metadata)))
    },
    kill = function(job_id) invoke("lia_jobs_kill", list(jobId = job_id)),
    status = function(job_id) invoke("lia_jobs_status", list(jobId = job_id)),
    list = function() {
      entries <- invoke("lia_jobs_list", if (is.null(dev)) list() else list(workspaceId = dev$workspaceId, includeDev = TRUE))
      if (is.null(dev)) entries else Filter(function(entry) identical(entry$metadata$pluginDevSessionId, dev$sessionId), entries)
    },
    clear_done = function() if (is.null(dev)) invoke("lia_jobs_clear_done") else 0,
    get_output = function(job_id, since = NULL) invoke("lia_jobs_get_output", .liatir_compact(list(jobId = job_id, since = since))))
  jobs$run <- function(cmd, args = list(), cwd = NULL, on_stdout = NULL, on_stderr = NULL) {
    id <- jobs$spawn(cmd, args, cwd)$jobId
    offsets <- c(stdout = 0, stderr = 0)
    repeat {
      Sys.sleep(0.1)
      entry <- jobs$status(id)
      out <- jobs$get_output(id)
      for (stream in c("stdout", "stderr")) {
        callback <- if (stream == "stdout") on_stdout else on_stderr
        lines <- out[[stream]]
        if (length(lines) > offsets[[stream]] && !is.null(callback)) {
          for (line in lines[seq.int(offsets[[stream]] + 1L, length(lines))]) callback(line)
        }
        offsets[[stream]] <- length(lines)
      }
      if (entry$status$type != "running") return(entry)
    }
  }
  log <- lapply(c("info", "warn", "error", "debug"), function(level) {
    force(level)
    function(message, meta = NULL) invoke("lia_plugin_log", .liatir_compact(list(jobId = job_id, level = level, message = message, meta = meta)))
  })
  names(log) <- c("info", "warn", "error", "debug")
  list(invoke = invoke, paths = paths, jobs = jobs,
    deps = list(check = function(binary) invoke("lia_deps_check", list(binary = binary)),
      check_many = function(binaries) invoke("lia_deps_check_many", list(binaries = as.list(binaries)))),
    desktop = list(fs = list(data = fs_scope(TRUE), cache = fs_scope(FALSE), paths = paths,
      plugin_fs = function(plugin) { if (!nzchar(trimws(plugin))) stop("Plugin name is required."); fs_scope(TRUE, paste0(gsub(".wasm", "", trimws(plugin), fixed = TRUE), ".wasm")) }),
      app = list(info = function() invoke("lia_app_info"))), log = log,
    progress = list(start = function(total, label = NULL) invoke("lia_plugin_progress", .liatir_compact(list(jobId = job_id, current = 0, total = total, label = label))),
      advance = function(n = 1, label = NULL) invoke("lia_plugin_progress", .liatir_compact(list(jobId = job_id, delta = n, label = label))),
      update = function(current, label = NULL) invoke("lia_plugin_progress", .liatir_compact(list(jobId = job_id, current = current, label = label))),
      done = function() invoke("lia_plugin_progress", list(jobId = job_id, done = TRUE))))
}

define_plugin <- function(inputs = list(), outputs = list()) {
  for (kind in c("inputs", "outputs")) {
    schema <- if (kind == "inputs") inputs else outputs
    if (!.liatir_object(schema) || any(!nzchar(names(schema))) || anyDuplicated(names(schema))) stop("Invalid field names.")
    allowed <- c("string", "number", "boolean", "file", if (kind == "outputs") c("json", "stats"))
    for (name in names(schema)) {
      spec <- schema[[name]]
      if (is.null(spec$type) || !spec$type %in% allowed) stop(paste("Invalid field type:", name))
      if (!is.null(spec$default)) .liatir_validate(setNames(list(spec), name), setNames(list(spec$default), name))
    }
  }
  list(main = function(handler) {
    if (!is.function(handler)) stop("Plugin handler must be a function.")
    # Empty contracts must serialize as objects, never JSON arrays.
    object <- function(x) if (!length(x)) structure(list(), names = character()) else x
    if (nzchar(Sys.getenv("LIATIR_EMIT_CONTRACT"))) {
      cat("__LIATIR_CONTRACT__", .liatir_json(list(liatirContract = 1, language = "r",
        inputs = object(inputs), outputs = object(outputs))), "\n", sep = "")
      return(invisible(NULL))
    }
    tryCatch({
      input_file <- Sys.getenv("LIATIR_INPUT_FILE")
      payload <- if (nzchar(input_file)) jsonlite::fromJSON(input_file, simplifyVector = FALSE) else
        jsonlite::fromJSON(paste(readLines(file("stdin"), warn = FALSE), collapse = "\n"), simplifyVector = FALSE)
      result <- handler(list(input = .liatir_validate(inputs, payload), raw_input = payload, liatir = liatir_bridge()))
      .liatir_validate(outputs, result, output = TRUE)
      cat("__LIATIR_RESULT__", .liatir_json(object(result)), "\n", sep = "")
    }, error = function(error) {
      cat("[liatir] ", conditionMessage(error), "\n", file = stderr(), sep = "")
      quit(status = 1L)
    })
  })
}
