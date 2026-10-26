source("liatir.R")
plugin <- define_plugin(
  inputs = list(expression = field$file(label = "Log2 expression CSV", required = TRUE, accept = list("csv"))),
  outputs = list(results = field$file(label = "Differential expression", ext = list("csv")),
                 genes = field$number(label = "Genes tested", format = "integer"))
)
plugin$main(function(ctx) {
  # Load scientific dependencies inside the handler: contract extraction does no analysis.
  if (!requireNamespace("limma", quietly = TRUE)) stop("Prepare this Plugin's packages first.")
  data <- read.csv(ctx$input$expression, row.names = 1, check.names = FALSE)
  group <- ifelse(startsWith(names(data), "control_"), "control",
                  ifelse(startsWith(names(data), "treatment_"), "treatment", NA_character_))
  if (anyNA(group) || any(table(factor(group, levels = c("control", "treatment"))) < 2)) {
    stop("Use at least two control_* and two treatment_* columns of normalized log2 expression.")
  }
  values <- as.matrix(data)
  if (!is.numeric(values) || any(!is.finite(values))) stop("Expression measurements must be finite numbers.")
  ctx$liatir$log$info("Fitting limma models", list(genes = nrow(values)))
  ctx$liatir$progress$start(2, "Differential expression")
  design <- model.matrix(~ factor(group, levels = c("control", "treatment")))
  fit <- limma::eBayes(limma::lmFit(values, design))
  ctx$liatir$progress$advance()
  table <- limma::topTable(fit, coef = 2, number = Inf, sort.by = "P", adjust.method = "BH")
  output <- cbind(gene = rownames(table), table)
  lines <- character()
  connection <- textConnection("lines", "w", local = TRUE)
  write.csv(output, connection, row.names = FALSE)
  close(connection)
  ctx$liatir$progress$done()
  list(results = list(content = paste(lines, collapse = "\n"), fileName = "limma-results.csv"), genes = nrow(output))
})
