package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"agent-box-server/internal/app"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	application, err := app.New(ctx)
	if err != nil {
		slog.Error("start application", slog.String("error", err.Error()))
		os.Exit(1)
	}
	defer func() {
		if err := application.Close(); err != nil {
			application.Logger.Error("close application", slog.String("error", err.Error()))
		}
	}()

	go func() {
		application.Logger.Info("server listening", slog.String("addr", application.Server.Addr))
		if err := application.Server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			application.Logger.Error("server failed", slog.String("error", err.Error()))
			stop()
		}
	}()

	<-ctx.Done()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), application.Config.ShutdownTimeout)
	defer cancel()
	if err := application.Server.Shutdown(shutdownCtx); err != nil {
		application.Logger.Error("server shutdown", slog.String("error", err.Error()))
	}
}
