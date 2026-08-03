FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci


COPY src ./src
COPY public ./public
COPY tsconfig.json ./

ENV NODE_ENV=production
EXPOSE 4000

CMD ["npx", "tsx", "src/server.ts"]
