FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
COPY packages/cli/package.json packages/cli/
RUN npm ci
COPY . .
RUN npm run build -w packages/web

FROM node:22-slim
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/packages/server ./packages/server
COPY --from=build /app/packages/web/dist ./packages/web/dist
COPY --from=build /app/packages/cli ./packages/cli
COPY --from=build /app/node_modules ./node_modules
ENV CLAWCTL_PORT=7100
EXPOSE 7100
CMD ["node", "--import", "tsx", "packages/cli/src/index.ts"]
