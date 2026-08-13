nextflow.enable.dsl = 2

params.input = null
params.outdir = null
params.label = 'sample'
params.delay_seconds = 0
params.fail = false

process SUMMARIZE {
    tag params.label

    input:
    path input_file

    output:
    path 'summary.csv'

    script:
    """
    sleep "${params.delay_seconds}"
    if [ "${params.fail}" = "true" ]; then
        echo 'Requested fixture failure.' >&2
        exit 17
    fi
    bytes=\$(wc -c < "${input_file}")
    mkdir -p "${params.outdir}"
    printf 'sample,bytes\\n%s,%s\\n' "${params.label}" "\$bytes" > summary.csv
    cp summary.csv "${params.outdir}/summary.csv"
    """
}

workflow {
    if (!params.input) {
        error 'The input parameter is required.'
    }
    if (!params.outdir) {
        error 'The outdir parameter is required.'
    }
    SUMMARIZE(file(params.input))
}
