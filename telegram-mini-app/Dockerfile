FROM node:20-alpine
WORKDIR /app
COPY telegram-mini-app/package.json ./package.json
RUN npm install --omit=dev
COPY telegram-mini-app/server.js ./server.js
COPY telegram-mini-app/schema.sql ./schema.sql
COPY telegram-mini-app/index.part1 /tmp/index.part1
COPY telegram-mini-app/index.part2 /tmp/index.part2
COPY telegram-mini-app/index.part3 /tmp/index.part3
RUN mkdir -p public && cat /tmp/index.part1 /tmp/index.part2 /tmp/index.part3 | base64 -d | gzip -d > ./public/index.html
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]