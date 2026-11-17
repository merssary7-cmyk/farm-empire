FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
RUN (cat public/index.html.gz.b64.part* | base64 -d | gzip -dc > public/index.html || test -s public/index.html) \
 && test "$(wc -c < public/index.html)" -eq 66891 \
 && echo "HTML SHA256:" && sha256sum public/index.html \
 && test "$(sha256sum public/index.html | cut -d' ' -f1)" = "70094d5330bde638ceea6b3eb9efa46e294ce0f585fae0cadf3965a7b9725257"
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
