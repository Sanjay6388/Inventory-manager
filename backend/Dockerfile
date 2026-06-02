FROM node:22-alpine AS runtime

ENV NODE_ENV=production

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY app.js .
COPY src ./src

EXPOSE 8000

CMD ["node", "app.js"]
