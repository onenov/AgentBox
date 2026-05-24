package handlers

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
)

type MaintenanceSQLiteClearOutput struct {
	Body MaintenanceSQLiteClearResponse
}

type MaintenanceSQLiteClearResponse struct {
	Status        string                   `json:"status" example:"ok" doc:"Operation status."`
	Timestamp     string                   `json:"timestamp" example:"2026-05-17T12:00:00Z" doc:"UTC response timestamp."`
	Tables        []MaintenanceSQLiteTable `json:"tables" doc:"Cleared SQLite tables."`
	DeletedRows   int64                    `json:"deletedRows" example:"12" doc:"Total deleted rows."`
	Message       string                   `json:"message" example:"SQLite data cleared." doc:"Human-readable result."`
	SkippedTables []string                 `json:"skippedTables,omitempty" doc:"SQLite internal tables that were not cleared."`
}

type MaintenanceSQLiteTable struct {
	Name        string `json:"name" example:"hermes_terminal_sessions" doc:"Table name."`
	DeletedRows int64  `json:"deletedRows" example:"12" doc:"Rows deleted from this table."`
}

type MaintenanceSQLiteRebuildHook func(*sql.DB) error

var (
	maintenanceStoreDB            *sql.DB
	maintenanceSQLiteRebuildHooks []MaintenanceSQLiteRebuildHook
)

func ConfigureMaintenanceStore(db *sql.DB) {
	maintenanceStoreDB = db
}

func ConfigureMaintenanceSQLiteRebuildHooks(hooks ...MaintenanceSQLiteRebuildHook) {
	maintenanceSQLiteRebuildHooks = hooks
}

func ClearSQLiteData(ctx context.Context, input *struct{}) (*MaintenanceSQLiteClearOutput, error) {
	if maintenanceStoreDB == nil {
		return &MaintenanceSQLiteClearOutput{Body: MaintenanceSQLiteClearResponse{
			Status:    "ok",
			Timestamp: time.Now().UTC().Format(time.RFC3339),
			Message:   "SQLite store is not configured.",
		}}, nil
	}

	tables, skipped, err := listMaintenanceSQLiteTables(ctx, maintenanceStoreDB)
	if err != nil {
		return nil, fmt.Errorf("list sqlite tables: %w", err)
	}

	tx, err := maintenanceStoreDB.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin sqlite cleanup: %w", err)
	}
	defer tx.Rollback()

	cleared := make([]MaintenanceSQLiteTable, 0, len(tables))
	var deletedTotal int64
	for _, table := range tables {
		count, err := countSQLiteTableRows(ctx, tx, table)
		if err != nil {
			return nil, fmt.Errorf("count sqlite table %s: %w", table, err)
		}
		if _, err := tx.ExecContext(ctx, "DROP TABLE IF EXISTS "+quoteSQLiteIdentifier(table)); err != nil {
			return nil, fmt.Errorf("drop sqlite table %s: %w", table, err)
		}
		deletedTotal += count
		cleared = append(cleared, MaintenanceSQLiteTable{Name: table, DeletedRows: count})
	}

	if _, err := tx.ExecContext(ctx, "PRAGMA optimize"); err != nil {
		return nil, fmt.Errorf("optimize sqlite after cleanup: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit sqlite cleanup: %w", err)
	}
	for _, hook := range maintenanceSQLiteRebuildHooks {
		if hook == nil {
			continue
		}
		if err := hook(maintenanceStoreDB); err != nil {
			return nil, fmt.Errorf("rebuild sqlite runtime store: %w", err)
		}
	}

	return &MaintenanceSQLiteClearOutput{Body: MaintenanceSQLiteClearResponse{
		Status:        "ok",
		Timestamp:     time.Now().UTC().Format(time.RFC3339),
		Tables:        cleared,
		DeletedRows:   deletedTotal,
		Message:       fmt.Sprintf("SQLite data cleared and rebuilt from %d table(s).", len(cleared)),
		SkippedTables: skipped,
	}}, nil
}

func countSQLiteTableRows(ctx context.Context, tx *sql.Tx, table string) (int64, error) {
	var count int64
	err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+quoteSQLiteIdentifier(table)).Scan(&count)
	return count, err
}

func listMaintenanceSQLiteTables(ctx context.Context, db *sql.DB) ([]string, []string, error) {
	rows, err := db.QueryContext(ctx, `
SELECT name
FROM sqlite_master
WHERE type = 'table'
ORDER BY name`)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	tables := []string{}
	skipped := []string{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, nil, err
		}
		if strings.HasPrefix(name, "sqlite_") {
			skipped = append(skipped, name)
			continue
		}
		tables = append(tables, name)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	return tables, skipped, nil
}

func quoteSQLiteIdentifier(value string) string {
	return `"` + strings.ReplaceAll(value, `"`, `""`) + `"`
}
