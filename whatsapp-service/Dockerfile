FROM node:20-alpine

# Dependências nativas necessárias para o Baileys
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    git

WORKDIR /app

# Copia e instala dependências primeiro (cache de camadas)
COPY package.json ./
RUN npm install --omit=dev

# Copia o código
COPY src/ ./src/
COPY fast-sync/ ./fast-sync/

# Cria pasta de auth (será sobreposta pelo volume) e ajusta dono pro usuário non-root
RUN mkdir -p /app/auth && chown -R node:node /app

USER node

EXPOSE 3000

CMD ["node", "src/index.js"]
