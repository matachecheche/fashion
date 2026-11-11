/**
 * HTML autocontenido para el visor de tracking corporal del Vestidor AR.
 *
 * Estrategia honesta de funcionamiento:
 *  1. Intenta cargar MediaPipe Tasks Vision desde CDN para landmarks en tiempo real.
 *  2. Si no hay red o el CDN falla, mantiene la silueta interactiva (fallback manual)
 *     con arrastre y escala del overlay.
 *  3. Nunca bloquea el uso: el overlay AR funciona con gestos incluso sin landmarks.
 *
 * El HTML se inyecta vía data URI en un WebView solo cuando el usuario abre
 * "Tracking corporal (beta)". El modo principal del Probador AR no depende de él.
 */
export const SEGUIMIENTO_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<title>Seguimiento Corporal - FashionStore AR</title>
<style>
  html, body { margin: 0; padding: 0; background: #0f172a; overflow: hidden; height: 100%; }
  #video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  #overlay { position: absolute; inset: 0; pointer-events: none; }
  #estado {
    position: absolute; top: 12px; left: 12px; right: 12px;
    background: rgba(15, 23, 42, 0.82); color: #e2e8f0; border-radius: 10px;
    font: 13px system-ui, sans-serif; padding: 8px 12px; text-align: center;
  }
  .landmark { position: absolute; width: 10px; height: 10px; border-radius: 50%; background: #f59e0b; display: none; }
</style>
</head>
<body>
  <video id="video" playsinline muted autoplay></video>
  <canvas id="overlay"></canvas>
  <div id="estado">Iniciando cámara… Si no ves tu imagen, usa el modo manual del Vestidor.</div>
  <script>
    (async function () {
      const estado = document.getElementById('estado');
      const video = document.getElementById('video');
      const canvas = document.getElementById('overlay');
      const ctx = canvas.getContext('2d');

      function send(msg) {
        const data = JSON.stringify(msg);
        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
          window.ReactNativeWebView.postMessage(data);
        }
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 1280 } },
          audio: false,
        });
        video.srcObject = stream;
        await video.play();
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        estado.textContent = 'Cámara activa. Calibrando tracking corporal…';
      } catch (e) {
        estado.textContent = 'Sin cámara: el tracking usa silueta manual. Ajusta escala y posición con los controles.';
        send({ tipo: 'sin_camara', detalle: String((e && e.message) || e) });
        return;
      }

      // Intento de carga de MediaPipe (solo si hay red). Si falla, tracking queda en modo puntual.
      let landmarker = null;
      try {
        const mod = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs');
        const vision = await mod.FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
        );
        landmarker = await mod.PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
        });
        estado.textContent = 'Tracking corporal activo (beta). Mantén hombros y torso visibles.';
      } catch (e) {
        estado.textContent = 'Tracking en modo silueta (modelo no disponible sin red). Usa los controles manuales.';
        send({ tipo: 'sin_tracking', detalle: String((e && e.message) || e) });
      }

      let lastTs = -1;
      function frame() {
        requestAnimationFrame(frame);
        if (!landmarker || video.readyState < 2) return;
        const ts = performance.now();
        if (ts === lastTs) return;
        lastTs = ts;
        try {
          const result = landmarker.detectForVideo(video, ts);
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          if (result.landmarks && result.landmarks.length > 0) {
            const lm = result.landmarks[0];
            // 11 = hombro izq, 12 = hombro der, 23 = cadera izq, 24 = cadera der
            const hombroIzq = lm[11], hombroDer = lm[12], caderaIzq = lm[23], caderaDer = lm[24];
            if (hombroIzq && hombroDer) {
              const anchoHombrosPx = Math.abs(hombroDer.x - hombroIzq.x) * canvas.width;
              const centroX = ((hombroIzq.x + hombroDer.x) / 2) * canvas.width;
              const torsoY = ((hombroIzq.y + hombroDer.y) / 2) * canvas.height;
              ctx.fillStyle = 'rgba(245, 158, 11, 0.9)';
              for (const p of [hombroIzq, hombroDer, caderaIzq, caderaDer].filter(Boolean)) {
                ctx.beginPath();
                ctx.arc(p.x * canvas.width, p.y * canvas.height, 6, 0, Math.PI * 2);
                ctx.fill();
              }
              send({
                tipo: 'landmarks',
                ancho_hombros_px: Math.round(anchoHombrosPx),
                centro_x_px: Math.round(centroX),
                torso_y_px: Math.round(torsoY),
                canvas_w: canvas.width,
                canvas_h: canvas.height,
              });
            }
          }
        } catch (_) { /* ignorar errores transitorios de detección */ }
      }
      frame();
    })();
  </script>
</body>
</html>
`;
