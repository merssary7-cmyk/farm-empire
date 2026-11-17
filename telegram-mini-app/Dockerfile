FROM node:20-alpine
WORKDIR /app
COPY telegram-mini-app/package.json ./package.json
RUN npm install --omit=dev
COPY telegram-mini-app/server.js ./server.js
COPY telegram-mini-app/schema.sql ./schema.sql
RUN mkdir -p public
COPY index.html ./public/index.html
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
