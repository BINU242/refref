# Build stage
FROM node:24-alpine AS builder

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

# Set working directory
WORKDIR /app

# Copy package files
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml turbo.json ./
COPY apps/admin/package.json ./apps/admin/
COPY packages/attribution-script/package.json ./packages/attribution-script/
COPY packages/coredb/package.json ./packages/coredb/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/referral-widget/package.json ./packages/referral-widget/
COPY packages/types/package.json ./packages/types/
COPY packages/typescript-config/package.json ./packages/typescript-config/
COPY packages/ui/package.json ./packages/ui/

# Install dependencies only for admin app and its dependencies
RUN pnpm install --frozen-lockfile --filter @refref/admin... --ignore-scripts

# Copy source code (excluding www)
COPY apps/admin ./apps/admin
COPY packages ./packages

# Run postinstall scripts now that source files are available
RUN pnpm install --frozen-lockfile --filter @refref/admin...

# Build the admin application (with placeholder env vars for build time)
ENV DATABASE_URL="postgresql://placeholder"
ENV BETTER_AUTH_SECRET="placeholder-secret-for-build"
RUN pnpm build --filter @refref/admin...

# Production stage
FROM node:24-alpine AS runner

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

WORKDIR /app

# Copy necessary files from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/admin ./apps/admin
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=builder /app/turbo.json ./turbo.json

# Set environment to production
ENV NODE_ENV=production

# Expose port
EXPOSE 3000

# Start the application
WORKDIR /app/apps/admin
CMD ["pnpm", "start"]