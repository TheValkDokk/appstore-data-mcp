# Container image for the stdio MCP server (also what Glama's automated checks run).
FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY dist ./dist
COPY README.md SKILL.md ./

# stdio transport: the client speaks MCP on stdin/stdout, logs go to stderr.
ENTRYPOINT ["node", "dist/index.js"]
