FROM ghcr.io/puppeteer/puppeteer:23.11.1

WORKDIR /app
USER root
COPY package.json .
RUN npm install --omit=dev
COPY server.js template.js ./
USER pptruser

EXPOSE 3000
CMD ["node", "server.js"]
