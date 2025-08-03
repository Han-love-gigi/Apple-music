
const videoUrlInput = document.getElementById('videoUrl');
const fetchBtn = document.getElementById('fetchBtn');
const downloadOptions = document.getElementById('downloadOptions');
const videoInfo = document.getElementById('videoInfo');
const thumbnail = document.getElementById('thumbnail');
const videoTitle = document.getElementById('videoTitle');
const videoDuration = document.getElementById('videoDuration');
const videoAuthor = document.getElementById('videoAuthor');

function showToast(message, type = 'error') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-check';
    toast.innerHTML = `<i class="fas ${icon}"></i><span>${message}</span>`;
    document.getElementById('toast-container').appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

fetchBtn.addEventListener('click', async function() {
    const url = videoUrlInput.value.trim();
    if (!url) return showToast('Please enter a URL');

    fetchBtn.disabled = true;
    fetchBtn.textContent = 'Buscando...';

    try {
        const response = await fetch(`/api/apple-info?url=${encodeURIComponent(url)}`);
        const data = await response.json();

        if (!data.success) throw new Error(data.message);

        displayVideoInfo(data);
        showToast('Canción encontrada', 'exito');
    } catch (err) {
        showToast('Error: ' + err.message);
    } finally {
        fetchBtn.disabled = false;
        fetchBtn.textContent = 'Results';
    }
});

function displayVideoInfo(data) {
    thumbnail.src = data.imagen;
    videoTitle.textContent = data.title;
    videoAuthor.textContent = `${data.artist}`;
    videoDuration.textContent = `${data.fecha}`;
    videoInfo.style.display = 'block';
    downloadOptions.style.display = 'flex';
}

document.querySelectorAll('.qualityBtn').forEach(btn => {
    btn.addEventListener('click', async function () {
        const quality = this.dataset.quality;
        const url = videoUrlInput.value.trim();
        if (!url) return showToast('No URL provided');

        this.classList.add('pulse');
        setTimeout(() => this.classList.remove('pulse'), 300);

        const originalText = this.textContent;
        this.textContent = 'Convirtiendo...';
        this.disabled = true;

        try {
            const res = await fetch(`/api/apple-download?url=${encodeURIComponent(url)}&quality=${quality}`);
            const data = await res.json();

            if (!data.success) throw new Error(data.message);

            const a = document.createElement('a');
            a.href = data.url;
            a.download = '';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            showToast(`Descarga completada (${quality}kbps)`, 'success');
        } catch (err) {
            showToast('Error: ' + err.message);
        } finally {
            this.disabled = false;
            this.textContent = originalText;
        }
    });
});

document.addEventListener('DOMContentLoaded', () => {
    const themeToggle = document.getElementById('theme-toggle');
    const savedTheme = localStorage.getItem('theme');

    if (savedTheme) {
        document.documentElement.setAttribute('data-theme', savedTheme);
        themeToggle.checked = savedTheme === 'dark';
    } else {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
        themeToggle.checked = prefersDark;
    }

    themeToggle.addEventListener('change', (e) => {
        const newTheme = e.target.checked ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
    });

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        if (!localStorage.getItem('theme')) {
            const newTheme = e.matches ? 'dark' : 'light';
            document.documentElement.setAttribute('data-theme', newTheme);
            themeToggle.checked = e.matches;
        }
    });
});


