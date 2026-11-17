FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
RUN cat public/index.html.gz.b64.part* | base64 -d | gzip -d > public/index.html && rm -f public/index.html.gz.b64.part*
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
