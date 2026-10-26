source("liatir.R")

plugin <- define_plugin(
  inputs = list(text = field$string(label = "Text", required = TRUE, default = "hello from Liatir")),
  outputs = list(length = field$number(label = "Length", format = "integer"))
)

plugin$main(function(ctx) {
  list(length = nchar(ctx$input$text, type = "chars"))
})
