const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const yts = require('yt-search');
const crypto = require('crypto');
const fetch = require('node-fetch');
const ID3Writer = require('node-id3');
const CryptoJS = require('crypto-js');

const fileMap = {};
const tempBufferMap = {}
class AppleMusicDownloader {
  static convertirDuracion(duracion) {
    const match = duracion?.match(/PT(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return duracion;
    const minutos = parseInt(match[1] || 0);
    const segundos = parseInt(match[2] || 0);
    return `${minutos}:${segundos.toString().padStart(2, '0')}`;
  }

  static duracionASegundos(duracion) {
    if (!duracion || typeof duracion !== 'string') return 0;
    const partes = duracion.split(':').map(Number);
    if (partes.length === 2) return partes[0] * 60 + partes[1];
    if (partes.length === 3) return partes[0] * 3600 + partes[1] * 60 + partes[2];
    return 0;
  }

  static generateToken() {
    const payload = JSON.stringify({ timestamp: Date.now() });
    const key = 'dyhQjAtqAyTIf3PdsKcJ6nMX1suz8ksZ';
    return CryptoJS.AES.encrypt(payload, key).toString();
  }

  async getInfo(url) {
    const { data: html } = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });

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
      album: albumTitle || null,
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

      const response = await fetch('https://ds1.ezsrv.net/api/convert', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url: video.url,
          quality: 128,
          trim: false,
          startT: 0,
          endT: 0,
          token: AppleMusicDownloader.generateToken()
        })
      });

      const result = await response.json();
      if (!result?.url) throw new Error('No se pudo obtener el enlace de descarga');

      const audioRes = await axios.get(result.url, { responseType: 'arraybuffer' });
      let buffer = Buffer.from(audioRes.data);

      // Obtener carátula
      const imageRes = await axios.get(info.imagen, { responseType: 'arraybuffer' });
      const imageBuffer = Buffer.from(imageRes.data);

      // Etiquetas
      const tags = {
        title: info.titulo,
        artist: info.artista,
        album: info.album,
        APIC: {
          mime: "image/jpeg",
          type: {
            id: 3,
            name: "front cover"
          },
          description: "Portada",
          imageBuffer
        },
        comment: {
          language: 'eng',
          text: info.descripcion
        }
      };

      buffer = ID3Writer.update(tags, buffer);
      const uniqueId = crypto.randomBytes(256).toString('hex');
      tempBufferMap[uniqueId] = {
        buffer,
        fileName: `${info.titulo} - ${info.artista}.mp3`
      };

      return {
        success: true,
        id: uniqueId,
        title: info.titulo,
        artist: info.artista,
        album: info.album,
        fecha: info.fecha,
        descripcion: info.descripcion,
        imagen: info.imagen
      };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }
}


const downloader = new AppleMusicDownloader(); // ✅ instanciado

// ─────────────────────────────────────────────────────────────
// EXPRESS APP
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Obtener información
app.get('/api/apple-info', async (req, res) => {
  const { url } = req.query;
  if (!url) {
    return res.status(400).json({ success: false, message: 'Falta el parámetro url' });
  }

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
// Descargar canción
app.get('/api/apple-download', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ success: false, message: 'Falta el parámetro url' });

  try {
    const result = await downloader.download(url);
    if (!result.success) throw new Error(result.message);

    res.json({ success: true, url: `/api/apple-file/${result.id}` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/apple-file/:id', (req, res) => {
  const id = req.params.id;
  const data = tempBufferMap[id];
  if (!data) return res.status(404).json({ error: 'Archivo no encontrado o ya fue eliminado' });
  res.set({
    'Content-Type': 'audio/mpeg',
    'Content-Disposition': `attachment; filename="${data.fileName}"`,
    'Content-Length': data.buffer.length
  })
  res.send(data.buffer).on('finish', () => {
    delete tempBufferMap[id];
  });
});



// Puerto
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});


