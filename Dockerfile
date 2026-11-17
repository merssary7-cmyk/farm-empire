FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
RUN (cat public/index.html.gz.b64.part* | base64 -d | gzip -dc > public/index.html || test -s public/index.html); echo "HTML SIZE:"; wc -c public/index.html; echo "HTML SHA256:"; sha256sum public/index.html; test -s public/index.html
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
# Rebuild after Mini App click-handler compatibility fix
