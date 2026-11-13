# syntax=docker/dockerfile:1
FROM node:22-alpine AS development
WORKDIR /app
RUN chown node:node /app
USER node
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --no-audit --no-fund && npm cache clean --force
COPY --chown=node:node tsconfig.json tsconfig.build.json nodemon.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node database ./database
RUN npm run build
EXPOSE 3000
CMD ["npm", "run", "start:dev"]

# Hosted demo image: the built API, its migrations and the seed scripts.
# Dependencies stay complete because the migrations and seeds run with
# node --experimental-strip-types and need them.
FROM development AS production
ENV NODE_ENV=production
COPY --chown=node:node scripts ./scripts
CMD ["node", "--experimental-strip-types", "--no-warnings", "dist/main.js"]
