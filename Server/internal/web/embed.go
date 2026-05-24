package web

import "embed"

// Dist contains the built frontend assets.
//
//go:embed dist/*
var Dist embed.FS
