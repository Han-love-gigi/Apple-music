const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const yts = require('yt-search');
const crypto = require('crypto');
const fetch = require('node-fetch');
const ID3Writer = require('node-id3');
const fs = require('fs');
const path = require('path');

const tempBufferMap = {};

// --- Función FLVTO ---
async function flvtoDownload(youtubeUrl, fileType = "mp3") {
  const videoIdMatch = youtubeUrl.match(/(?:v=|\/)([a-zA-Z0-9_-]{11})/);
  if (!videoIdMatch) throw new Error("URL de YouTube inválida");
  const videoId = videoIdMatch[1];

  const response = await fetch("https://es.flvto.top/converter", {
    method: "POST",
    headers: {
      "accept": "*/*",
      "accept-language": "es-PE,es-419;q=0.9,es;q=0.8",
      "content-type": "application/json",
      "Referer": "https://flvto.pro/"
    },
    body: JSON.stringify({ id: videoId, fileType })
  });

  const data = await response.json();
  if (data.status !== "ok") throw new Error(data.msg || "Error desconocido");

  let sizeText;
  let size = data.filesize;
  if (size >= 1024 ** 3) sizeText = (size / 1024 ** 3).toFixed(2) + " GB";
  else if (size >= 1024 ** 2) sizeText = (size / 1024 ** 2).toFixed(2) + " MB";
  else sizeText = (size / 1024).toFixed(2) + " KB";

  return { title: data.title, size: sizeText, dl_url: data.link };
}

// --- Clase principal ---
class AppleMusicDownloader {
  static convertirDuracion(duracion) {
    const match = duracion?.match(/PT(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return duracion;
    const minutos = parseInt(match[1] || 0);
    const segundos = parseInt(match[2] || 0);
    return `${minutos}:${segundos.toString().padStart(2, '0')}`;
  }

  static duracionASegundos(duracion) {
    if (!duracion) return 0;
    const partes = duracion.split(':').map(Number);
    if (partes.length === 2) return partes[0] * 60 + partes[1];
    if (partes.length === 3) return partes[0] * 3600 + partes[1] * 60 + partes[2];
    return 0;
  }

  async getInfo(url) {
    const { data: html } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const $ = cheerio.load(html);
    const jsonText = $('script#schema\\:song').html();
    if (!jsonText) throw new Error('No se encontró el script schema:song');

    const json = JSON.parse(jsonText);
    const audio = json.audio?.audio || json.audio || {};
    const artist = audio.byArtist?.[0] || json.audio?.byArtist?.[0] || {};
    const albumArtist = audio.inAlbum?.byArtist?.[0] || {};
    const albumTitle = $('h1[data-testid="non-editable-product-title"]').text().trim();

    return {
      titulo: json.name || audio.name,
      descripcion: json.description || audio.description,
      artista: artist.name || albumArtist.name || null,
      artista_url: artist.url || albumArtist.url || null,
      album: albumTitle || albumArtist.name || null,
      album_url: audio.inAlbum?.url || null,
      imagen: audio.image || json.image || null,
      fecha: audio.uploadDate || json.datePublished || null,
      duracion: AppleMusicDownloader.convertirDuracion(audio.duration || json.timeRequired),
      audio_url: audio.contentUrl || null
    };
  }

  async download(url) {
    try {
      const info = await this.getInfo(url);
      const query = `${info.titulo} ${info.artista}`;
      const { videos } = await yts.search({ query, hl: 'es', gl: 'ES' });

      const duracionObjetivo = AppleMusicDownloader.duracionASegundos(info.duracion);
      let video = videos[0];

      if (duracionObjetivo && videos.length > 0) {
        video = videos.reduce((prev, curr) => {
          const durPrev = AppleMusicDownloader.duracionASegundos(prev.timestamp);
          const durCurr = AppleMusicDownloader.duracionASegundos(curr.timestamp);
          return Math.abs(durCurr - duracionObjetivo) < Math.abs(durPrev - duracionObjetivo) ? curr : prev;
        });
      }

      // Descargar audio con FLVTO
      const flvtoData = await flvtoDownload(video.url, 'mp3');
      const audioRes = await axios.get(flvtoData.dl_url, { responseType: 'arraybuffer' });
      const imageRes = await axios.get(info.imagen, { responseType: 'arraybuffer' });
      const imageBuffer = Buffer.from(imageRes.data);

      let buffer = Buffer.from(audioRes.data);

      // Aplicar ID3 Tags
      buffer = ID3Writer.update({
        title: info.titulo,
        artist: info.artista,
        album: info.album,
        date: info.fecha,
        APIC: {
          mime: "image/jpeg",
          type: { id: 3, name: "front cover" },
          description: "Portada",
          imageBuffer
        },
        comment: { language: 'eng', text: info.descripcion },
        genre: "Music"
      }, buffer);

      const id = crypto.randomBytes(16).toString('hex');
      tempBufferMap[id] = {
        buffer,
        fileName: `${info.titulo} - ${info.artista}.mp3`,
        size: flvtoData.size,
        dl_url: flvtoData.dl_url
      };

      return { success: true, id, ...info };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }
}

const downloader = new AppleMusicDownloader();
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Obtener información
app.get('/api/apple-info', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ success: false, message: 'Falta el parámetro url' });

  try {
    const result = await downloader.getInfo(url);
    res.json({
      success: true,
      title: result.titulo,
      artist: result.artista,
      album: result.album,
      fecha: result.fecha,
      descripcion: result.descripcion,
      imagen: result.imagen
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Descargar canción con calidad
app.get('/api/apple-download', async (req, res) => {
  const { url, quality } = req.query;
  if (!url) return res.status(400).json({ success: false, message: 'Falta el parámetro url' });

  try {
    const calidad = parseInt(quality) || 128;
    const result = await downloader.download(url, calidad);
    if (!result.success) throw new Error(result.message);

    res.json({ success: true, url: `/api/apple-file/${result.id}` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Enviar archivo
app.get('/api/apple-file/:id', (req, res) => {
  const id = req.params.id;
  const data = tempBufferMap[id];
  if (!data) return res.status(404).json({ error: 'Archivo no encontrado o ya fue eliminado' });
  res.set({
    'Content-Type': 'audio/mpeg',
    'Content-Disposition': `attachment; filename="${data.fileName}"`,
    'Content-Length': data.buffer.length
  });
  res.send(data.buffer).on('finish', () => {
    delete tempBufferMap[id];
  });
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
