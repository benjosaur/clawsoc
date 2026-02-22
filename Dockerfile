# --- deps ---
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- builder ---
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
RUN npx esbuild server.ts --bundle --platform=node --outfile=server.js \
    --external:next --external:ws --external:openai

# --- runner ---
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Copy standalone Next.js output
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Copy custom server
COPY --from=builder /app/server.js ./server.js

# Install runtime-only deps needed by server.js (ws, openai)
RUN npm install --no-save ws openai

EXPOSE 3000
CMD ["node", "server.js"]
