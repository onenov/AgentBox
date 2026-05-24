package web

import (
	"io/fs"
	"net/http"
	"path"
	"strings"
)

func Handler() (http.Handler, error) {
	dist, err := fs.Sub(Dist, "dist")
	if err != nil {
		return nil, err
	}

	fileServer := http.FileServer(http.FS(dist))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.NotFound(w, r)
			return
		}

		if shouldServeIndex(dist, r.URL.Path) {
			r = cloneRequestWithPath(r, "/")
		}

		fileServer.ServeHTTP(w, r)
	}), nil
}

func shouldServeIndex(files fs.FS, requestPath string) bool {
	cleanPath := strings.TrimPrefix(path.Clean("/"+requestPath), "/")
	if cleanPath == "." || cleanPath == "" {
		return true
	}

	file, err := files.Open(cleanPath)
	if err != nil {
		return true
	}
	defer file.Close()

	info, err := file.Stat()
	return err != nil || info.IsDir()
}

func cloneRequestWithPath(r *http.Request, requestPath string) *http.Request {
	clone := r.Clone(r.Context())
	clone.URL.Path = requestPath
	clone.URL.RawPath = ""
	return clone
}
