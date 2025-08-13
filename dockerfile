# Imagen base oficial de Node.js
FROM node:20

# Instalar FFmpeg en Linux
RUN apt-get update && \
    apt-get install -y ffmpeg && \
    apt-get clean

# Crear directorio de la app
WORKDIR /app

# Copiar package.json y package-lock.json
COPY package*.json ./

# Instalar dependencias de Node.js
RUN npm install

# Copiar el resto de la app
COPY . .

# Puerto que usa Railway
EXPOSE 3000

# Comando para correr tu app
CMD ["node", "server.js"]
