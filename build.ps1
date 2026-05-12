<#
.SYNOPSIS
    Builds the TradeSea Spacebar Trading userscript using Rollup.
.DESCRIPTION
    Runs the Rollup bundler which compiles ES modules in src/ into a single
    Tampermonkey-compatible IIFE in dist/. Version is determined automatically
    from git tags (MAJOR.MINOR from tag, PATCH from commit count since tag).
.PARAMETER Dev
    If set, builds with a timestamp-suffixed version for local development.
#>
param(
    [switch]$Dev
)

$ErrorActionPreference = "Stop"

if ($Dev) {
    $env:BUILD = "dev"
    npx rollup -c --environment BUILD:dev
    $env:BUILD = $null
} else {
    npx rollup -c
}
