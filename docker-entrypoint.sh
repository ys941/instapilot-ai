#!/bin/sh
set -e

echo "InstaPilot AI — starting..."
echo "PORT=${PORT:-3000} | NODE_ENV=$NODE_ENV"

# Ensure the database schema exists before the app boots.
echo "Applying database schema (prisma db push)..."
npx prisma db push --skip-generate || echo "WARN: prisma db push failed — continuing (DB may be unreachable)"

echo "Starting Next.js server..."
exec node server.js
