FROM node:20-alpine

# Ensure Next.js native binaries work on Alpine
RUN apk add --no-cache libc6-compat

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=7860

WORKDIR /app

# Install deps with cache-friendly layering
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

EXPOSE 7860
# Bind to the required HF port and host
CMD ["npm", "run", "start", "--", "-p", "7860", "-H", "0.0.0.0"]
