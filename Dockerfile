FROM node:22-alpine AS build
WORKDIR /app

# Root dependencies (frontend)
COPY package*.json ./
RUN npm ci

# Server dependencies
COPY server/package*.json ./server/
RUN cd server && npm ci

# Copy all sources
COPY . .

# Build frontend
RUN npm run build

FROM node:22-alpine
RUN apk add --no-cache kubectl curl
WORKDIR /app

# Frontend dist
COPY --from=build /app/dist ./dist

# Server + its node_modules
COPY --from=build /app/server ./server

# Root package.json for reference
COPY package*.json ./

EXPOSE 3000
CMD ["npx", "--prefix", "/app/server", "tsx", "/app/server/src/index.ts"]
