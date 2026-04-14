#!/usr/bin/env bash
#
# Auleg Backup & Disaster Recovery Script
#
# Usage:
#   ./backup.sh backup      - Create a full backup (DB + uploads)
#   ./backup.sh restore <file> - Restore from a backup
#   ./backup.sh list         - List available backups
#   ./backup.sh cleanup [days] - Remove backups older than N days (default: 30)
#
# Environment variables:
#   BACKUP_DIR - Backup directory (default: ./backups)
#   DATABASE_URL - PostgreSQL connection string
#   PGPASSWORD - PostgreSQL password (auto-extracted from DATABASE_URL)
#

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
UPLOAD_DIR="${UPLOAD_DIR:-./server/uploads}"

# Parse DATABASE_URL into components
parse_db_url() {
  local url="${DATABASE_URL:?DATABASE_URL is not set}"
  # postgresql://user:pass@host:port/dbname
  PGUSER=$(echo "$url" | sed -n 's|.*://\([^:]*\):.*|\1|p')
  PGPASSWORD=$(echo "$url" | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p')
  PGHOST=$(echo "$url" | sed -n 's|.*@\([^:]*\):.*|\1|p')
  PGPORT=$(echo "$url" | sed -n 's|.*:\([0-9]*\)/.*|\1|p')
  PGDATABASE=$(echo "$url" | sed -n 's|.*/\([^?]*\).*|\1|p')
  export PGPASSWORD
}

backup() {
  mkdir -p "$BACKUP_DIR"
  parse_db_url

  local backup_file="$BACKUP_DIR/auleg_backup_${TIMESTAMP}"
  
  echo "=== Auleg Backup ==="
  echo "Timestamp: $TIMESTAMP"
  echo "Database: $PGDATABASE@$PGHOST:$PGPORT"
  
  # 1. Database dump (custom format for selective restore)
  echo ">>> Dumping database..."
  pg_dump -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
    --format=custom \
    --no-owner \
    --no-privileges \
    --verbose \
    -f "${backup_file}.dump" 2>&1 | tail -5

  # 2. Database dump (SQL format for portability)
  echo ">>> Creating SQL dump..."
  pg_dump -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
    --format=plain \
    --no-owner \
    --no-privileges \
    -f "${backup_file}.sql"

  # 3. Backup uploads directory
  if [ -d "$UPLOAD_DIR" ]; then
    echo ">>> Backing up uploads..."
    tar -czf "${backup_file}_uploads.tar.gz" -C "$(dirname "$UPLOAD_DIR")" "$(basename "$UPLOAD_DIR")" 2>/dev/null || true
  fi

  # 4. Create SHA256 checksums
  echo ">>> Computing checksums..."
  sha256sum "${backup_file}"* > "${backup_file}.sha256"

  # 5. Create metadata
  cat > "${backup_file}.meta.json" <<EOF
{
  "timestamp": "$TIMESTAMP",
  "database": "$PGDATABASE",
  "host": "$PGHOST",
  "files": {
    "dump": "${backup_file}.dump",
    "sql": "${backup_file}.sql",
    "uploads": "${backup_file}_uploads.tar.gz",
    "checksum": "${backup_file}.sha256"
  },
  "sizeBytes": $(stat -c%s "${backup_file}.dump" 2>/dev/null || stat -f%z "${backup_file}.dump" 2>/dev/null || echo 0)
}
EOF

  echo ""
  echo "=== Backup Complete ==="
  echo "Files:"
  ls -lh "${backup_file}"* 2>/dev/null
  echo ""
  echo "To restore: ./backup.sh restore ${backup_file}.dump"
}

restore() {
  local dump_file="${1:?Usage: ./backup.sh restore <file.dump>}"
  
  if [ ! -f "$dump_file" ]; then
    echo "ERROR: Backup file not found: $dump_file"
    exit 1
  fi

  parse_db_url

  echo "=== Auleg Restore ==="
  echo "File: $dump_file"
  echo "Database: $PGDATABASE@$PGHOST:$PGPORT"
  echo ""
  echo "WARNING: This will overwrite the current database!"
  read -p "Continue? (yes/no): " confirm
  
  if [ "$confirm" != "yes" ]; then
    echo "Restore cancelled."
    exit 0
  fi

  echo ">>> Restoring database..."
  pg_restore -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
    --clean \
    --if-exists \
    --no-owner \
    --no-privileges \
    --verbose \
    "$dump_file" 2>&1 | tail -10

  # Restore uploads if archive exists
  local uploads_archive="${dump_file%.dump}_uploads.tar.gz"
  if [ -f "$uploads_archive" ]; then
    echo ">>> Restoring uploads..."
    tar -xzf "$uploads_archive" -C "$(dirname "$UPLOAD_DIR")"
  fi

  echo ""
  echo "=== Restore Complete ==="
}

list_backups() {
  echo "=== Available Backups ==="
  if [ -d "$BACKUP_DIR" ]; then
    ls -lhtr "$BACKUP_DIR"/*.dump 2>/dev/null || echo "No backups found in $BACKUP_DIR"
  else
    echo "Backup directory not found: $BACKUP_DIR"
  fi
}

cleanup() {
  local days="${1:-30}"
  echo "=== Cleaning up backups older than ${days} days ==="
  
  if [ -d "$BACKUP_DIR" ]; then
    local count=$(find "$BACKUP_DIR" -name "auleg_backup_*" -mtime "+${days}" | wc -l)
    echo "Found $count files to remove"
    find "$BACKUP_DIR" -name "auleg_backup_*" -mtime "+${days}" -delete
    echo "Done."
  else
    echo "Backup directory not found: $BACKUP_DIR"
  fi
}

# Main
case "${1:-help}" in
  backup)   backup ;;
  restore)  restore "${2:-}" ;;
  list)     list_backups ;;
  cleanup)  cleanup "${2:-30}" ;;
  *)
    echo "Usage: $0 {backup|restore|list|cleanup}"
    echo ""
    echo "  backup           - Create full backup (DB + uploads)"
    echo "  restore <file>   - Restore from backup file"
    echo "  list             - List available backups"
    echo "  cleanup [days]   - Remove backups older than N days"
    ;;
esac
