# stdio image (also what registry automated checks run): client speaks MCP on stdin/stdout.
FROM node:22 AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY README.md SKILL.md ./
ENTRYPOINT ["node", "dist/index.js"]
