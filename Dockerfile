FROM jrottenberg/ffmpeg:4.4-ubuntu

# Instala Node.js y otras dependencias
RUN apt-get update && apt-get install -y curl gnupg && \
    curl -sL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs

WORKDIR /app

COPY . .

RUN npm install

CMD ["node", "server.js"]
